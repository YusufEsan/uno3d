import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, useFBX, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import gsap from 'gsap';
import type { SeatInfo } from '@uno/protocol';
import { director } from '../game/director';
import { TABLE_R, TABLE_Y } from '../game/layout';
import { useApp, useQuality } from '../store/useApp';
import { NameTag } from '../ui/NameTag';
import { ANIMATIONS, REACTION_CLIPS, REACTION_FACE, ROBOT_URL, type CharacterDef } from './characters';
import { SafeBoundary } from './SafeBoundary';
import { buildRig, poseGrip, rotateBoneInBodySpace, setMorph, solveArmIK, type MorphKey, type Rig } from './rig';
import type { Thrower } from '../game/director';

/** Oturan karakterin kalçasının hedefi (koltuk çerçevesinde): sandalye oturağının ortası */
const SEAT_HIPS = { y: 0.56, z: -0.11 };
/** Tepki sırasında kartların bırakıldığı nokta (koltuk çerçevesinde): masanın kenarının biraz içi */

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
  const mean = (t: THREE.KeyframeTrack) => {
    const m = [0, 0, 0];
    const n = t.values.length / 3;
    for (let i = 0; i < t.values.length; i += 3) for (let k = 0; k < 3; k++) m[k] += t.values[i + k] / n;
    return m;
  };
  const ref = clips.find(c => c.name === 'idle') ?? clips[0];
  const refTrack = ref && hipsTrack(ref.clip);
  if (!refTrack) return;
  const target = mean(refTrack);
  for (const { clip } of clips) {
    const t = hipsTrack(clip);
    if (!t || t === refTrack) continue;
    const m = mean(t);
    // yalnız yükseklik (y) ve ileri-geri (z): yana kayma hareketin parçası olabilir
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i + 1] += target[1] - m[1];
      t.values[i + 2] += target[2] - m[2];
    }
  }
}

/** "disbelief" istenince disbelief, disbelief2, disbelief3… arasından rastgele biri */
function pickVariant(actions: Record<string, THREE.AnimationAction>, base: string) {
  const matches = Object.keys(actions).filter(n => n === base || new RegExp(`^${base}\\d+$`).test(n));
  return matches.length ? actions[matches[Math.floor(Math.random() * matches.length)]] : undefined;
}

