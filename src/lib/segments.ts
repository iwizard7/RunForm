import { RoutePoint } from './parser';

/**
 * Segment efforts.
 *
 * A segment is a named slice of a course, defined by two geographic anchors
 * (a start and an end coordinate). To score a run against a segment we find
 * where the run's track passes each anchor and interpolate the crossing time
 * between the two neighbouring samples. Everything is pure math over arrays —
 * the database work lives in the server actions.
 */

const EARTH_RADIUS_KM = 6371;

export type SegmentAnchor = {
  lat: number;
  lng: number;
};

export type SegmentDefinition = {
  id: string;
  routeId: string;
  name: string;
  start: SegmentAnchor;
  end: SegmentAnchor;
};

export type SegmentEffort = {
  workoutUuid: string;
  /** Effort time in seconds, rounded to whole seconds. */
  seconds: number;
  /** Average pace in minutes per kilometre for the segment. */
  paceMinPerKm: number;
  /** Straight-line segment length in kilometres. */
  distanceKm: number;
  /** Epoch milliseconds of the segment start crossing. */
  startedAt: number;
};

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(a: SegmentAnchor, b: SegmentAnchor): number {
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Crossing = {
  /** Index of the track point at or after the crossing. */
  index: number;
  /** Interpolated epoch milliseconds of the crossing. */
  timeMs: number;
  /** Fraction between the two samples (0..1). */
  fraction: number;
};

/**
 * Locates where a track passes near an anchor and interpolates the crossing
 * time. Picks the sample with the smallest distance to the anchor and, when
 * both neighbours have usable timestamps, linearly interpolates between them.
 * Returns null when the track has no timestamps or the anchor is further than
 * `maxDistanceKm` from every sample (a real pass should be within GPS noise).
 */
export function findCrossing(
  points: RoutePoint[],
  anchor: SegmentAnchor,
  maxDistanceKm = 0.08,
): Crossing | null {
  if (points.length < 2) return null;

  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const distance = haversineKm(point, anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestDistance > maxDistanceKm) return null;

  const current = points[bestIndex];
  const currentTime = current.t;
  if (currentTime === undefined || !Number.isFinite(currentTime)) return null;

  // Interpolate between the sample and its closer neighbour: the crossing
  // sits at the anchor's relative distance between the two samples.
  const previous = bestIndex > 0 ? points[bestIndex - 1] : undefined;
  const next = bestIndex < points.length - 1 ? points[bestIndex + 1] : undefined;

  const prevDistance = previous && Number.isFinite(previous.lat) ? haversineKm(previous, anchor) : Infinity;
  const nextDistance = next && Number.isFinite(next.lat) ? haversineKm(next, anchor) : Infinity;

  const previousTime = previous?.t;
  const nextTime = next?.t;

  if (previous && previousTime !== undefined && Number.isFinite(previousTime) && prevDistance < nextDistance) {
    const span = currentTime - previousTime;
    const total = prevDistance + bestDistance;
    const fraction = total > 0 ? prevDistance / total : 0;
    return { index: bestIndex, timeMs: previousTime + span * fraction, fraction };
  }
  if (next && nextTime !== undefined && Number.isFinite(nextTime)) {
    const span = nextTime - currentTime;
    const total = bestDistance + nextDistance;
    const fraction = total > 0 ? bestDistance / total : 0;
    return { index: bestIndex, timeMs: currentTime + span * fraction, fraction };
  }

  return { index: bestIndex, timeMs: currentTime, fraction: 0 };
}

/**
 * Scores one run's track against a segment. The start anchor must be crossed
 * before the end anchor; otherwise the runner went the other way and the
 * attempt is skipped.
 */
export function computeSegmentEffort(
  workoutUuid: string,
  points: RoutePoint[],
  segment: Pick<SegmentDefinition, 'start' | 'end'>,
): SegmentEffort | null {
  const start = findCrossing(points, segment.start);
  if (!start) return null;

  // Search the end anchor only after the start crossing: a course loop passes
  // both anchors twice, and the segment is the first forward traversal.
  const afterStart = points.slice(start.index);
  const end = findCrossing(afterStart, segment.end);
  if (!end) return null;

  const startedAt = start.timeMs;
  const endedAt = end.timeMs;
  if (endedAt <= startedAt) return null;

  const seconds = Math.round((endedAt - startedAt) / 1000);
  // Guard against GPS teleporting: a sub-minute or multi-hour "effort" on a
  // short course slice is noise, not a run.
  if (seconds <= 30 || seconds > 6 * 3600) return null;

  const distanceKm = haversineKm(segment.start, segment.end);
  if (distanceKm <= 0.01) return null;

  return {
    workoutUuid,
    seconds,
    paceMinPerKm: Math.round(((seconds / 60) / distanceKm) * 100) / 100,
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    startedAt: Math.round(startedAt),
  };
}

/** Formats seconds as m:ss (or h:mm:ss for long efforts). */
export function formatEffortTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = `${minutes}`.padStart(hours > 0 ? 2 : 1, '0');
  const ss = `${secs}`.padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** Formats a pace in minutes-per-km as m:ss. */
export function formatEffortPace(paceMinPerKm: number): string {
  const minutes = Math.floor(paceMinPerKm);
  const seconds = Math.round((paceMinPerKm - minutes) * 60);
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}
