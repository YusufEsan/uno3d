export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = (typeof COLORS)[number];

export type NumberValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type ActionValue = 'skip' | 'reverse' | 'draw2';
export type WildValue = 'wild' | 'wild4';
export type Value = NumberValue | ActionValue | WildValue;

export interface Card {
  id: string;
  color: Color | 'wild';
  value: Value;
}

export interface HouseRules {
  /** +2 üstüne +2, +2/+4 üstüne +4 atılabilir; ceza birikir */
  stacking: boolean;
  /** Bir oyuncunun hamle süresi (saniye) */
  turnSeconds: number;
}

export const DEFAULT_RULES: HouseRules = { stacking: false, turnSeconds: 30 };

export interface PlayerState {
  id: string;
  hand: Card[];
}

export interface GameState {
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: Color;
  current: number;
  direction: 1 | -1;
  /** stacking açıkken biriken ceza kartı sayısı */
  pendingDraw: number;
  /** Bu tur çekilen ve hâlâ oynanabilecek kart */
  drawnCardId: string | null;
  phase: 'playing' | 'ended';
  winner: string | null;
  rules: HouseRules;
  rng: number;
  turnSeq: number;
}

export type Action =
  | { type: 'PLAY'; cardId: string; color?: Color }
  | { type: 'DRAW' }
  | { type: 'PASS' };

export type DrawReason = 'draw' | 'penalty';

export type GameEvent =
  | { type: 'GAME_STARTED'; playerIds: string[] }
  | { type: 'CARDS_DEALT'; perPlayer: number; hands: { playerId: string; count: number; cards?: Card[] }[] }
  | { type: 'FIRST_CARD'; card: Card; color: Color }
  | { type: 'CARD_PLAYED'; playerId: string; card: Card; color: Color }
  | { type: 'CARD_DRAWN'; playerId: string; count: number; cards?: Card[]; reason: DrawReason }
  | { type: 'COLOR_CHOSEN'; playerId: string; color: Color }
  | { type: 'DIRECTION_REVERSED'; direction: 1 | -1 }
  | { type: 'PLAYER_SKIPPED'; playerId: string }
  | { type: 'DRAW_STACKED'; pending: number; targetId: string }
  | { type: 'UNO'; playerId: string }
  | { type: 'DECK_RESHUFFLED'; count: number }
  | { type: 'TURN_CHANGED'; playerId: string }
  | { type: 'GAME_ENDED'; winnerId: string; points: number; hands: Record<string, Card[]> };

export interface PlayerView {
  you: string;
  players: { id: string; cardCount: number }[];
  hand: Card[];
  discardTop: Card[];
  discardCount: number;
  drawCount: number;
  currentColor: Color;
  currentPlayerId: string;
  direction: 1 | -1;
  pendingDraw: number;
  drawnCardId: string | null;
  playableIds: string[];
  phase: 'playing' | 'ended';
  winner: string | null;
  rules: HouseRules;
}

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
