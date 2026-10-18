import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, HueSaturation, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type BloomEffect } from 'postprocessing';
import * as THREE from 'three';
import { director } from '../game/director';
import { EYE_HEIGHT, SEAT_R, TABLE_Y, headPos, relativeOrder, seatFrame } from '../game/layout';
import { sendLook } from '../net/socket';
import { seatedPlayers, useApp, useQuality, type QualityLevel } from '../store/useApp';
import { Avatar } from './Avatar';
import { END_ORBIT, HOME_ORBIT, cameraBounds, clampSegment, orbitRadius } from './cameraBounds';
import { CHARACTERS, assignCharacters } from './characters';
import { useCharacterScene } from './characterModel';
import { Chair } from './Chair';
import { Room3D } from './Room3D';
import { PERF_HOOKS } from './perfHooks';
import { THEMES } from './themes';

// r3f 9.x (son sürüm dahil) kendi saatini hâlâ THREE.Clock ile kuruyor; bizim kodumuz Clock kullanmıyor.
// Yalnızca bu eskime uyarısı susturulur, three'nin diğer mesajları konsola aynen gider.
THREE.setConsoleFunction((type, message, ...params) => {
  if (message.startsWith('THREE.Clock:')) return;
  const trace = params[0] as { isStackTrace?: boolean; getError?: (m: string) => Error } | undefined;
  if (trace?.isStackTrace && trace.getError) console[type](trace.getError(message));
  else console[type](message, ...params);
});

/**
 * Tüm Mixamo karakterlerini görünmez bir köşede bir kez derler (gl.compile). Sahnedeki malzeme
 * ve ışık kombinasyonlarının shader'ları böylece oyun başlamadan hazır olur.
 */
/**
 * three.js bir nesnenin shader'ını ve dokusunu o nesne ekrana ilk girdiğinde hazırlar: kamera dönünce yeni
 * görünen her nesne o karede derlenir ve oyun takılır (yavaş ekran kartlarında saniyelerce). Tema açılınca ve
 * modeller indikçe sahnenin tamamı arka planda derlenir (paralel derleme) ve dokular önceden yüklenir.
 */
const uploaded = new WeakSet<THREE.Texture>();
function SceneWarmup() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const theme = useApp(s => s.room?.theme ?? 'meyhane');
  const quality = useQuality();
  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1), []);
  useEffect(() => () => target.dispose(), [target]);
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (!alive) return;
      scene.traverse(o => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m])
          for (const v of Object.values(mat)) {
            const t = v as THREE.Texture;
            if (t && t.isTexture && t.image && !uploaded.has(t)) {
              uploaded.add(t);
              gl.initTexture(t);
            }
          }
      });
      // efekt zinciri açıkken sahne bir ara hedefe çizilir (doğrusal renk, ton eşleme yok): shader'lar aynı
      // değişkeyle derlensin diye derleme de bir ara hedefle yapılır
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(quality === 'low' ? null : target);
      gl.compileAsync(scene, camera).catch(() => {});
      gl.setRenderTarget(prev);
    };
    // hazır modeller ayrı ayrı iner: birkaç kez tekrarlanır (derlenmiş olanlar atlanır)
    const timers = [250, 1500, 4000, 9000].map(ms => window.setTimeout(run, ms));
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [gl, scene, camera, theme, quality, target]);
  return null;
}

