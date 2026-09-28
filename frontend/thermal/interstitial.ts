/**
 * Interstitial condensation — the Glaser check.
 *
 * WHY THIS IS NEEDED ON TOP OF THE SURFACE CHECK
 * The moisture engine answers "will the *inner face* be wet". That is the wrong
 * question for a cold-climate shelter, and dangerously so. A high-altitude tent
 * or an insulated cabin in a Leh winter is warm and moist inside and very cold
 * outside, and the water vapour in the air does not stop at the inner face: it
 * diffuses outward through the build-up until it reaches a plane where the
 * temperature has fallen below its dew point, and it condenses *there* — inside
 * the wall, out of sight, where it soaks the insulation and rots the structure.
 * A wall can be bone dry on both faces and still be rotting in the middle.
 *
 * THE METHOD
 * The Glaser method builds two profiles through the stack and compares them:
 *
 *   1. a TEMPERATURE profile, from the layer resistances, which fixes the
 *      saturation vapour pressure at every interface; and
 *   2. a VAPOUR PRESSURE profile, from the layer vapour resistances, which is
 *      what the moisture actually does.
 *
 * Where the vapour pressure rises above the saturation pressure, the excess
 * condenses. That is the whole check, and it is why the vapour resistance of
 * every layer is a required field: the answer is decided by the *ratio* of
 * resistances across the stack, so a single guessed value can invent a
 * condensation plane or hide a real one.
 *
 * WHAT THIS IS NOT
 * Glaser is a steady-state, one-dimensional check. It assumes the vapour
 * pressure profile is a straight line between the boundaries, it does not model
 * the moisture stored in hygroscopic materials, it does not model the drying of
 * a wet layer, and it takes no credit for a layer's ability to redistribute
 * condensate. It is deliberately the *conservative* first check a designer runs,
 * not a hygrothermal simulation. The limitations are reported alongside the
 * result rather than buried here.
 */

import type { MaterialLayer } from '@/types';
import { saturationVapourPressure, vapourPressure } from '@/utils/psychrometrics';

/**
 * Water-vapour permeability of still air, kg/(m·s·Pa).
 *
 * The constant that converts a dimensionless μ into an actual vapour diffusion
 * resistance: Sd = μ·d gives metres of equivalent air layer, and dividing by
 * this gives the resistance in m²·s·Pa/kg that the fluxes are computed from.
 */
export const VAPOUR_PERMEABILITY_AIR = 2.0e-10;

/**
 * Internal and external surface vapour resistances, m·s·Pa/kg equivalent — i.e.
 * an Sd of zero.
 *
 * Standard Glaser practice treats the boundary films as negligible next to the
 * build-up, and this model follows it. The *thermal* films are not negligible
 * and are applied (see `surfaceFilmResistance`), because they move the
 * temperature at the inner face and therefore the saturation pressure there.
 */
const SD_SURFACE = 0;

export interface InterstitialInputs {
  month: number;
  /** Indoor air temperature, °C. */
  indoorTemp: number;
  /** Indoor relative humidity, %. */
  indoorRh: number;
  /** Outdoor air temperature, °C. */
  outdoorTemp: number;
  /** Outdoor relative humidity, %. */
  outdoorRh: number;
  /** Surface film resistances, m²·K/W. Defaults are the ISO 6946 values. */
  internalSurfaceResistance?: number;
  externalSurfaceResistance?: number;
}

/** One plane in the build-up, counted from the outside in. */
export interface InterstitialPlane {
  /** 0 is the outer surface; `layers.length` is the inner surface. */
  index: number;
  /** What this plane is: the face of a named layer. */
  label: string;
  /** Depth from the outer surface, m. */
  depth: number;
  /** Temperature at this plane, °C. */
  temperature: number;
  /** Saturation vapour pressure at that temperature, Pa. */
  saturationPa: number;
  /** Actual vapour pressure at this plane, Pa. */
  vapourPa: number;
  /** `vapourPa − saturationPa`, Pa. Negative is safe; positive condenses. */
  marginPa: number;
  /** Cumulative vapour diffusion resistance from the inside, m (as Sd). */
  sdFromInside: number;
  condensing: boolean;
}

export type InterstitialRisk = 'none' | 'moderate' | 'severe';

export interface InterstitialResult {
  /** False when the envelope has no layer stack to walk. */
  applicable: boolean;
  /** Why it is not applicable, when it is not. */
  reason?: string;
  month: number;

  indoorVapourPa: number;
  outdoorVapourPa: number;

