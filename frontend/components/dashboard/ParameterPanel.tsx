'use client';

/**
 * The design parameter panel.
 *
 * In AUTO mode the envelope fields are disabled, and that is a deliberate
 * design decision rather than a limitation: the optimiser's answer is only
 * valid for the design it searched. Letting a slider silently invalidate the
 * search while the results panel still claimed "optimised" would be a lie. The
 * programme fields stay live because they are *inputs* to the search.
 *
 * Switching to MANUAL hands the envelope back, and the optimiser's answer is
 * kept as the reference the live design is scored against.
 */

import { useState } from 'react';
import { ChevronDown, Lock, RotateCcw, Sparkles, Unlock } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import {
  parameterGroups,
  type ParameterGroup,
  type SliderField,
} from '@/lib/parameters';
import { Panel, SelectRow, SliderRow } from '@/components/ui/primitives';
import { currency, pct } from '@/utils/format';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Value formatting                                                    */
/* ------------------------------------------------------------------ */

function formatValue(field: SliderField, value: number): string {
  switch (field.format) {
    case 'percent':
      return pct(value * 100);
    case 'currency':
      return currency(value);
    case 'degrees':
      return `${Math.round(value)}°`;
    case 'metres':
      return `${value.toFixed(field.decimals ?? 2)} m`;
    default: {
      const digits = field.decimals ?? 1;
      return field.unit ? `${value.toFixed(digits)} ${field.unit}` : value.toFixed(digits);
    }
  }
}

/* ------------------------------------------------------------------ */
/* One collapsible group                                               */
/* ------------------------------------------------------------------ */

