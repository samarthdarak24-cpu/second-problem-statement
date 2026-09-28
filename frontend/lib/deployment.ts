/**
 * Deployability — the logistics half of the design.
 *
 * WHY THIS IS A FIRST-CLASS OUTPUT
 * For a building, mass and deployment time are irrelevant: it is built where it
 * stands and it never moves. For a deployed shelter they are frequently the
 * binding constraint. A design that is 4 K more comfortable but needs a crane
 * and six hours to erect has not solved the problem, it has moved it. So mass,
 * packed volume, panel count, manpower and the daily fuel and electrical draw
 * are computed from the same geometry and materials the physics used, and they
 * appear in the design summary and the report.
 *
 * HOW THE MASS IS DERIVED
 * By walking the resolved assembly, exactly as the U-value and the daily storage
 * are: Σ ρᵢ·Lᵢ per m², times the area the surface actually has. A tent wall
 * comes out near 5 kg/m² and a masonry wall near 200, and that two-order-of-
 * magnitude gap is the reason the two behave so differently — so the number is
 * a *result of the physics*, not a separate table that could disagree with it.
 *
 * WHAT IT IS NOT
 * A logistics plan. It does not know about pallets, vehicles, terrain or
 * packaging, and the deployment time is a simple function of panel count and
 * mass rather than a task analysis. It is a comparison tool between designs.
 */

import type { BuildingParameters, ResolvedMaterials, ShelterGeometry } from '@/types';
import { buildingType } from './buildingTypes';
import { missionProfile } from './missions';

export interface DeploymentMetrics {
  /** Mass of the envelope the shelter is made of, kg. */
  envelopeMassKg: number;
  /** Envelope plus the floor mat and fittings, kg. */
  totalMassKg: number;
  /** Interior volume when standing, m³. */
  deployedVolumeM3: number;
  /** Volume when packed for transport, m³. */
  packedVolumeM3: number;
  /** Packed volume as a fraction of deployed volume. 1 = not packable. */
  packingFactor: number;
  /** Repeated structural bays / prefabricated panels. */
  panelCount: number;
  /** Estimated erection time, minutes. 0 for a site-built shelter. */
  deploymentTimeMin: number;
  /** People needed to erect it. 0 for a site-built shelter. */
  manpowerRequired: number;
  /** Volume the shelter occupies in transport, m³ (packed + handling margin). */
  transportVolumeM3: number;
  /** Daily electrical draw, kWh/day. */
  dailyElectricalKwh: number;
  /** Daily fuel demand, litres/day. 0 when nothing burns fuel. */
  dailyFuelLitres: number;
  /** Total daily delivered energy, kWh/day. */
  dailyEnergyKwh: number;
  /** True when the shelter is a transportable, deployable type. */
  deployable: boolean;
  notes: string[];
}

/**
 * Packing factor by wall material — how much of the standing volume the packed
 * shelter takes up.
 *
 * A coated-fabric tent rolls down to well under a tenth of its erected volume;
 * a rigid panel cabin packs at roughly a fifth to a quarter; a masonry or
 * earth-bermed shelter is built in place and does not pack at all.
 */
const PACKING_FACTOR: Record<string, number> = {
  'pvc-fabric': 0.08,
  'pu-fabric': 0.07,
  'sandwich-panel': 0.22,
  'insulated-panel': 0.24,
  'steel-sheet': 0.26,
  aac: 0.4,
  'insulated-aac': 0.45,
  'hollow-block': 0.55,
  rcc: 1,
  brick: 1,
  'flyash-brick': 1,
  'rammed-earth': 1,
  stone: 1,
  'soil-berm': 1,
};

/** Glazing and door unit masses, kg/m² — framed, not bare glass. */
const GLAZING_AREAL_MASS = 25;
const DOOR_AREAL_MASS = 35;
/** Groundsheet / floor mat, kg/m². */
const FLOOR_MAT_AREAL_MASS = 12;
/** Diesel energy content, kWh per litre — for the fuel figure. */
const DIESEL_KWH_PER_LITRE = 10;

/**
 * Compute the deployability profile for a design.
 *
 * @param annualEnergyKwh the design's annual delivered energy, kWh/yr
 */
