'use client';

/**
 * The demo site explorer.
 *
 * Five stations from the real database, chosen to span the climate zones the
 * tool has to cope with: composite, cold desert, hot desert, hot-humid and
 * subtropical highland. Selecting one plots its actual monthly normals — the
 * same numbers the engine will run on — rather than a decorative curve.
 *
 * That distinction is the point. A landing page that shows invented charts is
 * making a claim it cannot support; this one is showing its working.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, Droplets, Mountain, Sun, Thermometer } from 'lucide-react';
import { STATION_BY_ID } from '@/climate/stations';
import { ClimateChart, MonthAxis } from './visuals';
import { cn } from '@/lib/utils';

/** The scenario the SIH demo walks through, warm-dry through to warm-humid. */
const SITES = ['in-pune', 'in-leh', 'in-jodhpur', 'in-chennai', 'in-shillong'] as const;

/** The design challenge each climate poses, in one line. */
const CHALLENGE: Record<string, string> = {
  'in-pune':
    'Mild and forgiving, but the monsoon swing means a design that works in May can be cold and damp in December. Envelope mass has to do both jobs.',
  'in-leh':
    'Underheating dominates almost every month, and the air is thin enough that solar gain is worth far more than insulation thickness. The problem is keeping heat in, not out.',
  'in-jodhpur':
    'The hardest case in the set: extreme summer overheating against genuinely cold winter nights. Shading and mass matter more than added insulation.',
  'in-chennai':
    'Hot and humid year-round. Comfort depends on air movement and dehumidification, not on resisting a temperature difference — so ventilation strategy leads.',
  'in-shillong':
    'Mild, cloudy and wet. Little solar resource and little need for cooling, so the design leans on insulation and moisture control instead.',
};

function annualMean(monthly: { avgTemp: number }[]): number {
  return monthly.reduce((sum, m) => sum + m.avgTemp, 0) / (monthly.length || 1);
}

function annualRain(monthly: { rainfall: number }[]): number {
  return monthly.reduce((sum, m) => sum + m.rainfall, 0);
}

function annualSolar(monthly: { solarRadiation: number }[]): number {
  return monthly.reduce((sum, m) => sum + m.solarRadiation, 0) / (monthly.length || 1);
}

export function SiteExplorer() {
  const [activeId, setActiveId] = useState<string>(SITES[0]);
  const station = STATION_BY_ID.get(activeId) ?? STATION_BY_ID.get(SITES[0])!;

  const facts = useMemo(() => {
    const { monthly, location } = station;
    return [
      {
        icon: Thermometer,
        label: 'Annual mean',
        value: `${annualMean(monthly).toFixed(1)} °C`,
        note: `swings ${Math.min(...monthly.map((m) => m.minTemp)).toFixed(0)} to ${Math.max(
          ...monthly.map((m) => m.maxTemp),
        ).toFixed(0)} °C`,
      },
      {
        icon: Droplets,
        label: 'Annual rainfall',
        value: `${annualRain(monthly).toFixed(0)} mm`,
        note: `${monthly.filter((m) => m.rainfall > 40).length} wet months`,
      },
      {
        icon: Sun,
        label: 'Daily irradiation',
        value: `${annualSolar(monthly).toFixed(1)} kWh/m²`,
        note: 'global horizontal',
      },
      {
        icon: Mountain,
        label: 'Elevation',
        value: `${location.elevation} m`,
        note: `${location.latitude.toFixed(1)}° N, ${location.longitude.toFixed(1)}° E`,
      },
    ];
  }, [station]);

  return (
    <div className="surface overflow-hidden">
      {/* ---- Site tabs ---- */}
      <div className="scroll-area flex gap-1 overflow-x-auto border-b bg-card p-2">
        {SITES.map((id) => {
          const site = STATION_BY_ID.get(id);
          if (!site) return null;
          const selected = id === activeId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveId(id)}
              aria-pressed={selected}
              className={cn(
                'relative shrink-0 rounded-lg px-3.5 py-2 text-left transition-colors',
                selected ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="site-tab"
                  aria-hidden
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/25"
                />
              ) : null}
              <span className="relative block text-[13.5px] font-semibold">
                {site.location.city}
              </span>
              <span className="relative block text-[11.5px] opacity-80">
                {site.climateZone.replace('-', ' ')}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* ---- Chart ---- */}
          <div className="px-6 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h3 className="font-display text-[19px] font-bold tracking-[-0.02em]">
                  {station.location.city}
                  <span className="ml-2 text-[13px] font-medium text-muted-foreground">
                    {station.location.state}
                  </span>
                </h3>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {station.climateType}
                </p>
              </div>
              <span className="chip border-primary/30 bg-primary/[0.08] text-primary">
                <Compass size={11} aria-hidden />
                {station.climateZone.replace('-', ' ')}
              </span>
            </div>

            <div className="mt-5">
              <ClimateChart
                monthly={station.monthly}
                label={station.location.city}
                className="h-[116px] w-full"
              />
              <MonthAxis className="mt-1.5 grid grid-cols-12 text-center text-[10px] text-muted-foreground" />
              <p className="mt-2 text-[11.5px] text-muted-foreground/80">
                Shaded band is the mean daily minimum to maximum; the line is the monthly mean.
              </p>
            </div>
          </div>

          {/* ---- Facts ---- */}
          <div className="mt-6 grid gap-px border-t bg-border sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-panel px-5 py-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <fact.icon size={13} aria-hidden />
                  <span className="kicker">{fact.label}</span>
                </div>
                <p className="mt-2 font-display text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
                  {fact.value}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{fact.note}</p>
              </div>
            ))}
          </div>

          {/* ---- The design challenge ---- */}
          <div className="border-t bg-card px-6 py-5">
            <p className="kicker">What this climate demands</p>
            <p className="mt-2 max-w-[760px] text-[13.5px] leading-relaxed text-muted-foreground">
              {CHALLENGE[activeId]}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
