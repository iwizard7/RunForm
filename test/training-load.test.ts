import { assert, assertEqual, group, summarize, test } from './harness';
import {
  buildYearHeatmap,
  computeAnnualGoal,
  computeLoadSeries,
  computeReadiness,
  computeStreaks,
  computeWorkoutLoad,
  intensityFactor,
} from '@/lib/training-load';

const TODAY = new Date('2026-06-15T12:00:00');

function at(daysAgo: number, hour = 9): string {
  const date = new Date(TODAY);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function workout(daysAgo: number, extra: Record<string, unknown> = {}) {
  return {
    startDate: at(daysAgo),
    duration: 3600,
    avgHeartRate: 170,
    averageIntensity: 0,
    distance: 10,
    hrv: 0,
    minHeartRate: 0,
    ...extra,
  };
}

group('training load: intensity');

test('HR-based factor uses the LTHR ratio, clamped to sane bounds', () => {
  assertEqual(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 170, averageIntensity: 0 }, 170), 1, 'at threshold');
  assertEqual(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 221, averageIntensity: 0 }, 170), 1.3, 'clamped high');
  assertEqual(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 85, averageIntensity: 0 }, 170), 0.5, 'clamped low');
});

test('intensity fallback accepts both 0..1 and 1..10 scales', () => {
  const near = (value: number, expected: number) => Math.abs(value - expected) < 1e-9;
  assert(near(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 0, averageIntensity: 0.8 }), 0.91), '0..1 scale');
  assert(near(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 0, averageIntensity: 8 }), 0.91), '1..10 scale');
  assertEqual(intensityFactor({ startDate: '', duration: 0, avgHeartRate: 0, averageIntensity: 0 }), 0.7, 'no data default');
});

test('load is hours × intensity² × 100', () => {
  const base = { startDate: '', avgHeartRate: 170, averageIntensity: 0 };
  assertEqual(computeWorkoutLoad({ ...base, duration: 3600 }, 170), 100, 'one hour at threshold = 100');
  assertEqual(computeWorkoutLoad({ ...base, duration: 1800 }, 170), 50, 'half an hour = 50');
  assert(Math.abs(computeWorkoutLoad({ ...base, duration: 3600, avgHeartRate: 187 }, 170) - 121) < 1e-9, 'intensity² scales the score');
});

group('training load: CTL/ATL/TSB series');

test('a hard day shows fatigue first, then fitness catches up', () => {
  const series = computeLoadSeries([workout(0)], { days: 30, lthr: 170, endDate: TODAY });
  const today = series[series.length - 1];
  assertEqual(today.load, 100, 'workout day load');
  assert(today.atl > today.ctl, 'acute load above chronic right after the effort');
  assert(today.tsb < 0, 'TSB negative while fatigued');

  // CTL has a 42-day time constant: ~220 rest days are needed to fully decay.
  const settled = computeLoadSeries([workout(0)], { days: 30, lthr: 170, endDate: new Date(TODAY.getTime() + 220 * 86400000) });
  const last = settled[settled.length - 1];
  assert(last.atl < 1, 'acute load decays to ~0 after 220 rest days');
  assert(last.ctl < 1, 'chronic load decays too');
});

test('steady training converges CTL toward the daily load', () => {
  // ~200 days of daily 100-point sessions: both averages settle near 100.
  const workouts = Array.from({ length: 200 }, (_, index) => workout(199 - index));
  const series = computeLoadSeries(workouts, { days: 14, lthr: 170, endDate: TODAY });
  const last = series[series.length - 1];
  assert(Math.abs(last.ctl - 100) < 3, `CTL settles near 100, got ${last.ctl}`);
  assert(Math.abs(last.tsb) < 3, `TSB near 0 under steady load, got ${last.tsb}`);
});

test('series window covers the requested number of days', () => {
  const series = computeLoadSeries([], { days: 45, endDate: TODAY });
  assertEqual(series.length, 45, 'one point per day');
  assertEqual(series[series.length - 1].date, '2026-06-15', 'ends on the requested day');
});

group('training load: streaks');

test('day streak counts consecutive days and dies after a rest day', () => {
  const alive = computeStreaks([workout(0), workout(1), workout(2), workout(6)], TODAY);
  assertEqual(alive.dayCurrent, 3, 'current day streak alive');
  assertEqual(alive.dayLongest, 3, 'longest day streak');

  const dead = computeStreaks([workout(2), workout(3), workout(4)], TODAY);
  assertEqual(dead.dayCurrent, 0, 'streak dead when yesterday and today are empty');
  assertEqual(dead.dayLongest, 3, 'longest streak survives the break');
});

