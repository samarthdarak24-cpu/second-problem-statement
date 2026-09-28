'use client';

/**
 * Analytical overlays: airflow, sun path and the daylight indicator.
 *
 * These are the visualisation modes that turn the 3D view into an analysis tool
 * rather than a picture. Each one is driven by the same engine that produced the
 * numbers, so the animation cannot flatter a design the model rejected.
 *
 *   AIRFLOW  — particles advected along the prevailing wind through the
 *              openings. Their speed is the design air-change rate, so a sealed
 *              scheme visibly has no airflow and a cross-ventilated one does.
 *   SUN PATH — the sun's actual track for the selected month, from the NOAA
 *              solar position engine, with the hour marker.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClimateData, ShelterGeometry } from '@/types';
import { MONTH_MID_DAY } from '@/utils/units';
import { solarPosition } from '@/utils/solar';
import { AIRFLOW_RAMP, sampleRamp } from './palette';

/* ------------------------------------------------------------------ */
/* Wind direction helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Prevailing wind travel direction in building-local coordinates.
 *
 * `windDirection` is meteorological — the direction the wind blows *from* — so
 * the travel vector is its opposite. The result is rotated into the building's
 * own frame, matching the group transform in `ShelterModel`.
 */
export function localWindDirection(
  windDirectionDeg: number,
  orientationDeg: number,
): THREE.Vector3 {
  const from = (windDirectionDeg * Math.PI) / 180;
  /* World ENU: +X East, −Z North. Wind blowing from `from` travels toward
     `from + 180`. */
  const east = -Math.sin(from);
  const north = -Math.cos(from);
  const world = new THREE.Vector3(east, 0, -north).normalize();
  const localRotation = ((180 - orientationDeg) * Math.PI) / 180;
  world.applyAxisAngle(new THREE.Vector3(0, 1, 0), -localRotation);
  return world.normalize();
}

/* ------------------------------------------------------------------ */
/* Airflow                                                             */
/* ------------------------------------------------------------------ */

export interface AirflowOverlayProps {
  geometry: ShelterGeometry;
  climate: ClimateData;
  /** Air changes per hour the design provides — drives particle speed. */
  airChangesPerHour: number;
  /** Particles to animate. More is prettier and slower. */
  count?: number;
  visible?: boolean;
}

