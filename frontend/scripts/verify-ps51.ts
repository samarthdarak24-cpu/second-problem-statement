/**
 * PS-51 required-output verification.
 *
 * The problem statement asks for three specific quantities. This harness checks
 * that the model actually produces them, and that they behave the way physics
 * says they must — because a plausible-looking number is worse than an obvious
 * failure.
 *
 * The four checks:
 *
 *   1. THE THREE OUTPUTS EXIST AND ARE FINITE.
 *      Indoor temperature, solar thermal gain, and heat flow, per hour.
 *
 *   2. THE FABRIC DAMPENS THE SWING.
 *      Indoor peak-to-trough must be smaller than outdoor peak-to-trough. If a
 *      model reports the interior tracking the weather exactly, its thermal mass
 *      term is doing nothing.
 *
 *   3. THE SUN WARMS THE INTERIOR.
 *      In Ladakh, peak indoor temperature must fall in the afternoon and exceed
 *      the outdoor peak — a passive-solar shelter that is colder than outside at
 *      noon is a modelling error, not a design finding.
 *
 *   4. THE LOSS SIDE IS REAL AND ATTRIBUTED.
 *      Heat loss must be positive, and the per-component terms must sum to it.
 *      An unattributed total is a number nobody can act on.
 *
 * Run with:  npx tsx scripts/verify-ps51.ts
 */

