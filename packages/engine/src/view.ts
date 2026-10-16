import { playableIds } from './game';
import type { GameEvent, GameState, PlayerView } from './types';

/** Bir oyuncunun görebileceği durum: rakip elleri sadece sayı olarak görünür. */
export function toPlayerView(s: GameState, playerId: string): PlayerView {
  const idx = s.players.findIndex(p => p.id === playerId);
  const me = idx >= 0 ? s.players[idx] : null;
  const myTurn = idx >= 0 && s.current === idx;
  return {
    you: playerId,
    players: s.players.map(p => ({ id: p.id, cardCount: p.hand.length })),
    hand: me ? me.hand.slice() : [],
    discardTop: s.discardPile.slice(-12),
    discardCount: s.discardPile.length,
    drawCount: s.drawPile.length,
    currentColor: s.currentColor,
    currentPlayerId: s.players[s.current].id,
    direction: s.direction,
    pendingDraw: s.pendingDraw,
    drawnCardId: myTurn ? s.drawnCardId : null,
    playableIds: idx >= 0 ? playableIds(s, idx) : [],
    phase: s.phase,
    winner: s.winner,
    rules: s.rules,
  };
}

/** Olaylardan başkasına ait gizli kart bilgilerini çıkarır. */
export function redactEvents(events: GameEvent[], playerId: string): GameEvent[] {
  return events.map(e => {
    if (e.type === 'CARD_DRAWN' && e.playerId !== playerId) {
      const { cards: _hidden, ...rest } = e;
      return rest;
    }
    if (e.type === 'CARDS_DEALT') {
      return {
        ...e,
        hands: e.hands.map(h => (h.playerId === playerId ? h : { playerId: h.playerId, count: h.count })),
      };
    }
    return e;
  });
}
