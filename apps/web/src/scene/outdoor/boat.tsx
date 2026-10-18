import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { Model } from '../models';
import { SurfaceMaterial } from '../textures';
import { Gulls, SkyDome, Sun, canvasTexture, seeded, tileFbm } from './common';

/**
 * Tekne gezisi: gün batımında yelkenli bir teknenin güvertesi. Okyanus Gerstner dalgalarıyla kıpırdar ve
 * gökyüzü panoramasını yansıtır; çevrede palmiyeli kayalık adalar, deniz feneri, uzaktan geçen bir
 * kalyon (Poly Haven), şamandıralar ve martılar. Tekne -z yönüne ilerler; dünya hafifçe sallanır.
 */

/** teknenin ilerleme hızı (m/sn): dalgalar ve adalar +z yönüne akar */
const FLOW = 1.6;

function boatShape() {
  const s = new THREE.Shape();
  // şekil düzleminde y = -z: pruva (burun) ileride, -z yönünde
  s.moveTo(-2.45, -4.6);
  s.lineTo(2.45, -4.6);
  s.bezierCurveTo(2.75, -0.5, 2.65, 2.4, 0, 6);
  s.bezierCurveTo(-2.65, 2.4, -2.75, -0.5, -2.45, -4.6);
  return s;
}

export function BoatEnv({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const low = quality === 'low';
  const world = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // dünyayı hafifçe sallamak, tekneyi sallamakla aynı hissi verir; masa ve kartlar sabit kalır
    if (world.current) {
      world.current.rotation.z = Math.sin(t * 0.5) * 0.018;
      world.current.rotation.x = Math.sin(t * 0.37 + 1) * 0.012;
      world.current.position.y = Math.sin(t * 0.6) * 0.05;
    }
  });
  return (
    <group>
      <group ref={world}>
        <SkyDome theme={theme} />
        <Ocean quality={quality} />
        <Wake />
        <Islands low={low} />
        <PassingShip />
        <Buoys />
        <Gulls center={[-3, 5, -6]} count={low ? 3 : 6} radius={[3, 8]} seed={4} />
      </group>
      <Sun theme={theme} quality={quality} />
      <Boat quality={quality} />
    </group>
  );
}

// ---------- okyanus ----------

