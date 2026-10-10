import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { Banner, Button, Header, Muted, Screen, Toggle } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { Checkerboard } from '@/components/Checkerboard';
import { BG_SWATCHES, Chips, SHADOW_SWATCHES, Swatches } from '@/components/compose/Controls';
import { PresetEditor } from '@/components/compose/PresetEditor';
import { ComposeTree, type ProductInputs } from '@/compose/ComposeTree';
import {
  applyDrag,
  applyTwo,
  nudge,
  resetTransform,
  rotateBy,
  two,
  type Guides,
  type Two,
} from '@/compose/composeGesture';
import { framingTransform, sizeForAspect, snapRotation, ASPECTS } from '@/compose/layout';
import {
  layoutFor,
  renderComposite,
  type ComposeSpec,
  type OutputFormat,
  type RenderedComposite,
} from '@/compose/render';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import { DEFAULT_EDIT_STATE, serializeEditState, type EditState } from '@/edit/editState';
import { getOpenDoc, sessionKey } from '@/editor/registry';
import {
  copyImage,
  ExportError,
  saveToGallery,
  shareFile,
  writeVerifiedComposite,
} from '@/export/actions';
import {
  sourceFromDoc,
  sourceFromParts,
  toProductInputs,
  type ProductSource,
} from '@/export/productSource';
import { getItem, saveEditState } from '@/library/library';
import { maskFromImage } from '@/mask/maskImage';
import { parseEditState } from '@/edit/editState';
import { applyPresetToEdit } from '@/presets/applyPreset';
import { duplicatePreset, type Preset } from '@/presets/presets';
import { loadPresets, newPresetId, removePreset, savePreset } from '@/presets/store';
import { analyzeAndCheck, cleanupCounts } from '@/readiness/analyze';
import { worst, type Check, type Fix } from '@/readiness/checks';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

type Tab = 'layout' | 'move' | 'shadow' | 'look' | 'preset' | 'check';
type Notice = { tone: 'info' | 'error'; text: string } | null;
const TABS: { value: Tab; label: string }[] = [
  { value: 'layout', label: 'Canvas' },
  { value: 'move', label: 'Move' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'look', label: 'Background' },
  { value: 'preset', label: 'Preset' },
  { value: 'check', label: 'Check' },
];

const db = () => getDb() as unknown as SyncDb;
const kbToBytes = (kb: number | null) => (kb === null ? null : kb * 1024);

