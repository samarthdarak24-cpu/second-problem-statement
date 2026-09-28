/**
 * Uncertainty and sensitivity.
 *
 * WHY THIS EXISTS
 * Every number this platform reports is a point estimate from a deterministic
 * model, and a point estimate presented alone implies a precision it does not
 * have. A peak indoor temperature of 28.4 °C is not 28.4 °C to one decimal — it
 * is "somewhere in a band, and here is which of my inputs is most responsible
 * for how wide that band is". This module produces that band and that ranking.
 *
 * WHAT IT DOES
 * It perturbs a documented set of design inputs within documented ranges,
 * re-runs the *real* thermal engine for each sample, and reports two things:
 *
 *  1. The distribution of each output — mean, spread, and a 5th/50th/95th
 *     percentile band.
 *  2. A first-order sensitivity index per input: how much of the output's
 *     variance each input accounts for, so a reader can see whether the answer
 *     is dominated by the envelope, by leakage, or by the plant.
 *
 * WHAT IT IS NOT
 * It is not a Sobol decomposition and not a probabilistic risk model. The index
 * is the squared Spearman rank correlation between one input and one output,
 * normalised to sum to 1 across inputs — a first-order, monotonic, one-at-a-time
 * style measure that ignores interactions between inputs. The ranges are
 * engineering judgements about as-built versus as-specified variation, not
 * fitted distributions. Every one of those caveats is stated wherever the
 * figures are shown, because an uncertainty analysis that oversells itself is
 * worse than none at all.
 *
 * DETERMINISM
 * The sampler is seeded, so the same design and the same seed always produce
 * the same band. That matters: a verification suite whose numbers move run to
 * run is not a suite, and a user who re-runs an analysis should not see the
 * answer change for no reason.
 */

import type { BuildingParameters, ClimateData, ShelterGeometry } from '@/types';
import type { ThermalComfort } from '@/types';
import { infiltrationAchFor } from '@/thermal/ventilation';

/* ------------------------------------------------------------------ */
/* Seeded sampling                                                     */
/* ------------------------------------------------------------------ */

/** mulberry32 — small, fast, and good enough for stratified sampling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Inputs under study                                                  */
/* ------------------------------------------------------------------ */

export interface UncertaintyInput {
  key: string;
  label: string;
  /** Relative perturbation, e.g. 0.25 for ±25 %. */
  spread: number;
  /** Where the range comes from — never a bare number. */
  basis: string;
  /** Apply a multiplier to a parameter set, returning a new one. */
  apply(parameters: BuildingParameters, multiplier: number): BuildingParameters;
}

/**
 * The six inputs, and why each range is what it is.
 *
 * These are deliberately the inputs a field engineer would argue about, not the
 * ones that are easy to perturb. Leakage and as-built insulation thickness are
 * the two largest real-world divergences from a specification, and the plant's
 * seasonal efficiency is the least predictable of the mechanical figures.
 */
export const UNCERTAINTY_INPUTS: UncertaintyInput[] = [
  {
    key: 'insulationThickness',
    label: 'Insulation thickness',
    spread: 0.25,
    basis:
      'As-built insulation drifts from the specification during a fast field erection; ±25 % is a conservative allowance for that.',
    apply: (p, m) => ({ ...p, insulationThickness: p.insulationThickness * m }),
  },
  {
    key: 'infiltrationAch',
    label: 'Infiltration',
    spread: 0.4,
    basis:
      'Leakage is the least predictable property of any envelope, and the hardest to measure without a blower door. ±40 % is deliberately wide.',
    /* The perturbation is applied to the *effective* rate the model would use,
       and written back as a measured figure, so the class table cannot silently
       override the value being studied. */
    apply: (p, m) => {
      const effective = infiltrationAchFor(p.infiltrationClass, p.infiltrationAch, p.airChangesPerHour);
      return {
        ...p,
        infiltrationClass: 'measured' as const,
        infiltrationAch: Math.max(0, effective * m),
      };
    },
  },
  {
    key: 'airChangesPerHour',
    label: 'Design ventilation',
    spread: 0.3,
    basis:
      'How much the occupants actually open the vents is a behaviour, not a specification; ±30 % covers the range between a disciplined and a casual crew.',
    apply: (p, m) => ({ ...p, airChangesPerHour: p.airChangesPerHour * m }),
  },
  {
    key: 'coolingCop',
    label: 'Cooling efficiency',
    spread: 0.15,
    basis:
      'Seasonal efficiency falls with outdoor temperature, part-load cycling and fouling. ±15 % around the nameplate figure.',
    apply: (p, m) => ({ ...p, coolingCop: p.coolingCop * m }),
  },
  {
    key: 'heatingEfficiency',
    label: 'Heating efficiency',
    spread: 0.15,
    basis:
      'The same part-load and fouling allowance in the heating direction, which also covers fuel quality on a field generator.',
    apply: (p, m) => ({ ...p, heatingEfficiency: p.heatingEfficiency * m }),
  },
  {
    key: 'numOccupants',
    label: 'Occupancy',
    spread: 0.25,
    basis:
      'The mission profile sets a nominal headcount, but a real deployment runs above or below it. Used here as the proxy for the whole internal gain.',
    apply: (p, m) => ({ ...p, numOccupants: Math.max(1, Math.round(p.numOccupants * m)) }),
  },
];

