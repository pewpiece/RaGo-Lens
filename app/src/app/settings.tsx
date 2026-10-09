import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import {
  Banner,
  Body,
  Button,
  Header,
  Muted,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Toggle,
} from '@/components/ui';
import { clearLibrary } from '@/library/library';
import { useSettingsStore, useThemeStore } from '@/store/instances';
import { WORKING_SIZE_CHOICES } from '@/store/settingsStore';
import { MODEL_INFO } from '@/about/licenses';
import type { ExportBackground, ExportSize } from '@/export/options';
import type { ThemeMode } from '@/theme/tokens';
import { useState } from 'react';
import { spacing } from '@/theme/tokens';

export default function Settings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const exp = useSettingsStore((s) => s.exportDefaults);
  const setExp = useSettingsStore((s) => s.setExportDefaults);
  const cap = useSettingsStore((s) => s.workingSizeCap);
  const setCap = useSettingsStore((s) => s.setWorkingSizeCap);
  const mock = useSettingsStore((s) => s.useMockEngine);
  const setMock = useSettingsStore((s) => s.setUseMockEngine);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const confirmClear = () =>
    Alert.alert(
      'Clear library?',
      'This permanently deletes every saved cut-out from this phone. Files you exported to the gallery are not touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear library',
          style: 'destructive',
          onPress: () => {
            try {
              clearLibrary();
              setNotice({ tone: 'info', text: 'Library cleared.' });
            } catch {
              setNotice({ tone: 'error', text: 'Could not clear the library. Try again.' });
            }
          },
        },
      ],
    );

  return (
    <Screen scroll header={<Header title="Settings" />}>
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

      <SectionTitle>Appearance</SectionTitle>
      <Row label="Theme" hint="System follows your phone's light/dark setting.">
        <Segmented<ThemeMode>
          label="Theme"
          value={mode}
          onChange={(v) => void setMode(v)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>

      <SectionTitle>Export defaults</SectionTitle>
      <Row label="Background" hint="Always saved as PNG so transparency is kept.">
        <Segmented<ExportBackground>
          label="Default background"
          value={exp.background}
          onChange={(v) => void setExp({ background: v })}
          options={[
            { value: 'transparent', label: 'Clear' },
            { value: 'white', label: 'White' },
            { value: 'color', label: 'Colour' },
            { value: 'shadow', label: 'Shadow' },
          ]}
        />
      </Row>
      <Toggle
        label="Auto-crop to object"
        hint="Trim empty space around the object."
        value={exp.autoCrop}
        onChange={(v) => void setExp({ autoCrop: v })}
      />
      <Row label="Output size">
        <Segmented<ExportSize>
          label="Default output size"
          value={exp.size}
          onChange={(v) => void setExp({ size: v })}
          options={[
            { value: 'original', label: 'Original' },
            { value: 2048, label: '2048' },
            { value: 1024, label: '1024' },
          ]}
        />
      </Row>

      <SectionTitle>Processing</SectionTitle>
      <Row
        label="Working size cap"
        hint="Longest edge of the photo we work on. Lower it if the app runs out of memory on big photos."
      >
        <Segmented<number>
          label="Working size cap"
          value={cap}
          onChange={(v) => void setCap(v)}
          options={WORKING_SIZE_CHOICES.map((v) => ({ value: v, label: String(v) }))}
        />
      </Row>
      <Toggle
        label="Developer: use mock engine"
        hint="Skips the real model and cuts out a centre ellipse. For testing the UI."
        value={mock}
        onChange={(v) => void setMock(v)}
      />

      <Button label="Run diagnostics" onPress={() => router.push('/selftest')} />

      <SectionTitle>Library</SectionTitle>
      <Button label="Clear library" kind="danger" onPress={confirmClear} />

      <SectionTitle>About</SectionTitle>
      <Body>RaGo Lens {Constants.expoConfig?.version ?? ''}</Body>
      <Muted>Everything runs on this phone. No accounts, no network, no analytics.</Muted>
      <View style={{ height: spacing.md }} />
      <Body style={{ fontWeight: '700' }}>Segmentation model</Body>
      <Muted>{MODEL_INFO.name}</Muted>
      <Muted>{MODEL_INFO.licence}</Muted>
      <Muted>{MODEL_INFO.attribution}</Muted>
      <View style={{ height: spacing.md }} />
      <Button label="View licences" onPress={() => router.push('/licenses')} />
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