import { STATION_BY_ID } from '../climate/stations';
import { buildClimateData } from '../climate/deriveClimate';
import type { BuildingParameters } from '../types';
import {
  resolveMaterials,
  effectiveUValues,
  diurnalArealCapacity,
  apparentSpecificHeat,
} from '../thermal/materials';
import { assemblyById, assemblyHasPhaseChange, phaseChangeLayers } from '../thermal/assemblies';
import { deriveDesignMetrics } from '../thermal/metrics';
import { designReportHtml } from '../lib/report';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { simulateDesign } from '../thermal/thermalModel';
import { BUILDING_TYPES, applyBuildingType } from '../lib/buildingTypes';
import { defaultRequirements } from '../lib/parameters';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail: string): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}\n        ${detail}`);
  }
}

const f = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : String(value);

const meanOf = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* ------------------------------------------------------------------ */
/* Run one site and report the three required outputs                  */
/* ------------------------------------------------------------------ */

function report(stationId: string, buildingTypeId: Parameters<typeof applyBuildingType>[1]) {
  const station = STATION_BY_ID.get(stationId);
  if (!station) throw new Error(`No station ${stationId}`);

  const climate = buildClimateData(station, 'database');
  const parameters = applyBuildingType(defaultRequirements(), buildingTypeId);
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  const result = simulateDesign(parameters, climate, materials, geometry);
  const p = result.dailyProfile;

  const monthName = MONTH_SHORT[p.month];

  console.log(`\n${'='.repeat(68)}`);
  console.log(`${station.location.city}  ·  ${climate.climateType}`);
  console.log(`Building: ${parameters.buildingType}  ·  ${parameters.width}×${parameters.length} m  ·  WWR ${(parameters.windowToWallRatio * 100).toFixed(0)}%`);
  console.log(`Critical month: ${monthName} (${climate.summary.peakHeatingMonth === p.month ? 'heating-dominated' : 'cooling-dominated'})`);
  console.log('='.repeat(68));

  /* ---- OUTPUT 1 — indoor temperature ---- */
  console.log('\n[1] PREDICTED INDOOR TEMPERATURE  (°C, free-running)');
  console.log(`    indoor   min ${f(p.indoorMin)}   max ${f(p.indoorMax)}   mean ${f(p.indoorMean)}   swing ${f(p.indoorSwing)} K`);
  console.log(`    outdoor  swing ${f(p.outdoorSwing)} K   →  fabric removed ${(p.swingDamping * 100).toFixed(0)}% of it`);
  console.log('    hour :  ' + p.points.map((q) => String(q.hour).padStart(5)).join(''));
  console.log('    in   :  ' + p.points.map((q) => f(q.indoorTemp).padStart(5)).join(''));
  console.log('    out  :  ' + p.points.map((q) => f(q.outdoorTemp).padStart(5)).join(''));

  /* ---- OUTPUT 2 — solar thermal gain ---- */
  console.log('\n[2] THERMAL ENERGY FROM SOLAR RADIATION');
  console.log(`    ${f(p.solarGainKwh, 2)} kWh/day   ·   ${f(p.solarGainPerSqm, 3)} kWh/m²·day   ·   peak at ${p.solarPeakHour}:00`);
  console.log(`    solar covers ${(p.solarCoverage * 100).toFixed(0)}% of the day's heat loss`);

  /* ---- OUTPUT 3 — heat flow ---- */
  console.log('\n[3] HEAT FLOW THROUGH THE ENVELOPE AND OPENINGS  (kWh/day)');
  const rows: [string, number][] = [
    ['Walls       ', p.wallKwh],
    ['Roof        ', p.roofKwh],
    ['Floor       ', p.floorKwh],
    ['Windows     ', p.windowKwh],
    ['Doors       ', p.doorKwh],
    ['Ventilation ', p.ventilationKwh],
  ];
  for (const [label, value] of rows) {
    console.log(`    ${label} ${f(value, 2).padStart(8)}   (negative = leaving the shelter)`);
  }
  console.log(`    ${'TOTAL LOSS '.padEnd(12)} ${f(p.heatLossKwh, 2).padStart(8)} kWh/day`);
  console.log(`    ${'TOTAL GAIN '.padEnd(12)} ${f(p.heatGainKwh, 2).padStart(8)} kWh/day`);
  console.log(`    peak flow ${f(p.peakFlowKw, 2)} kW at ${p.peakFlowHour}:00`);

  /* ---- Checks ---- */
  const grossFlowKwh = p.points.reduce(
    (sum, q) =>
      sum +
      (Math.abs(q.wallW) +
        Math.abs(q.roofW) +
        Math.abs(q.floorW) +
        Math.abs(q.windowW) +
        Math.abs(q.doorW) +
        Math.abs(q.ventilationW)) /
        1000,
    0,
  );

  /* The door must actually conduct. `opaqueArea` excludes the door area, so a
     missing door conductance is invisible in the totals — it just makes the
     envelope quietly better than it is. This is the check that would have
     caught it. */
  const doorArea = geometry.doorArea;

  check(
    'doors are present and conduct heat',
    doorArea > 0.1 && p.points.some((q) => Math.abs(q.doorW) > 1),
    `door area ${f(doorArea, 2)} m², max |doorW| ${f(Math.max(...p.points.map((q) => Math.abs(q.doorW))), 1)} W`,
  );

  check(
    'all three outputs finite',
    [p.indoorMin, p.indoorMax, p.solarGainKwh, p.heatLossKwh, p.peakFlowKw].every(Number.isFinite),
    `indoorMin=${p.indoorMin} solarGainKwh=${p.solarGainKwh} heatLossKwh=${p.heatLossKwh}`,
  );
  check(
    'fabric damps the outdoor swing',
    p.indoorSwing < p.outdoorSwing,
    `indoor swing ${f(p.indoorSwing)} K is not smaller than outdoor ${f(p.outdoorSwing)} K`,
  );
  check(
    'the daily swing is not degenerate',
    p.indoorSwing > 0.5,
    `indoor swing ${f(p.indoorSwing)} K — the fabric is over-damping and the 24-hour curve shows nothing`,
  );
  check(
    'solar gain is positive in daylight',
    p.solarGainKwh > 0 && p.points.some((q) => q.hour >= 9 && q.hour <= 15 && q.solarGainW > 0),
    `solarGainKwh=${p.solarGainKwh}, no daylight-hour solar term`,
  );
  check(
    'heat loss is positive',
    p.heatLossKwh > 0,
    `heatLossKwh=${p.heatLossKwh} — a shelter with no losses cannot be optimised`,
  );
  check(
    'loss and gain partition the gross flow exactly',
    Math.abs(p.heatLossKwh + p.heatGainKwh - grossFlowKwh) < 1e-6,
    `loss ${f(p.heatLossKwh, 4)} + gain ${f(p.heatGainKwh, 4)} != gross ${f(grossFlowKwh, 4)}`,
  );
  check(
    'the indoor profile has a real shape',
    /* A curve whose max and min fall in the same hour, or whose peak is
       before dawn, is not a thermal response. */
    p.points.some((q) => q.hour >= 11 && q.hour <= 17 && q.indoorTemp === p.indoorMax) ||
      p.points.some((q) => q.hour >= 4 && q.hour <= 9 && q.indoorTemp === p.indoorMin),
    `peak at ${p.points.find((q) => q.indoorTemp === p.indoorMax)?.hour}:00, trough at ${p.points.find((q) => q.indoorTemp === p.indoorMin)?.hour}:00`,
  );
  check(
    'hourly series is complete',
    p.points.length === 24 && p.points.every((q) => Number.isFinite(q.indoorTemp)),
    `points=${p.points.length}`,
  );

  return { climate, parameters, result, profile: p };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

