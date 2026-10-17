import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityLevel } from '../store/useApp';
import type { Theme } from './themes';
import { Model } from './models';
import { SurfaceMaterial } from './textures';

/**
 * Açık hava atmosferleri: bulutların üstü, uçağın üstü, sıcak hava balonu, otobüs ve tekne.
 * Hepsi kodla üretilir (indirilecek dosya yok). Masa ve koltuklar 2.2 m yarıçapında boş bir zeminde kalır;
 * etraf alçak korkuluk ve geniş camlarla açık tutulur, manzara rahatça görülür.
 */
export function Outdoor({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  return (
    <>
      <SkyDome sky={theme.sky!} />
      <Sun theme={theme} quality={quality} />
      {theme.props === 'clouds' && <CloudsEnv quality={quality} />}
      {theme.props === 'plane' && <PlaneEnv quality={quality} />}
      {theme.props === 'balloon' && <BalloonEnv quality={quality} />}
      {theme.props === 'bus' && <BusEnv quality={quality} />}
      {theme.props === 'boat' && <BoatEnv quality={quality} />}
    </>
  );
}

// ---------- ortak parçalar ----------

/** tekrarlanabilir rastgele sayı: her açılışta sahne aynı görünür */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const between = (r: () => number, [a, b]: readonly [number, number]) => a + r() * (b - a);

function SkyDome({ sky }: { sky: NonNullable<Theme['sky']> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(sky.top) },
          horizon: { value: new THREE.Color(sky.horizon) },
          bottom: { value: new THREE.Color(sky.bottom) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.9, h), 0.75)) : mix(horizon, bottom, smoothstep(0.0, 0.35, -h));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [sky],
  );
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[52, 32, 16]} />
    </mesh>
  );
}

function Sun({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const sun = theme.sun!;
  const disc = useMemo(() => new THREE.Vector3(...sun.position).normalize().multiplyScalar(46), [sun]);
  const glow = useMemo(() => new THREE.Color(sun.color).multiplyScalar(3), [sun]);
  return (
    <>
      <directionalLight
        position={sun.position}
        color={sun.color}
        intensity={sun.intensity}
        castShadow={quality !== 'low'}
        shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={3.2}
        shadow-camera-bottom={-3.2}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <mesh position={disc}>
        <sphereGeometry args={[2.2, 24, 12]} />
        <meshBasicMaterial color={glow} toneMapped={false} fog={false} />
      </mesh>
    </>
  );
}

/** bir grubun çocuklarını tek eksende kaydırır, sona gelen başa sarar: geçip giden manzara */
function useScroll(ref: RefObject<THREE.Group | null>, axis: 'x' | 'z', speed: number, min: number, max: number) {
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = Math.min(dt, 0.05) * speed;
    const span = max - min;
    for (const c of g.children) {
      let v = c.position[axis] + d;
      if (v > max) v -= span;
      else if (v < min) v += span;
      c.position[axis] = v;
    }
  });
}

const puffGeo = new THREE.IcosahedronGeometry(1, 3);
const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#dfe9f5', emissiveIntensity: 0.38 });

interface CloudFieldProps {
  count: number;
  x: readonly [number, number];
  y: readonly [number, number];
  z: readonly [number, number];
  size: readonly [number, number];
  /** z ekseninde akış hızı (m/sn) */
  speed?: number;
  /** |x| bu değerden küçük olamaz: masanın içinden bulut geçmesin */
  clearX?: number;
  seed?: number;
  flat?: number;
}

