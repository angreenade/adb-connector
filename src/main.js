// ADB Connector 2 — main process
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

if (!app.requestSingleInstanceLock()) app.quit();

// ───────────────────────── paths & tools ─────────────────────────
const isWin = process.platform === 'win32';
const platformDir = app.isPackaged ? path.join(process.resourcesPath, 'platform') : path.join(__dirname, '..', 'vendor', 'platform');
let ADB = process.env.ADB_PATH || (isWin ? path.join(platformDir, 'adb.exe') : 'adb');
let SCRCPY = process.env.SCRCPY_PATH || (isWin ? path.join(platformDir, 'scrcpy.exe') : 'scrcpy');
const userFile = (n) => path.join(app.getPath('userData'), n);

// The portable .exe unpacks to a temp folder Windows may clean at any time → run tools from a stable copy.
function prepareTools() {
  if (!isWin || process.env.ADB_PATH) return;
  try {
    const base = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'ADB Connector', 'tools-' + app.getVersion());
    fs.mkdirSync(base, { recursive: true });
    const files = fs.readdirSync(platformDir);
    for (const f of files) {
      const src = path.join(platformDir, f), dst = path.join(base, f);
      try { const ss = fs.statSync(src); if (!fs.existsSync(dst) || fs.statSync(dst).size !== ss.size) fs.copyFileSync(src, dst); }
      catch (e) { log('copy tool', f, e.message); }
    }
    const missing = ['adb.exe', 'AdbWinApi.dll', 'scrcpy.exe', 'scrcpy-server', 'SDL2.dll'].filter((f) => !fs.existsSync(path.join(base, f)));
    log('tools at', base, missing.length ? 'MISSING ' + missing.join(',') : 'all present');
    if (fs.existsSync(path.join(base, 'adb.exe'))) ADB = path.join(base, 'adb.exe');
    if (fs.existsSync(path.join(base, 'scrcpy.exe'))) SCRCPY = path.join(base, 'scrcpy.exe');
  } catch (e) { log('prepareTools', e); }
}

// ───────────────────────── logging ─────────────────────────
let logPath = null;
function log(...a) {
  try {
    if (!logPath) { fs.mkdirSync(app.getPath('userData'), { recursive: true }); logPath = userFile('log.txt'); try { if (fs.statSync(logPath).size > 2e6) fs.renameSync(logPath, userFile('log.old.txt')); } catch {} }
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

let win = null;
const send = (ch, data) => { try { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(ch, data); } catch (e) { log('send', e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').trim();
const isIpPort = (x) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(x);
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";   // quote for the device shell
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };

// ───────────────────────── settings ─────────────────────────
const DEFAULTS = {
  theme: 'system', saveDir: '', autoReconnect: true,
  install: { downgrade: false, grant: true, test: true },
  record: { limit: 180, bitrate: 8 },
  scrcpy: { maxSize: 0, bitrate: '8M', fps: 0, stayAwake: true, screenOff: false, onTop: false, fullscreen: false, showTouches: false, noAudio: true, borderless: false, record: false, noControl: false },
  savedCommands: [],
};
let settings = JSON.parse(JSON.stringify(DEFAULTS));
function loadSettings() {
  try { const s = JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')); settings = { ...settings, ...s, install: { ...DEFAULTS.install, ...s.install }, record: { ...DEFAULTS.record, ...s.record }, scrcpy: { ...DEFAULTS.scrcpy, ...s.scrcpy } }; } catch {}
}
function saveSettings() { try { fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2)); } catch (e) { log('saveSettings', e); } }

function outDir(kind) {
  let base;
  try {
    if (settings.saveDir && fs.existsSync(settings.saveDir)) base = settings.saveDir;
    else base = path.join(app.getPath(kind === 'recording' ? 'videos' : kind === 'screenshot' ? 'pictures' : 'downloads'), 'ADB Connector');
  } catch { base = path.join(app.getPath('home'), 'ADB Connector'); }
  const sub = { apk: 'APKs', file: 'Files', log: 'Logs' }[kind];
  const d = sub ? path.join(base, sub) : base;
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// adb on Windows can choke on non-English paths: stage through an ASCII temp path when needed
const needsAscii = (p) => isWin && /[^\x20-\x7E]/.test(p);
const tmpPath = (name) => path.join(os.tmpdir(), `adbc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${name ? '-' + name.replace(/[^\w.-]/g, '_') : ''}`);

// ───────────────────────── adb runner ─────────────────────────
function adb(args, { timeout = 15000, encoding = 'utf8', maxBuffer = 256 * 1024 * 1024, quiet = false } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(ADB, args, { timeout, encoding, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
        const out = encoding === 'buffer' ? stdout : String(stdout || '');
        const errText = String(stderr || (err && err.message) || '');
        if (err && !quiet) log('adb', args.join(' ').slice(0, 200), '→', (errText || String(out)).slice(0, 300));
        resolve({ ok: !err, code: err ? (err.killed ? 'timeout' : err.code) : 0, out, err: errText });
      });
    } catch (e) { log('execFile', e); resolve({ ok: false, out: encoding === 'buffer' ? Buffer.alloc(0) : '', err: e.message }); }
  });
}
const sh = (serial, cmd, opts) => adb(['-s', serial, 'shell', cmd], opts);
const friendly = (r) => clean(r.err || r.out).replace(/^adb(\.exe)?: /i, '').replace(/^error: /i, '').split('\n').slice(-3).join(' ') || 'Something went wrong';

function startServer() {
  return new Promise((resolve) => {
    try {
      const p = spawn(ADB, ['start-server'], { stdio: 'ignore', windowsHide: true });
      const t = setTimeout(() => resolve(false), 20000);
      p.once('error', (e) => { clearTimeout(t); log('start-server', e); resolve(false); });
      p.once('exit', (code) => { clearTimeout(t); resolve(code === 0); });
    } catch (e) { log('start-server', e); resolve(false); }
  });
}

// ───────────────────────── remembered Wi-Fi devices ─────────────────────────
let known = {};
function loadKnown() {
  try {
    const raw = JSON.parse(fs.readFileSync(userFile('known-devices.json'), 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object' && v.ip) out[v.ip] = v;
      else if (isIpPort(k)) { const ip = k.split(':')[0]; out[ip] = { ip, address: k, name: '', lastSeen: v || 0 }; }
    }
    return out;
  } catch { return {}; }
}
const saveKnown = () => { try { fs.writeFileSync(userFile('known-devices.json'), JSON.stringify(known, null, 2)); } catch (e) { log('saveKnown', e); } };
function remember(address, name, watch) {
  if (!isIpPort(address)) return;
  const ip = address.split(':')[0];
  const prev = known[ip] || {};
  known[ip] = { ip, address, name: name || prev.name || '', watch: watch ?? prev.watch ?? false, auto: true, lastSeen: Date.now() };
  saveKnown();
}
const setAuto = (ip, on) => { if (known[ip]) { known[ip].auto = on; saveKnown(); } };
const forgetIp = (ip) => { delete known[ip]; saveKnown(); };

// ───────────────────────── device polling ─────────────────────────
// A physical device can appear twice (IP:port and mDNS name). We group by its serial number
// so the UI sees ONE device with a stable id, and always use a working address for commands.
let groups = [];
let lastJson = '';
const infoCache = new Map();
const infoBusy = new Set();
const infoFailAt = new Map();
let paused = false, polling = false, pollFails = 0;
const offlineSince = new Map();
const busySerials = new Map();
const reconnectingIps = new Set();

const markBusy = (keys, on) => { for (const k of keys) { if (!k) continue; const n = (busySerials.get(k) || 0) + (on ? 1 : -1); if (n > 0) busySerials.set(k, n); else busySerials.delete(k); } };
const isBusy = (...keys) => keys.some((k) => busySerials.has(k));

function connType(serial) {
  if (serial.includes('_adb-tls-connect') || serial.includes('._tcp')) return 'wifi';
  if (serial.startsWith('emulator-')) return 'emulator';
  if (/:\d+$/.test(serial)) return 'wifi';
  return 'usb';
}
const STATE_RANK = { device: 5, authorizing: 4, connecting: 4, unauthorized: 3, recovery: 3, sideload: 3, bootloader: 2, 'no permissions': 1, offline: 0 };

function fetchInfoBg(serial) {
  if (infoBusy.has(serial) || Date.now() - (infoFailAt.get(serial) || 0) < 8000) return;
  infoBusy.add(serial);
  sh(serial, 'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno; getprop ro.build.characteristics; getprop ro.build.version.sdk', { timeout: 8000, quiet: true })
    .then((r) => {
      if (!r.ok) { infoFailAt.set(serial, Date.now()); return; }
      const [manufacturer, model, android, sn, chars, sdk] = r.out.split(/\r?\n/).map(clean);
      infoCache.set(serial, { manufacturer, model, android, sn, sdk: +sdk || 0, watch: /watch/i.test(chars || '') || /^SM-R\d/i.test(model || '') });
      lastJson = ''; poll();
    })
    .finally(() => infoBusy.delete(serial));
}

async function poll() {
  if (paused || polling) return;
  polling = true;
  try {
    const r = await adb(['devices', '-l'], { timeout: 15000, quiet: true });
    if (!r.ok) {
      if (++pollFails >= 3) { send('adb-status', { ok: false, msg: 'ADB is not responding — restarting it…' }); pollFails = 0; log('adb not responding, restarting'); await startServer(); }
      return;
    }
    pollFails = 0;
    send('adb-status', { ok: true });
    const entries = [];
    for (const row of r.out.split(/\r?\n/).map(clean).filter((l) => l && !/^List of devices/i.test(l) && !l.startsWith('*'))) {
      const parts = row.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] === 'no' ? 'no permissions' : (parts[1] || 'unknown');
      const kv = {};
      for (const p of parts.slice(2)) { const i = p.indexOf(':'); if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1); }
      const info = infoCache.get(serial) || null;
      if (!info && state === 'device') fetchInfoBg(serial);
      entries.push({ serial, state, type: connType(serial), model: kv.model ? kv.model.replace(/_/g, ' ') : '', info });
    }
    // group by serial number (one physical device = one entry)
    const byId = new Map();
    for (const e of entries) {
      let id = e.info && e.info.sn ? 'sn:' + e.info.sn : null;
      if (!id) {
        // not identified yet: attach to a Wi-Fi group with the same model so it doesn't flicker as a 2nd device
        const g = [...byId.values()].find((x) => x.type === 'wifi' && e.type === 'wifi' && e.model && x.model === e.model);
        id = g ? g.id : 'serial:' + e.serial;
      }
      if (!byId.has(id)) byId.set(id, { id, type: e.type, model: e.model, entries: [] });
      byId.get(id).entries.push(e);
    }
    // keep ids stable: if a group was known by serial before and is now identified, keep using the sn id
    const out = [];
    for (const g of byId.values()) {
      const ranked = g.entries.slice().sort((a, b) => (STATE_RANK[b.state] ?? -1) - (STATE_RANK[a.state] ?? -1) || (isIpPort(b.serial) - isIpPort(a.serial)));
      const best = ranked[0];
      const info = g.entries.map((e) => e.info).find(Boolean) || null;
      out.push({ id: g.id, serial: best.serial, aliases: g.entries.map((e) => e.serial).filter((s) => s !== best.serial), state: best.state, type: g.type, model: g.model || (info && info.model) || '', info, busy: isBusy(g.id, ...g.entries.map((e) => e.serial)) });
      const ipEntry = g.entries.find((e) => e.state === 'device' && isIpPort(e.serial));
      if (ipEntry) {
        const name = info ? [info.manufacturer, info.model].filter(Boolean).join(' ') : g.model;
        const k = known[ipEntry.serial.split(':')[0]];
        const watch = !!(info && info.watch);
        if (!k || k.address !== ipEntry.serial || (name && k.name !== name) || k.watch !== watch || k.auto === false || Date.now() - (k.lastSeen || 0) > 3600e3) remember(ipEntry.serial, name, watch);
      }
      // stale offline Wi-Fi connections: drop so auto-reconnect can bring the device back — never while busy
      for (const e of g.entries) {
        if (e.type === 'wifi' && e.state === 'offline' && best.state !== 'device' && !isBusy(g.id, e.serial)) {
          if (!offlineSince.has(e.serial)) offlineSince.set(e.serial, Date.now());
          else if (Date.now() - offlineSince.get(e.serial) > 20000) { offlineSince.delete(e.serial); log('dropping stale offline', e.serial); adb(['disconnect', e.serial], { timeout: 4000, quiet: true }); }
        } else offlineSince.delete(e.serial);
      }
    }
    groups = out;
    const presentIps = new Set(entries.map((e) => e.serial).filter(isIpPort).map((s) => s.split(':')[0]));
    const saved = Object.values(known).filter((k) => !presentIps.has(k.ip)).sort((a, b) => b.lastSeen - a.lastSeen)
      .map((k) => ({ id: 'saved:' + k.ip, serial: k.address, ip: k.ip, state: 'saved', type: 'wifi', model: k.name, info: k.watch ? { watch: true, model: k.name } : null, aliases: [], saved: true, busy: reconnectingIps.has(k.ip) }));
    const all = out.concat(saved);
    const json = JSON.stringify(all);
    if (json !== lastJson) { lastJson = json; send('devices', all); }
  } catch (e) { log('poll', e); }
  finally { polling = false; }
}
const groupOf = (k) => groups.find((g) => g.id === k || g.serial === k || g.aliases.includes(k));
function liveSerial(k) { const g = groupOf(k); return g && g.state === 'device' ? g.serial : null; }

