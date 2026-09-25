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
  CostEstimate,
  DesignComparison,
  DesignMode,
  ThermalComfort,
} from '@/types';
import type { DesignMetrics } from '@/thermal/metrics';
import { buildingType } from '@/lib/buildingTypes';
import { assemblyById } from '@/thermal/assemblies';
import { DEFAULT_GLAZING_BIAS, glazingBiasOption } from '@/lib/glazingBias';
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
