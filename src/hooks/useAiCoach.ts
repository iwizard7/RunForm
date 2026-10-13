'use client';

import { useState } from 'react';
import { requestOllama, streamOllama } from '@/lib/ollama';
import { HealthFlag, UserPreferences, defaultPreferences, getEfficiencyMetrics, getIntensityScore, getWarmupAnalysis, getZoneProfile } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import { WeekPlanDay, getWeekPlanDays } from '@/lib/week';

export type WorkoutPhase = {
  phase: string;
  duration: string;
  zone: string;
  hr_range: string;
  pace: string;
  notes: string;
};

/** One day of the generated weekly plan; dates always come from getWeekPlanDays. */
export type WeekSession = WeekPlanDay & {
  session: string;
  distance: string;
  duration: string;
  zone: string;
  intensity: string;
  notes: string;
};

/** Maximum generation attempts for the plan, including self-correction retries. */
const PLAN_MAX_ATTEMPTS = 3;

function isValidPhases(value: unknown): value is WorkoutPhase[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as WorkoutPhase).phase === 'string',
    )
  );
}

/** Strict shape for the weekly plan: exactly 7 objects with a session name. */
function isValidWeekSessions(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.length === 7 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).session === 'string',
    )
  );
}

/** Coerces a model-provided field to a trimmed string with a safe fallback. */
function asText(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

type UseAiCoachParams = {
  lang: Language;
  history: WorkoutData[];
  workout: WorkoutData | null;
  currentIntensityScore: number;
  currentWeekMetLoad: number;
  weeklyLoadLabel: string;
  weeklyRecoveryLabel: string;
  healthFlags: HealthFlag[];
  currentEfficiency: ReturnType<typeof getEfficiencyMetrics> | null;
  currentWarmup: ReturnType<typeof getWarmupAnalysis> | null;
  currentZoneProfile: ReturnType<typeof getZoneProfile> | null;
  preferences?: UserPreferences;
};

export function useAiCoach(params: UseAiCoachParams) {
  const {
    lang,
    history,
    workout,
    currentIntensityScore,
    currentWeekMetLoad,
    weeklyLoadLabel,
    weeklyRecoveryLabel,
    healthFlags,
    currentEfficiency,
    currentWarmup,
    currentZoneProfile,
    preferences = defaultPreferences,
  } = params;

  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiPlan, setAiPlan] = useState('');
  const [planPhases, setPlanPhases] = useState<WorkoutPhase[]>([]);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [trainingGoal, setTrainingGoal] = useState<'fat_loss' | 'endurance' | 'speed' | null>(null);
  const [weekSessions, setWeekSessions] = useState<WeekSession[]>([]);
  const [isWeekLoading, setIsWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  // Shared by the single-session and weekly planners: the five most recent
  // sessions condensed into one stats block.
  const buildHistoryStats = (): string => {
    const rows = history.slice(0, 5).map((item) => {
      const date = new Date(item.startDate).toLocaleDateString();
      return `${date}: ${item.distance.toFixed(1)}km, avgHR:${item.avgHeartRate}bpm, maxHR:${item.maxHeartRate}bpm, pace:${item.pace}, METs:${item.averageMETs.toFixed(1)}, HRV:${item.hrv ?? 'N/A'}, intensity:${getIntensityScore(item)}, zone:${getZoneProfile(item, lang).label}, location:${item.location}`;
    });
    return rows.join('\n');
  };

  const fetchAIPlan = async () => {
    if (history.length === 0 || !trainingGoal) return;

    setIsPlanLoading(true);
    setPlanPhases([]);
    setAiPlan('');

    try {
      const statsStr = buildHistoryStats();

      // Zone boundaries come from the athlete's saved preferences (Settings),
      // so the planner follows the same zones the rest of the app uses.
      const { z1, z2, z3, z4, z5 } = preferences.hrZones;
      const thresholdPace = preferences.thresholdPace;

      const goalContext = {
        fat_loss: {
          label: 'Fat Loss / Weight Loss',
          zones: `Z1 and Z2 ONLY (HR < ${z2} bpm). Absolutely NO Z3, Z4, Z5. Keep easy and long.`,
          focus: 'Long duration at low intensity to maximize fat oxidation. 40-60 minutes total.',
        },
        endurance: {
          label: 'Aerobic Base / Endurance',
          zones: `Mainly Z2 (${z1}-${z2} bpm) with optional Z3 (${z2}-${z3} bpm) blocks. No Z4/Z5.`,
          focus: 'Build aerobic capacity. Steady state running. 30-50 minutes.',
        },
        speed: {
          label: 'Speed / VO2Max',
          zones: `Z4-Z5 intervals (${z3}-${z5}+ bpm) with Z1 full recovery between. Warmup Z1. Cooldown Z1.`,
          focus: 'Short explosive intervals 4-8x200-400m or 6x1min. Total 25-35 min including recovery.',
        },
      }[trainingGoal];

      const systemPrompt = `You are an elite running coach specializing in evidence-based training.\nGoal: ${goalContext.label}\nZone rules: ${goalContext.zones}\nFocus: ${goalContext.focus}\n\nAnalyze workout history and create a structured plan for tomorrow that STRICTLY follows the zone rules above.\nAlso adapt the plan to weekly load, recovery trend, recent intensity, and avoid overload if recent sessions were already hard.\nOutput ONLY a valid JSON array of phases, no extra text. Each phase MUST have:\n- phase: (Warmup | Easy Run | Tempo | Interval | Recovery | Cooldown)\n- duration: (e.g. "5 min" or "3 km")\n- zone: (Z1 | Z2 | Z3 | Z4 | Z5)\n- hr_range: (e.g. "110-130 bpm")\n- pace: (MANDATORY field. Estimate a target pace based on athlete's history and their threshold pace of ${thresholdPace} min/km, e.g. "6:30 min/km", NEVER output "not specified" or empty string)\n- notes: one motivating tip in ${lang === 'ru' ? 'Russian' : 'English'}\n\nAthlete HR zones: Z1<${z1}, Z2 ${z1}-${z2}, Z3 ${z2}-${z3}, Z4 ${z3}-${z4}, Z5>${z4}.\nReturn 4-5 phases only.`;

      const basePrompt = `Athlete history:\n${statsStr}\n\nWeekly load: ${weeklyLoadLabel}. Recovery: ${weeklyRecoveryLabel}. MET load: ${currentWeekMetLoad}. Recent hard flags: ${healthFlags.length}.\n\nGenerate training plan JSON for goal '${goalContext.label}':`;

      // Small models occasionally wrap the JSON in prose or markdown. Instead
      // of falling back to raw text, the model is asked to repair its own
      // answer, which succeeds in the large majority of cases.
      let raw = '';
      let previousRaw = '';
      let lastProblem = '';
      for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
        const prompt =
          attempt === 0
            ? basePrompt
            : `Your previous answer could not be used: ${lastProblem}.\nPrevious answer:\n${previousRaw}\n\nReturn ONLY the corrected JSON array (no markdown fences, no commentary):`;
        const data = await requestOllama({ prompt, system: systemPrompt });
        raw = data.response ?? '';

        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as unknown;
            if (isValidPhases(parsed)) {
              setPlanPhases(parsed);
              return;
            }
            lastProblem = 'the JSON array does not look like workout phases';
          } catch (e) {
            lastProblem = e instanceof Error ? e.message : 'the JSON is malformed';
          }
        } else {
          lastProblem = 'no JSON array was found in the answer';
        }
        previousRaw = raw;
      }

      // Every attempt failed — show the raw answer so nothing is lost.
      setAiPlan(raw);
    } catch (err) {
      console.error('[RunForm] fetchAIPlan failed:', err);
      setAiPlan(lang === 'ru' ? '❌ Ollama не отвечает. Убедитесь, что сервис запущен.' : '❌ Ollama is not responding. Make sure the service is running.');
    } finally {
      setIsPlanLoading(false);
    }
  };

  /**
   * Generates a full 7-day microcycle. The calendar (tomorrow…+7) is computed
   * locally and pinned in the prompt — the model only assigns sessions, so it
   * can never invent dates. Validation and self-correction mirror fetchAIPlan.
   */
  const fetchWeekPlan = async () => {
    if (history.length === 0 || !trainingGoal) return;

    setIsWeekLoading(true);
    setWeekSessions([]);
    setWeekError(null);

    try {
      const days = getWeekPlanDays(new Date(), lang);
      const statsStr = buildHistoryStats();
      const { z1, z2, z3, z4 } = preferences.hrZones;
      const thresholdPace = preferences.thresholdPace;

      const goalLabels: Record<'fat_loss' | 'endurance' | 'speed', string> = {
        fat_loss: 'Fat Loss / Weight Loss',
        endurance: 'Aerobic Base / Endurance',
        speed: 'Speed / VO2Max',
      };
      const goalLabel = goalLabels[trainingGoal];

      const systemPrompt = [
        'You are an elite running coach planning a full 7-day microcycle.',
        `Goal: ${goalLabel}.`,
        `Athlete HR zones: Z1<${z1}, Z2 ${z1}-${z2}, Z3 ${z2}-${z3}, Z4 ${z3}-${z4}, Z5>${z4}. Threshold pace: ${thresholdPace} min/km.`,
        'The dates are fixed and must appear in the answer order — do not add or reorder them.',
        'Spread hard sessions, include at least one full rest day, keep easy days truly easy, and progress sensibly from the history.',
        `Output ONLY a valid JSON array of exactly 7 objects. Each object MUST have:`,
        '- session: (Rest | Recovery | Easy Run | Long Run | Intervals | Tempo | Hill Repeats | Cross-training)',
        '- distance: target kilometres as a string, e.g. "8 km", or "-" for Rest',
        '- duration: e.g. "45 min", or "-" for Rest',
        '- zone: (Z1 | Z2 | Z3 | Z4 | Z5 | -)',
        '- intensity: (Low | Medium | High)',
        `- notes: one short motivating tip in ${lang === 'ru' ? 'Russian' : 'English'}`,
        'No markdown, no commentary, JSON array only.',
      ].join('\n');

      const basePrompt = `Dates in order: ${days.map((day) => day.key).join(', ')}.\n\nAthlete history:\n${statsStr}\n\nWeekly load: ${weeklyLoadLabel}. Recovery: ${weeklyRecoveryLabel}. MET load: ${currentWeekMetLoad}. Recent hard flags: ${healthFlags.length}.\n\nGenerate the 7-day plan JSON for goal '${goalLabel}':`;

      let raw = '';
      let previousRaw = '';
      let lastProblem = '';
      for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
        const prompt =
          attempt === 0
            ? basePrompt
            : `Your previous answer could not be used: ${lastProblem}.\nPrevious answer:\n${previousRaw}\n\nReturn ONLY the corrected JSON array of exactly 7 objects (no markdown fences, no commentary):`;
        const data = await requestOllama({ prompt, system: systemPrompt });
        raw = data.response ?? '';

        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as unknown;
            if (isValidWeekSessions(parsed)) {
              setWeekSessions(
                days.map((day, index) => {
                  const entry = parsed[index] as Record<string, unknown>;
                  return {
                    ...day,
                    session: asText(entry.session),
                    distance: asText(entry.distance),
                    duration: asText(entry.duration),
                    zone: asText(entry.zone),
                    intensity: asText(entry.intensity),
                    notes: asText(entry.notes),
                  };
                }),
              );
              return;
            }
            lastProblem = 'the JSON must be an array of exactly 7 objects with a session field';
          } catch (e) {
            lastProblem = e instanceof Error ? e.message : 'the JSON is malformed';
          }
        } else {
          lastProblem = 'no JSON array was found in the answer';
        }
        previousRaw = raw;
      }

      setWeekError(
        lang === 'ru'
          ? 'Модель не смогла собрать план на неделю за 3 попытки — попробуйте ещё раз.'
          : 'The model could not build the weekly plan in 3 attempts — please try again.',
      );
    } catch (err) {
      console.error('[RunForm] fetchWeekPlan failed:', err);
      setWeekError(lang === 'ru' ? '❌ Ollama не отвечает. Убедитесь, что сервис запущен.' : '❌ Ollama is not responding. Make sure the service is running.');
    } finally {
      setIsWeekLoading(false);
    }
  };

  const fetchAIAdvice = async () => {
    if (!workout) return;

    setIsAiLoading(true);
    setAiResponse('');
    try {
      const stats = [
        `Workout: ${workout.name}`,
        `Distance: ${workout.distance.toFixed(2)}km`,
        `Duration: ${Math.floor(workout.duration / 60)}:${(workout.duration % 60).toString().padStart(2, '0')}`,
        `Avg HR: ${workout.avgHeartRate}bpm`,
        `Max HR: ${workout.maxHeartRate}bpm`,
        `Pace: ${workout.pace}/km`,
        `Intensity score: ${currentIntensityScore}`,
        `Average METs: ${workout.averageMETs.toFixed(1)}`,
        `Zone profile: ${currentZoneProfile?.label ?? 'Unknown'}`,
        `Running efficiency: ${currentEfficiency?.score ?? 0}`,
        `Warmup score: ${currentWarmup?.controlScore ?? 0}`,
        `HRV (Readiness): ${workout.hrv ?? 'N/A'}`,
        `Weekly load: ${weeklyLoadLabel}`,
        `Recovery: ${weeklyRecoveryLabel}`,
        `Red flags: ${healthFlags.map((flag) => flag.title).join('; ') || 'none'}`,
      ].join(', ');

      const systemPrompt = `You are a professional running coach. Analyze the workout with intensity, MET load, zones, recovery, HRV readiness, and efficiency. Return a concise but useful review in ${lang === 'ru' ? 'Russian' : 'English'} with: 1) strongest point, 2) main risk, 3) one actionable recommendation, 4) whether the session fits endurance/fat-loss/speed goals.`;

      // The reply is streamed so the user sees text while the local model is
      // still generating instead of staring at an empty card. The closing
      // line repeats the UI-language directive in that language itself, which
      // keeps small models from answering in English. Identical stats produce
      // an identical answer, so the result is cached for the session.
      await streamOllama(
        {
          prompt: `Stats: ${stats}\nAdvice:\n${lang === 'ru' ? 'Ответь полностью на русском языке.' : 'Answer entirely in English.'}`,
          system: systemPrompt,
        },
        (full) => setAiResponse(full),
        { cache: true },
      );
    } catch {
      setAiResponse(lang === 'ru' ? 'Ой! Убедитесь, что Ollama запущена на localhost:11434' : 'Oops! Make sure Ollama is running on localhost:11434');
    } finally {
      setIsAiLoading(false);
    }
  };

  return {
    aiResponse,
    isAiLoading,
    aiPlan,
    planPhases,
    isPlanLoading,
    trainingGoal,
    setTrainingGoal,
    setAiPlan,
    setPlanPhases,
    fetchAIPlan,
    fetchAIAdvice,
    weekSessions,
    isWeekLoading,
    weekError,
    fetchWeekPlan,
  };
}
