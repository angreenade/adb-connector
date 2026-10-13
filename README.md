# ADB Connector

A simple Windows app for Android devices — made for connecting a **Galaxy Watch over Wi-Fi** (IP, port and pairing code) without the command line.

- Pair and connect over Wi-Fi (code or QR), USB, or WebUSB
- Screen mirroring inside the app (or in a separate scrcpy window), screenshots and recording
- Install apps (.apk, split APKs, .apks / .xapk / .apkm), including older versions
- App list with real names and icons, permissions, and a library of every app you installed, with history
- File browser, a full shell, logcat, quick commands by category

## Download
Get **ADB-Connector-Setup-x.y.z.exe** from [Releases](https://github.com/angreenade/adb-connector/releases/latest). After installing, the app updates itself — look at the button at the bottom left.

Windows may say "Windows protected your PC" the first time (the app isn't code-signed): click **More info → Run anyway**.

## Build
```
npm install
npm start
```
Includes scrcpy 3.3.1 and Android platform tools (`vendor/platform`).
