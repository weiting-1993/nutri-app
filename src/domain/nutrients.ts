export const NUTRIENT_KEYS = [
  'energy',
  'protein',
  'carbs',
  'fiber',
  'sugars',
  'fat',
  'satFat',
  'monoFat',
  'polyFat',
  'transFat',
  'omega3',
  'omega6',
  'cholesterol',
  'alcohol',
  'caffeine',
  'water',
  'vitA',
  'vitC',
  'vitD',
  'vitE',
  'vitK',
  'thiamin',
  'riboflavin',
  'niacin',
  'pantothenicAcid',
  'vitB6',
  'biotin',
  'folate',
  'vitB12',
  'choline',
  'calcium',
  'copper',
  'iodine',
  'iron',
  'magnesium',
  'manganese',
  'phosphorus',
  'potassium',
  'selenium',
  'sodium',
  'zinc',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Nutrient amounts. A missing key means "no data", which is different from 0. */
export type Nutrients = Partial<Record<NutrientKey, number>>;

export type NutrientGroup = 'general' | 'carbs' | 'lipids' | 'vitamins' | 'minerals' | 'other';

export interface NutrientDef {
  key: NutrientKey;
  name: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  group: NutrientGroup;
  decimals: number;
}

export const NUTRIENTS: Record<NutrientKey, NutrientDef> = {
  energy: { key: 'energy', name: 'Energy', unit: 'kcal', group: 'general', decimals: 0 },
  protein: { key: 'protein', name: 'Protein', unit: 'g', group: 'general', decimals: 1 },
  carbs: { key: 'carbs', name: 'Carbs', unit: 'g', group: 'carbs', decimals: 1 },
  fiber: { key: 'fiber', name: 'Fiber', unit: 'g', group: 'carbs', decimals: 1 },
  sugars: { key: 'sugars', name: 'Sugars', unit: 'g', group: 'carbs', decimals: 1 },
  fat: { key: 'fat', name: 'Fat', unit: 'g', group: 'lipids', decimals: 1 },
  satFat: { key: 'satFat', name: 'Saturated', unit: 'g', group: 'lipids', decimals: 1 },
  monoFat: { key: 'monoFat', name: 'Monounsaturated', unit: 'g', group: 'lipids', decimals: 1 },
  polyFat: { key: 'polyFat', name: 'Polyunsaturated', unit: 'g', group: 'lipids', decimals: 1 },
  transFat: { key: 'transFat', name: 'Trans fat', unit: 'g', group: 'lipids', decimals: 2 },
  omega3: { key: 'omega3', name: 'Omega-3', unit: 'g', group: 'lipids', decimals: 2 },
  omega6: { key: 'omega6', name: 'Omega-6', unit: 'g', group: 'lipids', decimals: 2 },
  cholesterol: { key: 'cholesterol', name: 'Cholesterol', unit: 'mg', group: 'lipids', decimals: 0 },
  alcohol: { key: 'alcohol', name: 'Alcohol', unit: 'g', group: 'other', decimals: 1 },
  caffeine: { key: 'caffeine', name: 'Caffeine', unit: 'mg', group: 'other', decimals: 0 },
  water: { key: 'water', name: 'Water', unit: 'g', group: 'other', decimals: 0 },
  vitA: { key: 'vitA', name: 'Vitamin A', unit: 'µg', group: 'vitamins', decimals: 0 },
  vitC: { key: 'vitC', name: 'Vitamin C', unit: 'mg', group: 'vitamins', decimals: 1 },
  vitD: { key: 'vitD', name: 'Vitamin D', unit: 'µg', group: 'vitamins', decimals: 1 },
  vitE: { key: 'vitE', name: 'Vitamin E', unit: 'mg', group: 'vitamins', decimals: 1 },
  vitK: { key: 'vitK', name: 'Vitamin K', unit: 'µg', group: 'vitamins', decimals: 1 },
  thiamin: { key: 'thiamin', name: 'B1 (Thiamine)', unit: 'mg', group: 'vitamins', decimals: 2 },
  riboflavin: { key: 'riboflavin', name: 'B2 (Riboflavin)', unit: 'mg', group: 'vitamins', decimals: 2 },
  niacin: { key: 'niacin', name: 'B3 (Niacin)', unit: 'mg', group: 'vitamins', decimals: 1 },
  pantothenicAcid: { key: 'pantothenicAcid', name: 'B5 (Pantothenic acid)', unit: 'mg', group: 'vitamins', decimals: 2 },
  vitB6: { key: 'vitB6', name: 'B6 (Pyridoxine)', unit: 'mg', group: 'vitamins', decimals: 2 },
  biotin: { key: 'biotin', name: 'B7 (Biotin)', unit: 'µg', group: 'vitamins', decimals: 1 },
  folate: { key: 'folate', name: 'B9 (Folate, DFE)', unit: 'µg', group: 'vitamins', decimals: 0 },
  vitB12: { key: 'vitB12', name: 'B12 (Cobalamin)', unit: 'µg', group: 'vitamins', decimals: 2 },
  choline: { key: 'choline', name: 'Choline', unit: 'mg', group: 'vitamins', decimals: 0 },
  calcium: { key: 'calcium', name: 'Calcium', unit: 'mg', group: 'minerals', decimals: 0 },
  copper: { key: 'copper', name: 'Copper', unit: 'mg', group: 'minerals', decimals: 2 },
  iodine: { key: 'iodine', name: 'Iodine', unit: 'µg', group: 'minerals', decimals: 0 },
  iron: { key: 'iron', name: 'Iron', unit: 'mg', group: 'minerals', decimals: 1 },
  magnesium: { key: 'magnesium', name: 'Magnesium', unit: 'mg', group: 'minerals', decimals: 0 },
  manganese: { key: 'manganese', name: 'Manganese', unit: 'mg', group: 'minerals', decimals: 2 },
  phosphorus: { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', group: 'minerals', decimals: 0 },
  potassium: { key: 'potassium', name: 'Potassium', unit: 'mg', group: 'minerals', decimals: 0 },
  selenium: { key: 'selenium', name: 'Selenium', unit: 'µg', group: 'minerals', decimals: 1 },
  sodium: { key: 'sodium', name: 'Sodium', unit: 'mg', group: 'minerals', decimals: 0 },
  zinc: { key: 'zinc', name: 'Zinc', unit: 'mg', group: 'minerals', decimals: 1 },
};

export const GROUP_LABELS: Record<NutrientGroup, string> = {
  general: 'General',
  carbs: 'Carbohydrates',
  lipids: 'Lipids',
  vitamins: 'Vitamins',
  minerals: 'Minerals',
  other: 'Other',
};

export const GROUP_ORDER: NutrientGroup[] = ['general', 'carbs', 'lipids', 'vitamins', 'minerals', 'other'];

export function isNutrientKey(k: string): k is NutrientKey {
  return (NUTRIENT_KEYS as readonly string[]).includes(k);
}

/** Scale per-100 g nutrients to a gram amount. Missing values stay missing. */
export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  const out: Nutrients = {};
  const f = grams / 100;
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (v !== undefined) out[key] = v * f;
  }
  return out;
}

