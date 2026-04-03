"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import { WorkoutData } from '@/lib/parser';
import { Language, translations } from '@/lib/translations';

type Props = {
  lang: Language;
  workout: WorkoutData | null;
  show: boolean;
  shareCardRef: React.RefObject<HTMLDivElement | null>;
  isShareSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  formatTime: (seconds: number) => string;
};

export function ShareCardModal({ lang, workout, show, shareCardRef, isShareSaving, onClose, onSave, formatTime }: Props) {
  const t = translations[lang];

  return (
    <AnimatePresence>
      {show && workout && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="no-print"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="premium-card"
            style={{ width: '450px', background: '#000', border: '2px solid rgba(52, 199, 89, 0.3)', padding: '0', overflow: 'hidden', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              ref={shareCardRef}
              style={{
                padding: '40px',
                background: 'radial-gradient(circle at top left, rgba(52, 199, 89, 0.22), transparent 35%), linear-gradient(160deg, #05070b 0%, #0b1220 55%, #101820 100%)',
                color: '#ffffff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
                <div>
                  <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '4px' }}>{workout.distance.toFixed(2)}</h1>
                  <p style={{ fontSize: '1.2rem', opacity: 0.6, fontWeight: 600 }}>KILOMETERS</p>
                </div>
                <div style={{ background: '#34c759', padding: '12px', borderRadius: '50%', color: '#000' }}>
                  <Activity size={32} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '40px' }}>
                <div>
                  <p style={{ fontSize: '0.9rem', opacity: 0.4, marginBottom: '4px' }}>{t.pace.toUpperCase()}</p>
                  <h2 style={{ fontSize: '1.8rem' }}>{workout.pace}</h2>
                </div>
                <div>
                  <p style={{ fontSize: '0.9rem', opacity: 0.4, marginBottom: '4px' }}>{t.duration.toUpperCase()}</p>
                  <h2 style={{ fontSize: '1.8rem' }}>{formatTime(workout.duration)}</h2>
                </div>
                <div>
                  <p style={{ fontSize: '0.9rem', opacity: 0.4, marginBottom: '4px' }}>{t.avgHr.toUpperCase()}</p>
                  <h2 style={{ fontSize: '1.8rem' }}>{workout.avgHeartRate} bpm</h2>
                </div>
                <div>
                  <p style={{ fontSize: '0.9rem', opacity: 0.4, marginBottom: '4px' }}>{t.calories.toUpperCase()}</p>
                  <h2 style={{ fontSize: '1.8rem' }}>{workout.calories}</h2>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>{workout.name.toUpperCase()}</p>
                  <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>{new Date(workout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '0.7rem', opacity: 0.3 }}>RUNFORM</p>
                  <p style={{ fontSize: '0.7rem', color: '#007aff', fontWeight: 800 }}>PRO VERSION</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                onClick={onSave}
                disabled={isShareSaving}
                style={{ background: 'rgba(52, 199, 89, 0.1)', border: 'none', padding: '16px', color: '#34c759', cursor: isShareSaving ? 'wait' : 'pointer', fontWeight: 600, borderRight: '1px solid rgba(255,255,255,0.08)' }}
              >
                {isShareSaving
                  ? (lang === 'ru' ? 'Сохраняю...' : 'Saving...')
                  : (lang === 'ru' ? 'Сохранить PNG' : 'Save PNG')}
              </button>
              <button
                onClick={onClose}
                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', padding: '16px', color: '#a0a0a0', cursor: 'pointer' }}
              >
                {lang === 'ru' ? 'Закрыть' : 'Close'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
