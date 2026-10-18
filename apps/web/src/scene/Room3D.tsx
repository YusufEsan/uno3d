import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { TABLE_R, TABLE_Y } from '../game/layout';
import type { QualityLevel } from '../store/useApp';
import { isOutdoor, type Theme } from './themes';
import { Outdoor } from './environments';
import { MODELS, Model, type ModelName } from './models';
import { EnvironmentLighting, SurfaceMaterial } from './textures';

/** Masa, tavandan sarkan sallanan lamba ve temaya göre oda dekoru */
export function Room3D({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={theme.fog} />
      <ambientLight color={theme.ambient[0]} intensity={theme.ambient[1]} />
      <hemisphereLight args={theme.hemi} />
      <EnvironmentLighting intensity={theme.envIntensity ?? 0.3} sky={theme.skyMap} />
      <Table theme={theme} />
      {isOutdoor(theme) ? (
        <Outdoor theme={theme} quality={quality} />
      ) : (
        <>
          <HangingLamp theme={theme} quality={quality} />
          {/* gölgesiz dolgu: masaya dönük karakterlerin yüzleri karanlıkta kalmaz */}
          <directionalLight position={[0, 3.5, 4]} color={theme.lamp.color} intensity={0.45} />
          <RoomShell theme={theme} />
          {theme.props === 'bar' ? <BarProps quality={quality} /> : <NeonProps quality={quality} />}
        </>
      )}
      {quality !== 'low' && !isOutdoor(theme) && <Sparkles count={quality === 'high' ? 70 : 30} scale={[3.2, 1.8, 3.2]} position={[0, 1.7, 0]} size={2.2} speed={0.15} opacity={0.35} color={theme.dust} />}
    </>
  );
}

/** ortadaki yığın parlamasın diye tema ışığı biraz kısılır */
const LAMP_DIM = 0.8;

function HangingLamp({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const pivot = useRef<THREE.Group>(null);
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, TABLE_Y, 0);
    return o;
  }, []);

  const frame = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // orta kalitede gölge haritası iki karede bir çizilir (ışık sabit; yalnızca karakterler ve kartlar oynar)
    const l = light.current;
    if (l) {
      l.shadow.autoUpdate = quality === 'high';
      if (quality !== 'high') l.shadow.needsUpdate = frame.current++ % 2 === 0;
    }
    if (pivot.current) {
      pivot.current.rotation.z = Math.sin(t * 0.9) * theme.lamp.swing;
      pivot.current.rotation.x = Math.sin(t * 0.63 + 1) * theme.lamp.swing * 0.6;
    }
    // hafif titreşen ampul
    if (light.current) light.current.intensity = theme.lamp.intensity * LAMP_DIM * (0.96 + Math.sin(t * 13) * 0.015 + Math.sin(t * 7.3) * 0.015);
  });

  return (
    <group position={[0, 3.2, 0]}>
      {/* ışık hedefi biraz öne alınır: ortadaki yığının yüzeyi doğrudan parlamasın */}
      <primitive object={target} position={[0, TABLE_Y - 3.2, 0.35]} />
      <group ref={pivot}>
        {theme.fixture === 'lantern' || theme.fixture === 'chandelier' ? (
          <>
            <mesh position={[0, -0.12, 0]}>
              <cylinderGeometry args={[0.008, 0.008, 0.24, 6]} />
              <meshStandardMaterial color="#111" />
            </mesh>
            {/* hazır avize modeli: tavandan sarkar, altı ~2.2 m'de biter */}
            <GlassModel name={theme.fixture === 'lantern' ? 'lanternChandelier' : 'chandelier'} position={[0, -0.22, 0]} scale={0.95} />
            <mesh position={[0, -0.75, 0]}>
              <sphereGeometry args={[0.05, 12, 12]} />
              <meshStandardMaterial color={theme.lamp.color} emissive={theme.lamp.color} emissiveIntensity={4} toneMapped={false} />
            </mesh>
          </>
        ) : (
          <ShadeLamp theme={theme} />
        )}
      </group>
      {/* ışık sallanan lambanın dışında sabit durur: masanın gölgesi ve yerdeki ışık havuzu kaymaz */}
      <group position={[0, -0.95, 0]}>
        {/* geniş koni: masanın yanında oturan karakterlerin yüzü de aydınlanır, kenara doğru yumuşakça söner */}
        <spotLight
          ref={light}
          position={[0, -0.05, 0]}
          target={target}
          color={theme.lamp.color}
          intensity={theme.lamp.intensity * LAMP_DIM}
          angle={1.08}
          penumbra={0.75}
          distance={6}
          decay={1.6}
          castShadow={quality !== 'low'}
          shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        />
        {quality === 'high' && <pointLight color={theme.lamp.color} intensity={1.4} distance={3} decay={2} position={[0, 0.1, 0]} />}
        {/* avizenin kendi parıltısı: tavanı ve duvarları da hafifçe aydınlatır */}
        {quality !== 'low' && theme.fixture && theme.fixture !== 'shade' && (
          <pointLight color={theme.lamp.color} intensity={3.2} distance={8} decay={1.6} position={[0, 0.35, 0]} />
        )}
      </group>
    </group>
  );
}

