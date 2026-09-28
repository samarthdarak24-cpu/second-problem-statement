'use client';

/**
 * Thermal Analysis — comfort, energy and cost.
 *
 * ORDER OF THE PAGE
 * The redesign leads with three headline numbers (peak indoor temperature,
 * passive comfort hours, energy intensity) because those are the three things
 * a reviewer asks for first, and only then opens the depth: the monthly
 * temperature curve, the heat-balance breakdown as horizontal bars rather than
 * a stacked column chart, and the tabbed detail (comfort / energy / cost /
 * how-this-was-found).
 *
 * The detail tabs are the existing `ResultsPanel` — unchanged, so the numbers,
 * the PMV/PPD treatment, the provenance disclaimer and the surrogate-screening
 * panel all still come from the same place they always did. Nothing was
 * recomputed for this page.
 *
 * There are no design controls here on purpose: this page is a read-out. To
 * change the design, go to the Design Studio.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Coins, Sliders, ThermometerSun, Wind } from 'lucide-react';
import { ResultsPanel } from '@/components/dashboard/ResultsPanel';
import { ChartsPanel } from '@/components/dashboard/ChartsPanel';
import { BarRow, MetricCard, SectionHeader, Stagger, StaggerItem, VerdictChip } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';
import { useThermalReading } from '@/hooks/useThermalReading';
import { MONTH_LABELS } from '@/utils/units';
import { currency, energyPerYear, fractionPct, num, pct } from '@/utils/format';
import type { PastelTone } from '@/components/ui/soft';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function comfortTone(share: number): PastelTone {
  if (share >= 75) return 'mint';
  if (share >= 45) return 'yellow';
  return 'pink';
}

/**
 * The monthly heat-balance terms, as shares of the largest absolute term, so
 * the bars compare like with like. Annual totals, not a single month: the page
 * is answering "what does this building do over a year".
 */
function useHeatBalance() {
  const thermal = useDesignStore((state) => state.currentThermal);

  return useMemo(() => {
    if (!thermal || thermal.heatBalance.length === 0) return null;

    const totals = thermal.heatBalance.reduce(
      (accumulator, row) => ({
        solar: accumulator.solar + row.solarGain,
        internal: accumulator.internal + row.internalGain,
        conduction: accumulator.conduction + row.conduction,
        ventilation: accumulator.ventilation + row.ventilation,
      }),
      { solar: 0, internal: 0, conduction: 0, ventilation: 0 },
    );

    const max = Math.max(
      Math.abs(totals.solar),
      Math.abs(totals.internal),
      Math.abs(totals.conduction),
      Math.abs(totals.ventilation),
      1e-6,
    );

    const rows: { label: string; value: string; share: number; tone: PastelTone }[] = [
      {
        label: 'Solar gain',
        value: `+${num(totals.solar, 0)} kWh`,
        share: Math.abs(totals.solar) / max,
        tone: 'yellow',
      },
      {
        label: 'Internal gain',
        value: `+${num(totals.internal, 0)} kWh`,
        share: Math.abs(totals.internal) / max,
        tone: 'peach',
      },
      {
        label: 'Conduction',
        value: `${totals.conduction >= 0 ? '+' : '−'}${num(Math.abs(totals.conduction), 0)} kWh`,
        share: Math.abs(totals.conduction) / max,
        tone: 'blue',
      },
      {
        label: 'Ventilation',
        value: `${totals.ventilation >= 0 ? '+' : '−'}${num(Math.abs(totals.ventilation), 0)} kWh`,
        share: Math.abs(totals.ventilation) / max,
        tone: 'lavender',
      },
    ];

    return { rows, totals };
  }, [thermal]);
}

