'use client';

/**
 * The viewport.
 *
 * Owns the sixteen presentation modes, the camera presets and the layer toggles.
 *
 * The geometry rendered here is derived from `currentParameters` on every
 * change, by the *same* `buildShelterGeometry` the thermal model consumes. That
 * is the point: there is no separate "display model" that can drift away from
 * the model the numbers were computed for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowDownUp,
  Box,
  CloudFog,
  Compass,
  Droplets,
  FileImage,
  FileText,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Route,
  Ruler,
  Scissors,
  Sun,
  Tag,
  Thermometer,
  TrendingDown,
  Video,
  Wind,
  RotateCw,
} from 'lucide-react';
import type { CameraPreset, VisualizationMode } from '@/types';
import { useDesignStore } from '@/store/designStore';
import { resolveMaterials } from '@/thermal/materials';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { computeSurfaceHeat } from '@/thermal/surfaceHeat';
import { computeSurfaceTemperature } from '@/thermal/surfaceTemperature';
import { computeMoisture } from '@/thermal/moisture';
import { computeHeatLossBreakdown } from '@/thermal/heatLoss';
import { computeInternalLoads } from '@/lib/internalLoads';
import { isMissionProfileId, missionProfile } from '@/lib/missions';
import { solarPosition } from '@/utils/solar';
import { MONTH_LABELS, DAYS_IN_MONTH, dayOfYear } from '@/utils/units';
import { MODE_LABEL, MODE_NOTE } from '@/lib/labels';
import {
  CONDENSATION_BANDS,
  CONDENSATION_RAMP,
  FLUX_RAMP,
  LOSS_RAMP,
  MOISTURE_RAMP,
  SOLAR_RAMP,
  THERMAL_RAMP,
  rampCssGradient,
} from '@/components/3d/palette';
import { FloorPlanCanvas } from '@/components/2d/FloorPlanCanvas';
import { SurfaceInspector } from '@/components/dashboard/SurfaceInspector';
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

/* ------------------------------------------------------------------ */
/* Visualization modes — grouped                                       */
/* ------------------------------------------------------------------ */
/*
 * There are sixteen modes, and they were previously rendered as a single
 * flat `Segmented` row of sixteen tabs. At that width they became a wall
 * of unreadable micro-buttons, and four of them (`front`, `side`, `top`,
 * `walkthrough`) duplicated the camera presets that already existed
 * lower down the panel — the same thing reachable two different ways.
 *
 * The split below separates two genuinely different ideas:
 *
 *   · ANALYSIS — data mapped onto the envelope. These are the modes a
 *     reviewer switches between while reading the numbers, so they stay
 *     as always-visible tabs.
 *   · Everything else — how the model is *composed* (exploded, section),
 *     what context is drawn around it (sun path, airflow), and which
 *     direction it is viewed from. Less frequently used mid-analysis, so
 *     they live behind one labelled dropdown.
 *
 * No mode was removed and the store's `VisualizationMode` union is
 * untouched — every value is still reachable.
 */

/** Modes that map a computed quantity onto the envelope. Always visible. */
const ANALYSIS_MODES: { value: VisualizationMode; label: string; icon: React.ReactNode }[] = [
  { value: 'normal', label: 'Normal', icon: <Box size={13} aria-hidden /> },
  { value: 'heatmap', label: 'Solar', icon: <Sun size={13} aria-hidden /> },
  { value: 'temperature', label: 'Temp', icon: <Thermometer size={13} aria-hidden /> },
  { value: 'heatloss', label: 'Loss', icon: <TrendingDown size={13} aria-hidden /> },
  { value: 'heatflux', label: 'Flux', icon: <ArrowDownUp size={13} aria-hidden /> },
  { value: 'humidity', label: 'Moisture', icon: <Droplets size={13} aria-hidden /> },
  { value: 'condensation', label: 'Condense', icon: <CloudFog size={13} aria-hidden /> },
];

