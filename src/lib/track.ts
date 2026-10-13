import { RoutePoint } from './parser';
import { WorkoutSplit, haversineKm } from './splits';

export type TrackPoint = { x: number; y: number };

export type TrackGeometry = {
  /** Consecutive polyline chunks (one per colour) as SVG path data. */
  paths: Array<{ d: string; color: string }>;
  start: TrackPoint;
  end: TrackPoint;
  /** Number of valid GPS points the geometry was built from. */
  pointCount: number;
};

export const TRACK_WIDTH = 640;
export const TRACK_HEIGHT = 340;

/** Green → red ramp: fast split → slow split. */
export const PACE_STOPS = ['#34c759', '#ffcc00', '#ff9500', '#ff3b30'];

const DEFAULT_COLOR = '#007aff';

function filterValid(points: RoutePoint[]): RoutePoint[] {
  return points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Maps a split pace onto the green→red ramp between the slowest and fastest
 * split of this workout (relative colouring — the map always shows where this
 * particular run was fast and where it slowed down).
 */
export function paceColor(paceSec: number, minSec: number, maxSec: number): string {
  if (!(maxSec > minSec)) return PACE_STOPS[0];
  const clamped = Math.min(1, Math.max(0, (paceSec - minSec) / (maxSec - minSec)));
  const scaled = clamped * (PACE_STOPS.length - 1);
  const index = Math.min(PACE_STOPS.length - 2, Math.floor(scaled));
  return mixHex(PACE_STOPS[index], PACE_STOPS[index + 1], scaled - index);
}

/**
 * Projects route points into an SVG viewport with an equirectangular
 * approximation around the mean latitude — accurate enough at run scale and
 * keeps the track north-up with the aspect ratio preserved.
 */
export function projectRoute(
  points: RoutePoint[],
  width = TRACK_WIDTH,
  height = TRACK_HEIGHT,
  pad = 18,
): TrackPoint[] | null {
  const valid = filterValid(points);
  if (valid.length < 2) return null;

  const meanLat = valid.reduce((sum, point) => sum + point.lat, 0) / valid.length;
  const kx = Math.cos((meanLat * Math.PI) / 180) || 1e-9;
  const xs = valid.map((point) => point.lng * kx);
  const ys = valid.map((point) => point.lat);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);

  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return xs.map((x, index) => ({
    x: Number((offsetX + (x - minX) * scale).toFixed(1)),
    // Flip the Y axis so north stays up in SVG coordinates.
    y: Number((height - (offsetY + (ys[index] - minY) * scale)).toFixed(1)),
  }));
}

/**
 * Builds drawable geometry for a workout track. Consecutive segments that
 * share a pace colour are merged into one SVG path to keep the node count
 * small on long runs. Tracks without timestamps fall back to one plain path.
 */
export function buildTrackGeometry(
  points: RoutePoint[],
  splits: WorkoutSplit[],
  width = TRACK_WIDTH,
  height = TRACK_HEIGHT,
): TrackGeometry | null {
  const valid = filterValid(points);
  if (valid.length < 2) return null;
  const projected = projectRoute(valid, width, height);
  if (!projected) return null;

  // Which kilometre (0-based) every segment belongs to, from cumulative
  // haversine distance along the recorded points. The epsilon absorbs
  // floating-point drift so a segment starting exactly on a kilometre
  // boundary lands in the new split instead of the previous one.
  const segmentKm: number[] = [];
  let cum = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    segmentKm.push(Math.floor(cum + 1e-9));
    cum += haversineKm(valid[i], valid[i + 1]);
  }

  const paceByKm = new Map<number, number>();
  for (const split of splits) {
    if (split.paceSec !== undefined) paceByKm.set(split.km, split.paceSec);
  }
  const paces = Array.from(paceByKm.values());
  const minPace = paces.length > 0 ? Math.min(...paces) : 0;
  const maxPace = paces.length > 0 ? Math.max(...paces) : 0;

  const colorForKm = (kmIndex: number): string => {
    if (paces.length === 0) return DEFAULT_COLOR;
    const pace = paceByKm.get(kmIndex + 1); // splits are 1-based
    if (pace === undefined) return DEFAULT_COLOR;
    return paceColor(pace, minPace, maxPace);
  };

  const paths: Array<{ d: string; color: string }> = [];
  let currentColor = colorForKm(segmentKm[0]);
  let d = `M ${projected[0].x} ${projected[0].y}`;
  for (let i = 0; i < segmentKm.length; i++) {
    const color = colorForKm(segmentKm[i]);
    if (color !== currentColor) {
      paths.push({ d, color: currentColor });
      // Continue from the shared vertex so chunks join without a gap.
      d = `M ${projected[i].x} ${projected[i].y}`;
      currentColor = color;
    }
    d += ` L ${projected[i + 1].x} ${projected[i + 1].y}`;
  }
  paths.push({ d, color: currentColor });

  return {
    paths,
    start: projected[0],
    end: projected[projected.length - 1],
    pointCount: projected.length,
  };
}
