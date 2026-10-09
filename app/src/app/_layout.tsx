import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShareIntentProvider, useShareIntent } from 'expo-share-intent';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useSession } from '@/store/session';
import { useSettingsStore, useThemeStore } from '@/store/instances';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Shown instead of a white screen or a crash when a screen throws while rendering. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0E1116',
        padding: 24,
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <Text style={{ color: '#F4F6F8', fontSize: 20, fontWeight: '700' }}>
        Something went wrong
      </Text>
      <Text selectable style={{ color: '#A6AFBC', fontSize: 14 }}>
        {error.message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ backgroundColor: '#FF8A3D', padding: 14, borderRadius: 12 }}
      >
        <Text style={{ color: '#0E1116', fontWeight: '700', textAlign: 'center' }}>Try again</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        style={{ padding: 14 }}
      >
        <Text style={{ color: '#F4F6F8', textAlign: 'center' }}>Go to home</Text>
      </Pressable>
    </View>
  );
}

/** Images shared into the app from the gallery or other apps go straight to processing. */
function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const navReady = !!useRootNavigationState()?.key; // navigating before the root layout mounts throws
  useEffect(() => {
    if (!hasShareIntent || !navReady) return;
    const file = shareIntent.files?.find((f) => f.mimeType?.startsWith('image/')) ?? null;
    if (file?.path) {
      useSession
        .getState()
        .setSource(
          file.path.startsWith('file://') || file.path.startsWith('content://')
            ? file.path
            : `file://${file.path}`,
        );
      router.replace('/processing');
    }
    resetShareIntent();
  }, [hasShareIntent, navReady, shareIntent, resetShareIntent]);
  return null;
}

function Navigator() {
  const { tokens } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.background },
        animation: 'fade',
      }}
    />
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await Promise.all([
          useThemeStore.getState().hydrate(),
          useSettingsStore.getState().hydrate(),
        ]);
      } catch {
        /* stores fall back to defaults; the app stays usable */
      }
      if (alive) setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!ready) return null;
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <Navigator />
          <ShareIntentHandler />
        </ThemeProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
