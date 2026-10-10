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

## Image loading and file APIs (found by reading library source)
- Images are decoded via `expo-file-system` bytes (`lib/loadImage.ts`), **not `Skia.Data.fromURI`**: on Android that native call returns without
  ever resolving or rejecting when a file cannot be opened, which would hang the UI on a deleted library item.
- `expo-file-system`'s `copy()`/`move()` are async; the library uses `copySync()`/`moveSync()`. A fake filesystem that keeps the sync/async split
  (`src/testing/fakeFileSystem.ts`) backs `libraryFiles.test.ts`; mutating the code back to the async calls makes that test run crash.

## Patched dependency (found by the first CI build)
`app/patches/onnxruntime-react-native+1.24.3.patch` (applied by `patch-package` on `npm install`/`npm ci`): (1) the package's Gradle script used
`VersionNumber`, which Gradle 9 removed, so the Android build failed to configure; (2) it resolved the ONNX Runtime Android library as
`latest.integration` (1.31 today), which would not match the 1.24.3 JS API, so it is pinned to 1.24.3. Remove the patch if a newer package fixes both.

## Scan mode (text recognition)
- **Engine: Google ML Kit Text Recognition v2** through `@react-native-ml-kit/text-recognition@2.0.0` (MIT wrapper). The *bundled* models are used (`com.google.mlkit:text-recognition*`), so it
  works offline and needs no Google Play services and no network. ML Kit itself is **not open source**: it is free under Google's ML Kit terms, which is fine for a personal app but is a
  different licence class from the rest of the stack (noted in-app under Settings > Licences). The wrapper ships Latin, Chinese, Devanagari, Japanese and Korean models, which makes the APK
  noticeably larger; only Latin and Devanagari are exposed in the UI. Alternatives considered: Tesseract (open source, but clearly weaker on photos), PaddleOCR on ONNX Runtime
  (open, and the runtime already works here, but needs a detector, recogniser and a lot of post-processing code I cannot validate on a phone), cloud OCR (violates the no-network rule).
- **Formatting is geometry based** (`scan/format.ts`, unit tested): paragraph breaks from vertical gaps, headings from larger or all-caps standalone lines, list markers (`- • * o 1. a)`) and nesting from left offset,
  soft-wrapped sentences re-joined only when a line runs to the right margin and the next starts lower-case (hyphenated breaks repaired). Notebook pages are mostly one thought per line, so it keeps line breaks otherwise.
- **Two-column pages** (found with a real notebook photo): ML Kit returns blocks in its own order, which mixed the columns of a formula sheet. `scan/layout.ts` finds the vertical gutter between columns
  (ignoring full-width titles), then reads each column top to bottom, left before right, with titles acting as separators. Lines that the recogniser split from one visual row (a label and its
  expression) are re-joined. Pages without a gutter keep the recogniser's order. Tested with a layout modelled on that photo.
- **Faint pencil on tinted paper:** before recognition the page is converted to grey and contrast-stretched between its 2nd and 98th luminance percentile (`scan/enhance.ts`, Skia, tested on real pixels).
  Only the recogniser sees the boosted copy; the saved photo is unchanged. On by default, switchable in Settings and Retry.
- Photos are capped at 3072 px on the long edge for Scan (text needs more pixels than a cut-out).
- Scan results are `scan` rows in the same library table; `result_uri` is the markdown file, `thumb_uri` a JPEG thumbnail, `original_uri` the page photo. Edits in the editor are saved to the file after 700 ms.
- Same lazy-load safety as the ONNX runtime: a missing native module becomes a readable error, not a crash. A built-in diagnostics sample page checks real recognition on the device (Settings > Run diagnostics).

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

## Cut-out edge tightening and lasso eraser
- The model's mask is feathered, so dark objects photographed in dim light kept a light rim of background. After upscaling, the mask goes through an alpha ramp (Skia colour filter, no JS pixel loops). Settings has Soft / Normal / Tight (default Normal); Refine has a one-tap "Tighten edge" for an existing result.
- Refine gained a Lasso tool: draw around an unwanted part (a logo or tag) and the enclosed area is erased, as a filled-path stroke so undo/redo and export work as before.

# Phase 1.5 (pro cut-out editor)

