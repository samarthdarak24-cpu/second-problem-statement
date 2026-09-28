'use client';

/**
 * Digesto-style component primitives.
 *
 * The new "premium SaaS" surface area: pastel cards, section headers,
 * quick actions, recent design cards, status badges, gauges, and a
 * compact progress strip for the pipeline.
 *
 * All of these wrap the design tokens in `globals.css` (warm stone +
 * pastel scales), so a single change to the theme propagates through
 * the whole redesign.
 *
 * No business logic lives here — every component takes values and
 * callbacks and stays presentational.
 */

import { forwardRef } from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Chip } from './primitives';
import { cn } from '@/lib/utils';

/* ==================================================================
   Pastel surface scale
   ------------------------------------------------------------------ */

export type PastelTone =
  | 'blue'
  | 'lavender'
  | 'mint'
  | 'peach'
  | 'yellow'
  | 'pink'
  | 'gray';

const TONE_BG: Record<PastelTone, string> = {
  blue: 'surface-pastel-blue',
  lavender: 'surface-pastel-lavender',
  mint: 'surface-pastel-mint',
  peach: 'surface-pastel-peach',
  yellow: 'surface-pastel-yellow',
  pink: 'surface-pastel-pink',
  gray: 'surface-pastel-gray',
};

/* ==================================================================
   PastelCard — large pastel-background card.
   ------------------------------------------------------------------
   This is the visual unit of the new dashboard: one dominant number,
   one eyebrow label, one short description, optionally a tiny icon
   or trend line. Generous internal padding, no hard borders.
   ================================================================ */

export interface PastelCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PastelTone;
  /** Optional eyebrow label rendered at the top. */
  eyebrow?: ReactNode;
  /** Right-side slot in the eyebrow row — e.g. a small status pill. */
  eyebrowRight?: ReactNode;
  /** Optional icon shown next to the eyebrow label. */
  icon?: LucideIcon;
  /** Whether to render the inner body or expose a children-only layout. */
  children?: ReactNode;
}

