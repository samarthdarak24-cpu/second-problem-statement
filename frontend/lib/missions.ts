/**
 * Mission profiles — what the shelter is deployed to do.
 *
 * WHY A MISSION IS NOT JUST AN OCCUPANCY NUMBER
 * The thermal requirement of a shelter is a property of its *task*, not of its
 * construction. A communication shelter is dominated by equipment heat and
 * wants to be cool and dry; a personnel shelter is dominated by occupant heat
 * and wants a comfort band; a storage shelter wants only to stay above freezing
 * and below the point where stores degrade. Feeding one occupancy-and-setpoint
 * pair to all three would make the tool answer the wrong question.
 *
 * A mission profile therefore sets the things that follow from the task:
 *
 *   activity (met)      → occupant sensible/latent split
 *   occupancy           → the occupant load
 *   equipment list      → the equipment load
 *   operating hours     → how long the requirement applies
 *   temperature target  → the setpoints the plant holds
 *   humidity target     → the moisture-control requirement
 *   fresh air per person→ the ventilation floor
 *
 * The physics then runs from those, so the same envelope can be judged against
 * a personnel brief and an equipment brief without changing a single thermal
 * constant. The mission is *programme* — the optimiser never searches it.
 */

import type { BuildingParameters, EquipmentLoadItem, MissionProfileId } from '@/types';

export interface MissionProfile {
  id: MissionProfileId;
  /** Short name for the selector. */
  label: string;
  glyph: string;
  /** Who it is for. */
  useCase: string;
  /** One sentence on what the mission needs thermally. */
  summary: string;
  /** Metabolic rate, met (1 met = 58.15 W/m²). */
  activityMet: number;
  /** Activity label, for the load table. */
  activity: string;
  /** Occupants a fresh design starts with. */
  occupants: number;
  /** Equipment a fresh design starts with. */
  equipment: EquipmentLoadItem[];
  /** Hours per day the requirement applies, 0–24. */
  operatingHours: number;
  /** Target indoor temperature band, °C. */
  targetTemp: { min: number; max: number };
  /** Target indoor relative humidity band, %. */
  targetHumidity: { min: number; max: number };
  /** Minimum fresh-air requirement per person, L/s. */
  freshAirPerPerson: number;
  /** True when the requirement runs continuously — which changes the plant sizing. */
  continuous: boolean;
  /** True when a passive envelope alone is not expected to hold the target. */
  hvacExpected: boolean;
  /** Indicative electrical demand of the mission's own equipment, kW. */
  powerDemandKw: number;
  /** Cooling setpoint the mission implies, °C. */
  coolingSetpoint: number;
  /** Heating setpoint the mission implies, °C. */
  heatingSetpoint: number;
  /** Why this profile asks for what it asks for — shown next to the selector. */
  rationale: string;
}

/**
 * Order matters: it is the order of the selector, and it runs from the most
 * common deployment to the most specialised.
 */
export const MISSION_ORDER: MissionProfileId[] = [
  'personnel-accommodation',
  'command-control',
  'communication',
  'medical',
  'equipment',
  'storage',
  'observation-post',
  'field-operations',
];

