import { z } from 'zod';
import { NUTRIENT_KEYS, type NutrientKey } from './nutrients';
import { isDateKey } from './dates';
import { FOOD_KEY_PATTERN, MEALS } from './types';
import type { CustomFood, DiaryEntry, SavedMeal, StoredProfile, WeightEntry } from './types';

export const BACKUP_APP_ID = 'nutri-tracker';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const uuid = z.uuid();
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'control characters');
const dateKey = z.string().refine(isDateKey, 'invalid date');
const nonNeg = (max: number) => z.number().finite().min(0).max(max);
const timestamp = z.number().int().min(0).max(8.64e15);

const nutrientsSchema = z
  .object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nonNeg(1e6).optional()])) as Record<NutrientKey, z.ZodOptional<z.ZodNumber>>)
  .strict();

const foodKey = z.string().regex(FOOD_KEY_PATTERN);

const profileSchema = z
  .object({
    id: uuid,
    name: text(50).min(1),
    sex: z.enum(['male', 'female']),
    birthYear: z.number().int().min(1900).max(2100),
    heightCm: nonNeg(300).min(50),
    weightKg: nonNeg(500).min(20),
    activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'veryActive']),
    goalRateKgPerWeek: z.number().finite().min(-1.5).max(1.5),
    macros: z.object({ proteinPct: nonNeg(100), carbsPct: nonNeg(100), fatPct: nonNeg(100) }).strict(),
    overrides: z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nonNeg(1e6).optional()]))).strict(),
    createdAt: timestamp,
  })
  .strict();

const entrySchema = z
  .object({
    id: uuid,
    profileId: uuid,
    date: dateKey,
    meal: z.enum(MEALS),
    foodKey: foodKey.nullable(),
    name: text(200).min(1),
    quantity: nonNeg(100_000),
    unitLabel: text(120),
    grams: nonNeg(10_000).nullable(),
    nutrients: nutrientsSchema,
    createdAt: timestamp,
  })
  .strict();

const customFoodSchema = z
  .object({
    id: uuid,
    name: text(200).min(1),
    brand: text(100),
    barcode: z.string().regex(/^\d{8,14}$/).nullable(),
    servingLabel: text(60).nullable(),
    servingGrams: nonNeg(5000).nullable(),
    per100g: nutrientsSchema,
    source: z.enum(['custom', 'off']),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const savedMealSchema = z
  .object({
    id: uuid,
    profileId: uuid,
    name: text(100).min(1),
    items: z
      .array(
        z
          .object({
            foodKey: foodKey.nullable(),
            name: text(200).min(1),
            quantity: nonNeg(100_000),
            unitLabel: text(120),
            grams: nonNeg(10_000).nullable(),
            nutrients: nutrientsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    createdAt: timestamp,
  })
  .strict();

const weightSchema = z
  .object({ id: uuid, profileId: uuid, date: dateKey, kg: nonNeg(500).min(20) })
  .strict();

export const backupSchema = z
  .object({
    app: z.literal(BACKUP_APP_ID),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.string().max(40),
    profiles: z.array(profileSchema).max(20),
    entries: z.array(entrySchema).max(500_000),
    customFoods: z.array(customFoodSchema).max(50_000),
    savedMeals: z.array(savedMealSchema).max(5_000),
    weights: z.array(weightSchema).max(100_000),
  })
  .strict();

export interface Backup {
  app: typeof BACKUP_APP_ID;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  profiles: StoredProfile[];
  entries: DiaryEntry[];
  customFoods: CustomFood[];
  savedMeals: SavedMeal[];
  weights: WeightEntry[];
}

export type ParseBackupResult = { ok: true; backup: Backup } | { ok: false; error: string };

export function parseBackup(raw: string): ParseBackupResult {
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, error: 'Backup file is too large.' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) return { ok: false, error: 'This file is not a valid backup from this app.' };
  const b = result.data as Backup;
  const profileIds = new Set(b.profiles.map((p) => p.id));
  if ([...b.entries, ...b.weights, ...b.savedMeals].some((x) => !profileIds.has(x.profileId))) {
    return { ok: false, error: 'Backup references an unknown profile.' };
  }
  return { ok: true, backup: b };
}
