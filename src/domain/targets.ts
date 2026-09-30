import type { NutrientKey } from './nutrients';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';

export const ACTIVITY_FACTORS: Record<ActivityLevel, { factor: number; label: string }> = {
  sedentary: { factor: 1.2, label: 'Sedentary (desk job, little exercise)' },
  light: { factor: 1.375, label: 'Light (exercise 1–3 days/week)' },
  moderate: { factor: 1.55, label: 'Moderate (exercise 3–5 days/week)' },
  active: { factor: 1.725, label: 'Active (exercise 6–7 days/week)' },
  veryActive: { factor: 1.9, label: 'Very active (physical job + training)' },
};

export interface MacroSplit {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

export interface Profile {
  id: string;
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  /** kg per week; negative = lose, positive = gain. */
  goalRateKgPerWeek: number;
  macros: MacroSplit;
  /** User overrides of computed targets (min amounts). */
  overrides: Partial<Record<NutrientKey, number>>;
}

export interface Target {
  /** Recommended daily amount (RDA/AI) or goal. */
  min?: number;
  /** Tolerable upper intake level or "keep below" value. */
  max?: number;
}

export type Targets = Partial<Record<NutrientKey, Target>>;

/** Energy content of 1 kg of body weight change, kcal. */
export const KCAL_PER_KG = 7700;

export const DEFAULT_MACROS: MacroSplit = { proteinPct: 25, carbsPct: 45, fatPct: 30 };

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

/** Mifflin-St Jeor resting energy expenditure (kcal/day). */
export function bmr(p: Pick<Profile, 'sex' | 'weightKg' | 'heightCm'>, age: number): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

export function tdee(p: Pick<Profile, 'sex' | 'weightKg' | 'heightCm' | 'activity'>, age: number): number {
  return bmr(p, age) * ACTIVITY_FACTORS[p.activity].factor;
}

export function energyTarget(p: Profile, age: number): number {
  const delta = (p.goalRateKgPerWeek * KCAL_PER_KG) / 7;
  const floor = p.sex === 'male' ? 1500 : 1200;
  return Math.round(Math.max(floor, tdee(p, age) + delta));
}

type BySex = { male: number; female: number };
type Row = { minAge: number; min?: BySex; max?: BySex };

const s = (male: number, female = male): BySex => ({ male, female });

/** Adult Dietary Reference Intakes (NIH ODS / National Academies). */
const DRI: Partial<Record<NutrientKey, Row[]>> = {
  // The vitamin A UL applies to preformed retinol only, not total RAE, so no max here.
  vitA: [{ minAge: 19, min: s(900, 700) }],
  vitC: [{ minAge: 19, min: s(90, 75), max: s(2000) }],
  vitD: [
    { minAge: 19, min: s(15), max: s(100) },
    { minAge: 71, min: s(20), max: s(100) },
  ],
  vitE: [{ minAge: 19, min: s(15) }],
  vitK: [{ minAge: 19, min: s(120, 90) }],
  thiamin: [{ minAge: 19, min: s(1.2, 1.1) }],
  riboflavin: [{ minAge: 19, min: s(1.3, 1.1) }],
  niacin: [{ minAge: 19, min: s(16, 14) }],
  pantothenicAcid: [{ minAge: 19, min: s(5) }],
  vitB6: [
    { minAge: 19, min: s(1.3), max: s(100) },
    { minAge: 51, min: s(1.7, 1.5), max: s(100) },
  ],
  biotin: [{ minAge: 19, min: s(30) }],
  folate: [{ minAge: 19, min: s(400) }],
  vitB12: [{ minAge: 19, min: s(2.4) }],
  choline: [{ minAge: 19, min: s(550, 425), max: s(3500) }],
  calcium: [
    { minAge: 19, min: s(1000), max: s(2500) },
    { minAge: 51, min: s(1000, 1200), max: s(2000) },
    { minAge: 71, min: s(1200), max: s(2000) },
  ],
  copper: [{ minAge: 19, min: s(0.9), max: s(10) }],
  iodine: [{ minAge: 19, min: s(150), max: s(1100) }],
  iron: [
    { minAge: 19, min: s(8, 18), max: s(45) },
    { minAge: 51, min: s(8), max: s(45) },
  ],
  magnesium: [
    { minAge: 19, min: s(400, 310) },
    { minAge: 31, min: s(420, 320) },
  ],
  manganese: [{ minAge: 19, min: s(2.3, 1.8), max: s(11) }],
  phosphorus: [
    { minAge: 19, min: s(700), max: s(4000) },
    { minAge: 71, min: s(700), max: s(3000) },
  ],
  potassium: [{ minAge: 19, min: s(3400, 2600) }],
  selenium: [{ minAge: 19, min: s(55), max: s(400) }],
  sodium: [{ minAge: 19, min: s(1500), max: s(2300) }],
  zinc: [{ minAge: 19, min: s(11, 8), max: s(40) }],
  omega3: [{ minAge: 19, min: s(1.6, 1.1) }],
  omega6: [
    { minAge: 19, min: s(17, 12) },
    { minAge: 51, min: s(14, 11) },
  ],
};

function driFor(key: NutrientKey, sex: Sex, age: number): Target | undefined {
  const rows = DRI[key];
  if (!rows) return undefined;
  const effectiveAge = Math.max(19, age);
  let row: Row | undefined;
  for (const r of rows) if (effectiveAge >= r.minAge) row = r;
  if (!row) return undefined;
  return { min: row.min?.[sex], max: row.max?.[sex] };
}

export function computeTargets(p: Profile, now = new Date()): Targets {
  const age = ageFromBirthYear(p.birthYear, now);
  const override = p.overrides.energy;
  const energy = typeof override === 'number' && Number.isFinite(override) && override >= 800 && override <= 6000 ? Math.round(override) : energyTarget(p, age);
  const t: Targets = {
    energy: { min: energy },
    protein: { min: Math.round((energy * p.macros.proteinPct) / 100 / 4) },
    carbs: { min: Math.round((energy * p.macros.carbsPct) / 100 / 4) },
    fat: { min: Math.round((energy * p.macros.fatPct) / 100 / 9) },
    fiber: { min: Math.round((14 * energy) / 1000) },
    satFat: { max: Math.round((energy * 0.1) / 9) },
    transFat: { max: 2 },
    cholesterol: { max: 300 },
    caffeine: { max: 400 },
  };
  for (const key of Object.keys(DRI) as NutrientKey[]) {
    const dri = driFor(key, p.sex, age);
    if (dri) t[key] = dri;
  }
  for (const [key, value] of Object.entries(p.overrides) as [NutrientKey, number][]) {
    if (key !== 'energy' && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      t[key] = { ...t[key], min: value };
    }
  }
  return t;
}

export function macroSplitValid(m: MacroSplit): boolean {
  const vals = [m.proteinPct, m.carbsPct, m.fatPct];
  return vals.every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && Math.round(vals.reduce((a, b) => a + b, 0)) === 100;
}

/** Fraction of target reached, capped for display at 1. */
export function progress(value: number | undefined, target: Target | undefined): number {
  if (value === undefined || !target?.min) return 0;
  return Math.min(1, value / target.min);
}

export type Status = 'none' | 'low' | 'ok' | 'high';

export function status(value: number | undefined, target: Target | undefined): Status {
  if (!target || value === undefined) return 'none';
  if (target.max !== undefined && value > target.max) return 'high';
  if (target.min !== undefined && value < target.min) return 'low';
  return 'ok';
}