function waterNormalMap() {
  // döşenebilir dalgacık yüksekliğinden normal haritası
  const N = 256;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = tileFbm(x / 16, y / 16, 16, 4, 12);
  return canvasTexture(N, N, g => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
        const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
        const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
        const i = (y * N + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255;
        img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
}

const WAVES_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  // Gerstner dalgası: x,y yön, z diklik, w dalga boyu
  vec3 gerstner(vec4 w, vec2 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 6.2831853 / w.w;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(w.xy);
    float f = k * (dot(d, p) - c * uTime);
    float a = w.z / k;
    tangent += vec3(-d.x * d.x * w.z * sin(f), d.x * w.z * cos(f), -d.x * d.y * w.z * sin(f));
    binormal += vec3(-d.x * d.y * w.z * sin(f), d.y * w.z * cos(f), -d.y * d.y * w.z * sin(f));
    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  }
`;

function Ocean({ quality }: { quality: QualityLevel }) {
  const segs = quality === 'low' ? 48 : quality === 'medium' ? 80 : 120;
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(110, 110, segs, segs);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [segs]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFlow: { value: 0 } }), []);
  const mat = useMemo(() => {
    const normal = waterNormalMap();
    normal.colorSpace = THREE.NoColorSpace;
    normal.repeat.set(22, 22);
    const m = new THREE.MeshStandardMaterial({ color: '#0f3d55', roughness: 0.14, metalness: 0.05, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35) });
    m.onBeforeCompile = shader => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uFlow = uniforms.uFlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WAVES_GLSL}\nvec3 gerP;`)
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          vec3 tg = vec3(1.0, 0.0, 0.0);
          vec3 bn = vec3(0.0, 0.0, 1.0);
          vec2 wp = position.xz + vec2(0.0, -uFlow);
          gerP = position;
          gerP += gerstner(vec4(1.0, 0.35, 0.07, 16.0), wp, tg, bn);
          gerP += gerstner(vec4(-0.4, 1.0, 0.05, 10.0), wp, tg, bn);
          gerP += gerstner(vec4(0.7, -0.6, 0.04, 6.0), wp, tg, bn);
          gerP += gerstner(vec4(-0.9, -0.2, 0.025, 3.4), wp, tg, bn);
          vec3 objectNormal = normalize(cross(bn, tg));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = gerP;');
    };
    return m;
  }, [uniforms]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    uniforms.uTime.value += d;
    uniforms.uFlow.value += d * FLOW;
    // ince dalgacıklar da akışla birlikte kayar
    if (mat.normalMap) {
      mat.normalMap.offset.y += (d * FLOW) / (110 / 22);
      mat.normalMap.offset.x += d * 0.004;
    }
  });
  useEffect(
    () => () => {
      geo.dispose();
      mat.normalMap?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return <mesh geometry={geo} material={mat} position={[0, -0.55, 0]} receiveShadow />;
}

/** kıçtan geriye açılan köpüklü iz */
function Wake() {
  const mat = useMemo(() => {
    const tex = canvasTexture(128, 256, g => {
      const img = g.createImageData(128, 256);
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 128; x++) {
          const v = y / 256;
          const u = x / 128 - 0.5;
          // V biçimli iki kol ve ortada çalkantı
          const arm = Math.exp(-(((Math.abs(u) - v * 0.42) / 0.05) ** 2));
          const mid = Math.exp(-((u / (0.06 + v * 0.1)) ** 2)) * 0.7;
          const n = tileFbm(x / 8, y / 8, 16, 3, 4);
          const a = Math.min(1, (arm + mid) * (0.4 + n)) * (1 - v) ** 1.4;
          const i = (y * 128 + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = a * 200;
        }
      g.putImageData(img, 0, 0);
    });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.75 });
  }, []);
  useFrame((_, dt) => {
    if (mat.map) mat.map.offset.y -= Math.min(dt, 0.05) * 0.12;
  });
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  return (
    <mesh material={mat} position={[0, -0.38, 4.4 + 9]} rotation={[-Math.PI / 2, 0, Math.PI]} renderOrder={1}>
      <planeGeometry args={[9, 18]} />
    </mesh>
  );
}

// ---------- adalar ----------

let palmGeo: { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } | null = null;
let palmMats: { trunk: THREE.Material; leaves: THREE.Material } | null = null;

function palm() {
  if (palmGeo && palmMats) return { geo: palmGeo, mats: palmMats };
  // hafif kavisli gövde
  const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 2, 0), new THREE.Vector3(0.75, 3.8, 0), new THREE.Vector3(1.4, 5.2, 0)]);
  const trunk = new THREE.TubeGeometry(path, 16, 0.16, 7, false);
  // yapraklar: uca doğru incelen, aşağı sarkan kavisli şeritler
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const len = 2.6 * t;
      const w = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      const droop = -1.6 * t * t + 0.5 * t;
      for (const s of [-1, 1]) {
        const lx = len;
        const lz = s * w;
        pos.push(1.4 + Math.cos(a) * lx - Math.sin(a) * lz, 5.2 + droop - Math.abs(lz) * 0.25, Math.sin(a) * lx + Math.cos(a) * lz);
        uv.push(s > 0 ? 1 : 0, t);
      }
      if (j < n) {
        const b = j * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    leaves.push(g.toNonIndexed());
  }
  const leafGeo = mergeGeometries(leaves)!;
  leafGeo.computeVertexNormals();
  const leafTex = canvasTexture(64, 256, g => {
    g.clearRect(0, 0, 64, 256);
    // orta damar ve iki yana tarak gibi yaprakçıklar
    for (let y = 0; y < 256; y += 5) {
      const w = 30 * Math.sin((Math.PI * y) / 256) + 4;
      g.strokeStyle = y % 10 ? '#3f7d2c' : '#4e9336';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(32, y);
      g.lineTo(32 - w, y + 9);
      g.moveTo(32, y);
      g.lineTo(32 + w, y + 9);
      g.stroke();
    }
    g.fillStyle = '#6b8f3a';
    g.fillRect(30, 0, 4, 256);
  });
  leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
  palmGeo = { trunk, leaves: leafGeo };
  palmMats = {
    trunk: new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.95 }),
    leaves: new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }),
  };
  return { geo: palmGeo, mats: palmMats };
}

