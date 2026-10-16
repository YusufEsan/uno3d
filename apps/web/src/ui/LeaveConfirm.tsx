import { leaveRoom } from './actions';
import { useApp } from '../store/useApp';

/** Odadan çıkmadan önce sorulan onay penceresi */
export function LeaveConfirm() {
  const open = useApp(s => s.leaveAsk);
  if (!open) return null;
  const stay = () => useApp.setState({ leaveAsk: false });

  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && stay()}>
      <div className="panel confirm" role="alertdialog" aria-label="Odadan çıkış onayı">
        <h2>Odadan çıkmak istiyor musun?</h2>
        <p>Oyun sürüyorsa yerine bir bot geçer.</p>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={stay}>
            Vazgeç
          </button>
          <button className="btn primary" onClick={() => void leaveRoom()}>
            Çık
          </button>
        </div>
      </div>
    </div>
  );
}
