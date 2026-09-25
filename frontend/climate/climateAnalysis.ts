/**
 * Climate Analysis Engine.
 *
 * Converts raw climate data into a design strategy: the dominant thermal
 * challenge, and the ventilation, insulation, shading, glazing, roof and
 * orientation responses that answer it. Every decision carries a plain-language
 * reason so the UI can explain itself.
 *
 * The orientation recommendation is not a lookup table — it is a scored search
 * over candidate azimuths, evaluated with the solar engine. The building is
 * rotated in 15° steps and, for each candidate, the annual cooling-season and
 * heating-season solar gain through the glazing is integrated from the sun path,
 * weighted by how well each facade can be shaded. The orientation that best
 * matches the climate's cooling/heating balance wins.
 */

import type {
  BuildingParameters,
  ClimateAnalysis,
  ClimateData,
  ClimateZone,
  DesignRationale,
  FacadeWeights,
  GlazingType,
  InsulationLevel,
  RoofStrategy,
  ShadingStrategy,
  ThermalChallenge,
  VentilationStrategy,
} from '@/types';
import { MONTH_MID_DAY, deg2rad, normalizeDeg } from '@/utils/units';
import { clamp } from '@/lib/utils';
import { INSULATION_LEVEL_THICKNESS, VENTILATION_ACH } from '@/thermal/constants';
import { seasonalFacadeGain } from './facadeIrradiance';

/* ------------------------------------------------------------------ */
/* Facade preference models                                            */
/* ------------------------------------------------------------------ */

/**
 * How much glazing each compass direction should attract, per climate zone.
 * Values are relative weights, not shares.
 */
const FACADE_PREFERENCE: Record<ClimateZone, FacadeWeights> = {
  // Avoid low-angle east/west sun; south is shadeable.
  'hot-dry': { north: 1.0, east: 0.55, south: 0.7, west: 0.45 },
  // Openings wanted on every orientation to drive cross-ventilation.
  'hot-humid': { north: 0.8, east: 1.0, south: 0.8, west: 1.0 },
  'warm-humid': { north: 0.85, east: 1.0, south: 0.85, west: 1.0 },
  // South for winter gain, shaded in summer; east/west suppressed.
  composite: { north: 0.9, east: 0.6, south: 1.0, west: 0.55 },
  temperate: { north: 0.9, east: 0.85, south: 1.0, west: 0.85 },
  // Glazing follows the sun; north is minimised.
  'cold-sunny': { north: 0.5, east: 0.85, south: 1.3, west: 0.8 },
  'cold-cloudy': { north: 0.7, east: 0.9, south: 1.15, west: 0.85 },
  'cold-desert': { north: 0.5, east: 0.9, south: 1.35, west: 0.85 },
};

/** Interpolate a cardinal-weighted preference to an arbitrary azimuth. */
function preferenceAt(weights: FacadeWeights, azimuthDeg: number): number {
  const az = normalizeDeg(azimuthDeg);
  const anchors: Array<[number, number]> = [
    [0, weights.north],
    [90, weights.east],
    [180, weights.south],
    [270, weights.west],
    [360, weights.north],
  ];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [a0, v0] = anchors[i]!;
    const [a1, v1] = anchors[i + 1]!;
    if (az >= a0 && az <= a1) {
      const t = (az - a0) / (a1 - a0);
      return v0 + (v1 - v0) * t;
    }
  }
  return weights.north;
}

/**
 * How much a facade's cooling-season gain is actually avoidable with shading.
 * Equator-facing facades are easy to shade with an overhang (high noon sun);
 * east and west facades are not (low sun), so their gain is penalised harder.
 */
function shadeabilityPenalty(azimuthDeg: number, latitude: number): number {
  const equatorAz = latitude >= 0 ? 180 : 0;
  const raw = Math.abs(normalizeDeg(azimuthDeg - equatorAz + 180) - 180);
  const distance = Math.min(180, raw);

  if (distance <= 90) {
    // Equator-facing (0.5, easy) → east/west (1.0, hard)
    return 0.5 + (distance / 90) * 0.5;
  }
  // Pole-facing: little direct sun, so a moderate penalty.
  return 1.0 - ((distance - 90) / 90) * 0.25;
}

/* ------------------------------------------------------------------ */
/* Orientation search                                                  */
/* ------------------------------------------------------------------ */

