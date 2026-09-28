'use client';

/**
 * Optimisation — what the search changed, and what it bought.
 *
 * ORDER (redesign)
 * The brief wants three things in this order:
 *
 *   1. the priority slider and the CTA — the one control that changes the
 *      answer, surfaced where the user can see its effect
 *   2. BEFORE / AFTER, side by side, as models rather than tables, because the
 *      claim being made is that two *buildings* differ
 *   3. "what changed" and "why" — the explanation, after the result
 *
 * WHAT IS REUSED, UNCHANGED
 * `ComparisonPanel` still renders both models from the same `buildShelterGeometry`
 * the numbers came from, still diffs against conventional local construction
 * rather than a straw man, and still carries the full metric table.
 * `RecommendationPanel` still keeps "measured effects" and "reasoning" visibly
 * separate — a plausible justification is not evidence, and that distinction is
 * load-bearing.
 *
 * The slider writes through `setPriority`, which is the same objective weight the
 * Design Studio and the Climate Response Lab use.
 */

import Link from 'next/link';
import { ArrowRight, Play, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { ComparisonPanel } from '@/components/dashboard/ComparisonPanel';
import { RecommendationPanel } from '@/components/dashboard/RecommendationPanel';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';
import { currency, num, signedPct } from '@/utils/format';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function OptimizationPage() {
  const priority = useDesignStore((state) => state.priority);
  const setPriority = useDesignStore((state) => state.setPriority);
  const comparison = useDesignStore((state) => state.comparison);
  const optimization = useDesignStore((state) => state.optimization);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const generate = useDesignStore((state) => state.generate);
  const mode = useDesignStore((state) => state.mode);

  const improved = comparison?.deltas.filter((row) => row.improved).length ?? 0;
  const regressed =
    comparison?.deltas.filter((row) => !row.improved && Math.abs(row.delta) > 1e-6).length ?? 0;

  const band = priority < 0.34 ? 'Cost-led' : priority > 0.66 ? 'Comfort-led' : 'Balanced';

  return (
    <div className="page-pad page-gap">
      {/* ---------------- Identity ---------------- */}
      <SectionHeader
        eyebrow="Optimisation"
        title="Was it worth it?"
        description="The same programme, built conventionally and built to the optimiser's answer, measured on the same engine."
        right={
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={isGenerating ? 'generating' : comparison ? 'ready' : 'idle'}
              label={isGenerating ? 'Searching' : comparison ? `${improved} better` : 'No result'}
            />
            <Link href="/dashboard/design" className="btn-secondary">
              Design Studio
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        }
      />

      {/* ---------------- The one control that changes the answer ---------------- */}
      <div className="soft-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="section-eyebrow">Search objective</p>
            <h2 className="section-title-soft mt-1">{band}</h2>
            <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground">
              The slider weights cost against comfort. Moving it changes what the search minimises —
              press <b className="text-foreground/85">Generate optimized design</b> to re-run it. The
              search is not re-run on every tick, because each tick is a full coordinate-descent
              sweep.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void generate()}
            disabled={isGenerating || mode !== 'auto'}
            title={
              mode === 'auto'
                ? 'Re-run the optimiser at the current priority'
                : 'Switch to Auto mode to let the optimiser search'
            }
          >
            {isGenerating ? (
              <Sparkles size={14} className="animate-pulse" aria-hidden />
            ) : (
              <Play size={14} aria-hidden />
            )}
            {isGenerating ? 'Searching…' : 'Generate optimized design'}
          </button>
        </div>

        <div className="mt-6">
          <label className="block">
            <span className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Capital cost</span>
              <span className="tabular-nums text-foreground">{Math.round(priority * 100)}% comfort weight</span>
              <span>Thermal comfort</span>
            </span>
            <input
              type="range"
              className="slider mt-3"
              min={0}
              max={1}
              step={0.05}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              aria-label="Optimisation priority — cost against comfort"
            />
          </label>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Cost-led', active: priority < 0.34, blurb: 'Cheapest building that still works. Expect less passive comfort.' },
              { label: 'Balanced', active: priority >= 0.34 && priority <= 0.66, blurb: 'Trades capital spend against running comfort evenly.' },
              { label: 'Comfort-led', active: priority > 0.66, blurb: 'Spends on the envelope to buy passive hours. Expect a costlier build.' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setPriority(option.label === 'Cost-led' ? 0.15 : option.label === 'Balanced' ? 0.5 : 0.85)}
                className="rounded-2xl border px-4 py-3 text-left transition-colors"
                style={
                  option.active
                    ? { background: 'hsl(var(--pastel-peach))', borderColor: 'hsl(18 100% 86%)' }
                    : { background: 'transparent', borderColor: 'hsl(30 14% 88% / 0.8)' }
                }
                aria-pressed={option.active}
              >
                <p className="text-[13px] font-semibold text-foreground">{option.label}</p>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{option.blurb}</p>
              </button>
            ))}
          </div>
        </div>

        {optimization ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-[12.5px]">
            <span className="text-muted-foreground">
              Method <b className="text-foreground/85">{optimization.method}</b>
            </span>
            <span className="text-muted-foreground">
              Score{' '}
              <b className="tabular-nums text-foreground/85">{optimization.score} / 100</b>
            </span>
            <span className="text-muted-foreground">
              Search time{' '}
              <b className="tabular-nums text-foreground/85">
                {num(optimization.durationMs, 0)} ms
              </b>
            </span>
            {optimization.energySavings !== 0 ? (
              <span
                className="flex items-center gap-1 font-semibold"
                style={{
                  color:
                    optimization.energySavings > 0
                      ? 'hsl(158 46% 30%)'
                      : 'hsl(0 62% 44%)',
                }}
              >
                {optimization.energySavings > 0 ? (
                  <TrendingUp size={12} aria-hidden />
                ) : (
                  <TrendingDown size={12} aria-hidden />
                )}
                {currency(Math.abs(optimization.energySavings))} energy
                {optimization.energySavings > 0 ? ' saved' : ' added'} ({signedPct(optimization.energySavingsPct)})
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---------------- Before / after ---------------- */}
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Before / after"
          title="Two buildings, one climate"
          description="Measured against conventional local construction — brick walls, an RCC roof, single glazing, no added insulation and no shading. Deliberately not a straw man: comparing against a leaky tin shed would flatter the tool and tell you nothing."
          right={
            regressed > 0 ? (
              <StatusBadge tone="error" label={`${regressed} metric worse`} />
            ) : undefined
          }
        />
        <div className="h-[760px]">
          <ComparisonPanel />
        </div>
      </div>

      {/* ---------------- Why ---------------- */}
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Explanation"
          title="What changed, and why"
          description="Each decision and the change it actually caused — obtained by reverting that one axis to conventional construction and re-running the thermal model."
        />
        <div className="h-[720px]">
          <RecommendationPanel />
        </div>
      </div>
    </div>
  );
}
