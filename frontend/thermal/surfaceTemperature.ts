/**
 * Per-surface **temperature** — the second, independent 3D thermal map.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `surfaceHeat.ts`
 * The existing heat map shows *absorbed solar radiation*, which is a direct
 * product of the solar geometry and needs no conduction solve to compute. A
 * surface **temperature** is a different quantity: it depends on the sol-air
 * temperature, the assembly's U-value and the indoor temperature, and it is the
 * quantity a person actually reads a thermal image to find out. Relabelling the
 * solar map as "temperature" would be the single most misleading thing this
 * interface could do, so the two are computed separately and shown as two
 * separate modes.
 *
 * HOW THE TEMPERATURE IS DERIVED, AND WHAT IT IS NOT
 * For each opaque surface the model already computes a conduction heat flux
 * `q = U·(T_sol-air − T_in)`. The outer surface temperature then follows from
 * the same flux crossing the outside film:
 *
 *     T_surface = T_sol-air − q / h_out
 *
 * This is a first-order estimate, not a multi-node conduction solve: it uses
 * one lumped U-value and one film coefficient, so it does not resolve the
 * temperature *gradient through* a thick wall, and it assumes the surface is
 * isothermal. It is accurate enough to say which facade is the hot one and by
 * roughly how much, which is what the visualisation is for. The UI labels it an
 * estimate on its face.
 *
 * The floor is treated differently, and correctly: it is driven by the ground,
 * which sits near the site's annual mean all year, so it is a steady loss in a
 * cold climate and a steady gain in a hot one — the reverse of every other
 * surface.
 */

import type {
  ClimateData,
  LocalWallId,
  ResolvedMaterials,
  ShelterGeometry,
} from '@/types';
import { MONTH_MID_DAY, deg2rad, rad2deg } from '@/utils/units';
import {
  clearSkyIrradiance,
  clearnessFromDailyIrradiation,
  incidenceCosine,
  solarPosition,
  sunVectorENU,
  surfaceNormalENU,
} from '@/utils/solar';
import { roofExposurePlanes } from './thermalModel';
import { SURFACE_NAMES, type HeatSurfaceKey } from './surfaceHeat';

/** Every surface the map can colour — the walls and roof, plus the floor. */
export type SurfaceKey = HeatSurfaceKey | 'floor';

export interface SurfaceThermalDetail {
  key: SurfaceKey;
  label: string;
  /** Outward normal azimuth, degrees (0 = north). Floor is meaningless here. */
  azimuth: number;
  /** Plane tilt, degrees. 90 = wall, 0 = roof, 180 = downward-facing floor. */
  tilt: number;
  /** Instantaneous incident irradiance on the surface, W/m². */
  irradiance: number;
  /** Sol-air temperature the conduction actually sees, °C. */
  solAirTemp: number;
  /** Estimated outer surface temperature, °C. */
  surfaceTemp: number;
  /** Conduction heat flux through the surface, W/m², positive into the zone. */
  heatFlux: number;
  /** U-value used for the flux, W/m²·K. */
  uValue: number;
  /** True when the surface sits below the indoor dew point. */
  condensationRisk: boolean;
  /** Surface area this reading represents, m². */
  area: number;
}

export interface SurfaceTemperature {
  /** Estimated surface temperature per surface, °C. */
  bySurface: Record<HeatSurfaceKey, number>;
  /** Display range across the surfaces, °C. */
  range: [number, number];
  month: number;
  hour: number;
  /** Indoor temperature the estimate was evaluated against, °C. */
  indoorTemp: number;
  /** Outdoor temperature at the hour, °C. */
  outdoorTemp: number;
  /** Indoor dew point, °C. */
  dewPoint: number;
  label: string;
  unit: string;
  /** The warmest surface — the design's weak point in a hot climate. */
  hottest: SurfaceKey;
  /** The coldest surface — the weak point in a cold one. */
  coldest: SurfaceKey;
  /** Surfaces below the dew point. */
  condensationSurfaces: SurfaceKey[];
  /** Full per-surface detail, for the digital-twin inspector. */
  detail: Record<SurfaceKey, SurfaceThermalDetail>;
  summary: string;
}

/** Outside film coefficient, W/m²·K. */
const H_OUT_WALL = 20;
const H_OUT_ROOF = 22;
/** Inside film coefficient, W/m²·K — used for the floor's inner surface. */
const H_IN = 8;
/** Long-wave loss to a clear sky, W/m². Applied to the roof only. */
const SKY_LOSS_ROOF = 63;
/** Ground-coupled conductance, W/m²·K. Matches the thermal model. */
const U_GROUND = 0.35;
const GROUND_ALBEDO = 0.2;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Estimate per-surface temperatures for a representative day of `month`, at a
 * given hour.
 *
 * @param indoorTemp the free-running indoor temperature at that hour. Falls back
 *        to the month's mean free-float when not supplied.
 * @param indoorHumidity indoor relative humidity, % — used for the dew point.
 *        Falls back to the site's mean humidity.
 */
