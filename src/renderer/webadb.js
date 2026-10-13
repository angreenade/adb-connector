// WebADB: talks to the device directly over USB (no adb.exe) using ya-webadb.
// Exposes the same operations as ADB devices (see ops() in core.js).
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';

const store = new AdbWebCredentialStore('ADB Connector');
const api = window.api;

async function collect(stream) {
  const reader = stream.getReader();
  const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
  const out = new Uint8Array(size); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const dec = new TextDecoder();

export function webUsbSupported() { return !!AdbDaemonWebUsbDeviceManager.BROWSER; }
export async function pickWebUsbDevice() {
  const mgr = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!mgr) throw new Error('USB direct mode is not supported on this computer');
  return (await mgr.requestDevice()) || null;
}
export async function connectWebUsb(device) {
  let connection;
  try { connection = await device.connect(); }
  catch (e) {
    const m = String((e && (e.message || e.name)) || e);
    if (/busy|claim|access denied|in use/i.test(m) || e?.constructor?.name === 'DeviceBusyError')
      throw new Error('The device is being used by another program (Android Studio, another ADB tool). Close it and try again.');
    throw new Error("Couldn't open the USB connection. On Windows, install the Google USB Driver for your phone.");
  }
  const transport = await AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore: store });
  const adb = new Adb(transport);
  const props = await adb.subprocess.noneProtocol.spawnWaitText('getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno; getprop ro.build.characteristics');
  const [manufacturer, model, android, sn, chars] = props.split(/\r?\n/).map((s) => s.trim());
  return makeWebDevice(adb, device.serial, { manufacturer, model, android, sn, watch: /watch/i.test(chars || '') });
}

