'use client';

/**
 * The material system.
 *
 * Shows the *resolved* assembly — the actual U-value the thermal model used,
 * not the nominal figure from a brochure — next to the catalogue it was chosen
 * from. The gap between those two is the whole point of an insulation layer: a
 * 230 mm brick wall is 1.20 W/m²K on its own and 0.28 W/m²K with 100 mm of XPS
 * on it, and a user who cannot see that cannot make a decision.
 *
 * The catalogue list is also the material picker in manual mode.
 */

import { useMemo, useState } from 'react';
import { Layers, Palette } from 'lucide-react';
import { useDesignStore } from '@/store/designStore';
import { resolveMaterials } from '@/thermal/materials';
import {
  INSULATION_MATERIALS,
  MATERIAL_BY_ID,
  ROOF_MATERIALS,
  WALL_MATERIALS,
  WINDOW_MATERIALS,
} from '@/thermal/materials';
import { Chip, MetricRow, Panel } from '@/components/ui/primitives';
import { currency, num, pct, uValue } from '@/utils/format';
import { cn } from '@/lib/utils';
import type { MaterialProperties } from '@/types';

type Category = 'wall' | 'roof' | 'window' | 'insulation';

const CATALOGUE: Record<Category, MaterialProperties[]> = {
  wall: WALL_MATERIALS,
  roof: ROOF_MATERIALS,
  window: WINDOW_MATERIALS,
  insulation: INSULATION_MATERIALS,
};

const CATEGORY_LABEL: Record<Category, string> = {
  wall: 'Walls',
  roof: 'Roofs',
  window: 'Glazing',
  insulation: 'Insulation',
};

/** The parameter key each category writes to, in manual mode. */
const PARAMETER_KEY: Record<Category, 'wallMaterialId' | 'roofMaterialId' | 'windowMaterialId' | null> =
  {
    wall: 'wallMaterialId',
    roof: 'roofMaterialId',
    window: 'windowMaterialId',
    insulation: null,
  };

function Swatch({ material }: { material: MaterialProperties }) {
  return (
    <span
      aria-hidden
      className="h-5 w-5 shrink-0 rounded-sm border border-border/70"
      style={{
        background: material.color,
        boxShadow: `inset 0 -3px 6px -3px hsl(0 0% 0% / 0.5)`,
      }}
    />
  );
}

