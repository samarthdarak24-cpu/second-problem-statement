'use client';

/**
 * Settings — backend, live data, API key, generation priority.
 *
 * All the controls that used to live in the global header have been
 * moved here, plus the optimisation priority slider that used to sit
 * in the second header row. None of them belong in the chrome.
 *
 * The values flow through the existing store actions, so nothing
 * about the model has changed — only where the controls live.
 */

import { useState } from 'react';
import {
  Cloud,
  Database,
  KeyRound,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import {
  ExpandableSection,
  PageHeader,
  PastelCard,
  SectionHeader,
} from '@/components/ui/soft';
import { Chip } from '@/components/ui/primitives';
import { pct } from '@/utils/format';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const useBackend = useDesignStore((s) => s.useBackend);
  const setUseBackend = useDesignStore((s) => s.setUseBackend);
  const backendConfigured = useDesignStore((s) => s.backendConfigured);
  const preferLive = useDesignStore((s) => s.preferLive);
  const setPreferLive = useDesignStore((s) => s.setPreferLive);
  const openMeteoApiKey = useDesignStore((s) => s.openMeteoApiKey);
  const setOpenMeteoApiKey = useDesignStore((s) => s.setOpenMeteoApiKey);
  const priority = useDesignStore((s) => s.priority);
  const setPriority = useDesignStore((s) => s.setPriority);

  const [apiKeyDraft, setApiKeyDraft] = useState(openMeteoApiKey);

  return (
    <div className="page-pad page-gap">
      <PageHeader
        kicker="System"
        title="Settings"
        description="Backend, data sources, and the generation priority. Everything that used to live in the global header."
      />

      {/* ---------------- Backend routing ---------------- */}
      <SectionHeader
        eyebrow="Backend"
        title="Climate and screening source"
        description="Toggle the FastAPI service when it is reachable; fall back to the local provider chain otherwise."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PastelCard
          tone="lavender"
          eyebrow="Service routing"
          icon={Server}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug">
                {backendConfigured ? 'FastAPI backend' : 'Browser-only mode'}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-snug opacity-75">
                {backendConfigured
                  ? useBackend
                    ? 'Climate and screening go through the FastAPI service when it answers, locally otherwise.'
                    : 'Everything runs in the browser. Click to try the FastAPI service first.'
                  : 'No backend is configured for this deployment. All calculations run in the browser.'}
              </p>
            </div>
            <button
              type="button"
              disabled={!backendConfigured}
              onClick={() => setUseBackend(!useBackend)}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
                useBackend && backendConfigured
                  ? 'bg-foreground/85'
                  : 'bg-secondary',
              )}
              style={{
                borderColor: 'hsl(30 14% 88% / 0.7)',
              }}
              aria-pressed={useBackend}
              aria-label="Toggle FastAPI backend"
            >
              <span
                aria-hidden
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-panel shadow transition-transform',
                  useBackend && backendConfigured ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
          {!backendConfigured ? (
            <p className="mt-4 text-[11.5px] opacity-65">
              Set <code>NEXT_PUBLIC_API_URL</code> in your <code>.env.local</code> to
              enable the backend.
            </p>
          ) : null}
        </PastelCard>

        <PastelCard tone="blue" eyebrow="Live data" icon={Cloud}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug">
                {preferLive ? 'Live Open-Meteo reanalysis' : 'Pinned to bundled climatology'}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-snug opacity-75">
                {preferLive
                  ? 'The next Generate will try the live archive first, then fall back to the bundled database.'
                  : 'Results are reproducible and instant — every run uses the same bundled climatology.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreferLive(!preferLive)}
              className={cn(
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
                preferLive ? 'bg-foreground/85' : 'bg-secondary',
              )}
              style={{
                borderColor: 'hsl(30 14% 88% / 0.7)',
              }}
              aria-pressed={preferLive}
              aria-label="Toggle live climate data"
            >
              <span
                aria-hidden
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-panel shadow transition-transform',
                  preferLive ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
        </PastelCard>
      </div>

      <ExpandableSection
        title="Open-Meteo API key"
        description="Optional — lifts the live-lookup rate limit so many sites resolve without 429s."
        defaultOpen={openMeteoApiKey.length > 0}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-[12px] border bg-panel px-3 py-2"
            style={{ borderColor: 'hsl(30 14% 88% / 0.7)' }}
          >
            <KeyRound size={14} className="text-muted-foreground" aria-hidden />
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder="Open-Meteo key (optional)"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
              aria-label="Open-Meteo API key"
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setOpenMeteoApiKey(apiKeyDraft)}
          >
            Save key
          </button>
          {openMeteoApiKey ? (
            <Chip tone="accent">Saved</Chip>
          ) : (
            <Chip tone="neutral">Empty</Chip>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
          The key is stored in browser memory only. A free key works for global
          coverage; it is only rate-capped without one.
        </p>
      </ExpandableSection>

      {/* ---------------- Optimisation priority ---------------- */}
      <SectionHeader
        eyebrow="Optimization"
        title="Generation priority"
        description="How to trade cost against comfort when the optimizer runs in Auto mode."
      />

      <PastelCard tone="peach" eyebrow="Trade-off" icon={SlidersHorizontal}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground/85">Cost</p>
            <p className="mt-1 text-[12px] leading-snug opacity-75">
              Cheaper materials, smaller windows, less insulation.
            </p>
          </div>
          <input
            type="range"
            className="slider flex-1 min-w-[180px]"
            min={0}
            max={1}
            step={0.05}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            aria-label="Generation priority"
          />
          <div className="min-w-0 flex-1 text-right">
            <p className="text-[13px] font-medium text-foreground/85">Comfort</p>
            <p className="mt-1 text-[12px] leading-snug opacity-75">
              Better envelope, more shading, more insulation.
            </p>
          </div>
          <div className="ml-2 rounded-full bg-foreground/85 px-3 py-1.5 text-[12px] font-semibold tabular-nums text-background">
            {pct(priority * 100)} comfort
          </div>
        </div>
      </PastelCard>

      {/* ---------------- About ---------------- */}
      <SectionHeader eyebrow="About" title="Build information" />
      <div className="grid gap-4 lg:grid-cols-3">
        <PastelCard tone="gray" eyebrow="Version" icon={Database}>
          <p className="text-[14px] font-semibold">SIH PS-51</p>
          <p className="mt-1.5 text-[12.5px] leading-snug opacity-75">
            Smart India Hackathon · Problem Statement 51. Quasi-steady-state monthly
            heat-balance model.
          </p>
        </PastelCard>
        <PastelCard tone="gray" eyebrow="Engine" icon={Wifi}>
          <p className="text-[14px] font-semibold">Browser + FastAPI</p>
          <p className="mt-1.5 text-[12.5px] leading-snug opacity-75">
            Calculations run in the browser by default; the FastAPI service is used
            when configured.
          </p>
        </PastelCard>
        <PastelCard tone="gray" eyebrow="Honesty" icon={SettingsIcon}>
          <p className="text-[14px] font-semibold">Estimates, not measurements</p>
          <p className="mt-1.5 text-[12.5px] leading-snug opacity-75">
            Every figure is a model output. Validate with measured data before
            construction.
          </p>
        </PastelCard>
      </div>
    </div>
  );
}