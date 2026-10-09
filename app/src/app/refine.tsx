import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Header, Screen, Segmented } from '@/components/ui';
import { SceneCanvas } from '@/components/SceneCanvas';
import { Slider } from '@/components/Slider';
import { edgeRamp } from '@/engine/edge';
import { encodePng, tightenMask } from '@/engine/skiaOps';
import { updateLibraryItem } from '@/library/saveResult';
import { writeCacheFile, tempName } from '@/lib/files';
import { bakeMask } from '@/scene/exportRender';
import {
  appendPoint,
  canRedo,
  canUndo,
  emptyHistory,
  isUsableStroke,
  pushStroke,
  redo,
  undo,
  type BrushMode,
  type Stroke,
} from '@/scene/strokes';
import {
  applyPinch,
  clampPan,
  fitTransform,
  screenToImage,
  twoFinger,
  type TwoFinger,
  type ViewTransform,
} from '@/scene/viewTransform';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radii, spacing } from '@/theme/tokens';

type Tool = BrushMode | 'lasso' | 'move';

export default function Refine() {
  const { tokens: t } = useTheme();
  const result = useSession((s) => s.result);
  const itemId = useSession((s) => s.itemId);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewTransform | null>(null);
  const [hist, setHist] = useState(emptyHistory());
  const [live, setLive] = useState<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(40); // screen px
  const [softness, setSoftness] = useState(0.3);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs let the PanResponder (created once) always see current values.
  const live$ = useRef<Stroke | null>(null);
  const view$ = useRef<ViewTransform | null>(null);
  const cfg = useRef({ tool, brush, softness, w: 0, h: 0, box });
  const nextId = useRef(1);
  const pinch = useRef<TwoFinger | null>(null);
  const lastSingle = useRef<{ x: number; y: number } | null>(null);
  const ignoreUntilRelease = useRef(false);
  useEffect(() => {
    view$.current = view;
    cfg.current = { tool, brush, softness, w: result?.width ?? 0, h: result?.height ?? 0, box };
  });

  useEffect(() => {
    if (!result) router.replace('/');
  }, [result]);

  const onSize = useCallback(
    (w: number, h: number) => {
      setBox({ w, h });
      if (result) {
        setView((v) => v ?? fitTransform(result.width, result.height, w, h));
      }
    },
    [result],
  );

  const commit = useCallback(() => {
    const s = live$.current;
    live$.current = null;
    setLive(null);
    setCursor(null);
    if (s && isUsableStroke(s)) setHist((h) => pushStroke(h, s));
  }, []);

  // PanResponder handlers only touch refs when a gesture fires, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const touches = e.nativeEvent.touches;
        ignoreUntilRelease.current = false;
        pinch.current = null;
        if (touches.length >= 2) {
          pinch.current = twoFinger(
            { x: touches[0]!.locationX, y: touches[0]!.locationY },
            { x: touches[1]!.locationX, y: touches[1]!.locationY },
          );
          return;
        }
        const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        lastSingle.current = p;
        const v = view$.current;
        if (!v || cfg.current.tool === 'move') return;
        const ip = screenToImage(v, p);
        const stroke: Stroke = {
          id: nextId.current++,
          mode: cfg.current.tool === 'restore' ? 'restore' : 'erase',
          shape: cfg.current.tool === 'lasso' ? 'area' : 'brush',
          // a lasso only needs a thin feathered edge; the brush uses the size slider
          size: (cfg.current.tool === 'lasso' ? 6 : cfg.current.brush) / v.scale,
          softness: cfg.current.tool === 'lasso' ? 0.4 : cfg.current.softness,
          points: [ip],
        };
        live$.current = stroke;
        setLive(stroke);
        setCursor(p);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const touches = e.nativeEvent.touches;
        const v = view$.current;
        if (!v) return;
        if (touches.length >= 2) {
          // a second finger turns the gesture into pinch/pan and drops any half-drawn stroke
          if (live$.current) {
            live$.current = null;
            setLive(null);
            setCursor(null);
          }
          ignoreUntilRelease.current = true;
          const next = twoFinger(
            { x: touches[0]!.locationX, y: touches[0]!.locationY },
            { x: touches[1]!.locationX, y: touches[1]!.locationY },
          );
          if (pinch.current) {
            const { w, h, box: b } = cfg.current;
            const fit = fitTransform(w, h, b.w, b.h);
            const moved = applyPinch(v, pinch.current, next, fit.scale * 0.5, fit.scale * 24);
            setView(clampPan(moved, w, h, b.w, b.h));
          }
          pinch.current = next;
          return;
        }
        pinch.current = null;
        if (ignoreUntilRelease.current) return;
        const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        if (cfg.current.tool === 'move') {
          const last = lastSingle.current;
          if (last) {
            const { w, h, box: b } = cfg.current;
            setView(
              clampPan({ ...v, x: v.x + (p.x - last.x), y: v.y + (p.y - last.y) }, w, h, b.w, b.h),
            );
          }
          lastSingle.current = p;
          return;
        }
        const s = live$.current;
        if (!s) return;
        const ip = screenToImage(v, p);
        const points = appendPoint(s.points, ip, 1.5 / v.scale);
        if (points !== s.points) {
          const next = { ...s, points };
          live$.current = next;
          setLive(next);
        }
        setCursor(p);
      },
      onPanResponderRelease: () => {
        pinch.current = null;
        lastSingle.current = null;
        commit();
      },
      onPanResponderTerminate: () => {
        pinch.current = null;
        lastSingle.current = null;
        commit();
      },
    }),
  );

  if (!result) return null;

  const strokes = live ? [...hist.strokes, live] : hist.strokes;
  const dirty = hist.strokes.length > 0;

  const done = async () => {
    if (!dirty) {
      router.back();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const baked = await bakeMask({
        maskLayer: result.maskLayer,
        strokes: hist.strokes,
        width: result.width,
        height: result.height,
      });
      const maskUri = writeCacheFile(tempName('mask', 'png'), encodePng(baked));
      useSession.getState().replaceMask(baked, maskUri);
      const updated = useSession.getState().result;
      if (itemId && updated) {
        try {
          await updateLibraryItem(itemId, updated);
        } catch {
          useSession
            .getState()
            .setNotice('Your edit is applied but could not be saved to the library.');
        }
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply your edits.');
    } finally {
      setSaving(false);
    }
  };

  // Pulls the edge in by one step (removes a light rim). Applies any pending strokes first, so nothing is lost.
  const tighten = async () => {
    setSaving(true);
    setError(null);
    try {
      const withStrokes = await bakeMask({
        maskLayer: result.maskLayer,
        strokes: hist.strokes,
        width: result.width,
        height: result.height,
      });
      const { lo, hi } = edgeRamp('tight');
      const tight = tightenMask(withStrokes, lo, hi);
      const maskUri = writeCacheFile(tempName('mask', 'png'), encodePng(tight));
      useSession.getState().replaceMask(tight, maskUri);
      setHist(emptyHistory());
      const updated = useSession.getState().result;
      if (itemId && updated) {
        try {
          await updateLibraryItem(itemId, updated);
        } catch {
          useSession
            .getState()
            .setNotice('Your edit is applied but could not be saved to the library.');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not tighten the edge.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!dirty) return router.back();
    Alert.alert('Discard edits?', 'Your brush strokes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const reset = () => {
    setHist(emptyHistory());
    if (box.w > 0) setView(fitTransform(result.width, result.height, box.w, box.h));
  };

  return (
    <Screen header={<Header title="Refine" back={false} />} padded={false}>
      <View
        style={{
          flex: 1,
          marginHorizontal: spacing.lg,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: t.border,
          overflow: 'hidden',
        }}
      >
        <SceneCanvas result={result} strokes={strokes} transform={view} onSize={onSize}>
          <View
            style={StyleSheet.absoluteFill}
            {...responder.panHandlers}
            accessibilityLabel="Editing area. Drag to paint, use two fingers to zoom and pan."
          />
          {cursor && (tool === 'erase' || tool === 'restore') ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: cursor.x - brush / 2,
                top: cursor.y - brush / 2,
                width: brush,
                height: brush,
                borderRadius: brush / 2,
                borderWidth: 2,
                borderColor: tool === 'erase' ? t.danger : t.accent,
              }}
            />
          ) : null}
        </SceneCanvas>
      </View>

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Segmented<Tool>
          label="Tool"
          value={tool}
          onChange={setTool}
          options={[
            { value: 'erase', label: 'Erase' },
            { value: 'restore', label: 'Restore' },
            { value: 'lasso', label: 'Lasso' },
            { value: 'move', label: 'Move' },
          ]}
        />
        {tool === 'lasso' ? (
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            Draw around the part you want gone (a logo, a tag). Lift your finger and it is removed.
          </Text>
        ) : null}
        <Slider
          label="Brush size"
          value={brush}
          min={8}
          max={140}
          step={1}
          onChange={setBrush}
          format={(v) => `${Math.round(v)} px`}
        />
        <Slider
          label="Softness"
          value={softness}
          min={0}
          max={1}
          step={0.05}
          onChange={setSoftness}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            label="Undo"
            onPress={() => setHist(undo)}
            disabled={!canUndo(hist)}
            style={{ flex: 1, paddingHorizontal: spacing.sm }}
          />
          <Button
            label="Redo"
            onPress={() => setHist(redo)}
            disabled={!canRedo(hist)}
            style={{ flex: 1, paddingHorizontal: spacing.sm }}
          />
          <Button
            label="Reset"
            onPress={reset}
            disabled={!dirty && !view}
            style={{ flex: 1, paddingHorizontal: spacing.sm }}
          />
        </View>
        <Button label="Tighten edge" onPress={() => void tighten()} disabled={saving} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Cancel" onPress={cancel} style={{ flex: 1 }} />
          <Button
            label="Done"
            kind="primary"
            onPress={() => void done()}
            busy={saving}
            style={{ flex: 1 }}
          />
        </View>
        <Text style={{ color: t.textMuted, fontSize: 12, textAlign: 'center' }}>
          Two fingers: pinch to zoom, drag to pan
        </Text>
      </View>
    </Screen>
  );
}
