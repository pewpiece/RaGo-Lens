/**
 * Feature flags for work that is built or planned but deliberately not switched on.
 *
 * smartSelect: AI "Smart Select" (a promptable segmentation model, SAM class, with one image embedding per photo and a fast
 * decoder per tap). OFF, and no model is bundled: see DECISIONS.md ("Smart Select") for why. Turning this on does nothing yet.
 */
export const FEATURES = {
  smartSelect: false,
} as const;
