import type { Object3D } from 'three';
import { useFBX, useGLTF } from '@react-three/drei';

// lobi ekranı characters.ts'i kullanır; 3B yükleyiciler ana pakete girmesin diye ayrı dosyada
const isGltf = (url: string) => /\.(glb|gltf)(\?|$)/i.test(url);

/** Karakter modelini yükler: sıkıştırılmış .glb (hızlı ayrıştırılır) ya da eski .fbx */
export function useCharacterScene(url: string): Object3D {
  // uzantı sabit olduğundan hook sırası değişmez
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return isGltf(url) ? useGLTF(url).scene : useFBX(url);
}

export function preloadCharacterScene(url: string) {
  if (isGltf(url)) useGLTF.preload(url);
  else useFBX.preload(url);
}
