'use client';

/**
 * Climate summary.
 *
 * Everything the design was derived from, shown next to the design itself. The
 * provenance line matters: the numbers here come from a climatology database,
 * a live archive API, or an interpolation between stations, and the panel says
 * which — a design tool that hides where its weather came from is not one you
 * can defend.
 */

import { useState } from 'react';
import { CloudRain, Droplets, Mountain, Sun, Wind } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { Chip, EmptyState, MetricRow, Panel } from '@/components/ui/primitives';
import { CHALLENGE_LABEL, PROVIDER_LABEL, ZONE_LABEL, ZONE_NOTE } from '@/lib/labels';
import {
  compass,
  humidityLabel,
  latLon,
  num,
  pct,
  temp,
  windLabel,
} from '@/utils/format';
import { MONTH_LABELS } from '@/utils/units';

type Tab = 'summary' | 'extremes' | 'analysis';

export function ClimateSummaryPanel() {
  const [tab, setTab] = useState<Tab>('summary');

  const climateData = useDesignStore((state) => state.climateData);
  const analysis = useDesignStore((state) => state.climateAnalysis);
  const provider = useDesignStore((state) => state.climateProvider);
  const note = useDesignStore((state) => state.climateNote);
  const attribution = useDesignStore((state) => state.climateAttribution);
  const fallbacks = useDesignStore((state) => state.climateFallbacks);

  if (!climateData) {
    return (
      <Panel title="Climate summary" accent="input" scroll>
        <EmptyState message="No climate loaded" hint="Generate a design for the selected site." />
      </Panel>
    );
  }

  const { summary, designConditions, location } = climateData;

  return (
    <Panel
      title="Climate summary"
      subtitle={`${climateData.climateType} · ${ZONE_LABEL[climateData.climateZone]}`}
      accent="input"
      scroll
      right={
        <>
          <Chip
            tone={
              provider === 'database' || provider === 'backend'
                ? 'good'
                : provider === 'open-meteo'
                  ? 'accent'
                  : 'warn'
            }
            title={note}
          >
            {PROVIDER_LABEL[provider ?? ''] ?? provider ?? 'unknown'}
          </Chip>
          {fallbacks.length > 0 ? (
            <Chip tone="warn" title={fallbacks.join(' → ')}>
              {fallbacks.length} fallback{fallbacks.length > 1 ? 's' : ''}
            </Chip>
          ) : null}
        </>
      }
    >
      <div className="mb-2 flex gap-1">
        {(
          [
            ['summary', 'Summary'],
            ['extremes', 'Design conditions'],
            ['analysis', 'Analysis'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab ${tab === value ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <MetricRow
                label="Annual mean"
                value={temp(summary.avgTemperature)}
                hint="Mean dry-bulb over the year"
              />
              <MetricRow label="Warmest month" value={temp(summary.maxTemperature)} />
              <MetricRow label="Coldest month" value={temp(summary.minTemperature)} />
              <MetricRow
                label="Diurnal swing"
                value={`${num(summary.diurnalSwing, 1)} K`}
                hint="Typical day–night range — drives the case for thermal mass"
              />
              <MetricRow
                label="Seasonal variation"
                value={`${num(summary.seasonalVariation, 1)} K`}
                hint="Spread of monthly means"
              />
            </div>
            <div>
              <MetricRow
                label="Humidity"
                value={`${pct(summary.humidity)} · ${humidityLabel(summary.humidity)}`}
              />
              <MetricRow
                label="Wind"
                value={`${num(summary.windSpeed, 1)} m/s ${compass(summary.windDirection)}`}
                hint={windLabel(summary.windSpeed)}
              />
              <MetricRow
                label="Solar"
                value={`${num(summary.solarRadiation, 2)} kWh/m²·day`}
              />
              <MetricRow label="Rainfall" value={`${num(summary.rainfall, 0)} mm/yr`} />
              <MetricRow
                label="Site"
                value={latLon(location.latitude, location.longitude)}
                hint={`${Math.round(location.elevation)} m above sea level`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {[
              {
                icon: <Sun size={12} aria-hidden />,
                label: 'Solar',
                value: `${num(summary.solarRadiation, 1)}`,
                unit: 'kWh/m²·d',
              },
              {
                icon: <Droplets size={12} aria-hidden />,
                label: 'Humidity',
                value: pct(summary.humidity),
                unit: humidityLabel(summary.humidity),
              },
              {
                icon: <Wind size={12} aria-hidden />,
                label: 'Wind',
                value: `${num(summary.windSpeed, 1)}`,
                unit: 'm/s',
              },
              {
                icon: <CloudRain size={12} aria-hidden />,
                label: 'Rain',
                value: `${num(summary.rainfall, 0)}`,
                unit: 'mm/yr',
              },
              {
                icon: <Mountain size={12} aria-hidden />,
                label: 'Elevation',
                value: `${Math.round(location.elevation)}`,
                unit: 'm',
              },
              {
                icon: <Sun size={12} aria-hidden />,
                label: 'Peak month',
                value: MONTH_LABELS[summary.peakCoolingMonth],
                unit: 'hottest',
              },
            ].map((item) => (
              <div key={item.label} className="rounded-md border bg-card/40 px-2 py-1.5">
                <div className="flex items-center gap-1 text-muted-foreground">
                  {item.icon}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">
                    {item.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-foreground">
                  {item.value}
                </p>
                <p className="text-[11px] text-muted-foreground/70">{item.unit}</p>
              </div>
            ))}
          </div>

          {note ? (
            <p className="text-[12px] leading-snug text-muted-foreground/70">
              <span className="font-semibold text-muted-foreground">Source.</span> {note}
              {attribution ? (
                <>
                  {' '}
                  <span className="text-muted-foreground/60">{attribution}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'extremes' ? (
        <div className="space-y-2.5">
          <div className="rounded-md border bg-card/40 px-2.5 py-2">
            <h3 className="stat-label mb-1">What the envelope must survive</h3>
            <MetricRow
              label="Summer design dry-bulb"
              value={temp(designConditions.summerDesignTemp)}
              hint="0.4 % exceedance — roughly the hottest 35 hours of the year"
            />
            <MetricRow
              label="Coincident wet-bulb"
              value={temp(designConditions.summerDesignWetBulb)}
              hint="Sets the latent load the cooling system must remove"
            />
            <MetricRow
              label="Winter design dry-bulb"
              value={temp(designConditions.winterDesignTemp)}
              hint="99.6 % exceedance"
            />
            <MetricRow
              label="Design daily range"
              value={`${num(designConditions.dailyRange, 1)} K`}
            />
            <MetricRow
              label="Cooling degree days"
              value={`${num(designConditions.coolingDegreeDays, 0)} K·d`}
              hint="Base 24 °C"
            />
            <MetricRow
              label="Heating degree days"
              value={`${num(designConditions.heatingDegreeDays, 0)} K·d`}
              hint="Base 18 °C"
            />
          </div>

          <div className="scroll-area max-h-[240px] overflow-y-auto rounded-md border bg-card/30">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card/95 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide">Mon</th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">Mean</th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">Max</th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">Min</th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">RH</th>
                  <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">Sun</th>
                </tr>
              </thead>
              <tbody>
                {climateData.monthly.map((month) => (
                  <tr key={month.month} className="border-t border-border/50 tabular-nums">
                    <td className="px-2 py-1 font-medium text-foreground/85">
                      {MONTH_LABELS[month.month]}
                    </td>
                    <td className="px-2 py-1 text-right">{num(month.avgTemp, 1)}</td>
                    <td className="px-2 py-1 text-right text-thermal-hot">{num(month.maxTemp, 1)}</td>
                    <td className="px-2 py-1 text-right text-thermal-cold">{num(month.minTemp, 1)}</td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      {num(month.humidity, 0)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      {num(month.solarRadiation, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'analysis' ? (
        analysis ? (
          <div className="space-y-2.5">
            <div className="rounded-md border bg-card/40 px-2.5 py-2">
              <h3 className="stat-label mb-1">Dominant thermal problem</h3>
              <p className="text-[12px] font-semibold text-foreground">
                {CHALLENGE_LABEL[analysis.mainChallenge]}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {analysis.challengeDetail}
              </p>
              <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground/70">
                {ZONE_NOTE[analysis.zone]}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <MetricRow
                  label="Ventilation"
                  value={`${analysis.ventilationStrategy} · ${num(analysis.ventilationAch, 1)} ACH`}
                />
                <MetricRow
                  label="Insulation"
                  value={`${analysis.insulationLevel} · ${num(analysis.insulationThickness * 1000, 0)} mm`}
                />
                <MetricRow label="Shading" value={analysis.shadingStrategy} />
              </div>
              <div>
                <MetricRow
                  label="Window ratio"
                  value={pct(analysis.windowRatioRecommendation * 100)}
                />
                <MetricRow
                  label="Orientation"
                  value={`${Math.round(analysis.orientationRecommendation)}° ${compass(analysis.orientationRecommendation)}`}
                />
                <MetricRow label="Glazing" value={analysis.glazingStrategy} />
              </div>
            </div>

            <p className="text-[12px] leading-snug text-muted-foreground/70">
              Ventilation is expressed as a <span className="text-foreground">capacity</span>, not a
              constant rate. The thermal model only applies the part above infiltration when the
              outside air is genuinely cooler than the space, so a high figure in a cold climate is
              not a winter heat loss.
            </p>
          </div>
        ) : (
          <EmptyState message="No analysis yet" />
        )
      ) : null}
    </Panel>
  );
}
