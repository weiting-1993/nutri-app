import { describe, expect, it } from 'vitest';
import { mapFood, mapNutrients, mapPortion } from '../scripts/lib/usda';

const n = (id: number, amount: number) => ({ nutrient: { id }, amount });

describe('mapNutrients', () => {
  it('maps core nutrients per 100 g', () => {
    const out = mapNutrients([n(1008, 89), n(1003, 1.09), n(1005, 22.84), n(1004, 0.33), n(1092, 358)]);
    expect(out).toMatchObject({ energy: 89, protein: 1.09, carbs: 22.84, fat: 0.33, potassium: 358 });
  });

  it('keeps missing nutrients missing instead of zero', () => {
    const out = mapNutrients([n(1008, 100)]);
    expect(out.vitC).toBeUndefined();
    expect('vitC' in out).toBe(false);
  });

  it('falls back to Atwater energy fields for Foundation foods', () => {
    expect(mapNutrients([n(2048, 120), n(2047, 125)]).energy).toBe(120);
    expect(mapNutrients([n(2047, 125)]).energy).toBe(125);
  });

  it('converts kJ and computes energy from macros as a last resort', () => {
    expect(mapNutrients([n(1062, 418.4)]).energy).toBeCloseTo(100);
    expect(mapNutrients([n(1003, 10), n(1004, 10), n(1005, 10)]).energy).toBe(170);
  });

  it('converts vitamin D IU to µg when µg is absent', () => {
    expect(mapNutrients([n(1008, 1), n(1110, 400)]).vitD).toBe(10);
  });

  it('sums omega-3 fatty acids', () => {
    const out = mapNutrients([n(1008, 1), n(1404, 0.1), n(1278, 0.2), n(1272, 0.3)]);
    expect(out.omega3).toBeCloseTo(0.6);
  });

  it('prefers folate DFE over total folate', () => {
    expect(mapNutrients([n(1190, 50), n(1177, 40)]).folate).toBe(50);
    expect(mapNutrients([n(1177, 40)]).folate).toBe(40);
  });

  it('ignores negative and non-numeric amounts', () => {
    const out = mapNutrients([n(1008, -5), { nutrient: { id: 1003 }, amount: NaN }, { amount: 5 }]);
    expect(out.energy).toBeUndefined();
    expect(out.protein).toBeUndefined();
  });
});

describe('mapPortion', () => {
  it('uses FNDDS portion descriptions', () => {
    expect(mapPortion({ portionDescription: '1 cup', gramWeight: 246 })).toEqual({ label: '1 cup', grams: 246 });
  });

  it('drops unspecified quantities and zero weights', () => {
    expect(mapPortion({ portionDescription: 'Quantity not specified', gramWeight: 50 })).toBeNull();
    expect(mapPortion({ portionDescription: '1 cup', gramWeight: 0 })).toBeNull();
  });

  it('builds SR legacy labels from amount and modifier', () => {
    expect(
      mapPortion({ amount: 1, modifier: 'cup, chopped', gramWeight: 160, measureUnit: { name: 'undetermined' } }),
    ).toEqual({ label: '1 cup, chopped', grams: 160 });
  });

  it('builds Foundation labels from measure unit', () => {
    expect(mapPortion({ amount: 2, modifier: '', gramWeight: 33.9, measureUnit: { name: 'tablespoon' } })).toEqual({
      label: '2 tablespoon',
      grams: 33.9,
    });
    expect(mapPortion({ amount: 1, gramWeight: 30, measureUnit: { name: 'RACC' } })).toBeNull();
  });
});

describe('mapFood', () => {
  it('skips foods without energy and null entries', () => {
    expect(mapFood(null, 'sr')).toBeNull();
    expect(mapFood({ fdcId: 1, description: 'x', foodNutrients: [n(1051, 99)] }, 'sr')).toBeNull();
  });

  it('dedupes portions', () => {
    const f = mapFood(
      {
        fdcId: 1,
        description: 'Spinach',
        foodNutrients: [n(1008, 23)],
        foodPortions: [
          { amount: 1, modifier: 'leaf', gramWeight: 10 },
          { amount: 1, modifier: 'leaf', gramWeight: 10 },
        ],
      },
      'sr',
    );
    expect(f?.portions).toHaveLength(1);
  });
});
