/** Yayındaki sürümde ölçüm için: adreste ?perf varsa geliştirme kancaları (window.__app, __avatars…) açılır */
export const PERF_HOOKS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