// ───────────────────────── mDNS / port scanning ─────────────────────────
async function mdnsServices() {
  const r = await adb(['mdns', 'services'], { timeout: 5000, quiet: true });
  if (!r.ok) return [];
  return r.out.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /:\d+$/.test(p[2])).map(([name, t, address]) => ({
    name, address, ip: address.split(':')[0], type: t.includes('pairing') ? 'pairing' : t.includes('tls-connect') ? 'connect' : 'other',
  }));
}
function probe(host, port, ms = 450) {
  return new Promise((resolve) => {
    let s; try { s = net.connect({ host, port }); } catch { return resolve(false); }
    let fin = false;
    const done = (v) => { if (fin) return; fin = true; try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
  });
}
async function scanPorts(ip, { from = 30000, to = 60999, extra = [5555], concurrency = 600, timeout = 400, isCancelled } = {}) {
  const ports = [...extra]; for (let p = from; p <= to; p++) ports.push(p);
  const open = []; let i = 0;
  const worker = async () => { while (i < ports.length && !(isCancelled && isCancelled())) { const p = ports[i++]; if (await probe(ip, p, timeout)) open.push(p); } };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return open.sort((a, b) => a - b);
}
async function scanLan() {
  const found = [];
  for (const s of await mdnsServices()) if (s.type !== 'other') found.push({ address: s.address, label: s.name, kind: s.type });
  const prefixes = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || [])
    if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) prefixes.add(a.address.split('.').slice(0, 3).join('.'));
  const hosts = []; for (const p of [...prefixes].slice(0, 4)) for (let i = 1; i < 255; i++) hosts.push(`${p}.${i}`);
  let idx = 0;
  const worker = async () => { while (idx < hosts.length) { const h = hosts[idx++]; if (await probe(h, 5555)) found.push({ address: `${h}:5555`, label: 'Classic ADB (port 5555)', kind: 'connect' }); } };
  await Promise.all(Array.from({ length: 96 }, worker));
  for (const k of Object.values(known)) found.push({ address: k.address, label: (k.name || 'Saved device') + ' — last used', kind: 'connect' });
  const present = new Set(groups.flatMap((d) => [d.serial, ...d.aliases]));
  const seen = new Set();
  return found.filter((f) => !seen.has(f.address) && seen.add(f.address)).map((f) => ({ ...f, connected: present.has(f.address) }));
}

