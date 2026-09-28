/**
 * Design report — a dependency-free PDF.
 *
 * There is no PDF library in the stack on purpose: the "report" is a styled HTML
 * document opened in a new window and handed to the browser's print-to-PDF. That
 * keeps the bundle lean and means the document always reflects the live design
 * with no serialisation step that could drift from the model.
 *
 * Everything printed here is a *model estimate*. The disclaimer is therefore
 * printed on the page, not buried in a footnote, because a number that looks
 * official but is actually a simulation can do real harm if read as a survey.
 */

import type {
  BuildingParameters,
  ClimateData,
  CostEstimate,
  DesignComparison,
  DesignMode,
  ResolvedMaterials,
  ShelterGeometry,
  ThermalComfort,
} from '@/types';
import type { DesignMetrics } from '@/thermal/metrics';
import { buildingType } from '@/lib/buildingTypes';
import { assemblyById } from '@/thermal/assemblies';
import { DEFAULT_GLAZING_BIAS, glazingBiasOption } from '@/lib/glazingBias';
import { computeClimateFingerprint } from '@/climate/fingerprint';
import { deriveRequirements } from '@/climate/requirementEngine';
import { isMissionProfileId, missionProfile } from '@/lib/missions';
import { computeInternalLoads } from '@/lib/internalLoads';
import { computeMoisture } from '@/thermal/moisture';
import { computeInterstitial } from '@/thermal/interstitial';
import { SURFACE_FILM } from '@/thermal/materials';
import { computeHeatLossBreakdown } from '@/thermal/heatLoss';
import { assessStress } from '@/thermal/stress';
import { computeDeploymentMetrics } from '@/lib/deployment';
import { HVAC_LABEL, INFILTRATION_LABEL, POWER_SOURCE_LABEL } from '@/thermal/ventilation';
import { CHALLENGE_LABEL, ZONE_LABEL } from '@/lib/labels';
import { currency, num, pct, temp, energyPerYear } from '@/utils/format';