/** Composition, context and viewing direction — grouped for the dropdown. */
const MORE_MODE_GROUPS: {
  label: string;
  options: { value: VisualizationMode; label: string; icon: React.ReactNode }[];
}[] = [
  {
    label: 'Composition',
    options: [
      { value: 'exploded', label: 'Exploded view', icon: <Layers size={13} aria-hidden /> },
      { value: 'section', label: 'Section cut', icon: <Scissors size={13} aria-hidden /> },
    ],
  },
  {
    label: 'Site context',
    options: [
      { value: 'airflow', label: 'Air flow', icon: <Wind size={13} aria-hidden /> },
      { value: 'solar', label: 'Sun path', icon: <Sun size={13} aria-hidden /> },
      { value: 'floorplan', label: 'Dimensioned plan', icon: <LayoutGrid size={13} aria-hidden /> },
    ],
  },
  {
    label: 'View',
    options: [
      { value: 'front', label: 'Front elevation', icon: <Ruler size={13} aria-hidden /> },
      { value: 'side', label: 'Side elevation', icon: <Ruler size={13} aria-hidden /> },
      { value: 'top', label: 'Roof plan', icon: <Compass size={13} aria-hidden /> },
      { value: 'walkthrough', label: 'Walkthrough', icon: <Video size={13} aria-hidden /> },
    ],
  },
];

