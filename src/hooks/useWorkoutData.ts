'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getDashboardData, saveWorkout, clearAllWorkouts } from '@/lib/actions';
import { parseWorkoutJSON, WorkoutData } from '@/lib/parser';
import { defaultPreferences, UserPreferences } from '@/lib/ai';

const emptySubscribe = () => () => {};

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
        return JSON.parse(saved);
      } catch (e) {
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
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const [shoes, setShoes] = useState<import('@/lib/actions').Shoe[]>([]);

  const loadShoes = async () => {
    const { getShoes } = await import('@/lib/actions');
    const data = await getShoes();
    setShoes(data);
  };

  const refreshData = async () => {
    let data: Awaited<ReturnType<typeof getDashboardData>>;
    try {
      data = await getDashboardData();
    } catch (err) {
      console.error('[RunForm] refreshData: getDashboardData() failed:', err);
      return;
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
  };

  const importWorkoutFile = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text);
    const parsed = parseWorkoutJSON(json);
    await saveWorkout(parsed);
    await refreshData();
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

  const resetWorkouts = async () => {
    await clearAllWorkouts();
    setSelectedDateKey(null);
    hasInitializedCalendar.current = false;
    await refreshData();
  };

  useEffect(() => {
    // Retry logic: if the Server Action fails on first load (server still
    // warming up in production), retry up to 3 times with increasing delays.
    let cancelled = false;
    const pendingTimers: number[] = [];
    const delays = [0, 1000, 2000, 4000];

    const tryLoad = async (attempt: number) => {
      if (cancelled) return;
      let data: Awaited<ReturnType<typeof getDashboardData>>;
      try {
        data = await getDashboardData();
      } catch (err) {
        console.error(`[RunForm] Load attempt ${attempt + 1} failed:`, err);
        if (attempt + 1 < delays.length) {
          const t = window.setTimeout(() => void tryLoad(attempt + 1), delays[attempt + 1]);
          pendingTimers.push(t);
        }
        return;
      }
      if (cancelled) return;
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
    };

    const initial = window.setTimeout(() => void tryLoad(0), 0);
    pendingTimers.push(initial);

    return () => {
      cancelled = true;
      pendingTimers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

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
    assignShoe,
    updateTags,
    resetWorkouts,
  };
}
