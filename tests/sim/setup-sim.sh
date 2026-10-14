#!/bin/sh
# Run once (Linux, macOS or WSL) before the tests: creates the fake device commands.
cd "$(dirname "$0")"
chmod +x adb bin/devtool
for c in am cmd df dumpsys getprop input logcat monkey pidof pkill pm reboot screencap screenrecord service setprop settings svc wm; do ln -sf devtool bin/$c; done
# a real APK for the "Relink" app so its icon test has something to read (any APK works)
[ -f termux-new.apk ] && cp -f termux-new.apk root/app/app.relink.apk
[ -f newpipe.apk ] && cp -f newpipe.apk root/app/com.example.watchface.apk
echo '{}' > state.json
echo "Simulator ready. Run e.g.:  xvfb-run -a node apps-test.js"
# watched-folder test: a folder with the real APKs (termux twice to check duplicates are merged)
mkdir -p apkdir/sub && [ -f termux-new.apk ] && cp -f termux-new.apk apkdir/ && cp -f termux-new.apk apkdir/sub/termux-copy.apk; [ -f newpipe.apk ] && cp -f newpipe.apk apkdir/sub/
