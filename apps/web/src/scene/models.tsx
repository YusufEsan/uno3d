import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
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
import barrelSmall from '../assets/models/barrel_small.glb?url';
import bucket from '../assets/models/bucket.glb?url';
import buoy from '../assets/models/buoy.glb?url';
import seaMarker from '../assets/models/sea_marker.glb?url';
import lifeJacket from '../assets/models/life_jacket.glb?url';
import ship from '../assets/models/dutch_ship.glb?url';
import mountainside from '../assets/models/mountainside.glb?url';
import rockFace from '../assets/models/rock_face.glb?url';
import hydrant from '../assets/models/fire_hydrant.glb?url';
import bench from '../assets/models/street_bench.glb?url';
import trashCan from '../assets/models/trash_can.glb?url';
import utilityBox from '../assets/models/utility_box.glb?url';
import wallLamp from '../assets/models/wall_lamp.glb?url';
import facadeKit from '../assets/models/facade_kit.glb?url';

/**
 * Hazır 3B modeller: hepsi Poly Haven'dan (CC0, serbest kullanım), dokuları 512 px WebP'ye
 * küçültülüp meshopt ile sıkıştırıldı (model başına ~100–800 KB).
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
  barrelSmall,
  bucket,
  buoy,
  seaMarker,
  lifeJacket,
  ship,
  mountainside,
  rockFace,
  hydrant,
  bench,
  trashCan,
  utilityBox,
  wallLamp,
  facadeKit,
} as const;
export type ModelName = keyof typeof MODELS;

/**
 * Işık geçiren (transmission) cam, three.js'te sahnenin her karede ikinci kez çizilmesine yol açar.
 * Model camları görünüşü yakın, ucuz yarı saydam bir camla değiştirilir (malzeme başına bir kez).
 */
const glassCache = new WeakMap<THREE.Material, THREE.Material>();
function cheapMaterial(mat: THREE.Material): THREE.Material {
  const p = mat as THREE.MeshPhysicalMaterial;
  if (!p.isMeshPhysicalMaterial || !(p.transmission > 0)) return mat;
  let g = glassCache.get(mat);
  if (!g) {
    g = new THREE.MeshStandardMaterial({ color: p.color, map: p.map, roughness: Math.min(p.roughness, 0.2), metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false, side: p.side, name: p.name });
    glassCache.set(mat, g);
  }
  return g;
}
const cheap = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m.map(cheapMaterial) : cheapMaterial(m));

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
        m.material = cheap(m.material);
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

interface InstancesProps {
  name: ModelName;
  /** her kopyanın dünya dönüşümü */
  transforms: THREE.Matrix4[];
  castShadow?: boolean;
}

function ModelInstancesInner({ name, transforms, castShadow = false }: InstancesProps) {
  const { scene } = useGLTF(MODELS[name]);
  const meshes = useMemo(() => {
    scene.updateMatrixWorld(true);
    const tmp = new THREE.Matrix4();
    const out: THREE.InstancedMesh[] = [];
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, cheap(m.material), transforms.length);
      transforms.forEach((t, i) => im.setMatrixAt(i, tmp.multiplyMatrices(t, m.matrixWorld)));
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.push(im);
    });
    return out;
  }, [scene, transforms, castShadow]);
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

/** Aynı modelin birçok kopyası: her parça tek çizimle (instancing) çizilir; sokak lambası, bank vb. */
export function ModelInstances(props: InstancesProps) {
  return (
    <Suspense fallback={null}>
      <ModelInstancesInner {...props} />
    </Suspense>
  );
}

/** Her temada kullanılanlar oyun açılırken önceden indirilir */
export function preloadCoreModels() {
  useGLTF.preload(MODELS.table);
  useGLTF.preload(MODELS.chair);
}
