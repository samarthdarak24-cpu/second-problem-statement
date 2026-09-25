'use client';

/**
 * 2D floor plan.
 *
 * Drawn to a `<canvas>` rather than rendered as SVG or as a top-down camera
 * view, because a plan is a *drawing*: it needs consistent line weights, real
 * poché for the wall thickness, dimension chains and text that does not scale
 * with zoom. A top-down 3D camera gives none of those.
 *
 * The drawing is resolution-independent: everything is computed in CSS pixels
 * and the backing store is scaled by `devicePixelRatio`, so the plan stays crisp
 * on a retina display without the layout maths changing.
 *
 * Plan convention: north is up, east is right. That is the surveyor's
 * convention, and it matches the compass rose in the 3D view.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalWallId, ShelterGeometry, WallOpening, WallPanel } from '@/types';

export interface FloorPlanCanvasProps {
  geometry: ShelterGeometry;
  showDimensions?: boolean;
  showLabels?: boolean;
  /** Draw the roof outline and shading devices as dashed overlays. */
  showShading?: boolean;
  className?: string;
}

/**
 * Wall poché fill, by surface role.
 *
 * Retuned for the light canvas: a plan is a drawing on paper, so the poché is
 * dark ink on a light ground rather than the inverse. `glass` was a blue
 * (#5aa9c9) from the old dark theme — blue is excluded from the palette, so
 * glazing is now a desaturated sage that still reads as a distinct material
 * against the warm stone poché.
 */
const COLORS = {
  wall: '#3F3833',
  partition: '#5C534C',
  opening: '#FFFFFF',
  glass: '#8FA79B',
  door: '#BD5224',
  vent: '#9A8F86',
  shading: '#B8AEA4',
  dimension: '#8A8078',
  text: '#3F3833',
  faint: '#D8D2CB',
} as const;

export function FloorPlanCanvas({
  geometry,
  showDimensions = true,
  showLabels = true,
  showShading = true,
  className,
}: FloorPlanCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });

  /* Track the container so the plan fills whatever space the layout gives it. */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bounds = useMemo(() => {
    const { width, length, roofOverhang } = geometry.parameters;
    const margin = Math.max(roofOverhang, 0.4) + 0.6;
    return {
      minX: -width / 2 - margin,
      maxX: width / 2 + margin,
      minZ: -length / 2 - margin,
      maxZ: length / 2 + margin,
    };
  }, [geometry.parameters]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.width * dpr));
    canvas.height = Math.max(1, Math.floor(size.height * dpr));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const planWidth = bounds.maxX - bounds.minX;
    const planDepth = bounds.maxZ - bounds.minZ;
    const scale = Math.min(size.width / planWidth, size.height / planDepth) * 0.92;

    const originX = (size.width - planWidth * scale) / 2 - bounds.minX * scale;
    const originY = (size.height - planDepth * scale) / 2 - bounds.minZ * scale;

    const toPx = (x: number): number => originX + x * scale;
    const toPy = (z: number): number => originY + z * scale;

    /* --- Roof outline, dashed, so the eaves read as an overlay ---------- */
    const overhang = geometry.parameters.roofOverhang;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = COLORS.faint;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      toPx(-geometry.parameters.width / 2 - overhang),
      toPy(-geometry.parameters.length / 2 - overhang),
      (geometry.parameters.width + overhang * 2) * scale,
      (geometry.parameters.length + overhang * 2) * scale,
    );
    ctx.restore();

    /* --- Shading devices, projecting outward from each facade ---------- */
    if (showShading) {
      ctx.save();
      ctx.fillStyle = 'rgba(184, 174, 164, 0.42)';
      ctx.strokeStyle = COLORS.shading;
      ctx.lineWidth = 1;
      for (const device of geometry.shading) {
        const wall = geometry.walls.find((w) => w.id === device.facade);
        if (!wall) continue;
        ctx.save();
        ctx.translate(toPx(wall.position[0]), toPy(wall.position[2]));
        ctx.rotate(-wall.rotationY);
        ctx.fillRect(
          (device.x - device.span / 2) * scale,
          0,
          device.span * scale,
          device.depth * scale,
        );
        ctx.strokeRect(
          (device.x - device.span / 2) * scale,
          0,
          device.span * scale,
          device.depth * scale,
        );
        ctx.restore();
      }
      ctx.restore();
    }

    /* --- Walls, with openings cut out --------------------------------- */
    for (const wall of geometry.walls) drawWall(ctx, wall, scale, toPx, toPy);

    /* --- Partitions ---------------------------------------------------- */
    for (const partition of geometry.partitions) {
      ctx.save();
      ctx.translate(toPx(partition.position[0]), toPy(partition.position[2]));
      ctx.rotate(-partition.rotationY);
      ctx.fillStyle = COLORS.partition;
      const t = 0.1 * scale;
      ctx.fillRect((-partition.length / 2) * scale, -t / 2, partition.length * scale, t);
      /* Doors read as gaps with a swing arc. */
      ctx.fillStyle = COLORS.opening;
      for (const door of partition.doorOpenings) {
        ctx.fillRect((door.x - door.width / 2) * scale, -t / 2 - 1, door.width * scale, t + 2);
      }
      ctx.restore();
    }

    /* --- Room labels --------------------------------------------------- */
    if (showLabels) {
      ctx.save();
      ctx.fillStyle = COLORS.text;
      ctx.font = '500 12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const { width, length, numRooms } = geometry.parameters;
      const rooms = Math.max(1, Math.round(numRooms));
      const cols = Math.max(1, Math.ceil(Math.sqrt(rooms)));
      const rows = Math.max(1, Math.ceil(rooms / cols));
      const cellWidth = (width - 0.46) / cols;
      const cellDepth = (length - 0.46) / rows;
      let index = 0;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (index >= rooms) break;
          const x = -width / 2 + 0.23 + cellWidth * (c + 0.5);
          const z = -length / 2 + 0.23 + cellDepth * (r + 0.5);
          ctx.fillText(`Room ${index + 1}`, toPx(x), toPy(z));
          index += 1;
        }
      }
      ctx.restore();
    }

    /* --- Dimension chains --------------------------------------------- */
    if (showDimensions) drawDimensions(ctx, geometry, toPx, toPy, size);

    /* --- North arrow --------------------------------------------------- */
    drawNorthArrow(ctx, size.width - 34, 34);
  }, [geometry, bounds, size, showDimensions, showLabels, showShading]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wall drawing                                                        */
