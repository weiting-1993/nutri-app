import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from './helpers/sqliteAdapter';

vi.mock('expo-crypto', () => ({ randomUUID: () => randomUUID() }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));

const { buildBackup, importBackup } = await import('../src/data/backupIo');
const { getFood, searchFoods } = await import('../src/data/foodRepo');
const userDb = await import('../src/data/userDb');
const { DEFAULT_MACROS } = await import('../src/domain/targets');
type DiaryEntry = import('../src/domain/types').DiaryEntry;

const FOODS_DB = path.resolve(__dirname, '../assets/db/foods.db');

function profile(name: string) {
  return {
    id: randomUUID(),
    name,
    sex: 'female' as const,
    birthYear: 1995,
    heightCm: 165,
    weightKg: 60,
    activity: 'light' as const,
    goalRateKgPerWeek: 0,
    macros: DEFAULT_MACROS,
    overrides: {},
  };
}

function entry(profileId: string, date: string, over: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: randomUUID(),
    profileId,
    date,
    meal: 'breakfast',
    foodKey: 'usda:173944',
    name: 'Bananas, raw',
    quantity: 1,
    unitLabel: '1 medium (118 g)',
    grams: 118,
    nutrients: { energy: 105, protein: 1.3, potassium: 422 },
    createdAt: Date.now(),
    ...over,
  };
}

let db: SQLiteDatabase;
beforeEach(async () => {
  db = openTestDb();
  await userDb.migrateUserDb(db);
  await userDb.migrateUserDb(db); // idempotent
});

describe('user database', () => {
  it('stores profiles with whitelisted fields only', async () => {
    const p = profile('Wei-Ting');
    await userDb.saveProfile(db, { ...p, role: 'admin', overrides: { energy: 1800, bogus: 5 } } as never);
    const [stored] = await userDb.listProfiles(db);
    expect(stored.name).toBe('Wei-Ting');
    expect(stored.overrides).toEqual({ energy: 1800 });
    expect('role' in stored).toBe(false);
  });

  it('logs, edits, lists recents, copies and deletes entries', async () => {
    const p = profile('A');
    await userDb.saveProfile(db, p);
    const e1 = entry(p.id, '2026-09-29', { createdAt: 1 });
    const e2 = entry(p.id, '2026-09-29', { meal: 'lunch', foodKey: 'bls:B511000', name: 'Weizenbrötchen', unitLabel: 'g', quantity: 60, grams: 60, createdAt: 2 });
    await userDb.saveEntry(db, e1);
    await userDb.saveEntry(db, e2);
    await userDb.saveEntry(db, { ...e1, quantity: 2, grams: 236 }); // edit
    expect((await userDb.getEntry(db, p.id, e1.id))?.grams).toBe(236);

    const recents = await userDb.recentFoods(db, p.id);
    expect(recents.map((r) => r.foodKey)).toEqual(['bls:B511000', 'usda:173944']);

    // AI estimates and quick adds have no food key; they appear by name, most recent amount first.
    const ai = { foodKey: null, name: 'duck noodles (AI estimate)', unitLabel: 'g', quantity: 350, grams: 350 };
    await userDb.saveEntry(db, entry(p.id, '2026-09-28', { ...ai, id: 'ai-1', createdAt: 3 }));
    await userDb.saveEntry(db, entry(p.id, '2026-09-29', { ...ai, id: 'ai-2', quantity: 400, grams: 400, createdAt: 4 }));
    const withAi = await userDb.recentFoods(db, p.id);
    expect(withAi.map((r) => r.id)).toEqual(['name:duck noodles (AI estimate)', 'bls:B511000', 'usda:173944']);
    expect(withAi[0]).toMatchObject({ foodKey: null, grams: 400, uses: 2 });
    await userDb.deleteEntry(db, p.id, 'ai-1');
    await userDb.deleteEntry(db, p.id, 'ai-2');

    expect(await userDb.copyEntries(db, p.id, '2026-09-29', '2026-09-30', 'lunch')).toBe(1);
    expect(await userDb.copyEntries(db, p.id, '2026-09-29', '2026-09-30')).toBe(2);
    expect(await userDb.listEntries(db, p.id, '2026-09-30')).toHaveLength(3);

    await userDb.deleteEntry(db, p.id, e1.id);
    expect(await userDb.listEntries(db, p.id, '2026-09-29')).toHaveLength(1);
  });

  it('keeps profiles isolated', async () => {
    const a = profile('A');
    const b = profile('B');
    await userDb.saveProfile(db, a);
    await userDb.saveProfile(db, b);
    const e = entry(a.id, '2026-09-30');
    await userDb.saveEntry(db, e);
    expect(await userDb.getEntry(db, b.id, e.id)).toBeNull();
    await userDb.deleteEntry(db, b.id, e.id); // wrong owner: no effect
    await userDb.saveEntry(db, { ...e, profileId: b.id, name: 'hijack' }); // wrong owner: no overwrite
    const still = await userDb.getEntry(db, a.id, e.id);
    expect(still?.name).toBe('Bananas, raw');
    expect(await userDb.listEntries(db, b.id, '2026-09-30')).toHaveLength(0);
  });

  it('deleting a profile removes its data', async () => {
    const a = profile('A');
    await userDb.saveProfile(db, a);
    await userDb.saveEntry(db, entry(a.id, '2026-09-30'));
    await userDb.saveWeight(db, { id: randomUUID(), profileId: a.id, date: '2026-09-30', kg: 60 });
    await userDb.deleteProfile(db, a.id);
    expect(await userDb.listEntries(db, a.id, '2026-09-30')).toHaveLength(0);
    expect(await userDb.listWeights(db, a.id)).toHaveLength(0);
  });

  it('upserts one weight per day', async () => {
    const a = profile('A');
    await userDb.saveProfile(db, a);
    await userDb.saveWeight(db, { id: randomUUID(), profileId: a.id, date: '2026-09-30', kg: 60 });
    await userDb.saveWeight(db, { id: randomUUID(), profileId: a.id, date: '2026-09-30', kg: 59.6 });
    await userDb.saveWeight(db, { id: randomUUID(), profileId: a.id, date: '2026-09-29', kg: 60.2 });
    expect((await userDb.listWeights(db, a.id)).map((w) => w.kg)).toEqual([60.2, 59.6]);
  });

  it('saves and logs saved meals', async () => {
    const a = profile('A');
    await userDb.saveProfile(db, a);
    const e = entry(a.id, '2026-09-29');
    const meal = { id: randomUUID(), profileId: a.id, name: 'Usual breakfast', items: [e, { ...e, name: 'Coffee', foodKey: null }], createdAt: 1 };
    await userDb.saveSavedMeal(db, meal);
    const [stored] = await userDb.listSavedMeals(db, a.id);
    expect(stored.items).toHaveLength(2);
    await userDb.logSavedMeal(db, stored, '2026-09-30', 'dinner');
    const logged = await userDb.listEntries(db, a.id, '2026-09-30');
    expect(logged.map((x) => x.meal)).toEqual(['dinner', 'dinner']);
  });
});

