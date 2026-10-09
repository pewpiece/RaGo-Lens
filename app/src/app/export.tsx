import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Canvas, Group } from '@shopify/react-native-skia';
import {
  Banner,
  Button,
  Header,
  Muted,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Toggle,
} from '@/components/ui';
import { Checkerboard } from '@/components/Checkerboard';
import { Slider } from '@/components/Slider';
import {
  copyImage,
  ExportError,
  saveToGallery,
  shareFile,
  writeVerifiedPng,
} from '@/export/actions';
import type { ExportBackground, ExportOptions, ExportSize } from '@/export/options';
import type { Bounds } from '@/engine/postprocess';
import { computeExportGeometry } from '@/scene/exportGeometry';
import {
  ExportTree,
  objectBoundsOf,
  renderExport,
  type RenderedExport,
  type SceneInputs,
} from '@/scene/exportRender';
import { useSession } from '@/store/session';
import { useSettingsStore } from '@/store/instances';
import { useTheme } from '@/theme/ThemeProvider';
import { radii, spacing } from '@/theme/tokens';

const SWATCHES = [
  '#FFFFFF',
  '#000000',
  '#F2E8D5',
  '#FF8A3D',
  '#2DD4BF',
  '#4F6BED',
  '#E5484D',
  '#30A46C',
];

type Notice = { tone: 'info' | 'error'; text: string } | null;

export default function ExportScreen() {
  const { tokens: t } = useTheme();
  const result = useSession((s) => s.result);
  const defaults = useSettingsStore((s) => s.exportDefaults);
  const setDefaults = useSettingsStore((s) => s.setExportDefaults);
  const [opts, setOpts] = useState<ExportOptions>(defaults);
  const [bounds, setBounds] = useState<Bounds | null | undefined>(undefined); // undefined = still measuring
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState<null | 'save' | 'share' | 'copy'>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const last = useRef<{ key: string; rendered: RenderedExport } | null>(null);

  const scene: SceneInputs | null = useMemo(
    () =>
      result
        ? {
            original: result.original,
            maskLayer: result.maskLayer,
            strokes: [],
            width: result.width,
            height: result.height,
          }
        : null,
    [result],
  );

  useEffect(() => {
    if (!result) router.replace('/');
  }, [result]);

  useEffect(() => {
    if (!scene) return;
    let alive = true;
    objectBoundsOf(scene)
      .then((b) => alive && setBounds(b))
      .catch(() => alive && setBounds(null));
    return () => {
      alive = false;
    };
  }, [scene]);

  if (!result || !scene) return null;

  const geometry = computeExportGeometry(
    result.width,
    result.height,
    opts.autoCrop ? (bounds ?? null) : null,
    opts,
  );
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));
  const showChecker = opts.background === 'transparent' || opts.background === 'shadow';
  const fit =
    box.w > 0 && box.h > 0 ? Math.min(box.w / geometry.outWidth, box.h / geometry.outHeight) : 1;

  const render = async (): Promise<RenderedExport> => {
    const key = JSON.stringify(opts);
    if (last.current?.key === key) return last.current.rendered;
    const rendered = await renderExport(scene, opts, opts.autoCrop ? (bounds ?? null) : null);
    last.current = { key, rendered };
    return rendered;
  };

  const run = async (kind: 'save' | 'share' | 'copy') => {
    if (busy) return;
    setBusy(kind);
    setNotice(null);
    try {
      const rendered = await render();
      if (kind === 'copy') {
        await copyImage(rendered.image);
        setNotice({ tone: 'info', text: 'Copied. Paste it into another app.' });
      } else {
        const uri = writeVerifiedPng(rendered);
        if (kind === 'save') {
          await saveToGallery(uri);
          setNotice({
            tone: 'info',
            text: `Saved to your gallery (${rendered.width}×${rendered.height} PNG${rendered.expectsAlpha ? ', transparent' : ''}).`,
          });
        } else {
          await shareFile(uri);
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      const text =
        e instanceof ExportError
          ? e.message
          : e instanceof Error && /memory/i.test(e.message)
            ? 'Not enough memory for that size. Choose a smaller output size and try again.'
            : 'Export failed. Please try again.';
      setNotice({ tone: 'error', text });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll header={<Header title="Export" />}>
      <View
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          height: 300,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: t.border,
          overflow: 'hidden',
        }}
      >
        {box.w > 0 ? (
          <Canvas style={{ width: box.w, height: box.h }} accessibilityLabel="Export preview">
            {showChecker ? <Checkerboard width={box.w} height={box.h} /> : null}
            <Group
              transform={[
                { translateX: (box.w - geometry.outWidth * fit) / 2 },
                { translateY: (box.h - geometry.outHeight * fit) / 2 },
                { scale: fit },
              ]}
            >
              <ExportTree scene={scene} options={opts} geometry={geometry} />
            </Group>
          </Canvas>
        ) : null}
      </View>
      <Muted style={{ marginTop: spacing.sm }}>
        {geometry.outWidth} × {geometry.outHeight} px · PNG{showChecker ? ' with transparency' : ''}
      </Muted>

      {notice ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </View>
      ) : null}

      <SectionTitle>Background</SectionTitle>
      <Segmented<ExportBackground>
        label="Background"
        value={opts.background}
        onChange={(v) => set('background', v)}
        options={[
          { value: 'transparent', label: 'Clear' },
          { value: 'white', label: 'White' },
          { value: 'color', label: 'Colour' },
          { value: 'shadow', label: 'Shadow' },
        ]}
      />
      {opts.background === 'color' ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}
        >
          {SWATCHES.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={`Colour ${c}`}
              accessibilityState={{ selected: opts.color === c }}
              onPress={() => set('color', c)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: c,
                borderWidth: opts.color === c ? 3 : 1,
                borderColor: opts.color === c ? t.accent : t.border,
              }}
            />
          ))}
        </View>
      ) : null}

      <SectionTitle>Size and crop</SectionTitle>
      <Toggle
        label="Auto-crop to object"
        value={opts.autoCrop}
        onChange={(v) => set('autoCrop', v)}
        hint={bounds === undefined && opts.autoCrop ? 'Measuring the object…' : undefined}
      />
      {opts.autoCrop ? (
        <Slider
          label="Padding"
          value={opts.paddingPercent}
          min={0}
          max={25}
          step={1}
          onChange={(v) => set('paddingPercent', v)}
          format={(v) => `${Math.round(v)}%`}
        />
      ) : null}
      <Row label="Output size">
        <Segmented<ExportSize>
          label="Output size"
          value={opts.size}
          onChange={(v) => set('size', v)}
          options={[
            { value: 'original', label: 'Original' },
            { value: 2048, label: '2048' },
            { value: 1024, label: '1024' },
          ]}
        />
      </Row>

      <SectionTitle>Save or share</SectionTitle>
      <View style={{ gap: spacing.sm }}>
        <Button
          label="Save to gallery"
          kind="primary"
          busy={busy === 'save'}
          disabled={!!busy && busy !== 'save'}
          onPress={() => void run('save')}
        />
        <Button
          label="Share"
          busy={busy === 'share'}
          disabled={!!busy && busy !== 'share'}
          onPress={() => void run('share')}
        />
        <Button
          label="Copy image"
          busy={busy === 'copy'}
          disabled={!!busy && busy !== 'copy'}
          onPress={() => void run('copy')}
        />
        <Button
          label="Use these settings as default"
          kind="ghost"
          onPress={() =>
            void setDefaults(opts).then(() =>
              setNotice({ tone: 'info', text: 'Saved as your default export settings.' }),
            )
          }
        />
      </View>
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
