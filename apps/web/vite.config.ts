import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** node_modules altındaki paket(ler)i yakalayan desen (Windows yol ayırıcısı dahil) */
const pkg = (names: string) => new RegExp(`[\\\\/]node_modules[\\\\/](${names})[\\\\/]`);

/**
 * 3B sahne parçası (GameCanvas) ana ekran açılır açılmaz istenir. Normalde indirmesi ancak ana paket
 * inip çalıştıktan sonra başlar; bu eklenti onu ve bağımlılıklarını HTML'de düşük öncelikle önceden
 * yükletir, böylece menüyü geciktirmeden paralel iner.
 */
function preloadScene(): Plugin {
  let base = '/';
  return {
    name: 'uno-preload-scene',
    apply: 'build',
    configResolved(c) {
      base = c.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;
        const scene = Object.values(bundle).find(c => c.type === 'chunk' && c.facadeModuleId?.replace(/\\/g, '/').endsWith('/scene/GameCanvas.tsx'));
        if (!scene || scene.type !== 'chunk') return;
        const entry = new Set(ctx.chunk?.imports ?? []);
        const files = new Set<string>();
        const walk = (name: string) => {
          if (files.has(name) || entry.has(name) || name === ctx.chunk?.fileName) return;
          files.add(name);
          const c = bundle[name];
          if (c?.type === 'chunk') c.imports.forEach(walk);
        };
        walk(scene.fileName);
        return [...files].map(f => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, fetchpriority: 'low', href: base + f },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadScene()],
  // GitHub Pages'te site bir alt yoldan yayınlanır (ör. /uno3d/); yerelde kök
  base: process.env.VITE_BASE || '/',
  build: {
    // modeller, dokular ve animasyonlar asla JS içine base64 gömülmez: ayrı dosya olarak önbelleğe girer
    assetsInlineLimit: file => (/\.(glb|gltf|bin|json|webp|png|jpe?g|hdr|exr|ktx2)$/i.test(file) ? false : undefined),
    // three ve r3f parçaları zaten büyük; uyarı gürültüsü olmasın
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // kütüphaneler ayrı, kararlı parçalarda: oyun kodu değişince tarayıcı önbelleği bunları yeniden indirmez.
        // Öncelik sırası önemli: bağımlılıklar yüksek öncelikli grupta kalır (ör. fiber postprocessing'e karışmaz)
        codeSplitting: {
          groups: [
            { name: 'react', test: pkg('react|react-dom|scheduler|zustand|use-sync-external-store'), priority: 60 },
            { name: 'three', test: pkg('three'), priority: 50 },
            { name: 'r3f', test: pkg('@react-three[\\\\/]fiber|@react-three[\\\\/]drei|three-stdlib|its-fine|suspend-react|react-reconciler'), priority: 40 },
            { name: 'postfx', test: pkg('postprocessing|@react-three[\\\\/]postprocessing|n8ao'), priority: 30 },
            { name: 'gsap', test: pkg('gsap'), priority: 20 },
            { name: 'net', test: pkg('socket\\.io-client|socket\\.io-parser|engine\\.io-client|engine\\.io-parser|@socket\\.io[\\\\/][^\\\\/]+'), priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // geliştirmede WebSocket bağlantısı oyun sunucusuna aktarılır
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
