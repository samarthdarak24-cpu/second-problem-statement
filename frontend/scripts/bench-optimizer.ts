/**
 * Optimiser benchmark and end-to-end pipeline check.
 *
 * Runs the full chain — climate → analysis → optimisation → comparison — for a
 * spread of climates and prints what it produced and how long it took. This is
 * the harness that decides whether the search is fast enough to sit behind an
 * interactive UI, and whether the recommendations are sane in every zone rather
 * than just in Pune.
 *
 * Run with:  npx tsx scripts/bench-optimizer.ts
 */

import { resolveClimateOffline } from '../climate/climateService';
import { analyseClimate } from '../climate/climateAnalysis';
import { optimizeDesign } from '../optimization/optimizer';
import { conventionalBaseline } from '../optimization/designSpace';
import { evaluateParameters, designScore } from '../optimization/objective';
import { compareDesigns, summariseComparison } from '../optimization/comparison';
import { deriveDesignMetrics } from '../thermal/metrics';
import { MONTH_LABELS } from '../utils/units';
import { DEFAULT_STATION_ID, STATION_BY_ID } from '../climate/stations';
import type { BuildingParameters, Location } from '../types';

const CLIMATES = [
  'in-pune',
  'in-leh',
  'in-jaisalmer' in STATION_BY_ID ? 'in-jaisalmer' : 'in-jodhpur',
  'in-chennai',
  'in-shillong',
  'in-srinagar',
  'ae-dubai',
  'gb-london',
];

function requirements(): BuildingParameters {
  return {
    // A plain detached single-storey house: the neutral case the search starts from.
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
    ventilationType: 'mixed-mode',
    airChangesPerHour: 3,
    coolingSetpoint: 26,
    heatingSetpoint: 20,
    coolingCop: 3.0,
    heatingEfficiency: 0.85,
    solarPvKwp: 0,
  };
}

function locationFor(id: string): Location {
  const station = STATION_BY_ID.get(id);
  if (station) return { ...station.location };
  return {
    id,
    city: id,
    state: '',
    country: '',
    latitude: 0,
    longitude: 0,
    elevation: 0,
  };
}

let totalMs = 0;
let totalEvaluations = 0;
let worstMs = 0;

