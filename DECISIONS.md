# Decisions

Choices made while building Phase 1 (Cutout mode) without asking questions. Newest context first inside each section.

## Layout
- **Expo project lives in `app/`** (the brief names `app/assets/branding/` and `app/assets/models/`). Repo root holds `scripts/`,
  `docs/`, `.github/` and these notes. Routes are in `app/src/app/` (Expo Router); everything else is under `app/src/`.
- **Expo SDK 57 / React Native 0.86 / React 19.2 / TypeScript 6 (strict)**, new architecture on. These were the versions the
  `create-expo-app` template resolved to today. All dependencies are **pinned to exact versions** (see `app/package.json`) and the
  lockfile is committed. `expo install` could not reach Expo's API from the build sandbox, so SDK-compatible versions were
  taken from `expo/bundledNativeModules.json`.
- **No Reanimated / Gesture Handler / worklets.** The only gesture surfaces are the refine canvas (pinch, pan, brush) and a
  slider, and both are small enough for `PanResponder` plus tested pure math (`scene/viewTransform.ts`). Fewer native modules,
  fewer things that can fail to build.

## Pixel work: Skia, not a Kotlin module
`@shopify/react-native-skia` does all resampling, mask upscaling, alpha compositing, drop shadows, auto-crop rendering and
PNG encoding (`engine/skiaOps.ts`, `scene/exportRender.tsx`). Reasons:
1. No per-pixel JS over full-resolution images. The only JS pixel loops touch the 320x320 model tensor (about 100k px) and a
   256 px mask probe used to find the object bounds.
2. One declarative scene (`scene/CutoutTree.tsx`) draws the result, the refine view, the export preview and the exported PNG,
   so what you see is what you export.
3. **It is testable here.** Skia ships a CanvasKit (WASM) Jest environment; `src/testing/skiaReal.ts` runs the real Skia API and the
   real declarative renderer in Node, so the compositing, brush, shadow, crop and alpha tests assert real pixels instead of mocks.
A Kotlin module would have meant writing, building and debugging native code that I cannot run in this sandbox.

Non-destructive editing: the photo is never modified. The model's mask is upscaled into a white RGBA **mask layer** (alpha =
mask). Refine strokes are an overlay on that layer (`erase` = `dstOut`, `restore` = `srcOver`, soft edge = blur mask filter).
The cut-out is `photo x mask` using `DstIn` in an isolated layer. "Done" bakes the strokes into a new mask layer; "Reset" and
"Cancel" drop them.

## Segmentation model
| | |
|---|---|
| Model | **U²-Net-P** (`u2netp`), salient object segmentation, ONNX |
| Source URL | `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx` (release `v0.0.0` of the rembg project) |
| Size | 4,574,861 bytes |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Licence | **Apache License 2.0**: the U²-Net repository (`github.com/xuebinqin/U-2-Net`, `LICENSE` is Apache 2.0, checked) covers the code and released weights; rembg itself is MIT |
| I/O (read from the file) | input `input.1` float32 `[1,3,320,320]`; 7 outputs, the first (`1959`, fused map) is `[1,1,320,320]` |

How verified: the file was downloaded in this environment, its SHA-256 recorded above and pinned in `scripts/model.env`
(`scripts/fetch-model.sh` re-verifies it on every download and CI run), and it was run through ONNX Runtime (WASM) with the app's own TypeScript
pre/post-processing on two real photos (`TEST_OUTPUT.txt`). **Caveat:** the file is the rembg project's ONNX re-export. I could
not independently tie it byte-for-byte to the upstream PyTorch weights; I rely on rembg's publication and the Apache licence of
U²-Net. Verified this way, not just trusted: it loads, has the documented I/O, and produces sensible masks.
It is **not committed** (git-ignored); `scripts/fetch-model.sh` downloads and checks it, and CI runs that before building.
Pre-processing follows U²-Net's own `ToTensorLab`: divide by the image max, subtract ImageNet mean, divide by std, NCHW, 320x320 stretch.
Post-processing: min-max normalise, smoothstep soft threshold (0.12 to 0.88), 3x3 box blur, to 8-bit, then bilinear upscale in Skia.

The full Apache-2.0 text ships inside the app (Settings > About > View licences) because the model is redistributed in the APK.

Swappable by design: `ImageEngine` interface (`engine/types.ts`), `OnnxSegmentationEngine`, `MockEngine`. To use another
model see README "Swap the model".

## Runtime: onnxruntime-react-native
`onnxruntime-react-native@1.24.3` (JSI build). CPU execution provider only (no NNAPI): predictable and avoids vendor driver bugs.
It runs inside the native module, so inference never blocks the JS or UI thread. **It cannot abort a run in flight**, so cancel
takes effect between pipeline stages and a finished result is discarded (documented in the engine and UI behaviour).
The model is bundled as a Metro asset (`onnx` added to `assetExts`). On Android release builds React Native places it in
`res/raw` and `expo-asset` copies it to the cache on first use (`engine/modelAsset.ts`); I read expo-asset's native source
to confirm that path exists but could not run it on a device.

