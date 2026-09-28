'use client';

/**
 * Design Brief — the area-specific answer, in one place.
 *
 * This is the page that makes the defence evolution legible. It takes the
 * resolved location, the mission and the shelter type and shows what follows
 * from them: the climate fingerprint's verdict, the requirement engine's
 * recommendations *and why*, the internal load, the moisture and condensation
 * state, the heat/cold stress assessment, where the heat is actually being
 * lost, and what the shelter weighs and costs to deploy.
 *
 * Every number on this page comes from an engine that already exists — nothing
 * is recomputed for display, so the page cannot disagree with the charts, the
 * 3D model or the report.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Flame,
  Gauge,
  Package,
  ShieldAlert,
  Snowflake,
  Target,
  Users,
  Wind,
} from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { computeClimateFingerprint } from '@/climate/fingerprint';
import { applyRequirements, deriveRequirements } from '@/climate/requirementEngine';
import { buildingType } from '@/lib/buildingTypes';
import { isMissionProfileId, missionProfile } from '@/lib/missions';
import { computeInternalLoads } from '@/lib/internalLoads';
import { computeMoisture } from '@/thermal/moisture';
import { computeHeatLossBreakdown } from '@/thermal/heatLoss';
import { assessStress } from '@/thermal/stress';
import {
  VENTILATION_ACTION_LABEL,
  VENTILATION_STRATEGY_LABEL,
  VENTILATION_STRATEGY_OPTIONS,
  compareVentilationStrategies,
  type VentilationStrategy,
} from '@/thermal/ventilationControl';
import { computeDeploymentMetrics } from '@/lib/deployment';
import { compareStrategies } from '@/lib/strategies';
import { evaluateDesign } from '@/optimization/pipeline';
import { DEFAULT_WEIGHTS } from '@/optimization/objective';
import { CHALLENGE_LABEL, ZONE_LABEL } from '@/lib/labels';
import { BarRow, MetricCard, SectionHeader, StatusBadge } from '@/components/ui/soft';
import { Chip, EmptyState, MetricRow, Panel, Segmented } from '@/components/ui/primitives';
import { num, pct } from '@/utils/format';
import type { PastelTone } from '@/components/ui/soft';
import type { StressRisk } from '@/thermal/stress';
import type { CondensationRisk } from '@/thermal/moisture';

const RISK_TONE: Record<StressRisk | CondensationRisk, PastelTone> = {
  low: 'mint',
  medium: 'yellow',
  moderate: 'yellow',
  high: 'peach',
  extreme: 'pink',
};

/** Chip tones are a narrower set than the pastel tones — mapped explicitly. */
const RISK_CHIP = {
  low: 'good',
  medium: 'warn',
  moderate: 'warn',
  high: 'accent',
  extreme: 'bad',
} as const;

