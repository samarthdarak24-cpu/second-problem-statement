/**
 * Occupational heat and cold stress — the military assessment layer.
 *
 * WHY THIS IS SEPARATE FROM PMV/PPD
 * PMV answers "is this space comfortable for a person in ordinary clothing
 * doing light work". It is the right question for a dwelling and the wrong one
 * for a deployment. A soldier in body armour working a radio watch is not
 * "slightly warm"; they are accumulating heat, and the number that governs
 * whether the watch can continue is a WBGT band, not a comfort vote. Equally, a
 * sentry at −18 °C is not "uncomfortable"; they are short of a calculable amount
 * of clothing insulation.
 *
 * So the system keeps three assessments side by side and never merges them:
 *
 *   PMV / PPD / adaptive   — comfort, ISO 7730 and ASHRAE 55
 *   WBGT                   — heat stress, ISO 7243 style
 *   Required clothing      — cold stress, an IREQ-style insulation deficit
 *
 * The comfort numbers already exist in `thermal/pmv.ts`; this module adds the
 * other two and nothing else.
 */

import type { ThermalComfort } from '@/types';
import { COMFORT_REFERENCE_TEMP } from '@/utils/units';
import { wetBulb } from '@/utils/psychrometrics';

export type StressRisk = 'low' | 'moderate' | 'high' | 'extreme';

/* ------------------------------------------------------------------ */
/* Heat stress — WBGT                                                  */
/* ------------------------------------------------------------------ */

export interface HeatStressResult {
  /** Wet-bulb globe temperature, °C. */
  wbgt: number;
  /** Natural wet-bulb temperature used, °C. */
  wetBulb: number;
  /** Globe temperature used, °C. */
  globeTemp: number;
  risk: StressRisk;
  /** One-line work/rest guidance. */
  guidance: string;
  actions: string[];
  /** True when the space needs active cooling to stay inside the band. */
  coolingRequired: boolean;
}

/**
 * Indoor WBGT.
 *
 * ISO 7243's indoor approximation is `WBGT = 0.7·T_nwb + 0.3·T_g`. Outdoors the
 * globe term carries the solar load; indoors, in a shaded space, the globe sits
 * close to the air temperature, so `T_g ≈ T_dry` and the index is dominated by
 * the wet-bulb. That is exactly why humidity matters so much for a coastal
 * deployment and so little for a desert one at the same air temperature.
 *
 * The wet-bulb is Stull's approximation, which assumes near-sea-level pressure —
 * noted in the UI provenance, because at Leh it is optimistic.
 */
export function computeHeatStress(indoorTemp: number, relativeHumidity: number): HeatStressResult {
  const wetBulbC = wetBulb(indoorTemp, relativeHumidity);
  const globeTemp = indoorTemp;
  const wbgt = 0.7 * wetBulbC + 0.3 * globeTemp;

  const risk = wbgtRisk(wbgt);

  return {
    wbgt: round1(wbgt),
    wetBulb: round1(wetBulbC),
    globeTemp: round1(globeTemp),
    risk,
    guidance: HEAT_GUIDANCE[risk],
    actions: HEAT_ACTIONS[risk],
    coolingRequired: risk === 'high' || risk === 'extreme',
  };
}

/**
 * WBGT risk bands for acclimatised personnel doing light work.
 *
 * These are the conservative end of the ISO 7243 / US Navy reference tables. A
 * shelter is a light-work environment, so the light-work column is the right
 * one; using the heavy-work column would under-warn.
 */
function wbgtRisk(wbgt: number): StressRisk {
  if (wbgt >= 32) return 'extreme';
  if (wbgt >= 30) return 'high';
  if (wbgt >= 28) return 'moderate';
  return 'low';
}

const HEAT_GUIDANCE: Record<StressRisk, string> = {
  low: 'No heat-stress restriction at this condition.',
  moderate: 'Caution — monitor personnel and maintain fluid intake.',
  high: 'Heat-stress restriction — reduce work rate or increase air movement.',
  extreme: 'Severe heat stress — active cooling or work suspension required.',
};

const HEAT_ACTIONS: Record<StressRisk, string[]> = {
  low: [],
  moderate: ['Maintain drinking water', 'Rotate duties', 'Increase air movement if available'],
  high: [
    'Increase ventilation to the design maximum',
    'Reduce occupancy or work rate',
    'Activate cooling',
    'Enforce work/rest cycling',
  ],
  extreme: [
    'Suspend non-essential work',
    'Run active cooling continuously',
    'Evacuate non-essential personnel',
    'Monitor for heat casualties',
  ],
};

/* ------------------------------------------------------------------ */
/* Cold stress — required clothing insulation                          */
/* ------------------------------------------------------------------ */

