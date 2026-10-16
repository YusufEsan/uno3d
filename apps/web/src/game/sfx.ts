import { useApp } from '../store/useApp';

/** Ses dosyası gerektirmeyen, WebAudio ile sentezlenen efektler */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// efekt sesi düzeyi ayar penceresinden değişince anında uygulanır
useApp.subscribe(s => {
  if (master) master.gain.value = s.volume;
});

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = useApp.getState().volume;
  return ctx;
}

function noise(dur: number, freq: number, q: number, gain: number, when = 0, sweepTo?: number) {
  const c = ac();
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, when = 0, slideTo?: number) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const safe = (fn: () => void) => () => {
  try {
    fn();
  } catch {
    /* ses kapalı / izin yok */
  }
};

export const sfx = {
  deal: safe(() => noise(0.06, 3800, 1.2, 0.18)),
  slap: safe(() => {
    noise(0.14, 1600, 0.7, 0.6);
    tone(110, 0.1, 'sine', 0.3);
  }),
  draw: safe(() => noise(0.2, 2400, 1.5, 0.25, 0, 5000)),
  shuffle: safe(() => {
    for (let i = 0; i < 10; i++) noise(0.05, 3000 + Math.random() * 1500, 1.5, 0.15, i * 0.045);
  }),
  whoosh: safe(() => noise(0.45, 400, 0.8, 0.35, 0, 2500)),
  skip: safe(() => tone(320, 0.3, 'square', 0.06, 0, 110)),
  penalty: safe(() => {
    tone(220, 0.15, 'sawtooth', 0.07);
    tone(165, 0.25, 'sawtooth', 0.07, 0.12);
  }),
  magic: safe(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.08, i * 0.06))),
  uno: safe(() => {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.25, 'square', 0.06, i * 0.07));
    noise(0.4, 900, 0.6, 0.2, 0.25);
  }),
  turn: safe(() => tone(880, 0.15, 'sine', 0.12)),
  tick: safe(() => tone(1200, 0.04, 'square', 0.03)),
  win: safe(() => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, i * 0.12))),
  lose: safe(() => [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.08, i * 0.2))),
  pop: safe(() => tone(600, 0.08, 'sine', 0.1, 0, 900)),
};