function Group({
  group,
  open,
  onToggle,
  locked,
}: {
  group: ParameterGroup;
  open: boolean;
  onToggle: () => void;
  /** True when the optimiser owns this group in the current mode. */
  locked: boolean;
}) {
  const currentParameters = useDesignStore((state) => state.currentParameters);
  const updateNumeric = useDesignStore((state) => state.updateNumeric);
  const updateSelect = useDesignStore((state) => state.updateSelect);
  const setMode = useDesignStore((state) => state.setMode);

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="flex w-full items-center justify-between px-1 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
        >
          <ChevronDown
            size={13}
            aria-hidden
            className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
          />
          <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground/85">
            {group.label}
          </span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground/60">
            ({group.fields.length})
          </span>
        </button>

        {locked ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMode('manual');
              if (!open) onToggle();
            }}
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-all shadow-xs cursor-pointer"
            title="Controlled by AI. Click to switch to Manual Mode and unlock all sliders."
          >
            <Lock size={11} className="shrink-0 text-amber-500 animate-pulse" />
            <span>Unlock</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Unlock size={11} className="shrink-0" />
            <span>Live</span>
          </span>
        )}
      </div>

      {open ? (
        <div className="pb-3">
          {locked ? (
            <div className="mb-3 flex items-center justify-between gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 shadow-xs">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-amber-500/20 p-1 text-amber-600 dark:text-amber-400">
                  <Lock size={13} />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                    Locked by AI Optimiser
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Auto mode optimizes these {group.fields.length} settings. Click unlock to customize manually.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500 hover:bg-amber-600 px-2.5 py-1 text-[11.5px] font-bold text-slate-950 transition-colors shadow-sm cursor-pointer"
              >
                <Unlock size={12} />
                Unlock Sliders
              </button>
            </div>
          ) : (
            <p className="mb-1 px-1 text-[12px] leading-snug text-muted-foreground/70">
              {group.note}
            </p>
          )}

          {group.fields.map((field) => {
            /* Only genuinely fixed programme values stay editable in auto mode. */
            const disabled = locked && !(field.kind === 'slider' && field.programme);

            return (
              <div
                key={field.key}
                onClick={disabled ? () => setMode('manual') : undefined}
                className={cn(
                  'relative transition-all',
                  disabled && 'cursor-pointer rounded-md p-1 -m-1 hover:bg-amber-500/10 group/locked'
                )}
                title={disabled ? 'Click to unlock this slider in Manual Mode' : undefined}
              >
                {field.kind === 'select' ? (
                  <SelectRow
                    label={field.label}
                    value={String(currentParameters[field.key] ?? '')}
                    options={field.options}
                    onChange={(value) => updateSelect(field.key, value)}
                    disabled={disabled}
                    hint={field.hint}
                  />
                ) : (
                  <SliderRow
                    label={field.label}
                    value={currentParameters[field.key]}
                    display={formatValue(field, currentParameters[field.key])}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(next) => updateNumeric(field.key, next)}
                    disabled={disabled}
                    hint={field.hint}
                    programme={field.programme}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function ParameterPanel() {
  const mode = useDesignStore((state) => state.mode);
  const isDirty = useDesignStore((state) => state.isDirty);
  const hasClimate = useDesignStore((state) => state.climateData !== null);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const adoptAdvice = useDesignStore((state) => state.adoptAdvice);
  const adoptConventional = useDesignStore((state) => state.adoptConventional);
  const adviceParameters = useDesignStore((state) => state.adviceParameters);
  const setMode = useDesignStore((state) => state.setMode);
  /* The groups depend on the selected building type — the storey slider's
     legal range is per-type, so the panel must be rebuilt from the live
     parameters rather than the static default list. */
  const currentParameters = useDesignStore((state) => state.currentParameters);

  /*
   * Progressive disclosure.
   *
   * Only the two groups the user is *always* editing — the brief they are
   * building to, and the form that brief implies — start open. The envelope,
   * form and services groups are the optimiser's territory in auto mode, so
   * rendering twenty sliders for values the user did not choose was noise.
   * They are one click away, and in manual mode the user opens what they want
   * to touch.
   *
   * Stored as an *open* set rather than a *collapsed* set so a group added
   * later defaults to closed, which is the safe direction.
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    'building-type': true,
    programme: true,
  });

  /* The programme and the building-type groups are the user's fixed brief — the
     optimiser never searches them, so they stay editable in auto mode. */
  const isLocked = (group: ParameterGroup): boolean =>
    mode === 'auto' && group.id !== 'programme' && group.id !== 'building-type';

  const toggle = (id: string): void =>
    setOpenGroups((previous) => ({ ...previous, [id]: !previous[id] }));

  return (
    <Panel
      title="Design parameters"
      subtitle={
        mode === 'auto'
          ? 'Envelope chosen by the optimiser · programme fixed by you'
          : 'Every change re-runs the thermal model'
      }
      accent="input"
      scroll
      right={
        isDirty ? (
          <span className="chip border-warning/40 bg-warning/10 text-warning">modified</span>
        ) : null
      }
    >
      {/* ---------------- Simulation Control Mode Selector ---------------- */}
      <div className="mb-3 rounded-xl border border-border/80 bg-card/60 p-2.5 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Control Mode
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border',
              mode === 'auto'
                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            )}
          >
            {mode === 'auto' ? <Sparkles size={11} /> : <Unlock size={11} />}
            {mode === 'auto' ? 'AI Optimiser Mode' : 'Manual Mode (All Unlocked)'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/60 p-1">
          <button
            type="button"
            onClick={() => setMode('auto')}
            disabled={isGenerating}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-all cursor-pointer',
              mode === 'auto'
                ? 'bg-background text-foreground shadow-sm font-semibold border border-border/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            )}
          >
            <Sparkles size={13} className={mode === 'auto' ? 'text-primary' : ''} />
            <span>Auto (AI Mode)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            disabled={isGenerating}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-all cursor-pointer',
              mode === 'manual'
                ? 'bg-background text-foreground shadow-sm font-semibold border border-border/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
            )}
          >
            <Unlock size={13} className={mode === 'manual' ? 'text-emerald-500' : ''} />
            <span>Manual (Customise All)</span>
          </button>
        </div>

        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          {mode === 'auto'
            ? 'The AI optimiser computes Envelope, Form & Ventilation for peak comfort. Switch to Manual Mode or click any locked slider to freely edit.'
            : 'You have full parametric control over all 21+ sliders. Every adjustment updates the 3D model and recalculates thermal performance in real-time.'}
        </p>
      </div>

      {/* ---------------- Quick actions ---------------- */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="btn-secondary"
          onClick={adoptAdvice}
          disabled={!adviceParameters || !hasClimate || isGenerating}
          title="Load the climate engine's own proposal into the live design"
        >
          <Sparkles size={13} aria-hidden />
          Climate-engine design
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={adoptConventional}
          disabled={!hasClimate || isGenerating}
          title="Brick walls, RCC roof, single glazing, no insulation or shading"
        >
          <RotateCcw size={13} aria-hidden />
          Conventional
        </button>
      </div>

      {/* ---------------- Groups ---------------- */}
      <div className="rounded-md border bg-card/30 px-2">
        {parameterGroups(currentParameters).map((group) => (
          <Group
            key={group.id}
            group={group}
            open={Boolean(openGroups[group.id])}
            onToggle={() => toggle(group.id)}
            locked={isLocked(group)}
          />
        ))}
      </div>

      <p className="mt-2.5 px-1 text-[12px] leading-snug text-muted-foreground/60">
        Fields marked <span className="font-semibold">fixed</span> are the programme: the optimiser
        treats them as given and never searches them. Everything else is a design decision it is
        allowed to make.
      </p>
    </Panel>
  );
}