// ───────────────────────── connect / pair ─────────────────────────
function parseAddress(input, defPort) {
  const s = clean(input).replace(/\s*[:：]\s*/g, ':').replace(/\s+/g, ':').replace(/^.*?(\d+\.\d+\.\d+\.\d+)/, '$1');
  const m = s.match(/^(\d+\.\d+\.\d+\.\d+)(?::(\d+))?/);
  if (!m) return null;
  const port = m[2] || defPort;
  return port ? `${m[1]}:${port}` : null;
}
async function tryConnect(address, timeout = 10000) {
  const r = await adb(['connect', address], { timeout, quiet: true });
  const text = clean(r.out + ' ' + r.err);
  const ok = /connected to|already connected/i.test(text) && !/failed|cannot|unable/i.test(text);
  log('connect', address, '→', text.slice(0, 160) || r.code);
  return { ok, text };
}
async function waitReady(address, ms = 6000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await adb(['devices'], { timeout: 5000, quiet: true });
    const line = r.out.split(/\r?\n/).find((l) => l.startsWith(address + '\t') || l.startsWith(address + ' '));
    if (line && /\sdevice$/.test(line.trim())) return 'device';
    if (line && /unauthorized/.test(line)) return 'unauthorized';
    await sleep(400);
  }
  return 'unknown';
}
async function connectTo(input) {
  const address = parseAddress(input, '5555');
  if (!address) return { ok: false, msg: 'Enter the IP address and port, e.g. 192.168.1.20:37099' };
  const r = await tryConnect(address, 12000);
  if (r.ok) {
    const st = await waitReady(address, 5000);
    remember(address); lastJson = ''; poll();
    if (st === 'unauthorized') return { ok: true, msg: 'Almost there — tap “Allow” on the device screen.', address };
    return { ok: true, msg: `Connected to ${address}`, address };
  }
  const t = r.text;
  if (/authenticat/i.test(t)) return { ok: false, notPaired: true, msg: 'This device needs to be paired first. Use “Pair with code”.' };
  if (/refused/i.test(t)) return { ok: false, msg: 'Connection refused. Check the port — it changes every time Wireless debugging is turned on.' };
  if (/timed out|failed to connect|no route|unreachable/i.test(t) || !t) return { ok: false, msg: "Couldn't reach the device. Check the IP address and that both are on the same Wi-Fi." };
  return { ok: false, msg: t.replace(/^failed to connect to /i, 'Could not connect to ') };
}
async function findAndConnect(ip, { onStatus, preferred, skipPorts = [], isCancelled } = {}) {
  const status = (s) => { try { onStatus && onStatus(s); } catch {} };
  const attempt = async (address) => {
    const r = await tryConnect(address, 7000);
    if (!r.ok) return null;
    const st = await waitReady(address, 4000);
    if (st !== 'device' && st !== 'unauthorized') { adb(['disconnect', address], { timeout: 3000, quiet: true }); return null; }
    remember(address); lastJson = ''; poll();
    return { ok: true, address, msg: `Connected to ${address}` };
  };
  if (preferred) { status('Trying the last address…'); const r = await attempt(preferred); if (r) return r; }
  status('Looking for the device…');
  for (let i = 0; i < 4 && !(isCancelled && isCancelled()); i++) {
    const svc = (await mdnsServices()).find((s) => s.type === 'connect' && s.ip === ip);
    if (svc) { const r = await attempt(svc.address); if (r) return r; }
    await sleep(600);
  }
  if (isCancelled && isCancelled()) return { ok: false, cancelled: true };
  status('Searching for the connection port (up to 30 seconds)…');
  const open = (await scanPorts(ip, { isCancelled })).filter((p) => !skipPorts.includes(p) && `${ip}:${p}` !== preferred);
  log('scan', ip, 'open ports', open);
  for (const p of open) {
    if (isCancelled && isCancelled()) break;
    status(`Trying port ${p}…`);
    const r = await attempt(`${ip}:${p}`);
    if (r) return r;
  }
  return { ok: false, msg: 'Could not find the connection port automatically.' };
}
let pairJob = null;
async function pairWithCode(addrInput, codeInput) {
  const address = parseAddress(addrInput);
  const code = clean(codeInput).replace(/\D/g, '');
  if (!address) return { ok: false, field: 'addr', msg: 'Enter the IP address and port shown under “Pair new device”, e.g. 192.168.1.235:37011' };
  if (code.length !== 6) return { ok: false, field: 'code', msg: 'The pairing code has 6 digits' };
  if (pairJob) pairJob.cancelled = true;
  const job = { cancelled: false }; pairJob = job;
  send('pair-status', { text: 'Pairing…' });
  let r = await adb(['pair', address, code], { timeout: 25000 });
  let text = clean(r.out + ' ' + r.err);
  if (!/successfully paired/i.test(text) && /couldn't read status|connection reset/i.test(text)) { await sleep(800); r = await adb(['pair', address, code], { timeout: 25000 }); text = clean(r.out + ' ' + r.err); }
  log('pair', address, '→', text.slice(0, 200));
  if (!/successfully paired/i.test(text)) {
    if (/wrong password|protocol fault|couldn't read status/i.test(text)) return { ok: false, field: 'code', msg: 'Pairing was refused. The code or port probably changed — on the device tap “Pair new device” again and use the new port and code (they change every time).' };
    if (/refused|timed out|unable to connect|failed to connect|cannot connect/i.test(text) || !text) return { ok: false, field: 'addr', msg: "Couldn't reach the device. Check the IP & port under “Pair new device” and keep that screen open." };
    return { ok: false, msg: text };
  }
  const [ip, pport] = address.split(':');
  const c = await findAndConnect(ip, { onStatus: (t) => send('pair-status', { text: t }), skipPorts: [+pport], isCancelled: () => job.cancelled });
  if (c.cancelled) return { ok: true, paired: true, ip, msg: 'Paired.' };
  if (c.ok) return { ok: true, paired: true, connected: true, ip, address: c.address, msg: 'Paired and connected!' };
  return { ok: true, paired: true, connected: false, ip, msg: 'Paired! Now enter the connection port.' };
}
async function reconnect(ip) {
  const k = known[ip];
  if (!k || reconnectingIps.has(ip)) return { ok: false, msg: 'Already trying…' };
  reconnectingIps.add(ip); lastJson = ''; poll();
  try {
    const c = await findAndConnect(ip, { preferred: k.address });
    return c.ok ? c : { ok: false, msg: `Couldn't reconnect to ${k.name || ip}. Make sure Wireless debugging is on and the device is awake on the same Wi-Fi.` };
  } finally { reconnectingIps.delete(ip); lastJson = ''; poll(); }
}
let autoBusy = false;
async function autoReconnect() {
  if (paused || autoBusy || !settings.autoReconnect) return;
  autoBusy = true;
  try {
    const presentIps = new Set(groups.flatMap((d) => [d.serial, ...d.aliases]).filter(isIpPort).map((s) => s.split(':')[0]));
    const missing = Object.values(known).filter((k) => k.auto !== false && !presentIps.has(k.ip) && !reconnectingIps.has(k.ip));
    if (!missing.length) return;
    await Promise.all(missing.slice(0, 6).map((k) => tryConnect(k.address, 4000)));
    for (const s of await mdnsServices())
      if (s.type === 'connect' && known[s.ip] && known[s.ip].auto !== false && !presentIps.has(s.ip)) { const r = await tryConnect(s.address, 4000); if (r.ok) remember(s.address); }
  } catch (e) { log('autoReconnect', e); }
  finally { autoBusy = false; }
}
let qrJob = null;
function startQrPair() {
  if (qrJob) qrJob.cancelled = true;
  const rnd = (n, c) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join('');
  const name = 'adbconnector-' + rnd(6, 'abcdefghijkmnpqrstuvwxyz23456789');
  const password = rnd(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const job = { cancelled: false }; qrJob = job;
  (async () => {
    try {
      const until = Date.now() + 180000;
      while (!job.cancelled && Date.now() < until) {
        const svc = (await mdnsServices()).find((s) => s.type === 'pairing' && s.name === name);
        if (svc) {
          send('qr-status', { stage: 'pairing' });
          const r = await adb(['pair', svc.address, password], { timeout: 20000 });
          if (!/successfully paired/i.test(r.out + r.err)) { send('qr-status', { stage: 'error', msg: clean(r.out + r.err) || 'Pairing failed' }); return; }
          const c = await findAndConnect(svc.ip, { skipPorts: [+svc.address.split(':')[1]], isCancelled: () => job.cancelled });
          send('qr-status', c.ok ? { stage: 'done' } : { stage: 'paired', ip: svc.ip });
          return;
        }
        await sleep(1200);
      }
      if (!job.cancelled) send('qr-status', { stage: 'error', msg: 'Timed out. Open the QR again to retry.' });
    } catch (e) { log('qr', e); send('qr-status', { stage: 'error', msg: 'Pairing failed' }); }
  })();
  return { qr: `WIFI:T:ADB;S:${name};P:${password};;` };
}
async function usbToWifi(serial) {
  const ipr = await sh(serial, 'ip -f inet addr show wlan0', { timeout: 5000 });
  let ip = (ipr.out.match(/inet (\d+\.\d+\.\d+\.\d+)/) || [])[1];
  if (!ip) { const r2 = await sh(serial, 'ip route', { timeout: 5000 }); ip = (r2.out.match(/src (\d+\.\d+\.\d+\.\d+)/) || [])[1]; }
  if (!ip) return { ok: false, msg: 'The device is not on Wi-Fi. Connect it to Wi-Fi first.' };
  await adb(['-s', serial, 'tcpip', '5555'], { timeout: 8000 });
  await sleep(2500);
  const c = await connectTo(`${ip}:5555`);
  if (c.ok) c.msg = `Now on Wi-Fi (${ip}:5555). You can unplug the cable.`;
  return c;
}

// ───────────────────────── operations with automatic recovery ─────────────────────────
const TRANSIENT = /closed|offline|device '.*' not found|device not found|no devices|protocol fault|connection reset|broken pipe|failed to (write|read|get feature)|EOF|timeout/i;
async function waitForDevice(id, ms = 25000) {
  const until = Date.now() + ms;
  const g0 = groupOf(id);
  const ip = g0 && [g0.serial, ...g0.aliases].find(isIpPort)?.split(':')[0];
  let kicked = false;
  while (Date.now() < until) {
    lastJson = ''; await poll();
    const s = liveSerial(id);
    if (s) return s;
    if (!kicked && ip && known[ip]) { kicked = true; tryConnect(known[ip].address, 5000); }
    await sleep(1000);
  }
  return null;
}
// run fn(serial); if the connection dropped mid-way, wait for the device to come back and retry once
async function withDevice(id, fn, { retry = true } = {}) {
  const serial = liveSerial(id) || id;
  const g = groupOf(id);
  const keys = [g ? g.id : id, serial];
  markBusy(keys, true);
  try {
    let r = await fn(serial);
    if (retry && !r.ok && TRANSIENT.test(r.raw || r.msg || '') && !/INSTALL_FAILED|INSTALL_PARSE/.test(r.raw || '')) {
      log('transient failure, waiting for device', id, (r.raw || r.msg || '').slice(0, 160));
      send('op-status', { id, text: 'Connection dropped — waiting for the device to come back…' });
      const s2 = await waitForDevice(g ? g.id : id);
      if (s2) { send('op-status', { id, text: 'Reconnected — retrying…' }); r = await fn(s2); }
    }
    return r;
  } finally { markBusy(keys, false); }
}

// ── install (apk, multiple apks, .apks/.xapk/.apkm bundles)
const INSTALL_HINTS = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'A version signed with a different key is already installed. Uninstall it first.',
  INSTALL_FAILED_VERSION_DOWNGRADE: 'A newer version is already installed. Turn on “Allow downgrade” and try again.',
  INSTALL_FAILED_INSUFFICIENT_STORAGE: 'Not enough storage on the device.',
  INSTALL_FAILED_USER_RESTRICTED: 'Installation was blocked on the device. Allow “Install via USB” in Developer options.',
  INSTALL_FAILED_NO_MATCHING_ABIS: 'This APK is not built for this device’s processor.',
  INSTALL_FAILED_OLDER_SDK: 'This app needs a newer Android / Wear OS version.',
  INSTALL_FAILED_TEST_ONLY: 'This is a test build. Turn on “Allow test apps” and try again.',
  INSTALL_FAILED_MISSING_SPLIT: 'This app is split into several files. Drop the .apks/.xapk bundle, or all its .apk files together.',
  INSTALL_FAILED_ALREADY_EXISTS: 'The app is already installed.',
  INSTALL_FAILED_INVALID_APK: 'The APK file is not valid.',
  INSTALL_PARSE_FAILED: 'The APK file is damaged or not a valid app.',
  INSTALL_FAILED_VERIFICATION_FAILURE: 'The device’s security check blocked this app.',
  INSTALL_FAILED_ABORTED: 'Installation was cancelled on the device.',
};
function installFlags() { const f = ['-r']; if (settings.install.downgrade) f.push('-d'); if (settings.install.test) f.push('-t'); if (settings.install.grant) f.push('-g'); return f; }
function parseInstall(text, label) {
  if (/(^|\n)\s*Success\b/.test(text)) return { ok: true, msg: `Installed ${label}` };
  const m = text.match(/Failure \[([^\]]+)\]/) || text.match(/(INSTALL_[A-Z_]+[^\n]*)/);
  const reason = m ? m[1] : (clean(text).split('\n').pop() || 'unknown error');
  const key = Object.keys(INSTALL_HINTS).find((k) => reason.includes(k));
  return { ok: false, msg: key ? INSTALL_HINTS[key] : `Install failed: ${reason.replace(/^adb(\.exe)?: /, '')}`, raw: text };
}
// read package name + version from an APK's binary AndroidManifest.xml (no Android SDK needed)
function apkInfo(file) {
  try {
    const AdmZip = require('adm-zip');
    let buf;
    const zip = new AdmZip(file);
    const m = zip.getEntry('AndroidManifest.xml');
    if (m) buf = m.getData();
    else {   // bundle: look inside its base APK
      const base = zip.getEntries().find((e) => /(^|\/)base(-master)?\.apk$/i.test(e.entryName)) || zip.getEntries().find((e) => /\.apk$/i.test(e.entryName));
      if (!base) return null;
      const inner = new AdmZip(base.getData()).getEntry('AndroidManifest.xml');
      if (!inner) return null; buf = inner.getData();
    }
    let strings = [], off = 8;
    while (off + 8 <= buf.length) {
      const type = buf.readUInt16LE(off), hsz = buf.readUInt16LE(off + 2), size = buf.readUInt32LE(off + 4);
      if (!size) break;
      if (type === 0x0001) {   // string pool
        const count = buf.readUInt32LE(off + 8), flags = buf.readUInt32LE(off + 16), start = buf.readUInt32LE(off + 20);
        const utf8 = !!(flags & 0x100);
        for (let i = 0; i < count; i++) {
          let p = off + start + buf.readUInt32LE(off + hsz + i * 4);
          if (utf8) {
            let n = buf[p++]; if (n & 0x80) p++;
            let bl = buf[p++]; if (bl & 0x80) bl = ((bl & 0x7f) << 8) | buf[p++];
            strings.push(buf.toString('utf8', p, p + bl));
          } else {
            let n = buf.readUInt16LE(p); p += 2; if (n & 0x8000) { n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p); p += 2; }
            strings.push(buf.toString('utf16le', p, p + n * 2));
          }
        }
      } else if (type === 0x0102) {   // start element
        if (strings[buf.readUInt32LE(off + 20)] === 'manifest') {
          const aStart = buf.readUInt16LE(off + 24), aSize = buf.readUInt16LE(off + 26), aCount = buf.readUInt16LE(off + 28);
          const info = {};
          for (let i = 0; i < aCount; i++) {
            const a = off + 16 + aStart + i * aSize;
            const name = strings[buf.readUInt32LE(a + 4)], raw = buf.readInt32LE(a + 8), dtype = buf[a + 15], data = buf.readUInt32LE(a + 16);
            const val = raw >= 0 ? strings[raw] : dtype === 3 ? strings[data] : data;
            if (name === 'package') info.pkg = String(val);
            if (name === 'versionCode') info.versionCode = +val;
            if (name === 'versionName') info.versionName = String(val);
          }
          return info.pkg ? info : null;
        }
      }
      off += size;
    }
  } catch (e) { log('apkInfo', e.message); }
  return null;
}
// Android refuses "-d" for normal (non-debug) apps since Android 12: offer remove-then-install
function downgradeHelp(r, file) {
  if (r.ok || !/VERSION_DOWNGRADE/.test(r.raw || '')) return r;
  const info = apkInfo(file);
  if (!info) return r;
  return { ...r, downgrade: true, pkg: info.pkg, file, msg: `${info.pkg}: a newer version is installed, and Android blocks installing an older one over it.` };
}
async function installAfterRemove(id, file, pkg, keepData, asSplitFiles) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const rm = keepData ? await sh(serial, `pm uninstall -k ${q(pkg)}`, { timeout: 60000 }) : await adb(['-s', serial, 'uninstall', pkg], { timeout: 60000 });
  if (!/Success/.test(rm.out)) return { ok: false, msg: `Could not remove the installed version: ${friendly(rm)}` };
  log('downgrade: removed', pkg, keepData ? '(kept data)' : '');
  const flags = installFlags();
  const files = asSplitFiles && asSplitFiles.length ? asSplitFiles : [file];
  const r = /\.(apks|xapk|apkm)$/i.test(file) ? await installBundle(id, file, flags) : files.length > 1 ? await installMultiple(id, files, flags, path.basename(file)) : await installOne(id, file, flags);
  if (r.ok) r.msg = `Installed the older version of ${pkg}${keepData ? ' (app data kept)' : ''}`;
  await recordInstall(id, files, r, 'downgrade');
  const { raw, ...rest } = r; return rest;
}

