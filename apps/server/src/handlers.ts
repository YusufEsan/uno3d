import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { C2S, type Ack } from '@uno/protocol';
import { RoomManager } from './RoomManager';
import type { Room } from './Room';

/** Tarayıcı sekmesine özel oturum anahtarı → kalıcı oyuncu kimliği (yeniden bağlanma için) */
const sessions = new Map<string, string>();

export function registerHandlers(io: Server) {
  const rooms = new RoomManager(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length < 16 || token.length > 100) return next(new Error('Geçersiz oturum'));
    let playerId = sessions.get(token);
    if (!playerId) {
      playerId = `p_${randomUUID().slice(0, 8)}`;
      sessions.set(token, playerId);
    }
    socket.data.playerId = playerId;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const pid: string = socket.data.playerId;
    socket.emit('session', { playerId: pid });
    rooms.onConnect(pid, socket);

    /** Doğrulanmış istek: geçersiz veri sunucuya hiç ulaşmaz */
    function on<S extends z.ZodType>(event: string, schema: S, handler: (data: z.infer<S>) => Ack<object> | void) {
      socket.on(event, (payload: unknown, ack?: (r: Ack<object>) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) return reply({ ok: false, error: 'Geçersiz istek' });
        try {
          reply(handler(parsed.data) ?? { ok: true });
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

    on('room:create', C2S.create, d => rooms.create(pid, socket, { name: d.name, avatar: d.avatar }, d.isPrivate));
    on('room:join', C2S.join, d => rooms.join(pid, socket, { name: d.name, avatar: d.avatar }, d.code));
    on('room:quick', C2S.quick, d => rooms.quick(pid, socket, d));
    on('room:leave', C2S.empty, () => rooms.leave(pid));
    on('room:addBot', C2S.empty, () => inRoom(r => r.addBot(pid)));
    on('room:removeBot', C2S.seat, d => inRoom(r => r.removeBot(pid, d.seat)));
    on('room:settings', C2S.settings, d => inRoom(r => r.updateSettings(pid, d)));
    on('room:start', C2S.empty, () => inRoom(r => r.start(pid)));
    on('room:decide', C2S.decide, d => rooms.decide(pid, d.playerId, d.accept));
    on('game:action', C2S.action, d => inRoom(r => r.act(pid, d)));
    on('game:sync', C2S.empty, () => inRoom(r => r.sendSync(pid)));
    on('chat:send', C2S.chat, d => inRoom(r => r.chat(pid, d.text)));
    on('emote', C2S.emote, d => inRoom(r => r.emote(pid, d.emote)));
    on('look', C2S.look, d => inRoom(r => r.look(pid, d.yaw, d.pitch)));
    on('rtc:signal', C2S.signal, d => inRoom(r => r.signal(pid, d.to, d.data)));

    socket.on('disconnect', () => rooms.onDisconnect(pid, socket));
  });
}
