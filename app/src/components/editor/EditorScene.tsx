import {
  BlurMask,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Paint,
  Path,
  Rect,
  Fill,
  Circle,
  Oval,
  type SkImage,
} from '@shopify/react-native-skia';
import { CheckerboardColors } from '@/components/Checkerboard';
import { CHECKER_COLORS, type ViewMode } from '@/editor/viewModes';
import type { EditorDoc } from '@/editor/doc';
import type { Suggestion } from '@/editor/suggest';
import {
  pathOfPoints,
  softnessSigma,
  type BrushStroke,
  type SelectionShape,
} from '@/editor/tileOps';
import { TILE } from '@/mask/tiledMask';
import type { ViewTransform } from '@/scene/viewTransform';
import { alpha8Image } from '@/engine/skiaOps';
import { useMemo } from 'react';

const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear } as const;

export interface SceneOverlay {
  liveStroke?: BrushStroke | null;
  /** In-progress lasso / polygon outline (photo px). */
  outline?: { x: number; y: number }[] | null;
  /** In-progress rectangle / ellipse (photo px). */
  shape?: SelectionShape | null;
  suggestion?: Suggestion | null;
  anchor?: { x: number; y: number } | null;
}

export interface EditorSceneProps {
  doc: EditorDoc;
  /** Changes whenever the doc changed (forces a re-render). */
  rev: number;
  view: ViewTransform;
  box: { w: number; h: number };
  mode: ViewMode;
  /** Solid colour for the 'color' view mode. */
  color: string;
  /** Position (screen px) of the before/after divider. */
  compareX: number;
  overlay: SceneOverlay;
  accent: string;
  danger: string;
}

function visibleTiles(
  doc: EditorDoc,
  view: ViewTransform,
  box: { w: number; h: number },
): number[] {
  const x0 = Math.max(0, -view.x / view.scale);
  const y0 = Math.max(0, -view.y / view.scale);
  const x1 = Math.min(doc.width, (box.w - view.x) / view.scale);
  const y1 = Math.min(doc.height, (box.h - view.y) / view.scale);
  if (x1 <= x0 || y1 <= y0) return [];
  return doc.mask.tilesIn({
    x: Math.floor(x0),
    y: Math.floor(y0),
    w: Math.ceil(x1 - x0) + 1,
    h: Math.ceil(y1 - y0) + 1,
  });
}

/** The mask (or any TiledMask) drawn as alpha tiles; empty tiles are skipped, full tiles are plain rects. */
function MaskTiles({
  doc,
  which,
  tiles,
}: {
  doc: EditorDoc;
  which: 'mask' | 'selection';
  tiles: number[];
}) {
  const m = which === 'mask' ? doc.mask : doc.selection;
  const cache = which === 'mask' ? doc.maskTiles : doc.selectionTiles;
  return (
    <>
      {tiles.map((i) => {
        const r = m.tileRect(i);
        const u = m.uniformValue(i);
        if (u === 0) return null;
        if (u === 255)
          return <Rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} color="white" />;
        if (u !== null)
          return (
            <Rect
              key={i}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              color="white"
              opacity={u / 255}
            />
          );
        return (
          <SkiaImage
            key={`${i}:${m.version(i)}`}
            image={cache.get(i)}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
          />
        );
      })}
    </>
  );
}

function LiveStroke({ s }: { s: BrushStroke }) {
  const path = useMemo(() => pathOfPoints(s.points), [s.points]);
  const sigma = softnessSigma(s.size, s.softness);
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={s.size}
      strokeCap="round"
      strokeJoin="round"
      color="white"
      opacity={s.opacity}
      blendMode={s.mode === 'erase' ? 'dstOut' : 'srcOver'}
    >
      {sigma > 0.01 ? <BlurMask blur={sigma} style="normal" respectCTM /> : null}
    </Path>
  );
}

/** "#RRGGBB" + alpha -> rgba(). (A layer's `opacity` would also dim the knock-out inside it, so alpha lives in the colour.) */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** `color` painted only where `children` (alpha) is opaque. */
function Tint({
  color,
  opacity,
  children,
}: {
  color: string;
  opacity: number;
  children: React.ReactNode;
}) {
  return (
    <Group layer>
      <Rect x={-1e6} y={-1e6} width={2e6} height={2e6} color={withAlpha(color, opacity)} />
      <Group layer={<Paint blendMode="dstIn" />}>{children}</Group>
    </Group>
  );
}

function Cutout({ p, tiles, photo }: { p: EditorSceneProps; tiles: number[]; photo: SkImage }) {
  const { doc, overlay } = p;
  return (
    <Group layer>
      <SkiaImage
        image={photo}
        x={0}
        y={0}
        width={doc.width}
        height={doc.height}
        sampling={SAMPLING}
      />
      <Group layer={<Paint blendMode="dstIn" />}>
        <MaskTiles doc={doc} which="mask" tiles={tiles} />
        {overlay.liveStroke ? <LiveStroke s={overlay.liveStroke} /> : null}
      </Group>
    </Group>
  );
}

