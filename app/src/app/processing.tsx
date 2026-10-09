import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Header, Muted, Screen } from '@/components/ui';
import { devicePipelineDeps, getEngine } from '@/engine/factory';
import { runCutout } from '@/engine/pipeline';
import { isCancelled, toCutoutError, type CutoutError } from '@/engine/types';
import { saveResultToLibrary } from '@/library/saveResult';
import { useSession } from '@/store/session';
import { useSettingsStore } from '@/store/instances';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

export default function Processing() {
  const { tokens: t } = useTheme();
  const sourceUri = useSession((s) => s.sourceUri);
  const capOverride = useSession((s) => s.capOverride);
  const settingsCap = useSettingsStore((s) => s.workingSizeCap);
  const useMock = useSettingsStore((s) => s.useMockEngine);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('Starting');
  const [error, setError] = useState<CutoutError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const [shimmer] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  useEffect(() => {
    if (!sourceUri) {
      router.replace('/');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const cap = capOverride ?? settingsCap;
    (async () => {
      try {
        const result = await runCutout(
          {
            uri: sourceUri,
            cap,
            engine: getEngine(useMock),
            signal: controller.signal,
            onProgress: (f, l) => {
              if (controller.signal.aborted) return;
              setProgress(f);
              setLabel(l);
            },
          },
          devicePipelineDeps,
        );
        if (controller.signal.aborted) return;
        let itemId: string | null = null;
        let notice: string | null = null;
        try {
          itemId = (await saveResultToLibrary(result, cap)).id;
        } catch (e) {
          notice = `Not saved to your library: ${e instanceof Error ? e.message : 'unknown error'}`;
        }
        if (controller.signal.aborted) return;
        useSession.getState().setResult(result, itemId);
        useSession.getState().setNotice(notice);
        router.replace('/result');
      } catch (e) {
        if (isCancelled(e) || controller.signal.aborted) return;
        setError(toCutoutError(e));
      }
    })();
    return () => controller.abort(); // leaving the screen cancels the work
  }, [sourceUri, capOverride, settingsCap, useMock, attempt]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  return (
    <Screen header={<Header title="Cutting out" back={false} />}>
      <View style={[styles.photoBox, { backgroundColor: t.surfaceRaised, borderColor: t.border }]}>
        {sourceUri ? (
          <Image
            source={{ uri: sourceUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            accessibilityLabel="Your photo"
          />
        ) : null}
        {!error ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: t.accent,
                opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.28] }),
              },
            ]}
          />
        ) : null}
      </View>

      {error ? (
        <View style={{ gap: spacing.md }}>
          <Banner tone="error">{error.message}</Banner>
          <Muted>{`Details: ${error.code}${error.cause instanceof Error ? ` · ${error.cause.message}` : ''}`}</Muted>
          <Button
            label="Try again"
            kind="primary"
            onPress={() => {
              setError(null);
              setProgress(0);
              setLabel('Starting');
              setAttempt((a) => a + 1);
            }}
          />
          <Button label="Back" onPress={cancel} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            style={[styles.track, { backgroundColor: t.border }]}
          >
            <View
              style={[
                styles.fill,
                { width: `${Math.round(progress * 100)}%`, backgroundColor: t.accent },
              ]}
            />
          </View>
          <Text style={{ color: t.text, fontSize: fontSizes.bodyLg, fontWeight: '600' }}>
            {label}…
          </Text>
          <Muted>Runs on your phone, no internet needed.</Muted>
          <Button label="Cancel" onPress={cancel} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoBox: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
