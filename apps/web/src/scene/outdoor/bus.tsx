import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel } from '../../store/useApp';
import type { Theme } from '../themes';
import { SurfaceMaterial } from '../textures';
import { City } from './city';
import { SkyDome, Sun, canvasTexture } from './common';

/**
 * Otobüs yolculuğu: geniş bir parti otobüsünün içi. Önde şoför mahalli (gösterge paneli, direksiyon,
 * kayan LED hat tabelası), sağ önde katlanır kapı, önde ve arkada koltuk sıraları, sarı tutunma
 * direkleri, tavanda tutunma halkaları ve klima kanalları, pencere üstünde reklam panoları, perdeler.
 * Dışarıda şehir akar (city.tsx). Otobüs -x yönüne gider; şoför solda (+z), kapı sağda (-z).
 */
export const BUS = { len: 11, halfW: 2.3, h: 2.75, sill: 0.62, glassTop: 2.3 };
const SPEED = 9;

const pillars = Array.from({ length: 7 }, (_, i) => -BUS.len / 2 + (i * BUS.len) / 6);

export function BusEnv({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  const world = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // yol titreşimi ve hafif yalpa: dışarısı oynar, otobüsün içi ve masa sabit kalır
    if (world.current) {
      world.current.position.y = Math.sin(t * 11) * 0.004 + Math.sin(t * 1.7) * 0.012 + Math.max(0, Math.sin(t * 0.37)) ** 12 * 0.03;
      world.current.rotation.x = Math.sin(t * 0.8) * 0.0025;
    }
  });
  return (
    <group>
      <SkyDome theme={theme} />
      <Sun theme={theme} quality={quality} />
      <group ref={world}>
        <City speed={SPEED} quality={quality} />
      </group>
      <Shell quality={quality} />
      <Cockpit />
      <FrontDoor />
      <Seats />
      <Fittings quality={quality} />
    </group>
  );
}

const glassMat = new THREE.MeshStandardMaterial({ color: '#cfe6f5', transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0.2, depthWrite: false });
const rubber = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.7 });
const panel = new THREE.MeshStandardMaterial({ color: '#e8e1d2', roughness: 0.6 });
const chrome = new THREE.MeshStandardMaterial({ color: '#d0d4d8', metalness: 0.85, roughness: 0.22 });
const yellow = new THREE.MeshStandardMaterial({ color: '#f2b632', metalness: 0.3, roughness: 0.4 });

