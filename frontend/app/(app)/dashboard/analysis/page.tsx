'use client';

/**
 * Thermal Analysis — comfort, energy and cost.
 *
 * The results panel is the same component the Design Studio uses, at full width
 * here so the tabbed breakdown (comfort, energy, cost, and how the answer was
 * found) has room to breathe. Charts sit below it because the monthly series is
 * a *supporting* view: the headline is the annual figure, and the twelve bars
 * explain it.
 */

import { ResultsPanel } from '@/components/dashboard/ResultsPanel';
import { ChartsPanel } from '@/components/dashboard/ChartsPanel';

export default function AnalysisPage() {
  return (
    <div className="space-y-6">
      <div className="h-[620px]">
        <ResultsPanel />
      </div>
      <div className="h-[620px]">
        <ChartsPanel />
      </div>
    </div>
  );
}
