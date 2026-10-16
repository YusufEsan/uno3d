import type { RoomState } from '@uno/protocol';
import { useApp } from '../store/useApp';
import { socket } from './socket';

const ICE: RTCConfiguration = {
  // Not: Sıkı NAT arkasındaki oyuncular için ileride bir TURN sunucusu eklenmeli
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  pendingIce: RTCIceCandidateInit[];
}

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

/**
 * Masadaki insan oyuncular arasında doğrudan (mesh) sesli sohbet.
 * 4 kişilik masada her oyuncunun en fazla 3 bağlantısı olur. Sinyalleşme oyun sunucusu üzerinden yapılır.
 */
class VoiceMesh {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private meter: number | null = null;

  private audioCtx() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private analyse(stream: MediaStream) {
    const ctx = this.audioCtx();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    return an;
  }

  private level(an: AnalyserNode | null) {
    if (!an) return 0;
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }

  private startMeter() {
    if (this.meter !== null) return;
    this.meter = window.setInterval(() => {
      const me = useApp.getState().playerId;
      const next: Record<string, number> = {};
      for (const [id, p] of this.peers) next[id] = +this.level(p.analyser).toFixed(2);
      if (me) next[me] = useApp.getState().micOn ? +this.level(this.localAnalyser).toFixed(2) : 0;
      useApp.setState({ speaking: next });
    }, 90);
  }

  /** Bağlı tüm oyuncuların sesini ayarlar */
  setOutputVolume(v: number) {
    for (const p of this.peers.values()) p.audio.volume = v;
  }

  async toggleMic(): Promise<boolean> {
    const on = !useApp.getState().micOn;
    if (on && !this.local) {
      try {
        this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.localAnalyser = this.analyse(this.local);
      } catch {
        useApp.getState().showToast('Mikrofona erişilemedi');
        return false;
      }
    }
    const track = this.local?.getAudioTracks()[0] ?? null;
    if (track) track.enabled = on;
    for (const p of this.peers.values()) {
      const sender = p.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender;
      if (sender && sender.track !== track) await sender.replaceTrack(track);
    }
    useApp.setState({ micOn: on });
    this.startMeter();
    return on;
  }

  /** Odadaki bağlı insan oyunculara göre bağlantıları aç/kapat */
  syncPeers(room: RoomState | null) {
    const me = useApp.getState().playerId;
    const humans = new Set(room ? room.seats.filter(s => s && !s.isBot && s.connected && s.playerId !== me).map(s => s!.playerId) : []);
    for (const id of [...this.peers.keys()]) if (!humans.has(id)) this.close(id);
    if (!me) return;
    for (const id of humans) {
      // çakışmayı önlemek için teklifi her zaman küçük kimlikli taraf yapar
      if (!this.peers.has(id) && me < id) void this.call(id);
    }
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    audio.volume = useApp.getState().voiceVolume;
    const peer: Peer = { pc, audio, analyser: null, pendingIce: [] };
    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('rtc:signal', { to: id, data: { ice: e.candidate.toJSON() } satisfies Signal });
    };
    pc.ontrack = e => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      peer.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.close(id);
    };
    this.peers.set(id, peer);
    this.startMeter();
    return peer;
  }

  private async call(id: string) {
    const peer = this.createPeer(id);
    const t = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    const track = this.local?.getAudioTracks()[0];
    if (track && useApp.getState().micOn) await t.sender.replaceTrack(track);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    socket.emit('rtc:signal', { to: id, data: { sdp: peer.pc.localDescription!.toJSON() } satisfies Signal });
  }

  async handleSignal(from: string, raw: unknown) {
    const data = raw as Signal;
    let peer = this.peers.get(from);
    try {
      if (data.sdp?.type === 'offer') {
        if (peer) this.close(from);
        peer = this.createPeer(from);
        await peer.pc.setRemoteDescription(data.sdp);
        const t = peer.pc.getTransceivers()[0];
        if (t) {
          t.direction = 'sendrecv';
          const track = this.local?.getAudioTracks()[0];
          if (track && useApp.getState().micOn) await t.sender.replaceTrack(track);
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('rtc:signal', { to: from, data: { sdp: peer.pc.localDescription!.toJSON() } satisfies Signal });
      } else if (data.sdp?.type === 'answer' && peer) {
        await peer.pc.setRemoteDescription(data.sdp);
      } else if (data.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice);
        else peer.pendingIce.push(data.ice);
        return;
      }
      if (peer?.pc.remoteDescription) {
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c);
      }
    } catch (err) {
      console.warn('sesli sohbet sinyal hatası', err);
    }
  }

  private close(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
  }

  leaveAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
  }
}

export const voice = new VoiceMesh();

// sesli sohbet düzeyi ayar penceresinden değişince bağlı tüm oyuncular için uygulanır
useApp.subscribe((s, prev) => {
  if (s.voiceVolume === prev.voiceVolume) return;
  voice.setOutputVolume(s.voiceVolume);
});
