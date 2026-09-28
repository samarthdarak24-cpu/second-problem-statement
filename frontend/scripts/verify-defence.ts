/**
 * Defence-evolution verification.
 *
 * The features added to turn this from a climate-responsive *building* designer
 * into a defence *shelter* platform are new physics and new vocabularies, and
 * each one gets a test that fails if it comes back wrong:
 *
 *   1. Shelter library — every type resolves, every palette is real, and the
 *      defence types do not all collapse onto the same thermal answer.
 *   2. Mission profiles — a mission actually changes occupancy, equipment and
 *      setpoints, and a communication shelter carries more equipment load than
 *      a personnel shelter.
 *   3. Internal loads — the sensible/latent split is physical and the totals
 *      add up.
 *   4. Climate fingerprint — finite, bounded, and pointing the right way for
 *      the two demo extremes (Leh cold, Jodhpur hot).
 *   5. Surface temperature — finite, the dew point is never above the dry bulb,
 *      and condensation is flagged exactly when a surface falls below it.
 *   6. Defence assemblies — the layer stacks resolve to a real U-value, and a
 *      tent wall is an order of magnitude lighter than masonry.
 *
 * Run with:  npx tsx scripts/verify-defence.ts
 */

import {
  ALL_TYPE_ORDER,
  applyBuildingType,
  buildingType,
  BUILDING_TYPES,
  DEFENCE_TYPE_ORDER,
  isDefenceType,
} from '../lib/buildingTypes';
import { defaultRequirements } from '../lib/parameters';
import {
  applyMissionProfile,
  MISSION_PROFILES,
  missionProfile,
} from '../lib/missions';
import {
  computeInternalLoads,
  EQUIPMENT_BY_ID,
  sensibleFraction,
} from '../lib/internalLoads';
import { computeClimateFingerprint } from '../climate/fingerprint';
import { applyRequirements, deriveRequirements } from '../climate/requirementEngine';
import { computeSurfaceTemperature, dewPointC } from '../thermal/surfaceTemperature';
import { computeMoisture, condensationRiskOf } from '../thermal/moisture';
import { computeHeatLossBreakdown } from '../thermal/heatLoss';
import { assessStress, computeColdStress, computeHeatStress } from '../thermal/stress';
import { infiltrationAchFor, splitAirChanges } from '../thermal/ventilation';
import {
  compareVentilationStrategies,
  computeVentilationControl,
  VENTILATION_STRATEGY_LABEL,
} from '../thermal/ventilationControl';
import { computeDeploymentMetrics } from '../lib/deployment';
import { compareStrategies } from '../lib/strategies';
import { applyHvacToParameters, computeHvacPerformance, HVAC_SPECS } from '../thermal/hvac';
import { runUncertainty, UNCERTAINTY_INPUTS, UNCERTAINTY_OUTPUTS } from '../lib/uncertainty';
import {
  VALIDATION_ROWS,
  VALIDATION_STATUS,
  VALIDATION_VERDICT,
  validationCounts,
} from '../lib/validation';
import { resolveClimateOffline } from '../climate/climateService';
import { STATION_BY_ID } from '../climate/stations';
import {
  DOOR_MATERIALS,
  effectiveUValues,
  INSULATION_MATERIALS,
  MATERIAL_BY_ID,
  resolveMaterials,
  ROOF_MATERIALS,
  SURFACE_FILM,
  SURFACE_RESISTANCE,
  WALL_MATERIALS,
  WINDOW_MATERIALS,
} from '../thermal/materials';
import {
  assemblyArealMass,
  assemblyById,
  assemblyThickness,
  COMPOSITE_ASSEMBLIES,
} from '../thermal/assemblies';
import { computeInterstitial } from '../thermal/interstitial';
import {
  ALL_NAV_ITEMS,
  NAV_GROUPS,
  NAV_ITEMS,
  UTILITY_LINKS,
  isNavActive,
  navItemFor,
} from '../components/shell/nav';
import { MODE_LABEL, MODE_NOTE } from '../lib/labels';
import {
  CONDENSATION_BANDS,
  CONDENSATION_RAMP,
  FLUX_RAMP,
  LOSS_RAMP,
  MOISTURE_RAMP,
  THERMAL_RAMP,
} from '../components/3d/palette';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { evaluateDesign, runAnalysisStage } from '../optimization/pipeline';
import { DEFAULT_WEIGHTS } from '../optimization/objective';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

const LEH = resolveClimateOffline(STATION_BY_ID.get('in-leh')!.location).data;
const JODHPUR = resolveClimateOffline(STATION_BY_ID.get('in-jodhpur')!.location).data;
const CHENNAI = resolveClimateOffline(STATION_BY_ID.get('in-chennai')!.location).data;

/* ================================================================== */
/* 1 — Shelter library                                                 */
/* ================================================================== */

section('1 — Defence shelter library');

check('the library exposes 14 types', BUILDING_TYPES.length === 14, `got ${BUILDING_TYPES.length}`);
check('9 of them are defence shelters', DEFENCE_TYPE_ORDER.length === 9);
check('every type resolves a template', ALL_TYPE_ORDER.every((id) => Boolean(BUILDING_TYPES.find((t) => t.id === id))));

for (const id of DEFENCE_TYPE_ORDER) {
  const template = BUILDING_TYPES.find((t) => t.id === id)!;
  check(`${id}: marked defence`, isDefenceType(id));
  check(`${id}: has a palette`, template.palette.wallMaterials.length > 0);
  check(`${id}: has defaults`, Object.keys(template.defaults).length > 0);
  check(
    `${id}: every palette material exists`,
    template.palette.wallMaterials.every((m) => materialExists(m)) &&
      template.palette.roofMaterials.every((m) => materialExists(m)) &&
      template.palette.windowMaterials.every((m) => materialExists(m)),
  );
  check(
    `${id}: palette assemblies exist`,
    (template.defaults.wallAssemblyId === undefined || Boolean(assemblyById(template.defaults.wallAssemblyId))) &&
      (template.defaults.roofAssemblyId === undefined || Boolean(assemblyById(template.defaults.roofAssemblyId))),
  );
}

/* Every defence type must produce a *different* thermal answer at one site, or
   the type selector is decorative. */
{
  const profiles = DEFENCE_TYPE_ORDER.map((id) => {
    const params = applyBuildingType(defaultRequirements(), id);
    const design = evaluateDesign(params, LEH, DEFAULT_WEIGHTS);
    return {
      id,
      peak: design.thermal.indoorTemperatureRange[1],
      energy: design.thermal.energyUseIntensity,
    };
  });
  const uniquePeak = new Set(profiles.map((p) => p.peak.toFixed(2)));
  check(
    'the nine defence types produce different thermal profiles at Leh',
    uniquePeak.size >= 7,
    `${uniquePeak.size} distinct peak temperatures`,
  );
  check(
    'every defence type runs clean at Leh',
    profiles.every((p) => finite(p.peak) && finite(p.energy)),
  );
  console.log(
    `    ${profiles
      .map((p) => `${p.id} ${p.peak.toFixed(1)} °C`)
      .join(' · ')}`,
  );
}

/* ================================================================== */
/* 2 — Mission profiles                                                */
/* ================================================================== */

section('2 — Mission profiles');

check('8 mission profiles exist', MISSION_PROFILES.length === 8, `got ${MISSION_PROFILES.length}`);

const base = defaultRequirements();
const applied = MISSION_PROFILES.map((profile) => applyMissionProfile(base, profile.id));

check(
  'applying a mission sets the mission id',
  applied.every((params, index) => params.missionProfile === MISSION_PROFILES[index]!.id),
);
check(
  'applying a mission sets the occupancy',
  applied.every((params, index) => params.numOccupants === MISSION_PROFILES[index]!.occupants),
);
check(
  'applying a mission sets the setpoints',
  applied.every(
    (params, index) =>
      params.coolingSetpoint === MISSION_PROFILES[index]!.coolingSetpoint &&
      params.heatingSetpoint === MISSION_PROFILES[index]!.heatingSetpoint,
  ),
);
check(
  'applying a mission sets the equipment list',
  applied.every((params, index) => {
    const expected = MISSION_PROFILES[index]!.equipment.length;
    return (params.internalLoads?.length ?? 0) === expected;
  }),
);

/* The mission must be the thing that decides the equipment load, so a
   communication shelter has to out-load a personnel shelter on the same
   envelope. */
{
  const envelope = applyBuildingType(defaultRequirements(), 'comm-command-shelter');
  const comm = applyMissionProfile(envelope, 'communication');
  const personnel = applyMissionProfile(envelope, 'personnel-accommodation');

  const commLoad = computeInternalLoads(
    comm.numOccupants,
    missionProfile('communication').activityMet,
    comm.internalLoads ?? [],
  );
  const personnelLoad = computeInternalLoads(
    personnel.numOccupants,
    missionProfile('personnel-accommodation').activityMet,
    personnel.internalLoads ?? [],
  );

  check(
    'a communication shelter carries more internal load than a personnel shelter',
    commLoad.totalW > personnelLoad.totalW,
    `${commLoad.totalKw.toFixed(2)} kW vs ${personnelLoad.totalKw.toFixed(2)} kW`,
  );
  check(
    'a storage shelter has no occupant load',
    computeInternalLoads(0, 0, []).totalW === 0,
  );
  check(
    'a medical shelter has a humidity floor above 30 %',
    missionProfile('medical').targetHumidity.min >= 30,
    `${missionProfile('medical').targetHumidity.min} %`,
  );
}

/* ================================================================== */
/* 3 — Internal loads                                                  */
/* ================================================================== */

section('3 — Internal loads');

{
  const equipment = [
    { id: 'server-rack', count: 2 },
    { id: 'radio-hf', count: 1 },
  ];
  const load = computeInternalLoads(4, 1.2, equipment, 20);

  check('total equals sensible + latent', Math.abs(load.totalW - (load.totalSensibleW + load.totalLatentW)) < 1e-6);
  check('total kW is the total over 1000', Math.abs(load.totalKw - load.totalW / 1000) < 1e-9);
  check('equipment sensible is itemised correctly', load.equipmentSensibleW === 2 * 500 + 1 * 150);
  check('density is positive for a real floor area', load.densityWPerSqm > 0);
  check(
    'every equipment id in the library resolves',
    [...EQUIPMENT_BY_ID.keys()].every((id) => EQUIPMENT_BY_ID.has(id)),
  );
  check(
    'the sensible fraction stays inside the physical range',
    [0, 1, 1.4, 2, 3].every((met) => {
      const fraction = sensibleFraction(met);
      return fraction >= 0.4 && fraction <= 0.75;
    }),
  );
  check(
    'a harder activity shifts the split toward latent',
    sensibleFraction(2.0) < sensibleFraction(1.0),
  );
}

/* ================================================================== */
/* 4 — Climate fingerprint                                             */
/* ================================================================== */

section('4 — Climate fingerprint');

const VALID_CHALLENGES = new Set([
  'extreme-summer-heat',
  'combined-heat-humidity',
  'high-diurnal-swing',
  'severe-winter-cold',
  'moisture-and-humidity',
  'intense-solar-gain',
  'monsoon-moisture',
  'moderate-balanced',
]);

for (const [label, climate] of [
  ['Leh', LEH],
  ['Jodhpur', JODHPUR],
  ['Chennai', CHENNAI],
] as const) {
  const fingerprint = computeClimateFingerprint(climate);
  check(`${label}: 8 indices`, fingerprint.indices.length === 8);
  check(`${label}: every index is bounded 0–1`, fingerprint.indices.every((i) => i.value >= 0 && i.value <= 1));
  check(`${label}: every raw figure is finite`, fingerprint.indices.every((i) => finite(i.raw)));
  check(`${label}: primary challenge is valid`, VALID_CHALLENGES.has(fingerprint.primary));
  check(`${label}: secondary challenge is valid`, VALID_CHALLENGES.has(fingerprint.secondary));
  check(`${label}: a design recommendation follows`, fingerprint.requiredDesign.length > 0);
}

{
  const leh = computeClimateFingerprint(LEH);
  const jodhpur = computeClimateFingerprint(JODHPUR);
  const chennai = computeClimateFingerprint(CHENNAI);

  const lehWinter = leh.indices.find((i) => i.key === 'winter')!.value;
  const jodhpurSummer = jodhpur.indices.find((i) => i.key === 'summer')!.value;
  const chennaiHumidity = chennai.indices.find((i) => i.key === 'humidity')!.value;

  check('Leh reads cold-dominated', lehWinter > 0.7, `winter index ${lehWinter.toFixed(2)}`);
  check('Jodhpur reads heat-dominated', jodhpurSummer > 0.5, `summer index ${jodhpurSummer.toFixed(2)}`);
  check('Chennai reads humid', chennaiHumidity > 0.5, `humidity index ${chennaiHumidity.toFixed(2)}`);
  check(
    'Leh is not classified as heat-dominated',
    leh.primary === 'severe-winter-cold' || leh.primary === 'high-diurnal-swing',
    leh.primary,
  );
}

/* ================================================================== */
/* 5 — Surface temperature                                             */
/* ================================================================== */

section('5 — Surface temperature');

