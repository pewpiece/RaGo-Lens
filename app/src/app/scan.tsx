import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Banner, Button, Header, Muted, Screen, Segmented } from '@/components/ui';
import { isScanCancelled, toScanError, type ScanError } from '@/scan/errors';
import { deviceSaveDeps, deviceScanDeps, getOcrEngine } from '@/scan/factory';
import { markdownToPlain } from '@/scan/markdown';
import { runScan } from '@/scan/pipeline';
import { saveScanText, saveScanToLibrary } from '@/scan/saveScan';
import type { ScanScript } from '@/scan/types';
import { useSettingsStore } from '@/store/instances';
import { useScanSession } from '@/store/scanSession';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, fonts, radii, spacing } from '@/theme/tokens';

type Phase = 'running' | 'done' | 'error';

const SCRIPTS: { value: ScanScript; label: string }[] = [
  { value: 'latin', label: 'English / Latin' },
  { value: 'devanagari', label: 'Devanagari' },
];

export default function ScanScreen() {
  const { tokens: t } = useTheme();
  const sourceUri = useScanSession((s) => s.sourceUri);
  const scriptOverride = useScanSession((s) => s.scriptOverride);
  const preloaded = useScanSession((s) => s.preloaded);
  const result = useScanSession((s) => s.result);
  const text = useScanSession((s) => s.text);
  const itemId = useScanSession((s) => s.itemId);
  const notice = useScanSession((s) => s.notice);
  const settingsScript = useSettingsStore((s) => s.scanScript);
  const useMock = useSettingsStore((s) => s.useMockEngine);

  const [phase, setPhase] = useState<Phase>(preloaded ? 'done' : 'running');
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('Starting');
  const [error, setError] = useState<ScanError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryScript, setRetryScript] = useState<ScanScript>(scriptOverride ?? settingsScript);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [shimmer] = useState(() => new Animated.Value(0));
  const script = scriptOverride ?? settingsScript;

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

  // Recognise the page (skipped when a saved scan was opened from the library).
  useEffect(() => {
    if (preloaded) return;
    if (!sourceUri) {
      router.replace('/');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    (async () => {
      try {
        const r = await runScan(
          {
            uri: sourceUri,
            script,
            engine: getOcrEngine(useMock),
            signal: controller.signal,
            onProgress: (f, l) => {
              if (controller.signal.aborted) return;
              setProgress(f);
              setLabel(l);
            },
          },
          deviceScanDeps,
        );
        if (controller.signal.aborted) return;
        let id: string | null = null;
        let note: string | null = null;
        if (r.foundText) {
          try {
            id = (await saveScanToLibrary(r, r.markdown, deviceSaveDeps)).id;
          } catch (e) {
            note = `Not saved to your library: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        }
        if (controller.signal.aborted) return;
        useScanSession.getState().setResult(r, id);
        useScanSession.getState().setNotice(note);
        setPhase('done');
      } catch (e) {
        if (isScanCancelled(e) || controller.signal.aborted) return;
        setError(toScanError(e));
        setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [sourceUri, script, useMock, attempt, preloaded]);

  // Save edits to the library shortly after the user stops typing.
  useEffect(() => {
    if (!itemId || phase !== 'done') return;
    const h = setTimeout(() => {
      try {
        saveScanText(itemId, text);
      } catch {
        /* the on-screen text is still intact; try again on the next edit */
      }
    }, 700);
    return () => clearTimeout(h);
  }, [text, itemId, phase]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(h);
  }, [toast]);

  const cancel = () => {
    abort.current?.abort();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const flash = (msg: string) => {
    setToast(msg);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const retry = () => {
    if (!sourceUri) return;
    setRetryOpen(false);
    setError(null);
    setPhase('running');
    setProgress(0);
    setLabel('Starting');
    useScanSession.getState().start(sourceUri, retryScript);
    setAttempt((a) => a + 1);
  };

  const noText = phase === 'done' && !preloaded && result && !result.foundText;

  return (
    <Screen
      header={
        <Header
          title={phase === 'running' ? 'Reading the page' : 'Scan'}
          back={phase !== 'running'}
        />
      }
    >
      {phase === 'running' || phase === 'error' ? (
        <>
          <View
            style={[styles.photoBox, { backgroundColor: t.surfaceRaised, borderColor: t.border }]}
          >
            {sourceUri ? (
              <Image
                source={{ uri: sourceUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                accessibilityLabel="Your page"
              />
            ) : null}
            {phase === 'running' ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: t.accentScan,
                    opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.28] }),
                  },
                ]}
              />
            ) : null}
          </View>
          {phase === 'error' && error ? (
            <View style={{ gap: spacing.md }}>
              <Banner tone="error">{error.message}</Banner>
              <Muted>{`Details: ${error.code}${error.cause instanceof Error ? ` · ${error.cause.message}` : ''}`}</Muted>
              <Button label="Try again" kind="primary" onPress={retry} />
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
                    { width: `${Math.round(progress * 100)}%`, backgroundColor: t.accentScan },
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
        </>
      ) : (
        <>
          {notice ? (
            <View style={{ marginBottom: spacing.md }}>
              <Banner tone="error">{notice}</Banner>
            </View>
          ) : null}
          {noText ? (
            <View style={{ marginBottom: spacing.md }}>
              <Banner>
                No text was found. Try again with the page flat, closer and better lit, or pick the
                other writing system in Retry.
              </Banner>
            </View>
          ) : null}
          <TextInput
            testID="scan-text"
            accessibilityLabel="Recognised text, editable"
            multiline
            value={text}
            onChangeText={(v) => useScanSession.getState().setText(v)}
            placeholder="Recognised text appears here. You can edit it."
            placeholderTextColor={t.textMuted}
            textAlignVertical="top"
            style={[
              styles.editor,
              {
                color: t.text,
                backgroundColor: t.surface,
                borderColor: t.borderStrong,
                fontFamily: fonts.mono,
              },
            ]}
          />
          {toast ? (
            <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>{toast}</Muted>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label="Copy"
              kind="primary"
              disabled={!text}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
              onPress={() => void Clipboard.setStringAsync(text).then(() => flash('Copied'))}
            />
            <Button
              label="Copy plain"
              disabled={!text}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
              onPress={() =>
                void Clipboard.setStringAsync(markdownToPlain(text)).then(() =>
                  flash('Copied as plain text'),
                )
              }
            />
            <Button
              label="Share"
              disabled={!text}
              style={{ flex: 1, paddingHorizontal: spacing.sm }}
              onPress={() => void Share.share({ message: text }).catch(() => {})}
            />
          </View>
          {!preloaded ? (
            <Button
              label="Retry"
              kind="ghost"
              onPress={() => setRetryOpen(true)}
              style={{ marginTop: spacing.sm }}
            />
          ) : null}
        </>
      )}

      <Modal
        transparent
        animationType="fade"
        visible={retryOpen}
        onRequestClose={() => setRetryOpen(false)}
      >
        <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text
              accessibilityRole="header"
              style={{
                color: t.text,
                fontSize: fontSizes.title,
                fontWeight: '700',
                marginBottom: spacing.sm,
              }}
            >
              Read the page again
            </Text>
            <Muted>Pick the writing system on the page.</Muted>
            <View style={{ height: spacing.lg }} />
            <Segmented<ScanScript>
              label="Writing system"
              value={retryScript}
              onChange={setRetryScript}
              options={SCRIPTS}
            />
            <View style={{ height: spacing.lg }} />
            <Button label="Run again" kind="primary" onPress={retry} />
            <View style={{ height: spacing.sm }} />
            <Button label="Cancel" kind="ghost" onPress={() => setRetryOpen(false)} />
          </View>
        </View>
      </Modal>
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
  editor: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
  },
});
