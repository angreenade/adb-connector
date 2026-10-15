import { api, $, $$, esc, icon, toast, report, fileToast, ops, needDevice, showMenu, confirmDialog, openDialog, closeDialog, store, setSettings, q, busyBtn, emit, sameDevice, deviceError, fmtBytes } from '../core.js';

const COMMON_PERMS = ['android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_ADVERTISE', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.BODY_SENSORS', 'android.permission.BODY_SENSORS_BACKGROUND', 'android.permission.ACTIVITY_RECOGNITION', 'android.permission.READ_CONTACTS', 'android.permission.READ_PHONE_STATE', 'android.permission.CALL_PHONE', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.NEARBY_WIFI_DEVICES', 'android.permission.WRITE_SECURE_SETTINGS', 'android.permission.DUMP', 'android.permission.READ_LOGS', 'android.permission.PACKAGE_USAGE_STATS'];
const short = (p) => p.replace(/^android\.permission\./, '');

function downgradeDialog(pkg) {
  return new Promise((resolve) => {
    let choice = null;
    openDialog(`<h2>Install an older version?</h2>
      <p>A newer version of <code>${esc(pkg)}</code> is installed. Android doesn't let a normal app be downgraded directly, so the installed version has to be removed first.</p>
      <p class="note"><b>Keep app data</b> keeps logins and settings. If the older version can't read them, the app may crash — then use <b>Remove everything</b>.</p>
      <div class="actions"><button class="btn text" data-x>Cancel</button><button class="btn text danger" data-wipe>Remove everything</button><button class="btn filled" data-keep>Keep app data and install</button></div>`, (d) => {
      d.querySelector('[data-x]').onclick = () => closeDialog();
      d.querySelector('[data-wipe]').onclick = () => { choice = 'wipe'; closeDialog(); };
      d.querySelector('[data-keep]').onclick = () => { choice = 'keep'; closeDialog(); };
      return () => resolve(choice);
    }, { wide: true });
  });
}