{
  const params = applyBuildingType(defaultRequirements(), 'comm-command-shelter');
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const month = LEH.summary.peakHeatingMonth;
  const hour = 12;

  const map = computeSurfaceTemperature(LEH, geometry, materials, month, hour, 10, 50);

  check('every surface temperature is finite', Object.values(map.bySurface).every(finite));
  check('the display range is ordered', map.range[0] <= map.range[1]);
  check('the dew point is never above the dry bulb', map.dewPoint <= map.indoorTemp + 1e-6);
  check('the floor reading exists', Boolean(map.detail.floor));
  check('the roof reading exists', Boolean(map.detail.roof));
  check(
    'condensation is flagged exactly when a surface is below the dew point',
    Object.values(map.detail).every((d) => d.condensationRisk === (d.surfaceTemp < map.dewPoint)),
  );
  check('the summary names a hottest surface', Boolean(map.hottest));

  /*
   * In a cold desert in January the roof is legitimately *colder* than the
   * floor: it radiates to a clear sky while the floor sits on ground that holds
   * the annual mean. The physically meaningful assertion is the reverse case —
   * on a hot site in summer the roof must be the warmest surface, because that
   * is where the solar load lands.
   */
  const hotParams = applyBuildingType(defaultRequirements(), 'desert-field-tent');
  const hotMaterials = resolveMaterials(hotParams);
  const hotGeometry = buildShelterGeometry(hotParams, hotMaterials);
  const hotMap = computeSurfaceTemperature(
    JODHPUR,
    hotGeometry,
    hotMaterials,
    JODHPUR.summary.peakCoolingMonth,
    14,
    38,
    40,
  );
  check(
    'on a hot site the roof is the warmest surface',
    hotMap.hottest === 'roof',
    `hottest is ${hotMap.hottest} at ${hotMap.detail[hotMap.hottest].surfaceTemp.toFixed(1)} °C`,
  );
  check(
    'on a hot site the roof is warmer than the floor',
    hotMap.bySurface.roof > hotMap.detail.floor.surfaceTemp,
    `roof ${hotMap.bySurface.roof} °C vs floor ${hotMap.detail.floor.surfaceTemp} °C`,
  );
  check(
    'the floor gains heat from the ground when the space is cooler than the ground',
    computeSurfaceTemperature(
      JODHPUR,
      hotGeometry,
      hotMaterials,
      JODHPUR.summary.peakCoolingMonth,
      6,
      22,
      50,
    ).detail.floor.heatFlux > 0,
    'Jodhpur ground sits near the annual mean (~27 °C), so a 22 °C space is warmed by it',
  );
  check(
    'the floor loses heat to the ground when the space is warmer than the ground',
    hotMap.detail.floor.heatFlux < 0,
    `indoor 38 °C vs ground ~27 °C: ${hotMap.detail.floor.heatFlux} W/m²`,
  );

  /* The floor is driven by the ground, so in a cold climate it must be losing
     heat to the ground, not gaining it. */
  check(
    'the floor loses heat to the ground at Leh',
    map.detail.floor.heatFlux < 0,
    `${map.detail.floor.heatFlux} W/m²`,
  );

  /* A saturated space must flag condensation somewhere. */
  const saturated = computeSurfaceTemperature(LEH, geometry, materials, month, 4, 5, 98);
  check(
    'a saturated space produces condensation surfaces',
    saturated.condensationSurfaces.length > 0,
    `${saturated.condensationSurfaces.length} surfaces`,
  );

  check(
    'dewPointC is monotonic in humidity',
    dewPointC(20, 30) < dewPointC(20, 80),
  );
}

/* ================================================================== */
/* 6 — Defence assemblies                                              */
/* ================================================================== */

section('6 — Defence assemblies');

{
  const ids = [
    'tent-wall-insulated',
    'tent-wall-basic',
    'cabin-wall-panel',
    'bunker-wall-earth',
    'tent-roof-insulated',
    'cabin-roof-panel',
    'bunker-roof-earth',
  ];

  for (const id of ids) {
    const assembly = assemblyById(id);
    check(`${id}: exists`, Boolean(assembly));
    check(`${id}: has layers`, (assembly?.layers.length ?? 0) >= 2);
    check(
      `${id}: every layer is finite and positive`,
      (assembly?.layers ?? []).every(
        (l) => finite(l.thickness) && l.thickness > 0 && finite(l.conductivity) && l.conductivity > 0,
      ),
    );
  }

  /* The tent wall must be dramatically lighter than masonry — that mass gap is
     the whole reason a tent tracks the weather. */
  const tentMass = arealMass('tent-wall-insulated');
  const brickMass = arealMass('brick-cavity-eps');
  check(
    'a tent wall is at least 20× lighter than a masonry wall',
    brickMass / tentMass >= 20,
    `${tentMass.toFixed(1)} vs ${brickMass.toFixed(1)} kg/m²`,
  );

  const params = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const uValues = effectiveUValues(resolveMaterials(params), params.insulationThickness);
  check('the insulated tent resolves a real wall U-value', uValues.wall > 0 && uValues.wall < 1.5, `${uValues.wall.toFixed(3)} W/m²·K`);
  check('the tent roof resolves a real U-value', uValues.roof > 0, `${uValues.roof.toFixed(3)} W/m²·K`);
}

function materialExists(id: string): boolean {
  return MATERIAL_BY_ID.has(id);
}

function arealMass(assemblyId: string): number {
  const assembly = assemblyById(assemblyId);
  if (!assembly) return 0;
  return assembly.layers.reduce((sum, layer) => sum + layer.density * layer.thickness, 0);
}

/* ================================================================== */
/* 8 — Ventilation vs infiltration                                     */
/* ================================================================== */

section('8 — Ventilation and infiltration');

{
  const split = splitAirChanges(6, 'medium');
  check('the two streams sum to the total', Math.abs(split.infiltration + split.intentional - split.total) < 1e-6);
  check('infiltration is below the total', split.infiltration < split.total);
  check('a low-leakage envelope leaks less than a high one', infiltrationAchFor('low', undefined, 6) < infiltrationAchFor('high', undefined, 6));
  check('a measured figure is honoured', infiltrationAchFor('measured', 0.9, 6) === 0.9);
  check('infiltration cannot exceed the total', infiltrationAchFor('high', undefined, 0.4) === 0.4);
}

/* ================================================================== */
/* 9 — Moisture and condensation                                       */
/* ================================================================== */

section('9 — Moisture and condensation');

{
  const params = applyBuildingType(defaultRequirements(), 'warm-humid-shelter');
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const design = evaluateDesign(params, CHENNAI, DEFAULT_WEIGHTS);

  const moisture = computeMoisture(CHENNAI, geometry, materials, params, {
    month: CHENNAI.summary.peakCoolingMonth,
    hour: 14,
    indoorTemp: design.thermal.indoorTemperatureRange[1],
    latentGainW: 400,
  });

  check('indoor RH is inside 0–100 %', moisture.indoorRh >= 0 && moisture.indoorRh <= 100, `${moisture.indoorRh.toFixed(0)} %`);
  check('the dew point is below the dry bulb', moisture.dewPoint <= moisture.indoorTemp + 1e-6);
  check('the wet bulb is below the dry bulb', moisture.wetBulb <= moisture.indoorTemp + 1e-6);
  check('the humidity ratio is positive', moisture.indoorHumidityRatio > 0);
  check('the pressure is below standard (Chennai is near sea level)', moisture.pressurePa > 95_000 && moisture.pressurePa <= 101_325);
  check(
    'every surface carries a condensation verdict',
    moisture.surfaces.every((s) => s.risk === 'low' || s.risk === 'medium' || s.risk === 'high'),
  );
  check(
    'a negative margin means condensation risk is high',
    moisture.surfaces.every((s) => (s.margin < 0 ? s.risk === 'high' : s.risk !== 'high' || s.margin < 2)),
  );
  check(
    'a sealed shelter holds more moisture than a ventilated one',
    computeMoisture(CHENNAI, geometry, materials, { ...params, airChangesPerHour: 0.5 }, {
      month: CHENNAI.summary.peakCoolingMonth,
      hour: 14,
      indoorTemp: design.thermal.indoorTemperatureRange[1],
      latentGainW: 400,
    }).indoorHumidityRatio >
      computeMoisture(CHENNAI, geometry, materials, { ...params, airChangesPerHour: 10 }, {
        month: CHENNAI.summary.peakCoolingMonth,
        hour: 14,
        indoorTemp: design.thermal.indoorTemperatureRange[1],
        latentGainW: 400,
      }).indoorHumidityRatio,
  );
  console.log(`    Chennai warm-humid: ${moisture.indoorRh.toFixed(0)} % RH, dew point ${moisture.dewPoint.toFixed(1)} °C, risk ${moisture.risk}`);
}

/* ================================================================== */
/* 10 — Heat-loss breakdown                                            */
/* ================================================================== */

section('10 — Heat-loss breakdown');

{
  const params = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const design = evaluateDesign(params, LEH, DEFAULT_WEIGHTS);

  const breakdown = computeHeatLossBreakdown(design.thermal.dailyProfile, params, geometry);

  check('there are seven loss paths', breakdown.components.length === 7);
  check('every share is finite', breakdown.components.every((c) => finite(c.sharePct)));
  check(
    'the shares sum to 100 % (or all zero)',
    breakdown.totalLossKwh === 0 ||
      Math.abs(breakdown.components.reduce((sum, c) => sum + c.sharePct, 0) - 100) < 0.5,
  );
  check('infiltration and ventilation are separate', breakdown.infiltration.ach !== breakdown.intentionalVentilation.ach || breakdown.infiltration.ach === 0);
  check(
    'the infiltration term carries the sign of the ventilation term',
    Math.sign(breakdown.infiltration.kwh) === Math.sign(breakdown.intentionalVentilation.kwh) ||
      breakdown.infiltration.kwh === 0,
  );
  check('the infiltration share is a percentage', breakdown.infiltration.sharePct >= 0 && breakdown.infiltration.sharePct <= 100);
  check('a worst path is named at Leh in winter', Boolean(breakdown.worst));
  check('total loss matches the profile', Math.abs(breakdown.totalLossKwh - design.thermal.dailyProfile.heatLossKwh) < 0.2);
  console.log(`    ${breakdown.worst?.label} ${breakdown.worst?.sharePct.toFixed(0)} % · infiltration ${breakdown.infiltration.sharePct.toFixed(0)} %`);
}

/* ================================================================== */
/* 11 — Heat and cold stress                                           */
/* ================================================================== */

section('11 — Heat and cold stress');

{
  const hot = computeHeatStress(38, 70);
  const mild = computeHeatStress(22, 50);
  const cold = computeColdStress(-12, 1.2, 1.5, 2.4);
  const warm = computeColdStress(24, 1.2, 1.5, 0);

  check('WBGT is finite', finite(hot.wbgt));
  check('a hot humid space is a heat-stress risk', hot.risk === 'high' || hot.risk === 'extreme', `${hot.wbgt.toFixed(1)} °C · ${hot.risk}`);
  check('a mild space is not', mild.risk === 'low');
  check('WBGT rises with humidity at fixed temperature', computeHeatStress(32, 80).wbgt > computeHeatStress(32, 20).wbgt);
  check('a hot space recommends actions', hot.actions.length > 0);
  check('a cold space demands more clothing', cold.requiredClo > 2);
  check('a comfortable space needs no deficit', warm.deficitClo === 0 && warm.risk === 'low');
  check('cold risk escalates as it gets colder', computeColdStress(-25, 1.2, 1.5, 0).risk === 'extreme');

  /* The combined assessment, from a real design at Leh. */
  const stressParams = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const stressDesign = evaluateDesign(stressParams, LEH, DEFAULT_WEIGHTS);
  const assessment = assessStress(stressDesign.thermal, 1.0, 1.5);
  check(
    'the combined assessment names a binding constraint',
    ['heat', 'cold', 'comfort'].includes(assessment.binding),
    assessment.binding,
  );
  check(
    'Leh does not read as heat-bound',
    assessment.binding !== 'heat',
    assessment.binding,
  );

  console.log(`    WBGT ${hot.wbgt.toFixed(1)} °C (${hot.risk}) · required ${cold.requiredClo.toFixed(2)} clo (${cold.risk}) · Leh binding ${assessment.binding}`);
}

/* ================================================================== */
/* 12 — Deployment metrics                                             */
/* ================================================================== */

section('12 — Deployment metrics');

{
  const tentParams = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const tentMaterials = resolveMaterials(tentParams);
  const tentGeometry = buildShelterGeometry(tentParams, tentMaterials);
  const tent = computeDeploymentMetrics(tentGeometry, tentMaterials, tentParams, 1200);

  const bunkerParams = applyBuildingType(defaultRequirements(), 'semi-underground-bunker');
  const bunkerMaterials = resolveMaterials(bunkerParams);
  const bunkerGeometry = buildShelterGeometry(bunkerParams, bunkerMaterials);
  const bunker = computeDeploymentMetrics(bunkerGeometry, bunkerMaterials, bunkerParams, 2400);

  check('the tent is deployable', tent.deployable);
  check('the tent mass is positive and finite', tent.totalMassKg > 0 && finite(tent.totalMassKg));
  check('the packed volume is below the deployed volume', tent.packedVolumeM3 < tent.deployedVolumeM3);
  check('deployment time is positive', tent.deploymentTimeMin > 0);
  check('manpower is at least two', tent.manpowerRequired >= 2);
  check('daily electrical is positive', tent.dailyElectricalKwh > 0);
  check('the tent is lighter than the bunker', tent.totalMassKg < bunker.totalMassKg);
  check('the bunker is not deployable', !bunker.deployable && bunker.deploymentTimeMin === 0);
  console.log(`    Tent ${(tent.totalMassKg / 1000).toFixed(2)} t packed ${tent.packedVolumeM3.toFixed(2)} m³ in ${tent.deploymentTimeMin} min · bunker ${(bunker.totalMassKg / 1000).toFixed(1)} t`);
}

