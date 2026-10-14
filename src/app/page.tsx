"use client";

import NextImage from 'next/image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Loader2,
  Footprints,
  Tag,
  Plus,
  X,
  Trophy,
  HeartPulse,
  MapPinned,
  Flag,
  Trash2,
  Pencil,
  Weight,
  MessageCircle,
  Camera,
  Mic,
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
  Area,
} from 'recharts';
import { WorkoutData } from '@/lib/parser';
import { getEfficiencyMetrics, getIntensityScore, MetricExplainerKey, parsePaceToMinutes } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { buildHomeMetrics, formatTime, getDateKey } from '@/lib/home-metrics';
import { computeWorkoutSplits, formatSplitPace } from '@/lib/splits';
import { formatVersionLabel } from '@/lib/app-version';
import { formatPersonalBest, getTierDistance, PersonalBestType } from '@/lib/personal-best';
import {
  buildYearHeatmap,
  computeAnnualGoal,
  computeLoadSeries,
  computeReadiness,
  computeStreaks,
} from '@/lib/training-load';
// Type-only: keeps the Node-side backup module (better-sqlite3) out of the
// client bundle while sharing the exact shapes with the server actions.
import type { BackupEntry, DatabaseInfo } from '@/lib/backup';
// Route segments: server actions are the same static imports the data hooks
// use; the math helpers are pure and safe for the client bundle.
import { createSegment, deleteSegment, getSegmentEfforts, getSegmentsForRoute } from '@/lib/actions';
import type { SegmentEffortEntry, SegmentSummary } from '@/lib/actions';
import { formatEffortPace, formatEffortTime, haversineKm } from '@/lib/segments';
import { useWorkoutData } from '@/hooks/useWorkoutData';
import { useRunFormData } from '@/hooks/useRunFormData';
import { useAiCoach } from '@/hooks/useAiCoach';
import { useAiExtras } from '@/hooks/useAiExtras';
import { useAiChat } from '@/hooks/useAiChat';
import { useWorkoutExports } from '@/hooks/useWorkoutExports';
import { VersusSummaryCard } from '@/components/ai/VersusSummaryCard';
import { AiCoachDashboard } from '@/components/ai/AiCoachDashboard';
import { AiTextCard } from '@/components/ai/AiTextCard';
import { ChatPanel } from '@/components/ai/ChatPanel';
import { NextWorkoutInsights } from '@/components/ai/NextWorkoutInsights';
import { RouteTrackMap } from '@/components/RouteTrackMap';
import { ShareCardModal } from '@/components/share/ShareCardModal';
import { ComparisonRow, DetailRow, MetricLabel, SidebarItem } from '@/components/ui/AppPrimitives';

