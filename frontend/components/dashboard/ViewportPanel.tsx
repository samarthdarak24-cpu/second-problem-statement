'use client';

/**
 * The viewport.
 *
 * Owns the nine presentation modes, the camera presets and the layer toggles.
 *
 * The geometry rendered here is derived from `currentParameters` on every
 * change, by the *same* `buildShelterGeometry` the thermal model consumes. That
 * is the point: there is no separate "display model" that can drift away from
 * the model the numbers were computed for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Box,
  Compass,
  FileImage,
  FileText,
  Flame,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Route,
  Ruler,
  Sun,
  Tag,
  Video,
  Wind,
} from 'lucide-react';
import type { CameraPreset, VisualizationMode } from '@/types';
import { useDesignStore } from '@/store/designStore';
import { resolveMaterials } from '@/thermal/materials';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { computeSurfaceHeat } from '@/thermal/surfaceHeat';
import { solarPosition } from '@/utils/solar';
import { MONTH_LABELS, DAYS_IN_MONTH, dayOfYear } from '@/utils/units';
import { MODE_NOTE } from '@/lib/labels';
import { SOLAR_RAMP, rampCssGradient } from '@/components/3d/palette';
import { FloorPlanCanvas } from '@/components/2d/FloorPlanCanvas';
import { type RenderQuality, type SceneExporter } from '@/components/3d/ShelterCanvas';
import { printDesignReport, type DesignReportData } from '@/lib/report';
import { Chip, EmptyState, Meter, Panel, Segmented, Toggle } from '@/components/ui/primitives';
import { clockTime, num, pct } from '@/utils/format';
import { cn } from '@/lib/utils';

/* Three.js touches `window` at import time, so the canvas is client-only. */
const ShelterCanvas = dynamic(() => import('@/components/3d/ShelterCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="text-[13px] text-muted-foreground">Loading renderer…</span>
    </div>
  ),
});

const MODES: { value: VisualizationMode; label: string; icon: React.ReactNode }[] = [
  { value: 'normal', label: 'Normal', icon: <Box size={13} aria-hidden /> },
  { value: 'heatmap', label: 'Heat map', icon: <Flame size={13} aria-hidden /> },
  { value: 'airflow', label: 'Air flow', icon: <Wind size={13} aria-hidden /> },
  { value: 'solar', label: 'Solar', icon: <Sun size={13} aria-hidden /> },
  { value: 'floorplan', label: 'Plan', icon: <LayoutGrid size={13} aria-hidden /> },
  { value: 'front', label: 'Front', icon: <Ruler size={13} aria-hidden /> },
  { value: 'side', label: 'Side', icon: <Ruler size={13} aria-hidden /> },
  { value: 'top', label: 'Top', icon: <Compass size={13} aria-hidden /> },
  { value: 'walkthrough', label: 'Walk', icon: <Video size={13} aria-hidden /> },
];

const CAMERA_PRESETS: { value: CameraPreset; label: string }[] = [
  { value: 'iso', label: 'Iso' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'top', label: 'Top' },
  { value: 'walk', label: 'Walk' },
];

