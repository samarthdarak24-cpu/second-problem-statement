'use client';

/**
 * Before / after.
 *
 * Two buildings, one climate, one table of consequences.
 *
 * The comparison is against *conventional local construction* — brick walls,
 * an RCC roof, single glazing, no added insulation and no shading. That is a
 * design somebody would genuinely build without any climate thinking, and it is
 * deliberately not a straw man: comparing an optimised shelter against a leaky
 * tin shed would flatter the tool and tell the user nothing.
 *
 * Both models are rendered from the same `buildShelterGeometry` the numbers came
 * from, so the picture and the table cannot disagree.
 */

import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { summariseComparison } from '@/optimization/comparison';
import { Chip, EmptyState, Panel } from '@/components/ui/primitives';
import { ModelThumbnail } from '@/components/3d/ModelThumbnail';
import { currency, num, signedPct, temp } from '@/utils/format';
import { cn } from '@/lib/utils';
import type { BuildingParameters } from '@/types';

/* ------------------------------------------------------------------ */
/* A single thumbnail                                                  */
/* ------------------------------------------------------------------ */

function Thumbnail({
  parameters,
  label,
  score,
  tone,
}: {
  parameters: BuildingParameters;
  label: string;
  score: number;
  tone: 'baseline' | 'optimized';
}) {
  const climateData = useDesignStore((state) => state.climateData);
  const month = useDesignStore((state) => state.analysisMonth);

  const accent =
    tone === 'baseline' ? 'hsl(var(--muted-foreground))' : 'hsl(var(--stage-output))';

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background/40">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <span className="truncate text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <span
          className="ml-auto shrink-0 text-[12px] font-semibold tabular-nums"
          style={{ color: accent }}
        >
          {score}/100
        </span>
      </div>

      <div className="relative h-[168px]">
        <ModelThumbnail parameters={parameters} climate={climateData} month={month} hour={10} />
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-0.5 border-t px-2 py-1.5 text-[11px] tabular-nums text-muted-foreground/75">
        <span>{num(parameters.windowToWallRatio * 100, 0)}% WWR</span>
        <span>{parameters.insulationLevel === 'none' ? 'no insul.' : parameters.insulationLevel}</span>
        <span>{parameters.shadingType === 'none' ? 'no shade' : parameters.shadingType}</span>
        <span>{parameters.ventilationType}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function ComparisonPanel() {
  const comparison = useDesignStore((state) => state.comparison);
  const climateData = useDesignStore((state) => state.climateData);
  const mode = useDesignStore((state) => state.mode);
  const setPanel = useDesignStore((state) => state.setPanel);

  if (!comparison || !climateData) {
    return (
      <Panel title="Before / after" accent="output" scroll>
        <EmptyState
          message="No comparison yet"
          hint="Generate a design to measure it against conventional construction."
        />
      </Panel>
    );
  }

  const { baseline, optimized, deltas } = comparison;
  const summary = summariseComparison(comparison);

  const improved = deltas.filter((row) => row.improved).length;
  const regressed = deltas.filter(
    (row) => !row.improved && Math.abs(row.delta) > 1e-6,
  ).length;

  return (
    <Panel
      title="Before / after"
      subtitle="Model estimates against conventional local construction"
      accent="output"
      scroll
      right={
        <>
          <Chip tone="good">
            <TrendingUp size={11} aria-hidden />
            {improved} better
          </Chip>
          {regressed > 0 ? (
            <Chip tone="bad">
              <TrendingDown size={11} aria-hidden />
              {regressed} worse
            </Chip>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setPanel('comparison', false)}
          >
            Hide
          </button>
        </>
      }
    >
      {/* ---------------- Side-by-side models ---------------- */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Thumbnail
          parameters={baseline.parameters}
          label="Before · conventional"
          score={baseline.score}
          tone="baseline"
        />
        <Thumbnail
          parameters={optimized.parameters}
          label={mode === 'auto' ? 'After · optimised' : 'After · your design'}
          score={optimized.score}
          tone="optimized"
        />
      </div>

      {/* ---------------- Headline deltas ---------------- */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: 'Peak indoor', row: 'Summer indoor temperature', unit: '°C', invert: true },
          { label: 'Passive comfort', row: 'Adaptive comfort hours', unit: '%', invert: false },
          { label: 'Annual energy', row: 'Total annual energy', unit: 'kWh', invert: true },
          { label: 'Capital cost', row: 'Construction cost', unit: '₹', invert: true },
        ].map((item) => {
          const row = deltas.find((d) => d.metric === item.row);
          if (!row) return null;
          const value =
            item.unit === '₹'
              ? currency(Math.abs(row.delta))
              : item.unit === 'kWh'
                ? `${Math.abs(row.delta).toFixed(0)} kWh`
                : `${row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}${Math.abs(row.delta).toFixed(1)} ${item.unit}`;

          const Arrow = row.improved
            ? item.invert
              ? ArrowDownRight
              : ArrowUpRight
            : ArrowDownRight;

          return (
            <div key={item.row} className="stat-card">
              <div className="stat-label">{item.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <Arrow
                  size={13}
                  style={{
                    color: row.improved ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                  }}
                  aria-hidden
                />
                <span
                  className="text-[15px] font-semibold tabular-nums"
                  style={{
                    color: row.improved ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                  }}
                >
                  {value}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground/75">
                {item.unit === '₹'
                  ? `${currency(row.baseline)} → ${currency(row.optimized)}`
                  : `${num(row.baseline, 1)} → ${num(row.optimized, 1)} ${item.unit}`}
                <span className="ml-1 text-muted-foreground/55">({signedPct(row.changePct)})</span>
              </p>
            </div>
          );
        })}
      </div>

      {/* ---------------- Full table ---------------- */}
      <div className="scroll-area mt-2.5 max-h-[280px] overflow-y-auto rounded-md border bg-card/30">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-card/95 text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide">
                Metric
              </th>
              <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                Before
              </th>
              <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                After
              </th>
              <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {deltas.map((row) => {
              const flat = Math.abs(row.delta) < 1e-6;
              const Icon = flat ? Minus : row.improved ? TrendingUp : TrendingDown;
              const color = flat
                ? 'hsl(var(--muted-foreground))'
                : row.improved
                  ? 'hsl(var(--success))'
                  : 'hsl(var(--destructive))';

              return (
                <tr
                  key={row.metric}
                  className={cn('border-t border-border/50 tabular-nums')}
                  title={`${row.baseline} → ${row.optimized} ${row.unit} · lower is ${row.lowerIsBetter ? 'better' : 'not necessarily better'}`}
                >
                  <td className="px-2.5 py-1 text-foreground/85">{row.metric}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {row.unit === '₹' ? currency(row.baseline) : num(row.baseline, 1)}
                  </td>
                  <td className="px-2 py-1 text-right text-foreground/90">
                    {row.unit === '₹' ? currency(row.optimized) : num(row.optimized, 1)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span className="inline-flex items-center justify-end gap-1" style={{ color }}>
                      <Icon size={12} aria-hidden />
                      {row.unit === '₹'
                        ? currency(Math.abs(row.delta))
                        : `${Math.abs(row.delta).toFixed(row.unit === 'h/yr' || row.unit === 'kWh/yr' ? 0 : 1)}`}
                      <span className="text-muted-foreground/60">{row.unit}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------- Summary ---------------- */}
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{summary}</p>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <div className="rounded-md border bg-card/30 px-2.5 py-1.5">
          <p className="stat-label">Before</p>
          <p className="text-[13px] text-foreground/85">{baseline.label}</p>
          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
            {temp(baseline.thermal.indoorTemperature)} free-running peak ·{' '}
            {currency(baseline.cost.totalCost)}
          </p>
        </div>
        <div className="rounded-md border bg-card/30 px-2.5 py-1.5">
          <p className="stat-label">After</p>
          <p className="text-[13px] text-foreground/85">{optimized.label}</p>
          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
            {temp(optimized.thermal.indoorTemperature)} free-running peak ·{' '}
            {currency(optimized.cost.totalCost)}
          </p>
        </div>
      </div>
    </Panel>
  );
}
