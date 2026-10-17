import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  applyAction,
  chooseBotAction,
  createGame,
  redactEvents,
  toPlayerView,
  type Action,
  type GameEvent,
  type GameState,
} from '@uno/engine';
import {
  MAX_SEATS,
  estimateAnimMs,
  type Ack,
  type ChatMessage,
  type GamePacket,
  type Profile,
  type RoomState,
  type SeatInfo,
  type ThemeId,
} from '@uno/protocol';

const BOT_NAMES = ['Rıza', 'Sevim', 'Hayri', 'Nermin', 'Cemil', 'Fikriye', 'Şevket', 'Leman'];
const LOBBY_GRACE_MS = 20_000;
const GAME_GRACE_MS = 60_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Room {
  seats: (SeatInfo | null)[] = Array(MAX_SEATS).fill(null);
  hostId = '';
  status: RoomState['status'] = 'lobby';
  theme: ThemeId = 'meyhane';
  stacking = false;
  botLevel: RoomState['botLevel'] = 'normal';
  scores: Record<string, number> = {};
  lastWinner: string | null = null;
  lastPoints = 0;
  charSeed = Math.floor(Math.random() * 2 ** 31);
  approval = false;
  private pending = new Map<string, { profile: Profile; socket: Socket }>();

  private game: GameState | null = null;
  private seq = 0;
  private turnDeadline = 0;
  private sockets = new Map<string, Socket>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private actionTimer: NodeJS.Timeout | null = null;
  private chatLog: ChatMessage[] = [];
  private lastEmote = new Map<string, number>();

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    private io: Server,
    private onEmpty: (room: Room) => void,
  ) {}

  // ---------- oturanlar ----------
  get humanCount() {
    return this.seats.filter(s => s && !s.isBot).length;
  }
  get occupied() {
    return this.seats.filter((s): s is SeatInfo => s !== null);
  }
  get isFull() {
    return this.occupied.length >= MAX_SEATS;
  }
  has(playerId: string) {
    return this.seats.some(s => s?.playerId === playerId);
  }
  private seatOf(playerId: string) {
    return this.seats.find(s => s?.playerId === playerId) ?? null;
  }

  addHuman(playerId: string, socket: Socket, profile: Profile): Ack {
    if (this.has(playerId)) {
      this.reconnect(playerId, socket);
      return { ok: true };
    }
    if (this.status === 'playing') return { ok: false, error: 'Oyun başlamış, bitmesini bekle' };
    if (this.approval && this.hostId) {
      // kurucu onaylayana kadar bekleme listesinde
      this.pending.set(playerId, { profile, socket });
      this.broadcastRoom();
      return { ok: false, error: 'Kurucunun onayı bekleniyor' };
    }
    return this.seat(playerId, socket, profile);
  }

  private seat(playerId: string, socket: Socket, profile: Profile): Ack {
    const i = this.seats.findIndex(s => s === null);
    if (i < 0) return { ok: false, error: 'Masa dolu' };
    this.seats[i] = { playerId, name: profile.name, avatar: profile.avatar, isBot: false, connected: true };
    if (!this.hostId) this.hostId = playerId;
    this.attach(playerId, socket);
    this.system(`${profile.name} masaya oturdu`);
    this.broadcastRoom();
    return { ok: true };
  }

  /** Bekleyen isteği kurucu kabul eder ya da reddeder */
  decide(hostId: string, playerId: string, accept: boolean): Ack {
    const denied = this.requireHost(hostId);
    if (denied) return denied;
    const p = this.pending.get(playerId);
    if (!p) return { ok: false, error: 'Bekleyen bir istek yok' };
    this.pending.delete(playerId);
    let result: Ack = { ok: true };
    if (accept) result = this.seat(playerId, p.socket, p.profile);
    if (!accept || !result.ok) p.socket.emit('room:rejected', { error: result.ok ? 'Kurucu isteğini reddetti' : result.error });
    this.broadcastRoom();
    return result;
  }

  private attach(playerId: string, socket: Socket) {
    this.sockets.set(playerId, socket);
    socket.join(this.code);
    socket.emit('chat:history', this.chatLog);
    if (this.game) this.sendSync(playerId);
  }

  reconnect(playerId: string, socket: Socket) {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    clearTimeout(this.graceTimers.get(playerId));
    this.graceTimers.delete(playerId);
    seat.connected = true;
    this.attach(playerId, socket);
    this.broadcastRoom();
  }

  disconnect(playerId: string, socket: Socket) {
    if (this.sockets.get(playerId) !== socket) return; // eski bağlantı
    this.sockets.delete(playerId);
    const seat = this.seatOf(playerId);
    if (!seat) return;
    seat.connected = false;
    this.broadcastRoom();
    const grace = this.status === 'playing' ? GAME_GRACE_MS : LOBBY_GRACE_MS;
    this.graceTimers.set(playerId, setTimeout(() => this.removeHuman(playerId), grace));
    if (this.game && this.currentId() === playerId) this.scheduleTurn([]); // sırası geldiyse bot devralsın
  }

  removeHuman(playerId: string) {
    const i = this.seats.findIndex(s => s?.playerId === playerId);
    if (i < 0) return;
    const seat = this.seats[i]!;
    clearTimeout(this.graceTimers.get(playerId));
    this.graceTimers.delete(playerId);
    this.sockets.get(playerId)?.leave(this.code);
    this.sockets.delete(playerId);

    if (this.status === 'playing' && this.game?.players.some(p => p.id === playerId)) {
      // oyun sürerken koltuk bota devredilir
      this.seats[i] = { ...seat, name: `${seat.name} (bot)`, isBot: true, connected: true };
      if (this.currentId() === playerId) this.scheduleTurn([]);
    } else {
      this.seats[i] = null;
    }
    this.system(`${seat.name} masadan kalktı`);

    if (this.humanCount === 0) return this.destroy();
    if (this.hostId === playerId) this.hostId = this.seats.find(s => s && !s.isBot)!.playerId;
    this.broadcastRoom();
  }

  private destroy() {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.onEmpty(this);
  }

  // ---------- lobi ----------
  private requireHost(playerId: string): Ack | null {
    if (playerId !== this.hostId) return { ok: false, error: 'Bunu sadece oda sahibi yapabilir' };
    if (this.status === 'playing') return { ok: false, error: 'Oyun sürerken yapılamaz' };
    return null;
  }

  addBot(playerId: string): Ack {
    const denied = this.requireHost(playerId);
    if (denied) return denied;
    const i = this.seats.findIndex(s => s === null);
    if (i < 0) return { ok: false, error: 'Masa dolu' };
    const used = new Set(this.occupied.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? 'Bot';
    // karakteri istemci bot kimliğinden seçer
    this.seats[i] = { playerId: `bot_${randomUUID().slice(0, 6)}`, name, avatar: 'bot', isBot: true, connected: true };
    this.broadcastRoom();
    return { ok: true };
  }

  removeBot(playerId: string, seat: number): Ack {
    const denied = this.requireHost(playerId);
    if (denied) return denied;
    if (!this.seats[seat]?.isBot) return { ok: false, error: 'Bu koltukta bot yok' };
    this.seats[seat] = null;
    this.broadcastRoom();
    return { ok: true };
  }

  updateSettings(playerId: string, s: { theme?: ThemeId; stacking?: boolean; botLevel?: RoomState['botLevel']; approval?: boolean }): Ack {
    const denied = this.requireHost(playerId);
    if (denied) return denied;
    if (s.theme) this.theme = s.theme;
    if (s.stacking !== undefined) this.stacking = s.stacking;
    if (s.botLevel) this.botLevel = s.botLevel;
    if (s.approval !== undefined) this.approval = s.approval;
    this.broadcastRoom();
    return { ok: true };
  }

  start(playerId: string): Ack {
    const denied = this.requireHost(playerId);
    if (denied) return denied;
    // oyun bittikten sonra çıkan botlara devredilmiş koltuklar boşalır
    const ids = this.occupied.map(s => s.playerId);
    if (ids.length < 2) return { ok: false, error: 'En az 2 oyuncu gerekli (bot ekleyebilirsin)' };
    // bekleyen istekler oyun boyunca karar bekleyemez: sahiplerine bildirilip temizlenir
    for (const p of this.pending.values()) p.socket.emit('room:rejected', { error: 'Oyun başladığı için istek iptal edildi' });
    this.pending.clear();
    const { state, events } = createGame(ids, { stacking: this.stacking, turnSeconds: 30 }, Math.floor(Math.random() * 2 ** 31));
    this.game = state;
    this.status = 'playing';
    // her oyunda karakterler yeniden ve birbirinden farklı dağıtılır
    this.charSeed = Math.floor(Math.random() * 2 ** 31);
    this.seq = 0;
    for (const id of ids) this.scores[id] ??= 0;
    this.broadcastRoom();
    this.afterAction(events);
    return { ok: true };
  }

  // ---------- oyun ----------
  private currentId() {
    return this.game ? this.game.players[this.game.current].id : null;
  }

  act(playerId: string, action: Action): Ack {
    if (!this.game || this.status !== 'playing') return { ok: false, error: 'Oyun başlamadı' };
    const r = applyAction(this.game, playerId, action);
    if (!r.ok) return r;
    this.game = r.state;
    this.afterAction(r.events);
    return { ok: true };
  }

  private afterAction(events: GameEvent[]) {
    if (this.game!.phase === 'ended') {
      this.finish(events);
      return;
    }
    this.scheduleTurn(events);
    this.sendEvents(events);
  }

  private scheduleTurn(events: GameEvent[]) {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    if (!this.game || this.game.phase !== 'playing') return;
    const animMs = estimateAnimMs(events);
    const pid = this.currentId()!;
    const seat = this.seatOf(pid);
    let delay: number;
    if (!seat || seat.isBot) {
      delay = animMs + rand(900, 1700);
      this.turnDeadline = 0;
    } else if (!seat.connected) {
      delay = animMs + 2500;
      this.turnDeadline = 0;
    } else {
      delay = animMs + this.game.rules.turnSeconds * 1000;
      this.turnDeadline = Date.now() + delay;
    }
    const turnSeq = this.game.turnSeq;
    const drawnBefore = this.game.drawnCardId;
    this.actionTimer = setTimeout(() => {
      const g = this.game;
      if (!g || g.phase !== 'playing' || this.currentId() !== pid) return;
      if (g.turnSeq !== turnSeq || g.drawnCardId !== drawnBefore) return;
      if (seat && !seat.isBot && seat.connected) this.system(`${seat.name} süresini doldurdu`);
      const level = seat?.isBot ? this.botLevel : 'easy';
      const action = chooseBotAction(toPlayerView(g, pid), level);
      if (action) this.act(pid, action);
    }, delay);
  }

  private sendEvents(events: GameEvent[]) {
    if (!this.game || !events.length) return;
    this.seq++;
    const turnEndsInMs = this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : 0;
    for (const [pid, socket] of this.sockets) {
      const packet: GamePacket = {
        events: redactEvents(events, pid),
        view: toPlayerView(this.game, pid),
        seq: this.seq,
        turnEndsInMs,
      };
      socket.emit('game:events', packet);
    }
  }

  sendSync(playerId: string) {
    const socket = this.sockets.get(playerId);
    if (!socket || !this.game) return;
    socket.emit('game:sync', {
      view: toPlayerView(this.game, playerId),
      seq: this.seq,
      turnEndsInMs: this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : 0,
    });
  }

  private finish(events: GameEvent[]) {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    const ended = events.find(e => e.type === 'GAME_ENDED');
    if (ended?.type === 'GAME_ENDED') {
      this.scores[ended.winnerId] = (this.scores[ended.winnerId] ?? 0) + ended.points;
      this.lastWinner = ended.winnerId;
      this.lastPoints = ended.points;
    }
    this.turnDeadline = 0;
    this.sendEvents(events);
    this.status = 'ended';
    this.broadcastRoom();
    const winner = this.seatOf(this.lastWinner ?? '');
    if (winner) this.system(`${winner.name} eli kazandı (+${this.lastPoints} puan)`);
  }

  // ---------- iletişim ----------
  private system(text: string) {
    this.pushChat({ id: randomUUID(), from: 'system', name: '', text, ts: Date.now(), system: true });
  }

  private pushChat(msg: ChatMessage) {
    this.chatLog.push(msg);
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.io.to(this.code).emit('chat:message', msg);
  }

  chat(playerId: string, text: string): Ack {
    const seat = this.seatOf(playerId);
    if (!seat) return { ok: false, error: 'Masada değilsin' };
    this.pushChat({ id: randomUUID(), from: playerId, name: seat.name, text, ts: Date.now() });
    return { ok: true };
  }

  emote(playerId: string, emote: string) {
    const now = Date.now();
    if (now - (this.lastEmote.get(playerId) ?? 0) < 900) return;
    this.lastEmote.set(playerId, now);
    this.io.to(this.code).emit('emote', { from: playerId, emote });
  }

  look(playerId: string, yaw: number, pitch: number) {
    this.sockets.get(playerId)?.to(this.code).volatile.emit('look', { from: playerId, yaw, pitch });
  }

  /** WebRTC sinyal mesajlarını (offer/answer/ICE) hedef oyuncuya iletir */
  signal(playerId: string, to: string, data: unknown) {
    if (!this.has(to)) return;
    this.sockets.get(to)?.emit('rtc:signal', { from: playerId, data });
  }

  state(): RoomState {
    return {
      code: this.code,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      seats: this.seats,
      status: this.status,
      theme: this.theme,
      stacking: this.stacking,
      botLevel: this.botLevel,
      scores: this.scores,
      lastWinner: this.lastWinner,
      lastPoints: this.lastPoints,
      charSeed: this.charSeed,
      approval: this.approval,
      pending: [...this.pending].map(([playerId, v]) => ({ playerId, name: v.profile.name, avatar: v.profile.avatar })),
    };
  }

  /** Oda durumu herkese gider; bekleyen katılma istekleri (isimler) yalnızca oda sahibine */
  broadcastRoom() {
    const full = this.state();
    for (const [pid, socket] of this.sockets) {
      socket.emit('room:state', pid === this.hostId ? full : { ...full, pending: [] });
    }
  }
}
