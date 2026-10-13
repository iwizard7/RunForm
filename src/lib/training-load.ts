import type { WorkoutData } from './parser';
import { getDateKey } from './home-metrics';

/**
 * Training form: load (TSS-like), CTL/ATL/TSB, streaks, annual goal, readiness.
 *
 * Everything here is pure and client-side — the same `history` array the
 * dashboard already has is the only input, so the charts update instantly and
 * nothing leaves the machine. The load model follows the classic Banister
 * impulse-response: each workout scores ~100 points per hour at threshold
 * effort, and CTL/ATL are exponentially weighted moving averages over 42 and
 * 7 days respectively.
 */

/** The minimal slice of a workout the load math needs — easy to test. */
export type LoadWorkout = Pick<
  WorkoutData,
  'startDate' | 'duration' | 'avgHeartRate' | 'averageIntensity'
>;

export type StreakWorkout = Pick<WorkoutData, 'startDate'>;
export type VolumeWorkout = Pick<WorkoutData, 'startDate' | 'distance'>;
export type HeatmapWorkout = Pick<
  WorkoutData,
  'startDate' | 'distance' | 'duration' | 'avgHeartRate' | 'averageIntensity'
>;
export type ReadinessWorkout = Pick<WorkoutData, 'startDate' | 'hrv' | 'minHeartRate'>;

export type LoadOptions = {
  /** Lactate-threshold HR; when set, intensity derives from actual heart rate. */
  lthr?: number | null;
  /** Length of the returned window in days (default 90). */
  days?: number;
  /** Window end — injectable for deterministic tests (default: today). */
  endDate?: Date;
};

export type LoadPoint = {
  date: string; // YYYY-MM-DD
  /** Load accumulated on that day (0 for rest days). */
  load: number;
  /** Chronic training load — long-term fitness (42-day EWMA). */
  ctl: number;
  /** Acute training load — short-term fatigue (7-day EWMA). */
  atl: number;
  /** Training stress balance: CTL − ATL. Negative = fatigued. */
  tsb: number;
};

export type Streaks = {
  dayCurrent: number;
  dayLongest: number;
  weekCurrent: number;
  weekLongest: number;
};

export type HeatmapCell = {
  dateKey: string;
  load: number;
  distanceKm: number;
  inYear: boolean;
};

export type AnnualGoal = {
  goalKm: number;
  doneKm: number;
  percent: number;
  daysLeft: number;
  weeksLeft: number;
  neededPerWeek: number;
  /** Weekly volume over the last 28 days — the basis of the projection. */
  recentWeeklyKm: number;
  projectedKm: number;
  onTrack: boolean;
};

