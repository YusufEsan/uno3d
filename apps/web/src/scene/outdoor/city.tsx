import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel } from '../../store/useApp';
import { MODELS, ModelInstances } from '../models';
import { canvasTexture, seeded, tileFbm, useTreadmill } from './common';

/**
 * Otobüs penceresinden görünen şehir: Poly Haven'ın modüler apartman cephe kitinden (CC0) parça parça
 * dizilen binalar, tabelalı dükkânlar, tenteler, kaldırımda lamba/bank/çöp kutusu/yangın musluğu,
 * ağaçlar, park etmiş ve karşı şeritten geçen arabalar. Otobüs -x yönüne gider; sokak +x yönüne akar.
 */

/** sokağın bir kopyasının boyu (m); üç kopya yan yana dizilir, koşu bandı bir boy kayınca başa sarar */
export const STREET_SPAN = 48;
const COPIES = 3;
const START = -STREET_SPAN * 2;

/** yol ve kaldırım ölçüleri (z): otobüs sağ şeritte, sağdaki kaldırım yakın */
export const ROAD = { y: -0.75, right: -2.95, left: 7.9, walkY: -0.6, rightFacade: -6.6, leftFacade: 11.4, center: 3.0 };

// ---------- modüler cephe kiti ----------

type Module = string[];
const GROUND: Module[] = [
  ['wall_standard_standard_01'],
  ['wall_door_centered_small_01', 'door_centered_small_01'],
  ['wall_door_centered_large_01', 'door_centered_large_01'],
  ['wall_door_centered_small_02', 'door_centered_small_02'],
  ['wall_door_offset_small_01', 'door_offset_small_01'],
];
const UPPER: Module[] = [
  ['wall_window_centered_large_01', 'window_centered_large_01'],
  ['wall_window_centered_small_01', 'window_centered_small_01'],
  ['wall_window_centered_double_01', 'window_centered_double_01'],
  ['wall_window_offset_small_01', 'window_offset_small_01'],
  ['wall_door_window_small_01', 'door_window_small_01'],
];
/** en üst katta pencereler biraz içeride: kitin _03 parçaları */
const TOP: Module[] = [
  ['wall_window_centered_large_03', 'window_centered_large_03'],
  ['wall_window_centered_small_03', 'window_centered_small_03'],
  ['wall_window_centered_double_03', 'window_centered_double_03'],
  ['wall_window_offset_small_05', 'window_offset_small_05'],
  ['wall_door_window_small_09', 'door_window_small_09'],
];
const BASE = 'base_standard_01';
const CORNICE = 'cornice_standard_standard_01';
const CROWN = 'crown_standard_standard_01';
const PIER = 'wall_pier_standard_01';
const PIER_TOP = 'crown_pier_pedestal_01';

const PLASTER = ['#efe2cc', '#e7c49f', '#d9876a', '#cdbca8', '#b9c6d0', '#e9d39a', '#d8a79b', '#adbd9f', '#f2efe8', '#c99d7c'];

interface Placement {
  node: string;
  m: THREE.Matrix4;
  tint: THREE.Color;
}

interface Box {
  m: THREE.Matrix4;
  tint: THREE.Color;
}

interface Shop {
  /** tabelanın sol-alt köşesi ve genişliği; side: -1 sağ kaldırım (+z'ye bakar), 1 sol kaldırım */
  x: number;
  w: number;
  side: number;
  name: number;
}

interface Awning {
  x: number;
  side: number;
  style: number;
}

interface StreetPlan {
  pieces: Placement[];
  boxes: Box[];
  shops: Shop[];
  awnings: Awning[];
  wallLamps: THREE.Matrix4[];
}

const SHOPS = ['FIRIN', 'KAFE', 'BAKKAL', 'ECZANE', 'BERBER', 'ÇİÇEKÇİ', 'KIRTASİYE', 'LOKANTA', 'KUAFÖR', 'MANAV', 'ŞARKÜTERİ', 'OYUNCAKÇI'];
const SHOP_COLORS = ['#c0392b', '#1f6f8b', '#2e8b57', '#2c3e50', '#8e44ad', '#d35400', '#16a085', '#b03a2e', '#34495e', '#7d6608', '#5d4037', '#1a5276'];

