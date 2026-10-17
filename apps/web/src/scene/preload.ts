/** Ana ekran açıldıktan sonra, tarayıcı boşken karakter ve animasyonları indirmeye başlar.
 * Ağır yükleyiciler ayrı parçada tutulur; ana paket küçük kalır. */
export function schedulePreload() {
  const start = () => void import('./preloadImpl').then(m => m.preloadScene());
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(start);
  else setTimeout(start, 300);
}
