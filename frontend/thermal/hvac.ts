/**
 * HVAC plant characteristics — what each system actually does to the energy.
 *
 * WHY THIS MODULE EXISTS
 * The heat balance has always divided the cooling and heating loads by
 * `parameters.coolingCop` and `parameters.heatingEfficiency`, so plant
 * efficiency was always in the physics. What was missing was the *link* between
 * the `hvacType` a user selects and those two numbers: choosing "diesel field
 * heater" rather than "heat pump" changed the label on the design but left the
 * energy identical. That is a modelling gap, not a display gap, and it makes
 * any passive-versus-active comparison meaningless until it is closed.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 * It does three things and nothing else:
 *
 *  1. Maps each of the nine plant types onto a seasonal efficiency pair, so the
 *     existing heat balance sees the plant the user actually chose.
 *  2. Records whether each type can cool, heat, or both. A diesel field heater
 *     cannot cool a Jodhpur afternoon, and reporting delivered cooling energy
 *     for it would be a fabricated result — so its cooling load is reported as
 *     **unmet** instead.
 *  3. Converts delivered thermal energy into source energy, fuel and CO₂ using
 *     documented intensities.
 *
 * It does not re-run the heat balance, does not model part-load curves, cycling
 * losses, defrost, duct losses or start-up transients, and does not size the
 * plant. Those are stated as limitations wherever the figures are shown.
 */

import type { BuildingParameters, HvacType, PowerSource } from '@/types';
import type { ThermalComfort } from '@/types';
import { GRID_CO2_INTENSITY } from '@/utils/units';

export interface HvacSpec {
  /** Seasonal cooling efficiency (EER) at full load. The heat balance divides by this. */
  coolingCop: number;
  /**
   * Seasonal heating efficiency at full load. Used as a COP — a heat pump's is
   * above 1, a combustion heater's is below it.
   */
  heatingEfficiency: number;
  /**
   * Part-load degradation coefficient, `C_D` in the standard DOE-2 / EnergyPlus
   * form. A machine that cycles on and off at part load spends part of every
   * cycle not at its rated efficiency, so the seasonal figure is below the
   * nameplate one.
   *
   * The degradation factor is `PLF = 1 − C_D·(1 − PLR)`, and the effective
   * efficiency is `rated × PLF`. At full load `PLF = 1` and nothing is lost; at
   * half load with `C_D = 0.25` the plant delivers 87.5 % of its rated
   * efficiency.
   *
   * A resistive element is 0 — it has no cycle losses worth modelling. A
   * combustion heater is small. A DX machine is the standard 0.25.
   */
  partLoadCd: number;
  /** Whether this plant can remove heat at all. */
  canCool: boolean;
  /** Whether this plant can add heat at all. */
  canHeat: boolean;
  /** One line on what the plant is and where it is used. */
  note: string;
}

/**
 * The nine plant types the platform offers.
 *
 * The efficiency figures are representative seasonal values for field
 * equipment, not manufacturer data for a specific unit: an air conditioner's
 * EER falls sharply at a 45 °C outdoor temperature, and a heat pump loses
 * capacity below about −15 °C. Neither effect is modelled here, and both are
 * named in the limitation text.
 */
