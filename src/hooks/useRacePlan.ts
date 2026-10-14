'use client';

import { useState } from 'react';
import { requestOllama } from '@/lib/ollama';
import { UserPreferences } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import { TrainingSession } from '@/lib/actions';
import { RACE_DISTANCES, validateRaceSessions, weeksUntilRace } from '@/lib/race-plan';

/** Maximum generation attempts, including self-correction retries. */
const RACE_PLAN_MAX_ATTEMPTS = 3;
/**
 * A full multi-week plan is a long answer for a small local model — well
 * beyond the proxy route's 45 s non-stream default, so the request raises
 * its own budget (the route clamps it to 300 s anyway).
 */
const RACE_PLAN_TIMEOUT_MS = 240_000;

type UseRacePlanParams = {
  lang: Language;
  history: WorkoutData[];
  preferences: UserPreferences;
  persistTrainingPlan: (goal: string, sessions: TrainingSession[]) => Promise<unknown>;
};

export type RacePlanInput = {
  distanceKey: string;
  /** ISO date (YYYY-MM-DD) of the target race. */
  raceDate: string;
  daysPerWeek: number;
};

/**
 * Generates a multi-week periodized plan toward a target race and saves it
 * into the local plans table. Dates and week counts are decided locally —
 * the model only fills sessions in, and self-corrects against a strict
 * validator (every week 1..N present, numeric week, non-empty type).
 */
export function useRacePlan({ lang, history, preferences, persistTrainingPlan }: UseRacePlanParams) {
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
      const { z1, z2, z3, z4 } = preferences.hrZones;
      const thresholdPace = preferences.thresholdPace;

      // Recent volume, so the plan starts from where the runner actually is.
      const cutoff = Date.now() - 28 * 86400000;
      const recentKm = history
        .filter((item) => new Date(item.startDate).getTime() >= cutoff)
        .reduce((sum, item) => sum + item.distance, 0);
      const weeklyKm = Math.round((recentKm / 4) * 10) / 10;
      const recentRows = history
        .slice(0, 5)
        .map(
          (item) =>
            `${new Date(item.startDate).toLocaleDateString()}: ${item.distance.toFixed(1)}km, avgHR:${item.avgHeartRate}bpm, pace:${item.pace}`,
        )
        .join('\n');

      const totalSessions = weeks * daysPerWeek;
      const systemPrompt = [
        'You are an elite running coach designing a periodized race plan.',
        `Race: ${distance.labelEn} on ${raceDate} — the plan starts today and is ${weeks} weeks long.`,
        `The athlete runs ${daysPerWeek} times per week (exactly ${daysPerWeek} sessions per week, every week).`,
        `Athlete HR zones: Z1<${z1}, Z2 ${z1}-${z2}, Z3 ${z2}-${z3}, Z4 ${z3}-${z4}, Z5>${z4}. Threshold pace: ${thresholdPace} min/km.`,
        weeklyKm > 0
          ? `Recent volume: about ${weeklyKm} km per week — start the plan from this level, never jump more than 10% per week.`
          : 'No reliable recent volume — start conservatively (20-30 km weeks) and build gradually.',
        `Typical long run for this distance peaks near ${distance.typicalLongRunKm} km.`,
        'Structure: base phase first, then build (quality sessions appear), then peak, then a 2-week taper with volume dropping 30-50%.',
        'The long run grows by at most 10% per week and peaks 2-3 weeks before the race.',
        'Include the race itself as the final session of the last week, type "Race".',
        'Spread hard days, keep easy days truly easy, at least one full rest or cross-training day every week.',
        'Every week from 1 to ' + weeks + ' must have exactly ' + daysPerWeek + ' sessions — no missing weeks.',
        `Output ONLY a valid JSON array of exactly ${totalSessions} objects. Each object MUST have:`,
        '- week: integer 1..' + weeks,
        '- phase: (Base | Build | Peak | Taper | Race week)',
        '- day: weekday short name, e.g. "Mon"',
        '- type: (Rest | Recovery | Easy Run | Long Run | Intervals | Tempo | Hills | Cross-training | Race)',
        '- distance: target kilometres as a string, e.g. "12 km", or "-" for Rest/Cross-training',
        '- duration: e.g. "75 min", or "-" for Rest',
        '- zone: (Z1 | Z2 | Z3 | Z4 | Z5 | -)',
        '- intensity: (Low | Medium | High)',
        `- notes: one short tip in ${lang === 'ru' ? 'Russian' : 'English'}`,
        'No markdown, no commentary, JSON array only.',
      ].join('\n');

      const basePrompt = `Race date: ${raceDate}. Weeks: ${weeks}. Sessions per week: ${daysPerWeek}.\n\nAthlete history:\n${recentRows || '(empty — first races)'}\n\nGenerate the ${weeks}-week ${distance.labelEn} plan JSON:`;

      let raw = '';
      let previousRaw = '';
      let lastProblem = '';
      for (let attempt = 0; attempt < RACE_PLAN_MAX_ATTEMPTS; attempt += 1) {
        const prompt =
          attempt === 0
            ? basePrompt
            : `Your previous answer could not be used: ${lastProblem}.\nPrevious answer:\n${previousRaw}\n\nReturn ONLY the corrected JSON array (no markdown fences, no commentary), still exactly ${totalSessions} objects covering weeks 1..${weeks}:`;
        const data = await requestOllama({ prompt, system: systemPrompt }, { timeoutMs: RACE_PLAN_TIMEOUT_MS });
        raw = data.response ?? '';

        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as unknown;
            const result = validateRaceSessions(parsed, weeks);
            if (result.ok) {
              const labelRu = lang === 'ru' ? distance.labelRu : distance.labelEn;
              await persistTrainingPlan(`${labelRu} · ${raceDate} · ${weeks} ${lang === 'ru' ? 'недель' : 'weeks'}`, result.sessions);
              setRacePlanSummary(
                lang === 'ru'
                  ? `План сохранён: ${weeks} недель, ${result.sessions.length} тренировок до старта.`
                  : `Plan saved: ${weeks} weeks, ${result.sessions.length} sessions until race day.`,
              );
              return;
            }
            lastProblem = result.problem;
          } catch (e) {
            lastProblem = e instanceof Error ? e.message : 'the JSON is malformed';
          }
        } else {
          lastProblem = 'no JSON array was found in the answer';
        }
        previousRaw = raw;
      }

      setRaceError(
        lang === 'ru'
          ? `Модель не смогла собрать валидный план за ${RACE_PLAN_MAX_ATTEMPTS} попытки. Попробуйте ещё раз — локальные модели иногда ошибаются.`
          : `The model could not produce a valid plan in ${RACE_PLAN_MAX_ATTEMPTS} attempts. Try again — local models are occasionally inconsistent.`,
      );
    } catch (err) {
      console.error('[RunForm] generateRacePlan failed:', err);
      setRaceError(
        lang === 'ru' ? '❌ Ollama не отвечает. Убедитесь, что сервис запущен.' : '❌ Ollama is not responding. Make sure the service is running.',
      );
    } finally {
      setIsRaceLoading(false);
    }
  };

  return { generateRacePlan, isRaceLoading, raceError, racePlanSummary };
}
