"use client";

import React from 'react';
import { ArrowRight } from 'lucide-react';

export function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        borderRadius: '12px',
        width: '100%',
        border: 'none',
        background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        color: active ? '#fff' : '#a0a0a0',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        textAlign: 'left'
      }}
      className={active ? '' : 'sidebar-hover'}
    >
      <span style={{ color: active ? '#007aff' : 'inherit' }}>{icon}</span>
      <span style={{ fontWeight: active ? 600 : 400, fontSize: '0.95rem' }}>{label}</span>
    </button>
  );
}

export function MetricLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <p className="secondary-text">{label}</p>
      {hint && (
        <span
          title={hint}
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.08)',
            color: '#cfd7e3',
            fontSize: '0.7rem',
            fontWeight: 800,
            cursor: 'help',
            flexShrink: 0,
          }}
        >
          ?
        </span>
      )}
    </div>
  );
}

export function DetailRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="premium-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px' }}>
      <span className="secondary-text">{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function ComparisonRow({ label, value, isHigher, isGood = true }: { label: string, value: string, isHigher: boolean, isGood?: boolean }) {
  const highlight = isHigher === isGood;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: '12px', background: highlight ? 'rgba(52, 199, 89, 0.05)' : 'transparent' }}>
      <span className="secondary-text" style={{ fontSize: '0.9rem' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 600, color: highlight ? '#34c759' : '#fff' }}>{value}</span>
        {highlight && <ArrowRight size={14} style={{ color: '#34c759', transform: 'rotate(-45deg)' }} />}
      </div>
    </div>
  );
}
