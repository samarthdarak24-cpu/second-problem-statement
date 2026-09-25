/**
 * Monthly heat-balance diagnostic.
 *
 * Prints, for one location, the per-month free-running indoor temperature and
 * the four heat-balance terms (kWh per representative day) so the model can be
 * sanity-checked term by term.
 *
 * Run with:  npx tsx scripts/debug-thermal.ts [stationId]
 */

import { resolveClimateOffline } from '../climate/climateService';
import { analyseClimate } from '../climate/climateAnalysis';
import { buildShelterGeometry } from '../utils/shelterGeometry';
import {
  GLAZING_ID,
  resolveMaterials,
  effectiveUValues,
  roofForInsulationLevel,
  wallForInsulationLevel,
} from '../thermal/materials';
import { simulateDesign } from '../thermal/thermalModel';
import { MONTH_LABELS } from '../utils/units';
import type { BuildingParameters } from '../types';

const stationId = process.argv[2] ?? 'in-leh';

function baseline(): BuildingParameters {
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
    ventilationType: 'mixed-mode',
    airChangesPerHour: 5,
    coolingSetpoint: 26,
    heatingSetpoint: 20,
    coolingCop: 3.0,
    heatingEfficiency: 0.85,
    solarPvKwp: 0,
  };
}

const offline = resolveClimateOffline({
  id: stationId,
  country: '',
  state: '',
  city: '',
  latitude: 0,
  longitude: 0,
  elevation: 0,
});

const climate = offline.data;
const base = baseline();
const analysis = analyseClimate(climate, base);

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
  roofMaterialId: roofForInsulationLevel(analysis.insulationLevel, climate.summary.solarRadiation),
};

function report(label: string, params: BuildingParameters): void {
  const materials = resolveMaterials(params);
  const geometry = buildShelterGeometry(params, materials);
  const u = effectiveUValues(materials, params.insulationThickness);
  const result = simulateDesign(params, climate, materials, geometry);

  console.log(`\n--- ${label} ---`);
  console.log(
    `  WWR ${(params.windowToWallRatio * 100).toFixed(0)}%  glazing ${geometry.glazingArea.toFixed(1)} m²  ` +
      `shading ${params.shadingType}@${params.shadingDepth}m  ACH ${params.airChangesPerHour}  ` +
      `insul ${params.insulationLevel}  roof ${params.roofType}`,
  );
  console.log(
    `  U wall ${u.wall.toFixed(2)}  roof ${u.roof.toFixed(2)}  window ${u.window.toFixed(2)} W/m²K   ` +
      `floor ${geometry.floorArea.toFixed(1)} m²  envelope ${geometry.envelopeArea.toFixed(1)} m²  ` +
      `volume ${geometry.volume.toFixed(1)} m³`,
  );
  console.log('  month  outMean  freeIn   solar   intern  conduct  ventil   cool_kWh  heat_kWh');
  result.monthly.forEach((m, i) => {
    const hb = result.heatBalance[i]!;
    console.log(
      `  ${MONTH_LABELS[i]!.padEnd(5)} ${m.outdoorTemp.toFixed(1).padStart(7)} ` +
        `${m.freeFloatTemp.toFixed(1).padStart(7)} ` +
        `${hb.solarGain.toFixed(1).padStart(7)} ${hb.internalGain.toFixed(1).padStart(8)} ` +
        `${hb.conduction.toFixed(1).padStart(8)} ${hb.ventilation.toFixed(1).padStart(8)} ` +
        `${m.coolingEnergy.toFixed(1).padStart(10)} ${m.heatingEnergy.toFixed(1).padStart(9)}`,
    );
  });
  console.log(
    `  annual: cooling ${result.annualCoolingEnergy.toFixed(0)} kWh, ` +
      `heating ${result.annualHeatingEnergy.toFixed(0)} kWh, ` +
      `total ${result.annualEnergy.toFixed(0)} kWh ` +
      `(${result.energyUseIntensity.toFixed(0)} kWh/m²/yr)`,
  );
  console.log(
    `  free-running peak-month indoor ${result.indoorTemperature.toFixed(1)} °C, ` +
      `conditioned ${result.conditionedTemperature.toFixed(0)} °C → PMV ${result.conditionedPmv.toFixed(2)}, ` +
      `PPD ${result.conditionedPpd.toFixed(1)}%`,
  );
}

console.log(`=== ${climate.location.city} (${climate.climateType}) — ${climate.climateZone} ===`);
console.log(
  `  challenge: ${analysis.mainChallenge}; recommended orientation ${analysis.orientationRecommendation}°, ` +
    `WWR ${(analysis.windowRatioRecommendation * 100).toFixed(0)}%, ${analysis.shadingStrategy} ${analysis.shadingDepth} m, ` +
    `${analysis.insulationLevel} insulation, ${analysis.ventilationStrategy}, ${analysis.roofStrategy} roof, ${analysis.glazingStrategy} glazing`,
);

report('BEFORE (baseline brick/RCC, single glazing, no shading, 30% WWR)', base);
report('AFTER (analysis-driven)', optimised);
