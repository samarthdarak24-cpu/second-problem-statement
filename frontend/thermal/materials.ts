/**
 * Material library.
 *
 * Thermal properties follow common Indian-market construction assemblies;
 * costs are indicative installed rates per m² in Indian rupees, suitable for a
 * comparative prototype but not a substitute for a tendered quotation.
 *
 * U-values stored here are for the bare assembly (surface films included). When
 * an insulation layer is added, `effectiveUValue` recomputes the assembly.
 */

import type {
  MaterialLayer,
  MaterialProperties,
  ResolvedMaterials,
  BuildingParameters,
} from '@/types';
import {
  assemblyById,
  assemblyHasPhaseChange,
  assemblyMeanConductivity,
  assemblyMeanDensity,
  assemblyMeanSpecificHeat,
  assemblyThickness,
  layersResistance,
} from './assemblies';

/**
 * Door leaf used when a design does not name one.
 *
 * Solid timber, because that is what most of the shelters this tool is aimed at
 * actually have. It is the worse of the two available leaves, which is the right
 * default: a model should not quietly assume an insulated composite door on a
 * design that never specified one.
 */
export const DEFAULT_DOOR_ID = 'door-timber';

/** Standard surface film resistances, m²·K/W. */
export const SURFACE_RESISTANCE = {
  /** Walls: internal 0.13 + external 0.04. */
  wall: 0.17,
  /** Roofs: internal 0.10 + external 0.04 (upward heat flow). */
  roof: 0.14,
  /** Windows: glazing surface films are already inside the rated U-value. */
  window: 0,
} as const;

function wall(
  id: string,
  name: string,
  conductivity: number,
  thickness: number,
  cost: number,
  density: number,
  specificHeat: number,
  solarAbsorptance: number,
  color: string,
  note: string,
  extra: Partial<MaterialProperties> = {},
): MaterialProperties {
  return {
    id,
    name,
    category: 'wall',
    thermalConductivity: conductivity,
    thickness,
    uValue: 1 / (thickness / conductivity + SURFACE_RESISTANCE.wall),
    cost,
    density,
    specificHeat,
    solarAbsorptance,
    emissivity: 0.9,
    airPermeability: 4,
    color,
    roughness: 0.9,
    metalness: 0,
    note,
    ...extra,
  };
}

function roof(
  id: string,
  name: string,
  conductivity: number,
  thickness: number,
  cost: number,
  density: number,
  specificHeat: number,
  solarAbsorptance: number,
  color: string,
  note: string,
  extra: Partial<MaterialProperties> = {},
): MaterialProperties {
  return {
    id,
    name,
    category: 'roof',
    thermalConductivity: conductivity,
    thickness,
    uValue: 1 / (thickness / conductivity + SURFACE_RESISTANCE.roof),
    cost,
    density,
    specificHeat,
    solarAbsorptance,
    emissivity: 0.9,
    airPermeability: 2,
    color,
    roughness: 0.8,
    metalness: 0,
    note,
    ...extra,
  };
}

function glazing(
  id: string,
  name: string,
  uValue: number,
  shgc: number,
  vlt: number,
  cost: number,
  note: string,
): MaterialProperties {
  return {
    id,
    name,
    category: 'window',
    thermalConductivity: 1.0,
    thickness: 0.004,
    uValue,
    cost,
    density: 2500,
    specificHeat: 840,
    solarAbsorptance: 0.06,
    emissivity: 0.84,
    airPermeability: 1,
    shgc,
    vlt,
    color: '#9ec9dd',
    roughness: 0.05,
    metalness: 0,
    note,
  };
}

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

/**
 * Door leaf assemblies.
 *
 * WHY DOORS ARE NOT WALLS
 * A door leaf is thin, often hollow, and always the place where air actually
 * moves. In a small shelter it is frequently the single worst thermal element —
 * a 40 mm solid timber leaf sits near U = 2.2 W/m²K against a 230 mm brick wall
 * at 1.5 — and it is the envelope path a user can most easily improve, by
 * choosing a better leaf. Modelling it as part of the wall erases that choice.
 *
 * `airPermeability` is the number that matters most here: a poorly fitted door
 * is a permanent hole in the envelope regardless of its U-value.
 */
