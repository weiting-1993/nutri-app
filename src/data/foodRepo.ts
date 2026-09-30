import type { SQLiteDatabase } from 'expo-sqlite';
import { NUTRIENT_KEYS, type Nutrients } from '../domain/nutrients';
import { buildSearchQuery, searchTokens } from '../domain/search';
import type { FoodDetail, FoodKey, FoodSearchResult } from '../domain/types';
import { getCustomFood } from './userDb';

const SOURCE_LABELS: Record<string, string> = {
  foundation: 'USDA Foundation',
  sr: 'USDA SR Legacy',
  fndds: 'USDA FNDDS',
  bls: 'BLS 4.0 (DE)',
};

const MAX_RESULTS = 60;

function subtitleFor(source: string, category: string, altName: string): string {
  return [SOURCE_LABELS[source] ?? source, altName || category].filter(Boolean).join(' · ');
}

/**
 * Searches custom foods and the bundled USDA/BLS database.
 * Foods in `preferredKeys` (e.g. the user's frequently logged foods) are moved to the top.
 */
export async function searchFoods(
  foodsDb: SQLiteDatabase,
  userDb: SQLiteDatabase,
  query: string,
  preferredKeys: ReadonlySet<string> = new Set(),
): Promise<FoodSearchResult[]> {
  type CustomRow = { id: string; name: string; brand: string; per100g: string };
  type FoodRow = { key: string; name: string; alt_name: string; source: string; category: string; energy: number | null };

  const run = async (tokens: string[], mode: 'all' | 'any') => {
    const customQ = buildSearchQuery(tokens, 'id, name, brand, per100g', 'custom_foods', 20, mode);
    const foodsQ = buildSearchQuery(tokens, 'key, name, alt_name, source, category, energy', 'foods', MAX_RESULTS, mode);
    if (!customQ || !foodsQ) return [[], []] as [CustomRow[], FoodRow[]];
    return Promise.all([
      userDb.getAllAsync<CustomRow>(customQ.sql, ...customQ.params),
      foodsDb.getAllAsync<FoodRow>(foodsQ.sql, ...foodsQ.params),
    ]);
  };
  const exact = searchTokens(query);
  const stemmed = searchTokens(query, { stemmed: true });
  if (exact.length === 0) return [];
  // Progressively looser: exact words, then plural-stripped, then any word.
  let [custom, foods] = await run(exact, 'all');
  if (custom.length + foods.length === 0) [custom, foods] = await run(stemmed, 'all');
  if (custom.length + foods.length === 0 && stemmed.length > 1) [custom, foods] = await run(stemmed, 'any');

  const results: FoodSearchResult[] = custom.map((c) => {
    let energy: number | undefined;
    try {
      const e = JSON.parse(c.per100g)?.energy;
      energy = typeof e === 'number' ? e : undefined;
    } catch {
      energy = undefined;
    }
    return { key: `custom:${c.id}` as FoodKey, name: c.name, subtitle: c.brand ? `${c.brand} · My foods` : 'My foods', energyPer100g: energy };
  });
  for (const f of foods) {
    results.push({
      key: f.key as FoodKey,
      name: f.name,
      subtitle: subtitleFor(f.source, f.category, f.alt_name),
      energyPer100g: f.energy ?? undefined,
    });
  }
  if (preferredKeys.size === 0) return results;
  const preferred = results.filter((r) => preferredKeys.has(r.key));
  return [...preferred, ...results.filter((r) => !preferredKeys.has(r.key))];
}

export async function getFood(foodsDb: SQLiteDatabase, userDb: SQLiteDatabase, key: FoodKey): Promise<FoodDetail | null> {
  if (key.startsWith('custom:')) {
    const food = await getCustomFood(userDb, key.slice(7));
    if (!food) return null;
    return {
      key,
      name: food.name,
      subtitle: [food.brand, food.source === 'off' ? 'Open Food Facts' : 'My foods'].filter(Boolean).join(' · '),
      per100g: food.per100g,
      portions: food.servingGrams && food.servingLabel ? [{ label: food.servingLabel, grams: food.servingGrams }] : [],
    };
  }

  const cols = NUTRIENT_KEYS.map((k) => `"${k}"`).join(', ');
  const row = await foodsDb.getFirstAsync<Record<string, unknown>>(
    `SELECT key, name, alt_name, source, category, ${cols} FROM foods WHERE key = ?`,
    key,
  );
  if (!row) return null;
  const per100g: Nutrients = {};
  for (const k of NUTRIENT_KEYS) {
    const v = row[k];
    if (typeof v === 'number') per100g[k] = v;
  }
  const portions = await foodsDb.getAllAsync<{ label: string; grams: number }>(
    'SELECT label, grams FROM portions WHERE food_key = ? ORDER BY seq',
    key,
  );
  return {
    key,
    name: String(row.name),
    subtitle: subtitleFor(String(row.source), String(row.category ?? ''), String(row.alt_name ?? '')),
    per100g,
    portions,
  };
}

/** Best database match for a free-text food name (used by AI meal parsing). */
export async function bestMatch(foodsDb: SQLiteDatabase, userDb: SQLiteDatabase, names: string[]): Promise<FoodSearchResult | null> {
  for (const n of names) {
    if (!n.trim()) continue;
    const results = await searchFoods(foodsDb, userDb, n);
    if (results.length) return results[0];
  }
  return null;
}
