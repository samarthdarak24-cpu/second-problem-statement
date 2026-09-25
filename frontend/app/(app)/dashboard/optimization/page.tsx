'use client';

/**
 * Optimisation — what the search changed, and what it bought.
 *
 * The before/after comparison is the headline: the same programme, built
 * conventionally and built to the optimiser's answer, measured on the same
 * engine. The recommendation panel below explains each individual decision, so
 * the page answers "was it worth it" before "why".
 */

import { ComparisonPanel } from '@/components/dashboard/ComparisonPanel';
import { RecommendationPanel } from '@/components/dashboard/RecommendationPanel';

export default function OptimizationPage() {
  return (
    <div className="space-y-6">
      <div className="h-[620px]">
        <ComparisonPanel />
      </div>
      <div className="h-[640px]">
        <RecommendationPanel />
      </div>
    </div>
  );
}
