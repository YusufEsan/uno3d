import { COLORS, type Card, type Value } from './types';

/** 108 kartlık standart deste */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const add = (color: Card['color'], value: Value) => cards.push({ id: `c${n++}`, color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (let v = 1; v <= 9; v++) {
      add(color, String(v) as Value);
      add(color, String(v) as Value);
    }
    for (const v of ['skip', 'reverse', 'draw2'] as const) {
      add(color, v);
      add(color, v);
    }
  }
  for (let i = 0; i < 4; i++) {
    add('wild', 'wild');
    add('wild', 'wild4');
  }
  return cards;
}

/** mulberry32 — seed'li, deterministik rastgele sayı üreteci */
export function nextRandom(holder: { rng: number }): number {
  holder.rng = (holder.rng + 0x6d2b79f5) | 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(arr: T[], holder: { rng: number }): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(holder) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cardPoints(card: Card): number {
  if (card.color === 'wild') return 50;
  if (card.value === 'skip' || card.value === 'reverse' || card.value === 'draw2') return 20;
  return Number(card.value);
}

export const isNumberCard = (card: Card) => !Number.isNaN(Number(card.value));
