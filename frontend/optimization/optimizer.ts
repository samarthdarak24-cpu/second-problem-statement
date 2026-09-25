/**
 * The optimiser.
 *
 * METHOD
 * Coordinate descent over the curated design neighbourhood in
 * `designSpace.ts`. The search starts from the climate engine's recommendation,
 * then sweeps the design axes in order of how much they usually move the
 * objective — orientation, shading, glazing ratio, insulation, glazing spec,
 * roof form, wall material, roof material, ventilation, PV. Each sweep keeps the
 * best value found on each axis and moves on; a second sweep re-tests the earlier
 * axes against the improved later ones, which is what stops coordinate descent
 * from settling into the first local minimum it meets.
 *
 * WHY NOT EXHAUSTIVE
 * The full cross product of the neighbourhood is ~10⁴–10⁵ simulations. Each one
 * is a full 12-month hourly balance, so that is minutes of compute to find an
 * optimum within a fraction of a percent of what coordinate descent finds in a
 * hundred evaluations. The UI has to feel interactive, so the search is
 * structure-aware instead of brute-force. An exhaustive mode exists
 * (`exhaustive: true`) for the offline benchmark and for the surrogate's
 * training-set generation.
 *
 * WHY NOT XGBOOST YET
 * A surrogate is only worth training once there is a validated simulation to
 * label data with. The interface for one is already in `ml/surrogate.ts`, and
 * this optimiser will use it the moment a model exists — but shipping a
 * rule-based engine that is honest about being rule-based beats shipping an
 * undertrained model that is not.
 */

import type {
  BuildingParameters,
  CandidateEvaluation,
  ClimateAnalysis,
  ClimateData,
  CostEstimate,
  ObjectiveWeights,
  OptimizationResult,
  Recommendation,
  ThermalComfort,
} from '@/types';
import { INSULATION_LEVEL_THICKNESS, ROOF_PITCH } from '@/thermal/constants';
import { designSpaceSize, buildDesignSpace, analysisDrivenParameters, conventionalBaseline, describeDesign, SEARCH_AXES, type DesignSpace, type SearchAxis } from './designSpace';
import { glazingBiasOption, type GlazingBiasId } from '@/lib/glazingBias';
import { assemblyById } from '@/thermal/assemblies';
import { fitToTemplate } from '@/lib/buildingTypes';
import {
  DEFAULT_WEIGHTS,
  designScore,
  evaluateParameters,
  toCandidateEvaluation,
  type EvaluatedCandidate,
} from './objective';
import { buildRecommendations } from './recommendations';

export interface OptimizeRequest {
  /** The user's fixed programme: dimensions, occupancy, budget, setpoints. */
  requirements: BuildingParameters;
  climate: ClimateData;
  analysis: ClimateAnalysis;
  weights?: ObjectiveWeights;
  /** Search every option on every axis instead of a shortlist. Slow. */
  exhaustive?: boolean;
  /** Number of coordinate-descent sweeps. Two is the default and the point of diminishing returns. */
  sweeps?: number;
  leaderboardSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export function optimizeDesign(request: OptimizeRequest): OptimizationResult {
  const started = performance.now();
  const {
    requirements,
    climate,
    analysis,
    weights = DEFAULT_WEIGHTS,
    exhaustive = false,
    sweeps = 2,
    leaderboardSize = 8,
    onProgress,
  } = request;

  const seed = analysisDrivenParameters(requirements, climate, analysis);
  const space = buildDesignSpace(seed, analysis, exhaustive);
  const totalEstimate = designSpaceSize(space);
  const maxEvaluations = 4000;

  const cache = new Map<string, EvaluatedCandidate>();
  const probeCache = new Map<string, EvaluatedCandidate>();
  const all: EvaluatedCandidate[] = [];
  let evaluations = 0;

  const evaluate = (parameters: BuildingParameters, label: string): EvaluatedCandidate => {
    const key = signature(parameters);
    const cached = cache.get(key);
    if (cached) return cached;

    evaluations += 1;
    const result = evaluateParameters(
      `cand-${evaluations}`,
      label,
      parameters,
      climate,
      weights,
    );
    cache.set(key, result);
    all.push(result);
    onProgress?.(evaluations, totalEstimate);
    return result;
  };

  /**
   * Evaluate a design *without* recording it.
   *
   * Used by the recommendation panel to measure the marginal effect of each
   * decision. Those counterfactual designs are diagnostic, not candidates, and
   * letting them into the leaderboard would fill it with deliberately degraded
   * buildings.
   */
  const probe = (parameters: BuildingParameters): EvaluatedCandidate => {
    const key = signature(parameters);
    const cached = cache.get(key) ?? probeCache.get(key);
    if (cached) return cached;
    const result = evaluateParameters('probe', 'Counterfactual', parameters, climate, weights);
    probeCache.set(key, result);
    return result;
  };

  /* --- Baseline and seed ------------------------------------------- */
  const baselineParameters = conventionalBaseline(requirements);
  const baseline = evaluate(baselineParameters, 'Conventional local construction');
  let current = evaluate(seed, 'Climate-analysis recommendation');

  /* --- Coordinate descent ------------------------------------------ */
  const axisOrder: SearchAxis[] = [...SEARCH_AXES];
  const maxSweeps = Math.max(1, Math.min(sweeps, 6));

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let improvedThisSweep = false;

    for (const axis of axisOrder) {
      const options = optionsForAxis(space, axis);
      let bestOnAxis = current;

      for (const option of options) {
        if (evaluations >= maxEvaluations) break;
        const candidate = applyAxis(current.parameters, axis, option, space);
        if (signature(candidate) === signature(current.parameters)) continue;
        const evaluated = evaluate(candidate, labelFor(axis, option));
        if (evaluated.objective < bestOnAxis.objective - 1e-9) {
          bestOnAxis = evaluated;
        }
      }

      if (bestOnAxis !== current) {
        current = bestOnAxis;
        improvedThisSweep = true;
      }
    }

    /* Converged — another sweep would only re-test the same neighbourhood. */
    if (!improvedThisSweep) break;
  }

