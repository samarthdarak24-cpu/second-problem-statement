/**
 * Optimisation, cost and recommendation types.
 */

import type { BuildingParameters } from './building';
import type { CandidateEvaluation, ThermalComfort } from './thermal';

/** The three competing objectives, expressed as weights. */
export interface ObjectiveWeights {
  /** Weight on thermal discomfort (PMV deviation + overheating hours). */
  discomfort: number;
  /** Weight on annual delivered energy. */
  energy: number;
  /** Weight on construction cost. */
  cost: number;
}

/** A single explained design recommendation. */
export interface Recommendation {
  id: string;
  category: 'orientation' | 'envelope' | 'glazing' | 'roof' | 'shading' | 'ventilation' | 'services';
  /** What is recommended. */
  parameter: string;
  /** The recommended value, pre-formatted for display. */
  value: string;
  /** Plain-language justification. */
  reason: string;
  impact: 'high' | 'medium' | 'low';
  /** Estimated effect, e.g. "−2.8 °C indoor peak". */
  effect?: string;
}

/** A line item in the cost breakdown. */
export interface CostLineItem {
  id: string;
  label: string;
  category: 'structure' | 'envelope' | 'glazing' | 'roof' | 'shading' | 'services' | 'finishes';
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  /** Optional note, e.g. "u-value 0.28 W/m²K". */
  note?: string;
}

/** Full cost model output. */
export interface CostEstimate {
  lineItems: CostLineItem[];
  /** Shell + envelope construction cost. */
  constructionCost: number;
  /** Installed services cost. */
  servicesCost: number;
  /** Total capital cost. */
  totalCost: number;
  /** Cost per m² of floor area. */
  costPerSqm: number;
  /** Present-value running cost over the analysis period. */
  lifecycleEnergyCost: number;
  /** 20-year total cost of ownership. */
  twentyYearCost: number;
  /** Whether the design fits the user's budget. */
  withinBudget: boolean;
  /** Budget overrun (positive) or headroom (negative). */
  budgetDelta: number;
}

/** Result of a full optimisation run. */
export interface OptimizationResult {
  /** The recommended design. */
  parameters: BuildingParameters;
  thermal: ThermalComfort;
  cost: CostEstimate;
  recommendations: Recommendation[];
  /** Composite design score 0–100 — higher is better. */
  score: number;
  /** Energy saved vs the baseline, kWh/year. */
  energySavings: number;
  /** Energy saved vs the baseline, %. */
  energySavingsPct: number;
  /** Cost delta vs the baseline (positive = more expensive to build). */
  costDelta: number;
  /** Comfort score improvement vs the baseline, points. */
  comfortGain: number;
  /** How many candidates were evaluated. */
  candidatesEvaluated: number;
  /** Search strategy actually used. */
  method: OptimizationMethod;
  /** Top candidates, best first — powers the transparency panel. */
  leaderboard: CandidateEvaluation[];
  /** Which engine produced the recommendation. */
  engine: RecommendationEngine;
  provenance: import('./thermal').ModelProvenance;
  /** Wall-clock search duration, ms. */
  durationMs: number;
}

export type OptimizationMethod =
  | 'grid-search'
  | 'coordinate-descent'
  | 'surrogate-guided'
  | 'xgboost-surrogate';

export type RecommendationEngine =
  | 'rule-based-climate-engine'
  | 'physics-optimiser'
  | 'ml-surrogate';

/** The rule-based engine's raw output before optimisation refines it. */
export interface RuleBasedRecommendation {
  parameters: Partial<BuildingParameters>;
  recommendations: Recommendation[];
}

/** Baseline-vs-optimised comparison payload. */
export interface DesignComparison {
  baseline: {
    label: string;
    parameters: BuildingParameters;
    thermal: ThermalComfort;
    cost: CostEstimate;
    score: number;
  };
  optimized: {
    label: string;
    parameters: BuildingParameters;
    thermal: ThermalComfort;
    cost: CostEstimate;
    score: number;
  };
  deltas: ComparisonDelta[];
}

/** One row of the before/after comparison table. */
export interface ComparisonDelta {
  metric: string;
  unit: string;
  baseline: number;
  optimized: number;
  /** optimized − baseline. */
  delta: number;
  /** Improvement direction: true when a decrease is better. */
  lowerIsBetter: boolean;
  /** % change vs baseline. */
  changePct: number;
  /** true when the change is an improvement. */
  improved: boolean;
}
