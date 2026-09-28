/**
 * Colour scales for the 3D overlays.
 *
 * A cold-to-hot ramp would normally run blue → red, and that is what this file
 * used to do. It does not any more: the palette excludes blue, so cold is
 * carried by a desaturated sage and the ramp warms through sand and amber into
 * rust. The progression still reads as cool → hot — it is the same lightness
 * and chroma arc — but it stays inside the earthy family the rest of the
 * interface is built from, so a heat-mapped model looks like part of the page
 * rather than like a stock chart pasted onto it.
 *
 * The scale is kept in one place so the 3D overlay, the legend and the charts
 * cannot disagree about what "orange" means.
 */

import * as THREE from 'three';

/** Six-stop thermal ramp, cool to hot. Mirrors `--thermal-0..5` in globals.css. */
export const THERMAL_RAMP = [
  '#6b7f6a', // 0 — sage
  '#8fa07a', // 1 — olive
  '#c9b267', // 2 — sand
  '#e0a03c', // 3 — amber
  '#d2701f', // 4 — orange
  '#a8391a', // 5 — rust
] as const;

/** Labels for the ramp, used by the legend. */
export const THERMAL_LABELS = ['Cold', 'Cool', 'Neutral', 'Warm', 'Hot', 'Very hot'] as const;

/** Solar irradiation ramp — deep warm ink through to bright warm white. */
export const SOLAR_RAMP = [
  '#3F3833',
  '#7A6A55',
  '#B08A4A',
  '#D9A441',
  '#F0C64E',
  '#FBE9A8',
] as const;

/** Ventilation ramp — still air through to strong flow, in the green family. */
export const AIRFLOW_RAMP = ['#E8E2D9', '#B8AEA4', '#8A9A87', '#4E6B58'] as const;

/** Sample any ramp at t ∈ [0, 1]. */
export function sampleRamp(ramp: readonly string[], t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const a = new THREE.Color(ramp[index]!);
  const b = new THREE.Color(ramp[index + 1]!);
  return a.lerp(b, fraction);
}

/** Thermal colour for t ∈ [0, 1]. */
export function thermalColor(t: number): THREE.Color {
  return sampleRamp(THERMAL_RAMP, t);
}

/**
 * Map a physical value onto a ramp, given a display range.
 *
 * The range is passed in rather than derived from the data so the legend and the
 * surfaces always agree — an auto-ranging scale that silently rescales between
 * renders makes two screenshots of the same design look different.
 */
export function valueToColor(
  value: number,
  min: number,
  max: number,
  ramp: readonly string[] = THERMAL_RAMP,
): THREE.Color {
  const span = max - min;
  const t = span > 1e-9 ? (value - min) / span : 0.5;
  return sampleRamp(ramp, t);
}

/** CSS colour for the legend, matching `valueToColor`. */
export function rampCssGradient(ramp: readonly string[] = THERMAL_RAMP, steps = 12): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    stops.push(`${sampleRamp(ramp, t).getStyle()} ${(t * 100).toFixed(0)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Daylight sky/fog tint, warm at dawn through to cool at noon. */
export function skyColorForSun(altitudeDeg: number): THREE.Color {
  if (altitudeDeg <= 0) return new THREE.Color('#1C1610');
  const t = Math.min(1, altitudeDeg / 60);
  return new THREE.Color('#f9a03f').lerp(new THREE.Color('#F5E3C0'), t);
}
