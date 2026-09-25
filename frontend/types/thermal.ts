/**
 * Thermal comfort and energy result types.
 *
 * Every result carries a `modelType` tag so the UI can label values honestly as
 * simplified-model estimates rather than validated simulation output.
 */

/** Which engine produced a result. */
export type ThermalModelType =
  | 'simplified-monthly-heat-balance'
  | 'validated-simulation'
  | 'measured';

/** Provenance banner data — rendered next to every number in the UI. */
export interface ModelProvenance {
  modelType: ThermalModelType;
  /** Short label, e.g. "Simplified quasi-steady-state model". */
  label: string;
  /** One-line honesty statement. */
  disclaimer: string;
}

/** Per-month thermal result. */
export interface MonthlyThermalResult {
  month: number;
  /** Mean outdoor dry-bulb, °C. */
  outdoorTemp: number;
  /** Mean indoor dry-bulb with no active system, °C. */
  freeFloatTemp: number;
  /** Mean indoor dry-bulb with the system maintaining setpoint, °C. */
  indoorTemp: number;
  /** Peak-day indoor temperature, °C. */
  peakIndoorTemp: number;
  relativeHumidity: number;
  meanRadiantTemp: number;
  airVelocity: number;
  pmv: number;
  ppd: number;
  comfortScore: number;
  /** Sensible + latent cooling energy, kWh for the month. */
  coolingEnergy: number;
  heatingEnergy: number;
  /** Peak-day cooling load, kW. */
  peakCoolingLoad: number;
  peakHeatingLoad: number;
  /** % of the month's hours inside the comfort band with no HVAC. */
  comfortHoursPct: number;
  /** Whether the space needs cooling, heating, or neither, on balance. */
  mode: 'cooling' | 'heating' | 'mixed' | 'free';
}

/** Monthly heat-balance terms, kWh/month. Positive = heat entering the zone. */
export interface HeatBalance {
  solarGain: number;
  internalGain: number;
  conduction: number;
  ventilation: number;
  /** Net heat that must be removed (>0) or added (<0). */
  balance: number;
}

/* ------------------------------------------------------------------ */
/* DRDO PS-51 required outputs                                         */
/* ------------------------------------------------------------------ */

/**
 * One hour of the simulated day.
 *
 * WHY THIS EXISTS
 * The problem statement asks for three specific quantities, and this is the
 * structure that carries them:
 *
 *   1. predicted indoor temperature     → `indoorTemp` / `outdoorTemp`
 *   2. thermal energy from solar        → `solarGainW`
 *   3. heat flow from the ΔT across
 *      the envelope and openings        → `wallW` `roofW` `windowW` `ventilationW`
 *
 * SIGN CONVENTION
 * Every power is **positive into the zone**. A wall losing heat to a −15 °C
 * Ladakhi night reports a negative `wallW`; the same wall gaining heat at noon
 * reports a positive one. Keeping one convention means the terms can be summed
 * to `netW` and compared without the reader having to remember which way round
 * each one points.
 */
export interface HourlyThermalPoint {
  /** Local solar time, 0–23. */
  hour: number;
  /** Outdoor dry-bulb, °C. */
  outdoorTemp: number;
  /** Free-running indoor dry-bulb after thermal-mass damping, °C. */
  indoorTemp: number;
  /** Solar transmitted through glazing and absorbed, W. */
  solarGainW: number;
  /** Occupants and equipment, W. */
  internalGainW: number;
  /** Conduction through the opaque walls, W. */
  wallW: number;
  /** Conduction through the roof, W. */
  roofW: number;
  /**
   * Conduction through the ground floor, W.
   *
   * Driven by the **ground** temperature, not the outdoor air. Below about a
   * metre the ground sits near the site's annual mean temperature all year,
   * which is why a slab is a steady loss in a cold desert and a steady gain in
   * a hot one — and why the floor is the right place to put mass in Ladakh.
   */
  floorW: number;
  /** Conduction through the glazing, W. */
  windowW: number;
  /** Conduction through the door leaves, W. */
  doorW: number;
  /** Sensible ventilation + infiltration, W. */
  ventilationW: number;
  /**
   * Sum of every term above, W.
   *
   * This is the imbalance the building fabric is absorbing or releasing at that
   * hour — the `C_eff · dT/dt` side of the heat balance. It is the honest
   * measure of what thermal mass is doing, and it is deliberately not forced to
   * zero: the free-running indoor temperature is a *damped* response, so the
   * instantaneous balance is exactly what is charging or discharging the mass.
   */
  netW: number;
}

