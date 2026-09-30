import { useLocalSearchParams } from 'expo-router';
import { isDateKey, todayKey } from '../domain/dates';
import { MEALS, type Meal } from '../domain/types';

/** Validated `date` and `meal` route params; route params are user-controllable (deep links). */
export function useDateMealParams(): { date: string; meal: Meal } {
  const params = useLocalSearchParams<{ date?: string; meal?: string }>();
  const date = typeof params.date === 'string' && isDateKey(params.date) ? params.date : todayKey();
  const meal = (MEALS as readonly string[]).includes(params.meal ?? '') ? (params.meal as Meal) : 'snacks';
  return { date, meal };
}
