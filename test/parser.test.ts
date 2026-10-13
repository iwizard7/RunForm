import { assert, assertEqual, group, summarize, test } from './harness';
import { extractRoute, parseWorkoutJSON } from '@/lib/parser';
import { computeRouteFingerprint, computeRouteLengthKm } from '@/lib/routes';
import { computeWorkoutSplits, formatSplitPace } from '@/lib/splits';
import { buildTrackGeometry, paceColor, projectRoute } from '@/lib/track';
import { dateKey, getWeekPlanDays } from '@/lib/week';
import { buildCacheKey } from '@/lib/ollama';

function makeTrack(count: number, startLat = 55.75, startLng = 37.62) {
  return Array.from({ length: count }, (_, index) => ({
    lat: startLat + index * 0.0004,
    lng: startLng + index * 0.0004,
  }));
}


  group('parser: route extraction');

  test('top-level route with lat/lng', () => {
    const route = extractRoute({ route: [{ lat: 55.1, lng: 37.1 }, { lat: 55.2, lng: 37.2 }] });
    assertEqual(route.length, 2, 'route length');
    assertEqual(route[0].lat, 55.1, 'first lat');
  });

  test('top-level locations with latitude/longitude and heartRate', () => {
    const route = extractRoute({
      locations: [{ latitude: '55.1', longitude: '37.1', heartRate: 132.6 }],
    });
    assertEqual(route.length, 1, 'route length');
    assertEqual(route[0].lat, 55.1, 'parsed lat from string');
    assertEqual(route[0].hr, 133, 'hr rounded');
  });

  test('nested exercises[].samples.location', () => {
    const route = extractRoute({
      exercises: [{ samples: { location: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] } }],
    });
    assertEqual(route.length, 2, 'nested route length');
    assertEqual(route[1].lng, 4, 'lng read from lon');
  });

  test('nested samples as array of objects', () => {
    const route = extractRoute({
      exercises: [{ samples: [{}, { location: [{ latitude: 10, longitude: 20 }] }] }],
    });
    assertEqual(route.length, 1, 'route length from samples array');
  });

  test('invalid points are dropped', () => {
    const route = extractRoute({
      route: [{ lat: 'abc', lng: 1 }, { lat: 1, lng: 2 }, { lat: null, lng: 3 }],
    });
    assertEqual(route.length, 1, 'only valid point kept');
  });

  test('workout without GPS yields empty route', () => {
    assertEqual(extractRoute({ uuid: 'x' }).length, 0, 'no route');
    assertEqual(extractRoute(null).length, 0, 'null input');
  });

  test('parseWorkoutJSON populates route', () => {
    const parsed = parseWorkoutJSON({
      uuid: 'abc',
      route: [{ lat: 55.75, lng: 37.62 }, { lat: 55.76, lng: 37.63 }],
    });
    assertEqual(parsed.route?.length, 2, 'parsed route length');
    assertEqual(parsed.uuid, 'abc', 'uuid kept');
  });

  test('parseWorkoutJSON defaults route to empty array', () => {
    const parsed = parseWorkoutJSON({ uuid: 'abc' });
    assert(Array.isArray(parsed.route), 'route is an array');
    assertEqual(parsed.route?.length, 0, 'empty route');
  });

  group('routes: fingerprint and length');

  test('short tracks have no fingerprint', () => {
    assertEqual(computeRouteFingerprint(makeTrack(3)), null, '3 points rejected');
    assertEqual(computeRouteFingerprint([]), null, 'empty rejected');
    assertEqual(computeRouteFingerprint(undefined), null, 'undefined rejected');
  });

  test('same course gives the same fingerprint', () => {
    const first = computeRouteFingerprint(makeTrack(40));
    const second = computeRouteFingerprint(makeTrack(40));
    assertEqual(first, second, 'stable fingerprint');
  });

  test('slight GPS offset keeps the same fingerprint', () => {
    const original = makeTrack(40);
    const shifted = original.map((point) => ({ lat: point.lat + 0.00003, lng: point.lng - 0.00002 }));
    assertEqual(
      computeRouteFingerprint(original),
      computeRouteFingerprint(shifted),
      'jitter tolerant fingerprint',
    );
  });

  test('a different course gives a different fingerprint', () => {
    const first = computeRouteFingerprint(makeTrack(40));
    const second = computeRouteFingerprint(makeTrack(40, 59.93, 30.33));
    assert(first !== second, 'fingerprints must differ for different courses');
  });

  test('tracks made mostly of zero coordinates are rejected', () => {
    const zeros = Array.from({ length: 30 }, () => ({ lat: 0, lng: 0 }));
    assertEqual(computeRouteFingerprint(zeros), null, 'zero track rejected');
  });

  test('route length is measured in kilometres', () => {
    const track = makeTrack(40);
    const length = computeRouteLengthKm(track);
    assert(length > 1 && length < 3, `expected ~2 km for the synthetic track, got ${length}`);
    assertEqual(computeRouteLengthKm([{ lat: 1, lng: 1 }]), 0, 'single point has no length');
  });

  group('parser: route timestamps');

  test('timestamps are read and normalized to epoch milliseconds', () => {
    const route = extractRoute({
      route: [
        { lat: 1, lng: 2, timestamp: 1700000000 },
        { lat: 1, lng: 2.001, time: '2023-11-14T22:13:20Z' },
        { lat: 1, lng: 2.002, t: 1700000000000 },
        { lat: 1, lng: 2.003, t: 300 },
      ],
    });
    assertEqual(route[0].t, 1700000000000, 'epoch seconds normalized');
    assertEqual(route[1].t, 1700000000000, 'ISO string parsed');
    assertEqual(route[2].t, 1700000000000, 'epoch milliseconds kept');
    assertEqual(route[3].t, undefined, 'ambiguous small value dropped');
  });

  group('splits: per-kilometre breakdown');

  // 1 degree of longitude at the equator with R=6371 equals this many km.
  const DEG_PER_KM = 180 / (6371 * Math.PI);
  const T0 = 1700000000000;

  function makeSplitsTrack(count: number, stepKm: number) {
    return Array.from({ length: count }, (_, index) => ({
      lat: 0,
      lng: index * stepKm * DEG_PER_KM,
      hr: 145,
      // 10 minutes per kilometre — 600 s/km pace.
      t: T0 + index * 600_000,
    }));
  }

  test('a timed 5 km track yields five splits with HR and pace', () => {
    const splits = computeWorkoutSplits({ route: makeSplitsTrack(6, 1) });
    assertEqual(splits.length, 5, 'one split per kilometre');
    for (const split of splits) {
      assert(Math.abs(split.distance - 1) < 0.02, `split ${split.km} covers ~1 km, got ${split.distance}`);
      assertEqual(split.avgHr, 145, `split ${split.km} average HR`);
      assert(
        split.paceSec !== undefined && Math.abs(split.paceSec - 600) < 15,
        `split ${split.km} pace ~600 s/km, got ${split.paceSec}`,
      );
    }
  });

  test('a partial final kilometre becomes a tail split', () => {
    const track = [
      { lat: 0, lng: 0, hr: 140, t: T0 },
      { lat: 0, lng: 1 * DEG_PER_KM, hr: 145, t: T0 + 60_000 },
      { lat: 0, lng: 2 * DEG_PER_KM, hr: 150, t: T0 + 120_000 },
      { lat: 0, lng: 2.5 * DEG_PER_KM, hr: 155, t: T0 + 150_000 },
    ];
    const splits = computeWorkoutSplits({ route: track });
    assertEqual(splits.length, 3, 'two full splits plus the tail');
    assertEqual(splits[2].km, 3, 'tail split number');
    assert(Math.abs(splits[2].distance - 0.5) < 0.02, `tail covers ~0.5 km, got ${splits[2].distance}`);
    assert(
      splits[2].paceSec !== undefined && Math.abs(splits[2].paceSec - 60) < 5,
      `tail pace ~60 s/km, got ${splits[2].paceSec}`,
    );
  });

  test('without timestamps only heart rate is available', () => {
    const track = makeSplitsTrack(6, 1).map((point) => ({ lat: point.lat, lng: point.lng, hr: point.hr }));
    const splits = computeWorkoutSplits({ route: track });
    assertEqual(splits.length, 5, 'splits still computed from geometry');
    assertEqual(splits[0].paceSec, undefined, 'no pace without timestamps');
    assertEqual(splits[0].avgHr, 145, 'HR still averaged');
  });

  test('degenerate routes produce no splits', () => {
    assertEqual(computeWorkoutSplits({ route: [] }).length, 0, 'empty route');
    assertEqual(computeWorkoutSplits({ route: [{ lat: 1, lng: 1 }] }).length, 0, 'single point');
    assertEqual(computeWorkoutSplits({}).length, 0, 'missing route');
  });

  test('split pace formats as m\'ss"', () => {
    assertEqual(formatSplitPace(335), '5\'35"', 'five thirty-five');
    assertEqual(formatSplitPace(60), '1\'00"', 'one minute flat');
  });

  group('track: projection and geometry');

  test('projection fits points inside the viewport', () => {
    const projected = projectRoute(makeTrack(10), 640, 340);
    assert(projected !== null, 'projection exists');
    for (const point of projected ?? []) {
      assert(point.x >= 0 && point.x <= 640, `x inside viewport: ${point.x}`);
      assert(point.y >= 0 && point.y <= 340, `y inside viewport: ${point.y}`);
    }
  });

  test('degenerate routes produce no geometry', () => {
    assertEqual(projectRoute([]), null, 'empty route');
    assertEqual(projectRoute([{ lat: 1, lng: 2 }]), null, 'single point');
    assertEqual(buildTrackGeometry([], []), null, 'geometry of empty route');
    assertEqual(buildTrackGeometry([{ lat: 1, lng: 1 }], []), null, 'geometry of one point');
  });

  test('geometry keeps start and end markers in bounds', () => {
    const geometry = buildTrackGeometry(makeSplitsTrack(6, 1), []);
    assert(geometry !== null, 'geometry built');
    assertEqual(geometry?.pointCount, 6, 'all points used');
    assert(geometry !== null && geometry.paths.length >= 1, 'at least one path chunk');
    assert(geometry !== null && geometry.start.x >= 0 && geometry.start.x <= 640, 'start in bounds');
    assert(geometry !== null && geometry.end.y >= 0 && geometry.end.y <= 340, 'end in bounds');
  });

  test('splits with different paces produce differently coloured chunks', () => {
    const splits = [
      { km: 1, distance: 1, paceSec: 300 },
      { km: 2, distance: 1, paceSec: 420 },
      { km: 3, distance: 1, paceSec: 360 },
    ];
    const geometry = buildTrackGeometry(makeSplitsTrack(4, 1), splits);
    assert(geometry !== null, 'geometry built');
    assertEqual(geometry?.paths.length, 3, 'one chunk per colour change');
    const colors = new Set(geometry?.paths.map((path) => path.color));
    assert(colors.size >= 2, `expected several colours, got ${colors.size}`);
  });

  test('pace colours ramp from fast green to slow red', () => {
    assertEqual(paceColor(300, 300, 420), '#34c759', 'fast split is green');
    assertEqual(paceColor(420, 300, 420), '#ff3b30', 'slow split is red');
    assertEqual(paceColor(300, 300, 300), '#34c759', 'degenerate range stays green');
    const mid = paceColor(360, 300, 420);
    assert(mid !== '#34c759' && mid !== '#ff3b30', `mid pace lands between endpoints, got ${mid}`);
  });

  group('week plan: dated window');

  test('week window covers tomorrow through +7 days', () => {
    const now = new Date(2026, 9, 13, 15, 30); // 13 Oct 2026, local time
    const days = getWeekPlanDays(now);
    assertEqual(days.length, 7, 'seven days');
    assertEqual(days[0].key, '2026-10-14', 'starts tomorrow');
    assertEqual(days[6].key, '2026-10-20', 'ends seven days later');
    assertEqual(new Set(days.map((day) => day.key)).size, 7, 'keys are unique');
    assert(days[0].weekdayShort.length > 0, 'weekday label present');
    assert(days[0].dateLabel.length > 0, 'date label present');
  });

  test('date keys survive month and year boundaries', () => {
    const days = getWeekPlanDays(new Date(2026, 11, 28)); // 28 Dec 2026
    assertEqual(days[0].key, '2026-12-29', 'starts on 29 Dec');
    assertEqual(days[6].key, '2027-01-04', 'crosses into the next year');
  });

  test('dateKey uses local calendar fields with zero padding', () => {
    assertEqual(dateKey(new Date(2026, 0, 5)), '2026-01-05', 'month and day padded');
    assertEqual(dateKey(new Date(2026, 11, 31)), '2026-12-31', 'year kept local');
  });

  group('ollama: cache keys');

  test('identical requests share a cache key', () => {
    assertEqual(
      buildCacheKey('sys', 'prompt', 'qwen3:4b'),
      buildCacheKey('sys', 'prompt', 'qwen3:4b'),
      'stable key',
    );
  });

  test('model, system and prompt each change the key', () => {
    const base = buildCacheKey('sys', 'prompt', 'qwen3:4b');
    assert(base !== buildCacheKey('sys', 'prompt other', 'qwen3:4b'), 'prompt changes key');
    assert(base !== buildCacheKey('sys other', 'prompt', 'qwen3:4b'), 'system changes key');
    assert(base !== buildCacheKey('sys', 'prompt', 'qwen2.5:3b'), 'model changes key');
    assert(base !== buildCacheKey('sys', 'prompt', undefined), 'default model differs from an explicit one');
  });

summarize('parser/routes suite').catch((error) => {
  console.error(error);
  process.exit(1);
});
