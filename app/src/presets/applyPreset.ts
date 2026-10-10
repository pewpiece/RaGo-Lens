import type { EditState } from '@/edit/editState';
import type { Preset } from './presets';

/** The edit state with a preset applied: its canvas, background and shadow kind; position and size reset to "fitted". */
export function applyPresetToEdit(e: EditState, p: Preset): EditState {
  return {
    ...e,
    presetId: p.id,
    canvas: {
      aspect: p.canvas.aspect,
      width: p.canvas.width,
      height: p.canvas.height,
      paddingPercent: p.canvas.paddingPercent,
    },
    background: p.background,
    shadow: { ...e.shadow, kind: p.shadow },
    transform: { ...e.transform, scale: 1, cx: 0.5, cy: 0.5 },
  };
}