/* ------------------------------------------------------------------ */
/* Outputs under study                                                 */
/* ------------------------------------------------------------------ */

export interface UncertaintyOutput {
  key: string;
  label: string;
  unit: string;
  /** Read a value out of a thermal result. */
  read(thermal: ThermalComfort): number;
}

export const UNCERTAINTY_OUTPUTS: UncertaintyOutput[] = [
  {
    key: 'peakIndoorTemp',
    label: 'Peak indoor temperature',
    unit: '°C',
    read: (t) => t.indoorTemperatureRange[1],
  },
  {
    key: 'coldestIndoorTemp',
    label: 'Coldest monthly indoor temperature',
    unit: '°C',
    read: (t) => t.indoorTemperatureRange[0],
  },
  {
    key: 'eui',
    label: 'Energy intensity',
    unit: 'kWh/m²·yr',
    read: (t) => t.energyUseIntensity,
  },
  {
    key: 'annualComfort',
    label: 'Annual free-running comfort',
    unit: '/100',
    read: (t) => t.annualComfortScore,
  },
  {
    key: 'peakCoolingLoad',
    label: 'Peak cooling load',
    unit: 'kW',
    read: (t) => t.peakCoolingLoad,
  },
];

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface OutputDistribution {
  key: string;
  label: string;
  unit: string;
  /** The unperturbed design's own value, for comparison. */
  baseline: number;
  mean: number;
  /** Standard deviation across the samples. */
  sd: number;
  p05: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  /** p95 − p05, the width of the band the tool would quote. */
  bandWidth: number;
  /** Ranked contributions, largest first, summing to 1. */
  contributions: Array<{ key: string; label: string; index: number }>;
  /** The input that dominates this output. */
  dominant: string;
}

export interface UncertaintyResult {
  seed: number;
  sampleCount: number;
  inputs: Array<{ key: string; label: string; spread: number; basis: string }>;
  outputs: OutputDistribution[];
  /** Plain-language read of the whole analysis. */
  summary: string;
}

export interface UncertaintyInputs {
  base: BuildingParameters;
  climate: ClimateData;
  /** Number of samples. More samples, tighter percentiles, slower run. */
  samples: number;
  seed?: number;
  evaluate(parameters: BuildingParameters): { thermal: ThermalComfort; geometry: ShelterGeometry };
}

/**
 * Run the sensitivity analysis.
 *
 * Sampling is stratified per input — each input's samples are spread evenly
 * across its range and then independently shuffled, which is the Latin-hypercube
 * idea in its simplest form and reaches a usable band with far fewer runs than
 * plain random sampling.
 */
