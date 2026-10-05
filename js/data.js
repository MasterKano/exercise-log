// Domain data: seed + user data, queries, hints, summary, CSV.
import * as db from './db.js';
import { uid, num, parseRange, weekStart, isoDate, fmtNum } from './util.js';
import { STARTERS } from './starters.js';

export let SEED = null;
let BASE = null;
const seedEx = new Map(), seedRt = new Map(), seedSeries = new Map(), seedProg = new Map(), seedWu = new Map();
const progEx = new Set();
const CONTENT_KEYS = ['exercises', 'routines', 'series', 'programmes', 'warmups'];

// One-sentence helper text shown wherever RIR / RPE is logged or picked.
export const FIELD_HELP = {
  rir: 'Reps in reserve: how many more good reps you could have done before failure (0 = none left).',
  rpe: 'Rate of perceived exertion: how hard the effort felt from 1 (very easy) to 10 (maximal).',
};
export const RPE_MIN = 1, RPE_MAX = 10;
export const clampRpe = (v) => v == null || isNaN(v) ? null : Math.min(RPE_MAX, Math.max(RPE_MIN, v));

export async function loadSeed() {
  const r = await fetch('./data/seed.json');
  BASE = await r.json();
  addStarters(BASE);
  applyPacks();
}
// Built-in starter content (e.g. Norwegian 4x4) is also bundled in starters.js: anything missing from seed.json
// (say, a seed cached by an older version) is added, so it always shows up as a built-in routine.
function addStarters(base) {
  for (const k of ['exercises', 'routines']) { base[k] = base[k] || []; for (const x of STARTERS[k] || []) if (!base[k].some(y => y.id === x.id)) base[k].push(x); }
  base.groupOrder = base.groupOrder || []; for (const g of STARTERS.groupOrder || []) if (!base.groupOrder.includes(g)) base.groupOrder.push(g);
}
export const starterIds = () => ({ exercises: (STARTERS.exercises || []).map(x => x.id), routines: (STARTERS.routines || []).map(x => x.id) });
// Content packs (imported programme files) live in kv as 'pack:<id>' and are merged over the built-in seed,
// so imported routines/exercises behave exactly like built-in ones (and survive offline / backups).
export const installedPacks = () => db.list('kv').filter(r => r.k.startsWith('pack:') && r.v).map(r => r.v).sort((a, b) => (a.importedAt || 0) - (b.importedAt || 0));
export function applyPacks() {
  // imported content is listed first (a later pack overrides an earlier one with the same id), then the built-in starter items
  const maps = {}; for (const k of CONTENT_KEYS) maps[k] = new Map();
  const S = { ...BASE, groupOrder: [], libraryNotes: [], rotation: BASE.rotation || [] };
  for (const p of installedPacks()) {
    const c = p.content || {};
    for (const k of CONTENT_KEYS) for (const x of c[k] || []) if (x && x.id) { maps[k].delete(x.id); maps[k].set(x.id, x); }
    if (Array.isArray(c.rotation) && c.rotation.length) S.rotation = c.rotation;
    for (const g of c.groupOrder || []) if (!S.groupOrder.includes(g)) S.groupOrder.push(g);
    if (c.libraryNote) S.libraryNotes.push(c.libraryNote);
  }
  for (const k of CONTENT_KEYS) for (const x of BASE[k] || []) if (!maps[k].has(x.id)) maps[k].set(x.id, x);
  for (const g of BASE.groupOrder || []) if (!S.groupOrder.includes(g)) S.groupOrder.push(g);
  if (BASE.libraryNote) S.libraryNotes.push(BASE.libraryNote);
  for (const k of CONTENT_KEYS) S[k] = [...maps[k].values()];
  SEED = S;
  for (const m of [seedEx, seedRt, seedSeries, seedProg, seedWu]) m.clear();
  SEED.exercises.forEach(e => seedEx.set(e.id, e));
  SEED.routines.forEach(e => seedRt.set(e.id, e));
  SEED.series.forEach(e => seedSeries.set(e.id, e));
  SEED.programmes.forEach(e => seedProg.set(e.id, e));
  SEED.warmups.forEach(e => seedWu.set(e.id, e));
  progEx.clear();
  for (const r of SEED.routines) if (r.kind === 'program') for (const b of r.blocks || []) for (const it of (b.items || [b])) if (it.ex) progEx.add(it.ex);
}
export const isProgrammeExercise = (id) => progEx.has(id);
export const series = (id) => seedSeries.get(id);
export const programme = (id) => seedProg.get(id);
export const warmup = (id) => seedWu.get(id);
export const allProgrammes = () => SEED.programmes;
export const isSeedExercise = (id) => seedEx.has(id);
export const isSeedRoutine = (id) => seedRt.has(id);

