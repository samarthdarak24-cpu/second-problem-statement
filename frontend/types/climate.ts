/**
 * Climate domain types.
 *
 * These describe the raw climate inputs, the derived analysis, and the
 * climatological database records used to seed the pipeline.
 */

/** A selectable location. `id` is the stable key into the climatology database. */
export interface Location {
  id: string;
  country: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  /** Elevation above mean sea level, metres. Drives altitude temperature lapse. */
  elevation: number;
}

/** Which Köppen-style family a location falls into. Drives design strategy. */
export type ClimateZone =
  | 'hot-dry'
  | 'hot-humid'
  | 'warm-humid'
  | 'composite'
  | 'temperate'
  | 'cold-cloudy'
  | 'cold-sunny'
  | 'cold-desert';

/** The dominant thermal problem the shelter must solve. */
export type ThermalChallenge =
  | 'extreme-summer-heat'
  | 'combined-heat-humidity'
  | 'high-diurnal-swing'
  | 'severe-winter-cold'
  | 'moisture-and-humidity'
  | 'intense-solar-gain'
  | 'monsoon-moisture'
  | 'moderate-balanced';

/** One month of climatological normals. */
export interface MonthlyClimate {
  /** 0 = January … 11 = December. */
  month: number;
  /** Mean dry-bulb temperature, °C. */
  avgTemp: number;
  /** Mean daily maximum dry-bulb temperature, °C. */
  maxTemp: number;
  /** Mean daily minimum dry-bulb temperature, °C. */
  minTemp: number;
  /** Mean relative humidity, %. */
  humidity: number;
  /** Mean wind speed at 10 m, m/s. */
  windSpeed: number;
  /** Prevailing wind direction in degrees — the direction the wind blows FROM. */
  windDirection: number;
  /** Daily global horizontal irradiation, kWh/m²/day. */
  solarRadiation: number;
  /** Monthly total rainfall, mm. */
  rainfall: number;
  /** Mean daily bright sunshine hours. */
  sunshineHours: number;
}

/** Flat headline figures — the "Climate Summary" card reads these. */
export interface ClimateSummary {
  /** Annual mean dry-bulb temperature, °C. */
  avgTemperature: number;
  /** Annual absolute-hottest month mean daily max, °C. */
  maxTemperature: number;
  /** Annual coldest month mean daily min, °C. */
  minTemperature: number;
  /** Annual mean relative humidity, %. */
  humidity: number;
  /** Annual mean wind speed, m/s. */
  windSpeed: number;
  /** Prevailing (most frequent) wind direction, degrees. */
  windDirection: number;
  /** Annual mean daily irradiation, kWh/m²/day. */
  solarRadiation: number;
  /** Annual total rainfall, mm. */
  rainfall: number;
  /** Mean annual temperature swing (max − min of monthly means), K. */
  seasonalVariation: number;
  /** Mean daily temperature swing (mean of monthly max − min), K. */
  diurnalSwing: number;
  /** Peak month index (0-11) of the warmest month. */
  peakCoolingMonth: number;
  /** Peak month index (0-11) of the coldest month. */
  peakHeatingMonth: number;
}

/** Extreme design conditions — what the envelope must survive. */
export interface DesignConditions {
  /** 0.4 % summer design dry-bulb, °C. */
  summerDesignTemp: number;
  /** Coincident wet-bulb at summer design, °C. */
  summerDesignWetBulb: number;
  /** 99.6 % winter design dry-bulb, °C. */
  winterDesignTemp: number;
  /** Design daily temperature range, K. */
  dailyRange: number;
  /** Cooling degree days (base 24 °C). */
  coolingDegreeDays: number;
  /** Heating degree days (base 18 °C). */
  heatingDegreeDays: number;
}

/** Where the climate numbers came from — surfaced in the UI so nothing is overclaimed. */
export type ClimateSource = 'database' | 'api' | 'simulated';

/** The complete climate payload for a location. */
export interface ClimateData {
  location: Location;
  source: ClimateSource;
  /** Human-readable climate classification, e.g. "Hot semi-arid (BSh)". */
  climateType: string;
  climateZone: ClimateZone;
  summary: ClimateSummary;
  monthly: MonthlyClimate[];
  designConditions: DesignConditions;
  /** ISO timestamp of when the record was resolved. */
  fetchedAt: string;
}

/** One row in the offline climatology database. */
export interface ClimateStationRecord {
  location: Location;
  climateType: string;
  climateZone: ClimateZone;
  /** 12 monthly records, January first. */
  monthly: MonthlyClimate[];
}

/** Output of the climate analysis engine. */
export interface ClimateAnalysis {
  zone: ClimateZone;
  classification: string;
  mainChallenge: ThermalChallenge;
  /** Short prose describing the dominant thermal problem. */
  challengeDetail: string;
  ventilationStrategy: VentilationStrategy;
  /**
   * Design air-change rate the ventilation strategy provides, ACH.
   *
   * This is a *capacity*, not a constant operating rate: the thermal model only
   * applies it when the outside air is actually cooler than the space, so a high
   * value in a cold climate is not a winter heat loss.
   */
  ventilationAch: number;
  insulationLevel: InsulationLevel;
  /** Insulation thickness that goes with the recommended level, metres. */
  insulationThickness: number;
  shadingStrategy: ShadingStrategy;
  /** Recommended window-to-wall ratio, 0–1. */
  windowRatioRecommendation: number;
  /** Recommended building azimuth (long-axis rotation), degrees 0–360. */
  orientationRecommendation: number;
  /** Recommended roof strategy. */
  roofStrategy: RoofStrategy;
  /** Recommended glazing specification. */
  glazingStrategy: GlazingType;
  /** Recommended roof overhang / shading depth, metres. */
  shadingDepth: number;
  /** Recommended wall thickness, metres. */
  wallThickness: number;
  /** Every recommendation carries a plain-language reason for the "Why this design?" panel. */
  rationale: DesignRationale[];
}

/** A single explained design decision. */
export interface DesignRationale {
  id: string;
  /** What was decided, e.g. "External shading". */
  title: string;
  /** Why, e.g. "High solar radiation detected." */
  reason: string;
  /** How much it matters. */
  impact: 'high' | 'medium' | 'low';
  /** Which design parameter this drives. */
  parameter: string;
  /** The concrete value chosen. */
  value: string;
}

/* ------------------------------------------------------------------ */
/* Enumerated design vocabularies                                      */
/* ------------------------------------------------------------------ */

export type VentilationStrategy =
  | 'cross-ventilation'
  | 'stack-ventilation'
  | 'single-sided'
  | 'night-purge'
  | 'sealed-mechanical'
  | 'mixed-mode';

export type InsulationLevel = 'none' | 'low' | 'medium' | 'high' | 'very-high';

export type ShadingStrategy =
  | 'none'
  | 'overhang'
  | 'louvre'
  | 'external-blind'
  | 'deep-verandah'
  | 'combined';

export type RoofStrategy = 'flat' | 'gable' | 'hip' | 'shed' | 'vaulted';

export type GlazingType = 'single' | 'double' | 'double-lowE' | 'triple';
