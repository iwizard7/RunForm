"use client";

import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Language, translations } from '@/lib/translations';

type AiTextCardProps = {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: string;
  actionLabel: string;
  onAction: () => void;
  isLoading: boolean;
  /** UI language — used for the slow-model hint below the content. */
  lang?: Language;
  /** Extra content rendered between the header and the result (tables, inputs). */
  children?: React.ReactNode;
  /** The streamed/finished answer; rendered with pre-line whitespace. */
  result?: string;
  /** Shown in place of the result when there is none yet. */
  emptyHint?: string;
  disabled?: boolean;
};

/**
 * Shared shell for every one-shot AI generation (digest, flag explanations,
 * readiness, split analysis, reflection). The text streams in progressively.
 */
export function AiTextCard({
  title,
  hint,
  icon,
  accent = '#5856d6',
  actionLabel,
  onAction,
  isLoading,
  lang = 'ru',
  children,
  result,
  emptyHint,
  disabled = false,
}: AiTextCardProps) {
  return (
    <div className="premium-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: children || result ? '16px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: accent, padding: '8px', borderRadius: '10px', color: '#fff', display: 'flex' }}>
            {icon ?? <Sparkles size={18} />}
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>{title}</h3>
            {hint && <p className="secondary-text" style={{ fontSize: '0.8rem' }}>{hint}</p>}
          </div>
        </div>
        <button
          disabled={isLoading || disabled}
          onClick={onAction}
          style={{
            background: disabled ? 'rgba(255,255,255,0.05)' : accent,
            color: disabled ? '#a0a0a0' : '#fff',
            border: 'none',
            padding: '9px 16px',
            borderRadius: '10px',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
          {actionLabel}
        </button>
      </div>

      {children}

      {result ? (
        <div
          className="animate-fade-in"
          style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)', lineHeight: 1.6, whiteSpace: 'pre-line' }}
        >
          {result}
        </div>
      ) : (
        emptyHint &&
        !isLoading && (
          <p className="secondary-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            {emptyHint}
          </p>
        )
      )}

      {/* First requests after Ollama unloaded the model take 10-30 s; the CSS
          delay fades this in after 2.5 s of silence without any JS state. */}
      {isLoading && !result && (
        <p
          className="secondary-text"
          style={{ fontSize: '0.8rem', lineHeight: 1.5, animation: 'slowHintFade 0.35s ease 2.5s both' }}
        >
          {translations[lang].modelLoading}
        </p>
      )}
    </div>
  );
}
