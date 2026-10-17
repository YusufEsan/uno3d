import { Suspense, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Yüzey dokuları: Poly Haven (CC0). Renk haritası 1024 px, kabartma (normal) haritası 512 px WebP.
 * Her tema yalnızca kendi dokularını ister; inene kadar düz renk görünür, sahne beklemez.
 */
const files = import.meta.glob('../assets/textures/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
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

function TexturedMaterial({ tex, repeat, tint = '#ffffff', roughness = 0.85, metalness = 0, normalScale = 1, side, colorMap = true, baseMap = null }: Omit<MatProps, 'fallback'>) {
  const diff = url(`${tex}_diff`);
  const nor = url(`${tex}_nor`);
  const maps = useTexture(colorMap ? { map: diff!, normalMap: nor! } : { normalMap: nor! }) as { map?: THREE.Texture; normalMap: THREE.Texture };
  // aynı doku farklı yüzeylerde farklı tekrar sayısıyla kullanılabilsin: kopya üzerinde ayarlanır
  const configured = useMemo(() => {
    const out: { map?: THREE.Texture; normalMap: THREE.Texture } = { normalMap: maps.normalMap.clone() };
    if (maps.map) {
      out.map = maps.map.clone();
      out.map.colorSpace = THREE.SRGBColorSpace;
    }
    for (const t of Object.values(out)) {
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    return out;
  }, [maps, repeat[0], repeat[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(configured).forEach(t => t?.dispose()), [configured]);
  return (
    <meshStandardMaterial
      map={configured.map ?? baseMap}
      normalMap={configured.normalMap}
      normalScale={new THREE.Vector2(normalScale, normalScale)}
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
 * Ortam yansımaları: three.js'in kod içinde üretilen stüdyo ortamı (indirme yok). Cilalı ahşap, şişe
 * ve metaller gerçekçi yansıma alır; yoğunluk temaya göre ayarlanır.
 */
export function EnvironmentLighting({ intensity }: { intensity: number }) {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      room.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  return null;
}
