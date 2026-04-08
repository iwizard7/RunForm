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

  const refreshData = async () => {
    const data = await getDashboardData();
    setWorkout(data.latestWorkout);
    setHistory(data.history);

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

  const resetWorkouts = async () => {
    await clearAllWorkouts();
    setSelectedDateKey(null);
    hasInitializedCalendar.current = false;
    await refreshData();
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshData();
    }, 0);

    return () => window.clearTimeout(timer);
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
    resetWorkouts,
  };
}
