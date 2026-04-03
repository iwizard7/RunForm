"use client";

import { MetricExplainer, MetricExplainerKey, NextResultPrediction, WeeklyCoach, WorkoutAiReview, ExplainedFlag, formatPaceMinutes } from '@/lib/ai';
import { Language } from '@/lib/translations';

type Props = {
  lang: Language;
  workoutAiReview: WorkoutAiReview | null;
  weeklyCoach: WeeklyCoach | null;
  nextResultPrediction: NextResultPrediction | null;
  explainedFlags: ExplainedFlag[];
  metricExplainers: MetricExplainer[];
  selectedMetricKey: MetricExplainerKey;
  onMetricSelect: (key: MetricExplainerKey) => void;
};

export function AiCoachDashboard({
  lang,
  workoutAiReview,
  weeklyCoach,
  nextResultPrediction,
  explainedFlags,
  metricExplainers,
  selectedMetricKey,
  onMetricSelect,
}: Props) {
  const selectedMetricExplanation = metricExplainers.find((item) => item.key === selectedMetricKey) ?? metricExplainers[0];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '24px' }}>
        <div className="premium-card">
          <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI-разбор тренировки' : 'AI workout review'}</p>
          <h3 style={{ marginBottom: '12px' }}>{workoutAiReview?.summary}</h3>
          {workoutAiReview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)' }}>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Сильные стороны' : 'Strong points'}</p>
                {workoutAiReview.strengths.length > 0 ? workoutAiReview.strengths.map((item) => (
                  <p key={item} style={{ lineHeight: 1.6 }}>{item}</p>
                )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Ярко выраженных сильных сигналов мало, сессия выглядит нейтральной.' : 'No strong positive signals stand out; the session looks neutral.'}</p>}
              </div>
              <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,149,0,0.08)' }}>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Риски' : 'Risks'}</p>
                {workoutAiReview.risks.length > 0 ? workoutAiReview.risks.map((item) => (
                  <p key={item} style={{ lineHeight: 1.6 }}>{item}</p>
                )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Явных перегрузочных сигналов по текущей тренировке не видно.' : 'No clear overload signals stand out in the current workout.'}</p>}
              </div>
              <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(0,122,255,0.08)' }}>
                <p style={{ lineHeight: 1.6, marginBottom: '8px' }}>{workoutAiReview.goalFit}</p>
                <p className="secondary-text">{workoutAiReview.recommendation}</p>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="premium-card">
            <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI weekly coach' : 'AI weekly coach'}</p>
            <h3 style={{ marginBottom: '10px', color: weeklyCoach?.color }}>{weeklyCoach?.headline}</h3>
            <p style={{ lineHeight: 1.6, marginBottom: '12px' }}>{weeklyCoach?.summary}</p>
            <p className="secondary-text" style={{ marginBottom: '8px' }}>{weeklyCoach?.focus}</p>
            <p style={{ lineHeight: 1.6 }}>{weeklyCoach?.recommendation}</p>
          </div>

          {nextResultPrediction && (
            <div className="premium-card">
              <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Прогноз следующего результата' : 'Next result forecast'}</p>
              <h3 style={{ marginBottom: '12px' }}>{formatPaceMinutes(nextResultPrediction.pace)}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div style={{ padding: '14px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Комфортная дистанция' : 'Comfort distance'}</p>
                  <p style={{ fontWeight: 700 }}>{nextResultPrediction.distance.toFixed(1)} km</p>
                </div>
                <div style={{ padding: '14px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Ожидаемый HR' : 'Expected HR'}</p>
                  <p style={{ fontWeight: 700 }}>{nextResultPrediction.avgHr} bpm</p>
                </div>
              </div>
              <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? `Уверенность: ${nextResultPrediction.confidence}` : `Confidence: ${nextResultPrediction.confidence}`}</p>
              <p style={{ lineHeight: 1.6 }}>{nextResultPrediction.note}</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div className="premium-card">
          <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI-объяснение красных флагов' : 'AI red-flag explanations'}</p>
          {explainedFlags.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {explainedFlags.map((flag) => (
                <div key={flag.title} style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${flag.color}33` }}>
                  <p style={{ fontWeight: 700, marginBottom: '8px', color: flag.color }}>{flag.title}</p>
                  <p style={{ lineHeight: 1.6, marginBottom: '8px' }}>{flag.why}</p>
                  <p className="secondary-text">{flag.action}</p>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Сейчас явных красных флагов нет, поэтому AI не видит причин для защитной коррекции плана.' : 'There are no clear red flags right now, so AI does not see a need for defensive plan adjustments.'}</p>
          )}
        </div>

        <div className="premium-card">
          <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'AI объяснение показателей' : 'AI explain metrics'}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            {metricExplainers.map((item) => (
              <button
                key={item.key}
                onClick={() => onMetricSelect(item.key)}
                style={{
                  background: selectedMetricKey === item.key ? 'rgba(0,122,255,0.18)' : 'rgba(255,255,255,0.04)',
                  color: selectedMetricKey === item.key ? '#7fc1ff' : '#dce3ee',
                  border: selectedMetricKey === item.key ? '1px solid rgba(0,122,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
            <h3 style={{ marginBottom: '10px' }}>{selectedMetricExplanation.title}</h3>
            <p style={{ lineHeight: 1.6, marginBottom: '10px' }}>{selectedMetricExplanation.detail}</p>
            <p className="secondary-text">{selectedMetricExplanation.why}</p>
          </div>
        </div>
      </div>
    </>
  );
}
