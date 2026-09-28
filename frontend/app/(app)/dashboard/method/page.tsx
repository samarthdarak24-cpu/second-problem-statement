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

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  FlaskConical,
  Gauge,
  Play,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { Panel, Chip, MetricRow, Segmented } from '@/components/ui/primitives';
import { ModelPanel } from '@/components/dashboard/ModelPanel';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';
import { evaluateDesign } from '@/optimization/pipeline';
import { DEFAULT_WEIGHTS } from '@/optimization/objective';
import {
  runUncertainty,
  UNCERTAINTY_INPUTS,
  type UncertaintyResult,
} from '@/lib/uncertainty';
import {
  VALIDATION_ROWS,
  VALIDATION_STATUS,
  VALIDATION_VERDICT,
  validationCounts,
  type ValidationStatus,
} from '@/lib/validation';
import { num } from '@/utils/format';

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
    title: 'Four maps, four different quantities',
    body:
      'The 3D model shows absorbed solar radiation, estimated surface temperature, signed conduction heat flux and dew-point margin — four separate derivations, each with its own ramp and its own legend. The surface temperature is a first-order estimate from a lumped U-value, not a conduction solve, and the model does not resolve temperature in space. The legends say which quantity is being shown, and the two are never conflated.',
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

/**
 * Where a value sits across an output's sampled range, as a percentage.
 *
 * Drawn against the full sampled min–max rather than the percentile band so the
 * band's position is honest: a narrow band in the middle of a wide range looks
 * different from a narrow band that spans the whole range.
 */
function positionOf(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (span < 1e-9) return 50;
  return Math.max(0, Math.min(100, ((value - range.min) / span) * 100));
}

/** Sample counts offered for the sensitivity run. */
const SAMPLE_OPTIONS = [
  { value: '32' as const, label: '32' },
  { value: '64' as const, label: '64' },
  { value: '128' as const, label: '128' },
];
type SampleOption = (typeof SAMPLE_OPTIONS)[number]['value'];

