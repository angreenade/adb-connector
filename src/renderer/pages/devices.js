import QRCode from 'qrcode';
import { api, $, $$, esc, icon, toast, report, call, openDialog, closeDialog, showMenu, store, allDevices, deviceName, connLabel, address, isWatch, select, emit } from '../core.js';
import { connectWebUsb, pickWebUsbDevice, webUsbSupported } from '../webadb.js';

const STATE = {
  device: ['Connected', 'ok'],
  unauthorized: ['Tap “Allow” on the device screen', 'warn'],
  authorizing: ['Waiting for the device…', 'warn'],
  connecting: ['Connecting…', 'warn'],
  offline: ['Not responding — reconnecting…', 'warn'],
  'no permissions': ['USB driver needed', 'warn'],
  recovery: ['In recovery mode', 'warn'],
  bootloader: ['In bootloader', 'warn'],
  sideload: ['Sideload mode', 'warn'],
  saved: ['Not connected', 'muted'],
};

export const page = {
  id: 'devices', title: 'Devices', icon: 'devices',
  mount(el) {
    el.innerHTML = `
      <header class="page-head"><div><h1>Devices</h1><p class="sub">Connect a Galaxy Watch or Android phone over Wi-Fi or USB.</p></div></header>
      <div class="connect-grid">
        <button class="tile primary" id="btnPair">${icon('pair')}<span><b>Wireless pairing</b><small>First time with a watch or phone</small></span></button>
        <button class="tile" id="btnIp">${icon('link')}<span><b>IP connect</b><small>Already paired — type IP and port</small></span></button>
        <button class="tile" id="btnScan">${icon('search')}<span><b>Scan network</b><small>Find devices on this Wi-Fi</small></span></button>
        <button class="tile" id="btnUsb">${icon('usb')}<span><b>USB direct</b><small>WebADB, no driver server</small></span></button>
      </div>
      <div id="webadbBanner" class="banner hidden">${icon('usb')}<span>USB direct mode is on. Wi-Fi devices are paused until you stop it.</span><button class="btn text" id="webadbStop">Stop</button></div>
      <section class="list-section">
        <h2>Your devices</h2>
        <ul id="deviceList" class="dev-list"></ul>
        <div id="emptyState" class="empty-inline">
          ${icon('watch', 'ic big')}
          <div><b>No devices yet</b><p>For a Galaxy Watch: on the watch open <b>Settings → Developer options → Wireless debugging → Pair new device</b>, then click <b>Wireless pairing</b>.</p></div>
        </div>
      </section>`;
    $('#btnPair', el).onclick = () => pairDialog('code');
    $('#btnIp', el).onclick = () => ipDialog();
    $('#btnScan', el).onclick = scanDialog;
    $('#btnUsb', el).onclick = usbDialog;
    $('#webadbStop', el).onclick = stopWebAdb;
    this.el = el;
    this.render();
  },
  render() {
    const el = this.el; if (!el) return;
    const all = allDevices();
    $('#emptyState', el).classList.toggle('hidden', all.length > 0);
    $('#webadbBanner', el).classList.toggle('hidden', !store.webDev);
    const list = $('#deviceList', el);
    list.innerHTML = '';
    for (const d of all) {
      const [stText, stCls] = d.busy && d.saved ? ['Reconnecting…', 'warn'] : (STATE[d.state] || [d.state, 'warn']);
      const li = document.createElement('li');
      li.className = 'dev' + (d.saved ? ' saved' : '') + (d.id === store.selectedId && d.state === 'device' ? ' selected' : '');
      const sub = [d.info && d.info.android ? `Android ${d.info.android}` : '', connLabel(d)].filter(Boolean);
      li.innerHTML = `
        <span class="dev-icon ${d.state === 'device' ? 'live' : ''}">${icon(isWatch(d) ? 'watch' : 'phone')}</span>
        <div class="dev-main">
          <div class="dev-name">${esc(deviceName(d))}</div>
          <div class="dev-meta"><code>${esc(address(d))}</code>${sub.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
          <div class="dev-state ${stCls}">${d.busy && d.saved ? '<span class="spinner tiny"></span>' : ''}${esc(stText)}</div>
        </div>
        <div class="dev-actions">
          ${d.state === 'device' ? `<button class="btn tonal sm" data-act="open">Open tools</button>` : ''}
          ${d.saved ? `<button class="btn tonal sm" data-act="reconnect" ${d.busy ? 'disabled' : ''}>Reconnect</button>` : ''}
          ${!d.saved && (d.web || d.type === 'wifi') ? `<button class="icon-btn" data-act="disc" title="Disconnect">${icon('linkOff')}</button>` : ''}
          <button class="icon-btn" data-act="more" title="More">${icon('more')}</button>
        </div>`;
      li.onclick = (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'disc') return disconnect(d);
        if (act === 'more') return showMenu(e.target.closest('button'), menuFor(d));
        if (act === 'reconnect' || d.saved) return reconnect(d);
        if (d.state === 'device') { select(d.id); emit('navigate', 'overview'); }
        else if (d.state === 'unauthorized') toast('Look at the device screen and tap “Allow” (tick “Always allow from this computer”).');
      };
      list.append(li);
    }
  },
};

