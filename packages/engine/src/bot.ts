import { COLORS, type Action, type Card, type Color, type PlayerView } from './types';

export type BotLevel = 'easy' | 'normal' | 'hard';

function bestColor(hand: Card[], excludeId: string, rand: () => number): Color {
  const counts: Record<string, number> = {};
  for (const c of hand) if (c.id !== excludeId && c.color !== 'wild') counts[c.color] = (counts[c.color] ?? 0) + 1;
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return (sorted[0] as Color | undefined) ?? COLORS[Math.floor(rand() * COLORS.length)];
}

export function chooseBotAction(view: PlayerView, level: BotLevel = 'normal', rand: () => number = Math.random): Action | null {
  if (view.phase !== 'playing' || view.currentPlayerId !== view.you) return null;
  const hand = view.hand;
  const playable = hand.filter(c => view.playableIds.includes(c.id));
  const play = (c: Card): Action => ({
    type: 'PLAY',
    cardId: c.id,
    color: c.color === 'wild' ? bestColor(hand, c.id, rand) : undefined,
  });

  if (view.drawnCardId) {
    const drawn = playable.find(c => c.id === view.drawnCardId);
    return drawn ? play(drawn) : { type: 'PASS' };
  }
  if (!playable.length) return { type: 'DRAW' };
  if (level === 'easy') return play(playable[Math.floor(rand() * playable.length)]);

  const n = view.players.length;
  const me = view.players.findIndex(p => p.id === view.you);
  const next = view.players[(((me + view.direction) % n) + n) % n];
  const danger = next.cardCount <= 2;
  const colorCount = (c: Card) => hand.filter(h => h.color === c.color).length;

  const score = (c: Card) => {
    let sc = 0;
    if (c.color === view.currentColor) sc += 2;
    if (c.color === 'wild') sc -= level === 'hard' && danger ? -4 : 3; // wild'ları sona sakla
    if (c.value === 'skip' || c.value === 'reverse' || c.value === 'draw2') sc += danger && level === 'hard' ? 6 : 1;
    sc += colorCount(c) * 0.3;
    return sc + rand() * 0.5;
  };
  const pick = playable.reduce((best, c) => (score(c) > score(best) ? c : best));
  return play(pick);
}