/** sade metal abajur (neon ve deniz temaları) */
function ShadeLamp({ theme }: { theme: Theme }) {
  return (
    <>
      <mesh position={[0, -0.47, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.95, 6]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <group position={[0, -0.95, 0]}>
        {/* gölge kamerasının yakın düzleminin (0.5 m) içinde kalıyor: gölge düşürmesi boşa çizimdi */}
        <mesh>
          <coneGeometry args={[0.3, 0.22, 32, 1, true]} />
          <meshStandardMaterial color="#1d1d1d" side={THREE.DoubleSide} metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.06, 0]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color={theme.lamp.color} emissive={theme.lamp.color} emissiveIntensity={4} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

/** Çuha dokusu: ortası aydınlık, kenarı kararan bir ışık yayılımı ve ince kumaş dokusu (bir kez üretilir) */
let feltCache: THREE.CanvasTexture | null = null;
function feltTexture() {
  if (feltCache) return feltCache;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(256, 256, 30, 256, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.02)');
  grd.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  feltCache = t;
  return t;
}

/** masa modeli 1.4 m çaplı, 1.0 m yüksek: çuhadan biraz geniş ve tablası çuhanın 8 mm altında kalacak şekilde ölçeklenir */
const TABLE_MODEL = { r: (TABLE_R + 0.05) / 0.7, y: (TABLE_Y - 0.008) / 1.0037 };

function Table({ theme }: { theme: Theme }) {
  const felt = useMemo(() => feltTexture(), []);
  return (
    <group>
      {/* çuha */}
      <mesh position={[0, TABLE_Y - 0.004, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.008, 96]} />
        {/* kadife kabartması (Poly Haven, CC0): ışık açısıyla çuha dokusu belirir */}
        <SurfaceMaterial tex="velour_velvet" colorMap={false} baseMap={felt} repeat={[5, 5]} normalScale={0.55} tint={theme.felt} roughness={0.92} fallback={theme.felt} />
      </mesh>
      {/* masanın içine işlenmiş ince aydınlık çizgi */}
      <mesh position={[0, TABLE_Y + 0.0045, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_R - 0.12, 0.003, 8, 128]} />
        <meshStandardMaterial color={theme.rim} emissive={theme.rim} emissiveIntensity={0.5} roughness={0.4} />
      </mesh>
      {/* ahşap kenar */}
      <mesh position={[0, TABLE_Y + 0.004, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[TABLE_R + 0.03, 0.022, 16, 128]} />
        <meshStandardMaterial color={theme.rim} roughness={0.5} emissive={theme.props === 'neon' ? theme.rim : '#000'} emissiveIntensity={theme.props === 'neon' ? 0.8 : 0} />
      </mesh>
      {/* ahşap gövde: hazır model (Poly Haven, CC0), çuhanın hemen altında biter; yüklenene kadar basit gövde */}
      <Model
        name="table"
        scale={[TABLE_MODEL.r, TABLE_MODEL.y, TABLE_MODEL.r]}
        fallback={
          <group>
            <mesh position={[0, TABLE_Y - 0.05, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[TABLE_R + 0.06, TABLE_R + 0.02, 0.08, 96]} />
              <meshStandardMaterial color={theme.wood} roughness={0.6} />
            </mesh>
            <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.12, TABLE_Y - 0.1, 24]} />
              <meshStandardMaterial color={theme.wood} roughness={0.6} />
            </mesh>
          </group>
        }
      />
    </group>
  );
}

function RoomShell({ theme }: { theme: Theme }) {
  return (
    <group>
      {/* zemin ve duvarlar en son çizilir: önlerindeki masa, karakter ve dekorun arkasında kalan pikseller
          derinlik testinde elenir. Kamera kutunun içinde olduğundan kutu önce çizilirse bütün ekranı bir kez boşa gölgelerdi */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow renderOrder={1}>
        <planeGeometry args={[14, 14]} />
        {theme.surfaces ? (
          <SurfaceMaterial {...theme.surfaces.floor} repeat={[theme.surfaces.floor.repeat[0] * 1.55, theme.surfaces.floor.repeat[1] * 1.55]} fallback={theme.floor} />
        ) : (
          <meshStandardMaterial color={theme.floor} roughness={theme.props === 'neon' ? 0.25 : 0.85} metalness={theme.props === 'neon' ? 0.4 : 0} />
        )}
      </mesh>
      {/* odanın kutusu zeminin 10 cm altından başlar: taban yüzü zeminle aynı düzlemde kalıp titreşmesin (z-fighting) */}
      <mesh position={[0, 2.45, 0]} renderOrder={2}>
        <boxGeometry args={[9, 5.1, 9]} />
        {theme.surfaces ? (
          <SurfaceMaterial {...theme.surfaces.wall} side={THREE.BackSide} fallback={theme.wall} />
        ) : (
          <meshStandardMaterial color={theme.wall} side={THREE.BackSide} roughness={0.95} />
        )}
      </mesh>
    </group>
  );
}

/*
 * Dekor ışık konisinin (≈62°) dışında kalır: gölgeleri görünmezdi ama gölge haritasına her karede çiziliyordu.
 * Bu yüzden dekor gölge düşürmez; yalnızca masa, sandalyeler, karakterler ve kartlar düşürür.
 */

/** şişe modeli 0.64 m'lik bir sıra: her rafa yan yana dizilir (BarProps grubuna göre konumlar) */
const BOTTLE_POS: [number, number, number][] = [1.32, 1.82].flatMap((y, s) =>
  [-2.3, -1.62, -0.94, -0.26, 0.42, 1.1, 1.78].map(x => [x + (s ? 0.12 : 0), y, 0.05] as [number, number, number]),
);

/**
 * glTF camları (şişe, fener) "transmission" kullanır: three bunun için her karede bütün sahneyi bir kez daha
 * çizer. Çift yüzlü saydam malzemeler de her karede iki kez çizilip derleme denetiminden geçer. Yerlerine
 * görünüşü çok yakın, ucuz kopyalar kullanılır (önbellekteki modelin kendi malzemeleri değişmez).
 */
const cheapMats = new WeakMap<THREE.Material, THREE.Material>();
function cheapGlass(src: THREE.Material): THREE.Material {
  let m = cheapMats.get(src);
  if (m) return m;
  const p = src as THREE.MeshPhysicalMaterial;
  const transmissive = !!p.isMeshPhysicalMaterial && p.transmission > 0;
  if (transmissive || (src.transparent && src.side === THREE.DoubleSide)) {
    const c = src.clone() as THREE.MeshPhysicalMaterial;
    if (transmissive) {
      c.transmission = 0;
      c.transmissionMap = null;
      if (c.map) {
        // renkli cam: yarı saydam, arkasındaki şarap görünür
        c.transparent = true;
        c.opacity = Math.min(c.opacity, 0.55);
        c.depthWrite = false;
      } else {
        // şarap / renkli şişe gövdesi: ışığı geçirmek yerine koyu, parlak ve opak
        c.color.multiplyScalar(0.45);
      }
    }
    if (c.transparent && c.side === THREE.DoubleSide) c.forceSinglePass = true;
    m = c;
  } else m = src;
  cheapMats.set(src, m);
  return m;
}

type GlassModelProps = { name: ModelName; position?: [number, number, number]; scale?: number };

/** Model gibi, ama cam malzemeleri ucuz kopyalarla değiştirilir; gölge düşürmez */
function GlassModelInner({ name, ...rest }: GlassModelProps) {
  const { scene } = useGLTF(MODELS[name]);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(cheapGlass) : cheapGlass(m.material);
      m.castShadow = false;
      m.receiveShadow = true;
    });
    return c;
  }, [scene]);
  return <primitive object={obj} {...rest} />;
}

