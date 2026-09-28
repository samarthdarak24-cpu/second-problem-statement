/**
 * The design programme, and the slider metadata that drives the parameter panel.
 *
 * WHY THE RANGES LIVE HERE
 * A slider is an interface contract: if the panel offers 0.60 m of wall
 * thickness but the cost model prices the assembly at 0.45 m, the number the
 * user sees and the number they are quoted come from different buildings.
 * Declaring the range next to the default, in one table both the panel and the
 * store read, is the cheapest way to keep them honest.
 *
 * The parameter set is split in two on purpose:
 *
 *   PROGRAMME — dimensions, occupancy, budget, setpoints. These describe *what
 *   the user is building*. The optimiser treats them as fixed and never
 *   searches them.
 *
 *   ENVELOPE — orientation, glazing, insulation, shading, ventilation, roof.
 *   These describe *how it is built*, and are exactly what the climate engine
 *   and the optimiser are allowed to change.
 *
 * The panel groups mirror that split, so a user can see at a glance which
 * numbers the AI is choosing for them.
 */

import type {
  BuildingParameters,
  InsulationLevel,
  RoofStrategy,
  ShadingStrategy,
  VentilationStrategy,
} from '@/types';
import {
  INSULATION_LABEL,
  INSULATION_LEVELS,
  ROOF_LABEL,
  ROOF_STRATEGIES,
  SHADING_LABEL,
  SHADING_STRATEGIES,
  VENTILATION_LABEL,
  VENTILATION_STRATEGIES,
} from '@/thermal/constants';
import { ROOF_MATERIALS, WALL_MATERIALS, WINDOW_MATERIALS } from '@/thermal/materials';
import {
  applyBuildingType,
  BUILDING_TYPE_OPTIONS,
  buildingType,
  clampFloors,
  isBuildingTypeId,
} from '@/lib/buildingTypes';
import { GLAZING_BIAS_OPTIONS, glazingBiasOption, isGlazingBiasId } from '@/lib/glazingBias';
import { ROOF_ASSEMBLY_OPTIONS, WALL_ASSEMBLY_OPTIONS } from '@/thermal/assemblies';
import {
  applyMissionProfile,
  isMissionProfileId,
  MISSION_OPTIONS,
  missionProfile,
} from '@/lib/missions';

/* ------------------------------------------------------------------ */
/* The programme                                                       */
/* ------------------------------------------------------------------ */

/**
 * Where a new design starts: a single-room shelter for four people, built the
 * ordinary local way. Deliberately *unremarkable* — the whole point of the app
 * is to show how much better the same brief can be built once the climate is
 * taken seriously, and that argument is only credible from an honest start.
 */
