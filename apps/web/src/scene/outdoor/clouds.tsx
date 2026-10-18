import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cloud } from '@react-three/drei';
import * as THREE from 'three';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { Airliner } from './airliner';
import { BALLOON_COLORS, Envelope } from './balloon';
import { CloudSea, Gulls, SkyDome, SoftClouds, Sun, seeded } from './common';

/**
 * Bulutların üstü: masa yumuşak bir bulut adasının üstünde. Çevresi kabarık bulut kümeleriyle sarılı,
 * aşağıda uçsuz bucaksız bulut denizi, uzakta kule gibi yükselen kümülüsler, gökkuşağı, süzülen
 * balonlar, martılar ve iz bırakarak geçen bir yolcu uçağı.
 */
export function CloudsEnv({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const low = quality === 'low';
  const plane = useRef<THREE.Group>(null);
  const balloons = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // uzakta, ufka paralel geçen uçak: gökyüzü küresinin içinde kalan bir hat boyunca ~45 sn'de bir geçer
    if (plane.current) plane.current.position.x = 34 - ((t * 1.6) % 68);
    balloons.current?.children.forEach((b, i) => {
      b.position.y = b.userData.y + Math.sin(t * 0.3 + i * 2.1) * 0.5;
    });
  });

  const rim = useMemo(() => {
    const r = seeded(41);
    const n = low ? 9 : 16;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + r() * 0.2;
      const d = 3.3 + r() * 0.9;
      return { p: [Math.cos(a) * d, -0.5 + r() * 0.15, Math.sin(a) * d] as [number, number, number], b: [1.0, 0.25, 1.0] as [number, number, number], seed: i + 7 };
    });
  }, [low]);
  const towers = useMemo(() => {
    const r = seeded(43);
    const n = low ? 6 : 12;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + r() * 0.4;
      const d = 22 + r() * 22;
      return { p: [Math.cos(a) * d, -5 + r() * 5, Math.sin(a) * d] as [number, number, number], b: [6 + r() * 5, 3 + r() * 4, 6 + r() * 4] as [number, number, number], seed: i + 21 };
    });
  }, [low]);
  const fleet = useMemo(() => {
    const r = seeded(13);
    return Array.from({ length: low ? 2 : 4 }, (_, i) => {
      const a = 0.6 + i * 1.5 + r() * 0.5;
      const d = 24 + r() * 14;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, y: 1 + r() * 7, s: 0.3 + r() * 0.2, colors: BALLOON_COLORS[(i + 1) % BALLOON_COLORS.length] };
    });
  }, [low]);

  return (
    <group>
      <SkyDome theme={theme} />
      <Sun theme={theme} quality={quality} />
      {/* masanın oturduğu yumuşak bulut zemini: gölgeleri alır */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <cylinderGeometry args={[2.75, 2.3, 0.06, 64]} />
        <meshStandardMaterial color="#f7faff" roughness={1} emissive="#e3ebf6" emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, -0.45, 0]} scale={[3.1, 0.55, 3.1]}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshStandardMaterial color="#eef3fa" roughness={1} emissive="#dfe8f3" emissiveIntensity={0.25} />
      </mesh>
      <SoftClouds limit={low ? 140 : 320}>
        {/* adanın kabarık kenarı */}
        {rim.map((c, i) => (
          <Cloud key={`r${i}`} position={c.p} bounds={c.b} segments={low ? 4 : 7} volume={0.9} seed={c.seed} fade={4} growth={0.3} speed={0.08} opacity={0.95} />
        ))}
        {/* uzakta yükselen kümülüs kuleleri */}
        {towers.map((c, i) => (
          <Cloud key={`t${i}`} position={c.p} bounds={c.b} segments={low ? 8 : 16} volume={9} seed={c.seed} fade={40} growth={3} speed={0.05} />
        ))}
      </SoftClouds>
      <CloudSea y={-7} speed={0.6} cover={0.78} sun={theme.sun!.position} shade="#b3c0d2" gap="#8ea4bf" fog={theme.fog[0]} fogNear={16} fogFar={52} quality={quality} />
      <Rainbow />
      <group ref={balloons}>
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
      {/* uzaktan geçen yolcu uçağı (burnu -x yönünde) */}
      <group ref={plane} position={[34, 13, -36]} rotation={[0, Math.PI / 2, 0]} scale={0.32}>
        <Airliner far contrails={!low} fanSpeed={8} />
      </group>
      <Gulls center={[0, 3.2, -9]} count={low ? 3 : 6} radius={[3, 8]} seed={2} />
    </group>
  );
}

/** yumuşak kenarlı tek parça gökkuşağı: yarıçap boyunca renk geçişi */
function Rainbow() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          vec3 spectrum(float x) {
            return clamp(vec3(abs(x * 6.0 - 3.0) - 1.0, 2.0 - abs(x * 6.0 - 2.0), 2.0 - abs(x * 6.0 - 4.0)), 0.0, 1.0);
          }
          void main() {
            float r = vUv.y;
            float band = smoothstep(0.0, 0.18, r) * smoothstep(1.0, 0.82, r);
            float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
            gl_FragColor = vec4(spectrum(1.0 - r) * 1.1, band * ends * 0.32);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  const geo = useMemo(() => {
    // yarım halka; uv.x yay boyunca, uv.y iç kenardan dış kenara
    const inner = 13;
    const outer = 15.6;
    const seg = 96;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      for (const [k, r] of [inner, outer].entries()) {
        pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
        uv.push(i / seg, k);
      }
      if (i < seg) {
        const b = i * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, []);
  return <mesh geometry={geo} material={mat} position={[6, -6, -40]} rotation={[0, -0.25, 0]} renderOrder={1} />;
}
