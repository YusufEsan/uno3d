import { Suspense, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SkyName } from './themes';
import { loadSky } from './outdoor/sky';
import { useQuality, type QualityLevel } from '../store/useApp';

/**
 * Yüzey dokuları: Poly Haven (CC0). Renk haritası 1024 px, kabartma (normal) haritası 512 px WebP.
 * Her tema yalnızca kendi dokularını ister; inene kadar düz renk görünür, sahne beklemez.
 */
const files = import.meta.glob('../assets/textures/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** tüm doku adresleri: ana ekranda arka planda önceden yüklemek için */
export const TEXTURE_URLS = Object.values(files);
const url = (name: string) => Object.entries(files).find(([p]) => p.endsWith(`/${name}.webp`))?.[1];

export type SurfaceName =
  | 'wood_floor_worn'
  | 'dark_brick_wall'
  | 'herringbone_parquet'
  | 'quatrefoil_jacquard_fabric'
  | 'concrete_floor_02'
  | 'concrete_wall_008'
  | 'plastered_wall_02'
  | 'velour_velvet'
  | 'wood_floor_deck'
  | 'metal_plate'
  | 'rubber_tiles'
  | 'weathered_planks';

export interface Surface {
  tex: SurfaceName;
  /** dokunun yüzeyde kaç kez tekrarlanacağı */
  repeat: [number, number];
  /** doku rengiyle çarpılan ton (temaya uydurmak için) */
  tint?: string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
}

interface MatProps extends Surface {
  side?: THREE.Side;
  /** doku inene kadar ve "düşük" kalitede kullanılan düz renk */
  fallback: string;
  colorMap?: boolean;
  /** colorMap kapalıyken kullanılacak hazır renk dokusu (ör. çuhanın ışık geçişi) */
  baseMap?: THREE.Texture | null;
}

/** kaliteye göre eğik açı süzmesi: zemin ve duvarlar ekranın çoğunu kaplar, düşük kalitede ucuzlatılır */
const ANISOTROPY: Record<QualityLevel, number> = { high: 8, medium: 4, low: 2 };

/**
 * Ayarlanmış doku kopyaları ortak önbellekte tutulur: aynı doku + aynı tekrar + aynı süzme tek kopyayı
 * paylaşır (ör. bardaki raflar ve tezgâh). Farklı tekrar sayısı her zaman ayrı kopya olur. Kopya, onu
 * kullanan son malzeme bırakınca atılır; aynı karede yeniden istenirse (tema/kalite değişimi) atılmaz.
 */
const shared = new Map<string, { tex: THREE.Texture; users: number }>();

function sharedTexture(src: THREE.Texture, srgb: boolean, repeat: [number, number], anisotropy: number) {
  const key = `${src.uuid}|${srgb ? 's' : 'l'}|${repeat[0]}x${repeat[1]}|${anisotropy}`;
  let e = shared.get(key);
  if (!e) {
    // clone() kopyayı zaten "güncellenecek" işaretler; görüntü verisi (source) GPU'da ortak kalır
    const tex = src.clone();
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = anisotropy;
    e = { tex, users: 0 };
    shared.set(key, e);
  }
  return { key, tex: e.tex };
}

/** kullanım sayacı efektte tutulur: çizimi atılan (Suspense/StrictMode) kopyalar sayaca girmez */
function useShared(entries: { key: string }[]) {
  const keys = entries.map(e => e.key).join(',');
  useEffect(() => {
    const list = keys.split(',');
    list.forEach(k => shared.get(k) && shared.get(k)!.users++);
    return () => {
      list.forEach(k => {
        const e = shared.get(k);
        if (e) e.users--;
      });
      // aynı işlemde yeni malzeme aynı kopyayı alabilir: atma kararı efektler bittikten sonra verilir
      queueMicrotask(() =>
        list.forEach(k => {
          const e = shared.get(k);
          if (e && e.users <= 0) {
            shared.delete(k);
            e.tex.dispose();
          }
        }),
      );
    };
  }, [keys]);
}

function TexturedMaterial({ tex, repeat, tint = '#ffffff', roughness = 0.85, metalness = 0, normalScale = 1, side, colorMap = true, baseMap = null }: Omit<MatProps, 'fallback'>) {
  const diff = url(`${tex}_diff`);
  const nor = url(`${tex}_nor`);
  const quality = useQuality();
  const maps = useTexture(colorMap ? { map: diff!, normalMap: nor! } : { normalMap: nor! }) as { map?: THREE.Texture; normalMap: THREE.Texture };
  // aynı doku farklı yüzeylerde farklı tekrar sayısıyla kullanılabilsin: ortak önbellekteki kopya üzerinde ayarlanır
  const aniso = ANISOTROPY[quality];
  const configured = useMemo(() => {
    const normal = sharedTexture(maps.normalMap, false, repeat, aniso);
    const map = maps.map ? sharedTexture(maps.map, true, repeat, aniso) : null;
    return { normal, map, entries: map ? [normal, map] : [normal] };
  }, [maps, repeat[0], repeat[1], aniso]); // eslint-disable-line react-hooks/exhaustive-deps
  useShared(configured.entries);
  return (
    <meshStandardMaterial
      map={configured.map?.tex ?? baseMap}
      normalMap={configured.normal.tex}
      normalScale={normalScale}
      color={tint}
      roughness={roughness}
      metalness={metalness}
      side={side}
    />
  );
}

/** Dokulu malzeme; doku inene kadar düz renkli malzeme görünür */
export function SurfaceMaterial({ fallback, ...props }: MatProps) {
  const plain = <meshStandardMaterial color={fallback} map={props.baseMap ?? null} roughness={props.roughness ?? 0.85} metalness={props.metalness ?? 0} side={props.side} />;
  if (!url(`${props.tex}_nor`)) return plain;
  return (
    <Suspense fallback={plain}>
      <TexturedMaterial {...props} />
    </Suspense>
  );
}

/**
 * Ortam yansımaları: kapalı odalarda three.js'in kod içinde üretilen stüdyo ortamı; açık havada temanın
 * gökyüzü panoraması (inene kadar stüdyo ortamı). Cilalı ahşap, şişe, metal ve su gerçekçi yansıma alır.
 */
export function EnvironmentLighting({ intensity, sky }: { intensity: number; sky?: SkyName }) {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    let skyEnv: THREE.Texture | null = null;
    let alive = true;
    if (sky)
      loadSky(sky)
        .then(tex => {
          if (!alive) return;
          skyEnv = pmrem.fromEquirectangular(tex).texture;
          scene.environment = skyEnv;
        })
        .catch(() => {});
    return () => {
      alive = false;
      scene.environment = null;
      env.dispose();
      skyEnv?.dispose();
      pmrem.dispose();
      room.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    };
  }, [gl, scene, sky]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  return null;
}