const PROFILES: Record<MissionProfileId, MissionProfile> = {
  'personnel-accommodation': {
    id: 'personnel-accommodation',
    label: 'Personnel accommodation',
    glyph: '🛏️',
    useCase: 'Troops living in the shelter',
    summary:
      'Occupant-dominated. The requirement is a comfort band for sleeping and resting, held overnight.',
    activityMet: 1.0,
    activity: 'Resting / sleeping',
    occupants: 4,
    equipment: [{ id: 'lighting', count: 1 }],
    operatingHours: 24,
    targetTemp: { min: 18, max: 26 },
    targetHumidity: { min: 30, max: 60 },
    freshAirPerPerson: 8,
    continuous: true,
    hvacExpected: false,
    powerDemandKw: 0.3,
    coolingSetpoint: 26,
    heatingSetpoint: 18,
    rationale:
      'A resting person is about 60 % sensible and 40 % latent, so occupancy sets both the heat load and the moisture load. Overnight is the critical period, which is why the requirement is continuous.',
  },

  'command-control': {
    id: 'command-control',
    label: 'Command / control',
    glyph: '🎖️',
    useCase: 'Command post, operations room',
    summary:
      'Mixed occupant and equipment load, with a tight temperature band because operators work at screens.',
    activityMet: 1.2,
    activity: 'Light work, seated',
    occupants: 4,
    equipment: [
      { id: 'server-rack', count: 1 },
      { id: 'computer', count: 3 },
      { id: 'comms-terminal', count: 1 },
      { id: 'lighting', count: 2 },
    ],
    operatingHours: 24,
    targetTemp: { min: 20, max: 24 },
    targetHumidity: { min: 30, max: 60 },
    freshAirPerPerson: 10,
    continuous: true,
    hvacExpected: true,
    powerDemandKw: 1.8,
    coolingSetpoint: 24,
    heatingSetpoint: 20,
    rationale:
      'The tight 20–24 °C band and the rack load mean the shelter is cooling-dominated even in a cold climate, because the equipment runs all night. Ventilation alone cannot hold the band.',
  },

  communication: {
    id: 'communication',
    label: 'Communication',
    glyph: '📡',
    useCase: 'Radio / satellite terminal shelter',
    summary:
      'Equipment-dominated. Very high continuous internal gain from a small occupant count, so cooling is the year-round problem.',
    activityMet: 1.2,
    activity: 'Light work, seated',
    occupants: 2,
    equipment: [
      { id: 'comms-terminal', count: 1 },
      { id: 'radio-hf', count: 2 },
      { id: 'battery-charger', count: 1 },
      { id: 'computer', count: 1 },
      { id: 'lighting', count: 1 },
    ],
    operatingHours: 24,
    targetTemp: { min: 18, max: 26 },
    targetHumidity: { min: 30, max: 60 },
    freshAirPerPerson: 10,
    continuous: true,
    hvacExpected: true,
    powerDemandKw: 2.2,
    coolingSetpoint: 26,
    heatingSetpoint: 18,
    rationale:
      'Two operators but more than 1.5 kW of equipment, all continuous. In Leh this shelter still needs cooling at midday in January, which is the finding that makes it worth modelling separately from accommodation.',
  },

  medical: {
    id: 'medical',
    label: 'Medical',
    glyph: '🏥',
    useCase: 'Field medical post, dressing station',
    summary:
      'A tight band with a controlled humidity floor, because the requirement is clinical rather than comfort.',
    activityMet: 1.4,
    activity: 'Standing, light handling',
    occupants: 4,
    equipment: [
      { id: 'medical-monitor', count: 2 },
      { id: 'lighting', count: 2 },
      { id: 'computer', count: 1 },
    ],
    operatingHours: 24,
    targetTemp: { min: 21, max: 24 },
    targetHumidity: { min: 40, max: 60 },
    freshAirPerPerson: 12,
    continuous: true,
    hvacExpected: true,
    powerDemandKw: 1.4,
    coolingSetpoint: 24,
    heatingSetpoint: 21,
    rationale:
      'The humidity *floor* is the unusual part: a dressing station wants moisture in the air, not out of it. That inverts the control logic relative to a communication shelter in the same climate.',
  },

  equipment: {
    id: 'equipment',
    label: 'Equipment / stores bay',
    glyph: '🔧',
    useCase: 'Equipment housing, spares, power',
    summary:
      'Almost no occupants and a wide band. The requirement is to keep equipment inside its operating range, not people comfortable.',
    activityMet: 1.2,
    activity: 'Intermittent access',
    occupants: 1,
    equipment: [
      { id: 'battery-charger', count: 1 },
      { id: 'server-rack', count: 1 },
      { id: 'lighting', count: 1 },
    ],
    operatingHours: 24,
    targetTemp: { min: 15, max: 30 },
    targetHumidity: { min: 20, max: 70 },
    freshAirPerPerson: 6,
    continuous: true,
    hvacExpected: true,
    powerDemandKw: 3.0,
    coolingSetpoint: 30,
    heatingSetpoint: 15,
    rationale:
      'A wide band and a heavy electrical load. The design driver is keeping the enclosure from cooking its own contents in a hot climate, and from freezing batteries in a cold one.',
  },

  storage: {
    id: 'storage',
    label: 'Storage',
    glyph: '📦',
    useCase: 'Ammunition, rations, materiel',
    summary:
      'No occupants. The only requirement is to stay above freezing and below the temperature at which stores degrade.',
    activityMet: 0,
    activity: 'Unoccupied',
    occupants: 0,
    equipment: [],
    operatingHours: 24,
    targetTemp: { min: 5, max: 35 },
    targetHumidity: { min: 20, max: 70 },
    freshAirPerPerson: 2,
    continuous: false,
    hvacExpected: false,
    powerDemandKw: 0.1,
    coolingSetpoint: 35,
    heatingSetpoint: 5,
    rationale:
      'Almost no internal gain and a very wide band, so this is the case where a pure passive envelope genuinely wins. It is the reference against which the occupied missions are judged.',
  },

  'observation-post': {
    id: 'observation-post',
    label: 'Observation / duty post',
    glyph: '🔭',
    useCase: 'Watchtower, sentry post, OP',
    summary:
      'Few occupants doing light physical work in shifts, with a wide but not unlimited band and high air movement.',
    activityMet: 1.6,
    activity: 'Standing, patrolling',
    occupants: 2,
    equipment: [{ id: 'radio-hf', count: 1 }, { id: 'lighting', count: 1 }],
    operatingHours: 12,
    targetTemp: { min: 16, max: 28 },
    targetHumidity: { min: 30, max: 70 },
    freshAirPerPerson: 8,
    continuous: false,
    hvacExpected: false,
    powerDemandKw: 0.4,
    coolingSetpoint: 28,
    heatingSetpoint: 16,
    rationale:
      'Higher activity raises the metabolic rate and shifts the sensible/latent split toward latent, so an observation post is more of a moisture problem than its occupant count suggests.',
  },

  'field-operations': {
    id: 'field-operations',
    label: 'Field operations',
    glyph: '🎯',
    useCase: 'Briefing, staging, short-duration muster',
    summary:
      'Many occupants doing physical work for part of the day, so peak occupant load is high but brief.',
    activityMet: 2.0,
    activity: 'Moderate physical work',
    occupants: 6,
    equipment: [{ id: 'lighting', count: 2 }, { id: 'computer', count: 1 }],
    operatingHours: 16,
    targetTemp: { min: 16, max: 28 },
    targetHumidity: { min: 30, max: 70 },
    freshAirPerPerson: 10,
    continuous: false,
    hvacExpected: false,
    powerDemandKw: 0.6,
    coolingSetpoint: 28,
    heatingSetpoint: 16,
    rationale:
      'The highest occupant load of any profile, but only for part of the day. Peak sizing is driven by the muster; the annual energy is driven by the hours either side of it.',
  },
};

