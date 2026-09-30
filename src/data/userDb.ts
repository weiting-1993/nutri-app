import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { sanitizeNutrients, type Nutrients } from '../domain/nutrients';
import { nameIndex, normalizeText, searchIndex, wordCount } from '../domain/search';
import type { Profile } from '../domain/targets';
import type { CustomFood, DiaryEntry, FoodKey, Meal, SavedMeal, SavedMealItem, StoredProfile, WeightEntry } from '../domain/types';
import { MEALS } from '../domain/types';

const SCHEMA_VERSION = 1;

export async function migrateUserDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        meal TEXT NOT NULL,
        food_key TEXT,
        name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_label TEXT NOT NULL,
        grams REAL,
        nutrients TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entries_profile_date ON entries(profile_id, date);
      CREATE INDEX IF NOT EXISTS entries_profile_food ON entries(profile_id, food_key, created_at);
      CREATE TABLE IF NOT EXISTS custom_foods (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        brand TEXT NOT NULL,
        barcode TEXT,
        serving_label TEXT,
        serving_grams REAL,
        per100g TEXT NOT NULL,
        source TEXT NOT NULL,
        name_norm TEXT NOT NULL,
        alt_norm TEXT NOT NULL DEFAULT '',
        search TEXT NOT NULL,
        words INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS custom_foods_barcode ON custom_foods(barcode);
      CREATE TABLE IF NOT EXISTS saved_meals (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        items TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS weights (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        kg REAL NOT NULL,
        UNIQUE(profile_id, date)
      );
    `);
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export const newId = () => randomUUID();

function parseNutrients(json: string): Nutrients {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? sanitizeNutrients(v) : {};
  } catch {
    return {};
  }
}

// ---------- settings ----------

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

// ---------- profiles ----------

function profileFromRow(row: { id: string; data: string; created_at: number }): StoredProfile | null {
  try {
    const data = JSON.parse(row.data) as Omit<Profile, 'id'>;
    return { ...data, overrides: data.overrides ?? {}, id: row.id, createdAt: row.created_at };
  } catch {
    return null;
  }
}

export async function listProfiles(db: SQLiteDatabase): Promise<StoredProfile[]> {
  const rows = await db.getAllAsync<{ id: string; data: string; created_at: number }>(
    'SELECT id, data, created_at FROM profiles ORDER BY created_at',
  );
  return rows.map(profileFromRow).filter((p): p is StoredProfile => p !== null);
}

export async function saveProfile(db: SQLiteDatabase, p: Profile, createdAt = Date.now()): Promise<void> {
  const data: Omit<Profile, 'id'> = {
    name: p.name,
    sex: p.sex,
    birthYear: p.birthYear,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    activity: p.activity,
    goalRateKgPerWeek: p.goalRateKgPerWeek,
    macros: { proteinPct: p.macros.proteinPct, carbsPct: p.macros.carbsPct, fatPct: p.macros.fatPct },
    overrides: sanitizeNutrients(p.overrides),
  };
  await db.runAsync(
    'INSERT INTO profiles (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    p.id,
    JSON.stringify(data),
    createdAt,
  );
}

export async function deleteProfile(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM profiles WHERE id = ?', id);
}

// ---------- diary entries ----------

interface EntryRow {
  id: string;
  profile_id: string;
  date: string;
  meal: string;
  food_key: string | null;
  name: string;
  quantity: number;
  unit_label: string;
  grams: number | null;
  nutrients: string;
  created_at: number;
}

function entryFromRow(r: EntryRow): DiaryEntry {
  return {
    id: r.id,
    profileId: r.profile_id,
    date: r.date,
    meal: (MEALS as readonly string[]).includes(r.meal) ? (r.meal as Meal) : 'snacks',
    foodKey: r.food_key as FoodKey | null,
    name: r.name,
    quantity: r.quantity,
    unitLabel: r.unit_label,
    grams: r.grams,
    nutrients: parseNutrients(r.nutrients),
    createdAt: r.created_at,
  };
}

const ENTRY_COLS = 'id, profile_id, date, meal, food_key, name, quantity, unit_label, grams, nutrients, created_at';

export async function listEntries(db: SQLiteDatabase, profileId: string, date: string): Promise<DiaryEntry[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT ${ENTRY_COLS} FROM entries WHERE profile_id = ? AND date = ? ORDER BY created_at`,
    profileId,
    date,
  );
  return rows.map(entryFromRow);
}

export async function listEntriesInRange(db: SQLiteDatabase, profileId: string, from: string, to: string): Promise<DiaryEntry[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT ${ENTRY_COLS} FROM entries WHERE profile_id = ? AND date BETWEEN ? AND ? ORDER BY date, created_at`,
    profileId,
    from,
    to,
  );
  return rows.map(entryFromRow);
}

export async function getEntry(db: SQLiteDatabase, profileId: string, id: string): Promise<DiaryEntry | null> {
  const row = await db.getFirstAsync<EntryRow>(`SELECT ${ENTRY_COLS} FROM entries WHERE id = ? AND profile_id = ?`, id, profileId);
  return row ? entryFromRow(row) : null;
}

export async function saveEntry(db: SQLiteDatabase, e: DiaryEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO entries (${ENTRY_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET meal = excluded.meal, date = excluded.date, quantity = excluded.quantity,
       unit_label = excluded.unit_label, grams = excluded.grams, nutrients = excluded.nutrients, name = excluded.name
     WHERE entries.profile_id = excluded.profile_id`,
    e.id,
    e.profileId,
    e.date,
    e.meal,
    e.foodKey,
    e.name,
    e.quantity,
    e.unitLabel,
    e.grams,
    JSON.stringify(sanitizeNutrients(e.nutrients)),
    e.createdAt,
  );
}

