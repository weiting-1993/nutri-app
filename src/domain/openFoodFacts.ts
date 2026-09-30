import { z } from 'zod';
import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from './nutrients';

/** Validates EAN-8, UPC-A (12), EAN-13 and GTIN-14 including the check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** UPC-E (8 digits starting with 0/1) is expanded to UPC-A by scanners already; normalize UPC-A to EAN-13. */
export function normalizeBarcode(code: string): string {
  const c = code.trim();
  return c.length === 12 ? `0${c}` : c;
}

const num = z.union([z.number(), z.string()]).transform((v) => (typeof v === 'number' ? v : Number(v)));

const productSchema = z.object({
  status: z.union([z.number(), z.string()]).optional(),
  product: z
    .object({
      product_name: z.string().max(500).optional(),
      product_name_en: z.string().max(500).optional(),
      brands: z.string().max(500).optional(),
      serving_size: z.string().max(200).optional(),
      serving_quantity: num.optional(),
      nutriments: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

/** OFF normalizes *_100g mass values to grams; convert to the app's units. */
const OFF_FIELDS: Partial<Record<NutrientKey, { field: string; factor: number }>> = {
  protein: { field: 'proteins_100g', factor: 1 },
  carbs: { field: 'carbohydrates_100g', factor: 1 },
  fiber: { field: 'fiber_100g', factor: 1 },
  sugars: { field: 'sugars_100g', factor: 1 },
  fat: { field: 'fat_100g', factor: 1 },
  satFat: { field: 'saturated-fat_100g', factor: 1 },
  monoFat: { field: 'monounsaturated-fat_100g', factor: 1 },
  polyFat: { field: 'polyunsaturated-fat_100g', factor: 1 },
  transFat: { field: 'trans-fat_100g', factor: 1 },
  omega3: { field: 'omega-3-fat_100g', factor: 1 },
  omega6: { field: 'omega-6-fat_100g', factor: 1 },
  cholesterol: { field: 'cholesterol_100g', factor: 1000 },
  caffeine: { field: 'caffeine_100g', factor: 1000 },
  vitA: { field: 'vitamin-a_100g', factor: 1e6 },
  vitC: { field: 'vitamin-c_100g', factor: 1000 },
  vitD: { field: 'vitamin-d_100g', factor: 1e6 },
  vitE: { field: 'vitamin-e_100g', factor: 1000 },
  vitK: { field: 'vitamin-k_100g', factor: 1e6 },
  thiamin: { field: 'vitamin-b1_100g', factor: 1000 },
  riboflavin: { field: 'vitamin-b2_100g', factor: 1000 },
  niacin: { field: 'vitamin-pp_100g', factor: 1000 },
  pantothenicAcid: { field: 'pantothenic-acid_100g', factor: 1000 },
  vitB6: { field: 'vitamin-b6_100g', factor: 1000 },
  biotin: { field: 'biotin_100g', factor: 1e6 },
  folate: { field: 'vitamin-b9_100g', factor: 1e6 },
  vitB12: { field: 'vitamin-b12_100g', factor: 1e6 },
  calcium: { field: 'calcium_100g', factor: 1000 },
  copper: { field: 'copper_100g', factor: 1000 },
  iodine: { field: 'iodine_100g', factor: 1e6 },
  iron: { field: 'iron_100g', factor: 1000 },
  magnesium: { field: 'magnesium_100g', factor: 1000 },
  manganese: { field: 'manganese_100g', factor: 1000 },
  phosphorus: { field: 'phosphorus_100g', factor: 1000 },
  potassium: { field: 'potassium_100g', factor: 1000 },
  selenium: { field: 'selenium_100g', factor: 1e6 },
  sodium: { field: 'sodium_100g', factor: 1000 },
  zinc: { field: 'zinc_100g', factor: 1000 },
};

export interface OffProduct {
  barcode: string;
  name: string;
  brand: string;
  per100g: Nutrients;
  servingLabel?: string;
  servingGrams?: number;
  warnings: string[];
}

function readNumber(n: Record<string, unknown>, field: string): number | undefined {
  const raw = n[field];
  const v = typeof raw === 'string' ? Number(raw) : raw;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function cleanText(s: string | undefined, max: number): string {
  return (s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
}

export function atwaterEnergy(n: Nutrients): number | undefined {
  if (n.protein === undefined || n.carbs === undefined || n.fat === undefined) return undefined;
  return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 7 * (n.alcohol ?? 0);
}

/** Returns null when the product is missing or has no usable nutrition data. */
export function parseOffResponse(barcode: string, json: unknown): OffProduct | null {
  const parsed = productSchema.safeParse(json);
  if (!parsed.success || !parsed.data.product) return null;
  const p = parsed.data.product;
  const n = p.nutriments ?? {};
  const warnings: string[] = [];

  const per100g: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const def = OFF_FIELDS[key];
    if (!def) continue;
    const v = readNumber(n, def.field);
    if (v !== undefined) per100g[key] = v * def.factor;
  }
  if (per100g.sodium === undefined) {
    const salt = readNumber(n, 'salt_100g');
    if (salt !== undefined) per100g.sodium = (salt / 2.5) * 1000;
  }

  let energy = readNumber(n, 'energy-kcal_100g');
  if (energy === undefined) {
    const kj = readNumber(n, 'energy-kj_100g') ?? readNumber(n, 'energy_100g');
    if (kj !== undefined) energy = kj / 4.184;
  }
  const atwater = atwaterEnergy(per100g);
  if (energy === undefined && atwater !== undefined) {
    energy = atwater;
    warnings.push('Calories were not listed; estimated from protein, carbs and fat.');
  }
  if (energy === undefined) return null;
  per100g.energy = energy;

  if (atwater !== undefined && Math.abs(atwater - energy) > Math.max(30, energy * 0.25)) {
    warnings.push('Calories do not match protein/carbs/fat. Please double-check against the label.');
  }
  for (const k of ['protein', 'carbs', 'fat'] as const) {
    if ((per100g[k] ?? 0) > 100) warnings.push(`${k} exceeds 100 g per 100 g; the data is likely wrong.`);
  }

  const servingGrams = p.serving_quantity;
  const validServing = servingGrams !== undefined && Number.isFinite(servingGrams) && servingGrams > 0 && servingGrams <= 5000;

  return {
    barcode,
    name: cleanText(p.product_name || p.product_name_en, 200) || `Product ${barcode}`,
    brand: cleanText(p.brands?.split(',')[0], 100),
    per100g,
    servingLabel: validServing ? cleanText(p.serving_size, 60) || 'serving' : undefined,
    servingGrams: validServing ? servingGrams : undefined,
    warnings,
  };
}
