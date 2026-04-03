export interface WorkoutZone {
  name: string;
  rate: number;
  time: {
    value: number;
    unit: string;
  };
}

export interface WorkoutData {
  uuid: string;
  name: string;
  activityName: string;
  startDate: string;
  endDate: string;
  duration: number; // in seconds
  calories: number;
  distance: number; // in km
  pace: string;
  averageIntensity: number;
  minIntensity: number;
  maxIntensity: number;
  averageMETs: number;
  avgHeartRate: number;
  minHeartRate: number;
  maxHeartRate: number;
  zones: Record<string, WorkoutZone>;
  cadence: number;
  steps: number;
  location: string;
  source: string;
  weather: {
    temperature: string;
    humidity: string;
  };
  device: {
    name: string;
    manufacturer: string;
    model: string;
    hardwareVersion: string;
    softwareVersion: string;
  };
}

interface WorkoutMetric<T> {
  value: T;
  unit?: string;
}

interface RawWorkoutData {
  uuid?: string;
  name?: string;
  activity?: {
    name?: string;
    type?: number;
  };
  startDate?: string;
  endDate?: string;
  duration?: WorkoutMetric<number>;
  activeCalories?: WorkoutMetric<number>;
  distance?: WorkoutMetric<number>;
  pace?: WorkoutMetric<string>;
  averageIntensity?: WorkoutMetric<number>;
  minIntensity?: WorkoutMetric<number>;
  maxIntensity?: WorkoutMetric<number>;
  averageMETs?: WorkoutMetric<number>;
  averageHeartRate?: WorkoutMetric<number>;
  minHeartRate?: WorkoutMetric<number>;
  maxHeartRate?: WorkoutMetric<number>;
  cadence?: WorkoutMetric<number>;
  step?: WorkoutMetric<number>;
  location?: string;
  source?: string;
  weather?: {
    temperature?: string;
    humidity?: string;
  };
  zones?: Record<string, WorkoutZone>;
  device?: {
    name?: string;
    manufacturer?: string;
    model?: string;
    hardwareVersion?: string;
    softwareVersion?: string;
  };
}

export function parseWorkoutJSON(json: RawWorkoutData): WorkoutData {
  return {
    uuid: json.uuid || Math.random().toString(36).substring(7),
    name: json.name || "Workout",
    activityName: json.activity?.name || json.name || "Workout",
    startDate: json.startDate || new Date().toISOString(),
    endDate: json.endDate || json.startDate || new Date().toISOString(),
    duration: json.duration?.value || 0,
    calories: json.activeCalories?.value || 0,
    distance: json.distance?.value || 0,
    pace: json.pace?.value || "0'00\"",
    averageIntensity: json.averageIntensity?.value || 0,
    minIntensity: json.minIntensity?.value || 0,
    maxIntensity: json.maxIntensity?.value || 0,
    averageMETs: json.averageMETs?.value || 0,
    avgHeartRate: json.averageHeartRate?.value || 0,
    minHeartRate: json.minHeartRate?.value || 0,
    maxHeartRate: json.maxHeartRate?.value || 0,
    zones: json.zones || {},
    cadence: json.cadence?.value || 0,
    steps: json.step?.value || 0,
    location: json.location || "Unknown",
    source: json.source || "Unknown",
    weather: {
      temperature: json.weather?.temperature || "N/A",
      humidity: json.weather?.humidity || "N/A"
    },
    device: {
      name: json.device?.name || "Unknown",
      manufacturer: json.device?.manufacturer || "Unknown",
      model: json.device?.model || "Unknown",
      hardwareVersion: json.device?.hardwareVersion || "Unknown",
      softwareVersion: json.device?.softwareVersion || "Unknown"
    }
  };
}
