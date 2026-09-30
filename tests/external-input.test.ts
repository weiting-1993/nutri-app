import { describe, expect, it } from 'vitest';
import { isValidGtin, normalizeBarcode, parseOffResponse } from '../src/domain/openFoodFacts';
import { BACKUP_APP_ID, BACKUP_VERSION, parseBackup } from '../src/domain/backup';

describe('barcodes', () => {
  it('accepts valid GTINs', () => {
    expect(isValidGtin('3017620422003')).toBe(true); // Nutella EAN-13
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
  });

  it('rejects bad checksums and non-digit input', () => {
    for (const bad of ['3017620422004', '', '123', 'abcdefghijklm', '../../etc/passwd', '30176204220031234', '3017620422003?x=1']) {
      expect(isValidGtin(bad)).toBe(false);
    }
  });

  it('normalizes UPC-A to EAN-13', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
  });
});

describe('Open Food Facts parsing', () => {
  const base = {
    status: 1,
    product: {
      product_name: 'Nutella',
      brands: 'Ferrero, Nutella',
      serving_size: '15 g',
      serving_quantity: 15,
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        sugars_100g: 56.3,
        fat_100g: 30.9,
        'saturated-fat_100g': 10.6,
        salt_100g: 0.107,
        'vitamin-c_100g': 0.004,
        calcium_100g: '0.12',
      },
    },
  };

  it('converts units to the app model', () => {
    const p = parseOffResponse('3017620422003', base)!;
    expect(p.name).toBe('Nutella');
    expect(p.brand).toBe('Ferrero');
    expect(p.per100g.energy).toBe(539);
    expect(p.per100g.sodium).toBeCloseTo(42.8);
    expect(p.per100g.vitC).toBeCloseTo(4);
    expect(p.per100g.calcium).toBeCloseTo(120);
    expect(p.servingGrams).toBe(15);
    expect(p.warnings).toEqual([]);
  });

  it('falls back to kJ and flags inconsistent calories', () => {
    const p = parseOffResponse('3017620422003', {
      product: { product_name: 'x', nutriments: { 'energy-kj_100g': 418.4, proteins_100g: 20, carbohydrates_100g: 20, fat_100g: 20 } },
    })!;
    expect(p.per100g.energy).toBeCloseTo(100);
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('strips markup and control characters from text', () => {
    const p = parseOffResponse('3017620422003', {
      product: { product_name: '<script>alert(1)</script>\u0000Bar', nutriments: { 'energy-kcal_100g': 100 } },
    })!;
    expect(p.name).not.toMatch(/[<>\u0000]/);
  });

  it('ignores negative / junk numbers and rejects unusable products', () => {
    const p = parseOffResponse('3017620422003', {
      product: { product_name: 'x', nutriments: { 'energy-kcal_100g': 100, proteins_100g: -5, fat_100g: 'abc' } },
    })!;
    expect(p.per100g.protein).toBeUndefined();
    expect(p.per100g.fat).toBeUndefined();
    expect(parseOffResponse('3017620422003', { status: 0 })).toBeNull();
    expect(parseOffResponse('3017620422003', { product: { nutriments: {} } })).toBeNull();
    expect(parseOffResponse('3017620422003', 'not an object')).toBeNull();
    expect(parseOffResponse('3017620422003', { product: { product_name: 'x'.repeat(10_000) } })).toBeNull();
  });

  it('rejects absurd serving sizes', () => {
    const p = parseOffResponse('3017620422003', {
      product: { product_name: 'x', serving_quantity: -3, nutriments: { 'energy-kcal_100g': 100 } },
    })!;
    expect(p.servingGrams).toBeUndefined();
  });
});

describe('backup import validation', () => {
  const pid = '11111111-1111-4111-8111-111111111111';
  const valid = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: '2026-09-30T00:00:00.000Z',
    profiles: [
      {
        id: pid,
        name: 'Me',
        sex: 'female',
        birthYear: 1995,
        heightCm: 165,
        weightKg: 60,
        activity: 'light',
        goalRateKgPerWeek: 0,
        macros: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
        overrides: {},
        createdAt: 1,
      },
    ],
    entries: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        profileId: pid,
        date: '2026-09-30',
        meal: 'breakfast',
        foodKey: 'usda:173944',
        name: 'Bananas, raw',
        quantity: 1,
        unitLabel: '1 medium',
        grams: 118,
        nutrients: { energy: 105 },
        createdAt: 1,
      },
    ],
    customFoods: [],
    savedMeals: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        profileId: pid,
        name: 'Oatmeal',
        items: [{ foodKey: 'usda:173904', name: 'Oats', quantity: 40, unitLabel: 'g', grams: 40, nutrients: { energy: 152 } }],
        createdAt: 1,
      },
    ],
    weights: [{ id: '33333333-3333-4333-8333-333333333333', profileId: pid, date: '2026-09-30', kg: 60 }],
  };

  it('accepts a valid backup', () => {
    expect(parseBackup(JSON.stringify(valid)).ok).toBe(true);
  });

  it('rejects malformed JSON and wrong apps', () => {
    expect(parseBackup('{not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...valid, app: 'other' })).ok).toBe(false);
  });

  it('rejects extra fields (mass assignment) and bad values', () => {
    const cases = [
      { ...valid, profiles: [{ ...valid.profiles[0], isAdmin: true }] },
      { ...valid, entries: [{ ...valid.entries[0], nutrients: { energy: -1 } }] },
      { ...valid, entries: [{ ...valid.entries[0], date: '2026-13-45' }] },
      { ...valid, entries: [{ ...valid.entries[0], foodKey: "usda:1; DROP TABLE entries" }] },
      { ...valid, entries: [{ ...valid.entries[0], name: 'a\u0000b' }] },
      { ...valid, entries: [{ ...valid.entries[0], name: 'x'.repeat(5000) }] },
      { ...valid, entries: [{ ...valid.entries[0], id: '1' }] },
      { ...valid, weights: [{ ...valid.weights[0], kg: 1e9 }] },
      { ...valid, savedMeals: [{ ...valid.savedMeals[0], items: [] }] },
      { ...valid, savedMeals: [{ ...valid.savedMeals[0], profileId: '66666666-6666-4666-8666-666666666666' }] },
      { ...valid, profiles: [{ ...valid.profiles[0], birthYear: 'x' }] },
    ];
    for (const c of cases) expect(parseBackup(JSON.stringify(c)).ok).toBe(false);
  });

  it('rejects entries pointing at unknown profiles', () => {
    const bad = { ...valid, entries: [{ ...valid.entries[0], profileId: '44444444-4444-4444-8444-444444444444' }] };
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false);
  });
});
