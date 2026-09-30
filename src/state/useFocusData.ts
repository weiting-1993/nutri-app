import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Loads data whenever the screen gains focus or `load` changes; exposes a manual reload.
 * `load` must be memoized (useCallback) so it only changes when its inputs change.
 */
export function useFocusData<T>(load: () => Promise<T>): { data: T | undefined; reload: () => Promise<void>; error: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    try {
      const result = await load();
      if (id === seq.current) {
        setData(result);
        setError(false);
      }
    } catch (e) {
      if (id === seq.current) setError(true);
      console.warn('Failed to load data', e instanceof Error ? e.message : 'unknown error');
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      run();
    }, [run]),
  );

  return { data, reload: run, error };
}