/** bir sokak kopyası: iki yanda binalar (aynı plan üç kopyada tekrar eder) */
function planStreet(low: boolean): StreetPlan {
  const pieces: Placement[] = [];
  const boxes: Box[] = [];
  const shops: Shop[] = [];
  const awnings: Awning[] = [];
  const wallLamps: THREE.Matrix4[] = [];
  const rot = new THREE.Matrix4();
  for (const side of [-1, 1]) {
    const r = seeded(side > 0 ? 71 : 17);
    const zf = side < 0 ? ROAD.rightFacade : ROAD.leftFacade;
    rot.makeRotationY(side < 0 ? 0 : Math.PI);
    let x = -STREET_SPAN / 2;
    let shopName = side > 0 ? 6 : 0;
    while (x < STREET_SPAN / 2 - 2.9) {
      const bays = Math.min(3 + Math.floor(r() * 4), Math.floor((STREET_SPAN / 2 - x) / 3));
      if (bays < 1) break;
      const floors = low ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 3);
      const tint = new THREE.Color(PLASTER[Math.floor(r() * PLASTER.length)]);
      const upper = UPPER[Math.floor(r() * UPPER.length)];
      const top = TOP[UPPER.indexOf(upper)];
      const ys = ROAD.walkY;
      const place = (node: string, bayLeft: number, y: number) => {
        // sağ kaldırımdaki parçalar +z'ye bakar, kökeni sağ kenarda; sol kaldırımda π döner, köken sol kenara gelir
        const ox = side < 0 ? bayLeft + 3 : bayLeft;
        const m = new THREE.Matrix4().makeTranslation(ox, y, zf).multiply(rot);
        pieces.push({ node, m, tint });
      };
      for (let i = 0; i < bays; i++) {
        const bx = x + i * 3;
        const ground = r() < 0.35 ? GROUND[0] : GROUND[1 + Math.floor(r() * (GROUND.length - 1))];
        for (const n of ground) place(n, bx, ys);
        place(BASE, bx, ys);
        place(CORNICE, bx, ys + 3);
        for (let k = 1; k <= floors; k++) for (const n of k === floors ? top : upper) place(n, bx, ys + 3.2 + (k - 1) * 3);
        place(CROWN, bx, ys + 3.2 + floors * 3);
        if (ground !== GROUND[0] && r() < 0.55) awnings.push({ x: bx, side, style: Math.floor(r() * 4) });
      }
      // binanın iki kenarında kat boyunca pilastrlar ve tepede kaide
      for (const edge of [x, x + bays * 3]) {
        const ex = side < 0 ? edge : edge;
        for (let k = 0; k <= floors; k++) {
          const m = new THREE.Matrix4().makeTranslation(ex, k === 0 ? ys : ys + 3.2 + (k - 1) * 3, zf + side * -0.02).multiply(rot);
          pieces.push({ node: PIER, m, tint });
        }
        pieces.push({ node: PIER_TOP, m: new THREE.Matrix4().makeTranslation(ex, ys + 3.2 + floors * 3, zf).multiply(rot), tint });
      }
      // cephenin arkasında binanın gövdesi: aralıklardan bakınca bina dolu görünür
      const h = 3.2 + floors * 3 + 0.6;
      const depth = 9;
      boxes.push({
        m: new THREE.Matrix4().compose(new THREE.Vector3(x + bays * 1.5, ys + h / 2, zf + side * (depth / 2 + 0.05)), new THREE.Quaternion(), new THREE.Vector3(bays * 3 - 0.1, h, depth)),
        tint: tint.clone().multiplyScalar(0.82),
      });
      if (r() < 0.75) {
        const w = Math.min(bays, 2 + Math.floor(r() * 2)) * 3;
        shops.push({ x: x + (side < 0 ? 0 : bays * 3 - w), w, side, name: shopName++ % SHOPS.length });
      }
      // birinci kat hizasında duvar lambaları
      for (let i = 1; i < bays; i += 2) {
        wallLamps.push(new THREE.Matrix4().makeTranslation(x + i * 3, ys + 3.75, zf).multiply(rot));
      }
      x += bays * 3 + (r() < 0.35 ? 1.6 : 0);
    }
  }
  return { pieces, boxes, shops, awnings, wallLamps };
}