export function defaultRequirements(): BuildingParameters {
  return {
    /* Form */
    buildingType: 'single-family',
    floors: 1,

    /* Dimensions */
    width: 6,
    length: 4.5,
    height: 2.8,
    wallThickness: 0.23,

    /* Programme */
    numOccupants: 4,
    numRooms: 1,
    budget: 600_000,

    /* Mission — what the shelter is deployed to do. */
    missionProfile: 'personnel-accommodation',

    /* Orientation — long axis east–west, the conventional default */
    orientation: 0,

    /* Envelope */
    windowToWallRatio: 0.3,
    facadeWeights: { north: 1, east: 1, south: 1, west: 1 },
    glazingBias: 'balanced',
    wallMaterialId: 'brick',
    roofMaterialId: 'rcc-slab',
    windowMaterialId: 'single',
    insulationLevel: 'none',
    insulationThickness: 0,

    /* Roof */
    roofType: 'flat',
    roofAngle: 0,
    roofOverhang: 0.3,

    /* Shading & ventilation */
    shadingType: 'none',
    shadingDepth: 0,
    ventilationType: 'mixed-mode',
    airChangesPerHour: 3,

    /* Services */
    coolingSetpoint: 26,
    heatingSetpoint: 18,
    coolingCop: 3.2,
    heatingEfficiency: 0.9,
    solarPvKwp: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Field descriptors                                                   */
/* ------------------------------------------------------------------ */

/** Numeric parameters a slider is allowed to write to. */
export type NumericParameterKey =
  | 'floors'
  | 'width'
  | 'length'
  | 'height'
  | 'wallThickness'
  | 'numOccupants'
  | 'numRooms'
  | 'budget'
  | 'orientation'
  | 'windowToWallRatio'
  | 'insulationThickness'
  | 'roofAngle'
  | 'roofOverhang'
  | 'shadingDepth'
  | 'airChangesPerHour'
  | 'coolingSetpoint'
  | 'heatingSetpoint'
  | 'coolingCop'
  | 'heatingEfficiency'
  | 'solarPvKwp';

/** String parameters a select is allowed to write to. */
export type SelectParameterKey =
  | 'buildingType'
  | 'missionProfile'
  | 'insulationLevel'
  | 'wallMaterialId'
  | 'roofMaterialId'
  | 'windowMaterialId'
  | 'roofType'
  | 'shadingType'
  | 'ventilationType'
  | 'glazingBias'
  | 'wallAssemblyId'
  | 'roofAssemblyId';

export type ParameterKey = NumericParameterKey | SelectParameterKey;

/** How the raw value is rendered next to the label. */
export type ValueFormat = 'plain' | 'percent' | 'currency' | 'degrees' | 'metres';

export interface SliderField {
  kind: 'slider';
  key: NumericParameterKey;
  label: string;
  /** Unit suffix appended to the readout. */
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  format?: ValueFormat;
  hint?: string;
  /** Part of the fixed programme — the optimiser never searches this. */
  programme?: boolean;
}

export interface SelectField {
  kind: 'select';
  key: SelectParameterKey;
  label: string;
  options: { value: string; label: string }[];
  hint?: string;
}

export type ParameterField = SliderField | SelectField;

export interface ParameterGroup {
  id: string;
  label: string;
  /** One-line explanation of what the group controls. */
  note: string;
  /** Which pipeline stage the group belongs to, for the accent stripe. */
  accent: 'input' | 'analysis' | 'optimize' | 'output';
  fields: ParameterField[];
}

/* ------------------------------------------------------------------ */
/* Option lists                                                        */
/* ------------------------------------------------------------------ */

function optionsFrom<T extends string>(
  values: readonly T[],
  label: Record<T, string>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: label[value] }));
}

const INSULATION_OPTIONS = optionsFrom<InsulationLevel>(INSULATION_LEVELS, INSULATION_LABEL);
const ROOF_TYPE_OPTIONS = optionsFrom<RoofStrategy>(ROOF_STRATEGIES, ROOF_LABEL);
const SHADING_OPTIONS = optionsFrom<ShadingStrategy>(SHADING_STRATEGIES, SHADING_LABEL);
const VENTILATION_OPTIONS = optionsFrom<VentilationStrategy>(
  VENTILATION_STRATEGIES,
  VENTILATION_LABEL,
);

const WALL_OPTIONS = WALL_MATERIALS.map((m) => ({ value: m.id, label: m.name }));
const ROOF_MATERIAL_OPTIONS = ROOF_MATERIALS.map((m) => ({ value: m.id, label: m.name }));
const WINDOW_OPTIONS = WINDOW_MATERIALS.map((m) => ({ value: m.id, label: m.name }));

/* ------------------------------------------------------------------ */
/* The groups that do not depend on the building type                  */
/* ------------------------------------------------------------------ */

