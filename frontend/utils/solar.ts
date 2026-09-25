/**
 * Solar geometry and irradiance on tilted surfaces.
 *
 * Implements:
 *  - NOAA solar position (declination, equation of time, altitude, azimuth).
 *  - ASHRAE clear-sky irradiance for hourly visualisation.
 *  - Erbs diffuse-fraction correlation to split daily global irradiation.
 *  - Isotropic-sky transposition to tilted surfaces.
 *  - Simplified overhang / fin / louvre shading factors for glazing.
 *
 * Times are LOCAL SOLAR TIME (LST), where 12:00 is solar noon. This avoids
 * timezone handling and is the physically meaningful frame for shading design.
 */

import { SOLAR_CONSTANT, deg2rad, rad2deg, normalizeDeg } from './units';

/* ------------------------------------------------------------------ */
/* Position of the sun                                                 */
/* ------------------------------------------------------------------ */

/** Solar declination, degrees. */
export function solarDeclination(dayOfYear: number): number {
  const g = (2 * Math.PI * (dayOfYear - 1)) / 365;
  return rad2deg(
    0.006918 -
      0.399912 * Math.cos(g) +
      0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) +
      0.00148 * Math.sin(3 * g),
  );
}

/** Equation of time, minutes. */
export function equationOfTime(dayOfYear: number): number {
  const g = (2 * Math.PI * (dayOfYear - 1)) / 365;
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

export interface SolarPosition {
  /** Degrees above the horizon. Negative when the sun is down. */
  altitude: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees from vertical. */
  zenith: number;
  /** Hour angle, degrees (negative before solar noon). */
  hourAngle: number;
  /** Solar declination, degrees. */
  declination: number;
  /** True when the sun is above the horizon. */
  isDaylight: boolean;
}

/**
 * Sun position for a latitude and local solar time.
 *
 * @param latitudeDeg site latitude, north positive
 * @param dayOfYear 1–365
 * @param solarHour local solar time in hours, 0–24
 */
export function solarPosition(
  latitudeDeg: number,
  dayOfYear: number,
  solarHour: number,
): SolarPosition {
  const lat = deg2rad(latitudeDeg);
  const decl = deg2rad(solarDeclination(dayOfYear));
  const hourAngle = 15 * (solarHour - 12);
  const ha = deg2rad(hourAngle);

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const altitude = rad2deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));

  // Azimuth measured from south, positive toward west, then converted to
  // the compass convention (0 = north, clockwise).
  const azFromSouth = rad2deg(
    Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)),
  );

  return {
    altitude,
    azimuth: normalizeDeg(azFromSouth + 180),
    zenith: 90 - altitude,
    hourAngle,
    declination: solarDeclination(dayOfYear),
    isDaylight: altitude > 0,
  };
}

/** Sunset hour angle, degrees (positive). */
export function sunsetHourAngle(latitudeDeg: number, dayOfYear: number): number {
  const lat = deg2rad(latitudeDeg);
  const decl = deg2rad(solarDeclination(dayOfYear));
  const cosWs = -Math.tan(lat) * Math.tan(decl);
  return rad2deg(Math.acos(Math.max(-1, Math.min(1, cosWs))));
}

/** Day length, hours. */
export function dayLengthHours(latitudeDeg: number, dayOfYear: number): number {
  return (2 * sunsetHourAngle(latitudeDeg, dayOfYear)) / 15;
}

/** Sunrise and sunset in local solar time, hours. */
export function sunriseSunset(
  latitudeDeg: number,
  dayOfYear: number,
): { sunrise: number; sunset: number } {
  const half = dayLengthHours(latitudeDeg, dayOfYear) / 2;
  return { sunrise: 12 - half, sunset: 12 + half };
}

/* ------------------------------------------------------------------ */
/* Vectors                                                             */
/* ------------------------------------------------------------------ */

export type Vec3 = readonly [number, number, number];

/**
 * Sun unit vector in a local East–North–Up frame.
 */
export function sunVectorENU(altitudeDeg: number, azimuthDeg: number): Vec3 {
  const alt = deg2rad(altitudeDeg);
  const az = deg2rad(azimuthDeg);
  return [
    Math.cos(alt) * Math.sin(az), // East
    Math.cos(alt) * Math.cos(az), // North
    Math.sin(alt), // Up
  ];
}

