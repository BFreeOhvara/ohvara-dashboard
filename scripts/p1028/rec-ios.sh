#!/bin/bash
# P1028: cold starts (light, dark) and a reopen from the background on an iOS simulator, each as an mp4 in rec/.
set -u
mkdir -p rec
UDID=$(xcrun simctl list devices available | grep -E '^ +iPhone 1[5-9]( Pro)? \(' | head -1 | grep -oE '[0-9A-F-]{36}')
echo "Simulator $UDID"; xcrun simctl list devices available | grep "$UDID"
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b
APP=$(ls -d build/Build/Products/Release-iphonesimulator/*.app | head -1)
xcrun simctl install "$UDID" "$APP"
ID=com.ohvara.portal
# Warm-up launch (first launch after install does one-off work), then quit.
xcrun simctl launch "$UDID" $ID; sleep 12; xcrun simctl terminate "$UDID" $ID; sleep 3

rec() { # name, seconds, command...
  local name=$1 secs=$2; shift 2
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "rec/$name.mp4" & local pid=$!
  sleep 1.5
  "$@"
  sleep "$secs"
  kill -INT $pid; wait $pid 2>/dev/null
  echo "rec/$name.mp4 $(stat -f%z rec/$name.mp4 2>/dev/null) bytes"
}
for mode in light dark; do
  xcrun simctl ui "$UDID" appearance $mode; sleep 2
  xcrun simctl terminate "$UDID" $ID 2>/dev/null; sleep 2
  rec "ios-$mode-cold" 7 xcrun simctl launch "$UDID" $ID
  # Reopen from the background: another app comes to the front, then the app again.
  xcrun simctl launch "$UDID" com.apple.Preferences; sleep 3
  rec "ios-$mode-resume" 4 xcrun simctl launch "$UDID" $ID
done
xcrun simctl io "$UDID" screenshot rec/ios-last.png
ls -la rec
