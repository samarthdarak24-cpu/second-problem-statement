/**
 * Parametric shelter geometry.
 *
 * Pure, renderer-agnostic description of the building: wall panels with their
 * openings, roof form, partitions and shading devices, plus every area and
 * volume the thermal model needs.
 *
 * This module is deliberately free of Three.js and of any React import. The 3D
 * layer turns this description into meshes; the thermal engine turns it into
 * areas and orientations. Neither imports the other, which is what keeps the
 * 3D model and the physics engine independent.
 *
 * Coordinate convention (building-local, before the orientation rotation):
 *   +X = the building's right,  +Z = the building's front,  +Y = up
 *   `width` spans X, `length` spans Z, `height` spans Y.
 *
 * World convention (after rotation):
 *   +X = East, −Z = North, +Z = South, −X = West
 *   The group is rotated by (180° − orientation) about Y, so the front wall's
 *   outward normal points at compass azimuth `orientation`.
 */

import type {
  BuildingParameters,
  FacadeWeights,
  FloorSlab,
  LocalWallId,
  ModuleJoint,
  Partition,
  ResolvedMaterials,
  RoofGeometry,
  ShadingDevice,
  ShelterGeometry,
  WallOpening,
  WallPanel,
} from '@/types';
import { clamp } from '@/lib/utils';
import { buildingType, clampFloors, type PartyWalls } from '@/lib/buildingTypes';
import { resolveFacadeWeights } from '@/lib/glazingBias';
import { MONTH_MID_DAY, normalizeDeg } from '@/utils/units';

/* ------------------------------------------------------------------ */
/* Opening placement constants                                         */
/* ------------------------------------------------------------------ */

const DOOR_WIDTH = 0.95;
const DOOR_HEIGHT = 2.1;
const MIN_WINDOW_WIDTH = 0.55;
const MAX_WINDOW_WIDTH = 2.6;
const TARGET_WINDOW_WIDTH = 1.5;
const WINDOW_SILL = 0.9;
const CORNER_MARGIN = 0.4;
const MIN_GAP = 0.25;
const VENT_HEIGHT = 0.4;
const VENT_DEPTH_OFFSET = 0.45;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface Span {
  start: number;
  end: number;
}

/** Remove reserved intervals (doorways) from a span. */
function subtractReserved(full: Span, reserved: Span[]): Span[] {
  let segments: Span[] = [full];
  for (const r of reserved) {
    const next: Span[] = [];
    for (const s of segments) {
      if (r.end <= s.start || r.start >= s.end) {
        next.push(s);
        continue;
      }
      if (r.start > s.start) next.push({ start: s.start, end: Math.min(r.start, s.end) });
      if (r.end < s.end) next.push({ start: Math.max(r.end, s.start), end: s.end });
    }
    segments = next;
  }
  return segments.filter((s) => s.end - s.start > 0.35);
}

/** Interpolate a cardinal-weighted facade preference to an arbitrary azimuth. */
function weightForAzimuth(weights: FacadeWeights, azimuthDeg: number): number {
  const az = normalizeDeg(azimuthDeg);
  const anchors: Array<[number, number]> = [
    [0, weights.north],
    [90, weights.east],
    [180, weights.south],
    [270, weights.west],
    [360, weights.north],
  ];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [a0, v0] = anchors[i]!;
    const [a1, v1] = anchors[i + 1]!;
    if (az >= a0 && az <= a1) {
      const t = (az - a0) / (a1 - a0);
      return v0 + (v1 - v0) * t;
    }
  }
  return weights.north;
}

/**
 * Place windows along a wall to reach a target glazed area, avoiding doorways.
 */