/**
 * A representative day's transient response, in the three quantities the
 * problem statement asks for.
 *
 * "Representative day" means the day the model already simulates for a given
 * month: monthly-mean conditions with the diurnal swing applied, evaluated hour
 * by hour. It is a model day, not a specific calendar date, and the UI says so.
 */
export interface DailyThermalProfile {
  /** Month 0–11 this day represents. */
  month: number;
  /** Day of the month used for the solar geometry. */
  day: number;
  points: HourlyThermalPoint[];

  /* ---- 1. Indoor temperature ---- */
  /** Free-running indoor minimum across the day, °C. */
  indoorMin: number;
  /** Free-running indoor maximum across the day, °C. */
  indoorMax: number;
  /** Mean free-running indoor temperature, °C. */
  indoorMean: number;
  /** Peak-to-trough indoor swing, K. */
  indoorSwing: number;
  /** The same swing outdoors, K — the ratio is what the mass buys. */
  outdoorSwing: number;
  /**
   * How much of the outdoor swing the fabric removed, 0–1.
   * 0 = the interior tracks the weather; 1 = completely flat.
   */
  swingDamping: number;

  /* ---- 2. Solar thermal gain ---- */
  /** Solar heat delivered to the zone over the day, kWh/day. */
  solarGainKwh: number;
  /** Solar gain per m² of floor, kWh/m²·day — the comparable figure. */
  solarGainPerSqm: number;
  /** The hour of peak solar gain. */
  solarPeakHour: number;
  /** Occupants and equipment over the day, kWh/day. */
  internalGainKwh: number;

  /* ---- 3. Heat flow through the envelope and openings ---- */
  /** Wall conduction over the day, kWh/day. Negative = net loss. */
  wallKwh: number;
  roofKwh: number;
  /** Ground-floor conduction over the day, kWh/day. */
  floorKwh: number;
  windowKwh: number;
  /** Door leaf conduction over the day, kWh/day. */
  doorKwh: number;
  ventilationKwh: number;
  /**
   * Total heat leaving through the envelope and openings, kWh/day, as a
   * magnitude — the headline "heat flow" figure. The daily loss and the daily
   * gain are separated because a single net number would report a
   * well-insulated shelter and a leaky one as identical whenever the two
   * happened to cancel.
   */
  heatLossKwh: number;
  /** Total heat entering from outside (solar excluded), kWh/day. */
  heatGainKwh: number;
  /**
   * Peak heat-flow rate, kW, and the hour it occurs — the sizing number.
   */
  peakFlowKw: number;
  peakFlowHour: number;
  /** Solar gain as a fraction of the day's heat loss. ≥ 1 means the sun alone covers the losses. */
  solarCoverage: number;
}

/** Aggregate comfort + energy result for a design. */
export interface ThermalComfort {
  /* ---- Free-running (passive) performance ------------------------- */
  /**
   * Representative FREE-RUNNING indoor temperature at the peak cooling month, °C.
   * This is the passive performance of the envelope with no active system, and
   * is the primary number that differentiates designs.
   */
  indoorTemperature: number;
  /** Min/max monthly mean free-running indoor temperature, °C. */
  indoorTemperatureRange: [number, number];
  /** Free-running comfort score at the peak cooling month, 0–100. */
  comfortScore: number;
  /** Mean free-running comfort score across the year, 0–100. */
  annualComfortScore: number;
  /** Free-running PMV at the peak cooling month (ISO 7730). */
  pmv: number;
  /** Free-running PPD, %. */
  ppd: number;

  /* ---- Conditioned state (system holding setpoint) ---------------- */
  /** Indoor temperature with the system running — the cooling setpoint, °C. */
  conditionedTemperature: number;
  /** Cooling setpoint the system holds, °C. */
  coolingSetpoint: number;
  /** Heating setpoint the system holds, °C. */
  heatingSetpoint: number;
  /** PMV once the system holds the setpoint. */
  conditionedPmv: number;
  /** PPD once the system holds the setpoint, %. */
  conditionedPpd: number;
  /** Comfort score in the conditioned state, 0–100. */
  conditionedComfortScore: number;

