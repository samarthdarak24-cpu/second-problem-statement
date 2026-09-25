/**
 * Thermal comfort: ISO 7730 PMV/PPD, plus ASHRAE 55 adaptive comfort.
 *
 * PMV (Predicted Mean Vote) is solved from the full ISO 7730 heat-balance
 * equation, with the clothing surface temperature found by fixed-point
 * iteration and the convective coefficient updated each pass. PPD follows from
 * the standard PMV–PPD relation.
 *
 * The adaptive comfort model is the appropriate yardstick for a naturally
 * ventilated shelter, so it is reported alongside PMV rather than replacing it.
 */

import type { ComfortBand, PmvInputs, PmvResult } from '@/types';
import { STEFAN_BOLTZMANN, cloToM2KW, metToWm2 } from '@/utils/units';
import { saturationVapourPressure } from '@/utils/psychrometrics';
import { clamp } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* PMV / PPD                                                           */
/* ------------------------------------------------------------------ */

/**
 * Clothing area factor f_cl — the ratio of clothed to nude surface area.
 */
export function clothingAreaFactor(clothingInsulation: number): number {
  return clothingInsulation <= 0.078
    ? 1 + 1.29 * clothingInsulation
    : 1.05 + 0.645 * clothingInsulation;
}

/**
 * Convective heat transfer coefficient, W/m²·K — the greater of the natural and
 * forced convection terms, per ISO 7730.
 */
function convectiveCoefficient(
  clothingTemp: number,
  airTemp: number,
  airVelocity: number,
): number {
  const natural = 2.38 * Math.abs(clothingTemp - airTemp) ** 0.25;
  const forced = 12.1 * Math.sqrt(Math.max(0, airVelocity));
  return Math.max(natural, forced);
}

/**
 * Solve the clothing surface temperature by fixed-point iteration.
 *
 * The equation is implicit because both the radiative and convective terms
 * depend on T_cl. Iterating from T_cl = T_a converges monotonically for the
 * physically meaningful range.
 */
function solveClothingTemperature(
  inputs: PmvInputs,
  clothingArea: number,
): { clothingTemp: number; coefficient: number } {
  const { metabolicRate, externalWork, clothingInsulation, airTemperature, meanRadiantTemperature, airVelocity } = inputs;

  const activity = metabolicRate - externalWork;
  const trK = meanRadiantTemperature + 273.15;

  let clothingTemp = airTemperature;
  let coefficient = convectiveCoefficient(clothingTemp, airTemperature, airVelocity);

  for (let iteration = 0; iteration < 200; iteration += 1) {
    coefficient = convectiveCoefficient(clothingTemp, airTemperature, airVelocity);
    const clothingK = clothingTemp + 273.15;

    const radiative = 3.96e-8 * clothingArea * (clothingK ** 4 - trK ** 4);
    const convective = clothingArea * coefficient * (clothingTemp - airTemperature);

    const next = 35.7 - 0.028 * activity - clothingInsulation * (radiative + convective);

    if (Math.abs(next - clothingTemp) < 1e-6) {
      clothingTemp = next;
      break;
    }
    // Damped update keeps the iteration stable in extreme conditions.
    clothingTemp = clothingTemp + 0.6 * (next - clothingTemp);
  }

  return { clothingTemp, coefficient };
}

/**
 * Calculate PMV and PPD for a set of conditions.
 */
