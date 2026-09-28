'use client';

/**
 * The parametric shelter model.
 *
 * This component is a pure projection of `ShelterGeometry` and
 * `ResolvedMaterials` onto Three.js meshes. It holds no design state and makes
 * no thermal decisions — move a slider, the geometry description changes, and
 * this re-renders. That is the whole contract that makes the 3D genuinely
 * parametric rather than a viewer.
 *
 * Memoisation matters here: every geometry is a `useMemo` keyed on the exact
 * values that define it, so dragging a slider that does not affect a wall (say,
 * roof pitch on a flat roof) does not rebuild the wall meshes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useFrame } from '@react-three/fiber';
import type {
  BuildingParameters,
  FloorSlab as FloorSlabType,
  LocalWallId,
  ResolvedMaterials,
  ShelterGeometry,
  VisualizationMode,
} from '@/types';
import {
  floorSlabGeometry,
  openingPlacement,
  parapetGeometry,
  partitionGeometry,
  roofGeometry,
  shadingBoxes,
  wallPanelGeometry,
} from './geometry';
import { buildingType } from '@/lib/buildingTypes';
import { thermalColor, valueToColor } from './palette';
import { roofSurfaceFor, surfaceTexture, wallSurfaceFor } from './textures';
import { DetailedFurniture } from './DetailedFurniture';
import { ModeVisualAnimations } from './ModeVisualAnimations';

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export type HeatSurfaceKey = LocalWallId | 'roof';

/**
 * How far the envelope parts travel at full explosion, metres.
 *
 * Large enough that a 100 mm build-up reads as a stack of separate layers from
 * the default isometric camera, small enough that the model still fits the
 * frame without the camera rig having to re-frame.
 */
export const EXPLODE_DISTANCE = 1.7;

/**
 * Emission colour used to mark the selected surface.
 *
 * A warm amber rather than an outline: an outline disappears when the surface
 * is flat-on to the camera, and an emissive tint survives every one of the data
 * maps because it multiplies the material's own colour instead of replacing it.
 */
const SELECTED_EMISSIVE = new THREE.Color('#f0a24a');

