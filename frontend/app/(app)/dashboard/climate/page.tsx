'use client';

/**
 * Climate — what the site asks of a building.
 *
 * The climate is the input everything else is a response to, so this page is
 * deliberately upstream of the design: it reports the site's own numbers and the
 * analysis engine's reading of them, with no building in the picture yet.
 */

import { ClimateSummaryPanel } from '@/components/dashboard/ClimateSummaryPanel';
import { ChartsPanel } from '@/components/dashboard/ChartsPanel';

export default function ClimatePage() {
  return (
    <div className="space-y-6">
      <div className="h-[560px]">
        <ClimateSummaryPanel />
      </div>
      <div className="h-[560px]">
        <ChartsPanel />
      </div>
    </div>
  );
}
