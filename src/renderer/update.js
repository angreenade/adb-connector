// Bottom-left update button: shows the version, and offers updates from GitHub Releases.
import { api, $, esc, icon, toast, openDialog, closeDialog } from './core.js';

let st = { state: 'idle', current: '' };
const btn = () => $('#updBtn');

function render() {
  const b = btn(); if (!b) return;
  const v = st.current ? 'v' + st.current : '';
  let cls = 'upd-btn', html = '', title = '';
  switch (st.state) {
    case 'checking': html = `<span class="spinner sm"></span><span>${v}</span>`; title = 'Checking for updates…'; break;
    case 'available': cls += ' hot'; html = `${icon('up')}<span>Update</span>`; title = `Version ${st.version} is available — click to update`; break;
    case 'downloading': cls += ' busy'; html = `<span class="upd-ring" style="--p:${st.percent || 0}"></span><span>${st.percent || 0}%</span>`; title = 'Downloading the update…'; break;
    case 'ready': cls += ' ready'; html = `${icon('refresh')}<span>Restart</span>`; title = `Version ${st.version} is ready — click to restart and install`; break;
    case 'error': cls += ' warn'; html = `<span class="dot"></span><span>${v}</span>`; title = `${st.msg || 'Could not check for updates'} — click to try again`; break;
    default: html = `<span class="dot ok"></span><span>${v}</span>`; title = st.state === 'none' ? 'You have the latest version — click to check again' : st.state === 'dev' ? 'Development build' : st.state === 'portable' ? 'This copy cannot update itself' : 'Click to check for updates';
  }
  b.className = cls; b.innerHTML = html; b.title = title;
}

function availableDialog() {
  openDialog(`<h2>Update available</h2>
    <p>Version <b>${esc(st.version)}</b> is ready to download. You have ${esc(st.current)}.</p>
    ${st.notes ? `<div class="upd-notes">${esc(st.notes)}</div>` : ''}
    <p class="note">Your devices, settings and app library are kept.</p>
    <div class="actions"><button class="btn text" data-x>Later</button><button class="btn filled" data-go>${icon('download')}Update now</button></div>`, (d) => {
    d.querySelector('[data-x]').onclick = closeDialog;
    d.querySelector('[data-go]').onclick = () => { closeDialog(); st = { ...st, state: 'downloading', percent: 0 }; render(); api.updateDownload().then((r) => { if (r && !r.ok) toast(r.msg || 'Download failed', { error: true }); }); };
  });
}
function readyDialog() {
  openDialog(`<h2>Restart to update</h2><p>Version <b>${esc(st.version)}</b> is downloaded. The app will close, install it and open again — it takes a few seconds.</p>
    <div class="actions"><button class="btn text" data-x>Later</button><button class="btn filled" data-go>Restart now</button></div>`, (d) => {
    d.querySelector('[data-x]').onclick = closeDialog;
    d.querySelector('[data-go]').onclick = () => { closeDialog(); api.updateInstall(); };
  });
}

async function onClick() {
  if (st.state === 'available') return availableDialog();
  if (st.state === 'ready') return readyDialog();
  if (st.state === 'downloading' || st.state === 'checking') return;
  if (st.state === 'dev') return toast('Updates work in the installed app');
  if (st.state === 'portable') {
    return openDialog(`<h2>Get the installer</h2><p>This copy runs without being installed, so it can't update itself. Install ADB Connector once with the setup file from the releases page — after that, updates arrive here with one click.</p>
      <div class="actions"><button class="btn text" data-x>Close</button><button class="btn filled" data-go>Open releases page</button></div>`, (d) => { d.querySelector('[data-x]').onclick = closeDialog; d.querySelector('[data-go]').onclick = () => { closeDialog(); api.openReleases(); }; });
  }
  st = { ...st, state: 'checking' }; render();
  const r = await api.updateCheck();
  if (r && r.state) { st = r; render(); }
  if (st.state === 'none') toast(`You have the latest version (${st.current})`);
  else if (st.state === 'available') availableDialog();
  else if (st.state === 'error') toast(st.msg || 'Could not check for updates', { error: true });
}

export function initUpdates(rail) {
  const b = document.createElement('button');
  b.id = 'updBtn'; b.className = 'upd-btn'; b.onclick = onClick;
  rail.append(b);
  let notifiedAvail = false, notifiedReady = false;
  api.on('update-state', (s) => {
    st = s; render();
    if (s.state === 'available' && !notifiedAvail) { notifiedAvail = true; toast(`Version ${s.version} is available — click Update at the bottom left`); }
    if (s.state === 'ready' && !notifiedReady) { notifiedReady = true; readyDialog(); }
  });
  api.updateState().then((s) => { if (s) { st = s; render(); } });
  api.appVersion().then((v) => { if (!st.current) { st.current = v; render(); } });
  render();
}
