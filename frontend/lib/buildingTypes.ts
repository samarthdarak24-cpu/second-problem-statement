/**
 * Building-type templates.
 *
 * WHY A REGISTRY RATHER THAN FIVE MODELS
 * The 3D view is not a showcase. Every dimension it draws is also an input to
 * the thermal engine, so a "building type" that only changed the picture would
 * be a lie: two visually different shelters would report identical comfort and
 * energy. Each template here therefore describes a *real* building form, and
 * every way that form differs from a plain box is expressed through a mechanism
 * the physics engine already models:
 *
 *   | Type difference            | Modelled as                                    |
 *   | -------------------------- | ---------------------------------------------- |
 *   | Extra storeys              | taller envelope, more floor area and volume    |
 *   | Party walls                | walls with no outdoor exposure — no UA         |
 *   | Deep verandah              | a `deep-verandah` shading device on the long   |
 *   |                            | facades, which the solar model already credits |
 *   | Module bays                | repeated structural bays, and the envelope     |
 *   |                            | they actually enclose                          |
 *   | Heavy local materials      | wall/roof material id → density × specific heat|
 *   | Stack ventilation          | ventilation strategy → purge mass flow         |
 *
 * Nothing here is decorative, and nothing here is a special case inside the
 * physics engine: a template is a bundle of ordinary `BuildingParameters` plus
 * a small `massing` descriptor the geometry builder reads. Adding a sixth type
 * means adding one object to this file — no changes to the thermal model, the
 * optimiser, the renderer or the feature contract.
 *
 * WHY NOT GLB MODELS
 * An imported mesh cannot respond to the optimiser. If the engine recommends a
 * 21 % window ratio or a 0.8 m overhang, a static model has nothing to change.
 * Procedural geometry is what makes "the AI chose this design" demonstrable
 * rather than asserted — so the structural components are all generated, and
 * the only assets that would ever need importing are details that cannot be
 * generated. See ASSET-ATTRIBUTION.md.
 */

import type {
  BuildingParameters,
  BuildingTypeId,
  RoofStrategy,
  ShadingStrategy,
  ShelterCategory,
  VentilationStrategy,
} from '@/types';
import { ROOF_PITCH, VENTILATION_ACH } from '@/thermal/constants';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * How a neighbour shares the envelope.
 *
 * `both` is the middle of a terrace: the two long facades are party walls.
 * `one` is an end-of-terrace unit. A party wall is still built — it still
 * carries cost and thermal mass — but it has no outdoor exposure, so it
 * contributes no conduction or solar gain. Modelling that correctly is the
 * whole reason a row house outperforms a detached house of the same size.
 */
export type PartyWalls = 'none' | 'both' | 'one';

/** The massing descriptor the geometry builder consumes. */
export interface BuildingMassing {
  /** Storey count this type allows. */
  floors: { min: number; max: number; default: number };
  /** Facades shared with a neighbour. */
  partyWalls: PartyWalls;
  /**
   * A deep shaded verandah projecting from the long facades, metres.
   * `0` means the type has none.
   */
  verandahDepth: number;
  /**
   * Structural bays repeated along the length. `1` is an unbroken volume; a
   * higher count draws the module joints and dividing ribs that make a
   * prefabricated shelter read as prefabricated.
   */
  modules: number;
  /** Draw a parapet band above the wall head — the low-rise signature. */
  parapet: boolean;
}

/**
 * The materials and strategies a type is legitimately buildable from.
 *
 * WHY A PALETTE IS NECESSARY
 * Without one, the climate engine quietly erases the building type. Its
 * `analysisDrivenParameters` step picks a wall material from the recommended
 * insulation level, a roof form from the recommended roof strategy, and a
 * shading device from the recommended shading strategy — all of which are
 * functions of the *climate alone*. Left alone, a vernacular shelter in Pune and
 * a single-family home in Pune would come out of the analysis wearing the same
 * AAC walls, the same flat roof and the same 0.45 m overhang, differing only in
 * their dimensions. The type selector would then be decorative, and the
 * optimiser would be free to "discover" that a prefabricated panel shelter is
 * best built from rammed earth.
 *
 * A palette is not a lock. It is the set of choices that are *coherent with the
 * type*, and the optimiser is free to move anywhere inside it. Rammed earth
 * versus brick is still a real decision for the vernacular — that is the
 * decision the climate gets to make. Rammed earth versus a PUF sandwich panel
 * is not a decision, it is a different building.
 */
export interface BuildingPalette {
  wallMaterials: string[];
  roofMaterials: string[];
  windowMaterials: string[];
  roofForms: RoofStrategy[];
  shading: ShadingStrategy[];
  ventilation: VentilationStrategy[];
}

