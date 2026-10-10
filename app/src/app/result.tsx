import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Header, Muted, Screen, Segmented } from '@/components/ui';
import { SceneCanvas } from '@/components/SceneCanvas';
import { useSession } from '@/store/session';
import { useSettingsStore } from '@/store/instances';
import { WORKING_SIZE_CHOICES } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

export default function Result() {
  const { tokens: t } = useTheme();
  const result = useSession((s) => s.result);
  const notice = useSession((s) => s.notice);
  const sourceUri = useSession((s) => s.sourceUri);
  const settingsCap = useSettingsStore((s) => s.workingSizeCap);
  const [showOriginal, setShowOriginal] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryCap, setRetryCap] = useState(settingsCap);

  useEffect(() => {
    if (!result) router.replace('/');
  }, [result]);
  if (!result) return null;

  const retry = () => {
    if (!sourceUri) return;
    setRetryOpen(false);
    useSession.getState().setSource(sourceUri, retryCap);
    router.replace('/processing');
  };

  return (
    <Screen
      header={
        <Header
          title="Result"
          right={
            <Button
              label="Library"
              kind="ghost"
              onPress={() => router.push('/library')}
              style={{ minHeight: 40, paddingHorizontal: spacing.md }}
            />
          }
        />
      }
    >
      {notice ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner tone="error">{notice}</Banner>
        </View>
      ) : null}
      {result.warning ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner>{result.warning}</Banner>
        </View>
      ) : null}
      {!result.foundObject ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner>
            No clear object was found. Try Refine to paint it in, or Retry with another photo or
            size.
          </Banner>
        </View>
      ) : null}

      <Pressable
        testID="compare"
        accessibilityRole="button"
        accessibilityLabel="Press and hold to compare with the original photo"
        onPressIn={() => setShowOriginal(true)}
        onPressOut={() => setShowOriginal(false)}
        style={[styles.stage, { borderColor: t.border }]}
      >
        <SceneCanvas result={result} />
        {showOriginal ? (
          <Image
            source={{ uri: result.workingUri }}
            style={[StyleSheet.absoluteFill, { backgroundColor: t.background }]}
            resizeMode="contain"
            accessibilityLabel="Original photo"
          />
        ) : null}
        <View pointerEvents="none" style={[styles.tag, { backgroundColor: t.overlay }]}>
          <Text style={{ color: '#fff', fontSize: fontSizes.caption, fontWeight: '700' }}>
            {showOriginal ? 'BEFORE' : 'AFTER · hold to compare'}
          </Text>
        </View>
      </Pressable>

      <View style={{ height: spacing.lg }} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button label="Refine" onPress={() => router.push('/refine')} style={{ flex: 1 }} />
        <Button label="Retry" onPress={() => setRetryOpen(true)} style={{ flex: 1 }} />
      </View>
      <View style={{ height: spacing.md }} />
      <Button label="Export / Share" kind="primary" onPress={() => router.push('/export')} />

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
              Retry with different settings
            </Text>
            <Muted>A lower working size uses less memory; a higher one keeps more detail.</Muted>
            <View style={{ height: spacing.lg }} />
            <Segmented<number>
              label="Working size"
              value={retryCap}
              onChange={setRetryCap}
              options={WORKING_SIZE_CHOICES.map((v) => ({ value: v, label: String(v) }))}
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
  stage: { flex: 1, borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  tag: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
  },
});
