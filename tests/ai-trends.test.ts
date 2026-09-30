import { describe, expect, it } from 'vitest';
import {
  aiEstimatePer100g,
  insightsResponseSchema,
  isValidDeviceToken,
  itemsResponseSchema,
  labelResponseSchema,
  labelToPer100g,
  normalizeServerUrl,
  type AiLabel,
} from '../src/domain/ai';
import { computeTargets, DEFAULT_MACROS, type Profile } from '../src/domain/targets';
import { excesses, shortfalls, summarizeRange } from '../src/domain/trends';
import type { DiaryEntry } from '../src/domain/types';

describe('normalizeServerUrl', () => {
  it('accepts https origins', () => {
    expect(normalizeServerUrl('https://nutri-ai.me.workers.dev')).toBe('https://nutri-ai.me.workers.dev');
    expect(normalizeServerUrl(' https://nutri-ai.me.workers.dev/ ')).toBe('https://nutri-ai.me.workers.dev');
  });
  it.each([
    'http://nutri-ai.me.workers.dev',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@evil.com',
    'https://evil.com/path',
    'https://evil.com?x=1',
    'https://localhost',
    '',
    'https://' + 'a'.repeat(300) + '.com',
  ])('rejects %s', (u) => {
    expect(normalizeServerUrl(u)).toBeNull();
  });
});

describe('isValidDeviceToken', () => {
  it('accepts base64url tokens of 32+ chars', () => {
    expect(isValidDeviceToken('A'.repeat(43))).toBe(true);
    expect(isValidDeviceToken('abc_-123'.repeat(6))).toBe(true);
  });
  it('rejects short, oversized or non-base64url tokens', () => {
    expect(isValidDeviceToken('short')).toBe(false);
    expect(isValidDeviceToken('A'.repeat(129))).toBe(false);
    expect(isValidDeviceToken('A'.repeat(40) + ' \n')).toBe(false);
    expect(isValidDeviceToken('<script>' + 'A'.repeat(40))).toBe(false);
  });
});

describe('AI response validation', () => {
  it('sanitizes item text and rejects out-of-range numbers', () => {
    const ok = itemsResponseSchema.parse({
      items: [{ name_en: 'roll <b>', name_de: 'Brötchen\u0000', quantity: 2, unit: 'piece', grams_estimate: 120, confidence: 'high' }],
    });
    expect(ok.items[0].name_en).toBe('roll b');
    expect(ok.items[0].name_de).toBe('Brötchen');
    expect(itemsResponseSchema.safeParse({ items: [{ ...ok.items[0], quantity: -1 }] }).success).toBe(false);
    expect(itemsResponseSchema.safeParse({ items: [{ ...ok.items[0], grams_estimate: 1e9 }] }).success).toBe(false);
    expect(itemsResponseSchema.safeParse({ items: Array(21).fill(ok.items[0]) }).success).toBe(false);
    expect(itemsResponseSchema.safeParse({ items: [{ ...ok.items[0], confidence: 'certain' }] }).success).toBe(false);
  });
  it('validates insights and labels', () => {
    expect(insightsResponseSchema.safeParse({ insights: [{ title: 't', body: 'b', kind: 'hack' }] }).success).toBe(false);
    expect(labelResponseSchema.parse({ label: null }).label).toBeNull();
    expect(labelResponseSchema.safeParse({ label: { basis: '100g' } }).success).toBe(false);
  });
});

describe('AI nutrient estimates', () => {
  const item = { name_en: 'fried noodles with duck', name_de: 'Gebratene Nudeln mit Ente', quantity: 1, unit: 'plate', grams_estimate: 400, confidence: 'medium' };
  const est = { energy_kcal: 190, protein_g: 9, carbs_g: 20, fat_g: 8, fiber_g: 1.5, sugars_g: 3, sat_fat_g: 2, sodium_mg: 600 };

  it('maps the estimate to app nutrients and skips unknown values', () => {
    const [parsed] = itemsResponseSchema.parse({ items: [{ ...item, per_100g: { ...est, fiber_g: null } }] }).items;
    expect(aiEstimatePer100g(parsed!)).toEqual({ energy: 190, protein: 9, carbs: 20, fat: 8, sugars: 3, satFat: 2, sodium: 600 });
  });

  it('accepts items without an estimate (older servers)', () => {
    const [parsed] = itemsResponseSchema.parse({ items: [item] }).items;
    expect(aiEstimatePer100g(parsed!)).toBeNull();
  });

  it.each([
    ['macros above 100 g', { ...est, protein_g: 60, fat_g: 60 }],
    ['energy above 900 kcal', { ...est, energy_kcal: 5000 }],
    ['negative value', { ...est, fat_g: -1 }],
    ['not an object', 'a lot'],
  ])('drops an implausible estimate (%s) but keeps the item', (_n, per_100g) => {
    const [parsed] = itemsResponseSchema.parse({ items: [{ ...item, per_100g }] }).items;
    expect(parsed!.name_en).toBe(item.name_en);
    expect(aiEstimatePer100g(parsed!)).toBeNull();
  });
});