export interface NutrientTotals {
  values: Nutrients;
  /** Number of logged items that had no data for each nutrient. */
  missing: Partial<Record<NutrientKey, number>>;
  count: number;
}

export function sumNutrients(items: Nutrients[]): NutrientTotals {
  const values: Nutrients = {};
  const missing: Partial<Record<NutrientKey, number>> = {};
  for (const item of items) {
    for (const key of NUTRIENT_KEYS) {
      const v = item[key];
      if (v === undefined) {
        missing[key] = (missing[key] ?? 0) + 1;
      } else {
        values[key] = (values[key] ?? 0) + v;
      }
    }
  }
  return { values, missing, count: items.length };
}

export function formatAmount(key: NutrientKey, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '–';
  const d = NUTRIENTS[key].decimals;
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? Math.min(d, 0) : abs >= 10 ? Math.min(d, 1) : d;
  return value.toFixed(decimals);
}

export function netCarbs(n: Nutrients): number | undefined {
  if (n.carbs === undefined) return undefined;
  return Math.max(0, n.carbs - (n.fiber ?? 0));
}

/** Only keep finite, non-negative values for known nutrient keys. */
export function sanitizeNutrients(input: Record<string, unknown>): Nutrients {
  const out: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const v = input[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6) out[key] = v;
  }
  return out;
}
