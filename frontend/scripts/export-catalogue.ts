/**
 * Export the shared catalogue to JSON for the FastAPI backend.
 *
 * WHY AN EXPORT RATHER THAN A PORT
 * The climatology database is 33 stations × 12 months of hand-checked normals,
 * and the material catalogue is 24 assemblies with thermal properties. Copying
 * either into Python by hand guarantees the two will drift, and a backend whose
 * U-value for "high insulation" differs from the frontend's is worse than no
 * backend at all.
 *
 * So TypeScript stays the single source of truth for *data*, and Python consumes
 * the artefact this script writes. The backend's own value is the things a
 * server can do that a browser cannot: caching, persistence, and model serving.
 *
 * Run:  npx tsx scripts/export-catalogue.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLIMATE_STATIONS } from '@/climate/stations';
import {
  INSULATION_MATERIALS,
  ROOF_MATERIALS,
  WALL_MATERIALS,
  WINDOW_MATERIALS,
} from '@/thermal/materials';
import {
  INSULATION_LABEL,
  INSULATION_LEVEL_THICKNESS,
  INSULATION_LEVELS,
  ROOF_LABEL,
  ROOF_PITCH,
  ROOF_STRATEGIES,
  SHADING_LABEL,
  SHADING_STRATEGIES,
  VENTILATION_ACH,
  VENTILATION_LABEL,
  VENTILATION_STRATEGIES,
} from '@/thermal/constants';
import { defaultRequirements } from '@/lib/parameters';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, '..', 'backend', 'data');

function write(name: string, payload: unknown): void {
  const path = join(outputDir, name);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const size = JSON.stringify(payload).length;
  console.log(`  wrote ${name.padEnd(20)} ${(size / 1024).toFixed(1)} kB`);
}

mkdirSync(outputDir, { recursive: true });

console.log(`\nExporting catalogue to ${outputDir}\n`);

/* --- Stations ------------------------------------------------------ */
write('stations.json', {
  generatedBy: 'scripts/export-catalogue.ts',
  stationCount: CLIMATE_STATIONS.length,
  stations: CLIMATE_STATIONS,
});

/* --- Materials ----------------------------------------------------- */
write('materials.json', {
  generatedBy: 'scripts/export-catalogue.ts',
  materials: [
    ...WALL_MATERIALS,
    ...ROOF_MATERIALS,
    ...WINDOW_MATERIALS,
    ...INSULATION_MATERIALS,
  ],
});

/* --- Design vocabularies and shared constants ---------------------- */
/*
 * These are the mappings the thermal model and the cost model both read. They
 * live in `thermal/constants.ts` precisely so that a slider, a cost estimate and
 * a heat balance cannot disagree about how thick "high" insulation is — and the
 * backend needs the same answer.
 */
write('vocabulary.json', {
  generatedBy: 'scripts/export-catalogue.ts',
  insulation: {
    levels: INSULATION_LEVELS,
    thicknessM: INSULATION_LEVEL_THICKNESS,
    label: INSULATION_LABEL,
  },
  ventilation: {
    strategies: VENTILATION_STRATEGIES,
    ach: VENTILATION_ACH,
    label: VENTILATION_LABEL,
  },
  roof: {
    strategies: ROOF_STRATEGIES,
    pitchDeg: ROOF_PITCH,
    label: ROOF_LABEL,
  },
  shading: {
    strategies: SHADING_STRATEGIES,
    label: SHADING_LABEL,
  },
  defaultRequirements: defaultRequirements(),
});

console.log('\nDone. The backend reads these files; do not edit them by hand.\n');
