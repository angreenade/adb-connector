import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api, $, $$, esc, icon, toast, ops, needDevice, store, deviceName, setSettings, sameDevice } from '../core.js';

const SNIPPETS = [
  ['My apps', 'pm list packages -3'], ['Battery', 'dumpsys battery'], ['Storage', 'df -h'], ['Running tasks', 'top -n 1 -b | head -25'],
  ['Properties', 'getprop | head -80'], ['Wi-Fi info', 'ip addr show wlan0'], ['Current app', "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -3"],
  ['Screen size', 'wm size; wm density'], ['Files', 'ls -la /sdcard'], ['Recent errors', 'logcat -d -v brief *:E | tail -40'],
  ['Grant permission', 'pm grant PACKAGE android.permission.BLUETOOTH_CONNECT'], ['Open settings', 'am start -a android.settings.SETTINGS'],
];
// words offered by Tab completion (plus the device's package names)
const WORDS = ['pm', 'list', 'packages', 'grant', 'revoke', 'install', 'uninstall', 'clear', 'path', 'disable-user', 'enable', 'am', 'start', 'force-stop', 'broadcast', 'kill-all',
  'dumpsys', 'battery', 'activity', 'package', 'window', 'meminfo', 'cpuinfo', 'settings', 'get', 'put', 'system', 'secure', 'global', 'getprop', 'setprop', 'input', 'keyevent', 'tap', 'swipe', 'text',
  'wm', 'size', 'density', 'reset', 'cmd', 'svc', 'wifi', 'bluetooth', 'power', 'stayon', 'logcat', 'screencap', 'screenrecord', 'monkey', 'ls', 'cd', 'cat', 'rm', 'mkdir', 'mv', 'cp', 'df', 'du', 'ps', 'top', 'kill', 'pidof', 'grep', 'head', 'tail', 'echo', 'reboot',
  'android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.POST_NOTIFICATIONS', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.BODY_SENSORS', 'android.permission.WRITE_SECURE_SETTINGS',
  '/sdcard/', '/sdcard/Download/', '/data/local/tmp/'];
const SCRIPT = '/data/local/tmp/.adbconnector_cmd.sh';
const LONG = 700;   // longer commands run as a script so the terminal's line limit never cuts them

function themeColors() {
  const dark = document.documentElement.dataset.mode === 'dark';
  return { background: dark ? '#0F0D15' : '#16131F', foreground: '#ECE8F5', cursor: '#B9A8FF', selectionBackground: '#3B3360', black: '#1B1824', brightBlack: '#6E6884' };
}
// split pasted text into device commands and computer-side "adb …" commands, in order
function parseInput(text) {
  const out = [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    // several "adb shell …" pasted on one line → separate commands
    const parts = raw.split(/\s+(?=adb(?:\.exe)?\s)/i);
    for (let p of parts) {
      const m = p.match(/^\s*adb(?:\.exe)?(\s+-s\s+\S+)?\s+(.*)$/i);
      if (m) {
        const rest = m[2];
        if (/^shell\s+/i.test(rest)) out.push({ kind: 'sh', line: rest.replace(/^shell\s+/i, '') });
        else if (/^shell\s*$/i.test(rest)) continue;
        else out.push({ kind: 'adb', line: rest });
      } else out.push({ kind: 'sh', line: p });
    }
  }
  // drop leading/trailing empty device lines
  while (out.length && out[0].kind === 'sh' && !out[0].line.trim()) out.shift();
  while (out.length && out[out.length - 1].kind === 'sh' && !out[out.length - 1].line.trim()) out.pop();
  return out;
}

