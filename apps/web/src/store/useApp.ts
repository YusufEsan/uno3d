import { create } from 'zustand';
import type { Card, PlayerView } from '@uno/engine';
import type { ChatMessage, Profile, RoomState } from '@uno/protocol';
import { loadProfile } from '../net/session';

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityLevel;

const savedQuality = (() => {
  try {
    return (localStorage.getItem('uno.quality') as QualitySetting | null) ?? 'auto';
  } catch {
    return 'auto';
  }
})();

/** Kalıcı kullanıcı ayarları: yerelde saklanır, yoksa varsayılan */
function savedNumber(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) === null || Number.isNaN(v) ? fallback : Math.min(1, Math.max(0, v));
  } catch {
    return fallback;
  }
}

export type ReactionName = 'wave' | 'laugh' | 'thumbsUp' | 'angry' | 'no' | 'dance' | 'uno' | 'sad' | 'clap' | 'point' | 'shock' | 'yell';

interface AppState {
  connected: boolean;
  playerId: string | null;
  profile: Profile;
  room: RoomState | null;
  chat: ChatMessage[];
  /** Animasyonları biten, ekrandaki oyun durumu */
  view: PlayerView | null;
  seq: number;
  turnDeadline: number;
  /** Animasyon sırasında güncellenen kart sayıları (isim etiketleri için) */
  counts: Record<string, number>;
  unoFlags: Record<string, boolean>;
  /**
   * Sesli sohbet düzeyleri (0–1). Saniyede ~11 kez YERİNDE güncellenir: React aboneleri yalnızca biri
   * konuşmaya başlayınca/susunca (SPEAKING_THRESHOLD) ya da oyuncu listesi değişince haber alır.
   * Sürekli değer gerekiyorsa useFrame içinde getState() / speakingLevel() ile okunmalı.
   */
  speaking: Record<string, number>;
  /**
   * Diğer oyuncuların bakış yönü. Saniyede onlarca mesaj gelir: değerler YERİNDE güncellenir, React
   * aboneleri yalnızca yeni bir oyuncu ilk kez bakış gönderince haber alır. useFrame içinde okunmalı.
   */
  looks: Record<string, { yaw: number; pitch: number }>;
  reactions: Record<string, { name: ReactionName; n: number }>;
  pendingWild: Card | null;
  toast: { text: string; n: number } | null;
  micOn: boolean;
  /** efekt sesi düzeyi (0–1) */
  volume: number;
  /** diğer oyuncuların sesli sohbet düzeyi (0–1) */
  voiceVolume: number;
  settingsOpen: boolean;
  /** kendi avatarını masanın ortasından izleme modu (kendi kartların gizlenir) */
  watchSelf: boolean;
  /** masaya yukarıdan bakış: kamera yükselir ve aşağı eğilir */
  topView: boolean;
  /** karakter ve animasyon dosyalarının yüklenme oranı (0–1) */
  assetProgress: number;
  /** dosyalar hazır mı (oyuna girmek için) */
  assetsReady: boolean;
  /** odadan çıkış onayı penceresi açık mı */
  leaveAsk: boolean;
  /** Kullanıcının grafik seçimi; "auto" iken autoLevel kare hızına göre değişir */
  quality: QualitySetting;
  autoLevel: QualityLevel;
  fps: number;

  react: (playerId: string, name: ReactionName) => void;
  showToast: (text: string) => void;
}

let reactionCounter = 0;

export const useApp = create<AppState>()(set => ({
  connected: false,
  playerId: null,
  profile: loadProfile(),
  room: null,
  chat: [],
  view: null,
  seq: 0,
  turnDeadline: 0,
  counts: {},
  unoFlags: {},
  speaking: {},
  looks: {},
  reactions: {},
  pendingWild: null,
  toast: null,
  micOn: false,
  volume: savedNumber('uno.volume', 0.7),
  voiceVolume: savedNumber('uno.voiceVolume', 1),
  settingsOpen: false,
  watchSelf: false,
  topView: false,
  assetProgress: 0,
  assetsReady: false,
  leaveAsk: false,
  quality: savedQuality,
  autoLevel: 'medium',
  fps: 0,

  react: (playerId, name) =>
    set(s => ({ reactions: { ...s.reactions, [playerId]: { name, n: ++reactionCounter } } })),
  showToast: text => set({ toast: { text, n: Date.now() } }),
}));

/** Şu an uygulanan grafik kalitesi */
export function useQuality(): QualityLevel {
  return useApp(s => (s.quality === 'auto' ? s.autoLevel : s.quality));
}

/** Bu düzeyin üstündeki ses "konuşuyor" sayılır (isim etiketindeki mikrofon simgesi) */
export const SPEAKING_THRESHOLD = 0.08;

/** Oyuncunun anlık ses düzeyi; React çizimi tetiklemez, useFrame içinde okumak için */
export function speakingLevel(playerId: string): number {
  return useApp.getState().speaking[playerId] ?? 0;
}

/** Oyuncunun son bildirdiği bakış yönü (yoksa undefined); useFrame içinde okumak için */
export function lookOf(playerId: string): { yaw: number; pitch: number } | undefined {
  return useApp.getState().looks[playerId];
}

/** Bir ayarı değiştirir ve yerelde saklar */
export function setSetting(key: 'volume' | 'voiceVolume', value: number) {
  const v = Math.min(1, Math.max(0, value));
  // kaydırıcı aynı değeri tekrar gönderirse abonelere boşuna haber verilmez
  if (useApp.getState()[key] === v) return;
  try {
    localStorage.setItem(`uno.${key}`, String(v));
  } catch {
    /* depolama kapalı */
  }
  useApp.setState({ [key]: v } as Partial<AppState>);
}

export function setQuality(q: QualitySetting) {
  if (useApp.getState().quality === q) return;
  try {
    localStorage.setItem('uno.quality', q);
  } catch {
    /* depolama kapalı */
  }
  useApp.setState({ quality: q });
}

/** Masadaki dolu koltuklar, koltuk sırasıyla (oyun sırası da budur) */
export function seatedPlayers(room: RoomState | null) {
  return room ? room.seats.filter(s => s !== null) : [];
}