export interface DesignReportData {
  location: string;
  climateType: string;
  mode: DesignMode;
  parameters: BuildingParameters;
  score: number;
  baselineScore: number;
  metrics: DesignMetrics | null;
  cost: CostEstimate | null;
  comparison: DesignComparison | null;
  /**
   * The live thermal result, so the report can carry the three quantities the
   * problem statement asks for — indoor temperature, solar gain and heat flow —
   * rather than only the annual aggregates.
   */
  thermal: ThermalComfort | null;
  /**
   * Optional context that unlocks the defence sections.
   *
   * Optional rather than required so a caller that only has the thermal result
   * still produces a valid report; when the climate, geometry and materials are
   * supplied, the fingerprint, mission, requirements, moisture, stress and
   * deployment sections are added.
   */
  climate?: ClimateData | null;
  geometry?: ShelterGeometry | null;
  materials?: ResolvedMaterials | null;
  /** Month and hour the moisture / surface assessment is made at. */
  analysisMonth?: number;
  analysisHour?: number;
  /** The climate provider that answered, for the provenance line. */
  climateSource?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function row(label: string, value: string): string {
  return `<tr><td class="l">${escapeHtml(label)}</td><td class="r">${escapeHtml(value)}</td></tr>`;
}

export function designReportHtml(data: DesignReportData): string {
  const { parameters, metrics, cost, comparison, location, climateType, mode, score, baselineScore, thermal } =
    data;
  const template = buildingType(parameters.buildingType);
  const p = parameters;
  const defence = buildDefenceSections(data);

  const comfort = metrics
    ? [
        row('Design score (optimised)', `${score} / 100`),
        row('Conventional reference score', `${baselineScore} / 100`),
        row('Passive comfort (adaptive band)', pct(metrics.adaptiveComfortHoursPct)),
        row('Peak indoor — summer', temp(metrics.summerIndoorTemperature)),
        row('Peak indoor — winter', temp(metrics.winterIndoorTemperature)),
        row('Conditioned PMV', num(metrics.conditionedPmv, 2)),
        row('Conditioned PPD', pct(metrics.conditionedPpd, 1)),
      ].join('')
    : '';

  const energy = metrics
    ? [
        row('Annual delivered energy', energyPerYear(metrics.annualEnergy)),
        row('Energy use intensity', `${num(metrics.energyUseIntensity, 1)} kWh/m²·yr`),
        row('Cooling', energyPerYear(metrics.annualCoolingEnergy)),
        row('Heating', energyPerYear(metrics.annualHeatingEnergy)),
        row('Operational CO₂', `${num(metrics.co2TonnesPerYear, 2)} t/yr`),
      ].join('')
    : '';

  const costRows = cost
    ? [
        row('Capital cost', currency(cost.totalCost)),
        row('Cost per m²', `${currency(cost.costPerSqm)}/m²`),
        row('20-year cost of ownership', currency(cost.twentyYearCost)),
        row('Budget status', cost.withinBudget ? 'within budget' : `over by ${currency(Math.abs(cost.budgetDelta))}`),
      ].join('')
    : '';

  const deltas = comparison
    ? comparison.deltas
        .filter((d) => d.metric !== 'Construction cost')
        .map((d) =>
          row(
            d.metric,
            `${d.unit === '₹' ? currency(d.optimized) : num(d.optimized, 1)} (${d.changePct >= 0 ? '+' : ''}${num(d.changePct, 0)}% vs conventional)`,
          ),
        )
        .join('')
    : '';

  const form = [
    row('Building type', `${template.glyph} ${template.label}`),
    row('Storeys', String(p.floors)),
    row('Plan', `${p.width} × ${p.length} m`),
    row('Floor-to-ceiling', `${p.height} m`),
    row('Window-to-wall ratio', pct(p.windowToWallRatio * 100)),
    row(
      'Glazing position',
      glazingBiasOption(p.glazingBias ?? DEFAULT_GLAZING_BIAS).label,
    ),
    /* A composite assembly replaces the single material, so the material id is
       only reported when no assembly is selected. */
    row('Wall', assemblyById(p.wallAssemblyId ?? '')?.name ?? p.wallMaterialId),
    row('Roof', assemblyById(p.roofAssemblyId ?? '')?.name ?? p.roofMaterialId),
    row('Roof form', p.roofType),
    row('Shading', `${p.shadingType}${p.shadingDepth > 0 ? ` (${p.shadingDepth} m)` : ''}`),
    row('Ventilation', `${p.ventilationType} @ ${p.airChangesPerHour} ACH`),
    row('Orientation', `${Math.round(p.orientation)}°`),
    row('Budget', currency(p.budget)),
  ].join('');

  /*
   * The three quantities the problem statement asks for, printed before the
   * annual aggregates — a report that led with an energy total and buried the
   * indoor temperature would be answering a different question.
   */
  const profile = thermal?.dailyProfile ?? null;
  const monthName = profile
    ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][profile.month]
    : '';

  const requiredRows = profile
    ? [
        row(
          'Indoor temperature (free-running)',
          `${num(profile.indoorMin, 1)} … ${num(profile.indoorMax, 1)} °C`,
        ),
        row('Outdoor swing / indoor swing', `${num(profile.outdoorSwing, 1)} K / ${num(profile.indoorSwing, 1)} K`),
        row('Swing removed by the fabric', `${Math.round(profile.swingDamping * 100)} %`),
        row('Solar thermal gain', `${num(profile.solarGainKwh, 2)} kWh/day`),
        row('Solar gain per m² of floor', `${num(profile.solarGainPerSqm, 3)} kWh/m²·day`),
        row('Solar peak hour', `${String(profile.solarPeakHour).padStart(2, '0')}:00`),
        row('Solar covers this share of losses', `${Math.round(profile.solarCoverage * 100)} %`),
        row('Total heat flow leaving', `${num(profile.heatLossKwh, 2)} kWh/day`),
        row('Peak heat-flow rate', `${num(profile.peakFlowKw, 2)} kW at ${String(profile.peakFlowHour).padStart(2, '0')}:00`),
      ].join('')
    : '';