export type Readiness = {
  /** Recent HRV vs the 28-day baseline, in percent. */
  hrvIndex: number;
  baselineHrv: number;
  recentHrv: number;
  /** Resting-HR shift vs baseline in bpm (positive = worse); null without data. */
  restHrDelta: number | null;
  status: 'ready' | 'normal' | 'recovering';
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Effort factor of one workout in threshold units (1.0 = threshold effort).
 *
 * Heart rate wins when the user configured an LTHR and the workout recorded
 * a pulse. The intensity fallback is defensive: Apple Health uses a 0..1
 * scale while some exports carry 1..10 zone-like numbers, so both are mapped
 * into the same usable range.
 */
export function intensityFactor(item: LoadWorkout, lthr?: number | null): number {
  if (lthr && lthr > 0 && item.avgHeartRate > 0) {
    return clamp(item.avgHeartRate / lthr, 0.5, 1.3);
  }
  if (item.averageIntensity > 0) {
    const normalized = item.averageIntensity <= 1 ? item.averageIntensity : item.averageIntensity / 10;
    return clamp(0.55 + normalized * 0.45, 0.5, 1.2);
  }
  return 0.7;
}

/**
 * TSS-like score: hours × intensity² × 100. A one-hour run at threshold
 * effort scores exactly 100 points.
 */
export function computeWorkoutLoad(item: LoadWorkout, lthr?: number | null): number {
  const factor = intensityFactor(item, lthr);
  return (item.duration / 3600) * factor * factor * 100;
}

function computeDailyLoads(workouts: LoadWorkout[], lthr?: number | null): Map<string, number> {
  const loads = new Map<string, number>();
  for (const item of workouts) {
    const key = getDateKey(new Date(item.startDate));
    loads.set(key, (loads.get(key) ?? 0) + computeWorkoutLoad(item, lthr));
  }
  return loads;
}

/**
 * CTL/ATL/TSB series for the last `days` days.
 *
 * The recursion is warmed up 84 days before the window (two CTL constants)
 * so the first visible points are already settled; the warm-up is capped at
 * 400 days for sparse histories.
 */
export function computeLoadSeries(workouts: LoadWorkout[], options: LoadOptions = {}): LoadPoint[] {
  const days = options.days ?? 90;
  const end = new Date(options.endDate ?? new Date());
  end.setHours(0, 0, 0, 0);

  const daily = computeDailyLoads(workouts, options.lthr);

  const windowStart = new Date(end);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const warmStart = new Date(windowStart);
  warmStart.setDate(warmStart.getDate() - 84);
  const earliestKey = [...daily.keys()].sort()[0];
  if (earliestKey) {
    const earliest = new Date(`${earliestKey}T00:00:00`);
    if (earliest < warmStart) warmStart.setTime(earliest.getTime());
  }
  const cap = new Date(windowStart);
  cap.setDate(cap.getDate() - 400);
  if (warmStart < cap) warmStart.setTime(cap.getTime());

  const alphaAtl = 1 - Math.exp(-1 / 7);
  const alphaCtl = 1 - Math.exp(-1 / 42);

  const series: LoadPoint[] = [];
  let atl = 0;
  let ctl = 0;
  const cursor = new Date(warmStart);

  while (cursor.getTime() <= end.getTime()) {
    const key = getDateKey(cursor);
    const load = daily.get(key) ?? 0;
    atl = load * alphaAtl + atl * (1 - alphaAtl);
    ctl = load * alphaCtl + ctl * (1 - alphaCtl);
    if (cursor.getTime() >= windowStart.getTime()) {
      series.push({
        date: key,
        load: round1(load),
        ctl: round1(ctl),
        atl: round1(atl),
        tsb: round1(ctl - atl),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return series;
}

/** Monday-start week key, the same convention as the calendar. */
function weekStartKey(date: Date): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return getDateKey(copy);
}

function addDaysKey(base: Date, days: number, shift: number): string {
  const copy = new Date(base);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + days + shift);
  return getDateKey(copy);
}

function longestRun(sortedKeys: string[], stepDays: number): number {
  let best = 0;
  let run = 0;
  for (let index = 0; index < sortedKeys.length; index += 1) {
    if (index === 0) {
      run = 1;
    } else {
      const expected = addDaysKey(new Date(`${sortedKeys[index - 1]}T00:00:00`), stepDays, 0);
      run = expected === sortedKeys[index] ? run + 1 : 1;
    }
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Day and week streaks. A day streak needs a run every calendar day; a week
 * streak needs at least one workout per consecutive Monday-based week. The
 * current streak stays alive if today (this week) is active, or if the last
 * active unit was yesterday (last week still in progress counts as alive only
 * when the current week itself has a workout).
 */
export function computeStreaks(workouts: StreakWorkout[], today = new Date()): Streaks {
  const dayKeys = [...new Set(workouts.map((item) => getDateKey(new Date(item.startDate))))].sort();
  const weekKeys = [...new Set(workouts.map((item) => weekStartKey(new Date(item.startDate))))].sort();

  if (dayKeys.length === 0) {
    return { dayCurrent: 0, dayLongest: 0, weekCurrent: 0, weekLongest: 0 };
  }

  // Day streak: alive when the latest workout is today or yesterday.
  const todayKey = getDateKey(today);
  const yesterdayKey = addDaysKey(today, 0, -1);
  let dayCurrent = 0;
  if (dayKeys[dayKeys.length - 1] === todayKey || dayKeys[dayKeys.length - 1] === yesterdayKey) {
    dayCurrent = 1;
    for (let index = dayKeys.length - 2; index >= 0; index -= 1) {
      const next = addDaysKey(new Date(`${dayKeys[index]}T00:00:00`), 1, 0);
      if (next !== dayKeys[index + 1]) break;
      dayCurrent += 1;
    }
  }

  // Week streak: alive only while the current week itself has a workout.
  const currentWeekKey = weekStartKey(today);
  let weekCurrent = 0;
  if (weekKeys[weekKeys.length - 1] === currentWeekKey) {
    weekCurrent = 1;
    for (let index = weekKeys.length - 2; index >= 0; index -= 1) {
      const next = addDaysKey(new Date(`${weekKeys[index]}T00:00:00`), 7, 0);
      if (next !== weekKeys[index + 1]) break;
      weekCurrent += 1;
    }
  }

  return {
    dayCurrent,
    dayLongest: longestRun(dayKeys, 1),
    weekCurrent,
    weekLongest: longestRun(weekKeys, 7),
  };
}

/**
 * GitHub-style year grid: one column per Monday-based week, Monday on top.
 * Cells outside the requested year are marked `inYear: false` so the UI can
 * dim them.
 */
export function buildYearHeatmap(
  workouts: HeatmapWorkout[],
  lthr: number | null | undefined,
  year: number,
): HeatmapCell[][] {
  const daily = computeDailyLoads(workouts, lthr);
  const distanceByDay = new Map<string, number>();
  for (const item of workouts) {
    const key = getDateKey(new Date(item.startDate));
    distanceByDay.set(key, (distanceByDay.get(key) ?? 0) + item.distance);
  }

  const first = new Date(`${year}-01-01T00:00:00`);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
  const last = new Date(`${year}-12-31T00:00:00`);
  const gridEnd = new Date(last);
  gridEnd.setDate(gridEnd.getDate() + (7 - ((gridEnd.getDay() + 6) % 7)) - 1);

  const weeks: HeatmapCell[][] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const week: HeatmapCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const cellDate = new Date(cursor);
      cellDate.setDate(cellDate.getDate() + day);
      const dateKey = getDateKey(cellDate);
      week.push({
        dateKey,
        load: round1(daily.get(dateKey) ?? 0),
        distanceKm: round1(distanceByDay.get(dateKey) ?? 0),
        inYear: cellDate.getFullYear() === year,
      });
    }
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

/**
 * Annual distance goal: progress, weekly pace needed, and a projection from
 * the last 28 days of volume. Returns null when no goal is configured.
 */
export function computeAnnualGoal(
  workouts: VolumeWorkout[],
  goalKm: number,
  today = new Date(),
): AnnualGoal | null {
  if (!goalKm || goalKm <= 0) return null;

  const year = today.getFullYear();
  const yearEnd = new Date(`${year}-12-31T00:00:00`);

  let doneKm = 0;
  let recentKm = 0;
  const recentStart = new Date(today);
  recentStart.setDate(recentStart.getDate() - 27);

  for (const item of workouts) {
    const date = new Date(item.startDate);
    if (date.getFullYear() === year) doneKm += item.distance;
    if (date.getTime() >= recentStart.getTime() && date.getTime() <= yearEnd.getTime()) recentKm += item.distance;
  }

  const daysLeft = Math.round((yearEnd.getTime() - today.getTime()) / 86400000) + 1;
  const weeksLeft = daysLeft / 7;
  const recentWeeklyKm = recentKm / 4;
  const projectedKm = doneKm + recentWeeklyKm * weeksLeft;

  return {
    goalKm,
    doneKm: round1(doneKm),
    percent: Math.min(100, Math.round((doneKm / goalKm) * 100)),
    daysLeft,
    weeksLeft: round1(weeksLeft),
    neededPerWeek: round1(Math.max(0, (goalKm - doneKm) / weeksLeft)),
    recentWeeklyKm: round1(recentWeeklyKm),
    projectedKm: round1(projectedKm),
    onTrack: projectedKm >= goalKm,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Readiness from HRV: recent 7-day average against the 28-day baseline
 * (excluding the last 7 days from the baseline so the comparison stays
 * honest), plus the shift of the lowest recorded pulse as a resting-HR
 * proxy. Null when the history holds too few HRV samples to say anything.
 */
export function computeReadiness(
  workouts: ReadinessWorkout[],
  today = new Date(),
): Readiness | null {
  const dayMs = 86400000;
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  const baselineFrom = new Date(end.getTime() - 28 * dayMs);
  const baselineTo = new Date(end.getTime() - 7 * dayMs);

  const baselineHrv: number[] = [];
  const baselineRhr: number[] = [];
  const recentHrv: number[] = [];
  const recentRhr: number[] = [];

  for (const item of workouts) {
    const date = new Date(item.startDate);
    if (date.getTime() < baselineFrom.getTime() || date.getTime() > end.getTime()) continue;
    if (item.hrv && item.hrv > 0) {
      if (date.getTime() < baselineTo.getTime()) baselineHrv.push(item.hrv);
      else recentHrv.push(item.hrv);
    }
    if (item.minHeartRate && item.minHeartRate > 0) {
      if (date.getTime() < baselineTo.getTime()) baselineRhr.push(item.minHeartRate);
      else recentRhr.push(item.minHeartRate);
    }
  }

  if (baselineHrv.length < 3 || recentHrv.length < 1) return null;

  const baseline = mean(baselineHrv);
  const recent = mean(recentHrv);
  const hrvIndex = (recent / baseline) * 100;
  const restHrDelta =
    baselineRhr.length > 0 && recentRhr.length > 0
      ? Math.round(mean(recentRhr) - mean(baselineRhr))
      : null;

  const status: Readiness['status'] =
    hrvIndex >= 95 && (restHrDelta === null || restHrDelta <= 2)
      ? 'ready'
      : hrvIndex >= 82
        ? 'normal'
        : 'recovering';

  return {
    hrvIndex: Math.round(hrvIndex),
    baselineHrv: Math.round(baseline * 10) / 10,
    recentHrv: Math.round(recent * 10) / 10,
    restHrDelta,
    status,
  };
}