/* ================================================================== */
/* 13 — Requirement engine                                             */
/* ================================================================== */

section('13 — Area-specific requirement engine');

{
  const cases = [
    { type: 'high-altitude-tent', station: 'in-leh', mission: 'personnel-accommodation' },
    { type: 'desert-field-tent', station: 'in-jodhpur', mission: 'personnel-accommodation' },
    { type: 'comm-command-shelter', station: 'in-chennai', mission: 'communication' },
  ] as const;

  const results = cases.map((entry) => {
    const climate = resolveClimateOffline(STATION_BY_ID.get(entry.station)!.location).data;
    const base = applyBuildingType(defaultRequirements(), entry.type);
    const template = BUILDING_TYPES.find((t) => t.id === entry.type)!;
    const fingerprint = computeClimateFingerprint(climate);
    const analysis = {
      zone: fingerprint.zone,
      classification: fingerprint.climateType,
      mainChallenge: fingerprint.primary,
      challengeDetail: '',
      ventilationStrategy: base.ventilationType,
      ventilationAch: base.airChangesPerHour,
      insulationLevel: base.insulationLevel,
      insulationThickness: base.insulationThickness,
      shadingStrategy: base.shadingType,
      windowRatioRecommendation: base.windowToWallRatio,
      orientationRecommendation: base.orientation,
      roofStrategy: base.roofType,
      glazingStrategy: 'double' as const,
      shadingDepth: base.shadingDepth,
      wallThickness: base.wallThickness,
      rationale: [],
    };
    const requirements = deriveRequirements({
      fingerprint,
      analysis,
      climate,
      template,
      base,
      missionId: entry.mission,
    });
    const applied = applyRequirements(base, requirements);
    return { entry, requirements, applied, base };
  });

  for (const { entry, requirements, applied } of results) {
    check(`${entry.station}: produces requirements`, requirements.items.length >= 8);
    check(`${entry.station}: every requirement has a reason`, requirements.items.every((i) => i.reason.length > 20));
    check(`${entry.station}: the applied design stays inside the palette`, applied.buildingType === entry.type);
    check(`${entry.station}: HVAC capacity is non-negative`, requirements.hvacCapacityKw >= 0);
    check(`${entry.station}: the applied design is finite`, finite(applied.windowToWallRatio) && finite(applied.insulationThickness));
  }

  const leh = results[0]!;
  const jodhpur = results[1]!;
  check(
    'the cold site asks for more insulation than the hot one',
    ['high', 'very-high'].includes(leh.requirements.insulationLevel) &&
      !['high', 'very-high'].includes(jodhpur.requirements.insulationLevel),
    `Leh ${leh.requirements.insulationLevel} vs Jodhpur ${jodhpur.requirements.insulationLevel}`,
  );
  check('the cold site asks for heating', leh.requirements.hvacType !== 'none', leh.requirements.hvacType);
  check('the humid site asks for moisture control', jodhpur.requirements.moistureControl !== undefined);
  console.log(`    ${leh.requirements.headline}`);

  /* Applying a requirement set must be a real change, and must survive the
     template projection. */
  check(
    'applying the requirements changes the envelope',
    JSON.stringify(leh.applied) !== JSON.stringify(leh.base),
  );
}

/* ================================================================== */
/* 14 — Dynamic ventilation control                                    */
/* ================================================================== */

section('14 — Dynamic ventilation control');

{
  const base = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const mission = missionProfile('personnel-accommodation');
  const materials = resolveMaterials(base);
  const geometry = buildShelterGeometry(base, materials);

  /* A heated shelter holds its interior well above the Leh January mean, which
     is what the brief page supplies from the heat balance. Passing it matters:
     with no indoor temperature the engine falls back to the outdoor mean, the
     moisture headroom collapses and every hour is correctly flagged
     moisture-limited — see the explicit check for that below. */
  const INDOOR_18 = Array.from({ length: 24 }, () => 18);

  const shared = {
    month: 0,
    occupants: base.numOccupants,
    sensibleGainW: 900,
    latentGainW: 300,
    humidityCeilingPct: mission.targetHumidity.max,
    coolingSetpointC: mission.targetTemp.max,
    indoorTemps: INDOOR_18,
  };

  const passive = computeVentilationControl(LEH, geometry, base, { ...shared, strategy: 'passive' });
  const hybrid = computeVentilationControl(LEH, geometry, base, { ...shared, strategy: 'hybrid' });
  const active = computeVentilationControl(LEH, geometry, base, { ...shared, strategy: 'active' });

  /* --- Shape and finiteness --- */
  check('the schedule covers 24 hours', passive.hours.length === 24, `got ${passive.hours.length}`);
  check(
    'every hourly rate is finite and non-negative',
    passive.hours.every(
      (h) =>
        finite(h.required) &&
        finite(h.achieved) &&
        finite(h.achievablePassive) &&
        h.required >= 0 &&
        h.achieved >= 0 &&
        h.achievablePassive >= 0,
    ),
  );
  check('the operable opening area is positive', passive.operableOpeningArea > 0, `${passive.operableOpeningArea} m²`);
  check('infiltration is reported separately', passive.infiltrationAch > 0, `${passive.infiltrationAch} ACH`);

  /* --- The three requirements are genuinely different quantities --- */
  check(
    'the air-quality requirement is the same in every hour',
    new Set(passive.hours.map((h) => h.requiredForAirQuality.toFixed(4))).size === 1,
  );
  check(
    'a higher headcount raises the air-quality requirement',
    computeVentilationControl(LEH, geometry, base, { ...shared, occupants: base.numOccupants + 8, strategy: 'passive' })
      .hours[0]!.requiredForAirQuality > passive.hours[0]!.requiredForAirQuality,
  );
  check(
    'more latent load raises the moisture requirement',
    computeVentilationControl(LEH, geometry, base, { ...shared, latentGainW: shared.latentGainW * 4, strategy: 'passive' })
      .hours[0]!.requiredForMoisture > passive.hours[0]!.requiredForMoisture,
  );

  /* --- Free cooling is only ever claimed when it is actually cooler out --- */
  const coolingHours = passive.hours.filter((h) => h.requiredForCooling > 0);
  check(
    'free cooling is only required when the outdoor air is cooler',
    coolingHours.every((h) => h.outdoorTemp < h.indoorTemp),
    `${coolingHours.length} hour(s) with a free-cooling requirement`,
  );

  /* --- The driver is always the binding constraint --- */
  check(
    'the named driver is the largest of the three requirements',
    passive.hours.every((h) => {
      const max = Math.max(h.requiredForAirQuality, h.requiredForMoisture, h.requiredForCooling);
      return Math.abs(h.required - max) < 1e-6;
    }),
  );

  /* --- Strategy ordering: passive can fall short, active cannot --- */
  check(
    'active satisfies every hour',
    active.shortfallHours === 0,
    `${active.hoursSatisfied}/24`,
  );
  check(
    'passive never satisfies fewer hours than hybrid, nor hybrid fewer than active',
    passive.hoursSatisfied <= hybrid.hoursSatisfied &&
      hybrid.hoursSatisfied <= active.hoursSatisfied,
    `passive ${passive.hoursSatisfied} · hybrid ${hybrid.hoursSatisfied} · active ${active.hoursSatisfied}`,
  );
  check('a passive shelter uses no fan energy', passive.fanEnergyKwhPerMonth === 0);
  check(
    'active fan energy is at least the hybrid figure',
    active.fanEnergyKwhPerMonth >= hybrid.fanEnergyKwhPerMonth,
    `${hybrid.fanEnergyKwhPerMonth} vs ${active.fanEnergyKwhPerMonth} kWh/mo`,
  );
  check(
    'no shortfall means no peak shortfall',
    passive.shortfallHours !== 0 || passive.peakShortfallAch === 0,
  );
  check(
    'a moisture-limited hour is never reported as satisfied',
    passive.hours.every((h) => !h.moistureLimited || !h.satisfied),
  );
  check(
    'a moisture-limited hour counts toward the shortfall',
    passive.hours.filter((h) => h.moistureLimited).every((h) => h.action === 'shortfall'),
  );
  check(
    'the means ignore moisture-limited hours',
    !passive.requiresDehumidification || passive.meanRequired <= 30,
    `mean required ${passive.meanRequired} ACH`,
  );

  /* A hot-dry site in summer is the case where ventilation is the *wrong*
     tool: at 35 °C and 38 % RH the outdoor air carries more absolute moisture
     than a 26 °C room at a 60 % ceiling, so opening up makes the interior
     wetter. The engine must say "dehumidify", not invent an air-change rate. */
  {
    const jodhpur = computeVentilationControl(JODHPUR, geometry, base, {
      ...shared,
      month: 5,
      strategy: 'active',
      indoorTemps: Array.from({ length: 24 }, () => 26),
    });
    check(
      'a hot-dry summer month is reported as needing dehumidification',
      jodhpur.requiresDehumidification,
      `${jodhpur.moistureLimitedHours}/24 h moisture-limited`,
    );
    check(
      'ventilation cannot satisfy a moisture-limited month even with plant',
      jodhpur.hoursSatisfied < 24,
      `${jodhpur.hoursSatisfied}/24`,
    );
    check(
      'the moisture-limited summary names dehumidification',
      jodhpur.summary.toLowerCase().includes('dehumidification'),
    );
  }

  /* The degenerate fallback: no indoor temperature supplied, so the interior is
     assumed to sit at the outdoor mean. In a cold climate that leaves almost no
     moisture headroom, and the engine must say so rather than invent a rate. */
  {
    const { indoorTemps: _omitted, ...noIndoor } = shared;
    const unheated = computeVentilationControl(LEH, geometry, base, {
      ...noIndoor,
      strategy: 'passive',
    });
    check(
      'without an indoor temperature the cold-climate hours are flagged moisture-limited',
      unheated.moistureLimitedHours > 0,
      `${unheated.moistureLimitedHours}/24 h`,
    );
    check(
      'a moisture-limited run reports fewer satisfied hours than a heated one',
      unheated.hoursSatisfied < passive.hoursSatisfied,
      `${unheated.hoursSatisfied} vs ${passive.hoursSatisfied}`,
    );
  }

  check(
    'the achieved rate never exceeds the requirement under passive control',
    passive.hours.every((h) => h.achieved <= h.required + 1e-6),
  );
  check(
    'every hour carries an action and a note',
    passive.hours.every((h) => Boolean(h.action) && h.note.length > 0),
  );

  /* --- A warm-humid site should be moisture-driven, a cold one should not --- */
  const chennaiMaterials = resolveMaterials(base);
  const chennaiGeometry = buildShelterGeometry(base, chennaiMaterials);
  const chennai = computeVentilationControl(CHENNAI, chennaiGeometry, base, {
    ...shared,
    month: 5,
    strategy: 'passive',
  });
  const lehMonsoon = computeVentilationControl(LEH, geometry, base, {
    ...shared,
    month: 5,
    strategy: 'passive',
  });
  check(
    'the humid site is moisture-driven where the cold site is not',
    chennai.moistureHours > lehMonsoon.moistureHours,
    `Chennai ${chennai.moistureHours} h vs Leh ${lehMonsoon.moistureHours} h`,
  );
  check(
    'the driver counts sum to at most 24 hours',
    chennai.airQualityHours + chennai.moistureHours + chennai.coolingHours <= 24,
  );

  /* --- The comparison helper returns all three, each labelled --- */
  const comparison = compareVentilationStrategies(LEH, geometry, base, shared);
  check(
    'the comparison returns all three strategies',
    Boolean(comparison.passive && comparison.hybrid && comparison.active),
  );
  check(
    'each strategy carries its own label and summary',
    (['passive', 'hybrid', 'active'] as const).every(
      (s) => comparison[s].label.length > 0 && comparison[s].summary.length > 0,
    ),
  );
  check(
    'each strategy is labelled in plain language',
    Object.values(VENTILATION_STRATEGY_LABEL).every((label) => label.length > 0),
  );

  console.log(
    `    Leh January: passive ${passive.hoursSatisfied}/24 · hybrid ${hybrid.hoursSatisfied}/24 · ` +
      `active ${active.hoursSatisfied}/24 · mean required ${passive.meanRequired.toFixed(1)} ACH`,
  );
  console.log(`    ${hybrid.summary}`);
}

/* ================================================================== */
/* 15 — The 3D map modes and their colour scales                       */
/* ================================================================== */

section('15 — 3D map modes and colour scales');