// ---------------- exercises
export function exercise(id) {
  const o = db.get('exercises', id);
  if (o && !o.deleted) return o;
  return seedEx.get(id) || (o ? o : null);
}
export function allExercises() {
  const out = new Map();
  for (const e of SEED.exercises) out.set(e.id, e);
  for (const e of db.list('exercises')) { if (e.deleted) out.delete(e.id); else out.set(e.id, e); }
  return [...out.values()];
}
export function saveExercise(e) { e.updatedAt = Date.now(); return db.put('exercises', e); }
export function myNotes(id) { return (db.kvGet('exnotes', {}) || {})[id] || ''; }
export function setMyNotes(id, txt) { const n = { ...(db.kvGet('exnotes', {}) || {}) }; n[id] = txt; return db.kvSet('exnotes', n); }
export function equipLabel(eq) { return ({ kb: 'kettlebell', db: 'dumbbell', bb: 'barbell', machine: 'machine/cable', plate: 'plates' })[eq] || ''; }

// ---------------- routines
export function routine(id) {
  const o = db.get('routines', id);
  if (o && !o.deleted) return o;
  return seedRt.get(id) || null;
}
export function allRoutines() {
  const out = new Map();
  for (const r of SEED.routines) out.set(r.id, r);
  for (const r of db.list('routines')) { if (r.deleted) out.delete(r.id); else out.set(r.id, r); }
  return [...out.values()];
}
export function saveRoutine(r) { r.updatedAt = Date.now(); return db.put('routines', r); }
export function routineCount(r) {
  if (r.kind === 'circuit' || r.kind === 'straight') return (r.items || []).length;
  if (r.kind === 'program') return r.blocks.reduce((a, b) => a + (b.items ? b.items.length : 1), 0);
  if (r.kind === 'ladder') return r.sequences.length;
  if (r.kind === 'intervals') return 1;
  return 0;
}
// ---------------- interval sessions (Norwegian 4x4): warm-up, N x (hard interval [+ recovery]), cool-down
export function ivPhases(cfg) {
  const ph = [{ t: 'warm', sec: cfg.warmupSec }];
  for (let i = 1; i <= cfg.count; i++) { ph.push({ t: 'work', n: i, sec: cfg.workSec }); if (i < cfg.count) ph.push({ t: 'rec', n: i, sec: cfg.recoverySec }); }
  ph.push({ t: 'cool', sec: cfg.cooldownSec });
  return ph.filter(p => p.sec > 0);
}
export const ivTotal = (cfg) => ivPhases(cfg).reduce((a, p) => a + p.sec, 0);
export const fmtMin = (sec) => (sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min` : `${sec / 60} min`);
export function routineMeta(r) {
  if (r.kind === 'ladder') return `${r.subtitle} · for-time ladder`;
  if (r.kind === 'followalong') { const n = nextSeriesNum(r.series); const s = series(r.series).sessions[n - 1]; return `Next: #${n} ${s.title}`; }
  if (r.kind === 'program') return `${r.subtitle} · Week ${progWeek(r.programme)} of 4`;
  if (r.kind === 'intervals') return `${r.intervals.count} × ${fmtMin(r.intervals.workSec)} hard · ~${Math.round(ivTotal(r.intervals) / 60)} min`;
  const n = routineCount(r); return `${r.subtitle ? r.subtitle + ' · ' : ''}${n} exercise${n === 1 ? '' : 's'}`;
}
export const getRotation = () => (db.kvGet('rotation', null) || SEED.rotation || []).filter(id => routine(id));
export const setRotation = (ids) => db.kvSet('rotation', ids);
export function nextInRotation() {
  const rot = getRotation(); if (!rot.length) return null;
  const last = sessions().find(s => rot.includes(s.routineId));
  if (!last) return rot[0];
  return rot[(rot.indexOf(last.routineId) + 1) % rot.length];
}
export function lastSessionOf(routineId) { return sessions().find(s => s.routineId === routineId) || null; }

