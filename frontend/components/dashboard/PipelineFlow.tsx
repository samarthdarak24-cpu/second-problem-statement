'use client';

/**
 * The visible pipeline.
 *
 * INPUT → CLIMATE → ANALYSIS → THERMAL → OPTIMISATION → PARAMETERS → 3D → RESULTS
 *
 * This is not a decoration. The project brief asks for the chain to be *visible*,
 * because the argument the tool makes — "these numbers came from that climate,
 * through that model, to that envelope" — is only credible if the user can watch
 * it happen. Each stage therefore carries a real headline value pulled from the
 * store, not a placeholder, and the connectors animate only when the stage they
 * feed has actually run.
 *
 * The stages advance from real events emitted by `optimization/pipeline.ts`.
 * There is no timer pretending to be progress.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { PipelineStage, PipelineStageStatus } from '@/types';
import { useDesignStore, STAGE_ORDER } from '@/store/designStore';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Status presentation                                                 */
/* ------------------------------------------------------------------ */

const STATUS_COLOR: Record<PipelineStageStatus, string> = {
  idle: 'hsl(var(--muted-foreground) / 0.35)',
  running: 'hsl(var(--primary))',
  done: 'hsl(var(--success))',
  error: 'hsl(var(--destructive))',
};

const STATUS_LABEL: Record<PipelineStageStatus, string> = {
  idle: 'Waiting',
  running: 'Running',
  done: 'Complete',
  error: 'Failed',
};

const ACCENT: Record<string, string> = {
  input: 'var(--stage-input)',
  climate: 'var(--stage-input)',
  analysis: 'var(--stage-analysis)',
  thermal: 'var(--stage-analysis)',
  optimization: 'var(--stage-optimize)',
  parameters: 'var(--stage-optimize)',
  geometry: 'var(--stage-output)',
  results: 'var(--stage-output)',
};

/* ------------------------------------------------------------------ */
/* Connector                                                           */
/* ------------------------------------------------------------------ */

/**
 * A dashed line between two stages.
 *
 * It animates only once the upstream stage has produced something, so the flow
 * reads as "data is moving" rather than as ambient decoration — and a stalled
 * pipeline visibly stops moving instead of looking busy.
 */
