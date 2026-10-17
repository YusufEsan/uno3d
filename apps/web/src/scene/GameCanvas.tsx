import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { director } from '../game/director';
import { EYE_HEIGHT, SEAT_R, TABLE_Y, headPos, relativeOrder, seatFrame } from '../game/layout';
import { socket } from '../net/socket';
import { seatedPlayers, useApp, useQuality, type QualityLevel } from '../store/useApp';
import { Avatar } from './Avatar';
import { assignCharacters } from './characters';
import { Chair } from './Chair';
import { Room3D } from './Room3D';
import { THEMES } from './themes';

export function GameCanvas() {
  const themeId = useApp(s => s.room?.theme ?? 'meyhane');
  const theme = THEMES[themeId];
  const quality = useQuality();
  return (
    <Canvas
      shadows
      dpr={1}
      camera={{ fov: 58, near: 0.03, far: 40, position: [0, 2, 3] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerDown={e => {
        if (e.button === 0) director.click();
      }}
    >
      <AutoQuality />
      <QualityController />
      <FpsMeter />
      <Suspense fallback={null}>
        <Room3D theme={theme} quality={quality} />
      </Suspense>
      <Seats />
      <primitive object={director.root} />
      {/* elindeki kartlar lamba konisinin dışında kalıyor: önlerine yumuşak bir dolgu ışığı */}
      <pointLight position={[0, 1.32, SEAT_R - 0.18]} color="#fff1dc" intensity={0.7} distance={1.1} decay={2} />
      <CameraRig />
      <EndCelebration />
      <DirectorDriver />
      {quality === 'high' && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1.2} intensity={theme.bloom} />
          <Vignette offset={0.25} darkness={0.7} />
        </EffectComposer>
      )}
      {quality === 'medium' && (
        <EffectComposer multisampling={0}>
          <Bloom luminanceThreshold={1.2} intensity={theme.bloom * 0.8} />
          <Vignette offset={0.25} darkness={0.7} />
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
  );
}

const ORDER: QualityLevel[] = ['low', 'medium', 'high'];

/** "Otomatik" kalitede kare hızı düşerse kaliteyi indirir, yükselirse artırır */
function AutoQuality() {
  const step = (dir: 1 | -1) => {
    const s = useApp.getState();
    // sekme arka plandayken tarayıcı kare hızını kısar: bunu yavaşlık sanma
    if (s.quality !== 'auto' || document.hidden) return;
    const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(s.autoLevel) + dir));
    if (ORDER[i] !== s.autoLevel) useApp.setState({ autoLevel: ORDER[i] });
  };
  return (
    <PerformanceMonitor
      bounds={() => [45, 58]}
      flipflops={4}
      onDecline={() => step(-1)}
      onIncline={() => step(1)}
      onFallback={() => {
        if (useApp.getState().quality === 'auto' && !document.hidden) useApp.setState({ autoLevel: 'low' });
      }}
    />
  );
}

/** Saniyede bir kare hızını arayüze bildirir */
function FpsMeter() {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    if (a.time >= 1) {
      useApp.setState({ fps: Math.round(a.frames / a.time) });
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

/** Çözünürlük ve gölgeleri kaliteye göre ayarlar */
function QualityController() {
  const quality = useQuality();
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const setDpr = useThree(s => s.setDpr);
  useEffect(() => {
    const native = window.devicePixelRatio || 1;
    setDpr(quality === 'high' ? Math.min(2, native) : quality === 'medium' ? Math.min(1.25, native) : Math.min(0.85, native));
    const shadows = quality !== 'low';
    if (gl.shadowMap.enabled !== shadows) {
      gl.shadowMap.enabled = shadows;
      // gölge açılıp kapanınca malzemelerin yeniden derlenmesi gerekir
      scene.traverse(o => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach(x => (x.needsUpdate = true));
      });
    }
  }, [quality, gl, scene, setDpr]);
  return null;
}

/** Fare 3D sahnenin üstünde mi (HUD panellerinin üstündeyken kamera ortaya döner) */
const pointerOnCanvas = { active: false };
const tmpWatchPos = new THREE.Vector3();

function DirectorDriver() {
  const active = useRef(false);
  const gl = useThree(s => s.gl);
  useMemo(() => {
    const el = gl.domElement;
    el.addEventListener('pointerenter', () => (active.current = true));
    el.addEventListener('pointermove', () => (active.current = true));
    el.addEventListener('pointerleave', () => (active.current = false));
  }, [gl]);
  useFrame((state, dt) => {
    pointerOnCanvas.active = active.current;
    director.update(Math.min(dt, 0.05), state.camera, state.pointer, active.current);
  });
  const scene = useThree(s => s.scene);
  if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __app: useApp, __director: director });
  return null;
}

