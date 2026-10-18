import { SEAT_R, seatAngles } from '../game/layout';

/**
 * Kamera sınırları: her atmosferin sabit engelleri (duvarlar, korkuluklar, direk, yelken, halatlar, avize,
 * sandalyeler) basit analitik hacimlerle tanımlanır. İstenen kamera konumu, güvenli bir noktadan çizilen
 * doğru boyunca ilk engelin önünde durdurulur. Dönen kameralar (ana ekran, oyun sonu) yarıçapı açıya göre
 * önceden hesaplanmış yumuşak bir profilden okur: engele yaklaşırken yavaşça içeri süzülür, sıçramaz.
 */

type V3 = readonly [number, number, number];
export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** pad: kameranın hacme en fazla bu kadar yaklaşabileceği pay (metre) */
export type Shape =
  /** kamera bu kutunun içinde kalır (oda, otobüs, uçak güvertesi) */
  | { k: 'inBox'; min: V3; max: V3; pad: number; name: string }
  /** kamera orijindeki dikey silindirin içinde kalır (balon sepeti, bulut adası) */
  | { k: 'inCyl'; r: number; y0: number; y1: number; pad: number; name: string }
  /** kamera tabanı çokgen olan dikey prizmanın içinde kalır (tekne güvertesi); pts: x,z çiftleri */
  | { k: 'inPoly'; pts: Float64Array; y0: number; y1: number; pad: number; name: string }
  | { k: 'box'; min: V3; max: V3; pad: number; name: string }
  /** dikey silindir: sandalye + oturan karakter, avize, varil, saksı */
  | { k: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; pad: number; name: string }
  /** kapsül: halat, direk, tutunma borusu */
  | { k: 'seg'; a: V3; b: V3; r: number; pad: number; name: string }
  /** duvar dibi şeridi: |x| ya da |z| değeri half'i aşan alçak bölge (duvar boyu eşyalar) */
  | { k: 'band'; half: number; y0: number; y1: number; pad: number; name: string }
  /** dış halka: yarıçapı r'yi aşan alçak bölge (bulut adasının kenarındaki pofuduk bulutlar) */
  | { k: 'ring'; r: number; y0: number; y1: number; pad: number; name: string };

export interface CamBounds {
  shapes: Shape[];
  /** yükseklik/yarıçapa göre önbelleğe alınmış yörünge profilleri */
  profiles: Map<string, Float32Array>;
}

export interface Orbit {
  r: number;
  y: number;
}
/** ana ekranda masanın etrafında dönen kamera */
export const HOME_ORBIT: Orbit = { r: 3.1, y: 2.05 };
/** oyun sonunda masanın etrafında dönen kamera */
export const END_ORBIT: Orbit = { r: 2.55, y: 1.75 };

// ---------- uzaklık fonksiyonları (engelin dışında pozitif, içinde negatif) ----------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** iki eksende işaretli uzaklıktan (dışarıda pozitif) birleşik uzaklık */
function capped(qa: number, qb: number) {
  if (qa > 0 || qb > 0) {
    const a = qa > 0 ? qa : 0;
    const b = qb > 0 ? qb : 0;
    return Math.sqrt(a * a + b * b);
  }
  return qa > qb ? qa : qb;
}

function boxDist(min: V3, max: V3, x: number, y: number, z: number) {
  const qx = Math.max(min[0] - x, x - max[0]);
  const qy = Math.max(min[1] - y, y - max[1]);
  const qz = Math.max(min[2] - z, z - max[2]);
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/** çokgen kenarına uzaklık: içeride pozitif */
function polyDist(pts: Float64Array, x: number, z: number) {
  let d = Infinity;
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i], zi = pts[2 * i + 1], xj = pts[2 * j], zj = pts[2 * j + 1];
    const ex = xi - xj, ez = zi - zj;
    const t = clamp01(((x - xj) * ex + (z - zj) * ez) / (ex * ex + ez * ez));
    const dx = x - (xj + ex * t), dz = z - (zj + ez * t);
    d = Math.min(d, dx * dx + dz * dz);
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside ? Math.sqrt(d) : -Math.sqrt(d);
}

