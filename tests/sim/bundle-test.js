const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const SIM = __dirname; const ROOT = path.resolve(__dirname, '..', '..');
(async () => {
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify({ paired: true, connected: ['127.0.0.1:41567'], mdnsTwin: false }));
  try { fs.unlinkSync(path.join(SIM, 'calls.log')); } catch {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'adbc2-'));
  const app = await electron.launch({ args: [ROOT, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`], executablePath: require(path.join(ROOT, 'node_modules', 'electron')), env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM } });
  const p = await app.firstWindow();
  await p.waitForSelector('.switcher.live', { timeout: 15000 }); await p.waitForTimeout(1500);
  await p.click('.rail-btn[data-page="apps"]'); await p.waitForSelector('.app-row');
  await p.evaluate(() => { window.__t = []; new MutationObserver(() => { const t = document.querySelector('#toast .msg'); if (t) window.__t.push(t.textContent); }).observe(document.getElementById('toast'), { childList: true, subtree: true }); });
  await p.evaluate((f) => window.__testInstall(f), path.join(SIM, 'watchapp.xapk'));
  for (let i = 0; i < 60 && !(await p.evaluate(() => window.__t.some((x) => /Installed|fail|No APK|Could not/i.test(x)))); i++) await p.waitForTimeout(300);
  console.log('xapk toasts:', await p.evaluate(() => window.__t));
  const calls = fs.readFileSync(path.join(SIM, 'calls.log'), 'utf8');
  console.log('install-multiple used:', /install-multiple/.test(calls), '| obb pushed:', fs.existsSync(path.join(SIM, 'root/sdcard/Android/obb/com.sim.xapk/main.1.obb')));
  await p.evaluate(() => { window.__t = []; });
  await p.evaluate((f) => window.__testInstall(f), path.join(SIM, 'empty.apks'));
  for (let i = 0; i < 30 && !(await p.evaluate(() => window.__t.length)); i++) await p.waitForTimeout(300);
  console.log('empty bundle toasts:', await p.evaluate(() => window.__t));
  await app.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