function door(
  id: string,
  name: string,
  conductivity: number,
  thickness: number,
  uValue: number,
  density: number,
  specificHeat: number,
  solarAbsorptance: number,
  color: string,
  airPermeability: number,
  cost: number,
  note: string,
  extra: { embodiedCarbon?: number } = {},
): MaterialProperties {
  return {
    id,
    name,
    category: 'door',
    thermalConductivity: conductivity,
    thickness,
    uValue,
    cost,
    density,
    specificHeat,
    solarAbsorptance,
    emissivity: 0.9,
    airPermeability,
    color,
    roughness: 0.7,
    metalness: 0.05,
    note,
    ...extra,
  };
}

export const DOOR_MATERIALS: MaterialProperties[] = [
  door('door-timber', 'Solid timber door', 0.14, 0.04, 2.2, 650, 1600, 0.55,
    '#6b4a2f', 4.0, 9000,
    'Traditional plank door. Reasonable mass, poor air-tightness without draught sealing.',
    { embodiedCarbon: 45 }),
  door('door-insulated', 'Insulated composite door', 0.04, 0.055, 1.1, 700, 1400, 0.5,
    '#7d6a58', 2.0, 16000,
    'Foam-cored leaf with a sealed frame — roughly half the loss of a solid timber door.',
    { embodiedCarbon: 70 }),
  door('door-metal', 'Insulated steel door', 0.045, 0.06, 1.4, 1200, 480, 0.35,
    '#8d949c', 1.5, 19000,
    'Durable and airtight; a metal leaf is a poor insulator unless it is cored.',
    { embodiedCarbon: 130 }),
];

/* ------------------------------------------------------------------ */
/* Walls                                                               */
/* ------------------------------------------------------------------ */

export const WALL_MATERIALS: MaterialProperties[] = [
  wall('rcc', 'Reinforced concrete', 1.7, 0.15, 3400, 2400, 880, 0.65,
    '#b9b3a8', 'High strength and mass; poor insulator on its own.',
    { embodiedCarbon: 320 }),
  wall('brick', 'Burnt clay brick', 0.7, 0.23, 2350, 1800, 880, 0.7,
    '#9c5a4a', 'Familiar, breathable and reasonably insulating at 230 mm.',
    { embodiedCarbon: 210 }),
  wall('flyash-brick', 'Fly-ash brick', 0.55, 0.23, 2050, 1500, 900, 0.62,
    '#a8a29b', 'Lower embodied energy than fired clay; slightly better U-value.',
    { embodiedCarbon: 130 }),
  wall('aac', 'AAC block', 0.16, 0.2, 3100, 600, 1000, 0.55,
    '#e6e3da', 'Autoclaved aerated concrete — light, insulating, fast to build.',
    { embodiedCarbon: 180 }),
  wall('hollow-block', 'Hollow concrete block', 0.6, 0.2, 2600, 1400, 880, 0.68,
    '#c8c4ba', 'Cellular block that trades mass for insulation.',
    { embodiedCarbon: 160 }),
  wall('rammed-earth', 'Rammed earth', 0.8, 0.3, 1750, 1900, 900, 0.55,
    '#8a6b4f', 'Very high thermal mass — excellent where the day–night swing is large.',
    { embodiedCarbon: 40 }),
  wall('stone', 'Local stone masonry', 1.2, 0.35, 2200, 2200, 900, 0.6,
    '#8d8b86', 'Durable and locally available; heavy, with useful time lag.',
    { embodiedCarbon: 90 }),
  wall('insulated-aac', 'Insulated AAC wall', 0.16, 0.2, 4150, 620, 1000, 0.5,
    '#dcd9d0', 'AAC core with an integral 50 mm EPS layer — best wall U-value here.',
    { embodiedCarbon: 250 }),
];

