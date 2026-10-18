import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from './common';

/**
 * Kodla üretilen yolcu uçağı (indirme yok): burun -z yönünde, gövde ekseni orijinde.
 * Gövde halkalardan örülür (burun aşağı eğik, kuyruk yukarı kalkık); kanat, kuyruk ve winglet'ler
 * gerçek kanat kesitinden (NACA) örülür; motorlarda dönen fan, burun konisi ve egzoz vardır.
 */

const R = 2.2;
/** gövde: burun ucu, düz bölümün başı ve sonu, kuyruk ucu (z) */
const NOSE = -16;
const BODY_A = -10.5;
const BODY_B = 8.5;
const TAIL = 21;
const LEN = TAIL - NOSE;
const OVAL = 1.03;

function section(z: number) {
  if (z < BODY_A) {
    const t = (z - NOSE) / (BODY_A - NOSE);
    return { r: R * Math.sqrt(1 - Math.pow(1 - t, 2.3)), cy: -0.42 * (1 - t) * (1 - t) };
  }
  if (z > BODY_B) {
    const t = (z - BODY_B) / (TAIL - BODY_B);
    const s = t * t * (3 - 2 * t);
    const r = R * (1 - 0.86 * s);
    // üst çizgi neredeyse düz kalır, alt çizgi kuyruğa doğru yükselir
    return { r, cy: (R - r) * 0.8 };
  }
  return { r: R, cy: 0 };
}

/** gövde yüzeyinin dışarıdaki noktası: a=0 alt, π/2 sağ (+x), π üst */
export function hullPoint(z: number, a: number) {
  const { r, cy } = section(z);
  return new THREE.Vector3(Math.sin(a) * r, cy - Math.cos(a) * r * OVAL, z);
}

