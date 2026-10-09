import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { ResultRow } from '@/db/schema';
import { getMode } from '@/modes/registry';
import { useSession } from '@/store/session';
import { useScanSession } from '@/store/scanSession';
import { readItemText } from './library';
import { loadItem } from './openItem';

/** Opens a library item on the Result screen; reports unreadable items instead of crashing. */
export async function openLibraryItem(row: ResultRow): Promise<void> {
  // Library is shared by all modes; only enabled modes can be opened (Phase 2 will register Scan here).
  if (!getMode(row.mode)?.enabled) {
    Alert.alert(
      'Not available yet',
      `Results from "${row.mode}" mode can't be opened in this version.`,
    );
    return;
  }
  if (row.mode === 'scan') {
    try {
      const text = await readItemText(row);
      useScanSession.getState().openSaved({ sourceUri: row.originalUri, text, itemId: row.id });
      router.push('/scan');
    } catch {
      Alert.alert(
        'Could not open this scan',
        'Its files may have been removed. You can delete it from the library.',
      );
    }
    return;
  }
  try {
    const result = await loadItem(row);
    useSession.setState({ sourceUri: row.originalUri, capOverride: null, result, itemId: row.id });
    router.push('/result');
  } catch {
    Alert.alert(
      'Could not open this result',
      'Its files may have been removed. You can delete it from the library.',
    );
  }
}
