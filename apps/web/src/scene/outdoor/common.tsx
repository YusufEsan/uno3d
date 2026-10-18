import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Clouds } from '@react-three/drei';
import * as THREE from 'three';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { loadSky } from './sky';

/** Açık hava atmosferlerinin ortak parçaları: gökyüzü, güneş, bulutlar, kuşlar, korkuluk */

/** tekrarlanabilir rastgele sayı: her açılışta sahne aynı görünür */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export const between = (r: () => number, [a, b]: readonly [number, number]) => a + r() * (b - a);

/** kamera uzak düzlemi 60 m: gökyüzü küresi bunun hemen içinde kalır, sahnedeki her şey kürenin içindedir */
export const SKY_R = 56;

/**
 * Gökyüzü küresi: temanın gerçek gökyüzü panoraması; panorama inene kadar temanın renk geçişi.
 * Sisten etkilenmez, ufuk rengi sisin rengiyle aynı tutulur.
 */
export function SkyDome({ theme }: { theme: Theme }) {
  const sky = theme.sky!;
  const [map, setMap] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!theme.skyMap) return;
    let alive = true;
    let tex: THREE.Texture | null = null;
    loadSky(theme.skyMap)
      .then(t => {
        if (!alive) return;
        tex = t;
        setMap(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
      setMap(null);
      // doku önbellekte kalır; tekrar kullanılınca ekran kartına yeniden yüklenir
      tex?.dispose();
    };
  }, [theme.skyMap]);
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
          map: { value: null as THREE.Texture | null },
          useMap: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
          uniform sampler2D map; uniform float useMap;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.9, h), 0.75)) : mix(horizon, bottom, smoothstep(0.0, 0.35, -h));
            if (useMap > 0.5) {
              // three.js'in eşdikdörtgen (equirect) eşlemesiyle aynı: ortam yansımalarıyla birebir örtüşür
              vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
              c = texture2D(map, uv).rgb;
            }
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [sky],
  );
  useEffect(() => {
    mat.uniforms.map.value = map;
    mat.uniforms.useMap.value = map ? 1 : 0;
  }, [mat, map]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[SKY_R, 48, 24]} />
    </mesh>
  );
}

/** güneş ışığı; panoramalı temalarda güneşin kendisi panoramada görünür, ayrı bir disk çizilmez */
export function Sun({ theme, quality, extent = 3.2 }: { theme: Theme; quality: QualityLevel; extent?: number }) {
  const sun = theme.sun!;
  const disc = useMemo(() => new THREE.Vector3(...sun.position).normalize().multiplyScalar(SKY_R - 6), [sun]);
  const glow = useMemo(() => new THREE.Color(sun.color).multiplyScalar(3), [sun]);
  return (
    <>
      <directionalLight
        position={sun.position}
        color={sun.color}
        intensity={sun.intensity}
        castShadow={quality !== 'low'}
        shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {!theme.skyMap && (
        <mesh position={disc}>
          <sphereGeometry args={[2.2, 24, 12]} />
          <meshBasicMaterial color={glow} toneMapped={false} fog={false} />
        </mesh>
      )}
    </>
  );
}

/** bir grubun çocuklarını tek eksende kaydırır, sona gelen başa sarar: geçip giden manzara */
export function useScroll(ref: RefObject<THREE.Group | null>, axis: 'x' | 'z', speed: number, min: number, max: number) {
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

/** koşu bandı: grubun tamamı kayar, bir boy gidince geri sarar (içerik iki kopya hâlinde dizilir) */
export function useTreadmill(ref: RefObject<THREE.Group | null>, axis: 'x' | 'z', speed: number, span: number) {
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    let v = g.position[axis] + Math.min(dt, 0.05) * speed;
    if (v > span) v -= span;
    else if (v < 0) v += span;
    g.position[axis] = v;
  });
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

