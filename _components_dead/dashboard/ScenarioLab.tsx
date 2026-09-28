'use client';

/**
 * The Climate Response Lab.
 *
 * This is the page that answers the question the whole project is really about:
 * *does the design actually respond to the climate, or does it just say it
 * does?* One optimised building on one site cannot answer that — there is
 * nothing to compare it against. So this page runs the real pipeline five times
 * along whichever axis the user picks and puts the results side by side.
 *
 *   **Building types** — one site, five forms. Holds the climate fixed, so every
 *   difference between the columns is caused by the building type.
 *
 *   **Locations** — one form, five climates. Holds the type and the programme
 *   fixed, so every difference is caused by the site.
 *
 * Both sweeps go through `lib/scenarios.ts`, which goes through the same
 * optimiser and the same physics the Design Studio uses. Nothing on this page is
 * computed a second way.
 *
 * WHY THE 3D MODEL IS THE CENTREPIECE
 * A table of five columns proves that five numbers differ. It does not prove
 * that five *buildings* differ, which is the actual claim. So the five designs
 * are drawn, at size, from the same `ShelterGeometry` each one's numbers came
 * from — and switching the variant (traditional / AI-optimised / low-cost)
 * switches the building on screen, not just the figures beside it. When the
 * location sweep runs, the same building type comes back as five visibly
 * different envelopes, which is the single most direct statement of the problem
 * statement the interface can make.
 *
 * WHY EACH CARD SHOWS THREE DESIGNS
 * "The AI made it better" is a claim. "Here is the conventional build, here is
 * what the search found, and here is the cheapest thing it found" is a choice —
 * and the three are usually genuinely different buildings, which is the
 * interesting part. The low-cost column in particular is often *not* the
 * traditional one: the search frequently reaches a cheaper design by spending
 * differently rather than by spending less.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ChevronDown,
  Loader2,
  MapPin,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BuildingTypeId, ObjectiveWeights } from '@/types';
import { useDesignStore } from '@/store/designStore';
import {
  LOCATION_SWEEP_IDS,
  TYPE_SWEEP_IDS,
  describeChanges,
  runLocationSweep,
  runTypeSweep,
  variantOf,
  type ParameterDelta,
  type ScenarioAxis,
  type ScenarioCell,
  type ScenarioSweep,
  type ScenarioVariantKind,
  type SweepOptions,
} from '@/lib/scenarios';
import { BUILDING_TYPE_OPTIONS, buildingType } from '@/lib/buildingTypes';
import { weightsFromPriority } from '@/optimization/objective';
import { STATION_BY_ID } from '@/climate/stations';
import { ModelThumbnail } from '@/components/3d/ModelThumbnail';
import { ScenarioViewport } from '@/components/dashboard/ScenarioViewport';
import { Chip, EmptyState, MetricRow, Panel, Segmented, StatCard } from '@/components/ui/primitives';
import { ZONE_LABEL } from '@/lib/labels';
import { energyPerYear, num, pct, temp } from '@/utils/format';
import { cn, extractErrorMessage } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const HUE = (hue: number, lightness: number, alpha = 1): string =>
  `hsl(${hue} ${Math.round(62 - (lightness - 40) * 0.2)}% ${lightness}% / ${alpha})`;

/** The three options every cell is measured between, in display order. */
const VARIANT_ROWS: { kind: ScenarioVariantKind; label: string; blurb: string }[] = [
  {
    kind: 'traditional',
    label: 'Traditional',
    blurb: 'Conventional local construction — what gets built with no climate thinking.',
  },
  {
    kind: 'optimised',
    label: 'AI-optimised',
    blurb: 'What the multi-objective search reached at the current cost ↔ comfort priority.',
  },
  {
    kind: 'low-cost',
    label: 'Low-cost',
    blurb: 'The cheapest design the same search actually evaluated.',
  },
];

/* ------------------------------------------------------------------ */
/* The "what changed" list                                             */
/* ------------------------------------------------------------------ */

