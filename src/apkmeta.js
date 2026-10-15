// Reads an app's label and icon from its APK, without the Android SDK.
// Parses the binary AndroidManifest.xml, resources.arsc and (for adaptive/vector icons) binary XML drawables.
'use strict';

function stringPool(buf, off) {
  const hsz = buf.readUInt16LE(off + 2);
  const count = buf.readUInt32LE(off + 8), flags = buf.readUInt32LE(off + 16), start = buf.readUInt32LE(off + 20);
  const utf8 = !!(flags & 0x100);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    try {
      let p = off + start + buf.readUInt32LE(off + hsz + i * 4);
      if (utf8) {
        let n = buf[p++]; if (n & 0x80) p++;
        let bl = buf[p++]; if (bl & 0x80) bl = ((bl & 0x7f) << 8) | buf[p++];
        out[i] = buf.toString('utf8', p, p + bl);
      } else {
        let n = buf.readUInt16LE(p); p += 2; if (n & 0x8000) { n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p); p += 2; }
        out[i] = buf.toString('utf16le', p, p + n * 2);
      }
    } catch { out[i] = ''; }
  }
  return out;
}

// ── binary XML → tree { name, attrs: { name: {raw, type, data} }, children }
function parseXml(buf) {
  if (!buf || buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) return null;
  let strings = [];
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let off = buf.readUInt16LE(2);
  while (off + 8 <= buf.length) {
    const type = buf.readUInt16LE(off), size = buf.readUInt32LE(off + 4);
    if (!size) break;
    if (type === 0x0001) strings = stringPool(buf, off);
    else if (type === 0x0102) {
      const name = strings[buf.readUInt32LE(off + 20)] || '';
      const aStart = buf.readUInt16LE(off + 24), aSize = buf.readUInt16LE(off + 26), aCount = buf.readUInt16LE(off + 28);
      const el = { name, attrs: {}, children: [] };
      for (let i = 0; i < aCount; i++) {
        const a = off + 16 + aStart + i * aSize;
        const an = strings[buf.readUInt32LE(a + 4)] || '';
        const raw = buf.readInt32LE(a + 8);
        el.attrs[an] = { raw: raw >= 0 ? strings[raw] : null, type: buf[a + 15], data: buf.readUInt32LE(a + 16) };
      }
      stack[stack.length - 1].children.push(el);
      stack.push(el);
    } else if (type === 0x0103) { if (stack.length > 1) stack.pop(); }
    off += size;
  }
  return root.children[0] || null;
}

// ── resources.arsc → resolve(resId) → [{ density, lang, type, data, str }]
function parseArsc(buf) {
  const types = new Map(); // key `${pkgId}:${typeId}` → [{config, chunkOff}]
  let globalStrings = [];
  if (!buf || buf.readUInt16LE(0) !== 0x0002) return null;
  let off = buf.readUInt16LE(2);
  while (off + 8 <= buf.length) {
    const type = buf.readUInt16LE(off), hsz = buf.readUInt16LE(off + 2), size = buf.readUInt32LE(off + 4);
    if (!size) break;
    if (type === 0x0001) globalStrings = stringPool(buf, off);
    else if (type === 0x0200) {
      const pkgId = buf.readUInt32LE(off + 8);
      let p = off + hsz;
      const end = off + size;
      while (p + 8 <= end) {
        const t = buf.readUInt16LE(p), s = buf.readUInt32LE(p + 4);
        if (!s) break;
        if (t === 0x0201) {
          const typeId = buf[p + 8];
          const k = `${pkgId}:${typeId}`;
          if (!types.has(k)) types.set(k, []);
          types.get(k).push(p);
        }
        p += s;
      }
    }
    off += size;
  }
  function entriesFor(resId) {
    const pkgId = resId >>> 24, typeId = (resId >>> 16) & 0xff, idx = resId & 0xffff;
    const out = [];
    for (const c of types.get(`${pkgId}:${typeId}`) || []) {
      const hsz = buf.readUInt16LE(c + 2), flags = buf[c + 9], count = buf.readUInt32LE(c + 12), estart = buf.readUInt32LE(c + 16);
      const cfg = c + 20;
      const density = buf.readUInt16LE(cfg + 14), lang = buf.toString('latin1', cfg + 8, cfg + 10).replace(/\0/g, '');
      let eoff = -1;
      if (flags & 0x01) {   // sparse
        for (let i = 0; i < count; i++) { const e = c + hsz + i * 4; if (buf.readUInt16LE(e) === idx) { eoff = buf.readUInt16LE(e + 2) * 4; break; } }
      } else if (idx < count) {
        if (flags & 0x02) { const v = buf.readUInt16LE(c + hsz + idx * 2); if (v !== 0xffff) eoff = v * 4; }
        else { const v = buf.readUInt32LE(c + hsz + idx * 4); if (v !== 0xffffffff) eoff = v; }
      }
      if (eoff < 0) continue;
      const e = c + estart + eoff;
      const eflags = buf.readUInt16LE(e + 2);
      let vtype, vdata;
      if (eflags & 0x0008) { vtype = eflags >> 8; vdata = buf.readUInt32LE(e + 4); }       // compact entry
      else if (eflags & 0x0001) continue;                                                 // bag (style) — not needed
      else { const esz = buf.readUInt16LE(e); vtype = buf[e + esz + 3]; vdata = buf.readUInt32LE(e + esz + 4); }
      out.push({ density, lang, type: vtype, data: vdata, str: vtype === 0x03 ? globalStrings[vdata] : null });
    }
    return out;
  }
  function resolve(resId, depth = 0) {
    const list = entriesFor(resId);
    if (depth < 6) for (let i = 0; i < list.length; i++) if (list[i].type === 0x01 && list[i].data) { const r = resolve(list[i].data, depth + 1); if (r.length) list.splice(i, 1, ...r); }
    return list;
  }
  return { resolve };
}

