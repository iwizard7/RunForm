import { WorkoutData } from '@/lib/parser';

/**
 * Distance-based personal bests.
 *
 * The imported workout JSON does not contain per-kilometre splits, so a true
 * "fastest 1 km inside this run" cannot be measured. Instead this module
 * estimates the pace the athlete could have held for a target distance, using
 * two transparent corrections on top of the workout average:
 *
 *   1. how much of the run was spent in hard heart-rate zones (a run with more
 *      steady hard work supports a faster short-distance effort), and
 *   2. a distance taper derived from Riegel's endurance model.
 *
 * A personal best is only registered when the workout actually covered the
 * target distance, so a 2.5 km jog can never claim a 5 km record.
 */

export type PersonalBestType = '1k' | '5k' | '10k' | 'half' | 'full';

export type PersonalBestCandidate = {
  type: PersonalBestType;
  /** Estimated time in seconds for the target distance. */
  seconds: number;
  /** Estimated pace in minutes per kilometre. */
  paceMinutes: number;
  distance: number;
};

const TIER_DISTANCES: Array<{ type: PersonalBestType; km: number }> = [
  { type: '1k', km: 1 },
  { type: '5k', km: 5 },
  { type: '10k', km: 10 },
  { type: 'half', km: 21.0975 },
  { type: 'full', km: 42.195 },
];

/** Riegel exponent used to scale pace between distances. */
const RIEGEL_EXPONENT = 0.06;

/** Share of a single best-effort run that can realistically be spent in Z4-Z5. */
const MAX_HARD_SHARE = 0.5;

/** How much of the observed hard-zone share is credited to a fresh race effort. */
const TAPER_FACTOR = 0.04;

export function parsePaceToMinutesLocal(pace: string): number {
  if (!pace) {
    return 0;
  }
  const match = pace.trim().match(/(\d+)\s*[:'′]\s*(\d{1,2})/);
  if (match) {
    const minutes = Number.parseInt(match[1], 10) || 0;
    const seconds = Number.parseInt(match[2], 10) || 0;
    return minutes + seconds / 60;
  }
  const minutes = Number.parseInt(pace.replace(/\D/g, ''), 10) || 0;
  return minutes;
}

/**
 * Normalizes a zone key or label to a zone number: `zone4`, `z4`, `Z4` and the
 * `PEAK`/`CARDIO` labels all map onto 4/5, so keys and names are never counted
 * twice.
 */
export function getZoneNumber(key: string, name?: string): number | null {
  const labels: Record<string, number> = {
    'WARM UP': 1,
    'FAT BURN': 2,
    CARDIO: 4,
    THRESHOLD: 4,
    PEAK: 5,
  };

  for (const candidate of [key, name ?? '']) {
    const normalized = candidate.trim().toUpperCase();
    if (normalized.length === 0) {
      continue;
    }
    const numbered = normalized.match(/^(?:ZONE|Z)\s*([1-5])$/);
    if (numbered) {
      return Number.parseInt(numbered[1], 10);
    }
    if (labels[normalized] !== undefined) {
      return labels[normalized];
    }
  }

  return null;
}

/** Share of the workout spent in heart-rate zones 4 and 5 (0..1). */
export function getHardZoneShare(workout: WorkoutData): number {
  const zones = (workout.zones ?? {}) as Record<string, { rate?: number; name?: string }>;
  // Group by zone number first: a payload may describe the same zone through
  // both its key and its label, which must not be added twice.
  const rateByZone = new Map<number, number>();

  for (const [key, zone] of Object.entries(zones)) {
    const zoneNumber = getZoneNumber(key, zone?.name);
    if (zoneNumber === null) {
      continue;
    }
    const rate = typeof zone?.rate === 'number' && Number.isFinite(zone.rate) ? zone.rate : 0;
    rateByZone.set(zoneNumber, Math.max(rateByZone.get(zoneNumber) ?? 0, rate));
  }

  const hardShare = (rateByZone.get(4) ?? 0) + (rateByZone.get(5) ?? 0);
  if (!Number.isFinite(hardShare) || hardShare <= 0) {
    return 0;
  }
  // Rounded before clamping so that floating point sums (0.35 + 0.1) compare
  // predictably against the cap.
  return Math.min(1, Number(hardShare.toFixed(4)));
}

/** Riegel-derived multiplier that turns a 1 km pace into a pace for `km`. */
export function getDistanceTaper(km: number): number {
  const pivot = 5;
  const pivotTaper = Math.pow(pivot / 1, RIEGEL_EXPONENT);
  return Math.pow(km, RIEGEL_EXPONENT) / pivotTaper;
}

/**
 * Estimated pace (min/km) for `km` based on a completed workout, or null when
 * the workout has no usable pace/distance.
 */
export function estimateBestEffortPace(workout: WorkoutData, km: number): number | null {
  const averagePace = parsePaceToMinutesLocal(workout.pace);
  if (!Number.isFinite(averagePace) || averagePace <= 0) {
    return null;
  }

  const hardShare = Math.min(getHardZoneShare(workout), MAX_HARD_SHARE);
  const taper = TAPER_FACTOR * (hardShare / MAX_HARD_SHARE);
  const pace = averagePace * (1 - taper) * getDistanceTaper(km);

  return Number.isFinite(pace) && pace > 0 ? Number(pace.toFixed(4)) : null;
}

/**
 * Personal best candidates supported by a single workout. Only distances the
 * workout actually covered are returned.
 */
export function buildPersonalBestCandidates(workout: WorkoutData): PersonalBestCandidate[] {
  if (!Number.isFinite(workout.distance) || workout.distance <= 0) {
    return [];
  }

  const candidates: PersonalBestCandidate[] = [];

  for (const tier of TIER_DISTANCES) {
    if (workout.distance < tier.km) {
      continue;
    }
    const paceMinutes = estimateBestEffortPace(workout, tier.km);
    if (paceMinutes === null) {
      continue;
    }
    candidates.push({
      type: tier.type,
      paceMinutes,
      seconds: Math.round(paceMinutes * tier.km * 60),
      distance: tier.km,
    });
  }

  return candidates;
}

export function getTierDistance(type: PersonalBestType): number {
  return TIER_DISTANCES.find((tier) => tier.type === type)?.km ?? 0;
}

export type PersonalBestRecord = {
  type: PersonalBestType;
  paceMinutes: number;
  seconds: number;
  achievedAt: string;
  workoutUuid: string;
};

/**
 * Merges new candidates into existing records. Returns only the records that
 * improved, so callers can persist exactly those.
 */
export function selectImprovedRecords(
  existing: Array<{ type: string; value: number }>,
  candidates: PersonalBestCandidate[],
): PersonalBestCandidate[] {
  const currentByType = new Map(existing.map((row) => [row.type, row.value]));

  return candidates.filter((candidate) => {
    const current = currentByType.get(candidate.type);
    // Stored values are pace in minutes per km.
    return current === undefined || candidate.paceMinutes < current;
  });
}

export function formatPersonalBest(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }
  const totalMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${totalMinutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
