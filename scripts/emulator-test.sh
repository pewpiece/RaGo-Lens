#!/usr/bin/env bash
# Runs inside the Android emulator (CI). Installs the APK, opens each screen through its deep link and reports
# whether the app survives, printing the crash log when it does not. Output is meant to be read from the CI log.
set -u
APK="$1"; PKG=dev.rago.lens
adb wait-for-device
adb install -r "$APK" || { echo "INSTALL FAILED"; exit 1; }
adb shell pm grant $PKG android.permission.CAMERA || true
curl -sSL -o /tmp/car.jpg https://raw.githubusercontent.com/danielgatis/rembg/main/examples/car-1.jpg
adb push /tmp/car.jpg /sdcard/Download/car.jpg >/dev/null

crash_report() {
  echo "----- CRASH LOG for $1 -----"
  adb logcat -d -v threadtime | grep -E "FATAL EXCEPTION|AndroidRuntime|Fatal signal|SIGSEGV|SIGABRT|backtrace|#0[0-9] pc|ReactNativeJS|UnsatisfiedLink|dev.rago.lens|onnx|skia|libc  " | grep -v "ActivityManager: Start\|ProcessRecord" | tail -80
  echo "----- END CRASH LOG -----"
}

summary=""
for route in "" capture settings licenses library processing result refine export; do
  adb shell am force-stop $PKG
  adb logcat -c
  if [ -z "$route" ]; then
    adb shell am start -n $PKG/.MainActivity >/dev/null
  else
    adb shell am start -a android.intent.action.VIEW -d "ragolens://$route" $PKG >/dev/null
  fi
  sleep 10
  if adb shell pidof $PKG >/dev/null 2>&1 && [ -n "$(adb shell pidof $PKG)" ]; then
    status=ALIVE
  else
    status=DEAD
  fi
  echo "ROUTE /${route}: $status"
  summary="$summary\n/${route}: $status"
  adb exec-out screencap -p > "/tmp/shot-${route:-home}.png" 2>/dev/null || true
  [ "$status" = DEAD ] && crash_report "/${route}"
done

# Full on-device pipeline check: real model inference + Skia compositing + transparent PNG export
adb shell am force-stop $PKG
adb logcat -c
adb shell am start -a android.intent.action.VIEW -d "ragolens://selftest" $PKG >/dev/null
selftest=TIMEOUT
for i in $(seq 1 60); do
  sleep 3
  if adb logcat -d -v brief | grep -q "SELFTEST \(PASS\|FAIL\)"; then selftest=done; break; fi
  if [ -z "$(adb shell pidof $PKG)" ]; then selftest=DIED; break; fi
done
echo "SELFTEST RESULT: $selftest"
adb logcat -d -v brief | grep -E "SELFTEST|FATAL|AndroidRuntime|Fatal signal|SIGSEGV|ReactNativeJS" | tail -40
if [ "$selftest" = DIED ]; then crash_report "selftest"; fi
summary="$summary\nselftest: $selftest ($(adb logcat -d -v brief | grep -o 'SELFTEST \(PASS\|FAIL\)[^\n]*' | tail -1))"

# Real flow: share an image into the app (what the gallery Share button does)
adb shell am force-stop $PKG
adb logcat -c
adb shell am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM file:///sdcard/Download/car.jpg -n $PKG/.MainActivity >/dev/null
sleep 15
if [ -n "$(adb shell pidof $PKG)" ]; then status=ALIVE; else status=DEAD; fi
echo "SHARE-INTENT FLOW: $status"
summary="$summary\nshare-intent flow: $status"
adb exec-out screencap -p > /tmp/shot-share.png 2>/dev/null || true
echo "----- ReactNativeJS / errors during share flow -----"
adb logcat -d -v threadtime | grep -E "ReactNativeJS|FATAL|AndroidRuntime|Fatal signal|SIGSEGV|UnsatisfiedLink|OrtApi|onnx" | tail -60
[ "$status" = DEAD ] && crash_report "share flow"
adb logcat -d -v threadtime > /tmp/full-logcat.txt
printf "\n===== SUMMARY =====%b\n" "$summary"
