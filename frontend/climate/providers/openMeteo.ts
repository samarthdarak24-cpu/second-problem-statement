/**
 * Live climate provider — Open-Meteo archive API.
 *
 * Open-Meteo is free and needs no API key, which makes it a good default for a
 * prototype. A multi-year window of daily reanalysis data is aggregated into
 * the same monthly-normal shape the offline database produces, so every
 * downstream stage is provider-agnostic.
 *
 * This is deliberately a mirror of `fetch_open_meteo_climate` in the FastAPI
 * service — same window, same variables, same units, same aggregation — so that
 * "the backend says X, the browser says Y" can only ever mean a bug. Two
 * climate engines that disagree about how much rain falls on a site make the
 * whole classification downstream of them untrustworthy.
 *
 * If the request fails, times out, or the network is unavailable, callers fall
 * back to the offline database (see `climate/climateService.ts`).
 */

import type { ClimateData, Location, MonthlyClimate } from '@/types';
import { normalizeDeg } from '@/utils/units';
import { buildClimateData } from '../deriveClimate';
import { classifyClimate } from '../classify';

const ARCHIVE_ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * The archive window both engines aggregate.
 *
 * Fixed rather than rolling on purpose: a shelter is designed against a
 * climatology, and a climatology that silently shifts every January would make
 * a site's Köppen class — and therefore every design decision downstream of it
 * — change for reasons that have nothing to do with the site.
 */
export const ARCHIVE_START_YEAR = 2019;
export const ARCHIVE_END_YEAR = 2023;
export const ARCHIVE_YEARS = ARCHIVE_END_YEAR - ARCHIVE_START_YEAR + 1;

/**
 * Daily variables only.
 *
 * The pipeline needs monthly means and monthly totals; daily aggregates carry
 * both. Fetching hourly records instead would be ~24× the payload to compute
 * the same twelve numbers, and the live probe is bounded by a four-second
 * budget — a window that a year of hourly data does not reliably fit inside.
 */
const DAILY_VARIABLES = [
  'temperature_2m_mean',
  'temperature_2m_max',
  'temperature_2m_min',
  'relative_humidity_2m_mean',
  'wind_speed_10m_mean',
  'wind_direction_10m_dominant',
  'shortwave_radiation_sum',
  'precipitation_sum',
  'sunshine_duration',
].join(',');

/**
 * The subset of the archive response this module reads.
 *
 * Exported because it is also the shape the aggregation is *tested* against —
 * the live provider is the one whose output cannot be compared to a captured
 * fixture, so its input contract is worth being able to construct by hand.
 */
export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    relative_humidity_2m_mean?: Array<number | null>;
    wind_speed_10m_mean?: Array<number | null>;
    wind_direction_10m_dominant?: Array<number | null>;
    shortwave_radiation_sum?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    sunshine_duration?: Array<number | null>;
  };
  reason?: string;
  error?: boolean;
}

export interface OpenMeteoOptions {
  /** Request timeout, ms. */
  timeoutMs?: number;
  /** External abort signal, composed with the internal timeout. */
  signal?: AbortSignal;
  /**
   * Optional Open-Meteo API key.
   *
   * The free tier needs no key and already covers every latitude/longitude on
   * Earth, so a key is strictly optional. A key lifts the per-IP rate limit and
   * (on a paid plan) adds an SLA — useful when the same browser hits the archive
   * for many sites in one session, or behind a shared venue IP. Set it via the
   * `NEXT_PUBLIC_OPEN_METEO_API_KEY` env var, or paste it into the topbar at
   * runtime; either way it is sent as the standard `apikey` query parameter.
   */
  apiKey?: string;
}

/**
 * Default API key, read from the build-time env.
 *
 * `NEXT_PUBLIC_` makes it available to the browser bundle (the live provider
 * runs client-side, so a server-only var would be invisible to it). Empty when
 * unset — in which case the keyless free tier is used and works for all sites.
 */
export const OPEN_METEO_API_KEY = process.env.NEXT_PUBLIC_OPEN_METEO_API_KEY ?? '';

/**
 * Commercial endpoints honour the same `apikey` parameter on the standard host,
 * but paid customers are told to point at the `customer-` prefixed host. Allow
 * an override so a keyed deployment can use whichever host its plan documents;
 * defaults to the public archive host when unset.
 */
const ARCHIVE_ENDPOINT_KEYED =
  process.env.NEXT_PUBLIC_OPEN_METEO_ARCHIVE_URL ?? ARCHIVE_ENDPOINT;

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Month index (0–11) from an ISO date or datetime string. */
function monthOf(iso: string): number {
  const month = Number.parseInt(iso.slice(5, 7), 10);
  return Number.isFinite(month) ? month - 1 : 0;
}

/**
 * Aggregate the archive window into 12 monthly normals.
 *
 * `years` is the length of the window, and it is what turns an accumulated
 * depth of rain into a monthly normal. Rainfall is the one variable here that
 * is a *total* rather than a rate, so it is the one that needs it.
 */
