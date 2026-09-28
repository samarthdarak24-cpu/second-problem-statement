'use client';

/**
 * A small, non-interactive render of one design.
 *
 * WHY THIS IS ITS OWN COMPONENT
 * The Before/After panel and the Scenario Lab both need the same thing: a
 * building drawn small enough to sit five-to-a-row, from the same geometry
 * builder and the same solar engine the numbers came from. When that lived
 * inside `ComparisonPanel` there was exactly one copy of it and it was fine;
 * the moment a second surface needs the same picture, a second copy would be a
 * second definition of what "the design" looks like. So there is one.
 *
 * WHAT IT COSTS
 * Each instance is a separate WebGL context. `frameloop="demand"` means the
 * context only draws when something actually changes, so a grid of these is
 * cheap once painted — but the count is still worth watching, which is why the
 * caller controls it and why the quality is pinned low here. A thumbnail is
 * 170 px tall; a 2048 shadow map on it is pure waste.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { BuildingParameters, ClimateData } from '@/types';
import { resolveMaterials } from '@/thermal/materials';
import { buildShelterGeometry } from '@/utils/shelterGeometry';
import { solarPosition } from '@/utils/solar';
import { MONTH_MID_DAY, dayOfYear } from '@/utils/units';
import { cn } from '@/lib/utils';
import type { RenderQuality } from './ShelterCanvas';

const ShelterCanvas = dynamic(() => import('./ShelterCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="text-[12px] text-muted-foreground">…</span>
    </div>
  ),
});

export interface ModelThumbnailProps {
  parameters: BuildingParameters;
  /** Null renders nothing — a design with no climate has no sun to place. */
  climate: ClimateData | null;
  /** Month 0–11 the sun is placed in. */
  month?: number;
  /**
   * Day of the month. Omit to use the month's representative mid-point, which
   * is what a side-by-side comparison wants: five cells judged on different
   * days would differ for a reason that has nothing to do with their design.
   */
  day?: number;
  /** Fractional hour 0–24 the sun is placed at. */
  hour?: number;
  quality?: RenderQuality;
  /**
   * Draw the full site — sky, ground, fog, scale figure. Off by default: five
   * skies side by side is noise, and what a comparison panel needs is the
   * building and nothing else.
   */
  showEnvironment?: boolean;
  className?: string;
}

export function ModelThumbnail({
  parameters,
  climate,
  month = 5,
  day,
  hour = 10,
  quality = 'low',
  showEnvironment = false,
  className,
}: ModelThumbnailProps) {
  /* The same two builders the thermal model uses, so a thumbnail can never show
     a building the numbers were not computed for. */
  const materials = useMemo(() => resolveMaterials(parameters), [parameters]);
  const geometry = useMemo(
    () => buildShelterGeometry(parameters, materials),
    [parameters, materials],
  );

  const sun = useMemo(() => {
    const latitude = climate?.location.latitude ?? 18.5;
    const doy = day === undefined ? (MONTH_MID_DAY[month] ?? 180) : dayOfYear(month, day);
    return solarPosition(latitude, doy, hour);
  }, [climate, month, day, hour]);

  if (!climate) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <span className="text-[12px] text-muted-foreground">No climate</span>
      </div>
    );
  }

  return (
    <ShelterCanvas
      geometry={geometry}
      materials={materials}
      climate={climate}
      mode="normal"
      month={month}
      hour={hour}
      sunAltitude={sun.altitude}
      sunAzimuth={sun.azimuth}
      airChangesPerHour={parameters.airChangesPerHour}
      showFurniture={false}
      showSunPath={false}
      showGrid={false}
      showEnvironment={showEnvironment}
      quality={quality}
      interactive={false}
      className={cn('!absolute inset-0 h-full w-full', className)}
    />
  );
}
