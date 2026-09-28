/**
 * Passive / hybrid / active — the three ways to deliver comfort, compared.
 *
 * THE QUESTION THIS ANSWERS
 * A shelter can be made comfortable by the envelope, by plant, or by some of
 * each. Those are not three points on a slider, they are three different
 * engineering strategies with different logistics, different fuel demand and
 * different failure modes — and the honest way to choose between them is to
 * price all three on the same site, in the same month, with the same envelope.
 *
 * WHAT IS HELD CONSTANT, AND WHY
 * Every strategy is evaluated on the **same envelope**, derived once by the
 * requirement engine for the climate, the mission and the shelter type. That is
 * deliberate: it isolates the one variable the user is actually choosing — how
 * comfort is delivered — instead of confounding it with envelope changes. The
 * envelope's own contribution is reported separately as the free-running
 * comfort, so a reader can see how much of the job the envelope does on its own
 * before any plant is switched on.
 *
 * WHAT THIS IS NOT
 * It is not a costed procurement comparison. The energy figures come from the
 * same monthly heat balance as everywhere else in the application, the fuel
 * conversion is the same single figure the deployability model uses, and the
 * ventilation figures come from the ventilation controller. Nothing here
 * invents a number, and nothing here replaces a proper life-cycle costing.
 */

import type {
  BuildingParameters,
  ClimateData,
  HvacType,
  PowerSource,
  ShelterGeometry,
} from '@/types';
import type { ThermalComfort } from '@/types';
import type { DesignRequirements } from '@/climate/requirementEngine';
import { applyRequirements } from '@/climate/requirementEngine';
import {
  applyHvacToParameters,
  computeHvacPerformance,
  type HvacPerformance,
} from '@/thermal/hvac';
import {
  computeVentilationControl,
  type VentilationControl,
  type VentilationStrategy,
} from '@/thermal/ventilationControl';

export type StrategyId = 'passive' | 'hybrid' | 'active';

export interface StrategyDefinition {
  id: StrategyId;
  label: string;
  glyph: string;
  /** One line on what the strategy is. */
  summary: string;
  /** The plant the strategy installs. */
  hvacType: HvacType;
  /** Where the energy comes from. */
  powerSource: PowerSource;
  /** How ventilation is controlled under this strategy. */
  ventilation: VentilationStrategy;
  /**
   * Installed capacity as a fraction of the requirement engine's figure.
   * Zero for a passive shelter — there is no plant to size.
   */
  capacityFactor: number;
  /** What the strategy is good at, and what it costs. */
  tradeoff: string;
}

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  passive: {
    id: 'passive',
    label: 'Passive',
    glyph: '◍',
    summary: 'The envelope does the work; no mechanical heating or cooling.',
    hvacType: 'none',
    powerSource: 'solar-pv',
    ventilation: 'passive',
    capacityFactor: 0,
    tradeoff:
      'No fuel, no plant to fail, nothing to supply. Comfort is whatever the envelope can hold, so it is only viable where the climate is forgiving or the envelope is excellent.',
  },
  hybrid: {
    id: 'hybrid',
    label: 'Hybrid',
    glyph: '◐',
    summary: 'A good envelope plus a small, intermittently used system.',
    hvacType: 'heat-pump',
    powerSource: 'hybrid',
    ventilation: 'hybrid',
    capacityFactor: 0.6,
    tradeoff:
      'Most of the comfort comes from the envelope and the plant only trims the peaks, so the plant is small, the fuel demand is low and the shelter still works — degraded — if the plant stops.',
  },
  active: {
    id: 'active',
    label: 'Active',
    glyph: '●',
    summary: 'A full-capacity system holding the setpoint year round.',
    hvacType: 'air-conditioner',
    powerSource: 'diesel-generator',
    ventilation: 'active',
    capacityFactor: 1,
    tradeoff:
      'Holds the setpoint regardless of the envelope, which is what an equipment or medical shelter may need. In exchange it carries the largest plant, the largest fuel demand and a single point of failure.',
  },
};

export const STRATEGY_ORDER: StrategyId[] = ['passive', 'hybrid', 'active'];

/**
 * Evaluates one design. Supplied by the caller so this module does not depend
 * on the optimisation layer, and so a test can pass a stub.
 */
export type StrategyEvaluator = (parameters: BuildingParameters) => {
  thermal: ThermalComfort;
  geometry: ShelterGeometry;
};

/**
 * Sizing margin applied to the peak load when the strategy installs plant.
 *
 * A plant is sized on the peak with a margin rather than on the mean, so a
 * "full capacity" strategy covers the peak and a 0.6-factor hybrid deliberately
 * does not — leaning on the envelope instead. That shortfall is reported, not
 * hidden.
 */