export function ViewportPanel() {
  const currentParameters = useDesignStore((state) => state.currentParameters);
  const climateData = useDesignStore((state) => state.climateData);
  const mode = useDesignStore((state) => state.visualizationMode);
  const setMode = useDesignStore((state) => state.setVisualizationMode);
  const designMode = useDesignStore((state) => state.mode);
  const cameraPreset = useDesignStore((state) => state.cameraPreset);
  const setCameraPreset = useDesignStore((state) => state.setCameraPreset);
  const hour = useDesignStore((state) => state.hourOfDay);
  const setHour = useDesignStore((state) => state.setHour);
  const month = useDesignStore((state) => state.analysisMonth);
  const setMonth = useDesignStore((state) => state.setMonth);
  const day = useDesignStore((state) => state.dayOfMonth);
  const setDay = useDesignStore((state) => state.setDay);
  const showShading = useDesignStore((state) => state.showShading);
  const showFurniture = useDesignStore((state) => state.showFurniture);
  const showLabels = useDesignStore((state) => state.showLabels);
  const showDimensions = useDesignStore((state) => state.showDimensions);
  const showSunPath = useDesignStore((state) => state.showSunPath);
  const toggleLayer = useDesignStore((state) => state.toggleLayer);
  const viewportExpanded = useDesignStore((state) => state.viewportExpanded);
  const toggleViewportExpanded = useDesignStore((state) => state.toggleViewportExpanded);

  /* Result-side state for the export report. These are the same numbers the
     Results panel renders, so the PDF cannot disagree with the on-screen model. */
  const score = useDesignStore((state) => state.score);
  const baselineScore = useDesignStore((state) => state.baselineScore);
  const metrics = useDesignStore((state) => state.metrics);
  const cost = useDesignStore((state) => state.cost);
  const comparison = useDesignStore((state) => state.comparison);
  /* The live thermal result carries the representative-day profile, which is
     what the report's required-outputs section prints. */
  const thermal = useDesignStore((state) => state.currentThermal);

  /* Render fidelity + an imperative handle to the WebGL context for export. */
  const [quality, setQuality] = useState<RenderQuality>('high');
  const exporterRef = useRef<SceneExporter | null>(null);

  /* Esc collapses the expanded viewport — matches the tooltip's promise and
     is the natural way out of a focus mode. Listener is attached only while
     expanded, so it cannot swallow Esc on other pages. */
  useEffect(() => {
    if (!viewportExpanded) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') toggleViewportExpanded();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewportExpanded, toggleViewportExpanded]);

  const stamp = (ext: string) => `thermal-shelter-${currentParameters.buildingType}-${ext}`;

  const handleExportPNG = () => exporterRef.current?.exportPNG(`${stamp('png')}`);
  const handleExportGLB = () => exporterRef.current?.exportGLB(`${stamp('glb')}`);
  const handleExportPDF = () => {
    if (!climateData) return;
    const report: DesignReportData = {
      location: climateData.location.city,
      climateType: climateData.climateType,
      mode: designMode,
      parameters: currentParameters,
      score,
      baselineScore,
      metrics,
      cost,
      comparison,
      thermal,
    };
    printDesignReport(report);
  };

  /* --- Geometry and materials: the same builders the thermal model uses --- */
  const materials = useMemo(() => resolveMaterials(currentParameters), [currentParameters]);
  const geometry = useMemo(
    () => buildShelterGeometry(currentParameters, materials),
    [currentParameters, materials],
  );

  /* --- Sun position for the selected date and hour ---
     The day matters: solar declination moves ~0.4° a day, which over a month is
     a visible change in where an overhang puts its shadow. Month alone would
     let a shading device look adequate on the 1st and fail on the 21st with no
     way for the user to tell which day they were shown. */
  const sun = useMemo(() => {
    const latitude = climateData?.location.latitude ?? 18.5;
    return solarPosition(latitude, dayOfYear(month, day), hour);
  }, [climateData, month, day, hour]);

  /* --- Heat map legend, computed with the same function the renderer uses --- */
  const surfaceHeat = useMemo(
    () =>
      mode === 'heatmap' && climateData
        ? computeSurfaceHeat(climateData, geometry, materials, month)
        : null,
    [mode, climateData, geometry, materials, month],
  );

  const glazingShare =
    geometry.wallArea > 0 ? geometry.glazingArea / geometry.wallArea : 0;

  return (
    <Panel
      title="3D shelter model"
      subtitle={MODE_NOTE[mode]}
      accent="optimize"
      className="min-h-0"
      bodyClassName="flex flex-col gap-2.5"
      right={
        <>
          <Chip tone="neutral" title="Window-to-wall ratio actually modelled">
            WWR {pct(glazingShare * 100)}
          </Chip>
          <Chip tone="neutral" title="Model orientation">
            {Math.round(currentParameters.orientation)}°
          </Chip>
          {/*
            Expand/collapse toggle.

            In expanded mode the page layout gives the viewport the full content
            width and the panel grows taller (see the `min-h` on the view
            container below), so the time sliders, layer toggles, camera
            presets and geometry chips that the default dock height clips all
            stay reachable. The icon flips between Maximize2 / Minimize2.
          */}
          <button
            type="button"
            onClick={toggleViewportExpanded}
            title={
              viewportExpanded
                ? 'Restore side panels (Esc)'
                : 'Expand the 3D viewport — hide side panels so the model fills the page'
            }
            aria-pressed={viewportExpanded}
            aria-label={viewportExpanded ? 'Collapse viewport' : 'Expand viewport'}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
              viewportExpanded
                ? 'border-primary/45 bg-primary/15 text-primary'
                : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {viewportExpanded ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
          </button>
        </>
      }
    >
      {/* ---------------- Mode tabs ---------------- */}
      <Segmented<VisualizationMode>
        options={MODES.map((m) => ({ ...m, title: MODE_NOTE[m.value] }))}
        value={mode}
        onChange={setMode}
      />

      {/* ---------------- Quality + export ---------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/30 px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Ruler size={13} aria-hidden />
          Quality
        </span>
        <Segmented<RenderQuality>
          options={[
            { value: 'low', label: 'Low' },
            { value: 'med', label: 'Med' },
            { value: 'high', label: 'High' },
          ]}
          value={quality}
          onChange={setQuality}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn-secondary" onClick={handleExportPNG} title="Save a PNG screenshot">
            <FileImage size={13} aria-hidden />
            PNG
          </button>
          <button type="button" className="btn-secondary" onClick={handleExportGLB} title="Export the model as a binary glTF">
            <Box size={13} aria-hidden />
            GLB
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExportPDF}
            disabled={!climateData}
            title="Open a printable PDF design report"
          >
            <FileText size={13} aria-hidden />
            PDF
          </button>
        </div>
      </div>

      {/* ---------------- The view ---------------- */}
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-md border bg-gradient-to-b from-[#F5F1EB] to-[#E4DCD1]',
          /* Expanded: tall canvas so the time sliders / camera / layer toggles
             below all stay reachable without scrolling the page. */
          viewportExpanded ? 'min-h-[640px]' : 'min-h-[380px]',
        )}
      >
        {climateData ? (
          mode === 'floorplan' ? (
            <FloorPlanCanvas
              geometry={geometry}
              showDimensions={showDimensions}
              showLabels={showLabels}
              showShading={showShading}
              className="h-full w-full"
            />
          ) : (
            <ShelterCanvas
              geometry={geometry}
              materials={materials}
              climate={climateData}
              mode={mode}
              month={month}
              hour={hour}
              sunAltitude={sun.altitude}
              sunAzimuth={sun.azimuth}
              airChangesPerHour={currentParameters.airChangesPerHour}
              showFurniture={showFurniture}
              showSunPath={showSunPath}
              showGrid
              quality={quality}
              interactive
              exporterRef={exporterRef}
              className="!absolute inset-0 h-full w-full"
            />
          )
        ) : (
          <EmptyState
            message="No climate loaded yet"
            hint="Choose a site and press Generate design to build the model."
          />
        )}

        {/* --- Overlay: sun readout --- */}
        {climateData && mode !== 'floorplan' ? (
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <span className="chip border-border/70 bg-panel/95 text-muted-foreground">
              {MONTH_LABELS[month]} {day} · {clockTime(hour)}
            </span>
            <span className="chip border-border/70 bg-panel/95 text-muted-foreground">
              sun {num(sun.altitude, 0)}° alt · {num(sun.azimuth, 0)}° az
            </span>
            {!sun.isDaylight ? (
              <span className="chip border-border/70 bg-panel/95 text-muted-foreground">
                below horizon
              </span>
            ) : null}
          </div>
        ) : null}

        {/* --- Overlay: heat map legend --- */}
        {surfaceHeat ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[190px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Absorbed solar
            </p>
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ background: rampCssGradient(SOLAR_RAMP, 10) }}
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
              <span>{num(surfaceHeat.range[0], 1)}</span>
              <span>kWh/m²/day</span>
              <span>{num(surfaceHeat.range[1], 1)}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
              {surfaceHeat.summary}
            </p>
          </div>
        ) : null}

        {/* --- Overlay: airflow readout --- */}
        {mode === 'airflow' && climateData ? (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border/70 bg-panel/95 px-2.5 py-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Ventilation
            </p>
            <p className="mt-0.5 text-[13px] text-foreground">
              {num(climateData.monthly[month]?.windSpeed ?? 0, 1)} m/s from{' '}
              {num(climateData.monthly[month]?.windDirection ?? 0, 0)}°
            </p>
            <p className="text-[12px] text-muted-foreground">
              design capacity {num(currentParameters.airChangesPerHour, 1)} ACH
            </p>
          </div>
        ) : null}
      </div>

      {/* ---------------- Time and layers ---------------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border bg-card/30 px-2.5 py-2">
        <label className="flex min-w-[190px] flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Hour
          </span>
          <input
            type="range"
            className="slider flex-1"
            min={0}
            max={24}
            step={0.5}
            value={hour}
            onChange={(event) => setHour(Number(event.target.value))}
            aria-label="Hour of day"
          />
          <span className="w-[42px] text-right text-[12px] font-semibold tabular-nums text-primary">
            {clockTime(hour)}
          </span>
        </label>

        <label className="flex min-w-[210px] flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Month
          </span>
          <input
            type="range"
            className="slider flex-1"
            min={0}
            max={11}
            step={1}
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            aria-label="Analysis month"
          />
          <span className="w-[32px] text-right text-[12px] font-semibold tabular-nums text-primary">
            {MONTH_LABELS[month]}
          </span>
        </label>

        <label className="flex min-w-[190px] flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Day
          </span>
          <input
            type="range"
            className="slider flex-1"
            min={1}
            max={DAYS_IN_MONTH[month] ?? 31}
            step={1}
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
            aria-label="Day of month"
          />
          <span className="w-[28px] text-right text-[12px] font-semibold tabular-nums text-primary">
            {day}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-1">
          <Toggle
            label="Shading"
            checked={showShading}
            onChange={() => toggleLayer('showShading')}
            title="Draw shading devices"
          />
          <Toggle
            label="Furniture"
            checked={showFurniture}
            onChange={() => toggleLayer('showFurniture')}
            title="Draw interior furniture"
          />
          <Toggle
            label="Labels"
            checked={showLabels}
            onChange={() => toggleLayer('showLabels')}
            title="Room labels on the plan"
          />
          <Toggle
            label="Dims"
            checked={showDimensions}
            onChange={() => toggleLayer('showDimensions')}
            title="Dimension chains on the plan"
          />
          <Toggle
            label="Sun path"
            checked={showSunPath}
            onChange={() => toggleLayer('showSunPath')}
            title="Overlay the sun's path for this month"
          />
        </div>
      </div>

      {/* ---------------- Camera presets + geometry readout ---------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Route size={13} aria-hidden />
            Camera
          </span>
          <Segmented<CameraPreset>
            options={CAMERA_PRESETS}
            value={cameraPreset}
            onChange={setCameraPreset}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="chip border-border/60 text-muted-foreground">
            <Tag size={11} aria-hidden />
            {num(geometry.floorArea, 1)} m² floor
          </span>
          <span className="chip border-border/60 text-muted-foreground">
            {num(geometry.volume, 0)} m³ volume
          </span>
          <span className="chip border-border/60 text-muted-foreground">
            {num(geometry.envelopeArea, 1)} m² envelope
          </span>
          <span className="chip border-border/60 text-muted-foreground">
            {geometry.walls.length} panels
          </span>
          <span className="chip border-border/60 text-muted-foreground">
            {geometry.shading.length} shading devices
          </span>
        </div>
      </div>

      {/* ---------------- Mode-specific footnote ---------------- */}
      {mode === 'heatmap' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          The heat map shows <span className="text-foreground">absorbed solar radiation</span> per
          surface for {MONTH_LABELS[month]} — a direct product of the solar geometry. Surface
          *temperature* would need a full three-dimensional radiation solve, which this model does
          not perform, so it is not shown.
        </p>
      ) : mode === 'walkthrough' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          Click the view to lock the pointer, then move with <b>W A S D</b> and look with the mouse.
          Press <b>Esc</b> to release. Movement is clamped to the interior.
        </p>
      ) : mode === 'normal' ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Meter
            value={glazingShare}
            label="Glazing share of wall area"
            right={pct(glazingShare * 100)}
          />
          <Meter
            value={Math.min(1, currentParameters.airChangesPerHour / 12)}
            label="Ventilation capacity"
            right={`${num(currentParameters.airChangesPerHour, 1)} ACH`}
          />
        </div>
      ) : null}
    </Panel>
  );
}
