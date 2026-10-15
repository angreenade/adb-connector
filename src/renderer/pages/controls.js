import { api, $, $$, esc, icon, toast, ops, needDevice, store, setSettings, isWatch, confirmDialog, openDialog, closeDialog, q, normalizeShell , sameDevice, deviceError } from '../core.js';
import { reboot } from './overview.js';

const k = (n) => `input keyevent ${n}`;
const setting = (ns, key) => (v) => `settings put ${ns} ${key} ${v}`;
// each command: label, cmd, optional confirm text, phone/watch limits, danger
export const CATEGORIES = [
  { name: 'Navigation', icon: 'home', items: [
    ['Home', k(3)], ['Back', k(4)], ['Recent apps', k(187)], ['Menu', k(82)],
    ['Open notifications', 'cmd statusbar expand-notifications'], ['Open quick settings', 'cmd statusbar expand-settings'], ['Close panels', 'cmd statusbar collapse'],
    ['Assistant', k(219)], ['App switch', k(187)],
  ] },
  { name: 'Power & screen', icon: 'power', items: [
    ['Power button', k(26)], ['Wake screen', k(224)], ['Sleep screen', k(223)], ['Unlock (no PIN)', 'input keyevent 224; wm dismiss-keyguard'],
    ['Keep screen on', 'svc power stayon true'], ['Normal screen timeout', 'svc power stayon false'],
    ['Stay awake while charging', 'settings put global stay_on_while_plugged_in 7'], ['Stop staying awake', 'settings put global stay_on_while_plugged_in 0'],
  ] },
  { name: 'Volume & media', icon: 'play', items: [
    ['Volume up', k(24)], ['Volume down', k(25)], ['Mute', k(164)], ['Play / pause', k(85)], ['Next track', k(87)], ['Previous track', k(88)], ['Stop media', k(86)],
  ] },
  { name: 'Rotation', icon: 'refresh', phoneOnly: true, items: [
    ['Auto-rotate', 'settings put system accelerometer_rotation 1'], ['Portrait', 'settings put system accelerometer_rotation 0; settings put system user_rotation 0'],
    ['Landscape', 'settings put system accelerometer_rotation 0; settings put system user_rotation 1'], ['Upside down', 'settings put system accelerometer_rotation 0; settings put system user_rotation 2'],
    ['Landscape (reversed)', 'settings put system accelerometer_rotation 0; settings put system user_rotation 3'],
  ] },
  { name: 'Connections', icon: 'wifi', items: [
    ['Wi-Fi on', 'svc wifi enable'], ['Wi-Fi off', 'svc wifi disable', 'wifiOff'],
    ['Bluetooth on', 'svc bluetooth enable 2>/dev/null || cmd bluetooth_manager enable'], ['Bluetooth off', 'svc bluetooth disable 2>/dev/null || cmd bluetooth_manager disable'],
    ['Airplane mode on', 'cmd connectivity airplane-mode enable', 'wifiOff'], ['Airplane mode off', 'cmd connectivity airplane-mode disable'],
    ['Mobile data on', 'svc data enable'], ['Mobile data off', 'svc data disable'],
    ['Location on', 'settings put secure location_mode 3; cmd location set-location-enabled true 2>/dev/null'], ['Location off', 'cmd location set-location-enabled false 2>/dev/null; settings put secure location_mode 0'],
  ] },
  { name: 'Battery', icon: 'battery', items: [
    ['Battery saver on', 'settings put global low_power 1; cmd power set-mode 1 2>/dev/null'], ['Battery saver off', 'settings put global low_power 0; cmd power set-mode 0 2>/dev/null'],
    ['Pretend unplugged', 'dumpsys battery unplug'], ['Fake battery 15%', 'dumpsys battery set level 15'], ['Reset battery info', 'dumpsys battery reset'],
  ] },
  { name: 'Developer', icon: 'terminal', items: [
    ['Show taps on', 'settings put system show_touches 1'], ['Show taps off', 'settings put system show_touches 0'],
    ['Pointer location on', 'settings put system pointer_location 1'], ['Pointer location off', 'settings put system pointer_location 0'],
    ['Layout bounds on', 'setprop debug.layout true; service call activity 1599295570 >/dev/null'], ['Layout bounds off', 'setprop debug.layout false; service call activity 1599295570 >/dev/null'],
    ['Animations off', 'settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0'],
    ['Animations normal', 'settings put global window_animation_scale 1; settings put global transition_animation_scale 1; settings put global animator_duration_scale 1'],
    ['Stop background apps', 'am kill-all'], ['Demo mode clock 12:00', 'settings put global sysui_demo_allowed 1; am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200 >/dev/null'], ['Exit demo mode', 'am broadcast -a com.android.systemui.demo -e command exit >/dev/null'],
  ] },
  { name: 'Open on device', icon: 'open', items: [
    ['Settings', 'am start -a android.settings.SETTINGS'], ['Developer options', 'am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS'],
    ['Wi-Fi settings', 'am start -a android.settings.WIFI_SETTINGS'], ['Bluetooth settings', 'am start -a android.settings.BLUETOOTH_SETTINGS'],
    ['App list', 'am start -a android.settings.APPLICATION_SETTINGS'], ['Battery', 'am start -a android.intent.action.POWER_USAGE_SUMMARY'],
    ['Display', 'am start -a android.settings.DISPLAY_SETTINGS'], ['Sound', 'am start -a android.settings.SOUND_SETTINGS'],
    ['Date & time', 'am start -a android.settings.DATE_SETTINGS'], ['About device', 'am start -a android.settings.DEVICE_INFO_SETTINGS'],
    ['Camera', 'am start -a android.media.action.STILL_IMAGE_CAMERA'],
  ] },
  { name: 'Restart', icon: 'power', items: [
    ['Restart', '@reboot', 'Restart the device?'], ['Restart to recovery', '@recovery', 'Restart into recovery mode?'],
    ['Restart to bootloader', '@bootloader', 'Restart into the bootloader?'], ['Power off', '@poweroff', 'Turn the device off?'],
  ] },
];