export interface OrientationSearchEntry {
  orientation: number;
  /** Weighted, shadeability-adjusted cooling-season gain. */
  coolingObjective: number;
  /** Heating-season gain on the same glazing distribution. */
  heatingObjective: number;
  /** Lower is better. */
  objective: number;
  facadeAzimuths: { longA: number; longB: number; shortA: number; shortB: number };
  glazingShares: { longA: number; longB: number; shortA: number; shortB: number };
}

export interface OrientationSearchResult {
  orientation: number;
  /** Every candidate, sorted best-first. */
  ranking: OrientationSearchEntry[];
  /** Cooling and heating weights used, 0–1. */
  coolingWeight: number;
  heatingWeight: number;
  /** Human-readable summary of the winning move. */
  explanation: string;
}

/**
 * Score every candidate orientation and return the best.
 *
 * Facade geometry at a given orientation (local +Z is the length axis):
 *   longA  = local +X, azimuth = orientation − 90, span = building length
 *   longB  = local −X, azimuth = orientation + 90, span = building length
 *   shortA = local +Z, azimuth = orientation,      span = building width
 *   shortB = local −Z, azimuth = orientation + 180, span = building width
 */
export function searchOrientation(
  climate: ClimateData,
  width = 8,
  length = 10,
  stepDeg = 15,
): OrientationSearchResult {
  const { location, monthly, summary } = climate;
  /*
   * The zone comes from the resolved climate payload, not from re-classifying
   * the monthly data here.
   *
   * Re-deriving it was a real bug, not just duplication: the payload's zone is
   * the hand-checked one for a catalogue station, while a local re-classification
   * runs the Köppen heuristic over the same months. When the two disagreed, the
   * header badge showed the stored zone and the recommendations were built for
   * the derived one — so Jodhpur displayed "Hot desert" while the orientation
   * search steered glazing away from the west as though it were a cold highland.
   * One zone, one source.
   */
  const preference = FACADE_PREFERENCE[climate.climateZone];

  const monthlySolar = monthly.map((m) => m.solarRadiation);
  const monthlyTemps = monthly.map((m) => m.avgTemp);

  // Weight cooling against heating from the annual degree-day balance.
  const coolingDemand = summary.peakCoolingMonth >= 0
    ? monthly.reduce((sum, m) => sum + Math.max(0, m.avgTemp - 22), 0)
    : 0;
  const heatingDemand = monthly.reduce((sum, m) => sum + Math.max(0, 18 - m.avgTemp), 0);
  const totalDemand = coolingDemand + heatingDemand;
  const coolingWeight = totalDemand > 0 ? coolingDemand / totalDemand : 0.5;
  const heatingWeight = totalDemand > 0 ? heatingDemand / totalDemand : 0.5;

  const ranking: OrientationSearchEntry[] = [];

  for (let orientation = 0; orientation < 360; orientation += stepDeg) {
    const facadeAzimuths = {
      longA: normalizeDeg(orientation - 90),
      longB: normalizeDeg(orientation + 90),
      shortA: normalizeDeg(orientation),
      shortB: normalizeDeg(orientation + 180),
    };

    // Glazing share ∝ facade area × compass preference for that actual azimuth.
    const areas = {
      longA: length,
      longB: length,
      shortA: width,
      shortB: width,
    };
    const rawShares = {
      longA: areas.longA * preferenceAt(preference, facadeAzimuths.longA),
      longB: areas.longB * preferenceAt(preference, facadeAzimuths.longB),
      shortA: areas.shortA * preferenceAt(preference, facadeAzimuths.shortA),
      shortB: areas.shortB * preferenceAt(preference, facadeAzimuths.shortB),
    };
    const shareSum =
      rawShares.longA + rawShares.longB + rawShares.shortA + rawShares.shortB || 1;
    const glazingShares = {
      longA: rawShares.longA / shareSum,
      longB: rawShares.longB / shareSum,
      shortA: rawShares.shortA / shareSum,
      shortB: rawShares.shortB / shareSum,
    };

    let coolingObjective = 0;
    let heatingObjective = 0;

    const facades: Array<['longA' | 'longB' | 'shortA' | 'shortB', number, number]> = [
      ['longA', facadeAzimuths.longA, glazingShares.longA],
      ['longB', facadeAzimuths.longB, glazingShares.longB],
      ['shortA', facadeAzimuths.shortA, glazingShares.shortA],
      ['shortB', facadeAzimuths.shortB, glazingShares.shortB],
    ];

    for (const [, azimuth, share] of facades) {
      const gain = seasonalFacadeGain(
        monthlySolar,
        location.latitude,
        MONTH_MID_DAY,
        azimuth,
        monthlyTemps,
      );
      coolingObjective += share * gain.coolingSeason * shadeabilityPenalty(azimuth, location.latitude);
      heatingObjective += share * gain.heatingSeason;
    }

    // Lower is better: penalise avoidable cooling gain, reward useful heating gain.
    const objective = coolingWeight * coolingObjective - heatingWeight * heatingObjective;

    ranking.push({
      orientation,
      coolingObjective,
      heatingObjective,
      objective,
      facadeAzimuths,
      glazingShares,
    });
  }

  ranking.sort((a, b) => a.objective - b.objective);
  const best = ranking[0]!;

  const dominant = coolingWeight >= heatingWeight ? 'cooling' : 'heating';
  const longFacadeAzimuths = [best.facadeAzimuths.longA, best.facadeAzimuths.longB];
  const explanation =
    dominant === 'cooling'
      ? `Long facades oriented toward ${describeAzimuths(longFacadeAzimuths)} to minimise unavoidable low-angle solar gain on the largest wall area.`
      : `Long facades oriented toward ${describeAzimuths(longFacadeAzimuths)} to maximise useful winter solar gain on the largest glazed area.`;

  return {
    /*
     * A rectangular plan is identical under a 180° rotation — the same two long
     * facades simply swap names — so the search reports the canonical
     * representative in [0°, 180°). Without this, two runs of the same climate
     * can report 105° and 285° for the same building, which looks like a
     * disagreement to anyone reading the output.
     */
    orientation: normalizeDeg(best.orientation) % 180,
    ranking,
    coolingWeight,
    heatingWeight,
    explanation,
  };
}

