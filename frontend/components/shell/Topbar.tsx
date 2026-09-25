'use client';

/**
 * The topbar.
 *
 * Carries the controls that define a run — *where* (site), *how hard to push*
 * (priority), and *who decides the envelope* (auto or manual) — plus the
 * Generate action and the headline result of the last run.
 *
 * It is sticky and present on every page on purpose. Changing the site on the
 * Thermal Analysis page should regenerate there, not send you back to a
 * "settings" page first: the site is a property of the analysis, not of a form.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  KeyRound,
  MapPin,
  Play,
  RotateCcw,
  Search,
  Server,
  Sparkles,
  Thermometer,
  Wifi,
} from 'lucide-react';
import { AVAILABLE_COUNTRIES, citiesInCountry, STATION_BY_ID } from '@/climate/stations';
import { searchPlaces, placeToLocation, type GeoPlace } from '@/climate/providers/geocoding';
import { useDesignStore } from '@/store/designStore';
import { Chip, Segmented } from '@/components/ui/primitives';
import { ZONE_LABEL } from '@/lib/labels';
import { pct, temp } from '@/utils/format';
import { cn } from '@/lib/utils';
import { navItemFor } from './nav';
import type { DesignMode } from '@/types';

/** The scenario the demo walks through: composite → cold desert → hot-dry → hot-humid. */
const DEMO_CITIES = ['in-pune', 'in-leh', 'in-jodhpur', 'in-chennai', 'in-shillong'];

