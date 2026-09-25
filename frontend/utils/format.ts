/**
 * Display formatting helpers. Kept free of React so they can be unit-tested
 * and reused by the FastAPI-side parity tests.
 */

import { MONTH_LABELS } from './units';

/** Fixed-decimal number, e.g. 12.34. */
export function num(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/** Temperature with unit, e.g. "25.1 °C". */
export function temp(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)} °C`;
}

/** Temperature delta with explicit sign, e.g. "−2.8 K". */
export function tempDelta(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)} K`;
}

/** Percentage, e.g. "56%". */
export function pct(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/** Fraction 0–1 rendered as a percentage. */
export function fractionPct(value: number, decimals = 0): string {
  return pct(value * 100, decimals);
}

/** Signed percentage, e.g. "+12.4%". */
export function signedPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/**
 * Indian-rupee currency with lakh/crore grouping for large values.
 * Values under ₹1,00,000 use standard grouping.
 */
export function currency(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';

  if (abs >= 1e7) {
    return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  }
  if (abs >= 1e5) {
    return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  }
  return `${sign}₹${abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Signed currency, e.g. "−₹1.20 L". */
export function signedCurrency(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${currency(Math.abs(value), decimals).replace('−', '')}`;
}

/** Energy in kWh with sensible precision. */
export function energy(kwh: number, decimals = 1): string {
  if (!Number.isFinite(kwh)) return '—';
  return `${kwh.toFixed(decimals)} kWh`;
}

/** Energy per day, e.g. "11.5 kWh/day". */
export function energyPerDay(kwh: number, decimals = 1): string {
  return `${energy(kwh, decimals)}/day`;
}

/** Energy per year, e.g. "4.2 MWh/yr" above 10 MWh. */
export function energyPerYear(kwh: number): string {
  if (!Number.isFinite(kwh)) return '—';
  if (Math.abs(kwh) >= 10000) return `${(kwh / 1000).toFixed(2)} MWh/yr`;
  return `${kwh.toFixed(0)} kWh/yr`;
}

/** Area, e.g. "62.5 m²". */
export function area(m2: number, decimals = 1): string {
  if (!Number.isFinite(m2)) return '—';
  return `${m2.toFixed(decimals)} m²`;
}

/** Volume, e.g. "187.5 m³". */
export function volume(m3: number, decimals = 1): string {
  if (!Number.isFinite(m3)) return '—';
  return `${m3.toFixed(decimals)} m³`;
}

/** Length, e.g. "0.80 m". */
export function metres(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)} m`;
}

/** Power, e.g. "3.2 kW". */
export function power(kw: number, decimals = 1): string {
  if (!Number.isFinite(kw)) return '—';
  return `${kw.toFixed(decimals)} kW`;
}

/** U-value, e.g. "0.42 W/m²K". */
export function uValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} W/m²K`;
}

/** Compass label from an azimuth in degrees. */
export function compass(azimuthDeg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((azimuthDeg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx] ?? 'N';
}

/** Month label from a 0-based index. */
export function monthLabel(monthIndex: number): string {
  return MONTH_LABELS[((monthIndex % 12) + 12) % 12] ?? '—';
}

/** Hour of day rendered as "14:30". */
export function clockTime(hour: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Latitude/longitude rendered as "18.52° N, 73.86° E". */
export function latLon(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/** Relative humidity comfort descriptor. */
export function humidityLabel(rh: number): string {
  if (rh < 30) return 'Very dry';
  if (rh < 45) return 'Dry';
  if (rh < 60) return 'Comfortable';
  if (rh < 75) return 'Humid';
  return 'Very humid';
}

/** Wind speed descriptor on the Beaufort-ish scale. */
export function windLabel(ms: number): string {
  if (ms < 1) return 'Calm';
  if (ms < 2.5) return 'Light air';
  if (ms < 4.5) return 'Light breeze';
  if (ms < 7) return 'Gentle breeze';
  if (ms < 10) return 'Moderate breeze';
  return 'Fresh breeze';
}

/** PMV sensation label per ISO 7730. */
export function pmvSensation(pmv: number): string {
  if (pmv < -3) return 'Very cold';
  if (pmv < -2) return 'Cold';
  if (pmv < -1) return 'Slightly cool';
  if (pmv <= 1) return 'Neutral';
  if (pmv <= 2) return 'Slightly warm';
  if (pmv <= 3) return 'Warm';
  return 'Hot';
}

/** PPD severity band. */
export function ppdBand(ppd: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (ppd <= 6) return 'excellent';
  if (ppd <= 10) return 'good';
  if (ppd <= 20) return 'fair';
  return 'poor';
}

/** Truncate a string with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