export function computeSurfaceTemperature(
  climate: ClimateData,
  geometry: ShelterGeometry,
  materials: ResolvedMaterials,
  month: number,
  hour: number,
  indoorTemp?: number,
  indoorHumidity?: number,
): SurfaceTemperature {
  const day = MONTH_MID_DAY[month] ?? 180;
  const { latitude } = climate.location;
  const monthly = climate.monthly[month];
  const dailyGlobal = monthly?.solarRadiation ?? climate.summary.solarRadiation;

  const tMean = monthly?.avgTemp ?? climate.summary.avgTemperature;
  const tMax = monthly?.maxTemp ?? climate.summary.maxTemperature;
  const tMin = monthly?.minTemp ?? climate.summary.minTemperature;
  const outdoorTemp = diurnalTemp(tMean, tMin, tMax, hour);

  const tIn = indoorTemp ?? tMean;
  const rhIn = indoorHumidity ?? climate.summary.humidity ?? 50;
  const dewPoint = dewPointC(tIn, rhIn);

  const clearness = clearnessFromDailyIrradiation(dailyGlobal, latitude, day);
  const pos = solarPosition(latitude, day, hour);
  const sun = sunVectorENU(pos.altitude, pos.azimuth);
  const sky = clearSkyIrradiance(pos.altitude, day, clearness);

  const wallU = materials.wall.uValue;
  const roofU = materials.roof.uValue;
  const wallAlpha = materials.wall.solarAbsorptance;
  const roofAlpha = materials.roof.solarAbsorptance;
  const roofEps = materials.roof.emissivity;

  const detail = {} as Record<SurfaceKey, SurfaceThermalDetail>;
  const bySurface = {} as Record<HeatSurfaceKey, number>;

  /* ------------------------------- Walls ------------------------------- */
  for (const wall of geometry.walls) {
    const normal = surfaceNormalENU(wall.azimuth, 90);
    const irradiance = planeIrradiance(sun, normal, sky, 90);
    const solAir = outdoorTemp + (wallAlpha * irradiance) / H_OUT_WALL;
    const flux = wallU * (solAir - tIn);
    const surfaceTemp = solAir - flux / H_OUT_WALL;

    detail[wall.id] = {
      key: wall.id,
      label: SURFACE_NAMES[wall.id],
      azimuth: wall.azimuth,
      tilt: 90,
      irradiance: round1(irradiance),
      solAirTemp: round1(solAir),
      surfaceTemp: round1(surfaceTemp),
      heatFlux: round1(flux),
      uValue: round2(wallU),
      condensationRisk: surfaceTemp < dewPoint,
      area: round2(wall.opaqueArea),
    };
    bySurface[wall.id] = round1(surfaceTemp);
  }

  /* -------------------------------- Roof -------------------------------- */
  {
    const planes = roofExposurePlanes(geometry.parameters, latitude);
    let weightedIrradiance = 0;
    let weightedSolAir = 0;
    let areaTotal = 0;

    for (const plane of planes) {
      const normal = surfaceNormalENU(plane.azimuthDeg, plane.tiltDeg);
      const irradiance = planeIrradiance(sun, normal, sky, plane.tiltDeg);
      const solAir =
        outdoorTemp +
        (roofAlpha * irradiance) / H_OUT_ROOF -
        (roofEps * SKY_LOSS_ROOF) / H_OUT_ROOF;
      weightedIrradiance += plane.weight * irradiance;
      weightedSolAir += plane.weight * solAir;
      areaTotal += plane.weight;
    }

    const norm = areaTotal > 0 ? areaTotal : 1;
    const irradiance = weightedIrradiance / norm;
    const solAir = weightedSolAir / norm;
    const flux = roofU * (solAir - tIn);
    const surfaceTemp = solAir - flux / H_OUT_ROOF;

    detail.roof = {
      key: 'roof',
      label: SURFACE_NAMES.roof,
      azimuth: 180,
      tilt: 0,
      irradiance: round1(irradiance),
      solAirTemp: round1(solAir),
      surfaceTemp: round1(surfaceTemp),
      heatFlux: round1(flux),
      uValue: round2(roofU),
      condensationRisk: surfaceTemp < dewPoint,
      area: round2(geometry.roofArea),
    };
    bySurface.roof = round1(surfaceTemp);
  }

  /* -------------------------------- Floor -------------------------------
   * Driven by the ground, which sits near the annual mean all year. The inner
   * surface temperature therefore follows the indoor air closely and is pulled
   * toward the ground — a steady loss in a cold climate, a steady gain in a hot
   * one. */
  {
    const groundTemp = climate.summary.avgTemperature;
    const flux = U_GROUND * (groundTemp - tIn);
    const surfaceTemp = tIn + flux / H_IN;

    detail.floor = {
      key: 'floor',
      label: 'Floor',
      azimuth: 0,
      tilt: 180,
      irradiance: 0,
      solAirTemp: round1(groundTemp),
      surfaceTemp: round1(surfaceTemp),
      heatFlux: round1(flux),
      uValue: U_GROUND,
      condensationRisk: surfaceTemp < dewPoint,
      area: round2(geometry.groundFloorArea),
    };
  }

  /* ------------------------------ Summary ------------------------------- */
  const surfaceValues = Object.values(bySurface);
  const min = Math.min(...surfaceValues);
  const max = Math.max(...surfaceValues);

  const ranked = (Object.entries(bySurface) as Array<[HeatSurfaceKey, number]>).sort(
    (a, b) => b[1] - a[1],
  );
  const hottest: SurfaceKey = ranked[0]?.[0] ?? 'roof';
  const coldest: SurfaceKey = ranked[ranked.length - 1]?.[0] ?? 'floor';

  const condensationSurfaces = (Object.values(detail) as SurfaceThermalDetail[])
    .filter((entry) => entry.condensationRisk)
    .map((entry) => entry.key);

  const summary =
    `${SURFACE_NAMES[hottest] ?? 'Roof'} runs warmest at ${bySurface[hottest]?.toFixed(1)} °C ` +
    `against an indoor ${tIn.toFixed(1)} °C and an outdoor ${outdoorTemp.toFixed(1)} °C. ` +
    (condensationSurfaces.length > 0
      ? `${condensationSurfaces.length} surface${condensationSurfaces.length === 1 ? '' : 's'} sit below the ${dewPoint.toFixed(1)} °C dew point — condensation risk.`
      : `No surface falls below the ${dewPoint.toFixed(1)} °C dew point at this hour.`);

  return {
    bySurface,
    range: [min, max],
    month,
    hour,
    indoorTemp: round1(tIn),
    outdoorTemp: round1(outdoorTemp),
    dewPoint: round1(dewPoint),
    label: `Surface temperature · ${MONTH_NAMES[((month % 12) + 12) % 12]}`,
    unit: '°C',
    hottest,
    coldest,
    condensationSurfaces,
    detail,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Instantaneous irradiance on a tilted plane, W/m².
 *
 * Beam from the incidence cosine, isotropic diffuse, and a ground-reflected
 * term — the same decomposition `dailyFacadeIrradiation` uses, evaluated at one
 * hour instead of integrated over the day.
 */
function planeIrradiance(
  sun: readonly [number, number, number],
  normal: readonly [number, number, number],
  sky: { directNormal: number; diffuseHorizontal: number; globalHorizontal: number },
  tiltDeg: number,
): number {
  const cosIncidence = incidenceCosine(sun, normal);
  const beam = sky.directNormal * cosIncidence;
  const tilt = deg2rad(tiltDeg);
  const diffuse = sky.diffuseHorizontal * ((1 + Math.cos(tilt)) / 2);
  const reflected = sky.globalHorizontal * GROUND_ALBEDO * ((1 - Math.cos(tilt)) / 2);
  return Math.max(0, beam + diffuse + reflected);
}

/**
 * Outdoor dry-bulb at an hour, from the month's min/mean/max.
 *
 * The same sinusoid the thermal model uses, peaking at 15:00 local solar time
 * so the surface map and the heat balance describe the same day.
 */
function diurnalTemp(mean: number, min: number, max: number, hour: number): number {
  const amplitude = Math.max(0, (max - min) / 2);
  return mean + amplitude * Math.cos((2 * Math.PI * (hour - 15)) / 24);
}

/**
 * Dew point from dry-bulb and relative humidity, °C (Magnus formula).
 *
 * Returned as a plain number rather than an error state because every caller
 * has already clamped the humidity to a physical range.
 */
export function dewPointC(dryBulb: number, relativeHumidity: number): number {
  const rh = Math.min(100, Math.max(1, relativeHumidity));
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * dryBulb) / (b + dryBulb) + Math.log(rh / 100);
  return (b * alpha) / (a - alpha);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Re-export so the inspector can label a local wall without a second import. */
export { SURFACE_NAMES };
export type { LocalWallId };
export { rad2deg };
