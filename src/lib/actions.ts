'use server';

import db from './db';
import { WorkoutData } from './parser';
import { parsePaceToMinutes } from './ai';

interface WorkoutRow {
  uuid: string;
  name: string;
  activity_name: string;
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
  };
}

const insertWorkoutStatement = db.prepare(`
  INSERT OR REPLACE INTO workouts (
    uuid, name, activity_name, activity_type, start_date, end_date,
    duration, calories, distance, pace, avg_intensity, min_intensity,
    max_intensity, average_mets, avg_hr, min_hr, max_hr, hrv, cadence,
    steps, location, source, weather_temp, weather_hum, zones_json, pace_zones_json,
    device_name, device_manufacturer, device_model, device_hw_version, device_sw_version,
    shoe_id, tags_json, route_json, route_id
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

const selectAllWorkoutsStatement = db.prepare('SELECT * FROM workouts ORDER BY start_date DESC');
const selectLatestWorkoutStatement = db.prepare('SELECT * FROM workouts ORDER BY start_date DESC LIMIT 1');
const deleteAllWorkoutsStatement = db.prepare('DELETE FROM workouts');

export async function saveWorkout(data: WorkoutData) {
  insertWorkoutStatement.run(
    data.uuid,
    data.name,
    data.activityName,
    37,
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
  if (data.route) {
    await matchAndAssignRoute(data.uuid, JSON.stringify(data.route));
  }
  return { success: true };
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

// === Equipment Tracker (Shoes) ===

export async function getShoes(): Promise<Shoe[]> {
  const rows = db.prepare('SELECT * FROM shoes ORDER BY created_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    brand: r.brand,
    model: r.model,
    maxDistance: r.max_distance,
    distanceRun: r.distance_run,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at
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

// === Personal Bests ===

export interface PersonalBest {
  id: string;
  type: string;
  value: number;
  workoutUuid: string;
  achievedAt: string;
}

export async function getPersonalBests(): Promise<PersonalBest[]> {
  const rows = db.prepare('SELECT * FROM personal_bests').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    value: r.value,
    workoutUuid: r.workout_uuid,
    achievedAt: r.achieved_at,
  }));
}

export async function checkAndStorePBs(data: WorkoutData) {
  const pbs = [
    { type: '1k', value: data.distance >= 1 ? parsePaceToMinutes(data.pace) : null },
    { type: '5k', value: data.distance >= 5 ? parsePaceToMinutes(data.pace) : null },
    { type: '10k', value: data.distance >= 10 ? parsePaceToMinutes(data.pace) : null },
  ];

  for (const pb of pbs) {
    if (pb.value === null) continue;

    const existing = db.prepare('SELECT value FROM personal_bests WHERE type = ?').get(pb.type) as { value: number } | undefined;

    if (!existing || pb.value < existing.value) {
      db.prepare(`
        INSERT OR REPLACE INTO personal_bests (id, type, value, workout_uuid, achieved_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), pb.type, pb.value, data.uuid, data.startDate);
    }
  }
}

// === Training Plans ===

export interface TrainingPlan {
  id: string;
  goal: string;
  status: string;
  sessions: any[];
  startDate: string;
  endDate?: string;
}

export async function getTrainingPlans(): Promise<TrainingPlan[]> {
  const rows = db.prepare('SELECT * FROM training_plans ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    goal: r.goal,
    status: r.status,
    sessions: JSON.parse(r.sessions_json || '[]'),
    startDate: r.start_date,
    endDate: r.end_date,
  }));
}

export async function saveTrainingPlan(goal: string, sessions: any[]) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO training_plans (id, goal, sessions_json)
    VALUES (?, ?, ?)
  `).run(id, goal, JSON.stringify(sessions));
  return { success: true, id };
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

export async function getBodyMetrics(): Promise<BodyMetric[]> {
  const rows = db.prepare('SELECT * FROM body_metrics ORDER BY date DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    weight: r.weight,
    muscleMass: r.muscle_mass,
    fatPercentage: r.fat_percentage,
    sorenessLevel: r.soreness_level,
    notes: r.notes,
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
}

export async function getRoutes(): Promise<Route[]> {
  const rows = db.prepare('SELECT * FROM routes').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fingerprint: r.fingerprint,
    distance: r.distance,
  }));
}

export async function matchAndAssignRoute(workoutUuid: string, routeJson: string) {
  if (!routeJson) return;
  
  // Very simple "Route Intelligence": use first coordinate as fingerprint for now
  // In a real app, this would be a geometric simplify + hash
  const coords = JSON.parse(routeJson);
  if (!coords || coords.length === 0) return;
  
  const fingerprint = `${coords[0].lat.toFixed(4)},${coords[0].lng.toFixed(4)}`;
  
  let route = db.prepare('SELECT id FROM routes WHERE fingerprint = ?').get(fingerprint) as { id: string } | undefined;
  
  if (!route) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO routes (id, name, fingerprint) VALUES (?, ?, ?)').run(id, 'New Route', fingerprint);
    route = { id };
  }
  
  db.prepare('UPDATE workouts SET route_id = ? WHERE uuid = ?').run(route.id, workoutUuid);
  return { success: true, routeId: route.id };
}
