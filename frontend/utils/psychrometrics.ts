/**
 * Psychrometric relations — moist-air properties at atmospheric pressure.
 *
 * Sources: ASHRAE Handbook of Fundamentals (Magnus-form saturation pressure,
 * humidity ratio, enthalpy); Stull (2011) for the wet-bulb approximation.
 *
 * The wet-bulb relation assumes near-sea-level pressure; for high-altitude
 * sites (e.g. Leh at ~3500 m) the result is an approximation, which is noted in
 * the UI provenance text.
 */

import { CP_AIR, CP_VAPOUR, LATENT_HEAT_VAPORISATION, STANDARD_PRESSURE } from './units';

/** Saturation vapour pressure over water, Pa. Magnus/Tetens form. */
export function saturationVapourPressure(tempC: number): number {
  return 610.94 * Math.exp((17.625 * tempC) / (tempC + 243.04));
}

/** Saturation humidity ratio, kg water / kg dry air. */
export function saturationHumidityRatio(tempC: number, pressurePa: number): number {
  const pws = saturationVapourPressure(tempC);
  return (0.621945 * pws) / (pressurePa - pws);
}

/** Partial pressure of water vapour from dry-bulb and relative humidity, Pa. */
export function vapourPressure(tempC: number, relativeHumidityPct: number): number {
  return (relativeHumidityPct / 100) * saturationVapourPressure(tempC);
}

/** Humidity ratio from dry-bulb and relative humidity, kg/kg. */
export function humidityRatio(
  tempC: number,
  relativeHumidityPct: number,
  pressurePa: number = STANDARD_PRESSURE,
): number {
  const pw = vapourPressure(tempC, relativeHumidityPct);
  const p = Math.max(pressurePa, pw + 1);
  return (0.621945 * pw) / (p - pw);
}

/** Relative humidity (%) from dry-bulb and humidity ratio. */
export function relativeHumidityFromRatio(
  tempC: number,
  ratio: number,
  pressurePa: number = STANDARD_PRESSURE,
): number {
  const pw = (ratio * pressurePa) / (0.621945 + ratio);
  const pws = saturationVapourPressure(tempC);
  return Math.min(100, Math.max(0, (pw / pws) * 100));
}

/** Dew-point temperature, °C (Magnus inverse). */
export function dewPoint(tempC: number, relativeHumidityPct: number): number {
  const rh = Math.min(100, Math.max(0.01, relativeHumidityPct));
  const alpha = Math.log(rh / 100) + (17.625 * tempC) / (243.04 + tempC);
  return (243.04 * alpha) / (17.625 - alpha);
}

/**
 * Wet-bulb temperature, °C — Stull (2011) empirical fit.
 * Accurate to ~±0.3 K for the 1013 hPa surface.
 */
export function wetBulb(tempC: number, relativeHumidityPct: number): number {
  const rh = Math.min(100, Math.max(1, relativeHumidityPct));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/** Moist-air specific enthalpy, kJ/kg dry air. */
export function moistAirEnthalpy(tempC: number, ratio: number): number {
  return 1.006 * tempC + ratio * (2501 + 1.86 * tempC);
}

/**
 * Specific heat capacity of moist air, J/kg dry air·K.
 * Used for the ventilation sensible-heat term.
 */
export function moistAirCp(ratio: number): number {
  return CP_AIR + ratio * CP_VAPOUR;
}

/**
 * Latent heat removed when condensing moisture from air, W.
 *
 * @param massFlowDryAir kg dry air / s
 * @param ratioIn  humidity ratio of incoming (outdoor) air
 * @param ratioOut humidity ratio of the conditioned air
 */
export function latentCoolingPower(
  massFlowDryAir: number,
  ratioIn: number,
  ratioOut: number,
): number {
  return Math.max(0, massFlowDryAir * (ratioIn - ratioOut) * LATENT_HEAT_VAPORISATION);
}

/**
 * Mean radiant temperature seen by a person, °C.
 *
 * Simplified area-weighted blend of the surrounding surface temperatures,
 * weighted by their view factors toward the occupant.
 */
export function meanRadiantTemperature(
  surfaces: ReadonlyArray<{ temperature: number; viewFactor: number }>,
): number {
  const total = surfaces.reduce((sum, s) => sum + s.viewFactor, 0);
  if (total <= 0) return 0;
  return surfaces.reduce((sum, s) => sum + s.temperature * s.viewFactor, 0) / total;
}
