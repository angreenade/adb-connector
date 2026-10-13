import { api, $, $$, esc, icon, toast, store, setSettings, call } from '../core.js';

export function applyTheme(t) {
  const mode = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.dataset.mode = mode;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.settings.theme));

export const page = {
  id: 'settings', title: 'Settings', icon: 'settings', noDevice: true,
  mount(el) { this.el = el; },
  async show() {
    const s = store.settings, el = this.el;
    const [ver, adbVer] = await Promise.all([call(api.appVersion), call(api.adbVersion)]);
    el.innerHTML = `
      <div class="settings-page">
        <header class="page-head"><div><h1>Settings</h1></div></header>
        <section class="panel">
          <h2>Appearance</h2>
          <div class="set-row"><span><b>Language</b></span><div class="seg notr" id="lang">${[['en', 'English'], ['he', 'עברית']].map(([v, t]) => `<button data-l="${v}" class="${(s.lang || 'en') === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
          <div class="set-row"><span><b>Theme</b></span><div class="seg" id="theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, t]) => `<button data-t="${v}" class="${(s.theme || 'system') === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        </section>
        <section class="panel">
          <h2>Saving</h2>
          <div class="set-row"><span><b>Save folder</b><small>${esc(s.saveDir || 'Default: Pictures, Videos and Downloads → “ADB Connector”')}</small></span><div class="row"><button class="btn tonal sm" id="pickDir">Choose…</button>${s.saveDir ? '<button class="btn text sm" id="resetDir">Use default</button>' : ''}</div></div>
          <div class="set-row"><span><b>Open folders</b></span><div class="row"><button class="btn text sm" data-open="screenshot">Screenshots</button><button class="btn text sm" data-open="recording">Recordings</button><button class="btn text sm" data-open="file">Downloads</button><button class="btn text sm" data-open="apk">Saved APKs</button></div></div>
        </section>
        <section class="panel">
          <h2>Connections</h2>
          <label class="set-row"><span><b>Reconnect automatically</b><small>Bring saved Wi-Fi devices back when they appear on the network</small></span><input type="checkbox" class="switch" id="auto" ${s.autoReconnect !== false ? 'checked' : ''}></label>
        </section>
        <section class="panel">
          <h2>Installing apps</h2>
          ${[['grant', 'Grant all permissions', 'Runtime permissions are granted at install'], ['downgrade', 'Allow downgrade', 'Install an older version over a newer one'], ['test', 'Allow test apps', 'Needed for debug builds from Android Studio']].map(([k, t, d]) => `<label class="set-row"><span><b>${t}</b><small>${d}</small></span><input type="checkbox" class="switch" data-inst="${k}" ${s.install && s.install[k] ? 'checked' : ''}></label>`).join('')}
        </section>
        <section class="panel">
          <h2>About</h2>
          <dl class="details compact"><div><dt>ADB Connector</dt><dd>${esc(ver || '')}</dd></div><div><dt>ADB</dt><dd>${esc(adbVer || 'not running')}</dd></div><div><dt>Screen mirroring</dt><dd>scrcpy 3.3.1</dd></div></dl>
          <div class="row"><button class="btn tonal sm" id="openLog">${icon('file')}Open log file</button></div>
        </section>
      </div>`;
    $$('#lang button', el).forEach((b) => (b.onclick = async () => { if ((store.settings.lang || 'en') === b.dataset.l) return; await setSettings({ lang: b.dataset.l }); try { localStorage.setItem('lang', b.dataset.l); } catch {} location.reload(); }));
    $$('#theme button', el).forEach((b) => (b.onclick = async () => { await setSettings({ theme: b.dataset.t }); applyTheme(b.dataset.t); $$('#theme button', el).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#pickDir', el).onclick = async () => { const d = await call(api.pickFolder); if (typeof d === 'string') { await setSettings({ saveDir: d }); toast('Save folder changed'); this.show(); } };
    const rd = $('#resetDir', el); if (rd) rd.onclick = async () => { await setSettings({ saveDir: '' }); this.show(); };
    $$('[data-open]', el).forEach((b) => (b.onclick = () => api.openFolder(b.dataset.open)));
    $('#auto', el).onchange = (e) => setSettings({ autoReconnect: e.target.checked });
    $$('[data-inst]', el).forEach((c) => (c.onchange = () => setSettings({ install: { ...store.settings.install, [c.dataset.inst]: c.checked } })));
    $('#openLog', el).onclick = () => api.openLog();
  },
};