const SIZING_MARGIN = 1.15;

/**
 * Comfort a strategy actually delivers.
 *
 * The heat balance reports a conditioned score on the assumption that the
 * setpoint is held. A passive shelter holds nothing, and a deliberately
 * undersized hybrid holds the setpoint only part of the time, so the two
 * figures are blended by the fraction of the peak load the plant can carry.
 * This is an interpolation between two computed endpoints, not a new comfort
 * model, and it is labelled an estimate wherever it is shown.
 */
function deliveredComfort(
  freeRunning: number,
  conditioned: number,
  coverage: number,
): number {
  if (coverage >= 1) return conditioned;
  return freeRunning + (conditioned - freeRunning) * Math.max(0, coverage);
}

export interface StrategyOutcome {
  id: StrategyId;
  definition: StrategyDefinition;
  /** The design this strategy was evaluated on. */
  parameters: BuildingParameters;
  thermal: ThermalComfort;
  hvac: HvacPerformance;

  /** Free-running comfort score, 0–100 — what the envelope alone achieves. */
  freeRunningComfort: number;
  /** Comfort score the heat balance reports with the setpoint held, 0–100. */
  conditionedComfort: number;
  /**
   * Comfort the strategy actually delivers, blending the two by how much of
   * the peak load its plant can carry.
   */
  deliveredComfort: number;
  /** Annual hours inside the adaptive band with no plant, %. */
  passiveCoveragePct: number;

  annualEnergyKwh: number;
  eui: number;
  peakCoolingKw: number;
  peakHeatingKw: number;
  /** Load the installed plant cannot serve at all, kWh/yr. */
  unmetKwh: number;
  /** Fraction of the peak load the plant can hold, 0–1. */
  capacityCoverage: number;
  /**
   * Plain-language note when the plant is deliberately smaller than the peak,
   * or empty when it covers it. Never silently omitted: an undersized plant is
   * a design decision that has to be visible.
   */
  undersizedNote: string;
  /** Fuel the generator would burn on the peak day, litres/day. */
  fuelLitresPerDay: number;
  /** Installed plant capacity this strategy would carry, kW. */
  installedCapacityKw: number;
  co2TonnesPerYear: number;

  ventilation: VentilationControl;
  /** One-line read of this strategy's result. */
  summary: string;
}

export interface StrategyComparison {
  /** The envelope every strategy was evaluated on. */
  envelope: BuildingParameters;
  /** True when the requirement engine supplied the envelope. */
  envelopeFromRequirements: boolean;
  outcomes: StrategyOutcome[];
  /** The strategy that best balances comfort against energy at this site. */
  recommended: StrategyId;
  /** Why that one, in plain language. */
  recommendation: string;
}

export interface StrategyComparisonInputs {
  base: BuildingParameters;
  climate: ClimateData;
  /** The envelope the requirement engine proposes. Applied to every strategy. */
  requirements?: DesignRequirements;
  month: number;
  occupants: number;
  sensibleGainW: number;
  latentGainW: number;
  humidityCeilingPct: number;
  coolingSetpointC: number;
  indoorTemps?: number[];
  evaluate: StrategyEvaluator;
}

/**
 * Evaluate all three strategies on one envelope and rank them.
 *
 * The ranking is deliberately conservative: a strategy is only preferred if it
 * reaches a usable comfort level, and among those the lowest energy wins. That
 * ordering means a passive shelter that cannot hold comfort is never
 * "recommended" just because it burns nothing.
 */