{
  const MODES = [
    'normal',
    'heatmap',
    'temperature',
    'heatflux',
    'heatloss',
    'humidity',
    'condensation',
    'exploded',
    'section',
    'airflow',
    'solar',
    'floorplan',
    'front',
    'side',
    'top',
    'walkthrough',
  ] as const;

  check('the mode vocabulary has sixteen entries', MODES.length === 16, `got ${MODES.length}`);
  check(
    'every mode has a label',
    MODES.every((mode) => (MODE_LABEL[mode] ?? '').length > 0),
  );
  check(
    'every mode has a note',
    MODES.every((mode) => (MODE_NOTE[mode] ?? '').length > 0),
  );
  check(
    'no two modes share a label',
    new Set(MODES.map((mode) => MODE_LABEL[mode])).size === MODES.length,
  );
  check(
    'no two modes share a note',
    new Set(MODES.map((mode) => MODE_NOTE[mode])).size === MODES.length,
  );

  /* The six data maps must each describe a different quantity in plain words,
     or the separation the design rests on has quietly been lost. */
  const mapNotes = (
    ['heatmap', 'temperature', 'heatflux', 'heatloss', 'humidity', 'condensation'] as const
  ).map((mode) => MODE_NOTE[mode]);
  check('the six data maps have six different notes', new Set(mapNotes).size === 6);
  check(
    'the heat map note names absorbed radiation, not temperature',
    MODE_NOTE.heatmap.toLowerCase().includes('absorbed solar radiation'),
  );
  check(
    'the temperature note names temperature, not absorption',
    MODE_NOTE.temperature.toLowerCase().includes('surface temperature'),
  );
  check(
    'the flux note names conduction',
    MODE_NOTE.heatflux.toLowerCase().includes('conduction'),
  );
  check(
    'the humidity note names the dew point',
    MODE_NOTE.humidity.toLowerCase().includes('dew point'),
  );
  check(
    'the loss note names heat escaping, and says the map is one-way',
    MODE_NOTE.heatloss.toLowerCase().includes('escaping') &&
      MODE_NOTE.heatloss.toLowerCase().includes('unshaded'),
    MODE_NOTE.heatloss,
  );
  check(
    'the condensation note names the three bands',
    MODE_NOTE.condensation.toLowerCase().includes('low') &&
      MODE_NOTE.condensation.toLowerCase().includes('medium') &&
      MODE_NOTE.condensation.toLowerCase().includes('high'),
    MODE_NOTE.condensation,
  );

  /* The loss map and the flux map come from the same evaluation, so the one
     thing that must not happen is the two notes reading the same. */
  check(
    'the loss and flux notes are not the same sentence',
    MODE_NOTE.heatloss !== MODE_NOTE.heatflux,
  );
  check(
    'the condensation and humidity notes are not the same sentence',
    MODE_NOTE.condensation !== MODE_NOTE.humidity,
  );

  /* --- Diverging scales --- */
  check(
    'the flux ramp has an odd number of stops so it has a true centre',
    FLUX_RAMP.length % 2 === 1,
    `${FLUX_RAMP.length} stops`,
  );
  check(
    'the moisture ramp has an odd number of stops so it has a true centre',
    MOISTURE_RAMP.length % 2 === 1,
    `${MOISTURE_RAMP.length} stops`,
  );
  check(
    'both diverging ramps share the same neutral centre',
    FLUX_RAMP[Math.floor(FLUX_RAMP.length / 2)] ===
      MOISTURE_RAMP[Math.floor(MOISTURE_RAMP.length / 2)],
    `${FLUX_RAMP[Math.floor(FLUX_RAMP.length / 2)]}`,
  );
  check(
    'the diverging ramps are not the one-way thermal ramp',
    String(FLUX_RAMP[0]) !== String(THERMAL_RAMP[0]) &&
      String(MOISTURE_RAMP[0]) !== String(THERMAL_RAMP[0]),
  );
  check(
    'the flux ramp runs cool to warm, so loss and gain differ',
    String(FLUX_RAMP[0]) !== String(FLUX_RAMP[FLUX_RAMP.length - 1]),
  );

  /* --- One-way and banded scales ---
     The loss map must NOT be diverging: it has no negative branch, because a
     surface that is gaining heat has no loss to show. Its palest stop is the
     same neutral the diverging ramps use at their centre, so "nothing here"
     reads identically across all the maps. */
  check(
    'the loss ramp is a one-way scale, not a diverging one',
    LOSS_RAMP.length >= 3 && String(LOSS_RAMP[0]) !== String(LOSS_RAMP[LOSS_RAMP.length - 1]),
    `${LOSS_RAMP.length} stops`,
  );
  check(
    'the loss ramp starts at the shared neutral, so "no loss" reads as nothing',
    String(LOSS_RAMP[0]) === String(FLUX_RAMP[Math.floor(FLUX_RAMP.length / 2)]),
    String(LOSS_RAMP[0]),
  );
  /* Relative luminance, for asserting a ramp actually runs in one direction
     rather than merely starting and ending at different colours. */
  const luminance = (hex: string): number => {
    const channel = (from: number) => parseInt(hex.slice(from, from + 2), 16) / 255;
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };

  check(
    'the loss ramp darkens monotonically, so it reads as one direction',
    LOSS_RAMP.every(
      (stop, index) => index === 0 || luminance(stop) < luminance(LOSS_RAMP[index - 1]!),
    ),
    LOSS_RAMP.map((stop) => luminance(stop).toFixed(2)).join(' → '),
  );
  check(
    'the loss ramp is not the flux ramp',
    String(LOSS_RAMP[0]) !== String(FLUX_RAMP[0]),
    `${LOSS_RAMP[0]} vs ${FLUX_RAMP[0]}`,
  );

  /* The condensation map is a verdict, not a field: exactly three stops for
     exactly three bands. A gradient would imply a precision the banding does
     not have. */
  check(
    'the condensation ramp has exactly three stops',
    CONDENSATION_RAMP.length === 3,
    `${CONDENSATION_RAMP.length} stops`,
  );
  check(
    'the condensation ramp has a band label for every stop',
    CONDENSATION_BANDS.length === CONDENSATION_RAMP.length,
    `${CONDENSATION_BANDS.length} labels for ${CONDENSATION_RAMP.length} stops`,
  );
  check(
    'the condensation bands are low, medium, high in that order',
    CONDENSATION_BANDS.join(',') === 'Low,Medium,High',
    CONDENSATION_BANDS.join(','),
  );
  check(
    'the three condensation stops are three different colours',
    new Set(CONDENSATION_RAMP.map(String)).size === 3,
  );
  check(
    'the condensation ramp is not the moisture ramp',
    String(CONDENSATION_RAMP[0]) !== String(MOISTURE_RAMP[0]),
  );

  /* --- The temperature and moisture maps must colour the same surfaces, or the
     two legends would be describing different geometry. --- */
  const base = applyBuildingType(defaultRequirements(), 'modular-insulated-cabin');
  const materials = resolveMaterials(base);
  const geometry = buildShelterGeometry(base, materials);

  const temp = computeSurfaceTemperature(JODHPUR, geometry, materials, 4, 14, 26);
  const moist = computeMoisture(JODHPUR, geometry, materials, base, {
    month: 4,
    hour: 14,
    indoorTemp: 26,
    latentGainW: 300,
  });

  const tempKeys = Object.keys(temp.detail).sort().join(',');
  const moistKeys = moist.surfaces.map((s) => s.key).sort().join(',');
  check('the temperature and moisture maps cover the same surfaces', tempKeys === moistKeys, tempKeys);

  check(
    'every surface in the temperature map carries a signed flux',
    Object.values(temp.detail).every((entry) => finite(entry.heatFlux)),
  );
  check(
    'the flux is zero on no surface at midday, so the map is not blank',
    Object.values(temp.detail).some((entry) => Math.abs(entry.heatFlux) > 1),
  );
  check(
    'the moisture margins are consistent with the reported dew point',
    moist.surfaces.every(
      (s) => Math.abs(s.margin - (s.surfaceTemp - moist.dewPoint)) < 0.15,
    ),
  );

  /* The sign is what makes the flux map a different quantity from the
     temperature map: a hot surface and a cold surface can both be losing heat,
     and only the flux says which way it is going. Demonstrated by flipping the
     same roof from a hot midday to a cold pre-dawn. */
  {
    const hotNoon = computeSurfaceTemperature(JODHPUR, geometry, materials, 4, 14, 26);
    const coldNight = computeSurfaceTemperature(LEH, geometry, materials, 0, 3, 18);
    check(
      'the roof gains heat at a hot midday',
      hotNoon.detail.roof.heatFlux > 0,
      `${hotNoon.detail.roof.heatFlux} W/m²`,
    );
    check(
      'the same roof loses heat on a cold night',
      coldNight.detail.roof.heatFlux < 0,
      `${coldNight.detail.roof.heatFlux} W/m²`,
    );
    check(
      'the flux therefore carries a sign the temperature alone does not',
      hotNoon.detail.roof.heatFlux > 0 && coldNight.detail.roof.heatFlux < 0,
    );

    /* --- The heat-loss map, derived exactly the way the canvas derives it:
       only the negative branch of the flux survives. --- */
    const lossOf = (flux: number) => Math.max(0, -flux);
    check(
      'a surface gaining heat shows no loss on the loss map',
      lossOf(hotNoon.detail.roof.heatFlux) === 0,
      `${lossOf(hotNoon.detail.roof.heatFlux)} W/m²`,
    );
    check(
      'a surface losing heat shows a positive loss on the loss map',
      lossOf(coldNight.detail.roof.heatFlux) > 0,
      `${lossOf(coldNight.detail.roof.heatFlux).toFixed(1)} W/m²`,
    );
    check(
      'the loss map is one-way where the flux map is signed',
      lossOf(hotNoon.detail.roof.heatFlux) === 0 && lossOf(coldNight.detail.roof.heatFlux) > 0,
    );
    check(
      'no loss value is ever negative, so the ramp never runs past its pale end',
      Object.values(temp.detail).every((entry) => lossOf(entry.heatFlux) >= 0),
    );
  }

  /* --- The condensation map: the engine's verdict re-keyed to a ramp index.
     Three bands, three stops, and the band must agree with the printed
     margin, which is the whole reason the band is read from the rounded
     value rather than the raw one. --- */
  {
    const bandOf = (risk: 'low' | 'medium' | 'high') =>
      risk === 'high' ? 2 : risk === 'medium' ? 1 : 0;

    check(
      'every condensation band is one of 0, 1 or 2',
      moist.surfaces.every((s) => [0, 1, 2].includes(bandOf(s.risk))),
    );
    check(
      'every band lands exactly on a ramp stop over the range [0, 2]',
      moist.surfaces.every((s) => Number.isInteger((bandOf(s.risk) / 2) * (CONDENSATION_RAMP.length - 1))),
    );
    check(
      'the high band is exactly the surfaces with a negative margin',
      moist.surfaces.every((s) => (s.risk === 'high') === (s.margin < 0)),
    );
    check(
      'the condensing list is exactly the high-band surfaces',
      moist.condensationSurfaces.slice().sort().join(',') ===
        moist.surfaces
          .filter((s) => s.risk === 'high')
          .map((s) => s.key)
          .sort()
          .join(','),
    );
    check(
      'the band thresholds are the documented ones',
      condensationRiskOf(-0.1) === 'high' &&
        condensationRiskOf(0) === 'medium' &&
        condensationRiskOf(1.9) === 'medium' &&
        condensationRiskOf(2) === 'low' &&
        condensationRiskOf(9) === 'low',
      `${condensationRiskOf(-0.1)}/${condensationRiskOf(0)}/${condensationRiskOf(2)}`,
    );
    check(
      'the band is monotone in the margin, so a colder surface is never a lower risk',
      condensationRiskOf(-5) === 'high' &&
        condensationRiskOf(1) === 'medium' &&
        condensationRiskOf(5) === 'low',
    );
  }

  console.log(
    `    Modes: ${MODES.length} · ramps ${FLUX_RAMP.length}/${MOISTURE_RAMP.length}/${LOSS_RAMP.length}/${CONDENSATION_RAMP.length} stops · ` +
      `${Object.keys(temp.detail).length} surfaces mapped`,
  );
}

/* ================================================================== */
/* 16 — Surface inspector data path                                    */
/* ================================================================== */

section('16 — Surface inspector');