function fuselageGeometry(around: number) {
  const zs: number[] = [];
  for (let i = 0; i <= 22; i++) zs.push(NOSE + (BODY_A - NOSE) * Math.pow(i / 22, 1.9));
  for (let z = BODY_A + 1.5; z < BODY_B; z += 1.5) zs.push(z);
  for (let i = 0; i <= 20; i++) zs.push(BODY_B + ((TAIL - BODY_B) * i) / 20);
  const pos: number[] = [];
  const uv: number[] = [];
  for (const z of zs)
    for (let j = 0; j <= around; j++) {
      const p = hullPoint(z, (j / around) * Math.PI * 2);
      pos.push(p.x, p.y, p.z);
      uv.push((z - NOSE) / LEN, j / around);
    }
  const idx: number[] = [];
  const row = around + 1;
  for (let i = 0; i < zs.length - 1; i++)
    for (let j = 0; j < around; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- kanat kesitleri ----------

interface Section {
  le: [number, number, number];
  chord: number;
  /** kalınlık oranı (NACA 00xx) */
  thick: number;
}

/** simetrik NACA kesiti: üst yüzey firar kenarından hücum kenarına, alt yüzey geri */
function airfoil(k: number) {
  const pts: { c: number; s: number }[] = [];
  const c = (i: number) => (1 - Math.cos((Math.PI * i) / k)) / 2;
  for (let i = k; i >= 0; i--) pts.push({ c: c(i), s: 1 });
  for (let i = 1; i <= k; i++) pts.push({ c: c(i), s: -1 });
  return pts;
}
const yt = (c: number, t: number) => 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);

/**
 * Kesitler arasında yüzey örer. chordDir: hücumdan firara, thickDir: kalınlık (üst yüzey +).
 * uvOf: noktanın doku koordinatı (üst/alt yüzey ayrı verilebilir: yazılar iki yanda da düz okunur).
 * flip: kalınlığı yatay (x) olan dikey yüzeylerde üçgenlerin yönü ters çevrilir, yüzey dışa bakar.
 */
function loft(sections: Section[], chordDir: THREE.Vector3, thickDir: THREE.Vector3, uvOf: (p: THREE.Vector3, upper: boolean) => [number, number], camber = 0, k = 14, flip = false) {
  const foil = airfoil(k);
  const pos: number[] = [];
  const uv: number[] = [];
  const p = new THREE.Vector3();
  for (const s of sections)
    for (const f of foil) {
      const camb = camber * 4 * f.c * (1 - f.c);
      p.set(...s.le)
        .addScaledVector(chordDir, f.c * s.chord)
        .addScaledVector(thickDir, (f.s * yt(f.c, s.thick) + camb) * s.chord);
      pos.push(p.x, p.y, p.z);
      uv.push(...uvOf(p, f.s > 0));
    }
  const n = foil.length;
  const idx: number[] = [];
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = a + n;
      if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
      else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // uç kapağı: son kesit yelpazeyle kapanır
  const last = (sections.length - 1) * n;
  const center = new THREE.Vector3();
  for (let j = 0; j < n; j++) center.add(new THREE.Vector3(pos[(last + j) * 3], pos[(last + j) * 3 + 1], pos[(last + j) * 3 + 2]));
  center.multiplyScalar(1 / n);
  const ci = pos.length / 3;
  pos.push(center.x, center.y, center.z);
  uv.push(...uvOf(center, true));
  for (let j = 0; j < n - 1; j++) idx.push(...(flip ? [last + j, last + j + 1, ci] : [last + j, ci, last + j + 1]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** sağ kanat (x > 0); sol kanat aynalanır */
const WING: Section[] = [
  { le: [1.2, -1.45, -3.2], chord: 7.2, thick: 0.14 },
  { le: [6.0, -1.03, -0.43], chord: 4.4, thick: 0.12 },
  { le: [17.0, -0.07, 5.49], chord: 1.5, thick: 0.1 },
];
const WINGLET: Section[] = [
  { le: [17.02, -0.06, 5.55], chord: 1.4, thick: 0.09 },
  { le: [17.25, 0.6, 6.15], chord: 1.05, thick: 0.09 },
  { le: [17.55, 1.75, 7.05], chord: 0.55, thick: 0.08 },
];
const STAB: Section[] = [
  { le: [0.6, 0.35, 14.6], chord: 4.2, thick: 0.1 },
  { le: [7.2, 1.04, 18.7], chord: 1.6, thick: 0.09 },
];
const FIN: Section[] = [
  { le: [0, 1.2, 12.2], chord: 6.6, thick: 0.11 },
  { le: [0, 7.6, 17.9], chord: 2.4, thick: 0.1 },
];

/** kanadın x açıklığındaki hücum kenarı, veter ve yüksekliği (kesitler arası doğrusal) */
function wingAt(x: number) {
  const [a, b] = x < WING[1].le[0] ? [WING[0], WING[1]] : [WING[1], WING[2]];
  const t = (x - a.le[0]) / (b.le[0] - a.le[0]);
  const l = (i: number) => a.le[i] + (b.le[i] - a.le[i]) * t;
  return { y: l(1), z: l(2), chord: a.chord + (b.chord - a.chord) * t };
}

// ---------- dokular ----------

function liveryTexture() {
  const W = 2048;
  const H = 512;
  const zx = (z: number) => ((z - NOSE) / LEN) * W;
  const vy = (v: number) => (1 - v) * H;
  return canvasTexture(W, H, g => {
    g.fillStyle = '#f3f5f7';
    g.fillRect(0, 0, W, H);
    // gri karın
    g.fillStyle = '#d0d6dd';
    g.fillRect(0, vy(0.17), W, H - vy(0.17));
    g.fillRect(0, 0, W, vy(0.83));
    // panel çizgileri
    g.fillStyle = 'rgba(40,50,60,0.10)';
    for (let x = zx(-14); x < zx(19); x += 64) g.fillRect(x, 0, 1.5, H);
    for (const v of [0.12, 0.4, 0.6, 0.88]) g.fillRect(0, vy(v), W, 1.5);
    // iki yanda kırmızı-sarı şerit; kuyruğa doğru yukarı kıvrılır
    for (const side of [1, -1]) {
      const v0 = side > 0 ? 0.205 : 0.795;
      const dir = side;
      const stripe = (dv: number, h: number, color: string) => {
        g.fillStyle = color;
        g.beginPath();
        const y0 = vy(v0 - dir * dv);
        g.moveTo(zx(-12.8), y0);
        g.lineTo(zx(11), y0);
        g.lineTo(zx(16.5), y0 - dir * 70);
        g.lineTo(zx(16.5), y0 - dir * 70 + dir * h);
        g.lineTo(zx(11), y0 + dir * h);
        g.lineTo(zx(-12.8), y0 + dir * h);
        g.closePath();
        g.fill();
      };
      stripe(0, 9, '#e5322d');
      stripe(0.028, 5, '#f5c400');
      // pencere sırası
      const vw = side > 0 ? 0.312 : 0.688;
      for (let z = -9.6; z <= 7.9; z += 0.52) {
        if (Math.abs(z + 9.25) < 0.6 || Math.abs(z - 1.25) < 0.42 || Math.abs(z - 7.95) < 0.6) continue;
        g.fillStyle = '#1d2834';
        g.beginPath();
        g.roundRect(zx(z) - 6, vy(vw) - 7.5, 12, 15, 5);
        g.fill();
        g.fillStyle = 'rgba(150,190,230,0.35)';
        g.fillRect(zx(z) - 4, vy(vw) - 5.5, 3, 5);
      }
      // kapılar ve kanat üstü acil çıkış
      g.strokeStyle = '#8d97a2';
      g.lineWidth = 2;
      const door = (z: number, w: number, h: number) => {
        g.beginPath();
        g.roundRect(zx(z) - w / 2, vy(vw) - h * 0.45, w, h, 8);
        g.stroke();
      };
      door(-9.25, 46, 68);
      door(7.95, 46, 68);
      door(1.25, 28, 30);
      // kokpit camları
      g.fillStyle = '#18222c';
      const vc = side > 0 ? 0.385 : 0.615;
      const panes: [number, number][] = [
        [-13.25, -12.85],
        [-12.75, -12.35],
        [-12.25, -11.95],
      ];
      for (const [a, b] of panes) {
        g.beginPath();
        g.moveTo(zx(a), vy(vc + dir * 0.02));
        g.lineTo(zx(b), vy(vc + dir * 0.025));
        g.lineTo(zx(b), vy(vc - dir * 0.03));
        g.lineTo(zx(a) + 4, vy(vc - dir * 0.03));
        g.closePath();
        g.fill();
      }
    }
    // üstte, güverteden okunan büyük logo (burna doğru)
    g.save();
    g.setTransform(0, 1, 1, 0, zx(-6.3), vy(0.5));
    g.fillStyle = '#e5322d';
    g.beginPath();
    g.ellipse(0, 0, 150, 52, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f5c400';
    g.font = 'italic 900 78px Rubik, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UNO', 0, 4);
    g.restore();
  });
}

function wingTexture() {
  const W = 1024;
  const H = 512;
  // üstten izdüşüm: u = x / 18, v = (z + 3.5) / 13
  const px = (x: number) => (x / 18) * W;
  const py = (z: number) => (1 - (z + 3.5) / 13) * H;
  return canvasTexture(W, H, g => {
    g.fillStyle = '#d3d8de';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(60,70,80,0.28)';
    g.lineWidth = 1.5;
    // flap ve spoiler menteşe çizgileri; açıklık boyunca bölmeler
    for (const f of [0.62, 0.76]) {
      g.beginPath();
      for (let x = 2; x <= 15.5; x += 0.5) {
        const w = wingAt(x);
        const y = py(w.z + w.chord * f);
        if (x === 2) g.moveTo(px(x), y);
        else g.lineTo(px(x), y);
      }
      g.stroke();
    }
    for (const x of [2, 4.2, 6.4, 8.6, 10.8, 13, 15.5]) {
      const w = wingAt(x);
      g.beginPath();
      g.moveTo(px(x), py(w.z + w.chord * 0.62));
      g.lineTo(px(x), py(w.z + w.chord));
      g.stroke();
    }
    // hücum kenarı kanatçıkları (slat) ve panel ızgarası
    g.strokeStyle = 'rgba(60,70,80,0.14)';
    for (let x = 1.5; x < 17; x += 1.1) {
      const w = wingAt(x);
      g.beginPath();
      g.moveTo(px(x), py(w.z));
      g.lineTo(px(x), py(w.z + w.chord * 0.62));
      g.stroke();
    }
    g.beginPath();
    for (let x = 1.5; x <= 17; x += 0.5) {
      const w = wingAt(x);
      if (x === 1.5) g.moveTo(px(x), py(w.z + w.chord * 0.14));
      else g.lineTo(px(x), py(w.z + w.chord * 0.14));
    }
    g.stroke();
    // gövdeye yakın yürüme yolu
    g.strokeStyle = 'rgba(30,30,30,0.5)';
    g.setLineDash([10, 6]);
    g.strokeRect(px(1.6), py(0.6), px(1.5), py(-1.6) - py(0.6));
    g.setLineDash([]);
  });
}

function tailTexture() {
  return canvasTexture(512, 512, g => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#f0443c');
    grd.addColorStop(1, '#b81f1a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    g.save();
    g.translate(256, 262);
    g.rotate(-0.42);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(0, 0, 118, 66, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e5322d';
    g.beginPath();
    g.ellipse(0, 0, 104, 54, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.fillStyle = '#f5c400';
    g.strokeStyle = '#3a0c0a';
    g.lineWidth = 8;
    g.font = 'italic 900 92px Rubik, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeText('UNO', 256, 266);
    g.fillText('UNO', 256, 266);
    g.fillStyle = '#f5c400';
    g.fillRect(0, 470, 512, 16);
  });
}

// ---------- motor ----------

function nacelleGeometry() {
  // (yarıçap, ön→arka); torna ile döndürülüp ekseni z'ye çevrilir: ön z=0, arka +z
  const outer = [
    [0.86, -0.75],
    [0.88, -0.3],
    [0.93, -0.06],
    [0.99, 0.02],
    [1.05, -0.06],
    [1.09, -0.35],
    [1.1, -1.0],
    [1.06, -2.2],
    [0.95, -3.1],
    [0.82, -3.55],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(outer, 40);
  g.rotateX(-Math.PI / 2);
  return g;
}

function coreGeometry() {
  const pts = [
    [0.7, -3.3],
    [0.64, -3.75],
    [0.52, -4.35],
    [0.4, -4.3],
    [0.3, -4.7],
    [0.12, -5.1],
    [0.01, -5.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateX(-Math.PI / 2);
  return g;
}

function fanGeometry(blades: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blades; i++) {
    const b = new THREE.BoxGeometry(0.2, 0.62, 0.035);
    b.translate(0, 0.5, 0);
    b.rotateY(0.55);
    b.rotateZ((i / blades) * Math.PI * 2);
    parts.push(b);
  }
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 20);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  return mergeGeometries(parts.map(p => p.toNonIndexed()))!;
}

function spinnerGeometry() {
  const g = new THREE.ConeGeometry(0.26, 0.5, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

function pylonGeometry() {
  const s = new THREE.Shape();
  // yan profil (z, y): motorun üstünden kanadın altına
  s.moveTo(-0.6, 0);
  s.lineTo(3.6, 0);
  s.lineTo(4.6, 0.45);
  s.lineTo(0.6, 0.5);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  // şekil (x=z, y=y) düzleminden gerçek eksenlere: z ekseni boyunca uzanır, x'te ince
  g.rotateY(-Math.PI / 2);
  g.translate(0.12, 0, 0);
  return g;
}

// ---------- iz bulutu (contrail) ----------

const contrailMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uOpacity: { value: 0.55 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying vec3 vN; varying vec3 vView;
    void main() {
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vView = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    varying vec2 vUv; varying vec3 vN; varying vec3 vView;
    void main() {
      // silindirin kenarları yumuşak söner; motordan biraz geride başlar, uzakta dağılır
      float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.4);
      float along = smoothstep(0.0, 0.07, vUv.y) * pow(1.0 - vUv.y, 1.3);
      gl_FragColor = vec4(vec3(1.0), edge * along * uOpacity);
      #include <colorspace_fragment>
    }`,
});

function Contrail({ from, length = 42, radius = [0.18, 1.4] }: { from: [number, number, number]; length?: number; radius?: [number, number] }) {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(radius[1], radius[0], length, 16, 24, true);
    // silindirin ekseni y: ince ucu orijine gelecek şekilde kaydırılıp +z yönüne (geriye) çevrilir
    g.translate(0, length / 2, 0);
    g.rotateX(Math.PI / 2);
    return g;
  }, [length, radius]);
  return <mesh geometry={geo} material={contrailMat} position={from} renderOrder={2} />;
}

// ---------- ışıklar ----------

function Blinker({ position, color, period, on = 0.08, size = 0.09, offset = 0 }: { position: [number, number, number]; color: string; period: number; on?: number; size?: number; offset?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.visible = ((clock.elapsedTime + offset) % period) / period < on;
  });
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(8), [color]);
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[size, 10, 8]} />
      <meshBasicMaterial color={c} toneMapped={false} />
    </mesh>
  );
}

// ---------- uçak ----------

interface AirlinerProps {
  /** uzaktan görünen uçak: fan kanatları, iç ayrıntılar ve iz bulutu sadeleşir */
  far?: boolean;
  contrails?: boolean;
  fanSpeed?: number;
}

export function Airliner({ far = false, contrails = true, fanSpeed = 22 }: AirlinerProps) {
  const geo = useMemo(() => {
    const wingUv = (p: THREE.Vector3): [number, number] => [Math.abs(p.x) / 18, (p.z + 3.5) / 13];
    // dikey kuyruk: iki yanda da yazı düz okunsun diye sağ ve sol yüz ters yönde eşlenir
    const finUv = (p: THREE.Vector3, upper: boolean): [number, number] => {
      const u = (p.z - 12.2) / (20.3 - 12.2);
      return [upper ? 1 - u : u, (p.y - 1.2) / (7.6 - 1.2)];
    };
    return {
      fuselage: fuselageGeometry(far ? 28 : 56),
      wing: loft(WING, Z, Y, wingUv, 0.012, far ? 8 : 16),
      winglet: loft(WINGLET, Z, X, wingUv, 0, far ? 6 : 10, true),
      stab: loft(STAB, Z, Y, wingUv, 0, far ? 6 : 12),
      fin: loft(FIN, Z, X, finUv, 0, far ? 6 : 14, true),
      nacelle: nacelleGeometry(),
      core: coreGeometry(),
      fan: fanGeometry(22),
      spinner: spinnerGeometry(),
      pylon: pylonGeometry(),
    };
  }, [far]);
  useEffect(() => () => Object.values(geo).forEach(g => g.dispose()), [geo]);
  const mats = useMemo(() => {
    const livery = liveryTexture();
    const wing = wingTexture();
    const tail = tailTexture();
    return {
      body: new THREE.MeshStandardMaterial({ map: livery, metalness: 0.25, roughness: 0.32 }),
      wing: new THREE.MeshStandardMaterial({ map: wing, metalness: 0.55, roughness: 0.36 }),
      tail: new THREE.MeshStandardMaterial({ map: tail, metalness: 0.2, roughness: 0.35 }),
      white: new THREE.MeshStandardMaterial({ color: '#eef1f4', metalness: 0.3, roughness: 0.3, side: THREE.DoubleSide }),
      chrome: new THREE.MeshStandardMaterial({ color: '#c9ced5', metalness: 1, roughness: 0.18 }),
      dark: new THREE.MeshStandardMaterial({ color: '#15181c', metalness: 0.6, roughness: 0.45 }),
      core: new THREE.MeshStandardMaterial({ color: '#7d848c', metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide }),
      fan: new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.9, roughness: 0.28 }),
      spinner: new THREE.MeshStandardMaterial({ color: '#2b2f35', metalness: 0.7, roughness: 0.3 }),
      fairing: new THREE.MeshStandardMaterial({ color: '#cfd4da', metalness: 0.5, roughness: 0.4 }),
    };
  }, []);
  useEffect(
    () => () =>
      Object.values(mats).forEach(m => {
        m.map?.dispose();
        m.dispose();
      }),
    [mats],
  );
  const fans = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    fans.current?.children.forEach(f => (f.rotation.z += Math.min(dt, 0.05) * fanSpeed));
  });

  const engine = wingAt(6);
  const engPos: [number, number, number] = [6, -2.5, engine.z - 2.55];
  const fairings = [4, 8.5, 12.5].map(x => {
    const w = wingAt(x);
    return [x, w.y - 0.22, w.z + w.chord * 0.78] as [number, number, number];
  });
  const shadow = !far;

  return (
    <group>
      <mesh geometry={geo.fuselage} material={mats.body} castShadow={shadow} receiveShadow />
      {/* kuyruktaki yardımcı güç ünitesi çıkışı */}
      <mesh position={[0, section(TAIL).cy, TAIL]} rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
        <cylinderGeometry args={[0.22, 0.3, 0.3, 16]} />
      </mesh>
      {/* kanat-gövde birleşim kaportası */}
      <mesh position={[0, -1.75, 0.6]} scale={[1.75, 0.75, 6.2]} material={mats.fairing}>
        <sphereGeometry args={[1, 24, 12]} />
      </mesh>
      <mesh geometry={geo.fin} material={mats.tail} castShadow={shadow} />
      {[1, -1].map(side => (
        <group key={side} scale={[side, 1, 1]}>
          <mesh geometry={geo.wing} material={mats.wing} castShadow={shadow} receiveShadow />
          <mesh geometry={geo.winglet} material={mats.tail} />
          <mesh geometry={geo.stab} material={mats.wing} />
          {!far &&
            fairings.map((p, i) => (
              <mesh key={i} position={p} scale={[0.16, 0.2, 1.5]} material={mats.fairing}>
                <sphereGeometry args={[1, 12, 8]} />
              </mesh>
            ))}
          {/* motor: kaporta, iç halka, fan, burun konisi, çekirdek ve egzoz; askısıyla kanada bağlı */}
          <group position={engPos}>
            <mesh geometry={geo.nacelle} material={mats.white} castShadow={shadow} />
            <mesh position={[0, 0, -0.02]} material={mats.chrome}>
              <torusGeometry args={[0.95, 0.055, 10, 40]} />
            </mesh>
            <mesh geometry={geo.core} material={mats.core} />
            <mesh position={[0, 0, 0.8]} rotation={[0, Math.PI, 0]} material={mats.dark}>
              <circleGeometry args={[0.86, 32]} />
            </mesh>
            <mesh geometry={geo.pylon} position={[0, 0.95, 0.3]} material={mats.white} />
          </group>
          {/* kanat ucu seyir ışıkları: sağ yeşil, sol kırmızı; beyaz flaşör */}
          <mesh position={[17.1, -0.02, 5.75]}>
            <sphereGeometry args={[0.07, 10, 8]} />
            <meshBasicMaterial color={side > 0 ? new THREE.Color('#3dff6a').multiplyScalar(4) : new THREE.Color('#ff3d3d').multiplyScalar(4)} toneMapped={false} />
          </mesh>
          <Blinker position={[17.15, 0.02, 6.6]} color="#ffffff" period={1.3} offset={side > 0 ? 0 : 0.12} size={0.1} />
        </group>
      ))}
      {/* fanlar ayrı grupta döner (sağ ve sol) */}
      <group ref={fans}>
        {[1, -1].map(side => (
          <group key={side} position={[side * engPos[0], engPos[1], engPos[2] + 0.55]}>
            {!far && <mesh geometry={geo.fan} material={mats.fan} />}
            <mesh geometry={geo.spinner} position={[0, 0, -0.18]} material={mats.spinner} />
          </group>
        ))}
      </group>
      {/* kırmızı çakar ışıklar: üstte kuyruğa yakın ve karında */}
      <Blinker position={[0, 2.3, 9.6]} color="#ff2a2a" period={1.1} on={0.12} size={0.11} />
      <Blinker position={[0, -2.34, -1.5]} color="#ff2a2a" period={1.1} on={0.12} size={0.11} offset={0.5} />
      <Blinker position={[0, 7.75, 20.3]} color="#ffffff" period={1.3} size={0.09} offset={0.6} />
      {contrails &&
        [1, -1].flatMap(side => [
          <Contrail key={`e${side}`} from={[side * engPos[0], engPos[1], engPos[2] + 7.5]} />,
          <Contrail key={`w${side}`} from={[side * 17.2, 0.0, 9]} radius={[0.08, 0.7]} length={38} />,
        ])}
    </group>
  );
}
