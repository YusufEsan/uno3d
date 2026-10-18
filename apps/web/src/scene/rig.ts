import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Bir karakter modelinden çıkarılan, canlandırma için gereken her şey */
export interface Rig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  idle: THREE.AnimationAction | null;
  idleVariants: THREE.AnimationAction[];
  talk: THREE.AnimationAction | null;
  /** Konuşma klipleri; her konuşmada rastgele biri ve rastgele bir yerinden başlar */
  talks: THREE.AnimationAction[];
  bones: Partial<Record<BoneKey, THREE.Bone>>;
  /** Parmak kemikleri: el → parmak → [1., 2., 3. eklem] */
  fingers: Record<'L' | 'R', Partial<Record<Finger, THREE.Bone[]>>>;
  bindPose: Map<THREE.Bone, THREE.Quaternion>;
  morphs: Partial<Record<MorphKey, { mesh: THREE.Mesh; index: number }[]>>;
  height: number;
  /** gövde, baş ve uyluklar için çarpışma şekilleri (modelin kendi ölçüsünden) */
  proxies: BodyProxy[];
  /** bilekten orta parmak köküne uzaklık (dünya ölçüsünde): el çarpışma yarıçapları buna göre */
  handSize: number;
}

/**
 * Bir kemiğe bağlı, kesiti elips olan kapsül. Uçlar ve eksenler kemiğin yerel uzayında tutulur,
 * kemik dönünce şekil de döner. Yarıçaplar: yana (rx), öne (rf) ve arkaya (rb); göbek öne taşar.
 */
export interface BodyProxy {
  bone: THREE.Bone;
  a: THREE.Vector3;
  b: THREE.Vector3;
  ax: THREE.Vector3;
  az: THREE.Vector3;
  /** yarıçaplar şeklin alt (a) ve üst (b) yarısında ayrı: gövde boyna doğru incelir, göbek altta taşar */
  rx: [number, number];
  rf: [number, number];
  rb: [number, number];
}

type BoneKey =
  | 'hips' | 'head' | 'neck' | 'spine' | 'eyeL' | 'eyeR' | 'jaw' | 'handL' | 'handR' | 'armL' | 'foreL' | 'armR' | 'foreR'
  | 'thighL' | 'shinL' | 'footL' | 'toeL' | 'thighR' | 'shinR' | 'footR' | 'toeR';
