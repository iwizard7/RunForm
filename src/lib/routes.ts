import { RoutePoint } from '@/lib/parser';

/**
 * Route fingerprinting.
 *
 * Runs of the same course rarely have identical GPS start points, but they do
 * share overall geometry. The fingerprint samples a few points along the track
 * and rounds them, which is stable across slightly different starts while still
 * separating different courses.
 */

const SAMPLE_COUNT = 6;
const COORD_PRECISION = 3; // ~110 m, tolerant to GPS jitter
const MIN_POINTS = 20;

export function roundCoordinate(value: number, precision = COORD_PRECISION) {
  return Number(value.toFixed(precision));
}

/**
 * Returns a stable fingerprint for a GPS track, or null when the track is too
 * short to identify a course.
 */
export function computeRouteFingerprint(route: RoutePoint[] | undefined | null): string | null {
  if (!route || route.length < MIN_POINTS) {
    return null;
  }

  const usable = route.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && (point.lat !== 0 || point.lng !== 0),
  );

  if (usable.length < MIN_POINTS) {
    return null;
  }

  const samples: string[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const position = Math.round((index * (usable.length - 1)) / (SAMPLE_COUNT - 1));
    const point = usable[position];
    samples.push(`${roundCoordinate(point.lat)},${roundCoordinate(point.lng)}`);
  }

  return samples.join('|');
}

/**
 * Rough great-circle length of a track in kilometres. Used to describe a route
 * and to decide whether two tracks are on the same scale.
 */
export function computeRouteLengthKm(route: RoutePoint[] | undefined | null): number {
  if (!route || route.length < 2) {
    return 0;
  }

  const earthRadiusKm = 6371;
  let total = 0;

  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const deltaLat = ((current.lat - previous.lat) * Math.PI) / 180;
    const deltaLng = ((current.lng - previous.lng) * Math.PI) / 180;
    const lat1 = (previous.lat * Math.PI) / 180;
    const lat2 = (current.lat * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    total += 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  return Number(total.toFixed(3));
}
