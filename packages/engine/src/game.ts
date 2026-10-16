import { cardPoints, createDeck, shuffle } from './deck';
import {
  DEFAULT_RULES,
  type Action,
  type ApplyResult,
  type Card,
  type DrawReason,
  type GameEvent,
  type GameState,
  type HouseRules,
} from './types';

const HAND_SIZE = 7;

const nextIndex = (s: GameState, from: number, steps = 1) => {
  const n = s.players.length;
  return (((from + s.direction * steps) % n) + n) % n;
};

function setTurn(s: GameState, ev: GameEvent[], index: number) {
  s.current = index;
  s.drawnCardId = null;
  s.turnSeq++;
  ev.push({ type: 'TURN_CHANGED', playerId: s.players[index].id });
}

function reshuffle(s: GameState, ev: GameEvent[]) {
  if (s.discardPile.length <= 1) return;
  const top = s.discardPile.pop()!;
  const rest = shuffle(s.discardPile, s);
  s.discardPile = [top];
  s.drawPile = rest.concat(s.drawPile);
  ev.push({ type: 'DECK_RESHUFFLED', count: rest.length });
}

function drawCards(s: GameState, ev: GameEvent[], playerIndex: number, count: number, reason: DrawReason): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (!s.drawPile.length) reshuffle(s, ev);
    if (!s.drawPile.length) break;
    drawn.push(s.drawPile.pop()!);
  }
  const player = s.players[playerIndex];
  player.hand.push(...drawn);
  if (drawn.length) ev.push({ type: 'CARD_DRAWN', playerId: player.id, count: drawn.length, cards: drawn, reason });
  return drawn;
}

export function isPlayable(s: GameState, card: Card): boolean {
  const top = s.discardPile[s.discardPile.length - 1];
  if (s.pendingDraw > 0) {
    // ceza birikmişken sadece üstüne ceza kartı atılabilir
    return card.value === 'wild4' || (card.value === 'draw2' && top.value === 'draw2');
  }
  return card.color === 'wild' || card.color === s.currentColor || card.value === top.value;
}

export function playableIds(s: GameState, playerIndex: number): string[] {
  if (s.phase !== 'playing' || s.current !== playerIndex) return [];
  const hand = s.players[playerIndex].hand;
  if (s.drawnCardId) {
    const drawn = hand.find(c => c.id === s.drawnCardId);
    return drawn && isPlayable(s, drawn) ? [drawn.id] : [];
  }
  return hand.filter(c => isPlayable(s, c)).map(c => c.id);
}

/** Oynanan (veya ilk açılan) kartın etkisini uygular ve sırayı ilerletir. */
function applyCardEffect(s: GameState, ev: GameEvent[], card: Card, fromIndex: number) {
  switch (card.value) {
    case 'skip': {
      const target = nextIndex(s, fromIndex);
      ev.push({ type: 'PLAYER_SKIPPED', playerId: s.players[target].id });
      setTurn(s, ev, nextIndex(s, target));
      break;
    }
    case 'reverse': {
      s.direction = s.direction === 1 ? -1 : 1;
      ev.push({ type: 'DIRECTION_REVERSED', direction: s.direction });
      if (s.players.length === 2) {
        // 2 kişide yön değiştir = atla
        const target = nextIndex(s, fromIndex);
        ev.push({ type: 'PLAYER_SKIPPED', playerId: s.players[target].id });
        setTurn(s, ev, nextIndex(s, target));
      } else {
        setTurn(s, ev, nextIndex(s, fromIndex));
      }
      break;
    }
    case 'draw2':
    case 'wild4': {
      const amount = card.value === 'draw2' ? 2 : 4;
      const target = nextIndex(s, fromIndex);
      if (s.rules.stacking) {
        s.pendingDraw += amount;
        ev.push({ type: 'DRAW_STACKED', pending: s.pendingDraw, targetId: s.players[target].id });
        setTurn(s, ev, target);
      } else {
        drawCards(s, ev, target, amount, 'penalty');
        ev.push({ type: 'PLAYER_SKIPPED', playerId: s.players[target].id });
        setTurn(s, ev, nextIndex(s, target));
      }
      break;
    }
    default:
      setTurn(s, ev, nextIndex(s, fromIndex));
  }
}

function endGame(s: GameState, ev: GameEvent[], winnerIndex: number) {
  s.phase = 'ended';
  const winner = s.players[winnerIndex];
  s.winner = winner.id;
  const hands: Record<string, Card[]> = {};
  let points = 0;
  for (const p of s.players) {
    hands[p.id] = p.hand.slice();
    if (p !== winner) points += p.hand.reduce((sum, c) => sum + cardPoints(c), 0);
  }
  ev.push({ type: 'GAME_ENDED', winnerId: winner.id, points, hands });
}

