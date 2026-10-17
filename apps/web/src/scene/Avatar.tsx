import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import gsap from 'gsap';
import type { SeatInfo } from '@uno/protocol';
import { director } from '../game/director';
import { TABLE_R, TABLE_Y } from '../game/layout';
import { useApp, useQuality } from '../store/useApp';
import { NameTag } from '../ui/NameTag';
import { ANIMATIONS, REACTION_CLIPS, REACTION_FACE, ROBOT_URL, type CharacterDef } from './characters';
import { useCharacterScene } from './characterModel';
import { SafeBoundary } from './SafeBoundary';
import { bodyPenetration, buildRig, poseGrip, rotateBoneInBodySpace, setMorph, solveArmIK, type MorphKey, type Rig } from './rig';
import type { Thrower } from '../game/director';

/** Oturan karakterin kalçasının hedefi (koltuk çerçevesinde): sandalye oturağının ortası */
const SEAT_HIPS = { y: 0.56, z: -0.11 };
/** Tepki sırasında kartların bırakıldığı nokta (koltuk çerçevesinde): masanın kenarının biraz içi */

/**
 * Başın koltuk çerçevesinde (+z masaya doğru) gidebileceği aralık: masa kenarı ~0.52 m önde, sandalye
 * arkalığı ~0.43 m geride; başın yarıçapı ve sırttaki pay düşülür.
 */
const LEAN = { front: 0.3, back: -0.27 };

/** tek seferlik hareketler bitmeden bu kadar saniye önce sonraki harekete geçilir */
const SHOT_LEAD = 0.6;

/** Boşta kıpırdanma havuzu: her karakter bu havuzdan kendine özgü birkaç hareket seçer */
const FIDGET_POOL = ['talk', 'talk2', 'disbelief', 'disbelief2', 'disapproval', 'clap', 'thumbsup', 'point', 'laugh', 'yell2'];

/** Oturan karakterin koltuğa göre yerleşimi (modele göre ince ayar) */
const SIT = {
  // ölçek ayakta boyun yüksekliğinden (neck) alınır: oturunca boyun ~1.1 m'ye gelir.
  // forward negatif: karakter sandalyenin ortasına oturur, tepkilerde kolları masaya girmez
  mixamo: { height: 2.1, neck: 1.55, forward: -0.1, lift: 0 },
  // robotun "Sitting" klibi yere oturuyor: sandalye yüksekliğine kaldırılır
  robot: { height: 1.45, forward: 0.12, lift: 0.3 },
};

interface Props {
  seat: SeatInfo;
  character: CharacterDef;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Botların bakacağı dünya noktası */
  lookAt: THREE.Vector3 | null;
  isCurrent: boolean;
}

const FALLBACK_ROBOT: CharacterDef = { id: 'robot-yedek', name: 'Robot', url: ROBOT_URL, kind: 'robot', color: '#888', tint: '#8a8f9c' };

export function Avatar(props: Props) {
  const def = props.character;
  if (def.kind !== 'mixamo') return <RobotAvatar def={def} {...props} />;
  return (
    <SafeBoundary fallback={<RobotAvatar def={FALLBACK_ROBOT} {...props} />}>
      <MixamoAvatar def={def} {...props} />
    </SafeBoundary>
  );
}

function RobotAvatar({ def, ...props }: Props & { def: CharacterDef }) {
  const gltf = useGLTF(def.url);
  const rig = useMemo(
    () =>
      buildRig(
        gltf.scene,
        gltf.animations.map(clip => ({ name: clip.name, clip })),
        { kind: 'robot', targetHeight: SIT.robot.height, tint: def.tint },
      ),
    [gltf, def.tint],
  );
  return <LivingCharacter rig={rig} forward={SIT.robot.forward} lift={SIT.robot.lift} {...props} />;
}

const isJson = (url: string) => /\.json(\?|$)/i.test(url);
const JSON_NAMES = Object.keys(ANIMATIONS).filter(n => isJson(ANIMATIONS[n]));
const FBX_NAMES = Object.keys(ANIMATIONS).filter(n => !isJson(ANIMATIONS[n]));

function useMixamoClips() {
  // tüm animasyonlar bir kez yüklenir ve bütün Mixamo karakterlerinde ortak kullanılır
  const texts = useLoader(THREE.FileLoader, JSON_NAMES.map(n => ANIMATIONS[n])) as string[];
  const groups = useLoader(FBXLoader, FBX_NAMES.map(n => ANIMATIONS[n])) as THREE.Group[];
  return useMemo(() => {
    const clips = [
      ...texts.map((t, i) => ({ name: JSON_NAMES[i], clip: THREE.AnimationClip.parse(JSON.parse(t)) })),
      ...groups.map((g, i) => ({ name: FBX_NAMES[i], clip: g.animations[0] })).filter(c => c.clip),
    ];
    alignHips(clips);
    // sürekli dönen klipler (oturma, konuşma) döngü sınırında sıçramasın
    for (const c of clips) if (/^(idle|talk)/i.test(c.name)) makeSeamless(c.clip);
    return clips;
  }, [texts, groups]);
}

/**
 * Klipler farklı kayıtlardan geldiği için kalçanın oturma yüksekliği/derinliği klipten klibe değişir
 * (biri sandalyeden 10 cm yukarıda, biri masaya doğru kaymış başlar). Tepki ve konuşma klipleri oturma
 * döngüsüne geçerken karakter zıplamasın ya da masaya girmesin diye her klibin kalça konumu, oturma
 * döngüsünün ortalamasına kaydırılır; klip içindeki hareket korunur.
 */
