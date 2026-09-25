'use client';

/**
 * Monthly charts.
 *
 * Three views onto the same twelve months:
 *
 *   TEMPERATURE — outdoor mean against free-running indoor. The gap between the
 *   two lines *is* the envelope's performance; a design that tracks the outdoor
 *   line has no envelope worth the name.
 *
 *   ENERGY — delivered cooling and heating, stacked. This is what the occupant
 *   pays for.
 *
 *   BALANCE — the monthly heat-balance terms. Positive means heat entering the
 *   zone. This is the model's own working, exposed so the numbers above can be
 *   interrogated rather than trusted.
 *
 * All values are model estimates from the simplified monthly heat balance.
 */

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDesignStore } from '@/store/designStore';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { adaptiveComfortBand } from '@/thermal/pmv';
import { MONTH_LABELS } from '@/utils/units';
import { num } from '@/utils/format';

type Tab = 'temperature' | 'energy' | 'balance';

const AXIS = {
  stroke: 'hsl(27 9% 45%)',
  fontSize: 10,
  tickLine: false,
} as const;

const GRID_STROKE = 'hsl(30 14% 88%)';

const TOOLTIP_STYLE = {
  background: 'hsl(0 0% 100%)',
  border: '1px solid hsl(30 14% 88%)',
  borderRadius: 8,
  fontSize: 11,
  padding: '6px 9px',
  color: 'hsl(24 10% 10%)',
} as const;

const LEGEND_STYLE = {
  fontSize: 10,
  paddingTop: 4,
} as const;

