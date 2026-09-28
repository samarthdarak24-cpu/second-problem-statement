/**
 * Building envelope, material and parametric-geometry types.
 */

import type {
  GlazingType,
  InsulationLevel,
  RoofStrategy,
  ShadingStrategy,
  VentilationStrategy,
} from './climate';

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

export type MaterialCategory = 'wall' | 'roof' | 'window' | 'insulation' | 'floor' | 'door';

/**
 * One layer of a composite assembly.
 *
 * WHY THE PROPERTIES ARE INLINE RATHER THAN A MATERIAL ID
 * A layer is a *physical* statement — 100 mm of EPS at k = 0.035 — and the
 * assembly's U-value, mass and daily storage are all derived by walking the
 * stack. Carrying the numbers here rather than resolving an id at every call
 * site means the assembly is self-contained: it can be validated, printed on a
 * drawing, and reasoned about without the library being loaded. It also lets a
 * phase-change layer exist, which no ordinary material entry can express.
 *
 * LAYERS RUN OUTSIDE → INSIDE.
 */
export interface MaterialLayer {
  /** Short name for the build-up table, e.g. "EPS insulation". */
  name: string;
  /** Layer thickness, metres. */
  thickness: number;
  /** Thermal conductivity λ, W/m·K. */
  conductivity: number;
  /** Dry density, kg/m³. */
  density: number;
  /** Specific heat capacity, J/kg·K. */
  specificHeat: number;
  /**
   * Water-vapour diffusion resistance factor, μ — dimensionless, air = 1.
   *
   * WHY THIS IS REQUIRED RATHER THAN OPTIONAL
   * The interstitial condensation check (the Glaser method) works by comparing
   * a vapour-pressure profile against a saturation-pressure profile through the
   * stack, and the whole answer is decided by the *ratio* of vapour resistance
   * between layers — not by any absolute value. A layer that silently defaulted
   * to a plausible-looking μ would therefore not be a small error: put a
   * vapour-tight layer in the wrong place and the model either invents a
   * condensation plane that does not exist or hides one that does.
   *
   * Making it required means TypeScript enumerates every layer in the catalogue
   * and forces an explicit decision at each one, which is the same reason the
   * validation table is data rather than prose: an omission should be a
   * compile error, not a quiet default.
   *
   * Order-of-magnitude reference values:
   *   still air 1 · mineral wool ≈ 1.2 · earth/soil ≈ 8 · plaster, brick ≈ 10 ·
   *   timber ≈ 50 · EPS ≈ 60 · PUF ≈ 60 · plywood ≈ 100 · concrete ≈ 100 ·
   *   XPS ≈ 150 · coated fabric ≈ 3 000 · damp-proof membrane ≈ 50 000 ·
   *   aluminium foil and sheet steel ≈ 10⁶ (effectively a vapour barrier)
   */
  vapourResistivity: number;
  /**
   * Latent heat of fusion, J/kg. Present only on a phase-change layer.
   *
   * When set, the layer stores additional heat while its temperature crosses
   * `meltingPoint`, at almost no temperature rise. See
   * `thermal/assemblies.ts` for how this is modelled and what it cannot show.
   */
  latentHeat?: number;
  /** Phase-change (melting) temperature, °C. */
  meltingPoint?: number;
  /**
   * Half-width of the phase-change band, K.
   *
   * A real PCM melts over a range rather than at a point, and the width of that
   * range is what decides whether the material ever fully charges. Treated as
   * ±`phaseBand` around `meltingPoint`.
   */
  phaseBand?: number;
}

/**
 * A composite, multi-layer construction.
 *
 * Selected by id; the resolved `MaterialProperties` carries the stack so the
 * U-value, the areal mass and the daily storage depth are all derived from the
 * same description the build-up table prints.
 */
