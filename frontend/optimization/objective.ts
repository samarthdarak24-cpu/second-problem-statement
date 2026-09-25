/**
 * The optimisation objective.
 *
 * One place evaluates a candidate design and turns it into a single number, so
 * the search, the leaderboard and the "why this design?" panel can never
 * disagree about how good a design is.
 *
 * The objective is a weighted sum of three normalised penalties — thermal
 * discomfort, annual energy, and construction cost — each on 0–1 where lower is
 * better. Normalising against *fixed reference ranges* rather than against the
 * candidate set is deliberate: with min/max normalisation, finding one excellent
 * candidate silently makes every other design look worse, which makes the
 * leaderboard meaningless and makes the weights impossible to reason about.
 */

import type {
  BuildingParameters,
  CandidateEvaluation,
  ClimateData,
  CostEstimate,
  ObjectiveWeights,
  ResolvedMaterials,
  ShelterGeometry,
  ThermalComfort,
} from '@/types';
import { deriveDesignMetrics, discomfortScore, energyScore, normalise, type DesignMetrics } from '@/thermal/metrics';
import { resolveMaterials } from '@/thermal/materials';
import { buildingType } from '@/lib/buildingTypes';
import { simulateDesign } from '@/thermal/thermalModel';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { estimateCost } from './costModel';

/* ------------------------------------------------------------------ */
/* Weights and reference ranges                                        */
/* ------------------------------------------------------------------ */

/**
 * Default weights.
 *
 * Comfort leads, because the brief is a *thermal comfort* shelter and a design
 * that is cheap and efficient but uncomfortable has failed at its one job.
 * Energy is close behind — it is the running cost the occupant actually feels.
 * Capital cost is the tie-breaker; it is the easiest of the three to trade away
 * and the easiest for a funder to relax.
 */
export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  discomfort: 0.45,
  energy: 0.35,
  cost: 0.2,
};

/**
 * Cost reference range for normalisation, ₹/m² of floor area.
 *
 * Anchored to real small-shelter construction: ~₹12,000/m² is a lean but
 * competent build, ~₹48,000/m² is a heavily serviced, highly insulated one.
 */
export const COST_REFERENCE = { best: 12000, worst: 48000 } as const;

/**
 * Weight applied to a budget overrun.
 *
 * A soft constraint, not a hard filter. Filtering would leave the user staring
 * at "no design found" when the honest answer is "the design you asked for costs
 * 12 % more than you budgeted" — which is information, not a failure.
 */
export const BUDGET_PENALTY_WEIGHT = 0.6;

/**
 * Weight applied to a glazing-adequacy shortfall.
 *
 * WHY THIS EXISTS
 * Without it the objective has no term that *wants* windows. Less glass always
 * lowers solar gain, so the optimiser strips the envelope to a 10 % dark box and
 * calls it a result — correct within the thermal model, disastrous as a building.
 * This is a deliberately simple, documented proxy for daylight and view (a
 * full-daylight-factor simulation is out of scope): it penalises a window ratio
 * that drifts far from the *type's* daylight target, so the cooling saving from
 * less glass is weighed against the habitability cost of not having any. It is
 * labelled as a proxy wherever the score is shown, and never presented as a
 * measured daylight calculation.
 */
export const GLAZING_PENALTY_WEIGHT = 0.45;

/* ------------------------------------------------------------------ */
/* A fully evaluated candidate                                         */
/* ------------------------------------------------------------------ */

export interface EvaluatedCandidate {
  id: string;
  label: string;
  parameters: BuildingParameters;
  materials: ResolvedMaterials;
  geometry: ShelterGeometry;
  thermal: ThermalComfort;
  metrics: DesignMetrics;
  cost: CostEstimate;
  /** Weighted penalty, lower is better. */
  objective: number;
  discomfort: number;
  energy: number;
  costPenalty: number;
  budgetPenalty: number;
  /** Shortfall against the type's daylight target (0 = on target). */
  glazingPenalty: number;
}

