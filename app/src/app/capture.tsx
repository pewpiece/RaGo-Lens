import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Body, Button, Card, Header, Muted, Screen } from '@/components/ui';
import { useScanSession } from '@/store/scanSession';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radii, spacing } from '@/theme/tokens';

function startProcessing(uri: string, scan: boolean) {
  if (scan) {
    useScanSession.getState().start(uri);
    router.push('/scan');
  } else {
    useSession.getState().setSource(uri);
    router.push('/processing');
  }
}

/** Opens the system photo picker. On Android 13+ this needs no storage permission. */
async function pickFromGallery(scan: boolean, onError: (m: string) => void) {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]) startProcessing(res.assets[0].uri, scan);
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

  const shoot = async () => {
    if (busy || !camera.current) return;
    setBusy(true);
    setError(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const pic = await camera.current.takePictureAsync({ quality: 1, exif: false });
      startProcessing(pic.uri, scan);
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
            onPress={() => void pickFromGallery(scan, setError)}
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
        onMountError={() =>
          setError('The camera could not start. Pick a photo from your gallery instead.')
        }
      />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <RoundButton
            label="Back"
            glyph="‹"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
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
        <View testID="camera-spacer" style={{ flex: 1 }} />
        <Text style={styles.hint}>
          {scan
            ? 'Hold the page flat, fill the frame, use good light'
            : 'Place the object on a plain surface with good light'}
        </Text>
        <View testID="camera-controls" style={styles.bottomBar}>
          <RoundButton
            label="Pick from gallery"
            glyph="▦"
            onPress={() => void pickFromGallery(scan, setError)}
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
