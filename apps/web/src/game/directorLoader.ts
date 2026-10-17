import type { director as DirectorInstance } from './director';

type Director = typeof DirectorInstance;

let ready: Director | null = null;
let loading: Promise<Director> | null = null;

/**
 * Masa motorunu (three.js tabanlı) ilk ihtiyaçta yükler. Ana paket bu yüzden ilk açılışta küçük kalır.
 * Yüklenmiş olan örnek varsa senkron döner; yoksa yükleme bitince çağrılır (sıra korunur).
 */
export function withDirector(fn: (d: Director) => void) {
  if (ready) return fn(ready);
  loading ??= import('./director').then(m => (ready = m.director));
  void loading.then(fn);
}

/** Yüklenmiş motor (yoksa null); sahne bileşenleri zaten motoru yüklemiş olur */
export function loadedDirector(): Director | null {
  return ready;
}