export function Topbar() {
  const pathname = usePathname();
  const page = navItemFor(pathname);

  const location = useDesignStore((state) => state.location);
  const setLocation = useDesignStore((state) => state.setLocation);
  const mode = useDesignStore((state) => state.mode);
  const setMode = useDesignStore((state) => state.setMode);
  const priority = useDesignStore((state) => state.priority);
  const setPriority = useDesignStore((state) => state.setPriority);
  const generate = useDesignStore((state) => state.generate);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const statusMessage = useDesignStore((state) => state.statusMessage);
  const error = useDesignStore((state) => state.error);
  const dismissError = useDesignStore((state) => state.dismissError);
  const climateData = useDesignStore((state) => state.climateData);
  const metrics = useDesignStore((state) => state.metrics);
  const baselineMetrics = useDesignStore((state) => state.baselineMetrics);
  const score = useDesignStore((state) => state.score);
  const baselineScore = useDesignStore((state) => state.baselineScore);
  const durationMs = useDesignStore((state) => state.durationMs);
  const useBackend = useDesignStore((state) => state.useBackend);
  const setUseBackend = useDesignStore((state) => state.setUseBackend);
  const backendConfigured = useDesignStore((state) => state.backendConfigured);
  const preferLive = useDesignStore((state) => state.preferLive);
  const setPreferLive = useDesignStore((state) => state.setPreferLive);
  const openMeteoApiKey = useDesignStore((state) => state.openMeteoApiKey);
  const setOpenMeteoApiKey = useDesignStore((state) => state.setOpenMeteoApiKey);

  const cities = useMemo(
    () => (location ? citiesInCountry(location.country) : []),
    [location],
  );

  const energyChange =
    metrics && baselineMetrics && baselineMetrics.annualEnergy > 0
      ? ((metrics.annualEnergy - baselineMetrics.annualEnergy) / baselineMetrics.annualEnergy) * 100
      : null;

  const onCityChange = (id: string): void => {
    const station = STATION_BY_ID.get(id);
    if (station) setLocation(station.location);
  };

  /* --- "Search any location" (free Open-Meteo geocoding) ---------------
     Lets the user pick a place that is not in the bundled Indian station list.
     The resolved coordinates flow through the existing climate service, which
     handles arbitrary points via interpolation/synthesis (offline) or the live
     archive (when live lookups are on). A keyed lookup avoids 429s on many
     queries. */
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

  return (
    <header className="sticky top-0 z-30 border-b bg-panel">
      {/* ---------------- Row 1 — page identity and the run controls ---------------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-3.5">
        {/* Brand mark, mobile only — below `lg` the sidebar is hidden, so this
            is the only place the product identifies itself. */}
        <Link
          href="/"
          className="flex items-center gap-2 lg:hidden"
          aria-label="Thermal Shelter — back to site home"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <Thermometer size={16} />
          </span>
        </Link>

        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {page?.label ?? 'Thermal Shelter'}
          </h1>
          <p className="mt-0.5 max-w-[420px] truncate text-[12.5px] text-muted-foreground">
            {page?.description ?? 'Climate-responsive shelter design'}
          </p>
        </div>

        {/* --- Site --- */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin size={14} aria-hidden />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]">Site</span>
          </span>

          <select
            className="select-field w-[136px]"
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
            className="select-field w-[200px]"
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

        {/* --- Search any location (free Open-Meteo geocoding) --- */}
        <div ref={searchBoxRef} className="relative flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Search size={14} aria-hidden />
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => places.length > 0 && setShowResults(true)}
            placeholder="Search any location…"
            className="input-field h-9 w-[200px]"
            aria-label="Search any location by name"
          />
          {searching ? (
            <span className="text-[11px] text-muted-foreground/70">…</span>
          ) : null}
          {showResults && places.length > 0 ? (
            <ul
              className="absolute left-0 top-[38px] z-50 max-h-64 w-[260px] overflow-auto rounded-lg border border-border bg-panel p-1 shadow-lg"
              role="listbox"
            >
              {places.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-secondary/60"
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
        <Segmented<DesignMode>
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'auto',
              label: 'Auto',
              title: 'The optimiser chooses orientation, envelope, shading and ventilation',
              icon: <Sparkles size={13} aria-hidden />,
            },
            {
              value: 'manual',
              label: 'Manual',
              title: 'You drive the envelope; the model evaluates every change',
              icon: <RotateCcw size={13} aria-hidden />,
            },
          ]}
        />

        {/* --- Backend routing ---
             Only rendered when a backend is actually configured. A control that
             is always present but does nothing teaches the user that the
             architecture is decoration, which is worse than omitting it. */}
        {backendConfigured ? (
          <button
            type="button"
            onClick={() => setUseBackend(!useBackend)}
            title={
              useBackend
                ? 'Climate and screening go through the FastAPI service when it answers, and locally when it does not. Click to route everything locally.'
                : 'Everything runs in the browser. Click to try the FastAPI service first.'
            }
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12.5px] font-medium transition-colors',
              useBackend
                ? 'border-primary/45 bg-primary/15 text-primary'
                : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={useBackend}
          >
            <Server size={13} aria-hidden />
            Backend
          </button>
        ) : null}

        {/* --- Live climate lookups ---
             Off pins every run to the bundled climatology database: same answer
             every time, no network wait. That is the setting to use when a
             demonstration must not stall on a dead venue connection, or when a
             result has to be reproducible. */}
        <button
          type="button"
          onClick={() => setPreferLive(!preferLive)}
          title={
            preferLive
              ? 'The next Generate will try the live Open-Meteo reanalysis first, then fall back to the bundled database. Click to pin it to the database.'
              : 'Pinned to the bundled climatology database — results are reproducible and instant. Click to try live reanalysis first.'
          }
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12.5px] font-medium transition-colors',
            preferLive
              ? 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground'
              : 'border-primary/45 bg-primary/15 text-primary',
          )}
          aria-pressed={!preferLive}
        >
          <Wifi size={13} aria-hidden />
          {preferLive ? 'Live data' : 'Offline'}
        </button>

        {/* --- Open-Meteo API key (optional) ---
             A key only lifts the live-lookup rate limit so many sites resolve
             without 429s; it is not required for global coverage. Seeded from
             NEXT_PUBLIC_OPEN_METEO_API_KEY, and editable here at runtime. */}
        <div className="flex items-center gap-1.5" title="Optional Open-Meteo API key — lifts the live-lookup rate limit for many sites">
          <KeyRound size={13} className="text-muted-foreground" aria-hidden />
          <input
            type="password"
            value={openMeteoApiKey}
            onChange={(event) => setOpenMeteoApiKey(event.target.value)}
            placeholder="Open-Meteo key (optional)"
            className="input-field h-9 w-[150px]"
            aria-label="Open-Meteo API key"
          />
        </div>

        {/* --- Generate --- */}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[12.5px] text-muted-foreground xl:inline">
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

      {/* ---------------- Row 2 — priority, headline result, scenarios ---------------- */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t bg-card px-6 py-2.5">
        <label className="flex min-w-[260px] max-w-[360px] flex-1 items-center gap-3">
          <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Optimise for
          </span>
          <span className="whitespace-nowrap text-[11.5px] text-muted-foreground/70">cost</span>
          <input
            type="range"
            className="slider flex-1"
            min={0}
            max={1}
            step={0.05}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            aria-label="Optimisation priority"
          />
          <span className="whitespace-nowrap text-[11.5px] text-muted-foreground/70">comfort</span>
          <span className="w-[42px] whitespace-nowrap text-[12px] font-semibold tabular-nums text-primary">
            {pct(priority * 100)}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {climateData ? (
            <>
              <Chip tone="accent" title={climateData.climateType}>
                {ZONE_LABEL[climateData.climateZone]}
              </Chip>
              <Chip tone="neutral" title="Annual mean outdoor temperature">
                {temp(climateData.summary.avgTemperature)}
              </Chip>
            </>
          ) : null}

          {metrics && baselineMetrics ? (
            <>
              <Chip
                tone={score >= baselineScore ? 'good' : 'bad'}
                title={`Design score ${score}/100 against a conventional build at ${baselineScore}/100`}
              >
                score {score} vs {baselineScore}
              </Chip>
              {energyChange !== null ? (
                <Chip
                  tone={energyChange <= 0 ? 'good' : 'bad'}
                  title="Annual delivered energy against conventional local construction"
                >
                  energy {energyChange <= 0 ? '−' : '+'}
                  {Math.abs(energyChange).toFixed(0)}%
                </Chip>
              ) : null}
            </>
          ) : null}

          {durationMs > 0 ? (
            <span className="text-[11.5px] tabular-nums text-muted-foreground/60">
              {Math.round(durationMs)} ms
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-muted-foreground/70">
            <Building2 size={12} aria-hidden />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em]">
              Scenarios
            </span>
          </span>
          {DEMO_CITIES.map((id) => {
            const station = STATION_BY_ID.get(id);
            if (!station) return null;
            const selected = location?.id === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLocation(station.location)}
                title={`${station.location.city} — ${station.climateType}`}
                className={cn('tab', selected ? 'tab-active' : 'tab-idle')}
              >
                {station.location.city}
                <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
                  {temp(station.monthly[4]?.avgTemp ?? 0, 0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- Error ---------------- */}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-t px-6 py-3"
          style={{
            background: 'hsl(var(--destructive) / 0.12)',
            borderColor: 'hsl(var(--destructive) / 0.4)',
          }}
        >
          <AlertTriangle
            size={15}
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
