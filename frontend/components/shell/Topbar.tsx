'use client';

/**
 * The compact header.
 *
 * Three rows, but the first is the only one anyone needs most of
 * the time. The new header carries:
 *
 *   LEFT   page title + description (the page's identity)
 *   RIGHT  site selector + Auto/Manual + Generate design
 *
 * Everything else — backend, live-data toggle, API key, the priority
 * slider, the scenarios row, the duration chip — has been moved to
 * the page that owns it, or to Settings. The header used to be a
 * control panel; it is now a navigation bar with one CTA.
 *
 * The pipeline is no longer in the header either. The Dashboard
 * shows a compact progress strip instead, and a Generation overlay
 * covers the page while a run is in flight.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  MapPin,
  Play,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Thermometer,
} from 'lucide-react';
import { AVAILABLE_COUNTRIES, citiesInCountry, STATION_BY_ID } from '@/climate/stations';
import { searchPlaces, placeToLocation, type GeoPlace } from '@/climate/providers/geocoding';
import { useDesignStore } from '@/store/designStore';
import { Chip } from '@/components/ui/primitives';
import { LocationChip, StatusBadge } from '@/components/ui/soft';
import { ZONE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { navItemFor } from './nav';
import type { DesignMode } from '@/types';

export function Topbar() {
  const pathname = usePathname();
  const page = navItemFor(pathname);

  const location = useDesignStore((state) => state.location);
  const setLocation = useDesignStore((state) => state.setLocation);
  const mode = useDesignStore((state) => state.mode);
  const setMode = useDesignStore((state) => state.setMode);
  const generate = useDesignStore((state) => state.generate);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const statusMessage = useDesignStore((state) => state.statusMessage);
  const error = useDesignStore((state) => state.error);
  const dismissError = useDesignStore((state) => state.dismissError);
  const climateData = useDesignStore((state) => state.climateData);
  const openMeteoApiKey = useDesignStore((state) => state.openMeteoApiKey);

  const cities = useMemo(
    () => (location ? citiesInCountry(location.country) : []),
    [location],
  );

  const onCityChange = (id: string): void => {
    const station = STATION_BY_ID.get(id);
    if (station) setLocation(station.location);
  };

  /* --- "Search any location" (free Open-Meteo geocoding) ---------------
     Lets the user pick a place that is not in the bundled Indian station
     list. The resolved coordinates flow through the existing climate
     service, which handles arbitrary points via interpolation/synthesis
     (offline) or the live archive (when live lookups are on). */
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPlaces([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const handle = setTimeout(() => {
      searchPlaces(term, { apiKey: openMeteoApiKey, signal: controller.signal })
        .then((found) => {
          setPlaces(found);
          setShowResults(true);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, openMeteoApiKey]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectPlace = (place: GeoPlace): void => {
    setLocation(placeToLocation(place));
    setQuery(`${place.name}, ${place.country}`);
    setShowResults(false);
  };

  const statusTone: 'generating' | 'ready' | 'updated' | 'idle' | 'error' = isGenerating
    ? 'generating'
    : error
      ? 'error'
      : climateData
        ? 'ready'
        : 'idle';
  const statusLabel = isGenerating
    ? 'Generating'
    : error
      ? 'Error'
      : climateData
        ? 'Ready'
        : 'Idle';

  return (
    <header
      className="sticky top-0 z-30 border-b"
      style={{
        background: 'hsl(36 24% 98% / 0.82)',
        backdropFilter: 'blur(14px) saturate(150%)',
        WebkitBackdropFilter: 'blur(14px) saturate(150%)',
        borderColor: 'hsl(30 14% 88% / 0.7)',
        /* A single hairline of shadow under the header, so the content
           scrolling beneath it is visibly *beneath* it. Without this the
           translucent header and the page read as one flat field. */
        boxShadow: '0 1px 0 0 hsl(30 14% 88% / 0.5), 0 4px 12px -8px hsl(24 20% 20% / 0.12)',
      }}
    >
      {/* ---------------- Row 1 — page identity + status ---------------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-4">
        {/* Brand mark, mobile only — below `lg` the sidebar is hidden, so
            this is the only place the product identifies itself. */}
        <Link
          href="/"
          className="flex items-center gap-2 lg:hidden"
          aria-label="Thermal Shelter — back to site home"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-primary-foreground"
            style={{
              background:
                'linear-gradient(140deg, hsl(22 78% 56%) 0%, hsl(18 68% 40%) 100%)',
              boxShadow:
                'inset 0 1px 0 0 hsl(30 90% 78% / 0.5), 0 3px 10px -3px hsl(18 68% 30% / 0.4)',
            }}
          >
            <Thermometer size={16} />
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {page ? (
              <span
                className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
              >
                {page.group}
              </span>
            ) : null}
            <StatusBadge tone={statusTone} label={statusLabel} />
            {climateData ? (
              <Chip tone="accent" title={climateData.climateType}>
                {ZONE_LABEL[climateData.climateZone]}
              </Chip>
            ) : null}
          </div>
          <h1 className="mt-1 font-display text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-foreground sm:text-[24px]">
            {page?.label ?? 'Thermal Shelter'}
          </h1>
          {page ? (
            <p className="mt-0.5 max-w-[520px] truncate text-[12.5px] text-muted-foreground">
              {page.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* ---------------- Row 2 — the only "controls" row ----------------
           Site selector, search, mode, generate. That's it. */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-6 py-3"
        style={{
          borderColor: 'hsl(30 14% 88% / 0.6)',
          background: 'hsl(36 22% 97% / 0.5)',
        }}
      >
        {/* --- Site selector pill ---
           Widths are fixed from `sm` up, but fluid below it. The old
           `w-[160px]` / `w-[200px]` pair plus the 200px search input were
           a fixed 560px inside a bar that has to fit a 390px phone, so
           every route scrolled horizontally by exactly 168px. */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <MapPin size={14} aria-hidden className="shrink-0 text-muted-foreground" />
          {location ? (
            <LocationChip city={location.city} state={location.state} />
          ) : (
            <span className="text-[12px] text-muted-foreground">No site</span>
          )}
          <select
            className="select-field h-9 min-w-0 flex-1 sm:w-[160px] sm:flex-none"
            value={location?.country ?? ''}
            onChange={(event) => {
              const first = citiesInCountry(event.target.value)[0];
              if (first) setLocation(first.location);
            }}
            aria-label="Country"
          >
            {AVAILABLE_COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          <select
            className="select-field h-9 min-w-0 flex-[1.4] sm:w-[200px] sm:flex-none"
            value={location?.id ?? ''}
            onChange={(event) => onCityChange(event.target.value)}
            aria-label="City"
          >
            {cities.map((station) => (
              <option key={station.location.id} value={station.location.id}>
                {station.location.city}, {station.location.state}
              </option>
            ))}
          </select>
        </div>

        {/* --- Search any location --- */}
        <div
          ref={searchBoxRef}
          className="relative flex w-full min-w-0 items-center gap-1.5 sm:w-auto"
        >
          <Search size={13} aria-hidden className="shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => places.length > 0 && setShowResults(true)}
            placeholder="Search any location…"
            className="field h-9 min-w-0 flex-1 sm:w-[200px] sm:flex-none"
            aria-label="Search any location by name"
          />
          {searching ? (
            <span className="text-[11px] text-muted-foreground/70">…</span>
          ) : null}
          {showResults && places.length > 0 ? (
            <ul
              className="absolute left-0 right-0 top-[42px] z-50 max-h-64 overflow-auto rounded-[14px] border bg-panel p-1 sm:right-auto sm:w-[260px]"
              style={{
                borderColor: 'hsl(30 14% 88% / 0.8)',
                boxShadow: 'var(--shadow-overlay)',
              }}
              role="listbox"
            >
              {places.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-secondary/70"
                    onClick={() => selectPlace(place)}
                  >
                    <span className="text-[12.5px] font-medium text-foreground">{place.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {[place.admin1, place.country].filter(Boolean).join(', ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* --- Mode --- */}
        <div
          className="inline-flex items-center gap-0.5 rounded-full border bg-panel p-0.5"
          style={{
            borderColor: 'hsl(30 14% 88% / 0.8)',
            boxShadow: 'var(--inset-highlight)',
          }}
          role="tablist"
        >
          {(
            [
              {
                value: 'auto' as DesignMode,
                label: 'Auto',
                icon: Sparkles,
                title: 'The optimizer chooses the envelope',
              },
              {
                value: 'manual' as DesignMode,
                label: 'Manual',
                icon: RotateCcw,
                title: 'You drive the envelope',
              },
            ]
          ).map((opt) => {
            const Icon = opt.icon;
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                title={opt.title}
                aria-selected={active}
                onClick={() => setMode(opt.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                style={
                  active
                    ? {
                        background:
                          'linear-gradient(180deg, hsl(var(--pastel-peach)) 0%, hsl(var(--pastel-peach-deep)) 100%)',
                        boxShadow:
                          'inset 0 0 0 1px hsl(22 72% 86%), var(--shadow-hairline)',
                      }
                    : undefined
                }
              >
                <Icon size={13} aria-hidden />
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const leh = STATION_BY_ID.get('in-leh');
              if (leh) {
                setLocation(leh.location);
                void generate();
              }
            }}
            className="flex items-center gap-1.5 rounded-full border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
            title="Instantly load DRDO Leh, Ladakh (3,500m extreme cold high-altitude benchmark)"
          >
            <Shield size={13} />
            <span className="hidden sm:inline">DRDO Leh Benchmark</span>
          </button>
          <span className="hidden text-[12px] text-muted-foreground xl:inline">
            {statusMessage}
          </span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void generate()}
            disabled={isGenerating || !location}
          >
            <Play size={14} aria-hidden />
            {isGenerating ? 'Generating…' : 'Generate design'}
          </button>
        </div>
      </div>

      {/* ---------------- Error ---------------- */}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-t px-6 py-3"
          style={{
            background: 'hsl(var(--destructive) / 0.08)',
            borderColor: 'hsl(var(--destructive) / 0.3)',
          }}
        >
          <AlertTriangle
            size={14}
            className="mt-[2px] shrink-0"
            style={{ color: 'hsl(var(--destructive))' }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold" style={{ color: 'hsl(var(--destructive))' }}>
              The pipeline could not finish
            </p>
            <p className="mt-0.5 break-words text-[12.5px] text-muted-foreground">{error}</p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}
    </header>
  );
}