export interface ColdStressResult {
  /** Operative temperature the assessment is made at, °C. */
  operativeTemp: number;
  /** Clothing insulation the condition demands, clo. */
  requiredClo: number;
  /** What the deployment actually provides, clo. */
  availableClo: number;
  /** Shortfall, clo. Zero when the kit is adequate. */
  deficitClo: number;
  /** Peak heating load the shelter would need, kW. */
  heatingLoadKw: number;
  risk: StressRisk;
  guidance: string;
  actions: string[];
  /** True when active heating is needed to close the gap. */
  heatingRequired: boolean;
}

/**
 * Required clothing insulation, IREQ-style but linearised.
 *
 * The relation is anchored at the comfort reference (24 °C needs about 0.5 clo
 * for light work) and rises at roughly 0.09 clo per kelvin of cold, scaled by
 * activity: a person working harder needs less insulation for the same air
 * temperature. It is a linear approximation of the ISO 11079 table, deliberately
 * — the exact figure depends on wind, radiant asymmetry and wetness, none of
 * which a single-zone model resolves, and a table lookup would imply a precision
 * this model does not have.
 */
export function computeColdStress(
  operativeTemp: number,
  activityMet: number,
  availableClo: number,
  heatingLoadKw: number,
): ColdStressResult {
  const activityFactor = Math.max(0.6, activityMet / 1.2);
  const requiredClo = clamp(
    0.5 + Math.max(0, COMFORT_REFERENCE_TEMP - operativeTemp) * 0.09 * activityFactor,
    0,
    4.5,
  );
  const deficitClo = Math.max(0, requiredClo - availableClo);
  const risk = coldRisk(deficitClo);

  return {
    operativeTemp: round1(operativeTemp),
    requiredClo: round2(requiredClo),
    availableClo: round2(availableClo),
    deficitClo: round2(deficitClo),
    heatingLoadKw: round2(heatingLoadKw),
    risk,
    guidance: COLD_GUIDANCE[risk],
    actions: COLD_ACTIONS[risk],
    heatingRequired: risk === 'high' || risk === 'extreme',
  };
}

function coldRisk(deficitClo: number): StressRisk {
  if (deficitClo >= 1.5) return 'extreme';
  if (deficitClo >= 0.5) return 'high';
  if (deficitClo > 0) return 'moderate';
  return 'low';
}

const COLD_GUIDANCE: Record<StressRisk, string> = {
  low: 'Issued clothing is adequate for this condition.',
  moderate: 'Marginal — add a layer for static duties.',
  high: 'Cold-stress restriction — additional insulation or heating required.',
  extreme: 'Severe cold stress — active heating required; outdoor exposure must be limited.',
};

const COLD_ACTIONS: Record<StressRisk, string[]> = {
  low: [],
  moderate: ['Add an insulating layer for static duties', 'Provide a warm rest area'],
  high: [
    'Increase the issued clothing insulation',
    'Run the heating system',
    'Reduce static exposure time',
    'Seal the envelope against draughts',
  ],
  extreme: [
    'Run continuous heating',
    'Restrict outdoor exposure',
    'Provide an insulated rest area',
    'Re-check the envelope for leakage',
  ],
};

/* ------------------------------------------------------------------ */
/* Convenience: both assessments from one thermal result               */
/* ------------------------------------------------------------------ */

export interface StressAssessment {
  heat: HeatStressResult;
  cold: ColdStressResult;
  /** Which assessment is the binding one at this condition. */
  binding: 'heat' | 'cold' | 'comfort';
}

/**
 * Assess both extremes from the live thermal result.
 *
 * @param thermal the design's thermal result
 * @param activityMet the mission's metabolic rate
 * @param availableClo the clothing insulation the deployment provides
 */
export function assessStress(
  thermal: ThermalComfort,
  activityMet: number,
  availableClo: number,
): StressAssessment {
  /* The heat assessment uses the *warmest* free-running condition, the cold
     assessment the coldest — an annual mean would under-warn on both. */
  const peakIndoor = thermal.indoorTemperatureRange[1];
  const minIndoor = thermal.indoorTemperatureRange[0];
  const humidity = thermal.relativeHumidity;

  const heat = computeHeatStress(peakIndoor, humidity);
  const cold = computeColdStress(minIndoor, activityMet, availableClo, thermal.peakHeatingLoad);

  const binding: StressAssessment['binding'] =
    heat.risk === 'high' || heat.risk === 'extreme'
      ? 'heat'
      : cold.risk === 'high' || cold.risk === 'extreme'
        ? 'cold'
        : 'comfort';

  return { heat, cold, binding };
}

/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
