import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  PanResponder,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { router } from 'expo-router';
import { Canvas } from '@shopify/react-native-skia';
import { Banner, Button, Screen } from '@/components/ui';
import { Slider } from '@/components/Slider';
import {
  DEFAULT_BRUSH,
  DEFAULT_WAND_UI,
  Loupe,
  MiniMap,
  SelectionBar,
  SuggestionsPanel,
  ToolDock,
  ToolOptions,
  isBrushTool,
  onLayoutSize,
  type BrushSettings,
  type Tool,
  type WandSettings,
} from '@/components/editor/EditorControls';
import { EditorScene, type SceneOverlay } from '@/components/editor/EditorScene';
import { EditorDoc } from '@/editor/doc';
import { GestureController, type OneFingerMode, type Pt } from '@/editor/gestures';
import { brushPoint } from '@/editor/loupe';
import { saveDoc } from '@/editor/persist';
import { getOpenDoc, putOpenDoc, dropOpenDoc, sessionKey } from '@/editor/registry';
import type { SelectMode, SelectionShape, BrushStroke } from '@/editor/tileOps';
import { averageProductLuma, checkerFor, VIEW_MODES, type ViewMode } from '@/editor/viewModes';
import type { RefineState } from '@/edit/editState';
import { isZoomedIn, toggleFitActual, zoomLimits } from '@/editor/viewport';
import { appendPoint } from '@/scene/strokes';
import {
  applyPinch,
  clampPan,
  fitTransform,
  screenToImage,
  type ViewTransform,
} from '@/scene/viewTransform';
import { useSession } from '@/store/session';
import { useSettingsStore } from '@/store/instances';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';
import { maskUriOf } from '@/library/library';

const SWATCHES = [
  '#F2E8D5',
  '#FFFFFF',
  '#E5E7EB',
  '#FF8A3D',
  '#2DD4BF',
  '#4F6BED',
  '#E5484D',
  '#30A46C',
];

const oneFingerMode = (tool: Tool, straight: boolean): OneFingerMode => {
  if (tool === 'lasso') return 'stroke';
  if (tool === 'rect' || tool === 'ellipse') return 'shape';
  if (tool === 'erase' || tool === 'restore') return straight ? 'tap' : 'stroke';
  if (tool === 'hand' || tool === 'orient') return 'pan';
  return 'tap'; // wand, polygon, region
};

const rectOf = (a: Pt, b: Pt) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

