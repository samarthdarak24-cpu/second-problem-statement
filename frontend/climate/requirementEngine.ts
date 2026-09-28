/**
 * Area-specific requirement engine.
 *
 * WHAT IT DOES
 * Takes a resolved location (via its fingerprint), a mission and a shelter type
 * and produces the *initial* thermal design requirements: insulation, wall and
 * roof build-up, reflectance, shading, orientation, ventilation, infiltration
 * target, HVAC and moisture control. Every requirement is tagged with the
 * fingerprint index that drove it, so the recommendation is explainable rather
 * than asserted.
 *
 * WHAT IT IS NOT
 * It does not replace the simulation and it does not replace the optimiser. The
 * figures it returns are a *seed* — a defensible starting point — and the
 * physics engine then decides what is actually worth building. Where the
 * optimiser finds something better, the optimiser wins; the requirement engine
 * only has to be a good place to start from and a legible answer to "why this
 * design".
 *
 * It deliberately does not re-derive the climate. It reads the same
 * `ClimateAnalysis` the rest of the pipeline uses, so there is one
 * classification and one orientation search in the system, not two that can
 * disagree.
 */

import type {
  BuildingParameters,
  ClimateAnalysis,
  ClimateData,
  HvacType,
  InfiltrationClass,
  InsulationLevel,
  ShadingStrategy,
  VentilationStrategy,
} from '@/types';
import type { ClimateFingerprint, FingerprintIndex } from './fingerprint';
import type { BuildingTypeTemplate } from '@/lib/buildingTypes';
import { fitToTemplate } from '@/lib/buildingTypes';
import { isMissionProfileId, missionProfile } from '@/lib/missions';
import { GLAZING_ID } from '@/thermal/materials';
import { applyHvacToParameters } from '@/thermal/hvac';
import {
  INSULATION_LEVEL_THICKNESS,
  ROOF_PITCH,
  VENTILATION_ACH,
} from '@/thermal/constants';

export interface DesignRequirement {
  /** What was decided, e.g. "Insulation". */
  title: string;
  /** The concrete value chosen. */
  value: string;
  /** Why — named against the fingerprint index that drove it. */
  reason: string;
}

export type MoistureControl = 'none' | 'ventilate' | 'dehumidify';

export interface DesignRequirements {
  insulationLevel: InsulationLevel;
  insulationThickness: number;
  wallMaterialId: string;
  roofMaterialId: string;
  windowMaterialId: string;
  wallAssemblyId?: string;
  roofAssemblyId?: string;
  reflectiveOuter: boolean;
  shadingType: ShadingStrategy;
  shadingDepth: number;
  orientation: number;
  windowToWallRatio: number;
  ventilationType: VentilationStrategy;
  airChangesPerHour: number;
  infiltrationClass: InfiltrationClass;
  hvacType: HvacType;
  hvacCapacityKw: number;
  moistureControl: MoistureControl;
  /** The itemised rationale, in display order. */
  items: DesignRequirement[];
  /** A one-line headline of the requirement set. */
  headline: string;
}

export interface RequirementInputs {
  fingerprint: ClimateFingerprint;
  analysis: ClimateAnalysis;
  climate: ClimateData;
  template: BuildingTypeTemplate;
  base: BuildingParameters;
  missionId?: string;
}