/** Koltuğundan bakış: fare ekran kenarlarına gidince baş o yöne döner (Liar's Bar tarzı). */
function CameraRig() {
  const camera = useThree(s => s.camera);
  const look = useRef({ yaw: 0, pitch: 0, orbit: 0, endT: 0, topT: 0, sentYaw: 9, sentPitch: 9, lastSend: 0 });
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const orbit = useMemo(() => ({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), center: new THREE.Vector3(0, 1.0, 0) }), []);

  useFrame((state, dt) => {
    const st = useApp.getState();
    const l = look.current;
    // geliştirme: window.__cam = { pos: [x,y,z], target: [x,y,z] } ile kamerayı sabitle (yakından inceleme için)
    const debugCam = import.meta.env.DEV ? (window as unknown as { __cam?: { pos: number[]; target: number[] } }).__cam : undefined;
    if (debugCam) {
      camera.position.fromArray(debugCam.pos);
      camera.lookAt(new THREE.Vector3().fromArray(debugCam.target));
      return;
    }
    // oyun sonunda kartlar masaya serilir, izleme modunda bile görünsünler
    director.hideOwnHand = st.watchSelf && st.view?.phase !== 'ended';
    if (!st.room) {
      // ana ekranda masanın etrafında yavaşça dönen kamera
      l.orbit += dt * 0.07;
      camera.position.set(Math.sin(l.orbit) * 3.1, 2.05, Math.cos(l.orbit) * 3.1);
      camera.lookAt(0, 0.95, 0);
      return;
    }

    // oyun sonu: kamera senin arkandan başlayıp masanın etrafında döner, herkesin tepkisi görünür
    if (st.view?.phase === 'ended') {
      l.endT += dt;
      const a = l.endT * 0.22;
      orbit.pos.set(Math.sin(a) * 2.55, 1.75, Math.cos(a) * 2.55);
      const k = Math.min(1, dt * 1.5);
      camera.position.lerp(orbit.pos, k);
      orbit.m.lookAt(camera.position, orbit.center, camera.up);
      orbit.q.setFromRotationMatrix(orbit.m);
      camera.quaternion.slerp(orbit.q, k);
      return;
    }
    l.endT = 0;

    // kendimi izleme: kamera masanın ortasından kendi koltuğuna bakar; kartlar kameranın arkasında kalır
    if (st.watchSelf) {
      const wp = tmpWatchPos;
      wp.set(0, EYE_HEIGHT - 0.1, 0.05);
      camera.position.lerp(wp, Math.min(1, dt * 6));
      camera.lookAt(0, 1.05, SEAT_R);
      return;
    }
    const px = pointerOnCanvas.active ? state.pointer.x : 0;
    const py = pointerOnCanvas.active ? state.pointer.y : 0;
    const dead = (v: number, d: number) => Math.sign(v) * Math.max(0, Math.abs(v) - d) / (1 - d);
    // serbest bakış: fare kenarlara gittikçe baş döner (sıra sende olsa bile); kartlar masada önünde kalır
    // en kenarda ~77°: yandaki oyunculara doğrudan bakılabilir
    const yawTarget = -dead(px, 0.3) * 1.35;
    const pitchTarget = Math.max(0, dead(py, 0.15)) * 0.4;
    const k = Math.min(1, dt * 3.5);
    l.yaw += (yawTarget - l.yaw) * k;
    l.pitch += (pitchTarget - l.pitch) * k;

    const shake = director.shake;
    director.shake *= Math.pow(0.02, dt);
    // yukarıdan görünüm: kamera yumuşakça yükselir ve masanın ortasına daha dik bakar
    l.topT += ((st.topView ? 1 : 0) - l.topT) * Math.min(1, dt * 4);
    const lift = l.topT * 0.4;
    camera.position.set((Math.random() - 0.5) * shake, EYE_HEIGHT + lift + (Math.random() - 0.5) * shake, SEAT_R + 0.02 + l.topT * 0.12);
    euler.set(-0.3 - l.topT * 0.32 + l.pitch, l.yaw, 0);
    camera.quaternion.setFromEuler(euler);

    // bakış yönünü diğer oyunculara gönder (avatar başları için)
    const now = state.clock.elapsedTime;
    if (now - l.lastSend > 0.08 && (Math.abs(l.yaw - l.sentYaw) > 0.02 || Math.abs(l.pitch - l.sentPitch) > 0.02)) {
      l.lastSend = now;
      l.sentYaw = l.yaw;
      l.sentPitch = l.pitch;
      socket.volatile.emit('look', { yaw: +l.yaw.toFixed(3), pitch: +l.pitch.toFixed(3) });
    }
  });
  return null;
}

