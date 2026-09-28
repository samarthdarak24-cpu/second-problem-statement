'use client';

/**
 * The scene around the building: sky, ground, fog and a person.
 *
 * WHY THIS IS SEPARATE FROM `SceneRig`
 * `SceneRig` owns the things that affect what the design *is* — the sun, the
 * camera, the walkthrough, the compass. Everything here affects only how it
 * *reads*. Splitting them means the Before/After thumbnails can render the
 * building on a plain background (five skies in a row is visual noise) while
 * the main viewport gets the full setting, without either importing the other's
 * concerns.
 *
 * WHY IT IS ALL GENERATED
 * No HDRI, no skybox image, no tree models. The sky is a canvas gradient, the
 * ground is a canvas gradient, the person is two primitives. That is a
 * deliberate trade: an imported HDRI would look better, and it would also make
 * the one view that has to be trustworthy depend on a file whose provenance the
 * user cannot check. See `textures.ts` for the full argument. What matters here
 * is the consequence — every value below is a number this codebase chose and
 * can explain, and the sun's position in the sky is the same NOAA solar
 * position the heat balance used.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  groundTexture,
  skyHorizonColor,
  skyPhaseFor,
  skySunColor,
  skyTexture,
} from './textures';

/* ------------------------------------------------------------------ */
/* Sun direction in world space                                        */
/* ------------------------------------------------------------------ */

/**
 * Unit vector **towards** the sun, in world coordinates.
 *
 * World convention, matching `utils/shelterGeometry.ts`: +X is East, −Z is
 * North, +Y is up. The building group carries its own rotation, so this is the
 * direction the sky and the ground plane are lit from — not the direction a
 * facade sees, which is what `localSunDirection` returns.
 */
