import { api, $, esc, icon, toast, fileToast, report, ops, deviceName, connLabel, address, isWatch, needDevice, fmtBytes, fmtDuration, showMenu, confirmDialog, emit, busyBtn , sameDevice } from '../core.js';

const INFO_CMD = [
  ['manufacturer', 'getprop ro.product.manufacturer'], ['brand', 'getprop ro.product.brand'], ['model', 'getprop ro.product.model'],
  ['device', 'getprop ro.product.device'], ['android', 'getprop ro.build.version.release'], ['sdk', 'getprop ro.build.version.sdk'],
  ['patch', 'getprop ro.build.version.security_patch'], ['build', 'getprop ro.build.display.id'], ['abi', 'getprop ro.product.cpu.abi'],
  ['serial', 'getprop ro.serialno'], ['uptime', 'cat /proc/uptime'], ['size', 'wm size 2>/dev/null | tail -n 1'],
  ['density', 'wm density 2>/dev/null | tail -n 1'], ['ip', "ip -f inet addr show wlan0 2>/dev/null | grep -o 'inet [0-9.]*'"],
  ['mem', "grep -E 'MemTotal|MemAvailable' /proc/meminfo | tr -s ' ' | tr '\\n' ' '"], ['df', 'df -k /data 2>/dev/null | tail -n 1'],
].map(([k, c]) => `echo "@${k}=$(${c})"`).join('; ') + '; echo "@battery"; dumpsys battery 2>/dev/null';

function parse(out) {
  const v = {};
  const [head, bat = ''] = out.split('@battery');
  for (const line of head.split(/\r?\n/)) { const m = line.match(/^@(\w+)=(.*)$/); if (m) v[m[1]] = m[2].trim(); }
  const b = {};
  for (const line of bat.split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z ]+):\s*(.+)$/); if (m) b[m[1].trim().toLowerCase()] = m[2].trim(); }
  v.battery = b;
  const mt = (v.mem || '').match(/MemTotal: (\d+)/), ma = (v.mem || '').match(/MemAvailable: (\d+)/);
  v.memTotal = mt ? +mt[1] * 1024 : 0; v.memAvail = ma ? +ma[1] * 1024 : 0;
  const df = (v.df || '').trim().split(/\s+/);
  if (df.length >= 4 && /^\d+$/.test(df[1])) { v.diskTotal = +df[1] * 1024; v.diskUsed = +df[2] * 1024; v.diskFree = +df[3] * 1024; }
  v.uptimeSec = parseFloat(v.uptime) || 0;
  v.resolution = (v.size || '').replace(/^.*?:\s*/, '');
  v.dpi = (v.density || '').replace(/^.*?:\s*/, '');
  v.ipAddr = (v.ip || '').replace('inet ', '');
  return v;
}
const BAT_STATUS = { 1: 'Unknown', 2: 'Charging', 3: 'On battery', 4: 'Not charging', 5: 'Full' };