function ShaderWarmup() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const group = useRef<THREE.Group>(null);
  const [done, setDone] = useState(false);
  const quality = useQuality();
  const models = CHARACTERS.filter(c => c.kind === 'mixamo').map(c => useCharacterScene(c.url));
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    // karakter dokuları ekran kartına şimdiden yüklenir: ilk görünüşte takılmasın
    g.traverse(o => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m])
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) gl.initTexture(v as THREE.Texture);
    });
    // efekt zinciri açıkken karakterler ara hedefe çizilir: aynı shader değişkesi derlensin
    const prev = gl.getRenderTarget();
    const rt = new THREE.WebGLRenderTarget(1, 1);
    gl.setRenderTarget(quality === 'low' ? null : rt);
    gl.compileAsync(scene, camera).finally(() => rt.dispose());
    gl.setRenderTarget(prev);
    // derleme bitti: modeller sahneden çıkarılır (r3f primitive'leri dispose etmez, kaynaklar kalır);
    // görünmez olsalar da her karede yüzlerce kemiğin matrisi güncelleniyordu
    g.visible = false;
    setDone(true);
  }, [gl, scene, camera]);
  if (done) return null;
  return (
    <group ref={group} position={[0, -200, 0]}>
      {models.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

export function GameCanvas() {
  const themeId = useApp(s => s.room?.theme ?? 'meyhane');
  const theme = THEMES[themeId];
  const quality = useQuality();
  const viewport = useViewport();
  return (
    <Canvas
      // three r182'den beri PCFSoftShadowMap yok (r3f'nin `shadows` varsayılanı); PCF artık zaten yumuşak örnekliyor
      shadows="percentage"
      // dpr prop olarak verilir: r3f her yeniden çizimde prop'taki değere döner (setDpr ile verilen kaybolurdu)
      dpr={qualityDpr(quality, viewport)}
      camera={{ fov: 58, near: 0.03, far: 60, position: [0, 2, 3] }}
      // ACES renkleri soldurur; "nötr" ton eşleme parlak tonları sıkıştırırken renk doygunluğunu korur.
      // antialias kapalı: yüksek/ortada kenar yumuşatma efekt zincirinin MSAA'sıyla yapılır, tuvalin kendi
      // MSAA tamponu her karede boşuna çözülüyordu. alpha kapalı: tuval opak, tarayıcı sayfayla harmanlamaz.
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping }}
      // shader hata denetimi her derlemede GPU'yu bekletir (derleme paralel yapılamaz, karakterler ve temalar
      // açılırken yüzlerce ms takılma); geliştirmede açık kalır
      onCreated={({ gl }) => {
        gl.debug.checkShaderErrors = import.meta.env.DEV && !(window as unknown as { __perf?: boolean }).__perf;
      }}
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
      {/* karakterlerin shader'ları oyun başlamadan derlenir: ilk görünümde takılma olmasın */}
      <Suspense fallback={null}>
        <ShaderWarmup />
      </Suspense>
      <Seats />
      <SceneWarmup />
      <primitive object={director.root} />
      {/* elindeki kartlar lamba konisinin dışında kalıyor: önlerine yumuşak bir dolgu ışığı */}
      <pointLight position={[0, 1.32, SEAT_R - 0.18]} color="#fff1dc" intensity={0.7} distance={1.1} decay={2} />
      <CameraRig />
      <EndCelebration />
      <DirectorDriver />
      {/* düşük kalitede efekt zinciri yok: renderer doğrudan ekrana çizer ve ton eşlemeyi kendisi yapar */}
      {quality !== 'low' && <PostFx key={quality} quality={quality} bloom={theme.bloom} />}
    </Canvas>
  );
}

/**
 * Efekt zinciri: hepsi tek bir EffectPass'ta birleşir (Bloom + ton eşleme + doygunluk + vinyet).
 * Kalite değişince `key` ile baştan kurulur: eski geçişler ve hedefler tamamen atılır.
 * Kenar yumuşatma MSAA ile: yüksekte 4, ortada 2 örnek. (Eski SMAA zincirin sonunda ham HDR
 * tampondan örnek aldığından kenar piksellerinde ton eşleme ve renk ayarı kayboluyordu.)
 */
