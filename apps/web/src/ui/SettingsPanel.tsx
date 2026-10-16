import type { CSSProperties } from 'react';
import { setQuality, setSetting, useApp, type QualitySetting } from '../store/useApp';
import { voice } from '../net/voice';

const QUALITY_NAME = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' } as const;

/** Ayarlar penceresini açan yuvarlak düğme; her ekranda kullanılabilir */
export function SettingsButton() {
  return (
    <button
      className="icon-btn"
      title="Ayarlar"
      aria-label="Ayarlar"
      onClick={() => useApp.setState({ settingsOpen: true })}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.2 4.3l1.8-1.4-1.9-3.3-2.2.8a7 7 0 0 0-1.6-.9L16 5.9h-3.8l-.4 2.3c-.6.2-1.1.5-1.6.9l-2.2-.8-1.9 3.3 1.8 1.4a7 7 0 0 0 0 1.9l-1.8 1.4 1.9 3.3 2.2-.8c.5.4 1 .7 1.6.9l.4 2.3H16l.4-2.3c.6-.2 1.1-.5 1.6-.9l2.2.8 1.9-3.3-1.8-1.4a7 7 0 0 0 0-1.9z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

const QUALITY_OPTIONS: { id: QualitySetting; label: string }[] = [
  { id: 'auto', label: 'Otomatik' },
  { id: 'high', label: 'Yüksek' },
  { id: 'medium', label: 'Orta' },
  { id: 'low', label: 'Düşük' },
];

function Slider({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="setting">
      <span className="setting-label">
        <span>
          <span className="setting-title">{label}</span>
          {hint && <span className="setting-hint"> · {hint}</span>}
        </span>
        <b>{Math.round(value * 100)}</b>
      </span>
      <span className="slider" style={{ '--p': `${value * 100}%` } as CSSProperties}>
        <span className="slider-track" />
        <span className="slider-fill" />
        <span className="slider-knob" />
        <input type="range" min={0} max={1} step={0.05} value={value} onChange={e => onChange(+e.target.value)} />
      </span>
    </label>
  );
}

/** Ses, grafik ve mikrofon ayarları. Değişiklikler anında uygulanır ve saklanır. */
export function SettingsPanel() {
  const open = useApp(s => s.settingsOpen);
  const volume = useApp(s => s.volume);
  const voiceVolume = useApp(s => s.voiceVolume);
  const micOn = useApp(s => s.micOn);
  const quality = useApp(s => s.quality);
  const autoLevel = useApp(s => s.autoLevel);
  if (!open) return null;
  const close = () => useApp.setState({ settingsOpen: false });

  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="panel settings" role="dialog" aria-label="Ayarlar">
        <header className="settings-head">
          <div>
            <h2>Ayarlar</h2>
            <p>Değişiklikler anında uygulanır</p>
          </div>
          <button className="icon-btn" aria-label="Kapat" onClick={close}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <section className="settings-card">
          <h3>Ses</h3>
          <Slider label="Efekt sesi" value={volume} onChange={v => setSetting('volume', v)} />
          <Slider
            label="Sesli sohbet"
            hint="diğer oyuncular"
            value={voiceVolume}
            onChange={v => {
              setSetting('voiceVolume', v);
              voice.setOutputVolume(v);
            }}
          />
          <div className="setting-row">
            <div>
              <span className="setting-title">Mikrofon</span>
              <span className="setting-hint">{micOn ? 'Sesin masadakilere iletiliyor' : 'Kapalı'}</span>
            </div>
            <button
              className={`switch ${micOn ? 'on' : ''}`}
              role="switch"
              aria-checked={micOn}
              aria-label="Mikrofon"
              onClick={() => void voice.toggleMic()}
            >
              <span />
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h3>Grafik</h3>
          <div className="segmented" role="radiogroup" aria-label="Kalite">
            {QUALITY_OPTIONS.map(o => (
              <button
                key={o.id}
                role="radio"
                aria-checked={quality === o.id}
                className={quality === o.id ? 'active' : ''}
                onClick={() => setQuality(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="setting-hint">
            {quality === 'auto' ? `Kare hızına göre otomatik: ${QUALITY_NAME[autoLevel]}` : 'Elle seçildi'}
          </p>
        </section>
      </div>
    </div>
  );
}