// ───────────────────────── app names, icons, library, history ─────────────────────────
const apkmeta = require('./apkmeta');
const crypto = require('crypto');
const SERVER_JAR = '/data/local/tmp/scrcpy-server.jar';
async function ensureServer(serial) {
  if (serverPushed.has(serial)) {
    const c = await sh(serial, `[ -f ${SERVER_JAR} ] && echo yes`, { timeout: 8000, quiet: true });
    if (/yes/.test(c.out)) return { ok: true };
    serverPushed.delete(serial);   // removed by scrcpy's own clean-up
  }
  const server = scrcpyServerPath();
  if (!fs.existsSync(server)) return { ok: false, msg: 'Screen mirroring files are missing.' };
  const pr = await adb(['-s', serial, 'push', server, SERVER_JAR], { timeout: 30000 });
  if (!pr.ok) return { ok: false, msg: friendly(pr) };
  serverPushed.add(serial);
  return { ok: true };
}
const deviceKey = (id) => { const g = groupOf(id); return (g && g.id) || id; };
const deviceTitle = (id) => { const g = groupOf(id); const i = g && g.info; return (i && [i.manufacturer, i.model].filter(Boolean).join(' ')) || (g && g.model) || String(id); };

// display names as the device shows them (uses scrcpy's app lister)
function parseAppList(text) {
  const map = {};
  const lines = String(text).replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ ([*-]) (.*)$/);
    if (!m) continue;
    const rest = m[2];
    let name, pkg;
    const next = (lines[i + 1] || '').match(/^ {20,}(\S+)\s*$/);
    if (next) { name = rest.trim(); pkg = next[1]; i++; }   // long name: package on the next line
    else { name = rest.slice(0, 30).trim(); pkg = rest.slice(30).trim(); }
    if (/^[\w.]+$/.test(pkg)) map[pkg] = { label: name, system: m[1] === '*' };
  }
  return map;
}
const labelCache = new Map();
async function appLabels(id, force) {
  const key = deviceKey(id);
  const c = labelCache.get(key);
  if (c && !force && Date.now() - c.at < 10 * 60 * 1000) return { ok: true, labels: c.map };
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const es = await ensureServer(serial);
  if (!es.ok) return es;
  const r = await sh(serial, `CLASSPATH=${SERVER_JAR} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} list_apps=true cleanup=false log_level=info 2>&1`, { timeout: 90000, quiet: true });
  const map = parseAppList(r.out);
  if (!Object.keys(map).length) { log('list_apps gave nothing', clean(r.out).slice(-300)); return { ok: false, msg: 'Could not read app names' }; }
  labelCache.set(key, { at: Date.now(), map });
  return { ok: true, labels: map };
}

// icons: read from each app's APK on the device (only the few small files needed), cached on the computer
const metaDir = () => { const d = userFile('appcache'); fs.mkdirSync(d, { recursive: true }); return d; };
const memMeta = new Map();
const apkPaths = new Map();   // deviceKey → { at, map pkg→path }
async function devicePaths(id, serial) {
  const key = deviceKey(id);
  const c = apkPaths.get(key);
  if (c && Date.now() - c.at < 60000) return c.map;
  const r = await sh(serial, 'pm list packages -f 2>/dev/null', { timeout: 30000, quiet: true });
  const map = {};
  for (const l of r.out.split(/\r?\n/)) { const m = l.trim().match(/^package:(.+\.apk)=([\w.]+)$/); if (m) map[m[2]] = m[1]; }
  apkPaths.set(key, { at: Date.now(), map });
  return map;
}
async function remoteGetter(serial, apk) {
  const files = new Map();
  let zip = null, unzipOk = true;
  return async (name) => {
    if (files.has(name)) return files.get(name);
    let buf = null;
    if (unzipOk) {
      const r = await adb(['-s', serial, 'exec-out', `unzip -p ${q(apk)} ${q(name)} 2>/dev/null`], { timeout: 60000, encoding: 'buffer', quiet: true });
      buf = r.ok && r.out && r.out.length ? r.out : null;
      if (!buf && name === 'AndroidManifest.xml') unzipOk = false;   // no unzip on this device: fall back to copying the APK
    }
    if (!buf && !unzipOk) {
      if (!zip) {
        const sz = +clean((await sh(serial, `stat -c %s ${q(apk)}`, { timeout: 8000, quiet: true })).out) || 0;
        if (!sz || sz > 80 * 1024 * 1024) return null;
        const tmp = tmpPath('.apk');
        const pr = await adb(['-s', serial, 'pull', apk, tmp], { timeout: 5 * 60000, quiet: true });
        if (!pr.ok) return null;
        try { zip = new (require('adm-zip'))(tmp); } catch { zip = null; }
        fs.unlink(tmp, () => {});
        if (!zip) return null;
      }
      const e = zip.getEntry(name); buf = e ? e.getData() : null;
    }
    files.set(name, buf);
    return buf;
  };
}
async function appMeta(id, pkgs) {
  const serial = liveSerial(id); if (!serial) return {};
  const paths = await devicePaths(id, serial);
  const out = {};
  const todo = [];
  for (const pkg of pkgs) {
    const apk = paths[pkg]; if (!apk) continue;
    const h = crypto.createHash('sha1').update(pkg + '|' + apk).digest('hex').slice(0, 20);
    if (memMeta.has(h)) { out[pkg] = memMeta.get(h); continue; }
    const f = path.join(metaDir(), h + '.json');
    if (fs.existsSync(f)) { try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); memMeta.set(h, m); out[pkg] = m; continue; } catch {} }
    todo.push({ pkg, apk, h, f });
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++];
      let m = null;
      try { m = await apkmeta.readAppMeta(await remoteGetter(serial, t.apk)); } catch (e) { log('appMeta', t.pkg, e.message); }
      const v = { label: (m && m.label) || null, icon: (m && m.icon) || null, versionName: (m && m.versionName) || null };
      memMeta.set(t.h, v); out[t.pkg] = v;
      try { fs.writeFileSync(t.f, JSON.stringify(v)); } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

// local APK / bundle → { pkg, label, icon, versionName, versionCode }
async function localMeta(file) {
  const AdmZip = require('adm-zip');
  let zip = new AdmZip(file);
  if (!zip.getEntry('AndroidManifest.xml')) {
    const base = zip.getEntries().find((e) => /(^|\/)base(-master)?\.apk$/i.test(e.entryName)) || zip.getEntries().find((e) => /\.apk$/i.test(e.entryName) && !/split|config\./i.test(e.entryName)) || zip.getEntries().find((e) => /\.apk$/i.test(e.entryName));
    if (!base) return null;
    zip = new AdmZip(base.getData());
  }
  return apkmeta.readAppMeta(async (n) => { const e = zip.getEntry(n); return e ? e.getData() : null; });
}

