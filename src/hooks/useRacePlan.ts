'use client';

import { useState } from 'react';
import { requestOllama } from '@/lib/ollama';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import { TrainingSession } from '@/lib/actions';
import { RACE_DISTANCES, buildRacePlanTemplate, weeksUntilRace } from '@/lib/race-plan';

/**
 * The schedule is a local template (see buildRacePlanTemplate) — benchmarked
 * on 8 GB machines, a small model drowns in reasoning tokens on any
 * multi-session JSON and never finishes inside a sane timeout. The model is
 * only asked for a short overview, so a failed or slow comment costs the plan
 * nothing.
 */
const OVERVIEW_TIMEOUT_MS = 120_000;

type UseRacePlanParams = {
  lang: Language;
  history: WorkoutData[];
  persistTrainingPlan: (goal: string, sessions: TrainingSession[], notes?: string) => Promise<unknown>;
};

export type RacePlanInput = {
  distanceKey: string;
  /** ISO date (YYYY-MM-DD) of the target race. */
  raceDate: string;
  daysPerWeek: number;
};

/**
 * Builds a multi-week periodized plan toward a target race and saves it into
 * the local plans table: the week-by-week skeleton is deterministic, and the
 * local model adds a short coach-voice overview when it responds in time.
 */
export function useRacePlan({ lang, history, persistTrainingPlan }: UseRacePlanParams) {
  const [isRaceLoading, setIsRaceLoading] = useState(false);
  const [raceError, setRaceError] = useState<string | null>(null);
  const [racePlanSummary, setRacePlanSummary] = useState<string | null>(null);

  const generateRacePlan = async ({ distanceKey, raceDate, daysPerWeek }: RacePlanInput) => {
    const distance = RACE_DISTANCES.find((item) => item.key === distanceKey);
    if (!distance) return;

    const weeks = weeksUntilRace(raceDate);
    if (!weeks) {
      setRaceError(
        lang === 'ru'
          ? 'Выберите дату старта минимум через 4 недели (план имеет смысл от 4 до 24 недель).'
          : 'Pick a race date at least 4 weeks away (plans span 4 to 24 weeks).',
      );
      return;
    }

    setIsRaceLoading(true);
    setRaceError(null);
    setRacePlanSummary(null);

    try {
      // Recent volume, so the plan starts from where the runner actually is.
      const recentCutoff = Date.now() - 28 * 86400000;
      const recentKm = history
        .filter((item) => new Date(item.startDate).getTime() >= recentCutoff)
        .reduce((sum, item) => sum + item.distance, 0);
      const weeklyKm = Math.round((recentKm / 4) * 10) / 10;

      const sessions = buildRacePlanTemplate({ distance, weeks, daysPerWeek, weeklyKm, lang });

      // Best-effort coach overview; the plan survives without it.
      let overview = '';
      try {
        const systemPrompt =
          `Running coach. Write a short motivational overview (2-3 sentences) of this training plan in ` +
          `${lang === 'ru' ? 'Russian' : 'English'}. Plain text only, no markdown, no lists.`;
        const prompt =
          `${distance.labelEn} race on ${raceDate}, ${weeks}-week plan, ${daysPerWeek} runs per week, ` +
          `runner currently ~${weeklyKm} km/week. /no_think Overview:`;
        const data = await requestOllama(
          // qwen3 burns ~1000 hidden reasoning tokens before any visible
          // answer; a tight num_predict cuts it off mid-think and yields an
          // empty response, so the cap has to cover thinking plus answer.
          { prompt, system: systemPrompt, options: { num_ctx: 2048, num_predict: 2500 } },
          { timeoutMs: OVERVIEW_TIMEOUT_MS },
        );
        overview = (data.response ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 600);
      } catch (err) {
        // Offline or slow model: the deterministic plan still gets saved.
        console.warn('[RunForm] race-plan overview skipped:', err);
      }

      const labelRu = lang === 'ru' ? distance.labelRu : distance.labelEn;
      await persistTrainingPlan(
        `${labelRu} · ${raceDate} · ${weeks} ${lang === 'ru' ? 'недель' : 'weeks'}`,
        sessions,
        overview || undefined,
      );
      setRacePlanSummary(
        lang === 'ru'
          ? `План сохранён: ${weeks} недель, ${sessions.length} тренировок до старта.`
          : `Plan saved: ${weeks} weeks, ${sessions.length} sessions until race day.`,
      );
    } catch (err) {
      console.error('[RunForm] generateRacePlan failed:', err);
      setRaceError(
        lang === 'ru'
          ? '❌ Не удалось сохранить план. Попробуйте ещё раз.'
          : '❌ Could not save the plan. Try again.',
      );
    } finally {
      setIsRaceLoading(false);
    }
  };

  return { generateRacePlan, isRaceLoading, raceError, racePlanSummary };
}