/**
 * Outward unit normal of a surface in the same East–North–Up frame.
 *
 * @param azimuthDeg compass direction the surface faces (0 = north)
 * @param tiltDeg 0 = horizontal facing up, 90 = vertical wall
 *
 * The normal makes an angle of `tiltDeg` with the up axis, so the horizontal
 * components scale with sin(tilt) and the vertical component with cos(tilt).
 * (Getting this inverted makes every wall behave like a roof and silently
 * multiplies glazing gains several-fold.)
 */
export function surfaceNormalENU(azimuthDeg: number, tiltDeg: number): Vec3 {
  const tilt = deg2rad(tiltDeg);
  const az = deg2rad(azimuthDeg);
  return [
    Math.sin(tilt) * Math.sin(az), // East
    Math.sin(tilt) * Math.cos(az), // North
    Math.cos(tilt), // Up
  ];
}

/** Cosine of the incidence angle between sun and a surface. Never negative. */
export function incidenceCosine(
  sun: Vec3,
  normal: Vec3,
): number {
  const dot = sun[0] * normal[0] + sun[1] * normal[1] + sun[2] * normal[2];
  return Math.max(0, dot);
}

/* ------------------------------------------------------------------ */
/* Daily irradiation and its split                                     */
/* ------------------------------------------------------------------ */

/**
 * Extraterrestrial daily irradiation on a horizontal surface, kWh/m²/day.
 */
export function extraterrestrialDailyIrradiation(
  latitudeDeg: number,
  dayOfYear: number,
): number {
  const lat = deg2rad(latitudeDeg);
  const decl = deg2rad(solarDeclination(dayOfYear));
  const wsDeg = sunsetHourAngle(latitudeDeg, dayOfYear);
  const ws = deg2rad(wsDeg);

  const eccentricity = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  // J/m²/day
  const h0 =
    ((24 * 3600) / Math.PI) *
    SOLAR_CONSTANT *
    eccentricity *
    (Math.cos(lat) * Math.cos(decl) * Math.sin(ws) +
      ws * Math.sin(lat) * Math.sin(decl));

  return Math.max(0, h0 / 3.6e6);
}

export interface IrradiationSplit {
  /** Daily global horizontal irradiation, kWh/m²/day. */
  global: number;
  /** Beam (direct) horizontal component. */
  beam: number;
  /** Diffuse horizontal component. */
  diffuse: number;
  /** Clearness index H/H0. */
  clearnessIndex: number;
  /** Extraterrestrial horizontal irradiation. */
  extraterrestrial: number;
}

/**
 * Split daily global horizontal irradiation into beam and diffuse using the
 * Erbs correlation.
 */
export function splitIrradiation(
  globalHorizontal: number,
  latitudeDeg: number,
  dayOfYear: number,
): IrradiationSplit {
  const h0 = extraterrestrialDailyIrradiation(latitudeDeg, dayOfYear);
  if (h0 <= 0) {
    return {
      global: 0,
      beam: 0,
      diffuse: 0,
      clearnessIndex: 0,
      extraterrestrial: 0,
    };
  }

  const kt = Math.max(0, Math.min(1, globalHorizontal / h0));
  const ws = sunsetHourAngle(latitudeDeg, dayOfYear);

  let diffuseFraction: number;
  if (ws <= 81.4) {
    diffuseFraction =
      kt <= 0.715
        ? 1.0 - 0.2727 * kt + 2.4495 * kt ** 2 - 11.9514 * kt ** 3 + 9.3879 * kt ** 4
        : 0.143;
  } else {
    diffuseFraction =
      kt < 0.722
        ? 1.0 + 0.2832 * kt - 2.5557 * kt ** 2 + 0.8448 * kt ** 3
        : 0.175;
  }

  diffuseFraction = Math.max(0, Math.min(1, diffuseFraction));
  const diffuse = globalHorizontal * diffuseFraction;
  const beam = Math.max(0, globalHorizontal - diffuse);

  return {
    global: globalHorizontal,
    beam,
    diffuse,
    clearnessIndex: kt,
    extraterrestrial: h0,
  };
}

