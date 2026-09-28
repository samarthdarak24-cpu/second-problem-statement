'use client';

/**
 * Materials — the envelope library.
 *
 * Every entry carries the properties the thermal model actually consumes
 * (conductivity, density, specific heat, solar absorptance, emissivity), not a
 * decorative subset. The resolved assembly at the top is what the current design
 * is really built from, which is the fastest way to answer "why is the U-value
 * that number".
 *
 * The catalogue below doubles as the material picker in manual mode — the same
 * `MaterialPanel`, writing through the same `updateSelect`.
 */

import Link from 'next/link';
import { ArrowRight, Palette } from 'lucide-react';
import { MaterialPanel } from '@/components/dashboard/MaterialPanel';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';

export default function MaterialsPage() {
  const mode = useDesignStore((state) => state.mode);
  const materials = useDesignStore((state) => state.materials);

  return (
    <div className="page-pad page-gap">
      <SectionHeader
        eyebrow="Reference · materials"
        title="What the building is actually made of"
        description="The resolved assembly the thermal model used — not the nominal figure from a brochure. The gap between the two is the whole point of an insulation layer."
        right={
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={materials ? 'ready' : 'idle'}
              label={
                mode === 'manual'
                  ? 'Editable — manual mode'
                  : materials
                    ? 'Optimiser-chosen'
                    : 'No design'
              }
            />
            <Link href="/dashboard/design" className="btn-secondary">
              Design Studio
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        }
      />

      {/* ---------------- How to read this ---------------- */}
      <div className="soft-card flex flex-wrap items-start gap-x-8 gap-y-4 px-6 py-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'hsl(var(--pastel-yellow))', color: 'hsl(38 60% 26%)' }}
        >
          <Palette size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-foreground">
            U-value, not R-value marketing
          </p>
          <p className="mt-1 max-w-[860px] text-[13px] leading-relaxed text-muted-foreground">
            A 230 mm brick wall is {''}
            <b className="text-foreground/85">1.20 W/m²·K</b> on its own and{' '}
            <b className="text-foreground/85">0.28 W/m²·K</b> with 100 mm of XPS on it. A user who
            cannot see that difference cannot make a decision — so every assembly here is shown as
            the model resolved it, thicknesses and layers included.
            {mode === 'manual'
              ? ' In manual mode you can swap any wall, roof or glazing directly from the catalogue below.'
              : ' Switch to manual mode to swap wall, roof and glazing directly from the catalogue.'}
          </p>
        </div>
      </div>

      <div className="h-[880px]">
        <MaterialPanel />
      </div>
    </div>
  );
}