/** One selectable building type. */
export interface BuildingTypeTemplate {
  id: BuildingTypeId;
  /**
   * Which family the type belongs to.
   *
   * The selector groups on this, and it is what lets the civil reference cases
   * and the deployable defence shelters coexist in one registry without either
   * pretending to be the other.
   */
  category: ShelterCategory;
  /** Short name for the selector. */
  label: string;
  /** Single glyph — used instead of an icon font so the selector stays light. */
  glyph: string;
  /**
   * Hue in degrees for this type's accent, 0–360.
   *
   * WHY A HUE AND NOT A COLOUR
   * The comparison surfaces put five of these side by side, and a reader has to
   * be able to tell at a glance which column is which without reading five
   * labels. A hue rather than a hex means the accent can be composed into
   * whatever lightness and alpha the surrounding component needs — a 3px rule,
   * a chip border, a 15 % tint — and still be the same colour.
   *
   * Every value stays inside the warm/earthy family the interface is built
   * from (see the palette rationale in `app/globals.css`): terracotta, ochre,
   * amber, olive, rust. No blue, no purple, in any of them.
   */
  accentHue: number;
  /** Who it is for, in a few words. */
  useCase: string;
  /** One sentence on what the form is. */
  summary: string;
  /**
   * Why this form answers a climate. Shown next to the selector, because a
   * type picker that does not explain itself teaches the user nothing.
   */
  climateRationale: string;
  massing: BuildingMassing;
  /**
   * The window-to-wall ratio that best serves this type's daylight and
   * ventilation need — not a search bound, but the point the optimisation's
   * glazing-adequacy term pulls toward. A daylight-hungry low-rise plate needs
   * far more perimeter glazing than a deep-verandah vernacular, so this is what
   * keeps the five types from all collapsing onto the same glazing fraction in a
   * hot climate where the cooling term alone would strip the glass to nothing.
   */
  daylightTarget: number;
  /** The materials and strategies this type is coherently buildable from. */
  palette: BuildingPalette;
  /**
   * Parameter values applied when the type is selected. These are *starting
   * points*, not locks — the optimiser and the sliders both move them.
   */
  defaults: Partial<BuildingParameters>;
}

/* ------------------------------------------------------------------ */
/* The five types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Order matters: it is the order of the selector, and it runs from the most
 * familiar building to the most specialised, which is also roughly the order a
 * jury will ask about them.
 */
/**
 * The civil reference forms, in selector order.
 *
 * Kept as its own list because the Climate Response Lab's building-type sweep
 * runs one full optimisation per entry: five is the number that keeps the sweep
 * interactive, and these five are the reference cases the defence shelters are
 * measured against.
 */
export const BUILDING_TYPE_ORDER: BuildingTypeId[] = [
  'single-family',
  'row-house',
  'low-rise',
  'vernacular',
  'modular-emergency',
];

/**
 * The deployable defence shelter library, in selector order.
 *
 * Runs from the lightest, most deployable form (a carried tent) to the heaviest
 * and most protected (an earth-bermed position), which is also the order a
 * reviewer will ask about them.
 */
export const DEFENCE_TYPE_ORDER: BuildingTypeId[] = [
  'high-altitude-tent',
  'desert-field-tent',
  'warm-humid-shelter',
  'modular-prefab-shelter',
  'modular-insulated-cabin',
  'comm-command-shelter',
  'equipment-shelter',
  'medical-field-shelter',
  'semi-underground-bunker',
];

/** Everything the selector offers: the civil references, then the defence library. */
export const ALL_TYPE_ORDER: BuildingTypeId[] = [
  ...BUILDING_TYPE_ORDER,
  ...DEFENCE_TYPE_ORDER,
];