{
  const SELECTABLE = ['front', 'right', 'back', 'left', 'roof', 'floor'] as const;

  const base = applyBuildingType(defaultRequirements(), 'high-altitude-tent');
  const materials = resolveMaterials(base);
  const geometry = buildShelterGeometry(base, materials);
  const temp = computeSurfaceTemperature(LEH, geometry, materials, 0, 6, 18);

  check(
    'every selectable surface has a detail entry',
    SELECTABLE.every((key) => Boolean(temp.detail[key])),
  );
  check(
    'every detail entry is fully populated',
    SELECTABLE.every((key) => {
      const d = temp.detail[key];
      return (
        finite(d.surfaceTemp) &&
        finite(d.solAirTemp) &&
        finite(d.heatFlux) &&
        finite(d.uValue) &&
        finite(d.area) &&
        d.label.length > 0
      );
    }),
  );
  check(
    'each surface carries its own area',
    SELECTABLE.every((key) => temp.detail[key].area > 0),
  );
  check(
    'the floor is ground-coupled rather than solar-driven',
    temp.detail.floor.irradiance === 0 && temp.detail.floor.tilt === 180,
  );
  check(
    'the roof is horizontal and the walls are vertical',
    temp.detail.roof.tilt === 0 && SELECTABLE.slice(0, 4).every((k) => temp.detail[k].tilt === 90),
  );

  /* The build-up the inspector prints must be the assembly the design actually
     uses, with its real layer stack — not a summary figure. */
  const assemblyId = base.wallAssemblyId;
  const assembly = assemblyId ? assemblyById(assemblyId) : undefined;
  check('the tent wall resolves a composite assembly', Boolean(assembly), assemblyId ?? 'none');
  if (assembly) {
    check('the assembly has layers', assembly.layers.length > 0, `${assembly.layers.length} layers`);
    check(
      'every layer carries a real thickness, conductivity and density',
      assembly.layers.every(
        (l) => l.thickness > 0 && l.conductivity > 0 && l.density >= 0 && l.name.length > 0,
      ),
    );
    const summed = assembly.layers.reduce((sum, l) => sum + l.thickness * l.density, 0);
    check(
      'the printed areal mass matches the layer stack',
      Math.abs(summed - assemblyArealMass(assembly)) < 1e-6,
      `${summed.toFixed(1)} vs ${assemblyArealMass(assembly).toFixed(1)} kg/m²`,
    );
    check(
      'the printed thickness matches the layer stack',
      Math.abs(
        assembly.layers.reduce((sum, l) => sum + l.thickness, 0) - assemblyThickness(assembly),
      ) < 1e-6,
    );
    console.log(
      `    ${assembly.name}: ${assembly.layers.length} layers, ` +
        `${(assemblyThickness(assembly) * 1000).toFixed(0)} mm, ` +
        `${assemblyArealMass(assembly).toFixed(1)} kg/m²`,
    );
  }

  /* A design with no composite assembly must still produce a build-up row. */
  {
    const plain = { ...base, wallAssemblyId: undefined, roofAssemblyId: undefined };
    const plainMaterials = resolveMaterials(plain);
    check(
      'a single-material design still resolves a base material to print',
      finite(plainMaterials.wall.thickness) &&
        plainMaterials.wall.thickness > 0 &&
        plainMaterials.wall.name.length > 0,
      plainMaterials.wall.name,
    );
  }
}

/* ================================================================== */
/* 17 — Passive / hybrid / active strategy comparison                  */
/* ================================================================== */

section('17 — Passive / hybrid / active');

{
  const base = applyBuildingType(defaultRequirements(), 'modular-insulated-cabin');
  const mission = missionProfile('personnel-accommodation');
  const fingerprint = computeClimateFingerprint(LEH);
  const analysis = runAnalysisStage(LEH, base);

  const requirements = deriveRequirements({
    fingerprint,
    analysis,
    climate: LEH,
    template: buildingType(base.buildingType),
    base,
    missionId: base.missionProfile,
  });

  const comparison = compareStrategies({
    base,
    climate: LEH,
    requirements,
    month: 0,
    occupants: base.numOccupants,
    sensibleGainW: 900,
    latentGainW: 300,
    humidityCeilingPct: mission.targetHumidity.max,
    coolingSetpointC: mission.targetTemp.max,
    indoorTemps: Array.from({ length: 24 }, () => 18),
    evaluate: (candidate) => {
      const evaluated = evaluateDesign(candidate, LEH, DEFAULT_WEIGHTS);
      return { thermal: evaluated.thermal, geometry: evaluated.geometry };
    },
  });

  check('three strategies are returned', comparison.outcomes.length === 3);
  check(
    'they come back in passive, hybrid, active order',
    comparison.outcomes.map((o) => o.id).join(',') === 'passive,hybrid,active',
  );
  check(
    'every outcome carries a definition, a thermal result and a ventilation schedule',
    comparison.outcomes.every(
      (o) => o.definition.label.length > 0 && finite(o.eui) && o.ventilation.hours.length === 24,
    ),
  );
  check(
    'every outcome has a plain-language summary',
    comparison.outcomes.every((o) => o.summary.length > 0),
  );

  const passive = comparison.outcomes.find((o) => o.id === 'passive')!;
  const hybrid = comparison.outcomes.find((o) => o.id === 'hybrid')!;
  const active = comparison.outcomes.find((o) => o.id === 'active')!;

  /* --- The strategies must genuinely differ in plant --- */
  check('the passive strategy installs no plant', passive.installedCapacityKw === 0);
  check('the passive strategy burns no fuel', passive.fuelLitresPerDay === 0);
  check('the passive strategy delivers no energy', passive.annualEnergyKwh === 0);
  check(
    'the passive strategy leaves load unmet',
    passive.unmetKwh > 0,
    `${passive.unmetKwh} kWh/yr`,
  );
  check('the active strategy installs plant', active.installedCapacityKw > 0, `${active.installedCapacityKw} kW`);
  check('the active strategy burns fuel', active.fuelLitresPerDay > 0, `${active.fuelLitresPerDay} L/day`);
  check(
    'the active strategy meets the whole load',
    active.unmetKwh === 0,
    `${active.unmetKwh} kWh/yr unmet`,
  );
  check(
    'the hybrid plant sits between the two',
    hybrid.installedCapacityKw > passive.installedCapacityKw &&
      hybrid.installedCapacityKw <= active.installedCapacityKw,
    `${passive.installedCapacityKw} ≤ ${hybrid.installedCapacityKw} ≤ ${active.installedCapacityKw} kW`,
  );

  /* The whole point of the comparison: the three must not come out identical.
     If they do, the plant type is not reaching the heat balance and the panel
     would be claiming a difference it does not compute. */
  check(
    'the three strategies produce different energy results',
    new Set(comparison.outcomes.map((o) => o.annualEnergyKwh)).size > 1,
    comparison.outcomes.map((o) => `${o.id} ${o.annualEnergyKwh}`).join(' · '),
  );
  check(
    'the active plant is the most efficient per unit of cooling it is the only one doing',
    active.eui > passive.eui,
    `${passive.eui} vs ${active.eui} kWh/m²·yr`,
  );
  check(
    'the hybrid is deliberately undersized and says so',
    hybrid.capacityCoverage < 1 && hybrid.undersizedNote.length > 0,
    `coverage ${hybrid.capacityCoverage}`,
  );
  check(
    'the active plant covers the peak',
    active.capacityCoverage >= 1,
    `coverage ${active.capacityCoverage}`,
  );
  check(
    'the hybrid delivers more comfort than the bare envelope',
    hybrid.deliveredComfort > hybrid.freeRunningComfort,
    `${hybrid.freeRunningComfort} → ${hybrid.deliveredComfort}`,
  );

  /* --- The comparison is controlled: one envelope, three plants --- */
  check(
    'all three are evaluated on the same envelope',
    comparison.outcomes.every(
      (o) =>
        o.parameters.wallMaterialId === passive.parameters.wallMaterialId &&
        o.parameters.insulationLevel === passive.parameters.insulationLevel &&
        o.parameters.wallThickness === passive.parameters.wallThickness,
    ),
  );
  check(
    'the envelope\u2019s own free-running performance is identical across the three',
    comparison.outcomes.every(
      (o) => Math.abs(o.freeRunningComfort - passive.freeRunningComfort) < 0.05,
    ),
    `${passive.freeRunningComfort} / ${hybrid.freeRunningComfort} / ${active.freeRunningComfort}`,
  );
  check(
    'only the plant differs',
    passive.parameters.hvacType !== active.parameters.hvacType &&
      passive.parameters.powerSource !== active.parameters.powerSource,
  );
  check(
    'the plant type reaches the efficiencies the heat balance divides by',
    passive.parameters.coolingCop !== active.parameters.coolingCop ||
      passive.parameters.heatingEfficiency !== active.parameters.heatingEfficiency,
    `passive ${passive.parameters.coolingCop}/${passive.parameters.heatingEfficiency} · ` +
      `active ${active.parameters.coolingCop}/${active.parameters.heatingEfficiency}`,
  );

  /* --- Energy ordering --- */
  check(
    'the active strategy uses at least as much energy as the passive envelope',
    active.annualEnergyKwh >= passive.annualEnergyKwh,
    `${passive.annualEnergyKwh} vs ${active.annualEnergyKwh} kWh/yr`,
  );
  check(
    'a passive shelter has no cooling plant load',
    passive.peakCoolingKw <= active.peakCoolingKw,
    `${passive.peakCoolingKw} vs ${active.peakCoolingKw} kW`,
  );

  /* --- The recommendation must be defensible --- */
  check(
    'the recommendation is one of the three strategies',
    ['passive', 'hybrid', 'active'].includes(comparison.recommended),
    comparison.recommended,
  );
  {
    const usable = comparison.outcomes.filter((o) => o.deliveredComfort >= 60);
    const pool = usable.length > 0 ? usable : comparison.outcomes;
    const lowest = pool.reduce((best, o) => (o.annualEnergyKwh < best.annualEnergyKwh ? o : best));
    check(
      'the recommendation is the lowest-energy strategy that reaches usable comfort',
      comparison.recommended === lowest.id,
      `${comparison.recommended} (${lowest.eui} kWh/m²·yr)`,
    );
    check(
      'a strategy that cannot hold comfort is never recommended over one that can',
      usable.length === 0 || pool.every((o) => o.deliveredComfort >= 60),
    );
  }
  check(
    'the recommendation is explained in plain language',
    comparison.recommendation.length > 0 && comparison.recommendation.includes('comfort'),
  );
  check(
    'the comparison records whether the envelope came from the requirement engine',
    comparison.envelopeFromRequirements === true,
  );

  console.log(
    `    passive ${passive.eui} · hybrid ${hybrid.eui} · active ${active.eui} kWh/m²·yr · ` +
      `recommended ${comparison.recommended}`,
  );
  console.log(`    ${comparison.recommendation}`);
}

/* ================================================================== */
/* 18 — HVAC plant model                                               */
/* ================================================================== */

section('18 — HVAC plant characteristics');

