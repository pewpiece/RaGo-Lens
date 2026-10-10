import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Muted, Toggle } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { Chips, BG_SWATCHES, Swatches } from './Controls';
import type { Preset } from '@/presets/presets';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

/** Form for one preset (name, canvas, background, fill range, shadow, format, quality, size limit). */
export function PresetEditor({
  preset,
  onSave,
  onDuplicate,
  onDelete,
  onClose,
}: {
  preset: Preset;
  onSave: (p: Preset) => void;
  onDuplicate: (p: Preset) => void;
  onDelete: (p: Preset) => void;
  onClose: () => void;
}) {
  const { tokens: t } = useTheme();
  const [p, setP] = useState<Preset>(preset);
  const longSide = Math.max(p.canvas.width, p.canvas.height);
  const bgColor = p.background.kind === 'color' ? p.background.color : '#FFFFFF';
  return (
    <View style={{ gap: spacing.md }}>
      <TextInput
        accessibilityLabel="Preset name"
        value={p.name}
        onChangeText={(name) => setP({ ...p, name })}
        style={{
          borderWidth: 1,
          borderColor: t.borderStrong,
          borderRadius: 14,
          padding: spacing.md,
          color: t.text,
          minHeight: 48,
        }}
        placeholderTextColor={t.textMuted}
      />
      <Chips
        label="Canvas shape"
        value={p.canvas.aspect}
        onChange={(aspect) => setP({ ...p, canvas: { ...p.canvas, aspect } })}
        options={[
          { value: 'original', label: 'Original' },
          { value: '1:1', label: '1:1' },
          { value: '4:5', label: '4:5' },
          { value: '3:4', label: '3:4' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
        ]}
      />
      {p.canvas.aspect !== 'original' ? (
        <Slider
          label="Long side"
          value={longSide}
          min={512}
          max={4000}
          step={50}
          onChange={(v) =>
            setP({
              ...p,
              canvas: {
                ...p.canvas,
                width:
                  p.canvas.width >= p.canvas.height
                    ? v
                    : Math.round((v * p.canvas.width) / p.canvas.height),
                height:
                  p.canvas.height > p.canvas.width
                    ? v
                    : Math.round((v * p.canvas.height) / p.canvas.width),
              },
            })
          }
          format={(v) => `${Math.round(v)} px`}
        />
      ) : null}
      <Slider
        label="Padding"
        value={p.canvas.paddingPercent}
        min={0}
        max={20}
        step={1}
        onChange={(v) => setP({ ...p, canvas: { ...p.canvas, paddingPercent: v } })}
        format={(v) => `${Math.round(v)}%`}
      />
      <Chips
        label="Background"
        value={p.background.kind}
        onChange={(kind) =>
          setP({
            ...p,
            background: kind === 'transparent' ? { kind } : { kind: 'color', color: bgColor },
          })
        }
        options={[
          { value: 'transparent', label: 'Transparent' },
          { value: 'color', label: 'Colour' },
        ]}
      />
      {p.background.kind === 'color' ? (
        <Swatches
          label="Colour"
          colors={BG_SWATCHES}
          value={bgColor}
          onChange={(color) => setP({ ...p, background: { kind: 'color', color } })}
        />
      ) : null}
      <Slider
        label="Product fills at least"
        value={p.fill.min}
        min={0.1}
        max={1}
        step={0.05}
        onChange={(v) =>
          setP({
            ...p,
            fill: {
              ...p.fill,
              min: Math.min(v, p.fill.max),
              target: Math.max(Math.min(v, p.fill.max), p.fill.target),
            },
          })
        }
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Product fills at most"
        value={p.fill.max}
        min={0.1}
        max={1}
        step={0.05}
        onChange={(v) =>
          setP({
            ...p,
            fill: {
              ...p.fill,
              max: Math.max(v, p.fill.min),
              target: Math.min(Math.max(v, p.fill.min), p.fill.target),
            },
          })
        }
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Target fill"
        value={p.fill.target}
        min={p.fill.min}
        max={p.fill.max}
        step={0.01}
        onChange={(v) => setP({ ...p, fill: { ...p.fill, target: v } })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Chips
        label="Shadow"
        value={p.shadow}
        onChange={(shadow) => setP({ ...p, shadow })}
        options={[
          { value: 'none', label: 'None' },
          { value: 'contact', label: 'Contact' },
          { value: 'drop', label: 'Drop' },
          { value: 'natural', label: 'Natural' },
        ]}
      />
      <Chips
        label="File type"
        value={p.format}
        onChange={(format) =>
          setP({
            ...p,
            format,
            background:
              format === 'jpeg' && p.background.kind === 'transparent'
                ? { kind: 'color', color: '#FFFFFF' }
                : p.background,
          })
        }
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
        ]}
      />
      {p.format === 'jpeg' ? (
        <Slider
          label="JPEG quality"
          value={p.jpegQuality}
          min={40}
          max={100}
          step={1}
          onChange={(v) => setP({ ...p, jpegQuality: v })}
        />
      ) : null}
      <Toggle
        label="Limit file size"
        value={p.maxFileKB !== null}
        onChange={(on) => setP({ ...p, maxFileKB: on ? 1000 : null })}
      />
      {p.maxFileKB !== null ? (
        <Slider
          label="Largest file"
          value={p.maxFileKB}
          min={100}
          max={20000}
          step={100}
          onChange={(v) => setP({ ...p, maxFileKB: v })}
          format={(v) => `${Math.round(v)} KB`}
        />
      ) : null}
      <Muted>
        Values are starting points. Check each platform&apos;s current guidelines before relying on
        them.
      </Muted>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          label="Save"
          kind="primary"
          onPress={() => onSave(p)}
          style={{ flex: 1 }}
          testID="preset-save"
        />
        <Button label="Duplicate" onPress={() => onDuplicate(p)} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Delete" kind="danger" onPress={() => onDelete(p)} style={{ flex: 1 }} />
        <Button label="Close" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
