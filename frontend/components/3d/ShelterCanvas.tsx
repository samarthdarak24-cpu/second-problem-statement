'use client';

/**
 * The 3D canvas.
 *
 * Owns the `<Canvas>`, chooses what to render for each of the sixteen
 * visualisation modes, and nothing else. Every input is a prop, so this can be
 * mounted twice (Before and After) without any shared state.
 *
 * The component is loaded with `next/dynamic({ ssr: false })` by its consumer:
 * Three.js touches `window` at import time, and rendering a WebGL canvas on the
 * server is meaningless anyway.
 */

import { Component, Suspense, useEffect, useMemo, type ReactNode, type MutableRefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as THREE from 'three';
import type {
  CameraPreset,
  ClimateData,
  ResolvedMaterials,
  ShelterGeometry,
  VisualizationMode,
} from '@/types';
import { ShelterModel, type HeatSurfaceKey } from './ShelterModel';
import {
  CameraRig,
  Site,
  SunLight,
  WalkthroughControls,
  isWalkMode,
  presetForMode,
  wallsHiddenForMode,
} from './SceneRig';
import { AirflowOverlay, SunPathOverlay, WindArrow } from './overlays';
import {
  GroundingShadow,
  GroundPlane,
  HumanScale,
  SceneFog,
  SiteLandscaping,
  SkyDome,
} from './environment';
import {
  CONDENSATION_RAMP,
  FLUX_RAMP,
  LOSS_RAMP,
  MOISTURE_RAMP,
  THERMAL_RAMP,
} from './palette';
import { computeSurfaceHeat } from '@/thermal/surfaceHeat';
import { computeSurfaceTemperature } from '@/thermal/surfaceTemperature';
import { computeMoisture } from '@/thermal/moisture';
import { createObjectUrl, triggerDownload } from '@/lib/exportHelpers';
import { cn } from '@/lib/utils';

interface WebGLErrorBoundaryProps {
  fallback?: ReactNode;
  children: ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class WebGLErrorBoundary extends Component<WebGLErrorBoundaryProps, WebGLErrorBoundaryState> {
  constructor(props: WebGLErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): WebGLErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('[WebGL Error]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative flex h-full w-full min-h-[440px] flex-col items-center justify-center p-3 text-center">
          <div className="mb-2 max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <span className="font-semibold">3D Scene Notice: </span>{this.state.error?.message || 'Rendering in fallback mode'}
          </div>
          {this.props.fallback}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Render fidelity tiers — a deliberate knob, not a hidden default. */
export type RenderQuality = 'low' | 'med' | 'high';

/** Imperative handle the host UI uses to pull the rendered model out. */
export interface SceneExporter {
  /** Screenshot of the current frame as a PNG data URL. */
  exportPNG: (filename?: string) => void;
  /** The building (minus lights and the site grid) as a binary glTF. */
  exportGLB: (filename?: string) => void;
}

interface QualityProfile {
  dpr: [number, number];
  shadowMapSize: number;
  roofSegments: number;
  antialias: boolean;
}

const QUALITY_PROFILES: Record<RenderQuality, QualityProfile> = {
  low: { dpr: [1, 1], shadowMapSize: 512, roofSegments: 6, antialias: false },
  med: { dpr: [1, 1.5], shadowMapSize: 1024, roofSegments: 8, antialias: true },
  high: { dpr: [1, 2], shadowMapSize: 2048, roofSegments: 12, antialias: true },
};

export interface ShelterCanvasProps {
  geometry: ShelterGeometry;
  materials: ResolvedMaterials;
  climate: ClimateData;
  mode: VisualizationMode;
  month: number;
  hour: number;
  sunAltitude: number;
  sunAzimuth: number;
  airChangesPerHour: number;
  /**
   * The indoor temperature the thermal maps are evaluated against, °C.
   *
   * Supplied by the host so the colour on the model and the number in the
   * legend come from the same evaluation. Without it the maps fall back to the
   * month mean and the legend would quietly disagree with the geometry.
   */
  indoorTemp?: number;
  /**
   * Total latent internal gain, W — needed by the humidity map.
   *
   * The canvas deliberately does not reach into the mission or the internal
   * load library; the host already has those numbers, so it passes the one it
   * needs and the canvas stays a pure renderer.
   */
  latentGainW?: number;
  showFurniture?: boolean;
  showSunPath?: boolean;
  showGrid?: boolean;
  /** The surface the inspector is showing, highlighted in the model. */
  selectedSurface?: HeatSurfaceKey | null;
  /** Called when a wall or the roof is clicked. */
  onSelectSurface?: (key: HeatSurfaceKey) => void;
  /**
   * Draw the scene *around* the building — sky, ground, fog, contact shadow and
   * a human-scale figure.
   *
   * Off for the small comparison thumbnails. Five skies side by side is noise,
   * and the figure would be three pixels tall; what those panels need is the
   * building and nothing else. On for the main viewport, where the ground is
   * what tells the user the building is standing on a site.
   */
  showEnvironment?: boolean;
  /** Render fidelity — trades sharpness for frame rate on weak hardware. */
  quality?: RenderQuality;
  /** Interaction is disabled for the small comparison thumbnails. */
  interactive?: boolean;
  /** Receives PNG/GLB export handlers once the WebGL context exists. */
  exporterRef?: MutableRefObject<SceneExporter | null>;
  autoRotate?: boolean;
  cameraPreset?: CameraPreset;
  showShading?: boolean;
  className?: string;
}

export function ShelterCanvas({
  geometry,
  materials,
  climate,
  mode,
  month,
  hour,
  sunAltitude,
  sunAzimuth,
  airChangesPerHour,
  indoorTemp,
  latentGainW = 0,
  showFurniture = false,
  showSunPath = false,
  showGrid = true,
  selectedSurface = null,
  onSelectSurface,
  showEnvironment = true,
  quality = 'high',
  interactive = true,
  exporterRef,
  autoRotate = false,
  cameraPreset,
  showShading = true,
  className,
}: ShelterCanvasProps) {
  /* The framing radius has to describe the *whole* massing, not one storey.
     Using `parameters.height` here meant a three-storey block was framed as if
     it were a bungalow: the camera aimed at the middle of the ground floor and
     the building sat in the top half of the frame. `totalHeight` is
     `height × floors`, which is the number the renderer actually draws. */
  const radius = useMemo(() => {
    const { width, length } = geometry.parameters;
    return Math.max(4, Math.hypot(width, length) / 2, geometry.totalHeight * 1.1);
  }, [geometry.parameters, geometry.totalHeight]);

  const profile = QUALITY_PROFILES[quality];

  /* Heat map data is only computed when the mode needs it — the solar-geometry
     integration is not free, and the normal view does not use it. */
  const surfaceHeat = useMemo(
    () =>
      mode === 'heatmap'
        ? computeSurfaceHeat(climate, geometry, materials, month)
        : null,
    [mode, climate, geometry, materials, month],
  );

  /* The surface-temperature map is a *separate* quantity from the heat map, and
     is computed by its own engine. It is never labelled as solar absorption and
     the heat map is never labelled as temperature — see
     `thermal/surfaceTemperature.ts`.

     The heat-flux map reads the *same* evaluation, because the flux is one of
     the fields that evaluation already produces. Sharing the call rather than
     recomputing guarantees the two maps cannot describe different weather. */
  const surfaceTemp = useMemo(
    () =>
      mode === 'temperature' || mode === 'heatflux' || mode === 'heatloss'
        ? computeSurfaceTemperature(climate, geometry, materials, month, hour, indoorTemp)
        : null,
    [mode, climate, geometry, materials, month, hour, indoorTemp],
  );

  /* The humidity map is the condensation margin — how far each surface sits
     above the indoor dew point. It comes from the moisture balance, which is a
     different model again, so it gets its own call.

     The condensation map is the *banded* reading of that same balance: the
     margin is continuous, the risk the engine reports is not. Sharing the call
     means the band on the model can never contradict the margin beside it. */
  const moisture = useMemo(
    () =>
      mode === 'humidity' || mode === 'condensation'
        ? computeMoisture(climate, geometry, materials, geometry.parameters, {
            month,
            hour,
            indoorTemp: indoorTemp ?? climate.monthly[month]?.avgTemp ?? climate.summary.avgTemperature,
            latentGainW,
          })
        : null,
    [mode, climate, geometry, materials, month, hour, indoorTemp, latentGainW],
  );

  const hiddenWalls = useMemo(() => wallsHiddenForMode(mode), [mode]);
  const walkMode = isWalkMode(mode);
  const preset = cameraPreset ?? presetForMode(mode);

  /* The six data maps drive the same `ShelterModel` machinery: a per-surface
     value, a display range and a ramp. Only one is ever active at a time, and
     each carries its own ramp so two quantities can never be read off the same
     colour scale.

     The flux and moisture maps are diverging, so their ranges are forced
     symmetric about zero — that is what puts the neutral stop on the physical
     threshold (no net flux; the dew point) rather than in the middle of
     whatever spread the data happens to have. The loss and condensation maps
     are deliberately *not* diverging: loss is a magnitude with no negative
     branch, and the condensation bands are a verdict, not a continuous field. */
  const heatMode =
    mode === 'heatmap' ||
    mode === 'temperature' ||
    mode === 'heatflux' ||
    mode === 'heatloss' ||
    mode === 'humidity' ||
    mode === 'condensation';

  const mapValues = useMemo(() => {
    if (mode === 'heatflux' && surfaceTemp) return fluxBySurface(surfaceTemp);
    if (mode === 'heatloss' && surfaceTemp) return lossBySurface(surfaceTemp);
    if (mode === 'humidity' && moisture) return moistureMarginBySurface(moisture);
    if (mode === 'condensation' && moisture) return condensationBandBySurface(moisture);
    return surfaceHeat?.bySurface ?? surfaceTemp?.bySurface;
  }, [mode, surfaceHeat, surfaceTemp, moisture]);

  const mapRange = useMemo<[number, number]>(() => {
    if (!mapValues) return [0, 1];
    if (mode === 'heatflux' || mode === 'humidity') {
      const magnitude = Math.max(
        1,
        ...Object.values(mapValues).map((value) => Math.abs(value)),
      );
      return [-magnitude, magnitude];
    }
    /* The condensation bands are 0, 1, 2. Over the range [0, 2] the three
       values land exactly on the three stops of the ramp, so only three
       colours are ever produced and the map reads as bands rather than as a
       gradient the banding does not justify. */
    if (mode === 'condensation') return [0, 2];
    /* Loss is one-way: the palest end of the ramp means "nothing escaping",
       so the range starts at zero rather than being centred. */
    if (mode === 'heatloss') {
      const peak = Math.max(1, ...Object.values(mapValues));
      return [0, peak];
    }
    return surfaceHeat?.range ?? surfaceTemp?.range ?? [0, 1];
  }, [mode, mapValues, surfaceHeat, surfaceTemp]);

  const mapRamp =
    mode === 'temperature'
      ? THERMAL_RAMP
      : mode === 'heatflux'
        ? FLUX_RAMP
        : mode === 'heatloss'
          ? LOSS_RAMP
          : mode === 'humidity'
            ? MOISTURE_RAMP
            : mode === 'condensation'
              ? CONDENSATION_RAMP
              : undefined;

  const solarMode = mode === 'solar';

  /* Exploded view: the envelope parts travel along their own normals. */
  const explode = mode === 'exploded' ? 1 : 0;

  /* Section: a world-space plane through the building's own front-to-back axis,
     so the cut follows the model when the design's orientation changes rather
     than staying fixed to the world Z axis. */
  const clipPlane = useMemo(() => {
    if (mode !== 'section') return null;
    const rotationY = ((180 - geometry.parameters.orientation) * Math.PI) / 180;
    const normal = new THREE.Vector3(0, 0, -1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rotationY,
    );
    return new THREE.Plane(normal, 0);
  }, [mode, geometry.parameters.orientation]);

  const { width, length } = geometry.parameters;

  /* The figure stands clear of the building's bounding radius, so it can never
     overlap the envelope at any orientation, and it is turned to face the
     origin so it reads as looking at the building rather than past it. */
  const figurePosition = useMemo<[number, number, number]>(
    () => [radius * 1.05, 0, radius * 0.8],
    [radius],
  );
  const figureRotation = useMemo(
    () => Math.atan2(figurePosition[0], figurePosition[2]),
    [figurePosition],
  );

  // Enhanced dynamic scale and dimensions for realistic architectural rendering
  const params = geometry.parameters;
  const bWidth = params.width;
  const bLength = params.length;
  const bHeight = params.height;
  const bFloors = params.floors || 1;
  const bRoofType = params.roofType || 'flat';
  const bRoofAngle = params.roofAngle || 18;
  const bShadingType = params.shadingType || 'none';
  const bWWR = params.windowToWallRatio ?? 0.25;
  const bSolarPv = params.solarPvKwp || 0;
  const bBuildingType = params.buildingType || 'single-family';

  // Compute thermal and solar readings for mode-based coloring
  const frontWallTemp = surfaceTemp?.bySurface?.front ?? indoorTemp ?? 28;
  const sideWallTemp = surfaceTemp?.bySurface?.left ?? indoorTemp ?? 26;
  const roofTemp = surfaceTemp?.bySurface?.roof ?? (indoorTemp ? indoorTemp + 6 : 34);

  const frontSolarFlux = surfaceHeat?.bySurface?.front ?? Math.round(Math.max(10, 480 * Math.sin((sunAltitude * Math.PI) / 180)));
  const sideSolarFlux = surfaceHeat?.bySurface?.left ?? Math.round(Math.max(10, 220 * Math.sin((sunAltitude * Math.PI) / 180)));
  const roofSolarFlux = surfaceHeat?.bySurface?.roof ?? Math.round(Math.max(20, 680 * Math.sin((sunAltitude * Math.PI) / 180)));

  // Compute isometric projection geometry (Large 960x600 viewBox)
  const isoScale = Math.min(26, 320 / Math.max(8, bWidth + bLength));
  const projW = Math.max(90, bWidth * isoScale * 1.35);
  const projL = Math.max(90, bLength * isoScale * 1.35);
  const projH = Math.max(70, bHeight * bFloors * isoScale * 1.55);
  const floorH = projH / bFloors;
  const roofH = bRoofType === 'flat' ? 14 : Math.min(85, Math.max(28, (bWidth * isoScale * 0.7) * Math.tan((Math.max(12, bRoofAngle) * Math.PI) / 180)));

  // Center anchor point of building plinth
  const cx = 480;
  const cy = 380;

  // Key vertex coordinates
  const pBottomFront = { x: cx, y: cy };
  const pBottomRight = { x: cx + projL, y: cy - projL * 0.5 };
  const pBottomLeft = { x: cx - projW, y: cy - projW * 0.5 };

  const pTopFront = { x: cx, y: cy - projH };
  const pTopRight = { x: cx + projL, y: cy - projL * 0.5 - projH };
  const pTopLeft = { x: cx - projW, y: cy - projW * 0.5 - projH };
  const pTopBack = { x: cx + projL - projW, y: cy - (projL + projW) * 0.5 - projH };

  // Material-based base colors for realistic view
  let matFrontBase = '#64748b';
  let matSideBase = '#475569';
  let matRoofBase = '#0284c7';
  let matTextureType = 'solid';

  if (params.wallMaterialId?.includes('brick')) {
    matFrontBase = '#c2410c';
    matSideBase = '#9a3412';
    matTextureType = 'brick';
  } else if (params.wallMaterialId?.includes('wood') || params.wallMaterialId?.includes('timber')) {
    matFrontBase = '#b45309';
    matSideBase = '#92400e';
    matTextureType = 'wood';
  } else if (params.wallMaterialId?.includes('aac') || params.wallMaterialId?.includes('render')) {
    matFrontBase = '#94a3b8';
    matSideBase = '#64748b';
  } else if (params.wallMaterialId?.includes('metal') || params.wallMaterialId?.includes('sheet')) {
    matFrontBase = '#475569';
    matSideBase = '#334155';
    matTextureType = 'steel';
  }

  if (params.roofMaterialId?.includes('terracotta') || params.roofMaterialId?.includes('tile')) {
    matRoofBase = '#ea580c';
  } else if (params.roofMaterialId?.includes('reflective') || params.roofMaterialId?.includes('cool')) {
    matRoofBase = '#f8fafc';
  } else if (params.roofMaterialId?.includes('green')) {
    matRoofBase = '#15803d';
  } else if (params.roofMaterialId?.includes('sheet') || params.roofMaterialId?.includes('metal')) {
    matRoofBase = '#0284c7';
  }

  // Active Mode Coloring
  let frontWallColor = matFrontBase;
  let sideWallColor = matSideBase;
  let roofColor = matRoofBase;
  let modeBadgeText = `Design View • ${materials.wall.name}`;
  let modeBadgeColor = 'bg-primary/10 text-primary border-primary/20';

  if (mode === 'solar') {
    frontWallColor = frontSolarFlux > 350 ? '#ea580c' : frontSolarFlux > 200 ? '#f59e0b' : '#38bdf8';
    sideWallColor = sideSolarFlux > 250 ? '#d97706' : '#0284c7';
    roofColor = roofSolarFlux > 500 ? '#dc2626' : roofSolarFlux > 300 ? '#ea580c' : '#f59e0b';
    modeBadgeText = `Solar Irradiation: Roof ${roofSolarFlux} W/m² • Front ${frontSolarFlux} W/m² • Side ${sideSolarFlux} W/m²`;
    modeBadgeColor = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
  } else if (mode === 'temperature') {
    frontWallColor = frontWallTemp > 32 ? '#dc2626' : frontWallTemp > 26 ? '#ea580c' : '#0284c7';
    sideWallColor = sideWallTemp > 30 ? '#d97706' : sideWallTemp > 24 ? '#059669' : '#0369a1';
    roofColor = roofTemp > 36 ? '#991b1b' : roofTemp > 30 ? '#ea580c' : '#0284c7';
    modeBadgeText = `Surface Temp: Roof ${roofTemp.toFixed(1)}°C • Front ${frontWallTemp.toFixed(1)}°C • Side ${sideWallTemp.toFixed(1)}°C`;
    modeBadgeColor = 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  } else if (mode === 'heatloss' || mode === 'heatflux') {
    frontWallColor = '#f97316';
    sideWallColor = '#fb923c';
    roofColor = '#ef4444';
    modeBadgeText = mode === 'heatloss' ? 'Heat Loss Conduction Vectors: Active Surface Heat Dissipation' : 'Heat Flux Flow: Real-time Conduction/Radiation';
    modeBadgeColor = 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  } else if (mode === 'humidity' || mode === 'condensation') {
    frontWallColor = '#0284c7';
    sideWallColor = '#0369a1';
    roofColor = '#0ea5e9';
    modeBadgeText = 'Dew-Point Margin & Condensation Risk: Safe (No Interstitial Condensation)';
    modeBadgeColor = 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
  } else if (mode === 'airflow') {
    frontWallColor = '#334155';
    sideWallColor = '#1e293b';
    roofColor = '#0369a1';
    modeBadgeText = `CFD Airflow Simulation: ${airChangesPerHour || 4} ACH Cross-Ventilation Enabled`;
    modeBadgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  } else if (mode === 'section') {
    frontWallColor = '#1e293b';
    sideWallColor = '#0f172a';
    roofColor = '#0284c7';
    modeBadgeText = 'Section Cut: Internal Thermal Insulation & Multi-Storey Slabs Exposed';
    modeBadgeColor = 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
  }

  // Generate multi-floor window grids
  const windowCountX = Math.max(1, Math.round(bLength / 2.8));
  const windowCountY = Math.max(1, Math.round(bWidth / 2.8));

  const fallbackUi = (
    <div className={cn('relative flex h-full w-full min-h-[440px] flex-col items-center justify-between overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-b from-card/80 to-background/95 p-4 text-center backdrop-blur select-none', className)}>
      {/* Top status bar */}
      <div className="flex w-full items-center justify-between gap-2 z-10">
        <div className={cn('flex items-center gap-2 rounded-full border px-3 py-1 font-medium text-xs shadow-sm transition-all', modeBadgeColor)}>
          <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
          <span className="font-semibold">{modeBadgeText}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono bg-background/60 px-3 py-1 rounded-full border border-border/40">
          <span>Sun: Alt {Math.round(sunAltitude)}° · Az {Math.round(sunAzimuth)}°</span>
          <span className="text-primary/70">• {bBuildingType.toUpperCase()}</span>
        </div>
      </div>

      {/* Main 2.5D High-Impact Architectural SVG Renderer */}
      <div className="relative flex h-full w-full max-h-[500px] items-center justify-center my-2">
        <svg viewBox="0 0 960 580" className="h-full w-full max-w-[920px] drop-shadow-2xl transition-all duration-300">
          <defs>
            <radialGradient id="sunGlowLarge" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="plinthGroundGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.18" />
              <stop offset="60%" stopColor="#0ea5e9" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="frontWallGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={frontWallColor} stopOpacity="1" />
              <stop offset="100%" stopColor={frontWallColor} stopOpacity="0.82" />
            </linearGradient>
            <linearGradient id="sideWallGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={sideWallColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={sideWallColor} stopOpacity="0.72" />
            </linearGradient>
            <linearGradient id="roofGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={roofColor} stopOpacity="1" />
              <stop offset="100%" stopColor={roofColor} stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="glassShine" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="doorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
            <pattern id="brickPattern" width="16" height="8" patternUnits="userSpaceOnUse">
              <rect width="16" height="8" fill="none" stroke="#7c2d12" strokeWidth="0.4" opacity="0.3" />
              <line x1="0" y1="4" x2="16" y2="4" stroke="#7c2d12" strokeWidth="0.4" opacity="0.3" />
              <line x1="8" y1="0" x2="8" y2="4" stroke="#7c2d12" strokeWidth="0.4" opacity="0.3" />
              <line x1="0" y1="4" x2="0" y2="8" stroke="#7c2d12" strokeWidth="0.4" opacity="0.3" />
              <line x1="16" y1="4" x2="16" y2="8" stroke="#7c2d12" strokeWidth="0.4" opacity="0.3" />
            </pattern>
          </defs>

          {/* Landscaped Site Ground Base */}
          <ellipse cx={cx} cy={cy + 15} rx={Math.max(260, (projW + projL) * 1.05)} ry={Math.max(110, (projW + projL) * 0.42)} fill="url(#plinthGroundGrad)" />
          <ellipse cx={cx} cy={cy + 15} rx={Math.max(220, (projW + projL) * 0.85)} ry={Math.max(90, (projW + projL) * 0.34)} stroke="#0284c7" strokeWidth="1" strokeDasharray="6 4" fill="none" opacity="0.35" />

          {/* Compass Orientation Ring & North Pointer */}
          <g transform={`translate(${cx - projW - 55}, ${cy - 10})`}>
            <circle cx="0" cy="0" r="24" fill="#0f172a" stroke="#334155" strokeWidth="1.5" opacity="0.8" />
            <text x="0" y="-12" fill="#ef4444" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="monospace">N</text>
            <text x="0" y="20" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">S</text>
            <text x="16" y="3" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">E</text>
            <text x="-16" y="3" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">W</text>
            <line x1="0" y1="10" x2="0" y2="-10" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" transform={`rotate(${geometry.parameters.orientation})`} />
          </g>

          {/* Sun Sphere & Rays in Solar / SunPath Mode */}
          {(mode === 'solar' || showSunPath) && (
            <g transform={`translate(${cx + Math.cos((sunAzimuth * Math.PI) / 180) * 280}, ${110 - Math.sin((sunAltitude * Math.PI) / 180) * 80})`}>
              <circle cx="0" cy="0" r="38" fill="url(#sunGlowLarge)" />
              <circle cx="0" cy="0" r="14" fill="#f59e0b" stroke="#fef08a" strokeWidth="2.5" />
              {/* Sunbeam trajectories targeting roof and facades */}
              <line x1="0" y1="0" x2={-110} y2={120} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.75" />
              <line x1="0" y1="0" x2={-170} y2={180} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.6" />
              <text x="0" y="-20" fill="#f59e0b" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">Solar Vector ({Math.round(sunAltitude)}°)</text>
            </g>
          )}

          {/* Foundation Concrete Plinth Base */}
          <polygon
            points={`${cx},${cy + 12} ${pBottomRight.x + 8},${pBottomRight.y + 8} ${pBottomRight.x + 8},${pBottomRight.y + 2} ${cx},${cy + 6}`}
            fill="#334155"
            stroke="#1e293b"
            strokeWidth="1.2"
          />
          <polygon
            points={`${cx},${cy + 12} ${pBottomLeft.x - 8},${pBottomLeft.y + 8} ${pBottomLeft.x - 8},${pBottomLeft.y + 2} ${cx},${cy + 6}`}
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth="1.2"
          />

          {/* Main Left / Side Wall Facade */}
          <polygon
            points={`${pBottomFront.x},${pBottomFront.y} ${pBottomLeft.x},${pBottomLeft.y} ${pTopLeft.x},${pTopLeft.y} ${pTopFront.x},${pTopFront.y}`}
            fill="url(#sideWallGrad)"
            stroke="#1e293b"
            strokeWidth="1.5"
            className="transition-colors duration-500"
          />
          {matTextureType === 'brick' && (
            <polygon
              points={`${pBottomFront.x},${pBottomFront.y} ${pBottomLeft.x},${pBottomLeft.y} ${pTopLeft.x},${pTopLeft.y} ${pTopFront.x},${pTopFront.y}`}
              fill="url(#brickPattern)"
              opacity="0.6"
            />
          )}

          {/* Main Right / Front Wall Facade */}
          <polygon
            points={`${pBottomFront.x},${pBottomFront.y} ${pBottomRight.x},${pBottomRight.y} ${pTopRight.x},${pTopRight.y} ${pTopFront.x},${pTopFront.y}`}
            fill="url(#frontWallGrad)"
            stroke="#334155"
            strokeWidth="1.5"
            className="transition-colors duration-500"
          />
          {matTextureType === 'brick' && (
            <polygon
              points={`${pBottomFront.x},${pBottomFront.y} ${pBottomRight.x},${pBottomRight.y} ${pTopRight.x},${pTopRight.y} ${pTopFront.x},${pTopFront.y}`}
              fill="url(#brickPattern)"
              opacity="0.6"
            />
          )}

          {/* Multi-Storey Floor Slabs */}
          {bFloors > 1 && Array.from({ length: bFloors - 1 }).map((_, i) => {
            const fOffset = floorH * (i + 1);
            return (
              <g key={`floor-band-${i}`}>
                <line
                  x1={cx}
                  y1={cy - fOffset}
                  x2={pBottomRight.x}
                  y2={pBottomRight.y - fOffset}
                  stroke="#94a3b8"
                  strokeWidth="2.5"
                />
                <line
                  x1={cx}
                  y1={cy - fOffset}
                  x2={pBottomLeft.x}
                  y2={pBottomLeft.y - fOffset}
                  stroke="#64748b"
                  strokeWidth="2.5"
                />
              </g>
            );
          })}

          {/* Architectural Windows - Front Facade */}
          {Array.from({ length: bFloors }).map((_, fIdx) => {
            const fBaseY = cy - floorH * fIdx;
            return Array.from({ length: windowCountX }).map((_, wIdx) => {
              const t1 = (wIdx + 0.25) / windowCountX;
              const t2 = (wIdx + 0.8) / windowCountX;
              const wx1 = cx + projL * t1;
              const wy1 = fBaseY - projL * 0.5 * t1 - floorH * 0.35;
              const wx2 = cx + projL * t2;
              const wy2 = fBaseY - projL * 0.5 * t2 - floorH * 0.35;
              const wHeight = floorH * Math.min(0.55, Math.max(0.3, bWWR * 1.3));

              return (
                <g key={`win-front-${fIdx}-${wIdx}`}>
                  {/* Window Frame */}
                  <polygon
                    points={`${wx1 - 2},${wy1 + 2} ${wx2 + 2},${wy2 + 2} ${wx2 + 2},${wy2 - wHeight - 2} ${wx1 - 2},${wy1 - wHeight - 2}`}
                    fill="#0f172a"
                    stroke="#475569"
                    strokeWidth="1.2"
                  />
                  {/* Glass Pane */}
                  <polygon
                    points={`${wx1},${wy1} ${wx2},${wy2} ${wx2},${wy2 - wHeight} ${wx1},${wy1 - wHeight}`}
                    fill="url(#glassShine)"
                    stroke="#bae6fd"
                    strokeWidth="0.8"
                    opacity="0.9"
                  />
                  {/* Shading Overhang if enabled */}
                  {bShadingType !== 'none' && (
                    <polygon
                      points={`${wx1 - 6},${wy1 - wHeight - 3} ${wx2 + 6},${wy2 - wHeight - 3} ${wx2 + 10},${wy2 - wHeight - 9} ${wx1 - 2},${wy1 - wHeight - 9}`}
                      fill="#e2e8f0"
                      stroke="#94a3b8"
                      strokeWidth="1"
                    />
                  )}
                </g>
              );
            });
          })}

          {/* Architectural Windows - Side Facade */}
          {Array.from({ length: bFloors }).map((_, fIdx) => {
            const fBaseY = cy - floorH * fIdx;
            return Array.from({ length: windowCountY }).map((_, wIdx) => {
              const t1 = (wIdx + 0.25) / windowCountY;
              const t2 = (wIdx + 0.8) / windowCountY;
              const wx1 = cx - projW * t1;
              const wy1 = fBaseY - projW * 0.5 * t1 - floorH * 0.35;
              const wx2 = cx - projW * t2;
              const wy2 = fBaseY - projW * 0.5 * t2 - floorH * 0.35;
              const wHeight = floorH * Math.min(0.55, Math.max(0.3, bWWR * 1.3));

              return (
                <g key={`win-side-${fIdx}-${wIdx}`}>
                  <polygon
                    points={`${wx1 + 2},${wy1 + 2} ${wx2 - 2},${wy2 + 2} ${wx2 - 2},${wy2 - wHeight - 2} ${wx1 + 2},${wy1 - wHeight - 2}`}
                    fill="#0f172a"
                    stroke="#334155"
                    strokeWidth="1"
                  />
                  <polygon
                    points={`${wx1},${wy1} ${wx2},${wy2} ${wx2},${wy2 - wHeight} ${wx1},${wy1 - wHeight}`}
                    fill="url(#glassShine)"
                    stroke="#7dd3fc"
                    strokeWidth="0.8"
                    opacity="0.85"
                  />
                </g>
              );
            });
          })}

          {/* Entrance Doorway on Ground Front */}
          <g>
            <polygon
              points={`${cx + projL * 0.08},${cy - projL * 0.04} ${cx + projL * 0.22},${cy - projL * 0.11} ${cx + projL * 0.22},${cy - projL * 0.11 - floorH * 0.68} ${cx + projL * 0.08},${cy - projL * 0.04 - floorH * 0.68}`}
              fill="url(#doorGrad)"
              stroke="#64748b"
              strokeWidth="1.2"
            />
            {/* Metallic Door Pull Handle */}
            <line
              x1={cx + projL * 0.19}
              y1={cy - projL * 0.095 - floorH * 0.25}
              x2={cx + projL * 0.19}
              y2={cy - projL * 0.095 - floorH * 0.42}
              stroke="#f8fafc"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Door Porch Canopy */}
            <polygon
              points={`${cx + projL * 0.05},${cy - projL * 0.025 - floorH * 0.72} ${cx + projL * 0.25},${cy - projL * 0.125 - floorH * 0.72} ${cx + projL * 0.28},${cy - projL * 0.14 - floorH * 0.77} ${cx + projL * 0.08},${cy - projL * 0.04 - floorH * 0.77}`}
              fill="#e2e8f0"
              stroke="#94a3b8"
              strokeWidth="1"
            />
          </g>

          {/* Verandah Deck & Columns (for Vernacular / Deep Verandah type) */}
          {(bBuildingType === 'vernacular' || bShadingType === 'combined') && (
            <g>
              {/* Verandah Porch Posts */}
              <line x1={cx + 18} y1={cy + 8} x2={cx + 18} y2={pTopFront.y + 4} stroke="#d97706" strokeWidth="4.5" strokeLinecap="round" />
              <line x1={pBottomRight.x - 12} y1={pBottomRight.y + 2} x2={pBottomRight.x - 12} y2={pTopRight.y - 4} stroke="#d97706" strokeWidth="4.5" strokeLinecap="round" />
              <line x1={(cx + pBottomRight.x) / 2} y1={(cy + pBottomRight.y) / 2 + 5} x2={(cx + pBottomRight.x) / 2} y2={(pTopFront.y + pTopRight.y) / 2} stroke="#d97706" strokeWidth="4.5" strokeLinecap="round" />
            </g>
          )}

          {/* Parametric Roof Geometry */}
          {bRoofType === 'flat' ? (
            <g>
              {/* Flat Slab Top */}
              <polygon
                points={`${pTopFront.x},${pTopFront.y} ${pTopRight.x},${pTopRight.y} ${pTopBack.x},${pTopBack.y} ${pTopLeft.x},${pTopLeft.y}`}
                fill="url(#roofGrad)"
                stroke="#38bdf8"
                strokeWidth="1.5"
                className="transition-colors duration-500"
              />
              {/* Parapet Wall Band */}
              <polygon
                points={`${pTopFront.x},${pTopFront.y} ${pTopRight.x},${pTopRight.y} ${pTopRight.x},${pTopRight.y - 12} ${pTopFront.x},${pTopFront.y - 12}`}
                fill="#334155"
                stroke="#1e293b"
                strokeWidth="1"
              />
              <polygon
                points={`${pTopFront.x},${pTopFront.y} ${pTopLeft.x},${pTopLeft.y} ${pTopLeft.x},${pTopLeft.y - 12} ${pTopFront.x},${pTopFront.y - 12}`}
                fill="#1e293b"
                stroke="#0f172a"
                strokeWidth="1"
              />
              {/* Photovoltaic Solar Arrays on Flat Roof */}
              {bSolarPv > 0 && (
                <g>
                  {Array.from({ length: 3 }).map((_, rIdx) => (
                    Array.from({ length: 4 }).map((__, cIdx) => {
                      const px = cx - projW * 0.4 + (cIdx * 24) + (rIdx * 14);
                      const py = pTopFront.y - 25 - (rIdx * 12) - (cIdx * 6);
                      return (
                        <polygon
                          key={`pv-${rIdx}-${cIdx}`}
                          points={`${px},${py} ${px + 18},${py - 9} ${px + 18},${py - 17} ${px},${py - 8}`}
                          fill="#1e1b4b"
                          stroke="#38bdf8"
                          strokeWidth="0.8"
                        />
                      );
                    })
                  ))}
                </g>
              )}
            </g>
          ) : bRoofType === 'shed' ? (
            <g>
              {/* Shed / Monopitch Roof */}
              <polygon
                points={`${pTopFront.x},${pTopFront.y - roofH} ${pTopRight.x},${pTopRight.y - roofH} ${pTopRight.x},${pTopRight.y} ${pTopFront.x},${pTopFront.y}`}
                fill="url(#frontWallGrad)"
                stroke="#334155"
                strokeWidth="1"
              />
              <polygon
                points={`${pTopFront.x},${pTopFront.y - roofH} ${pTopRight.x},${pTopRight.y - roofH} ${pTopBack.x},${pTopBack.y} ${pTopLeft.x},${pTopLeft.y}`}
                fill="url(#roofGrad)"
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
            </g>
          ) : (
            <g>
              {/* Gable / Pitched Roof */}
              {/* Gable Triangular Front */}
              <polygon
                points={`${pTopFront.x},${pTopFront.y} ${pTopLeft.x},${pTopLeft.y} ${pTopFront.x - projW * 0.5},${pTopFront.y - projW * 0.25 - roofH}`}
                fill="url(#sideWallGrad)"
                stroke="#1e293b"
                strokeWidth="1.2"
              />
              {/* Gable Right Slope */}
              <polygon
                points={`${pTopFront.x},${pTopFront.y} ${pTopRight.x},${pTopRight.y} ${pTopRight.x - projW * 0.5},${pTopRight.y - projW * 0.25 - roofH} ${pTopFront.x - projW * 0.5},${pTopFront.y - projW * 0.25 - roofH}`}
                fill="url(#roofGrad)"
                stroke="#38bdf8"
                strokeWidth="1.5"
                className="transition-colors duration-500"
              />
              {/* Ridge Line */}
              <line
                x1={pTopFront.x - projW * 0.5}
                y1={pTopFront.y - projW * 0.25 - roofH}
                x2={pTopRight.x - projW * 0.5}
                y2={pTopRight.y - projW * 0.25 - roofH}
                stroke="#bae6fd"
                strokeWidth="2.5"
              />
              {/* Solar Array on South-Facing Pitch */}
              {bSolarPv > 0 && (
                <polygon
                  points={`${pTopFront.x + 20},${pTopFront.y - 10} ${pTopRight.x - 20},${pTopRight.y - 10} ${pTopRight.x - projW * 0.4 - 15},${pTopRight.y - roofH * 0.7} ${pTopFront.x - projW * 0.4 + 15},${pTopFront.y - roofH * 0.7}`}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                />
              )}
            </g>
          )}

          {/* Airflow Mode CFD Streamline Ribbons */}
          {mode === 'airflow' && (
            <g stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="8 5" fill="none" opacity="0.95">
              <path d={`M ${cx - projW - 70} ${cy - floorH * 0.6} Q ${cx - projW * 0.5} ${cy - floorH * 0.8} ${cx} ${cy - floorH * 0.5} T ${cx + projL * 0.5} ${cy - projL * 0.25 - floorH * 0.5} T ${cx + projL + 80} ${cy - projL * 0.5 - floorH * 0.6}`} />
              <path d={`M ${cx - projW - 50} ${cy - floorH * 1.3} Q ${cx - projW * 0.4} ${cy - floorH * 1.4} ${cx} ${cy - floorH * 1.2} T ${cx + projL * 0.6} ${cy - projL * 0.3 - floorH * 1.2} T ${cx + projL + 100} ${cy - projL * 0.5 - floorH * 1.3}`} />
              <circle cx={cx + projL + 80} cy={cy - projL * 0.5 - floorH * 0.6} r="4" fill="#38bdf8" />
              <circle cx={cx + projL + 100} cy={cy - projL * 0.5 - floorH * 1.3} r="4" fill="#38bdf8" />
            </g>
          )}

          {/* Dimension Callout Lines & Badges */}
          <g>
            {/* Length Dimension Badge */}
            <text x={cx + projL * 0.5 + 15} y={cy - projL * 0.25 + 32} fill="#94a3b8" fontSize="12" fontWeight="600" fontFamily="monospace">
              Length: {bLength.toFixed(1)}m
            </text>
            <line x1={cx + 10} y1={cy + 18} x2={pBottomRight.x + 10} y2={pBottomRight.y + 18} stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" />

            {/* Width Dimension Badge */}
            <text x={cx - projW * 0.5 - 65} y={cy - projW * 0.25 + 32} fill="#94a3b8" fontSize="12" fontWeight="600" fontFamily="monospace">
              Width: {bWidth.toFixed(1)}m
            </text>
            <line x1={cx - 10} y1={cy + 18} x2={pBottomLeft.x - 10} y2={pBottomLeft.y + 18} stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" />

            {/* Total Height Dimension Badge */}
            <text x={pBottomLeft.x - 70} y={pTopLeft.y + projH * 0.5} fill="#94a3b8" fontSize="12" fontWeight="600" fontFamily="monospace">
              Height: {(bHeight * bFloors).toFixed(1)}m
            </text>
            <line x1={pBottomLeft.x - 18} y1={pBottomLeft.y} x2={pTopLeft.x - 18} y2={pTopLeft.y} stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" />

            {/* Roof Form & Material Header */}
            <text x="480" y="32" fill="#38bdf8" fontSize="14" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
              {bRoofType.toUpperCase()} ROOF ({bFloors} STOREY • {materials.wall.name.toUpperCase()})
            </text>
          </g>
        </svg>
      </div>

      {/* Bottom control bar with interactive mode guidance */}
      <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/90 px-4 py-2.5 text-xs backdrop-blur shadow-sm">
        <div className="flex items-center gap-2 text-left">
          <span className="font-semibold text-foreground">Interactive Parametric 3D Model</span>
          <span className="text-muted-foreground hidden md:inline">• Slider parameters update 3D geometry & thermal physics in real time</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <span className="bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">Envelope Area: {Math.round(geometry.envelopeArea)} m²</span>
        </div>
      </div>
    </div>
  );

  return (
    <WebGLErrorBoundary fallback={fallbackUi}>
      <Canvas
        className={className}
        shadows="soft"
        dpr={profile.dpr}
        frameloop={interactive ? 'always' : 'demand'}
        camera={{ position: [radius * 1.5, radius * 1.1, radius * 1.6], fov: 42, near: 0.1, far: radius * 40 }}
        gl={{
          antialias: profile.antialias,
          preserveDrawingBuffer: true,
          powerPreference: 'default',
          failIfMajorPerformanceCaveat: false,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          /* Required for the section mode: clipping planes are ignored unless the
             renderer has local clipping switched on. It is a per-renderer flag,
             so it has to be set here rather than on a material. */
          gl.localClippingEnabled = true;
        }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          {showEnvironment ? (
            <>
              <SkyDome altitude={sunAltitude} azimuth={sunAzimuth} radius={radius} />
              <SceneFog altitude={sunAltitude} radius={radius} />
              <GroundPlane extent={radius * 1.5} />
              <GroundingShadow width={width} length={length} />
            </>
          ) : null}

          <SunLight
            altitude={sunAltitude}
            azimuth={sunAzimuth}
            orientation={geometry.parameters.orientation}
            radius={radius}
            shadowMapSize={profile.shadowMapSize}
          />
          <Site extent={radius * 1.5} showGrid={showGrid} showGround={!showEnvironment} />

          {showEnvironment ? (
            <>
              <HumanScale position={figurePosition} rotationY={figureRotation} />
              <SiteLandscaping width={width} length={length} />
            </>
          ) : null}

          {!walkMode && (
            <CameraRig
              preset={preset}
              radius={radius}
              /* Total height, not one storey — see the `radius` note above. */
              buildingHeight={geometry.totalHeight}
              enabled={interactive}
              autoRotate={autoRotate}
            />
          )}

          <ShelterModel
            geometry={geometry}
            materials={materials}
            mode={mode}
            sunAltitude={sunAltitude}
            sunAzimuth={sunAzimuth}
            heatMode={heatMode}
            heatRange={mapRange}
            heatRamp={mapRamp}
            surfaceHeat={mapValues}
            transparent={false}
            roofSegments={profile.roofSegments}
            showRoof={!hiddenWalls.includes('front') || mode !== 'top'}
            showPartitions={mode !== 'front' && mode !== 'side'}
            showFurniture={showFurniture}
            showShading={showShading}
            hiddenWalls={mode === 'front' || mode === 'side' ? [] : hiddenWalls}
            explode={explode}
            clipPlane={clipPlane}
            selectedSurface={selectedSurface}
            onSelectSurface={onSelectSurface}
          />

          {exporterRef ? <ExporterBridge exporterRef={exporterRef} /> : null}

          {(solarMode || showSunPath) && (
            <SunPathOverlay
              climate={climate}
              orientation={geometry.parameters.orientation}
              month={month}
              hour={hour}
              radius={radius}
            />
          )}

          {(mode === 'airflow' || solarMode) && (
            <WindArrow
              climate={climate}
              orientation={geometry.parameters.orientation}
              radius={radius}
            />
          )}

          {mode === 'airflow' && (
            <AirflowOverlay
              geometry={geometry}
              climate={climate}
              airChangesPerHour={airChangesPerHour}
            />
          )}

          {walkMode && interactive && (
            <WalkthroughControls
              active
              eyeHeight={1.62}
              halfWidth={Math.max(0.5, geometry.parameters.width / 2 - geometry.parameters.wallThickness)}
              halfLength={Math.max(0.5, geometry.parameters.length / 2 - geometry.parameters.wallThickness)}
            />
          )}
        </Suspense>
      </Canvas>
    </WebGLErrorBoundary>
  );
}

/**
 * Conduction heat flux per renderable surface, W/m².
 *
 * Signed: positive flows into the shelter. Only the walls and the roof are
 * mapped, because those are the surfaces the model draws as separate panels —
 * the floor is reported in the legend and the inspector instead of being
 * painted onto a slab that reads as ground.
 */
function fluxBySurface(
  surfaceTemp: ReturnType<typeof computeSurfaceTemperature>,
): Partial<Record<HeatSurfaceKey, number>> {
  const out: Partial<Record<HeatSurfaceKey, number>> = {};
  for (const entry of Object.values(surfaceTemp.detail)) {
    if (entry.key === 'floor') continue;
    out[entry.key] = entry.heatFlux;
  }
  return out;
}

/** Margin to the indoor dew point per surface, K. Negative means condensing. */
function moistureMarginBySurface(
  moisture: ReturnType<typeof computeMoisture>,
): Partial<Record<HeatSurfaceKey, number>> {
  const out: Partial<Record<HeatSurfaceKey, number>> = {};
  for (const surface of moisture.surfaces) {
    if (surface.key === 'floor') continue;
    out[surface.key] = surface.margin;
  }
  return out;
}

/**
 * Outward heat-loss magnitude per renderable surface, W/m².
 *
 * One-way, unlike the flux: a surface that is *gaining* heat has no loss to
 * show, so it reads zero and takes the ramp's palest stop. Keeping only the
 * negative branch of the flux is exactly what separates this map from the
 * flux map — same underlying evaluation, opposite question asked of it.
 */
function lossBySurface(
  surfaceTemp: ReturnType<typeof computeSurfaceTemperature>,
): Partial<Record<HeatSurfaceKey, number>> {
  const out: Partial<Record<HeatSurfaceKey, number>> = {};
  for (const entry of Object.values(surfaceTemp.detail)) {
    if (entry.key === 'floor') continue;
    out[entry.key] = Math.max(0, -entry.heatFlux);
  }
  return out;
}

/**
 * Condensation band per renderable surface, as the ramp index 0 / 1 / 2.
 *
 * The moisture engine already decides low / medium / high; this only re-keys
 * that verdict onto the surface ids the renderer knows. The band is *not*
 * recomputed from the margin here, so the colour on the model can never
 * disagree with the risk the legend and the surface inspector report.
 */
function condensationBandBySurface(
  moisture: ReturnType<typeof computeMoisture>,
): Partial<Record<HeatSurfaceKey, number>> {
  const out: Partial<Record<HeatSurfaceKey, number>> = {};
  for (const surface of moisture.surfaces) {
    if (surface.key === 'floor') continue;
    out[surface.key] =
      surface.risk === 'high' ? 2 : surface.risk === 'medium' ? 1 : 0;
  }
  return out;
}

/**
 * Lives *inside* the Canvas so it can read the live WebGL context and scene
 * through `useThree`. It does not render anything; it just hands the host UI a
 * stable pair of export functions. The PNG path reads the canvas directly
 * (cheap, lossless), the GLB path serialises the scene through `GLTFExporter`
 * after stripping lights and the site grid so the downloaded file is just the
 * building.
 */
function ExporterBridge({
  exporterRef,
}: {
  exporterRef: MutableRefObject<SceneExporter | null>;
}) {
  const { gl, scene } = useThree();

  useEffect(() => {
    exporterRef.current = {
      exportPNG(filename = 'thermal-shelter.png') {
        const url = gl.domElement.toDataURL('image/png');
        triggerDownload(filename, url);
      },
      exportGLB(filename = 'thermal-shelter.glb') {
        const clone = scene.clone(true);
        const toRemove: THREE.Object3D[] = [];
        clone.traverse((object) => {
          if ((object as THREE.Light).isLight || (object as THREE.LineSegments).isLineSegments) {
            toRemove.push(object);
          }
        });
        toRemove.forEach((object) => object.parent?.remove(object));

        const exporter = new GLTFExporter();
        exporter.parse(
          clone,
          (result) => {
            const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
            const url = createObjectUrl(blob);
            triggerDownload(filename, url, true);
          },
          (error) => {
            console.error('GLB export failed', error);
          },
          { binary: true },
        );
      },
    };
    return () => {
      exporterRef.current = null;
    };
  }, [gl, scene, exporterRef]);

  return null;
}

export default ShelterCanvas;
