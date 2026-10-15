import { api, $, $$, esc, icon, toast, fileToast, ops, needDevice, showMenu, confirmDialog, promptDialog, store, q, fmtBytes, fmtDate, busyBtn , sameDevice } from '../core.js';

const PLACES = [['Internal storage', '/sdcard'], ['Download', '/sdcard/Download'], ['Camera', '/sdcard/DCIM'], ['Pictures', '/sdcard/Pictures'], ['Movies', '/sdcard/Movies'], ['Music', '/sdcard/Music'], ['Documents', '/sdcard/Documents'], ['Temp', '/data/local/tmp']];
const LIST = (dir) => `cd ${q(dir)} 2>/dev/null || { echo "@@ERR"; exit 0; }; for f in * .*; do case "$f" in .|..) continue;; esac; if [ -e "$f" ] || [ -L "$f" ]; then if [ -d "$f" ]; then k=d; elif [ -L "$f" ]; then k=l; else k=f; fi; echo "$k|$(stat -c '%s|%Y' -- "$f" 2>/dev/null)|$f"; fi; done`;
const join = (a, b) => (a.replace(/\/+$/, '') + '/' + b).replace(/\/+/g, '/');
const parent = (p) => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';

export const page = {
  id: 'files', title: 'Files', icon: 'folder',
  cwd: '/sdcard', items: [], sel: new Set(), devId: null, hidden: false,
  mount(el) { this.el = el; },
  show(dev) {
    if (dev && sameDevice(this.devId, dev)) this.devId = dev.id;
    if (!dev) { this.devId = null; return needDevice(this.el, 'the file browser'); }
    if (!sameDevice(this.devId, dev) || !this.el.querySelector('.files-page')) { this.devId = dev.id; this.cwd = '/sdcard'; this.skeleton(); this.load(); }
  },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  skeleton() {
    const el = this.el;
    el.innerHTML = `
      <div class="files-page">
        <header class="page-head"><div><h1>Files</h1><p class="sub">Browse the device, upload by dropping files here, download with one click.</p></div></header>
        <div class="places">${PLACES.map(([n, p]) => `<button class="chip" data-place="${esc(p)}">${esc(n)}</button>`).join('')}</div>
        <section class="panel files-panel" id="fdrop">
          <div class="toolbar">
            <button class="icon-btn" id="fUp" title="Up one folder">${icon('up')}</button>
            <form id="pathForm" class="path-box">${icon('folder')}<input id="fPath" class="mono" spellcheck="false" /></form>
            <button class="icon-btn" id="fRefresh" title="Refresh">${icon('refresh')}</button>
            <button class="btn tonal sm" id="fNew">${icon('newFolder')}New folder</button>
            <button class="btn filled sm" id="fUpload">${icon('upload')}Upload</button>
          </div>
          <div class="sel-bar hidden" id="selBar"><span id="selCount"></span><button class="btn text sm" id="selDl">${icon('download')}Download</button><button class="btn text sm danger" id="selDel">${icon('delete')}Delete</button><button class="btn text sm" id="selClear">Clear selection</button></div>
          <div class="file-head"><span></span><span>Name</span><span>Size</span><span>Modified</span><span></span></div>
          <div id="fList" class="file-list"></div>
          <div class="drop-hint">${icon('upload')}<span>Drop to upload into this folder</span></div>
          <label class="check hidden-toggle"><input type="checkbox" id="fHidden"><span>Show hidden files</span></label>
        </section>
      </div>`;
    $$('[data-place]', el).forEach((b) => (b.onclick = () => this.go(b.dataset.place)));
    $('#fUp', el).onclick = () => this.go(parent(this.cwd));
    $('#fRefresh', el).onclick = (e) => busyBtn(e.currentTarget, () => this.load());
    $('#pathForm', el).onsubmit = (e) => { e.preventDefault(); this.go($('#fPath', el).value.trim() || '/'); };
    $('#fNew', el).onclick = async () => {
      const name = await promptDialog('New folder', { label: 'Folder name', placeholder: 'My folder', ok: 'Create' });
      if (!name) return;
      const r = await ops(this.dev()).run(`mkdir -p ${q(join(this.cwd, name))} && echo ok`);
      if (/ok/.test(r.out)) { toast('Folder created'); this.load(); } else toast((r.out || r.msg || 'Could not create the folder').trim(), { error: true });
    };
    $('#fUpload', el).onclick = async () => {
      const dev = this.dev(); if (!dev) return;
      if (dev.web) { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = () => this.upload([...inp.files]); inp.click(); }
      else { const files = await api.pickFiles('any'); if (Array.isArray(files) && files.length) this.upload(files); }
    };
    $('#fHidden', el).onchange = (e) => { this.hidden = e.target.checked; this.render(); };
    const zone = $('#fdrop', el);
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); const f = [...e.dataTransfer.files]; if (f.length) this.upload(f); });
    $('#selClear', el).onclick = () => { this.sel.clear(); this.render(); };
    $('#selDl', el).onclick = () => this.download([...this.sel]);
    $('#selDel', el).onclick = () => this.remove([...this.sel]);
  },
  go(dir) { this.cwd = dir; this.sel.clear(); this.load(); },
  async load() {
    const dev = this.dev(); if (!dev) return;
    const el = this.el;
    $('#fPath', el).value = this.cwd;
    $$('[data-place]', el).forEach((b) => b.classList.toggle('on', b.dataset.place === this.cwd));
    const list = $('#fList', el);
    list.innerHTML = '<div class="status-line left pad"><span class="spinner"></span>Loading…</div>';
    const out = await ops(dev).text(LIST(this.cwd), 30000);
    if (/@@ERR/.test(out)) { list.innerHTML = `<div class="empty-inline small">This folder can't be opened — it doesn't exist or the device doesn't allow access to it.</div>`; this.items = []; return; }
    this.items = out.split(/\r?\n/).map((l) => { const m = l.match(/^([dlf])\|(\d*)\|(\d*)\|(.+)$/); return m && { kind: m[1], size: +m[2] || 0, mtime: +m[3] || 0, name: m[4] }; }).filter(Boolean)
      .sort((a, b) => (a.kind === 'd' ? 0 : 1) - (b.kind === 'd' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.render();
  },
  render() {
    const el = this.el; const list = $('#fList', el); if (!list) return;
    const items = this.items.filter((i) => this.hidden || !i.name.startsWith('.'));
    $('#selBar', el).classList.toggle('hidden', !this.sel.size);
    $('#selCount', el).textContent = `${this.sel.size} selected`;
    if (!items.length) { list.innerHTML = '<div class="empty-inline small">This folder is empty. Drop files here to upload them.</div>'; return; }
    list.innerHTML = items.map((i) => `
      <div class="file-row${this.sel.has(i.name) ? ' selected' : ''}" data-n="${esc(i.name)}" data-k="${i.kind}">
        <input type="checkbox" class="fsel" ${this.sel.has(i.name) ? 'checked' : ''} aria-label="Select">
        <span class="fname">${icon(i.kind === 'd' ? 'folder' : 'file', 'ic ' + (i.kind === 'd' ? 'folder-ic' : 'file-ic'))}<span>${esc(i.name)}</span>${i.kind === 'l' ? '<span class="tag">link</span>' : ''}</span>
        <span class="fsize">${i.kind === 'd' ? '' : fmtBytes(i.size)}</span>
        <span class="fdate">${fmtDate(i.mtime)}</span>
        <span class="factions"><button class="icon-btn" data-a="dl" title="Download">${icon('download')}</button><button class="icon-btn" data-a="more" title="More">${icon('more')}</button></span>
      </div>`).join('');
    list.onclick = (e) => {
      const row = e.target.closest('.file-row'); if (!row) return;
      const n = row.dataset.n, k = row.dataset.k, path = join(this.cwd, n);
      if (e.target.classList.contains('fsel')) { e.target.checked ? this.sel.add(n) : this.sel.delete(n); row.classList.toggle('selected', e.target.checked); $('#selBar', el).classList.toggle('hidden', !this.sel.size); $('#selCount', el).textContent = `${this.sel.size} selected`; return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'dl') return this.download([n]);
      if (a === 'more') return showMenu(e.target.closest('button'), [
        ...(k === 'd' ? [{ label: 'Open', icon: 'folder', run: () => this.go(path) }] : []),
        { label: 'Download', icon: 'download', run: () => this.download([n]) },
        { label: 'Download to…', icon: 'save', run: () => this.download([n], true) },
        ...(/\.(apk)$/i.test(n) ? [{ label: 'Install this APK', icon: 'apps', run: () => this.installRemote(path) }] : []),
        { label: 'Rename', icon: 'file', run: () => this.rename(n) },
        { label: 'Copy path', icon: 'copy', run: () => { api.copy(path); toast('Path copied'); } },
        '-', { label: 'Delete', icon: 'delete', danger: true, run: () => this.remove([n]) },
      ]);
      if (k === 'd' || k === 'l') this.go(path);
    };
  },
  async upload(files) {
    const dev = this.dev(); if (!dev) return;
    const off = api.on('transfer-progress', (p) => toast(p.text, { ms: 60000 }));
    toast(`Uploading ${files.length} item${files.length > 1 ? 's' : ''}…`, { ms: 60000 });
    try {
      const res = await ops(dev).push(files, this.cwd);
      const list = Array.isArray(res) ? res : [res];
      const bad = list.filter((r) => !r.ok);
      toast(bad.length ? bad.map((b) => b.msg).join(' • ') : list.length === 1 ? list[0].msg : `Uploaded ${list.length} items`, { error: !!bad.length });
      this.load();
    } finally { off(); }
  },
  async download(names, ask = false) {
    const dev = this.dev(); if (!dev || !names.length) return;
    const off = api.on('transfer-progress', (p) => toast(p.text, { ms: 60000 }));
    if (!ask) toast(`Downloading ${names.length > 1 ? names.length + ' items' : names[0]}…`, { ms: 60000 });
    try {
      const r = await ops(dev).pull(names.map((n) => join(this.cwd, n)), ask);
      if (r && r.cancelled) return;
      if (r.ok) toast(r.msg, { action: () => api.showFile(r.file), actionLabel: 'Show in folder' }); else toast(r.msg, { error: true });
    } finally { off(); }
  },
  async remove(names) {
    if (!(await confirmDialog(names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${names.length} items?`, { detail: 'This permanently deletes them from the device.', ok: 'Delete', danger: true }))) return;
    const r = await ops(this.dev()).run(names.map((n) => `rm -rf ${q(join(this.cwd, n))}`).join(' && ') + ' && echo ok', 120000);
    if (/ok/.test(r.out)) { toast('Deleted'); this.sel.clear(); this.load(); } else toast((r.out || r.msg || 'Could not delete').trim().split('\n').pop(), { error: true });
  },
  async rename(n) {
    const name = await promptDialog('Rename', { label: 'New name', value: n, ok: 'Rename' });
    if (!name || name === n) return;
    const r = await ops(this.dev()).run(`mv ${q(join(this.cwd, n))} ${q(join(this.cwd, name))} && echo ok`);
    if (/ok/.test(r.out)) { toast('Renamed'); this.load(); } else toast((r.out || r.msg || 'Could not rename').trim(), { error: true });
  },
  async installRemote(path) {
    toast('Installing…', { ms: 60000 });
    const r = await ops(this.dev()).run(`pm install -r -t ${q(path)}`, 600000);
    toast(/Success/.test(r.out) ? 'Installed' : (r.out || r.msg || 'Install failed').trim().split('\n').pop(), { error: !/Success/.test(r.out) });
  },
};