function placeWindows(
  wallLength: number,
  targetArea: number,
  windowHeight: number,
  reserved: Span[],
): WallOpening[] {
  if (targetArea <= 0.25 || wallLength <= 1) return [];

  const full: Span = {
    start: -wallLength / 2 + CORNER_MARGIN,
    end: wallLength / 2 - CORNER_MARGIN,
  };
  const segments = subtractReserved(full, reserved);
  if (segments.length === 0) return [];

  const totalSpan = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (totalSpan <= 0.5) return [];

  // How many windows does the target area imply at a comfortable width?
  const idealCount = Math.max(1, Math.round(targetArea / (TARGET_WINDOW_WIDTH * windowHeight)));
  // How many can physically fit with a minimum gap?
  const maxFit = Math.max(1, Math.floor(totalSpan / (MIN_WINDOW_WIDTH + MIN_GAP)));
  const count = Math.max(1, Math.min(idealCount, maxFit));

  const nominalWidth = clamp(
    targetArea / (count * windowHeight),
    MIN_WINDOW_WIDTH,
    MAX_WINDOW_WIDTH,
  );

  // Allocate windows across segments proportional to their length, at least one
  // per segment when the budget allows.
  const allocations = segments.map((s) => (s.end - s.start) / totalSpan);
  const counts = allocations.map((share) => Math.floor(count * share));
  let assigned = counts.reduce((a, b) => a + b, 0);
  // Hand out the remainder to the widest segments first.
  const order = segments
    .map((s, i) => ({ i, span: s.end - s.start }))
    .sort((a, b) => b.span - a.span);
  let cursor = 0;
  while (assigned < count && order.length > 0) {
    const target = order[cursor % order.length]!;
    counts[target.i] = (counts[target.i] ?? 0) + 1;
    assigned += 1;
    cursor += 1;
  }
  // Guarantee at least one window per usable segment when count allows.
  if (count >= segments.length) {
    counts.forEach((c, i) => {
      if (c === 0) {
        const donor = counts.findIndex((v) => v > 1);
        if (donor >= 0) {
          counts[donor] = (counts[donor] ?? 1) - 1;
          counts[i] = 1;
        }
      }
    });
  }

  const openings: WallOpening[] = [];
  segments.forEach((segment, index) => {
    const n = counts[index] ?? 0;
    if (n <= 0) return;
    const usable = segment.end - segment.start;
    const width = clamp(
      Math.min(nominalWidth, (usable - MIN_GAP * (n - 1)) / n),
      MIN_WINDOW_WIDTH,
      MAX_WINDOW_WIDTH,
    );
    const step = n > 1 ? (usable - width) / (n - 1) : 0;
    const firstX = n > 1 ? segment.start + width / 2 : (segment.start + segment.end) / 2;

    for (let i = 0; i < n; i += 1) {
      openings.push({
        x: firstX + i * step,
        y: WINDOW_SILL + windowHeight / 2,
        width,
        height: windowHeight,
        kind: 'window',
      });
    }
  });

  return openings;
}

/** High-level ventilation openings distributed along a wall. */
function placeVents(
  wallLength: number,
  totalArea: number,
  wallHeight: number,
  lowLevel: boolean,
): WallOpening[] {
  if (totalArea <= 0.15) return [];

  const width = 0.9;
  const count = clamp(Math.round(totalArea / (width * VENT_HEIGHT)), 1, 6);
  const usable = wallLength - CORNER_MARGIN * 2;
  const actualWidth = clamp(
    Math.min(width, (usable - MIN_GAP * (count - 1)) / count),
    0.35,
    1.2,
  );
  const step = count > 1 ? (usable - actualWidth) / (count - 1) : 0;
  const firstX = count > 1 ? -wallLength / 2 + CORNER_MARGIN + actualWidth / 2 : 0;

  // Stack ventilation draws cool air low and exhausts warm air high.
  const y = lowLevel
    ? VENT_DEPTH_OFFSET + VENT_HEIGHT / 2
    : wallHeight - VENT_DEPTH_OFFSET - VENT_HEIGHT / 2;

  return Array.from({ length: count }, (_, i) => ({
    x: firstX + i * step,
    y,
    width: actualWidth,
    height: VENT_HEIGHT,
    kind: 'vent' as const,
  }));
}

/* ------------------------------------------------------------------ */
/* Walls                                                               */
/* ------------------------------------------------------------------ */

