import { memo, useEffect, useState } from 'react';
import { COLORS } from '@uno/engine';
import { EMOTES } from '@uno/protocol';
import { COLOR_HEX, COLOR_NAME } from '../config';
import { request, socket } from '../net/socket';
import { voice } from '../net/voice';
import { useApp } from '../store/useApp';
import { SettingsButton } from './SettingsPanel';
import { askLeave, chooseWildColor, drawCard, passTurn, shuffleHand, sortHand, wireDirector } from './actions';
import { ChatPanel } from './ChatPanel';
import { ThemePicker } from './ThemePicker';

export function GameHud() {
  // oyun ekranı açılınca masa motoruna kart tıklamaları bağlanır
  useEffect(() => wireDirector(), []);
  const view = useApp(s => s.view);
  const room = useApp(s => s.room)!;
  const me = useApp(s => s.playerId);
  const pendingWild = useApp(s => s.pendingWild);
  const nameOf = (id: string) => room.seats.find(s => s?.playerId === id)?.name ?? '?';

  const myTurn = !!view && view.phase === 'playing' && view.currentPlayerId === view.you;
  const canDraw = myTurn && !view!.drawnCardId;
  // atacak kart yoksa tek seçenek kart çekmek: sadece o öne çıkar
  const mustDraw = canDraw && view!.playableIds.length === 0;
  const canPass = myTurn && !!view!.drawnCardId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const emote = EMOTES.find(x => x.key === e.key);
      if (emote) sendEmote(emote.id);
      else if (e.key === 'd' && canDraw) drawCard();
      else if (e.key === 'p' && canPass) passTurn();
      else if (e.key === 'v') void voice.toggleMic();
      else if (e.key === 's') sortHand();
      else if (e.key === 'k') shuffleHand();
      else if (e.key === 'Escape') useApp.setState({ pendingWild: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, canPass]);

  let status = 'Kartlar dağıtılıyor…';
  if (view?.phase === 'playing') {
    if (myTurn) status = view.drawnCardId ? 'Çektiğin kartı oynayabilir ya da pas geçebilirsin' : view.pendingDraw ? `+${view.pendingDraw} geliyor! Üstüne at ya da çek` : 'Sıra sende';
    else status = `${nameOf(view.currentPlayerId)} oynuyor…`;
  }

  return (
    <div className="hud">
      <TopBar />

      {view?.phase === 'playing' && (
        <div className={`status ${myTurn ? 'mine' : ''}`}>
          <span className="swatch" style={{ background: COLOR_HEX[view.currentColor] }} />
          <span>{status}</span>
          <span className="dir" title="Oyun yönü">
            {view.direction === 1 ? '↻' : '↺'}
          </span>
          <TurnTimer />
        </div>
      )}

      <div className="action-bar">
        {mustDraw && (
          <button className="btn primary big must-draw" onClick={drawCard}>
            Kart Çek <kbd>D</kbd>
          </button>
        )}
        {canPass && (
          <button className="btn primary" onClick={passTurn}>
            Pas Geç <kbd>P</kbd>
          </button>
        )}
      </div>

      <div className="bottom-left">
        <ChatPanel />
      </div>
      <div className="bottom-right">
        {view?.phase === 'playing' && view.hand.length > 1 && <HandTools />}
        <EmoteBar />
      </div>

      {pendingWild && (
        <div className="overlay" onClick={() => useApp.setState({ pendingWild: null })}>
          <div className="color-picker" onClick={e => e.stopPropagation()}>
            <h3>Renk seç</h3>
            <div className="wheel">
              {COLORS.map((c, i) => (
                <button
                  key={c}
                  className="slice"
                  style={{ background: COLOR_HEX[c], animationDelay: `${i * 0.05}s` }}
                  onClick={() => chooseWildColor(c)}
                >
                  {COLOR_NAME[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {room.status === 'ended' && view?.phase === 'ended' && <ScoreBoard isHost={room.hostId === me} />}
    </div>
  );
}

// memo: her hamlede değişen oyun görünümü üst barı yeniden çizdirmez; yalnızca kendi abonelikleri çizdirir
const TopBar = memo(function TopBar() {
  const room = useApp(s => s.room)!;
  const micOn = useApp(s => s.micOn);
  const watchSelf = useApp(s => s.watchSelf);
  const topView = useApp(s => s.topView);
  const connected = useApp(s => s.connected);
  return (
    <div className="topbar">
      <span className="code-chip">Oda {room.code}</span>
      {!connected && <span className="tag warn">Bağlantı koptu, yeniden bağlanılıyor…</span>}
      <div className="spacer" />
      <button
        className={`icon-btn ${topView ? 'on' : ''}`}
        onClick={() => useApp.setState({ topView: !topView })}
        title={topView ? 'Normal görünüme dön' : 'Masaya yukarıdan bak'}
        aria-label={topView ? 'Normal görünüme dön' : 'Masaya yukarıdan bak'}
        aria-pressed={topView}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 16l8 4 8-4M4 12l8 4 8-4M12 4L4 8l8 4 8-4-8-4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className={`icon-btn watch ${watchSelf ? 'on' : ''}`}
        onClick={() => {
          autoSelfView = false;
          useApp.setState({ watchSelf: !watchSelf });
        }}
        title={watchSelf ? 'Oyun görünümüne dön' : 'Kendimi izle'}
        aria-label={watchSelf ? 'Oyun görünümüne dön' : 'Kendimi izle'}
        aria-pressed={watchSelf}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`icon-btn mic ${micOn ? 'on' : 'off'}`}
        onClick={() => void voice.toggleMic()}
        title={micOn ? 'Mikrofonu kapat (V)' : 'Mikrofonu aç (V)'}
        aria-label={micOn ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
        aria-pressed={micOn}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          {!micOn && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      <FpsBadge />
      <SettingsButton />
      <button className="btn small ghost" onClick={askLeave}>
        Çık
      </button>
    </div>
  );
});

/** Saniyede bir değişen kare hızı ayrı bileşende: güncellenince sadece bu yazı yeniden çizilir */
function FpsBadge() {
  const fps = useApp(s => s.fps);
  return <span className={`fps ${fps && fps < 30 ? 'low' : ''}`} title="Kare hızı">{fps} FPS</span>;
}

function TurnTimer() {
  const deadline = useApp(s => s.turnDeadline);
  const [, setTick] = useState(0);
  const left = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
  useEffect(() => {
    if (!deadline) return;
    // saniyede 4 kez yerine yalnızca gösterilen sayı değiştiğinde uyanır;
    // 30 sn'den fazla süre varken sayaç gizli olduğu için 30'a inene kadar hiç çizilmez
    let t = 0;
    const schedule = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) return;
      const s = Math.ceil(ms / 1000);
      const wait = s > 30 ? ms - 30000 : ms - (s - 1) * 1000;
      t = window.setTimeout(() => {
        setTick(n => n + 1);
        schedule();
      }, wait + 10);
    };
    schedule();
    return () => clearTimeout(t);
  }, [deadline]);
  if (!deadline || left > 30) return null;
  return <span className={`timer ${left <= 5 ? 'low' : ''}`}>{left}s</span>;
}

/** Elindeki kartları renge ve sayıya göre sırala ya da karıştır */
const HandTools = memo(function HandTools() {
  return (
    <div className="hand-tools">
      <button className="hand-tool" onClick={() => sortHand()} title="Renge ve sayıya göre sırala (S)">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M4 6h10M4 12h7M4 18h4M17 5v14m0 0l-3-3m3 3l3-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Sırala</span>
        <kbd>S</kbd>
      </button>
      <button className="hand-tool" onClick={() => shuffleHand()} title="Kartları karıştır (K)">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21m0 0l-2.5-2.5M21 17l-2.5 2.5M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M21 7h-3.5c-1.4 0-2.4.5-3.2 1.4M21 7l-2.5-2.5M21 7l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Karıştır</span>
        <kbd>K</kbd>
      </button>
    </div>
  );
});

let selfViewTimer = 0;
let autoSelfView = false;
/**
 * Emote animasyonu kendi karakterinde oynar; birinci şahısta kendi gövden gizli olduğu için
 * animasyon süresince kamera kendini izleme görünümüne geçer, bitince geri döner.
 * Oyuncu "Kendimi izle"yi kendisi açtıysa ona dokunulmaz.
 */
function sendEmote(id: string) {
  socket.emit('emote', { emote: id });
  const st = useApp.getState();
  if (st.view?.phase !== 'playing' || (st.watchSelf && !autoSelfView)) return;
  autoSelfView = true;
  useApp.setState({ watchSelf: true });
  clearTimeout(selfViewTimer);
  selfViewTimer = window.setTimeout(() => {
    if (autoSelfView && useApp.getState().watchSelf) useApp.setState({ watchSelf: false });
    autoSelfView = false;
  }, id === 'dance' ? 7000 : 4500);
}

const EmoteBar = memo(function EmoteBar() {
  return (
    <div className="emotes">
      {EMOTES.map(e => (
        <button key={e.id} className="emote" title={`${e.label} (${e.key})`} onClick={() => sendEmote(e.id)}>
          <span className="emote-label">{e.label}</span>
          <kbd>{e.key}</kbd>
        </button>
      ))}
    </div>
  );
});

function ScoreBoard({ isHost }: { isHost: boolean }) {
  const room = useApp(s => s.room)!;
  const me = useApp(s => s.playerId);
  const seats = room.seats.filter(s => s !== null);
  const winner = seats.find(s => s.playerId === room.lastWinner);
  const sorted = [...seats].sort((a, b) => (room.scores[b.playerId] ?? 0) - (room.scores[a.playerId] ?? 0));
  return (
    // arka plan karartılmaz: arkada kamera masanın etrafında dönüp oyuncuların tepkilerini gösterir
    <div className="overlay clear end">
      <div className="panel scoreboard">
        <h2>{room.lastWinner === me ? 'Kazandın! 🎉' : `${winner?.name ?? '?'} kazandı`}</h2>
        <p className="muted">Bu elden +{room.lastPoints} puan</p>
        <ol>
          {sorted.map(s => (
            <li key={s.playerId} className={s.playerId === room.lastWinner ? 'win' : ''}>
              <span>{s.name}</span>
              <b>{room.scores[s.playerId] ?? 0}</b>
            </li>
          ))}
        </ol>
        {/* rövanştan önce sahne değiştirilebilir; değişiklik arkadaki masada hemen görünür */}
        <div className="scoreboard-themes">
          <h3>{isHost ? 'Sonraki elin sahnesi' : 'Sahne'}</h3>
          <ThemePicker compact />
        </div>
        <div className="actions">
          {isHost ? (
            <button
              className="btn primary big"
              onClick={async () => {
                const r = await request('room:start');
                if (!r.ok) useApp.getState().showToast(r.error);
              }}
            >
              Rövanş
            </button>
          ) : (
            <span className="muted">Oda sahibinin yeni eli başlatması bekleniyor…</span>
          )}
          <button className="btn ghost" onClick={askLeave}>
            Odadan çık
          </button>
        </div>
      </div>
    </div>
  );
}