// The Web Speech API ships without TypeScript DOM types, so the minimal
// surface used for the voice diary is declared here.
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function createSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function Home() {
  const {
    workout,
    setWorkout,
    history,
    shoes,
    loadShoes,
    isClient,
    profileName,
    setProfileName,
    currentMonth,
    setCurrentMonth,
    selectedDateKey,
    setSelectedDateKey,
    preferences,
    setPreferences,
    assignShoe,
    updateTags,
    updateNote,
    importWorkoutFile,
    importWorkoutFromScreenshot,
    resetWorkouts,
  } = useWorkoutData();

  const {
    personalBests,
    bodyMetrics,
    routes,
    rebuildPersonalBests,
    persistBodyMetric,
    setRouteName,
  } = useRunFormData();

  const [newShoe, setNewShoe] = useState({ name: '', brand: '', model: '', maxDistance: 800 });
  const [metricDraft, setMetricDraft] = useState({
    date: new Date().toISOString().slice(0, 10),
    weight: '',
    muscleMass: '',
    fatPercentage: '',
    sorenessLevel: '',
    notes: '',
  });
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeNameDraft, setRouteNameDraft] = useState('');
  // Route segments panel (routes tab): one route's segments are loaded on
  // demand, efforts are cached per expanded segment.
  const [segmentsRouteId, setSegmentsRouteId] = useState<string | null>(null);
  const [routeSegments, setRouteSegments] = useState<SegmentSummary[]>([]);
  const [segmentEffortsBySegment, setSegmentEffortsBySegment] = useState<Record<string, SegmentEffortEntry[]>>({});
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);
  const [segmentsBusy, setSegmentsBusy] = useState(false);
  const [segmentFormOpen, setSegmentFormOpen] = useState(false);
  const [segmentNameDraft, setSegmentNameDraft] = useState('');
  const [segmentStartIdx, setSegmentStartIdx] = useState<number | null>(null);
  const [segmentEndIdx, setSegmentEndIdx] = useState<number | null>(null);
  const [segmentNotice, setSegmentNotice] = useState<string | null>(null);
  // Post-run notes (history tab): inline editor with optional dictation.
  const [noteEditorUuid, setNoteEditorUuid] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteDictating, setNoteDictating] = useState(false);
  const noteRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [backupList, setBackupList] = useState<BackupEntry[]>([]);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window === 'undefined') {
      return 'ru';
    }
    return window.localStorage.getItem('runform.lang') === 'en' ? 'en' : 'ru';
  });
  // Ollama model choices are stored per device and attached to every AI
  // request by src/lib/ollama.ts; empty string means "use the server default".
  const [aiModel, setAiModel] = useState('');
  const [aiVisionModel, setAiVisionModel] = useState('');
  const [installedModels, setInstalledModels] = useState<Array<{ name: string; size: number }>>([]);
  const [modelsUnavailable, setModelsUnavailable] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWorkouts, setSelectedWorkouts] = useState<WorkoutData[]>([]);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricExplainerKey>('metLoad');
  const [diaryText, setDiaryText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [diaryNotice, setDiaryNotice] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef('');

  const {
    showShareCard,
    setShowShareCard,
    isShareSaving,
    isReportSaving,
    shareCardRef,
    dashboardExportRef,
    reportCardRef,
    handleExport,
    handleSaveShareCard,
    handleSaveReportCard,
    handleExportReportPdf,
  } = useWorkoutExports(workout, lang);

  const {
    t,
    hrZonesData,
    prs,
    workoutsByDay,
    monthDays,
    selectedDayWorkouts,
    monthDistance,
    monthCalories,
    monthActiveDays,
    monthAvgHr,
    longestStreak,
    calendarWeekdays,
    currentWeekStart,
    currentWeekEnd,
    currentWeekSummary,
    previousWeekSummary,
    weeklyDistanceChange,
    currentWeekMetLoad,
    previousWeekMetLoad,
    metLoadStatus,
    weeklyLoadStatus,
    weeklyRecoveryStatus,
    currentMonthWorkoutsCount,
    monthlyDistanceGoal,
    monthlyWorkoutGoal,
    avgHrGoal,
    monthlyDistanceProgress,
    monthlyWorkoutProgress,
    avgHrProgress,
    paceGoalProgress,
    bestWorkoutAllTime,
    currentBestPaceMinutes,
    recentAvgDistance,
    recentAvgHr,
    recentPaceSpread,
    fitnessIndex,
    healthFlags,
    currentIntensityScore,
    avgIntensityScore,
    peakIntensityWorkout,
    currentEfficiency,
    bestEfficiencyWorkout,
    currentWarmup,
    currentZoneProfile,
    weatherImpact,
    indoorWorkouts,
    outdoorWorkouts,
    dominantLocation,
    uniqueSources,
    uniqueDevices,
    workoutAiReview,
    weeklyCoach,
    explainedFlags,
    nextResultPrediction,
    metricExplainers,
    versusSummary,
    getDayLoad,
    getWorkoutType,
    getSmartWorkoutLabels,
    activityHeatmap,
    advancedGoals,
    coachBrief,
    selectedDayGap,
  } = buildHomeMetrics({
    workout,
    history,
    lang,
    currentMonth,
    selectedDateKey,
    selectedWorkouts,
    preferences,
  });

  // Тренировочная форма (вкладка «Индекс формы»): CTL/ATL/TSB, стрики, heatmap
  // года, цель и готовность. Всё считается чистыми функциями поверх того же
  // history, что уже есть на клиенте, — мгновенно и без запросов.
  // Если тренировки заканчиваются старше 90 дней назад, окно графика
  // расширяется, чтобы показать реальную форму, а не пустую полосу.
  const trainingLoadSeriesDays = (() => {
    const last = history.length > 0 ? new Date(history[0].startDate).getTime() : 0;
    if (!last) return 90;
    const daysSince = (Date.now() - last) / 86400000;
    return daysSince > 90 ? Math.min(365, Math.round(daysSince) + 30) : 90;
  })();
  const trainingLoadSeries = useMemo(
    () => computeLoadSeries(history, { days: trainingLoadSeriesDays, lthr: preferences.lthr ?? null }),
    [history, preferences.lthr, trainingLoadSeriesDays],
  );
  const streakStats = useMemo(() => computeStreaks(history), [history]);
  const yearHeatmap = useMemo(
    () => buildYearHeatmap(history, preferences.lthr ?? null, new Date().getFullYear()),
    [history, preferences.lthr],
  );
  const annualGoalProgress = useMemo(
    () => computeAnnualGoal(history, preferences.annualGoalKm ?? 0),
    [history, preferences.annualGoalKm],
  );
  const readinessStatus = useMemo(() => computeReadiness(history), [history]);

  const latestLoadPoint = trainingLoadSeries[trainingLoadSeries.length - 1];
  const monthAgoLoadPoint = trainingLoadSeries[trainingLoadSeries.length - 29] ?? trainingLoadSeries[0];
  const ctlTrend = latestLoadPoint && monthAgoLoadPoint ? latestLoadPoint.ctl - monthAgoLoadPoint.ctl : 0;

  const readinessMeta = readinessStatus
    ? readinessStatus.status === 'ready'
      ? { color: '#34c759', label: lang === 'ru' ? 'Готов к нагрузке' : 'Ready to train' }
      : readinessStatus.status === 'normal'
        ? { color: '#ff9500', label: lang === 'ru' ? 'Норма' : 'Normal' }
        : { color: '#ff3b30', label: lang === 'ru' ? 'Восстановление' : 'Recovering' }
    : null;

  const tsbHint = !latestLoadPoint
    ? ''
    : latestLoadPoint.tsb > 5
      ? lang === 'ru'
        ? 'Ноги свежие — хорошее окно для старта или тяжёлой работы.'
        : 'Legs are fresh — a good window for racing or hard work.'
      : latestLoadPoint.tsb < -30
        ? lang === 'ru'
          ? 'Высокая усталость — держите лёгкий объём и высыпайтесь.'
          : 'High fatigue — keep easy volume and sleep more.'
        : lang === 'ru'
          ? 'Баланс нагрузки и восстановления в рабочем диапазоне.'
          : 'Load and recovery are in a working range.';

  const heatmapMonthLabels = (() => {
    const monthNames = lang === 'ru'
      ? ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const labels: Array<{ name: string; column: number }> = [];
    yearHeatmap.forEach((week, index) => {
      const firstOfMonth = week.find((cell) => cell.inYear && cell.dateKey.endsWith('-01'));
      if (!firstOfMonth) return;
      const name = monthNames[Number(firstOfMonth.dateKey.slice(5, 7)) - 1];
      if (!labels.some((label) => label.name === name)) {
        labels.push({ name, column: index + 1 });
      }
    });
    return labels;
  })();

  const heatmapColor = (load: number) =>
    load === 0
      ? 'rgba(255,255,255,0.05)'
      : load < 20
        ? '#0e3b20'
        : load < 45
          ? '#196e35'
          : load < 80
            ? '#2ea043'
            : '#56d364';

  // Segment creation needs a concrete track for the selected route: every run
  // on the course shares the geometry (fingerprint match), so any of them
  // provides the anchors.
  const segmentTrack = useMemo(() => {
    if (!segmentsRouteId) return [];
    const match = history.find(
      (item) => item.routeId === segmentsRouteId && (item.route?.length ?? 0) >= 2,
    );
    return match?.route ?? [];
  }, [history, segmentsRouteId]);

  // Anchor candidates every ~50 m with their cumulative distance — the two
  // dropdowns that define a segment pick from this list.
  const segmentMarkers = useMemo(() => {
    if (segmentTrack.length < 2) return [];
    const markers: Array<{ index: number; lat: number; lng: number; km: number }> = [
      { index: 0, lat: segmentTrack[0].lat, lng: segmentTrack[0].lng, km: 0 },
    ];
    let cumulative = 0;
    for (let index = 1; index < segmentTrack.length; index += 1) {
      cumulative += haversineKm(segmentTrack[index - 1], segmentTrack[index]);
      const isLast = index === segmentTrack.length - 1;
      if (cumulative - markers[markers.length - 1].km >= 0.05 || isLast) {
        markers.push({ index, lat: segmentTrack[index].lat, lng: segmentTrack[index].lng, km: cumulative });
      }
    }
    return markers;
  }, [segmentTrack]);

  const openSegmentsPanel = async (routeId: string) => {
    if (segmentsRouteId === routeId) {
      setSegmentsRouteId(null);
      return;
    }
    setSegmentsRouteId(routeId);
    setSegmentFormOpen(false);
    setSegmentStartIdx(null);
    setSegmentEndIdx(null);
    setSegmentNameDraft('');
    setSegmentNotice(null);
    setExpandedSegmentId(null);
    setSegmentsBusy(true);
    try {
      setRouteSegments(await getSegmentsForRoute(routeId));
    } finally {
      setSegmentsBusy(false);
    }
  };

  const toggleSegmentEfforts = async (segmentId: string) => {
    if (expandedSegmentId === segmentId) {
      setExpandedSegmentId(null);
      return;
    }
    setExpandedSegmentId(segmentId);
    if (!segmentEffortsBySegment[segmentId]) {
      const efforts = await getSegmentEfforts(segmentId);
      setSegmentEffortsBySegment((previous) => ({ ...previous, [segmentId]: efforts }));
    }
  };

  const handleCreateSegment = async () => {
    if (!segmentsRouteId || segmentStartIdx === null || segmentEndIdx === null) return;
    const start = segmentTrack[segmentStartIdx];
    const end = segmentTrack[segmentEndIdx];
    if (!start || !end) return;
    setSegmentsBusy(true);
    setSegmentNotice(null);
    try {
      const result = await createSegment(
        segmentsRouteId,
        segmentNameDraft.trim() || (lang === 'ru' ? 'Сегмент' : 'Segment'),
        { lat: start.lat, lng: start.lng },
        { lat: end.lat, lng: end.lng },
      );
      if (!result.success) {
        setSegmentNotice(result.error ?? (lang === 'ru' ? 'Не удалось создать сегмент' : 'Could not create the segment'));
        return;
      }
      setSegmentFormOpen(false);
      setSegmentNameDraft('');
      setSegmentStartIdx(null);
      setSegmentEndIdx(null);
      setSegmentEffortsBySegment({});
      setRouteSegments(await getSegmentsForRoute(segmentsRouteId));
    } finally {
      setSegmentsBusy(false);
    }
  };

  const handleDeleteSegment = async (segmentId: string) => {
    setSegmentsBusy(true);
    try {
      await deleteSegment(segmentId);
      setExpandedSegmentId(null);
      setSegmentEffortsBySegment((previous) => {
        const next = { ...previous };
        delete next[segmentId];
        return next;
      });
      if (segmentsRouteId) {
        setRouteSegments(await getSegmentsForRoute(segmentsRouteId));
      }
    } finally {
      setSegmentsBusy(false);
    }
  };

  // A segment runs forward along the track: both anchors must be chosen and
  // the start must come before the finish.
  const segmentCanCreate =
    segmentsBusy ||
    segmentStartIdx === null ||
    segmentEndIdx === null ||
    segmentStartIdx >= segmentEndIdx;

  // Voice dictation for post-run notes: the same Web Speech API path as the
  // training diary, but appending into the note draft of one workout.
  const toggleNoteDictation = () => {
    if (noteDictating) {
      noteRecognitionRef.current?.stop();
      setNoteDictating(false);
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setNoteDictating(false);
      return;
    }
    let finalText = '';
    recognition.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        finalText += event.results[index][0].transcript;
      }
    };
    recognition.onend = () => {
      setNoteDictating(false);
      if (finalText.trim()) {
        setNoteDraft((previous) => (previous ? `${previous} ${finalText.trim()}` : finalText.trim()));
      }
    };
    recognition.onerror = () => setNoteDictating(false);
    noteRecognitionRef.current = recognition;
    recognition.start();
    setNoteDictating(true);
  };

  const {
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
  } = useAiCoach({
    lang,
    history,
    workout,
    currentIntensityScore,
    currentWeekMetLoad,
    weeklyLoadLabel: weeklyLoadStatus.label,
    weeklyRecoveryLabel: weeklyRecoveryStatus.label,
    healthFlags,
    currentEfficiency,
    currentWarmup,
    currentZoneProfile,
    preferences,
  });

  const {
    weeklyDigest,
    isDigestLoading,
    generateWeeklyDigest,
    flagExplanations,
    isFlagsLoading,
    explainFlags,
    readiness,
    isReadinessLoading,
    assessReadiness,
    splitsAnalysis,
    isSplitsLoading,
    analyzeSplits,
    reflection,
    isReflecting,
    reflectOnNote,
  } = useAiExtras({
    lang,
    history,
    preferences,
    profileName,
    healthFlags,
    bodyMetrics,
    currentWeekSummary,
    previousWeekSummary,
    weeklyDistanceChange,
    currentWeekMetLoad,
    weeklyLoadLabel: weeklyLoadStatus.label,
    weeklyRecoveryLabel: weeklyRecoveryStatus.label,
    weekKey: getDateKey(currentWeekStart),
  });

  const {
    messages: chatMessages,
    isStreaming: isChatStreaming,
    send: sendChatMessage,
    clear: clearChat,
  } = useAiChat({
    lang,
    history,
    personalBests,
    weeklyLoadLabel: weeklyLoadStatus.label,
    weeklyRecoveryLabel: weeklyRecoveryStatus.label,
    preferences,
    profileName,
  });

  const stats = workout
    ? [
        { label: t.distance, value: `${workout.distance.toFixed(2)} km`, icon: <MapPin size={18} />, color: '#007aff' },
        { label: t.duration, value: formatTime(workout.duration), icon: <Timer size={18} />, color: '#ff2d55' },
        { label: t.avgHr, value: `${workout.avgHeartRate} bpm`, icon: <Heart size={18} />, color: '#ff9500' },
        { label: t.calories, value: `${workout.calories} kcal`, icon: <Flame size={18} />, color: '#34c759' },
      ]
    : [];

  const toggleWorkoutSelection = (item: WorkoutData) => {
    if (selectedWorkouts.find((selected) => selected.uuid === item.uuid)) {
      setSelectedWorkouts(selectedWorkouts.filter((selected) => selected.uuid !== item.uuid));
    } else if (selectedWorkouts.length < 2) {
      setSelectedWorkouts([...selectedWorkouts, item]);
    } else {
      setSelectedWorkouts([selectedWorkouts[1], item]);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await importWorkoutFile(file);
      setActiveTab('dashboard');
      if (result.duplicate) {
        window.alert(t.importDuplicate);
      }
    } catch (error) {
      console.error('Error parsing/saving file:', error);
      window.alert(t.importError);
    } finally {
      event.target.value = '';
    }
  };

  const handleScreenshotUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await importWorkoutFromScreenshot(file);
      setActiveTab('dashboard');
      window.alert(t.screenshotSaved);
    } catch (error) {
      console.error('Screenshot import failed:', error);
      window.alert(t.screenshotError);
    } finally {
      event.target.value = '';
    }
  };

  const workoutSplits = useMemo(() => (workout ? computeWorkoutSplits(workout) : []), [workout]);

  const toggleDictation = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = createSpeechRecognition();
    if (!recognition) {
      window.alert(t.dictationUnsupported);
      return;
    }

    dictationBaseRef.current = diaryText.trim();
    recognition.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText.trim()) {
        dictationBaseRef.current = `${dictationBaseRef.current} ${finalText}`.trim();
      }
      setDiaryText(`${dictationBaseRef.current} ${interimText}`.trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const saveDiaryEntry = () => {
    if (!diaryText.trim()) return;
    void persistBodyMetric({ date: new Date().toISOString().slice(0, 10), notes: diaryText.trim() }).then(() => {
      setDiaryNotice(t.diarySaved);
      setDiaryText('');
      window.setTimeout(() => setDiaryNotice(null), 4000);
    });
  };

  // The chosen language survives reloads and stays in sync with the document
  // so screen readers announce the correct locale.
  useEffect(() => {
    if (!isClient) return;
    window.localStorage.setItem('runform.lang', lang);
    document.documentElement.lang = lang;
  }, [isClient, lang]);

  // Restore the saved model picks and load the installed-model list from the
  // local Ollama daemon so Settings can show a picker instead of env vars.
  useEffect(() => {
    if (!isClient) return;
    try {
      setAiModel(window.localStorage.getItem('runform.aiModel') ?? '');
      setAiVisionModel(window.localStorage.getItem('runform.aiVisionModel') ?? '');
    } catch {
      // Storage disabled — defaults stay in effect.
    }
    let cancelled = false;
    fetch('/api/ollama')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Ollama unavailable')),
      )
      .then((data: { models?: Array<{ name: string; size: number }> }) => {
        if (cancelled) return;
        setInstalledModels(data.models ?? []);
        setModelsUnavailable(false);
      })
      .catch(() => {
        if (!cancelled) setModelsUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isClient]);

  // Панель резервных копий (Настройки): снимок текущей базы + файлы из
  // data/backups. Грузится один раз; после каждого действия список обновляется.
  const loadBackupPanel = useCallback(async () => {
    try {
      const actions = await import('@/lib/actions');
      const [info, list] = await Promise.all([
        actions.getDatabaseInfo(),
        actions.listDatabaseBackups(),
      ]);
      setDbInfo(info);
      setBackupList(list);
    } catch {
      // Панель необязательная: сбой чтения не должен ломать весь экран Настроек.
    }
  }, []);

  useEffect(() => {
    if (!isClient) return;
    void loadBackupPanel();
  }, [isClient, loadBackupPanel]);

  const showBackupNotice = useCallback((text: string) => {
    setBackupNotice(text);
    window.setTimeout(() => setBackupNotice(null), 6000);
  }, []);

  const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const handleCreateBackup = async () => {
    setBackupBusy(true);
    try {
      const { createDatabaseBackup } = await import('@/lib/actions');
      const entry = await createDatabaseBackup();
      showBackupNotice(
        lang === 'ru'
          ? `Резервная копия создана: ${entry.fileName}`
          : `Backup created: ${entry.fileName}`,
      );
      await loadBackupPanel();
    } catch (error) {
      showBackupNotice(
        lang === 'ru'
          ? `Не удалось создать копию: ${describeError(error)}`
          : `Backup failed: ${describeError(error)}`,
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleBackupFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBackupBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/backup', { method: 'POST', body });
      const data = (await response.json()) as {
        success?: boolean;
        fileName?: string;
        workouts?: number;
        error?: string;
      };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      showBackupNotice(
        lang === 'ru'
          ? `Файл загружен: ${data.fileName} (${data.workouts ?? 0} тренировок). Нажмите «Восстановить», чтобы применить.`
          : `File uploaded: ${data.fileName} (${data.workouts ?? 0} workouts). Press Restore to apply it.`,
      );
      await loadBackupPanel();
    } catch (error) {
      showBackupNotice(
        lang === 'ru'
          ? `Не удалось загрузить файл: ${describeError(error)}`
          : `Upload failed: ${describeError(error)}`,
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = async (fileName: string) => {
    const question =
      lang === 'ru'
        ? `Восстановить базу из копии «${fileName}»? Текущие данные будут заменены (сначала сохранится страховочная копия).`
        : `Restore the database from «${fileName}»? Current data will be replaced (a safety copy is saved first).`;
    if (!confirm(question)) return;

    setBackupBusy(true);
    try {
      const { restoreDatabaseBackup } = await import('@/lib/actions');
      const result = await restoreDatabaseBackup(fileName);
      if (!result.success) {
        throw new Error(result.error);
      }
      // Все экраны читают данные через одни и те же server actions, поэтому
      // перезагрузка — самый надёжный способ показать восстановленную базу.
      window.location.reload();
    } catch (error) {
      setBackupBusy(false);
      showBackupNotice(
        lang === 'ru'
          ? `Восстановление не удалось: ${describeError(error)}`
          : `Restore failed: ${describeError(error)}`,
      );
    }
  };

  const persistModelChoice = (
    key: 'runform.aiModel' | 'runform.aiVisionModel',
    value: string,
    setter: (next: string) => void,
  ) => {
    setter(value);
    try {
      if (value) {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Storage disabled — the pick applies for this session only.
    }
  };

  // Options for the model selects: whatever Ollama has installed, plus the
  // currently saved pick if it is not installed right now (so the select
  // never silently reverts to the default).
  const modelOptionsFor = (current: string): Array<{ name: string; size: number }> => {
    const options = [...installedModels];
    if (current && !options.some((item) => item.name === current)) {
      options.unshift({ name: current, size: 0 });
    }
    return options;
  };

  const modelSelectStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#f5f7fb',
    fontSize: '0.95rem',
    outline: 'none',
  };

  if (!isClient) return null;
  return (
    <div className="app-container">
      <input 
        type="file" 
        accept=".json" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
      <input
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        ref={screenshotInputRef}
        onChange={handleScreenshotUpload}
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
          <p className="secondary-text" style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '10px' }}>{formatVersionLabel()}</p>
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
          <SidebarItem icon={<MessageCircle size={20} />} label={t.chat} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <SidebarItem icon={<Zap size={20} />} label={t.nextWorkout} active={activeTab === 'next-workout'} onClick={() => setActiveTab('next-workout')} />
          <SidebarItem icon={<Trophy size={20} />} label={t.records} active={activeTab === 'records'} onClick={() => setActiveTab('records')} />
          <SidebarItem icon={<HeartPulse size={20} />} label={t.health} active={activeTab === 'health'} onClick={() => setActiveTab('health')} />
          <SidebarItem icon={<MapPinned size={20} />} label={t.routes} active={activeTab === 'routes'} onClick={() => setActiveTab('routes')} />
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SidebarItem 
            icon={<Languages size={20} />} 
            label={lang === 'ru' ? 'English' : 'Русский'} 
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} 
          />
          <SidebarItem icon={<Upload size={20} />} label={t.importJson} onClick={() => fileInputRef.current?.click()} />
          <SidebarItem icon={<Camera size={20} />} label={t.screenshotImport} onClick={() => screenshotInputRef.current?.click()} />
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
                 <h2>{t.noData}</h2>
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
                    
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' }}>
                       <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 12px' }}>
                          <Footprints size={14} className="secondary-text" style={{ marginRight: '6px' }} />
                          <select 
                            value={workout.shoeId || ''} 
                            onChange={(e) => assignShoe(workout.uuid, e.target.value || null)}
                            style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.85rem' }}
                          >
                            <option value="" style={{ color: '#000' }}>{lang === 'ru' ? 'Нет кроссовок' : 'No shoe selected'}</option>
                            {shoes.map(s => (
                               <option key={s.id} value={s.id} style={{ color: '#000' }}>{s.name}</option>
                            ))}
                          </select>
                       </div>
                       
                       <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 12px', gap: '6px' }}>
                          <Tag size={14} className="secondary-text" />
                          {(workout.tags || []).map((tag, idx) => (
                             <span key={idx} style={{ background: 'rgba(0,122,255,0.2)', color: '#007aff', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                               {tag}
                               <X size={10} style={{ cursor: 'pointer' }} onClick={() => updateTags(workout.uuid, (workout.tags || []).filter(t => t !== tag))} />
                             </span>
                          ))}
                          <input 
                            placeholder={lang === 'ru' ? '+ Добавить тег' : '+ Add tag'}
                            onKeyDown={(e) => {
                               if (e.key === 'Enter' && e.currentTarget.value) {
                                   const newTags = [...(workout.tags || []), e.currentTarget.value];
                                   updateTags(workout.uuid, newTags);
                                   e.currentTarget.value = '';
                               }
                            }}
                            style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.85rem', width: '100px' }}
                          />
                       </div>
                    </div>
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

                <section style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr', gap: '20px', minHeight: '400px' }}>
                  {/* Unified HR Distribution Card */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={18} className="accent-text" /> {lang === 'ru' ? 'Распределение пульса' : 'Heart Rate Distribution'}
                    </h3>
                    <div style={{ display: 'flex', gap: '24px', flexGrow: 1, alignItems: 'center' }}>
                      <div style={{ width: '160px', height: '160px', flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={hrZonesData}
                              innerRadius={52}
                              outerRadius={72}
                              paddingAngle={4}
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
                      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {hrZonesData.map((zone, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: zone.color }}></div>
                              <span style={{ fontSize: '0.88rem', color: '#cad3df' }}>{zone.name}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{zone.percentage}%</div>
                              <div className="secondary-text" style={{ fontSize: '0.72rem' }}>{zone.formatted}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div style={{ width: '100%', height: '140px', marginTop: '24px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hrZonesData} layout="vertical" margin={{ left: -20 }}>
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" hide />
                          <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                          />
                          <Bar dataKey="minutes" radius={[0, 4, 4, 0]} barSize={14}>
                            {hrZonesData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Running Form & Efficiency Analysis Card */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Gauge size={18} style={{ color: '#34c759' }} /> {lang === 'ru' ? 'Техника и эффективность' : 'Form & Efficiency'}
                    </h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flexGrow: 1 }}>
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Footprints size={12} /> {lang === 'ru' ? 'Длина шага' : 'Stride Length'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#007aff', fontSize: '1.6rem' }}>{currentEfficiency?.strideLength || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>cm</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Activity size={12} /> {lang === 'ru' ? 'Каденс' : 'Cadence'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#ff2d55', fontSize: '1.6rem' }}>{workout.cadence}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>spm</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Zap size={12} /> {lang === 'ru' ? 'Метров за удар' : 'Meters/Beat'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#ff9500', fontSize: '1.6rem' }}>{currentEfficiency?.metersPerBeat.toFixed(2) || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>m</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.12)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', color: '#34c759' }}>
                           {lang === 'ru' ? 'Эффективность' : 'Efficiency'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#34c759', fontSize: '1.8rem' }}>{currentEfficiency?.score || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.8rem', color: '#34c759' }}>pts</span>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ marginTop: '24px', padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <h4 style={{ fontSize: '0.88rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={14} style={{ color: '#ffd60a' }} /> {lang === 'ru' ? 'Сравнение с лучшим результатом' : 'vs. All-time Best efficiency'}
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                          <span className="secondary-text">{lang === 'ru' ? 'Эффективность бега' : 'Running efficiency score'}</span>
                          <span style={{ fontWeight: 700, color: (currentEfficiency?.score || 0) >= (bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : 0) ? '#34c759' : '#fff' }}>
                            {currentEfficiency?.score || 0} / {bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : 0}
                          </span>
                        </div>
                        <div style={{ height: '8px', borderRadius: '99px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min(100, ((currentEfficiency?.score || 0) / (bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score || 1 : 1)) * 100)}%`, 
                            height: '100%', 
                            background: 'linear-gradient(90deg, #34c759 0%, #30d158 100%)',
                            borderRadius: '99px'
                          }} />
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#8b9ab1', marginTop: '4px' }}>
                          {lang === 'ru' 
                            ? 'Показывает, насколько технично прошла эта сессия относительно вашего пика.'
                            : 'Indicates how technical this session was compared to your absolute peak.'}
                        </p>
                      </div>
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
                <input 
                  placeholder={lang === 'ru' ? 'Поиск по тегу или названию...' : 'Filter by tag or name...'}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.95rem', outline: 'none', marginBottom: '8px' }}
                />
                {history.filter(w => {
                   if (!tagFilter) return true;
                   const search = tagFilter.toLowerCase();
                   return w.name.toLowerCase().includes(search) || (w.tags || []).some(t => t.toLowerCase().includes(search));
                }).map((w) => {
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
                             {(w.tags || []).map((tag, idx) => (
                               <span key={`custom-${w.uuid}-${idx}`} style={{ padding: '5px 9px', borderRadius: '4px', background: 'rgba(0,122,255,0.2)', color: '#007aff', fontSize: '0.72rem', fontWeight: 600 }}>
                                 <Tag size={10} style={{ marginRight: '4px' }} />
                                 {tag}
                               </span>
                             ))}
                           </div>
                           {noteEditorUuid === w.uuid ? (
                             <div
                               onClick={(event) => event.stopPropagation()}
                               style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                             >
                               <textarea
                                 value={noteDraft}
                                 onChange={(event) => setNoteDraft(event.target.value)}
                                 rows={2}
                                 placeholder={lang === 'ru' ? 'Впечатления после забега — текстом или диктовкой…' : 'Post-run thoughts — typed or dictated…'}
                                 style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', padding: '10px 12px', borderRadius: '10px', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                               />
                               <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                 <button
                                   onClick={toggleNoteDictation}
                                   style={{
                                     background: noteDictating ? 'rgba(255,59,48,0.18)' : 'rgba(255,255,255,0.06)',
                                     color: noteDictating ? '#ff3b30' : 'inherit',
                                     border: `1px solid ${noteDictating ? 'rgba(255,59,48,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                     padding: '8px 12px',
                                     borderRadius: '9px',
                                     cursor: 'pointer',
                                     fontWeight: 600,
                                     fontSize: '0.8rem',
                                     display: 'flex',
                                     alignItems: 'center',
                                     gap: '6px',
                                   }}
                                 >
                                   <Mic size={13} />
                                   {noteDictating ? (lang === 'ru' ? 'Слушаю…' : 'Listening…') : (lang === 'ru' ? 'Диктовать' : 'Dictate')}
                                 </button>
                                 <button
                                   onClick={() => {
                                     void updateNote(w.uuid, noteDraft);
                                     setNoteEditorUuid(null);
                                   }}
                                   style={{ background: '#007aff', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '9px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
                                 >
                                   {t.save}
                                 </button>
                                 <button
                                   onClick={() => {
                                     if (noteDictating) noteRecognitionRef.current?.stop();
                                     setNoteDictating(false);
                                     setNoteEditorUuid(null);
                                   }}
                                   style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px', borderRadius: '9px', cursor: 'pointer', fontSize: '0.8rem' }}
                                 >
                                   {t.cancel}
                                 </button>
                               </div>
                             </div>
                           ) : (
                             <div
                               onClick={(event) => event.stopPropagation()}
                               style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}
                             >
                               {w.notes ? (
                                 <>
                                   <p
                                     style={{
                                       flex: 1,
                                       minWidth: 0,
                                       fontSize: '0.78rem',
                                       fontStyle: 'italic',
                                       color: 'rgba(255,255,255,0.55)',
                                       overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       display: '-webkit-box',
                                       WebkitLineClamp: 2,
                                       WebkitBoxOrient: 'vertical',
                                       lineHeight: 1.4,
                                     }}
                                   >
                                     “{w.notes}”
                                   </p>
                                   <button
                                     aria-label={lang === 'ru' ? 'Редактировать заметку' : 'Edit note'}
                                     onClick={() => {
                                       setNoteEditorUuid(w.uuid);
                                       setNoteDraft(w.notes ?? '');
                                     }}
                                     style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 8px', borderRadius: '8px', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                                   >
                                     <Pencil size={13} />
                                   </button>
                                 </>
                               ) : (
                                 <button
                                   onClick={() => {
                                     setNoteEditorUuid(w.uuid);
                                     setNoteDraft('');
                                   }}
                                   style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                                 >
                                   <Mic size={12} />
                                   {lang === 'ru' ? 'Заметка или диктовка после забега' : 'Post-run note or dictation'}
                                 </button>
                               )}
                             </div>
                           )}
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
                                <ComparisonRow label={t.pace} value={`${w.pace}/km`} isHigher={parsePaceToMinutes(w.pace) < parsePaceToMinutes(selectedWorkouts[idx === 0 ? 1 : 0].pace)} />
                                <ComparisonRow label={t.calories} value={`${w.calories} kcal`} isHigher={w.calories > selectedWorkouts[idx === 0 ? 1 : 0].calories} />
                            </div>
                        </div>
                    ))}
                </div>

                <VersusSummaryCard lang={lang} selectedWorkouts={selectedWorkouts} summary={versusSummary} />
            </div>
        )}

        {activeTab === 'calendar' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
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
                  onClick={() => {
                    const now = new Date();
                    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                    setSelectedDateKey(getDateKey(now));
                  }}
                  style={{ height: '42px', padding: '0 16px', borderRadius: '12px', border: '1px solid rgba(52,199,89,0.3)', background: 'rgba(52,199,89,0.12)', color: '#34c759', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}
                >
                  {lang === 'ru' ? 'Сегодня' : 'Today'}
                </button>
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
                    <div key={weekday} style={{ padding: '0 12px 8px', fontSize: '0.8rem', color: '#7f8a9a', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
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

                    const cellTitle = dayWorkouts.length > 0
                      ? dayWorkouts
                          .map((item) => `${item.name} · ${item.distance.toFixed(1)} ${lang === 'ru' ? 'км' : 'km'} · HR ${item.avgHeartRate}`)
                          .join('\n')
                      : undefined;

                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedDateKey(key)}
                        title={cellTitle}
                        style={{
                          minHeight: '108px',
                          borderRadius: '16px',
                          border: isSelected ? '1px solid rgba(87,166,255,0.85)' : '1px solid rgba(255,255,255,0.06)',
                          background: dayWorkouts.length > 0
                            ? 'linear-gradient(180deg, rgba(14, 25, 41, 0.95) 0%, rgba(7, 12, 21, 0.95) 100%)'
                            : 'rgba(255,255,255,0.025)',
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          overflow: 'hidden',
                          textAlign: 'left',
                          cursor: 'pointer',
                          opacity: inMonth ? 1 : 0.35,
                          boxShadow: isSelected ? '0 0 0 1px rgba(87,166,255,0.2), 0 10px 24px rgba(0,0,0,0.35)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '0.95rem',
                              fontWeight: 700,
                              lineHeight: 1.2,
                              flexShrink: 0,
                              color: isToday ? '#05070b' : '#fff',
                              background: isToday ? '#34c759' : 'transparent',
                              borderRadius: '8px',
                              padding: isToday ? '2px 7px' : '2px 0',
                            }}
                          >
                            {date.getDate()}
                          </span>
                          {workoutType && (
                            <span
                              style={{
                                fontSize: '0.6rem',
                                fontWeight: 800,
                                letterSpacing: '0.05em',
                                color: workoutType.color,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {workoutType.short}
                            </span>
                          )}
                        </div>

                        <div style={{ width: '100%', height: '5px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flexShrink: 0 }}>
                          {dayWorkouts.length > 0 && <div style={{ width: load.width, height: '100%', borderRadius: '999px', background: load.fill }} />}
                        </div>

                        {dayWorkouts.length > 0 ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px', marginTop: 'auto' }}>
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  fontSize: '0.84rem',
                                  fontWeight: 700,
                                  color: '#fff',
                                  minWidth: 0,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: load.color, flexShrink: 0 }} />
                                {totalDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#8b9ab1', flexShrink: 0 }}>{dayWorkouts.length}×</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: load.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {load.label}
                              {avgHrForDay > 0 ? <span style={{ color: '#8b9ab1', fontWeight: 400 }}>{` · HR ${avgHrForDay}`}</span> : null}
                            </div>
                          </>
                        ) : (
                          <div style={{ marginTop: 'auto', fontSize: '0.72rem', color: '#576171', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lang === 'ru' ? 'Отдых' : 'Rest'}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {(lang === 'ru'
                    ? [
                        { label: 'Лёгкая', color: '#34c759' },
                        { label: 'Средняя', color: '#ff9500' },
                        { label: 'Высокая', color: '#ff2d55' },
                      ]
                    : [
                        { label: 'Light', color: '#34c759' },
                        { label: 'Medium', color: '#ff9500' },
                        { label: 'High', color: '#ff2d55' },
                      ]
                  ).map((item) => (
                    <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.75rem', color: '#8b9ab1' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color }} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              {[
                { label: lang === 'ru' ? 'Серия дней' : 'Day streak', value: streakStats.dayCurrent, hint: lang === 'ru' ? 'Тренировки подряд, считая сегодняшнюю или вчерашнюю' : 'Consecutive training days, counting today or yesterday', color: '#ff9500' },
                { label: lang === 'ru' ? 'Рекорд серии (дни)' : 'Best day streak', value: streakStats.dayLongest, hint: lang === 'ru' ? 'Самая длинная серия дней в истории' : 'Longest daily streak ever', color: '#ffcc00' },
                { label: lang === 'ru' ? 'Серия недель' : 'Week streak', value: streakStats.weekCurrent, hint: lang === 'ru' ? 'Недели подряд с хотя бы одной тренировкой' : 'Consecutive weeks with at least one workout', color: '#34c759' },
                { label: lang === 'ru' ? 'Рекорд (недели)' : 'Best week streak', value: streakStats.weekLongest, hint: lang === 'ru' ? 'Самая длинная серия активных недель' : 'Longest streak of active weeks', color: '#5ac8fa' },
              ].map((item) => (
                <div key={item.label} className="premium-card" title={item.hint}>
                  <p className="secondary-text" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>{item.label}</p>
                  <h2 style={{ color: item.color }}>{item.value}</h2>
                </div>
              ))}
            </div>

            <div className="premium-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '12px' }}>
                <h3>{lang === 'ru' ? 'Тренировочная форма (CTL / ATL / TSB)' : 'Training Form (CTL / ATL / TSB)'}</h3>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
                  <span><span style={{ color: '#34c759', fontWeight: 700 }}>●</span> CTL {latestLoadPoint ? Math.round(latestLoadPoint.ctl) : '—'}</span>
                  <span><span style={{ color: '#ff9500', fontWeight: 700 }}>●</span> ATL {latestLoadPoint ? Math.round(latestLoadPoint.atl) : '—'}</span>
                  <span><span style={{ color: '#af52de', fontWeight: 700 }}>●</span> TSB {latestLoadPoint ? Math.round(latestLoadPoint.tsb) : '—'}</span>
                </div>
              </div>
              <p className="secondary-text" style={{ fontSize: '0.8rem', margin: '8px 0 16px' }}>
                {lang === 'ru'
                  ? 'CTL — накопленная форма (42 дня), ATL — свежая усталость (7 дней), TSB — их разница. Нагрузка считается по пульсу относительно порогового, если он задан в настройках.'
                  : 'CTL is long-term fitness (42 days), ATL is fresh fatigue (7 days), TSB is the difference. Load is heart-rate based when an LTHR is set in Settings.'}
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trainingLoadSeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    stroke="rgba(255,255,255,0.35)"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value: string) => value.slice(5).replace('-', '.')}
                    interval="preserveStartEnd"
                    minTickGap={48}
                  />
                  <YAxis stroke="rgba(255,255,255,0.35)" tick={{ fontSize: 11 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: '#10161f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: '0.85rem' }}
                    formatter={(value, name) => [Math.round(Number(value)), String(name)]}
                  />
                  <Area type="monotone" dataKey="ctl" stroke="#34c759" strokeWidth={2} fill="#34c759" fillOpacity={0.08} name="CTL" dot={false} />
                  <Area type="monotone" dataKey="atl" stroke="#ff9500" strokeWidth={2} fill="#ff9500" fillOpacity={0.08} name="ATL" dot={false} />
                  <Area type="monotone" dataKey="tsb" stroke="#af52de" strokeWidth={2} fill="none" name="TSB" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <p style={{ fontSize: '0.85rem', marginTop: '12px' }}>
                {lang === 'ru' ? 'Форма за месяц: ' : 'Fitness over the month: '}
                <span style={{ color: ctlTrend > 2 ? '#34c759' : ctlTrend < -2 ? '#ff3b30' : '#ff9500', fontWeight: 700 }}>
                  {ctlTrend > 2 ? (lang === 'ru' ? 'растёт' : 'rising') : ctlTrend < -2 ? (lang === 'ru' ? 'снижается' : 'falling') : (lang === 'ru' ? 'держится' : 'steady')}
                </span>
                {' · '}
                {tsbHint}
              </p>
            </div>

            <div className="premium-card">
              <h3 style={{ marginBottom: '4px' }}>{lang === 'ru' ? `Активность ${new Date().getFullYear()}` : `Activity ${new Date().getFullYear()}`}</h3>
              <p className="secondary-text" style={{ fontSize: '0.8rem', marginBottom: '16px' }}>
                {lang === 'ru' ? 'Цвет дня — суммарная нагрузка (TSS) за него. Наведите курсор для деталей.' : 'Cell colour shows the day’s total load (TSS). Hover for details.'}
              </p>
              <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: '4px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginRight: '6px', paddingTop: '18px' }}>
                  {(lang === 'ru' ? ['', 'Пн', '', 'Ср', '', 'Пт', ''] : ['', 'Mon', '', 'Wed', '', 'Fri', '']).map((label, index) => (
                    <span key={index} style={{ height: '11px', lineHeight: '11px', fontSize: '9px', color: 'rgba(255,255,255,0.35)', width: '22px' }}>{label}</span>
                  ))}
                </div>
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${yearHeatmap.length}, 11px)`, gap: '3px', marginBottom: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                    {heatmapMonthLabels.map((label) => (
                      <span key={label.name} style={{ gridColumnStart: label.column }}>{label.name}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {yearHeatmap.map((week) => (
                      <div key={week[0].dateKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {week.map((cell) => (
                          <div
                            key={cell.dateKey}
                            title={cell.inYear ? `${cell.dateKey} · ${cell.load} TSS · ${cell.distanceKm} км` : ''}
                            style={{
                              width: '11px',
                              height: '11px',
                              borderRadius: '2px',
                              background: heatmapColor(cell.load),
                              opacity: cell.inYear ? 1 : 0,
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>
                <span>{lang === 'ru' ? 'Меньше' : 'Less'}</span>
                {[0, 10, 30, 60, 100].map((load) => (
                  <span key={load} style={{ width: '11px', height: '11px', borderRadius: '2px', background: heatmapColor(load) }} />
                ))}
                <span>{lang === 'ru' ? 'Больше' : 'More'}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="premium-card">
                <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Цель года' : 'Annual Goal'}</h3>
                {annualGoalProgress ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                      <h2>{annualGoalProgress.doneKm} <span className="secondary-text" style={{ fontSize: '1rem' }}>/ {annualGoalProgress.goalKm} {lang === 'ru' ? 'км' : 'km'}</span></h2>
                      <span style={{ fontWeight: 700, color: annualGoalProgress.onTrack ? '#34c759' : '#ff9500' }}>{annualGoalProgress.percent}%</span>
                    </div>
                    <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '14px' }}>
                      <div style={{ width: `${annualGoalProgress.percent}%`, height: '100%', background: annualGoalProgress.onTrack ? '#34c759' : '#ff9500' }} />
                    </div>
                    <p className="secondary-text" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
                      {lang === 'ru'
                        ? `Осталось ${annualGoalProgress.daysLeft} ${annualGoalProgress.daysLeft % 10 === 1 && annualGoalProgress.daysLeft % 100 !== 11 ? 'день' : 'дней'}. Нужно около ${annualGoalProgress.neededPerWeek} км в неделю.`
                        : `${annualGoalProgress.daysLeft} days left. About ${annualGoalProgress.neededPerWeek} km per week needed.`}
                      <br />
                      {lang === 'ru'
                        ? `Темп последних 4 недель: ${annualGoalProgress.recentWeeklyKm} км/нед → прогноз ${annualGoalProgress.projectedKm} км.`
                        : `Recent pace: ${annualGoalProgress.recentWeeklyKm} km/week → projected ${annualGoalProgress.projectedKm} km.`}
                      <br />
                      <span style={{ color: annualGoalProgress.onTrack ? '#34c759' : '#ff9500', fontWeight: 600 }}>
                        {annualGoalProgress.onTrack
                          ? (lang === 'ru' ? 'Цель по силам при текущем темпе.' : 'On track at the current pace.')
                          : (lang === 'ru' ? 'При текущем темпе цель не будет достигнута.' : 'The goal will be missed at the current pace.')}
                      </span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="secondary-text" style={{ fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '16px' }}>
                      {lang === 'ru'
                        ? 'Задайте годовую цель по километрам — здесь появится прогресс, необходимый недельный темп и прогноз.'
                        : 'Set an annual distance goal — progress, the required weekly pace and a projection will appear here.'}
                    </p>
                    <button
                      onClick={() => setActiveTab('settings')}
                      style={{ background: '#007aff', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {lang === 'ru' ? 'Задать цель в настройках' : 'Set goal in Settings'}
                    </button>
                  </>
                )}
              </div>

              <div className="premium-card">
                <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Готовность (HRV)' : 'Readiness (HRV)'}</h3>
                {readinessStatus && readinessMeta ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '12px' }}>
                      <h2 style={{ color: readinessMeta.color }}>{readinessStatus.hrvIndex}%</h2>
                      <span style={{ color: readinessMeta.color, fontWeight: 700 }}>{readinessMeta.label}</span>
                    </div>
                    <p className="secondary-text" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
                      {lang === 'ru'
                        ? `HRV за 7 дней: ${readinessStatus.recentHrv} мс против базы 28 дней ${readinessStatus.baselineHrv} мс.`
                        : `7-day HRV: ${readinessStatus.recentHrv} ms vs the 28-day baseline ${readinessStatus.baselineHrv} ms.`}
                      {readinessStatus.restHrDelta !== null && (
                        <>
                          <br />
                          {lang === 'ru'
                            ? `Пульс покоя: ${readinessStatus.restHrDelta > 0 ? '+' : ''}${readinessStatus.restHrDelta} уд/мин к базе.`
                            : `Resting pulse: ${readinessStatus.restHrDelta > 0 ? '+' : ''}${readinessStatus.restHrDelta} bpm vs baseline.`}
                        </>
                      )}
                      <br />
                      {readinessStatus.status === 'ready'
                        ? (lang === 'ru' ? 'Восстановление в норме — можно смело планировать тяжёлую тренировку или старт.' : 'Recovery looks good — a hard session or race is reasonable.')
                        : readinessStatus.status === 'normal'
                          ? (lang === 'ru' ? 'Обычный режим: держите план, следите за самочувствием.' : 'Normal mode: stick to the plan and watch how you feel.')
                          : (lang === 'ru' ? 'ОРГАНИЗМ ЕЩЁ НЕ ВОССТАНОВИЛСЯ — сегодня лучше лёгкий бег или отдых.' : 'NOT FULLY RECOVERED — prefer an easy run or rest today.')}
                    </p>
                  </>
                ) : (
                  <p className="secondary-text" style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>
                    {lang === 'ru'
                      ? 'Недостаточно замеров HRV: для оценки готовности нужно минимум 5 тренировок с пульсом за последние 4 недели (синхронизация с Apple Здоровье).'
                      : 'Not enough HRV samples: readiness needs at least 5 workouts with heart rate in the last 4 weeks (sync from Apple Health).'}
                  </p>
                )}
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
                  label={lang === 'ru' ? 'Метров за удар' : 'Meters per beat'}
                  hint={lang === 'ru'
                    ? 'Дистанция в метрах, которую вы пробигаете за один удар сердца. Чем выше показатель, тем вы экономичнее.'
                    : 'The distance in meters you cover with each heartbeat. Higher values mean better efficiency.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentEfficiency ? currentEfficiency.metersPerBeat.toFixed(2) : '—'}</h3>
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
                            <AreaChart data={history.map((w) => ({
                                name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }),
                                pace: parseFloat(parsePaceToMinutes(w.pace).toFixed(2)),
                                label: w.pace
                            }))}>
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
                        {flag.severity === 'high' ? 'HIGH' : 'MEDIUM'}
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
                        <h3 style={{ fontSize: '1.1rem' }}>
                        {t.aiCoach} (Ollama{aiModel ? ` · ${aiModel}` : ''})
                      </h3>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <AiTextCard
                    lang={lang}
                    title={t.weeklyDigest}
                    hint={lang === 'ru' ? 'Сводка недели от локальной модели' : 'A weekly summary from the local model'}
                    accent="#34c759"
                    actionLabel={t.generateDigest}
                    onAction={() => void generateWeeklyDigest()}
                    isLoading={isDigestLoading}
                    result={weeklyDigest}
                    emptyHint={lang === 'ru'
                      ? 'Дайджест учитывает объём недели, MET-load, восстановление и красные флаги. Готовый текст кэшируется до следующей недели.'
                      : 'The digest accounts for weekly volume, MET load, recovery and red flags. The result is cached until next week.'}
                  />

                  {healthFlags.length > 0 && (
                    <AiTextCard
                      lang={lang}
                      title={t.explainFlags}
                      hint={healthFlags.map((flag) => flag.title).join(' · ')}
                      accent="#ff2d55"
                      actionLabel={lang === 'ru' ? 'Объяснить персонально' : 'Explain personally'}
                      onAction={() => void explainFlags()}
                      isLoading={isFlagsLoading}
                      result={flagExplanations}
                    />
                  )}

                  <AiTextCard
                    lang={lang}
                    title={t.gpsSplits}
                    hint={lang === 'ru' ? 'Пульс и темп по километрам' : 'Heart rate and pace per kilometre'}
                    accent="#007aff"
                    actionLabel={t.analyzeSplits}
                    onAction={() => void analyzeSplits(workoutSplits, workout)}
                    isLoading={isSplitsLoading}
                    result={splitsAnalysis}
                    disabled={workoutSplits.length === 0}
                    emptyHint={workoutSplits.length === 0 ? t.noGpsTrack : undefined}
                  >
                    {workout && (workout.route?.length ?? 0) >= 2 && (
                      <RouteTrackMap route={workout.route ?? []} splits={workoutSplits} lang={lang} />
                    )}
                    {workoutSplits.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: '10px', fontSize: '0.72rem', opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          <span>{lang === 'ru' ? 'КМ' : 'KM'}</span>
                          <span>{t.avgHr}</span>
                          <span>{t.pace}</span>
                        </div>
                        {workoutSplits.map((split) => (
                          <div key={split.km} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: '10px', padding: '8px 10px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', fontSize: '0.88rem' }}>
                            <span style={{ fontWeight: 600 }}>{split.km}</span>
                            <span className="secondary-text">{split.avgHr != null ? `${split.avgHr} bpm` : '—'}</span>
                            <span className="secondary-text">{split.paceSec !== undefined ? `${formatSplitPace(split.paceSec)}/km` : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </AiTextCard>

                  <AiTextCard
                    lang={lang}
                    title={t.voiceDiary}
                    hint={lang === 'ru' ? 'Диктуйте или пишите — модель свяжет заметку с метриками' : 'Dictate or type — the model links the note to your metrics'}
                    accent="#bf5af2"
                    actionLabel={t.reflect}
                    onAction={() => void reflectOnNote(diaryText)}
                    isLoading={isReflecting}
                    result={reflection}
                    disabled={!diaryText.trim()}
                    emptyHint={lang === 'ru'
                      ? 'Заметка сохраняется в раздел «Здоровье» и учитывается в оценке восстановления.'
                      : 'Notes are saved under Health and feed the recovery assessment.'}
                  >
                    <textarea
                      value={diaryText}
                      onChange={(event) => setDiaryText(event.target.value)}
                      placeholder={t.diaryPlaceholder}
                      rows={3}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'inherit', padding: '10px 12px', borderRadius: '10px', resize: 'vertical', marginBottom: '10px', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={toggleDictation}
                        style={{
                          background: isListening ? 'rgba(255,45,85,0.15)' : 'rgba(191,90,242,0.12)',
                          color: isListening ? '#ff2d55' : '#bf5af2',
                          border: `1px solid ${isListening ? 'rgba(255,45,85,0.3)' : 'rgba(191,90,242,0.25)'}`,
                          padding: '9px 14px',
                          borderRadius: '10px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Mic size={16} /> {isListening ? (lang === 'ru' ? 'Стоп' : 'Stop') : t.dictate}
                      </button>
                      <button
                        disabled={!diaryText.trim()}
                        onClick={saveDiaryEntry}
                        style={{
                          background: 'rgba(52,199,89,0.12)',
                          color: '#34c759',
                          border: '1px solid rgba(52,199,89,0.25)',
                          padding: '9px 14px',
                          borderRadius: '10px',
                          cursor: diaryText.trim() ? 'pointer' : 'not-allowed',
                          fontWeight: 600,
                          opacity: diaryText.trim() ? 1 : 0.5,
                        }}
                      >
                        {t.saveToDiary}
                      </button>
                      {diaryNotice && (
                        <span className="secondary-text" style={{ alignSelf: 'center', color: '#34c759', fontSize: '0.82rem' }}>{diaryNotice}</span>
                      )}
                    </div>
                  </AiTextCard>
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

        {activeTab === 'chat' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '860px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.chat}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Диалог с локальной моделью: контекстом служат последние тренировки, рекорды и состояние недели. История чата хранится в вашей базе.'
                  : 'A conversation with the local model: recent workouts, records and the current week provide the context. The chat history stays in your database.'}
              </p>
            </div>

            <ChatPanel
              messages={chatMessages}
              isStreaming={isChatStreaming}
              onSend={(text) => void sendChatMessage(text)}
              onClear={() => void clearChat()}
              lang={lang}
              emptyText={t.chatEmpty}
              placeholder={t.chatPlaceholder}
              clearLabel={t.chatClear}
            />
          </div>
        )}

        {activeTab === 'records' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.personalBests}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Оценка лучшего темпа на дистанцию по каждой тренировке: учитывается доля работы в 4-5 зонах пульса и поправка на дистанцию (модель Ригеля).'
                  : 'Estimated best pace per distance for every workout: it uses the share of time in HR zones 4-5 plus a Riegel distance adjustment.'}
              </p>
            </div>

            {personalBests.length === 0 ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <Trophy size={40} style={{ marginBottom: '12px' }} />
                <p>{t.noRecords}</p>
              </div>
            ) : (
              <>
                <div className="premium-card">
                  <p className="secondary-text" style={{ marginBottom: '16px' }}>{t.outdoorRecord}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    {(['1k', '5k', '10k', 'half'] as PersonalBestType[]).map((type) => {
                      const record = personalBests.find((item) => item.type === type && item.condition === 'outdoor');
                      const distance = getTierDistance(type);
                      return (
                        <div key={type} style={{ padding: '18px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <p className="secondary-text" style={{ marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{type}</p>
                          {record ? (
                            <>
                              <h2 style={{ marginBottom: '6px' }}>{formatPersonalBest(distance * record.value * 60)}</h2>
                              <p className="secondary-text">{record.value.toFixed(2)} min/km</p>
                              <p className="secondary-text" style={{ fontSize: '0.78rem', marginTop: '6px' }}>
                                {new Date(record.achievedAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                              </p>
                            </>
                          ) : (
                            <p className="secondary-text">—</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {personalBests.some((item) => item.condition === 'indoor') && (
                  <div className="premium-card">
                    <p className="secondary-text" style={{ marginBottom: '16px' }}>{t.indoorRecord}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                      {(['1k', '5k', '10k'] as PersonalBestType[]).map((type) => {
                        const record = personalBests.find((item) => item.type === type && item.condition === 'indoor');
                        const distance = getTierDistance(type);
                        return (
                          <div key={`indoor-${type}`} style={{ padding: '18px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                            <p className="secondary-text" style={{ marginBottom: '6px' }}>{type}</p>
                            <h3>{record ? formatPersonalBest(distance * record.value * 60) : '—'}</h3>
                            {record && <p className="secondary-text">{record.value.toFixed(2)} min/km</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="premium-card">
                  <p className="secondary-text" style={{ marginBottom: '12px' }}>
                    {lang === 'ru'
                      ? 'Рекорды считаются по истории тренировок. Пересчитать после массового импорта:'
                      : 'Records are derived from the workout history. Recalculate after a bulk import:'}
                  </p>
                  <button
                    onClick={() => void rebuildPersonalBests()}
                    style={{ background: 'rgba(0, 122, 255, 0.12)', color: '#007aff', border: '1px solid rgba(0, 122, 255, 0.24)', padding: '10px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {lang === 'ru' ? 'Обновить' : 'Refresh'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}


        {activeTab === 'health' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.bodyMetrics}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Вес, состав тела и субъективная крепатура. Записи хранятся локально в той же базе, что и тренировки.'
                  : 'Weight, body composition and subjective soreness. Entries live locally in the same database as the workouts.'}
              </p>
            </div>

            <div className="premium-card">
              <p className="secondary-text" style={{ marginBottom: '16px' }}>{t.addMetric}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {([
                  ['date', t.date, 'date'],
                  ['weight', t.weight, 'number'],
                  ['muscleMass', t.muscleMass, 'number'],
                  ['fatPercentage', t.fatPercentage, 'number'],
                  ['sorenessLevel', t.soreness, 'number'],
                ] as Array<[keyof typeof metricDraft, string, string]>).map(([key, label, type]) => (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span className="secondary-text" style={{ fontSize: '0.8rem' }}>{label}</span>
                    <input
                      type={type}
                      value={metricDraft[key]}
                      onChange={(event) => setMetricDraft((draft) => ({ ...draft, [key]: event.target.value }))}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'inherit', padding: '10px 12px', borderRadius: '10px' }}
                    />
                  </label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span className="secondary-text" style={{ fontSize: '0.8rem' }}>{t.notes}</span>
                  <input
                    value={metricDraft.notes}
                    onChange={(event) => setMetricDraft((draft) => ({ ...draft, notes: event.target.value }))}
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'inherit', padding: '10px 12px', borderRadius: '10px' }}
                  />
                </label>
              </div>
              <button
                onClick={() => {
                  const toNumber = (value: string) => {
                    const parsed = Number.parseFloat(value);
                    return Number.isFinite(parsed) ? parsed : undefined;
                  };
                  void persistBodyMetric({
                    date: metricDraft.date || new Date().toISOString().slice(0, 10),
                    weight: toNumber(metricDraft.weight),
                    muscleMass: toNumber(metricDraft.muscleMass),
                    fatPercentage: toNumber(metricDraft.fatPercentage),
                    sorenessLevel: toNumber(metricDraft.sorenessLevel),
                    notes: metricDraft.notes || undefined,
                  }).then(() =>
                    setMetricDraft({
                      date: new Date().toISOString().slice(0, 10),
                      weight: '',
                      muscleMass: '',
                      fatPercentage: '',
                      sorenessLevel: '',
                      notes: '',
                    }),
                  );
                }}
                style={{ background: '#007aff', color: '#fff', border: 'none', padding: '11px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}
              >
                {t.save}
              </button>
            </div>

            {bodyMetrics.length === 0 ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '40px 32px' }}>
                <Weight size={40} style={{ marginBottom: '12px' }} />
                <p>{t.noMetrics}</p>
              </div>
            ) : (
              <div className="premium-card">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {bodyMetrics.map((metric) => (
                    <div key={metric.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1.6fr', gap: '12px', padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)' }}>
                      <span style={{ fontWeight: 600 }}>{new Date(metric.date).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}</span>
                      <span className="secondary-text">{metric.weight ?? '—'} kg</span>
                      <span className="secondary-text">{metric.muscleMass ?? '—'} kg</span>
                      <span className="secondary-text">{metric.fatPercentage ?? '—'} %</span>
                      <span className="secondary-text">{metric.sorenessLevel ?? '—'} / 10</span>
                      <span className="secondary-text">{metric.notes ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.routeIntelligence}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Повторяющиеся трассы распознаются по GPS-треку с точностью до нескольких метров, поэтому один и тот же маршрут не создаёт новую запись.'
                  : 'Repeating courses are matched by a GPS fingerprint with a few metres of tolerance, so the same route never creates a new entry.'}
              </p>
            </div>

            {routes.length === 0 ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <MapPinned size={40} style={{ marginBottom: '12px' }} />
                <p>{t.noRoutes}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                {routes.map((route) => (
                  <div key={route.id} className="premium-card">
                    {editingRouteId === route.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <input
                          value={routeNameDraft}
                          onChange={(event) => setRouteNameDraft(event.target.value)}
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'inherit', padding: '10px 12px', borderRadius: '10px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => {
                              void setRouteName(route.id, routeNameDraft);
                              setEditingRouteId(null);
                            }}
                            style={{ background: '#007aff', color: '#fff', border: 'none', padding: '9px 14px', borderRadius: '9px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            {t.save}
                          </button>
                          <button
                            onClick={() => setEditingRouteId(null)}
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '9px 14px', borderRadius: '9px', cursor: 'pointer' }}
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                          <h3>{route.name}</h3>
                          <button
                            aria-label={t.rename}
                            onClick={() => {
                              setEditingRouteId(route.id);
                              setRouteNameDraft(route.name);
                            }}
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '7px 9px', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                        <p className="secondary-text" style={{ marginBottom: '6px' }}>{t.runsOnRoute}: {route.runCount}</p>
                        <p className="secondary-text" style={{ fontSize: '0.8rem' }}>
                          {t.lastRun}: {route.lastRunAt ? new Date(route.lastRunAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US') : '—'}
                        </p>
                        <button
                          onClick={() => void openSegmentsPanel(route.id)}
                          style={{
                            marginTop: '12px',
                            width: '100%',
                            background: segmentsRouteId === route.id ? 'rgba(175,82,222,0.2)' : 'rgba(255,255,255,0.06)',
                            color: segmentsRouteId === route.id ? '#d4a4f0' : 'inherit',
                            border: `1px solid ${segmentsRouteId === route.id ? 'rgba(175,82,222,0.5)' : 'rgba(255,255,255,0.1)'}`,
                            padding: '9px',
                            borderRadius: '9px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '7px',
                          }}
                        >
                          <Flag size={14} />
                          {lang === 'ru' ? 'Сегменты' : 'Segments'}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

              {segmentsRouteId && (
                <div className="premium-card" style={{ border: '1px solid rgba(175, 82, 222, 0.3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <Flag size={18} style={{ color: '#af52de', marginTop: '3px' }} />
                      <div>
                        <h3>
                          {lang === 'ru' ? 'Сегменты' : 'Segments'}
                          <span className="secondary-text" style={{ fontWeight: 400 }}>
                            {' · '}{routes.find((item) => item.id === segmentsRouteId)?.name}
                          </span>
                        </h3>
                        <p className="secondary-text" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                          {lang === 'ru'
                            ? 'Отрезок маршрута с личными рекордами и историей попыток. Все забеги по этому маршруту засчитываются автоматически.'
                            : 'A slice of the course with personal bests and attempt history. Every run on this route is scored automatically.'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setSegmentsRouteId(null)}
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '7px 9px', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {routeSegments.length === 0 ? (
                    <p className="secondary-text" style={{ fontSize: '0.9rem' }}>
                      {segmentsBusy
                        ? (lang === 'ru' ? 'Загрузка…' : 'Loading…')
                        : (lang === 'ru'
                            ? 'Сегментов пока нет. Выделите отрезок маршрута — например, финишную прямую — и следите за рекордами.'
                            : 'No segments yet. Mark a slice of the course — say, the finishing straight — and track your records.')}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {routeSegments.map((segment) => (
                        <div key={segment.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
                          <div
                            onClick={() => void toggleSegmentEfforts(segment.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', cursor: 'pointer' }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{segment.name}</p>
                              <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                                {segment.distanceKm.toFixed(2)} {lang === 'ru' ? 'км' : 'km'} · {lang === 'ru' ? 'попыток' : 'attempts'}: {segment.effortCount}
                              </p>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <p style={{ fontWeight: 800, color: '#af52de', fontFamily: 'ui-monospace, monospace', fontSize: '1.05rem' }}>
                                {segment.bestSeconds !== null ? formatEffortTime(segment.bestSeconds) : '—'}
                              </p>
                              <p className="secondary-text" style={{ fontSize: '0.7rem' }}>{lang === 'ru' ? 'лучшее' : 'best'}</p>
                            </div>
                            <button
                              aria-label={lang === 'ru' ? 'Удалить сегмент' : 'Delete segment'}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDeleteSegment(segment.id);
                              }}
                              style={{ background: 'rgba(255,59,48,0.12)', color: '#ff3b30', border: '1px solid rgba(255,59,48,0.25)', padding: '7px 9px', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {expandedSegmentId === segment.id && (
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 14px 12px', background: 'rgba(255,255,255,0.02)' }}>
                              {!segmentEffortsBySegment[segment.id] ? (
                                <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                                  {lang === 'ru' ? 'Загрузка попыток…' : 'Loading attempts…'}
                                </p>
                              ) : segmentEffortsBySegment[segment.id].length === 0 ? (
                                <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                                  {lang === 'ru'
                                    ? 'Попыток пока нет — они появятся после следующего забега по маршруту.'
                                    : 'No attempts yet — they will appear after your next run on this route.'}
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {segmentEffortsBySegment[segment.id].map((effort, index) => (
                                    <div key={effort.workoutUuid} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                                      <span style={{ width: '28px', fontWeight: 800, color: index === 0 ? '#ffcc00' : 'rgba(255,255,255,0.45)' }}>#{index + 1}</span>
                                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {new Date(effort.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                                        {effort.workoutName ? ` · ${effort.workoutName}` : ''}
                                      </span>
                                      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{formatEffortTime(effort.seconds)}</span>
                                      <span className="secondary-text" style={{ fontSize: '0.75rem', width: '64px', textAlign: 'right' }}>
                                        {formatEffortPace(effort.paceMinPerKm)}/{lang === 'ru' ? 'км' : 'km'}
                                      </span>
                                      {effort.isPersonalBest && (
                                        <span style={{ background: 'rgba(255,204,0,0.15)', color: '#ffcc00', border: '1px solid rgba(255,204,0,0.4)', borderRadius: '6px', padding: '2px 6px', fontSize: '0.65rem', fontWeight: 800 }}>
                                          PR
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!segmentFormOpen ? (
                    <button
                      onClick={() => {
                        setSegmentFormOpen(true);
                        setSegmentNotice(null);
                      }}
                      style={{ marginTop: '14px', background: 'rgba(175,82,222,0.12)', color: '#d4a4f0', border: '1px dashed rgba(175,82,222,0.5)', padding: '10px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      <Plus size={16} />
                      {lang === 'ru' ? 'Новый сегмент' : 'New segment'}
                    </button>
                  ) : (
                    <div style={{ marginTop: '14px', borderTop: '1px dashed rgba(255,255,255,0.12)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {segmentMarkers.length < 2 ? (
                        <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                          {lang === 'ru'
                            ? 'У маршрута нет GPS-трека с координатами — сегмент можно создать только на маршруте с треком.'
                            : 'This route has no GPS track with coordinates — segments need a tracked route.'}
                        </p>
                      ) : (
                        <>
                          <input
                            value={segmentNameDraft}
                            onChange={(event) => setSegmentNameDraft(event.target.value)}
                            placeholder={lang === 'ru' ? 'Название, например «Финишная прямая»' : 'Name, e.g. "Finishing straight"'}
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', padding: '11px 13px', borderRadius: '10px', fontSize: '0.95rem' }}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <label className="secondary-text" style={{ fontSize: '0.8rem' }}>
                              {lang === 'ru' ? 'Старт' : 'Start'}
                              <select
                                value={segmentStartIdx ?? ''}
                                onChange={(event) => setSegmentStartIdx(event.target.value === '' ? null : Number(event.target.value))}
                                style={{ display: 'block', width: '100%', marginTop: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', padding: '10px 12px', borderRadius: '10px' }}
                              >
                                <option value="">{lang === 'ru' ? '— выбрать —' : '— choose —'}</option>
                                {segmentMarkers.map((marker) => (
                                  <option key={marker.index} value={marker.index}>
                                    {marker.km < 1
                                      ? `${Math.round(marker.km * 1000)} ${lang === 'ru' ? 'м' : 'm'}`
                                      : `${marker.km.toFixed(2)} ${lang === 'ru' ? 'км' : 'km'}`}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="secondary-text" style={{ fontSize: '0.8rem' }}>
                              {lang === 'ru' ? 'Финиш' : 'Finish'}
                              <select
                                value={segmentEndIdx ?? ''}
                                onChange={(event) => setSegmentEndIdx(event.target.value === '' ? null : Number(event.target.value))}
                                style={{ display: 'block', width: '100%', marginTop: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', padding: '10px 12px', borderRadius: '10px' }}
                              >
                                <option value="">{lang === 'ru' ? '— выбрать —' : '— choose —'}</option>
                                {segmentMarkers.map((marker) => (
                                  <option key={marker.index} value={marker.index}>
                                    {marker.km < 1
                                      ? `${Math.round(marker.km * 1000)} ${lang === 'ru' ? 'м' : 'm'}`
                                      : `${marker.km.toFixed(2)} ${lang === 'ru' ? 'км' : 'km'}`}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          {segmentStartIdx !== null && segmentEndIdx !== null && (
                            <p className="secondary-text" style={{ fontSize: '0.8rem' }}>
                              {lang === 'ru' ? 'Длина сегмента: ' : 'Segment length: '}
                              <span style={{ color: '#d4a4f0', fontWeight: 700 }}>
                                {haversineKm(segmentTrack[segmentStartIdx], segmentTrack[segmentEndIdx]).toFixed(2)} {lang === 'ru' ? 'км' : 'km'}
                              </span>
                              {segmentStartIdx >= segmentEndIdx && (
                                <span style={{ color: '#ff9500' }}>
                                  {' · '}{lang === 'ru' ? 'старт должен быть раньше финиша' : 'the start must come before the finish'}
                                </span>
                              )}
                            </p>
                          )}
                          {segmentNotice && (
                            <p style={{ color: '#ff3b30', fontSize: '0.85rem' }}>{segmentNotice}</p>
                          )}
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => void handleCreateSegment()}
                              disabled={segmentCanCreate}
                              style={{
                                background: '#af52de',
                                color: '#fff',
                                border: 'none',
                                padding: '10px 16px',
                                borderRadius: '10px',
                                cursor: segmentCanCreate ? 'not-allowed' : 'pointer',
                                fontWeight: 700,
                                opacity: segmentCanCreate ? 0.5 : 1,
                              }}
                            >
                              {lang === 'ru' ? 'Создать' : 'Create'}
                            </button>
                            <button
                              onClick={() => {
                                setSegmentFormOpen(false);
                                setSegmentNotice(null);
                              }}
                              style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.1)', padding: '10px 16px', borderRadius: '10px', cursor: 'pointer' }}
                            >
                              {t.cancel}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
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

                <AiTextCard
                  lang={lang}
                  title={t.readiness}
                  hint={lang === 'ru' ? 'HRV, пульсовой тренд, нагрузка недели и крепатура' : 'HRV, heart-rate trend, weekly load and soreness'}
                  accent="#ff9500"
                  actionLabel={t.assessReadiness}
                  onAction={() => void assessReadiness()}
                  isLoading={isReadinessLoading}
                  result={readiness}
                  emptyHint={lang === 'ru'
                    ? 'Модель выдаст вердикт GO / CAUTION / REST с аргументами — чтобы решить, тягать ли завтра тяжёлую сессию.'
                    : 'The model answers GO / CAUTION / REST with reasons — to decide whether tomorrow should be a hard session.'}
                />

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

                <button
                  disabled={isWeekLoading || !trainingGoal}
                  onClick={() => void fetchWeekPlan()}
                  style={{
                    width: '100%',
                    marginTop: '10px',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: trainingGoal ? '#fff' : '#a0a0a0',
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
                  {isWeekLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    `📅 ${lang === 'ru' ? 'План на неделю (7 дней)' : 'Weekly plan (7 days)'}`
                  )}
                </button>

                {(isPlanLoading || isWeekLoading) && (
                  <p className="secondary-text" style={{ fontSize: '0.8rem', marginTop: '10px', textAlign: 'center' }}>
                    {t.modelLoading}
                  </p>
                )}

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
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>{lang === 'ru' ? 'ПУЛЬС' : 'HR'}</p><p style={{ fontSize: '0.88rem', fontWeight: 600, color }}>{phase.hr_range}</p></div>
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>{lang === 'ru' ? 'ТЕМП' : 'PACE'}</p><p style={{ fontSize: '0.88rem', fontWeight: 600 }}>{phase.pace}</p></div>
                              <div style={{ flex: 1 }}><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>{lang === 'ru' ? 'СОВЕТ' : 'TIP'}</p><p style={{ fontSize: '0.83rem', opacity: 0.75 }}>{phase.notes}</p></div>
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

                {weekError && (
                  <div className="animate-fade-in" style={{ padding: '16px', background: 'rgba(255, 45, 85, 0.06)', borderRadius: '12px', border: '1px solid rgba(255, 45, 85, 0.18)', whiteSpace: 'pre-line', marginTop: '16px', color: '#ff6b81' }}>
                    {weekError}
                  </div>
                )}

                {weekSessions.length > 0 && (
                  <div className="animate-fade-in" style={{ marginTop: '24px' }}>
                    <p style={{ fontWeight: 600, color: '#007aff', marginBottom: '16px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {lang === 'ru'
                        ? `План на неделю · ${weekSessions[0].dateLabel} — ${weekSessions[6].dateLabel}`
                        : `Week plan · ${weekSessions[0].dateLabel} — ${weekSessions[6].dateLabel}`}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                      {weekSessions.map((day) => {
                        const zoneColors: Record<string, string> = { Z1: '#34c759', Z2: '#007aff', Z3: '#ff9500', Z4: '#ff2d55', Z5: '#bf5af2', '-': '#a0a0a0' };
                        const color = zoneColors[day.zone] ?? '#a0a0a0';
                        const isRest = day.session === 'Rest';
                        return (
                          <div
                            key={day.key}
                            style={{ background: `${color}08`, border: `1px solid ${color}25`, borderRadius: '14px', padding: '14px', opacity: isRest ? 0.72 : 1 }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{day.weekdayShort}</span>
                              <span className="secondary-text" style={{ fontSize: '0.75rem' }}>{day.dateLabel}</span>
                            </div>
                            <p style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: '6px' }}>{day.session}</p>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              <span style={{ background: color, color: '#fff', fontSize: '0.65rem', fontWeight: 800, padding: '2px 7px', borderRadius: '6px' }}>{day.zone}</span>
                              <span style={{ background: 'rgba(255,255,255,0.07)', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: '6px' }}>{day.intensity}</span>
                            </div>
                            <p style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                              {day.distance !== '—' ? `${day.distance} · ${day.duration}` : day.duration}
                            </p>
                            <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px', lineHeight: 1.4 }}>{day.notes}</p>
                          </div>
                        );
                      })}
                    </div>
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
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Персонализация зон' : 'Zone Personalization'}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                      {(['z1', 'z2', 'z3', 'z4', 'z5'] as const).map((zone, idx) => (
                        <div key={zone}>
                          <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                            {lang === 'ru' ? `Зона ${idx + 1} (мин. пульс)` : `Zone ${idx + 1} (min HR)`}
                          </label>
                          <input
                            type="number"
                            value={preferences.hrZones[zone]}
                            onChange={(e) => setPreferences({
                              ...preferences,
                              hrZones: { ...preferences.hrZones, [zone]: parseInt(e.target.value) || 0 }
                            })}
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              borderRadius: '10px',
                              border: '1px solid rgba(255,255,255,0.12)',
                              background: 'rgba(255,255,255,0.04)',
                              color: '#f5f7fb',
                              fontSize: '0.95rem',
                              outline: 'none'
                            }}
                          />
                        </div>
                      ))}
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Пороговый темп (мин/км)' : 'Threshold Pace (min/km)'}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={preferences.thresholdPace}
                          onChange={(e) => setPreferences({
                            ...preferences,
                            thresholdPace: Number.parseFloat(e.target.value) || 0
                          })}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#f5f7fb',
                            fontSize: '0.95rem',
                            outline: 'none'
                          }}
                        />
                        <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
                           {lang === 'ru' ? 'Например: 5.0 для темпа 5:00/км. Используется AI-тренером.' : 'Example: 5.0 for 5:00/km pace. Used by the AI coach.'}
                        </p>
                      </div>
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Пороговый пульс (LTHR)' : 'Lactate Threshold HR (LTHR)'}
                        </label>
                        <input
                          type="number"
                          value={preferences.lthr ?? ''}
                          placeholder="170"
                          onChange={(e) => setPreferences({
                            ...preferences,
                            lthr: e.target.value ? Number.parseInt(e.target.value, 10) || null : null
                          })}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#f5f7fb',
                            fontSize: '0.95rem',
                            outline: 'none'
                          }}
                        />
                        <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
                           {lang === 'ru' ? 'Включает расчёт тренировочной формы и готовности по пульсу. Не знаете — оставьте пустым.' : 'Enables heart-rate based training form and readiness. Leave empty if unknown.'}
                        </p>
                      </div>
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Годовая цель (км)' : 'Annual goal (km)'}
                        </label>
                        <input
                          type="number"
                          step="50"
                          value={preferences.annualGoalKm ?? 0}
                          onChange={(e) => setPreferences({
                            ...preferences,
                            annualGoalKm: Number.parseFloat(e.target.value) || 0
                          })}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#f5f7fb',
                            fontSize: '0.95rem',
                            outline: 'none'
                          }}
                        />
                        <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
                           {lang === 'ru' ? 'Прогресс и прогноз отображаются во вкладке «Индекс формы».' : 'Progress and projection appear on the Fitness Index tab.'}
                        </p>
                      </div>
                    </div>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Экипировка (Кроссовки)' : 'Equipment (Shoes)'}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {shoes.map(shoe => (
                        <div key={shoe.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px', border: shoe.isActive ? '1px solid rgba(52, 199, 89, 0.3)' : '1px solid rgba(255,255,255,0.1)' }}>
                           <div>
                             <h4 style={{ margin: 0, fontSize: '1.05rem', color: shoe.isActive ? '#fff' : '#a0a0a0' }}>{shoe.name} <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>({shoe.brand} {shoe.model})</span></h4>
                             <p className="secondary-text" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                               {shoe.distanceRun.toFixed(1)} / {shoe.maxDistance} km 
                               <span style={{ marginLeft: '12px', color: shoe.distanceRun > shoe.maxDistance ? '#ff2d55' : 'inherit' }}>
                                 ({Math.round((shoe.distanceRun / shoe.maxDistance) * 100)}%)
                               </span>
                             </p>
                           </div>
                           <button onClick={async () => {
                             const { toggleShoeActive } = await import('@/lib/actions');
                             await toggleShoeActive(shoe.id, !shoe.isActive);
                             await loadShoes();
                           }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer' }}>
                             {shoe.isActive ? (lang === 'ru' ? 'В архив' : 'Archive') : (lang === 'ru' ? 'Активировать' : 'Activate')}
                           </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <input
                          placeholder={lang === 'ru' ? 'Название (напр. Nike Peg)' : 'Name (e.g. Nike Peg)'}
                          value={newShoe.name}
                          onChange={(e) => setNewShoe({...newShoe, name: e.target.value})}
                          style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', outline: 'none' }}
                        />
                        <input
                          placeholder={lang === 'ru' ? 'Макс. км (800)' : 'Max km (800)'}
                          type="number"
                          value={newShoe.maxDistance}
                          onChange={(e) => setNewShoe({...newShoe, maxDistance: parseInt(e.target.value)||800})}
                          style={{ width: '100px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', outline: 'none' }}
                        />
                        <button onClick={async () => {
                          if (newShoe.name) {
                            const { addShoe } = await import('@/lib/actions');
                            await addShoe({ name: newShoe.name, brand: newShoe.brand, model: newShoe.model, maxDistance: newShoe.maxDistance });
                            setNewShoe({ name: '', brand: '', model: '', maxDistance: 800 });
                            await loadShoes();
                          }
                        }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#007aff', color: '#fff', border: 'none', padding: '0 16px', borderRadius: '8px', cursor: 'pointer' }}>
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'AI-модель (Ollama)' : 'AI Model (Ollama)'}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Текстовая модель' : 'Text model'}
                        </label>
                        <select
                          value={aiModel}
                          onChange={(event) => persistModelChoice('runform.aiModel', event.target.value, setAiModel)}
                          style={modelSelectStyle}
                        >
                          <option value="">{lang === 'ru' ? 'По умолчанию (qwen3:4b)' : 'Default (qwen3:4b)'}</option>
                          {modelOptionsFor(aiModel).map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                              {item.size > 0 ? ` (${(item.size / 1e9).toFixed(1)} GB)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Vision-модель (скриншоты)' : 'Vision model (screenshots)'}
                        </label>
                        <select
                          value={aiVisionModel}
                          onChange={(event) => persistModelChoice('runform.aiVisionModel', event.target.value, setAiVisionModel)}
                          style={modelSelectStyle}
                        >
                          <option value="">{lang === 'ru' ? 'По умолчанию (qwen2.5-vl:3b)' : 'Default (qwen2.5-vl:3b)'}</option>
                          {modelOptionsFor(aiVisionModel).map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                              {item.size > 0 ? ` (${(item.size / 1e9).toFixed(1)} GB)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '10px' }}>
                      {modelsUnavailable
                        ? (lang === 'ru'
                            ? 'Ollama не отвечает — список моделей недоступен, но сохранённый выбор продолжает работать.'
                            : 'Ollama is not responding — the model list is unavailable, but the saved pick still applies.')
                        : (lang === 'ru'
                            ? 'Модель остаётся в памяти 30 минут после запроса: повторные ответы приходят сразу. Скачать новую: ollama pull qwen3:4b.'
                            : 'The model stays loaded for 30 minutes after a request, so repeat answers arrive immediately. Get a new one: ollama pull qwen3:4b.')}
                    </p>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Приложение' : 'App'}</h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{lang === 'ru' ? 'Версия' : 'Version'}</span>
                          <span className="secondary-text">{formatVersionLabel()}</span>
                    </div>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Резервные копии базы' : 'Database Backups'}</h3>
                    {dbInfo && (
                      <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '14px', wordBreak: 'break-all' }}>
                        {lang === 'ru' ? 'База: ' : 'Database: '}{dbInfo.path}
                        {' · '}{(dbInfo.sizeBytes / 1024).toFixed(0)} KB
                        {' · '}{dbInfo.workouts} {lang === 'ru' ? 'тренировок' : 'workouts'}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                      <button
                        onClick={handleCreateBackup}
                        disabled={backupBusy}
                        style={{ background: '#007aff', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: backupBusy ? 'wait' : 'pointer', fontWeight: 600, opacity: backupBusy ? 0.6 : 1 }}
                      >
                        {lang === 'ru' ? 'Создать копию' : 'Create backup'}
                      </button>
                      <button
                        onClick={() => backupFileInputRef.current?.click()}
                        disabled={backupBusy}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '10px 18px', borderRadius: '10px', cursor: backupBusy ? 'wait' : 'pointer', opacity: backupBusy ? 0.6 : 1 }}
                      >
                        {lang === 'ru' ? 'Загрузить файл…' : 'Upload file…'}
                      </button>
                      <input
                        ref={backupFileInputRef}
                        type="file"
                        accept=".db,application/x-sqlite3"
                        style={{ display: 'none' }}
                        onChange={handleBackupFileChosen}
                      />
                    </div>
                    {backupNotice && (
                      <p style={{ color: '#34c759', fontSize: '0.85rem', marginBottom: '12px' }}>{backupNotice}</p>
                    )}
                    {backupList.length === 0 ? (
                      <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                        {lang === 'ru'
                          ? 'Копий пока нет. Создайте первую — она сохранится в папке data/backups рядом с базой.'
                          : 'No backups yet. Create the first one — it is stored in data/backups next to the database.'}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {backupList.map((entry) => (
                          <div
                            key={entry.fileName}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.fileName}</p>
                              <p className="secondary-text" style={{ margin: '2px 0 0', fontSize: '0.75rem' }}>
                                {new Date(entry.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                                {' · '}{(entry.sizeBytes / 1024).toFixed(0)} KB
                                {' · '}{entry.workouts < 0 ? '?' : entry.workouts} {lang === 'ru' ? 'тренировок' : 'workouts'}
                              </p>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                              <a
                                href={`/api/backup?file=${encodeURIComponent(entry.fileName)}`}
                                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px 12px', borderRadius: '8px', textDecoration: 'none', fontSize: '0.85rem' }}
                              >
                                {lang === 'ru' ? 'Скачать' : 'Download'}
                              </a>
                              <button
                                onClick={() => handleRestoreBackup(entry.fileName)}
                                disabled={backupBusy}
                                style={{ background: 'transparent', border: '1px solid rgba(255, 149, 0, 0.4)', color: '#ff9500', padding: '6px 12px', borderRadius: '8px', cursor: backupBusy ? 'wait' : 'pointer', fontSize: '0.85rem', opacity: backupBusy ? 0.6 : 1 }}
                              >
                                {lang === 'ru' ? 'Восстановить' : 'Restore'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '12px' }}>
                      {lang === 'ru'
                        ? 'Копия — это снимок всей базы: тренировки, кроссовки, планы, чат и здоровье. Восстановление сначала сохраняет страховочную копию текущего состояния, поэтому его всегда можно отменить.'
                        : 'A backup is a snapshot of the whole database: workouts, shoes, plans, chat and health entries. Restoring saves a safety copy of the current state first, so it is always undoable.'}
                    </p>
                </div>
                <button 
                    onClick={async () => { if (confirm(lang === 'ru' ? 'Вы уверены? Это сотрет все данные.' : 'Are you sure? This will delete all data.')) { await resetWorkouts(); setActiveTab('dashboard'); } }}
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
