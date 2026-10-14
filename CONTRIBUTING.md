# Contributing

Thanks for helping improve ADB Connector!

## Reporting a bug or idea
Open an [issue](https://github.com/angreenade/adb-connector/issues/new/choose). For bugs, include the
app version (bottom left of the app), the device, how it's connected, and the last lines of the log
(Settings → About → Open log file). Security problems: please use the private route in [SECURITY.md](SECURITY.md).

## Working on the code
```
npm install
npm start        # runs the app
```
- The interface is plain JavaScript in `src/renderer/` (bundled with esbuild by `npm start` / `npm run bundle`);
  the Electron main process is `src/main.js`.
- Interface text is written in English; when you add text, also add its Hebrew translation in
  `src/renderer/i18n.js`.
- There is a simulated device and end-to-end tests in `tests/sim/` (Linux, macOS or WSL) — see the
  test list in `CLAUDE.md`. Please run the tests that touch your change.

## Pull requests
- Keep each pull request to one change, and describe what it does and how you tested it.
- Don't change the version number — the maintainer does that when releasing.
- By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
