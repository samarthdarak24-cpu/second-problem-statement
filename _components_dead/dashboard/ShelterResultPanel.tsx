'use client';

/**
 * The three quantities the problem statement asks for, at the top level.
 *
 * WHY THIS PANEL EXISTS
 * The dashboard was leading with a composite "design score" — a number the
 * optimiser invented to rank its own candidates. That is an internal search
 * artefact, not an engineering result, and a reviewer cannot check it.
 *
 * DRDO asks for three specific things:
 *
 *   1. predicted shelter indoor temperature, from the user's inputs
 *   2. thermal energy generated from solar radiation
 *   3. heat-flow details from the ambient-to-shelter temperature difference
 *
 * All three are TRANSIENT. A monthly mean cannot show that a Ladakhi shelter
 * reaches its peak in the afternoon and falls back toward outdoor conditions
 * after sunset — and that fall is the entire engineering problem the statement
 * describes. So the centre of this panel is the 24-hour curve, and the three
 * headline figures are read off it.
 *
 * WHAT IT IS NOT
 * Not a measured building result. Every figure is a model estimate from the
 * simplified heat balance in `thermal/thermalModel.ts`, and the panel says so
 * on its face rather than in a footnote.
 */

import Link from 'next/link';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Box, Flame, Info, ThermometerSun, Wind } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, Panel } from '@/components/ui/primitives';
import { MONTH_LABELS } from '@/utils/units';
import { num } from '@/utils/format';

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const t = (value: number): string => `${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(1)}`;

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/* ------------------------------------------------------------------ */
/* One of the three required outputs                                   */
/* ------------------------------------------------------------------ */

function OutputCard({
  index,
  label,
  question,
  value,
  unit,
  children,
  icon,
  tone,
}: {
  index: number;
  label: string;
  /** The wording from the problem statement, so the mapping is explicit. */
  question: string;
  value: string;
  unit: string;
  children?: React.ReactNode;
  icon: React.ReactNode;
  tone: 'warm' | 'solar' | 'cool';
}) {
  const accent =
    tone === 'warm'
      ? 'hsl(var(--destructive))'
      : tone === 'solar'
        ? 'hsl(var(--primary))'
        : 'hsl(var(--stage-optimize))';

  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card/40 p-3">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {index}. {label}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">{question}</p>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[24px] font-semibold leading-none tabular-nums" style={{ color: accent }}>
          {value}
        </span>
        <span className="text-[12px] text-muted-foreground">{unit}</span>
      </div>

      {children ? <div className="mt-2.5">{children}</div> : null}
    </div>
  );
}