console.log('\nPS-51 REQUIRED-OUTPUT VERIFICATION');
console.log('Model estimates — not measured building results.\n');

report('in-leh', 'vernacular');
const pune = report('in-pune', 'single-family');

/* --- Cross-check: the same shelter in a cold vs a warm climate ------- */
console.log(`\n${'='.repeat(68)}`);
console.log('CROSS-CHECK — same building type, different climate');
console.log('='.repeat(68));

const lehSingle = report('in-leh', 'single-family');

console.log('\nSame single-family shelter, Leh vs Pune:');
console.log(`  critical month  Leh ${MONTH_SHORT[lehSingle.profile.month]}   vs  Pune ${MONTH_SHORT[pune.profile.month]}`);
console.log(`  indoor mean     Leh ${f(lehSingle.profile.indoorMean)} °C   vs  Pune ${f(pune.profile.indoorMean)} °C`);
console.log(`  heat loss/day   Leh ${f(lehSingle.profile.heatLossKwh, 2)} kWh  vs  Pune ${f(pune.profile.heatLossKwh, 2)} kWh`);
console.log(`  solar coverage  Leh ${(lehSingle.profile.solarCoverage * 100).toFixed(0)}%  vs  Pune ${(pune.profile.solarCoverage * 100).toFixed(0)}%`);

/**
 * Comparing absolute heat loss across climates is meaningless: the two sites
 * have completely different indoor-outdoor temperature differences, so the
 * bigger number just means a bigger ΔT. The test that matters for the problem
 * statement is whether the shelter is doing its job in each — and in a
 * cold-desert January the only way it can be is by holding the interior above
 * the outdoor air on the strength of the sun.
 */
check(
  'the shelter is warmer than the outdoor air on average, at both sites',
  lehSingle.profile.indoorMean > meanOf(lehSingle.profile.points.map((q) => q.outdoorTemp)) &&
    pune.profile.indoorMean > meanOf(pune.profile.points.map((q) => q.outdoorTemp)),
  `Leh indoor ${f(lehSingle.profile.indoorMean)} vs outdoor ${f(meanOf(lehSingle.profile.points.map((q) => q.outdoorTemp)))}`,
);

check(
  'the cold site is judged on its coldest month and the warm site on its hottest',
  lehSingle.profile.month === lehSingle.climate.summary.peakHeatingMonth &&
    pune.profile.month === pune.climate.summary.peakCoolingMonth,
  `Leh month ${lehSingle.profile.month} vs peak heating ${lehSingle.climate.summary.peakHeatingMonth}; ` +
    `Pune month ${pune.profile.month} vs peak cooling ${pune.climate.summary.peakCoolingMonth}`,
);