function menuFor(d) {
  const items = [];
  if (d.state === 'device') items.push({ label: 'Open tools', icon: 'apps', run: () => { select(d.id); emit('navigate', 'overview'); } });
  if (d.saved) items.push({ label: 'Reconnect', icon: 'refresh', run: () => reconnect(d) }, { label: 'Pair again', icon: 'pair', run: () => pairDialog('code', d.ip + ':') });
  if (!d.web && d.type === 'usb' && d.state === 'device') items.push({ label: 'Switch to Wi-Fi', icon: 'wifi', run: async () => { toast('Switching to Wi-Fi…'); report(await call(api.usbToWifi, d.id)); } });
  items.push({ label: 'Copy address', icon: 'copy', run: () => { api.copy(address(d)); toast('Copied'); } });
  if (!d.saved && (d.web || d.type === 'wifi')) items.push({ label: 'Disconnect', icon: 'linkOff', run: () => disconnect(d) });
  if (!d.web && d.type === 'wifi') items.push('-', { label: 'Remove from list', icon: 'delete', danger: true, run: async () => report(await call(api.disconnect, { ...d, forget: true })) });
  return items;
}
async function disconnect(d) { if (d.web) return stopWebAdb(); report(await call(api.disconnect, d)); }
async function reconnect(d) {
  if (d.busy) return;
  d.busy = true; page.render();
  const r = await call(api.reconnect, d.ip);
  d.busy = false;
  if (r.ok) toast(r.msg);
  else openDialog(`<h2>Couldn't reconnect</h2><p>${esc(r.msg)}</p><p class="note">If Wireless debugging was turned off and on, or the watch restarted, pair it again — the port and code change each time.</p>
      <div class="actions"><button class="btn text" data-x>Close</button><button class="btn filled" data-p>Pair again</button></div>`, (dl) => {
    $('[data-x]', dl).onclick = closeDialog;
    $('[data-p]', dl).onclick = () => { closeDialog(); pairDialog('code', d.ip + ':'); };
  });
}

function afterConnect(addr) {
  // select the new device as soon as it shows up, then open its overview
  let tries = 0;
  const t = setInterval(() => {
    const d = allDevices().find((x) => x.state === 'device' && [x.serial, ...(x.aliases || [])].includes(addr));
    if (d || ++tries > 20) { clearInterval(t); if (d) { select(d.id); emit('navigate', 'overview'); } }
  }, 400);
}

// ───────── IP connect ─────────
export function ipDialog(prefill = '') {
  openDialog(`
    <h2>IP connect</h2>
    <p>On the device open <b>Settings → Developer options → Wireless debugging</b> and type the <b>IP address & port</b> shown there.</p>
    <form id="f">
      <label class="field"><span>IP address and port</span><input id="addr" class="mono" placeholder="192.168.1.235:44929" value="${esc(prefill)}" spellcheck="false" /></label>
      <p id="msg" class="hidden"></p>
      <p class="note">First time with this device? Use <b>Wireless pairing</b> instead — it needs a pairing code once.</p>
      <div class="actions"><button type="button" class="btn text" data-x>Cancel</button><button class="btn filled" id="go">Connect</button></div>
    </form>`, (d) => {
    $('[data-x]', d).onclick = closeDialog;
    $('#f', d).onsubmit = async (e) => {
      e.preventDefault();
      const go = $('#go', d), msg = $('#msg', d);
      go.disabled = true; go.textContent = 'Connecting…'; msg.className = 'hidden';
      const r = await call(api.connect, $('#addr', d).value);
      go.disabled = false; go.textContent = 'Connect';
      if (r.ok) { closeDialog(); toast(r.msg); if (r.address) afterConnect(r.address); }
      else if (r.notPaired) { closeDialog(); pairDialog('code', ($('#addr', d).value.split(':')[0] || '') + ':'); toast(r.msg, { error: true }); }
      else { msg.textContent = r.msg; msg.className = 'err-text'; }
    };
  });
}