function SuggestionHighlight({ s, doc, color }: { s: Suggestion; doc: EditorDoc; color: string }) {
  const a = doc.analysis;
  const [l, t, r, b] = s.bbox;
  const img = useMemo(() => alpha8Image(s.region, r - l, b - t), [s, l, t, r, b]);
  return (
    <Tint color={color} opacity={0.6}>
      <SkiaImage
        image={img}
        x={l * a.kx}
        y={t * a.ky}
        width={(r - l) * a.kx}
        height={(b - t) * a.ky}
      />
    </Tint>
  );
}

export function EditorScene(p: EditorSceneProps) {
  const { doc, view, box, mode, overlay, accent, danger } = p;
  const tiles = visibleTiles(doc, view, box);
  const photo = doc.pyramid.forScale(view.scale);
  const transform = [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }];
  const px = 1 / view.scale; // one screen px in photo units

  const background =
    mode === 'checker-light' || mode === 'checker-dark' ? (
      <CheckerboardColors
        width={box.w}
        height={box.h}
        a={CHECKER_COLORS[mode].a}
        b={CHECKER_COLORS[mode].b}
      />
    ) : mode === 'white' ? (
      <Fill color="#FFFFFF" />
    ) : mode === 'black' || mode === 'mask' ? (
      <Fill color="#000000" />
    ) : mode === 'color' ? (
      <Fill color={p.color} />
    ) : (
      <Fill color="#202020" />
    );

  let body: React.ReactNode;
  if (mode === 'mask') {
    body = (
      <Group transform={transform}>
        <Tint color="#FFFFFF" opacity={1}>
          <MaskTiles doc={doc} which="mask" tiles={tiles} />
          {overlay.liveStroke ? <LiveStroke s={overlay.liveStroke} /> : null}
        </Tint>
      </Group>
    );
  } else if (mode === 'removed-red') {
    body = (
      <Group transform={transform}>
        <SkiaImage
          image={photo}
          x={0}
          y={0}
          width={doc.width}
          height={doc.height}
          sampling={SAMPLING}
        />
        <Group layer>
          <Rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            color={withAlpha('#FF1F3D', 0.6)}
          />
          <Group layer={<Paint blendMode="dstOut" />}>
            <MaskTiles doc={doc} which="mask" tiles={tiles} />
            {overlay.liveStroke ? <LiveStroke s={overlay.liveStroke} /> : null}
          </Group>
        </Group>
      </Group>
    );
  } else if (mode === 'before-after') {
    const cx = Math.min(box.w, Math.max(0, p.compareX));
    body = (
      <>
        <Group clip={{ x: 0, y: 0, width: cx, height: box.h }}>
          <Group transform={transform}>
            <SkiaImage
              image={photo}
              x={0}
              y={0}
              width={doc.width}
              height={doc.height}
              sampling={SAMPLING}
            />
          </Group>
        </Group>
        <Group clip={{ x: cx, y: 0, width: box.w - cx, height: box.h }}>
          <Group transform={transform}>
            <Cutout p={p} tiles={tiles} photo={photo} />
          </Group>
        </Group>
        <Rect x={cx - 1} y={0} width={2} height={box.h} color={accent} />
      </>
    );
  } else {
    body = (
      <Group transform={transform}>
        <Cutout p={p} tiles={tiles} photo={photo} />
      </Group>
    );
  }

  return (
    <>
      {background}
      {body}
      <Group transform={transform}>
        {doc.hasSelection ? (
          <Tint color={accent} opacity={0.45}>
            <MaskTiles doc={doc} which="selection" tiles={tiles} />
          </Tint>
        ) : null}
        {overlay.suggestion ? (
          <SuggestionHighlight s={overlay.suggestion} doc={doc} color="#FF2BD6" />
        ) : null}
        {overlay.outline && overlay.outline.length > 1 ? (
          <>
            <Path
              path={pathOfPoints(overlay.outline)}
              style="stroke"
              strokeWidth={3 * px}
              color="#FFFFFF"
            />
            <Path
              path={pathOfPoints(overlay.outline)}
              style="stroke"
              strokeWidth={1.5 * px}
              color={accent}
            />
          </>
        ) : null}
        {overlay.outline?.map((q, i) => (
          <Circle
            key={i}
            cx={q.x}
            cy={q.y}
            r={(i === 0 ? 7 : 4) * px}
            color={i === 0 ? danger : accent}
          />
        ))}
        {overlay.shape?.kind === 'rect' ? (
          <Rect
            x={overlay.shape.x}
            y={overlay.shape.y}
            width={overlay.shape.w}
            height={overlay.shape.h}
            style="stroke"
            strokeWidth={2 * px}
            color={accent}
          />
        ) : null}
        {overlay.shape?.kind === 'ellipse' ? (
          <Oval
            x={overlay.shape.x}
            y={overlay.shape.y}
            width={overlay.shape.w}
            height={overlay.shape.h}
            style="stroke"
            strokeWidth={2 * px}
            color={accent}
          />
        ) : null}
        {overlay.anchor ? (
          <Circle cx={overlay.anchor.x} cy={overlay.anchor.y} r={6 * px} color={accent} />
        ) : null}
      </Group>
    </>
  );
}

export { TILE };
