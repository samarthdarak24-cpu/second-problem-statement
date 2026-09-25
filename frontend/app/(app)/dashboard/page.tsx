'use client';

/**
 * Overview — the page you land on.
 *
 * Answers three questions in order: *where am I*, *how did the design do*, and
 * *what should I look at next*. Everything here is a summary of something that
 * has a dedicated page, and each block links to it, so this page is a map rather
 * than a second place to do the work.
 */

import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  Droplets,
  GitCompare,
  Mountain,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, Panel, StatCard } from '@/components/ui/primitives';
import { ViewportPanel } from '@/components/dashboard/ViewportPanel';
import { RecommendationPanel } from '@/components/dashboard/RecommendationPanel';
import { ShelterResultPanel } from '@/components/dashboard/ShelterResultPanel';
import { CHALLENGE_LABEL, ZONE_LABEL, ZONE_NOTE } from '@/lib/labels';
import { currency, energy, monthLabel, num, temp, windLabel } from '@/utils/format';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Site hero                                                           */
/* ------------------------------------------------------------------ */

function SiteHero() {
  const location = useDesignStore((state) => state.location);
  const climateData = useDesignStore((state) => state.climateData);
  const analysis = useDesignStore((state) => state.climateAnalysis);

  if (!location) {
    return (
      <Panel title="Site" accent="input">
        <EmptyState message="No site selected" hint="Choose a country and city above." />
      </Panel>
    );
  }

  const summary = climateData?.summary;
  const design = climateData?.designConditions;

  const facts = [
    {
      icon: Thermometer,
      label: 'Annual mean',
      value: summary ? temp(summary.avgTemperature) : '—',
      hint: 'Mean outdoor air temperature across the year',
    },
    {
      icon: Sun,
      label: 'Diurnal swing',
      value: summary ? `${num(summary.diurnalSwing)} K` : '—',
      hint: 'Typical day-to-night temperature range — the driver for thermal mass',
    },
    {
      icon: Droplets,
      label: 'Annual rainfall',
      value: summary ? `${num(summary.rainfall, 0)} mm` : '—',
      hint: 'Total precipitation, used in the Köppen classification',
    },
    {
      icon: Wind,
      label: 'Mean wind',
      value: summary ? windLabel(summary.windSpeed) : '—',
      hint: 'Annual mean wind speed at the site',
    },
    {
      icon: Mountain,
      label: 'Elevation',
      value: `${num(location.elevation, 0)} m`,
      hint: 'Site elevation above mean sea level',
    },
    {
      icon: Compass,
      label: 'Coordinates',
      value: `${num(location.latitude, 2)}°, ${num(location.longitude, 2)}°`,
      hint: 'Latitude and longitude',
    },
  ];

  return (
    <Panel
      title="Site context"
      subtitle={`${location.city}, ${location.state}, ${location.country}`}
      accent="input"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* --- Narrative --- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {climateData ? (
              <>
                <Chip tone="accent" title={climateData.climateType}>
                  {ZONE_LABEL[climateData.climateZone]}
                </Chip>
                <Chip tone="neutral">{climateData.climateType}</Chip>
              </>
            ) : (
              <Chip tone="neutral">Resolving climate…</Chip>
            )}
          </div>

          {analysis ? (
            <>
              <p className="mt-3.5 text-[13px] font-semibold text-foreground">
                {CHALLENGE_LABEL[analysis.mainChallenge]}
              </p>
              <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
                {analysis.challengeDetail}
              </p>
            </>
          ) : (
            <p className="mt-3.5 text-[13px] leading-relaxed text-muted-foreground">
              {climateData ? ZONE_NOTE[climateData.climateZone] : 'Analysing the site…'}
            </p>
          )}

          {design ? (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <p className="stat-label">Cooling degree days</p>
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">
                  {num(design.coolingDegreeDays, 0)}
                  <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                    K·day
                  </span>
                </p>
              </div>
              <div>
                <p className="stat-label">Heating degree days</p>
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">
                  {num(design.heatingDegreeDays, 0)}
                  <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                    K·day
                  </span>
                </p>
              </div>
              {summary ? (
                <div>
                  <p className="stat-label">Peak month</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-foreground">
                    {monthLabel(summary.peakCoolingMonth)}
                    <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
                      cooling
                    </span>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* --- Facts grid --- */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div key={fact.label} className="min-w-0" title={fact.hint}>
                <span className="flex items-center gap-1.5 text-muted-foreground/70">
                  <Icon size={12} aria-hidden />
                  <span className="stat-label">{fact.label}</span>
                </span>
                <p className="mt-1 truncate text-[15px] font-semibold tabular-nums text-foreground">
                  {fact.value}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* KPI row                                                             */
/* ------------------------------------------------------------------ */

function KpiRow() {
  const metrics = useDesignStore((state) => state.metrics);
  const baselineMetrics = useDesignStore((state) => state.baselineMetrics);
  const score = useDesignStore((state) => state.score);
  const baselineScore = useDesignStore((state) => state.baselineScore);
  const cost = useDesignStore((state) => state.cost);
  const baselineCost = useDesignStore((state) => state.baselineCost);

  if (!metrics || !baselineMetrics) {
    return (
      <Panel title="Key results" accent="output">
        <EmptyState
          message="No results yet"
          hint="Press Generate design to run the climate → thermal → optimisation pipeline."
        />
      </Panel>
    );
  }

  const comfortDelta =
    metrics.adaptiveComfortHoursPct - baselineMetrics.adaptiveComfortHoursPct;
  const energyDelta = metrics.annualEnergy - baselineMetrics.annualEnergy;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Design score"
        value={`${score}`}
        unit={`/ 100`}
        tone={score >= baselineScore ? 'good' : 'bad'}
        meter={score / 100}
        delta={{ value: score - baselineScore, unit: ' pts' }}
        hint={`Weighted objective. Conventional construction scores ${baselineScore}.`}
      />
      <StatCard
        label="Adaptive comfort"
        value={num(metrics.adaptiveComfortHoursPct, 0)}
        unit="% of hours"
        tone={metrics.adaptiveComfortHoursPct >= 60 ? 'good' : 'warn'}
        meter={metrics.adaptiveComfortHoursPct / 100}
        delta={{ value: comfortDelta, unit: ' pp' }}
        hint="Share of the year inside the ASHRAE 55 adaptive comfort band, free-running"
      />
      <StatCard
        label="Energy intensity"
        value={energy(metrics.energyUseIntensity)}
        unit="kWh/m²·yr"
        tone={metrics.energyUseIntensity < 40 ? 'good' : 'warn'}
        delta={{ value: energyDelta, unit: ' kWh' }}
        hint="Annual delivered energy per square metre of floor area"
      />
      <StatCard
        label="Construction cost"
        value={currency(cost?.costPerSqm ?? 0)}
        unit="/ m²"
        tone="neutral"
        delta={
          cost && baselineCost ? { value: cost.costPerSqm - baselineCost.costPerSqm, unit: ' ₹' } : undefined
        }
        hint="Indicative Indian market rates — a trade-off tool, not a tender price"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/** A link card that names the next page and why you would go there. */
function JumpCard({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center justify-between gap-4 rounded-xl border bg-card/50 px-4 py-3.5',
        'transition-colors hover:border-primary/40 hover:bg-card/80',
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight
        size={15}
        className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

export default function OverviewPage() {
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const durationMs = useDesignStore((state) => state.durationMs);
  const climateNote = useDesignStore((state) => state.climateNote);
  const viewportExpanded = useDesignStore((state) => state.viewportExpanded);

  return (
    <div className="space-y-6">
      {isGenerating ? (
        <div
          className="flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{
            borderColor: 'hsl(var(--primary) / 0.3)',
            background: 'hsl(var(--primary) / 0.07)',
          }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: 'hsl(var(--primary))' }}
            aria-hidden
          />
          <p className="text-[13px] text-muted-foreground">
            Running the pipeline — climate, analysis, thermal, optimisation, geometry.
          </p>
        </div>
      ) : null}

      <SiteHero />

      {/* The three quantities the problem statement asks for, before anything
          the optimiser invented. Indoor temperature, solar gain and heat flow
          are the checkable engineering outputs; the composite design score is
          an internal search artefact and now sits below them. */}
      <ShelterResultPanel />

      <KpiRow />

      <div
        className={cn(
          'grid gap-6',
          /* Expanded: viewport alone, full width, taller — the recommendation
             panel hides because it is exactly the information the user is
             asking the viewport to take the room of. */
          viewportExpanded
            ? 'xl:grid-cols-1'
            : 'xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 flex-col',
            viewportExpanded ? 'xl:h-[820px]' : 'h-[520px]',
          )}
        >
          <ViewportPanel />
        </div>
        {viewportExpanded ? null : (
          <div className="flex h-[520px] min-w-0 flex-col">
            <RecommendationPanel />
          </div>
        )}
      </div>

      {/* The headline demonstration gets its own band rather than a slot in the
          jump-card row: it is the one page that shows the *conditional* claim
          the project is built on, and burying it beside three navigation links
          would make it read as another navigation link. */}
      <Link
        href="/dashboard/scenarios"
        className={cn(
          'group flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3.5',
          'transition-colors hover:border-primary/45',
        )}
        style={{
          borderColor: 'hsl(var(--primary) / 0.35)',
          background: 'hsl(var(--primary) / 0.06)',
        }}
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'hsl(var(--primary) / 0.14)' }}
        >
          <GitCompare size={16} style={{ color: 'hsl(var(--primary))' }} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-foreground">
            Climate Response Lab — see the design change with the climate
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Hold the site and vary the building type, or hold the building and vary the site. Five
            optimisations per sweep, every result drawn from its own geometry, with the parameters
            that changed and the reason each one changed.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-primary">
          Open the lab
          <ArrowRight
            size={14}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <JumpCard
          href="/dashboard/design"
          label="Design Studio"
          detail="Move the parameters and watch the 3D model, comfort and energy move together."
        />
        <JumpCard
          href="/dashboard/analysis"
          label="Thermal Analysis"
          detail="The monthly heat balance and the ISO 7730 PMV/PPD breakdown."
        />
        <JumpCard
          href="/dashboard/optimization"
          label="Optimisation"
          detail="What the search changed, and what each change was worth."
        />
        <JumpCard
          href="/dashboard/method"
          label="Method & Limits"
          detail="How these numbers are produced — and what they are not."
        />
      </div>

      {climateNote || durationMs > 0 ? (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground/55">
          {climateNote}
          {durationMs > 0 ? ` Pipeline ran in ${Math.round(durationMs)} ms.` : ''}
        </p>
      ) : null}
    </div>
  );
}
