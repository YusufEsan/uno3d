import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { TABLE_R, TABLE_Y } from '../game/layout';
import type { QualityLevel } from '../store/useApp';
import { isOutdoor, type Theme } from './themes';
import { Outdoor } from './environments';
import { Model } from './models';
import { EnvironmentLighting, SurfaceMaterial } from './textures';

/** Masa, tavandan sarkan sallanan lamba ve temaya göre oda dekoru */
export function Room3D({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={theme.fog} />
      <ambientLight color={theme.ambient[0]} intensity={theme.ambient[1]} />
      <hemisphereLight args={theme.hemi} />
      <EnvironmentLighting intensity={theme.envIntensity ?? 0.3} />
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

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
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
            <Model name={theme.fixture === 'lantern' ? 'lanternChandelier' : 'chandelier'} position={[0, -0.22, 0]} scale={0.95} castShadow={false} />
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
        <mesh castShadow>
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

/** Çuha dokusu: ortası aydınlık, kenarı kararan bir ışık yayılımı ve ince kumaş dokusu */
function feltTexture() {
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        {theme.surfaces ? (
          <SurfaceMaterial {...theme.surfaces.floor} repeat={[theme.surfaces.floor.repeat[0] * 1.55, theme.surfaces.floor.repeat[1] * 1.55]} fallback={theme.floor} />
        ) : (
          <meshStandardMaterial color={theme.floor} roughness={theme.props === 'neon' ? 0.25 : 0.85} metalness={theme.props === 'neon' ? 0.4 : 0} />
        )}
      </mesh>
      {/* odanın kutusu zeminin 10 cm altından başlar: taban yüzü zeminle aynı düzlemde kalıp titreşmesin (z-fighting) */}
      <mesh position={[0, 2.45, 0]}>
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

/** Bar: raflarda şarap şişeleri, tezgâh, variller, dart tahtası ve saksı bitkileri (hazır modeller) */
function BarProps({ quality }: { quality: QualityLevel }) {
  // şişe modeli 0.64 m'lik bir sıra: her rafa yan yana dizilir
  const rows = [-2.3, -1.62, -0.94, -0.26, 0.42, 1.1, 1.78];
  return (
    <group position={[0, 0, -3.6]}>
      {[1.3, 1.8].map(y => (
        <mesh key={y} position={[0, y, 0.05]} castShadow receiveShadow>
          <boxGeometry args={[5, 0.04, 0.3]} />
          <SurfaceMaterial tex="wood_floor_worn" repeat={[3, 0.2]} tint="#7a5238" roughness={0.6} fallback="#3a2414" />
        </mesh>
      ))}
      {[1.32, 1.82].flatMap((y, s) => rows.map((x, i) => <Model key={`${s}-${i}`} name="bottles" position={[x + (s ? 0.12 : 0), y, 0.05]} castShadow={false} />))}
      {/* tezgâh ve üstünde gaz lambası */}
      <mesh position={[0, 0.55, 0.9]} castShadow receiveShadow>
        <boxGeometry args={[5, 1.1, 0.6]} />
        <SurfaceMaterial tex="wood_floor_worn" repeat={[3, 0.7]} tint="#6e4630" roughness={0.45} fallback="#3a2414" />
      </mesh>
      <Model name="oilLamp" position={[-1.6, 1.1, 0.9]} scale={0.55} />
      <Model name="oilLamp" position={[1.7, 1.1, 0.85]} scale={0.55} />
      {quality !== 'low' && <pointLight position={[-1.6, 1.45, 1.0]} color="#ffb466" intensity={0.9} distance={2.2} decay={2} />}
      {/* köşelerde variller ve bitkiler; yan duvarda dart tahtası */}
      <Model name="barrel" position={[-3.4, 0, 0.6]} rotation={[0, 0.5, 0]} />
      <Model name="barrel" position={[-3.75, 0, 1.45]} rotation={[0, 1.4, 0]} scale={0.9} />
      <Model name="barrel" position={[3.5, 0, 0.7]} rotation={[0, -0.3, 0]} />
      <Model name="plant" position={[3.7, 0, 5.9]} rotation={[0, 2.2, 0]} scale={1.3} />
      <Model name="plant" position={[-3.75, 0, 6.6]} rotation={[0, 0.6, 0]} scale={1.15} />
      <Model name="dartboard" position={[-4.48, 1.65, 3.6]} rotation={[0, Math.PI / 2, 0]} />
      <Model name="crate" position={[3.6, 0, 2.6]} rotation={[0, 0.25, 0]} />
      <Model name="crate" position={[3.62, 0.34, 2.62]} rotation={[0, -0.2, 0]} scale={0.85} />
      {/* duvardaki sıcak aplikler */}
      {[-2.6, 2.6].map(x => (
        <group key={x} position={[x, 2.3, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#ffb466" emissive="#ffb466" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          {quality !== 'low' && <pointLight color="#ff9a4a" intensity={2.4} distance={5} decay={2} />}
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
      <Model name="sofa" position={[0, 0, -3.95]} scale={1.15} />
      <Model name="armchair" position={[-2.1, 0, -3.7]} rotation={[0, 0.5, 0]} />
      <Model name="armchair" position={[2.1, 0, -3.7]} rotation={[0, -0.5, 0]} />
      <Model name="plant" position={[-3.6, 0, -3.8]} scale={1.2} />
      <Model name="plant" position={[3.6, 0, -3.8]} rotation={[0, 1.8, 0]} scale={1.2} />
      <Model name="plant" position={[3.8, 0, 3.6]} rotation={[0, 3, 0]} scale={1.1} />
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
