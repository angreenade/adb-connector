const { _electron: electron } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const SIM = __dirname; const ROOT = path.resolve(__dirname, '..', '..');
const res = []; const ok = (n, c, x = '') => { res.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const devlog = () => (fs.existsSync(path.join(SIM, 'device.log')) ? fs.readFileSync(path.join(SIM, 'device.log'), 'utf8') : '');
(async () => {
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify({ paired: true, connected: ['127.0.0.1:41567'], mdnsTwin: true }));
  for (const f of ['device.log', 'settings.json', 'root/tmp/scrcpy-server.jar']) try { fs.unlinkSync(path.join(SIM, f)); } catch {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'adbc2-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ saveDir: path.join(userData, 'out') }));
  const app = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`], executablePath: require(path.join(ROOT, 'node_modules', 'electron')), env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM } });
  const p = await app.firstWindow();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.setViewportSize({ width: 1100, height: 620 });
  await p.waitForSelector('.switcher.live', { timeout: 15000 }); await p.waitForTimeout(1500);
  console.log('h264 decode supported:', await p.evaluate(async () => (await VideoDecoder.isConfigSupported({ codec: 'avc1.42C01E' })).supported));

  // scrolling works on every page
  for (const pg of ['overview', 'apps', 'controls', 'screen', 'settings']) {
    await p.click(`.rail-btn[data-page="${pg}"]`); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const v = document.querySelector('#view'); const before = v.scrollTop; v.scrollTop = 400; return { can: v.scrollHeight > v.clientHeight, moved: v.scrollTop > before, sh: v.scrollHeight, ch: v.clientHeight }; });
    if (r.can) ok(`page scrolls: ${pg}`, r.moved, JSON.stringify(r));
    await p.evaluate(() => { document.querySelector('#view').scrollTop = 0; });
  }
  await p.mouse.move(600, 400); await p.mouse.wheel(0, 500); await p.waitForTimeout(400);
  ok('mouse wheel scrolls the page', (await p.evaluate(() => document.querySelector('#view').scrollTop)) > 0);
  await p.evaluate(() => { document.querySelector('#view').scrollTop = 0; });
  await p.setViewportSize({ width: 1180, height: 860 });

  await p.click('.rail-btn[data-page="screen"]'); await p.waitForSelector('#liveBtn');
  // light live view (screenshots)
  await p.click('#liveBtn'); await p.waitForFunction(() => document.querySelector('#liveImg').naturalWidth > 0, null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(2500);
  ok('Start = screenshot live view', /Screenshots/.test(await p.textContent('#liveStatus')) && !/scrcpy-server start/.test(devlog()), await p.textContent('#liveStatus'));
  await p.click('#liveBtn'); await p.waitForTimeout(300);

  // mirror
  await p.click('#mirrorLiveBtn');
  await p.waitForFunction(() => /Live · \d+ fps/.test(document.querySelector('#liveStatus').textContent), null, { timeout: 20000 }).catch(() => {});
  const st = await p.textContent('#liveStatus');
  ok('Mirror streams video into the live view', /Live · \d+ fps/.test(st) && !(await p.$('#liveCanvas.hidden')), st);
  const fps = +((st.match(/(\d+) fps/) || [])[1] || 0);
  ok('mirror is smooth (>15 fps)', fps > 15, fps + ' fps');
  ok('button says Stop mirroring', /Stop mirroring/.test(await p.textContent('#mirrorLiveBtn')));
  await p.screenshot({ path: path.join(SIM, 'shots', '20-mirror.png') });
  const c = await p.$eval('#liveCanvas', (cv) => { const r = cv.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: cv.width }; });
  ok('canvas has the device resolution', c.w === 448, String(c.w));
  await p.mouse.click(c.x, c.y); await p.waitForTimeout(500);
  const L = devlog();
  ok('tap → touch down/up at the right spot', /type=2 action=0 x=22[34] y=22[34] w=448/.test(L) && /type=2 action=1/.test(L), (L.match(/scrcpy-control type=2.*/g) || []).slice(0, 2).join(' | '));
  await p.mouse.move(c.x, c.y + 50); await p.mouse.down(); await p.mouse.move(c.x, c.y - 50, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
  ok('drag → touch moves', (devlog().match(/type=2 action=2/g) || []).length >= 3);
  await p.mouse.move(c.x, c.y); await p.mouse.wheel(0, 100); await p.waitForTimeout(400);
  ok('wheel → scroll event', /type=3 v=-/.test(devlog()));
  await p.keyboard.type('hi'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok('typing → text + Enter key', /text=h/.test(devlog()) && /type=0 action=0 key=66/.test(devlog()));
  await p.click('.nav-keys [data-key="back"]'); await p.waitForTimeout(300);
  ok('Back button → back message', /type=4/.test(devlog()));
  // fullscreen
  await p.click('#fsBtn'); await p.waitForTimeout(800);
  const fsOn = await p.evaluate(() => !!document.fullscreenElement);
  ok('full screen on', fsOn);
  if (fsOn) {
    const big = await p.$eval('#liveCanvas', (cv) => cv.getBoundingClientRect().height);
    ok('picture scaled up in full screen', big > 500, String(big));
    await p.mouse.move(300, 300); await p.mouse.move(310, 310); await p.waitForTimeout(200);
    ok('control bar appears in full screen', await p.isVisible('#fsBar'));
    await p.screenshot({ path: path.join(SIM, 'shots', '21-mirror-fullscreen.png') });
    await p.click('#fsBar [data-stop]'); await p.waitForTimeout(1500);
  } else { await p.click('#mirrorLiveBtn'); await p.waitForTimeout(1500); }
  ok('Stop mirroring ends the stream', /scrcpy-server stop/.test(devlog()) && /Mirror/.test(await p.textContent('#mirrorLiveBtn')) && !/Stop/.test(await p.textContent('#mirrorLiveBtn')));
  ok('full screen closed on stop', !(await p.evaluate(() => !!document.fullscreenElement)));
  // start again, then leave the page → mirror stops (no battery drain in the background)
  await p.click('#mirrorLiveBtn'); await p.waitForFunction(() => /Live ·/.test(document.querySelector('#liveStatus').textContent), null, { timeout: 15000 }).catch(() => {});
  const n0 = (devlog().match(/scrcpy-server stop/g) || []).length;
  await p.click('.rail-btn[data-page="overview"]'); await p.waitForTimeout(1500);
  ok('leaving the page stops mirroring', (devlog().match(/scrcpy-server stop/g) || []).length > n0);
  // square picture, options "Mirror" button, separate-window button
  await p.click('.rail-btn[data-page="screen"]'); await p.waitForSelector('#mirrorBtn');
  await p.click('#mirrorBtn'); await p.waitForFunction(() => /Live ·/.test(document.querySelector('#liveStatus').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('options "Mirror" button mirrors in the live view', /Live ·/.test(await p.textContent('#liveStatus')));
  ok('picture is square (not cropped round)', (await p.$eval('#liveCanvas', (c) => getComputedStyle(c).borderRadius)) === '0px');
  const before = (devlog().match(/scrcpy-server stop/g) || []).length;
  await p.click('#winBtn'); await p.waitForTimeout(1500);
  ok('"Open in separate window" stops the in-app mirror first', (devlog().match(/scrcpy-server stop/g) || []).length > before && /Mirror/.test(await p.textContent('#mirrorLiveBtn')));
  ok('no UI errors', errs.length === 0, JSON.stringify(errs.slice(0, 4)));
  const lg = fs.readFileSync(path.join(userData, 'log.txt'), 'utf8');
  ok('no crashes in log', !/uncaught|unhandled|ipc /.test(lg), (lg.match(/.*(uncaught|unhandled|ipc ).*/g) || []).slice(0, 2).join(' | '));
  await app.close();
  // failing mirror service → clear error with Try again, no silent switch to screenshots
  const app2 = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'adbc2-'))}`], executablePath: require(path.join(ROOT, 'node_modules', 'electron')), env: { ...process.env, ADB_PATH: path.join(SIM, 'adb'), SIM, FAKE_SCRCPY_FAIL: '1' } });
  const q = await app2.firstWindow();
  await q.waitForSelector('.switcher.live', { timeout: 15000 }); await q.waitForTimeout(1500);
  await q.click('.rail-btn[data-page="screen"]'); await q.waitForSelector('#mirrorLiveBtn'); await q.click('#mirrorLiveBtn');
  await q.waitForSelector('#liveError:not(.hidden)', { timeout: 30000 }).catch(() => {});
  const em = await q.textContent('#liveErrorMsg').catch(() => '');
  ok('failure shows the reason + Try again', !(await q.$('#liveError.hidden')) && /Could not open video stream|CodecException|closed/.test(em), em);
  ok('did NOT fall back to screenshots', !(await q.textContent('#liveStatus')).includes('Screenshots') && (await q.$('#liveImg[src]')) === null);
  await q.screenshot({ path: path.join(SIM, 'shots', '22-mirror-error.png') });
  await app2.close();
  console.log(`${res.filter(Boolean).length}/${res.length} passed`);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
