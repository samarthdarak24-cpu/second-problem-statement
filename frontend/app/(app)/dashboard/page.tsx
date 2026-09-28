'use client';

/**
 * Dashboard — the new home page.
 *
 * Four bands, in the order a reviewer reads them:
 *
 *   1. Greeting — the site identity, its climate reading, and the site
 *      facts folded in beside them.
 *   2. Progress strip — where the pipeline is.
 *   3. The three engineering outputs the problem statement asks for
 *      (Indoor temperature · Solar gain · Heat flow).
 *   4. Current design preview (3D viewport + thermal-comfort gauge),
 *      ending on one clear next action.
 *
 * The page previously carried seven bands. Four of them restated pages
 * that already do the job better — the site chips restated the greeting,
 * the quick-action grid restated the footer link, and the "recent
 * designs" row was built on synthesised data with invented timestamps,
 * so it was removed rather than relabelled. Everything cut is still one
 * click away.
 *
 * Everything else — score, energy intensity, cost, materials, method —
 * lives on its own page. The dashboard answers one question: "how is my
 * current design doing?"
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  Compass,
  Droplets,
  Flame,
  GitCompare,
  Layers3,
  Mountain,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import {
  BarRow,
  Gauge,
  LocationChip,
  MetricCard,
  PastelCard,
  ProgressStrip,
  Reveal,
  SectionHeader,
  ThreeDPreviewCard,
  VerdictChip,
} from '@/components/ui/soft';
import { Chip } from '@/components/ui/primitives';
import { useThermalReading } from '@/hooks/useThermalReading';
import {
  CHALLENGE_LABEL,
  ZONE_LABEL,
} from '@/lib/labels';
import { MONTH_LABELS } from '@/utils/units';
import { num, pct, temp } from '@/utils/format';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

/* Three.js touches `window` at import time, so the canvas is
   client-only. Used by the dashboard preview. */
const ModelThumbnail = dynamic(
  () => import('@/components/3d/ModelThumbnail').then((m) => m.ModelThumbnail),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: 'hsl(var(--pastel-gray))' }}
      >
        <span className="text-[12px] text-muted-foreground">Loading renderer…</span>
      </div>
    ),
  },
);

