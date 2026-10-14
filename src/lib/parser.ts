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
  activityType?: number;
  startDate: string;
  endDate: string;
  duration: number;
  calories: number;
  distance: number;
  pace: string;
  averageIntensity: number;
  minIntensity: number;
  maxIntensity: number;
  averageMETs: number;
  avgHeartRate: number;
  minHeartRate: number;
  maxHeartRate: number;
  zones: Record<string, WorkoutZone>;
  paceZones?: Record<string, WorkoutZone>;
  hrv?: number;
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
  shoeId?: string;
  tags?: string[];
  route?: RoutePoint[];
  routeId?: string;
  /** Free-text post-run note (typed or dictated); not touched by re-imports. */
  notes?: string | null;
}

interface WorkoutMetric<T> {
  value: T;
  unit?: string;
}

export type RoutePoint = {
  lat: number;
  lng: number;
  hr?: number;
  /** Sample time in epoch milliseconds when the device exported one. */
  t?: number;
};

type RawRoutePoint = {
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  hr?: number | string;
  heartRate?: number | string;
  heart_rate?: number | string;
  t?: number | string;
  timestamp?: number | string;
  time?: number | string;
};

type RawSample = {
  location?: RawRoutePoint[];
  locations?: RawRoutePoint[];
  route?: RawRoutePoint[];
};

function toFiniteNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes the many timestamp shapes exported by devices (epoch seconds,
 * epoch milliseconds, ISO strings) into epoch milliseconds. Small numbers are
 * ambiguous (they may be elapsed seconds), so they are dropped: per-kilometre
 * pace is only computed when every sample has a confident absolute time.
 */
function toEpochMs(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return toEpochMs(Number.parseFloat(trimmed));
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }
  if (value > 1e12) {
    return value; // epoch milliseconds
  }
  if (value > 1e9) {
    return value * 1000; // epoch seconds
  }
  return null; // ambiguous small value — ignored
}

function normalizeRoutePoints(points: unknown): RoutePoint[] {
  if (!Array.isArray(points)) {
    return [];
  }

  const route: RoutePoint[] = [];
  for (const candidate of points) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const point = candidate as RawRoutePoint;
    const lat = toFiniteNumber(point.lat ?? point.latitude);
    const lng = toFiniteNumber(point.lng ?? point.lon ?? point.longitude);
    if (lat === null || lng === null) {
      continue;
    }
    const hr = toFiniteNumber(point.hr ?? point.heartRate ?? point.heart_rate);
    const t = toEpochMs(point.t ?? point.timestamp ?? point.time);
    const normalized: RoutePoint = hr === null ? { lat, lng } : { lat, lng, hr: Math.round(hr) };
    if (t !== null) {
      normalized.t = t;
    }
    route.push(normalized);
  }

  return route;
}

/**
 * Extracts a GPS track from the many shapes exported by fitness devices:
 * a top-level `route` / `locations` / `routePoints` array, or samples nested
 * inside `exercises`. Returns an empty array when the payload has no GPS data.
 */
export function extractRoute(json: unknown): RoutePoint[] {
  if (!json || typeof json !== 'object') {
    return [];
  }

  const source = json as {
    route?: unknown;
    locations?: unknown;
    routePoints?: unknown;
    exercises?: Array<{ samples?: RawSample | RawSample[] }>;
  };

  const topLevel = normalizeRoutePoints(source.route ?? source.locations ?? source.routePoints);
  if (topLevel.length > 0) {
    return topLevel;
  }

  for (const exercise of source.exercises ?? []) {
    const samples = exercise?.samples;
    const sampleList = Array.isArray(samples) ? samples : samples ? [samples] : [];
    for (const sample of sampleList) {
      const nested = normalizeRoutePoints(sample?.location ?? sample?.locations ?? sample?.route);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
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
  hrv?: WorkoutMetric<number>;
  location?: string;
  source?: string;
  weather?: {
    temperature?: string;
    humidity?: string;
  };
  zones?: Record<string, WorkoutZone>;
  paceZones?: Record<string, WorkoutZone>;
  device?: {
    name?: string;
    manufacturer?: string;
    model?: string;
    hardwareVersion?: string;
    softwareVersion?: string;
  };
  route?: unknown;
  locations?: unknown;
  routePoints?: unknown;
  exercises?: Array<{ samples?: unknown }>;
}

export function parseWorkoutJSON(json: RawWorkoutData): WorkoutData {
  const route = extractRoute(json);

  return {
    uuid: json.uuid || crypto.randomUUID(),
    name: json.name || 'Workout',
    activityName: json.activity?.name || json.name || 'Workout',
    activityType: json.activity?.type,
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
    paceZones: json.paceZones || {},
    hrv: json.hrv?.value,
    cadence: json.cadence?.value || 0,
    steps: json.step?.value || 0,
    location: json.location || 'Unknown',
    source: json.source || 'Unknown',
    weather: {
      temperature: json.weather?.temperature || 'N/A',
      humidity: json.weather?.humidity || 'N/A',
    },
    device: {
      name: json.device?.name || 'Unknown',
      manufacturer: json.device?.manufacturer || 'Unknown',
      model: json.device?.model || 'Unknown',
      hardwareVersion: json.device?.hardwareVersion || 'Unknown',
      softwareVersion: json.device?.softwareVersion || 'Unknown',
    },
    route,
  };
}
