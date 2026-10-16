import { io } from 'socket.io-client';
import type { Ack, ChatMessage, GamePacket, RoomState } from '@uno/protocol';
import type { PlayerView } from '@uno/engine';
import { director } from '../game/director';
import { useApp, type ReactionName } from '../store/useApp';
import { getToken } from './session';
import { voice } from './voice';

/** Aynı adresteki sunucuya bağlanır (geliştirmede Vite proxy'si aktarır) */
export const socket = io({ autoConnect: false, auth: { token: getToken() } });

export function request<T extends object = object>(event: string, payload: unknown = {}): Promise<Ack<T>> {
  return new Promise(resolve => {
    socket.timeout(6000).emit(event, payload, (err: Error | null, res: Ack<T>) => {
      resolve(err ? { ok: false, error: 'Sunucuya ulaşılamadı' } : res);
    });
  });
}

const set = useApp.setState;

socket.on('connect', () => set({ connected: true }));
socket.on('disconnect', () => set({ connected: false }));
socket.on('connect_error', () => set({ connected: false }));
socket.on('session', ({ playerId }: { playerId: string }) => set({ playerId }));

socket.on('room:state', (room: RoomState) => {
  const prev = useApp.getState().room;
  set({ room });
  if (prev?.status === 'playing' && room.status === 'lobby') director.clearTable();
  voice.syncPeers(room);
});

socket.on('room:rejected', ({ error }: { error: string }) => {
  set({ room: null, view: null });
  useApp.getState().showToast(error);
});

socket.on('chat:history', (chat: ChatMessage[]) => set({ chat }));
socket.on('chat:message', (msg: ChatMessage) => set(s => ({ chat: [...s.chat.slice(-80), msg] })));

socket.on('game:events', (p: GamePacket) => {
  const st = useApp.getState();
  const starting = p.events.some(e => e.type === 'GAME_STARTED');
  if (!starting && st.seq && p.seq !== st.seq + 1) {
    // olay kaçırıldı: tam durumu iste
    socket.emit('game:sync', {});
    return;
  }
  set({ seq: p.seq, turnDeadline: p.turnEndsInMs ? Date.now() + p.turnEndsInMs : 0 });
  director.enqueue(p.events, p.view);
});

socket.on('game:sync', (p: { view: PlayerView; seq: number; turnEndsInMs: number }) => {
  set({ seq: p.seq, turnDeadline: p.turnEndsInMs ? Date.now() + p.turnEndsInMs : 0 });
  director.reset(p.view);
});

socket.on('emote', ({ from, emote }: { from: string; emote: ReactionName }) => {
  useApp.getState().react(from, emote);
});

socket.on('look', ({ from, yaw, pitch }: { from: string; yaw: number; pitch: number }) => {
  useApp.setState(s => ({ looks: { ...s.looks, [from]: { yaw, pitch } } }));
});

socket.on('rtc:signal', ({ from, data }: { from: string; data: unknown }) => {
  void voice.handleSignal(from, data);
});

/** Hamle gönder; reddedilirse uyar ve masayı sunucuyla eşitle */
export async function sendAction(action: unknown) {
  const r = await request('game:action', action);
  if (!r.ok) {
    useApp.getState().showToast(r.error);
    socket.emit('game:sync', {});
  }
}