/** gövde: zemin, alt paneller, camlar ve çerçeveleri, tavan, perdeler, ön ve arka cam */
function Shell({ quality }: { quality: QualityLevel }) {
  const curtainGeo = useMemo(() => {
    // toplanmış perde: dalgalı kesitli, ortasından bağlı (kemer)
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const y = i / 16;
      const tie = 1 - 0.55 * Math.exp(-((y - 0.42) ** 2) / 0.004);
      pts.push(new THREE.Vector2(0.11 * tie * (0.85 + 0.3 * Math.sin(y * Math.PI)), y * 1.45));
    }
    const g = new THREE.LatheGeometry(pts, 14);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + Math.sin(a * 7) * 0.12;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k * 0.6);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => curtainGeo.dispose(), [curtainGeo]);
  const ads = useMemo(() => adPanels(), []);
  useEffect(
    () => () => {
      ads.geo.dispose();
      ads.mat.map?.dispose();
      ads.mat.dispose();
    },
    [ads],
  );
  const glassH = BUS.glassTop - BUS.sill;

  return (
    <group>
      {/* zemin: kauçuk kaplama, ortada sarı çizgi */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[BUS.len, 0.1, BUS.halfW * 2]} />
        <SurfaceMaterial tex="rubber_tiles" repeat={[5.5, 2.3]} tint="#9aa4b4" roughness={0.85} fallback="#3b4450" />
      </mesh>
      {[-1, 1].map(side => (
        <group key={side}>
          {/* alt panel, kalorifer kanalı ve pencere pervazı */}
          <mesh position={[0, BUS.sill / 2, side * BUS.halfW]} receiveShadow material={panel}>
            <boxGeometry args={[BUS.len, BUS.sill, 0.08]} />
          </mesh>
          <mesh position={[0, 0.12, side * (BUS.halfW - 0.1)]}>
            <boxGeometry args={[BUS.len - 0.2, 0.2, 0.12]} />
            <meshStandardMaterial color="#9da3aa" metalness={0.5} roughness={0.45} />
          </mesh>
          <mesh position={[0, BUS.sill + 0.02, side * (BUS.halfW - 0.05)]}>
            <boxGeometry args={[BUS.len, 0.05, 0.16]} />
            <meshStandardMaterial color="#c0392b" roughness={0.5} />
          </mesh>
          {/* cam ve kauçuk çerçeveler: alt, üst ve sürgülü üst pencerenin çizgisi */}
          <mesh position={[0, BUS.sill + glassH / 2, side * BUS.halfW]} material={glassMat} renderOrder={3}>
            <planeGeometry args={[BUS.len, glassH]} />
          </mesh>
          {[BUS.sill + 0.04, BUS.glassTop - 0.03, BUS.glassTop - 0.42].map(y => (
            <mesh key={y} position={[0, y, side * BUS.halfW]} material={rubber}>
              <boxGeometry args={[BUS.len, y > BUS.glassTop - 0.1 || y < BUS.sill + 0.1 ? 0.06 : 0.03, 0.06]} />
            </mesh>
          ))}
          {/* üst duvar: pencere ile tavan arası */}
          <mesh position={[0, (BUS.glassTop + BUS.h) / 2, side * BUS.halfW]} material={panel}>
            <boxGeometry args={[BUS.len, BUS.h - BUS.glassTop, 0.08]} />
          </mesh>
          {pillars.map((x, i) => (
            <group key={x}>
              <mesh position={[x, (BUS.sill + BUS.glassTop) / 2, side * BUS.halfW]} material={panel}>
                <boxGeometry args={[0.09, glassH, 0.1]} />
              </mesh>
              {/* sürgülü pencerelerin dikey ayrımı */}
              {i < pillars.length - 1 && (
                <mesh position={[x + BUS.len / 12, BUS.glassTop - 0.22, side * BUS.halfW]} material={rubber}>
                  <boxGeometry args={[0.03, 0.4, 0.05]} />
                </mesh>
              )}
              {/* toplanmış perdeler (uçlarda yok) */}
              {i > 0 && i < pillars.length - 1 && (
                <mesh geometry={curtainGeo} position={[x, BUS.glassTop - 1.48, side * (BUS.halfW - 0.1)]}>
                  <meshStandardMaterial color="#8c2f39" roughness={0.9} />
                </mesh>
              )}
            </group>
          ))}
          {/* tavanda klima kanalı ve menfezler */}
          <mesh position={[0, BUS.h - 0.13, side * (BUS.halfW - 0.3)]}>
            <boxGeometry args={[BUS.len - 0.3, 0.2, 0.5]} />
            <meshStandardMaterial color="#d9d3c6" roughness={0.6} />
          </mesh>
          {pillars.slice(0, -1).map(x => (
            <mesh key={`v${x}`} position={[x + BUS.len / 12, BUS.h - 0.235, side * (BUS.halfW - 0.36)]}>
              <boxGeometry args={[0.32, 0.015, 0.16]} />
              <meshStandardMaterial color="#555b63" roughness={0.6} />
            </mesh>
          ))}
          {/* tavan ışık şeridi */}
          <mesh position={[0, BUS.h - 0.07, side * 1.15]}>
            <boxGeometry args={[BUS.len - 1, 0.03, 0.12]} />
            <meshBasicMaterial color={new THREE.Color('#fff4dc').multiplyScalar(1.6)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh geometry={ads.geo} material={ads.mat} />
      {/* tavan */}
      <mesh position={[0, BUS.h, 0]}>
        <boxGeometry args={[BUS.len + 0.1, 0.1, BUS.halfW * 2 + 0.1]} />
        <meshStandardMaterial color="#fbf8f2" roughness={0.8} emissive="#fff8ee" emissiveIntensity={0.25} />
      </mesh>
      {quality !== 'low' && <pointLight position={[0, 2.2, 0]} color="#fff4dc" intensity={2.2} distance={6} decay={2} />}
      {/* arka cam ve acil çıkış işareti */}
      <mesh position={[BUS.len / 2, BUS.sill / 2, 0]} material={panel}>
        <boxGeometry args={[0.08, BUS.sill, BUS.halfW * 2]} />
      </mesh>
      <mesh position={[BUS.len / 2, (BUS.sill + BUS.glassTop) / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={glassMat} renderOrder={3}>
        <planeGeometry args={[BUS.halfW * 2, glassH]} />
      </mesh>
      <mesh position={[BUS.len / 2, (BUS.glassTop + BUS.h) / 2, 0]} material={panel}>
        <boxGeometry args={[0.08, BUS.h - BUS.glassTop, BUS.halfW * 2]} />
      </mesh>
      <mesh position={[BUS.len / 2 - 0.05, BUS.glassTop + 0.18, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.7, 0.16]} />
        <meshBasicMaterial color={new THREE.Color('#2ecc71').multiplyScalar(1.5)} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** pencere üstündeki reklam panoları: tek doku atlası, tek çizim */
function adPanels() {
  const ADS = [
    { bg: '#e5322d', fg: '#f5c400', title: 'UNO!', sub: 'Son kartta bağırmayı unutma' },
    { bg: '#1f5f99', fg: '#ffffff', title: 'GAZOZ', sub: 'Buz gibi • 10 ₺' },
    { bg: '#f5c400', fg: '#2b2b2b', title: 'KART TURNUVASI', sub: 'Her cuma 20.00' },
    { bg: '#2e8b57', fg: '#ffffff', title: 'SİMİT', sub: 'Taze, çıtır • 15 ₺' },
    { bg: '#8e44ad', fg: '#ffffff', title: '+4 KADAR', sub: 'İndirim fırsatı' },
    { bg: '#2c3e50', fg: '#f5c400', title: 'HAT 42', sub: 'Kadıköy — Taksim' },
  ];
  const tex = canvasTexture(512, 512, g => {
    const row = 512 / ADS.length;
    ADS.forEach((a, i) => {
      const y = i * row;
      g.fillStyle = a.bg;
      g.fillRect(0, y, 512, row);
      g.fillStyle = a.fg;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(row * 0.42)}px Rubik, Arial, sans-serif`;
      g.fillText(a.title, 18, y + row * 0.38);
      g.font = `600 ${Math.round(row * 0.22)}px Rubik, Arial, sans-serif`;
      g.fillText(a.sub, 20, y + row * 0.75);
    });
  });
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let k = 0;
  const y0 = BUS.glassTop + 0.05;
  const y1 = BUS.h - 0.27;
  for (const side of [-1, 1])
    for (let i = 0; i < pillars.length - 1; i++) {
      const xa = pillars[i] + 0.12;
      const xb = pillars[i + 1] - 0.12;
      const z = side * (BUS.halfW - 0.045);
      // içeriden okunur: sağ duvarda (-z) panel +z'ye, sol duvarda -z'ye bakar
      const [l, r] = side < 0 ? [xa, xb] : [xb, xa];
      const b = pos.length / 3;
      pos.push(l, y0, z, r, y0, z, r, y1, z, l, y1, z);
      const ad = k++ % ADS.length;
      const v1 = 1 - ad / ADS.length;
      const v0 = v1 - 1 / ADS.length;
      uv.push(0, v0, 1, v0, 1, v1, 0, v1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.12, emissiveMap: tex }) };
}

/** şoför mahalli: ön cam, silecekler, gösterge paneli, direksiyon, koltuk, ayna, LED hat tabelası */
function Cockpit() {
  const front = -BUS.len / 2;
  const led = useMemo(
    () =>
      canvasTexture(1024, 64, g => {
        g.fillStyle = '#120a02';
        g.fillRect(0, 0, 1024, 64);
        g.fillStyle = '#ff9a1f';
        g.font = '700 40px "Courier New", monospace';
        g.textBaseline = 'middle';
        g.fillText('42  UNO EKSPRES  •  SONRAKİ DURAK: MASA  •  ', 10, 34);
        // LED nokta ızgarası
        g.fillStyle = 'rgba(0,0,0,0.45)';
        for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 64);
        for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 1024, 1);
      }),
    [],
  );
  const dials = useMemo(
    () =>
      canvasTexture(256, 128, g => {
        g.fillStyle = '#0d0f12';
        g.fillRect(0, 0, 256, 128);
        for (const [cx, label] of [
          [70, 'km/s'],
          [186, 'rpm'],
        ] as const) {
          g.strokeStyle = '#d0d6dd';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(cx, 66, 46, Math.PI * 0.8, Math.PI * 2.2);
          g.stroke();
          g.strokeStyle = '#ff5a3c';
          g.beginPath();
          g.moveTo(cx, 66);
          g.lineTo(cx + Math.cos(Math.PI * 1.3) * 38, 66 + Math.sin(Math.PI * 1.3) * 38);
          g.stroke();
          g.fillStyle = '#8fd3ff';
          g.font = '600 14px Arial';
          g.textAlign = 'center';
          g.fillText(label, cx, 100);
        }
      }),
    [],
  );
  useFrame((_, dt) => {
    led.offset.x += Math.min(dt, 0.05) * 0.06;
  });
  useEffect(
    () => () => {
      led.dispose();
      dials.dispose();
    },
    [led, dials],
  );
  const wheel = useMemo(() => {
    const parts = [new THREE.TorusGeometry(0.24, 0.022, 10, 32).toNonIndexed()];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.BoxGeometry(0.02, 0.22, 0.02);
      s.translate(0, 0.11, 0);
      s.rotateZ((i / 3) * Math.PI * 2);
      parts.push(s.toNonIndexed());
    }
    for (const p of parts) p.deleteAttribute('uv');
    return mergeGeometries(parts)!;
  }, []);
  useEffect(() => () => wheel.dispose(), [wheel]);
  return (
    <group>
      {/* ön cam (eğik) ve alt panel */}
      <mesh position={[front - 0.12, 1.55, 0]} rotation={[0, Math.PI / 2, -0.12]} material={glassMat} renderOrder={3}>
        <planeGeometry args={[BUS.halfW * 2, 1.95]} />
      </mesh>
      <mesh position={[front, 0.3, 0]} material={panel}>
        <boxGeometry args={[0.1, 0.6, BUS.halfW * 2]} />
      </mesh>
      {/* silecekler */}
      {[-0.8, 0.9].map(z => (
        <mesh key={z} position={[front - 0.14, 0.95, z]} rotation={[0.35 * Math.sign(z), 0, 0]}>
          <boxGeometry args={[0.02, 0.9, 0.025]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      {/* gösterge paneli */}
      <mesh position={[front + 0.4, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 1.0, BUS.halfW * 2 - 0.1]} />
        <meshStandardMaterial color="#2a2f36" roughness={0.65} />
      </mesh>
      <mesh position={[front + 0.62, 1.13, 1.3]} rotation={[0, Math.PI / 2, 0.35]}>
        <planeGeometry args={[0.55, 0.28]} />
        <meshStandardMaterial map={dials} emissive="#ffffff" emissiveMap={dials} emissiveIntensity={0.7} />
      </mesh>
      {/* direksiyon ve kolonu */}
      <group position={[front + 0.95, 1.08, 1.3]} rotation={[0, Math.PI / 2, 0]}>
        <group rotation={[-1.05, 0, 0]}>
          <mesh geometry={wheel}>
            <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
          </mesh>
        </group>
      </group>
      <mesh position={[front + 0.8, 0.95, 1.3]} rotation={[0, 0, 1.0]} material={chrome}>
        <cylinderGeometry args={[0.035, 0.035, 0.5, 10]} />
      </mesh>
      {/* şoför koltuğu */}
      <group position={[front + 1.55, 0, 1.3]}>
        <SeatShape color="#2b2f36" />
      </group>
      {/* iç dikiz aynası */}
      <mesh position={[front + 0.25, 2.45, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.42, 0.12, 0.03]} />
        <meshStandardMaterial color="#9fb0bf" metalness={1} roughness={0.05} />
      </mesh>
      {/* LED hat tabelası */}
      <mesh position={[front + 0.08, 2.5, 0]}>
        <boxGeometry args={[0.1, 0.28, 2.6]} />
        <meshStandardMaterial color="#15171a" />
      </mesh>
      <mesh position={[front + 0.135, 2.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.5, 0.2]} />
        <meshBasicMaterial map={led} toneMapped={false} color={new THREE.Color(1.6, 1.6, 1.6)} />
      </mesh>
      {/* bilet doğrulama makinesi */}
      <group position={[front + 1.3, 0, -1.55]}>
        <mesh position={[0, 0.6, 0]} material={chrome}>
          <cylinderGeometry args={[0.03, 0.03, 1.2, 10]} />
        </mesh>
        <mesh position={[0, 1.25, 0]}>
          <boxGeometry args={[0.22, 0.3, 0.16]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0.112, 1.29, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.12, 0.08]} />
          <meshBasicMaterial color={new THREE.Color('#3dd36b').multiplyScalar(1.4)} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** sağ önde katlanır kapı: camlı iki kanat ve basamak */
function FrontDoor() {
  const x0 = -BUS.len / 2 + 0.25;
  const w = 1.15;
  return (
    <group position={[x0 + w / 2, 0, -BUS.halfW + 0.01]}>
      <mesh position={[0, -0.03, 0.35]}>
        <boxGeometry args={[w, 0.06, 0.6]} />
        <meshStandardMaterial color="#e2b23c" roughness={0.7} />
      </mesh>
      {[-1, 1].map(s => (
        <group key={s} position={[(s * w) / 4, 0, 0]}>
          <mesh position={[0, 1.18, 0]} material={glassMat} renderOrder={3}>
            <planeGeometry args={[w / 2 - 0.06, 2.2]} />
          </mesh>
          {/* çerçeve */}
          {[-1, 1].map(e => (
            <mesh key={e} position={[(e * (w / 2 - 0.06)) / 2, 1.18, 0.01]} material={rubber}>
              <boxGeometry args={[0.04, 2.25, 0.05]} />
            </mesh>
          ))}
          {[0.08, 1.2, 2.28].map(y => (
            <mesh key={y} position={[0, y, 0.01]} material={rubber}>
              <boxGeometry args={[w / 2 - 0.04, 0.05, 0.05]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

const fabric = new THREE.MeshStandardMaterial({ color: '#2d4f8f', roughness: 0.92 });

/** otobüs koltuğu: oturak, yaslanma (yuvarlak tepeli), tutamak ve ayak; yönü ileri (-x), sırtı +x'te */
function SeatShape({ color, width = 0.48 }: { color?: string; width?: number }) {
  const mat = useMemo(() => (color ? new THREE.MeshStandardMaterial({ color, roughness: 0.85 }) : fabric), [color]);
  return (
    <group>
      <mesh position={[0, 0.44, 0]} castShadow material={mat}>
        <boxGeometry args={[0.46, 0.12, width]} />
      </mesh>
      <mesh position={[0.2, 0.82, 0]} rotation={[0, 0, -0.12]} castShadow material={mat}>
        <capsuleGeometry args={[0.07, width - 0.14, 6, 12]} />
      </mesh>
      <mesh position={[0.21, 0.74, 0]} rotation={[0, 0, -0.12]} castShadow material={mat}>
        <boxGeometry args={[0.1, 0.62, width]} />
      </mesh>
      <mesh position={[0.24, 1.12, 0]} rotation={[Math.PI / 2, 0, 0]} material={chrome}>
        <torusGeometry args={[0.07, 0.014, 6, 16, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={chrome}>
        <boxGeometry args={[0.05, 0.4, 0.05]} />
      </mesh>
    </group>
  );
}

/** önde ve arkada koltuk sıraları: ikili koltuklar ileri (-x) bakar, en arkada boydan boya koltuk */
function Seats() {
  const rows: { x: number; z: number; w: number }[] = [
    { x: -3.25, z: 1.55, w: 0.96 },
    { x: 3.05, z: 1.6, w: 0.96 },
    { x: 3.05, z: -1.6, w: 0.96 },
    { x: 3.95, z: 1.6, w: 0.96 },
    { x: 3.95, z: -1.6, w: 0.96 },
    { x: 4.95, z: 0, w: BUS.halfW * 2 - 0.3 },
  ];
  return (
    <group>
      {rows.map((r, i) => (
        <group key={i} position={[r.x, 0, r.z]}>
          <SeatShape width={r.w} />
        </group>
      ))}
    </group>
  );
}

/** tutunma direkleri ve halkaları, durak düğmeleri */
function Fittings({ quality }: { quality: QualityLevel }) {
  const straps = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (const side of [-1, 1]) for (let x = -BUS.len / 2 + 1.6; x < BUS.len / 2 - 0.6; x += 0.5) out.push(new THREE.Vector3(x, BUS.h - 0.32, side * (BUS.halfW - 0.4)));
    return out;
  }, []);
  const strapMeshes = useMemo(() => {
    const strapGeo = new THREE.BoxGeometry(0.03, 0.2, 0.012);
    strapGeo.translate(0, -0.1, 0);
    const ringGeo = new THREE.TorusGeometry(0.06, 0.012, 6, 16);
    ringGeo.translate(0, -0.26, 0);
    const strapMesh = new THREE.InstancedMesh(strapGeo, new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.8 }), straps.length);
    const ringMesh = new THREE.InstancedMesh(ringGeo, new THREE.MeshStandardMaterial({ color: '#f2b632', roughness: 0.5 }), straps.length);
    const m = new THREE.Matrix4();
    straps.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      strapMesh.setMatrixAt(i, m);
      ringMesh.setMatrixAt(i, m);
    });
    strapMesh.computeBoundingSphere();
    ringMesh.computeBoundingSphere();
    return [strapMesh, ringMesh];
  }, [straps]);
  useEffect(
    () => () =>
      strapMeshes.forEach(m => {
        m.dispose();
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }),
    [strapMeshes],
  );
  const poles: [number, number][] = [
    [-3.95, -1.0],
    [-2.55, 1.05],
    [2.55, -1.05],
    [4.45, 0.95],
  ];
  return (
    <group>
      {[-1, 1].map(side => (
        <mesh key={side} position={[0, BUS.h - 0.3, side * (BUS.halfW - 0.4)]} rotation={[0, 0, Math.PI / 2]} material={chrome}>
          <cylinderGeometry args={[0.018, 0.018, BUS.len - 0.4, 8]} />
        </mesh>
      ))}
      {strapMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {poles.map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <mesh position={[0, BUS.h / 2, 0]} material={yellow}>
            <cylinderGeometry args={[0.022, 0.022, BUS.h, 10]} />
          </mesh>
          {/* durak düğmesi */}
          <mesh position={[0, 1.35, 0.03]}>
            <boxGeometry args={[0.06, 0.09, 0.03]} />
            <meshStandardMaterial color="#d62f2f" emissive="#d62f2f" emissiveIntensity={quality === 'low' ? 0.2 : 0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
