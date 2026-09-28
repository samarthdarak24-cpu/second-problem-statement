/**
 * Climate Fingerprint — what the *place* asks of a shelter.
 *
 * WHY THIS IS ITS OWN ENGINE
 * `climateAnalysis` already answers "which zone is this, and what strategy
 * follows". The fingerprint answers a different, more legible question: *how
 * hard does this site push in each direction?* It reduces a year of monthly
 * normals to a handful of 0–1 severity indices — winter cold, summer heat,
 * diurnal swing, solar, wind, humidity, night-cooling potential, altitude — so
 * two sites can be compared at a glance and so the "area-specific" claim has a
 * number behind it rather than a sentence.
 *
 * It is deliberately a *presentation* of the climate, not a second
 * classification: it reads the resolved `ClimateData`, never re-derives the
 * Köppen zone, and the primary/secondary challenges it names are the same
 * vocabulary `climateAnalysis` uses. That keeps one classification in the
 * system instead of two that can disagree.
 */

import type { ClimateData, ClimateZone, ThermalChallenge } from '@/types';

export type FingerprintSeverity = 'low' | 'moderate' | 'high' | 'extreme';

export interface FingerprintIndex {
  key: string;
  label: string;
  /** Severity, 0–1. */
  value: number;
  severity: FingerprintSeverity;
  /** The raw figure the index was derived from. */
  raw: number;
  unit: string;
  /** What drives it, in one line. */
  detail: string;
}

export interface ClimateFingerprint {
  location: string;
  climateType: string;
  zone: ClimateZone;
  elevation: number;
  indices: FingerprintIndex[];
  /** The dominant thermal problem. */
  primary: ThermalChallenge;
  /** The next-most-important one. */
  secondary: ThermalChallenge;
  /** What the design must do about them. */
  requiredDesign: string[];
  /** One-paragraph read of the site. */
  summary: string;
}