function ChangeList({
  title,
  deltas,
  empty,
}: {
  title: string;
  deltas: ParameterDelta[];
  empty: string;
}) {
  if (deltas.length === 0) {
    return (
      <p className="text-[11.5px] leading-snug text-muted-foreground/70">{empty}</p>
    );
  }

  return (
    <div>
      <p className="stat-label">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {deltas.map((delta) => (
          <li
            key={delta.key}
            className="flex items-baseline justify-between gap-2 text-[11.5px]"
          >
            <span className="shrink-0 text-muted-foreground">{delta.label}</span>
            <span className="truncate text-right">
              <span className="text-muted-foreground/60 line-through">{delta.from}</span>
              <ArrowRight size={10} className="mx-1 inline text-muted-foreground/50" aria-hidden />
              <span className="font-medium text-foreground/90">{delta.to}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One cell, in the comparison strip                                   */
/* ------------------------------------------------------------------ */

/**
 * A compact card for one column of the sweep.
 *
 * Deliberately small: the strip's job is to put five *buildings* on screen at
 * once so the reader can see that the forms differ before reading a single
 * number. The detail for whichever one is selected lives in the hero beside the
 * full-size model, so nothing here needs to repeat it.
 */
function SweepCard({
  cell,
  isBest,
  isWorst,
  isSelected,
  onSelect,
}: {
  cell: ScenarioCell;
  isBest: boolean;
  isWorst: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const month = useDesignStore((state) => state.analysisMonth);
  const optimised = variantOf(cell, 'optimised');
  const traditional = variantOf(cell, 'traditional');

  const comfortDelta =
    optimised.metrics.adaptiveComfortHoursPct - traditional.metrics.adaptiveComfortHoursPct;
  const energyDelta =
    optimised.metrics.energyUseIntensity - traditional.metrics.energyUseIntensity;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border bg-panel p-2.5 text-left transition-shadow',
        isSelected ? 'ring-2 ring-primary/45' : 'hover:shadow-sm',
      )}
    >
      {/* ---- Header ---- */}
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 h-6 w-1 shrink-0 rounded-full"
          style={{ background: HUE(cell.accentHue, 46) }}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-foreground">
            <span aria-hidden>{cell.glyph}</span>
            {cell.title}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">{cell.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="text-[15px] font-semibold leading-none tabular-nums"
            style={{ color: HUE(cell.accentHue, 42) }}
          >
            {cell.score}
            <span className="text-[10px] font-normal text-muted-foreground">/100</span>
          </span>
          {isBest ? <Chip tone="good">Best</Chip> : null}
          {isWorst && !isBest ? <Chip tone="warn">Weakest</Chip> : null}
        </div>
      </div>

      {/* ---- The building ---- */}
      <div className="relative h-[132px] overflow-hidden rounded-md border bg-gradient-to-b from-[#F5F1EB] to-[#E4DCD1]">
        <ModelThumbnail parameters={cell.parameters} climate={cell.climate} month={month} hour={10} />
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 chip border-border/70 bg-panel/95 text-muted-foreground">
          {ZONE_LABEL[cell.analysis.zone]}
        </span>
      </div>

      {/* ---- Two numbers and the sign of the change ---- */}
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard
          label="Comfort"
          value={pct(optimised.metrics.adaptiveComfortHoursPct)}
          delta={{ value: comfortDelta, unit: ' pts' }}
        />
        <StatCard
          label="Energy"
          value={num(optimised.metrics.energyUseIntensity, 0)}
          unit="kWh/m²"
          delta={{ value: energyDelta, unit: '' }}
          lowerIsBetter
        />
      </div>

      <p className="text-[10.5px] leading-snug text-muted-foreground/65">
        Optimised vs conventional on this site · {energyPerYear(optimised.metrics.annualEnergy)}
      </p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function ScenarioLab() {
  const router = useRouter();

  const climateData = useDesignStore((state) => state.climateData);
  const currentParameters = useDesignStore((state) => state.currentParameters);
  const priority = useDesignStore((state) => state.priority);
  const setPriority = useDesignStore((state) => state.setPriority);
  const loadScenario = useDesignStore((state) => state.loadScenario);
  const generate = useDesignStore((state) => state.generate);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const month = useDesignStore((state) => state.analysisMonth);

  const [axis, setAxis] = useState<ScenarioAxis>('building-type');
  const [fixedType, setFixedType] = useState<BuildingTypeId>('single-family');
  const [sweep, setSweep] = useState<ScenarioSweep | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [variantKind, setVariantKind] = useState<ScenarioVariantKind>('optimised');
  const [runToken, setRunToken] = useState(0);
  const [showChart, setShowChart] = useState(true);

  /*
   * The programme and the weights are read when a run *starts*, not tracked as
   * dependencies. Dragging a parameter slider in the studio must not kick off
   * five optimisations, so `currentParameters` deliberately does not appear in
   * the effect's dependency list below.
   */
  const latest = useRef<{ base: typeof currentParameters; priority: number }>({
    base: currentParameters,
    priority,
  });
  latest.current = { base: currentParameters, priority };

  const requestRef = useRef(0);

  useEffect(() => {
    if (!climateData) {
      setSweep(null);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let cancelled = false;

    setError(null);
    setSweep(null);
    setSelectedKey(null);
    setProgress({ done: 0, total: 5 });

    const weights: ObjectiveWeights = weightsFromPriority(latest.current.priority);
    const options: SweepOptions = {
      base: latest.current.base,
      weights,
      onCell: (_cell, done, total) => {
        if (!cancelled && requestRef.current === requestId) setProgress({ done, total });
      },
    };

    const promise =
      axis === 'building-type'
        ? runTypeSweep(climateData, options)
        : runLocationSweep(fixedType, options);

    promise
      .then((result) => {
        if (cancelled || requestRef.current !== requestId) return;
        setSweep(result);
        setSelectedKey(result.bestKey);
        setProgress(null);
      })
      .catch((cause: unknown) => {
        if (cancelled || requestRef.current !== requestId) return;
        setError(extractErrorMessage(cause));
        setProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [axis, fixedType, climateData, runToken]);

  const selected = useMemo(
    () => sweep?.cells.find((cell) => cell.key === selectedKey) ?? null,
    [sweep, selectedKey],
  );

  const reference = sweep?.cells[0] ?? null;

  /** The variant currently drawn in the hero — the design the picture shows. */
  const activeVariant = useMemo(
    () => (selected ? variantOf(selected, variantKind) : null),
    [selected, variantKind],
  );

  /**
   * What the *site* changed, as opposed to what the climate thinking changed.
   *
   * Only the location sweep has a meaningful reading here: it is the same
   * building type at every site, so the diff against the first site is the
   * adaptation the climate forced. On the building-type sweep the columns are
   * different buildings on purpose, so a diff between them would be describing
   * the brief rather than the climate.
   */
  const siteAdaptation = useMemo(() => {
    if (axis !== 'location' || !reference || !selected || reference.key === selected.key) return [];
    return describeChanges(reference.parameters, selected.parameters);
  }, [axis, reference, selected]);

  const vsConventional = useMemo(
    () => (selected ? describeChanges(variantOf(selected, 'traditional').parameters, selected.parameters) : []),
    [selected],
  );

  /* A grouped bar of the three options per cell — the one chart that shows the
     whole point of the page at once: for every type and every site, what the
     conventional build scores against what the search reached. */
  const chartData = useMemo(
    () =>
      (sweep?.cells ?? []).map((cell) => ({
        name: cell.title,
        hue: cell.accentHue,
        Traditional: variantOf(cell, 'traditional').score,
        'AI-optimised': variantOf(cell, 'optimised').score,
        'Low-cost': variantOf(cell, 'low-cost').score,
      })),
    [sweep],
  );

  const handleLoad = useCallback(
    (cell: ScenarioCell) => {
      void loadScenario(cell.location, cell.parameters).then(() => {
        router.push('/dashboard/design');
      });
    },
    [loadScenario, router],
  );

  const running = progress !== null;

  /* ---------------- No climate yet ---------------- */
  if (!climateData) {
    return (
      <Panel
        title="Climate Response Lab"
        subtitle="Same site, different types · same building, different sites"
        accent="optimize"
      >
        <EmptyState
          message="No climate resolved yet"
          hint="This page runs the pipeline five times along one axis, so it needs a resolved site first. Press Generate to analyse the current location."
        />
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void generate()}
            disabled={isGenerating}
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
            {isGenerating ? 'Running the pipeline…' : 'Generate a design first'}
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ================= Controls ================= */}
      <Panel
        title="Climate Response Lab"
        subtitle={
          axis === 'building-type'
            ? `Same site, five forms — every column sees the climate of ${climateData.location.city}`
            : `Same building, five climates — the form and the programme are held fixed`
        }
        accent="optimize"
        right={
          <>
            <Chip tone="neutral" title="The climatology every cell is evaluated on">
              {climateData.source === 'api' ? 'Live provider' : 'Offline climatology'}
            </Chip>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setRunToken((token) => token + 1)}
              disabled={running}
            >
              {running ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Play size={12} aria-hidden />}
              {running ? 'Sweeping…' : 'Re-run sweep'}
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Vary
            </span>
            <Segmented<ScenarioAxis>
              options={[
                { value: 'building-type', label: 'Building type', icon: <Building2 size={13} aria-hidden /> },
                { value: 'location', label: 'Location', icon: <MapPin size={13} aria-hidden /> },
              ]}
              value={axis}
              onChange={setAxis}
            />
          </div>

          {axis === 'location' ? (
            <label className="flex items-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Fixed form
              </span>
              <select
                className="select-field w-[210px] py-1.5 text-[12.5px]"
                value={fixedType}
                onChange={(event) => setFixedType(event.target.value as BuildingTypeId)}
                aria-label="Building type held fixed across the sites"
              >
                {BUILDING_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Each form starts from its own programme — a row house is 5 × 11 m, a low-rise block is
              12 × 16 m — so the sweep compares forms rather than sizes.
            </p>
          )}

          {/* The multi-objective slider, surfaced where its effect is visible. */}
          <label className="flex min-w-[240px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Cost ↔ comfort
            </span>
            <input
              type="range"
              className="slider flex-1"
              min={0}
              max={1}
              step={0.05}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              aria-label="Optimisation priority"
            />
            <span className="w-[86px] text-right text-[11.5px] font-semibold tabular-nums text-primary">
              {priority < 0.34 ? 'Cost-led' : priority > 0.66 ? 'Comfort-led' : 'Balanced'}
            </span>
          </label>
        </div>

        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground/70">
          Moving the slider changes the objective the search minimises. Press <b>Re-run sweep</b> to
          see what it does to all five columns — the sweep is not re-run on every tick, because that
          would be five optimisations per drag.
        </p>
      </Panel>

      {/* ================= Progress / error ================= */}
      {running ? (
        <div className="surface flex items-center gap-3 px-4 py-3">
          <Loader2 size={15} className="animate-spin text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">
              Optimising {progress.done} of {progress.total}…
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Each column is a full coordinate-descent search on its own climate.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="surface border-destructive/40 bg-destructive/[0.06] px-4 py-3">
          <p className="text-[13px] font-medium text-destructive">The sweep failed</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {/* ================= Finding ================= */}
      {sweep ? (
        <div className="surface px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium leading-snug text-foreground">
                {sweep.headline}
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{sweep.note}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                {sweep.cells.length} designs × 3 options evaluated ·{' '}
                {sweep.cells.reduce((sum, cell) => sum + cell.candidatesEvaluated, 0).toLocaleString('en-IN')}{' '}
                candidate simulations · {(sweep.durationMs / 1000).toFixed(1)} s
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* ================= The five, side by side ================= */}
      {sweep ? (
        <Panel
          title="The five, side by side"
          subtitle={
            axis === 'building-type'
              ? 'One climate, five forms — the same optimiser run on each'
              : 'One form, five climates — the same optimiser run at each site'
          }
          accent="analysis"
          right={
            <Chip tone="neutral" title="Click any column to load it into the 3D model below">
              Click to inspect
            </Chip>
          }
        >
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {sweep.cells.map((cell) => (
              <SweepCard
                key={cell.key}
                cell={cell}
                isBest={cell.key === sweep.bestKey}
                isWorst={cell.key === sweep.worstKey}
                isSelected={cell.key === selectedKey}
                onSelect={() => setSelectedKey(cell.key)}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {/* ================= Hero: the design, at size ================= */}
      {sweep && selected && activeVariant ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          {/* ---------- The model ---------- */}
          <Panel
            title={`3D model — ${selected.title}`}
            subtitle={`${selected.location.city} · ${selected.climate.climateType} · ${activeVariant.label}`}
            accent="optimize"
            className="min-h-0"
            bodyClassName="flex flex-col gap-2.5"
            right={
              <Chip
                tone="neutral"
                title="The optimised design's weighted objective score"
              >
                {selected.score}/100
              </Chip>
            }
          >
            {/* Which of the three designs is drawn */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Design
              </span>
              <Segmented<ScenarioVariantKind>
                options={VARIANT_ROWS.map((row) => ({
                  value: row.kind,
                  label: row.label,
                  title: row.blurb,
                }))}
                value={variantKind}
                onChange={setVariantKind}
              />
              <p className="ml-auto text-[11.5px] text-muted-foreground/70">
                {VARIANT_ROWS.find((row) => row.kind === variantKind)?.blurb}
              </p>
            </div>

            <ScenarioViewport
              geometry={activeVariant.geometry}
              materials={activeVariant.materials}
              climate={selected.climate}
              month={month}
              hour={10}
              quality="med"
              accentHue={selected.accentHue}
              caption={`${activeVariant.label} · ${selected.title}`}
              exportName={`thermal-shelter-${selected.key}-${activeVariant.kind}`}
              className="min-h-[420px] flex-1"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => handleLoad(selected)}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                ) : (
                  <Play size={12} aria-hidden />
                )}
                Open in Design Studio
              </button>
              <p className="text-[11.5px] leading-snug text-muted-foreground/70">
                Loads this design <i>and</i> moves the studio to {selected.location.city}, then
                re-runs the pipeline — so the studio's numbers describe the site the design was
                optimised for.
              </p>
            </div>
          </Panel>

          {/* ---------- Why, and what changed ---------- */}
          <Panel
            title={`Why this design — ${selected.title}`}
            subtitle={`${selected.location.city} · ${ZONE_LABEL[selected.analysis.zone]} · ${activeVariant.label}`}
            accent="analysis"
            scroll
            right={
              <Chip tone="neutral" title="Recommendations come from the optimiser that produced the design">
                {selected.recommendations.length}
              </Chip>
            }
          >
            {/* ---- The three numbers the trade-off is made of ---- */}
            <div className="grid grid-cols-3 gap-1.5">
              <StatCard
                label="Comfort"
                value={pct(activeVariant.metrics.adaptiveComfortHoursPct)}
                tone={activeVariant.metrics.adaptiveComfortHoursPct >= 60 ? 'good' : 'warn'}
              />
              <StatCard
                label="Energy"
                value={num(activeVariant.metrics.energyUseIntensity, 0)}
                unit="kWh/m²"
              />
              <StatCard
                label="Cost"
                value={num(activeVariant.cost.totalCost / 100000, 1)}
                unit="₹ L"
                tone={activeVariant.cost.withinBudget ? 'good' : 'warn'}
              />
            </div>

            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
              {selected.analysis.challengeDetail}
            </p>

            {/* ---- The optimiser's own reasoning ---- */}
            <p className="stat-label mt-3">What the optimiser recommends, and why</p>
            <ul className="mt-1.5 space-y-2">
              {selected.recommendations.slice(0, 6).map((recommendation) => (
                <li key={recommendation.id} className="rounded-md border bg-card/40 px-2.5 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {recommendation.parameter}
                    </span>
                    <span className="text-[12.5px] text-foreground/80">{recommendation.value}</span>
                    <Chip
                      tone={
                        recommendation.impact === 'high'
                          ? 'good'
                          : recommendation.impact === 'medium'
                            ? 'warn'
                            : 'neutral'
                      }
                      className="ml-auto"
                    >
                      {recommendation.impact}
                    </Chip>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    {recommendation.reason}
                  </p>
                  {recommendation.effect ? (
                    <p className="mt-0.5 text-[11.5px] font-medium tabular-nums text-primary">
                      {recommendation.effect}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* ---- The diff that answers "what did the climate change?" ---- */}
            <div className="mt-3 space-y-3">
              <ChangeList
                title="Search changed, vs conventional"
                deltas={vsConventional}
                empty="Nothing — the conventional build is already optimal on this site."
              />
              {axis === 'location' && reference && reference.key !== selected.key ? (
                <ChangeList
                  title={`Site adaptation, vs ${reference.title}`}
                  deltas={siteAdaptation}
                  empty={`No parameter differs from ${reference.title} — this site did not force a change.`}
                />
              ) : null}
            </div>

            {/* ---- Resolved specification ---- */}
            <div className="mt-3">
              <p className="stat-label">Resolved specification</p>
              <div className="mt-1 rounded-md border bg-card/40 px-2.5 py-1.5">
                <MetricRow label="Form" value={buildingType(selected.parameters.buildingType).label} />
                <MetricRow
                  label="Plan × storeys"
                  value={`${selected.parameters.width} × ${selected.parameters.length} m · ${selected.parameters.floors} storey${selected.parameters.floors === 1 ? '' : 's'}`}
                />
                <MetricRow
                  label="Floor area"
                  value={`${num(selected.geometry.floorArea, 1)} m²`}
                />
                <MetricRow
                  label="Window-to-wall ratio"
                  value={pct(selected.parameters.windowToWallRatio * 100)}
                />
                <MetricRow label="Orientation" value={`${Math.round(selected.parameters.orientation)}°`} />
                <MetricRow
                  label="Peak indoor — summer"
                  value={temp(activeVariant.metrics.summerIndoorTemperature)}
                />
                <MetricRow
                  label="Peak indoor — winter"
                  value={temp(activeVariant.metrics.winterIndoorTemperature)}
                />
                <MetricRow
                  label="Annual energy"
                  value={energyPerYear(activeVariant.metrics.annualEnergy)}
                />
                <MetricRow
                  label="Construction cost"
                  value={`₹${num(activeVariant.cost.totalCost / 100000, 1)} L`}
                  tone={activeVariant.cost.withinBudget ? 'good' : 'warn'}
                />
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {/* ================= Chart ================= */}
      {sweep && showChart ? (
        <Panel
          title="Option comparison"
          subtitle="Design score 0–100 for each of the three options, in every column of the sweep"
          accent="output"
          right={
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowChart(false)}>
              Hide
            </button>
          }
        >
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(30 14% 88%)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'hsl(27 9% 43%)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(30 14% 88%)' }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'hsl(27 9% 43%)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(30 14% 88%)',
                    background: 'hsl(0 0% 100%)',
                  }}
                  formatter={(value: number) => [`${value} / 100`, '']}
                />
                <Legend wrapperStyle={{ fontSize: 11.5 }} />
                <Bar dataKey="Traditional" fill="hsl(27 9% 62%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="AI-optimised" fill="hsl(18 68% 44%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Low-cost" fill="hsl(158 46% 34%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground/70">
            Scores are the same weighted objective the optimiser minimised, inverted so higher is
            better — not a second score invented for this chart. Where the low-cost bar sits above
            the traditional one, the search found a cheaper building <i>and</i> a better one, which
            is the most common outcome in the hot climates.
          </p>
        </Panel>
      ) : null}

      {/* ================= Honesty footer ================= */}
      <div className="surface flex items-start gap-2.5 px-4 py-3">
        <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          <b className="text-foreground/85">What this page is, and is not.</b> Every number here is a
          model estimate from the same monthly heat balance the rest of the application uses, run
          five times. The sweeps are not measurements, and a five-point score difference between two
          columns is within the noise of a monthly-mean model — read the spread, not the ranking. The
          location sweep evaluates the offline climatology database ({LOCATION_SWEEP_IDS.length}{' '}
          stations: {LOCATION_SWEEP_IDS.map((id) => STATION_BY_ID.get(id)?.location.city ?? id).join(', ')}),
          not live weather; the building-type sweep uses whichever climatology the studio currently
          holds. Building types are the five in{' '}
          <code className="text-foreground/70">lib/buildingTypes.ts</code> ({TYPE_SWEEP_IDS.length} of
          them), and each one is a real form the thermal model simulates rather than a display variant.
        </p>
      </div>
    </div>
  );
}