export interface CompositeAssembly {
  id: string;
  name: string;
  category: 'wall' | 'roof';
  /** Outside → inside. */
  layers: MaterialLayer[];
  /** One line on what the build-up is for. */
  note: string;
  /** Installed cost, ₹/m² of surface. */
  cost: number;
  /** Outer surface solar absorptance, 0–1. */
  solarAbsorptance: number;
  /** Outer surface long-wave emissivity, 0–1. */
  emissivity: number;
  /** Colour used by the 3D view for this assembly. */
  color: string;
  roughness: number;
  metalness: number;
}

export interface MaterialProperties {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Thermal conductivity λ, W/m·K. */
  thermalConductivity: number;
  /** Default layer thickness, metres. */
  thickness: number;
  /** Assembled U-value, W/m²·K. */
  uValue: number;
  /** Installed cost, currency units per m². */
  cost: number;
  /** Dry density, kg/m³. */
  density: number;
  /** Specific heat capacity, J/kg·K. */
  specificHeat: number;
  /** Solar absorptance of the outer surface, 0–1. */
  solarAbsorptance: number;
  /**
   * Water-vapour diffusion resistance factor, μ — dimensionless, air = 1.
   *
   * Optional on the catalogue entry because a material may be used either
   * directly or as part of a composite stack; the *layer* carries the required
   * value (see `MaterialLayer.vapourResistivity`). Every catalogue entry does
   * declare one, and a test asserts it, so the interstitial condensation check
   * never has to fall back to a guessed value.
   */
  vapourResistivity?: number;
  /** Long-wave emissivity of the outer surface, 0–1. */
  emissivity: number;
  /** Solar heat gain coefficient — windows only. */
  shgc?: number;
  /** Visible light transmittance — windows only. */
  vlt?: number;
  /** Air permeability, m³/h·m² at 50 Pa. Used for infiltration. */
  airPermeability?: number;
  /** Embodied carbon, kgCO₂e/m². */
  embodiedCarbon?: number;
  /** Tailwind-friendly swatch colour for the UI and 3D. */
  color: string;
  roughness: number;
  metalness: number;
  /** Short note shown in the material picker. */
  note: string;
  /**
   * The layer stack, when this assembly is composite.
   *
   * Present only on materials resolved from a `CompositeAssembly`. When it is
   * set, `effectiveUValue` and the thermal-mass calculation walk the stack
   * instead of using the single-layer `thickness` / `thermalConductivity`
   * fields — which are kept populated with the stack's *aggregate* values so
   * every other reader keeps working unchanged.
   */
  layers?: MaterialLayer[];
  /** True when the stack contains a phase-change layer. */
  hasPhaseChange?: boolean;
}

/* ------------------------------------------------------------------ */
/* Building type                                                       */
/* ------------------------------------------------------------------ */

/**
 * The shelter forms the app can design.
 *
 * Kept as a closed union rather than a free string so that every switch over it
 * is exhaustive: adding a type should produce a type error at each place that
 * needs to know about it, rather than silently falling through to a default.
 * The templates that give each id its parameters and massing live in
 * `lib/buildingTypes.ts`.
 *
 * The library is split in two families:
 *
 *   CIVIL   — the five original climate-responsive building forms. Kept because
 *             they are the reference cases the defence shelters are measured
 *             against, and because a civilian shelter is still a real use case.
 *   DEFENCE — the deployable shelter library the DRDO problem statement is
 *             actually about: tents, cabins, equipment shelters and bunkers.
 *
 * Every defence type is still a bundle of ordinary `BuildingParameters` plus a
 * massing descriptor — it is not a special case inside the physics engine. That
 * is what keeps the type selector from being decorative.
 */
export type BuildingTypeId =
  /* --- Civil (reference) --- */
  | 'single-family'
  | 'row-house'
  | 'low-rise'
  | 'vernacular'
  | 'modular-emergency'
  /* --- Defence shelter library --- */
  | 'high-altitude-tent'
  | 'desert-field-tent'
  | 'warm-humid-shelter'
  | 'modular-insulated-cabin'
  | 'comm-command-shelter'
  | 'equipment-shelter'
  | 'medical-field-shelter'
  | 'modular-prefab-shelter'
  | 'semi-underground-bunker';