  /* ---- Shared psychrometrics -------------------------------------- */
  meanRadiantTemperature: number;
  relativeHumidity: number;
  airVelocity: number;
  operativeTemperature: number;
  /** ASHRAE 55 adaptive comfort temperature for the period, °C. */
  adaptiveComfortTemperature: number;

  /* ---- Energy ------------------------------------------------------ */
  /** Peak-day cooling energy, kWh/day. */
  coolingRequirement: number;
  /** Peak-day heating energy, kWh/day. */
  heatingRequirement: number;
  /** Peak-day total delivered energy, kWh/day. */
  energyConsumption: number;

  /** Annual cooling energy, kWh/year. */
  annualCoolingEnergy: number;
  annualHeatingEnergy: number;
  annualEnergy: number;
  /** Annual energy per m², kWh/m²/year. */
  energyUseIntensity: number;

  /** Peak cooling load, kW. */
  peakCoolingLoad: number;
  peakHeatingLoad: number;

  /* ---- Passive resilience ------------------------------------------ */
  /** % of annual hours inside the adaptive comfort band with no HVAC. */
  comfortHoursPct: number;
  overheatingHours: number;
  underheatingHours: number;

  /** Operational CO₂, tonnes/year. */
  co2TonnesPerYear: number;

  monthly: MonthlyThermalResult[];
  heatBalance: HeatBalance[];
  /**
   * The representative day's hour-by-hour response, for the month the design is
   * being judged on.
   *
   * Carried explicitly because the three quantities the problem statement asks
   * for — indoor temperature, solar gain and heat flow — are all *transient*
   * quantities. A monthly mean cannot show that a Ladakhi shelter reaches
   * 14 °C at noon and −8 °C by midnight, and that difference is the entire
   * engineering problem.
   */
  dailyProfile: DailyThermalProfile;
  provenance: ModelProvenance;
}

/** Comfort band used for scoring. */
export interface ComfortBand {
  /** Lower acceptable operative temperature, °C. */
  lower: number;
  /** Upper acceptable operative temperature, °C. */
  upper: number;
  /** Neutral/ideal operative temperature, °C. */
  neutral: number;
}

/** Inputs to a single PMV evaluation — exposed for the "how it works" panel. */
export interface PmvInputs {
  /** Metabolic rate, W/m² (1 met = 58.15 W/m²). */
  metabolicRate: number;
  /** External work, W/m². Usually 0. */
  externalWork: number;
  /** Clothing insulation, m²·K/W (1 clo = 0.155). */
  clothingInsulation: number;
  airTemperature: number;
  meanRadiantTemperature: number;
  /** Relative air velocity, m/s. */
  airVelocity: number;
  /** Relative humidity, %. */
  relativeHumidity: number;
}

/** Result of one PMV/PPD evaluation. */
export interface PmvResult {
  pmv: number;
  ppd: number;
  /** Solved clothing surface temperature, °C. */
  clothingSurfaceTemp: number;
  /** Convective heat transfer coefficient, W/m²·K. */
  convectiveCoefficient: number;
  /** Clothing area factor. */
  clothingAreaFactor: number;
  /** Partial water-vapour pressure, Pa. */
  vapourPressure: number;
  /** Sensation label, e.g. "Warm". */
  sensation: string;
}

/** A single optimisation candidate's evaluation, kept for the transparency panel. */
export interface CandidateEvaluation {
  id: string;
  label: string;
  /**
   * Why this candidate is on the shortlist, e.g. "Best overall",
   * "Lowest energy", "Cheapest to build". Set by the leaderboard builder.
   */
  lens?: string;
  parameters: import('./building').BuildingParameters;
  thermal: ThermalComfort;
  cost: number;
  /** Weighted objective — lower is better. */
  objective: number;
  /** Sub-scores, each already normalised 0–1 (lower is better). */
  discomfortScore: number;
  energyScore: number;
  costScore: number;
}
