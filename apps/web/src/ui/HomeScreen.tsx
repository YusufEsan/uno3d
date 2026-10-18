import { useState } from 'react';
import { HAS_MIXAMO } from '../scene/characters';
import { request } from '../net/socket';
import { saveProfile } from '../net/session';
import { useApp } from '../store/useApp';
import { Switch } from './LobbyScreen';

const APPROVAL_KEY = 'uno.approval';
const readApproval = () => {
  try {
    return localStorage.getItem(APPROVAL_KEY) !== '0';
  } catch {
    return true;
  }
};

export function HomeScreen() {
  const profile = useApp(s => s.profile);
  const connected = useApp(s => s.connected);
  // alan boş açılır; son kullanılan isim placeholder olarak görünür
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('oda')?.toUpperCase() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // özel odaya katılma onayı: varsayılan açık, son seçim hatırlanır
  const [approval, setApproval] = useState(readApproval);
  const toggleApproval = () => {
    setApproval(!approval);
    try {
      localStorage.setItem(APPROVAL_KEY, approval ? '0' : '1');
    } catch {
      /* tarayıcı depolaması kapalı */
    }
  };

  async function go(event: 'room:quick' | 'room:create' | 'room:join', extra: object = {}) {
    // karakter her oyunda rastgele dağıtılır; profilde sadece isim tutulur
    const p = { name: name.trim() || profile.name.trim(), avatar: 'random' };
    if (!p.name) return setError('Önce bir isim yaz');
    saveProfile(p);
    useApp.setState({ profile: p });
    setBusy(true);
    setError('');
    const r = await request<{ code: string }>(event, { ...p, ...extra });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    history.replaceState(null, '', `?oda=${r.code}`);
  }

  return (
    <div className="screen home">
      <div className="panel home-panel">
        <h1 className="logo">
          UNO <span>3D</span>
        </h1>
        <p className="sub">Arkadaşlarınla masaya otur, kartları at.</p>

        <label className="field">
          <span>İsmin</span>
          <input value={name} maxLength={16} placeholder={profile.name || 'ör. Yusuf'} onChange={e => setName(e.target.value)} />
        </label>

        <p className="muted small">
          Karakterin her oyunda rastgele seçilir; masada iki oyuncu aynı karakteri almaz.
          {!HAS_MIXAMO && ' Gerçekçi karakterler eklenene kadar geçici robotlar kullanılıyor.'}
        </p>

        <div className="setting-row">
          <div>
            <span className="setting-title">Katılma onayı</span>
            <span className="setting-hint">Özel odana kod ile gelenleri sen kabul edersin</span>
          </div>
          <Switch label="Katılma onayı" on={approval} onToggle={toggleApproval} />
        </div>

        <div className="actions">
          <button className="btn primary big" disabled={busy || !connected} onClick={() => go('room:quick')}>
            Hızlı Oyun
          </button>
          <button className="btn" disabled={busy || !connected} onClick={() => go('room:create', { isPrivate: true, approval })}>
            Özel Oda Kur
          </button>
        </div>

        <div className="join">
          <input value={code} maxLength={5} placeholder="ODA KODU" onChange={e => setCode(e.target.value.toUpperCase())} />
          <button className="btn" disabled={busy || !connected || code.length !== 5} onClick={() => go('room:join', { code })}>
            Katıl
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {!connected && <p className="muted">Sunucuya bağlanılıyor…</p>}
      </div>
    </div>
  );
}