// ── names and icons
const GENERIC = new Set(['android', 'app', 'apps', 'com', 'org', 'net', 'mobile', 'client', 'main', 'free', 'pro', 'wear', 'watch', 'wearable', 'samsung', 'google', 'sec']);
export function guessName(pkg) {
  const parts = String(pkg).split('.').filter(Boolean);
  let w = parts[parts.length - 1] || pkg;
  for (let i = parts.length - 1; i > 0 && GENERIC.has(w.toLowerCase()); i--) w = parts[i - 1];
  return w.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export function appIcon(meta, pkg, label, cls = '') {
  const ic = meta && meta.icon;
  if (ic && ic.kind === 'image' && ic.src) return `<span class="app-ic img ${cls}"><img src="${esc(ic.src)}" alt="" draggable="false"></span>`;
  if (ic && ic.kind === 'adaptive' && (ic.fg || ic.bg || ic.fgColor)) return `<span class="app-ic ad ${cls}" style="background:${esc(ic.bgColor || (ic.bg ? 'transparent' : '#fff'))}">${ic.bg ? `<img class="bg" src="${esc(ic.bg)}" alt="" draggable="false">` : ''}${ic.fg ? `<img class="fg" src="${esc(ic.fg)}" alt="" draggable="false">` : ''}</span>`;
  const h = hue(pkg);
  return `<span class="app-ic letter ${cls}" style="--h:${h}">${esc(String(label || guessName(pkg)).trim().slice(0, 1).toUpperCase() || '?')}</span>`;
}
const when = (ms) => { const d = new Date(ms); const today = new Date(); const same = d.toDateString() === today.toDateString(); return same ? `Today ${d.toLocaleTimeString(document.documentElement.lang === 'he' ? 'he-IL' : undefined, { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString(document.documentElement.lang === 'he' ? 'he-IL' : undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ' ' + d.toLocaleTimeString(document.documentElement.lang === 'he' ? 'he-IL' : undefined, { hour: '2-digit', minute: '2-digit' }); };
const ACTION = { install: ['Installed', 'ok'], downgrade: ['Older version installed', 'ok'], saved: ['Saved from device', 'info'], uninstall: ['Uninstalled', 'muted'] };

export const page = {
  id: 'apps', title: 'Apps', icon: 'apps',
  tab: 'device', filter: 'user', query: '', apps: [], devId: null, meta: {}, labels: {}, metaFor: null,
  mount(el) {
    this.el = el;
    api.on('library-changed', () => { if (this.tab !== 'device' && this.el.querySelector('.apps-page')) this.loadLibrary(); else this.lib = null; });
  },
  show(dev) {
    if (dev && sameDevice(this.devId, dev)) this.devId = dev.id;
    const el = this.el;
    if (!dev) { this.devId = null; return needDevice(el, 'app tools'); }
    if (!sameDevice(this.devId, dev) || !el.querySelector('.apps-page')) { this.devId = dev.id; this.skeleton(dev); this.load(); }
  },
  showPkg() { return !!(store.settings.apps && store.settings.apps.showPkg); },
  skeleton(dev) {
    const el = this.el;
    const s = store.settings.install || {};
    if (this.metaFor !== dev.id) { this.meta = {}; this.labels = {}; this.metaFor = dev.id; }
    el.innerHTML = `
      <div class="apps-page">
        <header class="page-head"><div><h1>Apps</h1><p class="sub">Install, open, manage permissions and remove apps — and keep every app you install in your own library.</p></div></header>
        <section class="drop-panel" id="drop" tabindex="0">
          ${icon('download', 'ic big')}
          <div class="drop-text"><b id="dropTitle">Drop apps here to install</b><span id="dropSub">.apk, .apks, .xapk or .apkm — or click to choose</span></div>
          <div class="drop-progress hidden" id="dropProg"><span class="indeterminate"></span></div>
        </section>
        <div class="install-opts">
          <label class="check"><input type="checkbox" data-opt="grant" ${s.grant ? 'checked' : ''}><span>Grant all permissions</span></label>
          <label class="check"><input type="checkbox" data-opt="downgrade" ${s.downgrade ? 'checked' : ''}><span>Allow downgrade</span></label>
          <label class="check"><input type="checkbox" data-opt="test" ${s.test ? 'checked' : ''}><span>Allow test apps</span></label>
        </div>
        <div class="folders-bar" id="foldersBar"></div>
        <div class="tabs" id="appTabs" role="tablist">
          <button data-t="device" class="${this.tab === 'device' ? 'on' : ''}">${icon('apps')}On this device</button>
          <button data-t="library" class="${this.tab === 'library' ? 'on' : ''}">${icon('library')}My library</button>
          <button data-t="history" class="${this.tab === 'history' ? 'on' : ''}">${icon('history')}History</button>
        </div>
        <section class="panel" data-tab="device" ${this.tab === 'device' ? '' : 'hidden'}>
          <div class="panel-head wrap">
            <div class="seg" id="appFilter"><button data-f="user" class="${this.filter === 'user' ? 'on' : ''}">Installed by you</button><button data-f="system" class="${this.filter === 'system' ? 'on' : ''}">System</button><button data-f="disabled" class="${this.filter === 'disabled' ? 'on' : ''}">Disabled</button></div>
            <div class="search">${icon('search')}<input id="appSearch" placeholder="Search by name or package" spellcheck="false" value="${esc(this.query)}" /></div>
            <label class="switch-inline" title="Show the technical package name (like app.relink) under each app"><input type="checkbox" class="switch" id="showPkg" ${this.showPkg() ? 'checked' : ''}><span>Package names</span></label>
            <button class="icon-btn" id="appRefresh" title="Refresh">${icon('refresh')}</button>
          </div>
          <div id="updBanner" class="upd-banner hidden"></div>
          <div id="appList" class="app-list"></div>
        </section>
        <section class="panel" data-tab="library" ${this.tab === 'library' ? '' : 'hidden'}>
          <div class="panel-head wrap">
            <div class="search">${icon('search')}<input id="libSearch" placeholder="Search your library" spellcheck="false" /></div>
            <button class="btn tonal sm" id="libAdd">${icon('add')}Add APKs</button>
            <button class="btn text sm" id="libFolder">${icon('folder')}Open folder</button>
          </div>
          <div class="lib-drop" id="libDrop">${icon('library')}<span><b>Drop APKs here to keep them</b> — they are saved on this computer without installing. Every app you install or save from a device is added automatically.</span></div>
          <div id="libList" class="lib-grid"></div>
        </section>
        <section class="panel" data-tab="history" ${this.tab === 'history' ? '' : 'hidden'}>
          <div class="panel-head"><h3>Install history</h3><button class="btn text sm" id="histClear">${icon('trash')}Clear history</button></div>
          <div id="histList" class="hist-list"></div>
        </section>
      </div>`;
    const drop = $('#drop', el);
    drop.onclick = async () => {
      if (this.installing) return;
      if (dev.web) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.apk'; inp.multiple = true; inp.onchange = () => this.install([...inp.files]); inp.click(); }
      else { const files = await api.pickFiles('apk'); if (Array.isArray(files) && files.length) this.install(files); }
    };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') drop.click(); };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { e.stopPropagation(); this.install([...e.dataTransfer.files]); });
    $$('[data-opt]', el).forEach((c) => (c.onchange = () => setSettings({ install: { ...store.settings.install, [c.dataset.opt]: c.checked } })));
    $$('#appFilter button', el).forEach((b) => (b.onclick = () => { this.filter = b.dataset.f; $$('#appFilter button', el).forEach((x) => x.classList.toggle('on', x === b)); this.load(); }));
    $('#appSearch', el).oninput = (e) => { this.query = e.target.value.toLowerCase(); this.renderList(); };
    $('#appRefresh', el).onclick = (e) => busyBtn(e.currentTarget, () => this.load(true));
    $('#showPkg', el).onchange = (e) => { setSettings({ apps: { ...(store.settings.apps || {}), showPkg: e.target.checked } }); this.renderList(); this.renderLibrary(); };
    $$('#appTabs button', el).forEach((b) => (b.onclick = () => this.setTab(b.dataset.t)));
    // library
    $('#libSearch', el).oninput = (e) => { this.libQuery = e.target.value.toLowerCase(); this.renderLibrary(); };
    $('#libAdd', el).onclick = async () => { const files = await api.pickFiles('apk'); if (Array.isArray(files) && files.length) this.addToLibrary(files); };
    $('#libFolder', el).onclick = () => api.libraryFolder();
    const ld = $('#libDrop', el);
    ['dragenter', 'dragover'].forEach((ev) => ld.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); ld.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => ld.addEventListener(ev, (e) => { e.preventDefault(); ld.classList.remove('over'); }));
    ld.addEventListener('drop', (e) => { e.stopPropagation(); const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean); this.addToLibrary(files); });
    $('#histClear', el).onclick = async () => { if (await confirmDialog('Clear the install history?', { detail: 'Apps saved in your library are kept.', ok: 'Clear history' })) { report(await api.historyClear()); this.loadLibrary(); } };
    if (this.tab !== 'device') this.loadLibrary();
    this.renderFolders();
  },
  // ── watched APK folders
  folders() { return (store.settings.apps && store.settings.apps.folders) || []; },
  async setFolders(list) { await setSettings({ apps: { ...(store.settings.apps || {}), folders: list } }); this.renderFolders(); await this.scanFolders(); },
  renderFolders() {
    const bar = $('#foldersBar', this.el); if (!bar) return;
    const fs = this.folders();
    const n = this.folder ? this.folder.items.length : 0;
    bar.innerHTML = `${icon('folder')}<span class="fb-title">APK folders</span>
      ${fs.map((f, i) => `<span class="fb-chip${this.folder && this.folder.missing.includes(f) ? ' missing' : ''}" title="${esc(f)}"><button class="fb-open" data-fo="${i}">${esc(f.split(/[\\/]/).filter(Boolean).pop() || f)}</button><button class="fb-x" data-fx="${i}" title="Stop watching this folder">${icon('close')}</button></span>`).join('')}
      <button class="btn text sm" id="fbAdd">${icon('add')}Add folder</button>
      ${fs.length ? `<span class="fb-info muted small">${this.scanning ? '<span class="spinner tiny"></span> Scanning…' : `${n} apps found`}</span><button class="icon-btn sm" id="fbScan" title="Scan the folders again">${icon('refresh')}</button>` : '<span class="fb-info muted small">Pick a folder with APK files — the newest version of each app is shown here, with updates for apps on the device.</span>'}`;
    $('#fbAdd', bar).onclick = async () => { const d = await api.pickFolder(); if (d && !this.folders().includes(d)) this.setFolders([...this.folders(), d]); };
    const sc = $('#fbScan', bar); if (sc) sc.onclick = () => this.scanFolders();
    bar.querySelectorAll('[data-fx]').forEach((b) => (b.onclick = () => this.setFolders(this.folders().filter((_, i) => i !== +b.dataset.fx))));
    bar.querySelectorAll('[data-fo]').forEach((b) => (b.onclick = () => api.showFolder(this.folders()[+b.dataset.fo])));
  },
  async scanFolders() {
    const fs = this.folders();
    if (!fs.length) { this.folder = { items: [], icons: {}, missing: [] }; this.afterScan(); return; }
    if (this.scanning) return this.scanning;
    this.renderFolders();
    this.scanning = api.foldersScan(fs).then((r) => { this.folder = r && r.items ? r : { items: [], icons: {}, missing: [] }; }).catch(() => {}).finally(() => { this.scanning = null; this.afterScan(); });
    this.renderFolders();
    return this.scanning;
  },
  afterScan() { this.renderFolders(); this.computeUpdates(); this.renderList(); if (this.lib) this.renderLibrary(); },
  // newest copy of each package from the library and the folders
  candidates() {
    const best = new Map();
    const add = (it) => { if (!it || !it.pkg || !it.versionCode) return; const b = best.get(it.pkg); if (!b || it.versionCode > b.versionCode || (it.versionCode === b.versionCode && it.source === 'folder')) best.set(it.pkg, it); };
    for (const it of (this.folder && this.folder.items) || []) add(it);
    for (const it of (this.lib && this.lib.items) || []) add(it);
    return best;
  },
  computeUpdates() {
    this.updates = new Map();
    if (!this.installedVer) return this.renderBanner();
    for (const [pkg, it] of this.candidates()) { const cur = this.installedVer.get(pkg); if (cur != null && it.versionCode > cur) this.updates.set(pkg, it); }
    this.renderBanner();
  },
  renderBanner() {
    const b = $('#updBanner', this.el); if (!b) return;
    const n = this.updates ? this.updates.size : 0;
    b.classList.toggle('hidden', !n);
    if (!n) return;
    const names = [...this.updates.keys()].map((p) => this.label(p));
    b.innerHTML = `${icon('up')}<div><b>${n === 1 ? '1 update available' : `${n} updates available`}</b><span class="muted small">${esc(names.slice(0, 4).join(', '))}${names.length > 4 ? ` +${names.length - 4}` : ''}</span></div><button class="btn filled sm" id="updAll">${n === 1 ? 'Update' : 'Update all'}</button>`;
    $('#updAll', b).onclick = () => this.updateAll();
  },
  async updateAll() {
    const list = [...this.updates.values()];
    for (const it of list) { if (!this.dev()) break; await this.installItem(it); }
  },
  async loadVersions(dev) {
    const out = await ops(dev).text('pm list packages --show-versioncode 2>/dev/null', 30000);
    const m = new Map();
    for (const l of out.split(/\r?\n/)) { const x = l.trim().match(/^package:(\S+)\s+versionCode:(\d+)/); if (x) m.set(x[1], +x[2]); }
    this.installedVer = m.size ? m : null;
  },
  setTab(t) {
    this.tab = t;
    $$('#appTabs button', this.el).forEach((x) => x.classList.toggle('on', x.dataset.t === t));
    $$('.apps-page > section.panel', this.el).forEach((p) => (p.hidden = p.dataset.tab !== t));
    if (t !== 'device') this.loadLibrary();
  },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  async install(items, { asSplit: forceSplit } = {}) {
    const dev = this.dev(); if (!dev) return toast('The device is not connected', { error: true });
    if (this.installing) return toast('Another install is still running');
    const files = items.filter((f) => /\.(apk|apks|xapk|apkm)$/i.test(typeof f === 'string' ? f : f.name));
    if (!files.length) return toast('Choose an .apk, .apks, .xapk or .apkm file', { error: true });
    let asSplit = !!forceSplit;
    const apkCount = files.filter((f) => /\.apk$/i.test(typeof f === 'string' ? f : f.name)).length;
    if (forceSplit == null && apkCount > 1 && !dev.web) asSplit = await confirmDialog(`Install ${apkCount} APK files`, { detail: 'Are these parts of ONE app (a base APK plus split files), or separate apps?', ok: 'One app (split APKs)' });
    const el = this.el;
    this.installing = true;
    const drop = $('#drop', el); drop.classList.add('busy');
    $('#dropProg', el).classList.remove('hidden');
    drop.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const title = $('#dropTitle', el), sub = $('#dropSub', el);
    const t0 = Date.now();
    title.textContent = files.length === 1 ? `Installing ${typeof files[0] === 'string' ? files[0].split(/[\\/]/).pop() : files[0].name}…` : `Installing ${files.length} files…`;
    const tick = setInterval(() => { sub.textContent = `${Math.round((Date.now() - t0) / 1000)} s — large apps over Wi-Fi can take a minute`; }, 1000);
    const offP = api.on('install-progress', (p) => { title.textContent = `Installing ${p.file}${p.detail ? ` (${p.detail})` : ''}…`; });
    const offS = api.on('op-status', (p) => { sub.textContent = p.text; });
    try {
      let results = await ops(dev).install(files, asSplit);
      if (!Array.isArray(results)) results = [results];
      // blocked downgrades: offer to remove the newer version (keeping its data) and install this one
      for (const r of results.filter((x) => x.downgrade)) {
        const choice = await downgradeDialog(r.pkg);
        if (!choice) continue;
        title.textContent = `Installing the older version of ${r.pkg}…`;
        const r2 = await api.installDowngrade(dev.id, r.file, r.pkg, choice === 'keep', r.splitFiles || null);
        Object.assign(r, r2, { downgrade: false });
      }
      const bad = results.filter((r) => !r.ok && !r.downgrade);
      if (!bad.length && results.some((r) => r.ok)) toast(results.length === 1 ? results[0].msg : `Installed ${results.filter((r) => r.ok).length} apps`);
      else if (bad.length) toast(bad.map((b) => b.msg).join(' • '), { error: true, ms: 10000 });
      if (results.some((r) => r.ok)) { this.load(true); }
    } finally {
      clearInterval(tick); offP(); offS();
      this.installing = false; drop.classList.remove('busy'); $('#dropProg', el).classList.add('hidden');
      title.textContent = 'Drop apps here to install'; sub.textContent = '.apk, .apks, .xapk or .apkm — or click to choose';
    }
  },
  label(p) { return (this.labels[p] && this.labels[p].label) || (this.meta[p] && this.meta[p].label) || guessName(p); },
  async load(fresh) {
    const dev = this.dev(); if (!dev) return;
    const list = $('#appList', this.el);
    list.innerHTML = '<div class="status-line left pad"><span class="spinner"></span>Loading apps…</div>';
    const flag = { user: '-3', system: '-s', disabled: '-d' }[this.filter];
    const out = await ops(dev).text(`pm list packages ${flag} 2>/dev/null`, 30000);
    this.disabled = new Set(this.filter === 'disabled' ? [] : (await ops(dev).text('pm list packages -d 2>/dev/null', 20000)).split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean));
    this.apps = out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
    await this.loadVersions(dev).catch(() => {});
    if (!this.lib && !dev.web) this.lib = await api.libraryList().catch(() => null);
    this.computeUpdates();
    this.renderList();
    if (!dev.web && (fresh || !this.folder)) this.scanFolders();
    if (!dev.web) {
      const token = (this.loadToken = (this.loadToken || 0) + 1);
      api.appLabels(dev.id, !!fresh).then((r) => { if (token !== this.loadToken || !r || !r.ok) return; this.labels = r.labels || {}; this.renderList(); }).catch(() => {});
    }
  },
  renderList() {
    const list = $('#appList', this.el); if (!list) return;
    const showPkg = this.showPkg();
    const items = this.apps.map((p) => ({ p, name: this.label(p) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.p.localeCompare(b.p));
    const shown = items.filter((x) => !this.query || x.p.toLowerCase().includes(this.query) || x.name.toLowerCase().includes(this.query));
    if (!this.apps.length) { list.innerHTML = `<div class="empty-inline small">${this.filter === 'user' ? 'No apps installed by you yet. Drop an APK above to install one.' : 'Nothing here.'}</div>`; return; }
    const isDis = (p) => (this.disabled && this.disabled.has(p)) || this.filter === 'disabled';
    list.innerHTML = `<div class="list-count">${shown.length} of ${this.apps.length} apps</div>` + shown.slice(0, 600).map(({ p, name }) => `
      <div class="app-row${isDis(p) ? ' is-disabled' : ''}" data-p="${esc(p)}" title="${esc(name)} — ${esc(p)}">
        ${appIcon(this.meta[p], p, name)}
        <div class="app-text"><b class="app-label">${esc(name)}</b>${showPkg ? `<code class="app-pkg">${esc(p)}</code>` : ''}</div>
        ${isDis(p) ? '<span class="tag">Disabled</span>' : ''}
        ${this.updates && this.updates.has(p) ? `<button class="btn tonal sm upd" data-a="update" title="${esc(this.updates.get(p).name || '')}">${icon('up')}Update · v${esc(this.updates.get(p).versionName || this.updates.get(p).versionCode)}</button>` : ''}
        <button class="btn text sm" data-a="open">${icon('play')}Open</button>
        <button class="btn text sm" data-a="info">${icon('shield')}Permissions</button>
        <button class="icon-btn" data-a="more" title="More">${icon('more')}</button>
      </div>`).join('') + (shown.length > 600 ? '<div class="list-count">Showing the first 600 — use search to narrow down</div>' : '');
    this.watchIcons(list);
    list.onclick = (e) => {
      const row = e.target.closest('.app-row'); if (!row) return;
      const a = e.target.closest('[data-a]')?.dataset.a, p = row.dataset.p;
      if (a === 'open') return this.act('open', p);
      if (a === 'update') return this.installItem(this.updates.get(p));
      if (a === 'info' || (!a && e.detail === 2)) return this.details(p);
      if (a === 'more') showMenu(e.target.closest('button'), [
        { label: 'Open', icon: 'play', run: () => this.act('open', p) },
        { label: 'Permissions and details', icon: 'shield', run: () => this.details(p) },
        { label: 'Force stop', icon: 'stop', run: () => this.act('stop', p) },
        { label: 'Clear data', icon: 'trash', run: () => this.act('clear', p) },
        { label: 'Save APK to library', icon: 'download', run: () => this.act('extract', p) },
        { label: 'Open app info on device', icon: 'open', run: () => this.act('appinfo', p) },
        { label: isDis(p) ? 'Enable' : 'Disable', icon: 'pause', run: () => this.act(isDis(p) ? 'enable' : 'disable', p) },
        { label: 'Copy package name', icon: 'copy', run: () => { api.copy(p); toast(`Copied ${p}`); } },
        '-',
        { label: this.filter === 'system' ? 'Remove for this user' : 'Uninstall', icon: 'delete', danger: true, run: () => this.act(this.filter === 'system' ? 'remove-system' : 'uninstall', p) },
      ]);
    };
  },
  // load icons only for rows that scroll into view
  watchIcons(list) {
    const dev = this.dev(); if (!dev || dev.web) return;
    if (this.io) this.io.disconnect();
    const want = new Set();
    let timer = null;
    const flush = async () => {
      timer = null;
      const pkgs = [...want].filter((p) => !(p in this.meta)); want.clear();
      if (!pkgs.length) return;
      for (const p of pkgs) this.meta[p] = this.meta[p] || null;   // mark as requested
      for (let i = 0; i < pkgs.length; i += 12) {
        const batch = pkgs.slice(i, i + 12);
        let res = {};
        try { res = (await api.appMeta(dev.id, batch)) || {}; } catch {}
        let relabel = false;
        for (const p of batch) {
          const m = res[p]; if (!m) continue;
          this.meta[p] = m;
          if (!this.labels[p] && m.label) relabel = true;
          const row = list.querySelector(`.app-row[data-p="${CSS.escape(p)}"]`);
          if (row) { const ic = row.querySelector('.app-ic'); if (ic) ic.outerHTML = appIcon(m, p, this.label(p)); if (!this.labels[p] && m.label) { const l = row.querySelector('.app-label'); if (l) l.textContent = m.label; } }
        }
        if (relabel && !Object.keys(this.labels).length) { /* names came from the APKs; resort later */ }
      }
    };
    this.io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { want.add(e.target.dataset.p); this.io.unobserve(e.target); }
      if (want.size && !timer) timer = setTimeout(flush, 120);
    }, { root: null, rootMargin: '300px' });
    for (const row of list.querySelectorAll('.app-row')) if (!(row.dataset.p in this.meta) || this.meta[row.dataset.p] === undefined) this.io.observe(row);
  },
  // ── library
  async loadLibrary() {
    this.lib = await api.libraryList();
    this.renderLibrary(); this.renderHistory();
  },
  async addToLibrary(files) {
    if (!files.length) return toast('Choose .apk, .apks, .xapk or .apkm files', { error: true });
    toast('Adding to your library…');
    report(await api.libraryAdd(files));
    this.loadLibrary();
  },
  renderLibrary() {
    const box = $('#libList', this.el); if (!box || !this.lib) return;
    const showPkg = this.showPkg();
    const groups = new Map();
    const all = [...this.lib.items, ...((this.folder && this.folder.items) || [])];
    for (const it of all) { if (!groups.has(it.pkg)) groups.set(it.pkg, []); const g = groups.get(it.pkg); if (!g.some((x) => x.versionCode === it.versionCode && x.size === it.size)) g.push(it); }
    const iconOf = (pkg) => this.lib.icons[pkg] || (this.folder && this.folder.icons[pkg]);
    let apps = [...groups].map(([pkg, vers]) => { vers.sort((a, b) => (b.versionCode - a.versionCode) || (b.addedAt - a.addedAt)); return { pkg, vers, label: vers.find((v) => v.label)?.label || this.label(pkg) }; });
    const qq = this.libQuery || '';
    if (qq) apps = apps.filter((a) => a.label.toLowerCase().includes(qq) || a.pkg.toLowerCase().includes(qq));
    apps.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    if (!all.length) { box.innerHTML = '<div class="empty-inline small">Your library is empty. Apps you install from this computer appear here automatically, so you can put them back with one click — any version.</div>'; return; }
    if (!apps.length) { box.innerHTML = '<div class="empty-inline small">No apps match your search.</div>'; return; }
    const installed = new Set(this.apps);
    box.innerHTML = apps.map((a) => {
      const v = a.vers[0];
      const cur = this.installedVer && this.installedVer.get(a.pkg);
      const isUpd = cur != null && v.versionCode > cur;
      return `<div class="lib-card${isUpd ? ' has-upd' : ''}" data-pkg="${esc(a.pkg)}">
        ${appIcon({ icon: iconOf(a.pkg) }, a.pkg, a.label, 'lg')}
        <div class="lib-text"><b>${esc(a.label)}</b>${showPkg ? `<code>${esc(a.pkg)}</code>` : ''}
          <span class="muted small">${esc(v.versionName ? 'v' + v.versionName : 'version ' + (v.versionCode || '?'))} · ${fmtBytes(v.size)}${a.vers.length > 1 ? ` · ${a.vers.length} versions` : ''}${isUpd ? ' · <span class="upd-text">update available</span>' : installed.has(a.pkg) ? ' · <span class="ok-text">on this device</span>' : ''}${v.source === 'folder' ? ' · <span class="tag">folder</span>' : ''}</span></div>
        <div class="lib-actions"><button class="btn ${isUpd ? 'filled' : 'tonal'} sm" data-li="${esc(v.id)}">${icon(isUpd ? 'up' : 'download')}${isUpd ? 'Update' : 'Install'}</button><button class="icon-btn" data-lm title="Versions and more">${icon('more')}</button></div>
      </div>`;
    }).join('');
    box.onclick = (e) => {
      const card = e.target.closest('.lib-card'); if (!card) return;
      const g = groups.get(card.dataset.pkg);
      const li = e.target.closest('[data-li]');
      if (li) return this.installItem(g.find((x) => x.id === li.dataset.li));
      if (e.target.closest('[data-lm]')) showMenu(e.target.closest('button'), [
        ...g.map((v) => ({ label: `Install ${v.versionName ? 'v' + v.versionName : 'version ' + v.versionCode} (${when(v.addedAt)})`, icon: 'download', run: () => this.installItem(v) })),
        '-',
        { label: 'Show file', icon: 'folder', run: () => api.showFile(g[0].paths[0]) },
        ...(g.some((v) => v.source === 'folder') ? [] : []),
        { label: 'Copy package name', icon: 'copy', run: () => { api.copy(card.dataset.pkg); toast(`Copied ${card.dataset.pkg}`); } },
        ...g.filter((v) => v.source !== 'folder').map((v) => ({ label: `Remove ${v.versionName ? 'v' + v.versionName : 'version ' + v.versionCode} from library`, icon: 'delete', danger: true, run: async () => { if (await confirmDialog('Remove from your library?', { detail: `${this.lib.items.find((x) => x.id === v.id)?.label || v.pkg} ${v.versionName || ''} — the file is deleted from this computer. The app on the device is not touched.`, ok: 'Remove', danger: true })) { report(await api.libraryRemove(v.id)); this.loadLibrary(); } } })),
      ]);
    };
  },
  installItem(it) {
    if (!it) return;
    const dev = this.dev();
    if (dev && dev.web) return toast('Installing from the library works with Wi-Fi and USB connections', { error: true });
    return this.install(it.paths, { asSplit: it.split });
  },
  renderHistory() {
    const box = $('#histList', this.el); if (!box || !this.lib) return;
    const h = this.lib.history;
    if (!h.length) { box.innerHTML = '<div class="empty-inline small">Nothing yet. Every install, downgrade, uninstall and saved APK is listed here.</div>'; return; }
    const items = new Map(this.lib.items.map((x) => [x.id, x]));
    const showPkg = this.showPkg();
    box.innerHTML = h.slice(0, 300).map((e, i) => {
      const [txt, cls] = e.ok === false ? ['Failed', 'err'] : (ACTION[e.action] || ['Installed', 'ok']);
      const name = e.label || (e.pkg ? this.label(e.pkg) : e.name) || 'App';
      const it = e.item && items.get(e.item);
      return `<div class="hist-row" data-i="${i}">
        ${appIcon({ icon: e.pkg && this.lib.icons[e.pkg] }, e.pkg || e.name || '?', name)}
        <div class="app-text"><b>${esc(name)}${e.versionName ? ` <span class="muted">v${esc(e.versionName)}</span>` : ''}</b>
          <span class="muted small">${esc(when(e.at))} · ${esc(e.device || '')}${showPkg && e.pkg ? ` · <code>${esc(e.pkg)}</code>` : ''}${e.ok === false && e.msg ? ` · ${esc(e.msg)}` : ''}</span></div>
        <span class="pill-tag ${cls}">${txt}</span>
        ${it ? `<button class="btn text sm" data-hi="${esc(it.id)}">${icon('download')}Install again</button>` : '<span class="hist-spacer"></span>'}
      </div>`;
    }).join('');
    box.onclick = (e) => { const b = e.target.closest('[data-hi]'); if (b) this.installItem(items.get(b.dataset.hi)); };
  },
  async act(a, p) {
    const dev = this.dev(); if (!dev) return toast('The device is not connected', { error: true });
    const o = ops(dev);
    const run = async (cmd, okMsg) => { const r = await o.run(cmd, 60000); const out = (r.out || '').trim(); const failed = !r.ok || /Exception|Error|Failure|not found|Unknown/i.test(out); toast(failed ? deviceError(out || r.msg) : okMsg, { error: failed }); return !failed; };
    if (a === 'open') return run(`p=$(cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${q(p)} 2>/dev/null | tail -n 1); case "$p" in */*) am start -n "$p" >/dev/null 2>&1 && echo ok ;; *) monkey -p ${q(p)} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 && echo ok || echo "Error: this app has no screen to open" ;; esac`, `Opened ${this.label(p)}`);
    if (a === 'appinfo') return run(`am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${p} >/dev/null`, 'Opened on the device');
    if (a === 'stop') return run(`am force-stop ${q(p)}`, 'Stopped');
    if (a === 'clear') { if (!(await confirmDialog('Clear all data of this app?', { detail: `${p} will be reset as if newly installed. Logins and settings are lost.`, ok: 'Clear data', danger: true }))) return; return run(`pm clear ${q(p)}`, 'App data cleared'); }
    if (a === 'disable') { if (!(await confirmDialog('Disable this app?', { detail: p, ok: 'Disable' }))) return; if (await run(`pm disable-user --user 0 ${q(p)}`, 'Disabled')) this.load(); return; }
    if (a === 'enable') { if (await run(`pm enable ${q(p)}`, 'Enabled')) this.load(); return; }
    if (a === 'extract') { toast('Saving APK…'); const r = await o.extractApk(p); if (r && r.ok && !dev.web) r.msg = `${r.msg} — also kept in your library`; return fileToast(r); }
    if (a === 'uninstall') {
      if (!(await confirmDialog(`Uninstall ${this.label(p)}?`, { detail: p, ok: 'Uninstall', danger: true }))) return;
      const r = await o.run(`pm uninstall ${q(p)}`, 120000);
      if (/Success/.test(r.out)) { toast(`Removed ${this.label(p)}`); if (!dev.web) api.historyAdd({ id: dev.id, action: 'uninstall', ok: true, pkg: p, label: this.label(p), versionName: this.meta[p] && this.meta[p].versionName }); this.apps = this.apps.filter((x) => x !== p); this.renderList(); } else toast((r.out || r.msg || 'Failed').trim(), { error: true });
      return;
    }
    if (a === 'remove-system') {
      if (!(await confirmDialog('Remove this system app for the current user?', { detail: `${p} — this is reversible: it stays on the device and can be restored with “cmd package install-existing ${p}”. Removing important system apps can break the device.`, ok: 'Remove', danger: true }))) return;
      const r = await o.run(`pm uninstall -k --user 0 ${q(p)}`, 60000);
      if (/Success/.test(r.out)) { toast(`Removed ${p} for this user`); this.load(); } else toast((r.out || r.msg || 'Failed').trim(), { error: true });
    }
  },
  async details(p) {
    const dev = this.dev(); if (!dev) return;
    const o = ops(dev);
    openDialog(`<div class="app-head">${appIcon(this.meta[p], p, this.label(p), 'lg')}<div><h2>${esc(this.label(p))}</h2><code class="muted">${esc(p)}</code></div></div><div id="appInfo"><div class="status-line left"><span class="spinner"></span>Reading app details…</div></div>`, (d) => {
      const load = async () => {
        const out = await o.text(`dumpsys package ${q(p)}`, 30000);
        const get = (re) => (out.match(re) || [])[1] || '';
        const info = { version: get(/versionName=(\S+)/), code: get(/versionCode=(\d+)/), target: get(/targetSdk=(\d+)/), min: get(/minSdk=(\d+)/), installed: get(/firstInstallTime=([^\n]+)/), updated: get(/lastUpdateTime=([^\n]+)/), installer: get(/installerPackageName=(\S+)/) };
        // runtime permissions with their state; requested permissions as the fallback list
        const perms = new Map(); let section = '';
        for (const line of out.split(/\r?\n/)) {
          if (/^\s*runtime permissions:/.test(line)) { section = 'runtime'; continue; }
          if (/^\s*(install permissions|declared permissions|requested permissions|User \d+:|Packages:|Queries:)/.test(line) && section === 'runtime') section = '';
          const m = line.match(/^\s+([\w.]+): granted=(true|false)/);
          if (m && section === 'runtime') perms.set(m[1], m[2] === 'true');
        }
        const info$ = $('#appInfo', d); if (!info$) return;
        info$.innerHTML = `
          <dl class="details compact">${[['Version', info.version + (info.code ? ` (${info.code})` : '')], ['Target / min API', [info.target, info.min].filter(Boolean).join(' / ')], ['Installed', info.installed], ['Updated', info.updated], ['Installed by', info.installer]].filter((r) => r[1] && r[1] !== ' ()').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          <div class="panel-head tight"><h3>Permissions</h3>${perms.size ? `<button class="btn text sm" id="grantAll">Grant all</button>` : ''}</div>
          ${perms.size ? `<ul class="perm-list">${[...perms].sort().map(([perm, g]) => `<li><label class="switch-row"><span><b>${esc(short(perm))}</b><small>${esc(perm)}</small></span><input type="checkbox" class="switch" data-perm="${esc(perm)}" ${g ? 'checked' : ''}></label></li>`).join('')}</ul>` : '<p class="muted">This app has no runtime permissions to switch.</p>'}
          <form id="grantForm" class="inline-form"><input id="grantInput" list="permList" placeholder="Grant another permission, e.g. BLUETOOTH_CONNECT" spellcheck="false" /><datalist id="permList">${COMMON_PERMS.map((x) => `<option value="${x}">`).join('')}</datalist><button class="btn tonal sm">Grant</button></form>
          <p id="permMsg" class="hidden"></p>
          <div class="actions spread"><div class="row"><button class="btn text" data-q="open">Open</button><button class="btn text" data-q="stop">Force stop</button><button class="btn text" data-q="extract">Save APK</button></div><button class="btn filled" data-x>Done</button></div>`;
        const msg = $('#permMsg', d);
        const setPerm = async (perm, grant) => {
          const r = await o.run(`pm ${grant ? 'grant' : 'revoke'} ${q(p)} ${q(perm)}`, 15000);
          const err = (r.out || '').trim();
          if (!r.ok || /Exception|Error|not a changeable|has not requested/i.test(err)) { msg.textContent = deviceError(err || r.msg, 'Could not change this permission'); msg.className = 'err-text'; return false; }
          msg.className = 'hidden'; return true;
        };
        $$('[data-perm]', d).forEach((c) => (c.onchange = async () => { c.disabled = true; const okk = await setPerm(c.dataset.perm, c.checked); if (!okk) c.checked = !c.checked; else toast(`${short(c.dataset.perm)} ${c.checked ? 'granted' : 'revoked'}`); c.disabled = false; }));
        const ga = $('#grantAll', d); if (ga) ga.onclick = () => busyBtn(ga, async () => { let n = 0; for (const c of $$('[data-perm]', d)) if (!c.checked && (await setPerm(c.dataset.perm, true))) { c.checked = true; n++; } toast(n ? `Granted ${n} permissions` : 'Nothing to grant'); });
        $('#grantForm', d).onsubmit = async (e) => {
          e.preventDefault();
          let perm = $('#grantInput', d).value.trim(); if (!perm) return;
          if (!perm.includes('.')) perm = 'android.permission.' + perm.toUpperCase();
          if (await setPerm(perm, true)) { toast(`${short(perm)} granted`); load(); }
        };
        $$('[data-q]', d).forEach((b) => (b.onclick = () => this.act(b.dataset.q, p)));
        $('[data-x]', d).onclick = closeDialog;
      };
      load();
    }, { wide: true });
  },
};
