import { assert, assertEqual, group, summarize, test } from './harness';
import {
  buildPersonalBestCandidates,
  estimateBestEffortPace,
  formatPersonalBest,
  getDistanceTaper,
  getHardZoneShare,
  getZoneNumber,
  selectImprovedRecords,
} from '@/lib/personal-best';
import { getUserDataDir, resolveDataDir } from '@/lib/data-dir';
import { WorkoutData } from '@/lib/parser';

function makeWorkout(overrides: Partial<WorkoutData> = {}): WorkoutData {
  return {
    uuid: 'w-1',
    name: 'Running',
    activityName: 'Running',
    startDate: '2026-04-22T00:06:06Z',
    endDate: '2026-04-22T00:55:06Z',
    duration: 2940,
    calories: 500,
    distance: 7.46,
    pace: "8'07\"",
    averageIntensity: 3,
    minIntensity: 1,
    maxIntensity: 6,
    averageMETs: 8,
    avgHeartRate: 130,
    minHeartRate: 90,
    maxHeartRate: 165,
    zones: {},
    cadence: 141,
    steps: 8516,
    location: 'Indoor',
    source: 'Apple Watch',
    weather: { temperature: 'N/A', humidity: 'N/A' },
    device: { name: 'Watch', manufacturer: 'Apple', model: 'X', hardwareVersion: '1', softwareVersion: '1' },
    route: [],
    ...overrides,
  };
}


  group('personal bests: effort estimation');

  test('a workout with no pace has no estimate', () => {
    assertEqual(estimateBestEffortPace(makeWorkout({ pace: "0'00\"" }), 5), null, 'zero pace rejected');
    assertEqual(buildPersonalBestCandidates(makeWorkout({ pace: "0'00\"" })).length, 0, 'no candidates');
  });

  test('a workout with no distance has no candidates', () => {
    assertEqual(buildPersonalBestCandidates(makeWorkout({ distance: 0 })).length, 0, 'no candidates');
  });

  test('short workouts only claim distances they covered', () => {
    const types = buildPersonalBestCandidates(makeWorkout({ distance: 2.5 })).map((item) => item.type);
    assertEqual(types.join(','), '1k', 'only the 1k tier');
  });

  test('a 10 km run supports 1k, 5k and 10k', () => {
    const types = buildPersonalBestCandidates(makeWorkout({ distance: 10.4 })).map((item) => item.type);
    assertEqual(types.join(','), '1k,5k,10k', 'three tiers');
  });

  test('hard-zone work yields a faster estimate than a pure easy run', () => {
    const easy = makeWorkout({
      zones: { zone2: { name: 'FAT BURN', rate: 0.95, time: { value: 2800, unit: 'sec' } } },
    });
    const hard = makeWorkout({
      zones: { zone4: { name: 'CARDIO', rate: 0.45, time: { value: 1300, unit: 'sec' } } },
    });

    const easyPace = estimateBestEffortPace(easy, 5);
    const hardPace = estimateBestEffortPace(hard, 5);
    assert(easyPace !== null && hardPace !== null, 'both estimates exist');
    assert(hardPace! < easyPace!, `hard effort should be faster (${hardPace} < ${easyPace})`);
  });

  test('the 1 km estimate is faster than the 5 km estimate', () => {
    const workout = makeWorkout({ zones: { zone4: { name: 'CARDIO', rate: 0.2, time: { value: 600, unit: 'sec' } } } });
    const oneK = estimateBestEffortPace(workout, 1);
    const fiveK = estimateBestEffortPace(workout, 5);
    assert(oneK !== null && fiveK !== null, 'both estimates exist');
    assert(oneK! < fiveK!, `1k pace should be faster (${oneK} < ${fiveK})`);
  });

  test('estimates stay within a plausible range of the average pace', () => {
    const workout = makeWorkout({
      pace: "8'07\"",
      zones: { zone4: { name: 'CARDIO', rate: 0.5, time: { value: 1470, unit: 'sec' } } },
    });
    const pace5k = estimateBestEffortPace(workout, 5);
    assert(pace5k !== null, 'estimate exists');
    assert(pace5k! > 7.0 && pace5k! < 8.12, `5k estimate should be slightly faster than average, got ${pace5k}`);
  });

  test('the hard-zone share is the sum of zones 4 and 5', () => {
    const workout = makeWorkout({
      zones: {
        zone4: { name: 'CARDIO', rate: 0.5, time: { value: 100, unit: 'sec' } },
        zone5: { name: 'PEAK', rate: 0.4, time: { value: 100, unit: 'sec' } },
      },
    });
    assertEqual(getHardZoneShare(workout), 0.9, 'zones 4 and 5 summed');
  });

  test('the taper credit is capped even for a very hard run', () => {
    const everythingHard = makeWorkout({
      pace: "6'00\"",
      distance: 10,
      zones: {
        zone4: { name: 'CARDIO', rate: 0.5, time: { value: 100, unit: 'sec' } },
        zone5: { name: 'PEAK', rate: 0.5, time: { value: 100, unit: 'sec' } },
      },
    });
    const capped = estimateBestEffortPace(everythingHard, 5);
    const totallyHard = makeWorkout({
      pace: "6'00\"",
      distance: 10,
      zones: {
        zone4: { name: 'CARDIO', rate: 1, time: { value: 100, unit: 'sec' } },
      },
    });
    const alsoCapped = estimateBestEffortPace(totallyHard, 5);
    assertEqual(capped, alsoCapped, 'shares above 50% behave the same');
    assert(capped !== null && capped > 5.4, `taper stays modest, got ${capped}`);
  });

  test('zone names are used when zone keys differ', () => {
    const workout = makeWorkout({
      zones: {
        z1: { name: 'WARM UP', rate: 0.1, time: { value: 100, unit: 'sec' } },
        z4: { name: 'PEAK', rate: 0.3, time: { value: 100, unit: 'sec' } },
      },
    });
    assertEqual(getHardZoneShare(workout), 0.3, 'matched by zone name');
  });

  test('a zone described by both key and name is counted once', () => {
    const workout = makeWorkout({
      zones: {
        zone4: { name: 'CARDIO', rate: 0.35, time: { value: 100, unit: 'sec' } },
        zone5: { name: 'PEAK', rate: 0.1, time: { value: 100, unit: 'sec' } },
      },
    });
    assertEqual(getHardZoneShare(workout), 0.45, 'no double counting');
    assertEqual(getZoneNumber('PEAK'), 5, 'label maps to zone 5');
    assertEqual(getZoneNumber('zone3'), 3, 'zone key maps to its number');
    assertEqual(getZoneNumber('unknown'), null, 'unknown zone ignored');
  });

  test('the distance taper grows with distance', () => {
    assert(getDistanceTaper(1) < getDistanceTaper(5), '1k taper below 5k');
    assert(getDistanceTaper(5) < getDistanceTaper(21.0975), '5k taper below half marathon');
  });

  group('personal bests: record selection');

  test('the first result always becomes a record', () => {
    const workout = makeWorkout({ distance: 10 });
    const candidates = buildPersonalBestCandidates(workout);
    const improved = selectImprovedRecords([], candidates);
    assertEqual(improved.length, candidates.length, 'all candidates accepted');
  });

  test('a slower result does not replace an existing record', () => {
    const workout = makeWorkout({ distance: 10, zones: {} });
    const candidates = buildPersonalBestCandidates(workout);
    const existing = candidates.map((candidate) => ({ type: candidate.type, value: candidate.paceMinutes - 0.5 }));
    assertEqual(selectImprovedRecords(existing, candidates).length, 0, 'nothing improved');
  });

  test('only the improved distance is returned', () => {
    const workout = makeWorkout({ distance: 10, zones: {} });
    const candidates = buildPersonalBestCandidates(workout);
    // Every tier is slower or equal, except the 5k one.
    const existing = candidates.map((candidate) => ({
      type: candidate.type,
      value: candidate.type === '5k' ? 99 : candidate.paceMinutes,
    }));
    const improved = selectImprovedRecords(existing, candidates);
    assertEqual(improved.length, 1, 'only the 5k improved');
    assertEqual(improved[0].type, '5k', '5k returned');
  });

  test('records store seconds derived from the tier distance', () => {
    const workout = makeWorkout({ distance: 10 });
    const fiveK = buildPersonalBestCandidates(workout).find((item) => item.type === '5k');
    assert(fiveK !== undefined, '5k candidate exists');
    assertEqual(fiveK!.seconds, Math.round(fiveK!.paceMinutes * 5 * 60), 'seconds conversion');
  });

  test('formatting turns seconds into m:ss', () => {
    assertEqual(formatPersonalBest(1260), '21:00', 'exact minutes');
    assertEqual(formatPersonalBest(1265), '21:05', 'minutes and seconds');
    assertEqual(formatPersonalBest(0), '—', 'invalid value');
  });

  group('data directory resolution');

  test('an explicit environment override always wins', () => {
    const resolved = resolveDataDir({ env: { RUNFORM_DATA_DIR: '/tmp/runform-data' }, cwd: '/tmp/project' });
    assertEqual(resolved.dir, '/tmp/runform-data', 'override used');
    assertEqual(resolved.source, 'env', 'source is env');
  });

  test('a writable project data directory is used by default', () => {
    const resolved = resolveDataDir({ env: {}, cwd: '/tmp/project', platform: 'darwin', home: '/Users/tester' });
    assertEqual(resolved.dir, '/tmp/project/data', 'cwd data dir');
    assertEqual(resolved.source, 'cwd', 'source is cwd');
  });

  test('a read-only project directory falls back to user data', () => {
    const deniedFs = {
      existsSync: () => true,
      accessSync: () => {
        throw new Error('EACCES');
      },
      mkdirSync: () => {},
    };
    const resolved = resolveDataDir({
      env: {},
      cwd: '/readonly/project',
      platform: 'darwin',
      home: '/Users/tester',
      fs: deniedFs,
    });
    assertEqual(resolved.source, 'userData', 'fallback used');
    assertEqual(resolved.dir, '/Users/tester/Library/Application Support/RunForm', 'macOS user data path');
  });

  test('a failing mkdir falls back to user data', () => {
    const failingFs = {
      existsSync: () => false,
      accessSync: () => {},
      mkdirSync: () => {
        throw new Error('EROFS');
      },
    };
    const resolved = resolveDataDir({
      env: {},
      cwd: '/readonly/project',
      platform: 'linux',
      home: '/home/tester',
      fs: failingFs,
    });
    assertEqual(resolved.dir, '/home/tester/.local/share/runform', 'linux user data path');
  });

  test('user data directories differ per platform', () => {
    assertEqual(getUserDataDir('darwin', '/Users/t'), '/Users/t/Library/Application Support/RunForm', 'macOS');
    assertEqual(getUserDataDir('linux', '/home/t'), '/home/t/.local/share/runform', 'linux');
    assert(getUserDataDir('win32', 'C:\\Users\\t').includes('RunForm'), 'windows path contains app name');
  });

summarize('personal-best/data-dir suite').catch((error) => {
  console.error(error);
  process.exit(1);
});
