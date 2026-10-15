import { MirrorPlayer, mirrorSupported, AKEY } from '../mirror.js';
import { api, $, $$, esc, icon, toast, report, fileToast, ops, needDevice, store, setSettings, isWatch, openDialog, closeDialog, busyBtn, sleep, q , sameDevice } from '../core.js';

const inputText = (s) => `input text ${q(s.replace(/ /g, '%s'))}`;

export const page = {
  id: 'screen', title: 'Screen', icon: 'screen',
  devId: null, live: false, lastShot: null, recTimer: null,
  mount(el) { this.el = el; },
  show(dev) {
    if (dev && sameDevice(this.devId, dev)) this.devId = dev.id;
    if (!dev) { this.stopLive(); this.devId = null; return needDevice(this.el, 'screen tools'); }
    if (!sameDevice(this.devId, dev) || !this.el.querySelector('.screen-page')) { this.stopLive(); this.devId = dev.id; this.skeleton(dev); this.loadDisplay(); }
  },
  hide() { this.stopLive(); },
  dev() { return store.devices.concat(store.webDev ? [store.webDev] : []).find((d) => d.id === this.devId && d.state === 'device'); },
  o() { const d = this.dev(); return d ? ops(d) : null; },
  skeleton(dev) {
    const el = this.el;
    const sc = store.settings.scrcpy || {}, rc = store.settings.record || {};
    const watch = isWatch(dev);
    const opt = (k, label) => `<label class="check"><input type="checkbox" data-sc="${k}" ${sc[k] ? 'checked' : ''}><span>${label}</span></label>`;
    el.innerHTML = `
      <div class="screen-page">
        <header class="page-head"><div><h1>Screen</h1><p class="sub">See and control the screen, capture it, and change display settings.</p></div></header>
        <div class="screen-grid">
          <section class="panel live-panel">
            <div class="panel-head"><h2>Live view</h2>
              <button class="btn tonal sm" id="liveBtn" title="Refreshes with screenshots — light on battery">${icon('play')}Start</button>
              <button class="btn filled sm" id="mirrorLiveBtn" title="Smooth live video in this box">${icon('cast')}Mirror</button>
              <button class="icon-btn" id="fsBtn" title="Full screen (F11)">${icon('fullscreen')}</button>
              <button class="icon-btn" id="winBtn" title="Open in separate window">${icon('open')}</button>
            </div>
            <div class="live-frame" id="liveFrame" tabindex="0">
              <div class="live-error hidden" id="liveError"><b>Mirroring didn't start</b><span id="liveErrorMsg"></span><div class="row"><button class="btn filled sm" id="liveRetry">${icon('refresh')}Try again</button><button class="btn tonal sm" id="liveShots">Use screenshots</button></div></div>
              <canvas id="liveCanvas" class="hidden"></canvas>
              <img id="liveImg" alt="" draggable="false" />
              <div class="live-empty" id="liveEmpty">${icon('touch', 'ic big')}<span><b>Start</b> shows the screen with light screenshots. <b>Mirror</b> streams smooth live video.<br>Click to tap, drag to swipe, scroll the wheel, right-click for Back, and type on your keyboard.</span></div>
              <div class="fs-bar" id="fsBar">
                <button class="icon-btn" data-key="back" title="Back">${icon('back')}</button>
                <button class="icon-btn" data-key="home" title="Home">${icon('home')}</button>
                <button class="icon-btn" data-key="recents" title="Recent apps">${icon('recents')}</button>
                <button class="icon-btn" data-key="power" title="Power">${icon('power')}</button>
                <span class="sep"></span>
                <button class="btn tonal sm" data-fs-exit>${icon('fullscreenExit')}Exit full screen</button>
                <button class="btn danger sm" data-stop>${icon('stop')}<span data-stop-label>Stop</span></button>
              </div>
            </div>
            <div class="live-status" id="liveStatus">&nbsp;</div>
            <div class="nav-keys">
              <button class="icon-btn" data-key="back" title="Back">${icon('back')}</button>
              <button class="icon-btn" data-key="home" title="Home">${icon('home')}</button>
              <button class="icon-btn" data-key="recents" title="Recent apps">${icon('recents')}</button>
              <span class="sep"></span>
              <button class="icon-btn" data-key="voldown" title="Volume down"><b>−</b></button>
              <button class="icon-btn" data-key="volup" title="Volume up"><b>+</b></button>
              <button class="icon-btn" data-key="power" title="Power">${icon('power')}</button>
            </div>
            <form class="inline-form" id="typeForm">${icon('keyboard')}<input id="typeText" placeholder="Type text on the device" spellcheck="false" /><button class="btn tonal sm">Send</button></form>
          </section>

          <div class="screen-side">
            <section class="panel">
              <div class="panel-head"><h2>Capture</h2></div>
              <div class="row">
                <button class="btn filled" id="shotBtn">${icon('camera')}Screenshot</button>
                <button class="btn tonal" id="recBtn">${icon('video')}<span id="recLabel">Record</span></button>
                <button class="btn text" id="openShots">${icon('folder')}Open folder</button>
              </div>
              <div class="row opts">
                <label class="field inline"><span>Length</span><select id="recLimit">${[[10, '10 s'], [30, '30 s'], [60, '1 min'], [180, '3 min']].map(([v, t]) => `<option value="${v}" ${+rc.limit === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <label class="field inline"><span>Quality</span><select id="recRate">${[[4, 'Standard'], [8, 'High'], [16, 'Very high']].map(([v, t]) => `<option value="${v}" ${+rc.bitrate === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              </div>
              <div class="shot-preview hidden" id="shotPrev"><img id="shotImg" alt="Last screenshot" /><div class="col"><b>Last screenshot</b><button class="btn text sm" id="shotOpen">${icon('open')}Open</button><button class="btn text sm" id="shotCopy">${icon('copy')}Copy image</button><button class="btn text sm" id="shotShow">${icon('folder')}Show in folder</button></div></div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Mirroring options</h2><button class="btn filled sm" id="mirrorBtn">${icon('cast')}Mirror</button></div>
              <p class="muted small">Mirror plays in the square on the left. Use ${icon('open', 'ic sm inline')} there to open a separate window instead. Changes apply the next time mirroring starts.</p>
              <div class="check-grid">
                ${opt('stayAwake', 'Keep device awake')}${opt('screenOff', 'Turn device screen off')}${opt('onTop', 'Window always on top')}${opt('fullscreen', 'Full screen')}
                ${opt('showTouches', 'Show touches')}${opt('borderless', 'Borderless window')}${opt('noControl', 'View only (no control)')}${opt('record', 'Record while mirroring')}${opt('noAudio', 'No sound')}
              </div>
              <div class="row opts">
                <label class="field inline"><span>Max size</span><select data-scs="maxSize">${[[0, 'Original'], [1920, '1920'], [1280, '1280'], [1024, '1024'], [800, '800']].map(([v, t]) => `<option value="${v}" ${+sc.maxSize === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <label class="field inline"><span>Bit rate</span><select data-scs="bitrate">${['4M', '8M', '16M', '24M'].map((v) => `<option ${sc.bitrate === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label class="field inline"><span>Max FPS</span><select data-scs="fps">${[[0, 'Unlimited'], [30, '30'], [60, '60']].map(([v, t]) => `<option value="${v}" ${+sc.fps === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Display</h2><button class="icon-btn" id="dispRefresh" title="Reload">${icon('refresh')}</button></div>
              <div id="disp" class="settings-list"><div class="status-line left"><span class="spinner"></span>Reading display settings…</div></div>
            </section>
          </div>
        </div>
      </div>`;

    // live view (embedded mirror)
    $('#liveBtn', el).onclick = () => (this.live === 'shots' ? this.stopLive() : this.startLive('shots'));
    $('#mirrorLiveBtn', el).onclick = () => (this.live === 'video' ? this.stopLive() : this.startLive('video'));
    $('#fsBtn', el).onclick = () => this.toggleFs();
    $('[data-fs-exit]', el).onclick = () => this.toggleFs(false);
    $('[data-stop]', el).onclick = () => { this.toggleFs(false); this.stopLive(); };
    const frame = $('#liveFrame', el);
    frame.addEventListener('dblclick', (e) => { if (e.target === frame) this.toggleFs(); });
    let hideBar;
    frame.addEventListener('mousemove', () => { frame.classList.add('show-bar'); clearTimeout(hideBar); hideBar = setTimeout(() => frame.classList.remove('show-bar'), 2500); });
    document.addEventListener('fullscreenchange', () => { const on = document.fullscreenElement === frame; frame.classList.toggle('is-fs', on); $('#fsBtn', el).innerHTML = icon(on ? 'fullscreenExit' : 'fullscreen'); if (on) frame.focus(); this.fitFs(); });
    window.addEventListener('resize', () => this.fitFs());
    this.bindInput($('#liveCanvas', el), 'video');
    this.bindInput($('#liveImg', el), 'shots');
    frame.addEventListener('keydown', (e) => this.onKey(e));
    $$('[data-key]', el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.key(b.dataset.key); }));
    $('#typeForm', el).onsubmit = async (e) => {
      e.preventDefault(); const t = $('#typeText', el).value; if (!t) return;
      if (this.player && this.player.active) { this.player.text(t); $('#typeText', el).value = ''; toast('Text sent'); return; }
      const r = await this.o().run(inputText(t));
      if (r.ok) { $('#typeText', el).value = ''; toast('Text sent'); this.kick(); } else toast(r.msg || 'Could not type — tap a text field on the device first', { error: true });
    };

    // capture
    $('#shotBtn', el).onclick = (e) => busyBtn(e.currentTarget, async () => {
      const r = await this.o().screenshot();
      if (!r.ok) return toast(r.msg, { error: true });
      this.lastShot = r.file; fileToast(r);
      if (r.dataUrl) { $('#shotImg', el).src = r.dataUrl; $('#shotPrev', el).classList.remove('hidden'); }
    });
    $('#shotOpen', el).onclick = () => this.lastShot && api.openFile(this.lastShot);
    $('#shotShow', el).onclick = () => this.lastShot && api.showFile(this.lastShot);
    $('#shotCopy', el).onclick = async () => { if (this.lastShot) report(await api.copyImage(this.lastShot)); };
    $('#openShots', el).onclick = () => api.openFolder('screenshot');
    $('#recLimit', el).onchange = $('#recRate', el).onchange = () => setSettings({ record: { limit: +$('#recLimit', el).value, bitrate: +$('#recRate', el).value } });
    $('#recBtn', el).onclick = (e) => busyBtn(e.currentTarget, () => this.toggleRec());

    // mirror
    $$('[data-sc]', el).forEach((c) => (c.onchange = () => setSettings({ scrcpy: { ...store.settings.scrcpy, [c.dataset.sc]: c.checked } })));
    $$('[data-scs]', el).forEach((c) => (c.onchange = () => setSettings({ scrcpy: { ...store.settings.scrcpy, [c.dataset.scs]: c.dataset.scs === 'bitrate' ? c.value : +c.value } })));
    $('#mirrorBtn', el).onclick = () => { $('.live-panel', el).scrollIntoView({ block: 'nearest' }); if (this.live === 'video') { this.stopLive(); } this.startLive('video'); };
    $('#winBtn', el).onclick = (e) => busyBtn(e.currentTarget, async () => {
      if (this.live === 'video') this.stopLive();   // free the watch's video encoder for the window
      report(await this.o().mirror(store.settings.scrcpy));
    });
    $('#liveRetry', el).onclick = () => this.startLive('video');
    $('#liveShots', el).onclick = () => this.startLive('shots');
    $('#dispRefresh', el).onclick = (e) => busyBtn(e.currentTarget, () => this.loadDisplay());
  },
  ripple(e) { const f = $('#liveFrame', this.el); const r = f.getBoundingClientRect(); const sp = document.createElement('span'); sp.className = 'ripple'; sp.style.left = e.clientX - r.left + 'px'; sp.style.top = e.clientY - r.top + 'px'; f.append(sp); setTimeout(() => sp.remove(), 500); },
  key(k) {
    if (this.player && this.player.active) { if (k === 'back') this.player.back(); else this.player.key(AKEY[k]); return; }
    const o = this.o(); if (!o) return; o.run(`input keyevent ${AKEY[k]}`); this.kick();
  },
  kick() { this.kickAt = Date.now(); },
  // in full screen, scale the picture to the largest size that fits (exact pixels keep taps accurate)
  fitFs() {
    const el = this.el; const frame = $('#liveFrame', el); if (!frame) return;
    const on = document.fullscreenElement === frame;
    for (const m of [$('#liveCanvas', el), $('#liveImg', el)]) {
      const w = m.tagName === 'CANVAS' ? m.width : m.naturalWidth, h = m.tagName === 'CANVAS' ? m.height : m.naturalHeight;
      if (!on || !w || !h) { m.style.width = ''; m.style.height = ''; continue; }
      const k = Math.min(innerWidth / w, innerHeight / h);
      m.style.width = Math.floor(w * k) + 'px'; m.style.height = Math.floor(h * k) + 'px';
    }
  },
  toggleFs(force) {
    const frame = $('#liveFrame', this.el);
    const on = document.fullscreenElement === frame;
    if (force === false || on) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
    frame.requestFullscreen().catch(() => toast('Full screen is not available', { error: true }));
  },
  // mouse/touch/wheel on the picture → touches on the device
  bindInput(elm, mode) {
    let down = null;
    const map = (e) => { const r = elm.getBoundingClientRect(); const w = mode === 'video' ? this.player && this.player.width : elm.naturalWidth, h = mode === 'video' ? this.player && this.player.height : elm.naturalHeight; if (!w || !r.width) return null; const x = ((e.clientX - r.left) / r.width) * w, y = ((e.clientY - r.top) / r.height) * h; return [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))]; };
    elm.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; const p = map(e); if (!p) return;
      e.preventDefault(); elm.setPointerCapture(e.pointerId); $('#liveFrame', this.el).focus();
      down = { p, t: Date.now(), cx: e.clientX, cy: e.clientY };
      if (mode === 'video' && this.player && this.player.active) this.player.touch(0, p[0], p[1]);
    });
    // moves are coalesced to one per frame; the latest position is never dropped
    let pending = null, raf = 0;
    const flush = () => { raf = 0; if (pending && this.player && this.player.active) this.player.touch(2, pending[0], pending[1]); pending = null; };
    elm.addEventListener('pointermove', (e) => {
      if (!down || mode !== 'video' || !this.player || !this.player.active) return;
      const p = map(e); if (!p) return;
      pending = p; if (!raf) raf = requestAnimationFrame(flush);
    });
    const up = (e) => {
      if (!down) return; const d0 = down; down = null;
      if (raf) { cancelAnimationFrame(raf); flush(); }
      const p = map(e) || d0.p;
      if (mode === 'video' && this.player && this.player.active) { this.player.touch(1, p[0], p[1]); if (Math.hypot(e.clientX - d0.cx, e.clientY - d0.cy) < 6) this.ripple(e); return; }
      const o = this.o(); if (!o) return;
      const moved = Math.hypot(e.clientX - d0.cx, e.clientY - d0.cy);
      if (moved < 8) { o.run(Date.now() - d0.t > 600 ? `input swipe ${d0.p[0] | 0} ${d0.p[1] | 0} ${d0.p[0] | 0} ${d0.p[1] | 0} 800` : `input tap ${d0.p[0] | 0} ${d0.p[1] | 0}`); this.ripple(e); }
      else o.run(`input swipe ${d0.p[0] | 0} ${d0.p[1] | 0} ${p[0] | 0} ${p[1] | 0} ${Math.max(80, Math.min(1500, Date.now() - d0.t))}`);
      this.kick();
    };
    elm.addEventListener('pointerup', up); elm.addEventListener('pointercancel', up);
    elm.addEventListener('contextmenu', (e) => { e.preventDefault(); this.key('back'); });
    let wheelLock = 0;
    elm.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = map(e); if (!p) return;
      if (mode === 'video' && this.player && this.player.active) { const v = -Math.sign(e.deltaY) * Math.min(4, Math.max(1, Math.abs(e.deltaY) / 100)); this.player.scroll(p[0], p[1], v, 0); return; }
      if (Date.now() - wheelLock < 350) return; wheelLock = Date.now();
      const w = elm.naturalWidth, h = elm.naturalHeight, x = Math.round(w / 2), dy = e.deltaY > 0 ? 1 : -1;
      this.o()?.run(`input swipe ${x} ${Math.round(h * (0.5 + 0.2 * dy))} ${x} ${Math.round(h * (0.5 - 0.2 * dy))} 200`); this.kick();
    }, { passive: false });
  },
  onKey(e) {
    if (!this.live || e.ctrlKey || e.altKey || e.metaKey) { if (e.key === 'F11' && this.live) { e.preventDefault(); this.toggleFs(); } return; }
    if (e.key === 'F11') { e.preventDefault(); return this.toggleFs(); }
    const named = { Enter: 'enter', Backspace: 'del', Delete: 'fwddel', Tab: 'tab', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pgup', PageDown: 'pgdn', Home: 'home' }[e.key];
    if (e.key === 'Escape') { if (document.fullscreenElement) return; e.preventDefault(); return this.key('back'); }
    if (this.player && this.player.active) {
      if (named) { e.preventDefault(); this.player.key(AKEY[named]); return; }
      if (e.key.length === 1) { e.preventDefault(); this.player.text(e.key); }
      return;
    }
    const o = this.o(); if (!o) return;
    if (named) o.run(`input keyevent ${AKEY[named]}`);
    else if (e.key.length === 1) o.run(inputText(e.key));
    else return;
    e.preventDefault(); this.kick();
  },
  setButtons() {
    const el = this.el; if (!el || !$('#liveBtn', el)) return;
    const lb = $('#liveBtn', el), mb = $('#mirrorLiveBtn', el);
    lb.innerHTML = this.live === 'shots' ? `${icon('stop')}Stop` : `${icon('play')}Start`;
    lb.className = 'btn sm ' + (this.live === 'shots' ? 'danger' : 'tonal');
    mb.innerHTML = this.live === 'video' ? `${icon('stop')}Stop mirroring` : `${icon('cast')}Mirror`;
    mb.className = 'btn sm ' + (this.live === 'video' ? 'danger' : 'filled');
    const sl = $('[data-stop-label]', el); if (sl) sl.textContent = this.live === 'video' ? 'Stop mirroring' : 'Stop';
  },
  async startLive(mode = 'shots') {
    if (this.live) this.stopLive();
    const el = this.el, dev = this.dev(); if (!dev) return;
    if (mode === 'video' && (dev.web || !mirrorSupported())) { toast(dev.web ? 'Mirroring needs normal ADB mode — using screenshots in USB direct mode.' : 'This computer cannot play the video stream — using screenshots.', { error: true }); mode = 'shots'; }
    this.live = mode;
    this.setButtons();
    $('#liveEmpty', el).classList.add('hidden'); $('#liveError', el).classList.add('hidden');
    $('#liveStatus', el).textContent = mode === 'video' ? 'Starting mirroring…' : 'Starting live view…';
    if (mode === 'video') {
      const canvas = $('#liveCanvas', el);
      let frames = 0, t0 = performance.now(), first = true;
      this.player = new MirrorPlayer(canvas, {
        onFrame: (w, h) => {
          if (first || w !== this.lastW || h !== this.lastH) { if (first) { canvas.classList.remove('hidden'); $('#liveImg', el).classList.add('hidden'); } first = false; this.lastW = w; this.lastH = h; this.fitFs(); }
          frames++; const dt = (performance.now() - t0) / 1000;
          if (dt > 1.5) { $('#liveStatus', el).textContent = `Live · ${Math.round(frames / dt)} fps · ${w}×${h}`; frames = 0; t0 = performance.now(); }
        },
        onEnd: (reason) => { if (this.live === 'video') { toast(reason || 'Mirroring stopped', { error: !!reason && !/stopped/i.test(reason) }); this.stopLive(true); } },
      });
      const player = this.player;
      let r = await player.start(dev.id, store.settings.scrcpy || {});
      if (this.live !== 'video' || this.player !== player) { player.stop(); return; }
      if (!r.ok) {   // the watch's encoder can be briefly busy (e.g. a mirror window just closed): wait and retry once
        $('#liveStatus', el).textContent = 'Retrying…';
        await sleep(1800);
        if (this.live !== 'video' || this.player !== player) return;
        r = await player.start(dev.id, store.settings.scrcpy || {});
        if (this.live !== 'video' || this.player !== player) { player.stop(); return; }
      }
      if (r.ok) {
        $('#liveStatus', el).textContent = `Live · ${r.width}×${r.height}`;
        // keep "Live · 0 fps" honest: if nothing is drawn for a while the screen is probably off
        setTimeout(() => { if (this.live && this.player && this.player.frames === 0) $('#liveStatus', el).textContent = 'Connected — waiting for the picture. Wake the device screen.'; }, 3000);
        return;
      }
      this.player = null;
      this.live = false; this.setButtons();
      $('#liveErrorMsg', el).textContent = `${r.msg || 'Unknown error'} If a separate mirror window is open, close it first. Wake the watch screen and try again.`;
      $('#liveError', el).classList.remove('hidden');
      $('#liveStatus', el).innerHTML = '&nbsp;';
      return;
    }
    this.shotLoop();
  },
  // fallback: refresh with screenshots (USB direct mode, or when the video stream can't start)
  async shotLoop() {
    const el = this.el; const token = (this.liveToken = {});
    $('#liveCanvas', el).classList.add('hidden'); $('#liveImg', el).classList.remove('hidden');
    let frames = 0, t0 = Date.now(), fails = 0, url = null;
    while (this.live && this.liveToken === token) {
      if (this.el.closest('.hidden')) break;
      const o = this.o(); if (!o) break;
      const b = await o.frame();
      if (!this.live || this.liveToken !== token) break;
      if (b && b.length) {
        fails = 0;
        const next = URL.createObjectURL(new Blob([b], { type: 'image/png' }));
        const img = $('#liveImg', el);
        await new Promise((res) => { img.onload = res; img.onerror = res; img.src = next; });
        if (url) URL.revokeObjectURL(url); url = next;
        frames++;
        const secs = (Date.now() - t0) / 1000;
        if (secs > 2) { $('#liveStatus', el).textContent = `Screenshots · ${(frames / secs).toFixed(1)} per second · ${img.naturalWidth}×${img.naturalHeight}`; frames = 0; t0 = Date.now(); }
      } else if (++fails >= 3) { $('#liveStatus', el).textContent = 'No picture — the screen may be off. Press Power to wake it.'; await sleep(1500); }
      await sleep(Date.now() - (this.kickAt || 0) < 1500 ? 30 : 150);
    }
    if (this.liveToken === token) this.stopLive();
  },
  stopLive(fromEnd) {
    this.live = false; this.liveToken = null;
    if (this.player) { if (!fromEnd) this.player.stop(); this.player = null; }
    const el = this.el; if (!el || !$('#liveBtn', el)) return;
    if (document.fullscreenElement === $('#liveFrame', el)) document.exitFullscreen().catch(() => {});
    this.setButtons();
    const canvasShown = !$('#liveCanvas', el).classList.contains('hidden');
    if (!canvasShown && !$('#liveImg', el).getAttribute('src')) $('#liveEmpty', el).classList.remove('hidden');
    $('#liveStatus', el).innerHTML = canvasShown || $('#liveImg', el).getAttribute('src') ? 'Stopped — showing the last picture' : '&nbsp;';
  },
  async toggleRec() {
    const el = this.el, o = this.o(); if (!o) return;
    const lbl = $('#recLabel', el), btn = $('#recBtn', el);
    if (!this.recording) {
      const r = await o.recordStart({ limit: +$('#recLimit', el).value, bitrate: +$('#recRate', el).value });
      if (!r.ok) return report(r);
      this.recording = true; btn.classList.add('recording');
      const t0 = Date.now(), limit = r.limit || 180;
      clearInterval(this.recTimer);
      this.recTimer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); lbl.textContent = `Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(limit / 60)}:${String(limit % 60).padStart(2, '0')}`; }, 500);
      toast('Recording the screen…');
    } else {
      lbl.textContent = 'Saving…';
      const r = await o.recordStop();
      this.recDone(r);
    }
  },
  recDone(r) {
    clearInterval(this.recTimer); this.recording = false;
    const el = this.el; if ($('#recBtn', el)) { $('#recBtn', el).classList.remove('recording'); $('#recLabel', el).textContent = 'Record'; }
    fileToast(r);
  },

  // ───── display settings ─────
  async loadDisplay() {
    const o = this.o(); if (!o) return;
    const box = $('#disp', this.el);
    const out = await o.text([
      ['size', 'wm size'], ['density', 'wm density'], ['font', 'settings get system font_scale'], ['timeout', 'settings get system screen_off_timeout'],
      ['bright', 'settings get system screen_brightness'], ['bmode', 'settings get system screen_brightness_mode'], ['touches', 'settings get system show_touches'],
      ['pointer', 'settings get system pointer_location'], ['anim', 'settings get global window_animation_scale'], ['night', 'cmd uimode night 2>/dev/null'],
    ].map(([k, c]) => `echo "@${k}=$(${c} 2>/dev/null | tr '\\n' ' ')"`).join('; '), 20000);
    const v = {}; for (const l of out.split(/\r?\n/)) { const m = l.match(/^@(\w+)=(.*)$/); if (m) v[m[1]] = m[2].trim(); }
    const phys = (v.size.match(/Physical size: (\d+x\d+)/) || [])[1] || '', over = (v.size.match(/Override size: (\d+x\d+)/) || [])[1] || '';
    const pd = (v.density.match(/Physical density: (\d+)/) || [])[1] || '', od = (v.density.match(/Override density: (\d+)/) || [])[1] || '';
    const font = parseFloat(v.font) || 1, timeout = +v.timeout || 30000, bright = Math.max(0, Math.min(255, +v.bright || 128));
    const night = /yes/i.test(v.night) ? 'yes' : /auto/i.test(v.night) ? 'auto' : /no/i.test(v.night) ? 'no' : '';
    const anim = v.anim === 'null' || v.anim === '' ? 1 : parseFloat(v.anim);
    const [pw, ph] = phys.split('x').map(Number);
    const resOpts = pw ? [[phys, `Default (${phys})`], ...[0.9, 0.75, 0.5].map((f) => { const r = `${Math.round(pw * f)}x${Math.round(ph * f)}`; return [r, `${Math.round(f * 100)}% (${r})`]; })] : [];
    const sel = (opts, cur) => opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(cur) ? 'selected' : ''}>${t}</option>`).join('');
    box.innerHTML = `
      <div class="set-row"><span><b>Resolution</b><small>${over ? `Changed from ${phys}` : 'Screen size in pixels'}</small></span><select id="dRes">${sel(resOpts, over || phys)}${over && !resOpts.some((r) => r[0] === over) ? `<option selected value="${over}">${over}</option>` : ''}</select></div>
      <div class="set-row"><span><b>Density</b><small>Bigger number = smaller items${od ? ` (default ${pd})` : ''}</small></span><div class="row"><input id="dDpi" type="number" min="100" max="800" value="${od || pd}" class="num" /><button class="btn tonal sm" id="dDpiSet">Apply</button>${od ? '<button class="btn text sm" id="dDpiReset">Reset</button>' : ''}</div></div>
      <div class="set-row"><span><b>Text size</b></span><select id="dFont">${sel([[0.85, 'Small'], [1, 'Default'], [1.15, 'Large'], [1.3, 'Larger'], [1.5, 'Largest']], [0.85, 1, 1.15, 1.3, 1.5].reduce((a, b) => (Math.abs(b - font) < Math.abs(a - font) ? b : a)))}</select></div>
      <div class="set-row"><span><b>Screen timeout</b></span><select id="dTimeout">${sel([[15000, '15 seconds'], [30000, '30 seconds'], [60000, '1 minute'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes'], [1800000, '30 minutes']], [15000, 30000, 60000, 120000, 300000, 600000, 1800000].reduce((a, b) => (Math.abs(b - timeout) < Math.abs(a - timeout) ? b : a)))}</select></div>
      <div class="set-row"><span><b>Brightness</b><small>${v.bmode === '1' ? 'Automatic — moving the slider turns it off' : 'Manual'}</small></span><div class="row"><input id="dBright" type="range" min="1" max="255" value="${bright}" /><label class="check"><input type="checkbox" id="dAuto" ${v.bmode === '1' ? 'checked' : ''}><span>Auto</span></label></div></div>
      ${night ? `<div class="set-row"><span><b>Dark theme</b></span><select id="dNight">${sel([['auto', 'Follow system'], ['no', 'Off'], ['yes', 'On']], night)}</select></div>` : ''}
      <div class="set-row"><span><b>Animation speed</b></span><select id="dAnim">${sel([[0, 'Off'], [0.5, 'Fast (0.5×)'], [1, 'Normal'], [1.5, 'Slow (1.5×)'], [2, 'Slower (2×)']], anim)}</select></div>
      <label class="set-row"><span><b>Show taps</b><small>Circles where you touch</small></span><input type="checkbox" class="switch" id="dTouch" ${v.touches === '1' ? 'checked' : ''}></label>
      <label class="set-row"><span><b>Pointer location</b><small>Touch coordinates overlay</small></span><input type="checkbox" class="switch" id="dPointer" ${v.pointer === '1' ? 'checked' : ''}></label>`;
    const el = this.el;
    const put = async (cmd, msg) => { const r = await o.run(cmd); toast(r.ok ? msg : r.msg || 'Could not change the setting', { error: !r.ok, ms: 1800 }); return r.ok; };
    $('#dRes', el).onchange = async (e) => { const val = e.target.value; await this.safeChange(val === phys ? 'wm size reset' : `wm size ${val}`, 'wm size reset', 'resolution'); this.loadDisplay(); };
    $('#dDpiSet', el).onclick = async () => { const n = +$('#dDpi', el).value; if (!(n >= 100 && n <= 800)) return toast('Enter a density between 100 and 800', { error: true }); await this.safeChange(n === +pd ? 'wm density reset' : `wm density ${n}`, 'wm density reset', 'density'); this.loadDisplay(); };
    const dr = $('#dDpiReset', el); if (dr) dr.onclick = async () => { await put('wm density reset', 'Density reset'); this.loadDisplay(); };
    $('#dFont', el).onchange = (e) => put(`settings put system font_scale ${e.target.value}`, 'Text size changed');
    $('#dTimeout', el).onchange = (e) => put(`settings put system screen_off_timeout ${e.target.value}`, 'Screen timeout changed');
    let bt; $('#dBright', el).oninput = (e) => { clearTimeout(bt); bt = setTimeout(() => { $('#dAuto', el).checked = false; o.run(`settings put system screen_brightness_mode 0; settings put system screen_brightness ${e.target.value}`); }, 120); };
    $('#dAuto', el).onchange = (e) => put(`settings put system screen_brightness_mode ${e.target.checked ? 1 : 0}`, e.target.checked ? 'Automatic brightness on' : 'Automatic brightness off');
    const dn = $('#dNight', el); if (dn) dn.onchange = (e) => put(`cmd uimode night ${e.target.value}`, 'Dark theme changed');
    $('#dAnim', el).onchange = (e) => { const s = e.target.value; put(`settings put global window_animation_scale ${s}; settings put global transition_animation_scale ${s}; settings put global animator_duration_scale ${s}`, 'Animation speed changed'); };
    $('#dTouch', el).onchange = (e) => put(`settings put system show_touches ${e.target.checked ? 1 : 0}`, e.target.checked ? 'Show taps on' : 'Show taps off');
    $('#dPointer', el).onchange = (e) => put(`settings put system pointer_location ${e.target.checked ? 1 : 0}`, e.target.checked ? 'Pointer location on' : 'Pointer location off');
  },
  // apply a risky display change and revert automatically unless the user keeps it
  safeChange(cmd, revert, what) {
    const o = this.o();
    return new Promise(async (resolve) => {
      const r = await o.run(cmd);
      if (!r.ok) { toast(r.msg || 'Could not change the ' + what, { error: true }); return resolve(false); }
      let left = 15, kept = false;
      openDialog(`<h2>Keep this ${what}?</h2><p>The change is applied on the device. If the screen is unusable, it goes back automatically in <b id="cd">${left}</b> seconds.</p><div class="actions"><button class="btn text" data-r>Undo now</button><button class="btn filled" data-k>Keep it</button></div>`, (d) => {
        const t = setInterval(() => { left--; const c = d.querySelector('#cd'); if (c) c.textContent = left; if (left <= 0) closeDialog(); }, 1000);
        d.querySelector('[data-k]').onclick = () => { kept = true; closeDialog(); };
        d.querySelector('[data-r]').onclick = () => closeDialog();
        return async () => { clearInterval(t); if (!kept) { await o.run(revert); toast(`The ${what} was changed back`); } else toast(`New ${what} kept`); resolve(kept); };
      });
    });
  },
};
window.addEventListener('webadb-recording-ended', (e) => page.recDone(e.detail));
api.on('recording-ended', (r) => { if (r.id === page.devId) page.recDone(r); });
