'use client';

/**
 * Design Studio — the working page.
 *
 * Layout follows the redesign brief: a 35 / 65 split. The programme and the
 * parameter controls sit on the left at a comfortable reading width, the 3D
 * model takes the larger pane on the right where the form is actually legible.
 * The old third column is gone — the results it carried are already the
 * subject of Thermal Analysis, and duplicating them here made the page read as
 * a control panel rather than a workspace.
 *
 * WHAT DOES NOT CHANGE
 * The controls are the same components driving the same store actions. Moving
 * a slider in Manual mode still re-evaluates the thermal model on the spot,
 * because `ParameterPanel` writes through `updateNumeric` exactly as before.
 * The full-width band underneath is still the problem statement's own output.
 *
 * In expanded mode the parameter column slides out of the way so the model can
 * be inspected at full width — Esc restores it, as the tooltip promises.
 */

import { useState } from 'react';
import { LayoutPanelLeft, Ruler, Shield, ShieldCheck } from 'lucide-react';
import { ParameterPanel } from '@/components/dashboard/ParameterPanel';
import { ViewportPanel } from '@/components/dashboard/ViewportPanel';
import { ShelterResultPanel } from '@/components/dashboard/ShelterResultPanel';
import { VisualisationRecommendationsCard } from '@/components/dashboard/VisualisationRecommendationsCard';
import { DRDOResearchSolutionsCard } from '@/components/dashboard/DRDOResearchSolutionsCard';
import { SIHComplianceModal } from '@/components/dashboard/SIHComplianceModal';
import { SectionHeader, StatusBadge } from '@/components/ui/soft';
import { useDesignStore } from '@/store/designStore';
import { cn } from '@/lib/utils';

export default function DesignPage() {
  const viewportExpanded = useDesignStore((state) => state.viewportExpanded);
  const mode = useDesignStore((state) => state.mode);
  const isDirty = useDesignStore((state) => state.isDirty);
  const isGenerating = useDesignStore((state) => state.isGenerating);

  const [showControls, setShowControls] = useState(true);
  const [showComplianceModal, setShowComplianceModal] = useState(false);

  return (
    <div className="page-pad page-gap">
      {/* ---------------- Section identity ---------------- */}
      <SectionHeader
        eyebrow="Design"
        title="Design Studio"
        description={
          mode === 'auto'
            ? 'Pick the site and the programme. The optimiser resolves the envelope, and every change you make to the brief re-searches it.'
            : 'You own the envelope. Each slider re-runs the thermal model immediately, which is what makes the cost of a decision something you can feel rather than read.'
        }
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowComplianceModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[12px] font-bold text-red-600 transition hover:bg-red-500/20 dark:text-red-400 shadow-sm"
              title="Official DRDO Problem Statement SIH26051 & Technical Compliance Audit"
            >
              <Shield size={13} />
              <span>SIH26051 PS Audit</span>
            </button>
            <StatusBadge
              tone={isGenerating ? 'generating' : isDirty ? 'updated' : 'ready'}
              label={
                isGenerating
                  ? 'Generating'
                  : isDirty
                    ? 'Modified'
                    : mode === 'auto'
                      ? 'Optimised'
                      : 'Manual'
              }
            />
            {!viewportExpanded ? (
              <button
                type="button"
                onClick={() => setShowControls((value) => !value)}
                className="btn-secondary"
                aria-pressed={showControls}
                title={
                  showControls
                    ? 'Focus on the model — hide the parameter column'
                    : 'Show the parameter column'
                }
              >
                <LayoutPanelLeft size={13} aria-hidden />
                {showControls ? 'Hide controls' : 'Show controls'}
              </button>
            ) : null}
          </div>
        }
      />

      {/* ---------------- Parameters (left) + model (right) ---------------- */}
      <div
        className={cn(
          'grid gap-5',
          viewportExpanded || !showControls
            ? 'xl:grid-cols-1'
            : 'xl:grid-cols-[minmax(320px,35fr)_minmax(0,65fr)]',
        )}
      >
        {viewportExpanded || !showControls ? null : (
          <div className="flex min-h-0 min-w-0 flex-col xl:h-[760px]">
            <ParameterPanel />
          </div>
        )}
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-col',
            viewportExpanded ? 'xl:h-[860px]' : 'xl:h-[760px]',
          )}
        >
          <ViewportPanel />
        </div>
      </div>

      {/* ---------------- 3 Mandatory SIH Outputs — THE HERO ---------------- */}
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Mandatory SIH26051 Outputs"
          title="Core Simulation Results (Representative Day)"
          description="The three quantities explicitly mandated by DRDO in the problem statement: [1] Indoor Temperature vs Time, [2] Solar Thermal Energy vs Time, and [3] Heat Flow & Component Loss Breakdown."
        />
        <ShelterResultPanel />
      </div>

      {/* ---------------- 3D/2D Visualisation & Optimisation Recommendations ---------------- */}
      <VisualisationRecommendationsCard />

      {/* ---------------- High-Altitude Passive Solutions & Scenarios ---------------- */}
      <DRDOResearchSolutionsCard />

      {/* ---------------- Navigation & Next Steps in Workflow ---------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex items-center justify-between">
          <div>
            <h4 className="text-[13.5px] font-bold text-foreground">Step 4: Design Comparison</h4>
            <p className="text-[12px] text-muted-foreground">Compare Material A vs B, Insulation thickness, and Orientation side-by-side.</p>
          </div>
          <a href="/dashboard/scenarios" className="btn-secondary text-[12px] shrink-0">
            Compare Designs →
          </a>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex items-center justify-between">
          <div>
            <h4 className="text-[13.5px] font-bold text-foreground">Step 6: Comprehensive Engineering Report</h4>
            <p className="text-[12px] text-muted-foreground">Export PDF dossier with climate, parameters, 3D model, solar curves & BOM.</p>
          </div>
          <a href="/dashboard/brief" className="btn-secondary text-[12px] shrink-0">
            View Report →
          </a>
        </div>
      </div>

      {/* ---------------- Honesty strip ---------------- */}
      <div className="soft-card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <ShieldCheck size={14} className="text-muted-foreground" aria-hidden />
          Model estimate — not a measured building result.
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Ruler size={13} aria-hidden />
          Every figure comes from the same monthly heat balance the charts and the 3D model use.
        </span>
      </div>

      {/* ---------------- Official DRDO SIH26051 Compliance & Physics Audit Modal ---------------- */}
      <SIHComplianceModal
        isOpen={showComplianceModal}
        onClose={() => setShowComplianceModal(false)}
      />
    </div>
  );
}