function Palm({ position, rotation = 0, scale = 1 }: { position: [number, number, number]; rotation?: number; scale?: number }) {
  const { geo, mats } = useMemo(palm, []);
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh geometry={geo.trunk} material={mats.trunk} />
      <mesh geometry={geo.leaves} material={mats.leaves} />
    </group>
  );
}

function Lighthouse() {
  const stripes = useMemo(
    () =>
      canvasTexture(64, 256, g => {
        for (let y = 0; y < 256; y += 64) {
          g.fillStyle = '#f4f1ea';
          g.fillRect(0, y, 64, 32);
          g.fillStyle = '#c0392b';
          g.fillRect(0, y + 32, 64, 32);
        }
      }),
    [],
  );
  const beam = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (beam.current) beam.current.rotation.y += Math.min(dt, 0.05) * 0.8;
  });
  useEffect(() => () => stripes.dispose(), [stripes]);
  return (
    <group>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.65, 1.05, 8, 20]} />
        <meshStandardMaterial map={stripes} roughness={0.7} />
      </mesh>
      <mesh position={[0, 8.15, 0]}>
        <cylinderGeometry args={[0.95, 0.95, 0.3, 20]} />
        <meshStandardMaterial color="#2b2f36" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 8.75, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.9, 16]} />
        <meshStandardMaterial color="#fff2c4" emissive="#ffd27a" emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 9.45, 0]}>
        <coneGeometry args={[0.75, 0.6, 16]} />
        <meshStandardMaterial color="#c0392b" roughness={0.6} />
      </mesh>
      {/* dönen ışık hüzmesi */}
      <group ref={beam} position={[0, 8.75, 0]}>
        <mesh position={[0, 0, 6]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[1.4, 12, 16, 1, true]} />
          <meshBasicMaterial color="#ffe3a0" transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

interface Island {
  p: [number, number];
  s: number;
  rot: number;
  palms: number;
  lighthouse?: boolean;
}

const ISLANDS: Island[] = [
  { p: [-24, -30], s: 1.6, rot: 0.4, palms: 4, lighthouse: true },
  { p: [26, -18], s: 1.1, rot: 2.2, palms: 3 },
  { p: [-30, 14], s: 1.3, rot: 4.0, palms: 3 },
  { p: [22, 28], s: 1.5, rot: 1.0, palms: 4 },
];

