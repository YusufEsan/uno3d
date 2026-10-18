import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@uno/protocol';
import { request } from '../net/socket';
import { useApp } from '../store/useApp';

/** Mesaj listesi ayrı ve memo'lu: yazarken her tuşta 80 mesaj yeniden çizilmez, yalnızca yeni mesajda çizilir */
const ChatMessages = memo(function ChatMessages({ chat }: { chat: ChatMessage[] }) {
  return chat.map(m => (
    <div key={m.id} className={`msg ${m.system ? 'system' : ''}`}>
      {!m.system && <b>{m.name}: </b>}
      {m.text}
    </div>
  ));
});

// memo: oyun ekranı her hamlede yeniden çizildiğinde sohbet etkilenmez (props yok)
export const ChatPanel = memo(function ChatPanel() {
  const chat = useApp(s => s.chat);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [chat, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') {
        setOpen(true);
        setTimeout(() => document.getElementById('chat-input')?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = await request('chat:send', { text: t });
    if (!r.ok) useApp.getState().showToast(r.error);
  }

  return (
    <div className="chat-dock" onWheel={e => e.stopPropagation()}>
      {!open && (
        <button className="chat-fab" aria-label="Sohbeti aç" title="Sohbet (Enter)" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4.5 3.5V16H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="currentColor" />
          </svg>
        </button>
      )}
      {open && (
        <div className="chat">
          <div className="chat-head">
            <span>Sohbet</span>
            <button className="chat-close" aria-label="Sohbeti kapat" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="chat-list" ref={list}>
            <ChatMessages chat={chat} />
          </div>
          <input
            id="chat-input"
            value={text}
            maxLength={200}
            placeholder="Mesaj yaz, Enter ile gönder"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void send();
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      )}
    </div>
  );
});
