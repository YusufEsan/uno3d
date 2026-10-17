import { useApp } from '../store/useApp';

const CARDS = ['#e5322d', '#f5c400', '#2fa84f', '#1e6fd9'];

/** Oyuna girmeden önce karakterler ve animasyonlar yüklenirken gösterilen animasyonlu ekran */
export function LoadingScreen() {
  const progress = useApp(s => s.assetProgress);
  const pct = Math.round(progress * 100);
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-cards" aria-hidden="true">
        {CARDS.map((c, i) => (
          <span key={c} className="loading-card" style={{ background: c, animationDelay: `${i * 0.18}s` }} />
        ))}
      </div>
      <h2>Masa hazırlanıyor</h2>
      <p>Karakterler ve hareketler yükleniyor · %{pct}</p>
      <div className="loading-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