function makeWebDevice(adb, usbSerial, info) {
  const text = (cmd) => adb.subprocess.noneProtocol.spawnWaitText(cmd);
  const bytes = (cmd) => adb.subprocess.noneProtocol.spawnWait(cmd);
  const REC = '/sdcard/adbconnector_rec.mp4';
  let recProc = null;
  const pullBytes = async (remote) => { const sync = await adb.sync(); try { return await collect(sync.read(remote)); } finally { await sync.dispose(); } };
  const pushFile = async (file, remote) => { const sync = await adb.sync(); try { await sync.write({ filename: remote, file: file.stream() }); } finally { await sync.dispose(); } };
  const toFiles = (items) => items.filter((f) => typeof f !== 'string');

  const ops = {
    id: 'webadb:' + usbSerial,
    async run(cmd) { try { return { ok: true, out: await text(cmd) }; } catch (e) { return { ok: false, out: '', msg: e.message }; } },
    async text(cmd) { try { return await text(cmd); } catch { return ''; } },
    async bytes(cmd) { try { return await bytes(cmd); } catch { return null; } },
    async frame() { try { const b = await bytes('screencap -p'); return b && b.length > 100 ? b : null; } catch { return null; } },
    async install(items) {
      const results = [];
      for (const f of toFiles(items)) {
        if (!/\.apk$/i.test(f.name)) { results.push({ ok: false, msg: `${f.name}: USB direct mode installs .apk files only` }); continue; }
        try {
          const remote = '/data/local/tmp/adbconnector_install.apk';
          await pushFile(f, remote);
          const out = await text(`pm install -r -t "${remote}"; rm -f "${remote}"`);
          if (/Success/.test(out)) results.push({ ok: true, msg: `Installed ${f.name}` });
          else { const m = out.match(/Failure \[([^\]]+)\]/); results.push({ ok: false, msg: `Install failed: ${m ? m[1] : out.trim() || 'unknown error'}` }); }
        } catch (e) { results.push({ ok: false, msg: e.message }); }
      }
      return results;
    },
    async pushText(t, remote) { try { await pushFile(new Blob([String(t).replace(/\r\n?/g, '\n') + '\n']), remote); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; } },
    async push(items, dir) {
      const results = [];
      for (const f of toFiles(items)) { try { await pushFile(f, dir.replace(/\/$/, '') + '/' + f.name); results.push({ ok: true, msg: `Uploaded ${f.name}` }); } catch (e) { results.push({ ok: false, msg: e.message }); } }
      return results;
    },
    async pull(remotes) {
      let last = null;
      for (const r of remotes) {
        try { const b = await pullBytes(r); const name = r.split('/').pop() || 'file'; const ext = name.includes('.') ? name.split('.').pop() : 'bin'; last = await api.saveFile('file', b, ext); }
        catch (e) { return { ok: false, msg: `Download failed (USB direct mode downloads single files): ${e.message}` }; }
      }
      return last ? { ok: true, file: last.file, msg: 'Saved' } : { ok: false, msg: 'Nothing was downloaded' };
    },
    async extractApk(pkg) {
      const out = await text(`pm path ${pkg}`);
      const p = out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean)[0];
      if (!p) return { ok: false, msg: 'Could not find the app files' };
      const b = await pullBytes(p); const r = await api.saveFile('apk', b, 'apk');
      return { ok: true, file: r.file, msg: 'APK saved' };
    },
    async screenshot() {
      const png = await bytes('screencap -p').catch(() => null);
      if (!png || png.length < 100) return { ok: false, msg: 'Could not take a screenshot' };
      const r = await api.saveFile('screenshot', png, 'png');
      let bin = ''; for (let i = 0; i < png.length; i += 32768) bin += String.fromCharCode.apply(null, png.subarray(i, i + 32768));
      return { ok: true, file: r.file, msg: 'Screenshot saved', dataUrl: 'data:image/png;base64,' + btoa(bin) };
    },
    async recordStart(o = {}, onEnded) {
      if (recProc) return { ok: false, msg: 'Already recording' };
      const limit = Math.max(5, Math.min(180, +o.limit || 180));
      recProc = await adb.subprocess.noneProtocol.spawn(`screenrecord --time-limit ${limit} --bit-rate ${(+o.bitrate || 8) * 1000000} ${REC}`);
      const p = recProc;
      p.output.pipeTo(new WritableStream()).catch(() => {});
      p.exited.then(async () => { if (p.stopping) return; recProc = null; const res = await ops.saveRecording(); window.dispatchEvent(new CustomEvent('webadb-recording-ended', { detail: res })); }).catch(() => {});
      return { ok: true, limit };
    },
    async recordStop() {
      if (!recProc) return { ok: false, msg: 'Not recording' };
      const p = recProc; p.stopping = true; recProc = null;
      await text('pkill -INT screenrecord 2>/dev/null || (p=$(pidof screenrecord) && kill -2 $p)');
      await Promise.race([p.exited, new Promise((r) => setTimeout(r, 6000))]);
      return ops.saveRecording();
    },
    async saveRecording() {
      await new Promise((r) => setTimeout(r, 1000));
      try { const b = await pullBytes(REC); await text(`rm -f ${REC}`); const r = await api.saveFile('recording', b, 'mp4'); return { ok: true, file: r.file, msg: 'Recording saved' }; }
      catch { return { ok: false, msg: 'Could not save the recording' }; }
    },
    async reboot(mode) { try { const pw = adb.power; if (mode === 'recovery') await pw.recovery(); else if (mode === 'bootloader') await pw.bootloader(); else if (mode === 'poweroff') await pw.powerOff(); else await pw.reboot(); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; } },
    async mirror() { return { ok: false, msg: 'Screen mirroring needs normal ADB mode. Stop USB direct mode first (banner at the top).' }; },
    async adbCommand() { return { ok: false, out: 'adb commands are not available in USB direct mode. Use the terminal instead.' }; },
    async openShell(cols, rows, onData, onExit) {
      try {
        const sp = adb.subprocess.shellProtocol;
        const proc = sp && sp.isSupported ? await sp.pty({ terminalType: 'xterm-256color' }) : await adb.subprocess.noneProtocol.pty();
        const writer = proc.input.getWriter();
        const enc = new TextEncoder();
        if (proc.resize) proc.resize(rows, cols).catch(() => {});
        (async () => { const r = proc.output.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; onData(dec.decode(value, { stream: true })); } })().catch(() => {});
        proc.exited.then((c) => onExit(c)).catch(() => onExit(-1));
        return { ok: true, write: (s) => writer.write(enc.encode(s)).catch(() => {}), resize: (c, r) => proc.resize && proc.resize(r, c).catch(() => {}), close: () => { try { proc.kill(); } catch {} } };
      } catch (e) { return { ok: false, msg: e.message }; }
    },
    async openLogcat(o = {}, onLines, onExit) {
      try {
        const proc = await adb.subprocess.noneProtocol.spawn(`logcat -v threadtime -T ${o.tail || 300}${o.buffer && o.buffer !== 'main' ? ' -b ' + o.buffer : ''}`);
        let buf = '', pending = [];
        const flush = setInterval(() => { if (pending.length) onLines(pending.splice(0)); }, 200);
        (async () => { const r = proc.output.getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split(/\r?\n/); buf = ls.pop(); for (const l of ls) if (l && !l.startsWith('--------- beginning')) pending.push(l); } })().catch(() => {});
        proc.exited.then(() => { clearInterval(flush); onExit && onExit(0); }).catch(() => {});
        return { ok: true, close: () => { clearInterval(flush); try { proc.kill(); } catch {} } };
      } catch (e) { return { ok: false, msg: e.message }; }
    },
  };

  return {
    web: true, id: ops.id, serial: ops.id, usbSerial, state: 'device', type: 'usb', aliases: [], info, model: info.model,
    adb, ops, disconnected: adb.disconnected, close: () => adb.close(),
  };
}
