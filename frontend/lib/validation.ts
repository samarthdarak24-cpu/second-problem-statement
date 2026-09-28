/**
 * The validation architecture.
 *
 * WHAT THIS FILE IS
 * An honest, per-quantity statement of how each number this platform reports is
 * checked — and, just as importantly, of the quantities that are *not* checked
 * against anything external. The spec asked for a validation mode that
 * distinguishes the fast model from CFD from measured data; this is that
 * statement, in the one place a reader can audit it.
 *
 * WHY IT IS A DATA FILE AND NOT PROSE
 * Because a claim about validation is the easiest thing in a project to let
 * drift. Keeping it as a table with an explicit status per row means that
 * adding a quantity without deciding its status is a visible omission, and that
 * upgrading a status requires changing a single labelled field.
 *
 * THE STATUS VOCABULARY — four levels, no fifth
 *
 *   reference    Checked against a published or closed-form value: an ISO
 *                reference condition, a standards table, an analytic solution.
 *                This is the strongest claim in the table.
 *
 *   consistency  Checked by the project's own suites for internal consistency
 *                and physical plausibility — that shares sum to 100 %, that a
 *                cold site demands more insulation than a hot one, that a
 *                condensation flag fires exactly when a surface is below the
 *                dew point. This catches implementation error, not model error.
 *
 *   declared     No check beyond "it runs and returns a finite number". The
 *                quantity is a documented engineering estimate. Declared rather
 *                than hidden.
 *
 *   deferred     A validation route exists and is planned, but has not been
 *                executed. Nothing is claimed about accuracy in the meantime.
 *
 * There is deliberately no "validated" level. Nothing in this platform has been
 * validated against measured shelter data, and a table that implied otherwise
 * would be worse than no table.
 */

export type ValidationStatus = 'reference' | 'consistency' | 'declared' | 'deferred';

export interface ValidationStatusMeta {
  label: string;
  /** One line explaining what the status licenses a reader to believe. */
  meaning: string;
  /** Tailwind-friendly tone key used by the page. */
  tone: 'good' | 'accent' | 'warn' | 'neutral';
}

export const VALIDATION_STATUS: Record<ValidationStatus, ValidationStatusMeta> = {
  reference: {
    label: 'Reference-checked',
    meaning:
      'Compared against a published standard value or a closed-form solution. An implementation error here would be caught.',
    tone: 'good',
  },
  consistency: {
    label: 'Consistency-checked',
    meaning:
      'Checked by the project’s own suites for internal consistency and physical plausibility. Catches implementation error, not model error.',
    tone: 'accent',
  },
  declared: {
    label: 'Declared estimate',
    meaning:
      'A documented engineering estimate with no external check. Believable in direction and order of magnitude; not in its decimals.',
    tone: 'warn',
  },
  deferred: {
    label: 'Not yet validated',
    meaning:
      'A validation route exists and is planned, but has not been run. Nothing is claimed about accuracy.',
    tone: 'neutral',
  },
};

export interface ValidationRow {
  /** The quantity as a reader would name it. */
  quantity: string;
  /** Which engine computes it. */
  computedBy: string;
  /** What it is checked against, or "—" when nothing external applies. */
  checkedAgainst: string;
  status: ValidationStatus;
  /** The specific check, in plain words. */
  note: string;
}

/**
 * The table, ordered from the best-checked quantities to the least.
 *
 * The ordering is deliberate: a reader who stops after three rows should have
 * seen the strongest claims, and a reader who reaches the bottom has seen the
 * weakest without having to hunt for them.
 */
