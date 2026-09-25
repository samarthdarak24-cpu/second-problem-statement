/**
 * Simplified thermal comfort and energy model.
 *
 * WHAT THIS IS
 * A transparent, first-principles quasi-steady-state model. For each month it
 * simulates a representative day hour by hour, in two passes:
 *
 *   PASS 1 — build the 24-hour forcing series: outdoor dry-bulb, solar gain
 *            through each facade's glazing, and the SOL-AIR temperature of every
 *            opaque surface.
 *
 *   PASS 2 — solve the heat balance hour by hour, with opaque conduction passed
 *            through the construction's periodic response (decrement factor and
 *            time lag), ventilation sensible + latent load, internal gains on an
 *            occupancy schedule, and a first-order thermal-mass filter that damps
 *            the room's daily swing.
 *
 * Why the periodic response matters: a 160 mm concrete roof has a decrement
 * factor near 0.35 and a lag near 4 h, so its *peak* heat flow is roughly a
 * third of what U·ΔT(sol-air) alone would suggest, arriving in the late
 * afternoon. A metal sheet has a decrement near 1.0 and no lag. Without this,
 * every lightweight building looks identical to a heavyweight one and peak loads
 * are wildly overstated.
 *
 * WHAT THIS IS NOT
 * Not a validated dynamic simulation (EnergyPlus/IES). It does not resolve
 * thermal bridging, multi-zone airflow, latent storage or full 3D radiation
 * exchange. Results are directional design-comparison estimates, which is
 * exactly how the UI labels them. The whole model sits behind `simulateDesign`
 * so a validated engine can replace it without touching any UI code.
 */