export function createGame(
  playerIds: string[],
  rules: HouseRules = DEFAULT_RULES,
  seed: number = Date.now(),
): { state: GameState; events: GameEvent[] } {
  if (playerIds.length < 2 || playerIds.length > 10) throw new Error('2-10 oyuncu gerekli');
  const s: GameState = {
    players: playerIds.map(id => ({ id, hand: [] })),
    drawPile: createDeck(),
    discardPile: [],
    currentColor: 'red',
    current: 0,
    direction: 1,
    pendingDraw: 0,
    drawnCardId: null,
    phase: 'playing',
    winner: null,
    rules,
    rng: seed >>> 0,
    turnSeq: 0,
  };
  shuffle(s.drawPile, s);
  const ev: GameEvent[] = [{ type: 'GAME_STARTED', playerIds: [...playerIds] }];

  for (let r = 0; r < HAND_SIZE; r++) for (const p of s.players) p.hand.push(s.drawPile.pop()!);
  ev.push({
    type: 'CARDS_DEALT',
    perPlayer: HAND_SIZE,
    hands: s.players.map(p => ({ playerId: p.id, count: p.hand.length, cards: p.hand.slice() })),
  });

  // ilk kart renk seç kartı olamaz: destenin altına koyup tekrar çek
  let first = s.drawPile.pop()!;
  while (first.color === 'wild') {
    s.drawPile.unshift(first);
    first = s.drawPile.pop()!;
  }
  s.discardPile.push(first);
  s.currentColor = first.color as GameState['currentColor'];
  ev.push({ type: 'FIRST_CARD', card: first, color: s.currentColor });

  // ilk kart aksiyon kartıysa etkisi, dağıtıcı (son oyuncu) oynamış gibi uygulanır
  applyCardEffect(s, ev, first, s.players.length - 1);
  return { state: s, events: ev };
}

const fail = (error: string): ApplyResult => ({ ok: false, error });

export function applyAction(state: GameState, playerId: string, action: Action): ApplyResult {
  if (state.phase !== 'playing') return fail('Oyun bitti');
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx < 0) return fail('Bu oyunda değilsin');
  if (state.current !== idx) return fail('Sıra sende değil');

  const s: GameState = JSON.parse(JSON.stringify(state)); // durum düz JSON, derin kopya yeterli
  const ev: GameEvent[] = [];
  const player = s.players[idx];

  switch (action.type) {
    case 'PLAY': {
      const ci = player.hand.findIndex(c => c.id === action.cardId);
      if (ci < 0) return fail('Bu kart elinde değil');
      const card = player.hand[ci];
      if (s.drawnCardId && s.drawnCardId !== card.id) return fail('Sadece çektiğin kartı oynayabilirsin');
      if (!isPlayable(s, card)) return fail('Bu kart şu an oynanamaz');
      if (card.color === 'wild' && !action.color) return fail('Bir renk seçmelisin');

      player.hand.splice(ci, 1);
      s.discardPile.push(card);
      s.currentColor = card.color === 'wild' ? action.color! : card.color;
      s.drawnCardId = null;
      ev.push({ type: 'CARD_PLAYED', playerId, card, color: s.currentColor });
      if (card.color === 'wild') ev.push({ type: 'COLOR_CHOSEN', playerId, color: s.currentColor });

      if (player.hand.length === 0) {
        endGame(s, ev, idx);
        break;
      }
      // tek kart kalınca UNO otomatik söylenir
      if (player.hand.length === 1) ev.push({ type: 'UNO', playerId });
      applyCardEffect(s, ev, card, idx);
      break;
    }

    case 'DRAW': {
      if (s.drawnCardId) return fail('Zaten kart çektin: oyna ya da pas geç');
      if (s.pendingDraw > 0) {
        const amount = s.pendingDraw;
        s.pendingDraw = 0;
        drawCards(s, ev, idx, amount, 'penalty');
        ev.push({ type: 'PLAYER_SKIPPED', playerId });
        setTurn(s, ev, nextIndex(s, idx));
        break;
      }
      const [drawn] = drawCards(s, ev, idx, 1, 'draw');
      if (drawn && isPlayable(s, drawn)) s.drawnCardId = drawn.id; // aynı oyuncu çektiği kartı oynayabilir
      else setTurn(s, ev, nextIndex(s, idx));
      break;
    }

    case 'PASS': {
      if (!s.drawnCardId) return fail('Pas geçmek için önce kart çekmelisin');
      setTurn(s, ev, nextIndex(s, idx));
      break;
    }

    default:
      return fail('Bilinmeyen hamle');
  }

  return { ok: true, state: s, events: ev };
}
