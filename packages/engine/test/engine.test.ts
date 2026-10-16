import { describe, expect, it } from 'vitest';
import {
  applyAction,
  chooseBotAction,
  createDeck,
  createGame,
  redactEvents,
  toPlayerView,
  type Card,
  type GameState,
} from '../src';

const card = (id: string, color: Card['color'], value: Card['value']): Card => ({ id, color, value });

/** Elle kurulmuş, kontrollü bir oyun durumu */
function makeState(hands: Card[][], top: Card, extra: Partial<GameState> = {}): GameState {
  return {
    players: hands.map((hand, i) => ({ id: `p${i}`, hand })),
    drawPile: Array.from({ length: 20 }, (_, i) => card(`d${i}`, 'blue', '5')),
    discardPile: [top],
    currentColor: top.color === 'wild' ? 'red' : top.color,
    current: 0,
    direction: 1,
    pendingDraw: 0,
    drawnCardId: null,
    phase: 'playing',
    winner: null,
    rules: { stacking: false, turnSeconds: 30 },
    rng: 1,
    turnSeq: 0,
    ...extra,
  };
}

function play(s: GameState, playerId: string, cardId: string, color?: 'red' | 'blue' | 'green' | 'yellow') {
  const r = applyAction(s, playerId, { type: 'PLAY', cardId, color });
  if (!r.ok) throw new Error(r.error);
  return r;
}

const filler = () => [card('x1', 'green', '1'), card('x2', 'green', '2'), card('x3', 'green', '3')];

describe('deste', () => {
  it('108 karttan oluşur', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter(c => c.value === 'wild4')).toHaveLength(4);
    expect(deck.filter(c => c.value === '0')).toHaveLength(4);
    expect(deck.filter(c => c.color === 'red')).toHaveLength(25);
    expect(new Set(deck.map(c => c.id)).size).toBe(108);
  });
});

describe('oyun kurulumu', () => {
  it('herkese 7 kart dağıtır ve ilk kart renk seç olmaz', () => {
    for (let seed = 1; seed < 50; seed++) {
      const { state, events } = createGame(['a', 'b', 'c'], undefined, seed);
      const total = state.players.reduce((n, p) => n + p.hand.length, 0) + state.drawPile.length + state.discardPile.length;
      expect(total).toBe(108);
      expect(state.discardPile[0].color).not.toBe('wild');
      expect(events[0].type).toBe('GAME_STARTED');
    }
  });

  it('aynı seed aynı oyunu üretir', () => {
    const a = createGame(['a', 'b'], undefined, 42).state;
    const b = createGame(['a', 'b'], undefined, 42).state;
    expect(a.players[0].hand).toEqual(b.players[0].hand);
  });
});

