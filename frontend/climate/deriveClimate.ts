/**
 * Derives headline climate statistics, design conditions and interpolated
 * records from raw monthly normals.
 *
 * Pure functions — no I/O — so they can be unit-tested and mirrored in the
 * FastAPI backend.
 */

import type {
  ClimateData,
  ClimateSource,
  ClimateStationRecord,
  ClimateSummary,
  ClimateZone,
  DesignConditions,
  Location,
  MonthlyClimate,
} from '@/types';
import { DAYS_IN_MONTH, normalizeDeg, pressureAtElevation } from '@/utils/units';
import { wetBulb } from '@/utils/psychrometrics';
import { nearestStation, CLIMATE_STATIONS } from './stations';

/* ------------------------------------------------------------------ */
/* Summary + design conditions                                         */
/* ------------------------------------------------------------------ */

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Speed-weighted circular mean of wind directions, degrees. */
function circularMeanDirection(monthly: MonthlyClimate[]): number {
  let x = 0;
  let y = 0;
  for (const m of monthly) {
    const rad = (m.windDirection * Math.PI) / 180;
    x += Math.cos(rad) * m.windSpeed;
    y += Math.sin(rad) * m.windSpeed;
  }
  if (x === 0 && y === 0) return 225;
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

export function deriveSummary(monthly: MonthlyClimate[]): ClimateSummary {
  const avgTemps = monthly.map((m) => m.avgTemp);
  const maxTemps = monthly.map((m) => m.maxTemp);
  const minTemps = monthly.map((m) => m.minTemp);

  const warmest = avgTemps.reduce((best, t, i) => (t > avgTemps[best]! ? i : best), 0);
  const coldest = avgTemps.reduce((best, t, i) => (t < avgTemps[best]! ? i : best), 0);

  const seasonalVariation = Math.max(...avgTemps) - Math.min(...avgTemps);
  const diurnalSwing = mean(monthly.map((m) => m.maxTemp - m.minTemp));

  return {
    avgTemperature: mean(avgTemps),
    maxTemperature: Math.max(...maxTemps),
    minTemperature: Math.min(...minTemps),
    humidity: mean(monthly.map((m) => m.humidity)),
    windSpeed: mean(monthly.map((m) => m.windSpeed)),
    windDirection: circularMeanDirection(monthly),
    solarRadiation: mean(monthly.map((m) => m.solarRadiation)),
    rainfall: monthly.reduce((sum, m) => sum + m.rainfall, 0),
    seasonalVariation,
    diurnalSwing,
    peakCoolingMonth: warmest,
    peakHeatingMonth: coldest,
  };
}

/**
 * Design conditions.
 *
 * Summer design dry-bulb approximates the ASHRAE 0.4 % cooling design value as
 * the hottest month's mean daily maximum plus a 2.5 K margin. Winter design
 * approximates the 99.6 % heating value as the coldest month's mean daily
 * minimum minus a 2.0 K margin. Both are documented approximations of a
 * percentile analysis that would normally need hourly records.
 */
export function deriveDesignConditions(monthly: MonthlyClimate[]): DesignConditions {
  const summary = deriveSummary(monthly);
  const hottest = monthly[summary.peakCoolingMonth]!;
  const coldest = monthly[summary.peakHeatingMonth]!;

  const summerDesignTemp = hottest.maxTemp + 2.5;
  // Coincident wet-bulb: humidity typically runs a little higher at the design
  // peak than the monthly mean, so add a modest allowance.
  const summerDesignWetBulb = wetBulb(summerDesignTemp, Math.min(100, hottest.humidity + 8));
  const winterDesignTemp = coldest.minTemp - 2.0;

  let coolingDegreeDays = 0;
  let heatingDegreeDays = 0;
  monthly.forEach((m, index) => {
    const days = DAYS_IN_MONTH[index] ?? 30;
    coolingDegreeDays += days * Math.max(0, m.avgTemp - 24);
    heatingDegreeDays += days * Math.max(0, 18 - m.avgTemp);
  });

  return {
    summerDesignTemp,
    summerDesignWetBulb,
    winterDesignTemp,
    dailyRange: mean(monthly.map((m) => m.maxTemp - m.minTemp)),
    coolingDegreeDays,
    heatingDegreeDays,
  };
}

/** Assemble a full ClimateData payload from a station record. */
export function buildClimateData(
  station: ClimateStationRecord,
  source: ClimateSource,
  fetchedAt = new Date().toISOString(),
): ClimateData {
  return {
    location: station.location,
    source,
    climateType: station.climateType,
    climateZone: station.climateZone,
    summary: deriveSummary(station.monthly),
    monthly: station.monthly,
    designConditions: deriveDesignConditions(station.monthly),
    fetchedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Interpolation for arbitrary coordinates                             */
/* ------------------------------------------------------------------ */

/** Inverse-distance-weighted blend of the nearest stations. */
export function interpolateStation(
  latitude: number,
  longitude: number,
  neighbours = 3,
): { station: ClimateStationRecord; meanDistanceKm: number; used: number } {
  const ranked = CLIMATE_STATIONS.map((station) => {
    const { distanceKm } = nearestStation(latitude, longitude);
    void distanceKm;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(station.location.latitude - latitude);
    const dLon = toRad(station.location.longitude - longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(latitude)) *
        Math.cos(toRad(station.location.latitude)) *
        Math.sin(dLon / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    return { station, km };
  }).sort((a, b) => a.km - b.km);

  const picked = ranked.slice(0, Math.max(1, Math.min(neighbours, ranked.length)));
  const weights = picked.map((p) => 1 / Math.max(25, p.km) ** 2);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  const blendedMonthly: MonthlyClimate[] = Array.from({ length: 12 }, (_, month) => {
    const rows = picked.map((p) => p.station.monthly[month]!);
    const blend = (key: keyof MonthlyClimate): number => {
      // Wind direction must be blended on the circle, not as a scalar.
      if (key === 'windDirection') {
        let x = 0;
        let y = 0;
        rows.forEach((row, i) => {
          const rad = (row.windDirection * Math.PI) / 180;
          const w = weights[i] ?? 0;
          x += Math.cos(rad) * w;
          y += Math.sin(rad) * w;
        });
        return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
      }
      let total = 0;
      rows.forEach((row, i) => {
        total += (row[key] as number) * (weights[i] ?? 0);
      });
      return total / weightSum;
    };

    return {
      month,
      avgTemp: blend('avgTemp'),
      maxTemp: blend('maxTemp'),
      minTemp: blend('minTemp'),
      humidity: blend('humidity'),
      windSpeed: blend('windSpeed'),
      windDirection: blend('windDirection'),
      solarRadiation: blend('solarRadiation'),
      rainfall: blend('rainfall'),
      sunshineHours: blend('sunshineHours'),
    };
  });

  // Elevation correction: interpolate toward the weighted-mean station
  // elevation, then apply the standard 6.5 K/km lapse rate.
  const blendedElevation =
    picked.reduce((sum, p, i) => sum + p.station.location.elevation * (weights[i] ?? 0), 0) /
    weightSum;

  const nearest = picked[0]!;
  const dominant = picked[0]!.station;
  const zone = dominant.climateZone;

  const station: ClimateStationRecord = {
    location: {
      id: `interp-${latitude.toFixed(2)}-${longitude.toFixed(2)}`,
      city: `Near ${nearest.station.location.city}`,
      state: nearest.station.location.state,
      country: nearest.station.location.country,
      latitude,
      longitude,
      elevation: Math.round(blendedElevation),
    },
    climateType: `${dominant.climateType} (interpolated)`,
    climateZone: zone,
    monthly: blendedMonthly,
  };

  const meanDistanceKm =
    picked.reduce((sum, p) => sum + p.km, 0) / Math.max(1, picked.length);

  return { station, meanDistanceKm, used: picked.length };
}

/* ------------------------------------------------------------------ */
/* Latitude fallback model                                             */
/* ------------------------------------------------------------------ */

/**
 * Crude latitude-driven synthesis used only when no station is within a
 * sensible radius. Clearly flagged as `simulated` in the UI.
 */
export function synthesiseStation(
  latitude: number,
  longitude: number,
  elevation = 0,
): ClimateStationRecord {
  const absLat = Math.abs(latitude);

  // Annual mean temperature falls off with latitude²; matches the observed
  // equator-to-pole profile reasonably well.
  const seaLevelMean = 27.5 - 0.0065 * absLat ** 2;
  const meanTemp = seaLevelMean - (elevation / 1000) * 6.5;

  // Seasonal amplitude grows with latitude; tropical climates have a small
  // spring/autumn peak instead of a midsummer one.
  const amplitude = 0.3 * absLat;
  const peakMonth = absLat < 15 ? 4 : absLat > 40 ? 6 : 5;
  const minMonth = (peakMonth + 6) % 12;

  const humidityBase = Math.max(40, Math.min(85, 72 - 0.3 * absLat));
  const northern = latitude >= 0;

  const monthly: MonthlyClimate[] = Array.from({ length: 12 }, (_, month) => {
    // Cosine seasonal curve peaking at peakMonth.
    const phase = ((month - peakMonth + 12) % 12) * (Math.PI / 6);
    const seasonal = amplitude * Math.cos(phase);
    const avgTemp = meanTemp + seasonal;
    const diurnal = 8 + absLat * 0.06;
    const shifted = northern ? month : (month + 6) % 12;

    // Simple monsoon-ish humidity bump two months after the warm peak.
    const humidBoost = 12 * Math.cos(((shifted - peakMonth - 2 + 12) % 12) * (Math.PI / 6));
    const humidity = Math.max(25, Math.min(92, humidityBase + humidBoost));

    return {
      month,
      avgTemp,
      maxTemp: avgTemp + diurnal / 2,
      minTemp: avgTemp - diurnal / 2,
      humidity,
      windSpeed: 2 + absLat * 0.05,
      windDirection: 225,
      solarRadiation: Math.max(1.2, 6.4 - absLat * 0.06),
      rainfall: 60 + humidity * 0.8,
      sunshineHours: Math.max(2.5, 8.5 - absLat * 0.09),
    };
  });

  // The seasonal peak should land on the intended month, so rotate if needed.
  void minMonth;

  return {
    location: {
      id: `synth-${latitude.toFixed(2)}-${longitude.toFixed(2)}`,
      city: `Synthesised site (${latitude.toFixed(1)}°, ${longitude.toFixed(1)}°)`,
      state: '—',
      country: '—',
      latitude,
      longitude,
      elevation,
    },
    climateType: 'Synthesised from latitude',
    climateZone: classifyZoneFallback(meanTemp, humidityBase),
    monthly,
  };
}

function classifyZoneFallback(meanTemp: number, humidity: number): ClimateZone {
  if (meanTemp < 12) return humidity > 70 ? 'cold-cloudy' : 'cold-sunny';
  if (meanTemp < 20) return 'temperate';
  if (humidity > 72) return 'hot-humid';
  if (humidity < 45) return 'hot-dry';
  return 'composite';
}

/**
 * Resolve climate for an arbitrary coordinate without any network access.
 * Interpolates from the nearest stations; falls back to the latitude model
 * when even the closest station is very far away.
 */
export function resolveOfflineClimate(
  latitude: number,
  longitude: number,
  elevation?: number,
): { data: ClimateData; method: 'interpolated' | 'synthesised'; note: string } {
  const { station, meanDistanceKm, used } = interpolateStation(latitude, longitude);

  if (meanDistanceKm <= 1500) {
    const adjusted = elevation === undefined
      ? station
      : applyElevation(station, elevation);
    const data = buildClimateData(adjusted, 'simulated');
    return {
      data,
      method: 'interpolated',
      note: `Interpolated from ${used} nearest stations (mean distance ${Math.round(meanDistanceKm)} km).`,
    };
  }

  const synth = synthesiseStation(latitude, longitude, elevation ?? 0);
  const data = buildClimateData(synth, 'simulated');
  return {
    data,
    method: 'synthesised',
    note: 'No station within 1500 km — synthesised from latitude and elevation.',
  };
}

/** Re-apply the temperature lapse rate for a different site elevation. */
export function applyElevation(
  station: ClimateStationRecord,
  targetElevation: number,
): ClimateStationRecord {
  const delta = (targetElevation - station.location.elevation) / 1000;
  if (Math.abs(delta) < 0.001) {
    return { ...station, location: { ...station.location, elevation: targetElevation } };
  }
  const shift = -6.5 * delta;

  return {
    ...station,
    location: { ...station.location, elevation: targetElevation },
    monthly: station.monthly.map((m) => ({
      ...m,
      avgTemp: m.avgTemp + shift,
      maxTemp: m.maxTemp + shift,
      minTemp: m.minTemp + shift,
    })),
  };
}

/** Atmospheric pressure at a location's elevation, Pa. */
export function locationPressure(location: Location): number {
  return pressureAtElevation(location.elevation);
}
