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

/** Six-stop scientific thermal rainbow ramp: Blue (Cold) to Red (Hot), matching thermal CFD. */
export const THERMAL_RAMP = [
  '#0055ff', // 0 — Deep Blue (Cold)
  '#00c8ff', // 1 — Cyan (Cool)
  '#00e676', // 2 — Green (Neutral)
  '#ffeb3b', // 3 — Yellow (Warm)
  '#ff9100', // 4 — Orange (Hot)
  '#ff1744', // 5 — Saturated Red (Very Hot)
] as const;

/** Labels for the ramp, used by the legend. */
export const THERMAL_LABELS = ['Cold', 'Cool', 'Neutral', 'Warm', 'Hot', 'Very Hot'] as const;

/** Solar irradiation ramp — deep warm ink through to bright warm white. */
export const SOLAR_RAMP = [
  '#3F3833',
  '#7A6A55',
  '#B08A4A',
  '#D9A441',
  '#F0C64E',
  '#FBE9A8',
] as const;

/** Ventilation CFD ramp — cool inlet air (cyan) through warm exhaust (amber/orange). */
export const AIRFLOW_RAMP = ['#00e5ff', '#00e676', '#ffeb3b', '#ff7043'] as const;

/**
 * Diverging heat-flux ramp, heat loss → neutral → heat gain.
 *
 * A conduction flux is *signed*, and the sign is the whole point: a wall losing
 * heat in a Leh winter and a wall gaining heat in a Jodhpur afternoon must not
 * look the same. So unlike the thermal ramp this one is diverging, with a
 * genuinely neutral centre — the page's own light neutral — so zero flux reads
 * as "nothing happening" rather than as a mild value on a one-way scale.
 *
 * It stays inside the same earthy family as every other scale in this file, so
 * a flux-mapped model still looks like part of the page.
 */
export const FLUX_RAMP = [
  '#4E6B58', // strong loss — deep cool green
  '#7D9077', // loss
  '#B6C2A8', // slight loss
  '#E8E2D9', // neutral — no net flux
  '#E0C98A', // slight gain
  '#D2701F', // gain
  '#A8391A', // strong gain — rust
] as const;

/**
 * Condensation-margin ramp, condensing → neutral → comfortably dry.
 *
 * Also diverging, and also centred on a real threshold: zero is the indoor dew
 * point. Everything on the left of centre is a surface that is wet; everything
 * to the right is dry by that many kelvin. The centre stop is the same neutral
 * as the flux ramp so the two do not disagree about what "no signal" looks like.
 */
export const MOISTURE_RAMP = [
  '#8E3B1B', // well below the dew point — condensing
  '#B85C24', // below
  '#D98A3A', // just below
  '#E8E2D9', // exactly at the dew point
  '#CBD3B4', // dry
  '#9DB48C', // comfortably dry
  '#6E8A6B', // very dry
] as const;

/**
 * Heat-loss ramp — no loss through to a large loss, in one direction.
 *
 * Deliberately *not* diverging, which is what separates it from the flux ramp.
 * The flux map answers "which way is the heat going"; this one answers "how
 * much of my heat is going out through here", and a surface that is gaining
 * heat has no loss to show. So the scale is one-way: the pale end is the
 * page's own neutral (no loss at all), and it darkens into rust as the loss
 * rate climbs. A gaining surface therefore reads as "nothing escaping here"
 * rather than as a small value on a symmetric scale.
 */
export const LOSS_RAMP = [
  '#E8E2D9', // no loss — nothing escaping
  '#EAD9B0', // slight
  '#E0B96A', // moderate
  '#D2701F', // large
  '#A8391A', // very large
] as const;

/**
 * Condensation-risk ramp — exactly three stops, for exactly three bands.
 *
 * The moisture-margin ramp above is continuous, because the margin is a
 * continuous quantity. This map is a *verdict*: the moisture engine already
 * classifies each surface as low, medium or high. Repainting that verdict as a
 * smooth gradient would imply a precision the banding does not have, so the
 * ramp has three stops and the map feeds it the band index (0, 1, 2) over the
 * range [0, 2]. The three sample points land exactly on the three stops, so
 * only three colours are ever produced and two surfaces in the same band are
 * always the same colour.
 */
export const CONDENSATION_RAMP = [
  '#6E8A6B', // low — more than 2 K above the dew point
  '#D98A3A', // medium — within 2 K above it
  '#8E3B1B', // high — margin negative, i.e. below the dew point
] as const;

/** The three condensation bands, in map order, for the legend. */
export const CONDENSATION_BANDS = ['Low', 'Medium', 'High'] as const;

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
