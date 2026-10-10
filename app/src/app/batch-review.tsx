import { useCallback, useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Banner, Button, Header, Muted, Screen } from '@/components/ui';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import { listBatchItems, updateBatchItem } from '@/db/batchRepo';
import type { BatchItemRow, ResultRow } from '@/db/schema';
import { getItem, setItemStatus } from '@/library/library';
import { loadItem } from '@/library/openItem';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

const db = () => getDb() as unknown as SyncDb;

/** Steps through only the batch photos that were flagged: edit it, approve it as fine, or skip it. */
export default function BatchReview() {
  const { tokens: t } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [queue, setQueue] = useState<BatchItemRow[]>(() =>
    id ? listBatchItems(db(), id).filter((i) => i.status === 'needs_review') : [],
  );
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!id) return;
    setQueue(listBatchItems(db(), id).filter((i) => i.status === 'needs_review'));
  }, [id]);
  useFocusEffect(refresh); // on open, and again when coming back from the editor

  const current = queue.find((i) => !skipped.includes(i.id)) ?? null;
  const row: ResultRow | undefined = current?.resultId ? getItem(current.resultId) : undefined;

  const approve = () => {
    if (!current) return;
    updateBatchItem(db(), current.id, { status: 'done' });
    if (current.resultId) setItemStatus(current.resultId, 'ready');
    refresh();
  };
  const edit = async () => {
    if (!row) return;
    try {
      const result = await loadItem(row);
      useSession.setState({
        sourceUri: row.originalUri,
        capOverride: null,
        result,
        itemId: row.id,
      });
      router.push('/editor');
    } catch {
      Alert.alert('Could not open this photo', 'Its files may have been removed.');
      setError('Could not open this photo in the editor.');
    }
  };

  return (
    <Screen header={<Header title="Review" />}>
      {current && row ? (
        <View style={{ flex: 1, gap: spacing.md }}>
          <Muted>
            {queue.length - skipped.filter((s) => queue.some((q) => q.id === s)).length} left to
            look at. These were flagged because a clean-up check found something, or nothing was
            detected.
          </Muted>
          <View
            style={{
              flex: 1,
              minHeight: 240,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.checkerboardA,
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: row.thumbUri }}
              style={{ flex: 1 }}
              resizeMode="contain"
              accessibilityLabel={`Cut-out of ${current.name}`}
            />
          </View>
          <Text style={{ color: t.text, fontSize: fontSizes.bodyLg, fontWeight: '700' }}>
            {current.name || `Photo ${current.position + 1}`}
          </Text>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button
            label="Open in editor"
            kind="primary"
            onPress={() => void edit()}
            testID="review-edit"
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label="Looks fine"
              onPress={approve}
              style={{ flex: 1 }}
              testID="review-approve"
            />
            <Button
              label="Skip"
              kind="ghost"
              onPress={() => setSkipped([...skipped, current.id])}
              style={{ flex: 1 }}
              testID="review-skip"
            />
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
          <Text style={{ color: t.text, fontSize: fontSizes.title, fontWeight: '700' }}>
            {queue.length === 0 ? 'Nothing left to review' : 'You skipped the rest'}
          </Text>
          <Button label="Back to the batch" kind="primary" onPress={() => router.back()} />
        </View>
      )}
    </Screen>
  );
}