export const VALIDATION_ROWS: ValidationRow[] = [
  {
    quantity: 'PMV and PPD',
    computedBy: 'thermal/pmv.ts',
    checkedAgainst: 'ISO 7730 published reference conditions',
    status: 'reference',
    note:
      'Evaluated at the standard reference conditions used to validate PMV implementations, and PPD at PMV = 0 is checked against the 5.0 % the standard specifies.',
  },
  {
    quantity: 'Periodic thermal response',
    computedBy: 'thermal/thermalModel.ts',
    checkedAgainst: 'Closed-form solution',
    status: 'reference',
    note:
      'The decrement factor and time lag of a multi-layer wall are checked against the analytic periodic-response solution for the same construction.',
  },
  {
    quantity: 'Solar position',
    computedBy: 'utils/solar.ts',
    checkedAgainst: 'NOAA algorithm',
    status: 'reference',
    note: 'Altitude and azimuth are checked against the NOAA solar position algorithm at reference times and latitudes.',
  },
  {
    quantity: 'Clear-sky irradiance and diffuse fraction',
    computedBy: 'utils/solar.ts',
    checkedAgainst: 'Erbs correlation',
    status: 'reference',
    note:
      'The beam/diffuse split follows the Erbs correlation and is checked for the correct limits: zero at night, all-diffuse under an overcast sky.',
  },
  {
    quantity: 'Climate record',
    computedBy: 'climate/climateService.ts',
    checkedAgainst: 'Offline 33-station climatology',
    status: 'reference',
    note:
      'Every station and every month is compared field by field against the stored climatology, and the archive-window and unit conversions are asserted against documented values.',
  },
  {
    quantity: 'Monthly heat balance',
    computedBy: 'thermal/thermalModel.ts',
    checkedAgainst: 'Internal energy balance',
    status: 'consistency',
    note:
      'Conduction, ventilation, solar and internal paths are checked to close the balance, and the sign conventions are asserted. There is no external whole-building reference.',
  },
  {
    quantity: 'Heat-loss breakdown',
    computedBy: 'thermal/heatLoss.ts',
    checkedAgainst: 'Internal shares',
    status: 'consistency',
    note: 'The seven paths are asserted to sum to 100 %, with infiltration kept as its own line rather than folded into ventilation.',
  },
  {
    quantity: 'Area-specific requirement engine',
    computedBy: 'climate/requirementEngine.ts',
    checkedAgainst: 'Cross-site comparison',
    status: 'consistency',
    note:
      'Every requirement carries a reason, an applied requirement set stays inside the shelter type’s palette, and a cold site is asserted to demand more insulation and heating than a hot one.',
  },
  {
    quantity: 'Defence shelter library',
    computedBy: 'lib/buildingTypes.ts',
    checkedAgainst: 'Palette resolution',
    status: 'consistency',
    note:
      'Every palette material and assembly is asserted to resolve, and all nine defence types are asserted to produce distinct thermal profiles at the same site — so the selector is not decorative.',
  },
  {
    quantity: 'Surface temperature',
    computedBy: 'thermal/surfaceTemperature.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'A first-order estimate from a lumped U-value and a single film coefficient. It does not resolve the gradient through a thick wall and assumes an isothermal surface. Directionally reliable; the decimals are not.',
  },
  {
    quantity: 'Conduction heat flux',
    computedBy: 'thermal/surfaceTemperature.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'The same lumped evaluation, so it does not resolve flux concentration at a thermal bridge or a corner. The sign is checked to flip correctly between a hot midday and a cold night.',
  },
  {
    quantity: 'Indoor moisture and condensation',
    computedBy: 'thermal/moisture.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'A single-zone steady-state moisture balance. It does not resolve moisture stored in hygroscopic materials, the drying of a wet envelope, or interstitial condensation inside the build-up — only the inner face.',
  },
  {
    quantity: 'WBGT heat stress',
    computedBy: 'thermal/stress.ts',
    checkedAgainst: 'ISO 7243 bands',
    status: 'consistency',
    note:
      'The WBGT bands follow ISO 7243, but the wet-bulb input uses Stull’s approximation, which assumes near-sea-level pressure — a real limitation at a high-altitude site.',
  },
  {
    quantity: 'Cold stress and required clothing',
    computedBy: 'thermal/stress.ts',
    checkedAgainst: 'ISO 11079 (approximated)',
    status: 'declared',
    note:
      'A linear approximation of the ISO 11079 IREQ table, not the standard’s full iterative calculation. Correct in direction and rough magnitude.',
  },
  {
    quantity: 'Ventilation control',
    computedBy: 'thermal/ventilationControl.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'The achievable air-change rate is a first-order buoyancy-plus-wind estimate through the total operable opening area with one discharge coefficient. It is not a network airflow or CFD solve.',
  },
  {
    quantity: 'HVAC plant performance',
    computedBy: 'thermal/hvac.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'One representative seasonal efficiency per plant type, reduced for part load with the standard DOE-2 degradation factor and a part-load ratio estimated from equivalent full-load hours. That ratio is a proxy for a load-duration curve, not a substitute for one, and capacity loss at temperature extremes — a heat pump below about −15 °C — is still not modelled.',
  },
  {
    quantity: 'Deployability and logistics',
    computedBy: 'lib/deployment.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'Mass and volume are computed from the resolved layer stack, so they are traceable; packing factors, erection times and manpower are engineering estimates, not measured logistics data.',
  },
  {
    quantity: 'Uncertainty band',
    computedBy: 'lib/uncertainty.ts',
    checkedAgainst: '—',
    status: 'declared',
    note:
      'A first-order rank-correlation sensitivity index over documented input ranges, with a seeded sampler. It ignores interactions between inputs and is not a Sobol decomposition.',
  },
  {
    quantity: 'ML surrogate predictions',
    computedBy: 'ml/surrogate.ts',
    checkedAgainst: 'Held-out mean absolute error',
    status: 'consistency',
    note:
      'Where a trained surrogate exists it reports its held-out error, and it is gated by a Spearman correlation threshold. It is used only to rank candidates; every reported number is re-simulated by the physics engine.',
  },
  {
    quantity: 'Comparison against a CFD or EnergyPlus model',
    computedBy: '—',
    checkedAgainst: 'Planned',
    status: 'deferred',
    note:
      'The intended route is to export a representative set of designs and compare the monthly heat balance against a whole-building simulation, and the surface maps against a CFD solution. Not started.',
  },
  {
    quantity: 'Comparison against measured shelter data',
    computedBy: '—',
    checkedAgainst: 'Planned',
    status: 'deferred',
    note:
      'The intended route is a deployed instrumented shelter with logged internal and surface temperatures and humidity, used to calibrate and to bound the model. No such dataset exists yet, and no accuracy claim is made without one.',
  },
];

/** Counts per status, for the page summary. */
export function validationCounts(): Record<ValidationStatus, number> {
  const counts: Record<ValidationStatus, number> = {
    reference: 0,
    consistency: 0,
    declared: 0,
    deferred: 0,
  };
  for (const row of VALIDATION_ROWS) counts[row.status] += 1;
  return counts;
}

/**
 * The one-sentence verdict a reader should take away.
 *
 * Kept next to the table so it cannot drift away from what the table says.
 */
export const VALIDATION_VERDICT =
  'The physics that can be checked against a standard is checked against a standard. ' +
  'The physics that cannot — surface temperature, moisture, ventilation, plant performance — ' +
  'is labelled an estimate wherever it appears, and the two validation routes that would ' +
  'change that (a whole-building simulation and a measured shelter) are named as not yet run.';
