'use client';

import { useEffect, useState } from 'react';
import { streamOllama } from '@/lib/ollama';
import { HealthFlag, UserPreferences, defaultPreferences } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';
import { WorkoutSplit, formatSplitPace } from '@/lib/splits';
import type { BodyMetric, TrainingPlan } from '@/lib/actions';

type WeekSummary = {
  distance: number;
  duration: number;
  calories: number;
  avgHr: number;
  activeDays: number;
};

type UseAiExtrasParams = {
  lang: Language;
  history: WorkoutData[];
  preferences?: UserPreferences;
  profileName: string;
  healthFlags: HealthFlag[];
  bodyMetrics: BodyMetric[];
  currentWeekSummary: WeekSummary;
  previousWeekSummary: WeekSummary;
  weeklyDistanceChange: number;
  currentWeekMetLoad: number;
  weeklyLoadLabel: string;
  weeklyRecoveryLabel: string;
  /** Cache key for the weekly digest, e.g. the Monday date of the current week. */
  weekKey: string;
};

const DIGEST_CACHE_PREFIX = 'runform.ai.digest.v1.';

/**
 * One-off AI text generations that sit around the core coach: the weekly
 * digest, personalized red-flag explanations, the readiness verdict, saved
 * plan explanations, GPS split analysis and the wellness-diary reflection.
 * Everything streams token-by-token into the UI.
 */