import type {
  BuildingParameters,
  ClimateData,
  DailyThermalProfile,
  HeatBalance,
  HourlyThermalPoint,
  MonthlyThermalResult,
  ModelProvenance,
  ResolvedMaterials,
  ShelterGeometry,
  ThermalComfort,
} from '@/types';
import {
  AIR_DENSITY,
  DAYS_IN_MONTH,
  GRID_CO2_INTENSITY,
  HOURS_IN_YEAR,
  MONTH_MID_DAY,
  deg2rad,
  pressureAtElevation,
} from '@/utils/units';
import { clamp } from '@/lib/utils';
import {
  clearSkyIrradiance,
  clearnessFromDailyIrradiation,
  incidenceCosine,
  shadingExposure,
  solarPosition,
  sunVectorENU,
  surfaceNormalENU,
} from '@/utils/solar';
import {
  humidityRatio,
  moistAirCp,
  relativeHumidityFromRatio,
  saturationHumidityRatio,
} from '@/utils/psychrometrics';
import { effectiveUValues, diurnalArealCapacity } from './materials';
import {
  adaptiveComfortBand,
  calculatePmv,
  indoorAirVelocity,
  pmvToComfortScore,
  shelterPmvInputs,
} from './pmv';

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export const THERMAL_PROVENANCE: ModelProvenance = {
  modelType: 'simplified-monthly-heat-balance',
  label: 'Simplified quasi-steady-state model',
  disclaimer:
    'Model estimates from a transparent hourly-per-month heat balance — not validated dynamic simulation, and not measured data. Use for design comparison, not for compliance claims.',
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const H_OUT_WALL = 20;
const H_OUT_ROOF = 22;
const H_IN = 8;
/** Long-wave sky radiation loss from a horizontal surface, W/m². */
const DELTA_R_ROOF = 63;
/** Hour at which the outdoor temperature peaks. */
const PEAK_HOUR = 15;

const OCCUPANT_SENSIBLE_W = 75;
const OCCUPANT_LATENT_W = 50;
const EQUIPMENT_W_PER_M2 = 5;
const OCCUPANCY_DIVERSITY = 0.65;

const OCCUPIED_FROM = 7;
const OCCUPIED_TO = 23;

/**
 * Share of the floor area that is actually conditioned.
 * A shelter is rarely cooled or heated as a whole; the rest rides on the
 * free-running indoor temperature.
 */
const CONDITIONED_FRACTION = 0.65;

/**
 * Unavoidable leakage, in air changes per hour, present every hour of the year.
 * The design air-change rate above this is "purge capacity" — openings and fans
 * that are only used when they actually help.
 */
const INFILTRATION_ACH = 0.5;

/** Minimum temperature difference before purge ventilation is worth opening up for. */
const PURGE_DEADBAND = 1.5;

/** Seconds in a day — the period of the periodic response analysis. */
const PERIOD_SECONDS = 86400;

/**
 * Effective ground-coupled U-value of a slab-on-ground, W/m²K.
 *
 * Includes the soil's own resistance and edge losses, which is why it is so much
 * lower than the slab's material U-value (~5 W/m²K for 150 mm concrete). A slab
 * does not lose heat to "outside"; it loses it into a large thermal mass whose
 * surface temperature is the annual mean, and that mass is a poor conductor.
 *
 * 0.35 W/m²K is representative of an uninsulated slab with a normal perimeter.
 * Perimeter insulation would take it toward 0.25, which is a refinement this
 * model does not yet offer.
 */
const GROUND_FLOOR_U = 0.35;

/* ------------------------------------------------------------------ */
/* Roof solar exposure                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ground reflectance for the roof's reflected component. 0.2 is the standard
 * default for mixed grass and soil. A snow-covered cold-desert site would be
 * considerably higher, which would only *increase* the case for a pitched roof,
 * so being conservative here cannot flatter the design.
 */
const GROUND_REFLECTANCE = 0.2;

export interface RoofPlane {
  /** Plane tilt from horizontal, degrees. */
  tiltDeg: number;
  /** Plane azimuth — the direction the plane faces, degrees clockwise from north. */
  azimuthDeg: number;
  /** Share of the roof area on this plane. */
  weight: number;
}

/**
 * Break the roof into the planes the sun actually sees.
 *
 * WHY THIS EXISTS
 * An earlier version of this model treated every roof as horizontal: the
 * irradiance was a fixed blend of the global horizontal figure, and `roofType`
 * changed only the roof *area*. A pitched roof therefore had strictly more area
 * receiving the same irradiance, making it strictly worse — so the optimiser
 * chose a flat roof in every climate tested, including Leh, where the climate
 * engine was independently recommending a shed roof for winter solar collection.
 * Two parts of the same program disagreed with each other, and an entire design
 * axis was inert.
 *
 * A symmetric gable, hip or vaulted roof is split between an equator-facing and
 * an anti-equator plane. Modelling both and averaging by area is what makes the
 * form behave the way a designer expects: a pitched roof collects more winter
 * sun and more summer sun, and the trade-off between them becomes real rather
 * than assumed.
 *
 * This is still an approximation — a hip is not a gable, and a vault is curved —
 * but it is the right order of magnitude and, crucially, it responds to the
 * parameters instead of ignoring them.
 *
 * Exported because the heat-map visualisation needs the same answer: if the
 * picture disagrees with the physics the picture is decoration, not evidence.
 */
export function roofExposurePlanes(
  parameters: BuildingParameters,
  latitude: number,
): RoofPlane[] {
  const pitch = clamp(parameters.roofAngle, 0, 60);
  const equator = latitude >= 0 ? 180 : 0;

  switch (parameters.roofType) {
    case 'flat':
      return [{ tiltDeg: 0, azimuthDeg: 0, weight: 1 }];

    case 'shed':
      /* A mono-pitch roof faces one way. It is built facing the equator
         precisely when the point is to collect low winter sun. */
      return [{ tiltDeg: pitch, azimuthDeg: equator, weight: 1 }];

    case 'gable':
    case 'hip':
    case 'vaulted':
    default:
      return [
        { tiltDeg: pitch, azimuthDeg: equator, weight: 0.5 },
        { tiltDeg: pitch, azimuthDeg: (equator + 180) % 360, weight: 0.5 },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Periodic response of a construction                                 */
/* ------------------------------------------------------------------ */

export interface PeriodicResponse {
  /** Decrement factor: how much of the surface swing reaches the inside, 0–1. */
  decrement: number;
  /** Time lag between the outer peak and the inner peak, hours. */
  lagHours: number;
}

/**
 * Decrement factor and time lag for a single-layer construction, from the
 * standard periodic (24-hour) solution.
 *
 *   α = λ / (ρ·c)                       thermal diffusivity, m²/s
 *   φ = L · √(π / (α·P))                phase lag, radians
 *   decrement = e^(−φ),  lag = φ/2π · 24 hours
 *
 * Sanity check: 160 mm concrete → decrement ≈ 0.34, lag ≈ 4.1 h;
 * 300 mm rammed earth → ≈ 0.07, lag ≈ 10 h; 0.6 mm metal sheet → ≈ 1.00, lag ≈ 0.
 */
export function periodicResponse(
  conductivity: number,
  density: number,
  specificHeat: number,
  thickness: number,
): PeriodicResponse {
  const alpha = conductivity / Math.max(1e-9, density * specificHeat);
  if (!Number.isFinite(alpha) || alpha <= 0 || thickness <= 0) {
    return { decrement: 1, lagHours: 0 };
  }

  const phi = thickness * Math.sqrt(Math.PI / (alpha * PERIOD_SECONDS));
  return {
    decrement: clamp(Math.exp(-phi), 0, 1),
    lagHours: clamp((phi / (2 * Math.PI)) * 24, 0, 23),
  };
}

/** Interpolate a 24-hour series at a fractional hour offset in the past. */
function laggedValue(series: number[], hour: number, lagHours: number): number {
  const position = hour - lagHours;
  const base = Math.floor(position);
  const fraction = position - base;
  const size = series.length;
  const a = series[((base % size) + size) % size] ?? 0;
  const b = series[(((base + 1) % size) + size) % size] ?? 0;
  return a + (b - a) * fraction;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Outdoor dry-bulb at a given hour, sinusoidal between the month's min and max. */
function outdoorTempAtHour(minTemp: number, maxTemp: number, hour: number): number {
  const centre = (maxTemp + minTemp) / 2;
  const amplitude = (maxTemp - minTemp) / 2;
  return centre + amplitude * Math.cos((2 * Math.PI * (hour - PEAK_HOUR)) / 24);
}

/** Sol-air temperature, °C. */
function solAirTemperature(
  outdoorTemp: number,
  irradiance: number,
  solarAbsorptance: number,
  emissivity: number,
  hOut: number,
  deltaR: number,
): number {
  return outdoorTemp + (solarAbsorptance * irradiance) / hOut - (emissivity * deltaR) / hOut;
}

/** Occupant presence factor by hour — home overnight and in the evening. */
function occupancyFactor(hour: number): number {
  if (hour >= 23 || hour < 6) return 1.0;
  if (hour < 9) return 0.8;
  if (hour >= 18) return 0.9;
  return 0.35;
}

/* ------------------------------------------------------------------ */
/* The design-critical day                                             */
/* ------------------------------------------------------------------ */

/**
 * The hour-by-hour state of one month, as captured inside `simulateDesign`.
 *
 * Held separately from `DailyThermalProfile` because this is the *raw* capture
 * and the profile is the *reported* result: the profile resolves the flows
 * against the damped indoor temperature and aggregates them, which is work that
 * only needs doing for the one month that is actually shown.
 */
interface MonthlyHourlyCapture {
  month: number;
  day: number;
  /** Outdoor dry-bulb per hour, °C. */
  outdoor: number[];
  /** Damped free-running indoor temperature per hour, °C. */
  indoor: number[];
  /** Solar transmitted through glazing per hour, W. */
  solarW: number[];
  /** Occupants + equipment per hour, W. */
  internalW: number[];
  /** Sol-air driving temperature of the roof per hour, °C. */
  roofDriving: number[];
  /** Sol-air driving temperature of each wall panel per hour, °C. */
  wallDriving: number[][];
  /** Free-running air mass flow per hour, kg/s. */
  ventMassFlow: number[];
}

interface ProfileEnvelope {
  uaRoof: number;
  uaWindow: number;
  /** Door leaf conductance, W/K. */
  uaDoor: number;
  /** Ground-floor conductance, W/K. */
  uaFloor: number;
  /** Ground temperature, °C — the annual mean outdoor temperature. */
  groundTemp: number;
  /** One conductance per wall panel, W/K. */
  wallUa: number[];
  /** Moist-air specific heat, J/kg·K. */
  airCp: number;
  floorArea: number;
  critical: 'heating' | 'cooling';
}

/**
 * Resolve one month's hourly state into the three quantities DRDO asks for.
 *
 * THE HEAT FLOW TERMS
 * Each is the ΔT-driven conductance flow, resolved against the *indoor* air
 * temperature at that hour:
 *
 *   Q_wall  = Σᵢ UᵢAᵢ · (T_sol-air,i − T_in)
 *   Q_roof  = U·A    · (T_sol-air   − T_in)
 *   Q_win   = U·A    · (T_out       − T_in)
 *   Q_vent  = ṁ·c_p  · (T_out       − T_in)
 *
 * Sol-air temperature is used for the opaque surfaces rather than outdoor air
 * because that is what the conduction actually sees — it folds the absorbed
 * solar and the long-wave sky loss into one equivalent temperature. Using
 * outdoor air instead would hide the single largest reason a sunlit Ladakhi
 * wall behaves differently from a shaded one.
 *
 * LOSS AND GAIN ARE NOT NETTED
 * A day has both. Summing them into one number would report a tight shelter and
 * a leaky one as identical whenever the flows happened to cancel — which, over a
 * full day in a swing climate, they very nearly do. The two are kept apart and
 * the headline "heat flow" is the loss side, because in the cold case the loss
 * side is what has to be replaced.
 */
function buildDailyProfile(
  capture: MonthlyHourlyCapture,
  envelope: ProfileEnvelope,
): DailyThermalProfile {
  const points: HourlyThermalPoint[] = [];

  let solarKwh = 0;
  let internalKwh = 0;
  let wallKwh = 0;
  let roofKwh = 0;
  let floorKwh = 0;
  let windowKwh = 0;
  let doorKwh = 0;
  let ventilationKwh = 0;
  let heatLossKwh = 0;
  let heatGainKwh = 0;

  let peakFlowW = 0;
  let peakFlowHour = 0;
  let solarPeakW = -1;
  let solarPeakHour = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const outdoorTemp = capture.outdoor[hour] ?? 0;
    const indoorTemp = capture.indoor[hour] ?? outdoorTemp;

    const solarGainW = capture.solarW[hour] ?? 0;
    const internalGainW = capture.internalW[hour] ?? 0;
    const roofDriving = capture.roofDriving[hour] ?? outdoorTemp;
    const wallDriving = capture.wallDriving[hour] ?? [];
    const ventMassFlow = capture.ventMassFlow[hour] ?? 0;

    const roofW = envelope.uaRoof * (roofDriving - indoorTemp);
    const wallW = envelope.wallUa.reduce(
      (sum, ua, index) => sum + ua * ((wallDriving[index] ?? outdoorTemp) - indoorTemp),
      0,
    );
    const windowW = envelope.uaWindow * (outdoorTemp - indoorTemp);
    const doorW = envelope.uaDoor * (outdoorTemp - indoorTemp);
    /* The floor is driven by the ground, not the air — see `GROUND_FLOOR_U`. */
    const floorW = envelope.uaFloor * (envelope.groundTemp - indoorTemp);
    const ventilationW = ventMassFlow * envelope.airCp * (outdoorTemp - indoorTemp);

    const netW =
      solarGainW + internalGainW + wallW + roofW + floorW + windowW + doorW + ventilationW;

    points.push({
      hour,
      outdoorTemp,
      indoorTemp,
      solarGainW,
      internalGainW,
      wallW,
      roofW,
      floorW,
      windowW,
      doorW,
      ventilationW,
      netW,
    });

    solarKwh += solarGainW / 1000;
    internalKwh += internalGainW / 1000;
    wallKwh += wallW / 1000;
    roofKwh += roofW / 1000;
    floorKwh += floorW / 1000;
    windowKwh += windowW / 1000;
    doorKwh += doorW / 1000;
    ventilationKwh += ventilationW / 1000;

    for (const term of [wallW, roofW, floorW, windowW, doorW, ventilationW]) {
      if (term < 0) heatLossKwh += -term / 1000;
      else heatGainKwh += term / 1000;
    }

    const flowMagnitude =
      Math.abs(wallW) +
      Math.abs(roofW) +
      Math.abs(floorW) +
      Math.abs(windowW) +
      Math.abs(doorW) +
      Math.abs(ventilationW);
    if (flowMagnitude > peakFlowW) {
      peakFlowW = flowMagnitude;
      peakFlowHour = hour;
    }

    if (solarGainW > solarPeakW) {
      solarPeakW = solarGainW;
      solarPeakHour = hour;
    }
  }

  const indoorValues = points.map((p) => p.indoorTemp);
  const outdoorValues = points.map((p) => p.outdoorTemp);

  const indoorMin = Math.min(...indoorValues);
  const indoorMax = Math.max(...indoorValues);
  const indoorSwing = indoorMax - indoorMin;
  const outdoorSwing = Math.max(...outdoorValues) - Math.min(...outdoorValues);

  return {
    month: capture.month,
    day: capture.day,
    points,

    indoorMin,
    indoorMax,
    indoorMean: mean(indoorValues),
    indoorSwing,
    outdoorSwing,
    /* How much of the outdoor swing the fabric removed. This is the single
       number that says whether the thermal mass is earning its place: a
       lightweight panel shelter tracks the weather (near 0), a heavyweight
       earth shelter rides it out (near 1). */
    swingDamping: outdoorSwing > 0.05 ? clamp(1 - indoorSwing / outdoorSwing, 0, 1) : 1,

    solarGainKwh: solarKwh,
    solarGainPerSqm: envelope.floorArea > 0 ? solarKwh / envelope.floorArea : 0,
    solarPeakHour: solarPeakW > 0 ? solarPeakHour : 0,
    internalGainKwh: internalKwh,

    wallKwh,
    roofKwh,
    floorKwh,
    windowKwh,
    doorKwh,
    ventilationKwh,
    heatLossKwh,
    heatGainKwh,
    peakFlowKw: peakFlowW / 1000,
    peakFlowHour,
    /* Solar gain as a share of the day's losses. Above 1 means the sun alone
       covers everything the envelope and the openings take out — which is the
       whole design proposition of a passive-solar shelter in Ladakh. */
    solarCoverage: heatLossKwh > 1e-6 ? solarKwh / heatLossKwh : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Main simulation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Simulate a design against a climate and return comfort + energy results.
 */
export function simulateDesign(
  parameters: BuildingParameters,
  climate: ClimateData,
  materials: ResolvedMaterials,
  geometry: ShelterGeometry,
): ThermalComfort {
  const { location, monthly, summary } = climate;
  const pressure = pressureAtElevation(location.elevation);
  const u = effectiveUValues(materials, parameters.insulationThickness);

  const roofArea = geometry.roofArea;

  /* --- Envelope conductances, W/K ---------------------------------- */
  const uaRoof = u.roof * roofArea;
  const walls = geometry.walls.map((wall) => ({
    wall,
    ua: u.wall * wall.opaqueArea,
    normal: surfaceNormalENU(wall.azimuth, 90),
  }));
  const uaWallTotal = walls.reduce((sum, w) => sum + w.ua, 0);
  const uaWindow = u.window * geometry.glazingArea;
  /*
   * Doors get their own conductance.
   *
   * `wall.opaqueArea` excludes the door area (it is cut out of the panel), so
   * without this term the door is a hole in the thermal envelope that conducts
   * nothing at all — the single largest error a small shelter model can carry,
   * because the leaf is the worst element in it and the one the user is most
   * likely to change.
   */
  const uaDoor = u.door * geometry.doorArea;
  /*
   * Ground floor.
   *
   * The slab is the one envelope path whose driving temperature is not the
   * weather. Below roughly a metre the ground holds the site's ANNUAL MEAN
   * temperature all year, so a floor is a steady loss in a cold desert and a
   * steady gain in a hot one — the reverse of every other surface, and the
   * reason earth-sheltered and mass-floor strategies work in Ladakh.
   *
   * The conductance uses an effective ground-coupled U rather than the slab's
   * material U. The ground is itself an insulator: a 150 mm concrete slab has a
   * material U near 5 W/m²K, but the soil beneath it adds several m²K/W, so the
   * real steady loss is roughly an order of magnitude smaller. Using the
   * material U here would make the floor dominate the entire heat balance and
   * swamp every other design decision.
   */
  const uaFloor = GROUND_FLOOR_U * geometry.groundFloorArea;
  /** Deep-ground temperature — the annual mean air temperature. */
  const groundTemp = summary.avgTemperature;
  const uaOpaque = uaRoof + uaWallTotal;

  /* --- Periodic response of the opaque construction ---------------- */
  const wallResponse = periodicResponse(
    materials.wall.thermalConductivity,
    materials.wall.density,
    materials.wall.specificHeat,
    materials.wall.thickness,
  );
  const roofResponse = periodicResponse(
    materials.roof.thermalConductivity,
    materials.roof.density,
    materials.roof.specificHeat,
    Math.max(0.02, Math.min(0.3, materials.roof.thickness)),
  );

  /* --- Roof solar exposure ----------------------------------------- */
  /* The roof's planes depend only on the form and the site latitude, so they are
     resolved once rather than inside the hourly loop. */
  const roofPlanes = roofExposurePlanes(parameters, location.latitude);

  /* --- Ventilation ------------------------------------------------- */
  /*
   * Ventilation is split into two physically different streams:
   *
   *   INFILTRATION — unavoidable leakage, present every hour of the year.
   *   PURGE        — the openings and fans the design actually provides. These
   *                  only help when the space is too warm AND the outside air is
   *                  cooler than the space, so they are modulated hour by hour
   *                  rather than left wide open all winter.
   *
   * Treating the design air-change rate as a constant is the single most common
   * way a simplified model goes wrong: it ventilates a Ladakhi shelter at five
   * air changes in January, which no occupant would ever do, and it removes the
   * very mechanism that stops a tight, sunlit building from overheating.
   */
  const infiltrationAch = Math.min(INFILTRATION_ACH, parameters.airChangesPerHour);
  const purgeAch = Math.max(0, parameters.airChangesPerHour - infiltrationAch);
  const infiltrationMassFlow = (AIR_DENSITY * infiltrationAch * geometry.volume) / 3600;
  const purgeMassFlow = (AIR_DENSITY * purgeAch * geometry.volume) / 3600;
  const airCp = moistAirCp(0.01);
  /** Reference conductance at full purge — used for the thermal-mass time constant. */
  const uaVent = (infiltrationMassFlow + purgeMassFlow) * airCp;
  const uaTotal = Math.max(1e-3, uaOpaque + uaFloor + uaWindow + uaDoor + uaVent);

  /* --- Room thermal mass and swing damping ------------------------- */
  /*
   * The storage is evaluated at the site's annual mean temperature.
   *
   * For every ordinary construction this is irrelevant — storage is
   * temperature-independent — but a phase-change layer only stores its latent
   * heat while it is inside its melting band, so the reference temperature
   * decides whether the PCM contributes anything at all. The annual mean is the
   * honest single reference available before the year has been simulated: a
   * 24 °C PCM on a site that averages 5 °C will never charge, and the model says
   * so rather than assuming a benefit.
   */
  const heatCapacity = estimateHeatCapacity(geometry, materials, parameters, summary.avgTemperature);
  const tauHours = heatCapacity / Math.max(1, uaTotal * 3600);
  const swingRatio = 1 / Math.sqrt(1 + ((2 * Math.PI * tauHours) / 24) ** 2);

  /* --- Glazing view factor for the radiant blend ------------------- */
  const glazingFraction = geometry.glazingArea / Math.max(1, geometry.envelopeArea);
  const glazingView = clamp(glazingFraction * 1.5, 0, 0.5);
  const opaqueView = 1 - glazingView;

  const windowShgc = materials.window.shgc ?? 0.8;

  const monthlyResults: MonthlyThermalResult[] = [];
  const heatBalances: HeatBalance[] = [];
  /** Per-month driving surface temperatures, kept for the conditioned-state assessment. */
  const surfaceDrivers: Array<{ wall: number; roof: number; floor: number }> = [];
  /**
   * The hour-by-hour state of every month, retained so the design-critical day
   * can be reconstructed once the year is known.
   *
   * The critical day cannot be chosen before the loop runs: whether a shelter is
   * judged on its hottest or its coldest month is a *result* of the simulation,
   * not an input. A Ladakhi shelter is a heating problem and must be shown in
   * January; the same code applied to Chennai is a cooling problem and must be
   * shown in May. Capturing all twelve months costs 12 × 24 numbers and removes
   * the need to guess.
   */
  const monthlyHourly: MonthlyHourlyCapture[] = [];

  let annualCooling = 0;
  let annualHeating = 0;
  let comfortHours = 0;
  let overheatingHours = 0;
  let underheatingHours = 0;
  let peakCoolingLoad = 0;
  let peakHeatingLoad = 0;

  for (let month = 0; month < 12; month += 1) {
    const m = monthly[month]!;
    const day = MONTH_MID_DAY[month] ?? 180;
    const days = DAYS_IN_MONTH[month] ?? 30;

    const clearness = clearnessFromDailyIrradiation(m.solarRadiation, location.latitude, day);

    /* --- Indoor moisture, solved once per month -------------------- */
    /*
     * Moisture is a seasonal-average effect, so it is evaluated against a
     * representative air flow (leakage plus half the purge capacity) rather than
     * hour by hour. On a monthly mean the occupants' latent load is small next
     * to the ventilation term, so this is accurate enough and keeps the model
     * readable.
     */
    const representativeMassFlow = infiltrationMassFlow + 0.5 * purgeMassFlow;
    const wOut = humidityRatio(m.avgTemp, m.humidity, pressure);
    const occupantMoistureRate =
      (OCCUPANT_LATENT_W * parameters.numOccupants * OCCUPANCY_DIVERSITY) / 2.501e6;
    const wIn =
      representativeMassFlow > 1e-6
        ? wOut + occupantMoistureRate / representativeMassFlow
        : wOut + 0.004;
    const wInEffective = Math.min(wIn, saturationHumidityRatio(m.avgTemp, pressure) * 0.98);
    const wAtCoolingSetpoint = humidityRatio(parameters.coolingSetpoint, 50, pressure);

    /* Adaptive comfort band for this month's prevailing outdoor temperature —
       also used to decide when occupants would open up for purge ventilation. */
    const band = adaptiveComfortBand(m.avgTemp, 0.9);

    /* ============ PASS 1 — forcing series ======================== */
    const outdoorByHour: number[] = [];
    const glazingGainByHour: number[] = [];
    const internalGainByHour: number[] = [];
    const wallSolAirByHour: number[][] = walls.map(() => []);
    const roofSolAirByHour: number[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      const outdoorTemp = outdoorTempAtHour(m.minTemp, m.maxTemp, hour);
      outdoorByHour.push(outdoorTemp);

      const pos = solarPosition(location.latitude, day, hour);
      const sun = sunVectorENU(pos.altitude, pos.azimuth);
      const daylight = pos.altitude > 0;
      const sky = daylight
        ? clearSkyIrradiance(pos.altitude, day, clearness)
        : { directNormal: 0, diffuseHorizontal: 0, globalHorizontal: 0 };

      let glazingGainW = 0;

      walls.forEach((entry, index) => {
        const cosIncidence = daylight ? incidenceCosine(sun, entry.normal) : 0;
        const beamOnFacade = sky.directNormal * cosIncidence;

        if (entry.wall.glazingArea > 0 && daylight) {
          const exposure = shadingExposure(parameters.shadingType, {
            projection: parameters.shadingDepth,
            windowHeight: Math.max(0.6, parameters.height * 0.45),
            windowWidth: 1.4,
            solarAltitude: pos.altitude,
            facadeAzimuth: entry.wall.azimuth,
            sunAzimuth: pos.azimuth,
          });

          const diffuseOnWall = sky.diffuseHorizontal * 0.5 + sky.globalHorizontal * 0.1;
          const diffuseTransmission =
            parameters.shadingType === 'none'
              ? 1
              : parameters.shadingType === 'overhang' ||
                  parameters.shadingType === 'deep-verandah'
                ? 0.85
                : 0.6;

          glazingGainW +=
            (beamOnFacade * exposure + diffuseOnWall * diffuseTransmission) *
            entry.wall.glazingArea *
            windowShgc;
        }

        const surfaceIrradiance =
          beamOnFacade * 0.6 + (daylight ? sky.diffuseHorizontal * 0.4 : 0);

        wallSolAirByHour[index]?.push(
          solAirTemperature(
            outdoorTemp,
            surfaceIrradiance,
            materials.wall.solarAbsorptance,
            materials.wall.emissivity,
            H_OUT_WALL,
            0,
          ),
        );
      });

      /* --- Roof: area-weighted irradiance over the form's planes --------
       *
       * For a flat roof this reduces exactly to the global horizontal figure,
       * because `globalHorizontal = directNormal · sin(altitude) +
       * diffuseHorizontal` and at zero tilt the isotropic sky factor is 1 and
       * the ground-reflected term vanishes. So the correction is a strict
       * generalisation of the previous behaviour, not a change of convention.
       */
      let roofIrradiance = 0;
      for (const plane of roofPlanes) {
        const cosIncidence = daylight
          ? incidenceCosine(sun, surfaceNormalENU(plane.azimuthDeg, plane.tiltDeg))
          : 0;
        const tilt = deg2rad(plane.tiltDeg);
        const beam = sky.directNormal * cosIncidence;
        const diffuse = sky.diffuseHorizontal * ((1 + Math.cos(tilt)) / 2);
        const reflected =
          sky.globalHorizontal * GROUND_REFLECTANCE * ((1 - Math.cos(tilt)) / 2);
        roofIrradiance += plane.weight * (beam + diffuse + reflected);
      }

      roofSolAirByHour.push(
        solAirTemperature(
          outdoorTemp,
          roofIrradiance,
          materials.roof.solarAbsorptance,
          materials.roof.emissivity,
          H_OUT_ROOF,
          DELTA_R_ROOF,
        ),
      );

      glazingGainByHour.push(glazingGainW);

      const presence = occupancyFactor(hour);
      internalGainByHour.push(
        parameters.numOccupants * presence * OCCUPANT_SENSIBLE_W +
          geometry.floorArea * EQUIPMENT_W_PER_M2 * (0.4 + 0.6 * presence),
      );
    }

    /* ============ PASS 2 — solve the balance ===================== */
    const wallSolAirMean = wallSolAirByHour.map((series) => mean(series));
    const roofSolAirMean = mean(roofSolAirByHour);

    const steadyIndoor: number[] = [];
    const coolingWatts: number[] = [];
    const heatingWatts: number[] = [];

    /* Hourly drivers retained for the daily profile. The profile has to be built
       against the *damped* indoor temperature, which is not known until after
       this loop — so the driving temperatures are stored here rather than the
       flows being accumulated now. */
    const roofDrivingByHour: number[] = [];
    const wallDrivingByHour: number[][] = [];
    const ventMassFlowByHour: number[] = [];

    let monthSolarKwh = 0;
    let monthInternalKwh = 0;
    let monthConductionKwh = 0;
    let monthVentilationKwh = 0;

    for (let hour = 0; hour < 24; hour += 1) {
      const outdoorTemp = outdoorByHour[hour] ?? m.avgTemp;

      /* Conduction driving temperatures, passed through decrement + lag.
         T_eff = T_mean + DF · (T(t − lag) − T_mean)                          */
      const roofDriving =
        roofSolAirMean +
        roofResponse.decrement *
          (laggedValue(roofSolAirByHour, hour, roofResponse.lagHours) - roofSolAirMean);

      const wallDriving = wallSolAirByHour.map((series, index) => {
        const seriesMean = wallSolAirMean[index] ?? outdoorTemp;
        return (
          seriesMean +
          wallResponse.decrement *
            (laggedValue(series, hour, wallResponse.lagHours) - seriesMean)
        );
      });

      const glazingGainW = glazingGainByHour[hour] ?? 0;
      const internalGainW = internalGainByHour[hour] ?? 0;

      /* --- Free-float indoor temperature -------------------------- */
      /* Solve the steady balance for an arbitrary ventilation flow, so the purge
         decision below can be made by comparing two candidate solutions. */
      const solveFloat = (massFlow: number): number => {
        const uaVentHour = massFlow * airCp;
        let numerator =
          glazingGainW +
          internalGainW +
          uaRoof * roofDriving +
          uaFloor * groundTemp +
          (uaWindow + uaDoor + uaVentHour) * outdoorTemp;
        walls.forEach((entry, index) => {
          numerator += entry.ua * (wallDriving[index] ?? outdoorTemp);
        });
        return numerator / Math.max(1e-3, uaOpaque + uaFloor + uaWindow + uaDoor + uaVentHour);
      };

      /* Windows shut: what the space does with nothing but leakage. */
      const steadyClosed = solveFloat(infiltrationMassFlow);

      /* Free-running: occupants open up when the space is above the comfort band
         and the outside air is genuinely cooler. */
      let steady = steadyClosed;
      let ventMassFlowFree = infiltrationMassFlow;
      if (purgeMassFlow > 0 && steadyClosed > band.upper && outdoorTemp < steadyClosed - PURGE_DEADBAND) {
        const purged = solveFloat(infiltrationMassFlow + purgeMassFlow);
        if (purged < steady) {
          steady = purged;
          ventMassFlowFree = infiltrationMassFlow + purgeMassFlow;
        }
      }

      steadyIndoor.push(steady);

      /* Retain this hour's drivers and the free-running air flow, so the daily
         profile can be resolved against the damped indoor temperature below. */
      roofDrivingByHour.push(roofDriving);
      wallDrivingByHour.push(wallDriving);
      ventMassFlowByHour.push(ventMassFlowFree);

      /* --- Load to hold the setpoints ----------------------------- */
      /*
       * MIXED-MODE OPERATION, and this distinction is the whole reason the model
       * does not produce perverse answers.
       *
       * Free-running and conditioned are two different buildings. While the space
       * rides on the weather the openings are used freely — that is what keeps
       * the indoor temperature near the outdoor one. The moment the plant has to
       * run, the occupants close up: you do not leave a window open next to a
       * running air-conditioner, and a model that assumes you do will conclude
       * that ventilation is a waste of energy and recommend sealing a building in
       * a hot climate.
       *
       * The one exception is an economiser cycle, and it is gated on the space
       * actually wanting cooling. Without that gate, a cold climate looks like a
       * permanent economiser opportunity — every winter hour is "outside air
       * cooler than the setpoint" — and the model flushes a Ladakhi shelter at
       * full purge rate in January.
       */
      const needsCooling = steady > parameters.coolingSetpoint;
      const economiser =
        needsCooling && purgeMassFlow > 0 && outdoorTemp < parameters.coolingSetpoint - 2;
      const ventMassFlowHour = economiser
        ? infiltrationMassFlow + purgeMassFlow
        : infiltrationMassFlow;

      const uaVentHour = ventMassFlowHour * airCp;
      const uaHour = uaOpaque + uaFloor + uaWindow + uaDoor + uaVentHour;
      const gainTerms =
        glazingGainW +
        internalGainW +
        uaRoof * roofDriving +
        uaFloor * groundTemp +
        (uaWindow + uaDoor + uaVentHour) * outdoorTemp +
        walls.reduce(
          (sum, entry, index) => sum + entry.ua * (wallDriving[index] ?? outdoorTemp),
          0,
        );

      const sensibleToCool = gainTerms - uaHour * parameters.coolingSetpoint;
      const sensibleToHeat = gainTerms - uaHour * parameters.heatingSetpoint;

      /* Only the conditioned share of the plan is actually served. */
      const operation = occupancyFactor(hour) >= 0.5 ? CONDITIONED_FRACTION : 0;

      if (sensibleToCool > 0) {
        const latentW =
          ventMassFlowHour > 0
            ? Math.max(0, ventMassFlowHour * (wOut - wAtCoolingSetpoint) * 2.501e6)
            : 0;
        coolingWatts.push((sensibleToCool + latentW) * operation);
        heatingWatts.push(0);
      } else if (sensibleToHeat < 0) {
        coolingWatts.push(0);
        heatingWatts.push(-sensibleToHeat * operation);
      } else {
        coolingWatts.push(0);
        heatingWatts.push(0);
      }

      /* Heat-balance diagnostics, kWh for this hour.
         Reported against the FREE-RUNNING air flow, because the balance is meant
         to explain the free-running temperature above — not the closed-up
         building the plant sees. */
      monthSolarKwh += glazingGainW / 1000;
      monthInternalKwh += internalGainW / 1000;
      monthVentilationKwh += ((ventMassFlowFree * airCp) * (outdoorTemp - steady)) / 1000;
      monthConductionKwh +=
        (uaRoof * (roofDriving - steady) +
          uaFloor * (groundTemp - steady) +
          uaWindow * (outdoorTemp - steady) +
          uaDoor * (outdoorTemp - steady) +
          walls.reduce(
            (sum, entry, index) =>
              sum + entry.ua * ((wallDriving[index] ?? outdoorTemp) - steady),
            0,
          )) /
        1000;
    }

    /* --- Room thermal-mass damping of the indoor swing ------------ */
    const steadyMean = mean(steadyIndoor);
    const damped = steadyIndoor.map((t) => steadyMean + swingRatio * (t - steadyMean));
    const dampedMean = mean(damped);
    const dampedPeak = Math.max(...damped);

    /* --- Adaptive comfort hours ----------------------------------- */
    let monthComfort = 0;
    let monthOver = 0;
    let monthUnder = 0;
    for (const t of damped) {
      if (t > band.upper) monthOver += 1;
      else if (t < band.lower) monthUnder += 1;
      else monthComfort += 1;
    }
    comfortHours += monthComfort * days;
    overheatingHours += monthOver * days;
    underheatingHours += monthUnder * days;

    /* --- Energy ---------------------------------------------------- */
    const coolingThermalKwh = coolingWatts.reduce((a, b) => a + b, 0) / 1000;
    const heatingThermalKwh = heatingWatts.reduce((a, b) => a + b, 0) / 1000;
    const deliveredCooling = coolingThermalKwh / Math.max(1, parameters.coolingCop);
    const deliveredHeating = heatingThermalKwh / Math.max(0.5, parameters.heatingEfficiency);

    annualCooling += deliveredCooling * days;
    annualHeating += deliveredHeating * days;

    const monthPeakCooling = Math.max(...coolingWatts) / 1000;
    const monthPeakHeating = Math.max(...heatingWatts) / 1000;
    peakCoolingLoad = Math.max(peakCoolingLoad, monthPeakCooling);
    peakHeatingLoad = Math.max(peakHeatingLoad, monthPeakHeating);

    /* --- Comfort assessment over occupied hours -------------------- */
    const occupiedIndoor = damped.filter((_, h) => h >= OCCUPIED_FROM && h < OCCUPIED_TO);
    const occupiedMeanIndoor = occupiedIndoor.length > 0 ? mean(occupiedIndoor) : dampedMean;

    const indoorRh = clamp(
      relativeHumidityFromRatio(
        occupiedMeanIndoor,
        Math.min(wInEffective, saturationHumidityRatio(occupiedMeanIndoor, pressure) * 0.98),
        pressure,
      ),
      10,
      100,
    );

    /* Inside surface temperatures: T_si = T_air + (T_driving − T_air)·(U/h_in) */
    const meanWallDriving = mean(wallSolAirMean);
    const wallSurfaceTemp =
      occupiedMeanIndoor + (meanWallDriving - occupiedMeanIndoor) * clamp(u.wall / H_IN, 0, 0.9);
    const roofSurfaceTemp =
      occupiedMeanIndoor + (roofSolAirMean - occupiedMeanIndoor) * clamp(u.roof / H_IN, 0, 0.9);
    const glazingSurfaceTemp =
      occupiedMeanIndoor + (m.avgTemp - occupiedMeanIndoor) * clamp(u.window / H_IN, 0, 0.95);
    const floorSurfaceTemp = 0.5 * summary.avgTemperature + 0.5 * m.avgTemp + 1.5;

    const meanRadiantTemp =
      roofSurfaceTemp * opaqueView * 0.33 +
      wallSurfaceTemp * opaqueView * 0.42 +
      floorSurfaceTemp * opaqueView * 0.25 +
      glazingSurfaceTemp * glazingView;

    const pmv = calculatePmv(
      shelterPmvInputs({
        airTemperature: occupiedMeanIndoor,
        meanRadiantTemperature: meanRadiantTemp,
        relativeHumidity: indoorRh,
        airChangesPerHour: parameters.airChangesPerHour,
        outdoorTemperature: m.avgTemp,
      }),
    );

    const mode: MonthlyThermalResult['mode'] =
      monthPeakCooling > 0.05 && monthPeakHeating > 0.05
        ? 'mixed'
        : monthPeakCooling > 0.05
          ? 'cooling'
          : monthPeakHeating > 0.05
            ? 'heating'
            : 'free';

    monthlyResults.push({
      month,
      outdoorTemp: m.avgTemp,
      freeFloatTemp: dampedMean,
      indoorTemp: dampedMean,
      peakIndoorTemp: dampedPeak,
      relativeHumidity: indoorRh,
      meanRadiantTemp,
      airVelocity: indoorAirVelocity(parameters.airChangesPerHour),
      pmv: pmv.pmv,
      ppd: pmv.ppd,
      comfortScore: pmvToComfortScore(pmv.pmv, pmv.ppd),
      coolingEnergy: deliveredCooling,
      heatingEnergy: deliveredHeating,
      peakCoolingLoad: monthPeakCooling,
      peakHeatingLoad: monthPeakHeating,
      comfortHoursPct: (monthComfort / 24) * 100,
      mode,
    });

    heatBalances.push({
      solarGain: monthSolarKwh,
      internalGain: monthInternalKwh,
      conduction: monthConductionKwh,
      ventilation: monthVentilationKwh,
      balance: monthSolarKwh + monthInternalKwh + monthConductionKwh + monthVentilationKwh,
    });

    /* Everything the design-critical day will need, for this month. */
    monthlyHourly.push({
      month,
      day: MONTH_MID_DAY[month] ?? 180,
      outdoor: outdoorByHour,
      /* The damped series, because that is the indoor temperature the model
         reports everywhere else — building the profile against the undamped
         steady solution would overstate the swing it exists to measure. */
      indoor: damped,
      solarW: glazingGainByHour,
      internalW: internalGainByHour,
      roofDriving: roofDrivingByHour,
      wallDriving: wallDrivingByHour,
      ventMassFlow: ventMassFlowByHour,
    });

    surfaceDrivers.push({
      wall: meanWallDriving,
      roof: roofSolAirMean,
      floor: floorSurfaceTemp,
    });
  }

  /* --- The design-critical day ------------------------------------- */
  /*
   * Which month the shelter is actually judged on.
   *
   * This is a result, not an input. A building whose annual heating demand
   * exceeds its cooling demand is a *heating* problem, and the month that
   * decides whether it works is the coldest one — for a Ladakhi shelter that is
   * January, and a model that showed it in May would be answering a question
   * nobody asked. The reverse holds for Chennai.
   *
   * Everything DRDO asks for is transient — an indoor temperature that peaks at
   * noon and collapses after sunset, a solar gain that exists only in daylight,
   * a heat flow that reverses sign twice a day — so the profile is built for
   * this one month and reported hour by hour.
   */
  const heatingDominated = annualHeating > annualCooling;
  const criticalMonth = heatingDominated ? summary.peakHeatingMonth : summary.peakCoolingMonth;
  const criticalCapture = monthlyHourly[criticalMonth] ?? monthlyHourly[0]!;

  const dailyProfile = buildDailyProfile(criticalCapture, {
    uaRoof,
    uaWindow,
    uaDoor,
    uaFloor,
    groundTemp,
    wallUa: walls.map((entry) => entry.ua),
    airCp,
    floorArea: geometry.floorArea,
    critical: heatingDominated ? 'heating' : 'cooling',
  });

  /* --- Aggregate ---------------------------------------------------- */
  const peakMonth = summary.peakCoolingMonth;
  const peakResult = monthlyResults[peakMonth] ?? monthlyResults[0]!;
  const indoorTemps = monthlyResults.map((r) => r.indoorTemp);
  const annualEnergy = annualCooling + annualHeating;

  /* --- Conditioned-state comfort ------------------------------------ */
  /*
   * With the system running, the air sits at the cooling setpoint — but the
   * surfaces around the occupant do not. A well-shaded, insulated envelope runs
   * its inner surfaces close to air temperature, so the occupant's mean radiant
   * temperature is near the setpoint and PMV lands near neutral. A poorly
   * shaded, uninsulated envelope still radiates heat from hot surfaces even
   * though the thermostat reads 26 °C — that penalty is what the conditioned
   * PMV exposes, and it is the reason envelope quality matters even in a
   * fully air-conditioned shelter.
   */
  const peakDriver = surfaceDrivers[peakMonth] ?? surfaceDrivers[0]!;
  const peakMonthOutdoor = monthly[peakMonth]?.avgTemp ?? summary.avgTemperature;
  const conditionedAirTemp = parameters.coolingSetpoint;

  const condWallSurface =
    conditionedAirTemp + (peakDriver.wall - conditionedAirTemp) * clamp(u.wall / H_IN, 0, 0.9);
  const condRoofSurface =
    conditionedAirTemp + (peakDriver.roof - conditionedAirTemp) * clamp(u.roof / H_IN, 0, 0.9);
  const condGlazingSurface =
    conditionedAirTemp +
    (peakMonthOutdoor - conditionedAirTemp) * clamp(u.window / H_IN, 0, 0.95);

  const conditionedMrt =
    condRoofSurface * opaqueView * 0.33 +
    condWallSurface * opaqueView * 0.42 +
    peakDriver.floor * opaqueView * 0.25 +
    condGlazingSurface * glazingView;

  /* A conditioned space is dehumidified to roughly 50 % RH at the setpoint. */
  const conditionedRh = clamp(
    relativeHumidityFromRatio(
      conditionedAirTemp,
      humidityRatio(conditionedAirTemp, 50, pressure),
      pressure,
    ),
    20,
    70,
  );

  const conditionedPmvResult = calculatePmv(
    shelterPmvInputs({
      airTemperature: conditionedAirTemp,
      meanRadiantTemperature: conditionedMrt,
      relativeHumidity: conditionedRh,
      airChangesPerHour: parameters.airChangesPerHour,
      outdoorTemperature: peakMonthOutdoor,
    }),
  );

  return {
    indoorTemperature: peakResult.indoorTemp,
    indoorTemperatureRange: [Math.min(...indoorTemps), Math.max(...indoorTemps)],
    comfortScore: peakResult.comfortScore,
    annualComfortScore: mean(monthlyResults.map((r) => r.comfortScore)),
    pmv: peakResult.pmv,
    ppd: peakResult.ppd,

    conditionedTemperature: conditionedAirTemp,
    coolingSetpoint: parameters.coolingSetpoint,
    heatingSetpoint: parameters.heatingSetpoint,
    conditionedPmv: conditionedPmvResult.pmv,
    conditionedPpd: conditionedPmvResult.ppd,
    conditionedComfortScore: pmvToComfortScore(
      conditionedPmvResult.pmv,
      conditionedPmvResult.ppd,
    ),

    meanRadiantTemperature: peakResult.meanRadiantTemp,
    relativeHumidity: peakResult.relativeHumidity,
    airVelocity: peakResult.airVelocity,
    operativeTemperature: (peakResult.indoorTemp + peakResult.meanRadiantTemp) / 2,
    adaptiveComfortTemperature: adaptiveComfortBand(
      monthly[peakMonth]?.avgTemp ?? summary.avgTemperature,
      0.9,
    ).neutral,

    coolingRequirement: peakResult.coolingEnergy,
    heatingRequirement: peakResult.heatingEnergy,
    energyConsumption: peakResult.coolingEnergy + peakResult.heatingEnergy,

    annualCoolingEnergy: annualCooling,
    annualHeatingEnergy: annualHeating,
    annualEnergy,
    energyUseIntensity: annualEnergy / Math.max(1, geometry.floorArea),

    peakCoolingLoad,
    peakHeatingLoad,

    comfortHoursPct: (comfortHours / HOURS_IN_YEAR) * 100,
    overheatingHours,
    underheatingHours,

    co2TonnesPerYear: (annualEnergy * GRID_CO2_INTENSITY) / 1000,

    monthly: monthlyResults,
    heatBalance: heatBalances,
    dailyProfile,
    provenance: THERMAL_PROVENANCE,
  };
}

/* ------------------------------------------------------------------ */
/* Thermal mass                                                        */
/* ------------------------------------------------------------------ */

/**
 * Effective heat capacity taking part in the DAILY cycle, J/K.
 *
 * The per-layer physics — penetration depth, and the apparent specific heat of a
 * phase-change layer — lives in `thermal/materials.ts`, because it is a property
 * of the construction rather than of this model. This function only decides how
 * much *area* of each construction is exposed and adds the contents.
 *
 * WHY THE WHOLE MASS IS NOT USED
 * Only the outer skin of a thick wall follows the daily swing. Using the full
 * thickness inflates the time constant by about 4× and over-damps the room to
 * the point where the model reports a Ladakhi shelter swinging **0.6 K across a
 * 15 K day** — which is not a conservative estimate, it is a wrong one, and it
 * erases the very mechanism the problem statement is about.
 *
 * The evaluation temperature is the month's free-running mean, which is what
 * decides whether a phase-change layer ever enters its melting band. That is a
 * deliberate simplification: a lumped model has one temperature, not a profile
 * through the build-up, so placement within the stack cannot be resolved. See
 * `thermal/assemblies.ts` for what that costs.
 */
function estimateHeatCapacity(
  geometry: ShelterGeometry,
  materials: ResolvedMaterials,
  parameters: BuildingParameters,
  atTemperatureC: number,
): number {
  const wallMass = geometry.wallArea * diurnalArealCapacity(materials.wall, atTemperatureC);

  const roofMass = geometry.roofArea * diurnalArealCapacity(materials.roof, atTemperatureC);

  /* Ground slab: concrete properties, its own diurnal depth. The ground beneath
     is a near-constant-temperature sink, so the slab is the most useful place to
     put mass in a cold climate. */
  const floorMass = geometry.groundFloorArea * diurnalArealCapacity(CONCRETE_SLAB, atTemperatureC);

  const insulationMass =
    parameters.insulationThickness > 0
      ? geometry.wallArea *
        diurnalArealCapacity(materials.insulation, atTemperatureC) *
        (parameters.insulationThickness / Math.max(1e-3, materials.insulation.thickness))
      : 0;

  const partitionMass =
    geometry.partitions.reduce((sum, p) => sum + p.length * p.height, 0) *
    diurnalArealCapacity(INTERNAL_PARTITION, atTemperatureC);

  /* Contents — light, thin and fully coupled to the air, so all of it counts. */
  const furnitureMass = geometry.floorArea * 60 * 1000;

  return wallMass + roofMass + floorMass + insulationMass + partitionMass + furnitureMass;
}

/** Ground slab, as a pseudo-material for the storage calculation. */
const CONCRETE_SLAB: ResolvedMaterials['wall'] = {
  id: 'slab',
  name: 'Concrete slab',
  category: 'floor',
  thermalConductivity: 1.4,
  thickness: 0.1,
  uValue: 0.35,
  cost: 0,
  density: 2400,
  specificHeat: 880,
  solarAbsorptance: 0.6,
  emissivity: 0.9,
  color: '#b9b3a8',
  roughness: 0.95,
  metalness: 0,
  note: 'Ground slab.',
};

/** Internal partition, as a pseudo-material for the storage calculation. */
const INTERNAL_PARTITION: ResolvedMaterials['wall'] = {
  id: 'partition',
  name: 'Internal partition',
  category: 'wall',
  thermalConductivity: 0.8,
  thickness: 0.1,
  uValue: 1.6,
  cost: 0,
  density: 1900,
  specificHeat: 880,
  solarAbsorptance: 0.5,
  emissivity: 0.9,
  color: '#cfc8bd',
  roughness: 0.9,
  metalness: 0,
  note: 'Internal partition.',
};

/** Model constants, exposed for the UI's "how this works" panel. */
export const MODEL_CONSTANTS = {
  H_OUT_WALL,
  H_OUT_ROOF,
  H_IN,
  DELTA_R_ROOF,
  PEAK_HOUR,
  OCCUPANT_SENSIBLE_W,
  OCCUPANT_LATENT_W,
  EQUIPMENT_W_PER_M2,
  OCCUPANCY_DIVERSITY,
  OCCUPIED_FROM,
  OCCUPIED_TO,
  CONDITIONED_FRACTION,
} as const;
