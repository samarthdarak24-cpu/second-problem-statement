/**
 * Climate service — the single entry point the UI uses to obtain climate data.
 *
 * Provider chain, in priority order:
 *   1. FastAPI backend            (only when NEXT_PUBLIC_API_URL is set)
 *   2. Live Open-Meteo reanalysis (only when the caller opts in)
 *   3. Offline climatology DB     (station match by id)
 *   4. Interpolated / synthesised (arbitrary coordinates, e.g. map clicks)
 *
 * The offline paths mean the whole pipeline works with no network and no Python
 * process, which is what makes the prototype demonstrable anywhere.
 */

import type { ClimateData, Location } from '@/types';
import { fetchClimateFromBackend, isBackendConfigured, BackendUnavailableError } from '@/api/client';
import { buildClimateData, resolveOfflineClimate } from './deriveClimate';
import { STATION_BY_ID } from './stations';
import { classifyClimate } from './classify';
import { fetchOpenMeteoClimate, OPEN_METEO_ATTRIBUTION } from './providers/openMeteo';

export type ClimateProviderId =
  | 'backend'
  | 'open-meteo'
  | 'database'
  | 'interpolated'
  | 'synthesised';

export interface ClimateResolution {
  data: ClimateData;
  provider: ClimateProviderId;
  /** Plain-language note about where the numbers came from. */
  note: string;
  /** Attribution string for the UI footer. */
  attribution: string;
  /** Provider attempts that failed, in order — surfaced in the UI. */
  fallbacks: string[];
}

export interface ResolveClimateOptions {
  /** Try the live Open-Meteo API before falling back to offline data. */
  preferLive?: boolean;
  /** Try the FastAPI backend first (only if configured). */
  preferBackend?: boolean;
  /**
   * Optional Open-Meteo API key for the live lookup.
   *
   * Lifts the per-IP rate limit so many sites can be resolved in one session
   * without hitting 429s. Sent as the `apikey` query parameter by the provider.
   * Falls back to `NEXT_PUBLIC_OPEN_METEO_API_KEY` when omitted.
   */
  openMeteoApiKey?: string;
  signal?: AbortSignal;
  /**
   * How long to wait for the live API, ms. Defaults to `LIVE_PROBE_TIMEOUT_MS`.
   *
   * This is deliberately much shorter than the provider's own 12 s request
   * timeout. The live lookup is an *upgrade* over a perfectly good offline
   * climatology, not a prerequisite — so it is not worth making the user wait
   * twelve seconds to find out the venue wifi is down.
   */
  liveTimeoutMs?: number;
}

/**
 * Budget for the live lookup, ms.
 *
 * Chosen against the offline alternative being free and instant: four seconds
 * is long enough for a working connection on a slow link, and short enough that
 * a dead one costs the user a visible but tolerable pause rather than a stall.
 */
export const LIVE_PROBE_TIMEOUT_MS = 4000;

/**
 * Session memory of whether the live API is worth trying.
 *
 * Without this, every press of "Generate design" would re-attempt a network
 * call that has already failed — turning a three-second wait into a
 * three-second wait *every time*, which is exactly the kind of thing that makes
 * a demo look broken in a hall with no wifi. One failure is enough evidence to
 * stop asking for the rest of the session.
 *
 * A success pins it to `available` so later calls skip straight through.
 */
type LiveAvailability = 'unknown' | 'available' | 'unavailable';
let liveAvailability: LiveAvailability = 'unknown';

/** Current belief about the live API. Exposed so the UI can label it. */
export function liveDataAvailability(): LiveAvailability {
  return liveAvailability;
}

/** Forget the probe result — used by tests and by a manual "retry live" action. */
export function resetLiveAvailability(): void {
  liveAvailability = 'unknown';
}

/**
 * Per-location resolution cache.
 *
 * Climate normals do not change within a session, and the expensive part of a
 * resolution is the live archive request — a year of hourly records, which takes
 * one to three seconds. A demo that walks through five cities would otherwise
 * pay that cost every time the user switched back to one it had already seen,
 * and switching back and forth is exactly how a demo works.
 *
 * Keyed on the coordinates as well as the id, so a map-clicked point and a named
 * station can never collide.
 */
const resolutionCache = new Map<string, ClimateResolution>();