function describeAzimuths(azimuths: number[]): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return azimuths
    .map((az) => labels[Math.round(normalizeDeg(az) / 45) % 8] ?? 'N')
    .join('/');
}

/* ------------------------------------------------------------------ */
/* Individual design decisions                                         */
/* ------------------------------------------------------------------ */

/**
 * Annual thermal stress index: degree-hours where the outdoor mean sits far
 * enough from the comfort setpoint that the envelope has real work to do.
 * This drives the insulation recommendation far better than raw degree days,
 * because it captures mild-but-warm climates (e.g. Pune) that a base-24 cooling
 * degree day count misses entirely.
 */
function thermalStressIndex(climate: ClimateData): number {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return climate.monthly.reduce((total, m, i) => {
    const deviation = Math.abs(m.avgTemp - 24);
    return total + (daysInMonth[i] ?? 30) * Math.max(0, deviation - 3);
  }, 0);
}

function recommendInsulation(climate: ClimateData): {
  level: InsulationLevel;
  thickness: number;
  reason: string;
} {
  const stress = thermalStressIndex(climate);
  const coolingDemand = climate.monthly.reduce((s, m) => s + Math.max(0, m.avgTemp - 22), 0);

  let level: InsulationLevel;
  if (stress > 3000) level = 'very-high';
  else if (stress > 900) level = 'high';
  else if (stress > 400) level = 'medium';
  else if (stress > 100) level = 'low';
  else level = 'none';

  // Mild-but-consistently-warm climates still benefit from a roof.
  if (level === 'none' && coolingDemand > 6) level = 'low';

  const thickness = INSULATION_LEVEL_THICKNESS;

  const reason =
    level === 'very-high'
      ? `Severe annual temperature deviation (stress index ${Math.round(stress)} K·day) — a heavily insulated envelope is essential to hold comfort with minimal energy.`
      : level === 'high'
        ? `Large seasonal swings (stress index ${Math.round(stress)} K·day) — insulation pays back on both heating and cooling.`
        : level === 'medium'
          ? `Meaningful year-round load (stress index ${Math.round(stress)} K·day) — a moderate insulation build-up reduces the cooling peak.`
          : level === 'low'
            ? `Mild but warm climate (stress index ${Math.round(stress)} K·day) — light insulation, concentrated in the roof where solar gain dominates.`
            : `Very mild climate (stress index ${Math.round(stress)} K·day) — insulation adds little beyond the roof.`;

  return { level, thickness: thickness[level], reason };
}