export interface ShelterModelProps {
  geometry: ShelterGeometry;
  materials: ResolvedMaterials;
  /** Active analysis/visualization mode (normal, heatmap, temperature, heatloss, heatflux, humidity, condensation, etc.) */
  mode?: VisualizationMode;
  /** Sun position angles for dynamic solar rendering */
  sunAltitude?: number;
  sunAzimuth?: number;
  /** Heat-map value per surface, only used when `heatMode` is on. */
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
  /** Display range for the heat map. */
  heatRange?: [number, number];
  /** Ramp selector so the same component can render solar or thermal maps. */
  heatRamp?: readonly string[];
  heatMode?: boolean;
  /** Roof tessellation — higher is smoother but heavier. Set by render quality. */
  roofSegments?: number;
  /** Dim the envelope so interior content reads through it. */
  transparent?: boolean;
  showRoof?: boolean;
  showPartitions?: boolean;
  showFurniture?: boolean;
  showGlazing?: boolean;
  showShading?: boolean;
  /** Hide walls facing the camera side — used by the section/plan views. */
  hiddenWalls?: LocalWallId[];
  /**
   * Explosion amount, 0–1. Each wall travels along its own outward normal, the
   * roof rises and the floor drops, so the assembly stack separates in place.
   */
  explode?: number;
  /**
   * A world-space clipping plane. When supplied, every envelope material is cut
   * by it and switched to double-sided so the cut face reads as a section
   * rather than as a hole.
   */
  clipPlane?: THREE.Plane | null;
  /** The surface the inspector is showing, drawn with a highlight outline. */
  selectedSurface?: HeatSurfaceKey | null;
  /** Called when a wall or the roof is clicked. */
  onSelectSurface?: (key: HeatSurfaceKey) => void;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export function ShelterModel({
  geometry,
  materials,
  mode,
  sunAltitude,
  sunAzimuth,
  surfaceHeat,
  heatRange = [0, 1],
  heatRamp,
  heatMode = false,
  roofSegments = 12,
  transparent = false,
  showRoof = true,
  showPartitions = true,
  showFurniture = false,
  showGlazing = true,
  showShading = true,
  hiddenWalls = [],
  explode = 0,
  clipPlane = null,
  selectedSurface = null,
  onSelectSurface,
}: ShelterModelProps) {
  const params = geometry.parameters;
  const hidden = useMemo(() => new Set(hiddenWalls), [hiddenWalls]);

  /* Clipping is applied per material, so the array identity has to be stable or
     every material recompiles on each render. */
  const clippingPlanes = useMemo(() => (clipPlane ? [clipPlane] : []), [clipPlane]);
  const sectioned = clipPlane !== null;
  /* A cut through a single-sided shell shows nothing but backfaces, so the
     section mode switches the envelope to double-sided. */
  const envelopeSide = sectioned ? THREE.DoubleSide : undefined;

  const targetOffset = Math.max(0, Math.min(1, explode)) * EXPLODE_DISTANCE;
  const [animOffset, setAnimOffset] = useState(targetOffset);
  const animRef = useRef({ val: targetOffset });

  useEffect(() => {
    gsap.to(animRef.current, {
      val: targetOffset,
      duration: 0.85,
      ease: 'power3.out',
      onUpdate: () => setAnimOffset(animRef.current.val),
    });
  }, [targetOffset]);

  /* The building group is rotated so the front facade's outward normal points at
     compass azimuth `orientation`. See utils/shelterGeometry.ts. */
  const groupRotation = useMemo(
    () => [0, ((180 - params.orientation) * Math.PI) / 180, 0] as [number, number, number],
    [params.orientation],
  );

  const template = useMemo(() => buildingType(params.buildingType), [params.buildingType]);
  const showParapet = template.massing.parapet;

  const wallColor = useMemo(
    () => new THREE.Color(materials.wall.color),
    [materials.wall.color],
  );
  const roofColor = useMemo(
    () => new THREE.Color(materials.roof.color),
    [materials.roof.color],
  );
  /* Party walls are built and costed but share a neighbour, so they carry no
     solar load and should never read as a sunny facade. A distinct slate keeps
     the "shared envelope" meaning visible in the model itself. */
  const partyColor = useMemo(() => new THREE.Color('#8b93a1'), []);

  /* Surface patterns, keyed to the material ids the thermal model resolved.
     Both are cached canvases, so switching a material back and forth costs a
     map lookup rather than a redraw. */
  const wallTexture = useMemo(
    () => surfaceTexture(wallSurfaceFor(params.wallMaterialId)),
    [params.wallMaterialId],
  );
  const roofTexture = useMemo(
    () => surfaceTexture(roofSurfaceFor(params.roofMaterialId)),
    [params.roofMaterialId],
  );

  const heatColorFor = (key: HeatSurfaceKey): THREE.Color => {
    const value = surfaceHeat?.[key];
    if (value === undefined) return thermalColor(0.5);
    return valueToColor(value, heatRange[0], heatRange[1], heatRamp);
  };

  return (
    <group rotation={groupRotation}>
      <FloorSlabs geometry={geometry} color={wallColor} drop={animOffset} clippingPlanes={clippingPlanes} side={envelopeSide} />
      {showPartitions && (
        <Partitions geometry={geometry} color={wallColor} clippingPlanes={clippingPlanes} side={envelopeSide} />
      )}

      {geometry.walls.map((wall) => {
        if (hidden.has(wall.id)) return null;
        const isParty = wall.boundary === 'party';
        return (
          <WallPanelMesh
            key={`${wall.id}-${wall.length}-${wall.height}-${wall.thickness}-${wall.openings.length}`}
            wall={wall}
            color={!isParty && heatMode ? heatColorFor(wall.id) : wallColor}
            partyColor={partyColor}
            roughness={materials.wall.roughness}
            metalness={materials.wall.metalness}
            texture={wallTexture}
            textured={!heatMode}
            showGlazing={showGlazing}
            transparent={transparent}
            showShading={showShading}
            shading={geometry.shading}
            explode={animOffset}
            clippingPlanes={clippingPlanes}
            side={envelopeSide}
            selected={selectedSurface === wall.id}
            onSelect={onSelectSurface}
          />
        );
      })}

      {showRoof && (
        <RoofMesh
          geometry={geometry}
          color={heatMode ? heatColorFor('roof') : roofColor}
          roughness={materials.roof.roughness}
          metalness={materials.roof.metalness}
          texture={roofTexture}
          textured={!heatMode}
          transparent={transparent}
          segments={roofSegments}
          lift={animOffset}
          clippingPlanes={clippingPlanes}
          side={envelopeSide}
          selected={selectedSurface === 'roof'}
          onSelect={onSelectSurface}
        />
      )}

      {showParapet && (
        <Parapet
          geometry={geometry}
          color={wallColor}
          lift={animOffset}
          clippingPlanes={clippingPlanes}
          side={envelopeSide}
        />
      )}

      <ModuleJoints geometry={geometry} color={partyColor} />

      {showFurniture && <DetailedFurniture geometry={geometry} />}

      {mode && (
        <ModeVisualAnimations
          mode={mode}
          geometry={geometry}
          surfaceHeat={surfaceHeat}
          sunAltitude={sunAltitude}
          sunAzimuth={sunAzimuth}
        />
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Floor slabs — one per storey                                        */
/* ------------------------------------------------------------------ */

function FloorSlabItem({
  slab,
  color,
  drop,
  clippingPlanes,
  side,
}: {
  slab: FloorSlabType;
  color: THREE.Color;
  /** Distance the slab travels downward in exploded mode. */
  drop: number;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
}) {
  /* The ground slab extends under the eaves so the building does not float; the
     intermediate slabs are strictly interior and need no overhang. */
  const overhang = slab.level === 0 ? 0.3 : 0;
  const geometry = useMemo(
    () => floorSlabGeometry(slab.width, slab.length, 0.18, overhang),
    [slab.width, slab.length, overhang],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      position={[0, slab.y - 0.09 - drop, 0]}
      receiveShadow
      castShadow
    >
      <meshStandardMaterial
        color={color.clone().multiplyScalar(0.55)}
        roughness={0.95}
        clippingPlanes={clippingPlanes}
        side={side}
      />
    </mesh>
  );
}

/**
 * One slab per storey. The renderer used to draw a single ground slab and let
 * the roof sit at `parameters.height` (one storey), so a three-storey block was
 * a one-storey box with a roof glued on at the wrong height. Drawing every
 * `geometry.floorSlabs` entry — at its own `y` — is what makes the building
 * read as genuinely multi-storey, and is what the plan/section views measure
 * their storey heights against.
 */
function FloorSlabs({
  geometry,
  color,
  drop,
  clippingPlanes,
  side,
}: {
  geometry: ShelterGeometry;
  color: THREE.Color;
  drop: number;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
}) {
  return (
    <group>
      {geometry.floorSlabs.map((slab) => (
        <FloorSlabItem
          key={slab.level}
          slab={slab}
          color={color}
          drop={drop}
          clippingPlanes={clippingPlanes}
          side={side}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Walls                                                               */
/* ------------------------------------------------------------------ */

interface WallPanelMeshProps {
  wall: ShelterGeometry['walls'][number];
  color: THREE.Color;
  partyColor: THREE.Color;
  roughness: number;
  metalness: number;
  /** Procedural surface pattern, or null when no canvas was available. */
  texture: THREE.Texture | null;
  /**
   * Whether the pattern should be drawn at all.
   *
   * False in heat-map mode. A heat map is a data display, and a brick pattern
   * underneath it changes the apparent value of every texel — the legend and
   * the surface would then disagree about what "orange" means, which is exactly
   * what `palette.ts` exists to prevent.
   */
  textured: boolean;
  showGlazing: boolean;
  transparent: boolean;
  showShading: boolean;
  shading: ShelterGeometry['shading'];
  /** Distance to travel along the wall's own outward normal. */
  explode: number;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
  selected: boolean;
  onSelect: ((key: HeatSurfaceKey) => void) | undefined;
}

function WallPanelMesh({
  wall,
  color,
  partyColor,
  roughness,
  metalness,
  texture,
  textured,
  showGlazing,
  transparent,
  showShading,
  shading,
  explode,
  clippingPlanes,
  side,
  selected,
  onSelect,
}: WallPanelMeshProps) {
  const isParty = wall.boundary === 'party';
  /* Party walls are adiabatic in the physics and must not read as a sunlit
     facade in the picture, so they keep their distinct slate regardless of the
     heat map. */
  const fillColor = isParty ? partyColor : color;
  /* Key the memo on the opening geometry, not the array identity: the geometry
     builder returns a fresh array on every store update even when nothing about
     this wall changed. */
  const openingSignature = wall.openings
    .map((o) => `${o.kind}:${o.x.toFixed(3)}:${o.y.toFixed(3)}:${o.width.toFixed(3)}:${o.height.toFixed(3)}`)
    .join('|');

  const shell = useMemo(
    () => wallPanelGeometry(wall),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wall.length, wall.height, wall.thickness, openingSignature],
  );
  useEffect(() => () => shell.dispose(), [shell]);

  const devices = useMemo(
    () => (showShading ? shading.filter((d) => d.facade === wall.id) : []),
    [shading, wall.id, showShading],
  );

  const glassColor = useMemo(() => new THREE.Color('#A3B0A4'), []);

  /* The panel is extruded along its local +Z, which is also its outward normal,
     so the explosion is a translation along +Z in the wall's own frame. Doing
     it here rather than in world space means every wall leaves along its own
     normal without the caller having to know each facade's rotation. */
  const explodedPosition: [number, number, number] = [
    wall.position[0] + Math.sin(wall.rotationY) * explode,
    wall.position[1],
    wall.position[2] + Math.cos(wall.rotationY) * explode,
  ];

  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (matRef.current) {
      matRef.current.color.lerp(fillColor, Math.min(1, delta * 7.5));
    }
  });

  return (
    <group position={explodedPosition} rotation={[0, wall.rotationY, 0]}>
      <mesh
        geometry={shell}
        castShadow
        receiveShadow
        onClick={
          onSelect
            ? (event) => {
                /* Stop the click reaching whatever is behind the wall, so
                   picking a facade cannot also select the far side. */
                event.stopPropagation();
                onSelect(wall.id);
              }
            : undefined
        }
      >
        <meshStandardMaterial
          ref={matRef}
          color={fillColor}
          map={textured ? (texture ?? undefined) : undefined}
          bumpMap={textured ? (texture ?? undefined) : undefined}
          bumpScale={0.014}
          roughness={roughness}
          metalness={isParty ? 0.1 : metalness}
          transparent={transparent && !isParty}
          opacity={transparent ? 0.32 : 1}
          clippingPlanes={clippingPlanes}
          side={side}
          /* The selection reads as a lift in the material's own emission rather
             than as an outline, so it survives being heat-mapped. */
          emissive={selected ? SELECTED_EMISSIVE : undefined}
          emissiveIntensity={selected ? 0.32 : 0}
        />
        {!textured && !isParty && (
          <lineSegments>
            <wireframeGeometry args={[shell]} />
            <lineBasicMaterial color="#ffffff" opacity={0.22} transparent />
          </lineSegments>
        )}
      </mesh>

      {showGlazing &&
        wall.openings.map((opening) => {
          const placement = openingPlacement(opening);
          const isGlass = opening.kind === 'window';
          const isDoor = opening.kind === 'door';
          const key = `${opening.kind}-${opening.x.toFixed(3)}-${opening.y.toFixed(3)}`;

          if (isGlass) {
            return (
              <mesh
                key={key}
                position={placement.position}
                castShadow={false}
                receiveShadow={false}
              >
                <boxGeometry args={[placement.size[0], placement.size[1], 0.02]} />
                <meshPhysicalMaterial
                  color={glassColor}
                  transparent
                  opacity={0.42}
                  roughness={0.05}
                  metalness={0}
                  transmission={0.85}
                  thickness={0.05}
                  ior={1.45}
                  clippingPlanes={clippingPlanes}
                />
              </mesh>
            );
          }

          if (isDoor) {
            return (
              <mesh key={key} position={[opening.x, opening.height / 2, 0]} castShadow>
                <boxGeometry args={[opening.width, opening.height, 0.05]} />
                <meshStandardMaterial color="#6b4a2f" roughness={0.7} clippingPlanes={clippingPlanes} />
              </mesh>
            );
          }

          /* Vent openings stay open — that is the point of them. A dark recess
             reads better than a solid panel. Warm dark rather than the old
             blue-black, so the recess belongs to the same family as the
             terracotta envelope it is cut into. */
          return (
            <mesh key={key} position={placement.position}>
              <boxGeometry args={[placement.size[0], placement.size[1], 0.06]} />
              <meshStandardMaterial color="#2A211B" roughness={1} clippingPlanes={clippingPlanes} />
            </mesh>
          );
        })}

      {devices.map((device) =>
        shadingBoxes(device).map((box, index) => (
          <mesh
            key={`${device.id}-${index}`}
            position={box.position}
            rotation={box.rotation ?? [0, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial
              color={device.kind === 'verandah' ? '#8a8f96' : '#C9C0B4'}
              roughness={0.6}
              metalness={0.25}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        )),
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Roof                                                                */
/* ------------------------------------------------------------------ */

function RoofMesh({
  geometry,
  color,
  roughness,
  metalness,
  texture,
  textured,
  transparent,
  segments = 12,
  lift,
  clippingPlanes,
  side,
  selected,
  onSelect,
}: {
  geometry: ShelterGeometry;
  color: THREE.Color;
  roughness: number;
  metalness: number;
  texture: THREE.Texture | null;
  /** False in heat-map mode — see `WallPanelMeshProps.textured`. */
  textured: boolean;
  transparent: boolean;
  /** Roof tessellation, from render quality. */
  segments?: number;
  /** Distance the roof rises in exploded mode. */
  lift: number;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
  selected: boolean;
  onSelect: ((key: HeatSurfaceKey) => void) | undefined;
}) {
  const { width, length } = geometry.parameters;
  const { roof } = geometry;

  const shell = useMemo(
    () => roofGeometry({ roof, width, length, segments }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roof.type, roof.rise, roof.overhang, roof.ridgeAxis, width, length, segments],
  );

  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (matRef.current) {
      matRef.current.color.lerp(color, Math.min(1, delta * 7.5));
    }
  });

  return (
    <group position={[0, geometry.totalHeight + lift, 0]}>
      <mesh
        geometry={shell}
        castShadow
        receiveShadow
        onClick={
          onSelect
            ? (event) => {
                event.stopPropagation();
                onSelect('roof');
              }
            : undefined
        }
      >
        <meshStandardMaterial
          ref={matRef}
          color={color}
          map={textured ? (texture ?? undefined) : undefined}
          bumpMap={textured ? (texture ?? undefined) : undefined}
          bumpScale={0.012}
          roughness={roughness}
          metalness={metalness}
          side={side ?? THREE.DoubleSide}
          transparent={transparent}
          opacity={transparent ? 0.34 : 1}
          clippingPlanes={clippingPlanes}
          emissive={selected ? SELECTED_EMISSIVE : undefined}
          emissiveIntensity={selected ? 0.32 : 0}
        />
        {!textured && (
          <lineSegments>
            <wireframeGeometry args={[shell]} />
            <lineBasicMaterial color="#ffffff" opacity={0.22} transparent />
          </lineSegments>
        )}
      </mesh>
      {/* Photovoltaic Solar Array when solarPvKwp is configured */}
      {geometry.parameters.solarPvKwp > 0 && !transparent && (
        <group position={[0, 0.08, 0]}>
          {roof.type === 'flat' ? (
            Array.from({ length: 3 }).map((_, row) =>
              Array.from({ length: 4 }).map((__, col) => (
                <group
                  key={`pv-flat-${row}-${col}`}
                  position={[
                    (col - 1.5) * (width * 0.2),
                    0.15,
                    (row - 1) * (length * 0.22),
                  ]}
                  rotation={[-0.15, 0, 0]}
                >
                  {/* Solar Panel Frame */}
                  <mesh castShadow>
                    <boxGeometry args={[width * 0.17, 0.03, length * 0.18]} />
                    <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.8} />
                  </mesh>
                  {/* Photovoltaic Glass */}
                  <mesh position={[0, 0.02, 0]}>
                    <boxGeometry args={[width * 0.16, 0.01, length * 0.17]} />
                    <meshStandardMaterial color="#1e1b4b" emissive="#1e1b4b" emissiveIntensity={0.2} roughness={0.15} metalness={0.7} />
                  </mesh>
                </group>
              )),
            )
          ) : (
            Array.from({ length: 4 }).map((_, col) => (
              <group
                key={`pv-pitched-${col}`}
                position={[
                  (col - 1.5) * (width * 0.2),
                  roof.rise * 0.45 + 0.06,
                  length * 0.22,
                ]}
                rotation={[-Math.atan2(roof.rise, length / 2), 0, 0]}
              >
                <mesh castShadow>
                  <boxGeometry args={[width * 0.16, 0.03, length * 0.26]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.8} />
                </mesh>
                <mesh position={[0, 0.02, 0]}>
                  <boxGeometry args={[width * 0.15, 0.01, length * 0.25]} />
                  <meshStandardMaterial color="#1e1b4b" emissive="#1e1b4b" emissiveIntensity={0.2} roughness={0.15} metalness={0.7} />
                </mesh>
              </group>
            ))
          )}
        </group>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Parapet — low-rise signature                                        */
/* ------------------------------------------------------------------ */

function Parapet({
  geometry,
  color,
  lift,
  clippingPlanes,
  side,
}: {
  geometry: ShelterGeometry;
  color: THREE.Color;
  lift: number;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
}) {
  const { width, length } = geometry.parameters;
  const shell = useMemo(
    () => parapetGeometry(width, length, 0.8, 0.12),
    [width, length],
  );
  useEffect(() => () => shell.dispose(), [shell]);

  return (
    <mesh
      geometry={shell}
      position={[0, geometry.totalHeight + lift, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color.clone().multiplyScalar(0.92)}
        roughness={0.9}
        clippingPlanes={clippingPlanes}
        side={side}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Module joints — prefabricated bay seams                              */
/* ------------------------------------------------------------------ */

/**
 * The visible seams between prefabricated structural bays. They are drawn, not
 * modelled — they change nothing about the envelope that the physics engine
 * would care about — but without them a three-bay shelter looks like one solid
 * box and the "prefabricated" identity is lost.
 *
 * Each joint is a plane at `offset` along the length axis spanning the full
 * width and height, so it shows up as a vertical rib on the two long facades and
 * as a line across the roof. We render the two facade ribs; they are enough to
 * read the bays at every angle.
 */
function ModuleJoints({
  geometry,
  color,
}: {
  geometry: ShelterGeometry;
  color: THREE.Color;
}) {
  const { width, wallThickness } = geometry.parameters;
  if (geometry.moduleJoints.length === 0) return null;

  const halfX = width / 2 + wallThickness / 2 + 0.02;
  const height = geometry.totalHeight;

  return (
    <group>
      {geometry.moduleJoints.map((joint) => (
        <group key={`${joint.offset}`}>
          <mesh position={[-halfX, height / 2, joint.offset]} castShadow receiveShadow>
            <boxGeometry args={[0.05, height, 0.08]} />
            <meshStandardMaterial color={color.clone().multiplyScalar(0.8)} roughness={0.7} metalness={0.15} />
          </mesh>
          <mesh position={[halfX, height / 2, joint.offset]} castShadow receiveShadow>
            <boxGeometry args={[0.05, height, 0.08]} />
            <meshStandardMaterial color={color.clone().multiplyScalar(0.8)} roughness={0.7} metalness={0.15} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Partitions                                                          */
/* ------------------------------------------------------------------ */

function Partitions({
  geometry,
  color,
  clippingPlanes,
  side,
}: {
  geometry: ShelterGeometry;
  color: THREE.Color;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
}) {
  return (
    <group>
      {geometry.partitions.map((partition) => (
        <PartitionMesh
          key={partition.id}
          partition={partition}
          color={color}
          clippingPlanes={clippingPlanes}
          side={side}
        />
      ))}
    </group>
  );
}

function PartitionMesh({
  partition,
  color,
  clippingPlanes,
  side,
}: {
  partition: ShelterGeometry['partitions'][number];
  color: THREE.Color;
  clippingPlanes: THREE.Plane[];
  side: THREE.Side | undefined;
}) {
  const shell = useMemo(
    () => partitionGeometry(partition),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partition.length, partition.height, partition.doorOpenings.length, partition.id],
  );
  useEffect(() => () => shell.dispose(), [shell]);

  return (
    <mesh
      geometry={shell}
      position={partition.position}
      rotation={[0, partition.rotationY, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color.clone().multiplyScalar(0.82)}
        roughness={0.9}
        clippingPlanes={clippingPlanes}
        side={side}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Re-export for convenience                                           */
/* ------------------------------------------------------------------ */

export type { BuildingParameters };
