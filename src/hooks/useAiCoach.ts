'use client';

import { useState } from 'react';
import { requestOllama } from '@/lib/ollama';
import { HealthFlag, getEfficiencyMetrics, getIntensityScore, getWarmupAnalysis, getZoneProfile } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { WorkoutData } from '@/lib/parser';

type WorkoutPhase = {
  phase: string;
  duration: string;
  zone: string;
  hr_range: string;
  pace: string;
  notes: string;
};

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
  } = params;

  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiPlan, setAiPlan] = useState('');
  const [planPhases, setPlanPhases] = useState<WorkoutPhase[]>([]);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [trainingGoal, setTrainingGoal] = useState<'fat_loss' | 'endurance' | 'speed' | null>(null);

  const fetchAIPlan = async () => {
    if (history.length === 0 || !trainingGoal) return;

    setIsPlanLoading(true);
    setPlanPhases([]);
    setAiPlan('');

    try {
      const lastWorkouts = history.slice(0, 5).map((item) => ({
        date: new Date(item.startDate).toLocaleDateString(),
        dist: item.distance.toFixed(1),
        avgHr: item.avgHeartRate,
        maxHr: item.maxHeartRate,
        pace: item.pace,
        mets: item.averageMETs.toFixed(1),
        hrv: item.hrv ?? 'N/A',
        intensity: getIntensityScore(item),
        zone: getZoneProfile(item, lang).label,
        location: item.location,
      }));
      const statsStr = lastWorkouts
        .map((item) => `${item.date}: ${item.dist}km, avgHR:${item.avgHr}bpm, maxHR:${item.maxHr}bpm, pace:${item.pace}, METs:${item.mets}, HRV:${item.hrv}, intensity:${item.intensity}, zone:${item.zone}, location:${item.location}`)
        .join('\n');

      const goalContext = {
        fat_loss: {
          label: 'Fat Loss / Weight Loss',
          zones: 'Z1 and Z2 ONLY (HR < 140 bpm). Absolutely NO Z3, Z4, Z5. Keep easy and long.',
          focus: 'Long duration at low intensity to maximize fat oxidation. 40-60 minutes total.',
        },
        endurance: {
          label: 'Aerobic Base / Endurance',
          zones: 'Mainly Z2 (120-140 bpm) with optional Z3 (140-155 bpm) blocks. No Z4/Z5.',
          focus: 'Build aerobic capacity. Steady state running. 30-50 minutes.',
        },
        speed: {
          label: 'Speed / VO2Max',
          zones: 'Z4-Z5 intervals (155-170+ bpm) with Z1 full recovery between. Warmup Z1. Cooldown Z1.',
          focus: 'Short explosive intervals 4-8x200-400m or 6x1min. Total 25-35 min including recovery.',
        },
      }[trainingGoal];

      const systemPrompt = `You are an elite running coach specializing in evidence-based training.\nGoal: ${goalContext.label}\nZone rules: ${goalContext.zones}\nFocus: ${goalContext.focus}\n\nAnalyze workout history and create a structured plan for tomorrow that STRICTLY follows the zone rules above.\nAlso adapt the plan to weekly load, recovery trend, recent intensity, and avoid overload if recent sessions were already hard.\nOutput ONLY a valid JSON array of phases, no extra text. Each phase MUST have:\n- phase: (Warmup | Easy Run | Tempo | Interval | Recovery | Cooldown)\n- duration: (e.g. "5 min" or "3 km")\n- zone: (Z1 | Z2 | Z3 | Z4 | Z5)\n- hr_range: (e.g. "110-130 bpm")\n- pace: (MANDATORY field. Estimate a target pace based on athlete's history, e.g. "6:30 min/km", NEVER output "not specified" or empty string)\n- notes: one motivating tip in ${lang === 'ru' ? 'Russian' : 'English'}\n\nHR zones: Z1<120, Z2 120-140, Z3 140-155, Z4 155-170, Z5>170.\nReturn 4-5 phases only.`;

      const data = await requestOllama({
        prompt: `Athlete history:\n${statsStr}\n\nWeekly load: ${weeklyLoadLabel}. Recovery: ${weeklyRecoveryLabel}. MET load: ${currentWeekMetLoad}. Recent hard flags: ${healthFlags.length}.\n\nGenerate training plan JSON for goal '${goalContext.label}':`,
        system: systemPrompt,
      });

      const raw = data.response as string;
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          setPlanPhases(JSON.parse(jsonMatch[0]) as WorkoutPhase[]);
        } catch (e) {
          console.error('[RunForm] Failed to parse AI plan JSON:', e);
          setAiPlan(raw);
        }
      } else {
        setAiPlan(raw);
      }
    } catch (err) {
      console.error('[RunForm] fetchAIPlan failed:', err);
      setAiPlan(lang === 'ru' ? '❌ Ollama не отвечает. Убедитесь, что сервис запущен.' : '❌ Ollama is not responding. Make sure the service is running.');
    } finally {
      setIsPlanLoading(false);
    }
  };

  const fetchAIAdvice = async () => {
    if (!workout) return;

    setIsAiLoading(true);
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

      const data = await requestOllama({
        prompt: `Stats: ${stats}\nAdvice:`,
        system: systemPrompt,
      });
      setAiResponse(data.response);
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
  };
}
