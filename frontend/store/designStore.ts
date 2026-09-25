'use client';

/**
 * The one store.
 *
 * Everything the dashboard shows is a projection of this object. Two rules keep
 * it honest:
 *
 *  1. NOTHING IS DERIVED TWICE. The thermal result, the cost estimate and the
 *     resolved geometry all come out of a single `EvaluatedCandidate` produced
 *     by the pipeline. The 3D view therefore cannot show a building the numbers
 *     were not computed for.
 *
 *  2. SLIDER MOVES DO NOT RE-RUN THE PIPELINE. Re-fetching climatology or
 *     re-running the optimiser on every drag would make the interface unusable
 *     and would be dishonest anyway — the climate has not changed. Moving a
 *     slider calls `reevaluateManual`, which re-runs only the thermal and cost
 *     stages, and that is genuinely all that needs to happen.
 *
 * Auto and manual mode are not cosmetic. In auto mode the parameter panel is
 * read-only: the optimiser owns the envelope, and letting a user nudge a value
 * would silently invalidate the search that produced it. Switching to manual
 * hands the envelope back to the user and keeps the optimiser's answer as the
 * reference to compare against.
 */

import { create } from 'zustand';
import type {
  BuildingParameters,
  CameraPreset,
  CandidateEvaluation,
  ClimateAnalysis,
  ClimateData,
  CostEstimate,
  DesignComparison,
  DesignMode,
  DesignState,
  Location,
  ObjectiveWeights,
  OptimizationResult,
  PanelVisibility,
  PipelineStage,
  PipelineStageId,
  Recommendation,
  ThermalComfort,
  VisualizationMode,
} from '@/types';
import { DEFAULT_STATION_ID, STATION_BY_ID } from '@/climate/stations';
import type { ClimateProviderId } from '@/climate/climateService';
import { isBackendConfigured, type ScreenResponse } from '@/api/client';
import type { RecommendationEngineId } from '@/ml/surrogate';
import { deriveDesignMetrics, type DesignMetrics } from '@/thermal/metrics';
import { INSULATION_LABEL, ROOF_LABEL, SHADING_LABEL, VENTILATION_LABEL } from '@/thermal/constants';
import { analyseClimate } from '@/climate/climateAnalysis';
import { DEFAULT_WEIGHTS, weightsFromPriority } from '@/optimization/objective';
import type { EvaluatedCandidate } from '@/optimization/objective';
import { analysisDrivenParameters, conventionalBaseline, describeDesign } from '@/optimization/designSpace';
import { buildRecommendations } from '@/optimization/recommendations';
import {
  evaluateDesign,
  generateDesign,
  reevaluateManual,
  type GenerateStageEvent,
  type GeneratedDesign,
} from '@/optimization/pipeline';
import {
  defaultRequirements,
  FIELD_BY_KEY,
  withNumericParameter,
  withSelectParameter,
  type NumericParameterKey,
  type SelectParameterKey,
} from '@/lib/parameters';
import { CHALLENGE_LABEL, PROVIDER_LABEL, ZONE_LABEL } from '@/lib/labels';
import { extractErrorMessage } from '@/lib/utils';
import { DAYS_IN_MONTH } from '@/utils/units';
import {
  area,
  currency,
  energyPerYear,
  latLon,
  num,
  pct,
  signedPct,
  temp,
  truncate,
  uValue,
  volume,
} from '@/utils/format';

/* ------------------------------------------------------------------ */
/* Pipeline scaffolding                                                */
/* ------------------------------------------------------------------ */

/** The order the stages run in — also the order they are drawn in. */
export const STAGE_ORDER: PipelineStageId[] = [
  'input',
  'climate',
  'analysis',
  'thermal',
  'optimization',
  'parameters',
  'geometry',
  'results',
];

const STAGE_TEMPLATE: { id: PipelineStageId; label: string; description: string }[] = [
  { id: 'input', label: 'Input', description: 'Location and design programme' },
  { id: 'climate', label: 'Climate', description: 'Climatology resolved for the site' },
  { id: 'analysis', label: 'Analysis', description: 'Zone, challenge and design strategy' },
  { id: 'thermal', label: 'Thermal', description: 'Monthly heat balance, PMV and energy' },
  { id: 'optimization', label: 'Optimisation', description: 'Search across the design space' },
  { id: 'parameters', label: 'Parameters', description: 'Resolved buildable specification' },
  { id: 'geometry', label: '3D model', description: 'Parametric envelope geometry' },
  { id: 'results', label: 'Results', description: 'Comfort, energy, cost and comparison' },
];

