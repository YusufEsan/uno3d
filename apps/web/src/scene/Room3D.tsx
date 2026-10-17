import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { TABLE_R, TABLE_Y } from '../game/layout';
import type { QualityLevel } from '../store/useApp';
import type { Theme } from './themes';

/** Masa, tavandan sarkan sallanan lamba ve temaya göre oda dekoru */
export function Room3D({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={theme.fog} />
      <ambientLight color={theme.ambient[0]} intensity={theme.ambient[1]} />
      <hemisphereLight args={theme.hemi} />
      <HangingLamp theme={theme} quality={quality} />
      <Table theme={theme} />
      <RoomShell theme={theme} />
      {theme.props === 'bar' ? <BarProps quality={quality} /> : <NeonProps quality={quality} />}
      {quality !== 'low' && <Sparkles count={quality === 'high' ? 70 : 30} scale={[3.2, 1.8, 3.2]} position={[0, 1.7, 0]} size={2.2} speed={0.15} opacity={0.35} color={theme.dust} />}
    </>
  );
}

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
    if (light.current) light.current.intensity = theme.lamp.intensity * (0.96 + Math.sin(t * 13) * 0.015 + Math.sin(t * 7.3) * 0.015);
  });

  return (
    <group position={[0, 3.2, 0]}>
      {/* ışık hedefi biraz öne alınır: ortadaki yığının yüzeyi doğrudan parlamasın */}
      <primitive object={target} position={[0, TABLE_Y - 3.2, 0.35]} />
      <group ref={pivot}>
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
          <spotLight
            ref={light}
            position={[0, -0.05, 0]}
            target={target}
            color={theme.lamp.color}
            intensity={theme.lamp.intensity * 0.65}
            angle={0.72}
            penumbra={0.55}
            distance={6}
            decay={1.6}
            castShadow={quality !== 'low'}
            shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
          />
          {quality === 'high' && <pointLight color={theme.lamp.color} intensity={1.4} distance={3} decay={2} position={[0, 0.1, 0]} />}
        </group>
      </group>
    </group>
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
  grd.addColorStop(1, 'rgba(0,0,0,0.5)');
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

function Table({ theme }: { theme: Theme }) {
  const felt = useMemo(() => feltTexture(), []);
  return (
    <group>
      {/* çuha */}
      <mesh position={[0, TABLE_Y - 0.004, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.008, 96]} />
        <meshStandardMaterial color={theme.felt} map={felt} roughness={0.92} metalness={0} />
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
      <mesh position={[0, TABLE_Y - 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R + 0.06, TABLE_R + 0.02, 0.08, 96]} />
        <meshStandardMaterial color={theme.wood} roughness={0.6} />
      </mesh>
      {/* ayak */}
      <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, TABLE_Y - 0.1, 24]} />
        <meshStandardMaterial color={theme.wood} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.45, 0.5, 0.06, 32]} />
        <meshStandardMaterial color={theme.wood} roughness={0.6} />
      </mesh>
    </group>
  );
}

function RoomShell({ theme }: { theme: Theme }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color={theme.floor} roughness={theme.props === 'neon' ? 0.25 : 0.85} metalness={theme.props === 'neon' ? 0.4 : 0} />
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[9, 5, 9]} />
        <meshStandardMaterial color={theme.wall} side={THREE.BackSide} roughness={0.95} />
      </mesh>
    </group>
  );
}

const BOTTLE_COLORS = ['#3d6b2a', '#6b3a1a', '#2a4a6b', '#7a6a2a', '#5a1a2a', '#2a6b5a'];

function BarProps({ quality }: { quality: QualityLevel }) {
  const bottles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        x: -2.2 + i * 0.21 + (Math.random() - 0.5) * 0.05,
        shelf: i % 2,
        h: 0.22 + Math.random() * 0.12,
        color: BOTTLE_COLORS[i % BOTTLE_COLORS.length],
      })),
    [],
  );
  return (
    <group position={[0, 0, -3.6]}>
      {[1.3, 1.8].map(y => (
        <mesh key={y} position={[0, y, 0.05]} castShadow receiveShadow>
          <boxGeometry args={[5, 0.04, 0.3]} />
          <meshStandardMaterial color="#3a2414" roughness={0.7} />
        </mesh>
      ))}
      {bottles.map((b, i) => (
        <mesh key={i} position={[b.x, (b.shelf ? 1.8 : 1.3) + 0.02 + b.h / 2, 0.05]}>
          <cylinderGeometry args={[0.035, 0.04, b.h, 12]} />
          <meshStandardMaterial color={b.color} roughness={0.15} metalness={0.1} transparent opacity={0.85} emissive={b.color} emissiveIntensity={0.25} />
        </mesh>
      ))}
      {/* tezgâh */}
      <mesh position={[0, 0.55, 0.9]} castShadow receiveShadow>
        <boxGeometry args={[5, 1.1, 0.6]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
      {/* duvardaki sıcak aplikler */}
      {[-2.6, 2.6].map(x => (
        <group key={x} position={[x, 2.3, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color="#ffb466" emissive="#ffb466" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          {quality === 'high' && <pointLight color="#ff9a4a" intensity={1.2} distance={3} decay={2} />}
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
