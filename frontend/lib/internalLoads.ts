/**
 * Internal heat-load library — occupants and equipment.
 *
 * WHY THIS IS EXPLICIT RATHER THAN A SINGLE "internal gains" NUMBER
 * In a dwelling the internal gain is almost entirely people, and a fixed
 * per-person figure is a fair approximation. In a deployed shelter it is not:
 * a communication shelter carries racks and a generator feed, an equipment
 * shelter may carry more electrical load than it does people, and a medical
 * shelter has a load profile that is neither. Collapsing all of that into one
 * number would make the tool useless for exactly the shelters the problem
 * statement is about, so the equipment is itemised and the occupant load is
 * derived from the activity the mission implies.
 *
 * SIGN CONVENTION
 * Every load is reported in watts, positive into the zone — the same convention
 * the heat balance uses, so these can be added straight to `Q_internal`.
 *
 * LATENT vs SENSIBLE
 * Equipment is nearly all sensible. Occupants are not: at rest roughly 40 % of
 * metabolic heat leaves as latent load, and that fraction *rises* with activity
 * and with the surrounding humidity. The split matters because the sensible
 * part warms the air and the latent part becomes moisture — which is the input
 * the condensation model needs.
 */

import type { EquipmentLoadItem } from '@/types';

/* ------------------------------------------------------------------ */
/* Occupants                                                           */
/* ------------------------------------------------------------------ */

/** Du Bois body surface area of a reference adult, m². */
const BODY_AREA_M2 = 1.8;

/** 1 met in W/m² (ISO 7730). */
const MET_W_PER_M2 = 58.15;

/**
 * Fraction of metabolic heat that leaves as *sensible* heat, at a given
 * activity. The rest is latent (respired and evaporated moisture).
 *
 * A resting person is about 60 % sensible; hard physical work pushes the
 * sensible fraction down toward 45 % because more of the metabolism is carried
 * away by sweat. The linear fit is deliberately crude — it is inside the
 * uncertainty of the metabolic figures themselves — but it is in the right
 * direction, which a constant would not be.
 */
export function sensibleFraction(activityMet: number): number {
  return clamp(0.68 - 0.07 * (activityMet - 1), 0.4, 0.75);
}

export interface OccupantLoad {
  /** Total metabolic heat, W. */
  totalW: number;
  /** Sensible part, W. */
  sensibleW: number;
  /** Latent part, W. */
  latentW: number;
  /** Metabolic rate used, met. */
  met: number;
  count: number;
}

export function computeOccupantLoad(count: number, activityMet: number): OccupantLoad {
  const n = Math.max(0, Math.round(count));
  const met = Math.max(0, activityMet);
  const totalW = n * met * MET_W_PER_M2 * BODY_AREA_M2;
  const fraction = sensibleFraction(met);
  return {
    totalW,
    sensibleW: totalW * fraction,
    latentW: totalW * (1 - fraction),
    met,
    count: n,
  };
}

/* ------------------------------------------------------------------ */
/* Equipment                                                           */
/* ------------------------------------------------------------------ */

export interface EquipmentLoad {
  id: string;
  label: string;
  /** Sensible heat, W per unit. */
  sensibleW: number;
  /** Latent heat, W per unit. Almost always 0 — equipment does not sweat. */
  latentW: number;
  /** Count a fresh design starts with. */
  defaultCount: number;
  /**
   * How the item runs. Used for the operating-hours weighting, not for the
   * peak figure — the peak is what sizes the plant.
   */
  schedule: 'continuous' | 'daytime' | 'intermittent';
  /** Short note for the picker. */
  note: string;
}

