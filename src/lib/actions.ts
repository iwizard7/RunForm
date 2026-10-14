'use server';

import db, { DB_DIR } from './db';
import { WorkoutData, RoutePoint } from './parser';
import { buildPersonalBestCandidates, selectImprovedRecords } from './personal-best';
import { computeRouteFingerprint } from './routes';
import { computeSegmentEffort, haversineKm } from './segments';
import { getWorkoutCondition } from './workout-condition';
import {
  createBackup,
  getDatabaseInfo as readDatabaseInfo,
  listBackups,
  restoreBackup,
  type BackupEntry,
  type DatabaseInfo,
} from './backup';

interface WorkoutRow {
  uuid: string;
  name: string;
  activity_name: string;
  activity_type: number;
  start_date: string;
  end_date: string;
  duration: number;
  calories: number;
  distance: number;
  pace: string;
  avg_intensity: number;
  min_intensity: number;
  max_intensity: number;
  average_mets: number;
  avg_hr: number;
  min_hr: number;
  max_hr: number;
  hrv?: number;
  cadence: number;
  steps: number;
  location: string;
  source: string;
  weather_temp: string;
  weather_hum: string;
  zones_json: string;
  pace_zones_json?: string;
  device_name: string;
  device_manufacturer: string;
  device_model: string;
  device_hw_version: string;
  device_sw_version: string;
  shoe_id?: string;
  tags_json?: string;
  route_json?: string;
  route_id?: string;
  notes?: string;
}

export interface Shoe {
  id: string;
  name: string;
  brand: string;
  model: string;
  maxDistance: number;
  distanceRun: number;
  isActive: boolean;
  createdAt: string;
}

export type DashboardData = {
  latestWorkout: WorkoutData | null;
  history: WorkoutData[];
};

