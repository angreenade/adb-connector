# ADB Connector

A simple Windows app for **any Android device** — phones, tablets and watches (including Galaxy Watch / Wear OS) — over USB or Wi‑Fi, without the command line.

## Download
Get **ADB-Connector-Setup-x.y.z.exe** from [Releases](https://github.com/angreenade/adb-connector/releases/latest) and run it. It installs in seconds (no admin needed) and **updates itself** — watch the button at the bottom left.

Windows may say "Windows protected your PC" the first time (the app isn't code-signed): click **More info → Run anyway**.

## Features
- **Connect** over USB, Wi‑Fi pairing (code or QR), IP address, LAN scan, or WebUSB — and remembers devices and reconnects automatically
- **Screen**: live mirroring inside the app with touch control, full screen, or a separate scrcpy window; screenshots and screen recording
- **Apps**: install .apk, split APKs, .apks / .xapk / .apkm (with game data), install older versions, real app names and icons, permissions, open / stop / clear / disable / uninstall
- **App library & history**: every app you install or save is kept on your computer, any version, reinstall with one click
- **Files**: browse, upload, download, rename, delete
- **Shell**: a full terminal with history, autocomplete and long-command support
- **Logcat** with filters, and **quick commands** by category (display, power, network, developer and more)
- Several devices at once — switch from the top bar

## Connecting a device
Turn on **Developer options** on the device (tap *Build number* 7 times in *About phone* / *About watch*), then:

| How | Device | Steps |
|---|---|---|
| **USB** | Any Android | Turn on **USB debugging**, plug in, tap **Allow** on the device. Some brands need their Windows USB driver (e.g. Samsung, Google). |
| **Wi‑Fi pairing** | Android 11+ and Wear OS | Turn on **Wireless debugging** → *Pair with code* (or QR), enter the IP, port and code in the app. Computer and device must be on the same Wi‑Fi. |
| **Wi‑Fi from USB** | Android 10 and older | Connect by USB once, press **Switch to Wi‑Fi**, then unplug. |

**Notes**
- Mirroring needs Android 5.0 or newer.
- Xiaomi / Redmi / POCO: also turn on **USB debugging (Security settings)** for touch control and permission granting.
- Without root, system apps are removed for the current user only (reversible).

## Build from source
```
npm install
npm start        # run in development
npm run dist     # build the Windows installer
```
Releases are built by GitHub Actions when the version in `package.json` changes. Includes scrcpy 3.3.1 and Android platform tools (`vendor/platform`).
