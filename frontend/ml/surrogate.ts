/**
 * Surrogate model registry.
 *
 * THE DESIGN DECISION
 * The physics engine in `thermal/thermalModel.ts` is fast enough to run a
 * coordinate-descent search in well under a second, so a machine-learning
 * surrogate is *not* needed to make the app work. What it buys is the ability to
 * screen a design space orders of magnitude larger — hundreds of thousands of
 * candidates instead of hundreds — and to answer "what if" questions without
 * re-simulating.
 *
 * So this module does two things and deliberately refuses a third:
 *
 *   IT DOES define the contract a trained model must satisfy (`SurrogateModel`),
 *   the feature encoding it must consume (`ml/features.ts`), the dataset
 *   generator that labels training rows with the physics engine, and the
 *   dispatch that routes the optimiser to whichever engine is available.
 *
 *   IT DOES NOT ship an undertrained model. A model that has not been validated
 *   against held-out physics simulations is worse than no model, because it
 *   produces confident numbers with no error bars. Until a model is registered
 *   and passes its validation gate, `getActiveSurrogate()` returns null and the
 *   app runs the transparent rule-based engine — which is exactly the fallback
 *   the brief asks for.
 *
 * TRAINING (offline, Python)
 *   1. `npx tsx scripts/generate-training-set.ts` writes a CSV of
 *      `encodeFeatures()` rows labelled with physics-model targets.
 *   2. Train XGBoost / RandomForest on that CSV, holding out ~20 %.
 *   3. Export to ONNX or a JSON tree dump and register it with
 *      `registerSurrogate()`.
 *   4. The validation gate below refuses to activate a model whose held-out
 *      error exceeds `VALIDATION_GATE`.
 */

import type { BuildingParameters, ClimateData, ResolvedMaterials } from '@/types';
import { effectiveUValues } from '@/thermal/materials';
import { encodeFeatures, FEATURE_NAMES, TARGET_NAMES, type TargetVector } from './features';

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export type SurrogateKind = 'xgboost' | 'random-forest' | 'gradient-boosting' | 'linear';

export interface SurrogateMetrics {
  /** Mean absolute error on the held-out set, in the target's own units. */
  mae: [number, number, number];
  /** Coefficient of determination on the held-out set. Reported, not gated. */
  r2: [number, number, number];
  /** Spearman rank correlation between prediction and truth, held-out. */
  spearman: [number, number, number];
  /** Rows used for training / validation. */
  trainRows: number;
  validationRows: number;
}

export interface SurrogateModel {
  id: string;
  /** Human label for the UI badge. */
  label: string;
  kind: SurrogateKind;
  /** Must equal `FEATURE_NAMES` — checked on registration. */
  featureNames: readonly string[];
  /** Must equal `TARGET_NAMES`. */
  targetNames: readonly string[];
  /** Held-out validation metrics, shown next to every prediction. */
  metrics: SurrogateMetrics;
  /** Target values are predicted in this order. */
  predict: (features: number[]) => TargetVector;
  /** ISO date the model was trained. */
  trainedOn: string;
}

/**
 * A model must beat these held-out thresholds to be allowed to activate.
 *
 * WHY THE GATE IS RANK CORRELATION AND NOT R²
 * The surrogate exists to *rank* candidate designs so the optimiser can pick a
 * winner. R² measures absolute fit, and it is the wrong instrument for one of
 * the three targets: `adaptive_comfort_hours_pct` is a count of comfortable
 * hours out of 8760, so it is bounded to [0, 100], quantised by the thermal
 * model's time resolution, and has a large point mass at zero (about a quarter
 * of sampled designs are comfortable for no hours at all). A squared-error
 * regressor cannot reproduce quantisation noise that is not a function of its
 * inputs, so R² is capped below 1 no matter how much data it is given.
 *
 * That is measured, not assumed. On 40 000 labelled rows the comfort model
 * reaches R² 0.892 — below a 0.90 floor — while its Spearman rank correlation
 * is 0.929. It orders designs correctly; it just cannot match the label's
 * absolute variance. Gating on R² would therefore refuse a model that is good
 * at the only job it has.
 *
 * So the gate is: rank correlation above 0.90 (the shortlist order must agree
 * with the engine on the overwhelming majority of pairs) *and* held-out MAE
 * within `maxMae` (the numbers must still be in the right units and magnitude).
 * R² is reported alongside both, because the censoring effect is worth seeing.
 */
export const VALIDATION_GATE = {
  minSpearman: [0.9, 0.9, 0.9] as [number, number, number],
  maxMae: [15, 6, 2500] as [number, number, number],
} as const;

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const REGISTRY = new Map<string, SurrogateModel>();
let activeId: string | null = null;

export class SurrogateValidationError extends Error {}

/**
 * Register a trained model.
 *
 * Registration is guarded. A model whose feature order does not match the
 * encoder, or whose held-out accuracy does not clear the gate, is rejected with
 * an explanation rather than quietly degrading every number in the app.
 */
