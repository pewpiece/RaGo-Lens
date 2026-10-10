import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Canvas, Group, Image as SkiaImage, Rect } from '@shopify/react-native-skia';
import { Button, Segmented, Toggle } from '@/components/ui';
import { Slider } from '@/components/Slider';
import type { EditorDoc } from '@/editor/doc';
import type { Suggestion } from '@/editor/suggest';
import type { SelectMode } from '@/editor/tileOps';
import { miniMapRect, viewFromMiniMap } from '@/editor/viewport';
import type { ViewTransform } from '@/scene/viewTransform';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';
import { EditorScene, type SceneOverlay } from './EditorScene';
import { loupeView } from '@/editor/loupe';
import type { ViewMode } from '@/editor/viewModes';
import type { RefineState } from '@/edit/editState';

export type Tool =
  | 'wand'
  | 'lasso'
  | 'poly'
  | 'rect'
  | 'ellipse'
  | 'region'
  | 'erase'
  | 'restore'
  | 'hand'
  | 'edge'
  | 'orient';

export const TOOLS: { id: Tool; label: string; group: 'select' | 'brush' | 'view' }[] = [
  { id: 'wand', label: 'Tap select', group: 'select' },
  { id: 'lasso', label: 'Lasso', group: 'select' },
  { id: 'poly', label: 'Polygon', group: 'select' },
  { id: 'rect', label: 'Rectangle', group: 'select' },
  { id: 'ellipse', label: 'Ellipse', group: 'select' },
  { id: 'region', label: 'Region', group: 'select' },
  { id: 'erase', label: 'Erase', group: 'brush' },
  { id: 'restore', label: 'Restore', group: 'brush' },
  { id: 'hand', label: 'Hand', group: 'view' },
  { id: 'edge', label: 'Edge', group: 'view' },
  { id: 'orient', label: 'Rotate', group: 'view' },
];

export const isSelectTool = (t: Tool) => TOOLS.find((x) => x.id === t)?.group === 'select';
export const isBrushTool = (t: Tool) => t === 'erase' || t === 'restore';

export interface BrushSettings {
  /** Screen px (shown to the user also as photo px). */
  size: number;
  softness: number;
  opacity: number;
  smart: boolean;
  tolerance: number;
  edgeSensitivity: number;
  straight: boolean;
  loupe: boolean;
}
export const DEFAULT_BRUSH: BrushSettings = {
  size: 40,
  softness: 0.3,
  opacity: 1,
  smart: false,
  tolerance: 20,
  edgeSensitivity: 0.5,
  straight: false,
  loupe: true,
};

export interface WandSettings {
  tolerance: number;
  contiguous: boolean;
  edgeAware: boolean;
  edgeSensitivity: number;
  cutoutOnly: boolean;
}
export const DEFAULT_WAND_UI: WandSettings = {
  tolerance: 18,
  contiguous: true,
  edgeAware: true,
  edgeSensitivity: 0.5,
  cutoutOnly: false,
};

