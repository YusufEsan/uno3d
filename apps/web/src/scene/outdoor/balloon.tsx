import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cloud } from '@react-three/drei';
import * as THREE from 'three';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { Model } from '../models';
import { SurfaceMaterial } from '../textures';
import { Gulls, Mountains, SkyDome, SoftClouds, Sun, canvasTexture, seeded } from './common';

// ---------- sıcak hava balonu ----------

const ENVELOPE_PROFILE = [
  [1.3, 0], [2.0, 1.1], [3.4, 2.5], [4.4, 4.1], [4.9, 5.7], [4.75, 7.1], [4.1, 8.3], [3.0, 9.3], [1.6, 9.95], [0.02, 10.2],
].map(([r, y]) => new THREE.Vector2(r, y));

function stripes(colors: string[], gores = 16) {
  return canvasTexture(512, 32, g => {
    const w = 512 / gores;
    for (let i = 0; i < gores; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(i * w, 0, w + 1, 32);
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect(i * w, 0, 2, 32);
    }
  });
}

/** balon zarfı: dilimli, çizgili kumaş */
export function Envelope({ colors, scale = 1 }: { colors: string[]; scale?: number }) {
  const tex = useMemo(() => stripes(colors), [colors]);
  return (
    <mesh scale={scale} castShadow>
      <latheGeometry args={[ENVELOPE_PROFILE, 32]} />
      <meshStandardMaterial map={tex} roughness={0.75} side={THREE.DoubleSide} />
    </mesh>
  );
}

export const BALLOON_COLORS = [
  ['#e5322d', '#f5c400', '#e5322d', '#ffffff'],
  ['#2b7de9', '#ffffff', '#2b7de9', '#f2b632'],
  ['#8a3ae0', '#ff7bc0', '#ffffff'],
  ['#2ca85a', '#f5e7c0', '#e07a2c'],
  ['#ff6a3d', '#ffd23d'],
];

