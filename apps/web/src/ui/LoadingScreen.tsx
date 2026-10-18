import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { THEMES } from '@uno/protocol';
import { useApp } from '../store/useApp';

/** Gösteride açılıp kapanan kartlar: renk ve yüz */
const CARDS = [
  { color: '#e5322d', face: '7' },
  { color: '#f5c400', face: '+2' },
  { color: '#2fa84f', face: '⇄' },
  { color: '#1e6fd9', face: '⊘' },
  { color: 'wild', face: '+4' },
];

const TIPS = [
  'Kartlar karıştırılıyor…',
  'Karakterler sandalyelere yerleşiyor…',
  '+4’ler bileniyor…',
  'Masa siliniyor, çuha düzeltiliyor…',
  'Rakipler poker yüzünü takıyor…',
  '“UNO!” demeyi unutma…',
  'Işıklar ayarlanıyor…',
];

/**
 * Oyuna girerken karakterler, hareketler ve sahne yüklenirken gösterilen ekran.
 * Yükleme bitince yumuşakça kaybolur (bir an ekranda kalıp kapanış animasyonu oynar).
 */
export function LoadingScreen({ show }: { show: boolean }) {
  const progress = useApp(s => s.assetProgress);
  const themeId = useApp(s => s.room?.theme);
  const [mounted, setMounted] = useState(show);
  const [tip, setTip] = useState(0);
  // ekranda gösterilen yüzde, gerçek ilerlemeye doğru akarak sayar;
  // ara değer ref'te tutulur, ekran yalnızca tam sayı yüzde değişince yeniden çizilir
  const shown = useRef(0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 650);
    return () => clearTimeout(t);
  }, [show]);

  useEffect(() => {
    if (!mounted) return;
    const t = setInterval(() => setTip(i => (i + 1) % TIPS.length), 2200);
    return () => clearInterval(t);
  }, [mounted]);

  const target = show ? progress : 1;
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    const step = () => {
      const v = shown.current;
      const next = v + (target - v) * 0.12;
      shown.current = Math.abs(target - next) < 0.002 ? target : next;
      setPct(Math.round(shown.current * 100));
      // hedefe varınca döngü durur: yükleme beklerken her kare boşuna çalışmaz
      if (shown.current !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, mounted]);

  if (!mounted) return null;
  const themeName = THEMES.find(t => t.id === themeId)?.name ?? 'Masa';

  return (
    <div className={`loader ${show ? '' : 'leaving'}`} role="status" aria-live="polite" aria-label={`Yükleniyor, yüzde ${pct}`}>
      <div className="loader-bg" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>

      <h1 className="logo loader-logo" aria-hidden="true">
        UNO <span>3D</span>
      </h1>

      <div className="loader-stage" aria-hidden="true">
        {CARDS.map((c, i) => (
          <div
            key={i}
            className="lc"
            style={
              {
                '--i': i,
                '--x': `${(i - 2) * 56}px`,
                '--r': `${(i - 2) * 13}deg`,
                '--y': `${Math.abs(i - 2) * 11}px`,
              } as CSSProperties
            }
          >
            <div className="lc-inner">
              <div className={`lc-face ${c.color === 'wild' ? 'wild' : ''}`} style={{ '--c': c.color } as CSSProperties}>
                <span className="lc-corner tl">{c.face}</span>
                <span className="lc-oval">
                  <b>{c.face}</b>
                </span>
                <span className="lc-corner br">{c.face}</span>
              </div>
              <div className="lc-back">
                <span>UNO</span>
              </div>
            </div>
          </div>
        ))}
        <div className="loader-shadow" />
      </div>

      <div className="loader-text">
        <div className="loader-theme">
          <span className="dot" />
          {themeName} hazırlanıyor
        </div>
        <div className="loader-tip" key={tip}>
          {TIPS[tip]}
        </div>
      </div>

      <div className="loader-progress">
        <div className="loader-track">
          <span className="loader-fill" style={{ width: `${pct}%` }} />
          <span className="loader-runner" style={{ left: `${pct}%` }} />
        </div>
        <b className="loader-pct">{pct}%</b>
      </div>
    </div>
  );
}