/* ------------------------------------------------------------------ */
/* Roofs                                                               */
/* ------------------------------------------------------------------ */

export const ROOF_MATERIALS: MaterialProperties[] = [
  roof('rcc-slab', 'RCC slab with terrace', 1.7, 0.16, 3200, 2400, 880, 0.68,
    '#b5afa4', 'Standard flat roof; needs insulation or a reflective finish.',
    { embodiedCarbon: 300 }),
  roof('metal-sheet', 'Profiled metal sheet', 50, 0.0006, 1450, 7850, 480, 0.75,
    '#5b6068', 'Cheapest and lightest, but almost no thermal resistance.',
    { embodiedCarbon: 90 }),
  roof('reflective-roof', 'Reflective cool roof', 1.7, 0.16, 3550, 2400, 880, 0.28,
    '#f2f0ea', 'White high-albedo finish — cuts roof solar gain dramatically in hot climates.',
    { embodiedCarbon: 310 }),
  roof('insulated-roof', 'Insulated RCC roof', 1.7, 0.16, 4900, 2400, 880, 0.45,
    '#d8d3c8', 'RCC with a 75 mm XPS layer; the workhorse for hot and cold climates.',
    { embodiedCarbon: 420 }),
  roof('puf-panel', 'Insulated PUF panel', 0.024, 0.06, 4100, 40, 1400, 0.5,
    '#9aa3ad', 'Sandwich panel with a very low U-value; fast to erect.',
    { embodiedCarbon: 260 }),
  roof('mud-phuska', 'Mud-phuska thatch', 0.5, 0.25, 1250, 900, 1200, 0.5,
    '#a98b62', 'Traditional low-cost roof with excellent insulation and low embodied energy.',
    { embodiedCarbon: 25 }),
];

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

export const WINDOW_MATERIALS: MaterialProperties[] = [
  glazing('single', 'Single glazing 4 mm', 5.8, 0.85, 0.9, 1350,
    'Cheapest; large heat flow and high solar gain.'),
  glazing('double', 'Double glazing 4-12-4', 2.8, 0.76, 0.81, 3450,
    'Halves the conduction loss versus single glazing.'),
  glazing('double-lowe', 'Double low-E 4-12-4', 1.7, 0.42, 0.7, 4600,
    'Low-emissivity coating cuts radiant transfer and solar gain.'),
  glazing('triple', 'Triple low-E 4-12-4-12-4', 0.9, 0.34, 0.62, 7900,
    'Best insulation available here; justified only in severe climates.'),
];

/* ------------------------------------------------------------------ */
/* Insulation                                                          */
/* ------------------------------------------------------------------ */

