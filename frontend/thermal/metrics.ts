/**
 * Design metrics — the small, stable set of numbers the dashboard shows.
 *
 * WHY THIS EXISTS
 * `ThermalComfort` carries everything the model computes. The UI needs a
 * narrower, opinionated view: which numbers actually describe whether a shelter
 * works, and in what order. Deriving them in one place means the CLI harness,
 * the comparison panel and the optimisation engine can never disagree about
 * what "comfort" means.
 *
 * The split matters:
 *
 *   FREE-RUNNING resilience — what the envelope does with no HVAC at all. This
 *   is judged against the ASHRAE 55 adaptive band, because PMV was calibrated
 *   for conditioned spaces at fixed clothing and systematically misjudges
 *   naturally ventilated buildings.
 *
 *   CONDITIONED delivery — what the system achieves once it is running. This is
 *   where ISO 7730 PMV/PPD belongs.
 *
 * Reporting a single PMV number for both would be misleading, so the UI shows
 * both and labels which model produced each.
 */

import type { ClimateData, ThermalComfort } from '@/types';
import { adaptiveComfortBand } from './pmv';

export interface DesignMetrics {
  /* ---- Free-running (passive) resilience -------------------------- */
  /** Free-running indoor temperature in the peak cooling month, °C. */
  summerIndoorTemperature: number;
  /** Free-running indoor temperature in the peak heating month, °C. */
  winterIndoorTemperature: number;
  /** Coldest monthly-mean free-running indoor temperature of the year, °C. */
  minIndoorTemperature: number;
  /** Warmest monthly-mean free-running indoor temperature of the year, °C. */
  maxIndoorTemperature: number;
  /** Degrees above the adaptive upper band in the peak cooling month (0 if none). */
  summerOvertemperature: number;
  /** Degrees below the adaptive lower band in the peak heating month (0 if none). */
  winterUndertemperature: number;
  /** Annual share of hours inside the adaptive band with no HVAC, %. */
  adaptiveComfortHoursPct: number;
  overheatingHours: number;
  underheatingHours: number;

  /* ---- Conditioned delivery --------------------------------------- */
  conditionedPmv: number;
  conditionedPpd: number;
  conditionedComfortScore: number;
  coolingSetpoint: number;
  heatingSetpoint: number;

  /* ---- Energy ------------------------------------------------------ */
  annualCoolingEnergy: number;
  annualHeatingEnergy: number;
  annualEnergy: number;
  energyUseIntensity: number;
  peakCoolingLoad: number;
  peakHeatingLoad: number;
  co2TonnesPerYear: number;
}

/** Derive the headline metrics for a design. */
export function deriveDesignMetrics(
  thermal: ThermalComfort,
  climate: ClimateData,
): DesignMetrics {
  const summerMonth = climate.summary.peakCoolingMonth;
  const winterMonth = climate.summary.peakHeatingMonth;

  const summer = thermal.monthly[summerMonth] ?? thermal.monthly[0]!;
  const winter = thermal.monthly[winterMonth] ?? thermal.monthly[0]!;

  const summerBand = adaptiveComfortBand(summer.outdoorTemp, 0.9);
  const winterBand = adaptiveComfortBand(winter.outdoorTemp, 0.9);

  return {
    summerIndoorTemperature: summer.freeFloatTemp,
    winterIndoorTemperature: winter.freeFloatTemp,
    minIndoorTemperature: thermal.indoorTemperatureRange[0],
    maxIndoorTemperature: thermal.indoorTemperatureRange[1],
    summerOvertemperature: Math.max(0, summer.freeFloatTemp - summerBand.upper),
    winterUndertemperature: Math.max(0, winterBand.lower - winter.freeFloatTemp),
    adaptiveComfortHoursPct: thermal.comfortHoursPct,
    overheatingHours: thermal.overheatingHours,
    underheatingHours: thermal.underheatingHours,

    conditionedPmv: thermal.conditionedPmv,
    conditionedPpd: thermal.conditionedPpd,
    conditionedComfortScore: thermal.conditionedComfortScore,
    coolingSetpoint: thermal.coolingSetpoint,
    heatingSetpoint: thermal.heatingSetpoint,

    annualCoolingEnergy: thermal.annualCoolingEnergy,
    annualHeatingEnergy: thermal.annualHeatingEnergy,
    annualEnergy: thermal.annualEnergy,
    energyUseIntensity: thermal.energyUseIntensity,
    peakCoolingLoad: thermal.peakCoolingLoad,
    peakHeatingLoad: thermal.peakHeatingLoad,
    co2TonnesPerYear: thermal.co2TonnesPerYear,
  };
}

/* ------------------------------------------------------------------ */
/* Objective scoring                                                   */
/* ------------------------------------------------------------------ */

/**
 * Normalise a metric onto 0–1 where **lower is always better**, using a
 * documented reference range rather than the range of the candidate set.
 *
 * Reference ranges keep scores comparable between runs — adding a better
 * candidate must not make every other design look worse, which is exactly what
 * min/max normalisation would do.
 */
export function normalise(value: number, best: number, worst: number): number {
  if (worst === best) return 0;
  const t = (value - best) / (worst - best);
  return Math.min(1, Math.max(0, t));
}

/** Discomfort score: 0 = nobody ever uncomfortable, 1 = unbearable. */
export function discomfortScore(metrics: DesignMetrics): number {
  /*
   * Two independent components, because a design can fail in either direction
   * and averaging them away would hide it:
   *
   *   passive  — hours outside the adaptive band across the year. This is the
   *              honest whole-year measure for a free-running shelter.
   *   severity — how far past the band the worst season actually goes.
   *
   * The severity reference range is 15 K rather than something tighter, because
   * a shortfall of that size is not a design failure to be optimised away — in
   * a cold desert no passive envelope holds comfort through January, and
   * pretending otherwise would send the optimiser chasing an impossible target
   * instead of the insulation and heating that genuinely help.
   */
  const passive = 1 - metrics.adaptiveComfortHoursPct / 100;
  const severity = normalise(
    Math.max(metrics.summerOvertemperature, metrics.winterUndertemperature),
    0,
    15,
  );
  return Math.min(1, 0.7 * passive + 0.3 * severity);
}

/** Energy score: 0 = net-zero, 1 = profligate. Reference range 0–150 kWh/m²/yr. */
export function energyScore(metrics: DesignMetrics): number {
  return normalise(metrics.energyUseIntensity, 0, 150);
}
