import { memo } from 'react';
import type { RoomState, SeatInfo } from '@uno/protocol';
import { assignCharacters, type CharacterDef } from '../scene/characters';
import { SPEAKING_THRESHOLD, useApp } from '../store/useApp';

// seçiciler her store güncellemesinde çalışır: karakter dağıtımı her seferinde yeniden karıştırılmasın diye
// son oda nesnesi için saklanır (useMemo'dan farkı: odaya abone olmadan seçici içinde kullanılabilir, 4 etiket paylaşır)
let lastRoom: RoomState | null = null;
let lastChars: Record<string, CharacterDef> = {};
function charactersOf(room: RoomState | null) {
  if (room !== lastRoom) {
    lastRoom = room;
    lastChars = assignCharacters(room);
  }
  return lastChars;
}

/** Avatarın başının üstünde: isim, kart sayısı, konuşma göstergesi, UNO rozeti */
export const NameTag = memo(function NameTag({ seat, isCurrent }: { seat: SeatInfo; isCurrent: boolean }) {
  const count = useApp(s => s.counts[seat.playerId]);
  const uno = useApp(s => s.unoFlags[seat.playerId]);
  // store yalnızca eşik geçilince haber verir; etiket de sadece konuşuyor/susuyor bilgisini kullanır
  const speaking = useApp(s => (s.speaking[seat.playerId] ?? 0) > SPEAKING_THRESHOLD);
  const color = useApp(s => charactersOf(s.room)[seat.playerId]?.color);
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
});
