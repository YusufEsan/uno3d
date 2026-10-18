import { z } from 'zod';
import { COLORS, type GameEvent, type PlayerView } from '@uno/engine';

export const MAX_SEATS = 4;

/** Karakter kimliği (istemcideki karakter dosyasının adı). Botlar için "bot": istemci kimlikten seçer. */
export type AvatarId = string;
const AvatarIdSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export const THEMES = [
  { id: 'meyhane', name: 'Loş Meyhane' },
  { id: 'neon', name: 'Neon Kulüp' },
  { id: 'casino', name: 'Kumarhane' },
  { id: 'ocean', name: 'Gece Denizi' },
  { id: 'desert', name: 'Çöl Gün Batımı' },
  { id: 'clouds', name: 'Bulutların Üstü' },
  { id: 'plane', name: 'Uçağın Üstü' },
  { id: 'balloon', name: 'Sıcak Hava Balonu' },
  { id: 'bus', name: 'Otobüs Yolculuğu' },
  { id: 'boat', name: 'Tekne Gezisi' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
const THEME_IDS = THEMES.map(t => t.id) as [ThemeId, ...ThemeId[]];

export const EMOTES = [
  { id: 'wave', label: 'El salla', key: '1' },
  { id: 'laugh', label: 'Gül', key: '2' },
  { id: 'thumbsUp', label: 'Beğen', key: '3' },
  { id: 'angry', label: 'Masaya vur', key: '4' },
  { id: 'no', label: 'Hayır', key: '5' },
  { id: 'dance', label: 'Dans', key: '6' },
  { id: 'clap', label: 'Alkışla', key: '7' },
  { id: 'point', label: 'Göster', key: '8' },
  { id: 'shock', label: 'Şaşır', key: '9' },
  { id: 'yell', label: 'Bağır', key: '0' },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];
const EMOTE_IDS = EMOTES.map(e => e.id) as [EmoteId, ...EmoteId[]];

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const;

// ---------- istemci → sunucu ----------
export const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(16),
  avatar: AvatarIdSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const C2S = {
  create: ProfileSchema.extend({ isPrivate: z.boolean(), approval: z.boolean().optional() }),
  join: ProfileSchema.extend({ code: z.string().trim().toUpperCase().length(5) }),
  quick: ProfileSchema,
  settings: z.object({
    theme: z.enum(THEME_IDS).optional(),
    stacking: z.boolean().optional(),
    botLevel: z.enum(BOT_LEVELS).optional(),
    approval: z.boolean().optional(),
  }),
  decide: z.object({ playerId: z.string().min(1).max(64), accept: z.boolean() }),
  seat: z.object({ seat: z.number().int().min(0).max(MAX_SEATS - 1) }),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('PLAY'), cardId: z.string().max(10), color: z.enum(COLORS).optional() }),
    z.object({ type: z.literal('DRAW') }),
    z.object({ type: z.literal('PASS') }),
  ]),
  chat: z.object({ text: z.string().trim().min(1).max(200) }),
  emote: z.object({ emote: z.enum(EMOTE_IDS) }),
  look: z.object({ yaw: z.number().min(-2).max(2), pitch: z.number().min(-1.5).max(1.5) }),
  // WebRTC sinyali küçük olmalı (SDP birkaç KB'ı geçmez); büyük veri diğer oyunculara iletilmez
  signal: z.object({
    to: z.string().max(64),
    data: z.unknown().refine(v => JSON.stringify(v ?? null).length <= 16384, 'Sinyal çok büyük'),
  }),
  empty: z.object({}).optional(),
};

// ---------- sunucu → istemci ----------
export interface SeatInfo {
  playerId: string;
  name: string;
  avatar: AvatarId;
  isBot: boolean;
  connected: boolean;
}

export interface RoomState {
  code: string;
  isPrivate: boolean;
  hostId: string;
  seats: (SeatInfo | null)[];
  status: 'lobby' | 'playing' | 'ended';
  theme: ThemeId;
  stacking: boolean;
  botLevel: (typeof BOT_LEVELS)[number];
  scores: Record<string, number>;
  lastWinner: string | null;
  lastPoints: number;
  /** katılma isteklerini kurucu onaylar */
  approval: boolean;
  /** onay bekleyen oyuncular */
  pending: { playerId: string; name: string; avatar: AvatarId }[];
  /** Karakter dağıtımı için ortak rastgele sayı: her oyun başında yenilenir, herkes aynı dağıtımı görür */
  charSeed: number;
}

export interface GamePacket {
  events: GameEvent[];
  view: PlayerView;
  seq: number;
  /** Sıradaki insan oyuncunun kalan süresi (ms), animasyon süresi dahil */
  turnEndsInMs: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** İstemcideki animasyonların yaklaşık süresi: sunucu botları ve süreyi buna göre bekletir. */
export function estimateAnimMs(events: GameEvent[]): number {
  let ms = 0;
  for (const e of events) {
    switch (e.type) {
      case 'GAME_STARTED': ms += 1400; break;
      case 'CARDS_DEALT': ms += e.hands.length * e.perPlayer * 60 + 600; break;
      case 'FIRST_CARD': ms += 900; break;
      case 'CARD_PLAYED': ms += 1050; break;
      case 'CARD_DRAWN': ms += 450 + e.count * 130; break;
      case 'COLOR_CHOSEN': ms += 600; break;
      case 'DIRECTION_REVERSED': ms += 800; break;
      case 'PLAYER_SKIPPED': ms += 700; break;
      case 'DRAW_STACKED': ms += 500; break;
      case 'UNO': ms += 1000; break;
      case 'DECK_RESHUFFLED': ms += 1200; break;
      case 'GAME_ENDED': ms += 2500; break;
      default: break;
    }
  }
  return ms;
}