const TEMPLATES: Record<BuildingTypeId, BuildingTypeTemplate> = {
  'single-family': {
    id: 'single-family',
    category: 'civil',
    label: 'Single-family home',
    glyph: '🏠',
    accentHue: 18, // terracotta — the app's primary, and the reference case
    useCase: 'Residential',
    summary:
      'One detached volume under a pitched roof, with windows and shading on all four facades.',
    climateRationale:
      'The reference case every other type is measured against. Detached means all four facades are exposed, so it carries the largest envelope per square metre of floor — which is exactly why it responds well to insulation and poorly to being built in a desert without shading.',
    massing: {
      floors: { min: 1, max: 2, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.22,
    palette: {
      wallMaterials: ['brick', 'flyash-brick', 'aac', 'hollow-block', 'insulated-aac', 'rcc'],
      roofMaterials: ['rcc-slab', 'reflective-roof', 'insulated-roof', 'metal-sheet'],
      windowMaterials: ['single', 'double', 'double-lowe', 'triple'],
      roofForms: ['flat', 'gable', 'hip', 'shed'],
      shading: ['none', 'overhang', 'louvre', 'external-blind', 'combined'],
      ventilation: [
        'sealed-mechanical',
        'single-sided',
        'cross-ventilation',
        'stack-ventilation',
        'night-purge',
        'mixed-mode',
      ],
    },
    defaults: {
      width: 8,
      length: 10,
      height: 2.9,
      numOccupants: 5,
      numRooms: 3,
      budget: 1_800_000,
      windowToWallRatio: 0.24,
      wallMaterialId: 'brick',
      roofMaterialId: 'rcc-slab',
      windowMaterialId: 'double',
      insulationLevel: 'medium',
      insulationThickness: 0.05,
      roofType: 'gable',
      roofAngle: 25,
      roofOverhang: 0.6,
      shadingType: 'overhang',
      shadingDepth: 0.6,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 4,
    },
  },

  'row-house': {
    id: 'row-house',
    category: 'civil',
    label: 'Compact / row house',
    glyph: '🏘️',
    accentHue: 32, // ochre
    useCase: 'Dense residential',
    summary:
      'A narrow-frontage terrace unit: two storeys on a deep plot, sharing both long walls with its neighbours.',
    climateRationale:
      'The party walls are the whole argument. They are built, they carry cost and thermal mass, but they never see the sky — so no conduction and no solar gain crosses them. A terrace unit therefore has far less exposed envelope per square metre of floor than a detached house, which is why dense low-rise housing is easier to keep comfortable than its detached equivalent.',
    massing: {
      floors: { min: 2, max: 3, default: 2 },
      partyWalls: 'both',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.18,
    palette: {
      /* Urban terrace: fired clay or block, and no vaulted roof — a barrel vault
         over a 5 m frontage in a dense street is not a thing anyone builds. */
      wallMaterials: ['brick', 'flyash-brick', 'aac', 'hollow-block', 'insulated-aac'],
      roofMaterials: ['rcc-slab', 'reflective-roof', 'insulated-roof'],
      windowMaterials: ['single', 'double', 'double-lowe'],
      roofForms: ['flat', 'shed'],
      shading: ['none', 'overhang', 'louvre', 'external-blind', 'combined'],
      ventilation: [
        'sealed-mechanical',
        'single-sided',
        'cross-ventilation',
        'stack-ventilation',
        'night-purge',
        'mixed-mode',
      ],
    },
    defaults: {
      width: 5,
      length: 11,
      height: 2.8,
      numOccupants: 4,
      numRooms: 3,
      budget: 1_700_000,
      windowToWallRatio: 0.2,
      wallMaterialId: 'brick',
      roofMaterialId: 'rcc-slab',
      windowMaterialId: 'double',
      insulationLevel: 'medium',
      insulationThickness: 0.05,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.4,
      shadingType: 'overhang',
      shadingDepth: 0.45,
      ventilationType: 'single-sided',
      airChangesPerHour: 3,
    },
  },

  'low-rise': {
    id: 'low-rise',
    category: 'civil',
    label: 'Low-rise building',
    glyph: '🏢',
    accentHue: 42, // amber
    useCase: 'Apartments / offices',
    summary:
      'A three- to four-storey block with a repeatable floor plate and a flat accessible roof.',
    climateRationale:
      'Stacking floors is the cheapest envelope there is: the roof is shared by every storey, so roof gain per square metre of floor falls roughly with the storey count, and the ground floor is partly buffered by the earth. The trade-off is that a bigger floor plate needs real cross-ventilation, and the upper floors lose the shade of anything around them — which is why the optimiser tends to buy shading here before it buys insulation.',
    massing: {
      floors: { min: 2, max: 4, default: 3 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: true,
    },
    daylightTarget: 0.3,
    palette: {
      /* A repeatable floor plate wants a flat roof and a glazed area big enough
         to light the plan — but not a vault, and not a mud roof. */
      wallMaterials: ['hollow-block', 'aac', 'insulated-aac', 'brick', 'flyash-brick', 'rcc'],
      roofMaterials: ['rcc-slab', 'reflective-roof', 'insulated-roof'],
      windowMaterials: ['single', 'double', 'double-lowe', 'triple'],
      roofForms: ['flat'],
      shading: ['none', 'overhang', 'louvre', 'external-blind', 'combined'],
      ventilation: [
        'sealed-mechanical',
        'single-sided',
        'cross-ventilation',
        'stack-ventilation',
        'night-purge',
        'mixed-mode',
      ],
    },
    defaults: {
      width: 12,
      length: 16,
      height: 3.0,
      numOccupants: 24,
      numRooms: 8,
      budget: 12_000_000,
      windowToWallRatio: 0.32,
      wallMaterialId: 'hollow-block',
      roofMaterialId: 'insulated-roof',
      windowMaterialId: 'double-lowe',
      insulationLevel: 'high',
      insulationThickness: 0.08,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.5,
      shadingType: 'louvre',
      shadingDepth: 0.5,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 5,
    },
  },

  vernacular: {
    id: 'vernacular',
    category: 'civil',
    label: 'Rural / vernacular shelter',
    glyph: '🛖',
    accentHue: 92, // olive — the colour of rammed earth and shade
    useCase: 'Rural / low-cost',
    summary:
      'A single-storey heavyweight shelter with a deep verandah, local materials and a courtyard-like plan.',
    climateRationale:
      'This is the type the brief is really about. Rammed earth or stone gives the mass that rides out a 15 K day–night swing; the deep verandah shades the facade before the sun reaches the glass, which the solar model credits directly; and stack ventilation flushes the stored heat at night. It is also the cheapest envelope here, because it spends its budget on thickness rather than on imported systems.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 1.8,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.16,
    palette: {
      /* The palette *is* the argument for this type. Heavy earth and stone for
         the mass, a mud or slab roof, and nothing imported: no AAC, no
         low-E glazing, no mechanical cooling. If the optimiser cannot make a
         heavyweight shelter work here, that is a finding about the climate, not
         a licence to specify a different building. */
      wallMaterials: ['rammed-earth', 'stone', 'brick', 'flyash-brick', 'rcc'],
      roofMaterials: ['mud-phuska', 'rcc-slab', 'metal-sheet', 'insulated-roof'],
      windowMaterials: ['single', 'double'],
      roofForms: ['vaulted', 'flat', 'shed'],
      shading: ['none', 'overhang', 'deep-verandah', 'combined'],
      ventilation: [
        'single-sided',
        'cross-ventilation',
        'stack-ventilation',
        'night-purge',
        'mixed-mode',
      ],
    },
    defaults: {
      width: 7,
      length: 9,
      height: 3.1,
      wallThickness: 0.45,
      numOccupants: 6,
      numRooms: 2,
      budget: 1_500_000,
      windowToWallRatio: 0.14,
      wallMaterialId: 'rammed-earth',
      roofMaterialId: 'mud-phuska',
      windowMaterialId: 'single',
      insulationLevel: 'none',
      insulationThickness: 0,
      roofType: 'vaulted',
      roofAngle: 0,
      roofOverhang: 0.9,
      shadingType: 'deep-verandah',
      shadingDepth: 1.8,
      ventilationType: 'stack-ventilation',
      airChangesPerHour: 6,
    },
  },

  'modular-emergency': {
    id: 'modular-emergency',
    category: 'civil',
    label: 'Modular emergency shelter',
    glyph: '🏗️',
    accentHue: 8, // rust red — the honest weak case, and it reads as a warning
    useCase: 'Disaster / temporary housing',
    summary:
      'Three prefabricated bays bolted together — lightweight, flat-packed, and deployable in days.',
    climateRationale:
      'The honest weak case, and worth showing for exactly that reason. A prefabricated panel shelter is light: almost no thermal mass, a thin envelope, and a high surface-to-volume ratio, so it swings with the outside air. Its comfort comes from ventilation and shading rather than from storage, and its cost is dominated by the panels rather than by site labour. If the optimiser cannot make this type comfortable in a given climate, that is a real result about the type, not a failure of the search.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 3,
      parapet: false,
    },
    daylightTarget: 0.25,
    palette: {
      /* Everything arrives on a lorry. That rules out rammed earth, stone and a
         masonry roof, and it is why the type has so little mass to work with —
         which is the honest limitation this template exists to demonstrate. */
      wallMaterials: ['aac', 'insulated-aac', 'hollow-block'],
      roofMaterials: ['puf-panel', 'metal-sheet', 'insulated-roof', 'reflective-roof'],
      windowMaterials: ['single', 'double'],
      roofForms: ['shed', 'flat'],
      shading: ['none', 'overhang', 'combined'],
      ventilation: ['single-sided', 'cross-ventilation', 'night-purge', 'mixed-mode'],
    },
    defaults: {
      width: 3.3,
      length: 9.6,
      height: 2.6,
      wallThickness: 0.12,
      numOccupants: 4,
      numRooms: 1,
      budget: 950_000,
      windowToWallRatio: 0.16,
      wallMaterialId: 'aac',
      roofMaterialId: 'puf-panel',
      windowMaterialId: 'single',
      insulationLevel: 'low',
      insulationThickness: 0.025,
      roofType: 'shed',
      roofAngle: 8,
      roofOverhang: 0.5,
      shadingType: 'overhang',
      shadingDepth: 0.5,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 5,
    },
  },

  /* ==================================================================
     DEFENCE SHELTER LIBRARY
     ==================================================================
     Nine deployable shelters, from a carried tent to an earth-bermed
     position. Each is a real form the thermal model simulates, not a
     display variant: a tent's comfort comes from its stack and its air
     changes, a bunker's from its soil cover, and the model will show the
     difference rather than assert it.

     Every default here is a *starting point*, not a lock. The optimiser
     moves inside the palette; the palette is what keeps a prefabricated
     shelter from being "optimised" into rammed earth.
     ================================================================== */

  'high-altitude-tent': {
    id: 'high-altitude-tent',
    category: 'defence',
    label: 'High-altitude personnel shelter',
    glyph: '⛺',
    accentHue: 24,
    useCase: 'High altitude / cold desert',
    summary:
      'A double-skin insulated tent for high-altitude deployment — light enough to be carried, insulated enough to hold heat overnight.',
    climateRationale:
      'At altitude the night is the problem: the shelter must hold heat through a −15 °C night on almost no mass. A double skin with a still-air gap, a radiant barrier and a foam core does the work a thick wall would do at sea level, and it does it at a fraction of the weight.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.12,
    palette: {
      wallMaterials: ['pvc-fabric', 'pu-fabric'],
      roofMaterials: ['tent-fabric-roof'],
      windowMaterials: ['single', 'double'],
      roofForms: ['shed', 'gable'],
      shading: ['none', 'overhang'],
      ventilation: ['sealed-mechanical', 'single-sided', 'stack-ventilation', 'mixed-mode'],
    },
    defaults: {
      width: 5,
      length: 7,
      height: 2.4,
      wallThickness: 0.05,
      numOccupants: 6,
      numRooms: 1,
      budget: 450_000,
      windowToWallRatio: 0.08,
      wallMaterialId: 'pvc-fabric',
      roofMaterialId: 'tent-fabric-roof',
      windowMaterialId: 'double',
      wallAssemblyId: 'tent-wall-insulated',
      roofAssemblyId: 'tent-roof-insulated',
      insulationLevel: 'very-high',
      insulationThickness: 0.06,
      roofType: 'shed',
      roofAngle: 20,
      roofOverhang: 0.3,
      shadingType: 'overhang',
      shadingDepth: 0.3,
      ventilationType: 'sealed-mechanical',
      airChangesPerHour: 1.5,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'medium',
      hvacType: 'diesel-heater',
      powerSource: 'diesel-generator',
      deploymentState: 'deployed',
    },
  },

  'desert-field-tent': {
    id: 'desert-field-tent',
    category: 'defence',
    label: 'Desert field tent',
    glyph: '🏜️',
    accentHue: 48,
    useCase: 'Hot desert / arid',
    summary:
      'A lightweight, high-albedo tent for desert deployment, with a double roof and generous open ventilation.',
    climateRationale:
      'In a desert the shelter must reject the sun, not store heat. A pale outer skin, a double roof that shades itself and generous cross-ventilation beat insulation, which in this climate would only hold the heat in. That is the opposite of the high-altitude answer, on the same platform.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.14,
    palette: {
      wallMaterials: ['pu-fabric', 'pvc-fabric'],
      roofMaterials: ['tent-fabric-roof', 'reflective-roof'],
      windowMaterials: ['single'],
      roofForms: ['shed', 'gable'],
      shading: ['none', 'overhang', 'combined'],
      ventilation: ['cross-ventilation', 'single-sided', 'night-purge', 'mixed-mode'],
    },
    defaults: {
      width: 6,
      length: 8,
      height: 2.5,
      wallThickness: 0.03,
      numOccupants: 8,
      numRooms: 1,
      budget: 350_000,
      windowToWallRatio: 0.1,
      wallMaterialId: 'pu-fabric',
      roofMaterialId: 'tent-fabric-roof',
      windowMaterialId: 'single',
      wallAssemblyId: 'tent-wall-basic',
      insulationLevel: 'none',
      insulationThickness: 0,
      roofType: 'shed',
      roofAngle: 15,
      roofOverhang: 0.4,
      shadingType: 'overhang',
      shadingDepth: 0.4,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 8,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'high',
      hvacType: 'fan',
      powerSource: 'solar-pv',
      deploymentState: 'deployed',
    },
  },

  'warm-humid-shelter': {
    id: 'warm-humid-shelter',
    category: 'defence',
    label: 'Warm-humid personnel shelter',
    glyph: '🌴',
    accentHue: 84,
    useCase: 'Coastal / monsoon',
    summary:
      'A raised, open shelter for warm-humid deployment — maximised ventilation under a shaded, insulated roof.',
    climateRationale:
      'Where the air is warm and wet, comfort comes from air movement and shade, not from insulation. The envelope is kept light and open, and the roof is the only insulated element because the sun is directly overhead. Moisture, not temperature, is the binding constraint.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.2,
    palette: {
      wallMaterials: ['pu-fabric', 'pvc-fabric', 'sandwich-panel'],
      roofMaterials: ['reflective-roof', 'tent-fabric-roof', 'sandwich-roof'],
      windowMaterials: ['single', 'double'],
      roofForms: ['gable', 'shed'],
      shading: ['none', 'overhang', 'combined'],
      ventilation: [
        'cross-ventilation',
        'single-sided',
        'stack-ventilation',
        'night-purge',
        'mixed-mode',
      ],
    },
    defaults: {
      width: 6,
      length: 8,
      height: 2.7,
      wallThickness: 0.06,
      numOccupants: 8,
      numRooms: 1,
      budget: 520_000,
      windowToWallRatio: 0.18,
      wallMaterialId: 'pu-fabric',
      roofMaterialId: 'reflective-roof',
      windowMaterialId: 'single',
      insulationLevel: 'low',
      insulationThickness: 0.03,
      roofType: 'gable',
      roofAngle: 25,
      roofOverhang: 0.8,
      shadingType: 'combined',
      shadingDepth: 0.6,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 10,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'high',
      hvacType: 'fan',
      powerSource: 'solar-pv',
      deploymentState: 'deployed',
    },
  },

  'modular-prefab-shelter': {
    id: 'modular-prefab-shelter',
    category: 'defence',
    label: 'Emergency modular shelter',
    glyph: '🏗️',
    accentHue: 72,
    useCase: 'Rapid deployment',
    summary:
      'Three bolted prefabricated bays — flat-packed, crane-set and habitable in hours.',
    climateRationale:
      'The honest weak case, kept because it is worth showing: a lightweight panel shelter has almost no mass and swings with the outside air, so its comfort comes from ventilation and shading rather than from storage. If it cannot be made comfortable somewhere, that is a finding about the place.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 3,
      parapet: false,
    },
    daylightTarget: 0.18,
    palette: {
      wallMaterials: ['sandwich-panel', 'insulated-panel', 'aac'],
      roofMaterials: ['sandwich-roof', 'insulated-roof', 'metal-sheet'],
      windowMaterials: ['single', 'double'],
      roofForms: ['shed', 'flat'],
      shading: ['none', 'overhang', 'combined'],
      ventilation: ['single-sided', 'cross-ventilation', 'night-purge', 'mixed-mode'],
    },
    defaults: {
      width: 3.3,
      length: 9.6,
      height: 2.6,
      wallThickness: 0.06,
      numOccupants: 4,
      numRooms: 1,
      budget: 700_000,
      windowToWallRatio: 0.16,
      wallMaterialId: 'sandwich-panel',
      roofMaterialId: 'sandwich-roof',
      windowMaterialId: 'single',
      insulationLevel: 'medium',
      insulationThickness: 0.04,
      roofType: 'shed',
      roofAngle: 10,
      roofOverhang: 0.4,
      shadingType: 'overhang',
      shadingDepth: 0.4,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 6,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'medium',
      hvacType: 'none',
      powerSource: 'solar-pv',
      deploymentState: 'deployed',
    },
  },

  'modular-insulated-cabin': {
    id: 'modular-insulated-cabin',
    category: 'defence',
    label: 'Modular insulated cabin',
    glyph: '🏠',
    accentHue: 60,
    useCase: 'Semi-permanent accommodation',
    summary:
      'A rigid insulated panel cabin — the semi-permanent step up from a tent, deployable by lorry and crane.',
    climateRationale:
      'A rigid foam-core panel gives a U-value a tent cannot reach while staying liftable. It is the right answer wherever the shelter will stand for months rather than days, and its plywood lining resists condensation far better than a bare metal skin.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 2,
      parapet: false,
    },
    daylightTarget: 0.16,
    palette: {
      wallMaterials: ['sandwich-panel', 'insulated-panel', 'steel-sheet'],
      roofMaterials: ['sandwich-roof', 'insulated-roof'],
      windowMaterials: ['double', 'double-lowe', 'single'],
      roofForms: ['flat', 'shed'],
      shading: ['none', 'overhang', 'external-blind'],
      ventilation: ['sealed-mechanical', 'single-sided', 'cross-ventilation', 'mixed-mode'],
    },
    defaults: {
      width: 3.3,
      length: 9.6,
      height: 2.6,
      wallThickness: 0.075,
      numOccupants: 4,
      numRooms: 1,
      budget: 950_000,
      windowToWallRatio: 0.12,
      wallMaterialId: 'sandwich-panel',
      roofMaterialId: 'sandwich-roof',
      windowMaterialId: 'double',
      wallAssemblyId: 'cabin-wall-panel',
      roofAssemblyId: 'cabin-roof-panel',
      insulationLevel: 'high',
      insulationThickness: 0.05,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.3,
      shadingType: 'overhang',
      shadingDepth: 0.4,
      ventilationType: 'mixed-mode',
      airChangesPerHour: 4,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'low',
      hvacType: 'heat-pump',
      powerSource: 'hybrid',
      deploymentState: 'deployed',
    },
  },

  'comm-command-shelter': {
    id: 'comm-command-shelter',
    category: 'defence',
    label: 'Communication / command shelter',
    glyph: '📡',
    accentHue: 14,
    useCase: 'Signals / command post',
    summary:
      'A sealed, insulated equipment shelter with a heavy internal electrical load and a tight temperature band.',
    climateRationale:
      'The load here is equipment, not people, and it runs all night. The envelope must be sealed and insulated against the outside in every climate, because the problem is getting heat out in summer and keeping the racks warm in winter — and the humidity band is tight enough that condensation, not temperature, often decides the design.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 2,
      parapet: false,
    },
    daylightTarget: 0.1,
    palette: {
      wallMaterials: ['sandwich-panel', 'insulated-panel', 'insulated-aac'],
      roofMaterials: ['sandwich-roof', 'insulated-roof', 'reflective-roof'],
      windowMaterials: ['double', 'double-lowe'],
      roofForms: ['flat', 'shed'],
      shading: ['none', 'overhang', 'external-blind', 'combined'],
      ventilation: ['sealed-mechanical', 'mixed-mode'],
    },
    defaults: {
      width: 3.3,
      length: 6.6,
      height: 2.6,
      wallThickness: 0.075,
      numOccupants: 2,
      numRooms: 1,
      budget: 1_400_000,
      windowToWallRatio: 0.06,
      wallMaterialId: 'sandwich-panel',
      roofMaterialId: 'sandwich-roof',
      windowMaterialId: 'double',
      wallAssemblyId: 'cabin-wall-panel',
      roofAssemblyId: 'cabin-roof-panel',
      insulationLevel: 'very-high',
      insulationThickness: 0.08,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.4,
      shadingType: 'combined',
      shadingDepth: 0.5,
      ventilationType: 'sealed-mechanical',
      airChangesPerHour: 1,
      missionProfile: 'communication',
      internalLoads: [
        { id: 'comms-terminal', count: 1 },
        { id: 'radio-hf', count: 2 },
        { id: 'battery-charger', count: 1 },
        { id: 'computer', count: 1 },
        { id: 'lighting', count: 1 },
      ],
      infiltrationClass: 'low',
      hvacType: 'air-conditioner',
      powerSource: 'hybrid',
      deploymentState: 'deployed',
    },
  },

  'equipment-shelter': {
    id: 'equipment-shelter',
    category: 'defence',
    label: 'Equipment shelter',
    glyph: '🔧',
    accentHue: 36,
    useCase: 'Plant / stores / power',
    summary:
      'A hard-shell equipment bay — the simplest possible envelope, sized around keeping its contents inside their operating range.',
    climateRationale:
      'No occupants and a wide band, so the envelope is a weather shield with just enough insulation to stop the interior cooking or freezing. The design driver is the internal electrical load, which is why it is modelled with the equipment library rather than an occupancy figure.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 2,
      parapet: false,
    },
    daylightTarget: 0.06,
    palette: {
      wallMaterials: ['steel-sheet', 'sandwich-panel', 'insulated-panel'],
      roofMaterials: ['steel-roof', 'sandwich-roof', 'reflective-roof'],
      windowMaterials: ['single'],
      roofForms: ['flat', 'shed'],
      shading: ['none', 'overhang'],
      ventilation: ['sealed-mechanical', 'single-sided', 'cross-ventilation'],
    },
    defaults: {
      width: 3,
      length: 6,
      height: 2.5,
      wallThickness: 0.06,
      numOccupants: 1,
      numRooms: 1,
      budget: 800_000,
      windowToWallRatio: 0.04,
      wallMaterialId: 'steel-sheet',
      roofMaterialId: 'steel-roof',
      windowMaterialId: 'single',
      insulationLevel: 'medium',
      insulationThickness: 0.05,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.3,
      shadingType: 'overhang',
      shadingDepth: 0.4,
      ventilationType: 'cross-ventilation',
      airChangesPerHour: 6,
      missionProfile: 'equipment',
      internalLoads: [
        { id: 'battery-charger', count: 1 },
        { id: 'server-rack', count: 1 },
        { id: 'lighting', count: 1 },
      ],
      infiltrationClass: 'medium',
      hvacType: 'fan',
      powerSource: 'diesel-generator',
      deploymentState: 'deployed',
    },
  },

  'medical-field-shelter': {
    id: 'medical-field-shelter',
    category: 'defence',
    label: 'Medical field shelter',
    glyph: '🏥',
    accentHue: 96,
    useCase: 'Field medical post',
    summary:
      'A clean, tightly controlled medical shelter with a humidity floor and a narrow temperature band.',
    climateRationale:
      'The requirement is clinical rather than comfortable: a tight band and a humidity *floor*, because a dressing station wants moisture in the air, not out of it. That inverts the control logic relative to every other shelter in the same climate, which is exactly why the mission is a first-class input.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 2,
      parapet: false,
    },
    daylightTarget: 0.2,
    palette: {
      wallMaterials: ['insulated-panel', 'sandwich-panel', 'insulated-aac'],
      roofMaterials: ['sandwich-roof', 'insulated-roof'],
      windowMaterials: ['double', 'double-lowe'],
      roofForms: ['flat', 'shed'],
      shading: ['none', 'overhang', 'external-blind', 'combined'],
      ventilation: ['sealed-mechanical', 'mixed-mode', 'cross-ventilation'],
    },
    defaults: {
      width: 4.2,
      length: 8.4,
      height: 2.7,
      wallThickness: 0.075,
      numOccupants: 4,
      numRooms: 2,
      budget: 2_200_000,
      windowToWallRatio: 0.14,
      wallMaterialId: 'insulated-panel',
      roofMaterialId: 'sandwich-roof',
      windowMaterialId: 'double-lowe',
      insulationLevel: 'high',
      insulationThickness: 0.06,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.5,
      shadingType: 'combined',
      shadingDepth: 0.5,
      ventilationType: 'sealed-mechanical',
      airChangesPerHour: 2,
      missionProfile: 'medical',
      internalLoads: [
        { id: 'medical-monitor', count: 2 },
        { id: 'lighting', count: 2 },
        { id: 'computer', count: 1 },
      ],
      infiltrationClass: 'low',
      hvacType: 'heat-pump',
      powerSource: 'hybrid',
      deploymentState: 'deployed',
    },
  },

  'semi-underground-bunker': {
    id: 'semi-underground-bunker',
    category: 'defence',
    label: 'Semi-underground / bunker shelter',
    glyph: '🪨',
    accentHue: 4,
    useCase: 'Protected / earth-sheltered',
    summary:
      'An earth-bermed, part-buried position — heavy, protected and almost thermally inert.',
    climateRationale:
      'Soil cover removes the diurnal swing almost entirely, and the ground holds the site’s annual mean all year, so a bunker barely responds to the weather at all. The trade-off is a structural cost and a drainage problem no other shelter on this list has.',
    massing: {
      floors: { min: 1, max: 1, default: 1 },
      partyWalls: 'none',
      verandahDepth: 0,
      modules: 1,
      parapet: false,
    },
    daylightTarget: 0.08,
    palette: {
      wallMaterials: ['soil-berm', 'rcc', 'stone'],
      roofMaterials: ['rcc-slab', 'insulated-roof'],
      windowMaterials: ['single', 'double'],
      roofForms: ['flat', 'vaulted'],
      shading: ['none', 'overhang'],
      ventilation: ['sealed-mechanical', 'stack-ventilation', 'mixed-mode'],
    },
    defaults: {
      width: 4,
      length: 8,
      height: 2.6,
      wallThickness: 0.3,
      numOccupants: 6,
      numRooms: 2,
      budget: 3_000_000,
      windowToWallRatio: 0.05,
      wallMaterialId: 'soil-berm',
      roofMaterialId: 'rcc-slab',
      windowMaterialId: 'single',
      wallAssemblyId: 'bunker-wall-earth',
      roofAssemblyId: 'bunker-roof-earth',
      insulationLevel: 'high',
      insulationThickness: 0.06,
      roofType: 'flat',
      roofAngle: 0,
      roofOverhang: 0.4,
      shadingType: 'none',
      shadingDepth: 0,
      ventilationType: 'stack-ventilation',
      airChangesPerHour: 3,
      missionProfile: 'personnel-accommodation',
      infiltrationClass: 'low',
      hvacType: 'none',
      powerSource: 'grid',
      deploymentState: 'deployed',
    },
  },
};

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