/** Which family a shelter type belongs to. Drives the selector grouping. */
export type ShelterCategory = 'civil' | 'defence';

/* ------------------------------------------------------------------ */
/* Mission profile — what the shelter is deployed to do                */
/* ------------------------------------------------------------------ */

/**
 * The mission the shelter is deployed for.
 *
 * WHY THIS IS A FIRST-CLASS INPUT
 * A thermal requirement is not a property of a building, it is a property of a
 * *task*. A communication shelter is mostly equipment heat and wants to be cool
 * and dry; a personnel shelter is mostly occupant heat and wants a comfortable
 * band; a storage shelter wants almost nothing but to stay above freezing and
 * below the point where stores degrade. Feeding one occupancy-and-setpoint pair
 * to all three would make the tool answer the wrong question, so the mission
 * profile sets occupancy, activity, equipment load, operating hours and the
 * temperature/humidity targets, and the physics runs from there.
 */
export type MissionProfileId =
  | 'personnel-accommodation'
  | 'command-control'
  | 'communication'
  | 'medical'
  | 'equipment'
  | 'storage'
  | 'observation-post'
  | 'field-operations';

/* ------------------------------------------------------------------ */
/* Deployment / services vocabularies                                  */
/* ------------------------------------------------------------------ */

/** How leaky the deployed envelope is. Drives the infiltration term. */
export type InfiltrationClass = 'low' | 'medium' | 'high' | 'measured';

/** The active plant fitted to the shelter. */
export type HvacType =
  | 'none'
  | 'electric-heater'
  | 'diesel-heater'
  | 'heat-pump'
  | 'air-conditioner'
  | 'fan'
  | 'evaporative-cooler'
  | 'radiant-heater'
  | 'solar-thermal';

/** Where the shelter's energy comes from — a logistics fact, not just a kWh. */
export type PowerSource =
  | 'grid'
  | 'diesel-generator'
  | 'battery'
  | 'solar-pv'
  | 'solar-thermal'
  | 'hybrid';

/** Whether the shelter is being transported or standing. */
export type DeploymentState = 'packed' | 'deployed';

/** One item of equipment, as a count against the internal-load library. */
export interface EquipmentLoadItem {
  /** Id into `lib/internalLoads.ts`. */
  id: string;
  /** How many of this item. */
  count: number;
}

/* ------------------------------------------------------------------ */
/* Building parameters — the single source of truth for the 3D model    */
/* ------------------------------------------------------------------ */

export interface BuildingParameters {
  /* --- Form --- */
  /** Which shelter template this design follows. */
  buildingType: BuildingTypeId;
  /**
   * Storeys above ground.
   *
   * This is programme, not a search variable: how many storeys a household can
   * build is a fact about the household. It scales the envelope and the
   * conditioned floor area, which is why it belongs in the parameter set rather
   * than only in the renderer.
   */
  floors: number;

  /* --- Dimensions (metres) --- */
  /** Plan width, metres — the X span of one storey. */
  width: number;
  /** Plan length, metres — the Z span of one storey. */
  length: number;
  /** Floor-to-ceiling height of one storey, metres. */
  height: number;
  /** Exterior wall thickness, metres. */
  wallThickness: number;

  /* --- Programme --- */
  numOccupants: number;
  numRooms: number;
  budget: number;

  /* --- Orientation --- */
  /** Building azimuth: rotation of the long axis, degrees clockwise from north. */
  orientation: number;

