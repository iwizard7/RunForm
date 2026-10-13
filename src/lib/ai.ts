import { WorkoutData } from '@/lib/parser';
import { Language } from '@/lib/translations';

export type HealthFlag = {
  title: string;
  detail: string;
  severity: 'high' | 'medium';
  color: string;
};

export type StatusInfo = {
  label: string;
  color: string;
  detail?: string;
};

export type MetricExplainerKey =
  | 'metLoad'
  | 'intensityScore'
  | 'runningEfficiency'
  | 'zoneProfile'
  | 'weatherStress'
  | 'recoveryTrend'
  | 'fitnessIndex';

export type WorkoutAiReview = {
  summary: string;
  strengths: string[];
  risks: string[];
  goalFit: string;
  recommendation: string;
};

export type WeeklyCoach = {
  headline: string;
  summary: string;
  focus: string;
  recommendation: string;
  color: string;
};

export type NextResultPrediction = {
  distance: number;
  pace: number;
  avgHr: number;
  confidence: string;
  note: string;
};

export type MetricExplainer = {
  key: MetricExplainerKey;
  label: string;
  title: string;
  detail: string;
  why: string;
};

export type ExplainedFlag = HealthFlag & {
  why: string;
  action: string;
};

export type VersusSummary = {
  overall: string;
  coachTip: string;
  firstNotes: string[];
  secondNotes: string[];
  deepSummary: string;
};