  planes: InterstitialPlane[];
  /** The plane that matters: the worst condensing one, else the tightest. */
  critical: InterstitialPlane | null;
  condensing: boolean;
  /** How many planes sit above their saturation pressure. */
  condensingPlaneCount: number;
  /** The plane condensation forms on, named, or null. */
  condensationAt: string | null;
  /** Depth of that plane from the outer surface, m. */
  condensationDepth: number | null;
  /** Condensation rate, g/m²/day. Zero when nothing condenses. */
  condensationGPerM2Day: number;
  risk: InterstitialRisk;

  /** Total vapour diffusion resistance of the build-up, m (as Sd). */
  totalSd: number;
  /** The layer contributing most of the vapour resistance, by name. */
  vapourBarrierLayer: string | null;
  /**
   * True when the vapour-tight layer sits on the *cold* side of the insulation.
   *
   * This is the classic design error and the reason the check exists: a barrier
   * outboard of the insulation traps moisture inside the cold part of the
   * build-up, so it cannot dry inwards.
   */
  barrierOnColdSide: boolean;

  summary: string;
}

/**
 * Run the Glaser check over a layer stack (outside → inside).
 *
 * Returns `applicable: false` rather than a fabricated profile when there is no
 * stack to walk, so a single-material envelope reports that the check could not
 * be run instead of silently reporting "no condensation".
 */