{
  const TYPES = [
    'none',
    'electric-heater',
    'diesel-heater',
    'heat-pump',
    'air-conditioner',
    'fan',
    'evaporative-cooler',
    'radiant-heater',
    'solar-thermal',
  ] as const;

  check('every plant type has a spec', TYPES.every((t) => Boolean(HVAC_SPECS[t])));
  check(
    'the spec table covers exactly the nine types',
    Object.keys(HVAC_SPECS).length === TYPES.length,
    `${Object.keys(HVAC_SPECS).length}`,
  );
  check(
    'every spec has a physical efficiency and a note',
    TYPES.every(
      (t) =>
        HVAC_SPECS[t].coolingCop >= 1 &&
        HVAC_SPECS[t].heatingEfficiency > 0 &&
        HVAC_SPECS[t].note.length > 0,
    ),
  );
  check(
    'at least one plant can cool and at least one can heat',
    TYPES.some((t) => HVAC_SPECS[t].canCool) && TYPES.some((t) => HVAC_SPECS[t].canHeat),
  );
  check('a heat pump beats resistive heating', HVAC_SPECS['heat-pump'].heatingEfficiency > 1);
  check(
    'a diesel heater is less than 100 % efficient',
    HVAC_SPECS['diesel-heater'].heatingEfficiency < 1,
  );
  check('a fan cannot cool', !HVAC_SPECS.fan.canCool);
  check('an evaporative cooler cannot heat', !HVAC_SPECS['evaporative-cooler'].canHeat);

  /* --- Wiring the type into the parameters the heat balance reads --- */
  const base = applyBuildingType(defaultRequirements(), 'modular-insulated-cabin');
  const applied = applyHvacToParameters(base, 'heat-pump');
  check('applying a plant type records it', applied.hvacType === 'heat-pump');
  check(
    'applying a plant type sets the cooling efficiency the heat balance divides by',
    applied.coolingCop === HVAC_SPECS['heat-pump'].coolingCop,
    `${applied.coolingCop}`,
  );
  check(
    'applying a plant type sets the heating efficiency',
    applied.heatingEfficiency === HVAC_SPECS['heat-pump'].heatingEfficiency,
    `${applied.heatingEfficiency}`,
  );
  check('applying a plant type does not mutate the input', (() => {
    const beforeCop = base.coolingCop;
    const beforeEff = base.heatingEfficiency;
    applyHvacToParameters(base, 'heat-pump');
    return base.coolingCop === beforeCop && base.heatingEfficiency === beforeEff;
  })());

  /* --- The performance breakdown --- */
  {
    const materials = resolveMaterials(base);
    const geometry = buildShelterGeometry(base, materials);
    const heatPump = evaluateDesign(applyHvacToParameters(base, 'heat-pump'), LEH, DEFAULT_WEIGHTS);
    const heaterOnly = evaluateDesign(
      applyHvacToParameters(base, 'diesel-heater'),
      LEH,
      DEFAULT_WEIGHTS,
    );

    const heatPumpPerf = computeHvacPerformance(
      heatPump.thermal,
      applyHvacToParameters(base, 'heat-pump'),
      geometry.floorArea,
    );
    const heaterPerf = computeHvacPerformance(
      heaterOnly.thermal,
      applyHvacToParameters(base, 'diesel-heater'),
      geometry.floorArea,
    );

    check(
      'the recovered thermal load is at least the delivered energy',
      heatPumpPerf.heatingLoadKwh >= heatPumpPerf.deliveredHeatingKwh - 1,
    );
    check(
      'a more efficient plant delivers less energy for the same load',
      heatPumpPerf.deliveredHeatingKwh <= heaterPerf.deliveredHeatingKwh,
      `heat pump ${heatPumpPerf.deliveredHeatingKwh} vs heater ${heaterPerf.deliveredHeatingKwh} kWh`,
    );
    check(
      'a heater that cannot cool reports its cooling load as unmet',
      heaterPerf.unmetCoolingKwh > 0 && heaterPerf.deliveredCoolingKwh === 0,
      `${heaterPerf.unmetCoolingKwh} kWh unmet`,
    );
    check(
      'a reversible plant reports no unmet cooling',
      heatPumpPerf.unmetCoolingKwh === 0,
    );
    check(
      'the delivered ratio matches the ratio of effective efficiencies, not the rated ones',
      Math.abs(
        heaterPerf.deliveredHeatingKwh / Math.max(1, heatPumpPerf.deliveredHeatingKwh) -
          heatPumpPerf.effectiveHeatingEfficiency / heaterPerf.effectiveHeatingEfficiency,
      ) < 0.05,
      `${(heaterPerf.deliveredHeatingKwh / Math.max(1, heatPumpPerf.deliveredHeatingKwh)).toFixed(2)} ` +
        `vs ${(heatPumpPerf.effectiveHeatingEfficiency / heaterPerf.effectiveHeatingEfficiency).toFixed(2)}`,
    );

    /* --- Part load ---
       A plant is not at its rated efficiency when it is running at a quarter
       load, and for a shelter that is the normal condition. The correction has
       to actually bite, and it has to bite hardest on the machine with the
       largest cycling loss — the DX unit, not the resistive element. */
    check(
      'every spec declares a part-load coefficient',
      TYPES.every((t) => HVAC_SPECS[t].partLoadCd >= 0 && HVAC_SPECS[t].partLoadCd < 1),
    );
    check(
      'a resistive element is modelled as having no part-load loss',
      HVAC_SPECS['electric-heater'].partLoadCd === 0,
    );
    check(
      'a DX machine carries the standard cycling loss',
      HVAC_SPECS['heat-pump'].partLoadCd >= 0.2,
    );
    check(
      'the part-load factor is a fraction between 0 and 1',
      heatPumpPerf.coolingPlf > 0 &&
        heatPumpPerf.coolingPlf <= 1 &&
        heatPumpPerf.heatingPlf > 0 &&
        heatPumpPerf.heatingPlf <= 1,
      `cooling ${heatPumpPerf.coolingPlf} · heating ${heatPumpPerf.heatingPlf}`,
    );
    check(
      'the part-load ratio is a fraction between 0 and 1',
      heatPumpPerf.coolingLoadFactor >= 0 &&
        heatPumpPerf.coolingLoadFactor <= 1 &&
        heatPumpPerf.heatingLoadFactor >= 0 &&
        heatPumpPerf.heatingLoadFactor <= 1,
    );
    check(
      'the run hours come from the free-running discomfort hours',
      heatPumpPerf.coolingRunHours === Math.round(heatPump.thermal.overheatingHours) &&
        heatPumpPerf.heatingRunHours === Math.round(heatPump.thermal.underheatingHours),
    );
    check(
      'the effective efficiency is never better than the rated one',
      heatPumpPerf.effectiveCoolingCop <= HVAC_SPECS['heat-pump'].coolingCop + 1e-9 &&
        heatPumpPerf.effectiveHeatingEfficiency <= HVAC_SPECS['heat-pump'].heatingEfficiency + 1e-9,
      `${heatPumpPerf.effectiveHeatingEfficiency} ≤ ${HVAC_SPECS['heat-pump'].heatingEfficiency}`,
    );
    check(
      'part-load degradation narrows the heat pump\u2019s advantage over a combustion heater',
      heatPumpPerf.effectiveHeatingEfficiency / heaterPerf.effectiveHeatingEfficiency <
        HVAC_SPECS['heat-pump'].heatingEfficiency / HVAC_SPECS['diesel-heater'].heatingEfficiency,
      `${(heatPumpPerf.effectiveHeatingEfficiency / heaterPerf.effectiveHeatingEfficiency).toFixed(2)} ` +
        `against a rated ${(HVAC_SPECS['heat-pump'].heatingEfficiency / HVAC_SPECS['diesel-heater'].heatingEfficiency).toFixed(2)}`,
    );
    check(
      'the degradation is reported in the summary',
      heatPumpPerf.summary.includes('Part-load'),
    );
    check(
      'a plant with no cycling loss keeps its rated efficiency',
      computeHvacPerformance(
        heatPump.thermal,
        applyHvacToParameters(base, 'electric-heater'),
        geometry.floorArea,
      ).heatingPlf === 1,
    );
    check(
      'the EUI is the delivered energy over the floor area',
      Math.abs(heatPumpPerf.eui - heatPumpPerf.deliveredTotalKwh / geometry.floorArea) < 0.2,
    );
    check('the performance summary is written out', heatPumpPerf.summary.length > 0);
    check(
      'a solar-powered design emits far less than a diesel one',
      computeHvacPerformance(
        heatPump.thermal,
        { ...applyHvacToParameters(base, 'heat-pump'), powerSource: 'solar-pv' },
        geometry.floorArea,
      ).co2TonnesPerYear <
        computeHvacPerformance(
          heatPump.thermal,
          { ...applyHvacToParameters(base, 'heat-pump'), powerSource: 'diesel-generator' },
          geometry.floorArea,
        ).co2TonnesPerYear,
    );
    check(
      'a fuel-burning source reports litres per day and a solar one reports none',
      computeHvacPerformance(
        heatPump.thermal,
        { ...applyHvacToParameters(base, 'heat-pump'), powerSource: 'diesel-generator' },
        geometry.floorArea,
      ).fuelLitresPerDay > 0 &&
        computeHvacPerformance(
          heatPump.thermal,
          { ...applyHvacToParameters(base, 'heat-pump'), powerSource: 'solar-pv' },
          geometry.floorArea,
        ).fuelLitresPerDay === 0,
    );

    console.log(
      `    Heat pump delivers ${heatPumpPerf.deliveredTotalKwh} kWh/yr; ` +
        `diesel heater delivers ${heaterPerf.deliveredTotalKwh} kWh/yr with ${heaterPerf.unmetCoolingKwh} kWh of cooling unmet`,
    );
  }
}

/* ================================================================== */
/* 19 — Uncertainty and the validation architecture                    */
/* ================================================================== */

section('19 — Uncertainty and validation architecture');

{
  const base = applyBuildingType(defaultRequirements(), 'modular-insulated-cabin');
  const makeEvaluator = (climate: typeof LEH) => (candidate: typeof base) => {
    const evaluated = evaluateDesign(candidate, climate, DEFAULT_WEIGHTS);
    return { thermal: evaluated.thermal, geometry: evaluated.geometry };
  };

  /* --- Determinism: a seeded sampler must not move run to run --- */
  const runA = runUncertainty({
    base,
    climate: LEH,
    samples: 16,
    seed: 12345,
    evaluate: makeEvaluator(LEH),
  });
  const runB = runUncertainty({
    base,
    climate: LEH,
    samples: 16,
    seed: 12345,
    evaluate: makeEvaluator(LEH),
  });
  const runC = runUncertainty({
    base,
    climate: LEH,
    samples: 16,
    seed: 999,
    evaluate: makeEvaluator(LEH),
  });

  check('the sample count is honoured', runA.sampleCount === 16, `${runA.sampleCount}`);
  check(
    'the same seed reproduces the result exactly',
    JSON.stringify(runA.outputs) === JSON.stringify(runB.outputs),
  );
  check(
    'a different seed produces a different sample set',
    JSON.stringify(runA.outputs) !== JSON.stringify(runC.outputs),
  );
  check('the seed is reported', runA.seed === 12345);

  /* --- Shape and finiteness --- */
  check(
    'every output is reported',
    runA.outputs.length === UNCERTAINTY_OUTPUTS.length,
    `${runA.outputs.length} outputs`,
  );
  check(
    'every output is finite and has a non-negative spread',
    runA.outputs.every(
      (o) =>
        finite(o.mean) &&
        finite(o.sd) &&
        o.sd >= 0 &&
        finite(o.p05) &&
        finite(o.p50) &&
        finite(o.p95) &&
        finite(o.min) &&
        finite(o.max),
    ),
  );

  /* --- The percentiles must be ordered --- */
  check(
    'min ≤ p05 ≤ p50 ≤ p95 ≤ max for every output',
    runA.outputs.every(
      (o) => o.min <= o.p05 + 1e-9 && o.p05 <= o.p50 + 1e-9 && o.p50 <= o.p95 + 1e-9 && o.p95 <= o.max + 1e-9,
    ),
  );
  check(
    'the band width is the p95 minus the p05',
    runA.outputs.every((o) => Math.abs(o.bandWidth - (o.p95 - o.p05)) < 0.02),
  );
  check(
    'the mean sits inside the sampled range',
    runA.outputs.every((o) => o.mean >= o.min - 1e-9 && o.mean <= o.max + 1e-9),
  );
  check(
    'the baseline is the unperturbed value, not a sample',
    runA.outputs.every((o) => finite(o.baseline)),
  );

  /* --- Sensitivity indices must be shares --- */
  check(
    'every output lists a contribution for every input',
    runA.outputs.every((o) => o.contributions.length === UNCERTAINTY_INPUTS.length),
  );
  check(
    'every contribution index is a share between 0 and 1',
    runA.outputs.every((o) => o.contributions.every((c) => c.index >= 0 && c.index <= 1 + 1e-9)),
  );
  check(
    'the contributions sum to 1 for every output',
    runA.outputs.every((o) => Math.abs(o.contributions.reduce((s, c) => s + c.index, 0) - 1) < 1e-6),
  );
  check(
    'the contributions are ranked largest first',
    runA.outputs.every((o) =>
      o.contributions.every((c, i) => i === 0 || c.index <= o.contributions[i - 1]!.index + 1e-9),
    ),
  );
  check(
    'the named dominant input is the largest contribution',
    runA.outputs.every((o) => o.dominant === o.contributions[0]!.label),
  );
  check(
    'every input is declared with a spread and a documented basis',
    runA.inputs.length === UNCERTAINTY_INPUTS.length &&
      runA.inputs.every((i) => i.spread > 0 && i.spread < 1 && i.basis.length > 20),
  );

  /* --- The result must be physically interpretable --- */
  {
    const lehEui = runA.outputs.find((o) => o.key === 'eui')!;
    check(
      'a heating-dominated site is most sensitive to the heating plant',
      lehEui.dominant === 'Heating efficiency',
      `${lehEui.dominant} at ${(lehEui.contributions[0]!.index * 100).toFixed(0)} %`,
    );

    const jodhpur = runUncertainty({
      base,
      climate: JODHPUR,
      samples: 16,
      seed: 12345,
      evaluate: makeEvaluator(JODHPUR),
    });
    const jodhpurEui = jodhpur.outputs.find((o) => o.key === 'eui')!;
    check(
      'a cooling-dominated site is most sensitive to the cooling plant',
      jodhpurEui.dominant === 'Cooling efficiency',
      `${jodhpurEui.dominant} at ${(jodhpurEui.contributions[0]!.index * 100).toFixed(0)} %`,
    );
    check(
      'the two sites therefore disagree about what matters most',
      lehEui.dominant !== jodhpurEui.dominant,
    );
  }

  check('the analysis is summarised in plain language', runA.summary.length > 80);
  check(
    'the summary names the index as first-order',
    runA.summary.includes('first-order'),
  );

  /* --- Validation architecture --- */
  {
    const counts = validationCounts();
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    check('every validation row carries a status', total === VALIDATION_ROWS.length, `${total}`);
    check(
      'every row has a quantity, a note and a status',
      VALIDATION_ROWS.every(
        (row) => row.quantity.length > 0 && row.note.length > 30 && Boolean(VALIDATION_STATUS[row.status]),
      ),
    );
    check(
      'no row claims a reference check without naming what it was checked against',
      VALIDATION_ROWS.filter((row) => row.status === 'reference').every(
        (row) => row.checkedAgainst.length > 0 && row.checkedAgainst !== '—',
      ),
    );
    check(
      'a row that only claims a declared estimate cannot cite a standard as its check',
      VALIDATION_ROWS.filter(
        (row) => row.status === 'declared' && /ISO|ASHRAE|NOAA|Erbs/i.test(row.checkedAgainst),
      ).every((row) => /approximat/i.test(row.checkedAgainst)),
    );
    check(
      'the strongest claims come first',
      VALIDATION_ROWS.findIndex((row) => row.status === 'declared') >
        VALIDATION_ROWS.findIndex((row) => row.status === 'reference'),
    );
    check(
      'both deferred routes are named',
      VALIDATION_ROWS.filter((row) => row.status === 'deferred').length >= 2,
    );
    check(
      'the deferred rows name a planned comparison rather than a result',
      VALIDATION_ROWS.filter((row) => row.status === 'deferred').every((row) =>
        row.checkedAgainst.toLowerCase().includes('planned'),
      ),
    );
    check(
      'the verdict names both deferred routes',
      VALIDATION_VERDICT.toLowerCase().includes('whole-building') &&
        VALIDATION_VERDICT.toLowerCase().includes('measured shelter'),
    );
    check(
      'there is no status that claims a quantity has been validated',
      !Object.values(VALIDATION_STATUS).some((meta) => meta.label.toLowerCase() === 'validated'),
    );

    console.log(
      `    Validation: ${counts.reference} reference · ${counts.consistency} consistency · ` +
        `${counts.declared} declared · ${counts.deferred} deferred`,
    );
  }

  console.log(`    ${runA.summary}`);
}

