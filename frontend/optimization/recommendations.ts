/**
 * Recommendations with measured effects.
 *
 * The climate engine already explains *why* it recommends something. This module
 * adds the second half of the answer: *how much it actually bought you*.
 *
 * The effect of each measure is measured by counterfactual — take the optimised
 * design, revert exactly one decision back to the conventional baseline, re-run
 * the thermal model, and report the difference. That is a marginal contribution
 * rather than a hand-waved estimate, and it is honest about the fact that
 * measures interact: an overhang is worth more once the glazing ratio is low,
 * and the panel shows the effect *in the context of this design*, not in
 * isolation.
 *
 * The cost is one extra simulation per recommendation, which is why the
 * optimiser hands this module a probe function rather than re-running everything.
 */

import type {
  BuildingParameters,
  ClimateAnalysis,
  ClimateData,
  Recommendation,
} from '@/types';
import { INSULATION_LABEL, ROOF_LABEL, SHADING_LABEL, VENTILATION_LABEL } from '@/thermal/constants';
import { DEFAULT_GLAZING_BIAS, glazingBiasOption } from '@/lib/glazingBias';
import type { EvaluatedCandidate } from './objective';

export interface RecommendationInput {
  analysis: ClimateAnalysis;
  climate: ClimateData;
  baseline: EvaluatedCandidate;
  optimized: EvaluatedCandidate;
  /** Evaluate a design without recording it in the leaderboard. */
  probe: (parameters: BuildingParameters) => EvaluatedCandidate;
}

/** The decision axes the panel explains, in the order they are shown. */
const EXPLAINED_AXES = [
  'orientation',
  'glazingBias',
  'shading',
  'windowRatio',
  'insulation',
  'glazing',
  'roof',
  'wallMaterial',
  'ventilation',
  'pv',
] as const;

type ExplainedAxis = (typeof EXPLAINED_AXES)[number];

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { analysis, baseline, optimized, probe } = input;
  const recommendations: Recommendation[] = [];

  for (const axis of EXPLAINED_AXES) {
    const reverted = revertAxis(optimized.parameters, axis, baseline.parameters);
    if (!reverted) continue;

    const counterfactual = probe(reverted);
    const recommendation = describeAxis(axis, {
      analysis,
      optimized,
      counterfactual,
    });
    if (recommendation) recommendations.push(recommendation);
  }

  /* The climate engine's own rationale entries carry reasons the counterfactual
     cannot express — why this orientation, why this challenge dominates. Fold
     them in, but only where the optimiser did not already produce a row for the
     same parameter, so the panel never says the same thing twice. */
  const covered = new Set(recommendations.map((r) => r.parameter));
  for (const entry of analysis.rationale) {
    if (covered.has(entry.parameter)) continue;
    recommendations.push({
      id: `rationale-${entry.id}`,
      category: categoryFor(entry.parameter),
      parameter: entry.parameter,
      value: entry.value,
      reason: entry.reason,
      impact: entry.impact,
    });
    covered.add(entry.parameter);
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return recommendations.sort((a, b) => order[a.impact] - order[b.impact]);
}

/* ------------------------------------------------------------------ */
/* Per-axis description                                                */
/* ------------------------------------------------------------------ */

interface AxisContext {
  analysis: ClimateAnalysis;
  optimized: EvaluatedCandidate;
  counterfactual: EvaluatedCandidate;
}

