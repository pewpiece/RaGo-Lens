import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Body, Button, Card, Header, Muted, Screen } from '@/components/ui';
import { FocusRing, Grid, LevelIndicator } from '@/components/capture/CaptureOverlays';
import { assessUri } from '@/capture/assess';
import { useCaptureSensors } from '@/capture/useSensors';
import { useScanSession } from '@/store/scanSession';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radii, spacing } from '@/theme/tokens';

export function startProcessing(uri: string, scan: boolean) {
  if (scan) {
    useScanSession.getState().start(uri);
    router.push('/scan');
  } else {
    useSession.getState().setSource(uri);
    router.push('/processing');
  }
}

/** Opens the system photo picker. On Android 13+ this needs no storage permission. */
async function pickFromGallery(onPicked: (uri: string) => void, onError: (m: string) => void) {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]) onPicked(res.assets[0].uri);
  } catch {
    onError('Could not open your gallery. Please try again.');
  }
}

export default function Capture() {
  const { tokens: t } = useTheme();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const scan = mode === 'scan';
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  const [levelOn, setLevelOn] = useState(true);
  const [autofocus, setAutofocus] = useState<'on' | 'off'>('off');
  const [focusAt, setFocusAt] = useState<{ x: number; y: number } | null>(null);
  const [review, setReview] = useState<{ uri: string; tips: string[] } | null>(null);
  const sensors = useCaptureSensors(!!permission?.granted);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Looks at the photo first; a tip (blurry, dark product, ...) is shown with Retake / Use photo, no tip goes straight on. */
  const proceed = async (uri: string) => {
    const q = await assessUri(uri);
    const tips = (q?.tips ?? []).filter((tip) => !scan || /blurry|very dark/.test(tip));
    if (tips.length === 0) startProcessing(uri, scan);
    else setReview({ uri, tips });
  };

  /** expo-camera has no focus-point API: a tap shows a ring and asks the camera to refocus (best effort). */
  const tapFocus = (e: GestureResponderEvent) => {
    setFocusAt({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    setAutofocus('on');
    timers.current.push(setTimeout(() => setAutofocus('off'), 500));
    timers.current.push(setTimeout(() => setFocusAt(null), 900));
  };

  const shoot = async () => {
    if (busy || !camera.current) return;
    setBusy(true);
    setError(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const pic = await camera.current.takePictureAsync({ quality: 1, exif: false });
      await proceed(pic.uri);
    } catch {
      setError('The photo could not be taken. Try again, or pick one from your gallery.');
    } finally {
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <Screen header={<Header title={scan ? 'Scan' : 'Cutout'} />}>
        <Muted>Checking camera access…</Muted>
      </Screen>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <Screen header={<Header title={scan ? 'Scan' : 'Cutout'} />}>
        <Card>
          <Body style={{ fontWeight: '700', marginBottom: spacing.sm }}>Camera access is off</Body>
          <Muted>
            {blocked
              ? 'Camera permission was denied. You can allow it in the phone settings, or just pick a photo from your gallery.'
              : `Allow the camera to photograph ${scan ? 'a page' : 'an object'}, or pick a photo from your gallery instead.`}
          </Muted>
          <View style={{ height: spacing.lg }} />
          {blocked ? (
            <Button
              label="Open phone settings"
              onPress={() => void Linking.openSettings()}
              style={{ marginBottom: spacing.sm }}
            />
          ) : (
            <Button
              label="Allow camera"
              kind="primary"
              onPress={() => void requestPermission()}
              style={{ marginBottom: spacing.sm }}
            />
          )}
          <Button
            label="Pick from gallery"
            kind={blocked ? 'primary' : 'secondary'}
            onPress={() => void pickFromGallery((u) => void proceed(u), setError)}
          />
        </Card>
        {error ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner tone="error">{error}</Banner>
          </View>
        ) : null}
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flash}
        autofocus={autofocus}
        onMountError={() =>
          setError('The camera could not start. Pick a photo from your gallery instead.')
        }
      />
      {/* tap anywhere on the preview to focus; guides sit on top of it */}
      <Pressable
        testID="focus-surface"
        accessibilityLabel="Camera preview. Tap to focus."
        onPress={tapFocus}
        style={StyleSheet.absoluteFill}
      />
      {grid ? <Grid /> : null}
      {levelOn && sensors.level ? <LevelIndicator reading={sensors.level} /> : null}
      {focusAt ? <FocusRing x={focusAt.x} y={focusAt.y} /> : null}
      <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
        <View style={styles.topBar}>
          <RoundButton
            label="Back"
            glyph="‹"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <RoundButton
              label={grid ? 'Hide grid' : 'Show grid'}
              glyph="#"
              active={grid}
              onPress={() => setGrid((g) => !g)}
            />
            <RoundButton
              label={levelOn ? 'Hide level' : 'Show level'}
              glyph="⌖"
              active={levelOn}
              onPress={() => setLevelOn((v) => !v)}
            />
          </View>
          <RoundButton
            label={flash === 'on' ? 'Flash on' : 'Flash off'}
            glyph={flash === 'on' ? '⚡' : '⚡︎'}
            active={flash === 'on'}
            onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
          />
        </View>
        {error ? (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Banner tone="error">{error}</Banner>
          </View>
        ) : null}
        {/* pushes the controls to the bottom of the screen, like every camera app */}
        <View testID="camera-spacer" style={{ flex: 1 }} pointerEvents="none" />
        {sensors.lowLight || sensors.shaky ? (
          <View style={styles.warnRow} pointerEvents="none">
            {sensors.lowLight ? (
              <Text testID="warn-lowlight" style={styles.warn}>
                Low light: move to a brighter spot or add light
              </Text>
            ) : null}
            {sensors.shaky ? (
              <Text testID="warn-shaky" style={styles.warn}>
                Hold the phone steady
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.hint}>
          {scan
            ? 'Hold the page flat, fill the frame, use good light'
            : 'Place the object on a plain surface with good light'}
        </Text>
        <View testID="camera-controls" style={styles.bottomBar}>
          <RoundButton
            label="Pick from gallery"
            glyph="▦"
            onPress={() => void pickFromGallery((u) => void proceed(u), setError)}
          />
          <Pressable
            testID="shutter"
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            disabled={busy}
            onPress={() => void shoot()}
            style={[styles.shutterOuter, { borderColor: '#fff' }]}
          >
            <View
              style={[styles.shutterInner, { backgroundColor: busy ? t.textMuted : t.accent }]}
            />
          </Pressable>
          <View style={{ width: 52 }} />
        </View>
      </SafeAreaView>
      {review ? (
        <View style={styles.sheetBg} testID="capture-review">
          <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Image
              source={{ uri: review.uri }}
              style={styles.sheetImg}
              resizeMode="contain"
              accessibilityLabel="The photo you took"
            />
            {review.tips.map((tip) => (
              <Text key={tip} style={{ color: t.text, fontSize: 15 }}>
                • {tip}
              </Text>
            ))}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                label="Retake"
                onPress={() => setReview(null)}
                style={{ flex: 1 }}
                testID="review-retake"
              />
              <Button
                label="Use photo"
                kind="primary"
                onPress={() => {
                  const u = review.uri;
                  setReview(null);
                  startProcessing(u, scan);
                }}
                style={{ flex: 1 }}
                testID="review-use"
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoundButton({
  label,
  glyph,
  onPress,
  active,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.round, { backgroundColor: active ? '#FFB27A' : 'rgba(0,0,0,0.55)' }]}
    >
      <Text style={{ color: active ? '#000' : '#fff', fontSize: 24 }}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  warnRow: { alignItems: 'center', gap: 4, paddingBottom: spacing.sm },
  warn: {
    color: '#FFD166',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.md,
    fontSize: 13,
    overflow: 'hidden',
  },
  sheetBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
  },
  sheetImg: { width: '100%', height: 200, borderRadius: radii.md, backgroundColor: '#000' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  bottomBar: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  round: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32 },
  hint: {
    color: '#fff',
    textAlign: 'center',
    paddingBottom: spacing.lg,
    fontSize: 13,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
});