function idlePipeline(): PipelineStage[] {
  return STAGE_TEMPLATE.map((stage) => ({
    ...stage,
    status: 'idle',
    headline: '—',
    details: [],
  }));
}

/* ------------------------------------------------------------------ */
/* Store shape                                                         */
/* ------------------------------------------------------------------ */

export interface DesignStore extends DesignState {
  /* --- Climate provenance ------------------------------------------ */
  climateProvider: ClimateProviderId | null;
  climateNote: string;
  climateAttribution: string;
  climateFallbacks: string[];

  /* --- Engine ------------------------------------------------------- */
  engine: RecommendationEngineId;
  engineDescription: string;
  durationMs: number;

  /* --- Live evaluation of `currentParameters` ------------------------ */
  metrics: DesignMetrics | null;
  baselineMetrics: DesignMetrics | null;
  cost: CostEstimate | null;
  baselineCost: CostEstimate | null;
  score: number;
  baselineScore: number;
  /** Materials + geometry of the live design — what the 3D view renders. */
  materials: EvaluatedCandidate['materials'] | null;
  geometry: EvaluatedCandidate['geometry'] | null;

  /* --- Search transparency ------------------------------------------ */
  leaderboard: CandidateEvaluation[];
  spaceSize: number;
  evaluations: number;
  /**
   * The backend surrogate's ranked shortlist, when one was requested and the
   * service had a gated model. Null otherwise — absent, never faked.
   */
  surrogateScreening: ScreenResponse | null;
  /** 0 = cheapest, 1 = most comfortable. Feeds `weightsFromPriority`. */
  priority: number;
  /** The climate engine's own proposal, so manual mode can be advised too. */
  adviceParameters: BuildingParameters | null;

  /* --- Backend routing ---------------------------------------------- */
  /**
   * Whether to ask the FastAPI service to resolve climate before falling back
   * to the local provider chain.
   *
   * Defaults to on when `NEXT_PUBLIC_API_URL` is configured, and the UI only
   * shows the toggle when it is. A toggle that does nothing is worse than no
   * toggle: it teaches the user that the architecture diagram is decoration.
   */
  useBackend: boolean;
  /** Whether a backend is configured at all, so the UI can hide the control. */
  backendConfigured: boolean;
  /**
   * Whether to try the live Open-Meteo reanalysis before the offline database.
   *
   * On by default. Turning it off makes every run deterministic and instant —
   * the offline database is the same answer every time, with no network wait.
   * That is what the verification suites need, and it is the setting to use
   * when a demo must not stall on a dead venue connection.
   */
  preferLive: boolean;
  /**
   * Optional Open-Meteo API key, entered at runtime in the topbar (or seeded
   * from `NEXT_PUBLIC_OPEN_METEO_API_KEY`). Lifts the live-lookup rate limit so
   * many sites resolve without 429s. Empty = keyless free tier (global coverage,
   * just rate-capped).
   */
  openMeteoApiKey: string;
  /**
   * Whether the 3D viewport is in expanded (focus) mode.
   *
   * When true, the page-level layout collapses the side panels and gives the
   * viewport the full width of the content area. The viewport itself grows to
   * a taller canvas, so the controls that get cut off at the dashboard's
   * default 520 px height (hour/month/day sliders, camera presets, geometry
   * chips, mode-specific readouts) all stay visible.
   */
  viewportExpanded: boolean;