export async function deleteEntry(db: SQLiteDatabase, profileId: string, id: string): Promise<void> {
  await db.runAsync('DELETE FROM entries WHERE id = ? AND profile_id = ?', id, profileId);
}

/** Copy all entries (optionally one meal) from one day to another. Returns number copied. */
export async function copyEntries(
  db: SQLiteDatabase,
  profileId: string,
  fromDate: string,
  toDate: string,
  meal?: Meal,
): Promise<number> {
  const src = (await listEntries(db, profileId, fromDate)).filter((e) => !meal || e.meal === meal);
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const [i, e] of src.entries()) {
      await saveEntry(db, { ...e, id: newId(), date: toDate, createdAt: now + i });
    }
  });
  return src.length;
}

export interface RecentFood {
  /** Stable list key: the food key, or `name:<name>` for entries without one (AI estimates, quick adds). */
  id: string;
  /** null for AI estimates and quick adds, which can only be re-logged as they were. */
  foodKey: FoodKey | null;
  name: string;
  quantity: number;
  unitLabel: string;
  grams: number | null;
  nutrients: Nutrients;
  uses: number;
}

const E_COLS = ENTRY_COLS.split(', ')
  .map((c) => `e.${c}`)
  .join(', ');

/**
 * Most recently logged distinct foods with their last-used amount. Database foods are grouped by
 * food key; AI estimates and quick adds (no food key) by name.
 */
export async function recentFoods(db: SQLiteDatabase, profileId: string, limit = 30): Promise<RecentFood[]> {
  const [keyed, unkeyed] = await Promise.all([
    db.getAllAsync<EntryRow & { uses: number }>(
      `SELECT ${E_COLS}, agg.uses
       FROM entries e
       JOIN (
         SELECT food_key, MAX(created_at) AS last, COUNT(*) AS uses
         FROM entries WHERE profile_id = ? AND food_key IS NOT NULL GROUP BY food_key
       ) agg ON agg.food_key = e.food_key AND agg.last = e.created_at
       WHERE e.profile_id = ?
       GROUP BY e.food_key
       ORDER BY agg.last DESC
       LIMIT ?`,
      profileId,
      profileId,
      limit,
    ),
    db.getAllAsync<EntryRow & { uses: number }>(
      `SELECT ${E_COLS}, agg.uses
       FROM entries e
       JOIN (
         SELECT name, MAX(created_at) AS last, COUNT(*) AS uses
         FROM entries WHERE profile_id = ? AND food_key IS NULL GROUP BY name
       ) agg ON agg.name = e.name AND agg.last = e.created_at
       WHERE e.profile_id = ? AND e.food_key IS NULL
       GROUP BY e.name
       ORDER BY agg.last DESC
       LIMIT ?`,
      profileId,
      profileId,
      limit,
    ),
  ]);
  return [...keyed, ...unkeyed]
    .map((r) => ({ e: entryFromRow(r), uses: r.uses }))
    .sort((a, b) => b.e.createdAt - a.e.createdAt)
    .slice(0, limit)
    .map(({ e, uses }) => ({
      id: e.foodKey ?? `name:${e.name}`,
      foodKey: e.foodKey,
      name: e.name,
      quantity: e.quantity,
      unitLabel: e.unitLabel,
      grams: e.grams,
      nutrients: e.nutrients,
      uses,
    }));
}

// ---------- custom foods ----------

interface CustomFoodRow {
  id: string;
  name: string;
  brand: string;
  barcode: string | null;
  serving_label: string | null;
  serving_grams: number | null;
  per100g: string;
  source: string;
  created_at: number;
  updated_at: number;
}

const CUSTOM_COLS = 'id, name, brand, barcode, serving_label, serving_grams, per100g, source, created_at, updated_at';