/** A labelled magnitude bar, used for the per-component heat flow. */
function FlowBar({ label, value, max }: { label: string; value: number; max: number }) {
  /* A term that nets to nothing over the day is a real result — walls are
     near-neutral when indoor and outdoor temperature track each other — but
     "−0.0" reads as a rendering fault. It is shown as a neutral zero. */
  const negligible = Math.abs(value) < 0.05;
  const share = max > 1e-9 ? Math.min(1, Math.abs(value) / max) : 0;
  const leaving = value < 0;

  const color = negligible
    ? 'hsl(var(--muted-foreground) / 0.5)'
    : leaving
      ? 'hsl(var(--stage-optimize))'
      : 'hsl(var(--success))';

  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          className="absolute inset-y-0 rounded-full"
          style={{
            width: `${share * 100}%`,
            left: leaving ? 'auto' : 0,
            right: leaving ? 0 : 'auto',
            background: color,
          }}
        />
      </div>
      <span
        className="w-[58px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums"
        style={{ color }}
      >
        {negligible ? '0.0' : `${leaving ? '−' : '+'}${Math.abs(value).toFixed(1)}`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function ShelterResultPanel({ className }: { className?: string }) {
  const thermal = useDesignStore((state) => state.currentThermal);
  const climateData = useDesignStore((state) => state.climateData);
  const parameters = useDesignStore((state) => state.currentParameters);

  const profile = thermal?.dailyProfile;

  if (!profile || !climateData) {
    return (
      <Panel
        title="Area-specific shelter result"
        subtitle="Indoor temperature · solar gain · heat flow"
        accent="output"
        className={className}
      >
        <EmptyState
          message="No simulation yet"
          hint="Press Generate design to resolve the climate and run the thermal model for this site."
        />
      </Panel>
    );
  }

  const monthLabel = MONTH_LABELS[profile.month] ?? '';
  const heating = climateData.summary.peakHeatingMonth === profile.month;

  /* Chart data — one row per hour, both curves on one axis so the gap between
     them (which is the whole point) is directly readable. */
  const chartData = profile.points.map((p) => ({
    hour: p.hour,
    label: hourLabel(p.hour),
    indoor: Number(p.indoorTemp.toFixed(2)),
    outdoor: Number(p.outdoorTemp.toFixed(2)),
  }));

  const flowMax = Math.max(
    Math.abs(profile.wallKwh),
    Math.abs(profile.roofKwh),
    Math.abs(profile.floorKwh),
    Math.abs(profile.windowKwh),
    Math.abs(profile.doorKwh),
    Math.abs(profile.ventilationKwh),
    1e-6,
  );

  return (
    <Panel
      title="Area-specific shelter result"
      subtitle={`${climateData.location.city} · ${climateData.climateType} · representative day in ${monthLabel}`}
      accent="output"
      className={className}
      right={
        <>
          <Chip
            tone={heating ? 'warn' : 'neutral'}
            title="The month the design is judged on: the coldest when heating dominates the year, the hottest when cooling does"
          >
            {heating ? 'Heating-critical' : 'Cooling-critical'}
          </Chip>
          <Chip tone="neutral" title="Engine provenance">
            Simplified heat balance
          </Chip>
        </>
      }
    >
      {/* ================= The three required outputs ================= */}
      <div className="grid gap-2.5 lg:grid-cols-3">
        <OutputCard
          index={1}
          label="Indoor temperature"
          question="Predicted shelter indoor temperature from the user's inputs."
          value={`${t(profile.indoorMin)} … ${t(profile.indoorMax)}`}
          unit="°C free-running"
          icon={<ThermometerSun size={12} aria-hidden />}
          tone="warm"
        >
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Outdoor swings <b className="text-foreground/80">{num(profile.outdoorSwing, 1)} K</b>; the
            fabric removes <b className="text-foreground/80">{Math.round(profile.swingDamping * 100)}%</b>{' '}
            of it, leaving {num(profile.indoorSwing, 1)} K indoors.
          </p>
        </OutputCard>

        <OutputCard
          index={2}
          label="Solar thermal gain"
          question="Thermal energy generated from solar radiation."
          value={num(profile.solarGainKwh, 1)}
          unit="kWh / day"
          icon={<Flame size={12} aria-hidden />}
          tone="solar"
        >
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {num(profile.solarGainPerSqm, 2)} kWh/m²·day · peaks at {hourLabel(profile.solarPeakHour)} ·
            covers <b className="text-foreground/80">{Math.round(profile.solarCoverage * 100)}%</b> of the
            day&apos;s losses.
          </p>
        </OutputCard>

        <OutputCard
          index={3}
          label="Heat flow"
          question="Heat-flow details from the ambient-to-shelter temperature difference."
          value={num(profile.heatLossKwh, 1)}
          unit="kWh / day leaving"
          icon={<Wind size={12} aria-hidden />}
          tone="cool"
        >
          <div className="space-y-1">
            <FlowBar label="Walls" value={profile.wallKwh} max={flowMax} />
            <FlowBar label="Roof" value={profile.roofKwh} max={flowMax} />
            <FlowBar label="Floor" value={profile.floorKwh} max={flowMax} />
            <FlowBar label="Windows" value={profile.windowKwh} max={flowMax} />
            <FlowBar label="Doors" value={profile.doorKwh} max={flowMax} />
            <FlowBar label="Ventilation" value={profile.ventilationKwh} max={flowMax} />
          </div>
        </OutputCard>
      </div>

      {/* ================= The 24-hour curve ================= */}
      <div className="mt-3 rounded-lg border bg-card/30 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            24-hour temperature curve
          </p>
          <div className="flex items-center gap-3 text-[11.5px]">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: 'hsl(var(--primary))' }} />
              <span className="text-muted-foreground">Indoor (free-running)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-muted-foreground/50" />
              <span className="text-muted-foreground">Outdoor</span>
            </span>
          </div>
        </div>

        <div className="mt-2 h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 10, bottom: 2, left: -16 }}>
              <defs>
                <linearGradient id="outdoorFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(27 9% 62%)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="hsl(27 9% 62%)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(30 14% 88%)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10.5, fill: 'hsl(27 9% 43%)' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(30 14% 88%)' }}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 10.5, fill: 'hsl(27 9% 43%)' }}
                tickLine={false}
                axisLine={false}
                width={46}
                tickFormatter={(v: number) => `${v}°`}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(30 14% 88%)',
                  background: 'hsl(0 0% 100%)',
                }}
                formatter={(value: number, name) => [`${value} °C`, name === 'indoor' ? 'Indoor' : 'Outdoor']}
              />
              {/* The freezing line, because in the Ladakh case it is the number
                  that decides whether the shelter is usable at all. */}
              <ReferenceLine y={0} stroke="hsl(200 60% 60%)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Area
                type="monotone"
                dataKey="outdoor"
                stroke="hsl(27 9% 55%)"
                strokeWidth={1.5}
                fill="url(#outdoorFill)"
              />
              <Line
                type="monotone"
                dataKey="indoor"
                stroke="hsl(var(--primary))"
                strokeWidth={2.4}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground/70">
          The indoor curve is the model&apos;s free-running response — no heating or cooling running.
          Where it sits above the outdoor curve is the benefit the envelope and the sun are buying;
          where the two converge after sunset is the heat the shelter is losing, which is the
          mechanism the problem statement describes for Ladakh.
        </p>
      </div>

      {/* ================= Secondary readout + provenance ================= */}
      <div className="mt-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="rounded-lg border bg-card/30 p-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Heat balance, this day
          </p>
          <dl className="mt-2 space-y-1 text-[12.5px]">
            {[
              ['Solar gain', `+${num(profile.solarGainKwh, 2)} kWh`],
              ['Internal gain', `+${num(profile.internalGainKwh, 2)} kWh`],
              ['Total loss', `−${num(profile.heatLossKwh, 2)} kWh`],
              ['Total gain (non-solar)', `+${num(profile.heatGainKwh, 2)} kWh`],
              ['Peak flow', `${num(profile.peakFlowKw, 2)} kW at ${hourLabel(profile.peakFlowHour)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums text-foreground/90">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col justify-between rounded-lg border bg-card/30 p-3">
          <div className="flex items-start gap-2">
            <Info size={13} className="mt-0.5 shrink-0 text-muted-foreground/70" aria-hidden />
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              <b className="text-foreground/85">
                Model estimate — not a measured building result.
              </b>{' '}
              These figures come from a transparent hourly heat balance with periodic conduction
              response, not from a validated dynamic simulation and not from instrumentation. They
              are for comparing designs under the same assumptions, which is what the problem
              statement asks for. Site measurement is required before construction.
            </p>
          </div>

          <Link
            href="/dashboard/design"
            className="group mt-3 flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2 transition-colors hover:border-primary/40"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
              <Box size={13} className="text-primary" aria-hidden />
              View the 3D design this result describes
            </span>
            <ArrowRight
              size={14}
              className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden
            />
          </Link>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground/60">
            Form: {parameters.buildingType} · {parameters.width} × {parameters.length} m ·{' '}
            {parameters.floors} storey{parameters.floors === 1 ? '' : 's'} · WWR{' '}
            {Math.round(parameters.windowToWallRatio * 100)}% · orientation{' '}
            {Math.round(parameters.orientation)}°
          </p>
        </div>
      </div>
    </Panel>
  );
}

export default ShelterResultPanel;
