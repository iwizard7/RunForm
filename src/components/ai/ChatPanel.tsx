"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Trash2 } from 'lucide-react';
import type { ChatMessage } from '@/lib/actions';
import { Language } from '@/lib/translations';

type ChatPanelProps = {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  lang: Language;
  emptyText: string;
  placeholder: string;
  clearLabel: string;
};

/**
 * Chat window for the AI coach. The last message grows in place while the
 * model streams its reply.
 */
export function ChatPanel({
  messages,
  isStreaming,
  onSend,
  onClear,
  lang,
  emptyText,
  placeholder,
  clearLabel,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft('');
    onSend(text);
  };

  return (
    <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: '#007aff', padding: '8px', borderRadius: '10px', color: '#fff', display: 'flex' }}>
            <MessageCircle size={18} />
          </div>
          <h3 style={{ fontSize: '1rem' }}>{lang === 'ru' ? 'Диалог с тренером' : 'Conversation with the coach'}</h3>
        </div>
        <button
          disabled={isStreaming || messages.length === 0}
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          style={{
            background: 'rgba(255, 45, 85, 0.12)',
            color: '#ff2d55',
            border: '1px solid rgba(255, 45, 85, 0.25)',
            padding: '8px 10px',
            borderRadius: '8px',
            cursor: isStreaming || messages.length === 0 ? 'not-allowed' : 'pointer',
            display: 'flex',
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div
        ref={listRef}
        style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', padding: '4px 2px', marginBottom: '16px' }}
      >
        {messages.length === 0 ? (
          <p className="secondary-text" style={{ textAlign: 'center', padding: '32px 16px', lineHeight: 1.6 }}>
            {emptyText}
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                padding: '10px 14px',
                borderRadius: message.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: message.role === 'user' ? 'rgba(0, 122, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: message.role === 'user' ? '1px solid rgba(0, 122, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.07)',
                whiteSpace: 'pre-line',
                lineHeight: 1.55,
                fontSize: '0.9rem',
              }}
            >
              {message.content || (isStreaming ? '…' : '')}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          style={{
            flex: 1,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: 'inherit',
            padding: '11px 14px',
            borderRadius: '10px',
          }}
        />
        <button
          disabled={isStreaming || !draft.trim()}
          onClick={submit}
          style={{
            background: isStreaming || !draft.trim() ? 'rgba(255,255,255,0.05)' : '#007aff',
            color: isStreaming || !draft.trim() ? '#a0a0a0' : '#fff',
            border: 'none',
            padding: '10px 16px',
            borderRadius: '10px',
            cursor: isStreaming || !draft.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 600,
          }}
        >
          {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