export function evaluateParameters(
  id: string,
  label: string,
  parameters: BuildingParameters,
  climate: ClimateData,
  weights: ObjectiveWeights,
): EvaluatedCandidate {
  const materials = resolveMaterials(parameters);
  const geometry = buildShelterGeometry(parameters, materials);
  const thermal = simulateDesign(parameters, climate, materials, geometry);
  const metrics = deriveDesignMetrics(thermal, climate);
  const cost = estimateCost({ parameters, materials, geometry, metrics });

  const discomfort = discomfortScore(metrics);
  const energy = energyScore(metrics);
  const costPenalty = normalise(cost.costPerSqm, COST_REFERENCE.best, COST_REFERENCE.worst);

  const totalWeight = Math.max(1e-6, weights.discomfort + weights.energy + weights.cost);
  const weighted =
    (weights.discomfort * discomfort + weights.energy * energy + weights.cost * costPenalty) /
    totalWeight;

  /*
   * SOFT BUDGET CONSTRAINT — scale-invariant.
   *
   * The overrun is expressed as a fraction of the *building's own cost*, not of
   * the budget. Normalising by the budget made the penalty explode for small
   * programmes: a ₹9 lakh shelter that comes in ₹6.6 lakh over a ₹2.5 lakh budget
   * reported a 2.65× penalty and scored zero, while an identical overshoot on a
   * ₹1.2 crore block was invisible — so the *size of the budget* was deciding the
   * score, not the *quality of the design*. Scaling by `cost.totalCost` makes the
   * penalty answer "how far over budget, relative to what this building costs",
   * which is the same question for every type and stays bounded by the cap, so a
   * low-budget type can never be silently scored zero for simply being cheap.
   */
  const budgetPenalty =
    parameters.budget > 0
      ? Math.min(1, Math.max(0, cost.budgetDelta) / Math.max(1, cost.totalCost))
      : 0;

  /*
   * Glazing adequacy — a V-shaped pull toward the type's daylight target.
   *
   * `deviation` is how far the window ratio sits from the glazing fraction that
   * best serves this building form (a low-rise plate needs perimeter daylight; a
   * verandah-shaded vernacular needs little). The penalty saturates at 0.2 of
   * deviation — 20 percentage points off target is treated as equally bad
   * whether it is too dark or too glazed — so the optimum sits where the cooling
   * saving from less glass balances the habitability cost of having less of it.
   */
  const daylightTarget = buildingType(parameters.buildingType).daylightTarget;
  const glazingDeviation = Math.abs(parameters.windowToWallRatio - daylightTarget);
  const glazingPenalty = Math.min(1, glazingDeviation / 0.2);

  return {
    id,
    label,
    parameters,
    materials,
    geometry,
    thermal,
    metrics,
    cost,
    objective:
      weighted + GLAZING_PENALTY_WEIGHT * glazingPenalty + BUDGET_PENALTY_WEIGHT * budgetPenalty,
    discomfort,
    energy,
    costPenalty,
    budgetPenalty,
    glazingPenalty,
  };
}

/** Project an evaluated candidate down to the shape the UI leaderboard needs. */
export function toCandidateEvaluation(candidate: EvaluatedCandidate): CandidateEvaluation {
  return {
    id: candidate.id,
    label: candidate.label,
    parameters: candidate.parameters,
    thermal: candidate.thermal,
    cost: candidate.cost.totalCost,
    objective: candidate.objective,
    discomfortScore: candidate.discomfort,
    energyScore: candidate.energy,
    costScore: candidate.costPenalty,
  };
}

/**
 * Composite design score 0–100, higher is better.
 *
 * A straight inversion of the weighted penalty, so the number the user sees in
 * the header is the same quantity the optimiser minimised — not a second,
 * separately-invented score that can disagree with the search.
 */
export function designScore(objective: number): number {
  return Math.round(Math.max(0, Math.min(1, 1 - objective)) * 100);
}

/** Build the objective weights from a single "priority" slider, 0 = cost, 1 = comfort. */
export function weightsFromPriority(priority: number): ObjectiveWeights {
  const t = Math.max(0, Math.min(1, priority));
  return {
    discomfort: 0.25 + 0.45 * t,
    energy: 0.5 - 0.2 * t,
    cost: 0.25 - 0.2 * t,
  };
}
