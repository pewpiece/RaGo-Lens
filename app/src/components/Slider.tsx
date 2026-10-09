import { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Text, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, spacing } from '@/theme/tokens';

export function valueFromX(
  x: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number {
  if (width <= 0) return min;
  const t = Math.min(1, Math.max(0, x / width));
  const raw = min + t * (max - min);
  const stepped = Math.round(raw / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
}

/** Minimal horizontal slider (drag or use accessibility increment/decrement). */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v: number) => String(Math.round(v)),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { tokens: t } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const cb = useRef({ min, max, step, onChange });
  useEffect(() => {
    cb.current = { min, max, step, onChange };
  });

  // PanResponder handlers only touch refs when a gesture fires, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) =>
        cb.current.onChange(
          valueFromX(
            e.nativeEvent.locationX,
            widthRef.current,
            cb.current.min,
            cb.current.max,
            cb.current.step,
          ),
        ),
      onPanResponderMove: (e) =>
        cb.current.onChange(
          valueFromX(
            e.nativeEvent.locationX,
            widthRef.current,
            cb.current.min,
            cb.current.max,
            cb.current.step,
          ),
        ),
    }),
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const frac = max > min ? (value - min) / (max - min) : 0;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.text, fontSize: fontSizes.body }}>{label}</Text>
        <Text style={{ color: t.textMuted, fontSize: fontSizes.body }}>{format(value)}</Text>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: format(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onChange(
            Math.min(
              max,
              Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step)),
            ),
          )
        }
        onLayout={onLayout}
        {...pan.panHandlers}
        style={{ height: 40, justifyContent: 'center' }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.border }} />
        <View
          style={{
            position: 'absolute',
            left: 0,
            width: width * frac,
            height: 4,
            borderRadius: 2,
            backgroundColor: t.accent,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: Math.max(0, width * frac - 11),
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: t.accent,
            borderWidth: 2,
            borderColor: t.background,
          }}
        />
      </View>
    </View>
  );
}