function parseZones(zonesJson: string | null | undefined): WorkoutData['zones'] {
  if (!zonesJson) {
    return {};
  }

  try {
    return JSON.parse(zonesJson) as WorkoutData['zones'];
  } catch {
    return {};
  }
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRowToWorkout(row: Partial<WorkoutRow> & Pick<WorkoutRow, 'uuid' | 'name' | 'start_date' | 'end_date'>): WorkoutData {
  return {
    uuid: row.uuid,
    name: row.name ?? 'Workout',
    activityName: row.activity_name ?? row.name ?? 'Workout',
    activityType: row.activity_type ?? 37,
    startDate: row.start_date,
    endDate: row.end_date,
    duration: row.duration ?? 0,
    calories: row.calories ?? 0,
    distance: row.distance ?? 0,
    pace: row.pace ?? "0'00\"",
    averageIntensity: row.avg_intensity ?? 0,
    minIntensity: row.min_intensity ?? 0,
    maxIntensity: row.max_intensity ?? 0,
    averageMETs: row.average_mets ?? 0,
    avgHeartRate: row.avg_hr ?? 0,
    minHeartRate: row.min_hr ?? 0,
    maxHeartRate: row.max_hr ?? 0,
    hrv: row.hrv,
    cadence: row.cadence ?? 0,
    steps: row.steps ?? 0,
    location: row.location ?? 'Unknown',
    source: row.source ?? 'Unknown',
    weather: {
      temperature: row.weather_temp ?? 'N/A',
      humidity: row.weather_hum ?? 'N/A',
    },
    zones: parseZones(row.zones_json),
    paceZones: parseZones(row.pace_zones_json),
    device: {
      name: row.device_name ?? 'Unknown',
      manufacturer: row.device_manufacturer ?? 'Unknown',
      model: row.device_model ?? 'Unknown',
      hardwareVersion: row.device_hw_version ?? 'Unknown',
      softwareVersion: row.device_sw_version ?? 'Unknown',
    },
    shoeId: row.shoe_id,
    tags: parseJsonValue(row.tags_json, [] as string[]),
    route: parseJsonValue(row.route_json, [] as NonNullable<WorkoutData['route']>),
    routeId: row.route_id,
    notes: row.notes ?? null,
  };
}

const insertWorkoutStatement = db.prepare(`
  INSERT INTO workouts (
    uuid, name, activity_name, activity_type, start_date, end_date,
    duration, calories, distance, pace, avg_intensity, min_intensity,
    max_intensity, average_mets, avg_hr, min_hr, max_hr, hrv, cadence,
    steps, location, source, weather_temp, weather_hum, zones_json, pace_zones_json,
    device_name, device_manufacturer, device_model, device_hw_version, device_sw_version,
    shoe_id, tags_json, route_json, route_id
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
  ON CONFLICT(uuid) DO UPDATE SET
    name = excluded.name,
    activity_name = excluded.activity_name,
    activity_type = excluded.activity_type,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    duration = excluded.duration,
    calories = excluded.calories,
    distance = excluded.distance,
    pace = excluded.pace,
    avg_intensity = excluded.avg_intensity,
    min_intensity = excluded.min_intensity,
    max_intensity = excluded.max_intensity,
    average_mets = excluded.average_mets,
    avg_hr = excluded.avg_hr,
    min_hr = excluded.min_hr,
    max_hr = excluded.max_hr,
    hrv = excluded.hrv,
    cadence = excluded.cadence,
    steps = excluded.steps,
    location = excluded.location,
    source = excluded.source,
    weather_temp = excluded.weather_temp,
    weather_hum = excluded.weather_hum,
    zones_json = excluded.zones_json,
    pace_zones_json = excluded.pace_zones_json,
    device_name = excluded.device_name,
    device_manufacturer = excluded.device_manufacturer,
    device_model = excluded.device_model,
    device_hw_version = excluded.device_hw_version,
    device_sw_version = excluded.device_sw_version,
    route_json = excluded.route_json
`);
// NOTE: shoe_id, tags_json and route_id are deliberately NOT overwritten on
// conflict. They hold user edits (shoe assignment, tags) or data derived after
// the insert (route matching), and a re-imported file must never wipe them.
// An upsert also keeps the row in place, so ON DELETE CASCADE on
// personal_bests.workout_uuid cannot fire the way INSERT OR REPLACE did.

const workoutExistsStatement = db.prepare('SELECT 1 FROM workouts WHERE uuid = ?');

const selectAllWorkoutsStatement = db.prepare('SELECT * FROM workouts ORDER BY start_date DESC');
const selectLatestWorkoutStatement = db.prepare('SELECT * FROM workouts ORDER BY start_date DESC LIMIT 1');
const deleteAllWorkoutsStatement = db.prepare('DELETE FROM workouts');

export type SaveWorkoutResult = {
  success: true;
  /** True when a workout with the same uuid already existed and was replaced. */
  duplicate: boolean;
};

export async function saveWorkout(data: WorkoutData): Promise<SaveWorkoutResult> {
  const duplicate = workoutExistsStatement.get(data.uuid) !== undefined;

  insertWorkoutStatement.run(
    data.uuid,
    data.name,
    data.activityName,
    data.activityType ?? 37,
    data.startDate,
    data.endDate,
    data.duration,
    data.calories,
    data.distance,
    data.pace,
    data.averageIntensity,
    data.minIntensity,
    data.maxIntensity,
    data.averageMETs,
    data.avgHeartRate,
    data.minHeartRate,
    data.maxHeartRate,
    data.hrv ?? null,
    data.cadence,
    data.steps,
    data.location,
    data.source,
    data.weather.temperature,
    data.weather.humidity,
    JSON.stringify(data.zones),
    JSON.stringify(data.paceZones || {}),
    data.device.name,
    data.device.manufacturer,
    data.device.model,
    data.device.hardwareVersion,
    data.device.softwareVersion,
    data.shoeId ?? null,
    data.tags ? JSON.stringify(data.tags) : null,
    data.route ? JSON.stringify(data.route) : null,
    data.routeId ?? null,
  );

  await checkAndStorePBs(data);
  if (data.route && data.route.length > 0) {
    await matchAndAssignRoute(data.uuid, JSON.stringify(data.route));
  }
  return { success: true, duplicate };
}

export async function getAllWorkouts(): Promise<WorkoutData[]> {
  const rows = selectAllWorkoutsStatement.all() as WorkoutRow[];
  return rows.map(mapRowToWorkout);
}

export async function getLatestWorkout(): Promise<WorkoutData | null> {
  const row = selectLatestWorkoutStatement.get() as WorkoutRow | undefined;
  return row ? mapRowToWorkout(row) : null;
}

export async function getDashboardData(): Promise<DashboardData> {
  const rows = selectAllWorkoutsStatement.all() as WorkoutRow[];
  const history = rows.map(mapRowToWorkout);
  return {
    latestWorkout: history[0] ?? null,
    history,
  };
}

export async function clearAllWorkouts() {
  deleteAllWorkoutsStatement.run();
  await updateShoeDistance();
  return { success: true };
}

// === Database Backup & Restore ===

/**
 * Takes a consistent snapshot of the whole database into `<dataDir>/backups/`.
 */
export async function createDatabaseBackup(): Promise<BackupEntry> {
  return createBackup(DB_DIR);
}

export async function listDatabaseBackups(): Promise<BackupEntry[]> {
  return listBackups(DB_DIR);
}

/** Path, size and row counts of the live database for the Settings panel. */
export async function getDatabaseInfo(): Promise<DatabaseInfo> {
  return readDatabaseInfo(DB_DIR);
}

/**
 * Restores a backup by name from the backups directory. A safety snapshot of
 * the current state is created first; failures return `success: false`
 * without touching the database.
 */
export async function restoreDatabaseBackup(
  fileName: string,
): Promise<{ success: true; restoredWorkouts: number; safetyBackup: string } | { success: false; error: string }> {
  try {
    const result = await restoreBackup(DB_DIR, fileName);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// === Equipment Tracker (Shoes) ===

type ShoeRow = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  max_distance: number | null;
  distance_run: number | null;
  is_active: number | null;
  created_at: string;
};

export async function getShoes(): Promise<Shoe[]> {
  const rows = db.prepare('SELECT * FROM shoes ORDER BY created_at DESC').all() as ShoeRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand ?? '',
    model: row.model ?? '',
    maxDistance: row.max_distance ?? 0,
    distanceRun: row.distance_run ?? 0,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  }));
}