// the app library: every app installed from (or saved to) this computer, every version kept
const libDir = () => { const d = userFile('library'); fs.mkdirSync(d, { recursive: true }); return d; };
const libIndexFile = () => path.join(libDir(), 'index.json');
let library = null;
function loadLibrary() {
  if (library) return library;
  try { library = JSON.parse(fs.readFileSync(libIndexFile(), 'utf8')); } catch { library = { items: [], history: [] }; }
  library.items = (library.items || []).filter((it) => it.files && it.files.every((f) => fs.existsSync(path.join(libDir(), f))));
  library.history = library.history || [];
  return library;
}
function saveLibrary() { try { fs.writeFileSync(libIndexFile(), JSON.stringify(library)); } catch (e) { log('saveLibrary', e); } }
const hashFiles = (files) => { const h = crypto.createHash('sha1'); for (const f of files) { const st = fs.statSync(f); h.update(path.basename(f) + st.size); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(1024 * 1024); let n; let pos = 0; while ((n = fs.readSync(fd, b, 0, b.length, pos)) > 0) { h.update(b.subarray(0, n)); pos += n; } fs.closeSync(fd); } return h.digest('hex').slice(0, 16); };
async function libraryAdd(files, source) {
  loadLibrary();
  files = [].concat(files).filter((f) => f && fs.existsSync(f) && fs.statSync(f).isFile());
  if (!files.length) return null;
  try {
    const hash = hashFiles(files);
    const have = library.items.find((it) => it.hash === hash);
    if (have) return have;
    const base = files.length > 1 ? (files.find((f) => /base/i.test(path.basename(f))) || files[0]) : files[0];
    const meta = await localMeta(base);
    if (!meta || !meta.pkg) return null;
    const folder = path.join(meta.pkg.replace(/[^\w.-]/g, '_'), `${String(meta.versionName || meta.versionCode || 'v').replace(/[^\w.-]/g, '_')}-${hash.slice(0, 6)}`);
    fs.mkdirSync(path.join(libDir(), folder), { recursive: true });
    const stored = [];
    for (const f of files) { const rel = path.join(folder, path.basename(f).replace(/[^\w.() -]/g, '_')); fs.copyFileSync(f, path.join(libDir(), rel)); stored.push(rel); }
    const iconFile = path.join(folder, 'icon.json');
    if (meta.icon) fs.writeFileSync(path.join(libDir(), iconFile), JSON.stringify(meta.icon));
    const item = { id: hash, hash, pkg: meta.pkg, label: meta.label || null, versionName: meta.versionName || null, versionCode: meta.versionCode || 0, files: stored, split: stored.length > 1, size: files.reduce((a, f) => a + fs.statSync(f).size, 0), addedAt: Date.now(), source: source || 'added', name: path.basename(base), icon: meta.icon ? iconFile : null };
    library.items.push(item); saveLibrary();
    send('library-changed', {});
    return item;
  } catch (e) { log('libraryAdd', e.message); return null; }
}
function addHistory(e) {
  loadLibrary();
  library.history.unshift({ at: Date.now(), ...e });
  if (library.history.length > 1000) library.history.length = 1000;
  saveLibrary(); send('library-changed', {});
}
function libraryList() {
  loadLibrary();
  const icons = {};
  for (const it of library.items) if (it.icon && !icons[it.pkg]) { try { icons[it.pkg] = JSON.parse(fs.readFileSync(path.join(libDir(), it.icon), 'utf8')); } catch {} }
  return { items: library.items.map((it) => ({ ...it, paths: it.files.map((f) => path.join(libDir(), f)) })), history: library.history, icons, dir: libDir() };
}
function libraryRemove(itemId) {
  loadLibrary();
  const it = library.items.find((x) => x.id === itemId); if (!it) return { ok: false, msg: 'Not found' };
  library.items = library.items.filter((x) => x !== it); saveLibrary();
  try { fs.rmSync(path.join(libDir(), path.dirname(it.files[0])), { recursive: true, force: true }); } catch {}
  send('library-changed', {});
  return { ok: true, msg: 'Removed from library' };
}
// remember installs (success or not) and keep the files in the library
async function recordInstall(id, files, r, action) {
  try { const it = await recordInstall2(id, files, r, action); if (r.ok && it && it.label && action !== 'downgrade') r.msg = `Installed ${it.label}${it.versionName ? ' ' + it.versionName : ''}`; } catch (e) { log('recordInstall', e.message); }
}
async function recordInstall2(id, files, r, action) {
  let item = null;
  if (r.ok) item = await libraryAdd(files, 'installed');
  let meta = item;
  if (!meta) { const info = files[0] && /\.apk$/i.test(files[0]) ? apkInfo(files[0]) : null; meta = info || {}; }
  addHistory({ action: action || 'install', ok: !!r.ok, msg: r.ok ? '' : r.msg, device: deviceTitle(id), pkg: meta.pkg || null, label: meta.label || null, versionName: meta.versionName || null, name: path.basename(files[0] || ''), item: item ? item.id : null });
  return item;
}
function stageAscii(file) {
  if (!needsAscii(file)) return { p: file, tmp: null };
  const t = tmpPath(path.extname(file)); fs.copyFileSync(file, t); return { p: t, tmp: t };
}
async function installOne(id, file, flags) {
  if (!fs.existsSync(file)) return { ok: false, msg: `File not found: ${path.basename(file)}` };
  const { p, tmp } = stageAscii(file);
  try {
    return await withDevice(id, async (serial) => {
      let r = await adb(['-s', serial, 'install', ...flags, p], { timeout: 15 * 60 * 1000 });
      let text = clean(r.out + '\n' + r.err);
      if (/Unknown option|unknown option -/.test(text)) { r = await adb(['-s', serial, 'install', '-r', p], { timeout: 15 * 60 * 1000 }); text = clean(r.out + '\n' + r.err); }
      return parseInstall(text, path.basename(file));
    });
  } finally { if (tmp) fs.unlink(tmp, () => {}); }
}
async function installMultiple(id, files, flags, label) {
  const staged = files.map(stageAscii);
  try {
    return await withDevice(id, async (serial) => {
      const r = await adb(['-s', serial, 'install-multiple', ...flags, ...staged.map((s) => s.p)], { timeout: 20 * 60 * 1000 });
      return parseInstall(clean(r.out + '\n' + r.err), label);
    });
  } finally { for (const s of staged) if (s.tmp) fs.unlink(s.tmp, () => {}); }
}
async function installBundle(id, file, flags) {
  let AdmZip; try { AdmZip = require('adm-zip'); } catch (e) { log('adm-zip', e); return { ok: false, msg: 'Bundle support is missing' }; }
  const dir = tmpPath('bundle'); fs.mkdirSync(dir, { recursive: true });
  try {
    const zip = new AdmZip(file);
    const entries = zip.getEntries();
    const apks = [];
    for (const e of entries) {
      const n = e.entryName.replace(/\\/g, '/');
      if (/\.apk$/i.test(n) && !e.isDirectory) { const dst = path.join(dir, `${apks.length}-${path.basename(n).replace(/[^\w.-]/g, '_')}`); fs.writeFileSync(dst, e.getData()); apks.push(dst); }
    }
    if (!apks.length) return { ok: false, msg: 'No APK files found inside this bundle.' };
    send('install-progress', { file: path.basename(file), detail: `${apks.length} parts` });
    const r = apks.length === 1 ? await installOne(id, apks[0], flags) : await installMultiple(id, apks, flags, path.basename(file));
    const obbs = entries.filter((e) => !e.isDirectory && /^Android\/obb\//i.test(e.entryName.replace(/\\/g, '/')));
    if (r.ok && obbs.length) {
      send('install-progress', { file: path.basename(file), detail: 'copying game data' });
      for (const e of obbs) {
        const rel = e.entryName.replace(/\\/g, '/');
        const local = path.join(dir, 'obb-' + path.basename(rel)); fs.writeFileSync(local, e.getData());
        await withDevice(id, async (serial) => { await sh(serial, `mkdir -p ${q('/sdcard/' + path.posix.dirname(rel))}`); const pr = await adb(['-s', serial, 'push', local, '/sdcard/' + rel], { timeout: 30 * 60 * 1000 }); return { ok: pr.ok, raw: pr.err }; });
      }
    }
    if (r.ok) r.msg = `Installed ${path.basename(file)}`;
    return r;
  } catch (e) { log('bundle', e); return { ok: false, msg: 'Could not read this bundle file.' }; }
  finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}
async function install(id, files, asSplit) {
  const flags = installFlags();
  const results = [];
  const bundles = files.filter((f) => /\.(apks|xapk|apkm)$/i.test(f));
  const apks = files.filter((f) => /\.apk$/i.test(f));
  if (asSplit && apks.length > 1) {
    send('install-progress', { file: `${apks.length} files`, detail: 'as one app' });
    const base = apks.find((f) => /base/i.test(path.basename(f))) || apks[0];
    const r = downgradeHelp(await installMultiple(id, apks, flags, `${apks.length} split files`), base);
    if (r.downgrade) r.splitFiles = apks;
    if (!r.downgrade) await recordInstall(id, apks, r);
    results.push(r);
  } else for (const f of apks) { send('install-progress', { file: path.basename(f) }); const r = downgradeHelp(await installOne(id, f, flags), f); if (!r.downgrade) await recordInstall(id, [f], r); results.push(r); }
  for (const f of bundles) { send('install-progress', { file: path.basename(f) }); const r = downgradeHelp(await installBundle(id, f, flags), f); if (!r.downgrade) await recordInstall(id, [f], r); results.push(r); }
  return results.map(({ raw, ...r }) => r);
}

// ── files
async function pushFiles(id, files, remoteDir) {
  const results = [];
  for (const f of files) {
    const name = path.basename(f);
    let staged = f, tmp = null;
    try {
      if (needsAscii(f)) {
        if (fs.statSync(f).isDirectory()) { tmp = tmpPath('dir'); fs.cpSync(f, tmp, { recursive: true }); }
        else { tmp = tmpPath(path.extname(f)); fs.copyFileSync(f, tmp); }
        staged = tmp;
      }
      send('transfer-progress', { text: `Uploading ${name}…` });
      const remote = path.posix.join(remoteDir, name);
      const r = await withDevice(id, async (serial) => { const x = await adb(['-s', serial, 'push', staged, remote], { timeout: 60 * 60 * 1000 }); return { ok: x.ok && !/error:|failed to/i.test(x.err), msg: x.ok ? `Uploaded ${name}` : friendly(x), raw: x.err }; });
      results.push({ ok: r.ok, msg: r.msg });
    } catch (e) { results.push({ ok: false, msg: e.message }); }
    finally { if (tmp) fs.rm(tmp, { recursive: true, force: true }, () => {}); }
  }
  return results;
}
async function pullFiles(id, remotes, destDir) {
  const dest = destDir || outDir('file');
  const saved = [];
  for (const remote of remotes) {
    const name = path.posix.basename(remote.replace(/\/+$/, '')) || 'file';
    const tmp = tmpPath(); fs.mkdirSync(tmp, { recursive: true });
    send('transfer-progress', { text: `Downloading ${name}…` });
    const r = await withDevice(id, async (serial) => { const x = await adb(['-s', serial, 'pull', '-a', remote, tmp], { timeout: 60 * 60 * 1000 }); return { ok: x.ok, msg: friendly(x), raw: x.err }; });
    if (!r.ok) { fs.rm(tmp, { recursive: true, force: true }, () => {}); return { ok: false, msg: `Download failed: ${r.msg}` }; }
    let target = path.join(dest, name);
    if (fs.existsSync(target)) { const ext = path.extname(name); target = path.join(dest, `${path.basename(name, ext)} (${stamp()})${ext}`); }
    try { fs.cpSync(path.join(tmp, name), target, { recursive: true }); saved.push(target); } catch (e) { log('pull move', e); }
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
  return saved.length ? { ok: true, file: saved[0], files: saved, msg: saved.length === 1 ? `Saved ${path.basename(saved[0])}` : `Saved ${saved.length} items` } : { ok: false, msg: 'Nothing was downloaded' };
}

// ── screenshot / live frames / recording
async function screenshot(id) {
  const r = await withDevice(id, async (serial) => { const x = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 30000, encoding: 'buffer', quiet: true }); return { ok: x.ok && x.out && x.out.length > 100 && x.out[0] === 0x89, buf: x.out, raw: x.err || (x.ok ? '' : 'closed') }; });
  if (!r.ok) return { ok: false, msg: 'Could not take a screenshot. Wake the device screen and try again.' };
  const file = path.join(outDir('screenshot'), `screenshot-${stamp()}.png`);
  fs.writeFileSync(file, r.buf);
  return { ok: true, file, msg: 'Screenshot saved', dataUrl: 'data:image/png;base64,' + r.buf.toString('base64') };
}
async function frame(id) {
  const serial = liveSerial(id); if (!serial) return null;
  const x = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 15000, encoding: 'buffer', quiet: true });
  return x.ok && x.out && x.out.length > 100 && x.out[0] === 0x89 ? x.out : null;
}
const recordings = new Map();
function startRecording(id, opts = {}) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  if (recordings.has(id)) return { ok: false, msg: 'Already recording' };
  const remote = '/sdcard/adbconnector_rec.mp4';
  const limit = Math.max(5, Math.min(180, +opts.limit || settings.record.limit || 180));
  const bitrate = Math.max(1, Math.min(40, +opts.bitrate || settings.record.bitrate || 8)) * 1000000;
  let proc;
  try { proc = spawn(ADB, ['-s', serial, 'shell', 'screenrecord', '--time-limit', String(limit), '--bit-rate', String(bitrate), remote], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { log('record', e); return { ok: false, msg: 'Could not start recording' }; }
  let errText = '';
  proc.stdout && proc.stdout.on('data', (d) => { errText += d; });
  proc.stderr && proc.stderr.on('data', (d) => { errText += d; });
  const rec = { proc, serial, remote, startedAt: Date.now(), stopping: false };
  rec.exited = new Promise((res) => { proc.once('exit', res); proc.once('error', (e) => { log('record proc', e); res(); }); });
  recordings.set(id, rec); markBusy([id, serial], true);
  rec.exited.then(async () => {
    if (rec.stopping) return;
    const res = await finishRecording(id, errText).catch((e) => ({ ok: false, msg: e.message }));
    send('recording-ended', { id, ...res });
  });
  return { ok: true, limit };
}
async function finishRecording(id, errText = '') {
  const rec = recordings.get(id);
  if (!rec) return { ok: false, msg: 'Not recording' };
  rec.stopping = true;
  await sleep(1200);
  const serial = liveSerial(id) || rec.serial;
  const file = path.join(outDir('recording'), `recording-${stamp()}.mp4`);
  const tmp = tmpPath('.mp4');
  const r = await adb(['-s', serial, 'pull', rec.remote, tmp], { timeout: 300000, quiet: true });
  await sh(serial, `rm -f ${rec.remote}`, { timeout: 5000, quiet: true });
  recordings.delete(id); markBusy([id, rec.serial], false);
  try { if (r.ok && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) { fs.copyFileSync(tmp, file); fs.unlink(tmp, () => {}); return { ok: true, file, msg: 'Recording saved' }; } } catch (e) { log('save rec', e); }
  log('recording failed', errText.slice(0, 300), r.err);
  if (/not found|inaccessible|Unable to|ERROR/i.test(errText) || Date.now() - rec.startedAt < 3000) return { ok: false, msg: "This device can't record its screen this way. Use Mirror screen with “Record while mirroring” instead." };
  return { ok: false, msg: 'Could not save the recording' };
}
async function stopRecording(id) {
  const rec = recordings.get(id);
  if (!rec) return { ok: false, msg: 'Not recording' };
  rec.stopping = true;
  const serial = liveSerial(id) || rec.serial;
  await sh(serial, 'pkill -INT screenrecord 2>/dev/null || (p=$(pidof screenrecord) && kill -2 $p)', { timeout: 6000, quiet: true });
  await Promise.race([rec.exited, sleep(6000)]);
  try { rec.proc.kill(); } catch {}
  return finishRecording(id);
}

// ── screen mirroring (scrcpy)
function launchScrcpy(id, opts = {}) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const o = { ...settings.scrcpy, ...opts };
  const dir = path.dirname(SCRCPY);
  if (isWin) {
    const missing = ['scrcpy.exe', 'scrcpy-server', 'SDL2.dll', 'avcodec-61.dll'].filter((f) => !fs.existsSync(path.join(dir, f)));
    if (missing.length) { log('scrcpy missing', missing); return { ok: false, msg: `Screen mirroring files were removed (${missing.join(', ')}). Windows Security may have blocked them — check Protection history, allow them, then restart the app.` }; }
  }
  const g = groupOf(id);
  const watch = !!(g && g.info && g.info.watch);
  const args = ['-s', serial, '--window-title', `Screen - ${(g && g.info && g.info.model) || serial}`];
  if (o.stayAwake) args.push('--stay-awake');
  if (o.screenOff) args.push('--turn-screen-off');
  if (o.onTop) args.push('--always-on-top');
  if (o.fullscreen) args.push('--fullscreen');
  if (o.showTouches) args.push('--show-touches');
  if (o.noAudio || watch) args.push('--no-audio');
  if (o.borderless) args.push('--window-borderless');
  if (o.noControl) args.push('--no-control');
  if (+o.maxSize) args.push('--max-size', String(+o.maxSize));
  if (o.bitrate) args.push('--video-bit-rate', String(o.bitrate));
  if (+o.fps) args.push('--max-fps', String(+o.fps));
  if (watch && !o.fullscreen) args.push('--window-width', '480', '--window-height', '480');
  if (o.record) { const recFile = path.join(outDir('recording'), `mirror-${stamp()}.mp4`); args.push('--record', recFile); }
  const logFile = userFile('scrcpy-log.txt');
  try { fs.writeFileSync(logFile, ''); } catch {}
  log('scrcpy start', args.join(' '));
  try {
    if (isWin) {
      // like scrcpy's own scrcpy-noconsole.vbs: hide only the console window, keep the mirror window visible
      const vbs = path.join(dir, 'run-scrcpy-hidden.vbs');
      const Q = '"';
      fs.writeFileSync(vbs, [
        'Set sh = CreateObject("WScript.Shell")',
        'c = "cmd /c ' + Q + Q + Q + Q + 'scrcpy.exe' + Q + Q + Q,
        'For Each a In WScript.Arguments',
        '  c = c & " ' + Q + Q + Q + ' & Replace(a, ' + Q + Q + Q + Q + ', "") & ' + Q + Q + Q + Q,
        'Next',
        'c = c & " > ' + Q + Q + Q + ' & sh.ExpandEnvironmentStrings("%SCRCPY_LOG%") & ' + Q + Q + Q + ' 2>&1' + Q + Q + Q,
        'sh.Run c, 0, False',
      ].join('\r\n'));
      const p = spawn('wscript.exe', ['//nologo', vbs, ...args], { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, ADB, SCRCPY_LOG: logFile } });
      p.on('error', (e) => { log('scrcpy wscript', e); send('toast', { ok: false, msg: 'Could not start screen mirroring' }); });
      p.unref();
    } else {
      const fd = fs.openSync(logFile, 'w');
      const p = spawn(SCRCPY, args, { cwd: dir, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ADB } });
      fs.closeSync(fd); p.on('error', (e) => log('scrcpy', e)); p.unref();
    }
  } catch (e) { log('scrcpy', e); return { ok: false, msg: 'Could not start screen mirroring' }; }
  const check = (n) => setTimeout(() => {
    let text = ''; try { text = fs.readFileSync(logFile, 'utf8'); } catch {}
    const err = text.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop();
    if (err) { log('scrcpy error', err); send('toast', { ok: false, msg: 'Screen mirroring failed: ' + err.replace(/^.*ERROR:\s*/, '') }); }
    else if (n < 2) check(n + 1);
  }, 4000);
  check(0);
  return { ok: true, msg: o.record ? 'Opening screen mirror — recording to your Videos folder' : 'Opening screen mirror… (a new window will appear)' };
}

