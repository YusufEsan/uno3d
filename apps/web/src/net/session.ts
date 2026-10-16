import type { Profile } from '@uno/protocol';

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/**
 * Oturum anahtarı sekmeye özeldir (sessionStorage): sayfa yenilenince aynı koltuğa geri dönülür,
 * aynı tarayıcıda iki sekme ise iki ayrı oyuncu olur.
 */
export function getToken(): string {
  return safe(() => {
    let t = sessionStorage.getItem('uno.token');
    if (!t) {
      t = crypto.randomUUID();
      sessionStorage.setItem('uno.token', t);
    }
    return t;
  }, crypto.randomUUID());
}

export function loadProfile(): Profile {
  return safe(() => {
    const raw = localStorage.getItem('uno.profile');
    if (raw) return JSON.parse(raw) as Profile;
    return null;
  }, null) ?? { name: '', avatar: '' };
}

export function saveProfile(p: Profile) {
  safe(() => localStorage.setItem('uno.profile', JSON.stringify(p)), undefined);
}