## M0: what the failing test photo taught us (and what changed)
A black watch on a dark laptop gave a bad cut-out, an RGB export, a 328 px file and a clipped crown. Reproduced with synthetic fixtures
(`app/test/fixtures/`) through the real export path (`src/__tests__/milestone0.test.tsx`):
- **Clipped crown: reproduced and fixed.** `objectBoundsOf` measured bounds on a 256 px probe render; a 1 px feature vanished at that scale
  so the auto-crop cut it off (bounds right edge 1120 instead of 1595 on the fixture). Bounds are now measured on the full-resolution mask with
  an exact early-exit scan (`maskBoundsExact`, alpha floor 2 of 255), and a test proves every mask pixel survives the crop and that the 4 % padding is on all sides.
- **Small output: reproduced in design and fixed.** Earlier decision "the working size cap is the image size" meant the photo (and the export)
  was re-encoded at <= 2048 px before anything else. That decision is **reversed**: `preparePhoto` keeps an upright full-resolution original
  (bounded to 24 MP, with a visible warning above that, never silently) and makes a separate working copy only for the model. The mask is
  upscaled to the original size; `export size = original` means the photo's own size. A 1200x800 photo with a 300 px cap now exports at 1200x800;
  a real 4000x3000 render exports at 4000x3000. Library thumbnails stay <= 320 px by design (they are previews); I could not tie the reported
  328 px file to anything else in the code, a thumbnail is the only 320-ish px PNG the app writes.
- **Not transparent / black fill: NOT reproduced.** In Node with real Skia the transparent export, the saved file and the thumbnail are RGBA PNGs with
  alpha 0 outside the object and in holes, and nothing is filled with black. I cannot see what a phone's GPU path does. Defences added anyway:
  (1) `assertPixelsTransparent` decodes the bytes about to be saved and refuses the export if there are no transparent pixels (a header saying RGBA
  is not proof), if everything is transparent, or if the size is wrong; (2) PNG/WebP sources are no longer flattened into JPEG on import (that turned
  transparent input pixels black before the model saw them). If the real phone still produces an RGB file, the new gate will refuse to save it and
  say so, which will point at the exact stage.
- Mask storage: an Alpha_8 image encodes to an 8-bit grey+alpha PNG and decodes with alpha intact (probed on CanvasKit), so masks can be stored compactly.
  CanvasKit cannot `readPixels` into Alpha_8, so pixel reads go through RGBA in small tiles.

## M1: data model
- **Mask = 8-bit coverage at photo resolution**, held as 512x512 tiles (`mask/tiledMask.ts`). A tile that is one value is stored as a single number, so
  an empty 4000x3000 mask costs nothing and a typical one a few MB. The mask file (`results.mask_uri`) is an Alpha_8 image encoded by Skia as an 8-bit
  grey+alpha PNG; opening it reads each tile back (`mask/maskImage.ts`), never a whole-image RGBA copy in JS.
- **Undo/redo = per-tile diffs** (`mask/history.ts`): each step stores RLE-compressed before/after bytes of only the tiles it changed (50 steps, oldest dropped).
  Tested: 60 random edits, exact mask equality after every undo and redo; a 60x60 dab on a 12 MP mask costs under 4 KB of history. History lives in an
  in-memory registry keyed by item (added with the editor), so it survives leaving and re-entering the editor within a session, not an app restart.
- **DB v2** (`db/migrations.ts`): `results` gains `mask_uri`, `original_width/height`, `edit_state_json`, `status`; new `batches`, `batch_items`, `presets`.
  Existing rows are back-filled (mask uri from `settings_json`, photo size = old size). Tested against real SQLite (sql.js) from a v1 database.
- **Edit state** (`edit/editState.ts`): transform, shadow, background, canvas, preset id, refinement settings and a mask revision as defensively-parsed JSON;
  the export is always rendered from original + mask + this state.
- Pipeline now keeps the mask as an Alpha_8 image (1 byte/pixel) at photo size.

## M2-M5: the editor (replaces Refine)
- **Pixel work is Skia, per 512 px tile** (`editor/tileOps.ts`): the tile's coverage is drawn into a small surface, the edit is composited with a blend mode
  (erase = dstOut, restore = srcOver, intersect = dstIn, invert = Xor with an opaque rect) and read back. Brush strokes, selections (lasso / polygon / rectangle /
  ellipse / wand / region), add / subtract / intersect / invert, feather (blur), grow and shrink (dilate / erode image filters) all go through it. JavaScript
  only touches pixels for the colour read-back of one tile, the analysis on the 1 MP working copy, and the matting band (below). Every change is an
  `EditSession` step in the tile-diff history.
