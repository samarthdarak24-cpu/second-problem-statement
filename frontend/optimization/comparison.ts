/**
 * Before / after comparison.
 *
 * Produces the rows the comparison table renders, and — more importantly —
 * decides the *direction* of improvement for each metric, because "energy went
 * down" and "comfort hours went up" are both good news and a table that treats
 * every decrease as an improvement will lie about half of them.
 *
 * Every row is labelled with the model that produced it. Nothing here is a
 * measurement.
 */

import type {
  BuildingParameters,
  ClimateData,
  ComparisonDelta,
  CostEstimate,
  DesignComparison,
  ThermalComfort,
} from '@/types';
import { deriveDesignMetrics, type DesignMetrics } from '@/thermal/metrics';
import { designScore, evaluateParameters } from './objective';
import { DEFAULT_WEIGHTS } from './objective';

export interface ComparisonSide {
  label: string;
  parameters: BuildingParameters;
  thermal: ThermalComfort;
  cost: CostEstimate;
}

export function compareDesigns(
  baseline: ComparisonSide,
  optimized: ComparisonSide,
  climate: ClimateData,
): DesignComparison {
  const b = deriveDesignMetrics(baseline.thermal, climate);
  const o = deriveDesignMetrics(optimized.thermal, climate);

  const rows: ComparisonDelta[] = [];

  const add = (
    metric: string,
    unit: string,
    baseValue: number,
    optValue: number,
    lowerIsBetter: boolean,
    digits = 1,
  ) => {
    const delta = optValue - baseValue;
    const changePct = baseValue !== 0 ? (delta / Math.abs(baseValue)) * 100 : 0;
    rows.push({
      metric,
      unit,
      baseline: round(baseValue, digits),
      optimized: round(optValue, digits),
      delta: round(delta, digits),
      lowerIsBetter,
      changePct: round(changePct, 1),
      improved: lowerIsBetter ? delta < -1e-9 : delta > 1e-9,
    });
  };

  /* --- Comfort ------------------------------------------------------ */
  add('Summer indoor temperature', '°C', b.summerIndoorTemperature, o.summerIndoorTemperature, true);
  add('Winter indoor temperature', '°C', b.winterIndoorTemperature, o.winterIndoorTemperature, false);
  add('Summer overshoot past comfort band', 'K', b.summerOvertemperature, o.summerOvertemperature, true);
  add('Winter shortfall below comfort band', 'K', b.winterUndertemperature, o.winterUndertemperature, true);
  add('Adaptive comfort hours', '%', b.adaptiveComfortHoursPct, o.adaptiveComfortHoursPct, false);
  add('Overheating hours', 'h/yr', b.overheatingHours, o.overheatingHours, true, 0);
  add('Underheating hours', 'h/yr', b.underheatingHours, o.underheatingHours, true, 0);

  /* --- Conditioned performance -------------------------------------- */
  add('PMV (system running)', '', b.conditionedPmv, o.conditionedPmv, true, 2);
  add('PPD (system running)', '%', b.conditionedPpd, o.conditionedPpd, true);

  /* --- Energy ------------------------------------------------------- */
  add('Annual cooling energy', 'kWh/yr', b.annualCoolingEnergy, o.annualCoolingEnergy, true, 0);
  add('Annual heating energy', 'kWh/yr', b.annualHeatingEnergy, o.annualHeatingEnergy, true, 0);
  add('Total annual energy', 'kWh/yr', b.annualEnergy, o.annualEnergy, true, 0);
  add('Energy use intensity', 'kWh/m²·yr', b.energyUseIntensity, o.energyUseIntensity, true);
  add('Peak cooling load', 'kW', b.peakCoolingLoad, o.peakCoolingLoad, true);
  add('Peak heating load', 'kW', b.peakHeatingLoad, o.peakHeatingLoad, true);
  add('Operational CO₂', 't/yr', b.co2TonnesPerYear, o.co2TonnesPerYear, true);

  /* --- Cost --------------------------------------------------------- */
  add('Construction cost', '₹', baseline.cost.totalCost, optimized.cost.totalCost, true, 0);
  add('Cost per m²', '₹/m²', baseline.cost.costPerSqm, optimized.cost.costPerSqm, true, 0);
  add(
    '20-year cost of ownership',
    '₹',
    baseline.cost.twentyYearCost,
    optimized.cost.twentyYearCost,
    true,
    0,
  );

  /* --- Envelope ----------------------------------------------------- */
  add('Window-to-wall ratio', '%', baseline.parameters.windowToWallRatio * 100, optimized.parameters.windowToWallRatio * 100, false, 0);
  add('Insulation thickness', 'mm', baseline.parameters.insulationThickness * 1000, optimized.parameters.insulationThickness * 1000, false, 0);
  add('Shading projection', 'm', baseline.parameters.shadingDepth, optimized.parameters.shadingDepth, false, 2);

  return {
    baseline: {
      label: baseline.label,
      parameters: baseline.parameters,
      thermal: baseline.thermal,
      cost: baseline.cost,
      score: sideScore(b, baseline.cost, climate, baseline.parameters),
    },
    optimized: {
      label: optimized.label,
      parameters: optimized.parameters,
      thermal: optimized.thermal,
      cost: optimized.cost,
      score: sideScore(o, optimized.cost, climate, optimized.parameters),
    },
    deltas: rows,
  };
}

/** Score a design through the same objective the optimiser minimised. */
function sideScore(
  metrics: DesignMetrics,
  _cost: CostEstimate,
  _climate: ClimateData,
  parameters: BuildingParameters,
): number {
  /* Reuse the objective rather than re-deriving a score, so the number on the
     comparison card is the same number the search optimised. The thermal result
     is not recomputed — only the scoring is. */
  void metrics;
  const evaluated = evaluateParameters('compare', 'Comparison', parameters, _climate, DEFAULT_WEIGHTS);
  return designScore(evaluated.objective);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ */
/* Narrative summary                                                   */
/* ------------------------------------------------------------------ */

/** One-paragraph plain-language read of the comparison, for the demo panel. */
export function summariseComparison(comparison: DesignComparison): string {
  const energy = comparison.deltas.find((d) => d.metric === 'Total annual energy');
  const comfort = comparison.deltas.find((d) => d.metric === 'Adaptive comfort hours');
  const cost = comparison.deltas.find((d) => d.metric === 'Construction cost');

  const parts: string[] = [];

  if (energy) {
    parts.push(
      energy.changePct < 0
        ? `Annual energy falls ${Math.abs(energy.changePct).toFixed(0)} % to ${energy.optimized.toFixed(0)} kWh`
        : `Annual energy rises ${energy.changePct.toFixed(0)} % to ${energy.optimized.toFixed(0)} kWh`,
    );
  }
  if (comfort) {
    parts.push(
      comfort.delta > 0
        ? `time inside the adaptive comfort band improves by ${comfort.delta.toFixed(1)} percentage points`
        : `time inside the adaptive comfort band falls by ${Math.abs(comfort.delta).toFixed(1)} points`,
    );
  }
  if (cost) {
    parts.push(
      cost.delta > 0
        ? `at an additional ${formatRupees(cost.delta)} of capital cost`
        : `while saving ${formatRupees(Math.abs(cost.delta))} of capital cost`,
    );
  }

  const body = parts.length > 0 ? `${parts.join(', ')}.` : 'No material difference between the designs.';
  return `${body} Both figures are model estimates from the simplified heat balance, not measured performance.`;
}

function formatRupees(value: number): string {
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)} crore`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)} lakh`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