  /* --- Envelope --- */
  /** Window-to-wall ratio for the whole envelope, 0–1. */
  windowToWallRatio: number;
  /** Per-facade multipliers so the optimiser can favour/avoid a facade. */
  facadeWeights: FacadeWeights;
  /**
   * Which facade the glazing is concentrated on.
   *
   * Optional so a design saved before this axis existed keeps the distribution
   * it was designed with. When set it *is* the distribution: `facadeWeights`
   * becomes derived, and `resolveFacadeWeights` is the only thing that should
   * read either of them.
   */
  glazingBias?: GlazingBiasId;
  wallMaterialId: string;
  roofMaterialId: string;
  windowMaterialId: string;
  /**
   * Composite, multi-layer wall assembly.
   *
   * When set it *replaces* `wallMaterialId`: the stack supplies the U-value, the
   * areal mass and the daily storage, and the single-material id is kept only so
   * the selection survives if the assembly is cleared. See
   * `thermal/assemblies.ts`.
   */
  wallAssemblyId?: string;
  /** Composite, multi-layer roof assembly. Replaces `roofMaterialId` when set. */
  roofAssemblyId?: string;
  /**
   * Door leaf material.
   *
   * Optional in the type so existing saved designs and the parameter panel do
   * not have to be migrated at once; `resolveMaterials` falls back to the
   * library default when it is absent.
   */
  doorMaterialId?: string;
  insulationLevel: InsulationLevel;
  /** Applied insulation thickness on top of the base assembly, metres. */
  insulationThickness: number;

  /* --- Roof --- */
  roofType: RoofStrategy;
  /** Roof pitch, degrees. Ignored for flat roofs. */
  roofAngle: number;
  /** Roof overhang beyond the wall face, metres. */
  roofOverhang: number;

  /* --- Shading & ventilation --- */
  shadingType: ShadingStrategy;
  /** Projection depth of the shading device, metres. */
  shadingDepth: number;
  ventilationType: VentilationStrategy;
  /** Volumetric air changes per hour from openings + infiltration. */
  airChangesPerHour: number;

  /* --- Services --- */
  coolingSetpoint: number;
  heatingSetpoint: number;
  /** Coefficient of performance of the active cooling system. */
  coolingCop: number;
  /** Seasonal efficiency of the heating system. */
  heatingEfficiency: number;
  /** Installed PV capacity, kWp. 0 disables. */
  solarPvKwp: number;

  /* --- Mission & deployment (defence evolution) ----------------------
   *
   * All optional, so every design saved before these axes existed keeps
   * loading unchanged and `resolveMaterials` / the thermal model fall back to
   * their current behaviour when a field is absent.
   */

  /**
   * The mission the shelter is deployed for.
   *
   * Sets occupancy, activity, equipment load and the temperature / humidity
   * targets. The physics then runs from those, so the same envelope can be
   * judged against a personnel brief and an equipment brief without changing a
   * single thermal constant.
   */
  missionProfile?: MissionProfileId;

  /**
   * The equipment actually carried, as counts against the internal-load
   * library. Seeded from the mission profile and then editable, because a real
   * deployment list is a fact about the unit rather than about the mission.
   */
  internalLoads?: EquipmentLoadItem[];

  /**
   * How leaky the deployed envelope is.
   *
   * Separate from `ventilationType` on purpose: intentional ventilation is a
   * control decision, leakage is a property of the seams, the door and the
   * fabric. Folding them into one ACH hides the single most improvable number
   * on a tent.
   */
  infiltrationClass?: InfiltrationClass;

  /** Measured air leakage, ACH at the design pressure. Used when class is `measured`. */
  infiltrationAch?: number;

  /** The active plant fitted. `none` means the shelter is judged free-running. */
  hvacType?: HvacType;

  /** Installed heating/cooling capacity, kW. 0 = unsized. */
  hvacCapacityKw?: number;

  /** Where the energy comes from — drives the fuel/logistics figures. */
  powerSource?: PowerSource;

  /** Transport or standing. Drives the packed-volume and mass figures. */
  deploymentState?: DeploymentState;
}

/** Relative glazing weighting per facade — lets the optimiser steer windows away from west. */
export interface FacadeWeights {
  north: number;
  east: number;
  south: number;
  west: number;
}

/**
 * A named facade-glazing distribution strategy.
 *
 * The optimiser searches these rather than the four continuous weights: a
 * four-dimensional real axis produces candidates nobody can describe or build,
 * and every candidate this tool recommends has to be explainable. The strategy
 * definitions live in `lib/glazingBias.ts`.
 */
