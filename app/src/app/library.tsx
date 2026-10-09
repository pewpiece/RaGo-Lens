import { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Banner, Button, Header, Muted, Screen } from '@/components/ui';
import { deleteItems } from '@/library/library';
import { openLibraryItem } from '@/library/openAction';
import { useLibraryItems } from '@/library/useLibrary';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

const COLUMNS = 3;

export default function Library() {
  const { tokens: t } = useTheme();
  const { items, error, loaded, refresh } = useLibraryItems();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const selecting = selected.size > 0;
  const df = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }),
    [],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmDelete = () =>
    Alert.alert(
      `Delete ${selected.size} ${selected.size === 1 ? 'result' : 'results'}?`,
      'This cannot be undone. Files you exported to the gallery are not touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              deleteItems([...selected]);
              setSelected(new Set());
              setActionError(null);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                () => {},
              );
            } catch {
              setActionError('Could not delete. Please try again.');
            }
            refresh();
          },
        },
      ],
    );

  return (
    <Screen
      header={
        <Header
          title={selecting ? `${selected.size} selected` : 'Library'}
          right={
            selecting ? (
              <>
                <Button
                  label="Cancel"
                  kind="ghost"
                  onPress={() => setSelected(new Set())}
                  style={{ minHeight: 40, paddingHorizontal: spacing.sm }}
                />
                <Button
                  label="Delete"
                  kind="danger"
                  onPress={confirmDelete}
                  style={{ minHeight: 40, paddingHorizontal: spacing.md }}
                />
              </>
            ) : null
          }
        />
      }
      padded={false}
    >
      {error || actionError ? (
        <View style={{ padding: spacing.lg }}>
          <Banner tone="error">{error ?? actionError}</Banner>
        </View>
      ) : null}
      {loaded && items.length === 0 && !error ? (
        <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ color: t.text, fontSize: fontSizes.title, fontWeight: '700' }}>
            Nothing here yet
          </Text>
          <Muted>Cut-outs you make are saved here, on this phone only.</Muted>
        </View>
      ) : (
        <FlatList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          columnWrapperStyle={{ gap: spacing.sm }}
          renderItem={({ item }) => {
            const isSel = selected.has(item.id);
            return (
              <Pressable
                testID={`item-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Result from ${df.format(item.createdAt)}${isSel ? ', selected' : ''}`}
                accessibilityHint="Long press to select"
                accessibilityState={{ selected: isSel }}
                onPress={() => (selecting ? toggle(item.id) : void openLibraryItem(item))}
                onLongPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  toggle(item.id);
                }}
                style={[
                  styles.cell,
                  {
                    borderColor: isSel ? t.accent : t.border,
                    borderWidth: isSel ? 3 : 1,
                    backgroundColor: t.checkerboardA,
                  },
                ]}
              >
                <Image
                  source={{ uri: item.thumbUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
                <View style={[styles.date, { backgroundColor: t.overlay }]}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
                    {df.format(item.createdAt)}
                  </Text>
                </View>
                {item.mode === 'scan' ? (
                  <View style={[styles.modeBadge, { backgroundColor: t.accentScan }]}>
                    <Text style={{ color: t.onAccentScan, fontSize: 11, fontWeight: '800' }}>
                      Aa
                    </Text>
                  </View>
                ) : null}
                {isSel ? (
                  <View style={[styles.check, { backgroundColor: t.accent }]}>
                    <Text style={{ color: t.onAccent, fontWeight: '800' }}>✓</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    maxWidth: '33%',
  },
  modeBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  date: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  check: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
