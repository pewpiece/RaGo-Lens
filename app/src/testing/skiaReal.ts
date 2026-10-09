/**
 * Test helper: the REAL Skia drawing API and declarative renderer running on CanvasKit (WASM) in Node.
 * Use with the Skia jest environment:
 *
 *   /** @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js *\/
 *   jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());
 *
 * Offscreen surfaces use CPU raster (there is no GPU in Node); results are pixel-exact for what we test.
 */
export function skiaReal() {
  // Silence "not wrapped in act()" noise from Skia's internal reconciler.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const { JsiSkApi } = jest.requireActual('@shopify/react-native-skia/lib/module/skia/web');
  const api = JsiSkApi((globalThis as { CanvasKit?: unknown }).CanvasKit);
  api.Surface.MakeOffscreen = (w: number, h: number) => api.Surface.Make(w, h);
  (globalThis as { SkiaApi?: unknown }).SkiaApi = api;
  return {
    ...jest.requireActual('@shopify/react-native-skia/lib/module/skia'),
    ...jest.requireActual('@shopify/react-native-skia/lib/module/renderer/components'),
    drawAsImage: jest.requireActual('@shopify/react-native-skia/lib/module/renderer/Offscreen')
      .drawAsImage,
  };
}