function MixamoAvatar({ def, ...props }: Props & { def: CharacterDef }) {
  const fbx = useFBX(def.url);
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
    gestureLeft: 0,
    yaw: 0,
    pitch: 0,
    lean: 0,
    seed: Math.random() * 100,
  });
  const face = useRef<Partial<Record<MorphKey, number>>>({});
  // her karakterin kendi kıpırdanma seti ve temposu: aynı karakterler aynı hareketleri yapmasın
  const favs = useMemo(() => {
    const names = [...FIDGET_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    return names.map(n => pickVariant(rig.actions, n)).filter((a): a is THREE.AnimationAction => !!a);
  }, [rig]);

  const fadeTo = (next: THREE.AnimationAction | null, dur = 1.1) => {
    const st = state.current;
    if (!next || next === st.base) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(dur).play();
    st.base?.fadeOut(dur);
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
    if (rig.idle) {
      rig.idle.play();
      rig.idle.time = Math.random() * rig.idle.getClip().duration;
      rig.idle.timeScale = 0.85 + Math.random() * 0.3;
      st.base = rig.idle;
    }
    return () => {
      cancelAnimationFrame(compileId);
      rig.mixer.stopAllAction();
    };
  }, [rig, gl, scene, camera]);

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
    const action = (REACTION_CLIPS[reaction.name] ?? []).map(n => pickVariant(rig.actions, n)).find(Boolean);
    if (action && action !== st.base) {
      const loops = reaction.name === 'dance' ? 2 : 1;
      // bitince son karede kalsın: oturma döngüsüne oradan yavaşça geçilir (sıçrama olmaz)
      action.reset().setLoop(THREE.LoopRepeat, loops);
      action.clampWhenFinished = true;
      action.fadeIn(0.5).play();
      st.base?.fadeOut(0.5);
      st.reacting = true;
      const done = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== action) return;
        rig.mixer.removeEventListener('finished', done);
        st.reacting = false;
        action.fadeOut(0.8);
        const back = st.base ?? rig.idle;
        back?.reset().fadeIn(0.8).play();
      };
      rig.mixer.addEventListener('finished', done);
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
      q: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = state.current;
    const t = frame.clock.elapsedTime + st.seed;

    // animasyonların bıraktığı eklemeler birikmesin: elle döndürdüğümüz kemikleri bağlama pozuna al
    for (const [bone, q] of rig.bindPose) bone.quaternion.copy(q);
    rig.mixer.update(dt);

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

    // --- kıpırdanma ve konuşma döngüleri ---
    const speaking = useApp.getState().speaking[seat.playerId] ?? 0;
    if (!st.reacting) {
      // konuşma klibinin rastgele bir yerinden başla: aynı hareketler tekrar etmesin
      const startTalk = (fade: number) => {
        const a = rig.talks[Math.floor(Math.random() * rig.talks.length)];
        fadeTo(a, fade);
        a.time = Math.random() * a.getClip().duration;
      };
      st.talkTimer = speaking > 0.12 ? Math.min(st.talkTimer + dt, 2) : Math.max(st.talkTimer - dt, 0);
      if (rig.talks.length && st.talkTimer > 0.35 && !st.inTalk) {
        startTalk(0.7);
        st.inTalk = true;
        st.gestureLeft = 0;
      } else if (st.inTalk && st.talkTimer === 0 && st.gestureLeft <= 0) {
        fadeTo(rig.idle, 1.2);
        st.inTalk = false;
      }
      st.gestureLeft -= dt;

      // boşta kıpırdanma: başka bir oturma varyantına geç ya da birkaç saniye el kol hareketi yap
      st.nextFidget -= dt;
      if (st.nextFidget <= 0 && !st.inTalk) {
        if (rig.idleVariants.length > 1) {
          const options = rig.idleVariants.filter(a => a !== st.base);
          fadeTo(options[Math.floor(Math.random() * options.length)], 1.4);
        } else if (favs.length) {
          const options = favs.filter(a => a !== st.base);
          fadeTo(options[Math.floor(Math.random() * options.length)] ?? favs[0], 1.3);
          st.inTalk = true;
          st.gestureLeft = 3 + Math.random() * 3;
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
    rotateBoneInBodySpace(rig, rig.bones.spine, breath + st.lean * 0.1 + fling * 0.12, st.yaw * (human ? 0.2 : 0.05) - wind * 0.22 + fling * 0.12);
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
      // kartlar göğüs önünde kalır (gövde eğilince onunla birlikte hareket eder)
      // tepkide eller serbest kalır: karakter kartları önüne, masaya kapalı bırakır; bitince geri alır
      anchor.position.lerp(chest, Math.min(1, dt * 12));
      // elde kartlar geriye yatık (karakter eline bakar); masada yüzü aşağı yatar
      anchor.rotation.set(-0.6, 0, 0);
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

      // --- çarpışma: hangi animasyon oynarsa oynasın eller masanın içine girmez, yüzeyine kaldırılır ---
      const keepAboveTable = (arm?: THREE.Bone, fore?: THREE.Bone, hand?: THREE.Bone, pole?: THREE.Vector3) => {
        if (!arm || !fore || !hand || !pole) return;
        const p = hand.getWorldPosition(tmpV.a);
        // masa kenarının kalın ahşap çerçevesi de dahil
        const inside = Math.hypot(p.x, p.z) < TABLE_R + 0.2 && p.y < TABLE_Y + 0.05 && p.y > TABLE_Y - 0.3;
        if (inside) solveArmIK(arm, fore, hand, tmpV.b.set(p.x, TABLE_Y + 0.06, p.z), pole, 1);
      };
      if (!canHold) {
        g.localToWorld(tmpV.pl.set(0.5, 0.55, 0.05));
        g.localToWorld(tmpV.pr.set(-0.5, 0.55, 0.05));
      }
      keepAboveTable(armL, foreL, handL, tmpV.pl);
      keepAboveTable(armR, foreR, handR, tmpV.pr);
      // el gövdenin içine girerse (kol animasyonları birbirine geçer) gövdeden dışarı itilir
      const outOfTorso = (arm?: THREE.Bone, fore?: THREE.Bone, hand?: THREE.Bone, pole?: THREE.Vector3, side = 1) => {
        if (!arm || !fore || !hand || !pole) return;
        const p = g.worldToLocal(hand.getWorldPosition(tmpV.a));
        const inX = Math.abs(p.x) < 0.2;
        const inZ = p.z > -0.05 && p.z < 0.3;
        const inY = p.y > 0.8 && p.y < 1.25;
        if (inX && inZ && inY) {
          const target = tmpV.b.set(side * 0.24, p.y, Math.max(p.z, 0.32));
          solveArmIK(arm, fore, hand, g.localToWorld(target), pole, 0.8);
        }
      };
      outOfTorso(armL, foreL, handL, tmpV.pl, 1);
      outOfTorso(armR, foreR, handR, tmpV.pr, -1);
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