export const page = {
  id: 'shell', title: 'Shell', icon: 'terminal',
  devId: null, sess: null, term: null, hist: [], hi: -1, draft: '', packages: [],
  mount(el) {
    this.el = el;
    el.innerHTML = `
      <div class="shell-page">
        <header class="page-head"><div><h1>Shell</h1><p class="sub" id="shSub">Run any command on the device — or any adb command on this computer.</p></div>
          <div class="row" id="shTools"><button class="btn tonal sm" id="shRestart">${icon('refresh')}New session</button><button class="btn text sm" id="shClear">Clear</button><button class="btn text sm" id="shCopy">${icon('copy')}Copy</button>
          <button class="icon-btn" id="shSmaller" title="Smaller text"><b>A−</b></button><button class="icon-btn" id="shBigger" title="Larger text"><b>A+</b></button></div></header>
        <div id="shNoDev"></div>
        <div id="shBody">
          <div class="term-wrap" id="termWrap"><div id="term"></div><div class="term-overlay hidden" id="termOverlay"><span></span><button class="btn filled sm" id="shReopen">Reconnect</button></div></div>
          <form class="cmd-bar" id="cmdForm">
            <span class="cmd-prompt">$</span>
            <textarea id="cmdInput" rows="1" spellcheck="false" autocomplete="off" placeholder="Type or paste a command, then press Enter"></textarea>
            <button type="button" class="btn text sm" id="cmdStop" title="Stop the running command (Ctrl+C)">${icon('stop')}Stop</button>
            <button class="btn filled sm" id="cmdRun">${icon('play')}Run</button>
          </form>
          <div class="cmd-suggest hidden" id="cmdSuggest"></div>
          <div class="snips">${SNIPPETS.map(([n, c], i) => `<button class="chip" data-s="${i}" title="${esc(c)}">${esc(n)}</button>`).join('')}</div>
          <p class="muted small shell-hint">Shift+Enter adds a line, ↑ ↓ browse history, Tab completes. Commands like <code>adb install app.apk</code> or <code>adb reverse tcp:8081 tcp:8081</code> run on this computer for the selected device. Pasting <code>adb shell …</code> works too. You can also click in the terminal and type directly — needed for programs like <code>top</code>.</p>
        </div>
      </div>`;
    this.fontSize = 14;
    this.hist = Array.isArray(store.settings.shellHistory) ? store.settings.shellHistory.slice(-200) : [];
    $('#shRestart', el).onclick = () => this.open(true);
    $('#shReopen', el).onclick = () => this.open(true);
    $('#shClear', el).onclick = () => this.term && this.term.clear();
    $('#shCopy', el).onclick = () => { if (!this.term) return; this.term.selectAll(); const t = this.term.getSelection(); this.term.clearSelection(); api.copy(t); toast('Terminal text copied'); };
    $('#shSmaller', el).onclick = () => this.zoom(-1);
    $('#shBigger', el).onclick = () => this.zoom(1);
    $('#cmdStop', el).onclick = () => { if (this.sess) this.sess.write('\x03'); $('#cmdInput', el).focus(); };
    $$('[data-s]', el).forEach((b) => (b.onclick = () => { const c = SNIPPETS[+b.dataset.s][1]; this.setInput(c); const i = $('#cmdInput', el); if (c.includes('PACKAGE')) { const k = c.indexOf('PACKAGE'); i.setSelectionRange(k, k + 7); } }));
    const input = $('#cmdInput', el);
    input.addEventListener('input', () => { this.autosize(); this.hideSuggest(); });
    input.addEventListener('keydown', (e) => this.onInputKey(e));
    $('#cmdForm', el).onsubmit = (e) => { e.preventDefault(); this.submit(); };
    new ResizeObserver(() => this.fit()).observe($('#termWrap', el));
  },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  show(dev) {
    const el = this.el;
    if (dev && sameDevice(this.devId, dev)) this.devId = dev.id;
    $('#shBody', el).classList.toggle('hidden', !dev);
    $('#shTools', el).classList.toggle('hidden', !dev);
    if (!dev) { needDevice($('#shNoDev', el), 'the shell'); this.devId = null; this.closeSess(); return; }
    $('#shNoDev', el).innerHTML = '';
    $('#shSub', el).textContent = `Run any command on ${deviceName(dev)} — or any adb command on this computer.`;
    if (!this.term) this.createTerm();
    if (this.devId !== dev.id || (!this.sess && !this.ended)) { this.devId = dev.id; this.open(true); this.loadPackages(); }
    setTimeout(() => { this.fit(); $('#cmdInput', el).focus(); }, 30);
  },
  hide() {},
  async loadPackages() {
    const d = this.dev(); if (!d) return;
    const out = await ops(d).text('pm list packages', 20000);
    this.packages = out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
  },

  // ───── terminal ─────
  createTerm() {
    this.term = new Terminal({ fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace', fontSize: this.fontSize, cursorBlink: true, scrollback: 10000, allowProposedApi: true, theme: themeColors(), convertEol: true });
    this.fitter = new FitAddon();
    this.term.loadAddon(this.fitter);
    this.term.open($('#term', this.el));
    // typing straight into the terminal (for interactive programs); a typed "adb shell …" line is fixed on Enter
    let line = '';
    this.term.onData((data) => {
      if (!this.sess) return;
      if (data === '\r') {
        if (/^\s*adb(\.exe)?\s/i.test(line)) { this.sess.write('\x15'); const t = line; line = ''; this.run(t); return; }
        line = ''; this.sess.write('\r'); return;
      }
      if (data === '\x7f') line = line.slice(0, -1);
      else if (data === '\x03' || data === '\x15') line = '';
      else if (data.length > 1 && /[\r\n]/.test(data)) { line = ''; this.run(data); return; }   // multi-line paste → same path as the command box
      else if (!data.startsWith('\x1b')) line += data;
      this.sess.write(data);
    });
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && this.term.hasSelection()) { api.copy(this.term.getSelection()); this.term.clearSelection(); return false; }
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') { navigator.clipboard.readText().then((t) => t && this.term.paste(t)).catch(() => {}); return false; }
      return true;
    });
    new MutationObserver(() => { if (this.term) this.term.options.theme = themeColors(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
  },
  fit() { try { if (this.fitter && !this.el.closest('.hidden') && $('#termWrap', this.el).offsetWidth) this.fitter.fit(); } catch {} },
  zoom(d) { this.fontSize = Math.max(10, Math.min(22, this.fontSize + d)); if (this.term) { this.term.options.fontSize = this.fontSize; this.fit(); } },
  closeSess() { if (this.sess) { try { this.sess.close(); } catch {} this.sess = null; } },
  async open(fresh) {
    const dev = this.dev(); if (!dev) return;
    this.closeSess(); this.ended = false;
    const ov = $('#termOverlay', this.el); ov.classList.add('hidden');
    if (fresh) { this.term.reset(); this.term.writeln(`\x1b[2mConnecting to ${deviceName(dev)}…\x1b[0m`); }
    this.fit();
    const token = (this.token = {});
    let first = true;
    const s = await ops(dev).openShell(this.term.cols, this.term.rows, (data) => {
      if (this.token !== token) return;
      this.term.write(data);
      // first output = the shell is ready: switch it to plain line mode so long lines wrap, then clear the screen
      if (first) { first = false; setTimeout(() => this.sess && this.sess.write('set +o emacs 2>/dev/null; set +o vi 2>/dev/null; clear\r'), 150); }
    }, () => {
      if (this.token !== token) return;
      this.sess = null; this.ended = true;
      $('span', ov).textContent = 'The session ended.'; ov.classList.remove('hidden');
    });
    if (this.token !== token) { if (s.ok) s.close(); return; }
    if (!s.ok) { this.ended = true; this.term.writeln(`\x1b[31m${s.msg || 'Could not open a shell'}\x1b[0m`); $('span', ov).textContent = s.msg || 'Could not open a shell.'; ov.classList.remove('hidden'); return; }
    this.sess = s;
  },

  // ───── command box ─────
  autosize() { const i = $('#cmdInput', this.el); i.style.height = 'auto'; i.style.height = Math.min(220, i.scrollHeight) + 'px'; },
  setInput(v) { const i = $('#cmdInput', this.el); i.value = v; this.autosize(); i.focus(); i.setSelectionRange(v.length, v.length); },
  onInputKey(e) {
    const i = e.target;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return this.submit(); }
    if (e.key === 'c' && e.ctrlKey && i.selectionStart === i.selectionEnd) { e.preventDefault(); if (this.sess) this.sess.write('\x03'); return; }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.term && this.term.clear(); return; }
    if (e.key === 'Tab') { e.preventDefault(); return this.complete(); }
    if (e.key === 'Escape') { this.hideSuggest(); return; }
    const before = i.value.slice(0, i.selectionStart), after = i.value.slice(i.selectionEnd);
    if (e.key === 'ArrowUp' && !before.includes('\n') && this.hist.length) {
      e.preventDefault();
      if (this.hi === -1) this.draft = i.value;
      this.hi = Math.min(this.hist.length - 1, this.hi + 1);
      this.setInput(this.hist[this.hist.length - 1 - this.hi]);
    } else if (e.key === 'ArrowDown' && !after.includes('\n') && this.hi >= 0) {
      e.preventDefault();
      this.hi--;
      this.setInput(this.hi >= 0 ? this.hist[this.hist.length - 1 - this.hi] : this.draft);
    }
  },
  complete() {
    const i = $('#cmdInput', this.el);
    const pos = i.selectionStart, before = i.value.slice(0, pos);
    const m = before.match(/[^\s'"]*$/); const word = m ? m[0] : '';
    if (!word) return;
    const pool = [...new Set([...WORDS, ...this.packages])];
    const hits = pool.filter((w) => w.startsWith(word) && w !== word);
    if (!hits.length) return this.hideSuggest();
    // longest common prefix
    let common = hits[0];
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    const insert = (txt) => { i.value = before.slice(0, before.length - word.length) + txt + i.value.slice(pos); const c = before.length - word.length + txt.length; i.setSelectionRange(c, c); this.autosize(); i.focus(); };
    if (hits.length === 1) { insert(hits[0] + ' '); return this.hideSuggest(); }
    if (common.length > word.length) insert(common);
    const box = $('#cmdSuggest', this.el);
    box.innerHTML = hits.slice(0, 40).map((h) => `<button type="button" class="chip" data-w="${esc(h)}">${esc(h)}</button>`).join('') + (hits.length > 40 ? `<span class="muted small">+${hits.length - 40} more — keep typing</span>` : '');
    box.classList.remove('hidden');
    $$('[data-w]', box).forEach((b) => (b.onclick = () => { const cur = i.value.slice(0, i.selectionStart).match(/[^\s'"]*$/)[0]; const bp = i.selectionStart; i.value = i.value.slice(0, bp - cur.length) + b.dataset.w + ' ' + i.value.slice(bp); const c = bp - cur.length + b.dataset.w.length + 1; i.setSelectionRange(c, c); this.hideSuggest(); i.focus(); }));
  },
  hideSuggest() { const b = $('#cmdSuggest', this.el); if (b) b.classList.add('hidden'); },
  submit() {
    const i = $('#cmdInput', this.el);
    const text = i.value;
    if (!text.trim()) { if (this.sess) this.sess.write('\r'); return; }
    this.hist = this.hist.filter((h) => h !== text); this.hist.push(text); if (this.hist.length > 200) this.hist.shift();
    this.hi = -1; this.draft = '';
    clearTimeout(this.saveT); this.saveT = setTimeout(() => setSettings({ shellHistory: this.hist }), 800);
    i.value = ''; this.autosize(); this.hideSuggest();
    this.run(text);
  },
  async run(text) {
    const dev = this.dev(); if (!dev) return toast('The device is not connected', { error: true });
    if (!this.sess) { await this.open(false); await new Promise((r) => setTimeout(r, 600)); }
    const parts = parseInput(text);
    // group consecutive device lines so a pasted script runs as one piece
    const groups = [];
    for (const p of parts) { const g = groups[groups.length - 1]; if (g && g.kind === 'sh' && p.kind === 'sh') g.lines.push(p.line); else groups.push({ kind: p.kind, lines: [p.line] }); }
    for (const g of groups) {
      if (g.kind === 'adb') {
        for (const l of g.lines) {
          this.term.write(`\r\n\x1b[38;5;141m⬢ adb ${l}\x1b[0m\r\n`);
          const r = await ops(dev).adbCommand(l);
          this.term.write(String(r.out || r.msg || '').replace(/\r?\n/g, '\r\n') + '\r\n');
        }
        if (this.sess) this.sess.write('\r');
        continue;
      }
      const script = g.lines.join('\n');
      if (!this.sess) { this.term.writeln('\x1b[31mNo shell session — press Reconnect.\x1b[0m'); return; }
      if (script.length <= LONG && g.lines.length === 1) { this.sess.write(script + '\r'); continue; }
      // long or multi-line: show it in full, copy it to the device and run it in this same shell
      const r = await ops(dev).pushText(script, SCRIPT);
      if (!r.ok) { this.term.writeln(`\r\n\x1b[31mCould not send the command: ${r.msg || ''}\x1b[0m`); continue; }
      this.term.write(`\r\n\x1b[2m${script.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
      this.sess.write(`. ${SCRIPT}; rm -f ${SCRIPT}\r`);
    }
  },
};