/** palmiyeli kayalık adalar (kayalar Poly Haven modelleri); tekneyle birlikte yavaşça geride kalır */
function Islands({ low }: { low: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    for (const c of g.children) {
      c.position.z += Math.min(dt, 0.05) * FLOW * 0.35;
      // gökyüzü küresinin içinde kalan bir halkada dolaşır
      if (c.position.z > 34) c.position.z -= 68;
    }
  });
  const palms = useMemo(() => {
    const r = seeded(19);
    return ISLANDS.map(is => Array.from({ length: low ? Math.min(2, is.palms) : is.palms }, () => ({ a: r() * Math.PI * 2, d: 2 + r() * 2.5, s: 0.8 + r() * 0.4, rot: r() * Math.PI * 2 })));
  }, [low]);
  return (
    <group ref={group}>
      {ISLANDS.map((is, i) => (
        <group key={i} position={[is.p[0], -0.6, is.p[1]]}>
          {/* kumsal */}
          <mesh scale={[is.s * 7.5, 0.5, is.s * 6.5]} position={[0, -0.15, 0]}>
            <sphereGeometry args={[1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#e2cc9a" roughness={1} />
          </mesh>
          <group rotation={[0, is.rot, 0]} scale={is.s * 1.15}>
            <Model name="mountainside" position={[0, -0.3, 0.6]} castShadow={false} />
            <Model name="rockFace" position={[3.8, -0.2, -1.2]} rotation={[0, 1.2, 0]} castShadow={false} />
            <Model name="rockFace" position={[-4.2, -0.3, 1.5]} rotation={[0, -2.1, 0]} scale={0.8} castShadow={false} />
          </group>
          {palms[i].map((p, k) => (
            <Palm key={k} position={[Math.cos(p.a) * p.d * is.s * 1.4, 0.05, Math.sin(p.a) * p.d * is.s * 1.4 + is.s * 2]} rotation={p.rot} scale={p.s} />
          ))}
          {is.lighthouse && (
            <group position={[is.s * 4.5, 0, is.s * 2.5]}>
              <Lighthouse />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/** ufukta ağır ağır yol alan kalyon */
function PassingShip() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.x = 36 - ((t * 0.9) % 72);
    g.position.y = -0.55 + Math.sin(t * 0.7) * 0.15;
    g.rotation.z = Math.sin(t * 0.5) * 0.03;
  });
  return (
    <group ref={ref} position={[36, -0.55, -36]} rotation={[0, Math.PI, 0]} scale={0.9}>
      <Model name="ship" castShadow={false} />
    </group>
  );
}

/** dalgalarla inip kalkan şamandıra ve kanal işareti; tekne geçerken geride kalır */
function Buoys() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((c, i) => {
      c.position.z += Math.min(dt, 0.05) * FLOW;
      if (c.position.z > 30) c.position.z -= 60;
      c.position.y = -0.55 + Math.sin(t * 1.3 + i * 2) * 0.12;
      c.rotation.z = Math.sin(t * 1.1 + i) * 0.08;
      c.rotation.x = Math.sin(t * 0.9 + i * 1.7) * 0.06;
    });
  });
  return (
    <group ref={group}>
      <group position={[6.5, -0.55, -14]}>
        <Model name="buoy" castShadow={false} />
      </group>
      <group position={[-8, -0.55, 12]} scale={0.8}>
        <Model name="seaMarker" castShadow={false} />
      </group>
      <group position={[9, -0.55, 22]}>
        <Model name="buoy" castShadow={false} />
      </group>
    </group>
  );
}

// ---------- tekne ----------

function Boat({ quality }: { quality: QualityLevel }) {
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
  const sails = useMemo(() => {
    // şişkin ana yelken ve flok: üçgenler ızgaraya bölünür, rüzgârla kavislenir
    const sail = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, belly: THREE.Vector3) => {
      const n = 10;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const w = 1 - u - v;
          const p = a.clone().multiplyScalar(w).addScaledVector(b, u).addScaledVector(c, v);
          p.addScaledVector(belly, 4 * u * v * w * 6.5);
          pos.push(p.x, p.y, p.z);
        }
      const row = (i: number) => (i * (2 * n + 3 - i)) / 2;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n - i; j++) {
          const p0 = row(i) + j;
          const p1 = row(i + 1) + j;
          idx.push(p0, p1, p0 + 1);
          if (j < n - i - 1) idx.push(p0 + 1, p1, p1 + 1);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const mast = new THREE.Vector3(1.15, 0, -3.7);
    return {
      main: sail(mast.clone().setY(1.25), mast.clone().setY(6.4), mast.clone().add(new THREE.Vector3(0, 1.3, 2.2)), new THREE.Vector3(0.55, 0, 0)),
      jib: sail(mast.clone().setY(5.9), new THREE.Vector3(0.05, 0.75, -5.8), mast.clone().add(new THREE.Vector3(-0.2, 1.0, -0.4)), new THREE.Vector3(0.45, 0, 0)),
    };
  }, []);
  useEffect(
    () => () => {
      for (const g of [deck, hull, sails.main, sails.jib]) g.dispose();
    },
    [deck, hull, sails],
  );
  const mastTop: [number, number, number] = [1.15, 6.75, -3.7];

  return (
    <group>
      {/* güverte, gövde ve alçak korkuluk */}
      <mesh geometry={deck} receiveShadow castShadow>
        <SurfaceMaterial tex="wood_floor_deck" repeat={[0.32, 0.32]} tint="#e8c9a4" roughness={0.7} fallback="#b07a4a" />
      </mesh>
      <mesh geometry={hull} castShadow>
        <meshStandardMaterial color="#f4f1ea" roughness={0.45} />
      </mesh>
      {/* su hattındaki lacivert şerit */}
      <mesh geometry={hull} position={[0, -0.42, 0]} scale={[1.015, 0.4, 1.01]}>
        <meshStandardMaterial color="#1f4f7a" roughness={0.5} />
      </mesh>
      <mesh>
        <tubeGeometry args={[rail.curve, 120, 0.026, 8, true]} />
        <meshStandardMaterial color="#d9dde2" metalness={0.85} roughness={0.2} />
      </mesh>
      {rail.posts.map((p, i) => (
        <mesh key={i} position={[p.x, 0.27, p.z]}>
          <cylinderGeometry args={[0.018, 0.018, 0.55, 6]} />
          <meshStandardMaterial color="#d9dde2" metalness={0.85} roughness={0.2} />
        </mesh>
      ))}
      {/* güvertede ip ışıkları */}
      {rail.posts.map((p, i) =>
        i % 2 ? null : (
          <mesh key={`l${i}`} position={[p.x, 0.62, p.z]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color={new THREE.Color(i % 4 ? '#ffd27a' : '#ff9a5a').multiplyScalar(2.5)} toneMapped={false} />
          </mesh>
        ),
      )}
      {/* direk, bumba, yelkenler ve halatlar: pruvada, masanın arkasındaki manzarayı kapatmaz */}
      <mesh position={[1.15, 3.4, -3.7]} castShadow>
        <cylinderGeometry args={[0.055, 0.08, 6.8, 12]} />
        <meshStandardMaterial color="#c8ccd1" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[1.15, 1.25, -2.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 2.3, 10]} />
        <meshStandardMaterial color="#c8ccd1" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh geometry={sails.main} castShadow>
        <meshStandardMaterial color="#fbf6ea" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={sails.jib} castShadow>
        <meshStandardMaterial color="#f6efe0" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Rope from={mastTop} to={[0, 0.6, -5.85]} />
      <Rope from={mastTop} to={[2.45, 0.55, -3.3]} />
      <Rope from={mastTop} to={[-0.4, 0.55, -3.9]} />
      <Flag />
      <Helm />
      {/* usturmaçalar: iki yanda sarkan şişme tamponlar */}
      {[-1, 1].flatMap(s =>
        [-1.6, 0.8].map(z => (
          <group key={`${s}${z}`} position={[s * 2.62, -0.25, z]}>
            <mesh>
              <capsuleGeometry args={[0.11, 0.38, 6, 12]} />
              <meshStandardMaterial color={z < 0 ? '#2b6cb0' : '#f4f1ea'} roughness={0.5} />
            </mesh>
            <mesh position={[-s * 0.06, 0.48, 0]} rotation={[0, 0, s * 0.18]}>
              <cylinderGeometry args={[0.008, 0.008, 0.6, 4]} />
              <meshStandardMaterial color="#d9c9a0" />
            </mesh>
          </group>
        )),
      )}

      {/* güverte eşyaları: can simitleri ve can yeleği korkulukta, kıçta fenerler, kova ve fıçı, pruvada sandıklar */}
      <Model name="lifebuoy" position={[2.5, 0.32, 0.6]} rotation={[0, Math.PI / 2, 0]} scale={0.7} />
      <Model name="lifebuoy" position={[-2.5, 0.32, -0.4]} rotation={[0, -Math.PI / 2, 0]} scale={0.7} />
      <Model name="lifeJacket" position={[-2.38, 0.28, 1.9]} rotation={[0, Math.PI / 2 + 0.2, 0]} scale={0.85} />
      <Model name="lantern" position={[1.6, 0, 3.95]} scale={0.9} />
      <Model name="lantern" position={[-1.6, 0, 3.95]} scale={0.9} />
      {quality !== 'low' && <pointLight position={[1.6, 0.35, 3.95]} color="#ffb070" intensity={0.8} distance={2.5} decay={2} />}
      <Model name="bucket" position={[-1.05, 0, 3.55]} rotation={[0, 0.6, 0]} />
      <Model name="barrelSmall" position={[1.25, 0, 3.2]} rotation={[0, 1.1, 0]} scale={0.75} />
      <Model name="crate" position={[-0.6, 0, -3.9]} rotation={[0, 0.3, 0]} scale={0.75} />
      <Model name="crate" position={[-0.95, 0, -3.35]} rotation={[0, -0.25, 0]} scale={0.6} />
      <Model name="barrel" position={[0.25, 0, -4.5]} scale={0.6} />
    </group>
  );
}

function Rope({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    return { pos: a.clone().add(b).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), len: dir.length() };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[0.009, 0.009, len, 5]} />
      <meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.4} />
    </mesh>
  );
}

