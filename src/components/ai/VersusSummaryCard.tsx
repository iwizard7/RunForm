"use client";

import { WorkoutData } from '@/lib/parser';
import { Language } from '@/lib/translations';
import { VersusSummary } from '@/lib/ai';

type Props = {
  lang: Language;
  selectedWorkouts: WorkoutData[];
  summary: VersusSummary | null;
};

export function VersusSummaryCard({ lang, selectedWorkouts, summary }: Props) {
  if (!summary || selectedWorkouts.length !== 2) {
    return null;
  }

  return (
    <div className="premium-card" style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '20px', borderColor: 'rgba(88,86,214,0.22)', background: 'linear-gradient(135deg, rgba(88, 86, 214, 0.08) 0%, rgba(0, 122, 255, 0.04) 100%)' }}>
      <div>
        <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI-сравнение' : 'AI comparison'}</p>
        <h3 style={{ marginBottom: '12px' }}>{lang === 'ru' ? 'Краткий разбор' : 'Quick breakdown'}</h3>
        <p style={{ color: '#d7ddea', lineHeight: 1.6, marginBottom: '12px' }}>{summary.overall}</p>
        <p style={{ color: '#c5cfdd', lineHeight: 1.6, marginBottom: '12px' }}>{summary.deepSummary}</p>
        <p style={{ color: '#aeb8c7', lineHeight: 1.6 }}>{summary.coachTip}</p>
      </div>
      <div>
        <p className="secondary-text" style={{ marginBottom: '10px' }}>{new Date(selectedWorkouts[0].startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {summary.firstNotes.map((note) => (
            <div key={note} style={{ padding: '10px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)' }}>{note}</div>
          ))}
        </div>
      </div>
      <div>
        <p className="secondary-text" style={{ marginBottom: '10px' }}>{new Date(selectedWorkouts[1].startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {summary.secondNotes.map((note) => (
            <div key={note} style={{ padding: '10px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)' }}>{note}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