export function worldSunDirection(altitudeDeg: number, azimuthDeg: number): THREE.Vector3 {
  const altitude = (altitudeDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(altitude);
  return new THREE.Vector3(
    horizontal * Math.sin(azimuth),
    Math.sin(altitude),
    -horizontal * Math.cos(azimuth),
  ).normalize();
}

/* ------------------------------------------------------------------ */
/* Sky                                                                 */
/* ------------------------------------------------------------------ */

export interface SkyDomeProps {
  /** Sun altitude in degrees; drives which of the four sky states is used. */
  altitude: number;
  /** Azimuth the sun sits at, degrees clockwise from north. */
  azimuth: number;
  /** Building radius — everything here is sized as a multiple of it. */
  radius: number;
}

/**
 * A gradient sky with a sun disc.
 *
 * The dome is a sphere rendered from the inside (`BackSide`) and is explicitly
 * excluded from fog, because fogging the sky would wash the horizon into the
 * ground colour and undo the one gradient that gives the image depth. The sun
 * is drawn as two spheres — a bright core and a wide dim halo — which is enough
 * to read as a sun and costs nothing, where a lens-flare or a bloom pass would
 * need a post-processing pipeline this scene has no other use for.
 */
export function SkyDome({ altitude, azimuth, radius }: SkyDomeProps) {
  const phase = skyPhaseFor(altitude);
  const texture = skyTexture(phase);
  const sunColor = skySunColor(phase);

  const direction = useMemo(() => worldSunDirection(altitude, azimuth), [altitude, azimuth]);

  const domeRadius = radius * 18;
  const sunDistance = radius * 14;
  const sunPosition: [number, number, number] = [
    direction.x * sunDistance,
    direction.y * sunDistance,
    direction.z * sunDistance,
  ];

  /* The disc is hidden below the horizon — a sun drawn under the ground plane
     is the single most common giveaway in a hand-built 3D scene. */
  const sunVisible = altitude > -2;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[domeRadius, 32, 24]} />
        <meshBasicMaterial
          map={texture ?? undefined}
          color={texture ? '#ffffff' : skyHorizonColor(phase)}
          side={THREE.BackSide}
          fog={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {sunVisible ? (
        <group position={sunPosition}>
          <mesh>
            <sphereGeometry args={[radius * 0.34, 16, 12]} />
            <meshBasicMaterial color={sunColor} fog={false} toneMapped={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[radius * 0.95, 16, 12]} />
            <meshBasicMaterial
              color={sunColor}
              fog={false}
              transparent
              opacity={0.16}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

export interface GroundPlaneProps {
  /** Half-extent of the site, in metres — the plane is drawn much larger. */
  extent: number;
}

/**
 * The site: a single disc of compacted earth.
 *
 * A disc rather than a square, because a square plane's corners are visible at
 * the grazing angles the orbit camera spends most of its time at, and a visible
 * corner says "this is a rendering" louder than anything else in the frame. The
 * radial gradient in the texture darkens the rim so the disc reads as a
 * horizon rather than as a cut-out.
 */
export function GroundPlane({ extent }: GroundPlaneProps) {
  const texture = groundTexture();
  const radius = extent * 7;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.19, 0]} receiveShadow>
      <circleGeometry args={[radius, 72]} />
      <meshStandardMaterial
        map={texture ?? undefined}
        color="#D8CFC2"
        roughness={0.98}
        metalness={0}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Fog                                                                 */
/* ------------------------------------------------------------------ */

export interface SceneFogProps {
  altitude: number;
  radius: number;
}

/**
 * Distance fog, tinted to the horizon.
 *
 * Without it the ground disc ends in a hard rim against the sky. The near plane
 * is placed well beyond the building so the fog never touches the envelope —
 * a fogged facade would soften exactly the edges the shading study exists to
 * show.
 */
export function SceneFog({ altitude, radius }: SceneFogProps) {
  const color = skyHorizonColor(skyPhaseFor(altitude));
  return <fog attach="fog" args={[color, radius * 3.2, radius * 22]} />;
}

/* ------------------------------------------------------------------ */
/* Human scale                                                         */
/* ------------------------------------------------------------------ */

export interface HumanScaleProps {
  /** Crown height, metres. */
  height?: number;
  position?: [number, number, number];
  /** Y-rotation so the figure faces the building rather than away from it. */
  rotationY?: number;
}

/**
 * A 1.75 m figure standing beside the entrance.
 *
 * WHY THIS IS IN THE MODEL AND NOT IN A LEGEND
 * Every other dimension in this application is a number the user has to read
 * and convert. "2.9 m floor-to-ceiling" is only meaningful next to something
 * whose height a person already knows in their body. One silhouette removes
 * that conversion step entirely, and it is the fastest way to make an
 * over-scaled shelter look over-scaled.
 *
 * Built from a capsule and a sphere. It is a scale reference, not a character —
 * at the sizes this is drawn, a detailed figure would be indistinguishable from
 * this one and would cost a model file to produce.
 */
export function HumanScale({ height = 1.75, position = [0, 0, 0], rotationY = 0 }: HumanScaleProps) {
  const geometry = useMemo(() => {
    const headRadius = height * 0.072;
    const torsoRadius = height * 0.085;

    /* Crown sits exactly at `height`: head top = centre + radius. */
    const headCentre = height - headRadius;
    const torsoTop = height - headRadius * 2 - height * 0.012;
    const torsoBottom = height * 0.03;
    const torsoLength = Math.max(0.2, torsoTop - torsoBottom - torsoRadius * 2);
    const torsoCentre = (torsoTop + torsoBottom) / 2;

    return {
      headRadius,
      torsoRadius,
      torsoLength,
      headCentre,
      torsoCentre,
    };
  }, [height]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, geometry.torsoCentre, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[geometry.torsoRadius, geometry.torsoLength, 6, 12]} />
        <meshStandardMaterial color="#4A423A" roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[0, geometry.headCentre, 0]} castShadow receiveShadow>
        <sphereGeometry args={[geometry.headRadius, 16, 12]} />
        <meshStandardMaterial color="#5A5148" roughness={0.8} metalness={0} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Ambient occlusion stand-in                                          */
/* ------------------------------------------------------------------ */

export interface GroundingShadowProps {
  /** Footprint to darken, metres. */
  width: number;
  length: number;
}

/**
 * A soft contact shadow under the building.
 *
 * The directional light's shadow map handles a sunlit building correctly, but
 * it goes out entirely at night and thins to nothing at a low sun — which is
 * precisely when a building is hardest to read against its ground. This is a
 * flat plane with a radial alpha gradient, so it darkens the footprint edge
 * without needing a second shadow pass, and it survives the sun going down.
 *
 * It is drawn *under* the ground plane's top surface so it cannot z-fight with
 * the slab, and it is excluded from shadow casting and receiving because it is
 * a shading trick, not geometry.
 */
export function GroundingShadow({ width, length }: GroundingShadowProps) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const created = new THREE.CanvasTexture(canvas);
    created.needsUpdate = true;
    return created;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.175, 0]}>
      <planeGeometry args={[width * 1.7, length * 1.7]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={0.75} />
    </mesh>
  );
}
