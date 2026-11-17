#!/bin/bash
# P1028: same recording as rec-android.sh, against a running local emulator, for one apk.
#   bash scripts/p1028/rec-android-local.sh <apk> <label> <outdir>
set -u
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep /sdcard/... as is
APK=$1 LABEL=$2 OUT=$3
ADB=${ADB:-adb}
PKG=com.ohvara.portal
mkdir -p "$OUT"
$ADB uninstall $PKG >/dev/null 2>&1
$ADB install -r "$APK" | tail -1
open_app() { $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
open_app; sleep 15; $ADB shell am force-stop $PKG; sleep 3
rec() { # name, seconds, command...
  local name=$1 secs=$2; shift 2
  $ADB shell rm -f /sdcard/r.mp4
  $ADB shell screenrecord --bit-rate 16000000 /sdcard/r.mp4 & local pid=$!
  sleep 1.5
  "$@"
  sleep "$secs"
  $ADB shell pkill -INT screenrecord; sleep 2; wait $pid 2>/dev/null
  $ADB pull /sdcard/r.mp4 "$OUT/$name.mp4" >/dev/null && echo "$OUT/$name.mp4"
}
for mode in no yes; do
  name=$([ $mode = yes ] && echo dark || echo light)
  $ADB shell cmd uimode night $mode; sleep 3
  $ADB shell am force-stop $PKG; sleep 2
  rec "android-$LABEL-$name-cold" 8 open_app
  $ADB shell input keyevent KEYCODE_HOME; sleep 3
  rec "android-$LABEL-$name-resume" 4 open_app
done
