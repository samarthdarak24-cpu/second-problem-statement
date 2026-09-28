/**
 * Ventilation vs infiltration — two physically different streams.
 *
 * WHY THEY MUST NOT BE ONE NUMBER
 * A shelter exchanges air for two unrelated reasons:
 *
 *   INFILTRATION — uncontrolled leakage through seams, the door and the fabric.
 *                  It is present every hour of the year, it cannot be turned
 *                  off, and it is a *defect*.
 *
 *   VENTILATION  — the openings and fans the design provides. It is a
 *                  *control decision*, and it only helps when the outside air
 *                  is actually better than the inside air.
 *
 * Adding them into one air-change figure makes the two indistinguishable in the
 * result, which hides the single most improvable number on a tent: a shelter
 * leaking 1.2 ACH through its seams reports exactly the same "ventilation" as a
 * tight one deliberately purging at 1.2 ACH, and only the second is a design
 * choice. Keeping them apart is what lets the heat-loss breakdown say "12 % of
 * your loss is leakage" and mean it.
 *
 * The infiltration figures are ACH at the design condition, chosen against
 * measured leakage classes: a sealed panel cabin sits near 0.3, a well-made
 * tent near 0.6, and an old or poorly fitted tent fabric near 1.2.
 */

import type { DeploymentState, HvacType, InfiltrationClass, PowerSource } from '@/types';

export const INFILTRATION_ACH_BY_CLASS: Record<InfiltrationClass, number> = {
  low: 0.3,
  medium: 0.6,
  high: 1.2,
  /** Placeholder until a measured figure is supplied. */
  measured: 0.5,
};

export const INFILTRATION_LABEL: Record<InfiltrationClass, string> = {
  low: 'Low — sealed panel construction',
  medium: 'Medium — well-made fabric envelope',
  high: 'High — seams, door and fabric leakage',
  measured: 'Measured — use the figure below',
};

export const INFILTRATION_CLASSES: InfiltrationClass[] = ['low', 'medium', 'high', 'measured'];

export const INFILTRATION_CLASS_OPTIONS = INFILTRATION_CLASSES.map((value) => ({
  value,
  label: INFILTRATION_LABEL[value],
}));

export const HVAC_LABEL: Record<HvacType, string> = {
  none: 'None — free-running',
  'electric-heater': 'Electric heater',
  'diesel-heater': 'Diesel / field heater',
  'heat-pump': 'Heat pump',
  'air-conditioner': 'Air conditioner',
  fan: 'Fan only',
  'evaporative-cooler': 'Evaporative cooler',
  'radiant-heater': 'Radiant heater',
  'solar-thermal': 'Solar thermal',
};

export const HVAC_TYPES: HvacType[] = [
  'none',
  'electric-heater',
  'diesel-heater',
  'heat-pump',
  'air-conditioner',
  'fan',
  'evaporative-cooler',
  'radiant-heater',
  'solar-thermal',
];

export const HVAC_OPTIONS = HVAC_TYPES.map((value) => ({ value, label: HVAC_LABEL[value] }));

export const POWER_SOURCE_LABEL: Record<PowerSource, string> = {
  grid: 'Grid supply',
  'diesel-generator': 'Diesel generator',
  battery: 'Battery bank',
  'solar-pv': 'Solar PV',
  'solar-thermal': 'Solar thermal',
  hybrid: 'Hybrid',
};

export const POWER_SOURCES: PowerSource[] = [
  'grid',
  'diesel-generator',
  'battery',
  'solar-pv',
  'solar-thermal',
  'hybrid',
];

export const POWER_SOURCE_OPTIONS = POWER_SOURCES.map((value) => ({
  value,
  label: POWER_SOURCE_LABEL[value],
}));

export const DEPLOYMENT_STATE_LABEL: Record<DeploymentState, string> = {
  packed: 'Packed for transport',
  deployed: 'Deployed',
};

export const DEPLOYMENT_STATE_OPTIONS = (['packed', 'deployed'] as DeploymentState[]).map(
  (value) => ({ value, label: DEPLOYMENT_STATE_LABEL[value] }),
);

/**
 * The uncontrolled air-change rate, ACH.
 *
 * @param cls the leakage class
 * @param measuredAch the measured figure, used when `cls` is `measured`
 * @param designAch the design air-change rate, used as a ceiling: a shelter
 *        cannot leak more than it exchanges in total
 */
export function infiltrationAchFor(
  cls: InfiltrationClass | undefined,
  measuredAch: number | undefined,
  designAch: number,
): number {
  const base =
    cls === 'measured' && measuredAch !== undefined && measuredAch >= 0
      ? measuredAch
      : INFILTRATION_ACH_BY_CLASS[cls ?? 'medium'];
  /* The thermal model already floors infiltration at its own constant; this
     ceiling keeps the split consistent with the total the heat balance used. */
  return Math.min(base, Math.max(0, designAch));
}

export interface AirChangeSplit {
  /** Uncontrolled leakage, ACH. */
  infiltration: number;
  /** Intentional ventilation, ACH. */
  intentional: number;
  /** The total, ACH. */
  total: number;
}

/** Split a design air-change rate into its two physical streams. */
export function splitAirChanges(
  designAch: number,
  cls: InfiltrationClass | undefined,
  measuredAch?: number,
): AirChangeSplit {
  const total = Math.max(0, designAch);
  const infiltration = infiltrationAchFor(cls, measuredAch, total);
  return {
    infiltration: round2(infiltration),
    intentional: round2(Math.max(0, total - infiltration)),
    total: round2(total),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
