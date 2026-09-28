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

/**
 * The *text* register of each tone.
 *
 * A chip draws its ink on a 12% tint of its own hue. Using the surface value
 * for both halves of that pair is what made every coloured chip in the app
 * measure between 1.0:1 and 1.5:1 — a mid-dark green word on a light green
 * wash of the same mid-dark green. These `-ink` values are the dark end of
 * the same hue, and each clears WCAG AA on its own tint.
 *
 * `neutral` has no paired tint worth darkening, so it keeps the foreground.
 */
const TONE_INK_VAR: Record<Tone, string> = {
  neutral: 'var(--foreground)',
  good: 'var(--success-ink)',
  warn: 'var(--warning-ink)',
  bad: 'var(--destructive-ink)',
  accent: 'var(--accent-ink)',
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
      {/*
        A 2px accent hairline along the top edge rather than a 3px stripe down
        the left. The left stripe made every panel read as a warning banner and
        stacked into a picket fence when three sat in a row; the top rule keeps
        the same colour coding — which stage this panel belongs to — without
        dominating the composition.
      */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: `hsl(${ACCENT_VAR[accent]} / 0.7)` }}
      />
      <header className="panel-header">
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
        color: `hsl(${TONE_INK_VAR[tone]})`,
        borderColor: `hsl(${TONE_VAR[tone]} / 0.32)`,
        background: `hsl(${TONE_VAR[tone]} / 0.12)`,
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
/* Grouped card — the white sub-card used *inside* a panel             */
/* ------------------------------------------------------------------ */

/**
 * A soft white block for grouping related readouts inside a panel.
 *
 * Exists so the many `rounded-md border bg-card/40 px-2.5 py-2` literals
 * scattered through the dashboard become one named thing. That literal was
 * also producing a slightly muddy translucent surface on the pastel canvas;
 * this is opaque, has the new radius, and matches the card language.
 */
export function CardBlock({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-2xl border px-4 py-3.5', className)}
      style={{ borderColor: 'hsl(30 14% 88% / 0.7)', background: 'hsl(var(--panel))' }}
    >
      {title || right ? (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {title ? (
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {title}
            </h3>
          ) : null}
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* File — the provenance tag used under a card's heading               */
/* ------------------------------------------------------------------ */

/** A one-line note under a card explaining where its numbers came from. */
export function NoteLine({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <p
      className="mt-1.5 text-[12px] leading-snug"
      style={{ color: `hsl(${TONE_VAR[tone]} / 0.72)` }}
    >
      {children}
    </p>
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

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

/**
 * A shimmering placeholder block.
 *
 * The workspace had no loading primitive: while the pipeline ran, pages
 * either showed a spinner or nothing at all, which reads as a blank box
 * on first paint. This is the base shape the others compose from.
 *
 * `aria-hidden` because the region it stands in carries `aria-busy`, and
 * a screen reader should hear one status line, not a dozen empty boxes.
 */
export function Skeleton({
  className,
  width,
  height,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <span
      aria-hidden
      className={cn('skeleton block rounded-md', className)}
      style={{ width, height }}
    />
  );
}

/**
 * A metric placeholder — matches the shape of `MetricCard` so the page
 * does not reflow when the real number lands.
 */
export function MetricSkeleton() {
  return (
    <div className="soft-card px-5 py-4" aria-hidden>
      <Skeleton height={10} width="42%" />
      <Skeleton className="mt-3" height={26} width="58%" />
      <Skeleton className="mt-3" height={9} width="72%" />
    </div>
  );
}

/**
 * A generic panel placeholder. `rows` controls how much body text is
 * suggested, so a tall panel and a short one look different while
 * loading rather than identically empty.
 */
export function PanelSkeleton({
  rows = 3,
  height,
  className,
}: {
  rows?: number;
  height?: number | string;
  className?: string;
}) {
  return (
    <div
      className={cn('soft-card px-5 py-4', className)}
      style={height ? { height } : undefined}
      aria-hidden
    >
      <Skeleton height={11} width="34%" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} height={10} width={index === rows - 1 ? '68%' : '100%'} />
        ))}
      </div>
    </div>
  );
}

/**
 * Server-rendered loading state for a whole route.
 *
 * Next renders this instantly while a route segment's JS is in flight,
 * which is the difference between "the app is thinking" and "the app is
 * broken".
 */
export function PageSkeleton() {
  return (
    <div className="page-pad page-gap" aria-busy="true" aria-live="polite">
      <span className="sr-only">Calculating thermal response…</span>
      <div aria-hidden>
        <Skeleton height={11} width="90px" />
        <Skeleton className="mt-3" height={28} width="240px" />
        <Skeleton className="mt-3" height={13} width="420px" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
      </div>
      <PanelSkeleton rows={4} height={280} />
    </div>
  );
}