// ───────── scan ─────────
function scanDialog() {
  openDialog(`<h2>Scan network</h2><div id="body"><div class="status-line"><span class="spinner"></span>Looking for devices on your network…</div></div>
    <div class="actions"><button class="btn text" data-x>Close</button></div>`, (d) => {
    let alive = true;
    $('[data-x]', d).onclick = closeDialog;
    (async () => {
      const found = await call(api.scan);
      if (!alive) return;
      const list = Array.isArray(found) ? found : [];
      const body = $('#body', d);
      if (!list.length) {
        body.innerHTML = `<p>No devices found.</p><ul class="hints"><li>The device and this computer must be on the <b>same Wi-Fi</b>.</li><li>Turn on <b>Wireless debugging</b> in Developer options.</li><li>Galaxy Watch, or first time? Use <b>Wireless pairing</b> — watches often don't show up in a scan.</li></ul>`;
        return;
      }
      body.innerHTML = `<ul class="pick-list">${list.map((f, i) => `<li><div><code>${esc(f.address)}</code><small>${esc(f.kind === 'pairing' ? 'Ready to pair — ' : '')}${esc(f.label)}</small></div>
        ${f.connected ? '<span class="tag ok">Connected</span>' : `<button class="btn filled sm" data-i="${i}">${f.kind === 'pairing' ? 'Pair' : 'Connect'}</button>`}</li>`).join('')}</ul>`;
      $$('[data-i]', body).forEach((b) => (b.onclick = async () => {
        const f = list[+b.dataset.i];
        if (f.kind === 'pairing') { closeDialog(); return pairDialog('code', f.address); }
        b.disabled = true; b.textContent = 'Connecting…';
        const r = await call(api.connect, f.address);
        if (r.ok) { b.outerHTML = '<span class="tag ok">Connected</span>'; toast(r.msg); }
        else { b.disabled = false; b.textContent = 'Connect'; toast(r.msg, { error: true }); }
      }));
    })();
    return () => { alive = false; };
  });
}