export function calculatePmv(inputs: PmvInputs): PmvResult {
  const {
    metabolicRate,
    externalWork,
    clothingInsulation,
    airTemperature,
    meanRadiantTemperature,
    relativeHumidity,
  } = inputs;

  const clothingArea = clothingAreaFactor(clothingInsulation);
  const vapourPressure =
    (clamp(relativeHumidity, 0, 100) / 100) * saturationVapourPressure(airTemperature);

  const { clothingTemp, coefficient } = solveClothingTemperature(inputs, clothingArea);

  const activity = metabolicRate - externalWork;
  const clothingK = clothingTemp + 273.15;
  const trK = meanRadiantTemperature + 273.15;

  const radiativeLoss = 3.96e-8 * clothingArea * (clothingK ** 4 - trK ** 4);
  const convectiveLoss = clothingArea * coefficient * (clothingTemp - airTemperature);

  // Respiratory and skin diffusion / sweat losses.
  const skinDiffusion = 3.05e-3 * (5733 - 6.99 * activity - vapourPressure);
  const sweatLoss = 0.42 * (activity - 58.15);
  const latentRespiration = 1.7e-5 * metabolicRate * (5867 - vapourPressure);
  const dryRespiration = 0.0014 * metabolicRate * (34 - airTemperature);

  const heatBalance =
    activity - skinDiffusion - sweatLoss - latentRespiration - dryRespiration - radiativeLoss - convectiveLoss;

  const pmv = (0.303 * Math.exp(-0.036 * metabolicRate) + 0.028) * heatBalance;
  const clampedPmv = clamp(pmv, -5, 5);
  const ppd = ppdFromPmv(clampedPmv);

  return {
    pmv: clampedPmv,
    ppd,
    clothingSurfaceTemp: clothingTemp,
    convectiveCoefficient: coefficient,
    clothingAreaFactor: clothingArea,
    vapourPressure,
    sensation: sensationFor(clampedPmv),
  };
}

/**
 * PPD from PMV — the ISO 7730 relation.
 */
export function ppdFromPmv(pmv: number): number {
  const p = clamp(pmv, -5, 5);
  return clamp(100 - 95 * Math.exp(-(0.03353 * p ** 4 + 0.2179 * p ** 2)), 0, 100);
}

/** Verbal sensation label for a PMV value. */
export function sensationFor(pmv: number): string {
  if (pmv < -3) return 'Very cold';
  if (pmv < -2) return 'Cold';
  if (pmv < -1) return 'Slightly cool';
  if (pmv < -0.5) return 'Cool';
  if (pmv <= 0.5) return 'Neutral';
  if (pmv <= 1) return 'Slightly warm';
  if (pmv <= 2) return 'Warm';
  if (pmv <= 3) return 'Hot';
  return 'Very hot';
}

/**
 * Map PMV/PPD onto a 0–100 comfort score.
 *
 * PPD is the primary driver — it is the ISO-defined measure of dissatisfaction —
 * with a small additional penalty for being far from neutral, so that a design
 * which is uniformly "slightly warm" scores below one that sits at neutral.
 */
export function pmvToComfortScore(pmv: number, ppd: number): number {
  const dissatisfaction = clamp(ppd, 0, 100) / 100;
  const base = 100 * (1 - dissatisfaction ** 0.7);
  const driftPenalty = Math.min(12, Math.abs(pmv) * 3);
  return clamp(base - driftPenalty, 0, 100);
}

/* ------------------------------------------------------------------ */
/* Adaptive comfort (ASHRAE 55)                                        */
/* ------------------------------------------------------------------ */

/**
 * Neutral (preferred) indoor operative temperature for a naturally ventilated
 * space, from the prevailing mean outdoor temperature.
 */
export function adaptiveComfortTemperature(prevailingMeanOutdoorTemp: number): number {
  return 0.31 * prevailingMeanOutdoorTemp + 17.8;
}

/**
 * Acceptable operative temperature band around the adaptive neutral temperature.
 *
 * @param acceptability 0.9 for 90 % acceptability (±2.5 K), 0.8 for 80 % (±3.5 K)
 */
export function adaptiveComfortBand(
  prevailingMeanOutdoorTemp: number,
  acceptability: 0.8 | 0.9 = 0.9,
): ComfortBand {
  const neutral = adaptiveComfortTemperature(prevailingMeanOutdoorTemp);
  const halfWidth = acceptability === 0.9 ? 2.5 : 3.5;
  return {
    neutral,
    lower: neutral - halfWidth,
    upper: neutral + halfWidth,
  };
}