function recommendVentilation(climate: ClimateData): {
  strategy: VentilationStrategy;
  ach: number;
  reason: string;
} {
  const zone = climate.climateZone;
  const humid = climate.summary.humidity >= 65;
  const breezy = climate.summary.windSpeed >= 2.5;
  const cold = climate.summary.minTemperature <= 5;
  const bigSwing = climate.summary.diurnalSwing >= 12;
  /** Does this climate have a season warm enough to need flushing? */
  const warmSeason = climate.summary.maxTemperature >= 22;

  /*
   * Cold and dry. The winter answer is obvious — seal and insulate. The summer
   * answer is not: high-altitude and continental cold climates sit under very
   * intense clear-sky sun, and a tight envelope with generous glazing will
   * overheat badly. So where a warm season exists the recommendation keeps a
   * large *purge capacity* on high and low openings. That costs nothing in
   * winter, because purge ventilation is only used when the outside air is
   * cooler than the space — the openings simply stay shut.
   */
  if (cold && !humid) {
    if (warmSeason) {
      return {
        strategy: 'mixed-mode',
        ach: VENTILATION_ACH['mixed-mode'],
        reason: `Cold, dry winters down to ${climate.summary.minTemperature.toFixed(1)} °C, but summers that reach ${climate.summary.maxTemperature.toFixed(1)} °C under ${climate.summary.solarRadiation.toFixed(1)} kWh/m²/day — the envelope is sealed and insulated through the heating season, then purged through high and low openings when the summer sun would otherwise overheat it.`,
      };
    }
    return {
      strategy: 'sealed-mechanical',
      ach: VENTILATION_ACH['sealed-mechanical'],
      reason:
        'Cold, dry and without a warm season — uncontrolled ventilation would only waste heat, so the envelope is sealed with controlled mechanical fresh air.',
    };
  }

  if (bigSwing && zone === 'hot-dry') {
    return {
      strategy: 'night-purge',
      ach: VENTILATION_ACH['night-purge'],
      reason:
        'Large day–night temperature swing — night-purge ventilation flushes stored heat and pre-cools the thermal mass for the following day.',
    };
  }

  if (humid && breezy) {
    return {
      strategy: 'cross-ventilation',
      ach: VENTILATION_ACH['cross-ventilation'],
      reason:
        'Warm and humid with useful breeze — cross-ventilation across opposite openings is the most energy-efficient way to restore comfort.',
    };
  }

  if (humid) {
    return {
      strategy: 'stack-ventilation',
      ach: VENTILATION_ACH['stack-ventilation'],
      reason:
        'Humid with weak prevailing wind — stack-driven ventilation using high and low openings generates the airflow that wind alone cannot.',
    };
  }

  if (cold) {
    return {
      strategy: 'mixed-mode',
      ach: warmSeason ? VENTILATION_ACH['mixed-mode'] : VENTILATION_ACH['single-sided'],
      reason: warmSeason
        ? `Cold winters down to ${climate.summary.minTemperature.toFixed(1)} °C with a genuinely warm season — sealed in winter, fully purge-ventilated in summer.`
        : 'Cold with a short mild season — a sealed envelope with limited controlled ventilation is the right balance.',
    };
  }

  return {
    strategy: 'cross-ventilation',
    ach: 4,
    reason:
      'Moderate climate — cross-ventilation provides free cooling for much of the year with no energy input.',
  };
}

/**
 * Projection depth for a fixed seasonal overhang.
 *
 * A fixed horizontal overhang is geometrically selective: sized so its shadow
 * just reaches the sill at summer-solar noon, it becomes transparent at
 * winter-solar noon because the sun is much lower. Solving for the projection
 * that fully shades a 1.5 m window gives
 *
 *   α_summer = 90° − |latitude| + 23.44°
 *   projection = windowHeight / tan(α_summer)
 *
 * At Leh (34.2° N) the summer noon sun is ~79° high, so only ~0.3 m is needed —
 * which is exactly why the classic Ladakhi verandah is shallow rather than deep.
 */
function seasonalOverhangDepth(latitude: number): number {
  const summerAltitude = 90 - Math.abs(latitude) + 23.44;
  const tangent = Math.tan(deg2rad(clamp(summerAltitude, 5, 89)));
  const projection = 1.5 / Math.max(0.2, tangent);
  return Number(clamp(projection, 0.25, 0.9).toFixed(2));
}