/** pofuduk bulutlar: her biri birkaç küreden oluşur, hepsi tek çizimle (instanced) */
function CloudField({ count, x, y, z, size, speed = 0, clearX = 0, seed = 1, flat = 0.62 }: CloudFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const clouds = useMemo(() => {
    const r = seeded(seed * 977 + count);
    return Array.from({ length: count }, () => {
      let px = between(r, x);
      for (let i = 0; i < 20 && Math.abs(px) < clearX; i++) px = between(r, x);
      const n = 5 + Math.floor(r() * 4);
      return {
        p: new THREE.Vector3(px, between(r, y), between(r, z)),
        s: between(r, size),
        puffs: Array.from({ length: n }, (_, i) => ({
          o: new THREE.Vector3((i / (n - 1) - 0.5) * 2.4 + (r() - 0.5) * 0.4, (r() - 0.25) * 0.5, (r() - 0.5) * 1.1),
          s: 0.45 + r() * 0.55 + (1 - Math.abs(i / (n - 1) - 0.5) * 2) * 0.35,
        })),
      };
    });
  }, [count, x, y, z, size, clearX, seed]);
  const total = clouds.reduce((n, c) => n + c.puffs.length, 0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const placed = useRef(false);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m || (placed.current && !speed)) return;
    const d = Math.min(dt, 0.05) * speed;
    const span = z[1] - z[0];
    let k = 0;
    for (const c of clouds) {
      c.p.z += d;
      if (c.p.z > z[1]) c.p.z -= span;
      else if (c.p.z < z[0]) c.p.z += span;
      for (const puff of c.puffs) {
        dummy.position.copy(puff.o).multiplyScalar(c.s).add(c.p);
        const s = puff.s * c.s;
        dummy.scale.set(s, s * flat, s);
        dummy.updateMatrix();
        m.setMatrixAt(k++, dummy.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    placed.current = true;
  });
  return <instancedMesh ref={mesh} args={[puffGeo, cloudMat, total]} frustumCulled={false} />;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

/** yuvarlak zemin kenarında alçak korkuluk: görüşü kapatmaz */
function Railing({ radius, height = 0.6, color = '#c9ced6', posts = 28 }: { radius: number; height?: number; color?: string; posts?: number }) {
  return (
    <group>
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[radius, 0.025, 8, 96]} />
        <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, height * 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.012, 6, 96]} />
        <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => {
        const a = (i / posts) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, height / 2, Math.sin(a) * radius]}>
            <cylinderGeometry args={[0.018, 0.018, height, 6]} />
            <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------- bulutların üstü ----------