export function PastelCard({
  tone = 'blue',
  eyebrow,
  eyebrowRight,
  icon: Icon,
  className,
  children,
  ...rest
}: PastelCardProps) {
  return (
    <div
      className={cn('pastel-card relative flex flex-col p-6', TONE_BG[tone], className)}
      {...rest}
    >
      {(eyebrow || eyebrowRight || Icon) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {eyebrow || Icon ? (
            <div className="flex min-w-0 items-center gap-2">
              {Icon ? (
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: 'hsl(0 0% 100% / 0.55)',
                    color: 'inherit',
                  }}
                >
                  <Icon size={14} />
                </span>
              ) : null}
              {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            </div>
          ) : null}
          {eyebrowRight ? <div className="shrink-0">{eyebrowRight}</div> : null}
        </div>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ==================================================================
   MetricCard — large dominant number inside a PastelCard.
   ------------------------------------------------------------------
   Use this for the headline engineering outputs (indoor temp,
   solar gain, heat flow). One number, one unit, one description.
   ================================================================ */

export interface MetricCardProps {
  tone?: PastelTone;
  label: string;
  icon?: LucideIcon;
  value: string;
  unit?: string;
  description?: ReactNode;
  /** Optional tiny meta row beneath the value (e.g. "vs conventional −12%"). */
  meta?: ReactNode;
  /** Optional small element in the top right (e.g. a delta chip). */
  right?: ReactNode;
}

export function MetricCard({
  tone = 'blue',
  label,
  icon,
  value,
  unit,
  description,
  meta,
  right,
}: MetricCardProps) {
  const Icon = icon;
  return (
    <PastelCard tone={tone} eyebrow={label} icon={Icon} eyebrowRight={right}>
      <div className="flex items-baseline gap-2">
        <span className="metric-display">{value}</span>
        {unit ? (
          <span className="text-[14px] font-medium opacity-70">{unit}</span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-3 text-[13px] leading-snug opacity-75">{description}</p>
      ) : null}
      {meta ? <div className="mt-4">{meta}</div> : null}
    </PastelCard>
  );
}

/* ==================================================================
   PageHeader — the page's identity row.
   ------------------------------------------------------------------
   Replaces the engineering "title + description" pattern. Greeting
   optional; otherwise: kicker + title + description + optional CTA.
   ================================================================ */

export interface PageHeaderProps {
  kicker?: string;
  title: string;
  description?: string;
  /** Right-aligned action area (e.g. Generate design). */
  actions?: ReactNode;
}

/**
 * A page's context strip: kicker, title, description, actions.
 *
 * The heading is an `<h2>`, not an `<h1>`. The shell's `Topbar` already
 * renders the page `<h1>` from the nav model, so an `<h1>` here produced
 * two top-level headings per page — and because both render the *same*
 * string, the title appeared twice, stacked, on `/dashboard` and
 * `/settings`.
 *
 * The visual size is unchanged. This is an outline fix, not a restyle:
 * the `<h2>` remains the largest text in the content area, and the
 * `section-title-soft` rule it would otherwise inherit does not apply
 * because the size utilities below are explicit.
 */
export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker ? <p className="section-eyebrow">{kicker}</p> : null}
        <h2 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-foreground sm:text-[30px]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ==================================================================
   SectionHeader — the divider above a row of cards.
   ------------------------------------------------------------------
   Uses the eyebrow pattern so the section reads as a label, not a
   heading.
   ================================================================ */

export function SectionHeader({
  eyebrow,
  title,
  description,
  right,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
  /**
   * Heading level. Defaults to `h2`, which is correct for every current
   * call site: the shell's `Topbar` already renders the page `<h1>` from
   * the nav model, so these are always *section* headings beneath it.
   *
   * Do **not** pass `1` on a normal page — that duplicates the Topbar's
   * `<h1>` and breaks the document outline. It exists only for content
   * rendered outside the `(app)` shell (a printed report, a standalone
   * view) where no `<h1>` has been emitted yet.
   */
  level?: 1 | 2 | 3;
}) {
  const Heading = (level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2') as 'h1' | 'h2' | 'h3';

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
        <Heading className="section-title-soft mt-1">{title}</Heading>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* ==================================================================
   QuickActionCard — single-tap entry point surfaced on the dashboard.
   ================================================================ */

export interface QuickActionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  href?: string;
  onClick?: () => void;
  tone?: PastelTone;
}

export function QuickActionCard({
  icon: Icon,
  title,
  description,
  href,
  onClick,
  tone = 'gray',
}: QuickActionProps) {
  const inner = (
    <div className="quick-action group">
      <span
        aria-hidden
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          TONE_BG[tone],
        )}
      >
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <ArrowUpRight
        size={15}
        className="shrink-0 text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {inner}
    </button>
  );
}

/* ==================================================================
   RecentDesignCard — saved / cached design on the dashboard.
   ------------------------------------------------------------------
   Pure presentational. Takes a thumbnail (ReactNode) and meta data.
   ================================================================ */

export interface RecentDesignCardProps {
  /** Small thumb (3D preview, image, or icon). */
  thumbnail: ReactNode;
  title: string;
  subtitle?: string;
  /** Single big metric on the right (e.g. "67%"). */
  metric?: { value: string; label: string };
  timestamp?: string;
  href?: string;
  onClick?: () => void;
}

