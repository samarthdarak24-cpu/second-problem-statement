/**
 * Marketing visual assets — hand-authored SVG.
 *
 * Everything here is drawn from paths rather than shipped as a raster file, for
 * three reasons that all matter to this project:
 *
 *   1. It themes. The strokes and fills read from the same CSS custom properties
 *      as the rest of the interface, so a change to the palette cannot leave the
 *      illustrations stranded on the old colours.
 *   2. It scales. These render crisply at any size and on any DPR, which a
 *      2x PNG does not once it is stretched into a hero.
 *   3. It costs nothing. The whole set is a few kB of markup against megabytes of
 *      images, and there is no layout shift waiting on a decode.
 *
 * The climate chart is the exception to "illustrative": it is plotted from the
 * real monthly normals in `climate/stations.ts`, so what a visitor sees on the
 * landing page is the same data the engine will run on.
 */

import type { MonthlyClimate } from '@/types';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Maps a value in [min, max] onto a y coordinate, with padding. */
function makeScale(min: number, max: number, height: number, pad: number) {
  const span = max - min || 1;
  const usable = height - pad * 2;
  return (value: number) => pad + (1 - (value - min) / span) * usable;
}

function toPath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/* ------------------------------------------------------------------ */
/* Climate chart — real data                                           */
/* ------------------------------------------------------------------ */

export interface ClimateChartProps {
  monthly: MonthlyClimate[];
  /** Accessible label; also the tooltip title. */
  label: string;
  className?: string;
}

/**
 * Twelve months of temperature for one station.
 *
 * The daily min–max envelope is drawn as a filled band and the monthly mean as a
 * line through it. That is the honest way to draw this data: a single mean line
 * hides the fact that a hot-dry site swings 15 K between night and afternoon,
 * which is the single most important thing about it for a shelter design.
 */