export const INSULATION_MATERIALS: MaterialProperties[] = [
  {
    id: 'none', name: 'No added insulation', category: 'insulation',
    thermalConductivity: 0, thickness: 0, uValue: 0, cost: 0,
    density: 0, specificHeat: 0, solarAbsorptance: 0, emissivity: 0.9,
    color: '#4a5568', roughness: 1, metalness: 0,
    note: 'Bare assembly — no additional insulation layer.',
  },
  {
    id: 'eps', name: 'EPS board', category: 'insulation',
    thermalConductivity: 0.035, thickness: 0.05, uValue: 0, cost: 480,
    density: 20, specificHeat: 1400, solarAbsorptance: 0.5, emissivity: 0.9,
    color: '#e9e6df', roughness: 0.95, metalness: 0, embodiedCarbon: 12,
    note: 'Expanded polystyrene — cheapest rigid board.',
  },
  {
    id: 'xps', name: 'XPS board', category: 'insulation',
    thermalConductivity: 0.03, thickness: 0.05, uValue: 0, cost: 690,
    density: 35, specificHeat: 1450, solarAbsorptance: 0.5, emissivity: 0.9,
    color: '#9db8c9', roughness: 0.9, metalness: 0, embodiedCarbon: 22,
    note: 'Extruded polystyrene — moisture resistant, good for roofs.',
  },
  {
    id: 'puf', name: 'PUF spray/board', category: 'insulation',
    thermalConductivity: 0.024, thickness: 0.05, uValue: 0, cost: 860,
    density: 38, specificHeat: 1400, solarAbsorptance: 0.5, emissivity: 0.9,
    color: '#d6c9a8', roughness: 0.9, metalness: 0, embodiedCarbon: 30,
    note: 'Polyurethane foam — best insulation per millimetre.',
  },
  {
    id: 'mineral-wool', name: 'Mineral wool', category: 'insulation',
    thermalConductivity: 0.04, thickness: 0.05, uValue: 0, cost: 560,
    density: 60, specificHeat: 1030, solarAbsorptance: 0.5, emissivity: 0.9,
    color: '#d4b483', roughness: 1, metalness: 0, embodiedCarbon: 15,
    note: 'Fire-safe and vapour-permeable; good for cold climates.',
  },
  {
    id: 'coir', name: 'Coir board', category: 'insulation',
    thermalConductivity: 0.045, thickness: 0.05, uValue: 0, cost: 330,
    density: 100, specificHeat: 1500, solarAbsorptance: 0.5, emissivity: 0.9,
    color: '#8a6a44', roughness: 1, metalness: 0, embodiedCarbon: 4,
    note: 'Bio-based, very low embodied carbon; lower performance.',
  },
];

/* ------------------------------------------------------------------ */
/* Lookup + resolution                                                 */
/* ------------------------------------------------------------------ */

const ALL_MATERIALS: MaterialProperties[] = [
  ...WALL_MATERIALS,
  ...ROOF_MATERIALS,
  ...WINDOW_MATERIALS,
  ...INSULATION_MATERIALS,
  ...DOOR_MATERIALS,
];

export const MATERIAL_BY_ID: ReadonlyMap<string, MaterialProperties> = new Map(
  ALL_MATERIALS.map((m) => [m.id, m]),
);

export function getMaterial(id: string): MaterialProperties {
  return MATERIAL_BY_ID.get(id) ?? WALL_MATERIALS[1]!;
}

/** Map the climate analysis's glazing vocabulary onto a material id. */
export const GLAZING_ID: Record<string, string> = {
  single: 'single',
  double: 'double',
  'double-lowE': 'double-lowe',
  triple: 'triple',
};

/** Wall material that best matches a target insulation level. */
export function wallForInsulationLevel(level: string): string {
  switch (level) {
    case 'very-high':
      return 'insulated-aac';
    case 'high':
      return 'aac';
    case 'medium':
      return 'flyash-brick';
    case 'low':
      return 'brick';
    default:
      return 'brick';
  }
}

/** Roof material that best matches a target insulation level and climate. */
export function roofForInsulationLevel(level: string, solarRadiation: number): string {
  if (level === 'very-high' || level === 'high') return 'insulated-roof';
  if (solarRadiation >= 5.8) return 'reflective-roof';
  if (level === 'medium') return 'reflective-roof';
  return 'rcc-slab';
}

/** Insulation board that best matches a target insulation level. */
export function insulationForLevel(level: string): string {
  switch (level) {
    case 'very-high':
      return 'puf';
    case 'high':
      return 'xps';
    case 'medium':
      return 'eps';
    case 'low':
      return 'coir';
    default:
      return 'none';
  }
}

/**
 * Recompute an assembly's U-value with an added insulation layer.
 *
 * @param material base wall or roof assembly
 * @param insulation insulation board
 * @param insulationThickness applied thickness, metres
 */
