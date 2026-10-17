import { Suspense, useMemo, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import table from '../assets/models/round_wooden_table_01.glb?url';
import chair from '../assets/models/dining_chair_02.glb?url';
import chandelier from '../assets/models/Chandelier_01.glb?url';
import lanternChandelier from '../assets/models/lantern_chandelier_01.glb?url';
import barrel from '../assets/models/wine_barrel_01.glb?url';
import bottles from '../assets/models/wine_bottles_01.glb?url';
import plant from '../assets/models/potted_plant_02.glb?url';
import dartboard from '../assets/models/dartboard.glb?url';
import lifebuoy from '../assets/models/lifebuoy.glb?url';
import lantern from '../assets/models/wooden_lantern_01.glb?url';
import crate from '../assets/models/wooden_crate_01.glb?url';
import streetLamp from '../assets/models/street_lamp_01.glb?url';
import armchair from '../assets/models/ArmChair_01.glb?url';
import sofa from '../assets/models/Sofa_01.glb?url';
import oilLamp from '../assets/models/vintage_oil_lamp.glb?url';

/**
 * Hazır 3B modeller: hepsi Poly Haven'dan (CC0, serbest kullanım), dokuları 512 px WebP'ye
 * küçültülüp meshopt ile sıkıştırıldı (model başına ~100–600 KB).
 */
export const MODELS = {
  table,
  chair,
  chandelier,
  lanternChandelier,
  barrel,
  bottles,
  plant,
  dartboard,
  lifebuoy,
  lantern,
  crate,
  streetLamp,
  armchair,
  sofa,
  oilLamp,
} as const;
export type ModelName = keyof typeof MODELS;

type Vec3 = [number, number, number] | THREE.Vector3;

interface ModelProps {
  name: ModelName;
  position?: Vec3;
  rotation?: [number, number, number];
  quaternion?: THREE.Quaternion;
  scale?: number | [number, number, number];
  castShadow?: boolean;
}

function ModelInner({ name, castShadow = true, ...rest }: ModelProps) {
  const { scene } = useGLTF(MODELS[name]);
  // aynı model birden çok yerde kullanılabilsin: sahne kopyalanır (geometri ve dokular ortak kalır)
  const obj = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = castShadow;
        m.receiveShadow = true;
      }
    });
    return c;
  }, [scene, castShadow]);
  return <primitive object={obj} {...rest} />;
}

/** Hazır model; yüklenene kadar sahnenin geri kalanını bekletmez (isteğe bağlı yedek çizim) */
export function Model({ fallback = null, ...props }: ModelProps & { fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <ModelInner {...props} />
    </Suspense>
  );
}

/** Her temada kullanılanlar oyun açılırken önceden indirilir */
export function preloadCoreModels() {
  useGLTF.preload(MODELS.table);
  useGLTF.preload(MODELS.chair);
}
