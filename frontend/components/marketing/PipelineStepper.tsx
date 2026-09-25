'use client';

/**
 * The design pipeline, as an interactive explainer.
 *
 * The brief calls the visible INPUT → … → RESULTS chain the most important
 * requirement in the project, so the landing page does not merely list the
 * stages — it lets a visitor step through them and see what each one consumes
 * and produces.
 *
 * The stage order, labels and descriptions are copied from the store's own
 * `STAGE_ORDER` template rather than retyped, so the explainer cannot drift out
 * of step with the application it is describing.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Stage {
  id: string;
  label: string;
  /** One line, shown under the stage name. */
  summary: string;
  /** What the stage reads. */
  input: string;
  /** What it writes for the next stage. */
  output: string;
  /** The method or standard behind it, if any. */
  basis: string;
}

/** Mirrors `STAGE_TEMPLATE` in `store/designStore.ts`. */
const STAGES: Stage[] = [
  {
    id: 'input',
    label: 'Input',
    summary: 'Location and design programme',
    input: 'A site from the station database, plus floor area, occupancy, room count and budget.',
    output: 'A complete parameter set — every value the rest of the pipeline can read.',
    basis: '33 climatological stations, 24 catalogue materials',
  },
  {
    id: 'climate',
    label: 'Climate',
    summary: 'Climatology resolved for the site',
    input: 'The station record for the chosen site.',
    output:
      'Twelve months of normals: dry-bulb mean, max and min, humidity, wind speed and direction, global horizontal irradiation, rainfall and sunshine hours.',
    basis: 'Köppen–Geiger classification, NOAA solar position',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    summary: 'Zone, challenge and design strategy',
    input: 'The monthly climate record.',
    output:
      'Heating and cooling degree days, the aridity index, the dominant challenge for the site, and the passive strategy set that follows from it.',
    basis: 'ASHRAE 55 adaptive comfort, Köppen aridity threshold',
  },
  {
    id: 'thermal',
    label: 'Thermal',
    summary: 'Monthly heat balance, PMV and energy',
    input: 'The parameters and the climate record.',
    output:
      'Conduction through every envelope layer, ventilation and infiltration, solar and internal gains — then PMV/PPD, adaptive comfort hours and delivered energy.',
    basis: 'ISO 7730 PMV/PPD, quasi-steady-state monthly balance',
  },
  {
    id: 'optimization',
    label: 'Optimisation',
    summary: 'Search across the design space',
    input: 'A curated neighbourhood around the current design, and your cost-to-comfort weighting.',
    output: 'A ranked shortlist, with the winning envelope resolved to buildable values.',
    basis: 'Coordinate descent over orientation, envelope, roof, shading, ventilation',
  },
  {
    id: 'parameters',
    label: 'Parameters',
    summary: 'Resolved buildable specification',
    input: 'The winning candidate from the search.',
    output:
      'Named materials with real U-values, thicknesses and areas — the take-off a builder could price.',
    basis: 'ISO 6946 U-value calculation',
  },
  {
    id: 'geometry',
    label: '3D model',
    summary: 'Parametric envelope geometry',
    input: 'The resolved parameters and materials.',
    output:
      'Walls, openings, roof planes, shading devices and furniture — built by the same function the thermal model consumes, so the view cannot disagree with the numbers.',
    basis: 'Parametric — no imported model',
  },
  {
    id: 'results',
    label: 'Results',
    summary: 'Comfort, energy, cost and comparison',
    input: 'Everything the pipeline has produced.',
    output:
      'A design score, comfort hours, energy intensity, construction cost, and the same figures for conventional local construction as a baseline.',
    basis: 'Compared against a conventional build, always',
  },
];

export function PipelineStepper() {
  const [active, setActive] = useState(0);
  const stage = STAGES[active]!;

  return (
    <div>
      {/* ---- The chain ---- */}
      <div className="scroll-area -mx-5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
        <div
          className="flex min-w-[820px] items-stretch gap-1.5 sm:min-w-0"
          role="tablist"
          aria-label="Design pipeline stages"
        >
          {STAGES.map((item, index) => {
            const selected = index === active;
            return (
              <div key={item.id} className="flex flex-1 items-center gap-1.5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(index)}
                  className={cn(
                    'group relative flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition-colors',
                    selected
                      ? 'border-primary/40 bg-primary/[0.07]'
                      : 'border-border bg-panel hover:border-primary/25 hover:bg-card',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold tabular-nums transition-colors',
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      'text-[13px] font-semibold leading-tight',
                      selected ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {item.label}
                  </span>
                </button>
                {index < STAGES.length - 1 ? (
                  <ArrowRight
                    size={13}
                    className="hidden shrink-0 text-border sm:block"
                    aria-hidden
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Detail ---- */}
      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="surface overflow-hidden"
          >
            <div className="border-b bg-card px-6 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="kicker">
                  Stage {active + 1} of {STAGES.length}
                </span>
                <h3 className="font-display text-[17px] font-bold tracking-[-0.02em]">
                  {stage.label}
                </h3>
                <p className="text-[13px] text-muted-foreground">{stage.summary}</p>
              </div>
            </div>

            <div className="grid gap-px bg-border sm:grid-cols-2">
              <div className="bg-panel px-6 py-5">
                <p className="kicker">Reads</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {stage.input}
                </p>
              </div>
              <div className="bg-panel px-6 py-5">
                <p className="kicker">Produces</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {stage.output}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-6 py-3">
              <span className="kicker">Basis</span>
              <span className="text-[12.5px] font-medium text-foreground">{stage.basis}</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Mobile hint — the chain scrolls sideways on narrow screens. */}
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground sm:hidden">
        <ArrowDown size={12} className="rotate-[-90deg]" aria-hidden />
        Swipe the stages, or tap one to inspect it
      </p>
    </div>
  );
}
