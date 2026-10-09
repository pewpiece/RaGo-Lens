import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { ResultRow } from '@/db/schema';
import { useSession } from '@/store/session';
import { loadItem } from './openItem';

/** Opens a library item on the Result screen; reports unreadable items instead of crashing. */
export async function openLibraryItem(row: ResultRow): Promise<void> {
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
