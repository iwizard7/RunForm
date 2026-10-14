'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ensurePersonalBests, getDashboardData, getShoes, saveWorkout, clearAllWorkouts } from '@/lib/actions';
import type { SaveWorkoutResult } from '@/lib/actions';
import { parseWorkoutJSON, WorkoutData } from '@/lib/parser';
import type { Shoe } from '@/lib/actions';
import { defaultPreferences, UserPreferences } from '@/lib/ai';
import { requestOllama } from '@/lib/ollama';

const emptySubscribe = () => () => {};

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const VISION_SYSTEM_PROMPT = `You convert screenshots of running workouts into JSON for a running app. Output ONLY a single raw JSON object — no markdown fences, no commentary.
Schema: {"name": string, "startDate": ISO8601 string, "endDate": ISO8601 string, "duration": {"value": seconds}, "distance": {"value": kilometres}, "pace": {"value": "M'SS\\""}, "activeCalories": {"value": kcal}, "averageHeartRate": {"value": bpm}, "minHeartRate": {"value": bpm}, "maxHeartRate": {"value": bpm}, "averageIntensity": {"value": 0-100}, "averageMETs": {"value": number}, "cadence": {"value": spm}, "location": "Outdoor" or "Treadmill", "source": "Screenshot"}.
Extract only values visible in the image; omit fields that are not shown. When the date is not visible, use today (${new Date().toISOString().slice(0, 10)}).`;

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  });
}

/**
 * Older builds stored the threshold pace in seconds per km (e.g. 300) while
 * the app logic uses minutes per km (e.g. 5.0). Normalize legacy values so a
 * saved preference keeps working.
 */
function normalizePreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== 'object') {
    return defaultPreferences;
  }
  const parsed = raw as Partial<UserPreferences>;
  const thresholdPace =
    typeof parsed.thresholdPace === 'number' && Number.isFinite(parsed.thresholdPace) && parsed.thresholdPace > 60
      ? parsed.thresholdPace / 60
      : parsed.thresholdPace;
  return {
    ...defaultPreferences,
    ...parsed,
    hrZones: { ...defaultPreferences.hrZones, ...(parsed.hrZones ?? {}) },
    thresholdPace: typeof thresholdPace === 'number' && thresholdPace > 0 ? thresholdPace : defaultPreferences.thresholdPace,
  };
}