export function AirflowOverlay({
  geometry,
  climate,
  airChangesPerHour,
  count = 420,
  visible = true,
}: AirflowOverlayProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const flow = useMemo(
    () => localWindDirection(climate.summary.windDirection, geometry.parameters.orientation),
    [climate.summary.windDirection, geometry.parameters.orientation],
  );

  const extent = useMemo(() => {
    const { width, length } = geometry.parameters;
    return Math.max(width, length) * 1.4;
  }, [geometry.parameters]);

  /* Per-particle static offset across the flow cross-section, plus a random
     phase so they do not march in a rank. */
  const seeds = useMemo(() => {
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      array[i * 3] = (Math.random() - 0.5) * 2;
      array[i * 3 + 1] = Math.random();
      array[i * 3 + 2] = Math.random();
    }
    return array;
  }, [count]);

  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const colors = useMemo(() => new Float32Array(count * 3), [count]);

  /* Perpendicular axis so particles spread across the facade, not in a line. */
  const lateral = useMemo(
    () => new THREE.Vector3(-flow.z, 0, flow.x).normalize(),
    [flow],
  );

  /* Speed: 8 ACH crosses the building roughly twice a second at true scale.
     Scaled down for readability — a physically exact speed is a blur. */
  const speed = Math.max(0.02, Math.min(0.9, airChangesPerHour * 0.055));

  const geometryRef = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [positions, colors]);

  useEffect(() => () => geometryRef.dispose(), [geometryRef]);

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!visible || !pointsRef.current) return;
    elapsed.current += Math.min(delta, 0.05) * speed;

    const height = geometry.parameters.height;
    const halfSpan = extent;

    for (let i = 0; i < count; i += 1) {
      const lateralOffset = seeds[i * 3]! * halfSpan;
      const heightFraction = seeds[i * 3 + 1]!;
      const phase = seeds[i * 3 + 2]!;

      /* Travel from −extent to +extent along the flow, wrapping. */
      const t = ((elapsed.current + phase) % 1) * 2 - 1;
      const along = t * halfSpan;

      positions[i * 3] = flow.x * along + lateral.x * lateralOffset;
      positions[i * 3 + 1] = 0.35 + heightFraction * (height - 0.5);
      positions[i * 3 + 2] = flow.z * along + lateral.z * lateralOffset;

      /* Colour by how far along the path the particle is: cool entering,
         warmer as it picks up heat. */
      const colour = sampleRamp(AIRFLOW_RAMP, Math.max(0, Math.min(1, (t + 1) / 2)));
      colors[i * 3] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }

    geometryRef.attributes.position!.needsUpdate = true;
    geometryRef.attributes.color!.needsUpdate = true;
  });

  if (!visible) return null;

  return (
    <points ref={pointsRef} geometry={geometryRef}>
      <pointsMaterial
        size={0.085}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* Sun path                                                            */
/* ------------------------------------------------------------------ */

export interface SunPathOverlayProps {
  climate: ClimateData;
  orientation: number;
  month: number;
  hour: number;
  /** Building radius, so the arc is drawn outside the model. */
  radius: number;
  visible?: boolean;
}

export function SunPathOverlay({
  climate,
  orientation,
  month,
  hour,
  radius,
  visible = true,
}: SunPathOverlayProps) {
  const { latitude } = climate.location;
  const day = MONTH_MID_DAY[month] ?? 180;

  const { pathLine, currentLine, marker } = useMemo(() => {
    const scale = radius * 1.9;

    const points: THREE.Vector3[] = [];
    for (let h = 0; h <= 24; h += 0.25) {
      const pos = solarPosition(latitude, day, h);
      if (pos.altitude < -2) continue;
      const altitude = (pos.altitude * Math.PI) / 180;
      const azimuth = (pos.azimuth * Math.PI) / 180;
      const horizontal = Math.cos(altitude) * scale;
      /* World ENU → local, matching the building group rotation. */
      const east = horizontal * Math.sin(azimuth);
      const north = horizontal * Math.cos(azimuth);
      const world = new THREE.Vector3(east, Math.sin(altitude) * scale, -north);
      world.applyAxisAngle(new THREE.Vector3(0, 1, 0), -((180 - orientation) * Math.PI) / 180);
      points.push(world);
    }

    const pathGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const path = new THREE.Line(
      pathGeometry,
      new THREE.LineBasicMaterial({ color: '#f0b429', transparent: true, opacity: 0.85 }),
    );

    /* A vertical ray from the sun to the ground shows where it is in plan. */
    const now = solarPosition(latitude, day, hour);
    const nowAltitude = Math.max(0, now.altitude) * (Math.PI / 180);
    const nowAzimuth = (now.azimuth * Math.PI) / 180;
    const nowHorizontal = Math.cos(nowAltitude) * scale;
    const sunWorld = new THREE.Vector3(
      nowHorizontal * Math.sin(nowAzimuth),
      Math.sin(nowAltitude) * scale,
      -nowHorizontal * Math.cos(nowAzimuth),
    );
    sunWorld.applyAxisAngle(new THREE.Vector3(0, 1, 0), -((180 - orientation) * Math.PI) / 180);

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sunWorld.x, 0, sunWorld.z),
      sunWorld,
    ]);
    const ray = new THREE.Line(
      rayGeometry,
      new THREE.LineDashedMaterial({ color: '#f6d365', dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.7 }),
    );
    ray.computeLineDistances();

    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 20, 16),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }),
    );
    sunMesh.position.copy(sunWorld);

    return { pathLine: path, currentLine: ray, marker: sunMesh };
  }, [latitude, day, hour, orientation, radius]);

  useEffect(
    () => () => {
      pathLine.geometry.dispose();
      (pathLine.material as THREE.Material).dispose();
      currentLine.geometry.dispose();
      (currentLine.material as THREE.Material).dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    },
    [pathLine, currentLine, marker],
  );

  if (!visible) return null;

  return (
    <group>
      <primitive object={pathLine} />
      <primitive object={currentLine} />
      <primitive object={marker} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Wind rose on the ground                                             */
/* ------------------------------------------------------------------ */

export interface WindArrowProps {
  climate: ClimateData;
  orientation: number;
  radius: number;
  visible?: boolean;
}

/** A ground arrow showing where the prevailing wind comes from. */
export function WindArrow({ climate, orientation, radius, visible = true }: WindArrowProps) {
  const flow = useMemo(
    () => localWindDirection(climate.summary.windDirection, orientation),
    [climate.summary.windDirection, orientation],
  );

  const arrow = useMemo(() => {
    const length = radius * 2.4;
    const origin = flow.clone().multiplyScalar(-length / 2);
    origin.y = 0.05;
    return new THREE.ArrowHelper(flow, origin, length, 0x4fd1c5, length * 0.16, length * 0.09);
  }, [flow, radius]);

  useEffect(() => () => arrow.dispose(), [arrow]);

  if (!visible) return null;

  return <primitive object={arrow} position={[0, 0, 0]} />;
}