export default function ExportScreen() {
  const { tokens: t } = useTheme();
  const result = useSession((s) => s.result);
  const itemId = useSession((s) => s.itemId);
  const [tab, setTab] = useState<Tab>('layout');
  const [src, setSrc] = useState<ProductSource | null>(null);
  const [product, setProduct] = useState<ProductInputs | null>(null);
  const [edit, setEdit] = useState<EditState>(DEFAULT_EDIT_STATE);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [manualFmt, setManualFmt] = useState<OutputFormat>({
    format: 'png',
    quality: 92,
    maxBytes: null,
  });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<Guides | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'share' | 'copy' | 'prepare' | 'check'>(
    'prepare',
  );
  const [notice, setNotice] = useState<Notice>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [editing, setEditing] = useState<Preset | null>(null);
  const last = useRef<{ key: string; rendered: RenderedComposite } | null>(null);

  // ----- load: presets, and the product (open editor document, or the stored files)
  useEffect(() => {
    if (!result) {
      router.replace('/');
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        setPresets(loadPresets(db()));
      } catch {
        setPresets([]);
      }
      try {
        const doc = getOpenDoc(sessionKey(itemId, result.sourceUri));
        let source: ProductSource;
        if (doc) source = sourceFromDoc(doc);
        else {
          const row = itemId ? getItem(itemId) : undefined;
          source = sourceFromParts(
            result.original,
            maskFromImage(result.maskLayer),
            parseEditState(row?.editStateJson),
          );
        }
        const p = await toProductInputs(source);
        if (!alive) return;
        setSrc(source);
        setProduct(p);
        setEdit(source.edit);
      } catch (e) {
        if (alive)
          setNotice({
            tone: 'error',
            text: e instanceof Error ? e.message : 'Could not prepare the picture.',
          });
      } finally {
        if (alive) setBusy(null);
      }
    }, 30);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [result, itemId]);

  // ----- keep the edit state (transform, shadow, background, canvas, preset) with the library item
  useEffect(() => {
    if (!itemId || !src) return;
    const id = setTimeout(() => {
      try {
        saveEditState(itemId, serializeEditState(edit));
      } catch {
        /* the picture still exports; only remembering the settings failed */
      }
    }, 700);
    return () => clearTimeout(id);
  }, [edit, itemId, src]);

  const preset = presets.find((p) => p.id === edit.presetId) ?? null;
  const fmt: OutputFormat = preset
    ? { format: preset.format, quality: preset.jpegQuality, maxBytes: kbToBytes(preset.maxFileKB) }
    : manualFmt;
  const spec: ComposeSpec = useMemo(
    () => ({
      canvas: edit.canvas,
      transform: edit.transform,
      shadow: edit.shadow,
      background: edit.background,
      fill: preset?.fill.target ?? 0.85,
    }),
    [edit, preset],
  );
  const layout = product ? layoutFor(product, spec, fmt) : null;
  const ps = layout && box.w > 0 ? Math.min(box.w / layout.size.w, box.h / layout.size.h) : 1;

  const patch = useCallback((fn: (e: EditState) => EditState) => {
    last.current = null;
    setChecks(null);
    setEdit(fn);
  }, []);
  const setTransform = (tr: EditState['transform']) => patch((e) => ({ ...e, transform: tr }));

  // ----- gestures on the preview: one finger moves, two fingers pinch / twist / pan
  const ref$ = useRef({ edit, layout, ps });
  useEffect(() => {
    ref$.current = { edit, layout, ps };
  });
  const gesture = useRef<{ last: { x: number; y: number } | null; two: Two | null }>({
    last: null,
    two: null,
  });
  const touchesOf = (e: GestureResponderEvent) =>
    e.nativeEvent.touches.map((x) => ({ x: x.locationX, y: x.locationY }));
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const ts = touchesOf(e);
        gesture.current = { last: ts[0] ?? null, two: ts.length >= 2 ? two(ts[0]!, ts[1]!) : null };
      },
      onPanResponderMove: (e) => {
        const { layout: lay, ps: scale } = ref$.current;
        if (!lay) return;
        const ts = touchesOf(e);
        const g = gesture.current;
        if (ts.length >= 2) {
          const next = two(ts[0]!, ts[1]!);
          if (g.two) {
            const prev = g.two;
            setEdit((cur) => {
              const r = applyTwo(cur.transform, prev, next, scale, lay.size);
              setGuides(r.guides);
              return { ...cur, transform: r.t };
            });
          }
          gesture.current = { last: null, two: next };
          return;
        }
        if (g.two) {
          gesture.current = { last: ts[0] ?? null, two: null }; // one finger left: wait for a fresh touch
          return;
        }
        const p = ts[0]!;
        if (g.last) {
          const dx = p.x - g.last.x;
          const dy = p.y - g.last.y;
          setEdit((cur) => {
            const r = applyDrag(cur.transform, dx, dy, scale, lay.size);
            setGuides(r.guides);
            return { ...cur, transform: r.t };
          });
        }
        gesture.current = { last: p, two: null };
      },
      onPanResponderRelease: () => {
        gesture.current = { last: null, two: null };
        setGuides(null);
        last.current = null;
        setChecks(null);
      },
      onPanResponderTerminate: () => {
        gesture.current = { last: null, two: null };
        setGuides(null);
      },
    }),
  );

  // ----- presets
  const applyPreset = (p: Preset | null) => {
    if (!p) return patch((e) => ({ ...e, presetId: null }));
    patch((e) => applyPresetToEdit(e, p));
  };
  const savePresetAndRefresh = (p: Preset) => {
    savePreset(db(), p);
    setPresets(loadPresets(db()));
    setEditing(null);
    if (edit.presetId === p.id) applyPreset(p);
  };

  // ----- export
  const render = async (): Promise<RenderedComposite> => {
    if (!product) throw new Error('Not ready yet.');
    const key = JSON.stringify([spec, fmt]);
    if (last.current?.key === key) return last.current.rendered;
    const rendered = await renderComposite(product, spec, fmt);
    last.current = { key, rendered };
    return rendered;
  };
  const run = async (kind: 'save' | 'share' | 'copy') => {
    if (busy) return;
    setBusy(kind);
    setNotice(null);
    try {
      const r = await render();
      if (kind === 'copy') {
        await copyImage(r.image, r.format);
        setNotice({ tone: 'info', text: 'Copied. Paste it into another app.' });
      } else {
        const uri = writeVerifiedComposite(r);
        if (kind === 'save') {
          await saveToGallery(uri);
          setNotice({
            tone: r.overLimit ? 'error' : 'info',
            text: `Saved to your gallery (${r.width}×${r.height} ${r.format.toUpperCase()}${r.expectsAlpha ? ', transparent' : ''}${r.format === 'jpeg' ? `, quality ${r.quality}` : ''}).${r.overLimit ? ' It is still over the size limit: choose a smaller canvas.' : ''}`,
          });
        } else await shareFile(uri, r.format);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setNotice({
        tone: 'error',
        text:
          e instanceof ExportError
            ? e.message
            : e instanceof Error && /memory/i.test(e.message)
              ? 'Not enough memory for that size. Choose a smaller canvas and try again.'
              : 'Export failed. Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const runChecks = async () => {
    if (!product || !src || busy) return;
    setBusy('check');
    setTimeout(async () => {
      try {
        const r = await render();
        setChecks(await analyzeAndCheck(product, spec, fmt, preset, r, cleanupCounts(src)));
      } catch (e) {
        setNotice({
          tone: 'error',
          text: e instanceof Error ? e.message : 'The checks could not run.',
        });
      } finally {
        setBusy(null);
      }
    }, 20);
  };
  const applyFix = (f: Fix) => {
    if (f.kind === 'transform') setTransform(f.transform);
    else if (f.kind === 'background') patch((e) => ({ ...e, background: f.background }));
    else if (f.kind === 'format') {
      setManualFmt({ ...manualFmt, format: f.format });
      applyPreset(null);
    } else router.push('/editor');
  };

  if (!result) return null;
  const c = edit.canvas;
  const tr = edit.transform;
  const sh = edit.shadow;
  const bg = edit.background;
  const bgColor = bg.kind === 'color' ? bg.color : '#FFFFFF';

  return (
    <Screen scroll header={<Header title="Compose and export" />}>
      <View
        testID="compose-stage"
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          height: 320,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: t.border,
          overflow: 'hidden',
        }}
      >
        {product && layout && box.w > 0 ? (
          <>
            <Canvas style={{ width: box.w, height: box.h }} accessibilityLabel="Picture preview">
              <Checkerboard width={box.w} height={box.h} />
              <Group
                transform={[
                  { translateX: (box.w - layout.size.w * ps) / 2 },
                  { translateY: (box.h - layout.size.h * ps) / 2 },
                  { scale: ps },
                ]}
              >
                <ComposeTree
                  product={product}
                  canvas={layout.size}
                  placement={layout.placement}
                  background={layout.background}
                  shadow={edit.shadow}
                />
                {guides?.guideX ? (
                  <Rect
                    x={layout.size.w / 2 - 1}
                    y={0}
                    width={2}
                    height={layout.size.h}
                    color={t.accent}
                  />
                ) : null}
                {guides?.guideY ? (
                  <Rect
                    x={0}
                    y={layout.size.h / 2 - 1}
                    width={layout.size.w}
                    height={2}
                    color={t.accent}
                  />
                ) : null}
                {showGrid || guides?.rotation
                  ? [1, 2].flatMap((k) => [
                      <Rect
                        key={`v${k}`}
                        x={(layout.size.w * k) / 3}
                        y={0}
                        width={1 / ps}
                        height={layout.size.h}
                        color="rgba(255,255,255,0.7)"
                      />,
                      <Rect
                        key={`h${k}`}
                        x={0}
                        y={(layout.size.h * k) / 3}
                        width={layout.size.w}
                        height={1 / ps}
                        color="rgba(255,255,255,0.7)"
                      />,
                    ])
                  : null}
              </Group>
            </Canvas>
            <View
              testID="compose-touch"
              style={StyleSheet.absoluteFill}
              {...responder.panHandlers}
              accessibilityLabel="Preview. Drag to move, pinch to scale, twist to rotate."
            />
          </>
        ) : (
          <View style={styles.center}>
            <Text style={{ color: t.textMuted }}>
              {busy === 'prepare' ? 'Preparing the picture…' : 'Nothing to show.'}
            </Text>
          </View>
        )}
      </View>
      <Muted style={{ marginTop: spacing.sm }}>
        {layout
          ? `${layout.size.w} × ${layout.size.h} px · ${fmt.format.toUpperCase()}${layout.background.kind === 'transparent' ? ' with transparency' : ''}${layout.placement.k > 1.05 ? ` · photo enlarged ${layout.placement.k.toFixed(2)}×` : ''}`
          : ' '}
      </Muted>
      {notice ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
        accessibilityRole="tablist"
      >
        {TABS.map((x) => (
          <Pressable
            key={x.value}
            testID={`tab-${x.value}`}
            accessibilityRole="tab"
            accessibilityLabel={x.label}
            accessibilityState={{ selected: tab === x.value }}
            onPress={() => {
              setTab(x.value);
              if (x.value === 'check' && !checks) void runChecks();
            }}
            style={{
              minHeight: 48,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: tab === x.value ? t.accent : t.borderStrong,
              backgroundColor: tab === x.value ? t.accent : t.surfaceRaised,
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                color: tab === x.value ? t.onAccent : t.text,
                fontWeight: '600',
                fontSize: fontSizes.body,
              }}
            >
              {x.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ gap: spacing.md }}>
        {tab === 'layout' ? (
          <>
            <Chips
              label="Canvas shape"
              value={c.aspect}
              onChange={(aspect) =>
                patch((e) => {
                  if (aspect === 'original' || aspect === 'custom')
                    return { ...e, presetId: null, canvas: { ...e.canvas, aspect } };
                  const size = sizeForAspect(
                    aspect as keyof typeof ASPECTS,
                    Math.max(e.canvas.width, e.canvas.height),
                  );
                  return {
                    ...e,
                    presetId: null,
                    canvas: { ...e.canvas, aspect, width: size.w, height: size.h },
                  };
                })
              }
              options={[
                { value: 'original', label: 'Original' },
                { value: '1:1', label: '1:1' },
                { value: '4:5', label: '4:5' },
                { value: '3:4', label: '3:4' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {c.aspect === 'custom' ? (
              <>
                <Slider
                  label="Width"
                  value={c.width}
                  min={256}
                  max={6000}
                  step={10}
                  onChange={(v) =>
                    patch((e) => ({ ...e, presetId: null, canvas: { ...e.canvas, width: v } }))
                  }
                  format={(v) => `${Math.round(v)} px`}
                />
                <Slider
                  label="Height"
                  value={c.height}
                  min={256}
                  max={6000}
                  step={10}
                  onChange={(v) =>
                    patch((e) => ({ ...e, presetId: null, canvas: { ...e.canvas, height: v } }))
                  }
                  format={(v) => `${Math.round(v)} px`}
                />
              </>
            ) : c.aspect !== 'original' ? (
              <Slider
                label="Long side"
                value={Math.max(c.width, c.height)}
                min={512}
                max={6000}
                step={50}
                onChange={(v) =>
                  patch((e) => {
                    const s = sizeForAspect(e.canvas.aspect as keyof typeof ASPECTS, v);
                    return {
                      ...e,
                      presetId: null,
                      canvas: { ...e.canvas, width: s.w, height: s.h },
                    };
                  })
                }
                format={(v) => `${Math.round(v)} px`}
              />
            ) : null}
            <Slider
              label="Padding"
              value={c.paddingPercent}
              min={0}
              max={25}
              step={1}
              onChange={(v) => patch((e) => ({ ...e, canvas: { ...e.canvas, paddingPercent: v } }))}
              format={(v) => `${Math.round(v)}%`}
            />
            {!preset ? (
              <>
                <Chips
                  label="File type"
                  value={manualFmt.format}
                  onChange={(format) => {
                    last.current = null;
                    setManualFmt({ ...manualFmt, format });
                  }}
                  options={[
                    { value: 'png', label: 'PNG' },
                    { value: 'jpeg', label: 'JPEG' },
                  ]}
                />
                {manualFmt.format === 'jpeg' ? (
                  <Slider
                    label="JPEG quality"
                    value={manualFmt.quality}
                    min={40}
                    max={100}
                    step={1}
                    onChange={(v) => {
                      last.current = null;
                      setManualFmt({ ...manualFmt, quality: v });
                    }}
                  />
                ) : null}
              </>
            ) : (
              <Muted>The preset “{preset.name}” sets the file type and size limit.</Muted>
            )}
            <Muted>
              Original keeps the photo&apos;s own pixels; other shapes fit the product inside the
              canvas at its target size.
            </Muted>
          </>
        ) : null}

        {tab === 'move' ? (
          <>
            <Slider
              label="Rotation"
              value={tr.rotation}
              min={-180}
              max={180}
              step={0.5}
              onChange={(v) => setTransform({ ...tr, rotation: snapRotation(v, 2).deg })}
              format={(v) => `${v.toFixed(1)}°`}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                label="⟲ 90°"
                onPress={() => setTransform(rotateBy(tr, -90))}
                style={{ flex: 1, paddingHorizontal: spacing.sm }}
                testID="rot-left"
              />
              <Button
                label="⟳ 90°"
                onPress={() => setTransform(rotateBy(tr, 90))}
                style={{ flex: 1, paddingHorizontal: spacing.sm }}
                testID="rot-right"
              />
              <Button
                label="Flip ↔"
                onPress={() => setTransform({ ...tr, flipH: !tr.flipH })}
                style={{ flex: 1, paddingHorizontal: spacing.sm }}
                testID="flip-h"
              />
              <Button
                label="Flip ↕"
                onPress={() => setTransform({ ...tr, flipV: !tr.flipV })}
                style={{ flex: 1, paddingHorizontal: spacing.sm }}
                testID="flip-v"
              />
            </View>
            <Toggle
              label="Straighten grid"
              hint="Shows guide lines to level the product"
              value={showGrid}
              onChange={setShowGrid}
            />
            <Slider
              label="Size"
              value={tr.scale * 100}
              min={5}
              max={300}
              step={1}
              onChange={(v) => setTransform({ ...tr, scale: v / 100 })}
              format={(v) => `${Math.round(v)}%`}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
              {(
                [
                  ['←', -10, 0],
                  ['↑', 0, -10],
                  ['↓', 0, 10],
                  ['→', 10, 0],
                ] as const
              ).map(([label, dx, dy]) => (
                <Button
                  key={label}
                  label={label}
                  onPress={() => layout && setTransform(nudge(tr, dx, dy, layout.size))}
                  style={{ width: 64, paddingHorizontal: 0 }}
                  testID={`nudge-${label}`}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                label="Centre and fit"
                onPress={() =>
                  product &&
                  layout &&
                  setTransform(
                    framingTransform(
                      product.bounds,
                      tr,
                      layout.size,
                      preset?.fill.target ?? 0.85,
                      'centre',
                    ),
                  )
                }
                style={{ flex: 1 }}
              />
              <Button
                label="Reset"
                onPress={() => setTransform(resetTransform(tr))}
                style={{ flex: 1 }}
                testID="reset-transform"
              />
            </View>
            <Muted>
              Drag the preview to move, pinch to scale, twist two fingers to rotate (it snaps at 0°,
              90°, 180°).
            </Muted>
          </>
        ) : null}

        {tab === 'shadow' ? (
          <>
            <Chips
              label="Shadow"
              value={sh.kind}
              onChange={(kind) => patch((e) => ({ ...e, shadow: { ...e.shadow, kind } }))}
              options={[
                { value: 'none', label: 'None' },
                { value: 'contact', label: 'Contact' },
                { value: 'drop', label: 'Drop' },
                { value: 'natural', label: 'Natural' },
              ]}
            />
            {sh.kind !== 'none' ? (
              <>
                <Slider
                  label="Blur"
                  value={sh.blur}
                  min={0}
                  max={0.2}
                  step={0.005}
                  onChange={(v) => patch((e) => ({ ...e, shadow: { ...e.shadow, blur: v } }))}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Slider
                  label="Opacity"
                  value={sh.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => patch((e) => ({ ...e, shadow: { ...e.shadow, opacity: v } }))}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                {sh.kind === 'drop' || sh.kind === 'natural' ? (
                  <>
                    <Slider
                      label="Distance"
                      value={sh.distance}
                      min={0}
                      max={0.2}
                      step={0.005}
                      onChange={(v) =>
                        patch((e) => ({ ...e, shadow: { ...e.shadow, distance: v } }))
                      }
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                    <Slider
                      label="Light angle"
                      value={sh.angle}
                      min={-180}
                      max={180}
                      step={5}
                      onChange={(v) => patch((e) => ({ ...e, shadow: { ...e.shadow, angle: v } }))}
                      format={(v) => `${Math.round(v)}°`}
                    />
                  </>
                ) : null}
                <Swatches
                  label="Shadow colour"
                  colors={SHADOW_SWATCHES}
                  value={sh.color}
                  onChange={(color) => patch((e) => ({ ...e, shadow: { ...e.shadow, color } }))}
                />
              </>
            ) : null}
            <Toggle
              label="Floor reflection"
              hint="A faded, flipped copy under the product"
              value={sh.reflection}
              onChange={(reflection) =>
                patch((e) => ({ ...e, shadow: { ...e.shadow, reflection } }))
              }
            />
            {sh.reflection ? (
              <Slider
                label="Reflection strength"
                value={sh.reflectionOpacity}
                min={0.05}
                max={0.8}
                step={0.05}
                onChange={(v) =>
                  patch((e) => ({ ...e, shadow: { ...e.shadow, reflectionOpacity: v } }))
                }
                format={(v) => `${Math.round(v * 100)}%`}
              />
            ) : null}
          </>
        ) : null}

        {tab === 'look' ? (
          <>
            <Chips
              label="Background"
              value={bg.kind}
              onChange={(kind) =>
                patch((e) => ({
                  ...e,
                  presetId: null,
                  background:
                    kind === 'transparent'
                      ? { kind }
                      : kind === 'color'
                        ? { kind, color: bgColor }
                        : { kind: 'gradient', from: '#FFFFFF', to: '#D1D5DB', angle: 90 },
                }))
              }
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'color', label: 'Colour' },
                { value: 'gradient', label: 'Gradient' },
              ]}
            />
            {bg.kind === 'color' ? (
              <Swatches
                label="Background colour"
                colors={BG_SWATCHES}
                value={bg.color}
                onChange={(color) =>
                  patch((e) => ({ ...e, presetId: null, background: { kind: 'color', color } }))
                }
              />
            ) : null}
            {bg.kind === 'gradient' ? (
              <>
                <Swatches
                  label="Top colour"
                  colors={BG_SWATCHES}
                  value={bg.from}
                  onChange={(from) => patch((e) => ({ ...e, background: { ...bg, from } }))}
                />
                <Swatches
                  label="Bottom colour"
                  colors={BG_SWATCHES}
                  value={bg.to}
                  onChange={(to) => patch((e) => ({ ...e, background: { ...bg, to } }))}
                />
                <Slider
                  label="Direction"
                  value={bg.angle}
                  min={0}
                  max={360}
                  step={5}
                  onChange={(angle) => patch((e) => ({ ...e, background: { ...bg, angle } }))}
                  format={(v) => `${Math.round(v)}°`}
                />
              </>
            ) : null}
            {manualFmt.format === 'jpeg' && !preset && bg.kind === 'transparent' ? (
              <Muted>JPEG cannot be transparent, so it is saved on white.</Muted>
            ) : null}
          </>
        ) : null}

        {tab === 'preset' ? (
          <>
            <Chips
              label="Preset"
              value={edit.presetId ?? 'none'}
              onChange={(id) => applyPreset(presets.find((p) => p.id === id) ?? null)}
              options={[
                { value: 'none', label: 'No preset' },
                ...presets.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                label="Edit preset"
                disabled={!preset}
                onPress={() => preset && setEditing(preset)}
                style={{ flex: 1 }}
                testID="preset-edit"
              />
              <Button
                label="New from these settings"
                onPress={() =>
                  setEditing({
                    id: newPresetId(),
                    name: 'My preset',
                    canvas: {
                      aspect: c.aspect,
                      width: c.width,
                      height: c.height,
                      paddingPercent: c.paddingPercent,
                    },
                    background: bg,
                    fill: { min: 0.7, max: 0.95, target: 0.85 },
                    shadow: sh.kind,
                    format: manualFmt.format,
                    jpegQuality: manualFmt.quality,
                    maxFileKB: null,
                  })
                }
                style={{ flex: 1 }}
              />
            </View>
            <Muted>
              Presets are starting points. Marketplace rules differ and change: check each
              platform&apos;s current guidelines.
            </Muted>
          </>
        ) : null}

        {tab === 'check' ? (
          <>
            <Button
              label={busy === 'check' ? 'Checking…' : 'Run checks again'}
              onPress={() => void runChecks()}
              busy={busy === 'check'}
              testID="run-checks"
            />
            {checks ? (
              <>
                <Banner tone={worst(checks) === 'fail' ? 'error' : 'info'}>
                  {worst(checks) === 'pass'
                    ? 'Everything checks out.'
                    : worst(checks) === 'warn'
                      ? 'Some things to look at (none blocking).'
                      : 'Something needs fixing before you export.'}
                </Banner>
                {checks.map((k) => (
                  <View
                    key={k.id}
                    testID={`check-${k.id}`}
                    style={{
                      borderWidth: 1,
                      borderColor:
                        k.status === 'pass'
                          ? t.border
                          : k.status === 'warn'
                            ? t.borderStrong
                            : t.danger,
                      borderRadius: radii.md,
                      padding: spacing.md,
                      gap: spacing.xs,
                      backgroundColor: t.surface,
                    }}
                  >
                    <Text style={{ color: t.text, fontWeight: '700', fontSize: fontSizes.body }}>
                      {k.status === 'pass' ? '✓ ' : k.status === 'warn' ? '! ' : '✕ '}
                      {k.label}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
                      {k.detail}
                    </Text>
                    {k.fix ? (
                      <Button
                        label={k.fix.label}
                        onPress={() => applyFix(k.fix!.action)}
                        style={{ marginTop: spacing.xs }}
                        testID={`fix-${k.id}`}
                      />
                    ) : null}
                  </View>
                ))}
              </>
            ) : (
              <Muted>
                {busy === 'check'
                  ? 'Looking at the picture…'
                  : 'Checks the background, size, framing, sharpness, exposure and leftovers.'}
              </Muted>
            )}
          </>
        ) : null}
      </View>

      <Text
        accessibilityRole="header"
        style={{
          color: t.text,
          fontWeight: '700',
          fontSize: fontSizes.bodyLg,
          marginTop: spacing.xl,
          marginBottom: spacing.sm,
        }}
      >
        Save or share
      </Text>
      <View style={{ gap: spacing.sm }}>
        <Button
          label="Save to gallery"
          kind="primary"
          busy={busy === 'save'}
          disabled={!product || (!!busy && busy !== 'save')}
          onPress={() => void run('save')}
        />
        <Button
          label="Share"
          busy={busy === 'share'}
          disabled={!product || (!!busy && busy !== 'share')}
          onPress={() => void run('share')}
        />
        <Button
          label="Copy image"
          busy={busy === 'copy'}
          disabled={!product || (!!busy && busy !== 'copy')}
          onPress={() => void run('copy')}
        />
      </View>
      <View style={{ height: spacing.xxl }} />

      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        <Screen scroll header={<Header title="Preset" back={false} />}>
          {editing ? (
            <PresetEditor
              preset={editing}
              onSave={savePresetAndRefresh}
              onDuplicate={(p) => {
                savePresetAndRefresh(duplicatePreset(p, newPresetId()));
              }}
              onDelete={(p) => {
                removePreset(db(), p.id);
                setPresets(loadPresets(db()));
                if (edit.presetId === p.id) applyPreset(null);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