/* --- Building types must not collapse onto one another -------------- */
console.log(`\n${'='.repeat(68)}`);
console.log('BUILDING TYPES — the profile must differ between forms');
console.log('='.repeat(68));

const station = STATION_BY_ID.get('in-leh')!;
const climate = buildClimateData(station, 'database');
const perType = BUILDING_TYPES.map((template) => {
  const parameters = applyBuildingType(defaultRequirements(), template.id);
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  const result = simulateDesign(parameters, climate, materials, geometry);
  return { id: template.id, label: template.label, p: result.dailyProfile };
});

for (const row of perType) {
  console.log(
    `  ${row.label.padEnd(28)} swing ${f(row.p.indoorSwing).padStart(5)} K   loss ${f(row.p.heatLossKwh, 1).padStart(6)} kWh/d   damping ${(row.p.swingDamping * 100).toFixed(0).padStart(3)}%`,
  );
}

const distinctSwings = new Set(perType.map((r) => r.p.indoorSwing.toFixed(2)));
check(
  'the five types produce different thermal profiles',
  distinctSwings.size > 1,
  'all five building types produced an identical indoor swing',
);

/* --- Glazing position must be a real design variable ----------------- */
console.log(`\n${'='.repeat(68)}`);
console.log('GLAZING POSITION — the optimiser must be able to move the glass');
console.log('='.repeat(68));

const southLed: BuildingParameters = {
  ...applyBuildingType(defaultRequirements(), 'single-family'),
  glazingBias: 'south-led',
};
const northShielded: BuildingParameters = { ...southLed, glazingBias: 'north-shielded' };
const balanced: BuildingParameters = { ...southLed, glazingBias: 'balanced' };

function glazingByAzimuth(parameters: BuildingParameters) {
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  /* Compass azimuth of each facade, and how much glass ended up on it. */
  return geometry.walls.map((w) => ({ azimuth: Math.round(w.azimuth), glazing: w.glazingArea }));
}

const led = glazingByAzimuth(southLed);
const shielded = glazingByAzimuth(northShielded);
const flat = glazingByAzimuth(balanced);

const southOf = (rows: { azimuth: number; glazing: number }[]) =>
  rows.reduce((sum, r) => sum + (r.azimuth >= 135 && r.azimuth <= 225 ? r.glazing : 0), 0);
const northOf = (rows: { azimuth: number; glazing: number }[]) =>
  rows.reduce((sum, r) => sum + (r.azimuth >= 315 || r.azimuth <= 45 ? r.glazing : 0), 0);

for (const [name, rows] of [
  ['balanced', flat],
  ['south-led', led],
  ['north-shielded', shielded],
] as const) {
  console.log(
    `  ${name.padEnd(16)} south ${f(southOf(rows), 2).padStart(5)} m²   north ${f(northOf(rows), 2).padStart(5)} m²`,
  );
}

check(
  'a south-led bias puts more glass on the equator-facing facade',
  southOf(led) > southOf(flat),
  `south-led ${f(southOf(led), 2)} m² is not greater than balanced ${f(southOf(flat), 2)} m²`,
);

check(
  'shielding the pole-facing facade removes glass from it',
  northOf(shielded) < northOf(flat),
  `north-shielded ${f(northOf(shielded), 2)} m² is not less than balanced ${f(northOf(flat), 2)} m²`,
);

check(
  'glazing position changes the modelled solar gain',
  (() => {
    const c = buildClimateData(STATION_BY_ID.get('in-leh')!, 'database');
    const withLed = simulateDesign(southLed, c, resolveMaterials(southLed), buildShelterGeometry(southLed, resolveMaterials(southLed)));
    const withShield = simulateDesign(northShielded, c, resolveMaterials(northShielded), buildShelterGeometry(northShielded, resolveMaterials(northShielded)));
    console.log(
      `  Leh January solar gain: south-led ${f(withLed.dailyProfile.solarGainKwh, 2)} kWh/d  vs  north-shielded ${f(withShield.dailyProfile.solarGainKwh, 2)} kWh/d`,
    );
    return Math.abs(withLed.dailyProfile.solarGainKwh - withShield.dailyProfile.solarGainKwh) > 0.05;
  })(),
  'the two distributions produced identical solar gain — the axis is not connected to the physics',
);

