import { Alert, TextInput, View } from 'react-native';
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
import { Slider } from '@/components/Slider';
import { isLanUrl, normalizeBaseUrl } from '@/engine/remoteEngine';
import { useTheme } from '@/theme/ThemeProvider';
import { clearLibrary } from '@/library/library';
import { useSettingsStore, useThemeStore } from '@/store/instances';
import { WORKING_SIZE_CHOICES } from '@/store/settingsStore';
import { MODEL_INFO } from '@/about/licenses';
import type { ExportBackground, ExportSize } from '@/export/options';
import type { EdgeLevel } from '@/engine/edge';
import type { ScanScript } from '@/scan/types';
import type { ThemeMode } from '@/theme/tokens';
import { useState } from 'react';
import { spacing } from '@/theme/tokens';

export default function Settings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const exp = useSettingsStore((s) => s.exportDefaults);
  const setExp = useSettingsStore((s) => s.setExportDefaults);
  const cap = useSettingsStore((s) => s.workingSizeCap);
  const edgeLevel = useSettingsStore((s) => s.edgeLevel);
  const autoEnhance = useSettingsStore((s) => s.autoEnhance);
  const remote = useSettingsStore((s) => s.remote);
  const setRemote = useSettingsStore((s) => s.setRemote);
  const { tokens } = useTheme();
  const [testing, setTesting] = useState(false);
  const [remoteNote, setRemoteNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  );
  const fieldStyle = {
    borderWidth: 1,
    borderColor: tokens.borderStrong,
    borderRadius: 14,
    padding: spacing.md,
    color: tokens.text,
    minHeight: 48,
  } as const;
  const testRemote = async () => {
    setTesting(true);
    setRemoteNote(null);
    try {
      const { remoteEngineFor } = await import('@/engine/factory');
      const model = await remoteEngineFor(remote).ping();
      setRemoteNote({ tone: 'info', text: `Connected. Model: ${model}.` });
    } catch (e) {
      setRemoteNote({ tone: 'error', text: e instanceof Error ? e.message : 'Could not connect.' });
    } finally {
      setTesting(false);
    }
  };
  const setAutoEnhance = useSettingsStore((s) => s.setAutoEnhance);
  const setEdgeLevel = useSettingsStore((s) => s.setEdgeLevel);
  const setCap = useSettingsStore((s) => s.setWorkingSizeCap);
  const scanScript = useSettingsStore((s) => s.scanScript);
  const setScanScript = useSettingsStore((s) => s.setScanScript);
  const scanEnhance = useSettingsStore((s) => s.scanEnhance);
  const setScanEnhance = useSettingsStore((s) => s.setScanEnhance);
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

      <SectionTitle>Scan</SectionTitle>
      <Row
        label="Writing system"
        hint="Which kind of writing Scan should read. You can also change it with Retry on a scan."
      >
        <Segmented<ScanScript>
          label="Scan writing system"
          value={scanScript}
          onChange={(v) => void setScanScript(v)}
          options={[
            { value: 'latin', label: 'English / Latin' },
            { value: 'devanagari', label: 'Devanagari' },
          ]}
        />
      </Row>
      <Toggle
        label="Boost faint writing"
        hint="Raises the contrast of pale pencil or pen before Scan reads the page."
        value={scanEnhance}
        onChange={(v) => void setScanEnhance(v)}
      />

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
        label="Auto exposure and white balance"
        hint="Brightens a dim photo and removes a colour cast before the cut-out, so the model sees the product more clearly"
        value={autoEnhance.enabled}
        onChange={(v) => void setAutoEnhance({ enabled: v })}
      />
      {autoEnhance.enabled ? (
        <>
          <Slider
            label="Strength"
            value={autoEnhance.strength}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => void setAutoEnhance({ strength: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Toggle
            label="Also apply to the exported picture"
            hint="Off: only the model sees the enhanced photo; the export keeps the original colours"
            value={autoEnhance.exportToo}
            onChange={(v) => void setAutoEnhance({ exportToo: v })}
          />
        </>
      ) : null}
      <Row
        label="Cut-out edge"
        hint="Tight pulls the edge in to remove a light rim around dark objects. Applies to new cut-outs."
      >
        <Segmented<EdgeLevel>
          label="Cut-out edge"
          value={edgeLevel}
          onChange={(v) => void setEdgeLevel(v)}
          options={[
            { value: 'soft', label: 'Soft' },
            { value: 'normal', label: 'Normal' },
            { value: 'tight', label: 'Tight' },
          ]}
        />
      </Row>
      <SectionTitle>HD engine (your laptop)</SectionTitle>
      <Toggle
        label="Use a larger model on my laptop"
        hint="Sends the photo over your own Wi-Fi to a computer you set up. Off by default. If it cannot be reached, the phone does the cut-out itself."
        value={remote.enabled}
        onChange={(v) => void setRemote({ enabled: v })}
      />
      {remote.enabled ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            accessibilityLabel="Laptop address"
            placeholder="192.168.1.20:8787"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={remote.baseUrl}
            onChangeText={(v) => void setRemote({ baseUrl: v })}
            style={fieldStyle}
          />
          <TextInput
            accessibilityLabel="Laptop token"
            placeholder="Token"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={remote.token}
            onChangeText={(v) => void setRemote({ token: v })}
            style={fieldStyle}
          />
          {remote.baseUrl && !isLanUrl(normalizeBaseUrl(remote.baseUrl)) ? (
            <Banner tone="error">
              That address is not on your local network, so it will not be used.
            </Banner>
          ) : null}
          <Button
            label={testing ? 'Testing…' : 'Test connection'}
            busy={testing}
            onPress={() => void testRemote()}
            testID="remote-test"
          />
          {remoteNote ? <Banner tone={remoteNote.tone}>{remoteNote.text}</Banner> : null}
          <Muted>
            Only addresses on your local network are allowed. Details:
            docs/GOLESYNC_SEGMENT_ENDPOINT.md in the project.
          </Muted>
        </View>
      ) : null}

      <Toggle
        label="Developer: use mock engines"
        hint="Skips the real models: cut-out becomes a centre ellipse and Scan returns sample text. For testing the UI."
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