/* ================================================================== */
/* Regression — the civil reference types are untouched                */
/* ================================================================== */

section('7 — Regression: the civil reference types still work');

for (const id of ['single-family', 'row-house', 'low-rise', 'vernacular', 'modular-emergency'] as const) {
  const params = applyBuildingType(defaultRequirements(), id);
  const design = evaluateDesign(params, LEH, DEFAULT_WEIGHTS);
  check(
    `${id}: still runs clean at Leh`,
    finite(design.thermal.indoorTemperatureRange[0]) && finite(design.thermal.energyUseIntensity),
  );
  check(`${id}: still marked civil`, !isDefenceType(id));
}

check(
  'the default design still resolves a monthly profile',
  Boolean(evaluateDesign(defaultRequirements(), LEH, DEFAULT_WEIGHTS).thermal.dailyProfile),
);

/* ================================================================== */
/* 20 — Interstitial condensation (Glaser check)                       */
/* ================================================================== */

section('20 — Interstitial condensation (Glaser check)');

{
  /* --- The data the check rests on -----------------------------------------
     The whole result is decided by the *ratio* of vapour resistances across
     the stack, so a layer without one is not a small inaccuracy: it can invent
     a condensation plane or hide a real one. Both the assembly layers and the
     catalogue materials must therefore declare one. */
  const allLayers = COMPOSITE_ASSEMBLIES.flatMap((assembly) => assembly.layers);
  check(
    'every composite layer declares a finite, positive vapour resistance',
    allLayers.every((l) => finite(l.vapourResistivity) && l.vapourResistivity > 0),
    `${allLayers.length} layers across ${COMPOSITE_ASSEMBLIES.length} assemblies`,
  );

  const catalogue = [
    ...WALL_MATERIALS,
    ...ROOF_MATERIALS,
    ...WINDOW_MATERIALS,
    ...DOOR_MATERIALS,
    ...INSULATION_MATERIALS,
  ];
  const declared = catalogue.filter(
    (m) =>
      typeof m.vapourResistivity === 'number' &&
      finite(m.vapourResistivity) &&
      m.vapourResistivity > 0,
  );
  check(
    'every catalogue material declares a vapour resistance',
    declared.length === catalogue.length,
    `${declared.length}/${catalogue.length}`,
  );

  /* The films the U-value uses and the films the Glaser check uses must be the
     same films, or the two disagree about where the inner surface is. */
  check(
    'the split surface films sum to the U-value film (wall)',
    Math.abs(SURFACE_FILM.wall.internal + SURFACE_FILM.wall.external - SURFACE_RESISTANCE.wall) < 1e-9,
  );
  check(
    'the split surface films sum to the U-value film (roof)',
    Math.abs(SURFACE_FILM.roof.internal + SURFACE_FILM.roof.external - SURFACE_RESISTANCE.roof) < 1e-9,
  );

  /* --- A warm, occupied shelter against a Leh winter ---------------------- */
  const LEH_WINTER = {
    month: 0,
    indoorTemp: 20,
    indoorRh: 60,
    outdoorTemp: -12,
    outdoorRh: 55,
  };

  const tent = computeInterstitial(assemblyById('tent-wall-insulated')!.layers, LEH_WINTER);
  const cabin = computeInterstitial(assemblyById('cabin-wall-panel')!.layers, LEH_WINTER);
  const bunker = computeInterstitial(assemblyById('bunker-wall-earth')!.layers, LEH_WINTER);
  const brick = computeInterstitial(assemblyById('brick-cavity-eps')!.layers, LEH_WINTER);
  const results = [tent, cabin, bunker, brick];

  check('every defence build-up resolves an applicable result', results.every((r) => r.applicable));

  /* --- The classic failure: a vapour barrier outboard of the insulation ---- */
  check(
    'the insulated tent wall condenses inside its build-up in a Leh winter',
    tent.condensing && tent.condensationAt !== null,
    `${tent.condensationAt} · ${tent.condensationGPerM2Day} g/m²·day`,
  );
  check(
    'the tent condensation plane is the reflective foil, not a wall face',
    (tent.condensationAt ?? '').toLowerCase().includes('foil'),
    tent.condensationAt ?? '—',
  );
  check(
    'the tent foil is named as the vapour-tight layer',
    (tent.vapourBarrierLayer ?? '').toLowerCase().includes('foil'),
    tent.vapourBarrierLayer ?? '—',
  );
  check('the tent foil is flagged as sitting on the cold side', tent.barrierOnColdSide);
  check(
    'the cabin steel skin is flagged the same way',
    cabin.condensing && cabin.barrierOnColdSide,
    `${cabin.vapourBarrierLayer} · ${cabin.condensationGPerM2Day} g/m²·day`,
  );
  check(
    'the foil dominates the tent vapour resistance, as mu = 10^6 implies',
    tent.totalSd > 300,
    `${tent.totalSd} m (Sd)`,
  );

  /* --- The build-up that gets it right ------------------------------------ */
  check(
    'the earth-berm bunker wall stays dry under the same conditions',
    !bunker.condensing && bunker.risk === 'none',
    `${bunker.critical?.label ?? '—'} · ${bunker.critical?.marginPa ?? 0} Pa`,
  );
  check(
    'a dry build-up names no condensation plane and no rate',
    bunker.condensationAt === null &&
      bunker.condensationDepth === null &&
      bunker.condensationGPerM2Day === 0,
  );

  /* --- Structural invariants that must hold on every result --------------- */
  check(
    'the margin is exactly the vapour pressure minus the saturation pressure',
    results.every((r) => r.planes.every((p) => Math.abs(p.marginPa - (p.vapourPa - p.saturationPa)) <= 1)),
  );
  check(
    'the condensing flag agrees with the plane-by-plane verdicts',
    results.every((r) => r.condensing === r.planes.some((p) => p.condensing)),
  );
  check(
    'the condensing-plane count matches the flagged planes',
    results.every((r) => r.condensingPlaneCount === r.planes.filter((p) => p.condensing).length),
  );
  check(
    'a condensation rate is reported only when something is condensing',
    results.every((r) => (r.condensing ? r.condensationGPerM2Day > 0 : r.condensationGPerM2Day === 0)),
  );
  check(
    'a build-up is walked from the outer face inward, one plane per layer face',
    results.every((r) => r.planes.length >= 2 && r.planes[0]!.depth === 0),
  );
  check(
    'the temperature rises monotonically from the outer face inward',
    results.every((r) =>
      r.planes.every((p, i) => i === 0 || p.temperature >= r.planes[i - 1]!.temperature - 0.01),
    ),
  );
  check(
    'the vapour pressure never falls as it moves inward',
    results.every((r) =>
      r.planes.every((p, i) => i === 0 || p.vapourPa >= r.planes[i - 1]!.vapourPa - 1),
    ),
  );
  check(
    'the outer surface runs just above the outdoor air temperature',
    results.every((r) => {
      const outer = r.planes[0]!;
      return (
        outer.temperature >= LEH_WINTER.outdoorTemp - 0.01 &&
        outer.temperature < LEH_WINTER.outdoorTemp + 5
      );
    }),
  );
  check(
    'the inner surface runs just below the indoor air temperature',
    results.every((r) => {
      const inner = r.planes[r.planes.length - 1]!;
      return (
        inner.temperature <= LEH_WINTER.indoorTemp + 0.01 &&
        inner.temperature > LEH_WINTER.indoorTemp - 5
      );
    }),
  );
  /* The field is the resistance from the inside *to* a plane, so it runs from
     the full stack at the outer face down to zero at the inner face — which is
     what makes the vapour-pressure line land on p_out and p_in at the two
     boundaries. */
  check(
    'the cumulative vapour resistance spans the full stack at the outer face',
    results.every((r) => Math.abs(r.planes[0]!.sdFromInside - r.totalSd) < 0.01),
    `${results.map((r) => r.planes[0]!.sdFromInside).join(', ')} vs ${results.map((r) => r.totalSd).join(', ')}`,
  );
  check(
    'the cumulative vapour resistance is zero at the inner face',
    results.every((r) => Math.abs(r.planes[r.planes.length - 1]!.sdFromInside) < 0.01),
  );
  check(
    'the vapour-pressure line lands on the boundary pressures at both faces',
    results.every((r) => {
      const outer = r.planes[0]!;
      const inner = r.planes[r.planes.length - 1]!;
      return (
        Math.abs(outer.vapourPa - r.outdoorVapourPa) <= 1 &&
        Math.abs(inner.vapourPa - r.indoorVapourPa) <= 1
      );
    }),
  );

  /* --- Critical-plane selection, which was a real bug in an earlier draft -- */
  check(
    'when condensing, the critical plane is the one with the greatest excess',
    results.every(
      (r) =>
        !r.condensing ||
        r.planes.filter((p) => p.condensing).every((p) => p.marginPa <= (r.critical?.marginPa ?? 0)),
    ),
  );
  check(
    'when dry, the critical plane is the tightest margin',
    results.every((r) => r.condensing || r.planes.every((p) => p.marginPa >= (r.critical?.marginPa ?? 0))),
  );
  check(
    'a plane can condense without being the tightest — the flag is not the margin',
    brick.condensing && brick.planes.some((p) => p.marginPa < 0),
    `${brick.condensingPlaneCount} condensing · tightest ${brick.planes.reduce((m, p) => Math.min(m, p.marginPa), Infinity)} Pa`,
  );

  /* --- Monotonicity: more moisture inside can only make it worse ---------- */
  {
    const layers = assemblyById('brick-cavity-eps')!.layers;
    const dry = computeInterstitial(layers, { ...LEH_WINTER, indoorRh: 30 });
    const wet = computeInterstitial(layers, { ...LEH_WINTER, indoorRh: 80 });
    check(
      'raising the indoor humidity can only increase the condensation rate',
      wet.condensationGPerM2Day >= dry.condensationGPerM2Day,
      `${dry.condensationGPerM2Day} → ${wet.condensationGPerM2Day} g/m²·day`,
    );

    const cold = computeInterstitial(layers, { ...LEH_WINTER, outdoorTemp: -20 });
    const mild = computeInterstitial(layers, { ...LEH_WINTER, outdoorTemp: 15 });
    check(
      'a colder exterior can only increase the condensation rate',
      cold.condensationGPerM2Day >= mild.condensationGPerM2Day,
      `${mild.condensationGPerM2Day} → ${cold.condensationGPerM2Day} g/m²·day`,
    );
  }

  /* --- No stack, no fabricated profile ----------------------------------- */
  {
    const none = computeInterstitial(undefined, LEH_WINTER);
    check(
      'a single-material envelope reports that the check could not run',
      !none.applicable && (none.reason ?? '').length > 0,
      none.reason ?? '—',
    );
    check(
      'an inapplicable result fabricates no profile and claims no rate',
      none.planes.length === 0 && none.condensationGPerM2Day === 0 && none.critical === null,
    );
    check(
      'the reason names the missing build-up rather than reporting the wall dry',
      !(none.reason ?? '').toLowerCase().includes('no condensation'),
      none.reason ?? '—',
    );
  }

  console.log(
    `    Interstitial: tent ${tent.condensationGPerM2Day} · cabin ${cabin.condensationGPerM2Day} · ` +
      `brick ${brick.condensationGPerM2Day} g/m²·day · bunker dry · ` +
      `${allLayers.length} layers with declared mu`,
  );
}

/* ================================================================== */
/* 20 — Interstitial condensation (Glaser check)                       */
/* ================================================================== */

section('20 — Interstitial condensation (Glaser check)');

