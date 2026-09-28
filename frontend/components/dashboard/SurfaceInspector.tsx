'use client';

/**
 * Surface inspector — the digital twin's pick-and-read panel.
 *
 * Click a wall or the roof in the 3D model and this panel answers, for *that*
 * surface and no other: what is it built from, how much area does it carry, how
 * warm is it running, which way is heat crossing it, and is its inner face wet.
 *
 * It reads the same engines the maps and the brief page read, evaluated at the
 * same month and hour, so the panel can never disagree with the colour on the
 * model behind it. It adds no physics of its own.
 *
 * The build-up is shown as the assembly's real layer stack when the design uses
 * a composite assembly, and as the base material's properties when it does not.
 * The floor is listed but not clickable — it is ground-coupled and has no
 * build-up in this model, and pretending otherwise would be the kind of
 * invented detail this project avoids.
 */

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { assemblyById, assemblyThickness, assemblyArealMass } from '@/thermal/assemblies';
import { computeSurfaceTemperature } from '@/thermal/surfaceTemperature';
import { computeMoisture } from '@/thermal/moisture';
import { computeInterstitial } from '@/thermal/interstitial';
import { SURFACE_FILM } from '@/thermal/materials';
import { computeInternalLoads } from '@/lib/internalLoads';
import { isMissionProfileId, missionProfile } from '@/lib/missions';
import { MONTH_LABELS } from '@/utils/units';
import { clockTime, num, pct } from '@/utils/format';
import { Chip, MetricRow } from '@/components/ui/primitives';
import type { MaterialLayer, SurfaceSelection } from '@/types';

/** The surfaces the inspector can be pointed at, in click order. */
const SURFACE_ORDER: SurfaceSelection[] = ['front', 'right', 'back', 'left', 'roof', 'floor'];