const GROUPS: ParameterGroup[] = [
  {
    id: 'programme',
    label: 'Programme',
    note: 'What you are building. The optimiser treats these as fixed.',
    accent: 'input',
    fields: [
      {
        kind: 'slider',
        key: 'width',
        label: 'Width',
        unit: 'm',
        min: 3,
        max: 12,
        step: 0.1,
        decimals: 1,
        format: 'metres',
        programme: true,
        hint: 'Across the facade — the axis that sets the solar exposure.',
      },
      {
        kind: 'slider',
        key: 'length',
        label: 'Length',
        unit: 'm',
        min: 3,
        max: 16,
        step: 0.1,
        decimals: 1,
        format: 'metres',
        programme: true,
      },
      {
        kind: 'slider',
        key: 'height',
        label: 'Floor to ceiling',
        unit: 'm',
        min: 2.2,
        max: 4.2,
        step: 0.05,
        decimals: 2,
        format: 'metres',
        programme: true,
        hint: 'Taller rooms stratify; useful for stack ventilation.',
      },
      {
        kind: 'slider',
        key: 'numOccupants',
        label: 'Occupants',
        unit: '',
        min: 1,
        max: 12,
        step: 1,
        decimals: 0,
        programme: true,
        hint: 'Drives internal gains and the fresh-air requirement.',
      },
      {
        kind: 'slider',
        key: 'numRooms',
        label: 'Rooms',
        unit: '',
        min: 1,
        max: 4,
        step: 1,
        decimals: 0,
        programme: true,
      },
      {
        kind: 'slider',
        key: 'budget',
        label: 'Budget',
        unit: '',
        min: 200_000,
        max: 3_000_000,
        step: 25_000,
        decimals: 0,
        format: 'currency',
        programme: true,
        hint: 'A soft constraint — an overrun is reported, not blocked.',
      },
    ],
  },

  {
    id: 'envelope',
    label: 'Envelope',
    note: 'The thermal shell. This is where most of the saving is.',
    accent: 'analysis',
    fields: [
      {
        kind: 'select',
        key: 'wallMaterialId',
        label: 'Wall material',
        options: WALL_OPTIONS,
        hint: 'Sets conductivity, mass and how long the wall takes to respond.',
      },
      {
        kind: 'select',
        key: 'wallAssemblyId',
        label: 'Composite wall build-up',
        options: WALL_ASSEMBLY_OPTIONS,
        hint: 'Overrides the wall material with a multi-layer stack — insulation and storage in separate layers. Includes a phase-change option.',
      },
      {
        kind: 'slider',
        key: 'wallThickness',
        label: 'Wall thickness',
        unit: 'm',
        min: 0.1,
        max: 0.5,
        step: 0.01,
        decimals: 2,
        format: 'metres',
        hint: 'Mass delays the peak; it does not remove it.',
      },
      {
        kind: 'select',
        key: 'insulationLevel',
        label: 'Insulation level',
        options: INSULATION_OPTIONS,
      },
      {
        kind: 'slider',
        key: 'insulationThickness',
        label: 'Insulation thickness',
        unit: 'm',
        min: 0,
        max: 0.2,
        step: 0.005,
        decimals: 3,
        format: 'metres',
        hint: 'Additional layer over the base assembly.',
      },
      {
        kind: 'slider',
        key: 'windowToWallRatio',
        label: 'Window-to-wall ratio',
        unit: '',
        min: 0,
        max: 0.6,
        step: 0.01,
        decimals: 2,
        format: 'percent',
        hint: 'The single biggest lever on both solar gain and heat loss.',
      },
      {
        kind: 'select',
        key: 'glazingBias',
        label: 'Glazing position',
        options: GLAZING_BIAS_OPTIONS,
        hint: 'Which facade the glass sits on. Orientation decides where the sun is; this decides where the window is.',
      },
      {
        kind: 'select',
        key: 'windowMaterialId',
        label: 'Glazing',
        options: WINDOW_OPTIONS,
      },
      {
        kind: 'select',
        key: 'roofMaterialId',
        label: 'Roof material',
        options: ROOF_MATERIAL_OPTIONS,
      },
      {
        kind: 'select',
        key: 'roofAssemblyId',
        label: 'Composite roof build-up',
        options: ROOF_ASSEMBLY_OPTIONS,
        hint: 'Overrides the roof material with a multi-layer stack.',
      },
    ],
  },

  {
    id: 'form',
    label: 'Form & shading',
    note: 'Orientation, roof form and how the sun is intercepted.',
    accent: 'optimize',
    fields: [
      {
        kind: 'slider',
        key: 'orientation',
        label: 'Orientation',
        unit: '°',
        min: 0,
        max: 359,
        step: 1,
        decimals: 0,
        format: 'degrees',
        hint: 'Rotation of the long axis clockwise from north. Symmetric every 180°.',
      },
      {
        kind: 'select',
        key: 'roofType',
        label: 'Roof form',
        options: ROOF_TYPE_OPTIONS,
      },
      {
        kind: 'slider',
        key: 'roofAngle',
        label: 'Roof pitch',
        unit: '°',
        min: 0,
        max: 45,
        step: 1,
        decimals: 0,
        format: 'degrees',
        hint: 'Ignored for flat roofs.',
      },
      {
        kind: 'slider',
        key: 'roofOverhang',
        label: 'Roof overhang',
        unit: 'm',
        min: 0,
        max: 1.5,
        step: 0.05,
        decimals: 2,
        format: 'metres',
      },
      {
        kind: 'select',
        key: 'shadingType',
        label: 'Shading device',
        options: SHADING_OPTIONS,
      },
      {
        kind: 'slider',
        key: 'shadingDepth',
        label: 'Shading depth',
        unit: 'm',
        min: 0,
        max: 1.8,
        step: 0.05,
        decimals: 2,
        format: 'metres',
        hint: 'Deeper blocks more summer sun — and more winter sun too.',
      },
    ],
  },

  {
    id: 'services',
    label: 'Ventilation & services',
    note: 'Air movement, setpoints and the plant that backs it up.',
    accent: 'output',
    fields: [
      {
        kind: 'select',
        key: 'ventilationType',
        label: 'Ventilation strategy',
        options: VENTILATION_OPTIONS,
      },
      {
        kind: 'slider',
        key: 'airChangesPerHour',
        label: 'Design air changes',
        unit: 'ACH',
        min: 0.5,
        max: 12,
        step: 0.5,
        decimals: 1,
        hint: 'Capacity, not a constant rate — only used when outside air helps.',
      },
      {
        kind: 'slider',
        key: 'coolingSetpoint',
        label: 'Cooling setpoint',
        unit: '°C',
        min: 20,
        max: 30,
        step: 0.5,
        decimals: 1,
        programme: true,
        hint: 'Every degree here is roughly 6 % of the cooling energy.',
      },
      {
        kind: 'slider',
        key: 'heatingSetpoint',
        label: 'Heating setpoint',
        unit: '°C',
        min: 14,
        max: 24,
        step: 0.5,
        decimals: 1,
        programme: true,
      },
      {
        kind: 'slider',
        key: 'coolingCop',
        label: 'Cooling COP',
        unit: '',
        min: 1.8,
        max: 6,
        step: 0.1,
        decimals: 1,
        programme: true,
        hint: 'Coefficient of performance of the cooling system.',
      },
      {
        kind: 'slider',
        key: 'heatingEfficiency',
        label: 'Heating efficiency',
        unit: '',
        min: 0.6,
        max: 4,
        step: 0.05,
        decimals: 2,
        programme: true,
        hint: 'Above 1 means a heat pump; 0.9 is a fossil boiler.',
      },
      {
        kind: 'slider',
        key: 'solarPvKwp',
        label: 'Rooftop PV',
        unit: 'kWp',
        min: 0,
        max: 10,
        step: 0.5,
        decimals: 1,
        hint: 'Offsets delivered energy; does not change comfort.',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build the parameter panel for a given design.
 *
 * A function rather than a constant, because the storey count is only
 * meaningful relative to the building type: a vernacular shelter is
 * single-storey by definition, and a static list would happily let one be given
 * three storeys — a building that is not the type the user selected.
 */
export function parameterGroups(parameters: BuildingParameters): ParameterGroup[] {
  const template = buildingType(parameters.buildingType);
  const { min: floorMin, max: floorMax } = template.massing.floors;

  /*
   * The mission is programme, like the building type: it is a fact about the
   * deployment rather than a search variable, and choosing one sets the
   * occupancy, the equipment list and the setpoints together. It is therefore
   * its own group at the top of the panel, ahead of the envelope the optimiser
   * is allowed to move.
   */
  const mission = parameters.missionProfile ? missionProfile(parameters.missionProfile) : null;

  return [
    {
      id: 'building-type',
      label: 'Shelter type',
      note: template.summary,
      accent: 'analysis',
      fields: [
        {
          kind: 'select',
          key: 'buildingType',
          label: 'Type',
          options: BUILDING_TYPE_OPTIONS,
          hint: `${template.useCase} — choosing a type resets the parameters it defines and clamps the storey count.`,
        },
        {
          kind: 'slider',
          key: 'floors',
          label: 'Storeys',
          unit: floorMax > 1 ? 'floors' : 'single storey',
          min: floorMin,
          max: Math.max(floorMax, floorMin + 1),
          step: 1,
          decimals: 0,
          programme: true,
          hint:
            floorMin === floorMax
              ? `${template.label} is single-storey by definition.`
              : `${template.label} allows ${floorMin}–${floorMax} storeys. A storey count is programme, not a search variable.`,
        },
      ],
    },
    {
      id: 'mission',
      label: 'Mission',
      note: 'What the shelter is deployed to do. The mission sets the occupancy, the equipment load and the temperature targets.',
      accent: 'input',
      fields: [
        {
          kind: 'select',
          key: 'missionProfile',
          label: 'Mission profile',
          options: MISSION_OPTIONS,
          hint: mission
            ? `${mission.activity} · ${mission.occupants} occupant${mission.occupants === 1 ? '' : 's'} · target ${mission.targetTemp.min}–${mission.targetTemp.max} °C · RH ${mission.targetHumidity.min}–${mission.targetHumidity.max} % · ${mission.operatingHours} h/day${mission.continuous ? ' continuous' : ''}. ${mission.rationale}`
            : 'Choosing a mission sets the occupancy, the equipment load and the setpoints together.',
        },
      ],
    },
    ...GROUPS,
  ];
}

/** The panel at its default state — used to index every field by key. */
export const PARAMETER_GROUPS: ParameterGroup[] = parameterGroups(defaultRequirements());

/* ------------------------------------------------------------------ */
/* Writing a value back into the parameter set                          */
/* ------------------------------------------------------------------ */

export function withNumericParameter(
  parameters: BuildingParameters,
  key: NumericParameterKey,
  value: number,
): BuildingParameters {
  /*
   * Storeys are the one numeric parameter with a type-dependent legal range.
   * Clamping on write means the invariant holds no matter who writes it — a
   * slider, the store's `updateNumeric`, or a restored preset — rather than
   * depending on the UI having disabled the control.
   */
  if (key === 'floors') {
    return { ...parameters, floors: clampFloors(parameters.buildingType, value) };
  }
  return { ...parameters, [key]: value };
}

/**
 * Write a select value back into the parameter set.
 *
 * The switch is written out rather than using a computed key so that each
 * union-typed field is narrowed explicitly — a single cast would let a typo in
 * a `<select>` option id reach the thermal model as a `VentilationStrategy`
 * that does not exist.
 */
export function withSelectParameter(
  parameters: BuildingParameters,
  key: SelectParameterKey,
  value: string,
): BuildingParameters {
  switch (key) {
    case 'buildingType':
      /*
       * Choosing a type is not a field assignment: it applies the template's
       * parameter set and re-clamps the storey count, so the two cannot drift
       * apart. `applyBuildingType` is the single place that knows how to do it.
       */
      return isBuildingTypeId(value) ? applyBuildingType(parameters, value) : parameters;
    case 'missionProfile':
      /*
       * A mission is not a field assignment either: it sets occupancy, the
       * equipment list and the setpoints together, so `applyMissionProfile` is
       * the single place that knows how to do it.
       */
      return isMissionProfileId(value) ? applyMissionProfile(parameters, value) : parameters;
    case 'insulationLevel':
      return { ...parameters, insulationLevel: value as InsulationLevel };
    case 'roofType':
      return { ...parameters, roofType: value as RoofStrategy };
    case 'shadingType':
      return { ...parameters, shadingType: value as ShadingStrategy };
    case 'ventilationType':
      return { ...parameters, ventilationType: value as VentilationStrategy };
    case 'glazingBias': {
      /* The strategy is the parameter; `facadeWeights` is its resolved form.
         Both are written so a design read back without the bias still describes
         the same building. */
      if (!isGlazingBiasId(value)) return parameters;
      return {
        ...parameters,
        glazingBias: value,
        facadeWeights: glazingBiasOption(value).weights,
      };
    }
    case 'wallAssemblyId':
      /* An empty value means "use the single-material wall above", so it clears
         the assembly rather than storing an empty id. */
      return { ...parameters, wallAssemblyId: value || undefined };
    case 'roofAssemblyId':
      return { ...parameters, roofAssemblyId: value || undefined };
    case 'wallMaterialId':
      return { ...parameters, wallMaterialId: value };
    case 'roofMaterialId':
      return { ...parameters, roofMaterialId: value };
    case 'windowMaterialId':
      return { ...parameters, windowMaterialId: value };
  }
}

/** Flat index of every field, for lookups by key. */
export const FIELD_BY_KEY: ReadonlyMap<string, ParameterField> = new Map(
  PARAMETER_GROUPS.flatMap((group) => group.fields).map((field) => [field.key, field]),
);
