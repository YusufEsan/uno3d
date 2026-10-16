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
}

type BoneKey = 'hips' | 'head' | 'neck' | 'spine' | 'eyeL' | 'eyeR' | 'jaw' | 'handL' | 'handR' | 'armL' | 'foreL' | 'armR' | 'foreR';
export type Finger = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
const FINGERS: Finger[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

export type MorphKey = 'blink' | 'mouth' | 'happy' | 'angry' | 'sad' | 'surprised';

const BONE_PATTERNS: Record<BoneKey, RegExp[]> = {
  hips: [/hips$/i],
  head: [/(^|[^a-z])head$/i],
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
    const out = t.clone();
    out.name = `${prefix}${node}${t.name.slice(dot)}`;
    return out;
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export function buildRig(
  source: THREE.Object3D,
  clips: { name: string; clip: THREE.AnimationClip }[],
  /** neckHeight verilirse ölçek boyun yüksekliğinden hesaplanır (şapka/saç gibi aksesuarlar boyu şişirmez) */
  opts: { kind: 'mixamo' | 'robot'; targetHeight: number; neckHeight?: number; tint?: string },
): Rig {
  const root = cloneSkinned(source) as THREE.Object3D;
  const bones: Rig['bones'] = {};
  const allBones: THREE.Bone[] = [];
  const morphs: Rig['morphs'] = {};

  root.traverse(o => {
    if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // iskelet animasyonunda sınır kutusu yanıltabilir
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => {
      const c = (mat as THREE.MeshStandardMaterial).clone();
      if (opts.tint && /main/i.test(c.name)) c.color.set(opts.tint);
      // Mixamo FBX malzemeleri genelde Phong ve çok parlak gelir: biraz matlaştır
      if ((c as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial) (c as unknown as THREE.MeshPhongMaterial).shininess = 8;
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
        .map(n => allBones.find(b => new RegExp(`${sideName}hand${f}${n}$`, 'i').test(b.name)))
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

  return { root, mixer, actions, idle, idleVariants, talk, talks, bones, fingers, bindPose, morphs, height: opts.targetHeight };
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
  const parentInBody = tq2.copy(rig.root.getWorldQuaternion(tq3)).invert().multiply(bone.parent.getWorldQuaternion(tq3));
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
};

/** Kemiği, dünya uzayında `from` yönünü `to` yönüne çevirecek kadar döndürür (ağırlıklı) */
function aimBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  iv.orig.copy(bone.quaternion);
  const delta = iv.q.setFromUnitVectors(from.normalize(), to.normalize());
  // yerel = ebeveyn⁻¹ · delta · ebeveyn · yerel
  bone.parent.getWorldQuaternion(iv.pq);
  bone.quaternion.premultiply(iv.pq).premultiply(delta).premultiply(iv.pq.invert());
  if (weight < 1) bone.quaternion.slerpQuaternions(iv.orig, bone.quaternion.clone(), weight);
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
  upper.getWorldPosition(iv.s);
  lower.getWorldPosition(iv.e);
  hand.getWorldPosition(iv.w);
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
  lower.getWorldPosition(iv.e);
  hand.getWorldPosition(iv.w);
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
};

/** Kemiğe dünya uzayında bir dönüş uygular (ağırlıklı) ve alt kemikleri günceller */
function rotateBoneWorld(bone: THREE.Bone, delta: THREE.Quaternion, weight: number) {
  if (!bone.parent) return;
  gv.orig.copy(bone.quaternion);
  bone.parent.getWorldQuaternion(gv.q2);
  bone.quaternion.premultiply(gv.q2).premultiply(delta).premultiply(gv.q2.invert());
  if (weight < 1) bone.quaternion.slerpQuaternions(gv.orig, bone.quaternion.clone(), weight);
  bone.updateMatrixWorld(true);
}

/** Avuç yönü: parmak yönü (bilek→orta parmak) ve avuç normali (avucun baktığı yön) */
function palmBasis(rig: Rig, side: 'L' | 'R', hand: THREE.Bone) {
  const fs = rig.fingers[side];
  const middle = fs.Middle?.[0];
  const index = fs.Index?.[0];
  const pinky = fs.Pinky?.[0];
  if (!middle || !index || !pinky) return null;
  hand.getWorldPosition(gv.h);
  gv.f.subVectors(middle.getWorldPosition(gv.m), gv.h).normalize();
  gv.s.subVectors(index.getWorldPosition(gv.i), pinky.getWorldPosition(gv.p)).normalize();
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
        joint.getWorldPosition(gv.j);
        next.getWorldPosition(gv.c);
      } else {
        prev!.getWorldPosition(gv.j);
        joint.getWorldPosition(gv.c);
      }
      const dir = gv.c.sub(gv.j).normalize();
      const axis = gv.a.crossVectors(dir, pn);
      if (axis.lengthSq() < 1e-6) return;
      gv.q.setFromAxisAngle(axis.normalize(), amounts[k] * curl);
      rotateBoneWorld(joint, gv.q, weight);
    });
  }
}

export function setMorph(rig: Rig, key: MorphKey, weight: number) {
  for (const { mesh, index } of rig.morphs[key] ?? []) {
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = weight;
  }
}
