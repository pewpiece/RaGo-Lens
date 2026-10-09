import { useMemo } from 'react';
import { Fill, Path, Skia } from '@shopify/react-native-skia';
import { useTheme } from '@/theme/ThemeProvider';

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
  const path = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = r % 2; c < cols; c += 2)
        b.addRect(Skia.XYWHRect(c * cell, r * cell, cell, cell));
    }
    return b.build();
  }, [width, height, cell]);
  return (
    <>
      <Fill color={tokens.checkerboardB} />
      <Path path={path} color={tokens.checkerboardA} />
    </>
  );
}
