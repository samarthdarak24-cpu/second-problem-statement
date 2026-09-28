/**
 * Parametric geometry builders.
 *
 * Turns the renderer-agnostic `ShelterGeometry` description into Three.js
 * `BufferGeometry`. Everything here is a pure function of the description, so
 * the same input always produces the same mesh and nothing depends on React,
 * the store, or the render loop.
 *
 * WHY NOT A GLB
 * The brief is explicit that the building must be parametric rather than a fixed
 * model. Walls are built by extruding a 2D outline with real holes cut for every
 * window, door and vent, so changing the window-to-wall ratio changes the actual
 * mesh topology — not just a texture or a scale factor. The roof is a sampled
 * height field, so switching from flat to gable to vaulted produces genuinely
 * different surfaces from the same code path.
 *
 * COORDINATE CONVENTION
 * Building-local: +X right, +Z front, +Y up. Each wall panel is a group rotated
 * by `rotationY` and placed at `position`, so a shading device or a pane of glass
 * can be positioned in the wall's own frame and inherit that transform.
 */

import * as THREE from 'three';
import type {
  Partition,
  RoofGeometry,
  ShadingDevice,
  WallOpening,
  WallPanel,
} from '@/types';

/** Invisible lift applied to door sills so a hole never touches the outline. */
const SILL_EPSILON = 0.01;

/* ------------------------------------------------------------------ */
/* Walls                                                               */
/* ------------------------------------------------------------------ */

/**
 * Extrude a wall panel outline with every opening cut out of it.
 *
 * Door openings reach the floor, which would make a hole coincident with the
 * shape's own boundary — earcut triangulation handles that badly and produces
 * slivers. The sill is therefore lifted by 10 mm, which is invisible at any
 * realistic viewing distance and keeps the triangulation well conditioned.
 */
