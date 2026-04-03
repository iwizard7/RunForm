'use server';

import db from './db';
import { WorkoutData } from './parser';

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
  cadence: number;
  steps: number;
  location: string;
  source: string;
  weather_temp: string;
  weather_hum: string;
  zones_json: string;
  device_name: string;
  device_manufacturer: string;
  device_model: string;
  device_hw_version: string;
  device_sw_version: string;
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
    cadence: row.cadence ?? 0,
    steps: row.steps ?? 0,
    location: row.location ?? 'Unknown',
    source: row.source ?? 'Unknown',
    weather: {
      temperature: row.weather_temp ?? 'N/A',
      humidity: row.weather_hum ?? 'N/A',
    },
    zones: parseZones(row.zones_json),
    device: {
      name: row.device_name ?? 'Unknown',
      manufacturer: row.device_manufacturer ?? 'Unknown',
      model: row.device_model ?? 'Unknown',
      hardwareVersion: row.device_hw_version ?? 'Unknown',
      softwareVersion: row.device_sw_version ?? 'Unknown',
    },
  };
}

const insertWorkoutStatement = db.prepare(`
  INSERT OR REPLACE INTO workouts (
    uuid, name, activity_name, activity_type, start_date, end_date,
    duration, calories, distance, pace, avg_intensity, min_intensity,
    max_intensity, average_mets, avg_hr, min_hr, max_hr, cadence,
    steps, location, source, weather_temp, weather_hum, zones_json,
    device_name, device_manufacturer, device_model, device_hw_version, device_sw_version
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    data.cadence,
    data.steps,
    data.location,
    data.source,
    data.weather.temperature,
    data.weather.humidity,
    JSON.stringify(data.zones),
    data.device.name,
    data.device.manufacturer,
    data.device.model,
    data.device.hardwareVersion,
    data.device.softwareVersion,
  );

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
  return { success: true };
}