function recommendShading(climate: ClimateData): {
  strategy: ShadingStrategy;
  depth: number;
  reason: string;
} {
  const solar = climate.summary.solarRadiation;
  const hot = climate.summary.maxTemperature >= 32;
  const zone = climate.climateZone;
  const summerMax = climate.summary.maxTemperature;

  /* --- Heating-only climates ---------------------------------------
     No summer to shade against and scarce sunshine: permanent shading would
     cost more heat than it ever saves. */
  if (summerMax < 20 && solar < 3.5) {
    return {
      strategy: 'none',
      depth: 0,
      reason: `Cool in every month (warmest ${summerMax.toFixed(1)} °C) with limited sunshine — solar gain is an asset year-round, so permanent shading would remove more useful heat than unwanted heat.`,
    };
  }

  /* --- Cold but sun-rich --------------------------------------------
     These places have short, intense summers under a very high sun and a long
     heating season under a low sun. A fixed overhang is the textbook answer:
     blind to the summer noon sun, transparent to the winter noon sun. This is
     why Leh, Srinagar and Shimla need shading even though they are cold. */
  if (zone === 'cold-sunny' || zone === 'cold-desert' || zone === 'cold-cloudy') {
    const depth = seasonalOverhangDepth(climate.location.latitude);
    return {
      strategy: 'overhang',
      depth,
      reason: `Cold but sun-rich — summer peaks near ${summerMax.toFixed(1)} °C under ${solar.toFixed(1)} kWh/m²/day, while winter needs every joule of sun. A ${depth.toFixed(2)} m fixed overhang, sized from the ${Math.abs(climate.location.latitude).toFixed(1)}° latitude summer noon altitude, blocks the high summer sun and still admits the low winter sun.`,
    };
  }

  if (solar >= 6 && hot) {
    return {
      strategy: 'combined',
      depth: 0.9,
      reason: `Very high solar radiation (${solar.toFixed(1)} kWh/m²/day) with hot summers — combined overhangs and vertical fins are needed to cut direct gain on all exposed orientations.`,
    };
  }

  if (solar >= 5.2 && hot) {
    return {
      strategy: 'overhang',
      depth: 0.8,
      reason: `High solar radiation (${solar.toFixed(1)} kWh/m²/day) — a horizontal overhang sized for the summer sun altitude blocks peak gain while admitting winter sun.`,
    };
  }

  if (zone === 'hot-humid' || zone === 'warm-humid') {
    return {
      strategy: 'louvre',
      depth: 0.6,
      reason:
        'Humid climate — adjustable louvres cut radiant gain without blocking the airflow the space depends on.',
    };
  }

  if (solar >= 4.5) {
    return {
      strategy: 'overhang',
      depth: 0.6,
      reason: `Moderate-to-high solar radiation (${solar.toFixed(1)} kWh/m²/day) — a modest overhang removes the summer peak at low cost.`,
    };
  }

  return {
    strategy: 'external-blind',
    depth: 0.4,
    reason:
      'Moderate solar load — deployable external blinds give seasonal control without permanent over-shadowing.',
  };
}

