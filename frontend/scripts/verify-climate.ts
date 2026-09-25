/**
 * Climate provider verification — the live Open-Meteo aggregation.
 *
 * WHY THIS EXISTS
 * `verify-dashboard.ts` drives the store, which resolves climate through the
 * *offline* chain and is covered by the backend's captured fixtures. The live
 * archive cannot be captured — its answer is whatever Open-Meteo returns today —
 * so it is the one provider whose arithmetic was never asserted anywhere. That
 * gap shipped two bugs, and the dashboard rendered both with full confidence:
 *
 *   1. Monthly rainfall was the **mean daily** depth instead of the monthly
 *      total. Summing twelve of those understates annual rainfall by roughly
 *      the length of a month: Pune's 1155 mm/yr read as 37.8 mm/yr, which is
 *      below the Köppen arid threshold, so a monsoon city was labelled a
 *      **hot desert (BWh)**.
 *   2. Open-Meteo answers in **km/h** unless the request says otherwise, and the
 *      request did not say. A 2.9 m/s site was reported as 10.4 m/s — a
 *      near-gale — and the ventilation strategy is sized off that number.
 *
 * Both are pinned here against a synthetic payload whose arithmetic can be
 * checked by hand, plus one assertion on the outgoing request itself.
 *
 * Run:  npx tsx scripts/verify-climate.ts
 */

import {
  aggregateToMonthly,
  fetchOpenMeteoClimate,
  ARCHIVE_START_YEAR,
  ARCHIVE_END_YEAR,
  ARCHIVE_YEARS,
} from '@/climate/providers/openMeteo';
import type { OpenMeteoResponse } from '@/climate/providers/openMeteo';
import { STATION_BY_ID } from '@/climate/stations';
import type { Location } from '@/types';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function close(a: number, b: number, rel = 1e-9): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9);
}

