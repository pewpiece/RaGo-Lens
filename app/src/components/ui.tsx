import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radii, spacing, type ThemeTokens } from '@/theme/tokens';

export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && { padding: spacing.lg }, { flexGrow: 1 }, style]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: spacing.lg }, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.background }}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      {body}
    </SafeAreaView>
  );
}

export function Header({
  title,
  back = true,
  right,
}: {
  title: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const s = useThemedStyles(headerStyles);
  return (
    <View style={s.row}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}
          style={s.back}>
          <Text style={s.backText}>‹</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" style={s.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={s.right}>{right}</View>
    </View>
  );
}
const headerStyles = (t: ThemeTokens) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg },
    back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
    backText: { color: t.text, fontSize: 32, lineHeight: 36 },
    title: { color: t.text, fontSize: fontSizes.title, fontWeight: '700', flex: 1 },
    right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  });

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { tokens } = useTheme();
  return <Text style={[{ color: tokens.text, fontSize: fontSizes.body }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { tokens } = useTheme();
  return (
    <Text style={[{ color: tokens.textMuted, fontSize: fontSizes.body }, style]}>{children}</Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: tokens.textMuted,
        fontSize: fontSizes.caption,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
      }}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  busy,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { tokens: t } = useTheme();
  const palette: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.accent, fg: t.onAccent, border: t.accent },
    secondary: { bg: t.surfaceRaised, fg: t.text, border: t.border },
    danger: { bg: 'transparent', fg: t.danger, border: t.danger },
    ghost: { bg: 'transparent', fg: t.text, border: 'transparent' },
  };
  const c = palette[kind];
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          paddingHorizontal: spacing.lg,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {busy ? <ActivityIndicator color={c.fg} /> : null}
      <Text style={{ color: c.fg, fontSize: fontSizes.bodyLg, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { tokens: t } = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [base, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }, style]}>
      {children}
    </Pressable>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { tokens: t } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        backgroundColor: t.surfaceRaised,
        borderRadius: radii.md,
        padding: 3,
        borderWidth: 1,
        borderColor: t.border,
      }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: radii.md - 3,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? t.accent : 'transparent',
              paddingHorizontal: 4,
            }}>
            <Text
              style={{
                color: selected ? t.onAccent : t.text,
                fontWeight: selected ? '700' : '500',
                fontSize: fontSizes.body,
              }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  const { tokens: t } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={{ color: t.text, fontSize: fontSizes.bodyLg, fontWeight: '600', marginBottom: 2 }}>
        {label}
      </Text>
      {hint ? (
        <Text style={{ color: t.textMuted, fontSize: fontSizes.caption, marginBottom: spacing.sm }}>
          {hint}
        </Text>
      ) : (
        <View style={{ height: spacing.xs }} />
      )}
      {children}
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const { tokens: t } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: spacing.sm }}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={{ color: t.text, fontSize: fontSizes.bodyLg, fontWeight: '600' }}>{label}</Text>
        {hint ? <Text style={{ color: t.textMuted, fontSize: fontSizes.caption }}>{hint}</Text> : null}
      </View>
      <View
        style={{
          width: 52,
          height: 30,
          borderRadius: 15,
          backgroundColor: value ? t.accent : t.surfaceRaised,
          borderWidth: 1,
          borderColor: value ? t.accent : t.border,
          justifyContent: 'center',
          paddingHorizontal: 3,
          alignItems: value ? 'flex-end' : 'flex-start',
        }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: value ? t.onAccent : t.textMuted,
          }}
        />
      </View>
    </Pressable>
  );
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error';
  children: ReactNode;
}) {
  const { tokens: t } = useTheme();
  const color = tone === 'error' ? t.danger : t.textMuted;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: radii.md,
        padding: spacing.md,
        backgroundColor: t.surface,
      }}>
      <Text style={{ color, fontSize: fontSizes.body }}>{children}</Text>
    </View>
  );
}
