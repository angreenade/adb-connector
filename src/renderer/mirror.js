// In-app screen mirroring: decodes the scrcpy H.264 stream with WebCodecs and sends input back over the control channel.
import { api } from './core.js';

const FINGER = 0xFFFFFFFFFFFFFFFEn; // scrcpy POINTER_ID_GENERIC_FINGER
export const AKEY = { back: 4, home: 3, recents: 187, power: 26, volup: 24, voldown: 25, enter: 66, del: 67, fwddel: 112, tab: 61, up: 19, down: 20, left: 21, right: 22, pgup: 92, pgdn: 93, menu: 82, wake: 224 };

function codecFromSps(buf) {
  // find the SPS NAL (type 7) after an Annex B start code
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const s = buf[i + 2] === 1 ? i + 3 : i + 4;
      if ((buf[s] & 0x1f) === 7) { const h = (n) => n.toString(16).padStart(2, '0'); return `avc1.${h(buf[s + 1])}${h(buf[s + 2])}${h(buf[s + 3])}`; }
    }
  }
  return 'avc1.42E01F';
}
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };

export const mirrorSupported = () => typeof window.VideoDecoder === 'function';

export class MirrorPlayer {
  constructor(canvas, { onFrame, onEnd } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.onFrame = onFrame; this.onEnd = onEnd;
    this.sid = null; this.width = 0; this.height = 0; this.frames = 0;
  }
  async start(devId, opts) {
    if (!mirrorSupported()) return { ok: false, msg: 'This computer cannot decode the video stream.' };
    this.stopped = false;
    this.decoder = new VideoDecoder({
      output: (f) => this.draw(f),
      error: (e) => { console.error('decoder', e && e.message); this.needKey = true; this.recover(); },
    });
    this.needKey = true; this.config = null; this.codec = null;
    // subscribe before starting so the first packets (codec config) are never missed
    this.pending = [];
    this.offP = api.on('mirror-packet', (m) => { if (this.sid === null) this.pending.push(m); else if (m.sid === this.sid) this.packet(m); });
    this.offE = api.on('mirror-ended', (m) => { if (m.sid === this.sid) this.finish(m.reason || 'Mirroring stopped'); });
    const r = await api.mirrorStart(devId, opts);
    if (!r || !r.ok) { this.cleanup(); return r || { ok: false, msg: 'Could not start mirroring' }; }
    this.sid = r.sid; this.width = r.width; this.height = r.height; this.name = r.name;
    for (const m of this.pending.splice(0)) if (m.sid === this.sid) this.packet(m);
    return r;
  }
  packet(m) {
    const data = m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data);
    if (m.config) {
      this.config = data;
      const codec = codecFromSps(data);
      if (codec !== this.codec || this.decoder.state !== 'configured') {
        try { this.decoder.configure({ codec, optimizeForLatency: true }); this.codec = codec; } catch (e) { console.error('configure', e); }
      }
      this.needKey = true;
      return;
    }
    if (this.decoder.state !== 'configured') return;
    if (this.needKey && !m.key) return;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: m.key ? 'key' : 'delta', timestamp: m.pts, data: m.key && this.config ? concat(this.config, data) : data }));
      this.needKey = false;
    } catch (e) { console.error('decode', e); this.needKey = true; }
  }
  recover() {
    // after a decoder error: reset and wait for the next key frame (ask the device for one)
    try { this.decoder.reset(); if (this.codec) this.decoder.configure({ codec: this.codec, optimizeForLatency: true }); } catch {}
    this.send([17]); // RESET_VIDEO → device sends a fresh key frame
  }
  draw(f) {
    const w = f.displayWidth, h = f.displayHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.width = w; this.height = h;
    this.ctx.drawImage(f, 0, 0, w, h);
    f.close();
    this.frames++;
    this.onFrame && this.onFrame(w, h);
  }
  finish(reason) { if (this.stopped) return; this.cleanup(); this.onEnd && this.onEnd(reason); }
  stop() { if (this.stopped) return; const sid = this.sid; this.cleanup(); if (sid !== null) api.mirrorStop(sid); }
  cleanup() {
    this.stopped = true;
    try { this.offP && this.offP(); this.offE && this.offE(); } catch {}
    try { if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); } catch {}
    this.sid = null;
  }
  get active() { return this.sid !== null && !this.stopped; }

  // ───── input → scrcpy control messages ─────
  send(bytes) { if (this.active) api.mirrorControl(this.sid, bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)); }
  pos(dv, off, x, y) { dv.setInt32(off, Math.round(x)); dv.setInt32(off + 4, Math.round(y)); dv.setUint16(off + 8, this.width); dv.setUint16(off + 10, this.height); }
  touch(action, x, y) { // 0 down, 1 up, 2 move
    const b = new Uint8Array(32), dv = new DataView(b.buffer);
    b[0] = 2; b[1] = action; dv.setBigUint64(2, FINGER); this.pos(dv, 10, x, y);
    dv.setUint16(22, action === 1 ? 0 : 0xffff); dv.setUint32(24, 0); dv.setUint32(28, 0);
    this.send(b);
  }
  key(code, action) {
    const send = (a) => { const b = new Uint8Array(14), dv = new DataView(b.buffer); b[0] = 0; b[1] = a; dv.setInt32(2, code); dv.setInt32(6, 0); dv.setInt32(10, 0); this.send(b); };
    if (action === undefined) { send(0); send(1); } else send(action);
  }
  text(str) {
    const u = new TextEncoder().encode(str).slice(0, 300);
    const b = new Uint8Array(5 + u.length), dv = new DataView(b.buffer);
    b[0] = 1; dv.setUint32(1, u.length); b.set(u, 5);
    this.send(b);
  }
  back() { this.send([4, 0]); this.send([4, 1]); }
  scroll(x, y, v, h = 0) {
    const b = new Uint8Array(21), dv = new DataView(b.buffer);
    const fp = (n) => { const f = Math.max(-1, Math.min(1, n / 16)); let i = Math.round(f * 32768); if (i > 32767) i = 32767; if (i < -32768) i = -32768; return i; };
    b[0] = 3; this.pos(dv, 1, x, y); dv.setInt16(13, fp(h)); dv.setInt16(15, fp(v)); dv.setUint32(17, 0);
    this.send(b);
  }
  screenPower(on) { this.send([10, on ? 1 : 0]); }
}