## Image handling and the "working size cap"
- Photos are first normalised into an upright JPEG whose **long edge is capped** (default 2048, choices 1024/1536/2048/3072,
  clamp 512 to 4096) via `expo-image-manipulator` (`engine/imagePrep.ts`). This applies EXIF rotation and bounds decode memory, so a 12 MP photo is never held at
  full size by this app's own code.
- "Original resolution" in the brief therefore means "the working-size image". The mask is applied to that full working-size
  image, never the other way round. "Original" output size = working size; 2048 / 1024 only shrink, never upscale.
- Export is **PNG only**. Transparent and shadow exports are verified: the PNG is re-read from disk and its IHDR colour type
  (or tRNS chunk) must show an alpha channel, otherwise the export is refused (`export/png.ts`, `export/actions.ts`).

## Share intent
**`expo-share-intent@8.0.1`**: the only maintained option I found that (a) has an Expo config plugin that works with
`expo prebuild`, (b) supports SDK 57, (c) registers the Android `SEND image/*` intent filter and (d) exposes a React hook.
Android only: `disableIOS: true` (its iOS share extension needs extra Xcode tooling and this app is Android-only). Found and fixed by
running `expo prebuild`: without `disableIOS` the plugin crashes on a missing `ios.bundleIdentifier`.

## Data
- `expo-sqlite` + **Drizzle** for typed queries (`results`, `settings`). Migrations are **hand-written, append-only SQL tracked
  with `PRAGMA user_version`** (`db/migrations.ts`) rather than drizzle-kit's generated bundle, to avoid a build-time
  codegen/babel step. They are tested against a real SQLite (sql.js) including rollback and "newer database" refusal.
- `results.settings_json` also stores `maskUri` so a library item can be re-opened and refined later; `mode` is a column for Phase 2.
- Library files (photo copy, result PNG, thumbnail, mask PNG) live in the app's private document directory. Saving checks free
  space first (`LowStorageError`); a failed library save never loses the on-screen result (a notice is shown).

## Theme
Tokens per theme in `theme/tokens.ts`; System (default) / Light / Dark persisted in SQLite and applied live (also sets the OS
`Appearance` so native chrome follows). Accent for Cutout is orange (`#FF8A3D` on dark, deepened to `#B84A06` on light for
contrast); a teal `accentScan` token is reserved for Scan. Fonts: system sans for UI; a `mono` token is defined for Phase 2 text results.
Contrast measured (WCAG 2.x) and enforced by `tokens.test.ts`:

| pair | dark | light |
|---|---|---|
| text / background | 17.46 | 16.25 |
| muted text / surface-raised (worst) | 6.78 | 6.20 |
| accent / background | 8.06 | 4.89 |
| onAccent / accent | 8.06 | 5.22 |
| onAccentScan / accentScan | 10.16 | 5.22 |
| danger / background or surface (worst) | 6.78 | 6.12 |
| control outline (`borderStrong`) / worst surface | >= 3.26 | >= 3.36 |

All text pairs are AA (4.5:1) or better. Card hairlines (`border`, about 1.6 to 1.7:1) are decorative, while interactive controls use `borderStrong` (>= 3:1).
Checkerboard greys differ per theme (ratio about 1.25) so soft edges stay judgeable.

## Build and release
- CI (`ci.yml`): fetch model, `npm ci`, lint, typecheck, tests on every push/PR.
- Release (`release.yml`, tags `v*`): same checks, `expo prebuild --platform android`, `./gradlew assembleRelease`, then
  **`zipalign` + `apksigner` with the keystore from `KEYSTORE_BASE64`** and `apksigner verify`, then a GitHub Release.
  Signing after the build (instead of patching `build.gradle`) keeps the generated Android project untouched.
  ABIs are limited to `arm64-v8a,armeabi-v7a` to keep the APK small; add `x86_64` for emulators.
- Secrets and exact `keytool`/`base64` commands: `docs/RELEASING.md`.
- **INTERNET permission:** the RN template declares it. The app makes no network calls (enforced by a test that scans the sources),
  and building with `RAGO_BLOCK_INTERNET=1` strips the permission. It is off by default because dev builds need it and the stripped
  release has not been run on a device.
- Camera permission is requested at use; saving to the gallery asks for write-only access. Storage-read permissions are blocked
  in the manifest; the gallery picker is the system photo picker.
- `expo-media-library` is imported from `expo-media-library/legacy`: in SDK 57 the main entry's `saveToLibraryAsync` throws.

## Branding
Logos were not in the repo when I built. `scripts/make-placeholder-branding.mjs` generated **placeholder** orange-disc PNGs in
`app/assets/branding/` (only for missing files) so builds work. **Replace them with the real files**; `app.json` already
points at `icon.png`, `adaptive-icon-foreground.png`, `splash-icon.png` and the `#0E1116` adaptive background.

## Testing approach
Jest + React Native Testing Library; the Skia pixel tests use real Skia on CanvasKit; DB tests use real SQLite (sql.js);
the model itself is verified with a desktop script (`scripts/verify-model`). See `TEST_OUTPUT.txt` for real output and
`WEAKNESSES.md` for what only a phone can prove.