function alignHips(clips: { name: string; clip: THREE.AnimationClip }[]) {
  const hipsTrack = (c: THREE.AnimationClip) => c.tracks.find(t => /hips\.position$/i.test(t.name));
  // oturma yüksekliği: kalçanın en alçakta olduğu karelerin ortalaması (ayağa kalkan kliplerde
  // ayaktaki kareler sayılmaz, yalnız oturarak başlayıp bittiği kareler)
  const seated = (t: THREE.KeyframeTrack) => {
    let minY = Infinity;
    for (let i = 1; i < t.values.length; i += 3) minY = Math.min(minY, t.values[i]);
    const m = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < t.values.length; i += 3) {
      if (t.values[i + 1] > minY + 3) continue;
      for (let k = 0; k < 3; k++) m[k] += t.values[i + k];
      n++;
    }
    return m.map(v => v / Math.max(1, n));
  };
  const ref = clips.find(c => c.name === 'idle') ?? clips[0];
  const refTrack = ref && hipsTrack(ref.clip);
  if (!refTrack) return;
  const target = seated(refTrack);
  for (const { name, clip } of clips) {
    const t = hipsTrack(clip);
    if (!t || t === refTrack) continue;
    const m = seated(t);
    // ayağa kalkarken kalça ~30 cm öne gider: masa önünde durduğu için bu ileri hareket kısılır
    const forward = isStandingClip(name) ? 0.4 : 1;
    // yalnız yükseklik (y) ve ileri-geri (z): yana kayma hareketin parçası olabilir
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i + 1] += target[1] - m[1];
      t.values[i + 2] = target[2] + (t.values[i + 2] - m[2]) * forward;
    }
  }
}

/** oturarak başlayıp ayağa kalkan, sevinip yerine oturan klipler (kazananın kutlaması) */
const isStandingClip = (name: string) => /^standup\d*$/i.test(name);

/**
 * Mixamo klipleri döngü için hazırlanmamış: son kare ilk kareye uymaz ve her turda eller ~10 cm sıçrar.
 * Klibin son `blend` saniyesi ilk karesine doğru yumuşakça eritilir; son kare ilk kareyle aynı olur.
 */
function makeSeamless(clip: THREE.AnimationClip, blend = 0.5) {
  const dur = clip.duration;
  const w = Math.min(blend, dur * 0.3);
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const { times, values } = track;
    const size = values.length / times.length;
    if (times.length < 3 || size < 1) continue;
    const isQuat = track instanceof THREE.QuaternionKeyframeTrack;
    for (let i = 0; i < times.length; i++) {
      const u = (times[i] - (dur - w)) / w;
      if (u <= 0) continue;
      const a = THREE.MathUtils.smootherstep(Math.min(1, u), 0, 1);
      const o = i * size;
      if (isQuat) {
        qa.fromArray(values, o);
        qb.fromArray(values, 0);
        qa.slerp(qb, a).toArray(values, o);
      } else for (let k = 0; k < size; k++) values[o + k] += (values[k] - values[o + k]) * a;
    }
  }
}

/** "disbelief" istenince disbelief, disbelief2, disbelief3… arasından rastgele biri */
function pickVariant(actions: Record<string, THREE.AnimationAction>, base: string) {
  const matches = Object.keys(actions).filter(n => n === base || new RegExp(`^${base}\\d+$`).test(n));
  return matches.length ? actions[matches[Math.floor(Math.random() * matches.length)]] : undefined;
}

function MixamoAvatar({ def, ...props }: Props & { def: CharacterDef }) {
  const fbx = useCharacterScene(def.url);
  const clips = useMixamoClips();
  const rig = useMemo(
    () => buildRig(fbx, clips, { kind: 'mixamo', targetHeight: SIT.mixamo.height, neckHeight: SIT.mixamo.neck }),
    [fbx, clips],
  );
  return <LivingCharacter rig={rig} forward={SIT.mixamo.forward} lift={SIT.mixamo.lift} {...props} />;
}

/**
 * Karakteri canlı tutan her şey: oturma döngüsü ve kıpırdanmalar, tepkiler, konuşma,
 * baş/göz takibi, göz kırpma, nefes alma, sırası gelince öne eğilme, kartları elinde tutma.
 */