export type Finger = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
const FINGERS: Finger[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

export type MorphKey = 'blink' | 'mouth' | 'happy' | 'angry' | 'sad' | 'surprised';

const BONE_PATTERNS: Record<BoneKey, RegExp[]> = {
  hips: [/hips$/i],
  head: [/(^|[^a-z]|mixamorig)head$/i],
  neck: [/neck$/i],
  spine: [/spine2$/i, /spine1$/i, /spine$/i, /torso(_\d)?$/i, /abdomen$/i],
  eyeL: [/lefteye$/i, /eye_?l$/i],
  eyeR: [/righteye$/i, /eye_?r$/i],
  jaw: [/jaw$/i],
  handL: [/lefthand$/i, /hand_?l$/i],
  handR: [/righthand$/i, /hand_?r$/i],
  // üst kol / ön kol (Mixamo: LeftArm, LeftForeArm)
  armL: [/leftarm$/i, /upperarm_?l$/i],
  foreL: [/leftforearm$/i, /lowerarm_?l$/i, /forearm_?l$/i],
  armR: [/rightarm$/i, /upperarm_?r$/i],
  foreR: [/rightforearm$/i, /lowerarm_?r$/i, /forearm_?r$/i],
  // bacaklar (Mixamo: LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase): ayaklar zemine gömülmesin diye
  thighL: [/leftupleg$/i, /thigh_?l$/i],
  shinL: [/leftleg$/i, /calf_?l$/i, /shin_?l$/i],
  footL: [/leftfoot$/i, /foot_?l$/i],
  toeL: [/lefttoebase$/i, /toe_?l$/i],
  thighR: [/rightupleg$/i, /thigh_?r$/i],
  shinR: [/rightleg$/i, /calf_?r$/i, /shin_?r$/i],
  footR: [/rightfoot$/i, /foot_?r$/i],
  toeR: [/righttoebase$/i, /toe_?r$/i],
};

const MORPH_PATTERNS: Record<MorphKey, RegExp> = {
  blink: /blink|eyesclosed|eye_?closed?/i,
  mouth: /jawopen|mouthopen|mouth_?open|viseme_?aa|^aa$/i,
  happy: /smile|happy|joy/i,
  angry: /angry|browdown|mad/i,
  sad: /sad|frown/i,
  surprised: /surpris|browinnerup/i,
};

/** Mixamo klip izlerini hedef iskeletin kemik adlarına çevirir (mixamorig / mixamorig1 / mixamorig9 farkları) */
function retarget(clip: THREE.AnimationClip, prefix: string, name: string) {
  const tracks = clip.tracks.map(t => {
    const dot = t.name.indexOf('.');
    const node = t.name.slice(0, dot).replace(/^mixamorig\d*:?/i, '');
    // clone() gibi, ama anahtar kare dizileri kopyalanmaz: klipler salt okunur, karakterler aynı diziyi paylaşır
    const Track = t.constructor as new (n: string, times: ArrayLike<number>, values: ArrayLike<number>) => THREE.KeyframeTrack;
    const out = new Track(`${prefix}${node}${t.name.slice(dot)}`, t.times, t.values);
    // özel ara değerleme (ör. kuaterniyon) korunur, clone() da aynısını yapar
    (out as unknown as { createInterpolant: unknown }).createInterpolant = (t as unknown as { createInterpolant: unknown }).createInterpolant;
    return out;
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

const isIdentity = (o: THREE.Object3D) =>
  o.position.x === 0 && o.position.y === 0 && o.position.z === 0 &&
  o.quaternion.x === 0 && o.quaternion.y === 0 && o.quaternion.z === 0 && o.quaternion.w === 1 &&
  o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1;

/** "Spine_3" gibi kopya kemik: ebeveyniyle aynı adlı (sonek hariç), yerel dönüşümü birim, animasyon almaz */
const isBoneCopy = (b: THREE.Object3D) =>
  (b as THREE.Bone).isBone && !!b.parent && (b.parent as THREE.Bone).isBone && /_\d+$/.test(b.name) &&
  b.name.replace(/_\d+$/, '') === b.parent.name.replace(/_\d+$/, '') && isIdentity(b);

/**
 * Bazı modellerde (FBX'ten çevrilen) her deri parçası iskeletin iç içe bir kopyasına bağlı: boss'ta 11 × 68 kemik.
 * Kopyaların dünya matrisi ebeveyniyle birebir aynı olduğundan deriler en dıştaki kemiğe bağlanır, kopyalar
 * ağaçtan çıkarılır. Görüntü bit bit aynı kalır; her karedeki matris güncellemesi ~10 kat azalır.
 */
function collapseBoneCopies(root: THREE.Object3D) {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton) meshes.push(o as THREE.SkinnedMesh);
  });
  let any = false;
  for (const m of meshes) {
    const bones = m.skeleton.bones;
    for (let i = 0; i < bones.length; i++) {
      let b: THREE.Object3D = bones[i];
      while (isBoneCopy(b)) b = b.parent!;
      if (b !== bones[i]) {
        bones[i] = b as THREE.Bone;
        any = true;
      }
    }
  }
  if (!any) return;
  // yalnız tamamı kopyalardan oluşan alt ağaçlar çıkarılır (altında başka bir düğüm varsa dokunulmaz)
  const onlyCopies = (o: THREE.Object3D): boolean => isBoneCopy(o) && o.children.every(onlyCopies);
  const drop: THREE.Object3D[] = [];
  root.traverse(o => {
    if (isBoneCopy(o) && !isBoneCopy(o.parent!) && onlyCopies(o)) drop.push(o);
  });
  for (const o of drop) o.parent!.remove(o);
}

export function buildRig(
  source: THREE.Object3D,
  clips: { name: string; clip: THREE.AnimationClip }[],
  /** neckHeight verilirse ölçek boyun yüksekliğinden hesaplanır (şapka/saç gibi aksesuarlar boyu şişirmez) */
  opts: { kind: 'mixamo' | 'robot'; targetHeight: number; neckHeight?: number; tint?: string },
): Rig {
  const root = cloneSkinned(source) as THREE.Object3D;
  collapseBoneCopies(root);
  const bones: Rig['bones'] = {};
  const allBones: THREE.Bone[] = [];
  const morphs: Rig['morphs'] = {};
  // aynı kaynak malzemeyi kullanan parçalar tek bir kopyayı paylaşır (boss: 11 parça, 1 malzeme)
  const matCopies = new Map<THREE.Material, THREE.Material>();

  root.traverse(o => {
    if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // iskelet animasyonunda sınır kutusu yanıltabilir
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => {
      const done = matCopies.get(mat);
      if (done) return done;
      const c = (mat as THREE.MeshStandardMaterial).clone();
      matCopies.set(mat, c);
      if (opts.tint && /main/i.test(c.name)) c.color.set(opts.tint);
      // Mixamo FBX malzemeleri genelde Phong ve çok parlak gelir: biraz matlaştır
      if ((c as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial) (c as unknown as THREE.MeshPhongMaterial).shininess = 8;
      // GLB'ye çevrilen modellerde Standard malzeme: deri ve kumaş metal gibi parlamasın
      const std = c as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial && !std.metalnessMap) {
        std.metalness = Math.min(std.metalness, 0.05);
        if (!std.roughnessMap) std.roughness = Math.max(std.roughness, 0.65);
      }
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
    if (m.morphTargetDictionary) {
      for (const [name, index] of Object.entries(m.morphTargetDictionary)) {
        for (const key of Object.keys(MORPH_PATTERNS) as MorphKey[]) {
          if (MORPH_PATTERNS[key].test(name)) (morphs[key] ??= []).push({ mesh: m, index });
        }
      }
    }
  });

  for (const key of Object.keys(BONE_PATTERNS) as BoneKey[]) {
    for (const re of BONE_PATTERNS[key]) {
      const b = allBones.find(x => re.test(x.name));
      if (b) {
        bones[key] = b;
        break;
      }
    }
  }

  // bağlama pozunda gerçek boyu ölç, hedef boya ölçekle, ayakları zemine oturt
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  let s = opts.targetHeight / Math.max(0.001, size.y);
  if (opts.neckHeight && bones.neck) {
    const neckY = bones.neck.getWorldPosition(new THREE.Vector3()).y - box.min.y;
    if (neckY > 0) s = opts.neckHeight / neckY;
  }
  root.scale.multiplyScalar(s);
  root.position.y = -box.min.y * s;

  // parmaklar (Mixamo: LeftHandIndex1..3); iç içe kopyalarda en dıştaki ilk bulunandır
  const fingers: Rig['fingers'] = { L: {}, R: {} };
  for (const side of ['L', 'R'] as const) {
    const sideName = side === 'L' ? 'left' : 'right';
    for (const f of FINGERS) {
      const joints = [1, 2, 3]
        .map(n => new RegExp(`${sideName}hand${f}${n}$`, 'i'))
        .map(re => allBones.find(b => re.test(b.name)))
        .filter((b): b is THREE.Bone => !!b);
      if (joints.length) fingers[side][f] = joints;
    }
  }

  const bindPose = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of Object.values(bones)) if (b) bindPose.set(b, b.quaternion.clone());
  for (const side of ['L', 'R'] as const)
    for (const joints of Object.values(fingers[side])) for (const b of joints ?? []) bindPose.set(b, b.quaternion.clone());

  const mixer = new THREE.AnimationMixer(root);
  const hips = allBones.find(b => /hips$/i.test(b.name));
  const prefix = hips ? hips.name.slice(0, -4) : '';
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const { name, clip } of clips) {
    const c = opts.kind === 'mixamo' ? retarget(clip, prefix, name) : clip;
    actions[name] = mixer.clipAction(c);
  }

  const pick = (...names: string[]) => names.map(n => actions[n]).find(Boolean) ?? null;
  const idle = pick('idle', 'sitting idle', 'Sitting', 'Idle');
  const idleVariants = Object.entries(actions)
    .filter(([n]) => /^idle/i.test(n) && opts.kind === 'mixamo')
    .map(([, a]) => a);
  const talks = Object.entries(actions)
    .filter(([n]) => /^talk(ing)?\d*$/i.test(n))
    .map(([, a]) => a);
  const talk = talks[0] ?? null;

  const proxies = opts.kind === 'mixamo' ? buildBodyProxies(root, allBones) : [];
  const middle = fingers.R.Middle?.[0];
  const handSize = bones.handR && middle ? bones.handR.getWorldPosition(new THREE.Vector3()).distanceTo(middle.getWorldPosition(new THREE.Vector3())) : 0.12;

  return { root, mixer, actions, idle, idleVariants, talk, talks, bones, fingers, bindPose, morphs, height: opts.targetHeight, proxies, handSize };
}

