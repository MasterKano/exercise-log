// Small shared helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
export const fmtNum = (n) => n == null || n === '' ? '' : (Math.round(n * 100) / 100).toString();
export function fmtClock(sec, forceH = false) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h || forceH) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtDur(sec) {
  if (!sec) return '0 min';
  const m = Math.round(sec / 60); if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function parseClock(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim();
  if (s.includes(':')) { const p = s.split(':').map(x => parseInt(x, 10) || 0); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  const n = num(s); return n == null ? null : Math.round(n);
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYSL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDate = (ts) => { const d = new Date(ts); return `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
export const fmtShort = (ts) => { const d = new Date(ts); return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + String(d.getFullYear()).slice(2) : ''}`; };
export const fmtLong = (ts) => { const d = new Date(ts); return `${DAYSL[d.getDay()]} ${d.getDate()} ${MONL[d.getMonth()]}`; };
export const fmtMonth = (ts) => { const d = new Date(ts); return `${MONL[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function relDay(ts) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d0 - d) / 864e5);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
  if (diff < 7) return DAYS[new Date(ts).getDay()];
  return fmtShort(ts);
}
export function isoDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function weekStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.getTime(); }
export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return fmtShort(ts);
}
export function parseRange(txt) {
  // "8-12" -> [8,12]; "12" -> [12,12]; else null
  const m = String(txt || '').match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null; const a = parseFloat(m[1]); const b = m[2] ? parseFloat(m[2]) : a; return [a, b];
}