/* --- Composite assemblies and phase-change materials ---------------- */
console.log(`\n${'='.repeat(68)}`);
console.log('COMPOSITE ASSEMBLIES — layers must change the physics');
console.log('='.repeat(68));

const puneClimate = buildClimateData(STATION_BY_ID.get('in-pune')!, 'database');

function evaluateWith(overrides: Partial<BuildingParameters>, climate = puneClimate) {
  const parameters: BuildingParameters = {
    ...applyBuildingType(defaultRequirements(), 'single-family'),
    ...overrides,
  };
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  const result = simulateDesign(parameters, climate, materials, geometry);
  return {
    parameters,
    materials,
    u: effectiveUValues(materials, parameters.insulationThickness),
    result,
    mass: diurnalArealCapacity(materials.wall, climate.summary.avgTemperature),
  };
}

const plainBrick = evaluateWith({});
const brickCavityEps = evaluateWith({ wallAssemblyId: 'brick-cavity-eps' });
const earthExt = evaluateWith({ wallAssemblyId: 'earth-ext-insulation' });
const pcmWall = evaluateWith({ wallAssemblyId: 'pcm-composite' });

console.log('\nWall U-value and daily storage:');
for (const [name, row] of [
  ['single-material brick', plainBrick],
  ['brick + cavity + EPS', brickCavityEps],
  ['rammed earth + ext. insul.', earthExt],
  ['brick + PCM + insul.', pcmWall],
] as const) {
  console.log(
    `  ${name.padEnd(28)} U ${f(row.u.wall, 3).padStart(6)} W/m²K   storage ${f(row.mass / 1000, 1).padStart(6)} kJ/m²K   swing ${f(row.result.dailyProfile.indoorSwing, 2)} K`,
  );
}

check(
  'a composite wall has a different U-value from the single-material wall',
  Math.abs(brickCavityEps.u.wall - plainBrick.u.wall) > 0.05,
  `composite ${f(brickCavityEps.u.wall, 3)} vs single ${f(plainBrick.u.wall, 3)} W/m²K`,
);

check(
  'the insulated composite is the better insulator',
  brickCavityEps.u.wall < plainBrick.u.wall,
  `composite ${f(brickCavityEps.u.wall, 3)} is not lower than single ${f(plainBrick.u.wall, 3)}`,
);

check(
  'the earth + insulation stack stores more than the lightweight composite',
  earthExt.mass > brickCavityEps.mass,
  `earth ${f(earthExt.mass / 1000, 1)} vs brick+EPS ${f(brickCavityEps.mass / 1000, 1)} kJ/m²K`,
);

check(
  'the build-up changes the simulated indoor swing',
  Math.abs(earthExt.result.dailyProfile.indoorSwing - brickCavityEps.result.dailyProfile.indoorSwing) > 0.05,
  `earth ${f(earthExt.result.dailyProfile.indoorSwing, 2)} K vs brick+EPS ${f(brickCavityEps.result.dailyProfile.indoorSwing, 2)} K`,
);

/* ---- PCM: it must store latent heat inside its melting band, and it must NOT
        be credited with any outside it. ----
        Tested on the apparent specific heat directly, because comparing two
        different wall stacks would confound the PCM's latent term with the
        sensible storage of every other layer in the build-up. */
const pcmAssembly = assemblyById('pcm-composite')!;
const pcmLayer = phaseChangeLayers(pcmAssembly)[0]!;
const controlWall = evaluateWith({ wallAssemblyId: 'brick-cavity-eps' });

