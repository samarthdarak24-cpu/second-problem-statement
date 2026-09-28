'use client';

/**
 * Climate Fingerprint panel.
 *
 * WHY THIS IS A PANEL RATHER THAN A PAGE
 * The fingerprint is not a step in the workflow — it is a reading of the site,
 * and it belongs with the rest of the site information rather than as a
 * destination of its own. It lives here so the Site & Climate page can show it
 * as a tab, while the standalone route redirects to that tab so an old link
 * still lands somewhere sensible.
 *
 * The panel reads the resolved `ClimateData` and never re-derives the Köppen
 * zone, so there is one classification in the system rather than two that can
 * disagree. The primary and secondary challenges it names are the same
 * vocabulary the climate analysis uses, which is what lets the recommended
 * design follow from them.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight, Compass, Gauge, Mountain, ThermometerSun, Wind } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { computeClimateFingerprint, type FingerprintSeverity } from '@/climate/fingerprint';
import { CHALLENGE_LABEL, ZONE_LABEL } from '@/lib/labels';
import { BarRow, MetricCard, StatusBadge } from '@/components/ui/soft';
import { Chip, EmptyState, Panel } from '@/components/ui/primitives';
import { num, pct } from '@/utils/format';
import type { PastelTone } from '@/components/ui/soft';

const SEVERITY_TONE: Record<FingerprintSeverity, PastelTone> = {
  low: 'mint',
  moderate: 'yellow',
  high: 'peach',
  extreme: 'pink',
};

const SEVERITY_COLOUR: Record<FingerprintSeverity, string> = {
  low: 'hsl(158 46% 34%)',
  moderate: 'hsl(38 78% 40%)',
  high: 'hsl(18 68% 44%)',
  extreme: 'hsl(0 62% 44%)',
};

/** Chip tones are a narrower set than the pastel tones — mapped explicitly. */
const SEVERITY_CHIP = {
  low: 'good',
  moderate: 'warn',
  high: 'accent',
  extreme: 'bad',
} as const;

export function FingerprintPanel() {
  const climateData = useDesignStore((state) => state.climateData);

  const fingerprint = useMemo(
    () => (climateData ? computeClimateFingerprint(climateData) : null),
    [climateData],
  );

  if (!climateData || !fingerprint) {
    return (
      <div className="soft-card flex min-h-[220px] items-center justify-center px-6 py-10">
        <EmptyState
          message="No climate resolved yet"
          hint="Pick a site on this page, and the fingerprint will appear here."
        />
      </div>
    );
  }

  const ranked = [...fingerprint.indices].sort((a, b) => b.value - a.value);
  const top = ranked[0];
  const maxIndex = Math.max(...fingerprint.indices.map((index) => index.value), 1e-6);

  return (
    <div className="space-y-4">
      {/* ---------------- Identity ---------------- */}
      <div className="soft-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="section-eyebrow">Site</p>
            <h2 className="section-title-soft mt-1">{fingerprint.location}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {fingerprint.climateType} · {ZONE_LABEL[fingerprint.zone]} ·{' '}
              {Math.round(fingerprint.elevation)} m
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="ready" label={ZONE_LABEL[fingerprint.zone]} />
            <Chip tone="accent" title="Dominant thermal problem">
              Primary · {CHALLENGE_LABEL[fingerprint.primary]}
            </Chip>
            {fingerprint.secondary !== fingerprint.primary ? (
              <Chip tone="neutral" title="Next-most-important problem">
                Secondary · {CHALLENGE_LABEL[fingerprint.secondary]}
              </Chip>
            ) : null}
          </div>
        </div>
        <p className="mt-4 max-w-[900px] text-[13.5px] leading-relaxed text-muted-foreground">
          {fingerprint.summary}
        </p>
      </div>

      {/* ---------------- The eight indices ---------------- */}
      <Panel
        title="Severity profile"
        subtitle="Each index runs 0 – 100 %. A high value means this direction is a real design driver here."
        accent="analysis"
        right={
          <Chip tone={SEVERITY_CHIP[top.severity]} title="The strongest signal at this site">
            {top.label} · {top.severity}
          </Chip>
        }
      >
        <div className="space-y-3.5">
          {fingerprint.indices.map((index) => (
            <BarRow
              key={index.key}
              label={index.label}
              value={`${pct(index.value * 100, 0)}`}
              share={index.value / maxIndex}
              tone={SEVERITY_TONE[index.severity]}
            />
          ))}
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
          Severity bands: low &lt; 25 %, moderate 25–50 %, high 50–75 %, extreme ≥ 75 %. The
          underlying ranges are stated on each index — for example winter severity runs from a
          15 °C coldest-month minimum (0 %) to −20 °C (100 %).
        </p>
      </Panel>

      {/* ---------------- Index detail ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {fingerprint.indices.slice(0, 8).map((index) => {
          const Icon =
            index.key === 'winter' || index.key === 'summer'
              ? ThermometerSun
              : index.key === 'solar'
                ? Gauge
                : index.key === 'wind'
                  ? Wind
                  : index.key === 'altitude'
                    ? Mountain
                    : Compass;
          return (
            <MetricCard
              key={index.key}
              tone={SEVERITY_TONE[index.severity]}
              label={index.label}
              icon={Icon}
              value={num(index.raw, index.unit === '%' ? 0 : 1)}
              unit={index.unit}
              description={index.detail}
              right={
                <span
                  className="rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums"
                  style={{ color: SEVERITY_COLOUR[index.severity] }}
                >
                  {pct(index.value * 100, 0)}
                </span>
              }
            />
          );
        })}
      </div>

      {/* ---------------- What the design must do ---------------- */}
      <Panel
        title="What the design must do about it"
        subtitle={`Derived from the primary challenge (${CHALLENGE_LABEL[fingerprint.primary]})${
          fingerprint.secondary !== fingerprint.primary
            ? ` and the secondary (${CHALLENGE_LABEL[fingerprint.secondary]})`
            : ''
        }`}
        accent="optimize"
      >
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {fingerprint.requiredDesign.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-lg border bg-card/40 px-3.5 py-3"
            >
              <span
                aria-hidden
                className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: 'hsl(var(--primary))' }}
              />
              <span className="text-[13px] leading-snug text-foreground/85">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          These are the design <b className="text-foreground/85">requirements</b> the climate
          implies, not the final specification. The optimiser starts from them and the physics
          engine decides what is actually worth building — see{' '}
          <Link href="/dashboard/optimization" className="font-medium text-primary hover:underline">
            Optimisation
          </Link>
          , or open the{' '}
          <Link href="/dashboard/brief" className="font-medium text-primary hover:underline">
            Design Brief
          </Link>{' '}
          to apply them as a seed.
        </p>
      </Panel>

      {/* ---------------- Honesty ---------------- */}
      <div className="soft-card px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="text-foreground/85">Model estimate.</b> The fingerprint is derived from the
          site&rsquo;s climatological normals — monthly means, not hourly records — and the severity
          ranges are documented approximations, not published indices. It is a design aid for
          comparing sites, not a substitute for a site survey.
        </p>
      </div>

      <div className="flex justify-end">
        <Link href="/dashboard/design" className="btn-secondary">
          Design for this site
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export default FingerprintPanel;
