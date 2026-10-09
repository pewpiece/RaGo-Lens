# Manual device test checklist

Run this on a real Android phone with the APK from a GitHub Release. Tick each line and note anything odd
(speed, memory, quality). Take screenshots of failures. **Nothing here has been run yet.**

## 0. Install
- [ ] Install the APK (allow "install unknown apps"). App name "RaGo Lens", your logo as icon, dark splash.
- [ ] First launch does not crash; Home shows the Cutout card active and Scan "Coming soon".
- [ ] Note the phone model and Android version: ______________________

## 1. Cutout on different subjects (use the camera, plain surface, good light unless stated)
For each: note time from shutter to result (stopwatch) and rate the cut-out 1 to 5. Check edges with Hold-to-compare.
- [ ] **Laptop on a desk**: ___ s, quality ___ (screen/keyboard edges; shadows on the desk)
- [ ] **Bottle** (clear and a coloured one): ___ s, quality ___ (transparent glass is expected to be hard)
- [ ] **Plant**: ___ s, quality ___ (leaf edges, thin stems; try Refine)
- [ ] **Shiny object** (metal, phone, jewellery): ___ s, quality ___ (reflections can break the mask)
- [ ] **Low-light shot** (dim room): ___ s, quality ___
- [ ] **Large 12 MP photo** picked from the gallery: ___ s. With the default 2048 cap it must not crash. Then set the cap to 3072 in Settings and try again; note any memory error message.
- [ ] A photo with **no clear subject** (blank wall): Result shows the "No clear object" notice instead of crashing.

## 2. Airplane mode
- [ ] Turn on airplane mode (Wi-Fi and data off). Repeat one cut-out end to end (capture, process, refine, export, share dialog opens). Everything must work.

## 3. Refine
- [ ] Erase: paint over a leftover background area; it disappears. Restore: bring back a missing part.
- [ ] Brush size and softness sliders change the stroke; the on-screen cursor circle matches the stroke width.
- [ ] Two-finger pinch zooms, two-finger drag pans, painting while zoomed lands where the finger is. Starting a stroke then adding a second finger cancels that stroke (no stray mark).
- [ ] Undo / Redo / Reset behave. Cancel with unsaved strokes asks to discard. Done applies; Result and Library thumbnail show the edit.
- [ ] Note any lag with many strokes: ______________

## 4. Export and transparency (the important one)
- [ ] Export "Clear" with Save to gallery. Open the saved image in **Google Photos / Gallery**: transparent areas may look black or white in some viewers; that is the viewer, not the file.
- [ ] **Share the PNG into another app that supports transparency** (a messaging app as a file/document, a sticker or photo editor, or Google Docs). Confirm the checkerboard/transparent area is truly transparent, with no white or black box.
- [ ] Copy image, then paste into another app; note whether transparency is kept: ______
- [ ] White, Colour (pick a swatch) and Shadow backgrounds look as in the preview. Shadow keeps transparency around the soft shadow.
- [ ] Auto-crop on/off and the padding slider change the output size shown under the preview. Size 2048 and 1024 caps work.
- [ ] Deny the gallery permission when asked: you get a clear message and Share still works. Re-run and allow it.

## 5. Library
- [ ] Results appear in Home "Recent" and Library after processing. Tap one: opens Result, Refine still works (non-destructive).
- [ ] Long press selects, tap adds, Delete asks for confirmation and removes the items (files too). Settings > Clear library works.
- [ ] Fill the phone storage (or use a nearly full phone): saving shows a clear low-storage message and the on-screen result still works.

## 6. Theme
- [ ] Settings > Theme: Light, Dark, System switch **instantly** (no restart). System follows the phone's dark mode toggle. Choice survives closing and reopening the app.
- [ ] In Light theme all text is readable; the checkerboard shows the cut-out edge clearly in both themes.

## 7. Share into the app
- [ ] In the gallery, Share a photo to RaGo Lens: it opens and starts processing. Try with the app closed and with it already open.

## 8. Permissions and errors
- [ ] Deny camera permission: explanation appears, "Pick from gallery" works. Deny with "don't ask again": the "Open phone settings" button appears.
- [ ] Press Cancel while processing: returns without a result. Press back during processing: same.
- [ ] Mid-process, send the app to the background and return: no crash.
- [ ] Settings > Developer > mock engine: the cut-out becomes a centre ellipse (UI works without the model); turn it off again.

## Report back
Phone, Android version, times, quality scores, and any crash or blank screen (with what you did just before).
