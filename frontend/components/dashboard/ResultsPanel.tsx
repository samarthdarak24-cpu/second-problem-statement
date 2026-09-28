'use client';

/**
 * The results panel.
 *
 * The organising idea is that a shelter has *two* comfort stories and reporting
 * them as one number is misleading:
 *
 *   FREE-RUNNING — what the envelope achieves with no plant at all. Judged
 *   against the ASHRAE 55 adaptive band, because that is the standard written
 *   for naturally ventilated buildings and it moves with the weather.
 *
 *   CONDITIONED — what the system delivers once it runs. This is where ISO 7730
 *   PMV/PPD belongs, and it is labelled as such.
 *
 * Every figure is tagged as a model estimate. Nothing here is a measurement.
 */

import { useState } from 'react';
import { Award, BarChart3, Coins, Gauge, Leaf, ShieldCheck, Thermometer, BrainCircuit } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, Meter, MetricRow, Panel, StatCard } from '@/components/ui/primitives';
import {
  currency,
  energyPerYear,
  num,
  pct,
  pmvSensation,
  ppdBand,
  signedCurrency,
  signedPct,
  temp,
  uValue,
} from '@/utils/format';
import { MONTH_LABELS } from '@/utils/units';
import type { Tone } from '@/components/ui/primitives';

/* ------------------------------------------------------------------ */
/* Tone helpers                                                        */
/* ------------------------------------------------------------------ */

function comfortTone(share: number): Tone {
  if (share >= 75) return 'good';
  if (share >= 45) return 'warn';
  return 'bad';
}

function ppdTone(ppd: number): Tone {
  const band = ppdBand(ppd);
  return band === 'excellent' || band === 'good' ? 'good' : band === 'fair' ? 'warn' : 'bad';
}

function intensityTone(eui: number): Tone {
  if (eui <= 30) return 'good';
  if (eui <= 70) return 'warn';
  return 'bad';
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

type Tab = 'comfort' | 'energy' | 'cost' | 'search';

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: 'comfort', label: 'Comfort', icon: <Thermometer size={13} aria-hidden /> },
  { value: 'energy', label: 'Energy', icon: <Leaf size={13} aria-hidden /> },
  { value: 'cost', label: 'Cost', icon: <Coins size={13} aria-hidden /> },
  { value: 'search', label: 'Search', icon: <BarChart3 size={13} aria-hidden /> },
];