/** kitin parçaları: düğüm adı → parça uzayında (köken sağ-alt köşe) ağ parçaları */
function kitParts(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const parts = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[]>();
  const box = new THREE.Box3();
  const origin = (name: string) => {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    box.setFromObject(o);
    return new THREE.Vector3(box.max.x, box.min.y, 0);
  };
  const add = (name: string, base: string) => {
    const o = scene.getObjectByName(name);
    const org = origin(base);
    if (!o || !org) return;
    const inv = new THREE.Matrix4().makeTranslation(-org.x, -org.y, -org.z);
    const list: { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[] = [];
    o.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.isMesh) list.push({ geometry: m.geometry, material: m.material as THREE.Material, local: inv.clone().multiply(m.matrixWorld) });
    });
    parts.set(name, list);
  };
  for (const mod of [...GROUND, ...UPPER, ...TOP]) for (const n of mod) add(n, mod[0]);
  for (const n of [BASE, CORNICE, CROWN]) add(n, n);
  // pilastrlar kenara ortalanır: kökeni kendi ortası
  for (const n of [PIER, PIER_TOP]) {
    const o = scene.getObjectByName(n);
    if (!o) continue;
    box.setFromObject(o);
    const inv = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, 0);
    const list: { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[] = [];
    o.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.isMesh) list.push({ geometry: m.geometry, material: m.material as THREE.Material, local: inv.clone().multiply(m.matrixWorld) });
    });
    parts.set(n, list);
  }
  return parts;
}

/** cam yerine gökyüzünü yansıtan koyu pencere: arkası boş cephede cam saydam kalırsa boşluk görünür */
const windowGlass = new THREE.MeshStandardMaterial({ color: '#33414e', metalness: 0.85, roughness: 0.08 });