// ── helpers
const argb = (v) => { const a = (v >>> 24) & 255, r = (v >>> 16) & 255, g = (v >>> 8) & 255, b = v & 255; return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`; };
const isColor = (t) => t >= 0x1c && t <= 0x1f;
const f32 = (u) => { const b = Buffer.alloc(4); b.writeUInt32LE(u >>> 0); return b.readFloatLE(0); };
function dimen(u) { const mult = [1, 1 / 128, 1 / 32768, 1 / 8388608][(u >> 4) & 3]; return ((u & 0xffffff00) >> 8) * mult; }
function num(attr, arsc) {
  if (!attr) return null;
  if (attr.raw != null && attr.raw !== '' && !isNaN(+attr.raw)) return +attr.raw;
  if (attr.type === 0x04) return f32(attr.data);
  if (attr.type === 0x05) return dimen(attr.data);
  if (attr.type === 0x10 || attr.type === 0x11) return attr.data | 0;
  if (attr.type === 0x01 && arsc) { const r = arsc.resolve(attr.data)[0]; if (r) return r.type === 0x04 ? f32(r.data) : r.type === 0x05 ? dimen(r.data) : r.data | 0; }
  return null;
}
function color(attr, arsc) {
  if (!attr) return null;
  if (attr.raw && /^#/.test(attr.raw)) { const h = attr.raw.slice(1); const v = h.length === 6 ? 0xff000000 | parseInt(h, 16) : parseInt(h.length === 8 ? h : h.padStart(8, 'f'), 16); return argb(v); }
  if (isColor(attr.type)) return argb(attr.data);
  if (attr.type === 0x01 && arsc) { const r = arsc.resolve(attr.data).find((x) => isColor(x.type)); if (r) return argb(r.data); }
  return null;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Android vector drawable → SVG (paths, groups, solid colours, simple gradients)
function vectorToSvg(tree, arsc) {
  if (!tree || tree.name !== 'vector') return null;
  const vw = num(tree.attrs.viewportWidth, arsc) || 24, vh = num(tree.attrs.viewportHeight, arsc) || 24;
  const defs = []; let gid = 0;
  const paint = (el, which) => {
    const a = el.attrs[which];
    const c = color(a, arsc);
    if (c) return c;
    // inline gradient: <aapt:attr name="android:fillColor"><gradient …>
    const holder = el.children.find((ch) => ch.name === 'attr' && ch.attrs.name && /fillColor|strokeColor/.test(ch.attrs.name.raw || '') && (ch.attrs.name.raw || '').includes(which));
    const g = holder && holder.children.find((ch) => ch.name === 'gradient');
    if (!g) return null;
    const id = 'g' + gid++;
    const stops = g.children.filter((s) => s.name === 'item').map((s) => `<stop offset="${num(s.attrs.offset, arsc) || 0}" stop-color="${color(s.attrs.color, arsc) || '#000'}"/>`);
    if (!stops.length) {
      const sc = color(g.attrs.startColor, arsc), cc = color(g.attrs.centerColor, arsc), ec = color(g.attrs.endColor, arsc);
      if (sc) stops.push(`<stop offset="0" stop-color="${sc}"/>`); if (cc) stops.push(`<stop offset="0.5" stop-color="${cc}"/>`); if (ec) stops.push(`<stop offset="1" stop-color="${ec}"/>`);
    }
    const type = num(g.attrs.type, arsc) || 0;
    if (type === 1) defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(g.attrs.centerX, arsc) || 0}" cy="${num(g.attrs.centerY, arsc) || 0}" r="${num(g.attrs.gradientRadius, arsc) || 1}">${stops.join('')}</radialGradient>`);
    else defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(g.attrs.startX, arsc) || 0}" y1="${num(g.attrs.startY, arsc) || 0}" x2="${num(g.attrs.endX, arsc) || 0}" y2="${num(g.attrs.endY, arsc) || 0}">${stops.join('')}</linearGradient>`);
    return `url(#${id})`;
  };
  const walk = (el) => {
    let out = '';
    for (const ch of el.children) {
      if (ch.name === 'group') {
        const tx = num(ch.attrs.translateX, arsc) || 0, ty = num(ch.attrs.translateY, arsc) || 0, px = num(ch.attrs.pivotX, arsc) || 0, py = num(ch.attrs.pivotY, arsc) || 0;
        const r = num(ch.attrs.rotation, arsc) || 0, sx = num(ch.attrs.scaleX, arsc) ?? 1, sy = num(ch.attrs.scaleY, arsc) ?? 1;
        out += `<g transform="translate(${tx + px} ${ty + py}) rotate(${r}) scale(${sx} ${sy}) translate(${-px} ${-py})">${walk(ch)}</g>`;
      } else if (ch.name === 'path') {
        const d = ch.attrs.pathData && (ch.attrs.pathData.raw || (ch.attrs.pathData.type === 0x01 && arsc ? (arsc.resolve(ch.attrs.pathData.data).find((x) => x.str) || {}).str : null));
        if (!d) continue;
        const fill = paint(ch, 'fillColor'), stroke = paint(ch, 'strokeColor');
        const fa = num(ch.attrs.fillAlpha, arsc), sa = num(ch.attrs.strokeAlpha, arsc), sw = num(ch.attrs.strokeWidth, arsc);
        const evenOdd = ch.attrs.fillType && (ch.attrs.fillType.data === 1 || ch.attrs.fillType.raw === 'evenOdd');
        out += `<path d="${esc(d)}" fill="${fill || 'none'}"${fa != null ? ` fill-opacity="${fa}"` : ''}${stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : ''}${sa != null ? ` stroke-opacity="${sa}"` : ''}${evenOdd ? ' fill-rule="evenodd"' : ''}/>`;
      }
    }
    return out;
  };
  const body = walk(tree);
  if (!body) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`;
}

// a few android:color/… values apps use as icon backgrounds
const FRAMEWORK_COLORS = { 0x0106000c: '#000000', 0x0106000b: '#ffffff', 0x0106000d: 'transparent', 0x01060000: '#000000', 0x01060003: '#ffffff', 0x01060001: '#aaaaaa', 0x01060002: '#444444' };

// ── main entry: get(name) returns Buffer|null for a file inside the APK
async function readAppMeta(get) {
  const manifest = parseXml(await get('AndroidManifest.xml'));
  if (!manifest) return null;
  const pkg = manifest.attrs.package && manifest.attrs.package.raw;
  const versionName = manifest.attrs.versionName && manifest.attrs.versionName.raw;
  const versionCode = manifest.attrs.versionCode ? (manifest.attrs.versionCode.raw ? +manifest.attrs.versionCode.raw : manifest.attrs.versionCode.data) : 0;
  const appEl = manifest.children.find((c) => c.name === 'application') || { attrs: {} };
  let arsc = null;
  const needArsc = (appEl.attrs.label && appEl.attrs.label.type === 0x01) || (appEl.attrs.icon && appEl.attrs.icon.type === 0x01) || (appEl.attrs.roundIcon && appEl.attrs.roundIcon.type === 0x01);
  if (needArsc) { try { arsc = parseArsc(await get('resources.arsc')); } catch { arsc = null; } }
  // label: literal or string resource (default language first)
  let label = appEl.attrs.label && appEl.attrs.label.raw;
  if (!label && appEl.attrs.label && arsc) {
    const c = arsc.resolve(appEl.attrs.label.data).filter((x) => x.str != null);
    label = (c.find((x) => !x.lang) || c.find((x) => x.lang === 'en') || c[0] || {}).str;
  }
  // icon
  let icon = null;
  const iconAttr = appEl.attrs.icon || appEl.attrs.roundIcon;
  if (iconAttr && arsc && iconAttr.type === 0x01) {
    const files = arsc.resolve(iconAttr.data).filter((x) => x.str);
    const raster = files.filter((x) => /\.(png|webp|jpg)$/i.test(x.str)).sort((a, b) => (b.density === 0xffff ? 0 : b.density) - (a.density === 0xffff ? 0 : a.density));
    const asImg = async (file) => { const b = await get(file); return b && b.length ? `data:image/${/\.webp$/i.test(file) ? 'webp' : /\.jpe?g$/i.test(file) ? 'jpeg' : 'png'};base64,${b.toString('base64')}` : null; };
    const drawable = async (resId, depth = 0) => {   // → { img } | { color } | null
      if (depth > 3) return null;
      if (resId >>> 24 === 0x01) { const c = FRAMEWORK_COLORS[resId]; return c ? { color: c } : null; }
      const list = arsc.resolve(resId);
      const col = list.find((x) => isColor(x.type)); if (col) return { color: argb(col.data) };
      const r = list.filter((x) => x.str && /\.(png|webp|jpg)$/i.test(x.str)).sort((a, b) => b.density - a.density)[0];
      if (r) return { img: await asImg(r.str) };
      const x = list.find((x) => x.str && /\.xml$/i.test(x.str));
      if (x) {
        const tree = parseXml(await get(x.str));
        if (!tree) return null;
        if (tree.name === 'vector') { const svg = vectorToSvg(tree, arsc); return svg ? { img: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') } : null; }
        if (tree.name === 'inset' || tree.name === 'bitmap' || tree.name === 'layer-list') {
          const d = tree.attrs.drawable || tree.attrs.src || (tree.children[0] && tree.children[0].attrs.drawable);
          if (d && d.type === 0x01) return drawable(d.data, depth + 1);
        }
        if (tree.name === 'shape') { const solid = tree.children.find((c) => c.name === 'solid'); const c = solid && color(solid.attrs.color, arsc); if (c) return { color: c }; }
      }
      return null;
    };
    if (raster.length) { const src = await asImg(raster[0].str); if (src) icon = { kind: 'image', src }; }
    if (!icon) {
      const xml = files.find((x) => /\.xml$/i.test(x.str));
      const tree = xml && parseXml(await get(xml.str));
      if (tree && tree.name === 'adaptive-icon') {
        const layer = async (nm) => { const el = tree.children.find((c) => c.name === nm); const a = el && el.attrs.drawable; if (a && a.type === 0x01) return drawable(a.data); if (a && isColor(a.type)) return { color: argb(a.data) }; if (el && el.children[0]) { if (el.children[0].name === 'vector') { const svg = vectorToSvg(el.children[0], arsc); return svg ? { img: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') } : null; } } return null; };
        const fg = await layer('foreground'), bg = await layer('background');
        if (fg || bg) icon = { kind: 'adaptive', fg: fg && fg.img, fgColor: fg && fg.color, bg: bg && bg.img, bgColor: bg && bg.color };
      } else if (tree && tree.name === 'vector') {
        const svg = vectorToSvg(tree, arsc); if (svg) icon = { kind: 'image', src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
      }
    }
  }
  return { pkg, versionName, versionCode, label: label || null, icon };
}

module.exports = { readAppMeta, parseXml, parseArsc };
