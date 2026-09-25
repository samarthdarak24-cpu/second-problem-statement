/**
 * The design pipeline.
 *
 * This is the seam the UI talks to. It exists so that no React component ever
 * has to know the order of operations, and so the whole chain can be run from a
 * script — which is how the demo scenarios and the verification harness are
 * built.
 *
 *   INPUT  →  CLIMATE  →  ANALYSIS  →  THERMAL  →  OPTIMISATION  →  PARAMETERS  →  3D  →  RESULTS
 *
 * The 3D and RESULTS stages are pure functions of the parameters this module
 * returns, so they cannot drift out of step with the numbers.
 */

import type {
  BuildingParameters,
  ClimateAnalysis,
  ClimateData,
  DesignComparison,
  DesignMode,
  Location,
  ObjectiveWeights,
  OptimizationResult,
  PipelineStageId,
} from '@/types';
import { resolveClimate, type ClimateProviderId } from '@/climate/climateService';
import { analyseClimate } from '@/climate/climateAnalysis';
import { compareDesigns } from './comparison';
import { conventionalBaseline } from './designSpace';
import { DEFAULT_WEIGHTS, evaluateParameters, type EvaluatedCandidate } from './objective';
import { optimizeDesign, type OptimizeRequest } from './optimizer';
import { activeEngineId, describeActiveEngine, type RecommendationEngineId } from '@/ml/surrogate';
import {
  isBackendConfigured,
  screenDesignsWithBackend,
  type ScreenResponse,
} from '@/api/client';

/* ------------------------------------------------------------------ */
/* Stage 1 — climate                                                   */
/* ------------------------------------------------------------------ */

export interface ClimateStageResult {
  climate: ClimateData;
  /** Where the data actually came from, for the honesty badge. */
  provider: ClimateProviderId;
  /** Plain-language note about provenance. */
  note: string;
  attribution: string;
  /** Provider attempts that failed, in order. */
  fallbacks: string[];
}