- **Tap select (wand)** runs a Lab-colour flood fill on a <= 1024 px working copy (`editor/wand.ts`; tolerance, contiguous, edge-aware stop on strong colour steps,
  "current cut-out only"). The result is upsampled to photo size and **snapped to the real edges** by the matting step on each touched tile. Measured in Node/V8
  (not a phone number): whole-image fill on 1 MP = ~110 ms. The 300 ms target on a 12 MP photo on a phone is **unmeasured**.
- **Matting** (`editor/matting.ts`): trimap (eroded mask = sure foreground, outside the dilated mask = sure background, band between), local foreground/background
  colour from integral images, alpha from the colour line, trusted only when the two colours differ (a dark product on a dark scene keeps the model alpha), then
  colour decontamination. It loops over band pixels only. Chosen over a Skia runtime shader / Kotlin module because neither could be run or tested here; the loop cost is
  proportional to the object's perimeter, not the image area. Tested: edge error drops by more than 60 % on a blurred, oversized mask; green halo on a red object is removed.
- **Smart brush** (`editor/smartBrush.ts`): per brush position, a flood fill confined to the brush circle collects pixels near the colour under the centre that are not behind a
  strong edge; the stroke is multiplied by that matte. The live preview during the stroke is the plain brush; the matte is applied when the finger lifts.
- **Clean-up suggestions** (`editor/suggest.ts`) are heuristics and are never applied silently: detached specks, attached blobs (parts that survive a morphological
  opening as separate pieces and differ in colour or model confidence), holes (enclosed opaque pixels that match the old background colour, or that the model was
  unsure about) and pin-holes. Tested on the strap-with-8-openings, logo-on-a-neck, dark-on-dark and solid-object fixtures.
- **Gestures** (`editor/gestures.ts`) are a pure state machine with its own tests: one finger edits, two fingers always pan/zoom and cancel a half-drawn stroke, fingers lifting one at a time never resume drawing.
  Double tap toggles fit / 100 % in every tool except the freehand brush and lasso (they start drawing on touch down; use Hand or the Fit control there).
- **View modes** include removed-area-in-red, mask only, before/after (slider) and a press-and-hold "Before"; the default checkerboard contrasts with the product's brightness;
  the last mode is remembered. Rendering was checked pixel by pixel offscreen (found and fixed two Skia pitfalls: a layer `opacity` also dims knock-outs inside it, and Alpha_8 images draw black unless used as a mask).
- Zoom reaches 16x (1600 %); the photo is drawn from a mip chain (`editor/pyramid.ts`); a mini-map appears when zoomed in.
- Not done in this pass: stylus hover (React Native gives no hover events without a native module).

## M6: edge refinement at full resolution
Segment small, resolve big: the model's mask (320 px for u2netp) is upscaled to the photo, then `editor/refine.ts` works tile by tile (512 px tiles with an overlapping margin, so no seams: tested
equal to refining the whole mask at once within 2/255) -> matting (trimap + local colour line against the real photo pixels) -> shift (dilate/erode) -> smooth (blur + re-threshold) -> soften (blur).
The uncertain band must cover how wrong the upscaled mask can be (about the upscale factor), so the pipeline passes `bandRadiusForUpscale(photo / mask size)`. Measured on a synthetic oversized, blurred mask: mean edge
error 0.50 -> 0.04 with a sufficient band, and only 0.60 -> 0.39 with a band that is too narrow (that is why the band follows the upscale ratio).
Colour decontamination for the final mask replaces edge colours with the estimated true foreground colour (`decontaminationPatches`: opaque tile patches drawn over the photo before the mask is applied; the photo
file is never modified). Measured in the exported PNG on a red product on green: edge green excess 90 -> 2 (255 scale). Settings (softness / shift / smooth / fine detail / clean edge colours) are stored in
`edit_state_json` and applied at export; the Edge tool previews them. Per-pixel JS loops run only over the edge band (matting, decontamination); shift / smooth / soften are Skia image filters. No speed claim is made for a phone.

