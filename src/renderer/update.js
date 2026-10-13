// Bottom-left update button: shows the version, and offers updates from GitHub Releases.
import { api, $, icon, toast, openDialog, closeDialog } from './core.js';

let st = { state: 'idle', current: '' };
const btn = () => $('#updBtn');

function render() {
  const b = btn(); if (!b) return;
  const v = st.current ? 'v' + st.current : '';
  let cls = 'upd-btn', html = '', title = '';
  switch (st.state) {
    case 'checking': html = `<span class="spinner sm"></span><span>${v}</span>`; title = 'Checking for updates…'; break;
    case 'available': cls += ' hot'; html = `${icon('up')}<span>Update</span>`; title = `Version ${st.version} is available — click to update`; break;
    case 'downloading': cls += ' busy'; html = `<span class="upd-ring" style="--p:${st.percent || 0}"></span><span>${st.percent || 0}%</span>`; title = `Updating to ${st.version || 'the new version'}…`; break;
    case 'ready': cls += ' hot'; html = `${icon('up')}<span>Update</span>`; title = `Version ${st.version} is ready — click to update`; break;
    case 'installing': cls += ' ready'; html = `<span class="spinner sm"></span><span>100%</span>`; title = 'Restarting into the new version…'; break;
    case 'error': cls += ' warn'; html = `<span class="dot"></span><span>${v}</span>`; title = `${st.msg || 'Could not check for updates'} — click to try again`; break;
    default: html = `<span class="dot ok"></span><span>${v}</span>`; title = st.state === 'none' ? 'You have the latest version — click to check again' : st.state === 'dev' ? 'Development build' : st.state === 'portable' ? 'This copy cannot update itself' : 'Click to check for updates';
  }
  b.className = cls; b.innerHTML = html; b.title = title;
}

function startUpdate() {
  st = { ...st, state: 'downloading', percent: 0 }; render();
  toast(`Updating to ${st.version || 'the new version'} — the app restarts by itself when it's done`);
  api.updateDownload().then((r) => { if (r && !r.ok) toast(r.msg || 'The update could not be downloaded', { error: true }); });
}

async function onClick() {
  if (st.state === 'available' || st.state === 'ready') return startUpdate();
  if (st.state === 'downloading' || st.state === 'checking' || st.state === 'installing') return;
  if (st.state === 'dev') return toast('Updates work in the installed app');
  if (st.state === 'portable') {
    return openDialog(`<h2>Get the installer</h2><p>This copy runs without being installed, so it can't update itself. Install ADB Connector once with the setup file from the releases page — after that, updates arrive here with one click.</p>
      <div class="actions"><button class="btn text" data-x>Close</button><button class="btn filled" data-go>Open releases page</button></div>`, (d) => { d.querySelector('[data-x]').onclick = closeDialog; d.querySelector('[data-go]').onclick = () => { closeDialog(); api.openReleases(); }; });
  }
  st = { ...st, state: 'checking' }; render();
  const r = await api.updateCheck();
  if (r && r.state) { st = r; render(); }
  if (st.state === 'none') toast(`You have the latest version (${st.current})`);
  else if (st.state === 'error') toast(st.msg || 'Could not check for updates', { error: true });
}

export function initUpdates(rail) {
  const b = document.createElement('button');
  b.id = 'updBtn'; b.className = 'upd-btn'; b.onclick = onClick;
  rail.append(b);
  let notifiedAvail = false, notifiedDone = false;
  api.on('update-state', (s) => {
    st = s; render();
    if (s.state === 'available' && !notifiedAvail) { notifiedAvail = true; toast(`Version ${s.version} is available — click Update at the bottom left`); }
    if (s.state === 'installing' && !notifiedDone) { notifiedDone = true; toast(s.patchMB ? `Update downloaded — only ${s.patchMB} MB instead of ${s.fullMB} MB. Restarting…` : 'Update downloaded. Restarting…'); }
  });
  api.updateState().then((s) => { if (s) { st = s; render(); } });
  api.appVersion().then((v) => { if (!st.current) { st.current = v; render(); } });
  render();
}
