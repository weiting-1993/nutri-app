import { describe, expect, it } from 'vitest';
import { formatAmount, netCarbs, sanitizeNutrients, scaleNutrients, sumNutrients } from '../src/domain/nutrients';
import { gramsFor, GRAMS_PER_OZ, parseQuantity, unitsForFood } from '../src/domain/servings';
import {
  bmr,
  computeTargets,
  DEFAULT_MACROS,
  energyTarget,
  macroSplitValid,
  status,
  tdee,
  type Profile,
} from '../src/domain/targets';
import { addDays, dateRange, isDateKey } from '../src/domain/dates';
import { escapeLike, normalizeText, searchTokens } from '../src/domain/search';

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Test',
  sex: 'male',
  birthYear: 1996,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goalRateKgPerWeek: 0,
  macros: DEFAULT_MACROS,
  overrides: {},
  ...over,
});

describe('nutrient math', () => {
  it('scales per-100 g values', () => {
    expect(scaleNutrients({ energy: 89, protein: 1.09 }, 118)).toEqual({ energy: 89 * 1.18, protein: 1.09 * 1.18 });
  });

  it('sums and counts missing data', () => {
    const t = sumNutrients([{ energy: 100, vitC: 5 }, { energy: 50 }]);
    expect(t.values.energy).toBe(150);
    expect(t.values.vitC).toBe(5);
    expect(t.missing.vitC).toBe(1);
  });

  it('computes net carbs', () => {
    expect(netCarbs({ carbs: 20, fiber: 5 })).toBe(15);
    expect(netCarbs({})).toBeUndefined();
  });

  it('formats values with sensible precision', () => {
    expect(formatAmount('energy', 123.6)).toBe('124');
    expect(formatAmount('vitB12', 1.234)).toBe('1.23');
    expect(formatAmount('vitC', undefined)).toBe('–');
  });

  it('sanitizes untrusted nutrient objects', () => {
    expect(
      sanitizeNutrients({ energy: 100, protein: -1, fat: Infinity, carbs: '5', hack: 1, sodium: 1e9 } as Record<string, unknown>),
    ).toEqual({ energy: 100 });
  });
});

describe('servings', () => {
  it('parses quantities including fractions', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
  });

  it('rejects invalid quantities', () => {
    for (const bad of ['', '0', '-1', 'abc', '1/0', '1e400', "1'; DROP TABLE entries;--", '<script>', '9'.repeat(30), '\u0000']) {
      expect(parseQuantity(bad)).toBeUndefined();
    }
  });

  it('converts units to grams', () => {
    const units = unitsForFood([{ label: '1 medium', grams: 118 }]);
    expect(gramsFor(2, units[0])).toBe(236);
    expect(gramsFor(1, units.find((u) => u.id === 'oz')!)).toBeCloseTo(GRAMS_PER_OZ);
    expect(gramsFor(100_000, units.find((u) => u.id === 'g')!)).toBeUndefined();
  });
});

describe('targets', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    expect(bmr({ sex: 'male', weightKg: 80, heightCm: 180 }, 30)).toBe(1780);
    expect(bmr({ sex: 'female', weightKg: 60, heightCm: 165 }, 30)).toBeCloseTo(1320.25);
  });

  it('applies activity and goal rate', () => {
    const p = profile();
    expect(tdee(p, 30)).toBeCloseTo(1780 * 1.55);
    expect(energyTarget({ ...p, goalRateKgPerWeek: -0.5 }, 30)).toBe(Math.round(1780 * 1.55 - 550));
  });

  it('never targets below a safe floor', () => {
    expect(energyTarget(profile({ sex: 'female', weightKg: 45, heightCm: 150, goalRateKgPerWeek: -1.5, activity: 'sedentary' }), 30)).toBe(1200);
  });

  it('uses sex- and age-specific DRIs', () => {
    const now = new Date(2026, 5, 1);
    const m = computeTargets(profile({ birthYear: 1996 }), now);
    const f = computeTargets(profile({ sex: 'female', birthYear: 1996 }), now);
    expect(m.iron).toEqual({ min: 8, max: 45 });
    expect(f.iron).toEqual({ min: 18, max: 45 });
    expect(f.magnesium?.min).toBe(310);
    expect(computeTargets(profile({ sex: 'female', birthYear: 1990 }), now).magnesium?.min).toBe(320);
    expect(computeTargets(profile({ sex: 'female', birthYear: 1970 }), now).iron?.min).toBe(8);
    expect(m.sodium).toEqual({ min: 1500, max: 2300 });
    expect(m.vitA?.max).toBeUndefined();
  });

  it('derives macro grams from the split', () => {
    const t = computeTargets(profile(), new Date(2026, 5, 1));
    const kcal = t.energy!.min!;
    expect(t.protein!.min).toBe(Math.round((kcal * 0.25) / 4));
    expect(t.fat!.min).toBe(Math.round((kcal * 0.3) / 9));
  });

  it('applies valid overrides only', () => {
    const t = computeTargets(profile({ overrides: { protein: 180, vitD: -5 } }));
    expect(t.protein?.min).toBe(180);
    expect(t.vitD?.min).toBe(15);
  });

  it('validates macro splits', () => {
    expect(macroSplitValid(DEFAULT_MACROS)).toBe(true);
    expect(macroSplitValid({ proteinPct: 50, carbsPct: 50, fatPct: 50 })).toBe(false);
    expect(macroSplitValid({ proteinPct: -10, carbsPct: 80, fatPct: 30 })).toBe(false);
  });

  it('reports status against min and max', () => {
    expect(status(2500, { min: 1500, max: 2300 })).toBe('high');
    expect(status(1000, { min: 1500, max: 2300 })).toBe('low');
    expect(status(2000, { min: 1500, max: 2300 })).toBe('ok');
    expect(status(undefined, { min: 1 })).toBe('none');
  });
});

describe('dates', () => {
  it('validates and shifts date keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dateRange('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

describe('search', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeText('Crème Brûlée, (homemade)')).toBe('creme brulee homemade');
    expect(searchTokens("greek  yogurt' OR 1=1 --")).toEqual(['greek', 'yogurt', 'or', '1']);
    expect(searchTokens('Eggs tomatoes berries glass', { stemmed: true })).toEqual(['egg', 'tomato', 'berr', 'glass']);
    expect(searchTokens('Reis Weißbrot')).toEqual(['reis', 'weissbrot']);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('100%_a\\')).toBe('100\\%\\_a\\\\');
  });
});