/** Flat lookup so the dropdown can show the active mode's own label. */
const MORE_MODES = MORE_MODE_GROUPS.flatMap((g) => g.options);
const MORE_MODE_BY_VALUE = new Map(MORE_MODES.map((m) => [m.value, m]));
const ANALYSIS_VALUES = new Set(ANALYSIS_MODES.map((m) => m.value));

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
  /* The inspector's selection lives in the store so it survives a mode change —
     pick a wall in Normal view, switch to the temperature map, and the same
     surface stays selected. That comparison is the point of the panel. */
  const selectedSurface = useDesignStore((state) => state.selectedSurface);
  const setSelectedSurface = useDesignStore((state) => state.setSelectedSurface);
  /* The floor is inspectable but is not a panel in the model, so it has nothing
     to highlight. The canvas is told "nothing selected" rather than being given
     a key it cannot draw. */
  const highlightedSurface = selectedSurface === 'floor' ? null : selectedSurface;

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
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
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
      /* The defence sections need the climate, geometry and materials; without
         them the report still prints, minus those sections. */
      climate: climateData,
      geometry,
      materials,
      analysisMonth: month,
      analysisHour: hour,
      climateSource: climateData.source,
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

  /* The indoor temperature the thermal maps are evaluated against. It comes
     from the live thermal result so the map, the legend and the heat balance
     all describe the same hour — passing it into the canvas as well as using it
     here is what stops the colour and the number disagreeing. */
  const indoorTemp =
    thermal?.dailyProfile.points[Math.round(hour) % 24]?.indoorTemp ?? thermal?.indoorTemperature;

  /* Total latent internal gain, for the humidity map. Read from the mission and
     the load library the same way the brief page does, so the two agree. */
  const latentGainW = useMemo(() => {
    const mission = isMissionProfileId(currentParameters.missionProfile)
      ? missionProfile(currentParameters.missionProfile)
      : null;
    return computeInternalLoads(
      currentParameters.numOccupants,
      mission?.activityMet ?? 1.2,
      currentParameters.internalLoads ?? [],
      geometry.floorArea,
    ).totalLatentW;
  }, [currentParameters, geometry.floorArea]);

  /* --- Surface temperature, heat flux and heat loss share one evaluation,
     because both of the derived quantities are fields that evaluation already
     produces. Computing it once is what guarantees the three legends describe
     the same weather. --- */
  const surfaceThermal = useMemo(
    () =>
      (mode === 'temperature' || mode === 'heatflux' || mode === 'heatloss') && climateData
        ? computeSurfaceTemperature(climateData, geometry, materials, month, hour, indoorTemp)
        : null,
    [mode, climateData, geometry, materials, month, hour, indoorTemp],
  );
  const surfaceTemp = mode === 'temperature' ? surfaceThermal : null;
  const surfaceFlux = mode === 'heatflux' ? surfaceThermal : null;
  const surfaceLoss = mode === 'heatloss' ? surfaceThermal : null;

  /* --- Humidity and condensation legends. Both read the same moisture
     balance; the first shows the continuous margin, the second the banded
     verdict the engine already reached from it. --- */
  const moisture = useMemo(
    () =>
      (mode === 'humidity' || mode === 'condensation') && climateData
        ? computeMoisture(climateData, geometry, materials, currentParameters, {
            month,
            hour,
            indoorTemp:
              indoorTemp ??
              climateData.monthly[month]?.avgTemp ??
              climateData.summary.avgTemperature,
            latentGainW,
          })
        : null,
    [mode, climateData, geometry, materials, currentParameters, month, hour, indoorTemp, latentGainW],
  );
  const condensation = mode === 'condensation' ? moisture : null;

  /* --- Heat-loss breakdown, for the loss legend. Read from the live thermal
     result so the shares beside the model are the same numbers the charts and
     the brief page show — nothing is recomputed from the geometry here. --- */
  const heatLoss = useMemo(
    () =>
      mode === 'heatloss' && thermal
        ? computeHeatLossBreakdown(thermal.dailyProfile, currentParameters, geometry)
        : null,
    [mode, thermal, currentParameters, geometry],
  );

  /* Peak loss rate on any surface — the dark end of the loss ramp. */
  const maxLoss = surfaceLoss
    ? Math.max(
        0,
        ...Object.values(surfaceLoss.detail).map((entry) => Math.max(0, -entry.heatFlux)),
      )
    : 0;

  /* The loss paths, biggest first, which is the order a reader wants them in. */
  const rankedLoss = heatLoss
    ? [...heatLoss.components]
        .filter((component) => component.lossKwh > 0)
        .sort((a, b) => b.lossKwh - a.lossKwh)
        .slice(0, 5)
    : [];

  /* How many surfaces fall in each band, so the legend reports the map. */
  const condensationBands = condensation
    ? (['low', 'medium', 'high'] as const).map((band) => ({
        band,
        count: condensation.surfaces.filter((surface) => surface.risk === band).length,
      }))
    : [];

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
      {/* ---------------- Mode control ---------------- */}
      {/* Two tiers: the analysis modes as tabs, everything else in one
         grouped dropdown. See the "Visualization modes — grouped"
         comment above for why. */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<VisualizationMode>
          options={ANALYSIS_MODES.map((m) => ({ ...m, title: MODE_NOTE[m.value] }))}
          value={mode}
          onChange={setMode}
        />

        <label className="flex items-center gap-1.5">
          <span className="sr-only">More visualization modes</span>
          <select
            aria-label="More visualization modes"
            value={ANALYSIS_VALUES.has(mode) ? '' : mode}
            onChange={(event) => {
              const next = event.target.value;
              if (next) setMode(next as VisualizationMode);
            }}
            title={MODE_NOTE[mode]}
            className={cn(
              'rounded-md border bg-card/40 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              ANALYSIS_VALUES.has(mode)
                ? 'text-muted-foreground'
                : 'border-primary/45 bg-primary/10 text-primary',
            )}
          >
            {/* Shown when the active mode lives in the dropdown, so the
               control always reports the true state. */}
            <option value="">
              {ANALYSIS_VALUES.has(mode)
                ? 'More views…'
                : (MORE_MODE_BY_VALUE.get(mode)?.label ?? 'More views…')}
            </option>
            {MORE_MODE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <span className="text-[11.5px] text-muted-foreground" data-testid="active-mode">
          {MODE_LABEL[mode]}
        </span>
      </div>

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
              indoorTemp={indoorTemp}
              latentGainW={latentGainW}
              showFurniture={showFurniture}
              showShading={showShading}
              showSunPath={showSunPath}
              showGrid
              quality={quality}
              interactive
              exporterRef={exporterRef}
              selectedSurface={highlightedSurface}
              onSelectSurface={setSelectedSurface}
              autoRotate={autoRotate}
              cameraPreset={cameraPreset}
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

        {/* --- Overlay: surface-temperature legend ---
             Deliberately a *different* legend from the heat map, showing °C and
             the dew point, because it is a different quantity. Merging the two
             would let a reader mistake absorbed radiation for temperature. */}
        {surfaceTemp ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[210px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Surface temperature
            </p>
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ background: rampCssGradient(THERMAL_RAMP, 10) }}
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
              <span>{num(surfaceTemp.range[0], 1)}</span>
              <span>°C</span>
              <span>{num(surfaceTemp.range[1], 1)}</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
              <p className="flex justify-between gap-2">
                <span>Indoor / outdoor</span>
                <span className="tabular-nums text-foreground/80">
                  {num(surfaceTemp.indoorTemp, 1)} / {num(surfaceTemp.outdoorTemp, 1)} °C
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span>Dew point</span>
                <span className="tabular-nums text-foreground/80">
                  {num(surfaceTemp.dewPoint, 1)} °C
                </span>
              </p>
            </div>
            {surfaceTemp.condensationSurfaces.length > 0 ? (
              <p className="mt-1.5 text-[11.5px] font-medium" style={{ color: 'hsl(var(--warning))' }}>
                ⚠ Condensation risk on {surfaceTemp.condensationSurfaces.length} surface
                {surfaceTemp.condensationSurfaces.length === 1 ? '' : 's'}
              </p>
            ) : null}
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {surfaceTemp.summary}
            </p>
          </div>
        ) : null}

        {/* --- Scientific Vertical Thermal Bar (Cold to Hot) matching user reference --- */}
        {surfaceTemp && (mode === 'temperature' || mode === 'heatmap') ? (
          <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 rounded-xl border border-border/70 bg-panel/90 p-2.5 backdrop-blur shadow-md z-10">
            <div className="flex flex-col items-center justify-between h-48 text-[11px] font-bold">
              <span className="text-[#ff1744] font-semibold tracking-wide">Hot</span>
              <div
                className="w-3.5 flex-1 my-1.5 rounded-full border border-border/40 shadow-inner"
                style={{
                  background: 'linear-gradient(to bottom, #ff1744, #ff9100, #ffeb3b, #00e676, #00c8ff, #0055ff)',
                }}
              />
              <span className="text-[#0055ff] font-semibold tracking-wide">Cold</span>
            </div>
            <div className="flex flex-col justify-between h-48 py-1 text-[11px] font-mono text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground/90">{num(surfaceTemp.range[1], 1)}°C</span>
              <span>{num(surfaceTemp.range[0] + (surfaceTemp.range[1] - surfaceTemp.range[0]) * 0.75, 1)}°C</span>
              <span>{num(surfaceTemp.range[0] + (surfaceTemp.range[1] - surfaceTemp.range[0]) * 0.5, 1)}°C</span>
              <span>{num(surfaceTemp.range[0] + (surfaceTemp.range[1] - surfaceTemp.range[0]) * 0.25, 1)}°C</span>
              <span className="font-semibold text-foreground/90">{num(surfaceTemp.range[0], 1)}°C</span>
            </div>
          </div>
        ) : null}

        {/* --- Overlay: heat-flux legend ---
             A diverging scale, because the sign is the message: a wall losing
             heat and a wall gaining heat must not read the same. */}
        {surfaceFlux ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[225px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Conduction heat flux
            </p>
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ background: rampCssGradient(FLUX_RAMP, 12) }}
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
              <span>losing</span>
              <span>W/m²</span>
              <span>gaining</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
              <p className="flex justify-between gap-2">
                <span>Indoor / outdoor</span>
                <span className="tabular-nums text-foreground/80">
                  {num(surfaceFlux.indoorTemp, 1)} / {num(surfaceFlux.outdoorTemp, 1)} °C
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span>Warmest surface</span>
                <span className="tabular-nums text-foreground/80">
                  {surfaceFlux.detail[surfaceFlux.hottest]?.label ?? '—'}
                </span>
              </p>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              Positive means heat flowing into the shelter. {surfaceFlux.summary}
            </p>
          </div>
        ) : null}

        {/* --- Overlay: humidity legend --- */}
        {moisture ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[225px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Margin to the dew point
            </p>
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ background: rampCssGradient(MOISTURE_RAMP, 12) }}
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
              <span>condensing</span>
              <span>K</span>
              <span>dry</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
              <p className="flex justify-between gap-2">
                <span>Indoor RH</span>
                <span className="tabular-nums text-foreground/80">{pct(moisture.indoorRh, 0)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span>Dew point</span>
                <span className="tabular-nums text-foreground/80">
                  {num(moisture.dewPoint, 1)} °C
                </span>
              </p>
            </div>
            {moisture.condensationSurfaces.length > 0 ? (
              <p className="mt-1.5 text-[11.5px] font-medium" style={{ color: 'hsl(var(--warning))' }}>
                ⚠ Condensing on {moisture.condensationSurfaces.length} surface
                {moisture.condensationSurfaces.length === 1 ? '' : 's'}
              </p>
            ) : null}
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {moisture.summary}
            </p>
          </div>
        ) : null}

        {/* --- Overlay: heat-loss legend ---
             A one-way scale, because loss has no negative branch: a surface
             that is gaining heat has nothing to show here and takes the palest
             stop. The breakdown beside it is the same figure the heat-balance
             chart reports, re-expressed as shares of the total. */}
        {surfaceLoss ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[235px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Where the heat is going
            </p>
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ background: rampCssGradient(LOSS_RAMP, 10) }}
            />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
              <span>no loss</span>
              <span>W/m²</span>
              <span>{num(maxLoss, 0)}</span>
            </div>
            {heatLoss ? (
              <>
                <div className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
                  {rankedLoss.map((component) => (
                    <p key={component.key} className="flex justify-between gap-2">
                      <span className="truncate">{component.label}</span>
                      <span className="shrink-0 tabular-nums text-foreground/80">
                        {pct(component.sharePct, 0)}
                      </span>
                    </p>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                  {heatLoss.summary}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                Run a simulation to see how the loss splits across the walls, roof, floor, openings
                and air exchange.
              </p>
            )}
          </div>
        ) : null}

        {/* --- Overlay: condensation legend ---
             Banded, not continuous. The engine returns a verdict — low,
             medium, high — and painting that as a gradient would imply a
             precision the banding does not have. */}
        {condensation ? (
          <div className="pointer-events-none absolute bottom-3 left-3 w-[235px] rounded-md border border-border/70 bg-panel/95 p-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Condensation risk
            </p>
            <div className="mt-1.5 flex overflow-hidden rounded-full">
              {CONDENSATION_RAMP.map((colour) => (
                <span key={colour} className="h-2 flex-1" style={{ background: colour }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/75">
              {CONDENSATION_BANDS.map((band) => (
                <span key={band}>{band}</span>
              ))}
            </div>
            <div className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
              {condensationBands.map((entry) => (
                <p key={entry.band} className="flex justify-between gap-2">
                  <span className="capitalize">{entry.band} risk</span>
                  <span className="tabular-nums text-foreground/80">
                    {entry.count} surface{entry.count === 1 ? '' : 's'}
                  </span>
                </p>
              ))}
              <p className="flex justify-between gap-2">
                <span>Dew point</span>
                <span className="tabular-nums text-foreground/80">
                  {num(condensation.dewPoint, 1)} °C
                </span>
              </p>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {condensation.summary}
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
          <button
            type="button"
            onClick={() => setAutoRotate((prev) => !prev)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-200 border shadow-xs',
              autoRotate
                ? 'bg-primary text-primary-foreground border-primary shadow-primary/20 animate-pulse'
                : 'bg-card text-muted-foreground hover:text-foreground border-border/80 hover:border-border'
            )}
            title="Toggle 360° Cinematic Auto-Orbit Motion"
          >
            <RotateCw size={12} className={cn('transition-transform duration-500', autoRotate && 'animate-spin')} />
            <span>{autoRotate ? 'Orbiting' : 'Orbit 360°'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="chip border-border/60 text-muted-foreground" title="Conditioned floor area">
            <Tag size={11} aria-hidden />
            {num(geometry.floorArea, 1)} m² floor
          </span>
          <span className="chip border-border/60 text-muted-foreground" title="Total conditioned volume">
            {num(geometry.volume, 0)} m³ volume
          </span>
          <span className="chip border-border/60 text-muted-foreground" title="Gross exposed envelope area">
            {num(geometry.envelopeArea, 1)} m² envelope
          </span>
          <span className="chip border-border/60 text-muted-foreground" title="Window-to-Wall Ratio">
            WWR {pct(currentParameters.windowToWallRatio * 100)}
          </span>
          <span className="chip border-border/60 text-muted-foreground" title="Compass orientation azimuth">
            Az {currentParameters.orientation}°
          </span>
          <span className="chip border-border/60 text-muted-foreground" title="Roof structural form">
            Roof: {currentParameters.roofType}
          </span>
          <span className="chip border-border/60 text-primary font-medium" title="Wall assembly thermal transmittance">
            Wall U {num(materials.wall.uValue, 2)} W/m²K
          </span>
          <span className="chip border-border/60 text-primary font-medium" title="Roof assembly thermal transmittance">
            Roof U {num(materials.roof.uValue, 2)} W/m²K
          </span>
          {heatLoss?.totalLossKwh ? (
            <span className="chip border-orange-500/30 bg-orange-500/10 text-orange-500 font-medium" title="Representative day envelope heat loss">
              <TrendingDown size={11} aria-hidden />
              Loss {num(heatLoss.totalLossKwh, 1)} kWh/d
            </span>
          ) : null}
          {thermal?.indoorTemperature !== undefined ? (
            <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-medium" title="Representative peak free-running indoor temperature">
              <Thermometer size={11} aria-hidden />
              Indoor {num(thermal.indoorTemperature, 1)}°C
            </span>
          ) : null}
          {thermal?.pmv !== undefined ? (
            <span className="chip border-primary/30 bg-primary/10 text-primary font-medium" title="ISO 7730 Predicted Mean Vote & PPD">
              PMV {num(thermal.pmv, 2)} (PPD {num(thermal.ppd, 0)}%)
            </span>
          ) : null}
          {thermal?.energyUseIntensity !== undefined ? (
            <span className="chip border-border/60 text-muted-foreground" title="Annual Energy Use Intensity">
              EUI {num(thermal.energyUseIntensity, 1)} kWh/m²·yr
            </span>
          ) : null}
        </div>
      </div>

      {/* ---------------- Surface inspector ---------------- */}
      {climateData ? <SurfaceInspector /> : null}

      {/* ---------------- Mode-specific footnote ---------------- */}
      {mode === 'heatmap' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          The heat map shows <span className="text-foreground">absorbed solar radiation</span> per
          surface for {MONTH_LABELS[month]} — a direct product of the solar geometry. For the
          envelope&rsquo;s <span className="text-foreground">thermal</span> response rather than its
          solar exposure, switch to <b>Temp</b>.
        </p>
      ) : mode === 'temperature' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          <span className="text-foreground">Estimated surface temperature</span> for{' '}
          {MONTH_LABELS[month]} at {clockTime(hour)}, from the sol-air temperature and the
          assembly&rsquo;s U-value. This is a first-order estimate from a lumped envelope — it does
          not resolve the temperature gradient through a thick wall, and the surface is assumed
          isothermal. A surface below the indoor dew point is flagged as a condensation risk.
        </p>
      ) : mode === 'heatflux' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          <span className="text-foreground">Conduction heat flux</span> through each surface at{' '}
          {clockTime(hour)} in {MONTH_LABELS[month]} — the signed rate at which heat crosses the
          envelope. Positive flows in. This is neither the absorbed solar radiation of the heat map
          nor the surface temperature of the temp map: it is the rate those two drive. Derived from
          one lumped U-value per assembly, so it does not resolve flux at a thermal bridge.
        </p>
      ) : mode === 'heatloss' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          <span className="text-foreground">Outward heat loss</span> at {clockTime(hour)} in{' '}
          {MONTH_LABELS[month]} — how fast heat is leaving each surface, and how the total splits
          between walls, roof, floor, openings and air exchange. One-way where the flux map is
          signed: a surface that is gaining heat shows <b>no loss</b> here rather than a negative
          one. The breakdown is the same figure the heat-balance chart reports, re-expressed as
          shares, and it separates uncontrolled infiltration from intentional ventilation.
        </p>
      ) : mode === 'humidity' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          <span className="text-foreground">Margin to the indoor dew point</span> on each surface at{' '}
          {clockTime(hour)}. Anything left of the scale centre is below the dew point and is
          condensing. From a single-zone steady-state moisture balance — it does not resolve
          interstitial condensation inside the build-up, only the inner face.
        </p>
      ) : mode === 'condensation' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          <span className="text-foreground">Banded condensation risk</span> per surface —{' '}
          <b>high</b> where the margin to the indoor dew point is negative, <b>medium</b> within 2 K
          above it, <b>low</b> more than 2 K above it. Three bands, three colours: this is the
          verdict the moisture balance already reached, not the continuous margin the humidity map
          shows. The band is read from the same rounded margin the legend prints, so the number and
          the colour cannot disagree. Only the inner face is assessed — condensation <i>inside</i>{' '}
          the build-up is not resolved.
        </p>
      ) : mode === 'exploded' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          The envelope pulled apart along each surface&rsquo;s own outward normal so the assembly
          stack can be read. The distances are a fixed visual offset — they carry no physical
          meaning and the model measures nothing from them.
        </p>
      ) : mode === 'section' ? (
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          A cut through the shelter on the building&rsquo;s own front-to-back axis, so it follows the
          design&rsquo;s orientation. The cut is a flat plane through the middle: it shows the section
          through the space, not a true construction detail of the build-up.
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
