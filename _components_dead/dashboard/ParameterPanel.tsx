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
import { ChevronDown, Info, Lock, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
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

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-1 py-2.5 text-left"
      >
        <ChevronDown
          size={13}
          aria-hidden
          className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
        />
        <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground/85">
          {group.label}
        </span>
        {locked ? (
          <Lock size={12} className="shrink-0 text-muted-foreground/60" aria-label="Optimiser-controlled" />
        ) : null}
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground/50">
          {group.fields.length}
        </span>
      </button>

      {open ? (
        <div className="pb-3">
          <p className="mb-1 px-1 text-[12px] leading-snug text-muted-foreground/70">
            {group.note}
          </p>

          {group.fields.map((field) => {
            /* Only genuinely fixed programme values stay editable in auto mode. */
            const disabled = locked && !(field.kind === 'slider' && field.programme);

            if (field.kind === 'select') {
              return (
                <SelectRow
                  key={field.key}
                  label={field.label}
                  /* Optional select fields (the composite assemblies) are absent
                     on most designs; `String(undefined)` would render the
                     literal text "undefined" and match no option. */
                  value={String(currentParameters[field.key] ?? '')}
                  options={field.options}
                  onChange={(value) => updateSelect(field.key, value)}
                  disabled={disabled}
                  hint={field.hint}
                />
              );
            }

            const value = currentParameters[field.key];
            return (
              <SliderRow
                key={field.key}
                label={field.label}
                value={value}
                display={formatValue(field, value)}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(next) => updateNumeric(field.key, next)}
                disabled={disabled}
                hint={field.hint}
                programme={field.programme}
              />
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

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /* The programme and the building-type groups are the user's fixed brief — the
     optimiser never searches them, so they stay editable in auto mode. */
  const isLocked = (group: ParameterGroup): boolean =>
    mode === 'auto' && group.id !== 'programme' && group.id !== 'building-type';

  const toggle = (id: string): void =>
    setCollapsed((previous) => ({ ...previous, [id]: !previous[id] }));

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
      {/* ---------------- Mode banner ---------------- */}
      <div
        className="mb-3 flex items-start gap-2 rounded-md border px-2.5 py-2"
        style={{
          background:
            mode === 'auto' ? 'hsl(var(--accent) / 0.09)' : 'hsl(var(--primary) / 0.09)',
          borderColor:
            mode === 'auto' ? 'hsl(var(--accent) / 0.3)' : 'hsl(var(--primary) / 0.3)',
        }}
      >
        <Info
          size={13}
          className="mt-[1px] shrink-0"
          style={{ color: mode === 'auto' ? 'hsl(var(--accent))' : 'hsl(var(--primary))' }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">
            {mode === 'auto' ? 'Automatic mode' : 'Manual mode'}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            {mode === 'auto'
              ? 'The optimiser owns orientation, envelope, roof, shading and ventilation. Edit the programme freely — Generate re-searches.'
              : 'You own the envelope. The optimised design stays on screen as the reference you are scored against.'}
          </p>
          {mode === 'auto' ? (
            <button
              type="button"
              className="btn-secondary mt-1.5"
              onClick={() => setMode('manual')}
              disabled={isGenerating}
            >
              <Wand2 size={13} aria-hidden />
              Switch to manual
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary mt-1.5"
              onClick={() => setMode('auto')}
              disabled={isGenerating}
            >
              <Sparkles size={13} aria-hidden />
              Back to auto
            </button>
          )}
        </div>
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
            open={!collapsed[group.id]}
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
