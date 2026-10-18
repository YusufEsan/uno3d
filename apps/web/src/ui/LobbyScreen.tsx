import { useState } from 'react';
import { MAX_SEATS } from '@uno/protocol';
import { assignCharacters } from '../scene/characters';
import { request } from '../net/socket';
import { useApp } from '../store/useApp';
import { askLeave } from './actions';
import { ThemePicker } from './ThemePicker';

const LEVELS = [
  { id: 'easy', label: 'Kolay' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Zor' },
] as const;

export function Switch({ on, disabled, onToggle, label }: { on: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle}>
      <span />
    </button>
  );
}

export function LobbyScreen() {
  const room = useApp(s => s.room)!;
  const me = useApp(s => s.playerId);
  const isHost = room.hostId === me;
  const [copied, setCopied] = useState(false);
  const filled = room.seats.filter(Boolean).length;
  const characters = assignCharacters(room);

  const call = async (event: string, payload: object = {}) => {
    const r = await request(event, payload);
    if (!r.ok) useApp.getState().showToast(r.error);
  };

  const link = `${location.origin}${location.pathname}?oda=${room.code}`;

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <div className="lobby-head">
          <div>
            <div className="muted small">{room.isPrivate ? 'Özel oda' : 'Herkese açık oda'}</div>
            <div className="code">{room.code}</div>
          </div>
          <button
            className="btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Kopyalandı ✓' : 'Davet linkini kopyala'}
          </button>
        </div>

        <ul className="seats">
          {Array.from({ length: MAX_SEATS }, (_, i) => {
            const s = room.seats[i];
            if (!s)
              return (
                <li key={i} className="seat empty">
                  <span className="muted">Boş koltuk</span>
                  {isHost && (
                    <button className="btn tiny" onClick={() => call('room:addBot')}>
                      + Bot
                    </button>
                  )}
                </li>
              );
            const color = characters[s.playerId]?.color;
            return (
              <li key={i} className="seat">
                <span className="dot" style={{ background: color }} />
                <span className="nm">{s.name}</span>
                {s.playerId === room.hostId && <span className="tag gold">Oda sahibi</span>}
                {s.playerId === me && <span className="tag">Sen</span>}
                {s.isBot && <span className="tag">BOT</span>}
                {!s.connected && <span className="tag">bağlantı yok</span>}
                {isHost && s.isBot && (
                  <button className="btn tiny ghost" onClick={() => call('room:removeBot', { seat: i })}>
                    Çıkar
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {isHost && room.pending.length > 0 && (
          <section className="lobby-card requests">
            <h3>Katılma istekleri</h3>
            {room.pending.map(p => (
              <div key={p.playerId} className="request">
                <span className="nm">{p.name}</span>
                <div className="request-actions">
                  <button className="btn tiny ghost" onClick={() => call('room:decide', { playerId: p.playerId, accept: false })}>
                    Reddet
                  </button>
                  <button className="btn tiny primary" disabled={filled >= MAX_SEATS} onClick={() => call('room:decide', { playerId: p.playerId, accept: true })}>
                    Kabul et
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="lobby-card">
          <h3>Masa teması</h3>
          <ThemePicker />
        </section>

        <section className="lobby-card">
          <h3>Bot zorluğu</h3>
          <div className="segmented three" role="radiogroup" aria-label="Bot zorluğu">
            {LEVELS.map(l => (
              <button
                key={l.id}
                role="radio"
                aria-checked={room.botLevel === l.id}
                className={room.botLevel === l.id ? 'active' : ''}
                disabled={!isHost}
                onClick={() => call('room:settings', { botLevel: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="lobby-card">
          <h3>Kurallar ve katılım</h3>
          <div className="setting-row">
            <div>
              <span className="setting-title">Ceza birikir</span>
              <span className="setting-hint">+2 / +4 üst üste atılabilir</span>
            </div>
            <Switch label="Ceza birikir" on={room.stacking} disabled={!isHost} onToggle={() => call('room:settings', { stacking: !room.stacking })} />
          </div>
          <div className="setting-row">
            <div>
              <span className="setting-title">Katılma onayı</span>
              <span className="setting-hint">Yeni gelenleri sen kabul edersin</span>
            </div>
            <Switch label="Katılma onayı" on={room.approval} disabled={!isHost} onToggle={() => call('room:settings', { approval: !room.approval })} />
          </div>
        </section>

        <div className="actions">
          {isHost ? (
            <button className="btn primary big" disabled={filled < 2} onClick={() => call('room:start')}>
              {filled < 2 ? 'En az 2 oyuncu gerekli' : 'Oyunu Başlat'}
            </button>
          ) : (
            <div className="muted">Oda sahibinin oyunu başlatması bekleniyor…</div>
          )}
          <button className="btn ghost" onClick={askLeave}>
            Odadan çık
          </button>
        </div>
      </div>
    </div>
  );
}