export interface TiltedIrradiation {
  /** Total irradiation on the plane, kWh/m²/day. */
  total: number;
  beam: number;
  diffuse: number;
  reflected: number;
  /** Beam tilt factor Rb = cosθ / cosθz. */
  tiltFactor: number;
  /** Cosine of the incidence angle. */
  incidenceCosine: number;
}

/**
 * Transpose daily horizontal irradiation onto a tilted plane using the
 * isotropic-sky model.
 *
 * @param globalHorizontal daily global horizontal irradiation, kWh/m²/day
 * @param latitudeDeg site latitude
 * @param dayOfYear representative day
 * @param tiltDeg plane tilt from horizontal
 * @param azimuthDeg plane azimuth (0 = north)
 * @param groundReflectance albedo, default 0.2
 */
export function irradiationOnTiltedSurface(
  globalHorizontal: number,
  latitudeDeg: number,
  dayOfYear: number,
  tiltDeg: number,
  azimuthDeg: number,
  groundReflectance = 0.2,
): TiltedIrradiation {
  const split = splitIrradiation(globalHorizontal, latitudeDeg, dayOfYear);
  const pos = solarPosition(latitudeDeg, dayOfYear, 12);

  const tilt = deg2rad(tiltDeg);
  const sun = sunVectorENU(pos.altitude, pos.azimuth);
  const normal = surfaceNormalENU(azimuthDeg, tiltDeg);

  const cosInc = incidenceCosine(sun, normal);
  const cosZenith = Math.max(0.05, Math.sin(deg2rad(pos.altitude)));
  const tiltFactor = Math.min(6, cosInc / cosZenith);

  const beam = split.beam * tiltFactor;
  const diffuse = split.diffuse * ((1 + Math.cos(tilt)) / 2);
  const reflected = split.global * groundReflectance * ((1 - Math.cos(tilt)) / 2);

  return {
    total: beam + diffuse + reflected,
    beam,
    diffuse,
    reflected,
    tiltFactor,
    incidenceCosine: cosInc,
  };
}

/* ------------------------------------------------------------------ */
/* Clear-sky hourly irradiance (ASHRAE)                                */
/* ------------------------------------------------------------------ */

export interface ClearSkyIrradiance {
  /** Direct normal irradiance, W/m². */
  directNormal: number;
  /** Diffuse horizontal irradiance, W/m². */
  diffuseHorizontal: number;
  /** Global horizontal irradiance, W/m². */
  globalHorizontal: number;
}

/**
 * ASHRAE clear-sky model, scaled by a site clearness factor.
 *
 * @param clearness 0–1.5 multiplier derived from the site's measured daily
 *   irradiation versus the extraterrestrial value (1 = typical clear sky).
 */
export function clearSkyIrradiance(
  altitudeDeg: number,
  dayOfYear: number,
  clearness = 1,
): ClearSkyIrradiance {
  if (altitudeDeg <= 0) {
    return { directNormal: 0, diffuseHorizontal: 0, globalHorizontal: 0 };
  }

  const sinAlt = Math.sin(deg2rad(altitudeDeg));
  const apparentSolar = 360 * ((dayOfYear - 81) / 365);

  const a = 1160 + 75 * Math.sin(deg2rad(apparentSolar));
  const b = 0.174 + 0.035 * Math.sin(deg2rad(apparentSolar - 100));
  const c = 0.095 + 0.04 * Math.sin(deg2rad(apparentSolar - 100));

  const directNormal = Math.max(0, (a / Math.exp(b / Math.max(sinAlt, 0.05))) * clearness);
  const diffuseHorizontal = Math.max(0, c * directNormal);
  const globalHorizontal = directNormal * sinAlt + diffuseHorizontal;

  return { directNormal, diffuseHorizontal, globalHorizontal };
}

/**
 * Estimate a site clearness multiplier from its mean daily irradiation.
 * Leh is very clear (>1); humid monsoon cities are hazier (<1).
 */
export function clearnessFromDailyIrradiation(
  dailyIrradiation: number,
  latitudeDeg: number,
  dayOfYear: number,
): number {
  const h0 = extraterrestrialDailyIrradiation(latitudeDeg, dayOfYear);
  if (h0 <= 0.1) return 1;
  return Math.max(0.45, Math.min(1.25, (dailyIrradiation / h0) * 1.55));
}