// programme week tracking
export function progWeek(pid) { return (db.kvGet('progWeek', {}) || {})[pid] || 1; }
export function setProgWeek(pid, w) { const m = { ...(db.kvGet('progWeek', {}) || {}) }; m[pid] = Math.max(1, Math.min(4, w)); return db.kvSet('progWeek', m); }
export function maybeAdvanceWeek(pid) {
  const p = programme(pid); if (!p) return false;
  const w = progWeek(pid); if (w >= 4) return false;
  const changedAt = (db.kvGet('progWeekAt', {}) || {})[pid] || 0;
  const train = p.days.filter(d => !d.endsWith('-rec'));
  const done = train.every(d => sessions().some(s => s.routineId === d && s.week === w && s.startedAt >= changedAt));
  if (done) { setProgWeek(pid, w + 1); const m = { ...(db.kvGet('progWeekAt', {}) || {}) }; m[pid] = Date.now(); db.kvSet('progWeekAt', m); return true; }
  return false;
}

// follow-along
export function nextSeriesNum(sid) {
  const last = sessions().find(s => s.series === sid);
  const total = series(sid).sessions.length;
  return last ? (last.seriesNum % total) + 1 : 1;
}
export function seriesDone(sid) { const set = new Set(); sessions().forEach(s => { if (s.series === sid) set.add(s.seriesNum); }); return set; }

// ---------------- sessions & sets
export function sessions() {
  return db.list('sessions').filter(s => !s.deleted).sort((a, b) => b.startedAt - a.startedAt);
}
export function setsOf(sessionId) {
  return db.list('sets').filter(s => s.sessionId === sessionId && !s.deleted).sort((a, b) => a.order - b.order);
}
export function saveSession(s) { s.updatedAt = Date.now(); s.synced = false; return db.put('sessions', s); }
export function saveSet(s) { s.updatedAt = Date.now(); s.synced = false; return db.put('sets', s); }
export function deleteSet(s) {
  if (s.everSynced) { s.deleted = true; return saveSet(s); }
  return db.del('sets', s.id);
}
export function deleteSession(sess) {
  for (const st of setsOf(sess.id)) deleteSet(st);
  if (sess.everSynced) { sess.deleted = true; return saveSession(sess); }
  return db.del('sessions', sess.id);
}
// exercise history newest first: [{session, sets}]
export function exerciseHistory(exId, excludeSessionId = null) {
  const bySess = new Map();
  for (const st of db.list('sets')) {
    if (st.deleted || st.exerciseId !== exId || st.sessionId === excludeSessionId) continue;
    if (!bySess.has(st.sessionId)) bySess.set(st.sessionId, []);
    bySess.get(st.sessionId).push(st);
  }
  const out = [];
  for (const [sid, sets] of bySess) {
    const sess = db.get('sessions', sid);
    if (!sess || sess.deleted) continue;
    out.push({ session: sess, sets: sets.sort((a, b) => a.order - b.order) });
  }
  return out.sort((a, b) => (b.session.startedAt - a.session.startedAt));
}
export function lastSets(exId, excludeSessionId) { const h = exerciseHistory(exId, excludeSessionId); return h.length ? h[0] : null; }
export function lastWeekSets(exId, routineId, week, excludeSessionId) {
  const h = exerciseHistory(exId, excludeSessionId);
  return h.find(x => x.session.routineId === routineId && x.session.week === week - 1) || h.find(x => x.session.routineId === routineId) || h[0] || null;
}
export function setSummary(sets) {
  // "45 kg × 5, 6, 6" when weight constant, else "45×5, 50×6"
  if (!sets || !sets.length) return '';
  const ws = sets.map(s => s.weight), same = ws.every(w => w === ws[0]);
  const part = (s) => {
    const bits = [];
    if (s.reps != null) bits.push(String(s.reps));
    if (s.timeSec != null) bits.push(`${s.timeSec} s`);
    if (s.flights != null) bits.push(`${fmtNum(s.flights)} fl`);
    return bits.join(' ');
  };
  if (same && ws[0] != null) { const r = sets.map(part).filter(Boolean); return `${fmtNum(ws[0])} kg${r.length ? ' × ' + r.join(', ') : ''}`; }
  return sets.map(s => (s.weight != null ? `${fmtNum(s.weight)}${s.reps != null || s.timeSec != null ? '×' : ' kg'}` : '') + part(s)).join(', ');
}