/** çarpışma şekli çıkarılan kemikler ve şeklin uzandığı alt kemik */
const PROXY_BONES: [RegExp, RegExp][] = [
  [/hips$/i, /spine$/i],
  [/spine$/i, /spine1$/i],
  [/spine1$/i, /spine2$/i],
  [/spine2$/i, /neck$/i],
  [/neck$/i, /head$/i],
  [/(^|[^a-z]|mixamorig)head$/i, /headtop_end$/i],
  [/leftupleg$/i, /leftleg$/i],
  [/rightupleg$/i, /rightleg$/i],
];

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/**
 * Bağlama pozundaki deri noktalarından her gövde kemiği için bir kapsül çıkarır: noktalar en çok
 * etkilendikleri kemiğe atanır, kemikten alt kemiğe uzanan eksene göre yana/öne/arkaya uzaklıkları ölçülür.
 * Göbekli, iri kafalı ya da ince karakterlerin hepsi kendi şeklini alır.
 */
function buildBodyProxies(root: THREE.Object3D, allBones: THREE.Bone[]): BodyProxy[] {
  root.updateMatrixWorld(true);
  const defs = PROXY_BONES.map(([re, childRe]) => {
    const bone = allBones.find(b => re.test(b.name));
    if (!bone) return null;
    const child = bone.children.find(c => (c as THREE.Bone).isBone && childRe.test(c.name)) as THREE.Bone | undefined;
    const A = bone.getWorldPosition(new THREE.Vector3());
    const B = child ? child.getWorldPosition(new THREE.Vector3()) : A.clone().add(new THREE.Vector3(0, 0.15, 0));
    const half = () => ({ xs: [] as number[], fs: [] as number[], bs: [] as number[] });
    return { bone, A, B, h: [half(), half()], ds: [] as number[], round: /upleg$/i.test(bone.name) };
  });
  const byBone = new Map<THREE.Bone, NonNullable<(typeof defs)[number]>>();
  for (const d of defs) if (d) byBone.set(d.bone, d);

  // bazı modellerde deri ek kemiklere bağlı (göbek, göğüs, yaka ya da kopya "_1" kemikleri): bunlar
  // yukarı doğru en yakın gövde kemiğine sayılır; kol, bacak, el gibi uzuvlarda durulur
  const cache = new Map<THREE.Object3D, (typeof defs)[number] | undefined>();
  const owner = (bone: THREE.Object3D | undefined) => {
    if (!bone) return undefined;
    if (cache.has(bone)) return cache.get(bone);
    let found: (typeof defs)[number] | undefined;
    for (let b: THREE.Object3D | null = bone; b && (b as THREE.Bone).isBone; b = b.parent) {
      const d = byBone.get(b as THREE.Bone);
      if (d) {
        found = d;
        break;
      }
      // kopya kemik ("Spine_1") her zaman ebeveynine aittir
      if (!/_\d+$/.test(b.name) && /(shoulder|arm|hand|leg|foot|toe|eye)$/i.test(b.name)) break;
    }
    cache.set(bone, found);
    return found;
  };
  const v = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const o = new THREE.Vector3();
  root.traverse(obj => {
    const m = obj as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      let best = 0;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > best) {
          best = w;
          bi = si.getComponent(i, k);
        }
      }
      if (best < 0.5) continue;
      const d = owner(m.skeleton.bones[bi]);
      if (!d) continue;
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      ab.subVectors(d.B, d.A);
      const t = THREE.MathUtils.clamp(o.subVectors(v, d.A).dot(ab) / Math.max(1e-8, ab.lengthSq()), 0, 1);
      o.subVectors(v, d.A).addScaledVector(ab, -t);
      d.ds.push(o.length());
      const h = d.h[t < 0.5 ? 0 : 1];
      h.xs.push(Math.abs(o.x));
      if (o.z > 0) h.fs.push(o.z);
      else h.bs.push(-o.z);
    }
  });

  const out: BodyProxy[] = [];
  const inv = new THREE.Quaternion();
  // yaka, pelerin gibi dışa açılan giysiler şekli şişirmesin: uç noktalar sayılmaz
  const Q = 0.65;
  for (const d of defs) {
    if (!d || d.h[0].xs.length + d.h[1].xs.length < 12) continue;
    d.bone.getWorldQuaternion(inv).invert();
    // yarının biri boşsa diğerinin ölçüsü kullanılır
    const halves = d.h;
    const r = (pick: (h: (typeof halves)[0]) => number[], fallback?: [number, number]) =>
      halves.map((h, i) => {
        const xs = pick(h);
        if (xs.length > 6) return quantile(xs, Q);
        const other = pick(halves[1 - i]);
        return other.length > 6 ? quantile(other, Q) : (fallback?.[i] ?? 0.05);
      }) as [number, number];
    // uyluk: kesiti yuvarlak; etek, ceket ya da göbek sarkması uyluğu şişirmesin diye ortanca uzaklık
    const round = quantile(d.ds, 0.5);
    const rx = d.round ? ([round, round] as [number, number]) : r(h => h.xs);
    out.push({
      bone: d.bone,
      a: d.bone.worldToLocal(d.A.clone()),
      b: d.bone.worldToLocal(d.B.clone()),
      ax: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
      az: new THREE.Vector3(0, 0, 1).applyQuaternion(inv),
      rx,
      rf: d.round ? rx : r(h => h.fs, rx),
      rb: d.round ? rx : r(h => h.bs, rx),
    });
  }
  return out;
}

