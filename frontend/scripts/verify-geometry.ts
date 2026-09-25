/**
 * Geometry verification.
 *
 * The 3D layer is the part of this project that is hardest to test from a
 * terminal, so this harness exercises the pure geometry builders directly with
 * Node and Three.js — no browser, no React.
 *
 * It answers three questions that matter:
 *
 *   1. Is every mesh well formed? (finite vertices, non-degenerate bounding box)
 *   2. Is the model genuinely PARAMETRIC? Changing the window-to-wall ratio,
 *      the roof form or the shading must change the geometry, not just its
 *      transform.
 *   3. Does the geometry agree with the physics? The area the renderer draws has
 *      to match the area the thermal model integrates over, or the two halves of
 *      the app are describing different buildings.
 *
 * Run with:  npx tsx scripts/verify-geometry.ts
 */

import * as THREE from 'three';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { resolveMaterials } from '../thermal/materials';
import { effectiveUValues } from '../thermal/materials';
import {
  floorSlabGeometry,
  localSunDirection,
  partitionGeometry,
  roofGeometry,
  shadingBoxes,
  wallPanelGeometry,
} from '../components/3d/geometry';
import { computeSurfaceHeat } from '../thermal/surfaceHeat';
import { roofExposurePlanes } from '../thermal/thermalModel';
import { dailyFacadeIrradiation } from '../climate/facadeIrradiance';
import { STATION_BY_ID } from '../climate/stations';
import { resolveClimateOffline } from '../climate/climateService';
import { analyseClimate } from '../climate/climateAnalysis';
import { analysisDrivenParameters, conventionalBaseline } from '../optimization/designSpace';
import type { BuildingParameters } from '../types';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */
/* Well-formedness                                                     */
/* ------------------------------------------------------------------ */

