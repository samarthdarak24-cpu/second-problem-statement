'use client';

/**
 * Site & Climate — what the site asks of a building.
 *
 * The climate is the input everything else is a response to, so this page is
 * deliberately upstream of the design: it reports the site's own numbers and
 * the analysis engine's reading of them, with no building in the picture yet.
 *
 * LAYOUT (redesign)
 * A large location search across the top, then the four pastel summary cards —
 * annual mean, rainfall, wind, solar — because those are the four facts that
 * decide what a building has to do here. The engine's own interpretation, the
 * monthly charts and the full climatology panel follow.
 *
 * REUSE
 * The search runs through `searchPlaces` / `placeToLocation` and the station
 * list through `CLIMATE_STATIONS`, both of which the header already uses. The
 * geocoder, its offline fallbacks and the provenance labels are therefore the
 * same ones everywhere — this page is a second *view* of the site, not a
 * second implementation of it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CloudRain,
  Droplets,
  Loader2,
  MapPin,
  Search,
  Sun,
  Wind,
} from 'lucide-react';
import { ClimateSummaryPanel } from '@/components/dashboard/ClimateSummaryPanel';
import { FingerprintPanel } from '@/components/dashboard/FingerprintPanel';
import { ChartsPanel } from '@/components/dashboard/ChartsPanel';
import { MetricCard, SectionHeader, StatusBadge } from '@/components/ui/soft';
import { Segmented } from '@/components/ui/primitives';
import { useDesignStore } from '@/store/designStore';
import { searchPlaces, placeToLocation, type GeoPlace } from '@/climate/providers/geocoding';
import { CLIMATE_STATIONS, STATION_BY_ID } from '@/climate/stations';
import { CHALLENGE_LABEL, ZONE_LABEL, ZONE_NOTE } from '@/lib/labels';
import { compass, humidityLabel, num, pct } from '@/utils/format';

/* ------------------------------------------------------------------ */
/* Location search                                                     */
/* ------------------------------------------------------------------ */

/** The station list is long; the chips show a shortlist, not all of it. */
const QUICK_STATION_IDS = [
  'in-pune',
  'in-jodhpur',
  'in-leh',
  'in-chennai',
  'in-delhi',
  'in-shillong',
];