export function wallPanelGeometry(wall: WallPanel): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const halfLength = wall.length / 2;

  shape.moveTo(-halfLength, 0);
  shape.lineTo(halfLength, 0);
  shape.lineTo(halfLength, wall.height);
  shape.lineTo(-halfLength, wall.height);
  shape.closePath();

  for (const opening of wall.openings) {
    const x0 = opening.x - opening.width / 2;
    const x1 = opening.x + opening.width / 2;
    const y0 = Math.max(SILL_EPSILON, opening.y - opening.height / 2);
    const y1 = Math.min(wall.height - SILL_EPSILON, opening.y + opening.height / 2);
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) continue;

    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: wall.thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  /* ExtrudeGeometry grows along +Z from the outline plane; centre it so the wall
     straddles its own position and the outward face is at +thickness/2. */
  geometry.translate(0, 0, -wall.thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Local placement of a pane, door leaf or vent louvre inside its wall group. */
export interface OpeningPlacement {
  opening: WallOpening;
  position: [number, number, number];
  /** Size of the infill plane, metres. */
  size: [number, number];
}

export function openingPlacement(opening: WallOpening): OpeningPlacement {
  return {
    opening,
    position: [opening.x, opening.y, 0],
    size: [opening.width, opening.height],
  };
}

/* ------------------------------------------------------------------ */
/* Roof                                                                */
/* ------------------------------------------------------------------ */

export interface RoofGeometryOptions {
  roof: RoofGeometry;
  width: number;
  length: number;
  /** Shell thickness of the roof build-up, metres. */
  thickness?: number;
  /** Samples across the span and along the ridge. 12 is smooth enough at 4K. */
  segments?: number;
}

/**
 * Roof as a sampled height field, rendered as a closed shell.
 *
 * One function covers every roof form because they differ only in the height
 * function `h(u, v)`:
 *
 *   flat     h = 0
 *   shed     h = rise · (u + 1) / 2          monotonic fall across the span
 *   gable    h = rise · (1 − |u|)            ridge down the middle
 *   hip      h = rise · min(1 − |u|, (1 − |v|) / hipFraction)
 *   vaulted  h = rise · cos(uπ/2)            a barrel vault, not a plane
 *
 * Building it as a grid rather than as a handful of hand-placed triangles means
 * the vaulted roof is as easy as the flat one, and every form produces a proper
 * solid with a top surface, an underside and a fascia around the eaves.
 */
export function roofGeometry({
  roof,
  width,
  length,
  thickness = 0.18,
  segments = 12,
}: RoofGeometryOptions): THREE.BufferGeometry {
  const spanTotal = (roof.ridgeAxis === 'z' ? width : length) + roof.overhang * 2;
  const ridgeTotal = (roof.ridgeAxis === 'z' ? length : width) + roof.overhang * 2;
  const rise = Math.max(0, roof.rise);

  /* A hip's ridge is shorter than the building by one half-span at each end. */
  const hipFraction = Math.min(1, spanTotal / Math.max(1e-3, ridgeTotal));

  const heightAt = (u: number, v: number): number => {
    switch (roof.type) {
      case 'shed':
        return rise * ((u + 1) / 2);
      case 'gable':
        return rise * (1 - Math.abs(u));
      case 'hip': {
        const acrossSpan = 1 - Math.abs(u);
        const acrossRidge = hipFraction > 0 ? (1 - Math.abs(v)) / hipFraction : 0;
        return rise * Math.max(0, Math.min(acrossSpan, acrossRidge));
      }
      case 'vaulted':
        return rise * Math.cos((u * Math.PI) / 2);
      case 'flat':
      default:
        return 0;
    }
  };

  /** Point on the roof surface at normalised (u across span, v along ridge). */
  const pointAt = (u: number, v: number, drop: number): THREE.Vector3 => {
    const across = (u * spanTotal) / 2;
    const along = (v * ridgeTotal) / 2;
    const y = heightAt(u, v) - drop;
    return roof.ridgeAxis === 'z'
      ? new THREE.Vector3(across, y, along)
      : new THREE.Vector3(along, y, across);
  };

  const n = Math.max(2, Math.floor(segments));
  const stride = n + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  /*
   * UVs are written in *metres*, not normalised 0–1.
   *
   * The surface textures tile a fixed real-world size (see `textures.ts`), so a
   * metre-based UV makes one texture repeat cover the same distance on a 4 m
   * shelter and a 16 m block. Normalised UVs would stretch the pattern with the
   * building, and a brick would be four times the size on the larger one —
   * which is exactly the kind of quiet scale error that makes a render read as
   * a model rather than as a building.
   */
  const uvAt = (u: number, v: number): [number, number] => [
    ((u + 1) / 2) * spanTotal,
    ((v + 1) / 2) * ridgeTotal,
  ];

  /* Top surface. */
  for (let iv = 0; iv <= n; iv += 1) {
    for (let iu = 0; iu <= n; iu += 1) {
      const u = -1 + (2 * iu) / n;
      const v = -1 + (2 * iv) / n;
      const p = pointAt(u, v, 0);
      positions.push(p.x, p.y, p.z);
      const [tu, tv] = uvAt(u, v);
      uvs.push(tu, tv);
    }
  }
  /* Underside, offset by the roof thickness. */
  const bottomOffset = stride * stride;
  for (let iv = 0; iv <= n; iv += 1) {
    for (let iu = 0; iu <= n; iu += 1) {
      const u = -1 + (2 * iu) / n;
      const v = -1 + (2 * iv) / n;
      const p = pointAt(u, v, thickness);
      positions.push(p.x, p.y, p.z);
      const [tu, tv] = uvAt(u, v);
      uvs.push(tu, tv);
    }
  }

  for (let iv = 0; iv < n; iv += 1) {
    for (let iu = 0; iu < n; iu += 1) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;

      /* Top: wound so the normal points up. */
      indices.push(a, d, b, a, c, d);
      /* Underside: reverse winding so the normal points down. */
      indices.push(
        bottomOffset + a,
        bottomOffset + b,
        bottomOffset + d,
        bottomOffset + a,
        bottomOffset + d,
        bottomOffset + c,
      );
    }
  }

  /* Fascia around the eaves — closes the shell so the roof reads as a solid.
     Winding is left to chance and the material is double-sided, which keeps the
     lighting correct without a second pass of index bookkeeping. */
  const perimeter: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) perimeter.push([i, i + 1]); // v = -1 edge
  for (let i = 0; i < n; i += 1) perimeter.push([n * stride + i, n * stride + i + 1]); // v = +1
  for (let i = 0; i < n; i += 1) perimeter.push([i * stride, (i + 1) * stride]); // u = -1
  for (let i = 0; i < n; i += 1) perimeter.push([i * stride + n, (i + 1) * stride + n]); // u = +1

  for (const [p, q] of perimeter) {
    indices.push(p, q, bottomOffset + q, p, bottomOffset + q, bottomOffset + p);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Floor, partitions and site                                          */
/* ------------------------------------------------------------------ */

/** Ground slab, extending under the eaves so the building does not float. */
export function floorSlabGeometry(
  width: number,
  length: number,
  thickness = 0.15,
  overhang = 0.25,
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width + overhang * 2, thickness, length + overhang * 2);
}

/**
 * A parapet: a low perimeter wall standing above the roof line — the low-rise
 * signature, and the one massing cue that separates that type from a flat-roof
 * box at a glance.
 *
 * Built as an extruded rectangular *frame* (a footprint outline with a hole cut
 * out of it) rather than four separate boxes, so it reads as one continuous band
 * around the roof edge. Local frame: footprint `width`×`length` in the XZ plane,
 * height rising along +Y from 0 to `parapetHeight`. The caller positions it at
 * `totalHeight`, so the band sits on the wall head and rises a further
 * `parapetHeight` into the air — never below the roof, which would bury it.
 */
