/**
 * Heat-loss breakdown — where the shelter's thermal performance is actually
 * being lost, as a share of the total.
 *
 * WHY THIS IS ITS OWN READ-OUT
 * The heat balance already reports each term in kWh/day. What a designer needs
 * on top of that is the *share*: "17 % of my loss is leakage" is a decision,
 * "4.6 kWh/day" is not. The breakdown also separates the two ventilation
 * streams — uncontrolled infiltration and intentional ventilation — because
 * they are fixed by completely different actions (seal the seams, or change the
 * control) and lumping them together hides which one to spend on.
 *
 * The figures are the *same* numbers the heat balance produced, re-expressed as
 * percentages. Nothing is recomputed, so the panel cannot disagree with the
 * charts.
 */

import type { BuildingParameters, DailyThermalProfile, ShelterGeometry } from '@/types';
import { splitAirChanges } from './ventilation';

export interface HeatLossComponent {
  key: string;
  label: string;
  /** Signed heat flow over the day, kWh/day, positive into the zone. */
  kwh: number;
  /** Magnitude of the loss, kWh/day. Zero when the component is net-gaining. */
  lossKwh: number;
  /** Share of the total loss, %. */
  sharePct: number;
  /** Area the figure is spread over, m², where meaningful. */
  area?: number;
  /** True for the two air-exchange streams, which have no surface area. */
  isAir?: boolean;
}

export interface HeatLossBreakdown {
  month: number;
  components: HeatLossComponent[];
  /** Total heat leaving the shelter, kWh/day. */
  totalLossKwh: number;
  /** Total heat entering from outside (solar excluded), kWh/day. */
  totalGainKwh: number;
  infiltration: { kwh: number; ach: number; sharePct: number };
  intentionalVentilation: { kwh: number; ach: number; sharePct: number };
  /** The component losing the most — where the next rupee should go. */
  worst: HeatLossComponent | null;
  summary: string;
}

export function computeHeatLossBreakdown(
  profile: DailyThermalProfile,
  parameters: BuildingParameters,
  geometry: ShelterGeometry,
): HeatLossBreakdown {
  const split = splitAirChanges(
    parameters.airChangesPerHour,
    parameters.infiltrationClass,
    parameters.infiltrationAch,
  );

  /* The profile reports one combined ventilation term. It is split here in
     proportion to the two air-change streams, which is the physically right
     thing to do: the same air, the same driving ΔT, so the energy follows the
     flow. */
  const infiltrationFraction = split.total > 0 ? split.infiltration / split.total : 0;
  const infiltrationKwh = profile.ventilationKwh * infiltrationFraction;
  const intentionalKwh = profile.ventilationKwh - infiltrationKwh;

  const raw: Array<Omit<HeatLossComponent, 'lossKwh' | 'sharePct'>> = [
    { key: 'walls', label: 'Walls', kwh: profile.wallKwh, area: geometry.exposedWallArea },
    { key: 'roof', label: 'Roof', kwh: profile.roofKwh, area: geometry.roofArea },
    { key: 'floor', label: 'Floor', kwh: profile.floorKwh, area: geometry.groundFloorArea },
    { key: 'windows', label: 'Windows', kwh: profile.windowKwh, area: geometry.glazingArea },
    { key: 'doors', label: 'Doors', kwh: profile.doorKwh, area: geometry.doorArea },
    {
      key: 'ventilation',
      label: 'Ventilation (intentional)',
      kwh: intentionalKwh,
      isAir: true,
    },
    {
      key: 'infiltration',
      label: 'Infiltration (leakage)',
      kwh: infiltrationKwh,
      isAir: true,
    },
  ];

  const totalLossKwh = raw.reduce((sum, entry) => sum + Math.max(0, -entry.kwh), 0);
  const totalGainKwh = raw.reduce((sum, entry) => sum + Math.max(0, entry.kwh), 0);

  const components: HeatLossComponent[] = raw.map((entry) => {
    const lossKwh = Math.max(0, -entry.kwh);
    return {
      ...entry,
      kwh: round2(entry.kwh),
      lossKwh: round2(lossKwh),
      sharePct: totalLossKwh > 0 ? round1((lossKwh / totalLossKwh) * 100) : 0,
    };
  });

  const ranked = [...components].sort((a, b) => b.lossKwh - a.lossKwh);
  const worst = ranked[0] && ranked[0].lossKwh > 0 ? ranked[0] : null;

  const infiltrationShare =
    totalLossKwh > 0 ? round1((Math.max(0, -infiltrationKwh) / totalLossKwh) * 100) : 0;
  const ventilationShare =
    totalLossKwh > 0 ? round1((Math.max(0, -intentionalKwh) / totalLossKwh) * 100) : 0;

  const summary = worst
    ? `${worst.label} is the largest loss path at ${worst.sharePct.toFixed(0)} % of ${totalLossKwh.toFixed(1)} kWh/day` +
      (infiltrationShare > 0
        ? `, with ${infiltrationShare.toFixed(0)} % going out through uncontrolled leakage at ${split.infiltration.toFixed(1)} ACH.`
        : '.')
    : 'The envelope is net-gaining heat at this hour — nothing dominates the loss.';

  return {
    month: profile.month,
    components,
    totalLossKwh: round2(totalLossKwh),
    totalGainKwh: round2(totalGainKwh),
    infiltration: { kwh: round2(infiltrationKwh), ach: split.infiltration, sharePct: infiltrationShare },
    intentionalVentilation: {
      kwh: round2(intentionalKwh),
      ach: split.intentional,
      sharePct: ventilationShare,
    },
    worst,
    summary,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
