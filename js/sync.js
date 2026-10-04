// Optional Google Sheet sync: POSTs unsynced records to a Google Apps Script web app.
// Uses Content-Type text/plain so the browser sends a "simple" request (no CORS preflight).
import * as db from './db.js';
import { setRow, sessionRow } from './data.js';

let busy = false, timer = null, listeners = new Set();
export const getUrl = () => db.kvGet('syncUrl', '');
export const setUrl = (u) => db.kvSet('syncUrl', (u || '').trim());
export const status = () => db.kvGet('syncStatus', {}) || {};
export function onStatus(fn) { listeners.add(fn); }
function setStatus(patch) { db.kvSet('syncStatus', { ...status(), ...patch }); listeners.forEach(f => f()); }

function queue() {
  const sessions = db.list('sessions').filter(s => !s.synced && (s.endedAt || s.imported));
  const ended = new Set(db.list('sessions').filter(s => s.endedAt || s.imported).map(s => s.id));
  const sets = db.list('sets').filter(s => !s.synced && ended.has(s.sessionId));
  return { sessions, sets };
}
export function pending() { const q = queue(); return q.sessions.length + q.sets.length; }

export async function syncNow() {
  const url = getUrl();
  if (!url || busy) return { skipped: true };
  if (!navigator.onLine) { setStatus({ lastError: 'Offline – will retry when online', lastTry: Date.now() }); return { offline: true }; }
  busy = true; setStatus({ syncing: true });
  try {
    let total = 0;
    for (let guard = 0; guard < 50; guard++) {
      const q = queue(); if (!q.sessions.length && !q.sets.length) break;
      const sess = q.sessions.slice(0, 100), sets = q.sets.slice(0, 300);
      const stamp = new Map([...sess, ...sets].map(r => [r.id, r.updatedAt]));
      const body = JSON.stringify({
        app: 'exlog', v: 1,
        sessions: sess.map(s => ({ ...sessionRow(s), deleted: !!s.deleted, updated_at: new Date(s.updatedAt || Date.now()).toISOString() })),
        sets: sets.map(s => ({ ...setRow(s), deleted: !!s.deleted, updated_at: new Date(s.updatedAt || Date.now()).toISOString() })),
      });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let j; try { j = await res.json(); } catch (e) { throw new Error('Unexpected reply (is the web app deployed for "Anyone"?)'); }
      if (!j.ok) throw new Error(j.error || 'Sheet rejected the data');
      const okIds = new Set([...(j.sessions || []), ...(j.sets || [])]);
      for (const r of [...sess, ...sets]) {
        if (!okIds.has(r.id)) continue;
        const store = sess.includes(r) ? 'sessions' : 'sets';
        const cur = db.get(store, r.id); if (!cur || cur.updatedAt !== stamp.get(r.id)) continue; // edited meanwhile: resend later
        db.put(store, { ...cur, synced: true, everSynced: true });
        total++;
      }
      if (!okIds.size) throw new Error('Nothing acknowledged');
    }
    setStatus({ syncing: false, lastOk: Date.now(), lastError: null, lastCount: total });
    return { ok: true, total };
  } catch (e) {
    setStatus({ syncing: false, lastError: String(e.message || e), lastTry: Date.now() });
    return { error: String(e.message || e) };
  } finally { busy = false; }
}
let debounce = null;
export function soon(ms = 2500) { clearTimeout(debounce); debounce = setTimeout(() => { if (pending()) syncNow(); }, ms); }
export function start() {
  window.addEventListener('online', () => soon(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(1000); });
  clearInterval(timer); timer = setInterval(() => { if (getUrl() && pending()) syncNow(); }, 60000);
  soon(1500);
}