export { reboot };
export const page = {
  id: 'overview', title: 'Overview', icon: 'info',
  mount(el) { this.el = el; },
  async show(dev) {
    const el = this.el;
    clearInterval(this.timer);
    if (!dev) return needDevice(el, 'the overview');
    if (sameDevice(this.dev, dev)) this.dev = dev.id;
    if (this.dev !== dev.id || !el.querySelector('.ov')) { this.dev = dev.id; this.skeleton(dev); }
    this.hero(dev);
    await this.load(dev);
    this.timer = setInterval(() => { if (!el.closest('.hidden') && document.visibilityState === 'visible') this.load(dev, true); }, 20000);
  },
  hide() { clearInterval(this.timer); },
  // name/icon can change right after connecting (the device identifies itself a moment later)
  hero(dev) {
    const el = this.el;
    const h = el.querySelector('.hero'); if (!h) return;
    h.querySelector('.hero-icon').innerHTML = icon(isWatch(dev) ? 'watch' : 'phone');
    h.querySelector('h1').textContent = deviceName(dev);
    h.querySelector('.hero-text p').innerHTML = `<span class="tag live">${esc(connLabel(dev))}</span><code>${esc(address(dev))}</code>`;
  },
  skeleton(dev) {
    const el = this.el;
    el.innerHTML = `
      <div class="ov">
        <section class="hero">
          <span class="hero-icon">${icon(isWatch(dev) ? 'watch' : 'phone')}</span>
          <div class="hero-text">
            <h1>${esc(deviceName(dev))}</h1>
            <p><span class="tag live">${esc(connLabel(dev))}</span><code>${esc(address(dev))}</code></p>
          </div>
          <div class="hero-actions">
            <button class="btn tonal" id="ovShot">${icon('camera')}Screenshot</button>
            <button class="btn tonal" id="ovMirror">${icon('cast')}Mirror</button>
            <button class="btn tonal" id="ovPower">${icon('power')}Restart</button>
            <button class="icon-btn" id="ovRefresh" title="Refresh">${icon('refresh')}</button>
          </div>
        </section>
        <section class="stats" id="ovStats">${['Battery', 'Storage', 'Memory', 'Screen'].map((t) => `<div class="stat loading"><span class="stat-label">${t}</span><span class="stat-value">…</span><span class="bar"><i></i></span><span class="stat-sub">&nbsp;</span></div>`).join('')}</section>
        <section class="panel">
          <div class="panel-head"><h2>Details</h2><button class="btn text sm" id="ovCopy">${icon('copy')}Copy all</button></div>
          <dl class="details" id="ovDetails"></dl>
        </section>
      </div>`;
    const o = ops(dev);
    $('#ovShot', el).onclick = (e) => busyBtn(e.currentTarget, async () => fileToast(await o.screenshot()));
    $('#ovMirror', el).onclick = async () => report(await o.mirror());
    $('#ovRefresh', el).onclick = (e) => busyBtn(e.currentTarget, () => this.load(dev));
    $('#ovPower', el).onclick = (e) => showMenu(e.currentTarget, [
      { label: 'Restart', icon: 'refresh', run: () => reboot(o, '', 'Restart the device?') },
      { label: 'Restart to recovery', icon: 'power', run: () => reboot(o, 'recovery', 'Restart into recovery mode?') },
      { label: 'Restart to bootloader', icon: 'power', run: () => reboot(o, 'bootloader', 'Restart into the bootloader?') },
      '-', { label: 'Power off', icon: 'power', danger: true, run: () => reboot(o, 'poweroff', 'Turn the device off?') },
    ]);
    $('#ovCopy', el).onclick = () => { api.copy(this.text || ''); toast('Device details copied'); };
  },
  async load(dev, quiet) {
    const el = this.el;
    const out = await ops(dev).text(INFO_CMD, 20000);
    if (!out) { if (!quiet) toast('Could not read device details. Is the device awake?', { error: true }); return; }
    const v = parse(out);
    const b = v.battery;
    const level = +b.level || 0;
    const charging = ['2', '5'].includes(b.status) || b['ac powered'] === 'true' || b['usb powered'] === 'true' || b['wireless powered'] === 'true';
    const temp = b.temperature ? (+b.temperature / 10).toFixed(1) + ' °C' : '';
    const stats = [
      { label: 'Battery', value: b.level ? `${level}%` : '—', pct: level, sub: [BAT_STATUS[b.status] || (charging ? 'Charging' : ''), temp].filter(Boolean).join(', '), tone: level <= 15 && !charging ? 'bad' : level <= 30 ? 'warn' : 'ok' },
      { label: 'Storage', value: v.diskTotal ? `${fmtBytes(v.diskFree)} free` : '—', pct: v.diskTotal ? (v.diskUsed / v.diskTotal) * 100 : 0, sub: v.diskTotal ? `${fmtBytes(v.diskUsed)} of ${fmtBytes(v.diskTotal)} used` : '', tone: v.diskTotal && v.diskFree / v.diskTotal < 0.1 ? 'bad' : 'ok' },
      { label: 'Memory', value: v.memTotal ? `${fmtBytes(v.memAvail)} free` : '—', pct: v.memTotal ? ((v.memTotal - v.memAvail) / v.memTotal) * 100 : 0, sub: v.memTotal ? `${fmtBytes(v.memTotal)} total` : '', tone: 'ok' },
      { label: 'Screen', value: v.resolution || '—', pct: -1, sub: v.dpi ? `${v.dpi} dpi` : '', tone: 'ok' },
    ];
    $('#ovStats', el).innerHTML = stats.map((s) => `<div class="stat tone-${s.tone}"><span class="stat-label">${s.label}</span><span class="stat-value">${esc(s.value)}</span>${s.pct >= 0 ? `<span class="bar"><i style="width:${Math.max(2, Math.min(100, s.pct)).toFixed(0)}%"></i></span>` : '<span class="bar empty"></span>'}<span class="stat-sub">${esc(s.sub) || '&nbsp;'}</span></div>`).join('');
    const rows = [
      ['Manufacturer', v.manufacturer], ['Model', v.model], ['Codename', v.device], ['Android version', v.android], ['API level', v.sdk],
      ['Security patch', v.patch], ['Build', v.build], ['Processor', v.abi], ['Serial number', v.serial], ['Wi-Fi IP address', v.ipAddr],
      ['Battery health', { 2: 'Good', 3: 'Overheating', 4: 'Dead', 5: 'Over voltage', 7: 'Cold' }[b.health] || ''], ['Battery voltage', b.voltage ? (+b.voltage / 1000).toFixed(2) + ' V' : ''],
      ['Uptime', v.uptimeSec ? fmtDuration(v.uptimeSec) : ''], ['Connected as', address(dev)],
    ].filter((r) => r[1]);
    $('#ovDetails', el).innerHTML = rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('');
    this.text = rows.map(([k, val]) => `${k}: ${val}`).join('\n');
  },
};

async function reboot(o, mode, question) {
  if (!(await confirmDialog(question, { ok: mode === 'poweroff' ? 'Power off' : 'Restart', danger: mode === 'poweroff' }))) return;
  o.reboot(mode);
  toast(mode === 'poweroff' ? 'Powering off…' : 'Restarting…');
  setTimeout(() => emit('navigate', 'devices'), 600);
}
