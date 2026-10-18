import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cloud } from '@react-three/drei';
import * as THREE from 'three';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { SurfaceMaterial } from '../textures';
import { Airliner } from './airliner';
import { CloudSea, RailBar, SkyDome, SoftClouds, Sun, seeded, useScroll } from './common';

/** uçak -z yönünde ~250 m/sn uçar; manzara ölçekli olduğundan bulutlar daha yavaş akar */
const SPEED = 26;

/**
 * Uçağın üstü: gövdenin tepesine kurulmuş seyir güvertesi. Altta kodla üretilmiş yolcu uçağı
 * (kanatlar, motorlar, kuyruk, iz bulutları), çok aşağıda bulut denizi, yanlardan hızla geçen bulutlar.
 */
export function PlaneEnv({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const low = quality === 'low';
  const world = useRef<THREE.Group>(null);
  const passing = useRef<THREE.Group>(null);
  const streaks = useRef<THREE.Group>(null);
  useScroll(passing, 'z', SPEED, -48, 48);
  useScroll(streaks, 'z', 34, -24, 24);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // uçak hafifçe yalpalar: dünya döner, güverte ve masa yerinde kalır
    if (world.current) {
      world.current.rotation.z = Math.sin(t * 0.21) * 0.014 + Math.sin(t * 0.77) * 0.002;
      world.current.rotation.x = Math.sin(t * 0.16 + 1) * 0.008;
      world.current.position.y = Math.sin(t * 0.5) * 0.12;
    }
  });
  const clouds = useMemo(() => {
    const r = seeded(23);
    return Array.from({ length: low ? 7 : 14 }, (_, i) => {
      // uçağın gövdesinden ve kanatlarından uzak: ya yanlarda ya da aşağıda
      const side = i % 2 ? 1 : -1;
      const below = r() < 0.4;
      return {
        p: [side * (below ? 6 + r() * 20 : 24 + r() * 14), below ? -11 - r() * 5 : -4 + r() * 12, -48 + r() * 96] as [number, number, number],
        b: [5 + r() * 5, 1.2 + r() * 1.5, 4 + r() * 4] as [number, number, number],
        seed: i + 1,
      };
    });
  }, [low]);

  return (
    <group>
      <group ref={world}>
        <SkyDome theme={theme} />
        <CloudSea y={-17} speed={SPEED} cover={0.66} sun={theme.sun!.position} shade="#a7b6c9" gap="#6884a2" fog={theme.fog[0]} fogNear={20} fogFar={52} quality={quality} />
        <SoftClouds limit={low ? 90 : 220}>
          <group ref={passing}>
            {clouds.map((c, i) => (
              <Cloud key={i} position={c.p} bounds={c.b} segments={low ? 7 : 14} volume={7} seed={c.seed} fade={30} growth={2} speed={0.1} color="#ffffff" />
            ))}
          </group>
        </SoftClouds>
        {/* rüzgâr çizgileri */}
        <group ref={streaks}>
          {Array.from({ length: low ? 8 : 18 }, (_, i) => {
            const r = seeded(i + 40);
            const side = i % 2 ? 1 : -1;
            return (
              <mesh key={i} position={[side * (3 + r() * 8), -0.5 + r() * 3.5, -24 + r() * 48]}>
                <boxGeometry args={[0.01, 0.01, 2.5 + r() * 2]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
              </mesh>
            );
          })}
        </group>
      </group>
      <Sun theme={theme} quality={quality} />
      <Deck />
      {/* gövde ekseni güvertenin 2.32 m altında: gövdenin tepesi güvertenin hemen altında kalır */}
      <group position={[0, -2.32, 0]}>
        <Airliner contrails={!low} />
      </group>
    </group>
  );
}

/** gövdenin üstüne kurulmuş metal güverte: kaymaz plaka, sarı çizgi, kenarda korkuluk ve küçük ışıklar */
function Deck() {
  const posts = [-2.35, -1.17, 0, 1.17, 2.35].flatMap(a => [
    [a, -2.35],
    [a, 2.35],
    [-2.35, a],
    [2.35, a],
  ]);
  return (
    <group>
      <mesh position={[0, -0.06, 0]} receiveShadow castShadow>
        <boxGeometry args={[4.8, 0.12, 4.8]} />
        <SurfaceMaterial tex="metal_plate" repeat={[3, 3]} tint="#c7ced8" metalness={0.6} roughness={0.45} fallback="#b8c0ca" />
      </mesh>
      {/* güverteyi gövdeye bağlayan ayaklar */}
      {[-1.9, 1.9].flatMap(x =>
        [-1.9, 1.9].map(z => (
          <mesh key={`${x}${z}`} position={[x, -0.32, z]}>
            <boxGeometry args={[0.16, 0.42, 0.16]} />
            <meshStandardMaterial color="#9aa3ad" metalness={0.7} roughness={0.35} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[2.05, 2.15, 64]} />
        <meshStandardMaterial color="#f2b632" />
      </mesh>
      {/* kenar pervazı */}
      {[-1, 1].flatMap(s => [
        <mesh key={`x${s}`} position={[s * 2.38, 0.03, 0]}>
          <boxGeometry args={[0.06, 0.06, 4.82]} />
          <meshStandardMaterial color="#f2b632" metalness={0.3} roughness={0.5} />
        </mesh>,
        <mesh key={`z${s}`} position={[0, 0.03, s * 2.38]}>
          <boxGeometry args={[4.82, 0.06, 0.06]} />
          <meshStandardMaterial color="#f2b632" metalness={0.3} roughness={0.5} />
        </mesh>,
      ])}
      {[-2.35, 2.35].map(v => (
        <group key={v}>
          <RailBar from={[v, 0.6, -2.35]} to={[v, 0.6, 2.35]} />
          <RailBar from={[-2.35, 0.6, v]} to={[2.35, 0.6, v]} />
          <RailBar from={[v, 0.32, -2.35]} to={[v, 0.32, 2.35]} radius={0.014} />
          <RailBar from={[-2.35, 0.32, v]} to={[2.35, 0.32, v]} radius={0.014} />
        </group>
      ))}
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <cylinderGeometry args={[0.02, 0.02, 0.6, 6]} />
          <meshStandardMaterial color="#d7dde4" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      {/* köşelerde küçük ikaz ışıkları */}
      {[-2.35, 2.35].flatMap(x =>
        [-2.35, 2.35].map(z => (
          <mesh key={`l${x}${z}`} position={[x, 0.64, z]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshBasicMaterial color={new THREE.Color('#ffb03d').multiplyScalar(3)} toneMapped={false} />
          </mesh>
        )),
      )}
    </group>
  );
}
