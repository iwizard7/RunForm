/**
 * Race-plan math: how long the plan is, what a valid multi-week plan looks
 * like, and the phase structure. Pure and client-safe — the Ollama prompt
 * building lives in the hook, everything here is deterministic and testable.
 */

export type RaceDistance = {
  key: string;
  /** Label in kilometres or miles-neutral wording, e.g. "Полумарафон". */
  labelRu: string;
  labelEn: string;
  /** Typical weekly volume hint for the prompt, in kilometres. */
  typicalLongRunKm: number;
};

export const RACE_DISTANCES: RaceDistance[] = [
  { key: '5k', labelRu: '5 км', labelEn: '5 km', typicalLongRunKm: 12 },
  { key: '10k', labelRu: '10 км', labelEn: '10 km', typicalLongRunKm: 18 },
  { key: 'half', labelRu: 'Полумарафон', labelEn: 'Half marathon', typicalLongRunKm: 24 },
  { key: 'marathon', labelRu: 'Марафон', labelEn: 'Marathon', typicalLongRunKm: 32 },
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
 * Shape check for the model's answer: a non-empty array where every entry has
 * a numeric week inside the planned range and a session type. Self-correction
 * retries in the hook lean on this returning a precise problem description.
 */
export function validateRaceSessions(
  value: unknown,
  totalWeeks: number,
): { ok: true; sessions: RaceSession[] } | { ok: false; problem: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, problem: 'the JSON array is empty or missing' };
  }
  const sessions: RaceSession[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (item === null || typeof item !== 'object') {
      return { ok: false, problem: `entry ${index} is not an object` };
    }
    const entry = item as Record<string, unknown>;
    const week = entry.week;
    if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > totalWeeks) {
      return {
        ok: false,
        problem: `entry ${index} has an invalid week (expected an integer 1..${totalWeeks}, got ${String(week)})`,
      };
    }
    if (typeof entry.type !== 'string' || !entry.type.trim()) {
      return { ok: false, problem: `entry ${index} has no session type` };
    }
    sessions.push({
      week,
      phase: typeof entry.phase === 'string' ? entry.phase.trim() : undefined,
      day: typeof entry.day === 'string' ? entry.day.trim() : undefined,
      type: entry.type.trim(),
      distance: typeof entry.distance === 'string' ? entry.distance.trim() : undefined,
      duration: typeof entry.duration === 'string' ? entry.duration.trim() : undefined,
      zone: typeof entry.zone === 'string' ? entry.zone.trim() : undefined,
      intensity: typeof entry.intensity === 'string' ? entry.intensity.trim() : undefined,
      notes: typeof entry.notes === 'string' ? entry.notes.trim() : undefined,
    });
  }
  // Every week from 1..totalWeeks must be represented, otherwise the plan has
  // holes the runner would only discover on the day.
  const weeks = new Set(sessions.map((session) => session.week));
  for (let week = 1; week <= totalWeeks; week += 1) {
    if (!weeks.has(week)) {
      return { ok: false, problem: `week ${week} has no sessions` };
    }
  }
  return { ok: true, sessions };
}

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
