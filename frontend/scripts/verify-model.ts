/**
 * Model verification harness.
 *
 * Run with:  npx tsx scripts/verify-model.ts
 *
 * 1. Checks PMV against published ISO 7730 reference conditions.
 * 2. Runs the climate → analysis → geometry → thermal pipeline for two very
 *    different locations (Pune: hot semi-arid, Leh: cold desert) and prints the
 *    headline results, so the model can be sanity-checked at a glance.
 */

import { calculatePmv, ppdFromPmv } from '../thermal/pmv';
import { periodicResponse } from '../thermal/thermalModel';
import { deriveDesignMetrics, discomfortScore, energyScore } from '../thermal/metrics';
import { resolveClimateOffline } from '../climate/climateService';
import { analyseClimate } from '../climate/climateAnalysis';
import { classifyClimate } from '../climate/classify';
import { CLIMATE_STATIONS, STATION_BY_ID } from '../climate/stations';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import { resolveMaterials, GLAZING_ID, wallForInsulationLevel, roofForInsulationLevel } from '../thermal/materials';
import { simulateDesign } from '../thermal/thermalModel';
import { MONTH_LABELS } from '../utils/units';
import type { BuildingParameters } from '../types';

/* ------------------------------------------------------------------ */
/* 0 — Periodic response sanity checks                                 */
/* ------------------------------------------------------------------ */