export function SurfaceInspector() {
  const selected = useDesignStore((s) => s.selectedSurface);
  const setSelected = useDesignStore((s) => s.setSelectedSurface);
  const parameters = useDesignStore((s) => s.currentParameters);
  const materials = useDesignStore((s) => s.materials);
  const geometry = useDesignStore((s) => s.geometry);
  const climateData = useDesignStore((s) => s.climateData);
  const month = useDesignStore((s) => s.analysisMonth);
  const hour = useDesignStore((s) => s.hourOfDay);
  const thermal = useDesignStore((s) => s.currentThermal);

  const reading = useMemo(() => {
    if (!selected || !climateData || !materials || !geometry) return null;

    const indoorTemp =
      thermal?.dailyProfile.points[Math.round(hour) % 24]?.indoorTemp ??
      thermal?.indoorTemperature ??
      climateData.monthly[month]?.avgTemp ??
      climateData.summary.avgTemperature;

    const mission = isMissionProfileId(parameters.missionProfile)
      ? missionProfile(parameters.missionProfile)
      : null;
    const latentGainW = computeInternalLoads(
      parameters.numOccupants,
      mission?.activityMet ?? 1.2,
      parameters.internalLoads ?? [],
      geometry.floorArea,
    ).totalLatentW;

    const surfaceMap = computeSurfaceTemperature(
      climateData,
      geometry,
      materials,
      month,
      hour,
      indoorTemp,
    );
    const detail = surfaceMap.detail[selected];
    if (!detail) return null;

    const moisture = computeMoisture(climateData, geometry, materials, parameters, {
      month,
      hour,
      indoorTemp,
      latentGainW,
    });
    const condensation = moisture.surfaces.find((s) => s.key === selected) ?? null;

    return { detail, moisture, condensation };
  }, [selected, climateData, materials, geometry, parameters, month, hour, thermal]);

  /* The build-up: an assembly's layer stack when the design uses one, otherwise
     the base material's own figures. */
  const buildUp = useMemo(() => {
    if (!selected || !parameters) return null;
    const isRoof = selected === 'roof';
    const isFloor = selected === 'floor';
    if (isFloor) return null;

    const assemblyId = isRoof ? parameters.roofAssemblyId : parameters.wallAssemblyId;
    const assembly = assemblyId ? assemblyById(assemblyId) : undefined;
    if (assembly) {
      return {
        kind: 'assembly' as const,
        name: assembly.name,
        note: assembly.note,
        layers: assembly.layers,
        thickness: assemblyThickness(assembly),
        arealMass: assemblyArealMass(assembly),
      };
    }

    const material = isRoof ? materials?.roof : materials?.wall;
    if (!material) return null;
    const synthetic: MaterialLayer = {
      name: material.name,
      thickness: material.thickness,
      conductivity: material.thermalConductivity,
      density: material.density,
      specificHeat: material.specificHeat,
      /* Every catalogue entry declares a vapour resistance (a test asserts it),
         so this fallback only ever catches a material added without one. The
         value is a typical masonry/plaster figure, and the interstitial check
         reports the assumption rather than presenting it as data. */
      vapourResistivity: material.vapourResistivity ?? 10,
    };
    return {
      kind: 'material' as const,
      name: material.name,
      note: 'Single-layer construction — no composite assembly is set for this surface.',
      layers: [synthetic],
      thickness: material.thickness,
      arealMass: material.thickness * material.density,
    };
  }, [selected, parameters, materials]);

  /* Interstitial condensation through this surface's build-up.
     It needs the layer stack, so it runs off `buildUp` — and it takes the
     indoor moisture state from the *same* moisture balance the humidity map and
     the surface verdict use, so the three cannot describe different weather. */
  const interstitial = useMemo(() => {
    if (!buildUp || !reading || !climateData || !selected) return null;
    const monthly = climateData.monthly[month];
    const film = selected === 'roof' ? SURFACE_FILM.roof : SURFACE_FILM.wall;
    return computeInterstitial(buildUp.layers, {
      month,
      indoorTemp: reading.moisture.indoorTemp,
      indoorRh: reading.moisture.indoorRh,
      outdoorTemp: monthly?.avgTemp ?? climateData.summary.avgTemperature,
      outdoorRh: monthly?.humidity ?? climateData.summary.humidity,
      internalSurfaceResistance: film.internal,
      externalSurfaceResistance: film.external,
    });
  }, [buildUp, reading, climateData, selected, month]);

  if (!selected) {
    return (
      <div className="rounded-md border border-dashed bg-card/30 px-3.5 py-3">
        <p className="text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Click a wall or the roof</span> in the
          model to inspect that surface&rsquo;s build-up and its live thermal state.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SURFACE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className="chip border-border/60 text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(key)}
            >
              {SURFACE_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card/40">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {reading?.detail.label ?? SURFACE_LABEL[selected]}
          </span>
          {reading?.detail.tilt === 0 ? (
            <Chip tone="neutral">Roof</Chip>
          ) : reading?.detail.tilt === 180 ? (
            <Chip tone="neutral">Floor</Chip>
          ) : (
            <Chip tone="neutral">Facade</Chip>
          )}
          {reading?.condensation && reading.condensation.margin < 0 ? (
            <Chip tone="warn">Condensing</Chip>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-muted-foreground">
            {MONTH_LABELS[month]} · {clockTime(hour)}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close the surface inspector"
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid gap-4 px-3.5 py-3 lg:grid-cols-2">
        {/* ---------------- Live thermal state ---------------- */}
        <div>
          <p className="stat-label">Live state at this hour</p>
          {reading ? (
            <div className="mt-2 space-y-1.5">
              <MetricRow
                label="Surface temperature"
                value={`${num(reading.detail.surfaceTemp, 1)} °C`}
                tone="good"
              />
              <MetricRow label="Sol-air temperature" value={`${num(reading.detail.solAirTemp, 1)} °C`} />
              <MetricRow
                label="Heat flux"
                value={`${reading.detail.heatFlux >= 0 ? '+' : ''}${num(reading.detail.heatFlux, 1)} W/m²`}
                tone={reading.detail.heatFlux >= 0 ? 'warn' : undefined}
              />
              <MetricRow label="Incident irradiance" value={`${num(reading.detail.irradiance, 0)} W/m²`} />
              <MetricRow label="U-value" value={`${num(reading.detail.uValue, 2)} W/m²·K`} />
              <MetricRow label="Area" value={`${num(reading.detail.area, 1)} m²`} />
              {reading.condensation ? (
                <MetricRow
                  label="Margin to dew point"
                  value={`${reading.condensation.margin >= 0 ? '+' : ''}${num(reading.condensation.margin, 1)} K`}
                  tone={reading.condensation.margin < 0 ? 'warn' : undefined}
                />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              No climate loaded, so there is nothing to evaluate against.
            </p>
          )}
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground/70">
            Positive flux flows into the shelter. Surface temperature is a first-order estimate from
            a lumped U-value and a single film coefficient — it is not a multi-node conduction
            solve.
          </p>
        </div>

        {/* ---------------- Build-up ---------------- */}
        <div>
          <p className="stat-label">
            {buildUp?.kind === 'assembly' ? 'Assembly build-up · outside → inside' : 'Construction'}
          </p>
          {buildUp ? (
            <>
              <p className="mt-1.5 text-[12.5px] text-foreground/85">{buildUp.name}</p>
              <ul className="mt-2 space-y-1">
                {buildUp.layers.map((layer, index) => (
                  <li
                    key={`${layer.name}-${index}`}
                    className="flex items-baseline justify-between gap-3 rounded-md border bg-card/40 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="text-foreground/85">{layer.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {num(layer.thickness * 1000, 0)} mm · λ {num(layer.conductivity, 3)} ·{' '}
                      {num(layer.density, 0)} kg/m³
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 space-y-1.5">
                <MetricRow label="Total thickness" value={`${num(buildUp.thickness * 1000, 0)} mm`} />
                <MetricRow
                  label="Areal mass"
                  value={`${num(buildUp.arealMass, 1)} kg/m²`}
                />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground/70">
                {buildUp.note}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
              The floor is ground-coupled: this model treats it as a single conductance to the
              ground at the site&rsquo;s annual mean temperature, with no build-up of its own. It is
              reported in the legend and the brief, not painted onto the model.
            </p>
          )}
        </div>

        {/* ---------------- Interstitial condensation ---------------- */}
        {interstitial ? (
          <div>
            <p className="stat-label">Interstitial condensation · Glaser check</p>

            {!interstitial.applicable ? (
              <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
                {interstitial.reason}
              </p>
            ) : (
              <>
                <div className="mt-1.5 flex items-center gap-2">
                  <Chip
                    tone={
                      interstitial.risk === 'severe'
                        ? 'bad'
                        : interstitial.risk === 'moderate'
                          ? 'warn'
                          : 'good'
                    }
                  >
                    {interstitial.risk === 'none'
                      ? 'No condensation'
                      : `${interstitial.risk === 'severe' ? 'Severe' : 'Moderate'} condensation`}
                  </Chip>
                  {interstitial.condensing ? (
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      {num(interstitial.condensationGPerM2Day, 2)} g/m²·day
                    </span>
                  ) : null}
                </div>

                {/* The two profiles, plane by plane. The margin column is the
                    whole result: negative is safe, positive condenses. */}
                <ul className="mt-2 space-y-1">
                  {interstitial.planes.map((plane) => (
                    <li
                      key={plane.index}
                      className="rounded-md border bg-card/40 px-2.5 py-1.5 text-[11.5px]"
                      style={plane.condensing ? { borderColor: 'hsl(var(--danger))' } : undefined}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-foreground/85">{plane.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {num(plane.temperature, 1)} °C
                        </span>
                      </div>
                      <div className="mt-0.5 flex justify-between gap-3 text-muted-foreground/80">
                        <span className="tabular-nums">
                          sat {plane.saturationPa} Pa · vap {plane.vapourPa} Pa
                        </span>
                        <span
                          className="shrink-0 tabular-nums font-medium"
                          style={{ color: plane.condensing ? 'hsl(var(--danger))' : undefined }}
                        >
                          {plane.marginPa > 0 ? '+' : ''}
                          {plane.marginPa} Pa
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-2 space-y-1.5">
                  <MetricRow
                    label="Total vapour resistance"
                    value={`${num(interstitial.totalSd, 1)} m (Sd)`}
                  />
                  <MetricRow
                    label="Vapour-tight layer"
                    value={interstitial.vapourBarrierLayer ?? '—'}
                  />
                </div>

                {interstitial.barrierOnColdSide ? (
                  <p
                    className="mt-2 text-[11.5px] font-medium leading-snug"
                    style={{ color: 'hsl(var(--warning))' }}
                  >
                    ⚠ The vapour-tight layer sits on the cold side of the build-up, so any
                    condensate it traps cannot dry inward.
                  </p>
                ) : null}

                <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
                  {interstitial.summary}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground/70">
                  Steady-state Glaser check: a straight-line vapour profile against the saturation
                  curve, at {MONTH_LABELS[month]} conditions. It takes no credit for hygroscopic
                  buffering or for drying out in another season, and it does not resolve moisture
                  movement in two dimensions.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* ---------------- Other surfaces, one click away ---------------- */}
      <div className="flex flex-wrap gap-1.5 border-t px-3.5 py-2.5">
        {SURFACE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            aria-pressed={key === selected}
            className={
              key === selected
                ? 'chip border-primary/45 bg-primary/15 text-primary'
                : 'chip border-border/60 text-muted-foreground hover:text-foreground'
            }
          >
            {SURFACE_LABEL[key]}
          </button>
        ))}
        {reading ? (
          <span className="ml-auto self-center text-[11.5px] text-muted-foreground">
            Indoor {num(reading.moisture.indoorTemp, 1)} °C · {pct(reading.moisture.indoorRh, 0)} RH ·
            dew point {num(reading.moisture.dewPoint, 1)} °C
          </span>
        ) : null}
      </div>
    </div>
  );
}

const SURFACE_LABEL: Record<SurfaceSelection, string> = {
  front: 'Front',
  right: 'Right',
  back: 'Rear',
  left: 'Left',
  roof: 'Roof',
  floor: 'Floor',
};