export function effectiveUValue(
  material: MaterialProperties,
  insulation: MaterialProperties,
  insulationThickness: number,
): number {
  const surface =
    material.category === 'roof'
      ? SURFACE_RESISTANCE.roof
      : material.category === 'window'
        ? SURFACE_RESISTANCE.window
        : SURFACE_RESISTANCE.wall;

  // Windows are rated as a whole unit; added insulation does not apply.
  if (material.category === 'window') return material.uValue;

  /* A composite's resistance is summed from its layers rather than taken from
     the aggregate fields. The two agree, but reading the stack says *why* the
     number is what it is, and it keeps the assembly as the single source of
     truth if the aggregate ever drifts. */
  const rBase =
    material.layers && material.layers.length > 0
      ? layersResistance(material.layers)
      : material.thickness / material.thermalConductivity;

  const rInsulation =
    insulation.thermalConductivity > 0 && insulationThickness > 0
      ? insulationThickness / insulation.thermalConductivity
      : 0;

  return 1 / Math.max(0.05, rBase + rInsulation + surface);
}

/** Resolve the four material slots referenced by a parameter set. */
export function resolveMaterials(parameters: BuildingParameters): ResolvedMaterials {
  const wallBase = getMaterial(parameters.wallMaterialId);
  const roofBase = getMaterial(parameters.roofMaterialId);

  return {
    /* A composite assembly, when one is selected, *replaces* the single-material
       wall or roof. The aggregate fields are filled in from the stack so every
       downstream reader — cost, 3D colour, the descriptions — keeps working,
       and `layers` is carried so the U-value and the thermal mass can walk the
       stack instead. */
    wall: resolveAssembly(parameters.wallAssemblyId, 'wall', wallBase),
    roof: resolveAssembly(parameters.roofAssemblyId, 'roof', roofBase),
    window: getMaterial(parameters.windowMaterialId),
    insulation: getMaterial(insulationForLevel(parameters.insulationLevel)),
    door: getMaterial(parameters.doorMaterialId ?? DEFAULT_DOOR_ID),
  };
}

/**
 * MaterialProperties for a selected assembly, or the base material unchanged.
 *
 * The base material's own identity is preserved in `id` so the UI keeps showing
 * a stable key, while `name` reports the build-up so the resolved specification
 * panel names what is actually being built.
 */
function resolveAssembly(
  assemblyId: string | undefined,
  category: 'wall' | 'roof',
  base: MaterialProperties,
): MaterialProperties {
  if (!assemblyId) return base;
  const assembly = assemblyById(assemblyId);
  if (!assembly || assembly.category !== category) return base;

  return {
    ...base,
    id: assembly.id,
    name: assembly.name,
    thickness: assemblyThickness(assembly),
    thermalConductivity: assemblyMeanConductivity(assembly),
    density: assemblyMeanDensity(assembly),
    specificHeat: assemblyMeanSpecificHeat(assembly),
    cost: assembly.cost,
    solarAbsorptance: assembly.solarAbsorptance,
    emissivity: assembly.emissivity,
    color: assembly.color,
    roughness: assembly.roughness,
    metalness: assembly.metalness,
    note: assembly.note,
    layers: assembly.layers,
    hasPhaseChange: assemblyHasPhaseChange(assembly),
  };
}

/** Effective U-values for a resolved assembly, W/m²·K. */
export interface EffectiveUValues {
  wall: number;
  roof: number;
  window: number;
  /** Door leaf U-value. Insulation is never applied to a door leaf. */
  door: number;
}

export function effectiveUValues(
  materials: ResolvedMaterials,
  insulationThickness: number,
): EffectiveUValues {
  return {
    wall: effectiveUValue(materials.wall, materials.insulation, insulationThickness),
    roof: effectiveUValue(materials.roof, materials.insulation, insulationThickness),
    window: materials.window.uValue,
    door: materials.door.uValue,
  };
}

/**
 * Thermal admittance (areal heat capacity) of a wall assembly, kJ/m²·K.
 * Used to judge how much thermal mass the envelope contributes. */
export function arealHeatCapacity(material: MaterialProperties): number {
  return (material.density * material.specificHeat * material.thickness) / 1000;
}

