import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing } from '@/theme/tokens';

/** Wrapping row of selectable chips (touch targets >= 48 dp tall). */
export function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { tokens: t } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: 48,
              minWidth: 64,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: on ? t.accent : t.borderStrong,
              backgroundColor: on ? t.accent : t.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                color: on ? t.onAccent : t.text,
                fontWeight: on ? '700' : '500',
                fontSize: fontSizes.body,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  const { tokens: t } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
    >
      {colors.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="radio"
          accessibilityLabel={`${label} ${c}`}
          accessibilityState={{ selected: c.toLowerCase() === value.toLowerCase() }}
          onPress={() => onChange(c)}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: c,
            borderWidth: c.toLowerCase() === value.toLowerCase() ? 3 : 1,
            borderColor: c.toLowerCase() === value.toLowerCase() ? t.accent : t.borderStrong,
          }}
        />
      ))}
    </View>
  );
}

export const BG_SWATCHES = [
  '#FFFFFF',
  '#F3F4F6',
  '#E5E7EB',
  '#F2E8D5',
  '#111827',
  '#FF8A3D',
  '#2DD4BF',
  '#4F6BED',
];
export const SHADOW_SWATCHES = ['#000000', '#374151', '#4B3621', '#1E3A8A'];