export function ResultsPanel() {
  const [tab, setTab] = useState<Tab>('comfort');

  const thermal = useDesignStore((state) => state.currentThermal);
  const metrics = useDesignStore((state) => state.metrics);
  const baselineMetrics = useDesignStore((state) => state.baselineMetrics);
  const cost = useDesignStore((state) => state.cost);
  const baselineCost = useDesignStore((state) => state.baselineCost);
  const score = useDesignStore((state) => state.score);
  const baselineScore = useDesignStore((state) => state.baselineScore);
  const comparison = useDesignStore((state) => state.comparison);
  const optimization = useDesignStore((state) => state.optimization);
  const leaderboard = useDesignStore((state) => state.leaderboard);
  const surrogateScreening = useDesignStore((state) => state.surrogateScreening);
  const evaluations = useDesignStore((state) => state.evaluations);
  const engine = useDesignStore((state) => state.engine);
  const engineDescription = useDesignStore((state) => state.engineDescription);
  const mode = useDesignStore((state) => state.mode);
  const climateData = useDesignStore((state) => state.climateData);
  const materials = useDesignStore((state) => state.materials);
  const durationMs = useDesignStore((state) => state.durationMs);
  const budget = useDesignStore((state) => state.currentParameters.budget);

  if (!metrics || !thermal || !cost || !climateData) {
    return (
      <Panel title="Results" subtitle="Thermal, energy and cost" accent="output" scroll>
        <EmptyState
          message="No results yet"
          hint="Press Generate design to run the pipeline."
        />
      </Panel>
    );
  }

  const summerMonth = climateData.summary.peakCoolingMonth;
  const winterMonth = climateData.summary.peakHeatingMonth;
  const provenance = thermal.provenance;

  const delta = (metric: string): { value: number; unit: string } | undefined => {
    const row = comparison?.deltas.find((d) => d.metric === metric);
    return row ? { value: row.delta, unit: ` ${row.unit}` } : undefined;
  };

  return (
    <Panel
      title="Results"
      subtitle="Model estimates — not measurements"
      accent="output"
      scroll
      right={
        <>
          <Chip
            tone={score >= baselineScore ? 'good' : 'bad'}
            title={`Weighted objective ${score}/100. Conventional construction scores ${baselineScore}/100.`}
          >
            {score} / 100
          </Chip>
          <span className="text-[12px] tabular-nums text-muted-foreground/60">
            {Math.round(durationMs)} ms
          </span>
        </>
      }
    >
      {/* ---------------- Headline stats ---------------- */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Design score"
          value={String(score)}
          unit="/ 100"
          tone={score >= baselineScore ? 'good' : 'bad'}
          meter={score / 100}
          hint={`Conventional build: ${baselineScore}/100`}
        />
        <StatCard
          label="Passive comfort"
          value={pct(metrics.adaptiveComfortHoursPct)}
          tone={comfortTone(metrics.adaptiveComfortHoursPct)}
          meter={metrics.adaptiveComfortHoursPct / 100}
          hint="Hours inside the adaptive band, no HVAC"
        />
        <StatCard
          label={`Peak indoor · ${MONTH_LABELS[summerMonth]}`}
          value={num(metrics.summerIndoorTemperature, 1)}
          unit="°C"
          tone={
            metrics.summerOvertemperature > 3
              ? 'bad'
              : metrics.summerOvertemperature > 0.5
                ? 'warn'
                : 'good'
          }
          hint={
            metrics.summerOvertemperature > 0
              ? `${num(metrics.summerOvertemperature, 1)} K above the adaptive upper band`
              : 'Inside the adaptive band'
          }
          delta={delta('Summer indoor temperature')}
        />
        <StatCard
          label="Annual energy"
          value={num(metrics.energyUseIntensity, 1)}
          unit="kWh/m²·yr"
          tone={intensityTone(metrics.energyUseIntensity)}
          hint={`${energyPerYear(metrics.annualEnergy)} delivered`}
        />
      </div>

      {/* ---------------- Provenance ---------------- */}
      <div className="mt-2.5 flex items-start gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
        <ShieldCheck
          size={13}
          className="mt-[1px] shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {provenance.label}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground/80">
            {provenance.disclaimer}
          </p>
        </div>
      </div>

      {/* ---------------- Tabs ---------------- */}
      <div className="mt-2.5 flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={`tab ${tab === entry.value ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab(entry.value)}
            aria-selected={tab === entry.value}
            role="tab"
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      {/* ---------------- Comfort ---------------- */}
      {tab === 'comfort' ? (
        <div className="mt-2 space-y-2.5">
          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="stat-label">Free-running resilience</h3>
              <Chip tone="neutral" title="ASHRAE 55 adaptive comfort">
                ASHRAE 55
              </Chip>
            </div>
            <MetricRow
              label={`Peak cooling month (${MONTH_LABELS[summerMonth]})`}
              value={temp(metrics.summerIndoorTemperature)}
              tone={
                metrics.summerOvertemperature > 3
                  ? 'bad'
                  : metrics.summerOvertemperature > 0.5
                    ? 'warn'
                    : 'good'
              }
              hint="Monthly-mean indoor temperature with no active system"
            />
            <MetricRow
              label={`Peak heating month (${MONTH_LABELS[winterMonth]})`}
              value={temp(metrics.winterIndoorTemperature)}
              tone={
                metrics.winterUndertemperature > 3
                  ? 'bad'
                  : metrics.winterUndertemperature > 0.5
                    ? 'warn'
                    : 'good'
              }
            />
            <MetricRow
              label="Annual range"
              value={`${num(metrics.minIndoorTemperature, 1)} … ${num(metrics.maxIndoorTemperature, 1)} °C`}
            />
            <MetricRow
              label="Adaptive comfort temperature"
              value={temp(thermal.adaptiveComfortTemperature)}
              hint="Running-mean outdoor temperature mapped through the adaptive model"
            />
            <MetricRow
              label="Hours above / below band"
              value={`${num(metrics.overheatingHours, 0)} h / ${num(metrics.underheatingHours, 0)} h`}
            />
          </div>

          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="stat-label">Conditioned delivery</h3>
              <Chip tone="neutral" title="ISO 7730 PMV/PPD">
                ISO 7730
              </Chip>
            </div>
            <MetricRow
              label="PMV"
              value={`${num(metrics.conditionedPmv, 2)} · ${pmvSensation(metrics.conditionedPmv)}`}
              tone={Math.abs(metrics.conditionedPmv) <= 0.5 ? 'good' : 'warn'}
              hint="Predicted mean vote with the system holding setpoint"
            />
            <MetricRow
              label="PPD"
              value={pct(metrics.conditionedPpd, 1)}
              tone={ppdTone(metrics.conditionedPpd)}
              hint="Predicted percentage of dissatisfied"
            />
            <MetricRow
              label="Comfort score"
              value={`${num(metrics.conditionedComfortScore, 0)} / 100`}
              tone={metrics.conditionedComfortScore >= 85 ? 'good' : 'warn'}
            />
            <MetricRow
              label="Setpoints"
              value={`${num(metrics.coolingSetpoint, 1)} / ${num(metrics.heatingSetpoint, 1)} °C`}
              hint="Cooling / heating"
            />
            <MetricRow
              label="Operative temperature"
              value={temp(thermal.operativeTemperature)}
            />
            <MetricRow label="Relative humidity" value={pct(thermal.relativeHumidity)} />
          </div>

          {materials ? (
            <div className="rounded-md border bg-card/40 px-2.5 py-2">
              <h3 className="stat-label mb-1">Resolved envelope</h3>
              <MetricRow label={`Wall · ${materials.wall.name}`} value={uValue(materials.wall.uValue)} />
              <MetricRow label={`Roof · ${materials.roof.name}`} value={uValue(materials.roof.uValue)} />
              <MetricRow
                label={`Glazing · ${materials.window.name}`}
                value={uValue(materials.window.uValue)}
              />
              {materials.insulation.thickness > 0 ? (
                <MetricRow
                  label={`Insulation · ${materials.insulation.name}`}
                  value={`${num(materials.insulation.thickness * 1000, 0)} mm`}
                />
              ) : (
                <MetricRow label="Insulation" value="none" tone="warn" />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- Energy ---------------- */}
      {tab === 'energy' ? (
        <div className="mt-2 space-y-2.5">
          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <h3 className="stat-label mb-1">Annual delivered energy</h3>
            <MetricRow
              label="Cooling"
              value={energyPerYear(metrics.annualCoolingEnergy)}
              hint={`Peak load ${num(metrics.peakCoolingLoad, 2)} kW`}
            />
            <MetricRow
              label="Heating"
              value={energyPerYear(metrics.annualHeatingEnergy)}
              hint={`Peak load ${num(metrics.peakHeatingLoad, 2)} kW`}
            />
            <MetricRow
              label="Total"
              value={energyPerYear(metrics.annualEnergy)}
              tone={intensityTone(metrics.energyUseIntensity)}
            />
            <MetricRow
              label="Energy use intensity"
              value={`${num(metrics.energyUseIntensity, 1)} kWh/m²·yr`}
              tone={intensityTone(metrics.energyUseIntensity)}
            />
            <MetricRow
              label="Operational CO₂"
              value={`${num(metrics.co2TonnesPerYear, 2)} t/yr`}
            />
          </div>

          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <h3 className="stat-label mb-1.5">Against conventional construction</h3>
            {comparison
              ? comparison.deltas
                  .filter((row) =>
                    [
                      'Total annual energy',
                      'Energy use intensity',
                      'Annual cooling energy',
                      'Annual heating energy',
                    ].includes(row.metric),
                  )
                  .map((row) => (
                    <MetricRow
                      key={row.metric}
                      label={row.metric}
                      value={`${row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}${Math.abs(row.delta).toFixed(1)} ${row.unit}`}
                      tone={row.improved ? 'good' : 'bad'}
                      hint={`${row.baseline.toFixed(1)} → ${row.optimized.toFixed(1)} ${row.unit} (${signedPct(row.changePct)})`}
                    />
                  ))
              : null}
            {baselineMetrics ? (
              <MetricRow
                label="Baseline EUI"
                value={`${num(baselineMetrics.energyUseIntensity, 1)} kWh/m²·yr`}
                hint="Brick walls, RCC roof, single glazing, no shading"
              />
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Meter
              value={
                metrics.annualEnergy > 0
                  ? metrics.annualCoolingEnergy / metrics.annualEnergy
                  : 0
              }
              label="Cooling share"
              right={pct(
                metrics.annualEnergy > 0
                  ? (metrics.annualCoolingEnergy / metrics.annualEnergy) * 100
                  : 0,
              )}
              tone="warn"
            />
            <Meter
              value={
                metrics.annualEnergy > 0
                  ? metrics.annualHeatingEnergy / metrics.annualEnergy
                  : 0
              }
              label="Heating share"
              right={pct(
                metrics.annualEnergy > 0
                  ? (metrics.annualHeatingEnergy / metrics.annualEnergy) * 100
                  : 0,
              )}
              tone="accent"
            />
          </div>

          {optimization ? (
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={optimization.energySavings >= 0 ? 'good' : 'bad'}>
                {energyPerYear(optimization.energySavings)} saved
              </Chip>
              <Chip tone="neutral">{signedPct(optimization.energySavingsPct)}</Chip>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- Cost ---------------- */}
      {tab === 'cost' ? (
        <div className="mt-2 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Capital cost"
              value={currency(cost.totalCost)}
              tone={cost.withinBudget ? 'good' : 'warn'}
              hint={`${currency(cost.costPerSqm)}/m²`}
              delta={delta('Construction cost')}
            />
            <StatCard
              label="20-year cost of ownership"
              value={currency(cost.twentyYearCost)}
              hint={`Includes ${currency(cost.lifecycleEnergyCost)} of energy`}
            />
          </div>

          {!cost.withinBudget ? (
            <div
              className="rounded-md border px-2.5 py-2 text-[12px] leading-snug"
              style={{
                background: 'hsl(var(--warning) / 0.1)',
                borderColor: 'hsl(var(--warning) / 0.35)',
                color: 'hsl(var(--warning))',
              }}
            >
              This design runs {currency(Math.abs(cost.budgetDelta))} over the{' '}
              {currency(budget)} budget. The budget is a soft constraint — an overrun is reported,
              not blocked, because &ldquo;no design found&rdquo; is less useful than knowing the
              cost.
            </div>
          ) : (
            <div
              className="rounded-md border px-2.5 py-2 text-[12px] leading-snug"
              style={{
                background: 'hsl(var(--success) / 0.1)',
                borderColor: 'hsl(var(--success) / 0.35)',
                color: 'hsl(var(--success))',
              }}
            >
              {currency(Math.abs(cost.budgetDelta))} under budget.
            </div>
          )}

          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <h3 className="stat-label mb-1">Breakdown</h3>
            <MetricRow label="Shell and envelope" value={currency(cost.constructionCost)} />
            <MetricRow label="Services" value={currency(cost.servicesCost)} />
            <MetricRow label="Cost per m²" value={`${currency(cost.costPerSqm)}/m²`} />
            {baselineCost ? (
              <MetricRow
                label="Conventional build"
                value={currency(baselineCost.totalCost)}
                hint={`Delta ${signedCurrency(cost.totalCost - baselineCost.totalCost)}`}
              />
            ) : null}
          </div>

          <div className="scroll-area max-h-[220px] overflow-y-auto rounded-md border bg-card/30">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card/95">
                <tr className="text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">
                    Item
                  </th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                    Qty
                  </th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {cost.lineItems.map((item) => (
                  <tr key={item.id} className="border-t border-border/50">
                    <td className="px-2 py-1 text-foreground/85">
                      {item.label}
                      {item.note ? (
                        <span className="block text-[11px] text-muted-foreground/70">
                          {item.note}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {num(item.quantity, 1)} {item.unit}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground/90">
                      {currency(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[12px] leading-snug text-muted-foreground/65">
            A trade-off tool, not a quantity surveyor&rsquo;s estimate. Rates are indicative Indian
            market figures and are meant to rank options against each other, not to price a tender.
          </p>
        </div>
      ) : null}

      {/* ---------------- Search transparency ---------------- */}
      {tab === 'search' ? (
        <div className="mt-2 space-y-2.5">
          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <h3 className="stat-label mb-1">How this answer was found</h3>
            <MetricRow
              label="Engine"
              value={
                engine === 'ml-surrogate' ? 'ML surrogate' : 'Rule-based + physics optimiser'
              }
            />
            <MetricRow
              label="Method"
              value={optimization ? optimization.method : 'search skipped (manual)'}
            />
            <MetricRow label="Candidates evaluated" value={String(evaluations)} />
            <MetricRow
              label="Design score"
              value={`${optimization ? optimization.score : score} / 100`}
              hint="The same weighted objective the search minimised"
            />
            <MetricRow label="Search time" value={`${num(optimization?.durationMs ?? durationMs, 0)} ms`} />
          </div>

          <p className="text-[12px] leading-snug text-muted-foreground/75">
            {engineDescription}
          </p>

          {mode === 'auto' ? (
            <p className="text-[12px] leading-snug text-muted-foreground/65">
              The optimiser searches a curated neighbourhood around the climate engine&rsquo;s
              recommendation by coordinate descent, rather than every combination in the space —
              the full cross product is orders of magnitude larger and the marginal candidate does
              not change the answer.
            </p>
          ) : (
            <p className="text-[12px] leading-snug text-muted-foreground/65">
              Manual mode skips the search. The reference design and the comparison are still
              evaluated so you can see what your choices cost against conventional construction.
            </p>
          )}

          {leaderboard.length > 0 ? (
            <div className="rounded-md border bg-card/30">
              <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
                <Award size={13} className="text-muted-foreground" aria-hidden />
                <h3 className="stat-label">Shortlist</h3>
              </div>
              <ul className="divide-y divide-border/50">
                {leaderboard.map((candidate) => (
                  <li key={candidate.id} className="px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-foreground/90">
                        {candidate.lens ?? candidate.label}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {currency(candidate.cost)}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1.5">
                      <Meter
                        value={1 - candidate.discomfortScore}
                        label="comfort"
                        right={pct((1 - candidate.discomfortScore) * 100)}
                        tone="good"
                      />
                      <Meter
                        value={1 - candidate.energyScore}
                        label="energy"
                        right={pct((1 - candidate.energyScore) * 100)}
                        tone="accent"
                      />
                      <Meter
                        value={1 - candidate.costScore}
                        label="cost"
                        right={pct((1 - candidate.costScore) * 100)}
                        tone="warn"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/*
            The backend surrogate's shortlist.

            Kept visually separate from the physics shortlist above on purpose:
            these are model *predictions*, ranked, each carrying its held-out
            error bar — not simulations. Merging the two lists would make the
            surrogate look like the authority, which it is not.
          */}
          {surrogateScreening ? (
            <div className="rounded-md border border-primary/30 bg-primary/[0.04]">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-primary/20 px-2.5 py-1.5">
                <BrainCircuit size={13} className="text-primary" aria-hidden />
                <h3 className="stat-label text-primary">Surrogate screening</h3>
                <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
                  {surrogateScreening.candidatesEvaluated} ranked of{' '}
                  {surrogateScreening.spaceSize.toLocaleString()} ·{' '}
                  {num(surrogateScreening.durationMs, 0)} ms
                </span>
              </div>

              <ul className="divide-y divide-primary/10">
                {surrogateScreening.leaderboard.slice(0, 5).map((candidate, index) => {
                  const energy = candidate.predictions.energy_use_intensity_kwh_m2_yr;
                  const comfort = candidate.predictions.adaptive_comfort_hours_pct;
                  const candidateCost = candidate.predictions.cost_per_m2_inr;
                  const energyError = candidate.errorBars.energy_use_intensity_kwh_m2_yr;
                  const comfortError = candidate.errorBars.adaptive_comfort_hours_pct;

                  return (
                    <li key={candidate.id} className="px-2.5 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/70">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">
                          {candidate.label}
                        </span>
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-primary">
                          {candidate.score}/100
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-[12px] tabular-nums text-muted-foreground/80">
                        <span title="Predicted annual energy use intensity">
                          {num(energy, 1)} kWh/m²·yr
                          {Number.isFinite(energyError) ? (
                            <span className="text-muted-foreground/55"> ±{num(energyError, 1)}</span>
                          ) : null}
                        </span>
                        <span title="Predicted share of hours inside the adaptive comfort band">
                          {num(comfort, 1)}% comfort
                          {Number.isFinite(comfortError) ? (
                            <span className="text-muted-foreground/55"> ±{num(comfortError, 1)}</span>
                          ) : null}
                        </span>
                        <span title="Predicted construction cost">{currency(candidateCost)}/m²</span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* This carries the most consequential caveat on the page —
                 that the surrogate's numbers are predictions, not
                 simulations. At 9.5px and 70% opacity it was the least
                 legible text here, which is the wrong way round. Raised
                 to the 11.5px body-caption floor at full muted contrast. */}
              <p className="border-t border-primary/20 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Ranked by a gradient-boosted model trained on the physics engine&rsquo;s own output
                (model {surrogateScreening.modelId.slice(0, 8)}). These are predictions, not
                simulations — the ± figures are the model&rsquo;s held-out mean absolute error. The
                physics optimiser above still evaluates the design that gets built.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- Footer gauge ---------------- */}
      <div className="mt-3 flex items-center gap-2 border-t pt-2.5">
        <Gauge size={12} className="text-muted-foreground" aria-hidden />
        <span className="text-[12px] text-muted-foreground">
          Score is the same weighted objective the optimiser minimised — not a second, separately
          invented number.
        </span>
      </div>
    </Panel>
  );
}
