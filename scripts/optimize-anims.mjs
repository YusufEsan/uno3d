// Animasyon kliplerini küçültür: görünür fark yaratmayan ara kareleri atar (doğrusal / küresel ara değerle
// zaten elde edilebilenler), sayıları yuvarlar. Kullanım: node scripts/optimize-anims.mjs [klasör]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'apps/web/src/assets/animations';
/** dönüşlerde en fazla ~0.25° sapma */
const QUAT_TOL = 0.0044;
/** kalça konumunda en fazla 2 mm (birim: cm) */
const POS_TOL = 0.2;
/** uzun klipler (44 sn'lik konuşmalar) bu süreye kısaltılır; döngü oyunda dikişsiz yapılır */
const MAX_DUR = 20;

function quatErr(v, a, b, c, u) {
  // a ile c arasında u oranında normalize lerp (kısa yol), b ile açı farkı
  let dot = 0;
  for (let k = 0; k < 4; k++) dot += v[a + k] * v[c + k];
  const s = dot < 0 ? -1 : 1;
  const q = [0, 0, 0, 0];
  let len = 0;
  for (let k = 0; k < 4; k++) {
    q[k] = v[a + k] * (1 - u) + s * v[c + k] * u;
    len += q[k] * q[k];
  }
  len = Math.sqrt(len) || 1;
  let d = 0;
  for (let k = 0; k < 4; k++) d += (q[k] / len) * v[b + k];
  return 2 * Math.acos(Math.min(1, Math.abs(d)));
}

function vecErr(v, a, b, c, u, n) {
  let e = 0;
  for (let k = 0; k < n; k++) e = Math.max(e, Math.abs(v[a + k] * (1 - u) + v[c + k] * u - v[b + k]));
  return e;
}

function reduce(track) {
  const { times, values } = track;
  const n = times.length;
  const size = values.length / n;
  const isQuat = track.type === 'quaternion';
  const tol = isQuat ? QUAT_TOL : POS_TOL;
  if (n <= 2) return track;
  const keep = [0];
  let start = 0;
  for (let end = 2; end < n; end++) {
    // start ile end arasındaki tüm kareler ara değerle karşılanıyor mu?
    let ok = true;
    for (let i = start + 1; i < end && ok; i++) {
      const u = (times[i] - times[start]) / (times[end] - times[start]);
      const err = isQuat ? quatErr(values, start * 4, i * 4, end * 4, u) : vecErr(values, start * size, i * size, end * size, u, size);
      if (err > tol) ok = false;
    }
    if (!ok) {
      keep.push(end - 1);
      start = end - 1;
    }
  }
  keep.push(n - 1);
  const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    ...track,
    times: keep.map(i => r(times[i], 3)),
    values: keep.flatMap(i => values.slice(i * size, i * size + size).map(x => r(x, isQuat ? 4 : 2))),
  };
}

let before = 0;
let after = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const p = join(dir, f);
  const raw = readFileSync(p, 'utf8');
  const clip = JSON.parse(raw);
  if (clip.duration > MAX_DUR) {
    clip.duration = MAX_DUR;
    for (const t of clip.tracks) {
      const size = t.values.length / t.times.length;
      const n = t.times.filter(x => x <= MAX_DUR).length;
      t.times = t.times.slice(0, n);
      t.values = t.values.slice(0, n * size);
    }
  }
  clip.tracks = clip.tracks.map(reduce);
  const out = JSON.stringify(clip);
  before += raw.length;
  after += out.length;
  writeFileSync(p, out);
  console.log(`${f.padEnd(18)} ${(raw.length / 1e3).toFixed(0).padStart(6)} KB -> ${(out.length / 1e3).toFixed(0).padStart(5)} KB`);
}
console.log(`toplam ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