function describeAxis(axis: ExplainedAxis, ctx: AxisContext): Recommendation | null {
  const { optimized, counterfactual } = ctx;
  const params = optimized.parameters;

  /*
   * Every term is `optimized − counterfactual`, i.e. *the change this measure
   * causes*. Keeping one sign convention means the reader never has to work out
   * whether "−0.5 °C" means the design got cooler or the counterfactual did.
   */
  const dComfort =
    optimized.metrics.adaptiveComfortHoursPct - counterfactual.metrics.adaptiveComfortHoursPct;
  const dEnergy = optimized.metrics.annualEnergy - counterfactual.metrics.annualEnergy;
  const dSummer =
    optimized.metrics.summerIndoorTemperature - counterfactual.metrics.summerIndoorTemperature;
  const dWinter =
    optimized.metrics.winterIndoorTemperature - counterfactual.metrics.winterIndoorTemperature;

  const effectParts: string[] = [];
  if (Math.abs(dComfort) >= 0.8) effectParts.push(`${signed(dComfort, 1)} pts comfort`);
  if (Math.abs(dEnergy) >= 30) effectParts.push(`${signed(dEnergy, 0)} kWh/yr`);
  if (Math.abs(dSummer) >= 0.3) effectParts.push(`${signed(dSummer, 1)} °C summer indoor`);
  if (Math.abs(dWinter) >= 0.3) effectParts.push(`${signed(dWinter, 1)} °C winter indoor`);
  const effect = effectParts.length > 0 ? effectParts.join(' · ') : undefined;

  /* If reverting the measure changes nothing measurable, the optimiser picked it
     for a reason the model cannot see (or it was a tie). Say so rather than
     inventing a benefit. */
  const negligible = effectParts.length === 0;

  switch (axis) {
    case 'orientation':
      return {
        id: 'rec-orientation',
        category: 'orientation',
        parameter: 'orientation',
        value: `${Math.round(params.orientation)}°`,
        reason: ctx.analysis.rationale.find((r) => r.parameter === 'orientation')?.reason ??
          'Orientation sets how much sun each facade collects, and is free to get right at design stage and expensive to change later.',
        impact: 'high',
        effect,
      };

    case 'glazingBias': {
      const bias = glazingBiasOption(params.glazingBias ?? DEFAULT_GLAZING_BIAS);
      return {
        id: 'rec-glazing-bias',
        category: 'glazing',
        parameter: 'glazing position',
        value: bias.label,
        reason: bias.rationale,
        impact: 'high',
        effect,
      };
    }

    case 'shading':
      return {
        id: 'rec-shading',
        category: 'shading',
        parameter: 'shading',
        value:
          params.shadingType === 'none'
            ? 'None'
            : `${SHADING_LABEL[params.shadingType]} · ${params.shadingDepth.toFixed(2)} m`,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'shading')?.reason ??
          'External shading intercepts solar radiation before it becomes a cooling load inside the space.',
        impact: params.shadingType === 'none' ? 'low' : 'high',
        effect,
      };

    case 'windowRatio':
      return {
        id: 'rec-window-ratio',
        category: 'glazing',
        parameter: 'windowToWallRatio',
        value: `${Math.round(params.windowToWallRatio * 100)} %`,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'windowToWallRatio')?.reason ??
          'Glazing area sets both the daylight and the solar gain, and it is the single most consequential envelope decision in a hot climate.',
        impact: 'high',
        effect,
      };

    case 'insulation':
      return {
        id: 'rec-insulation',
        category: 'envelope',
        parameter: 'insulation',
        value:
          params.insulationLevel === 'none'
            ? 'None'
            : `${INSULATION_LABEL[params.insulationLevel]} · ${Math.round(params.insulationThickness * 1000)} mm`,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'insulation')?.reason ??
          'Insulation slows conduction through the envelope, which is what keeps the indoor temperature from tracking the outdoor one.',
        impact: params.insulationLevel === 'none' ? 'low' : 'high',
        effect,
      };

    case 'glazing':
      return {
        id: 'rec-glazing',
        category: 'glazing',
        parameter: 'windowType',
        value: ctx.analysis.rationale.find((r) => r.parameter === 'windowType')?.value ?? params.windowMaterialId,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'windowType')?.reason ??
          'Glazing specification trades U-value against solar heat gain coefficient, and the right balance depends on whether the climate is heating- or cooling-dominated.',
        impact: 'medium',
        effect,
      };

    case 'roof':
      return {
        id: 'rec-roof',
        category: 'roof',
        parameter: 'roofType',
        value: `${ROOF_LABEL[params.roofType]} · ${params.roofAngle}°`,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'roofType')?.reason ??
          'The roof is the largest solar-exposed surface, so its form and finish drive the peak cooling load more than any wall.',
        impact: 'medium',
        effect,
      };

    case 'wallMaterial':
      return {
        id: 'rec-wall-material',
        category: 'envelope',
        parameter: 'wallMaterialId',
        value: optimized.materials.wall.name,
        reason: `${optimized.materials.wall.note ?? 'Wall material sets both the U-value and the thermal mass.'} Thermal mass of ${(optimized.materials.wall.density * optimized.materials.wall.specificHeat * optimized.materials.wall.thickness / 1e6).toFixed(0)} kJ/m²K delays and flattens the daily swing.`,
        impact: 'medium',
        effect,
      };

    case 'ventilation':
      return {
        id: 'rec-ventilation',
        category: 'ventilation',
        parameter: 'ventilation',
        value: `${VENTILATION_LABEL[params.ventilationType]} · ${params.airChangesPerHour} ACH`,
        reason:
          ctx.analysis.rationale.find((r) => r.parameter === 'ventilation')?.reason ??
          'Ventilation is free cooling when the outside air is cooler than the space, and a heat loss when it is not — so it is specified as a capacity the occupants modulate.',
        impact: 'high',
        effect,
      };

    case 'pv':
      if (params.solarPvKwp <= 0) return null;
      return {
        id: 'rec-pv',
        category: 'services',
        parameter: 'solarPvKwp',
        value: `${params.solarPvKwp} kWp`,
        reason: `A ${params.solarPvKwp} kWp array offsets the residual load, cutting operational carbon without changing the thermal performance of the envelope.`,
        impact: 'medium',
        effect: `${(params.solarPvKwp * 1450).toFixed(0)} kWh/yr generated (estimate)`,
      };

    default:
      return negligible ? null : null;
  }
}