function CloudsEnv({ quality }: { quality: QualityLevel }) {
  const low = quality === 'low';
  return (
    <group>
      {/* masanın oturduğu yumuşak bulut zemini */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <cylinderGeometry args={[2.7, 2.2, 0.06, 48]} />
        <meshStandardMaterial color="#f7faff" roughness={1} emissive="#e6eef8" emissiveIntensity={0.25} />
      </mesh>
      <CloudBed />
      {/* uzakta, aşağıda uzanan bulut denizi */}
      <CloudField count={low ? 24 : 46} x={[-30, 30]} y={[-6, -3.5]} z={[-30, 30]} size={[2.4, 4.6]} speed={0.35} seed={3} flat={0.45} />
      {/* göz hizasında yavaşça süzülen bulutlar */}
      <CloudField count={low ? 8 : 16} x={[-24, 24]} y={[-1.5, 4]} z={[-26, 26]} size={[1.2, 2.6]} speed={0.3} clearX={7} seed={5} />
      <Rainbow />
      <Birds center={[0, 4.2, -9]} />
    </group>
  );
}

/** masanın altındaki bulut yatağı: ortası alçak (ayaklar görünür), kenarlar kabarık */
function CloudBed() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const puffs = useMemo(() => {
    const r = seeded(11);
    const out: { p: THREE.Vector3; s: number }[] = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = 2.1 + r() * 1.8;
      const s = 0.35 + r() * 0.45 + (d - 2.1) * 0.12;
      out.push({ p: new THREE.Vector3(Math.cos(a) * d, -0.32 + s * 0.35 + (d - 2.1) * 0.08, Math.sin(a) * d), s });
    }
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 2.2;
      out.push({ p: new THREE.Vector3(Math.cos(a) * d, -0.42, Math.sin(a) * d), s: 0.45 + r() * 0.3 });
    }
    return out;
  }, []);
  useFrame(() => {
    const m = mesh.current;
    if (!m || m.userData.done) return;
    const o = new THREE.Object3D();
    puffs.forEach((p, i) => {
      o.position.copy(p.p);
      o.scale.set(p.s, p.s * 0.6, p.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.userData.done = true;
  });
  return <instancedMesh ref={mesh} args={[puffGeo, cloudMat, puffs.length]} receiveShadow frustumCulled={false} />;
}

function Rainbow() {
  const colors = ['#ff4d4d', '#ff9f3d', '#ffe44d', '#5ee06a', '#4db8ff', '#6a6aff', '#b06aff'];
  return (
    <group position={[4, -5, -26]}>
      {colors.map((c, i) => (
        <mesh key={c}>
          <torusGeometry args={[15 - i * 0.45, 0.22, 6, 64, Math.PI]} />
          <meshBasicMaterial color={c} transparent opacity={0.28} depthWrite={false} fog={false} />
        </mesh>
      ))}
    </group>
  );
}

/** uzakta daire çizen kuşlar (iki ince kanat) */
function Birds({ center, count = 5 }: { center: [number, number, number]; count?: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((b, i) => {
      const a = t * 0.18 + i * 1.3;
      const rad = 3 + i * 0.7;
      b.position.set(Math.cos(a) * rad, Math.sin(t * 0.6 + i) * 0.4 + i * 0.2, Math.sin(a) * rad);
      b.rotation.y = -a;
      const flap = Math.sin(t * 7 + i * 2) * 0.5;
      b.children[0].rotation.x = flap;
      b.children[1].rotation.x = -flap;
    });
  });
  return (
    <group ref={group} position={center}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i}>
          <mesh position={[0, 0, 0.12]}>
            <boxGeometry args={[0.02, 0.01, 0.24]} />
            <meshBasicMaterial color="#2a2a33" />
          </mesh>
          <mesh position={[0, 0, -0.12]}>
            <boxGeometry args={[0.02, 0.01, 0.24]} />
            <meshBasicMaterial color="#2a2a33" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** ufukta sıradağlar: manzaraya derinlik verir */
function Mountains({ y, color, radius = 44 }: { y: number; color: string; radius?: number }) {
  const peaks = useMemo(() => {
    const r = seeded(101);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + r() * 0.15;
      return { x: Math.cos(a) * (radius + r() * 4), z: Math.sin(a) * (radius + r() * 4), h: 6 + r() * 9, w: 6 + r() * 6 };
    });
  }, [radius]);
  return (
    <group>
      {peaks.map((p, i) => (
        <mesh key={i} position={[p.x, y + p.h / 2, p.z]}>
          <coneGeometry args={[p.w, p.h, 7]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ---------- uçağın üstü ----------

function PlaneEnv({ quality }: { quality: QualityLevel }) {
  const low = quality === 'low';
  const white = '#eef2f6';
  const windows = useRef<THREE.InstancedMesh>(null);
  const streaks = useRef<THREE.Group>(null);
  useScroll(streaks, 'z', 22, -24, 24);
  useFrame(() => {
    const m = windows.current;
    if (!m || m.userData.done) return;
    const o = new THREE.Object3D();
    let k = 0;
    for (const side of [-1, 1])
      for (let i = 0; i < 26; i++) {
        o.position.set(side * 2.17, -1.75, -10 + i * 0.75);
        o.rotation.set(0, 0, side * 0.25);
        o.updateMatrix();
        m.setMatrixAt(k++, o.matrix);
      }
    m.instanceMatrix.needsUpdate = true;
    m.userData.done = true;
  });
  const wing = useMemo(() => {
    // geriye ok açılı kanat: kökü gövdede, ucu dar
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(12, 3.6);
    s.lineTo(12, 4.8);
    s.lineTo(0, 5.2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.06, bevelSegments: 2 });
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  const fin = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(3.4, 0);
    s.lineTo(4.4, 4.6);
    s.lineTo(3.0, 4.6);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    return g;
  }, []);

  return (
    <group>
      {/* gövdenin üstüne kurulmuş seyir güvertesi */}
      <mesh position={[0, -0.06, 0]} receiveShadow castShadow>
        <boxGeometry args={[4.8, 0.12, 4.8]} />
        <SurfaceMaterial tex="metal_plate" repeat={[3, 3]} tint="#c7ced8" metalness={0.6} roughness={0.45} fallback="#b8c0ca" />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[2.05, 2.15, 64]} />
        <meshStandardMaterial color="#f2b632" />
      </mesh>
      <group position={[0, 0, 0]}>
        {[-2.35, 2.35].map(v => (
          <group key={v}>
            <RailBar from={[v, 0.6, -2.35]} to={[v, 0.6, 2.35]} />
            <RailBar from={[-2.35, 0.6, v]} to={[2.35, 0.6, v]} />
          </group>
        ))}
        {[-2.35, -1.17, 0, 1.17, 2.35].flatMap(a => [
          [a, -2.35],
          [a, 2.35],
          [-2.35, a],
          [2.35, a],
        ]).map(([x, z], i) => (
          <mesh key={i} position={[x, 0.3, z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 6]} />
            <meshStandardMaterial color="#d7dde4" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* gövde: burun ileride (-z), kuyruk arkada */}
      <group position={[0, -2.32, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[2.2, 2.2, 24, 40, 1, true]} />
          <meshStandardMaterial color={white} metalness={0.35} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <cylinderGeometry args={[2.215, 2.215, 24, 40, 1, true, Math.PI * 0.42, Math.PI * 0.16]} />
          <meshStandardMaterial color="#1d4f86" metalness={0.3} roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, -12]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1.8, 1]}>
          <sphereGeometry args={[2.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={white} metalness={0.35} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 12]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[2.2, 5, 40, 1, true]} />
          <meshStandardMaterial color={white} metalness={0.35} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        <instancedMesh ref={windows} args={[undefined, undefined, 52]}>
          <boxGeometry args={[0.04, 0.32, 0.22]} />
          <meshStandardMaterial color="#1b2a3a" metalness={0.6} roughness={0.2} />
        </instancedMesh>
        {/* kanatlar ve motorlar */}
        {[1, -1].map(side => (
          <group key={side} position={[side * 1.6, -1.2, -1.2]} scale={[side, 1, 1]}>
            <mesh geometry={wing} castShadow receiveShadow>
              <meshStandardMaterial color={white} metalness={0.4} roughness={0.35} />
            </mesh>
            <group position={[5, -0.8, 1.2]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.75, 0.62, 3, 28]} />
                <meshStandardMaterial color="#d9dee5" metalness={0.6} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0, -1.51]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.62, 0.62, 0.02, 28]} />
                <meshStandardMaterial color="#20252c" metalness={0.8} roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.5, 0]}>
                <boxGeometry args={[0.1, 0.5, 1.6]} />
                <meshStandardMaterial color="#d9dee5" metalness={0.6} roughness={0.3} />
              </mesh>
            </group>
            <mesh position={[12.05, 0.02, 4.3]}>
              <sphereGeometry args={[0.1, 10, 10]} />
              <meshBasicMaterial color={side > 0 ? '#3dff6a' : '#ff3d3d'} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {/* kuyruk */}
        <mesh geometry={fin} position={[0.09, 1.6, 10.5]} castShadow>
          <meshStandardMaterial color="#1d4f86" metalness={0.3} roughness={0.4} />
        </mesh>
        {[1, -1].map(side => (
          <mesh key={side} position={[side * 2.4, 0.4, 13]} rotation={[0, side * 0.35, 0]}>
            <boxGeometry args={[4, 0.14, 1.6]} />
            <meshStandardMaterial color={white} metalness={0.4} roughness={0.35} />
          </mesh>
        ))}
      </group>

      {/* hızla geçen bulutlar: altta bulut denizi, yanlarda ve üstte parçalar */}
      <CloudField count={low ? 26 : 50} x={[-34, 34]} y={[-9, -6]} z={[-34, 34]} size={[2.5, 5]} speed={7} seed={21} flat={0.42} />
      <CloudField count={low ? 8 : 16} x={[-26, 26]} y={[-2.5, 5]} z={[-34, 34]} size={[1.2, 2.6]} speed={11} clearX={7} seed={22} />
      {/* rüzgâr çizgileri */}
      <group ref={streaks}>
        {Array.from({ length: low ? 8 : 18 }, (_, i) => {
          const r = seeded(i + 40);
          const side = i % 2 ? 1 : -1;
          return (
            <mesh key={i} position={[side * (3 + r() * 8), -0.5 + r() * 3.5, -24 + r() * 48]}>
              <boxGeometry args={[0.01, 0.01, 2.5 + r() * 2]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function RailBar({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    return {
      pos: a.clone().add(b).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
      len: dir.length(),
    };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[0.025, 0.025, len, 8]} />
      <meshStandardMaterial color="#d7dde4" metalness={0.7} roughness={0.3} />
    </mesh>
  );
}

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

function Envelope({ colors, scale = 1 }: { colors: string[]; scale?: number }) {
  const tex = useMemo(() => stripes(colors), [colors]);
  return (
    <mesh scale={scale} castShadow>
      <latheGeometry args={[ENVELOPE_PROFILE, 32]} />
      <meshStandardMaterial map={tex} roughness={0.75} side={THREE.DoubleSide} />
    </mesh>
  );
}

const BALLOON_COLORS = [
  ['#e5322d', '#f5c400', '#e5322d', '#ffffff'],
  ['#2b7de9', '#ffffff', '#2b7de9', '#f2b632'],
  ['#8a3ae0', '#ff7bc0', '#ffffff'],
  ['#2ca85a', '#f5e7c0', '#e07a2c'],
  ['#ff6a3d', '#ffd23d'],
];

function BalloonEnv({ quality }: { quality: QualityLevel }) {
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

  return (
    <group>
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
        <planeGeometry args={[140, 140]} />
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
      <CloudField count={low ? 6 : 12} x={[-30, 30]} y={[-5, 6]} z={[-30, 30]} size={[1.2, 2.4]} speed={0.4} clearX={9} seed={31} />
      <Birds center={[6, 2, -10]} count={4} />
    </group>
  );
}

// ---------- otobüs ----------

const BUS = { len: 10, halfW: 2.3, h: 2.7, sill: 0.62 };

function BusEnv({ quality }: { quality: QualityLevel }) {
  const low = quality === 'low';
  const scenery = useRef<THREE.Group>(null);
  const dashes = useRef<THREE.Group>(null);
  // otobüs -x yönüne gidiyor: manzara +x yönüne akar
  useScroll(scenery, 'x', 6.5, -34, 34);
  useScroll(dashes, 'x', 6.5, -30, 30);
  const facade = useMemo(
    () =>
      canvasTexture(64, 128, g => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 64, 128);
        for (let y = 6; y < 128; y += 16)
          for (let x = 6; x < 64; x += 16) {
            g.fillStyle = Math.random() > 0.35 ? '#2a3a4a' : '#ffe9a8';
            g.fillRect(x, y, 9, 10);
          }
      }, [1, 1.6]),
    [],
  );
  const buildings = useMemo(() => {
    const r = seeded(51);
    const tones = ['#e8c39e', '#c9d6e3', '#e3a58f', '#d9d2c3', '#a9c4b5', '#f0dcae', '#b8b0c9'];
    const out: { x: number; z: number; w: number; h: number; d: number; c: string }[] = [];
    for (const side of [-1, 1])
      for (let x = -34; x < 34; x += 5.6) {
        const h = 3 + r() * 8;
        out.push({ x: x + r() * 1.5, z: side * (14 + r() * 4), w: 3.6 + r() * 1.6, h, d: 3 + r() * 2, c: tones[Math.floor(r() * tones.length)] });
      }
    return out;
  }, []);
  const trees = useMemo(() => {
    const r = seeded(52);
    const out: { x: number; z: number; s: number }[] = [];
    for (const side of [-1, 1]) for (let x = -34; x < 34; x += 4.2) out.push({ x: x + r() * 2, z: side * (7 + r() * 4), s: 0.8 + r() * 0.5 });
    return out;
  }, []);
  const glass = <meshStandardMaterial color="#bfe3ff" transparent opacity={0.12} roughness={0.05} metalness={0.1} depthWrite={false} />;
  const pillars = Array.from({ length: 7 }, (_, i) => -BUS.len / 2 + (i * BUS.len) / 6);

  return (
    <group>
      {/* zemin, alt duvarlar ve tavan */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[BUS.len, 0.1, BUS.halfW * 2]} />
        <SurfaceMaterial tex="rubber_tiles" repeat={[5, 2.3]} tint="#9aa4b4" roughness={0.85} fallback="#3b4450" />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BUS.len - 0.4, 0.06]} />
        <meshStandardMaterial color="#f2b632" />
      </mesh>
      {[-1, 1].map(side => (
        <group key={side}>
          <mesh position={[0, BUS.sill / 2, side * BUS.halfW]} receiveShadow>
            <boxGeometry args={[BUS.len, BUS.sill, 0.08]} />
            <meshStandardMaterial color="#efe6d2" roughness={0.7} />
          </mesh>
          <mesh position={[0, BUS.sill + 0.02, side * (BUS.halfW - 0.05)]}>
            <boxGeometry args={[BUS.len, 0.06, 0.14]} />
            <meshStandardMaterial color="#c0392b" roughness={0.5} />
          </mesh>
          <mesh position={[0, (BUS.sill + BUS.h) / 2, side * BUS.halfW]}>
            <planeGeometry args={[BUS.len, BUS.h - BUS.sill]} />
            {glass}
          </mesh>
          {pillars.map(x => (
            <mesh key={x} position={[x, (BUS.sill + BUS.h) / 2, side * BUS.halfW]}>
              <boxGeometry args={[0.07, BUS.h - BUS.sill, 0.09]} />
              <meshStandardMaterial color="#d8d2c4" roughness={0.5} />
            </mesh>
          ))}
          {/* tavana yakın tutunma borusu */}
          <mesh position={[0, BUS.h - 0.3, side * (BUS.halfW - 0.35)]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.018, BUS.len - 0.4, 8]} />
            <meshStandardMaterial color="#d0d4d8" metalness={0.8} roughness={0.25} />
          </mesh>
          {/* tavan ışık şeridi */}
          <mesh position={[0, BUS.h - 0.07, side * 1.2]}>
            <boxGeometry args={[BUS.len - 1, 0.03, 0.12]} />
            <meshBasicMaterial color={new THREE.Color('#fff4dc').multiplyScalar(1.6)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, BUS.h, 0]}>
        <boxGeometry args={[BUS.len + 0.1, 0.1, BUS.halfW * 2 + 0.1]} />
        <meshStandardMaterial color="#fbf8f2" roughness={0.8} emissive="#fff8ee" emissiveIntensity={0.25} />
      </mesh>
      {quality !== 'low' && <pointLight position={[0, 2.2, 0]} color="#fff4dc" intensity={2.2} distance={6} decay={2} />}
      {/* ön cam, gösterge ve direksiyon; arka cam */}
      <mesh position={[-BUS.len / 2, 1.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[BUS.halfW * 2, 1.9]} />
        {glass}
      </mesh>
      <mesh position={[-BUS.len / 2 + 0.35, 0.5, 0]} receiveShadow>
        <boxGeometry args={[0.7, 1, BUS.halfW * 2]} />
        <meshStandardMaterial color="#2c3138" roughness={0.6} />
      </mesh>
      <mesh position={[-BUS.len / 2 + 0.8, 1.15, -1.3]} rotation={[0, 0, 1.1]}>
        <torusGeometry args={[0.24, 0.025, 8, 32]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[BUS.len / 2, BUS.sill / 2, 0]}>
        <boxGeometry args={[0.08, BUS.sill, BUS.halfW * 2]} />
        <meshStandardMaterial color="#efe6d2" roughness={0.7} />
      </mesh>
      <mesh position={[BUS.len / 2, (BUS.sill + BUS.h) / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[BUS.halfW * 2, BUS.h - BUS.sill]} />
        {glass}
      </mesh>

      {/* yol: asfalt, akan şerit çizgileri, kaldırımlar */}
      <mesh position={[0, -0.75, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 10]} />
        <meshStandardMaterial color="#4a4d52" roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.82, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color="#7fa860" roughness={1} />
      </mesh>
      {[-1, 1].map(side => (
        <mesh key={side} position={[0, -0.68, side * 5.2]}>
          <boxGeometry args={[80, 0.15, 0.6]} />
          <meshStandardMaterial color="#b9b4aa" roughness={0.9} />
        </mesh>
      ))}
      <group ref={dashes}>
        {Array.from({ length: 15 }, (_, i) => (
          <mesh key={i} position={[-30 + i * 4, -0.73, 3.2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2, 0.15]} />
            <meshBasicMaterial color="#f2f2f2" />
          </mesh>
        ))}
      </group>
      <group ref={scenery}>
        {buildings.map((b, i) => (
          <mesh key={`b${i}`} position={[b.x, -0.75 + b.h / 2, b.z]} castShadow={false}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.c} map={facade} roughness={0.85} />
          </mesh>
        ))}
        {(low ? trees.filter((_, i) => i % 2 === 0) : trees).map((t, i) => (
          <group key={`t${i}`} position={[t.x, -0.75, t.z]} scale={t.s}>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.08, 0.1, 1, 6]} />
              <meshStandardMaterial color="#6b4a2a" />
            </mesh>
            <mesh position={[0, 1.5, 0]}>
              <icosahedronGeometry args={[0.75, 1]} />
              <meshStandardMaterial color="#4f8a3a" roughness={0.9} flatShading />
            </mesh>
          </group>
        ))}
        {[-1, 1].flatMap(side =>
          Array.from({ length: 6 }, (_, i) => (
            <Model key={`l${side}${i}`} name="streetLamp" position={[-33 + i * 11.3 + (side > 0 ? 5.6 : 0), -0.75, side * 5.7]} rotation={[0, side > 0 ? 0 : Math.PI, 0]} castShadow={false} />
          )),
        )}
      </group>
      <CloudField count={low ? 6 : 10} x={[-30, 30]} y={[8, 14]} z={[-30, 30]} size={[2, 3.5]} speed={0.2} seed={61} />
    </group>
  );
}

// ---------- tekne ----------

function boatShape() {
  const s = new THREE.Shape();
  // şekil düzleminde y = -z: pruva (burun) ileride, -z yönünde
  s.moveTo(-2.45, -4.6);
  s.lineTo(2.45, -4.6);
  s.bezierCurveTo(2.75, -0.5, 2.65, 2.4, 0, 6);
  s.bezierCurveTo(-2.65, 2.4, -2.75, -0.5, -2.45, -4.6);
  return s;
}

function BoatEnv({ quality }: { quality: QualityLevel }) {
  const low = quality === 'low';
  const shape = useMemo(boatShape, []);
  const deck = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.12, 0);
    return g;
  }, [shape]);
  const hull = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.04, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -1.02, 0);
    return g;
  }, [shape]);
  const rail = useMemo(() => {
    const pts = shape.getSpacedPoints(60).slice(0, -1).map(p => new THREE.Vector3(p.x * 0.95, 0.55, -p.y * 0.95 + 0.05));
    return { curve: new THREE.CatmullRomCurve3(pts, true), posts: pts.filter((_, i) => i % 3 === 0) };
  }, [shape]);
  const sail = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0, 5.2);
    s.lineTo(1.8, 0);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateY(-Math.PI / 2);
    return g;
  }, []);

  const water = useRef<THREE.Mesh>(null);
  const world = useRef<THREE.Group>(null);
  const islands = useRef<THREE.Group>(null);
  useScroll(islands, 'z', 0.5, -36, 36);
  const segs = low ? 40 : 64;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // dünyayı hafifçe sallamak, tekneyi sallamakla aynı hissi verir; masa ve kartlar sabit kalır
    if (world.current) {
      world.current.rotation.z = Math.sin(t * 0.5) * 0.018;
      world.current.rotation.x = Math.sin(t * 0.37 + 1) * 0.012;
    }
    const m = water.current;
    if (!m) return;
    const pos = (m.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.32 + t * 1.1) * 0.13 + Math.sin(y * 0.45 - t * 0.8) * 0.09 + Math.sin((x + y) * 0.9 + t * 1.7) * 0.04);
    }
    pos.needsUpdate = true;
  });

  return (
    <group>
      {/* güverte, gövde ve alçak korkuluk */}
      <mesh geometry={deck} receiveShadow castShadow>
        <SurfaceMaterial tex="wood_floor_deck" repeat={[0.32, 0.32]} tint="#e8c9a4" roughness={0.7} fallback="#b07a4a" />
      </mesh>
      <mesh geometry={hull} castShadow>
        <meshStandardMaterial color="#f4f1ea" roughness={0.5} />
      </mesh>
      {/* su hattındaki lacivert şerit */}
      <mesh geometry={hull} position={[0, -0.42, 0]} scale={[1.015, 0.4, 1.01]}>
        <meshStandardMaterial color="#1f5a8a" roughness={0.5} />
      </mesh>
      <mesh>
        <tubeGeometry args={[rail.curve, 120, 0.028, 8, true]} />
        <meshStandardMaterial color="#d8c9a8" metalness={0.5} roughness={0.35} />
      </mesh>
      {rail.posts.map((p, i) => (
        <mesh key={i} position={[p.x, 0.27, p.z]}>
          <cylinderGeometry args={[0.02, 0.02, 0.55, 6]} />
          <meshStandardMaterial color="#d8c9a8" metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      {/* pruvada, yana alınmış direk ve yelken: masanın arkasındaki manzarayı kapatmaz */}
      <group position={[1.15, 0, -3.7]}>
        <mesh position={[0, 3.4, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.08, 6.8, 10]} />
          <meshStandardMaterial color="#6b4a2a" roughness={0.6} />
        </mesh>
        <mesh geometry={sail} position={[0.02, 1.7, 0]} castShadow>
          <meshStandardMaterial color="#fbf6ea" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.7, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 1.8, 8]} />
          <meshStandardMaterial color="#6b4a2a" roughness={0.6} />
        </mesh>
      </group>
      {/* güvertede ip ışıkları */}
      {rail.posts.map((p, i) =>
        i % 2 ? null : (
          <mesh key={`l${i}`} position={[p.x, 0.62, p.z]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color={new THREE.Color(i % 4 ? '#ffd27a' : '#ff9a5a').multiplyScalar(2.5)} toneMapped={false} />
          </mesh>
        ),
      )}

      {/* güverte eşyaları: can simitleri korkulukta, kıçta fenerler ve sandıklar, pruvada varil */}
      <Model name="lifebuoy" position={[2.5, 0.32, 0.6]} rotation={[0, Math.PI / 2, 0]} scale={0.7} />
      <Model name="lifebuoy" position={[-2.5, 0.32, -0.4]} rotation={[0, -Math.PI / 2, 0]} scale={0.7} />
      <Model name="lantern" position={[2.0, 0, 4.1]} scale={0.9} />
      <Model name="lantern" position={[-2.0, 0, 4.1]} scale={0.9} />
      {quality !== 'low' && <pointLight position={[2.0, 0.35, 4.1]} color="#ffb070" intensity={0.8} distance={2.5} decay={2} />}
      <Model name="crate" position={[1.3, 0, 3.7]} rotation={[0, 0.3, 0]} scale={0.9} />
      <Model name="crate" position={[0.6, 0, 3.9]} rotation={[0, -0.15, 0]} scale={0.75} />
      <Model name="barrel" position={[-0.9, 0, -3.5]} scale={0.75} />

      {/* sallanan dünya: dalgalar, adalar, martılar */}
      <group ref={world}>
        <mesh ref={water} position={[0, -0.55, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[80, 80, segs, segs]} />
          <meshStandardMaterial color="#2d6f93" roughness={0.22} metalness={0.15} flatShading />
        </mesh>
        <group ref={islands}>
          {[
            [-20, -26, 6, '#6f9a4a'],
            [22, -10, 4.5, '#7fa860'],
            [-26, 12, 5, '#5f8a45'],
            [18, 24, 7, '#6f9a4a'],
          ].map(([x, z, s, c], i) => (
            <group key={i} position={[x as number, -0.6, z as number]}>
              <mesh scale={[s as number, (s as number) * 0.45, s as number]}>
                <sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={c as string} roughness={1} flatShading />
              </mesh>
              <mesh scale={[(s as number) * 1.15, 0.2, (s as number) * 1.15]}>
                <cylinderGeometry args={[1, 1, 1, 24]} />
                <meshStandardMaterial color="#e9d6a6" roughness={1} />
              </mesh>
            </group>
          ))}
        </group>
        <Birds center={[-4, 4, -8]} count={4} />
      </group>
      <CloudField count={low ? 6 : 12} x={[-30, 30]} y={[7, 13]} z={[-30, 30]} size={[2, 3.6]} speed={0.25} seed={71} />
    </group>
  );
}