/**
 * getWorldPosition/localToWorld her çağrıda kökten kemiğe kadar tüm zinciri yeniden hesaplar. Bir çağrı içinde
 * (dönüşümler değişmezken) zincir bir kez güncellenir: `fresh` o çağrıda güncellenen düğümleri tutar,
 * sonuç bit bit aynıdır. Çağrının başında `fresh.clear()` yapılır.
 */
const fresh = new Set<THREE.Object3D>();
const chain: THREE.Object3D[] = [];
function refreshWorld(obj: THREE.Object3D) {
  chain.length = 0;
  for (let o: THREE.Object3D | null = obj; o && !fresh.has(o); o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateWorldMatrix(false, false);
    fresh.add(chain[i]);
  }
  return obj.matrixWorld;
}
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
/** getWorldPosition / getWorldQuaternion karşılıkları (zincir çağrı başına bir kez güncellenir) */
const wpos = (o: THREE.Object3D, target: THREE.Vector3) => target.setFromMatrixPosition(refreshWorld(o));
const wquat = (o: THREE.Object3D, target: THREE.Quaternion) => {
  refreshWorld(o).decompose(_p, target, _s);
  return target;
};

const pv = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  ab: new THREE.Vector3(),
  o: new THREE.Vector3(),
  x: new THREE.Vector3(),
  z: new THREE.Vector3(),
  q: new THREE.Quaternion(),
};

