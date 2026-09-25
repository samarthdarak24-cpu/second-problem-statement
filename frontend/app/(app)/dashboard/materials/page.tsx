'use client';

/**
 * Materials — the envelope library.
 *
 * Every entry carries the properties the thermal model actually consumes
 * (conductivity, density, specific heat, solar absorptance, emissivity), not a
 * decorative subset. The resolved assembly at the top is what the current design
 * is really built from, which is the fastest way to answer "why is the U-value
 * that number".
 */

import { MaterialPanel } from '@/components/dashboard/MaterialPanel';

export default function MaterialsPage() {
  return (
    <div className="h-[860px]">
      <MaterialPanel />
    </div>
  );
}