export const EQUIPMENT_LOADS: EquipmentLoad[] = [
  {
    id: 'radio-hf',
    label: 'HF / VHF radio set',
    sensibleW: 150,
    latentW: 0,
    defaultCount: 1,
    schedule: 'continuous',
    note: 'Manpack or vehicle set on receive. Rises sharply on transmit.',
  },
  {
    id: 'comms-terminal',
    label: 'Satellite comms terminal',
    sensibleW: 300,
    latentW: 0,
    defaultCount: 1,
    schedule: 'continuous',
    note: 'Modem, antenna controller and router.',
  },
  {
    id: 'server-rack',
    label: 'Server / network rack',
    sensibleW: 500,
    latentW: 0,
    defaultCount: 0,
    schedule: 'continuous',
    note: 'The dominant load in a command or communication shelter.',
  },
  {
    id: 'computer',
    label: 'Workstation / laptop',
    sensibleW: 150,
    latentW: 30,
    defaultCount: 1,
    schedule: 'daytime',
    note: 'Small latent component from the occupant at the desk, not the machine.',
  },
  {
    id: 'battery-charger',
    label: 'Battery charger / inverter',
    sensibleW: 500,
    latentW: 0,
    defaultCount: 0,
    schedule: 'continuous',
    note: 'Charging losses appear as heat inside the shelter.',
  },
  {
    id: 'medical-monitor',
    label: 'Medical monitor / steriliser',
    sensibleW: 200,
    latentW: 50,
    defaultCount: 0,
    schedule: 'intermittent',
    note: 'Sterilisation releases moisture as well as heat.',
  },
  {
    id: 'lighting',
    label: 'LED lighting',
    sensibleW: 60,
    latentW: 0,
    defaultCount: 1,
    schedule: 'daytime',
    note: 'Per luminaire group.',
  },
  {
    id: 'heater-aux',
    label: 'Auxiliary space heater',
    sensibleW: 1000,
    latentW: 0,
    defaultCount: 0,
    schedule: 'intermittent',
    note: 'An active load. Listed here so it is counted, not so it is recommended.',
  },
];

export const EQUIPMENT_BY_ID: ReadonlyMap<string, EquipmentLoad> = new Map(
  EQUIPMENT_LOADS.map((item) => [item.id, item]),
);

/** Default equipment list for an equipment id / count pair. */
export function defaultEquipmentItem(id: string): EquipmentLoadItem | null {
  const item = EQUIPMENT_BY_ID.get(id);
  if (!item) return null;
  return { id, count: item.defaultCount };
}

/* ------------------------------------------------------------------ */
/* Combined internal load                                              */
/* ------------------------------------------------------------------ */

export interface InternalLoadBreakdown {
  occupants: OccupantLoad;
  /** Equipment totals. */
  equipmentSensibleW: number;
  equipmentLatentW: number;
  /** Every line, resolved, for the read-out table. */
  items: Array<{ id: string; label: string; count: number; sensibleW: number; latentW: number }>;
  totalW: number;
  totalSensibleW: number;
  totalLatentW: number;
  /** The headline number, kW. */
  totalKw: number;
  /** Per m² of floor area, W/m² — the comparable figure for equipment density. */
  densityWPerSqm: number;
}

/**
 * Resolve the complete internal load for a shelter.
 *
 * @param occupants number of people
 * @param activityMet metabolic rate the mission implies, met
 * @param equipment the itemised equipment list
 * @param floorArea m², for the density figure
 */
export function computeInternalLoads(
  occupants: number,
  activityMet: number,
  equipment: readonly EquipmentLoadItem[] = [],
  floorArea = 0,
): InternalLoadBreakdown {
  const occupantLoad = computeOccupantLoad(occupants, activityMet);

  const items = equipment
    .map((entry) => {
      const item = EQUIPMENT_BY_ID.get(entry.id);
      if (!item) return null;
      const count = Math.max(0, Math.round(entry.count));
      return {
        id: item.id,
        label: item.label,
        count,
        sensibleW: item.sensibleW * count,
        latentW: item.latentW * count,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const equipmentSensibleW = items.reduce((sum, item) => sum + item.sensibleW, 0);
  const equipmentLatentW = items.reduce((sum, item) => sum + item.latentW, 0);

  const totalSensibleW = occupantLoad.sensibleW + equipmentSensibleW;
  const totalLatentW = occupantLoad.latentW + equipmentLatentW;
  const totalW = totalSensibleW + totalLatentW;

  return {
    occupants: occupantLoad,
    equipmentSensibleW,
    equipmentLatentW,
    items,
    totalW,
    totalSensibleW,
    totalLatentW,
    totalKw: totalW / 1000,
    densityWPerSqm: floorArea > 0 ? totalW / floorArea : 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
