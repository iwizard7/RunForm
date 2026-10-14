/**
 * Race-plan math: how long the plan is, the phase structure, the deterministic
 * schedule template, and the derivations (zones, durations, tips) applied on
 * top of it. Pure and client-safe — the Ollama overview prompt lives in the
 * hook; everything here is deterministic and testable.
 */

export type RaceDistance = {
  key: string;
  /** Label in kilometres or miles-neutral wording, e.g. "Полумарафон". */
  labelRu: string;
  labelEn: string;
  /** Typical long-run peak for the template, in kilometres. */
  typicalLongRunKm: number;
  /** The race distance itself as a session distance, e.g. "21.1 km". */
  raceKmLabel: string;
};

export const RACE_DISTANCES: RaceDistance[] = [
  { key: '5k', labelRu: '5 км', labelEn: '5 km', typicalLongRunKm: 12, raceKmLabel: '5 km' },
  { key: '10k', labelRu: '10 км', labelEn: '10 km', typicalLongRunKm: 18, raceKmLabel: '10 km' },
  { key: 'half', labelRu: 'Полумарафон', labelEn: 'Half marathon', typicalLongRunKm: 24, raceKmLabel: '21.1 km' },
  { key: 'marathon', labelRu: 'Марафон', labelEn: 'Marathon', typicalLongRunKm: 32, raceKmLabel: '42.2 km' },
];

const DAY_MS = 86400000;

/**
 * Whole weeks between today and race day, clamped to a range where a plan
 * makes sense: shorter than 4 weeks there is nothing to build, longer than
 * 24 weeks the model loses the thread. Returns null for past/too-close dates.
 */