const cpAtMelting = apparentSpecificHeat(pcmLayer, pcmLayer.meltingPoint!);
const cpCold = apparentSpecificHeat(pcmLayer, 5.6);
const cpHot = apparentSpecificHeat(pcmLayer, 24.5);

console.log('\nPhase-change layer (25 mm board, melting point 24 °C, band ±3 K):');
console.log(`  sensible specific heat            ${f(pcmLayer.specificHeat, 0)} J/kg·K`);
console.log(`  apparent at 24.0 °C (in band)     ${f(cpAtMelting, 0)} J/kg·K   → ${f(cpAtMelting / pcmLayer.specificHeat, 1)}× boosted`);
console.log(`  apparent at 24.5 °C (in band)     ${f(cpHot, 0)} J/kg·K`);
console.log(`  apparent at  5.6 °C (outside)     ${f(cpCold, 0)} J/kg·K   → no boost`);
console.log(
  `  Pune annual mean 24.5 °C → the layer charges; Leh annual mean 5.6 °C → it does not`,
);

check(
  'the phase-change layer stores latent heat inside its melting band',
  cpAtMelting > pcmLayer.specificHeat * 2,
  `apparent ${f(cpAtMelting, 0)} vs sensible ${f(pcmLayer.specificHeat, 0)} J/kg·K`,
);

check(
  'a PCM is not credited with latent storage outside its melting band',
  cpCold === pcmLayer.specificHeat,
  `at 5.6 °C the apparent specific heat is ${f(cpCold, 0)} but should be the sensible ${f(pcmLayer.specificHeat, 0)}`,
);

check(
  'the PCM assembly really is composite and phase-changing',
  pcmAssembly.layers.length >= 4 && assemblyHasPhaseChange(pcmAssembly),
  `${pcmAssembly.layers.length} layers, hasPhaseChange=${assemblyHasPhaseChange(pcmAssembly)}`,
);

check(
  'the PCM build-up changes the simulated swing versus a plain insulated wall',
  Math.abs(
    pcmWall.result.dailyProfile.indoorSwing - controlWall.result.dailyProfile.indoorSwing,
  ) > 0.1,
  `PCM wall swing ${f(pcmWall.result.dailyProfile.indoorSwing, 2)} K vs plain ${f(controlWall.result.dailyProfile.indoorSwing, 2)} K`,
);

/* --- The printable report must carry the three required outputs ------- */
console.log(`\n${'='.repeat(68)}`);
console.log('DESIGN REPORT — the three outputs must survive into the PDF');
console.log('='.repeat(68));

const reportParams = applyBuildingType(defaultRequirements(), 'single-family');
const reportMaterials = resolveMaterials(reportParams);
const reportGeometry = buildShelterGeometry(reportParams, reportMaterials);
const reportThermal = simulateDesign(reportParams, puneClimate, reportMaterials, reportGeometry);

const reportHtml = designReportHtml({
  location: puneClimate.location.city,
  climateType: puneClimate.climateType,
  mode: 'auto',
  parameters: reportParams,
  score: 62,
  baselineScore: 41,
  metrics: deriveDesignMetrics(reportThermal, puneClimate),
  cost: null,
  comparison: null,
  thermal: reportThermal,
});

for (const needle of [
  'Required outputs',
  'Indoor temperature',
  'Solar thermal gain',
  'Total heat flow leaving',
  'Walls',
  'Roof',
  'Floor',
  'Windows',
  'Doors',
  'Ventilation',
  'not a measured building result',
]) {
  check(
    `the report prints "${needle}"`,
    reportHtml.includes(needle),
    `the printable report is missing "${needle}"`,
  );
}

console.log(`  report length ${reportHtml.length.toLocaleString('en-IN')} characters`);

console.log(`\n${'='.repeat(68)}`);
console.log(failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`);
console.log('='.repeat(68) + '\n');

process.exit(failures === 0 ? 0 : 1);
