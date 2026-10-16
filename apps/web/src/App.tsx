import { useEffect } from 'react';
import { GameCanvas } from './scene/GameCanvas';
import { useApp } from './store/useApp';
import { ChatPanel } from './ui/ChatPanel';
import { GameHud } from './ui/GameHud';
import { HomeScreen } from './ui/HomeScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { SettingsButton, SettingsPanel } from './ui/SettingsPanel';
import { LeaveConfirm } from './ui/LeaveConfirm';

export function App() {
  const room = useApp(s => s.room);
  const toast = useApp(s => s.toast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useApp.setState({ toast: null }), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <div className="canvas-wrap">
        <GameCanvas />
      </div>
      {!room && <HomeScreen />}
      {(!room || room.status === 'lobby') && <div className="settings-fab"><SettingsButton /></div>}
      {room?.status === 'lobby' && (
        <>
          <LobbyScreen />
          <div className="bottom-left">
            <ChatPanel />
          </div>
        </>
      )}
      {room && room.status !== 'lobby' && <GameHud />}
      <SettingsPanel />
      <LeaveConfirm />
      {toast && (
        <div className="toast" key={toast.n}>
          {toast.text}
        </div>
      )}
    </>
  );
}
