// End-to-end test of ADB Connector 2 against the simulated Galaxy Watch.
const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const SIM = __dirname; const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(SIM, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const devlog = () => (fs.existsSync(path.join(SIM, 'device.log')) ? fs.readFileSync(path.join(SIM, 'device.log'), 'utf8') : '');

async function launch(env = {}, theme = 'light', state = { paired: true, connected: ['127.0.0.1:41567'], mdnsTwin: true }) {
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify(state));
  for (const f of ['device.log', 'calls.log', 'settings.json', 'packages.txt']) try { fs.unlinkSync(path.join(SIM, f)); } catch {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'adbc2-'));
  const saveDir = path.join(userData, 'out'); fs.mkdirSync(saveDir);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ saveDir, theme }));
  const app = await electron.launch({
    args: [ROOT, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM, FAKE_CONNECT_PORT: '41567', ...env },
  });
  const p = await app.firstWindow();
  await p.setViewportSize({ width: 1180, height: 820 });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text()));
  await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('#toast .msg'); if (t && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(document.getElementById('toast'), { childList: true, subtree: true, characterData: true }); });
  return { app, p, errs, userData, saveDir };
}
const toasts = (p) => p.evaluate(() => window.__toasts.slice());
const clearToasts = (p) => p.evaluate(() => { window.__toasts = []; });
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
const nav = (p, id) => p.click(`.rail-btn[data-page="${id}"]`);
const waitToast = async (p, re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await toasts(p); const hit = t.find((x) => re.test(x)); if (hit) return hit; await p.waitForTimeout(200); } return null; };

