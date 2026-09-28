/**
 * Indoor moisture and condensation.
 *
 * WHY A SENSIBLE-HEAT MODEL IS NOT ENOUGH
 * The heat balance answers "how warm is it". It does not answer "will the inner
 * face of the envelope be wet", and for a deployed shelter those are different
 * questions with different answers. A warm-humid site, or a cold site with an
 * occupied shelter and a sealed envelope, fails on moisture long before it
 * fails on temperature: the occupants add latent load, the envelope's inner
 * surface runs cold, and the surface drops below the dew point.
 *
 * THE BALANCE
 *
 *     M · dW/dt  =  G_occupants + G_equipment + ṁ·(W_out − W_in) − G_condensation
 *
 * solved at steady state for the indoor humidity ratio:
 *
 *     W_in  =  W_out + G / ṁ
 *
 * where `G` is the latent moisture generation (kg/s) and `ṁ` the dry-air mass
 * flow from ventilation and infiltration (kg/s). A sealed shelter with a high
 * latent load therefore drives its own humidity up — which is exactly the
 * failure mode a "just seal it and insulate it" design walks into.
 *
 * WHAT THIS IS NOT
 * A single-zone steady-state moisture balance at one hour of a representative
 * day. It does not resolve the moisture stored in hygroscopic materials, the
 * drying of a wet envelope, or the condensation that happens *inside* a
 * build-up. Surface condensation is flagged from the surface temperature the
 * temperature model already computed, so the two cannot disagree.
 */

import type {
  BuildingParameters,
  ClimateData,
  ResolvedMaterials,
  ShelterGeometry,
} from '@/types';
import { AIR_DENSITY, LATENT_HEAT_VAPORISATION, pressureAtElevation } from '@/utils/units';
import {
  dewPoint,
  humidityRatio,
  relativeHumidityFromRatio,
  wetBulb,
} from '@/utils/psychrometrics';
import { computeSurfaceTemperature, type SurfaceKey } from './surfaceTemperature';
import { infiltrationAchFor } from './ventilation';

export type CondensationRisk = 'low' | 'medium' | 'high';

export interface SurfaceCondensation {
  key: SurfaceKey;
  label: string;
  surfaceTemp: number;
  /** Surface temperature minus the indoor dew point, K. Negative = condensing. */
  margin: number;
  risk: CondensationRisk;
}

export interface MoistureResult {
  month: number;
  hour: number;

  indoorTemp: number;
  indoorRh: number;
  indoorHumidityRatio: number;
  dewPoint: number;
  wetBulb: number;

  outdoorTemp: number;
  outdoorRh: number;
  outdoorHumidityRatio: number;

  /** Latent moisture generation inside the shelter, kg/h. */
  generationKgPerHour: number;
  /** Moisture carried out by ventilation and infiltration, kg/h. */
  ventilationKgPerHour: number;
  /** Moisture condensing on sub-dew-point surfaces, kg/h. */
  condensationKgPerHour: number;

  /** Total air exchange used by the balance, ACH. */
  airChangesPerHour: number;
  /** Dry-air mass flow, kg/s. */
  massFlowKgPerS: number;

  surfaces: SurfaceCondensation[];
  condensationSurfaces: SurfaceKey[];
  risk: CondensationRisk;

  pressurePa: number;
  summary: string;
}

export interface MoistureInputs {
  month: number;
  hour: number;
  indoorTemp: number;
  /** Total latent generation, W (occupants + equipment). */
  latentGainW: number;
  /** Air-change rate for the balance, ACH. Defaults to the design ACH. */
  airChangesPerHour?: number;
}

/**
 * Compute the indoor moisture state and the per-surface condensation risk.
 */