function customFromRow(r: CustomFoodRow): CustomFood {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    barcode: r.barcode,
    servingLabel: r.serving_label,
    servingGrams: r.serving_grams,
    per100g: parseNutrients(r.per100g),
    source: r.source === 'off' ? 'off' : 'custom',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getCustomFood(db: SQLiteDatabase, id: string): Promise<CustomFood | null> {
  const row = await db.getFirstAsync<CustomFoodRow>(`SELECT ${CUSTOM_COLS} FROM custom_foods WHERE id = ?`, id);
  return row ? customFromRow(row) : null;
}

export async function findCustomFoodByBarcode(db: SQLiteDatabase, barcode: string): Promise<CustomFood | null> {
  const row = await db.getFirstAsync<CustomFoodRow>(
    `SELECT ${CUSTOM_COLS} FROM custom_foods WHERE barcode = ? ORDER BY updated_at DESC LIMIT 1`,
    barcode,
  );
  return row ? customFromRow(row) : null;
}

export async function listCustomFoods(db: SQLiteDatabase): Promise<CustomFood[]> {
  const rows = await db.getAllAsync<CustomFoodRow>(`SELECT ${CUSTOM_COLS} FROM custom_foods ORDER BY name COLLATE NOCASE`);
  return rows.map(customFromRow);
}

export async function saveCustomFood(db: SQLiteDatabase, f: CustomFood): Promise<void> {
  await db.runAsync(
    `INSERT INTO custom_foods (${CUSTOM_COLS}, name_norm, alt_norm, search, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, brand = excluded.brand, barcode = excluded.barcode,
       serving_label = excluded.serving_label, serving_grams = excluded.serving_grams, per100g = excluded.per100g,
       name_norm = excluded.name_norm, alt_norm = excluded.alt_norm, search = excluded.search, words = excluded.words,
       updated_at = excluded.updated_at`,
    f.id,
    f.name,
    f.brand,
    f.barcode,
    f.servingLabel,
    f.servingGrams,
    JSON.stringify(sanitizeNutrients(f.per100g)),
    f.source,
    f.createdAt,
    f.updatedAt,
    nameIndex(f.name),
    normalizeText(f.brand),
    searchIndex(f.name, '', f.brand),
    wordCount(f.name),
  );
}

export async function deleteCustomFood(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM custom_foods WHERE id = ?', id);
}

// ---------- saved meals ----------

function parseMealItems(json: string): SavedMealItem[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((i) => i && typeof i.name === 'string' && typeof i.quantity === 'number')
      .map((i) => ({
        foodKey: typeof i.foodKey === 'string' ? (i.foodKey as FoodKey) : null,
        name: String(i.name).slice(0, 200),
        quantity: i.quantity,
        unitLabel: String(i.unitLabel ?? '').slice(0, 120),
        grams: typeof i.grams === 'number' ? i.grams : null,
        nutrients: sanitizeNutrients(i.nutrients ?? {}),
      }));
  } catch {
    return [];
  }
}

export async function listSavedMeals(db: SQLiteDatabase, profileId: string): Promise<SavedMeal[]> {
  const rows = await db.getAllAsync<{ id: string; profile_id: string; name: string; items: string; created_at: number }>(
    'SELECT id, profile_id, name, items, created_at FROM saved_meals WHERE profile_id = ? ORDER BY name COLLATE NOCASE',
    profileId,
  );
  return rows.map((r) => ({ id: r.id, profileId: r.profile_id, name: r.name, items: parseMealItems(r.items), createdAt: r.created_at }));
}

export async function saveSavedMeal(db: SQLiteDatabase, m: SavedMeal): Promise<void> {
  const items: SavedMealItem[] = m.items.map((i) => ({
    foodKey: i.foodKey,
    name: i.name,
    quantity: i.quantity,
    unitLabel: i.unitLabel,
    grams: i.grams,
    nutrients: sanitizeNutrients(i.nutrients),
  }));
  await db.runAsync(
    `INSERT INTO saved_meals (id, profile_id, name, items, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, items = excluded.items WHERE saved_meals.profile_id = excluded.profile_id`,
    m.id,
    m.profileId,
    m.name,
    JSON.stringify(items),
    m.createdAt,
  );
}

export async function deleteSavedMeal(db: SQLiteDatabase, profileId: string, id: string): Promise<void> {
  await db.runAsync('DELETE FROM saved_meals WHERE id = ? AND profile_id = ?', id, profileId);
}

/** Log every item of a saved meal into a diary meal. */
export async function logSavedMeal(db: SQLiteDatabase, m: SavedMeal, date: string, meal: Meal): Promise<void> {
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const [i, item] of m.items.entries()) {
      await saveEntry(db, { ...item, id: newId(), profileId: m.profileId, date, meal, createdAt: now + i });
    }
  });
}

// ---------- weights ----------

export async function listWeights(db: SQLiteDatabase, profileId: string): Promise<WeightEntry[]> {
  const rows = await db.getAllAsync<{ id: string; profile_id: string; date: string; kg: number }>(
    'SELECT id, profile_id, date, kg FROM weights WHERE profile_id = ? ORDER BY date',
    profileId,
  );
  return rows.map((r) => ({ id: r.id, profileId: r.profile_id, date: r.date, kg: r.kg }));
}

export async function saveWeight(db: SQLiteDatabase, w: WeightEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO weights (id, profile_id, date, kg) VALUES (?, ?, ?, ?)
     ON CONFLICT(profile_id, date) DO UPDATE SET kg = excluded.kg`,
    w.id,
    w.profileId,
    w.date,
    w.kg,
  );
}

export async function deleteWeight(db: SQLiteDatabase, profileId: string, id: string): Promise<void> {
  await db.runAsync('DELETE FROM weights WHERE id = ? AND profile_id = ?', id, profileId);
}
