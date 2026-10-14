'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addShoe,
  assignShoeToWorkout,
  backfillPersonalBests,
  getBodyMetrics,
  getPersonalBests,
  getRoutes,
  getShoes,
  renameRoute,
  saveBodyMetric,
  updateWorkoutTags,
  type BodyMetric,
  type PersonalBest,
  type Route,
  type Shoe,
} from '@/lib/actions';

/**
 * Owns the data that lives outside the workout history: personal bests,
 * body metrics, equipment and routes.
 *
 * Keeping it separate from useWorkoutData keeps the dashboard hook focused on
 * workouts while still giving every screen a single refresh entry point.
 */
export function useRunFormData() {
  const [personalBests, setPersonalBests] = useState<PersonalBest[]>([]);
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [bests, metrics, routeList, shoeList] = await Promise.all([
        getPersonalBests(),
        getBodyMetrics(),
        getRoutes(),
        getShoes(),
      ]);
      setPersonalBests(bests);
      setBodyMetrics(metrics);
      setRoutes(routeList);
      setShoes(shoeList);
      setError(null);
    } catch (loadError) {
      console.error('[RunForm] useRunFormData load failed:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const rebuildPersonalBests = useCallback(async () => {
    await backfillPersonalBests();
    await loadAll();
  }, [loadAll]);

  const persistBodyMetric = useCallback(
    async (metric: Omit<BodyMetric, 'id'>) => {
      await saveBodyMetric(metric);
      await loadAll();
    },
    [loadAll],
  );

  const setRouteName = useCallback(
    async (routeId: string, name: string) => {
      await renameRoute(routeId, name);
      await loadAll();
    },
    [loadAll],
  );

  const createShoe = useCallback(
    async (shoe: Omit<Shoe, 'id' | 'distanceRun' | 'isActive' | 'createdAt'>) => {
      await addShoe(shoe);
      await loadAll();
    },
    [loadAll],
  );

  const attachShoe = useCallback(
    async (workoutId: string, shoeId: string | null) => {
      await assignShoeToWorkout(workoutId, shoeId);
      await loadAll();
    },
    [loadAll],
  );

  const setWorkoutTags = useCallback(
    async (workoutId: string, tags: string[]) => {
      await updateWorkoutTags(workoutId, tags);
      await loadAll();
    },
    [loadAll],
  );

  return {
    personalBests,
    bodyMetrics,
    routes,
    shoes,
    isLoading,
    error,
    loadAll,
    rebuildPersonalBests,
    persistBodyMetric,
    setRouteName,
    createShoe,
    attachShoe,
    setWorkoutTags,
  };
}
