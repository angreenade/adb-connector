const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const names = [
  'devices', 'connect', 'disconnect', 'reconnect', 'scan', 'pair-code', 'pair-cancel', 'pair-qr-start', 'pair-qr-cancel', 'usb-to-wifi',
  'run', 'run-bytes', 'frame', 'push-text', 'adb-command', 'install', 'install-downgrade','push', 'pull', 'extract-apk',
  'screenshot', 'record-start', 'record-stop', 'scrcpy', 'mirror-start', 'mirror-stop',
  'pty-open', 'pty-write', 'stream-close', 'logcat-open', 'logcat-save',
  'pick-files', 'pick-folder', 'save-file', 'open-file', 'show-file', 'open-folder', 'open-log', 'copy', 'copy-image',
  'app-labels', 'app-meta', 'library-list', 'folders-scan', 'show-folder', 'library-add', 'library-remove', 'library-folder', 'history-add', 'history-clear',
  'update-state', 'update-check', 'update-download', 'update-install', 'open-releases',
  'settings-get', 'settings-set', 'webadb-begin', 'webadb-end', 'adb-version', 'app-version', 'reload-window',
];
const api = {};
for (const n of names) api[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = invoke(n);

api.on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); };
api.pathForFile = (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } };
api.usbChosen = (id) => ipcRenderer.send('usb-chosen', id);
api.mirrorControl = (sid, bytes) => ipcRenderer.send('mirror-control', sid, bytes);

contextBridge.exposeInMainWorld('api', api);
