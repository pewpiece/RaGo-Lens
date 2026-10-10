import {
  BlurMask,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Oval,
  Paint,
  Rect,
  Shadow,
  type SkImage,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { rampStrip } from './strips';
import type { BackgroundState, ShadowState, TransformState } from '@/edit/editState';
import {
  boxH,
  boxW,
  placementTransform,
  type Box,
  type CanvasSize,
  type Placement,
} from './layout';

/**
 * The cut-out as one premultiplied RGBA image covering the product's bounds (photo px: x, y = top-left corner).
 * Building it BEFORE any rotation or scaling matters: the photo and the mask are multiplied at source resolution,
 * so resampling afterwards works on premultiplied pixels and an edge pixel never mixes in the colour of the
 * background it replaced (no dark or light fringe).
 */
export interface ProductInputs {
  cutout: SkImage;
  /** Tight bounds of the mask in photo px; the cut-out image covers exactly this box. */
  bounds: Box;
}

const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear } as const;

const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.min(1, Math.max(0, a))})`;
};

const rad = (d: number) => (d * Math.PI) / 180;

function Background({ bg, canvas }: { bg: BackgroundState; canvas: CanvasSize }) {
  const strip = useMemo(
    () => (bg.kind === 'gradient' ? rampStrip(bg.from, bg.to) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bg.kind === 'gradient' ? bg.from : '', bg.kind === 'gradient' ? bg.to : ''],
  );
  if (bg.kind === 'color')
    return <Rect x={0} y={0} width={canvas.w} height={canvas.h} color={bg.color} />;
  if (bg.kind === 'gradient' && strip) {
    // angle 90 = top to bottom; the strip's x axis is the gradient direction
    const a = rad(bg.angle);
    const extent = Math.abs(canvas.w * Math.cos(a)) + Math.abs(canvas.h * Math.sin(a));
    const cover = Math.hypot(canvas.w, canvas.h);
    return (
      <Group
        transform={[{ translateX: canvas.w / 2 }, { translateY: canvas.h / 2 }, { rotate: a }]}
      >
        <SkiaImage
          image={strip}
          x={-extent / 2}
          y={-cover / 2}
          width={extent}
          height={cover}
          fit="fill"
          sampling={SAMPLING}
        />
      </Group>
    );
  }
  return null;
}

/** The cut-out, placed on the canvas. */
function Product({ p, place }: { p: ProductInputs; place: Placement }) {
  return (
    <Group transform={placementTransform(place, p.bounds)}>
      <SkiaImage
        image={p.cutout}
        fit="fill"
        x={p.bounds.left}
        y={p.bounds.top}
        width={boxW(p.bounds)}
        height={boxH(p.bounds)}
        sampling={SAMPLING}
      />
    </Group>
  );
}

function ContactShadow({
  s,
  place,
  opacity,
  spread,
}: {
  s: ShadowState;
  place: Placement;
  opacity: number;
  spread: number;
}) {
  const w = boxW(place.box);
  const h = boxH(place.box);
  const ew = w * spread;
  const eh = Math.max(4, Math.min(h * 0.08, w * 0.06));
  return (
    <Oval
      x={place.cx - ew / 2}
      y={place.box.bottom - eh * 0.55}
      width={ew}
      height={eh}
      color={withAlpha(s.color, opacity)}
    >
      <BlurMask blur={Math.max(2, Math.max(w, h) * s.blur * 0.5)} style="normal" />
    </Oval>
  );
}

function Reflection({
  s,
  p,
  place,
  canvas,
}: {
  s: ShadowState;
  p: ProductInputs;
  place: Placement;
  canvas: CanvasSize;
}) {
  const floor = place.box.bottom;
  const fade = Math.max(1, boxH(place.box) * 0.4);
  // vertical fade: the strip's x axis runs downwards after the rotation
  const strip = useMemo(
    () => rampStrip('#000000', '#000000', s.reflectionOpacity, 0),
    [s.reflectionOpacity],
  );
  return (
    <Group layer>
      <Group transform={[{ translateY: 2 * floor }, { scaleY: -1 }]}>
        <Product p={p} place={place} />
      </Group>
      <Group layer={<Paint blendMode="dstIn" />}>
        <Group
          transform={[{ translateX: canvas.w / 2 }, { translateY: floor }, { rotate: Math.PI / 2 }]}
        >
          <SkiaImage
            image={strip}
            x={0}
            y={-canvas.w / 2}
            width={fade}
            height={canvas.w}
            fit="fill"
            sampling={SAMPLING}
          />
        </Group>
      </Group>
    </Group>
  );
}

export interface ComposeTreeProps {
  product: ProductInputs;
  canvas: CanvasSize;
  placement: Placement;
  background: BackgroundState;
  shadow: ShadowState;
  transform?: TransformState;
}

/**
 * The finished picture, in canvas pixels: background, floor reflection, contact / drop shadow, then the product.
 * Shadows and the reflection are drawn from the product's own alpha, so they work on every background and, on a
 * transparent canvas, end up as semi-transparent pixels in the PNG's alpha channel.
 */
export function ComposeTree({ product, canvas, placement, background, shadow }: ComposeTreeProps) {
  const L = Math.max(boxW(placement.box), boxH(placement.box));
  const a = rad(shadow.angle);
  const dist = shadow.distance * L;
  const dx = Math.cos(a) * dist;
  const dy = Math.sin(a) * dist;
  const prod = <Product p={product} place={placement} />;
  return (
    <Group>
      <Background bg={background} canvas={canvas} />
      {shadow.reflection ? (
        <Reflection s={shadow} p={product} place={placement} canvas={canvas} />
      ) : null}
      {shadow.kind === 'contact' || shadow.kind === 'natural' ? (
        <ContactShadow
          s={shadow}
          place={placement}
          opacity={shadow.kind === 'natural' ? Math.min(1, shadow.opacity * 1.6) : shadow.opacity}
          spread={shadow.kind === 'natural' ? 0.7 : 0.85}
        />
      ) : null}
      {shadow.kind === 'drop' || shadow.kind === 'natural' ? (
        <Group
          layer={
            <Paint>
              <Shadow
                dx={dx}
                dy={dy}
                blur={Math.max(1, L * shadow.blur * (shadow.kind === 'natural' ? 1.6 : 1))}
                color={withAlpha(
                  shadow.color,
                  shadow.kind === 'natural' ? shadow.opacity * 0.55 : shadow.opacity,
                )}
              />
            </Paint>
          }
        >
          {prod}
        </Group>
      ) : (
        prod
      )}
    </Group>
  );
}
