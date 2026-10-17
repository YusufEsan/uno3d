import type { CSSProperties } from 'react';
import { THEMES, type ThemeId } from '@uno/protocol';
import { THEMES as SCENE_THEMES } from '../scene/themes';
import { request } from '../net/socket';
import { useApp } from '../store/useApp';

/** Masa teması seçici: lobide ve oyun sonunda (rövanştan önce) kullanılır; yalnızca oda sahibi değiştirir */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const room = useApp(s => s.room)!;
  const me = useApp(s => s.playerId);
  const isHost = room.hostId === me;

  const pick = async (id: string) => {
    const r = await request('room:settings', { theme: id });
    if (!r.ok) useApp.getState().showToast(r.error);
  };

  return (
    <div className={`theme-grid ${compact ? 'compact' : ''}`}>
      {THEMES.map(t => {
        const scene = SCENE_THEMES[t.id as ThemeId];
        const active = room.theme === t.id;
        const vars = { '--felt': scene.felt, '--rim': scene.rim, '--wall': scene.wall, '--floor': scene.floor, '--lamp': scene.lamp.color } as CSSProperties;
        return (
          <button
            key={t.id}
            className={`theme-card ${active ? 'active' : ''}`}
            style={vars}
            disabled={!isHost && !active}
            onClick={() => isHost && !active && pick(t.id)}
            aria-pressed={active}
            title={t.name}
          >
            {/* temanın küçük sahne önizlemesi: lamba ışığı, masa, çuha ve kenar rengi */}
            <span className="theme-scene" aria-hidden="true">
              <span className="ts-beam" />
              <span className="ts-lamp" />
              <span className="ts-table">
                <span className="ts-card" />
              </span>
              {active && (
                <span className="theme-check">
                  <svg viewBox="0 0 24 24" width="10" height="10">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </span>
            <span className="theme-name">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}