function cacheKey(location: Location): string {
  return `${location.id}@${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}

/** Clear the cache — used by tests, and after changing the provider chain. */
export function resetClimateCache(): void {
  resolutionCache.clear();
}

/**
 * Resolve climate data offline and synchronously. Always succeeds.
 */
export function resolveClimateOffline(location: Location): ClimateResolution {
  const station = STATION_BY_ID.get(location.id);

  if (station) {
    return {
      data: buildClimateData(station, 'database'),
      provider: 'database',
      note: `Station record for ${station.location.city}, ${station.location.country}.`,
      attribution: 'Offline climatology database (long-term monthly normals).',
      fallbacks: [],
    };
  }

  const { data, method, note } = resolveOfflineClimate(
    location.latitude,
    location.longitude,
    location.elevation,
  );

  return {
    data,
    provider: method === 'interpolated' ? 'interpolated' : 'synthesised',
    note,
    attribution:
      method === 'interpolated'
        ? 'Offline climatology database, inverse-distance interpolation.'
        : 'Latitude/elevation synthesis model (no nearby station).',
    fallbacks: [],
  };
}

/**
 * Resolve climate data, preferring richer sources when they are available.
 */
export async function resolveClimate(
  location: Location,
  options: ResolveClimateOptions = {},
): Promise<ClimateResolution> {
  const key = cacheKey(location);
  const cached = resolutionCache.get(key);
  if (cached) {
    return {
      ...cached,
      fallbacks: [...cached.fallbacks, 'Served from the session cache for this site.'],
    };
  }

  const resolved = await resolveClimateUncached(location, options);
  resolutionCache.set(key, resolved);
  return resolved;
}

async function resolveClimateUncached(
  location: Location,
  options: ResolveClimateOptions,
): Promise<ClimateResolution> {
  const fallbacks: string[] = [];

  // 1 — FastAPI backend.
  if (options.preferBackend && isBackendConfigured()) {
    try {
      const data = await fetchClimateFromBackend(location, {
        preferLive: options.preferLive,
        signal: options.signal,
      });
      /*
       * The service is a *transport*, not a source. It can answer from its own
       * station record or from the live archive, and those are different
       * numbers for the same city — Pune's long-term normal is 747 mm/yr, while
       * 2019–2023 reanalysis gives 1155 mm/yr and a different Köppen class.
       * Reporting "the backend" without saying which of the two it used would
       * hide that difference behind a service name, so the payload's own
       * `source` field decides the wording.
       */
      const fromLiveArchive = data.source === 'api';
      return {
        data,
        provider: 'backend',
        note: fromLiveArchive
          ? 'Resolved by the FastAPI climate service from the live Open-Meteo archive.'
          : 'Resolved by the FastAPI climate service from its station record.',
        attribution: fromLiveArchive
          ? `FastAPI backend (Python) → ${OPEN_METEO_ATTRIBUTION}`
          : 'FastAPI backend (Python) → offline climatology database.',
        fallbacks,
      };
    } catch (error) {
      const message =
        error instanceof BackendUnavailableError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'unknown error';
      fallbacks.push(`Backend unavailable: ${message}`);
    }
  }

  // 2 — Live Open-Meteo reanalysis.
  //
  // Skipped entirely once the session has established that the network is not
  // there: re-probing on every Generate is what turns a one-off delay into a
  // permanent one. See `liveAvailability`.
  if (options.preferLive && liveAvailability !== 'unavailable') {
    try {
      const data = await fetchOpenMeteoClimate(location, {
        signal: options.signal,
        timeoutMs: options.liveTimeoutMs ?? LIVE_PROBE_TIMEOUT_MS,
        apiKey: options.openMeteoApiKey,
      });
      liveAvailability = 'available';
      return {
        data,
        provider: 'open-meteo',
        note: 'Live reanalysis aggregated to monthly normals.',
        attribution: OPEN_METEO_ATTRIBUTION,
        fallbacks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      liveAvailability = 'unavailable';
      fallbacks.push(
        `Live API unavailable (${message}) — using the offline climatology for the rest of this session.`,
      );
    }
  } else if (options.preferLive) {
    fallbacks.push('Live API skipped — it was unreachable earlier in this session.');
  }

  // 3 & 4 — Offline database, interpolation or synthesis.
  const offline = resolveClimateOffline(location);
  return { ...offline, fallbacks };
}

/**
 * Re-classify a climate payload. Used when the offline database's stored
 * classification needs to be re-derived (e.g. after elevation adjustment).
 */
export function reclassify(data: ClimateData): ClimateData {
  const classification = classifyClimate(data.monthly);
  return {
    ...data,
    climateType: `${classification.label} (${classification.code})`,
    climateZone: classification.zone,
  };
}
