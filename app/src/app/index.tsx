import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Card, Muted, Screen, SectionTitle } from '@/components/ui';
import { MODES } from '@/modes/registry';
import { useLibraryItems } from '@/library/useLibrary';
import { openLibraryItem } from '@/library/openAction';
import { useThemedStyles, useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing, type ThemeTokens } from '@/theme/tokens';

export default function Home() {
  const s = useThemedStyles(styles);
  const { tokens } = useTheme();
  const { items, error } = useLibraryItems(12);
  return (
    <Screen scroll>
      <View style={s.top}>
        <View style={s.brandDot} />
        <Text accessibilityRole="header" style={s.brand}>
          RaGo Lens
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          hitSlop={10}
          style={s.gear}
        >
          <Text style={s.gearText}>⚙</Text>
        </Pressable>
      </View>

      <SectionTitle>Modes</SectionTitle>
      <View style={{ gap: spacing.md }}>
        {MODES.map((m) => {
          const accent = tokens[m.accent];
          return (
            <Card
              key={m.id}
              testID={`mode-${m.id}`}
              accessibilityLabel={
                m.enabled ? `${m.title}. ${m.subtitle}` : `${m.title}, coming soon`
              }
              disabled={!m.enabled}
              onPress={m.enabled && m.route ? () => router.push(m.route as never) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
            >
              <View
                style={[s.glyph, { backgroundColor: m.enabled ? accent : tokens.surfaceRaised }]}
              >
                <Text
                  style={{ fontSize: 24, color: m.enabled ? tokens[m.onAccent] : tokens.textMuted }}
                >
                  {m.glyph}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{m.title}</Text>
                <Muted>{m.enabled ? m.subtitle : 'Coming soon'}</Muted>
              </View>
              {!m.enabled ? (
                <View style={s.pill}>
                  <Text style={s.pillText}>Coming soon</Text>
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>

      <View style={s.recentHeader}>
        <SectionTitle>Recent</SectionTitle>
        {items.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all results"
            onPress={() => router.push('/library')}
            hitSlop={10}
          >
            <Text style={s.link}>See all</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {items.length === 0 && !error ? (
        <Card>
          <Muted>Your cut-outs will show up here. Start with Cutout.</Muted>
        </Card>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(r) => r.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open result from ${new Date(item.createdAt).toLocaleDateString()}`}
              onPress={() => openLibraryItem(item)}
              style={s.thumb}
            >
              <Image
                source={{ uri: item.thumbUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
              />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = (t: ThemeTokens) =>
  StyleSheet.create({
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    brandDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: t.accent },
    brand: {
      flex: 1,
      color: t.text,
      fontSize: fontSizes.display,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    gearText: { color: t.text, fontSize: 24 },
    glyph: {
      width: 52,
      height: 52,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: { color: t.text, fontSize: fontSizes.title, fontWeight: '700' },
    pill: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    pillText: { color: t.textMuted, fontSize: fontSizes.caption, fontWeight: '600' },
    recentHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    link: {
      color: t.accent,
      fontSize: fontSizes.body,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    thumb: {
      width: 96,
      height: 96,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.checkerboardA,
      overflow: 'hidden',
    },
  });