/** şeklin ham (paysız) uzaklığı */
export function shapeDistance(s: Shape, x: number, y: number, z: number): number {
  switch (s.k) {
    case 'inBox':
      return -boxDist(s.min, s.max, x, y, z);
    case 'inCyl':
      return -capped(Math.sqrt(x * x + z * z) - s.r, Math.max(s.y0 - y, y - s.y1));
    case 'inPoly':
      return -capped(-polyDist(s.pts, x, z), Math.max(s.y0 - y, y - s.y1));
    case 'box':
      return boxDist(s.min, s.max, x, y, z);
    case 'cyl': {
      const dx = x - s.x, dz = z - s.z;
      return capped(Math.sqrt(dx * dx + dz * dz) - s.r, Math.max(s.y0 - y, y - s.y1));
    }
    case 'seg': {
      const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2];
      const px = x - s.a[0], py = y - s.a[1], pz = z - s.a[2];
      const t = clamp01((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz));
      const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - s.r;
    }
    case 'band':
      return capped(s.half - Math.max(Math.abs(x), Math.abs(z)), Math.max(s.y0 - y, y - s.y1));
    case 'ring':
      return capped(s.r - Math.sqrt(x * x + z * z), Math.max(s.y0 - y, y - s.y1));
  }
}

/** En yakın engele kalan boşluk (paylar düşülmüş); pozitifse kamera serbest */
export function clearance(b: CamBounds, x: number, y: number, z: number, padded = true) {
  let d = Infinity;
  for (const s of b.shapes) {
    const v = shapeDistance(s, x, y, z) - (padded ? s.pad : 0);
    if (v < d) d = v;
  }
  return d;
}

/**
 * from → to doğrusu boyunca ilk engelin önünde durur (uzaklık adımlarıyla ilerler, ince engeli atlamaz).
 * Sonucu out'a yazar, gidilebilen oranı (0..1) döndürür. Başlangıç noktası doluysa orada kalır.
 */
export function clampSegment(b: CamBounds, from: Vec, to: Vec, out: Vec): number {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let t = 0;
  if (len < 1e-6) t = clearance(b, to.x, to.y, to.z) > 0 ? len : 0;
  else if (clearance(b, from.x, from.y, from.z) > 0) {
    for (let i = 0; i < 400 && t < len; i++) {
      const k = t / len;
      const c = clearance(b, from.x + dx * k, from.y + dy * k, from.z + dz * k);
      if (c <= 1e-3) break;
      t += Math.max(c, 0.003);
    }
    if (t > len) t = len;
  }
  const f = len < 1e-6 ? (t > 0 ? 1 : 0) : t / len;
  out.x = from.x + dx * f;
  out.y = from.y + dy * f;
  out.z = from.z + dz * f;
  return f;
}

// ---------- yörünge profili ----------

const PROFILE_N = 360;
/** yarıçap taraması masanın kenarından sonra başlar (ortadaki avizenin altı sayılmaz) */
const R_START = 1.15;
/** aşındırma penceresi (örnek = 1°): yarıçap engelden ~24° önce kısalmaya başlar */
const ERODE = 24;
/** iki kez kutu yumuşatma; toplam genişlik aşındırmadan dar kalır, böylece profil hiçbir açıda engele değmez */
const BLUR = 10;

function buildProfile(b: CamBounds, o: Orbit) {
  const raw = new Float32Array(PROFILE_N);
  const from = { x: 0, y: o.y, z: 0 };
  const to = { x: 0, y: o.y, z: 0 };
  const tmp = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    if (o.r <= R_START) {
      raw[i] = o.r;
      continue;
    }
    from.x = Math.sin(a) * R_START;
    from.z = Math.cos(a) * R_START;
    to.x = Math.sin(a) * o.r;
    to.z = Math.cos(a) * o.r;
    raw[i] = R_START + clampSegment(b, from, to, tmp) * (o.r - R_START);
  }
  // aşındır: her açıda komşu açıların en küçüğü (engelin önünden geçerken yarıçap önceden kısalır)
  let cur = new Float32Array(PROFILE_N);
  for (let i = 0; i < PROFILE_N; i++) {
    let m = Infinity;
    for (let j = -ERODE; j <= ERODE; j++) m = Math.min(m, raw[(i + j + PROFILE_N) % PROFILE_N]);
    cur[i] = m;
  }
  // yumuşat: yarıçap açıyla yavaşça değişir
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(PROFILE_N);
    for (let i = 0; i < PROFILE_N; i++) {
      let s = 0;
      for (let j = -BLUR; j <= BLUR; j++) s += cur[(i + j + PROFILE_N) % PROFILE_N];
      next[i] = s / (2 * BLUR + 1);
    }
    cur = next;
  }
  return cur;
}

