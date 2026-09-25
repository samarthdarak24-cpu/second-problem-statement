/**
 * Export the surrogate training set, the feature contract, and the climate
 * parity fixtures for the FastAPI backend.
 *
 * WHY THIS IS A TYPESCRIPT SCRIPT
 * The rows in a training set have to be *labelled* by the physics engine. The
 * physics engine is the verified TypeScript implementation in `thermal/`, which
 * is covered by 70 assertions and the PMV and periodic-response reference
 * checks. Labelling the same rows from a Python port would mean the surrogate
 * learns the port's behaviour, including any error the port introduced — and the
 * resulting model would be confidently wrong in exactly the places the port
 * disagrees with the truth.
 *
 * So the engine that generates the data is the engine that is verified, and
 * Python's only job is to fit a function to its output.
 *
 * THREE ARTEFACTS
 *   feature-contract.json — the column order, written straight from
 *     `FEATURE_NAMES`. `backend/app/ml.py` refuses to train if its own copy of
 *     the list disagrees, which is what stops a reordered column from silently
 *     pairing every coefficient with the wrong feature.
 *   training-set.json     — the labelled rows.
 *   climate-fixtures.json — the TypeScript climate engine's output for a fixed
 *     set of stations, which `backend/tests/test_parity.py` compares the Python
 *     port against. A shape check cannot catch a unit error; this can.
 *
 * Run:  npx tsx scripts/export-dataset.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuildingParameters, ClimateStationRecord } from '@/types';
import { buildClimateData } from '@/climate/deriveClimate';
import { classifyClimate } from '@/climate/classify';
import { CLIMATE_STATIONS } from '@/climate/stations';
import { FEATURE_NAMES, TARGET_NAMES, encodeFeaturesNamed } from '@/ml/features';
import { VALIDATION_GATE } from '@/ml/surrogate';
import { effectiveUValues, resolveMaterials } from '@/thermal/materials';
import { deriveDesignMetrics } from '@/thermal/metrics';
import { simulateDesign } from '@/thermal/thermalModel';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { estimateCost } from '@/optimization/costModel';
import { buildDesignSpace, conventionalBaseline } from '@/optimization/designSpace';
import { defaultRequirements } from '@/lib/parameters';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, '..', 'backend', 'data');

/* ------------------------------------------------------------------ */
/* Deterministic sampling                                              */
/* ------------------------------------------------------------------ */

/**
 * A seeded PRNG.
 *
 * `Math.random()` would make the dataset different on every run, which would
 * make "the model scored R² 0.94" an unreproducible claim. mulberry32 is four
 * lines and good enough for sampling a design space.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20250925);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function uniform(low: number, high: number): number {
  return low + random() * (high - low);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* One sampled design programme                                        */
/* ------------------------------------------------------------------ */

/*
 * The design space axes come from the same `buildDesignSpace` the optimiser
 * searches, with `exhaustive` set — so the surrogate is trained on the options
 * the optimiser can actually reach, not on a wider or narrower set.
 */
const SPACE = buildDesignSpace(conventionalBaseline(defaultRequirements()), undefined as never, true);

function sampleDesign(): BuildingParameters {
  const shading = pick(SPACE.shading);
  const ventilation = pick(SPACE.ventilation);
  const insulationLevel = pick(SPACE.insulationLevels);
  const roofType = pick(SPACE.roofTypes);

  // Programme and services are sampled independently of the envelope, so the
  // model sees each of them vary while the others are held across their range.
  // Sampling them together would leave the effects confounded.
  return {
    ...defaultRequirements(),
    width: round(uniform(3.5, 8.0), 2),
    length: round(uniform(3.0, 7.0), 2),
    height: round(uniform(2.4, 3.4), 2),
    wallThickness: round(uniform(0.15, 0.35), 3),
    numOccupants: Math.round(uniform(1, 8)),
    numRooms: Math.round(uniform(1, 3)),
    budget: Math.round(uniform(300_000, 1_200_000) / 10_000) * 10_000,

    orientation: pick(SPACE.orientations),
    windowToWallRatio: pick(SPACE.windowRatios),
    insulationLevel,
    insulationThickness: insulationLevel === 'none' ? 0 : round(uniform(0.02, 0.15), 3),
    shadingType: shading.type,
    shadingDepth: shading.depth,
    windowMaterialId: pick(SPACE.glazingIds),
    roofType,
    roofAngle: roofType === 'flat' ? 0 : round(uniform(10, 40), 1),
    roofOverhang: round(uniform(0, 1.2), 2),
    wallMaterialId: pick(SPACE.wallMaterialIds),
    roofMaterialId: pick(SPACE.roofMaterialIds),
    ventilationType: ventilation.type,
    airChangesPerHour: ventilation.ach,

    coolingSetpoint: round(uniform(22, 28), 1),
    heatingSetpoint: round(uniform(16, 21), 1),
    coolingCop: round(uniform(2.4, 4.2), 2),
    heatingEfficiency: round(uniform(0.7, 1.0), 2),
    solarPvKwp: pick(SPACE.pvOptions),
  } as BuildingParameters;
}

/* ------------------------------------------------------------------ */
/* Label one row with the verified engine                              */
/* ------------------------------------------------------------------ */

/** One labelled row: 42 features plus the three targets, all numeric. */
type TrainingRow = Record<string, number>;

