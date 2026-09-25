/**
 * Geographic helpers.
 */

import { deg2rad, normalizeDeg, rad2deg } from './units';

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius, km. */
const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two points, km. */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = deg2rad(b.latitude - a.latitude);
  const dLon = deg2rad(b.longitude - a.longitude);
  const lat1 = deg2rad(a.latitude);
  const lat2 = deg2rad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = deg2rad(a.latitude);
  const lat2 = deg2rad(b.latitude);
  const dLon = deg2rad(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDeg(rad2deg(Math.atan2(y, x)));
}

/** Destinations point given a start, bearing and distance. */
export function destination(start: LatLon, bearingDeg: number, distanceKm: number): LatLon {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const brg = deg2rad(bearingDeg);
  const lat1 = deg2rad(start.latitude);
  const lon1 = deg2rad(start.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: rad2deg(lat2), longitude: normalizeDeg(rad2deg(lon2)) };
}

/**
 * Azimuth of a facade after the building is rotated.
 *
 * @param facadeAzimuthAtZero azimuth of the facade when orientation = 0
 * @param orientation building rotation, degrees clockwise
 */
export function rotateAzimuth(facadeAzimuthAtZero: number, orientation: number): number {
  return normalizeDeg(facadeAzimuthAtZero + orientation);
}

/** True when the site is in the northern hemisphere. */
export function isNorthernHemisphere(latitude: number): boolean {
  return latitude >= 0;
}

/**
 * The azimuth the equator-facing facade points to — the one to glaze and shade.
 * 180° in the northern hemisphere, 0° in the southern.
 */
export function equatorFacingAzimuth(latitude: number): number {
  return latitude >= 0 ? 180 : 0;
}

/**
 * The "worst" facade for low-angle summer sun: west in the northern hemisphere,
 * west still in the southern (afternoon heat gain is the universal problem).
 */
export function westFacingAzimuth(): number {
  return 270;
}

/**
 * Interpolate monthly values to a continuous day-of-year, so charts and the
 * solar model can be evaluated at any point in the year.
 */
export function interpolateMonthly<T extends Record<string, number>>(
  monthly: readonly T[],
  dayOfYear: number,
  key: keyof T,
): number {
  if (monthly.length === 0) return 0;
  const monthIndex = Math.min(11, Math.floor((dayOfYear / 365) * 12));
  const current = monthly[monthIndex]?.[key];
  const next = monthly[(monthIndex + 1) % 12]?.[key];
  if (current === undefined) return 0;
  if (next === undefined) return current;

  const monthStart = (monthIndex / 12) * 365;
  const monthEnd = ((monthIndex + 1) / 12) * 365;
  const t = Math.min(1, Math.max(0, (dayOfYear - monthStart) / (monthEnd - monthStart)));

  return current + (next - current) * t;
}

/**
 * Prevailing wind azimuth binned to a compass sector, for the wind rose.
 */
export function windRoseSectors(
  monthly: ReadonlyArray<{ windDirection: number; windSpeed: number; rainfall: number }>,
  sectors = 16,
): Array<{ sector: number; azimuth: number; meanSpeed: number; frequency: number }> {
  const width = 360 / sectors;
  const buckets = Array.from({ length: sectors }, (_, i) => ({
    sector: i,
    azimuth: i * width,
    totalSpeed: 0,
    count: 0,
  }));

  for (const m of monthly) {
    const idx = Math.min(sectors - 1, Math.floor(normalizeDeg(m.windDirection) / width));
    const bucket = buckets[idx];
    if (bucket) {
      bucket.totalSpeed += m.windSpeed;
      bucket.count += 1;
    }
  }

  return buckets.map((b) => ({
    sector: b.sector,
    azimuth: b.azimuth,
    meanSpeed: b.count > 0 ? b.totalSpeed / b.count : 0,
    frequency: b.count / Math.max(1, monthly.length),
  }));
}
