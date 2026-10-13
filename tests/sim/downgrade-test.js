const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const SIM = __dirname; const ROOT = path.resolve(__dirname, '..', '..'); const res = []; const ok = (n, c, x = '') => { res.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
(async () => {
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify({ paired: true, connected: ['127.0.0.1:41567'], mdnsTwin: false }));
  for (const f of ['removed.flag', 'device.log']) try { fs.unlinkSync(path.join(SIM, f)); } catch {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'adbc2-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ install: { downgrade: true, grant: true, test: true } }));
  const app = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], executablePath: require(path.join(ROOT, 'node_modules', 'electron')), env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM } });
  const p = await app.firstWindow(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.waitForSelector('.switcher.live', { timeout: 15000 }); await p.waitForTimeout(1200);
  await p.click('.rail-btn[data-page="apps"]'); await p.waitForSelector('.app-row');
  await p.evaluate(() => { window.__t = []; new MutationObserver(() => { const t = document.querySelector('#toast .msg'); if (t) window.__t.push(t.textContent); }).observe(document.getElementById('toast'), { childList: true, subtree: true }); });
  await p.evaluate((f) => { window.__testInstall(f); }, path.join(SIM, 'relink-old.apk'));
  await p.waitForSelector('#dialog [data-keep]', { timeout: 20000 }).catch(() => {});
  const txt = await p.textContent('#dialog').catch(() => '');
  ok('blocked downgrade asks what to do (with package name)', /com\.genymobile\.scrcpy/.test(txt) && /Keep app data/.test(txt), txt.slice(0, 120));
  await p.screenshot({ path: path.join(SIM, 'shots', '31-downgrade.png') });
  await p.click('#dialog [data-keep]');
  for (let i = 0; i < 40 && !(await p.evaluate(() => window.__t.some((x) => /older version|failed|Could not/i.test(x)))); i++) await p.waitForTimeout(300);
  const toasts = await p.evaluate(() => window.__t);
  ok('keeps data: pm uninstall -k, then installs', /uninstall -k 'com\.genymobile\.scrcpy'|uninstall -k com\.genymobile\.scrcpy/.test(fs.readFileSync(path.join(SIM, 'removed.flag'), 'utf8') + ' ' + (fs.existsSync(path.join(SIM, 'device.log')) ? fs.readFileSync(path.join(SIM, 'device.log'), 'utf8') : '')) && toasts.some((t) => /Installed the older version of com\.genymobile\.scrcpy \(app data kept\)/.test(t)), JSON.stringify(toasts));
  ok('no UI errors', errs.length === 0, JSON.stringify(errs));
  await app.close();
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
