/**
 * Dynamic ventilation control.
 *
 * WHY A SINGLE ACH NUMBER IS NOT ENOUGH
 * The rest of the model takes `airChangesPerHour` as one design number: the
 * shelter exchanges this much air, always. A real shelter does not work that
 * way. What the occupants need changes hour by hour — the outdoor air required
 * for air quality is fixed by the headcount, the air required to keep the
 * interior dry depends on the moisture balance, and the air required for free
 * cooling only exists in the hours when it is cooler outside than in. A design
 * that meets the annual average can still be stuffy at 03:00 and wet at dawn.
 *
 * This module computes, for each hour of a representative day, the air-change
 * rate each of those three constraints *requires*, what the shelter's openings
 * can actually deliver by buoyancy and wind, and what a given control strategy
 * achieves. The gap between required and achieved is the honest output.
 *
 * THE THREE REQUIREMENTS
 *
 *  1. AIR QUALITY — ASHRAE 62.1 style, a per-person and a per-area outdoor-air
 *     rate. Independent of weather; it is the floor the shelter must hold.
 *
 *  2. MOISTURE — from the same steady-state balance `moisture.ts` uses,
 *     `W_in = W_out + G/ṁ`, inverted: to hold `W_in` below the ceiling the mass
 *     flow must satisfy `ṁ ≥ G / (W_max − W_out)`. When the outdoor air is
 *     already at or above the ceiling ratio no finite flow will do, and the
 *     hour is reported as moisture-limited rather than silently satisfied.
 *
 *  3. FREE COOLING — only available when the outdoor air is genuinely cooler
 *     than the interior, and only worth doing when the interior is above its
 *     comfort ceiling. The flow needed is `ṁ = Q_sensible / (cp · ΔT)`.
 *
 * WHAT THIS IS NOT
 * It is not a CFD or a network airflow model. The achievable rate is a
 * first-order buoyancy-plus-wind estimate through the total operable opening
 * area, with one discharge coefficient. It is accurate enough to tell a design
 * with enough openings from one without, and it is labelled an estimate
 * wherever it is shown. It does not model the HVAC system's energy — that stays
 * with the energy model, so the two cannot double-count.
 */

import type {
  BuildingParameters,
  ClimateData,
  ShelterGeometry,
} from '@/types';
import {
  AIR_DENSITY,
  DAYS_IN_MONTH,
  LATENT_HEAT_VAPORISATION,
  pressureAtElevation,
} from '@/utils/units';
import { humidityRatio } from '@/utils/psychrometrics';
import { infiltrationAchFor } from './ventilation';

/** The three control stances the brief asks to compare. */
export type VentilationStrategy = 'passive' | 'hybrid' | 'active';

export const VENTILATION_STRATEGY_LABEL: Record<VentilationStrategy, string> = {
  passive: 'Passive — openings only',
  hybrid: 'Hybrid — openings, fan as backstop',
  active: 'Active — mechanical ventilation',
};

export const VENTILATION_STRATEGY_OPTIONS = (
  ['passive', 'hybrid', 'active'] as VentilationStrategy[]
).map((value) => ({ value, label: VENTILATION_STRATEGY_LABEL[value] }));

/** What the control system actually did in an hour. */
export type VentilationAction =
  | 'closed'
  | 'openings'
  | 'openings-plus-fan'
  | 'mechanical'
  | 'shortfall';

export const VENTILATION_ACTION_LABEL: Record<VentilationAction, string> = {
  closed: 'Closed',
  openings: 'Openings',
  'openings-plus-fan': 'Openings + fan',
  mechanical: 'Mechanical',
  shortfall: 'Shortfall',
};

/** Which constraint set the rate for the hour. */
export type VentilationDriver = 'air-quality' | 'moisture' | 'cooling' | 'none';