## M7-M9: compose, shadow, backgrounds, presets, readiness
- **Premultiplied resampling.** The cut-out is built once at photo resolution (`compose/cutout.tsx`: photo x mask, plus decontaminated edge patches, cropped to the product's tight bounds)
  into one premultiplied RGBA image; rotation, flip, scaling, shadow and reflection resample *that*. Resampling photo and mask separately mixed the replaced background's colour into rotated edges
  (measured: edge red 185/255 instead of 220); with the premultiplied cut-out the 30 degree rotation test keeps edge colours at the product red (test: no dark or light fringe).
- **Canvas model** (`compose/layout.ts`): `Original` = the product's own pixels 1:1 plus padding (never enlarged, never downscaled); fixed shapes / custom sizes fit the product at the preset's target fill
  ratio times the user's scale. Position, rotation (snaps to 0 / 90 / 180 / 270 within 3 degrees), flip, scale and nudge are stored as fractions in the edit state and applied at export, so everything is non-destructive.
  Gestures on the preview: one finger moves (sticks to the centre lines with guides), two fingers pinch, twist and pan.
- **Shadows and reflection** are drawn from the product's own alpha: contact (blurred ellipse under the base), drop (Skia drop-shadow filter), natural (both), plus an optional faded floor reflection. On a transparent canvas they end up as
  semi-transparent dark pixels in the PNG's alpha channel (tested); on white / colour / gradient backgrounds they show as expected (tested).
- **Gradients are drawn from a ramp image, not a gradient shader.** CanvasKit in the Node test environment rejects RN-Skia's gradient colour arrays, and an untestable path is not acceptable here; a 256-step ramp image drawn stretched is exact, renders
  identically everywhere and is covered by pixel tests. (Found along the way: RN-Skia's `<Image>` defaults to `fit="contain"`, which silently letterboxes a non-square strip; the code now sets `fit="fill"`.)
- **Output formats.** PNG always keeps alpha when the background is transparent (the written file is decoded and checked, see M0). JPEG presets force an opaque background (white) and lower the quality step by step to fit a size limit
  (floor 40); if the limit still cannot be met the export says so instead of silently shrinking the picture.
- **Presets** (`presets/`): plain data in the `presets` table, seeded from `presets/seed.json` the first time (square white 2000x2000 JPEG, portrait 4:5 on white, transparent PNG at original size), fully editable, duplicable, deletable.
  The README and the editor say these values are starting points: platform rules differ and change, no platform claim is hard-coded.
- **Readiness checker** (`readiness/checks.ts`, `analyze.tsx`): background purity (border pixels vs. the preset colour), fill ratio, centring and margins (edge contact is a failure), resolution vs. preset and photo enlargement, sharpness
  (variance of the Laplacian over product pixels, not judged for flat colours), exposure clipping, leftover specks / attached pieces, unfilled holes (from the clean-up analysis of the final mask), transparency / opaque background, file size.
  Fixes are one tap where a fix exists ("Centre and scale to 85 %", "Use PNG") or open the editor. Thresholds are starting points calibrated on synthetic images only (sharp checker 102400 vs. smooth gradient 2.3 variance), **not tuned on real photos**.
- **Consistent framing for a set** (`compose/framing.ts`): the same fill ratio, horizontal centre and baseline for every product (tested with a wide item, a tall bottle and a rotated square).

## M10: batch mode
- A batch is rows in `batches` / `batch_items` (up to 50 photos). `BatchRunner` (`batch/queue.ts`) writes every state change (queued, processing, done, needs_review, failed) to SQLite *before* moving on, processes one or two photos at a time
  (two is the cap: memory, not speed, is the limit), supports cancel (the interrupted photo goes back to the queue), retry, and resume. Tested with a simulated app kill: a runner whose process never settles is abandoned, a new runner on the same
  database re-queues the item left "processing" and finishes the batch. The state shown (running / paused / done / needs review / failed) is derived from the items, never stored separately.
- One photo (`batch/process.ts`): cut out -> save to the library -> run the clean-up analysis -> apply the preset and the batch framing (same fill ratio, centre or shared baseline) to its edit state. Anything found by the analysis, or "nothing detected", sets
  `needs_review`; the cut-out itself is never changed by a finding. The review screen steps through only those (open in editor / looks fine / skip).
- Export: file names from a template (`{name} {sku} {index} {preset}`, sanitised, unique, 80 char cap); destination is the gallery or a folder picked with the Android directory picker (`Directory.pickDirectoryAsync`). "Share as a set" is **one share sheet per file**:
  sharing several files at once on Android needs a native module this app does not have (listed in WEAKNESSES.md).

## M11: capture guidance and light enhancement
- **New native dependency: `expo-sensors@57.0.3`** (MIT, pinned). Accelerometer: level indicator (upright: roll line; flat on a table: bubble) and a steadiness meter; ambient light sensor: low-light warning (below 40 lux). Every sensor is optional: a missing one just hides its hint.
- **What expo-camera cannot do, and what the app does instead.** It exposes no focus-point API and no frame access. So: *tap to focus* is a ring plus a request to refocus (best effort, not a point focus); *blur* and *dark/light product* are judged on the photo right after the shot
  (or a gallery pick) on a 256 px copy (`capture/quality.ts`: 99th-percentile edge gradient for blur; centre-of-frame brightness for "Dark product? Place it on a light surface" and the reverse), shown with Retake / Use photo. No tip means no extra tap.
  A live "centre of the frame is dark" hint would need a frame processor (a native module); it is listed in WEAKNESSES.md.
- **Auto exposure / white balance** (`enhance/`): luma percentiles (1 % / 99 %, minimum span) and gray-world gains on mid-tones, clamped (gains 0.8-1.25, stretch <= 2.2), blended by a 0..1 strength into one 4x5 colour matrix (strength 0 = identity, tested).
  It is applied with a Skia colour filter to the model's working copy; the matrix is saved in the edit state and applied to the exported picture only if "Also apply to the exported picture" is on.

## M12: optional engines
- **HD engine over the LAN** (`engine/remoteEngine.ts`, contract in `docs/GOLESYNC_SEGMENT_ENDPOINT.md`). `RemoteEngine implements ImageEngine`; `FallbackEngine` tries it first and silently uses the on-device model on any failure
  (unreachable, timeout, 401, 413, 429/503, malformed answer) except a user cancel. Disabled by default (Settings, "HD engine"). It is the **only** file allowed to use the network: `project.test.ts` fails the build if `fetch(` or an
  http(s) URL appears anywhere else, and checks that the address guard runs before any request. The guard (`isLanUrl`) only accepts private IPv4 (10/8, 172.16/12, 192.168/16), link-local, loopback, `localhost` and `*.local`; a typed address
  without a scheme gets `http://`. Tested with a fake fetch (no real laptop was involved, the reference server in the contract doc has not been run against the app).
  **Manifest consequence:** plain http to a LAN IP needs `usesCleartextTraffic` on Android, which `expo-build-properties` now sets. That permits cleartext to any host at the OS level; the app code still refuses non-LAN addresses.
  The `INTERNET` permission was already present (Metro, debug); `RAGO_BLOCK_INTERNET=1` still strips it for a build that can never touch the network (and then the HD engine cannot work).
- **AI Smart Select: NOT included, flag off** (`features.ts`). The candidate is MobileSAM (Apache-2.0; TinyViT image encoder plus a prompt decoder, roughly 40 MB of weights as the ONNX pair). I could not fetch any SAM-class ONNX model in this
  environment (Hugging Face returns 403 through the sandbox proxy, GitHub release/raw paths for the exporters 404/403), so I could verify neither its input/output names, nor its size, nor any timing, let alone speed on a mid-range phone,
  which is the bar. Bundling an unverified 40 MB model and a decoder wired from memory would break the rule not to claim what was not run. The rest of the editor does not need it: tap select, region, lasso, smart brush and clean-up suggestions cover the Dell-logo case.

## Scan text layouts and symbols (post v0.2.0)
- **Reversed: Markdown is no longer the default.** Scan output used to be Markdown only. It is now plain text by default, with three layouts the user can switch
  after scanning: **Plain** (one line per recognised line), **Paragraphs** (wrapped prose joined, blank line between paragraphs, maths lines never glued together) and **Markdown**
  (`##` headings, `-` bullets, for developers and note apps). All three are stored with the scan so the layout can be changed again when it is reopened. Saved file: `.txt` (`.md` when saved as Markdown).
  Switching layout over edited text asks first. "Copy plain" only appears in Markdown layout; Copy and Share send exactly what is on screen.
- **Bigger headings:** plain text cannot carry a font size, so there is an Edit / Preview toggle; the preview draws headings larger. Headings come from the scan's Markdown layout, matched line by line, so it still works after edits elsewhere.
  A rich export (PDF or HTML with real heading sizes) would need a new native dependency (e.g. `expo-print`) and is not included.
- **Symbols:** two real causes of lost symbols were fixed in our code: a leading `+`, `-`, `*` or `>` on a maths line was treated as a list marker and dropped. The recogniser itself (ML Kit, built for words) can skip thin
  symbols such as `=`; that cannot be fixed in our code. Instead, on lines that look like maths, a wide gap between two words with no operator between them is marked `□` and the user is told how many spots are marked. **The app never guesses the symbol.**
  A quick-insert symbol row (= ≠ ≈ + − × ÷ ± ^ / < > ≤ ≥ ( ) √ π ∞ ∑ ∫ ² ³ ° % →) is under the editor. A real formula reader needs a maths-capable model (not included).
