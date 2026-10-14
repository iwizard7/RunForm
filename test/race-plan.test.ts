import { assert, assertEqual, group, summarize, test } from './harness';
import {
  groupSessionsByWeek,
  validateRaceSessions,
  weeksUntilRace,
} from '@/lib/race-plan';

const TODAY = new Date('2026-06-15T12:00:00');

function isoIn(days: number): string {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

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

group('race-plan: validateRaceSessions');

const TOTAL_WEEKS = 3;

test('non-arrays and empty arrays are rejected', () => {
  const notArray = validateRaceSessions({ week: 1 }, TOTAL_WEEKS);
  assertEqual(notArray.ok, false, 'object payload rejected');
  const empty = validateRaceSessions([], TOTAL_WEEKS);
  assertEqual(empty.ok, false, 'empty array rejected');
});

test('entries without a numeric in-range week are rejected', () => {
  const missing = validateRaceSessions([{ type: 'Easy Run' }], TOTAL_WEEKS);
  assertEqual(missing.ok, false, 'missing week rejected');
  const fractional = validateRaceSessions([{ week: 1.5, type: 'Easy Run' }], TOTAL_WEEKS);
  assertEqual(fractional.ok, false, 'fractional week rejected');
  const outOfRange = validateRaceSessions([{ week: 9, type: 'Easy Run' }], TOTAL_WEEKS);
  assertEqual(outOfRange.ok, false, 'week beyond the plan rejected');
});

test('entries without a session type are rejected', () => {
  const result = validateRaceSessions([{ week: 1 }, { week: 2 }, { week: 3 }], TOTAL_WEEKS);
  assertEqual(result.ok, false, 'blank type rejected');
});

test('missing weeks are rejected even when every entry is well-formed', () => {
  const result = validateRaceSessions(
    [
      { week: 1, type: 'Easy Run' },
      { week: 3, type: 'Long Run' },
    ],
    TOTAL_WEEKS,
  );
  assertEqual(result.ok, false, 'week 2 gap rejected');
  if (!result.ok) {
    assert(result.problem.includes('week 2'), `problem names the gap (${result.problem})`);
  }
});

test('a complete plan passes and fields are trimmed', () => {
  const result = validateRaceSessions(
    [
      { week: 1, phase: ' Base ', day: 'Mon', type: ' Easy Run ', distance: '8 km', duration: '50 min', zone: 'Z2', notes: ' keep it easy ' },
      { week: 2, type: 'Tempo' },
      { week: 3, type: 'Race' },
    ],
    TOTAL_WEEKS,
  );
  assertEqual(result.ok, true, 'complete plan accepted');
  if (result.ok) {
    assertEqual(result.sessions.length, 3, 'all entries kept');
    assertEqual(result.sessions[0].phase, 'Base', 'phase trimmed');
    assertEqual(result.sessions[0].type, 'Easy Run', 'type trimmed');
    assertEqual(result.sessions[0].week, 1, 'week preserved as a number');
    assertEqual(result.sessions[2].phase, undefined, 'optional fields may be absent');
  }
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

test('the first session of a week donates its phase label', () => {
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