/**
 * `p` noktasındaki `r` yarıçaplı küre gövdeye ne kadar giriyor: `out`'a küreyi dışarı çıkaracak yer
 * değiştirmeyi yazar ve uzunluğunu döndürür (giriş yoksa 0). Birden çok şekle giriyorsa itmeler derinliğe
 * göre ağırlıklı karıştırılır: el bir şekilden ötekine geçerken itme yönü bir anda dönmez.
 */
export function bodyPenetration(rig: Rig, p: THREE.Vector3, r: number, out: THREE.Vector3): number {
  out.set(0, 0, 0);
  let wsum = 0;
  fresh.clear();
  for (const px of rig.proxies) {
    const mw = refreshWorld(px.bone);
    const A = pv.a.copy(px.a).applyMatrix4(mw);
    const B = pv.b.copy(px.b).applyMatrix4(mw);
    pv.ab.subVectors(B, A);
    const t = THREE.MathUtils.clamp(pv.o.subVectors(p, A).dot(pv.ab) / Math.max(1e-8, pv.ab.lengthSq()), 0, 1);
    pv.o.subVectors(p, A).addScaledVector(pv.ab, -t);
    const dist = pv.o.length();
    // en büyük yarıçaptan da uzaksa giriş olamaz (yuvarlama payı bırakılır): dönüş hesabı atlanır
    const maxR = Math.max(px.rx[0], px.rx[1], px.rf[0], px.rf[1], px.rb[0], px.rb[1]);
    if (dist > (maxR + r) * (1 + 1e-6) + 1e-9) continue;
    mw.decompose(_p, pv.q, _s);
    const ox = pv.o.dot(pv.x.copy(px.ax).applyQuaternion(pv.q));
    const oz = pv.o.dot(pv.z.copy(px.az).applyQuaternion(pv.q));
    const perp = Math.hypot(ox, oz);
    // yarıçaplar iki yarının ortasında ölçüldü: arası doğrusal
    const u = THREE.MathUtils.clamp((t - 0.25) * 2, 0, 1);
    const rx = px.rx[0] + (px.rx[1] - px.rx[0]) * u;
    const rz = oz > 0 ? px.rf[0] + (px.rf[1] - px.rf[0]) * u : px.rb[0] + (px.rb[1] - px.rb[0]) * u;
    // elips kesitin noktanın yönündeki yarıçapı
    const R = perp < 1e-5 ? Math.min(rx, rz) : 1 / Math.hypot(ox / perp / rx, oz / perp / rz);
    const pen = R + r - dist;
    if (pen <= 0) continue;
    const w = pen ** 4;
    if (dist < 1e-5) out.addScaledVector(pv.z, pen * w);
    else out.addScaledVector(pv.o, (pen / dist) * w);
    wsum += w;
  }
  if (wsum <= 0) return 0;
  out.divideScalar(wsum);
  return out.length();
}