export async function addShoe(data: Omit<Shoe, 'id' | 'distanceRun' | 'isActive' | 'createdAt'>) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO shoes (id, name, brand, model, max_distance)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.name, data.brand, data.model, data.maxDistance);
  return { success: true, id };
}

export async function updateShoeDistance() {
  // Recalculates distance for all shoes based on connected workouts
  db.prepare(`
    UPDATE shoes SET distance_run = (
      SELECT COALESCE(SUM(distance), 0) FROM workouts WHERE shoe_id = shoes.id
    )
  `).run();
  return { success: true };
}

export async function assignShoeToWorkout(workoutId: string, shoeId: string | null) {
  db.prepare('UPDATE workouts SET shoe_id = ? WHERE uuid = ?').run(shoeId, workoutId);
  await updateShoeDistance();
  return { success: true };
}

export async function toggleShoeActive(shoeId: string, isActive: boolean) {
  db.prepare('UPDATE shoes SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, shoeId);
  return { success: true };
}

// === Tagging ===

export async function updateWorkoutTags(workoutId: string, tags: string[]) {
  db.prepare('UPDATE workouts SET tags_json = ? WHERE uuid = ?').run(JSON.stringify(tags), workoutId);
  return { success: true };
}

/**
 * Saves the free-text post-run note. An empty string clears the note. The
 * column is deliberately outside the import path, so re-importing a workout
 * never clobbers what the athlete wrote afterwards.
 */
export async function updateWorkoutNote(workoutId: string, note: string) {
  db.prepare('UPDATE workouts SET notes = ? WHERE uuid = ?').run(note.trim() ? note.trim() : null, workoutId);
  return { success: true };
}

// === Personal Bests ===

export interface PersonalBest {
  id: string;
  type: string;
  /** Best estimated pace in minutes per kilometre. */
  value: number;
  workoutUuid: string;
  achievedAt: string;
  condition: 'indoor' | 'outdoor';
}

export async function getPersonalBests(condition?: string): Promise<PersonalBest[]> {
  const rows = (
    condition
      ? db.prepare('SELECT * FROM personal_bests WHERE condition = ? ORDER BY type ASC').all(condition)
      : db.prepare('SELECT * FROM personal_bests ORDER BY type ASC').all()
  ) as Array<{
    id: string;
    type: string;
    value: number;
    workout_uuid: string;
    achieved_at: string;
    condition: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    value: row.value,
    workoutUuid: row.workout_uuid,
    achievedAt: row.achieved_at,
    condition: row.condition === 'indoor' ? 'indoor' : 'outdoor',
  }));
}

