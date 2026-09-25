/**
 * Per-surface heat load — the data behind the heat-map visualisation.
 *
 * WHAT IT SHOWS
 * The solar radiation each building surface actually absorbs over a
 * representative day of the selected month, in kWh/m²/day. That is the honest
 * quantity for a "heat map": it is the driver of every conduction and glazing
 * gain in the thermal model, and unlike a rendered surface temperature it is
 * computable without a full 3D radiation solve.
 *
 * Absorptance matters as much as incidence. A white cool roof and a dark metal
 * roof sit under the same sun and absorb wildly different amounts, which is
 * exactly the insight the visualisation is meant to deliver.
 *
 * WHY NOT SURFACE TEMPERATURE
 * A per-surface temperature needs a multi-node conduction solve with view
 * factors between surfaces. This model deliberately does not do that, and
 * inventing a plausible-looking temperature would be worse than showing the
 * quantity that is actually known.
 */

import type { ClimateData, LocalWallId, ResolvedMaterials, ShelterGeometry } from '@/types';
import { MONTH_MID_DAY } from '@/utils/units';
import { dailyFacadeIrradiation } from '@/climate/facadeIrradiance';
import { roofExposurePlanes } from './thermalModel';

export type HeatSurfaceKey = LocalWallId | 'roof';

export interface SurfaceHeat {
  /** Absorbed solar radiation per surface, kWh/m²/day. */
  bySurface: Record<HeatSurfaceKey, number>;
  /** Incident (not absorbed) radiation per surface, for the tooltip. */
  incidentBySurface: Record<HeatSurfaceKey, number>;
  /** Display range across the surfaces. */
  range: [number, number];
  /** Which month this was evaluated for. */
  month: number;
  label: string;
  unit: string;
  /** The surface absorbing the most — the design's weak point. */
  hottest: HeatSurfaceKey;
  /** Plain-language read of the map. */
  summary: string;
}

const SURFACE_NAMES: Record<HeatSurfaceKey, string> = {
  front: 'Front facade',
  back: 'Rear facade',
  left: 'Left facade',
  right: 'Right facade',
  roof: 'Roof',
};

export function computeSurfaceHeat(
  climate: ClimateData,
  geometry: ShelterGeometry,
  materials: ResolvedMaterials,
  month: number,
): SurfaceHeat {
  const day = MONTH_MID_DAY[month] ?? 180;
  const { latitude } = climate.location;
  const dailyGlobal = climate.monthly[month]?.solarRadiation ?? climate.summary.solarRadiation;

  const bySurface = {} as Record<HeatSurfaceKey, number>;
  const incidentBySurface = {} as Record<HeatSurfaceKey, number>;

  for (const wall of geometry.walls) {
    const irradiation = dailyFacadeIrradiation(dailyGlobal, latitude, day, wall.azimuth, {
      tilt: 90,
    });
    incidentBySurface[wall.id] = round2(irradiation.total);
    bySurface[wall.id] = round2(irradiation.total * materials.wall.solarAbsorptance);
  }

  /*
   * The roof is not necessarily horizontal, and pretending it is would make the
   * heat map disagree with the thermal model that used it. The form's planes are
   * resolved by the same helper the heat balance uses, then averaged by area, so
   * a pitched roof correctly reads as collecting more than a flat one.
   */
  const roofPlanes = roofExposurePlanes(geometry.parameters, latitude);
  let roofIncident = 0;
  for (const plane of roofPlanes) {
    const irradiation = dailyFacadeIrradiation(dailyGlobal, latitude, day, plane.azimuthDeg, {
      tilt: plane.tiltDeg,
    });
    roofIncident += plane.weight * irradiation.total;
  }
  incidentBySurface.roof = round2(roofIncident);
  bySurface.roof = round2(roofIncident * materials.roof.solarAbsorptance);

  const values = Object.values(bySurface);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const hottest = (Object.entries(bySurface) as Array<[HeatSurfaceKey, number]>).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ['roof', 0] as [HeatSurfaceKey, number],
  )[0];

  const wallEntries = geometry.walls.map((w) => ({ id: w.id, azimuth: w.azimuth, value: bySurface[w.id] }));
  const worstWall = wallEntries.reduce(
    (best, entry) => (entry.value > best.value ? entry : best),
    wallEntries[0] ?? { id: 'front' as LocalWallId, azimuth: 0, value: 0 },
  );

  const summary =
    `${SURFACE_NAMES[hottest]} absorbs the most solar heat at ${bySurface[hottest].toFixed(2)} kWh/m²/day. ` +
    `Across the walls the worst-exposed facade is ${SURFACE_NAMES[worstWall.id]} at azimuth ` +
    `${Math.round(worstWall.azimuth)}° with ${bySurface[worstWall.id].toFixed(2)} kWh/m²/day absorbed — ` +
    `that is where the next shading rupee buys the most.`;

  return {
    bySurface,
    incidentBySurface,
    range: [min, max],
    month,
    label: `Absorbed solar radiation · ${monthName(month)}`,
    unit: 'kWh/m²/day',
    hottest,
    summary,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthName(month: number): string {
  return MONTH_NAMES[((month % 12) + 12) % 12]!;
}

export { SURFACE_NAMES };