// ---------------- weights & hints
export const equipment = () => ({ ...SEED.equipment, ...(db.kvGet('equipment', {}) || {}) });
// starter weight when an exercise has no history (kettlebells: the lightest bell)
export function starterWeight(eq) {
  if (eq === 'kb') return equipment().kb.slice().sort((a, b) => a - b)[0] ?? 12;
  return ({ db: 10, bb: 20, machine: 20, plate: 10 })[eq] ?? null;
}
export const maxWeight = (eq) => ({ db: 80, bb: 300, machine: 250, plate: 200 })[eq] ?? 200;
export function snapWeight(eq, w) {
  if (w == null) return null;
  if (eq === 'kb') { const bells = equipment().kb; return bells.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), bells[0]); }
  const st = eq ? weightStep(eq) : 0.5; return Math.round(Math.round(w / st) * st * 100) / 100;
}
export function weightStep(eq) { const e = equipment(); return eq === 'db' ? e.dbStep : eq === 'bb' ? e.bbStep : eq === 'machine' ? e.machineStep : eq === 'plate' ? e.plateStep : 1; }
export function stepWeight(eq, w, dir) {
  w = w || 0;
  if (eq === 'kb') {
    const bells = equipment().kb.slice().sort((a, b) => a - b);
    if (dir > 0) return bells.find(b => b > w) ?? w + 4;
    const lower = bells.filter(b => b < w); return lower.length ? lower[lower.length - 1] : Math.max(0, w - 4);
  }
  const st = weightStep(eq);
  const v = Math.round((w + dir * st) / st) * st; return Math.max(0, Math.round(v * 100) / 100);
}
function roundUpTo(eq, v) {
  if (eq === 'kb') return equipment().kb.slice().sort((a, b) => a - b).find(b => b >= v) ?? null;
  const st = weightStep(eq); return Math.ceil(v / st - 1e-9) * st;
}
export function hint(ex, target, last) {
  // Suggestion only. Never changes anything.
  if (!last || !ex.fields.includes('weight')) return null;
  const ws = last.sets.map(s => s.weight).filter(w => w != null);
  if (!ws.length) return null;
  const base = Math.max(...ws), eq = ex.equip;
  const inten = (target && target.intensity) || '';
  let m = inten.match(/\+(\d+)-(\d+)%/);
  if (m) {
    const lo = roundUpTo(eq, base * (1 + m[1] / 100)), hi = base * (1 + m[2] / 100);
    const sug = lo != null && lo <= hi + 1e-9 ? lo : stepWeight(eq, base, +1);
    return `Programme: ${m[0]} on last (${fmtNum(base)} kg) → try ${fmtNum(sug)} kg`;
  }
  if (/same weights/i.test(inten)) return `Programme: same weight as last week (${fmtNum(base)} kg)`;
  if (/add weight/i.test(inten)) return `Programme: add weight → try ${fmtNum(stepWeight(eq, base, +1))} kg`;
  const range = parseRange(target && target.reps);
  if (!range) return null;
  const top = range[1];
  const rirM = inten.match(/R[IE]R (\d+)(?:-(\d+))?/); const rirMax = rirM ? +(rirM[2] || rirM[1]) : 3;
  const allTop = last.sets.every(s => s.reps != null && s.reps >= top);
  const lowRir = last.sets.every(s => s.rir == null || s.rir <= rirMax);
  if (allTop && lowRir) {
    const nx = stepWeight(eq, base, +1);
    return `Hint: hit ${top} reps on every set last time → try ${fmtNum(nx)} kg`;
  }
  return null;
}

