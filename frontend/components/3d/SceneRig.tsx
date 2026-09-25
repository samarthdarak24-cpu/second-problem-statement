'use client';

/**
 * Scene rig — lighting, site, compass, camera and walkthrough controls.
 *
 * Kept apart from `ShelterModel` so the building can be rendered in a test or a
 * thumbnail without dragging in controls and a render loop.
 *
 * The sun is not decorative. Its direction comes from the same NOAA solar
 * position engine the thermal model uses, so the shadows on screen are the
 * shadows the heat balance actually saw. Move the hour slider and the shading
 * devices demonstrate their own value.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraPreset, VisualizationMode } from '@/types';
import { localSunDirection } from './geometry';
import { skyColorForSun } from './palette';

/* ------------------------------------------------------------------ */
/* Sun and sky                                                         */
/* ------------------------------------------------------------------ */

export interface SunLightProps {
  altitude: number;
  azimuth: number;
  orientation: number;
  /** Site radius, used to place the shadow camera tightly around the building. */
  radius: number;
  /** Shadow map resolution — driven by the render-quality setting. */
  shadowMapSize?: number;
}

export function SunLight({ altitude, azimuth, orientation, radius, shadowMapSize = 2048 }: SunLightProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  const direction = useMemo(
    () => localSunDirection(Math.max(-5, altitude), azimuth, orientation),
    [altitude, azimuth, orientation],
  );

  const isDaylight = altitude > 0;
  const intensity = isDaylight ? 0.6 + 2.4 * Math.min(1, altitude / 55) : 0;

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.position.copy(direction.clone().multiplyScalar(radius * 4));
    light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld();
  }, [direction, radius]);

  const shadowExtent = Math.max(8, radius * 2.2);

  return (
    <>
      <ambientLight intensity={isDaylight ? 0.42 : 0.16} />
      <hemisphereLight
        args={[skyColorForSun(altitude).getHex(), 0x6b5f4e, isDaylight ? 0.55 : 0.22]}
      />
      <directionalLight
        ref={lightRef}
        intensity={intensity}
        color={skyColorForSun(altitude)}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 10}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-bias={-0.0008}
      />
      {/* A dim fill from the opposite side keeps unlit facades readable rather
          than pure black, which would hide the geometry the user is inspecting. */}
      <directionalLight
        intensity={isDaylight ? 0.35 : 0.1}
        position={[-direction.x * radius, Math.abs(direction.y) * radius * 0.6 + 2, -direction.z * radius]}
        color="#D8C9B4"
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Site                                                                */
/* ------------------------------------------------------------------ */

export interface SiteProps {
  /** Half-extent of the site plane, metres. */
  extent: number;
  showGrid?: boolean;
  /**
   * Draw the fallback ground plane.
   *
   * Off when the caller has already supplied the full site environment
   * (`GroundPlane`), because two coplanar surfaces at the same height z-fight
   * into a shimmering mess. On for the small thumbnails, which want a plain
   * surface behind the building and nothing else.
   */
  showGround?: boolean;
}