export const HVAC_SPECS: Record<HvacType, HvacSpec> = {
  none: {
    coolingCop: 1,
    partLoadCd: 0,
    heatingEfficiency: 1,
    canCool: false,
    canHeat: false,
    note: 'No plant. The interior is free-running and the loads are simply unmet.',
  },
  'electric-heater': {
    coolingCop: 1,
    partLoadCd: 0,
    heatingEfficiency: 0.99,
    canCool: false,
    canHeat: true,
    note: 'Resistive heating at essentially 1 kW of heat per kW of electricity. Simple and reliable, and the most expensive way to heat.',
  },
  'diesel-heater': {
    coolingCop: 1,
    partLoadCd: 0.08,
    heatingEfficiency: 0.85,
    canCool: false,
    canHeat: true,
    note: 'Field combustion heater. Delivers about 0.85 kW of heat per kW of fuel energy, and needs a fuel chain.',
  },
  'heat-pump': {
    coolingCop: 3.2,
    partLoadCd: 0.25,
    heatingEfficiency: 3.4,
    canCool: true,
    canHeat: true,
    note: 'Reversible, and the most efficient option for both directions. Loses capacity in extreme cold, which is not modelled here.',
  },
  'air-conditioner': {
    coolingCop: 2.8,
    partLoadCd: 0.25,
    heatingEfficiency: 1,
    canCool: true,
    canHeat: true,
    note: 'Cooling-led split unit. Heating, where fitted, is resistive.',
  },
  fan: {
    coolingCop: 1,
    partLoadCd: 0,
    heatingEfficiency: 1,
    canCool: false,
    canHeat: false,
    note: 'Air movement only. It raises the tolerable temperature but removes no heat, so it cannot meet a cooling load.',
  },
  'evaporative-cooler': {
    coolingCop: 12,
    partLoadCd: 0.15,
    heatingEfficiency: 1,
    canCool: true,
    canHeat: false,
    note: 'Very effective in dry air and almost useless in humid air — the figure assumes it is being used in a climate that suits it.',
  },
  'radiant-heater': {
    coolingCop: 1,
    partLoadCd: 0.05,
    heatingEfficiency: 0.95,
    canCool: false,
    canHeat: true,
    note: 'Radiant local heating. Heats people and surfaces rather than air, which this single-zone model cannot represent directly.',
  },
  'solar-thermal': {
    coolingCop: 1,
    partLoadCd: 0.2,
    heatingEfficiency: 2.2,
    canCool: false,
    canHeat: true,
    note: 'Solar collector with a store and a backup. The figure is a seasonal average including the backup, not a clear-sky peak.',
  },
};

/** Delivered-energy CO₂ intensity, kgCO₂e per kWh. */
const SOURCE_CO2_INTENSITY: Record<PowerSource, number> = {
  grid: GRID_CO2_INTENSITY,
  'diesel-generator': 0.9,
  battery: GRID_CO2_INTENSITY,
  'solar-pv': 0.05,
  'solar-thermal': 0.05,
  hybrid: 0.5,
};

/** Energy per litre of the fuel a field generator burns, kWh. Matches `lib/deployment.ts`. */
export const KWH_PER_LITRE_FUEL = 10;

export interface HvacPerformance {
  type: HvacType;
  spec: HvacSpec;
  /** Thermal load that must be removed, kWh/yr — before any plant efficiency. */
  coolingLoadKwh: number;
  heatingLoadKwh: number;
  /** Delivered energy actually consumed by the plant, kWh/yr. */
  deliveredCoolingKwh: number;
  deliveredHeatingKwh: number;
  deliveredTotalKwh: number;
  /** Load the plant cannot serve at all, kWh/yr. */
  unmetCoolingKwh: number;
  unmetHeatingKwh: number;
  /** Energy intensity per m², kWh/m²·yr, from the delivered total. */
  eui: number;
  /** Installed capacity against the peak load. */
  installedCapacityKw: number;
  peakLoadKw: number;
  /** Fraction of the peak load the plant can hold, 0–1. */
  capacityCoverage: number;
  undersized: boolean;

  /* ---- Part load ---------------------------------------------------- */
  /** Hours the plant would be called on, from the free-running discomfort hours. */
  coolingRunHours: number;
  heatingRunHours: number;
  /**
   * Average part-load ratio, 0–1, estimated as equivalent full-load hours over
   * the hours the plant runs. This is a proxy, not a load-duration curve.
   */
  coolingLoadFactor: number;
  heatingLoadFactor: number;
  /** Part-load factor applied, `1 − C_D·(1 − PLR)`. 1 means no degradation. */
  coolingPlf: number;
  heatingPlf: number;
  /** Efficiency after part-load degradation, W/W. */
  effectiveCoolingCop: number;
  effectiveHeatingEfficiency: number;

  fuelLitresPerDay: number;
  co2TonnesPerYear: number;
  /** Plain-language read of what the plant does at this site. */
  summary: string;
}

/**
 * Apply a plant type's efficiencies to a design.
 *
 * Returns a new parameter set; the caller decides whether to adopt it. Kept
 * separate from the type definition so a design can still be evaluated with
 * hand-set efficiencies, which is what the optimiser and the dataset export do.
 */