export function computeDeploymentMetrics(
  geometry: ShelterGeometry,
  materials: ResolvedMaterials,
  parameters: BuildingParameters,
  annualEnergyKwh: number,
): DeploymentMetrics {
  const template = buildingType(parameters.buildingType);
  const mission = parameters.missionProfile ? missionProfile(parameters.missionProfile) : null;

  const wallArealMass = arealMassOf(materials.wall);
  const roofArealMass = arealMassOf(materials.roof);

  const envelopeMassKg =
    geometry.wallArea * wallArealMass +
    geometry.roofArea * roofArealMass +
    geometry.glazingArea * GLAZING_AREAL_MASS +
    geometry.doorArea * DOOR_AREAL_MASS;

  const floorMatMass = geometry.groundFloorArea * FLOOR_MAT_AREAL_MASS;
  const totalMassKg = envelopeMassKg + floorMatMass;

  const deployedVolumeM3 = geometry.volume;
  /* Keyed on the *base* wall material, not the resolved one: when a composite
     assembly is selected, `resolveMaterials` reports the assembly's own id, so
     looking the packing factor up on `materials.wall.id` would miss every
     layered shelter and silently report it as unpackable. */
  const packingFactor = PACKING_FACTOR[parameters.wallMaterialId] ?? 1;
  const packedVolumeM3 = deployedVolumeM3 * packingFactor;
  const deployable = packingFactor < 0.9;

  const panelCount = template.massing.modules;

  /* Erection time: a base camp routine, plus a term per panel, plus a term for
     the mass that has to be manhandled. Chosen so a two-person tent lands near
     half an hour and a crane-set cabin near two hours. */
  const deploymentTimeMin = deployable
    ? Math.round(20 + panelCount * 18 + totalMassKg / 45)
    : 0;

  const manpowerRequired = deployable
    ? Math.min(12, Math.max(2, Math.round(2 + totalMassKg / 400)))
    : 0;

  const transportVolumeM3 = packedVolumeM3 * 1.15;

  const annualDailyKwh = annualEnergyKwh / 365;
  const missionKwh =
    mission && mission.powerDemandKw > 0
      ? mission.powerDemandKw * (mission.operatingHours / 24) * 24
      : 0;
  const dailyElectricalKwh = annualDailyKwh + missionKwh;
  const dailyEnergyKwh = dailyElectricalKwh;

  /* Fuel only exists when something burns it. A diesel heater or a diesel
     generator is the case the logistics figure is for. */
  const burnsFuel =
    parameters.hvacType === 'diesel-heater' ||
    parameters.powerSource === 'diesel-generator';
  const dailyFuelLitres = burnsFuel ? dailyEnergyKwh / DIESEL_KWH_PER_LITRE : 0;

  const notes: string[] = [];
  notes.push(
    `Envelope ${envelopeMassKg.toFixed(0)} kg · floor mat ${floorMatMass.toFixed(0)} kg, from the resolved assemblies.`,
  );
  if (!deployable) {
    notes.push(
      `${template.label} is site-built: it does not pack down, so deployment time and manpower are not reported.`,
    );
  }
  if (packingFactor <= 0.1) {
    notes.push('Fabric envelope — packs to under a tenth of its standing volume.');
  }
  if (burnsFuel) {
    notes.push('Fuel demand is derived from the delivered energy at 10 kWh per litre of diesel.');
  }

  return {
    envelopeMassKg: round0(envelopeMassKg),
    totalMassKg: round0(totalMassKg),
    deployedVolumeM3: round1(deployedVolumeM3),
    packedVolumeM3: round2(packedVolumeM3),
    packingFactor,
    panelCount,
    deploymentTimeMin,
    manpowerRequired,
    transportVolumeM3: round2(transportVolumeM3),
    dailyElectricalKwh: round2(dailyElectricalKwh),
    dailyFuelLitres: round2(dailyFuelLitres),
    dailyEnergyKwh: round2(dailyEnergyKwh),
    deployable,
    notes,
  };
}

/** Areal mass of a resolved material, kg/m² — walks the layer stack when present. */
export function arealMassOf(material: { density: number; thickness: number; layers?: Array<{ density: number; thickness: number }> }): number {
  if (material.layers && material.layers.length > 0) {
    return material.layers.reduce((sum, layer) => sum + layer.density * layer.thickness, 0);
  }
  return material.density * material.thickness;
}

function round0(value: number): number {
  return Math.round(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
