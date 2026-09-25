/**
 * Design space — turning a climate analysis into a set of concrete candidates.
 *
 * Two things live here:
 *
 *   1. `analysisDrivenParameters` — the climate engine's recommendation expressed
 *      as a complete, buildable `BuildingParameters`. This is the seed the
 *      optimiser starts from, and it is also what "Auto mode" shows before any
 *      search runs.
 *
 *   2. `buildDesignSpace` — the neighbourhood the optimiser is allowed to
 *      explore around that seed. It is deliberately narrow. A full cross product
 *      of every envelope option is thousands of thermal simulations, which is
 *      both too slow for an interactive UI and pointless: most of those
 *      combinations are dominated by others. Searching a curated neighbourhood
 *      of the options that actually matter finds the same optimum in a fraction
 *      of the evaluations, and every axis can be explained to the user.
 */

import type {
  BuildingParameters,
  ClimateAnalysis,
  ClimateData,
  InsulationLevel,
  RoofStrategy,
  ShadingStrategy,
  VentilationStrategy,
} from '@/types';
import { GLAZING_ID, roofForInsulationLevel, wallForInsulationLevel } from '@/thermal/materials';
import { ROOF_PITCH, VENTILATION_ACH } from '@/thermal/constants';
import { fitToTemplate, paletteFor } from '@/lib/buildingTypes';
import {
  DEFAULT_GLAZING_BIAS,
  GLAZING_BIASES,
  glazingBiasOption,
  type GlazingBiasId,
} from '@/lib/glazingBias';
import { assemblyById, COMPOSITE_ASSEMBLIES } from '@/thermal/assemblies';
import { clamp } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* The climate engine's recommendation, as buildable parameters        */
/* ------------------------------------------------------------------ */

/**
 * The climate engine's recommendation, expressed as buildable parameters.
 *
 * Every field here is a function of the *climate alone* — which wall material a
 * given insulation level implies, which roof form a given roof strategy implies,
 * which shading device the sun angles call for. That is the right answer to the
 * wrong question on its own, because it would hand a vernacular shelter and a
 * low-rise block in the same city the same envelope. `fitToTemplate` is
 * therefore the last step: it projects the recommendation back onto the palette
 * the selected building type is actually buildable from, so the climate chooses
 * *within* the type rather than replacing it.
 */
export function analysisDrivenParameters(
  requirements: BuildingParameters,
  climate: ClimateData,
  analysis: ClimateAnalysis,
): BuildingParameters {
  const shadingDepth = analysis.shadingDepth;
  return fitToTemplate({
    ...requirements,
    orientation: analysis.orientationRecommendation,
    windowToWallRatio: analysis.windowRatioRecommendation,
    shadingType: analysis.shadingStrategy,
    shadingDepth,
    insulationLevel: analysis.insulationLevel,
    insulationThickness: analysis.insulationThickness,
    ventilationType: analysis.ventilationStrategy,
    airChangesPerHour: analysis.ventilationAch,
    roofType: analysis.roofStrategy,
    roofAngle: ROOF_PITCH[analysis.roofStrategy],
    // A shading projection is physically the same thing as a roof overhang on
    // the shaded facades, so the two are kept consistent rather than fighting.
    roofOverhang: Math.max(requirements.roofOverhang, shadingDepth),
    windowMaterialId: GLAZING_ID[analysis.glazingStrategy] ?? 'double-lowe',
    wallMaterialId: wallForInsulationLevel(analysis.insulationLevel),
    roofMaterialId: roofForInsulationLevel(
      analysis.insulationLevel,
      climate.summary.solarRadiation,
    ),
  });
}

/**
 * A sensible "conventional local construction" baseline.
 *
 * This is what the Before/After panel compares against, so it must be a design
 * somebody would actually build without any climate thinking — brick walls, an
 * RCC roof, single glazing, no added insulation, no shading. It is deliberately
 * *not* a straw man: a leaky tin shed would flatter the optimiser.
 */