/** Map a raw value onto 0–1 across a range. `lo` → 0, `hi` → 1. */
function scale(value: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return clamp01((value - lo) / (hi - lo));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function severityOf(value: number): FingerprintSeverity {
  if (value >= 0.75) return 'extreme';
  if (value >= 0.5) return 'high';
  if (value >= 0.25) return 'moderate';
  return 'low';
}

/**
 * Compute the fingerprint of a resolved climate.
 *
 * Every index is a *relative* measure on a documented range, not a physical
 * quantity: 0 means "this direction is not a problem here", 1 means "this is as
 * hard as it gets". The ranges are stated in each `detail` line so the numbers
 * can be argued with.
 */
export function computeClimateFingerprint(climate: ClimateData): ClimateFingerprint {
  const { summary } = climate;

  /* --- Winter cold: coldest month mean daily minimum. 15 °C → 0, −20 °C → 1. */
  const winterValue = scale(summary.minTemperature, 15, -20);

  /* --- Summer heat: hottest month mean daily maximum. 30 °C → 0, 48 °C → 1. */
  const summerValue = scale(summary.maxTemperature, 30, 48);

  /* --- Diurnal swing: 6 K → 0, 20 K → 1. */
  const swingValue = scale(summary.diurnalSwing, 6, 20);

  /* --- Solar resource: 3 kWh/m²/day → 0, 7 → 1. */
  const solarValue = scale(summary.solarRadiation, 3, 7);

  /* --- Wind exposure: 1.5 m/s → 0, 6 m/s → 1. */
  const windValue = scale(summary.windSpeed, 1.5, 6);

  /* --- Humidity: 40 % → 0, 85 % → 1. */
  const humidityValue = scale(summary.humidity, 40, 85);

  /* --- Night-cooling potential: a big swing, dry air and some wind. --- */
  const nightValue = clamp01(
    0.5 * scale(summary.diurnalSwing, 6, 18) +
      0.3 * (1 - scale(summary.humidity, 45, 85)) +
      0.2 * scale(summary.windSpeed, 1.5, 5),
  );

  /* --- Altitude: 500 m → 0, 3500 m → 1. Low pressure lowers convective
     heat loss and degrades combustion, so it changes the plant, not just the
     temperature. --- */
  const altitudeValue = scale(climate.location.elevation, 500, 3500);

  const indices: FingerprintIndex[] = [
    {
      key: 'winter',
      label: 'Winter severity',
      value: winterValue,
      severity: severityOf(winterValue),
      raw: summary.minTemperature,
      unit: '°C',
      detail: `Coldest month mean minimum, on a 15 → −20 °C scale.`,
    },
    {
      key: 'summer',
      label: 'Summer severity',
      value: summerValue,
      severity: severityOf(summerValue),
      raw: summary.maxTemperature,
      unit: '°C',
      detail: `Hottest month mean maximum, on a 30 → 48 °C scale.`,
    },
    {
      key: 'swing',
      label: 'Day–night swing',
      value: swingValue,
      severity: severityOf(swingValue),
      raw: summary.diurnalSwing,
      unit: 'K',
      detail: `Mean daily range, on a 6 → 20 K scale. Drives the case for thermal mass.`,
    },
    {
      key: 'solar',
      label: 'Solar availability',
      value: solarValue,
      severity: severityOf(solarValue),
      raw: summary.solarRadiation,
      unit: 'kWh/m²·d',
      detail: `Annual mean daily irradiation, on a 3 → 7 scale.`,
    },
    {
      key: 'wind',
      label: 'Wind exposure',
      value: windValue,
      severity: severityOf(windValue),
      raw: summary.windSpeed,
      unit: 'm/s',
      detail: `Mean wind speed, on a 1.5 → 6 m/s scale. Sets infiltration and the viability of ventilation.`,
    },
    {
      key: 'humidity',
      label: 'Humidity',
      value: humidityValue,
      severity: severityOf(humidityValue),
      raw: summary.humidity,
      unit: '%',
      detail: `Annual mean relative humidity, on a 40 → 85 % scale.`,
    },
    {
      key: 'night-cooling',
      label: 'Night-cooling potential',
      value: nightValue,
      severity: severityOf(nightValue),
      raw: summary.diurnalSwing,
      unit: 'K',
      detail: `Composite of swing, dryness and wind — how much free cooling the night offers.`,
    },
    {
      key: 'altitude',
      label: 'Altitude',
      value: altitudeValue,
      severity: severityOf(altitudeValue),
      raw: climate.location.elevation,
      unit: 'm',
      detail: `Site elevation, on a 500 → 3500 m scale. Low pressure changes convective loss and combustion.`,
    },
  ];

  const { primary, secondary } = rankChallenges({
    winterValue,
    summerValue,
    swingValue,
    solarValue,
    windValue,
    humidityValue,
    nightValue,
  });

  const requiredDesign = requiredDesignFor(primary, secondary, {
    winterValue,
    summerValue,
    humidityValue,
    solarValue,
    swingValue,
    windValue,
  });

  const summaryText =
    `${climate.location.city} reads as ${climate.climateType}. ` +
    `The dominant problem is ${describeChallenge(primary).toLowerCase()}` +
    (secondary !== primary ? `, with ${describeChallenge(secondary).toLowerCase()} behind it` : '') +
    `. ${topIndexSentence(indices)}`;

  return {
    location: climate.location.city,
    climateType: climate.climateType,
    zone: climate.climateZone,
    elevation: climate.location.elevation,
    indices,
    primary,
    secondary,
    requiredDesign,
    summary: summaryText,
  };
}

/* ------------------------------------------------------------------ */
/* Challenge ranking                                                   */
/* ------------------------------------------------------------------ */

interface ChallengeInputs {
  winterValue: number;
  summerValue: number;
  swingValue: number;
  solarValue: number;
  windValue: number;
  humidityValue: number;
  nightValue: number;
}

/**
 * Name the dominant and secondary thermal challenges.
 *
 * The order of the tests *is* the priority: cold beats heat beats humidity
 * beats solar beats swing, because a shelter that cannot be kept warm in winter
 * fails harder than one that is merely too warm in summer. Ties are broken by
 * the index magnitudes rather than by list order.
 */
function rankChallenges(inputs: ChallengeInputs): {
  primary: ThermalChallenge;
  secondary: ThermalChallenge;
} {
  const { winterValue, summerValue, humidityValue, solarValue, swingValue } = inputs;

  const scores: Array<{ challenge: ThermalChallenge; score: number }> = [
    { challenge: 'severe-winter-cold', score: winterValue },
    {
      challenge: humidityValue >= 0.5 ? 'combined-heat-humidity' : 'extreme-summer-heat',
      score: summerValue * (humidityValue >= 0.5 ? 1.05 : 1),
    },
    { challenge: 'moisture-and-humidity', score: humidityValue * 0.95 },
    { challenge: 'intense-solar-gain', score: solarValue * 0.9 },
    { challenge: 'high-diurnal-swing', score: swingValue * 0.85 },
  ];

  /* The dominant challenge gets a priority bonus so a site that is 0.62 cold and
     0.63 hot does not flip on a rounding error — the cold test wins, because
     that is the harder failure. */
  const weighted = scores.map((entry, index) => ({
    ...entry,
    weighted: entry.score + (index === 0 ? 0.08 : 0),
  }));

  weighted.sort((a, b) => b.weighted - a.weighted);

  const top = weighted[0];
  const next = weighted[1];

  /* A site where nothing is a problem gets the balanced label rather than an
     arbitrary winner. */
  if (!top || top.score < 0.28) {
    return { primary: 'moderate-balanced', secondary: 'moderate-balanced' };
  }

  return {
    primary: top.challenge,
    secondary: next && next.score >= 0.28 ? next.challenge : top.challenge,
  };
}

function requiredDesignFor(
  primary: ThermalChallenge,
  secondary: ThermalChallenge,
  values: {
    winterValue: number;
    summerValue: number;
    humidityValue: number;
    solarValue: number;
    swingValue: number;
    windValue: number;
  },
): string[] {
  const out: string[] = [];
  const add = (item: string): void => {
    if (!out.includes(item)) out.push(item);
  };

  const touches = (challenge: ThermalChallenge): boolean =>
    primary === challenge || secondary === challenge;

  if (touches('severe-winter-cold')) {
    add('High insulation, prioritising the roof and the floor');
    add('Low infiltration — the seams matter more than the U-value');
    add('Controlled, heat-recovering ventilation rather than open openings');
    add('Solar heating and a sealed vestibule');
  }
  if (touches('extreme-summer-heat')) {
    add('Shade the openings and the roof');
    add('Reflective or high-albedo outer surface');
    add('Night purge to discharge the stored heat');
    add('Thermal mass to ride out the afternoon peak');
  }
  if (touches('combined-heat-humidity') || touches('moisture-and-humidity')) {
    add('Maximise cross-ventilation');
    add('Dehumidification or a moisture-tolerant envelope');
    add('Low solar gain — glass and absorptance both');
    add('Vapour-open build-up to let the envelope dry');
  }
  if (touches('intense-solar-gain')) {
    add('External shading sized to the summer noon sun');
    add('High-albedo roof and a radiant barrier in the build-up');
    add('Glazing positioned away from the west');
  }
  if (touches('high-diurnal-swing')) {
    add('Thermal mass on the sunlit faces');
    add('Insulation outside the mass, not inside it');
    add('Night ventilation to recharge the mass');
  }
  if (values.humidityValue >= 0.6) {
    add('Monitor surface temperatures against the dew point');
  }
  if (values.winterValue >= 0.5 && values.solarValue >= 0.5) {
    add('Orient the long axis and the glazing to collect the low winter sun');
  }
  if (values.windValue >= 0.5) {
    add('Shelter the openings from the prevailing wind');
  }

  if (out.length === 0) {
    add('A balanced envelope — no single measure dominates here');
    add('Ventilation for the shoulder seasons');
  }

  return out;
}

function describeChallenge(challenge: ThermalChallenge): string {
  return CHALLENGE_TEXT[challenge];
}

const CHALLENGE_TEXT: Record<ThermalChallenge, string> = {
  'extreme-summer-heat': 'extreme summer heat',
  'combined-heat-humidity': 'combined heat and humidity',
  'high-diurnal-swing': 'a high day–night swing',
  'severe-winter-cold': 'severe winter cold',
  'moisture-and-humidity': 'moisture and humidity',
  'intense-solar-gain': 'intense solar gain',
  'monsoon-moisture': 'monsoon moisture',
  'moderate-balanced': 'a moderate, balanced climate',
};

function topIndexSentence(indices: FingerprintIndex[]): string {
  const sorted = [...indices].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  if (!top) return '';
  const topText = `${top.label.toLowerCase()} is the strongest signal at ${Math.round(top.value * 100)} %`;
  if (!second || second.value < 0.25) return `${topText}.`;
  return `${topText}, ahead of ${second.label.toLowerCase()} at ${Math.round(second.value * 100)} %.`;
}

/** Display label for a challenge, for the page header. */
export const FINGERPRINT_SEVERITY_LABEL: Record<FingerprintSeverity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
};