(async () => {
  // ════════ run 1: everything, with the IP entry flapping offline during install ════════
  let { app, p, errs, userData, saveDir } = await launch({ FLAP_DURING_INSTALL: 'ip' });
  await p.waitForSelector('.switcher.live', { timeout: 15000 });
  await p.waitForTimeout(2500);
  ok('one physical device shown (IP + mDNS twin merged)', (await p.$$eval('#deviceList .dev', (e) => e.length)) === 1 || (await p.$eval('.switcher .sw-name', (e) => e.textContent)).includes('SM-R920'));
  ok('switcher shows device name', /Samsung SM-R920/.test(await p.textContent('.switcher')), await p.textContent('.switcher'));
  await shot(p, '01-overview');
  ok('overview battery', /76%/.test(await p.textContent('#ovStats')));
  ok('overview storage', /free/.test(await p.textContent('#ovStats')));
  ok('overview details', /RFATB1HMFMW/.test(await p.textContent('#ovDetails')));

  await nav(p, 'devices'); await p.waitForTimeout(400); await shot(p, '02-devices');
  ok('devices list has 1 entry', (await p.$$eval('#deviceList .dev', (e) => e.length)) === 1, String(await p.$$eval('#deviceList .dev', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))));

  // apps + install with flapping
  await nav(p, 'apps'); await p.waitForSelector('.app-row', { timeout: 10000 }); await shot(p, '03-apps');
  ok('apps list', (await p.$$eval('.app-row', (e) => e.map((x) => x.dataset.p))).includes('app.relink'));
  const apk = path.join(SIM, 'תוכנה watch app.apk'); fs.writeFileSync(apk, 'apk');
  await clearToasts(p);
  const installRes = p.evaluate(async (f) => { const m = await import('./core.js').catch(() => null); return null; }, apk).catch(() => null);
  // drive install through the page object via a synthetic drop of a path: use the exposed api through the drop handler
  await p.evaluate((f) => window.__testInstall && window.__testInstall(f), apk);
  const instToast = await waitToast(p, /Installed|failed|disconnected/i, 30000);
  const all = await toasts(p);
  ok('install succeeds while IP entry is offline', /Installed/.test(instToast || ''), instToast);
  ok('no "disconnected" toast during install', !all.some((t) => /disconnect/i.test(t)), JSON.stringify(all));
  ok('switcher never lost the device', /live/.test(await p.getAttribute('#switcher', 'class')));

  // permissions dialog
  await p.click('.app-row[data-p="app.relink"] [data-a="info"]');
  await p.waitForSelector('[data-perm]', { timeout: 10000 }); await shot(p, '04-permissions');
  await clearToasts(p);
  await p.click('[data-perm="android.permission.BLUETOOTH_CONNECT"]'); await p.waitForTimeout(1200);
  ok('permission toggle grants', /BLUETOOTH_CONNECT granted/.test((await toasts(p)).join('|')) && /pm grant 'app.relink' 'android.permission.BLUETOOTH_CONNECT'|pm grant app.relink android.permission.BLUETOOTH_CONNECT/.test(devlog()), (await toasts(p)).join('|'));
  await p.fill('#grantInput', 'CAMERA'); await p.click('#grantForm button'); await p.waitForTimeout(1200);
  ok('grant error is shown clearly', /has not requested/.test(await p.textContent('#permMsg')), await p.textContent('#permMsg'));
  await p.click('#dialog [data-x]');

  // files
  await nav(p, 'files'); await p.waitForSelector('.file-row', { timeout: 10000 }); await shot(p, '05-files');
  ok('files list /sdcard', (await p.$$eval('.file-row', (e) => e.map((x) => x.dataset.n))).includes('Download'));
  await p.click('.file-row[data-n="Download"]'); await p.waitForSelector('.file-row[data-n="notes.txt"]', { timeout: 8000 });
  await clearToasts(p); await p.click('.file-row[data-n="notes.txt"] [data-a="dl"]');
  const dl = await waitToast(p, /Saved|failed/, 10000);
  ok('download file', /Saved notes.txt/.test(dl || '') && fs.existsSync(path.join(saveDir, 'Files', 'notes.txt')), dl);
  // upload through api (same path as drop)
  const up = path.join(SIM, 'upload-me.txt'); fs.writeFileSync(up, 'up');
  await p.evaluate((f) => window.__testUpload && window.__testUpload(f), up);
  await p.waitForSelector('.file-row[data-n="upload-me.txt"]', { timeout: 10000 }).catch(() => {});
  ok('upload file', fs.existsSync(path.join(SIM, 'root/sdcard/Download/upload-me.txt')));
  await p.click('#fNew'); await p.fill('#dialog input', 'New Folder'); await p.click('#dialog .btn.filled');
  await p.waitForSelector('.file-row[data-n="New Folder"]', { timeout: 8000 }).catch(() => {});
  ok('new folder', fs.existsSync(path.join(SIM, 'root/sdcard/Download/New Folder')));
  await p.click('.file-row[data-n="New Folder"] [data-a="more"]'); await p.click('.menu button:has-text("Delete")'); await p.click('#dialog [data-ok]');
  await p.waitForTimeout(1500);
  ok('delete folder', !fs.existsSync(path.join(SIM, 'root/sdcard/Download/New Folder')));

  // screen
  await nav(p, 'screen'); await p.waitForSelector('#dRes', { timeout: 10000 });
  await p.click('#liveBtn'); await p.waitForFunction(() => document.querySelector('#liveImg').naturalWidth === 450, null, { timeout: 10000 }).catch(() => {});
  ok('live view shows frames', (await p.$eval('#liveImg', (i) => i.naturalWidth)) === 450);
  const box = await p.$eval('#liveImg', (i) => { const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(box.x, box.y); await p.waitForTimeout(700);
  ok('click on live view taps the device', /input tap 22[45] 22[45]/.test(devlog()), (devlog().match(/input tap.*/) || [''])[0]);
  await p.mouse.move(box.x, box.y + 60); await p.mouse.down(); await p.mouse.move(box.x, box.y - 60, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(600);
  ok('drag swipes', /input swipe/.test(devlog()));
  await shot(p, '06-screen');
  await p.click('#liveBtn');
  await p.selectOption('#dFont', '1.15'); await p.waitForTimeout(800);
  ok('text size setting', /settings put system font_scale 1.15/.test(devlog()));
  await p.selectOption('#dRes', { index: 2 }); await p.waitForSelector('#dialog [data-r]', { timeout: 5000 });
  await shot(p, '07-keep-resolution');
  await p.click('#dialog [data-r]'); await p.waitForTimeout(1200);
  ok('resolution change + undo', /wm size 338x338|wm size 405x405/.test(devlog()) && /wm size reset/.test(devlog()));
  await clearToasts(p); await p.click('#shotBtn'); const st = await waitToast(p, /Screenshot saved|Could not/, 10000);
  ok('screenshot', /Screenshot saved/.test(st || '') && fs.readdirSync(saveDir).some((f) => f.startsWith('screenshot-')), st);
  await clearToasts(p); await p.selectOption('#recLimit', '10'); await p.click('#recBtn'); await p.waitForTimeout(2500); await p.click('#recBtn');
  const rc = await waitToast(p, /Recording saved|Could not|can't/, 20000);
  ok('screen recording', /Recording saved/.test(rc || ''), rc);

  // controls
  await nav(p, 'controls'); await p.waitForSelector('.cmd'); await shot(p, '08-controls');
  await clearToasts(p); await p.click('.cmd:has-text("Home")'); await p.waitForTimeout(700);
  ok('quick command Home', /input keyevent 3/.test(devlog()));
  ok('rotation hidden for a watch', !(await p.$('.cmd:has-text("Portrait")')));
  await p.click('.cmd:has-text("Wi-Fi off")'); await p.waitForSelector('#dialog [data-ok]', { timeout: 3000 });
  ok('Wi-Fi off warns on a Wi-Fi device', /disconnect/i.test(await p.textContent('#dialog')));
  await p.click('#dialog [data-x]');
  ok('Wi-Fi off was not run after cancel', !/svc wifi disable/.test(devlog()));
  await p.click('#addCmd'); await p.fill('#mName', 'Grant BT'); await p.fill('#mCmd', 'adb shell pm grant app.relink android.permission.BLUETOOTH_SCAN adb shell pm grant app.relink android.permission.BLUETOOTH_CONNECT');
  await p.click('#mf .btn.filled');
  if (!(await p.waitForSelector('.cmd.mine', { timeout: 6000 }).catch(() => null))) {
    await shot(p, 'FLAKE-mine');
    console.log('FLAKE DEBUG', await p.evaluate(() => JSON.stringify({ dialogOpen: !document.querySelector('#scrim').classList.contains('hidden'), dialog: document.querySelector('#dialog').innerText.slice(0, 200), mine: document.querySelector('#myCmds') && document.querySelector('#myCmds').innerHTML.slice(0, 200), page: [...document.querySelectorAll('.page')].filter((x) => !x.classList.contains('hidden')).map((x) => x.id) })));
  }
  await p.click('.cmd.mine'); await p.waitForTimeout(1200);
  ok('saved command strips "adb shell" and runs both', (devlog().match(/pm grant app\.relink android\.permission\.BLUETOOTH_(SCAN|CONNECT)/g) || []).length >= 2, (await p.getAttribute('.cmd.mine', 'title')));
  await p.fill('#ctlText', 'hello world'); await p.click('#ctlType button'); await p.waitForTimeout(700);
  ok('type text', /input text hello%sworld/.test(devlog()));

  // shell
  await nav(p, 'shell'); await p.waitForSelector('.xterm', { timeout: 10000 }); await p.waitForTimeout(2000);
  await p.click('.xterm'); await p.keyboard.type('echo hi-from-shell'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  const termText = () => p.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map((d) => d.textContent).join('\n'));
  ok('interactive shell runs commands', /hi-from-shell\s*\n/.test(await termText()) || (await termText()).split('hi-from-shell').length > 2, (await termText()).slice(-200));
  await p.keyboard.type('adb shell getprop ro.product.model'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  ok('pasted "adb shell …" is fixed in the terminal', /SM-R920/.test(await termText()) && !/adb: (not found|inaccessible)/.test(await termText()), (await termText()).replace(/\s+/g, ' ').slice(-200));
  await p.fill('#cmdInput', 'adb devices'); await p.press('#cmdInput', 'Enter'); await p.waitForTimeout(2500);
  ok('adb command from the shell box', /List of devices/.test(await termText()));
  await p.fill('#cmdInput', 'adb shell getprop ro.build.version.release'); await p.press('#cmdInput', 'Enter'); await p.waitForTimeout(1500);
  ok('adb shell from the shell box', /\b16\b/.test(await termText()), (await termText()).replace(/\s+/g, ' ').slice(-120));
  await shot(p, '09-shell');

  // logcat
  await nav(p, 'logcat'); await p.click('#lcRun'); await p.waitForSelector('.lc', { timeout: 10000 }); await p.waitForTimeout(1500);
  ok('logcat streams', (await p.$$eval('.lc', (e) => e.length)) > 3);
  await p.click('#lcLevel [data-l="E"]'); await p.waitForTimeout(400);
  ok('logcat level filter', (await p.$$eval('.lc', (e) => e.every((x) => x.classList.contains('E') || x.classList.contains('F')))));
  await p.click('#lcLevel [data-l="V"]'); await p.fill('#lcPkg', 'app.relink'); await p.dispatchEvent('#lcPkg', 'change'); await p.waitForTimeout(1200);
  ok('logcat app filter', (await p.$$eval('.lc .p', (e) => e.length > 0 && e.every((x) => x.textContent === '4321'))));
  await shot(p, '10-logcat');
  await p.click('#lcRun');

  // settings + dark
  await nav(p, 'settings'); await p.waitForSelector('#theme'); await p.click('#theme [data-t="dark"]'); await p.waitForTimeout(300);
  ok('dark theme', (await p.getAttribute('html', 'data-mode')) === 'dark');
  await shot(p, '11-settings-dark');
  await nav(p, 'overview'); await p.waitForTimeout(1200); await shot(p, '12-overview-dark');
  await nav(p, 'screen'); await p.waitForTimeout(800); await shot(p, '13-screen-dark');
  await nav(p, 'devices'); await p.waitForTimeout(300);
  await p.click('#btnPair'); await p.waitForTimeout(300); await shot(p, '14-pair-dark'); await p.keyboard.press('Escape');

  // disconnect → saved → reconnect
  await p.click('#theme [data-t="light"]').catch(() => {});
  await nav(p, 'devices'); await p.click('[data-act="disc"]'); await p.waitForTimeout(2500);
  ok('disconnect → saved device with Reconnect', !!(await p.$('[data-act="reconnect"]')));
  await p.click('[data-act="reconnect"]'); await p.waitForSelector('.switcher.live', { timeout: 40000 }).catch(() => {});
  ok('reconnect', /live/.test(await p.getAttribute('#switcher', 'class')));
  ok('no UI errors (run 1)', errs.length === 0, JSON.stringify(errs.slice(0, 5)));
  const log1 = fs.readFileSync(path.join(userData, 'log.txt'), 'utf8');
  ok('no crashes in log (run 1)', !/uncaught|unhandled|renderer gone|ipc /.test(log1), (log1.match(/.*(uncaught|unhandled|renderer gone|ipc ).*/g) || []).slice(0, 3).join(' | '));
  await app.close();

  // ════════ run 2: connection fully drops during install → app waits and retries ════════
  ({ app, p, errs, userData } = await launch({ FLAP_DURING_INSTALL: 'all' }));
  await p.waitForSelector('.switcher.live', { timeout: 15000 }); await p.waitForTimeout(2000);
  await nav(p, 'apps'); await p.waitForSelector('.app-row', { timeout: 10000 });
  await clearToasts(p);
  await p.evaluate((f) => window.__testInstall(f), apk);
  const t2 = await waitToast(p, /Installed|failed/i, 45000);
  ok('install retries after a full drop', /Installed/.test(t2 || ''), t2 + ' | ' + JSON.stringify(await toasts(p)));
  ok('no UI errors (run 2)', errs.length === 0, JSON.stringify(errs.slice(0, 5)));
  await app.close();

  // ════════ run 3: first-time pairing of a Galaxy Watch (no mDNS — the port must be found by scanning) ════════
  const srv = net.createServer((c) => c.destroy()); await new Promise((r) => srv.listen(41567, '127.0.0.1', r));
  ({ app, p, errs, userData } = await launch({}, 'light', { paired: false, connected: [], mdnsTwin: false }));
  await p.waitForSelector('#btnPair', { timeout: 15000 }); await p.waitForTimeout(800);
  await shot(p, '15-devices-empty');
  ok('starts on Devices when nothing is connected', !(await p.$('#page-devices.hidden')));
  await p.click('#btnPair'); await p.fill('#pip', '127.0.0.1:37011'); await p.waitForTimeout(100);
  ok('pasting ip:port splits into two fields', (await p.inputValue('#pip')) === '127.0.0.1' && (await p.inputValue('#pport')) === '37011');
  await p.fill('#pcode', '111111'); await p.click('#pgo'); await p.waitForSelector('#pmsg.err-text', { timeout: 15000 });
  ok('wrong code explains what to do', /Pair new device/.test(await p.textContent('#pmsg')), await p.textContent('#pmsg'));
  await p.fill('#pcode', '123456'); await p.click('#pgo');
  await p.waitForTimeout(1500); await shot(p, '16-pairing-progress');
  await p.waitForSelector('#page-overview:not(.hidden) .hero', { timeout: 90000 }).catch(() => {});
  ok('pairs, finds the port and opens the overview', /Samsung SM-R920/.test(await p.textContent('.switcher')), await p.textContent('.switcher'));
  await p.waitForTimeout(1500); await shot(p, '17-after-pair');
  ok('no UI errors (run 3)', errs.length === 0, JSON.stringify(errs.slice(0, 5)));
  await app.close(); srv.close();

  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