export async function runClimateStage(
  location: Location,
  options: {
    preferLive?: boolean;
    preferBackend?: boolean;
    openMeteoApiKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ClimateStageResult> {
  const resolved = await resolveClimate(location, {
    preferLive: options.preferLive ?? true,
    preferBackend: options.preferBackend ?? false,
    openMeteoApiKey: options.openMeteoApiKey,
    signal: options.signal,
  });
  return {
    climate: resolved.data,
    provider: resolved.provider,
    note: resolved.note,
    attribution: resolved.attribution,
    fallbacks: resolved.fallbacks,
  };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — analysis                                                  */
/* ------------------------------------------------------------------ */

export function runAnalysisStage(
  climate: ClimateData,
  requirements: BuildingParameters,
): ClimateAnalysis {
  return analyseClimate(climate, requirements);
}

/* ------------------------------------------------------------------ */
/* Stage 3 — thermal evaluation of one design                          */
/* ------------------------------------------------------------------ */

export function evaluateDesign(
  parameters: BuildingParameters,
  climate: ClimateData,
  weights: ObjectiveWeights = DEFAULT_WEIGHTS,
): EvaluatedCandidate {
  return evaluateParameters('design', 'Current design', parameters, climate, weights);
}

/* ------------------------------------------------------------------ */
/* Stage 4 — optimisation                                              */
/* ------------------------------------------------------------------ */

export interface GenerateOptions {
  mode: DesignMode;
  weights?: ObjectiveWeights;
  exhaustive?: boolean;
  sweeps?: number;
  onProgress?: (done: number, total: number) => void;
  /**
   * Try the FastAPI backend for climate before the local provider chain.
   *
   * Only meaningful when `NEXT_PUBLIC_API_URL` is set. A backend that is
   * configured but down costs one failed connection attempt and is recorded in
   * `fallbacks`, so the panel can say what happened rather than silently
   * pretending the local answer came from the service.
   */
  preferBackend?: boolean;
  /**
   * Try the live Open-Meteo reanalysis before falling back to the offline
   * climatology database.
   *
   * Defaults to on. Turning it off makes a run **deterministic and instant**,
   * which is what the verification suites need — a suite whose numbers move
   * with the venue wifi is not a suite. It is also the honest setting for a
   * demo that must not stall on a dead connection.
   */
  preferLive?: boolean;
  /**
   * Optional Open-Meteo API key for the live climate lookup. Threads straight
   * through to the provider as the `apikey` query parameter.
   */
  openMeteoApiKey?: string;
  /**
   * Called as each pipeline stage starts and finishes.
   *
   * Supplying this also makes the pipeline yield to the browser between stages
   * (see `yieldToUi`), which is what lets the flow diagram actually animate.
   */
  onStage?: (event: GenerateStageEvent) => void;
}

/** A single stage transition, emitted to `GenerateOptions.onStage`. */
export interface GenerateStageEvent {
  stage: PipelineStageId;
  status: 'running' | 'done';
  /** Wall-clock duration of the stage. Only present on `done`. */
  durationMs?: number;
}

/**
 * Hand the main thread back to the browser so React can paint.
 *
 * The whole chain runs in about 100 ms, which means that without a yield the
 * flow diagram would snap from "idle" to "finished" inside one frame — and the
 * INPUT → CLIMATE → ANALYSIS → THERMAL → OPTIMISATION → PARAMETERS → 3D →
 * RESULTS chain is the single thing this project exists to make visible.
 *
 * A macrotask is required: `await Promise.resolve()` only drains the microtask
 * queue and returns to the same frame, so nothing would render. The yield is
 * skipped entirely unless a caller asked for stage events, which keeps the
 * verification harness and the offline benchmark at full speed.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface StageReporter {
  start(stage: PipelineStageId): Promise<void>;
  done(stage: PipelineStageId, durationMs: number): void;
}

function makeReporter(
  onStage?: (event: GenerateStageEvent) => void,
): StageReporter | null {
  if (!onStage) return null;
  return {
    async start(stage) {
      onStage({ stage, status: 'running' });
      await yieldToUi();
    },
    done(stage, durationMs) {
      onStage({ stage, status: 'done', durationMs });
    },
  };
}

export interface GeneratedDesign {
  climate: ClimateData;
  climateProvider: ClimateProviderId;
  climateNote: string;
  climateAttribution: string;
  climateFallbacks: string[];
  analysis: ClimateAnalysis;
  /** The design that will actually be built — optimised in auto mode, the user's in manual mode. */
  design: EvaluatedCandidate;
  /** The conventional-construction reference the comparison is measured against. */
  baseline: EvaluatedCandidate;
  optimization: OptimizationResult | null;
  /**
   * A ranked shortlist from the backend's gradient-boosted surrogate, when the
   * backend was asked for and has a model that cleared its gate.
   *
   * This is deliberately *not* the optimiser's output and does not replace it.
   * The local search evaluates the physics engine and returns the design that
   * will be built; the surrogate screens a wider neighbourhood and returns an
   * ordering, with held-out error bars, in constant time. Presenting one as the
   * other would overstate the model — so they are two fields, and the UI labels
   * them differently.
   *
   * Null when the backend is not configured, was not requested, has no gated
   * model, or failed. A screening that could not be produced is absent, never
   * faked.
   */
  surrogateScreening: ScreenResponse | null;
  comparison: DesignComparison;
  engine: RecommendationEngineId;
  engineDescription: string;
  mode: DesignMode;
  /** Total wall-clock time for the whole chain, ms. */
  durationMs: number;
}

/**
 * Run the whole pipeline.
 *
 * In **auto** mode the optimiser searches the design space and the user's
 * parameter values are treated as the fixed programme (dimensions, occupancy,
 * budget, setpoints) — everything the climate affects is chosen for them.
 *
 * In **manual** mode the user's parameters are evaluated as-is; the optimiser is
 * skipped entirely, but the baseline and comparison are still produced so the
 * Before/After panel keeps working and the user can see what their choices cost.
 */
export async function generateDesign(
  location: Location,
  requirements: BuildingParameters,
  options: GenerateOptions,
): Promise<GeneratedDesign> {
  const started = Date.now();
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const report = makeReporter(options.onStage);

  /* --- INPUT: the programme is already known, so this stage is a formality
         that exists to make the chain readable. --- */
  await report?.start('input');
  report?.done('input', Date.now() - started);

  /* --- CLIMATE --- */
  await report?.start('climate');
  const climateStart = Date.now();
  const climateStage = await runClimateStage(location, {
    preferLive: options.preferLive ?? true,
    preferBackend: options.preferBackend ?? false,
    openMeteoApiKey: options.openMeteoApiKey,
  });
  const climate = climateStage.climate;
  report?.done('climate', Date.now() - climateStart);

  /* --- ANALYSIS --- */
  await report?.start('analysis');
  const analysisStart = Date.now();
  const analysis = runAnalysisStage(climate, requirements);
  report?.done('analysis', Date.now() - analysisStart);

  /* --- THERMAL: the conventional reference. Evaluated before the search so the
         optimiser has something to be measured against. --- */
  await report?.start('thermal');
  const thermalStart = Date.now();
  const baseline = evaluateDesign(conventionalBaseline(requirements), climate, weights);
  report?.done('thermal', Date.now() - thermalStart);

  /* --- OPTIMISATION --- */
  await report?.start('optimization');
  const optStart = Date.now();

  let design: EvaluatedCandidate;
  let optimization: OptimizationResult | null = null;

  if (options.mode === 'auto') {
    const request: OptimizeRequest = {
      requirements,
      climate,
      analysis,
      weights,
      exhaustive: options.exhaustive,
      sweeps: options.sweeps,
      onProgress: options.onProgress,
    };
    optimization = optimizeDesign(request);
    design = evaluateDesign(optimization.parameters, climate, weights);
  } else {
    design = evaluateDesign(requirements, climate, weights);
  }

  /*
   * Ask the backend's surrogate to screen the same neighbourhood, if one is
   * available.
   *
   * This is additive and entirely optional. Every failure mode — not
   * configured, refused because no model cleared its gate, unreachable, slow —
   * results in `null`, and the pipeline carries on with the local result. The
   * screening must never be able to break design generation, because the local
   * engine is the authority and this is an extra opinion.
   */
  let surrogateScreening: ScreenResponse | null = null;
  if (options.preferBackend && isBackendConfigured()) {
    try {
      surrogateScreening = await screenDesignsWithBackend({
        location,
        requirements,
        weights,
        climate,
        limit: 8,
        exhaustive: options.exhaustive ?? false,
      });
    } catch {
      // Refused (no gated model), unreachable, or timed out. The absence is the
      // honest outcome; `climateFallbacks` already reports backend trouble for
      // the climate stage, and the panel simply omits the screening section.
      surrogateScreening = null;
    }
  }

  report?.done('optimization', Date.now() - optStart);

  /* --- PARAMETERS and 3D: both are pure derivations of `design`, which already
         carries its resolved materials and geometry, so these two stages cost
         nothing to report and cannot disagree with the numbers above. --- */
  await report?.start('parameters');
  report?.done('parameters', 0);
  await report?.start('geometry');
  report?.done('geometry', 0);

  /* --- RESULTS --- */
  await report?.start('results');
  const resultsStart = Date.now();

  const comparison = compareDesigns(
    {
      label: 'Conventional local construction',
      parameters: baseline.parameters,
      thermal: baseline.thermal,
      cost: baseline.cost,
    },
    {
      label: options.mode === 'auto' ? 'Climate-optimised design' : 'Your design',
      parameters: design.parameters,
      thermal: design.thermal,
      cost: design.cost,
    },
    climate,
  );

  report?.done('results', Date.now() - resultsStart);

  return {
    climate,
    climateProvider: climateStage.provider,
    climateNote: climateStage.note,
    climateAttribution: climateStage.attribution,
    climateFallbacks: climateStage.fallbacks,
    analysis,
    design,
    baseline,
    optimization,
    surrogateScreening,
    comparison,
    engine: activeEngineId(),
    engineDescription: describeActiveEngine(),
    mode: options.mode,
    durationMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ */
/* Manual-mode helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Re-evaluate only the thermal + cost stages for a manual parameter change.
 *
 * Slider moves must not re-fetch climate or re-run the optimiser, so this is the
 * hot path the UI calls on every interaction. It is deliberately synchronous and
 * allocation-light.
 */
export function reevaluateManual(
  parameters: BuildingParameters,
  climate: ClimateData,
  analysis: ClimateAnalysis,
  weights: ObjectiveWeights = DEFAULT_WEIGHTS,
): {
  design: EvaluatedCandidate;
  comparison: DesignComparison;
} {
  void analysis;
  const design = evaluateDesign(parameters, climate, weights);
  const baseline = evaluateDesign(conventionalBaseline(parameters), climate, weights);
  const comparison = compareDesigns(
    {
      label: 'Conventional local construction',
      parameters: baseline.parameters,
      thermal: baseline.thermal,
      cost: baseline.cost,
    },
    {
      label: 'Your design',
      parameters: design.parameters,
      thermal: design.thermal,
      cost: design.cost,
    },
    climate,
  );
  return { design, comparison };
}