export function conventionalBaseline(requirements: BuildingParameters): BuildingParameters {
  return fitToTemplate({
    ...requirements,
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
    solarPvKwp: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Search neighbourhood                                                */
/* ------------------------------------------------------------------ */

export interface ShadingOption {
  type: ShadingStrategy;
  depth: number;
}

export interface VentilationOption {
  type: VentilationStrategy;
  ach: number;
}

export interface DesignSpace {
  orientations: number[];
  windowRatios: number[];
  insulationLevels: InsulationLevel[];
  shading: ShadingOption[];
  glazingIds: string[];
  /** Facade-glazing distributions the search may choose between. */
  glazingBiases: GlazingBiasId[];
  roofTypes: RoofStrategy[];
  wallMaterialIds: string[];
  roofMaterialIds: string[];
  /**
   * Composite wall build-ups the search may choose, with `''` meaning
   * "single material".
   *
   * The two wall axes are mutually exclusive: an assembly *replaces* the
   * single material, so leaving both live would let the search move the
   * material on a design that is not built from one — burning evaluations on a
   * field with no effect and printing a leaderboard that names a wall nobody is
   * building. Choosing a material therefore clears the assembly and vice versa.
   */
  wallAssemblyIds: string[];
  roofAssemblyIds: string[];
  ventilation: VentilationOption[];
  pvOptions: number[];
  /** Overhang depths tried alongside the shading strategy, metres. */
  shadingDepths: number[];
}

/** Options ranked by how much they usually move the objective. */
export const SEARCH_AXES = [
  'orientation',
  'glazingBias',
  'shading',
  'windowRatio',
  'insulation',
  'glazing',
  'roof',
  'wallAssembly',
  'wallMaterial',
  'roofAssembly',
  'roofMaterial',
  'ventilation',
  'pv',
] as const;

export type SearchAxis = (typeof SEARCH_AXES)[number];

const WALL_IDS = ['brick', 'flyash-brick', 'aac', 'hollow-block', 'rammed-earth', 'stone', 'insulated-aac'];
const ROOF_IDS = ['rcc-slab', 'reflective-roof', 'insulated-roof', 'puf-panel', 'mud-phuska'];

/**
 * Build the neighbourhood to search.
 *
 * @param seed the analysis-driven design
 * @param analysis the climate engine's output (used to weight the options)
 * @param exhaustive when true, tries every option on every axis instead of a
 *        shortlist around the recommendation. Slower, but useful for a
 *        "deep search" toggle and for the offline benchmark script.
 */
export function buildDesignSpace(
  seed: BuildingParameters,
  analysis: ClimateAnalysis,
  exhaustive = false,
): DesignSpace {
  const windowRatio = clamp(seed.windowToWallRatio, 0.12, 0.5);

  /* The palette keeps the building type itself intact: a rammed-earth vernacular
     stays rammed-earth, a prefabricated shelter stays prefabricated. The search
     is therefore confined to what the type may legitimately be built from, and
     `fitToTemplate` is the backstop that catches anything that slips through. */
  const palette = paletteFor(seed.buildingType);

  /* Orientation: the climate engine already searched this in 15° steps with the
     solar engine, so the optimiser only needs to confirm the local neighbourhood
     — a finer sweep would be re-deriving the same answer. */
  const orientations = uniqueNumbers([
    seed.orientation,
    normalize(seed.orientation - 15),
    normalize(seed.orientation + 15),
  ]);

  /* Shading: the recommended strategy plus the alternatives that plausibly beat
     it. Depth is searched alongside, because a deeper overhang is often a better
     buy than a more expensive device. Confined to the type's palette. */
  const shadingOptions: ShadingOption[] = [];
  const strategies: ShadingStrategy[] = exhaustive
    ? ['none', 'overhang', 'louvre', 'external-blind', 'deep-verandah', 'combined']
    : uniqueShading([analysis.shadingStrategy, 'overhang', 'combined', 'deep-verandah']);
  const allowedStrategies = strategies.filter((s) => palette.shading.includes(s));
  const depths = exhaustive ? [0, 0.3, 0.45, 0.6, 0.8, 1.0, 1.2] : [0, 0.45, seed.shadingDepth, 0.8];
  for (const type of allowedStrategies) {
    if (type === 'none') {
      shadingOptions.push({ type: 'none', depth: 0 });
      continue;
    }
    for (const depth of depths) {
      if (depth <= 0) continue;
      shadingOptions.push({ type, depth });
    }
  }

  /* Window ratio: ±2 steps of 4 percentage points around the recommendation. The
     wider band lets the search reach the type's daylight target rather than
     stopping at the band's lower edge — without it, every hot-climate type
     collapses onto the same 14 % because the cooling term alone always rewards
     less glass. */
  const windowRatios = exhaustive
    ? [0.1, 0.14, 0.18, 0.22, 0.26, 0.3, 0.34, 0.38, 0.42, 0.46, 0.5]
    : uniqueNumbers([
        round3(windowRatio - 0.08),
        round3(windowRatio - 0.04),
        round3(windowRatio),
        round3(windowRatio + 0.04),
        round3(windowRatio + 0.08),
      ]).filter((r) => r >= 0.1 && r <= 0.5);

  const insulationLevels = (
    exhaustive
      ? (['none', 'low', 'medium', 'high', 'very-high'] as InsulationLevel[])
      : neighbourhoodInsulation(analysis.insulationLevel)
  );

  const glazingIds = exhaustive
    ? ['single', 'double', 'double-lowe', 'triple']
    : uniqueStrings([seed.windowMaterialId, nextGlazingUp(seed.windowMaterialId), nextGlazingDown(seed.windowMaterialId)])
        .filter((id) => palette.windowMaterials.includes(id));

  /*
   * Facade-glazing distribution.
   *
   * All six strategies are always offered, because which one is right is
   * genuinely a function of the climate rather than of the building type: a
   * vernacular shelter in Leh wants the glass on the south wall, and the same
   * shelter in Chennai does not. Restricting the list by type would re-introduce
   * the climate-blindness the palette exists to prevent.
   *
   * The seed's own strategy is included explicitly so a run that finds nothing
   * better leaves the design exactly as it was.
   */
  const glazingBiases: GlazingBiasId[] = uniqueGlazingBiases([
    seed.glazingBias ?? DEFAULT_GLAZING_BIAS,
    ...GLAZING_BIASES.map((option) => option.id),
  ]);

  const roofTypes = (
    exhaustive
      ? (['flat', 'shed', 'gable', 'hip', 'vaulted'] as RoofStrategy[])
      : uniqueRoofs([seed.roofType, 'flat', seed.roofType === 'shed' ? 'gable' : 'shed'])
  ).filter((r) => palette.roofForms.includes(r));

  const wallMaterialIds = exhaustive
    ? WALL_IDS
    : uniqueStrings([seed.wallMaterialId, 'brick', 'aac', 'rammed-earth', 'stone'])
        .filter((id) => palette.wallMaterials.includes(id));

  const roofMaterialIds = exhaustive
    ? ROOF_IDS
    : uniqueStrings([seed.roofMaterialId, 'rcc-slab', 'reflective-roof', 'insulated-roof'])
        .filter((id) => palette.roofMaterials.includes(id));

  /*
   * Composite build-ups, always offered alongside the single materials.
   *
   * `''` is the single-material option, so the search can also decide that a
   * composite is *not* worth it — which it will, on a mild site where the extra
   * layer costs more than it saves.
   */
  const wallAssemblyIds = uniqueStrings([
    seed.wallAssemblyId ?? '',
    '',
    ...COMPOSITE_ASSEMBLIES.filter((a) => a.category === 'wall').map((a) => a.id),
  ]);

  const roofAssemblyIds = uniqueStrings([
    seed.roofAssemblyId ?? '',
    '',
    ...COMPOSITE_ASSEMBLIES.filter((a) => a.category === 'roof').map((a) => a.id),
  ]);

  /* Ventilation: the strategy fixes the ACH, so they move together. */
  const ventilationTypes: VentilationStrategy[] = exhaustive
    ? ['sealed-mechanical', 'single-sided', 'night-purge', 'stack-ventilation', 'mixed-mode', 'cross-ventilation']
    : uniqueVentilation([analysis.ventilationStrategy, 'night-purge', 'mixed-mode', 'sealed-mechanical'])
        .filter((v) => palette.ventilation.includes(v));
  const ventilation: VentilationOption[] = ventilationTypes.map((type) => ({
    type,
    ach: VENTILATION_ACH[type],
  }));

  /* PV: offered as a discrete choice rather than a continuous variable — a
     half-panel is not a thing, and the cost model is step-wise anyway. */
  const pvOptions = exhaustive ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];

  return {
    orientations,
    windowRatios,
    insulationLevels,
    shading: shadingOptions,
    glazingIds,
    glazingBiases,
    roofTypes,
    wallMaterialIds,
    roofMaterialIds,
    wallAssemblyIds,
    roofAssemblyIds,
    ventilation,
    pvOptions,
    shadingDepths: depths,
  };
}

/** Size of the full cross product, for the "space explored" readout. */
export function designSpaceSize(space: DesignSpace): number {
  return (
    space.orientations.length *
    space.glazingBiases.length *
    space.windowRatios.length *
    space.insulationLevels.length *
    space.shading.length *
    space.glazingIds.length *
    space.roofTypes.length *
    space.wallMaterialIds.length *
    space.roofMaterialIds.length *
    space.wallAssemblyIds.length *
    space.roofAssemblyIds.length *
    space.ventilation.length *
    space.pvOptions.length
  );
}

/* ------------------------------------------------------------------ */
/* Describing a design                                                 */
/* ------------------------------------------------------------------ */

/**
 * One-line description of a complete design.
 *
 * The optimiser labels each candidate with the axis it just changed, which is
 * useful while the search is running but misleading in the leaderboard — by the
 * time the sweep finishes, "Orientation 90°" describes a design that has also
 * changed its shading, glazing and insulation. The leaderboard therefore
 * re-derives the label from the final parameters.
 */
export function describeDesign(parameters: BuildingParameters): string {
  const parts = [
    `WWR ${Math.round(parameters.windowToWallRatio * 100)} %`,
    glazingBiasOption(parameters.glazingBias ?? DEFAULT_GLAZING_BIAS).label.toLowerCase(),
    parameters.shadingType === 'none'
      ? 'no shading'
      : `${parameters.shadingType} ${parameters.shadingDepth.toFixed(2)} m`,
    parameters.insulationLevel === 'none'
      ? 'no insulation'
      : `${parameters.insulationLevel} insulation`,
    /* A composite assembly replaces the single material, so naming the material
       while an assembly is selected would describe a wall that is not built. */
    assemblyById(parameters.wallAssemblyId ?? '')?.name ??
      SHADING_MATERIAL_LABEL[parameters.wallMaterialId] ??
      parameters.wallMaterialId,
    assemblyById(parameters.roofAssemblyId ?? '')?.name ??
      ROOF_FORM_LABEL[parameters.roofType] ??
      parameters.roofType,
    `${parameters.windowMaterialId} glazing`,
    `${parameters.ventilationType} ${parameters.airChangesPerHour} ACH`,
  ];
  if (parameters.solarPvKwp > 0) parts.push(`PV ${parameters.solarPvKwp} kWp`);
  return parts.join(' · ');
}

const SHADING_MATERIAL_LABEL: Record<string, string> = {
  rcc: 'RCC walls',
  brick: 'brick walls',
  'flyash-brick': 'fly-ash brick walls',
  aac: 'AAC walls',
  'hollow-block': 'hollow block walls',
  'rammed-earth': 'rammed earth',
  stone: 'stone masonry',
  'insulated-aac': 'insulated AAC walls',
};

const ROOF_FORM_LABEL: Record<string, string> = {
  flat: 'flat roof',
  shed: 'shed roof',
  gable: 'gable roof',
  hip: 'hip roof',
  vaulted: 'vaulted roof',
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function neighbourhoodInsulation(level: InsulationLevel): InsulationLevel[] {
  const order: InsulationLevel[] = ['none', 'low', 'medium', 'high', 'very-high'];
  const index = Math.max(0, order.indexOf(level));
  return uniqueInsulation([order[index]!, order[Math.min(order.length - 1, index + 1)]!, order[Math.max(0, index - 1)]!]);
}

function nextGlazingUp(id: string): string {
  const order = ['single', 'double', 'double-lowe', 'triple'];
  const index = order.indexOf(id);
  return order[Math.min(order.length - 1, Math.max(0, index) + 1)]!;
}

function nextGlazingDown(id: string): string {
  const order = ['single', 'double', 'double-lowe', 'triple'];
  const index = order.indexOf(id);
  return order[Math.max(0, index - 1)]!;
}

function normalize(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 1000) / 1000))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueInsulation(values: InsulationLevel[]): InsulationLevel[] {
  return [...new Set(values)];
}

function uniqueRoofs(values: RoofStrategy[]): RoofStrategy[] {
  return [...new Set(values)];
}

function uniqueVentilation(values: VentilationStrategy[]): VentilationStrategy[] {
  return [...new Set(values)];
}

function uniqueShading(values: ShadingStrategy[]): ShadingStrategy[] {
  return [...new Set(values)];
}

function uniqueGlazingBiases(values: GlazingBiasId[]): GlazingBiasId[] {
  return [...new Set(values)];
}
