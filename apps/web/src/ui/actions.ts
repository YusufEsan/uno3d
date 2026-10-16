import type { Card, Color } from '@uno/engine';
import { director } from '../game/director';
import { request, sendAction } from '../net/socket';
import { voice } from '../net/voice';
import { useApp } from '../store/useApp';

/** Çıkış düğmesi: önce onay penceresi açılır */
export function askLeave() {
  useApp.setState({ leaveAsk: true });
}

export async function leaveRoom() {
  useApp.setState({ leaveAsk: false });
  await request('room:leave');
  voice.leaveAll();
  director.clearTable();
  history.replaceState(null, '', location.pathname);
  useApp.setState({ room: null, view: null, chat: [], seq: 0, counts: {}, unoFlags: {}, pendingWild: null });
}

export function playCard(card: Card) {
  if (card.color === 'wild') useApp.setState({ pendingWild: card });
  else void sendAction({ type: 'PLAY', cardId: card.id });
}

export function chooseWildColor(color: Color) {
  const card = useApp.getState().pendingWild;
  useApp.setState({ pendingWild: null });
  if (card) void sendAction({ type: 'PLAY', cardId: card.id, color });
}

export const drawCard = () => void sendAction({ type: 'DRAW' });
export const passTurn = () => void sendAction({ type: 'PASS' });

director.onCardClick = playCard;
director.onDeckClick = () => {
  const v = useApp.getState().view;
  if (v && v.phase === 'playing' && v.currentPlayerId === v.you && !v.drawnCardId) drawCard();
};