interface WallSpec {
  id: LocalWallId;
  /** Length along the facade. */
  length: number;
  /** Local centre position. */
  position: [number, number, number];
  /** Outward-facing Y rotation, radians. */
  rotationY: number;
  /** Compass azimuth of the outward normal, degrees. */
  azimuth: number;
  /** Whether this facade faces the sky or a neighbour. */
  boundary: 'exterior' | 'party';
}

/**
 * The four facades, with party walls marked.
 *
 * A terrace unit is narrow at the front and deep, so `length` spans Z and the
 * two `length`-long facades are the ones it shares with its neighbours. Marking
 * them here — rather than filtering them out later — keeps one description of
 * the building that both the renderer and the physics engine read, so a party
 * wall can never be drawn as an exterior wall while being modelled as adiabatic.
 */
function wallSpecs(
  width: number,
  length: number,
  orientation: number,
  partyWalls: PartyWalls,
): WallSpec[] {
  const shared: LocalWallId[] =
    partyWalls === 'both' ? ['left', 'right'] : partyWalls === 'one' ? ['left'] : [];
  const boundaryFor = (id: LocalWallId): 'exterior' | 'party' =>
    shared.includes(id) ? 'party' : 'exterior';

  return [
    {
      id: 'front',
      length: width,
      position: [0, 0, length / 2],
      rotationY: 0,
      azimuth: normalizeDeg(orientation),
      boundary: boundaryFor('front'),
    },
    {
      id: 'right',
      length,
      position: [width / 2, 0, 0],
      rotationY: Math.PI / 2,
      azimuth: normalizeDeg(orientation - 90),
      boundary: boundaryFor('right'),
    },
    {
      id: 'back',
      length: width,
      position: [0, 0, -length / 2],
      rotationY: Math.PI,
      azimuth: normalizeDeg(orientation + 180),
      boundary: boundaryFor('back'),
    },
    {
      id: 'left',
      length,
      position: [-width / 2, 0, 0],
      rotationY: -Math.PI / 2,
      azimuth: normalizeDeg(orientation + 90),
      boundary: boundaryFor('left'),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Roof                                                                */
/* ------------------------------------------------------------------ */

function buildRoof(params: BuildingParameters): RoofGeometry {
  const { width, length, roofType, roofAngle, roofOverhang } = params;
  // The ridge follows the longer horizontal axis.
  const ridgeAxis: 'x' | 'z' = length >= width ? 'z' : 'x';
  const span = ridgeAxis === 'z' ? width : length;
  const angle = (roofAngle * Math.PI) / 180;

  let rise = 0;
  switch (roofType) {
    case 'gable':
    case 'hip':
      rise = (span / 2) * Math.tan(angle);
      break;
    case 'vaulted':
      rise = (span / 2) * Math.tan(angle) * 1.2;
      break;
    case 'shed':
      rise = span * Math.tan(angle);
      break;
    case 'flat':
    default:
      rise = 0;
      break;
  }

  return { type: roofType, rise, overhang: roofOverhang, ridgeAxis };
}

/**
 * Slope factor for a pitched roof: sloped surface length ÷ horizontal run.
 *
 * WHY THIS IS PER-TYPE
 * A gable roof rises over *half* the span (two opposing slopes meet at the
 * ridge); a shed roof rises over the *whole* span (one plane). Dividing the rise
 * by the half-span in both cases — which is what this function used to do —
 * therefore over-states a shed's area and under-states a gable's, and the error
 * runs in opposite directions. In a cold climate, where the optimiser is
 * choosing between a mono-pitch that collects winter sun and a gable that does
 * not, a 12 % area error is enough to decide the answer.
 *
 * The rise values themselves come from `buildRoof`; this only converts them to
 * the surface area they imply, so the geometry and the renderer stay in step.
 */
function roofSlopeFactor(roof: RoofGeometry, span: number): number {
  const { rise, type } = roof;
  if (type === 'flat' || rise <= 0 || span <= 0) return 1;

  /* Horizontal run over which the rise actually happens. */
  const run = type === 'shed' ? span : span / 2;
  return Math.sqrt(1 + (rise / run) ** 2);
}

/** Actual sloped roof surface area, m². */
function roofSurfaceArea(params: BuildingParameters, roof: RoofGeometry): number {
  const { width, length } = params;
  const { overhang, ridgeAxis, rise, type } = roof;

  const span = ridgeAxis === 'z' ? width : length;
  const spanWithOverhang = span + overhang * 2;
  const ridgeLength = (ridgeAxis === 'z' ? length : width) + overhang * 2;

  if (type === 'flat' || rise <= 0) {
    return spanWithOverhang * ridgeLength;
  }

  /* The overhang extends the plane, so it carries the same slope factor. */
  const base = spanWithOverhang * roofSlopeFactor(roof, span) * ridgeLength;
  // Hip ends add a little more surface than a plain gable.
  return type === 'hip' ? base * 1.05 : base;
}

/* ------------------------------------------------------------------ */
/* Partitions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Interior partitions, repeated on every storey.
 *
 * The layout is the same on each floor — the app is not a floor-plan editor —
 * but the partitions are emitted per level so that a three-storey block has
 * three times the internal mass of a single-storey one, which is what the
 * thermal model's partition-mass term expects. `y` carries the storey offset,
 * so the renderer needs no special case.
 */
function buildPartitions(params: BuildingParameters, floors: number): Partition[] {
  const { width, length, height, numRooms } = params;
  const rooms = Math.max(1, Math.round(numRooms));
  const partitions: Partition[] = [];
  if (rooms <= 1) return partitions;

  const cols = Math.max(1, Math.ceil(Math.sqrt(rooms)));
  const rows = Math.max(1, Math.ceil(rooms / cols));
  const innerWidth = width - params.wallThickness * 2;
  const innerLength = length - params.wallThickness * 2;
  const cellWidth = innerWidth / cols;
  const cellLength = innerLength / rows;
  const partitionThickness = 0.1;

  for (let level = 0; level < floors; level += 1) {
    const baseY = level * height;
    const suffix = floors > 1 ? `-f${level}` : '';

    // Vertical partitions between columns.
    for (let c = 1; c < cols; c += 1) {
      const x = -innerWidth / 2 + c * cellWidth;
      const doors: WallOpening[] = [];
      for (let r = 0; r < rows; r += 1) {
        const z = -innerLength / 2 + r * cellLength + cellLength / 2;
        doors.push({
          x: z,
          y: DOOR_HEIGHT / 2,
          width: 0.85,
          height: DOOR_HEIGHT,
          kind: 'door',
        });
      }
      partitions.push({
        id: `partition-v-${c}${suffix}`,
        position: [x, baseY, 0],
        length: innerLength,
        height,
        rotationY: Math.PI / 2,
        doorOpenings: doors,
        label: `Partition ${c}`,
      });
    }

    // Horizontal partitions between rows.
    for (let r = 1; r < rows; r += 1) {
      const z = -innerLength / 2 + r * cellLength;
      const doors: WallOpening[] = [];
      for (let c = 0; c < cols; c += 1) {
        const x = -innerWidth / 2 + c * cellWidth + cellWidth / 2;
        doors.push({
          x,
          y: DOOR_HEIGHT / 2,
          width: 0.85,
          height: DOOR_HEIGHT,
          kind: 'door',
        });
      }
      partitions.push({
        id: `partition-h-${r}${suffix}`,
        position: [0, baseY, z],
        length: innerWidth,
        height,
        rotationY: 0,
        doorOpenings: doors,
        label: `Partition ${r}`,
      });
    }
  }

  void partitionThickness;
  return partitions;
}

/* ------------------------------------------------------------------ */
/* Shading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shading devices, emitted once per storey.
 *
 * WHY PER STOREY
 * A projection at the top floor's window head shades the top floor and nothing
 * else. On a three-storey block that would leave the two floors below it in
 * full sun while the solar model credited the whole facade with shading — the
 * exact kind of quiet mismatch between the picture and the physics this module
 * exists to prevent. Windows carry their storey in `y`, so the level is
 * recovered rather than passed in.
 *
 * Party walls are skipped: they have no sky to be shaded from.
 */
function buildShading(
  params: BuildingParameters,
  walls: WallPanel[],
  roof: RoofGeometry,
): ShadingDevice[] {
  const { shadingType, shadingDepth, height } = params;
  if (shadingType === 'none' || shadingDepth <= 0) return [];

  const devices: ShadingDevice[] = [];
  const storeyHeight = Math.max(0.5, height);

  for (const wall of walls) {
    if (wall.boundary === 'party') continue;

    const windows = wall.openings.filter((o) => o.kind === 'window');
    if (windows.length === 0) continue;

    const byLevel = new Map<number, WallOpening[]>();
    for (const w of windows) {
      const level = Math.max(0, Math.floor(w.y / storeyHeight));
      const list = byLevel.get(level);
      if (list) list.push(w);
      else byLevel.set(level, [w]);
    }

    for (const [level, levelWindows] of byLevel) {
      const suffix = level > 0 ? `-f${level}` : '';
      const headY = Math.max(...levelWindows.map((w) => w.y + w.height / 2));
      const levelTop = (level + 1) * storeyHeight;

      switch (shadingType) {
        case 'overhang': {
          devices.push({
            id: `overhang-${wall.id}${suffix}`,
            facade: wall.id,
            kind: 'overhang',
            depth: shadingDepth,
            y: headY + 0.12,
            span: wall.length - 0.2,
            x: 0,
          });
          break;
        }
        case 'deep-verandah': {
          devices.push({
            id: `verandah-${wall.id}${suffix}`,
            facade: wall.id,
            kind: 'verandah',
            depth: Math.max(shadingDepth, 1.4),
            y: levelTop - 0.15,
            span: wall.length + roof.overhang * 2,
            x: 0,
          });
          break;
        }
        case 'louvre': {
          for (const [index, w] of levelWindows.entries()) {
            devices.push({
              id: `louvre-${wall.id}${suffix}-${index}`,
              facade: wall.id,
              kind: 'louvre',
              depth: shadingDepth,
              y: w.y + w.height / 2 + 0.1,
              span: w.width + 0.15,
              x: w.x,
              slats: 5,
              tilt: 30,
            });
          }
          break;
        }
        case 'external-blind': {
          for (const [index, w] of levelWindows.entries()) {
            devices.push({
              id: `blind-${wall.id}${suffix}-${index}`,
              facade: wall.id,
              kind: 'blind',
              depth: 0.08,
              y: w.y + w.height / 2,
              span: w.width + 0.12,
              x: w.x,
            });
          }
          break;
        }
        case 'combined': {
          devices.push({
            id: `overhang-${wall.id}${suffix}`,
            facade: wall.id,
            kind: 'overhang',
            depth: shadingDepth,
            y: headY + 0.12,
            span: wall.length - 0.2,
            x: 0,
          });
          // Vertical fins at the outer edges of each window.
          for (const [index, w] of levelWindows.entries()) {
            for (const side of [-1, 1]) {
              devices.push({
                id: `fin-${wall.id}${suffix}-${index}-${side}`,
                facade: wall.id,
                kind: 'fin',
                depth: shadingDepth * 0.7,
                y: w.y,
                span: w.height,
                x: w.x + (side * (w.width + 0.06)) / 2,
              });
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return devices;
}

/* ------------------------------------------------------------------ */
/* Main builder                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the full parametric description of the shelter.
 *
 * One description feeds both the renderer and the physics engine, which is what
 * keeps the picture honest. Three things here are worth knowing about:
 *
 *   * **Storeys** scale the envelope and the conditioned floor area. A
 *     three-storey block of the same plan is a taller box: the same perimeter
 *     wall area, the same roof, three times the floor area and volume. That is
 *     why `totalHeight` exists rather than the renderer reaching for
 *     `parameters.height`, which is only one storey.
 *
 *   * **Party walls** are built, costed and counted as thermal mass, but carry
 *     no outdoor exposure — so they are excluded from `opaqueArea` (the UA
 *     numerator) while staying inside `wallArea`. Marking them here rather than
 *     in the thermal model means the engine needs no knowledge of building
 *     types at all.
 *
 *   * **Glazing** is only placed where there is sky, and is measured against
 *     the *exposed* facade area rather than the total — otherwise a terrace
 *     unit with two party walls would be given the same glass as a detached
 *     one and its window-to-wall ratio would be quietly halved.
 */
export function buildShelterGeometry(
  params: BuildingParameters,
  materials: ResolvedMaterials,
): ShelterGeometry {
  const template = buildingType(params.buildingType);
  const { width, length, height, wallThickness, orientation } = params;

  /* Clamped here as well as on write: this is the last point before the
     physics engine sees the building, so an illegal storey count — a
     three-storey vernacular shelter, say — must not be able to reach it. */
  const floors = clampFloors(params.buildingType, params.floors);
  const totalHeight = height * floors;

  const specs = wallSpecs(width, length, orientation, template.massing.partyWalls);
  const windowHeight = clamp(height * 0.45, 0.9, 2.1);

  // --- Gross areas -------------------------------------------------
  const totalWallArea = specs.reduce((sum, s) => sum + s.length * totalHeight, 0);
  const exposedSpecs = specs.filter((s) => s.boundary === 'exterior');
  const exposedGrossArea = exposedSpecs.reduce((sum, s) => sum + s.length * totalHeight, 0);

  /* The window-to-wall ratio is a statement about the facade you can see
     through, so its denominator is the exposed facade area. */
  const totalGlazingTarget =
    clamp(params.windowToWallRatio, 0, 0.8) * (exposedGrossArea || totalWallArea);

  // Distribute glazing by facade area × compass preference at the actual azimuth.
  const facadeWeights = resolveFacadeWeights(params);
  const weighted = exposedSpecs.map((s) => ({
    spec: s,
    weight: s.length * totalHeight * weightForAzimuth(facadeWeights, s.azimuth),
  }));
  const weightSum = weighted.reduce((sum, w) => sum + w.weight, 0) || 1;

  const walls: WallPanel[] = [];
  let totalGlazingArea = 0;

  for (const spec of specs) {
    const openings: WallOpening[] = [];
    const isParty = spec.boundary === 'party';

    if (!isParty) {
      const entry = weighted.find((w) => w.spec.id === spec.id);
      const glazingTarget = entry ? totalGlazingTarget * (entry.weight / weightSum) : 0;
      /* The facade's glazing budget is shared between its storeys, so raising
         the storey count does not multiply the glass. */
      const perStoreyTarget = glazingTarget / floors;

      for (let level = 0; level < floors; level += 1) {
        const baseY = level * height;
        const reserved: Span[] = [];

        // Entrance on the front wall, secondary door at the back. Ground floor
        // only — an upper-storey "main entrance" is a balcony.
        if (level === 0 && (spec.id === 'front' || spec.id === 'back')) {
          openings.push({
            x: 0,
            y: DOOR_HEIGHT / 2,
            width: DOOR_WIDTH,
            height: DOOR_HEIGHT,
            kind: 'door',
            label: spec.id === 'front' ? 'Main entrance' : 'Rear door',
          });
          reserved.push({
            start: -DOOR_WIDTH / 2 - 0.25,
            end: DOOR_WIDTH / 2 + 0.25,
          });
        }

        // Ventilation openings on the long facades, which face the prevailing
        // wind once the orientation search has placed them.
        const isVentilated = params.ventilationType !== 'sealed-mechanical';
        if (isVentilated && (spec.id === 'right' || spec.id === 'left')) {
          const totalVentArea = clamp(
            (width * length * height * params.airChangesPerHour * 0.0012) / 2,
            0.2,
            2.5,
          );
          /* Stack ventilation needs a low inlet and a high outlet, so the low
             opening belongs to the ground storey and the rest sit at each
             storey's own head height. */
          const lowLevel =
            params.ventilationType === 'stack-ventilation' && spec.id === 'left' && level === 0;
          openings.push(
            ...placeVents(spec.length, totalVentArea, height, lowLevel).map((o) => ({
              ...o,
              y: o.y + baseY,
            })),
          );
        }

        openings.push(
          ...placeWindows(spec.length, perStoreyTarget, windowHeight, reserved).map((o) => ({
            ...o,
            y: o.y + baseY,
          })),
        );
      }
    }

    const glazingArea = openings
      .filter((o) => o.kind === 'window')
      .reduce((sum, o) => sum + o.width * o.height, 0);
    totalGlazingArea += glazingArea;

    const grossArea = spec.length * totalHeight;
    const ventArea = openings
      .filter((o) => o.kind === 'vent')
      .reduce((sum, o) => sum + o.width * o.height, 0);
    const doorArea = openings
      .filter((o) => o.kind === 'door')
      .reduce((sum, o) => sum + o.width * o.height, 0);

    walls.push({
      id: spec.id,
      boundary: spec.boundary,
      length: spec.length,
      height: totalHeight,
      thickness: wallThickness,
      position: [spec.position[0], 0, spec.position[2]],
      rotationY: spec.rotationY,
      azimuth: spec.azimuth,
      openings,
      glazingArea,
      opaqueArea: Math.max(0, grossArea - glazingArea - ventArea - doorArea),
      grossArea,
      doorArea,
      ventArea,
    });
  }

  const roof = buildRoof(params);
  const roofArea = roofSurfaceArea(params, roof);
  const partitions = buildPartitions(params, floors);
  const shading = buildShading(params, walls, roof);

  const floorSlabs: FloorSlab[] = Array.from({ length: floors }, (_, level) => ({
    level,
    y: level * height,
    width,
    length,
  }));

  /* Module joints are drawn, not modelled: the seams between prefabricated bays
     do not change the envelope, so they must not change any area. */
  const moduleJoints: ModuleJoint[] =
    template.massing.modules > 1
      ? Array.from({ length: template.massing.modules - 1 }, (_, i) => ({
          offset: -length / 2 + ((i + 1) * length) / template.massing.modules,
        }))
      : [];

  const floorArea = width * length * floors;
  const volume = floorArea * height;

  const exposedWallArea = walls
    .filter((w) => w.boundary === 'exterior')
    .reduce((sum, w) => sum + w.grossArea, 0);
  const partyWallArea = walls
    .filter((w) => w.boundary === 'party')
    .reduce((sum, w) => sum + w.grossArea, 0);
  const opaqueWallArea = walls
    .filter((w) => w.boundary === 'exterior')
    .reduce((sum, w) => sum + w.opaqueArea, 0);

  // The facade carrying the most glazing — drives the solar visualisation.
  const primary = walls.reduce(
    (best, w) => (w.glazingArea > best.glazingArea ? w : best),
    walls[0]!,
  );

  void materials;
  void MONTH_MID_DAY;

  return {
    parameters: params,
    walls,
    roof,
    partitions,
    shading,
    floorSlabs,
    moduleJoints,
    floors,
    totalHeight,
    floorArea,
    volume,
    envelopeArea: exposedWallArea + roofArea,
    roofArea,
    groundFloorArea: width * length,
    glazingArea: totalGlazingArea,
    /* Door and vent areas are totalled here so the thermal model can give the
       door its own conductance. They are excluded from `opaqueArea` above, so
       without these totals the areas would simply vanish from the balance. */
    doorArea: walls.reduce((sum, w) => sum + w.doorArea, 0),
    ventArea: walls.reduce((sum, w) => sum + w.ventArea, 0),
    opaqueArea: opaqueWallArea + roofArea,
    wallArea: totalWallArea,
    exposedWallArea,
    partyWallArea,
    primaryGlazingAzimuth: primary.azimuth,
    footprint: (width + roof.overhang * 2) * (length + roof.overhang * 2),
  };
}

/**
 * Convenience: gross facade areas keyed by compass sector, for the wind rose
 * and solar overlays.
 */
export function facadeAzimuths(geometry: ShelterGeometry): Array<{
  id: LocalWallId;
  azimuth: number;
  glazingArea: number;
}> {
  return geometry.walls.map((w) => ({
    id: w.id,
    azimuth: w.azimuth,
    glazingArea: w.glazingArea,
  }));
}
