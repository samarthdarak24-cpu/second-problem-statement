/**
 * Display labels for the enumerated design vocabularies.
 *
 * The unions in `types/climate.ts` are deliberately machine-shaped
 * (`'cold-sunny'`, `'deep-verandah'`). Anything a person reads goes through
 * here, so a rename in the domain model can never leak a hyphenated slug into
 * the interface — and so a missing label is a type error rather than a blank
 * cell in a table.
 */

import type {
  ClimateZone,
  GlazingType,
  ThermalChallenge,
  VisualizationMode,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Climate                                                             */
/* ------------------------------------------------------------------ */

export const ZONE_LABEL: Record<ClimateZone, string> = {
  'hot-dry': 'Hot & dry',
  'hot-humid': 'Hot & humid',
  'warm-humid': 'Warm & humid',
  composite: 'Composite',
  temperate: 'Temperate',
  'cold-cloudy': 'Cold & cloudy',
  'cold-sunny': 'Cold & sunny',
  'cold-desert': 'Cold desert',
};

/** Short description of what each zone demands of the envelope. */
export const ZONE_NOTE: Record<ClimateZone, string> = {
  'hot-dry': 'Shade the openings, add mass, and flush at night.',
  'hot-humid': 'Maximise cross-ventilation; keep the envelope light and open.',
  'warm-humid': 'Ventilate continuously; shade and dehumidify where possible.',
  composite: 'Seasonal reversal — shade in summer, admit sun in winter.',
  temperate: 'Balanced envelope; comfort is achievable without much plant.',
  'cold-cloudy': 'Insulate heavily and keep the heat in; solar gain is scarce.',
  'cold-sunny': 'Insulate, and collect the strong winter sun through south glazing.',
  'cold-desert': 'Very high swing — mass plus insulation, and solar heating.',
};

export const CHALLENGE_LABEL: Record<ThermalChallenge, string> = {
  'extreme-summer-heat': 'Extreme summer heat',
  'combined-heat-humidity': 'Combined heat and humidity',
  'high-diurnal-swing': 'High day–night swing',
  'severe-winter-cold': 'Severe winter cold',
  'moisture-and-humidity': 'Moisture and humidity',
  'intense-solar-gain': 'Intense solar gain',
  'monsoon-moisture': 'Monsoon moisture',
  'moderate-balanced': 'Moderate and balanced',
};

export const GLAZING_LABEL: Record<GlazingType, string> = {
  single: 'Single glazing',
  double: 'Double glazing',
  'double-lowE': 'Double low-E',
  triple: 'Triple low-E',
};

/* ------------------------------------------------------------------ */
/* Visualisation modes                                                 */
/* ------------------------------------------------------------------ */

export const MODE_LABEL: Record<VisualizationMode, string> = {
  normal: 'Normal',
  heatmap: 'Heat map',
  airflow: 'Air flow',
  solar: 'Solar path',
  floorplan: 'Floor plan',
  front: 'Front',
  side: 'Side',
  top: 'Top',
  walkthrough: 'Walkthrough',
};

export const MODE_NOTE: Record<VisualizationMode, string> = {
  normal: 'Materials and envelope as specified.',
  heatmap: 'Absorbed solar radiation per surface for the selected month.',
  airflow: 'Prevailing wind, cross-ventilation paths and opening positions.',
  solar: 'Sun path for the selected month with the hour marker.',
  floorplan: 'Dimensioned plan with wall poché, openings and north arrow.',
  front: 'Elevation looking at the front facade.',
  side: 'Elevation looking at the side facade.',
  top: 'Roof plan — the shading and roof geometry in plan.',
  walkthrough: 'First-person walkthrough. Click to lock the pointer, WASD to move.',
};

/* ------------------------------------------------------------------ */
/* Provenance badges                                                   */
/* ------------------------------------------------------------------ */

export const PROVIDER_LABEL: Record<string, string> = {
  backend: 'Climate service',
  'open-meteo': 'Open-Meteo archive',
  database: 'Offline climatology',
  interpolated: 'Interpolated',
  synthesised: 'Synthesised',
  offline: 'Offline climatology',
};
