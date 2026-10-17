import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { useFBX } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { useApp } from '../store/useApp';
import { ANIMATIONS, CHARACTERS } from './characters';

let started = false;

/**
 * Karakter modelleri ve animasyonlar indirilir; ilerleme store'a yazılır ve yükleme ekranında gösterilir.
 * Tüm dosyalar inince assetsReady true olur.
 */
export async function preloadScene() {
  if (started) return;
  started = true;
  const urls = Array.from(new Set([...Object.values(ANIMATIONS), ...CHARACTERS.filter(c => c.kind === 'mixamo').map(c => c.url)]));
  let done = 0;
  // önce ağ: dosyalar tarayıcı önbelleğine iner, ilerleme sayılır
  await Promise.all(
    urls.map(u =>
      fetch(u)
        .then(r => r.arrayBuffer())
        .catch(() => undefined)
        .finally(() => {
          done++;
          useApp.setState({ assetProgress: done / urls.length });
        }),
    ),
  );
  // sonra ayrıştırma: R3F önbelleğine alınır (önbellekten hızlı gelir)
  const jsonUrls = Object.values(ANIMATIONS).filter(u => /\.json(\?|$)/i.test(u));
  const fbxUrls = Object.values(ANIMATIONS).filter(u => !/\.json(\?|$)/i.test(u));
  useLoader.preload(THREE.FileLoader, jsonUrls);
  useLoader.preload(FBXLoader, fbxUrls);
  for (const c of CHARACTERS) if (c.kind === 'mixamo') useFBX.preload(c.url);
  await new Promise(r => setTimeout(r, 600));
  useApp.setState({ assetsReady: true });
}
