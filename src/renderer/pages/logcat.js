import { api, $, $$, esc, icon, toast, ops, needDevice, store, q, busyBtn , sameDevice } from '../core.js';

const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];
const MAX = 20000;
// threadtime: "10-11 12:00:00.123  1234  5678 I Tag     : message"
const RE = /^(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s(.*)$/;

export const page = {
  id: 'logcat', title: 'Logcat', icon: 'logs',
  devId: null, lines: [], running: false, paused: false, follow: true, level: 'V', text: '', pids: null, pkg: '',
  mount(el) {
    this.el = el;
    el.innerHTML = `
      <div class="logcat-page">
        <header class="page-head"><div><h1>Logcat</h1><p class="sub">Live system and app logs. Filter by level, text or app.</p></div></header>
        <div id="lcNoDev"></div>
        <div class="lc-toolbar" id="lcBar">
          <button class="btn filled sm" id="lcRun">${icon('play')}Start</button>
          <div class="seg" id="lcLevel">${LEVELS.slice(0, 5).map((l) => `<button data-l="${l}" class="${l === 'V' ? 'on' : ''}" title="${{ V: 'Everything', D: 'Debug and above', I: 'Info and above', W: 'Warnings and errors', E: 'Errors only' }[l]}">${{ V: 'All', D: 'Debug', I: 'Info', W: 'Warn', E: 'Error' }[l]}</button>`).join('')}</div>
          <div class="search">${icon('search')}<input id="lcFind" placeholder="Filter text or tag" spellcheck="false" /></div>
          <div class="search">${icon('apps')}<input id="lcPkg" placeholder="Only this app (package)" spellcheck="false" list="lcPkgs" /><datalist id="lcPkgs"></datalist></div>
          <label class="check"><input type="checkbox" id="lcFollow" checked><span>Auto-scroll</span></label>
          <span class="lc-actions"><button class="icon-btn" id="lcSave" title="Save to file">${icon('save')}</button>
          <button class="icon-btn" id="lcCopy" title="Copy visible lines">${icon('copy')}</button>
          <button class="icon-btn" id="lcClear" title="Clear (also on device)">${icon('trash')}</button></span>
        </div>
        <div class="lc-view" id="lcView" tabindex="0"><div class="lc-empty" id="lcEmpty">Press <b>Start</b> to stream logs from the device.</div></div>
        <div class="lc-status" id="lcStatus">&nbsp;</div>
      </div>`;
    $('#lcRun', el).onclick = () => (this.running ? this.stop() : this.start());
    $$('#lcLevel button', el).forEach((b) => (b.onclick = () => { this.level = b.dataset.l; $$('#lcLevel button', el).forEach((x) => x.classList.toggle('on', x === b)); this.rerender(); }));
    let t; $('#lcFind', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { this.text = e.target.value.toLowerCase(); this.rerender(); }, 150); };
    $('#lcPkg', el).onchange = async (e) => { this.pkg = e.target.value.trim(); await this.resolvePids(); this.rerender(); };
    $('#lcFollow', el).onchange = (e) => { this.follow = e.target.checked; if (this.follow) this.scrollEnd(); };
    const view = $('#lcView', el);
    view.addEventListener('scroll', () => { const atEnd = view.scrollHeight - view.scrollTop - view.clientHeight < 40; if (!atEnd && this.follow) { this.follow = false; $('#lcFollow', el).checked = false; } });
    $('#lcSave', el).onclick = async () => { const r = await api.logcatSave(this.lines.join('\n')); toast(r.msg, { action: () => api.showFile(r.file), actionLabel: 'Show in folder' }); };
    $('#lcCopy', el).onclick = () => { api.copy(this.lines.filter((l) => this.match(l)).join('\n')); toast('Copied visible lines'); };
    $('#lcClear', el).onclick = (e) => busyBtn(e.currentTarget, async () => { this.lines = []; this.rerender(); const d = this.dev(); if (d) await ops(d).run('logcat -c', 10000); toast('Log cleared'); });
  },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  show(dev) {
    const el = this.el;
    $('#lcBar', el).classList.toggle('hidden', !dev); $('#lcView', el).classList.toggle('hidden', !dev);
    if (!dev) { this.stop(); this.devId = null; return needDevice($('#lcNoDev', el), 'logcat'); }
    $('#lcNoDev', el).innerHTML = '';
    if (sameDevice(this.devId, dev)) this.devId = dev.id;
    if (this.devId !== dev.id) { this.stop(); this.devId = dev.id; this.lines = []; this.rerender(); this.loadPkgs(); }
  },
  async loadPkgs() { const d = this.dev(); if (!d) return; const out = await ops(d).text('pm list packages -3', 20000); $('#lcPkgs', this.el).innerHTML = out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).map((p) => `<option value="${esc(p)}">`).join(''); },
  async resolvePids() {
    if (!this.pkg) { this.pids = null; $('#lcStatus', this.el).innerHTML = '&nbsp;'; return; }
    const out = await ops(this.dev()).text(`pidof ${q(this.pkg)} 2>/dev/null; ps -A -o PID,NAME 2>/dev/null | grep -F ${q(this.pkg)} | tr -s ' ' | cut -d ' ' -f 2`, 10000);
    this.pids = new Set(out.split(/\s+/).filter((x) => /^\d+$/.test(x)));
    $('#lcStatus', this.el).textContent = this.pids.size ? `Showing ${this.pkg} (process ${[...this.pids].join(', ')})` : `${this.pkg} is not running — open the app, then choose it again`;
  },
  async start() {
    const dev = this.dev(); if (!dev) return;
    const el = this.el;
    $('#lcEmpty', el)?.remove();
    this.running = true; $('#lcRun', el).innerHTML = `${icon('pause')}Stop`;
    const s = await ops(dev).openLogcat({ tail: 500 }, (lines) => this.add(lines), () => { if (this.running) { this.running = false; $('#lcRun', el).innerHTML = `${icon('play')}Start`; $('#lcStatus', el).textContent = 'Log stream ended (the device disconnected?). Press Start to continue.'; } });
    if (!s.ok) { this.running = false; $('#lcRun', el).innerHTML = `${icon('play')}Start`; return toast(s.msg || 'Could not start logcat', { error: true }); }
    this.stream = s;
  },
  stop() {
    if (this.stream) { try { this.stream.close(); } catch {} this.stream = null; }
    this.running = false;
    const b = this.el && $('#lcRun', this.el); if (b) b.innerHTML = `${icon('play')}Start`;
  },
  match(l) {
    const m = RE.exec(l);
    const lv = m ? m[5] : 'I';
    if (LEVELS.indexOf(lv === 'A' ? 'F' : lv) < LEVELS.indexOf(this.level)) return false;
    if (this.pids && m && !this.pids.has(m[3])) return false;
    if (this.text && !l.toLowerCase().includes(this.text)) return false;
    return true;
  },
  row(l) {
    const m = RE.exec(l);
    const d = document.createElement('div');
    if (!m) { d.className = 'lc I'; d.textContent = l; return d; }
    d.className = 'lc ' + (m[5] === 'A' ? 'F' : m[5]);
    d.innerHTML = `<span class="t">${m[2]}</span><span class="p">${m[3]}</span><span class="l">${m[5]}</span><span class="g">${esc(m[6])}</span><span class="m">${esc(m[7])}</span>`;
    return d;
  },
  add(lines) {
    this.lines.push(...lines);
    if (this.lines.length > MAX) this.lines.splice(0, this.lines.length - MAX);
    const view = $('#lcView', this.el);
    const frag = document.createDocumentFragment();
    for (const l of lines) if (this.match(l)) frag.append(this.row(l));
    view.append(frag);
    while (view.childElementCount > 4000) view.firstElementChild.remove();
    if (this.follow) this.scrollEnd();
  },
  rerender() {
    const view = $('#lcView', this.el); if (!view) return;
    view.innerHTML = '';
    const frag = document.createDocumentFragment();
    const shown = this.lines.filter((l) => this.match(l)).slice(-4000);
    for (const l of shown) frag.append(this.row(l));
    view.append(frag);
    if (!this.lines.length && !this.running) view.innerHTML = '<div class="lc-empty">Press <b>Start</b> to stream logs from the device.</div>';
    if (this.follow) this.scrollEnd();
  },
  scrollEnd() { const v = $('#lcView', this.el); if (v) v.scrollTop = v.scrollHeight; },
  hide() {},
};
