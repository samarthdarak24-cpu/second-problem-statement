/**
 * Construction and lifecycle cost model.
 *
 * Rates are Indian market indicative figures (₹, 2024–25) for a small
 * single-storey shelter, held in one `COST_BOOK` so they can be audited and
 * updated in one place. Material unit costs come from the material catalogue
 * itself, so changing a material's cost in `thermal/materials.ts` flows through
 * to the cost model with no second edit.
 *
 * WHAT THIS IS NOT
 * Not a quantity surveyor's estimate. It excludes land, statutory approvals,
 * site-specific foundation design and contractor margin beyond the stated
 * overhead. It exists to make the cost *trade-off* between designs visible,
 * which is what the optimiser needs, and the UI labels it accordingly.
 */

import type {
  BuildingParameters,
  CostEstimate,
  CostLineItem,
  ResolvedMaterials,
  ShelterGeometry,
} from '@/types';
import type { DesignMetrics } from '@/thermal/metrics';
import { getMaterial } from '@/thermal/materials';

/* ------------------------------------------------------------------ */
/* Rate book                                                           */
/* ------------------------------------------------------------------ */

export const COST_BOOK = {
  /** Excavation, PCC and RCC footings, per m² of footprint. */
  foundationPerSqm: 1850,
  /** Floor slab, screed and finish, per m². */
  floorPerSqm: 1250,
  /** Plaster, paint and internal finishes, per m² of wall. */
  finishesPerSqmWall: 420,
  /** Doors and internal partitions, per m² of floor. */
  partitionsPerSqm: 900,
  /** Labour as a share of the material subtotal. */
  labourFactor: 0.28,
  /** Contractor overhead and profit. */
  overheadFactor: 0.12,
  /** Contingency. */
  contingencyFactor: 0.05,

  /** Installed split-system cooling, ₹ per kW of peak capacity. */
  coolingPerKw: 28000,
  /** Installed heating (heat pump / solid-fuel back boiler), ₹ per kW. */
  heatingPerKw: 22000,
  /** Rooftop PV, ₹ per kWp installed. */
  pvPerKwp: 52000,
  /** Battery/balance-of-system allowance, ₹ per kWp. */
  pvBosPerKwp: 12000,

  /** Shading device, ₹ per m² of shaded opening, by strategy. */
  shadingPerSqm: {
    none: 0,
    overhang: 2200,
    'deep-verandah': 3600,
    louvre: 4800,
    combined: 6400,
    'external-blind': 5200,
  } as Record<string, number>,

  /** Roof construction uplift over the base slab, by roof strategy. */
  roofUplift: {
    flat: 0,
    shed: 450,
    gable: 900,
    hip: 1100,
    vaulted: 1400,
  } as Record<string, number>,

  /** Electricity tariff, ₹/kWh, all-in commercial-residential blend. */
  tariffPerKwh: 8.5,
  /** Annual tariff escalation. */
  tariffEscalation: 0.045,
  /** Analysis period, years. */
  analysisYears: 20,
  /** Real discount rate for present-value running costs. */
  discountRate: 0.07,
} as const;

/* ------------------------------------------------------------------ */
/* Main estimate                                                       */
/* ------------------------------------------------------------------ */

export interface CostInputs {
  parameters: BuildingParameters;
  materials: ResolvedMaterials;
  geometry: ShelterGeometry;
  metrics: DesignMetrics;
}