  /* --- Actions ------------------------------------------------------ */
  setLocation(location: Location): void;
  setMode(mode: DesignMode): void;
  setPriority(priority: number): void;
  setVisualizationMode(mode: VisualizationMode): void;
  setCameraPreset(preset: CameraPreset): void;
  setHour(hour: number): void;
  setMonth(month: number): void;
  setDay(day: number): void;
  setPanel(key: keyof PanelVisibility, open: boolean): void;
  toggleLayer(
    key: 'showShading' | 'showFurniture' | 'showLabels' | 'showDimensions' | 'showSunPath',
  ): void;
  updateNumeric(key: NumericParameterKey, value: number): void;
  updateSelect(key: SelectParameterKey, value: string): void;
  /** Replace the whole parameter set at once — presets and saved designs. */
  setParameters(parameters: BuildingParameters): void;
  /** Adopt the climate engine's proposal (or the optimiser's) as the live design. */
  adoptAdvice(): void;
  /** Fall back to conventional local construction. */
  adoptConventional(): void;
  /**
   * Load a scenario from the Scenario Lab into the studio.
   *
   * Deliberately a *full* pipeline run rather than a bare parameter swap. A
   * sweep cell was optimised against its own site's climate, so adopting one
   * into a studio pointed at a different site would put a design on screen
   * whose numbers were computed somewhere else. Moving the site and re-running
   * is the only version of this that keeps the picture and the numbers
   * describing the same building.
   */
  loadScenario(location: Location, parameters: BuildingParameters): Promise<void>;
  setUseBackend(useBackend: boolean): void;
  setPreferLive(preferLive: boolean): void;
  /** Persist a runtime Open-Meteo API key (or clear it with ''). */
  setOpenMeteoApiKey(apiKey: string): void;
  /** Toggle the 3D viewport's expanded/focus mode (hides side panels). */
  toggleViewportExpanded(): void;
  setViewportExpanded(expanded: boolean): void;
  generate(): Promise<void>;
  dismissError(): void;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function initialLocation(): Location {
  const station = STATION_BY_ID.get(DEFAULT_STATION_ID) ?? STATION_BY_ID.values().next().value;
  if (!station) {
    /* The offline database is non-empty by construction; this keeps the type
       checker happy without an assertion. */
    return {
      id: 'in-pune',
      country: 'India',
      state: 'Maharashtra',
      city: 'Pune',
      latitude: 18.52,
      longitude: 73.86,
      elevation: 560,
    };
  }
  return station.location;
}

/**
 * The climate engine's recommendations, measured against conventional
 * construction.
 *
 * `probe` re-evaluates a single reverted axis, which is how each effect figure
 * is attributed to one decision instead of the whole design.
 */
function recommendationsFor(
  proposal: EvaluatedCandidate,
  baseline: EvaluatedCandidate,
  climate: ClimateData,
  analysis: ClimateAnalysis,
  weights: ObjectiveWeights,
): Recommendation[] {
  return buildRecommendations({
    analysis,
    climate,
    baseline,
    optimized: proposal,
    probe: (parameters) => evaluateDesign(parameters, climate, weights),
  });
}

/** Fill in every stage's headline and detail lines once a run has finished. */
function describeStages(
  result: GeneratedDesign,
  location: Location,
  metrics: DesignMetrics,
  baselineMetrics: DesignMetrics,
  evaluations: number,
  method: string,
): PipelineStage[] {
  const { climate, analysis, design } = result;
  const { summary } = climate;
  const { parameters, materials, geometry, cost } = design;

  const energyChange =
    baselineMetrics.annualEnergy > 0
      ? ((metrics.annualEnergy - baselineMetrics.annualEnergy) / baselineMetrics.annualEnergy) * 100
      : 0;

  const headlineFor: Record<PipelineStageId, string> = {
    input: location.city,
    climate: climate.climateType,
    analysis: CHALLENGE_LABEL[analysis.mainChallenge],
    thermal: `${temp(metrics.summerIndoorTemperature)} peak indoor`,
    optimization: result.optimization
      ? `${result.optimization.score} / 100`
      : 'Manual — search skipped',
    parameters: truncate(describeDesign(parameters), 74),
    geometry: `${area(geometry.floorArea)} floor`,
    results: currency(cost.totalCost),
  };

  const detailsFor: Record<PipelineStageId, string[]> = {
    input: [
      `${latLon(location.latitude, location.longitude)} · ${Math.round(location.elevation)} m`,
      `${parameters.numOccupants} occupants · ${parameters.width}×${parameters.length} m · ${currency(parameters.budget)}`,
    ],
    climate: [
      `Annual mean ${temp(summary.avgTemperature)} · diurnal swing ${num(summary.diurnalSwing)} K`,
      `${PROVIDER_LABEL[result.climateProvider] ?? result.climateProvider}`,
    ],
    analysis: [
      `${ZONE_LABEL[analysis.zone]} zone`,
      `${VENTILATION_LABEL[analysis.ventilationStrategy]} · ${INSULATION_LABEL[analysis.insulationLevel]} insulation`,
      `${SHADING_LABEL[analysis.shadingStrategy]} · WWR ${pct(analysis.windowRatioRecommendation * 100)}`,
    ],
    thermal: [
      `${pct(metrics.adaptiveComfortHoursPct)} of hours inside the adaptive band`,
      `Conventional reference ${temp(baselineMetrics.summerIndoorTemperature)}`,
    ],
    optimization: result.optimization
      ? [
          `${evaluations} candidates evaluated · ${method}`,
          `Comfort +${num(result.optimization.comfortGain)} pts · energy ${signedPct(result.optimization.energySavingsPct)}`,
        ]
      : [
          'Optimiser skipped — you are driving the envelope.',
          `${evaluations} candidates still evaluated for the reference design`,
        ],
    parameters: [
      `Wall ${materials.wall.name} · ${uValue(materials.wall.uValue)}`,
      `Roof ${ROOF_LABEL[parameters.roofType]} · ${materials.roof.name}`,
      `Glazing ${materials.window.name} · WWR ${pct(parameters.windowToWallRatio * 100)}`,
    ],
    geometry: [
      `${volume(geometry.volume)} conditioned · envelope ${area(geometry.envelopeArea)}`,
      `${geometry.walls.length} wall panels · ${geometry.shading.length} shading devices`,
    ],
    results: [
      `Conditioned PMV ${num(metrics.conditionedPmv, 2)} · PPD ${pct(metrics.conditionedPpd)}`,
      `${energyPerYear(metrics.annualEnergy)} · ${signedPct(energyChange)} vs conventional`,
    ],
  };

  return STAGE_ORDER.map((id) => {
    const template = STAGE_TEMPLATE.find((s) => s.id === id)!;
    return {
      ...template,
      status: 'done' as const,
      headline: headlineFor[id],
      details: detailsFor[id],
    };
  });
}

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

const defaults = defaultRequirements();

export const useDesignStore = create<DesignStore>((set, get) => {
  /**
   * Re-run the thermal and cost stages for the live parameters.
   *
   * Deliberately synchronous: it is called on every slider tick, and an
   * `async` boundary there would make the 3D model lag the handle.
   */
  const reevaluate = (parameters: BuildingParameters): void => {
    const { climateData, climateAnalysis, priority } = get();
    if (!climateData) {
      set({ currentParameters: parameters, isDirty: true });
      return;
    }

    const weights = weightsFromPriority(priority);
    const analysis = climateAnalysis ?? analyseClimate(climateData, parameters);
    const { design, comparison } = reevaluateManual(parameters, climateData, analysis, weights);

    set({
      currentParameters: parameters,
      isDirty: true,
      climateAnalysis: analysis,
      currentThermal: design.thermal,
      baselineThermal: comparison.baseline.thermal,
      comparison,
      metrics: design.metrics,
      baselineMetrics: deriveDesignMetrics(comparison.baseline.thermal, climateData),
      cost: design.cost,
      baselineCost: comparison.baseline.cost,
      score: comparison.optimized.score,
      baselineScore: comparison.baseline.score,
      materials: design.materials,
      geometry: design.geometry,
    });
  };

  /** Apply a finished pipeline run to the store in one transition. */
  const applyGenerated = (result: GeneratedDesign, location: Location): void => {
    const { design, baseline, climate, analysis, optimization, comparison, mode } = result;
    const weights = weightsFromPriority(get().priority);

    const metrics = design.metrics;
    const baselineMetrics = deriveDesignMetrics(baseline.thermal, climate);

    /*
     * In auto mode the optimiser's answer *is* the advice. In manual mode it is
     * not, so the climate engine's own proposal is evaluated separately and the
     * recommendation panel explains that instead — otherwise a user who built a
     * conventional shelter by hand would see an empty panel and learn nothing.
     */
    const adviceParameters =
      mode === 'auto' ? design.parameters : analysisDrivenParameters(result.design.parameters, climate, analysis);

    const adviceCandidate =
      mode === 'auto' ? design : evaluateDesign(adviceParameters, climate, weights);

    const recommendations =
      optimization?.recommendations ??
      recommendationsFor(adviceCandidate, baseline, climate, analysis, weights);

    const evaluations = optimization?.candidatesEvaluated ?? 1;
    const method = optimization?.method ?? 'not run';

    set({
      isGenerating: false,
      statusMessage: 'Design ready.',
      error: null,

      location,
      climateData: climate,
      climateAnalysis: analysis,
      climateProvider: result.climateProvider,
      climateNote: result.climateNote,
      climateAttribution: result.climateAttribution,
      climateFallbacks: result.climateFallbacks,

      baselineParameters: baseline.parameters,
      optimizedParameters: design.parameters,
      currentParameters: design.parameters,
      isDirty: false,
      adviceParameters,

      baselineThermal: baseline.thermal,
      currentThermal: design.thermal,
      optimization,
      comparison,
      recommendations,

      metrics,
      baselineMetrics,
      cost: design.cost,
      baselineCost: baseline.cost,
      score: comparison.optimized.score,
      baselineScore: comparison.baseline.score,
      materials: design.materials,
      geometry: design.geometry,

      leaderboard: optimization?.leaderboard ?? [],
      spaceSize: optimization ? evaluations : 0,
      evaluations,
      surrogateScreening: result.surrogateScreening,
      engine: result.engine,
      engineDescription: result.engineDescription,
      durationMs: result.durationMs,

      /* Default the analysis month to the climate's own peak cooling month —
         the month the design is actually being judged on. */
      analysisMonth: climate.summary.peakCoolingMonth,

      pipeline: describeStages(result, location, metrics, baselineMetrics, evaluations, method),
    });
  };

  return {
    /* ---------------- initial state ---------------- */
    mode: 'auto',
    isGenerating: false,
    statusMessage: 'Ready — choose a location and generate a design.',
    error: null,

    location: initialLocation(),
    climateData: null,
    climateAnalysis: null,

    baselineParameters: { ...defaults },
    optimizedParameters: { ...defaults },
    currentParameters: { ...defaults },
    isDirty: false,

    baselineThermal: null,
    currentThermal: null,
    optimization: null,
    comparison: null,
    recommendations: [],

    visualizationMode: 'normal',
    cameraPreset: 'iso',
    showShading: true,
    showFurniture: true,
    showLabels: true,
    showDimensions: true,
    showSunPath: false,
    hourOfDay: 14,
    analysisMonth: 5,
    /* Mid-month by default, so the shadow study opens on a representative day
       rather than on a month boundary where the declination is least typical. */
    dayOfMonth: 15,

    panels: {
      climateSummary: true,
      recommendations: true,
      materials: true,
      comparison: true,
      charts: true,
      pipeline: true,
    },
    pipeline: idlePipeline(),

    climateProvider: null,
    climateNote: '',
    climateAttribution: '',
    climateFallbacks: [],

    engine: 'rule-based-climate-engine',
    engineDescription: '',
    durationMs: 0,

    metrics: null,
    baselineMetrics: null,
    cost: null,
    baselineCost: null,
    score: 0,
    baselineScore: 0,
    materials: null,
    geometry: null,

    leaderboard: [],
    spaceSize: 0,
    evaluations: 0,
    surrogateScreening: null,
    priority: 0.6,
    adviceParameters: null,

    /* ---------------- backend routing ---------------- */
    //
    // Defaults to on when the service is configured, because a developer who
    // set `NEXT_PUBLIC_API_URL` did so in order to use it. The provider chain
    // falls back to the local engine anyway, so a wrong guess costs one
    // connection attempt rather than a failed run.
    useBackend: isBackendConfigured(),
    backendConfigured: isBackendConfigured(),
    preferLive: true,
    openMeteoApiKey: process.env.NEXT_PUBLIC_OPEN_METEO_API_KEY ?? '',
    /* Viewport starts in its normal dock size; the user opts into expanded
       mode with the maximise button in the viewport header. */
    viewportExpanded: false,

    /* ---------------- actions ---------------- */

    setLocation(location) {
      /* Changing the site invalidates every climate-derived number, so the
         stale results are cleared rather than left on screen looking current. */
      set({
        location,
        climateData: null,
        climateAnalysis: null,
        optimization: null,
        comparison: null,
        recommendations: [],
        baselineThermal: null,
        currentThermal: null,
        metrics: null,
        baselineMetrics: null,
        cost: null,
        baselineCost: null,
        leaderboard: [],
        surrogateScreening: null,
        adviceParameters: null,
        isDirty: false,
        statusMessage: `Site set to ${location.city}. Generate to analyse it.`,
        pipeline: idlePipeline(),
      });
    },

    setMode(mode) {
      set({ mode, isDirty: false });
    },

    setPriority(priority) {
      set({ priority });
    },

    setVisualizationMode(mode) {
      const cameraPreset: CameraPreset =
        mode === 'front'
          ? 'front'
          : mode === 'side'
            ? 'side'
            : mode === 'top' || mode === 'floorplan'
              ? 'top'
              : mode === 'walkthrough'
                ? 'walk'
                : get().cameraPreset === 'walk'
                  ? 'iso'
                  : get().cameraPreset;
      set({ visualizationMode: mode, cameraPreset });
    },

    setCameraPreset(preset) {
      set({ cameraPreset: preset });
    },

    setHour(hour) {
      set({ hourOfDay: hour });
    },

    setMonth(month) {
      const next = Math.max(0, Math.min(11, Math.round(month)));
      /* The day is clamped to the new month's length: moving from the 31st of
         May to June must not leave a 31st of June in the state, because the
         solar engine would then be asked for a day that does not exist. */
      const day = Math.min(get().dayOfMonth, DAYS_IN_MONTH[next] ?? 28);
      set({ analysisMonth: next, dayOfMonth: day });
    },

    setDay(day) {
      const monthLength = DAYS_IN_MONTH[get().analysisMonth] ?? 28;
      set({ dayOfMonth: Math.max(1, Math.min(monthLength, Math.round(day))) });
    },

    setPanel(key, open) {
      set((state) => ({ panels: { ...state.panels, [key]: open } }));
    },

    toggleLayer(key) {
      set((state) => ({ [key]: !state[key] }) as unknown as Partial<DesignStore>);
    },

    updateNumeric(key, value) {
      const next = withNumericParameter(get().currentParameters, key, value);
      const field = FIELD_BY_KEY.get(key);

      /*
       * Recommendations are a pure function of the programme — the analysis,
       * the advice design and the conventional baseline all read only the
       * programme fields. Rebuilding them for an envelope change would cost ten
       * extra thermal evaluations per slider tick to produce the same answer.
       */
      if (field?.kind === 'slider' && field.programme) {
        reevaluate(next);
        const { climateData, climateAnalysis, priority } = get();
        if (climateData && climateAnalysis) {
          const weights = weightsFromPriority(priority);
          const advice = evaluateDesign(
            analysisDrivenParameters(next, climateData, climateAnalysis),
            climateData,
            weights,
          );
          const baseline = evaluateDesign(conventionalBaseline(next), climateData, weights);
          set({
            adviceParameters: advice.parameters,
            recommendations: recommendationsFor(
              advice,
              baseline,
              climateData,
              climateAnalysis,
              weights,
            ),
          });
        }
        return;
      }

      reevaluate(next);
    },

    updateSelect(key, value) {
      const next = withSelectParameter(get().currentParameters, key, value);
      reevaluate(next);
    },

    setParameters(parameters) {
      reevaluate(parameters);
    },

    adoptAdvice() {
      const { adviceParameters } = get();
      if (!adviceParameters) return;
      reevaluate(adviceParameters);
    },

    adoptConventional() {
      reevaluate(conventionalBaseline(get().currentParameters));
    },

    async loadScenario(location, parameters) {
      /*
       * Move the site first, but only if it is actually a different one.
       * `setLocation` clears every climate-derived number on purpose, and
       * re-clearing them for a same-site scenario would throw away results the
       * user is still reading for no reason.
       */
      if (get().location?.id !== location.id) {
        get().setLocation(location);
      }

      set({
        currentParameters: parameters,
        isDirty: true,
        statusMessage: `Loaded the ${location.city} scenario — re-running the pipeline for this site.`,
      });

      /* `generate()` re-derives everything from the parameters we just set, so
         the studio ends up showing a design whose numbers were computed for
         the site it is standing on. */
      await get().generate();
    },

    setUseBackend(useBackend) {
      /* Toggling the route does not re-run anything by itself: the next
         Generate is what exercises it. Re-running here would make a toggle
         feel like a button, and the user would lose whatever they were
         reading in the results panel. */
      set({
        useBackend,
        statusMessage: useBackend
          ? 'Backend routing on — climate will be resolved by the FastAPI service when it answers.'
          : 'Backend routing off — climate will be resolved locally.',
      });
    },

    setPreferLive(preferLive) {
      set({
        preferLive,
        statusMessage: preferLive
          ? 'Live climate lookups on — the next Generate will try Open-Meteo first.'
          : 'Live climate lookups off — the next Generate will use the offline database, so results are reproducible.',
      });
    },

    setOpenMeteoApiKey(apiKey) {
      const trimmed = apiKey.trim();
      set({
        openMeteoApiKey: trimmed,
        statusMessage: trimmed
          ? 'Open-Meteo API key set — live lookups for all locations are rate-limit-free.'
          : 'Open-Meteo API key cleared — using the keyless free tier (rate-capped).',
      });
    },

    toggleViewportExpanded() {
      const next = !get().viewportExpanded;
      set({
        viewportExpanded: next,
        statusMessage: next
          ? 'Viewport expanded — side panels hidden so the 3D model can be inspected at full size.'
          : 'Viewport back to normal — side panels restored.',
      });
    },

    setViewportExpanded(expanded) {
      set({ viewportExpanded: expanded });
    },

    async generate() {
      const { location, currentParameters, mode, priority, pipeline, useBackend, preferLive, openMeteoApiKey } = get();
      if (!location || get().isGenerating) return;

      const weights = weightsFromPriority(priority);

      set({
        isGenerating: true,
        error: null,
        statusMessage: 'Running the design pipeline…',
        pipeline: pipeline.map((stage) => ({ ...stage, status: 'idle', details: [], headline: '—' })),
      });

      /* Advance the flow diagram as the pipeline reports each stage. Stages
         after the current one are reset, so a second run replays cleanly. */
      const onStage = (event: GenerateStageEvent): void => {
        const index = STAGE_ORDER.indexOf(event.stage);
        set((state) => ({
          statusMessage:
            event.status === 'running'
              ? `${STAGE_TEMPLATE.find((s) => s.id === event.stage)?.label ?? event.stage}…`
              : state.statusMessage,
          pipeline: state.pipeline.map((stage) => {
            const own = STAGE_ORDER.indexOf(stage.id);
            if (stage.id === event.stage) {
              return {
                ...stage,
                status: event.status,
                durationMs: event.durationMs ?? stage.durationMs,
              };
            }
            if (own > index) return { ...stage, status: 'idle', headline: '—', details: [] };
            if (own < index) return { ...stage, status: 'done' };
            return stage;
          }),
        }));
      };

      try {
        const result = await generateDesign(location, currentParameters, {
          mode,
          weights,
          preferBackend: useBackend,
          preferLive,
          openMeteoApiKey,
          onStage,
        });
        applyGenerated(result, location);
      } catch (error) {
        const message = extractErrorMessage(error);
        set((state) => ({
          isGenerating: false,
          error: message,
          statusMessage: 'Pipeline failed.',
          pipeline: state.pipeline.map((stage) =>
            stage.status === 'running' ? { ...stage, status: 'error', details: [message] } : stage,
          ),
        }));
      }
    },

    dismissError() {
      set({ error: null });
    },
  };
});

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** Convenience selector — the numbers the results panel renders. */
export function selectHeadline(state: DesignStore): {
  thermal: ThermalComfort | null;
  metrics: DesignMetrics | null;
  score: number;
  cost: CostEstimate | null;
  comparison: DesignComparison | null;
  optimization: OptimizationResult | null;
} {
  return {
    thermal: state.currentThermal,
    metrics: state.metrics,
    score: state.score,
    cost: state.cost,
    comparison: state.comparison,
    optimization: state.optimization,
  };
}

export { DEFAULT_WEIGHTS };