export function aggregateToMonthly(
  response: OpenMeteoResponse,
  years: number = ARCHIVE_YEARS,
): MonthlyClimate[] {
  const dailyTime = response.daily?.time ?? [];
  const safeYears = years > 0 ? years : 1;

  interface Bucket {
    max: number[];
    min: number[];
    mean: number[];
    radiation: number[];
    rain: number[];
    sun: number[];
    humidity: number[];
    windSpeed: number[];
    windDirX: number;
    windDirY: number;
  }

  const buckets: Bucket[] = Array.from({ length: 12 }, () => ({
    max: [], min: [], mean: [], radiation: [], rain: [], sun: [],
    humidity: [], windSpeed: [], windDirX: 0, windDirY: 0,
  }));

  const push = (arr: number[], value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) arr.push(value);
  };

  dailyTime.forEach((iso, i) => {
    const bucket = buckets[monthOf(iso)];
    if (!bucket) return;

    const daily = response.daily;
    push(bucket.max, daily?.temperature_2m_max?.[i]);
    push(bucket.min, daily?.temperature_2m_min?.[i]);
    push(bucket.mean, daily?.temperature_2m_mean?.[i]);
    push(bucket.radiation, daily?.shortwave_radiation_sum?.[i]);
    push(bucket.rain, daily?.precipitation_sum?.[i]);
    push(bucket.sun, daily?.sunshine_duration?.[i]);
    push(bucket.humidity, daily?.relative_humidity_2m_mean?.[i]);

    const ws = daily?.wind_speed_10m_mean?.[i];
    const wd = daily?.wind_direction_10m_dominant?.[i];
    push(bucket.windSpeed, ws);
    if (typeof wd === 'number' && Number.isFinite(wd)) {
      // Speed-weighted so a still day does not outvote a windy one on bearing.
      const speed = typeof ws === 'number' && Number.isFinite(ws) ? Math.max(ws, 0.1) : 1;
      const rad = (wd * Math.PI) / 180;
      bucket.windDirX += Math.cos(rad) * speed;
      bucket.windDirY += Math.sin(rad) * speed;
    }
  });

  return buckets.map((b, month) => {
    const avgTemp = mean(b.mean);
    const maxTemp = mean(b.max);
    const minTemp = mean(b.min);

    const windDirection =
      b.windDirX === 0 && b.windDirY === 0
        ? 225
        : normalizeDeg((Math.atan2(b.windDirY, b.windDirX) * 180) / Math.PI);

    return {
      month,
      avgTemp,
      // Guard against a month where the archive has no gap-free daily means.
      maxTemp: maxTemp || avgTemp + 5,
      minTemp: minTemp || avgTemp - 5,
      humidity: mean(b.humidity) || 60,
      windSpeed: mean(b.windSpeed) || 2.5,
      windDirection,
      // shortwave_radiation_sum arrives in MJ/m²/day; 1 MJ/m² = 0.2778 kWh/m².
      solarRadiation: mean(b.radiation) * 0.2778 || 4.5,
      // A monthly total, normalised by the length of the window. Summing a mean
      // daily figure instead would understate annual rainfall by a factor of
      // ~30 and reclassify monsoon cities as deserts.
      rainfall: b.rain.reduce((sum, v) => sum + v, 0) / safeYears,
      sunshineHours: mean(b.sun) / 3600 || 6,
    };
  });
}

/**
 * Fetch the archive window and reduce it to monthly normals.
 *
 * @throws when the network fails or the API returns an error payload.
 */
export async function fetchOpenMeteoClimate(
  location: Location,
  options: OpenMeteoOptions = {},
): Promise<ClimateData> {
  const timeoutMs = options.timeoutMs ?? 12000;
  // A runtime key (e.g. pasted in the UI) wins over the build-time env var.
  const apiKey = options.apiKey ?? OPEN_METEO_API_KEY;

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    start_date: `${ARCHIVE_START_YEAR}-01-01`,
    end_date: `${ARCHIVE_END_YEAR}-12-31`,
    daily: DAILY_VARIABLES,
    // Open-Meteo defaults wind to km/h; the pipeline works in m/s everywhere.
    // Stating the unit in the request avoids a conversion that is easy to
    // forget and would silently scale every wind figure by 3.6.
    wind_speed_unit: 'ms',
    timezone: 'auto',
  });
  // The key is sent as the standard `apikey` query parameter. On a paid plan
  // this also routes through the customer host (see ARCHIVE_ENDPOINT_KEYED).
  if (apiKey) params.set('apikey', apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${ARCHIVE_ENDPOINT_KEYED}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo responded ${response.status}`);
    }

    const payload = (await response.json()) as OpenMeteoResponse;
    if (payload.error) {
      throw new Error(payload.reason ?? 'Open-Meteo returned an error payload');
    }

    const monthly = aggregateToMonthly(payload);
    if (monthly.every((m) => m.avgTemp === 0 && m.solarRadiation === 0)) {
      throw new Error('Open-Meteo returned an empty series');
    }

    const classification = classifyClimate(monthly);
    const resolvedLocation: Location = {
      ...location,
      latitude: payload.latitude ?? location.latitude,
      longitude: payload.longitude ?? location.longitude,
      elevation: Math.round(payload.elevation ?? location.elevation),
    };

    return buildClimateData(
      {
        location: resolvedLocation,
        climateType: `${classification.label} (${classification.code})`,
        climateZone: classification.zone,
        monthly,
      },
      'api',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Attribution string shown in the UI when live data is in use. */
export const OPEN_METEO_ATTRIBUTION = `Live reanalysis via Open-Meteo (ERA5), ${ARCHIVE_START_YEAR}–${ARCHIVE_END_YEAR}. Aggregated to monthly normals by this app.`;