  const best = current;

  /* --- Leaderboard -------------------------------------------------- */
  const leaderboard = buildLeaderboard(all, leaderboardSize);

  /* --- Recommendations ---------------------------------------------- */
  const recommendations: Recommendation[] = buildRecommendations({
    analysis,
    climate,
    baseline,
    optimized: best,
    probe,
  });

  const energySavings = baseline.metrics.annualEnergy - best.metrics.annualEnergy;
  const energySavingsPct =
    baseline.metrics.annualEnergy > 0 ? (energySavings / baseline.metrics.annualEnergy) * 100 : 0;

  return {
    parameters: best.parameters,
    thermal: best.thermal,
    cost: best.cost,
    recommendations,
    score: designScore(best.objective),
    energySavings,
    energySavingsPct,
    costDelta: best.cost.totalCost - baseline.cost.totalCost,
    comfortGain: best.metrics.adaptiveComfortHoursPct - baseline.metrics.adaptiveComfortHoursPct,
    candidatesEvaluated: evaluations,
    method: 'coordinate-descent',
    leaderboard,
    engine: 'physics-optimiser',
    provenance: best.thermal.provenance,
    durationMs: Math.round(performance.now() - started),
  };
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build the shortlist shown in the UI.
 *
 * A plain "top N by objective" list is useless here: the search generates many
 * candidates that differ only in a parameter the climate does not care about, so
 * the top eight rows end up being the same building eight times. Instead the
 * shortlist leads with one champion per design lens — overall, energy, passive
 * comfort, capital cost — and then fills the remaining places with candidates
 * that differ from everything already chosen on at least two tunable axes.
 *
 * The result answers the question a user actually has: *what are my real
 * options*, not *what are the eight near-identical variants of one option*.
 */
function buildLeaderboard(
  pool: EvaluatedCandidate[],
  size: number,
): CandidateEvaluation[] {
  if (pool.length === 0) return [];

  const taken = new Set<string>();
  const picks: Array<{ candidate: EvaluatedCandidate; lens?: string }> = [];

  const take = (candidate: EvaluatedCandidate | undefined, lens?: string) => {
    if (!candidate || taken.has(candidate.id)) return;
    taken.add(candidate.id);
    picks.push({ candidate, lens });
  };

  const champion = (
    compare: (a: EvaluatedCandidate, b: EvaluatedCandidate) => number,
  ): EvaluatedCandidate => pool.reduce((a, b) => (compare(b, a) < 0 ? b : a));

  /* --- One champion per lens --------------------------------------- */
  take(champion((a, b) => a.objective - b.objective), 'Best overall');
  take(
    champion((a, b) => a.metrics.energyUseIntensity - b.metrics.energyUseIntensity),
    'Lowest energy',
  );
  take(
    champion((a, b) => b.metrics.adaptiveComfortHoursPct - a.metrics.adaptiveComfortHoursPct),
    'Most passive comfort',
  );
  take(champion((a, b) => a.cost.totalCost - b.cost.totalCost), 'Cheapest to build');
  take(
    champion((a, b) => a.metrics.annualHeatingEnergy - b.metrics.annualHeatingEnergy),
    'Lowest heating demand',
  );
  take(
    champion((a, b) => a.metrics.annualCoolingEnergy - b.metrics.annualCoolingEnergy),
    'Lowest cooling demand',
  );

  /* --- Then diverse runners-up ------------------------------------- */
  const sorted = [...pool].sort((a, b) => a.objective - b.objective);

  for (const minimumDifference of [3, 2, 1]) {
    if (picks.length >= size) break;
    for (const candidate of sorted) {
      if (picks.length >= size) break;
      if (taken.has(candidate.id)) continue;
      const distinct = picks.every(
        (pick) => differingAxes(pick.candidate.parameters, candidate.parameters) >= minimumDifference,
      );
      if (distinct) take(candidate);
    }
  }

  return picks.slice(0, size).map(({ candidate, lens }) => ({
    ...toCandidateEvaluation(candidate),
    label: describeDesign(candidate.parameters),
    lens,
  }));
}

/** How many tunable axes differ between two designs. */
function differingAxes(a: BuildingParameters, b: BuildingParameters): number {
  let count = 0;
  if (a.orientation !== b.orientation) count += 1;
  if (Math.abs(a.windowToWallRatio - b.windowToWallRatio) > 1e-6) count += 1;
  if (a.wallMaterialId !== b.wallMaterialId) count += 1;
  if (a.roofMaterialId !== b.roofMaterialId) count += 1;
  if (a.windowMaterialId !== b.windowMaterialId) count += 1;
  if (a.insulationLevel !== b.insulationLevel) count += 1;
  if (a.roofType !== b.roofType) count += 1;
  if (a.shadingType !== b.shadingType) count += 1;
  if (Math.abs(a.shadingDepth - b.shadingDepth) > 1e-6) count += 1;
  if (a.ventilationType !== b.ventilationType) count += 1;
  if (a.solarPvKwp !== b.solarPvKwp) count += 1;
  return count;
}

/* ------------------------------------------------------------------ */
/* Applying one axis option                                            */
/* ------------------------------------------------------------------ */

type AxisOption = number | string | { type: string; depth?: number; ach?: number };

function optionsForAxis(space: DesignSpace, axis: SearchAxis): AxisOption[] {
  switch (axis) {
    case 'orientation':
      return space.orientations;
    case 'glazingBias':
      return space.glazingBiases;
    case 'windowRatio':
      return space.windowRatios;
    case 'insulation':
      return space.insulationLevels;
    case 'shading':
      return space.shading;
    case 'glazing':
      return space.glazingIds;
    case 'roof':
      return space.roofTypes;
    case 'wallMaterial':
      return space.wallMaterialIds;
    case 'roofMaterial':
      return space.roofMaterialIds;
    case 'wallAssembly':
      return space.wallAssemblyIds;
    case 'roofAssembly':
      return space.roofAssemblyIds;
    case 'ventilation':
      return space.ventilation;
    case 'pv':
      return space.pvOptions;
    default:
      return [];
  }
}

function applyAxis(
  base: BuildingParameters,
  axis: SearchAxis,
  option: AxisOption,
  space: DesignSpace,
): BuildingParameters {
  const next: BuildingParameters = { ...base };

  switch (axis) {
    case 'orientation':
      next.orientation = Number(option);
      break;

    case 'glazingBias': {
      /* Setting the strategy is enough: `resolveFacadeWeights` derives the
         per-facade multipliers from it, and `facadeWeights` is kept in step so
         a design read back without the bias still describes the same building. */
      const bias = String(option) as GlazingBiasId;
      next.glazingBias = bias;
      next.facadeWeights = glazingBiasOption(bias).weights;
      break;
    }

    case 'windowRatio':
      next.windowToWallRatio = Number(option);
      break;

    case 'insulation': {
      const level = option as BuildingParameters['insulationLevel'];
      next.insulationLevel = level;
      next.insulationThickness = INSULATION_LEVEL_THICKNESS[level];
      break;
    }

    case 'shading': {
      const shading = option as { type: BuildingParameters['shadingType']; depth: number };
      next.shadingType = shading.type;
      next.shadingDepth = shading.type === 'none' ? 0 : shading.depth;
      /* The roof overhang is the shading device on the top of the facade; keep
         them consistent so the 3D model and the thermal model agree. */
      next.roofOverhang = Math.max(0.2, next.shadingDepth);
      break;
    }

    case 'glazing':
      next.windowMaterialId = String(option);
      break;

    case 'roof': {
      const roofType = option as BuildingParameters['roofType'];
      next.roofType = roofType;
      next.roofAngle = ROOF_PITCH[roofType];
      break;
    }

    case 'wallMaterial':
      /* Choosing a single material means the design is not a composite, so the
         assembly is cleared. Without this the two axes fight: the material
         would change while `resolveMaterials` kept reading the assembly, and
         the search would evaluate candidates that differ only in a field with
         no effect on the physics. */
      next.wallMaterialId = String(option);
      next.wallAssemblyId = undefined;
      break;

    case 'roofMaterial':
      next.roofMaterialId = String(option);
      next.roofAssemblyId = undefined;
      break;

    case 'wallAssembly':
      next.wallAssemblyId = String(option) || undefined;
      break;

    case 'roofAssembly':
      next.roofAssemblyId = String(option) || undefined;
      break;

    case 'ventilation': {
      const ventilation = option as { type: BuildingParameters['ventilationType']; ach: number };
      next.ventilationType = ventilation.type;
      next.airChangesPerHour = ventilation.ach;
      break;
    }

    case 'pv':
      next.solarPvKwp = Number(option);
      break;

    default:
      break;
  }

  /* Final backstop: the search space is already filtered to the building type's
     palette, but fitting here guarantees a type's identity survives even if a
     future axis is added without a palette check — a vernacular can never be
     silently turned into an AAC box. */
  void space;
  void signature;
  return fitToTemplate(next);
}

function labelFor(axis: SearchAxis, option: AxisOption): string {
  if (typeof option === 'object' && option !== null && 'type' in option) {
    const typed = option as { type: string; depth?: number; ach?: number };
    if (axis === 'shading') return `${typed.type} @ ${typed.depth} m`;
    if (axis === 'ventilation') return `${typed.type} · ${typed.ach} ACH`;
    return typed.type;
  }
  if (axis === 'windowRatio') return `WWR ${Math.round(Number(option) * 100)} %`;
  if (axis === 'orientation') return `Orientation ${Number(option)}°`;
  if (axis === 'glazingBias') return glazingBiasOption(String(option) as GlazingBiasId).label;
  if (axis === 'wallAssembly' || axis === 'roofAssembly') {
    return assemblyById(String(option))?.name ?? 'single material';
  }
  if (axis === 'pv') return `PV ${option} kWp`;
  return String(option);
}

/**
 * Identity of the *tunable* part of a design.
 *
 * Two candidates that differ only in fixed programme fields are the same design
 * as far as the search is concerned, so the cache key must ignore those — this
 * is what stops the same simulation being run twice.
 */
function signature(parameters: BuildingParameters): string {
  return [
    parameters.orientation,
    parameters.windowToWallRatio,
    parameters.wallMaterialId,
    parameters.roofMaterialId,
    parameters.windowMaterialId,
    parameters.insulationLevel,
    parameters.insulationThickness,
    parameters.roofType,
    parameters.roofAngle,
    parameters.roofOverhang,
    parameters.shadingType,
    parameters.shadingDepth,
    parameters.ventilationType,
    parameters.airChangesPerHour,
    parameters.solarPvKwp,
  ].join('|');
}

/* ------------------------------------------------------------------ */
/* Re-exported for callers that only want one half of the pipeline     */
/* ------------------------------------------------------------------ */

export { analysisDrivenParameters, conventionalBaseline } from './designSpace';
export { estimateCost } from './costModel';
export { evaluateParameters, designScore, DEFAULT_WEIGHTS, weightsFromPriority } from './objective';
export { compareDesigns } from './comparison';

export type { EvaluatedCandidate };

/** Convenience: everything the comparison panel needs for one design. */
export interface DesignSnapshot {
  parameters: BuildingParameters;
  thermal: ThermalComfort;
  cost: CostEstimate;
}
