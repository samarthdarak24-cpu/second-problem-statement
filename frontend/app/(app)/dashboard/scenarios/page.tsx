'use client';

/**
 * Climate Response Lab — the page that demonstrates area-specific design.
 *
 * It exists to answer the one question a single optimised building cannot: does
 * the design actually change when the climate or the building type changes? The
 * sweep runs the real pipeline five times along one axis and draws every result
 * from the geometry its own numbers were computed from.
 */

import { ScenarioLab } from '@/components/dashboard/ScenarioLab';

export default function ScenariosPage() {
  return <ScenarioLab />;
}
