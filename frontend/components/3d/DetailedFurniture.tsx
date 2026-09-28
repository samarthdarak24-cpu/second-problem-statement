'use client';

import type { ShelterGeometry } from '@/types';

function Sofa({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Base cushion */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.36, 0.85]} />
        <meshStandardMaterial color="#475569" roughness={0.92} />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, 0.65, -0.32]} castShadow>
        <boxGeometry args={[1.9, 0.48, 0.2]} />
        <meshStandardMaterial color="#475569" roughness={0.92} />
      </mesh>
      {/* Left armrest */}
      <mesh position={[-0.95, 0.5, 0]} castShadow>
        <boxGeometry args={[0.18, 0.5, 0.85]} />
        <meshStandardMaterial color="#334155" roughness={0.92} />
      </mesh>
      {/* Right armrest */}
      <mesh position={[0.95, 0.5, 0]} castShadow>
        <boxGeometry args={[0.18, 0.5, 0.85]} />
        <meshStandardMaterial color="#334155" roughness={0.92} />
      </mesh>
      {/* Seat cushions */}
      {[-0.48, 0.48].map((dx, i) => (
        <mesh key={i} position={[dx, 0.48, 0.05]} castShadow>
          <boxGeometry args={[0.8, 0.16, 0.72]} />
          <meshStandardMaterial color="#64748b" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Table top */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.04, 0.55]} />
        <meshStandardMaterial color="#78350f" roughness={0.6} />
      </mesh>
      {/* Legs */}
      {[
        [-0.48, 0.22],
        [0.48, 0.22],
        [-0.48, -0.22],
        [0.48, -0.22],
      ].map((p, i) => (
        <mesh key={i} position={[p[0], 0.19, p[1]]} castShadow>
          <boxGeometry args={[0.04, 0.38, 0.04]} />
          <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Rug({ position, w = 2.4, d = 1.6, color = '#cbd5e1' }: { position: [number, number, number]; w?: number; d?: number; color?: string }) {
  return (
    <mesh position={position} receiveShadow>
      <boxGeometry args={[w, 0.015, d]} />
      <meshStandardMaterial color={color} roughness={0.98} />
    </mesh>
  );
}

function TVUnit({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Low media console */}
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.42, 0.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} />
      </mesh>
      {/* TV Screen */}
      <mesh position={[0, 0.95, -0.05]} castShadow>
        <boxGeometry args={[1.4, 0.8, 0.05]} />
        <meshStandardMaterial color="#020617" roughness={0.15} metalness={0.8} />
      </mesh>
      {/* TV Stand */}
      <mesh position={[0, 0.5, -0.05]}>
        <boxGeometry args={[0.4, 0.1, 0.2]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} />
      </mesh>
    </group>
  );
}

function Kitchen({ position, length = 2.4, depth = 0.6 }: { position: [number, number, number]; length?: number; depth?: number }) {
  return (
    <group position={position}>
      {/* Base cabinets */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.84, depth]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.7} />
      </mesh>
      {/* Stone countertop */}
      <mesh position={[0, 0.86, 0]} castShadow>
        <boxGeometry args={[length + 0.04, 0.04, depth + 0.04]} />
        <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Stainless Sink */}
      <mesh position={[length * 0.25, 0.885, 0.02]}>
        <boxGeometry args={[0.48, 0.03, 0.38]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.92} roughness={0.2} />
      </mesh>
      {/* Induction / Gas Cooktop */}
      <mesh position={[-length * 0.25, 0.885, 0]}>
        <boxGeometry args={[0.52, 0.015, 0.42]} />
        <meshStandardMaterial color="#020617" roughness={0.2} />
      </mesh>
      {/* Wall cabinets */}
      <mesh position={[0, 1.95, -depth / 2 + 0.16]} castShadow>
        <boxGeometry args={[length, 0.65, 0.32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.7} />
      </mesh>
    </group>
  );
}

function DiningSet({ position }: { position: [number, number, number] }) {
  const chair = (cx: number, cz: number, rot: number) => (
    <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.38, 0.04, 0.38]} />
        <meshStandardMaterial color="#92400e" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.68, -0.16]} castShadow>
        <boxGeometry args={[0.38, 0.46, 0.04]} />
        <meshStandardMaterial color="#92400e" roughness={0.7} />
      </mesh>
      {[
        [-0.15, -0.15],
        [0.15, -0.15],
        [-0.15, 0.15],
        [0.15, 0.15],
      ].map((leg, j) => (
        <mesh key={j} position={[leg[0], 0.21, leg[1]]} castShadow>
          <boxGeometry args={[0.035, 0.42, 0.035]} />
          <meshStandardMaterial color="#1e293b" metalness={0.7} />
        </mesh>
      ))}
    </group>
  );

  return (
    <group position={position}>
      {/* Table top */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.04, 0.85]} />
        <meshStandardMaterial color="#b45309" roughness={0.6} />
      </mesh>
      {/* Table legs */}
      {[
        [-0.65, 0.35],
        [0.65, 0.35],
        [-0.65, -0.35],
        [0.65, -0.35],
      ].map((p, i) => (
        <mesh key={i} position={[p[0], 0.35, p[1]]} castShadow>
          <boxGeometry args={[0.06, 0.7, 0.06]} />
          <meshStandardMaterial color="#78350f" />
        </mesh>
      ))}
      {chair(-0.45, 0.65, 0)}
      {chair(0.45, 0.65, 0)}
      {chair(-0.45, -0.65, Math.PI)}
      {chair(0.45, -0.65, Math.PI)}
    </group>
  );
}