export function buildingType(id: BuildingTypeId): BuildingTypeTemplate {
  return TEMPLATES[id];
}

/** The catalogue, in selector order — civil references first, then defence. */
export const BUILDING_TYPES: BuildingTypeTemplate[] = ALL_TYPE_ORDER.map(
  (id) => TEMPLATES[id],
);

/** Narrowing guard for values arriving from a `<select>` or from JSON. */
export function isBuildingTypeId(value: unknown): value is BuildingTypeId {
  return typeof value === 'string' && value in TEMPLATES;
}

/** The selector's option list, in the shape `SelectRow` expects. */
export const BUILDING_TYPE_OPTIONS: { value: string; label: string }[] =
  BUILDING_TYPES.map((t) => ({ value: t.id, label: `${t.glyph}  ${t.label}` }));

/** The civil reference forms only, for a selector that wants to separate them. */
export const CIVIL_TYPE_OPTIONS: { value: string; label: string }[] = BUILDING_TYPE_ORDER.map(
  (id) => ({ value: id, label: `${TEMPLATES[id].glyph}  ${TEMPLATES[id].label}` }),
);

/** The deployable defence shelter library only. */
export const DEFENCE_TYPE_OPTIONS: { value: string; label: string }[] = DEFENCE_TYPE_ORDER.map(
  (id) => ({ value: id, label: `${TEMPLATES[id].glyph}  ${TEMPLATES[id].label}` }),
);