export interface VentilationHour {
  hour: number;
  outdoorTemp: number;
  indoorTemp: number;
  /** Required for outdoor-air quality, ACH. */
  requiredForAirQuality: number;
  /** Required to hold the interior below the humidity ceiling, ACH. */
  requiredForMoisture: number;
  /** Required to free-cool the interior, ACH. 0 when free cooling is off. */
  requiredForCooling: number;
  /** The binding requirement, ACH. */
  required: number;
  /** Which constraint is binding. */
  driver: VentilationDriver;
  /** True when no finite flow can hold the moisture ceiling this hour. */
  moistureLimited: boolean;
  /** What the operable openings alone can deliver, ACH. */
  achievablePassive: number;
  /** What the openings plus the fan can deliver, ACH. */
  achievableHybrid: number;
  /** What the chosen strategy actually delivers, ACH. */
  achieved: number;
  satisfied: boolean;
  action: VentilationAction;
  /** Fan electrical energy this hour, Wh. Excludes any HVAC compressor. */
  fanEnergyWh: number;
  note: string;
}

export interface VentilationControl {
  month: number;
  strategy: VentilationStrategy;
  /** Total operable opening area the estimate was based on, m². */
  operableOpeningArea: number;
  /** Uncontrolled infiltration, ACH — the floor the shelter cannot go below. */
  infiltrationAch: number;
  hours: VentilationHour[];

  hoursSatisfied: number;
  shortfallHours: number;
  /** Worst hourly deficit, ACH. */
  peakShortfallAch: number;
  /** Hours where air quality, not weather, set the rate. */
  airQualityHours: number;
  moistureHours: number;
  coolingHours: number;
  /** Hours where free cooling was available and used. */
  freeCoolingHours: number;
  /**
   * Hours where the outdoor air was already at or above the humidity ceiling,
   * so no ventilation rate could dry the interior. These are never satisfied.
   */
  moistureLimitedHours: number;
  /**
   * True when ventilation cannot hold the humidity ceiling at any hour — the
   * shelter needs dehumidification, not more air. This is a real finding on a
   * hot-dry site: air at 35 °C and 38 % RH carries more absolute moisture than
   * a 26 °C room at a 60 % ceiling, so opening up makes the interior wetter.
   */
  requiresDehumidification: boolean;
  /** Mean required and achieved rates over the satisfiable hours, ACH. */
  meanRequired: number;
  meanAchieved: number;
  /** Fan energy for the day, Wh. */
  fanEnergyWhPerDay: number;
  /** Fan energy extrapolated over the month, kWh. */
  fanEnergyKwhPerMonth: number;

  label: string;
  summary: string;
}

export interface VentilationControlInputs {
  month: number;
  strategy: VentilationStrategy;
  /** Occupants present in the hour, people. */
  occupants: number;
  /** Outdoor-air rate per person, L/s. Defaults to the ASHRAE 62.1 residential figure. */
  outdoorAirPerPersonLps?: number;
  /** Outdoor-air rate per unit floor area, L/s·m². */
  outdoorAirPerAreaLps?: number;
  /** Total sensible internal gain, W — occupants plus equipment. */
  sensibleGainW: number;
  /** Total latent internal gain, W. */
  latentGainW: number;
  /** Indoor relative-humidity ceiling, %. */
  humidityCeilingPct: number;
  /** Cooling setpoint — the temperature free cooling is trying to hold, °C. */
  coolingSetpointC: number;
  /** Hourly indoor temperature, °C, index 0–23. Falls back to the month mean. */
  indoorTemps?: number[];
}

/* ------------------------------------------------------------------ */
/* Constants — all documented, none hidden                             */
/* ------------------------------------------------------------------ */

