import { describe, expect, it } from 'vitest';
import { isPlayable, playableIds, wild4Allowed } from '../src/game';
import type { Card, GameState } from '../src/types';

const card = (id: string, color: Card['color'], value: Card['value']): Card => ({ id, color, value });

function state(hand: Card[], currentColor: Card['color'] = 'red'): GameState {
  return {
    players: [{ id: 'a', hand }, { id: 'b', hand: [] }],
    drawPile: [],
    discardPile: [card('top', 'red', '5')],
    currentColor,
    current: 0,
    direction: 1,
    pendingDraw: 0,
    drawnCardId: null,
    phase: 'playing',
    winner: null,
    rules: { stacking: false, turnSeconds: 30 },
    rng: 1,
    turnSeq: 0,
  } as unknown as GameState;
}

describe('Wild Draw Four kuralı', () => {
  it('elde mevcut renkten kart varken +4 oynanamaz', () => {
    const hand = [card('r', 'red', '7'), card('w4', 'wild', 'wild4')];
    const s = state(hand);
    expect(isPlayable(s, hand[1])).toBe(true);
    expect(wild4Allowed(s, hand, hand[1])).toBe(false);
    expect(playableIds(s, 0)).toEqual(['r']);
  });

  it('elde mevcut renkten kart yoksa +4 oynanabilir', () => {
    const hand = [card('b', 'blue', '7'), card('w4', 'wild', 'wild4')];
    expect(playableIds(state(hand), 0)).toEqual(['w4']);
  });
});