// ---------------- summary
function bestScore(st) { if (st.block && /^Interval \d/.test(st.block)) return st.flights || 0; return st.weight != null ? st.weight * 1000 + (st.reps || 0) : st.reps != null ? st.reps : st.timeSec || 0; }
export function weeklySummary(now = Date.now()) {
  const ws = weekStart(now);
  const all = sessions().filter(s => s.endedAt || s.imported);
  const wk = all.filter(s => s.startedAt >= ws);
  const total = wk.reduce((a, s) => a + (s.durationSec || 0), 0);
  // new bests: exercises whose best score this week beats everything before this week
  const before = new Map(), during = new Map();
  for (const st of db.list('sets')) {
    if (st.deleted) continue; const sess = db.get('sessions', st.sessionId); if (!sess || sess.deleted) continue;
    const m = sess.startedAt >= ws ? during : before; const sc = bestScore(st);
    m.set(st.exerciseId, Math.max(m.get(st.exerciseId) || 0, sc));
  }
  let bests = 0; for (const [id, sc] of during) if (before.has(id) && sc > before.get(id)) bests++;
  // streak in weeks with >= 1 session
  const weeks = new Set(all.map(s => weekStart(s.startedAt)));
  let streak = 0, w = ws; if (!weeks.has(w)) w = weekStart(ws - 3 * 864e5);
  while (weeks.has(w)) { streak++; w = weekStart(w - 3 * 864e5); }
  return { sessions: wk.length, totalSec: total, bests, streak };
}