describe('kart kuralları', () => {
  it('renk veya sayı eşleşmeyen kart oynanamaz, sırası olmayan oynayamaz', () => {
    const s = makeState([[card('a', 'blue', '3'), ...filler()], filler()], card('t', 'red', '7'));
    expect(applyAction(s, 'p0', { type: 'PLAY', cardId: 'a' }).ok).toBe(false);
    expect(applyAction(s, 'p1', { type: 'DRAW' }).ok).toBe(false);
  });

  it('sayı eşleşmesi geçerli ve sıra ilerler', () => {
    const s = makeState([[card('a', 'blue', '7'), ...filler()], filler()], card('t', 'red', '7'));
    const r = play(s, 'p0', 'a');
    expect(r.state.current).toBe(1);
    expect(r.state.currentColor).toBe('blue');
  });

  it('Atla kartı sıradaki oyuncuyu atlar', () => {
    const s = makeState([[card('a', 'red', 'skip'), ...filler()], filler(), filler()], card('t', 'red', '1'));
    const r = play(s, 'p0', 'a');
    expect(r.state.current).toBe(2);
    expect(r.events.some(e => e.type === 'PLAYER_SKIPPED' && e.playerId === 'p1')).toBe(true);
  });

  it('Yön Değiştir yönü çevirir', () => {
    const s = makeState([[card('a', 'red', 'reverse'), ...filler()], filler(), filler()], card('t', 'red', '1'));
    const r = play(s, 'p0', 'a');
    expect(r.state.direction).toBe(-1);
    expect(r.state.current).toBe(2);
  });

  it('2 kişide Yön Değiştir atla gibi çalışır', () => {
    const s = makeState([[card('a', 'red', 'reverse'), ...filler()], filler()], card('t', 'red', '1'));
    expect(play(s, 'p0', 'a').state.current).toBe(0);
  });

  it('+2 sıradakine 2 kart çektirir ve atlar', () => {
    const s = makeState([[card('a', 'red', 'draw2'), ...filler()], filler(), filler()], card('t', 'red', '1'));
    const r = play(s, 'p0', 'a');
    expect(r.state.players[1].hand).toHaveLength(5);
    expect(r.state.current).toBe(2);
  });

  it('+4 renk seçtirir, 4 kart çektirir ve atlar', () => {
    const s = makeState([[card('a', 'wild', 'wild4'), ...filler()], filler(), filler()], card('t', 'red', '1'));
    expect(applyAction(s, 'p0', { type: 'PLAY', cardId: 'a' }).ok).toBe(false); // renk seçmeden olmaz
    const r = play(s, 'p0', 'a', 'blue');
    expect(r.state.currentColor).toBe('blue');
    expect(r.state.players[1].hand).toHaveLength(7);
    expect(r.state.current).toBe(2);
  });

  it('stacking açıkken +2 cezası birikir', () => {
    const s = makeState(
      [[card('a', 'red', 'draw2'), ...filler()], [card('b', 'blue', 'draw2'), ...filler()], filler()],
      card('t', 'red', '1'),
      { rules: { stacking: true, turnSeconds: 30 } },
    );
    const r1 = play(s, 'p0', 'a');
    expect(r1.state.pendingDraw).toBe(2);
    const r2 = play(r1.state, 'p1', 'b');
    expect(r2.state.pendingDraw).toBe(4);
    const r3 = applyAction(r2.state, 'p2', { type: 'DRAW' });
    if (!r3.ok) throw new Error(r3.error);
    expect(r3.state.players[2].hand).toHaveLength(7);
    expect(r3.state.current).toBe(0);
  });

  it('çekilen kart oynanabiliyorsa sıra kalır, oynanamıyorsa geçer', () => {
    const s = makeState([filler(), filler()], card('t', 'blue', '9'));
    const r = applyAction(s, 'p0', { type: 'DRAW' }); // destede mavi 5'ler var → oynanabilir
    if (!r.ok) throw new Error(r.error);
    expect(r.state.current).toBe(0);
    expect(r.state.drawnCardId).toBe('d19');
    const pass = applyAction(r.state, 'p0', { type: 'PASS' });
    expect(pass.ok && pass.state.current).toBe(1);

    const s2 = makeState([filler(), filler()], card('t', 'red', '9'));
    const r2 = applyAction(s2, 'p0', { type: 'DRAW' });
    expect(r2.ok && r2.state.current).toBe(1);
  });

  it('tek kart kalınca otomatik UNO olayı üretilir', () => {
    const s = makeState([[card('a', 'red', '4'), card('b', 'green', '1')], filler()], card('t', 'red', '1'));
    const r = play(s, 'p0', 'a');
    expect(r.events.some(e => e.type === 'UNO' && e.playerId === 'p0')).toBe(true);
  });

  it('son kartı atan kazanır ve puanı hesaplanır', () => {
    const s = makeState([[card('a', 'red', '4')], [card('b', 'wild', 'wild'), card('c', 'red', 'skip'), card('d', 'red', '3')]], card('t', 'red', '1'));
    const r = play(s, 'p0', 'a');
    expect(r.state.phase).toBe('ended');
    const ended = r.events.find(e => e.type === 'GAME_ENDED');
    expect(ended && ended.type === 'GAME_ENDED' && ended.points).toBe(73);
  });

  it('deste bitince atılan kartlar karıştırılıp desteye döner', () => {
    const s = makeState([filler(), filler()], card('t', 'red', '9'), {
      drawPile: [],
      discardPile: [card('o1', 'yellow', '2'), card('o2', 'yellow', '3'), card('t', 'red', '9')],
    });
    const r = applyAction(s, 'p0', { type: 'DRAW' });
    if (!r.ok) throw new Error(r.error);
    expect(r.events[0].type).toBe('DECK_RESHUFFLED');
    expect(r.state.discardPile).toHaveLength(1);
  });
});

describe('görünüm', () => {
  it('rakip kartları gizlenir', () => {
    const { state, events } = createGame(['a', 'b'], undefined, 3);
    const view = toPlayerView(state, 'a');
    expect(view.hand).toEqual(state.players[0].hand);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.players[1].hand[0]));
    const dealt = redactEvents(events, 'a').find(e => e.type === 'CARDS_DEALT');
    expect(dealt && dealt.type === 'CARDS_DEALT' && dealt.hands[1].cards).toBeUndefined();
  });
});

describe('botlar', () => {
  it('botlar kendi aralarında yüzlerce oyunu hatasız bitirir', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ids = ['a', 'b', 'c', 'd'].slice(0, 2 + (seed % 3));
      let { state } = createGame(ids, { stacking: seed % 2 === 0, turnSeconds: 30 }, seed);
      let guard = 0;
      while (state.phase === 'playing') {
        const pid = state.players[state.current].id;
        const action = chooseBotAction(toPlayerView(state, pid), seed % 3 === 0 ? 'hard' : 'normal');
        if (!action) throw new Error('bot hamle bulamadı');
        const r = applyAction(state, pid, action);
        if (!r.ok) throw new Error(`seed ${seed}: ${r.error}`);
        state = r.state;
        if (++guard > 5000) throw new Error(`seed ${seed}: oyun bitmedi`);
      }
      const total = state.players.reduce((n, p) => n + p.hand.length, 0) + state.drawPile.length + state.discardPile.length;
      expect(total).toBe(108);
    }
  });
});