export function runUncertainty(inputs: UncertaintyInputs): UncertaintyResult {
  const samples = Math.max(4, Math.round(inputs.samples));
  const seed = inputs.seed ?? 20260501;
  const random = mulberry32(seed);

  /* Independent stratified sequence per input, so the design space is covered
     evenly in every dimension rather than clustered by chance. */
  const sampleMatrix: number[][] = UNCERTAINTY_INPUTS.map(() => {
    const strata = Array.from({ length: samples }, (_, i) => (i + random()) / samples);
    /* Fisher–Yates with the same seeded generator, so the run is reproducible. */
    for (let i = strata.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [strata[i], strata[j]] = [strata[j]!, strata[i]!];
    }
    /* Map (0,1) to a symmetric multiplier of −1 … +1. */
    return strata.map((u) => 2 * u - 1);
  });

  const baseline = inputs.evaluate(inputs.base).thermal;

  const outputValues: number[][] = UNCERTAINTY_OUTPUTS.map(() => []);
  const inputValues: number[][] = UNCERTAINTY_INPUTS.map(() => []);

  for (let s = 0; s < samples; s += 1) {
    let parameters = inputs.base;
    for (let i = 0; i < UNCERTAINTY_INPUTS.length; i += 1) {
      const definition = UNCERTAINTY_INPUTS[i]!;
      const deviation = sampleMatrix[i]![s]!;
      parameters = definition.apply(parameters, 1 + definition.spread * deviation);
      inputValues[i]!.push(deviation);
    }

    const { thermal } = inputs.evaluate(parameters);
    for (let o = 0; o < UNCERTAINTY_OUTPUTS.length; o += 1) {
      outputValues[o]!.push(UNCERTAINTY_OUTPUTS[o]!.read(thermal));
    }
  }

  const outputs: OutputDistribution[] = UNCERTAINTY_OUTPUTS.map((output, o) => {
    const values = outputValues[o]!;
    const sorted = values.slice().sort((a, b) => a - b);
    const p05 = percentile(sorted, 0.05);
    const p95 = percentile(sorted, 0.95);

    const raw = UNCERTAINTY_INPUTS.map((definition, i) => ({
      key: definition.key,
      label: definition.label,
      index: squaredRankCorrelation(inputValues[i]!, values),
    }));
    const total = raw.reduce((sum, entry) => sum + entry.index, 0);
    const contributions = raw
      .map((entry) => ({
        ...entry,
        index: total > 1e-9 ? entry.index / total : 1 / raw.length,
      }))
      .sort((a, b) => b.index - a.index);

    return {
      key: output.key,
      label: output.label,
      unit: output.unit,
      baseline: round2(output.read(baseline)),
      mean: round2(mean(values)),
      sd: round2(sd(values)),
      p05: round2(p05),
      p50: round2(percentile(sorted, 0.5)),
      p95: round2(p95),
      min: round2(sorted[0] ?? 0),
      max: round2(sorted[sorted.length - 1] ?? 0),
      bandWidth: round2(p95 - p05),
      contributions,
      dominant: contributions[0]?.label ?? '—',
    };
  });

  const widest = outputs.reduce((worst, o) =>
    relativeWidth(o) > relativeWidth(worst) ? o : worst,
  );

  const summary =
    `Across ${samples} samples, the ${widest.label.toLowerCase()} moves from ` +
    `${widest.p05} to ${widest.p95} ${widest.unit} (5th to 95th percentile) against a baseline of ` +
    `${widest.baseline} ${widest.unit} — a band of ${widest.bandWidth} ${widest.unit}, or about ` +
    `${(relativeWidth(widest) * 100).toFixed(0)} % of the baseline. It is dominated by ` +
    `${widest.dominant.toLowerCase()}. ` +
    `The index is a first-order rank correlation and ignores interactions between inputs.`;

  return {
    seed,
    sampleCount: samples,
    inputs: UNCERTAINTY_INPUTS.map((i) => ({
      key: i.key,
      label: i.label,
      spread: i.spread,
      basis: i.basis,
    })),
    outputs,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

/** Relative band width against the baseline, used to rank which output is noisiest. */
function relativeWidth(output: OutputDistribution): number {
  const scale = Math.max(1e-6, Math.abs(output.baseline));
  return output.bandWidth / scale;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/** Linear-interpolated percentile of an already-sorted array. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

/**
 * Squared Spearman rank correlation between an input and an output.
 *
 * Rank-based rather than linear because the relationship between, say,
 * insulation thickness and energy intensity is monotonic but not straight, and
 * a Pearson coefficient would understate it. Squared so it reads as a share of
 * variance and the contributions can be normalised.
 */
function squaredRankCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ra = ranks(a.slice(0, n));
  const rb = ranks(b.slice(0, n));
  const rho = pearson(ra, rb);
  return rho * rho;
}

/** Average ranks, so ties do not distort the coefficient. */
function ranks(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((x, y) => x.value - y.value);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]!.index] = average;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom > 1e-12 ? num / denom : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