// ---------------- data migrations (run once per install, tracked in kv 'migrations')
// stair-rpe-1: Stair climb logs RPE (1-10) instead of reps. Built-in definitions come from seed.json, so only
// copies stored on the phone need fixing: an edited/custom stair exercise and exercises inside imported packs.
// Logged sets are never touched, so old stair sets (reps, flights, time) still show in history.
const isStair = (e) => !!e && (e.id === 'stair-climb' || /stair/i.test(e.name || ''));
export function stairFields(fields) {
  const f = (fields || []).map(x => (x === 'reps' ? 'rpe' : x));
  if (!f.includes('rpe')) f.push('rpe');
  return [...new Set(f)];
}
const sameArr = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
function fixStairList(list) {
  let n = 0;
  const out = (list || []).map(e => { if (!isStair(e) || e.deleted) return e; const f = stairFields(e.fields); if (sameArr(f, e.fields)) return e; n++; return { ...e, fields: f }; });
  return { out, n };
}
function migrateStairRpe() {
  let n = 0;
  for (const e of db.list('exercises')) {
    if (e.deleted || !isStair(e)) continue;
    const f = stairFields(e.fields);
    if (!sameArr(f, e.fields)) { saveExercise({ ...e, fields: f }); n++; }
  }
  for (const r of db.list('kv')) {
    if (!r.k.startsWith('pack:') || !r.v || !r.v.content) continue;
    const { out, n: m } = fixStairList(r.v.content.exercises);
    if (m) { db.put('kv', { k: r.k, v: { ...r.v, content: { ...r.v.content, exercises: out } } }); n += m; }
  }
  return n;
}
// rir-rpe-1: RPE replaces RIR everywhere except programme exercises whose programme prescribes RIR (or RER) targets,
// so those targets still match what you log. Field definitions only: logged RIR values stay in history as RIR.
const RIR_RE = /\bR[IE]R\b/;
export function rirTargetIds(routines) {
  const keep = new Set();
  for (const r of routines || []) {
    if (!r || r.kind !== 'program') continue;
    for (const b of r.blocks || []) for (const it of (b.items || [b])) if (it.ex && (it.weeks || []).some(w => w && RIR_RE.test(w.intensity || ''))) keep.add(it.ex);
  }
  return keep;
}
export const rirTargetExercises = () => rirTargetIds(SEED.routines);
const toRpe = (fields) => [...new Set((fields || []).map(x => (x === 'rir' ? 'rpe' : x)))];
function fixRirList(list, keep) {
  let n = 0;
  const out = (list || []).map(e => { if (!e || e.deleted || !(e.fields || []).includes('rir') || keep.has(e.id)) return e; n++; return { ...e, fields: toRpe(e.fields) }; });
  return { out, n };
}
function migrateRirToRpe() {
  const keep = rirTargetIds(SEED.routines); let n = 0;
  for (const e of db.list('exercises')) {
    if (e.deleted || !(e.fields || []).includes('rir') || keep.has(e.id)) continue;
    saveExercise({ ...e, fields: toRpe(e.fields) }); n++;
  }
  for (const r of db.list('kv')) {
    if (!r.k.startsWith('pack:') || !r.v || !r.v.content) continue;
    const k2 = new Set([...keep, ...rirTargetIds(r.v.content.routines)]);
    const { out, n: m } = fixRirList(r.v.content.exercises, k2);
    if (m) { db.put('kv', { k: r.k, v: { ...r.v, content: { ...r.v.content, exercises: out } } }); n += m; }
  }
  return n;
}
// starters-n4x4-1: make sure an existing install has the new built-in Norwegian 4x4 routine + exercise. Built-ins come
// from seed.json / starters.js (added by addStarters even if the cached seed is older); this also brings back a
// stored copy that was marked deleted. Nothing logged is touched, and it is NOT added to the rotation.
function migrateStarters() {
  let n = 0;
  for (const [store, list] of [['routines', STARTERS.routines || []], ['exercises', STARTERS.exercises || []]]) for (const x of list) {
    const cur = db.get(store, x.id);
    if (cur && cur.deleted) { db.del(store, x.id); n++; }
  }
  return n;
}
const MIGRATIONS = [['stair-rpe-1', migrateStairRpe], ['rir-rpe-1', migrateRirToRpe], ['starters-n4x4-1', migrateStarters]];
export async function runMigrations() {
  const done = new Set(db.kvGet('migrations', []) || []);
  const ran = [];
  for (const [id, fn] of MIGRATIONS) {
    if (done.has(id)) continue;
    try { ran.push([id, fn()]); done.add(id); } catch (e) { console.error('migration ' + id, e); }
  }
  if (ran.length) { db.kvSet('migrations', [...done]); await db.flush(); applyPacks(); }
  return ran;
}

