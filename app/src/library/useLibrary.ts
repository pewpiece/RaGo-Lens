import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { ResultRow } from '@/db/schema';
import { listItems } from './library';

/** Loads library rows whenever the screen gains focus. Errors become `error` (no crash). */
export function useLibraryItems(limit?: number) {
  const [items, setItems] = useState<ResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    try {
      setItems(listItems(limit));
      setError(null);
    } catch {
      setError('Your library could not be read.');
    } finally {
      setLoaded(true);
    }
  }, [limit]);
  useFocusEffect(refresh);
  return { items, error, loaded, refresh };
}