export function ToolDock({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  const { tokens: t } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
      accessibilityRole="toolbar"
    >
      {TOOLS.map((x) => {
        const on = x.id === tool;
        return (
          <Pressable
            key={x.id}
            testID={`tool-${x.id}`}
            accessibilityRole="button"
            accessibilityLabel={x.label}
            accessibilityState={{ selected: on }}
            onPress={() => onTool(x.id)}
            style={{
              minWidth: 72,
              minHeight: 48,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: on ? t.accent : t.borderStrong,
              backgroundColor: on ? t.accent : t.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                color: on ? t.onAccent : t.text,
                fontWeight: on ? '700' : '500',
                fontSize: fontSizes.body,
              }}
            >
              {x.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const MODES: { value: SelectMode; label: string }[] = [
  { value: 'replace', label: 'New' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

export interface OptionsProps {
  tool: Tool;
  selectMode: SelectMode;
  onSelectMode: (m: SelectMode) => void;
  wand: WandSettings;
  onWand: (w: WandSettings) => void;
  brush: BrushSettings;
  onBrush: (b: BrushSettings) => void;
  /** Photo pixels per screen pixel (to show the brush size relative to the photo). */
  photoPerScreen: number;
  photoWidth: number;
  feather: number;
  onFeather: (v: number) => void;
  onAdjust: (kind: 'feather' | 'grow' | 'shrink') => void;
  onRotate: (turns: number, flipH: boolean, flipV: boolean) => void;
  polygonPoints: number;
  onClosePolygon: () => void;
  hasSelection: boolean;
  refine: RefineState;
  onRefineDraft: (r: RefineState) => void;
  onRefineApply: () => void;
  refineDirty: boolean;
  previewRefined: boolean;
  onPreviewRefined: (on: boolean) => void;
}

export function ToolOptions(p: OptionsProps) {
  const { tokens: t } = useTheme();
  const set = <K extends keyof BrushSettings>(k: K, v: BrushSettings[K]) =>
    p.onBrush({ ...p.brush, [k]: v });
  const setW = <K extends keyof WandSettings>(k: K, v: WandSettings[K]) =>
    p.onWand({ ...p.wand, [k]: v });
  const imgPx = Math.round(p.brush.size * p.photoPerScreen);
  return (
    <ScrollView
      style={{ maxHeight: 230 }}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
    >
      {isSelectTool(p.tool) ? (
        <>
          <Segmented<SelectMode>
            label="Selection mode"
            value={p.selectMode}
            onChange={p.onSelectMode}
            options={MODES}
          />
          {p.tool === 'wand' ? (
            <>
              <Slider
                label="Tolerance"
                value={p.wand.tolerance}
                min={2}
                max={60}
                step={1}
                onChange={(v) => setW('tolerance', v)}
              />
              <Toggle
                label="Contiguous"
                hint="Only the connected area you tap"
                value={p.wand.contiguous}
                onChange={(v) => setW('contiguous', v)}
              />
              <Toggle
                label="Stop at edges"
                hint="Do not leak across a strong edge"
                value={p.wand.edgeAware}
                onChange={(v) => setW('edgeAware', v)}
              />
              {p.wand.edgeAware ? (
                <Slider
                  label="Edge sensitivity"
                  value={p.wand.edgeSensitivity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setW('edgeSensitivity', v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              ) : null}
              <Toggle
                label="Current cut-out only"
                hint="Off: sample the whole photo"
                value={p.wand.cutoutOnly}
                onChange={(v) => setW('cutoutOnly', v)}
              />
            </>
          ) : null}
          {p.tool === 'poly' ? (
            <Button
              label={`Close shape (${p.polygonPoints} points)`}
              onPress={p.onClosePolygon}
              disabled={p.polygonPoints < 3}
            />
          ) : null}
          {p.hasSelection ? (
            <>
              <Slider
                label="Amount"
                value={p.feather}
                min={1}
                max={20}
                step={1}
                onChange={p.onFeather}
                format={(v) => `${Math.round(v)} px`}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Feather"
                  onPress={() => p.onAdjust('feather')}
                  style={{ flex: 1, paddingHorizontal: spacing.sm }}
                />
                <Button
                  label="Grow"
                  onPress={() => p.onAdjust('grow')}
                  style={{ flex: 1, paddingHorizontal: spacing.sm }}
                />
                <Button
                  label="Shrink"
                  onPress={() => p.onAdjust('shrink')}
                  style={{ flex: 1, paddingHorizontal: spacing.sm }}
                />
              </View>
            </>
          ) : (
            <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
              {p.tool === 'region'
                ? 'Tap a piece of the cut-out, or an opening inside it, to select all of it.'
                : p.tool === 'wand'
                  ? 'Tap a part of the photo (a logo, a tag) to select the area with that colour.'
                  : 'Select what you want to change, then choose Remove or Keep.'}
            </Text>
          )}
        </>
      ) : null}
      {isBrushTool(p.tool) ? (
        <>
          <Slider
            label={`Brush size (${imgPx} px of the photo, ${((imgPx / Math.max(1, p.photoWidth)) * 100).toFixed(1)}% of its width)`}
            value={p.brush.size}
            min={8}
            max={160}
            step={1}
            onChange={(v) => set('size', v)}
            format={(v) => `${Math.round(v)} dp`}
          />
          <Slider
            label="Softness"
            value={p.brush.softness}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set('softness', v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Opacity"
            value={p.brush.opacity}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(v) => set('opacity', v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Toggle
            label="Smart brush"
            hint="Only paints pixels like the colour under the brush; stops at edges"
            value={p.brush.smart}
            onChange={(v) => set('smart', v)}
          />
          {p.brush.smart ? (
            <>
              <Slider
                label="Colour tolerance"
                value={p.brush.tolerance}
                min={4}
                max={60}
                step={1}
                onChange={(v) => set('tolerance', v)}
              />
              <Slider
                label="Edge sensitivity"
                value={p.brush.edgeSensitivity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => set('edgeSensitivity', v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </>
          ) : null}
          <Toggle
            label="Straight line"
            hint="Tap the start, then tap the end"
            value={p.brush.straight}
            onChange={(v) => set('straight', v)}
          />
          <Toggle
            label="Loupe"
            hint="Brush above your finger with a magnified preview"
            value={p.brush.loupe}
            onChange={(v) => set('loupe', v)}
          />
        </>
      ) : null}
      {p.tool === 'hand' ? (
        <Text style={{ color: t.textMuted, fontSize: fontSizes.body }}>
          One finger moves the photo. Pinch to zoom, double-tap to switch between fit and 100%.
        </Text>
      ) : null}
      {p.tool === 'edge' ? (
        <>
          <Slider
            label="Edge softness"
            value={p.refine.softness}
            min={0}
            max={20}
            step={1}
            onChange={(v) => p.onRefineDraft({ ...p.refine, softness: v })}
            format={(v) => `${Math.round(v)} px`}
          />
          <Slider
            label="Shift edge (− shrink, + grow)"
            value={p.refine.shift}
            min={-20}
            max={20}
            step={1}
            onChange={(v) => p.onRefineDraft({ ...p.refine, shift: v })}
            format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} px`}
          />
          <Slider
            label="Smooth contour"
            value={p.refine.smooth}
            min={0}
            max={20}
            step={1}
            onChange={(v) => p.onRefineDraft({ ...p.refine, smooth: v })}
            format={(v) => `${Math.round(v)} px`}
          />
          <Toggle
            label="Fine detail"
            hint="Hair, fur, fabric: keeps thin parts, no smoothing"
            value={p.refine.fineDetail}
            onChange={(v) => p.onRefineDraft({ ...p.refine, fineDetail: v })}
          />
          <Toggle
            label="Clean edge colours"
            hint="Removes the halo of the old background from edge pixels"
            value={p.refine.decontaminate}
            onChange={(v) => p.onRefineDraft({ ...p.refine, decontaminate: v })}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label={p.refineDirty ? 'Apply' : 'Applied'}
              kind="primary"
              disabled={!p.refineDirty}
              onPress={p.onRefineApply}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
              testID="refine-apply"
            />
            <Button
              label={p.previewRefined ? 'Preview: on' : 'Preview: off'}
              onPress={() => p.onPreviewRefined(!p.previewRefined)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
              testID="refine-preview"
            />
          </View>
          <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
            Settings are applied to the exported file. The preview shows them now; editing the
            cut-out afterwards refreshes it.
          </Text>
        </>
      ) : null}
      {p.tool === 'orient' ? (
        <>
          <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
            Turns the photo and its cut-out together. This clears the undo history.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label="Left 90°"
              onPress={() => p.onRotate(-1, false, false)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
            <Button
              label="Right 90°"
              onPress={() => p.onRotate(1, false, false)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label="Flip ↔"
              onPress={() => p.onRotate(0, true, false)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
            <Button
              label="Flip ↕"
              onPress={() => p.onRotate(0, false, true)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export function SelectionBar({
  onRemove,
  onKeep,
  onInvert,
  onClear,
}: {
  onRemove: () => void;
  onKeep: () => void;
  onInvert: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.actionBar}>
      <Button
        label="Remove"
        kind="primary"
        onPress={onRemove}
        style={{ flex: 1.2, paddingHorizontal: spacing.sm }}
        testID="sel-remove"
      />
      <Button
        label="Keep"
        onPress={onKeep}
        style={{ flex: 1, paddingHorizontal: spacing.sm }}
        testID="sel-keep"
      />
      <Button
        label="Invert"
        onPress={onInvert}
        style={{ flex: 1, paddingHorizontal: spacing.sm }}
      />
      <Button
        label="Cancel"
        kind="ghost"
        onPress={onClear}
        style={{ flex: 1, paddingHorizontal: spacing.sm }}
      />
    </View>
  );
}

export function SuggestionsPanel({
  items,
  active,
  onFocus,
  onApply,
  onDismiss,
}: {
  items: Suggestion[];
  active: string | null;
  onFocus: (id: string | null) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { tokens: t } = useTheme();
  if (items.length === 0)
    return (
      <Text style={{ color: t.textMuted, paddingHorizontal: spacing.lg }}>
        Nothing to clean up: no openings, specks or attached pieces were found.
      </Text>
    );
  return (
    <ScrollView
      style={{ maxHeight: 230 }}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
    >
      <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
        These are guesses. Tap one to see it highlighted, then apply or dismiss it. Nothing changes
        until you apply it.
      </Text>
      {items.map((s) => (
        <Pressable
          key={s.id}
          accessibilityRole="button"
          accessibilityLabel={`${s.label}. Tap to highlight`}
          onPress={() => onFocus(active === s.id ? null : s.id)}
          style={{
            borderWidth: 1,
            borderColor: active === s.id ? t.accent : t.border,
            borderRadius: radii.md,
            padding: spacing.md,
            backgroundColor: t.surface,
            gap: spacing.sm,
          }}
        >
          <Text style={{ color: t.text, fontSize: fontSizes.body, fontWeight: '600' }}>
            {s.label}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>
            {s.action === 'remove'
              ? 'Would remove it from the cut-out'
              : 'Would add it to the cut-out'}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label={s.action === 'remove' ? 'Remove' : 'Fill'}
              kind="primary"
              onPress={() => onApply(s.id)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
            <Button
              label="Dismiss"
              onPress={() => onDismiss(s.id)}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
            />
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const MAP_W = 96;

/** Small overview of the whole photo with the visible window outlined; tap it to jump there. */
export function MiniMap({
  doc,
  view,
  box,
  onView,
}: {
  doc: EditorDoc;
  view: ViewTransform;
  box: { w: number; h: number };
  onView: (v: ViewTransform) => void;
}) {
  const { tokens: t } = useTheme();
  const mapH = Math.round((MAP_W * doc.height) / doc.width);
  const r = miniMapRect(view, box.w, box.h, doc.width, doc.height, MAP_W, mapH);
  const thumb = doc.pyramid.level(doc.pyramid.levels - 1);
  const onPress = (e: { nativeEvent: { locationX: number; locationY: number } }) =>
    onView(
      viewFromMiniMap(
        e.nativeEvent.locationX,
        e.nativeEvent.locationY,
        view,
        box.w,
        box.h,
        doc.width,
        doc.height,
        MAP_W,
        mapH,
      ),
    );
  return (
    <Pressable
      testID="minimap"
      accessibilityRole="button"
      accessibilityLabel="Overview map. Tap to move the view"
      onPress={onPress}
      style={{
        width: MAP_W,
        height: mapH,
        borderWidth: 1,
        borderColor: t.borderStrong,
        backgroundColor: '#000',
      }}
    >
      <Canvas style={{ width: MAP_W, height: mapH }}>
        <Group transform={[{ scale: MAP_W / doc.width }]}>
          <SkiaImage image={thumb} x={0} y={0} width={doc.width} height={doc.height} />
        </Group>
        <Rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          style="stroke"
          strokeWidth={2}
          color={t.accent}
        />
      </Canvas>
    </Pressable>
  );
}

const LOUPE = 120;
const LOUPE_ZOOM = 3;

/** Magnifier shown while drawing with the brush above the finger. */
export function Loupe({
  doc,
  rev,
  view,
  at,
  mode,
  color,
  overlay,
  accent,
  danger,
}: {
  doc: EditorDoc;
  rev: number;
  view: ViewTransform;
  at: { x: number; y: number };
  mode: ViewMode;
  color: string;
  overlay: SceneOverlay;
  accent: string;
  danger: string;
}) {
  const { tokens: t } = useTheme();
  const lv = loupeView(view, at, LOUPE, LOUPE_ZOOM);
  return (
    <View
      pointerEvents="none"
      style={{
        width: LOUPE,
        height: LOUPE,
        borderRadius: LOUPE / 2,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: t.accent,
      }}
    >
      <Canvas style={{ width: LOUPE, height: LOUPE }}>
        <EditorScene
          doc={doc}
          rev={rev}
          view={lv}
          box={{ w: LOUPE, h: LOUPE }}
          mode={mode === 'before-after' ? 'checker-light' : mode}
          color={color}
          compareX={0}
          overlay={overlay}
          accent={accent}
          danger={danger}
        />
      </Canvas>
    </View>
  );
}

export const onLayoutSize = (set: (w: number, h: number) => void) => (e: LayoutChangeEvent) =>
  set(e.nativeEvent.layout.width, e.nativeEvent.layout.height);

const styles = StyleSheet.create({
  actionBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
