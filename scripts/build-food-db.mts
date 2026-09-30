/**
 * Builds assets/db/foods.db from:
 *  - USDA FoodData Central (Foundation, SR Legacy, FNDDS) JSON downloads — public domain
 *  - Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut — CC BY 4.0
 * Usage: npm run build:foods   (downloads into data-raw/ if missing)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NUTRIENT_KEYS, type Nutrients } from '../src/domain/nutrients.ts';
import { nameIndex, normalizeText, searchIndex, wordCount } from '../src/domain/search.ts';
import { FOOD_DB_VERSION } from '../src/data/foodDbVersion.ts';
import { mapFood, type Portion, type RawUsdaFood, type UsdaSource } from './lib/usda.ts';
import { blsColumnIndex, mapBlsRow } from './lib/bls.ts';
import { readFirstSheet } from './lib/xlsx.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data-raw');
const OUT = path.join(ROOT, 'assets', 'db', 'foods.db');

const USDA_DATASETS: { source: UsdaSource; zip: string; json: string }[] = [
  {
    source: 'foundation',
    zip: 'FoodData_Central_foundation_food_json_2026-04-30.zip',
    json: 'FoodData_Central_foundation_food_json_2026-04-30.json',
  },
  {
    source: 'sr',
    zip: 'FoodData_Central_sr_legacy_food_json_2018-04.zip',
    json: 'FoodData_Central_sr_legacy_food_json_2018-04.json',
  },
  {
    source: 'fndds',
    zip: 'FoodData_Central_survey_food_json_2024-10-31.zip',
    json: 'surveyDownload.json',
  },
];

const BLS_ZIP_URL = 'https://blsdb.de/download';
const BLS_XLSX = path.join(RAW, 'bls', 'BLS_4_0_2025_DE', 'BLS_4_0_Daten_2025_DE.xlsx');

interface Row {
  key: string;
  name: string;
  /** Secondary display name (English name for BLS foods). */
  altName: string;
  source: 'foundation' | 'sr' | 'fndds' | 'bls';
  category: string;
  per100g: Nutrients;
  portions: Portion[];
}

function ensureUsda(zip: string, json: string) {
  const jsonPath = path.join(RAW, json);
  if (existsSync(jsonPath)) return jsonPath;
  mkdirSync(RAW, { recursive: true });
  const zipPath = path.join(RAW, zip);
  if (!existsSync(zipPath)) {
    console.log(`Downloading ${zip}…`);
    execFileSync('curl', ['-sSfL', '-o', zipPath, `https://fdc.nal.usda.gov/fdc-datasets/${zip}`], { stdio: 'inherit' });
  }
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', RAW], { stdio: 'inherit' });
  if (!existsSync(jsonPath)) throw new Error(`Expected ${json} inside ${zip}`);
  return jsonPath;
}

const rows: Row[] = [];

for (const ds of USDA_DATASETS) {
  const parsed = JSON.parse(readFileSync(ensureUsda(ds.zip, ds.json), 'utf8')) as Record<string, RawUsdaFood[]>;
  const list = Object.values(parsed)[0] ?? [];
  let kept = 0;
  for (const raw of list) {
    const f = mapFood(raw, ds.source);
    if (!f) continue;
    rows.push({ key: `usda:${f.id}`, name: f.name, altName: '', source: f.source, category: f.category, per100g: f.per100g, portions: f.portions });
    kept++;
  }
  console.log(`${ds.source}: kept ${kept} / ${list.length}`);
}

if (!existsSync(BLS_XLSX)) {
  throw new Error(
    `BLS data not found at ${path.relative(ROOT, BLS_XLSX)}.\n` +
      `Download the ZIP from ${BLS_ZIP_URL} (free, CC BY 4.0) and unzip it into data-raw/bls/.`,
  );
}
const sheet = readFirstSheet(BLS_XLSX);
const index = blsColumnIndex(sheet[0]);
let blsKept = 0;
for (const r of sheet.slice(1)) {
  const f = mapBlsRow(r, index);
  if (!f) continue;
  rows.push({ key: `bls:${f.code}`, name: f.nameDe, altName: f.nameEn, source: 'bls', category: '', per100g: f.per100g, portions: [] });
  blsKept++;
}
console.log(`bls: kept ${blsKept} / ${sheet.length - 1}`);

mkdirSync(path.dirname(OUT), { recursive: true });
rmSync(OUT, { force: true });
const db = new DatabaseSync(OUT);
const nutrientCols = NUTRIENT_KEYS.map((k) => `"${k}" REAL`).join(', ');
db.exec(`
  PRAGMA journal_mode = DELETE;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE foods (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    alt_name TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    alt_norm TEXT NOT NULL,
    search TEXT NOT NULL,
    words INTEGER NOT NULL,
    ${nutrientCols}
  );
  CREATE TABLE portions (
    food_key TEXT NOT NULL REFERENCES foods(key),
    seq INTEGER NOT NULL,
    label TEXT NOT NULL,
    grams REAL NOT NULL
  );
`);

const insertFood = db.prepare(
  `INSERT INTO foods (key, name, alt_name, source, category, name_norm, alt_norm, search, words, ${NUTRIENT_KEYS.map((k) => `"${k}"`).join(', ')})
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${NUTRIENT_KEYS.map(() => '?').join(', ')})`,
);
const insertPortion = db.prepare('INSERT INTO portions (food_key, seq, label, grams) VALUES (?, ?, ?, ?)');

db.exec('BEGIN');
const seen = new Set<string>();
for (const f of rows) {
  if (seen.has(f.key)) continue;
  seen.add(f.key);
  insertFood.run(
    f.key,
    f.name,
    f.altName,
    f.source,
    f.category,
    nameIndex(f.name),
    normalizeText(f.altName),
    searchIndex(f.name, f.altName, f.category),
    wordCount(f.name),
    ...NUTRIENT_KEYS.map((k) => f.per100g[k] ?? null),
  );
  f.portions.forEach((p, i) => insertPortion.run(f.key, i, p.label, p.grams));
}
const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
insertMeta.run('version', String(FOOD_DB_VERSION));
insertMeta.run('built_at', new Date().toISOString());
insertMeta.run('sources', [...USDA_DATASETS.map((d) => d.json), 'BLS_4_0_Daten_2025_DE.xlsx'].join(','));
insertMeta.run(
  'attribution',
  'USDA FoodData Central (public domain); Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0 (CC BY 4.0)',
);
db.exec('COMMIT');
db.exec('CREATE INDEX portions_food ON portions(food_key, seq)');
db.exec('VACUUM');
db.close();

console.log(`Wrote ${seen.size} foods to ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1e6).toFixed(1)} MB)`);