export function ClimateChart({ monthly, label, className }: ClimateChartProps) {
  const width = 320;
  const height = 116;
  const padX = 6;
  const padY = 12;

  const all = monthly.flatMap((m) => [m.minTemp, m.maxTemp]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const y = makeScale(lo, hi, height, padY);

  const step = (width - padX * 2) / (monthly.length - 1 || 1);
  const xAt = (i: number) => padX + i * step;

  const upper = monthly.map((m, i) => [xAt(i), y(m.maxTemp)] as [number, number]);
  const lower = monthly.map((m, i) => [xAt(i), y(m.minTemp)] as [number, number]);
  const mean = monthly.map((m, i) => [xAt(i), y(m.avgTemp)] as [number, number]);

  const bandPath = `${toPath(upper)} ${toPath([...lower].reverse()).replace('M', 'L')} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`${label} — monthly temperature range`}
      preserveAspectRatio="none"
    >
      {/* Envelope between the mean daily minimum and maximum. */}
      <path d={bandPath} style={{ fill: 'hsl(var(--primary) / 0.13)' }} />
      {/* Mean temperature. */}
      <path
        d={toPath(mean)}
        fill="none"
        style={{ stroke: 'hsl(var(--primary))' }}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Freezing reference, only when the station actually crosses it. */}
      {lo < 0 ? (
        <line
          x1={padX}
          x2={width - padX}
          y1={y(0)}
          y2={y(0)}
          style={{ stroke: 'hsl(var(--muted-foreground) / 0.4)' }}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

/** Month initials under a chart, as HTML so the type is selectable and real. */
export function MonthAxis({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      {MONTH_INITIALS.map((initial, index) => (
        <span key={index} className="tabular-nums">
          {initial}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Envelope section                                                    */
/* ------------------------------------------------------------------ */

export interface WallSectionProps {
  className?: string;
}

/**
 * A horizontal cut through the shelter envelope.
 *
 * Not decoration: it is the diagram the whole project turns on. Every slider in
 * the design studio moves one of these layers, and the heat balance sums the
 * resistances they contribute. Showing it on the landing page tells a visitor
 * what the tool actually manipulates before they ever open it.
 */
export function WallSection({ className }: WallSectionProps) {
  const layers = [
    { w: 62, fill: 'hsl(var(--primary) / 0.85)', label: 'Rammed earth', note: '300 mm' },
    { w: 20, fill: 'hsl(var(--primary) / 0.35)', label: 'Insulation', note: '50 mm' },
    { w: 12, fill: 'hsl(var(--muted-foreground) / 0.3)', label: 'Render', note: '15 mm' },
  ];

  return (
    <svg
      viewBox="0 0 300 170"
      className={className}
      role="img"
      aria-label="Section through the shelter envelope showing the rammed earth wall, insulation and render"
    >
      {/* Interior volume */}
      <rect
        x="8"
        y="26"
        width="96"
        height="118"
        rx="3"
        style={{ fill: 'hsl(var(--card))', stroke: 'hsl(var(--border))' }}
        strokeWidth={1}
      />
      <text
        x="56"
        y="92"
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: 9, letterSpacing: '0.1em', fontWeight: 700 }}
      >
        INTERIOR
      </text>

      {/* Wall layers, left to right */}
      {(() => {
        let x = 104;
        return layers.map((layer) => {
          const el = (
            <g key={layer.label}>
              <rect x={x} y="18" width={layer.w} height="134" style={{ fill: layer.fill }} />
              <rect
                x={x}
                y="18"
                width={layer.w}
                height="134"
                fill="none"
                style={{ stroke: 'hsl(var(--border))' }}
                strokeWidth={1}
              />
            </g>
          );
          x += layer.w;
          return el;
        });
      })()}

      {/* Ground and sky hatch */}
      <rect x="8" y="144" width="284" height="18" style={{ fill: 'hsl(var(--muted))' }} />
      <line
        x1="8"
        y1="144"
        x2="292"
        y2="144"
        style={{ stroke: 'hsl(var(--border))' }}
        strokeWidth={1}
      />

      {/* Solar gain arrow, striking the outer face */}
      <g style={{ stroke: 'hsl(var(--warning))' }} strokeWidth={2} fill="none">
        <path d="M282 6 L252 34" />
        <path d="M252 34 L260 30 M252 34 L256 26" />
      </g>
      <text
        x="286"
        y="10"
        textAnchor="end"
        style={{ fill: 'hsl(var(--warning))', fontSize: 9, fontWeight: 700 }}
      >
        SOLAR
      </text>

      {/* Layer labels, staggered so they never collide at small sizes */}
      <text x="135" y="166" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 8.5 }}>
        300 mm earth
      </text>
      <text x="196" y="166" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 8.5 }}>
        50 mm
      </text>
      <text x="240" y="166" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 8.5 }}>
        render
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Sun path and shading                                                */
/* ------------------------------------------------------------------ */

/**
 * The solar geometry that drives the shading decision.
 *
 * The arc is the sun's path; the horizontal bar is an overhang, and the hatched
 * wedge is the band of the year it keeps off the glass. That wedge *is* the
 * passive cooling strategy, so it is the right thing to show.
 */
export function SunPath({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 170"
      className={className}
      role="img"
      aria-label="Sun path arc with a horizontal overhang shading a window in summer"
    >
      {/* Sky gradient as a flat warm wash */}
      <rect x="0" y="0" width="300" height="170" style={{ fill: 'hsl(var(--card))' }} />

      {/* Sun path arc, solstice to solstice */}
      <path
        d="M28 132 Q150 6 272 132"
        fill="none"
        style={{ stroke: 'hsl(var(--warning) / 0.75)' }}
        strokeWidth={2}
        strokeDasharray="5 4"
      />
      <path
        d="M44 132 Q150 46 256 132"
        fill="none"
        style={{ stroke: 'hsl(var(--warning) / 0.4)' }}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />

      {/* Sun */}
      <circle cx="150" cy="46" r="11" style={{ fill: 'hsl(var(--warning))' }} />
      <circle cx="150" cy="46" r="19" style={{ fill: 'hsl(var(--warning) / 0.16)' }} />

      {/* Building mass */}
      <rect x="150" y="96" width="86" height="60" style={{ fill: 'hsl(var(--muted))' }} />
      <rect
        x="150"
        y="96"
        width="86"
        height="60"
        fill="none"
        style={{ stroke: 'hsl(var(--border))' }}
      />
      {/* Glazing */}
      <rect x="152" y="112" width="10" height="40" style={{ fill: 'hsl(var(--thermal-2))' }} />

      {/* Overhang */}
      <rect x="120" y="90" width="42" height="7" rx="2" style={{ fill: 'hsl(var(--foreground))' }} />

      {/* The shaded wedge on the glass */}
      <path
        d="M120 97 L152 97 L152 132 Z"
        style={{ fill: 'hsl(var(--primary) / 0.22)' }}
      />

      {/* Incidence ray */}
      <line
        x1="141"
        y1="57"
        x2="120"
        y2="90"
        style={{ stroke: 'hsl(var(--warning))' }}
        strokeWidth={1.5}
      />

      {/* Ground */}
      <line
        x1="0"
        y1="156"
        x2="300"
        y2="156"
        style={{ stroke: 'hsl(var(--border))' }}
        strokeWidth={1}
      />

      <text x="14" y="24" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>
        SUMMER
      </text>
      <text x="14" y="40" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>
        NOON
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly heat balance                                                */
/* ------------------------------------------------------------------ */

/**
 * Gains against losses, month by month.
 *
 * Bars above the axis are heat entering the zone, below are heat leaving it. The
 * crossing points are when the design switches between needing cooling and
 * needing heating — which is the whole question a climate-responsive envelope
 * has to answer.
 */
export function BalanceChart({ className }: { className?: string }) {
  const width = 300;
  const height = 150;
  const zero = height * 0.5;

  /* A plausible composite-climate balance: gain-heavy in summer, loss-heavy in
     winter. Illustrative, and labelled as such — the real balance is on the
     Thermal Analysis page, computed for the actual design. */
  const gains = [8, 10, 16, 24, 30, 33, 32, 29, 24, 17, 10, 7];
  const losses = [26, 24, 19, 12, 7, 5, 5, 6, 10, 16, 22, 25];
  const slot = (width - 16) / gains.length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Monthly heat balance: solar and internal gains against conduction and ventilation losses"
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1={zero}
        x2={width}
        y2={zero}
        style={{ stroke: 'hsl(var(--border))' }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {gains.map((value, index) => {
        const g = (value / 34) * (zero - 10);
        const l = (losses[index]! / 34) * (zero - 10);
        const x = 8 + index * slot;
        return (
          <g key={index}>
            <rect
              x={x + 1}
              y={zero - g}
              width={slot - 2.5}
              height={g}
              rx={1.5}
              style={{ fill: 'hsl(var(--warning))' }}
            />
            <rect
              x={x + 1}
              y={zero}
              width={slot - 2.5}
              height={l}
              rx={1.5}
              style={{ fill: 'hsl(var(--primary) / 0.75)' }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

/**
 * The product mark.
 *
 * A thermometer inside a squared-off arch — the shape a section through a
 * shelter makes, and the measurement the whole tool exists to make. Drawn rather
 * than imported so it inherits `currentColor` and stays crisp at 16 px.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Thermal Shelter"
      fill="none"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      {/* Arch outline */}
      <path
        d="M9 24V14a7 7 0 0 1 14 0v10"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Stem */}
      <path
        d="M16 12.5v6.5"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Bulb */}
      <circle cx="16" cy="21.5" r="2.6" fill="hsl(var(--primary-foreground))" />
    </svg>
  );
}