function Connector({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 26 8"
      preserveAspectRatio="none"
      className="hidden h-2 w-[18px] shrink-0 self-center sm:block lg:w-[26px]"
    >
      <line
        x1="0"
        y1="4"
        x2="26"
        y2="4"
        stroke={active ? 'hsl(var(--primary) / 0.65)' : 'hsl(var(--border))'}
        strokeWidth="1.5"
        strokeDasharray="5 5"
        className={active ? 'animate-flow-dash' : undefined}
      />
      <polygon
        points="26,4 20,1 20,7"
        fill={active ? 'hsl(var(--primary) / 0.65)' : 'hsl(var(--border))'}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* One stage card                                                      */
/* ------------------------------------------------------------------ */

function StageCard({
  stage,
  index,
  selected,
  onSelect,
}: {
  stage: PipelineStage;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = stage.status;
  const accent = ACCENT[stage.id] ?? 'var(--muted-foreground)';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${stage.label} — ${stage.description}`}
      className={cn(
        'group relative flex min-w-[142px] flex-1 flex-col gap-1 rounded-lg border px-3 py-2.5 text-left',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary/45 bg-card/85'
          : 'border-border/70 bg-card/45 hover:border-border hover:bg-card/70',
      )}
      style={
        status === 'running'
          ? { boxShadow: `0 0 0 1px hsl(${accent} / 0.5), 0 0 22px -6px hsl(${accent} / 0.6)` }
          : undefined
      }
    >
      {/* Stage accent stripe */}
      <span
        aria-hidden
        className="absolute inset-x-2 top-0 h-[2px] rounded-full"
        style={{ background: `hsl(${accent} / ${status === 'idle' ? 0.25 : 0.85})` }}
      />

      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[11px] font-bold tabular-nums',
            status === 'idle' ? 'bg-secondary text-muted-foreground' : 'text-background',
          )}
          style={
            status === 'idle'
              ? undefined
              : { background: STATUS_COLOR[status] }
          }
        >
          {index + 1}
        </span>

        <span className="truncate text-[13px] font-semibold text-foreground/90">
          {stage.label}
        </span>

        <span
          aria-hidden
          className={cn(
            'ml-auto h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'running' && 'animate-pulse',
          )}
          style={{ background: STATUS_COLOR[status] }}
        />
      </div>

      <span
        className={cn(
          'truncate text-[13px] font-medium tabular-nums',
          status === 'done' ? 'text-foreground' : 'text-muted-foreground/60',
        )}
      >
        {stage.headline}
      </span>

      {stage.durationMs !== undefined && stage.durationMs > 0 ? (
        <span className="text-[11px] tabular-nums text-muted-foreground/55">
          {stage.durationMs < 1 ? '<1' : Math.round(stage.durationMs)} ms
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The flow                                                            */
/* ------------------------------------------------------------------ */

export function PipelineFlow() {
  const pipeline = useDesignStore((state) => state.pipeline);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const open = useDesignStore((state) => state.panels.pipeline);
  const setPanel = useDesignStore((state) => state.setPanel);

  const [selected, setSelected] = useState(0);

  /* Follow the run: as stages complete, keep the detail strip on the newest
     one, unless the user has taken manual control of the selection. */
  const [pinned, setPinned] = useState(false);
  const furthestDone = useMemo(() => {
    let last = 0;
    pipeline.forEach((stage, index) => {
      if (stage.status === 'done' || stage.status === 'running') last = index;
    });
    return last;
  }, [pipeline]);

  useEffect(() => {
    if (!pinned) setSelected(furthestDone);
  }, [furthestDone, pinned]);

  const active = pipeline[selected] ?? pipeline[0];

  /* A connector is "live" when the stage it leaves has produced output. */
  const connectorActive = (index: number): boolean => {
    const stage = pipeline[index];
    return stage?.status === 'done' || stage?.status === 'running';
  };

  const doneCount = pipeline.filter((stage) => stage.status === 'done').length;

  return (
    <div className="panel overflow-hidden">
      <header className="panel-header pl-4">
        <div className="flex items-center gap-2">
          <h2 className="panel-title">Design pipeline</h2>
          <span className="text-[12px] tabular-nums text-muted-foreground/70">
            {doneCount}/{STAGE_ORDER.length} stages
          </span>
          {isGenerating ? (
            <span className="chip border-primary/35 bg-primary/10 text-primary">running</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setPanel('pipeline', !open)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </header>

      {open ? (
        <>
          {/* --- The chain --- */}
          {/*
            Cards and connectors are *direct* children of the row — a Fragment,
            not a per-stage wrapper `div`.

            The wrapper was the bug. A wrapper is an `auto`-width flex item, so
            the `flex-1` on the card inside it never had anything to share: the
            wrapper sized itself to the card's max-content, and a stage headline
            is a full sentence. The row then grew far wider than the panel and
            the last two stages were clipped off the right edge with no visible
            scroll affordance. Flattening the chain lets `flex-1` divide the
            panel evenly and `truncate` do its job.

            `min-w-[960px]` keeps the chain from collapsing on narrow viewports,
            where the parent's `overflow-x-auto` takes over.
          */}
          <div className="scroll-area overflow-x-auto px-3 py-2.5">
            <div className="flex w-full min-w-[960px] items-stretch gap-0">
              {pipeline.map((stage, index) => (
                <Fragment key={stage.id}>
                  <StageCard
                    stage={stage}
                    index={index}
                    selected={index === selected}
                    onSelect={() => {
                      setSelected(index);
                      setPinned(true);
                    }}
                  />
                  {index < pipeline.length - 1 ? (
                    <Connector active={connectorActive(index)} />
                  ) : null}
                </Fragment>
              ))}
            </div>
          </div>

          {/* --- Detail strip for the selected stage --- */}
          {active ? (
            <div className="border-t bg-background/40 px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[13px] font-semibold text-foreground">
                  {STAGE_ORDER.indexOf(active.id) + 1}. {active.label}
                </span>
                <span className="text-[13px] text-muted-foreground">{active.description}</span>
                <span
                  className="text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: STATUS_COLOR[active.status] }}
                >
                  {STATUS_LABEL[active.status]}
                </span>
                {pinned ? (
                  <button
                    type="button"
                    className="ml-auto text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setPinned(false)}
                  >
                    follow run
                  </button>
                ) : null}
              </div>

              {active.details.length > 0 ? (
                <ul className="mt-1.5 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                  {active.details.map((detail) => (
                    <li
                      key={detail}
                      className="flex items-start gap-1.5 text-[13px] text-muted-foreground"
                    >
                      <span
                        aria-hidden
                        className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                        style={{ background: `hsl(${ACCENT[active.id]} / 0.8)` }}
                      />
                      {detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