export default function Editor() {
  const { tokens: t } = useTheme();
  const result = useSession((s) => s.result);
  const itemId = useSession((s) => s.itemId);
  const savedMode = useSettingsStore((s) => s.editorViewMode);
  const setSavedMode = useSettingsStore((s) => s.setEditorViewMode);

  const key = sessionKey(itemId, result?.sourceUri ?? null);
  const [doc, setDoc] = useState<EditorDoc | null>(() => getOpenDoc(key) ?? null);
  const [, setTick] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [viewState, setViewState] = useState<ViewTransform | null>(null);
  const [tool, setTool] = useState<Tool>('wand');
  const [selectMode, setSelectMode] = useState<SelectMode>('replace');
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [wand, setWand] = useState<WandSettings>(DEFAULT_WAND_UI);
  const [feather, setFeather] = useState(6);
  const [mode, setMode] = useState<ViewMode | null>(savedMode);
  const [swatch, setSwatch] = useState(SWATCHES[0]!);
  const [compareFrac, setCompareFrac] = useState(0.5);
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'options' | 'suggestions'>('options');
  const [focusSug, setFocusSug] = useState<string | null>(null);
  const [live, setLive] = useState<BrushStroke | null>(null);
  const [outline, setOutline] = useState<Pt[] | null>(null);
  const [shape, setShape] = useState<SelectionShape | null>(null);
  const [anchor, setAnchor] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sugCount, setSugCount] = useState<number | null>(null);
  const [refineDraft, setRefineDraft] = useState<RefineState | null>(null);
  const [previewRefined, setPreviewRefined] = useState(false);

  // ----- load / create the editing document
  useEffect(() => {
    if (!result) {
      router.replace('/');
      return;
    }
    if (doc) return;
    let alive = true;
    const id = setTimeout(() => {
      try {
        const d = EditorDoc.fromMaskImage(itemId, result.original, result.maskLayer);
        putOpenDoc(key, d);
        if (alive) setDoc(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not open the editor.');
      }
    }, 30);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [result, doc, itemId, key]);

  useEffect(() => {
    if (!doc) return;
    return doc.subscribe(() => setTick((n) => n + 1));
  }, [doc]);

  // suggestions are analysed in the background, shown as a count
  useEffect(() => {
    if (!doc || doc.suggestions) return;
    const id = setTimeout(() => {
      try {
        setSugCount(doc.computeSuggestions().length);
      } catch {
        setSugCount(null);
      }
    }, 600);
    return () => clearTimeout(id);
  });

  // default view mode follows the product's brightness
  const effectiveMode: ViewMode = useMemo(() => {
    if (mode) return mode;
    if (!doc) return 'checker-light';
    try {
      const a = doc.analysis;
      return checkerFor(averageProductLuma(a.rgba, doc.maskAtAnalysis()));
    } catch {
      return 'checker-light';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc?.rev === 0 ? doc : null]);

  const onStageSize = useCallback((w: number, h: number) => setBox({ w, h }), []);
  // until the user zooms or pans, the view is simply "fit"
  const view: ViewTransform | null = doc
    ? (viewState ?? fitTransform(doc.width, doc.height, box.w, box.h))
    : null;

  // ----- gestures: PanResponder -> GestureController -> handlers that always see current state
  const api = useRef<Record<string, (...a: never[]) => unknown>>({});
  const live$ = useRef<BrushStroke | null>(null);
  const outline$ = useRef<Pt[]>([]);
  const poly$ = useRef<Pt[]>([]);
  const touchTime = () => Date.now();
  const touchesOf = (e: GestureResponderEvent): Pt[] =>
    e.nativeEvent.touches.map((x) => ({ x: x.locationX, y: x.locationY }));

  const modeRef = useRef<OneFingerMode>('tap');
  const [controller] = useState(
    // the handlers only read refs when a gesture fires, never during render
    // eslint-disable-next-line react-hooks/refs
    () =>
      new GestureController(
        {
          onStrokeBegin: (p) => (api.current.strokeBegin as (p: Pt) => void)(p),
          onStrokeMove: (p) => (api.current.strokeMove as (p: Pt) => void)(p),
          onStrokeEnd: () => (api.current.strokeEnd as () => void)(),
          onStrokeCancel: () => (api.current.strokeCancel as () => void)(),
          onShapeBegin: () => {},
          onShapeMove: (a, b) => (api.current.shapeMove as (a: Pt, b: Pt) => void)(a, b),
          onShapeEnd: (a, b) => (api.current.shapeEnd as (a: Pt, b: Pt) => void)(a, b),
          onShapeCancel: () => setShape(null),
          onTap: (p) => (api.current.tap as (p: Pt) => void)(p),
          onDoubleTap: (p) => (api.current.doubleTap as (p: Pt) => void)(p),
          onPan: (dx, dy) => (api.current.pan as (dx: number, dy: number) => void)(dx, dy),
          onPinch: (a, b) =>
            (api.current.pinch as (a: never, b: never) => void)(a as never, b as never),
        },
        () => modeRef.current,
      ),
  );
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => controller.touchStart(touchesOf(e), touchTime()),
      onPanResponderMove: (e) => controller.touchMove(touchesOf(e), touchTime()),
      onPanResponderRelease: () => controller.touchEnd(touchTime()),
      onPanResponderTerminate: () => controller.cancel(),
    }),
  );

  const guard = useCallback((fn: () => void, busyLabel?: string) => {
    setError(null);
    if (busyLabel) setBusy(busyLabel);
    // let the "busy" label paint before heavy synchronous work starts
    setTimeout(() => {
      try {
        fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setBusy(null);
      }
    }, 20);
  }, []);

  useEffect(() => {
    modeRef.current = oneFingerMode(tool, brush.straight);
  }, [tool, brush.straight]);

  const selectTool = (next: Tool) => {
    poly$.current = [];
    outline$.current = [];
    setOutline(null);
    setAnchor(null);
    setShape(null);
    setTool(next);
  };

  useEffect(() => {
    if (!doc || !view) return;
    const photo = (p: Pt) => screenToImage(view, p);
    const brushSize = () => brush.size / view.scale;
    const mkStroke = (first: Pt): BrushStroke => ({
      mode: tool === 'restore' ? 'restore' : 'erase',
      size: brushSize(),
      softness: brush.softness,
      opacity: brush.opacity,
      points: [first],
    });
    const finishPolygon = () => {
      const pts = poly$.current;
      if (pts.length >= 3) guard(() => doc.selectShape({ kind: 'path', points: pts }, selectMode));
      poly$.current = [];
      setOutline(null);
    };
    api.current = {
      strokeBegin: ((p: Pt) => {
        setCursor(brushPoint(p, brush.size, tool !== 'lasso' && brush.loupe));
        if (tool === 'lasso') {
          outline$.current = [photo(p)];
          setOutline([...outline$.current]);
          return;
        }
        const s = mkStroke(photo(brushPoint(p, brush.size, brush.loupe)));
        live$.current = s;
        setLive(s);
      }) as never,
      strokeMove: ((p: Pt) => {
        if (tool === 'lasso') {
          outline$.current = appendPoint(outline$.current, photo(p), 2 / view.scale);
          setOutline([...outline$.current]);
          setCursor(p);
          return;
        }
        const s = live$.current;
        if (!s) return;
        const bp = brushPoint(p, brush.size, brush.loupe);
        const points = appendPoint(s.points, photo(bp), 1.5 / view.scale);
        if (points !== s.points) {
          live$.current = { ...s, points };
          setLive(live$.current);
        }
        setCursor(bp);
      }) as never,
      strokeEnd: (() => {
        setCursor(null);
        if (tool === 'lasso') {
          const pts = outline$.current;
          outline$.current = [];
          setOutline(null);
          if (pts.length >= 3)
            guard(() => doc.selectShape({ kind: 'path', points: pts }, selectMode));
          return;
        }
        const s = live$.current;
        live$.current = null;
        if (!s) return;
        guard(
          () => {
            doc.commitStroke(
              s,
              brush.smart
                ? { tolerance: brush.tolerance, edgeSensitivity: brush.edgeSensitivity }
                : undefined,
            );
            setLive(null);
          },
          brush.smart ? 'Applying smart brush…' : undefined,
        );
        if (!brush.smart) setLive(null);
      }) as never,
      strokeCancel: (() => {
        live$.current = null;
        outline$.current = [];
        setLive(null);
        setOutline(null);
        setCursor(null);
      }) as never,
      shapeMove: ((a: Pt, b: Pt) => {
        const r = rectOf(photo(a), photo(b));
        setShape({ kind: tool === 'ellipse' ? 'ellipse' : 'rect', ...r });
      }) as never,
      shapeEnd: ((a: Pt, b: Pt) => {
        const r = rectOf(photo(a), photo(b));
        setShape(null);
        if (r.w > 1 && r.h > 1)
          guard(() =>
            doc.selectShape({ kind: tool === 'ellipse' ? 'ellipse' : 'rect', ...r }, selectMode),
          );
      }) as never,
      tap: ((p: Pt) => {
        const at = photo(p);
        if (tool === 'wand') {
          guard(
            () =>
              doc.selectWand(
                at,
                {
                  tolerance: wand.tolerance,
                  contiguous: wand.contiguous,
                  edgeAware: wand.edgeAware,
                  edgeSensitivity: wand.edgeSensitivity,
                },
                selectMode,
                wand.cutoutOnly,
              ),
            'Selecting…',
          );
        } else if (tool === 'region') {
          guard(() => {
            if (!doc.selectRegion(at, selectMode)) setError('Nothing to select there.');
          }, 'Selecting…');
        } else if (tool === 'poly') {
          const first = poly$.current[0];
          if (
            first &&
            poly$.current.length >= 3 &&
            Math.hypot((first.x - at.x) * view.scale, (first.y - at.y) * view.scale) < 20
          ) {
            finishPolygon();
          } else {
            poly$.current = [...poly$.current, at];
            setOutline([...poly$.current]);
          }
        } else if (isBrushTool(tool) && brush.straight) {
          if (!anchor) setAnchor(at);
          else {
            const s = { ...mkStroke(anchor), points: [anchor, at] };
            setAnchor(null);
            guard(() =>
              doc.commitStroke(
                s,
                brush.smart
                  ? { tolerance: brush.tolerance, edgeSensitivity: brush.edgeSensitivity }
                  : undefined,
              ),
            );
          }
        }
      }) as never,
      doubleTap: ((p: Pt) => {
        setViewState(
          toggleFitActual(view, doc.width, doc.height, box.w, box.h, p, PixelRatio.get()),
        );
      }) as never,
      pan: ((dx: number, dy: number) => {
        setViewState((prev) => {
          const v = prev ?? fitTransform(doc.width, doc.height, box.w, box.h);
          return clampPan({ ...v, x: v.x + dx, y: v.y + dy }, doc.width, doc.height, box.w, box.h);
        });
      }) as never,
      pinch: ((a: Parameters<typeof applyPinch>[1], b: Parameters<typeof applyPinch>[2]) => {
        const fit = fitTransform(doc.width, doc.height, box.w, box.h);
        const lim = zoomLimits(fit.scale);
        setViewState((prev) => {
          const v = prev ?? fit;
          return clampPan(
            applyPinch(v, a, b, lim.min, lim.max),
            doc.width,
            doc.height,
            box.w,
            box.h,
          );
        });
      }) as never,
      finishPolygon: finishPolygon as never,
    };
  });

  // ----- actions
  const askRotate = (turns: number, fh: boolean, fv: boolean) => {
    if (!doc) return;
    const go = () =>
      guard(() => {
        doc.transformPhoto(turns, fh, fv);
        setViewState(null);
        setSugCount(null);
      }, 'Turning the photo…');
    if (doc.history.canUndo) {
      Alert.alert('Turn the photo?', 'This clears the undo history.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn', onPress: go },
      ]);
    } else go();
  };

  const done = async () => {
    if (!doc || saving) return;
    setSaving(true);
    setError(null);
    try {
      let maskUri = result?.maskUri ?? '';
      if (doc.dirty || doc.photoChanged || doc.editDirty) {
        if (itemId) {
          const row = await saveDoc(doc, itemId);
          maskUri = (row && maskUriOf(row)) || maskUri;
        }
        useSession.setState((s) =>
          s.result
            ? {
                result: {
                  ...s.result,
                  original: doc.original,
                  maskLayer: doc.maskImage(),
                  maskUri,
                  width: doc.width,
                  height: doc.height,
                  foundObject: true,
                },
              }
            : s,
        );
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your edits.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!doc || (!doc.dirty && !doc.photoChanged && !doc.editDirty)) {
      if (doc) dropOpenDoc(key);
      return router.back();
    }
    Alert.alert('Discard edits?', 'Your changes to the cut-out will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          dropOpenDoc(key);
          router.back();
        },
      },
    ]);
  };

  if (!result) return null;
  if (!doc || !view) {
    return (
      <Screen padded={false}>
        <View style={styles.center}>
          <Text style={{ color: t.textMuted }}>{error ?? 'Preparing the editor…'}</Text>
        </View>
      </Screen>
    );
  }

  const suggestions = panel === 'suggestions' ? doc.computeSuggestions() : [];
  const overlay: SceneOverlay = {
    liveStroke: live,
    outline,
    shape,
    anchor: isBrushTool(tool) && brush.straight ? anchor : null,
    suggestion: focusSug ? (doc.suggestions?.find((s) => s.id === focusSug) ?? null) : null,
  };
  const shownMode: ViewMode = holdOriginal ? 'before-after' : effectiveMode;
  const compareX = holdOriginal ? box.w : compareFrac * box.w;
  const zoomedIn = isZoomedIn(view, doc.width, doc.height, box.w, box.h);
  const showCursor = cursor && isBrushTool(tool);

  const setViewMode = (m: ViewMode) => {
    setMode(m);
    void setSavedMode(m);
    setMenu(false);
  };

  return (
    <Screen
      padded={false}
      header={
        <View style={[styles.top, { borderBottomColor: t.border }]}>
          <Button label="Cancel" kind="ghost" onPress={cancel} style={styles.topBtn} />
          <Button
            label="Undo"
            kind="ghost"
            onPress={() => doc.undo()}
            disabled={!doc.history.canUndo}
            style={styles.topBtn}
            testID="undo"
          />
          <Button
            label="Redo"
            kind="ghost"
            onPress={() => doc.redo()}
            disabled={!doc.history.canRedo}
            style={styles.topBtn}
            testID="redo"
          />
          <Button
            label="View"
            kind="ghost"
            onPress={() => setMenu(true)}
            style={styles.topBtn}
            testID="view-menu"
          />
          <Pressable
            testID="compare-hold"
            accessibilityRole="button"
            accessibilityLabel="Press and hold to see the original photo"
            onPressIn={() => setHoldOriginal(true)}
            onPressOut={() => setHoldOriginal(false)}
            style={[styles.topBtn, styles.holdBtn, { borderColor: t.borderStrong }]}
          >
            <Text style={{ color: t.text, fontSize: fontSizes.body }}>Before</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Button
            label="Done"
            kind="primary"
            onPress={() => void done()}
            busy={saving}
            style={styles.topBtn}
            testID="done"
          />
        </View>
      }
    >
      <View testID="editor-stage" style={styles.stage} onLayout={onLayoutSize(onStageSize)}>
        <Canvas style={StyleSheet.absoluteFill} accessibilityLabel="Cut-out editor">
          <EditorScene
            doc={doc}
            rev={doc.rev}
            view={view}
            box={box}
            mode={shownMode}
            color={swatch}
            compareX={compareX}
            overlay={overlay}
            previewRefined={previewRefined}
            accent={t.accent}
            danger={t.danger}
          />
        </Canvas>
        <View
          testID="editor-touch"
          style={StyleSheet.absoluteFill}
          {...responder.panHandlers}
          accessibilityLabel="Editing area. One finger edits with the current tool, two fingers pan and zoom."
        />
        {showCursor ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: cursor.x - brush.size / 2,
              top: cursor.y - brush.size / 2,
              width: brush.size,
              height: brush.size,
              borderRadius: brush.size / 2,
              borderWidth: 2,
              borderColor: tool === 'erase' ? t.danger : t.accent,
            }}
          />
        ) : null}
        {(live || outline) && cursor && brush.loupe && isBrushTool(tool) ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: spacing.md, top: spacing.md }}
          >
            <Loupe
              doc={doc}
              rev={doc.rev}
              view={view}
              at={cursor}
              mode={effectiveMode}
              color={swatch}
              overlay={{ liveStroke: live }}
              accent={t.accent}
              danger={t.danger}
            />
          </View>
        ) : null}
        {zoomedIn ? (
          <View style={{ position: 'absolute', right: spacing.md, top: spacing.md }}>
            <MiniMap doc={doc} view={view} box={box} onView={setViewState} />
          </View>
        ) : null}
        <View pointerEvents="none" style={[styles.zoomTag, { backgroundColor: t.overlay }]}>
          <Text style={{ color: '#fff', fontSize: fontSizes.caption }}>
            {Math.round(view.scale * PixelRatio.get() * 100)}%
          </Text>
        </View>
        {busy ? (
          <View pointerEvents="none" style={[styles.busy, { backgroundColor: t.overlay }]}>
            <Text style={{ color: '#fff' }}>{busy}</Text>
          </View>
        ) : null}
      </View>

      {shownMode === 'before-after' && !holdOriginal ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Slider
            label="Before | After"
            value={compareFrac}
            min={0}
            max={1}
            step={0.01}
            onChange={setCompareFrac}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </View>
      ) : null}
      {error ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Banner tone="error">{error}</Banner>
        </View>
      ) : null}
      {doc.hasSelection ? (
        <SelectionBar
          onRemove={() => guard(() => doc.applySelection('remove'), 'Removing…')}
          onKeep={() => guard(() => doc.applySelection('keep'), 'Restoring…')}
          onInvert={() => guard(() => doc.selectInvert())}
          onClear={() => doc.selectClear()}
        />
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
          paddingTop: spacing.xs,
        }}
      >
        <Button
          label={
            panel === 'suggestions'
              ? 'Tool options'
              : sugCount === null
                ? 'Suggestions'
                : `Suggestions (${sugCount})`
          }
          kind={panel === 'suggestions' ? 'primary' : 'secondary'}
          onPress={() => {
            setFocusSug(null);
            setPanel((p) => (p === 'suggestions' ? 'options' : 'suggestions'));
          }}
          style={{ flex: 1 }}
          testID="suggestions-chip"
        />
      </View>
      {panel === 'suggestions' ? (
        <SuggestionsPanel
          items={suggestions}
          active={focusSug}
          onFocus={setFocusSug}
          onApply={(id) => {
            setFocusSug(null);
            guard(() => {
              doc.acceptSuggestion(id);
              setSugCount(null);
            }, 'Applying…');
          }}
          onDismiss={(id) => {
            setFocusSug(null);
            doc.dismissSuggestion(id);
            setSugCount(doc.computeSuggestions().length);
          }}
        />
      ) : (
        <ToolOptions
          tool={tool}
          selectMode={selectMode}
          onSelectMode={setSelectMode}
          wand={wand}
          onWand={setWand}
          brush={brush}
          onBrush={setBrush}
          photoPerScreen={1 / view.scale}
          photoWidth={doc.width}
          feather={feather}
          onFeather={setFeather}
          onAdjust={(kind) => guard(() => doc.selectAdjust({ kind, radius: feather }))}
          onRotate={askRotate}
          polygonPoints={outline && tool === 'poly' ? outline.length : 0}
          onClosePolygon={() => (api.current.finishPolygon as () => void)()}
          hasSelection={doc.hasSelection}
          refine={refineDraft ?? doc.refine}
          onRefineDraft={setRefineDraft}
          refineDirty={
            refineDraft !== null && JSON.stringify(refineDraft) !== JSON.stringify(doc.refine)
          }
          onRefineApply={() => {
            if (refineDraft) guard(() => doc.setRefine(refineDraft), 'Applying edge settings…');
          }}
          previewRefined={previewRefined}
          onPreviewRefined={(on) =>
            guard(() => setPreviewRefined(on), on ? 'Refining preview…' : undefined)
          }
        />
      )}
      <ToolDock tool={tool} onTool={selectTool} />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable
          style={[styles.modalBg, { backgroundColor: t.overlay }]}
          onPress={() => setMenu(false)}
        >
          <View style={[styles.menu, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: fontSizes.bodyLg }}>
              View
            </Text>
            {VIEW_MODES.map((m) => {
              const on = (mode ?? effectiveMode) === m.id;
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={m.label}
                  onPress={() => setViewMode(m.id)}
                  style={[styles.menuItem, { borderColor: on ? t.accent : t.border }]}
                >
                  <Text style={{ color: t.text, fontWeight: on ? '700' : '500' }}>{m.label}</Text>
                </Pressable>
              );
            })}
            {(mode ?? effectiveMode) === 'color' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {SWATCHES.map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={`Background colour ${c}`}
                    onPress={() => setSwatch(c)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: c,
                      borderWidth: c === swatch ? 3 : 1,
                      borderColor: c === swatch ? t.accent : t.borderStrong,
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBtn: { minHeight: 48, paddingHorizontal: spacing.sm },
  holdBtn: {
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { flex: 1, overflow: 'hidden' },
  zoomTag: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  busy: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  modalBg: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  menu: { borderRadius: radii.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  menuItem: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
});