function labelRow(parameters: BuildingParameters, climate: ReturnType<typeof buildClimateData>): TrainingRow {
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  const thermal = simulateDesign(parameters, climate, materials, geometry);
  const metrics = deriveDesignMetrics(thermal, climate);
  const cost = estimateCost({ parameters, materials, geometry, metrics });

  const features = encodeFeaturesNamed({
    parameters,
    climate,
    materials,
    uValues: effectiveUValues(materials, parameters.insulationThickness),
  });

  return {
    ...features,
    energy_use_intensity_kwh_m2_yr: round(metrics.energyUseIntensity, 6),
    adaptive_comfort_hours_pct: round(metrics.adaptiveComfortHoursPct, 6),
    cost_per_m2_inr: round(cost.costPerSqm, 4),
  };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

/*
 * The default is chosen to clear the validation gate, not to be fast.
 *
 * 1 500 rows is a tempting default — it exports in under two seconds — but the
 * model it produces fails the gate: comfort rank correlation 0.888 against a
 * 0.90 floor, and cost MAE ₹2 804 against ₹2 500. Shipping a default that
 * produces a refused model would make the documented quick start look broken.
 * 12 000 rows clears every target with margin (ρ 0.974 / 0.927 / 0.990) and
 * exports in about twelve seconds.
 */
const ROW_TARGET = Number(process.argv[2] ?? 12000);

mkdirSync(outputDir, { recursive: true });

function write(name: string, payload: unknown): void {
  writeFileSync(join(outputDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const size = JSON.stringify(payload).length;
  console.log(`  wrote ${name.padEnd(24)} ${(size / 1024).toFixed(1)} kB`);
}

console.log(`\nExporting dataset artefacts to ${outputDir}\n`);

/* 1 — Feature contract. */
write('feature-contract.json', {
  generatedBy: 'scripts/export-dataset.ts',
  featureNames: [...FEATURE_NAMES],
  targetNames: [...TARGET_NAMES],
  featureCount: FEATURE_NAMES.length,
  gate: {
    minSpearman: [...VALIDATION_GATE.minSpearman],
    maxMae: [...VALIDATION_GATE.maxMae],
  },
  note: 'Written from ml/features.ts and ml/surrogate.ts. backend/app/ml.py refuses to train if its copies disagree.',
});

/* 2 — Climate parity fixtures. */
/*
 * Every station, so the parity test covers all eight climate zones rather than
 * whichever one happens to be convenient. The Python port is a copy, and a copy
 * of 33 records × 12 months × 9 fields is exactly the kind of thing that drifts
 * by one rounding step in one month and goes unnoticed for a year.
 *
 * The derived classification is included alongside the stored one on purpose.
 * They are different quantities: `climateZone` is the catalogue's hand-checked
 * *design* zone, while `classification` is what the Köppen heuristic produces
 * from the same months. The backend port must reproduce the heuristic exactly,
 * so the heuristic's own output is what the parity test compares — comparing the
 * stored zone would test nothing, because the port never computes it.
 */
const fixtures = CLIMATE_STATIONS.map((station: ClimateStationRecord) => {
  const data = buildClimateData(station, 'database');
  return {
    stationId: station.location.id,
    location: station.location,
    climateType: data.climateType,
    climateZone: data.climateZone,
    derivedClassification: classifyClimate(station.monthly),
    summary: data.summary,
    designConditions: data.designConditions,
    monthly: data.monthly,
  };
});

write('climate-fixtures.json', {
  generatedBy: 'scripts/export-dataset.ts',
  capturedFrom: 'climate/deriveClimate.ts + climate/classify.ts',
  count: fixtures.length,
  fixtures,
});

/* 3 — Training set. */
console.log(`\nLabeling ${ROW_TARGET} rows with the verified physics engine…`);
const startedAt = Date.now();

const rows: TrainingRow[] = [];
const climateCache = new Map<string, ReturnType<typeof buildClimateData>>();

for (let index = 0; index < ROW_TARGET; index += 1) {
  const station = pick(CLIMATE_STATIONS);
  let climate = climateCache.get(station.location.id);
  if (!climate) {
    climate = buildClimateData(station, 'database');
    climateCache.set(station.location.id, climate);
  }

  const parameters = sampleDesign();
  rows.push(labelRow(parameters, climate));

  if ((index + 1) % 500 === 0) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  ${String(index + 1).padStart(5)} rows   ${elapsed}s`);
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

write('training-set.json', {
  generatedBy: 'scripts/export-dataset.ts',
  seed: 20250925,
  featureNames: [...FEATURE_NAMES],
  targetNames: [...TARGET_NAMES],
  rows,
  stationsSampled: climateCache.size,
  note: 'Labels produced by the verified TypeScript engine. Do not edit by hand.',
});

/* A quick sanity read on the labels, so a silently broken export is obvious. */
const stats = (name: string): string => {
  const values = rows.map((row) => row[name]!).sort((a, b) => a - b);
  const min = values[0]!;
  const max = values[values.length - 1]!;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${min.toFixed(2)} … ${max.toFixed(2)} (mean ${mean.toFixed(2)})`;
};

console.log(`\nDone in ${elapsed}s — ${rows.length} rows\n`);
for (const target of TARGET_NAMES) {
  console.log(`  ${target.padEnd(34)} ${stats(target)}`);
}
console.log(
  '\nTrain with:  POST /api/ml/train  { "rows": [...], "targets": ["energy_use_intensity_kwh_m2_yr", ...] }\n',
);
