import { lazy, Suspense, useEffect } from 'react';
import { useApp } from './store/useApp';
import { ChatPanel } from './ui/ChatPanel';
import { GameHud } from './ui/GameHud';
import { HomeScreen } from './ui/HomeScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { SettingsButton, SettingsPanel } from './ui/SettingsPanel';
import { LeaveConfirm } from './ui/LeaveConfirm';
import { LoadingScreen } from './ui/LoadingScreen';
import { schedulePreload } from './scene/preload';

const GameCanvas = lazy(() => import('./scene/GameCanvas').then(m => ({ default: m.GameCanvas })));

export function App() {
  // karakter ve animasyon dosyaları oyuna girmeden indirilir
  useEffect(() => schedulePreload(), []);
  const room = useApp(s => s.room);
  const toast = useApp(s => s.toast);
  const assetsReady = useApp(s => s.assetsReady);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useApp.setState({ toast: null }), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <div className="canvas-wrap">
        {/* 3D sahne ayrı parçada yüklenir: menüler onu beklemeden açılır */}
        <Suspense fallback={null}>
          <GameCanvas />
        </Suspense>
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
      {room && !assetsReady && <LoadingScreen />}
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