const tq1 = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tq3 = new THREE.Quaternion();
const te = new THREE.Euler();

/**
 * Kemiği, karakterin kendi ekseninde (Y yukarı, Z ileri) verilen açılarla döndürür.
 * Kemiklerin yerel eksenleri modele göre değiştiği için dönüş ebeveyn uzayına taşınır.
 */
export function rotateBoneInBodySpace(rig: Rig, bone: THREE.Bone | undefined, pitch: number, yaw: number, roll = 0) {
  if (!bone?.parent || (pitch === 0 && yaw === 0 && roll === 0)) return;
  const offset = tq1.setFromEuler(te.set(pitch, yaw, roll, 'YXZ'));
  // kök ve ebeveyn zinciri bir kez güncellenir (getWorldQuaternion ile aynı sonuç)
  fresh.clear();
  refreshWorld(rig.root).decompose(_p, tq3, _s);
  tq2.copy(tq3).invert();
  refreshWorld(bone.parent).decompose(_p, tq3, _s);
  const parentInBody = tq2.multiply(tq3);
  const toParent = tq3.copy(parentInBody).invert().multiply(offset).multiply(parentInBody);
  bone.quaternion.premultiply(toParent);
}

const iv = {
  s: new THREE.Vector3(),
  e: new THREE.Vector3(),
  w: new THREE.Vector3(),
  t: new THREE.Vector3(),
  n: new THREE.Vector3(),
  p: new THREE.Vector3(),
  d1: new THREE.Vector3(),
  d2: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  pq: new THREE.Quaternion(),
  orig: new THREE.Quaternion(),
  cur: new THREE.Quaternion(),
};

