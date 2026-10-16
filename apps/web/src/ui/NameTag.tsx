import type { SeatInfo } from '@uno/protocol';
import { assignCharacters } from '../scene/characters';
import { useApp } from '../store/useApp';

/** Avatarın başının üstünde: isim, kart sayısı, konuşma göstergesi, UNO rozeti */
export function NameTag({ seat, isCurrent }: { seat: SeatInfo; isCurrent: boolean }) {
  const count = useApp(s => s.counts[seat.playerId]);
  const uno = useApp(s => s.unoFlags[seat.playerId]);
  const speaking = useApp(s => (s.speaking[seat.playerId] ?? 0) > 0.08);
  const color = useApp(s => assignCharacters(s.room)[seat.playerId]?.color);
  return (
    <div className={`nametag ${isCurrent ? 'current' : ''} ${seat.connected ? '' : 'offline'}`}>
      <span className="dot" style={{ background: color }} />
      <span className="nm">{seat.name}</span>
      {seat.isBot && <span className="tag">BOT</span>}
      {!seat.connected && <span className="tag">bağlantı yok</span>}
      {count !== undefined && <span className="ct">{count}</span>}
      {speaking && <span className="mic">🎙</span>}
      {uno && <span className="uno">UNO!</span>}
    </div>
  );
}