export function missionProfile(id: MissionProfileId): MissionProfile {
  return PROFILES[id];
}

/** The catalogue, in selector order. */
export const MISSION_PROFILES: MissionProfile[] = MISSION_ORDER.map((id) => PROFILES[id]);

/** Narrowing guard for values arriving from a `<select>` or from JSON. */
export function isMissionProfileId(value: unknown): value is MissionProfileId {
  return typeof value === 'string' && value in PROFILES;
}

/** The selector's option list. */
export const MISSION_OPTIONS: { value: string; label: string }[] = MISSION_PROFILES.map((m) => ({
  value: m.id,
  label: `${m.glyph}  ${m.label}`,
}));

/** The default mission a fresh design starts on. */
export const DEFAULT_MISSION_ID: MissionProfileId = 'personnel-accommodation';

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

/**
 * Apply a mission profile to a parameter set.
 *
 * The mission owns the things that follow from the *task* — occupancy, the
 * equipment list and the temperature setpoints — and nothing else. It does not
 * touch the envelope, because the envelope is what the climate and the shelter
 * type decide, and letting a mission overwrite it would make the two inputs
 * fight each other.
 *
 * Like `applyBuildingType`, this is a deliberate, one-directional write: a user
 * who switches mission expects the occupancy and the setpoints to follow, and
 * then edits them if the unit's actual establishment differs.
 */
export function applyMissionProfile(
  current: BuildingParameters,
  id: MissionProfileId,
): BuildingParameters {
  const profile = PROFILES[id];
  return {
    ...current,
    missionProfile: id,
    numOccupants: profile.occupants,
    coolingSetpoint: profile.coolingSetpoint,
    heatingSetpoint: profile.heatingSetpoint,
    /* A fresh copy, so two designs that share a mission do not share the array. */
    internalLoads: profile.equipment.map((entry) => ({ ...entry })),
  };
}