export function weeksUntilRace(raceDate: string, today = new Date()): number | null {
  const target = new Date(`${raceDate}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (days < 28) return null;
  return Math.min(24, Math.max(4, Math.round(days / 7)));
}

export type RaceSession = {
  week: number;
  phase?: string;
  day?: string;
  type?: string;
  distance?: string;
  duration?: string;
  zone?: string;
  intensity?: string;
  notes?: string;
};

/**
 * Groups sessions by week, preserving first-appearance order of weeks.
 * Generic over the session shape so plans stored as TrainingSession[] (where
 * `week` is optional) group the same way as freshly parsed RaceSession[].
 */
export function groupSessionsByWeek<T extends { week?: number; phase?: string }>(
  sessions: T[],
): Array<{ week: number; phase: string; sessions: T[] }> {
  const groups: Array<{ week: number; phase: string; sessions: T[] }> = [];
  for (const session of sessions) {
    const week = session.week ?? 0;
    let group = groups.find((item) => item.week === week);
    if (!group) {
      group = { week, phase: session.phase ?? '', sessions: [] };
      groups.push(group);
    }
    if (!group.phase && session.phase) {
      group.phase = session.phase;
    }
    group.sessions.push(session);
  }
  return groups.sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------
// Deterministic expansion of the model's compact output
// ---------------------------------------------------------------------------

/**
 * Small local models burn minutes producing long per-session detail, so the
 * prompt asks only for the schedule skeleton (week/day/type/distance) and the
 * app derives phase, zone, duration and the coaching tip itself — faster to
 * generate, and the derivations are testable.
 */

/** Heart-rate zone per session type, matching the app's zone labeling. */
const ZONE_BY_TYPE: Record<string, string> = {
  'Easy Run': 'Z2',
  'Long Run': 'Z2',
  Recovery: 'Z1',
  Intervals: 'Z4',
  Tempo: 'Z3',
  Hills: 'Z3',
  'Cross-training': 'Z1',
  Rest: '-',
  Race: 'Z4',
};

/** Typical minutes per kilometre per type, used for duration estimates. */
const PACE_MIN_PER_KM: Record<string, number> = {
  'Easy Run': 6.5,
  'Long Run': 6.75,
  Recovery: 7,
  Intervals: 5.25,
  Tempo: 5.4,
  Hills: 6,
  Race: 5.1,
};

/** Short per-type tip shown in the plan rows. */
const TIP_BY_TYPE: Record<string, { ru: string; en: string }> = {
  'Easy Run': { ru: 'Спокойный темп, разговорная речь.', en: 'Conversational pace throughout.' },
  'Long Run': { ru: 'Длинный базовый забег — фундамент плана.', en: 'The aerobic cornerstone of the week.' },
  Recovery: { ru: 'Максимально мягко, тело восстанавливается.', en: 'Extra gentle — let the body recover.' },
  Intervals: { ru: 'Работа на пороге с полным восстановлением.', en: 'Hard reps with full recovery.' },
  Tempo: { ru: 'Уверенный полутемп, ровный темп.', en: 'Comfortably hard, steady effort.' },
  Hills: { ru: 'Подъёмы: сила и экономичность.', en: 'Hill work for strength and economy.' },
  'Cross-training': { ru: 'Плавание, велосипед или йога вместо бега.', en: 'Swim, bike or yoga instead of running.' },
  Rest: { ru: 'Полный день отдыха.', en: 'A full rest day.' },
  Race: { ru: 'День старта. Начни спокойно, финишуй с улыбкой.', en: 'Race day. Start controlled, finish smiling.' },
};

/** Intensity label per type, matching the plan row's expectations. */
function deriveIntensity(type: string | undefined): string {
  if (!type) return 'Low';
  if (['Intervals', 'Tempo', 'Race'].includes(type)) return 'High';
  if (['Recovery', 'Rest', 'Cross-training'].includes(type)) return 'Low';
  return 'Medium';
}

/**
 * Phase label from the week index: base → build → peak, with the last two
 * weeks reserved for the taper (the race week itself included).
 */
export function derivePhase(week: number, totalWeeks: number): string {
  if (week > totalWeeks - 2) return 'Taper';
  const share = week / totalWeeks;
  if (share <= 0.4) return 'Base';
  if (share <= 0.75) return 'Build';
  return 'Peak';
}

/** Parses "12 km" / "8.5km" / "-" into a number, or null. */
export function parseDistanceKm(distance: string | undefined): number | null {
  if (!distance) return null;
  const km = Number.parseFloat(distance.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(km) && km > 0 ? km : null;
}

/**
 * Estimated duration in minutes from distance and type pace; null for rest
 * and cross-training, where there is no meaningful running duration.
 */
export function estimateDurationMin(distance: string | undefined, type: string | undefined): number | null {
  const km = parseDistanceKm(distance);
  if (km === null) return null;
  const pace = (type ? PACE_MIN_PER_KM[type] : undefined) ?? 6.5;
  return Math.round(km * pace);
}

/**
 * Expands one compact model session into the full shape the plans tab
 * renders: phase, zone, duration, intensity and a coaching tip.
 */
export function expandRaceSession(
  session: RaceSession,
  totalWeeks: number,
  lang: 'ru' | 'en',
): RaceSession {
  const type = session.type;
  const durationMin = estimateDurationMin(session.distance, type);
  const tip = type ? TIP_BY_TYPE[type] : undefined;
  return {
    ...session,
    phase: session.phase ?? derivePhase(session.week, totalWeeks),
    zone: session.zone ?? (type ? ZONE_BY_TYPE[type] : undefined) ?? '-',
    duration: session.duration ?? (durationMin !== null ? `${durationMin} min` : '-'),
    intensity: session.intensity ?? deriveIntensity(type),
    notes: session.notes ?? (tip ? tip[lang] : undefined),
  };
}

// ---------------------------------------------------------------------------
// Deterministic plan template
// ---------------------------------------------------------------------------

/**
 * The schedule itself is built here, not by the model. Benchmarked on the
 * target hardware (8 GB, qwen3:4b at ~20 tok/s), even a four-session request
 * drowns in un-suppressible reasoning tokens and never finishes inside any
 * sane timeout — so the model is only asked for a short overview, while the
 * week-by-week skeleton stays local, instant and fully testable.
 */

export type RacePlanTemplateParams = {
  distance: RaceDistance;
  weeks: number;
  daysPerWeek: number;
  /** Runner's current weekly volume in km; 0 when unknown. */
  weeklyKm: number;
  lang: 'ru' | 'en';
};

/** Week pattern by sessions per week; the long run (or the race) is Sunday. */
const WEEK_PATTERN_BY_DAYS: Record<number, Array<{ day: string; type: string }>> = {
  3: [
    { day: 'Tue', type: 'Easy Run' },
    { day: 'Thu', type: 'Easy Run' },
    { day: 'Sun', type: 'Long Run' },
  ],
  4: [
    { day: 'Tue', type: 'Intervals' },
    { day: 'Wed', type: 'Easy Run' },
    { day: 'Fri', type: 'Easy Run' },
    { day: 'Sun', type: 'Long Run' },
  ],
  5: [
    { day: 'Tue', type: 'Intervals' },
    { day: 'Wed', type: 'Easy Run' },
    { day: 'Thu', type: 'Tempo' },
    { day: 'Sat', type: 'Easy Run' },
    { day: 'Sun', type: 'Long Run' },
  ],
  6: [
    { day: 'Mon', type: 'Easy Run' },
    { day: 'Tue', type: 'Intervals' },
    { day: 'Wed', type: 'Easy Run' },
    { day: 'Fri', type: 'Tempo' },
    { day: 'Sat', type: 'Recovery' },
    { day: 'Sun', type: 'Long Run' },
  ],
};

/** Rounds to the nearest 0.5 km — readable target distances. */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

function clampKm(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Total distance for a quality session, by type and phase. */
function qualityKm(type: string, phase: string): number {
  if (type === 'Intervals') return phase === 'Build' || phase === 'Peak' ? 10 : 8;
  return phase === 'Peak' ? 12 : phase === 'Build' ? 10 : 8; // Tempo
}

/**
 * Builds the full periodized schedule: a fixed microcycle per session count,
 * a long run that grows ~10%/week to its peak in the last hard week, a
 * two-week taper, and the race itself as the final Sunday session.
 */
export function buildRacePlanTemplate(params: RacePlanTemplateParams): RaceSession[] {
  const { distance, weeks, daysPerWeek, weeklyKm, lang } = params;
  const pattern = WEEK_PATTERN_BY_DAYS[daysPerWeek] ?? WEEK_PATTERN_BY_DAYS[4];
  const peak = distance.typicalLongRunKm;
  // The long run crests in the last hard week; the following two taper.
  const peakWeek = Math.min(weeks - 2, Math.max(3, Math.round(weeks * 0.78)));
  const baseline =
    weeklyKm > 0
      ? clampKm(roundHalf(weeklyKm * 0.35), 8, Math.max(8, peak - 4))
      : Math.min(10, Math.max(8, peak - 4));
  const easyKm = clampKm(roundHalf(baseline * 0.55), 5, 12);

  const sessions: RaceSession[] = [];
  for (let week = 1; week <= weeks; week += 1) {
    const phase = derivePhase(week, weeks);
    const isRaceWeek = week === weeks;
    for (const slot of pattern) {
      const type = isRaceWeek && slot.type === 'Long Run' ? 'Race' : slot.type;
      let distanceKm: string;
      if (type === 'Race') {
        distanceKm = distance.raceKmLabel;
      } else if (type === 'Long Run') {
        const longKm =
          phase === 'Taper'
            ? roundHalf(peak * 0.6)
            : roundHalf(baseline + (peak - baseline) * Math.min(1, (week - 1) / Math.max(1, peakWeek - 1)));
        distanceKm = `${longKm} km`;
      } else if (type === 'Recovery') {
        distanceKm = `${Math.max(4, easyKm - 2)} km`;
      } else if (type === 'Intervals' || type === 'Tempo') {
        distanceKm = `${qualityKm(type, phase)} km`;
      } else {
        distanceKm = `${easyKm} km`;
      }
      sessions.push(expandRaceSession({ week, phase, day: slot.day, type, distance: distanceKm }, weeks, lang));
    }
  }
  return sessions;
}
