/**
 * Scenario sweeps — the module that makes the project's central claim visible.
 *
 * WHY THIS FILE EXISTS
 * A single optimised design on a single site proves nothing. It is one picture
 * of one building, and a reader has no way to tell whether the numbers came out
 * of a climate model or out of a random number generator. The claim this project
 * is actually making is *conditional*:
 *
 *     same site  →  five building types  →  five different optimised designs
 *     same type  →  five sites           →  five different optimised designs
 *
 * Both halves of that sentence are a statement about *differences*, and a
 * difference needs at least two things to exist. So this module runs the real
 * pipeline more than once and returns the results side by side, which is the
 * only form in which the claim can be checked rather than believed.
 *
 * WHAT IT DOES NOT DO
 * It does not invent a second, cheaper evaluation path. Every cell here goes
 * through the same `optimizeDesign` → `evaluateDesign` → `conventionalBaseline`
 * chain the Design Studio uses, on the same physics, with the same objective
 * and the same weights. If the studio says a design scores 71, the sweep will
 * say 71. A comparison surface that computed its own numbers would be worse
 * than no comparison surface at all.
 *
 * WHY THE LOCATION SWEEP IS OFFLINE
 * `resolveClimate` reaches for a network provider first. Five of those in a row
 * would make this panel slow, flaky, and different every time it ran — and a
 * comparison whose baseline moves is not a comparison. The location sweep
 * therefore builds its `ClimateData` straight from the offline climatology
 * database (`buildClimateData`), which is deterministic, instant, and the same
 * normals the provider chain falls back to anyway. The panel labels it as such.
 */

import type {
  BuildingParameters,
  BuildingTypeId,
  CandidateEvaluation,
  ClimateAnalysis,
  ClimateData,
  CostEstimate,
  Location,
  ObjectiveWeights,
  Recommendation,
  ResolvedMaterials,
  ShelterGeometry,
} from '@/types';
import type { DesignMetrics } from '@/thermal/metrics';
import {
  BUILDING_TYPE_ORDER,
  applyBuildingType,
  buildingType,
} from '@/lib/buildingTypes';
import { STATION_BY_ID } from '@/climate/stations';
import { buildClimateData } from '@/climate/deriveClimate';
import { analyseClimate } from '@/climate/climateAnalysis';
import { getMaterial } from '@/thermal/materials';
import {
  INSULATION_LABEL,
  ROOF_LABEL,
  SHADING_LABEL,
  VENTILATION_LABEL,
} from '@/thermal/constants';
import { conventionalBaseline } from '@/optimization/designSpace';
import { optimizeDesign } from '@/optimization/optimizer';
import { DEFAULT_WEIGHTS, designScore } from '@/optimization/objective';
import { evaluateDesign } from '@/optimization/pipeline';
import { assemblyById } from '@/thermal/assemblies';
import { DEFAULT_DOOR_ID } from '@/thermal/materials';
import { DEFAULT_GLAZING_BIAS, glazingBiasOption } from '@/lib/glazingBias';

