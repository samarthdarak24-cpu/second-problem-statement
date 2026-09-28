'use client';

/**
 * `useThermalReading` — the page's conclusion, derived once.
 *
 * This is presentation logic, not engineering logic. It reads the values
 * the thermal model already produced (`currentThermal.dailyProfile` and
 * `metrics`) and turns them into the two things a page needs to *say*
 * rather than merely display:
 *
 *   1. a verdict — which side of the adaptive comfort band the design
 *      falls on, in one sentence;
 *   2. the dominant heat path — which part of the envelope is doing the
 *      most work, named, with its share.
 *
 * It computes nothing the engines do not already compute. No
 * multiplication of loads, no re-derivation of a temperature: every
 * number here is read straight off the store and divided by another
 * number from the same store, purely to express a proportion.
 *
 * It lives in one place because two pages now lead with this reading
 * (Dashboard and Thermal Analysis) and a second copy would drift — the
 * two pages would eventually disagree about which path was dominant.
 *
 * ── On the physics ──────────────────────────────────────────────────
 * The six paths are deliberately split into two classes:
 *
 *   • the five FABRIC paths (roof, wall, floor, window, door) are all
 *     conduction through the envelope, so they are commensurable with
 *     each other and can be ranked and expressed as a share of the
 *     fabric total;
 *
 *   • VENTILATION is air exchange, a different transfer mechanism, and
 *     it changes sign across the year (a gain in summer, a loss in
 *     winter). Ranking it alongside conduction produced a share like
 *     "7.9 kWh/day — 1% of the 5.6 kWh/day", i.e. a path larger than the
 *     total it was measured against. It is therefore reported separately
 *     and never folded into the fabric share.
 */

import { useMemo } from 'react';
import { useDesignStore } from '@/store/designStore';

export type ReadingTone = 'good' | 'warn' | 'bad';

export interface FabricPath {
  key: 'roof' | 'wall' | 'floor' | 'window' | 'door';
  label: string;
  /** kWh/day, absolute — the direction is stated separately. */
  value: number;
}

export interface ThermalReading {
  verdict: string;
  verdictTone: ReadingTone;
  /** Adaptive comfort hours, 0–100. */
  comfort: number;
  /** The largest fabric path, or the first path when all are zero. */
  top: FabricPath;
  /** The second largest fabric path, when there is one. */
  next: FabricPath | null;
  /** Share of the fabric total taken by `top`, 0–1. */
  topShare: number;
  /** Sum of the five fabric paths, kWh/day. */
  envelopeTotal: number;
  /** Fabric paths with a non-zero value, largest first. */
  ranked: FabricPath[];
  /** Signed — negative means the air is a net loss on the representative day. */
  ventilationKwh: number;
  solarGainKwh: number;
  solarPerSqm: number;
  lossKwh: number;
  totalGainKwh: number;
}

export function useThermalReading(): ThermalReading | null {
  const thermal = useDesignStore((state) => state.currentThermal);
  const metrics = useDesignStore((state) => state.metrics);

  return useMemo(() => {
    if (!thermal || !metrics) return null;

    const daily = thermal.dailyProfile;

    /* Declared as a tuple first so `key` keeps the literal union type —
       building the array inline widens `key` to `string` and drops the
       FabricPath guarantee. */
    const fabric: FabricPath[] = [
      { key: 'roof', label: 'roof', value: Math.abs(daily.roofKwh ?? 0) },
      { key: 'wall', label: 'wall', value: Math.abs(daily.wallKwh ?? 0) },
      { key: 'floor', label: 'floor', value: Math.abs(daily.floorKwh ?? 0) },
      { key: 'window', label: 'window', value: Math.abs(daily.windowKwh ?? 0) },
      { key: 'door', label: 'door', value: Math.abs(daily.doorKwh ?? 0) },
    ];

    const envelopePaths = [...fabric].sort((a, b) => b.value - a.value);

    const envelopeTotal = envelopePaths.reduce((sum, p) => sum + p.value, 0);
    const ranked = envelopePaths.filter((p) => p.value > 0);

    const top = ranked[0] ?? envelopePaths[0];
    const next = ranked[1] ?? null;
    const topShare = envelopeTotal > 0 ? top.value / envelopeTotal : 0;

    const ventilationKwh = daily.ventilationKwh ?? 0;

    const comfort = metrics.adaptiveComfortHoursPct;
    const overheats = metrics.summerOvertemperature > 0;
    const underheats = metrics.winterUndertemperature > 0;

    let verdict: string;
    let verdictTone: ReadingTone;

    if (comfort >= 75) {
      verdict = 'Comfortable for most of the year without plant.';
      verdictTone = 'good';
    } else if (overheats && underheats) {
      verdict = 'Both seasons fall outside the adaptive band — this needs two solutions, not one.';
      verdictTone = 'bad';
    } else if (overheats) {
      verdict = 'Too warm in summer despite the envelope working alone.';
      verdictTone = 'warn';
    } else if (underheats) {
      verdict = 'Too cold in winter despite the envelope working alone.';
      verdictTone = 'warn';
    } else {
      verdict = 'Partially within band — the envelope is doing some of the work.';
      verdictTone = 'warn';
    }

    return {
      verdict,
      verdictTone,
      comfort,
      top,
      next,
      topShare,
      envelopeTotal,
      ranked,
      ventilationKwh,
      solarGainKwh: daily.solarGainKwh,
      solarPerSqm: daily.solarGainPerSqm,
      lossKwh: daily.heatLossKwh,
      totalGainKwh: daily.heatGainKwh,
    };
  }, [thermal, metrics]);
}

/**
 * How the verdict is presented. Encoded three ways at once — a word, an
 * icon and a hue — so it survives greyscale printing and colour-blind
 * viewing. Colour is never the only signal.
 *
 * The icon is returned as a name rather than a component so this module
 * stays free of JSX and can be imported by anything.
 */
export const VERDICT_WORD: Record<ReadingTone, string> = {
  good: 'Within band',
  warn: 'Attention',
  bad: 'Critical',
};
