'use client';

/**
 * Design Studio — the working page.
 *
 * Three columns, left to right, in the order the pipeline runs: the programme
 * you set, the model that results, the numbers it produces. In Manual mode the
 * left column is live: moving a slider re-evaluates the thermal model on the
 * spot, which is what makes the connection between a parameter and a result
 * something you can feel rather than read.
 *
 * The full-width band underneath is the problem statement's own output —
 * indoor temperature, solar gain and heat flow for a representative day — kept
 * out of the third column so the 24-hour curve has the room to be read. It is
 * driven by the same `currentThermal` the columns are, so a slider moved in
 * manual mode moves the curve.
 *
 * The viewport column honours the viewport's expand toggle: in expanded mode
 * the parameter and results columns slide out of the way so the 3D model can
 * be inspected at full width.
 */

import { ParameterPanel } from '@/components/dashboard/ParameterPanel';
import { ViewportPanel } from '@/components/dashboard/ViewportPanel';
import { ResultsPanel } from '@/components/dashboard/ResultsPanel';
import { ShelterResultPanel } from '@/components/dashboard/ShelterResultPanel';
import { useDesignStore } from '@/store/designStore';
import { cn } from '@/lib/utils';

export default function DesignPage() {
  const viewportExpanded = useDesignStore((state) => state.viewportExpanded);
  return (
    <div className="space-y-6">
      <div
        className={cn(
          'grid gap-6',
          viewportExpanded
            ? 'xl:grid-cols-1'
            : 'xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)_minmax(360px,420px)]',
        )}
      >
        {viewportExpanded ? null : (
          <div className="flex min-h-0 flex-col xl:h-[720px]">
            <ParameterPanel />
          </div>
        )}
        <div
          className={cn(
            'flex min-h-0 flex-col',
            viewportExpanded ? 'xl:h-[820px]' : 'xl:h-[720px]',
          )}
        >
          <ViewportPanel />
        </div>
        {viewportExpanded ? null : (
          <div className="flex min-h-0 flex-col xl:h-[720px]">
            <ResultsPanel />
          </div>
        )}
      </div>

      <ShelterResultPanel />
    </div>
  );
}
