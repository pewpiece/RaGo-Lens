import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import { Directory } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Button, Card, Header, Muted, Screen, SectionTitle } from '@/components/ui';
import { Chips } from '@/components/compose/Controls';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import { getBatch, listBatchItems } from '@/db/batchRepo';
import type { BatchItemRow, BatchRow } from '@/db/schema';
import {
  batchFileNames,
  deviceBatchRunner,
  exportBatchItem,
  type ExportDestination,
} from '@/batch/service';
import { parseBatchOptions, summarise, type BatchRunner, type BatchState } from '@/batch/queue';
import { shareFile } from '@/export/actions';
import { getItem } from '@/library/library';
import { loadPresets } from '@/presets/store';
import type { Preset } from '@/presets/presets';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

const db = () => getDb() as unknown as SyncDb;

const LABEL: Record<string, string> = {
  queued: 'Waiting',
  processing: 'Cutting out…',
  done: 'Done',
  needs_review: 'Needs a look',
  failed: 'Failed',
  cancelled: 'Stopped',
};
const STATE_TEXT: Record<BatchState, string> = {
  queued: 'Ready to start',
  running: 'Working…',
  paused: 'Paused',
  done: 'All done',
  needs_review: 'Done, some need a look',
  failed: 'Done, some failed',
};