function recommendWindowRatio(climate: ClimateData): {
  ratio: number;
  reason: string;
} {
  const zone = climate.climateZone;
  const solar = climate.summary.solarRadiation;

  switch (zone) {
    case 'hot-dry':
      return {
        ratio: 0.18,
        reason: `Hot, dry and high-radiation (${solar.toFixed(1)} kWh/m²/day) — glazing is kept to a controlled minimum, because every square metre of glass is a heat path in both directions.`,
      };
    case 'hot-humid':
      return {
        ratio: 0.32,
        reason:
          'Hot and humid — openings must be generous to drive cross-ventilation, so glazing is sized for airflow first and daylight second.',
      };
    case 'warm-humid':
      return {
        ratio: 0.28,
        reason:
          'Warm and humid — a moderately high ratio balances ventilation openings against unwanted radiant gain.',
      };
    case 'composite':
      return {
        ratio: 0.25,
        reason:
          'Composite climate with both heating and cooling seasons — a moderate ratio lets the equator-facing glazing collect winter sun while staying shadeable in summer.',
      };
    case 'temperate':
      return {
        ratio: 0.3,
        reason:
          'Temperate climate — a balanced ratio delivers daylight and passive solar benefit without overheating.',
      };
    case 'cold-sunny':
    case 'cold-cloudy':
    case 'cold-desert': {
      /*
       * These zones are heating-dominated, so glazing wants to be generous — but
       * they also sit under intense clear-sky sun, and a heavily glazed, tightly
       * insulated envelope will overheat in the warm season. The ratio is
       * therefore scaled back as the summer peak rises above 20 °C, by up to
       * 40 %. This is a transparent rule, not a fitted coefficient.
       */
      const base = zone === 'cold-sunny' ? 0.38 : zone === 'cold-desert' ? 0.34 : 0.32;
      const summerPeak = climate.summary.maxTemperature;
      const overheatRisk = clamp((summerPeak - 20) / 15, 0, 1);
      const ratio = Number((base * (1 - 0.4 * overheatRisk)).toFixed(3));

      const rationale =
        zone === 'cold-sunny'
          ? 'strong winter sunshine makes equator-facing glazing the cheapest heating system available'
          : zone === 'cold-desert'
            ? 'intense clear-sky sun and huge day–night swings reward equator-facing glazing backed by insulated night shutters'
            : 'glazing is sized for daylight rather than solar gain, with the envelope insulated heavily to limit losses';

      return {
        ratio,
        reason:
          overheatRisk > 0.15
            ? `Cold with ${rationale} — but the warm season reaches ${summerPeak.toFixed(1)} °C under ${solar.toFixed(1)} kWh/m²/day, so the ratio is trimmed from ${Math.round(base * 100)} % to ${Math.round(ratio * 100)} % to stop the envelope overheating when the sun is high.`
            : `Cold with ${rationale}.`,
      };
    }
    default:
      return { ratio: 0.25, reason: 'Balanced ratio for a mixed climate.' };
  }
}

function recommendRoof(climate: ClimateData): {
  strategy: RoofStrategy;
  reason: string;
} {
  const rainfall = climate.summary.rainfall;
  const solar = climate.summary.solarRadiation;
  const zone = climate.climateZone;

  if (rainfall > 1500) {
    return {
      strategy: 'gable',
      reason: `Heavy annual rainfall (${Math.round(rainfall)} mm) — a pitched roof sheds water reliably and allows a ventilated loft space.`,
    };
  }

  if (zone === 'cold-desert' || zone === 'cold-sunny') {
    return {
      strategy: 'shed',
      reason:
        'Cold, sunny climate — a single-slope roof maximises the area facing the sun for winter gain and simplifies snow shedding.',
    };
  }

  if (solar >= 5.8) {
    return {
      strategy: 'flat',
      reason: `Very high solar radiation (${solar.toFixed(1)} kWh/m²/day) — a flat, heavily insulated reflective roof presents the least surface to a high sun and hosts solar panels well.`,
    };
  }

  if (rainfall > 900) {
    return {
      strategy: 'hip',
      reason: `Significant monsoon rainfall (${Math.round(rainfall)} mm) — a hip roof combines good water shedding with better wind resistance.`,
    };
  }

  return {
    strategy: 'flat',
    reason: 'Low rainfall — a flat insulated roof is the most cost-effective envelope option.',
  };
}

function recommendGlazing(climate: ClimateData): {
  strategy: GlazingType;
  reason: string;
} {
  const stress = thermalStressIndex(climate);
  const hot = climate.summary.maxTemperature >= 34;
  const cold = climate.summary.minTemperature <= 5;
  const humid = climate.summary.humidity >= 70;

  if (stress > 3000 || (cold && hot)) {
    return {
      strategy: 'triple',
      reason:
        'Severe annual temperature range — triple glazing is justified by the size of the heat flow it prevents in both directions.',
    };
  }

  if (cold || hot) {
    return {
      strategy: 'double-lowE',
      reason: cold
        ? 'Cold winters — a low-emissivity coating keeps heat inside while still admitting solar gain.'
        : 'Hot summers — a low-emissivity coating reduces the radiant heat that reaches the occupied space.',
    };
  }

  if (humid) {
    return {
      strategy: 'double',
      reason: 'Humid climate — double glazing limits surface condensation and cuts the cooling load.',
    };
  }

  return {
    strategy: 'double',
    reason: 'Moderate climate — double glazing is the cost-effective baseline for limiting conduction.',
  };
}

function recommendWallThickness(
  insulation: InsulationLevel,
  climate: ClimateData,
): { thickness: number; reason: string } {
  const base: Record<InsulationLevel, number> = {
    none: 0.15,
    low: 0.2,
    medium: 0.23,
    high: 0.28,
    'very-high': 0.35,
  };

  const thickness = base[insulation];
  const swing = climate.summary.diurnalSwing;

  const reason =
    swing >= 12
      ? `Large daily swing (±${(swing / 2).toFixed(1)} K) — thicker walls add thermal mass that damps the swing and delays the peak by several hours.`
      : `Wall thickness sized to accommodate the ${insulation} insulation build-up and the structural material.`;

  return { thickness, reason };
}