function GlassModel(props: GlassModelProps) {
  return (
    <Suspense fallback={null}>
      <GlassModelInner {...props} />
    </Suspense>
  );
}

/** Raflardaki 14 şişe: her parça tek çizimle (instancing); önceden ~126 ayrı çizim ve her karede ek sahne geçişiydi */
function Bottles() {
  const { scene } = useGLTF(MODELS.bottles);
  const meshes = useMemo(() => {
    scene.updateMatrixWorld(true);
    const tmp = new THREE.Matrix4();
    const out: THREE.InstancedMesh[] = [];
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material.map(cheapGlass) : cheapGlass(m.material);
      const im = new THREE.InstancedMesh(m.geometry, mat, BOTTLE_POS.length);
      BOTTLE_POS.forEach((p, i) => im.setMatrixAt(i, tmp.makeTranslation(p[0], p[1], p[2]).multiply(m.matrixWorld)));
      // ışık konisinin dışında: gölge ne düşürür ne alır
      im.castShadow = im.receiveShadow = false;
      im.computeBoundingSphere();
      out.push(im);
    });
    return out;
  }, [scene]);
  // geometri ve malzeme önbellekteki modele ait: yalnızca kopya tamponları bırakılır
  useEffect(() => () => meshes.forEach(m => m.dispose()), [meshes]);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