function Bed({ position, rotation = 0, size = 'double' }: { position: [number, number, number]; rotation?: number; size?: 'single' | 'double' }) {
  const w = size === 'double' ? 1.6 : 1.0;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Bed frame */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.08, 0.28, 2.08]} />
        <meshStandardMaterial color="#78350f" roughness={0.7} />
      </mesh>
      {/* Mattress */}
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[w, 0.22, 1.96]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.9} />
      </mesh>
      {/* Duvet / Blanket */}
      <mesh position={[0, 0.46, 0.2]} castShadow>
        <boxGeometry args={[w + 0.02, 0.12, 1.4]} />
        <meshStandardMaterial color="#0284c7" roughness={0.8} />
      </mesh>
      {/* Headboard */}
      <mesh position={[0, 0.65, -1.0]} castShadow>
        <boxGeometry args={[w + 0.12, 0.75, 0.08]} />
        <meshStandardMaterial color="#451a03" roughness={0.65} />
      </mesh>
      {/* Pillows */}
      {size === 'double' ? (
        <>
          <mesh position={[-0.4, 0.54, -0.75]} castShadow>
            <boxGeometry args={[0.55, 0.12, 0.38]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
          <mesh position={[0.4, 0.54, -0.75]} castShadow>
            <boxGeometry args={[0.55, 0.12, 0.38]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, 0.54, -0.75]} castShadow>
          <boxGeometry args={[0.55, 0.12, 0.38]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

function Bathroom({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Toilet */}
      <group position={[-0.4, 0, 0]}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[0.38, 0.42, 0.52]} />
          <meshStandardMaterial color="#ffffff" roughness={0.15} />
        </mesh>
        <mesh position={[0, 0.55, -0.2]} castShadow>
          <boxGeometry args={[0.36, 0.45, 0.18]} />
          <meshStandardMaterial color="#ffffff" roughness={0.15} />
        </mesh>
      </group>
      {/* Vanity & Basin */}
      <group position={[0.4, 0, 0]}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.55, 0.8, 0.45]} />
          <meshStandardMaterial color="#334155" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.84, 0]}>
          <boxGeometry args={[0.42, 0.06, 0.36]} />
          <meshStandardMaterial color="#ffffff" roughness={0.1} />
        </mesh>
        <mesh position={[0, 1.4, -0.2]}>
          <boxGeometry args={[0.45, 0.65, 0.02]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.95} roughness={0.05} />
        </mesh>
      </group>
    </group>
  );
}

export function DetailedFurniture({ geometry }: { geometry: ShelterGeometry }) {
  const { width, length, numRooms = 1, numOccupants = 2 } = geometry.parameters;

  const halfW = width / 2;
  const halfL = length / 2;

  return (
    <group position={[0, 0, 0]}>
      {/* Living Zone */}
      <group position={[-halfW * 0.4, 0, halfL * 0.35]}>
        <Sofa position={[0, 0, 0]} rotation={0} />
        <CoffeeTable position={[0, 0, 1.1]} />
        <Rug position={[0, 0, 0.8]} w={2.4} d={2.0} />
        <TVUnit position={[0, 0, 2.0]} rotation={Math.PI} />
      </group>

      {/* Dining & Kitchen Zone */}
      <group position={[halfW * 0.4, 0, halfL * 0.35]}>
        <Kitchen position={[0, 0, -1.2]} length={Math.min(2.8, width * 0.38)} />
        <DiningSet position={[0, 0, 0.8]} />
      </group>

      {/* Master Bedroom Zone */}
      <group position={[-halfW * 0.45, 0, -halfL * 0.45]}>
        <Bed position={[0, 0, 0]} rotation={0} size={numOccupants > 1 ? 'double' : 'single'} />
      </group>

      {/* Secondary Bedroom or Bathroom Zone */}
      {numRooms > 1 && (
        <group position={[halfW * 0.45, 0, -halfL * 0.45]}>
          <Bed position={[0, 0, 0]} rotation={0} size="single" />
        </group>
      )}

      {/* Bathroom */}
      <group position={[0, 0, -halfL * 0.45]}>
        <Bathroom position={[0, 0, 0]} />
      </group>
    </group>
  );
}
