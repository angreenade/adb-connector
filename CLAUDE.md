# ADB Connector — project notes for Claude Code

Windows desktop app (Electron) for any Android device — phones, tablets and watches; the main use case is a **Galaxy Watch over Wi-Fi** (IP + port + pairing code) — with mirroring, shell, apps, files, logcat and quick tools. Current version: **2.6.0** (see `package.json`). Owner: Moshe.

**Rule:** every build gets a new version number in `package.json` (installer is `dist/ADB-Connector-Setup-<version>.exe`) so builds are distinguishable.

## Commands
```
npm install
npm start        # bundle renderer + run the app (dev)
npm run dist     # bundle + build the Windows installer into dist/ (needs Windows, or wine on Linux)
```

## Releasing (auto-update)
Installer = NSIS one-click (per-user, no admin), `ADB-Connector-Setup-<version>.exe`. Updates via `electron-updater` from GitHub Releases of `angreenade/adb-connector` (public repo).
1. Bump `version` in `package.json`, commit.
2. `git push origin main` — a push that changes `package.json` runs `.github/workflows/release.yml` on `windows-latest`, which builds with `npm run dist` and uploads installer + `latest.yml` + blockmap to Release `v<version>` with `gh release` (creates the release/tag). Versions whose release already has `latest.yml` are skipped. (Tag pushes are blocked through the cloud session's git proxy, so the workflow doesn't rely on them.)
Installed apps check 5 s after start and every 4 h; the bottom-left rail button (`src/renderer/update.js`) shows version / Update / % / Restart. IPC: `update-state|check|download|install`, event `update-state`. Unsigned → SmartScreen warning on first install only.
`npm run bundle` = esbuild `src/renderer/app.js` → `src/renderer/bundle.js` + `bundle.css` (always re-bundle after renderer edits; `bundle.*` are generated but committed so the app runs without a build step).

## Layout
- `src/main.js` — main process: adb wrapper, device polling/grouping, connect/pair, install (APK/split/.apks/.xapk/.apkm, downgrade flow), files, screenshots/recording, external scrcpy, **embedded mirror** (scrcpy-server protocol), PTY shell, logcat, app names/icons/library/history, all IPC handlers.
- `src/apkmeta.js` — reads app label + icon from an APK without the SDK (binary AndroidManifest, resources.arsc, adaptive/vector icons → SVG).
- `src/preload.js` — exposes `window.api` (camelCase of every IPC channel name in its `names` list — add new channels there).
- `src/renderer/` — `index.html`, `styles.css`, `core.js` (helpers, icons, dialogs, store, `ops(dev)` unified device ops), `webadb.js` (WebUSB device with the same ops), `mirror.js` (WebCodecs H.264 player + scrcpy control messages), `app.js` (router), `pages/*.js` (devices, overview, apps, files, screen, controls, shell, logcat, settings).
- `vendor/platform/` — scrcpy 3.3.1 win64 (includes adb.exe). Packed as `resources/platform`, copied at runtime to `%LOCALAPPDATA%\ADB Connector\tools-<version>`.
- `build/` — icon + `afterPack.js` (resedit sets exe icon/version, since `signAndEditExecutable: false`).
- `tests/` — Linux/WSL simulator + Playwright Electron tests (see below).

User data (`app.getPath('userData')`): `settings.json`, `known-devices.json`, `log.txt` (first thing to ask for when something fails on the real watch), `appcache/` (icon/label cache), `library/` (kept APKs + `index.json` with items and history).