export default function BatchRun() {
  const { tokens: t } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [batch, setBatch] = useState<BatchRow | null>(() =>
    id ? (getBatch(db(), id) ?? null) : null,
  );
  const [items, setItems] = useState<BatchItemRow[]>(() => (id ? listBatchItems(db(), id) : []));
  const [running, setRunning] = useState(false);
  const [presets] = useState<Preset[]>(() => {
    try {
      return loadPresets(db());
    } catch {
      return [];
    }
  });
  const [dest, setDest] = useState<'gallery' | 'folder'>('gallery');
  const [naming, setNaming] = useState(() =>
    batch ? parseBatchOptions(batch.optionsJson).naming : '{name}',
  );
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const runner = useRef<BatchRunner | null>(null);

  const refresh = useCallback(() => {
    if (!id) return;
    try {
      setBatch(getBatch(db(), id) ?? null);
      setItems(listBatchItems(db(), id));
      setRunning(runner.current?.isRunning ?? false);
    } catch {
      /* the screen keeps showing the last state */
    }
  }, [id]);

  useEffect(() => {
    const r = deviceBatchRunner(refresh);
    runner.current = r;
    // start (or resume after an app restart) right away if there is work left
    if (
      id &&
      listBatchItems(db(), id).some((i) => i.status === 'queued' || i.status === 'processing')
    )
      void r.run(id);
    return () => r.cancel();
  }, [id, refresh]);

  const { state, counts } = summarise(items, running);
  const options = batch ? parseBatchOptions(batch.optionsJson) : null;
  const preset = presets.find((p) => p.id === options?.presetId) ?? null;
  const finished = counts.done + counts.needs_review;

  const exportAll = async () => {
    if (exporting) return;
    const ready = items.filter(
      (i) => i.resultId && (i.status === 'done' || i.status === 'needs_review'),
    );
    if (ready.length === 0) return;
    setNotice(null);
    let destination: ExportDestination = { kind: 'gallery' };
    if (dest === 'folder') {
      try {
        destination = { kind: 'folder', directory: await Directory.pickDirectoryAsync() };
      } catch {
        return; // the picker was dismissed
      }
    }
    const names = batchFileNames(ready, preset, naming);
    const failures: string[] = [];
    setExporting({ done: 0, total: ready.length });
    for (let n = 0; n < ready.length; n++) {
      const it = ready[n]!;
      try {
        const row = getItem(it.resultId!);
        if (!row) throw new Error('its cut-out was removed from the library');
        await exportBatchItem(row, preset, names[n]!, destination);
      } catch (e) {
        failures.push(`${it.name}: ${e instanceof Error ? e.message : 'failed'}`);
      }
      setExporting({ done: n + 1, total: ready.length });
    }
    setExporting(null);
    setNotice(
      failures.length === 0
        ? {
            tone: 'info',
            text: `Exported ${ready.length} pictures ${dest === 'gallery' ? 'to your gallery' : 'to the folder you chose'}.`,
          }
        : {
            tone: 'error',
            text: `Exported ${ready.length - failures.length} of ${ready.length}. Not exported: ${failures.join('; ')}`,
          },
    );
  };

  const shareAll = async () => {
    // Android can share several files at once only through a native module; here each file gets its own share sheet.
    const ready = items.filter(
      (i) => i.resultId && (i.status === 'done' || i.status === 'needs_review'),
    );
    const names = batchFileNames(ready, preset, naming);
    for (let n = 0; n < ready.length; n++) {
      try {
        const row = getItem(ready[n]!.resultId!);
        if (!row) continue;
        const { writeVerifiedComposite } = await import('@/export/actions');
        const { loadSourceFromRow, toProductInputs } = await import('@/export/productSource');
        const { renderComposite } = await import('@/compose/render');
        const { parseEditState } = await import('@/edit/editState');
        const product = await toProductInputs(await loadSourceFromRow(row));
        const e = parseEditState(row.editStateJson);
        const r = await renderComposite(
          product,
          {
            canvas: e.canvas,
            transform: e.transform,
            shadow: e.shadow,
            background: e.background,
            fill: preset?.fill.target ?? 0.85,
          },
          preset
            ? {
                format: preset.format,
                quality: preset.jpegQuality,
                maxBytes: preset.maxFileKB ? preset.maxFileKB * 1024 : null,
              }
            : { format: 'png', quality: 100, maxBytes: null },
        );
        await shareFile(writeVerifiedComposite(r, names[n]!), r.format);
      } catch (e) {
        setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Sharing stopped.' });
        return;
      }
    }
  };

  if (!batch) {
    return (
      <Screen header={<Header title="Batch" />}>
        <Muted>This batch was not found.</Muted>
      </Screen>
    );
  }

  return (
    <Screen scroll header={<Header title={batch.name} />}>
      <Card>
        <Text style={{ color: t.text, fontSize: fontSizes.title, fontWeight: '700' }}>
          {STATE_TEXT[state]}
        </Text>
        <Muted>
          {finished} of {items.length} done
          {counts.needs_review ? ` · ${counts.needs_review} need a look` : ''}
          {counts.failed ? ` · ${counts.failed} failed` : ''}
        </Muted>
        <View
          style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: t.surfaceRaised,
            marginTop: spacing.sm,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${items.length ? Math.round((finished / items.length) * 100) : 0}%`,
              height: 8,
              backgroundColor: t.accent,
            }}
          />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        {running ? (
          <Button
            label="Cancel"
            kind="danger"
            onPress={() => runner.current?.cancel()}
            style={{ flex: 1 }}
            testID="batch-cancel"
          />
        ) : counts.queued + counts.cancelled + counts.processing > 0 ? (
          <Button
            label="Resume"
            kind="primary"
            onPress={() => id && void runner.current?.run(id)}
            style={{ flex: 1 }}
            testID="batch-resume"
          />
        ) : null}
        {counts.failed > 0 && !running ? (
          <Button
            label="Retry failed"
            onPress={() => {
              items
                .filter((i) => i.status === 'failed')
                .forEach((i) => runner.current?.retry(i.id));
              if (id) void runner.current?.run(id);
            }}
            style={{ flex: 1 }}
            testID="batch-retry"
          />
        ) : null}
      </View>

      {counts.needs_review > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Button
            label={`Review ${counts.needs_review} that need a look`}
            kind="primary"
            onPress={() => router.push({ pathname: '/batch-review', params: { id } } as never)}
            testID="batch-review"
          />
        </View>
      ) : null}

      <SectionTitle>Photos</SectionTitle>
      <View style={{ gap: spacing.sm }}>
        {items.map((it) => {
          const row = it.resultId ? getItem(it.resultId) : undefined;
          return (
            <View
              key={it.id}
              testID={`item-${it.position}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderWidth: 1,
                borderColor: it.status === 'failed' ? t.danger : t.border,
                borderRadius: radii.md,
                padding: spacing.sm,
                backgroundColor: t.surface,
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radii.sm,
                  backgroundColor: t.checkerboardA,
                  overflow: 'hidden',
                }}
              >
                {row ? (
                  <Image
                    source={{ uri: row.thumbUri }}
                    style={{ width: 52, height: 52 }}
                    resizeMode="contain"
                  />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontWeight: '600' }}>
                  {it.name || `Photo ${it.position + 1}`}
                </Text>
                <Text
                  style={{
                    color: it.status === 'failed' ? t.danger : t.textMuted,
                    fontSize: fontSizes.caption,
                  }}
                >
                  {LABEL[it.status] ?? it.status}
                  {it.error ? `: ${it.error}` : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {finished > 0 ? (
        <>
          <SectionTitle>Export</SectionTitle>
          <Chips
            label="Destination"
            value={dest}
            onChange={setDest}
            options={[
              { value: 'gallery', label: 'Gallery' },
              { value: 'folder', label: 'Choose folder' },
            ]}
          />
          <View style={{ height: spacing.sm }} />
          <TextInput
            accessibilityLabel="File name template"
            value={naming}
            onChangeText={setNaming}
            autoCapitalize="none"
            placeholder="{name}"
            placeholderTextColor={t.textMuted}
            style={{
              borderWidth: 1,
              borderColor: t.borderStrong,
              borderRadius: radii.md,
              padding: spacing.md,
              color: t.text,
              minHeight: 48,
            }}
          />
          <Muted>
            Tokens: {'{name}'} {'{sku}'} {'{index}'} {'{preset}'}
          </Muted>
          {notice ? (
            <View style={{ marginTop: spacing.sm }}>
              <Banner tone={notice.tone}>{notice.text}</Banner>
            </View>
          ) : null}
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label={
                exporting
                  ? `Exporting ${exporting.done} of ${exporting.total}…`
                  : `Export ${finished} pictures`
              }
              kind="primary"
              busy={!!exporting}
              onPress={() => void exportAll()}
              testID="batch-export"
            />
            <Button
              label="Share one by one"
              onPress={() => void shareAll()}
              disabled={!!exporting}
            />
          </View>
        </>
      ) : null}
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