// ───────── wireless pairing (code for watches & phones, QR for phones) ─────────
export function pairDialog(tab = 'code', prefill = '') {
  openDialog(`
    <h2>Wireless pairing</h2>
    <div class="tabs"><button data-tab="code">Pairing code</button><button data-tab="qr">QR code (phones)</button></div>
    <form data-pane="code" id="codeForm" autocomplete="off">
      <div id="step1">
        <ol class="steps">
          <li>On the watch or phone: <b>Settings → Developer options → Wireless debugging</b> (turn it on).</li>
          <li>Tap <b>Pair new device</b> and keep that screen open.</li>
          <li>Type the IP address, port and code it shows:</li>
        </ol>
        <div class="addr-row">
          <label class="field grow"><span>IP address</span><input id="pip" class="mono" placeholder="192.168.1.235" inputmode="decimal" /></label>
          <span class="colon">:</span>
          <label class="field port"><span>Port</span><input id="pport" class="mono" placeholder="37011" inputmode="numeric" maxlength="5" /></label>
        </div>
        <label class="field"><span>Pairing code</span><input id="pcode" class="code" inputmode="numeric" maxlength="7" placeholder="000000" /></label>
        <p id="pmsg" class="hidden"></p>
        <div class="status-line left hidden" id="pstatus"><span class="spinner"></span><span></span></div>
        <div class="actions"><button type="button" class="btn text" data-x>Close</button><button class="btn filled" id="pgo">Pair and connect</button></div>
      </div>
      <div id="step2" class="hidden">
        <div class="success-line">${icon('check')}<span>Paired. One last step.</span></div>
        <ol class="steps">
          <li>Go back to the <b>Wireless debugging</b> screen on the device.</li>
          <li>Under <b>IP address & port</b>, type the number after the colon:</li>
        </ol>
        <div class="addr-row">
          <label class="field grow"><span>IP address</span><input id="cip" class="mono" readonly /></label>
          <span class="colon">:</span>
          <label class="field port"><span>Port</span><input id="cport" class="mono" placeholder="44929" inputmode="numeric" maxlength="5" /></label>
        </div>
        <p id="cmsg" class="hidden"></p>
        <div class="actions"><button type="button" class="btn text" data-x>Close</button><button type="button" class="btn filled" id="cgo">Connect</button></div>
      </div>
    </form>
    <div data-pane="qr">
      <div class="qr" id="qr"><span class="spinner"></span></div>
      <ol class="steps"><li>On the phone: <b>Settings → Developer options → Wireless debugging</b>.</li><li>Tap <b>Pair device with QR code</b> and scan this.</li></ol>
      <p class="note">Galaxy Watch can't scan codes — use the <b>Pairing code</b> tab.</p>
      <div class="status-line" id="qrStatus"><span class="spinner"></span>Waiting for the phone…</div>
      <div class="actions"><button type="button" class="btn text" data-x>Close</button></div>
    </div>`, (d) => {
    let qrActive = false, pairing = false;
    if (prefill) { const [ip, port] = prefill.split(':'); $('#pip', d).value = ip || ''; $('#pport', d).value = port || ''; }
    $('#pip', d).addEventListener('input', (e) => {
      const m = e.target.value.replace(/\s/g, '').match(/^(\d+\.\d+\.\d+\.\d+)[:：](\d{1,5})$/);
      if (m) { e.target.value = m[1]; $('#pport', d).value = m[2]; $('#pcode', d).focus(); }
    });
    $('#pport', d).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); if (e.target.value.length === 5) $('#pcode', d).focus(); });
    $('#pcode', d).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    $('#cport', d).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

    const setTab = async (t) => {
      if (pairing) return;
      $$('[data-tab]', d).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      $$('[data-pane]', d).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t));
      if (t === 'qr' && !qrActive) {
        qrActive = true;
        const r = await call(api.pairQrStart);
        if (r.qr) $('#qr', d).innerHTML = `<img alt="Pairing QR code" src="${await QRCode.toDataURL(r.qr, { margin: 1, width: 416, errorCorrectionLevel: 'M' })}">`;
      }
      if (t === 'code') setTimeout(() => { const ip = $('#pip', d); (ip.value ? ($('#pport', d).value ? $('#pcode', d) : $('#pport', d)) : ip).focus(); }, 20);
    };
    $$('[data-tab]', d).forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
    $$('[data-x]', d).forEach((b) => (b.onclick = closeDialog));
    const status = $('#pstatus', d);
    const showStatus = (t) => { status.classList.remove('hidden'); status.querySelector('span:last-child').textContent = t; };
    const offPair = api.on('pair-status', (s) => { if (pairing) showStatus(s.text); });
    const offQr = api.on('qr-status', (s) => {
      const el = $('#qrStatus', d);
      if (s.stage === 'pairing') el.innerHTML = '<span class="spinner"></span>Pairing…';
      else if (s.stage === 'done') { closeDialog(); toast('Paired and connected'); }
      else if (s.stage === 'paired') { setTab('code'); goStep2(s.ip); }
      else if (s.stage === 'error') { el.innerHTML = `<span class="err-text">${esc(s.msg)}</span>`; qrActive = false; }
    });
    const goStep2 = (ip) => { $('#step1', d).classList.add('hidden'); $('#step2', d).classList.remove('hidden'); $('#cip', d).value = ip; setTimeout(() => $('#cport', d).focus(), 30); };
    const fail = (el, text, focusEl) => { el.textContent = text; el.className = 'err-text'; if (focusEl) { focusEl.focus(); focusEl.select && focusEl.select(); } };

    $('#codeForm', d).onsubmit = async (e) => {
      e.preventDefault();
      if (!$('#step2', d).classList.contains('hidden')) return $('#cgo', d).click();
      if (pairing) return;
      const msg = $('#pmsg', d), go = $('#pgo', d);
      const ip = $('#pip', d).value.trim(), port = $('#pport', d).value.trim(), code = $('#pcode', d).value.trim();
      msg.className = 'hidden';
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return fail(msg, 'Type the IP address, e.g. 192.168.1.235', $('#pip', d));
      if (!/^\d{2,5}$/.test(port)) return fail(msg, 'Type the port — the number after the colon on the “Pair new device” screen', $('#pport', d));
      if (!/^\d{6}$/.test(code)) return fail(msg, 'The pairing code has 6 digits', $('#pcode', d));
      pairing = true; go.disabled = true; go.textContent = 'Working…'; go.dataset.busy = '1';
      $$('#step1 input', d).forEach((i) => (i.disabled = true));
      showStatus('Pairing…');
      const r = await call(api.pairCode, `${ip}:${port}`, code);
      pairing = false; go.disabled = false; go.textContent = 'Pair and connect'; delete go.dataset.busy;
      $$('#step1 input', d).forEach((i) => (i.disabled = false));
      status.classList.add('hidden');
      if (!r.ok) return fail(msg, r.msg, r.field === 'code' ? $('#pcode', d) : r.field === 'addr' ? $('#pport', d) : null);
      if (r.connected) { closeDialog(); toast(r.msg); afterConnect(r.address); return; }
      goStep2(r.ip || ip);
    };
    $('#cgo', d).onclick = async () => {
      const msg = $('#cmsg', d), go = $('#cgo', d);
      const port = $('#cport', d).value.trim();
      msg.className = 'hidden';
      if (!/^\d{2,5}$/.test(port)) return fail(msg, 'Type the port number shown after the colon', $('#cport', d));
      go.disabled = true; go.textContent = 'Connecting…';
      const addr = `${$('#cip', d).value}:${port}`;
      const r = await call(api.connect, addr);
      go.disabled = false; go.textContent = 'Connect';
      if (r.ok) { closeDialog(); toast(r.msg); afterConnect(addr); }
      else fail(msg, r.msg, $('#cport', d));
    };
    setTab(tab);
    return () => { offPair(); offQr(); api.pairQrCancel(); if (pairing) api.pairCancel(); };
  });
}