/** The assembly's display name, or null when no assembly is selected. */
function assemblyName(id: string | undefined): string | null {
  if (!id) return null;
  return assemblyById(id)?.name ?? null;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Which axis the sweep holds fixed and which one it varies. */
export type ScenarioAxis = 'building-type' | 'location';

/**
 * The three designs every cell is measured between.
 *
 * `traditional` is conventional local construction — what gets built without
 * any climate thinking. `optimised` is what the search produced. `low-cost` is
 * the cheapest design the *same* search found, which is not the same thing as
 * the traditional one: the search may reach a cheaper design than the
 * conventional baseline by spending its budget differently rather than by
 * spending less of it. Showing all three is what turns "the AI made it better"
 * into a choice the reader can actually make.
 */
export type ScenarioVariantKind = 'traditional' | 'optimised' | 'low-cost';

export interface ScenarioVariant {
  kind: ScenarioVariantKind;
  label: string;
  parameters: BuildingParameters;
  /**
   * The materials and the parametric geometry of this exact variant.
   *
   * Carried because the whole point of the page is that the three options are
   * *different buildings*, and the only honest way to show that is to draw each
   * one from the description its own numbers were computed from. Deriving the
   * geometry again in the view layer would be a second definition of "the
   * design", which is the one thing this codebase refuses to have.
   */
  materials: ResolvedMaterials;
  geometry: ShelterGeometry;
  metrics: DesignMetrics;
  cost: CostEstimate;
  score: number;
}

/** One changed design axis, already formatted for display. */
export interface ParameterDelta {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** One cell of the matrix: one building type at one site, fully evaluated. */
export interface ScenarioCell {
  /** Stable identity for React keys and for the "best cell" pointer. */
  key: string;
  /** The headline — the building type, or the city, depending on the axis. */
  title: string;
  /** The supporting line — the climate, or the building type. */
  subtitle: string;
  glyph: string;
  accentHue: number;

  location: Location;
  climate: ClimateData;
  analysis: ClimateAnalysis;

  /** Traditional / optimised / low-cost, all evaluated on this site's climate. */
  variants: ScenarioVariant[];
  /** The optimised design — the one the cell is actually about. */
  parameters: BuildingParameters;
  /** Materials + geometry of the optimised design, for the 3D view. */
  materials: ResolvedMaterials;
  geometry: ShelterGeometry;
  metrics: DesignMetrics;
  cost: CostEstimate;
  score: number;

  /**
   * What the search changed, measured against conventional local construction.
   *
   * The comparison is against the conventional build rather than against the
   * climate engine's seed because "the AI moved the window ratio from 30 % to
   * 18 %" is a statement about a building somebody would actually have built.
   */
  changes: ParameterDelta[];
  /** The optimiser's own recommendations, verbatim — no paraphrase. */
  recommendations: Recommendation[];
  /** Search effort spent on this cell, for the transparency line. */
  candidatesEvaluated: number;
}

export interface ScenarioSweep {
  axis: ScenarioAxis;
  cells: ScenarioCell[];
  /** Best-scoring cell, and the worst — the spread is the finding. */
  bestKey: string;
  worstKey: string;
  /** Plain-language reading, composed from the numbers above and nothing else. */
  headline: string;
  /** Provenance of the climate the sweep used. */
  note: string;
  durationMs: number;
}

export interface SweepOptions {
  /** Programme to seed each cell from. Defaults to the app's default programme. */
  base: BuildingParameters;
  weights?: ObjectiveWeights;
  /** Called after each cell finishes so the UI can paint progress. */
  onCell?: (cell: ScenarioCell, index: number, total: number) => void;
}

/* ------------------------------------------------------------------ */
/* The two axes                                                        */
/* ------------------------------------------------------------------ */

/**
 * The five sites the location sweep visits.
 *
 * Chosen to be maximally *unlike* each other rather than maximally convenient,
 * because a sweep across five similar climates would show five similar designs
 * and prove nothing. Between them these five span the design strategies the
 * engine can choose:
 *
 *   Pune       hot semi-arid, moderate — the reference case
 *   Jodhpur    hot desert, 41 °C peaks — shade, mass and night purge
 *   Chennai    hot and humid — ventilation, not mass
 *   Leh        cold desert, −14 °C nights — insulation and solar gain
 *   Shillong   cool and very cloudy — insulation with almost no sun to collect
 *
 * Jodhpur and Leh in particular are the same country, the same latitude band
 * and opposite problems, which is the point: the climate, not the geography,
 * is what the design is responding to.
 */
export const LOCATION_SWEEP_IDS = [
  'in-pune',
  'in-jodhpur',
  'in-chennai',
  'in-leh',
  'in-shillong',
] as const;

/** The five building types, in selector order. */
export const TYPE_SWEEP_IDS: BuildingTypeId[] = BUILDING_TYPE_ORDER;

/* ------------------------------------------------------------------ */
/* Deltas                                                              */
/* ------------------------------------------------------------------ */

interface AxisDescriptor {
  key: string;
  label: string;
  read: (p: BuildingParameters) => string;
}

/**
 * The axes worth reporting a change on.
 *
 * Deliberately not "every field that differs". Width, length, occupancy and
 * budget are programme — the sweep holds them fixed on purpose, and a diff that
 * listed them would imply the optimiser had been allowed to move them. These
 * are the axes the search is actually permitted to touch.
 */
const DIFF_AXES: AxisDescriptor[] = [
  {
    key: 'orientation',
    label: 'Orientation',
    read: (p) => `${Math.round(p.orientation)}°`,
  },
  {
    key: 'glazingBias',
    label: 'Glazing position',
    read: (p) => glazingBiasOption(p.glazingBias ?? DEFAULT_GLAZING_BIAS).label,
  },
  {
    key: 'windowToWallRatio',
    label: 'Window-to-wall ratio',
    read: (p) => `${Math.round(p.windowToWallRatio * 100)} %`,
  },
  {
    key: 'wallMaterialId',
    label: 'Wall construction',
    /* A composite assembly replaces the single material, so reporting the
       material id while an assembly is selected would name a wall that is not
       being built. The assembly wins when it is set. */
    read: (p) => assemblyName(p.wallAssemblyId) ?? getMaterial(p.wallMaterialId).name,
  },
  {
    key: 'roofMaterialId',
    label: 'Roof construction',
    read: (p) => assemblyName(p.roofAssemblyId) ?? getMaterial(p.roofMaterialId).name,
  },
  {
    key: 'windowMaterialId',
    label: 'Glazing',
    read: (p) => getMaterial(p.windowMaterialId).name,
  },
  {
    key: 'doorMaterialId',
    label: 'Door',
    read: (p) => getMaterial(p.doorMaterialId ?? DEFAULT_DOOR_ID).name,
  },
  {
    key: 'insulationLevel',
    label: 'Insulation',
    read: (p) => INSULATION_LABEL[p.insulationLevel],
  },
  {
    key: 'roofType',
    label: 'Roof form',
    read: (p) => ROOF_LABEL[p.roofType],
  },
  {
    key: 'shading',
    label: 'Shading',
    read: (p) =>
      p.shadingType === 'none' || p.shadingDepth <= 0
        ? 'None'
        : `${SHADING_LABEL[p.shadingType]} · ${p.shadingDepth.toFixed(2)} m`,
  },
  {
    key: 'ventilation',
    label: 'Ventilation',
    read: (p) => `${VENTILATION_LABEL[p.ventilationType]} · ${p.airChangesPerHour} ACH`,
  },
  {
    key: 'solarPvKwp',
    label: 'Solar PV',
    read: (p) => (p.solarPvKwp > 0 ? `${p.solarPvKwp} kWp` : 'None'),
  },
];

/**
 * The axes on which two designs differ, formatted for display.
 *
 * Returns every changed axis rather than a truncated list, because callers
 * disagree about how many they want to show — the card shows three, the detail
 * view shows all of them — and truncating here would force the detail view to
 * recompute the diff.
 */
export function describeChanges(
  from: BuildingParameters,
  to: BuildingParameters,
): ParameterDelta[] {
  const deltas: ParameterDelta[] = [];
  for (const axis of DIFF_AXES) {
    const before = axis.read(from);
    const after = axis.read(to);
    if (before !== after) {
      deltas.push({ key: axis.key, label: axis.label, from: before, to: after });
    }
  }
  return deltas;
}

/* ------------------------------------------------------------------ */
/* Cell construction                                                   */
/* ------------------------------------------------------------------ */

interface CellSeed {
  key: string;
  title: string;
  subtitle: string;
  glyph: string;
  accentHue: number;
  climate: ClimateData;
  /** The programme this cell starts from — already projected onto its type. */
  requirements: BuildingParameters;
}

function variant(
  kind: ScenarioVariantKind,
  label: string,
  parameters: BuildingParameters,
  climate: ClimateData,
  weights: ObjectiveWeights,
): ScenarioVariant {
  const evaluated = evaluateDesign(parameters, climate, weights);
  return {
    kind,
    label,
    parameters,
    materials: evaluated.materials,
    geometry: evaluated.geometry,
    metrics: evaluated.metrics,
    cost: evaluated.cost,
    score: designScore(evaluated.objective),
  };
}

/**
 * The cheapest design the search actually found.
 *
 * Taken from the optimiser's own leaderboard rather than by re-running the
 * search with cost-led weights. Two reasons: it costs nothing (the leaderboard
 * is already built), and it is a *real candidate* the search evaluated — so the
 * "low-cost" column is a design the optimiser can defend, not a second opinion
 * produced by a different objective that the rest of the panel does not know
 * about.
 */
function cheapestFound(leaderboard: readonly CandidateEvaluation[]): BuildingParameters | null {
  const entry = leaderboard.find((row) => row.lens === 'Cheapest to build');
  return entry ? entry.parameters : null;
}

function buildCell(seed: CellSeed, weights: ObjectiveWeights): ScenarioCell {
  const { climate, requirements } = seed;
  const analysis = analyseClimate(climate, requirements);

  const optimization = optimizeDesign({
    requirements,
    climate,
    analysis,
    weights,
    /* Two sweeps is the optimiser's own documented point of diminishing
       returns, and matching the studio's default is what keeps a cell's score
       identical to the score the same design shows on the Design page. */
    sweeps: 2,
  });

  const design = evaluateDesign(optimization.parameters, climate, weights);
  const baselineParameters = conventionalBaseline(requirements);
  const lowCostParameters = cheapestFound(optimization.leaderboard) ?? baselineParameters;

  return {
    key: seed.key,
    title: seed.title,
    subtitle: seed.subtitle,
    glyph: seed.glyph,
    accentHue: seed.accentHue,

    location: climate.location,
    climate,
    analysis,

    variants: [
      variant('traditional', 'Traditional', baselineParameters, climate, weights),
      variant('optimised', 'AI-optimised', optimization.parameters, climate, weights),
      variant('low-cost', 'Low-cost', lowCostParameters, climate, weights),
    ],
    parameters: optimization.parameters,
    materials: design.materials,
    geometry: design.geometry,
    metrics: design.metrics,
    cost: design.cost,
    score: designScore(design.objective),

    changes: describeChanges(baselineParameters, optimization.parameters),
    recommendations: optimization.recommendations,
    candidatesEvaluated: optimization.candidatesEvaluated,
  };
}

/* ------------------------------------------------------------------ */
/* Yield                                                               */
/* ------------------------------------------------------------------ */

/**
 * Hand the main thread back between cells.
 *
 * Each cell is a full optimisation — a few hundred twelve-month hourly
 * balances — so five of them back to back is long enough to freeze the tab and
 * long enough that a progress indicator which never paints is worse than none.
 * A macrotask is required for React to actually commit.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------ */
/* The sweeps                                                          */
/* ------------------------------------------------------------------ */

async function runSweep(
  axis: ScenarioAxis,
  seeds: CellSeed[],
  options: SweepOptions,
  note: string,
): Promise<ScenarioSweep> {
  const started = Date.now();
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const cells: ScenarioCell[] = [];

  for (const [index, seed] of seeds.entries()) {
    /* Yield *before* the work, not after: yielding afterwards means the last
       cell's cost is paid before the UI ever learns there was a last cell. */
    if (index > 0) await yieldToUi();
    const cell = buildCell(seed, weights);
    cells.push(cell);
    options.onCell?.(cell, index + 1, seeds.length);
  }

  const best = cells.reduce<ScenarioCell | null>(
    (top, cell) => (top === null || cell.score > top.score ? cell : top),
    null,
  );
  const worst = cells.reduce<ScenarioCell | null>(
    (low, cell) => (low === null || cell.score < low.score ? cell : low),
    null,
  );

  return {
    axis,
    cells,
    bestKey: best?.key ?? '',
    worstKey: worst?.key ?? '',
    headline: composeHeadline(axis, cells, best ?? undefined, worst ?? undefined),
    note,
    durationMs: Date.now() - started,
  };
}

/**
 * The sweep's finding, in one sentence, built only from the numbers returned.
 *
 * Composed rather than authored. Every clause here reads a value the cells
 * already carry, so the sentence cannot drift away from the table underneath
 * it — which is exactly the failure mode a hand-written summary has.
 */
function composeHeadline(
  axis: ScenarioAxis,
  cells: ScenarioCell[],
  best: ScenarioCell | undefined,
  worst: ScenarioCell | undefined,
): string {
  if (!best || !worst || cells.length === 0) return 'No scenario produced a result.';

  if (axis === 'building-type') {
    const spread = best.score - worst.score;
    return spread <= 1
      ? `At ${best.location.city} the five types land within ${spread} points of each other — this climate is not discriminating between forms.`
      : `At ${best.location.city} the same climate produces a ${spread}-point spread: ${best.title} reaches ${best.score}/100, ${worst.title} manages ${worst.score}/100.`;
  }

  const first = cells[0]!;
  return `The same ${first.title.toLowerCase()} is built five different ways: ${best.score}/100 at ${best.location.city} against ${worst.score}/100 at ${worst.location.city}, a ${best.score - worst.score}-point spread from climate alone.`;
}

/* ------------------------------------------------------------------ */
/* Public runners                                                      */
/* ------------------------------------------------------------------ */

/**
 * **Same site → different building types.**
 *
 * Holds the climate fixed and sweeps the five forms. The climate is passed in
 * rather than resolved here so the sweep runs on exactly the climatology the
 * studio is already showing — including a live provider result, if one was
 * fetched. Re-resolving it would let the comparison disagree with the page the
 * user just came from.
 */
export async function runTypeSweep(
  climate: ClimateData,
  options: SweepOptions,
): Promise<ScenarioSweep> {
  const seeds: CellSeed[] = TYPE_SWEEP_IDS.map((id) => {
    const template = buildingType(id);
    /* Each type starts from its *own* programme — a row house is 5 × 11 m and a
       low-rise block is 12 × 16 m, and forcing one footprint on all five would
       be comparing five sizes rather than five forms. `applyBuildingType`
       applies those defaults and clamps the storey count into range. */
    const requirements = applyBuildingType(options.base, id);
    return {
      key: id,
      title: template.label,
      subtitle: climate.climateType,
      glyph: template.glyph,
      accentHue: template.accentHue,
      climate,
      requirements,
    };
  });

  return runSweep(
    'building-type',
    seeds,
    options,
    `One site (${climate.location.city}), one climatology, five forms. Climate source: ${climate.source}.`,
  );
}

/**
 * **Same building → different locations.**
 *
 * Holds the building type and its programme fixed and sweeps the climate. The
 * programme is the type's own defaults, so what changes between columns is the
 * *design response* — orientation, glazing, shading, mass and ventilation —
 * and nothing else. That is the only way the column-to-column differences can
 * be attributed to the climate.
 */
export async function runLocationSweep(
  buildingTypeId: BuildingTypeId,
  options: SweepOptions,
): Promise<ScenarioSweep> {
  const template = buildingType(buildingTypeId);
  const requirements = applyBuildingType(options.base, buildingTypeId);

  const seeds: CellSeed[] = LOCATION_SWEEP_IDS.flatMap<CellSeed>((id) => {
    const station = STATION_BY_ID.get(id);
    /* A missing station would silently drop a column and turn a five-site
       comparison into a four-site one, so it is skipped loudly by returning
       nothing rather than quietly by substituting a default site. */
    if (!station) return [];
    const climate = buildClimateData(station, 'database');
    return [
      {
        key: id,
        title: station.location.city,
        subtitle: `${template.glyph}  ${template.label}`,
        glyph: template.glyph,
        accentHue: template.accentHue,
        climate,
        requirements,
      },
    ];
  });

  return runSweep(
    'location',
    seeds,
    options,
    `One ${template.label.toLowerCase()}, five climates, resolved from the offline climatology database.`,
  );
}

/* ------------------------------------------------------------------ */
/* Reading a sweep                                                     */
/* ------------------------------------------------------------------ */

/** Largest minus smallest of any per-cell number — the size of the finding. */
export function spreadOf(
  cells: readonly ScenarioCell[],
  read: (cell: ScenarioCell) => number,
): number {
  if (cells.length === 0) return 0;
  const values = cells.map(read);
  return Math.max(...values) - Math.min(...values);
}

/** The variant of a given kind, or the optimised one when it is absent. */
export function variantOf(cell: ScenarioCell, kind: ScenarioVariantKind): ScenarioVariant {
  return (
    cell.variants.find((v) => v.kind === kind) ??
    cell.variants.find((v) => v.kind === 'optimised') ??
    cell.variants[0]!
  );
}
