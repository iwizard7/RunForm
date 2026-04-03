"use client";

import { formatPaceMinutes, NextResultPrediction } from '@/lib/ai';
import { Language } from '@/lib/translations';

type Props = {
  lang: Language;
  weeklyLoadLabel: string;
  recoveryLabel: string;
  healthFlagsCount: number;
  nextResultPrediction: NextResultPrediction | null;
};

export function NextWorkoutInsights({ lang, weeklyLoadLabel, recoveryLabel, healthFlagsCount, nextResultPrediction }: Props) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '16px' }}>
        <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)' }}>
          <p className="secondary-text">{lang === 'ru' ? 'Недельная нагрузка' : 'Weekly load'}</p>
          <p style={{ fontWeight: 700, marginTop: '4px' }}>{weeklyLoadLabel}</p>
        </div>
        <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)' }}>
          <p className="secondary-text">{lang === 'ru' ? 'Восстановление' : 'Recovery'}</p>
          <p style={{ fontWeight: 700, marginTop: '4px' }}>{recoveryLabel}</p>
        </div>
        <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)' }}>
          <p className="secondary-text">{lang === 'ru' ? 'Красные флаги' : 'Red flags'}</p>
          <p style={{ fontWeight: 700, marginTop: '4px' }}>{healthFlagsCount}</p>
        </div>
      </div>

      {nextResultPrediction && (
        <div className="premium-card" style={{ marginTop: '20px', background: 'rgba(0,122,255,0.06)', border: '1px solid rgba(0,122,255,0.16)' }}>
          <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI-прогноз следующей сессии' : 'AI next-session forecast'}</p>
          <p style={{ lineHeight: 1.6 }}>
            {lang === 'ru'
              ? `Если сохранить текущий фон, следующая комфортная сессия ожидается около ${nextResultPrediction.distance.toFixed(1)} км в районе ${formatPaceMinutes(nextResultPrediction.pace)} со средним пульсом около ${nextResultPrediction.avgHr} bpm.`
              : `If the current context holds, the next comfortable session is expected around ${nextResultPrediction.distance.toFixed(1)} km at roughly ${formatPaceMinutes(nextResultPrediction.pace)} with an average heart rate near ${nextResultPrediction.avgHr} bpm.`}
          </p>
        </div>
      )}
    </>
  );
}