// ───────── USB direct (WebADB) ─────────
function usbDialog() {
  if (store.webDev) { select(store.webDev.id); return emit('navigate', 'overview'); }
  openDialog(`
    <h2>USB direct (WebADB)</h2>
    <p>Talks to the device straight over the cable, without the ADB server. Use it when a phone doesn't show up the normal way.</p>
    <ol class="steps"><li>Turn on <b>USB debugging</b> in Developer options.</li><li>Plug the phone in and click <b>Choose device</b>.</li><li>Tap <b>Allow</b> on the phone.</li></ol>
    <p class="note">While it's on, Wi-Fi devices are paused. Galaxy Watch has no USB data port — use Wireless pairing for it.</p>
    <p id="umsg" class="hidden"></p>
    <div class="actions"><button class="btn text" data-x>Cancel</button><button class="btn filled" id="ugo">Choose device</button></div>`, (d) => {
    $('[data-x]', d).onclick = closeDialog;
    $('#ugo', d).onclick = async () => {
      const go = $('#ugo', d), msg = $('#umsg', d);
      if (!webUsbSupported()) { msg.textContent = 'USB direct mode is not available on this computer.'; msg.className = 'err-text'; return; }
      go.disabled = true; msg.className = 'hidden';
      let usb; try { usb = await pickWebUsbDevice(); } catch (e) { console.error(e); usb = null; }
      if (!usb) { go.disabled = false; msg.textContent = 'No device found. Is the cable plugged in and USB debugging on?'; msg.className = 'err-text'; return; }
      go.textContent = 'Preparing…';
      await call(api.webadbBegin);
      try {
        go.textContent = 'Tap “Allow” on the phone…';
        const dev = await connectWebUsb(usb);
        store.webDev = dev;
        dev.disconnected.then(() => { if (store.webDev === dev) { store.webDev = null; api.webadbEnd(); emit('devices'); toast('USB direct device disconnected'); } }).catch(() => {});
        closeDialog(); emit('devices'); toast('Connected over USB direct');
        select(dev.id); emit('navigate', 'overview');
      } catch (e) {
        console.error(e); await call(api.webadbEnd);
        go.disabled = false; go.textContent = 'Try again'; msg.textContent = e.message || String(e); msg.className = 'err-text';
      }
    };
  });
}
export async function stopWebAdb() {
  if (!store.webDev) return;
  const d = store.webDev; store.webDev = null;
  try { await d.close(); } catch {}
  await call(api.webadbEnd);
  emit('devices'); toast('USB direct stopped');
}
api.on('usb-choose', (list) => {
  openDialog(`<h2>Choose a device</h2><ul class="pick-list">${list.map((d) => `<li><div><b>${esc(d.name)}</b></div><button class="btn filled sm" data-id="${esc(d.id)}">Use</button></li>`).join('')}</ul>
    <div class="actions"><button class="btn text" data-x>Cancel</button></div>`, (dlg) => {
    let chosen = '';
    $$('[data-id]', dlg).forEach((b) => (b.onclick = () => { chosen = b.dataset.id; closeDialog(); }));
    $('[data-x]', dlg).onclick = closeDialog;
    return () => api.usbChosen(chosen);
  });
});
