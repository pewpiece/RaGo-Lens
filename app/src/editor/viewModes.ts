/** How the cut-out is shown while editing, so dark and light products can always be judged. */
export type ViewMode =
  | 'checker-light'
  | 'checker-dark'
  | 'white'
  | 'black'
  | 'color'
  | 'removed-red'
  | 'mask'
  | 'before-after';

export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'checker-light', label: 'Light checker' },
  { id: 'checker-dark', label: 'Dark checker' },
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
  { id: 'color', label: 'Colour' },
  { id: 'removed-red', label: 'Removed in red' },
  { id: 'mask', label: 'Mask only' },
  { id: 'before-after', label: 'Before / after' },
];

export const isViewMode = (v: unknown): v is ViewMode => VIEW_MODES.some((m) => m.id === v);

/** Mean brightness (0..1, Rec. 709 on sRGB bytes) of the cut-out, weighted by the mask. 0.5 when nothing is selected. */
export function averageProductLuma(rgba: Uint8Array, alpha: Uint8Array): number {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    if (a === 0) continue;
    const y = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
    sum += y * a;
    wsum += a;
  }
  return wsum === 0 ? 0.5 : sum / wsum;
}

/** The checkerboard that contrasts with the product: a dark product is shown on the light one, and the reverse. */
export const checkerFor = (luma: number): 'checker-light' | 'checker-dark' =>
  luma < 0.5 ? 'checker-light' : 'checker-dark';

/** Fixed (theme independent) checker colours, so a product's contrast does not depend on the app theme. */
export const CHECKER_COLORS = {
  'checker-light': { a: '#FFFFFF', b: '#D4D4D8' },
  'checker-dark': { a: '#3A3A40', b: '#1E1E22' },
} as const;