/** Kemiği, dünya uzayında `from` yönünü `to` yönüne çevirecek kadar döndürür (ağırlıklı) */
function aimBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  iv.orig.copy(bone.quaternion);
  const delta = iv.q.setFromUnitVectors(from.normalize(), to.normalize());
  // yerel = ebeveyn⁻¹ · delta · ebeveyn · yerel
  wquat(bone.parent, iv.pq);
  bone.quaternion.premultiply(iv.pq).premultiply(delta).premultiply(iv.pq.invert());
  if (weight < 1) bone.quaternion.slerpQuaternions(iv.orig, iv.cur.copy(bone.quaternion), weight);
  bone.updateMatrixWorld(true);
}

/**
 * İki kemikli kol IK'sı: eli `target` noktasına götürür, dirseği `pole` yönüne büker.
 * Kemik eksenlerine bağlı değildir (dünya uzayındaki konumlarla çalışır), her modelde kullanılabilir.
 */
export function solveArmIK(
  upper: THREE.Bone | undefined,
  lower: THREE.Bone | undefined,
  hand: THREE.Bone | undefined,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight: number,
) {
  if (!upper || !lower || !hand || weight <= 0.001) return;
  fresh.clear();
  wpos(upper, iv.s);
  wpos(lower, iv.e);
  wpos(hand, iv.w);
  const a = iv.s.distanceTo(iv.e);
  const b = iv.e.distanceTo(iv.w);
  iv.t.copy(target);
  const d = Math.min(iv.s.distanceTo(iv.t), (a + b) * 0.999);
  iv.n.subVectors(iv.t, iv.s).normalize();
  iv.t.copy(iv.s).addScaledVector(iv.n, d);
  // dirseğin olması gereken yer: S→T ekseninden pole yönüne doğru kosinüs teoremiyle
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  iv.p.subVectors(pole, iv.s);
  iv.p.addScaledVector(iv.n, -iv.p.dot(iv.n)).normalize();
  const elbow = iv.d2.copy(iv.s).addScaledVector(iv.n, a * cosA).addScaledVector(iv.p, a * sinA);

  aimBone(upper, iv.d1.subVectors(iv.e, iv.s), elbow.sub(iv.s), weight);
  // aimBone alt ağacı güncelledi: zincir yeniden hesaplanmaz
  wpos(lower, iv.e);
  wpos(hand, iv.w);
  aimBone(lower, iv.d1.subVectors(iv.w, iv.e), iv.d2.subVectors(iv.t, iv.e), weight);
}

const gv = {
  h: new THREE.Vector3(),
  m: new THREE.Vector3(),
  i: new THREE.Vector3(),
  p: new THREE.Vector3(),
  f: new THREE.Vector3(),
  s: new THREE.Vector3(),
  n: new THREE.Vector3(),
  x: new THREE.Vector3(),
  a: new THREE.Vector3(),
  j: new THREE.Vector3(),
  c: new THREE.Vector3(),
  m1: new THREE.Matrix4(),
  m2: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  orig: new THREE.Quaternion(),
  cur: new THREE.Quaternion(),
};

