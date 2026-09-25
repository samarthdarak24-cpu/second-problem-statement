/**
 * Place search — Open-Meteo geocoding API.
 *
 * This is the front door for "I want a site that is not in the bundled Indian
 * station list." Open-Meteo's geocoding endpoint is free, keyless, and global,
 * so typing "Leh", "Reykjavik" or "Atacama" returns candidate coordinates the
 * rest of the pipeline already knows how to handle — the climate service resolves
 * arbitrary coordinates through its interpolation/synthesis paths when no
 * station matches, and through the live archive when live lookups are on.
 *
 * An optional API key is threaded through identically to the archive provider:
 * it lifts the rate cap, which is exactly what a demo walking through many cities
 * needs, and it is what stops a shared venue IP from getting 429s.
 */

import type { Location } from '@/types';

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

/** Default API key from the build-time env (see openMeteo.ts for the rationale). */
export const OPEN_METEO_API_KEY = process.env.NEXT_PUBLIC_OPEN_METEO_API_KEY ?? '';

export interface GeoPlace {
  /** A stable, reversible id we synthesise from coordinates. */
  id: string;
  name: string;
  country: string;
  countryCode: string;
  admin1: string;
  latitude: number;
  longitude: number;
  elevation: number;
}

/**
 * The subset of Open-Meteo's geocoding response this module reads.
 */
interface GeocodingResponse {
  results?: Array<{
    name?: string;
    country?: string;
    country_code?: string;
    admin1?: string;
    latitude?: number;
    longitude?: number;
    elevation?: number;
  }>;
  reason?: string;
  error?: boolean;
}

/**
 * Resolve a free-text place name to candidate locations.
 *
 * @returns up to `limit` places; empty when nothing matched or the request failed.
 *          Failure is swallowed (returns []) so the UI can simply show "no matches"
 *          rather than break the typing flow.
 */
export async function searchPlaces(
  query: string,
  options: { limit?: number; apiKey?: string; signal?: AbortSignal } = {},
): Promise<GeoPlace[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const apiKey = options.apiKey ?? OPEN_METEO_API_KEY;
  const params = new URLSearchParams({
    name: term,
    count: String(options.limit ?? 6),
    language: 'en',
    format: 'json',
  });
  if (apiKey) params.set('apikey', apiKey);

  try {
    const response = await fetch(`${GEOCODING_ENDPOINT}?${params.toString()}`, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as GeocodingResponse;
    if (payload.error || !payload.results) return [];

    return payload.results
      .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map((r) => {
        const latitude = r.latitude as number;
        const longitude = r.longitude as number;
        return {
          id: `geo-${latitude.toFixed(4)},${longitude.toFixed(4)}`,
          name: r.name ?? 'Unknown',
          country: r.country ?? '',
          countryCode: r.country_code ?? '',
          admin1: r.admin1 ?? '',
          latitude,
          longitude,
          elevation: r.elevation ?? 0,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Convert a geocoded place into the `Location` shape the pipeline consumes.
 *
 * The id is coordinate-derived so it can never collide with a bundled station,
 * and so re-selecting the same place re-hits the climate cache instead of
 * re-fetching.
 */
export function placeToLocation(place: GeoPlace): Location {
  return {
    id: place.id,
    country: place.country || place.countryCode || 'Custom',
    state: place.admin1 || '',
    city: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    elevation: place.elevation,
  };
}
