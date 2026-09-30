import type { Nutrients } from './nutrients';
import type { Profile } from './targets';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

/** 'usda:<fdcId>', 'bls:<BLS code>' or 'custom:<uuid>'. Quick-add entries have no food key. */
export type FoodKey = `usda:${number}` | `bls:${string}` | `custom:${string}`;

export const FOOD_KEY_PATTERN = /^(usda:\d{1,10}|bls:[A-Z]\d{6}|custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseFoodKey(raw: unknown): FoodKey | null {
  return typeof raw === 'string' && FOOD_KEY_PATTERN.test(raw) ? (raw as FoodKey) : null;
}

export interface DiaryEntry {
  id: string;
  profileId: string;
  date: string;
  meal: Meal;
  foodKey: FoodKey | null;
  name: string;
  quantity: number;
  unitLabel: string;
  grams: number | null;
  /** Nutrients for the logged amount (snapshot at logging time). */
  nutrients: Nutrients;
  createdAt: number;
}

export interface CustomFood {
  id: string;
  name: string;
  brand: string;
  barcode: string | null;
  servingLabel: string | null;
  servingGrams: number | null;
  per100g: Nutrients;
  source: 'custom' | 'off';
  createdAt: number;
  updatedAt: number;
}

export type SavedMealItem = Pick<DiaryEntry, 'foodKey' | 'name' | 'quantity' | 'unitLabel' | 'grams' | 'nutrients'>;

export interface SavedMeal {
  id: string;
  profileId: string;
  name: string;
  items: SavedMealItem[];
  createdAt: number;
}

export interface WeightEntry {
  id: string;
  profileId: string;
  date: string;
  kg: number;
}

export interface StoredProfile extends Profile {
  createdAt: number;
}

export interface FoodDetail {
  key: FoodKey;
  name: string;
  subtitle: string;
  per100g: Nutrients;
  portions: { label: string; grams: number }[];
}

export interface FoodSearchResult {
  key: FoodKey;
  name: string;
  subtitle: string;
  energyPer100g: number | undefined;
}