// ---------- gürültü (dokular kodla üretilir) ----------

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** döşenebilir değer gürültüsü: period hücrede bir tekrar eder (kenarlarda dikiş olmaz) */
export function tileNoise(x: number, y: number, period: number, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const p = (v: number) => ((v % period) + period) % period;
  const a = hash2(p(xi), p(yi), seed);
  const b = hash2(p(xi + 1), p(yi), seed);
  const c = hash2(p(xi), p(yi + 1), seed);
  const d = hash2(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function tileFbm(x: number, y: number, period: number, octaves = 4, seed = 1) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * tileNoise(x * f, y * f, period * f, seed + i * 17);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

// ---------- yumuşak hacimli bulutlar ----------

let puffUrl: string | null = null;

/** pamuk gibi bulut parçası: kenarları gürültüyle kabarık, ortası yoğun (kodla üretilir, indirme yok) */
function cloudPuffUrl() {
  if (puffUrl) return puffUrl;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x / N) * 2 - 1;
      const dy = (y / N) * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy * 1.15);
      const n = tileFbm(x / 32, y / 32, 8, 5, 3);
      const edge = 1 - Math.min(1, Math.max(0, (r + (n - 0.5) * 0.7 - 0.25) / 0.62));
      const a = Math.pow(edge, 1.6) * (0.65 + 0.35 * n);
      // altı hafif gölgeli: billboard kümeleri hacimli görünür
      const shade = 236 + Math.round(19 * Math.min(1, Math.max(0, 1 - (dy + 0.4))));
      const i = (y * N + x) * 4;
      img.data[i] = shade;
      img.data[i + 1] = shade;
      img.data[i + 2] = Math.min(255, shade + 6);
      img.data[i + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  puffUrl = c.toDataURL('image/png');
  return puffUrl;
}

/** drei'nin hacimli bulut sistemi; doku kodla üretilir. İçine <Cloud> bileşenleri konur */
export function SoftClouds({ children, limit = 200 }: { children: ReactNode; limit?: number }) {
  const url = useMemo(cloudPuffUrl, []);
  return (
    <Suspense fallback={null}>
      <Clouds texture={url} limit={limit} material={THREE.MeshLambertMaterial} frustumCulled={false}>
        {children}
      </Clouds>
    </Suspense>
  );
}

// ---------- bulut denizi ----------

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
`;

interface CloudSeaProps {
  y: number;
  radius?: number;
  /** bulutların akış hızı (m/sn), +z yönünde */
  speed?: number;
  /** bulut örtüsü: 0 seyrek, 1 kapalı */
  cover?: number;
  sun: [number, number, number];
  lit?: string;
  shade?: string;
  gap?: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  quality: QualityLevel;
}

/**
 * Aşağıda uzanan bulut denizi: tek düzlem, bulut tepeleri gürültüden üretilir ve güneşe göre gölgelenir.
 * Aralıklarda çok aşağıdaki yer pusu görünür; uzakta sis rengine karışıp ufukla birleşir.
 */
export function CloudSea({ y, radius = SKY_R - 2, speed = 0.4, cover = 0.6, sun, lit = '#ffffff', shade = '#9fb1c8', gap = '#5f7d9a', fog, fogNear, fogFar, quality }: CloudSeaProps) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: false,
        fog: false,
        defines: { OCTAVES: quality === 'high' ? 4 : 3 },
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: speed },
          uCover: { value: cover },
          uSun: { value: new THREE.Vector3(...sun).normalize() },
          uLit: { value: new THREE.Color(lit) },
          uShade: { value: new THREE.Color(shade) },
          uGap: { value: new THREE.Color(gap) },
          uFog: { value: new THREE.Color(fog) },
          uFogNear: { value: fogNear },
          uFogFar: { value: fogFar },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uSpeed; uniform float uCover; uniform vec3 uSun;
          uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uGap; uniform vec3 uFog;
          uniform float uFogNear; uniform float uFogFar;
          varying vec3 vWorld;
          ${NOISE_GLSL}
          float height(vec2 p) {
            float d = fbm(p);
            float lo = mix(0.62, 0.38, uCover);
            return smoothstep(lo, lo + 0.22, d) * (0.6 + d);
          }
          void main() {
            vec2 p = (vWorld.xz + vec2(0.0, -uTime * uSpeed)) * 0.075;
            float h = height(p);
            float e = 0.045;
            float hx = height(p + vec2(e, 0.0));
            float hz = height(p + vec2(0.0, e));
            vec3 n = normalize(vec3(h - hx, e * 0.55, h - hz));
            float light = clamp(dot(n, uSun) * 0.75 + 0.35, 0.0, 1.0);
            vec3 cloud = mix(uShade, uLit, light);
            vec3 c = mix(uGap, cloud, smoothstep(0.02, 0.35, h));
            float dist = length(vWorld.xz - cameraPosition.xz);
            c = mix(c, uFog, smoothstep(uFogNear, uFogFar, dist));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [speed, cover, sun, lit, shade, gap, fog, fogNear, fogFar, quality],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={-5}>
      <circleGeometry args={[radius, 64]} />
    </mesh>
  );
}

// ---------- martılar ----------

/** martı gövdesi ve kanat parçaları; burun -z yönünde, kanatlar +x yönüne açılır (sol kanat aynalanır) */
function gullGeometries() {
  const body = new THREE.SphereGeometry(0.5, 12, 8);
  body.scale(0.2, 0.17, 0.62);
  const tail = new THREE.ConeGeometry(0.1, 0.32, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(1.4, 0.35, 1);
  tail.translate(0, 0.01, 0.42);
  const head = new THREE.SphereGeometry(0.11, 10, 8);
  head.translate(0, 0.07, -0.33);
  const beak = new THREE.ConeGeometry(0.03, 0.12, 6);
  beak.rotateX(-Math.PI / 2);
  beak.translate(0, 0.05, -0.47);
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [paint(body, '#f4f5f6'), paint(tail, '#e9ecef'), paint(head, '#ffffff'), paint(beak, '#f2b632')];
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const col: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute('position').array as Float32Array));
    col.push(...(p.getAttribute('color').array as Float32Array));
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  merged.computeVertexNormals();

  const wing = (pts: [number, number][], colors: string[]) => {
    // pts: (x, z) çokgen köşeleri; üçgen yelpazesiyle doldurulur
    const p: number[] = [];
    const c: number[] = [];
    for (let i = 1; i < pts.length - 1; i++)
      for (const k of [0, i, i + 1]) {
        p.push(pts[k][0], 0, pts[k][1]);
        const cc = new THREE.Color(colors[k]);
        c.push(cc.r, cc.g, cc.b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };
  const grey = '#b9c0c9';
  const inner = wing(
    [
      [0, -0.14],
      [0.62, -0.08],
      [0.62, 0.16],
      [0, 0.2],
    ],
    [grey, grey, grey, grey],
  );
  const outer = wing(
    [
      [0, -0.08],
      [0.48, 0.02],
      [0.74, 0.24],
      [0.5, 0.26],
      [0, 0.16],
    ],
    [grey, '#c3c9d1', '#20242a', '#2a2e35', grey],
  );
  return { body: merged, inner, outer };
}

let gullGeo: ReturnType<typeof gullGeometries> | null = null;
const gullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });

interface GullsProps {
  center: [number, number, number];
  count?: number;
  radius?: [number, number];
  scale?: number;
  seed?: number;
}

/** Kanat çırpan, arada süzülen ve dönüşlerde yatan martılar (kodla üretilir) */
export function Gulls({ center, count = 5, radius = [3, 7], scale = 0.55, seed = 1 }: GullsProps) {
  const geo = (gullGeo ??= gullGeometries());
  const group = useRef<THREE.Group>(null);
  const birds = useMemo(() => {
    const r = seeded(seed * 31 + count);
    return Array.from({ length: count }, () => ({
      rad: between(r, radius),
      phase: r() * Math.PI * 2,
      speed: (0.16 + r() * 0.08) * (r() > 0.3 ? 1 : -1),
      alt: (r() - 0.5) * 2.4,
      flap: 5.5 + r() * 2,
      off: r() * 100,
    }));
  }, [count, radius, seed]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((b, i) => {
      const p = birds[i];
      const a = p.phase + t * p.speed;
      const wob = Math.sin(t * 0.3 + p.off) * 0.25;
      b.position.set(Math.cos(a) * p.rad * (1 + wob * 0.3), p.alt + Math.sin(t * 0.5 + p.off) * 0.5, Math.sin(a) * p.rad);
      // uçuş yönü dairenin teğeti; dönüş yönüne doğru yatar
      b.rotation.set(0, -a + (p.speed > 0 ? Math.PI : 0), 0);
      b.rotateZ(-Math.sign(p.speed) * 0.35);
      // birkaç saniye çırpar, birkaç saniye süzülür
      const glide = Math.sin(t * 0.45 + p.off) > 0.35 ? 0.12 : 1;
      const f = Math.sin(t * p.flap + p.off) * 0.55 * glide;
      const fo = Math.sin(t * p.flap + p.off - 0.7) * 0.4 * glide;
      // çocuklar: gövde, sol kanat, sağ kanat; her kanadın ikinci çocuğu dirsekten sonraki uç parçası
      const [l, r] = [b.children[1], b.children[2]];
      l.rotation.z = -f - 0.08;
      r.rotation.z = f + 0.08;
      l.children[1].rotation.z = -fo;
      r.children[1].rotation.z = fo;
    });
  });
  return (
    <group ref={group} position={center}>
      {birds.map((_, i) => (
        <group key={i} scale={scale}>
          <mesh geometry={geo.body} material={gullMat} />
          {[-1, 1].map(side => (
            <group key={side} position={[side * 0.12, 0.03, 0]} scale={[side, 1, 1]}>
              <mesh geometry={geo.inner} material={gullMat} />
              <group position={[0.62, 0, 0]}>
                <mesh geometry={geo.outer} material={gullMat} />
              </group>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------- korkuluk ----------

export function RailBar({ from, to, radius = 0.025, color = '#d7dde4' }: { from: [number, number, number]; to: [number, number, number]; radius?: number; color?: string }) {
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
      <cylinderGeometry args={[radius, radius, len, 8]} />
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
    </mesh>
  );
}

/** ufukta sıradağlar: manzaraya derinlik verir */
export function Mountains({ y, color, radius = 44 }: { y: number; color: string; radius?: number }) {
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
