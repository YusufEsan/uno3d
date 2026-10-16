/**
 * Karakter kataloğu.
 *
 * Mixamo karakterleri (.fbx) src/assets/characters/ klasörüne, animasyonlar src/assets/animations/ klasörüne
 * konur; buradaki glob onları otomatik bulur, ayrı bir liste tutmaya gerek yoktur.
 * Klasör boşsa ücretsiz robot modeli (farklı renklerde) geçici karakter olarak kullanılır.
 * Ayrıntılar: src/assets/README.md
 */

import type { RoomState } from '@uno/protocol';

const characterFiles = import.meta.glob('../assets/characters/*.{fbx,glb,gltf}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// .json: `npm run import-mixamo` ile çıkarılmış hafif klipler; .fbx: doğrudan Mixamo dosyası
const animationFiles = import.meta.glob('../assets/animations/*.{json,fbx}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const ROBOT_URL = 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb';

export interface CharacterDef {
  id: string;
  name: string;
  url: string;
  kind: 'mixamo' | 'robot';
  /** Lobi ve isim etiketlerindeki renk */
  color: string;
  /** Robot için gövde rengi */
  tint?: string;
}

const PALETTE = ['#e5322d', '#2f7bff', '#25b36a', '#f2b705', '#9b5cff', '#ff7a3d', '#3ac7d6', '#d64a9b'];

const baseName = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');
const pretty = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const mixamo: CharacterDef[] = Object.entries(characterFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url], i) => ({
    id: baseName(path).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    name: pretty(baseName(path)),
    url,
    kind: 'mixamo',
    color: PALETTE[i % PALETTE.length],
  }));

const robots: CharacterDef[] = [
  { id: 'robot-kizil', name: 'Kızıl', tint: '#e5322d' },
  { id: 'robot-safir', name: 'Safir', tint: '#2f7bff' },
  { id: 'robot-zumrut', name: 'Zümrüt', tint: '#25b36a' },
  { id: 'robot-altin', name: 'Altın', tint: '#f2b705' },
  { id: 'robot-mor', name: 'Mor', tint: '#9b5cff' },
  { id: 'robot-gece', name: 'Gece', tint: '#3a3f55' },
].map(r => ({ ...r, url: ROBOT_URL, kind: 'robot' as const, color: r.tint }));

export const HAS_MIXAMO = mixamo.length > 0;
export const CHARACTERS: CharacterDef[] = HAS_MIXAMO ? mixamo : robots;

/** Mixamo animasyonları: dosya adı (küçük harf) → adres. ör. "idle", "laugh", "disbelief2" */
export const ANIMATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(animationFiles).map(([path, url]) => [baseName(path).toLowerCase(), url]),
);

/** mulberry32: aynı seed her istemcide aynı sırayı verir */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Masadaki her oyuncuya rastgele ve birbirinden farklı bir karakter verir.
 * Koltuk numarası sırayla karıştırılmış listeden karakter alır; karakter sayısı koltuk sayısından
 * azsa (en fazla 4 koltuk) ancak o zaman tekrar olur.
 */
export function assignCharacters(room: Pick<RoomState, 'seats' | 'charSeed'> | null): Record<string, CharacterDef> {
  const map: Record<string, CharacterDef> = {};
  if (!room) return map;
  const order = seededShuffle(CHARACTERS, room.charSeed);
  room.seats.forEach((s, i) => {
    if (s) map[s.playerId] = order[i % order.length];
  });
  return map;
}

/**
 * Tepki → aday klip adları (önce Mixamo dosya adları, sonra robotun klipleri).
 * İlk bulunan oynatılır.
 */
export const REACTION_CLIPS: Record<string, string[]> = {
  wave: ['wave', 'cheer', 'Wave'],
  laugh: ['laugh', 'cheer', 'clap', 'Yes'],
  thumbsUp: ['thumbsup', 'cheer', 'clap', 'ThumbsUp'],
  angry: ['angry', 'disapproval', 'yell', 'Punch'],
  no: ['disapproval', 'disbelief', 'angry', 'No'],
  sad: ['sad', 'disbelief', 'disapproval', 'No'],
  dance: ['victory', 'cheer', 'clap', 'Dance'],
  uno: ['yell', 'cheer', 'victory', 'Jump'],
  clap: ['clap', 'cheer', 'Yes'],
  point: ['point', 'disapproval', 'Wave'],
  shock: ['disbelief', 'disapproval', 'No'],
  yell: ['yell', 'angry', 'Punch'],
};

/** Tepkiye eşlik eden yüz ifadesi (modelde blendshape varsa) */
export const REACTION_FACE: Record<string, string | undefined> = {
  laugh: 'happy',
  thumbsUp: 'happy',
  angry: 'angry',
  no: 'angry',
  sad: 'sad',
  dance: 'happy',
  uno: 'surprised',
  clap: 'happy',
  shock: 'surprised',
  yell: 'angry',
};