/** kıçtaki direkte rüzgârda dalgalanan Türk bayrağı */
function Flag() {
  const geo = useMemo(() => new THREE.PlaneGeometry(0.9, 0.6, 18, 8), []);
  const base = useMemo(() => Float32Array.from(geo.getAttribute('position').array as Float32Array), [geo]);
  const tex = useMemo(
    () =>
      canvasTexture(300, 200, g => {
        g.fillStyle = '#e30a17';
        g.fillRect(0, 0, 300, 200);
        // ay ve yıldız
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(110, 100, 50, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#e30a17';
        g.beginPath();
        g.arc(122.5, 100, 40, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 10 : 25;
          const a = -Math.PI / 2 + (i * Math.PI) / 5 + Math.PI / 2;
          g.lineTo(178 + Math.cos(a) * r, 100 + Math.sin(a) * r);
        }
        g.fill();
      }),
    [],
  );
  useFrame(({ clock }) => {
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      const k = (x + 0.45) / 0.9;
      p.setZ(i, Math.sin(k * 6 - t * 7) * 0.07 * k + Math.sin(k * 11 - t * 11) * 0.02 * k);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  });
  useEffect(
    () => () => {
      geo.dispose();
      tex.dispose();
    },
    [geo, tex],
  );
  return (
    <group position={[0, 0, 4.45]}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.02, 0.025, 1.8, 8]} />
        <meshStandardMaterial color="#c8ccd1" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* rüzgâr geriye (+z) eser: bayrak direğin arkasına uzanır */}
      <mesh geometry={geo} position={[0, 1.45, 0.45]} rotation={[0, Math.PI / 2, 0]}>
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** kıçta ahşap dümen dolabı ve pusula */
function Helm() {
  const wheel = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.32, 0.025, 8, 32).toNonIndexed()];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.CylinderGeometry(0.014, 0.014, 0.82, 6);
      s.rotateZ((i / 8) * Math.PI);
      parts.push(s.toNonIndexed());
      const h = new THREE.CylinderGeometry(0.02, 0.016, 0.1, 6);
      h.translate(0, 0.45, 0);
      h.rotateZ((i / 8) * Math.PI * 2);
      parts.push(h.toNonIndexed());
    }
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12);
    hub.rotateX(Math.PI / 2);
    parts.push(hub.toNonIndexed());
    for (const p of parts) p.deleteAttribute('uv');
    return mergeGeometries(parts)!;
  }, []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = Math.sin(clock.elapsedTime * 0.4) * 0.25;
  });
  useEffect(() => () => wheel.dispose(), [wheel]);
  return (
    <group position={[0, 0, 3.75]}>
      <mesh position={[0, 0.45, 0.12]} castShadow>
        <boxGeometry args={[0.32, 0.9, 0.3]} />
        <meshStandardMaterial color="#7a4a2a" roughness={0.6} />
      </mesh>
      <mesh ref={ref} geometry={wheel} position={[0, 0.95, -0.05]}>
        <meshStandardMaterial color="#8a5a32" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.93, 0.12]}>
        <cylinderGeometry args={[0.09, 0.1, 0.06, 16]} />
        <meshStandardMaterial color="#b08d57" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}
