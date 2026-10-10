import { useMemo } from 'react';
import { Fill, Path, Skia } from '@shopify/react-native-skia';
import { useTheme } from '@/theme/ThemeProvider';

/** Checkerboard with explicit colours (no theme needed, so it can be drawn into offscreen scenes). */
export function CheckerboardColors({
  width,
  height,
  cell = 14,
  a,
  b,
}: {
  width: number;
  height: number;
  cell?: number;
  a: string;
  b: string;
}) {
  const path = useMemo(() => {
    const pb = Skia.PathBuilder.Make();
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = r % 2; c < cols; c += 2)
        pb.addRect(Skia.XYWHRect(c * cell, r * cell, cell, cell));
    }
    return pb.build();
  }, [width, height, cell]);
  return (
    <>
      <Fill color={b} />
      <Path path={path} color={a} />
    </>
  );
}

/** Transparency checkerboard (Skia). Draw inside a <Canvas>; colours come from the theme tokens. */
export function Checkerboard({
  width,
  height,
  cell = 14,
}: {
  width: number;
  height: number;
  cell?: number;
}) {
  const { tokens } = useTheme();
  return (
    <CheckerboardColors
      width={width}
      height={height}
      cell={cell}
      a={tokens.checkerboardA}
      b={tokens.checkerboardB}
    />
  );
}
