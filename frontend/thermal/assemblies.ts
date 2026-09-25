/**
 * Composite, multi-layer assemblies.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE MATERIAL LIBRARY
 * A material library answers "what is EPS?" — conductivity, density, cost. That
 * is not the question a designer asks. The question is "what does a 230 mm brick
 * wall *with* a 50 mm EPS layer do?", and the answer is not any single row in
 * the library: it is the stack, and it is dominated by the layer boundaries.
 *
 * A single-material view also cannot express the two things the problem
 * statement names explicitly:
 *
 *   - **Composite construction**, where no one material gives both the
 *     insulation and the storage. A rammed-earth wall stores beautifully and
 *     insulates poorly; adding an external mineral-wool layer fixes the
 *     insulation without giving up the mass. That is two materials doing two
 *     jobs, and it can only be described as a stack.
 *   - **Phase-change materials**, which store heat at nearly constant
 *     temperature. A PCM has no meaningful steady-state U-value at all — it is
 *     defined by its latent heat and its melting point — so it cannot be
 *     represented as an ordinary library entry.
 *
 * HOW PCM IS MODELLED, AND WHAT THAT CANNOT SHOW
 * The phase-change layer contributes latent storage through the *effective heat
 * capacity* method: while the layer's temperature sits inside its melting band,
 * its apparent specific heat is raised by `L / (2 · band)`, so it absorbs heat
 * with almost no temperature rise. This is the standard simplified treatment and
 * it reproduces the behaviour that matters for a design comparison — a PCM
 * charges while the room is warm and discharges while it cools.
 *
 * It does **not** resolve the melting front, the layer's position within the
 * build-up, or the conduction path through a partly melted slab. Placement in
 * particular is a first-order effect in reality and is not represented here. The
 * model will therefore show a PCM helping, doing nothing, or being dead weight —
 * and all three are legitimate results: **if the room never reaches the melting
 * point, the latent store never charges and the layer contributes nothing but
 * its sensible heat.** That is the honest finding, and it is why the melting
 * point is a parameter rather than a constant.
 */

import type { CompositeAssembly, MaterialLayer } from '@/types';

/* ------------------------------------------------------------------ */
/* Layer shorthand                                                     */
/* ------------------------------------------------------------------ */

function layer(
  name: string,
  thickness: number,
  conductivity: number,
  density: number,
  specificHeat: number,
  extra: Partial<MaterialLayer> = {},
): MaterialLayer {
  return { name, thickness, conductivity, density, specificHeat, ...extra };
}

/* ------------------------------------------------------------------ */
/* Assemblies                                                          */
/* ------------------------------------------------------------------ */

export const COMPOSITE_ASSEMBLIES: CompositeAssembly[] = [
  /* ---------------------------- Walls ---------------------------- */
  {
    id: 'brick-cavity-eps',
    name: 'Brick + cavity + EPS',
    category: 'wall',
    note: 'The standard insulated masonry build-up: mass inside, insulation outboard of a drained cavity.',
    cost: 3400,
    solarAbsorptance: 0.7,
    emissivity: 0.9,
    color: '#a4644f',
    roughness: 0.85,
    metalness: 0,
    layers: [
      layer('Brick outer leaf', 0.105, 0.7, 1800, 880),
      /* A drained cavity is a resistance, not a material: the effective
         conductivity folds in still-air conduction plus radiation across it. */
      layer('Drained cavity', 0.05, 0.28, 1.2, 1005),
      layer('EPS insulation', 0.05, 0.035, 25, 1400),
      layer('Internal plaster', 0.012, 0.5, 1300, 1000),
    ],
  },
  {
    id: 'earth-ext-insulation',
    name: 'Rammed earth + external insulation',
    category: 'wall',
    note: 'Mass on the inside, insulation on the outside — the passive-solar build-up for a cold, sun-rich site. The earth stores the day; the wool stops it leaving.',
    cost: 4200,
    solarAbsorptance: 0.55,
    emissivity: 0.9,
    color: '#8a6b4f',
    roughness: 0.95,
    metalness: 0,
    layers: [
      layer('Rendered mineral wool', 0.08, 0.04, 60, 840),
      layer('Rammed earth', 0.3, 0.8, 1900, 900),
      layer('Earth plaster', 0.015, 0.6, 1500, 1000),
    ],
  },
  {
    id: 'aac-puf',
    name: 'AAC + PUF (lightweight)',
    category: 'wall',
    note: 'Light and highly insulating, with very little mass. Fast to build and quick to overheat.',
    cost: 3800,
    solarAbsorptance: 0.55,
    emissivity: 0.9,
    color: '#e0dcd2',
    roughness: 0.8,
    metalness: 0,
    layers: [
      layer('AAC block', 0.2, 0.16, 600, 1000),
      layer('PUF board', 0.04, 0.025, 35, 1400),
      layer('Internal plaster', 0.012, 0.5, 1300, 1000),
    ],
  },
  {
    id: 'pcm-composite',
    name: 'Brick + PCM board + insulation',
    category: 'wall',
    note: 'A phase-change layer inboard of the insulation, melting near comfort temperature. Whether it helps depends entirely on whether the room reaches 24 °C.',
    cost: 7200,
    solarAbsorptance: 0.7,
    emissivity: 0.9,
    color: '#9c8b7a',
    roughness: 0.8,
    metalness: 0,
    layers: [
      layer('Mineral wool', 0.06, 0.04, 60, 840),
      layer('Brick', 0.15, 0.7, 1800, 880),
      layer('PCM board', 0.025, 0.22, 900, 2000, {
        latentHeat: 180_000,
        meltingPoint: 24,
        phaseBand: 3,
      }),
      layer('Internal plaster', 0.012, 0.5, 1300, 1000),
    ],
  },

  /* ---------------------------- Roofs ---------------------------- */
  {
    id: 'rcc-xps-roof',
    name: 'RCC slab + XPS + screed',
    category: 'roof',
    note: 'The conventional insulated flat roof. The slab is the mass; the XPS is the resistance.',
    cost: 4600,
    solarAbsorptance: 0.65,
    emissivity: 0.92,
    color: '#b9b3a8',
    roughness: 0.9,
    metalness: 0,
    layers: [
      layer('Screed and membrane', 0.04, 0.5, 1300, 1000),
      layer('XPS insulation', 0.075, 0.03, 35, 1400),
      layer('RCC slab', 0.12, 1.7, 2400, 880),
      layer('Ceiling plaster', 0.012, 0.5, 1300, 1000),
    ],
  },
  {
    id: 'mud-timber-roof',
    name: 'Mud + timber roof',
    category: 'roof',
    note: 'A heavy vernacular roof with real diurnal storage and no imported materials.',
    cost: 2600,
    solarAbsorptance: 0.6,
    emissivity: 0.9,
    color: '#7d6549',
    roughness: 1,
    metalness: 0,
    layers: [
      layer('Mud phuska', 0.15, 0.6, 1600, 880),
      layer('Timber joists and earth', 0.1, 0.14, 650, 1600),
    ],
  },
];