/** Yumuşak ışık lekesi dokusu (bir kez üretilir) */
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * Sahte ışık: duvarı kendi rengiyle orantılı aydınlatır (hedef × (1 + renk)). Orta ve düşük kalitede aplik
 * nokta ışıklarının yerine geçer: her malzemenin her pikselinde ışık hesabı yerine tek küçük yüzey.
 */
function GlowDecal({ color, size, position }: { color: string; size: number; position: [number, number, number] }) {
  const map = useMemo(() => glowTexture(), []);
  return (
    <mesh position={position}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        map={map}
        color={color}
        transparent
        depthWrite={false}
        fog={false}
        toneMapped={false}
        blending={THREE.CustomBlending}
        blendEquation={THREE.AddEquation}
        blendSrc={THREE.DstColorFactor}
        blendDst={THREE.OneFactor}
      />
    </mesh>
  );
}

/** Bar: raflarda şarap şişeleri, tezgâh, variller, dart tahtası ve saksı bitkileri (hazır modeller) */
function BarProps({ quality }: { quality: QualityLevel }) {
  return (
    <group position={[0, 0, -3.6]}>
      {[1.3, 1.8].map(y => (
        <mesh key={y} position={[0, y, 0.05]} receiveShadow>
          <boxGeometry args={[5, 0.04, 0.3]} />
          <SurfaceMaterial tex="wood_floor_worn" repeat={[3, 0.2]} tint="#7a5238" roughness={0.6} fallback="#3a2414" />
        </mesh>
      ))}
      <Suspense fallback={null}>
        <Bottles />
      </Suspense>
      {/* tezgâh ve üstünde gaz lambası */}
      <mesh position={[0, 0.55, 0.9]} receiveShadow>
        <boxGeometry args={[5, 1.1, 0.6]} />
        <SurfaceMaterial tex="wood_floor_worn" repeat={[3, 0.7]} tint="#6e4630" roughness={0.45} fallback="#3a2414" />
      </mesh>
      <GlassModel name="oilLamp" position={[-1.6, 1.1, 0.9]} scale={0.55} />
      <GlassModel name="oilLamp" position={[1.7, 1.1, 0.85]} scale={0.55} />
      {quality === 'high' && <pointLight position={[-1.6, 1.45, 1.0]} color="#ffb466" intensity={0.9} distance={2.2} decay={2} />}
      {/* köşelerde variller ve bitkiler; yan duvarda dart tahtası */}
      <Model name="barrel" position={[-3.4, 0, 0.6]} rotation={[0, 0.5, 0]} castShadow={false} />
      <Model name="barrel" position={[-3.75, 0, 1.45]} rotation={[0, 1.4, 0]} scale={0.9} castShadow={false} />
      <Model name="barrel" position={[3.5, 0, 0.7]} rotation={[0, -0.3, 0]} castShadow={false} />
      <Model name="plant" position={[3.7, 0, 5.9]} rotation={[0, 2.2, 0]} scale={1.3} castShadow={false} />
      <Model name="plant" position={[-3.75, 0, 6.6]} rotation={[0, 0.6, 0]} scale={1.15} castShadow={false} />
      <Model name="dartboard" position={[-4.48, 1.65, 3.6]} rotation={[0, Math.PI / 2, 0]} castShadow={false} />
      <Model name="crate" position={[3.6, 0, 2.6]} rotation={[0, 0.25, 0]} castShadow={false} />
      <Model name="crate" position={[3.62, 0.34, 2.62]} rotation={[0, -0.2, 0]} scale={0.85} castShadow={false} />
      {/* duvardaki sıcak aplikler: yüksek kalitede gerçek ışık, diğerlerinde arka duvarda sahte ışık lekesi */}
      {[-2.6, 2.6].map(x => (
        <group key={x} position={[x, 2.3, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#ffb466" emissive="#ffb466" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          {quality === 'high' ? (
            <pointLight color="#ff9a4a" intensity={2.4} distance={5} decay={2} />
          ) : (
            // arka duvar dünyada z -4.5'te: bu grubun 1 m gerisi; leke 1 cm önünde durur
            <GlowDecal color="#ff9a4a" size={3} position={[0, 0, -0.99]} />
          )}
        </group>
      ))}
    </group>
  );
}

