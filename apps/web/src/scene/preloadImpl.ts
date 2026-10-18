import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { useApp } from '../store/useApp';
import { ANIMATIONS, CHARACTERS } from './characters';
import { useGLTF } from '@react-three/drei';
import { preloadCharacterScene, useCharacterScene } from './characterModel';
import { MODELS, preloadCoreModels } from './models';

let started = false;

/**
 * Karakter modelleri ve animasyonlar indirilir; ilerleme store'a yazılır ve yükleme ekranında gösterilir.
 * Tüm dosyalar inince assetsReady true olur.
 */
export async function preloadScene() {
  if (started) return;
  started = true;
  // masa ve sandalye de sayılır; temaya özgü küçük dekor modelleri sahne açılınca arka planda iner
  const urls = Array.from(new Set([...Object.values(ANIMATIONS), ...CHARACTERS.filter(c => c.kind === 'mixamo').map(c => c.url), MODELS.table, MODELS.chair]));
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
  const chars = CHARACTERS.filter(c => c.kind === 'mixamo');
  for (const c of chars) preloadCharacterScene(c.url);
  preloadCoreModels();
  // sabit bir süre yerine ayrıştırma gerçekten bitene kadar beklenir: oyun açılınca karakterler askıda kalmaz.
  // Yavaş cihazda sonsuza dek beklenmesin diye üst sınır var.
  await Promise.race([
    Promise.all([
      settle(() => useLoader(THREE.FileLoader, jsonUrls)),
      settle(() => useLoader(FBXLoader, fbxUrls)),
      ...chars.map(c => settle(() => useCharacterScene(c.url))),
      settle(() => useGLTF(MODELS.table)),
      settle(() => useGLTF(MODELS.chair)),
    ]),
    new Promise(r => setTimeout(r, 8000)),
  ]);
  useApp.setState({ assetsReady: true });
}

/**
 * useLoader/useGLTF gerçek React hook'u değildir; suspend-react önbelleğini okur. Hazır değilse fırlattığı
 * söz beklenir (önbellekteki aynı yükleme, yeniden indirme yok). Hata olursa beklemeyi bırakır.
 */
async function settle(read: () => unknown) {
  for (let i = 0; i < 20; i++) {
    try {
      read();
      return;
    } catch (e) {
      if (!(e instanceof Promise)) return;
      await e.catch(() => undefined);
    }
  }
}