/* ------------------------------------------------------------------ */
/* Shading factors                                                     */
/* ------------------------------------------------------------------ */

export interface ShadingContext {
  /** Projection depth of the horizontal overhang, metres. */
  projection: number;
  /** Glazing height, metres. */
  windowHeight: number;
  /** Sun altitude, degrees. */
  solarAltitude: number;
  /** Facade azimuth, degrees (0 = north). */
  facadeAzimuth: number;
  /** Sun azimuth, degrees. */
  sunAzimuth: number;
}

/**
 * Fraction of glazing still exposed to direct sun under a horizontal overhang.
 * Returns 1 when nothing is shaded, 0 when fully shaded.
 */
export function overhangExposure(ctx: ShadingContext): number {
  const { projection, windowHeight, solarAltitude, facadeAzimuth, sunAzimuth } = ctx;
  if (solarAltitude <= 0 || projection <= 0 || windowHeight <= 0) return 1;

  const sun = sunVectorENU(solarAltitude, sunAzimuth);
  const normal = surfaceNormalENU(facadeAzimuth, 90);
  const cosInc = incidenceCosine(sun, normal);

  // Facade faces away from the sun — it is already in shade.
  if (cosInc <= 0.02) return 0;

  // Vertical shadow depth cast down the glazing plane.
  const drop = (projection * Math.tan(deg2rad(solarAltitude))) / Math.max(cosInc, 0.15);
  const shadedFraction = Math.min(1, drop / windowHeight);
  return Math.max(0, 1 - shadedFraction);
}

/**
 * Exposure under vertical fins on both sides of a window.
 */
export function finExposure(ctx: ShadingContext & { windowWidth: number }): number {
  const { projection, windowWidth, solarAltitude, facadeAzimuth, sunAzimuth } = ctx;
  if (solarAltitude <= 0 || projection <= 0 || windowWidth <= 0) return 1;

  const sun = sunVectorENU(solarAltitude, sunAzimuth);
  const normal = surfaceNormalENU(facadeAzimuth, 90);
  const cosInc = incidenceCosine(sun, normal);
  if (cosInc <= 0.02) return 0;

  const sinInc = Math.sqrt(Math.max(0, 1 - cosInc ** 2));
  if (sinInc < 0.02) return 1; // sun near the facade normal — fins do little

  const lateral = projection / Math.max(sinInc, 0.08);
  const shadedFraction = Math.min(1, lateral / windowWidth);
  return Math.max(0, 1 - shadedFraction);
}

/**
 * Combined exposure for the whole shading assembly.
 *
 * @param type which device family is installed
 * @param slatFactor louvre/blind transmission when the device is deployed
 */
export function shadingExposure(
  type: 'none' | 'overhang' | 'louvre' | 'external-blind' | 'deep-verandah' | 'combined',
  ctx: ShadingContext & { windowWidth: number },
): number {
  switch (type) {
    case 'none':
      return 1;
    case 'overhang':
      return overhangExposure(ctx);
    case 'deep-verandah':
      // A verandah behaves like a very deep overhang.
      return overhangExposure({ ...ctx, projection: ctx.projection * 1.6 });
    case 'louvre': {
      const base = overhangExposure(ctx);
      return base * 0.45;
    }
    case 'external-blind': {
      const base = overhangExposure(ctx);
      return base * 0.3;
    }
    case 'combined': {
      const horizontal = overhangExposure(ctx);
      const vertical = finExposure(ctx);
      return Math.min(horizontal, vertical) * 0.55;
    }
    default:
      return 1;
  }
}

/**
 * Sample the sun path across a day for visualisation.
 */
export function sunPath(
  latitudeDeg: number,
  dayOfYear: number,
  stepHours = 0.5,
): SolarPosition[] {
  const { sunrise, sunset } = sunriseSunset(latitudeDeg, dayOfYear);
  const path: SolarPosition[] = [];
  for (let h = Math.max(0, sunrise); h <= Math.min(24, sunset); h += stepHours) {
    path.push(solarPosition(latitudeDeg, dayOfYear, h));
  }
  return path;
}
