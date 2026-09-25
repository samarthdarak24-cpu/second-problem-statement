/**
 * Feature encoding for the ML surrogate.
 *
 * WHY A SEPARATE MODULE
 * A surrogate model is only useful if its training data and its inference input
 * are encoded *identically*. Keeping one ordered `FEATURE_NAMES` list and one
 * encoder means the training script and the browser cannot drift apart — the
 * classic failure where a model trained on one column order silently produces
 * confident nonsense on another.
 *
 * Every feature is numeric and bounded, because tree ensembles (XGBoost,
 * RandomForest) split on thresholds and cannot consume raw categorical strings.
 * Categorical fields are encoded as their index in a *stable, exported* order,
 * not as one-hot vectors, so adding a material to the catalogue appends a new
 * level without shifting every existing column.
 *
 * Angular features are encoded as sin/cos pairs. A raw azimuth in degrees is
 * actively harmful to a tree model: it tells the model that 359° and 1° are as
 * far apart as 0° and 180°, which is the opposite of the truth.
 */

import type { BuildingParameters, ClimateData, ResolvedMaterials } from '@/types';
import { INSULATION_LEVELS, ROOF_STRATEGIES, SHADING_STRATEGIES, VENTILATION_STRATEGIES } from '@/thermal/constants';
import { ROOF_MATERIALS, WALL_MATERIALS, WINDOW_MATERIALS } from '@/thermal/materials';
import { deg2rad } from '@/utils/units';

/** The model's input columns, in the exact order the encoder emits them. */
export const FEATURE_NAMES = [
  /* --- Site and climate --- */
  'latitude',
  'elevation_m',
  'annual_mean_temp_c',
  'max_temp_c',
  'min_temp_c',
  'diurnal_swing_k',
  'relative_humidity_pct',
  'wind_speed_ms',
  'daily_solar_kwh_m2',
  'rainfall_mm',

  /* --- Programme and form --- */
  'floor_area_m2',
  'volume_m3',
  'aspect_ratio',
  'height_m',
  'wall_thickness_m',
  'occupants',
  'occupant_density_per_m2',

  /* --- Orientation, as a continuous pair --- */
  'orientation_sin',
  'orientation_cos',

  /* --- Envelope --- */
  'window_to_wall_ratio',
  'insulation_thickness_m',
  'insulation_level_index',
  'wall_material_index',
  'roof_material_index',
  'window_material_index',
  'wall_u_value',
  'roof_u_value',
  'window_u_value',
  'window_shgc',
  'wall_areal_heat_capacity',

  /* --- Roof and shading --- */
  'roof_type_index',
  'roof_angle_deg',
  'roof_overhang_m',
  'shading_type_index',
  'shading_depth_m',

  /* --- Ventilation and services --- */
  'ventilation_type_index',
  'air_changes_per_hour',
  'cooling_setpoint_c',
  'heating_setpoint_c',
  'cooling_cop',
  'heating_efficiency',
  'solar_pv_kwp',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/** The three quantities the surrogate predicts. */
export const TARGET_NAMES = [
  'energy_use_intensity_kwh_m2_yr',
  'adaptive_comfort_hours_pct',
  'cost_per_m2_inr',
] as const;

export type TargetName = (typeof TARGET_NAMES)[number];

/** Ordered target vector, matching `TARGET_NAMES`. */
export type TargetVector = [number, number, number];

export interface FeatureContext {
  parameters: BuildingParameters;
  climate: ClimateData;
  materials: ResolvedMaterials;
  /** Pre-computed U-values, to avoid recomputing them per row. */
  uValues: { wall: number; roof: number; window: number };
}

/**
 * Encode one design into the model's input vector.
 *
 * @returns a vector whose length always equals `FEATURE_NAMES.length`. The
 *          function is total — every field is present, no optionals leak through.
 */
export function encodeFeatures(context: FeatureContext): number[] {
  const { parameters: p, climate, materials, uValues } = context;
  const s = climate.summary;

  const floorArea = Math.max(1e-6, p.width * p.length);
  const volume = floorArea * p.height;
  const aspectRatio = p.length / Math.max(1e-6, p.width);
  const azimuth = deg2rad(p.orientation);

  return [
    climate.location.latitude,
    climate.location.elevation,
    s.avgTemperature,
    s.maxTemperature,
    s.minTemperature,
    s.diurnalSwing,
    s.humidity,
    s.windSpeed,
    s.solarRadiation,
    s.rainfall,

    floorArea,
    volume,
    aspectRatio,
    p.height,
    p.wallThickness,
    p.numOccupants,
    p.numOccupants / floorArea,

    Math.sin(azimuth),
    Math.cos(azimuth),

    p.windowToWallRatio,
    p.insulationThickness,
    INSULATION_LEVELS.indexOf(p.insulationLevel),
    WALL_MATERIALS.findIndex((m) => m.id === p.wallMaterialId),
    ROOF_MATERIALS.findIndex((m) => m.id === p.roofMaterialId),
    WINDOW_MATERIALS.findIndex((m) => m.id === p.windowMaterialId),
    uValues.wall,
    uValues.roof,
    uValues.window,
    materials.window.shgc ?? 0.8,
    materials.wall.density * materials.wall.specificHeat * materials.wall.thickness,

    ROOF_STRATEGIES.indexOf(p.roofType),
    p.roofAngle,
    p.roofOverhang,
    SHADING_STRATEGIES.indexOf(p.shadingType),
    p.shadingDepth,

    VENTILATION_STRATEGIES.indexOf(p.ventilationType),
    p.airChangesPerHour,
    p.coolingSetpoint,
    p.heatingSetpoint,
    p.coolingCop,
    p.heatingEfficiency,
    p.solarPvKwp,
  ];
}

/** Named record form, for debugging and for CSV export of a training set. */
export function encodeFeaturesNamed(context: FeatureContext): Record<FeatureName, number> {
  const vector = encodeFeatures(context);
  const record = {} as Record<FeatureName, number>;
  FEATURE_NAMES.forEach((name, index) => {
    record[name] = vector[index]!;
  });
  return record;
}

/** Guard used by the training script before it writes a dataset. */
export function assertFeatureWidth(vector: number[]): void {
  if (vector.length !== FEATURE_NAMES.length) {
    throw new Error(
      `Feature vector has ${vector.length} values but FEATURE_NAMES has ${FEATURE_NAMES.length}. ` +
        'A model trained on a differently-sized vector would silently mis-predict.',
    );
  }
}

/** Human-readable summary of what the surrogate consumes, for the UI. */
export const FEATURE_GROUPS: Array<{ label: string; count: number }> = [
  { label: 'Site and climate', count: 10 },
  { label: 'Programme and form', count: 7 },
  { label: 'Orientation', count: 2 },
  { label: 'Envelope', count: 11 },
  { label: 'Roof and shading', count: 5 },
  { label: 'Ventilation and services', count: 7 },
];
