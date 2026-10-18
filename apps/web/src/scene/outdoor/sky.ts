import * as THREE from 'three';
import type { SkyName } from '../themes';

/** Gökyüzü panoramaları: Poly Haven "puresky" HDRI'lerinin ton eşlenmiş hâli, 4096×2048 WebP (CC0) */
const files = import.meta.glob('../../assets/skies/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const cache = new Map<SkyName, Promise<THREE.Texture>>();

/** Panorama bir kez indirilir; gökyüzü küresi ve ortam yansımaları aynı dokuyu kullanır */
export function loadSky(name: SkyName): Promise<THREE.Texture> {
  let p = cache.get(name);
  if (!p) {
    const url = Object.entries(files).find(([path]) => path.endsWith(`/${name}.webp`))?.[1];
    if (!url) return Promise.reject(new Error(`gökyüzü bulunamadı: ${name}`));
    p = new THREE.TextureLoader().loadAsync(url).then(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.mapping = THREE.EquirectangularReflectionMapping;
      // gökyüzü ekranda hep büyütülerek görünür: mipmap gerekmez, böylece panoramanın dikişinde çizgi de oluşmaz
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      return t;
    });
    cache.set(name, p);
  }
  return p;
}
