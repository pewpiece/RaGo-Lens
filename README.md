<p align="center">
  <img src="app/assets/branding/icon.png" alt="RaGo Lens logo" width="160">
</p>

# RaGo Lens

A personal Android app (Expo React Native, TypeScript) that removes the background from a photo of an object **entirely on the phone**
and exports a transparent PNG. No accounts, no backend, no analytics, no network calls.

**Two modes:** **Cutout** (remove a background, export a transparent PNG) and **Scan** (photo of a notebook page to editable, formatted text). Both run fully offline.

> **Status: built and tested in a sandbox without an Android device.** Unit/integration tests, lint and typecheck pass, `expo prebuild` and the Metro
> bundle succeed, and the model was checked on a desktop. The APK itself has not been built or run yet. Read
> [`WEAKNESSES.md`](WEAKNESSES.md) before trusting it, and run [`docs/DEVICE_TEST_CHECKLIST.md`](docs/DEVICE_TEST_CHECKLIST.md) on your phone.

## What it does
Capture or pick a photo (or share one into the app) -> on-device segmentation -> checkerboard result with hold-to-compare ->
optional Refine brush (erase/restore, size, softness, zoom/pan, undo/redo, non-destructive) -> export as PNG
(transparent / white / colour / soft shadow, auto-crop, 2048 / 1024 / original) -> save to gallery, share or copy. Results live in a private
Library (SQLite + app storage). Themes: System / Light / Dark.

## Pro cut-out workflow (phase 1.5)
- **Editor** on the full-resolution photo: magic wand, lasso, polygon, rectangle, ellipse, select-by-colour, erase/restore/smart brushes, hold-to-compare, loupe, undo (50 steps).
- **Clean-up suggestions** (logo, specks, holes) are shown and applied only when you accept them.
- **Refine**: matting + colour decontamination, shift, smooth, soften, fine detail.
- **Compose and export**: move/rotate/flip, canvas size and padding, shadows and reflection, solid/gradient backgrounds, marketplace presets, readiness checks, PNG/WebP with true transparency or JPEG on a background. Exports are never silently downscaled.
- **Batch** queue (resumable), **capture guidance** (level, light, framing), optional auto exposure and white balance, optional **LAN HD engine** (off by default).
- Still fully offline; the only network code is the optional LAN engine. Marketplace presets are data and can go out of date; check the platform's current rules.

## Repo layout
```
app/                 Expo project (routes in app/src/app, code in app/src)
  assets/branding/   icon.png, adaptive-icon-foreground.png, splash-icon.png (RaGo buffalo logo)
  assets/models/     u2netp.onnx (downloaded by scripts/fetch-model.sh, not committed)
scripts/             fetch-model.sh + model.env (pinned URL/SHA-256), verify-model/ (desktop model check)
docs/                RELEASING.md (signing + release), DEVICE_TEST_CHECKLIST.md
DECISIONS.md         why things are the way they are (model + licence, Skia, DB, theme contrast...)
WEAKNESSES.md        known gaps, especially what needs a real phone
TEST_OUTPUT.txt      real command output
```
Source map: `engine/` (ImageEngine, ONNX + mock engines, pre/post-processing, Skia pixel ops, pipeline), `scene/` (Skia scene shared by Result, Refine, Export;
export geometry; strokes and view maths), `export/` (options, PNG alpha check, save/share/copy), `library/`, `db/`, `store/`, `theme/`, `modes/` (mode registry), `app/` (screens).

## Run it
Requirements: Node 22, Java 17+ and the Android SDK (only for local device builds).
```bash
./scripts/fetch-model.sh          # downloads u2netp.onnx and verifies its SHA-256 (required before bundling)
cd app
npm ci
npm run lint && npm run typecheck && npm test
npx expo prebuild --platform android      # generates app/android (git-ignored)
npx expo run:android                      # needs a device/emulator + Android SDK
```
Expo Go cannot run this app (native ONNX Runtime, Skia, share intent): use a dev build / `expo run:android`.
Without the model file Metro fails to bundle (the model is a static `require`); run the fetch script first. To try the UI without the model,
fetch it anyway and flip **Settings > Developer > use mock engine**.

Desktop model check (WASM runtime, uses the app's real pre/post-processing; not the phone):
```bash
cd scripts/verify-model && npm install && npx tsx verify.ts photo.jpg cutout.png
```

## Release an APK
Push a tag `vX.Y.Z`; GitHub Actions builds, signs and publishes the APK to a Release. One-time setup (keystore + 4 secrets) is in
[`docs/RELEASING.md`](docs/RELEASING.md): `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
Optional hardening: build with `RAGO_BLOCK_INTERNET=1` to strip the INTERNET permission (untested on a device, see WEAKNESSES.md).

## Swap the model
The app depends only on the `ImageEngine` interface (`app/src/engine/types.ts`). To use a different ONNX model:
1. Update `scripts/model.env` (`MODEL_URL`, `MODEL_SHA256`, `MODEL_SIZE`; keep the filename or update the `require` in `app/src/engine/modelAsset.ts`).
2. Check the model's licence permits your use and update `app/src/about/licenses.ts` and `apache2.ts` (the licence text shipped in-app) and `DECISIONS.md`.
3. Confirm input/output names and shape with `scripts/verify-model` (it prints them). If the model uses a different input size or normalisation, change
   `MODEL_INPUT_SIZE`/`MODEL_MEAN`/`MODEL_STD` in `engine/preprocess.ts` and the output handling in `engine/onnxEngine.ts`; `engine/postprocess.ts` expects a roughly 0..1 saliency map.
4. Run `scripts/verify-model` on a few photos and the device checklist.
A user-importable model file (from storage) is not built yet but the engine takes its path from a function (`modelPath`), so it is a small change.

## Scan mode
Photo of a notebook page (camera or gallery or shared in) -> Google ML Kit text recognition on the phone -> structure -> editable Markdown with
headings, bullet and numbered lists, nesting and paragraphs. Copy (Markdown), Copy plain, Share, and results are saved in the Library (a `scan` item with the photo, a `.md`
file and a thumbnail). English/Latin and Devanagari can be chosen in Settings or with Retry. Printed text and neat handwriting work best; messy handwriting will be unreliable, and maths notation (exponents, fractions) is not supported. Two-column pages are read column by column and faint pencil gets a contrast boost before reading.
Code: `app/src/scan/` (engine wrapper, formatter, pipeline) and `app/src/app/scan.tsx`.

## Modes registry
`app/src/modes/registry.ts` lists modes (id, title, accent token, route, engine). Capture, library, export/share, theme and settings are mode-agnostic and library rows carry a `mode` column.

## Licences
App code: yours to license. Model: U²-Net-P, Apache 2.0 (text shipped in the app). Dependencies are permissively licensed; see each package.