export function parapetGeometry(
  width: number,
  length: number,
  parapetHeight = 0.8,
  parapetThickness = 0.12,
): THREE.BufferGeometry {
  const halfWidth = Math.max(0.2, width / 2);
  const halfLength = Math.max(0.2, length / 2);

  const outer = new THREE.Shape();
  outer.moveTo(-halfWidth, -halfLength);
  outer.lineTo(halfWidth, -halfLength);
  outer.lineTo(halfWidth, halfLength);
  outer.lineTo(-halfWidth, halfLength);
  outer.closePath();

  const innerWidth = Math.max(0.05, halfWidth - parapetThickness);
  const innerLength = Math.max(0.05, halfLength - parapetThickness);
  const hole = new THREE.Path();
  hole.moveTo(-innerWidth, -innerLength);
  hole.lineTo(innerWidth, -innerLength);
  hole.lineTo(innerWidth, innerLength);
  hole.lineTo(-innerWidth, innerLength);
  hole.closePath();
  outer.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(outer, {
    depth: parapetHeight,
    bevelEnabled: false,
    curveSegments: 1,
  });
  /* ExtrudeGeometry grows the frame along +Z; rotate so the footprint lies in
     XZ and the height stands up in +Y starting at y = 0. */
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Interior partition panel with its doorways cut out. */
export function partitionGeometry(partition: Partition): THREE.BufferGeometry {
  const halfLength = partition.length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfLength, 0);
  shape.lineTo(halfLength, 0);
  shape.lineTo(halfLength, partition.height);
  shape.lineTo(-halfLength, partition.height);
  shape.closePath();

  const thickness = 0.1;
  for (const door of partition.doorOpenings) {
    const x0 = door.x - door.width / 2;
    const x1 = door.x + door.width / 2;
    const y0 = SILL_EPSILON;
    const y1 = Math.min(partition.height - SILL_EPSILON, door.y + door.height / 2);
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) continue;
    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Shading devices                                                     */
/* ------------------------------------------------------------------ */

/** A box in the wall's own frame, ready to be turned into a mesh. */
export interface ShadingBox {
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
}

/**
 * Decompose a shading device into boxes, in wall-local coordinates.
 *
 * The wall group already carries the panel's position and Y-rotation, so a
 * device only has to say where it sits relative to its own facade — projecting
 * outward along local +Z.
 */
export function shadingBoxes(device: ShadingDevice): ShadingBox[] {
  const boxes: ShadingBox[] = [];
  const halfSpan = device.span / 2;

  switch (device.kind) {
    case 'overhang':
      boxes.push({
        size: [device.span, 0.08, device.depth],
        position: [device.x, device.y, device.depth / 2],
      });
      break;

    case 'verandah': {
      boxes.push({
        size: [device.span, 0.12, device.depth],
        position: [device.x, device.y, device.depth / 2],
      });
      /* Two posts so the verandah does not float. */
      const postHeight = Math.max(0.5, device.y - 0.12);
      for (const side of [-1, 1]) {
        boxes.push({
          size: [0.14, postHeight, 0.14],
          position: [device.x + side * (halfSpan - 0.25), postHeight / 2, device.depth - 0.2],
        });
      }
      break;
    }

    case 'louvre': {
      const slats = Math.max(2, device.slats ?? 5);
      const bankHeight = 1.3;
      const pitch = bankHeight / slats;
      const tilt = ((device.tilt ?? 30) * Math.PI) / 180;
      for (let i = 0; i < slats; i += 1) {
        boxes.push({
          size: [device.span, 0.035, device.depth * 1.6],
          position: [device.x, device.y - i * pitch, device.depth * 0.8],
          rotation: [-tilt, 0, 0],
        });
      }
      break;
    }

    case 'blind':
      boxes.push({
        size: [device.span, 1.3, 0.035],
        position: [device.x, device.y - 0.65, device.depth / 2 + 0.06],
      });
      break;

    case 'fin':
      boxes.push({
        size: [0.06, device.span, device.depth],
        position: [device.x, device.y, device.depth / 2],
      });
      break;

    default:
      break;
  }

  return boxes;
}

/* ------------------------------------------------------------------ */
/* Solar position                                                      */
/* ------------------------------------------------------------------ */

/**
 * Direction **towards** the sun in building-local coordinates.
 *
 * The world convention is +X East, −Z North. The building group is rotated by
 * `180° − orientation`, so a world direction has to be rotated back into the
 * local frame before it can drive a local sun light.
 */
export function localSunDirection(
  altitudeDeg: number,
  azimuthDeg: number,
  orientationDeg: number,
): THREE.Vector3 {
  const altitude = (altitudeDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(altitude);

  /* World ENU: +X East, −Z North, +Y up. */
  const east = horizontal * Math.sin(azimuth);
  const north = horizontal * Math.cos(azimuth);
  const world = new THREE.Vector3(east, Math.sin(altitude), -north);

  const localRotation = ((180 - orientationDeg) * Math.PI) / 180;
  world.applyAxisAngle(new THREE.Vector3(0, 1, 0), -localRotation);
  return world.normalize();
}

/** Dispose a geometry safely — React may call cleanup before the GPU upload. */
export function disposeGeometry(geometry: THREE.BufferGeometry | null | undefined): void {
  geometry?.dispose();
}