function Buildings({ plan }: { plan: StreetPlan }) {
  const { scene } = useGLTF(MODELS.facadeKit);
  const meshes = useMemo(() => {
    const parts = kitParts(scene);
    const byNode = new Map<string, Placement[]>();
    for (const p of plan.pieces) {
      const list = byNode.get(p.node) ?? [];
      list.push(p);
      byNode.set(p.node, list);
    }
    const out: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const shift = new THREE.Matrix4();
    for (const [node, list] of byNode) {
      for (const part of parts.get(node) ?? []) {
        const glass = part.material.name.includes('glass');
        const plaster = part.material.name.includes('plaster');
        const im = new THREE.InstancedMesh(part.geometry, glass ? windowGlass : part.material, list.length * COPIES);
        let k = 0;
        for (let c = 0; c < COPIES; c++) {
          shift.makeTranslation(START + STREET_SPAN / 2 + c * STREET_SPAN, 0, 0);
          for (const p of list) {
            im.setMatrixAt(k, m.multiplyMatrices(shift, p.m).multiply(part.local));
            if (plaster) im.setColorAt(k, p.tint);
            k++;
          }
        }
        im.receiveShadow = true;
        im.computeBoundingSphere();
        out.push(im);
      }
    }
    // bina gövdeleri: tek kutu geometrisi, renkler kopya başına
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95 }), plan.boxes.length * COPIES);
    let k = 0;
    for (let c = 0; c < COPIES; c++) {
      shift.makeTranslation(START + STREET_SPAN / 2 + c * STREET_SPAN, 0, 0);
      for (const b of plan.boxes) {
        body.setMatrixAt(k, m.multiplyMatrices(shift, b.m));
        body.setColorAt(k, b.tint);
        k++;
      }
    }
    body.computeBoundingSphere();
    out.push(body);
    return out;
  }, [scene, plan]);
  useEffect(
    () => () =>
      meshes.forEach(m => {
        m.dispose();
        if (m.geometry.type === 'BoxGeometry') {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      }),
    [meshes],
  );
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// ---------- tabelalar ve tenteler ----------

function signAtlas() {
  return canvasTexture(1024, 1024, g => {
    const row = 1024 / SHOPS.length;
    SHOPS.forEach((name, i) => {
      const y = i * row;
      g.fillStyle = SHOP_COLORS[i];
      g.fillRect(0, y, 1024, row);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 4;
      g.strokeRect(8, y + 8, 1008, row - 16);
      g.fillStyle = '#fffaf0';
      g.font = `800 ${Math.round(row * 0.58)}px Rubik, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, 512, y + row / 2 + 3);
    });
  });
}

function awningAtlas() {
  const styles = [
    ['#c0392b', '#f5efe6'],
    ['#1e7a46', '#f5efe6'],
    ['#1f5f99', '#f5efe6'],
    ['#d9a400', '#4a3a12'],
  ];
  return canvasTexture(256, 256, g => {
    styles.forEach(([a, b], i) => {
      for (let x = 0; x < 256; x += 32) {
        g.fillStyle = (x / 32) % 2 ? b : a;
        g.fillRect(x, i * 64, 32, 64);
      }
    });
  });
}

/** dörtgen ekler: köşeler sol-alt, sağ-alt, sağ-üst, sol-üst; uv dikdörtgeni [u0,v0,u1,v1] */
function pushQuad(pos: number[], uv: number[], idx: number[], q: THREE.Vector3[], [u0, v0, u1, v1]: number[]) {
  const b = pos.length / 3;
  for (const p of q) pos.push(p.x, p.y, p.z);
  uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
  idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

function signsGeometry(plan: StreetPlan) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const back: THREE.BufferGeometry[] = [];
  const n = SHOPS.length;
  for (let c = 0; c < COPIES; c++) {
    const off = START + STREET_SPAN / 2 + c * STREET_SPAN;
    for (const s of plan.shops) {
      const zf = (s.side < 0 ? ROAD.rightFacade : ROAD.leftFacade) - s.side * 0.2;
      const y0 = ROAD.walkY + 2.78;
      const y1 = y0 + 0.62;
      const x0 = off + s.x + 0.15;
      const x1 = off + s.x + s.w - 0.15;
      // ön yüz yola bakar: sağ kaldırımda soldan sağa, sol kaldırımda ters sırayla
      const q = s.side < 0 ? [new THREE.Vector3(x0, y0, zf), new THREE.Vector3(x1, y0, zf), new THREE.Vector3(x1, y1, zf), new THREE.Vector3(x0, y1, zf)] : [new THREE.Vector3(x1, y0, zf), new THREE.Vector3(x0, y0, zf), new THREE.Vector3(x0, y1, zf), new THREE.Vector3(x1, y1, zf)];
      const v1 = 1 - s.name / n;
      pushQuad(pos, uv, idx, q, [0, v1 - 1 / n, 1, v1]);
      const box = new THREE.BoxGeometry(x1 - x0 + 0.08, y1 - y0 + 0.08, 0.16);
      box.translate((x0 + x1) / 2, (y0 + y1) / 2, zf + s.side * 0.085);
      back.push(box.toNonIndexed());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const backs = back.length ? mergeGeometries(back.map(b => (b.deleteAttribute('uv'), b))) : new THREE.BufferGeometry();
  return { front: g, backs };
}

function awningsGeometry(plan: StreetPlan) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let c = 0; c < COPIES; c++) {
    const off = START + STREET_SPAN / 2 + c * STREET_SPAN;
    for (const a of plan.awnings) {
      const zf = a.side < 0 ? ROAD.rightFacade : ROAD.leftFacade;
      const out = -a.side;
      const x0 = off + a.x + 0.3;
      const x1 = off + a.x + 2.7;
      const yTop = ROAD.walkY + 2.72;
      const yLow = yTop - 0.42;
      const zIn = zf + out * 0.04;
      const zOut = zf + out * 1.0;
      const v1 = 1 - a.style / 4;
      const uvr = [0, v1 - 0.25, 1, v1];
      const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      // eğimli üst yüz ve önde sarkan saçak; iki yüzü de görünsün diye her biri iki kez (ters sırayla)
      const slope = [P(x0, yLow, zOut), P(x1, yLow, zOut), P(x1, yTop, zIn), P(x0, yTop, zIn)];
      const valance = [P(x0, yLow - 0.2, zOut), P(x1, yLow - 0.2, zOut), P(x1, yLow, zOut), P(x0, yLow, zOut)];
      for (const q of [slope, valance]) {
        pushQuad(pos, uv, idx, q, uvr);
        pushQuad(pos, uv, idx, [q[1], q[0], q[3], q[2]], uvr);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Signage({ plan }: { plan: StreetPlan }) {
  const { signs, awnings, signMat, awningMat } = useMemo(() => {
    return {
      signs: signsGeometry(plan),
      awnings: awningsGeometry(plan),
      signMat: new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.08 }),
      awningMat: new THREE.MeshStandardMaterial({ map: awningAtlas(), roughness: 0.9 }),
    };
  }, [plan]);
  useEffect(
    () => () => {
      signs.front.dispose();
      signs.backs.dispose();
      awnings.dispose();
      signMat.map?.dispose();
      signMat.dispose();
      awningMat.map?.dispose();
      awningMat.dispose();
    },
    [signs, awnings, signMat, awningMat],
  );
  return (
    <>
      <mesh geometry={signs.front} material={signMat} />
      <mesh geometry={signs.backs}>
        <meshStandardMaterial color="#2a2d33" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh geometry={awnings} material={awningMat} />
    </>
  );
}

// ---------- kaldırım, ağaçlar ve sokak eşyaları ----------

function pavingTexture() {
  return canvasTexture(
    256,
    256,
    g => {
      g.fillStyle = '#a9a49b';
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const v = 165 + Math.round(Math.random() * 22);
          g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
    },
    [(STREET_SPAN * COPIES) / 1.2, 3.65 / 1.2],
  );
}

function Sidewalks() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.92 }), []);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  const w = STREET_SPAN * COPIES;
  const cx = START + w / 2;
  return (
    <group>
      {[
        [ROAD.right, ROAD.rightFacade],
        [ROAD.left, ROAD.leftFacade],
      ].map(([curb, facade], i) => {
        const z = (curb + facade) / 2;
        const depth = Math.abs(facade - curb);
        return (
          <group key={i}>
            <mesh position={[cx, (ROAD.y + ROAD.walkY) / 2, z]} material={mat} receiveShadow>
              <boxGeometry args={[w, ROAD.walkY - ROAD.y, depth]} />
            </mesh>
            {/* bordür taşı */}
            <mesh position={[cx, (ROAD.y + ROAD.walkY) / 2 + 0.005, curb + (i ? 0.1 : -0.1)]}>
              <boxGeometry args={[w, ROAD.walkY - ROAD.y + 0.01, 0.22]} />
              <meshStandardMaterial color="#c9c6c0" roughness={0.85} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

const leafGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // yaprak kümesi: yüzey gürültüyle kabarık, altı biraz basık
    const n = tileFbm(v.x * 2 + 8, v.z * 2 + v.y * 1.7 + 8, 16, 3, 5);
    v.multiplyScalar(0.82 + n * 0.42);
    if (v.y < 0) v.y *= 0.7;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
})();
const trunkGeo = new THREE.CylinderGeometry(0.07, 0.11, 1, 7);
trunkGeo.translate(0, 0.5, 0);

/** kaldırım ağaçları: gövde ve üç yaprak kümesi, hepsi instancing ile */
function Trees({ spots }: { spots: THREE.Vector3[] }) {
  const { trunks, leaves } = useMemo(() => {
    const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length * 3);
    const r = seeded(91);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const greens = ['#4f7f37', '#5b8c3e', '#456f30', '#6a9444', '#3f6b2f'];
    spots.forEach((s, i) => {
      const h = 2.2 + r() * 0.8;
      m.compose(s, q, new THREE.Vector3(1, h, 1));
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        const sz = 0.9 + r() * 0.35;
        m.compose(
          new THREE.Vector3(s.x + Math.cos(a) * 0.35 * (k ? 1 : 0), s.y + h + 0.2 + k * 0.35, s.z + Math.sin(a) * 0.35 * (k ? 1 : 0)),
          q.setFromEuler(new THREE.Euler(0, a, 0)),
          new THREE.Vector3(sz, sz * 0.85, sz),
        );
        leaves.setMatrixAt(i * 3 + k, m);
        leaves.setColorAt(i * 3 + k, new THREE.Color(greens[Math.floor(r() * greens.length)]));
      }
    });
    trunks.castShadow = leaves.castShadow = false;
    trunks.computeBoundingSphere();
    leaves.computeBoundingSphere();
    return { trunks, leaves };
  }, [spots]);
  useEffect(
    () => () => {
      for (const im of [trunks, leaves]) {
        im.dispose();
        (im.material as THREE.Material).dispose();
      }
    },
    [trunks, leaves],
  );
  return (
    <>
      <primitive object={trunks} />
      <primitive object={leaves} />
    </>
  );
}

/** sokak eşyalarının yerleri: her kopyada aynı, üç kopyaya çoğaltılır */
function furniture() {
  const r = seeded(33);
  const lamps: THREE.Matrix4[] = [];
  const hydrants: THREE.Matrix4[] = [];
  const benches: THREE.Matrix4[] = [];
  const cans: THREE.Matrix4[] = [];
  const boxes: THREE.Matrix4[] = [];
  const trees: THREE.Vector3[] = [];
  const pits: THREE.Vector3[] = [];
  const y = ROAD.walkY;
  const at = (x: number, z: number, rotY: number, list: THREE.Matrix4[]) => {
    for (let c = 0; c < COPIES; c++) {
      const off = START + STREET_SPAN / 2 + c * STREET_SPAN;
      list.push(new THREE.Matrix4().makeTranslation(off + x, y, z).multiply(new THREE.Matrix4().makeRotationY(rotY)));
    }
  };
  for (const side of [-1, 1]) {
    const curb = side < 0 ? ROAD.right : ROAD.left;
    const facade = side < 0 ? ROAD.rightFacade : ROAD.leftFacade;
    const toRoad = side < 0 ? 0 : Math.PI;
    for (let x = -STREET_SPAN / 2 + 4; x < STREET_SPAN / 2; x += 16) at(x, curb + side * 0.45, toRoad, lamps);
    for (let x = -STREET_SPAN / 2 + 10; x < STREET_SPAN / 2; x += 12) {
      for (let c = 0; c < COPIES; c++) {
        const p = new THREE.Vector3(START + STREET_SPAN / 2 + c * STREET_SPAN + x + r() * 1.5, y, curb + side * 0.9);
        trees.push(p);
        pits.push(p);
      }
    }
    at(-STREET_SPAN / 2 + 7 + r() * 4, curb + side * 0.5, toRoad, hydrants);
    for (let x = -STREET_SPAN / 2 + 18; x < STREET_SPAN / 2; x += 22) {
      // bank yola bakar (model +z yönüne bakıyor), sırtı binaya dönük; yanında çöp kutusu
      at(x, facade - side * 1.0, toRoad, benches);
      at(x + 1.9, facade - side * 0.75, toRoad, cans);
    }
    at(-STREET_SPAN / 2 + 30 + r() * 4, facade - side * 0.35, toRoad, boxes);
  }
  return { lamps, hydrants, benches, cans, boxes, trees, pits };
}

// ---------- araçlar ----------

function carGeometry() {
  const body = new THREE.Shape();
  // yan profil (x: önden arkaya, y: yukarı); araç +x yönüne bakar, burun x=+2.1
  body.moveTo(-2.1, 0.32);
  body.lineTo(-2.15, 0.62);
  body.quadraticCurveTo(-2.1, 0.92, -1.7, 0.95);
  body.lineTo(1.4, 0.95);
  body.quadraticCurveTo(2.05, 0.9, 2.12, 0.62);
  body.lineTo(2.1, 0.32);
  body.closePath();
  const bodyG = new THREE.ExtrudeGeometry(body, { depth: 1.7, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 6 });
  bodyG.translate(0, 0, -0.85);
  const cabin = new THREE.Shape();
  cabin.moveTo(-1.55, 0.95);
  cabin.lineTo(-1.05, 1.42);
  cabin.lineTo(0.55, 1.42);
  cabin.lineTo(1.2, 0.95);
  cabin.closePath();
  const cabinG = new THREE.ExtrudeGeometry(cabin, { depth: 1.44, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  cabinG.translate(0, 0, -0.72);
  const wheels: THREE.BufferGeometry[] = [];
  for (const x of [-1.32, 1.3])
    for (const z of [-0.8, 0.8]) {
      const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16);
      w.rotateX(Math.PI / 2);
      w.translate(x, 0.33, z);
      wheels.push(w.toNonIndexed());
    }
  const lights: THREE.BufferGeometry[] = [];
  for (const z of [-0.6, 0.6]) {
    const head = new THREE.BoxGeometry(0.06, 0.12, 0.34);
    head.translate(2.15, 0.72, z);
    lights.push(head.toNonIndexed());
  }
  const tails: THREE.BufferGeometry[] = [];
  for (const z of [-0.62, 0.62]) {
    const t = new THREE.BoxGeometry(0.06, 0.12, 0.3);
    t.translate(-2.17, 0.74, z);
    tails.push(t.toNonIndexed());
  }
  const parts = [bodyG.toNonIndexed(), cabinG.toNonIndexed(), mergeGeometries(wheels)!, mergeGeometries(lights)!, mergeGeometries(tails)!];
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts, true)!;
}

const CAR_COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#2471a3', '#7f8c8d', '#f1c40f', '#1e8449', '#8e2b20', '#d6d0c4'];

function carMaterials() {
  return [
    new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: '#1c2630', metalness: 0.9, roughness: 0.06 }),
    new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: '#fff6dd', emissive: '#fff2cc', emissiveIntensity: 0.6 }),
    new THREE.MeshStandardMaterial({ color: '#b3171b', emissive: '#c0141a', emissiveIntensity: 0.5 }),
  ];
}

/** karşı şeritten geçen ve önümüzde giden arabalar (dünya koordinatında, koşu bandının dışında) */
function Traffic({ count }: { count: number }) {
  const geo = useMemo(carGeometry, []);
  const mats = useMemo(carMaterials, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const cars = useMemo(() => {
    const r = seeded(5);
    return Array.from({ length: count }, (_, i) => ({
      x: -56 + (i / count) * 112 + r() * 6,
      speed: 18 + r() * 6,
      color: new THREE.Color(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]),
    }));
  }, [count]);
  useEffect(() => {
    const im = ref.current;
    if (!im) return;
    cars.forEach((c, i) => im.setColorAt(i, c.color));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [cars]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, dt) => {
    const im = ref.current;
    if (!im) return;
    const d = Math.min(dt, 0.05);
    cars.forEach((c, i) => {
      c.x += c.speed * d;
      if (c.x > 56) c.x -= 112;
      m.makeTranslation(c.x, ROAD.y, 5.0);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  });
  useEffect(
    () => () => {
      geo.dispose();
      mats.forEach(x => x.dispose());
    },
    [geo, mats],
  );
  return <instancedMesh ref={ref} args={[geo, mats, count]} frustumCulled={false} />;
}

/** kaldırım kenarına park etmiş arabalar: koşu bandıyla birlikte akar */
function ParkedCars() {
  const geo = useMemo(carGeometry, []);
  const mats = useMemo(carMaterials, []);
  const im = useMemo(() => {
    const r = seeded(8);
    const spots: number[] = [];
    for (let x = -STREET_SPAN / 2 + 3; x < STREET_SPAN / 2 - 4; x += 9 + r() * 7) spots.push(x);
    const mesh = new THREE.InstancedMesh(geo, mats, spots.length * COPIES);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let c = 0; c < COPIES; c++)
      for (const x of spots) {
        m.makeTranslation(START + STREET_SPAN / 2 + c * STREET_SPAN + x, ROAD.y, ROAD.left - 1.05);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, new THREE.Color(CAR_COLORS[(k * 5 + 3) % CAR_COLORS.length]));
        k++;
      }
    mesh.computeBoundingSphere();
    return mesh;
  }, [geo, mats]);
  useEffect(
    () => () => {
      im.dispose();
      geo.dispose();
      mats.forEach(x => x.dispose());
    },
    [im, geo, mats],
  );
  return <primitive object={im} />;
}

// ---------- yol ----------

function roadTexture() {
  // 12 m × yol genişliği; tuval y'si sağ bordürden (0) sol bordüre (H)
  const W = 512;
  const H = 512;
  const width = ROAD.left - ROAD.right;
  const zy = (z: number) => ((z - ROAD.right) / width) * H;
  return canvasTexture(W, H, g => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = tileFbm(x / 16, y / 16, 32, 4, 9);
        const v = 70 + n * 26 + (Math.random() - 0.5) * 14;
        const i = (y * W + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v + 1;
        img.data[i + 2] = v + 4;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    // yama ve çatlaklar
    g.fillStyle = 'rgba(30,30,32,0.35)';
    g.fillRect(300, zy(-1.5), 120, 60);
    g.strokeStyle = 'rgba(25,25,28,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(40, zy(0.5));
    g.lineTo(90, zy(0.9));
    g.lineTo(130, zy(0.7));
    g.stroke();
    // kenar çizgileri ve ortada kesikli şerit
    g.fillStyle = '#e9e6dc';
    g.fillRect(0, zy(ROAD.right + 0.3), W, 5);
    g.fillRect(0, zy(ROAD.left - 0.3) - 5, W, 5);
    g.fillStyle = '#f2f0e8';
    g.fillRect(0, zy(ROAD.center) - 4, W / 3, 8);
  });
}

function Road({ speed }: { speed: number }) {
  const mat = useMemo(() => {
    const t = roadTexture();
    t.repeat.set(112 / 12, 1);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 });
  }, []);
  useFrame((_, dt) => {
    // sokak +x yönüne akar: doku da aynı hızla kayar
    if (mat.map) mat.map.offset.x -= (Math.min(dt, 0.05) * speed) / 12;
  });
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  const width = ROAD.left - ROAD.right;
  return (
    <group>
      <mesh position={[0, ROAD.y, (ROAD.left + ROAD.right) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
        <planeGeometry args={[112, width]} />
      </mesh>
      {/* binaların arasından görünen zemin */}
      <mesh position={[0, ROAD.y - 0.05, 4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[112, 60]} />
        <meshStandardMaterial color="#6d6a64" roughness={1} />
      </mesh>
    </group>
  );
}

// ---------- şehir ----------

/** Otobüsün dışındaki şehir; speed: otobüsün hızı (m/sn) */
export function City({ speed, quality }: { speed: number; quality: QualityLevel }) {
  const low = quality === 'low';
  const plan = useMemo(() => planStreet(low), [low]);
  const items = useMemo(furniture, []);
  const wallLamps = useMemo(
    () => plan.wallLamps.flatMap(m => Array.from({ length: COPIES }, (_, c) => new THREE.Matrix4().makeTranslation(START + STREET_SPAN / 2 + c * STREET_SPAN, 0, 0).multiply(m))),
    [plan],
  );
  const treadmill = useRef<THREE.Group>(null);
  useTreadmill(treadmill, 'x', speed, STREET_SPAN);
  return (
    <group>
      <Road speed={speed} />
      <Traffic count={low ? 3 : 6} />
      <group ref={treadmill}>
        <Sidewalks />
        <Suspense fallback={null}>
          <Buildings plan={plan} />
        </Suspense>
        <Signage plan={plan} />
        <ParkedCars />
        <Trees spots={items.trees} />
        {/* ağaç dipleri */}
        {items.pits.map((p, i) => (
          <mesh key={i} position={[p.x, ROAD.walkY + 0.004, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.1, 1.1]} />
            <meshStandardMaterial color="#4a3b2c" roughness={1} />
          </mesh>
        ))}
        <ModelInstances name="streetLamp" transforms={items.lamps} />
        <ModelInstances name="hydrant" transforms={items.hydrants} />
        <ModelInstances name="bench" transforms={items.benches} />
        <ModelInstances name="trashCan" transforms={items.cans} />
        <ModelInstances name="utilityBox" transforms={items.boxes} />
        <ModelInstances name="wallLamp" transforms={wallLamps} />
      </group>
    </group>
  );
}