export default function MethodPage() {
  const climateData = useDesignStore((s) => s.climateData);
  const parameters = useDesignStore((s) => s.currentParameters);

  const [samples, setSamples] = useState<SampleOption>('64');
  const [running, setRunning] = useState(false);
  const [uncertainty, setUncertainty] = useState<UncertaintyResult | null>(null);

  /* The analysis re-runs the real engine once per sample, so it is a deliberate
     action rather than something that fires on every slider drag. It does run
     once automatically, though — a page about uncertainty that opens with an
     empty panel has failed to make its point. */
  const hasAutoRun = useRef(false);

  const run = (count: SampleOption) => {
    if (!climateData) return;
    setRunning(true);
    /* Yield a frame so the button's running state paints before the engine
       blocks the main thread for a few hundred milliseconds. */
    window.setTimeout(() => {
      setUncertainty(
        runUncertainty({
          base: parameters,
          climate: climateData,
          samples: Number(count),
          evaluate: (candidate) => {
            const evaluated = evaluateDesign(candidate, climateData, DEFAULT_WEIGHTS);
            return { thermal: evaluated.thermal, geometry: evaluated.geometry };
          },
        }),
      );
      setRunning(false);
    }, 30);
  };

  useEffect(() => {
    if (hasAutoRun.current || !climateData) return;
    hasAutoRun.current = true;
    run('64');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [climateData]);

  const counts = validationCounts();

  return (
    <div className="page-pad page-gap">
      {/* ---------------- Identity ---------------- */}
      <SectionHeader
        eyebrow="Reference · method & limits"
        title="What this tool is, and what it does not claim"
        description="Every number this tool produces is an estimate from a simplified model, and a tool that does not say so is not merely useless — it is confidently misleading. This page is written to be read by a jury, an architect or a future maintainer, and is not marketing copy."
        right={<StatusBadge tone="updated" label="Model estimate" />}
      />

      {/* ---------------- Headline agreement ---------------- */}
      <div
        className="soft-card flex flex-wrap items-start gap-x-8 gap-y-4 px-6 py-5"
        style={{ background: 'hsl(var(--pastel-yellow))', borderColor: 'hsl(48 100% 82%)' }}
      >
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'hsl(0 0% 100% / 0.6)', color: 'hsl(38 60% 26%)' }}
        >
          <ShieldCheck size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">
            Model estimate — not a measured building result.
          </p>
          <p className="mt-1.5 max-w-[900px] text-[13px] leading-relaxed text-foreground/75">
            A climate-responsive shelter designer for a specific site. You give it a location and a
            programme; it works out what that climate asks of a building, designs an envelope that
            answers it, and reports the thermal, energy and cost consequences against conventional
            local construction. Use it to compare design options and reason about strategy —
            validate with measured data before construction.
          </p>
        </div>
      </div>

      {/* ---------------- The estimate caveat, in full ---------------- */}
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

      {/* ---------------- Validation architecture ---------------- */}
      <Panel
        title="How each number is validated"
        subtitle="Every quantity this platform reports, and what — if anything — it is checked against"
        accent="analysis"
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={VALIDATION_STATUS.reference.tone}>{counts.reference} reference</Chip>
            <Chip tone={VALIDATION_STATUS.consistency.tone}>{counts.consistency} consistency</Chip>
            <Chip tone={VALIDATION_STATUS.declared.tone}>{counts.declared} declared</Chip>
            <Chip tone={VALIDATION_STATUS.deferred.tone}>{counts.deferred} deferred</Chip>
          </div>
        }
      >
        <p className="max-w-[900px] text-[13px] leading-relaxed text-foreground/80">
          {VALIDATION_VERDICT}
        </p>

        {/* --- What each status means --- */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(VALIDATION_STATUS) as ValidationStatus[]).map((status) => {
            const meta = VALIDATION_STATUS[status];
            return (
              <div key={status} className="rounded-lg border bg-card/40 px-3.5 py-3">
                <Chip tone={meta.tone}>{meta.label}</Chip>
                <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
                  {meta.meaning}
                </p>
              </div>
            );
          })}
        </div>

        {/* --- The table --- */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Quantity</th>
                <th className="py-2 pr-3 font-semibold">Computed by</th>
                <th className="py-2 pr-3 font-semibold">Checked against</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 font-semibold">What that means</th>
              </tr>
            </thead>
            <tbody>
              {VALIDATION_ROWS.map((row) => {
                const meta = VALIDATION_STATUS[row.status];
                return (
                  <tr key={row.quantity} className="border-b border-border/40 align-top">
                    <td className="py-2.5 pr-3 font-medium text-foreground">{row.quantity}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11.5px] text-muted-foreground">
                      {row.computedBy}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{row.checkedAgainst}</td>
                    <td className="py-2.5 pr-3">
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                    </td>
                    <td className="py-2.5 text-[12px] leading-snug text-muted-foreground">
                      {row.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[12px] leading-snug text-muted-foreground/70">
          There is deliberately no “validated” status. Nothing here has been validated against
          measured shelter data, and a table that implied otherwise would be worse than no table.
        </p>
      </Panel>

      {/* ---------------- Uncertainty ---------------- */}
      <Panel
        title="How much does the answer move?"
        subtitle="The real engine, re-run over documented input ranges — a band, not a single number"
        accent="optimize"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<SampleOption>
              options={SAMPLE_OPTIONS}
              value={samples}
              onChange={(value) => {
                setSamples(value);
                run(value);
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => run(samples)}
              disabled={!climateData || running}
              title={
                climateData
                  ? 'Re-run the sensitivity analysis on the current design'
                  : 'Load a design first'
              }
            >
              <Play size={13} aria-hidden />
              {running ? 'Running…' : 'Re-run'}
            </button>
          </div>
        }
      >
        {!climateData ? (
          <p className="text-[13px] text-muted-foreground">
            Generate a design first — this analysis perturbs the live design and re-simulates it, so
            it needs something to perturb.
          </p>
        ) : (
          <>
            <p className="max-w-[900px] text-[13px] leading-relaxed text-foreground/80">
              Six inputs are varied within documented ranges and the heat balance is re-run for each
              sample. The result is a distribution rather than a point, plus which input is
              responsible for most of the spread — which is the part that changes a decision.
            </p>

            {/* --- The inputs and their ranges --- */}
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {UNCERTAINTY_INPUTS.map((input) => (
                <div key={input.key} className="rounded-lg border bg-card/40 px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {input.label}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-primary">
                      ±{(input.spread * 100).toFixed(0)} %
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    {input.basis}
                  </p>
                </div>
              ))}
            </div>

            {/* --- The band --- */}
            {uncertainty ? (
              <>
                <div className="mt-5 space-y-4">
                  {uncertainty.outputs.map((output) => (
                    <div key={output.key} className="rounded-lg border bg-card/40 px-3.5 py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground">
                          {output.label}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          baseline {num(output.baseline, 1)} {output.unit} · band{' '}
                          {num(output.p05, 1)}–{num(output.p95, 1)} {output.unit} (5th–95th) ·
                          σ {num(output.sd, 2)}
                        </span>
                      </div>

                      {/* The band drawn to scale, with the baseline marked. */}
                      <div className="relative mt-2.5 h-6">
                        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-secondary" />
                        <div
                          className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full"
                          style={{
                            left: `${positionOf(output.p05, output)}%`,
                            width: `${Math.max(0.6, positionOf(output.p95, output) - positionOf(output.p05, output))}%`,
                            background: 'hsl(var(--primary) / 0.45)',
                          }}
                        />
                        <div
                          className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
                          style={{
                            left: `${positionOf(output.baseline, output)}%`,
                            background: 'hsl(var(--foreground))',
                          }}
                          title={`Baseline ${output.baseline} ${output.unit}`}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
                        <span>{num(output.min, 1)}</span>
                        <span className="text-muted-foreground/60">
                          full sampled range, {uncertainty.sampleCount} samples
                        </span>
                        <span>{num(output.max, 1)}</span>
                      </div>

                      {/* Which input drives it. */}
                      <div className="mt-2.5 space-y-1">
                        {output.contributions.slice(0, 3).map((contribution) => (
                          <div
                            key={contribution.key}
                            className="flex items-center gap-2 text-[11.5px] text-muted-foreground"
                          >
                            <span className="w-[150px] shrink-0 truncate">{contribution.label}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${Math.max(1, contribution.index * 100)}%`,
                                  background: 'hsl(var(--primary))',
                                }}
                              />
                            </span>
                            <span className="w-[38px] shrink-0 text-right tabular-nums">
                              {(contribution.index * 100).toFixed(0)} %
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-1.5 rounded-lg border bg-card/40 px-3.5 py-3">
                  <MetricRow label="Samples" value={String(uncertainty.sampleCount)} />
                  <MetricRow label="Seed" value={String(uncertainty.seed)} />
                  <MetricRow label="Widest relative band" value={uncertainty.outputs.reduce((w, o) => (o.bandWidth / Math.max(1e-6, Math.abs(o.baseline)) > w.bandWidth / Math.max(1e-6, Math.abs(w.baseline)) ? o : w)).label} />
                </div>

                <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                  {uncertainty.summary}
                </p>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-muted-foreground">
                {running ? 'Running the analysis…' : 'No analysis yet.'}
              </p>
            )}

            <div
              className="mt-4 flex items-start gap-3 rounded-lg border px-3.5 py-3"
              style={{
                borderColor: 'hsl(var(--warning) / 0.35)',
                background: 'hsl(var(--warning) / 0.08)',
              }}
            >
              <Gauge
                size={15}
                className="mt-[2px] shrink-0"
                style={{ color: 'hsl(var(--warning))' }}
                aria-hidden
              />
              <div>
                <p className="text-[12.5px] font-semibold text-foreground">
                  What this band is, and is not
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  The index is the squared Spearman rank correlation between one input and one
                  output, normalised across inputs — a first-order, monotonic measure that{' '}
                  <strong className="font-semibold text-foreground/85">
                    ignores interactions between inputs
                  </strong>
                  . It is not a Sobol decomposition and not a probabilistic risk model. The ranges
                  are engineering judgements about as-built variation, not fitted distributions, and
                  the sampler is seeded so the same design always yields the same band.
                </p>
              </div>
            </div>
          </>
        )}
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

      {/* ---------------- The learned component ---------------- */}
      <div id="learned-component" className="scroll-mt-6 space-y-4">
        <SectionHeader
          eyebrow="Method · AI / model"
          title="The one learned component"
          description="Everything else on this page is derived. This is the only part of the system whose output is learned, so it is reported with its training set, its held-out score and the gate it had to clear."
        />
        <ModelPanel />
      </div>

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
            and every month; the defence layer, the ventilation controller, the plant model and the
            strategy comparison each carry their own assertions. The table above says, per quantity,
            what is checked and what is not.
          </p>

          <div className="flex flex-wrap gap-3">
            {[
              { icon: FlaskConical, label: 'npm run verify', detail: 'typecheck + 7 suites' },
              { icon: Calculator, label: 'npm run verify:defence', detail: '401 defence assertions' },
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

          <a
            href="#learned-component"
            className="inline-flex items-center gap-2 text-[13px] font-medium text-primary hover:underline"
          >
            See the ML surrogate’s measured accuracy
            <ArrowRight size={14} aria-hidden />
          </a>
        </div>
      </Panel>
    </div>
  );
}