export async function checkAndStorePBs(data: WorkoutData): Promise<PersonalBest[]> {
  const candidates = buildPersonalBestCandidates(data);
  if (candidates.length === 0) {
    return [];
  }

  const condition = getWorkoutCondition(data.location);
  const existing = db
    .prepare('SELECT type, value FROM personal_bests WHERE condition = ?')
    .all(condition) as Array<{ type: string; value: number }>;

  const improved = selectImprovedRecords(existing, candidates);
  const updateStatement = db.prepare(
    'UPDATE personal_bests SET value = ?, workout_uuid = ?, achieved_at = ? WHERE type = ? AND condition = ?',
  );
  const insertStatement = db.prepare(
    'INSERT INTO personal_bests (id, type, value, workout_uuid, achieved_at, condition) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const stored: PersonalBest[] = [];
  for (const candidate of improved) {
    const updated = updateStatement.run(
      candidate.paceMinutes,
      data.uuid,
      data.startDate,
      candidate.type,
      condition,
    );

    if (updated.changes === 0) {
      insertStatement.run(
        crypto.randomUUID(),
        candidate.type,
        candidate.paceMinutes,
        data.uuid,
        data.startDate,
        condition,
      );
    }

    stored.push({
      id: `${candidate.type}-${condition}`,
      type: candidate.type,
      value: candidate.paceMinutes,
      workoutUuid: data.uuid,
      achievedAt: data.startDate,
      condition,
    });
  }

  return stored;
}

/**
 * Rebuilds personal bests from the stored workout history.
 *
 * Migration 7 discarded the old records because they were derived from the
 * workout average pace and gave every distance the same value. This replays the
 * history in chronological order so the table is populated again without
 * requiring a manual re-import.
 */
export async function backfillPersonalBests(): Promise<{ success: true; records: number }> {
  const rows = db.prepare('SELECT * FROM workouts ORDER BY start_date ASC').all() as WorkoutRow[];

  const rebuild = db.transaction((workouts: WorkoutRow[]) => {
    const deleteStatement = db.prepare('DELETE FROM personal_bests');
    const selectExistingStatement = db.prepare(
      'SELECT type, value FROM personal_bests WHERE condition = ?',
    );
    const updateStatement = db.prepare(
      'UPDATE personal_bests SET value = ?, workout_uuid = ?, achieved_at = ? WHERE type = ? AND condition = ?',
    );
    const insertStatement = db.prepare(
      'INSERT INTO personal_bests (id, type, value, workout_uuid, achieved_at, condition) VALUES (?, ?, ?, ?, ?, ?)',
    );

    deleteStatement.run();
    for (const row of workouts) {
      const workout = mapRowToWorkout(row);
      const condition = getWorkoutCondition(workout.location);
      const candidates = buildPersonalBestCandidates(workout);
      if (candidates.length === 0) {
        continue;
      }

      const existing = selectExistingStatement.all(condition) as Array<{ type: string; value: number }>;
      const improved = selectImprovedRecords(existing, candidates);

      for (const candidate of improved) {
        const updated = updateStatement.run(
          candidate.paceMinutes,
          workout.uuid,
          workout.startDate,
          candidate.type,
          condition,
        );

        if (updated.changes === 0) {
          insertStatement.run(
            crypto.randomUUID(),
            candidate.type,
            candidate.paceMinutes,
            workout.uuid,
            workout.startDate,
            condition,
          );
        }
      }
    }
  });

  rebuild(rows);

  const count = (db.prepare('SELECT COUNT(*) AS count FROM personal_bests').get() as { count: number }).count;
  return { success: true, records: count };
}

/**
 * Runs the one-time backfill only while the personal-bests table is empty.
 *
 * The dashboard used to replay the whole history on every page load, which was
 * wasteful and raced between open tabs. New saves keep the table up to date via
 * checkAndStorePBs, so a rebuild is only needed when the table was wiped
 * (migration 7 or a manual reset).
 */
export async function ensurePersonalBests(): Promise<{ rebuilt: boolean; records: number }> {
  const count = (db.prepare('SELECT COUNT(*) AS count FROM personal_bests').get() as { count: number }).count;
  if (count > 0) {
    return { rebuilt: false, records: count };
  }

  const result = await backfillPersonalBests();
  return { rebuilt: true, records: result.records };
}

// === Training Plans ===

export interface TrainingSession {
  day?: string;
  date?: string;
  type?: string;
  phase?: string;
  duration?: string;
  zone?: string;
  hr_range?: string;
  pace?: string;
  notes?: string;
  /** Multi-week race plans: week number and target distance. */
  week?: number;
  distance?: string;
  intensity?: string;
}

export interface TrainingPlan {
  id: string;
  goal: string;
  status: string;
  sessions: TrainingSession[];
  startDate: string;
  endDate?: string;
}

type TrainingPlanRow = {
  id: string;
  goal: string;
  status: string | null;
  sessions_json: string | null;
  start_date: string;
  end_date: string | null;
};

export async function getTrainingPlans(): Promise<TrainingPlan[]> {
  const rows = db.prepare('SELECT * FROM training_plans ORDER BY created_at DESC').all() as TrainingPlanRow[];
  return rows.map((row) => ({
    id: row.id,
    goal: row.goal,
    status: row.status ?? 'active',
    sessions: parseJsonValue<TrainingSession[]>(row.sessions_json, []),
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
  }));
}

export async function saveTrainingPlan(goal: string, sessions: TrainingSession[]) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO training_plans (id, goal, sessions_json)
    VALUES (?, ?, ?)
  `).run(id, goal, JSON.stringify(sessions));
  return { success: true as const, id };
}

export async function updateTrainingPlanStatus(planId: string, status: 'active' | 'completed' | 'cancelled') {
  db.prepare('UPDATE training_plans SET status = ?, end_date = CASE WHEN ? = \'active\' THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id = ?').run(
    status,
    status,
    planId,
  );
  return { success: true as const };
}

export async function deleteTrainingPlan(planId: string) {
  db.prepare('DELETE FROM training_plans WHERE id = ?').run(planId);
  return { success: true as const };
}

// === Body Metrics ===

export interface BodyMetric {
  id: string;
  date: string;
  weight?: number;
  muscleMass?: number;
  fatPercentage?: number;
  sorenessLevel?: number;
  notes?: string;
}

type BodyMetricRow = {
  id: string;
  date: string;
  weight: number | null;
  muscle_mass: number | null;
  fat_percentage: number | null;
  soreness_level: number | null;
  notes: string | null;
};

export async function getBodyMetrics(): Promise<BodyMetric[]> {
  const rows = db.prepare('SELECT * FROM body_metrics ORDER BY date DESC').all() as BodyMetricRow[];
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    weight: row.weight ?? undefined,
    muscleMass: row.muscle_mass ?? undefined,
    fatPercentage: row.fat_percentage ?? undefined,
    sorenessLevel: row.soreness_level ?? undefined,
    notes: row.notes ?? undefined,
  }));
}

export async function saveBodyMetric(metric: Omit<BodyMetric, 'id'>) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO body_metrics (id, date, weight, muscle_mass, fat_percentage, soreness_level, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, metric.date, metric.weight, metric.muscleMass, metric.fatPercentage, metric.sorenessLevel, metric.notes);
  return { success: true, id };
}

// === Route Intelligence ===

export interface Route {
  id: string;
  name: string;
  fingerprint: string;
  distance: number;
  runCount: number;
  lastRunAt: string | null;
}

type RouteRow = {
  id: string;
  name: string;
  fingerprint: string;
  distance: number | null;
  run_count: number;
  last_run_at: string | null;
};

export async function getRoutes(): Promise<Route[]> {
  const rows = db
    .prepare(`
      SELECT
        routes.id,
        routes.name,
        routes.fingerprint,
        routes.distance,
        COUNT(workouts.uuid) AS run_count,
        MAX(workouts.start_date) AS last_run_at
      FROM routes
      LEFT JOIN workouts ON workouts.route_id = routes.id
      GROUP BY routes.id
      ORDER BY run_count DESC, routes.created_at ASC
    `)
    .all() as RouteRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    fingerprint: row.fingerprint,
    distance: row.distance ?? 0,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
  }));
}

export async function renameRoute(routeId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { success: false as const, error: 'Route name cannot be empty' };
  }
  db.prepare('UPDATE routes SET name = ? WHERE id = ?').run(trimmed, routeId);
  return { success: true as const };
}

/**
 * Matches a workout GPS track to an existing route by geometric fingerprint,
 * creating the route when it is not known yet.
 */
export async function matchAndAssignRoute(workoutUuid: string, routeJson: string) {
  if (!routeJson) {
    return { success: false as const, error: 'No route data' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(routeJson);
  } catch {
    return { success: false as const, error: 'Route data is not valid JSON' };
  }

  const points = Array.isArray(parsed) ? parsed : [];
  const fingerprint = computeRouteFingerprint(points);
  if (!fingerprint) {
    return { success: false as const, error: 'Track too short to identify a route' };
  }

  const existing = db.prepare('SELECT id FROM routes WHERE fingerprint = ?').get(fingerprint) as
    | { id: string }
    | undefined;

  let routeId = existing?.id;
  if (!routeId) {
    routeId = crypto.randomUUID();
    const routeCount = (db.prepare('SELECT COUNT(*) AS count FROM routes').get() as { count: number }).count;
    db.prepare('INSERT INTO routes (id, name, fingerprint) VALUES (?, ?, ?)').run(
      routeId,
      `Route ${routeCount + 1}`,
      fingerprint,
    );
  }

  db.prepare('UPDATE workouts SET route_id = ? WHERE uuid = ?').run(routeId, workoutUuid);

  // Score the run against any segments already defined on this course.
  const hasSegments = db.prepare('SELECT id FROM segments WHERE route_id = ? LIMIT 1').get(routeId);
  if (hasSegments) {
    await recomputeSegmentEffortsForWorkout(workoutUuid, routeId);
  }

  return { success: true as const, routeId };
}

// === Segments ===
//
// Segment math (crossing detection, effort timing) is pure and lives in
// ./segments.ts; these actions just persist definitions and recompute efforts
// from each workout's stored GPS track. Efforts are refreshed on route
// assignment, so importing or re-importing a run scores it automatically.

async function recomputeSegmentEffortsForWorkout(workoutUuid: string, routeId: string) {
  const segments = db
    .prepare('SELECT id, start_lat, start_lng, end_lat, end_lng FROM segments WHERE route_id = ?')
    .all(routeId) as Array<{ id: string; start_lat: number; start_lng: number; end_lat: number; end_lng: number }>;
  if (segments.length === 0) return;

  const row = db.prepare('SELECT route_json FROM workouts WHERE uuid = ?').get(workoutUuid) as
    | { route_json: string | null }
    | undefined;
  if (!row?.route_json) return;

  let points: RoutePoint[];
  try {
    points = JSON.parse(row.route_json) as RoutePoint[];
  } catch {
    return;
  }
  if (!Array.isArray(points) || points.length < 2) return;

  const upsert = db.prepare(`
    INSERT INTO segment_efforts (id, segment_id, workout_uuid, seconds, pace, distance, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(segment_id, workout_uuid)
    DO UPDATE SET seconds = excluded.seconds, pace = excluded.pace,
                  distance = excluded.distance, started_at = excluded.started_at
  `);

  for (const segment of segments) {
    const effort = computeSegmentEffort(workoutUuid, points, {
      start: { lat: segment.start_lat, lng: segment.start_lng },
      end: { lat: segment.end_lat, lng: segment.end_lng },
    });
    if (!effort) {
      db.prepare('DELETE FROM segment_efforts WHERE segment_id = ? AND workout_uuid = ?').run(segment.id, workoutUuid);
      continue;
    }
    upsert.run(
      crypto.randomUUID(),
      segment.id,
      workoutUuid,
      effort.seconds,
      effort.paceMinPerKm,
      effort.distanceKm,
      new Date(effort.startedAt).toISOString(),
    );
  }
}

export type SegmentSummary = {
  id: string;
  routeId: string;
  name: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  distanceKm: number;
  effortCount: number;
  bestSeconds: number | null;
};

export async function getSegmentsForRoute(routeId: string): Promise<SegmentSummary[]> {
  const rows = db
    .prepare(`
      SELECT s.id, s.route_id, s.name, s.start_lat, s.start_lng, s.end_lat, s.end_lng,
             (SELECT COUNT(*) FROM segment_efforts e WHERE e.segment_id = s.id) AS effort_count,
             (SELECT MIN(e.seconds) FROM segment_efforts e WHERE e.segment_id = s.id) AS best_seconds
      FROM segments s WHERE s.route_id = ? ORDER BY s.created_at
    `)
    .all(routeId) as Array<{
    id: string;
    route_id: string;
    name: string;
    start_lat: number;
    start_lng: number;
    end_lat: number;
    end_lng: number;
    effort_count: number;
    best_seconds: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    routeId: row.route_id,
    name: row.name,
    start: { lat: row.start_lat, lng: row.start_lng },
    end: { lat: row.end_lat, lng: row.end_lng },
    distanceKm: haversineKm({ lat: row.start_lat, lng: row.start_lng }, { lat: row.end_lat, lng: row.end_lng }),
    effortCount: row.effort_count,
    bestSeconds: row.best_seconds,
  }));
}

export type SegmentEffortEntry = {
  workoutUuid: string;
  workoutName: string;
  startDate: string;
  seconds: number;
  paceMinPerKm: number;
  startedAt: string | null;
  isPersonalBest: boolean;
};

export async function getSegmentEfforts(segmentId: string): Promise<SegmentEffortEntry[]> {
  const rows = db
    .prepare(`
      SELECT e.workout_uuid, e.seconds, e.pace, e.started_at, w.name AS workout_name, w.start_date,
             (SELECT MIN(x.seconds) FROM segment_efforts x WHERE x.segment_id = e.segment_id) AS best
      FROM segment_efforts e
      JOIN workouts w ON w.uuid = e.workout_uuid
      WHERE e.segment_id = ?
      ORDER BY e.seconds ASC
    `)
    .all(segmentId) as Array<{
    workout_uuid: string;
    seconds: number;
    pace: number;
    started_at: string | null;
    workout_name: string;
    start_date: string;
    best: number;
  }>;

  return rows.map((row) => ({
    workoutUuid: row.workout_uuid,
    workoutName: row.workout_name,
    startDate: row.start_date,
    seconds: row.seconds,
    paceMinPerKm: row.pace,
    startedAt: row.started_at,
    isPersonalBest: row.seconds === row.best,
  }));
}

export async function createSegment(
  routeId: string,
  name: string,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): Promise<{ success: boolean; error?: string; segmentId?: string }> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: 'Segment name is required' };
  }
  const distanceKm = haversineKm(start, end);
  if (distanceKm < 0.05) {
    return { success: false, error: 'Segment is too short (min 50 m)' };
  }
  const route = db.prepare('SELECT id FROM routes WHERE id = ?').get(routeId);
  if (!route) {
    return { success: false, error: 'Route not found' };
  }

  const segmentId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO segments (id, route_id, name, start_lat, start_lng, end_lat, end_lng)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(segmentId, routeId, trimmed, start.lat, start.lng, end.lat, end.lng);

  // Score every run already recorded on this route.
  const workouts = db
    .prepare('SELECT uuid FROM workouts WHERE route_id = ? AND route_json IS NOT NULL')
    .all(routeId) as Array<{ uuid: string }>;
  for (const workout of workouts) {
    await recomputeSegmentEffortsForWorkout(workout.uuid, routeId);
  }

  return { success: true, segmentId };
}

export async function deleteSegment(segmentId: string): Promise<{ success: boolean }> {
  db.prepare('DELETE FROM segments WHERE id = ?').run(segmentId);
  return { success: true };
}

// === AI Coach Chat ===

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

type ChatRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

/** Returns the most recent chat messages in chronological order. */
export async function getChatMessages(limit = 50): Promise<ChatMessage[]> {
  const bounded = Math.max(1, Math.min(200, limit));
  // rowid keeps insertion order stable even when several messages share the
  // same second-resolution created_at timestamp. It must be selected
  // explicitly: `SELECT *` never includes the implicit rowid column.
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at FROM (
         SELECT rowid AS position, id, role, content, created_at
         FROM ai_chat_messages ORDER BY rowid DESC LIMIT ?
       ) ORDER BY position ASC`,
    )
    .all(bounded) as ChatRow[];

  return rows.map((row) => ({
    id: row.id,
    role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function addChatMessage(role: 'user' | 'assistant', content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return { success: false as const, error: 'Message cannot be empty' };
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO ai_chat_messages (id, role, content) VALUES (?, ?, ?)').run(
    id,
    role === 'assistant' ? 'assistant' : 'user',
    trimmed,
  );
  return { success: true as const, id };
}

export async function clearChatMessages() {
  db.prepare('DELETE FROM ai_chat_messages').run();
  return { success: true as const };
}
