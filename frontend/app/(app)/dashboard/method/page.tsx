'use client';

/**
 * Method & Limits.
 *
 * The most important page in the application. Every number this tool produces is
 * an estimate from a simplified model, and a tool that does not say so is worse
 * than useless — it is confidently misleading. So this page states the method,
 * the standards it follows, and the specific things it does *not* claim.
 *
 * It is written to be read by a jury, an architect, or a future maintainer, and
 * it is deliberately not marketing copy.
 */

import { AlertTriangle, ArrowRight, Calculator, FlaskConical, Ruler, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Panel } from '@/components/ui/primitives';

/* ------------------------------------------------------------------ */

const PIPELINE = [
  {
    step: '01',
    title: 'Climate',
    body:
      'The site is resolved from a stored climatology of 33 stations, or from the Open-Meteo archive when the network is available, or synthesised from latitude and elevation as a last resort. The provider actually used is named in the interface rather than hidden.',
  },
  {
    step: '02',
    title: 'Analysis',
    body:
      'The monthly normals are classified (Köppen-style) and read as a design problem: the dominant thermal challenge, the ventilation strategy, the insulation level, shading, glazing and orientation the climate argues for. Each recommendation carries its reason.',
  },
  {
    step: '03',
    title: 'Thermal',
    body:
      'A quasi-steady-state monthly heat balance, hour-resolved within each month, over a 12-month cycle. Conduction through a multi-layer envelope, sol-air temperature on opaque surfaces, area-weighted tilted-plane irradiance for pitched roofs, ventilation limited to hours when outside air is actually cooler than the space, and internal gains from occupants and lighting.',
  },
  {
    step: '04',
    title: 'Comfort',
    body:
      'Free-running comfort is judged with the ASHRAE 55 adaptive model, because ISO 7730 PMV was calibrated for conditioned spaces at fixed clothing and systematically misjudges naturally ventilated buildings. PMV and PPD are reported separately for the conditioned case, so the two are never conflated into one number.',
  },
  {
    step: '05',
    title: 'Optimisation',
    body:
      'A coordinate-descent search over a curated neighbourhood around the climate engine’s recommendation — roughly 30–60 candidates rather than the full cross product, which runs to tens of thousands and where the marginal candidate does not change the answer.',
  },
  {
    step: '06',
    title: 'Results',
    body:
      'The chosen design is compared against conventional local construction for the same programme, measured on the same engine, so the comparison isolates the design decisions rather than confounding them with a different model.',
  },
];

const LIMITS = [
  {
    title: 'Monthly, not hourly',
    body:
      'The heat balance is quasi-steady-state on monthly normals with an intra-month hour model. It cannot represent a cold snap, a heatwave, or the thermal response of a heavy wall on a specific day. Annual and seasonal figures are meaningful; single-day peaks are indicative.',
  },
  {
    title: 'No airflow network',
    body:
      'Ventilation is a bulk air-change rate, not a solved pressure network. It captures the strategy — night purge versus sealed mechanical — but not the airflow between rooms or the effect of a specific opening position.',
  },
  {
    title: 'The heat map shows absorbed radiation',
    body:
      'The 3D heat map colours surfaces by absorbed solar radiation, not by surface temperature. The model does not solve for temperature in space, so it does not claim to. The legend says which quantity is being shown.',
  },
  {
    title: 'Ventilation ACH is a capacity, not a rate',
    body:
      'A high air-change figure in a cold climate is not a winter heat loss: the model applies ventilation only when the outside air is cooler than the space. Reading the number as a constant operating rate would be wrong.',
  },
  {
    title: 'Cost is a trade-off tool',
    body:
      'Rates are indicative Indian market figures meant to rank options against each other. They are not a quantity surveyor’s estimate and must not be used to price a tender. The budget is a soft constraint: an overrun is reported, not blocked.',
  },
  {
    title: 'The surrogate is a screening aid',
    body:
      'Where a trained surrogate is available it ranks candidate designs; it does not replace the physics engine, and every prediction it makes is shown with its held-out mean absolute error. The design that gets built is always evaluated by the thermal model itself.',
  },
];

const STANDARDS = [
  { label: 'ISO 7730', detail: 'PMV / PPD thermal comfort index' },
  { label: 'ASHRAE 55', detail: 'Adaptive comfort for naturally ventilated spaces' },
  { label: 'Köppen–Geiger', detail: 'Climate classification (simplified)' },
  { label: 'ASHRAE Handbook', detail: 'Clear-sky irradiance and sol-air temperature' },
  { label: 'NOAA', detail: 'Solar position algorithm' },
  { label: 'Erbs', detail: 'Diffuse fraction correlation' },
];