export function computeMoisture(
  climate: ClimateData,
  geometry: ShelterGeometry,
  materials: ResolvedMaterials,
  parameters: BuildingParameters,
  inputs: MoistureInputs,
): MoistureResult {
  const { month, hour, indoorTemp, latentGainW } = inputs;

  const pressurePa = pressureAtElevation(climate.location.elevation);
  const monthly = climate.monthly[month];

  const outdoorTemp = monthly?.avgTemp ?? climate.summary.avgTemperature;
  const outdoorRh = monthly?.humidity ?? climate.summary.humidity;

  const outdoorHumidityRatio = humidityRatio(outdoorTemp, outdoorRh, pressurePa);

  /* The air exchange the balance uses is the *total* the shelter actually
     experiences: the uncontrolled infiltration plus the intentional ventilation.
     Using only the design purge rate would understate the drying. */
  const ach = Math.max(
    0.05,
    inputs.airChangesPerHour ??
      parameters.airChangesPerHour ??
      infiltrationAchFor(parameters.infiltrationClass, parameters.infiltrationAch, 1),
  );

  const volume = Math.max(1, geometry.volume);
  const massFlowKgPerS = (volume * ach * AIR_DENSITY) / 3600;

  const generationKgPerS = Math.max(0, latentGainW) / LATENT_HEAT_VAPORISATION;

  /* Steady-state indoor humidity ratio. A very low air exchange drives W_in up,
     which is the sealed-shelter failure mode — the clamp keeps it below
     saturation rather than producing a nonsense ratio. */
  const saturationRatio = humidityRatio(indoorTemp, 100, pressurePa);
  const indoorHumidityRatio = Math.min(
    saturationRatio,
    Math.max(0, outdoorHumidityRatio + generationKgPerS / Math.max(1e-6, massFlowKgPerS)),
  );

  const indoorRh = relativeHumidityFromRatio(indoorTemp, indoorHumidityRatio, pressurePa);
  const dewPointC = dewPoint(indoorTemp, indoorRh);
  const wetBulbC = wetBulb(indoorTemp, indoorRh);

  /* Per-surface condensation, from the same surface temperatures the
     temperature map shows. */
  const surfaceMap = computeSurfaceTemperature(
    climate,
    geometry,
    materials,
    month,
    hour,
    indoorTemp,
    indoorRh,
  );

  const surfaces: SurfaceCondensation[] = Object.values(surfaceMap.detail).map((entry) => {
    /* The band is taken from the *rounded* margin, which is the number every
       legend and the inspector actually show. Deriving it from the unrounded
       value let a surface 0.04 K below the dew point display a margin of
       "0.0 K" while being labelled a high risk — the number and the verdict
       disagreeing on screen. Rounding first makes the invariant exact:
       `risk === 'high'` if and only if the displayed margin is negative. */
    const margin = Math.round((entry.surfaceTemp - dewPointC) * 10) / 10;
    return {
      key: entry.key,
      label: entry.label,
      surfaceTemp: entry.surfaceTemp,
      margin,
      risk: condensationRiskOf(margin),
    };
  });

  const condensationSurfaces = surfaces.filter((s) => s.margin < 0).map((s) => s.key);

  /* Condensation rate. A first-order film estimate: the driving potential is
     how far below the dew point the surface sits, and the rate scales with the
     condensing area. It is an order-of-magnitude figure, not a psychrometric
     solve — but it is monotone in the right direction, which is what a design
     comparison needs. */
  const CONDENSATION_COEFFICIENT = 0.02; // kg/h per m² per K below the dew point
  const condensationKgPerHour = surfaces.reduce((sum, surface) => {
    if (surface.margin >= 0) return sum;
    const area = surfaceMap.detail[surface.key]?.area ?? 0;
    return sum + area * CONDENSATION_COEFFICIENT * -surface.margin;
  }, 0);

  const ventilationKgPerHour = massFlowKgPerS * 3600 * Math.abs(indoorHumidityRatio - outdoorHumidityRatio);
  const generationKgPerHour = generationKgPerS * 3600;

  const risk: CondensationRisk =
    condensationSurfaces.length === 0
      ? 'low'
      : condensationSurfaces.length <= 2
        ? 'medium'
        : 'high';

  const summary =
    `Indoor ${indoorTemp.toFixed(1)} °C at ${indoorRh.toFixed(0)} % RH, dew point ` +
    `${dewPointC.toFixed(1)} °C against an outdoor ${outdoorTemp.toFixed(1)} °C at ` +
    `${outdoorRh.toFixed(0)} % RH. ` +
    (condensationSurfaces.length === 0
      ? `No surface falls below the dew point at ${ach.toFixed(1)} ACH.`
      : `${condensationSurfaces.length} surface${condensationSurfaces.length === 1 ? '' : 's'} below the dew point — condensation risk is ${risk}.`);

  return {
    month,
    hour,
    indoorTemp: round1(indoorTemp),
    indoorRh: round1(indoorRh),
    indoorHumidityRatio: round4(indoorHumidityRatio),
    dewPoint: round1(dewPointC),
    wetBulb: round1(wetBulbC),
    outdoorTemp: round1(outdoorTemp),
    outdoorRh: round1(outdoorRh),
    outdoorHumidityRatio: round4(outdoorHumidityRatio),
    generationKgPerHour: round3(generationKgPerHour),
    ventilationKgPerHour: round3(ventilationKgPerHour),
    condensationKgPerHour: round3(condensationKgPerHour),
    airChangesPerHour: round1(ach),
    massFlowKgPerS: round4(massFlowKgPerS),
    surfaces,
    condensationSurfaces,
    risk,
    pressurePa: Math.round(pressurePa),
    summary,
  };
}

/** Risk band from the margin between a surface and the dew point, K. */
export function condensationRiskOf(marginK: number): CondensationRisk {
  if (marginK < 0) return 'high';
  if (marginK < 2) return 'medium';
  return 'low';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