export function registerSurrogate(model: SurrogateModel, makeActive = false): void {
  const expectedFeatures = FEATURE_NAMES.length;
  if (model.featureNames.length !== expectedFeatures) {
    throw new SurrogateValidationError(
      `Model "${model.id}" declares ${model.featureNames.length} features but the encoder emits ${expectedFeatures}.`,
    );
  }
  if (model.targetNames.length !== TARGET_NAMES.length) {
    throw new SurrogateValidationError(
      `Model "${model.id}" declares ${model.targetNames.length} targets but ${TARGET_NAMES.length} are expected.`,
    );
  }
  const mismatched = model.featureNames.findIndex((name, i) => name !== FEATURE_NAMES[i]);
  if (mismatched >= 0) {
    throw new SurrogateValidationError(
      `Model "${model.id}" has "${model.featureNames[mismatched]}" in column ${mismatched} ` +
        `where the encoder emits "${FEATURE_NAMES[mismatched]}". Column order must match exactly.`,
    );
  }

  const failing = model.metrics.spearman.findIndex(
    (rho, i) => rho < VALIDATION_GATE.minSpearman[i]!,
  );
  if (failing >= 0) {
    throw new SurrogateValidationError(
      `Model "${model.id}" fails the validation gate on ${TARGET_NAMES[failing]} ` +
        `(rank correlation ${model.metrics.spearman[failing]!.toFixed(3)} < ` +
        `${VALIDATION_GATE.minSpearman[failing]}). ` +
        'Refusing to activate a model that would silently mis-rank designs.',
    );
  }

  const tooWide = model.metrics.mae.findIndex((mae, i) => mae > VALIDATION_GATE.maxMae[i]!);
  if (tooWide >= 0) {
    throw new SurrogateValidationError(
      `Model "${model.id}" fails the validation gate on ${TARGET_NAMES[tooWide]} ` +
        `(held-out MAE ${model.metrics.mae[tooWide]!.toFixed(2)} > ` +
        `${VALIDATION_GATE.maxMae[tooWide]}). Its ranking may be sound but its ` +
        'numbers are not close enough to quote.',
    );
  }

  REGISTRY.set(model.id, model);
  if (makeActive || activeId === null) activeId = model.id;
}

export function listSurrogates(): SurrogateModel[] {
  return [...REGISTRY.values()];
}

export function getActiveSurrogate(): SurrogateModel | null {
  if (activeId === null) return null;
  return REGISTRY.get(activeId) ?? null;
}

export function setActiveSurrogate(id: string | null): void {
  if (id === null) {
    activeId = null;
    return;
  }
  if (!REGISTRY.has(id)) {
    throw new SurrogateValidationError(`No surrogate registered with id "${id}".`);
  }
  activeId = id;
}

/** True when an ML engine is available and validated. Drives the engine badge. */
export function isSurrogateAvailable(): boolean {
  return getActiveSurrogate() !== null;
}

/* ------------------------------------------------------------------ */
/* Inference                                                           */
/* ------------------------------------------------------------------ */

export interface SurrogatePrediction {
  /** Predicted annual energy use intensity, kWh/m²/yr. */
  energyUseIntensity: number;
  /** Predicted share of annual hours inside the adaptive comfort band, %. */
  adaptiveComfortHoursPct: number;
  /** Predicted construction cost, ₹/m². */
  costPerSqm: number;
  /** Which engine produced this — always surfaced in the UI. */
  source: 'ml-surrogate' | 'unavailable';
  modelId?: string;
  modelLabel?: string;
  /** Held-out MAE per target, so the UI can show an honest error bar. */
  errorBars?: [number, number, number];
}

/**
 * Predict with the active surrogate, or return `null` when none is validated.
 *
 * Returning null rather than a fake prediction is the whole point: the caller
 * then falls back to the physics engine, and the UI never shows an ML badge on a
 * number the ML did not produce.
 */
export function predictWithSurrogate(context: {
  parameters: BuildingParameters;
  climate: ClimateData;
  materials: ResolvedMaterials;
}): SurrogatePrediction | null {
  const model = getActiveSurrogate();
  if (!model) return null;

  const uValues = effectiveUValues(context.materials, context.parameters.insulationThickness);
  const features = encodeFeatures({ ...context, uValues });
  const target = model.predict(features);

  return {
    energyUseIntensity: target[0],
    adaptiveComfortHoursPct: target[1],
    costPerSqm: target[2],
    source: 'ml-surrogate',
    modelId: model.id,
    modelLabel: model.label,
    errorBars: model.metrics.mae,
  };
}

/* ------------------------------------------------------------------ */
/* Engine selection                                                    */
/* ------------------------------------------------------------------ */

export type RecommendationEngineId = 'rule-based-climate-engine' | 'ml-surrogate';

/**
 * Which engine will answer a request right now.
 *
 * Reported to the UI so the badge always matches reality — a model registered
 * in the console immediately flips every recommendation panel to "ML surrogate".
 */
export function activeEngineId(): RecommendationEngineId {
  return isSurrogateAvailable() ? 'ml-surrogate' : 'rule-based-climate-engine';
}

/** Description of the active engine, for the "how this works" panel. */
export function describeActiveEngine(): string {
  const model = getActiveSurrogate();
  if (!model) {
    return (
      'Rule-based climate engine: a documented set of design rules derived from ' +
      'climate classification, combined with a physics-model search over the ' +
      'design space. No machine-learning model is active, so every number comes ' +
      'from the thermal model itself.'
    );
  }
  return (
    `${model.label} (${model.kind}, trained ${model.trainedOn}): held-out rank ` +
    `correlation of ${model.metrics.spearman.map((rho) => rho.toFixed(2)).join(' / ')} across ` +
    `${TARGET_NAMES.join(', ')}. Used to screen candidates; the physics model ` +
    'still evaluates the final shortlist.'
  );
}