export default function BriefPage() {
  const climateData = useDesignStore((s) => s.climateData);
  const analysis = useDesignStore((s) => s.climateAnalysis);
  const parameters = useDesignStore((s) => s.currentParameters);
  const thermal = useDesignStore((s) => s.currentThermal);
  const metrics = useDesignStore((s) => s.metrics);
  const materials = useDesignStore((s) => s.materials);
  const geometry = useDesignStore((s) => s.geometry);
  const month = useDesignStore((s) => s.analysisMonth);
  const hour = useDesignStore((s) => s.hourOfDay);
  const setParameters = useDesignStore((s) => s.setParameters);

  /* The ventilation control stance is a *control* choice, not a design choice —
     it changes how the shelter is operated, not what it is built from. Keeping
     it in local state means switching it cannot dirty the design or invalidate
     the optimiser result. */
  const [ventilationStrategy, setVentilationStrategy] =
    useState<VentilationStrategy>('hybrid');

  const brief = useMemo(() => {
    if (!climateData || !analysis || !thermal || !metrics || !materials || !geometry) return null;

    const template = buildingType(parameters.buildingType);
    const mission = isMissionProfileId(parameters.missionProfile)
      ? missionProfile(parameters.missionProfile)
      : null;
    const fingerprint = computeClimateFingerprint(climateData);

    const internalLoads = computeInternalLoads(
      parameters.numOccupants,
      mission?.activityMet ?? 1.2,
      parameters.internalLoads ?? [],
      geometry.floorArea,
    );

    const requirements = deriveRequirements({
      fingerprint,
      analysis,
      climate: climateData,
      template,
      base: parameters,
      missionId: parameters.missionProfile,
    });

    const indoorTemp =
      thermal.dailyProfile.points[Math.round(hour) % 24]?.indoorTemp ?? thermal.indoorTemperature;

    const moisture = computeMoisture(climateData, geometry, materials, parameters, {
      month,
      hour,
      indoorTemp,
      latentGainW: internalLoads.totalLatentW,
    });

    const heatLoss = computeHeatLossBreakdown(thermal.dailyProfile, parameters, geometry);

    const stress = assessStress(thermal, mission?.activityMet ?? 1.2, 1.5);

    const deployment = computeDeploymentMetrics(geometry, materials, parameters, metrics.annualEnergy);

    /* Ventilation control — all three stances, so the comparison is honest and
       switching the selector never needs a recompute. The targets come from the
       mission where one is selected, so a medical shelter is asked to hold a
       tighter humidity ceiling than a store. */
    const ventilation = compareVentilationStrategies(climateData, geometry, parameters, {
      month,
      occupants: parameters.numOccupants,
      outdoorAirPerPersonLps: mission?.freshAirPerPerson,
      sensibleGainW: internalLoads.totalSensibleW,
      latentGainW: internalLoads.totalLatentW,
      humidityCeilingPct: mission?.targetHumidity.max ?? 65,
      coolingSetpointC: mission?.targetTemp.max ?? parameters.coolingSetpoint,
      indoorTemps: thermal.dailyProfile.points.map((point) => point.indoorTemp),
    });

    /* Passive / hybrid / active, priced on one shared envelope so the comparison
       isolates how comfort is delivered rather than confounding it with a
       different build-up. */
    const strategies = compareStrategies({
      base: parameters,
      climate: climateData,
      requirements,
      month,
      occupants: parameters.numOccupants,
      sensibleGainW: internalLoads.totalSensibleW,
      latentGainW: internalLoads.totalLatentW,
      humidityCeilingPct: mission?.targetHumidity.max ?? 65,
      coolingSetpointC: mission?.targetTemp.max ?? parameters.coolingSetpoint,
      indoorTemps: thermal.dailyProfile.points.map((point) => point.indoorTemp),
      evaluate: (candidate) => {
        const evaluated = evaluateDesign(candidate, climateData, DEFAULT_WEIGHTS);
        return { thermal: evaluated.thermal, geometry: evaluated.geometry };
      },
    });

    return {
      template,
      mission,
      fingerprint,
      internalLoads,
      requirements,
      moisture,
      heatLoss,
      stress,
      deployment,
      ventilation,
      strategies,
    };
  }, [
    climateData,
    analysis,
    thermal,
    metrics,
    materials,
    geometry,
    parameters,
    month,
    hour,
  ]);

  if (!brief || !climateData) {
    return (
      <div className="page-pad page-gap">
        <SectionHeader
          eyebrow="Design"
          title="Design Brief"
          description="Location + mission + shelter type → thermal requirements, moisture, stress and deployability."
        />
        <div className="soft-card flex min-h-[280px] items-center justify-center px-6 py-12">
          <EmptyState
            message="No design resolved yet"
            hint="Press Generate design to run the pipeline, then this brief will populate from the same numbers the charts and the 3D model use."
          />
        </div>
      </div>
    );
  }

  const { template, mission, fingerprint, internalLoads, requirements, moisture, heatLoss, stress, deployment, ventilation, strategies } = brief;
  const lossMax = Math.max(...heatLoss.components.map((c) => c.lossKwh), 1e-6);
  const ventilationNow = ventilation[ventilationStrategy];
  const ventilationMax = Math.max(...ventilationNow.hours.map((h) => h.required), 1);
  const STRATEGIES: VentilationStrategy[] = ['passive', 'hybrid', 'active'];

  return (
    <div className="page-pad page-gap">
      <SectionHeader
        eyebrow="Design"
        title="Design Brief"
        description="Everything that follows from the location, the mission and the shelter type — the requirement set and its reasons, the internal load, moisture, heat and cold stress, where the heat is lost, and what it weighs."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="ready" label={ZONE_LABEL[fingerprint.zone]} />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setParameters(applyRequirements(parameters, requirements))}
              title="Apply the requirement engine's recommendations as the live design"
            >
              <Target size={13} aria-hidden />
              Apply as design seed
            </button>
          </div>
        }
      />

      {/* ---------------- The brief, in one line ---------------- */}
      <div className="soft-card p-6">
        <p className="section-eyebrow">Brief</p>
        <h2 className="section-title-soft mt-1">
          {template.glyph} {template.label} · {climateData.location.city}
        </h2>
        <p className="mt-2 max-w-[900px] text-[13.5px] leading-relaxed text-muted-foreground">
          {requirements.headline}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {mission ? <Chip tone="accent">{mission.glyph} {mission.label}</Chip> : null}
          <Chip tone="neutral">Primary · {CHALLENGE_LABEL[fingerprint.primary]}</Chip>
          {fingerprint.secondary !== fingerprint.primary ? (
            <Chip tone="neutral">Secondary · {CHALLENGE_LABEL[fingerprint.secondary]}</Chip>
          ) : null}
          <Chip tone="neutral">{template.category === 'defence' ? 'Defence shelter' : 'Civil reference'}</Chip>
        </div>
        <Link
          href="/dashboard/fingerprint"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
        >
          See the full climate fingerprint
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>

      {/* ================================================================
          BAND 2 — WHAT THE SITE DEMANDS (WHY)
          Four panels that together answer "what must this shelter do?".
          They were nine equal-weight siblings with the proof bands below
          them; grouping them restores the WHAT → WHY → HOW reading order
          the rest of the app uses.
          ================================================================ */}
      <SectionHeader
        eyebrow="Requirements"
        title="What the site demands of this shelter"
        description="Internal load, the requirement set and its reasons, moisture behaviour and physiological stress — all derived from the location, the mission and the shelter type."
      />

      {/* ---------------- Internal load ---------------- */}
      <Panel
        title="Internal heat load"
        subtitle={
          mission
            ? `${mission.label} · ${mission.activity} · ${mission.operatingHours} h/day${mission.continuous ? ' continuous' : ''}`
            : 'Occupants and equipment'
        }
        accent="input"
        right={<Chip tone="accent">{internalLoads.totalKw.toFixed(2)} kW total</Chip>}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-1.5 rounded-lg border bg-card/40 p-3.5">
            <MetricRow label="Occupants" value={`${internalLoads.occupants.count} × ${internalLoads.occupants.met.toFixed(1)} met`} />
            <MetricRow label="Occupant sensible" value={`${num(internalLoads.occupants.sensibleW, 0)} W`} />
            <MetricRow label="Occupant latent" value={`${num(internalLoads.occupants.latentW, 0)} W`} />
            <MetricRow label="Equipment sensible" value={`${num(internalLoads.equipmentSensibleW, 0)} W`} />
            <MetricRow label="Equipment latent" value={`${num(internalLoads.equipmentLatentW, 0)} W`} />
            <MetricRow label="Total" value={`${num(internalLoads.totalW, 0)} W`} tone="good" />
            <MetricRow
              label="Density"
              value={`${num(internalLoads.densityWPerSqm, 1)} W/m²`}
            />
          </div>
          <div>
            <p className="stat-label">Itemised equipment</p>
            {internalLoads.items.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                No equipment listed. The mission profile seeds a list when one is selected.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {internalLoads.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3 rounded-md border bg-card/40 px-2.5 py-1.5 text-[12.5px]"
                  >
                    <span className="text-foreground/85">
                      {item.count} × {item.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {num(item.sensibleW + item.latentW, 0)} W
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {/* ---------------- Requirements ---------------- */}
      <Panel
        title="Area-specific thermal requirements"
        subtitle="Location + mission + shelter type → what the design must do, and why"
        accent="analysis"
      >
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {requirements.items.map((item) => (
            <li key={item.title} className="rounded-lg border bg-card/40 px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                <span className="shrink-0 text-[12.5px] font-medium text-primary">{item.value}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{item.reason}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          These are the requirements the climate and the mission imply — a <b className="text-foreground/85">seed</b>{' '}
          for the optimiser, not the final specification. The physics engine decides what is actually
          worth building.
        </p>
      </Panel>

      {/* ---------------- Moisture & condensation ---------------- */}
      <Panel
        title="Moisture and condensation"
        subtitle={`${moisture.airChangesPerHour.toFixed(1)} ACH total air exchange · ${moisture.pressurePa} Pa`}
        accent="optimize"
        right={<Chip tone={RISK_CHIP[moisture.risk]}>Condensation risk · {moisture.risk}</Chip>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5 rounded-lg border bg-card/40 p-3.5">
            <MetricRow label="Indoor temperature" value={`${num(moisture.indoorTemp, 1)} °C`} />
            <MetricRow label="Indoor RH" value={pct(moisture.indoorRh, 0)} />
            <MetricRow label="Dew point" value={`${num(moisture.dewPoint, 1)} °C`} />
            <MetricRow label="Wet bulb" value={`${num(moisture.wetBulb, 1)} °C`} />
            <MetricRow
              label="Humidity ratio"
              value={`${(moisture.indoorHumidityRatio * 1000).toFixed(2)} g/kg`}
            />
            <MetricRow label="Outdoor" value={`${num(moisture.outdoorTemp, 1)} °C · ${pct(moisture.outdoorRh, 0)}`} />
            <MetricRow label="Moisture generation" value={`${num(moisture.generationKgPerHour, 3)} kg/h`} />
            <MetricRow label="Condensing" value={`${num(moisture.condensationKgPerHour, 3)} kg/h`} tone={moisture.condensationKgPerHour > 0 ? 'warn' : undefined} />
          </div>
          <div>
            <p className="stat-label">Surface condensation risk</p>
            <ul className="mt-2 space-y-1">
              {moisture.surfaces.map((surface) => (
                <li
                  key={surface.key}
                  className="flex items-baseline justify-between gap-3 rounded-md border bg-card/40 px-2.5 py-1.5 text-[12.5px]"
                >
                  <span className="text-foreground/85">{surface.label}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-muted-foreground">{num(surface.surfaceTemp, 1)} °C</span>
                    <span
                      className="font-semibold"
                      style={{
                        color:
                          surface.margin < 0
                            ? 'hsl(var(--destructive))'
                            : surface.margin < 2
                              ? 'hsl(var(--warning))'
                              : 'hsl(var(--success))'
                      }}
                    >
                      {surface.margin >= 0 ? '+' : ''}
                      {num(surface.margin, 1)} K
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-snug text-muted-foreground">{moisture.summary}</p>
          </div>
        </div>
      </Panel>

      {/* ---------------- Stress ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MetricCard
          tone={RISK_TONE[stress.heat.risk]}
          label="Heat stress · WBGT"
          icon={Flame}
          value={num(stress.heat.wbgt, 1)}
          unit="°C WBGT"
          description={stress.heat.guidance}
          meta={
            <p className="text-[12px] opacity-75">
              Wet bulb {num(stress.heat.wetBulb, 1)} °C · globe {num(stress.heat.globeTemp, 1)} °C
            </p>
          }
          right={
            <span className="rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] font-semibold capitalize">
              {stress.heat.risk}
            </span>
          }
        />
        <MetricCard
          tone={RISK_TONE[stress.cold.risk]}
          label="Cold stress · clothing"
          icon={Snowflake}
          value={num(stress.cold.requiredClo, 2)}
          unit="clo required"
          description={stress.cold.guidance}
          meta={
            <p className="text-[12px] opacity-75">
              Operative {num(stress.cold.operativeTemp, 1)} °C · issued {num(stress.cold.availableClo, 2)} clo ·
              deficit {num(stress.cold.deficitClo, 2)} clo
            </p>
          }
          right={
            <span className="rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] font-semibold capitalize">
              {stress.cold.risk}
            </span>
          }
        />
      </div>

      <Panel
        title="What the assessment recommends"
        subtitle={`The binding constraint at this condition is ${stress.binding === 'comfort' ? 'ordinary comfort' : `${stress.binding} stress`}`}
        accent="output"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="stat-label">Heat actions</p>
            {stress.heat.actions.length === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">No heat-stress restriction.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {stress.heat.actions.map((action) => (
                  <li key={action} className="text-[12.5px] leading-snug text-foreground/85">
                    • {action}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="stat-label">Cold actions</p>
            {stress.cold.actions.length === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">Issued clothing is adequate.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {stress.cold.actions.map((action) => (
                  <li key={action} className="text-[12.5px] leading-snug text-foreground/85">
                    • {action}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {/* ================================================================
          BAND 3 — WHERE THE ENERGY GOES (HOW)
          The loss path and the ventilation strategy. These are the two
          levers the design actually has, so they sit together after the
          requirement set rather than being buried among the diagnostics.
          ================================================================ */}
      <SectionHeader
        eyebrow="Energy & ventilation"
        title="Where the energy goes, and how it is controlled"
        description="The envelope loss path on a representative day, then the ventilation strategy measured against what each hour actually requires."
      />

      {/* ---------------- Heat loss ---------------- */}
      <Panel
        title="Where the heat is lost"
        subtitle={`Representative day in the analysis month · ${num(heatLoss.totalLossKwh, 1)} kWh/day leaving`}
        accent="analysis"
        right={
          heatLoss.worst ? (
            <Chip tone="warn">Worst path · {heatLoss.worst.label} {heatLoss.worst.sharePct.toFixed(0)}%</Chip>
          ) : undefined
        }
      >
        <div className="space-y-3.5">
          {heatLoss.components.map((component) => (
            <BarRow
              key={component.key}
              label={component.label}
              value={`${component.lossKwh.toFixed(1)} kWh · ${component.sharePct.toFixed(0)}%`}
              share={component.lossKwh / lossMax}
              tone={component.key === 'infiltration' ? 'peach' : 'mint'}
            />
          ))}
        </div>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Intentional ventilation</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {heatLoss.intentionalVentilation.ach.toFixed(1)} ACH ·{' '}
              {heatLoss.intentionalVentilation.sharePct.toFixed(0)} % of loss
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">A control decision — it can be turned down.</p>
          </div>
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Uncontrolled infiltration</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {heatLoss.infiltration.ach.toFixed(1)} ACH · {heatLoss.infiltration.sharePct.toFixed(0)} % of loss
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">A defect — it cannot be turned off.</p>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">{heatLoss.summary}</p>
      </Panel>

      {/* ---------------- Ventilation control ---------------- */}
      <Panel
        title="Ventilation control"
        subtitle={`Required against achievable air change, hour by hour · ${VENTILATION_STRATEGY_LABEL[ventilationStrategy]}`}
        accent="optimize"
        right={
          <Chip tone={ventilationNow.shortfallHours === 0 ? 'good' : 'warn'}>
            {ventilationNow.hoursSatisfied}/24 h satisfied
          </Chip>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Wind size={13} aria-hidden />
            Strategy
          </span>
          <Segmented<VentilationStrategy>
            options={VENTILATION_STRATEGY_OPTIONS}
            value={ventilationStrategy}
            onChange={setVentilationStrategy}
          />
          <span className="ml-auto text-[12px] text-muted-foreground">
            {num(ventilationNow.operableOpeningArea, 1)} m² operable openings ·{' '}
            {num(ventilationNow.infiltrationAch, 1)} ACH uncontrolled
          </span>
        </div>

        {/* --- Hourly required vs achieved --- */}
        <div className="mt-4">
          <div className="flex items-end gap-[3px]">
            {ventilationNow.hours.map((entry) => {
              const requiredPct = Math.min(100, (entry.required / ventilationMax) * 100);
              const achievedPct = Math.min(100, (entry.achieved / ventilationMax) * 100);
              return (
                <div
                  key={entry.hour}
                  className="relative flex-1"
                  title={
                    `${String(entry.hour).padStart(2, '0')}:00 · required ${entry.required.toFixed(1)} ACH · ` +
                    `achieved ${entry.achieved.toFixed(1)} ACH · ${VENTILATION_ACTION_LABEL[entry.action]} · ${entry.note}`
                  }
                >
                  <div className="relative h-[86px] w-full rounded-sm bg-secondary/50">
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-sm opacity-35"
                      style={{
                        height: `${requiredPct}%`,
                        background: 'hsl(var(--foreground))',
                      }}
                    />
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-sm"
                      style={{
                        height: `${achievedPct}%`,
                        background: entry.moistureLimited
                          ? 'hsl(var(--warning))'
                          : entry.satisfied
                            ? 'hsl(var(--primary))'
                            : 'hsl(var(--destructive))',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground/75">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00</span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Filled bar = air change actually delivered, by hour. Pale bar behind it = the rate the
            hour required. Red marks an hour that fell short; amber marks an hour where the outdoor
            air is already too humid for ventilation to help.
          </p>
        </div>

        {/* --- The "ventilation is the wrong tool" case --- */}
        {ventilationNow.requiresDehumidification ? (
          <div className="mt-4 rounded-lg border border-border/70 bg-secondary/40 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-foreground">
              This month needs dehumidification, not more air
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              In {ventilationNow.moistureLimitedHours} of 24 hours the outdoor air already carries
              more moisture than the {mission?.targetHumidity.max ?? 65} % ceiling allows, so
              ventilating would make the interior wetter. No air-change rate fixes that — the
              requirement is a drying plant, or a lower indoor temperature.
            </p>
          </div>
        ) : null}

        {/* --- What set the rate --- */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Air quality</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {ventilationNow.airQualityHours} h binding
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {num(ventilationNow.hours[0]?.requiredForAirQuality ?? 0, 1)} ACH per-person + per-area.
            </p>
          </div>
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Moisture</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {ventilationNow.moistureHours} h binding
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Holding RH below {mission?.targetHumidity.max ?? 65} %.
            </p>
          </div>
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Free cooling</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {ventilationNow.freeCoolingHours} h available
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {ventilationNow.coolingHours} h where cooling set the rate.
            </p>
          </div>
          <div className="rounded-lg border bg-card/40 px-3.5 py-3">
            <p className="stat-label">Fan energy</p>
            <p className="mt-1 text-[13px] tabular-nums text-foreground">
              {num(ventilationNow.fanEnergyKwhPerMonth, 1)} kWh/mo
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Ventilation fans only — HVAC energy is reported separately.
            </p>
          </div>
        </div>

        {/* --- The three stances side by side --- */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Strategy</th>
                <th className="py-2 pr-3 text-right font-semibold">Hours met</th>
                <th className="py-2 pr-3 text-right font-semibold">Peak shortfall</th>
                <th className="py-2 pr-3 text-right font-semibold">Mean achieved</th>
                <th className="py-2 text-right font-semibold">Fan energy</th>
              </tr>
            </thead>
            <tbody>
              {STRATEGIES.map((strategy) => {
                const row = ventilation[strategy];
                return (
                  <tr
                    key={strategy}
                    className={
                      strategy === ventilationStrategy
                        ? 'border-b border-border/60 bg-primary/[0.06]'
                        : 'border-b border-border/40'
                    }
                  >
                    <td className="py-2 pr-3 text-foreground/85">
                      {VENTILATION_STRATEGY_LABEL[strategy]}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.hoursSatisfied}/24</td>
                    <td
                      className="py-2 pr-3 text-right tabular-nums"
                      style={{
                        color:
                          row.requiresDehumidification
                            ? 'hsl(var(--warning))'
                            : row.shortfallHours === 0
                              ? 'hsl(var(--success))'
                              : 'hsl(var(--warning))',
                      }}
                    >
                      {row.requiresDehumidification
                        ? 'needs drying'
                        : row.shortfallHours === 0
                          ? '—'
                          : `${num(row.peakShortfallAch, 1)} ACH`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.requiresDehumidification
                        ? `${num(row.meanAchieved, 1)} / ${num(row.meanRequired, 1)} ACH*`
                        : `${num(row.meanAchieved, 1)} / ${num(row.meanRequired, 1)} ACH`}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {num(row.fanEnergyKwhPerMonth, 1)} kWh/mo
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          {ventilationNow.summary}
        </p>
        {ventilationNow.requiresDehumidification ? (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground/70">
            * Means are taken over the hours that have a finite ventilation requirement. The
            moisture-limited hours have no finite requirement and are excluded, so they do not
            distort the average.
          </p>
        ) : null}
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground/70">
          The achievable rate is a first-order buoyancy-plus-wind estimate through the total operable
          opening area — an estimate, not a network airflow or CFD solve. A passive shelter is
          allowed to fall short; that is what it means to be passive. Fan energy is ventilation only
          and does not include heating or cooling plant.
        </p>
      </Panel>

      {/* ================================================================
          BAND 4 — DEPLOYMENT & DELIVERY
          How the comfort is delivered, and what it costs to move. Kept
          as a distinct band: a DRDO reviewer asks "what do we deploy and
          what does it weigh", which is a different question from "how
          does it perform".
          ================================================================ */}
      <SectionHeader
        eyebrow="Deployment"
        title="What gets deployed, and how the comfort is delivered"
        description="The transport and erection profile, then the passive / hybrid / active comparison priced on the same envelope."
      />

      {/* ---------------- Deployment ---------------- */}
      <Panel
        title="Deployability"
        subtitle={
          deployment.deployable
            ? 'Transport and erection profile'
            : 'Site-built shelter — transport figures do not apply'
        }
        accent="input"
        right={
          <Chip tone={deployment.deployable ? 'accent' : 'neutral'}>
            {deployment.deployable ? `${deployment.panelCount} panel${deployment.panelCount === 1 ? '' : 's'}` : 'In-situ'}
          </Chip>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            tone="peach"
            label="Shelter mass"
            icon={Package}
            value={num(deployment.totalMassKg / 1000, 2)}
            unit="tonnes"
            description={`Envelope ${num(deployment.envelopeMassKg / 1000, 2)} t from the resolved assemblies.`}
          />
          <MetricCard
            tone="blue"
            label="Packed volume"
            icon={Package}
            value={num(deployment.packedVolumeM3, 2)}
            unit="m³"
            description={`${(deployment.packingFactor * 100).toFixed(0)} % of the ${num(deployment.deployedVolumeM3, 1)} m³ deployed volume.`}
          />
          <MetricCard
            tone={deployment.deployable ? 'mint' : 'gray'}
            label="Deployment time"
            icon={Users}
            value={deployment.deployable ? String(deployment.deploymentTimeMin) : '—'}
            unit={deployment.deployable ? 'minutes' : 'site-built'}
            description={
              deployment.deployable
                ? `${deployment.manpowerRequired} personnel · transport ${num(deployment.transportVolumeM3, 2)} m³`
                : 'Not a transportable shelter.'
            }
          />
          <MetricCard
            tone="yellow"
            label="Daily energy"
            icon={Gauge}
            value={num(deployment.dailyElectricalKwh, 1)}
            unit="kWh/day"
            description={
              deployment.dailyFuelLitres > 0
                ? `Fuel ${num(deployment.dailyFuelLitres, 1)} L/day at 10 kWh per litre.`
                : 'Electrical only — nothing burns fuel.'
            }
          />
        </div>
        <ul className="mt-4 space-y-1">
          {deployment.notes.map((note) => (
            <li key={note} className="flex items-start gap-2 text-[12px] leading-snug text-muted-foreground">
              <ShieldAlert size={12} className="mt-[3px] shrink-0 opacity-60" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---------------- Passive / hybrid / active ---------------- */}
      <Panel
        title="How the comfort is delivered"
        subtitle="Passive, hybrid and active, priced on the same envelope so the plant is the only variable"
        accent="output"
        right={<Chip tone="good">Recommended · {strategies.recommended}</Chip>}
      >
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {strategies.recommendation}
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {strategies.outcomes.map((outcome) => {
            const isBest = outcome.id === strategies.recommended;
            return (
              <div
                key={outcome.id}
                className={
                  isBest
                    ? 'rounded-lg border border-primary/40 bg-primary/[0.06] px-3.5 py-3'
                    : 'rounded-lg border bg-card/40 px-3.5 py-3'
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {outcome.definition.glyph} {outcome.definition.label}
                  </span>
                  {isBest ? <Chip tone="good">Best balance</Chip> : null}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  {outcome.definition.summary}
                </p>
                <div className="mt-2.5 space-y-1.5">
                  <MetricRow
                    label="Conditioned comfort"
                    value={`${num(outcome.conditionedComfort, 0)}/100`}
                    tone={outcome.conditionedComfort >= 60 ? 'good' : 'warn'}
                  />
                  <MetricRow
                    label="Envelope alone"
                    value={`${num(outcome.passiveCoveragePct, 0)} % of the year`}
                  />
                  <MetricRow label="Energy intensity" value={`${num(outcome.eui, 1)} kWh/m²·yr`} />
                  <MetricRow
                    label="Installed plant"
                    value={outcome.installedCapacityKw > 0 ? `${num(outcome.installedCapacityKw, 1)} kW` : 'None'}
                  />
                  {outcome.installedCapacityKw > 0 ? (
                    <MetricRow
                      label="Efficiency at part load"
                      value={
                        outcome.id === 'passive'
                          ? '—'
                          : `${num(outcome.hvac.effectiveHeatingEfficiency, 1)} heat · ${num(outcome.hvac.effectiveCoolingCop, 1)} cool`
                      }
                      tone={
                        outcome.hvac.heatingPlf < 0.95 || outcome.hvac.coolingPlf < 0.95
                          ? 'warn'
                          : undefined
                      }
                    />
                  ) : null}
                  <MetricRow
                    label="Fuel"
                    value={
                      outcome.fuelLitresPerDay > 0
                        ? `${num(outcome.fuelLitresPerDay, 1)} L/day`
                        : 'No fuel'
                    }
                  />
                  <MetricRow label="CO₂" value={`${num(outcome.co2TonnesPerYear, 1)} t/yr`} />
                  <MetricRow
                    label="Ventilation"
                    value={`${outcome.ventilation.hoursSatisfied}/24 h met`}
                    tone={outcome.ventilation.shortfallHours === 0 ? 'good' : 'warn'}
                  />
                </div>
                <p className="mt-2.5 text-[11.5px] leading-snug text-muted-foreground/80">
                  {outcome.summary}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground/60">
                  {outcome.definition.tradeoff}
                </p>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-[11.5px] leading-snug text-muted-foreground/70">
          All three are evaluated on the {strategies.envelopeFromRequirements ? 'same requirement-engine envelope' : 'current envelope'},
          in the same month, by the same heat balance — the plant is the only thing that changes.
          Efficiencies are reduced for part load using the standard DOE-2 degradation factor, with
          the part-load ratio estimated from equivalent full-load hours. Fuel assumes 10 kWh per
          litre. This is a design comparison, not a life-cycle cost.
        </p>
      </Panel>

      {/* ---------------- Honesty ---------------- */}
      <div className="soft-card px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="text-foreground/85">Model estimate — not a measured building result.</b> The moisture
          balance is a single-zone steady-state solve; the WBGT uses Stull&rsquo;s wet-bulb approximation, which
          assumes near-sea-level pressure; the cold-stress figure is a linear approximation of the ISO 11079
          table; and the deployment figures are a comparison tool, not a logistics plan. Every figure is an
          engineering estimate from a reduced-order model.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/design" className="btn-secondary">
          Open Design Studio
          <ArrowRight size={13} aria-hidden />
        </Link>
        <Link href="/dashboard/analysis" className="btn-secondary">
          Full thermal analysis
          <ArrowRight size={13} aria-hidden />
        </Link>
        <Link href="/dashboard/optimization" className="btn-secondary">
          Optimise this brief
          <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