/** ASHRAE 62.1 residential outdoor-air rate, L/s per person. */
const DEFAULT_OA_PER_PERSON_LPS = 8;
/** ASHRAE 62.1 area component, L/s per m² of floor. */
const DEFAULT_OA_PER_AREA_LPS = 0.3;
/** Discharge coefficient for the openings. */
const OPENING_CD = 0.6;
/** Fraction of a window's area that actually opens. */
const WINDOW_OPERABLE_FRACTION = 0.5;
/** Vents are openings by construction. */
const VENT_OPERABLE_FRACTION = 1;
/** Effective pressure coefficient applied to the wind speed. */
const WIND_PRESSURE_COEFFICIENT = 0.4;
/** Fan capacity added on top of the openings in hybrid mode, ACH. */
const FAN_ACH = 6;
/** Specific fan power, W per (m³/s) of delivered flow. */
const SPECIFIC_FAN_POWER = 500;
/** Free cooling is only worthwhile once the outside is this much cooler, K. */
const FREE_COOL_DEADBAND_K = 1.5;
/** A ceiling on the estimate, so a pathological geometry cannot report 500 ACH. */
const MAX_ACH = 30;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export function computeVentilationControl(
  climate: ClimateData,
  geometry: ShelterGeometry,
  parameters: BuildingParameters,
  inputs: VentilationControlInputs,
): VentilationControl {
  const { month, strategy } = inputs;

  const monthly = climate.monthly[month];
  const tMean = monthly?.avgTemp ?? climate.summary.avgTemperature;
  const tMax = monthly?.maxTemp ?? climate.summary.maxTemperature;
  const tMin = monthly?.minTemp ?? climate.summary.minTemperature;
  const outdoorRh = monthly?.humidity ?? climate.summary.humidity;
  const windSpeed = monthly?.windSpeed ?? 2;

  const pressurePa = pressureAtElevation(climate.location.elevation);
  const volume = Math.max(1, geometry.volume);
  const floorArea = Math.max(1, geometry.floorArea);
  const height = Math.max(1, geometry.totalHeight);

  const designAch = parameters.airChangesPerHour ?? 1;
  const infiltrationAch = Math.max(
    0.05,
    infiltrationAchFor(parameters.infiltrationClass, parameters.infiltrationAch, designAch),
  );

  const operableArea = operableOpeningArea(geometry);

  /* The outdoor-air requirement is a constant over the day — it is set by the
     headcount and the floor area, not by the weather. */
  const perPerson = inputs.outdoorAirPerPersonLps ?? DEFAULT_OA_PER_PERSON_LPS;
  const perArea = inputs.outdoorAirPerAreaLps ?? DEFAULT_OA_PER_AREA_LPS;
  const outdoorAirM3PerS =
    (Math.max(0, inputs.occupants) * perPerson + floorArea * perArea) / 1000;
  const requiredForAirQuality = clampAch((outdoorAirM3PerS * 3600) / volume);

  const rhCeiling = Math.min(95, Math.max(30, inputs.humidityCeilingPct));
  const outdoorRatio = humidityRatio(tMean, outdoorRh, pressurePa);
  const massFlowForGeneration =
    Math.max(0, inputs.latentGainW) / LATENT_HEAT_VAPORISATION;

  const hours: VentilationHour[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const outdoorTemp = diurnalTemp(tMean, tMin, tMax, hour);
    /* Without a thermal result the interior is assumed to sit at the month's
       mean outdoor temperature. That is the free-running, unheated case: the
       moisture headroom then collapses toward zero in a cold climate and the
       hour is correctly reported as moisture-limited. Callers that have run the
       heat balance should always pass `indoorTemps`, as the brief page does. */
    const indoorTemp = inputs.indoorTemps?.[hour] ?? tMean;

    /* --- 1. Moisture ------------------------------------------------- */
    const maxRatio = humidityRatio(indoorTemp, rhCeiling, pressurePa);
    const headroom = maxRatio - outdoorRatio;
    /* A negative or vanishing headroom means the outdoor air is already at or
       above the ceiling: no ventilation rate fixes that, so the hour is flagged
       rather than given an invented number. */
    const moistureLimited = headroom <= 1e-5;
    const requiredForMoisture = moistureLimited
      ? MAX_ACH
      : clampAch(
          ((massFlowForGeneration / headroom) * 3600) / (AIR_DENSITY * volume),
        );

    /* --- 2. Free cooling --------------------------------------------- */
    const deltaT = indoorTemp - outdoorTemp;
    const coolingWanted = indoorTemp > inputs.coolingSetpointC;
    const coolingAvailable = deltaT > FREE_COOL_DEADBAND_K;
    const requiredForCooling =
      coolingWanted && coolingAvailable && deltaT > 0
        ? clampAch(
            (Math.max(0, inputs.sensibleGainW) /
              (1005 * AIR_DENSITY * deltaT) *
              3600) /
              volume,
          )
        : 0;

    /* --- 3. The binding requirement ---------------------------------- */
    const candidates: Array<[VentilationDriver, number]> = [
      ['air-quality', requiredForAirQuality],
      ['moisture', requiredForMoisture],
      ['cooling', requiredForCooling],
    ];
    const [driver, required] = candidates.reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
      candidates[0]!,
    );

    /* --- 4. What the openings can do --------------------------------- */
    const achievablePassive = clampAch(
      Math.max(infiltrationAch, openingAch(operableArea, volume, height, windSpeed, outdoorTemp, indoorTemp)),
    );
    const achievableHybrid = clampAch(achievablePassive + FAN_ACH);

    /* --- 5. What the strategy delivers ------------------------------- */
    const { achieved, action, fanFlowM3PerS } = resolveStrategy(
      strategy,
      required,
      achievablePassive,
      achievableHybrid,
      volume,
    );

    /* An hour whose outdoor air is already at or above the humidity ceiling
       cannot be fixed by any ventilation rate, so it is never reported as
       satisfied — otherwise the clamp above would manufacture a pass out of a
       requirement that has no finite solution. */
    const satisfied = !moistureLimited && achieved >= required - 1e-6;
    const finalAction: VentilationAction = moistureLimited ? 'shortfall' : action;
    const fanEnergyWh = fanFlowM3PerS * SPECIFIC_FAN_POWER;

    hours.push({
      hour,
      outdoorTemp: round1(outdoorTemp),
      indoorTemp: round1(indoorTemp),
      requiredForAirQuality: round2(requiredForAirQuality),
      requiredForMoisture: round2(requiredForMoisture),
      requiredForCooling: round2(requiredForCooling),
      required: round2(required),
      driver: required <= 0 ? 'none' : driver,
      moistureLimited,
      achievablePassive: round2(achievablePassive),
      achievableHybrid: round2(achievableHybrid),
      achieved: round2(achieved),
      satisfied,
      action: finalAction,
      fanEnergyWh: Math.round(fanEnergyWh * 10) / 10,
      note: hourNote(driver, required, achieved, moistureLimited, coolingWanted, coolingAvailable),
    });
  }

  /* ------------------------------ Summary ---------------------------- */
  const shortfalls = hours.filter((h) => !h.satisfied);
  const fanWhPerDay = hours.reduce((sum, h) => sum + h.fanEnergyWh, 0);
  const days = DAYS_IN_MONTH[month] ?? 30;

  /* A moisture-limited hour has no finite requirement, so folding its clamped
     placeholder into the mean would report "30 ACH required" — a number that
     does not exist. The means are taken over the hours that have a real
     requirement. */
  const measurable = hours.filter((h) => !h.moistureLimited);
  const meanRequired = mean(measurable.map((h) => h.required));
  const meanAchieved = mean(measurable.map((h) => h.achieved));

  const airQualityHours = hours.filter((h) => h.driver === 'air-quality').length;
  const moistureHours = hours.filter((h) => h.driver === 'moisture').length;
  const coolingHours = hours.filter((h) => h.driver === 'cooling').length;
  const freeCoolingHours = hours.filter(
    (h) => h.requiredForCooling > 0 && h.satisfied,
  ).length;
  const moistureLimitedHours = hours.filter((h) => h.moistureLimited).length;

  /* A moisture-limited hour has no finite solution and is reported separately
     as a dehumidification problem, so it does not contribute a fictitious
     "shortfall" figure here. */
  const measurableShortfalls = shortfalls.filter((h) => !h.moistureLimited);
  const peakShortfallAch = measurableShortfalls.reduce(
    (worst, h) => Math.max(worst, h.required - h.achieved),
    0,
  );

  const worstHour = measurableShortfalls.reduce<VentilationHour | null>(
    (worst, h) =>
      worst === null || h.required - h.achieved > worst.required - worst.achieved ? h : worst,
    null,
  );

  const requiresDehumidification = moistureLimitedHours > 0;

  const summary = requiresDehumidification
    ? `${VENTILATION_STRATEGY_LABEL[strategy]} over ${MONTH_NAMES[month]}: ventilation cannot ` +
      `hold the ${rhCeiling} % humidity ceiling. In ${moistureLimitedHours} of 24 hours the ` +
      `outdoor air already carries more moisture than the ceiling allows ` +
      `(${outdoorRatio.toFixed(4)} kg/kg outside against ${(humidityRatio(tMean, rhCeiling, pressurePa)).toFixed(4)} kg/kg at the ceiling), ` +
      `so opening up makes the interior wetter. This shelter needs dehumidification, not more air. ` +
      `The ${measurable.length} hour${measurable.length === 1 ? '' : 's'} with a finite requirement ` +
      `average ${meanRequired.toFixed(1)} ACH.`
    : `${VENTILATION_STRATEGY_LABEL[strategy]} over ${MONTH_NAMES[month]}: ` +
      `${hours.length - shortfalls.length} of 24 hours meet the required rate, ` +
      `mean ${meanAchieved.toFixed(1)} ACH against ${meanRequired.toFixed(1)} ACH required. ` +
      (shortfalls.length === 0
        ? 'No hour falls short. '
        : `${shortfalls.length} hour${shortfalls.length === 1 ? '' : 's'} fall short by up to ` +
          `${peakShortfallAch.toFixed(1)} ACH — worst at ${String(worstHour?.hour ?? 0).padStart(2, '0')}:00. `) +
      (moistureHours > 0
        ? `Moisture sets the rate in ${moistureHours} hour${moistureHours === 1 ? '' : 's'}. `
        : '') +
      (freeCoolingHours > 0
        ? `Free cooling is available and used in ${freeCoolingHours} hour${freeCoolingHours === 1 ? '' : 's'}.`
        : 'Free cooling is not available at this site in this month.');

  return {
    month,
    strategy,
    operableOpeningArea: round2(operableArea),
    infiltrationAch: round2(infiltrationAch),
    hours,
    hoursSatisfied: hours.length - shortfalls.length,
    shortfallHours: shortfalls.length,
    peakShortfallAch: round2(peakShortfallAch),
    airQualityHours,
    moistureHours,
    coolingHours,
    freeCoolingHours,
    moistureLimitedHours,
    requiresDehumidification,
    meanRequired: round2(meanRequired),
    meanAchieved: round2(meanAchieved),
    fanEnergyWhPerDay: Math.round(fanWhPerDay * 10) / 10,
    fanEnergyKwhPerMonth: Math.round(((fanWhPerDay * days) / 1000) * 100) / 100,
    label: `Ventilation control · ${MONTH_NAMES[month]}`,
    summary,
  };
}