/* ------------------------------------------------------------------ */
/* Reverting one axis to the baseline                                  */
/* ------------------------------------------------------------------ */

function revertAxis(
  optimized: BuildingParameters,
  axis: ExplainedAxis,
  baseline: BuildingParameters,
): BuildingParameters | null {
  const next: BuildingParameters = { ...optimized };

  switch (axis) {
    case 'orientation':
      if (optimized.orientation === baseline.orientation) return null;
      next.orientation = baseline.orientation;
      break;
    case 'glazingBias': {
      /* A design with no bias is balanced, so compare on the effective value —
         otherwise "undefined vs balanced" would read as a change that is not
         one, and the panel would explain a decision nobody made. */
      const optimizedBias = optimized.glazingBias ?? DEFAULT_GLAZING_BIAS;
      const baselineBias = baseline.glazingBias ?? DEFAULT_GLAZING_BIAS;
      if (optimizedBias === baselineBias) return null;
      next.glazingBias = baselineBias;
      next.facadeWeights = glazingBiasOption(baselineBias).weights;
      break;
    }
    case 'shading':
      if (
        optimized.shadingType === baseline.shadingType &&
        Math.abs(optimized.shadingDepth - baseline.shadingDepth) < 1e-6
      ) {
        return null;
      }
      next.shadingType = baseline.shadingType;
      next.shadingDepth = baseline.shadingDepth;
      next.roofOverhang = baseline.roofOverhang;
      break;
    case 'windowRatio':
      if (Math.abs(optimized.windowToWallRatio - baseline.windowToWallRatio) < 1e-6) return null;
      next.windowToWallRatio = baseline.windowToWallRatio;
      break;
    case 'insulation':
      if (optimized.insulationLevel === baseline.insulationLevel) return null;
      next.insulationLevel = baseline.insulationLevel;
      next.insulationThickness = baseline.insulationThickness;
      break;
    case 'glazing':
      if (optimized.windowMaterialId === baseline.windowMaterialId) return null;
      next.windowMaterialId = baseline.windowMaterialId;
      break;
    case 'roof':
      if (optimized.roofType === baseline.roofType) return null;
      next.roofType = baseline.roofType;
      next.roofAngle = baseline.roofAngle;
      break;
    case 'wallMaterial':
      if (optimized.wallMaterialId === baseline.wallMaterialId) return null;
      next.wallMaterialId = baseline.wallMaterialId;
      break;
    case 'ventilation':
      if (optimized.ventilationType === baseline.ventilationType) return null;
      next.ventilationType = baseline.ventilationType;
      next.airChangesPerHour = baseline.airChangesPerHour;
      break;
    case 'pv':
      if (optimized.solarPvKwp === baseline.solarPvKwp) return null;
      next.solarPvKwp = baseline.solarPvKwp;
      break;
    default:
      return null;
  }

  return next;
}

function categoryFor(parameter: string): Recommendation['category'] {
  switch (parameter) {
    case 'orientation':
      return 'orientation';
    case 'shading':
    case 'shadingDepth':
      return 'shading';
    case 'windowToWallRatio':
    case 'windowType':
      return 'glazing';
    case 'roofType':
      return 'roof';
    case 'ventilation':
      return 'ventilation';
    case 'insulation':
    case 'wallThickness':
    case 'wallMaterialId':
      return 'envelope';
    default:
      return 'services';
  }
}

function signed(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `0`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}`;
}

/** Exposed so the UI can show the same phrase in the "how it works" panel. */
export const EFFECT_METHOD_NOTE =
  'Each effect is the change this one decision causes, measured by reverting it to conventional construction and re-running the thermal model — so it reflects the measure in the context of this design, not in isolation. A positive number is an increase.';