function LivingCharacter({
  rig,
  forward,
  lift,
  seat,
  position,
  quaternion,
  lookAt,
  isCurrent,
}: Props & { rig: Rig; forward: number; lift: number }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const quality = useQuality();
  const anchor = useMemo(() => new THREE.Object3D(), []);
  const state = useRef({
    base: null as THREE.AnimationAction | null,
    reacting: false,
    nextFidget: 6 + Math.random() * 6,
    nextBlink: 1 + Math.random() * 3,
    blink: 0,
    talkTimer: 0,
    inTalk: false,
    /** kart tutma pozunun ağırlığı: tepki animasyonlarında eller serbest kalır */
    hold: 0,
    /** kart atışı: -1 = yok, aksi halde geçen süre */
    throwT: -1,
    seated: false,
    release: null as (() => void) | null,
    yaw: 0,
    pitch: 0,
    lean: 0,
    /** karakterin bir parçası kartların hizasına girince yelpazenin öne kayma miktarı (metre) */
    cardsDown: 0,
    /** yaslanma sınırının omurgaya uyguladığı düzeltme (radyan) */
    leanFix: 0,
    /** ayak düzeltmelerinin yumuşak ağırlıkları (zemin) */
    fix: { footL: 0, footR: 0 },
    /** ayaktayken gövdenin kaldırılma miktarı */
    standLift: 0,
    /** ellerin çarpışma kayması (yumuşatılmış, dünya uzayında) */
    handOff: { L: new THREE.Vector3(), R: new THREE.Vector3() },
    seed: Math.random() * 100,
  });
  const face = useRef<Partial<Record<MorphKey, number>>>({});
  /** modelin ayaklarını zemine oturtan yükseklik (buildRig); ayakta kaldırma bunun üstüne eklenir */
  const rootBaseY = useMemo(() => rig.root.position.y, [rig]);
  // her karakterin kendi kıpırdanma seti ve temposu: aynı karakterler aynı hareketleri yapmasın
  const favs = useMemo(() => {
    const names = [...FIDGET_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    return names.map(n => pickVariant(rig.actions, n)).filter((a): a is THREE.AnimationAction => !!a);
  }, [rig]);

  /**
   * Hareketler arası geçiş ağırlıkları elle yürütülür: sönmekte olan bir harekete geri dönülünce
   * sıfırlanıp sıçramaz, ağırlıkların toplamı her karede 1'e tamamlanır (eksik kalırsa iskelet
   * bağlama pozuna doğru kayar ve karakter bir an "takılmış" görünür).
   */
  const blend = useMemo(() => new Map<THREE.AnimationAction, { w: number; target: number; speed: number }>(), [rig]);
  /** elle döndürülen kemiklerin son animasyon pozu (başta bağlama pozu) */
  const animPose = useMemo(() => new Map([...rig.bindPose].map(([b, q]) => [b, q.clone()] as const)), [rig]);
  const crossTo = (next: THREE.AnimationAction, dur: number, restart = false) => {
    for (const b of blend.values()) {
      b.target = 0;
      b.speed = 1 / dur;
    }
    const cur = blend.get(next);
    if (!cur || cur.w < 0.02 || restart) {
      next.reset().play();
      if (!cur) blend.set(next, { w: 0, target: 1, speed: 1 / dur });
    }
    const b = blend.get(next)!;
    b.target = 1;
    b.speed = 1 / dur;
  };
  /** tek seferlik hareketin bitişi: klip bitmeden SHOT_LEAD saniye önce onEnd çağrılır */
  const shot = useRef<{ action: THREE.AnimationAction; left: number; onEnd: () => void } | null>(null);
  const playOnce = (action: THREE.AnimationAction, loops: number, onEnd: () => void) => {
    const len = (action.getClip().duration * loops) / Math.max(0.1, Math.abs(action.timeScale));
    shot.current = { action, left: Math.max(0.3, len - SHOT_LEAD), onEnd };
  };
  const fadeTo = (next: THREE.AnimationAction | null, dur = 1.1) => {
    const st = state.current;
    if (!next || next === st.base) return;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    crossTo(next, dur);
    st.base = next;
  };

  // başlangıç: oturma döngüsü (kıpırdanma varyantları farklı zamanlarda başlasın)
  // ilk kullanımda klip bağlarının kurulması ve shader derlemesi takılma yapmasın: karakter yüklenince
  // tüm klipler bir kez hazırlanır, sonra sahne derlenir
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  useEffect(() => {
    const st = state.current;
    for (const a of Object.values(rig.actions)) a.play();
    rig.mixer.update(0);
    for (const a of Object.values(rig.actions)) a.stop();
    const compileId = requestAnimationFrame(() => gl.compile(scene, camera));
    // ilk kare oturma pozu hesaplanana kadar gizli: model bir an T pozunda, havada görünmesin
    rig.root.visible = false;
    if (rig.idle) {
      rig.idle.play();
      rig.idle.time = Math.random() * rig.idle.getClip().duration;
      rig.idle.timeScale = 0.85 + Math.random() * 0.3;
      blend.set(rig.idle, { w: 1, target: 1, speed: 1 });
      st.base = rig.idle;
    }
    return () => {
      cancelAnimationFrame(compileId);
      rig.mixer.stopAllAction();
      blend.clear();
    };
  }, [rig, gl, scene, camera, blend]);

  // kart atışı: kol geri çekilir, ileri savrulur; kart bırakma anında yığına uçar
  const thrower = useMemo<Thrower>(
    () => ({
      throw: () =>
        new Promise<void>(resolve => {
          state.current.release?.();
          state.current.throwT = 0;
          state.current.release = resolve;
        }),
      handPosition: out => (rig.bones.handR ? rig.bones.handR.getWorldPosition(out) : anchor.getWorldPosition(out)),
    }),
    [rig, anchor],
  );

  // geliştirme: animasyonları tek tek incelemek için window.__avatars[oyuncu] üzerinden klip oynatılır
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __avatars?: Record<string, unknown> };
    w.__avatars ??= {};
    w.__avatars[seat.playerId] = {
      rig,
      state: state.current,
      group,
      anchor,
      play: (name: string) => {
        const a = rig.actions[name];
        if (!a) return false;
        const st = state.current;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        crossTo(a, 0.5, true);
        st.base = a;
        st.reacting = true;
        playOnce(a, 1, () => {
          st.reacting = false;
          fadeTo(rig.idle, SHOT_LEAD + 0.2);
        });
        return a.getClip().duration;
      },
    };
    return () => {
      delete w.__avatars?.[seat.playerId];
    };
  }, [rig, seat.playerId, anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  // kartlar bu noktaya bağlanır
  useEffect(() => {
    director.setHandAnchor(seat.playerId, anchor, thrower);
    return () => director.setHandAnchor(seat.playerId, null);
  }, [seat.playerId, anchor, thrower]);

  // emote ve oyun tepkileri
  const reaction = useApp(s => s.reactions[seat.playerId]);
  useEffect(() => {
    if (!reaction) return;
    const st = state.current;
    // kutlamada bazen ayağa kalkıp sevinir
    const standUp = reaction.name === 'dance' && Math.random() < 0.5 ? pickVariant(rig.actions, 'standup') : undefined;
    const action = standUp ?? (REACTION_CLIPS[reaction.name] ?? []).map(n => pickVariant(rig.actions, n)).find(Boolean);
    if (action && action !== st.base) {
      const loops = reaction.name === 'dance' && !standUp ? 2 : 1;
      action.setLoop(THREE.LoopRepeat, loops);
      action.clampWhenFinished = true;
      crossTo(action, 0.5, true);
      st.reacting = true;
      // klip bitmeden, hareket sürerken oturma döngüsüne geçilir: son karede donma ve sıçrama olmaz
      playOnce(action, loops, () => {
        st.reacting = false;
        // konuşuyorsa konuşmaya, değilse oturmaya döner (yarım kalan el hareketine geri dönülmez)
        const talking = st.talkTimer > 0 && rig.talks.length > 0;
        const back = talking ? rig.talks[Math.floor(Math.random() * rig.talks.length)] : rig.idle;
        st.inTalk = talking;
        if (back) {
          back.setLoop(THREE.LoopRepeat, Infinity);
          back.clampWhenFinished = false;
          crossTo(back, SHOT_LEAD + 0.2);
          st.base = back;
        }
      });
    }
    const expr = REACTION_FACE[reaction.name] as MorphKey | undefined;
    if (expr) {
      gsap.killTweensOf(face.current);
      gsap.to(face.current, { [expr]: 1, duration: 0.25 });
      gsap.to(face.current, { [expr]: 0, duration: 0.6, delay: 1.8 });
    }
  }, [reaction, rig]);

  const tmpV = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      c: new THREE.Vector3(),
      tl: new THREE.Vector3(),
      tr: new THREE.Vector3(),
      pl: new THREE.Vector3(),
      pr: new THREE.Vector3(),
      f: new THREE.Vector3(),
      d: new THREE.Vector3(),
      e: new THREE.Vector3(),
      oL: new THREE.Vector3(),
      oR: new THREE.Vector3(),
      h0: new THREE.Vector3(),
      h1: new THREE.Vector3(),
      h2: new THREE.Vector3(),
      h3: new THREE.Vector3(),
      h4: new THREE.Vector3(),
      h5: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = state.current;
    const t = frame.clock.elapsedTime + st.seed;

    // elle döndürdüğümüz kemikler (gövde, baş, kollar) her kare animasyonun bıraktığı poza geri alınır:
    // eklemeler birikmez. Bağlama pozuna değil son animasyon pozuna dönülür, çünkü karıştırıcı değeri
    // değişmeyen kemiğe yazmaz; bağlama pozuna sıfırlanan kemik o kare kollar açık çizilip sıçrıyordu.
    for (const [bone, q] of animPose) bone.quaternion.copy(q);
    // geçiş ağırlıkları: hedefe doğru sabit hızla ilerler, toplam 1'e ölçeklenir
    let sum = 0;
    for (const [a, b] of blend) {
      b.w = b.target > b.w ? Math.min(b.target, b.w + b.speed * dt) : Math.max(b.target, b.w - b.speed * dt);
      if (b.w <= 0 && b.target === 0) {
        a.stop();
        blend.delete(a);
      } else sum += b.w;
    }
    for (const [a, b] of blend) a.setEffectiveWeight(sum > 0 ? b.w / sum : 0);
    rig.mixer.update(dt);
    for (const [bone, q] of animPose) q.copy(bone.quaternion);

    // tek seferlik hareket bitmek üzereyse sonraki harekete şimdiden geçilir
    const sh = shot.current;
    if (sh) {
      sh.left -= dt;
      if (sh.left <= 0) {
        shot.current = null;
        sh.onEnd();
      }
    }

    // --- sandalyeye oturtma: animasyonlar başka bir karakterden geldiği için bacak boyu farkı kalçayı
    // havada bırakabilir ya da sandalyeye gömebilir. Oturma döngüsündeyken kalça sandalyenin ortasına çekilir.
    const bodyGroup = body.current;
    const gg = group.current;
    if (bodyGroup && gg && rig.bones.hips && !st.reacting && st.base === rig.idle) {
      rig.root.updateMatrixWorld(true);
      const h = gg.worldToLocal(rig.bones.hips.getWorldPosition(tmpV.a));
      const ks = st.seated ? Math.min(1, dt * 1.5) : 1; // ilk karede doğrudan otur, sonra yumuşak düzelt
      bodyGroup.position.y += (SEAT_HIPS.y - h.y) * ks;
      bodyGroup.position.z += (SEAT_HIPS.z - h.z) * ks;
      bodyGroup.position.y = THREE.MathUtils.clamp(bodyGroup.position.y, -0.4, 0.6);
      bodyGroup.position.z = THREE.MathUtils.clamp(bodyGroup.position.z, -0.4, 0.3);
      st.seated = true;
    }
    if (!rig.root.visible && (st.seated || !rig.bones.hips)) rig.root.visible = true;

    // ayağa kalkınca: bacakları klipteki iskeletten uzun karakterlerde ayaklar zemine gömülüyordu. Kalça
    // yükseldikçe (yalnız ayaktayken) gövde, en alçak ayak zeminin üstüne çıkacak kadar kaldırılır.
    if (gg && rig.bones.hips) {
      const { footL, footR, toeL, toeR } = rig.bones;
      rig.root.updateMatrixWorld(true);
      const hipsY = gg.worldToLocal(rig.bones.hips.getWorldPosition(tmpV.a)).y;
      let low = Infinity;
      for (const b of [toeL ?? footL, toeR ?? footR]) if (b) low = Math.min(low, gg.worldToLocal(b.getWorldPosition(tmpV.a)).y);
      const standing = THREE.MathUtils.smoothstep(hipsY - st.standLift, SEAT_HIPS.y + 0.06, SEAT_HIPS.y + 0.18);
      const want = Number.isFinite(low) ? Math.max(0, 0.03 - (low - st.standLift)) * standing : 0;
      st.standLift += (want - st.standLift) * Math.min(1, dt * 10);
      rig.root.position.y = rootBaseY + st.standLift;
    }

    // --- kıpırdanma ve konuşma döngüleri ---
    const speaking = useApp.getState().speaking[seat.playerId] ?? 0;
    if (!st.reacting) {
      // konuşma klibinin rastgele bir yerinden başla: aynı hareketler tekrar etmesin
      // (başlangıç noktası klibin sonuna çok yakın olmaz: hemen döngü sınırına gelinmesin)
      const startTalk = (fade: number) => {
        const others = rig.talks.filter(a => a !== st.base);
        const a = (others.length ? others : rig.talks)[Math.floor(Math.random() * (others.length || rig.talks.length))];
        if (a === st.base) return;
        fadeTo(a, fade);
        if ((blend.get(a)?.w ?? 0) < 0.02) a.time = Math.random() * Math.max(0, a.getClip().duration - 2 * SHOT_LEAD - 1);
      };
      st.talkTimer = speaking > 0.12 ? Math.min(st.talkTimer + dt, 2) : Math.max(st.talkTimer - dt, 0);
      const gesturing = !!shot.current;
      if (rig.talks.length && st.talkTimer > 0.35 && !st.inTalk) {
        shot.current = null;
        startTalk(0.7);
        st.inTalk = true;
      } else if (st.inTalk && !gesturing && st.talkTimer === 0) {
        fadeTo(rig.idle, 1.2);
        st.inTalk = false;
      } else if (st.inTalk && !gesturing && st.base && rig.talks.includes(st.base)) {
        // konuşma klipleri döngü için hazırlanmadı: sona yaklaşınca başka bir konuşma klibine yumuşakça geçilir
        const left = st.base.getClip().duration - st.base.time;
        if (left < SHOT_LEAD && rig.talks.length > 1) startTalk(SHOT_LEAD);
      }

      // boşta kıpırdanma: başka bir oturma varyantına geç ya da tek seferlik bir el kol hareketi yap
      st.nextFidget -= dt;
      if (st.nextFidget <= 0 && !st.inTalk) {
        if (rig.idleVariants.length > 1) {
          const options = rig.idleVariants.filter(a => a !== st.base);
          fadeTo(options[Math.floor(Math.random() * options.length)], 1.4);
        } else if (favs.length) {
          const options = favs.filter(a => a !== st.base);
          const g = options[Math.floor(Math.random() * options.length)] ?? favs[0];
          // el hareketi bir kez oynar ve bitmeden oturma döngüsüne döner (döngü sınırında sıçramaz)
          g.setLoop(THREE.LoopOnce, 1);
          g.clampWhenFinished = true;
          crossTo(g, 1.0, true);
          st.base = g;
          st.inTalk = true;
          playOnce(g, 1, () => {
            fadeTo(rig.idle, SHOT_LEAD + 0.3);
            st.inTalk = false;
          });
        }
        st.nextFidget = 5 + Math.random() * 9;
      }
    }

    // --- bakış: insanlar kendi kamera yönünü gönderir, botlar sıradaki oyuncuya bakar ---
    let yaw = 0;
    let pitch = 0;
    const remote = useApp.getState().looks[seat.playerId];
    if ((seat.isBot || !remote) && lookAt) {
      const local = tmpV.a.copy(lookAt).sub(position).applyQuaternion(tmpV.q.copy(quaternion).invert());
      yaw = Math.atan2(local.x, local.z) + Math.sin(t * 0.5) * 0.07;
      pitch = -Math.atan2(local.y - 1.25, Math.hypot(local.x, local.z));
    } else if (remote) {
      yaw = remote.yaw;
      pitch = -remote.pitch;
    }
    // gerçek oyuncunun baktığı yön karakterde birebir görünür (gövde + boyun + baş birlikte döner)
    // botlar sadece başını çevirir (gövde ve kartlar masaya dönük kalır); gerçek oyuncular bakışı birebir yansıtır
    const human = !!remote && !seat.isBot;
    yaw = THREE.MathUtils.clamp(yaw, human ? -1.45 : -0.8, human ? 1.45 : 0.8);
    pitch = THREE.MathUtils.clamp(pitch, human ? -0.55 : -0.2, human ? 0.6 : 0.2);
    const k = Math.min(1, dt * (remote && !seat.isBot ? 8 : 4));
    st.yaw += (yaw - st.yaw) * k;
    st.pitch += (pitch - st.pitch) * k;
    st.lean += ((isCurrent ? 1 : 0) - st.lean) * Math.min(1, dt * 2.5);

    // atış eğrisi: 0–0.25 sn kolu geri çek, 0.25–0.4 ileri savur (0.34'te bırak), 0.4–0.7 dinlen
    let wind = 0;
    let fling = 0;
    if (st.throwT >= 0) {
      st.throwT += dt;
      const tt = st.throwT;
      if (tt < 0.25) wind = THREE.MathUtils.smoothstep(tt, 0, 0.25);
      else if (tt < 0.4) {
        wind = 1 - (tt - 0.25) / 0.15;
        fling = (tt - 0.25) / 0.15;
      } else fling = Math.max(0, 1 - (tt - 0.4) / 0.3);
      if (tt >= 0.34 && st.release) {
        st.release();
        st.release = null;
      }
      if (tt > 0.7) st.throwT = -1;
    }

    // gövde: nefes + sırası gelince öne eğilme + atışta omuz dönüşü; baş ve gözler bakış yönünü paylaşır
    const breath = Math.sin(t * 1.6) * 0.012;
    // gövde dönüşü kartları tutan kollara binmesin diye küçük tutulur
    // yaslanma sınırı: bazı tepkiler (üzülme, gülme, şaşırma) gövdeyi çok öne ya da arkaya atar; baş masaya,
    // kartlara ya da sandalye arkalığına girerdi. Baş koltuğa göre izin verilen aralığı aşarsa omurga taşan
    // kadar ters yöne döndürülür (hareket korunur, yalnız fazlası kırpılır).
    let leanTarget = 0;
    if (group.current && rig.bones.head && rig.bones.spine) {
      const headL = group.current.worldToLocal(rig.bones.head.getWorldPosition(tmpV.a));
      const spineL = group.current.worldToLocal(rig.bones.spine.getWorldPosition(tmpV.b));
      const lever = Math.max(0.25, Math.hypot(headL.y - spineL.y, headL.z - spineL.z));
      if (headL.z > LEAN.front) leanTarget = -Math.asin(Math.min(1, (headL.z - LEAN.front) / lever));
      else if (headL.z < LEAN.back) leanTarget = Math.asin(Math.min(1, (LEAN.back - headL.z) / lever));
    }
    const prevFix = Number.isFinite(st.leanFix) ? st.leanFix : 0;
    st.leanFix = Number.isFinite(leanTarget) ? prevFix + (leanTarget * 1.15 - prevFix) * Math.min(1, dt * 22) : prevFix;
    rotateBoneInBodySpace(rig, rig.bones.spine, breath + st.lean * 0.1 + fling * 0.12 + st.leanFix, st.yaw * (human ? 0.2 : 0.05) - wind * 0.22 + fling * 0.12);
    rotateBoneInBodySpace(rig, rig.bones.neck, st.pitch * 0.3, st.yaw * 0.3);
    rotateBoneInBodySpace(rig, rig.bones.head, st.pitch * 0.5 + speaking * 0.08 * Math.sin(t * 21), st.yaw * 0.45, Math.sin(t * 0.7) * 0.03);
    rotateBoneInBodySpace(rig, rig.bones.eyeL, st.pitch * 0.25, st.yaw * 0.3);
    rotateBoneInBodySpace(rig, rig.bones.eyeR, st.pitch * 0.25, st.yaw * 0.3);
    if (rig.bones.jaw) rotateBoneInBodySpace(rig, rig.bones.jaw, speaking * 0.35, 0);

    // --- göz kırpma ve yüz ifadeleri (modelde blendshape varsa) ---
    st.nextBlink -= dt;
    if (st.nextBlink <= 0) {
      st.blink = 0.14;
      st.nextBlink = 2 + Math.random() * 4;
    }
    st.blink = Math.max(0, st.blink - dt);
    setMorph(rig, 'blink', st.blink > 0 ? Math.sin((st.blink / 0.14) * Math.PI) : 0);
    const f = face.current;
    const hasMouth = !!rig.morphs.mouth;
    setMorph(rig, 'mouth', Math.min(1, speaking * 1.2));
    setMorph(rig, 'happy', f.happy ?? 0);
    setMorph(rig, 'angry', f.angry ?? 0);
    setMorph(rig, 'sad', f.sad ?? 0);
    // ağız blendshape'i yoksa konuşma "şaşkın" ifadesiyle canlandırılır
    setMorph(rig, 'surprised', Math.max(f.surprised ?? 0, hasMouth ? 0 : speaking * 0.9));

    // --- kart tutma: kartlar göğüs önünde sabit durur, eller IK ile kartlara uzanır ---
    const g = group.current;
    if (g) {
      rig.root.updateMatrixWorld(true);
      const { handL, handR, neck, armL, foreL, armR, foreR } = rig.bones;
      // kartlar elde değil, göğüs önünde sabit durur; eller serbest kalır (atışta sağ kol savrulur)
      const canHold = false;
      // sağ el tepkilerde serbest kalır; sol el kartları her zaman tutar
      st.hold += ((canHold && !st.reacting ? 1 : 0) - st.hold) * Math.min(1, dt * 3);

      // göğüs noktası: boyna göre; boyun yoksa sabit
      // z: koltuğun önünden; göbekli karakterlerde de kartlar gövdenin dışında kalır
      const chest = tmpV.c.set(0, 0.95, 0.42);
      const shoulder = armL ?? neck;
      if (shoulder) {
        shoulder.getWorldPosition(tmpV.a);
        g.worldToLocal(tmpV.a);
        // kartlar omuzların biraz altında, göğüs önünde: büyük kafalı karakterlerde bile yüzü kapatmaz,
        // her zaman masanın üstünde kalır
        chest.set(0, THREE.MathUtils.clamp(tmpV.a.y - 0.06, 0.93, 1.02), THREE.MathUtils.clamp(tmpV.a.z + 0.36, 0.4, 0.48));
      }
      // kartlar her zaman göğüs önünde, elde ve dik durur (masaya bırakılmaz). Karakterin herhangi bir parçası
      // (eller, parmak uçları, ön kollar, dirsekler, öne eğilen baş ya da gövde) yelpazenin hizasına gelirse
      // yelpaze o parçanın önüne kayar, masanın kenarının üstüne kadar; parça çekilince yerine döner. Ölçü
      // yelpazenin olağan yerine göre alınır, kaçarken titremez.
      const restZ = chest.z;
      let needZ = restZ;
      const hs = rig.handSize;
      const consider = (p: THREE.Vector3, r: number) => {
        const l = g.worldToLocal(p);
        if (Math.abs(l.x - chest.x) > 0.27 + r || l.y < chest.y - 0.24 - r || l.y > chest.y + 0.1 + r) return;
        // yelpazenin arkasında kalması için gereken yer (çok gerideki parça yelpazeyi etkilemez)
        if (l.z + r > restZ - 0.03) needZ = Math.max(needZ, l.z + r + 0.03);
      };
      for (const [side, hand, fore] of [['L', handL, foreL], ['R', handR, foreR]] as const) {
        if (!hand) continue;
        consider(hand.getWorldPosition(tmpV.a), hs * 0.25);
        const m = rig.fingers[side].Middle;
        if (m?.length) {
          consider(m[0].getWorldPosition(tmpV.a), hs * 0.25);
          consider(m[m.length - 1].getWorldPosition(tmpV.a), hs * 0.12);
        }
        if (fore) {
          consider(fore.getWorldPosition(tmpV.a), 0.045);
          consider(fore.getWorldPosition(tmpV.a).lerp(hand.getWorldPosition(tmpV.b), 0.5), 0.04);
        }
      }
      // baş ve göğüs: öne eğilen tepkilerde (üzülme, gülme) yüz ve göğüs kartlara girmesin
      const headProxy = rig.proxies.find(px => px.bone === rig.bones.head);
      if (rig.bones.head) consider(rig.bones.head.getWorldPosition(tmpV.a).add(tmpV.b.set(0, 0.09, 0)), headProxy ? Math.max(...headProxy.rf) : 0.12);
      const chestProxy = rig.proxies.find(px => px.bone === rig.bones.spine);
      if (rig.bones.spine) consider(rig.bones.spine.getWorldPosition(tmpV.a), chestProxy ? Math.max(...chestProxy.rf) : 0.15);
      // masanın kenarını çok aşmaz: dik kartların alt kenarı masaya değmez
      const dodge = THREE.MathUtils.clamp(needZ - restZ, 0, 0.24);
      // kaçış hızlı, geri dönüş yavaş
      st.cardsDown += (dodge - st.cardsDown) * Math.min(1, dt * (dodge > st.cardsDown ? 24 : 3));
      chest.z += st.cardsDown;
      // yelpaze gövdeyi yumuşakça izler; öne kaçış gecikmesiz uygulanır
      anchor.position.x += (chest.x - anchor.position.x) * Math.min(1, dt * 14);
      anchor.position.y += (chest.y - anchor.position.y) * Math.min(1, dt * 14);
      anchor.position.z = chest.z;
      // neredeyse dik, karaktere doğru hafifçe yatık (masadakiler yelpazeyi düzgün görür)
      anchor.rotation.set(-0.18, 0, 0);
      anchor.updateMatrix();

      if (canHold) {
        // sol el yelpazenin dibini arkadan kavrar, sağ el sağ kenarını tutar (izleyen taraftan parmaklar
        // kartların arkasında görünür); atışta sağ kol savrulur
        // tutma noktaları kartların çerçevesinde (eğimle birlikte döner)
        // bilekler yelpazenin altında kalır, yalnız parmaklar kartların alt kenarını kavrar: kartlar görünür kalır
        tmpV.tl.set(0.065, -0.17, 0.025).applyMatrix4(anchor.matrix);
        tmpV.tr.set(-0.07, -0.16, 0.025).applyMatrix4(anchor.matrix);
        tmpV.tr.add(tmpV.a.set(-0.04 * wind + 0.04 * fling, 0.2 * wind + 0.03 * fling, -0.1 * wind + 0.32 * fling));
        g.localToWorld(tmpV.tl);
        g.localToWorld(tmpV.tr);
        // dirsekler aşağı ve dışa bakar
        g.localToWorld(tmpV.pl.set(0.5, 0.55, 0.05));
        g.localToWorld(tmpV.pr.set(-0.5, 0.55, 0.05));
        const throwing = st.throwT >= 0 ? 1 : 0;
        solveArmIK(armL, foreL, handL, tmpV.tl, tmpV.pl, st.hold);
        solveArmIK(armR, foreR, handR, tmpV.tr, tmpV.pr, Math.max(st.hold, throwing));

        // bilek ve parmaklar: parmaklar yukarı (kartlar boyunca), avuç karaktere dönük (kartların arkasına değer)
        const gq = anchor.getWorldQuaternion(tmpV.q);
        const up = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(gq);
        const toBody = up(0, 0, -1);
        poseGrip(rig, 'L', handL, up(-0.25, 1, 0.15), toBody, 0.55, st.hold);
        poseGrip(rig, 'R', handR, up(0.35, 1, 0.15), toBody, 0.45, st.hold * (1 - (st.throwT >= 0 ? 1 : 0)));
      }

      // --- el çarpışmaları: animasyonlar başka bir iskeletten geldiği için kolu kısa ya da uzun, eli büyük,
      // göbekli karakterlerde eller gövdeye, başa, bacaklara, birbirine ve masaya giriyordu. Her karakterin
      // kendi deri ölçüsünden çıkarılan şekillere göre her elin ne kadar kayması gerektiği hesaplanır; bu
      // kayma kareden kareye yumuşatılıp tek bir kol IK'sıyla uygulanır (dirsek kendi düzleminde kalır).
      // Kayma sıfıra inince poz birebir animasyondur; aç/kapa sıçraması olmaz.
      const noFix = import.meta.env.DEV && (window as unknown as { __noFix?: boolean }).__noFix;
      const handPoints = (side: 'L' | 'R', hand: THREE.Bone, out: THREE.Vector3[]) => {
        const m = rig.fingers[side].Middle;
        hand.getWorldPosition(out[0]);
        if (m && m.length) {
          m[0].getWorldPosition(out[1]);
          const last = m[m.length - 1];
          last.getWorldPosition(out[2]);
          // parmak ucu: son eklemden bir eklem boyu ileride
          if (m.length > 1) out[2].add(tmpV.f.subVectors(out[2], m[m.length - 2].getWorldPosition(tmpV.f)).multiplyScalar(0.8));
          out[1].lerp(out[0], 0.45); // avuç ortası
        } else {
          out[1].copy(out[0]);
          out[2].copy(out[0]);
        }
        return out;
      };
      // bilek, avuç ortası, parmak ucu için yarıçaplar
      const radii = [hs * 0.22, hs * 0.24, hs * 0.1];
      const ptsL = handL ? handPoints('L', handL, [tmpV.h0, tmpV.h1, tmpV.h2]) : null;
      const ptsR = handR ? handPoints('R', handR, [tmpV.h3, tmpV.h4, tmpV.h5]) : null;
      const offL = tmpV.oL.set(0, 0, 0);
      const offR = tmpV.oR.set(0, 0, 0);
      const lateral = tmpV.d.set(1, 0, 0).applyQuaternion(g.getWorldQuaternion(tmpV.q));

      // gövde: noktaların itmeleri büyüklüğe göre ağırlıklı karıştırılır (en derin giren nokta baskın)
      const bodyPush = (pts: THREE.Vector3[], out: THREE.Vector3) => {
        let wsum = 0;
        pts.forEach((p, i) => {
          const pen = bodyPenetration(rig, p, radii[i], tmpV.e);
          if (pen <= 0) return;
          const w = pen ** 4;
          out.addScaledVector(tmpV.e, w);
          wsum += w;
        });
        if (wsum > 0) out.divideScalar(wsum);
        // çok derin giriş büyük olasılıkla ölçü hatasıdır: el bir anda fırlamasın
        if (out.length() > hs * 0.8) out.setLength(hs * 0.8);
      };
      if (rig.proxies.length) {
        if (ptsL) bodyPush(ptsL, offL);
        if (ptsR) bodyPush(ptsR, offR);
      }

      // eller birbirinin içinden geçmez: avuçlar birbirine yakınken (yükseklik ve derinlikte bir el boyundan
      // az) sol avuç sağ avucun en az iki avuç kalınlığı kadar solunda kalır. Kolu uzun karakterlerde alkışlayan
      // eller X şeklinde karşı tarafa geçiyordu. Eller uzaktayken itme söner (tek elle karşıyı göstermek serbest).
      if (ptsL && ptsR) {
        const v = tmpV.e.subVectors(ptsL[1], ptsR[1]).add(offL).sub(offR);
        const sx = v.dot(lateral);
        const perp = v.addScaledVector(lateral, -sx).length();
        const w = 1 - THREE.MathUtils.smoothstep(perp, hs * 0.9, hs * 1.7);
        const sep = Math.min(hs, Math.max(0, hs * 0.38 - sx) * w);
        offL.addScaledVector(lateral, sep / 2);
        offR.addScaledVector(lateral, -sep / 2);
      }

      // masa: eller (bilek, avuç, parmak uçları) masa tablasına girmez, yüzeyine kaldırılır. Masanın kenarından
      // dışarıda ya da tablanın altında (kucakta) kalan el itilmez; geçişler yumuşak.
      const tableLift = (pts: THREE.Vector3[], off: THREE.Vector3) => {
        let lift = 0;
        pts.forEach((p, i) => {
          const y = p.y + off.y;
          const need = TABLE_Y + radii[i] * 0.6 - y;
          if (need <= 0) return;
          const r = Math.hypot(p.x + off.x, p.z + off.z);
          const w = (1 - THREE.MathUtils.smoothstep(r, TABLE_R + 0.04, TABLE_R + 0.1)) * (1 - THREE.MathUtils.smoothstep(need, 0.06, 0.11));
          lift = Math.max(lift, need * w);
        });
        off.y += lift;
      };
      if (ptsL) tableLift(ptsL, offL);
      if (ptsR) tableLift(ptsR, offR);

      // yumuşatma: itme hızla devreye girer, daha yavaş bırakılır
      const smooth = (cur: THREE.Vector3, want: THREE.Vector3) => {
        const rate = want.lengthSq() > cur.lengthSq() ? 30 : 14;
        cur.lerp(want, 1 - Math.exp(-dt * rate));
      };
      smooth(st.handOff.L, offL);
      smooth(st.handOff.R, offR);
      const reach = (arm?: THREE.Bone, fore?: THREE.Bone, hand?: THREE.Bone, delta?: THREE.Vector3, side = 1) => {
        if (noFix || !arm || !fore || !hand || !delta || delta.lengthSq() < 1e-7) return;
        const target = hand.getWorldPosition(tmpV.b).add(delta);
        // dirsek bulunduğu düzlemde kalır (hafif dışa ve aşağı: kol düz olsa bile yön belirli)
        const pole = fore.getWorldPosition(tmpV.c).add(tmpV.f.set(side * 0.04, -0.04, 0).applyQuaternion(g.getWorldQuaternion(tmpV.q)));
        solveArmIK(arm, fore, hand, target, pole, 1);
      };
      reach(armL, foreL, handL, st.handOff.L, 1);
      reach(armR, foreR, handR, st.handOff.R, -1);

      // ayaklar zemine gömülmesin: kalça sandalyeye sabitlendiği için bacağı uzun ya da kısa iskeletten
      // gelen kliplerde ayak ucu yerin altına inebiliyordu. Ayak zemine girerse diz bükülüp ayak kaldırılır.
      // düzeltme aç/kapa değil, yumuşak ağırlıkla devreye girer: sınırda ayak titremez
      const ease = (key: keyof typeof st.fix, want: boolean) => {
        st.fix[key] += ((want ? 1 : 0) - st.fix[key]) * Math.min(1, dt * 10);
        return st.fix[key];
      };
      const { thighL, shinL, footL, toeL, thighR, shinR, footR, toeR } = rig.bones;
      const keepFeetUp = (key: 'footL' | 'footR', thigh?: THREE.Bone, shin?: THREE.Bone, foot?: THREE.Bone, toe?: THREE.Bone, side = 1) => {
        if (!thigh || !shin || !foot) return;
        const ankle = foot.getWorldPosition(tmpV.a);
        const tipY = toe ? toe.getWorldPosition(tmpV.f).y : ankle.y;
        // bilek zeminden en az ~6 cm, ayak ucu ~1.5 cm yukarıda olmalı
        const low = Math.min(ankle.y - 0.06, tipY - 0.015);
        const w = ease(key, low < (st.fix[key] > 0.5 ? 0.02 : 0));
        if (w > 0.01) {
          const target = tmpV.b.copy(ankle);
          target.y += Math.max(0, -low);
          // diz öne ve hafif dışa bakar
          solveArmIK(thigh, shin, foot, target, g.localToWorld(tmpV.c.set(side * 0.15, 0.55, 0.9)), w);
        }
      };
      keepFeetUp('footL', thighL, shinL, footL, toeL, 1);
      keepFeetUp('footR', thighR, shinR, footR, toeR, -1);
    }
  });

  return (
    <group ref={group} position={position} quaternion={quaternion}>
      <group ref={body} position={[0, lift, forward]}>
        <primitive object={rig.root} />
      </group>
      <primitive object={anchor} />
      {/* sadece sırası gelen karakter ayrıca aydınlatılır: her ışık her pikselin maliyetini artırır */}
      {isCurrent && quality === 'high' && <pointLight position={[0, 1.3, 0.65]} color="#fff3d6" intensity={1.6} distance={1.7} decay={2} />}
      <Html position={[0, 1.62, 0]} center distanceFactor={4.5} zIndexRange={[20, 0]}>
        <NameTag seat={seat} isCurrent={isCurrent} />
      </Html>
    </group>
  );
}

useGLTF.preload(ROBOT_URL);
