import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildSearchQuery, searchTokens } from '../src/domain/search';

const DB_PATH = path.resolve(__dirname, '../assets/db/foods.db');
const db = existsSync(DB_PATH) ? new DatabaseSync(DB_PATH, { readOnly: true }) : null;

/** Mirrors the fallback chain in src/data/foodRepo.ts searchFoods(). */
function search(q: string, limit = 5) {
  const attempts: [string[], 'all' | 'any'][] = [
    [searchTokens(q), 'all'],
    [searchTokens(q, { stemmed: true }), 'all'],
    [searchTokens(q, { stemmed: true }), 'any'],
  ];
  for (const [tokens, mode] of attempts) {
    const query = buildSearchQuery(tokens, 'key, name, source, energy', 'foods', limit, mode);
    if (!query) return [];
    const rows = db!.prepare(query.sql).all(...query.params) as { key: string; name: string; energy: number }[];
    if (rows.length) return rows;
  }
  return [];
}

const get = (key: string, cols: string) => db!.prepare(`SELECT ${cols} FROM foods WHERE key = ?`).get(key) as Record<string, number>;

describe.skipIf(!db)('bundled food database', () => {
  it('contains USDA and BLS datasets', () => {
    const rows = db!.prepare('SELECT source, COUNT(*) AS n FROM foods GROUP BY source').all() as { source: string; n: number }[];
    const counts = Object.fromEntries(rows.map((r) => [r.source, r.n]));
    expect(counts.sr).toBeGreaterThan(7000);
    expect(counts.fndds).toBeGreaterThan(5000);
    expect(counts.foundation).toBeGreaterThan(200);
    expect(counts.bls).toBeGreaterThan(6000);
  });

  it('records attribution for the BLS licence', () => {
    const meta = db!.prepare("SELECT value FROM meta WHERE key = 'attribution'").get() as { value: string };
    expect(meta.value).toMatch(/Max Rubner-Institut/);
  });

  it('matches USDA reference values', () => {
    expect(get('usda:173944', 'energy, protein, potassium')).toEqual({ energy: 89, protein: 1.09, potassium: 358 });
    expect(get('usda:171287', 'energy, protein')).toEqual({ energy: 143, protein: 12.6 });
  });

  it('matches BLS reference values with total carbs and unit conversions', () => {
    const roll = get('bls:B511000', 'energy, protein, carbs, fiber');
    expect(roll.energy).toBe(280);
    expect(roll.protein).toBeCloseTo(10.09);
    // BLS lists 53.97 g available carbohydrate + 3.6 g fiber.
    expect(roll.carbs).toBeCloseTo(57.57);
    const oats = get('bls:C133000', 'vitB6, copper');
    expect(oats.vitB6).toBeLessThan(1); // µg in BLS converted to mg
    expect(oats.copper).toBeLessThan(5); // µg in BLS converted to mg
  });

  it('every food has energy and non-negative values', () => {
    const bad = db!.prepare('SELECT COUNT(*) AS n FROM foods WHERE energy IS NULL OR energy < 0 OR protein < 0 OR fat < 0 OR carbs < 0').get() as { n: number };
    expect(bad.n).toBe(0);
    const portions = db!.prepare('SELECT COUNT(*) AS n FROM portions WHERE grams <= 0').get() as { n: number };
    expect(portions.n).toBe(0);
  });

  it.each([
    ['banana', /banana/i],
    ['eggs', /egg/i],
    ['chicken breast', /chicken.*breast/i],
    ['greek yogurt', /yogurt.*greek|greek.*yogurt/i],
    ['whole milk', /milk.*whole|whole.*milk/i],
    ['broccoli raw', /broccoli.*(raw|roh)/i],
    ['Haferflocken', /^Hafer Flocken$/],
    ['Vollkornbrot', /^Vollkornbrot$/],
    ['Apfel', /^Apfel roh$/],
    ['Kaffee', /^Kaffee \(Getränk\)$/],
    ['Weißbrot', /Weißbrot/],
  ])('search "%s" returns a relevant top result', (q, re) => {
    const results = search(q);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toMatch(re);
  });

  it('does not let German stemming produce nonsense', () => {
    expect(search('Reis').every((r) => /reis/i.test(r.name))).toBe(true);
  });

  it('finds partial multi-word queries via fallback', () => {
    expect(search('Käse Gouda', 10).some((r) => /Gouda/.test(r.name))).toBe(true);
  });

  it('treats SQL and LIKE metacharacters as plain text', () => {
    expect(() => search("'; DROP TABLE foods; --")).not.toThrow();
    expect(search('%')).toEqual([]);
    expect((db!.prepare('SELECT COUNT(*) AS n FROM foods').get() as { n: number }).n).toBeGreaterThan(19000);
  });
});
