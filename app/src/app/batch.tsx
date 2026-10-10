import { useMemo, useState } from 'react';
import { Image, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Banner, Button, Header, Muted, Screen, SectionTitle } from '@/components/ui';
import { Chips } from '@/components/compose/Controls';
import { baseNameOf, formatName } from '@/batch/naming';
import {
  DEFAULT_BATCH_OPTIONS,
  MAX_BATCH_ITEMS,
  createBatch,
  type BatchOptions,
} from '@/batch/queue';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import { loadPresets, newPresetId } from '@/presets/store';
import type { Preset } from '@/presets/presets';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

const db = () => getDb() as unknown as SyncDb;

export default function NewBatch() {
  const { tokens: t } = useTheme();
  const [photos, setPhotos] = useState<{ uri: string; name: string }[]>([]);
  const [presets] = useState<Preset[]>(() => {
    try {
      return loadPresets(db());
    } catch {
      return [];
    }
  });
  const [options, setOptions] = useState<BatchOptions>(() => ({
    ...DEFAULT_BATCH_OPTIONS,
    presetId: presets[0]?.id ?? null,
  }));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preset = presets.find((p) => p.id === options.presetId) ?? null;
  const preview = useMemo(
    () =>
      photos.length === 0
        ? ''
        : formatName(
            options.naming,
            {
              name: photos[0]!.name,
              sku: options.skuPrefix
                ? `${options.skuPrefix}${'1'.padStart(String(photos.length).length, '0')}`
                : '',
              index: 1,
              total: photos.length,
              preset: preset?.name ?? 'original',
            },
            preset?.format === 'jpeg' ? 'jpg' : 'png',
          ),
    [photos, options, preset],
  );

  const pick = async () => {
    setError(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_BATCH_ITEMS,
        quality: 1,
      });
      if (r.canceled || !r.assets) return;
      const chosen = r.assets
        .slice(0, MAX_BATCH_ITEMS)
        .map((a) => ({ uri: a.uri, name: baseNameOf(a.fileName ?? a.uri) || 'photo' }));
      setPhotos(chosen);
      if (r.assets.length > MAX_BATCH_ITEMS)
        setError(`Only the first ${MAX_BATCH_ITEMS} photos were kept.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the gallery.');
    }
  };

  const start = () => {
    try {
      const id = newPresetId();
      createBatch(db(), {
        id,
        name: name.trim() || `Batch ${new Date().toLocaleDateString()}`,
        sources: photos,
        options,
      });
      router.replace({ pathname: '/batch-run', params: { id } } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the batch.');
    }
  };

  const input = {
    borderWidth: 1,
    borderColor: t.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
    color: t.text,
    minHeight: 48,
    fontSize: fontSizes.body,
  } as const;

  return (
    <Screen scroll header={<Header title="New batch" />}>
      <Muted>
        Pick up to {MAX_BATCH_ITEMS} photos. They are cut out one after another, framed the same
        way, and the ones that need a look are collected for review.
      </Muted>
      <View style={{ marginTop: spacing.md, gap: spacing.md }}>
        <Button
          label={photos.length ? `${photos.length} photos chosen. Choose again` : 'Choose photos'}
          kind={photos.length ? 'secondary' : 'primary'}
          onPress={() => void pick()}
          testID="pick-photos"
        />
        {photos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}
          >
            {photos.slice(0, 12).map((p) => (
              <Image
                key={p.uri}
                source={{ uri: p.uri }}
                style={{ width: 64, height: 64, borderRadius: radii.sm }}
                accessibilityIgnoresInvertColors
              />
            ))}
          </ScrollView>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
      </View>

      <SectionTitle>Preset</SectionTitle>
      <Chips
        label="Preset"
        value={options.presetId ?? 'none'}
        onChange={(id) => setOptions({ ...options, presetId: id === 'none' ? null : id })}
        options={[
          { value: 'none', label: 'No preset' },
          ...presets.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />

      <SectionTitle>Framing</SectionTitle>
      <Chips
        label="Framing"
        value={options.framing === 'centre' ? 'centre' : 'baseline'}
        onChange={(v) =>
          setOptions({ ...options, framing: v === 'centre' ? 'centre' : { baseline: 0.9 } })
        }
        options={[
          { value: 'centre', label: 'Centred' },
          { value: 'baseline', label: 'Same baseline' },
        ]}
      />
      <Muted style={{ marginTop: spacing.sm }}>
        Same fill ratio and padding for every photo, so the set looks uniform. Baseline puts every
        product on the same line near the bottom.
      </Muted>

      <SectionTitle>File names</SectionTitle>
      <View style={{ gap: spacing.sm }}>
        <TextInput
          accessibilityLabel="Batch name"
          placeholder="Batch name (optional)"
          placeholderTextColor={t.textMuted}
          value={name}
          onChangeText={setName}
          style={input}
        />
        <TextInput
          accessibilityLabel="SKU prefix"
          placeholder="SKU prefix (optional), e.g. SH-"
          placeholderTextColor={t.textMuted}
          value={options.skuPrefix}
          onChangeText={(v) => setOptions({ ...options, skuPrefix: v })}
          autoCapitalize="characters"
          style={input}
        />
        <TextInput
          accessibilityLabel="Naming template"
          placeholder="{name}"
          placeholderTextColor={t.textMuted}
          value={options.naming}
          onChangeText={(v) => setOptions({ ...options, naming: v })}
          autoCapitalize="none"
          style={input}
        />
        <Muted>
          Tokens: {'{name}'} {'{sku}'} {'{index}'} {'{preset}'}
        </Muted>
        {preview ? <Text style={{ color: t.text }}>First file: {preview}</Text> : null}
      </View>

      <View style={{ height: spacing.xl }} />
      <Button
        label={photos.length ? `Start (${photos.length} photos)` : 'Start'}
        kind="primary"
        disabled={photos.length === 0}
        onPress={start}
        testID="start-batch"
      />
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