/** Kemiğe dünya uzayında bir dönüş uygular (ağırlıklı) ve alt kemikleri günceller */
function rotateBoneWorld(bone: THREE.Bone, delta: THREE.Quaternion, weight: number) {
  if (!bone.parent) return;
  gv.orig.copy(bone.quaternion);
  wquat(bone.parent, gv.q2);
  bone.quaternion.premultiply(gv.q2).premultiply(delta).premultiply(gv.q2.invert());
  if (weight < 1) bone.quaternion.slerpQuaternions(gv.orig, gv.cur.copy(bone.quaternion), weight);
  bone.updateMatrixWorld(true);
}

/** Avuç yönü: parmak yönü (bilek→orta parmak) ve avuç normali (avucun baktığı yön) */
function palmBasis(rig: Rig, side: 'L' | 'R', hand: THREE.Bone) {
  const fs = rig.fingers[side];
  const middle = fs.Middle?.[0];
  const index = fs.Index?.[0];
  const pinky = fs.Pinky?.[0];
  if (!middle || !index || !pinky) return null;
  wpos(hand, gv.h);
  gv.f.subVectors(wpos(middle, gv.m), gv.h).normalize();
  gv.s.subVectors(wpos(index, gv.i), wpos(pinky, gv.p)).normalize();
  // avuç normali (avuç içinin baktığı yön): sol ve sağ elde ayna simetrik
  gv.n.crossVectors(side === 'L' ? gv.f : gv.s, side === 'L' ? gv.s : gv.f).normalize();
  return { f: gv.f, n: gv.n };
}

/**
 * Kart tutan el: bilek, parmaklar `fingerDir` yönünü, avuç `palmDir` yönünü gösterecek şekilde çevrilir;
 * parmaklar avuca doğru kıvrılıp kartları kavrar. Yönler dünya uzayındadır.
 */
export function poseGrip(
  rig: Rig,
  side: 'L' | 'R',
  hand: THREE.Bone | undefined,
  fingerDir: THREE.Vector3,
  palmDir: THREE.Vector3,
  curl: number,
  weight: number,
) {
  if (!hand || weight <= 0.001) return;
  fresh.clear();
  const basis = palmBasis(rig, side, hand);
  if (!basis) return;
  // mevcut ve hedef eksen takımlarından bilek dönüşü
  const f0 = basis.f.clone();
  const n0 = basis.n.clone();
  const f1 = fingerDir.clone().normalize();
  const n1 = palmDir.clone().addScaledVector(f1, -palmDir.dot(f1)).normalize();
  gv.m1.makeBasis(f0, n0, gv.x.crossVectors(f0, n0));
  gv.m2.makeBasis(f1, n1, gv.a.crossVectors(f1, n1));
  gv.q.setFromRotationMatrix(gv.m2.multiply(gv.m1.transpose()));
  rotateBoneWorld(hand, gv.q, weight);

  // parmakları avuç normali yönüne kıvır
  const palm = palmBasis(rig, side, hand);
  if (!palm) return;
  const pn = palm.n.clone();
  for (const f of FINGERS) {
    const joints = rig.fingers[side][f];
    if (!joints) continue;
    const amounts = f === 'Thumb' ? [0.25, 0.3, 0.3] : [0.45, 0.65, 0.45];
    joints.forEach((joint, k) => {
      // eklem yönü: bir sonraki ekleme doğru; son eklemde bir öncekinden gelen yön kullanılır
      const next = joints[k + 1];
      const prev = joints[k - 1];
      if (!next && !prev) return;
      if (next) {
        wpos(joint, gv.j);
        wpos(next, gv.c);
      } else {
        wpos(prev!, gv.j);
        wpos(joint, gv.c);
      }
      const dir = gv.c.sub(gv.j).normalize();
      const axis = gv.a.crossVectors(dir, pn);
      if (axis.lengthSq() < 1e-6) return;
      gv.q.setFromAxisAngle(axis.normalize(), amounts[k] * curl);
      rotateBoneWorld(joint, gv.q, weight);
    });
  }
}

const NO_MORPHS: { mesh: THREE.Mesh; index: number }[] = [];

export function setMorph(rig: Rig, key: MorphKey, weight: number) {
  for (const { mesh, index } of rig.morphs[key] ?? NO_MORPHS) {
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = weight;
  }
}