/* ------------------------------------------------------------------ */

function drawWall(
  ctx: CanvasRenderingContext2D,
  wall: WallPanel,
  scale: number,
  toPx: (x: number) => number,
  toPy: (z: number) => number,
): void {
  ctx.save();
  ctx.translate(toPx(wall.position[0]), toPy(wall.position[2]));
  ctx.rotate(-wall.rotationY);

  const halfLength = (wall.length / 2) * scale;
  const halfThickness = (wall.thickness / 2) * scale;

  /* Poché. */
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(-halfLength, -halfThickness, halfLength * 2, halfThickness * 2);

  /* Openings, drawn as a break in the wall with a symbol for the type. */
  for (const opening of wall.openings) {
    const x = (opening.x - opening.width / 2) * scale;
    const w = opening.width * scale;

    ctx.fillStyle = COLORS.opening;
    ctx.fillRect(x, -halfThickness - 1, w, halfThickness * 2 + 2);

    ctx.lineWidth = 1.5;
    if (opening.kind === 'window') {
      /* Two parallel lines across the opening — the standard plan symbol. */
      ctx.strokeStyle = COLORS.glass;
      ctx.beginPath();
      ctx.moveTo(x, -halfThickness * 0.45);
      ctx.lineTo(x + w, -halfThickness * 0.45);
      ctx.moveTo(x, halfThickness * 0.45);
      ctx.lineTo(x + w, halfThickness * 0.45);
      ctx.stroke();
    } else if (opening.kind === 'door') {
      /* Leaf plus swing arc. */
      ctx.strokeStyle = COLORS.door;
      ctx.beginPath();
      ctx.moveTo(x, halfThickness);
      ctx.lineTo(x, halfThickness + w);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, halfThickness, w, 0, Math.PI / 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = COLORS.vent;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

function drawDimensions(
  ctx: CanvasRenderingContext2D,
  geometry: ShelterGeometry,
  toPx: (x: number) => number,
  toPy: (z: number) => number,
  size: { width: number; height: number },
): void {
  const { width, length, height, roofOverhang } = geometry.parameters;
  const offset = Math.max(roofOverhang, 0.4) + 0.35;

  ctx.save();
  ctx.strokeStyle = COLORS.dimension;
  ctx.fillStyle = COLORS.dimension;
  ctx.lineWidth = 1;
  ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /* Overall width, below the plan. */
  const y = toPy(length / 2 + offset);
  if (y < size.height - 6) {
    line(ctx, toPx(-width / 2), y, toPx(width / 2), y);
    tick(ctx, toPx(-width / 2), y);
    tick(ctx, toPx(width / 2), y);
    ctx.fillText(`${width.toFixed(1)} m`, toPx(0), y + 11);
  }

  /* Overall depth, to the right. */
  const x = toPx(width / 2 + offset);
  if (x < size.width - 6) {
    line(ctx, x, toPy(-length / 2), x, toPy(length / 2));
    tick(ctx, x, toPy(-length / 2));
    tick(ctx, x, toPy(length / 2));
    ctx.save();
    ctx.translate(x + 12, toPy(0));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${length.toFixed(1)} m`, 0, 0);
    ctx.restore();
  }

  /* Wall thickness note. */
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.text;
  ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(
    `Walls ${Math.round(geometry.parameters.wallThickness * 1000)} mm · ceiling ${height.toFixed(2)} m`,
    12,
    size.height - 14,
  );

  /* Orientation note — the building is rotated, so the plan must say so. */
  ctx.textAlign = 'right';
  ctx.fillText(
    `Front facade faces ${Math.round(geometry.parameters.orientation)}° · north up`,
    size.width - 12,
    size.height - 14,
  );

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 4);
  ctx.lineTo(x + 4, y + 4);
  ctx.stroke();
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#e0553a';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(-7, 10);
  ctx.lineTo(0, 5);
  ctx.lineTo(7, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, 22);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Legend helpers used by the parent panel                             */
/* ------------------------------------------------------------------ */

export const PLAN_LEGEND: Array<{ id: string; label: string; color: string }> = [
  { id: 'wall', label: 'Wall', color: COLORS.wall },
  { id: 'partition', label: 'Partition', color: COLORS.partition },
  { id: 'window', label: 'Window', color: COLORS.glass },
  { id: 'door', label: 'Door', color: COLORS.door },
  { id: 'vent', label: 'Vent', color: COLORS.vent },
  { id: 'shading', label: 'Shading', color: COLORS.shading },
];

/** Wall identifiers in the order a reader walks the plan. */
export const WALL_ORDER: LocalWallId[] = ['front', 'right', 'back', 'left'];

export type { WallOpening };

export default FloorPlanCanvas;
