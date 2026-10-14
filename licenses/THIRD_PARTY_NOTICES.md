# Third-party software

ADB Connector itself is under the MIT License (see `LICENSE`). It includes the following
third-party software, each under its own license. Full license texts are in the `licenses/`
folder, which is also installed with the app (Settings → About → Open-source licenses).

| Component | Files | License | Source |
|---|---|---|---|
| scrcpy 3.3.1 — © 2018 Genymobile, © 2018-2025 Romain Vimont | `scrcpy.exe`, `scrcpy-server` | Apache-2.0 | https://github.com/Genymobile/scrcpy |
| Android Debug Bridge (adb), from the Android Open Source Project, as shipped in the scrcpy 3.3.1 Windows release | `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` | Apache-2.0 | https://android.googlesource.com/platform/packages/modules/adb |
| FFmpeg (LGPL build, no GPL parts) | `avcodec-61.dll`, `avformat-61.dll`, `avutil-59.dll`, `swresample-5.dll` | LGPL-2.1-or-later | https://ffmpeg.org — build configuration: scrcpy 3.3.1 `app/deps` |
| dav1d (inside `avcodec-61.dll`) — © VideoLAN and dav1d authors | | BSD-2-Clause | https://code.videolan.org/videolan/dav1d |
| SDL2 — © Sam Lantinga | `SDL2.dll` | zlib | https://libsdl.org |
| libusb | `libusb-1.0.dll` | LGPL-2.1-or-later | https://libusb.info |
| Electron and Chromium | the app runtime | MIT and others | https://electronjs.org — see `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the installed app |
| JavaScript packages (xterm.js, ya-webadb, adm-zip, electron-updater, qrcode and their dependencies) | inside the app | MIT, ISC, BlueOak-1.0.0, Python-2.0 | listed with full texts in `licenses/npm-packages.txt` |
| Material icons (icon shapes) | inside the app | Apache-2.0 | https://fonts.google.com/icons |

The LGPL libraries are separate, unmodified DLL files loaded at run time; you may replace them
with your own builds. Their source code is available from the links above (FFmpeg and libusb
releases matching the scrcpy 3.3.1 build).

Android, Wear OS and Galaxy Watch are trademarks of their respective owners. ADB Connector is
an independent project and is not affiliated with or endorsed by Google or Samsung.
