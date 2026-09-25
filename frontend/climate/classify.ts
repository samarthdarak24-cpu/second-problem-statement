/**
 * Köppen-style climate classification derived from monthly normals.
 *
 * This is a deliberately simplified, explainable classifier — it reproduces the
 * Köppen family and second letter (temperature/precipitation regime) that matter
 * for building design, without claiming full Köppen–Geiger precision. The output
 * maps onto the `ClimateZone` vocabulary the rest of the pipeline consumes.
 */

import type { ClimateZone, MonthlyClimate } from '@/types';
import { DAYS_IN_MONTH } from '@/utils/units';

export interface Classification {
  /** Köppen-style code, e.g. "BSh". */
  code: string;
  /** Human-readable name, e.g. "Hot semi-arid". */
  label: string;
  /** Design-oriented zone used downstream. */
  zone: ClimateZone;
  /** Annual mean temperature, °C. */
  annualMeanTemp: number;
  /** Annual precipitation total, mm. */
  annualPrecip: number;
  /** Mean temperature of the coldest month, °C. */
  coldestMonthTemp: number;
  /** Mean temperature of the warmest month, °C. */
  warmestMonthTemp: number;
  /** Annual mean relative humidity, %. */
  annualHumidity: number;
  /** Annual mean daily irradiation, kWh/m²/day. */
  annualSolar: number;
  /** Share of annual rain falling in the wettest 3-month window, 0–1. */
  monsoonConcentration: number;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Classify a location from its 12 monthly normals.
 */
export function classifyClimate(monthly: MonthlyClimate[]): Classification {
  if (monthly.length !== 12) {
    return {
      code: 'H',
      label: 'Unclassified',
      zone: 'temperate',
      annualMeanTemp: 20,
      annualPrecip: 0,
      coldestMonthTemp: 15,
      warmestMonthTemp: 25,
      annualHumidity: 60,
      annualSolar: 5,
      monsoonConcentration: 0,
    };
  }

  const avgTemps = monthly.map((m) => m.avgTemp);
  const annualMeanTemp = mean(avgTemps);
  const coldestMonthTemp = Math.min(...avgTemps);
  const warmestMonthTemp = Math.max(...avgTemps);
  const annualPrecip = monthly.reduce((sum, m) => sum + m.rainfall, 0);
  const annualHumidity = mean(monthly.map((m) => m.humidity));
  const annualSolar = mean(monthly.map((m) => m.solarRadiation));

  // Rain concentrated in the wettest consecutive 3 months.
  let maxWindow = 0;
  for (let start = 0; start < 12; start += 1) {
    const window =
      (monthly[start]?.rainfall ?? 0) +
      (monthly[(start + 1) % 12]?.rainfall ?? 0) +
      (monthly[(start + 2) % 12]?.rainfall ?? 0);
    maxWindow = Math.max(maxWindow, window);
  }
  const monsoonConcentration = annualPrecip > 0 ? maxWindow / annualPrecip : 0;

  /*
   * Köppen's aridity threshold.
   *
   * The threshold is `20·T` plus a term for how much rain falls in the high-sun
   * half of the year: +280 where the summer is wet, +0 where rain is spread
   * through the year, +140 where the winter is wet. The reasoning is that a dry
   * season matters less when it coincides with the cold half of the year, so a
   * monsoonal site needs *more* rain before it counts as humid.
   *
   * The previous version used `20·T − 8·T` for a monsoonal site — that is 12·T,
   * less than half the correct figure. Jodhpur, with a 27 °C annual mean and
   * 330 mm of rain, missed the aridity test by 4 mm and fell through to the
   * temperate branch, which then labelled it a *subtropical highland*. An arid
   * city was being designed for as though it were a hill station.
   *
   * Half the threshold is Köppen's desert/steppe boundary, which the previous
   * version replaced with a flat 250 mm — a figure with no basis in the
   * classification and one that mislabels every semi-arid site.
   */
  const northernHemisphere = (monthly[6]?.avgTemp ?? 0) > (monthly[0]?.avgTemp ?? 0);
  const highSunMonths = northernHemisphere ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];
  const highSunRain = highSunMonths.reduce((sum, index) => sum + (monthly[index]?.rainfall ?? 0), 0);
  const highSunShare = annualPrecip > 0 ? highSunRain / annualPrecip : 0;

  const aridityThreshold =
    20 * annualMeanTemp + (highSunShare >= 0.7 ? 280 : highSunShare < 0.3 ? 140 : 0);
  const isArid = annualPrecip < aridityThreshold;
  const isDesert = annualPrecip < 0.5 * aridityThreshold;

  let code: string;
  let label: string;
  let zone: ClimateZone;