for (const id of CLIMATES) {
  const offline = resolveClimateOffline(locationFor(id));
  const climate = offline.data;
  const base = requirements();
  const analysis = analyseClimate(climate, base);

  const started = performance.now();
  const result = optimizeDesign({ requirements: base, climate, analysis });
  const elapsed = performance.now() - started;

  totalMs += elapsed;
  totalEvaluations += result.candidatesEvaluated;
  worstMs = Math.max(worstMs, elapsed);

  const baseline = evaluateParameters(
    'baseline',
    'Conventional',
    conventionalBaseline(base),
    climate,
    { discomfort: 0.45, energy: 0.35, cost: 0.2 },
  );
  const optimized = evaluateParameters(
    'optimized',
    'Optimised',
    result.parameters,
    climate,
    { discomfort: 0.45, energy: 0.35, cost: 0.2 },
  );

  const bm = deriveDesignMetrics(baseline.thermal, climate);
  const om = deriveDesignMetrics(optimized.thermal, climate);
  const comparison = compareDesigns(
    { label: 'Conventional', parameters: baseline.parameters, thermal: baseline.thermal, cost: baseline.cost },
    { label: 'Optimised', parameters: optimized.parameters, thermal: optimized.thermal, cost: optimized.cost },
    climate,
  );

  console.log(`\n${'='.repeat(78)}`);
  console.log(
    `${climate.location.city}, ${climate.location.country}  —  ${climate.climateType}  [${climate.climateZone}]`,
  );
  console.log(
    `  mean ${climate.summary.avgTemperature.toFixed(1)} °C · max ${climate.summary.maxTemperature.toFixed(1)} · ` +
      `min ${climate.summary.minTemperature.toFixed(1)} · RH ${climate.summary.humidity.toFixed(0)} % · ` +
      `solar ${climate.summary.solarRadiation.toFixed(1)} kWh/m²·d · swing ${climate.summary.diurnalSwing.toFixed(1)} K`,
  );
  console.log(`  challenge: ${analysis.mainChallenge} — ${analysis.challengeDetail.slice(0, 110)}…`);
  console.log(
    `  search: ${result.candidatesEvaluated} evaluations in ${elapsed.toFixed(0)} ms  →  score ${result.score}/100`,
  );

  const p = result.parameters;
  console.log(
    `  chosen: orientation ${Math.round(p.orientation)}° · WWR ${Math.round(p.windowToWallRatio * 100)} % · ` +
      `shading ${p.shadingType} ${p.shadingDepth} m · insulation ${p.insulationLevel} ` +
      `(${Math.round(p.insulationThickness * 1000)} mm) · ${p.wallMaterialId} · ${p.roofMaterialId} · ` +
      `${p.roofType} roof · ${p.windowMaterialId} glazing · ${p.ventilationType} ${p.airChangesPerHour} ACH · ` +
      `PV ${p.solarPvKwp} kWp`,
  );

  console.log(
    `  summer indoor ${bm.summerIndoorTemperature.toFixed(1)} → ${om.summerIndoorTemperature.toFixed(1)} °C  |  ` +
      `winter indoor ${bm.winterIndoorTemperature.toFixed(1)} → ${om.winterIndoorTemperature.toFixed(1)} °C`,
  );
  console.log(
    `  adaptive comfort ${bm.adaptiveComfortHoursPct.toFixed(1)} → ${om.adaptiveComfortHoursPct.toFixed(1)} %  |  ` +
      `energy ${bm.energyUseIntensity.toFixed(0)} → ${om.energyUseIntensity.toFixed(0)} kWh/m²·yr  |  ` +
      `cost ₹${(baseline.cost.costPerSqm / 1000).toFixed(1)}k → ₹${(optimized.cost.costPerSqm / 1000).toFixed(1)}k/m²`,
  );
  console.log(
    `  design score ${designScore(baseline.objective)} → ${result.score}  |  ` +
      `energy ${result.energySavingsPct.toFixed(0)} %  |  cost delta ₹${(result.costDelta / 100000).toFixed(2)} lakh  |  ` +
      `budget ${optimized.cost.withinBudget ? 'OK' : `over by ₹${(optimized.cost.budgetDelta / 1000).toFixed(0)}k`}`,
  );
  console.log(`  narrative: ${summariseComparison(comparison)}`);

  console.log(`  recommendations (${result.recommendations.length}):`);
  for (const rec of result.recommendations.slice(0, 7)) {
    console.log(
      `    [${rec.impact.padEnd(6)}] ${rec.parameter.padEnd(20)} = ${rec.value.padEnd(30)} ` +
        `${rec.effect ? `→ ${rec.effect}` : ''}`,
    );
  }

  const leaderboard = result.leaderboard.slice(0, 4);
  console.log('  leaderboard:');
  for (const entry of leaderboard) {
    const metrics = deriveDesignMetrics(entry.thermal, climate);
    console.log(
      `    obj ${entry.objective.toFixed(3)}  energy ${metrics.energyUseIntensity.toFixed(0).padStart(4)} kWh/m²·yr  ` +
        `comfort ${metrics.adaptiveComfortHoursPct.toFixed(0).padStart(3)} %  ` +
        `₹${(entry.cost / 100000).toFixed(2)} lakh  — ${entry.label}`,
    );
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log(
  `Total ${totalMs.toFixed(0)} ms across ${CLIMATES.length} climates ` +
    `(${(totalMs / CLIMATES.length).toFixed(0)} ms average, ${worstMs.toFixed(0)} ms worst), ` +
    `${totalEvaluations} evaluations total (${(totalEvaluations / CLIMATES.length).toFixed(0)} per climate).`,
);
console.log(
  `Peak months checked: cooling ${MONTH_LABELS[0]}…${MONTH_LABELS[11]} — default station ${DEFAULT_STATION_ID}.`,
);
