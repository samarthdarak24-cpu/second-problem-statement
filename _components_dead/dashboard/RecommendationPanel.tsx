'use client';

/**
 * "Why this design?"
 *
 * Two sources, kept visibly distinct:
 *
 *   RATIONALE — the climate engine's rule-based reasoning, written as prose.
 *   It explains *why* a strategy was chosen from the climate alone.
 *
 *   MEASURED EFFECTS — what each individual decision actually changed, obtained
 *   by reverting that one axis to conventional construction and re-running the
 *   thermal model. These are numbers, not opinions, and the method note says so.
 *
 * Keeping them apart matters: a plausible-sounding justification is not evidence,
 * and this panel is where a user is most likely to be misled.
 */

import { useState } from 'react';
import { ArrowRight, HelpCircle, Lightbulb } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, Panel } from '@/components/ui/primitives';
import { EFFECT_METHOD_NOTE } from '@/optimization/recommendations';
import type { Tone } from '@/components/ui/primitives';

type Tab = 'effects' | 'rationale';

const IMPACT_TONE: Record<'high' | 'medium' | 'low', Tone> = {
  high: 'good',
  medium: 'accent',
  low: 'neutral',
};

const CATEGORY_LABEL: Record<string, string> = {
  orientation: 'Orientation',
  envelope: 'Envelope',
  glazing: 'Glazing',
  roof: 'Roof',
  shading: 'Shading',
  ventilation: 'Ventilation',
  services: 'Services',
};

export function RecommendationPanel() {
  const [tab, setTab] = useState<Tab>('effects');

  const recommendations = useDesignStore((state) => state.recommendations);
  const analysis = useDesignStore((state) => state.climateAnalysis);
  const mode = useDesignStore((state) => state.mode);
  const setPanel = useDesignStore((state) => state.setPanel);

  const rationale = analysis?.rationale ?? [];

  return (
    <Panel
      title="Why this design?"
      subtitle={
        mode === 'auto'
          ? 'Each decision and the change it causes'
          : 'The climate engine’s proposal — your design may differ'
      }
      accent="analysis"
      scroll
      right={
        <>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'effects'}
            className={`tab ${tab === 'effects' ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab('effects')}
          >
            Effects ({recommendations.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rationale'}
            className={`tab ${tab === 'rationale' ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab('rationale')}
          >
            Reasoning ({rationale.length})
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setPanel('recommendations', false)}
            title="Hide this panel"
          >
            Hide
          </button>
        </>
      }
    >
      {tab === 'effects' ? (
        recommendations.length > 0 ? (
          <div className="space-y-2">
            {recommendations.map((recommendation) => (
              <article
                key={recommendation.id}
                className="rounded-md border bg-card/40 px-2.5 py-2 transition-colors hover:border-border"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone="neutral">{CATEGORY_LABEL[recommendation.category] ?? recommendation.category}</Chip>
                  <Chip tone={IMPACT_TONE[recommendation.impact]}>{recommendation.impact} impact</Chip>
                  {recommendation.effect ? (
                    <span className="ml-auto text-[12px] font-semibold tabular-nums text-primary">
                      {recommendation.effect}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    {recommendation.parameter}
                  </span>
                  <ArrowRight size={13} className="text-muted-foreground" aria-hidden />
                  <span className="text-[13px] font-medium text-primary">
                    {recommendation.value}
                  </span>
                </div>

                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  {recommendation.reason}
                </p>
              </article>
            ))}

            <div className="flex items-start gap-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
              <HelpCircle size={13} className="mt-[2px] shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-[12px] leading-snug text-muted-foreground/80">
                {EFFECT_METHOD_NOTE}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            message="No recommendations yet"
            hint="Generate a design to run the climate analysis."
          />
        )
      ) : rationale.length > 0 ? (
        <div className="space-y-2">
          {rationale.map((item) => (
            <article key={item.id} className="rounded-md border bg-card/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Lightbulb
                  size={13}
                  style={{ color: 'hsl(var(--stage-optimize))' }}
                  aria-hidden
                />
                <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                <Chip tone={IMPACT_TONE[item.impact]} className="ml-auto">
                  {item.impact}
                </Chip>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{item.reason}</p>
              <p className="mt-1 flex items-baseline gap-1.5 text-[12px]">
                <span className="text-muted-foreground/70">{item.parameter}</span>
                <span className="font-semibold text-primary">{item.value}</span>
              </p>
            </article>
          ))}

          <p className="text-[12px] leading-snug text-muted-foreground/65">
            These are rule-based decisions from the climate engine. The Effects tab shows what each
            one is actually worth in this design, measured by the thermal model rather than assumed.
          </p>
        </div>
      ) : (
        <EmptyState message="No reasoning recorded" hint="Run the pipeline to populate this panel." />
      )}
    </Panel>
  );
}
