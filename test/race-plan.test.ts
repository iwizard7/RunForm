import { assert, assertEqual, group, summarize, test } from './harness';
import {
  RACE_DISTANCES,
  buildRacePlanTemplate,
  derivePhase,
  estimateDurationMin,
  expandRaceSession,
  groupSessionsByWeek,
  parseDistanceKm,
  weeksUntilRace,
} from '@/lib/race-plan';

const TODAY = new Date('2026-06-15T12:00:00');

function isoIn(days: number): string {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const HALF = RACE_DISTANCES.find((item) => item.key === 'half')!;

group('race-plan: weeksUntilRace');

test('past and malformed dates are rejected', () => {
  assertEqual(weeksUntilRace(isoIn(-10), TODAY), null, 'past race day rejected');
  assertEqual(weeksUntilRace('not-a-date', TODAY), null, 'malformed date rejected');
});

test('closer than four weeks is rejected', () => {
  assertEqual(weeksUntilRace(isoIn(27), TODAY), null, '27 days out rejected');
});

test('the plan length is the week count, floored at four weeks', () => {
  assertEqual(weeksUntilRace(isoIn(28), TODAY), 4, 'exactly four weeks');
  assertEqual(weeksUntilRace(isoIn(30), TODAY), 4, 'partial weeks round down');
  assertEqual(weeksUntilRace(isoIn(84), TODAY), 12, 'twelve weeks');
});

test('very distant races clamp to 24 weeks', () => {
  assertEqual(weeksUntilRace(isoIn(365), TODAY), 24, 'a year out clamps to 24');
});

group('race-plan: derivations');

test('phases: base → build → peak, last two weeks taper', () => {
  assertEqual(derivePhase(1, 12), 'Base', 'opening week is base');
  assertEqual(derivePhase(5, 12), 'Build', 'week 5 enters build');
  assertEqual(derivePhase(10, 12), 'Peak', 'week 10 reaches the peak');
  assertEqual(derivePhase(11, 12), 'Taper', 'penultimate week tapers');
  assertEqual(derivePhase(12, 12), 'Taper', 'race week is taper');
});

test('distances parse, durations follow type pace', () => {
  assertEqual(parseDistanceKm('12 km'), 12, 'plain label parses');
  assertEqual(parseDistanceKm('8,5 km'), 8.5, 'comma decimal parses');
  assertEqual(parseDistanceKm('-'), null, 'dash means no distance');
  assertEqual(estimateDurationMin('10 km', 'Easy Run'), 65, 'easy pace 6:30/km');
  assertEqual(estimateDurationMin('10 km', 'Tempo'), 54, 'tempo pace is faster');
  assertEqual(estimateDurationMin('-', 'Rest'), null, 'rest has no duration');
});

test('sessions expand with zone, duration, intensity and tip', () => {
  const full = expandRaceSession({ week: 5, day: 'Tue', type: 'Intervals', distance: '10 km' }, 12, 'en');
  assertEqual(full.phase, 'Build', 'phase derived from the week');
  assertEqual(full.zone, 'Z4', 'intervals map to Z4');
  assertEqual(full.duration, '53 min', 'duration estimated from distance');
  assertEqual(full.intensity, 'High', 'intervals are high intensity');
  assert(!!full.notes, 'a tip is attached');
});

group('race-plan: template');

test('every week has exactly the requested number of sessions', () => {
  for (const daysPerWeek of [3, 4, 5, 6]) {
    const sessions = buildRacePlanTemplate({ distance: HALF, weeks: 12, daysPerWeek, weeklyKm: 35, lang: 'en' });
    assertEqual(sessions.length, 12 * daysPerWeek, `${daysPerWeek}/week: full session count`);
    for (let week = 1; week <= 12; week += 1) {
      const inWeek = sessions.filter((session) => session.week === week);
      assertEqual(inWeek.length, daysPerWeek, `${daysPerWeek}/week: week ${week} is complete`);
    }
  }
});

test('the race closes the plan on its own distance', () => {
  const sessions = buildRacePlanTemplate({ distance: HALF, weeks: 8, daysPerWeek: 4, weeklyKm: 30, lang: 'en' });
  const races = sessions.filter((session) => session.type === 'Race');
  assertEqual(races.length, 1, 'exactly one race session');
  assertEqual(races[0].week, 8, 'the race sits in the final week');
  assertEqual(races[0].distance, '21.1 km', 'race distance matches the goal race');
});

test('the long run grows to its peak, then the taper cuts it', () => {
  const sessions = buildRacePlanTemplate({ distance: HALF, weeks: 12, daysPerWeek: 4, weeklyKm: 35, lang: 'en' });
  const longs = sessions
    .filter((session) => session.type === 'Long Run')
    .map((session) => ({ week: session.week, km: parseDistanceKm(session.distance) ?? 0 }));
  const peakKm = Math.max(...longs.map((item) => item.km));
  assertEqual(peakKm, 24, 'long run peaks at the distance profile');
  const peakEntry = longs.find((item) => item.km === peakKm)!;
  assert(peakEntry.week <= 10, `peak lands before the taper (week ${peakEntry.week})`);
  const lastLong = longs[longs.length - 1];
  assert(lastLong.km < peakKm * 0.75, `taper cuts the long run (${lastLong.km} km)`);
  // Growth is monotonic until the peak — no wild jumps mid-plan.
  for (let index = 1; index < longs.length; index += 1) {
    const jump = longs[index].km - longs[index - 1].km;
    assert(jump <= 3, `long run grows gradually (week ${longs[index].week}: +${jump} km)`);
  }
});

test('unknown volume still yields a sane conservative base', () => {
  const sessions = buildRacePlanTemplate({ distance: HALF, weeks: 8, daysPerWeek: 3, weeklyKm: 0, lang: 'en' });
  const longs = sessions.filter((session) => session.type === 'Long Run');
  const firstKm = parseDistanceKm(longs[0].distance)!;
  assert(firstKm >= 8 && firstKm <= 10, `starter long run is conservative (${firstKm} km)`);
});

test('sessions carry zones and tips in the requested language', () => {
  const ru = buildRacePlanTemplate({ distance: HALF, weeks: 4, daysPerWeek: 4, weeklyKm: 30, lang: 'ru' });
  const en = buildRacePlanTemplate({ distance: HALF, weeks: 4, daysPerWeek: 4, weeklyKm: 30, lang: 'en' });
  assert(ru.every((session) => !!session.zone), 'every session has a zone');
  const ruIntervals = ru.find((session) => session.type === 'Intervals');
  const enIntervals = en.find((session) => session.type === 'Intervals');
  assert(
    !!ruIntervals?.notes && /[^A-Za-z]/.test(ruIntervals.notes),
    `russian tip is in russian (${ruIntervals?.notes})`,
  );
  assert(!!enIntervals?.notes, 'english tip present');
});

group('race-plan: groupSessionsByWeek');

test('sessions group by week in ascending order', () => {
  const groups = groupSessionsByWeek([
    { week: 2, type: 'Tempo' },
    { week: 1, type: 'Easy Run' },
    { week: 2, type: 'Long Run' },
  ]);
  assertEqual(groups.map((item) => item.week).join(','), '1,2', 'weeks sorted ascending');
  assertEqual(groups[1].sessions.length, 2, 'both week-2 sessions grouped');
});

test('the first non-empty phase donates the label', () => {
  const groups = groupSessionsByWeek([
    { week: 1, phase: '', type: 'Easy Run' },
    { week: 1, phase: 'Build', type: 'Tempo' },
  ]);
  assertEqual(groups[0].phase, 'Build', 'later non-empty phase fills the label');
});

summarize('race-plan suite').catch((error) => {
  console.error(error);
  process.exit(1);
});
