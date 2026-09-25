/**
 * Shared design constants that more than one engine needs.
 *
 * These live here rather than inside `climateAnalysis.ts` because the cost
 * model, the optimiser, the UI sliders and the demo scenario all need the same
 * answer to questions like "how thick is 'high' insulation?". Duplicating the
 * mapping is how a project ends up with a slider that says 100 mm and a thermal
 * model that assumes 75 mm.
 */

import type { InsulationLevel, RoofStrategy, ShadingStrategy, VentilationStrategy } from '@/types';

/* ------------------------------------------------------------------ */
/* Insulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Insulation thickness for each level, metres.
 *
 * Chosen against real assemblies: 40 mm is a thin retrofit board, 150 mm is a
 * cold-climate specification. `none` is a genuine zero — no added layer at all.
 */
export const INSULATION_LEVEL_THICKNESS: Record<InsulationLevel, number> = {
  none: 0,
  low: 0.04,
  medium: 0.075,
  high: 0.1,
  'very-high': 0.15,
};

/** Insulation material that goes with each level. */
export const INSULATION_LEVEL_MATERIAL: Record<InsulationLevel, string> = {
  none: 'none',
  low: 'coir',
  medium: 'eps',
  high: 'xps',
  'very-high': 'puf',
};

export const INSULATION_LEVELS: InsulationLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'very-high',
];

/** Human label for a level. */
export const INSULATION_LABEL: Record<InsulationLevel, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'very-high': 'Very high',
};

/* ------------------------------------------------------------------ */
/* Ventilation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Design air-change capacity for each strategy, ACH.
 *
 * This is a *capacity*, not a constant rate: the thermal model only applies the
 * part above infiltration when the outside air is actually cooler than the
 * space. A high figure in a cold climate is therefore not a winter heat loss.
 */
export const VENTILATION_ACH: Record<VentilationStrategy, number> = {
  'sealed-mechanical': 0.5,
  'single-sided': 2,
  'night-purge': 5,
  'stack-ventilation': 6,
  'mixed-mode': 6,
  'cross-ventilation': 8,
};

export const VENTILATION_LABEL: Record<VentilationStrategy, string> = {
  'sealed-mechanical': 'Sealed + mechanical',
  'single-sided': 'Single-sided',
  'night-purge': 'Night purge',
  'stack-ventilation': 'Stack ventilation',
  'mixed-mode': 'Mixed mode',
  'cross-ventilation': 'Cross-ventilation',
};

export const VENTILATION_STRATEGIES: VentilationStrategy[] = [
  'sealed-mechanical',
  'single-sided',
  'night-purge',
  'stack-ventilation',
  'mixed-mode',
  'cross-ventilation',
];

/* ------------------------------------------------------------------ */
/* Roofs                                                               */
/* ------------------------------------------------------------------ */

export const ROOF_LABEL: Record<RoofStrategy, string> = {
  flat: 'Flat',
  shed: 'Shed (mono-pitch)',
  gable: 'Pitched gable',
  hip: 'Pitched hip',
  vaulted: 'Vaulted',
};

/** Roof pitch that goes with each form, degrees. */
export const ROOF_PITCH: Record<RoofStrategy, number> = {
  flat: 0,
  shed: 20,
  gable: 30,
  hip: 30,
  vaulted: 35,
};

export const ROOF_STRATEGIES: RoofStrategy[] = ['flat', 'shed', 'gable', 'hip', 'vaulted'];

/* ------------------------------------------------------------------ */
/* Shading                                                             */
/* ------------------------------------------------------------------ */

export const SHADING_LABEL: Record<ShadingStrategy, string> = {
  none: 'None',
  overhang: 'Overhang',
  louvre: 'Louvres',
  'external-blind': 'External blinds',
  'deep-verandah': 'Deep verandah',
  combined: 'Overhang + fins',
};

export const SHADING_STRATEGIES: ShadingStrategy[] = [
  'none',
  'overhang',
  'louvre',
  'external-blind',
  'deep-verandah',
  'combined',
];

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

/** Infiltration floor used by the thermal model, ACH. Mirrors the model constant. */
export const INFILTRATION_ACH = 0.5;
