"use client";

import NextImage from 'next/image';
import React, { useState, useEffect, useRef } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { 
  Activity, 
  History as HistoryIcon, 
  TrendingUp, 
  Settings, 
  Upload, 
  Heart, 
  Zap, 
  Timer, 
  MapPin,
  Flame,
  Wind,
  Languages,
  CalendarDays,
  Download,
  Target,
  BarChart3,
  ShieldAlert,
  Gauge,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Share2,
  Sparkles,
  Loader2
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { parseWorkoutJSON, WorkoutData } from '@/lib/parser';
import { translations, Language } from '@/lib/translations';
import { saveWorkout, getLatestWorkout, getAllWorkouts, clearAllWorkouts } from '@/lib/actions';
import {
  buildExplainedFlags,
  buildMetricExplainers,
  buildNextResultPrediction,
  buildVersusSummary,
  buildWeeklyCoach,
  buildWorkoutAiReview,
  getEfficiencyMetrics,
  getIntensityScore,
  getWeatherStress,
  getWarmupAnalysis,
  getZoneProfile,
  MetricExplainerKey,
  parsePaceToMinutes,
} from '@/lib/ai';
import { requestOllama } from '@/lib/ollama';
import { VersusSummaryCard } from '@/components/ai/VersusSummaryCard';
import { AiCoachDashboard } from '@/components/ai/AiCoachDashboard';
import { NextWorkoutInsights } from '@/components/ai/NextWorkoutInsights';
import { ShareCardModal } from '@/components/share/ShareCardModal';
import { ComparisonRow, DetailRow, MetricLabel, SidebarItem } from '@/components/ui/AppPrimitives';

type ChartDatum = {
  name: string;
  value: number;
  minutes: number;
  percentage: number;
  formatted: string;
  color: string;
};

export default function Home() {
  const [workout, setWorkout] = useState<WorkoutData | null>(null);
  const [history, setHistory] = useState<WorkoutData[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [lang, setLang] = useState<Language>('ru');
  const [profileName, setProfileName] = useState('Athlete');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  
  // Selection/Comparison state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWorkouts, setSelectedWorkouts] = useState<WorkoutData[]>([]);

  // AI & Share state
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [isShareSaving, setIsShareSaving] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const dashboardExportRef = useRef<HTMLDivElement>(null);
  const [isReportSaving, setIsReportSaving] = useState(false);
  const reportCardRef = useRef<HTMLDivElement>(null);

  // Next Plan state
  type WorkoutPhase = { phase: string; duration: string; zone: string; hr_range: string; pace: string; notes: string; };
  const [aiPlan, setAiPlan] = useState<string>('');
  const [planPhases, setPlanPhases] = useState<WorkoutPhase[]>([]);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [trainingGoal, setTrainingGoal] = useState<'fat_loss' | 'endurance' | 'speed' | null>(null);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricExplainerKey>('metLoad');

  const fetchAIPlan = async () => {
    if (history.length === 0 || !trainingGoal) return;
    setIsPlanLoading(true);
    setPlanPhases([]);
    setAiPlan('');
    try {
        const lastWorkouts = history.slice(0, 5).map(w => ({
            date: new Date(w.startDate).toLocaleDateString(),
            dist: w.distance.toFixed(1),
            avgHr: w.avgHeartRate,
            maxHr: w.maxHeartRate,
            pace: w.pace,
            mets: w.averageMETs.toFixed(1),
            intensity: getIntensityScore(w),
            zone: getZoneProfile(w, lang).label,
            location: w.location,
        }));
        const statsStr = lastWorkouts.map(w => `${w.date}: ${w.dist}km, avgHR:${w.avgHr}bpm, maxHR:${w.maxHr}bpm, pace:${w.pace}, METs:${w.mets}, intensity:${w.intensity}, zone:${w.zone}, location:${w.location}`).join('\n');

        // Goal-specific zone constraints
        const goalContext = {
            fat_loss: {
              label: 'Fat Loss / Weight Loss',
              zones: 'Z1 and Z2 ONLY (HR < 140 bpm). Absolutely NO Z3, Z4, Z5 — high intensity burns glycogen not fat. Keep easy, long.',
              focus: 'Long duration at low intensity to maximize fat oxidation. 40-60 minutes total.',
            },
            endurance: {
              label: 'Aerobic Base / Endurance',
              zones: 'Mainly Z2 (120-140 bpm) with optional Z3 (140-155 bpm) blocks. No Z4/Z5.',
              focus: 'Build aerobic capacity. Steady state running. 30-50 minutes.',
            },
            speed: {
              label: 'Speed / VO2Max',
              zones: 'Z4-Z5 intervals (155-170+ bpm) with Z1 full recovery between. Warmup Z1, Cooldown Z1.',
              focus: 'Short explosive intervals 4-8x200-400m or 6x1min. Total 25-35 min including recovery.',
            },
        }[trainingGoal];
        
        const systemPrompt = `You are an elite running coach specializing in evidence-based training.
Goal: ${goalContext.label}
Zone rules: ${goalContext.zones}
Focus: ${goalContext.focus}

Analyze workout history and create a structured plan for tomorrow that STRICTLY follows the zone rules above.
Also adapt the plan to weekly load, recovery trend, recent intensity, and avoid overload if recent sessions were already hard.
Output ONLY a valid JSON array of phases, no extra text. Each phase MUST have:
- phase: (Warmup | Easy Run | Tempo | Interval | Recovery | Cooldown)
- duration: (e.g. "5 min")
- zone: (Z1 | Z2 | Z3 | Z4 | Z5) — must match goal zone rules!
- hr_range: (e.g. "110-130 bpm")
- pace: (e.g. "6:30 min/km")
- notes: one motivating tip in ${lang === 'ru' ? 'Russian' : 'English'}

HR zones: Z1<120, Z2 120-140, Z3 140-155, Z4 155-170, Z5>170.
Return 4-5 phases only.`;
        
        const data = await requestOllama({
          prompt: `Athlete history:\n${statsStr}\n\nWeekly load: ${weeklyLoadStatus.label}. Recovery: ${weeklyRecoveryStatus.label}. MET load: ${currentWeekMetLoad}. Recent hard flags: ${healthFlags.length}.\n\nGenerate training plan JSON for goal '${goalContext.label}':`,
          system: systemPrompt,
        });
        const raw = data.response as string;
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const phases = JSON.parse(jsonMatch[0]) as WorkoutPhase[];
            setPlanPhases(phases);
        } else {
            setAiPlan(raw);
        }
    } catch {
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
          `Duration: ${formatTime(workout.duration)}`,
          `Avg HR: ${workout.avgHeartRate}bpm`,
          `Max HR: ${workout.maxHeartRate}bpm`,
          `Pace: ${workout.pace}/km`,
          `Intensity score: ${currentIntensityScore}`,
          `Average METs: ${workout.averageMETs.toFixed(1)}`,
          `Zone profile: ${currentZoneProfile?.label ?? 'Unknown'}`,
          `Running efficiency: ${currentEfficiency?.score ?? 0}`,
          `Warmup score: ${currentWarmup?.controlScore ?? 0}`,
          `Weather stress: ${weatherImpact?.stress ?? 0}`,
          `Weekly load: ${weeklyLoadStatus.label}`,
          `Recovery: ${weeklyRecoveryStatus.label}`,
          `Red flags: ${healthFlags.map((flag) => flag.title).join('; ') || 'none'}`
        ].join(', ');
        const systemPrompt = "You are a professional running coach. Analyze the workout with intensity, MET load, zones, weather, recovery, and efficiency. Return a concise but useful review in " + (lang === 'ru' ? 'Russian' : 'English') + " with: 1) strongest point, 2) main risk, 3) one actionable recommendation, 4) whether the session fits endurance/fat-loss/speed goals. Keep it readable and specific.";
        
        const data = await requestOllama({
          prompt: `Stats: ${stats}\nAdvice:`,
          system: systemPrompt,
        });
        setAiResponse(data.response);
    } catch {
        setAiResponse(lang === 'ru' ? "Ой! Убедитесь, что Ollama запущена на localhost:11434" : "Opps! Make sure Ollama is running on localhost:11434");
    } finally {
        setIsAiLoading(false);
    }
  };

  const toggleWorkoutSelection = (w: WorkoutData) => {
    if (selectedWorkouts.find(sw => sw.uuid === w.uuid)) {
      setSelectedWorkouts(selectedWorkouts.filter(sw => sw.uuid !== w.uuid));
    } else {
      if (selectedWorkouts.length < 2) {
        setSelectedWorkouts([...selectedWorkouts, w]);
      } else {
        setSelectedWorkouts([selectedWorkouts[1], w]);
      }
    }
  };

  const handleExport = async () => {
    if (!dashboardExportRef.current || !workout) return;

    try {
      const dataUrl = await toPng(dashboardExportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const image = new window.Image();
      image.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Failed to load dashboard image'));
      });

      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      const x = (pageWidth - width) / 2;
      const y = 16;

      pdf.setFillColor(5, 7, 11);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(dataUrl, 'PNG', x, y, width, height);
      pdf.save(`training-report-${new Date(workout.startDate).toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      window.alert(lang === 'ru' ? 'Не удалось экспортировать PDF.' : 'Failed to export PDF.');
    }
  };

  const handleSaveShareCard = async () => {
    if (!shareCardRef.current || !workout) return;

    try {
      setIsShareSaving(true);
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const link = document.createElement('a');
      const dateLabel = new Date(workout.startDate).toISOString().slice(0, 10);
      link.download = `training-card-${dateLabel}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to save share card:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить изображение.' : 'Failed to save image.');
    } finally {
      setIsShareSaving(false);
    }
  };

  const handleSaveReportCard = async () => {
    if (!reportCardRef.current) return;

    try {
      setIsReportSaving(true);
      const dataUrl = await toPng(reportCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const link = document.createElement('a');
      link.download = `training-report-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to save report image:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить отчёт.' : 'Failed to save report.');
    } finally {
      setIsReportSaving(false);
    }
  };

  const handleExportReportPdf = async () => {
    if (!reportCardRef.current) return;

    try {
      setIsReportSaving(true);
      const dataUrl = await toPng(reportCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const image = new window.Image();
      image.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Failed to load report image'));
      });

      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      const x = (pageWidth - width) / 2;
      const y = 16;

      pdf.setFillColor(5, 7, 11);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(dataUrl, 'PNG', x, y, width, height);
      pdf.save(`runform-coach-brief-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export report PDF:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить PDF отчёта.' : 'Failed to save report PDF.');
    } finally {
      setIsReportSaving(false);
    }
  };

  useEffect(() => {
    setIsClient(true);
    refreshData();
    const storedProfileName = window.localStorage.getItem('runform.profileName');
    if (storedProfileName) {
      setProfileName(storedProfileName);
    }
  }, []);

  useEffect(() => {
    if (!isClient) {
      return;
    }
    window.localStorage.setItem('runform.profileName', profileName.trim() || 'Athlete');
  }, [isClient, profileName]);

  useEffect(() => {
    if (history.length === 0) {
      return;
    }

    const latestDate = new Date(history[0].startDate);
    if (!selectedDateKey) {
      setSelectedDateKey(getDateKey(latestDate));
    }
    setCurrentMonth((prev) => {
      if (prev.getFullYear() === latestDate.getFullYear() && prev.getMonth() === latestDate.getMonth()) {
        return prev;
      }
      return new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
    });
  }, [history, selectedDateKey]);

  const refreshData = async () => {
    const latest = await getLatestWorkout();
    if (latest) {
      setWorkout(latest);
    }
    const all = await getAllWorkouts();
    setHistory(all);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const parsed = parseWorkoutJSON(json);
        await saveWorkout(parsed);
        await refreshData();
        setActiveTab('dashboard');
      } catch (error) {
        console.error("Error parsing/saving file:", error);
      }
    };
    reader.readAsText(file);
  };

  if (!isClient) return null;

  const t = translations[lang];

  const getTranslatedZone = (name: string) => {
    switch(name.toUpperCase()) {
        case 'PEAK': return t.zones.peak;
        case 'CARDIO': return t.zones.cardio;
        case 'FAT BURN': return t.zones.fatBurn;
        case 'WARM UP': return t.zones.warmUp;
        default: return name;
    }
  };

  const getStatusColor = (name: string) => {
    switch(name.toUpperCase()) {
        case 'PEAK': return '#ff2d55';
        case 'CARDIO': return '#ff9500';
        case 'FAT BURN': return '#34c759';
        default: return '#007aff';
    }
  };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

  const hrZonesData: ChartDatum[] = workout ? Object.values(workout.zones).map(z => ({
    name: getTranslatedZone(z.name),
    value: z.time.value,
    minutes: Math.round(z.time.value / 60),
    percentage: Math.round((z.rate || 0) * 100),
    formatted: formatTime(z.time.value),
    color: getStatusColor(z.name)
  })).filter(z => z.value >= 0).sort((a, b) => b.value - a.value) : [];

  const stats = workout ? [
    { label: t.distance, value: `${workout.distance.toFixed(2)} km`, icon: <MapPin size={18} />, color: '#007aff' },
    { label: t.duration, value: formatTime(workout.duration), icon: <Timer size={18} />, color: '#ff2d55' },
    { label: t.avgHr, value: `${workout.avgHeartRate} bpm`, icon: <Heart size={18} />, color: '#ff9500' },
    { label: t.calories, value: `${workout.calories} kcal`, icon: <Flame size={18} />, color: '#34c759' },
  ] : [];

  const getPRs = () => {
    if (history.length === 0) return null;
    return {
        distance: Math.max(...history.map(w => w.distance)),
        duration: Math.max(...history.map(w => w.duration)),
        calories: Math.max(...history.map(w => w.calories)),
        pace: history.reduce((prev, curr) => {
            const p = curr.pace.split('′');
            const m = parseInt(p[0]) || 999;
            const pm = prev.pace.split('′');
            const p_m = parseInt(pm[0]) || 999;
            return m < p_m ? curr : prev;
        })
    };
  };

  const prs = getPRs();

  const getDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const workoutsByDay = history.reduce<Record<string, WorkoutData[]>>((acc, item) => {
    const key = getDateKey(new Date(item.startDate));
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

  const monthDays = (() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const firstDayIndex = (start.getDay() + 6) % 7;
    const daysInMonth = end.getDate();
    const cells: Array<{ date: Date; key: string; inMonth: boolean }> = [];

    for (let i = firstDayIndex; i > 0; i -= 1) {
      const date = new Date(start);
      date.setDate(date.getDate() - i);
      cells.push({ date, key: getDateKey(date), inMonth: false });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      cells.push({ date, key: getDateKey(date), inMonth: true });
    }

    const trailing = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= trailing; i += 1) {
      const date = new Date(end);
      date.setDate(end.getDate() + i);
      cells.push({ date, key: getDateKey(date), inMonth: false });
    }

    return cells;
  })();

  const selectedDayWorkouts = selectedDateKey ? (workoutsByDay[selectedDateKey] || []) : [];
  const monthWorkoutEntries = history.filter((item) => {
    const date = new Date(item.startDate);
    return date.getFullYear() === currentMonth.getFullYear() && date.getMonth() === currentMonth.getMonth();
  });
  const monthDistance = monthWorkoutEntries.reduce((sum, item) => sum + item.distance, 0);
  const monthCalories = monthWorkoutEntries.reduce((sum, item) => sum + item.calories, 0);
  const monthActiveDays = new Set(monthWorkoutEntries.map((item) => getDateKey(new Date(item.startDate)))).size;
  const monthAvgHr = monthWorkoutEntries.length > 0
    ? Math.round(monthWorkoutEntries.reduce((sum, item) => sum + item.avgHeartRate, 0) / monthWorkoutEntries.length)
    : 0;

  const orderedDayKeys = Object.keys(workoutsByDay).sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let previousDate: Date | null = null;

  orderedDayKeys.forEach((key, index) => {
    const date = new Date(`${key}T00:00:00`);
    if (index === 0) {
      currentStreak = 1;
      longestStreak = 1;
      previousDate = date;
      return;
    }

    const diffInDays = previousDate ? Math.round((date.getTime() - previousDate.getTime()) / 86400000) : 0;
    currentStreak = diffInDays === 1 ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previousDate = date;
  });

  const calendarWeekdays = lang === 'ru'
    ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const getWeekStart = (date: Date) => {
    const copy = new Date(date);
    const day = (copy.getDay() + 6) % 7;
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - day);
    return copy;
  };

  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const previousWeekEnd = new Date(currentWeekStart);
  previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

  const currentWeekEntries = history.filter((item) => {
    const date = new Date(item.startDate);
    return date >= currentWeekStart && date <= currentWeekEnd;
  });

  const previousWeekEntries = history.filter((item) => {
    const date = new Date(item.startDate);
    return date >= previousWeekStart && date <= previousWeekEnd;
  });

  const summarizeWeek = (entries: WorkoutData[]) => {
    const distance = entries.reduce((sum, item) => sum + item.distance, 0);
    const duration = entries.reduce((sum, item) => sum + item.duration, 0);
    const calories = entries.reduce((sum, item) => sum + item.calories, 0);
    const avgHr = entries.length > 0 ? Math.round(entries.reduce((sum, item) => sum + item.avgHeartRate, 0) / entries.length) : 0;
    const activeDays = new Set(entries.map((item) => getDateKey(new Date(item.startDate)))).size;
    const bestPaceWorkout = entries.length > 0
      ? entries.reduce((best, item) => parsePaceToMinutes(item.pace) < parsePaceToMinutes(best.pace) ? item : best)
      : null;
    return { distance, duration, calories, avgHr, activeDays, bestPaceWorkout };
  };

  const currentWeekSummary = summarizeWeek(currentWeekEntries);
  const previousWeekSummary = summarizeWeek(previousWeekEntries);
  const weeklyDistanceChange = previousWeekSummary.distance > 0
    ? ((currentWeekSummary.distance - previousWeekSummary.distance) / previousWeekSummary.distance) * 100
    : 0;
  const currentWeekMetLoad = Math.round(currentWeekEntries.reduce((sum, item) => sum + (item.averageMETs * (item.duration / 60)), 0));
  const previousWeekMetLoad = Math.round(previousWeekEntries.reduce((sum, item) => sum + (item.averageMETs * (item.duration / 60)), 0));
  const metLoadStatus = currentWeekMetLoad >= 320
    ? { label: lang === 'ru' ? 'Высокий MET-load' : 'High MET load', color: '#ff2d55' }
    : currentWeekMetLoad >= 180
      ? { label: lang === 'ru' ? 'Рабочий MET-load' : 'Productive MET load', color: '#34c759' }
      : { label: lang === 'ru' ? 'Лёгкий MET-load' : 'Light MET load', color: '#ff9500' };

  const weeklyLoadStatus = (() => {
    if (currentWeekSummary.distance === 0) {
      return {
        label: lang === 'ru' ? 'Неделя без нагрузки' : 'No load this week',
        color: '#8e8e93',
        detail: lang === 'ru' ? 'Пока нет тренировок в текущей неделе.' : 'No workouts recorded in the current week yet.',
      };
    }
    if (weeklyDistanceChange > 35) {
      return {
        label: lang === 'ru' ? 'Риск перегруза' : 'Overload risk',
        color: '#ff2d55',
        detail: lang === 'ru' ? 'Объём резко вырос относительно прошлой недели.' : 'Weekly volume jumped sharply versus the previous week.',
      };
    }
    if (weeklyDistanceChange < -30 && previousWeekSummary.distance > 0) {
      return {
        label: lang === 'ru' ? 'Недогрузка' : 'Underload',
        color: '#ff9500',
        detail: lang === 'ru' ? 'Нагрузка заметно просела относительно прошлой недели.' : 'Training load dropped notably versus last week.',
      };
    }
    return {
      label: lang === 'ru' ? 'Хороший баланс' : 'Balanced week',
      color: '#34c759',
      detail: lang === 'ru' ? 'Нагрузка выглядит стабильной и контролируемой.' : 'The training load looks stable and controlled.',
    };
  })();

  const weeklyRecoveryStatus = (() => {
    if (currentWeekEntries.length < 2) {
      return {
        label: lang === 'ru' ? 'Недостаточно данных' : 'Not enough data',
        color: '#8e8e93',
      };
    }
    const avgCurrentHr = currentWeekSummary.avgHr;
    const avgPreviousHr = previousWeekSummary.avgHr || avgCurrentHr;
    if (avgCurrentHr <= avgPreviousHr - 3) {
      return {
        label: lang === 'ru' ? 'Восстановление улучшается' : 'Recovery improving',
        color: '#34c759',
      };
    }
    if (avgCurrentHr >= avgPreviousHr + 4) {
      return {
        label: lang === 'ru' ? 'Нужен контроль восстановления' : 'Watch recovery',
        color: '#ff9500',
      };
    }
    return {
      label: lang === 'ru' ? 'Восстановление стабильно' : 'Recovery steady',
      color: '#007aff',
    };
  })();

  const currentMonthWorkoutsCount = monthWorkoutEntries.length;
  const monthlyDistanceGoal = 50;
  const monthlyWorkoutGoal = 10;
  const avgHrGoal = 130;
  const paceGoalMinutes = 8.5;
  const bestWorkoutAllTime = history.length > 0
    ? history.reduce((best, item) => parsePaceToMinutes(item.pace) < parsePaceToMinutes(best.pace) ? item : best)
    : null;
  const currentBestPaceMinutes = bestWorkoutAllTime ? parsePaceToMinutes(bestWorkoutAllTime.pace) : null;
  const monthlyDistanceProgress = Math.min(100, Math.round((monthDistance / monthlyDistanceGoal) * 100));
  const monthlyWorkoutProgress = Math.min(100, Math.round((currentMonthWorkoutsCount / monthlyWorkoutGoal) * 100));
  const avgHrProgress = history.length > 0
    ? Math.max(0, Math.min(100, Math.round((avgHrGoal / Math.max(1, monthAvgHr || avgHrGoal)) * 100)))
    : 0;
  const paceGoalProgress = currentBestPaceMinutes
    ? Math.max(0, Math.min(100, Math.round((paceGoalMinutes / currentBestPaceMinutes) * 100)))
    : 0;

  const recentWorkouts = history.slice(0, 8);
  const recentDistances = recentWorkouts.map((item) => item.distance);
  const recentAvgDistance = recentDistances.length > 0
    ? recentDistances.reduce((sum, value) => sum + value, 0) / recentDistances.length
    : 0;
  const recentAvgHr = recentWorkouts.length > 0
    ? recentWorkouts.reduce((sum, item) => sum + item.avgHeartRate, 0) / recentWorkouts.length
    : 0;
  const recentPaceValues = recentWorkouts.map((item) => parsePaceToMinutes(item.pace));
  const recentBestPace = recentPaceValues.length > 0 ? Math.min(...recentPaceValues) : 0;
  const recentWorstPace = recentPaceValues.length > 0 ? Math.max(...recentPaceValues) : 0;
  const recentPaceSpread = recentWorstPace > 0 ? recentWorstPace - recentBestPace : 0;

  const fitnessIndex = (() => {
    if (history.length === 0) {
      return { value: 0, label: lang === 'ru' ? 'Нет данных' : 'No data', color: '#8e8e93' };
    }

    const consistencyScore = Math.min(100, currentWeekSummary.activeDays * 20);
    const volumeScore = Math.min(100, Math.round((currentWeekSummary.distance / 25) * 100));
    const hrScore = Math.max(0, Math.min(100, Math.round((140 - (monthAvgHr || recentAvgHr || 140)) * 4 + 50)));
    const paceScore = currentBestPaceMinutes ? Math.max(0, Math.min(100, Math.round((10 / currentBestPaceMinutes) * 100))) : 0;
    const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - recentPaceSpread * 18)));
    const value = Math.round((consistencyScore * 0.28) + (volumeScore * 0.24) + (hrScore * 0.18) + (paceScore * 0.18) + (stabilityScore * 0.12));

    if (value >= 80) return { value, label: lang === 'ru' ? 'Отличная форма' : 'Excellent shape', color: '#34c759' };
    if (value >= 60) return { value, label: lang === 'ru' ? 'Хорошая форма' : 'Good shape', color: '#007aff' };
    if (value >= 40) return { value, label: lang === 'ru' ? 'Базовая форма' : 'Base shape', color: '#ff9500' };
    return { value, label: lang === 'ru' ? 'Нужно набирать форму' : 'Needs improvement', color: '#ff2d55' };
  })();

  const healthFlags = (() => {
    const flags: Array<{ title: string; detail: string; severity: 'high' | 'medium'; color: string }> = [];
    const latest = history[0];
    const prev = history[1];

    if (latest && latest.avgHeartRate >= 150 && latest.distance < 5) {
      flags.push({
        title: lang === 'ru' ? 'Пульс высоковат для короткой дистанции' : 'Heart rate high for a short run',
        detail: lang === 'ru' ? 'Последняя тренировка дала высокий средний пульс при сравнительно небольшом объёме.' : 'Latest workout had a high average HR for a relatively short distance.',
        severity: 'high',
        color: '#ff2d55',
      });
    }

    if (previousWeekSummary.distance > 0 && currentWeekSummary.distance < previousWeekSummary.distance * 0.5) {
      flags.push({
        title: lang === 'ru' ? 'Объём резко просел' : 'Volume dropped sharply',
        detail: lang === 'ru' ? 'Текущая неделя пока даёт меньше половины объёма прошлой.' : 'Current week is below half of the previous week volume.',
        severity: 'medium',
        color: '#ff9500',
      });
    }

    if (recentWorkouts.slice(0, 3).filter((item) => item.avgHeartRate >= 145).length >= 3) {
      flags.push({
        title: lang === 'ru' ? 'Несколько тяжёлых тренировок подряд' : 'Several hard workouts in a row',
        detail: lang === 'ru' ? 'Три последние тренировки были с высоким пульсом, стоит проверить восстановление.' : 'Last three workouts were high intensity, recovery may need attention.',
        severity: 'high',
        color: '#ff2d55',
      });
    }

    if (latest && prev && latest.avgHeartRate - prev.avgHeartRate >= 10 && parsePaceToMinutes(latest.pace) >= parsePaceToMinutes(prev.pace)) {
      flags.push({
        title: lang === 'ru' ? 'Пульс растёт без улучшения темпа' : 'HR rising without pace improvement',
        detail: lang === 'ru' ? 'Последняя тренировка прошла тяжелее по пульсу, но не быстрее по темпу.' : 'Latest workout was harder on HR but not faster on pace.',
        severity: 'medium',
        color: '#ff9500',
      });
    }

    return flags;
  })();

  const currentIntensityScore = workout ? getIntensityScore(workout) : 0;
  const avgIntensityScore = history.length > 0
    ? Math.round(history.reduce((sum, item) => sum + getIntensityScore(item), 0) / history.length)
    : 0;
  const peakIntensityWorkout = history.length > 0
    ? history.reduce((best, item) => getIntensityScore(item) > getIntensityScore(best) ? item : best)
    : null;

  const currentEfficiency = workout ? getEfficiencyMetrics(workout) : null;
  const bestEfficiencyWorkout = history.length > 0
    ? history.reduce((best, item) => getEfficiencyMetrics(item).score > getEfficiencyMetrics(best).score ? item : best)
    : null;

  const currentWarmup = workout ? getWarmupAnalysis(workout, lang) : null;
  const currentZoneProfile = workout ? getZoneProfile(workout, lang) : null;

  const weatherImpact = (() => {
    if (!workout) return null;
    const { temperature, humidity, stress } = getWeatherStress(workout.weather);
    const label = stress >= 38
      ? (lang === 'ru' ? 'Условия влияют заметно' : 'Conditions likely matter')
      : stress >= 24
        ? (lang === 'ru' ? 'Условия умеренные' : 'Conditions are moderate')
        : (lang === 'ru' ? 'Условия нейтральные' : 'Conditions look neutral');
    return { temperature, humidity, stress, label };
  })();

  const indoorWorkouts = history.filter((item) => (item.location ?? '').toLowerCase() === 'indoor');
  const outdoorWorkouts = history.filter((item) => (item.location ?? '').toLowerCase() === 'outdoor');
  const dominantLocation = indoorWorkouts.length >= outdoorWorkouts.length
    ? (lang === 'ru' ? 'Indoor-профиль доминирует' : 'Indoor profile dominates')
    : (lang === 'ru' ? 'Outdoor-профиль доминирует' : 'Outdoor profile dominates');
  const uniqueSources = Array.from(new Set(history.map((item) => item.source ?? 'Unknown')));
  const uniqueDevices = Array.from(new Set(history.map((item) => `${item.device?.name ?? 'Unknown'} ${item.device?.model ?? ''}`.trim())));

  const workoutAiReview = buildWorkoutAiReview({
    workout,
    currentEfficiency,
    currentWarmup,
    currentZoneProfile,
    weatherStress: weatherImpact?.stress ?? 0,
    currentIntensityScore,
    avgIntensityScore,
    healthFlags,
    lang,
  });

  const weeklyCoach = buildWeeklyCoach({
    historyLength: history.length,
    currentWeekDistance: currentWeekSummary.distance,
    currentWeekActiveDays: currentWeekSummary.activeDays,
    currentWeekMetLoad,
    weeklyLoadStatus,
    weeklyRecoveryStatus,
    weeklyDistanceChange,
    healthFlags,
    lang,
  });

  const explainedFlags = buildExplainedFlags(healthFlags, lang);

  const nextResultPrediction = buildNextResultPrediction({
    history,
    healthFlags,
    weeklyDistanceChange,
    weeklyRecoveryStatus,
    weeklyLoadStatus,
    lang,
  });

  const metricExplainers = buildMetricExplainers({
    lang,
    currentWeekMetLoad,
    currentIntensityScore,
    avgIntensityScore,
    currentEfficiencyScore: currentEfficiency?.score ?? 0,
    currentZoneProfileLabel: currentZoneProfile?.label ?? '—',
    weatherStress: weatherImpact?.stress ?? 0,
    weeklyRecoveryStatus,
    fitnessIndexValue: fitnessIndex.value,
    fitnessIndexLabel: fitnessIndex.label,
  });

  const versusSummary = buildVersusSummary({ selectedWorkouts, lang });

  const getDayLoad = (distance: number, avgHr: number) => {
    const score = distance * 12 + Math.max(0, avgHr - 110) * 0.6;
    if (score >= 110) return { label: lang === 'ru' ? 'Высокая' : 'High', color: '#ff2d55', fill: 'linear-gradient(90deg, #ff9500 0%, #ff2d55 100%)', width: '100%' };
    if (score >= 70) return { label: lang === 'ru' ? 'Средняя' : 'Medium', color: '#ff9500', fill: 'linear-gradient(90deg, #ffd60a 0%, #ff9500 100%)', width: '68%' };
    return { label: lang === 'ru' ? 'Лёгкая' : 'Light', color: '#34c759', fill: 'linear-gradient(90deg, #34c759 0%, #30d158 100%)', width: '38%' };
  };

  const getWorkoutType = (item: WorkoutData) => {
    if (item.avgHeartRate >= 150 || item.pace.includes('7′') || item.pace.includes('6′')) {
      return { short: lang === 'ru' ? 'ИНТ' : 'INT', label: lang === 'ru' ? 'Интенсивная' : 'Intensity', color: '#ff2d55' };
    }
    if (item.distance >= 8 || item.duration >= 3600) {
      return { short: lang === 'ru' ? 'ЛОНГ' : 'LONG', label: lang === 'ru' ? 'Длинная' : 'Long run', color: '#007aff' };
    }
    return { short: lang === 'ru' ? 'ЛЕГК' : 'EASY', label: lang === 'ru' ? 'Лёгкая' : 'Easy', color: '#34c759' };
  };

  const getSmartWorkoutLabels = (item: WorkoutData) => {
    const labels: Array<{ label: string; color: string; bg: string }> = [];
    const zoneProfile = getZoneProfile(item, lang);
    const efficiency = getEfficiencyMetrics(item);
    const intensity = getIntensityScore(item);
    const weatherStress = getWeatherStress(item.weather).stress;

    if (zoneProfile.label.includes('Recovery')) {
      labels.push({ label: lang === 'ru' ? 'Recovery' : 'Recovery', color: '#57a6ff', bg: 'rgba(0,122,255,0.14)' });
    }
    if (zoneProfile.label.includes('Aerobic')) {
      labels.push({ label: lang === 'ru' ? 'Aerobic' : 'Aerobic', color: '#34c759', bg: 'rgba(52,199,89,0.14)' });
    }
    if (intensity >= 82) {
      labels.push({ label: lang === 'ru' ? 'High Strain' : 'High Strain', color: '#ff5f7a', bg: 'rgba(255,45,85,0.14)' });
    }
    if ((item.location ?? '').toLowerCase() === 'indoor' && item.avgHeartRate < 145) {
      labels.push({ label: lang === 'ru' ? 'Indoor Steady' : 'Indoor Steady', color: '#7fc1ff', bg: 'rgba(0,122,255,0.14)' });
    }
    if (efficiency.score >= 72) {
      labels.push({ label: lang === 'ru' ? 'Efficient' : 'Efficient', color: '#30d158', bg: 'rgba(48,209,88,0.14)' });
    }
    if (weatherStress >= 38) {
      labels.push({ label: lang === 'ru' ? 'Heat / Humidity' : 'Heat / Humidity', color: '#ffb347', bg: 'rgba(255,149,0,0.14)' });
    }

    if (labels.length === 0) {
      labels.push({ label: lang === 'ru' ? 'Balanced' : 'Balanced', color: '#b9c4d3', bg: 'rgba(255,255,255,0.08)' });
    }

    return labels.slice(0, 3);
  };

  const activityHeatmap = (() => {
    const totalDays = 7 * 18;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (totalDays - 1));

    const days = Array.from({ length: totalDays }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = getDateKey(date);
      const entries = workoutsByDay[key] || [];
      const load = entries.reduce((sum, item) => sum + item.distance * 12 + Math.max(0, item.avgHeartRate - 110) * 0.6 + getIntensityScore(item) * 0.22, 0);
      let level = 0;
      if (load >= 110) level = 4;
      else if (load >= 75) level = 3;
      else if (load >= 38) level = 2;
      else if (load > 0) level = 1;
      return { key, date, entries, load, level };
    });

    const weeks: typeof days[] = [];
    for (let index = 0; index < days.length; index += 7) {
      weeks.push(days.slice(index, index + 7));
    }
    return weeks;
  })();

  const advancedGoals = [
    {
      title: lang === 'ru' ? 'Серия 5 активных дней' : '5 active-day streak',
      current: `${Math.min(longestStreak, 5)} / 5`,
      progress: Math.min(100, Math.round((longestStreak / 5) * 100)),
      color: '#7c5cff',
      note: lang === 'ru' ? 'Показывает устойчивость привычки.' : 'Tracks consistency of the habit.',
    },
    {
      title: lang === 'ru' ? '3 аэробные тренировки за неделю' : '3 aerobic sessions per week',
      current: `${currentWeekEntries.filter((item) => getZoneProfile(item, lang).label.includes('Aerobic')).length} / 3`,
      progress: Math.min(100, Math.round((currentWeekEntries.filter((item) => getZoneProfile(item, lang).label.includes('Aerobic')).length / 3) * 100)),
      color: '#34c759',
      note: lang === 'ru' ? 'Полезно для базы и жиросжигания.' : 'Useful for base building and fat loss.',
    },
    {
      title: lang === 'ru' ? '2 восстановительных дня в неделю' : '2 recovery days per week',
      current: `${currentWeekEntries.filter((item) => getZoneProfile(item, lang).label.includes('Recovery')).length} / 2`,
      progress: Math.min(100, Math.round((currentWeekEntries.filter((item) => getZoneProfile(item, lang).label.includes('Recovery')).length / 2) * 100)),
      color: '#57a6ff',
      note: lang === 'ru' ? 'Балансирует нагрузку и восстановление.' : 'Balances training stress and recovery.',
    },
    {
      title: lang === 'ru' ? 'Efficiency score выше 72' : 'Efficiency score above 72',
      current: currentEfficiency ? `${currentEfficiency.score} / 72` : '—',
      progress: currentEfficiency ? Math.min(100, Math.round((currentEfficiency.score / 72) * 100)) : 0,
      color: '#ff9500',
      note: lang === 'ru' ? 'Фокус на экономичности, а не только на темпе.' : 'Focuses on economy, not just raw pace.',
    },
  ];

  const coachBrief = (() => {
    const wins: string[] = [];
    const risks: string[] = [];

    if (fitnessIndex.value >= 60) {
      wins.push(lang === 'ru' ? 'Форма держится на хорошем уровне.' : 'Fitness is holding at a good level.');
    }
    if (weeklyLoadStatus.label === (lang === 'ru' ? 'Хороший баланс' : 'Balanced week')) {
      wins.push(lang === 'ru' ? 'Недельная нагрузка выглядит сбалансированной.' : 'Weekly load looks well balanced.');
    }
    if (currentEfficiency && currentEfficiency.score >= 72) {
      wins.push(lang === 'ru' ? 'Экономичность бега сильнее обычного.' : 'Running economy is stronger than usual.');
    }

    if (healthFlags.length > 0) {
      risks.push(...healthFlags.slice(0, 2).map((flag) => flag.title));
    }
    if ((weatherImpact?.stress ?? 0) >= 38) {
      risks.push(lang === 'ru' ? 'Погодные условия заметно усложнили работу.' : 'Weather conditions materially increased the cost of the session.');
    }
    if (weeklyRecoveryStatus.label === (lang === 'ru' ? 'Нужен контроль восстановления' : 'Watch recovery')) {
      risks.push(lang === 'ru' ? 'Фон восстановления требует контроля.' : 'Recovery trend needs attention.');
    }

    const nextRecommendation = healthFlags.length > 1 || weeklyLoadStatus.label === (lang === 'ru' ? 'Риск перегруза' : 'Overload risk')
      ? (lang === 'ru' ? 'Следующую тренировку держать в Z1-Z2 и не добавлять объём.' : 'Keep the next workout in Z1-Z2 and avoid adding volume.')
      : (lang === 'ru' ? 'Можно сохранить текущую структуру недели и аккуратно строить объём.' : 'You can keep the current weekly structure and build volume cautiously.');

    return { wins, risks, nextRecommendation };
  })();

  const selectedDayGap = (() => {
    if (!selectedDateKey) return null;
    const selectedDate = new Date(`${selectedDateKey}T00:00:00`);
    const previousKey = orderedDayKeys.filter((key) => key < selectedDateKey).at(-1);
    if (!previousKey) return null;
    const previousDateForGap = new Date(`${previousKey}T00:00:00`);
    const diffInDays = Math.round((selectedDate.getTime() - previousDateForGap.getTime()) / 86400000) - 1;
    return diffInDays > 0 ? diffInDays : 0;
  })();

  return (
    <div className="app-container">
      <input 
        type="file" 
        accept=".json" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      {/* Sidebar */}
      <aside className="sidebar">
        <div>
          <NextImage
            src="/runform-logo.png"
            alt="RunForm"
            width={244}
            height={82}
            priority
            style={{
              width: '100%',
              maxWidth: '220px',
              height: 'auto',
              display: 'block',
              objectFit: 'contain'
            }}
          />
          <p className="secondary-text" style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '10px' }}>v1.0.0 Alpha</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SidebarItem icon={<Activity size={20} />} label={t.dashboard} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={<HistoryIcon size={20} />} label={t.history} active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          <SidebarItem icon={<CalendarDays size={20} />} label={t.calendar} active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<BarChart3 size={20} />} label={t.weeklySummary} active={activeTab === 'weekly-summary'} onClick={() => setActiveTab('weekly-summary')} />
          <SidebarItem icon={<Gauge size={20} />} label={t.fitnessIndex} active={activeTab === 'fitness-index'} onClick={() => setActiveTab('fitness-index')} />
          <SidebarItem icon={<Zap size={20} />} label={t.insights} active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
          <SidebarItem icon={<TrendingUp size={20} />} label={t.trends} active={activeTab === 'trends'} onClick={() => setActiveTab('trends')} />
          <SidebarItem icon={<Target size={20} />} label={t.goals} active={activeTab === 'goals'} onClick={() => setActiveTab('goals')} />
          <SidebarItem icon={<ShieldAlert size={20} />} label={t.healthFlags} active={activeTab === 'health-flags'} onClick={() => setActiveTab('health-flags')} />
          <SidebarItem icon={<FileText size={20} />} label={t.report} active={activeTab === 'report'} onClick={() => setActiveTab('report')} />
          <SidebarItem icon={<Sparkles size={20} />} label={t.aiCoach} active={activeTab === 'ai-coach'} onClick={() => setActiveTab('ai-coach')} />
          <SidebarItem icon={<Zap size={20} />} label={t.nextWorkout} active={activeTab === 'next-workout'} onClick={() => setActiveTab('next-workout')} />
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SidebarItem 
            icon={<Languages size={20} />} 
            label={lang === 'ru' ? 'English' : 'Русский'} 
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} 
          />
          <SidebarItem icon={<Upload size={20} />} label={t.importJson} onClick={() => fileInputRef.current?.click()} />
          <SidebarItem icon={<Settings size={20} />} label={t.settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </aside>

      {/* Main View */}
      <main className="main-view animate-fade-in">
        {activeTab === 'dashboard' && (
          <>
            {!workout ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                 <Upload size={48} style={{ marginBottom: '16px' }} />
                 <h2>Нет данных. Пожалуйста, импортируйте JSON файл тренировки.</h2>
              </div>
            ) : (
              <div
                ref={dashboardExportRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '40px',
                  background: 'radial-gradient(circle at top left, rgba(52, 199, 89, 0.12), transparent 25%), radial-gradient(circle at top right, rgba(0, 122, 255, 0.12), transparent 25%), #05070b',
                  padding: '8px',
                  borderRadius: '28px'
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '4px' }}>{t.welcome}</h1>
                    <p className="secondary-text">
                        {t.analysisSubtitle
                            .replace('{name}', workout.name === 'Running' && lang === 'ru' ? 'по бегу' : workout.name)
                            .replace('{date}', new Date(workout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }))
                        }
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }} className="no-print">
                     <button onClick={() => setShowShareCard(true)} style={{ background: 'rgba(52, 199, 89, 0.1)', color: '#34c759', border: '1px solid rgba(52, 199, 89, 0.2)', padding: '10px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Share2 size={18} /> {lang === 'ru' ? 'Поделиться' : 'Share'}
                     </button>
                     <button onClick={handleExport} style={{ background: 'rgba(0, 122, 255, 0.1)', color: '#007aff', border: '1px solid rgba(0, 122, 255, 0.2)', padding: '10px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Download size={18} /> {t.export}
                     </button>
                    <div className="premium-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Wind size={16} className="secondary-text" />
                        <span style={{ fontSize: '0.9rem' }}>
                            {workout.weather.temperature} · {workout.weather.humidity} {t.humidity}
                        </span>
                    </div>
                  </div>
                </header>

                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                  {stats.map((s, i) => (
                    <div key={i} className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ padding: '8px', borderRadius: '10px', background: `${s.color}20`, color: s.color, width: 'fit-content' }}>
                        {s.icon}
                      </div>
                      <div>
                        <p className="secondary-text">{s.label}</p>
                        <h3 style={{ fontSize: '1.4rem' }}>{s.value}</h3>
                      </div>
                    </div>
                  ))}
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '20px', minHeight: '400px' }}>
                  {/* HR Analysis Chart */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Zap size={18} className="accent-text" /> {t.hrAnalysis}
                    </h3>
                    <div style={{ width: '100%', flexGrow: 1, minHeight: '280px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hrZonesData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{fill: '#a0a0a0', fontSize: 11}} 
                                label={{ value: lang === 'ru' ? 'минуты' : 'minutes', angle: -90, position: 'insideLeft', fill: '#606060', offset: 10 }}
                            />
                            <Tooltip 
                              cursor={{fill: 'rgba(255,255,255,0.03)'}}
                              contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                              itemStyle={{ color: '#fff' }}
                            />
                            <Bar dataKey="minutes" radius={[6, 6, 0, 0]}>
                                {hrZonesData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Bar>
                          </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* HR Zones Distribution with List */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '16px' }}>{t.hrZones}</h3>
                    <div style={{ width: '100%', height: '180px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={hrZonesData}
                            innerRadius={55}
                            outerRadius={75}
                            paddingAngle={8}
                            dataKey="value"
                            stroke="none"
                          >
                            {hrZonesData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Zones List Legend */}
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {hrZonesData.map((zone, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: zone.color }}></div>
                                    <span style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>{zone.name}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span className="secondary-text" style={{ fontSize: '0.85rem' }}>{zone.formatted}</span>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 600, minWidth: '40px', textAlign: 'right' }}>{zone.percentage}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                   <DetailRow label={t.avgCadence} value={`${workout.cadence} spm`} />
                   <DetailRow label={t.totalSteps} value={`${workout.steps.toLocaleString()}`} />
                   <DetailRow label={t.pace} value={`${workout.pace}/km`} />
                </section>

                {prs && (
                    <section>
                        <h3 style={{ marginBottom: '20px' }}>{lang === 'ru' ? 'Личные рекорды' : 'Personal Records'}</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                            <div className="premium-card">
                                <p className="secondary-text">{t.distance}</p>
                                <h4 style={{ color: '#34c759' }}>{prs.distance.toFixed(2)} km</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.duration}</p>
                                <h4 style={{ color: '#ff2d55' }}>{formatTime(prs.duration)}</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.pace}</p>
                                <h4 style={{ color: '#007aff' }}>{prs.pace.pace}/km</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.calories}</p>
                                <h4 style={{ color: '#ff9500' }}>{prs.calories} kcal</h4>
                            </div>
                        </div>
                    </section>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <div className="history-view">
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <h1>{t.history}</h1>
                <button 
                  onClick={() => { setSelectionMode(!selectionMode); setSelectedWorkouts([]); }}
                  style={{ background: selectionMode ? 'rgba(0, 122, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: selectionMode ? '#007aff' : '#a0a0a0', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
                >
                  {selectionMode ? t.versusMode : t.compare}
                </button>
             </div>

             {selectionMode && selectedWorkouts.length === 2 && (
                <button 
                    onClick={() => setActiveTab('versus')}
                    className="premium-card animate-fade-in"
                    style={{ width: '100%', background: '#007aff', color: '#fff', textAlign: 'center', fontWeight: 600, marginBottom: '20px', cursor: 'pointer', padding: '16px' }}
                >
                    {t.compare} ({selectedWorkouts.length}/2) <ArrowRight size={18} style={{ verticalAlign: 'middle', marginLeft: '8px' }} />
                </button>
             )}

             <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {history.map((w) => {
                   const isSelected = selectedWorkouts.find(sw => sw.uuid === w.uuid);
                   return (
                    <div 
                        key={w.uuid} 
                        className={`premium-card ${isSelected ? 'selected-card' : ''}`} 
                        style={{ display: 'flex', alignItems: 'center', gap: '24px', cursor: 'pointer', border: isSelected ? '1px solid #007aff' : '1px solid rgba(255, 255, 255, 0.05)' }} 
                        onClick={() => {
                            if (selectionMode) {
                                toggleWorkoutSelection(w);
                            } else {
                                setWorkout(w);
                                setActiveTab('dashboard');
                            }
                        }}
                    >
                        <div style={{ padding: '12px', borderRadius: '12px', background: isSelected ? 'rgba(0, 122, 255, 0.1)' : 'rgba(52, 199, 89, 0.1)', color: isSelected ? '#007aff' : '#34c759' }}>
                           {isSelected ? <CheckCircle2 size={24} /> : <Activity size={24} />}
                        </div>
                        <div style={{ flex: 1 }}>
                           <h3 style={{ fontSize: '1.1rem' }}>{w.name}</h3>
                           <p className="secondary-text">{new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                           <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                             {getSmartWorkoutLabels(w).map((tag) => (
                               <span key={`${w.uuid}-${tag.label}`} style={{ padding: '5px 9px', borderRadius: '999px', background: tag.bg, color: tag.color, fontSize: '0.72rem', fontWeight: 700 }}>
                                 {tag.label}
                               </span>
                             ))}
                           </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                           <h3 style={{ fontSize: '1.1rem' }}>{w.distance.toFixed(2)} km</h3>
                           <p className="secondary-text">{formatTime(w.duration)}</p>
                        </div>
                    </div>
                   );
                })}
                {history.length === 0 && (
                   <div style={{ padding: '40px', textAlign: 'center', opacity: 0.5 }}>
                      <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                      <p>{lang === 'ru' ? 'История пока пуста.' : 'History is empty.'}</p>
                   </div>
                )}
             </div>
          </div>
        )}

        {activeTab === 'versus' && selectedWorkouts.length === 2 && (
            <div className="versus-view animate-fade-in">
                <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1>{t.versus}</h1>
                    <button onClick={() => setActiveTab('history')} className="secondary-text hover-light" style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.05)', border: 'none', padding: '8px 16px', borderRadius: '10px' }}>
                        {lang === 'ru' ? 'Назад в Историю' : 'Back to History'}
                    </button>
                </header>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '24px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    {selectedWorkouts.map((w, idx) => (
                        <div key={w.uuid} style={{ background: '#0a0a0a', padding: '32px' }}>
                            <p className="secondary-text" style={{ marginBottom: '8px' }}>{new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' })}</p>
                            <h2 style={{ marginBottom: '40px' }}>{w.name}</h2>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '24px' }}>
                                <ComparisonRow label={t.distance} value={`${w.distance.toFixed(2)} km`} isHigher={w.distance > selectedWorkouts[idx === 0 ? 1 : 0].distance} />
                                <ComparisonRow label={t.duration} value={formatTime(w.duration)} isHigher={w.duration > selectedWorkouts[idx === 0 ? 1 : 0].duration} />
                                <ComparisonRow label={t.avgHr} value={`${w.avgHeartRate} bpm`} isHigher={w.avgHeartRate > selectedWorkouts[idx === 0 ? 1 : 0].avgHeartRate} isGood={false} />
                                <ComparisonRow label={t.pace} value={`${w.pace}/km`} isHigher={parseFloat(w.pace.replace('′', '.')) < parseFloat(selectedWorkouts[idx === 0 ? 1 : 0].pace.replace('′', '.'))} />
                                <ComparisonRow label={t.calories} value={`${w.calories} kcal`} isHigher={w.calories > selectedWorkouts[idx === 0 ? 1 : 0].calories} />
                            </div>
                        </div>
                    ))}
                </div>

                <VersusSummaryCard lang={lang} selectedWorkouts={selectedWorkouts} summary={versusSummary} />
            </div>
        )}

        {activeTab === 'calendar' && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr', gap: '24px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <h1 style={{ marginBottom: '8px' }}>{t.calendar}</h1>
                  <p className="secondary-text">
                    {lang === 'ru'
                      ? 'Сетка по дням с нагрузкой, пустыми днями и быстрым переходом к деталям.'
                      : 'Day grid with load, rest days, and quick access to details.'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                    style={{ width: '42px', height: '42px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                    style={{ width: '42px', height: '42px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              <div className="premium-card" style={{ padding: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <div>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '6px' }}>
                      {currentMonth.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric' })}
                    </h2>
                    <p className="secondary-text">
                      {lang === 'ru'
                        ? `${monthActiveDays} активных дней в этом месяце`
                        : `${monthActiveDays} active days this month`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ padding: '8px 12px', borderRadius: '999px', background: 'rgba(52,199,89,0.14)', color: '#34c759', fontSize: '0.82rem', fontWeight: 700 }}>
                      {lang === 'ru' ? `Серия: ${longestStreak} дн.` : `Streak: ${longestStreak}d`}
                    </span>
                    <span style={{ padding: '8px 12px', borderRadius: '999px', background: 'rgba(0,122,255,0.14)', color: '#57a6ff', fontSize: '0.82rem', fontWeight: 700 }}>
                      {lang === 'ru' ? `${monthDistance.toFixed(1)} км` : `${monthDistance.toFixed(1)} km`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '10px', marginBottom: '10px' }}>
                  {calendarWeekdays.map((weekday) => (
                    <div key={weekday} style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#7f8a9a', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                      {weekday}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '10px' }}>
                  {monthDays.map(({ date, key, inMonth }) => {
                    const dayWorkouts = workoutsByDay[key] || [];
                    const totalDistance = dayWorkouts.reduce((sum, item) => sum + item.distance, 0);
                    const avgHrForDay = dayWorkouts.length > 0
                      ? Math.round(dayWorkouts.reduce((sum, item) => sum + item.avgHeartRate, 0) / dayWorkouts.length)
                      : 0;
                    const longestWorkout = dayWorkouts.reduce<WorkoutData | null>((best, item) => {
                      if (!best || item.distance > best.distance) return item;
                      return best;
                    }, null);
                    const load = getDayLoad(totalDistance, avgHrForDay);
                    const workoutType = longestWorkout ? getWorkoutType(longestWorkout) : null;
                    const isSelected = selectedDateKey === key;
                    const isToday = getDateKey(new Date()) === key;

                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedDateKey(key)}
                        style={{
                          minHeight: '108px',
                          borderRadius: '18px',
                          border: isSelected ? '1px solid rgba(87,166,255,0.85)' : '1px solid rgba(255,255,255,0.06)',
                          background: dayWorkouts.length > 0
                            ? 'linear-gradient(180deg, rgba(14, 25, 41, 0.95) 0%, rgba(7, 12, 21, 0.95) 100%)'
                            : 'rgba(255,255,255,0.025)',
                          padding: '12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          opacity: inMonth ? 1 : 0.35,
                          boxShadow: isSelected ? '0 0 0 1px rgba(87,166,255,0.2), 0 10px 24px rgba(0,0,0,0.35)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{date.getDate()}</span>
                          {isToday && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#05070b', background: '#34c759', borderRadius: '999px', padding: '3px 7px' }}>
                              {lang === 'ru' ? 'Сегодня' : 'Today'}
                            </span>
                          )}
                        </div>
                        {dayWorkouts.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                              <div style={{ width: load.width, height: '100%', borderRadius: '999px', background: load.fill }} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: load.color }} />
                              <span style={{ fontSize: '0.82rem', color: '#d8e1ee', fontWeight: 700 }}>
                                {totalDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                              <p style={{ fontSize: '0.74rem', color: '#8b9ab1' }}>
                                {dayWorkouts.length} {lang === 'ru' ? 'трен.' : 'workouts'}
                              </p>
                              {workoutType && (
                                <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em', color: workoutType.color }}>
                                  {workoutType.short}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                              <p style={{ fontSize: '0.74rem', color: '#8b9ab1' }}>
                                HR {avgHrForDay} bpm
                              </p>
                              <p style={{ fontSize: '0.7rem', color: load.color, fontWeight: 700 }}>
                                {load.label}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', color: '#576171' }}>
                            <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.05)' }} />
                            <p style={{ fontSize: '0.72rem' }}>
                              {lang === 'ru' ? 'Восстановление' : 'Recovery'}
                            </p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="premium-card">
                <h3 style={{ marginBottom: '18px' }}>
                  {selectedDateKey
                    ? new Date(`${selectedDateKey}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                    : (lang === 'ru' ? 'Выберите день' : 'Select a day')}
                </h3>

                {selectedDayWorkouts.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedDayGap !== null && (
                      <div style={{ borderRadius: '14px', padding: '14px 16px', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.12)' }}>
                        <p className="secondary-text" style={{ marginBottom: '4px' }}>
                          {lang === 'ru' ? 'Разрыв с прошлой беговой датой' : 'Gap since previous run day'}
                        </p>
                        <h4 style={{ color: '#ff9500' }}>
                          {selectedDayGap === 0
                            ? (lang === 'ru' ? 'без пропуска' : 'no break')
                            : (lang === 'ru' ? `${selectedDayGap} дн. без бега` : `${selectedDayGap} days off`)}
                        </h4>
                      </div>
                    )}
                    {selectedDayWorkouts.map((item) => {
                      const workoutType = getWorkoutType(item);
                      const load = getDayLoad(item.distance, item.avgHeartRate);
                      return (
                      <button
                        key={item.uuid}
                        className="premium-card"
                        onClick={() => {
                          setWorkout(item);
                          setActiveTab('dashboard');
                        }}
                        style={{ textAlign: 'left', padding: '18px', borderColor: 'rgba(52,199,89,0.14)', background: 'rgba(52,199,89,0.05)', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                          <h4>{item.name}</h4>
                          <span style={{ color: '#34c759', fontWeight: 700 }}>{item.distance.toFixed(2)} {lang === 'ru' ? 'км' : 'km'}</span>
                        </div>
                        <p className="secondary-text" style={{ marginBottom: '8px' }}>
                          {new Date(item.startDate).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · {formatTime(item.duration)}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#cad3df', marginBottom: '10px' }}>
                          <span>HR {item.avgHeartRate} bpm</span>
                          <span>{item.pace}/km</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.05em', color: workoutType.color }}>
                            {workoutType.label}
                          </span>
                          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: load.color }}>
                            {lang === 'ru' ? `Нагрузка: ${load.label}` : `Load: ${load.label}`}
                          </span>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.1)', padding: '24px', color: '#8992a0' }}>
                    {lang === 'ru'
                      ? 'На выбранный день тренировок нет. Это видно и в сетке как пустой день восстановления.'
                      : 'No workouts on the selected day. It is shown in the grid as a recovery day.'}
                  </div>
                )}
              </div>

              <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(0,122,255,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Объём месяца' : 'Month volume'}</p>
                  <h3>{monthDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,149,0,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Средний пульс' : 'Average HR'}</p>
                  <h3>{monthAvgHr || '—'} {monthAvgHr ? 'bpm' : ''}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Активные дни' : 'Active days'}</p>
                  <h3>{monthActiveDays}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,45,85,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Калории' : 'Calories'}</p>
                  <h3>{monthCalories.toLocaleString()}</h3>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'weekly-summary' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.weeklySummary}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? `Неделя ${currentWeekStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} - ${currentWeekEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
                  : `Week ${currentWeekStart.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })} - ${currentWeekEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Общий объём' : 'Total volume'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.distance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Активные дни' : 'Active days'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.activeDays}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Средний пульс' : 'Average HR'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.avgHr || '—'} {currentWeekSummary.avgHr ? 'bpm' : ''}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Лучший темп' : 'Best pace'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.bestPaceWorkout ? `${currentWeekSummary.bestPaceWorkout.pace}/km` : '—'}</h3>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'MET-load за неделю' : 'Weekly MET load'}
                  hint={lang === 'ru'
                    ? 'MET-load показывает суммарную энергетическую нагрузку за неделю: METs умножаются на длительность тренировки.'
                    : 'Weekly MET load estimates total energy load by multiplying METs by workout duration.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWeekMetLoad}</h3>
              </div>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'Прошлая неделя' : 'Previous week'}
                  hint={lang === 'ru'
                    ? 'То же значение MET-load, но для предыдущей недели, чтобы видеть динамику.'
                    : 'The same MET-load metric for the previous week to compare trend.'}
                />
                <h3 style={{ marginTop: '8px' }}>{previousWeekMetLoad}</h3>
              </div>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'Статус MET-load' : 'MET-load status'}
                  hint={lang === 'ru'
                    ? 'Упрощённая интерпретация недельной энергозатратности: лёгкая, рабочая или высокая нагрузка.'
                    : 'A simplified interpretation of weekly energy cost: light, productive, or high load.'}
                />
                <h3 style={{ marginTop: '8px', color: metLoadStatus.color }}>{metLoadStatus.label}</h3>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Изменение относительно прошлой недели' : 'Change vs previous week'}</p>
                  <h2 style={{ color: weeklyDistanceChange >= 0 ? '#34c759' : '#ff9500' }}>
                    {previousWeekSummary.distance > 0 ? `${weeklyDistanceChange >= 0 ? '+' : ''}${weeklyDistanceChange.toFixed(0)}%` : '—'}
                  </h2>
                </div>
                <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Нагрузка' : 'Load'}</p>
                  <h3 style={{ color: weeklyLoadStatus.color, marginBottom: '8px' }}>{weeklyLoadStatus.label}</h3>
                  <p style={{ color: '#c9d1da', lineHeight: 1.5 }}>{weeklyLoadStatus.detail}</p>
                </div>
                <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                  <MetricLabel
                    label={lang === 'ru' ? 'Тренд восстановления' : 'Recovery trend'}
                    hint={lang === 'ru'
                      ? 'Показывает, становится ли средний пульс на тренировках легче или тяжелее относительно прошлой недели.'
                      : 'Shows whether average training heart rate is trending easier or harder versus the previous week.'}
                  />
                  <h3 style={{ color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
                </div>
              </div>

              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3>{lang === 'ru' ? 'Разбивка по дням' : 'Day by day'}</h3>
                {Array.from({ length: 7 }, (_, index) => {
                  const day = new Date(currentWeekStart);
                  day.setDate(currentWeekStart.getDate() + index);
                  const key = getDateKey(day);
                  const dayEntries = workoutsByDay[key] || [];
                  const distance = dayEntries.reduce((sum, item) => sum + item.distance, 0);
                  const load = getDayLoad(distance, dayEntries.length > 0 ? Math.round(dayEntries.reduce((sum, item) => sum + item.avgHeartRate, 0) / dayEntries.length) : 0);
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: '14px', alignItems: 'center' }}>
                      <span className="secondary-text">
                        {day.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short', day: 'numeric' })}
                      </span>
                      <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ width: dayEntries.length > 0 ? `${Math.min(100, distance * 10)}%` : '0%', height: '100%', background: load.fill }} />
                      </div>
                      <span style={{ color: dayEntries.length > 0 ? load.color : '#6b7280', fontSize: '0.82rem', fontWeight: 700 }}>
                        {dayEntries.length > 0 ? `${distance.toFixed(1)} km` : 'rest'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'fitness-index' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.fitnessIndex}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Сводный индекс на основе объёма, частоты, пульса, темпа и стабильности последних тренировок.'
                  : 'Composite score based on volume, frequency, heart rate, pace, and stability of recent workouts.'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ width: '140px', height: '140px', borderRadius: '50%', background: `conic-gradient(${fitnessIndex.color} ${fitnessIndex.value}%, rgba(255,255,255,0.06) 0)`, display: 'grid', placeItems: 'center' }}>
                    <div style={{ width: '104px', height: '104px', borderRadius: '50%', background: '#0a0f17', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '2rem', fontWeight: 800 }}>{fitnessIndex.value}</span>
                      <span className="secondary-text" style={{ fontSize: '0.8rem' }}>score</span>
                    </div>
                  </div>
                  <div>
                    <h2 style={{ color: fitnessIndex.color, marginBottom: '8px' }}>{fitnessIndex.label}</h2>
                    <p style={{ color: '#c9d1da', lineHeight: 1.6 }}>
                      {lang === 'ru'
                        ? 'Индекс помогает быстро оценить текущую форму без погружения во все графики.'
                        : 'This index gives a quick view of your current condition without opening every chart.'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(0,122,255,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Средняя дистанция' : 'Average distance'}
                      hint={lang === 'ru'
                        ? 'Средняя дистанция последних тренировок, используемая как один из сигналов общей формы.'
                        : 'Average distance across recent workouts, used as one of the fitness signals.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentAvgDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,149,0,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Средний HR' : 'Average HR'}
                      hint={lang === 'ru'
                        ? 'Средний пульс по последним тренировкам. Ниже при похожем темпе обычно означает лучшую экономичность.'
                        : 'Average heart rate over recent workouts. Lower at similar pace usually means better efficiency.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentAvgHr ? Math.round(recentAvgHr) : '—'} {recentAvgHr ? 'bpm' : ''}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Лучший темп' : 'Best pace'}
                      hint={lang === 'ru'
                        ? 'Самый быстрый темп в истории: меньшее значение означает более быстрый бег.'
                        : 'Fastest pace in history: lower value means faster running.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{bestWorkoutAllTime ? `${bestWorkoutAllTime.pace}/km` : '—'}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(175,82,222,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Стабильность темпа' : 'Pace stability'}
                      hint={lang === 'ru'
                        ? 'Разброс темпа между последними тренировками. Чем меньше, тем стабильнее ритм.'
                        : 'Spread of pace across recent workouts. Lower means more stable pacing.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentPaceSpread.toFixed(2)} {lang === 'ru' ? 'мин/км' : 'min/km'}</h3>
                  </div>
                </div>
              </div>

              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3>{lang === 'ru' ? 'Из чего состоит индекс' : 'What drives the score'}</h3>
                {[
                  { label: lang === 'ru' ? 'Частота тренировок' : 'Workout frequency', value: Math.min(100, currentWeekSummary.activeDays * 20), color: '#34c759' },
                  { label: lang === 'ru' ? 'Недельный объём' : 'Weekly volume', value: Math.min(100, Math.round((currentWeekSummary.distance / 25) * 100)), color: '#007aff' },
                  { label: lang === 'ru' ? 'Пульс под контролем' : 'Heart rate control', value: Math.max(0, Math.min(100, Math.round((140 - (monthAvgHr || recentAvgHr || 140)) * 4 + 50))), color: '#ff9500' },
                  { label: lang === 'ru' ? 'Темп' : 'Pace', value: currentBestPaceMinutes ? Math.max(0, Math.min(100, Math.round((10 / currentBestPaceMinutes) * 100))) : 0, color: '#ff2d55' },
                  { label: lang === 'ru' ? 'Стабильность' : 'Stability', value: Math.max(0, Math.min(100, Math.round(100 - recentPaceSpread * 18))), color: '#af52de' },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span>{metric.label}</span>
                      <span style={{ color: metric.color, fontWeight: 700 }}>{metric.value}%</span>
                    </div>
                    <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${metric.value}%`, height: '100%', background: metric.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'insights' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.insights}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Расширенная аналитика из сырых полей JSON, которые раньше не использовались.'
                  : 'Extended analytics derived from raw JSON fields that were not used before.'}
              </p>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Intensity Score' : 'Intensity Score'}
                  hint={lang === 'ru'
                    ? 'Сводный балл тяжести тренировки по intensity, MET и времени в тяжёлых зонах.'
                    : 'Composite training hardness score based on intensity, METs, and time in harder zones.'}
                />
                <h2 style={{ fontSize: '2.4rem', marginBottom: '10px', color: currentIntensityScore >= 85 ? '#ff2d55' : currentIntensityScore >= 70 ? '#ff9500' : '#34c759' }}>
                  {currentIntensityScore || '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Score собирается из средней интенсивности, пиков, MET и доли времени в тяжёлых зонах.'
                    : 'The score combines average intensity, peaks, METs, and time spent in harder zones.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Средний score по истории' : 'Average historical score'}
                  hint={lang === 'ru'
                    ? 'Среднее значение Intensity Score по всей истории тренировок.'
                    : 'Average Intensity Score across all recorded workouts.'}
                />
                <h3 style={{ marginTop: '8px' }}>{avgIntensityScore || '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Самая тяжёлая тренировка' : 'Hardest workout'}
                  hint={lang === 'ru'
                    ? 'Тренировка с максимальным Intensity Score в истории.'
                    : 'Workout with the highest Intensity Score in history.'}
                />
                <h3 style={{ marginTop: '8px' }}>{peakIntensityWorkout ? getIntensityScore(peakIntensityWorkout) : '—'}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>
                  {peakIntensityWorkout
                    ? new Date(peakIntensityWorkout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')
                    : ''}
                </p>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Running Efficiency' : 'Running Efficiency'}
                  hint={lang === 'ru'
                    ? 'Оценка экономичности бега по сочетанию темпа, пульса, каденса и длины шага.'
                    : 'Estimate of running economy based on pace, heart rate, cadence, and stride length.'}
                />
                <h2 style={{ fontSize: '2.2rem', marginBottom: '10px', color: currentEfficiency && currentEfficiency.score >= 75 ? '#34c759' : '#ff9500' }}>
                  {currentEfficiency?.score ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Score учитывает каденс, длину шага, темп и пульс, чтобы оценить экономичность бега.'
                    : 'This score combines cadence, stride length, pace, and heart rate to assess running economy.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Длина шага' : 'Stride length'}
                  hint={lang === 'ru'
                    ? 'Средняя длина шага в сантиметрах: дистанция делится на количество шагов.'
                    : 'Average stride length in centimeters: distance divided by number of steps.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentEfficiency ? `${currentEfficiency.strideLength} cm` : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Темп / пульс' : 'Pace / heart rate'}
                  hint={lang === 'ru'
                    ? 'Соотношение темпа к среднему пульсу. Это вспомогательная метрика эффективности, а не абсолютный стандарт.'
                    : 'Pace-to-average-heart-rate ratio. A helper efficiency metric, not an absolute benchmark.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentEfficiency ? currentEfficiency.pacePerHr.toFixed(4) : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Лучшая эффективная тренировка' : 'Best efficiency workout'}
                  hint={lang === 'ru'
                    ? 'Тренировка с максимальным Running Efficiency score.'
                    : 'Workout with the highest Running Efficiency score.'}
                />
                <h3 style={{ marginTop: '8px' }}>{bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : '—'}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>
                  {bestEfficiencyWorkout
                    ? new Date(bestEfficiencyWorkout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')
                    : ''}
                </p>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Warmup / Cooldown Analysis' : 'Warmup / Cooldown Analysis'}
                  hint={lang === 'ru'
                    ? 'Проверяет качество входа в тренировку по времени в Z1, минимальному пульсу и распределению нагрузки.'
                    : 'Evaluates session entry quality using time in Z1, minimum HR, and load distribution.'}
                />
                <h2 style={{ fontSize: '2rem', marginBottom: '10px', color: currentWarmup && currentWarmup.controlScore >= 70 ? '#34c759' : '#ff9500' }}>
                  {currentWarmup?.controlScore ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {currentWarmup?.label ?? (lang === 'ru' ? 'Нет данных для анализа разминки.' : 'No warmup data available.')}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Время в Z1' : 'Time in Z1'}
                  hint={lang === 'ru'
                    ? 'Сколько времени тренировка провела в зоне разминки / очень лёгкой работы.'
                    : 'How much time the workout spent in the warmup / very easy zone.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWarmup ? formatTime(currentWarmup.warmupSeconds) : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Доля разминки' : 'Warmup share'}
                  hint={lang === 'ru'
                    ? 'Процент времени тренировки, проведённый в Z1.'
                    : 'Percentage of total workout time spent in Z1.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWarmup ? `${Math.round(currentWarmup.warmupRate * 100)}%` : '—'}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Zone Profile' : 'Zone Profile'}
                  hint={lang === 'ru'
                    ? 'Тип тренировки по распределению времени между пульсовыми зонами.'
                    : 'Workout type inferred from how time is distributed across heart-rate zones.'}
                />
                <h2 style={{ marginBottom: '10px', color: currentZoneProfile?.color ?? '#fff' }}>{currentZoneProfile?.label ?? '—'}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {currentZoneProfile?.detail ?? (lang === 'ru' ? 'Недостаточно данных по зонам.' : 'Not enough zone data.')}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[
                  { label: 'Z1', value: Math.round((workout?.zones.zone1?.rate ?? 0) * 100), color: '#34c759' },
                  { label: 'Z2', value: Math.round((workout?.zones.zone2?.rate ?? 0) * 100), color: '#007aff' },
                  { label: 'Z3', value: Math.round((workout?.zones.zone3?.rate ?? 0) * 100), color: '#ff9500' },
                  { label: 'Z4', value: Math.round((workout?.zones.zone4?.rate ?? 0) * 100), color: '#ff2d55' },
                ].map((zone) => (
                  <div key={zone.label} style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                    <p className="secondary-text">{zone.label}</p>
                    <h3 style={{ marginTop: '8px', color: zone.color }}>{zone.value}%</h3>
                  </div>
                ))}
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Weather Impact' : 'Weather Impact'}
                  hint={lang === 'ru'
                    ? 'Оценка того, насколько температура и влажность могли усложнить тренировку.'
                    : 'Estimate of how much temperature and humidity may have affected the session.'}
                />
                <h2 style={{ marginBottom: '10px', color: weatherImpact && weatherImpact.stress >= 38 ? '#ff9500' : '#34c759' }}>
                  {weatherImpact?.label ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Температура и влажность учитываются как внешний стрессор для темпа и пульса.'
                    : 'Temperature and humidity are treated as an external stress factor for pace and HR.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Температура' : 'Temperature'}</p>
                <h3 style={{ marginTop: '8px' }}>{workout?.weather.temperature ?? '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Влажность' : 'Humidity'}</p>
                <h3 style={{ marginTop: '8px' }}>{workout?.weather.humidity ?? '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Погодный stress score' : 'Weather stress score'}
                  hint={lang === 'ru'
                    ? 'Условный балл внешней нагрузки от погоды. Чем выше, тем сильнее условия могли влиять на пульс и темп.'
                    : 'A rough external-load score from weather. Higher means conditions may have influenced HR and pace more.'}
                />
                <h3 style={{ marginTop: '8px' }}>{weatherImpact?.stress ?? '—'}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Indoor / Outdoor Profiling' : 'Indoor / Outdoor Profiling'}</p>
                <h2 style={{ marginBottom: '10px' }}>{dominantLocation}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Профиль строится по полю location и помогает разделять условия выполнения тренировки.'
                    : 'The profile uses the location field to separate training environments.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">Indoor</p>
                <h3 style={{ marginTop: '8px' }}>{indoorWorkouts.length}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">Outdoor</p>
                <h3 style={{ marginTop: '8px' }}>{outdoorWorkouts.length}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Source / Device Audit' : 'Source / Device Audit'}</p>
                <h2 style={{ marginBottom: '10px' }}>{history[0]?.device.name ?? '—'}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Технический аудит источника данных помогает отслеживать происхождение и совместимость записей.'
                    : 'Technical source auditing helps track provenance and compatibility of records.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Источники' : 'Sources'}</p>
                <h3 style={{ marginTop: '8px' }}>{uniqueSources.length}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>{uniqueSources[0] ?? '—'}</p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Устройства' : 'Devices'}</p>
                <h3 style={{ marginTop: '8px' }}>{uniqueDevices.length}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>{uniqueDevices[0] ?? '—'}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="trends-view animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
             <h1 style={{ marginBottom: '8px' }}>{t.trends}</h1>
             <p className="secondary-text" style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Анализ прогресса за все время' : 'Progress analysis over time'}</p>

             <div className="premium-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Heatmap активности' : 'Activity heatmap'}</h3>
                    <p className="secondary-text">{lang === 'ru' ? 'GitHub-style сетка по дням с цветом нагрузки.' : 'GitHub-style day grid colored by training load.'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="secondary-text" style={{ fontSize: '0.78rem' }}>{lang === 'ru' ? 'меньше' : 'less'}</span>
                    {['rgba(255,255,255,0.05)', 'rgba(52,199,89,0.25)', 'rgba(52,199,89,0.45)', 'rgba(0,122,255,0.55)', 'rgba(255,45,85,0.7)'].map((color) => (
                      <span key={color} style={{ width: '12px', height: '12px', borderRadius: '4px', background: color }} />
                    ))}
                    <span className="secondary-text" style={{ fontSize: '0.78rem' }}>{lang === 'ru' ? 'больше' : 'more'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '6px' }}>
                  {activityHeatmap.map((week, weekIndex) => (
                    <div key={`week-${weekIndex}`} style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gap: '6px' }}>
                      {week.map((day) => {
                        const bg = day.level === 4
                          ? 'rgba(255,45,85,0.7)'
                          : day.level === 3
                            ? 'rgba(0,122,255,0.55)'
                            : day.level === 2
                              ? 'rgba(52,199,89,0.45)'
                              : day.level === 1
                                ? 'rgba(52,199,89,0.25)'
                                : 'rgba(255,255,255,0.05)';
                        const label = day.entries.length > 0
                          ? `${day.date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}: ${day.entries.length} • load ${Math.round(day.load)}`
                          : `${day.date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}: 0`;
                        return <div key={day.key} title={label} style={{ width: '14px', height: '14px', borderRadius: '4px', background: bg, border: '1px solid rgba(255,255,255,0.05)' }} />;
                      })}
                    </div>
                  ))}
                </div>
             </div>

             {/* Distance Chart */}
             <div className="premium-card" style={{ height: '360px' }}>
                <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                   <MapPin size={18} className="accent-text" /> {t.distance} (km)
                </h3>
                <div style={{ width: '100%', height: '260px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={history.map((w) => ({ 
                        name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                        distance: w.distance 
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                      <Tooltip 
                        cursor={{fill: 'rgba(255,255,255,0.03)'}}
                        contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                        itemStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="distance" fill="#007aff" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </div>

             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Heart Rate Trend */}
                <div className="premium-card" style={{ height: '360px' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Heart size={18} style={{ color: '#ff9500' }} /> {lang === 'ru' ? 'Ср. Пульс (bpm)' : 'Avg HR (bpm)'}
                    </h3>
                    <div style={{ width: '100%', height: '260px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history.map((w) => ({ 
                                name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                                hr: w.avgHeartRate 
                            }))}>
                                <defs>
                                    <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff9500" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#ff9500" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} domain={['dataMin - 10', 'dataMax + 10']} />
                                <Tooltip 
                                    contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="monotone" dataKey="hr" stroke="#ff9500" strokeWidth={3} fillOpacity={1} fill="url(#colorHr)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pace Trend */}
                <div className="premium-card" style={{ height: '360px' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={18} style={{ color: '#ff2d55' }} /> {t.pace} (min/km)
                    </h3>
                    <div style={{ width: '100%', height: '260px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history.map((w) => {
                                const p = w.pace.split('′');
                                const min = parseInt(p[0]) || 0;
                                const sec = parseInt(p[1]) || 0;
                                return {
                                    name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                                    pace: parseFloat((min + sec/60).toFixed(2)),
                                    label: w.pace
                                };
                            })}>
                                <defs>
                                    <linearGradient id="colorPace" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff2d55" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#ff2d55" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} domain={['dataMin - 1', 'dataMax + 1']} />
                                <Tooltip 
                                    contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(v, n, p) => [p.payload.label, t.pace]}
                                />
                                <Area type="monotone" dataKey="pace" stroke="#ff2d55" strokeWidth={3} fillOpacity={1} fill="url(#colorPace)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>
             
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Общая дистанция' : 'Total Distance'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{history.reduce((a, b) => a + b.distance, 0).toFixed(1)} km</h3>
                </div>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Всего калорий' : 'Total Calories'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{history.reduce((a, b) => a + b.calories, 0).toLocaleString()} kcal</h3>
                </div>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Средний пульс' : 'Avg Heart Rate'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{Math.round(history.reduce((a, b) => a + b.avgHeartRate, 0) / (history.length || 1))} bpm</h3>
                </div>
             </div>
          </div>
        )}

        {activeTab === 'goals' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.goals}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Цели месяца и ключевые прогресс-бары по объёму, частоте, пульсу и темпу.'
                  : 'Monthly goals and key progress bars for volume, frequency, heart rate, and pace.'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {[
                {
                  title: lang === 'ru' ? '50 км за месяц' : '50 km this month',
                  current: `${monthDistance.toFixed(1)} / ${monthlyDistanceGoal} km`,
                  progress: monthlyDistanceProgress,
                  color: '#007aff',
                },
                {
                  title: lang === 'ru' ? '10 тренировок за месяц' : '10 workouts this month',
                  current: `${currentMonthWorkoutsCount} / ${monthlyWorkoutGoal}`,
                  progress: monthlyWorkoutProgress,
                  color: '#34c759',
                },
                {
                  title: lang === 'ru' ? 'Снизить средний пульс до 130' : 'Lower average HR to 130',
                  current: monthAvgHr ? `${monthAvgHr} bpm / ${avgHrGoal}` : '—',
                  progress: avgHrProgress,
                  color: '#ff9500',
                },
                {
                  title: lang === 'ru' ? 'Лучший темп быстрее 8:30' : 'Best pace faster than 8:30',
                  current: bestWorkoutAllTime ? `${bestWorkoutAllTime.pace}/km` : '—',
                  progress: paceGoalProgress,
                  color: '#ff2d55',
                },
              ].map((goal) => (
                <div key={goal.title} className="premium-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '1.05rem' }}>{goal.title}</h3>
                    <span style={{ color: goal.color, fontWeight: 800 }}>{goal.progress}%</span>
                  </div>
                  <p className="secondary-text" style={{ marginBottom: '14px' }}>{goal.current}</p>
                  <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '12px' }}>
                    <div style={{ width: `${goal.progress}%`, height: '100%', background: goal.color, borderRadius: '999px' }} />
                  </div>
                  <p style={{ fontSize: '0.84rem', color: '#d1d7e0' }}>
                    {goal.progress >= 100
                      ? (lang === 'ru' ? 'Цель выполнена.' : 'Goal completed.')
                      : (lang === 'ru' ? 'Есть прогресс, можно добивать дальше.' : 'Good progress, keep pushing.')}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <h2 style={{ marginBottom: '14px' }}>{lang === 'ru' ? 'Цели нового уровня' : 'Advanced goals'}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {advancedGoals.map((goal) => (
                  <div key={goal.title} className="premium-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '1.05rem' }}>{goal.title}</h3>
                      <span style={{ color: goal.color, fontWeight: 800 }}>{goal.progress}%</span>
                    </div>
                    <p className="secondary-text" style={{ marginBottom: '14px' }}>{goal.current}</p>
                    <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '12px' }}>
                      <div style={{ width: `${goal.progress}%`, height: '100%', background: goal.color, borderRadius: '999px' }} />
                    </div>
                    <p style={{ fontSize: '0.84rem', color: '#d1d7e0' }}>{goal.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Текущий лучший результат' : 'Current best result'}</p>
                <h3 style={{ marginTop: '8px' }}>{bestWorkoutAllTime ? `${bestWorkoutAllTime.distance.toFixed(2)} km @ ${bestWorkoutAllTime.pace}/km` : '—'}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Тренировок в месяце' : 'Workouts this month'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentMonthWorkoutsCount}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Средний темп лучшей недели' : 'Best week pace trend'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.bestPaceWorkout ? `${currentWeekSummary.bestPaceWorkout.pace}/km` : '—'}</h3>
              </div>
             </div>
          </div>
        )}

        {activeTab === 'health-flags' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.healthFlags}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Экран сигналов, которые стоит проверить: перегруз, пульс, резкие просадки и тяжёлые серии.'
                  : 'Signals worth reviewing: overload, heart rate drift, sharp drops, and hard workout streaks.'}
              </p>
            </div>

            {healthFlags.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {healthFlags.map((flag) => (
                  <div key={flag.title} className="premium-card" style={{ borderColor: `${flag.color}33`, background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ color: flag.color }}>{flag.title}</h3>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.05em', color: flag.color }}>
                        {flag.severity === 'high'
                          ? (lang === 'ru' ? 'HIGH' : 'HIGH')
                          : (lang === 'ru' ? 'MEDIUM' : 'MEDIUM')}
                      </span>
                    </div>
                    <p style={{ color: '#ced6e0', lineHeight: 1.6 }}>{flag.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="premium-card" style={{ padding: '32px', textAlign: 'center' }}>
                <ShieldAlert size={38} style={{ marginBottom: '14px', color: '#34c759' }} />
                <h3 style={{ marginBottom: '8px', color: '#34c759' }}>
                  {lang === 'ru' ? 'Явных красных флагов не найдено' : 'No major red flags detected'}
                </h3>
                <p className="secondary-text">
                  {lang === 'ru'
                    ? 'Текущие данные не показывают резких провалов или перегруза по простым правилам контроля.'
                    : 'Current data does not show sharp drop-offs or overload under the basic monitoring rules.'}
                </p>
              </div>
            )}

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px' }}>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Последняя тренировка' : 'Latest workout'}</p>
                <h3 style={{ marginTop: '8px' }}>{history[0] ? `${history[0].distance.toFixed(1)} km · HR ${history[0].avgHeartRate}` : '—'}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Недельная нагрузка' : 'Weekly load'}</p>
                <h3 style={{ marginTop: '8px', color: weeklyLoadStatus.color }}>{weeklyLoadStatus.label}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Восстановление' : 'Recovery'}</p>
                <h3 style={{ marginTop: '8px', color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <h1 style={{ marginBottom: '8px' }}>{t.report}</h1>
                <p className="secondary-text">
                  {lang === 'ru'
                    ? 'Coach brief: краткий отчёт по форме, рискам, успехам и следующему шагу.'
                    : 'Coach brief: concise report on fitness, risks, wins, and the next step.'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleExportReportPdf}
                  disabled={isReportSaving}
                  style={{ background: 'rgba(88,86,214,0.14)', color: '#9f9cff', border: '1px solid rgba(159,156,255,0.28)', padding: '12px 18px', borderRadius: '12px', cursor: isReportSaving ? 'wait' : 'pointer', fontWeight: 700 }}
                >
                  {isReportSaving
                    ? (lang === 'ru' ? 'Сохраняю...' : 'Saving...')
                    : 'Export PDF'}
                </button>
                <button
                  onClick={handleSaveReportCard}
                  disabled={isReportSaving}
                  style={{ background: 'rgba(0,122,255,0.12)', color: '#57a6ff', border: '1px solid rgba(87,166,255,0.25)', padding: '12px 18px', borderRadius: '12px', cursor: isReportSaving ? 'wait' : 'pointer', fontWeight: 700 }}
                >
                  {isReportSaving
                    ? (lang === 'ru' ? 'Сохраняю...' : 'Saving...')
                    : (lang === 'ru' ? 'Экспорт PNG' : 'Export PNG')}
                </button>
              </div>
            </div>

            <div
              ref={reportCardRef}
              className="premium-card"
              style={{
                padding: '36px',
                background: 'radial-gradient(circle at top left, rgba(0,122,255,0.22), transparent 32%), radial-gradient(circle at bottom right, rgba(52,199,89,0.18), transparent 28%), linear-gradient(160deg, #05070b 0%, #0b1220 55%, #101820 100%)',
                borderColor: 'rgba(255,255,255,0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '28px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div>
                  <p style={{ color: '#8aa0b7', fontSize: '0.85rem', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>RunForm Coach Brief</p>
                  <h1 style={{ fontSize: '2.6rem', marginBottom: '8px' }}>{fitnessIndex.label}</h1>
                  <p style={{ color: '#c7d2df', maxWidth: '640px', lineHeight: 1.6 }}>
                    {lang === 'ru'
                      ? 'Короткий coach brief объединяет wins, risks, smart labels и следующий рекомендуемый шаг.'
                      : 'This coach brief combines wins, risks, smart labels, and the next recommended step.'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: fitnessIndex.color }}>{fitnessIndex.value}</div>
                  <p className="secondary-text">Fitness Score</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Недельный объём' : 'Weekly volume'}</p>
                  <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.distance.toFixed(1)} km</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Нагрузка' : 'Load'}</p>
                  <h3 style={{ marginTop: '8px', color: weeklyLoadStatus.color }}>{weeklyLoadStatus.label}</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Восстановление' : 'Recovery'}</p>
                  <h3 style={{ marginTop: '8px', color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Красные флаги' : 'Health flags'}</p>
                  <h3 style={{ marginTop: '8px' }}>{healthFlags.length}</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px' }}>
                <div style={{ padding: '22px', borderRadius: '22px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ color: '#8aa0b7', fontSize: '0.8rem', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {lang === 'ru' ? 'Вывод' : 'Summary'}
                  </p>
                  <p style={{ color: '#e7edf5', lineHeight: 1.7 }}>
                    {lang === 'ru'
                      ? `Форма оценивается как "${fitnessIndex.label}". Недельная нагрузка: "${weeklyLoadStatus.label}", восстановление: "${weeklyRecoveryStatus.label}". ${healthFlags.length > 0 ? `Есть ${healthFlags.length} сигнала, на которые стоит обратить внимание.` : 'Явных красных флагов сейчас не видно.'}`
                      : `Current shape is rated "${fitnessIndex.label}". Weekly load is "${weeklyLoadStatus.label}", recovery is "${weeklyRecoveryStatus.label}". ${healthFlags.length > 0 ? `There are ${healthFlags.length} signals worth attention.` : 'No clear red flags are visible right now.'}`}
                  </p>
                  {workout && (
                    <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Последняя выбранная тренировка' : 'Latest selected workout'}</p>
                      <h3 style={{ marginBottom: '6px' }}>{workout.name}</h3>
                      <p style={{ color: '#d0d8e2' }}>
                        {workout.distance.toFixed(2)} km · {formatTime(workout.duration)} · HR {workout.avgHeartRate} bpm · {workout.pace}/km
                      </p>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                        {getSmartWorkoutLabels(workout).map((tag) => (
                          <span key={tag.label} style={{ padding: '5px 9px', borderRadius: '999px', background: tag.bg, color: tag.color, fontSize: '0.72rem', fontWeight: 700 }}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {[
                    { label: lang === 'ru' ? '50 км / месяц' : '50 km / month', progress: monthlyDistanceProgress, color: '#007aff' },
                    { label: lang === 'ru' ? '10 тренировок / месяц' : '10 workouts / month', progress: monthlyWorkoutProgress, color: '#34c759' },
                    { label: lang === 'ru' ? 'Средний HR' : 'Average HR', progress: avgHrProgress, color: '#ff9500' },
                    { label: lang === 'ru' ? 'Лучший темп' : 'Best pace', progress: paceGoalProgress, color: '#ff2d55' },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span>{item.label}</span>
                        <span style={{ color: item.color, fontWeight: 800 }}>{item.progress}%</span>
                      </div>
                      <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ width: `${item.progress}%`, height: '100%', background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(52,199,89,0.05)', border: '1px solid rgba(52,199,89,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Key Wins' : 'Key Wins'}</p>
                  {coachBrief.wins.length > 0 ? coachBrief.wins.map((win) => (
                    <p key={win} style={{ lineHeight: 1.6, marginBottom: '8px' }}>{win}</p>
                  )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Пока без ярко выраженных выигрышей недели.' : 'No standout wins this week yet.'}</p>}
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,149,0,0.05)', border: '1px solid rgba(255,149,0,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Risks' : 'Risks'}</p>
                  {coachBrief.risks.length > 0 ? coachBrief.risks.map((risk) => (
                    <p key={risk} style={{ lineHeight: 1.6, marginBottom: '8px' }}>{risk}</p>
                  )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Критичных рисков сейчас не видно.' : 'No critical risks stand out right now.'}</p>}
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(0,122,255,0.05)', border: '1px solid rgba(0,122,255,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Next Recommendation' : 'Next Recommendation'}</p>
                  <p style={{ lineHeight: 1.6 }}>{coachBrief.nextRecommendation}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai-coach' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.aiCoach}</h1>
              <p className="secondary-text">
                {lang === 'ru' ? 'AI-слой поверх новых метрик из БД: интенсивность, MET-load, зоны, погода, восстановление и прогноз.' : 'AI layer on top of the new DB metrics: intensity, MET load, zones, weather, recovery, and forecasting.'}
              </p>
            </div>

            {!workout ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                <p style={{ marginBottom: '16px' }}>
                  {lang === 'ru' ? 'Сначала импортируйте тренировку, чтобы получить рекомендации.' : 'Import a workout first to get recommendations.'}
                </p>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  style={{ background: '#5856d6', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {lang === 'ru' ? 'Перейти на дашборд' : 'Go to dashboard'}
                </button>
              </div>
            ) : (
              <>
                <div className="premium-card" style={{ background: 'linear-gradient(135deg, rgba(88, 86, 214, 0.1) 0%, rgba(0, 122, 255, 0.05) 100%)', border: '1px solid rgba(88, 86, 214, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiResponse ? '16px' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ background: '#5856d6', padding: '8px', borderRadius: '10px', color: '#fff' }}>
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.1rem' }}>{t.aiCoach} (Qwen 2.5)</h3>
                        {!aiResponse && <p className="secondary-text" style={{ fontSize: '0.85rem' }}>{lang === 'ru' ? 'Глубокий разбор поверх локально рассчитанного контекста' : 'Deep review on top of locally computed context'}</p>}
                      </div>
                    </div>
                    <button
                      disabled={isAiLoading}
                      onClick={fetchAIAdvice}
                      style={{ background: '#5856d6', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      {isAiLoading ? <Loader2 size={18} className="animate-spin" /> : t.getAdvice}
                    </button>
                  </div>
                  {aiResponse ? (
                    <div className="animate-fade-in" style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)', lineHeight: '1.6', whiteSpace: 'pre-line' }}>
                      {aiResponse}
                    </div>
                  ) : (
                    <div style={{ marginTop: '20px', padding: '20px', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.12)', color: '#a0a0a0' }}>
                      {lang === 'ru'
                        ? 'Нажмите кнопку выше, чтобы получить разбор, который учитывает интенсивность, MET-load, зоны, погоду и восстановление.'
                        : 'Use the button above to get a review that accounts for intensity, MET load, zones, weather, and recovery.'}
                    </div>
                  )}
                </div>

                <AiCoachDashboard
                  lang={lang}
                  workoutAiReview={workoutAiReview}
                  weeklyCoach={weeklyCoach}
                  nextResultPrediction={nextResultPrediction}
                  explainedFlags={explainedFlags}
                  metricExplainers={metricExplainers}
                  selectedMetricKey={selectedMetricKey}
                  onMetricSelect={setSelectedMetricKey}
                />
              </>
            )}
          </div>
        )}

        {activeTab === 'next-workout' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.nextWorkout}</h1>
              <p className="secondary-text">
                {lang === 'ru' ? 'Отдельная страница генерации плана на основе последних тренировок.' : 'Dedicated page for generating a plan from recent workouts.'}
              </p>
            </div>

            {history.length === 0 ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                <p style={{ marginBottom: '16px' }}>
                  {lang === 'ru' ? 'Нужна хотя бы одна тренировка в истории, чтобы построить план.' : 'At least one workout in history is required to build a plan.'}
                </p>
                <button
                  onClick={() => setActiveTab('history')}
                  style={{ background: '#34c759', color: '#000', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {lang === 'ru' ? 'Открыть историю' : 'Open history'}
                </button>
              </div>
            ) : (
              <div className="premium-card" style={{ border: '1px solid rgba(52, 199, 89, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ background: '#34c759', padding: '8px', borderRadius: '10px', color: '#fff' }}>
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem' }}>{t.nextWorkout}</h3>
                    <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                      {lang === 'ru' ? 'Выберите цель для персонального плана' : 'Choose a goal for a personalized plan'}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                  {[
                    { key: 'fat_loss' as const, emoji: '🔥', title: lang === 'ru' ? 'Похудеть' : 'Fat Loss', subtitle: lang === 'ru' ? 'Z1–Z2, длинно и медленно' : 'Z1–Z2, long & slow', color: '#ff9500' },
                    { key: 'endurance' as const, emoji: '💪', title: lang === 'ru' ? 'Выносливость' : 'Endurance', subtitle: lang === 'ru' ? 'Z2–Z3, аэробная база' : 'Z2–Z3, aerobic base', color: '#007aff' },
                    { key: 'speed' as const, emoji: '⚡', title: lang === 'ru' ? 'Скорость' : 'Speed', subtitle: lang === 'ru' ? 'Z4–Z5, интервалы' : 'Z4–Z5, intervals', color: '#ff2d55' },
                  ].map(goal => {
                    const isActive = trainingGoal === goal.key;
                    return (
                      <button
                        key={goal.key}
                        onClick={() => { setTrainingGoal(goal.key); setPlanPhases([]); setAiPlan(''); }}
                        style={{
                          padding: '16px',
                          borderRadius: '14px',
                          border: isActive ? `2px solid ${goal.color}` : '1px solid rgba(255,255,255,0.08)',
                          background: isActive ? `${goal.color}15` : 'rgba(255,255,255,0.03)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>{goal.emoji}</div>
                        <p style={{ fontWeight: 700, fontSize: '0.95rem', color: isActive ? goal.color : '#fff', marginBottom: '4px' }}>{goal.title}</p>
                        <p style={{ fontSize: '0.75rem', color: '#a0a0a0', lineHeight: 1.3 }}>{goal.subtitle}</p>
                      </button>
                    );
                  })}
                </div>

                <button
                  disabled={isPlanLoading || !trainingGoal}
                  onClick={fetchAIPlan}
                  style={{
                    width: '100%',
                    background: trainingGoal ? '#34c759' : 'rgba(255,255,255,0.05)',
                    color: trainingGoal ? '#000' : '#a0a0a0',
                    border: 'none',
                    padding: '14px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: trainingGoal ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isPlanLoading ? <Loader2 size={18} className="animate-spin" /> : (trainingGoal ? t.generatePlan : (lang === 'ru' ? '← Выберите цель выше' : '← Choose a goal above'))}
                </button>

                <NextWorkoutInsights
                  lang={lang}
                  weeklyLoadLabel={weeklyLoadStatus.label}
                  recoveryLabel={weeklyRecoveryStatus.label}
                  healthFlagsCount={healthFlags.length}
                  nextResultPrediction={nextResultPrediction}
                />

                {planPhases.length > 0 && (
                  <div className="animate-fade-in" style={{ marginTop: '20px' }}>
                    <p style={{ fontWeight: 600, color: '#34c759', marginBottom: '16px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {t.planAdvice}
                    </p>
                    {planPhases.map((phase, idx) => {
                      const zoneColors: Record<string, string> = { Z1: '#34c759', Z2: '#007aff', Z3: '#ff9500', Z4: '#ff2d55', Z5: '#bf5af2' };
                      const phaseIcons: Record<string, string> = { Warmup: '🔥', 'Easy Run': '🏃', Tempo: '⚡', Interval: '🔁', Recovery: '💚', Cooldown: '❄️' };
                      const color = zoneColors[phase.zone] || '#a0a0a0';
                      const icon = phaseIcons[phase.phase] || '📍';
                      return (
                        <div key={idx} style={{ display: 'flex', gap: '16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '28px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>
                              {icon}
                            </div>
                            {idx < planPhases.length - 1 && <div style={{ width: '2px', flex: 1, background: `${color}40`, minHeight: '16px', margin: '4px 0' }} />}
                          </div>
                          <div style={{ flex: 1, background: `${color}08`, border: `1px solid ${color}25`, borderRadius: '14px', padding: '14px 16px', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontWeight: 700 }}>{phase.phase}</span>
                                <span style={{ background: color, color: '#fff', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px' }}>{phase.zone}</span>
                              </div>
                              <span style={{ fontWeight: 700, color, fontSize: '1.05rem' }}>{phase.duration}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>ПУЛЬС</p><p style={{ fontSize: '0.88rem', fontWeight: 600, color }}>{phase.hr_range}</p></div>
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>ТЕМП</p><p style={{ fontSize: '0.88rem', fontWeight: 600 }}>{phase.pace}</p></div>
                              <div style={{ flex: 1 }}><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>СОВЕТ</p><p style={{ fontSize: '0.83rem', opacity: 0.75 }}>{phase.notes}</p></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {aiPlan && planPhases.length === 0 && (
                  <div className="animate-fade-in" style={{ padding: '16px', background: 'rgba(52, 199, 89, 0.05)', borderRadius: '12px', border: '1px solid rgba(52, 199, 89, 0.1)', whiteSpace: 'pre-line', marginTop: '16px' }}>
                    <p style={{ fontWeight: 600, color: '#34c759', marginBottom: '8px' }}>{t.planAdvice}:</p>
                    {aiPlan}
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-view animate-fade-in">
             <h1 style={{ marginBottom: '32px' }}>{t.settings}</h1>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Профиль' : 'Profile'}</h3>
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder={lang === 'ru' ? 'Введите имя' : 'Enter your name'}
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.04)',
                        color: '#f5f7fb',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                    <p className="secondary-text" style={{ marginTop: '10px' }}>
                      {lang === 'ru' ? 'Имя сохраняется локально на этом устройстве.' : 'The name is stored locally on this device.'}
                    </p>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Приложение' : 'App'}</h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{lang === 'ru' ? 'Версия' : 'Version'}</span>
                        <span className="secondary-text">1.0.0 Alpha</span>
                    </div>
                </div>
                <button 
                    onClick={async () => { if(confirm(lang === 'ru' ? 'Вы уверены? Это сотрет все данные.' : 'Are you sure? This will delete all data.')) { await clearAllWorkouts(); refreshData(); setActiveTab('dashboard'); } }}
                    style={{ background: 'rgba(255, 45, 85, 0.1)', color: '#ff2d55', border: '1px solid rgba(255, 45, 85, 0.2)', padding: '16px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                    {lang === 'ru' ? 'Сбросить базу данных' : 'Reset Database'}
                </button>
             </div>
          </div>
        )}
      </main>
      
      <ShareCardModal
        lang={lang}
        workout={workout}
        show={showShareCard}
        shareCardRef={shareCardRef}
        isShareSaving={isShareSaving}
        onClose={() => setShowShareCard(false)}
        onSave={handleSaveShareCard}
        formatTime={formatTime}
      />
    </div>
  );
}
