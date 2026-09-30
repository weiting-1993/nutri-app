import { NUTRIENT_KEYS, type Nutrients } from '../../src/domain/nutrients.ts';

export type UsdaSource = 'foundation' | 'sr' | 'fndds';

interface RawNutrient {
  nutrient?: { id: number; unitName?: string };
  amount?: number;
}

interface RawPortion {
  amount?: number;
  value?: number;
  gramWeight?: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { name?: string; abbreviation?: string };
}

export interface RawUsdaFood {
  fdcId: number;
  description: string;
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
  foodCategory?: { description?: string };
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
}

export interface Portion {
  label: string;
  grams: number;
}

export interface MappedFood {
  id: number;
  name: string;
  source: UsdaSource;
  category: string;
  per100g: Nutrients;
  portions: Portion[];
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function first(byId: Map<number, number>, ...ids: number[]): number | undefined {
  for (const id of ids) {
    const v = byId.get(id);
    if (v !== undefined) return v;
  }
  return undefined;
}

function sumPresent(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : undefined;
}

/** Map USDA nutrient ids (per 100 g) to the app's nutrient keys. */
export function mapNutrients(raw: RawNutrient[]): Nutrients {
  const byId = new Map<number, number>();
  for (const n of raw) {
    if (!n?.nutrient || typeof n.amount !== 'number' || !Number.isFinite(n.amount) || n.amount < 0) continue;
    if (!byId.has(n.nutrient.id)) byId.set(n.nutrient.id, n.amount);
  }

  const protein = first(byId, 1003);
  const fat = first(byId, 1004, 1085);
  const carbs = first(byId, 1005, 1050);
  const alcohol = first(byId, 1018);

  let energy = first(byId, 1008, 2048, 2047);
  if (energy === undefined) {
    const kj = byId.get(1062);
    if (kj !== undefined) energy = kj / 4.184;
  }
  if (energy === undefined && protein !== undefined && fat !== undefined && carbs !== undefined) {
    energy = 4 * protein + 9 * fat + 4 * carbs + 7 * (alcohol ?? 0);
  }

  let vitD = first(byId, 1114);
  if (vitD === undefined) {
    const iu = byId.get(1110);
    if (iu !== undefined) vitD = iu / 40;
  }

  const omega3 = sumPresent([first(byId, 1404, 1270), byId.get(1278), byId.get(1280), byId.get(1272)]);
  const omega6 = sumPresent([
    first(byId, 1316, 1269),
    first(byId, 1408, 1271),
    byId.get(1321),
    byId.get(1313),
    byId.get(1406),
  ]);

  const out: Record<string, number | undefined> = {
    energy,
    protein,
    carbs,
    fiber: first(byId, 1079, 2033),
    sugars: first(byId, 2000, 1063),
    fat,
    satFat: byId.get(1258),
    monoFat: byId.get(1292),
    polyFat: byId.get(1293),
    transFat: byId.get(1257),
    omega3,
    omega6,
    cholesterol: byId.get(1253),
    alcohol,
    caffeine: byId.get(1057),
    water: byId.get(1051),
    vitA: byId.get(1106),
    vitC: byId.get(1162),
    vitD,
    vitE: byId.get(1109),
    vitK: sumPresent([byId.get(1185), byId.get(1183)]),
    thiamin: byId.get(1165),
    riboflavin: byId.get(1166),
    niacin: byId.get(1167),
    pantothenicAcid: byId.get(1170),
    vitB6: byId.get(1175),
    biotin: byId.get(1176),
    folate: first(byId, 1190, 1177),
    vitB12: byId.get(1178),
    choline: byId.get(1180),
    calcium: byId.get(1087),
    copper: byId.get(1098),
    iodine: byId.get(1100),
    iron: byId.get(1089),
    magnesium: byId.get(1090),
    manganese: byId.get(1101),
    phosphorus: byId.get(1091),
    potassium: byId.get(1092),
    selenium: byId.get(1103),
    sodium: byId.get(1093),
    zinc: byId.get(1095),
  };

  const nutrients: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const v = out[key];
    if (v !== undefined && Number.isFinite(v)) nutrients[key] = round(v);
  }
  return nutrients;
}

const SKIP_UNITS = new Set(['RACC', 'undetermined']);

export function mapPortion(p: RawPortion): Portion | null {
  const grams = p.gramWeight;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) return null;

  const desc = p.portionDescription?.trim();
  if (desc) {
    if (/quantity not specified/i.test(desc)) return null;
    return { label: desc, grams: round(grams, 2) };
  }

  const unitName = p.measureUnit?.name?.trim() ?? '';
  const unit = SKIP_UNITS.has(unitName) ? '' : unitName;
  if (unitName === 'RACC') return null;
  const modifier = (p.modifier ?? '').trim();
  const qty = p.amount ?? p.value ?? 1;
  const text = [unit, /^\d+$/.test(modifier) ? '' : modifier].filter(Boolean).join(' ').trim();
  if (!text || !(qty > 0)) return null;
  const qtyLabel = Number.isInteger(qty) ? String(qty) : String(round(qty, 3));
  return { label: `${qtyLabel} ${text}`, grams: round(grams, 2) };
}

export function mapFood(raw: RawUsdaFood | null | undefined, source: UsdaSource): MappedFood | null {
  if (!raw || typeof raw.fdcId !== 'number' || !raw.description) return null;
  const per100g = mapNutrients(raw.foodNutrients ?? []);
  if (per100g.energy === undefined) return null;

  const seen = new Set<string>();
  const portions: Portion[] = [];
  for (const p of raw.foodPortions ?? []) {
    const mapped = mapPortion(p);
    if (!mapped) continue;
    const k = mapped.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    portions.push(mapped);
  }

  return {
    id: raw.fdcId,
    name: raw.description.trim(),
    source,
    category: raw.foodCategory?.description ?? raw.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? '',
    per100g,
    portions,
  };
}
