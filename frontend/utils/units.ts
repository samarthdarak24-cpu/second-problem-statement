/**
 * Physical constants and unit conversions.
 *
 * All SI unless the name says otherwise.
 */

/* ---------------- Constants ---------------- */

/** Solar constant, W/m². */
export const SOLAR_CONSTANT = 1367;

/** Stefan–Boltzmann constant, W/m²·K⁴. */
export const STEFAN_BOLTZMANN = 5.670374419e-8;

/** Specific heat capacity of dry air at constant pressure, J/kg·K. */
export const CP_AIR = 1005;

/** Specific heat capacity of water vapour, J/kg·K. */
export const CP_VAPOUR = 1860;

/** Latent heat of vaporisation of water at 0 °C, J/kg. */
export const LATENT_HEAT_VAPORISATION = 2.501e6;

/** Density of dry air at 20 °C, sea level, kg/m³. */
export const AIR_DENSITY = 1.2;

/** Standard sea-level atmospheric pressure, Pa. */
export const STANDARD_PRESSURE = 101325;

/** Reference temperature for heating/cooling degree days, °C. */
export const COMFORT_REFERENCE_TEMP = 24;

/** Grid CO₂ intensity, kgCO₂/kWh. Used for the operational-carbon estimate. */
export const GRID_CO2_INTENSITY = 0.71;

/** Default analysis horizon for lifecycle cost, years. */
export const LIFECYCLE_YEARS = 20;

/** Real discount rate for lifecycle costing. */
export const DISCOUNT_RATE = 0.06;

/** Electricity tariff, currency units per kWh. */
export const ELECTRICITY_TARIFF = 8.5;

/** Days in each month, non-leap. */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Total days in a non-leap year. */
export const DAYS_IN_YEAR = 365;

/** Hours in a non-leap year. */
export const HOURS_IN_YEAR = 8760;

/** Month labels, January first. */
export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Mid-month day-of-year, used to sample a representative day per month. */
export const MONTH_MID_DAY = [
  17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344,
] as const;

/**
 * Day-of-year of the 1st of each month, January first, non-leap year.
 *
 * WHY A SECOND TABLE
 * `MONTH_MID_DAY` above is a set of representative sampling dates, not an
 * arithmetic series — the gap from each month's start to its mid-point is not
 * constant, because the months are not all 31 days. Recovering a month's first
 * day by subtracting a fixed offset from the mid-point therefore lands on the
 * wrong date for eight of the twelve months, and the error grows to a week by
 * December. That is invisible for a monthly-mean heat balance and very visible
 * in a shadow study, so the exact table is kept separately and used wherever a
 * user-specified date has to be turned into a day-of-year.
 */
export const MONTH_START_DAY = [
  1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335,
] as const;

/**
 * Day-of-year for a month index and a day within that month.
 *
 * Clamps both arguments, so an out-of-range day from a slider or from restored
 * state produces a real date rather than a date in the neighbouring month.
 */
export function dayOfYear(monthIndex: number, dayOfMonth: number): number {
  const month = Math.max(0, Math.min(11, Math.round(monthIndex)));
  const length = DAYS_IN_MONTH[month] ?? 31;
  const day = Math.max(1, Math.min(length, Math.round(dayOfMonth)));
  return (MONTH_START_DAY[month] ?? 1) + day - 1;
}

/* ---------------- Unit conversions ---------------- */

/** Met units (1 met = 58.15 W/m²) to W/m². */
export function metToWm2(met: number): number {
  return met * 58.15;
}

/** Clo units (1 clo = 0.155 m²·K/W) to m²·K/W. */
export function cloToM2KW(clo: number): number {
  return clo * 0.155;
}

/** W to BTU/h. */
export function wToBtuh(watts: number): number {
  return watts * 3.412142;
}

/** kWh to MJ. */
export function kwhToMj(kwh: number): number {
  return kwh * 3.6;
}

/** Degrees to radians. */
export function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Radians to degrees. */
export function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalise an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Barometric pressure at elevation, Pa (ISA troposphere approximation).
 */
export function pressureAtElevation(elevationM: number): number {
  return STANDARD_PRESSURE * (1 - 2.25577e-5 * elevationM) ** 5.25588;
}

/**
 * Air density at a given temperature and pressure, kg/m³ (ideal gas).
 */
export function airDensity(tempC: number, pressurePa: number): number {
  const R_SPECIFIC = 287.058; // J/kg·K for dry air
  return pressurePa / (R_SPECIFIC * (tempC + 273.15));
}