/** Yörüngedeki kameranın bu açıda (x = sin, z = cos) güvenle çıkabileceği yarıçap */
export function orbitRadius(b: CamBounds, o: Orbit, angle: number): number {
  const key = `${o.r}|${o.y}`;
  let p = b.profiles.get(key);
  if (!p) {
    p = buildProfile(b, o);
    b.profiles.set(key, p);
  }
  let u = ((angle / (Math.PI * 2)) % 1) * PROFILE_N;
  if (u < 0) u += PROFILE_N;
  const i = Math.floor(u) % PROFILE_N;
  const f = u - Math.floor(u);
  return p[i] * (1 - f) + p[(i + 1) % PROFILE_N] * f;
}

// ---------- atmosferlere göre engeller ----------

const box = (name: string, min: V3, max: V3, pad = 0.12): Shape => ({ k: 'box', min, max, pad, name });
const cyl = (name: string, x: number, z: number, r: number, y0: number, y1: number, pad = 0.12): Shape => ({ k: 'cyl', x, z, r, y0, y1, pad, name });

/** kapalı odalar: 9 x 9 m kutu, tavandan sarkan avize ve duvar boyunca dizili eşyalar */
function room(): Shape[] {
  return [
    { k: 'inBox', min: [-4.5, 0, -4.5], max: [4.5, 4.9, 4.5], pad: 0.25, name: 'oda' },
    // avize/abajur: altı ~2.15 m, hafifçe sallanır
    cyl('avize', 0, 0, 0.6, 2.1, 4.9),
    // duvar dibindeki raflar, variller, saksılar, kanepeler
    { k: 'band', half: 3.6, y0: 0, y1: 2.4, pad: 0.1, name: 'duvar eşyaları' },
  ];
}

function barProps(): Shape[] {
  return [
    box('tezgâh', [-2.7, 0, -3.1], [2.7, 1.45, -2.35]),
    box('raflar', [-2.7, 0, -4.5], [2.7, 2.6, -3.35]),
    cyl('varil', -3.4, -3.0, 0.45, 0, 1.1),
    cyl('varil', -3.75, -2.15, 0.42, 0, 1.0),
    cyl('varil', 3.5, -2.9, 0.45, 0, 1.1),
    box('kasalar', [3.1, 0, -1.5], [4.1, 0.8, -0.5]),
    cyl('saksı', 3.7, 2.3, 0.55, 0, 1.9),
    cyl('saksı', -3.75, 3.0, 0.5, 0, 1.8),
  ];
}

function neonProps(): Shape[] {
  return [
    box('kanepe', [-1.4, 0, -4.5], [1.4, 1.0, -3.35]),
    box('koltuk', [-2.65, 0, -4.3], [-1.55, 1.05, -3.1]),
    box('koltuk', [1.55, 0, -4.3], [2.65, 1.05, -3.1]),
    cyl('saksı', -3.6, -3.8, 0.5, 0, 1.9),
    cyl('saksı', 3.6, -3.8, 0.5, 0, 1.9),
    cyl('saksı', 3.8, 3.6, 0.5, 0, 1.8),
    box('neon halka', [-0.8, 1.5, -4.5], [0.8, 3.1, -3.8]),
  ];
}

/** tekne korkuluğu: gövde şekliyle aynı eğriler (environments.tsx → boatShape), korkuluk %95 ölçekli */
function boatOutline() {
  const out: number[] = [];
  const cubic = (p: number[][]) => {
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const x = w.reduce((s, k, j) => s + k * p[j][0], 0);
      const y = w.reduce((s, k, j) => s + k * p[j][1], 0);
      out.push(x * 0.95, -y * 0.95 + 0.05);
    }
  };
  out.push(-2.45 * 0.95, 4.6 * 0.95 + 0.05);
  out.push(2.45 * 0.95, 4.6 * 0.95 + 0.05);
  cubic([[2.45, -4.6], [2.75, -0.5], [2.65, 2.4], [0, 6]]);
  cubic([[0, 6], [-2.65, 2.4], [-2.75, -0.5], [-2.45, -4.6]]);
  out.splice(out.length - 2, 2); // son nokta ilk noktayla aynı
  return new Float64Array(out);
}

