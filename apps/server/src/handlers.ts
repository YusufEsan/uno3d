import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { C2S, type Ack } from '@uno/protocol';
import { RoomManager } from './RoomManager';
import type { Room } from './Room';

/** Tarayıcı sekmesine özel oturum anahtarı → kalıcı oyuncu kimliği (yeniden bağlanma için) */
const sessions = new Map<string, string>();
const MAX_SESSIONS = 20000;

/**
 * Kayan pencere hız sınırı: en fazla `max` istek, `windowMs` içinde.
 * Son `max` kabulün zamanı halkada tutulur: her istekte sabit iş, yeni dizi oluşmaz (bakış saniyede onlarca gelir).
 */
function makeLimiter(max: number, windowMs: number) {
  const hits = new Array<number>(max).fill(-Infinity);
  let i = 0; // en eski kabulün yeri
  return () => {
    const now = Date.now();
    if (now - hits[i] < windowMs) return false;
    hits[i] = now;
    i = (i + 1) % max;
    return true;
  };
}

const OK = { ok: true } as const;

export function registerHandlers(io: Server) {
  const rooms = new RoomManager(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 100) return next(new Error('Geçersiz oturum'));
    let playerId = sessions.get(token);
    if (!playerId) {
      // en eski oturumu at: sınırsız büyüme olmasın
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      playerId = `p_${randomUUID().slice(0, 8)}`;
      sessions.set(token, playerId);
    }
    socket.data.playerId = playerId;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const pid: string = socket.data.playerId;
    // her bağlantının kendi hız sınırları: sohbet, bakış, katılma denemesi, sinyal, hamle,
    // lobi ayarları (her biri herkese oda durumu yayar) ve tam durum isteği
    const limits = {
      chat: makeLimiter(8, 10_000),
      look: makeLimiter(30, 1_000),
      join: makeLimiter(10, 60_000),
      signal: makeLimiter(40, 1_000),
      action: makeLimiter(20, 1_000),
      lobby: makeLimiter(20, 5_000),
      sync: makeLimiter(10, 5_000),
    };
    socket.emit('session', { playerId: pid });
    rooms.onConnect(pid, socket);

    /** Doğrulanmış istek: geçersiz veri sunucuya hiç ulaşmaz */
    function on<S extends z.ZodType>(
      event: string,
      schema: S,
      handler: (data: z.infer<S>) => Ack<object> | void,
      limit?: () => boolean,
    ) {
      socket.on(event, (payload: unknown, ack?: (r: Ack<object>) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (limit && !limit()) return reply({ ok: false, error: 'Çok hızlı, biraz bekle' });
        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) return reply({ ok: false, error: 'Geçersiz istek' });
        try {
          reply(handler(parsed.data) ?? OK);
        } catch (err) {
          console.error(`[${event}]`, err);
          reply({ ok: false, error: 'Sunucu hatası' });
        }
      });
    }

    /** Oyuncunun oturduğu oda üzerinde işlem */
    const inRoom = (fn: (room: Room) => Ack<object> | void): Ack<object> | void => {
      const room = rooms.roomOf(pid);
      if (!room) return { ok: false, error: 'Bir odada değilsin' };
      return fn(room);
    };

    on('room:create', C2S.create, d => rooms.create(pid, socket, { name: d.name, avatar: d.avatar }, d.isPrivate, d.approval ?? false), limits.join);
    on('room:join', C2S.join, d => rooms.join(pid, socket, { name: d.name, avatar: d.avatar }, d.code), limits.join);
    on('room:quick', C2S.quick, d => rooms.quick(pid, socket, d), limits.join);
    on('room:leave', C2S.empty, () => rooms.leave(pid));
    on('room:addBot', C2S.empty, () => inRoom(r => r.addBot(pid)), limits.lobby);
    on('room:removeBot', C2S.seat, d => inRoom(r => r.removeBot(pid, d.seat)), limits.lobby);
    on('room:settings', C2S.settings, d => inRoom(r => r.updateSettings(pid, d)), limits.lobby);
    on('room:start', C2S.empty, () => inRoom(r => r.start(pid)), limits.lobby);
    on('room:decide', C2S.decide, d => rooms.decide(pid, d.playerId, d.accept), limits.lobby);
    on('game:action', C2S.action, d => inRoom(r => r.act(pid, d)), limits.action);
    on('game:sync', C2S.empty, () => inRoom(r => r.sendSync(pid)), limits.sync);
    on('chat:send', C2S.chat, d => inRoom(r => r.chat(pid, d.text)), limits.chat);
    on('emote', C2S.emote, d => inRoom(r => r.emote(pid, d.emote)));
    on('look', C2S.look, d => inRoom(r => r.look(pid, d.yaw, d.pitch)), limits.look);
    on('rtc:signal', C2S.signal, d => inRoom(r => r.signal(pid, d.to, d.data)), limits.signal);

    socket.on('disconnect', () => rooms.onDisconnect(pid, socket));
  });
}