test('a workout yesterday keeps the day streak alive', () => {
  const streaks = computeStreaks([workout(1), workout(2)], TODAY);
  assertEqual(streaks.dayCurrent, 2, 'alive through yesterday');
});

test('week streak counts consecutive Monday-based weeks', () => {
  // TODAY is Monday 2026-06-15, so the four workouts span four straight weeks.
  const streaks = computeStreaks([workout(0), workout(7), workout(8), workout(21)], TODAY);
  assertEqual(streaks.weekCurrent, 4, 'four consecutive active weeks, current included');
  assertEqual(streaks.weekLongest, 4, 'longest run of active weeks');

  const emptyNow = computeStreaks([workout(10), workout(11)], TODAY);
  assertEqual(emptyNow.weekCurrent, 0, 'current week empty kills the live streak');
});

group('training load: heatmap');

test('year grid covers the full year with weekday columns', () => {
  const grid = buildYearHeatmap([workout(0), workout(40)], 170, 2026);
  const cells = grid.flat();
  assertEqual(cells.filter((cell) => cell.inYear).length, 365, 'every day of 2026 present once');
  assert(grid.length === 52 || grid.length === 53, `week columns: ${grid.length}`);
  assert(grid.every((week) => week.length === 7), 'seven day cells per column');
});

test('a workout lands in its cell with load and distance', () => {
  const grid = buildYearHeatmap([workout(5, { duration: 1800, distance: 7.5 })], 170, 2026);
  const cell = grid.flat().find((item) => item.dateKey === '2026-06-10');
  assert(cell !== undefined, 'cell for the workout day exists');
  assertEqual(cell?.distanceKm, 7.5, 'distance recorded');
  assert((cell?.load ?? 0) > 0, 'load recorded');
});

group('training load: annual goal');

test('no goal configured returns null', () => {
  assertEqual(computeAnnualGoal([], 0, TODAY), null, 'goal 0 → no tracking');
});

test('progress, needed weekly pace and projection follow the data', () => {
  const workouts = [
    ...Array.from({ length: 10 }, (_, index) => workout(100 + index, { duration: 0, avgHeartRate: 0, distance: 10 })), // 100 km earlier this year
    workout(3, { duration: 0, avgHeartRate: 0, distance: 8 }), // 8 km inside the last 28 days
  ];
  const goal = computeAnnualGoal(workouts, 2000, TODAY);
  assert(goal !== null, 'goal computed');
  assertEqual(goal?.doneKm, 108, 'year distance totals');
  assert(goal !== null && goal.neededPerWeek > 0, 'remaining distance requires weekly volume');
  assert(goal !== null && goal.percent === 5, 'progress percent');
  // projection: recent 8 km / 4 weeks = 2 km per week × weeks left
  assert(goal !== null && goal.recentWeeklyKm === 2, 'recent weekly rate');
  assert(goal !== null && goal.projectedKm > 108, 'projection adds the current pace');
  assert(goal !== null && !goal.onTrack, 'slow pace misses a 2000 km goal');
});

group('training load: readiness');

test('HRV above baseline means ready', () => {
  const workouts = [
    ...Array.from({ length: 12 }, (_, index) => workout(index * 2 + 8, { hrv: 60, minHeartRate: 50 })),
    workout(2, { hrv: 64, minHeartRate: 49 }),
    workout(4, { hrv: 68, minHeartRate: 49 }),
  ];
  const readiness = computeReadiness(workouts, TODAY);
  assertEqual(readiness?.status, 'ready', 'HRV +10% and resting pulse stable');
  assertEqual(readiness?.hrvIndex, 110, 'index is recent vs baseline percent');
  assertEqual(readiness?.restHrDelta, -1, 'resting pulse slightly down');
});

test('a sharp HRV drop means recovering', () => {
  const workouts = [
    ...Array.from({ length: 12 }, (_, index) => workout(index * 2 + 8, { hrv: 60 })),
    workout(1, { hrv: 44 }),
    workout(2, { hrv: 46 }),
  ];
  assertEqual(computeReadiness(workouts, TODAY)?.status, 'recovering', 'HRV well below baseline');
});

test('too few HRV samples returns null', () => {
  assertEqual(computeReadiness([workout(1, { hrv: 60 })], TODAY), null, 'single sample is not enough');
  assertEqual(computeReadiness([], TODAY), null, 'no data at all');
});

summarize('training-load suite').catch((error) => {
  console.error(error);
  process.exit(1);
});