export const page = {
  id: 'controls', title: 'Controls', icon: 'bolt',
  devId: null, filter: '',
  mount(el) { this.el = el; },
  show(dev) {
    if (dev && sameDevice(this.devId, dev)) this.devId = dev.id;
    if (!dev) { this.devId = null; return needDevice(this.el, 'controls'); }
    if (!sameDevice(this.devId, dev) || !this.el.querySelector('.controls-page')) { this.devId = dev.id; this.render(dev); }
  },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  render(dev) {
    const el = this.el, watch = isWatch(dev);
    const cats = CATEGORIES.filter((c) => !(c.phoneOnly && watch));
    el.innerHTML = `
      <div class="controls-page">
        <header class="page-head"><div><h1>Controls</h1><p class="sub">One-click ADB commands, grouped by what they do.</p></div>
          <div class="search">${icon('search')}<input id="cmdSearch" placeholder="Find a command" spellcheck="false" /></div></header>
        <div class="quick-forms">
          <form class="inline-form" id="ctlType">${icon('keyboard')}<input id="ctlText" placeholder="Type text on the device" spellcheck="false" /><button class="btn tonal sm">Send</button></form>
          <form class="inline-form" id="ctlUrl">${icon('open')}<input id="ctlLink" placeholder="Open a link on the device, e.g. https://…" spellcheck="false" /><button class="btn tonal sm">Open</button></form>
        </div>
        <section class="cmd-group mine">
          <div class="cmd-head"><h2>${icon('star')}My commands</h2><button class="btn text sm" id="addCmd">${icon('add')}Add</button></div>
          <div class="cmd-grid" id="myCmds"></div>
        </section>
        ${cats.map((c, ci) => `
          <section class="cmd-group" data-cat="${ci}">
            <div class="cmd-head"><h2>${icon(c.icon)}${esc(c.name)}</h2></div>
            <div class="cmd-grid">${c.items.map(([label, , confirm], ii) => `<button class="cmd ${/off|Power off|bootloader|recovery/i.test(label) && confirm ? 'warnish' : ''}" data-c="${ci}:${ii}" title="${esc(c.items[ii][1].startsWith('@') ? 'adb reboot' : c.items[ii][1])}">${esc(label)}</button>`).join('')}</div>
          </section>`).join('')}
      </div>`;
    this.cats = cats;
    el.onclick = (e) => {
      const b = e.target.closest('[data-c]'); if (b) { const [ci, ii] = b.dataset.c.split(':').map(Number); this.run(this.cats[ci].items[ii], b); return; }
      const m = e.target.closest('[data-my]'); if (m) { const c = (store.settings.savedCommands || [])[+m.dataset.my]; if (!c) return; if (e.target.closest('[data-del]')) return this.delMine(+m.dataset.my); this.runMine(c, m); }
    };
    $('#cmdSearch', el).oninput = (e) => {
      const f = e.target.value.toLowerCase();
      $$('.cmd-group[data-cat]', el).forEach((g) => { let any = false; $$('.cmd', g).forEach((c) => { const hit = !f || c.textContent.toLowerCase().includes(f) || (c.title || '').toLowerCase().includes(f); c.classList.toggle('hidden', !hit); any = any || hit; }); g.classList.toggle('hidden', !any); });
    };
    $('#ctlType', el).onsubmit = async (e) => { e.preventDefault(); const t = $('#ctlText', el).value; if (!t) return; const r = await ops(this.dev()).run(`input text ${q(t.replace(/ /g, '%s'))}`); if (r.ok) { $('#ctlText', el).value = ''; toast('Text sent'); } else toast(r.msg || 'Tap a text field on the device first', { error: true }); };
    $('#ctlUrl', el).onsubmit = async (e) => { e.preventDefault(); let u = $('#ctlLink', el).value.trim(); if (!u) return; if (!/^[a-z][\w+.-]*:/i.test(u)) u = 'https://' + u; const r = await ops(this.dev()).run(`am start -a android.intent.action.VIEW -d ${q(u)}`); toast(r.ok && !/Error/.test(r.out) ? 'Opened on the device' : (r.out || r.msg || 'Could not open').trim().split('\n').pop(), { error: !(r.ok && !/Error/.test(r.out)) }); };
    $('#addCmd', el).onclick = () => this.addMine();
    this.renderMine();
  },
  async run([label, cmd, confirm], btn) {
    const dev = this.dev(); if (!dev) return toast('The device is not connected', { error: true });
    const o = ops(dev);
    if (cmd.startsWith('@')) return reboot(o, cmd.slice(1), confirm);
    if (confirm === 'wifiOff') {
      if (dev.type === 'wifi' && !(await confirmDialog(`${label}?`, { detail: 'The device is connected over Wi-Fi, so this will disconnect it from this app. Turn Wi-Fi back on from the device itself.', ok: label, danger: true }))) return;
    } else if (confirm && !(await confirmDialog(confirm, { ok: 'Continue' }))) return;
    btn && btn.classList.add('flash'); setTimeout(() => btn && btn.classList.remove('flash'), 400);
    const r = await o.run(cmd, 15000);
    const out = (r.out || '').trim();
    const failed = !r.ok || /Exception|Error:|not found|Unknown command|Permission denial|SecurityException/i.test(out);
    toast(failed ? `${label}: ${deviceError(out || r.msg).slice(0, 160)}` : label, { error: failed, ms: failed ? 5000 : 1400 });
  },
  renderMine() {
    const box = $('#myCmds', this.el); if (!box) return;
    const list = store.settings.savedCommands || [];
    box.innerHTML = list.length ? list.map((c, i) => `<button class="cmd mine" data-my="${i}" title="${esc(c.cmd)}">${esc(c.name)}<span class="del" data-del title="Remove">${icon('close')}</span></button>`).join('') : '<p class="muted small">Save commands you use often — like <code>pm grant app.relink android.permission.BLUETOOTH_CONNECT</code> — and run them with one click.</p>';
  },
  addMine() {
    openDialog(`<h2>Add a command</h2><form id="mf">
      <label class="field"><span>Name</span><input id="mName" placeholder="Grant Bluetooth to Relink" /></label>
      <label class="field"><span>Shell command (you can paste “adb shell …” too — several commands work, one per line)</span><textarea id="mCmd" rows="4" class="mono" placeholder="pm grant app.relink android.permission.BLUETOOTH_CONNECT" spellcheck="false"></textarea></label>
      <div class="actions"><button type="button" class="btn text" data-x>Cancel</button><button class="btn filled">Save</button></div></form>`, (d) => {
      d.querySelector('[data-x]').onclick = closeDialog;
      d.querySelector('#mf').onsubmit = (e) => {
        e.preventDefault();
        const name = d.querySelector('#mName').value.trim(), raw = d.querySelector('#mCmd').value.trim();
        if (!raw) return;
        const cmd = raw.split(/\r?\n/).flatMap(normalizeShell).filter(Boolean).join(' && ');
        setSettings({ savedCommands: [...(store.settings.savedCommands || []), { name: name || cmd.slice(0, 40), cmd }] }).then(() => this.renderMine());
        closeDialog(); toast('Command saved');
      };
    });
  },
  async delMine(i) { const list = [...(store.settings.savedCommands || [])]; const c = list[i]; if (!c || !(await confirmDialog(`Remove “${c.name}”?`, { ok: 'Remove' }))) return; list.splice(i, 1); await setSettings({ savedCommands: list }); this.renderMine(); },
  async runMine(c, btn) {
    const dev = this.dev(); if (!dev) return toast('The device is not connected', { error: true });
    btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 400);
    const r = await ops(dev).run(c.cmd, 60000);
    const out = (r.out || '').trim();
    const failed = !r.ok || /Exception|Error:|not found|Unknown|denial/i.test(out);
    if (out.length > 160 || (out && !failed && out.includes('\n'))) openDialog(`<h2>${esc(c.name)}</h2><pre class="out">${esc(out)}</pre><div class="actions"><button class="btn text" data-cp>Copy</button><button class="btn filled" data-x>Close</button></div>`, (d) => { d.querySelector('[data-x]').onclick = closeDialog; d.querySelector('[data-cp]').onclick = () => { api.copy(out); toast('Copied'); }; }, { wide: true });
    else toast(failed ? `${c.name}: ${deviceError(out || r.msg)}` : out ? `${c.name}: ${out}` : `${c.name}: done`, { error: failed });
  },
};