export function useAiExtras(params: UseAiExtrasParams) {
  const {
    lang,
    history,
    preferences = defaultPreferences,
    profileName,
    healthFlags,
    bodyMetrics,
    currentWeekSummary,
    previousWeekSummary,
    weeklyDistanceChange,
    currentWeekMetLoad,
    weeklyLoadLabel,
    weeklyRecoveryLabel,
    weekKey,
  } = params;

  const languageName = lang === 'ru' ? 'Russian' : 'English';
  // Small models (qwen2.5:3b) often drop a lone "Answer in Russian" buried in a
  // long English prompt, especially when the required output contains English
  // keywords. The directive is therefore repeated in the target language as
  // the very last line of every request, where recency weight is highest.
  const closingLanguageLine =
    lang === 'ru' ? 'Ответь полностью на русском языке.' : 'Answer entirely in English.';

  const [weeklyDigest, setWeeklyDigest] = useState('');
  const [isDigestLoading, setIsDigestLoading] = useState(false);

  const [flagExplanations, setFlagExplanations] = useState('');
  const [isFlagsLoading, setIsFlagsLoading] = useState(false);

  const [readiness, setReadiness] = useState('');
  const [isReadinessLoading, setIsReadinessLoading] = useState(false);

  const [planExplanations, setPlanExplanations] = useState<Record<string, string>>({});
  const [explainingPlanId, setExplainingPlanId] = useState<string | null>(null);

  const [splitsAnalysis, setSplitsAnalysis] = useState('');
  const [isSplitsLoading, setIsSplitsLoading] = useState(false);

  const [reflection, setReflection] = useState('');
  const [isReflecting, setIsReflecting] = useState(false);

  // Restore the cached digest for the current week on mount.
  useEffect(() => {
    if (typeof window === 'undefined' || !weekKey) return;
    try {
      const cached = window.localStorage.getItem(DIGEST_CACHE_PREFIX + weekKey);
      if (cached) {
        setWeeklyDigest(cached);
      }
    } catch {
      // localStorage may be unavailable — the digest simply starts empty.
    }
  }, [weekKey]);

  const weekContext = () => {
    const change = weeklyDistanceChange >= 0 ? `+${weeklyDistanceChange.toFixed(0)}` : weeklyDistanceChange.toFixed(0);
    return [
      `This week: ${currentWeekSummary.distance.toFixed(1)} km over ${currentWeekSummary.activeDays} active days, ${Math.round(currentWeekSummary.duration / 60)} min, avg HR ${currentWeekSummary.avgHr || 'n/a'} bpm.`,
      `Last week: ${previousWeekSummary.distance.toFixed(1)} km (change ${change}%).`,
      `MET load: ${currentWeekMetLoad} (${weeklyLoadLabel}).`,
      `Recovery trend: ${weeklyRecoveryLabel}.`,
      `Red flags: ${healthFlags.map((flag) => `${flag.title} [${flag.severity}]`).join('; ') || 'none'}.`,
    ].join('\n');
  };

  const recentWorkoutsContext = () =>
    history
      .slice(0, 5)
      .map(
        (item) =>
          `${new Date(item.startDate).toLocaleDateString()}: ${item.distance.toFixed(1)} km, pace ${item.pace}, avg HR ${item.avgHeartRate}, max HR ${item.maxHeartRate}, HRV ${item.hrv ?? 'n/a'}`,
      )
      .join('\n');

  const latestSoreness = () => {
    const withSoreness = bodyMetrics.find((metric) => typeof metric.sorenessLevel === 'number');
    return withSoreness ? `${withSoreness.sorenessLevel}/10 on ${withSoreness.date}` : 'unknown';
  };

  const generateWeeklyDigest = async () => {
    if (history.length === 0 || isDigestLoading) return;
    setIsDigestLoading(true);
    setWeeklyDigest('');
    try {
      const full = await streamOllama(
        {
          system: `You are a running coach writing a short weekly digest. Answer in ${languageName}. Format: exactly 3 bullet lines starting with "• " (what went well, what to watch, one highlight number), then one line starting with "Focus:" about the main priority for next week. No preamble, no markdown headers.`,
          prompt: `${weekContext()}\n\nWrite the weekly digest for ${profileName}.\n${closingLanguageLine}`,
        },
        (text) => setWeeklyDigest(text),
      );
      try {
        window.localStorage.setItem(DIGEST_CACHE_PREFIX + weekKey, full);
      } catch {
        // cache failures are non-fatal
      }
    } catch (err) {
      console.error('[RunForm] generateWeeklyDigest failed:', err);
      setWeeklyDigest(lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.');
    } finally {
      setIsDigestLoading(false);
    }
  };

  const explainFlags = async () => {
    if (healthFlags.length === 0 || isFlagsLoading) return;
    setIsFlagsLoading(true);
    setFlagExplanations('');
    try {
      await streamOllama(
        {
          system: `You are a running coach explaining detected training red flags. Answer in ${languageName}. For EACH flag write 2 sentences: what it likely means for this athlete, and one concrete adjustment. Separate flags with a blank line. Plain text, no markdown.`,
          prompt: `${weekContext()}\n\nExplain each red flag above for ${profileName}.\n${closingLanguageLine}`,
        },
        (text) => setFlagExplanations(text),
        { cache: true },
      );
    } catch (err) {
      console.error('[RunForm] explainFlags failed:', err);
      setFlagExplanations(lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.');
    } finally {
      setIsFlagsLoading(false);
    }
  };

  const assessReadiness = async () => {
    if (history.length === 0 || isReadinessLoading) return;
    setIsReadinessLoading(true);
    setReadiness('');
    try {
      const { z1, z2, z3, z4, z5 } = preferences.hrZones;
      await streamOllama(
        {
          system: `You are a running coach deciding whether the athlete should do a hard session next. The first line must be exactly one verdict word: GO, CAUTION or REST (these three words stay in English). ${lang === 'ru' ? 'Все остальные строки пиши только на русском языке.' : 'Write every other line in English.'} Then 3 short bullet lines with reasons. Plain text, no markdown.`,
          prompt: [
            `Recent workouts:\n${recentWorkoutsContext()}`,
            weekContext(),
            `Latest subjective soreness: ${latestSoreness()}.`,
            `Threshold pace: ${preferences.thresholdPace} min/km. HR zones: Z1<${z1}, Z2 ${z1}-${z2}, Z3 ${z2}-${z3}, Z4 ${z3}-${z4}, Z5>${z5}.`,
            `\nVerdict for ${profileName}: can they handle a hard session tomorrow?`,
            closingLanguageLine,
          ].join('\n'),
        },
        (text) => setReadiness(text),
        // Short TTL: readiness should reflect new data quickly, but repeated
        // clicks within a training break must not re-run the model.
        { cache: true, cacheTtlMs: 15 * 60 * 1000 },
      );
    } catch (err) {
      console.error('[RunForm] assessReadiness failed:', err);
      setReadiness(lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.');
    } finally {
      setIsReadinessLoading(false);
    }
  };

  const explainPlan = async (plan: TrainingPlan) => {
    if (explainingPlanId) return;
    setExplainingPlanId(plan.id);
    setPlanExplanations((prev) => ({ ...prev, [plan.id]: '' }));
    try {
      const sessionsText = plan.sessions
        .map(
          (session, index) =>
            `${index + 1}. ${session.phase ?? session.type ?? 'Session'} — ${session.duration ?? '?'}, zone ${session.zone ?? '?'}, pace ${session.pace ?? '?'}. ${session.notes ?? ''}`,
        )
        .join('\n');
      await streamOllama(
        {
          system: `You are a running coach explaining a training plan to a beginner. Answer in ${languageName}. Walk through each session: its purpose, why it is placed there, and one common mistake to avoid. End with one line of overall advice. Plain text, no markdown, 150-200 words.`,
          prompt: `Plan goal: ${plan.goal}\nSessions:\n${sessionsText}\n\nExplain the plan.\n${closingLanguageLine}`,
        },
        (text) => setPlanExplanations((prev) => ({ ...prev, [plan.id]: text })),
        { cache: true },
      );
    } catch (err) {
      console.error('[RunForm] explainPlan failed:', err);
      setPlanExplanations((prev) => ({
        ...prev,
        [plan.id]: lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.',
      }));
    } finally {
      setExplainingPlanId(null);
    }
  };

  const analyzeSplits = async (splits: WorkoutSplit[], workout: WorkoutData | null) => {
    if (splits.length === 0 || isSplitsLoading) return;
    setIsSplitsLoading(true);
    setSplitsAnalysis('');
    try {
      const splitsText = splits
        .map(
          (split) =>
            `${split.km} km (${split.distance.toFixed(2)} km) — avg HR ${split.avgHr ?? 'n/a'}${split.paceSec !== undefined ? `, pace ${formatSplitPace(split.paceSec)}/km` : ''}`,
        )
        .join('\n');
      await streamOllama(
        {
          system: `You are a running coach analyzing kilometre splits from a GPS run. Answer in ${languageName}. Comment on heart-rate drift across the splits, where fatigue first appeared, and give one pacing adjustment for next time. 4-6 short lines, plain text, no markdown.`,
          prompt: `Workout: ${workout?.distance.toFixed(1) ?? '?'} km, overall pace ${workout?.pace ?? '?'}, avg HR ${workout?.avgHeartRate ?? '?'} bpm.\nSplits:\n${splitsText}\n\nAnalyze the splits.\n${closingLanguageLine}`,
        },
        (text) => setSplitsAnalysis(text),
        { cache: true },
      );
    } catch (err) {
      console.error('[RunForm] analyzeSplits failed:', err);
      setSplitsAnalysis(lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.');
    } finally {
      setIsSplitsLoading(false);
    }
  };

  const reflectOnNote = async (noteText: string) => {
    const trimmed = noteText.trim();
    if (!trimmed || isReflecting) return;
    setIsReflecting(true);
    setReflection('');
    try {
      await streamOllama(
        {
          system: `You are a running coach connecting an athlete's wellness note with their training data. Answer in ${languageName}, 3-4 short sentences: acknowledge the note, link it to the recent load and metrics, and give one recommendation for the next session. Plain text, no markdown.`,
          prompt: [
            `Wellness note from ${profileName}: "${trimmed}"`,
            `Recent workouts:\n${recentWorkoutsContext()}`,
            weekContext(),
            `\nConnect the note to the training data and advise.`,
            closingLanguageLine,
          ].join('\n'),
        },
        (text) => setReflection(text),
        { cache: true },
      );
    } catch (err) {
      console.error('[RunForm] reflectOnNote failed:', err);
      setReflection(lang === 'ru' ? '❌ Ollama не отвечает.' : '❌ Ollama is not responding.');
    } finally {
      setIsReflecting(false);
    }
  };

  return {
    weeklyDigest,
    isDigestLoading,
    generateWeeklyDigest,
    flagExplanations,
    isFlagsLoading,
    explainFlags,
    readiness,
    isReadinessLoading,
    assessReadiness,
    planExplanations,
    explainingPlanId,
    explainPlan,
    splitsAnalysis,
    isSplitsLoading,
    analyzeSplits,
    reflection,
    isReflecting,
    reflectOnNote,
  };
}
