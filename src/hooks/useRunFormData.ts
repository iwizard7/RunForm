'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addShoe,
  assignShoeToWorkout,
  backfillPersonalBests,
  deleteTrainingPlan,
  getBodyMetrics,
  getPersonalBests,
  getRoutes,
  getShoes,
  getTrainingPlans,
  renameRoute,
  saveBodyMetric,
  saveTrainingPlan,
  updateWorkoutTags,
  updateTrainingPlanStatus,
  type BodyMetric,
  type PersonalBest,
  type Route,
  type Shoe,
  type TrainingPlan,
  type TrainingSession,
} from '@/lib/actions';

/**
 * Owns the data that lives outside the workout history: personal bests,
 * training plans, body metrics, equipment and routes.
 *
 * Keeping it separate from useWorkoutData keeps the dashboard hook focused on
 * workouts while still giving every screen a single refresh entry point.
 */
export function useRunFormData() {
  const [personalBests, setPersonalBests] = useState<PersonalBest[]>([]);
  const [trainingPlans, setTrainingPlans] = useState<TrainingPlan[]>([]);
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [bests, plans, metrics, routeList, shoeList] = await Promise.all([
        getPersonalBests(),
        getTrainingPlans(),
        getBodyMetrics(),
        getRoutes(),
        getShoes(),
      ]);
      setPersonalBests(bests);
      setTrainingPlans(plans);
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

  const persistTrainingPlan = useCallback(
    async (goal: string, sessions: TrainingSession[]) => {
      const result = await saveTrainingPlan(goal, sessions);
      await loadAll();
      return result;
    },
    [loadAll],
  );

  const setPlanStatus = useCallback(
    async (planId: string, status: 'active' | 'completed' | 'cancelled') => {
      await updateTrainingPlanStatus(planId, status);
      await loadAll();
    },
    [loadAll],
  );

  const removeTrainingPlan = useCallback(
    async (planId: string) => {
      await deleteTrainingPlan(planId);
      await loadAll();
    },
    [loadAll],
  );

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
    trainingPlans,
    bodyMetrics,
    routes,
    shoes,
    isLoading,
    error,
    loadAll,
    rebuildPersonalBests,
    persistTrainingPlan,
    setPlanStatus,
    removeTrainingPlan,
    persistBodyMetric,
    setRouteName,
    createShoe,
    attachShoe,
    setWorkoutTags,
  };
}
