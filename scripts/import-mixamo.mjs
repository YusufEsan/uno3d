/**
 * Mixamo'dan indirilen .fbx dosyalarını oyuna aktarır.
 *
 *   npm run import-mixamo -- "<klasör>"
 *
 * - Animasyonu olmayan (ya da çok kısa animasyonlu) dosya KARAKTER sayılır ve
 *   apps/web/src/assets/characters/ altına kopyalanır.
 * - Diğerleri ANİMASYON sayılır: sadece kemik hareketleri çıkarılıp küçük bir .json olarak
 *   apps/web/src/assets/animations/ altına yazılır ("With Skin" indirilmiş 7 MB'lık dosya ~100-500 KB olur).
 * - Mixamo adları oyunun beklediği adlara kendiliğinden çevrilir (ör. "Sitting Laughing" → laugh).
 *   Aynı türden birden fazla animasyon varsa laugh, laugh2, laugh3… diye kaydedilir; oyun aralarından rastgele seçer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// FBXLoader tarayıcı için yazılmış: Node'da gereken birkaç küresel nesneyi taklit et
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({ style: {}, getContext: () => null }),
};
const origWarn = console.warn;
console.warn = (...a) => (String(a[0]).startsWith('THREE.') ? undefined : origWarn(...a));

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outChars = path.join(root, 'apps/web/src/assets/characters');
const outAnims = path.join(root, 'apps/web/src/assets/animations');

/** Mixamo adı → oyundaki ad. İlk eşleşen kural kullanılır. */
const RULES = [
  [/talk/i, 'talk'],
  [/laugh/i, 'laugh'],
  [/cheer/i, 'cheer'],
  [/clap/i, 'clap'],
  [/thumb/i, 'thumbsup'],
  [/disapprov/i, 'disapproval'],
  [/disbelief|shock|surpris/i, 'disbelief'],
  [/angry|anger|mad|punch/i, 'angry'],
  [/sad|defeat|cry/i, 'sad'],
  [/victory|win|celebrat/i, 'victory'],
  [/yell|shout|scream/i, 'yell'],
  [/wav/i, 'wave'],
  [/point/i, 'point'],
  [/fist ?pump/i, 'fistpump'],
  [/idle|sitting|seated/i, 'idle'],
];

const slug = s =>
  s
    .toLowerCase()
    .replace(/\(\d+\)/g, '')
    .replace(/\bcharacter\b/g, '')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^the-/, '');

const round = (arr, digits) => {
  const k = 10 ** digits;
  return Array.from(arr, v => Math.round(v * k) / k);
};

function parseFbx(file) {
  const buf = fs.readFileSync(file);
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

/** Klipten sadece kemik dönüşlerini ve kalça konumunu tutar, sayıları yuvarlar */
function compactClip(clip, name) {
  // uzun kliplerde (konuşma gibi) her ikinci kareyi atla: göz fark etmez, boyut yarıya iner
  const stride = clip.duration > 10 ? 2 : 1;
  const thin = (arr, size) => {
    if (stride === 1) return arr;
    const out = [];
    const frames = arr.length / size;
    for (let f = 0; f < frames; f++) if (f % stride === 0 || f === frames - 1) for (let k = 0; k < size; k++) out.push(arr[f * size + k]);
    return out;
  };
  const tracks = clip.tracks
    .filter(t => t.name.endsWith('.quaternion') || /Hips\.position$/i.test(t.name))
    .map(t => {
      const q = t.name.endsWith('.quaternion');
      return {
        name: t.name,
        type: q ? 'quaternion' : 'vector',
        times: round(thin(t.times, 1), 3),
        values: round(thin(t.values, q ? 4 : 3), q ? 4 : 2),
      };
    });
  return { name, duration: +clip.duration.toFixed(3), tracks, uuid: THREE.MathUtils.generateUUID(), blendMode: 2500 };
}

function hipsHeight(clip) {
  const t = clip.tracks.find(x => /Hips\.position$/i.test(x.name));
  if (!t) return null;
  let sum = 0;
  for (let i = 1; i < t.values.length; i += 3) sum += t.values[i];
  return sum / (t.values.length / 3);
}

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Kullanım: npm run import-mixamo -- "<fbx dosyalarının olduğu klasör>"');
  process.exit(1);
}
fs.mkdirSync(outChars, { recursive: true });
fs.mkdirSync(outAnims, { recursive: true });

const files = fs.readdirSync(src).filter(f => f.toLowerCase().endsWith('.fbx')).sort();
const used = new Map();
let standHeight = null;

// önce karakterler: ayakta kalça yüksekliğini öğrenip oturmayan animasyonları uyarmak için
const parsed = files.map(f => {
  const obj = parseFbx(path.join(src, f));
  const clip = obj.animations[0];
  return { f, obj, clip, isCharacter: !clip || clip.duration < 0.1 };
});

for (const p of parsed.filter(x => x.isCharacter)) {
  const id = slug(path.basename(p.f, '.fbx')) || 'karakter';
  fs.copyFileSync(path.join(src, p.f), path.join(outChars, `${id}.fbx`));
  const hips = p.obj.getObjectByName('mixamorigHips');
  if (hips) standHeight = hips.position.y;
  console.log(`karakter   ${p.f}  →  characters/${id}.fbx`);
}

for (const p of parsed.filter(x => !x.isCharacter)) {
  const base = path.basename(p.f, '.fbx');
  const kind = RULES.find(([re]) => re.test(base))?.[1] ?? slug(base);
  const n = (used.get(kind) ?? 0) + 1;
  used.set(kind, n);
  const name = n === 1 ? kind : `${kind}${n}`;
  const json = compactClip(p.clip, name);
  const out = path.join(outAnims, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(json));
  const h = hipsHeight(p.clip);
  const standing = standHeight && h && h > standHeight * 0.8;
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`animasyon  ${p.f}  →  animations/${name}.json  (${p.clip.duration.toFixed(1)} sn, ${kb} KB)${standing ? '  ⚠ ayakta yapılıyor: karakter bu animasyonda ayağa kalkar' : ''}`);
}
console.log('\nTamam. Tarayıcıda sayfayı yenile.');