export function compareStrategies(inputs: StrategyComparisonInputs): StrategyComparison {
  const envelope = inputs.requirements
    ? applyRequirements(inputs.base, inputs.requirements)
    : inputs.base;

  const outcomes = STRATEGY_ORDER.map((id): StrategyOutcome => {
    const definition = STRATEGIES[id];

    /* The plant type is wired into the efficiencies the heat balance already
       divides by, so the three strategies are genuinely evaluated differently
       rather than merely labelled differently. */
    const applied = applyHvacToParameters(
      { ...envelope, hvacType: definition.hvacType, powerSource: definition.powerSource },
      definition.hvacType,
    );

    const { thermal, geometry } = inputs.evaluate(applied);

    /* Size the plant on the load the design actually has. */
    const peakLoadKw = Math.max(thermal.peakCoolingLoad, thermal.peakHeatingLoad);
    const installedCapacityKw = peakLoadKw * SIZING_MARGIN * definition.capacityFactor;
    const parameters: BuildingParameters =
      installedCapacityKw > 0
        ? { ...applied, hvacCapacityKw: installedCapacityKw }
        : /* A passive shelter carries no plant at all, so the capacity is cleared
             rather than left at the requirement engine's figure — otherwise the
             comparison would claim a system the strategy does not install. */
          { ...applied, hvacCapacityKw: undefined };

    const hvac = computeHvacPerformance(thermal, parameters, geometry.floorArea);

    const ventilation = computeVentilationControl(inputs.climate, geometry, parameters, {
      month: inputs.month,
      strategy: definition.ventilation,
      occupants: inputs.occupants,
      sensibleGainW: inputs.sensibleGainW,
      latentGainW: inputs.latentGainW,
      humidityCeilingPct: inputs.humidityCeilingPct,
      coolingSetpointC: inputs.coolingSetpointC,
      indoorTemps: inputs.indoorTemps,
    });

    const freeRunningComfort = round1(thermal.annualComfortScore);
    const conditionedComfort = round1(thermal.conditionedComfortScore);

    return {
      id,
      definition,
      parameters,
      thermal,
      hvac,
      freeRunningComfort,
      conditionedComfort,
      deliveredComfort: round1(
        deliveredComfort(freeRunningComfort, conditionedComfort, hvac.capacityCoverage),
      ),
      passiveCoveragePct: round1(thermal.comfortHoursPct),
      annualEnergyKwh: hvac.deliveredTotalKwh,
      eui: hvac.eui,
      peakCoolingKw: round2(thermal.peakCoolingLoad),
      peakHeatingKw: round2(thermal.peakHeatingLoad),
      unmetKwh: hvac.unmetCoolingKwh + hvac.unmetHeatingKwh,
      capacityCoverage: hvac.capacityCoverage,
      undersizedNote: hvac.undersized
        ? `the plant covers ${(hvac.capacityCoverage * 100).toFixed(0)} % of the peak load and leans on the envelope for the rest`
        : '',
      fuelLitresPerDay: hvac.fuelLitresPerDay,
      installedCapacityKw: hvac.installedCapacityKw,
      co2TonnesPerYear: hvac.co2TonnesPerYear,
      ventilation,
      summary: '',
    };
  });

  /* --- Ranking --- */
  const USABLE_COMFORT = 60;
  const usable = outcomes.filter((o) => o.deliveredComfort >= USABLE_COMFORT);
  const pool = usable.length > 0 ? usable : outcomes;
  const recommended = pool.reduce((best, o) =>
    o.annualEnergyKwh < best.annualEnergyKwh ? o : best,
  ).id;

  const best = outcomes.find((o) => o.id === recommended)!;
  const passive = outcomes.find((o) => o.id === 'passive')!;
  const active = outcomes.find((o) => o.id === 'active')!;

  const saving =
    active.annualEnergyKwh > 0
      ? Math.round(((active.annualEnergyKwh - best.annualEnergyKwh) / active.annualEnergyKwh) * 100)
      : 0;

  const recommendation =
    `${best.definition.label} is the best balance at this site: ${best.deliveredComfort.toFixed(0)}/100 comfort ` +
    `at ${best.eui.toFixed(1)} kWh/m²·yr` +
    (best.id !== 'active' && saving > 0
      ? `, ${saving} % less delivered energy than the full active system`
      : '') +
    `. The envelope alone holds comfort for ${passive.passiveCoveragePct.toFixed(0)} % of the year.`;

  /* Fill in the per-strategy one-liners now that the comparison exists. */
  for (const outcome of outcomes) {
    outcome.summary = describeOutcome(outcome, passive, best);
  }

  return {
    envelope,
    envelopeFromRequirements: Boolean(inputs.requirements),
    outcomes,
    recommended,
    recommendation,
  };
}

function describeOutcome(
  outcome: StrategyOutcome,
  passive: StrategyOutcome,
  best: StrategyOutcome,
): string {
  if (outcome.id === 'passive') {
    return outcome.passiveCoveragePct >= 80
      ? `The envelope alone holds comfort for ${outcome.passiveCoveragePct.toFixed(0)} % of the year — no plant needed.`
      : `The envelope alone holds comfort for only ${outcome.passiveCoveragePct.toFixed(0)} % of the year, so a passive shelter would leave the occupants uncomfortable for the rest, and ${outcome.unmetKwh.toLocaleString()} kWh/yr of load would simply go unmet.`;
  }

  const extra =
    outcome.annualEnergyKwh - passive.annualEnergyKwh > 0
      ? `${outcome.annualEnergyKwh - passive.annualEnergyKwh} kWh/yr more than the passive envelope`
      : 'no more delivered energy than the passive envelope';

  const shortfall = outcome.undersizedNote;

  return (
    `${outcome.deliveredComfort.toFixed(0)}/100 comfort at ${outcome.eui.toFixed(1)} kWh/m²·yr — ${extra}` +
    (shortfall ? `; ${shortfall}` : '') +
    (outcome.id === best.id ? '. This is the recommended balance.' : '.')
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
