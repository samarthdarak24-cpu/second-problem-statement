/**
 * FastAPI backend client.
 *
 * The application runs fully standalone — every engine has a TypeScript
 * implementation that works offline. The Python backend is optional: when
 * `NEXT_PUBLIC_API_URL` is configured and reachable, climate resolution is
 * delegated to it. This keeps the documented architecture
 * (Frontend → FastAPI → Climate → Thermal → Optimisation) real, without making
 * the demo depend on a running Python process.
 *
 * WHAT THE BACKEND DOES NOT DO
 * It does not simulate buildings. The thermal model is the verified TypeScript
 * engine, and `POST /api/optimize` on the backend is a *surrogate screen* — it
 * ranks candidates with a trained model and returns three predicted metrics per
 * candidate, not a `ThermalComfort`. Treating its output as a simulation would
 * be reading a screening tool as an authority.
 */

import type {
  BuildingParameters,
  ClimateData,
  Location,
  MaterialProperties,
  OptimizationMethod,
  RecommendationEngine,
} from '@/types';

/** Base URL of the FastAPI service, without a trailing slash. */
export function getApiBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function isBackendConfigured(): boolean {
  return getApiBaseUrl() !== null;
}

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

/**
 * Raised when the backend is reachable but refuses to answer.
 *
 * Distinct from `BackendUnavailableError` on purpose. "The service is not there"
 * means fall back to the local engine. "The service is there and declined"
 * usually means a model failed its validation gate — and silently falling back
 * would hide the single most important signal the backend produces.
 */
export class BackendRefusedError extends Error {
  readonly reason: string | null;

  constructor(message: string, reason: string | null = null) {
    super(message);
    this.name = 'BackendRefusedError';
    this.reason = reason;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface ErrorPayload {
  detail?: unknown;
  reason?: string;
}

function describeError(payload: ErrorPayload, status: number, path: string): string {
  if (typeof payload.detail === 'string') return payload.detail;
  if (Array.isArray(payload.detail)) {
    // FastAPI's own validation errors arrive as a list of locations and messages.
    const first = payload.detail[0] as { loc?: unknown[]; msg?: string } | undefined;
    const where = Array.isArray(first?.loc) ? first.loc.join('.') : 'request';
    return `${where}: ${first?.msg ?? 'invalid request'}`;
  }
  return `Backend responded ${status} for ${path}`;
}

/**
 * Perform a JSON request against the backend with a hard timeout.
 *
 * Throws `BackendRefusedError` for a 503 (the service declined), and
 * `BackendUnavailableError` for anything else that is not 2xx.
 */
export async function backendRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new BackendUnavailableError('NEXT_PUBLIC_API_URL is not configured');
  }