function sceneShapes(scene: string): Shape[] {
  switch (scene) {
    case 'bar':
      return [...room(), ...barProps()];
    case 'neon':
      return [...room(), ...neonProps()];
    case 'clouds':
      return [
        { k: 'inCyl', r: 3.5, y0: 0, y1: 8, pad: 0.15, name: 'bulut adası' },
        // adanın kenarındaki alçak bulut öbekleri
        { k: 'ring', r: 2.2, y0: -2, y1: 0.6, pad: 0.1, name: 'kenar bulutları' },
      ];
    case 'plane':
      // korkuluklu kare güverte: kamera güvertenin üstünde kalır
      return [{ k: 'inBox', min: [-2.35, 0, -2.35], max: [2.35, 8, 2.35], pad: 0.22, name: 'güverte' }];
    case 'balloon': {
      const ropes: Shape[] = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return { k: 'seg', a: [Math.cos(a) * 2.42, 0.44, Math.sin(a) * 2.42], b: [Math.cos(a) * 1.25, 5.3, Math.sin(a) * 1.25], r: 0.01, pad: 0.15, name: 'halat' };
      });
      // sepetin içi; tavan brülörün altında
      return [{ k: 'inCyl', r: 2.45, y0: 0, y1: 4.85, pad: 0.2, name: 'sepet' }, ...ropes];
    }
    case 'bus':
      return [
        { k: 'inBox', min: [-5.5, 0, -2.3], max: [5.5, 2.75, 2.3], pad: 0.22, name: 'otobüs' },
        box('ön koltuklar', [-5.5, 0, -2.3], [-2.6, 1.3, 2.3], 0.1),
        box('arka koltuklar', [2.6, 0, -2.3], [5.5, 1.3, 2.3], 0.1),
        // tavana yakın tutunma boruları ve sarkan kulplar
        box('tutunma', [-5.5, 2.1, 1.8], [5.5, 2.75, 2.3], 0.1),
        box('tutunma', [-5.5, 2.1, -2.3], [5.5, 2.75, -1.8], 0.1),
      ];
    case 'boat':
      return [
        { k: 'inPoly', pts: boatOutline(), y0: 0, y1: 12, pad: 0.22, name: 'güverte' },
        { k: 'seg', a: [1.15, 0, -3.7], b: [1.15, 6.8, -3.7], r: 0.08, pad: 0.15, name: 'direk' },
        // üçgen yelken ve bumba: kutuyla (daha geniş) sarılır
        box('yelken', [1.1, 1.62, -3.75], [1.24, 6.9, -1.85]),
        cyl('varil', -0.9, -3.5, 0.35, 0, 0.85),
        box('sandıklar', [0.2, 0, 3.4], [1.75, 0.85, 4.3]),
        cyl('fener', 2.0, 4.1, 0.2, 0, 0.7),
        cyl('fener', -2.0, 4.1, 0.2, 0, 0.7),
      ];
    default:
      // tanınmayan atmosfer: genel kapalı oda (yörüngeleri değiştirmez)
      return room();
  }
}

/** oturan oyuncu + sandalye: koltuk r 1.2–2.0 arasında, baş ~1.45 m'ye kadar */
function seatShapes(seats: number, skipOwn: boolean): Shape[] {
  if (seats <= 0) return [];
  return seatAngles(seats)
    .map((a, i) => (skipOwn && i === 0 ? null : cyl(i === 0 ? 'kendi koltuğun' : 'koltuk', Math.sin(a) * (SEAT_R + 0.08), Math.cos(a) * (SEAT_R + 0.08), 0.4, 0, 1.5, 0.1)))
    .filter((s): s is Shape => s !== null);
}

const cache = new Map<string, CamBounds>();

/**
 * Atmosfer (tema props değeri) ve oturan oyuncu sayısına göre kamera engelleri.
 * skipOwn: kendi koltuğun sayılmaz (koltuk bakışında kamera zaten senin başında).
 */
export function cameraBounds(scene: string, seats: number, skipOwn = false): CamBounds {
  const key = `${scene}|${seats}|${skipOwn ? 1 : 0}`;
  let b = cache.get(key);
  if (!b) {
    b = { shapes: [...sceneShapes(scene), ...seatShapes(seats, skipOwn)], profiles: new Map() };
    cache.set(key, b);
  }
  return b;
}
