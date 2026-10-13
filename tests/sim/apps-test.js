const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const SIM = __dirname; const ROOT = path.resolve(__dirname, '..', '..'); const res = []; const ok = (n, c, x = '') => { res.push(c); console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); };
(async () => {
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify({ paired: true, connected: ['127.0.0.1:41567'], mdnsTwin: false }));
  for (const f of ['removed.flag', 'device.log', 'packages.txt']) try { fs.unlinkSync(path.join(SIM, f)); } catch {}
  try { fs.rmSync(path.join(SIM, 'root/tmp/scrcpy-server.jar')); } catch {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'adbc3-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: process.env.DARK ? 'dark' : 'light' }));
  const app = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], executablePath: require(path.join(ROOT, 'node_modules', 'electron')), env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM } });
  const p = await app.firstWindow(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewportSize({ width: 1180, height: 820 }).catch(() => {});
  await p.waitForSelector('.switcher.live', { timeout: 15000 }); await p.waitForTimeout(1200);
  await p.click('.rail-btn[data-page="apps"]'); await p.waitForSelector('.app-row');
  await p.evaluate(() => { window.__t = []; new MutationObserver(() => { const t = document.querySelector('#toast .msg'); if (t) window.__t.push(t.textContent); }).observe(document.getElementById('toast'), { childList: true, subtree: true }); });
  const labels = async () => p.$$eval('#appList .app-label', (l) => l.map((x) => x.textContent));
  let L = [];
  for (let i = 0; i < 30; i++) { L = await labels(); if (L.includes('טיימר משה')) break; await p.waitForTimeout(300); }
  ok('shows device names, not package names', L.includes('Relink') && L.includes('Watch Face Studio Sample Very Long Name') && L.includes('טיימר משה') && !L.some((x) => /\./.test(x)), JSON.stringify(L));
  ok('package names hidden by default', (await p.$$('#appList .app-pkg')).length === 0);
  ok('sorted by name', JSON.stringify(L) === JSON.stringify([...L].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))), JSON.stringify(L));
  let img = null;
  for (let i = 0; i < 40; i++) { img = await p.$('.app-row[data-p="app.relink"] .app-ic.img img'); if (img) break; await p.waitForTimeout(300); }
  ok('real app icon loaded from the APK', !!img && (await img.evaluate((x) => x.complete && x.naturalWidth > 20)));
  const img2 = await p.waitForSelector('.app-row[data-p="com.example.watchface"] .app-ic.img img', { timeout: 10000 }).catch(() => null);
  ok('second app icon loaded', !!img2);
  ok('apps without APK get a letter icon', !!(await p.$('.app-row[data-p="com.moshe.timer"] .app-ic.letter')));
  await p.screenshot({ path: path.join(SIM, 'shots', `40-apps-names${process.env.DARK ? '-dark' : ''}.png`) });
  await p.check('#showPkg'); await p.waitForTimeout(200);
  const pk = await p.$$eval('#appList .app-pkg', (l) => l.map((x) => x.textContent));
  ok('toggle shows real package names', pk.includes('app.relink') && pk.includes('com.moshe.timer'), JSON.stringify(pk));
  const sset = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  ok('toggle is remembered', sset.apps && sset.apps.showPkg === true, JSON.stringify(sset.apps));
  await p.screenshot({ path: path.join(SIM, 'shots', `41-apps-pkg${process.env.DARK ? '-dark' : ''}.png`) });
  await p.fill('#appSearch', 'relink'); await p.waitForTimeout(150);
  ok('search by name', JSON.stringify(await labels()) === '["Relink"]', JSON.stringify(await labels()));
  await p.fill('#appSearch', 'moshe'); await p.waitForTimeout(150);
  ok('search by package', JSON.stringify(await labels()) === '["טיימר משה"]', JSON.stringify(await labels()));
  await p.fill('#appSearch', ''); await p.dispatchEvent('#appSearch', 'input');
  // second load uses the cache (no new list_apps run)
  const runs1 = (fs.readFileSync(path.join(SIM, 'device.log'), 'utf8').match(/list_apps/g) || []).length;
  await p.click('#appFilter [data-f="system"]'); await p.waitForTimeout(600); await p.click('#appFilter [data-f="user"]'); await p.waitForTimeout(800);
  const runs2 = (fs.readFileSync(path.join(SIM, 'device.log'), 'utf8').match(/list_apps/g) || []).length;
  ok('names are cached', runs1 === 1 && runs2 === 1, `${runs1} ${runs2}`);
  // details dialog title uses the name
  await p.click('.app-row[data-p="app.relink"] [data-a="info"]'); await p.waitForSelector('#dialog .app-head');
  ok('details show name, icon and package', /Relink/.test(await p.textContent('#dialog .app-head')) && /app\.relink/.test(await p.textContent('#dialog .app-head')) && !!(await p.$('#dialog .app-head img')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // install → history + library
  await p.evaluate((f) => { window.__testInstall(f); }, path.join(SIM, 'termux-new.apk'));
  for (let i = 0; i < 40 && !(await p.evaluate(() => window.__t.some((x) => /Installed/.test(x)))); i++) await p.waitForTimeout(300);
  await p.click('#appTabs [data-t="history"]'); await p.waitForSelector('.hist-row', { timeout: 8000 }).catch(() => {});
  const h = await p.textContent('#histList');
  ok('history lists the install with the app name and version', /Termux/.test(h) && /0\.118\.3/.test(h) && /Installed/.test(h), h.slice(0, 200));
  await p.screenshot({ path: path.join(SIM, 'shots', `42-history${process.env.DARK ? '-dark' : ''}.png`) });
  await p.click('#appTabs [data-t="library"]'); await p.waitForSelector('.lib-card', { timeout: 8000 }).catch(() => {});
  ok('installed app kept in the library with icon', /Termux/.test(await p.textContent('#libList')) && !!(await p.$('.lib-card .app-ic img')));
  // add without installing
  const r = await p.evaluate((f) => window.api.libraryAdd([f]), path.join(SIM, 'newpipe.apk'));
  await p.waitForTimeout(800);
  ok('add APK to library without installing', r.ok && /NewPipe/.test(await p.textContent('#libList')), JSON.stringify(r));
  const r2 = await p.evaluate((f) => window.api.libraryAdd([f]), path.join(SIM, 'newpipe.apk'));
  await p.waitForTimeout(500);
  ok('same file is not stored twice', (await p.$$('.lib-card')).length === 2, String((await p.$$('.lib-card')).length));
  const bad = await p.evaluate((f) => window.api.libraryAdd([f]), path.join(SIM, 'upload-me.txt'));
  ok('non-app file is refused', !bad.ok);
  await p.screenshot({ path: path.join(SIM, 'shots', `43-library${process.env.DARK ? '-dark' : ''}.png`) });
  // install from library
  await p.evaluate(() => { window.__t = []; });
  await p.click('.lib-card:has-text("NewPipe") [data-li]');
  for (let i = 0; i < 40 && !(await p.evaluate(() => window.__t.some((x) => /Installed|failed/i.test(x)))); i++) await p.waitForTimeout(300);
  ok('one-click install from library', (await p.evaluate(() => window.__t)).some((x) => /Installed/.test(x)), JSON.stringify(await p.evaluate(() => window.__t)));
  await p.click('#appTabs [data-t="history"]'); await p.waitForTimeout(500);
  ok('history has both installs and "Install again"', (await p.$$('.hist-row')).length >= 2 && (await p.$$('.hist-row [data-hi]')).length >= 2);
  ok('library files on disk', fs.readdirSync(path.join(userData, 'library')).length >= 3);
  ok('no UI errors', errs.length === 0, JSON.stringify(errs));
  await app.close();
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
