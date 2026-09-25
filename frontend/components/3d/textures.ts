/**
 * Procedural surface textures.
 *
 * WHY NOT DOWNLOADED TEXTURES
 * The obvious way to make the model look real is to fetch a CC0 PBR texture set
 * — albedo, normal, roughness, ambient occlusion — for brick, render and roof
 * sheet. That was considered and rejected, for three reasons that all point the
 * same way:
 *
 *   1. **The envelope is parametric.** A brick texture is authored at a fixed
 *      brick size in texels per metre. When the optimiser moves a wall from
 *      0.23 m to 0.45 m thick, or the type changes from blockwork to rammed
 *      earth, the pattern has to change with it or the picture lies about what
 *      is being built. A generated pattern can be told the scale; a downloaded
 *      one cannot.
 *
 *   2. **Five types × four material families is twenty texture sets**, each
 *      with three or four maps. That is tens of megabytes of binary in a
 *      repository whose entire 3D layer currently ships as code — and it is
 *      asset weight spent on detail that is invisible at the size this app
 *      draws buildings.
 *
 *   3. **It has to work offline.** The whole application is built to run with
 *      no network: the climatology is a local database, the solar engine is
 *      analytic, the fonts are system fonts. A renderer that silently degrades
 *      to flat colour without a CDN would be the one part that does not.
 *
 * So the surfaces are drawn, at runtime, into an offscreen canvas. They are
 * monochrome-ish patterns used as both `map` and `bumpMap`, tinted by the
 * material's own `color` — which is where the hue actually comes from. That
 * keeps the *physical* colour of a wall a property of the material library
 * rather than of a picture, which matters: `materials.ts` is where the
 * absorptance the thermal model uses is defined, and the renderer must not be
 * able to disagree with it about what colour a brick is.
 *
 * COST
 * One 256² canvas per surface kind, drawn once, cached for the life of the
 * page. Around a millisecond each, and they are only built when a mesh that
 * needs them is first rendered — a 2D plan view never creates one.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

export type SurfaceKind =
  /** Staggered brick courses with recessed mortar. */
  | 'masonry'
  /** Large blockwork / AAC, faint joints. */
  | 'block'
  /** Rammed earth or stone: horizontal compaction bands, no joints. */
  | 'earth'
  /** Fine cement render or plaster: almost pure speckle. */
  | 'render'
  /** Profiled metal sheet: shallow ribs. */
  | 'metal'
  /** Roof membrane / slab: granular, with a faint sheet joint. */
  | 'roof';

/**
 * Which pattern a wall material id should be drawn with.
 *
 * Kept here rather than on `MaterialProperties` because it is a *rendering*
 * concern: the thermal library describes what a wall does, and adding a texture
 * key to it would mean the physics module had to know about canvases. The
 * mapping is exhaustive over the wall palette, and an unknown id falls back to
 * the plainest surface rather than to nothing.
 */
export function wallSurfaceFor(materialId: string): SurfaceKind {
  switch (materialId) {
    case 'brick':
    case 'flyash-brick':
      return 'masonry';
    case 'hollow-block':
    case 'aac':
    case 'insulated-aac':
      return 'block';
    case 'rammed-earth':
    case 'stone':
      return 'earth';
    case 'rcc':
      return 'render';
    default:
      return 'render';
  }
}