// ── embedded mirroring: scrcpy's server on the device streams H.264 into the app window
// Protocol (scrcpy 3.3.1): forward tunnel → 1st socket = video (dummy byte, 64-byte device name, codec meta, framed packets),
// 2nd socket = control (touch/key/text/scroll messages from the app).
const SCRCPY_VERSION = '3.3.1';
const mirrors = new Map(); let mirrorSeq = 0;
const serverPushed = new Set();
function scrcpyServerPath() {
  if (process.env.SCRCPY_SERVER) return process.env.SCRCPY_SERVER;
  const a = path.join(path.dirname(SCRCPY), 'scrcpy-server');
  return fs.existsSync(a) ? a : path.join(platformDir, 'scrcpy-server');
}
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function connectWithDummy(port, ms = 2500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (done) return; done = true; clearTimeout(t); s.removeAllListeners('data'); if (!v) s.destroy(); resolve(v); };
    const t = setTimeout(() => fin(null), ms);
    s.once('error', () => fin(null)); s.once('close', () => fin(null));
    s.once('data', (d) => { s.removeAllListeners('close'); s.removeAllListeners('error'); s.pause(); if (d.length > 1) s.unshift(d.subarray(1)); fin(s); });
  });
}
function connectPlain(port) { return new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => resolve(s)); s.once('error', () => resolve(null)); }); }

async function startMirror(id, opts = {}) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const o = { ...settings.scrcpy, ...opts };
  const g = groupOf(id);
  const sid = ++mirrorSeq;
  const st = { sid, id, serial, proc: null, video: null, control: null, port: 0, ended: false, log: '' };
  mirrors.set(sid, st); markBusy([id, serial], true);
  const fail = (msg) => { log('mirror start failed', serial, msg); stopMirror(sid, null); return { ok: false, msg }; };
  try {
    const es = await ensureServer(serial);
    if (!es.ok) return fail(/missing/.test(es.msg) ? es.msg : 'Could not start mirroring: ' + es.msg);
    const scid = (Math.floor(Math.random() * 0x7fffffff) | 0x1000000) >>> 0;
    const hex = scid.toString(16).padStart(8, '0');
    st.port = await freePort();
    const fr = await adb(['-s', serial, 'forward', `tcp:${st.port}`, `localabstract:scrcpy_${hex}`], { timeout: 10000 });
    if (!fr.ok) return fail('Could not start mirroring: ' + friendly(fr));
    const params = [`scid=${hex}`, 'log_level=info', 'audio=false', 'control=true', 'tunnel_forward=true', 'video_codec=h264', 'clipboard_autosync=false', 'cleanup=true', 'power_off_on_close=false', 'send_dummy_byte=true'];
    if (+o.maxSize) params.push(`max_size=${+o.maxSize}`);
    if (o.bitrate) params.push(`video_bit_rate=${String(o.bitrate).replace(/M$/i, '000000')}`);
    if (+o.fps) params.push(`max_fps=${+o.fps}`);
    if (o.stayAwake) params.push('stay_awake=true');
    if (o.showTouches) params.push('show_touches=true');
    const cmd = `CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${params.join(' ')}`;
    st.proc = spawn(ADB, ['-s', serial, 'shell', cmd], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const onOut = (d) => { st.log = (st.log + d.toString()).slice(-4000); };
    st.proc.stdout.on('data', onOut); st.proc.stderr.on('data', onOut);
    st.proc.on('error', (e) => log('mirror proc', e));
    let exited = false;
    st.proc.on('exit', () => { exited = true; if (!st.ended && st.video) endMirror(sid, lastError(st.log) || 'The mirror stopped'); });
    // connect video socket (retry until the server is listening)
    for (let i = 0; i < 100 && !st.video && !exited && mirrors.has(sid); i++) { st.video = await connectWithDummy(st.port); if (!st.video) await sleep(100); }
    if (!st.video) return fail(lastError(st.log) ? 'The watch said: ' + lastError(st.log) : exited ? 'The mirror service on the device closed right away.' : "Couldn't start mirroring on this device.");
    st.control = await connectPlain(st.port);
    if (!st.control) return fail('Could not open the control channel');
    st.control.on('error', () => {}); st.control.on('data', () => {});   // device→app messages (clipboard etc.) are ignored
    // read header: device name (64) + codec meta (12)
    const header = await readBytes(st.video, 76, 8000);
    if (!header) return fail('The device did not send video. Wake the screen and try again.');
    const name = header.subarray(0, 64).toString('utf8').replace(/\0.*$/s, '');
    const codecId = header.readUInt32BE(64), width = header.readUInt32BE(68), height = header.readUInt32BE(72);
    if (codecId !== 0x68323634) return fail('Unsupported video format from the device');
    pumpFrames(st);
    if (o.screenOff) setTimeout(() => mirrorControl(sid, Buffer.from([10, 0])), 600);
    log('mirror started', serial, width + 'x' + height, name);
    return { ok: true, sid, width, height, name: name || (g && g.info && g.info.model) || serial };
  } catch (e) { log('startMirror', e); return fail('Could not start mirroring'); }
}
function lastError(text) { const l = String(text || '').split(/\r?\n/).filter((x) => /ERROR|Exception|error:/i.test(x)).pop(); return l ? l.replace(/^.*?(ERROR|Exception):?\s*/i, '').trim() : ''; }
function readBytes(sock, n, ms) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => done(null), ms);
    const onData = (d) => { buf = Buffer.concat([buf, d]); if (buf.length >= n) { sock.pause(); if (buf.length > n) sock.unshift(buf.subarray(n)); done(buf.subarray(0, n)); } };
    const done = (v) => { clearTimeout(t); sock.removeListener('data', onData); resolve(v); };
    sock.on('data', onData); sock.once('close', () => done(null));
    sock.resume();
  });
}
function pumpFrames(st) {
  let buf = Buffer.alloc(0), need = 12, hdr = null;
  st.video.on('data', (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    for (;;) {
      if (!hdr) {
        if (buf.length < 12) break;
        const hi = buf.readUInt32BE(0), lo = buf.readUInt32BE(4), size = buf.readUInt32BE(8);
        hdr = { config: !!(hi & 0x80000000), key: !!(hi & 0x40000000), pts: (hi & 0x3fffffff) * 4294967296 + lo, size };
        buf = buf.subarray(12);
      }
      if (buf.length < hdr.size) break;
      const data = Buffer.from(buf.subarray(0, hdr.size));
      buf = buf.subarray(hdr.size);
      send('mirror-packet', { sid: st.sid, config: hdr.config, key: hdr.key, pts: hdr.pts, data });
      hdr = null;
    }
  });
  st.video.on('close', () => { if (!st.ended) endMirror(st.sid, 'The connection to the device was lost'); });
  st.video.on('error', () => {});
  st.video.resume();
}
function mirrorControl(sid, bytes) { const st = mirrors.get(sid); if (st && st.control && !st.control.destroyed) st.control.write(Buffer.from(bytes)); return !!st; }
function endMirror(sid, reason) { if (!mirrors.has(sid)) return; stopMirror(sid, reason); }
function stopMirror(sid, reason) {
  const st = mirrors.get(sid); if (!st) return;
  st.ended = true; mirrors.delete(sid); markBusy([st.id, st.serial], false);
  try { st.video && st.video.destroy(); } catch {}
  try { st.control && st.control.destroy(); } catch {}
  try { st.proc && st.proc.kill(); } catch {}
  if (st.port) adb(['-s', st.serial, 'forward', '--remove', `tcp:${st.port}`], { timeout: 5000, quiet: true });
  if (reason !== null) send('mirror-ended', { sid, reason: reason || '' });
  log('mirror stopped', st.serial, reason || '', st.log ? '| device said: ' + st.log.trim().split(/\r?\n/).slice(-6).join(' / ').slice(0, 600) : '');
}