/** Oyun bitince karakterler tepki vermeye devam eder: kazanan sevinir, diğerleri üzülür/kızar */
function EndCelebration() {
  const ended = useApp(s => s.view?.phase === 'ended');
  const winner = useApp(s => s.view?.winner ?? null);
  useEffect(() => {
    if (!ended || !winner) return;
    const losersMoods = ['sad', 'no', 'angry'] as const;
    const timers: number[] = [];
    const tick = () => {
      const st = useApp.getState();
      st.react(winner, Math.random() < 0.6 ? 'dance' : 'laugh');
      seatedPlayers(st.room)
        .filter(s => s.playerId !== winner)
        .forEach((s, i) => {
          timers.push(window.setTimeout(() => useApp.getState().react(s.playerId, losersMoods[Math.floor(Math.random() * losersMoods.length)]), 400 + i * 450));
        });
    };
    const interval = window.setInterval(tick, 5500);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [ended, winner]);
  return null;
}

function Seats() {
  const room = useApp(s => s.room);
  const you = useApp(s => s.playerId);
  const currentId = useApp(s => s.view?.currentPlayerId ?? null);
  const ended = useApp(s => s.view?.phase === 'ended');
  const watchSelf = useApp(s => s.watchSelf);
  const seats = seatedPlayers(room);
  const characters = assignCharacters(room);
  const order = relativeOrder(
    seats.map(s => s.playerId),
    you,
  );
  const n = order.length;
  const currentIdx = currentId ? order.indexOf(currentId) : -1;
  // botlar sırası gelen oyuncuya, kendi sıralarında ise masaya bakar
  const lookTarget = (selfIdx: number) => {
    if (currentIdx < 0) return new THREE.Vector3(0, TABLE_Y, 0);
    if (currentIdx === selfIdx) return new THREE.Vector3(0, TABLE_Y, 0.1);
    return currentIdx === 0 ? new THREE.Vector3(0, EYE_HEIGHT, SEAT_R) : headPos(currentIdx, n).setY(1.5);
  };

  return (
    <>
      {seats.map(seat => {
        const idx = order.indexOf(seat.playerId);
        const f = seatFrame(Math.max(0, idx), n);
        // kendi avatarın oyun sırasında görünmez (birinci şahıs); oyun sonunda kamera dönerken görünür
        const hidden = idx < 0 || (idx === 0 && !ended && !watchSelf);
        if (hidden || !characters[seat.playerId]) return <Chair key={seat.playerId} position={f.pos} quaternion={f.quat} />;
        return (
          <group key={seat.playerId}>
          <Chair position={f.pos} quaternion={f.quat} />
          {/* her karakter ayrı yüklenir: büyük bir model diğerlerini ve odayı bekletmez */}
          <Suspense fallback={null}>
          <Avatar
            key={`${seat.playerId}-${characters[seat.playerId].id}`}
            seat={seat}
            character={characters[seat.playerId]}
            position={f.pos}
            quaternion={f.quat}
            lookAt={lookTarget(idx)}
            isCurrent={!ended && seat.playerId === currentId}
          />
          </Suspense>
          </group>
        );
      })}
    </>
  );
}
