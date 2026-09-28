'use client';

/**
 * 3D Dynamic Animated Overlays for Thermal Shelter Analysis Modes.
 *
 * Provides dedicated 60fps Three.js animations tailored to each mode:
 *  - Solar: Cascading solar irradiation beams & warm surface shimmer
 *  - Temp: Stratified convective indoor thermal core & FEA breathing
 *  - Loss: Upward thermal dissipation plumes escaping from envelope
 *  - Flux: Directional conductive vector arrows penetrating walls
 *  - Moisture: Atmospheric relative humidity vapor mist field
 *  - Condense: Glistening dewdrops and at-risk condensation alert rings
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ShelterGeometry, VisualizationMode } from '@/types';
import type { HeatSurfaceKey } from './ShelterModel';

interface ModeAnimationsProps {
  mode: VisualizationMode;
  geometry: ShelterGeometry;
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
  sunAltitude?: number;
  sunAzimuth?: number;
}

export function ModeVisualAnimations({
  mode,
  geometry,
  surfaceHeat,
  sunAltitude = 45,
  sunAzimuth = 180,
}: ModeAnimationsProps) {
  return (
    <group>
      {/* 1. Solar Mode Animation */}
      {(mode === 'heatmap' || mode === 'solar') && (
        <SolarIrradiationStream
          geometry={geometry}
          sunAltitude={sunAltitude}
          sunAzimuth={sunAzimuth}
        />
      )}

      {/* 2. Temperature Mode Animation */}
      {mode === 'temperature' && (
        <ThermalStratificationField
          geometry={geometry}
          surfaceHeat={surfaceHeat}
        />
      )}

      {/* 3. Heat Loss Mode Animation */}
      {mode === 'heatloss' && (
        <HeatLossDissipationPlumes
          geometry={geometry}
          surfaceHeat={surfaceHeat}
        />
      )}

      {/* 4. Heat Flux Mode Animation */}
      {mode === 'heatflux' && (
        <HeatFluxVectors
          geometry={geometry}
          surfaceHeat={surfaceHeat}
        />
      )}

      {/* 5. Moisture Mode Animation */}
      {mode === 'humidity' && (
        <MoistureVaporField geometry={geometry} />
      )}

      {/* 6. Condensation Mode Animation */}
      {mode === 'condensation' && (
        <CondensationDewField
          geometry={geometry}
          surfaceHeat={surfaceHeat}
        />
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Solar Irradiation Cascading Stream & Sun Rays                   */
/* ------------------------------------------------------------------ */

function SolarIrradiationStream({
  geometry,
  sunAltitude,
  sunAzimuth,
}: {
  geometry: ShelterGeometry;
  sunAltitude: number;
  sunAzimuth: number;
}) {
  const { width, length } = geometry.parameters;
  const height = geometry.totalHeight;
  const count = 90;
  const pointsRef = useRef<THREE.Points>(null);
  const glowMeshRef = useRef<THREE.Mesh>(null);

  // Compute normalized sun direction vector
  const sunDir = useMemo(() => {
    const altRad = Math.max(0.15, (sunAltitude * Math.PI) / 180);
    const azRad = ((sunAzimuth - 180) * Math.PI) / 180;
    return new THREE.Vector3(
      Math.sin(azRad) * Math.cos(altRad),
      Math.sin(altRad),
      Math.cos(azRad) * Math.cos(altRad)
    ).normalize();
  }, [sunAltitude, sunAzimuth]);

  // Particle positions, velocities, seeds
  const { positions, seeds, geo } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const colorA = new THREE.Color('#f59e0b'); // Warm Amber
    const colorB = new THREE.Color('#fbbf24'); // Sun Yellow

    for (let i = 0; i < count; i++) {
      // Local target on the roof or upper envelope
      s[i * 3] = (Math.random() - 0.5) * (width * 1.05);
      s[i * 3 + 1] = height + 0.1 + Math.random() * (geometry.roof.rise || 0.5);
      s[i * 3 + 2] = (Math.random() - 0.5) * (length * 1.05);

      const c = Math.random() > 0.4 ? colorA : colorB;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { positions: pos, seeds: s, colors: col, geo: g };
  }, [count, width, length, height, geometry.roof.rise]);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 1.6;

    // Animate solar particles streaming along sun direction down to envelope
    for (let i = 0; i < count; i++) {
      const cycle = ((t * 0.5 + i / count) % 1);
      const distance = 4.5 * (1 - cycle);

      positions[i * 3] = seeds[i * 3]! + sunDir.x * distance;
      positions[i * 3 + 1] = seeds[i * 3 + 1]! + sunDir.y * distance;
      positions[i * 3 + 2] = seeds[i * 3 + 2]! + sunDir.z * distance;
    }
    geo.attributes.position!.needsUpdate = true;

    // Subtle pulsing solar irradiance on roof
    if (glowMeshRef.current) {
      const pulse = 0.45 + 0.25 * Math.sin(t * 2.5);
      (glowMeshRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * 0.35;
    }
  });

  return (
    <group>
      {/* Streaming solar rays */}
      <points ref={pointsRef} geometry={geo}>
        <pointsMaterial
          size={0.12}
          vertexColors
          transparent
          opacity={0.88}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Roof Solar Radiation Shimmer Plane */}
      <mesh
        ref={glowMeshRef}
        position={[0, height + 0.15, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[width * 1.05, length * 1.05]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Temperature Stratification & FEA Convective Thermal Core        */
/* ------------------------------------------------------------------ */

function ThermalStratificationField({
  geometry,
}: {
  geometry: ShelterGeometry;
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
}) {
  const { width, length } = geometry.parameters;
  const height = geometry.totalHeight;
  const count = 75;

  const { positions, seeds, geo } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    const coldBlue = new THREE.Color('#2563eb');
    const midGreen = new THREE.Color('#10b981');
    const warmRed = new THREE.Color('#ef4444');

    for (let i = 0; i < count; i++) {
      s[i * 3] = (Math.random() - 0.5) * (width * 0.75); // X
      s[i * 3 + 1] = Math.random(); // Height progress [0..1]
      s[i * 3 + 2] = (Math.random() - 0.5) * (length * 0.75); // Z

      // Temperature color varies by height (thermal buoyancy stratification)
      const hFrac = s[i * 3 + 1]!;
      const c = new THREE.Color();
      if (hFrac < 0.45) {
        c.lerpColors(coldBlue, midGreen, hFrac / 0.45);
      } else {
        c.lerpColors(midGreen, warmRed, (hFrac - 0.45) / 0.55);
      }

      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { positions: pos, seeds: s, colors: col, geo: g };
  }, [count, width, length]);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.45;

    for (let i = 0; i < count; i++) {
      // Convective rising drift: cold air enters at bottom, rises with buoyancy
      const cycle = (seeds[i * 3 + 1]! + t * 0.35) % 1;
      const swirl = Math.sin(t * 1.5 + i) * 0.15;

      positions[i * 3] = seeds[i * 3]! + swirl;
      positions[i * 3 + 1] = 0.2 + cycle * (height - 0.4);
      positions[i * 3 + 2] = seeds[i * 3 + 2]! + Math.cos(t * 1.2 + i) * 0.15;
    }
    geo.attributes.position!.needsUpdate = true;
  });

  return (
    <group>
      <points geometry={geo}>
        <pointsMaterial
          size={0.14}
          vertexColors
          transparent
          opacity={0.82}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Mid-height FEA stratification plane */}
      <mesh position={[0, height * 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width * 0.85, length * 0.85]} />
        <meshBasicMaterial
          color="#10b981"
          transparent
          opacity={0.08}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Heat Loss Dissipation Plumes (Escaping Convective Heat)          */
/* ------------------------------------------------------------------ */

function HeatLossDissipationPlumes({
  geometry,
}: {
  geometry: ShelterGeometry;
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
}) {
  const { width, length } = geometry.parameters;
  const height = geometry.totalHeight;
  const count = 90;

  const { positions, seeds, geo } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    const warmLoss = new THREE.Color('#ea580c'); // Vibrant Amber
    const hotLoss = new THREE.Color('#dc2626');  // Dissipating Crimson

    for (let i = 0; i < count; i++) {
      // Emitters across roof surface & envelope perimeter
      s[i * 3] = (Math.random() - 0.5) * (width * 1.1);
      s[i * 3 + 1] = height + (Math.random() * (geometry.roof.rise || 0.4));
      s[i * 3 + 2] = (Math.random() - 0.5) * (length * 1.1);

      const c = Math.random() > 0.5 ? warmLoss : hotLoss;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { positions: pos, seeds: s, colors: col, geo: g };
  }, [count, width, length, height, geometry.roof.rise]);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.8;

    // Animate plumes ascending upward into the atmosphere
    for (let i = 0; i < count; i++) {
      const cycle = ((t * 0.45 + i / count) % 1);
      const ascent = cycle * 2.8; // Ascend up to 2.8 meters above building
      const spread = cycle * 0.6; // Plumes diffuse outwards as they cool

      positions[i * 3] = seeds[i * 3]! + Math.sin(t * 2 + i) * spread;
      positions[i * 3 + 1] = seeds[i * 3 + 1]! + ascent;
      positions[i * 3 + 2] = seeds[i * 3 + 2]! + Math.cos(t * 1.8 + i) * spread;
    }
    geo.attributes.position!.needsUpdate = true;
  });

  return (
    <group>
      <points geometry={geo}>
        <pointsMaterial
          size={0.16}
          vertexColors
          transparent
          opacity={0.88}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Heat Flux Vectors (Directional Conductive Transfer Arrows)       */
/* ------------------------------------------------------------------ */

function HeatFluxVectors({
  geometry,
  surfaceHeat,
}: {
  geometry: ShelterGeometry;
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
}) {
  const { width, length, wallThickness } = geometry.parameters;
  const height = geometry.totalHeight;
  const groupRef = useRef<THREE.Group>(null);

  // Define flux probe points around building envelope
  const vectors = useMemo(() => {
    const halfW = width / 2;
    const halfL = length / 2;
    const midY = height * 0.55;

    return [
      // Front wall
      {
        pos: new THREE.Vector3(0, midY, halfL + wallThickness * 0.5),
        dir: new THREE.Vector3(0, 0, -1), // Inward conduction
        key: 'front' as HeatSurfaceKey,
      },
      // Back wall
      {
        pos: new THREE.Vector3(0, midY, -halfL - wallThickness * 0.5),
        dir: new THREE.Vector3(0, 0, 1),
        key: 'back' as HeatSurfaceKey,
      },
      // Left wall
      {
        pos: new THREE.Vector3(-halfW - wallThickness * 0.5, midY, 0),
        dir: new THREE.Vector3(1, 0, 0),
        key: 'left' as HeatSurfaceKey,
      },
      // Right wall
      {
        pos: new THREE.Vector3(halfW + wallThickness * 0.5, midY, 0),
        dir: new THREE.Vector3(-1, 0, 0),
        key: 'right' as HeatSurfaceKey,
      },
      // Roof
      {
        pos: new THREE.Vector3(0, height + 0.35, 0),
        dir: new THREE.Vector3(0, -1, 0),
        key: 'roof' as HeatSurfaceKey,
      },
    ];
  }, [width, length, height, wallThickness]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime * 3;
    const shift = Math.sin(t) * 0.12;

    groupRef.current.children.forEach((child) => {
      // Pulse vector scales along normal
      child.scale.set(1, 1 + shift, 1);
    });
  });

  return (
    <group ref={groupRef}>
      {vectors.map((vec, i) => {
        const fluxVal = surfaceHeat?.[vec.key] ?? 35;
        const isHigh = Math.abs(fluxVal) > 25;
        const color = isHigh ? '#f97316' : '#06b6d4';

        return (
          <group key={i} position={vec.pos.toArray()}>
            <mesh rotation={vec.dir.y !== 0 ? [Math.PI, 0, 0] : [0, Math.atan2(vec.dir.x, vec.dir.z), 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.65, 8]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            {/* Arrowhead */}
            <mesh
              position={[vec.dir.x * 0.38, vec.dir.y * 0.38, vec.dir.z * 0.38]}
              rotation={vec.dir.y !== 0 ? [Math.PI, 0, 0] : [0, Math.atan2(vec.dir.x, vec.dir.z), 0]}
            >
              <coneGeometry args={[0.1, 0.22, 10]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Moisture Vapor Mist Field (Ambient Relative Humidity)            */
/* ------------------------------------------------------------------ */

function MoistureVaporField({ geometry }: { geometry: ShelterGeometry }) {
  const { width, length } = geometry.parameters;
  const height = geometry.totalHeight;
  const count = 90;

  const { positions, seeds, geo } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    const cyanMist = new THREE.Color('#38bdf8');
    const aquaMist = new THREE.Color('#67e8f9');

    for (let i = 0; i < count; i++) {
      s[i * 3] = (Math.random() - 0.5) * (width * 1.2);
      s[i * 3 + 1] = 0.15 + Math.random() * (height * 0.9);
      s[i * 3 + 2] = (Math.random() - 0.5) * (length * 1.2);

      const c = Math.random() > 0.5 ? cyanMist : aquaMist;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { positions: pos, seeds: s, colors: col, geo: g };
  }, [count, width, length, height]);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.5;

    // Gentle vapor mist eddying and floating around envelope
    for (let i = 0; i < count; i++) {
      const wobbleX = Math.sin(t * 0.8 + i) * 0.35;
      const wobbleY = Math.cos(t * 0.6 + i * 2) * 0.18;
      const wobbleZ = Math.cos(t * 0.7 + i) * 0.35;

      positions[i * 3] = seeds[i * 3]! + wobbleX;
      positions[i * 3 + 1] = seeds[i * 3 + 1]! + wobbleY;
      positions[i * 3 + 2] = seeds[i * 3 + 2]! + wobbleZ;
    }
    geo.attributes.position!.needsUpdate = true;
  });

  return (
    <group>
      <points geometry={geo}>
        <pointsMaterial
          size={0.16}
          vertexColors
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Condensation Dew Drops & Warning Shimmer Rings                  */
/* ------------------------------------------------------------------ */

function CondensationDewField({
  geometry,
}: {
  geometry: ShelterGeometry;
  surfaceHeat?: Partial<Record<HeatSurfaceKey, number>>;
}) {
  const { width, length, wallThickness } = geometry.parameters;
  const height = geometry.totalHeight;
  const pulseRingsRef = useRef<THREE.Group>(null);

  // Dew droplet positions along vulnerable lower corners and roof overhangs
  const dewPoints = useMemo(() => {
    const points: [number, number, number][] = [];
    const halfW = width / 2 + wallThickness / 2;
    const halfL = length / 2 + wallThickness / 2;

    // Base perimeter droplets (cold wall bottoms)
    for (let x = -halfW; x <= halfW; x += width / 5) {
      points.push([x, 0.18, halfL]);
      points.push([x, 0.18, -halfL]);
    }
    for (let z = -halfL; z <= halfL; z += length / 5) {
      points.push([halfW, 0.18, z]);
      points.push([-halfW, 0.18, z]);
    }

    // Roof eave droplets
    points.push([halfW + 0.15, height + 0.05, 0]);
    points.push([-halfW - 0.15, height + 0.05, 0]);
    points.push([0, height + 0.05, halfL + 0.15]);
    points.push([0, height + 0.05, -halfL - 0.15]);

    return points;
  }, [width, length, height, wallThickness]);

  useFrame((state) => {
    if (!pulseRingsRef.current) return;
    const t = state.clock.elapsedTime * 3.5;
    const s = 1 + 0.25 * Math.sin(t);
    pulseRingsRef.current.scale.set(s, s, s);
  });

  return (
    <group>
      {/* Individual glistening dew drop spheres */}
      {dewPoints.map((pos, idx) => (
        <group key={idx} position={pos}>
          <mesh castShadow={false}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshPhysicalMaterial
              color="#38bdf8"
              roughness={0.05}
              metalness={0.1}
              transmission={0.88}
              ior={1.33}
              thickness={0.06}
              transparent
              opacity={0.92}
            />
          </mesh>
        </group>
      ))}

      {/* Condensation Risk Warning Pulsing Ring on floor perimeter */}
      <group ref={pulseRingsRef} position={[0, 0.08, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.min(width, length) * 0.45, Math.min(width, length) * 0.48, 32]} />
          <meshBasicMaterial
            color="#06b6d4"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}
