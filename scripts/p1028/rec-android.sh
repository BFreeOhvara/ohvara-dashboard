#!/bin/bash
# P1028: cold starts (light, dark) and a reopen from the background on an Android emulator, each as an mp4 in rec/.
set -u
mkdir -p rec
PKG=com.ohvara.portal
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
open_app() { adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
# Warm-up launch, then quit.
open_app; sleep 15; adb shell am force-stop $PKG; sleep 3

rec() { # name, seconds, command...
  local name=$1 secs=$2; shift 2
  adb shell rm -f /sdcard/r.mp4
  adb shell screenrecord --bit-rate 16000000 /sdcard/r.mp4 & local pid=$!
  sleep 1.5
  "$@"
  sleep "$secs"
  adb shell pkill -INT screenrecord; sleep 2; wait $pid 2>/dev/null
  adb pull /sdcard/r.mp4 "rec/$name.mp4" >/dev/null && echo "rec/$name.mp4 $(stat -c%s rec/$name.mp4) bytes"
}
for mode in no yes; do
  name=$([ $mode = yes ] && echo dark || echo light)
  adb shell cmd uimode night $mode; sleep 3
  adb shell am force-stop $PKG; sleep 2
  rec "android-$name-cold" 8 open_app
  adb shell input keyevent KEYCODE_HOME; sleep 3
  rec "android-$name-resume" 4 open_app
done
adb exec-out screencap -p > rec/android-last.png
ls -la rec