  const flowRows = profile
    ? [
        ['Walls', profile.wallKwh],
        ['Roof', profile.roofKwh],
        ['Floor', profile.floorKwh],
        ['Windows', profile.windowKwh],
        ['Doors', profile.doorKwh],
        ['Ventilation', profile.ventilationKwh],
      ]
        .map(([label, value]) =>
          row(String(label), `${Number(value) >= 0 ? '+' : '−'}${num(Math.abs(Number(value)), 2)} kWh/day`),
        )
        .join('')
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Thermal Shelter — Design Report</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #221c16; margin: 0; padding: 28px 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #8a6f52; border-bottom: 2px solid #e4dcd1; padding-bottom: 4px; margin: 22px 0 8px; }
  .meta { color: #6b5e4f; margin: 0 0 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; border-bottom: 1px solid #f0ebe2; vertical-align: top; }
  td.l { color: #6b5e4f; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .score { font-size: 34px; font-weight: 700; color: #1f7a4d; }
  .disclaimer { margin-top: 26px; padding: 12px 14px; background: #fff6ec; border: 1px solid #e6c79f; border-radius: 8px; color: #6b4a1f; font-size: 12px; }
  .foot { margin-top: 18px; color: #9a8d7c; font-size: 11px; }
  .note { margin: 8px 0 0; color: #8a7d6c; font-size: 11.5px; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } }
</style>
</head>
<body>
  <h1>Thermal Shelter — Design Report</h1>
  <p class="meta">${escapeHtml(location)} · ${escapeHtml(climateType)} · ${mode === 'auto' ? 'AI-optimised' : 'Manual'} design</p>
  <p class="meta">Generated ${new Date().toLocaleString()}</p>

  ${
    profile
      ? `<h2>Required outputs — representative day in ${monthName}</h2>
  <div class="grid">
    <div>
      <table>${requiredRows}</table>
    </div>
    <div>
      <p style="color:#6b5e4f;margin:0 0 6px">Heat flow by component (positive = entering the shelter)</p>
      <table>${flowRows}</table>
    </div>
  </div>
  <p class="note">Indoor temperature is the free-running response with no heating or cooling running. The floor is driven by
  the ground temperature rather than the outdoor air, so it is a steady loss in a cold climate and a steady gain in a hot one.</p>`
      : ''
  }

  <div class="grid">
    <div>
      <h2>Building form</h2>
      <table>${form}</table>
    </div>
    <div>
      <h2>Outcome</h2>
      <p class="score">${score} <span style="font-size:14px;color:#6b5e4f">/ 100</span></p>
      <table>${comfort}</table>
    </div>
  </div>

  <div class="grid">
    <div>
      <h2>Energy</h2>
      <table>${energy}</table>
    </div>
    <div>
      <h2>Cost</h2>
      <table>${costRows}</table>
    </div>
  </div>

  ${deltas ? `<h2>Against conventional construction</h2><table>${deltas}</table>` : ''}

  ${defence}

  <div class="disclaimer">
    <strong>Model estimate — not a measured building result.</strong> Every figure here is produced by a
    parametric thermal and cost model. It is a design aid for comparing options, not a substitute for
    on-site measurement, a structural calculation or a qualified engineer's sign-off.
  </div>

  <p class="foot">Thermal Shelter · SIH Problem Statement 51 · Geometry is procedural; no imported 3D assets. Climate by Open-Meteo (ERA5) / offline normals; solar geometry by the NOAA algorithm.</p>
</body>
</html>`;
}

/** Open the report in a new window and invoke the print dialog (save as PDF). */
export function printDesignReport(data: DesignReportData): void {
  const html = designReportHtml(data);
  const win = window.open('', '_blank', 'noopener');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  /* Give the new document a beat to lay out before printing. */
  setTimeout(() => win.print(), 350);
}

/* ------------------------------------------------------------------ */
/* Defence sections                                                    */
/* ------------------------------------------------------------------ */

/**
 * The sections the defence evolution adds: fingerprint, mission, requirements,
 * internal load, moisture, stress, heat loss and deployability.
 *
 * Every figure comes from the same engines the UI uses, so the printed report
 * and the on-screen brief cannot disagree. When the caller does not supply the
 * climate, geometry and materials, the function returns an empty string rather
 * than printing a section full of blanks.
 */
function buildDefenceSections(data: DesignReportData): string {
  const { climate, geometry, materials, parameters, thermal, metrics } = data;
  if (!climate || !geometry || !materials || !thermal || !metrics) return '';

  const template = buildingType(parameters.buildingType);
  const mission = isMissionProfileId(parameters.missionProfile)
    ? missionProfile(parameters.missionProfile)
    : null;
  const fingerprint = computeClimateFingerprint(climate);

  const month = data.analysisMonth ?? thermal.dailyProfile.month;
  const hour = data.analysisHour ?? 14;

  const internalLoads = computeInternalLoads(
    parameters.numOccupants,
    mission?.activityMet ?? 1.2,
    parameters.internalLoads ?? [],
    geometry.floorArea,
  );

  const requirements = deriveRequirements({
    fingerprint,
    analysis: {
      zone: fingerprint.zone,
      classification: fingerprint.climateType,
      mainChallenge: fingerprint.primary,
      challengeDetail: '',
      ventilationStrategy: parameters.ventilationType,
      ventilationAch: parameters.airChangesPerHour,
      insulationLevel: parameters.insulationLevel,
      insulationThickness: parameters.insulationThickness,
      shadingStrategy: parameters.shadingType,
      windowRatioRecommendation: parameters.windowToWallRatio,
      orientationRecommendation: parameters.orientation,
      roofStrategy: parameters.roofType,
      glazingStrategy: 'double',
      shadingDepth: parameters.shadingDepth,
      wallThickness: parameters.wallThickness,
      rationale: [],
    },
    climate,
    template,
    base: parameters,
    missionId: parameters.missionProfile,
  });

  const indoorTemp =
    thermal.dailyProfile.points[Math.round(hour) % 24]?.indoorTemp ?? thermal.indoorTemperature;

  const moisture = computeMoisture(climate, geometry, materials, parameters, {
    month,
    hour,
    indoorTemp,
    latentGainW: internalLoads.totalLatentW,
  });

  const heatLoss = computeHeatLossBreakdown(thermal.dailyProfile, parameters, geometry);
  const stress = assessStress(thermal, mission?.activityMet ?? 1.2, 1.5);
  const deployment = computeDeploymentMetrics(geometry, materials, parameters, metrics.annualEnergy);

  /* ---------------- Climate fingerprint ---------------- */
  const fingerprintTable = [
    row('Zone', `${ZONE_LABEL[fingerprint.zone]} · ${fingerprint.climateType}`),
    row('Elevation', `${Math.round(fingerprint.elevation)} m`),
    row('Primary challenge', CHALLENGE_LABEL[fingerprint.primary]),
    row('Secondary challenge', CHALLENGE_LABEL[fingerprint.secondary]),
    ...fingerprint.indices.map((index) =>
      row(index.label, `${pct(index.value * 100, 0)} (${num(index.raw, 1)} ${index.unit})`),
    ),
  ].join('');

  /* ---------------- Mission & internal load ---------------- */
  const missionTable = [
    row('Mission profile', mission ? mission.label : 'Not set'),
    row('Activity', mission ? `${mission.activity} · ${mission.activityMet.toFixed(1)} met` : '—'),
    row('Occupants', String(parameters.numOccupants)),
    row('Operating hours', mission ? `${mission.operatingHours} h/day${mission.continuous ? ' continuous' : ''}` : '—'),
    row('Target temperature', mission ? `${mission.targetTemp.min}–${mission.targetTemp.max} °C` : '—'),
    row('Target humidity', mission ? `${mission.targetHumidity.min}–${mission.targetHumidity.max} %` : '—'),
    row('Occupant load', `${num(internalLoads.occupants.totalW, 0)} W`),
    row('Equipment load', `${num(internalLoads.equipmentSensibleW + internalLoads.equipmentLatentW, 0)} W`),
    row('Total internal load', `${num(internalLoads.totalW, 0)} W (${internalLoads.totalKw.toFixed(2)} kW)`),
  ].join('');

  /* ---------------- Requirements ---------------- */
  const requirementRows = requirements.items
    .map((item) => row(item.title, item.value))
    .join('');
  const requirementReasons = requirements.items
    .map((item) => `<p class="note"><strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.reason)}</p>`)
    .join('');

  /* ---------------- Moisture ---------------- */
  const moistureTable = [
    row('Indoor temperature', `${num(moisture.indoorTemp, 1)} °C`),
    row('Indoor RH', pct(moisture.indoorRh, 0)),
    row('Dew point', `${num(moisture.dewPoint, 1)} °C`),
    row('Wet bulb', `${num(moisture.wetBulb, 1)} °C`),
    row('Humidity ratio', `${(moisture.indoorHumidityRatio * 1000).toFixed(2)} g/kg`),
    row('Outdoor', `${num(moisture.outdoorTemp, 1)} °C · ${pct(moisture.outdoorRh, 0)} RH`),
    row('Air exchange', `${moisture.airChangesPerHour.toFixed(1)} ACH`),
    row('Moisture generation', `${num(moisture.generationKgPerHour, 3)} kg/h`),
    row('Condensing', `${num(moisture.condensationKgPerHour, 3)} kg/h`),
    row('Condensation risk', moisture.risk.toUpperCase()),
  ].join('');

  const surfaceRows = moisture.surfaces
    .map((surface) =>
      row(
        surface.label,
        `${num(surface.surfaceTemp, 1)} °C · margin ${surface.margin >= 0 ? '+' : ''}${num(surface.margin, 1)} K · ${surface.risk}`,
      ),
    )
    .join('');

  /* ---------------- Interstitial condensation ----------------
     The surface check above says whether the inner face is wet. This one says
     whether the build-up is wet *inside*, which is the failure a cold-climate
     shelter actually suffers and which no surface reading can show. */
  const interstitialConditions = {
    month,
    indoorTemp: moisture.indoorTemp,
    indoorRh: moisture.indoorRh,
    outdoorTemp: moisture.outdoorTemp,
    outdoorRh: moisture.outdoorRh,
  };

  const interstitialWall = computeInterstitial(materials.wall.layers, {
    ...interstitialConditions,
    internalSurfaceResistance: SURFACE_FILM.wall.internal,
    externalSurfaceResistance: SURFACE_FILM.wall.external,
  });
  const interstitialRoof = computeInterstitial(materials.roof.layers, {
    ...interstitialConditions,
    internalSurfaceResistance: SURFACE_FILM.roof.internal,
    externalSurfaceResistance: SURFACE_FILM.roof.external,
  });

  const interstitialLine = (label: string, result: ReturnType<typeof computeInterstitial>) =>
    result.applicable
      ? row(
          label,
          result.condensing
            ? `Condensing at ${result.condensationAt} (${num(result.condensationDepth ?? 0, 3)} m) · ${num(result.condensationGPerM2Day, 2)} g/m²·day · ${result.risk}`
            : `Dry · tightest plane ${result.critical?.label ?? '—'} at ${result.critical?.marginPa ?? 0} Pa margin`,
        )
      : row(label, 'Not run — single-material envelope, no layer stack to walk');

  const interstitialTable = [
    interstitialLine('Wall build-up', interstitialWall),
    interstitialLine('Roof build-up', interstitialRoof),
  ].join('');

  const interstitialWarning =
    interstitialWall.barrierOnColdSide || interstitialRoof.barrierOnColdSide
      ? `<p class="note"><strong>Vapour barrier position.</strong> ${
          [
            interstitialWall.barrierOnColdSide
              ? `The wall's vapour-tight layer (${interstitialWall.vapourBarrierLayer}) sits on the cold side of the build-up`
              : null,
            interstitialRoof.barrierOnColdSide
              ? `the roof's (${interstitialRoof.vapourBarrierLayer}) does too`
              : null,
          ]
            .filter(Boolean)
            .join(', and ')
            .replace(/^t/, 'T')
      }, so condensate it traps cannot dry inward. Move the barrier inboard of the insulation, or add a ventilated cavity outboard of it.</p>`
      : '';

  /* ---------------- Stress ---------------- */
  const stressTable = [
    row('Heat stress — WBGT', `${num(stress.heat.wbgt, 1)} °C (${stress.heat.risk})`),
    row('Wet bulb / globe', `${num(stress.heat.wetBulb, 1)} / ${num(stress.heat.globeTemp, 1)} °C`),
    row('Cold stress — required clo', `${num(stress.cold.requiredClo, 2)} clo (${stress.cold.risk})`),
    row('Issued / deficit', `${num(stress.cold.availableClo, 2)} / ${num(stress.cold.deficitClo, 2)} clo`),
    row('Heating load', `${num(stress.cold.heatingLoadKw, 2)} kW`),
    row('Binding constraint', stress.binding === 'comfort' ? 'Ordinary comfort' : `${stress.binding} stress`),
  ].join('');

  /* ---------------- Heat loss ---------------- */
  const heatLossTable = heatLoss.components
    .map((component) => row(component.label, `${component.lossKwh.toFixed(1)} kWh · ${component.sharePct.toFixed(0)} %`))
    .join('');

  const airSplitTable = [
    row('Intentional ventilation', `${heatLoss.intentionalVentilation.ach.toFixed(1)} ACH · ${heatLoss.intentionalVentilation.sharePct.toFixed(0)} %`),
    row('Uncontrolled infiltration', `${heatLoss.infiltration.ach.toFixed(1)} ACH · ${heatLoss.infiltration.sharePct.toFixed(0)} %`),
    row('Leakage class', INFILTRATION_LABEL[parameters.infiltrationClass ?? 'medium']),
  ].join('');

  /* ---------------- Deployment ---------------- */
  const deploymentTable = [
    row('Envelope mass', `${num(deployment.envelopeMassKg / 1000, 2)} t`),
    row('Total mass', `${num(deployment.totalMassKg / 1000, 2)} t`),
    row('Deployed volume', `${num(deployment.deployedVolumeM3, 1)} m³`),
    row('Packed volume', `${num(deployment.packedVolumeM3, 2)} m³ (${(deployment.packingFactor * 100).toFixed(0)} %)`),
    row('Transport volume', `${num(deployment.transportVolumeM3, 2)} m³`),
    row('Panel count', String(deployment.panelCount)),
    row('Deployment time', deployment.deployable ? `${deployment.deploymentTimeMin} min` : 'Site-built'),
    row('Manpower', deployment.deployable ? `${deployment.manpowerRequired} personnel` : '—'),
    row('Daily electrical', `${num(deployment.dailyElectricalKwh, 1)} kWh/day`),
    row('Daily fuel', deployment.dailyFuelLitres > 0 ? `${num(deployment.dailyFuelLitres, 1)} L/day` : 'None'),
  ].join('');

  /* ---------------- Services ---------------- */
  const servicesTable = [
    row('Shelter type', `${template.glyph} ${template.label}`),
    row('Category', template.category === 'defence' ? 'Defence shelter' : 'Civil reference'),
    row('Ventilation strategy', `${parameters.ventilationType} · ${parameters.airChangesPerHour} ACH capacity`),
    row('HVAC', `${HVAC_LABEL[parameters.hvacType ?? 'none']}${parameters.hvacCapacityKw ? ` · ${parameters.hvacCapacityKw} kW` : ''}`),
    row('Power source', POWER_SOURCE_LABEL[parameters.powerSource ?? 'grid']),
    row('Climate source', data.climateSource ?? climate.source),
  ].join('');

  return `
  <h2>Climate fingerprint</h2>
  <div class="grid">
    <div><table>${fingerprintTable}</table></div>
    <div>
      <h2>Mission and internal load</h2>
      <table>${missionTable}</table>
    </div>
  </div>

  <h2>Area-specific thermal requirements</h2>
  <table>${requirementRows}</table>
  ${requirementReasons}

  <div class="grid">
    <div>
      <h2>Moisture</h2>
      <table>${moistureTable}</table>
    </div>
    <div>
      <h2>Heat and cold stress</h2>
      <table>${stressTable}</table>
    </div>
  </div>

  <h2>Surface condensation risk</h2>
  <table>${surfaceRows}</table>

  <h2>Interstitial condensation (Glaser check)</h2>
  <table>${interstitialTable}</table>
  ${interstitialWarning}

  <div class="grid">
    <div>
      <h2>Heat loss by component</h2>
      <table>${heatLossTable}</table>
    </div>
    <div>
      <h2>Air exchange</h2>
      <table>${airSplitTable}</table>
    </div>
  </div>

  <div class="grid">
    <div>
      <h2>Deployability</h2>
      <table>${deploymentTable}</table>
    </div>
    <div>
      <h2>Services</h2>
      <table>${servicesTable}</table>
    </div>
  </div>

  <p class="note"><strong>Model fidelity.</strong> Fast reduced-order engineering model: a
  quasi-steady-state monthly heat balance, a single-zone steady-state moisture balance, WBGT via
  Stull's wet-bulb approximation, and a linear approximation of the ISO 11079 cold-stress table.
  No CFD, no measured validation, no EnergyPlus run. Every figure is an engineering estimate for
  comparing designs.</p>`;
}