export function deriveRequirements(inputs: RequirementInputs): DesignRequirements {
  const { fingerprint, analysis, climate, template, base, missionId } = inputs;
  const mission = isMissionProfileId(missionId) ? missionProfile(missionId) : null;

  const index = (key: string): FingerprintIndex =>
    fingerprint.indices.find((entry) => entry.key === key) ?? {
      key,
      label: key,
      value: 0,
      severity: 'low',
      raw: 0,
      unit: '',
      detail: '',
    };

  const winter = index('winter');
  const summer = index('summer');
  const humidity = index('humidity');
  const solar = index('solar');
  const wind = index('wind');

  const items: DesignRequirement[] = [];

  /* ------------------------------ Insulation ------------------------------ */
  let insulationLevel: InsulationLevel = analysis.insulationLevel;
  let insulationReason = `The climate engine recommends ${analysis.insulationLevel} insulation for this zone.`;

  if (winter.value >= 0.7) {
    insulationLevel = 'very-high';
    insulationReason = `Winter severity is ${pct(winter.value)} — the coldest month runs to ${winter.raw.toFixed(1)} °C, so the envelope must hold heat overnight.`;
  } else if (winter.value >= 0.45) {
    insulationLevel = 'high';
    insulationReason = `Winter severity is ${pct(winter.value)} (coldest month ${winter.raw.toFixed(1)} °C) — high insulation is the first-order measure.`;
  } else if (winter.value >= 0.25) {
    insulationLevel = 'medium';
    insulationReason = `Winter severity is ${pct(winter.value)} — a moderate insulation level pays for itself.`;
  } else if (summer.value >= 0.6) {
    /* In a hot climate insulation does far less than shade and ventilation, so
       the requirement is deliberately modest rather than "high because it is
       hot" — which is the most common way a hot-climate envelope is overbuilt. */
    insulationLevel = 'low';
    insulationReason = `Summer severity is ${pct(summer.value)} but winter is mild — insulation is kept low because shading and ventilation buy more here.`;
  } else if (humidity.value >= 0.6) {
    insulationLevel = 'low';
    insulationReason = `Humidity dominates at ${pct(humidity.value)} — a light, vapour-open envelope is preferred over a heavily insulated one.`;
  }

  /* The mission can raise the bar: a shelter whose occupants sleep in it needs
     more than one that stores rations in it. */
  if (mission && mission.continuous && insulationLevel === 'low' && winter.value >= 0.4) {
    insulationLevel = 'medium';
    insulationReason += ' Raised to medium because the mission is occupied continuously through the night.';
  }
  if (mission?.id === 'storage' && insulationLevel === 'very-high') {
    insulationLevel = 'high';
    insulationReason = 'Capped at high: an unoccupied store has a wide band and does not need the last increment.';
  }

  const insulationThickness = INSULATION_LEVEL_THICKNESS[insulationLevel];

  items.push({
    title: 'Insulation',
    value: `${insulationLevel} · ${Math.round(insulationThickness * 1000)} mm`,
    reason: insulationReason,
  });

  /* --------------------------- Wall & roof build-up ------------------------ */
  const wallAssemblyId = template.defaults.wallAssemblyId;
  const roofAssemblyId = template.defaults.roofAssemblyId;
  const wallMaterialId = template.defaults.wallMaterialId ?? base.wallMaterialId;
  const roofMaterialId = template.defaults.roofMaterialId ?? base.roofMaterialId;
  const windowMaterialId = pickGlazing(winter.value, summer.value, template);

  items.push({
    title: 'Envelope build-up',
    value: wallAssemblyId
      ? `${template.defaults.wallMaterialId} with a composite wall build-up`
      : `${template.defaults.wallMaterialId} walls, ${template.defaults.roofMaterialId} roof`,
    reason: wallAssemblyId
      ? `A layered assembly is what gives ${template.label.toLowerCase()} both its insulation and its air barrier, which a single material cannot.`
      : `Confined to ${template.label.toLowerCase()}'s palette — the type must remain a ${template.label.toLowerCase()}, not a generic building.`,
  });

  /* ------------------------------ Reflectance ----------------------------- */
  const reflectiveOuter = solar.value >= 0.6 || summer.value >= 0.6;
  items.push({
    title: 'Outer surface',
    value: reflectiveOuter ? 'Reflective / high-albedo outer skin' : 'Standard outer skin',
    reason: reflectiveOuter
      ? `Solar availability is ${pct(solar.value)} with summer severity ${pct(summer.value)} — a low-absorptance outer surface cuts the roof gain directly.`
      : `Solar and summer severity are both moderate, so a reflective finish would add cost without moving the result.`,
  });

  /* -------------------------------- Shading ------------------------------- */
  const shadingType: ShadingStrategy =
    summer.value >= 0.55 || solar.value >= 0.65
      ? template.palette.shading.includes('combined')
        ? 'combined'
        : template.palette.shading.includes('overhang')
          ? 'overhang'
          : 'none'
      : 'none';
  const shadingDepth = shadingType === 'none' ? 0 : round2(0.35 + 0.5 * summer.value);

  items.push({
    title: 'Shading',
    value: shadingType === 'none' ? 'None required' : `${shadingType} · ${shadingDepth.toFixed(2)} m`,
    reason:
      shadingType === 'none'
        ? `Summer severity is only ${pct(summer.value)}, so shading would not earn its cost.`
        : `Summer severity ${pct(summer.value)} and solar ${pct(solar.value)} make external shading the cheapest large gain.`,
  });

  /* ------------------------------- Orientation ---------------------------- */
  const orientation = analysis.orientationRecommendation;
  items.push({
    title: 'Orientation',
    value: `${Math.round(orientation)}°`,
    reason:
      winter.value >= 0.4 && solar.value >= 0.4
        ? `Cold but sun-rich: the long axis is turned to collect the low winter sun, which the solar engine searched in 15° steps.`
        : `Turned to reduce the summer solar load on the largest glazed facade, from the same solar search the climate engine runs.`,
  });

  /* ------------------------------ Openings -------------------------------- */
  let windowToWallRatio = analysis.windowRatioRecommendation;
  if (winter.value >= 0.5 && solar.value >= 0.5) {
    windowToWallRatio = Math.min(0.4, windowToWallRatio + 0.04);
  }
  if (summer.value >= 0.6) {
    windowToWallRatio = Math.max(0.06, windowToWallRatio - 0.04);
  }
  windowToWallRatio = round2(windowToWallRatio);

  items.push({
    title: 'Window-to-wall ratio',
    value: `${pct(windowToWallRatio * 100)}`,
    reason:
      winter.value >= 0.5 && solar.value >= 0.5
        ? `Widened slightly: in a cold, sun-rich climate glazing is a solar collector as well as a window.`
        : `Held low: the cooling and solar loads dominate, and glass is the weakest part of the envelope in both directions.`,
  });

  /* ----------------------------- Ventilation ------------------------------ */
  const ventilationType: VentilationStrategy =
    humidity.value >= 0.6
      ? template.palette.ventilation.includes('cross-ventilation')
        ? 'cross-ventilation'
        : analysis.ventilationStrategy
      : winter.value >= 0.6
        ? 'sealed-mechanical'
        : analysis.ventilationStrategy;
  const airChangesPerHour = VENTILATION_ACH[ventilationType];

  items.push({
    title: 'Ventilation',
    value: `${ventilationType} · ${airChangesPerHour} ACH capacity`,
    reason:
      humidity.value >= 0.6
        ? `Humidity is ${pct(humidity.value)}: air movement is the primary comfort mechanism and the main moisture control.`
        : winter.value >= 0.6
          ? `Winter severity ${pct(winter.value)}: the envelope is sealed and air is controlled, because uncontrolled air is uncontrolled heat loss.`
          : `The climate engine's strategy for this zone, with the air-change rate treated as a capacity rather than a constant rate.`,
  });

  /* ----------------------------- Infiltration ----------------------------- */
  const infiltrationClass: InfiltrationClass =
    winter.value >= 0.6 || humidity.value >= 0.6 || wind.value >= 0.6 ? 'low' : 'medium';

  items.push({
    title: 'Infiltration target',
    value: infiltrationClass === 'low' ? 'Low leakage' : 'Medium leakage',
    reason:
      winter.value >= 0.6
        ? `At ${pct(winter.value)} winter severity, leakage is the largest avoidable loss — sealing the seams beats adding insulation.`
        : humidity.value >= 0.6
          ? `A tight envelope is needed to keep humidity control meaningful; a leaky one re-humidifies the space continuously.`
          : wind.value >= 0.6
            ? `Wind exposure is ${pct(wind.value)} at ${wind.raw.toFixed(1)} m/s, so leakage would be driven hard — a low target is required.`
            : `A medium leakage class is realistic for a deployed envelope and does not drive the design.`,
  });

  /* --------------------------------- HVAC --------------------------------- */
  const floorArea = Math.max(1, template.defaults.width! * template.defaults.length! * (template.defaults.floors ?? 1));
  const { hvacType, hvacCapacityKw, hvacReason } = pickHvac({
    winter,
    summer,
    humidity,
    missionHvacExpected: mission?.hvacExpected ?? false,
    floorArea,
    template,
  });

  items.push({ title: 'HVAC', value: `${label(hvacType)} · ${hvacCapacityKw.toFixed(1)} kW`, reason: hvacReason });

  /* ---------------------------- Moisture control -------------------------- */
  const moistureControl: MoistureControl =
    humidity.value >= 0.65 ? 'dehumidify' : winter.value >= 0.55 ? 'ventilate' : 'none';

  items.push({
    title: 'Moisture control',
    value:
      moistureControl === 'dehumidify'
        ? 'Dehumidify'
        : moistureControl === 'ventilate'
          ? 'Ventilate against condensation'
          : 'None beyond normal ventilation',
    reason:
      moistureControl === 'dehumidify'
        ? `Humidity is ${pct(humidity.value)} — latent load, not sensible load, is the binding constraint.`
        : moistureControl === 'ventilate'
          ? `A cold envelope with occupied space condenses on the cold surfaces; the requirement is to keep surface temperatures above the dew point.`
          : `Neither humidity nor cold dominates, so no dedicated moisture control is required.`,
  });

  const headline =
    `${template.label} at ${climate.location.city}: ${insulationLevel} insulation, ` +
    `${hvacType === 'none' ? 'free-running' : label(hvacType)}, ` +
    `${reflectiveOuter ? 'reflective outer skin, ' : ''}${shadingType === 'none' ? 'no shading' : `${shadingType} shading`}, ` +
    `${infiltrationClass} leakage.`;

  return {
    insulationLevel,
    insulationThickness,
    wallMaterialId,
    roofMaterialId,
    windowMaterialId,
    wallAssemblyId,
    roofAssemblyId,
    reflectiveOuter,
    shadingType,
    shadingDepth,
    orientation,
    windowToWallRatio,
    ventilationType,
    airChangesPerHour,
    infiltrationClass,
    hvacType,
    hvacCapacityKw,
    moistureControl,
    items,
    headline,
  };
}