export type GlazingBiasId =
  | 'balanced'
  | 'south-led'
  | 'south-east'
  | 'south-west'
  | 'north-shielded'
  | 'east-west';

/** A named, savable design configuration. */
export interface DesignPreset {
  id: string;
  label: string;
  description: string;
  parameters: BuildingParameters;
}

/* ------------------------------------------------------------------ */
/* Parametric geometry description (consumed by the 3D layer)          */
/* ------------------------------------------------------------------ */

/** A rectangular opening cut out of a wall panel, in wall-local coordinates. */
export interface WallOpening {
  /** Horizontal centre offset from wall centre, metres. */
  x: number;
  /** Vertical centre from the wall base, metres. */
  y: number;
  width: number;
  height: number;
  kind: 'window' | 'door' | 'vent';
  /** Optional label for the floor plan. */
  label?: string;
}

/** One wall panel of the parametric shelter. */
export interface WallPanel {
  /**
   * Local wall name. `front` is local +Z, `right` local +X, and so on.
   * Compass direction is given separately by `azimuth`, because the whole
   * building rotates when `orientation` changes.
   */
  id: LocalWallId;
  /**
   * What is on the other side of this wall.
   *
   * `exterior` faces the sky and takes the full conduction and solar load.
   * `party` is shared with a neighbouring unit: still built, still charged for,
   * still thermal mass — but with no outdoor exposure, so it contributes
   * nothing to the UA. Getting this distinction right is what makes a terrace
   * unit thermally different from a detached one of the same dimensions.
   */
  boundary: 'exterior' | 'party';
  /** Length along the facade, metres. */
  length: number;
  height: number;
  thickness: number;
  /** Position of the panel centre in building-local space. */
  position: [number, number, number];
  /** Y-rotation that faces the panel outward, radians. */
  rotationY: number;
  /** Facade outward normal azimuth in world degrees (0 = north). */
  azimuth: number;
  openings: WallOpening[];
  /** Glazed area on this facade, m². */
  glazingArea: number;
  /** Gross opaque facade area, m². */
  opaqueArea: number;
  /** Gross facade area before openings, m². */
  grossArea: number;
  /**
   * Door leaf area on this facade, m².
   *
   * Carried explicitly because it is *removed* from `opaqueArea` and then has
   * to be added back as its own conductance. A door is not a hole in the
   * thermal envelope — it is a thin, poorly insulated panel sitting in one, and
   * its U-value is nothing like the wall's. Leaving the area out of the balance
   * silently deletes the largest single infiltration-and-conduction path a
   * small shelter has.
   */
  doorArea: number;
  /** Vent opening area on this facade, m² — intentional openings, not leakage. */
  ventArea: number;
}

/** Local wall identifiers, independent of compass direction. */
export type LocalWallId = 'front' | 'back' | 'left' | 'right';

/** Roof geometry description. */
export interface RoofGeometry {
  type: RoofStrategy;
  /** Rise above the wall top, metres. */
  rise: number;
  overhang: number;
  /** Ridge runs along this local axis. */
  ridgeAxis: 'x' | 'z';
}

/** One storey's floor slab, for the renderer and the plan views. */
export interface FloorSlab {
  /** Storey index, 0 = ground. */
  level: number;
  /** Centre height of the slab, metres. */
  y: number;
  width: number;
  length: number;
}

/** A structural bay joint — the visible seam between prefabricated modules. */
export interface ModuleJoint {
  /** Offset from the building centre along the length axis, metres. */
  offset: number;
}

