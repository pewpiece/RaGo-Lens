import { StyleSheet, Text, View } from 'react-native';
import type { LevelReading } from '@/capture/level';

/** Rule-of-thirds grid. */
export function Grid() {
  const line = { position: 'absolute' as const, backgroundColor: 'rgba(255,255,255,0.45)' };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="capture-grid">
      {[1, 2].map((k) => (
        <View
          key={`v${k}`}
          style={[
            line,
            { left: `${(k * 100) / 3}%`, top: 0, bottom: 0, width: StyleSheet.hairlineWidth * 2 },
          ]}
        />
      ))}
      {[1, 2].map((k) => (
        <View
          key={`h${k}`}
          style={[
            line,
            { top: `${(k * 100) / 3}%`, left: 0, right: 0, height: StyleSheet.hairlineWidth * 2 },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Level indicator. Upright: a line that turns with the phone's roll. Flat: a bubble that moves toward the high side and
 * sits inside the ring when level. Green = level.
 */
export function LevelIndicator({ reading }: { reading: LevelReading }) {
  const color = reading.level ? '#3DDC84' : '#FFD166';
  const label =
    reading.mode === 'flat'
      ? `Tilt ${reading.angle.toFixed(1)}°`
      : `${reading.angle > 0 ? '+' : ''}${reading.angle.toFixed(1)}°`;
  return (
    <View
      pointerEvents="none"
      style={styles.centre}
      testID="capture-level"
      accessible
      accessibilityLabel={`Level indicator: ${label}, ${reading.level ? 'level' : 'not level'}`}
    >
      {reading.mode === 'upright' ? (
        <View
          style={{
            width: 160,
            height: 3,
            backgroundColor: color,
            transform: [{ rotate: `${-reading.angle}deg` }],
          }}
        />
      ) : (
        <View style={[styles.ring, { borderColor: color }]}>
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: color,
                transform: [
                  { translateX: reading.bubbleX * 30 },
                  { translateY: -reading.bubbleY * 30 },
                ],
              },
            ]}
          />
        </View>
      )}
      <Text
        style={{ color, marginTop: 6, fontSize: 12, textShadowColor: '#000', textShadowRadius: 3 }}
      >
        {label}
      </Text>
    </View>
  );
}

export function FocusRing({ x, y }: { x: number; y: number }) {
  return (
    <View
      pointerEvents="none"
      testID="focus-ring"
      style={[styles.focus, { left: x - 36, top: y - 36 }]}
    />
  );
}

const styles = StyleSheet.create({
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: { width: 22, height: 22, borderRadius: 11 },
  focus: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#FFD166',
  },
});