  if (isArid) {
    if (annualMeanTemp >= 18) {
      code = isDesert ? 'BWh' : 'BSh';
      label = isDesert ? 'Hot desert' : 'Hot semi-arid';
      zone = 'hot-dry';
    } else {
      code = isDesert ? 'BWk' : 'BSk';
      label = isDesert ? 'Cold desert' : 'Cold semi-arid';
      zone = 'cold-desert';
    }
  } else if (coldestMonthTemp >= 18) {
    // Tropical (A): no month is cool.
    if (annualPrecip >= 2000) {
      code = 'Af';
      label = 'Tropical rainforest';
      zone = 'hot-humid';
    } else if (monsoonConcentration > 0.55 && annualPrecip > 1200) {
      code = 'Am';
      label = 'Tropical monsoon';
      zone = 'hot-humid';
    } else {
      code = 'Aw';
      label = 'Tropical wet and dry';
      zone = annualHumidity > 74 ? 'hot-humid' : 'composite';
    }
  } else if (coldestMonthTemp >= -3) {
    /*
     * Temperate (C): the winter is mild. This can be a humid subtropical, a
     * Mediterranean or a highland regime — but it is never a *cold* one, and the
     * previous fallback returned `Cwb` / cold-cloudy for every case it did not
     * explicitly match. That caught London (annual mean 11.9 °C), Sydney,
     * Nairobi, Delhi and Jodhpur and labelled all of them "subtropical
     * highland". A branch whose default ignores the temperature it just computed
     * is not a classifier.
     */
    const hotSummer = warmestMonthTemp > 22;
    const humid = annualHumidity >= 66;
    const dryWinter = highSunShare >= 0.7;
    const drySummer = highSunShare < 0.3;

    if (annualMeanTemp < 10) {
      // A mild winter does not make a place temperate: Reykjavík's coldest month
      // sits just above freezing and its annual mean is 4 °C. Köppen calls this
      // Cfc, subpolar oceanic — cold, and it must not be classified as temperate.
      code = 'Cfc';
      label = 'Subpolar oceanic';
      zone = 'cold-cloudy';
    } else if (hotSummer && humid) {
      code = dryWinter ? 'Cwa' : 'Cfa';
      label = dryWinter ? 'Humid subtropical, dry winter' : 'Humid subtropical';
      zone = 'warm-humid';
    } else if (hotSummer && drySummer) {
      code = 'Csa';
      label = 'Mediterranean';
      zone = 'hot-dry';
    } else if (hotSummer) {
      code = 'Cwa';
      label = 'Subtropical, dry winter';
      zone = 'composite';
    } else if (humid) {
      code = 'Cfb';
      label = 'Temperate oceanic';
      zone = 'temperate';
    } else {
      // A cool, dry highland. Design-wise this is a cold problem — thin air,
      // large diurnal swing, a real heating season — not a temperate one.
      code = 'Cwb';
      label = 'Subtropical highland';
      zone = 'cold-cloudy';
    }
  } else {
    // Continental (D) and polar (E): the winter genuinely bites.
    if (warmestMonthTemp < 10) {
      code = annualHumidity > 72 ? 'ET' : 'EF';
      label = annualHumidity > 72 ? 'Tundra' : 'Frost';
      zone = 'cold-cloudy';
    } else if (warmestMonthTemp < 22) {
      code = 'Dfb';
      label = 'Humid continental, warm summer';
      zone = annualSolar >= 4.4 ? 'cold-sunny' : 'cold-cloudy';
    } else {
      code = 'Dfa';
      label = 'Humid continental, hot summer';
      zone = annualSolar >= 4.4 ? 'cold-sunny' : 'cold-cloudy';
    }
  }

  return {
    code,
    label,
    zone,
    annualMeanTemp,
    annualPrecip,
    coldestMonthTemp,
    warmestMonthTemp,
    annualHumidity,
    annualSolar,
    monsoonConcentration,
  };
}

/** Total annual precipitation, mm. */
export function annualPrecipitation(monthly: MonthlyClimate[]): number {
  return monthly.reduce((sum, m) => sum + m.rainfall, 0);
}

/** Monthly mean temperatures in calendar order. */
export function monthlyMeanTemps(monthly: MonthlyClimate[]): number[] {
  return monthly.map((m) => m.avgTemp);
}

/** Weighted annual total of cooling degree days (base 24 °C). */
export function coolingDegreeDays(monthly: MonthlyClimate[]): number {
  return monthly.reduce(
    (sum, m, i) => sum + (DAYS_IN_MONTH[i] ?? 30) * Math.max(0, m.avgTemp - 24),
    0,
  );
}

/** Weighted annual total of heating degree days (base 18 °C). */
export function heatingDegreeDays(monthly: MonthlyClimate[]): number {
  return monthly.reduce(
    (sum, m, i) => sum + (DAYS_IN_MONTH[i] ?? 30) * Math.max(0, 18 - m.avgTemp),
    0,
  );
}