/** Exponentially weighted running mean of outdoor temperature, °C. */
export function runningMeanTemperature(
  currentMean: number,
  previousRunningMean: number,
  alpha = 0.8,
): number {
  return (1 - alpha) * currentMean + alpha * previousRunningMean;
}

/* ------------------------------------------------------------------ */
/* Adaptive clothing and air velocity                                  */
/* ------------------------------------------------------------------ */

/**
 * Clothing insulation occupants are likely to wear at a given outdoor
 * temperature, in clo. Behavioural adaptation is real and ignoring it makes a
 * warm-climate design look worse than it is.
 */
export function clothingForOutdoorTemp(outdoorTemp: number): number {
  return clamp(1.0 - 0.025 * (outdoorTemp - 5), 0.4, 1.0);
}

/** Convert clo to m²·K/W. */
export function clothingToSi(clo: number): number {
  return cloToM2KW(clo);
}

/**
 * Indoor air speed produced by a given air-change rate, m/s.
 * Roughly 0.06 m/s per air change, on top of a 0.1 m/s still-air baseline.
 */
export function indoorAirVelocity(airChangesPerHour: number): number {
  return clamp(0.1 + 0.06 * airChangesPerHour, 0.1, 1.4);
}

/** Metabolic rate for a named activity, W/m². */
export const METABOLIC_RATES = {
  resting: metToWm2(0.8),
  seated: metToWm2(1.0),
  lightActivity: metToWm2(1.2),
  standing: metToWm2(1.4),
  moderate: metToWm2(1.6),
} as const;

/** Build a PMV input set for a naturally ventilated shelter. */
export function shelterPmvInputs(options: {
  airTemperature: number;
  meanRadiantTemperature: number;
  relativeHumidity: number;
  airChangesPerHour: number;
  outdoorTemperature: number;
  metabolicRate?: number;
}): PmvInputs {
  return {
    metabolicRate: options.metabolicRate ?? METABOLIC_RATES.lightActivity,
    externalWork: 0,
    clothingInsulation: clothingToSi(clothingForOutdoorTemp(options.outdoorTemperature)),
    airTemperature: options.airTemperature,
    meanRadiantTemperature: options.meanRadiantTemperature,
    airVelocity: indoorAirVelocity(options.airChangesPerHour),
    relativeHumidity: options.relativeHumidity,
  };
}

/**
 * Radiant temperature asymmetry check: a hot roof or unshaded west window can
 * leave occupants uncomfortable even when the air temperature is acceptable.
 * Returns the mean radiant temperature seen by a person at the room centre.
 */
export function estimateMeanRadiantTemperature(options: {
  airTemperature: number;
  roofSurfaceTemp: number;
  wallSurfaceTemp: number;
  floorTemperature: number;
  glazingSurfaceTemp: number;
  glazingFraction: number;
}): number {
  const glazing = clamp(options.glazingFraction, 0, 0.6);
  const opaque = 1 - glazing;
  // A seated person sees roughly: 40 % walls, 25 % roof, 20 % floor, 15 % glass
  // — renormalised by how much glazing actually exists.
  const wallView = opaque * 0.45;
  const roofView = opaque * 0.3;
  const floorView = opaque * 0.25;
  const glassView = glazing;

  return (
    wallView * options.wallSurfaceTemp +
    roofView * options.roofSurfaceTemp +
    floorView * options.floorTemperature +
    glassView * options.glazingSurfaceTemp
  );
}

/** Stefan–Boltzmann radiative exchange with the sky, W/m². */
export function skyRadiationLoss(
  surfaceTemp: number,
  skyTemp: number,
  emissivity = 0.9,
): number {
  return (
    emissivity *
    STEFAN_BOLTZMANN *
    ((surfaceTemp + 273.15) ** 4 - (skyTemp + 273.15) ** 4)
  );
}