export function MaterialPanel() {
  const currentParameters = useDesignStore((state) => state.currentParameters);
  const updateSelect = useDesignStore((state) => state.updateSelect);
  const mode = useDesignStore((state) => state.mode);
  const climateData = useDesignStore((state) => state.climateData);

  const [category, setCategory] = useState<Category>('wall');

  const materials = useMemo(() => resolveMaterials(currentParameters), [currentParameters]);

  const activeId =
    category === 'wall'
      ? currentParameters.wallMaterialId
      : category === 'roof'
        ? currentParameters.roofMaterialId
        : category === 'window'
          ? currentParameters.windowMaterialId
          : materials.insulation.id;

  const catalogue = CATALOGUE[category];
  const editable = mode === 'manual' && PARAMETER_KEY[category] !== null;

  return (
    <Panel
      title="Materials & thermal properties"
      subtitle="The resolved assembly the model actually used"
      accent="optimize"
      scroll
      right={
        climateData ? (
          <Chip tone="neutral" title="Solar absorptance of the outer surface matters most in hot climates">
            α {num(materials.roof.solarAbsorptance, 2)} roof
          </Chip>
        ) : null
      }
    >
      {/* ---------------- Resolved assembly ---------------- */}
      <div className="rounded-md border bg-card/40 px-2.5 py-2">
        <div className="mb-1 flex items-center gap-1.5">
          <Layers size={13} className="text-muted-foreground" aria-hidden />
          <h3 className="stat-label">Resolved envelope</h3>
        </div>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <div>
            <MetricRow
              label="Wall"
              value={`${materials.wall.name}`}
              hint={`λ ${num(materials.wall.thermalConductivity, 3)} W/m·K · ${num(materials.wall.thickness * 1000, 0)} mm`}
            />
            <MetricRow
              label="Wall U-value"
              value={uValue(materials.wall.uValue)}
              tone={materials.wall.uValue <= 0.4 ? 'good' : materials.wall.uValue <= 0.8 ? 'warn' : 'bad'}
            />
            <MetricRow
              label="Roof"
              value={materials.roof.name}
              hint={`λ ${num(materials.roof.thermalConductivity, 3)} W/m·K · ${num(materials.roof.thickness * 1000, 0)} mm`}
            />
            <MetricRow
              label="Roof U-value"
              value={uValue(materials.roof.uValue)}
              tone={materials.roof.uValue <= 0.4 ? 'good' : materials.roof.uValue <= 0.8 ? 'warn' : 'bad'}
            />
          </div>
          <div>
            <MetricRow
              label="Glazing"
              value={materials.window.name}
              hint={materials.window.shgc !== undefined ? `SHGC ${num(materials.window.shgc, 2)}` : undefined}
            />
            <MetricRow
              label="Glazing U-value"
              value={uValue(materials.window.uValue)}
              tone={materials.window.uValue <= 1.8 ? 'good' : materials.window.uValue <= 3 ? 'warn' : 'bad'}
            />
            <MetricRow
              label="Insulation"
              value={
                materials.insulation.thickness > 0
                  ? `${materials.insulation.name} · ${num(materials.insulation.thickness * 1000, 0)} mm`
                  : 'none'
              }
              tone={materials.insulation.thickness > 0 ? 'good' : 'warn'}
            />
            <MetricRow
              label="Areal heat capacity"
              value={`${num(
                materials.wall.density *
                  materials.wall.thickness *
                  materials.wall.specificHeat /
                  1000,
                0,
              )} kJ/m²·K`}
              hint="Wall mass per unit area — sets the time lag"
            />
          </div>
        </div>
      </div>

      {/* ---------------- Catalogue ---------------- */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {(Object.keys(CATALOGUE) as Category[]).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={category === entry}
            className={`tab ${category === entry ? 'tab-active' : 'tab-idle'}`}
            onClick={() => setCategory(entry)}
          >
            {CATEGORY_LABEL[entry]}
            <span className="text-[11px] text-muted-foreground/70">{CATALOGUE[entry].length}</span>
          </button>
        ))}
        {editable ? (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
            <Palette size={12} aria-hidden />
            click to apply
          </span>
        ) : (
          <span className="ml-auto text-[12px] text-muted-foreground/60">
            read-only in auto mode
          </span>
        )}
      </div>

      <div className="mt-1.5 space-y-1.5">
        {catalogue.map((material) => {
          const selected = material.id === activeId;
          const key = PARAMETER_KEY[category];
          const disabled = !editable || !key;

          return (
            <button
              key={material.id}
              type="button"
              disabled={disabled}
              onClick={() => key && updateSelect(key, material.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                selected
                  ? 'border-primary/45 bg-primary/10'
                  : 'border-border/60 bg-card/30 hover:border-border hover:bg-card/60',
                disabled && !selected && 'opacity-70',
              )}
              title={disabled ? material.note : `${material.note} — click to apply`}
            >
              <Swatch material={material} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-foreground">{material.name}</span>
                  {selected ? <Chip tone="good">in use</Chip> : null}
                  <span className="ml-auto text-[12px] font-semibold tabular-nums text-primary">
                    {uValue(material.uValue)}
                  </span>
                </div>

                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground/80">
                  {material.note}
                </p>

                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                  <span>λ {num(material.thermalConductivity, 3)} W/m·K</span>
                  <span>{num(material.thickness * 1000, 0)} mm</span>
                  <span>ρ {num(material.density, 0)} kg/m³</span>
                  <span>c {num(material.specificHeat, 0)} J/kg·K</span>
                  <span>α {num(material.solarAbsorptance, 2)}</span>
                  {material.shgc !== undefined ? <span>SHGC {num(material.shgc, 2)}</span> : null}
                  {material.vlt !== undefined ? <span>VLT {pct(material.vlt * 100)}</span> : null}
                  <span>{currency(material.cost)}/m²</span>
                  {material.embodiedCarbon !== undefined ? (
                    <span>{num(material.embodiedCarbon, 0)} kgCO₂e/m²</span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {category === 'insulation' ? (
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground/65">
          Insulation level is a design decision owned by the climate engine and the optimiser; it is
          set from the analysis, not from this list. The thickness actually applied is shown above.
          Base assemblies come from{' '}
          {MATERIAL_BY_ID.get(currentParameters.wallMaterialId)?.name ?? 'the wall list'}.
        </p>
      ) : null}
    </Panel>
  );
}