function PostFx({ quality, bloom }: { quality: 'high' | 'medium'; bloom: number }) {
  const high = quality === 'high';
  // ortada parlaklık eşiği yarım çözünürlükte çıkarılır: tam çözünürlüklü bir HDR geçişi daha az
  const bloomRef = (e: BloomEffect | null) => {
    if (e) e.luminancePass.resolution.scale = high ? 1 : 0.5;
  };
  return (
    <EffectComposer multisampling={high ? 4 : 2}>
      <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={1.2} intensity={high ? bloom : bloom * 0.8} />
      {/* efekt zinciri renderer'ın ton eşlemesini kapatır: aynısı burada uygulanır */}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <HueSaturation saturation={0.12} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}

/** Kaliteye göre en yüksek piksel oranı */
const DPR_CAP: Record<QualityLevel, number> = { high: 2, medium: 1.25, low: 0.85 };
/** Orta ve düşükte toplam piksel sınırı: 1440p/4K ekranlarda çözünürlük buna göre iner (1080p'de değişmez) */
const PIXEL_BUDGET: Record<QualityLevel, number> = { high: Infinity, medium: 3.0e6, low: 1.5e6 };

function qualityDpr(q: QualityLevel, vp: { px: number; native: number }) {
  const budget = Math.sqrt(PIXEL_BUDGET[q] / Math.max(1, vp.px));
  const dpr = Math.min(DPR_CAP[q], vp.native, budget);
  return Math.max(0.5, Math.round(dpr * 20) / 20);
}

/** Pencerenin CSS piksel sayısı ve cihaz piksel oranı; yalnızca belirgin değişimlerde güncellenir */
function useViewport() {
  const read = () => ({ px: window.innerWidth * window.innerHeight, native: window.devicePixelRatio || 1 });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const onResize = () =>
      setVp(prev => {
        const next = read();
        return next.native !== prev.native || Math.abs(next.px - prev.px) > prev.px * 0.1 ? next : prev;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

const ORDER: QualityLevel[] = ['low', 'medium', 'high'];

/** pencere ortalaması bunun altına düşerse kalite bir kademe iner */
const DOWN_FPS = 45;
/** bunun da altındaysa doğrudan en düşüğe */
const PANIC_FPS = 25;
/** üst kademeye çıkmak için art arda UP_WINDOWS pencere boyunca en az bu kadar */
const UP_FPS = 56;
const UP_WINDOWS = 4;
/** ölçüm penceresi (s) */
const WINDOW = 1.5;
/** kalite değişince shader derlemesi bitsin diye ölçüme ara (s) */
const SETTLE = 2;
/** bundan uzun tek kareler (yükleme, çöp toplama, sekme dönüşü) ortalamaya katılmaz (s) */
const HITCH = 0.25;

/**
 * "Otomatik" kalitede kare hızını izler: düşüş 1,5 s'lik pencerede hemen fark edilir; yükselmek için
 * ~6 s iyi kare hızı gerekir. Kaldıramadığı kademeyi giderek uzayan bir süre (20 s, 60 s, 180 s…) yeniden
 * denemez: iki kademe arasında gidip gelme olmaz.
 */
function AutoQuality() {
  const m = useRef({
    level: null as QualityLevel | null,
    settle: SETTLE,
    time: 0,
    frames: 0,
    good: 0,
    fails: { low: 0, medium: 0, high: 0 } as Record<QualityLevel, number>,
    blockedUntil: { low: 0, medium: 0, high: 0 } as Record<QualityLevel, number>,
  });
  useEffect(() => {
    // sekme arka plandayken tarayıcı kare hızını kısar: dönüşte ölçüm baştan başlar
    const onVisibility = () => {
      const a = m.current;
      a.time = a.frames = a.good = 0;
      a.settle = SETTLE;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useFrame((_, dt) => {
    const s = useApp.getState();
    const a = m.current;
    // elle seçilmiş kalite, gizli sekme ve yükleme ekranı (sahne arkada yükleniyor) ölçülmez
    if (s.quality !== 'auto' || document.hidden || (s.room && !s.assetsReady) || a.level !== s.autoLevel) {
      a.level = s.quality === 'auto' ? s.autoLevel : null;
      a.time = a.frames = a.good = 0;
      a.settle = SETTLE;
      return;
    }
    if (a.settle > 0) {
      a.settle -= dt;
      return;
    }
    if (dt > HITCH) return;
    a.time += dt;
    a.frames++;
    if (a.time < WINDOW) return;
    const fps = a.frames / a.time;
    a.time = a.frames = 0;
    const i = ORDER.indexOf(s.autoLevel);
    const now = performance.now() / 1000;
    if (fps < DOWN_FPS) {
      a.good = 0;
      if (i === 0) return;
      const failed = s.autoLevel;
      a.fails[failed]++;
      a.blockedUntil[failed] = now + Math.min(600, 20 * 3 ** (a.fails[failed] - 1));
      useApp.setState({ autoLevel: fps < PANIC_FPS ? 'low' : ORDER[i - 1] });
      return;
    }
    a.good = fps >= UP_FPS ? a.good + 1 : 0;
    if (a.good >= UP_WINDOWS && i < ORDER.length - 1 && now >= a.blockedUntil[ORDER[i + 1]]) {
      a.good = 0;
      useApp.setState({ autoLevel: ORDER[i + 1] });
    }
  });
  return null;
}

/** Saniyede bir kare hızını arayüze bildirir */
function FpsMeter() {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    if (a.time >= 1) {
      const fps = Math.round(a.frames / a.time);
      // değişmediyse store'a yazma: abonelerin seçicileri boşuna çalışmasın
      if (fps !== useApp.getState().fps) useApp.setState({ fps });
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

/** Gölgeleri kaliteye göre ayarlar (çözünürlük Canvas'ın dpr prop'unda) */
function QualityController() {
  const quality = useQuality();
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const frame = useRef(0);
  useEffect(() => {
    const shadows = quality !== 'low';
    if (gl.shadowMap.enabled !== shadows) {
      gl.shadowMap.enabled = shadows;
      // gölge açılıp kapanınca malzemelerin yeniden derlenmesi gerekir
      scene.traverse(o => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach(x => (x.needsUpdate = true));
      });
    }
    // ortada gölge haritası iki karede bir yenilenir (karakterler ve kartlar her karede ikinci kez çizilmez)
    gl.shadowMap.autoUpdate = quality === 'high';
    gl.shadowMap.needsUpdate = true;
  }, [quality, gl, scene]);
  useFrame(() => {
    if (!gl.shadowMap.autoUpdate && ++frame.current % 2 === 0) gl.shadowMap.needsUpdate = true;
  });
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
  if (import.meta.env.DEV || PERF_HOOKS) Object.assign(window, { __scene: scene, __gl: gl, __app: useApp, __director: director });
  return null;
}

/** fare kartların üstünde bu kadar saniye durunca kamera odaklanır (yavaşlar) */
const FOCUS_DELAY = 0.45;

/** Koltuğundan bakış: fare ekran kenarlarına gidince baş o yöne döner (Liar's Bar tarzı). */
function CameraRig() {
  const camera = useThree(s => s.camera);
  const look = useRef({ yaw: 0, pitch: 0, dwell: 0, focus: 0, orbit: 0, endT: 0, endA: 0, endR: 0, endY: 0, topT: 0, sentYaw: 9, sentPitch: 9, lastSend: 0 });
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const orbit = useMemo(() => ({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), center: new THREE.Vector3(0, 1.0, 0), base: new THREE.Vector3(), want: new THREE.Vector3() }), []);

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
    // kamera engellerin içinden geçmesin: temanın sabit hacimleri ve oturan oyuncular (bkz. cameraBounds)
    const scene = THEMES[st.room?.theme ?? 'meyhane']?.props ?? 'bar';
    const seats = seatedPlayers(st.room).length;
    if (!st.room) {
      // ana ekranda masanın etrafında yavaşça dönen kamera; yarıçap engellerin önünde yumuşakça kısalır
      l.orbit += dt * 0.07;
      const r = orbitRadius(cameraBounds(scene, 0), HOME_ORBIT, l.orbit);
      camera.position.set(Math.sin(l.orbit) * r, HOME_ORBIT.y, Math.cos(l.orbit) * r);
      camera.lookAt(0, 0.95, 0);
      return;
    }

    // oyun sonu: kamera senin arkandan başlayıp masanın etrafında döner, herkesin tepkisi görünür
    // kamera bulunduğu açıdan yörüngeye açılır (yarıçap ve yükseklik ayrı ayrı yaklaşır, düz çizgide kestirmez);
    // yarıçap o açıdaki güvenli sınırı hiç aşmaz
    if (st.view?.phase === 'ended') {
      if (l.endT === 0) {
        l.endA = Math.atan2(camera.position.x, camera.position.z);
        l.endR = Math.hypot(camera.position.x, camera.position.z);
        l.endY = camera.position.y;
      }
      l.endT += dt;
      const a = l.endA + l.endT * 0.22;
      const R = orbitRadius(cameraBounds(scene, seats), END_ORBIT, a);
      l.endR = Math.min(R, l.endR + (R - l.endR) * Math.min(1, dt * 1.5));
      l.endY += (END_ORBIT.y - l.endY) * Math.min(1, dt * 2);
      camera.position.set(Math.sin(a) * l.endR, l.endY, Math.cos(a) * l.endR);
      const k = Math.min(1, dt * 1.5);
      orbit.m.lookAt(camera.position, orbit.center, camera.up);
      orbit.q.setFromRotationMatrix(orbit.m);
      camera.quaternion.slerp(orbit.q, k);
      return;
    }
    l.endT = 0;

    // kendimi izleme: kamera masanın karşı tarafından, biraz yukarıdan kendi koltuğuna bakar: karakter
    // sandalyesiyle birlikte bütün olarak görünür
    if (st.watchSelf) {
      // hedef, masanın ortasının üstünden çizilen doğru boyunca engellerin önünde durur
      orbit.base.set(0, EYE_HEIGHT + 0.3, 0);
      orbit.want.set(0, EYE_HEIGHT + 0.6, -0.55);
      clampSegment(cameraBounds(scene, seats, true), orbit.base, orbit.want, tmpWatchPos);
      camera.position.lerp(tmpWatchPos, Math.min(1, dt * 6));
      camera.lookAt(0, 0.92, SEAT_R);
      return;
    }
    const px = pointerOnCanvas.active ? state.pointer.x : 0;
    const py = pointerOnCanvas.active ? state.pointer.y : 0;
    const dead = (v: number, d: number) => Math.sign(v) * Math.max(0, Math.abs(v) - d) / (1 - d);
    // serbest bakış: fare kenarlara gittikçe baş döner (sıra sende olsa bile); kartlar masada önünde kalır
    // en kenarda ~77°: yandaki oyunculara doğrudan bakılabilir
    // kamera her zaman akıcı döner (küçük ölü bölge); fare kartların üstünde bir süre durursa
    // odak devreye girer ve kamera yavaşlayıp sabitlenir, kartlar ekranda kaymaz. Karttan çıkınca odak bırakılır.
    const yawTarget = -dead(px, 0.08) * 1.35;
    const pitchTarget = Math.max(0, dead(py, 0.15)) * 0.4;
    const overCards = director.hoveringHand || (py < -0.25 && Math.abs(px) < 0.55);
    l.dwell = overCards ? l.dwell + dt : 0;
    const wantFocus = l.dwell > FOCUS_DELAY ? 1 : 0;
    l.focus += (wantFocus - l.focus) * Math.min(1, dt * (wantFocus ? 3 : 10));
    const k = Math.min(1, dt * 3.5) * (1 - l.focus * 0.92);
    l.yaw += (yawTarget - l.yaw) * k;
    l.pitch += (pitchTarget - l.pitch) * k;

    const shake = director.shake;
    director.shake *= Math.pow(0.02, dt);
    // yukarıdan görünüm: kamera yumuşakça yükselir ve masanın ortasına daha dik bakar
    l.topT += ((st.topView ? 1 : 0) - l.topT) * Math.min(1, dt * 4);
    const lift = l.topT * 0.4;
    // yükselme ve sarsıntı koltuktaki göz noktasından başlar; bir engele (otobüs tavanı vb.) değerse orada durur
    orbit.base.set(0, EYE_HEIGHT, SEAT_R + 0.02);
    orbit.want.set((Math.random() - 0.5) * shake, EYE_HEIGHT + lift + (Math.random() - 0.5) * shake, SEAT_R + 0.02 + l.topT * 0.12);
    clampSegment(cameraBounds(scene, seats, true), orbit.base, orbit.want, camera.position);
    euler.set(-0.3 - l.topT * 0.32 + l.pitch, l.yaw, 0);
    camera.quaternion.setFromEuler(euler);

    // bakış yönünü diğer oyunculara gönder (avatar başları için)
    const now = state.clock.elapsedTime;
    if (now - l.lastSend > 0.08 && (Math.abs(l.yaw - l.sentYaw) > 0.02 || Math.abs(l.pitch - l.sentPitch) > 0.02)) {
      l.lastSend = now;
      l.sentYaw = l.yaw;
      l.sentPitch = l.pitch;
      sendLook(l.yaw, l.pitch);
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
  const quality = useQuality();
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

  // sırası gelenin ışığı: tek ve hep sahnede duran bir ışık koltuğa taşınır, gerekmediğinde sönük kalır.
  // Işık sayısı değişirse three.js bütün malzemelerin shader'ını yeniden derler (saniyelerce donma)
  const turnLight = currentIdx > 0 && !ended ? seatFrame(currentIdx, n) : null;
  const turnPos = turnLight ? new THREE.Vector3(0, 1.3, 0.65).applyQuaternion(turnLight.quat).add(turnLight.pos) : new THREE.Vector3(0, 1.3, 0);

  return (
    <>
      <pointLight position={turnPos} color="#fff3d6" intensity={turnLight && quality === 'high' ? 1.6 : 0} distance={1.7} decay={2} />
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