// ---------------- history import (seed or content pack)
// Records get deterministic ids, and existing records (incl. ones you edited) are never overwritten,
// so importing the same history twice adds nothing.
export function importHistory(list, note) {
  const groups = new Map();
  for (const h of list || []) { const k = h.date + '|' + h.day; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
  let sessionsAdded = 0, setsAdded = 0, existing = 0;
  for (const [k, items] of groups) {
    const [date, day] = k.split('|'); const r = routine(day); const p = r && r.programme ? programme(r.programme) : null;
    const ts = new Date(date + 'T12:00:00').getTime();
    const sid = 'imp-' + date + '-' + day;
    let sess = db.get('sessions', sid);
    if (sess) existing++;
    else {
      sess = { id: sid, routineId: day, routineName: r ? (p ? `${r.name} · ${p.short}` : r.name) : day, kind: r ? r.kind : 'program', programme: r ? r.programme || null : null,
        week: items[0].week ?? null, startedAt: ts, endedAt: ts, durationSec: null, imported: true, notes: note || 'Imported history.' };
      saveSession(sess); sessionsAdded++;
    }
    let order = 0;
    for (const it of items) {
      const ex = exercise(it.ex);
      it.sets.forEach((s, i) => {
        const id = `imp-${date}-${it.ex}-${i + 1}`; const o = order++;
        if (db.get('sets', id)) return;
        saveSet({ id, sessionId: sess.id, exerciseId: it.ex, exerciseName: ex ? ex.name : it.ex, date: ts, order: o, setNo: i + 1,
          weight: s.weight ?? null, reps: s.reps ?? null, rir: null, rpe: null, timeSec: null, flights: null, variant: null,
          swappedFrom: it.swappedFrom || null, note: it.note, routineName: sess.routineName, week: sess.week });
        setsAdded++;
      });
    }
  }
  return { sessionsAdded, setsAdded, existing };
}
export function importSeedHistory() {
  if (db.kvGet('historyImported') || !(SEED.history || []).length) return 0;
  const r = importHistory(SEED.history, SEED.historyNote);
  db.kvSet('historyImported', Date.now());
  return r.setsAdded;
}

// ---------------- programme import file ("content pack")
export const isPack = (d) => d && d.app === 'exlog' && d.kind === 'content-pack';
export async function importPack(d) {
  if (!isPack(d)) throw new Error('Not an Exercise Log programmes file');
  if (!d.id || !d.content) throw new Error('The programmes file is incomplete');
  const before = { routines: new Set(SEED.routines.map(x => x.id)), exercises: new Set(SEED.exercises.map(x => x.id)) };
  const prev = db.kvGet('pack:' + d.id);
  const { history, ...rest } = d;
  if (rest.content && rest.content.exercises) {   // an older programmes file: apply the same field changes as the migrations
    const keep = rirTargetIds(rest.content.routines);
    rest.content = { ...rest.content, exercises: fixRirList(fixStairList(rest.content.exercises).out, keep).out };
  }
  db.kvSet('pack:' + d.id, { ...rest, history: history ? { note: history.note || null, skipped: history.skipped || [], count: (history.items || []).length } : null,
    importedAt: Date.now(), firstImportedAt: prev?.firstImportedAt || prev?.importedAt || Date.now() });
  applyPacks();
  // keep a customised rotation, but add the pack's suggested routines to it
  const rot = db.kvGet('rotation', null);
  if (rot && Array.isArray(d.content.rotation)) { const add = d.content.rotation.filter(id => !rot.includes(id)); if (add.length) db.kvSet('rotation', [...rot, ...add]); }
  const h = importHistory(history ? history.items : [], history ? history.note : null);
  db.kvSet('onboarded', Date.now());
  await db.flush();
  return { name: d.name || d.id, replaced: !!prev,
    routinesAdded: SEED.routines.filter(x => !before.routines.has(x.id)).length, exercisesAdded: SEED.exercises.filter(x => !before.exercises.has(x.id)).length,
    routines: (d.content.routines || []).length, exercises: (d.content.exercises || []).length, ...h };
}

// ---------------- CSV
export const CSV_COLS = ['record_type', 'id', 'session_id', 'date', 'start_time', 'routine', 'programme_week', 'block', 'exercise', 'exercise_id', 'swapped_from',
  'set_no', 'round', 'weight_kg', 'reps', 'rir', 'rpe', 'time_s', 'flights', 'avg_hr', 'variant', 'duration_s', 'rounds_done', 'effort', 'knee_before', 'knee_after',
  'series', 'session_no', 'title', 'ladder', 'notes'];
const csvCell = (v) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function sessionRow(s) {
  return { record_type: 'session', id: s.id, session_id: s.id, date: isoDate(s.startedAt), start_time: new Date(s.startedAt).toISOString(), routine: s.routineName,
    programme_week: s.week ? 'S' + s.week : '', duration_s: s.durationSec, rounds_done: s.roundsDone ?? s.rounds, effort: s.effort, knee_before: s.kneeBefore,
    knee_after: s.kneeAfter, series: s.seriesName, session_no: s.seriesNum, title: s.title,
    ladder: s.ladder ? s.ladder.map(l => `${l.name}: ${l.timeSec}s${l.weight ? ' @' + l.weight + 'kg' : ''} (${l.rungs}/${l.top})`).join('; ') : '', notes: s.notes };
}
export function setRow(st) {
  const sess = db.get('sessions', st.sessionId) || {};
  return { record_type: 'set', id: st.id, session_id: st.sessionId, date: isoDate(st.date || sess.startedAt), start_time: sess.startedAt ? new Date(sess.startedAt).toISOString() : '',
    routine: st.routineName || sess.routineName, programme_week: (st.week || sess.week) ? 'S' + (st.week || sess.week) : '', block: st.block, exercise: st.exerciseName,
    exercise_id: st.exerciseId, swapped_from: st.swappedFrom ? (exercise(st.swappedFrom)?.name || st.swappedFrom) : '', set_no: st.setNo, round: st.round,
    weight_kg: st.weight, reps: st.reps, rir: st.rir, rpe: st.rpe, time_s: st.timeSec, flights: st.flights, avg_hr: st.hr, variant: st.variant, notes: st.note };
}
export function buildCSV() {
  const rows = [CSV_COLS.join(',')];
  for (const s of sessions().slice().reverse()) {
    rows.push(CSV_COLS.map(c => csvCell(sessionRow(s)[c])).join(','));
    for (const st of setsOf(s.id)) rows.push(CSV_COLS.map(c => csvCell(setRow(st)[c])).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
export function backupJSON() {
  return JSON.stringify({ app: 'exlog', version: 1, exportedAt: new Date().toISOString(), sets: db.list('sets'), sessions: db.list('sessions'),
    exercises: db.list('exercises'), routines: db.list('routines'), kv: db.list('kv').filter(r => r.k !== 'active') }, null, 1);
}
export function parseImport(text) {
  let d; try { d = JSON.parse(text); } catch (e) { throw new Error('That file isn\'t valid JSON'); }
  if (!d || d.app !== 'exlog') throw new Error('Not an Exercise Log file');
  return d;
}
// mode 'replace' wipes this phone first; 'merge' keeps everything here and only adds records that are
// missing or newer in the backup (by updatedAt). Settings already on this phone win in a merge.
export async function restoreJSON(text, mode = 'merge') {
  const d = typeof text === 'string' ? parseImport(text) : text;
  if (isPack(d)) return { pack: await importPack(d) };
  if (mode === 'replace') await db.clearAll();
  let added = 0, updated = 0;
  for (const s of ['sets', 'sessions', 'exercises', 'routines']) for (const row of d[s] || []) {
    const cur = db.get(s, row.id);
    if (!cur) { db.put(s, row); added++; } else if ((row.updatedAt || 0) > (cur.updatedAt || 0)) { db.put(s, row); updated++; }
  }
  for (const row of d.kv || []) {
    if (row.k === 'active' || row.k === 'syncStatus') continue;
    const cur = db.get('kv', row.k);
    if (!cur) db.put('kv', row);
    else if (row.k.startsWith('pack:') && (row.v?.importedAt || 0) > (cur.v?.importedAt || 0)) db.put('kv', row);
  }
  db.kvSet('onboarded', Date.now());
  await db.flush();
  applyPacks();
  return { added, updated, total: (d.sets || []).length + (d.sessions || []).length };
}
export function pendingCount() {
  let n = 0; for (const s of db.list('sets')) if (!s.synced) n++; for (const s of db.list('sessions')) if (!s.synced && (s.endedAt || s.imported)) n++; return n;
}
export { uid, num };