export function parsePaceToMinutes(pace: string) {
  const normalized = pace.trim();
  const match = normalized.match(/(\d+)\s*[:'′]\s*(\d{1,2})/);

  if (match) {
    const minutes = Number.parseInt(match[1], 10) || 0;
    const seconds = Number.parseInt(match[2], 10) || 0;
    return minutes + seconds / 60;
  }

  const minutes = Number.parseInt(normalized.replace(/\D/g, ''), 10) || 0;
  const seconds = 0;
  return minutes + seconds / 60;
}

export function formatPaceMinutes(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return '—';
  }
  const mins = Math.floor(minutes);
  const secs = Math.round((minutes - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} min/km`;
}

export type UserPreferences = {
  hrZones: {
    z1: number;
    z2: number;
    z3: number;
    z4: number;
    z5: number;
  };
  thresholdPace: number; // minutes per km
  /** Lactate-threshold HR — drives HR-based training load; null = not set. */
  lthr?: number | null;
  /** Annual distance goal in kilometers; 0 = not set. */
  annualGoalKm?: number;
};

export const defaultPreferences: UserPreferences = {
  hrZones: {
    z1: 120,
    z2: 140,
    z3: 155,
    z4: 170,
    z5: 185,
  },
  thresholdPace: 5.0, // 5:00 min/km
  lthr: null,
  annualGoalKm: 0,
};

// The `prefs` argument is kept for API compatibility: personalised zones are
// applied on top of these scores elsewhere, not inside them.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getIntensityScore(item: WorkoutData, _prefs: UserPreferences = defaultPreferences) {
  const zone3 = item.zones.zone3?.rate ?? 0;
  const zone4 = item.zones.zone4?.rate ?? 0;
  const zone5 = (item.zones.zone5?.rate ?? 0) || (item.zones.peak?.rate ?? 0);
  
  const hrvBonus = item.hrv ? Math.max(0, (item.hrv - 40) * 0.1) : 0;
  
  const zoneBoost = (zone3 * 18) + (zone4 * 30) + (zone5 * 45);
  return Math.round(
    (item.averageIntensity * 0.45) +
    (item.maxIntensity * 0.2) +
    (item.averageMETs * 4.5) +
    zoneBoost - hrvBonus
  );
}

export function getEfficiencyMetrics(item: WorkoutData) {
  const paceMinutes = parsePaceToMinutes(item.pace);
  const metersPerBeat = item.avgHeartRate > 0 ? Number((1000 / (item.avgHeartRate * Math.max(paceMinutes, 0.1))).toFixed(3)) : 0;
  const strideLength = item.steps > 0 ? Math.round((item.distance * 100000) / item.steps) : 0;
  const cadenceBand = item.cadence >= 170 ? 100 : Math.max(0, Math.round((item.cadence / 170) * 100));
  const hrEconomy = item.avgHeartRate > 0 ? Math.max(0, Math.min(100, Math.round((180 - item.avgHeartRate) * 1.5))) : 0;
  const paceScore = Math.max(0, Math.min(100, Math.round((6 / Math.max(paceMinutes, 0.1)) * 100)));
  const score = Math.round((cadenceBand * 0.3) + (hrEconomy * 0.25) + (paceScore * 0.25) + (Math.min(strideLength, 150) / 150) * 20);
  return { metersPerBeat, strideLength, cadenceBand, hrEconomy, score };
}

export function getWarmupAnalysis(item: WorkoutData, lang: Language) {
  const warmupSeconds = item.zones.zone1?.time.value ?? 0;
  const warmupRate = item.zones.zone1?.rate ?? 0;
  const heartRateRange = Math.max(1, item.maxHeartRate - item.minHeartRate);
  const controlScore = Math.max(0, Math.min(100, Math.round((warmupRate * 100) + ((120 - item.minHeartRate) * 0.8) + ((heartRateRange < 55 ? 1 : 0) * 12))));
  const label = controlScore >= 70
    ? (lang === 'ru' ? 'Разминка качественная' : 'Warmup looks solid')
    : controlScore >= 45
      ? (lang === 'ru' ? 'Разминка средняя' : 'Warmup is moderate')
      : (lang === 'ru' ? 'Разминка слабая' : 'Warmup looks short');
  return { warmupSeconds, warmupRate, controlScore, label };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getZoneProfile(item: WorkoutData, lang: Language, _prefs: UserPreferences = defaultPreferences) {
  const z1 = item.zones.zone1?.rate ?? 0;
  const z2 = item.zones.zone2?.rate ?? 0;
  const z3 = item.zones.zone3?.rate ?? 0;
  const z4 = item.zones.zone4?.rate ?? 0;
  const z5 = (item.zones.zone5?.rate ?? 0) || (item.zones.peak?.rate ?? 0);

  if (z5 > 0.1 || z4 + z5 >= 0.25) {
    return { label: lang === 'ru' ? 'Anaerobic / Capacity' : 'Anaerobic / Capacity', detail: lang === 'ru' ? 'Значительная работа на пределе пульса.' : 'Significant work at heart-rate limits.', color: '#ff2d55' };
  }
  if (z4 >= 0.18 || z3 + z4 >= 0.7) {
    return { label: lang === 'ru' ? 'Hard / Threshold' : 'Hard / Threshold', detail: lang === 'ru' ? 'Большая доля времени в тяжёлых зонах.' : 'Large share of time in harder zones.', color: '#ff2d55' };
  }
  if (z2 >= 0.45 && z3 < 0.35) {
    return { label: lang === 'ru' ? 'Aerobic Base' : 'Aerobic Base', detail: lang === 'ru' ? 'Основная работа идёт в аэробной зоне.' : 'Most work happens in the aerobic zone.', color: '#34c759' };
  }
  if (z1 >= 0.35 && z2 <= 0.35) {
    return { label: lang === 'ru' ? 'Recovery' : 'Recovery', detail: lang === 'ru' ? 'Тренировка выглядит восстановительной.' : 'This session looks recovery-oriented.', color: '#007aff' };
  }
  return { label: lang === 'ru' ? 'Mixed Session' : 'Mixed Session', detail: lang === 'ru' ? 'Нагрузка смешанная без ярко выраженного профиля.' : 'Mixed load without one dominant profile.', color: '#ff9500' };
}

export function getHrvAnalysis(hrv: number | undefined, lang: Language) {
  if (!hrv) return null;
  const status = hrv >= 65 
    ? (lang === 'ru' ? 'Отлично' : 'Excellent')
    : hrv >= 45
      ? (lang === 'ru' ? 'Норма' : 'Normal')
      : (lang === 'ru' ? 'Низкая (усталость)' : 'Low (fatigue)');
  
  const color = hrv >= 65 ? '#34c759' : hrv >= 45 ? '#007aff' : '#ff2d55';
  
  return { value: hrv, status, color };
}

export function parseWeatherNumber(value: string) {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

export function getWeatherStress(weather: WorkoutData['weather']) {
  const temperature = parseWeatherNumber(weather.temperature);
  const humidity = parseWeatherNumber(weather.humidity);
  const stress = (humidity ?? 50) * 0.35 + (temperature !== null ? Math.abs(temperature) * 1.4 : 0);
  return {
    temperature,
    humidity,
    stress: Math.round(stress),
  };
}

export function buildWorkoutAiReview(params: {
  workout: WorkoutData | null;
  currentEfficiency: ReturnType<typeof getEfficiencyMetrics> | null;
  currentWarmup: ReturnType<typeof getWarmupAnalysis> | null;
  currentZoneProfile: ReturnType<typeof getZoneProfile> | null;
  weatherStress: number;
  currentIntensityScore: number;
  avgIntensityScore: number;
  healthFlags: HealthFlag[];
  lang: Language;
}): WorkoutAiReview | null {
  const {
    workout,
    currentEfficiency,
    currentWarmup,
    currentZoneProfile,
    weatherStress,
    currentIntensityScore,
    avgIntensityScore,
    healthFlags,
    lang,
  } = params;

  if (!workout || !currentEfficiency || !currentWarmup || !currentZoneProfile) {
    return null;
  }

  const strengths: string[] = [];
  const risks: string[] = [];
  if (currentEfficiency.score >= 72) {
    strengths.push(lang === 'ru' ? 'Экономичность выглядит сильной: темп и пульс сбалансированы.' : 'Efficiency looks strong: pace and heart rate are well balanced.');
  }
  if (currentZoneProfile.label.includes('Aerobic') || currentZoneProfile.label.includes('Recovery')) {
    strengths.push(lang === 'ru' ? 'Профиль по зонам выглядит контролируемым и аэробным.' : 'Zone profile looks controlled and aerobic.');
  }
  if (weatherStress >= 38) {
    risks.push(lang === 'ru' ? 'Погодная нагрузка могла завысить пульс и снизить качество темпа.' : 'Weather stress may have inflated heart rate and reduced pace quality.');
  }
  if (currentIntensityScore > avgIntensityScore + 12) {
    risks.push(lang === 'ru' ? 'Интенсивность выше твоего среднего уровня, восстановление важно.' : 'Intensity is above your normal baseline, so recovery matters.');
  }
  if (currentWarmup.controlScore < 45) {
    risks.push(lang === 'ru' ? 'Разминка выглядела короткой или рваной.' : 'Warmup looked short or uneven.');
  }

  const goalFit = currentZoneProfile.label.includes('Aerobic')
    ? (lang === 'ru' ? 'Лучше всего подходит под выносливость и жиросжигание.' : 'Best aligned with endurance and fat-loss goals.')
    : currentZoneProfile.label.includes('Hard')
      ? (lang === 'ru' ? 'Больше подходит под скорость, чем под восстановление.' : 'More aligned with speed than recovery.')
      : (lang === 'ru' ? 'Нейтральная сессия, ближе к поддерживающей работе.' : 'Neutral session, closer to maintenance work.');

  const summary = currentIntensityScore >= avgIntensityScore
    ? (lang === 'ru' ? 'Текущая тренировка была рабочей и достаточно плотной по нагрузке.' : 'This workout was productive and carried a solid load.')
    : (lang === 'ru' ? 'Текущая тренировка выглядит легче твоего среднего профиля.' : 'This workout looks lighter than your average profile.');

  const recommendation = currentIntensityScore >= avgIntensityScore + 15 || healthFlags.length > 0
    ? (lang === 'ru' ? 'Следующую сессию лучше держать проще: Z1-Z2, без тяжёлых ускорений.' : 'Keep the next session easier: Z1-Z2, no hard surges.')
    : (lang === 'ru' ? 'Можно продолжать строить объём, но без резкого скачка нагрузки.' : 'You can keep building volume, but avoid a sharp jump in load.');

  return { summary, strengths, risks, goalFit, recommendation };
}

export function buildWeeklyCoach(params: {
  historyLength: number;
  currentWeekDistance: number;
  currentWeekActiveDays: number;
  currentWeekMetLoad: number;
  weeklyLoadStatus: StatusInfo;
  weeklyRecoveryStatus: StatusInfo;
  weeklyDistanceChange: number;
  healthFlags: HealthFlag[];
  lang: Language;
}): WeeklyCoach | null {
  const {
    historyLength,
    currentWeekDistance,
    currentWeekActiveDays,
    currentWeekMetLoad,
    weeklyLoadStatus,
    weeklyRecoveryStatus,
    weeklyDistanceChange,
    healthFlags,
    lang,
  } = params;

  if (historyLength === 0) {
    return null;
  }

  const summary = lang === 'ru'
    ? `Неделя дала ${currentWeekDistance.toFixed(1)} км, ${currentWeekActiveDays} активных дней и ${currentWeekMetLoad} MET-load.`
    : `This week delivered ${currentWeekDistance.toFixed(1)} km, ${currentWeekActiveDays} active days, and ${currentWeekMetLoad} MET load.`;

  const recommendation = weeklyDistanceChange > 20 || healthFlags.length > 1
    ? (lang === 'ru' ? 'Следующую неделю стоит начать с более мягкого дня и контролировать пульс.' : 'Start the next week with an easier day and monitor heart rate closely.')
    : weeklyDistanceChange < -20
      ? (lang === 'ru' ? 'Можно аккуратно вернуть объём, но без резкого скачка.' : 'You can carefully rebuild volume, but avoid a sudden jump.')
      : (lang === 'ru' ? 'Неделя выглядит устойчивой, можно продолжать текущую структуру.' : 'The week looks stable, so you can continue the current structure.');

  return {
    headline: weeklyLoadStatus.label,
    summary,
    focus: weeklyRecoveryStatus.label,
    recommendation,
    color: weeklyLoadStatus.color,
  };
}

export function buildExplainedFlags(flags: HealthFlag[], lang: Language): ExplainedFlag[] {
  return flags.map((flag) => ({
    ...flag,
    why: flag.title.includes(lang === 'ru' ? 'Пульс' : 'Heart rate')
      ? (lang === 'ru' ? 'Этот сигнал говорит, что стоимость усилия по пульсу стала выше, чем должна быть для такого объёма или темпа.' : 'This signal means the heart-rate cost of the effort is higher than expected for that pace or distance.')
      : flag.title.includes(lang === 'ru' ? 'Объём' : 'Volume')
        ? (lang === 'ru' ? 'Резкое падение объёма само по себе не опасно, но ломает ритм прогресса и может искажать оценку формы.' : 'A sharp drop in volume is not dangerous by itself, but it breaks training rhythm and distorts form trends.')
        : (lang === 'ru' ? 'Сигнал показывает, что организму может не хватать восстановления между тяжёлыми днями.' : 'The signal suggests the body may not be recovering enough between hard sessions.'),
    action: flag.severity === 'high'
      ? (lang === 'ru' ? 'Следующая сессия должна быть восстановительной или короткой аэробной.' : 'The next session should be recovery-oriented or a short aerobic run.')
      : (lang === 'ru' ? 'Стоит внимательно смотреть на пульс и самочувствие в ближайшие 1-2 тренировки.' : 'Watch heart rate and perceived effort closely over the next 1-2 sessions.')
  }));
}

export function buildNextResultPrediction(params: {
  history: WorkoutData[];
  healthFlags: HealthFlag[];
  weeklyDistanceChange: number;
  weeklyRecoveryStatus: StatusInfo;
  weeklyLoadStatus: StatusInfo;
  lang: Language;
}): NextResultPrediction | null {
  const { history, healthFlags, weeklyDistanceChange, weeklyRecoveryStatus, weeklyLoadStatus, lang } = params;
  const predictionBase = history.slice(0, 5);
  if (predictionBase.length === 0) {
    return null;
  }

  const avgDistance = predictionBase.reduce((sum, item) => sum + item.distance, 0) / predictionBase.length;
  const avgPaceMinutes = predictionBase.reduce((sum, item) => sum + parsePaceToMinutes(item.pace), 0) / predictionBase.length;
  const avgHr = Math.round(predictionBase.reduce((sum, item) => sum + item.avgHeartRate, 0) / predictionBase.length);
  const loadPenalty = healthFlags.length > 1 || weeklyDistanceChange > 30 ? 0.25 : 0;
  const recoveryBonus = weeklyRecoveryStatus.label.includes(lang === 'ru' ? 'улучшается' : 'improving') ? -0.12 : 0;
  const paceAdjustment = loadPenalty + recoveryBonus;
  const predictedPace = avgPaceMinutes + paceAdjustment;
  const predictedDistance = Math.max(3, avgDistance + (weeklyLoadStatus.label.includes(lang === 'ru' ? 'Недогрузка' : 'Underload') ? 0.4 : -0.1));
  const confidence = predictionBase.length >= 4 ? (lang === 'ru' ? 'Хорошая' : 'Good') : (lang === 'ru' ? 'Средняя' : 'Moderate');
  const note = healthFlags.length > 0
    ? (lang === 'ru' ? 'Прогноз немного консервативный из-за сигналов по восстановлению/нагрузке.' : 'The forecast is slightly conservative because of recovery/load signals.')
    : (lang === 'ru' ? 'Прогноз опирается на последние 5 тренировок и текущий недельный фон.' : 'The forecast is based on the latest 5 workouts and the current weekly context.');

  return {
    distance: predictedDistance,
    pace: predictedPace,
    avgHr,
    confidence,
    note,
  };
}

export function buildMetricExplainers(params: {
  lang: Language;
  currentWeekMetLoad: number;
  currentIntensityScore: number;
  avgIntensityScore: number;
  currentEfficiencyScore: number;
  currentZoneProfileLabel: string;
  weatherStress: number;
  weeklyRecoveryStatus: StatusInfo;
  fitnessIndexValue: number;
  fitnessIndexLabel: string;
}): MetricExplainer[] {
  const {
    lang,
    currentWeekMetLoad,
    currentIntensityScore,
    avgIntensityScore,
    currentEfficiencyScore,
    currentZoneProfileLabel,
    weatherStress,
    weeklyRecoveryStatus,
    fitnessIndexValue,
    fitnessIndexLabel,
  } = params;

  return [
    {
      key: 'metLoad',
      label: 'MET-load',
      title: lang === 'ru' ? 'MET-load показывает общий энергетический объём недели.' : 'MET load shows the total energetic volume of the week.',
      detail: lang === 'ru'
        ? `Сейчас у тебя ${currentWeekMetLoad}. Это полезно, когда километраж не отражает реальную тяжесть недели.`
        : `You are currently at ${currentWeekMetLoad}. It is useful when distance alone does not reflect how hard the week actually was.`,
      why: lang === 'ru' ? 'Чем выше MET-load, тем аккуратнее нужно дозировать следующую интенсивную сессию.' : 'The higher the MET load, the more carefully you should dose the next hard session.',
    },
    {
      key: 'intensityScore',
      label: 'Intensity Score',
      title: lang === 'ru' ? 'Intensity Score оценивает, насколько тяжёлой была конкретная тренировка.' : 'Intensity Score estimates how hard a specific workout was.',
      detail: lang === 'ru'
        ? `Сейчас у тебя ${currentIntensityScore}, а средний по истории ${avgIntensityScore}. В расчёт входят intensity, METs и тяжёлые пульсовые зоны.`
        : `Your current score is ${currentIntensityScore}, versus a historical average of ${avgIntensityScore}. It uses intensity, METs, and harder heart-rate zones.`,
      why: lang === 'ru' ? 'Метрика нужна, чтобы не сравнивать по километрам лёгкий бег и реально тяжёлую работу как одинаковые сессии.' : 'This helps avoid treating an easy long run and a truly hard session as the same workload.',
    },
    {
      key: 'runningEfficiency',
      label: 'Running Efficiency',
      title: lang === 'ru' ? 'Running Efficiency связывает темп, пульс, каденс и длину шага.' : 'Running Efficiency connects pace, heart rate, cadence, and stride length.',
      detail: lang === 'ru'
        ? `Текущий score: ${currentEfficiencyScore}. Если он растёт, ты бежишь быстрее или экономичнее при той же физиологической цене.`
        : `Current score: ${currentEfficiencyScore}. If it rises, you are running faster or more economically for the same physiological cost.`,
      why: lang === 'ru' ? 'Это одна из самых полезных метрик для отслеживания реального бегового прогресса.' : 'This is one of the most useful metrics for tracking real running progress.',
    },
    {
      key: 'zoneProfile',
      label: 'Zone Profile',
      title: lang === 'ru' ? 'Zone Profile объясняет характер тренировки по распределению времени в зонах.' : 'Zone Profile explains the character of a workout from time spent in zones.',
      detail: lang === 'ru'
        ? `Текущий профиль: ${currentZoneProfileLabel || '—'}. Он помогает понять, была тренировка восстановительной, аэробной или тяжёлой.`
        : `Current profile: ${currentZoneProfileLabel || '—'}. It helps identify whether the workout was recovery-oriented, aerobic, or hard.`,
      why: lang === 'ru' ? 'Это удобно, когда название тренировки не отражает её реальный физиологический тип.' : 'This is useful when the workout name does not reflect its real physiological type.',
    },
    {
      key: 'weatherStress',
      label: 'Weather Stress',
      title: lang === 'ru' ? 'Weather Stress учитывает температуру и влажность как дополнительную нагрузку.' : 'Weather Stress treats temperature and humidity as extra load.',
      detail: lang === 'ru'
        ? `Текущее значение: ${weatherStress}. Это нужно, чтобы не считать жаркий или влажный день признаком плохой формы.`
        : `Current value: ${weatherStress}. It helps avoid interpreting a hot or humid day as poor fitness.`,
      why: lang === 'ru' ? 'Высокий пульс в плохих условиях не всегда означает плохую тренировку.' : 'High heart rate in tough conditions does not always mean a bad workout.',
    },
    {
      key: 'recoveryTrend',
      label: lang === 'ru' ? 'Recovery Trend' : 'Recovery Trend',
      title: lang === 'ru' ? 'Recovery Trend сравнивает свежий фон пульса с предыдущей неделей.' : 'Recovery Trend compares recent heart-rate background against the previous week.',
      detail: lang === 'ru'
        ? `Сейчас статус: ${weeklyRecoveryStatus.label}. Это не медицинский показатель, а быстрый индикатор утомления.`
        : `Current status: ${weeklyRecoveryStatus.label}. It is not a medical metric, but a quick fatigue indicator.`,
      why: lang === 'ru' ? 'Он помогает понять, тянуть ли план вверх или наоборот убрать интенсивность.' : 'It helps decide whether to push the plan forward or reduce intensity.',
    },
    {
      key: 'fitnessIndex',
      label: lang === 'ru' ? 'Индекс формы' : 'Fitness Index',
      title: lang === 'ru' ? 'Индекс формы собирает частоту, объём, темп, пульс и стабильность в один score.' : 'Fitness Index combines frequency, volume, pace, heart rate, and stability into one score.',
      detail: lang === 'ru'
        ? `Сейчас индекс: ${fitnessIndexValue} (${fitnessIndexLabel}). Это быстрый взгляд на общую форму, а не замена детальной аналитике.`
        : `Current index: ${fitnessIndexValue} (${fitnessIndexLabel}). It is a quick overall snapshot, not a replacement for detailed analysis.`,
      why: lang === 'ru' ? 'Удобен как верхнеуровневый индикатор, чтобы быстро видеть общий тренд.' : 'It is useful as a high-level indicator for spotting the overall trend quickly.',
    },
  ];
}

export function buildVersusSummary(params: {
  selectedWorkouts: WorkoutData[];
  lang: Language;
}): VersusSummary | null {
  const { selectedWorkouts, lang } = params;
  if (selectedWorkouts.length !== 2) return null;
  const [first, second] = selectedWorkouts;
  const firstEfficiency = getEfficiencyMetrics(first);
  const secondEfficiency = getEfficiencyMetrics(second);
  const firstIntensity = getIntensityScore(first);
  const secondIntensity = getIntensityScore(second);
  const firstZone = getZoneProfile(first, lang);
  const secondZone = getZoneProfile(second, lang);
  const firstWeatherStress = getWeatherStress(first.weather).stress;
  const secondWeatherStress = getWeatherStress(second.weather).stress;
  const faster = parsePaceToMinutes(first.pace) < parsePaceToMinutes(second.pace) ? first : second;
  const moreEfficient = first.avgHeartRate < second.avgHeartRate && first.distance >= second.distance ? first : second;
  const higherLoad = first.avgHeartRate + first.distance * 6 > second.avgHeartRate + second.distance * 6 ? first : second;
  const firstNotes: string[] = [];
  const secondNotes: string[] = [];

  if (faster.uuid === first.uuid) {
    firstNotes.push(lang === 'ru' ? 'Быстрее по темпу' : 'Faster pace');
    secondNotes.push(lang === 'ru' ? 'Темп слабее' : 'Slower pace');
  } else {
    secondNotes.push(lang === 'ru' ? 'Быстрее по темпу' : 'Faster pace');
    firstNotes.push(lang === 'ru' ? 'Темп слабее' : 'Slower pace');
  }

  if (moreEfficient.uuid === first.uuid) {
    firstNotes.push(lang === 'ru' ? 'Лучше экономичность по пульсу' : 'Better heart-rate efficiency');
  } else {
    secondNotes.push(lang === 'ru' ? 'Лучше экономичность по пульсу' : 'Better heart-rate efficiency');
  }

  if (higherLoad.uuid === first.uuid) {
    firstNotes.push(lang === 'ru' ? 'Выше общая нагрузка' : 'Higher total load');
  } else {
    secondNotes.push(lang === 'ru' ? 'Выше общая нагрузка' : 'Higher total load');
  }

  if (firstEfficiency.score > secondEfficiency.score) {
    firstNotes.push(lang === 'ru' ? 'Лучше общий score эффективности' : 'Better overall efficiency score');
  } else if (secondEfficiency.score > firstEfficiency.score) {
    secondNotes.push(lang === 'ru' ? 'Лучше общий score эффективности' : 'Better overall efficiency score');
  }

  if (firstIntensity > secondIntensity) {
    firstNotes.push(lang === 'ru' ? 'Более высокая реальная интенсивность' : 'Higher real intensity');
  } else if (secondIntensity > firstIntensity) {
    secondNotes.push(lang === 'ru' ? 'Более высокая реальная интенсивность' : 'Higher real intensity');
  }

  if (firstWeatherStress < secondWeatherStress) {
    firstNotes.push(lang === 'ru' ? 'Лучше условия среды' : 'Friendlier weather conditions');
  } else if (secondWeatherStress < firstWeatherStress) {
    secondNotes.push(lang === 'ru' ? 'Лучше условия среды' : 'Friendlier weather conditions');
  }

  const overall = lang === 'ru'
    ? `${faster.name} ${new Date(faster.startDate).toLocaleDateString('ru-RU')} выглядит сильнее по скорости, а ${moreEfficient.name} ${new Date(moreEfficient.startDate).toLocaleDateString('ru-RU')} эффективнее по соотношению темпа и пульса. По глубинным метрикам профили тоже различаются: первая сессия = ${firstZone.label}, вторая = ${secondZone.label}.`
    : `${faster.name} on ${new Date(faster.startDate).toLocaleDateString('en-US')} looks stronger on speed, while ${moreEfficient.name} on ${new Date(moreEfficient.startDate).toLocaleDateString('en-US')} is more efficient on pace versus heart rate. Deep metrics also show different profiles: first session = ${firstZone.label}, second = ${secondZone.label}.`;

  const coachTip = higherLoad.avgHeartRate >= 145
    ? (lang === 'ru' ? 'Нагрузка высокая, следующую сессию лучше держать проще для восстановления.' : 'Load is high, so the next session should likely stay easier for recovery.')
    : (lang === 'ru' ? 'Можно ориентироваться на более сильную тренировку как на новый базовый ориентир.' : 'You can use the stronger workout as the new baseline reference.');

  const deepSummary = `Intensity: ${firstIntensity} vs ${secondIntensity}. Efficiency: ${firstEfficiency.score} vs ${secondEfficiency.score}. Weather stress: ${firstWeatherStress} vs ${secondWeatherStress}.`;

  return { overall, coachTip, firstNotes, secondNotes, deepSummary };
}
