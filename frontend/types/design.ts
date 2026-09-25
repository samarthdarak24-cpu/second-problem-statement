/**
 * Application-state, pipeline and visualisation types.
 */

import type { BuildingParameters } from './building';
import type {
  ClimateAnalysis,
  ClimateData,
  Location,
} from './climate';
import type {
  DesignComparison,
  OptimizationResult,
  Recommendation,
} from './optimization';
import type { ThermalComfort } from './thermal';

/** Auto mode derives everything from climate; manual mode lets the user override. */
export type DesignMode = 'auto' | 'manual';

/** The nine 3D / 2D presentation modes. */
export type VisualizationMode =
  | 'normal'
  | 'heatmap'
  | 'airflow'
  | 'solar'
  | 'floorplan'
  | 'front'
  | 'side'
  | 'top'
  | 'walkthrough';

/** Camera poses, including the four orthographic-style elevations. */
export type CameraPreset = 'iso' | 'front' | 'side' | 'top' | 'walk';

/** A stage of the visible INPUT → OUTPUT pipeline. */
export type PipelineStageId =
  | 'input'
  | 'climate'
  | 'analysis'
  | 'thermal'
  | 'optimization'
  | 'parameters'
  | 'geometry'
  | 'results';

export type PipelineStageStatus = 'idle' | 'running' | 'done' | 'error';

/** Live status of one pipeline stage — rendered as the flow diagram. */
export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  /** One-line description of what the stage does. */
  description: string;
  status: PipelineStageStatus;
  /** Headline output value, e.g. "Hot semi-arid · 25.1 °C". */
  headline: string;
  /** Supporting detail lines. */
  details: string[];
  /** Wall-clock duration of the stage, ms. */
  durationMs?: number;
}

/** Which UI sections are open — kept in the store so layout survives re-renders. */
export interface PanelVisibility {
  climateSummary: boolean;
  recommendations: boolean;
  materials: boolean;
  comparison: boolean;
  charts: boolean;
  pipeline: boolean;
}

/** The complete design state held by the Zustand store. */
export interface DesignState {
  /* --- Mode --- */
  mode: DesignMode;
  /** True while the async pipeline is running. */
  isGenerating: boolean;
  /** Human-readable progress message. */
  statusMessage: string;
  /** Set when a stage fails. */
  error: string | null;

  /* --- Location & climate --- */
  location: Location | null;
  climateData: ClimateData | null;
  climateAnalysis: ClimateAnalysis | null;

  /* --- Design --- */
  baselineParameters: BuildingParameters;
  optimizedParameters: BuildingParameters;
  /** The live, editable parameters — what the 3D model renders. */
  currentParameters: BuildingParameters;
  /** True once the user has touched a slider, so we can show "modified". */
  isDirty: boolean;

  /* --- Results --- */
  baselineThermal: ThermalComfort | null;
  currentThermal: ThermalComfort | null;
  optimization: OptimizationResult | null;
  comparison: DesignComparison | null;
  recommendations: Recommendation[];

  /* --- Presentation --- */
  visualizationMode: VisualizationMode;
  cameraPreset: CameraPreset;
  /** Layer toggles independent of the main mode. */
  showShading: boolean;
  showFurniture: boolean;
  showLabels: boolean;
  showDimensions: boolean;
  showSunPath: boolean;
  /** Hour of day 0–24 used by the solar/heat analyses. */
  hourOfDay: number;
  /** Month 0–11 the analyses are evaluated at. */
  analysisMonth: number;
  /**
   * Day of `analysisMonth`, 1–31, that the solar study is evaluated on.
   *
   * Month alone is enough for the heat balance, which is a monthly-mean
   * calculation, but not for the shadow study: the sun's declination moves
   * about 0.4° a day, and over a month that is a visible change in where a
   * 0.8 m overhang puts its shadow. A shading device that works on the 21st of
   * June may not work on the 1st, and the user cannot tell which one they are
   * looking at unless the date is theirs to set.
   */
  dayOfMonth: number;

  panels: PanelVisibility;
  pipeline: PipelineStage[];
}