function LocationSearch() {
  const setLocation = useDesignStore((state) => state.setLocation);
  const climateData = useDesignStore((state) => state.climateData);
  const location = useDesignStore((state) => state.location);
  const isGenerating = useDesignStore((state) => state.isGenerating);
  const openMeteoApiKey = useDesignStore((state) => state.openMeteoApiKey);

  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  /* Debounced geocoding through the shared provider, which owns the API key
     handling and the offline behaviour. The request counter guards against a
     slow response for an old query overwriting a fast response for a new one. */
  const counter = useRef(0);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPlaces([]);
      setSearching(false);
      return;
    }
    const requestId = counter.current + 1;
    counter.current = requestId;
    const controller = new AbortController();
    setSearching(true);
    const handle = setTimeout(() => {
      searchPlaces(term, { apiKey: openMeteoApiKey, signal: controller.signal })
        .then((found) => {
          if (counter.current !== requestId) return;
          setPlaces(found);
          setShowResults(true);
        })
        .catch(() => {
          if (counter.current === requestId) setPlaces([]);
        })
        .finally(() => {
          if (counter.current === requestId) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, openMeteoApiKey]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectPlace = (place: GeoPlace): void => {
    setLocation(placeToLocation(place));
    setQuery('');
    setPlaces([]);
    setShowResults(false);
  };

  const quickStations = QUICK_STATION_IDS.map((id) => STATION_BY_ID.get(id)).filter(
    (station): station is NonNullable<typeof station> => Boolean(station),
  );

  return (
    <div className="soft-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="section-eyebrow">Site</p>
          <h2 className="section-title-soft mt-1">
            {location ? location.city : 'Choose a location'}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {climateData
              ? `${climateData.climateType} · ${ZONE_LABEL[climateData.climateZone]}`
              : 'Search any place on earth, or pick one of the built-in climatology stations.'}
          </p>
        </div>
        {climateData ? (
          <StatusBadge
            tone="ready"
            label={`${climateData.location.latitude.toFixed(2)}°N, ${climateData.location.longitude.toFixed(2)}°E`}
          />
        ) : null}
      </div>

      {/* ---- Search ---- */}
      <div ref={boxRef} className="relative mt-5">
        <Search
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/55"
          aria-hidden
        />
        <input
          type="text"
          className="field h-12 rounded-2xl pl-12 text-[14.5px]"
          placeholder="Search a city, town or district — e.g. Jodhpur"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => places.length > 0 && setShowResults(true)}
          aria-label="Search for a location"
          disabled={isGenerating}
        />
        {searching ? (
          <Loader2
            size={16}
            className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground/60"
            aria-hidden
          />
        ) : null}

        {showResults && places.length > 0 ? (
          <ul
            className="soft-card absolute left-0 right-0 top-[56px] z-40 max-h-80 overflow-auto p-1.5"
            role="listbox"
          >
            {places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                  onClick={() => selectPlace(place)}
                >
                  <MapPin size={14} className="shrink-0 text-muted-foreground/55" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-foreground">
                      {place.name}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[place.admin1, place.country].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground/70">
                    {Math.round(place.elevation)} m
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ---- Built-in climatology ---- */}
      <div className="mt-5">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Built-in climatology · {CLIMATE_STATIONS.length} stations
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {quickStations.map((station) => {
            const active = location?.id === station.location.id;
            return (
              <button
                key={station.location.id}
                type="button"
                disabled={isGenerating}
                onClick={() => setLocation(station.location)}
                className="pill"
                style={
                  active
                    ? {
                        background: 'hsl(var(--pastel-blue))',
                        borderColor: 'hsl(218 100% 86%)',
                        color: 'hsl(var(--pastel-blue-fg))',
                      }
                    : undefined
                }
                aria-pressed={active}
              >
                {station.location.city}
                <span className="text-[11px] opacity-60">{station.location.state}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ClimatePage() {
  const climateData = useDesignStore((state) => state.climateData);
  const analysis = useDesignStore((state) => state.climateAnalysis);

  /* Two readings of the same site: the raw climate, and what it asks of a
     shelter. The fingerprint is not a separate destination — it is the second
     way of looking at this page's data, so it lives here as a tab. */
  const [tab, setTab] = useState<'climate' | 'fingerprint'>('climate');

  /* Honour `?tab=fingerprint` on arrival, which is where the old standalone
     fingerprint route redirects to. Read from `window.location` rather than
     `useSearchParams` so the page needs no Suspense boundary under the static
     export — it runs once, on mount. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('tab') === 'fingerprint') {
      setTab('fingerprint');
    }
  }, []);

  /* The warmest and driest months, computed from the twelve monthly rows the
     panel below already shows — so nothing here can disagree with it. */
  const extremes = useMemo(() => {
    if (!climateData) return null;
    const months = climateData.monthly;
    return {
      warmest: months.reduce((best, month) => (month.avgTemp > best.avgTemp ? month : best), months[0]),
      driest: months.reduce((best, month) => (month.rainfall < best.rainfall ? month : best), months[0]),
    };
  }, [climateData]);

  return (
    <div className="page-pad page-gap">
      <SectionHeader
        eyebrow="Site & climate"
        title="What this location asks of a building"
        description="The climate is the input everything else responds to. These are the site's own numbers, before any building is involved."
        right={
          <Link href="/dashboard/design" className="btn-secondary">
            Design for this site
            <ArrowRight size={13} aria-hidden />
          </Link>
        }
      />

      {/* ---------------- Location ---------------- */}
      <LocationSearch />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'climate', label: 'Climate', title: 'The site’s own monthly numbers' },
          {
            value: 'fingerprint',
            label: 'Climate Fingerprint',
            title: 'What this place asks of a shelter — eight severity indices',
          },
        ]}
      />

      {tab === 'fingerprint' ? (
        <FingerprintPanel />
      ) : climateData ? (
        <>
          {/* ---------------- The four facts that decide the brief ---------------- */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              tone="peach"
              label="Annual mean"
              icon={Sun}
              value={num(climateData.summary.avgTemperature, 1)}
              unit="°C"
              description={`Swinging from ${num(climateData.summary.minTemperature, 1)} °C to ${num(climateData.summary.maxTemperature, 1)} °C across the year.`}
              meta={
                extremes ? (
                  <p className="text-[12.5px] opacity-75">
                    Diurnal swing {num(climateData.summary.diurnalSwing, 1)} K — the case for
                    thermal mass
                  </p>
                ) : null
              }
            />

            <MetricCard
              tone="blue"
              label="Rainfall"
              icon={CloudRain}
              value={num(climateData.summary.rainfall, 0)}
              unit="mm/yr"
              description="Drives the roof strategy, and whether night ventilation alone can carry the cooling load."
              meta={
                extremes ? (
                  <p className="text-[12.5px] opacity-75">
                    Driest month · {num(extremes.driest.rainfall, 0)} mm
                  </p>
                ) : null
              }
            />

            <MetricCard
              tone="mint"
              label="Wind"
              icon={Wind}
              value={num(climateData.summary.windSpeed, 1)}
              unit="m/s"
              description={`Predominantly from ${compass(climateData.summary.windDirection)} — the direction a cross-ventilation opening should face.`}
              meta={
                <p className="text-[12.5px] opacity-75">
                  {num(climateData.summary.windDirection, 0)}° {compass(climateData.summary.windDirection)}{' '}
                  prevailing
                </p>
              }
            />

            <MetricCard
              tone="yellow"
              label="Solar"
              icon={Sun}
              value={num(climateData.summary.solarRadiation, 2)}
              unit="kWh/m²·d"
              description="Horizontal-plane irradiation. Where this is high, shading is worth more than added insulation."
              meta={
                <p className="text-[12.5px] opacity-75">
                  Humidity {pct(climateData.summary.humidity, 0)} ·{' '}
                  {humidityLabel(climateData.summary.humidity)}
                </p>
              }
            />
          </div>

          {/* ---------------- The engine's own reading ---------------- */}
          {analysis ? (
            <div className="soft-card p-6">
              <SectionHeader
                eyebrow="Interpretation"
                title="What the climate engine makes of it"
                description="The reading every downstream stage consumes — the dominant problem, and the strategy the optimiser starts from."
              />
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div>
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Dominant thermal problem
                  </p>
                  <p className="mt-2 font-display text-[20px] font-semibold leading-snug tracking-[-0.015em] text-foreground">
                    {CHALLENGE_LABEL[analysis.mainChallenge]}
                  </p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                    {analysis.challengeDetail}
                  </p>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground/75">
                    {ZONE_NOTE[analysis.zone]}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {(
                    [
                      ['Ventilation', `${analysis.ventilationStrategy} · ${num(analysis.ventilationAch, 1)} ACH`],
                      ['Insulation', `${analysis.insulationLevel} · ${num(analysis.insulationThickness * 1000, 0)} mm`],
                      ['Shading', analysis.shadingStrategy],
                      ['Glazing', analysis.glazingStrategy],
                      ['Window ratio', pct(analysis.windowRatioRecommendation * 100)],
                      [
                        'Orientation',
                        `${Math.round(analysis.orientationRecommendation)}° ${compass(analysis.orientationRecommendation)}`,
                      ],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-1 truncate text-[13.5px] font-medium capitalize text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <p className="mt-6 border-t pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
                Ventilation here is a <b className="text-foreground/85">capacity</b>, not a constant
                rate. The thermal model only applies the part above infiltration when the outside
                air is genuinely cooler than the space, so a high figure in a cold climate is not a
                winter heat loss.
              </p>
            </div>
          ) : null}

          {/* ---------------- Monthly charts ---------------- */}
          <div className="space-y-4">
            <SectionHeader
              eyebrow="Monthly detail"
              title="Temperature, energy and the heat balance"
              description="Three views onto the same twelve months. The temperature tab needs only the site; energy and balance appear once a design exists."
            />
            <div className="h-[620px]">
              <ChartsPanel />
            </div>
          </div>

          {/* ---------------- Full climatology ---------------- */}
          <div className="space-y-4">
            <SectionHeader
              eyebrow="Climatology"
              title="Summary, design conditions and provenance"
              description="Where these numbers came from matters as much as what they are — the panel names its own source."
            />
            <div className="h-[640px]">
              <ClimateSummaryPanel />
            </div>
          </div>
        </>
      ) : (
        <div className="soft-card flex min-h-[300px] flex-col items-center justify-center gap-2.5 px-6 py-14 text-center">
          <Droplets size={24} className="text-muted-foreground/45" aria-hidden />
          <p className="text-[14.5px] font-medium text-muted-foreground">No climate resolved yet</p>
          <p className="max-w-[440px] text-[12.5px] leading-relaxed text-muted-foreground/70">
            Search for a location above, or press <b>Generate design</b> in the header to analyse the
            currently selected site.
          </p>
        </div>
      )}
    </div>
  );
}