/** The three strategies side by side, for the comparison card. */
export function compareVentilationStrategies(
  climate: ClimateData,
  geometry: ShelterGeometry,
  parameters: BuildingParameters,
  inputs: Omit<VentilationControlInputs, 'strategy'>,
): Record<VentilationStrategy, VentilationControl> {
  const build = (strategy: VentilationStrategy) =>
    computeVentilationControl(climate, geometry, parameters, { ...inputs, strategy });
  return {
    passive: build('passive'),
    hybrid: build('hybrid'),
    active: build('active'),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * What the strategy delivers, and how.
 *
 * Passive takes whatever the openings give and accepts the shortfall — that is
 * the point of it. Hybrid tops up with a fan but will not start the fan for
 * less than a fifth of an air change. Active meets the requirement whatever it
 * costs.
 */
function resolveStrategy(
  strategy: VentilationStrategy,
  required: number,
  achievablePassive: number,
  achievableHybrid: number,
  volume: number,
): { achieved: number; action: VentilationAction; fanFlowM3PerS: number } {
  if (required <= 0.05) {
    return { achieved: 0, action: 'closed', fanFlowM3PerS: 0 };
  }

  if (strategy === 'passive') {
    const achieved = Math.min(required, achievablePassive);
    return {
      achieved,
      action: achieved >= required - 1e-6 ? 'openings' : 'shortfall',
      fanFlowM3PerS: 0,
    };
  }

  if (strategy === 'hybrid') {
    if (required <= achievablePassive + 0.2) {
      return { achieved: Math.min(required, achievablePassive), action: 'openings', fanFlowM3PerS: 0 };
    }
    const achieved = Math.min(required, achievableHybrid);
    const fanAch = Math.max(0, achieved - achievablePassive);
    return {
      achieved,
      action: achieved >= required - 1e-6 ? 'openings-plus-fan' : 'shortfall',
      fanFlowM3PerS: (fanAch * volume) / 3600,
    };
  }

  /* Active: the mechanical system meets the requirement. */
  const fanAch = Math.max(0, required - achievablePassive);
  return {
    achieved: required,
    action: 'mechanical',
    fanFlowM3PerS: (fanAch * volume) / 3600,
  };
}

/** Total operable opening area across the envelope, m². */
function operableOpeningArea(geometry: ShelterGeometry): number {
  let area = 0;
  for (const wall of geometry.walls) {
    for (const opening of wall.openings) {
      const face = Math.max(0, opening.width * opening.height);
      if (opening.kind === 'vent') area += face * VENT_OPERABLE_FRACTION;
      else if (opening.kind === 'window') area += face * WINDOW_OPERABLE_FRACTION;
    }
  }
  return area;
}

/**
 * Air-change rate the openings can deliver, ACH.
 *
 * Buoyancy and wind act in quadrature — the two driving pressures add as
 * squares, which is why a still day with a large indoor-outdoor difference
 * still ventilates. The stack term uses the mean of the two absolute
 * temperatures, in kelvin, which is the standard form.
 */
function openingAch(
  area: number,
  volume: number,
  height: number,
  windSpeed: number,
  outdoorTemp: number,
  indoorTemp: number,
): number {
  if (area <= 0) return 0;
  const tOutK = Math.max(1, outdoorTemp + 273.15);
  const tInK = Math.max(1, indoorTemp + 273.15);
  const stack = Math.sqrt((2 * 9.81 * height * Math.abs(tInK - tOutK)) / tInK);
  const wind = Math.max(0, windSpeed) * WIND_PRESSURE_COEFFICIENT;
  const velocity = Math.sqrt(wind * wind + stack * stack);
  return (OPENING_CD * area * velocity * 3600) / volume;
}

/** The diurnal sinusoid the rest of the model uses, peaking at 15:00. */
function diurnalTemp(mean: number, min: number, max: number, hour: number): number {
  const amplitude = Math.max(0, (max - min) / 2);
  return mean + amplitude * Math.cos((2 * Math.PI * (hour - 15)) / 24);
}

function hourNote(
  driver: VentilationDriver,
  required: number,
  achieved: number,
  moistureLimited: boolean,
  coolingWanted: boolean,
  coolingAvailable: boolean,
): string {
  if (moistureLimited) return 'Outdoor air is at or above the humidity ceiling — ventilation cannot dry it.';
  if (required <= 0) return 'No requirement — the shelter may stay closed.';
  const short = achieved < required - 1e-6;
  const by =
    driver === 'air-quality'
      ? 'occupant outdoor-air requirement'
      : driver === 'moisture'
        ? 'moisture removal'
        : 'free cooling';
  if (short) return `Short by ${(required - achieved).toFixed(1)} ACH against the ${by}.`;
  if (driver === 'cooling') {
    return coolingAvailable
      ? 'Free cooling is available and covers the load.'
      : coolingWanted
        ? 'Interior is above the ceiling but the outdoor air is not cool enough to help.'
        : 'Free cooling not required at this hour.';
  }
  return `Meets the ${by}.`;
}

function clampAch(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_ACH, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
