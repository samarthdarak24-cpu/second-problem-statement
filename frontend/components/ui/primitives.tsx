'use client';

/**
 * Small presentational primitives.
 *
 * These wrap the design tokens declared in `globals.css` rather than inventing
 * new ones, so a change to the theme propagates without touching a component.
 * No business logic lives here — everything takes values and callbacks.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Accents                                                             */
/* ------------------------------------------------------------------ */

export type Accent = 'input' | 'analysis' | 'optimize' | 'output' | 'neutral';
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const ACCENT_VAR: Record<Accent, string> = {
  input: 'var(--stage-input)',
  analysis: 'var(--stage-analysis)',
  optimize: 'var(--stage-optimize)',
  output: 'var(--stage-output)',
  neutral: 'var(--muted-foreground)',
};

const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--foreground)',
  good: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--destructive)',
  accent: 'var(--accent)',
};

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export interface PanelProps {
  title: string;
  subtitle?: string;
  accent?: Accent;
  /** Rendered at the right of the header — badges, toggles, counts. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Let the body scroll instead of growing — used in the fixed-height dock. */
  scroll?: boolean;
  bodyClassName?: string;
}

export function Panel({
  title,
  subtitle,
  accent = 'neutral',
  right,
  children,
  className,
  scroll = false,
  bodyClassName,
}: PanelProps) {
  return (
    <section className={cn('panel relative flex min-h-0 flex-col overflow-hidden', className)}>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `hsl(${ACCENT_VAR[accent]} / 0.8)` }}
      />
      <header className="panel-header pl-6">
        <div className="min-w-0">
          <h2 className="panel-title truncate">{title}</h2>
          {subtitle ? <p className="panel-subtitle truncate">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
      </header>
      <div
        className={cn(
          'min-h-0 flex-1 px-5 py-4',
          scroll && 'scroll-area overflow-y-auto',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chips and stats                                                     */
/* ------------------------------------------------------------------ */

export function Chip({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn('chip', className)}
      style={{
        color: `hsl(${TONE_VAR[tone]})`,
        borderColor: `hsl(${TONE_VAR[tone]} / 0.35)`,
        background: `hsl(${TONE_VAR[tone]} / 0.1)`,
      }}
    >
      {children}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: Tone;
  /** Optional 0–1 meter drawn under the value. */
  meter?: number;
  /** Set when a *decrease* in this metric is the good outcome. */
  lowerIsBetter?: boolean;
  delta?: { value: number; unit: string };
  className?: string;
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  meter,
  lowerIsBetter,
  delta,
  className,
}: StatCardProps) {
  const improved =
    delta !== undefined && (lowerIsBetter ? delta.value < 0 : delta.value > 0);
  const deltaTone: Tone =
    delta === undefined || Math.abs(delta.value) < 1e-6
      ? 'neutral'
      : improved
        ? 'good'
        : 'bad';

  return (
    <div className={cn('stat-card', className)}>
      <div className="stat-label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="stat-value" style={{ color: `hsl(${TONE_VAR[tone]})` }}>
          {value}
        </span>
        {unit ? <span className="text-[13px] text-muted-foreground">{unit}</span> : null}
      </div>

      {meter !== undefined ? (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.max(0, Math.min(1, meter)) * 100}%`,
              background: `hsl(${TONE_VAR[tone]})`,
            }}
          />
        </div>
      ) : null}

      {delta ? (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: `hsl(${TONE_VAR[deltaTone]})` }}
          >
            {delta.value > 0 ? '+' : delta.value < 0 ? '−' : ''}
            {Math.abs(delta.value).toFixed(Math.abs(delta.value) < 10 ? 1 : 0)}
            {delta.unit}
          </span>
          <span className="text-[12px] text-muted-foreground/70">vs conventional</span>
        </div>
      ) : hint ? (
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground/75">{hint}</p>
      ) : null}
    </div>
  );
}

/** A compact label/value row for dense readouts. */
export function MetricRow({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5" title={hint}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span
        className="text-[13px] font-semibold tabular-nums"
        style={{ color: `hsl(${TONE_VAR[tone]})` }}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export interface SliderRowProps {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  hint?: string;
  /** Marks a fixed-programme value, which the optimiser never searches. */
  programme?: boolean;
}

export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
  hint,
  programme,
}: SliderRowProps) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] font-medium text-foreground/90">
          {label}
          {programme ? (
            <span
              title="Fixed programme — the optimiser treats this as given"
              className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              fixed
            </span>
          ) : null}
        </label>
        <span className="text-[13px] font-semibold tabular-nums text-primary">{display}</span>
      </div>
      <input
        type="range"
        className="slider mt-2"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      {hint ? (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelectRow({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="py-2">
      <label className="text-[13px] font-medium text-foreground/90">{label}</label>
      <select
        className="select-field mt-2"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => onChange(!checked)}
      className={cn('tab', checked ? 'tab-active' : 'tab-idle')}
      aria-pressed={checked}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: checked ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.5)',
        }}
      />
      {label}
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  icon?: ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          title={option.title}
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn('tab', option.value === value ? 'tab-active' : 'tab-idle')}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A thin labelled progress meter, used for scores and shares. */
export function Meter({
  value,
  label,
  right,
  tone = 'accent',
}: {
  value: number;
  label?: string;
  right?: string;
  tone?: Tone;
}) {
  return (
    <div>
      {label || right ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? <span className="text-[12px] text-muted-foreground">{label}</span> : null}
          {right ? (
            <span
              className="text-[12px] font-semibold tabular-nums"
              style={{ color: `hsl(${TONE_VAR[tone]})` }}
            >
              {right}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: `hsl(${TONE_VAR[tone]})`,
          }}
        />
      </div>
    </div>
  );
}

/** Empty-state placeholder so a missing result never renders as a blank box. */
export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      <p className="text-[14px] font-medium text-muted-foreground">{message}</p>
      {hint ? <p className="max-w-[320px] text-[12.5px] leading-snug text-muted-foreground/60">{hint}</p> : null}
    </div>
  );
}