function checkPeriodicResponse(): boolean {
  console.log('\n=== Construction periodic response (decrement / lag) ===');
  const expectations: Array<[string, number, number, number, number, number, number, number]> = [
    // label, λ, ρ, cp, thickness, expected decrement, expected lag, tolerance
    ['RCC 160 mm', 1.7, 2400, 880, 0.16, 0.34, 4.1, 0.08],
    ['Brick 230 mm', 0.7, 1800, 880, 0.23, 0.12, 8.0, 0.05],
    ['Rammed earth 300 mm', 0.8, 1900, 900, 0.3, 0.07, 10.1, 0.04],
    ['Metal sheet 0.6 mm', 50, 7850, 480, 0.0006, 1.0, 0.0, 0.02],
  ];

  let ok = true;
  for (const [label, l, rho, cp, t, expectedDf, expectedLag, tol] of expectations) {
    const response = periodicResponse(l, rho, cp, t);
    const pass =
      Math.abs(response.decrement - expectedDf) <= tol &&
      Math.abs(response.lagHours - expectedLag) <= Math.max(0.6, tol * 10);
    if (!pass) ok = false;
    console.log(
      `  ${label.padEnd(20)} decrement ${response.decrement.toFixed(3)} ` +
        `(≈${expectedDf})  lag ${response.lagHours.toFixed(1)} h (≈${expectedLag})  ` +
        `${pass ? 'PASS' : 'CHECK'}`,
    );
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* 1 — PMV reference checks                                            */
/* ------------------------------------------------------------------ */

function checkPmv(): boolean {
  console.log('\n=== ISO 7730 PMV reference checks ===');

  // Reference conditions widely used to validate PMV implementations:
  // M = 1.2 met, Icl = 0.5 clo, va = 0.1 m/s, RH = 50 %, Ta = Tr.
  const cases = [
    { ta: 22.0, expected: -0.75, tolerance: 0.15 },
    { ta: 24.0, expected: -0.12, tolerance: 0.15 },
    { ta: 26.0, expected: 0.5, tolerance: 0.2 },
  ];

  let ok = true;
  for (const c of cases) {
    const result = calculatePmv({
      metabolicRate: 1.2 * 58.15,
      externalWork: 0,
      clothingInsulation: 0.5 * 0.155,
      airTemperature: c.ta,
      meanRadiantTemperature: c.ta,
      airVelocity: 0.1,
      relativeHumidity: 50,
    });
    const delta = Math.abs(result.pmv - c.expected);
    const pass = delta <= c.tolerance;
    if (!pass) ok = false;
    console.log(
      `  Ta=Tr=${c.ta.toFixed(1)}°C   PMV=${result.pmv.toFixed(2)} ` +
        `(expected ≈ ${c.expected.toFixed(2)}, Δ=${delta.toFixed(2)})  ` +
        `PPD=${result.ppd.toFixed(1)}%  ${pass ? 'PASS' : 'CHECK'}`,
    );
  }

  // Monotonicity checks.
  const base = {
    metabolicRate: 1.2 * 58.15,
    externalWork: 0,
    clothingInsulation: 0.5 * 0.155,
    airTemperature: 26,
    meanRadiantTemperature: 26,
    airVelocity: 0.1,
    relativeHumidity: 50,
  };
  const warmer = calculatePmv({ ...base, airTemperature: 30, meanRadiantTemperature: 30 });
  const breezier = calculatePmv({ ...base, airVelocity: 1.0 });
  const heavierClothing = calculatePmv({ ...base, clothingInsulation: 0.9 * 0.155 });

  const monotonic =
    warmer.pmv > calculatePmv(base).pmv &&
    breezier.pmv < calculatePmv(base).pmv &&
    heavierClothing.pmv > calculatePmv(base).pmv;

  console.log(`  Monotonic response to heat / air speed / clothing: ${monotonic ? 'PASS' : 'FAIL'}`);
  console.log(`  PPD at PMV=0 → ${ppdFromPmv(0).toFixed(1)}% (ISO expects 5.0%)`);

  return ok && monotonic && Math.abs(ppdFromPmv(0) - 5) < 0.2;
}

/* ------------------------------------------------------------------ */
/* 2 — Full pipeline for two contrasting locations                     */
/* ------------------------------------------------------------------ */

function baselineParameters(): BuildingParameters {
  return {
    buildingType: 'single-family',
    floors: 1,
    width: 8,
    length: 10,
    height: 3,
    wallThickness: 0.23,
    numOccupants: 5,
    numRooms: 2,
    budget: 1500000,
    orientation: 0,
    windowToWallRatio: 0.3,
    facadeWeights: { north: 1, east: 1, south: 1, west: 1 },
    wallMaterialId: 'brick',
    roofMaterialId: 'rcc-slab',
    windowMaterialId: 'single',
    insulationLevel: 'none',
    insulationThickness: 0,
    roofType: 'flat',
    roofAngle: 0,
    roofOverhang: 0.3,
    shadingType: 'none',
    shadingDepth: 0,
    ventilationType: 'natural' as BuildingParameters['ventilationType'],
    // A typical unimproved shelter: windows open much of the time.
    airChangesPerHour: 5,
    coolingSetpoint: 26,
    heatingSetpoint: 20,
    coolingCop: 3.0,
    heatingEfficiency: 0.85,
    solarPvKwp: 0,
  };
}

function runLocation(id: string): void {
  const offline = resolveClimateOffline({
    id,
    country: '',
    state: '',
    city: '',
    latitude: 0,
    longitude: 0,
    elevation: 0,
  });

  const climate = offline.data;
  console.log(`\n=== ${climate.location.city} (${climate.climateType}) ===`);
  console.log(
    `  Climate: mean ${climate.summary.avgTemperature.toFixed(1)}°C, ` +
      `max ${climate.summary.maxTemperature.toFixed(1)}°C, ` +
      `min ${climate.summary.minTemperature.toFixed(1)}°C, ` +
      `RH ${climate.summary.humidity.toFixed(0)}%, ` +
      `solar ${climate.summary.solarRadiation.toFixed(1)} kWh/m²/day, ` +
      `rain ${climate.summary.rainfall.toFixed(0)} mm, ` +
      `diurnal swing ${climate.summary.diurnalSwing.toFixed(1)} K`,
  );

  const base = baselineParameters();
  const analysis = analyseClimate(climate, base);

  console.log(`  Challenge: ${analysis.mainChallenge}`);
  console.log(
    `  Recommended: orientation ${analysis.orientationRecommendation}°, ` +
      `WWR ${(analysis.windowRatioRecommendation * 100).toFixed(0)}%, ` +
      `shading ${analysis.shadingStrategy} (${analysis.shadingDepth} m), ` +
      `insulation ${analysis.insulationLevel}, ` +
      `ventilation ${analysis.ventilationStrategy}, ` +
      `roof ${analysis.roofStrategy}, glazing ${analysis.glazingStrategy}`,
  );

  // --- Baseline ---
  const baseMaterials = resolveMaterials(base);
  const baseGeometry = buildShelterGeometry(base, baseMaterials);
  const baseThermal = simulateDesign(base, climate, baseMaterials, baseGeometry);

  // --- Analysis-driven design (a preview of what the optimiser will refine) ---
  const optimised: BuildingParameters = {
    ...base,
    orientation: analysis.orientationRecommendation,
    windowToWallRatio: analysis.windowRatioRecommendation,
    shadingType: analysis.shadingStrategy,
    shadingDepth: analysis.shadingDepth,
    insulationLevel: analysis.insulationLevel,
    insulationThickness: analysis.insulationThickness,
    ventilationType: analysis.ventilationStrategy,
    airChangesPerHour: analysis.ventilationAch,
    roofType: analysis.roofStrategy,
    roofAngle: analysis.roofStrategy === 'flat' ? 0 : 25,
    windowMaterialId: GLAZING_ID[analysis.glazingStrategy] ?? 'double',
    wallMaterialId: wallForInsulationLevel(analysis.insulationLevel),
    roofMaterialId: roofForInsulationLevel(
      analysis.insulationLevel,
      climate.summary.solarRadiation,
    ),
  };

  const optMaterials = resolveMaterials(optimised);
  const optGeometry = buildShelterGeometry(optimised, optMaterials);
  const optThermal = simulateDesign(optimised, climate, optMaterials, optGeometry);

  const row = (label: string, b: string, o: string) =>
    console.log(`    ${label.padEnd(30)} ${b.padStart(14)} → ${o.padStart(14)}`);

  const bm = deriveDesignMetrics(baseThermal, climate);
  const om = deriveDesignMetrics(optThermal, climate);

  console.log('\n  FREE-RUNNING RESILIENCE  (no HVAC — judged on ASHRAE 55 adaptive band)');
  row(
    `Summer indoor (${MONTH_LABELS[climate.summary.peakCoolingMonth]})`,
    `${bm.summerIndoorTemperature.toFixed(1)} °C`,
    `${om.summerIndoorTemperature.toFixed(1)} °C`,
  );
  row(
    `Winter indoor (${MONTH_LABELS[climate.summary.peakHeatingMonth]})`,
    `${bm.winterIndoorTemperature.toFixed(1)} °C`,
    `${om.winterIndoorTemperature.toFixed(1)} °C`,
  );
  row(
    'Summer overshoot past band',
    `${bm.summerOvertemperature.toFixed(1)} K`,
    `${om.summerOvertemperature.toFixed(1)} K`,
  );
  row(
    'Winter shortfall below band',
    `${bm.winterUndertemperature.toFixed(1)} K`,
    `${om.winterUndertemperature.toFixed(1)} K`,
  );
  row(
    'Adaptive comfort hours',
    `${bm.adaptiveComfortHoursPct.toFixed(1)} %`,
    `${om.adaptiveComfortHoursPct.toFixed(1)} %`,
  );

  console.log('\n  CONDITIONED DELIVERY  (system holding setpoint — ISO 7730 PMV)');
  row(
    `PMV @ ${bm.coolingSetpoint.toFixed(0)} °C`,
    bm.conditionedPmv.toFixed(2),
    om.conditionedPmv.toFixed(2),
  );
  row('PPD', `${bm.conditionedPpd.toFixed(1)} %`, `${om.conditionedPpd.toFixed(1)} %`);
  row(
    'Comfort score',
    `${bm.conditionedComfortScore.toFixed(0)}/100`,
    `${om.conditionedComfortScore.toFixed(0)}/100`,
  );

  console.log('\n  ENERGY');
  row(
    'Annual energy',
    `${bm.annualEnergy.toFixed(0)} kWh`,
    `${om.annualEnergy.toFixed(0)} kWh`,
  );
  row(
    'Energy intensity',
    `${bm.energyUseIntensity.toFixed(0)} kWh/m²`,
    `${om.energyUseIntensity.toFixed(0)} kWh/m²`,
  );
  row(
    'Peak cooling load',
    `${bm.peakCoolingLoad.toFixed(1)} kW`,
    `${om.peakCoolingLoad.toFixed(1)} kW`,
  );
  row(
    'Peak heating load',
    `${bm.peakHeatingLoad.toFixed(1)} kW`,
    `${om.peakHeatingLoad.toFixed(1)} kW`,
  );
  row(
    'Operational CO₂',
    `${bm.co2TonnesPerYear.toFixed(1)} t/yr`,
    `${om.co2TonnesPerYear.toFixed(1)} t/yr`,
  );

  console.log('\n  OBJECTIVE SUB-SCORES  (0 = best, 1 = worst)');
  row(
    'Discomfort',
    discomfortScore(bm).toFixed(2),
    discomfortScore(om).toFixed(2),
  );
  row('Energy', energyScore(bm).toFixed(2), energyScore(om).toFixed(2));

  const savingPct =
    bm.annualEnergy > 0 ? ((bm.annualEnergy - om.annualEnergy) / bm.annualEnergy) * 100 : 0;
  console.log(`\n    Energy reduction: ${savingPct.toFixed(1)} %`);

  console.log(
    `    geometry: floor ${baseGeometry.floorArea.toFixed(1)} m², ` +
      `glazing ${baseGeometry.glazingArea.toFixed(1)} → ${optGeometry.glazingArea.toFixed(1)} m², ` +
      `shading devices ${baseGeometry.shading.length} → ${optGeometry.shading.length}`,
  );
}

/* ------------------------------------------------------------------ */
/* 3 — Climate classification                                          */
/* ------------------------------------------------------------------ */

/**
 * The classifier must never call a hot place cold, or a cold place hot.
 *
 * This is not a hypothetical. The previous version used an aridity threshold of
 * `12·T` instead of Köppen's `20·T + 280`, so Jodhpur — a desert with a 27 °C
 * annual mean and 330 mm of rain — failed the aridity test by four millimetres,
 * fell through to the temperate branch, and was classified as a *subtropical
 * highland*. `analyseClimate` then fed that zone to the orientation search, so
 * the design recommendations were built for a hill station while the header
 * badge displayed "Hot desert".
 *
 * The invariant below is the one that would have caught it.
 */
function checkClassification(): boolean {
  console.log('\n=== Climate classification invariants ===');

  const COLD_ZONES = new Set(['cold-cloudy', 'cold-sunny', 'cold-desert']);
  const HOT_ZONES = new Set(['hot-dry', 'hot-humid', 'warm-humid']);

  let ok = true;

  /* --- Invariant 1: no warm site in a cold zone, or vice versa. --- */
  let violations = 0;
  for (const station of CLIMATE_STATIONS) {
    const derived = classifyClimate(station.monthly);
    const { annualMeanTemp: mean } = derived;
    if (mean >= 20 && COLD_ZONES.has(derived.zone)) {
      console.log(
        `  ✗ ${station.location.id.padEnd(14)} mean ${mean.toFixed(1)} °C but zone "${derived.zone}"`,
      );
      violations += 1;
      ok = false;
    }
    if (mean <= 10 && HOT_ZONES.has(derived.zone)) {
      console.log(
        `  ✗ ${station.location.id.padEnd(14)} mean ${mean.toFixed(1)} °C but zone "${derived.zone}"`,
      );
      violations += 1;
      ok = false;
    }
  }
  console.log(
    `  ${violations === 0 ? '✓' : '✗'} no station is classified across the hot/cold divide ` +
      `(${CLIMATE_STATIONS.length} stations checked)`,
  );

  /* --- Invariant 2: named cases that were previously wrong. --- */
  const named: Array<[string, string, string]> = [
    // station id, expected zone, why it is here
    ['in-jodhpur', 'hot-dry', 'a desert must not be a highland'],
    ['in-jaipur', 'hot-dry', 'semi-arid, monsoonal'],
    ['in-leh', 'cold-desert', 'high, dry and freezing'],
    ['gb-london', 'temperate', 'mild oceanic, not a highland'],
    ['is-reykjavik', 'cold-cloudy', 'a mild winter does not make it temperate'],
    ['in-chennai', 'hot-humid', 'tropical monsoon'],
  ];
  for (const [id, expected, why] of named) {
    const station = STATION_BY_ID.get(id);
    if (!station) continue;
    const derived = classifyClimate(station.monthly);
    const pass = derived.zone === expected;
    if (!pass) ok = false;
    console.log(
      `  ${pass ? '✓' : '✗'} ${id.padEnd(14)} ${derived.zone.padEnd(13)} (${derived.code})` +
        `  ${pass ? '' : `expected ${expected} — `}${why}`,
    );
  }

  /* --- Reported, not asserted: agreement with the stored design zones. --- */
  /*
   * The catalogue stores a *design* zone per station, hand-checked for the
   * question "what does this climate ask of a building?". Köppen answers a
   * different question — what does the rainfall and temperature regime look
   * like? — so the two cannot agree everywhere. Coimbatore is Köppen Aw but a
   * hot-dry design problem; Shillong is Cfb but a cold-cloudy one.
   *
   * The floor below is therefore a regression guard, not a target. It exists so
   * that a future change which quietly degrades the classifier fails the suite.
   */
  const mismatches = CLIMATE_STATIONS.filter(
    (station) => classifyClimate(station.monthly).zone !== station.climateZone,
  );
  const agreement = (CLIMATE_STATIONS.length - mismatches.length) / CLIMATE_STATIONS.length;
  const floor = 0.65;
  if (agreement < floor) ok = false;

  console.log(
    `\n  ${agreement >= floor ? '✓' : '✗'} derived zone agrees with the stored design zone for ` +
      `${CLIMATE_STATIONS.length - mismatches.length}/${CLIMATE_STATIONS.length} stations ` +
      `(${(agreement * 100).toFixed(0)} %, floor ${(floor * 100).toFixed(0)} %)`,
  );
  console.log(
    '    The stored zones are a design vocabulary; the classifier is Köppen. Where they differ\n' +
      '    the stored zone wins for catalogue stations — see `analyseClimate`, which reads the\n' +
      '    zone from the resolved payload rather than re-deriving it.',
  );

  return ok;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const periodicOk = checkPeriodicResponse();
const pmvOk = checkPmv();
runLocation('in-pune');
runLocation('in-leh');
const classificationOk = checkClassification();

console.log(
  `\nPeriodic response: ${periodicOk ? 'ALL PASS' : 'REVIEW NEEDED'}` +
    `\nPMV reference checks: ${pmvOk ? 'ALL PASS' : 'REVIEW NEEDED'}` +
    `\nClimate classification: ${classificationOk ? 'ALL PASS' : 'REVIEW NEEDED'}`,
);