export function estimateCost({
  parameters,
  materials,
  geometry,
  metrics,
}: CostInputs): CostEstimate {
  const items: CostLineItem[] = [];

  const push = (
    id: string,
    label: string,
    category: CostLineItem['category'],
    quantity: number,
    unit: string,
    unitCost: number,
    note?: string,
  ) => {
    if (quantity <= 0 || unitCost <= 0) return;
    items.push({
      id,
      label,
      category,
      quantity: round2(quantity),
      unit,
      unitCost: Math.round(unitCost),
      total: Math.round(quantity * unitCost),
      note,
    });
  };

  /* Foundations and the floor slab are built once, on the ground plan — not once
     per storey. `floorArea` is every storey summed, so using it here would
     treble the substructure of a three-storey block. */
  const footprint = geometry.groundFloorArea;
  const roofArea = geometry.roofArea;

  /* --- Substructure and floors ------------------------------------- */
  push(
    'foundation',
    'Foundation and substructure',
    'structure',
    footprint,
    'm²',
    COST_BOOK.foundationPerSqm,
    'Excavation, PCC and RCC footings',
  );
  push('floor', 'Floor slab and finish', 'finishes', footprint, 'm²', COST_BOOK.floorPerSqm);

  /* --- Walls -------------------------------------------------------- */
  push(
    'walls',
    `${materials.wall.name} walls`,
    'envelope',
    geometry.wallArea,
    'm²',
    materials.wall.cost,
    `U-value ${(materials.wall.uValue || 0).toFixed(2)} W/m²K`,
  );

  /* --- Insulation --------------------------------------------------- */
  const insulationThickness = Math.max(0, parameters.insulationThickness);
  if (insulationThickness > 0 && materials.insulation.cost > 0) {
    /*
     * Insulation is priced per m² at its catalogue board thickness, so a thicker
     * layer costs proportionally more — 150 mm of XPS is three times the price
     * of 50 mm, not the same price.
     */
    const reference = materials.insulation.thickness;
    const scale = reference > 0 ? insulationThickness / reference : 1;
    push(
      'insulation',
      `${materials.insulation.name} insulation`,
      'envelope',
      geometry.envelopeArea,
      'm²',
      materials.insulation.cost * scale,
      `${Math.round(insulationThickness * 1000)} mm to walls and roof`,
    );
  }

  /* --- Roof --------------------------------------------------------- */
  push(
    'roof',
    `${materials.roof.name} roof`,
    'roof',
    roofArea,
    'm²',
    materials.roof.cost,
    parameters.roofType === 'flat'
      ? undefined
      : `${capitalise(parameters.roofType.replace('-', ' '))} form`,
  );
  const uplift = COST_BOOK.roofUplift[parameters.roofType] ?? 0;
  push(
    'roof-form',
    'Roof form and framing',
    'roof',
    roofArea,
    'm²',
    uplift,
    `Additional cost of a ${parameters.roofType.replace('-', ' ')} roof`,
  );

  /* --- Glazing ------------------------------------------------------ */
  push(
    'glazing',
    `${materials.window.name}`,
    'glazing',
    geometry.glazingArea,
    'm²',
    materials.window.cost,
    `U ${(materials.window.uValue || 0).toFixed(2)} · SHGC ${(materials.window.shgc ?? 0).toFixed(2)}`,
  );

  /* --- Shading ------------------------------------------------------ */
  const shadedArea = geometry.glazingArea;
  const shadingRate = COST_BOOK.shadingPerSqm[parameters.shadingType] ?? 0;
  push(
    'shading',
    `${capitalise(parameters.shadingType.replace('-', ' '))} shading`,
    'shading',
    shadedArea,
    'm²',
    shadingRate,
    parameters.shadingDepth > 0 ? `${parameters.shadingDepth} m projection` : undefined,
  );

  /* --- Partitions and finishes ------------------------------------- */
  push(
    'partitions',
    'Internal partitions and doors',
    'structure',
    footprint,
    'm²',
    COST_BOOK.partitionsPerSqm,
    `${parameters.numRooms} room${parameters.numRooms === 1 ? '' : 's'}`,
  );
  push(
    'finishes',
    'Internal finishes',
    'finishes',
    geometry.wallArea,
    'm²',
    COST_BOOK.finishesPerSqmWall,
  );

  /* --- Services ----------------------------------------------------- */
  push(
    'cooling',
    'Cooling plant',
    'services',
    metrics.peakCoolingLoad,
    'kW',
    COST_BOOK.coolingPerKw,
    `Peak load ${metrics.peakCoolingLoad.toFixed(1)} kW`,
  );
  push(
    'heating',
    'Heating plant',
    'services',
    metrics.peakHeatingLoad,
    'kW',
    COST_BOOK.heatingPerKw,
    `Peak load ${metrics.peakHeatingLoad.toFixed(1)} kW`,
  );
  if (parameters.solarPvKwp > 0) {
    push(
      'pv',
      'Rooftop solar PV',
      'services',
      parameters.solarPvKwp,
      'kWp',
      COST_BOOK.pvPerKwp,
      `${parameters.solarPvKwp} kWp array`,
    );
    push(
      'pv-bos',
      'PV balance of system',
      'services',
      parameters.solarPvKwp,
      'kWp',
      COST_BOOK.pvBosPerKwp,
      'Inverter, mounting and protection',
    );
  }

  /* --- Labour, overhead and contingency ---------------------------- */
  const materialSubtotal = items.reduce((sum, item) => sum + item.total, 0);
  const labour = materialSubtotal * COST_BOOK.labourFactor;
  items.push({
    id: 'labour',
    label: 'Labour',
    category: 'structure',
    quantity: 1,
    unit: 'lump sum',
    unitCost: Math.round(labour),
    total: Math.round(labour),
    note: `${(COST_BOOK.labourFactor * 100).toFixed(0)} % of material cost`,
  });

  const afterLabour = materialSubtotal + labour;
  const overhead = afterLabour * COST_BOOK.overheadFactor;
  const contingency = afterLabour * COST_BOOK.contingencyFactor;

  items.push({
    id: 'overhead',
    label: 'Contractor overhead and profit',
    category: 'structure',
    quantity: 1,
    unit: 'lump sum',
    unitCost: Math.round(overhead),
    total: Math.round(overhead),
    note: `${(COST_BOOK.overheadFactor * 100).toFixed(0)} %`,
  });
  items.push({
    id: 'contingency',
    label: 'Contingency',
    category: 'structure',
    quantity: 1,
    unit: 'lump sum',
    unitCost: Math.round(contingency),
    total: Math.round(contingency),
    note: `${(COST_BOOK.contingencyFactor * 100).toFixed(0)} %`,
  });

  const servicesCost = items
    .filter((item) => item.category === 'services')
    .reduce((sum, item) => sum + item.total, 0);
  const constructionCost = items
    .filter((item) => item.category !== 'services')
    .reduce((sum, item) => sum + item.total, 0);
  const totalCost = constructionCost + servicesCost;

  /* --- Lifecycle ---------------------------------------------------- */
  const lifecycleEnergyCost = presentValueEnergyCost(metrics.annualEnergy);

  return {
    lineItems: items,
    constructionCost: Math.round(constructionCost),
    servicesCost: Math.round(servicesCost),
    totalCost: Math.round(totalCost),
    costPerSqm: Math.round(totalCost / Math.max(1, footprint)),
    lifecycleEnergyCost: Math.round(lifecycleEnergyCost),
    twentyYearCost: Math.round(totalCost + lifecycleEnergyCost),
    withinBudget: parameters.budget <= 0 || totalCost <= parameters.budget,
    budgetDelta: Math.round(totalCost - parameters.budget),
  };
}

/**
 * Present value of the energy bill over the analysis period.
 *
 * Escalating tariff discounted at the real rate, summed year by year rather
 * than using a closed-form annuity — the two rates are close enough that the
 * annuity shortcut would visibly distort the answer.
 */
export function presentValueEnergyCost(annualKwh: number): number {
  let total = 0;
  for (let year = 0; year < COST_BOOK.analysisYears; year += 1) {
    const tariff = COST_BOOK.tariffPerKwh * (1 + COST_BOOK.tariffEscalation) ** year;
    const discount = (1 + COST_BOOK.discountRate) ** year;
    total += (annualKwh * tariff) / discount;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Cost of a single material, exposed for the material picker UI. */
export function materialUnitCost(id: string): number {
  return getMaterial(id).cost;
}