const BY_ID = new Map(COMPOSITE_ASSEMBLIES.map((a) => [a.id, a]));

export function assemblyById(id: string): CompositeAssembly | undefined {
  return BY_ID.get(id);
}

export function isAssemblyId(value: unknown): boolean {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Wall assemblies, for the parameter panel. */
export const WALL_ASSEMBLY_OPTIONS = [
  { value: '', label: 'Use the single-material wall above' },
  ...COMPOSITE_ASSEMBLIES.filter((a) => a.category === 'wall').map((a) => ({
    value: a.id,
    label: a.name,
  })),
];

/** Roof assemblies, for the parameter panel. */
export const ROOF_ASSEMBLY_OPTIONS = [
  { value: '', label: 'Use the single-material roof above' },
  ...COMPOSITE_ASSEMBLIES.filter((a) => a.category === 'roof').map((a) => ({
    value: a.id,
    label: a.name,
  })),
];

/* ------------------------------------------------------------------ */
/* Derived properties                                                  */
/* ------------------------------------------------------------------ */

/** Total assembled thickness, metres. */
export function assemblyThickness(assembly: CompositeAssembly): number {
  return assembly.layers.reduce((sum, l) => sum + l.thickness, 0);
}

/**
 * Thermal resistance of a stack of layers, m²·K/W — excluding surface films.
 *
 * Layers with a very high conductivity are still summed normally; the model has
 * no separate resistance for a drained cavity, which is instead expressed as a
 * low effective conductivity on the cavity layer.
 */
export function layersResistance(layers: readonly MaterialLayer[]): number {
  return layers.reduce((sum, l) => sum + l.thickness / Math.max(1e-4, l.conductivity), 0);
}

/** Thermal resistance of the stack alone, m²·K/W — excluding surface films. */
export function assemblyResistance(assembly: CompositeAssembly): number {
  return layersResistance(assembly.layers);
}

/** Areal mass of the stack, kg/m². */
export function assemblyArealMass(assembly: CompositeAssembly): number {
  return assembly.layers.reduce((sum, l) => sum + l.density * l.thickness, 0);
}

/** Weighted-mean density of the stack, kg/m³ — used for the aggregate view. */
export function assemblyMeanDensity(assembly: CompositeAssembly): number {
  const thickness = assemblyThickness(assembly);
  return thickness > 0 ? assemblyArealMass(assembly) / thickness : 0;
}

/**
 * Weighted-mean specific heat of the stack, J/kg·K.
 *
 * Weighted by mass, not by volume, because the sensible storage is Σ m·c_p.
 */
export function assemblyMeanSpecificHeat(assembly: CompositeAssembly): number {
  const mass = assemblyArealMass(assembly);
  if (mass <= 0) return 1000;
  const capacity = assembly.layers.reduce(
    (sum, l) => sum + l.density * l.thickness * l.specificHeat,
    0,
  );
  return capacity / mass;
}

/** Weighted-mean conductivity of the stack, W/m·K. */
export function assemblyMeanConductivity(assembly: CompositeAssembly): number {
  const thickness = assemblyThickness(assembly);
  const resistance = assemblyResistance(assembly);
  return thickness > 0 && resistance > 0 ? thickness / resistance : 0.5;
}

/** True when any layer changes phase. */
export function assemblyHasPhaseChange(assembly: CompositeAssembly): boolean {
  return assembly.layers.some((l) => (l.latentHeat ?? 0) > 0 && l.meltingPoint !== undefined);
}

/** The phase-change layers of an assembly, if any. */
export function phaseChangeLayers(assembly: CompositeAssembly): MaterialLayer[] {
  return assembly.layers.filter((l) => (l.latentHeat ?? 0) > 0 && l.meltingPoint !== undefined);
}

/** One-line build-up description, outside → inside. */
export function describeAssembly(assembly: CompositeAssembly): string {
  return assembly.layers
    .map((l) => `${Math.round(l.thickness * 1000)} mm ${l.name}`)
    .join(' · ');
}