export function useWorkoutData() {
  const [workout, setWorkout] = useState<WorkoutData | null>(null);
  const [history, setHistory] = useState<WorkoutData[]>([]);
  const [profileName, setProfileName] = useState(() => {
    if (typeof window === 'undefined') {
      return 'Athlete';
    }
    return window.localStorage.getItem('runform.profileName') || 'Athlete';
  });
  
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    if (typeof window === 'undefined') {
      return defaultPreferences;
    }
    const saved = window.localStorage.getItem('runform.preferences');
    if (saved) {
      try {
        return normalizePreferences(JSON.parse(saved));
      } catch {
        return defaultPreferences;
      }
    }
    return defaultPreferences;
  });

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const hasInitializedCalendar = useRef(false);
  const hasBackfilledPBs = useRef(false);
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const [shoes, setShoes] = useState<Shoe[]>([]);

  const loadShoes = useCallback(async () => {
    const data = await getShoes();
    setShoes(data);
  }, []);

  const refreshData = useCallback(async (): Promise<boolean> => {
    let data: Awaited<ReturnType<typeof getDashboardData>>;
    try {
      data = await getDashboardData();
    } catch (err) {
      console.error('[RunForm] refreshData: getDashboardData() failed:', err);
      return false;
    }
    setWorkout(data.latestWorkout);
    setHistory(data.history);
    await loadShoes();

    if (!hasInitializedCalendar.current && data.history.length > 0) {
      const latestDate = new Date(data.history[0].startDate);
      const year = latestDate.getFullYear();
      const month = `${latestDate.getMonth() + 1}`.padStart(2, '0');
      const day = `${latestDate.getDate()}`.padStart(2, '0');
      setSelectedDateKey(`${year}-${month}-${day}`);
      setCurrentMonth(new Date(latestDate.getFullYear(), latestDate.getMonth(), 1));
      hasInitializedCalendar.current = true;
    }
    return true;
  }, [loadShoes]);

  const importWorkoutFile = async (file: File): Promise<SaveWorkoutResult> => {
    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('The selected file is not valid JSON.');
    }
    const parsed = parseWorkoutJSON(json as Parameters<typeof parseWorkoutJSON>[0]);
    const result = await saveWorkout(parsed);
    await refreshData();
    return result;
  };

  /**
   * Recognizes a workout from a screenshot (Strava, Garmin, watch photo, ...)
   * with a local vision model and stores it through the regular import path.
   */
  const importWorkoutFromScreenshot = async (file: File): Promise<SaveWorkoutResult> => {
    if (!file.type.startsWith('image/')) {
      throw new Error('The selected file is not an image.');
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      throw new Error('The screenshot is too large.');
    }

    const base64 = await fileToBase64(file);
    const data = await requestOllama({
      system: VISION_SYSTEM_PROMPT,
      prompt: 'Screenshot of a running workout. Convert it to the JSON schema.',
      images: [base64],
    });

    const text = data.response ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('The model returned no JSON object.');
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      throw new Error('The model returned malformed JSON.');
    }

    // Keep the source identifiable and let the parser assign a fresh uuid.
    json.source = json.source || 'Screenshot';
    const parsed = parseWorkoutJSON(json as Parameters<typeof parseWorkoutJSON>[0]);
    const result = await saveWorkout(parsed);
    await refreshData();
    return result;
  };

  const assignShoe = async (workoutId: string, shoeId: string | null) => {
    const { assignShoeToWorkout } = await import('@/lib/actions');
    await assignShoeToWorkout(workoutId, shoeId);
    await refreshData();
  };

  const updateTags = async (workoutId: string, tags: string[]) => {
    const { updateWorkoutTags } = await import('@/lib/actions');
    await updateWorkoutTags(workoutId, tags);
    await refreshData();
  };

  const updateNote = async (workoutId: string, note: string) => {
    const { updateWorkoutNote } = await import('@/lib/actions');
    await updateWorkoutNote(workoutId, note);
    await refreshData();
  };

  const resetWorkouts = async () => {
    await clearAllWorkouts();
    setSelectedDateKey(null);
    hasInitializedCalendar.current = false;
    await refreshData();
  };

  useEffect(() => {
    // Retry logic: if the Server Action fails on first load (server still
    // warming up in production), retry up to 3 times with increasing delays.
    // refreshData is the single loading path, so calendar/shoe state can never
    // drift between the initial load and later refreshes.
    let cancelled = false;
    const pendingTimers: number[] = [];
    const delays = [0, 1000, 2000, 4000];

    const tryLoad = async (attempt: number) => {
      if (cancelled) return;
      const ok = await refreshData();
      if (!ok && !cancelled && attempt + 1 < delays.length) {
        const t = window.setTimeout(() => void tryLoad(attempt + 1), delays[attempt + 1]);
        pendingTimers.push(t);
      }
    };

    const initial = window.setTimeout(() => void tryLoad(0), 0);
    pendingTimers.push(initial);

    return () => {
      cancelled = true;
      pendingTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [refreshData]);

  useEffect(() => {
    // Personal bests are normally kept up to date by saveWorkout. The table
    // still needs a one-time rebuild when it is empty (after the migration
    // that introduced per-condition records, or a database reset). The server
    // action no-ops when records already exist, so this never wipes or
    // replays the history on every page load.
    if (history.length === 0 || hasBackfilledPBs.current) {
      return;
    }
    hasBackfilledPBs.current = true;
    void ensurePersonalBests()
      .then((result) => {
        if (result.rebuilt && result.records > 0) {
          void refreshData();
        }
      })
      .catch((error) => {
        console.error('[RunForm] ensurePersonalBests failed:', error);
        hasBackfilledPBs.current = false;
      });
  }, [history.length, refreshData]);

  useEffect(() => {
    if (!isClient) {
      return;
    }
    window.localStorage.setItem('runform.profileName', profileName.trim() || 'Athlete');
  }, [isClient, profileName]);

  useEffect(() => {
    if (!isClient) {
      return;
    }
    window.localStorage.setItem('runform.preferences', JSON.stringify(preferences));
  }, [isClient, preferences]);

  return {
    workout,
    setWorkout,
    history,
    shoes,
    loadShoes,
    isClient,
    profileName,
    setProfileName,
    preferences,
    setPreferences,
    currentMonth,
    setCurrentMonth,
    selectedDateKey,
    setSelectedDateKey,
    refreshData,
    importWorkoutFile,
    importWorkoutFromScreenshot,
    assignShoe,
    updateTags,
    updateNote,
    resetWorkouts,
  };
}