/** True when the type is part of the deployable defence shelter library. */
export function isDefenceType(id: BuildingTypeId): boolean {
  return TEMPLATES[id].category === 'defence';
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

/** Clamp a storey count into the range its type allows. */
export function clampFloors(id: BuildingTypeId, floors: number): number {
  const { min, max } = TEMPLATES[id].massing.floors;
  if (!Number.isFinite(floors)) return TEMPLATES[id].massing.floors.default;
  return Math.round(Math.min(max, Math.max(min, floors)));
}

/**
 * Apply a template to a parameter set.
 *
 * The template's defaults are merged over whatever is already there, so a user
 * who has spent time moving sliders loses the ones the type redefines and keeps
 * the ones it does not mention. Storeys are clamped rather than replaced, so
 * switching from a three-storey block to a single-storey shelter does not leave
 * an illegal storey count behind.
 *
 * `floors` is deliberately applied *after* the merge and clamped to the new
 * type's range — the one place where a template is allowed to overrule an
 * explicit user value, because the alternative is a row house with one storey,
 * which is not a row house.
 */
export function applyBuildingType(
  current: BuildingParameters,
  id: BuildingTypeId,
): BuildingParameters {
  const template = TEMPLATES[id];
  const merged: BuildingParameters = {
    ...current,
    ...template.defaults,
    buildingType: id,
  };
  return {
    ...merged,
    floors: clampFloors(id, template.massing.floors.default),
  };
}

/**
 * Project a parameter set back onto its type's palette.
 *
 * This is the function that keeps the type selector from being decorative. It
 * is applied wherever a design could otherwise drift out of its own type — the
 * analysis-driven seed, the conventional baseline, and every axis the optimiser
 * is allowed to move. A value already inside the palette is left exactly as it
 * is; only an incoherent one is replaced.
 *
 * When the palette overrules a choice, the value that travelled with it has to
 * follow, or the parameters describe a building nobody would build: a verandah
 * 0.45 m deep, a vaulted roof pitched for a gable, or a stack-ventilation
 * strategy running at the air-change rate of a sealed box. Each of those would
 * then be drawn by the 3D engine and simulated by the thermal model as a real
 * building, which is exactly the kind of quiet inconsistency this codebase
 * works to avoid.
 */
export function fitToTemplate(parameters: BuildingParameters): BuildingParameters {
  const template = TEMPLATES[parameters.buildingType];
  const { palette, defaults } = template;

  const roofType = fitValue(parameters.roofType, palette.roofForms, defaults.roofType);
  const shadingType = fitValue(parameters.shadingType, palette.shading, defaults.shadingType);
  const ventilationType = fitValue(
    parameters.ventilationType,
    palette.ventilation,
    defaults.ventilationType,
  );

  const shadingChanged = shadingType !== parameters.shadingType;
  const shadingDepth = !shadingChanged
    ? parameters.shadingDepth
    : shadingType === 'none'
      ? 0
      : (defaults.shadingDepth ?? parameters.shadingDepth);

  const roofChanged = roofType !== parameters.roofType;

  const ventilationChanged = ventilationType !== parameters.ventilationType;

  return {
    ...parameters,
    wallMaterialId: fitValue(parameters.wallMaterialId, palette.wallMaterials, defaults.wallMaterialId),
    roofMaterialId: fitValue(parameters.roofMaterialId, palette.roofMaterials, defaults.roofMaterialId),
    windowMaterialId: fitValue(
      parameters.windowMaterialId,
      palette.windowMaterials,
      defaults.windowMaterialId,
    ),
    roofType,
    roofAngle: roofChanged ? ROOF_PITCH[roofType] : parameters.roofAngle,
    shadingType,
    shadingDepth,
    ventilationType,
    airChangesPerHour: ventilationChanged
      ? VENTILATION_ACH[ventilationType]
      : parameters.airChangesPerHour,
    floors: clampFloors(parameters.buildingType, parameters.floors),
  };
}

/** The palette a type is buildable from, for callers that need to filter a list. */
export function paletteFor(id: BuildingTypeId): BuildingPalette {
  return TEMPLATES[id].palette;
}

/**
 * Return `value` if the palette allows it, otherwise the template's own default
 * for that axis, otherwise the first allowed option.
 *
 * Preferring the template default matters: an out-of-palette recommendation
 * should fall back to the choice that expresses the *type*, not to whatever
 * happens to be first in the list.
 */
function fitValue<T extends string>(
  value: T,
  allowed: readonly string[],
  preferred: string | undefined,
): T {
  if (allowed.includes(value)) return value;
  if (preferred !== undefined && allowed.includes(preferred)) return preferred as T;
  return (allowed[0] ?? value) as T;
}

/**
 * Storey counts are part of the *programme*, not of the optimiser's search.
 *
 * The optimiser searches form — orientation, glazing, shading, mass. How many
 * storeys a household can afford to build is a fact about the household, and
 * letting a search wander between one and four storeys would silently change
 * the building's programme to win an objective. So the count is treated the way
 * `width` and `budget` already are: fixed by the user, respected by the search.
 */
export function floorsAreProgramme(): true {
  return true;
}