export function BalloonEnv({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const low = quality === 'low';
  const wicker = useMemo(
    () =>
      canvasTexture(
        128,
        128,
        g => {
          g.fillStyle = '#8a5a32';
          g.fillRect(0, 0, 128, 128);
          for (let y = 0; y < 128; y += 16)
            for (let x = 0; x < 128; x += 16) {
              g.fillStyle = (x + y) % 32 ? '#a8743f' : '#704626';
              g.fillRect(x + 1, y + 1, 14, 7);
              g.fillStyle = (x + y) % 32 ? '#704626' : '#a8743f';
              g.fillRect(x + 1, y + 9, 14, 6);
            }
        },
        [14, 1],
      ),
    [],
  );
  const ground = useMemo(
    () =>
      canvasTexture(
        512,
        512,
        g => {
          // tarla yaması: yeşil ve sarı tonlarda parseller, arada yollar
          const r = seeded(77);
          const tones = ['#6f9a4a', '#88ad52', '#a7b85a', '#c9b25a', '#5f8a45', '#7fa860'];
          for (let y = 0; y < 512; y += 64)
            for (let x = 0; x < 512; x += 64) {
              g.fillStyle = tones[Math.floor(r() * tones.length)];
              g.fillRect(x, y, 64, 64);
            }
          g.fillStyle = 'rgba(80,60,40,.5)';
          for (let i = 0; i <= 512; i += 128) {
            g.fillRect(i - 2, 0, 4, 512);
            g.fillRect(0, i - 2, 512, 4);
          }
          g.strokeStyle = '#4a8fc8';
          g.lineWidth = 12;
          g.beginPath();
          g.moveTo(0, 300);
          g.bezierCurveTo(160, 220, 300, 420, 512, 330);
          g.stroke();
        },
        [6, 6],
      ),
    [],
  );
  const groundMat = useRef<THREE.MeshStandardMaterial>(null);
  const flame = useRef<THREE.Mesh>(null);
  const others = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    // yerdeki tarlalar yavaşça kayar: balon rüzgârla ilerliyor
    if (groundMat.current?.map) groundMat.current.map.offset.y += Math.min(dt, 0.05) * 0.006;
    if (flame.current) {
      const f = 0.8 + Math.sin(t * 17) * 0.12 + Math.sin(t * 5.3) * 0.1;
      flame.current.scale.set(f, f * 1.2, f);
    }
    others.current?.children.forEach((b, i) => {
      b.position.y = b.userData.y + Math.sin(t * 0.35 + i * 1.7) * 0.6;
    });
  });

  const ropes = useMemo(() => {
    const out: { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const from = new THREE.Vector3(Math.cos(a) * 2.42, 0.44, Math.sin(a) * 2.42);
      const to = new THREE.Vector3(Math.cos(a) * 1.25, 5.3, Math.sin(a) * 1.25);
      const dir = to.clone().sub(from);
      out.push({ pos: from.clone().add(to).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), len: dir.length() });
    }
    return out;
  }, []);

  const fleet = useMemo(() => {
    const r = seeded(9);
    return Array.from({ length: low ? 4 : 7 }, (_, i) => {
      const a = (i / (low ? 4 : 7)) * Math.PI * 2 + r() * 0.5;
      const d = 13 + r() * 13;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, y: -5 + r() * 12, s: 0.35 + r() * 0.3, colors: BALLOON_COLORS[i % BALLOON_COLORS.length] };
    });
  }, [low]);
  const clouds = useMemo(() => {
    const r = seeded(31);
    return Array.from({ length: low ? 5 : 10 }, (_, i) => {
      const a = r() * Math.PI * 2;
      const d = 14 + r() * 24;
      return { p: [Math.cos(a) * d, -4 + r() * 10, Math.sin(a) * d] as [number, number, number], b: [4 + r() * 4, 1 + r(), 3 + r() * 3] as [number, number, number], seed: i + 3 };
    });
  }, [low]);

  return (
    <group>
      <SkyDome theme={theme} />
      <Sun theme={theme} quality={quality} />
      {/* sepet: hasır zemin ve alçak hasır duvar */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <cylinderGeometry args={[2.5, 2.45, 0.12, 48]} />
        <SurfaceMaterial tex="weathered_planks" repeat={[2.5, 2.5]} tint="#d8b48a" roughness={0.9} fallback="#9a6a3a" />
      </mesh>
      <mesh position={[0, 0.19, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.5, 2.45, 0.5, 48, 1, true]} />
        <meshStandardMaterial map={wicker} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.44, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.5, 0.06, 10, 96]} />
        <meshStandardMaterial color="#5a3418" roughness={0.6} />
      </mesh>
      {[Math.PI / 4, (Math.PI * 5) / 4].map(a => (
        <Model key={a} name="lantern" position={[Math.cos(a) * 2.5, 0.44, Math.sin(a) * 2.5]} scale={0.7} />
      ))}
      {ropes.map((r, i) => (
        <mesh key={i} position={r.pos} quaternion={r.quat}>
          <cylinderGeometry args={[0.007, 0.007, r.len, 5]} />
          <meshStandardMaterial color="#b49a74" />
        </mesh>
      ))}
      {/* brülör ve alevi */}
      <group position={[0, 5.0, 0]}>
        <mesh>
          <cylinderGeometry args={[0.28, 0.32, 0.3, 16]} />
          <meshStandardMaterial color="#9aa0a8" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh ref={flame} position={[0, 0.45, 0]}>
          <coneGeometry args={[0.18, 0.6, 12]} />
          <meshBasicMaterial color={new THREE.Color('#ffa040').multiplyScalar(3)} toneMapped={false} />
        </mesh>
        {quality !== 'low' && <pointLight color="#ffa040" intensity={3} distance={6} decay={2} position={[0, 0.6, 0]} />}
      </group>
      <group position={[0, 5.3, 0]}>
        <Envelope colors={BALLOON_COLORS[0]} />
      </group>

      {/* çevrede süzülen diğer balonlar */}
      <group ref={others}>
        {fleet.map((b, i) => (
          <group key={i} position={[b.x, b.y, b.z]} userData={{ y: b.y }} scale={b.s}>
            <Envelope colors={b.colors} />
            <mesh position={[0, -1.6, 0]}>
              <cylinderGeometry args={[0.7, 0.6, 0.8, 12]} />
              <meshStandardMaterial color="#8a5a32" roughness={0.9} />
            </mesh>
          </group>
        ))}
      </group>

      {/* aşağıda tarlalar, tepeler ve nehir */}
      <mesh position={[0, -9, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[110, 110]} />
        <meshStandardMaterial ref={groundMat} map={ground} roughness={1} />
      </mesh>
      {[
        [-14, -18, 9, '#5f8a45'],
        [18, -24, 12, '#6f9a4a'],
        [-22, 14, 10, '#7fa860'],
        [24, 18, 8, '#5f8a45'],
      ].map(([x, z, s, c], i) => (
        <mesh key={i} position={[x as number, -9, z as number]} scale={[s as number, (s as number) * 0.35, s as number]}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={c as string} roughness={1} />
        </mesh>
      ))}
      <Mountains y={-9} color="#7d8fa8" />
      <SoftClouds limit={low ? 60 : 140}>
        {clouds.map((c, i) => (
          <Cloud key={i} position={c.p} bounds={c.b} segments={low ? 6 : 12} volume={6} seed={c.seed} fade={20} growth={2} speed={0.15} />
        ))}
      </SoftClouds>
      <Gulls center={[6, 2, -10]} count={4} radius={[4, 7]} />
    </group>
  );
}