  const { method = 'GET', body, timeoutMs = 8000, signal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      let payload: ErrorPayload = {};
      try {
        payload = (await response.json()) as ErrorPayload;
      } catch {
        // A non-JSON error body is still an error; the status carries the meaning.
      }
      const message = describeError(payload, response.status, path);
      if (response.status === 503) {
        throw new BackendRefusedError(message, payload.reason ?? null);
      }
      throw new BackendUnavailableError(message);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof BackendUnavailableError || error instanceof BackendRefusedError) {
      throw error;
    }
    throw new BackendUnavailableError(
      error instanceof Error ? error.message : 'Backend request failed',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export interface BackendHealth {
  status: string;
  version: string;
  engines: string[];
  /** Additive fields — a client that ignores them keeps working. */
  database?: string;
  stations?: number;
  materials?: number;
  /** True only when a trained model actually cleared its validation gate. */
  surrogateReady?: boolean;
}

/** Lightweight liveness probe. Returns null rather than throwing. */
export async function checkBackendHealth(timeoutMs = 2500): Promise<BackendHealth | null> {
  if (!isBackendConfigured()) return null;
  try {
    return await backendRequest<BackendHealth>('/api/health', { timeoutMs });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Climate                                                             */
/* ------------------------------------------------------------------ */

/** Ask the backend to resolve climate for a location. */
export async function fetchClimateFromBackend(
  location: Location,
  options: { preferLive?: boolean; signal?: AbortSignal } = {},
): Promise<ClimateData> {
  return backendRequest<ClimateData>('/api/climate/resolve', {
    method: 'POST',
    body: {
      location,
      prefer_live: options.preferLive ?? false,
    },
    signal: options.signal,
    timeoutMs: 15000,
  });
}

export async function fetchStationsFromBackend(country?: string): Promise<Location[]> {
  const query = country ? `?country=${encodeURIComponent(country)}` : '';
  return backendRequest<Location[]>(`/api/climate/stations${query}`);
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export async function fetchMaterialsFromBackend(): Promise<MaterialProperties[]> {
  return backendRequest<MaterialProperties[]>('/api/materials');
}

export interface DesignVocabulary {
  insulation: { levels: string[]; thicknessM: Record<string, number>; label: Record<string, string> };
  ventilation: { strategies: string[]; ach: Record<string, number>; label: Record<string, string> };
  roof: { strategies: string[]; pitchDeg: Record<string, number>; label: Record<string, string> };
  shading: { strategies: string[]; label: Record<string, string> };
  defaultRequirements: Partial<BuildingParameters>;
}

export async function fetchVocabularyFromBackend(): Promise<DesignVocabulary> {
  return backendRequest<DesignVocabulary>('/api/vocabulary');
}

/* ------------------------------------------------------------------ */
/* Surrogate                                                           */
/* ------------------------------------------------------------------ */

export interface SurrogateTargetReport {
  target: string;
  r2: number;
  mae: number;
  rmse: number;
  /** Spearman rank correlation on held-out data — the gate the model must clear. */
  spearman: number;
  gateMinSpearman: number;
  gateMaxMae: number;
  passedGate: boolean;
  /** True when the row predates the current gate and cannot be re-evaluated. */
  stale?: boolean;
}

export interface SurrogateModelSummary {
  modelId: string;
  createdAt: string;
  passedGate: boolean;
  targets: SurrogateTargetReport[];
  topFeatures: string[];
}

export interface SurrogateRegistry {
  models: SurrogateModelSummary[];
  ready: number;
  featureCount: number;
  targets: string[];
  gate: { minSpearman: number[]; maxMae: number[] };
  minTrainRows: number;
  explanation: string;
}

export async function fetchSurrogateRegistry(): Promise<SurrogateRegistry> {
  return backendRequest<SurrogateRegistry>('/api/ml/registry');
}

export interface FeatureContract {
  featureNames: string[];
  targetNames: string[];
  featureCount: number;
  groups: Array<{ label: string; count: number }>;
  gate: { minSpearman: number[]; maxMae: number[] };
}

export async function fetchFeatureContract(): Promise<FeatureContract> {
  return backendRequest<FeatureContract>('/api/ml/contract');
}

/* ------------------------------------------------------------------ */
/* Surrogate-guided screening                                          */
/* ------------------------------------------------------------------ */

export interface ScreenCandidate {
  id: string;
  label: string;
  parameters: BuildingParameters;
  /** Keyed by target name — see `fetchFeatureContract().targetNames`. */
  predictions: Record<string, number>;
  /** Held-out MAE per target. A point estimate without its error is a lie. */
  errorBars: Record<string, number>;
  objective: number;
  score: number;
}

export interface ScreenResponse {
  engine: RecommendationEngine;
  method: OptimizationMethod;
  modelId: string;
  candidatesEvaluated: number;
  /** The size of the full cross product the search did *not* enumerate. */
  spaceSize: number;
  durationMs: number;
  leaderboard: ScreenCandidate[];
  disclaimer: string;
}

/**
 * Ask the backend to screen a design neighbourhood with its surrogate.
 *
 * Throws `BackendRefusedError` when no model has cleared the validation gate.
 * That is not a failure to route around — it is the backend telling you it has
 * nothing trustworthy to say, and the caller should run its own physics engine.
 */
export async function screenDesignsWithBackend(
  payload: {
    location: Location;
    requirements: BuildingParameters;
    weights?: { discomfort: number; energy: number; cost: number };
    climate?: ClimateData;
    limit?: number;
    exhaustive?: boolean;
  },
  options: { signal?: AbortSignal } = {},
): Promise<ScreenResponse> {
  return backendRequest<ScreenResponse>('/api/optimize', {
    method: 'POST',
    body: payload,
    signal: options.signal,
    timeoutMs: 30000,
  });
}