export function applyHvacToParameters(
  parameters: BuildingParameters,
  type?: HvacType,
): BuildingParameters {
  const resolved = type ?? parameters.hvacType;
  if (!resolved) return parameters;
  const spec = HVAC_SPECS[resolved];
  return {
    ...parameters,
    hvacType: resolved,
    coolingCop: spec.coolingCop,
    heatingEfficiency: spec.heatingEfficiency,
  };
}

/**
 * Break the annual energy down by what the chosen plant can actually do.
 *
 * @param thermal a result evaluated with the **same** parameters passed here —
 *        the loads are recovered by multiplying the delivered figures back up
 *        by the efficiency the heat balance divided by.
 */
export function computeHvacPerformance(
  thermal: ThermalComfort,
  parameters: BuildingParameters,
  floorArea: number,
): HvacPerformance {
  const type: HvacType = parameters.hvacType ?? 'none';
  const spec = HVAC_SPECS[type];

  /* Recover the thermal loads from the delivered figures. */
  const coolingLoadKwh = thermal.annualCoolingEnergy * Math.max(1, parameters.coolingCop);
  const heatingLoadKwh = thermal.annualHeatingEnergy * Math.max(0.5, parameters.heatingEfficiency);

  /* --- Part load -------------------------------------------------------
   * A machine credited with its full-load efficiency while running at a
   * quarter load is overstated, and for a shelter — small, intermittent,
   * oversized against a mild mean — that is the normal condition rather than
   * the exception. The standard correction is the DOE-2 / EnergyPlus
   * degradation factor `PLF = 1 − C_D·(1 − PLR)` applied to the rated figure.
   *
   * `PLR` is estimated from equivalent full-load hours: the annual load
   * divided by what the plant would deliver running flat out for exactly the
   * hours the free-running interior is outside its comfort band. That is the
   * hours the plant is actually called on. It is a proxy for a load-duration
   * curve, not a substitute for one. */
  const coolingRunHours = Math.max(0, thermal.overheatingHours);
  const heatingRunHours = Math.max(0, thermal.underheatingHours);
  const coolingLoadFactor = partLoadRatio(coolingLoadKwh, thermal.peakCoolingLoad, coolingRunHours);
  const heatingLoadFactor = partLoadRatio(heatingLoadKwh, thermal.peakHeatingLoad, heatingRunHours);
  const coolingPlf = partLoadFactor(coolingLoadFactor, spec.partLoadCd);
  const heatingPlf = partLoadFactor(heatingLoadFactor, spec.partLoadCd);

  const effectiveCoolingCop = Math.max(1, spec.coolingCop * coolingPlf);
  const effectiveHeatingEfficiency = Math.max(0.5, spec.heatingEfficiency * heatingPlf);

  /* A plant that cannot cool delivers no cooling, whatever the load is — the
     honest answer is that the load goes unmet, not that a heater removed it. */
  const deliveredCoolingKwh = spec.canCool ? coolingLoadKwh / effectiveCoolingCop : 0;
  const deliveredHeatingKwh = spec.canHeat ? heatingLoadKwh / effectiveHeatingEfficiency : 0;
  const deliveredTotalKwh = deliveredCoolingKwh + deliveredHeatingKwh;

  const unmetCoolingKwh = spec.canCool ? 0 : coolingLoadKwh;
  const unmetHeatingKwh = spec.canHeat ? 0 : heatingLoadKwh;

  const installedCapacityKw = parameters.hvacCapacityKw ?? 0;
  const peakLoadKw = Math.max(thermal.peakCoolingLoad, thermal.peakHeatingLoad);
  const capacityCoverage =
    peakLoadKw > 0 ? Math.min(1, installedCapacityKw / peakLoadKw) : installedCapacityKw > 0 ? 1 : 0;
  const undersized = peakLoadKw > 0 && installedCapacityKw < peakLoadKw;

  const powerSource: PowerSource = parameters.powerSource ?? 'grid';
  const fuelLitresPerDay =
    powerSource === 'diesel-generator' || powerSource === 'hybrid'
      ? thermal.energyConsumption / KWH_PER_LITRE_FUEL
      : 0;

  const co2TonnesPerYear =
    (deliveredTotalKwh * SOURCE_CO2_INTENSITY[powerSource]) / 1000;

  const parts: string[] = [];
  if (!spec.canCool && coolingLoadKwh > 0) {
    parts.push(
      `${type === 'none' ? 'No plant' : 'This plant'} cannot cool, so ${Math.round(coolingLoadKwh)} kWh/yr of cooling load is unmet`,
    );
  }
  if (!spec.canHeat && heatingLoadKwh > 0) {
    parts.push(`${Math.round(heatingLoadKwh)} kWh/yr of heating load is unmet`);
  }
  if (undersized) {
    parts.push(
      `the ${installedCapacityKw.toFixed(1)} kW installed covers ${(capacityCoverage * 100).toFixed(0)} % of the ${peakLoadKw.toFixed(1)} kW peak`,
    );
  }

  const summary =
    `${spec.note} ` +
    (deliveredTotalKwh > 0
      ? `It delivers ${Math.round(deliveredTotalKwh)} kWh/yr` +
        (fuelLitresPerDay > 0 ? `, about ${fuelLitresPerDay.toFixed(1)} litres of fuel on the peak day.` : '.')
      : 'It consumes no delivered energy.') +
    (coolingPlf < 1 || heatingPlf < 1
      ? ` Part-load degradation brings its effective efficiency to ${effectiveCoolingCop.toFixed(1)} ` +
        `cooling and ${effectiveHeatingEfficiency.toFixed(2)} heating against a rated ` +
        `${spec.coolingCop.toFixed(1)} and ${spec.heatingEfficiency.toFixed(2)}.`
      : '') +
    (parts.length > 0 ? ` ${parts.join('; ')}.` : '');

  return {
    type,
    spec,
    coolingLoadKwh: round0(coolingLoadKwh),
    heatingLoadKwh: round0(heatingLoadKwh),
    deliveredCoolingKwh: round0(deliveredCoolingKwh),
    deliveredHeatingKwh: round0(deliveredHeatingKwh),
    deliveredTotalKwh: round0(deliveredTotalKwh),
    unmetCoolingKwh: round0(unmetCoolingKwh),
    unmetHeatingKwh: round0(unmetHeatingKwh),
    eui: floorArea > 0 ? round1(deliveredTotalKwh / floorArea) : 0,
    installedCapacityKw: round2(installedCapacityKw),
    peakLoadKw: round2(peakLoadKw),
    capacityCoverage: round2(capacityCoverage),
    undersized,
    coolingRunHours: round0(coolingRunHours),
    heatingRunHours: round0(heatingRunHours),
    coolingLoadFactor: round2(coolingLoadFactor),
    heatingLoadFactor: round2(heatingLoadFactor),
    coolingPlf: round2(coolingPlf),
    heatingPlf: round2(heatingPlf),
    effectiveCoolingCop: round2(effectiveCoolingCop),
    effectiveHeatingEfficiency: round2(effectiveHeatingEfficiency),
    fuelLitresPerDay: round2(fuelLitresPerDay),
    co2TonnesPerYear: round2(co2TonnesPerYear),
    summary,
  };
}

function round0(value: number): number {
  return Math.round(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Average part-load ratio from equivalent full-load hours.
 *
 * `load / (peak × hours)` — the fraction of the plant's capacity it actually
 * used, averaged over the hours it ran. Clamped to (0, 1] because a ratio above
 * one would mean the plant delivered more than its peak, which is an
 * inconsistency in the inputs rather than a physical result.
 */
function partLoadRatio(loadKwh: number, peakKw: number, runHours: number): number {
  if (peakKw <= 1e-9 || runHours <= 0 || loadKwh <= 0) return 0;
  const ratio = loadKwh / (peakKw * runHours);
  return Math.max(0, Math.min(1, ratio));
}

/**
 * The DOE-2 / EnergyPlus part-load degradation factor.
 *
 * `PLF = 1 − C_D·(1 − PLR)`. One at full load, falling as the load falls, with
 * the coefficient describing how much of each cycle is spent not at rated
 * efficiency. Bounded below so a pathological load factor cannot produce a
 * zero or negative efficiency.
 */
function partLoadFactor(loadFactor: number, cd: number): number {
  if (cd <= 0) return 1;
  return Math.max(0.5, 1 - cd * (1 - Math.max(0, Math.min(1, loadFactor))));
}