/** The full parametric description handed to the renderer. */
export interface ShelterGeometry {
  parameters: BuildingParameters;
  walls: WallPanel[];
  roof: RoofGeometry;
  /** Interior partition descriptions. */
  partitions: Partition[];
  /** Shading devices. */
  shading: ShadingDevice[];
  /** One entry per storey. */
  floorSlabs: FloorSlab[];
  /** Seams between prefabricated bays; empty for monolithic types. */
  moduleJoints: ModuleJoint[];
  /** Storey count, echoed from the parameters for the renderer's convenience. */
  floors: number;
  /**
   * Total height from ground to wall head, metres — `height × floors`.
   *
   * The renderer needs this rather than `parameters.height`, which is only one
   * storey. It is also the number every area below is derived from.
   */
  totalHeight: number;
  /** Gross floor area of all storeys, m² — the EUI denominator. */
  floorArea: number;
  /** Conditioned volume, m³. */
  volume: number;
  /** Total envelope area exposed to the sky (walls + roof), m². */
  envelopeArea: number;
  /**
   * Actual roof surface area, m² — sloped, and including the overhang.
   *
   * Carried explicitly rather than inferred. It used to be recovered as
   * `envelopeArea − wallArea`, which was only correct while every wall was an
   * exterior wall; once party walls exist the subtraction goes negative and a
   * row house loses its roof entirely from both the heat balance and the cost
   * estimate. A field that exists cannot be mis-derived.
   */
  roofArea: number;
  /**
   * Plan area of a single storey, m² — the ground the foundations and the floor
   * slab are actually built on.
   *
   * Distinct from `floorArea`, which is every storey summed. Pricing a
   * three-storey block's footings off `floorArea` would treble them.
   */
  groundFloorArea: number;
  /** Total glazed area, m². */
  glazingArea: number;
  /**
   * Total door leaf area, m².
   *
   * Its own conductance in the heat balance — see `ResolvedMaterials.door`.
   */
  doorArea: number;
  /** Total intentional vent opening area, m². */
  ventArea: number;
  /**
   * Opaque envelope area that actually faces outdoors, m² — the UA numerator.
   * Party walls are excluded, because nothing crosses them.
   */
  opaqueArea: number;
  /**
   * Total wall face area including party walls, m². Used as the window-to-wall
   * denominator and as the thermal-mass input: a party wall is still mass.
   */
  wallArea: number;
  /** The part of `wallArea` that faces outdoors, m². */
  exposedWallArea: number;
  /** The part of `wallArea` shared with a neighbour, m². */
  partyWallArea: number;
  /** Sun-facing azimuth of the largest glazed facade. */
  primaryGlazingAzimuth: number;
  /** Site footprint, m² — the ground the building occupies, not the floor area. */
  footprint: number;
}

/** An interior partition wall with door openings. */
export interface Partition {
  id: string;
  /** Centre position in building-local space. */
  position: [number, number, number];
  length: number;
  height: number;
  rotationY: number;
  doorOpenings: WallOpening[];
  label: string;
}

/** A shading device (overhang / louvre bank / blind / fin / verandah). */
export interface ShadingDevice {
  id: string;
  facade: LocalWallId;
  kind: 'overhang' | 'louvre' | 'blind' | 'verandah' | 'fin';
  /** Projection depth, metres. */
  depth: number;
  /** Vertical position above the wall base, metres. */
  y: number;
  /** Horizontal extent, metres. */
  span: number;
  /** Horizontal centre offset from the wall centre, metres. */
  x: number;
  /** Number of louvre slats (louvre banks only). */
  slats?: number;
  /** Slat tilt, degrees. */
  tilt?: number;
}

/** Materials bundle resolved from the ids in `BuildingParameters`. */
export interface ResolvedMaterials {
  wall: MaterialProperties;
  roof: MaterialProperties;
  window: MaterialProperties;
  insulation: MaterialProperties;
  /**
   * The door leaf assembly.
   *
   * A separate conductance rather than part of the wall, because a door is the
   * weakest thermal element in most small shelters: a 40 mm timber leaf sits
   * near U = 2.2 W/m²K against a 230 mm brick wall at U = 1.5, and it is also
   * where the air actually moves. Folding it into the wall would erase the one
   * envelope path a user can most easily improve.
   */
  door: MaterialProperties;
}

/** Glazing selector helper — maps the analysis vocabulary to a material id. */
export type { GlazingType };