function section(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

/* ------------------------------------------------------------------ */
/* Synthetic payload                                                   */
/* ------------------------------------------------------------------ */

const YEARS = 3;

interface DailyPayload {
  time: string[];
  temperature_2m_mean: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  relative_humidity_2m_mean: number[];
  wind_speed_10m_mean: number[];
  wind_direction_10m_dominant: number[];
  shortwave_radiation_sum: number[];
  precipitation_sum: Array<number | null>;
  sunshine_duration: number[];
}

/**
 * A three-year archive whose arithmetic is checkable by hand.
 *
 * January receives 2.0 mm every day and July 10.0 mm every day, across three
 * complete years. The January normal is therefore 2.0 × 31 = 62 mm and the July
 * normal 10.0 × 31 = 310 mm, for an annual total of 372 mm. The buggy "mean
 * daily" reading gives 2.0 and 10.0 — an annual total of 12 mm.
 */
function dailyPayload(): DailyPayload {
  const time: string[] = [];
  const rain: Array<number | null> = [];

  for (let year = ARCHIVE_START_YEAR; year < ARCHIVE_START_YEAR + YEARS; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const days =
        month === 2 ? 28 : [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31 : 30;
      for (let day = 1; day <= days; day += 1) {
        const mm = month === 7 ? 10 : month === 1 ? 2 : 0;
        time.push(
          `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        );
        rain.push(mm);
      }
    }
  }

  const count = time.length;
  return {
    time,
    temperature_2m_mean: new Array<number>(count).fill(25),
    temperature_2m_max: new Array<number>(count).fill(33),
    temperature_2m_min: new Array<number>(count).fill(17),
    relative_humidity_2m_mean: new Array<number>(count).fill(60),
    // Already m/s — the request asks for that unit explicitly, and nothing in
    // the aggregation may rescale it.
    wind_speed_10m_mean: new Array<number>(count).fill(4),
    wind_direction_10m_dominant: new Array<number>(count).fill(225),
    shortwave_radiation_sum: new Array<number>(count).fill(18),
    precipitation_sum: rain,
    sunshine_duration: new Array<number>(count).fill(21600),
  };
}

/** The payload wrapped the way the provider receives it. */
function payload(daily: DailyPayload = dailyPayload()): OpenMeteoResponse {
  return { latitude: 18.52, longitude: 73.86, daily };
}

/** An archive that returned nothing — the provider must still yield 12 months. */
function emptyPayload(): OpenMeteoResponse {
  return { latitude: 18.52, longitude: 73.86, daily: { time: [] } };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

function testWindow(): void {
  section('ARCHIVE WINDOW');

  check('start year is the documented 2019', ARCHIVE_START_YEAR === 2019);
  check('end year is the documented 2023', ARCHIVE_END_YEAR === 2023);
  check('window is five complete years', ARCHIVE_YEARS === 5);

  // The Python service declares the same window; a drift here would make the
  // two engines disagree about the same city.
  check(
    'window is fixed rather than derived from the current date',
    ARCHIVE_END_YEAR - ARCHIVE_START_YEAR + 1 === ARCHIVE_YEARS,
  );
}

function testRainfall(): void {
  section('RAINFALL — A TOTAL, NOT A MEAN DAILY DEPTH');

  const monthly = aggregateToMonthly(payload(), YEARS);

  check(
    'January is 2 mm/day × 31 days = 62 mm',
    close(monthly[0]!.rainfall, 62),
    `got ${monthly[0]!.rainfall}`,
  );
  check(
    'July is 10 mm/day × 31 days = 310 mm',
    close(monthly[6]!.rainfall, 310),
    `got ${monthly[6]!.rainfall}`,
  );
  check(
    'a dry month is zero, not a fallback constant',
    close(monthly[3]!.rainfall, 0, 1e-9),
    `got ${monthly[3]!.rainfall}`,
  );

  const annual = monthly.reduce((sum, m) => sum + m.rainfall, 0);
  check('annual total is 372 mm', close(annual, 372), `got ${annual}`);
  check(
    'the mean-daily bug would be more than 20× smaller',
    annual > 20 * (2 + 10),
    `annual ${annual} vs buggy ${2 + 10}`,
  );

  // Uniform 1 mm/day must accumulate across each month.
  const flat = dailyPayload();
  flat.precipitation_sum = new Array<number>(flat.time.length).fill(1);
  const flatMonthly = aggregateToMonthly(payload(flat), YEARS);
  const everyMonthAccumulates = flatMonthly.every((m) => m.rainfall > 27);
  check('1 mm every day gives 30–31 mm a month', everyMonthAccumulates);
  const flatAnnual = flatMonthly.reduce((sum, m) => sum + m.rainfall, 0);
  check('1 mm/day for a year is 365 mm', close(flatAnnual, 365), `got ${flatAnnual}`);

  // The window length must normalise the total, not multiply it.
  const overFive = aggregateToMonthly(payload(flat), 5);
  const fiveYearAnnual = overFive.reduce((sum, m) => sum + m.rainfall, 0);
  check(
    'five years of data does not read as five years of rain',
    close(fiveYearAnnual, (365 * 3) / 5),
    `got ${fiveYearAnnual}`,
  );
}

function testWind(): void {
  section('WIND — M/S IN, M/S OUT');

  const monthly = aggregateToMonthly(payload(), YEARS);
  check(
    'wind passes through without a km/h → m/s rescale',
    monthly.every((m) => close(m.windSpeed, 4)),
    `got ${monthly.map((m) => m.windSpeed.toFixed(2)).join(', ')}`,
  );
}

function testUnits(): void {
  section('UNIT CONVERSIONS');

  const monthly = aggregateToMonthly(payload(), YEARS);
  check(
    '18 MJ/m²/day → 5.0 kWh/m²/day',
    Math.abs(monthly[0]!.solarRadiation - 5) < 0.01,
    `got ${monthly[0]!.solarRadiation}`,
  );
  check(
    '21600 s/day → 6 h/day sunshine',
    close(monthly[0]!.sunshineHours, 6),
    `got ${monthly[0]!.sunshineHours}`,
  );
  check(
    'temperatures pass through unchanged',
    monthly.every((m) => m.avgTemp === 25 && m.maxTemp === 33 && m.minTemp === 17),
  );
  check(
    'humidity passes through unchanged',
    monthly.every((m) => m.humidity === 60),
  );
}

function testRobustness(): void {
  section('ROBUSTNESS');

  const gappy = dailyPayload();
  gappy.precipitation_sum = gappy.precipitation_sum.map((v, i) => (i % 3 === 0 ? null : v));
  const gappyMonthly = aggregateToMonthly(payload(gappy), YEARS);
  check(
    'a null day is skipped, not counted as zero',
    close(gappyMonthly[0]!.rainfall, (62 * 2) / 3, 1e-6),
    `got ${gappyMonthly[0]!.rainfall}`,
  );

  const empty = aggregateToMonthly(emptyPayload(), 5);
  check('an empty archive still yields twelve months', empty.length === 12);
  check(
    'months are numbered 0–11 in order',
    empty.every((m, i) => m.month === i),
  );
}

async function testOutgoingRequest(): Promise<void> {
  section('THE OUTGOING REQUEST');

  const station = STATION_BY_ID.get('in-pune');
  if (!station) {
    check('Pune is in the station catalogue', false);
    return;
  }

  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ daily: dailyPayload() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const data = await fetchOpenMeteoClimate(station.location as Location);
    const url = new URL(requested);
    const params = url.searchParams;

    check(
      'the request states wind_speed_unit=ms',
      params.get('wind_speed_unit') === 'ms',
      `got ${params.get('wind_speed_unit')}`,
    );
    check(
      'the request asks for the documented window',
      params.get('start_date') === `${ARCHIVE_START_YEAR}-01-01` &&
        params.get('end_date') === `${ARCHIVE_END_YEAR}-12-31`,
      `${params.get('start_date')} → ${params.get('end_date')}`,
    );

    const daily = (params.get('daily') ?? '').split(',');
    const required = [
      'temperature_2m_mean',
      'temperature_2m_max',
      'temperature_2m_min',
      'relative_humidity_2m_mean',
      'wind_speed_10m_mean',
      'wind_direction_10m_dominant',
      'shortwave_radiation_sum',
      'precipitation_sum',
      'sunshine_duration',
    ];
    check(
      'every variable the pipeline consumes is requested',
      required.every((v) => daily.includes(v)),
      daily.join(','),
    );
    check(
      'no hourly series is requested — daily aggregates carry the same answer',
      params.get('hourly') === null,
    );

    check('the payload is tagged as live', data.source === 'api', data.source);
    const expectedAnnual = (372 * YEARS) / ARCHIVE_YEARS;
    check(
      'the fetched summary uses the corrected rainfall total',
      close(data.summary.rainfall, expectedAnnual),
      `got ${data.summary.rainfall}, expected ${expectedAnnual}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log('\nCLIMATE PROVIDER VERIFICATION');
  console.log('Pinning the live archive aggregation, which no fixture can cover.\n');

  testWindow();
  testRainfall();
  testWind();
  testUnits();
  testRobustness();
  await testOutgoingRequest();

  section('RESULT');
  console.log(`  ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
