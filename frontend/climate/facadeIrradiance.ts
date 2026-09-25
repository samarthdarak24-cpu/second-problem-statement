/**
 * Daily irradiation on a tilted/vertical facade, integrated over the sun path.
 *
 * This is the workhorse behind the orientation recommendation and the solar-gain
 * term of the thermal model. Using the full sun path (rather than solar noon
 * alone) matters because east and west facades collect most of their energy
 * during the morning and afternoon shoulders, which a noon-only calculation
 * badly understates.
 *
 * Method:
 *  1. Split the day's global horizontal irradiation into beam and diffuse (Erbs).
 *  2. Integrate clear-sky direct-normal irradiance × incidence cosine over the
 *     day for both the facade and the horizontal plane.
 *  3. The ratio gives the beam tilt factor Rb for that facade on that day.
 *  4. Add isotropic diffuse and ground-reflected components.
 */

import {
  clearSkyIrradiance,
  clearnessFromDailyIrradiation,
  incidenceCosine,
  solarPosition,
  sunriseSunset,
  splitIrradiation,
  sunVectorENU,
  surfaceNormalENU,
} from '@/utils/solar';
import { deg2rad } from '@/utils/units';

export interface FacadeIrradiation {
  /** Total irradiation on the facade, kWh/m²/day. */
  total: number;
  /** Beam (direct) component. */
  beam: number;
  /** Diffuse component. */
  diffuse: number;
  /** Ground-reflected component. */
  reflected: number;
  /** Beam tilt factor, Rb. */
  tiltFactor: number;
  /** Peak incidence cosine over the day — how square-on the sun gets. */
  peakIncidenceCosine: number;
  /** Hours of direct sun on the facade. */
  sunlitHours: number;
}

export interface FacadeIrradiationOptions {
  /** Plane tilt from horizontal. 90 = vertical wall, 0 = roof. */
  tilt?: number;
  /** Ground reflectance. */
  albedo?: number;
  /** Integration step, hours. */
  stepHours?: number;
}

/**
 * Daily irradiation received by a plane at a given azimuth and tilt.
 *
 * @param dailyGlobalHorizontal site daily global horizontal irradiation, kWh/m²/day
 * @param latitude site latitude, degrees
 * @param dayOfYear representative day of the period
 * @param azimuthDeg plane azimuth — the direction the plane faces (0 = north)
 */
export function dailyFacadeIrradiation(
  dailyGlobalHorizontal: number,
  latitude: number,
  dayOfYear: number,
  azimuthDeg: number,
  options: FacadeIrradiationOptions = {},
): FacadeIrradiation {
  const { tilt = 90, albedo = 0.2, stepHours = 0.25 } = options;

  if (dailyGlobalHorizontal <= 0) {
    return {
      total: 0, beam: 0, diffuse: 0, reflected: 0,
      tiltFactor: 0, peakIncidenceCosine: 0, sunlitHours: 0,
    };
  }

  const split = splitIrradiation(dailyGlobalHorizontal, latitude, dayOfYear);
  const clearness = clearnessFromDailyIrradiation(dailyGlobalHorizontal, latitude, dayOfYear);
  const normal = surfaceNormalENU(azimuthDeg, tilt);
  const { sunrise, sunset } = sunriseSunset(latitude, dayOfYear);

  let facadeBeam = 0;
  let horizontalBeam = 0;
  let peakIncidenceCosine = 0;
  let sunlitHours = 0;

  for (let hour = sunrise; hour <= sunset; hour += stepHours) {
    const pos = solarPosition(latitude, dayOfYear, hour);
    if (pos.altitude <= 0) continue;

    const sun = sunVectorENU(pos.altitude, pos.azimuth);
    const cosZenith = Math.sin(deg2rad(pos.altitude));
    const cosIncidence = incidenceCosine(sun, normal);

    const { directNormal } = clearSkyIrradiance(pos.altitude, dayOfYear, clearness);

    facadeBeam += directNormal * cosIncidence * stepHours;
    horizontalBeam += directNormal * cosZenith * stepHours;

    if (cosIncidence > peakIncidenceCosine) peakIncidenceCosine = cosIncidence;
    if (cosIncidence > 0.01) sunlitHours += stepHours;
  }

  // Scale the clear-sky integrals back to the site's actual daily beam total.
  // The clear-sky model gives the shape; the measured total gives the magnitude.
  const tiltFactor =
    horizontalBeam > 1e-6 ? Math.min(6, facadeBeam / horizontalBeam) : 0;

  const beam = split.beam * tiltFactor;
  const diffuse = split.diffuse * ((1 + Math.cos(deg2rad(tilt))) / 2);
  const reflected = split.global * albedo * ((1 - Math.cos(deg2rad(tilt))) / 2);

  return {
    total: beam + diffuse + reflected,
    beam,
    diffuse,
    reflected,
    tiltFactor,
    peakIncidenceCosine,
    sunlitHours,
  };
}

/**
 * Annual cooling-season and heating-season solar gain on a set of facades,
 * in kWh/m²/year (per m² of glazing).
 *
 * Season membership is defined by the month's mean outdoor temperature, which is
 * the standard degree-day style split.
 */
export interface SeasonalGain {
  /** Irradiation received during cooling-dominant months. */
  coolingSeason: number;
  /** Irradiation received during heating-dominant months. */
  heatingSeason: number;
  /** Annual total. */
  annual: number;
}

export function seasonalFacadeGain(
  monthlySolar: number[],
  latitude: number,
  midMonthDays: readonly number[],
  facadeAzimuth: number,
  monthlyTemps: number[],
  coolingThreshold = 22,
  heatingThreshold = 18,
): SeasonalGain {
  let coolingSeason = 0;
  let heatingSeason = 0;
  let annual = 0;

  for (let month = 0; month < 12; month += 1) {
    const day = midMonthDays[month] ?? 180;
    const irradiation = dailyFacadeIrradiation(
      monthlySolar[month] ?? 0,
      latitude,
      day,
      facadeAzimuth,
    ).total;

    const temp = monthlyTemps[month] ?? 20;
    annual += irradiation;
    if (temp >= coolingThreshold) coolingSeason += irradiation;
    if (temp <= heatingThreshold) heatingSeason += irradiation;
  }

  return { coolingSeason, heatingSeason, annual };
}
