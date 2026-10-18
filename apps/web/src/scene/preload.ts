/** Ana ekran açıldıktan sonra, tarayıcı boşken karakter ve animasyonları indirmeye başlar.
 * Ağır yükleyiciler ayrı parçada tutulur; ana paket küçük kalır. */
export function schedulePreload() {
  const start = () => void import('./preloadImpl').then(m => m.preloadScene());
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  // ana ekranda sahne sürekli çizildiği için boş an hiç gelmeyebilir: en geç 1.5 sn'de başlar
  if (idle) idle(start, { timeout: 1500 });
  else setTimeout(start, 300);
}
