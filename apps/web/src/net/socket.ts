import { io } from 'socket.io-client';
import type { Ack, ChatMessage, GamePacket, RoomState } from '@uno/protocol';
import type { PlayerView } from '@uno/engine';
import { withDirector } from '../game/directorLoader';
import { useApp, type ReactionName } from '../store/useApp';
import { getToken } from './session';
import { voice } from './voice';

/** Aynı adresteki sunucuya bağlanır (geliştirmede Vite proxy'si aktarır) */
// Pages gibi statik barındırmada oyun sunucusunun adresi derleme sırasında verilir; yoksa aynı kaynak kullanılır
// Doğrudan WebSocket ile başlanır: önce HTTP long-polling açıp sonra yükseltme turu beklenmez (bağlantı
// daha hızlı kurulur, yükseltme sırasında mesajlar gecikmez). WebSocket'i engelleyen ağlarda polling'e düşülür.
export const socket = io(import.meta.env.VITE_SERVER_URL || undefined, {
  autoConnect: false,
  auth: { token: getToken() },
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
});

export function request<T extends object = object>(event: string, payload: unknown = {}): Promise<Ack<T>> {
  return new Promise(resolve => {
    socket.timeout(6000).emit(event, payload, (err: Error | null, res: Ack<T>) => {
      resolve(err ? { ok: false, error: 'Sunucuya ulaşılamadı' } : res);
    });
  });
}

const set = useApp.setState;

/** Bağlantı durumu yalnızca gerçekten değişince yazılır (yeniden bağlanma denemeleri her seferinde abonelere haber vermesin) */
const setConnected = (connected: boolean) => {
  if (useApp.getState().connected !== connected) set({ connected });
};

socket.on('connect', () => setConnected(true));
socket.on('disconnect', () => setConnected(false));
socket.on('connect_error', () => setConnected(false));
socket.on('session', ({ playerId }: { playerId: string }) => set({ playerId }));

/** İki nesnenin alanları birebir aynı mı (tek seviye) */
function shallowEqual(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

/** Değişmeyen elemanlar eski nesneleriyle değiştirilir; hiçbiri değişmediyse eski liste döner */
function shareList<T extends object | null>(prev: T[], next: T[]): T[] {
  let same = prev.length === next.length;
  const out = next.map((x, i) => {
    const p = prev[i];
    if (p !== undefined && shallowEqual(p, x)) return p;
    same = false;
    return x;
  });
  return same ? prev : out;
}

/**
 * Sunucu her seferinde odanın tamamını gönderir. Değişmeyen parçalar (koltuklar, puanlar) eski nesnelerle
 * paylaşılır; oda hiç değişmediyse eski nesne döner ve abonelere haber verilmez (gereksiz çizim olmaz).
 */
function shareRoom(prev: RoomState | null, next: RoomState): RoomState {
  if (!prev || prev.code !== next.code) return next;
  const merged: RoomState = {
    ...next,
    seats: shareList(prev.seats, next.seats),
    pending: shareList(prev.pending, next.pending),
    scores: shallowEqual(prev.scores, next.scores) ? prev.scores : next.scores,
  };
  return shallowEqual(prev, merged) ? prev : merged;
}

socket.on('room:state', (incoming: RoomState) => {
  const prev = useApp.getState().room;
  const room = shareRoom(prev, incoming);
  if (room !== prev) set({ room });
  if (prev?.status === 'playing' && room.status === 'lobby') withDirector(d => d.clearTable());
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
  withDirector(d => d.enqueue(p.events, p.view));
});

socket.on('game:sync', (p: { view: PlayerView; seq: number; turnEndsInMs: number }) => {
  set({ seq: p.seq, turnDeadline: p.turnEndsInMs ? Date.now() + p.turnEndsInMs : 0 });
  withDirector(d => d.reset(p.view));
});

socket.on('emote', ({ from, emote }: { from: string; emote: ReactionName }) => {
  useApp.getState().react(from, emote);
});

// bakış mesajları saniyede onlarca gelir: avatarlar bunu her karede getState() ile okur, React çizimi
// gerekmez. Değerler yerinde güncellenir; yalnızca yeni bir oyuncu ilk kez göründüğünde abonelere haber verilir.
socket.on('look', ({ from, yaw, pitch }: { from: string; yaw: number; pitch: number }) => {
  const looks = useApp.getState().looks;
  const l = looks[from];
  if (l) {
    l.yaw = yaw;
    l.pitch = pitch;
  } else set({ looks: { ...looks, [from]: { yaw, pitch } } });
});

socket.on('rtc:signal', ({ from, data }: { from: string; data: unknown }) => {
  void voice.handleSignal(from, data);
});

/** Masada bu oyuncunun bakışını görecek başka bağlı insan oyuncu var mı (botlar bakış mesajı kullanmaz) */
function othersWatching(): boolean {
  const { room, playerId } = useApp.getState();
  return !!room?.seats.some(s => s && !s.isBot && s.connected && s.playerId !== playerId);
}

/**
 * Bakış yönünü diğer oyunculara gönderir. Kaybolabilir (volatile): ağ yoğunsa eski bakış sıraya girmez.
 * Bağlantı yoksa ya da masada başka insan yoksa hiç gönderilmez. Seyreltme (zaman/eşik) çağıranın işidir.
 */
export function sendLook(yaw: number, pitch: number) {
  if (!socket.connected || !othersWatching()) return;
  socket.volatile.emit('look', { yaw: Math.round(yaw * 1000) / 1000, pitch: Math.round(pitch * 1000) / 1000 });
}

/** Hamle gönder; reddedilirse uyar ve masayı sunucuyla eşitle */
export async function sendAction(action: unknown) {
  const r = await request('game:action', action);
  if (!r.ok) {
    useApp.getState().showToast(r.error);
    socket.emit('game:sync', {});
  }
}
