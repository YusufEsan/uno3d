import type { Server, Socket } from 'socket.io';
import type { Ack, Profile } from '@uno/protocol';
import { Room } from './Room';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byPlayer = new Map<string, Room>();

  constructor(private io: Server) {}

  private newCode() {
    let code = '';
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  private createRoom(isPrivate: boolean) {
    const room = new Room(this.newCode(), isPrivate, this.io, r => this.rooms.delete(r.code));
    this.rooms.set(room.code, room);
    return room;
  }

  roomOf(playerId: string) {
    const room = this.byPlayer.get(playerId);
    if (room && !room.has(playerId)) {
      this.byPlayer.delete(playerId);
      return undefined;
    }
    return room;
  }

  private enter(room: Room, playerId: string, socket: Socket, profile: Profile): Ack<{ code: string }> {
    const current = this.roomOf(playerId);
    // önce hedef odaya katılmayı dene: reddedilirse oyuncu eski odasında kalır
    const r = room.addHuman(playerId, socket, profile);
    if (!r.ok) return r;
    if (current && current !== room) current.removeHuman(playerId);
    this.byPlayer.set(playerId, room);
    return { ok: true, code: room.code };
  }

  create(playerId: string, socket: Socket, profile: Profile, isPrivate: boolean) {
    return this.enter(this.createRoom(isPrivate), playerId, socket, profile);
  }

  join(playerId: string, socket: Socket, profile: Profile, code: string): Ack<{ code: string }> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'Bu kodla bir oda bulunamadı' };
    return this.enter(room, playerId, socket, profile);
  }

  /** Hızlı oyun: boş koltuğu olan herkese açık bir lobiye oturtur, yoksa yeni oda açar */
  quick(playerId: string, socket: Socket, profile: Profile) {
    const open = [...this.rooms.values()].find(r => !r.isPrivate && !r.approval && r.status === 'lobby' && !r.isFull && !r.has(playerId));
    return this.enter(open ?? this.createRoom(false), playerId, socket, profile);
  }

  /** Kurucu bekleyen bir oyuncuyu kabul eder ya da reddeder */
  decide(hostId: string, playerId: string, accept: boolean): Ack {
    const room = this.roomOf(hostId);
    if (!room) return { ok: false, error: 'Bir odada değilsin' };
    const r = room.decide(hostId, playerId, accept);
    if (r.ok && accept) this.byPlayer.set(playerId, room);
    return r;
  }

  leave(playerId: string) {
    this.roomOf(playerId)?.removeHuman(playerId);
    this.byPlayer.delete(playerId);
  }

  onConnect(playerId: string, socket: Socket) {
    this.roomOf(playerId)?.reconnect(playerId, socket);
  }

  onDisconnect(playerId: string, socket: Socket) {
    this.roomOf(playerId)?.disconnect(playerId, socket);
  }
}