function recommendShadingDepth(strategy: ShadingStrategy, climate: ClimateData): number {
  if (strategy === 'none') return 0;
  const solar = climate.summary.solarRadiation;
  // Deeper projections for stronger sun; louvres/blinds need less projection.
  const base = solar >= 6 ? 0.95 : solar >= 5.2 ? 0.8 : 0.6;
  const factor = strategy === 'louvre' ? 0.7 : strategy === 'external-blind' ? 0.45 : 1;
  return Number((base * factor).toFixed(2));
}

/* ------------------------------------------------------------------ */
/* Challenge description                                               */
/* ------------------------------------------------------------------ */

function deriveChallenge(climate: ClimateData): {
  challenge: ThermalChallenge;
  detail: string;
} {
  const { summary } = climate;
  const hot = summary.maxTemperature >= 34;
  const veryHot = summary.maxTemperature >= 40;
  const humid = summary.humidity >= 68;
  const veryCold = summary.minTemperature <= -8;
  const solar = summary.solarRadiation;
  const rain = summary.rainfall;
  const swing = summary.diurnalSwing;

  if (veryCold && solar >= 5) {
    return {
      challenge: 'severe-winter-cold',
      detail: `Winters reach ${summary.minTemperature.toFixed(1)} °C with ${solar.toFixed(1)} kWh/m²/day of available sun — the design problem is keeping heat in while harvesting as much free solar gain as possible.`,
    };
  }

  if (veryCold) {
    return {
      challenge: 'severe-winter-cold',
      detail: `Winter minimum of ${summary.minTemperature.toFixed(1)} °C dominates — continuous, uniform insulation and airtightness matter more than any other measure.`,
    };
  }

  if (veryHot && humid) {
    return {
      challenge: 'combined-heat-humidity',
      detail: `Temperatures reach ${summary.maxTemperature.toFixed(1)} °C with ${summary.humidity.toFixed(0)} % humidity — the hardest condition to design for, because cooling must remove latent heat as well as sensible heat.`,
    };
  }

  if (veryHot && solar >= 6) {
    return {
      challenge: 'intense-solar-gain',
      detail: `Peak of ${summary.maxTemperature.toFixed(1)} °C with ${solar.toFixed(1)} kWh/m²/day — direct solar gain through glazing and the roof is the single largest heat source to control.`,
    };
  }

  if (veryHot) {
    return {
      challenge: 'extreme-summer-heat',
      detail: `Summer maximum of ${summary.maxTemperature.toFixed(1)} °C — the roof and west facade dominate the cooling load.`,
    };
  }

  if (swing >= 13) {
    return {
      challenge: 'high-diurnal-swing',
      detail: `Daily swing of ${swing.toFixed(1)} K between ${summary.minTemperature.toFixed(1)} °C and ${summary.maxTemperature.toFixed(1)} °C — thermal mass plus night ventilation can carry comfort through the day with almost no energy.`,
    };
  }

  if (rain >= 1800 && humid) {
    return {
      challenge: 'monsoon-moisture',
      detail: `${Math.round(rain)} mm of annual rain with ${summary.humidity.toFixed(0)} % humidity — moisture management, drainage and mould-free detailing are as important as temperature.`,
    };
  }

  if (humid && hot) {
    return {
      challenge: 'combined-heat-humidity',
      detail: `Warm and humid year-round (${summary.avgTemperature.toFixed(1)} °C, ${summary.humidity.toFixed(0)} % RH) — airflow is the primary comfort mechanism.`,
    };
  }

  if (humid) {
    return {
      challenge: 'moisture-and-humidity',
      detail: `High humidity (${summary.humidity.toFixed(0)} %) — comfort depends on air movement and moisture-tolerant construction.`,
    };
  }

  return {
    challenge: 'moderate-balanced',
    detail: `A broadly moderate climate (${summary.avgTemperature.toFixed(1)} °C mean, ${solar.toFixed(1)} kWh/m²/day) — a balanced envelope with good daylight and seasonal solar control performs well.`,
  };
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run the full climate analysis.
 *
 * @param climate resolved climate data for the location
 * @param requirements user-supplied building size, used for the orientation search
 */
export function analyseClimate(
  climate: ClimateData,
  requirements?: Partial<BuildingParameters>,
): ClimateAnalysis {
  const width = requirements?.width ?? 8;
  const length = requirements?.length ?? 10;

  const orientationSearch = searchOrientation(climate, width, length);
  const insulation = recommendInsulation(climate);
  const ventilation = recommendVentilation(climate);
  const shading = recommendShading(climate);
  const windows = recommendWindowRatio(climate);
  const roof = recommendRoof(climate);
  const glazing = recommendGlazing(climate);
  const walls = recommendWallThickness(insulation.level, climate);
  const shadingDepth = recommendShadingDepth(shading.strategy, climate);
  const { challenge, detail } = deriveChallenge(climate);

  const rationale: DesignRationale[] = [
    {
      id: 'orientation',
      title: `Orientation at ${orientationSearch.orientation}°`,
      reason: orientationSearch.explanation,
      impact: 'high',
      parameter: 'orientation',
      value: `${orientationSearch.orientation}°`,
    },
    {
      id: 'shading',
      title: shading.strategy === 'none' ? 'No external shading' : `${capitalise(shading.strategy.replace('-', ' '))} shading`,
      reason: shading.reason,
      impact: shading.strategy === 'none' ? 'low' : 'high',
      parameter: 'shading',
      value: shading.strategy === 'none' ? 'none' : `${shading.strategy}, ${shadingDepth} m projection`,
    },
    {
      id: 'ventilation',
      title: capitalise(ventilation.strategy.replace(/-/g, ' ')),
      reason: ventilation.reason,
      impact: 'high',
      parameter: 'ventilation',
      value: `${ventilation.strategy} · ${ventilation.ach} ACH`,
    },
    {
      id: 'insulation',
      title: `${capitalise(insulation.level.replace('-', ' '))} insulation`,
      reason: insulation.reason,
      impact: insulation.level === 'none' ? 'low' : 'high',
      parameter: 'insulation',
      value: `${insulation.level}${insulation.thickness > 0 ? ` · ${Math.round(insulation.thickness * 1000)} mm` : ''}`,
    },
    {
      id: 'glazing-ratio',
      title: `Window-to-wall ratio ${Math.round(windows.ratio * 100)}%`,
      reason: windows.reason,
      impact: 'high',
      parameter: 'windowToWallRatio',
      value: `${Math.round(windows.ratio * 100)}%`,
    },
    {
      id: 'glazing-type',
      title: `${describeGlazing(glazing.strategy)} glazing`,
      reason: glazing.reason,
      impact: glazing.strategy === 'single' ? 'low' : 'medium',
      parameter: 'windowType',
      value: glazing.strategy,
    },
    {
      id: 'roof',
      title: `${capitalise(roof.strategy)} roof`,
      reason: roof.reason,
      impact: 'medium',
      parameter: 'roofType',
      value: roof.strategy,
    },
    {
      id: 'walls',
      title: `Walls ${Math.round(walls.thickness * 100)} cm`,
      reason: walls.reason,
      impact: 'medium',
      parameter: 'wallThickness',
      value: `${walls.thickness} m`,
    },
  ];

  return {
    zone: climate.climateZone,
    classification: climate.climateType,
    mainChallenge: challenge,
    challengeDetail: detail,
    ventilationStrategy: ventilation.strategy,
    ventilationAch: ventilation.ach,
    insulationLevel: insulation.level,
    insulationThickness: insulation.thickness,
    shadingStrategy: shading.strategy,
    windowRatioRecommendation: windows.ratio,
    orientationRecommendation: orientationSearch.orientation,
    roofStrategy: roof.strategy,
    glazingStrategy: glazing.strategy,
    shadingDepth,
    wallThickness: walls.thickness,
    rationale,
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeGlazing(strategy: GlazingType): string {
  switch (strategy) {
    case 'single':
      return 'Single';
    case 'double':
      return 'Double';
    case 'double-lowE':
      return 'Double low-E';
    case 'triple':
      return 'Triple';
    default:
      return 'Double';
  }
}

/**
 * Exported for the optimisation engine: the compass weighting the analysis
 * believes glazing should follow for this climate.
 */
export function facadePreferenceForZone(zone: ClimateZone): FacadeWeights {
  return FACADE_PREFERENCE[zone];
}