// ── interactive shell (PTY on the device) and logcat streams
const streams = new Map(); let streamSeq = 0;
function openPty(id, cols, rows) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const sid = ++streamSeq;
  // plain line mode (no single-line editor): long commands wrap instead of scrolling sideways; Ctrl+C still works
  const init = `stty rows ${Math.max(5, rows | 0)} cols ${Math.max(20, cols | 0)} erase '^?' 2>/dev/null; export TERM=xterm-256color; exec sh -l`;
  let proc;
  try { proc = spawn(ADB, ['-s', serial, 'shell', '-t', '-t', init], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { log('pty', e); return { ok: false, msg: 'Could not open the shell' }; }
  const st = { proc, id, serial, kind: 'pty' };
  streams.set(sid, st); markBusy([id, serial], true);
  const fwd = (d) => send('pty-data', { sid, data: d.toString('utf8') });
  proc.stdout.on('data', fwd); proc.stderr.on('data', fwd);
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => log('pty proc', e));
  proc.on('exit', (code) => { if (streams.has(sid)) { streams.delete(sid); markBusy([id, serial], false); } send('pty-exit', { sid, code }); });
  return { ok: true, sid };
}
function writePty(sid, data) { const s = streams.get(sid); if (s && s.proc.stdin && s.proc.stdin.writable) s.proc.stdin.write(data); }
function closeStream(sid) {
  const s = streams.get(sid); if (!s) return;
  streams.delete(sid); if (s.kind === 'pty') markBusy([s.id, s.serial], false);
  try { if (s.kind === 'pty' && s.proc.stdin.writable) s.proc.stdin.write('\x04'); } catch {}
  setTimeout(() => { try { s.proc.kill(); } catch {} }, 300);
}
function openLogcat(id, opts = {}) {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const sid = ++streamSeq;
  const args = ['-s', serial, 'logcat', '-v', 'threadtime', '-T', String(opts.tail || 300)];
  if (opts.buffer && opts.buffer !== 'main') args.push('-b', opts.buffer);
  let proc;
  try { proc = spawn(ADB, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { log('logcat', e); return { ok: false, msg: 'Could not start logcat' }; }
  const st = { proc, id, serial, kind: 'logcat', buf: '', pending: [] };
  streams.set(sid, st);
  const flush = setInterval(() => { if (st.pending.length) send('logcat-lines', { sid, lines: st.pending.splice(0) }); }, 200);
  proc.stdout.on('data', (d) => {
    st.buf += d.toString('utf8');
    const lines = st.buf.split(/\r?\n/); st.buf = lines.pop();
    for (const l of lines) if (l && !l.startsWith('--------- beginning')) st.pending.push(l);
    if (st.pending.length > 5000) st.pending.splice(0, st.pending.length - 5000);
  });
  proc.stderr.on('data', (d) => { const t = d.toString('utf8').trim(); if (t) st.pending.push('00-00 00:00:00.000     0     0 E ADB: ' + t); });
  proc.on('error', (e) => log('logcat proc', e));
  proc.on('exit', (code) => { clearInterval(flush); if (st.pending.length) send('logcat-lines', { sid, lines: st.pending.splice(0) }); streams.delete(sid); send('logcat-exit', { sid, code }); });
  return { ok: true, sid };
}

// ── "adb …" command line (runs real adb with the selected device)
function splitArgs(s) {
  const out = []; let cur = '', quote = null, any = false;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}
async function adbCommand(id, line) {
  let args = splitArgs(clean(line).replace(/^adb(\.exe)?\s+/i, ''));
  if (!args.length) return { ok: false, out: 'Type a command, e.g. devices, install app.apk, reverse tcp:8081 tcp:8081' };
  const global = ['devices', 'connect', 'disconnect', 'pair', 'version', 'mdns', 'start-server', 'kill-server', 'help'];
  if (args[0] !== '-s' && !global.includes(args[0])) { const s = liveSerial(id); if (s) args = ['-s', s, ...args]; }
  const verb = args[args[0] === '-s' ? 2 : 0] || '';
  const long = /^(install|install-multiple|push|pull|sideload|bugreport|backup|restore)$/.test(verb);
  if (verb === 'logcat' && !args.includes('-d')) args.push('-d');
  if (verb === 'shell' && args.length === (args[0] === '-s' ? 3 : 1)) return { ok: false, out: 'For an interactive shell use the terminal above. Here, add a command: shell ls /sdcard' };
  const r = await adb(args, { timeout: long ? 30 * 60 * 1000 : 60000 });
  return { ok: r.ok, out: clean(String(r.out) + (r.err ? '\n' + r.err : '')) || (r.ok ? '(done — no output)' : 'Command failed') };
}

// ───────────────────────── window ─────────────────────────
function createWindow() {
  try {
    const { screen } = require('electron');
    const w = settings.window;
    if (w && w.x != null && !screen.getAllDisplays().some((d) => w.x < d.bounds.x + d.bounds.width - 100 && w.x + (w.width || 800) > d.bounds.x + 100 && w.y >= d.bounds.y - 20 && w.y < d.bounds.y + d.bounds.height - 100)) { delete w.x; delete w.y; }
  } catch {}
  const b = settings.window || {};
  win = new BrowserWindow({
    width: Math.max(760, b.width || 1120), height: Math.max(560, b.height || 800), x: b.x, y: b.y, minWidth: 760, minHeight: 560,
    title: 'ADB Connector', backgroundColor: '#F7F5FB', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { if (b.maximized) win.maximize(); win.show(); });
  win.on('close', () => { try { settings.window = { ...win.getNormalBounds(), maximized: win.isMaximized() }; saveSettings(); } catch {} });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, d) => { log('renderer gone', d); if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => { try { lastJson = ''; win.reload(); } catch {} }, 500); });
  win.webContents.on('unresponsive', () => log('renderer unresponsive'));
  win.webContents.on('console-message', (e, level, message) => { const lv = typeof level === 'number' ? level : e && e.level; const msg = message || (e && e.message); if (lv >= 3 || lv === 'error') log('renderer:', msg); });
  win.on('closed', () => { win = null; });
  const ses = win.webContents.session;
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const list = details.deviceList || [];
    if (!list.length) return callback();
    if (list.length === 1) return callback(list[0].deviceId);
    send('usb-choose', list.map((d) => ({ id: d.deviceId, name: [d.manufacturerName, d.productName].filter(Boolean).join(' ') || d.serialNumber || 'USB device' })));
    ipcMain.once('usb-chosen', (_e, cid) => { try { callback(cid || undefined); } catch (e) { log('usb cb', e); } });
  });
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((d) => d.deviceType === 'usb');
}