export function Site({ extent, showGrid = true, showGround = true }: SiteProps) {
  return (
    <group>
      {showGround ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.19, 0]} receiveShadow>
          <planeGeometry args={[extent * 4, extent * 4]} />
          <meshStandardMaterial color="#DED5C9" roughness={1} />
        </mesh>
      ) : null}
      {showGrid && (
        <Grid
          args={[extent * 3, extent * 3]}
          position={[0, -0.18, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#C9C0B4"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#B0A698"
          fadeDistance={extent * 4}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
      <CompassRose radius={extent * 1.15} />
    </group>
  );
}

/**
 * A north arrow laid flat on the ground.
 *
 * Drawn as geometry rather than text so it needs no font asset and works
 * offline. The cardinal labels live in the DOM legend beside the canvas.
 */
function CompassRose({ radius }: { radius: number }) {
  const northArrow = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.lineTo(-0.28, -0.35);
    shape.lineTo(0, -0.12);
    shape.lineTo(0.28, -0.35);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  const ring = useMemo(() => new THREE.RingGeometry(radius - 0.04, radius, 96), [radius]);
  useEffect(
    () => () => {
      northArrow.dispose();
      ring.dispose();
    },
    [northArrow, ring],
  );

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]}>
      <mesh geometry={ring}>
        <meshBasicMaterial color="#8A8078" side={THREE.DoubleSide} />
      </mesh>
      {/* World −Z is north, so the arrow points along −Z before the flat rotation. */}
      <mesh geometry={northArrow} position={[0, -radius * 0.82, 0]} rotation={[0, 0, 0]}>
        <meshBasicMaterial color="#e0553a" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export interface CameraRigProps {
  preset: CameraPreset;
  /** Building half-diagonal, used to frame the model. */
  radius: number;
  buildingHeight: number;
  enabled: boolean;
}

/** Standard poses, expressed as multiples of the building radius. */
const POSES: Record<
  Exclude<CameraPreset, 'walk'>,
  (r: number, h: number) => { position: [number, number, number]; target: [number, number, number] }
> = {
  iso: (r, h) => ({ position: [r * 1.5, h + r * 0.85, r * 1.6], target: [0, h * 0.45, 0] }),
  front: (r, h) => ({ position: [0, h * 0.65, r * 2.5], target: [0, h * 0.45, 0] }),
  side: (r, h) => ({ position: [r * 2.5, h * 0.65, 0.001], target: [0, h * 0.45, 0] }),
  top: (r, h) => ({ position: [0.001, h + r * 2.6, 0.001], target: [0, 0, 0] }),
};

/**
 * Distance at which a sphere of `radius` exactly fills the smaller of the two
 * field-of-view angles.
 *
 * WHY THIS EXISTS
 * The poses above are expressed as multiples of the building radius, which
 * fixes the *direction* of the camera but not how far away it should be. The
 * old code took the distance as given by those multiples, and because a
 * perspective camera's half-height at distance `d` is only `d·tan(fov/2)`, a
 * building whose bounding radius exceeded that was cropped — the single-family
 * home lost its eaves and its ground slab on screen. Framing has to be solved
 * against the lens, not against a constant.
 *
 * `margin` leaves a little air around the silhouette so the building reads as
 * sitting on the site rather than pressed against the frame edge.
 */
function fitDistance(radius: number, fovDeg: number, aspect: number, margin: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, aspect));
  const limiting = Math.min(vFov, hFov);
  return (radius * margin) / Math.max(0.05, Math.sin(limiting / 2));
}

