import type { SQLiteDatabase } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { BACKUP_APP_ID, BACKUP_VERSION, MAX_BACKUP_BYTES, parseBackup, type Backup } from '../domain/backup';
import { todayKey } from '../domain/dates';
import type { DiaryEntry, SavedMeal, WeightEntry } from '../domain/types';
import {
  listCustomFoods,
  listEntriesInRange,
  listProfiles,
  listSavedMeals,
  listWeights,
  saveCustomFood,
  saveEntry,
  saveProfile,
  saveSavedMeal,
  saveWeight,
} from './userDb';

export async function buildBackup(db: SQLiteDatabase): Promise<Backup> {
  const profiles = await listProfiles(db);
  const entries: DiaryEntry[] = [];
  const weights: WeightEntry[] = [];
  const savedMeals: SavedMeal[] = [];
  for (const p of profiles) {
    entries.push(...(await listEntriesInRange(db, p.id, '0000-01-01', '9999-12-31')));
    weights.push(...(await listWeights(db, p.id)));
    savedMeals.push(...(await listSavedMeals(db, p.id)));
  }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profiles,
    entries,
    customFoods: await listCustomFoods(db),
    savedMeals,
    weights,
  };
}

export async function exportBackup(db: SQLiteDatabase): Promise<void> {
  const backup = await buildBackup(db);
  const file = new File(Paths.cache, `nutri-backup-${todayKey()}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(backup));
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save backup' });
  } finally {
    if (file.exists) file.delete();
  }
}

export type ImportCounts = Record<'profiles' | 'entries' | 'customFoods' | 'savedMeals' | 'weights', number>;
export type ImportResult = { ok: true; counts: ImportCounts } | { ok: false; error: string };

/** Merges a backup into the local database (records with the same id are overwritten). */
export async function pickAndImportBackup(db: SQLiteDatabase): Promise<ImportResult | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
  if (picked.canceled) return null;
  const file = picked.result;
  if ((file.size ?? 0) > MAX_BACKUP_BYTES) return { ok: false, error: 'Backup file is too large.' };
  return importBackup(db, await file.text());
}

export async function importBackup(db: SQLiteDatabase, raw: string): Promise<ImportResult> {
  if (raw.length > MAX_BACKUP_BYTES) return { ok: false, error: 'Backup file is too large.' };
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const b = parsed.backup;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of b.profiles) await saveProfile(txn, p, p.createdAt);
    for (const f of b.customFoods) await saveCustomFood(txn, f);
    for (const e of b.entries) await saveEntry(txn, e);
    for (const m of b.savedMeals) await saveSavedMeal(txn, m);
    for (const w of b.weights) await saveWeight(txn, w);
  });
  return {
    ok: true,
    counts: {
      profiles: b.profiles.length,
      entries: b.entries.length,
      customFoods: b.customFoods.length,
      savedMeals: b.savedMeals.length,
      weights: b.weights.length,
    },
  };
}