/* ------------------------------------------------------------------ */

export default function MethodPage() {
  return (
    <div className="space-y-6">
      {/* ---------------- Headline ---------------- */}
      <Panel title="What this tool is" accent="output">
        <div className="space-y-4">
          <p className="max-w-[860px] text-[14px] leading-relaxed text-foreground">
            A climate-responsive shelter designer for a specific site. You give it a location and a
            programme; it works out what that climate asks of a building, designs an envelope that
            answers it, and reports the thermal, energy and cost consequences of that design against
            conventional local construction.
          </p>

          <div
            className="flex items-start gap-3 rounded-lg border px-4 py-3.5"
            style={{
              borderColor: 'hsl(var(--warning) / 0.35)',
              background: 'hsl(var(--warning) / 0.08)',
            }}
          >
            <AlertTriangle
              size={16}
              className="mt-[3px] shrink-0"
              style={{ color: 'hsl(var(--warning))' }}
              aria-hidden
            />
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                Every figure is an engineering estimate
              </p>
              <p className="mt-1 max-w-[800px] text-[12.5px] leading-relaxed text-muted-foreground">
                The output of a simplified quasi-steady-state monthly heat-balance model. It is{' '}
                <strong className="font-semibold text-foreground">not a measurement</strong>, and
                not a validated whole-building simulation. Design conditions are documented
                approximations of ASHRAE percentiles, not a percentile analysis over hourly records.
                Use it to compare design options and reason about strategy — validate with measured
                data before construction.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* ---------------- Pipeline ---------------- */}
      <Panel
        title="How a result is produced"
        subtitle="Six stages, in order — the same order the interface presents them in"
        accent="analysis"
      >
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {PIPELINE.map((entry) => (
            <div key={entry.step} className="rounded-lg border bg-card/40 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[12px] font-semibold text-primary">
                  {entry.step}
                </span>
                <span className="text-[13px] font-semibold text-foreground">{entry.title}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                {entry.body}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------------- Limits ---------------- */}
      <Panel
        title="What it does not claim"
        subtitle="The specific limitations, stated rather than discovered later"
        accent="optimize"
      >
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {LIMITS.map((limit) => (
            <div
              key={limit.title}
              className="rounded-lg border bg-card/40 px-4 py-3.5"
              style={{ borderColor: 'hsl(var(--warning) / 0.22)' }}
            >
              <p className="text-[13px] font-semibold text-foreground">{limit.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {limit.body}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------------- Standards ---------------- */}
      <Panel
        title="Standards and methods followed"
        subtitle="Each number traces back to one of these"
        accent="input"
      >
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {STANDARDS.map((standard) => (
            <div key={standard.label} className="flex items-start gap-2.5">
              <ShieldCheck
                size={14}
                className="mt-[2px] shrink-0"
                style={{ color: 'hsl(var(--success))' }}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{standard.label}</p>
                <p className="text-[12px] leading-snug text-muted-foreground">{standard.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------------- Verify it yourself ---------------- */}
      <Panel
        title="Verify it yourself"
        subtitle="Nothing here asks to be taken on trust"
        accent="neutral"
      >
        <div className="space-y-4">
          <p className="max-w-[860px] text-[13px] leading-relaxed text-muted-foreground">
            The project ships its own test suites, and they run offline. The thermal model is
            checked against published PMV reference values and closed-form periodic-response
            results; the climate port is checked against the TypeScript engine for all 33 stations
            and every month; the wire contract is checked field by field.
          </p>

          <div className="flex flex-wrap gap-3">
            {[
              { icon: FlaskConical, label: 'npm run verify', detail: 'typecheck + 70 assertions' },
              { icon: Calculator, label: 'pytest', detail: '223 backend tests' },
              { icon: Ruler, label: 'npm run bench', detail: 'optimiser timing' },
            ].map((entry) => {
              const Icon = entry.icon;
              return (
                <div
                  key={entry.label}
                  className="flex items-center gap-3 rounded-lg border bg-card/40 px-4 py-3"
                >
                  <Icon size={16} className="shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-mono text-[12.5px] text-foreground">{entry.label}</p>
                    <p className="text-[11.5px] text-muted-foreground">{entry.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <Link
            href="/dashboard/model"
            className="inline-flex items-center gap-2 text-[13px] font-medium text-primary hover:underline"
          >
            See the ML surrogate’s measured accuracy
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </Panel>
    </div>
  );
}