## Key decisions / gotchas
- **Hebrew UI (`src/renderer/i18n.js`):** the UI source stays English. With `settings.lang === 'he'` a MutationObserver translates every text node and `title`/`placeholder`/`aria-label` by exact match in the `HE` dictionary, then regex `PATTERNS` for dynamic strings; `dir="rtl"`. Elements matching `SKIP` (code, terminal, app labels, device names, file names, logcat…) are never translated. A translation ending in U+2060 swallows the following space (Hebrew prefix letters like ב/ל). When adding UI text, add its Hebrew to `HE` (or a pattern); check with a crawl for leftover Latin text. Language switch reloads the window (cached in localStorage for no flash).
- **One device, two adb entries:** the watch shows as `IP:port` and as an mDNS `adb-…_adb-tls-connect._tcp` name. Devices are grouped by `ro.serialno` (`id = 'sn:…'`); `sameDevice()` in core.js handles the temporary-id switch. Don't key UI state by raw serial.
- **Disconnect robustness:** grace period before "disconnected", `busySerials` keeps devices alive during operations, `withDevice()` waits and retries once on transient errors (TRANSIENT regex).
- **Pairing:** `adb pair`, then the connect port is found via mDNS or a port scan (30000–60999, skipping the pairing port); manual port as fallback.
- **Embedded mirror:** push `scrcpy-server` to `/data/local/tmp/scrcpy-server.jar` (`ensureServer()` re-checks it exists — scrcpy's cleanup deletes it), `adb forward tcp:P localabstract:scrcpy_<scid hex>`, `app_process … Server 3.3.1 tunnel_forward=true send_dummy_byte=true video_codec=h264 audio=false control=true`. Video socket: dummy byte, 64-byte name, 12-byte codec meta, then packets (8-byte pts w/ bit63 config, bit62 key; 4-byte size). Second socket = control. Renderer decodes Annex B with WebCodecs (config prepended to key frames). Live view (no mirror) = periodic screenshots, by design (saves watch battery). Square frame, not round.
- **External scrcpy window on Windows:** launched through a small VBS (`sh.Run c, 0`) — `windowsHide` breaks the SDL window.
- **Non-ASCII paths (Hebrew folders):** adb on Windows can't handle them → files are staged through ASCII temp copies (`stageAscii`, `needsAscii`).
- **Shell:** PTY via `adb shell -t -t`, then `set +o emacs; set +o vi` so long lines wrap (mksh's line editor showed only the last row and froze). Long/multi-line commands from the command box are pushed as a script and sourced. Pasted `adb shell …` lines are normalised.
- **Downgrade:** since Android 12 `-d` only works for debuggable apps → on `INSTALL_FAILED_VERSION_DOWNGRADE` offer "keep data" (`pm uninstall -k`) or "remove everything", then install.
- **App names:** `scrcpy-server … list_apps=true cleanup=false` → `parseAppList()` (name padded to column 30; names ≥30 chars put the package on the next line). Cached 10 min per device. Fallback: label from the APK, then a guess from the package name. Setting `apps.showPkg` toggles package names.
- **App icons:** `pm list packages -f` → APK path → `exec-out unzip -p <apk> AndroidManifest.xml|resources.arsc|<icon>` (fallback: pull APK ≤80 MB) → `apkmeta.readAppMeta`. Cached on disk by sha1(pkg|apkPath). Loaded lazily per visible row (IntersectionObserver).
- **Library/History:** every successful install from the computer and every "Save APK" is copied into `userData/library/<pkg>/<version>-<hash>/` (deduped by content hash); history keeps install/downgrade/uninstall/saved events (max 1000).
- **Delivery:** before 2.5.0 the portable exe was sent in parts + a join .bat (kill the running exe first — a locked exe made the old version launch silently). From 2.5.0 on: GitHub Releases + auto-update.

## Tests (simulator)
`tests/sim/adb` is a fake adb (Node) with a fake device (`bin/devtool` + symlinks), fake scrcpy server streaming `watch.h264`, install scenarios (`FLAP_DURING_INSTALL=ip|all`, "old" APK → downgrade, "bad" → signature mismatch), `FAKE_SCRCPY_FAIL`, app list and APK paths. Linux/macOS/WSL only (uses `sh`).
```
cd tests/sim && ./setup-sim.sh
xvfb-run -a node e2e.js            # 49 checks
xvfb-run -a node mirror-test.js    # 29
xvfb-run -a node shell-test.js     # 15
xvfb-run -a node downgrade-test.js # 3
xvfb-run -a node bundle-test.js    # xapk/obb
xvfb-run -a node apps-test.js      # 21 (needs real APKs: tests/sim/termux-new.apk = Termux 0.118.3, tests/sim/newpipe.apk = NewPipe 0.27.6; setup copies one as the Relink app)
node ../meta-test.js some.apk      # label/icon parser on any APK
```
Needs `npm i -D playwright` (uses Electron from node_modules). Last full run: all suites green on 2.4.0.

## Not verified on the real watch yet
App names via `list_apps` and icons via `unzip -p` on Wear OS — if they don't show, check `log.txt` for `list_apps gave nothing` / `appMeta`.