/* ------------------------------------------------------------------ */
/* Diurnal storage                                                     */
/* ------------------------------------------------------------------ */

/** Angular frequency of the daily cycle, rad/s. */
const DIURNAL_OMEGA = (2 * Math.PI) / 86400;

/**
 * How deep the daily temperature wave penetrates a material, metres.
 *
 *     δ = sqrt(2·α / ω),     α = k / (ρ · c_p)
 *
 * Heat diffusing into a solid is attenuated exponentially with depth, so beyond
 * δ the material never sees the day at all — it sits at the weekly mean. For the
 * materials in this library δ is remarkably small: about **115 mm** for rammed
 * earth, 135 mm for concrete, 105 mm for a mud roof.
 */
export function diurnalPenetrationDepth(
  conductivity: number,
  density: number,
  specificHeat: number,
): number {
  const diffusivity = conductivity / Math.max(1e-9, density * specificHeat);
  return Math.sqrt((2 * diffusivity) / DIURNAL_OMEGA);
}

/**
 * Apparent specific heat of a layer at a given temperature, J/kg·K.
 *
 * THE EFFECTIVE HEAT CAPACITY METHOD
 * A phase-change material absorbs its latent heat over the melting band rather
 * than at a point, so within that band it behaves as though its specific heat
 * were raised by `L / (2·band)`. Outside the band it is an ordinary solid and
 * contributes only sensible storage.
 *
 * That "outside the band" branch is the whole point. **If the space never
 * reaches the melting point, the latent store never charges and the PCM is dead
 * weight.** The model reproduces that honestly rather than assuming a PCM helps,
 * which is why the melting point is a parameter.
 */
export function apparentSpecificHeat(layer: MaterialLayer, atTemperatureC: number): number {
  const latent = layer.latentHeat ?? 0;
  if (latent <= 0 || layer.meltingPoint === undefined) return layer.specificHeat;

  const band = Math.max(0.25, layer.phaseBand ?? 2);
  const distance = Math.abs(atTemperatureC - layer.meltingPoint);
  if (distance > band) return layer.specificHeat;

  /* Triangular weighting across the band: the full latent term at the melting
     point, tapering to zero at the band edge. A step function would make the
     stored energy discontinuous in temperature and stall the swing model. */
  const weight = 1 - distance / band;
  return layer.specificHeat + (latent / (2 * band)) * weight;
}

/**
 * Diurnal areal heat capacity of a construction, J/m²·K.
 *
 * Only the outer `min(L, δ)` of each layer takes part in the daily cycle, so a
 * 450 mm earth wall contributes roughly a quarter of its mass. Using the full
 * thickness inflates the time constant about four-fold and over-damps the room
 * to the point where a Ladakhi shelter appears to swing 0.6 K across a 15 K day
 * — which erases the mechanism the problem statement is about.
 *
 * @param atTemperatureC the temperature the storage is evaluated at. It only
 *        affects phase-change layers; every other layer is temperature-independent.
 */
export function diurnalArealCapacity(
  material: MaterialProperties,
  atTemperatureC: number,
): number {
  /* Composite: walk the stack, because each layer has its own penetration
     depth. A 50 mm insulation layer participates fully while the 300 mm earth
     behind it contributes only its outer skin — and averaging them into one
     pseudo-material would get both wrong. */
  if (material.layers && material.layers.length > 0) {
    return material.layers.reduce((sum, l) => {
      const depth = diurnalPenetrationDepth(l.conductivity, l.density, l.specificHeat);
      const effective = Math.min(l.thickness, depth);
      return sum + l.density * effective * apparentSpecificHeat(l, atTemperatureC);
    }, 0);
  }

  /* Single material. */
  const depth = diurnalPenetrationDepth(
    material.thermalConductivity,
    material.density,
    material.specificHeat,
  );
  return material.density * Math.min(material.thickness, depth) * material.specificHeat;
}
