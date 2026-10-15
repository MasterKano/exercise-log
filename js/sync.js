// Optional Google Sheet sync: POSTs unsynced records to a Google Apps Script web app,
// then GETs ?action=pull to merge remote changes (last-updatedAt-wins by id).
// Uses Content-Type text/plain so the browser sends a "simple" request (no CORS preflight).
import * as db from './db.js';
import { setRow, sessionRow, importPack, isPack } from './data.js';

let busy = false, timer = null, listeners = new Set();
export const getUrl = () => db.kvGet('syncUrl', '');
export const setUrl = (u) => { u = (u || '').trim(); if (u !== getUrl()) { db.kvSet('driveLoaded', 0); db.kvSet('lastPulledAt', ''); } return db.kvSet('syncUrl', u); };
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

function syncUrl(pathQ) {
  const url = getUrl(); if (!url) return '';
  return url + (url.includes('?') ? '&' : '?') + pathQ;
}
function parseTs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Date.parse(v); return Number.isFinite(n) ? n : 0;
}
function num(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function weekOf(pw) { const m = String(pw || '').match(/(\d+)/); return m ? +m[1] : null; }

function sessionFromPull(r) {
  const startedAt = parseTs(r.start_time) || parseTs(r.date) || Date.now();
  const durationSec = num(r.duration_s);
  const updatedAt = parseTs(r.updatedAt || r.updated_at) || Date.now();
  return {
    id: String(r.id),
    routineName: r.routine || '',
    week: weekOf(r.programme_week),
    startedAt,
    endedAt: durationSec != null ? startedAt + durationSec * 1000 : startedAt,
    durationSec,
    roundsDone: num(r.rounds_done),
    effort: num(r.effort),
    kneeBefore: num(r.knee_before),
    kneeAfter: num(r.knee_after),
    seriesName: r.series || null,
    seriesNum: num(r.session_no),
    title: r.title || r.routine || '',
    notes: r.notes || '',
    deleted: !!r.deleted,
    updatedAt,
    synced: true,
    everSynced: true,
  };
}
function setFromPull(r) {
  const updatedAt = parseTs(r.updatedAt || r.updated_at) || Date.now();
  const setNo = num(r.set_no);
  return {
    id: String(r.id),
    sessionId: String(r.session_id || ''),
    exerciseId: r.exercise_id || null,
    exerciseName: r.exercise || '',
    date: parseTs(r.date) || parseTs(r.start_time) || Date.now(),
    order: setNo ?? 0,
    setNo,
    round: num(r.round),
    block: r.block || null,
    weight: num(r.weight_kg),
    reps: num(r.reps),
    rir: num(r.rir),
    rpe: num(r.rpe),
    timeSec: num(r.time_s),
    flights: num(r.flights),
    hr: num(r.avg_hr),
    variant: r.variant || null,
    note: r.notes || '',
    deleted: !!r.deleted,
    updatedAt,
    synced: true,
    everSynced: true,
  };
}

function mergePulled(store, mapped) {
  const cur = db.get(store, mapped.id);
  if (!cur) { db.put(store, mapped); return 'add'; }
  if ((mapped.updatedAt || 0) > (cur.updatedAt || 0)) {
    // Remote wins: overlay mapped fields onto local so local-only keys (routineId, kind, …) survive when remote omits them.
    db.put(store, { ...cur, ...mapped, synced: true, everSynced: true });
    return 'update';
  }
  return null;
}

export async function pullNow() {
  const url = getUrl(); if (!url) return { skipped: true };
  if (!navigator.onLine) return { offline: true };
  const since = db.kvGet('lastPulledAt', '') || '';
  const res = await fetch(syncUrl('action=pull' + (since ? '&since=' + encodeURIComponent(since) : '')), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let j; try { j = await res.json(); } catch (e) { throw new Error('Unexpected reply (redeploy the script as a new version, see SETUP.md)'); }
  if (!j.ok) throw new Error(j.error || 'Pull failed');
  let added = 0, updated = 0;
  for (const r of j.sessions || []) {
    if (!r || r.id == null || r.id === '') continue;
    const m = mergePulled('sessions', sessionFromPull(r)); if (m === 'add') added++; else if (m === 'update') updated++;
  }
  for (const r of j.sets || []) {
    if (!r || r.id == null || r.id === '') continue;
    const m = mergePulled('sets', setFromPull(r)); if (m === 'add') added++; else if (m === 'update') updated++;
  }
  const pulledAt = new Date().toISOString();
  db.kvSet('lastPulledAt', pulledAt);
  return { ok: true, added, updated, pulledAt, n: (j.sessions || []).length + (j.sets || []).length };
}

export async function syncNow() {
  const url = getUrl();
  if (!url || busy) return { skipped: true };
  if (!navigator.onLine) { setStatus({ lastError: 'Offline – will retry when online', lastTry: Date.now() }); return { offline: true }; }
  busy = true; setStatus({ syncing: true });
  try {
    if (!db.kvGet('driveLoaded')) await autoLoad();
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
    const pulled = await pullNow();
    setStatus({ syncing: false, lastOk: Date.now(), lastError: null, lastCount: total, lastPull: pulled.pulledAt || null, lastPullN: pulled.n || 0 });
    return { ok: true, total, pulled };
  } catch (e) {
    setStatus({ syncing: false, lastError: String(e.message || e), lastTry: Date.now() });
    return { error: String(e.message || e) };
  } finally { busy = false; }
}
let debounce = null;
// Always run sync when a URL is set (push pending, then pull) — app open, back online, after workout, Sync now.
export function soon(ms = 2500) { clearTimeout(debounce); debounce = setTimeout(() => { if (getUrl()) syncNow(); }, ms); }
export function start() {
  window.addEventListener('online', () => soon(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(1000); });
  clearInterval(timer); timer = setInterval(() => { if (getUrl()) syncNow(); }, 60000);
  soon(1500);
}

// "Load my full file from Drive": GET <web app URL>?action=import. Code.gs reads exercise-programmes-import.json from
// your Drive and returns it. A plain GET with no custom headers is a "simple" request (no CORS preflight), like the POST above.
// New device: first sync (or after saving a URL) loads the private programmes file once, then the normal pull fetches history.
export async function autoLoad(force) {
  if (!force && db.kvGet('driveLoaded')) return { skipped: true };
  try {
    const r = await loadFromDrive(); window.__lastImport = r;
    db.kvSet('driveLoaded', Date.now()); setStatus({ driveError: null }); return r;
  } catch (e) { const m = String(e.message || e); setStatus({ driveError: m }); return { error: m }; }
}
export async function loadFromDrive() {
  const url = getUrl(); if (!url) throw new Error('Save your Apps Script web app URL first');
  if (!navigator.onLine) throw new Error('You are offline');
  const res = await fetch(syncUrl('action=import'), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let j; try { j = await res.json(); } catch (e) { throw new Error('Unexpected reply (redeploy the script as a new version, see SETUP.md)'); }
  if (j && j.ok === false) throw new Error(j.error || 'The script could not read the file');
  if (j && j.app === 'exlog' && j.message && !j.pack) throw new Error('The deployed script is the old version: redeploy it as a new version (SETUP.md)');
  const pack = j && j.pack ? j.pack : j;
  if (!isPack(pack)) throw new Error('The Drive file is not an Exercise Log programmes file');
  return { ...(await importPack(pack)), file: j.name || null, fileUpdated: j.updated || null };
}