export function computeInterstitial(
  layers: readonly MaterialLayer[] | undefined,
  inputs: InterstitialInputs,
): InterstitialResult {
  const empty = (
    reason: string,
  ): InterstitialResult => ({
    applicable: false,
    reason,
    month: inputs.month,
    indoorVapourPa: 0,
    outdoorVapourPa: 0,
    planes: [],
    critical: null,
    condensing: false,
    condensingPlaneCount: 0,
    condensationAt: null,
    condensationDepth: null,
    condensationGPerM2Day: 0,
    risk: 'none',
    totalSd: 0,
    vapourBarrierLayer: null,
    barrierOnColdSide: false,
    summary: reason,
  });

  if (!layers || layers.length === 0) {
    return empty(
      'Interstitial condensation needs a layered build-up to walk. This envelope is a single material, so the check was not run.',
    );
  }

  const {
    month,
    indoorTemp,
    indoorRh,
    outdoorTemp,
    outdoorRh,
    internalSurfaceResistance = 0.13,
    externalSurfaceResistance = 0.04,
  } = inputs;

  const count = layers.length;

  /* --- Boundary vapour pressures, Pa. --- */
  const indoorVapourPa = vapourPressure(indoorTemp, indoorRh);
  const outdoorVapourPa = vapourPressure(outdoorTemp, outdoorRh);

  /* --- Thermal resistances. --- */
  const layerResistance = layers.map((l) => l.thickness / Math.max(1e-4, l.conductivity));
  const totalLayerResistance = layerResistance.reduce((sum, r) => sum + r, 0);
  const totalResistance =
    totalLayerResistance + internalSurfaceResistance + externalSurfaceResistance;

  /* --- Vapour diffusion resistances, Sd = μ·d, metres. --- */
  const layerSd = layers.map((l) => Math.max(0, l.vapourResistivity) * l.thickness);
  const totalSd = layerSd.reduce((sum, sd) => sum + sd, 0);

  /* --- Build the planes, walking from the OUTSIDE in. --- */
  const planes: InterstitialPlane[] = [];

  let depth = 0;
  for (let index = 0; index <= count; index += 1) {
    if (index > 0) depth += layers[index - 1]!.thickness;

    /* Resistance from the *inside* to this plane: cross the internal film, then
       every layer inboard of the plane (indices `index` .. `count - 1`). */
    let resistanceFromInside = internalSurfaceResistance;
    for (let j = index; j < count; j += 1) resistanceFromInside += layerResistance[j]!;

    const temperature =
      totalResistance > 0
        ? indoorTemp - ((indoorTemp - outdoorTemp) * resistanceFromInside) / totalResistance
        : indoorTemp;

    /* The same walk for vapour: the resistance from the inside to this plane. */
    let sdFromInside = SD_SURFACE;
    for (let j = index; j < count; j += 1) sdFromInside += layerSd[j]!;

    const vapour =
      totalSd > 0
        ? indoorVapourPa - ((indoorVapourPa - outdoorVapourPa) * sdFromInside) / totalSd
        : indoorVapourPa;

    const saturation = saturationVapourPressure(temperature);
    const margin = vapour - saturation;

    planes.push({
      index,
      label: planeLabel(layers, index),
      depth: round(depth, 4),
      temperature: round(temperature, 2),
      saturationPa: Math.round(saturation),
      vapourPa: Math.round(vapour),
      marginPa: Math.round(margin),
      sdFromInside: round(sdFromInside, 3),
      condensing: margin > 0,
    });
  }

  /* --- Which plane matters. ---
     Two different questions, and conflating them was a bug in an earlier
     version of this file: the *critical* plane is the worst one, but the
     *condensing* condition is whether ANY plane is above saturation. A build-up
     can have a plane at +1000 Pa and another at −650 Pa, in which case the
     worst margin is negative while condensation is still happening.

     When anything condenses, the plane that matters is the one with the
     greatest excess — that is where the condensate accumulates. When nothing
     does, the plane that matters is the smallest margin, i.e. the one closest
     to failing. */
  const condensingPlanes = planes.filter((plane) => plane.condensing);
  const condensing = condensingPlanes.length > 0;

  const critical = condensing
    ? condensingPlanes.reduce((worst, plane) => (plane.marginPa > worst.marginPa ? plane : worst))
    : planes.reduce<InterstitialPlane | null>(
        (worst, plane) => (worst === null || plane.marginPa < worst.marginPa ? plane : worst),
        null,
      );

  /* --- Condensation rate at the critical plane, g/m²/day. ---
     Vapour arrives from the inside at the rate the pressure difference and the
     inboard resistance allow, and leaves outward at the rate the outboard
     resistance allows. What cannot leave accumulates. */
  let condensationGPerM2Day = 0;
  if (condensing && critical) {
    const sdIn = Math.max(1e-6, critical.sdFromInside);
    const sdOut = Math.max(1e-6, totalSd - critical.sdFromInside);
    const zIn = sdIn / VAPOUR_PERMEABILITY_AIR;
    const zOut = sdOut / VAPOUR_PERMEABILITY_AIR;

    const pSat = critical.saturationPa;
    const fluxIn = Math.max(0, (indoorVapourPa - pSat) / zIn);
    const fluxOut = Math.max(0, (pSat - outdoorVapourPa) / zOut);
    const netKgPerM2S = Math.max(0, fluxIn - fluxOut);
    condensationGPerM2Day = round(netKgPerM2S * 1000 * 86400, 3);
  }

  /* --- Which layer holds most of the vapour resistance. --- */
  let barrierIndex = -1;
  let barrierSd = 0;
  layerSd.forEach((sd, index) => {
    if (sd > barrierSd) {
      barrierSd = sd;
      barrierIndex = index;
    }
  });
  const vapourBarrierLayer = barrierIndex >= 0 ? layers[barrierIndex]!.name : null;

  /* --- Is the barrier on the cold side? ---
     The plane at the barrier's mid-depth tells us which half of the build-up it
     sits in. A barrier outboard of the insulation is the error that traps
     moisture where it cannot dry inward. */
  let barrierOnColdSide = false;
  if (barrierIndex >= 0 && count > 1) {
    barrierOnColdSide = barrierIndex < count / 2;
  }

  const risk: InterstitialRisk = !condensing
    ? 'none'
    : condensationGPerM2Day > 0.5
      ? 'severe'
      : 'moderate';

  const summary = condensing
    ? `Condensation forms at the ${critical?.label} (${critical?.depth} m from the outer face), ` +
      `where the build-up reaches ${critical?.temperature} °C against a dew point set by ` +
      `${indoorTemp.toFixed(0)} °C at ${indoorRh.toFixed(0)} % RH. ` +
      `Accumulation is about ${condensationGPerM2Day.toFixed(2)} g/m²/day.` +
      (barrierOnColdSide
        ? ` The vapour-tight layer (${vapourBarrierLayer}) sits on the cold side of the build-up, so the condensate cannot dry inward.`
        : '')
    : `No plane falls below its saturation pressure. The tightest plane is the ${critical?.label}, ` +
      `with ${Math.abs(critical?.marginPa ?? 0)} Pa to spare at ${critical?.temperature} °C.`;

  return {
    applicable: true,
    month,
    indoorVapourPa: Math.round(indoorVapourPa),
    outdoorVapourPa: Math.round(outdoorVapourPa),
    planes,
    critical,
    condensing,
    condensingPlaneCount: condensingPlanes.length,
    condensationAt: condensing ? (critical?.label ?? null) : null,
    condensationDepth: condensing ? (critical?.depth ?? null) : null,
    condensationGPerM2Day,
    risk,
    totalSd: round(totalSd, 3),
    vapourBarrierLayer,
    barrierOnColdSide,
    summary,
  };
}

/** Name the plane at `index`, counted from the outside. */
function planeLabel(layers: readonly MaterialLayer[], index: number): string {
  if (index === 0) return `Outer surface of ${layers[0]!.name}`;
  if (index === layers.length) return `Inner surface of ${layers[index - 1]!.name}`;
  return `Between ${layers[index - 1]!.name} and ${layers[index]!.name}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