export function CameraRig({ preset, radius, buildingHeight, enabled }: CameraRigProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  /* The framed distance depends on the lens and the panel's aspect ratio, so it
     is recomputed on resize as well as on a pose change. `size` is a dependency
     rather than a read, so a panel that grows re-frames instead of cropping. */
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;

  useEffect(() => {
    if (preset === 'walk') return;
    const pose = POSES[preset](radius, buildingHeight);

    /* Top view is a plan: it needs the whole footprint, and the pose's own
       height term already does that, so it keeps its own framing. */
    if (preset === 'top') {
      camera.position.set(...pose.position);
      camera.up.set(0, 1, 0);
      camera.lookAt(...pose.target);
      const controls = controlsRef.current;
      if (controls) {
        controls.target.set(...pose.target);
        controls.update();
      }
      return;
    }

    const direction = new THREE.Vector3(...pose.position);
    if (direction.lengthSq() < 1e-6) direction.set(1, 1, 1);
    direction.normalize();

    /* The building stands on the ground, so its bounding sphere is centred
       roughly half way up the massing; the target the pose already chose is the
       right thing to orbit, so only the *distance* is solved for. */
    const target = new THREE.Vector3(...pose.target);
    const distance = fitDistance(radius, fov, aspect, 1.22);

    camera.position.copy(target).addScaledVector(direction, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [preset, radius, buildingHeight, camera, aspect, fov]);

  /* Top view needs an orthographic-ish framing, so pull the far plane out. */
  const maxDistance = Math.max(radius * 8, fitDistance(radius, fov, aspect, 1.22) * 2.4);

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={enabled}
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={maxDistance}
      maxPolarAngle={Math.PI / 2 - 0.02}
      target={[0, buildingHeight * 0.45, 0]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Walkthrough                                                         */
/* ------------------------------------------------------------------ */

export interface WalkthroughControlsProps {
  active: boolean;
  /** Eye height above the floor, metres. */
  eyeHeight: number;
  /** Interior bounds so the walker cannot stroll through a wall. */
  halfWidth: number;
  halfLength: number;
}

/**
 * First-person walkthrough with pointer lock and WASD.
 *
 * Implemented directly rather than through a helper so the movement can be
 * clamped to the interior footprint. Walking through a wall is the single most
 * disorienting thing a walkthrough mode can do, and it happens whenever the
 * collision model is "none".
 */
export function WalkthroughControls({
  active,
  eyeHeight,
  halfWidth,
  halfLength,
}: WalkthroughControlsProps) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    if (!active) return;
    const element = gl.domElement;

    const onClick = () => {
      void element.requestPointerLock();
    };
    const onLockChange = () => {
      locked.current = document.pointerLockElement === element;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!locked.current) return;
      yaw.current -= event.movementX * 0.0022;
      pitch.current = Math.max(
        -Math.PI / 2.4,
        Math.min(Math.PI / 2.4, pitch.current - event.movementY * 0.0022),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
    };

    element.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    /* Start just inside the entrance, looking into the space. */
    camera.position.set(0, eyeHeight, Math.min(halfLength - 0.6, 1.2));
    yaw.current = 0;
    pitch.current = 0;

    return () => {
      element.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (document.pointerLockElement === element) document.exitPointerLock();
    };
  }, [active, camera, gl, eyeHeight, halfLength]);

  useFrame((_, delta) => {
    if (!active) return;

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;
    camera.rotation.z = 0;

    const speed = 2.4 * Math.min(delta, 0.05);
    const forward = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const strafe = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    if (forward === 0 && strafe === 0) return;

    const sin = Math.sin(yaw.current);
    const cos = Math.cos(yaw.current);
    /* Camera looks down −Z in its own frame; forward is therefore (−sin, −cos)
       in the XZ plane once yaw is applied. */
    const dx = (-sin * forward + cos * strafe) * speed;
    const dz = (-cos * forward - sin * strafe) * speed;

    const margin = 0.35;
    camera.position.x = Math.max(-halfWidth + margin, Math.min(halfWidth - margin, camera.position.x + dx));
    camera.position.z = Math.max(-halfLength + margin, Math.min(halfLength - margin, camera.position.z + dz));
    camera.position.y = eyeHeight;
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Mode helpers                                                        */
/* ------------------------------------------------------------------ */

/** Whether a visualisation mode uses a walkthrough camera. */
export function isWalkMode(mode: VisualizationMode): boolean {
  return mode === 'walkthrough';
}

/** The camera preset a visualisation mode implies. */
export function presetForMode(mode: VisualizationMode): CameraPreset {
  switch (mode) {
    case 'front':
      return 'front';
    case 'side':
      return 'side';
    case 'top':
    case 'floorplan':
      return 'top';
    case 'walkthrough':
      return 'walk';
    default:
      return 'iso';
  }
}

/** Walls to hide so a plan or elevation view can see inside. */
export function wallsHiddenForMode(mode: VisualizationMode): Array<'front' | 'back' | 'left' | 'right'> {
  switch (mode) {
    case 'front':
      return ['front'];
    case 'side':
      return ['right'];
    case 'top':
    case 'floorplan':
      return ['front', 'back', 'left', 'right'];
    default:
      return [];
  }
}
