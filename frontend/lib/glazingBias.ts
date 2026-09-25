/**
 * Glazing distribution across the four facades.
 *
 * WHY A NAMED STRATEGY RATHER THAN FOUR NUMBERS
 * `facadeWeights` is a set of four continuous multipliers, and the optimiser
 * could in principle search it directly. It should not. A four-dimensional
 * continuous axis quadruples the neighbourhood and produces candidates like
 * "south 1.7, east 0.93, west 1.12, north 0.41" — a design nobody can describe,
 * justify, or build to a drawing.
 *
 * What the physics actually offers is a small number of *recognisable* facade
 * strategies, and which one is right is a question the climate answers:
 *
 *   - a cold, sun-rich site wants the glazing on the equator-facing wall,
 *     because winter solar gain is the entire heat supply;
 *   - a hot site wants it away from east and west, because low-angle morning
 *     and afternoon sun is the hardest gain to shade;
 *   - a humid site wants balanced openings, because ventilation matters more
 *     than gain.
 *
 * Searching five named strategies rather than four reals keeps every candidate
 * explainable, which is the whole point of the explanation panel: "glazing was
 * moved to the south facade" is a decision a reader can check, and a weight
 * vector is not.
 *
 * HOW THE WEIGHTS ARE APPLIED
 * `weightForAzimuth` in `utils/shelterGeometry.ts` interpolates these against
 * the **compass** azimuth of each facade, not its local identity. So a
 * `south-led` bias puts the glass on whichever wall actually faces south once
 * the building's orientation is applied — which is what makes glazing position
 * and orientation two separable decisions rather than one.
 */

import type { FacadeWeights, GlazingBiasId } from '@/types';

export type { GlazingBiasId };

export interface GlazingBiasOption {
  id: GlazingBiasId;
  label: string;
  /** Why this distribution exists, in one line. */
  rationale: string;
  weights: FacadeWeights;
}

/**
 * The strategies, ordered from the neutral case outward.
 *
 * `balanced` is first because it is the honest default: it is what a designer
 * with no climate information would build, and it is the thing the optimiser
 * has to beat before any of the others is worth recommending.
 */
export const GLAZING_BIASES: GlazingBiasOption[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    rationale: 'Equal glazing on all four facades — the no-climate-information default.',
    weights: { north: 1, east: 1, south: 1, west: 1 },
  },
  {
    id: 'south-led',
    label: 'South-led',
    rationale:
      'Concentrates glass on the equator-facing wall to maximise useful winter solar gain — the passive-solar strategy for a cold, sun-rich site.',
    weights: { north: 0.35, east: 0.9, south: 2.6, west: 0.9 },
  },
  {
    id: 'south-east',
    label: 'South + east',
    rationale:
      'South-led with a morning bias — collects early sun in a cold climate without waiting for the afternoon.',
    weights: { north: 0.3, east: 1.5, south: 2.0, west: 0.7 },
  },
  {
    id: 'south-west',
    label: 'South + west',
    rationale:
      'South-led with an afternoon bias — extends the useful gain into the evening, at the cost of late overheating risk.',
    weights: { north: 0.3, east: 0.7, south: 2.0, west: 1.5 },
  },
  {
    id: 'north-shielded',
    label: 'North shielded',
    rationale:
      'Strips the pole-facing facade of glass, where a window is pure loss with almost no gain to offset it.',
    weights: { north: 0.15, east: 1.0, south: 1.7, west: 1.0 },
  },
  {
    id: 'east-west',
    label: 'East + west only',
    rationale:
      'Moves glass off the equator to reduce peak gain and rely on cross-ventilation instead — a hot-humid strategy where the breeze does the work.',
    weights: { north: 0.4, east: 1.4, south: 0.7, west: 1.4 },
  },
];

export const DEFAULT_GLAZING_BIAS: GlazingBiasId = 'balanced';

const BY_ID = new Map(GLAZING_BIASES.map((option) => [option.id, option]));

export function glazingBiasOption(id: GlazingBiasId): GlazingBiasOption {
  return BY_ID.get(id) ?? GLAZING_BIASES[0]!;
}

export function isGlazingBiasId(value: unknown): value is GlazingBiasId {
  return typeof value === 'string' && BY_ID.has(value as GlazingBiasId);
}

export const GLAZING_BIAS_OPTIONS: { value: string; label: string }[] = GLAZING_BIASES.map(
  (option) => ({ value: option.id, label: option.label }),
);

/**
 * The facade weights a parameter set should be built with.
 *
 * Falls back to the stored `facadeWeights` when no bias is set, so a design
 * saved before this axis existed keeps the distribution it was designed with
 * rather than being silently re-glazed.
 */
export function resolveFacadeWeights(parameters: {
  glazingBias?: GlazingBiasId;
  facadeWeights: FacadeWeights;
}): FacadeWeights {
  if (!parameters.glazingBias) return parameters.facadeWeights;
  return glazingBiasOption(parameters.glazingBias).weights;
}