export function RecentDesignCard({
  thumbnail,
  title,
  subtitle,
  metric,
  timestamp,
  href,
  onClick,
}: RecentDesignCardProps) {
  const inner = (
    <div className="quick-action group h-full">
      <div
        className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border"
        style={{ borderColor: 'hsl(30 14% 88% / 0.7)', background: 'hsl(var(--pastel-gray))' }}
      >
        {thumbnail}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-foreground">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
        {timestamp ? (
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            {timestamp}
          </p>
        ) : null}
      </div>
      {metric ? (
        <div className="flex shrink-0 flex-col items-end">
          <span className="metric-display text-[1.35rem]">{metric.value}</span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
            {metric.label}
          </span>
        </div>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block h-full">
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block h-full w-full text-left">
      {inner}
    </button>
  );
}

/* ==================================================================
   StatusBadge — small dot + label, used in the new compact header.
   ================================================================ */

export type StatusTone = 'ready' | 'generating' | 'updated' | 'error' | 'idle';

export function StatusBadge({
  tone = 'ready',
  label,
}: {
  tone?: StatusTone;
  label: string;
}) {
  /**
   * `dot` is the *surface* value — it only has to be visible as a 6px circle.
   * `fg` is the *ink* value, and it is a different, darker register of the
   * same hue, because `ready` previously painted `hsl(158 46% 30%)` text on
   * `hsl(158 46% 30% / 0.1)` and measured 1.42:1. Every `fg` below now clears
   * WCAG AA against its own `bg`.
   */
  const palette: Record<StatusTone, { dot: string; bg: string; fg: string }> = {
    ready: {
      dot: 'hsl(158 46% 30%)',
      bg: 'hsl(158 46% 30% / 0.12)',
      fg: 'hsl(var(--success-ink))',
    },
    generating: {
      dot: 'hsl(18 68% 44%)',
      bg: 'hsl(18 68% 44% / 0.12)',
      fg: 'hsl(var(--accent-ink))',
    },
    updated: {
      dot: 'hsl(218 60% 45%)',
      bg: 'hsl(218 62% 94%)',
      fg: 'hsl(220 52% 26%)',
    },
    error: {
      dot: 'hsl(0 62% 44%)',
      bg: 'hsl(0 62% 44% / 0.12)',
      fg: 'hsl(var(--destructive-ink))',
    },
    idle: {
      dot: 'hsl(27 9% 50%)',
      bg: 'hsl(30 16% 93%)',
      fg: 'hsl(27 12% 30%)',
    },
  };
  const p = palette[tone];
  return (
    <span
      className="status-badge"
      style={{
        background: p.bg,
        borderColor: 'hsl(30 14% 88% / 0.7)',
        color: p.fg,
      }}
    >
      <span className="status-dot" style={{ background: p.dot }} aria-hidden />
      {label}
    </span>
  );
}

/* ==================================================================
   ProgressStrip — compact pipeline indicator on the dashboard.
   ------------------------------------------------------------------
   Replaces the wide 8-stage flow. Five steps, status dots, no
   connector animation when idle.
   ================================================================ */

export interface ProgressStep {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
}

export function ProgressStrip({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="progress-strip">
      {steps.map((step, idx) => {
        const dotColor =
          step.status === 'done'
            ? 'hsl(158 46% 30%)'
            : step.status === 'running'
              ? 'hsl(18 68% 44%)'
              : step.status === 'error'
                ? 'hsl(0 62% 44%)'
                : 'hsl(30 14% 78%)';
        return (
          <span key={step.id} className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dotColor }}
              aria-hidden
            />
            <span className="text-[12px] font-medium text-foreground/80">
              {step.label}
            </span>
            {idx < steps.length - 1 ? (
              <span
                aria-hidden
                className="mx-1 hidden h-px w-3 bg-border sm:inline-block"
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/* ==================================================================
   Gauge — circular percentage dial.
   ------------------------------------------------------------------
   Used for the Thermal Comfort card. SVG only, no chart library.
   ================================================================ */

export interface GaugeProps {
  /** 0–1 */
  value: number;
  label?: string;
  size?: number;
  /** Optional colour for the active arc. Defaults to pastel-blue foreground. */
  color?: string;
  /** Optional subline rendered below the percentage. */
  subline?: string;
}

export function Gauge({
  value,
  label,
  size = 168,
  color,
  subline,
}: GaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = c * clamped;
  const rest = c - dash;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden={!label}
        role={label ? 'img' : undefined}
        aria-label={label}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="gauge-rail"
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color ?? 'hsl(220 50% 45%)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${rest}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${dash} ${rest}` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={size * 0.22}
          fontWeight={700}
          fill="hsl(24 10% 12%)"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {Math.round(clamped * 100)}
          <tspan fontSize={size * 0.09} dy={-size * 0.02} dx={2} fill="hsl(27 9% 50%)">
            %
          </tspan>
        </text>
      </svg>
      {subline ? (
        <p className="-mt-2 text-[12px] font-medium text-muted-foreground">
          {subline}
        </p>
      ) : null}
    </div>
  );
}

/* ==================================================================
   ThreeDPreviewCard — large 3D viewport tile for the dashboard.
   ------------------------------------------------------------------
   Wraps an arbitrary child (the 3D canvas) with the soft-card chrome
   so the dashboard preview doesn't look like an engineering window.
   ================================================================ */

export interface ThreeDPreviewCardProps {
  title?: string;
  subtitle?: string;
  /** Optional right-side mini controls. */
  right?: ReactNode;
  children: ReactNode;
  /** Tailwind height class. Defaults to ~420px. */
  className?: string;
  bodyClassName?: string;
}

export function ThreeDPreviewCard({
  title,
  subtitle,
  right,
  children,
  className,
  bodyClassName,
}: ThreeDPreviewCardProps) {
  return (
    <div className={cn('soft-card flex min-h-0 flex-col overflow-hidden', className)}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <div className="min-w-0">
            {title ? (
              <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </p>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      )}
      <div className={cn('flex-1', bodyClassName)}>{children}</div>
    </div>
  );
}

/* ==================================================================
   LocationChip — small site pill used in the new compact header.
   ================================================================ */

export interface LocationChipProps {
  city: string;
  state?: string;
}

export function LocationChip({ city, state }: LocationChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-foreground">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'hsl(18 68% 44%)' }}
      />
      <span>{city}</span>
      {state ? (
        <span className="text-[11.5px] font-normal text-muted-foreground">
          · {state}
        </span>
      ) : null}
    </span>
  );
}

/* ==================================================================
   ExpandableSection — collapsible content block.
   ------------------------------------------------------------------
   Used for "advanced parameters" inside the redesigned Design Studio.
   ================================================================ */

export interface ExpandableSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  right?: ReactNode;
}

export function ExpandableSection({
  title,
  description,
  defaultOpen = false,
  children,
  right,
}: ExpandableSectionProps) {
  return (
    <details
      className="group rounded-[18px] border bg-panel"
      style={{ borderColor: 'hsl(30 14% 88% / 0.7)' }}
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {right}
          <span
            aria-hidden
            className="text-muted-foreground/60 transition-transform group-open:rotate-180"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.2 6.2 8 10l3.8-3.8" />
            </svg>
          </span>
        </div>
      </summary>
      <div className="border-t px-5 py-4">{children}</div>
    </details>
  );
}

/* ==================================================================
   GenerationOverlay — full-page progress overlay during a pipeline run.
   ------------------------------------------------------------------
   Replaces the always-visible 8-stage flow. Shown only while
   generating.
   ================================================================ */

export interface GenerationStep {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
}

export interface GenerationOverlayProps {
  open: boolean;
  steps: GenerationStep[];
  progress?: number;
  headline?: string;
  subline?: string;
}

export function GenerationOverlay({
  open,
  steps,
  progress,
  headline = 'Running the design pipeline…',
  subline,
}: GenerationOverlayProps) {
  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/40 backdrop-blur-[2px] sm:items-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="soft-card mx-4 mb-4 w-full max-w-md p-6"
      >
        <p className="section-eyebrow">Generating design</p>
        <h3 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {headline}
        </h3>
        {subline ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {subline}
          </p>
        ) : null}

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(0, Math.min(1, progress ?? 0)) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        <ul className="mt-5 space-y-1.5">
          {steps.map((step) => (
            <div
              key={step.id}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    step.status === 'done'
                      ? 'hsl(158 46% 30%)'
                      : step.status === 'running'
                        ? 'hsl(18 68% 44%)'
                        : step.status === 'error'
                          ? 'hsl(0 62% 44%)'
                          : 'hsl(30 14% 78%)',
                }}
              />
              <span
                className={
                  step.status === 'running'
                    ? 'font-medium text-foreground'
                    : step.status === 'done'
                      ? 'text-foreground/85'
                      : 'text-muted-foreground'
                }
              >
                {step.label}
              </span>
              {step.status === 'running' ? (
                <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
                  running
                </span>
              ) : null}
              {step.status === 'done' ? (
                <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
                  done
                </span>
              ) : null}
            </div>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

/* ==================================================================
   InlineLink — a small text link that doesn't look like a button.
   ================================================================ */

export interface InlineLinkProps extends HTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export const InlineLink = forwardRef<HTMLAnchorElement, InlineLinkProps>(
  function InlineLink({ href, className, children, ...rest }, ref) {
    return (
      <a
        ref={ref}
        href={href}
        className={cn(
          'inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline',
          className,
        )}
        {...rest}
      >
        {children}
        <ArrowUpRight size={12} aria-hidden />
      </a>
    );
  },
);

/* ==================================================================
   BarRow — horizontal pastel bar with label & value, used for the
   "Heat-flow breakdown" rows on the redesigned Thermal Analysis page.
   ================================================================ */

export interface BarRowProps {
  label: string;
  value: string;
  /** 0–1 share for the bar fill. */
  share: number;
  tone?: PastelTone;
}

export function BarRow({ label, value, share, tone = 'peach' }: BarRowProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 truncate text-[12.5px] font-medium text-foreground/85">
        {label}
      </div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className={cn('h-full rounded-full', TONE_BG[tone])}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="w-24 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

/* ==================================================================
   ActionButton — a primary CTA with icon, used by PageHeader.
   ================================================================ */

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  tone?: 'primary' | 'ink' | 'ghost';
}

export function ActionButton({
  icon: Icon,
  tone = 'primary',
  className,
  children,
  ...rest
}: ActionButtonProps) {
  const base =
    tone === 'primary'
      ? 'btn-primary'
      : tone === 'ink'
        ? 'btn-ink'
        : 'btn-secondary';
  return (
    <button type="button" className={cn(base, className)} {...rest}>
      {Icon ? <Icon size={14} aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ==================================================================
   VerdictChip — the status of a thermal reading.
   ------------------------------------------------------------------
   Encoded three ways at once: a word, an icon, and a hue. Colour is
   never the only signal, so the chip still reads correctly in
   greyscale, under a colour-blindness filter, and to a screen reader
   (the word is real text, the icon is `aria-hidden`).

   Both the Dashboard and Thermal Analysis lead with this, so it lives
   here rather than in either page.
   ================================================================ */

export type VerdictTone = 'good' | 'warn' | 'bad';

const VERDICT_LOOK: Record<
  VerdictTone,
  { tone: 'good' | 'warn' | 'bad'; word: string; Icon: typeof AlertTriangle }
> = {
  good: { tone: 'good', word: 'Within band', Icon: CheckCircle2 },
  warn: { tone: 'warn', word: 'Attention', Icon: AlertTriangle },
  bad: { tone: 'bad', word: 'Critical', Icon: XCircle },
};

export function VerdictChip({ verdict }: { verdict: VerdictTone }) {
  const look = VERDICT_LOOK[verdict];
  const Icon = look.Icon;
  return (
    <Chip tone={look.tone}>
      <Icon size={12} aria-hidden />
      {look.word}
    </Chip>
  );
}

/* ==================================================================
   Motion primitives
   ------------------------------------------------------------------
   Two rules from the brief govern everything here:

     "Animations must be subtle: calm and technical, never decorative."

   and

     "Never show empty white areas."

   So the motion vocabulary is intentionally tiny. Content *settles*
   into place — a short rise and a fade — rather than sliding, scaling
   or bouncing. Nothing animates on hover that did not animate before,
   and nothing loops.

   Reduced motion is handled globally by `<MotionConfig
   reducedMotion="user">` in the shell, so these components do not each
   need a guard: with the OS setting on, framer-motion drops the
   transforms and keeps the opacity fade, which still reads as
   "arrived" without any movement.
   ================================================================ */

/**
 * `Reveal` — settle a block into place as it enters the viewport.
 *
 * `once: true` matters on a page that is mostly reading: an element
 * that re-animates on every scroll past makes the page feel restless.
 * Motion marks arrival, then gets out of the way.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  /** Seconds. Use to stagger siblings. */
  delay?: number;
  className?: string;
  /** Semantic wrapper element — keep the page's outline intact. */
  as?: 'div' | 'section' | 'li';
}) {
  const MotionTag = motion[Tag];
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * `Stagger` — reveal a list of children in sequence.
 *
 * Used where the *order* carries meaning (the envelope paths, ranked;
 * the optimisation candidates, ranked). The stagger is deliberately
 * short — 60 ms — so a six-item list finishes in well under half a
 * second and never makes the user wait for the interface.
 */
export function Stagger({
  children,
  className,
  step = 0.06,
  as: Tag = 'div',
  role,
}: {
  children: ReactNode;
  className?: string;
  /** Seconds between siblings. */
  step?: number;
  /**
   * Element to render. Pass `dl` when the children are `dt`/`dd` pairs —
   * a `dt` without a `dl` parent loses its definition-list semantics, and
   * screen readers stop announcing the label/value relationship.
   */
  as?: 'div' | 'dl' | 'ul';
  role?: string;
}) {
  const MotionTag = motion[Tag];
  return (
    <MotionTag
      className={className}
      role={role}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: step } },
      }}
    >
      {children}
    </MotionTag>
  );
}

/** A single child of `Stagger`. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ==================================================================
   Re-exports
   ================================================================ */

export { ArrowUpRight };
export type { LucideIcon, SVGProps };