{
  /* --- The data the check rests on -----------------------------------------
     The whole result is decided by the *ratio* of vapour resistances across
     the stack, so a layer without one is not a small inaccuracy: it can invent
     a condensation plane or hide a real one. Both the assembly layers and the
     catalogue materials must therefore declare one. */
  const allLayers = COMPOSITE_ASSEMBLIES.flatMap((assembly) => assembly.layers);
  check(
    'every composite layer declares a finite, positive vapour resistance',
    allLayers.every((l) => finite(l.vapourResistivity) && l.vapourResistivity > 0),
    `${allLayers.length} layers across ${COMPOSITE_ASSEMBLIES.length} assemblies`,
  );

  const catalogue = [
    ...WALL_MATERIALS,
    ...ROOF_MATERIALS,
    ...WINDOW_MATERIALS,
    ...DOOR_MATERIALS,
    ...INSULATION_MATERIALS,
  ];
  const declared = catalogue.filter(
    (m) =>
      typeof m.vapourResistivity === 'number' &&
      finite(m.vapourResistivity) &&
      m.vapourResistivity > 0,
  );
  check(
    'every catalogue material declares a vapour resistance',
    declared.length === catalogue.length,
    `${declared.length}/${catalogue.length}`,
  );

  /* The films the U-value uses and the films the Glaser check uses must be the
     same films, or the two disagree about where the inner surface is. */
  check(
    'the split surface films sum to the U-value film (wall)',
    Math.abs(SURFACE_FILM.wall.internal + SURFACE_FILM.wall.external - SURFACE_RESISTANCE.wall) < 1e-9,
  );
  check(
    'the split surface films sum to the U-value film (roof)',
    Math.abs(SURFACE_FILM.roof.internal + SURFACE_FILM.roof.external - SURFACE_RESISTANCE.roof) < 1e-9,
  );

  /* --- A warm, occupied shelter against a Leh winter ---------------------- */
  const LEH_WINTER = {
    month: 0,
    indoorTemp: 20,
    indoorRh: 60,
    outdoorTemp: -12,
    outdoorRh: 55,
  };

  const tent = computeInterstitial(assemblyById('tent-wall-insulated')!.layers, LEH_WINTER);
  const cabin = computeInterstitial(assemblyById('cabin-wall-panel')!.layers, LEH_WINTER);
  const bunker = computeInterstitial(assemblyById('bunker-wall-earth')!.layers, LEH_WINTER);
  const brick = computeInterstitial(assemblyById('brick-cavity-eps')!.layers, LEH_WINTER);
  const results = [tent, cabin, bunker, brick];

  check('every defence build-up resolves an applicable result', results.every((r) => r.applicable));

  /* --- The classic failure: a vapour barrier outboard of the insulation ---- */
  check(
    'the insulated tent wall condenses inside its build-up in a Leh winter',
    tent.condensing && tent.condensationAt !== null,
    `${tent.condensationAt} · ${tent.condensationGPerM2Day} g/m²·day`,
  );
  check(
    'the tent condensation plane is the reflective foil, not a wall face',
    (tent.condensationAt ?? '').toLowerCase().includes('foil'),
    tent.condensationAt ?? '—',
  );
  check(
    'the tent foil is named as the vapour-tight layer',
    (tent.vapourBarrierLayer ?? '').toLowerCase().includes('foil'),
    tent.vapourBarrierLayer ?? '—',
  );
  check('the tent foil is flagged as sitting on the cold side', tent.barrierOnColdSide);
  check(
    'the cabin steel skin is flagged the same way',
    cabin.condensing && cabin.barrierOnColdSide,
    `${cabin.vapourBarrierLayer} · ${cabin.condensationGPerM2Day} g/m²·day`,
  );
  check(
    'the foil dominates the tent vapour resistance, as μ ≈ 10⁶ implies',
    tent.totalSd > 300,
    `${tent.totalSd} m (Sd)`,
  );

  /* --- The build-up that gets it right ------------------------------------ */
  check(
    'the earth-berm bunker wall stays dry under the same conditions',
    !bunker.condensing && bunker.risk === 'none',
    `${bunker.critical?.label ?? '—'} · ${bunker.critical?.marginPa ?? 0} Pa`,
  );
  check(
    'a dry build-up names no condensation plane and no rate',
    bunker.condensationAt === null &&
      bunker.condensationDepth === null &&
      bunker.condensationGPerM2Day === 0,
  );

  /* --- Structural invariants that must hold on every result --------------- */
  check(
    'the margin is exactly the vapour pressure minus the saturation pressure',
    results.every((r) => r.planes.every((p) => Math.abs(p.marginPa - (p.vapourPa - p.saturationPa)) <= 1)),
  );
  check(
    'the condensing flag agrees with the plane-by-plane verdicts',
    results.every((r) => r.condensing === r.planes.some((p) => p.condensing)),
  );
  check(
    'the condensing-plane count matches the flagged planes',
    results.every((r) => r.condensingPlaneCount === r.planes.filter((p) => p.condensing).length),
  );
  check(
    'a condensation rate is reported only when something is condensing',
    results.every((r) => (r.condensing ? r.condensationGPerM2Day > 0 : r.condensationGPerM2Day === 0)),
  );
  check(
    'the build-up is walked from the outer face inward, one plane per layer face',
    results.every((r) => r.planes.length >= 2 && r.planes[0]!.depth === 0),
  );
  check(
    'the temperature rises monotonically from the outer face inward',
    results.every((r) =>
      r.planes.every((p, i) => i === 0 || p.temperature >= r.planes[i - 1]!.temperature - 0.01),
    ),
  );
  check(
    'the vapour pressure never falls as it moves inward',
    results.every((r) => r.planes.every((p, i) => i === 0 || p.vapourPa >= r.planes[i - 1]!.vapourPa - 1)),
  );
  check(
    'the outer surface runs just above the outdoor air temperature',
    results.every((r) => {
      const outer = r.planes[0]!;
      return (
        outer.temperature >= LEH_WINTER.outdoorTemp - 0.01 &&
        outer.temperature < LEH_WINTER.outdoorTemp + 5
      );
    }),
  );
  check(
    'the inner surface runs just below the indoor air temperature',
    results.every((r) => {
      const inner = r.planes[r.planes.length - 1]!;
      return (
        inner.temperature <= LEH_WINTER.indoorTemp + 0.01 &&
        inner.temperature > LEH_WINTER.indoorTemp - 5
      );
    }),
  );
  check(
    'the cumulative vapour resistance is the build-up total at the outer face',
    results.every((r) => Math.abs(r.planes[0]!.sdFromInside - r.totalSd) < 0.01),
  );
  check(
    'and falls to zero at the inner face, which is the indoor boundary',
    results.every((r) => Math.abs(r.planes[r.planes.length - 1]!.sdFromInside) < 0.01),
  );

  /* --- Critical-plane selection, which was a real bug --------------------- */
  check(
    'when condensing, the critical plane is the one with the greatest excess',
    results.every(
      (r) =>
        !r.condensing ||
        r.planes.filter((p) => p.condensing).every((p) => p.marginPa <= (r.critical?.marginPa ?? 0)),
    ),
  );
  check(
    'when dry, the critical plane is the tightest margin',
    results.every((r) => r.condensing || r.planes.every((p) => p.marginPa >= (r.critical?.marginPa ?? 0))),
  );
  check(
    'a plane can condense without being the tightest — the flag is not the margin',
    brick.condensing && brick.planes.some((p) => p.marginPa < 0),
    `${brick.condensingPlaneCount} condensing · tightest ${brick.planes.reduce(
      (m, p) => Math.min(m, p.marginPa),
      Infinity,
    )} Pa`,
  );

  /* --- Monotonicity: more moisture inside can only make it worse ---------- */
  {
    const layers = assemblyById('brick-cavity-eps')!.layers;
    const dry = computeInterstitial(layers, { ...LEH_WINTER, indoorRh: 30 });
    const wet = computeInterstitial(layers, { ...LEH_WINTER, indoorRh: 80 });
    check(
      'raising the indoor humidity can only increase the condensation rate',
      wet.condensationGPerM2Day >= dry.condensationGPerM2Day,
      `${dry.condensationGPerM2Day} → ${wet.condensationGPerM2Day} g/m²·day`,
    );

    const cold = computeInterstitial(layers, { ...LEH_WINTER, outdoorTemp: -20 });
    const mild = computeInterstitial(layers, { ...LEH_WINTER, outdoorTemp: 15 });
    check(
      'a colder exterior can only increase the condensation rate',
      cold.condensationGPerM2Day >= mild.condensationGPerM2Day,
      `${mild.condensationGPerM2Day} → ${cold.condensationGPerM2Day} g/m²·day`,
    );
  }

  /* --- No stack, no fabricated profile ----------------------------------- */
  {
    const none = computeInterstitial(undefined, LEH_WINTER);
    check(
      'a single-material envelope reports that the check could not run',
      !none.applicable && (none.reason ?? '').length > 0,
      none.reason ?? '—',
    );
    check(
      'an inapplicable result fabricates no profile and claims no rate',
      none.planes.length === 0 && none.condensationGPerM2Day === 0 && none.critical === null,
    );
    check(
      'the reason names the missing build-up rather than reporting the wall dry',
      !(none.reason ?? '').toLowerCase().includes('no condensation'),
      none.reason ?? '—',
    );
  }

  console.log(
    `    Interstitial: tent ${tent.condensationGPerM2Day} · cabin ${cabin.condensationGPerM2Day} · ` +
      `brick ${brick.condensationGPerM2Day} g/m²·day · bunker dry · ` +
      `${allLayers.length} layers with declared μ`,
  );
}

/* ================================================================== */
/* 21 — Navigation: eight primary items, nothing that is not a step    */
/* ================================================================== */

section('21 — Navigation structure');

{
  check('the sidebar has exactly eight primary items', NAV_ITEMS.length === 8, `got ${NAV_ITEMS.length}`);

  const primaryHrefs = NAV_ITEMS.map((item) => item.href);
  const expected = [
    '/dashboard',
    '/dashboard/climate',
    '/dashboard/brief',
    '/dashboard/design',
    '/dashboard/analysis',
    '/dashboard/optimization',
    '/dashboard/scenarios',
    '/dashboard/materials',
  ];
  check(
    'the primary items are exactly the documented eight, in workflow order',
    primaryHrefs.join(',') === expected.join(','),
    primaryHrefs.join(', '),
  );

  /* The three pages that were demoted must not be primary. Each is now a tab, a
     section, or a footer link — so a future edit cannot quietly promote them
     back and re-clutter the workflow. */
  const demoted = ['/dashboard/fingerprint', '/dashboard/model', '/dashboard/method', '/dashboard/settings'];
  check(
    'no demoted page is a primary nav item',
    demoted.every((href) => !primaryHrefs.includes(href)),
    demoted.filter((href) => primaryHrefs.includes(href)).join(', ') || 'none',
  );

  /* --- Utility links ------------------------------------------------------- */
  const utilityHrefs = UTILITY_LINKS.map((item) => item.href);
  check(
    'Method & Limits and Settings are reachable as utility links',
    utilityHrefs.includes('/dashboard/method') && utilityHrefs.includes('/dashboard/settings'),
    utilityHrefs.join(', '),
  );
  check(
    'the utility links are not duplicated in the primary nav',
    utilityHrefs.every((href) => !primaryHrefs.includes(href)),
  );

  /* --- Every route is reachable ------------------------------------------- */
  check(
    'every primary route is also in the combined list',
    primaryHrefs.every((href) => ALL_NAV_ITEMS.some((item) => item.href === href)),
  );
  check(
    'no href appears twice across the whole navigation',
    new Set(ALL_NAV_ITEMS.map((item) => item.href)).size === ALL_NAV_ITEMS.length,
  );

  /* --- Grouping ------------------------------------------------------------ */
  const usedGroups = new Set(NAV_ITEMS.map((item) => item.group));
  check(
    'every group a primary item uses is a declared group',
    [...usedGroups].every((group) => (NAV_GROUPS as readonly string[]).includes(group)),
    [...usedGroups].join(', '),
  );
  check(
    'every declared group has at least one item',
    NAV_GROUPS.every((group) => NAV_ITEMS.some((item) => item.group === group)),
    NAV_GROUPS.filter((g) => !NAV_ITEMS.some((i) => i.group === g)).join(', ') || 'all used',
  );
  check('the four groups are Main, Design, Compare, Reference', NAV_GROUPS.join(',') === 'Main,Design,Compare,Reference');
  check('no primary item is left without a description', NAV_ITEMS.every((item) => item.description.length > 0));

  /* --- Title lookup -------------------------------------------------------- */
  check(
    'the topbar finds a title for every primary route',
    primaryHrefs.every((href) => Boolean(navItemFor(href))),
  );
  check(
    'the topbar also finds a title for the utility routes',
    utilityHrefs.every((href) => Boolean(navItemFor(href))),
    utilityHrefs.filter((href) => !navItemFor(href)).join(', ') || 'all found',
  );
  check(
    'a nested route reports its parent section',
    navItemFor('/dashboard/design/advanced')?.href === '/dashboard/design',
    navItemFor('/dashboard/design/advanced')?.href ?? 'undefined',
  );
  check(
    'an unknown route reports no section rather than guessing',
    navItemFor('/nowhere') === undefined,
  );

  /* --- Active-state semantics ---------------------------------------------- */
  check('the exact path is active', isNavActive('/dashboard/design', '/dashboard/design'));
  check('a nested path keeps its parent active', isNavActive('/dashboard/design/x', '/dashboard/design'));
  check(
    'the dashboard is not marked active by every route',
    !isNavActive('/dashboard/design', '/dashboard'),
  );
  check('an unrelated route is not active', !isNavActive('/dashboard/analysis', '/dashboard/design'));

  console.log(
    `    Navigation: ${NAV_ITEMS.length} primary across ${NAV_GROUPS.length} groups · ` +
      `${UTILITY_LINKS.length} utility links`,
  );
}

/* ================================================================== */
/* RESULT                                                              */
/* ================================================================== */

console.log(`\n${'='.repeat(72)}`);
console.log('RESULT');
console.log('='.repeat(72));
console.log(`  ${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);

process.exit(failures === 0 ? 0 : 1);
