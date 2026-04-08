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
  parsePaceToMinutes,
} from '@/lib/ai';
import { WorkoutData } from '@/lib/parser';
import { translations, Language } from '@/lib/translations';

export type ChartDatum = {
  name: string;
  value: number;
  minutes: number;
  percentage: number;
  formatted: string;
  color: string;
};

type DayLoadInfo = {
  label: string;
  color: string;
  fill: string;
  width: string;
};

type WorkoutTypeInfo = {
  short: string;
  label: string;
  color: string;
};

type SmartWorkoutLabel = {
  label: string;
  color: string;
  bg: string;
};

import { defaultPreferences, UserPreferences } from '@/lib/ai';

type HomeMetricsParams = {
  workout: WorkoutData | null;
  history: WorkoutData[];
  lang: Language;
  currentMonth: Date;
  selectedDateKey: string | null;
  selectedWorkouts: WorkoutData[];
  preferences?: UserPreferences;
};

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildHomeMetrics(params: HomeMetricsParams) {
  const { workout, history, lang, currentMonth, selectedDateKey, selectedWorkouts, preferences = defaultPreferences } = params;
  const t = translations[lang];

  const getTranslatedZone = (name: string) => {
    switch (name.toUpperCase()) {
      case 'PEAK':
        return t.zones.peak;
      case 'CARDIO':
        return t.zones.cardio;
      case 'FAT BURN':
        return t.zones.fatBurn;
      case 'WARM UP':
        return t.zones.warmUp;
      default:
        return name;
    }
  };

  const getStatusColor = (name: string) => {
    switch (name.toUpperCase()) {
      case 'PEAK':
        return '#ff2d55';
      case 'CARDIO':
        return '#ff9500';
      case 'FAT BURN':
        return '#34c759';
      default:
        return '#007aff';
    }
  };

  const hrZonesData: ChartDatum[] = workout
    ? Object.values(workout.zones)
        .map((zone) => ({
          name: getTranslatedZone(zone.name),
          value: zone.time.value,
          minutes: Math.round(zone.time.value / 60),
          percentage: Math.round((zone.rate || 0) * 100),
          formatted: formatTime(zone.time.value),
          color: getStatusColor(zone.name),
        }))
        .filter((zone) => zone.value >= 0)
        .sort((a, b) => b.value - a.value)
    : [];

  const prs = history.length === 0
    ? null
    : {
        distance: Math.max(...history.map((item) => item.distance)),
        duration: Math.max(...history.map((item) => item.duration)),
        calories: Math.max(...history.map((item) => item.calories)),
        pace: history.reduce((prev, curr) => {
          const prevMinutes = parseInt(prev.pace.split('′')[0], 10) || 999;
          const currMinutes = parseInt(curr.pace.split('′')[0], 10) || 999;
          return currMinutes < prevMinutes ? curr : prev;
        }),
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

  const selectedDayWorkouts = selectedDateKey ? workoutsByDay[selectedDateKey] || [] : [];
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
      ? entries.reduce((best, item) => (parsePaceToMinutes(item.pace) < parsePaceToMinutes(best.pace) ? item : best))
      : null;
    return { distance, duration, calories, avgHr, activeDays, bestPaceWorkout };
  };

  const currentWeekSummary = summarizeWeek(currentWeekEntries);
  const previousWeekSummary = summarizeWeek(previousWeekEntries);
  const weeklyDistanceChange = previousWeekSummary.distance > 0
    ? ((currentWeekSummary.distance - previousWeekSummary.distance) / previousWeekSummary.distance) * 100
    : 0;
  const currentWeekMetLoad = Math.round(currentWeekEntries.reduce((sum, item) => sum + item.averageMETs * (item.duration / 60), 0));
  const previousWeekMetLoad = Math.round(previousWeekEntries.reduce((sum, item) => sum + item.averageMETs * (item.duration / 60), 0));
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
    ? history.reduce((best, item) => (parsePaceToMinutes(item.pace) < parsePaceToMinutes(best.pace) ? item : best))
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
  const recentAvgDistance = recentDistances.length > 0 ? recentDistances.reduce((sum, value) => sum + value, 0) / recentDistances.length : 0;
  const recentAvgHr = recentWorkouts.length > 0 ? recentWorkouts.reduce((sum, item) => sum + item.avgHeartRate, 0) / recentWorkouts.length : 0;
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

  const currentIntensityScore = workout ? getIntensityScore(workout, preferences) : 0;
  const avgIntensityScore = history.length > 0
    ? Math.round(history.reduce((sum, item) => sum + getIntensityScore(item, preferences), 0) / history.length)
    : 0;
  const peakIntensityWorkout = history.length > 0
    ? history.reduce((best, item) => (getIntensityScore(item, preferences) > getIntensityScore(best, preferences) ? item : best))
    : null;

  const currentEfficiency = workout ? getEfficiencyMetrics(workout) : null;
  const bestEfficiencyWorkout = history.length > 0
    ? history.reduce((best, item) => (getEfficiencyMetrics(item).score > getEfficiencyMetrics(best).score ? item : best))
    : null;

  const currentWarmup = workout ? getWarmupAnalysis(workout, lang) : null;
  const currentZoneProfile = workout ? getZoneProfile(workout, lang, preferences) : null;

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

  const getDayLoad = (distance: number, avgHr: number): DayLoadInfo => {
    const score = distance * 12 + Math.max(0, avgHr - 110) * 0.6;
    if (score >= 110) return { label: lang === 'ru' ? 'Высокая' : 'High', color: '#ff2d55', fill: 'linear-gradient(90deg, #ff9500 0%, #ff2d55 100%)', width: '100%' };
    if (score >= 70) return { label: lang === 'ru' ? 'Средняя' : 'Medium', color: '#ff9500', fill: 'linear-gradient(90deg, #ffd60a 0%, #ff9500 100%)', width: '68%' };
    return { label: lang === 'ru' ? 'Лёгкая' : 'Light', color: '#34c759', fill: 'linear-gradient(90deg, #34c759 0%, #30d158 100%)', width: '38%' };
  };

  const getWorkoutType = (item: WorkoutData): WorkoutTypeInfo => {
    if (item.avgHeartRate >= 150 || item.pace.includes('7′') || item.pace.includes('6′')) {
      return { short: lang === 'ru' ? 'ИНТ' : 'INT', label: lang === 'ru' ? 'Интенсивная' : 'Intensity', color: '#ff2d55' };
    }
    if (item.distance >= 8 || item.duration >= 3600) {
      return { short: lang === 'ru' ? 'ЛОНГ' : 'LONG', label: lang === 'ru' ? 'Длинная' : 'Long run', color: '#007aff' };
    }
    return { short: lang === 'ru' ? 'ЛЕГК' : 'EASY', label: lang === 'ru' ? 'Лёгкая' : 'Easy', color: '#34c759' };
  };

  const getSmartWorkoutLabels = (item: WorkoutData): SmartWorkoutLabel[] => {
    const labels: SmartWorkoutLabel[] = [];
    const zoneProfile = getZoneProfile(item, lang, preferences);
    const efficiency = getEfficiencyMetrics(item);
    const intensity = getIntensityScore(item, preferences);
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
      const load = entries.reduce((sum, item) => sum + item.distance * 12 + Math.max(0, item.avgHeartRate - 110) * 0.6 + getIntensityScore(item, preferences) * 0.22, 0);
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
      current: `${currentWeekEntries.filter((item) => getZoneProfile(item, lang, preferences).label.includes('Aerobic')).length} / 3`,
      progress: Math.min(100, Math.round((currentWeekEntries.filter((item) => getZoneProfile(item, lang, preferences).label.includes('Aerobic')).length / 3) * 100)),
      color: '#34c759',
      note: lang === 'ru' ? 'Полезно для базы и жиросжигания.' : 'Useful for base building and fat loss.',
    },
    {
      title: lang === 'ru' ? '2 восстановительных дня в неделю' : '2 recovery days per week',
      current: `${currentWeekEntries.filter((item) => getZoneProfile(item, lang, preferences).label.includes('Recovery')).length} / 2`,
      progress: Math.min(100, Math.round((currentWeekEntries.filter((item) => getZoneProfile(item, lang, preferences).label.includes('Recovery')).length / 2) * 100)),
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

  return {
    t,
    hrZonesData,
    prs,
    workoutsByDay,
    monthDays,
    selectedDayWorkouts,
    monthWorkoutEntries,
    monthDistance,
    monthCalories,
    monthActiveDays,
    monthAvgHr,
    orderedDayKeys,
    longestStreak,
    calendarWeekdays,
    currentWeekStart,
    currentWeekEnd,
    currentWeekEntries,
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
  };
}