// ───────────────────────── IPC ─────────────────────────
function handle(ch, fn) {
  ipcMain.handle(ch, async (...a) => {
    try { return await fn(...a); }
    catch (e) { log('ipc', ch, e); return { ok: false, msg: 'Something went wrong. Please try again.' }; }
  });
}
const ok = (msg, extra) => ({ ok: true, msg, ...extra });
handle('devices', () => (lastJson ? JSON.parse(lastJson) : groups));
handle('connect', (_e, a) => connectTo(a));
handle('disconnect', async (_e, d) => {
  for (const s of [d.serial, ...(d.aliases || [])]) { if (isIpPort(s)) setAuto(s.split(':')[0], false); await adb(['disconnect', s], { timeout: 5000, quiet: true }); }
  if (d.forget) { if (d.ip) forgetIp(d.ip); for (const s of [d.serial, ...(d.aliases || [])]) if (isIpPort(s)) forgetIp(s.split(':')[0]); }
  lastJson = ''; await poll();
  return ok(d.forget ? 'Removed' : 'Disconnected');
});
handle('reconnect', (_e, ip) => reconnect(ip));
handle('scan', () => scanLan());
handle('pair-code', (_e, a, c) => pairWithCode(a, c));
handle('pair-cancel', () => { if (pairJob) pairJob.cancelled = true; return ok(); });
handle('pair-qr-start', () => startQrPair());
handle('pair-qr-cancel', () => { if (qrJob) qrJob.cancelled = true; return ok(); });
handle('usb-to-wifi', (_e, id) => usbToWifi(liveSerial(id) || id));
handle('run', async (_e, id, cmd, timeout) => {
  const serial = liveSerial(id); if (!serial) return { ok: false, out: '', msg: 'The device is not connected' };
  const r = await sh(serial, cmd, { timeout: Math.min(+timeout || 20000, 600000), quiet: true });
  return { ok: r.ok, out: String(r.out || ''), err: r.err, msg: r.ok ? '' : friendly(r) };
});
handle('run-bytes', async (_e, id, cmd) => {
  const serial = liveSerial(id); if (!serial) return null;
  const r = await adb(['-s', serial, 'exec-out', cmd], { timeout: 30000, encoding: 'buffer', quiet: true });
  return r.ok ? r.out : null;
});
handle('frame', (_e, id) => frame(id));
// long or multi-line shell input: copy it to the device as a script (avoids the terminal's line-length limit)
handle('push-text', async (_e, id, text, remote) => {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const tmp = tmpPath('.sh'); fs.writeFileSync(tmp, String(text).replace(/\r\n?/g, '\n') + '\n');
  try { const r = await adb(['-s', serial, 'push', tmp, remote], { timeout: 30000 }); return { ok: r.ok, msg: r.ok ? '' : friendly(r) }; }
  finally { fs.unlink(tmp, () => {}); }
});
handle('adb-command', (_e, id, line) => adbCommand(id, line));
handle('install', (_e, id, files, asSplit) => install(id, files, asSplit));
handle('install-downgrade', (_e, id, file, pkg, keepData, splitFiles) => installAfterRemove(id, file, pkg, keepData, splitFiles));
handle('push', (_e, id, files, dir) => pushFiles(id, files, dir));
handle('pull', async (_e, id, remotes, ask) => {
  let dest = null;
  if (ask) { const r = await dialog.showOpenDialog(win, { title: 'Save to folder', properties: ['openDirectory', 'createDirectory'], defaultPath: outDir('file') }); if (r.canceled) return { ok: false, cancelled: true }; dest = r.filePaths[0]; }
  return pullFiles(id, remotes, dest);
});
handle('extract-apk', async (_e, id, pkg) => {
  const serial = liveSerial(id); if (!serial) return { ok: false, msg: 'The device is not connected' };
  const r = await sh(serial, `pm path ${q(pkg)}`, { timeout: 15000 });
  const paths = r.out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
  if (!paths.length) return { ok: false, msg: 'Could not find the app files' };
  const dir = path.join(outDir('apk'), pkg); fs.mkdirSync(dir, { recursive: true });
  const res = await pullFiles(id, paths, dir);
  if (res.ok) { const it = await libraryAdd(res.files.filter((f) => /\.apk$/i.test(f)), 'saved'); if (it) addHistory({ action: 'saved', ok: true, device: deviceTitle(id), pkg: it.pkg, label: it.label, versionName: it.versionName, item: it.id }); }
  if (res.ok) return { ok: true, file: res.files.length === 1 ? res.file : dir, msg: paths.length > 1 ? `Saved ${paths.length} APK parts` : 'APK saved' };
  return res;
});
handle('app-labels', (_e, id, force) => appLabels(id, force));
handle('app-meta', (_e, id, pkgs) => appMeta(id, pkgs || []));
handle('library-list', () => libraryList());
handle('library-add', async (_e, files) => {
  const list = [].concat(files || []); let n = 0, bad = 0;
  const apks = list.filter((f) => /\.apk$/i.test(f)), bundles = list.filter((f) => /\.(apks|xapk|apkm)$/i.test(f));
  for (const f of [...apks.map((x) => [x]), ...bundles.map((x) => [x])]) { const it = await libraryAdd(f, 'added'); if (it) n++; else bad++; }
  return n ? { ok: true, msg: `Added ${n} app${n > 1 ? 's' : ''} to the library${bad ? ` (${bad} could not be read)` : ''}` } : { ok: false, msg: 'Could not read these files as Android apps' };
});
handle('library-remove', (_e, itemId) => libraryRemove(itemId));
handle('library-folder', () => shell.openPath(libDir()));
handle('history-add', (_e, e) => { addHistory({ ...e, device: e.device || deviceTitle(e.id) }); return true; });
handle('history-clear', () => { loadLibrary(); library.history = []; saveLibrary(); return ok('History cleared'); });
handle('screenshot', (_e, id) => screenshot(id));
handle('record-start', (_e, id, o) => startRecording(id, o));
handle('record-stop', (_e, id) => stopRecording(id));
handle('scrcpy', (_e, id, o) => launchScrcpy(id, o));
handle('mirror-start', (_e, id, o) => startMirror(id, o));
handle('mirror-stop', (_e, sid) => { stopMirror(sid, ''); return true; });
ipcMain.on('mirror-control', (_e, sid, bytes) => { try { mirrorControl(sid, bytes); } catch (e) { log('mirror-control', e); } });
handle('pty-open', (_e, id, c, r) => openPty(id, c, r));
handle('pty-write', (_e, sid, d) => { writePty(sid, d); return true; });
handle('stream-close', (_e, sid) => { closeStream(sid); return true; });
handle('logcat-open', (_e, id, o) => openLogcat(id, o));
handle('logcat-save', async (_e, text) => { const f = path.join(outDir('log'), `logcat-${stamp()}.txt`); fs.writeFileSync(f, text); return { ok: true, file: f, msg: 'Log saved' }; });
handle('pick-files', async (_e, kind) => {
  const filters = kind === 'apk' ? [{ name: 'Android apps', extensions: ['apk', 'apks', 'xapk', 'apkm'] }] : [];
  const r = await dialog.showOpenDialog(win, { title: kind === 'apk' ? 'Choose apps to install' : 'Choose files to upload', properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? [] : r.filePaths;
});
handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
handle('save-file', (_e, kind, bytes, ext) => { const file = path.join(outDir(kind), `${kind}-${stamp()}.${ext}`); fs.writeFileSync(file, Buffer.from(bytes)); return { ok: true, file }; });
handle('open-file', (_e, f) => shell.openPath(f));
handle('show-file', (_e, f) => { shell.showItemInFolder(f); return true; });
handle('open-folder', (_e, kind) => shell.openPath(outDir(kind)));
handle('open-log', () => { log('log opened'); shell.showItemInFolder(userFile('log.txt')); return ok(); });
handle('copy', (_e, t) => { clipboard.writeText(String(t)); return true; });
handle('copy-image', (_e, f) => { const img = nativeImage.createFromPath(f); if (img.isEmpty()) return { ok: false, msg: 'Could not copy' }; clipboard.writeImage(img); return ok('Copied to clipboard'); });
handle('settings-get', () => settings);
handle('settings-set', (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
handle('webadb-begin', async () => { paused = true; await adb(['kill-server'], { timeout: 8000, quiet: true }); return ok(); });
handle('webadb-end', async () => { await startServer(); paused = false; lastJson = ''; poll(); return ok(); });
handle('adb-version', async () => { const r = await adb(['version'], { timeout: 10000, quiet: true }); return (r.out.match(/version ([\d.]+)/) || [])[1] || null; });
handle('app-version', () => app.getVersion());


// ───────────────────────── updates (GitHub Releases) ─────────────────────────
let quitting = false;
let updater = null;
let installWhenReady = false, dlBytes = 0, dlTotal = 0;
function installNow() { if (!updater) return; quitting = true; for (const sid of [...streams.keys()]) closeStream(sid); for (const sid of [...mirrors.keys()]) stopMirror(sid, null); setTimeout(() => updater.quitAndInstall(true, true), 300); }
let updateState = { state: 'idle', current: app.getVersion() };
function setUpdate(patch) { updateState = { ...updateState, ...patch, current: app.getVersion() }; send('update-state', updateState); }
function canUpdate() { return app.isPackaged && isWin && !process.env.PORTABLE_EXECUTABLE_DIR; }
function initUpdater() {
  if (!canUpdate()) { setUpdate({ state: app.isPackaged ? 'portable' : 'dev' }); return; }
  try { updater = require('electron-updater').autoUpdater; } catch (e) { log('updater load', e); setUpdate({ state: 'error', msg: 'Updater is missing' }); return; }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = { info: (m) => log('update', m), warn: (m) => log('update warn', m), error: (m) => log('update error', m), debug: () => {} };
  updater.on('checking-for-update', () => { if (!['downloading', 'ready', 'installing'].includes(updateState.state)) setUpdate({ state: 'checking' }); });
  updater.on('update-available', (i) => setUpdate({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes.replace(/<[^>]+>/g, '').trim().slice(0, 2000) : '', date: i.releaseDate }));
  updater.on('update-not-available', () => setUpdate({ state: 'none', checkedAt: Date.now() }));
  // electron-updater reports odd percentages during differential (patch) downloads → compute and clamp it ourselves
  updater.on('download-progress', (p) => {
    let pct = p.total > 0 ? (p.transferred / p.total) * 100 : +p.percent || 0;
    if (!(pct >= 0)) pct = 0;
    pct = Math.min(99, Math.max(updateState.percent || 0, Math.floor(pct)));
    dlBytes = Math.max(dlBytes, p.transferred || 0); dlTotal = p.total || dlTotal;
    if (pct !== updateState.percent || updateState.state !== 'downloading') setUpdate({ state: 'downloading', percent: pct });
  });
  updater.on('update-downloaded', (i) => {
    const full = (i.files && i.files[0] && i.files[0].size) || 0;
    const patch = dlBytes > 0 && full > 0 && dlBytes < full * 0.8;
    log('update downloaded', i.version, 'bytes', dlBytes, 'of full', full);
    if (installWhenReady) { setUpdate({ state: 'installing', version: i.version, percent: 100, patchMB: patch ? Math.max(1, Math.round(dlBytes / 1048576)) : 0, fullMB: Math.round(full / 1048576) }); setTimeout(installNow, 1800); }
    else setUpdate({ state: 'ready', version: i.version, percent: 100 });
  });
  updater.on('error', (e) => { log('update error', e && e.message); setUpdate({ state: updateState.state === 'downloading' ? 'available' : 'error', msg: /net::|ENOTFOUND|ETIMEDOUT|ECONN/i.test(String(e && e.message)) ? 'No internet connection' : 'Could not check for updates' }); });
  const check = () => { if (['downloading', 'ready', 'installing'].includes(updateState.state)) return; updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
handle('update-state', () => updateState);
handle('update-check', async () => { if (!updater) return updateState; try { await updater.checkForUpdates(); } catch {} return updateState; });
// one click: download (only the changed parts when possible), then restart into the new version by itself
handle('update-download', async () => {
  if (!updater) return { ok: false };
  if (updateState.state === 'ready') { setUpdate({ state: 'installing' }); setTimeout(installNow, 800); return { ok: true }; }
  if (updateState.state === 'downloading' || updateState.state === 'installing') return { ok: true };
  installWhenReady = true; dlBytes = 0; dlTotal = 0;
  setUpdate({ state: 'downloading', percent: 0 });
  try { await updater.downloadUpdate(); return { ok: true }; } catch (e) { installWhenReady = false; setUpdate({ state: 'available', percent: 0 }); return { ok: false, msg: 'The update could not be downloaded. Check the internet connection and try again.' }; }
});
handle('update-install', () => { if (updater && updateState.state === 'ready') installNow(); return true; });
handle('open-releases', () => shell.openExternal('https://github.com/angreenade/adb-connector/releases'));

// ───────────────────────── lifecycle ─────────────────────────
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  loadSettings();
  log('start', app.getVersion(), process.platform, ADB);
  known = loadKnown();
  createWindow();
  prepareTools();
  const okStart = await startServer();
  if (!okStart) send('adb-status', { ok: false, msg: 'Could not start ADB. Restart the app, or check that antivirus is not blocking adb.exe.' });
  poll();
  setInterval(poll, 2000);
  setTimeout(autoReconnect, 2000);
  setInterval(autoReconnect, 12000);
  initUpdater();
}).catch((e) => log('whenReady', e));

app.on('window-all-closed', () => {
  if (quitting) return; quitting = true;
  (async () => {
    for (const sid of [...streams.keys()]) closeStream(sid);
    for (const sid of [...mirrors.keys()]) stopMirror(sid, null);
    try { for (const id of [...recordings.keys()]) await Promise.race([stopRecording(id), sleep(8000)]); } catch {}
    try { await adb(['kill-server'], { timeout: 4000, quiet: true }); } catch {}
    app.exit(0);
  })();
});
