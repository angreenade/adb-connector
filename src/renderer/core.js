// Shared helpers, state and the unified device operations used by every page.
export const api = window.api;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function fmtBytes(n) { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i]; }
export function fmtDate(sec) { if (!sec) return ''; const d = new Date(sec * 1000); return d.toLocaleDateString(document.documentElement.lang === 'he' ? 'he-IL' : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(document.documentElement.lang === 'he' ? 'he-IL' : undefined, { hour: '2-digit', minute: '2-digit' }); }
export function fmtDuration(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`; }
export async function call(fn, ...a) {
  try { const r = await fn(...a); return r ?? { ok: false, msg: 'No response' }; }
  catch (e) { console.error(e); return { ok: false, msg: 'Something went wrong. Please try again.' }; }
}

// ───────── icons (Material Symbols, 24px) ─────────
const P = {
  devices: 'M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z',
  phone: 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  watch: 'M20 12c0-2.54-1.19-4.81-3.04-6.27L16 0H8l-.95 5.73C5.19 7.19 4 9.45 4 12s1.19 4.81 3.05 6.27L8 24h8l.96-5.73A7.976 7.976 0 0 0 20 12zM6 12c0-3.31 2.69-6 6-6s6 2.69 6 6-2.69 6-6 6-6-2.69-6-6z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  apps: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  screen: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  bolt: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
  terminal: 'M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z',
  logs: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  wifi: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8 3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4 2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  usb: 'M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07c.7-.37 1.2-1.08 1.2-1.93 0-1.21-.99-2.2-2.2-2.2S4.8 7.79 4.8 9c0 .85.5 1.56 1.2 1.93V13c0 1.11.89 2 2 2h3v3.05c-.71.37-1.2 1.1-1.2 1.95a2.2 2.2 0 0 0 4.4 0c0-.85-.49-1.58-1.2-1.95V15h3c1.11 0 2-.89 2-2v-2h1V7h-4z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  linkOff: 'M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16zM2 4.27l3.11 3.11A4.991 4.991 0 0 0 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4L20 19.74 3.27 3 2 4.27z',
  pair: 'M12 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 2c0-3.31-2.69-6-6-6s-6 2.69-6 6c0 2.22 1.21 4.15 3 5.19l1-1.74c-1.19-.7-2-1.97-2-3.45 0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.48-.81 2.75-2 3.45l1 1.74c1.79-1.04 3-2.97 3-5.19zM12 3C6.48 3 2 7.48 2 13c0 3.7 2.01 6.92 4.99 8.65l1-1.73C5.61 18.53 4 15.96 4 13c0-4.42 3.58-8 8-8s8 3.58 8 8c0 2.96-1.61 5.53-4 6.92l1 1.73c2.99-1.73 5-4.95 5-8.65 0-5.52-4.48-10-10-10z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  video: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  cast: 'M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z',
  newFolder: 'M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z',
  file: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z', stop: 'M6 6h12v12H6z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  up: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  recents: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.932 8.932 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z',
  touch: 'M9 11.24V7.5a2.5 2.5 0 0 1 5 0v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z',
  keyboard: 'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  battery: 'M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z',
  storage: 'M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z',
  memory: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z',
  pause2: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  save: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  library: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fullscreenExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  brightness: 'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z',
};
export const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || P.info}"/></svg>`;

// ───────── toast ─────────
let toastTimer;
export function toast(msg, { error = false, action, actionLabel, ms = 4200 } = {}) {
  if (!msg) return;
  const t = $('#toast');
  t.className = 'toast' + (error ? ' err' : '');
  t.innerHTML = `<span class="msg">${esc(msg)}</span>` + (action ? `<button>${esc(actionLabel)}</button>` : '') + `<button class="x" aria-label="Dismiss">${icon('close')}</button>`;
  if (action) t.querySelector('button').onclick = () => { action(); t.classList.remove('show'); };
  t.querySelector('.x').onclick = () => t.classList.remove('show');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? ms + 3000 : error ? ms + 2500 : ms);
}
export const report = (r) => r && r.msg && toast(r.msg, { error: !r.ok });
export function fileToast(r) {
  if (!r || !r.ok) return toast((r && r.msg) || 'Failed', { error: true });
  toast(r.msg, { action: () => api.openFile(r.file), actionLabel: 'Open' });
}

// ───────── dialogs ─────────
let onDialogClose = null;
export function openDialog(html, mount, { wide = false } = {}) {
  if (!$('#scrim').classList.contains('hidden')) closeDialog();
  const d = $('#dialog');
  d.className = 'dialog' + (wide ? ' wide' : '');
  d.innerHTML = html;
  $('#scrim').classList.remove('hidden');
  try { onDialogClose = mount ? mount(d) : null; } catch (e) { console.error(e); }
  const first = d.querySelector('input:not([readonly]):not([type=checkbox]):not([type=range]), textarea'); if (first) setTimeout(() => first.focus(), 30);
}
export function closeDialog() {
  $('#scrim').classList.add('hidden');
  const fn = onDialogClose; onDialogClose = null;
  if (typeof fn === 'function') { try { fn(); } catch (e) { console.error(e); } }
}
export function confirmDialog(title, { detail = '', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog(`<h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}<div class="actions"><button class="btn text" data-x>Cancel</button><button class="btn ${danger ? 'danger' : 'filled'}" data-ok>${esc(ok)}</button></div>`, (d) => {
      d.querySelector('[data-x]').onclick = () => closeDialog();
      d.querySelector('[data-ok]').onclick = () => { answered = true; closeDialog(); };
      setTimeout(() => d.querySelector('[data-ok]').focus(), 30);
      return () => resolve(answered);
    });
  });
}
export function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'OK', detail = '' } = {}) {
  return new Promise((resolve) => {
    let val = null;
    openDialog(`<h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}<form><label class="field"><span>${esc(label)}</span><input value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false" /></label>
      <div class="actions"><button type="button" class="btn text" data-x>Cancel</button><button class="btn filled">${esc(ok)}</button></div></form>`, (d) => {
      d.querySelector('[data-x]').onclick = () => closeDialog();
      d.querySelector('form').onsubmit = (e) => { e.preventDefault(); val = d.querySelector('input').value; closeDialog(); };
      return () => resolve(val);
    });
  });
}
document.addEventListener('mousedown', (e) => { if (e.target.id === 'scrim' && !document.querySelector('#dialog [data-busy]')) closeDialog(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); if (!$('#scrim').classList.contains('hidden') && !document.querySelector('#dialog [data-busy]')) closeDialog(); } });

