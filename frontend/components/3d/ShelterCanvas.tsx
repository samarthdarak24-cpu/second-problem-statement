'use client';

/**
 * The 3D canvas.
 *
 * Owns the `<Canvas>`, chooses what to render for each of the nine
 * visualisation modes, and nothing else. Every input is a prop, so this can be
 * mounted twice (Before and After) without any shared state.
 *
 * The component is loaded with `next/dynamic({ ssr: false })` by its consumer:
 * Three.js touches `window` at import time, and rendering a WebGL canvas on the
 * server is meaningless anyway.
 */

import { Suspense, useEffect, useMemo, type MutableRefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as THREE from 'three';
import type {
  ClimateData,
  ResolvedMaterials,
  ShelterGeometry,
  VisualizationMode,
} from '@/types';
import { ShelterModel } from './ShelterModel';
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
  SkyDome,
} from './environment';
import { SOLAR_RAMP } from './palette';
import { computeSurfaceHeat } from '@/thermal/surfaceHeat';
import { createObjectUrl, triggerDownload } from '@/lib/exportHelpers';

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
  showFurniture?: boolean;
  showSunPath?: boolean;
  showGrid?: boolean;
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
  showFurniture = false,
  showSunPath = false,
  showGrid = true,
  showEnvironment = true,
  quality = 'high',
  interactive = true,
  exporterRef,
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

  const hiddenWalls = useMemo(() => wallsHiddenForMode(mode), [mode]);
  const walkMode = isWalkMode(mode);
  const preset = presetForMode(mode);

  const heatMode = mode === 'heatmap';
  const solarMode = mode === 'solar';

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

  return (
    <Canvas
      className={className}
      shadows="soft"
      dpr={profile.dpr}
      frameloop={interactive ? 'always' : 'demand'}
      camera={{ position: [radius * 1.5, radius * 1.1, radius * 1.6], fov: 42, near: 0.1, far: radius * 40 }}
      gl={{ antialias: profile.antialias, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
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
          <HumanScale position={figurePosition} rotationY={figureRotation} />
        ) : null}

        {!walkMode && (
          <CameraRig
            preset={preset}
            radius={radius}
            /* Total height, not one storey — see the `radius` note above. */
            buildingHeight={geometry.totalHeight}
            enabled={interactive}
          />
        )}

        <ShelterModel
          geometry={geometry}
          materials={materials}
          heatMode={heatMode}
          heatRange={surfaceHeat?.range ?? [0, 1]}
          heatRamp={heatMode ? undefined : SOLAR_RAMP}
          surfaceHeat={surfaceHeat?.bySurface}
          transparent={false}
          roofSegments={profile.roofSegments}
          showRoof={!hiddenWalls.includes('front') || mode !== 'top'}
          showPartitions={mode !== 'front' && mode !== 'side'}
          showFurniture={showFurniture}
          hiddenWalls={mode === 'front' || mode === 'side' ? [] : hiddenWalls}
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
  );
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