describe.skipIf(!existsSync(FOODS_DB))('food repository against the bundled database', () => {
  it('finds custom foods by name and barcode, and bundled foods with portions', async () => {
    const foodsDb = openTestDb(FOODS_DB, true);
    const id = randomUUID();
    await userDb.saveCustomFood(db, {
      id,
      name: 'Proteinriegel Schoko',
      brand: 'Testmarke',
      barcode: '4006381333931',
      servingLabel: '1 bar',
      servingGrams: 45,
      per100g: { energy: 380, protein: 33 },
      source: 'off',
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await searchFoods(foodsDb, db, 'proteinriegel'))[0].key).toBe(`custom:${id}`);
    expect((await searchFoods(foodsDb, db, 'testmarke'))[0].key).toBe(`custom:${id}`);
    expect((await userDb.findCustomFoodByBarcode(db, '4006381333931'))?.id).toBe(id);

    const banana = await getFood(foodsDb, db, 'usda:173944');
    expect(banana?.per100g.energy).toBe(89);
    expect(banana?.portions.length).toBeGreaterThan(0);
    const custom = await getFood(foodsDb, db, `custom:${id}`);
    expect(custom?.portions).toEqual([{ label: '1 bar', grams: 45 }]);

    const preferred = await searchFoods(foodsDb, db, 'banana', new Set(['usda:173944']));
    expect(preferred[0].key).toBe('usda:173944');
  });
});

describe('backup round trip', () => {
  it('exports and re-imports everything, idempotently, into a fresh database', async () => {
    const a = profile('A');
    await userDb.saveProfile(db, a);
    await userDb.saveEntry(db, entry(a.id, '2026-09-30'));
    await userDb.saveWeight(db, { id: randomUUID(), profileId: a.id, date: '2026-09-30', kg: 60 });
    await userDb.saveSavedMeal(db, { id: randomUUID(), profileId: a.id, name: 'M', items: [entry(a.id, '2026-09-30')], createdAt: 1 });
    await userDb.saveCustomFood(db, {
      id: randomUUID(),
      name: 'Oat drink',
      brand: '',
      barcode: null,
      servingLabel: null,
      servingGrams: null,
      per100g: { energy: 45 },
      source: 'custom',
      createdAt: 1,
      updatedAt: 1,
    });
    const json = JSON.stringify(await buildBackup(db));

    const fresh = openTestDb();
    await userDb.migrateUserDb(fresh);
    const first = await importBackup(fresh, json);
    expect(first).toEqual({ ok: true, counts: { profiles: 1, entries: 1, customFoods: 1, savedMeals: 1, weights: 1 } });
    const second = await importBackup(fresh, json);
    expect(second.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(await buildBackup(fresh)))).toMatchObject({
      profiles: [{ id: a.id, name: 'A' }],
      entries: [{ name: 'Bananas, raw' }],
      weights: [{ kg: 60 }],
    });
  });

  it('rejects malformed or hostile backups without touching data', async () => {
    const fresh = openTestDb();
    await userDb.migrateUserDb(fresh);
    expect((await importBackup(fresh, 'not json')).ok).toBe(false);
    expect((await importBackup(fresh, JSON.stringify({ app: 'other' }))).ok).toBe(false);
    expect((await importBackup(fresh, 'x'.repeat(51 * 1024 * 1024))).ok).toBe(false);
    expect(await userDb.listProfiles(fresh)).toHaveLength(0);
  });
});