/** Which pattern a roof material id should be drawn with. */
export function roofSurfaceFor(materialId: string): SurfaceKind {
  switch (materialId) {
    case 'metal-sheet':
    case 'puf-panel':
      return 'metal';
    case 'mud-phuska':
      return 'earth';
    default:
      return 'roof';
  }
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Texels per side. 256 is ~1 mm per texel across a 2 m tile. */
const SIZE = 256;

/**
 * Metres of wall covered by one tile.
 *
 * Two metres is chosen so that a brick course drawn as one of sixteen rows is
 * 125 mm — close enough to a real brick for the pattern to read correctly
 * beside a 2.1 m door, and coarse enough that the tiling is not visible on a
 * 16 m facade.
 */
export const TILE_METRES = 2;

const CACHE = new Map<SurfaceKind, THREE.CanvasTexture | null>();

/** Deterministic hash-based noise — no `Math.random`, so a texture is stable. */
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** A base fill of very slightly varying grey, so nothing is perfectly flat. */
function speckle(ctx: CanvasRenderingContext2D, seed: number, strength: number, step = 1): void {
  const image = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      /* Two octaves: a coarse blotch plus fine grain. A single octave reads as
         television static; two read as a material. */
      const coarse = hash(Math.floor(x / 7), Math.floor(y / 7), seed);
      const fine = hash(x, y, seed + 1);
      const v = 1 - strength * (0.6 * coarse + 0.4 * fine);
      const level = Math.round(255 * Math.max(0.55, Math.min(1, v)));
      image.data[i] = level;
      image.data[i + 1] = level;
      image.data[i + 2] = level;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  void step;
}

/** A recessed joint line, drawn as a soft dark band rather than a hard rule. */
function joint(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  darkness: number,
): void {
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${darkness})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function draw(kind: SurfaceKind, ctx: CanvasRenderingContext2D): void {
  switch (kind) {
    case 'masonry': {
      /* 16 courses over 2 m → 125 mm, with staggered perpends. */
      speckle(ctx, 11, 0.22);
      const courses = 16;
      const course = SIZE / courses;
      for (let r = 0; r <= courses; r += 1) {
        const y = r * course;
        joint(ctx, 0, y, SIZE, y, 2.2, 0.2);
        /* Perpends, offset by half a brick on alternate courses. */
        const perpends = 8;
        const width = SIZE / perpends;
        const offset = r % 2 === 0 ? 0 : width / 2;
        for (let c = 0; c <= perpends; c += 1) {
          const x = c * width + offset;
          if (x > SIZE) continue;
          joint(ctx, x, y, x, y + course, 1.8, 0.16);
        }
      }
      break;
    }

    case 'block': {
      /* 4 courses of 2 blocks — 500 × 250 mm blocks. */
      speckle(ctx, 23, 0.16);
      const rows = 4;
      const rowHeight = SIZE / rows;
      for (let r = 0; r <= rows; r += 1) {
        joint(ctx, 0, r * rowHeight, SIZE, r * rowHeight, 2, 0.14);
        const offset = r % 2 === 0 ? 0 : SIZE / 4;
        for (let c = 0; c <= 2; c += 1) {
          const x = c * (SIZE / 2) + offset;
          if (x > SIZE) continue;
          joint(ctx, x, r * rowHeight, x, (r + 1) * rowHeight, 1.6, 0.11);
        }
      }
      break;
    }

    case 'earth': {
      /* Compaction bands: horizontal, irregular, no vertical joints — which is
         what actually distinguishes rammed earth from brickwork at a glance. */
      speckle(ctx, 37, 0.3, 2);
      for (let i = 0; i < 9; i += 1) {
        const y = (i + 0.5) * (SIZE / 9) + (hash(i, 3, 7) - 0.5) * 6;
        joint(ctx, 0, y, SIZE, y, 1.4 + hash(i, 9, 2) * 1.6, 0.09 + hash(i, 1, 4) * 0.07);
      }
      break;
    }

    case 'render': {
      speckle(ctx, 53, 0.14);
      break;
    }

    case 'metal': {
      /* Shallow standing seams every 250 mm. */
      speckle(ctx, 71, 0.07);
      const seams = 8;
      for (let i = 0; i <= seams; i += 1) {
        const x = i * (SIZE / seams);
        joint(ctx, x, 0, x, SIZE, 3, 0.12);
        joint(ctx, x + 3, 0, x + 3, SIZE, 1.4, 0.06);
      }
      break;
    }

    case 'roof':
    default: {
      speckle(ctx, 89, 0.26);
      /* A faint sheet joint, so a large flat roof is not one endless plane. */
      joint(ctx, 0, SIZE / 2, SIZE, SIZE / 2, 1.4, 0.07);
      break;
    }
  }
}

/**
 * The texture for a surface kind, built once and reused.
 *
 * Returns `null` when there is no DOM — which happens if this is ever reached
 * during a server render. Returning null rather than throwing means a mesh
 * simply renders with its flat material colour, so a missing canvas degrades
 * the *detail* and never the building.
 */
export function surfaceTexture(kind: SurfaceKind): THREE.CanvasTexture | null {
  const cached = CACHE.get(kind);
  if (cached !== undefined) return cached;

  if (typeof document === 'undefined') {
    CACHE.set(kind, null);
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    CACHE.set(kind, null);
    return null;
  }

  draw(kind, ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  /* Geometry UVs are in metres (see the UV generation in `roofGeometry` and the
     metre-based UVs ExtrudeGeometry produces for wall outlines), so the repeat
     is simply "one tile per TILE_METRES". */
  texture.repeat.set(1 / TILE_METRES, 1 / TILE_METRES);
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  CACHE.set(kind, texture);
  return texture;
}

/* ------------------------------------------------------------------ */
/* Ground and sky                                                      */
/* ------------------------------------------------------------------ */

/**
 * A radial ground texture: compacted earth at the building, fading out.
 *
 * The gradient matters more than the noise here. A single flat plane the size
 * of a football pitch reads as a sheet of paper, because nothing in the image
 * says how far away its edge is. Darkening toward the rim gives the ground a
 * horizon, which is what actually makes the building sit on it.
 */
let groundCache: THREE.CanvasTexture | null | undefined;

export function groundTexture(): THREE.CanvasTexture | null {
  if (groundCache !== undefined) return groundCache;
  if (typeof document === 'undefined') {
    groundCache = null;
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    groundCache = null;
    return null;
  }

  speckle(ctx, 131, 0.2);

  const gradient = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.04, SIZE / 2, SIZE / 2, SIZE / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.45, 'rgba(120,104,86,0.16)');
  gradient.addColorStop(1, 'rgba(86,74,60,0.5)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  groundCache = texture;
  return texture;
}

/**
 * How the sky is lit — four states, not a continuum.
 *
 * Four gradient textures instead of a per-frame blend because the sky is
 * redrawn only when the sun crosses a threshold, which means dragging the hour
 * slider costs nothing until it actually changes the light.
 */
export type SkyPhase = 'night' | 'twilight' | 'low-sun' | 'day';

export function skyPhaseFor(altitudeDeg: number): SkyPhase {
  if (altitudeDeg <= -6) return 'night';
  if (altitudeDeg <= 0) return 'twilight';
  if (altitudeDeg <= 12) return 'low-sun';
  return 'day';
}

/*
 * The sky is the one place a blue-grey appears in this application, and it is
 * not a palette violation: the interface's warm-stone scale governs the
 * interface. A zenith rendered amber at midday would not be a stylistic choice,
 * it would be a wrong picture — and this view exists to be believed. The hues
 * are kept muted and hazy so the render still sits beside the panels rather
 * than shouting at them.
 */
const SKY_STOPS: Record<SkyPhase, { zenith: string; horizon: string; sun: string }> = {
  night: { zenith: '#151310', horizon: '#2E2823', sun: '#4A423A' },
  twilight: { zenith: '#33302B', horizon: '#8A5A2C', sun: '#E08B3C' },
  'low-sun': { zenith: '#6F7F8A', horizon: '#E3A463', sun: '#FFD9A0' },
  day: { zenith: '#8FA8B8', horizon: '#EFE6D8', sun: '#FFF6DC' },
};

const SKY_CACHE = new Map<SkyPhase, THREE.CanvasTexture | null>();

/** The vertical gradient for a sky phase, drawn into a tall thin canvas. */
export function skyTexture(phase: SkyPhase): THREE.CanvasTexture | null {
  const cached = SKY_CACHE.get(phase);
  if (cached !== undefined) return cached;

  if (typeof document === 'undefined') {
    SKY_CACHE.set(phase, null);
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    SKY_CACHE.set(phase, null);
    return null;
  }

  const stops = SKY_STOPS[phase];
  /* Canvas y = 0 is the top of the image, which maps to the zenith once the
     texture is wrapped onto the inside of a sphere. */
  const gradient = ctx.createLinearGradient(0, 0, 0, SIZE);
  gradient.addColorStop(0, stops.zenith);
  gradient.addColorStop(0.62, stops.zenith);
  gradient.addColorStop(0.88, stops.horizon);
  gradient.addColorStop(1, stops.horizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  SKY_CACHE.set(phase, texture);
  return texture;
}

/** The sun's own colour for a phase, for the light and the disc. */
export function skySunColor(phase: SkyPhase): string {
  return SKY_STOPS[phase].sun;
}

/** The horizon tint, for fog and for the hemisphere light's ground colour. */
export function skyHorizonColor(phase: SkyPhase): string {
  return SKY_STOPS[phase].horizon;
}

