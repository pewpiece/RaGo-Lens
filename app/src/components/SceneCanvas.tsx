import { useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Group } from '@shopify/react-native-skia';
import type { CutoutResult } from '@/engine/pipeline';
import { Checkerboard } from '@/components/Checkerboard';
import { CutoutTree } from '@/scene/CutoutTree';
import type { Stroke } from '@/scene/strokes';
import { fitTransform, type ViewTransform } from '@/scene/viewTransform';

/** Cut-out over the transparency checkerboard. With no `transform` the image is fitted and centred. */
export function SceneCanvas({
  result,
  strokes = [],
  transform,
  onSize,
  style,
  children,
}: {
  result: Pick<CutoutResult, 'original' | 'maskLayer' | 'width' | 'height'>;
  strokes?: readonly Stroke[];
  transform?: ViewTransform | null;
  onSize?: (w: number, h: number) => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    onSize?.(width, height);
  };
  const t = transform ?? fitTransform(result.width, result.height, size.w, size.h);
  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]} onLayout={onLayout}>
      {size.w > 0 && size.h > 0 ? (
        <Canvas style={{ width: size.w, height: size.h }} accessibilityLabel="Cut-out preview">
          <Checkerboard width={size.w} height={size.h} />
          <Group transform={[{ translateX: t.x }, { translateY: t.y }, { scale: t.scale }]}>
            <CutoutTree
              original={result.original}
              maskLayer={result.maskLayer}
              strokes={strokes}
              width={result.width}
              height={result.height}
            />
          </Group>
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
