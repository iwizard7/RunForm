'use client';

import { useState } from 'react';
import { requestOllama } from '@/lib/ollama';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import { TrainingSession } from '@/lib/actions';
import { RACE_DISTANCES, buildRacePlanTemplate, daysUntilRace, planEndDate, weeksUntilRace } from '@/lib/race-plan';

/**
 * The schedule is a local template (see buildRacePlanTemplate) — benchmarked
 * on 8 GB machines, a small model drowns in reasoning tokens on any
 * multi-session JSON and never finishes inside a sane timeout. The model is
 * only asked for a short overview, so a failed or slow comment costs the plan
 * nothing. Measured end-to-end: 80-110 s including the hidden reasoning and a
 * cold model load, hence the margin above the previous 120 s budget.
 */
const OVERVIEW_TIMEOUT_MS = 180_000;

type UseRacePlanParams = {
  lang: Language;
  history: WorkoutData[];
  persistTrainingPlan: (goal: string, sessions: TrainingSession[], notes?: string) => Promise<unknown>;
};

export type RacePlanInput = {
  distanceKey: string;
  daysPerWeek: number;
  /**
   * 'race' counts weeks down to a fixed race day; 'start' begins on any day
   * the runner picks (today included) and runs for `startWeeks` weeks — for
   * runners who know the goal distance but have no race on the calendar yet.
   */
  mode: 'race' | 'start';
  /** ISO date (YYYY-MM-DD) of the target race; required in 'race' mode. */
  raceDate?: string;
  /** ISO date (YYYY-MM-DD) of the first training day; required in 'start' mode. */
  startDate?: string;
  /** Plan length in weeks; required in 'start' mode (clamped to 4..24). */
  startWeeks?: number;
};

/** Plans shorter than 4 weeks have nothing to build; longer than 24 lose the thread. */
const MIN_PLAN_WEEKS = 4;
const MAX_PLAN_WEEKS = 24;

/**
 * Builds a multi-week periodized plan and saves it into the local plans
 * table: the week-by-week skeleton is deterministic, and the local model adds
 * a short coach-voice overview when it responds in time.
 */
export function useRacePlan({ lang, history, persistTrainingPlan }: UseRacePlanParams) {
  const [isRaceLoading, setIsRaceLoading] = useState(false);
  const [raceError, setRaceError] = useState<string | null>(null);
  const [racePlanSummary, setRacePlanSummary] = useState<string | null>(null);

  const generateRacePlan = async ({ distanceKey, daysPerWeek, mode, raceDate, startDate, startWeeks }: RacePlanInput) => {
    const distance = RACE_DISTANCES.find((item) => item.key === distanceKey);
    if (!distance) return;

    // Resolve the plan horizon: a race day to count down to, or a start day
    // to count up from.
    let weeks: number;
    let goalDate: string;
    if (mode === 'start') {
      weeks = Math.min(MAX_PLAN_WEEKS, Math.max(MIN_PLAN_WEEKS, Math.round(startWeeks ?? 12)));
      if (!startDate) return;
      goalDate = planEndDate(startDate, weeks);
      // Allow today; reject dates already in the past.
      const startDay = new Date(`${startDate}T12:00:00`);
      if (Number.isNaN(startDay.getTime()) || startDay.getTime() < Date.now() - 12 * 3600000) {
        setRaceError(
          lang === 'ru'
            ? 'Дата начала уже прошла — выберите сегодняшний или будущий день.'
            : 'The start date has already passed — pick today or a future day.',
        );
        return;
      }
    } else {
      weeks = weeksUntilRace(raceDate ?? '') ?? 0;
      goalDate = raceDate ?? '';
      if (!weeks) {
        // Explain the rejection with the actual gap instead of restating the
        // rule, and point at the start-date mode for soon races.
        const days = daysUntilRace(raceDate ?? '');
        const gap =
          days === null
            ? lang === 'ru'
              ? 'Дата старта не распознана.'
              : 'The race date could not be read.'
            : lang === 'ru'
              ? `До старта ${days} ${days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? 'дня' : 'дней'} — периодизация требует 4–24 недели.`
              : `That's ${days} days away — periodized plans span 4 to 24 weeks.`;
        setRaceError(
          `${gap} ${
            lang === 'ru'
              ? 'Если дата близко или её ещё нет, начните план с даты начала — она может быть любой.'
              : 'If the race is close (or not booked yet), switch to the start-date mode — any day works.'
          }`,
        );
        return;
      }
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
        const horizon =
          mode === 'start'
            ? `plan starts ${startDate} and runs ${weeks} weeks (goal day ~${goalDate})`
            : `${distance.labelEn} race on ${goalDate}, ${weeks}-week plan`;
        const prompt =
          `${horizon}, ${daysPerWeek} runs per week, runner currently ~${weeklyKm} km/week. /no_think Overview:`;
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
      const goal =
        mode === 'start'
          ? `${labelRu} · ${lang === 'ru' ? 'старт' : 'start'} ${startDate} · ${weeks} ${lang === 'ru' ? 'недель' : 'weeks'}`
          : `${labelRu} · ${goalDate} · ${weeks} ${lang === 'ru' ? 'недель' : 'weeks'}`;
      await persistTrainingPlan(goal, sessions, overview || undefined);
      setRacePlanSummary(
        lang === 'ru'
          ? `План сохранён: ${weeks} недель, ${sessions.length} тренировок.`
          : `Plan saved: ${weeks} weeks, ${sessions.length} sessions.`,
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