// ───────── popup menu ─────────
export function closeMenu() { $$('.menu').forEach((m) => m.remove()); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) closeMenu(); });
export function showMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of items) {
    if (it === '-') { m.append(Object.assign(document.createElement('hr'))); continue; }
    const b = document.createElement('button');
    b.innerHTML = (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>`;
    if (it.danger) b.classList.add('danger');
    b.onclick = () => { closeMenu(); it.run(); };
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h) : r.bottom + 4) + 'px';
}

// ───────── state & events ─────────
const listeners = new Map();
export function on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); }
export function emit(evt, data) { for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } }

export const store = { devices: [], webDev: null, selectedId: null, lastSerials: [], lostSince: 0, settings: {}, adbVer: '' };
export const allDevices = () => (store.webDev ? [store.webDev] : []).concat(store.devices);
export const readyDevices = () => allDevices().filter((d) => d.state === 'device');
export const isWatch = (d) => !!(d && d.info && d.info.watch) || /^SM-R\d|watch/i.test((d && d.model) || '');
export function deviceName(d) {
  if (!d) return '';
  const i = d.info;
  if (i && (i.model || i.manufacturer)) {
    const brand = i.manufacturer && !(i.model || '').toLowerCase().startsWith(i.manufacturer.toLowerCase()) ? cap(i.manufacturer) + ' ' : '';
    return `${brand}${i.model || ''}`.trim();
  }
  return d.model || (d.web ? 'USB device' : d.serial);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const connLabel = (d) => (d.web ? 'USB direct' : d.type === 'wifi' ? 'Wi-Fi' : d.type === 'emulator' ? 'Emulator' : 'USB');
export const address = (d) => (d.web ? d.usbSerial : d.serial);

// the device the tool pages work on, matched by stable id (and by address as a fallback)
export function current() {
  const ready = readyDevices();
  let d = store.selectedId && ready.find((x) => x.id === store.selectedId);
  if (!d && store.lastSerials.length) d = ready.find((x) => [x.serial, ...(x.aliases || [])].some((s) => store.lastSerials.includes(s)));
  if (!d && !store.selectedId && ready.length) d = ready[0];
  if (d) { store.selectedId = d.id; store.lastSerials = [d.serial, ...(d.aliases || [])]; store.lostSince = 0; }
  return d || null;
}
// a device first appears with a temporary id ("serial:<address>") until its serial number is read
export function sameDevice(oldId, d) {
  if (!oldId || !d) return false;
  if (oldId === d.id) return true;
  return oldId.startsWith('serial:') && [d.serial, ...(d.aliases || [])].includes(oldId.slice(7));
}
export function select(id) { const d = allDevices().find((x) => x.id === id); if (!d) return; store.selectedId = id; store.lastSerials = [d.serial, ...(d.aliases || [])]; store.lostSince = 0; emit('device', current()); }

// ───────── unified operations: same calls for ADB devices and WebADB (USB direct) devices ─────────
export function ops(d) {
  if (!d) throw new Error('No device');
  if (d.web) return d.ops;
  const id = d.id;
  return {
    id,
    run: (cmd, timeout) => call(api.run, id, cmd, timeout),
    text: async (cmd, timeout) => { const r = await call(api.run, id, cmd, timeout); return r.ok ? r.out : ''; },
    bytes: (cmd) => call(api.runBytes, id, cmd),
    frame: () => call(api.frame, id),
    pushText: (text, remote) => call(api.pushText, id, text, remote),
    install: (items, asSplit) => call(api.install, id, items.map((f) => (typeof f === 'string' ? f : api.pathForFile(f))).filter(Boolean), asSplit),
    push: (items, dir) => call(api.push, id, items.map((f) => (typeof f === 'string' ? f : api.pathForFile(f))).filter(Boolean), dir),
    pull: (remotes, ask) => call(api.pull, id, remotes, ask),
    extractApk: (pkg) => call(api.extractApk, id, pkg),
    screenshot: () => call(api.screenshot, id),
    recordStart: (o) => call(api.recordStart, id, o),
    recordStop: () => call(api.recordStop, id),
    mirror: (o) => call(api.scrcpy, id, o),
    adbCommand: (line) => call(api.adbCommand, id, line),
    reboot: (mode) => (mode === 'poweroff' ? call(api.run, id, 'svc power shutdown 2>/dev/null || reboot -p', 8000) : call(api.adbCommand, id, ('reboot ' + (mode || '')).trim())),
    async openShell(cols, rows, onData, onExit) {
      const r = await call(api.ptyOpen, id, cols, rows);
      if (!r.ok) return r;
      const offD = api.on('pty-data', (m) => { if (m.sid === r.sid) onData(m.data); });
      const offE = api.on('pty-exit', (m) => { if (m.sid === r.sid) { offD(); offE(); onExit(m.code); } });
      return { ok: true, write: (s) => api.ptyWrite(r.sid, s), close: () => { offD(); offE(); api.streamClose(r.sid); } };
    },
    async openLogcat(opts, onLines, onExit) {
      const r = await call(api.logcatOpen, id, opts);
      if (!r.ok) return r;
      const offL = api.on('logcat-lines', (m) => { if (m.sid === r.sid) onLines(m.lines); });
      const offE = api.on('logcat-exit', (m) => { if (m.sid === r.sid) { offL(); offE(); onExit && onExit(m.code); } });
      return { ok: true, close: () => { offL(); offE(); api.streamClose(r.sid); } };
    },
  };
}

// ───────── misc UI helpers ─────────
export function needDevice(el, what = 'this') {
  el.innerHTML = `<div class="empty-state">${icon('devices', 'ic big')}<h3>No device connected</h3><p>Connect a phone or watch to use ${esc(what)}.</p><button class="btn filled" data-go="devices">Connect a device</button></div>`;
  el.querySelector('[data-go]').onclick = () => emit('navigate', 'devices');
}
export async function busyBtn(btn, fn) {
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = '1'; btn.disabled = true; btn.classList.add('working');
  try { return await fn(); } catch (e) { console.error(e); toast('Something went wrong', { error: true }); }
  finally { delete btn.dataset.busy; btn.disabled = false; btn.classList.remove('working'); }
}
// "adb shell pm grant …" pasted by users → "pm grant …"; several commands pasted in one line are split
export function normalizeShell(input) {
  let s = String(input || '').trim();
  const parts = s.split(/\s*(?:^|\s)adb(?:\.exe)?(?:\s+-s\s+\S+)?\s+shell\s+/i).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}
// pick the meaningful line out of an Android error dump ("java.lang.SecurityException: … has not requested …")
export function deviceError(out, fallback = 'Failed') {
  const lines = String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) { const m = l.match(/(?:\w+\.)*\w*(?:Exception|Error):\s*(.+)$/); if (m && !/^Exception occurred/.test(l)) return m[1]; }
  const pick = lines.find((l) => /denied|not found|unknown|failure|not allowed|invalid/i.test(l) && !/^Exception occurred/.test(l));
  return pick || lines.filter((l) => !/^Exception occurred|^\s*at /.test(l)).pop() || fallback;
}
export function setSettings(patch) { store.settings = { ...store.settings, ...patch }; return call(api.settingsSet, patch); }
