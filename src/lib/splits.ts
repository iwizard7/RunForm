import { WorkoutData } from './parser';

export interface WorkoutSplit {
  /** 1-based split number; the final entry may be a partial kilometre. */
  km: number;
  /** Distance covered by this split in kilometres (1.0 except the last one). */
  distance: number;
  /** Average heart rate across the samples inside the split, when available. */
  avgHr?: number;
  /** Seconds per kilometre for the split, only when samples carry timestamps. */
  paceSec?: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Splits a GPS track into per-kilometre segments with average heart rate and,
 * when the device exported sample timestamps, the real pace of every split.
 *
 * The last entry is the partial kilometre after the final full one. Tracks
 * without points or with degenerate geometry produce an empty list.
 */
export function computeWorkoutSplits(workout: Pick<WorkoutData, 'route'>): WorkoutSplit[] {
  const route = workout.route ?? [];
  if (route.length < 2) {
    return [];
  }

  const splits: WorkoutSplit[] = [];
  let cum = 0; // total kilometres before the current segment
  let boundary = 1; // next kilometre marker
  let hrSum = 0;
  let hrCount = 0;
  let boundaryTime = route[0].t ?? null;

  const pushSplit = (km: number, distance: number, endTime: number | null) => {
    const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;
    const paceSec =
      boundaryTime !== null && endTime !== null && distance > 0
        ? Math.round((endTime - boundaryTime) / 1000 / distance)
        : undefined;
    splits.push({ km, distance: Number(distance.toFixed(2)), avgHr, paceSec });
    boundaryTime = endTime;
    hrSum = 0;
    hrCount = 0;
  };

  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const cur = route[i];
    if (cur.hr !== undefined) {
      hrSum += cur.hr;
      hrCount += 1;
    }

    const seg = haversineKm(prev, cur);
    if (seg <= 0) {
      continue;
    }

    const segStart = cum;
    const segEnd = cum + seg;
    // Emit every kilometre marker that falls inside this segment; the marker
    // position (and its timestamp) is interpolated linearly between samples.
    while (boundary <= segEnd + 1e-9) {
      const fraction = Math.min(1, Math.max(0, (boundary - segStart) / seg));
      const crossTime =
        prev.t !== undefined && cur.t !== undefined
          ? prev.t + (cur.t - prev.t) * fraction
          : null;
      pushSplit(boundary, 1, crossTime);
      boundary += 1;
    }
    cum = segEnd;
  }

  const tailKm = cum - (boundary - 1);
  if (tailKm > 0.05) {
    pushSplit(boundary, tailKm, route[route.length - 1].t ?? null);
  }

  return splits;
}

/** Formats seconds as m'ss" (e.g. 335 -> 5'35"). */
export function formatSplitPace(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}'${rest}"`;
}