/* ------------------------------------------------------------------ */
/* Greeting                                                            */
/* ------------------------------------------------------------------ */

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Greeting() {
  const location = useDesignStore((s) => s.location);
  const climateData = useDesignStore((s) => s.climateData);
  const analysis = useDesignStore((s) => s.climateAnalysis);

  const zone = climateData
    ? ZONE_LABEL[climateData.climateZone]
    : 'Resolving climate';
  const summary = climateData?.summary;
  const annualMean = summary ? temp(summary.avgTemperature, 1) : '—';
  const diurnal = summary ? `${num(summary.diurnalSwing, 1)} K swing` : '—';

  /* Site facts are folded into this band rather than living as their own
     six-chip strip. Six chips restated numbers the greeting already
     implied; here they sit beside the site they describe. */
  const facts = location && summary
    ? [
        { icon: Thermometer, label: 'Annual mean', value: temp(summary.avgTemperature) },
        { icon: Sun, label: 'Diurnal swing', value: `${num(summary.diurnalSwing, 1)} K` },
        { icon: Droplets, label: 'Rainfall', value: `${num(summary.rainfall, 0)} mm` },
        { icon: Wind, label: 'Wind', value: `${num(summary.windSpeed, 1)} m/s` },
        { icon: Mountain, label: 'Elevation', value: `${Math.round(location.elevation)} m` },
        { icon: Compass, label: 'Coords', value: `${num(location.latitude, 2)}°, ${num(location.longitude, 2)}°` },
      ]
    : [];

  return (
    <section className="surface-pastel-peach pastel-card relative overflow-hidden p-7 sm:p-8">
      {/* Decorative blob — gives the panel the editorial feel without
         competing with the text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-50"
        style={{ background: 'hsl(var(--pastel-yellow))' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 right-1/3 h-32 w-32 rounded-full opacity-40"
        style={{ background: 'hsl(var(--pastel-pink))' }}
      />

      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] opacity-70">
            Thermal Shelter · {getGreeting()}, Designer
          </p>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[32px]">
            {location ? `${location.city} is asking for` : 'Design the shelter for the climate it actually stands in.'}
            {location ? (
              <span className="ml-2 inline-flex items-baseline">
                <span className="font-bold">{zone.toLowerCase()}</span>
                <span className="ml-1.5 opacity-70">climate</span>
              </span>
            ) : null}
          </h2>
          <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed opacity-80">
            {analysis
              ? CHALLENGE_LABEL[analysis.mainChallenge]
              : 'Choose a site to resolve the climate and start a fresh design.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {location ? (
              <LocationChip city={location.city} state={location.state} />
            ) : null}
            {climateData ? (
              <Chip tone="accent" title={climateData.climateType}>
                {climateData.climateType}
              </Chip>
            ) : null}
            <span className="text-[12px] opacity-70">Annual mean {annualMean} · {diurnal}</span>
          </div>

          {facts.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6"
                style={{ borderColor: 'hsl(24 10% 10% / 0.10)' }}>
              {facts.map((fact) => {
                const Icon = fact.icon;
                return (
                  <div key={fact.label} className="flex items-start gap-2">
                    <Icon size={13} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[10.5px] font-bold uppercase tracking-[0.14em] opacity-70">
                        {fact.label}
                      </dt>
                      <dd className="truncate text-[13px] font-semibold tabular-nums">
                        {fact.value}
                      </dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/climate"
            className="link-action inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-4 py-2 text-[12.5px] font-semibold text-background transition-transform hover:-translate-y-0.5"
          >
            Open Site &amp; Climate
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Progress strip — replaces the always-visible 8-stage pipeline       */
/* ------------------------------------------------------------------ */

function PipelineStrip() {
  const pipeline = useDesignStore((s) => s.pipeline);
  const isGenerating = useDesignStore((s) => s.isGenerating);

  // The original pipeline has 8 stages; condense to the 5 the
  // dashboard cares about.
  const condensed = useMemo(() => {
    const byId = new Map(pipeline.map((stage) => [stage.id, stage]));
    return [
      { id: 'site', label: 'Site', status: (byId.get('input')?.status ?? 'idle') as 'idle' | 'running' | 'done' | 'error' },
      { id: 'climate', label: 'Climate', status: (byId.get('climate')?.status ?? 'idle') as 'idle' | 'running' | 'done' | 'error' },
      { id: 'design', label: 'Design', status: (byId.get('parameters')?.status ?? byId.get('geometry')?.status ?? 'idle') as 'idle' | 'running' | 'done' | 'error' },
      { id: 'thermal', label: 'Thermal', status: (byId.get('thermal')?.status ?? 'idle') as 'idle' | 'running' | 'done' | 'error' },
      { id: 'optimized', label: 'Optimized', status: (byId.get('optimization')?.status ?? 'idle') as 'idle' | 'running' | 'done' | 'error' },
    ];
  }, [pipeline]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProgressStrip steps={condensed} />
      <span className="text-[12px] text-muted-foreground">
        {isGenerating ? 'Running pipeline…' : 'All stages complete'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The three problem-statement outputs as pastel cards                 */
/* ------------------------------------------------------------------ */

function HeadlineOutputs() {
  const thermal = useDesignStore((s) => s.currentThermal);
  const climateData = useDesignStore((s) => s.climateData);

  const profile = thermal?.dailyProfile;
  const monthName = profile ? MONTH_LABELS[profile.month] : '—';

  if (!profile || !climateData) {
    return (
      <PastelCard tone="blue" eyebrow="Engineering outputs" icon={Sparkles}>
        <p className="text-[14px] font-semibold leading-snug">
          Press <span className="font-bold">Generate design</span> to run the simulation.
        </p>
        <p className="mt-2 text-[13px] leading-snug opacity-75">
          Indoor temperature, solar gain and heat flow appear here as soon as the climate
          and the design are resolved.
        </p>
      </PastelCard>
    );
  }

  // Heat flow share — used in the breakdown row beneath the third card.
  const flowMax = Math.max(
    Math.abs(profile.wallKwh),
    Math.abs(profile.roofKwh),
    Math.abs(profile.floorKwh),
    Math.abs(profile.windowKwh),
    Math.abs(profile.doorKwh),
    Math.abs(profile.ventilationKwh),
    1e-6,
  );

  const rows = [
    { label: 'Walls', value: profile.wallKwh },
    { label: 'Roof', value: profile.roofKwh },
    { label: 'Floor', value: profile.floorKwh },
    { label: 'Windows', value: profile.windowKwh },
    { label: 'Doors', value: profile.doorKwh },
    { label: 'Ventilation', value: profile.ventilationKwh },
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <MetricCard
        tone="blue"
        label="Indoor temperature"
        icon={Thermometer}
        value={`${t(profile.indoorMin)} … ${t(profile.indoorMax)}`}
        unit="°C free-running"
        description={`${monthName} representative day · outdoor ${num(profile.outdoorSwing, 1)} K swing damped ${Math.round(profile.swingDamping * 100)}%`}
      />
      <MetricCard
        tone="peach"
        label="Solar thermal gain"
        icon={Sun}
        value={num(profile.solarGainKwh, 1)}
        unit="kWh/day"
        description={`${num(profile.solarGainPerSqm, 2)} kWh/m²·day · peaks at ${hourLabel(profile.solarPeakHour)} · covers ${Math.round(profile.solarCoverage * 100)}% of day's losses`}
      />
      <PastelCard tone="mint" eyebrow="Heat flow" icon={Wind}>
        <div className="flex items-baseline gap-2">
          <span className="metric-display">{num(profile.heatLossKwh, 1)}</span>
          <span className="text-[14px] font-medium opacity-70">kWh/day leaving</span>
        </div>
        <div className="mt-4 space-y-1.5">
          {rows.map((row) => (
            <BarRow
              key={row.label}
              label={row.label}
              value={`${row.value >= 0 ? '+' : '−'}${Math.abs(row.value).toFixed(1)}`}
              share={Math.abs(row.value) / flowMax}
              tone="mint"
            />
          ))}
        </div>
      </PastelCard>
    </div>
  );
}

/** Sign-aware formatting for indoor temperature, matching the existing panel. */
function t(value: number): string {
  return `${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(1)}`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/* ------------------------------------------------------------------ */
/* Current design preview — 3D viewport + comfort gauge                */
/* ------------------------------------------------------------------ */

function CurrentDesignPreview() {
  const parameters = useDesignStore((s) => s.currentParameters);
  const climateData = useDesignStore((s) => s.climateData);
  const metrics = useDesignStore((s) => s.metrics);
  const materials = useDesignStore((s) => s.materials);

  const comfortPct = metrics?.adaptiveComfortHoursPct ?? 0;
  const energyKwh = metrics?.annualEnergy ?? 0;
  const costPerSqm = useDesignStore((s) => s.cost)?.costPerSqm;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {/* ----- 3D preview ----- */}
      <ThreeDPreviewCard
        title="Current design"
        subtitle={`${parameters.width} × ${parameters.length} m · ${parameters.numOccupants} occupants`}
        right={
          <Link
            href="/dashboard/design"
            className="link-action inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
          >
            Open studio <ArrowRight size={11} aria-hidden />
          </Link>
        }
        className="min-h-[440px]"
        bodyClassName="relative"
      >
        {climateData ? (
          <ModelThumbnail
            parameters={parameters}
            climate={climateData}
            showEnvironment={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-[12px] text-muted-foreground">No climate</span>
          </div>
        )}

        {/* Soft metadata strip — sits at the bottom of the preview. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1.5 border-t bg-panel/90 px-4 py-3 backdrop-blur-sm"
          style={{ borderColor: 'hsl(30 14% 88% / 0.7)' }}
        >
          <Chip tone="accent">{parameters.buildingType}</Chip>
          {materials ? (
            <Chip tone="neutral">{materials.wall.name} walls</Chip>
          ) : null}
          <Chip tone="neutral">WWR {Math.round(parameters.windowToWallRatio * 100)}%</Chip>
          <Chip tone="neutral">Orient {parameters.orientation}°</Chip>
        </div>
      </ThreeDPreviewCard>

      {/* ----- Comfort + energy + cost ----- */}
      <div className="flex flex-col gap-4">
        <PastelCard tone="lavender" eyebrow="Thermal comfort" icon={Flame}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-[13.5px] leading-snug opacity-85">
                Free-running hours inside the ASHRAE 55 adaptive band.
                Higher is more comfortable without HVAC.
              </p>
              {metrics ? (
                <p className="mt-3 text-[12px] opacity-70">
                  Conditioned PMV {num(metrics.conditionedPmv, 2)} · PPD {num(metrics.conditionedPpd, 1)}%
                </p>
              ) : null}
            </div>
            <Gauge
              value={comfortPct / 100}
              size={140}
              color="hsl(262 50% 50%)"
              subline="comfort hours"
            />
          </div>
        </PastelCard>

        <div className="grid grid-cols-2 gap-4">
          <PastelCard tone="yellow" eyebrow="Annual energy" icon={Sparkles}>
            <span className="metric-display text-[1.7rem]">{num(energyKwh, 0)}</span>
            <span className="ml-1 text-[13px] font-medium opacity-70">kWh/yr</span>
            <p className="mt-2 text-[12px] opacity-75">
              {metrics ? `${num(metrics.energyUseIntensity, 1)} kWh/m²·yr` : '—'}
            </p>
          </PastelCard>

          <PastelCard tone="pink" eyebrow="Construction" icon={Layers3}>
            <span className="metric-display text-[1.7rem]">
              {costPerSqm !== undefined ? `₹${Math.round(costPerSqm).toLocaleString('en-IN')}` : '—'}
            </span>
            <span className="ml-1 text-[13px] font-medium opacity-70">/m²</span>
            <p className="mt-2 text-[12px] opacity-75">Indicative Indian market rates</p>
          </PastelCard>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The reading — what the system found, stated before the numbers      */
/* ------------------------------------------------------------------ */

/**
 * The landing page's verdict band.
 *
 * The brief's success criterion is that within 5–10 seconds a user can
 * identify the main thermal condition, target compliance, the major
 * problem and the next action. Before this band the dashboard showed
 * *numbers* — temperature, solar gain, heat flow — but never said
 * whether any of it was good. A reviewer had to know what 31.7 °C meant
 * relative to the adaptive band before they could judge the design.
 *
 * This states the judgement first, names the dominant fabric path, and
 * links straight to the page that explains it. It reads the same hook
 * Thermal Analysis uses, so the two pages cannot disagree.
 */
function ThermalReadingBand() {
  const reading = useThermalReading();
  const isGenerating = useDesignStore((s) => s.isGenerating);

  /* While a run is in flight the reading below is the previous result.
     Saying so is the difference between a page that is quietly wrong for
     a few seconds and one that is honest about it. */
  if (isGenerating && !reading) {
    return (
      <div className="soft-card px-6 py-5" role="status" aria-live="polite">
        <p className="section-eyebrow">Thermal condition</p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Calculating thermal response…
        </p>
      </div>
    );
  }

  if (!reading) return null;

  return (
    <Reveal>
      <section
        aria-labelledby="dashboard-reading"
        className="soft-card flex flex-wrap items-start justify-between gap-x-8 gap-y-4 p-6"
      >
        <div className="min-w-0 max-w-[680px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="section-eyebrow" id="dashboard-reading">
              Thermal condition
            </p>
            <VerdictChip verdict={reading.verdictTone} />
            {isGenerating ? (
              <span className="text-[11.5px] text-muted-foreground">
                previous run
              </span>
            ) : null}
          </div>

          <p className="mt-2 font-display text-[20px] font-semibold leading-snug tracking-[-0.02em] text-foreground">
            {reading.verdict}
          </p>

          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
            <b className="font-semibold capitalize text-foreground/90">
              {reading.top.label}
            </b>{' '}
            is the weakest point in the fabric, and ventilation{' '}
            {reading.ventilationKwh >= 0 ? 'adds' : 'removes'}{' '}
            <b className="font-semibold tabular-nums text-foreground/90">
              {num(Math.abs(reading.ventilationKwh), 1)} kWh/day
            </b>{' '}
            on the representative day. Comfort sits at{' '}
            <b className="font-semibold tabular-nums text-foreground/90">
              {pct(reading.comfort, 0)}
            </b>{' '}
            of the year with no plant running.
          </p>
        </div>

        {/* The two numbers that make the verdict checkable, plus the way
           to the page that explains it. */}
        <div className="flex shrink-0 flex-col items-start gap-3">
          <dl className="flex items-end gap-x-7">
            <div>
              <dt className="stat-label">Fabric loss</dt>
              <dd className="mt-0.5 text-[19px] font-semibold tabular-nums leading-none text-foreground">
                {num(reading.envelopeTotal, 1)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  kWh/day
                </span>
              </dd>
            </div>
            <div>
              <dt className="stat-label">Solar gain</dt>
              <dd className="mt-0.5 text-[19px] font-semibold tabular-nums leading-none text-foreground">
                {num(reading.solarGainKwh, 1)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  kWh/day
                </span>
              </dd>
            </div>
          </dl>
          <Link
            href="/dashboard/analysis"
            className="link-action inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
          >
            See the full thermal analysis
            <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      </section>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const isGenerating = useDesignStore((s) => s.isGenerating);

  return (
    <div className="page-pad page-gap">
      {/* No PageHeader here. The shell's Topbar already renders this page's
         `<h1>` ("Dashboard") and description — it does so for every route,
         reading them from `shell/nav.ts`. Repeating them here printed
         "Dashboard / How is my current design doing?" twice, stacked, and
         was the only remaining page doing so. The status badge that used
         to live in the header is now stated inline where the climate is
         named, in the Greeting band below. */}

      <Greeting />

      <PipelineStrip />

      {/* What the system found, before the numbers that back it up. */}
      <ThermalReadingBand />

      {/* Generating banner — only shown while a run is in flight. */}
      {isGenerating ? (
        <div
          className="flex items-center gap-3 rounded-[18px] border px-4 py-3"
          style={{
            borderColor: 'hsl(18 68% 44% / 0.3)',
            background: 'hsl(18 68% 44% / 0.06)',
          }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: 'hsl(18 68% 44%)' }}
            aria-hidden
          />
          <p className="text-[13px] font-medium text-foreground">
            Running the pipeline — climate, analysis, thermal, optimisation, geometry.
          </p>
        </div>
      ) : null}

      <SectionHeader
        eyebrow="Outputs"
        title="Indoor temperature · Solar gain · Heat flow"
        description="The three quantities the problem statement asks for, read off a representative day."
      />
      <HeadlineOutputs />

      <SectionHeader
        eyebrow="Current design"
        title="What the live building looks like"
        description="3D preview and the comfort / energy / cost the model just computed."
      />
      <CurrentDesignPreview />

      {/* Subtle footer link — preserves the demo's headline destination
         without burying it as one of four jump-cards. */}
      <Link
        href="/dashboard/scenarios"
        className={cn(
          'card-hover group flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[20px] border bg-panel px-5 py-4',
        )}
        style={{ borderColor: 'hsl(218 100% 88%)' }}
      >
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'hsl(var(--pastel-blue))' }}
        >
          <GitCompare size={16} className="text-foreground/80" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">
            Climate Response Lab — see the design change with the climate
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            Hold the site and vary the building type, or hold the building and vary the
            site. The strongest demo page of this project.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-primary">
          Open the lab
          <ArrowRight
            size={14}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </Link>

      {/* Two quieter alternatives, replacing the four equal-weight quick-action
         cards. The page ends on one decision, with the rest demoted to text. */}
      <nav
        aria-label="Other destinations"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1"
      >
        <Link
          href="/dashboard/design"
          className="link-action inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <SlidersHorizontal size={13} aria-hidden />
          Open Design Studio — tune parameters live
        </Link>
        <Link
          href="/dashboard/optimization"
          className="link-action inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Sparkles size={13} aria-hidden />
          Optimization — what the optimizer changed
        </Link>
        <Link
          href="/dashboard/materials"
          className="link-action inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Layers3 size={13} aria-hidden />
          Materials — the envelope library
        </Link>
      </nav>
    </div>
  );
}