export function ChartsPanel() {
  const [tab, setTab] = useState<Tab>('temperature');

  const thermal = useDesignStore((state) => state.currentThermal);
  const baselineThermal = useDesignStore((state) => state.baselineThermal);
  const metrics = useDesignStore((state) => state.metrics);
  const setPanel = useDesignStore((state) => state.setPanel);

  const temperatureData = useMemo(() => {
    if (!thermal) return [];
    return thermal.monthly.map((month, index) => {
      const band = adaptiveComfortBand(month.outdoorTemp, 0.9);
      return {
        month: MONTH_LABELS[index],
        outdoor: Number(month.outdoorTemp.toFixed(1)),
        indoor: Number(month.freeFloatTemp.toFixed(1)),
        conditioned: Number(month.indoorTemp.toFixed(1)),
        baseline: baselineThermal
          ? Number(baselineThermal.monthly[index]?.freeFloatTemp.toFixed(1) ?? 0)
          : undefined,
        bandUpper: Number(band.upper.toFixed(1)),
        bandLower: Number(band.lower.toFixed(1)),
        peak: Number(month.peakIndoorTemp.toFixed(1)),
      };
    });
  }, [thermal, baselineThermal]);

  const energyData = useMemo(() => {
    if (!thermal) return [];
    return thermal.monthly.map((month, index) => ({
      month: MONTH_LABELS[index],
      cooling: Number(month.coolingEnergy.toFixed(1)),
      heating: Number(month.heatingEnergy.toFixed(1)),
      comfort: Number(month.comfortHoursPct.toFixed(1)),
    }));
  }, [thermal]);

  const balanceData = useMemo(() => {
    if (!thermal) return [];
    return thermal.heatBalance.map((row, index) => ({
      month: MONTH_LABELS[index],
      solar: Number(row.solarGain.toFixed(1)),
      internal: Number(row.internalGain.toFixed(1)),
      conduction: Number(row.conduction.toFixed(1)),
      ventilation: Number(row.ventilation.toFixed(1)),
      net: Number(row.balance.toFixed(1)),
    }));
  }, [thermal]);

  if (!thermal) {
    return (
      <Panel title="Monthly analysis" accent="analysis" scroll>
        <EmptyState message="No thermal results yet" hint="Generate a design to populate the charts." />
      </Panel>
    );
  }

  const hasEnergy = metrics !== null && metrics.annualEnergy > 0;

  return (
    <Panel
      title="Monthly analysis"
      subtitle="Simplified monthly heat balance · model estimates"
      accent="analysis"
      scroll
      right={
        <>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'temperature'}
            className={`tab ${tab === 'temperature' ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab('temperature')}
          >
            Temperature
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'energy'}
            className={`tab ${tab === 'energy' ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab('energy')}
          >
            Energy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'balance'}
            className={`tab ${tab === 'balance' ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab('balance')}
          >
            Heat balance
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPanel('charts', false)}>
            Hide
          </button>
        </>
      }
    >
      {tab === 'temperature' ? (
        <>
          <div className="h-[232px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={temperatureData} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" {...AXIS} />
                <YAxis {...AXIS} unit="°" width={44} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'hsl(24 10% 10%)', fontWeight: 600 }}
                  formatter={(value: number, name: string) => [`${value} °C`, name]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} iconSize={8} />
                <Line
                  type="monotone"
                  dataKey="outdoor"
                  name="Outdoor mean"
                  stroke="hsl(27 9% 45%)"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 3"
                />
                <Line
                  type="monotone"
                  dataKey="bandUpper"
                  name="Adaptive band"
                  stroke="hsl(158 46% 30%)"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="2 3"
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="bandLower"
                  name="Adaptive lower"
                  stroke="hsl(158 46% 30%)"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="2 3"
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="baseline"
                  name="Conventional indoor"
                  stroke="hsl(0 62% 44%)"
                  strokeWidth={1.2}
                  dot={false}
                  strokeDasharray="3 3"
                />
                <Line
                  type="monotone"
                  dataKey="indoor"
                  name="This design · free-running"
                  stroke="hsl(18 68% 44%)"
                  strokeWidth={2.2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="conditioned"
                  name="This design · conditioned"
                  stroke="hsl(28 12% 45%)"
                  strokeWidth={1.6}
                  dot={false}
                />
                <ReferenceLine y={0} stroke={GRID_STROKE} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">
            The gap between the dashed outdoor line and the solid free-running line is the
            envelope&rsquo;s whole contribution. The green dashed pair is the ASHRAE 55 adaptive
            band at 90 % acceptability — it moves with the running mean outdoor temperature, which
            is why it is not a flat corridor.
          </p>
        </>
      ) : null}

      {tab === 'energy' ? (
        <>
          <div className="h-[232px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyData} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'hsl(24 10% 10%)', fontWeight: 600 }}
                  formatter={(value: number, name: string) => [`${num(value, 1)} kWh`, name]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} iconSize={8} />
                <Bar dataKey="cooling" name="Cooling" stackId="energy" fill="hsl(18 68% 44%)" />
                <Bar
                  dataKey="heating"
                  name="Heating"
                  stackId="energy"
                  fill="hsl(32 80% 36%)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span>
              Annual total{' '}
              <b className="tabular-nums text-foreground">{num(metrics?.annualEnergy ?? 0, 0)} kWh</b>
            </span>
            <span>
              Cooling{' '}
              <b className="tabular-nums text-foreground">
                {num(metrics?.annualCoolingEnergy ?? 0, 0)} kWh
              </b>
            </span>
            <span>
              Heating{' '}
              <b className="tabular-nums text-foreground">
                {num(metrics?.annualHeatingEnergy ?? 0, 0)} kWh
              </b>
            </span>
            <span>
              Intensity{' '}
              <b className="tabular-nums text-foreground">
                {num(metrics?.energyUseIntensity ?? 0, 1)} kWh/m²·yr
              </b>
            </span>
          </div>

          {!hasEnergy ? (
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">
              This design needs no delivered energy at all in the modelled months — the envelope
              holds the adaptive band on its own. That is a model result, not a guarantee.
            </p>
          ) : null}

          <div className="mt-2.5 h-[110px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyData} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" {...AXIS} />
                <YAxis {...AXIS} unit="%" width={44} domain={[0, 100]} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number) => [`${value} %`, 'Hours in band']}
                />
                <Bar dataKey="comfort" name="Comfort hours" radius={[3, 3, 0, 0]}>
                  {energyData.map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={
                        entry.comfort >= 75
                          ? 'hsl(158 46% 30%)'
                          : entry.comfort >= 45
                            ? 'hsl(45 88% 52%)'
                            : 'hsl(0 62% 44%)'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
            Share of each month&rsquo;s hours inside the adaptive comfort band with no HVAC running.
          </p>
        </>
      ) : null}

      {tab === 'balance' ? (
        <>
          <div className="h-[232px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={balanceData} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" {...AXIS} />
                <YAxis {...AXIS} width={48} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'hsl(24 10% 10%)', fontWeight: 600 }}
                  formatter={(value: number, name: string) => [`${num(value, 1)} kWh`, name]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} iconSize={8} />
                <ReferenceLine y={0} stroke="hsl(27 9% 58%)" />
                <Bar dataKey="solar" name="Solar" stackId="gain" fill="hsl(45 88% 52%)" />
                <Bar dataKey="internal" name="Internal" stackId="gain" fill="hsl(28 12% 52%)" />
                <Bar
                  dataKey="conduction"
                  name="Conduction"
                  stackId="gain"
                  fill="hsl(18 68% 44%)"
                />
                <Bar
                  dataKey="ventilation"
                  name="Ventilation"
                  stackId="gain"
                  fill="hsl(158 46% 30%)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">
            Positive means heat entering the zone. Ventilation appears as a large positive term in
            summer and a large negative one in winter — which is exactly why the model treats the
            design air-change rate as a <span className="text-foreground">capacity</span> it only
            uses when the outside air actually helps.
          </p>

          <div className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            {[
              { key: 'solar', label: 'Solar', colour: 'hsl(45 88% 52%)' },
              { key: 'internal', label: 'Internal', colour: 'hsl(28 12% 52%)' },
              { key: 'conduction', label: 'Conduction', colour: 'hsl(18 68% 44%)' },
              { key: 'ventilation', label: 'Ventilation', colour: 'hsl(158 46% 30%)' },
            ].map((term) => {
              const total = balanceData.reduce(
                (sum, row) => sum + (row[term.key as keyof typeof row] as number),
                0,
              );
              return (
                <div key={term.key} className="flex items-baseline gap-1.5 py-0.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: term.colour }}
                  />
                  <span className="text-[12px] text-muted-foreground">{term.label}</span>
                  <span className="ml-auto text-[12px] font-semibold tabular-nums text-foreground">
                    {num(total, 0)}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">kWh/yr</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
