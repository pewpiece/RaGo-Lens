# Known weaknesses and untested areas

Written honestly: **I could not build or run this app on an Android device or emulator.** The build sandbox has no Android SDK
(`dl.google.com` is unreachable) and no phone. Everything below is either untested on a device or a known limitation.
"Untested on device" means exactly that: no claim is made about it.

## Highest risk: could stop the app from building or starting
1. **The APK has never been built.** `release.yml` (prebuild, Gradle, zipalign/apksigner, GitHub Release) has never run. What I did
   verify: `expo prebuild --platform android` succeeds and produces the right manifest (CAMERA, `SEND image/*` filter, package
   `dev.rago.lens`, ONNX Runtime wired into `build.gradle`); `expo export` produces a Hermes bundle with the model asset. The
   Gradle/NDK compile step, including ONNX Runtime's native C++ (JSI) library against React Native 0.86, is **unverified**.
   Expect that the first CI run may need a fix.
2. **ONNX Runtime on-device behaviour is untested**: module install under the new architecture, loading the model from the
   APK resources via `expo-asset` (I read its native code but did not run it), the first-run copy, and session creation time.
3. **Inference speed and memory are unmeasured on a phone.** The only timing I have is desktop WASM (about 1.3 to 2.2 s for the 320x320 model), which says
   nothing about phones. No speed or memory claim is made.
4. **Placeholder logo files** are in `app/assets/branding/`; replace them with your real ones.

## Model quality
- Verified on only two desktop test photos (a car on a street, a tiger on a plain background): both cut-outs looked clean. That is not a
  benchmark. **Real quality on a laptop, bottle, plant, shiny object, low light is untested.**
- `u2netp` is the small U²-Net variant. Expect weaker results on shiny/transparent objects (bottles, glass), hair and fur edges, low contrast between object and background,
  and photos with several competing objects (it picks "salient" things, not "the object you meant").
  The mask is predicted at 320x320 and upscaled with soft edges, so fine detail (thin stems, wires) is lost; Refine exists for this.
- If a better model is wanted later, swap the file (README) and re-check I/O names; only a model with the same preprocessing is drop-in.

## Behaviour that needs a real device
- **Camera** (`expo-camera`): preview, shutter, flash, permission prompt flow, EXIF/rotation of captured photos. App is portrait-locked.
- **Skia on screen**: rendering is tested pixel-for-pixel on CanvasKit (CPU raster), not on the phone's GPU backend. The checkerboard, `DstIn`
  layer compositing, shadow and live brush overlay *should* render identically, but nobody has looked at it on a screen.
  **I have never seen this UI rendered**; layout, spacing and tap targets are untested visually (tests assert structure and behaviour only).
- **Refine gestures**: pinch/pan/brush use `PanResponder`. The maths is unit tested; the feel, multi-touch handoff (second finger lands
  mid-stroke), brush cursor alignment and performance with many strokes are untested. Strokes stay live (not baked) until Done, so a
  very long session on a 3072 px image may slow down.
- **Memory**: a 2048x1536 working image is about 12.6 MB per Skia surface and a few are alive at once (photo, mask layer, composite, export).
  Larger caps (3072) on low-RAM phones may run out of memory. OOM is caught and reported with a "lower the working size" message, but not
  tested on a device.
- **Share-into-app** (gallery Share to RaGo Lens): intent filter is generated; cold-start and already-running behaviour, and `content://` URIs, are untested.
- **Save to gallery / Share / Copy image**: permission flow (`expo-media-library` write-only), `expo-sharing` FileProvider, and especially
  **whether the receiving app keeps transparency** (some galleries show transparent PNGs on black or white). The saved file is verified to
  contain an alpha channel before it is handed over, but the on-phone path is untested. Clipboard image copy depends on the target app.
- **Cancel** cannot interrupt ONNX Runtime mid-inference; the run finishes and the result is discarded.
- **Theme**: System mode follows `Appearance`; I did not check the status bar and navigation bar colours on-device. The splash screen background is
  fixed brand dark (`#0E1116`) in both themes.

## Scan mode
- Verified in CI on an emulator only (real ML Kit on a printed sample page); **not tried on a real notebook photo or on handwriting**. Messy cursive and mixed languages will often come out wrong. Always re-read the result.
- Devanagari recognition is exposed but untested on real Devanagari pages. Mixed Latin + Devanagari pages need a Retry with the other setting.
- The formatter guesses structure from line positions. Skewed or curved pages, photos taken at an angle, and notebooks with ruled lines running through the text can produce wrong headings, merged lines or wrong nesting. The text is editable for that reason.
- ML Kit is proprietary (free under Google's terms) and bundles five script models, so the APK is larger than the cut-out alone needed.
- No export to a file yet: Copy, Copy plain and Share (text) only.

## Product limits (by design or time)
- Android only (min SDK 26). iOS is not configured (share extension disabled).
- Library has no search/sort/pagination (loads all rows). Single-item delete is via multi-select (long press).
- Input photos are re-encoded to JPEG for processing, so a PNG with transparency is flattened before cut-out. Very large photos (50 MP+) depend on how
  `expo-image-manipulator` decodes them; not tested.
- Accessibility labels/roles are set, but TalkBack was never run.
- "Retry with different settings" only offers the working-size cap (the engine choice is a Settings developer toggle).
- Output size "original" means the working-size image (<= cap, default 2048), not necessarily the camera's full 12 MP.
- The release APK declares the `INTERNET` permission (React Native default) although the app never uses the network;
  `RAGO_BLOCK_INTERNET=1` strips it but that variant is untested on a device.
- Model provenance caveat (see DECISIONS.md): the ONNX file is rembg's re-export of U²-Net-P; verified by hash, I/O and behaviour, not byte-matched to the upstream PyTorch weights.
- The third-party licence list in the app is a summary, not an inventory of every transitive dependency.

## What *is* verified (see `TEST_OUTPUT.txt`)
Lint and typecheck clean; all tests pass (count in `TEST_OUTPUT.txt`), including real-Skia pixel tests (known mask gives known alpha, DstIn compositing, brush erase/restore,
soft edges, shadow, auto-crop geometry, size caps, PNG alpha detection and encoding round-trip), real-SQLite migrations and repository tests,
ONNX engine tests with a fake runtime, cancellation/error paths, theme/settings stores and screen flows (denied permissions, failed saves, OOM, retry).