describe('labelToPer100g', () => {
  const base: AiLabel = {
    name: 'Müsli',
    brand: null,
    basis: '100g',
    serving_grams: 50,
    energy_kcal: 380,
    protein_g: 10,
    carbs_g: 60,
    sugars_g: 12,
    fat_g: 8,
    sat_fat_g: 1.5,
    fiber_g: 8,
    salt_g: 0.1,
    sodium_mg: null,
  };
  it('keeps per-100 g values and derives sodium from salt', () => {
    const n = labelToPer100g(base)!;
    expect(n.energy).toBe(380);
    expect(n.sodium).toBeCloseTo(40);
  });
  it('scales per-serving values', () => {
    const n = labelToPer100g({ ...base, basis: 'serving', energy_kcal: 190, protein_g: 5, carbs_g: 30, fat_g: 4 })!;
    expect(n.energy).toBe(380);
    expect(n.protein).toBe(10);
  });
  it('rejects unusable or impossible labels', () => {
    expect(labelToPer100g({ ...base, basis: 'serving', serving_grams: null })).toBeNull();
    expect(labelToPer100g({ ...base, energy_kcal: null })).toBeNull();
    expect(labelToPer100g({ ...base, basis: 'serving', serving_grams: 10, energy_kcal: 190 })).toBeNull();
  });
});

const profile: Profile = {
  id: 'p',
  name: 'A',
  sex: 'female',
  birthYear: 1995,
  heightCm: 165,
  weightKg: 60,
  activity: 'light',
  goalRateKgPerWeek: 0,
  macros: DEFAULT_MACROS,
  overrides: {},
};

describe('calorie override', () => {
  it('drives macro targets', () => {
    const t = computeTargets({ ...profile, overrides: { energy: 2000 } }, new Date(2026, 5, 1));
    expect(t.energy?.min).toBe(2000);
    expect(t.protein?.min).toBe(125);
    expect(t.fat?.min).toBe(Math.round(600 / 9));
  });
  it('ignores implausible overrides', () => {
    const t = computeTargets({ ...profile, overrides: { energy: 100 } }, new Date(2026, 5, 1));
    expect(t.energy?.min).toBeGreaterThan(1200);
  });
});

describe('summarizeRange', () => {
  const entry = (date: string, name: string, energy: number, iron?: number): DiaryEntry => ({
    id: `${date}-${name}`,
    profileId: 'p',
    date,
    meal: 'lunch',
    foodKey: null,
    name,
    quantity: 1,
    unitLabel: 'g',
    grams: 100,
    nutrients: iron === undefined ? { energy } : { energy, iron },
    createdAt: 0,
  });
  const targets = computeTargets(profile, new Date(2026, 5, 1));

  it('averages over logged days only and counts low days', () => {
    const s = summarizeRange(
      [entry('2026-06-01', 'Oats', 1000, 4), entry('2026-06-01', 'Egg', 500, 2), entry('2026-06-03', 'Oats', 1500, 20)],
      ['2026-06-01', '2026-06-02', '2026-06-03'],
      targets,
    );
    expect(s.daysLogged).toBe(2);
    expect(s.avg.energy).toBe(1500);
    expect(s.avg.iron).toBe(13);
    expect(s.daysBelow.iron).toBe(1);
    expect(s.energyByDay.map((d) => d.kcal)).toEqual([1500, 0, 1500]);
    expect(s.topFoods[0]).toEqual({ name: 'Oats', count: 2 });
  });

  it('flags shortfalls and excesses', () => {
    expect(shortfalls({ iron: 5, protein: 100 }, targets).map((s) => s.key)).toContain('iron');
    expect(shortfalls({ iron: 5, protein: 100 }, targets).map((s) => s.key)).not.toContain('protein');
    expect(excesses({ sodium: 5000 }, targets)[0].key).toBe('sodium');
  });
});
