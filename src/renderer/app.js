import { api, $, $$, esc, icon, toast, report, call, store, on, emit, current, select, readyDevices, allDevices, deviceName, connLabel, isWatch, showMenu, closeDialog } from './core.js';
import { page as devices, stopWebAdb } from './pages/devices.js';
import { page as overview } from './pages/overview.js';
import { page as apps } from './pages/apps.js';
import { page as files } from './pages/files.js';
import { page as screen } from './pages/screen.js';
import { page as controls } from './pages/controls.js';
import { page as shell } from './pages/shell.js';
import { page as logcat } from './pages/logcat.js';
import { page as settings, applyTheme } from './pages/settings.js';
import { initUpdates } from './update.js';
import { initLanguage } from './i18n.js';
let earlyLang = 'en'; try { earlyLang = localStorage.getItem('lang') || 'en'; } catch {}
initLanguage(earlyLang);

window.addEventListener('error', (e) => console.error('UI error:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('UI promise:', e.reason && (e.reason.stack || e.reason.message || e.reason)));

const PAGES = [devices, overview, apps, files, screen, controls, shell, logcat, settings];
let active = null;

// ───── layout ─────
$('#rail').innerHTML = `
  <div class="brand"><img src="../../build/icon.png" alt="" /></div>
  ${PAGES.map((p, i) => `${p.id === 'settings' ? '<span class="rail-gap"></span>' : ''}<button class="rail-btn" data-page="${p.id}" title="${p.title} (Ctrl+${i + 1})">${icon(p.icon)}<span>${p.title}</span></button>`).join('')}`;
for (const p of PAGES) { const sec = document.createElement('section'); sec.className = 'page hidden'; sec.id = 'page-' + p.id; $('#view').append(sec); p.mount(sec); }
$$('.rail-btn').forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
initUpdates($('#rail'));

function navigate(id) {
  const p = PAGES.find((x) => x.id === id) || devices;
  if (active && active !== p && active.hide) { try { active.hide(); } catch (e) { console.error(e); } }
  active = p;
  $$('.page').forEach((s) => s.classList.toggle('hidden', s.id !== 'page-' + p.id));
  $$('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.page === p.id));
  $('#view').scrollTop = 0;
  showPage();
}
function showPage() {
  if (!active) return;
  try { if (active === devices) devices.render(); else if (active.show) active.show(active.noDevice ? null : current()); } catch (e) { console.error(e); }
}
on('navigate', navigate);

// ───── device switcher (top bar) ─────
function renderTop() {
  const d = current();
  const sw = $('#switcher');
  const lost = !d && store.selectedId && store.lostSince && Date.now() - store.lostSince < 30000;
  sw.className = 'switcher ' + (d ? 'live' : lost ? 'lost' : 'none');
  sw.innerHTML = d
    ? `<span class="sig"></span>${icon(isWatch(d) ? 'watch' : 'phone')}<span class="sw-name">${esc(deviceName(d))}</span><span class="sw-conn">${esc(connLabel(d))}</span>${readyDevices().length > 1 ? icon('more', 'ic sm') : ''}`
    : lost ? `<span class="sig"></span><span class="sw-name">Reconnecting…</span><span class="sw-conn">waiting for the device</span>` : `<span class="sig"></span><span class="sw-name">No device</span><span class="sw-conn">Connect one</span>`;
}
$('#switcher').onclick = (e) => {
  const ready = readyDevices();
  if (!ready.length) return navigate('devices');
  showMenu(e.currentTarget, [...ready.map((d) => ({ label: `${deviceName(d)} — ${connLabel(d)}${d.id === store.selectedId ? '  ✓' : ''}`, icon: isWatch(d) ? 'watch' : 'phone', run: () => select(d.id) })), '-', { label: 'Manage devices', icon: 'devices', run: () => navigate('devices') }]);
};
on('device', () => { renderTop(); showPage(); });

// ───── device list updates (with a grace period, so a brief Wi-Fi hiccup never looks like a disconnect) ─────
let lastCurId = null;
function onDevices() {
  const before = lastCurId;
  const d = current();
  if (!d && store.selectedId && !store.lostSince) store.lostSince = Date.now();
  if (!d && store.selectedId && store.lostSince && Date.now() - store.lostSince > 30000) {
    const name = store.lastName || 'The device';
    store.selectedId = null; store.lastSerials = []; store.lostSince = 0;
    if (readyDevices().length) current();
    else if (active && active !== devices && active !== settings) toast(`${name} disconnected`, { error: true });
  }
  if (d) store.lastName = deviceName(d);
  lastCurId = d ? d.id : null;
  renderTop();
  if (active === devices) devices.render();
  else if (lastCurId !== before && (d || !store.lostSince)) showPage();
}
api.on('devices', (list) => { store.devices = Array.isArray(list) ? list : []; onDevices(); });
on('devices', onDevices);
setInterval(() => { if (store.lostSince) onDevices(); }, 3000);

// ───── ADB status ─────
api.on('adb-status', (s) => {
  const c = $('#adbChip');
  const was = c.classList.contains('bad');
  c.className = 'adb-chip ' + (s.ok ? 'ok' : 'bad');
  c.textContent = s.ok ? (store.adbVer ? `ADB ${store.adbVer}` : 'ADB ready') : 'ADB problem';
  c.title = s.msg || '';
  if (!s.ok && s.msg && !was) toast(s.msg, { error: true });
});
api.on('toast', report);

// ───── drop an APK anywhere → install on the current device ─────
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const fl = [...(e.dataTransfer?.files || [])];
  if (!fl.length) return;
  if (!current()) return toast('Connect a device first, then drop the file again', { error: true });
  if (fl.every((f) => /\.(apk|apks|xapk|apkm)$/i.test(f.name))) { navigate('apps'); apps.install(fl); }
  else { navigate('files'); files.upload(fl); }
});

// ───── keyboard shortcuts ─────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && !e.target.closest('.xterm')) { const p = PAGES[+e.key - 1]; if (p) { e.preventDefault(); navigate(p.id); } }
});

// ───── start ─────
(async () => {
  const s = await call(api.settingsGet);
  store.settings = s && typeof s === 'object' && !('ok' in s && s.ok === false) ? s : {};
  applyTheme(store.settings.theme);
  const lang = store.settings.lang || 'en';
  if (lang !== earlyLang) { try { localStorage.setItem('lang', lang); } catch {} if (lang === 'he') initLanguage('he'); else { location.reload(); return; } }
  const list = await call(api.devices);
  if (Array.isArray(list)) store.devices = list;
  const v = await call(api.adbVersion);
  if (typeof v === 'string') { store.adbVer = v; $('#adbChip').textContent = `ADB ${v}`; $('#adbChip').className = 'adb-chip ok'; }
  navigate(current() ? 'overview' : 'devices');
  onDevices();
})();

// hooks used by the automated tests (install/upload a file by path, same code path as drag and drop)
window.__testInstall = (p) => apps.install([p]);
window.__testUpload = (p) => files.upload([p]);