/**
 * Turn the requirements into a parameter patch the store can apply.
 *
 * `fitToTemplate` is the last step, exactly as it is on the analysis-driven
 * path: the requirement engine proposes, the palette disposes.
 */
export function applyRequirements(
  base: BuildingParameters,
  requirements: DesignRequirements,
): BuildingParameters {
  /* The proposed plant is routed through `applyHvacToParameters` so the type the
     engine recommends actually reaches the efficiencies the heat balance
     divides by. Without that step the recommendation would change the label on
     the design and nothing else. */
  return fitToTemplate(
    applyHvacToParameters({
      ...base,
      orientation: requirements.orientation,
      windowToWallRatio: requirements.windowToWallRatio,
      shadingType: requirements.shadingType,
      shadingDepth: requirements.shadingDepth,
      insulationLevel: requirements.insulationLevel,
      insulationThickness: requirements.insulationThickness,
      ventilationType: requirements.ventilationType,
      airChangesPerHour: requirements.airChangesPerHour,
      wallMaterialId: requirements.wallMaterialId,
      roofMaterialId: requirements.roofMaterialId,
      windowMaterialId: requirements.windowMaterialId,
      wallAssemblyId: requirements.wallAssemblyId,
      roofAssemblyId: requirements.roofAssemblyId,
      roofType: base.roofType,
      roofAngle: ROOF_PITCH[base.roofType],
      infiltrationClass: requirements.infiltrationClass,
      hvacType: requirements.hvacType,
      hvacCapacityKw: requirements.hvacCapacityKw,
      roofOverhang: Math.max(base.roofOverhang, requirements.shadingDepth),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function pickGlazing(winterValue: number, summerValue: number, template: BuildingTypeTemplate): string {
  const palette = template.palette.windowMaterials;
  const prefer = (id: string): string => (palette.includes(id) ? id : palette[0]!);
  if (winterValue >= 0.6) return prefer('double-lowe');
  if (summerValue >= 0.6) return prefer('double-lowe');
  return prefer(GLAZING_ID.double);
}

function pickHvac(inputs: {
  winter: FingerprintIndex;
  summer: FingerprintIndex;
  humidity: FingerprintIndex;
  missionHvacExpected: boolean;
  floorArea: number;
  template: BuildingTypeTemplate;
}): { hvacType: HvacType; hvacCapacityKw: number; hvacReason: string } {
  const { winter, summer, humidity, missionHvacExpected, floorArea } = inputs;

  /* The palette does not restrict HVAC — plant is not part of the envelope — but
     the climate does, and the mission decides whether plant is expected at all. */
  if (winter.value >= 0.6) {
    return {
      hvacType: 'diesel-heater',
      hvacCapacityKw: round2(0.09 * floorArea),
      hvacReason: `Winter severity ${pct(winter.value)}: a field heater is required — no passive envelope holds comfort through this coldest month, so the design must size the plant rather than pretend.`,
    };
  }
  if (summer.value >= 0.65) {
    return {
      hvacType: 'air-conditioner',
      hvacCapacityKw: round2(0.07 * floorArea),
      hvacReason: `Summer severity ${pct(summer.value)}: mechanical cooling is required for the peak month.`,
    };
  }
  if (humidity.value >= 0.65) {
    return {
      hvacType: 'air-conditioner',
      hvacCapacityKw: round2(0.06 * floorArea),
      hvacReason: `Humidity ${pct(humidity.value)}: cooling is needed as much to condense moisture out of the air as to lower the temperature.`,
    };
  }
  if (missionHvacExpected) {
    return {
      hvacType: 'heat-pump',
      hvacCapacityKw: round2(0.05 * floorArea),
      hvacReason: `The mission implies a controlled band and continuous operation, so a modest heat pump is the requirement.`,
    };
  }
  return {
    hvacType: 'none',
    hvacCapacityKw: 0,
    hvacReason: `No extreme dominates and the mission does not require a controlled band — the shelter is designed to run free.`,
  };
}

function label(hvac: HvacType): string {
  return hvac.replace(/-/g, ' ');
}

function pct(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