function NeonProps({ quality }: { quality: QualityLevel }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) (ring.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 + Math.sin(clock.elapsedTime * 2) * 0.8;
  });
  return (
    <group>
      {/* arka duvarda dinlenme köşesi: kanepe, koltuklar ve bitkiler */}
      <Model name="sofa" position={[0, 0, -3.95]} scale={1.15} castShadow={false} />
      <Model name="armchair" position={[-2.1, 0, -3.7]} rotation={[0, 0.5, 0]} castShadow={false} />
      <Model name="armchair" position={[2.1, 0, -3.7]} rotation={[0, -0.5, 0]} castShadow={false} />
      <Model name="plant" position={[-3.6, 0, -3.8]} scale={1.2} castShadow={false} />
      <Model name="plant" position={[3.6, 0, -3.8]} rotation={[0, 1.8, 0]} scale={1.2} castShadow={false} />
      <Model name="plant" position={[3.8, 0, 3.6]} rotation={[0, 3, 0]} scale={1.1} castShadow={false} />
      <mesh ref={ring} position={[0, 2.3, -3.9]}>
        <torusGeometry args={[0.7, 0.03, 12, 64]} />
        <meshStandardMaterial color="#ff3dc8" emissive="#ff3dc8" emissiveIntensity={3} toneMapped={false} />
      </mesh>
      {[
        { p: [-3.9, 1.6, -1] as const, r: [0, Math.PI / 2, 0] as const, c: '#3df2ff' },
        { p: [3.9, 1.6, -1] as const, r: [0, -Math.PI / 2, 0] as const, c: '#7cff4d' },
      ].map((n, i) => (
        <mesh key={i} position={n.p} rotation={n.r}>
          <boxGeometry args={[2.2, 0.04, 0.04]} />
          <meshStandardMaterial color={n.c} emissive={n.c} emissiveIntensity={3} toneMapped={false} />
        </mesh>
      ))}
      {quality !== 'low' && <pointLight position={[0, 2.2, -3.4]} color="#ff3dc8" intensity={2.5} distance={5} decay={2} />}
      {quality === 'high' && (
        <>
          <pointLight position={[-3.4, 1.6, -1]} color="#3df2ff" intensity={1.8} distance={4} decay={2} />
          <pointLight position={[3.4, 1.6, -1]} color="#7cff4d" intensity={1.5} distance={4} decay={2} />
        </>
      )}
    </group>
  );
}
