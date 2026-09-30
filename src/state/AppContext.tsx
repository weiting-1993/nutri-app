import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { computeTargets, type Targets } from '../domain/targets';
import type { StoredProfile } from '../domain/types';
import { getSetting, listProfiles, setSetting } from '../data/userDb';

const FoodsDbContext = createContext<SQLiteDatabase | null>(null);

/** Captures the outer (foods) SQLiteProvider before the user DB provider shadows it. */
export function FoodsDbBridge({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  return <FoodsDbContext.Provider value={db}>{children}</FoodsDbContext.Provider>;
}

export function useFoodsDb(): SQLiteDatabase {
  const db = useContext(FoodsDbContext);
  if (!db) throw new Error('useFoodsDb must be used inside FoodsDbBridge');
  return db;
}

export const useUserDb = useSQLiteContext;

interface AppState {
  loading: boolean;
  loadError: boolean;
  profiles: StoredProfile[];
  profile: StoredProfile | null;
  targets: Targets;
  setActiveProfile: (id: string) => Promise<void>;
  reloadProfiles: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const ACTIVE_PROFILE_KEY = 'activeProfileId';

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const apply = useCallback((list: StoredProfile[], active: string | null) => {
    setProfiles(list);
    setActiveId(list.some((p) => p.id === active) ? active : (list[0]?.id ?? null));
    setLoadError(false);
    setLoading(false);
  }, []);

  const reloadProfiles = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([listProfiles(db), getSetting(db, ACTIVE_PROFILE_KEY)]);
      apply(list, active);
    } catch {
      setLoadError(true);
    }
  }, [db, apply]);

  useEffect(() => {
    let alive = true;
    Promise.all([listProfiles(db), getSetting(db, ACTIVE_PROFILE_KEY)]).then(
      ([list, active]) => {
        if (alive) apply(list, active);
      },
      () => {
        if (alive) setLoadError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [db, apply]);

  const setActiveProfile = useCallback(
    async (id: string) => {
      await setSetting(db, ACTIVE_PROFILE_KEY, id);
      setActiveId(id);
    },
    [db],
  );

  const profile = profiles.find((p) => p.id === activeId) ?? null;
  const targets = useMemo(() => (profile ? computeTargets(profile) : {}), [profile]);

  const value = useMemo(
    () => ({ loading, loadError, profiles, profile, targets, setActiveProfile, reloadProfiles }),
    [loading, loadError, profiles, profile, targets, setActiveProfile, reloadProfiles],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** For screens that require a profile; the root layout guarantees one exists before rendering them. */
export function useProfile(): StoredProfile {
  const { profile } = useApp();
  if (!profile) throw new Error('No active profile');
  return profile;
}
