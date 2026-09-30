import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Params = SQLInputValue[];
const norm = (params: unknown[]): Params => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as Params;

/** Minimal expo-sqlite async API over node:sqlite, for exercising the real data layer in tests. */
export function openTestDb(path = ':memory:', readOnly = false): SQLiteDatabase {
  const db = new DatabaseSync(path, { readOnly });
  const api = {
    execAsync: async (sql: string) => void db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...norm(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...norm(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...norm(params)) ?? null,
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    withExclusiveTransactionAsync: async (task: (txn: SQLiteDatabase) => Promise<void>) => {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await task(api as unknown as SQLiteDatabase);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
  return api as unknown as SQLiteDatabase;
}