/* The reading (verdict + dominant fabric path) is shared with the
   Dashboard, so it lives in `hooks/useThermalReading.ts` rather than
   here. Two copies would eventually disagree about which path is
   dominant, which is exactly the kind of drift that erodes trust in an
   engineering tool. */

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function AnalysisPage() {
  const thermal = useDesignStore((state) => state.currentThermal);
  const metrics = useDesignStore((state) => state.metrics);
  const cost = useDesignStore((state) => state.cost);
  const score = useDesignStore((state) => state.score);
  const climateData = useDesignStore((state) => state.climateData);
  const isGenerating = useDesignStore((state) => state.isGenerating);

  const balance = useHeatBalance();
  const reading = useThermalReading();

  const summerMonth = climateData?.summary.peakCoolingMonth ?? 4;

  return (
    <div className="page-pad page-gap">
      {/* While a run is in flight the numbers below are the *previous*
         result. Saying so is the difference between a page that is
         quietly wrong for a few seconds and one that is honest about it. */}
      {isGenerating ? (
        <div
          className="flex items-center gap-3 rounded-[16px] border px-4 py-3"
          role="status"
          aria-live="polite"
          style={{
            borderColor: 'hsl(var(--primary) / 0.28)',
            background: 'hsl(var(--primary) / 0.05)',
          }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: 'hsl(var(--primary))' }}
            aria-hidden
          />
          <p className="text-[13px] font-medium text-foreground">
            Calculating thermal response — the figures below are from the previous run
            until this one completes.
          </p>
        </div>
      ) : null}

      {/* ---------------- Identity ---------------- */}
      <SectionHeader
        eyebrow="Thermal analysis"
        title="How the design performs"
        description="Comfort, energy and cost from the same monthly heat balance the Design Studio runs — read as an annual picture here, with the monthly detail underneath."
        right={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/design" className="btn-secondary">
              <Sliders size={13} aria-hidden />
              Change the design
            </Link>
            <Link href="/dashboard/optimization" className="btn-secondary">
              Compare
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        }
      />

      {/* ---------------- Three headline outputs ---------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          tone={comfortTone((metrics?.summerIndoorTemperature ?? 0) < 32 ? 80 : 30)}
          label={`Peak indoor · ${MONTH_LABELS[summerMonth]}`}
          icon={ThermometerSun}
          value={metrics ? num(metrics.summerIndoorTemperature, 1) : '—'}
          unit="°C"
          description={
            metrics
              ? metrics.summerOvertemperature > 0
                ? `${num(metrics.summerOvertemperature, 1)} K above the adaptive upper band — the envelope is not holding it on its own.`
                : 'Inside the ASHRAE 55 adaptive band with no system running.'
              : 'Generate a design to populate the thermal model.'
          }
        />

        <MetricCard
          tone={metrics ? comfortTone(metrics.adaptiveComfortHoursPct) : 'gray'}
          label="Passive comfort"
          icon={Wind}
          value={metrics ? pct(metrics.adaptiveComfortHoursPct, 0) : '—'}
          description="Share of the year inside the adaptive comfort band with no heating or cooling running."
          meta={
            metrics ? (
              <p className="text-[12.5px] opacity-75">
                {num(metrics.overheatingHours, 0)} h above · {num(metrics.underheatingHours, 0)} h
                below
              </p>
            ) : null
          }
          right={
            metrics ? (
              <span className="rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums">
                {score} / 100
              </span>
            ) : null
          }
        />

        <MetricCard
          tone={
            !metrics ? 'gray' : metrics.energyUseIntensity <= 30 ? 'mint' : metrics.energyUseIntensity <= 70 ? 'yellow' : 'pink'
          }
          label="Energy intensity"
          icon={Coins}
          value={metrics ? num(metrics.energyUseIntensity, 1) : '—'}
          unit="kWh/m²·yr"
          description={
            metrics
              ? `${energyPerYear(metrics.annualEnergy)} delivered across the year · ${num(metrics.co2TonnesPerYear, 2)} t CO₂`
              : 'Delivered energy, not primary.'
          }
          meta={
            cost ? (
              <p className="text-[12.5px] opacity-75">
                Capital {currency(cost.totalCost)} · {currency(cost.costPerSqm)}/m²
              </p>
            ) : null
          }
        />
      </div>

      {/* ---------------- The engineering reading ---------------- */}
      {/* The brief's order is important number → status → interpretation →
         detail. The metrics above are the numbers; this band is the
         status and the interpretation, so it sits *before* the bars
         rather than after them. Everything below is detail. */}
      {reading ? (
        /* `role="status"` was wrong here: this is static content on a loaded
           page, not a live region. A live region would make a screen reader
           re-announce the whole paragraph on any re-render. The band is
           labelled instead, so it is reachable but not chatty. */
        <section aria-labelledby="thermal-condition" className="soft-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="min-w-0 max-w-[720px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="section-eyebrow" id="thermal-condition">
                  Thermal condition
                </p>
                <VerdictChip verdict={reading.verdictTone} />              </div>
              <p className="mt-1.5 font-display text-[19px] font-semibold leading-snug tracking-[-0.02em] text-foreground">
                {reading.verdict}
              </p>

              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                {/* The dominant fabric path, named, with its share of the
                   conduction total — the sentence the six bars cannot say.
                   Ventilation is a separate physics class and is reported
                   separately below, never folded into this share. */}
                <b className="font-semibold capitalize text-foreground/90">
                  {reading.top.label}
                </b>{' '}
                is the weakest point in the fabric, conducting{' '}
                <b className="font-semibold tabular-nums text-foreground/90">
                  {num(reading.top.value, 1)} kWh/day
                </b>{' '}
                on the representative day
                {reading.envelopeTotal > 0
                  ? ` — ${fractionPct(reading.topShare, 0)} of the ${num(reading.envelopeTotal, 1)} kWh/day moving through the envelope.`
                  : '.'}
                {reading.next && reading.next.value > 0
                  ? ` ${reading.next.label[0].toUpperCase()}${reading.next.label.slice(1)} follows at ${num(reading.next.value, 1)} kWh/day.`
                  : ''}{' '}
                Ventilation {reading.ventilationKwh >= 0 ? 'adds' : 'removes'}{' '}
                <b className="font-semibold tabular-nums text-foreground/90">
                  {num(Math.abs(reading.ventilationKwh), 1)} kWh/day
                </b>{' '}
                on top of that, and it is the term that changes sign through the year.
              </p>
            </div>

            {/* The supporting numbers, as inline metrics rather than cards.
               NOTE: this is a real <dl>. HTML5 explicitly permits a `div`
               between `dl` and its `dt`/`dd` pairs when the groups need
               wrapping, so the motion wrapper does not break the
               definition-list semantics — the label/value relationship
               survives for screen readers.
               Staggered because the reading order (gain → per m² →
               leaving → entering) is the order an engineer checks them. */}
            <Stagger
              as="dl"
              className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4"
            >
              {[
                { label: 'Solar gain', value: num(reading.solarGainKwh, 1), unit: 'kWh/day' },
                { label: 'Solar per m²', value: num(reading.solarPerSqm, 2), unit: 'kWh/m²·d' },
                { label: 'Heat leaving', value: num(reading.lossKwh, 1), unit: 'kWh/day' },
                { label: 'Heat entering', value: num(reading.totalGainKwh, 1), unit: 'kWh/day' },
              ].map((item) => (
                <StaggerItem key={item.label} className="min-w-0">
                  <dt className="stat-label">{item.label}</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums leading-none text-foreground">
                    {item.value}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      {item.unit}
                    </span>
                  </dd>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>
      ) : null}

      {/* ---------------- Heat-flow breakdown ---------------- */}
      <div className="soft-card p-6">
        <SectionHeader
          eyebrow="Heat balance"
          title="Where the heat comes from, and where it goes"
          description="Annual totals of the four terms the model solves for each month. Positive is heat entering the zone."
        />
        {balance ? (
          <>
            <div className="mt-5 space-y-3.5">
              {balance.rows.map((row) => (
                <BarRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  share={row.share}
                  tone={row.tone}
                />
              ))}
            </div>
            <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
              Ventilation is the term that changes sign through the year — a large positive number
              in summer and a large negative one in winter. Which is exactly why the model treats
              the design air-change rate as a <b className="text-foreground/85">capacity</b> it only
              uses when the outside air genuinely helps, rather than as a constant loss.
            </p>
          </>
        ) : (
          <p className="mt-5 text-[13px] text-muted-foreground">
            No thermal result yet — generate a design to populate the heat balance.
          </p>
        )}
      </div>

      {/* ---------------- Monthly charts ---------------- */}
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Monthly detail"
          title="The year, month by month"
          description="The gap between the dashed outdoor line and the solid free-running line is the envelope's whole contribution."
        />
        <div className="h-[620px]">
          <ChartsPanel />
        </div>
      </div>

      {/* ---------------- Full tabbed read-out ---------------- */}
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Full read-out"
          title="Comfort, energy, cost and how the answer was found"
          description="The same panel the Design Studio uses, at full width so the tabbed breakdown has room to breathe."
        />
        <div className="h-[720px]">
          <ResultsPanel />
        </div>
      </div>

      {/* ---------------- Honesty ---------------- */}
      {thermal ? (
        <div className="soft-card px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground/85">{thermal.provenance.label}.</b>{' '}
            {thermal.provenance.disclaimer}
          </p>
        </div>
      ) : null}
    </div>
  );
}