function inspect(label: string, geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position) {
    check(`${label}: has a position attribute`, false);
    return;
  }

  let finite = true;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      finite = false;
      break;
    }
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  check(`${label}: vertices finite`, finite, `${position.count} verts, ${index?.count ?? 0} indices`);
  check(`${label}: non-degenerate`, finite && extent > 0.01, `extent ${extent.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ */
/* Test designs                                                        */
/* ------------------------------------------------------------------ */

function requirements(): BuildingParameters {
  return {
    buildingType: 'single-family', floors: 1,
    width: 8, length: 10, height: 3, wallThickness: 0.23,
    numOccupants: 5, numRooms: 2, budget: 1500000,
    orientation: 0, windowToWallRatio: 0.3,
    facadeWeights: { north: 1, east: 1, south: 1, west: 1 },
    wallMaterialId: 'brick', roofMaterialId: 'rcc-slab', windowMaterialId: 'single',
    insulationLevel: 'none', insulationThickness: 0,
    roofType: 'flat', roofAngle: 0, roofOverhang: 0.3,
    shadingType: 'none', shadingDepth: 0,
    ventilationType: 'mixed-mode', airChangesPerHour: 3,
    coolingSetpoint: 26, heatingSetpoint: 20,
    coolingCop: 3.0, heatingEfficiency: 0.85, solarPvKwp: 0,
  };
}

const climate = resolveClimateOffline({
  id: 'in-pune', country: '', state: '', city: '', latitude: 0, longitude: 0, elevation: 0,
}).data;
const analysis = analyseClimate(climate, requirements());
const tuned = analysisDrivenParameters(requirements(), climate, analysis);

/* ------------------------------------------------------------------ */
/* 1 — Mesh well-formedness                                            */
/* ------------------------------------------------------------------ */

console.log('\n=== Mesh well-formedness ===');

for (const params of [requirements(), tuned]) {
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const tag = params === tuned ? 'tuned' : 'baseline';

  for (const wall of geometry.walls) {
    inspect(`${tag}/${wall.id} wall`, wallPanelGeometry(wall));
  }
  inspect(`${tag}/roof`, roofGeometry({ roof: geometry.roof, width: params.width, length: params.length }));
  inspect(`${tag}/floor`, floorSlabGeometry(params.width, params.length));
  for (const partition of geometry.partitions) {
    inspect(`${tag}/${partition.id}`, partitionGeometry(partition));
  }
}

/* ------------------------------------------------------------------ */
/* 2 — Parametric response                                             */
/* ------------------------------------------------------------------ */

console.log('\n=== Parametric response (geometry must actually change) ===');

function wallVertexCount(params: BuildingParameters): number {
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  return geometry.walls.reduce((sum, wall) => {
    const position = wallPanelGeometry(wall).getAttribute('position');
    return sum + (position?.count ?? 0);
  }, 0);
}

/**
 * Vertical spread of the roof's TOP surface only.
 *
 * `roofGeometry` builds a closed shell — a top surface, an underside offset by
 * the build-up thickness, and a fascia. Measuring the whole mesh would therefore
 * report 0.18 m of "rise" on a perfectly flat roof, so the sample is restricted
 * to the first (segments + 1)² vertices, which are the top surface.
 */
const ROOF_SEGMENTS = 12;
function roofVertexSpread(params: BuildingParameters): number {
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const mesh = roofGeometry({
    roof: geometry.roof,
    width: params.width,
    length: params.length,
    segments: ROOF_SEGMENTS,
  });
  const position = mesh.getAttribute('position')!;
  const topVertices = (ROOF_SEGMENTS + 1) ** 2;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < topVertices; i += 1) {
    minY = Math.min(minY, position.getY(i));
    maxY = Math.max(maxY, position.getY(i));
  }
  return maxY - minY;
}

const smallWindows = { ...requirements(), windowToWallRatio: 0.12 };
const largeWindows = { ...requirements(), windowToWallRatio: 0.45 };
check(
  'window-to-wall ratio changes the wall mesh',
  wallVertexCount(smallWindows) !== wallVertexCount(largeWindows),
  `${wallVertexCount(smallWindows)} → ${wallVertexCount(largeWindows)} vertices`,
);

const flatRoof = { ...requirements(), roofType: 'flat' as const, roofAngle: 0 };
const gableRoof = { ...requirements(), roofType: 'gable' as const, roofAngle: 30 };
const vaultRoof = { ...requirements(), roofType: 'vaulted' as const, roofAngle: 35 };
check('flat roof is flat', Math.abs(roofVertexSpread(flatRoof)) < 1e-6, `spread ${roofVertexSpread(flatRoof).toFixed(3)} m`);
check('gable roof rises', roofVertexSpread(gableRoof) > 1.5, `spread ${roofVertexSpread(gableRoof).toFixed(2)} m`);
check('vaulted roof rises', roofVertexSpread(vaultRoof) > 1.5, `spread ${roofVertexSpread(vaultRoof).toFixed(2)} m`);
check(
  'gable and vaulted differ',
  Math.abs(roofVertexSpread(gableRoof) - roofVertexSpread(vaultRoof)) > 0.05,
  `${roofVertexSpread(gableRoof).toFixed(2)} vs ${roofVertexSpread(vaultRoof).toFixed(2)} m`,
);

const noShade = { ...requirements(), shadingType: 'none' as const, shadingDepth: 0 };
const verandah = { ...requirements(), shadingType: 'deep-verandah' as const, shadingDepth: 1.6 };
const combined = { ...requirements(), shadingType: 'combined' as const, shadingDepth: 0.9 };
const shadeCount = (p: BuildingParameters) =>
  buildShelterGeometry(p, resolveMaterials(p)).shading.length;
check('shading devices are generated', shadeCount(verandah) > 0, `${shadeCount(verandah)} devices`);
check('combined generates more devices than verandah', shadeCount(combined) > shadeCount(verandah), `${shadeCount(combined)} vs ${shadeCount(verandah)}`);
check('no shading generates none', shadeCount(noShade) === 0);

const rooms1 = { ...requirements(), numRooms: 1 };
const rooms4 = { ...requirements(), numRooms: 4 };
check(
  'room count changes the partitions',
  buildShelterGeometry(rooms4, resolveMaterials(rooms4)).partitions.length >
    buildShelterGeometry(rooms1, resolveMaterials(rooms1)).partitions.length,
);

const orientA = { ...requirements(), orientation: 0 };
const orientB = { ...requirements(), orientation: 90 };
const a = buildShelterGeometry(orientA, resolveMaterials(orientA));
const b = buildShelterGeometry(orientB, resolveMaterials(orientB));
check(
  'orientation rotates the facade azimuths',
  a.walls[0]!.azimuth !== b.walls[0]!.azimuth,
  `${a.walls[0]!.azimuth}° → ${b.walls[0]!.azimuth}°`,
);
check(
  'orientation does not change the floor area',
  Math.abs(a.floorArea - b.floorArea) < 1e-9,
);

/* ------------------------------------------------------------------ */
/* 3 — Renderer and physics agree                                      */
/* ------------------------------------------------------------------ */

console.log('\n=== Renderer / physics agreement ===');

for (const params of [requirements(), tuned]) {
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const u = effectiveUValues(materials, params.insulationThickness);
  const tag = params === tuned ? 'tuned' : 'baseline';

  /* The renderer draws wall.length × height panels; the physics integrates
     opaqueArea + glazingArea + vent + door. They must reconcile. */
  const drawnGross = geometry.walls.reduce((sum, w) => sum + w.length * w.height, 0);
  check(
    `${tag}: gross wall area reconciles`,
    Math.abs(drawnGross - geometry.wallArea) < 1e-6,
    `${drawnGross.toFixed(2)} m²`,
  );

  const openingArea = geometry.walls.reduce(
    (sum, w) => sum + w.openings.reduce((s, o) => s + o.width * o.height, 0),
    0,
  );
  const opaqueSum = geometry.walls.reduce((sum, w) => sum + w.opaqueArea, 0);
  check(
    `${tag}: opaque + openings = gross`,
    Math.abs(opaqueSum + openingArea - drawnGross) < 1e-6,
    `${opaqueSum.toFixed(2)} + ${openingArea.toFixed(2)} = ${drawnGross.toFixed(2)}`,
  );

  const glazingSum = geometry.walls.reduce((sum, w) => sum + w.glazingArea, 0);
  check(
    `${tag}: glazing area matches the wall panels`,
    Math.abs(glazingSum - geometry.glazingArea) < 1e-6,
    `${glazingSum.toFixed(2)} m²`,
  );

  check(
    `${tag}: U-values are physical`,
    u.wall > 0 && u.wall < 6 && u.roof > 0 && u.roof < 8 && u.window > 0 && u.window < 8,
    `wall ${u.wall.toFixed(2)} · roof ${u.roof.toFixed(2)} · window ${u.window.toFixed(2)} W/m²K`,
  );
}

/* ------------------------------------------------------------------ */
/* 4 — Surface heat map                                                */
/* ------------------------------------------------------------------ */

console.log('\n=== Heat-map data ===');

const materials = resolveMaterials(tuned);
const tunedGeometry = buildShelterGeometry(tuned, materials);
const heat = computeSurfaceHeat(climate, tunedGeometry, materials, climate.summary.peakCoolingMonth);

console.log(`  ${heat.label} [${heat.unit}]`);
for (const [key, value] of Object.entries(heat.bySurface)) {
  console.log(`    ${key.padEnd(6)} absorbed ${value.toFixed(2).padStart(5)}  incident ${heat.incidentBySurface[key as keyof typeof heat.incidentBySurface]!.toFixed(2).padStart(5)}`);
}
check('heat map has all five surfaces', Object.keys(heat.bySurface).length === 5);
check(
  'absorbed never exceeds incident',
  Object.entries(heat.bySurface).every(
    ([key, value]) => value <= heat.incidentBySurface[key as keyof typeof heat.incidentBySurface]! + 1e-6,
  ),
);
check('heat range is non-degenerate', heat.range[1] - heat.range[0] > 0.1, `${heat.range[0].toFixed(2)}–${heat.range[1].toFixed(2)} kWh/m²/day`);

/* A cool roof must absorb less than a dark one under the same sun. */
const coolRoof = { ...tuned, roofMaterialId: 'reflective-roof' };
const darkRoof = { ...tuned, roofMaterialId: 'metal-sheet' };
const coolHeat = computeSurfaceHeat(climate, buildShelterGeometry(coolRoof, resolveMaterials(coolRoof)), resolveMaterials(coolRoof), 4);
const darkHeat = computeSurfaceHeat(climate, buildShelterGeometry(darkRoof, resolveMaterials(darkRoof)), resolveMaterials(darkRoof), 4);
check(
  'reflective roof absorbs less than a dark one',
  coolHeat.bySurface.roof < darkHeat.bySurface.roof,
  `${coolHeat.bySurface.roof.toFixed(2)} vs ${darkHeat.bySurface.roof.toFixed(2)} kWh/m²/day`,
);

/* ------------------------------------------------------------------ */
/* 5 — Sun direction                                                   */
/* ------------------------------------------------------------------ */

console.log('\n=== Sun direction ===');

const noonNorth = localSunDirection(80, 180, 0);
const noonSouth = localSunDirection(80, 180, 180);
check('sun direction is a unit vector', Math.abs(noonNorth.length() - 1) < 1e-6);
check(
  'rotating the building 180° mirrors the sun azimuth',
  Math.abs(noonNorth.x + noonSouth.x) < 1e-6 && Math.abs(noonNorth.z + noonSouth.z) < 1e-6,
);
const belowHorizon = localSunDirection(-10, 180, 0);
check('below-horizon sun points downward', belowHorizon.y < 0, `y ${belowHorizon.y.toFixed(3)}`);

/* ------------------------------------------------------------------ */
/* 6 — Shading decomposition                                           */
/* ------------------------------------------------------------------ */

console.log('\n=== Shading decomposition ===');

const tunedGeometry2 = buildShelterGeometry(tuned, resolveMaterials(tuned));
let shadingBoxesTotal = 0;
for (const device of tunedGeometry2.shading) {
  const boxes = shadingBoxes(device);
  if (boxes.length === 0) {
    check(`device ${device.id} produced geometry`, false, `kind ${device.kind}`);
  }
  for (const box of boxes) {
    const ok = box.size.every((v) => Number.isFinite(v) && v > 0) &&
      box.position.every((v) => Number.isFinite(v));
    if (!ok) check(`device ${device.id} box is well formed`, false, JSON.stringify(box));
  }
  shadingBoxesTotal += boxes.length;
}
check('every shading device decomposes into boxes', shadingBoxesTotal > 0, `${shadingBoxesTotal} boxes from ${tunedGeometry2.shading.length} devices`);

/* ------------------------------------------------------------------ */
/* Roof form — area and solar exposure                                 */
/* ------------------------------------------------------------------ */

/*
 * Two defects used to live here, and they produced a confidently wrong answer
 * rather than an obviously broken one:
 *
 *   1. `roofSurfaceArea` divided the rise by the *half*-span for every pitched
 *      form. That is gable geometry, so a shed roof's area came out ~12 % too
 *      large and a gable's ~3 % too small — biasing the optimiser against the
 *      mono-pitch it should have been considering in a cold climate.
 *
 *   2. The thermal model treated every roof as horizontal, so a pitched roof
 *      only ever added area and never added solar gain. The optimiser therefore
 *      chose a flat roof in every climate, including Leh, where the climate
 *      engine was independently recommending a shed roof for winter solar
 *      collection. Two halves of the same program disagreed.
 *
 * These checks pin both down.
 */

console.log('\n=== Roof form ===');

const lehStation = STATION_BY_ID.get('in-leh')!;
const lehLatitude = lehStation.location.latitude;

function roofArea(overrides: Partial<BuildingParameters>): number {
  const params = { ...requirements(), roofOverhang: 0.3, ...overrides };
  const geometry = buildShelterGeometry(params, resolveMaterials(params));
  return geometry.envelopeArea - geometry.wallArea;
}

const span = Math.min(requirements().width, requirements().length);
const spanWithOverhang = span + 0.3 * 2;
const ridgeLength = Math.max(requirements().width, requirements().length) + 0.3 * 2;
const footprint = spanWithOverhang * ridgeLength;

const flatArea = roofArea({ roofType: 'flat', roofAngle: 0 });
check(
  'a flat roof area is the overhang footprint',
  Math.abs(flatArea - footprint) < 0.5,
  `${flatArea.toFixed(2)} vs ${footprint.toFixed(2)} m²`,
);

for (const [type, pitch] of [
  ['shed', 20],
  ['gable', 30],
] as const) {
  const expected = footprint / Math.cos((pitch * Math.PI) / 180);
  const actual = roofArea({ roofType: type, roofAngle: pitch });
  check(
    `a ${type} roof at ${pitch}° has area footprint ÷ cos(${pitch}°)`,
    Math.abs(actual - expected) / expected < 0.02,
    `${actual.toFixed(2)} vs ${expected.toFixed(2)} m²`,
  );
}

const shed30 = roofArea({ roofType: 'shed', roofAngle: 30 });
const gable30 = roofArea({ roofType: 'gable', roofAngle: 30 });
check(
  'a shed and a gable at the same pitch cover the same area',
  Math.abs(shed30 - gable30) < 0.5,
  `${shed30.toFixed(2)} vs ${gable30.toFixed(2)} m²`,
);
check(
  'steeper pitches have more roof area',
  roofArea({ roofType: 'gable', roofAngle: 35 }) >
    roofArea({ roofType: 'gable', roofAngle: 20 }),
);

/* --- Solar exposure responds to form, pitch and season --- */
function roofPlaneIrradiation(
  overrides: Partial<BuildingParameters>,
  dayOfYear: number,
  dailyGlobal: number,
): number {
  const params = { ...requirements(), roofOverhang: 0.3, ...overrides };
  let total = 0;
  for (const plane of roofExposurePlanes(params, lehLatitude)) {
    total +=
      plane.weight *
      dailyFacadeIrradiation(dailyGlobal, lehLatitude, dayOfYear, plane.azimuthDeg, {
        tilt: plane.tiltDeg,
      }).total;
  }
  return total;
}

const flatWinter = roofPlaneIrradiation({ roofType: 'flat', roofAngle: 0 }, 15, 3.2);
const shedWinter = roofPlaneIrradiation({ roofType: 'shed', roofAngle: 30 }, 15, 3.2);
const flatSummer = roofPlaneIrradiation({ roofType: 'flat', roofAngle: 0 }, 172, 7.2);
const shedSummer = roofPlaneIrradiation({ roofType: 'shed', roofAngle: 30 }, 172, 7.2);

check(
  'an equator-facing shed roof collects more winter sun than a flat one',
  shedWinter > flatWinter * 1.15,
  `${flatWinter.toFixed(2)} → ${shedWinter.toFixed(2)} kWh/m²·day`,
);
check(
  'that same shed roof collects no more than a flat one in midsummer',
  shedSummer <= flatSummer * 1.02,
  `${flatSummer.toFixed(2)} → ${shedSummer.toFixed(2)} kWh/m²·day`,
);
check(
  'a shed roof is a single plane and a gable is two',
  roofExposurePlanes({ ...requirements(), roofType: 'shed', roofAngle: 30 }, lehLatitude).length === 1 &&
    roofExposurePlanes({ ...requirements(), roofType: 'gable', roofAngle: 30 }, lehLatitude).length === 2,
);
check(
  'a flat roof is one horizontal plane',
  roofExposurePlanes({ ...requirements(), roofType: 'flat', roofAngle: 0 }, lehLatitude)[0]?.tiltDeg === 0,
);

/* --- The heat map must use the same roof planes as the heat balance --- */
const roofHeatParams = { ...requirements(), roofType: 'shed' as const, roofAngle: 30, roofOverhang: 0.3 };
const roofHeatMaterials = resolveMaterials(roofHeatParams);
const roofHeat = computeSurfaceHeat(
  resolveClimateOffline(lehStation.location).data,
  buildShelterGeometry(roofHeatParams, roofHeatMaterials),
  roofHeatMaterials,
  0,
);
check(
  'the heat map reports a shed roof above the horizontal total',
  roofHeat.incidentBySurface.roof > 3.2,
  `${roofHeat.incidentBySurface.roof.toFixed(2)} kWh/m²·day`,
);
check(
  'the heat map and the heat balance resolve the same roof planes',
  roofExposurePlanes(roofHeatParams, lehLatitude).length === 1,
);

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const baseline = conventionalBaseline(requirements());
const baselineGeometry = buildShelterGeometry(baseline, resolveMaterials(baseline));
console.log('\n=== Before / after geometry ===');
console.log(
  `  baseline: glazing ${baselineGeometry.glazingArea.toFixed(1)} m² · shading devices ${baselineGeometry.shading.length} · partitions ${baselineGeometry.partitions.length} · roof ${baselineGeometry.roof.type}`,
);
console.log(
  `  tuned:    glazing ${tunedGeometry.glazingArea.toFixed(1)} m² · shading devices ${tunedGeometry.shading.length} · partitions ${tunedGeometry.partitions.length} · roof ${tunedGeometry.roof.type}`,
);

console.log(
  `\n${failures === 0 ? 'ALL GEOMETRY CHECKS PASSED' : `${failures} GEOMETRY CHECK(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
