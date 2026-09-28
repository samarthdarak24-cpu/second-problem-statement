'use client';

/**
 * Climate Response — the page that demonstrates area-specific design.
 *
 * It exists to answer the one question a single optimised building cannot: does
 * the design actually change when the climate or the building type changes?
 *
 * The sweep, the five columns, the before/after variants and the honesty footer
 * all still come from `ScenarioLab`, unchanged. This wrapper adds the page
 * identity and the framing sentence, and gives the lab the breathing room the
 * showcase page deserves — it is the most visually demanding page in the
 * product and everything in it is computed by the real pipeline.
 */

import Link from 'next/link';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { ScenarioLab } from '@/components/dashboard/ScenarioLab';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';

export default function ScenariosPage() {
  const climateData = useDesignStore((state) => state.climateData);
  const isGenerating = useDesignStore((state) => state.isGenerating);

  return (
    <div className="page-pad page-gap">
      <SectionHeader
        eyebrow="Climate response"
        title="Does the design actually respond to the place?"
        description="One optimised building on one site cannot answer that — there is nothing to compare it against. So this page runs the real pipeline five times along whichever axis you pick and puts the buildings side by side."
        right={
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={isGenerating ? 'generating' : climateData ? 'ready' : 'idle'}
              label={isGenerating ? 'Running' : climateData ? 'Site resolved' : 'No site'}
            />
            <Link href="/dashboard/optimization" className="btn-secondary">
              Single-design view
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        }
      />

      {/* ---------------- What this page is ---------------- */}
      <div className="soft-card flex flex-wrap items-start gap-x-8 gap-y-4 px-6 py-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'hsl(var(--pastel-lavender))', color: 'hsl(var(--pastel-lavender-fg))' }}
        >
          <FlaskConical size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-foreground">
            Two axes, one engine
          </p>
          <p className="mt-1 max-w-[860px] text-[13px] leading-relaxed text-muted-foreground">
            <b className="text-foreground/85">Vary the building type</b> and the climate is held
            fixed — every difference between the columns is caused by the form.{' '}
            <b className="text-foreground/85">Vary the location</b> and the form and programme are
            held fixed — every difference is caused by the site. Both sweeps go through the same
            optimiser and the same physics the Design Studio uses; nothing on this page is computed
            a second way.
          </p>
        </div>
      </div>

      <ScenarioLab />
    </div>
  );
}
