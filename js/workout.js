// Active session runner: circuits, straight sets, supersets/giant sets, programme weeks,
// warm-ups, for-time ladder, follow-along sessions. State lives in kv 'active' so a reload resumes.
import * as db from './db.js';
import * as D from './data.js';
import { esc, uid, num, fmtNum, fmtClock, parseClock, fmtDate, fmtDur, relDay } from './util.js';
import { ic, P, tick, on, openSheet, closeSheet, ask, confirmSheet, actionSheet, toast, go, A_COLOR } from './ui.js';
import { beepWarn, beepEnd, setWake, onTick, unlockAudio } from './timers.js';
import * as sync from './sync.js';
import { pickWheels, range, FMT, wheelValues } from './wheel.js';

export let A = null;
let renderFn = () => {};
export function setRender(f) { renderFn = f; }
export function loadActive() { A = db.kvGet('active', null); }
let persistT = null;
function persist(now = false) {
  clearTimeout(persistT);
  const doIt = () => { if (A) db.kvSet('active', A); else db.del('kv', 'active'); };
  if (now) doIt(); else persistT = setTimeout(doIt, 150);
}
const K = (b, it, r) => `${b.key}|${it.key}|${r}`;
const blk = (bkey) => A.blocks.find(b => b.key === bkey);
function findRow(key) { const [bk, ik, r] = key.split('|'); const b = blk(bk); return { b, it: b.items.find(i => i.key === ik), r: +r }; }
const now = () => Date.now();
export function elapsedSec(s = A) {
  if (!s) return 0; const paused = (s.pausedTotal || 0) + (s.pausedAt ? now() - s.pausedAt : 0);
  return Math.max(0, (now() - s.startedAt - paused) / 1000);
}

// ---------------------------------------------------------------- knee check-in
// default knee value: last logged (before: last "before"; after: today's "before" or last "after"), else average, else 0
function kneeDefault(phase) {
  if (phase === 'after' && A && A.kneeBefore != null) return A.kneeBefore;
  const k = phase === 'after' ? 'kneeAfter' : 'kneeBefore';
  const vals = D.sessions().map(s => s[k]).filter(v => v != null);
  return vals.length ? vals[0] : 0;
}
export function kneeSheet(phase, { notes = false, initial = null, title } = {}) {
  const v = initial ?? kneeDefault(phase);
  return pickWheels({ eyebrow: `Knee check-in · ${phase}`, title: title || (phase === 'before' ? 'How is the knee before you start?' : 'How is the knee now?'), cls: 'kneesheet',
    wheels: [{ id: 'knee', values: range(0, 10), value: v, label: 'Knee pain 0 to 10' }],
    bottom: `<div class="kscale"><span>0 = no pain</span><span>10 = worst</span></div>
    ${notes ? `<label class="field"><span>Session notes (optional)</span><textarea class="input" id="finNotes" rows="2" placeholder="How did it go?"></textarea></label>` : ''}
    <button class="btn-primary" data-act="kneeSave">${phase === 'before' ? 'Start' : phase === 'edit' ? 'Save' : 'Save session'}</button>
    <button class="btn-secondary mt8" data-act="kneeSkip">${phase === 'edit' ? 'Clear' : 'Skip check-in'}</button>` });
}
on('kneeSave', (el) => { const sh = el.closest('.sheet'); const n = sh.querySelector('#finNotes'); closeSheet({ knee: wheelValueOf(sh), notes: n ? n.value.trim() : '' }); });
on('kneeSkip', (el) => { const sh = el.closest('.sheet'); const n = sh.querySelector('#finNotes'); closeSheet({ knee: null, notes: n ? n.value.trim() : '' }); });

// ---------------------------------------------------------------- building a session
// ---- defaults for a new set: last logged value for that set -> average of the exercise's history -> starter value
const NUMF = ['weight', 'reps', 'rir', 'rpe', 'timeSec', 'flights'];
const FIELD_OF = { timeSec: 'time' };
function histAvg(exId) {
  const acc = {};
  for (const h of D.exerciseHistory(exId)) for (const st of h.sets) for (const f of NUMF) if (st[f] != null) (acc[f] = acc[f] || []).push(st[f]);
  const out = {}; for (const f in acc) out[f] = acc[f].reduce((a, b) => a + b, 0) / acc[f].length;
  return out;
}
// "5" -> 5, "8-12" -> 8 (bottom of the range), "3 each leg" / "5/arm" -> 3 / 5; "Max reps", "myorep", "30 sec" -> null
function targetReps(t) { const m = String((t && t.reps) || '').trim().match(/^(\d+)(?:\s*-\s*\d+)?(?:\s*(?:each (?:leg|side|arm)|\/(?:arm|leg|side)))?$/i); return m ? +m[1] : null; }
function targetSecs(t) { const m = String((t && t.reps) || '').match(/^(\d+)\s*sec/i); return m ? +m[1] : null; }
export function starterVal(ex, f, target, fields) {
  if (!fields.includes(FIELD_OF[f] || f)) return null;
  if (f === 'reps') return target && target.reps ? targetReps(target) : 10;
  if (f === 'weight') return D.starterWeight(ex.equip);
  if (f === 'rir') return 2;
  if (f === 'rpe') return 7;
  if (f === 'flights') return 15;
  if (f === 'timeSec') { const ts = targetSecs(target); if (ts) return ts; if (fields.includes('reps')) return null; return fields.includes('flights') ? 300 : 30; }
  return null;
}
function roundFor(ex, f, x) {
  if (x == null) return null;
  if (f === 'weight') return D.snapWeight(ex.equip, x);
  if (f === 'timeSec') return Math.round(x / 5) * 5;
  return Math.round(x);
}
function defaultVal(last, ex, f, r, target, fields) {
  const s = last && last.sets ? last.sets[r] : null;
  if (s && s[f] != null) return [s[f], 'last'];
  const a = last && last.avg ? last.avg[f] : null;
  if (a != null) return [roundFor(ex, f, a), 'avg'];
  const st = starterVal(ex, f, target, fields);
  return st == null ? [null, null] : [st, 'start'];
}
function snapshotLast(exId, routineId, week) {
  const l = week ? D.lastWeekSets(exId, routineId, week) : D.lastSets(exId);
  if (!l) return null;
  return { date: l.session.startedAt, week: l.session.week || null, routineId: l.session.routineId, avg: histAvg(exId),
    sets: l.sets.map(s => ({ weight: s.weight, reps: s.reps, rir: s.rir, rpe: s.rpe, timeSec: s.timeSec, flights: s.flights, variant: s.variant })) };
}
// defaults for "Log a set by hand" (set 1, no programme target)
export function defaultSet(exId) {
  const ex = D.exercise(exId); if (!ex) return { vals: {}, src: {} };
  const last = snapshotLast(exId); const vals = {}, src = {};
  for (const f of NUMF) { if (!ex.fields.includes(FIELD_OF[f] || f)) continue; const [x, s2] = defaultVal(last, ex, f, 0, null, ex.fields); vals[f] = x; if (s2) src[f] = s2; }
  return { vals, src };
}
function mkItem(key, exId, label, target, extra = {}) {
  const ex = D.exercise(exId);
  return { key, exId, origExId: null, label, target: target || null, fields: extra.fields || null, rest: extra.rest ?? null, eachSide: extra.eachSide ?? ex?.eachSide ?? false,
    cues: extra.cues || [], defs: extra.defs || [], extra: !!extra.extra, last: null };
}
function buildBlocks(r, week, rounds) {
  const blocks = [];
  if (r.kind === 'circuit') {
    blocks.push({ key: 'b0', type: 'circuit', label: '', name: r.name, rounds: rounds || r.rounds || 3,
      items: r.items.filter(it => D.exercise(it.ex)).map((it, i) => mkItem('i' + i, it.ex, String(i + 1), { reps: it.reps }, { rest: it.rest ?? D.exercise(it.ex)?.rest ?? 75, eachSide: it.eachSide })) });
  } else if (r.kind === 'straight') {
    let i = 0, letter = 0;
    for (const it of r.items) {
      const ex = D.exercise(it.ex); if (!ex) continue;
      const item = mkItem('i' + i, it.ex, '', { reps: it.reps || '', sets: it.sets || 3, restSec: it.rest ?? ex.rest ?? 90 }, { rest: it.rest ?? ex.rest ?? 90 });
      const prev = blocks[blocks.length - 1];
      if (it.withPrev && prev) { prev.type = 'superset'; prev.name = 'Superset'; prev.items.push(item); }
      else blocks.push({ key: 'b' + blocks.length, type: 'single', label: String.fromCharCode(65 + letter++), rounds: it.sets || 3, items: [item] });
      i++;
    }
    blocks.forEach(b => b.items.forEach((it, j) => { it.label = b.items.length > 1 ? b.label + (j + 1) : b.label; }));
  } else if (r.kind === 'program') {
    r.blocks.forEach((b, bi) => {
      const items = (b.items || [b]).map((it, ii) => {
        const t = it.weeks ? it.weeks[week - 1] : null;
        return mkItem('i' + ii, it.ex, it.label, t, { fields: it.fields, cues: it.cues, defs: it.defs, extra: it.extra, rest: t ? t.restSec : null });
      });
      const t0 = items[0].target;
      const rounds = b.roundsUnspecified ? 3 : t0 ? t0.sets : 3;
      blocks.push({ key: 'b' + bi, type: b.type, label: b.label, name: b.name || '', tag: b.tag || null, rounds, roundsUnspecified: !!b.roundsUnspecified,
        myorep: !!b.myorep, extra: !!b.extra, items });
    });
  }
  return blocks;
}
function prefillBlock(b) {
  for (const it of b.items) {
    it.last = snapshotLast(it.exId, A.routineId, A.week);
    for (let r = 0; r < b.rounds; r++) prefillRow(b, it, r);
  }
}
function prefillRow(b, it, r, force = false) {
  const k = K(b, it, r); if (A.vals[k] && (A.vals[k].done || !force)) return;
  const ex = D.exercise(it.exId) || { fields: ['reps'], variants: [] }; const fields = fieldsOf(it);
  const ls = it.last ? it.last.sets : [];
  const v = { weight: null, reps: null, rir: null, rpe: null, timeSec: null, flights: null, done: false, src: {} };
  for (const f of NUMF) { const [x, s2] = defaultVal(it.last, ex, f, r, it.target, fields); v[f] = x; if (s2) v.src[f] = s2; }
  v.variant = ls[r]?.variant ?? ls[ls.length - 1]?.variant ?? (ex.variants && ex.variants[0]) ?? null;
  A.vals[k] = v;
}
// a value the user picked on one set is copied to the later unticked sets of that exercise, unless those were set by hand
function setVal(b, it, r, f, x) {
  const v = A.vals[K(b, it, r)]; if (!v) return 0;
  v[f] = x; (v.src = v.src || {})[f] = 'user';
  if (v.done) writeSet(b, it, r);
  let n = 0;
  for (let rr = r + 1; rr < b.rounds; rr++) {
    const w = A.vals[K(b, it, rr)]; if (!w || w.done || (w.src && w.src[f] === 'user')) continue;
    w[f] = x; (w.src = w.src || {})[f] = 'copy'; n++;
  }
  return n;
}
const isPre = (v, f) => !!(v && !v.done && v.src && v.src[f] && v.src[f] !== 'user');
export function fieldsOf(it) { const ex = D.exercise(it.exId); return it.fields || (ex ? ex.fields : ['reps']); }

export async function startRoutine(rid, opts = {}) {
  unlockAudio();
  if (A) {
    const v = await actionSheet('A workout is already in progress', [{ label: 'Resume it', v: 'resume' }, { label: 'Discard it and start new', v: 'discard', danger: true }]);
    if (v === 'resume') return go('#/workout');
    if (v !== 'discard') return;
    discardActive();
  }
  const r = D.routine(rid); if (!r) return toast('Routine not found');
  const k = await kneeSheet('before');
  if (!k) return; // sheet dismissed: don't start
  const week = r.kind === 'program' ? D.progWeek(r.programme) : null;
  const prog = r.programme ? D.programme(r.programme) : null;
  A = { id: uid('ses'), routineId: r.id, kind: r.kind, name: r.name, subtitle: r.subtitle || '', title: prog ? `${r.name} · ${prog.short}` : r.name,
    programme: r.programme || null, week, startedAt: now(), pausedTotal: 0, pausedAt: null, kneeBefore: k.knee, vals: {}, blocks: [], ui: { open: {}, rounds: {} },
    rest: null, sw: null };
  if (r.kind === 'ladder') {
    A.lad = { idx: 0, restBetween: r.restBetween, seqs: r.sequences.map(s => ({ ...s, top: r.top, rungs: Array(r.top).fill(false), startAt: null, accum: 0, running: false, done: false, timeSec: null,
      weight: ([s.a, s.b].map(id => (D.lastSets(id) || { sets: [] }).sets.map(x => x.weight).find(w => w != null)).find(w => w != null)) ?? null })) };
  } else if (r.kind === 'followalong') {
    const sr = D.series(r.series); const n = opts.seriesNum || D.nextSeriesNum(r.series); const s = sr.sessions[n - 1];
    A.title = `${sr.short} · Workout ${n}`; A.subtitle = s.title;
    A.fa = { sid: sr.id, num: n, startAt: null, accum: 0, running: false, manualSec: null, rounds: 0, effort: null, notes: '', splits: [], forTimeSec: null, src: {} };
    faDefaults(A.fa);
  } else {
    A.blocks = buildBlocks(r, week, opts.rounds);
    A.blocks.forEach(prefillBlock);
    if (r.kind === 'program' && r.warmup) A.warm = { id: r.warmup, done: [], open: false };
  }
  persist(true);
  go('#/workout');
}
function discardActive() {
  if (!A) return;
  for (const v of Object.values(A.vals || {})) if (v.setId) { const s = db.get('sets', v.setId); if (s) D.deleteSet(s); }
  for (const s of (A.lad?.seqs || [])) for (const id of (s.setIds || [])) { const st = db.get('sets', id); if (st) D.deleteSet(st); }
  A = null; persist(true); setWake(false);
}

// ---------------------------------------------------------------- set records
function writeSet(b, it, r) {
  const k = K(b, it, r), v = A.vals[k], ex = D.exercise(it.exId), f = fieldsOf(it);
  if (!v.setId) v.setId = uid('set');
  const has = (x) => f.includes(x);
  D.saveSet({ id: v.setId, sessionId: A.id, exerciseId: it.exId, exerciseName: ex.name, date: v.tickedAt || now(),
    order: A.blocks.indexOf(b) * 1000 + r * 20 + b.items.indexOf(it), setNo: r + 1, round: b.type === 'circuit' ? r + 1 : null,
    block: b.type === 'circuit' ? `Round ${r + 1}` : (it.label || b.label || ''), weight: has('weight') ? v.weight : null, reps: has('reps') ? v.reps : null,
    rir: has('rir') ? v.rir : null, rpe: has('rpe') ? v.rpe : null, timeSec: has('time') ? v.timeSec : null, flights: has('flights') ? v.flights : null,
    variant: has('variant') ? v.variant : null, swappedFrom: it.origExId || null, routineName: A.title, week: A.week || null, note: null });
}
function orderedRows() {
  const rows = [];
  for (const b of A.blocks) {
    if (b.type === 'circuit' || b.type === 'superset' || b.type === 'giant') { for (let r = 0; r < b.rounds; r++) for (const it of b.items) rows.push({ b, it, r }); }
    else for (const it of b.items) for (let r = 0; r < b.rounds; r++) rows.push({ b, it, r });
  }
  return rows;
}
function restAfter(b, it) {
  const ex = D.exercise(it.exId);
  const lastInRound = b.items.indexOf(it) === b.items.length - 1;
  if (b.type === 'circuit') return it.rest || ex?.rest || 75;
  if (b.type === 'superset' || b.type === 'giant') {
    if (!lastInRound) return 30; // programme: "very little rest between movements (30-45 sec maximum)"
    return it.target?.restSec || it.rest || 90; // "longer rest after the sequence (usually 90 sec)"
  }
  return it.target?.restSec || it.rest || ex?.rest || 90;
}
function valSummary(it, v) {
  const f = fieldsOf(it), bits = [];
  if (f.includes('weight') && v.weight != null) bits.push(`${fmtNum(v.weight)} kg`);
  if (f.includes('reps') && v.reps != null) bits.push(`${fmtNum(v.reps)}`);
  if (f.includes('time') && v.timeSec != null) bits.push(fmtClock(v.timeSec));
  if (f.includes('flights') && v.flights != null) bits.push(`${fmtNum(v.flights)} flights`);
  return bits.join(' × ');
}
function startRest(sec, nextRow) {
  if (!sec) { A.rest = null; return; }
  const nx = nextRow ? D.exercise(nextRow.it.exId) : null;
  A.rest = { startAt: now(), endAt: now() + sec * 1000, dur: sec, next: nx ? nx.name : '', nextVal: nextRow ? valSummary(nextRow.it, A.vals[K(nextRow.b, nextRow.it, nextRow.r)] || {}) : '', b10: false, b0: false };
}
function toggleTick(key) {
  const { b, it, r } = findRow(key); const v = A.vals[key]; if (!v) return;
  if (v.done) {
    v.done = false; v.tickedAt = null;
    if (v.setId) { const s = db.get('sets', v.setId); if (s) D.deleteSet(s); v.setId = null; }
    A.rest = null;
  } else {
    v.done = true; v.tickedAt = now(); writeSet(b, it, r);
    const rows = orderedRows(); const idx = rows.findIndex(x => x.b === b && x.it === it && x.r === r);
    const next = rows.slice(idx + 1).find(x => !A.vals[K(x.b, x.it, x.r)]?.done) || rows.find(x => !A.vals[K(x.b, x.it, x.r)]?.done);
    if (next) startRest(restAfter(b, it), next); else { A.rest = null; toast('All sets done. Tap Finish when ready.'); }
  }
  persist(true); renderFn();
}

// ---------------------------------------------------------------- rendering helpers
function beat(it, r, v) {
  const ls = it.last ? it.last.sets : []; const l = ls[r] || null; const res = {};
  if (!l || !v) return res;
  if (v.weight != null && l.weight != null && v.weight > l.weight) res.weight = true;
  else if (v.reps != null && l.reps != null && v.reps > l.reps && (v.weight == null || l.weight == null || v.weight >= l.weight)) res.reps = true;
  if (v.timeSec != null && l.timeSec != null && v.timeSec > l.timeSec) res.time = true;
  return res;
}
const arrow = (on, f) => `<span class="uparr ${on ? '' : 'off'}" data-arrow="${f}">${ic(P.up, 15, A_COLOR, 2.8)}</span>`;
function fieldsHTML(key, it, v, r) {
  const f = fieldsOf(it), bt = beat(it, r, v), ex = D.exercise(it.exId) || {};
  let ph = it.target && it.target.reps ? String(it.target.reps).replace(/^Max reps$/i, 'max').replace(/ each leg|\/arm|\/leg/g, '') : '';
  if (ph.length > 5) ph = '';
  const swRun = A.sw && A.sw.key === key;
  const pc = (fl) => (isPre(v, fl) ? ' pre' : '');
  const val = (x, phTxt = '–') => (v[x] != null ? `<b>${fmtNum(v[x])}</b>` : `<b class="ph">${esc(phTxt)}</b>`);
  return `<div class="flds num">${f.map(x => {
    if (x === 'weight') return `<button class="f w${pc('weight')}" data-act="pickWeight" data-key="${key}" aria-label="weight">${val('weight')}<span class="u">kg</span>${arrow(bt.weight, 'weight')}</button>`;
    if (x === 'reps') return `<button class="f r${pc('reps')}" data-act="pickNum" data-key="${key}" data-f="reps" aria-label="reps">${val('reps', ph || '–')}<span class="u">reps</span>${arrow(bt.reps, 'reps')}</button>`;
    if (x === 'rir' || x === 'rpe') return `<button class="f i${pc(x)}" data-act="pickNum" data-key="${key}" data-f="${x}" aria-label="${x === 'rpe' ? 'RPE 1 to 10' : 'RIR'}"><span class="u">${x.toUpperCase()}</span>${val(x)}</button>`;
    if (x === 'flights') return `<button class="f r fl${pc('flights')}" data-act="pickNum" data-key="${key}" data-f="flights" aria-label="flights">${val('flights')}<span class="u">flights</span></button>`;
    if (x === 'time') return `<button class="f t${swRun ? ' running' : ''}${pc('timeSec')}" data-act="pickTime" data-key="${key}" aria-label="time"><b ${swRun ? 'data-clock="sw"' : ''}>${swRun ? fmtClock((now() - A.sw.startAt) / 1000) : v.timeSec != null ? fmtClock(v.timeSec) : '<span class="ph">0:00</span>'}</b><span class="u">${ic(P.timer, 15, '#8e8e93', 2)}</span>${arrow(bt.time, 'time')}</button>`;
    if (x === 'variant') return `<button class="f var" data-act="cycleVariant" data-key="${key}" aria-label="variant"><b>${esc(v.variant || (ex.variants || [])[0] || 'variant')}</b></button>`;
    return '';
  }).join('')}</div>`;
}
export function refreshArrows(key) {
  const { it, r } = findRow(key); const bt = beat(it, r, A.vals[key]);
  const row = document.querySelector(`[data-row="${CSS.escape(key)}"]`); if (!row) return;
  row.querySelectorAll('[data-arrow]').forEach(a => a.classList.toggle('off', !bt[a.dataset.arrow]));
}
function lastLine(it, r) {
  const ls = it.last ? it.last.sets : []; const l = ls[r] || ls[ls.length - 1];
  if (!l) return it.target && it.target.reps ? `target ${esc(it.target.reps)} reps` : 'no history yet';
  const f = fieldsOf(it), bits = [];
  if (f.includes('weight') && l.weight != null) bits.push(`${fmtNum(l.weight)} kg`);
  if (f.includes('reps') && l.reps != null) bits.push(`${l.reps}`);
  let s = bits.join(' × ');
  if (f.includes('time') && l.timeSec != null) s += (s ? ' · ' : '') + fmtClock(l.timeSec);
  if (f.includes('flights') && l.flights != null) s += (s ? ' · ' : '') + `${fmtNum(l.flights)} flights`;
  if (l.rir != null) s += ` · RIR ${fmtNum(l.rir)}`;
  if (l.rpe != null) s += ` · RPE ${fmtNum(l.rpe)}`;
  return `last: ${s || '–'}`;
}
export function targetText(t) {
  if (!t) return '';
  return [t.sx, t.tempo, t.intensity, t.rest && t.rest !== '/' ? t.rest : null].filter(Boolean).join(' · ');
}
// one-sentence RIR / RPE explanation, shown once per exercise block (or once per circuit round)
export function fieldHelpHTML(fields, cls = '') {
  const hs = ['rir', 'rpe'].filter(x => fields.includes(x));
  return hs.length ? `<div class="fhelp ${cls}">${hs.map(x => `<p data-help="${x}"><b>${x.toUpperCase()}</b> ${esc(D.FIELD_HELP[x])}</p>`).join('')}</div>` : '';
}
const itemsFields = (items) => [...new Set(items.flatMap(it => fieldsOf(it)))];
const SRC_TXT = { last: 'last time', avg: 'your average', start: 'starter values', copy: 'your earlier set' };
function preCaption(b, its, indent) {
  const seen = new Set();
  for (const it of its) for (let r = 0; r < b.rounds; r++) { const v = A.vals[K(b, it, r)]; if (!v || v.done) continue; for (const f of fieldsOf(it)) { const k = f === 'time' ? 'timeSec' : f; if (isPre(v, k)) seen.add(v.src[k]); } }
  if (!seen.size) return '';
  const order = ['last', 'avg', 'copy', 'start'].filter(x => seen.has(x)).map(x => SRC_TXT[x]);
  return `<div class="tl pretl${indent ? '' : ' nolead'}"><i class="predot"></i>Pre-filled from ${esc(order.join(' / '))} · tap to change, tick to confirm</div>`;
}
function hintHTML(it, indent = false) {
  const ex = D.exercise(it.exId); if (!ex) return '';
  const h = D.hint({ ...ex, fields: fieldsOf(it) }, it.target, it.last ? { sets: it.last.sets } : null);
  return h ? `<div class="hint"${indent ? ' style="padding-left:36px"' : ''}>${esc(h)}</div>` : '';
}
const dotsBtn = (b, it) => `<button class="circbtn" style="width:32px;height:32px;background:#232325" data-act="exMenu" data-b="${b.key}" data-i="${it.key}" aria-label="More options">${ic(P.dots, 16, 'none', 0, '#fff')}</button>`;
const media = (b, it) => { const ex = D.exercise(it.exId) || {}; return `<span class="mi">${ex.video ? `<button data-act="video" data-url="${esc(ex.video)}" aria-label="Watch video">${ic(P.play, 11, 'none', 0, '#d1d1d6')}</button>` : ''}<button class="info" data-act="cue" data-b="${b.key}" data-i="${it.key}" aria-label="Cues">i</button></span>`; };
const swappedNote = (it) => it.origExId ? `<span class="swapped">swapped from ${esc(D.exercise(it.origExId)?.name || '')}</span>` : '';

function restBar() {
  if (!A.rest) return '';
  const remain = (A.rest.endAt - now()) / 1000;
  return `<div class="rest${remain <= 0 ? ' over' : ''}" id="restbar"><div class="top"><div><div class="lbl">${remain <= 0 ? 'Go' : 'Rest'}</div><div class="tm num" data-clock="rest">${fmtClock(Math.max(0, Math.ceil(remain)))}</div></div>
    <div class="btns"><button class="pill" data-act="restAdd">+30s</button><button class="pill dark" data-act="restSkip">Skip</button></div></div>
    <div class="track"><i data-clock="restbar" style="width:${Math.min(100, Math.max(0, 100 * (1 - remain / A.rest.dur)))}%"></i></div>
    ${A.rest.next ? `<div class="nx">Next: <b>${esc(A.rest.next)}</b>${A.rest.nextVal ? ' · ' + esc(A.rest.nextVal) : ''}</div>` : ''}</div>`;
}
const pauseBtn = () => `<button class="circbtn" data-act="pauseToggle" aria-label="${A.pausedAt ? 'Resume' : 'Pause'}">${A.pausedAt ? ic(P.play, 16, 'none', 0, '#fff') : ic(P.pause, 16, 'none', 0, '#fff')}</button>`;

// ---------------------------------------------------------------- views
export function view() {
  if (!A) return { html: `<div class="empty">No workout in progress.<br><br><a class="btn-primary" href="#/today">Go to Today</a></div>`, noTab: true };
  if (A.kind === 'ladder') return viewLadder();
  if (A.kind === 'followalong') return viewFollow();
  return viewSets();
}
function curRound(b) { const n = b.items.length; let cur = 0; while (cur < b.rounds && b.items.filter(it => A.vals[K(b, it, cur)]?.done).length === n) cur++; return cur; }
function circuitHTML(b) {
  const n = b.items.length;
  const doneIn = (r) => b.items.filter(it => A.vals[K(b, it, r)]?.done).length;
  const cur = curRound(b);
  const ends = []; for (let r = 0; r < b.rounds; r++) ends[r] = Math.max(0, ...b.items.map(it => A.vals[K(b, it, r)]?.tickedAt || 0));
  let out = '';
  for (let r = 0; r < b.rounds; r++) {
    const dn = doneIn(r), open = A.ui.rounds[r] ?? (r === cur);
    if (!open) {
      const dur = dn === n && ends[r] ? fmtClock((ends[r] - (r && ends[r - 1] ? ends[r - 1] : A.startedAt)) / 1000) : '';
      out += `<button class="card r1" data-act="toggleRound" data-r="${r}">${dn === n ? tick(true, 24) : `<span class="tick" style="width:24px;height:24px"></span>`}<b>Round ${r + 1}</b><span class="num">${dn}/${n}${dur ? ' · ' + dur : ''}</span>${ic(P.chevD, 16, '#5a5a5e', 2.4)}</button>`;
      continue;
    }
    const pcap = (() => { const c = b.items.some(it => fieldsOf(it).some(f => isPre(A.vals[K(b, it, r)], f === 'time' ? 'timeSec' : f))); return c ? `<div class="tl pretl inr2"><i class="predot"></i>Dashed = pre-filled · tap to change, tick to confirm</div>` : ''; })();
    out += `<div class="card r2"><button class="r2h" style="width:100%" data-act="toggleRound" data-r="${r}"><b>Round ${r + 1}</b><span>${dn} of ${n} done</span></button>${fieldHelpHTML(itemsFields(b.items), 'inr2')}${pcap}`;
    for (const it of b.items) {
      const ex = D.exercise(it.exId) || { name: '?' }; const key = K(b, it, r); const v = A.vals[key];
      out += `<div class="ex" data-row="${key}"><div class="c"><div class="nmrow"><button class="nm" data-act="cue" data-b="${b.key}" data-i="${it.key}">${esc(ex.name)}</button><span style="flex:1"></span>${dotsBtn(b, it)}</div>
        <div class="ln">${it.eachSide ? '<span class="tag">each side</span>' : ''}<span class="num">${lastLine(it, r)}</span>${swappedNote(it)}</div>
        ${fieldsHTML(key, it, v, r)}${r === cur ? hintHTML(it) : ''}</div>
        <button class="tickbtn" data-act="tick" data-key="${key}" aria-label="Tick set">${tick(v.done)}</button></div>`;
    }
    out += `</div>`;
  }
  return out;
}
function rowHTML(b, it, r, label) {
  const key = K(b, it, r); const v = A.vals[key]; if (!v) return '';
  return `<div class="srow" data-row="${key}"><div class="sn num">${esc(label)}</div>${fieldsHTML(key, it, v, r)}<button class="tickbtn" data-act="tick" data-key="${key}" aria-label="Tick set">${tick(v.done)}</button></div>`;
}
function lastWeekLine(it) {
  if (!it.last) return '';
  const lbl = A.week && it.last.week === A.week - 1 && it.last.routineId === A.routineId ? 'Last week' : `Last time${it.last.week ? ' (S' + it.last.week + ')' : ''}`;
  return `<div class="tl num">${lbl}: <b>${esc(D.setSummary(it.last.sets) || '–')}</b></div>`;
}
function itemHead(b, it, cnt) {
  const ex = D.exercise(it.exId) || { name: '?' };
  return `<div class="exh"><span class="lt">${esc(it.label || '•')}</span><button class="nm" data-act="cue" data-b="${b.key}" data-i="${it.key}">${esc(ex.name)}</button>${media(b, it)}
    ${ex.rehab === 'rehab' ? '<span class="tag rehab">rehab</span>' : ''}<span class="sp"></span>${cnt != null ? `<span class="cnt num">${cnt}</span>` : ''}${dotsBtn(b, it)}</div>`;
}
function targetLine(it) {
  const wl = A.week ? ` S${A.week}` : '';
  if (it.target && it.target.sx) return `<div class="tl num">Target${wl}: <b>${esc(targetText(it.target))}</b></div>`;
  if (it.target && it.target.reps) return `<div class="tl num">Target: <b>${esc(it.target.reps)} reps</b></div>`;
  return '';
}
function singleHTML(b) {
  const it = b.items[0]; const done = Array.from({ length: b.rounds }, (_, r) => A.vals[K(b, it, r)]?.done).filter(Boolean).length;
  const all = b.rounds > 0 && done === b.rounds; const open = A.ui.open[b.key] ?? !all;
  let s = `<div class="blk${all ? ' done' : ''}" data-blk="${b.key}">${itemHead(b, it, `${done}/${b.rounds}`)}${targetLine(it)}`;
  if (it.extra) s += `<div class="tl">Added by you · not in the coach's programme</div>`;
  if (b.oneOff) s += `<div class="tl">One-off for today</div>`;
  if (it.origExId) s += `<div class="tl">${swappedNote(it)}</div>`;
  if (it.target && it.target.sets === 0) s += `<div class="tl">This week is not specified in the programme.</div>`;
  s += lastWeekLine(it);
  if (open) {
    s += fieldHelpHTML(fieldsOf(it), 'ind');
    s += preCaption(b, [it], true);
    s += hintHTML(it, true);
    s += `<div class="sets">${Array.from({ length: b.rounds }, (_, r) => rowHTML(b, it, r, String(r + 1))).join('')}</div>`;
    s += `<div style="display:flex;gap:8px;margin-top:8px;padding-left:31px"><button class="mini" data-act="addRound" data-b="${b.key}">${ic(P.plus, 14)} Set</button>${b.rounds > 0 ? `<button class="mini" data-act="removeRound" data-b="${b.key}">${ic(P.minus, 14)} Set</button>` : ''}${all ? `<button class="mini" data-act="toggleBlk" data-b="${b.key}">Collapse</button>` : ''}</div>`;
  } else s += `<button class="mini" style="margin:8px 0 0 36px" data-act="toggleBlk" data-b="${b.key}">${ic(P.check, 14, A_COLOR, 3)} ${done} sets done · edit</button>`;
  return s + `</div>`;
}
function groupHTML(b) {
  const n = b.items.length, labels = b.items.map(i => i.label).join(' → ');
  let done = 0; for (let r = 0; r < b.rounds; r++) for (const it of b.items) if (A.vals[K(b, it, r)]?.done) done++;
  const total = b.rounds * n; const all = total > 0 && done === total; const open = A.ui.open[b.key] ?? !all;
  const lastT = b.items[n - 1].target; const restTxt = lastT && lastT.rest && /\d/.test(lastT.rest) ? `${lastT.rest} after ${b.items[n - 1].label}` : '~90 s after the sequence';
  let s = `<div class="blk${all ? ' done' : ''}" data-blk="${b.key}"><div class="ssh"><span class="eyebrow" style="font-size:12px;white-space:nowrap">${b.type === 'giant' ? 'Giant set' : 'Superset'}${b.tag ? ` <span class="tag" style="margin-left:4px">${esc(b.tag)}</span>` : ''}</span>
    <span class="r num">${esc(labels)} · ${b.rounds} round${b.rounds === 1 ? '' : 's'} · ${esc(restTxt)}</span></div>
    <div class="ssb"><div class="bracket"></div><div class="items">`;
  b.items.forEach((it, j) => {
    s += (j ? '<div style="height:6px"></div>' : '') + itemHead(b, it) + targetLine(it);
    if (it.origExId) s += `<div class="tl">${swappedNote(it)}</div>`;
    s += lastWeekLine(it); if (open) s += hintHTML(it, true);
  });
  s += `</div></div>`;
  if (open) s += fieldHelpHTML(itemsFields(b.items)) + preCaption(b, b.items, false);
  if (b.roundsUnspecified && open) s += `<div class="tl nolead" style="margin-top:6px">Number of rounds isn't specified in the programme. Set your own below.</div>`;
  if (open) {
    for (let r = 0; r < b.rounds; r++) {
      const dn = b.items.filter(it => A.vals[K(b, it, r)]?.done).length;
      s += `<div class="rlabel"><span>Round ${r + 1}</span><span>${dn}/${n}</span></div>` + b.items.map(it => rowHTML(b, it, r, it.label)).join('');
    }
    s += `<div style="display:flex;gap:8px;margin-top:10px;align-items:center"><span class="muted" style="font-size:13px">Rounds</span><div class="stepper"><button data-act="removeRound" data-b="${b.key}" aria-label="Fewer rounds">${ic(P.minus, 16)}</button><button class="stepv num" data-act="roundsPick" data-b="${b.key}" aria-label="Pick number of rounds">${b.rounds}</button><button data-act="addRound" data-b="${b.key}" aria-label="More rounds">${ic(P.plus, 16)}</button></div><span style="flex:1"></span>${all ? `<button class="mini" data-act="toggleBlk" data-b="${b.key}">Collapse</button>` : ''}</div>`;
  } else s += `<button class="mini" style="margin-top:8px" data-act="toggleBlk" data-b="${b.key}">${ic(P.check, 14, A_COLOR, 3)} ${b.rounds} rounds done · edit</button>`;
  return s + `</div>`;
}
function warmHTML() {
  if (!A.warm) return '';
  const w = D.warmup(A.warm.id); const n = w.items.length; const dn = w.items.filter((_, i) => A.warm.done[i]).length;
  let s = `<button class="card wu" style="border-radius:14px;margin-bottom:${A.warm.open ? 4 : 7}px" data-act="wuOpen">${dn === n ? tick(true, 24) : `<span class="tick" style="width:24px;height:24px"></span>`}<b>${esc(w.name)}</b><span class="num">${dn}/${n}</span>${ic(A.warm.open ? P.chevU : P.chevD, 16, '#5a5a5e', 2.4)}</button>`;
  if (A.warm.open) {
    s += `<div class="wulist">${w.items.map((it, i) => `<div class="wui"><button class="tickbtn" style="margin:0;min-height:36px;min-width:36px" data-act="wuTick" data-i="${i}" aria-label="Tick warm-up item">${tick(A.warm.done[i], 26)}</button>
      <div class="tx">${esc(it.t)}${it.rehab ? ' <span class="tag rehab" style="height:18px;font-size:11px">rehab</span>' : ''}${it.d ? `<small>${esc(it.d)}</small>` : ''}</div>
      ${it.url ? `<span class="mi"><button data-act="video" data-url="${esc(it.url)}" aria-label="Watch video">${ic(P.play, 11, 'none', 0, '#d1d1d6')}</button></span>` : ''}</div>`).join('')}
      <div class="wui" style="justify-content:space-between;align-items:center"><span class="muted" style="font-size:12.5px">The programme doesn't say which warm-up goes with which day.</span><button class="mini" data-act="wuSwitch">Use ${A.warm.id === 'wu-lower' ? 'upper' : 'lower'}</button></div></div>`;
  }
  return s;
}
function viewSets() {
  const prog = A.programme ? D.programme(A.programme) : null;
  const nav = prog
    ? `<div class="nav"><button class="txtbtn dim" data-act="endWorkout">End</button><button class="center" style="pointer-events:auto" data-act="weekPick">${esc(A.name)} · Week ${A.week} of 4<small>${esc([prog.name, prog.coach].filter(Boolean).join(' · '))} ▾</small></button><div class="right"><span class="hel num" data-clock="elapsed">${fmtClock(elapsedSec())}</span></div></div>`
    : `<div class="nav"><button class="txtbtn dim" data-act="endWorkout">End</button><div class="center">${esc(A.name)}${A.subtitle ? ' · ' + esc(A.subtitle) : ''}</div><div class="right">${pauseBtn()}</div></div>`;
  let body = '';
  const circ = A.blocks.find(b => b.type === 'circuit');
  if (circ) {
    const cur = curRound(circ);
    body += `<div class="stats"><div class="el num"><span data-clock="elapsed">${fmtClock(elapsedSec())}</span><small>${A.pausedAt ? 'paused' : 'elapsed'}</small></div>
      <div class="rd"><b class="num">${cur >= circ.rounds ? 'All rounds done' : `Round ${cur + 1} of ${circ.rounds}`}</b><div class="segs">${Array.from({ length: circ.rounds }, (_, r) => `<i class="${r < cur ? 'done' : r === cur ? 'cur' : ''}"></i>`).join('')}</div></div></div>`;
  } else if (!prog) {
    body += `<div class="stats"><div class="el num"><span data-clock="elapsed">${fmtClock(elapsedSec())}</span><small>${A.pausedAt ? 'paused' : 'elapsed'}</small></div></div>`;
  } else body += `<div class="wkbar" style="display:flex;gap:4px;justify-content:center;margin:0 0 12px">${[1, 2, 3, 4].map(w => `<i style="display:block;width:34px;height:4px;border-radius:2px;background:${w < A.week ? A_COLOR : w === A.week ? '#8e8e93' : '#2c2c2e'}"></i>`).join('')}</div>`;
  body += warmHTML();
  for (const b of A.blocks) body += b.type === 'circuit' ? circuitHTML(b) : b.type === 'single' ? singleHTML(b) : groupHTML(b);
  body += `<div class="addrow">${circ ? `<button data-act="addRound" data-b="${circ.key}">${ic(P.plus, 16)} Round</button>` : ''}<button data-act="addExercise">${ic(P.plus, 16)} Exercise for today</button></div>`;
  body += `<div class="finish"><button class="btn-secondary" data-act="endWorkout">${ic(P.check, 18, '#fff', 2.6)} Finish workout</button></div>`;
  return { html: nav + body + restBar(), noTab: true, withRest: !!A.rest };
}

// ---------------------------------------------------------------- ladder (for time)
function seqElapsed(s) { return (s.accum || 0) + (s.running && !A.pausedAt ? (now() - s.startAt) / 1000 : 0); }
function ladderBest(seqId) {
  let best = null;
  for (const s of D.sessions()) for (const l of (s.ladder || [])) if (l.id === seqId && l.rungs === l.top && l.timeSec) best = best == null ? l.timeSec : Math.min(best, l.timeSec);
  return best;
}
function viewLadder() {
  const L = A.lad, s = L.seqs[L.idx], best = ladderBest(s.id);
  const cur = s.rungs.findIndex(x => !x); const dn = s.rungs.filter(Boolean).length;
  const cells = s.rungs.map((d, i) => `<button class="rung num ${d ? 'done' : i === cur && s.startAt ? 'cur' : ''}" data-act="ladRung" data-i="${i}" aria-label="Rung ${i + 1}">${d ? `<span class="ck">${ic(P.check, 10, '#000', 3.6)}</span>` : ''}<span class="s">${s.top - i}</span><span class="q">${i + 1}</span></button>`).join('');
  const nav = `<div class="nav"><button class="txtbtn dim" data-act="endWorkout">End</button><div class="center">${esc(A.name)} · ${esc(A.subtitle)}</div><div class="right">${pauseBtn()}</div></div>`;
  let acts;
  if (s.done) {
    const more = L.idx < L.seqs.length - 1;
    acts = `<div class="card" style="margin:0 0 10px;padding:14px 16px"><div class="eyebrow">${esc(s.name)} done</div><div style="font-size:28px;font-weight:800;margin-top:4px" class="num">${fmtClock(s.timeSec)} <span class="muted" style="font-size:15px;font-weight:600">${dn}/${s.top} rungs${s.weight ? ' · ' + fmtNum(s.weight) + ' kg' : ''}</span></div></div>
      ${more ? `<button class="btn-secondary" data-act="ladRest">${ic(P.timer, 18)} Rest ${Math.round(L.restBetween / 60)} min (programme: 3-6 min)</button><button class="btn-primary mt8" data-act="ladNext">Start ${esc(L.seqs[L.idx + 1].name)}</button>`
        : `<button class="btn-primary" data-act="endWorkout">${ic(P.check, 20, '#000', 3)} Finish workout</button>`}`;
  } else if (!s.startAt) {
    acts = `<button class="btn-primary" data-act="ladStart">${ic(P.play, 18, 'none', 0, '#000')} Start ${esc(s.name)}</button>`;
  } else {
    acts = `<button class="btn-primary" data-act="ladTick">${ic(P.check, 20, '#000', 3)} Tick rung <small class="num">${cur >= 0 ? `${s.top - cur} ${esc(s.aLabel.toLowerCase())} · ${cur + 1} ${esc(s.bLabel)}` : ''}</small></button>
      <button class="btn-secondary" style="margin-top:10px" data-act="ladFinish">Finish sequence</button>`;
  }
  const html = `${nav}<div class="seqbar"><span>${esc(s.name)} of ${L.seqs.length}</span></div>
    <div class="sw num" data-clock="ladder">${fmtClock(s.done ? s.timeSec : seqElapsed(s))}</div>
    <div class="best num">Best: <b>${best ? fmtClock(best) : '–'}</b></div>
    <div class="expl"><b>${esc(s.aLabel)} ${s.top} → 1 · ${esc(s.bLabel[0].toUpperCase() + s.bLabel.slice(1))} 1 → ${s.top}</b><button data-act="ladWeight" aria-label="Kettlebell weight">${s.weight != null ? fmtNum(s.weight) + ' kg' : 'Set kg'}</button></div>
    ${s.note ? `<div class="tl nolead" style="padding:6px 20px 0">${esc(s.note)}</div>` : ''}
    <div class="leg"><span><b style="color:#fff">${esc(s.aLabel)}</b> / ${esc(s.bLabel)} per rung · <button data-act="video" data-url="${esc(s.video)}" style="color:var(--t2);text-decoration:underline;font-size:13px">video</button></span><span class="num">${dn} of ${s.top} done</span></div>
    <div class="grid">${cells}</div><div class="acts">${acts}</div>
    ${L.seqs.filter(x => x.done && x !== s).map(x => `<div class="tl nolead" style="padding:10px 20px 0">${esc(x.name)}: <b class="num">${fmtClock(x.timeSec)}</b> (${x.rungs.filter(Boolean).length}/${x.top})</div>`).join('')}
    ${restBar()}`;
  return { html, noTab: true, withRest: !!A.rest };
}
function finishSeq(s) {
  if (s.done) return;
  s.accum = seqElapsed(s); s.running = false; s.timeSec = Math.round(s.accum); s.done = true;
  const dn = s.rungs.map((d, i) => d ? i : -1).filter(i => i >= 0);
  const aReps = dn.reduce((t, i) => t + (s.top - i), 0), bReps = dn.reduce((t, i) => t + (i + 1), 0);
  s.setIds = [];
  [[s.a, aReps], [s.b, bReps]].forEach(([exId, reps], j) => {
    const ex = D.exercise(exId); const id = uid('set'); s.setIds.push(id);
    D.saveSet({ id, sessionId: A.id, exerciseId: exId, exerciseName: ex.name, date: now(), order: A.lad.seqs.indexOf(s) * 10 + j, setNo: A.lad.seqs.indexOf(s) + 1, round: null,
      block: s.name, weight: s.weight, reps, rir: null, rpe: null, timeSec: s.timeSec, flights: null, variant: null, swappedFrom: null, routineName: A.title, week: null,
      note: `Ladder ${dn.length}/${s.top} rungs` });
  });
}

// ---------------------------------------------------------------- follow-along
function faElapsed() { const f = A.fa; return (f.accum || 0) + (f.running && !A.pausedAt ? (now() - f.startAt) / 1000 : 0); }
function faBest(sid, n) { let b = null; for (const s of D.sessions()) if (s.series === sid && s.seriesNum === n && s.forTimeSec) b = b == null ? s.forTimeSec : Math.min(b, s.forTimeSec); return b; }
function viewFollow() {
  const f = A.fa, sr = D.series(f.sid), s = sr.sessions[f.num - 1];
  const faPre = (k) => (f.src && f.src[k] && f.src[k] !== 'user' ? ' pre' : '');
  const dur = f.manualSec != null ? f.manualSec : faElapsed();
  const combos = s.combos.map((c, i) => s.forTime
    ? `<button class="combo${f.splits[i] ? ' ticked' : ''}" data-act="faCombo" data-i="${i}"><span class="n">${f.splits[i] ? ic(P.check, 13, '#000', 3) : i + 1}</span><span class="tx">${esc(c)}</span>${f.splits[i] ? `<span class="split num">${fmtClock(f.splits[i])}</span>` : ''}</button>`
    : `<div class="combo"><span class="n">${i + 1}</span><span class="tx">${esc(c)}</span></div>`).join('');
  const best = s.forTime ? faBest(f.sid, f.num) : null;
  const vb = s.followUrl
    ? `<a class="btn-secondary" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="l">${ic(P.play, 13, 'none', 0, '#fff')}Technique video</span><small>${s.minutes ? s.minutes + ' min · ' : ''}${esc(hostOf(s.url))}</small></a>
       <a class="btn-secondary" href="${esc(s.followUrl)}" target="_blank" rel="noopener"><span class="l">${ic(P.play, 13, 'none', 0, '#fff')}Follow-along (${s.followMinutes} min)</span><small>video + audio</small></a>`
    : `<a class="btn-secondary" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="l">${ic(P.play, 13, 'none', 0, '#fff')}Follow-along video</span><small>${s.minutes ? s.minutes + ' min · ' : ''}${esc(hostOf(s.url))}</small></a>`;
  const html = `<div class="fa"><div class="nav"><button class="txtbtn dim" data-act="faCancel">Cancel</button><div class="center">Log session</div><div class="right"><button class="mini" data-act="faPick">#${f.num} ▾</button></div></div>
    <div class="bt"><div class="eyebrow" style="font-size:12px">${sr.source ? esc(sr.source) + ' · ' : ''}${esc(sr.name)}${s.category ? ' · ' + esc(s.category) : ''}</div><h1>${esc(A.title)}</h1><div class="sub">${esc(s.title)}</div></div>
    <div class="blk"><div class="lbl3">${s.forTime ? 'Combos · for time' : 'Combos'}<span class="num">${s.forTime ? `Best ${best ? fmtClock(best) : '–'}${f.forTimeSec ? ' · this ' + fmtClock(f.forTimeSec) : ''}` : s.combos.length}</span></div>
      ${combos || '<div class="fnote" style="font-style:normal">No written combos for this session.</div>'}${s.notes.map(n => `<div class="fnote">${esc(n)}</div>`).join('')}
      ${s.forTime ? `<div class="fnote" style="font-style:normal">Tap a combo to start the clock, then tick each one as you finish it. The clock stops on the last one.</div>` : ''}</div>
    <div class="vbtns">${vb}</div>
    <div class="duo"><div class="blk"><div class="lbl3">Duration</div><button class="dur num" data-act="faDurEdit" aria-label="Edit duration"><span style="font-size:40px;color:#fff;font-weight:700;letter-spacing:-1px" data-clock="fa">${fmtClock(dur)}</span><span>min</span></button>
      <div class="durctl"><button data-act="faRun">${f.running ? 'Pause' : (f.accum || f.manualSec != null) ? 'Resume' : 'Start timer'}</button></div></div>
      <div class="blk"><div class="lbl3">Rounds done</div><div class="step num"><button data-act="faRounds" data-d="-1" aria-label="Fewer rounds">${ic(P.minus, 18, '#fff', 2.6)}</button><button class="wv${faPre('rounds')}" data-act="faRoundsPick" aria-label="Pick rounds done"><b>${f.rounds}</b></button><button data-act="faRounds" data-d="1" aria-label="More rounds">${ic(P.plus, 18, '#fff', 2.6)}</button></div></div></div>
    <div class="blk"><div class="lbl3">Effort<span>1 = very easy · 10 = maximal</span></div><button class="effv num${faPre('effort')}" data-act="faEffortPick" aria-label="Pick effort 1 to 10"><b>${f.effort ?? '–'}</b><span>/ 10</span>${faPre('effort') ? '<small>pre-filled · tap to change</small>' : ''}</button></div>
    <textarea class="notes2" rows="2" placeholder="Add notes..." data-fa="notes">${esc(f.notes)}</textarea>
    <button class="btn-primary save" data-act="faSave">${ic(P.check, 19, '#000', 3)} Save session</button></div>`;
  return { html, noTab: true };
}

// ---------------------------------------------------------------- finishing
async function finishFlow() {
  const k = await kneeSheet('after', { notes: !A.fa });
  if (!k) return;
  const L = A.lad;
  if (L) L.seqs.forEach(s => { if (s.startAt && !s.done) finishSeq(s); });
  const sess = { id: A.id, routineId: A.routineId, routineName: A.title, kind: A.kind, programme: A.programme, week: A.week, startedAt: A.startedAt, endedAt: now(),
    durationSec: Math.round(elapsedSec()), kneeBefore: A.kneeBefore, kneeAfter: k.knee, notes: k.notes || '' };
  const circ = A.blocks.find(b => b.type === 'circuit');
  if (circ) { sess.rounds = circ.rounds; sess.roundsDone = Array.from({ length: circ.rounds }, (_, i) => i).filter(i => circ.items.every(it => A.vals[K(circ, it, i)]?.done)).length; }
  if (L) sess.ladder = L.seqs.filter(s => s.startAt).map(s => ({ id: s.id, name: s.name, timeSec: s.timeSec, rungs: s.rungs.filter(Boolean).length, top: s.top, weight: s.weight }));
  if (A.fa) {
    const f = A.fa, sr = D.series(f.sid), s = sr.sessions[f.num - 1];
    const d = Math.round(f.manualSec != null ? f.manualSec : faElapsed());
    Object.assign(sess, { durationSec: d || sess.durationSec, series: f.sid, seriesName: sr.fullName, seriesNum: f.num, title: s.title, roundsDone: f.rounds, effort: f.effort,
      forTimeSec: f.forTimeSec, notes: f.notes || '' });
  }
  if (A.warm) { const w = D.warmup(A.warm.id); sess.warmup = `${w.name}: ${w.items.filter((_, i) => A.warm.done[i]).length}/${w.items.length}`; }
  D.saveSession(sess);
  const adv = A.programme ? D.maybeAdvanceWeek(A.programme) : false;
  A = null; persist(true); setWake(false);
  await db.flush(); sync.soon(800);
  go('#/done/' + sess.id);
  if (adv) setTimeout(() => toast('Programme moved to the next week'), 400);
}

// ---------------------------------------------------------------- shared sheets
export function cueSheet(exId, ctx = {}) {
  const ex = D.exercise(exId); if (!ex) return;
  const t = ctx.target || null; const wk = ctx.week ? `S${ctx.week}` : '';
  const tags = [t?.tempo ? `tempo ${t.tempo}` : ex.tempo ? `tempo ${ex.tempo}` : '', t?.rest && /\d/.test(t.rest) ? `rest ${t.rest}` : ex.rest ? `rest ${ex.rest} s` : '',
    t?.intensity && t.intensity.length < 14 ? t.intensity : '', ex.eachSide ? 'each side' : '', ex.rehab === 'rehab' ? 'rehab (inferred)' : ex.rehab === 'load' ? 'knee loading (inferred)' : '',
    ex.rangeKg || ''].filter(Boolean);
  const m = t && t.sx ? t.sx.match(/^(\d+)×\s*(.*)$/) : null;
  const weekBox = t && t.sx ? `<div class="wk2 num"><div><div class="eyebrow" style="font-size:12px">This week${wk ? ' · ' + wk : ''}</div><div class="big">${m ? `${m[1]} × ${esc(m[2])}` : esc(t.sx)}<span>sets × reps</span></div></div>
    <div class="kv">${t.tempo ? `Tempo <b>${esc(t.tempo)}</b><br>` : ''}${t.intensity ? `Effort <b>${esc(t.intensity)}</b><br>` : ''}${t.rest ? `Rest <b>${esc(t.rest)}</b>` : ''}</div></div>`
    : t && t.reps ? `<div class="wk2 num"><div><div class="eyebrow" style="font-size:12px">Target</div><div class="big">${esc(t.reps)}<span>reps${ex.eachSide ? ' each side' : ''}</span></div></div><div class="kv">${ex.rangeKg ? `Range <b>${esc(ex.rangeKg)}</b>` : ''}</div></div>` : '';
  const seen = new Set();
  const bl = [...(ex.cues || []), ...(ctx.cues || []), ...(ctx.defs || [])].filter(c => !seen.has(c) && seen.add(c)).map(c => ({ c, s: /^"/.test(c) ? 'Coach note' : '' }));
  const notes = ex.srcNotes || [];
  const html = `<div class="sht"><div><div class="eyebrow" style="font-size:12px">${esc(ctx.eyebrow || ex.source || '')}</div><h2>${esc(ex.name)}</h2></div>
    <button class="circbtn" data-act="closeSheet" aria-label="Close">${ic(P.x, 15, '#d1d1d6', 2.6)}</button></div>
    ${tags.length ? `<div class="tags num">${tags.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : '<div style="height:12px"></div>'}
    ${weekBox}
    ${bl.length ? `<div class="lbl2">${D.isProgrammeExercise(ex.id) ? 'From your programme' : 'From the source'}</div><ul class="bul">${bl.map(b => `<li>${esc(b.c)}${b.s ? `<small>${b.s}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${notes.length ? `<div class="lbl2" style="margin-top:12px">Programme notes</div><ul class="bul sm">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="lbl2" style="margin-top:12px">My notes</div>
    <textarea class="notes" rows="2" placeholder="Add your own cue..." data-mynotes="${esc(ex.id)}">${esc(D.myNotes(ex.id))}</textarea>
    ${ex.video ? `<a class="btn-primary watch" href="${esc(ex.video)}" target="_blank" rel="noopener"><span class="l">${ic(P.play, 17, 'none', 0, '#000')}Watch video</span><small>${esc(hostOf(ex.video))}</small></a>`
      : `<button class="btn-secondary watch" data-act="editExFromCue" data-id="${esc(ex.id)}"><span class="l">${ic(P.play, 17, 'none', 0, '#fff')}Watch video</span><small style="opacity:.6">No link yet · tap to add one</small></button>`}`;
  openSheet(html, { full: true, cls: 'cue' });
}
function hostOf(u) { try { return new URL(u).hostname.replace('www.', ''); } catch (e) { return ''; } }
on('editExFromCue', (el) => { closeSheet(); go('#/exercise-edit/' + encodeURIComponent(el.dataset.id)); });

export function weightSheet(ex, cur, { title } = {}) {
  const eq = ex.equip;
  const values = eq === 'kb' ? D.equipment().kb.slice().sort((a, b) => a - b) : range(0, D.maxWeight(eq), 0.5);
  const v = cur ?? D.starterWeight(eq) ?? 20;
  return pickWheels({ eyebrow: D.equipLabel(eq) || 'weight', title: title || ex.name, cls: 'wtsheet',
    wheels: [{ id: 'weight', values, value: v, unit: 'kg', fmt: FMT.kg, label: 'Weight in kg' }],
    step: eq && eq !== 'kb' ? { label: `${fmtNum(D.weightStep(eq))} kg steps`, fn: (w, d) => D.stepWeight(eq, w, d) } : null,
  }).then(r => (r && r.values ? { w: r.values[0] } : r && r.clear ? { w: null } : null));
}
const mmss = (sec) => [Math.floor((sec || 0) / 60), Math.round(sec || 0) % 60];
function timeWheels(sec, maxMin = 99) { const [m, s2] = mmss(sec); return [{ id: 'm', values: range(0, Math.max(maxMin, m)), value: m, unit: 'min', label: 'Minutes' }, { id: 's', values: range(0, 59), value: s2, unit: 'sec', fmt: FMT.pad2, label: 'Seconds' }]; }
const secOf = (vals) => vals[0] * 60 + vals[1];
// duration in m:ss wheels -> seconds (or null if dismissed)
export function durationSheet(sec, title = 'Duration', maxMin = 180) {
  return pickWheels({ title, wheels: timeWheels(sec, maxMin), sep: ':', doneLabel: 'Save' }).then(r => (r && r.values ? secOf(r.values) : null));
}
// one number wheel for reps / RIR / RPE / flights / rounds
export const NUM_SPEC = {
  reps: { label: 'Reps', values: range(0, 100), dflt: 10, unit: 'reps' }, rir: { label: 'RIR', values: range(0, 10), dflt: 2, unit: 'RIR' },
  rpe: { label: 'RPE', values: range(1, 10), dflt: 7, unit: 'RPE' }, flights: { label: 'Flights', values: range(0, 200), dflt: 15, unit: 'flights' },
  rounds: { label: 'Rounds', values: range(1, 20), dflt: 3, unit: 'rounds' }, roundsDone: { label: 'Rounds done', values: range(0, 30), dflt: 3, unit: 'rounds' },
  effort: { label: 'Effort', values: range(1, 10), dflt: 7, unit: '/ 10' },
};
export function numSheet(f, cur, { eyebrow = '', title, clear = false } = {}) {
  const sp = NUM_SPEC[f];
  return pickWheels({ eyebrow, title: title || sp.label, clear, wheels: [{ id: f, values: sp.values, value: cur ?? sp.dflt, unit: sp.unit, label: sp.label }],
    help: f === 'rir' || f === 'rpe' ? `<b>${f.toUpperCase()}</b> ${esc(D.FIELD_HELP[f])}` : null });
}
export function timeSheet(title, key) {
  const v = A.vals[key];
  const running = A.sw && A.sw.key === key;
  const top = `<div class="bigval num sm" ${running ? 'data-clock="sw"' : ''} id="swv">${fmtClock(running ? (now() - A.sw.startAt) / 1000 : v.timeSec || 0)}</div>
    <div class="btn-row mt8"><button class="btn-secondary" data-act="swToggle" data-key="${key}">${ic(P.timer, 18)} ${running ? 'Stop stopwatch' : 'Start stopwatch'}</button></div>
    <div class="lbl2" style="margin:14px 0 0">Or pick the time</div>`;
  return pickWheels({ eyebrow: 'Time', title, top, wheels: timeWheels(v.timeSec ?? 30), sep: ':', doneLabel: 'Save time',
    bottom: `<button class="btn-primary mt12" data-act="wheelDone">Save time</button><p class="muted" style="font-size:13px;margin:10px 2px 0">You can close this while the stopwatch runs; the field keeps counting. Tap it again to stop.</p>` })
    .then(r => (r && r.values ? { sec: secOf(r.values), typed: true } : r));
}
on('swToggle', (el) => {
  const key = el.dataset.key; const sh = el.closest('.sheet');
  if (A.sw && A.sw.key === key) {
    const sec = Math.round((now() - A.sw.startAt) / 1000); A.sw = null; persist(true); closeSheet({ sec }); return;
  }
  unlockAudio();
  A.sw = { key, startAt: now() }; persist(true);
  el.textContent = 'Stop stopwatch'; sh.querySelector('#swv').setAttribute('data-clock', 'sw');
});
const wheelValueOf = (sh) => wheelValues(sh)[0] ?? null;

export function pickExercise(title = 'Choose exercise') {
  const all = D.allExercises().sort((a, b) => a.name.localeCompare(b.name));
  const html = `<div class="sh-title">${esc(title)}</div><div class="searchbox">${ic(P.search, 18, '#8e8e93')}<input type="search" placeholder="Search exercises" data-filter="pick" autocomplete="off"></div>
    <div class="card list nobadge pick" style="margin:0">${all.map(e => `<button class="row" data-act="resolveSheet" data-v="${esc(e.id)}" data-name="${esc(e.name.toLowerCase())}"><div class="t"><b>${esc(e.name)}</b><span>${esc(e.group || e.source || 'My exercises')}</span></div></button>`).join('')}</div>
    <button class="btn-secondary mt12" data-act="resolveSheet" data-v="__new">${ic(P.plus, 18)} New exercise</button>`;
  return ask(html, { full: true });
}

// ---------------------------------------------------------------- actions
const TAB_HIST = '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.3V12l3.2 2"/>';
function cueFor(b, it) {
  const prog = A.programme ? D.programme(A.programme) : null;
  cueSheet(it.exId, { target: it.target, week: A.week, cues: it.cues, defs: it.defs, eyebrow: prog ? `${it.label} · ${A.name} · ${prog.short}` : `${A.name}${A.subtitle ? ' · ' + A.subtitle : ''}` });
}
on('tick', (el) => { unlockAudio(); toggleTick(el.dataset.key); });
const rowLabel = (b, r) => (b.type === 'circuit' ? `Round ${r + 1}` : `Set ${r + 1}`);
on('pickWeight', async (el) => {
  const key = el.dataset.key; const { b, it, r } = findRow(key); const ex = D.exercise(it.exId);
  const res = await weightSheet(ex, A.vals[key].weight, { title: `${ex.name} · ${rowLabel(b, r)}` }); if (!res) return;
  setVal(b, it, r, 'weight', res.w);
  persist(true); renderFn();
});
on('pickTime', async (el) => {
  const key = el.dataset.key; const { b, it, r } = findRow(key);
  const res = await timeSheet(`${D.exercise(it.exId).name} · ${rowLabel(b, r)}`, key);
  if (res && res.sec != null) { if (A.sw && A.sw.key === key) A.sw = null; setVal(b, it, r, 'timeSec', res.sec); }
  persist(true); renderFn();
});
on('pickNum', async (el) => {
  const key = el.dataset.key, f = el.dataset.f; const { b, it, r } = findRow(key); const ex = D.exercise(it.exId);
  const res = await numSheet(f, A.vals[key][f], { eyebrow: `${ex.name} · ${rowLabel(b, r)}`, clear: true }); if (!res) return;
  setVal(b, it, r, f, res.clear ? null : res.values[0]);
  persist(true); renderFn();
});
on('cycleVariant', (el) => {
  const key = el.dataset.key; const { b, it, r } = findRow(key); const ex = D.exercise(it.exId); const vs = ex.variants || [];
  if (!vs.length) return; const v = A.vals[key]; v.variant = vs[(vs.indexOf(v.variant) + 1) % vs.length];
  if (v.done) writeSet(b, it, r); persist(); renderFn();
});
export function onFieldInput(el) {
  if (!A) return; const key = el.dataset.key, f = el.dataset.f; const v = A.vals[key]; if (!v) return;
  v[f] = num(el.value);
  if (f === 'rpe' && v.rpe != null) { const c = D.clampRpe(v.rpe); if (c !== v.rpe) { v.rpe = c; el.value = String(c); } }
  refreshArrows(key);
  if (v.done) { const { b, it, r } = findRow(key); writeSet(b, it, r); }
  persist();
}
export function onFaNotes(el) { if (A && A.fa) { A.fa.notes = el.value; persist(); } }
on('cue', (el) => { const b = blk(el.dataset.b); cueFor(b, b.items.find(i => i.key === el.dataset.i)); });
on('video', (el) => { const u = el.dataset.url; if (u) window.open(u, '_blank', 'noopener'); });
on('exMenu', async (el) => {
  const b = blk(el.dataset.b); const it = b.items.find(i => i.key === el.dataset.i); const ex = D.exercise(it.exId);
  const items = [{ label: 'Cues & video', v: 'cue', icon: P.info }, { label: 'Swap for today only', v: 'swap', icon: P.swap }, { label: 'Exercise history', v: 'hist', icon: TAB_HIST }];
  if (it.origExId) items.push({ label: `Undo swap (back to ${D.exercise(it.origExId).name})`, v: 'unswap', icon: P.swap });
  items.push({ label: 'Remove from today', v: 'remove', danger: true, icon: P.trash });
  const v = await actionSheet(ex.name, items);
  if (v === 'cue') cueFor(b, it);
  else if (v === 'hist') go('#/exercise/' + encodeURIComponent(it.exId));
  else if (v === 'swap' || v === 'unswap') {
    let nid = it.origExId;
    if (v === 'swap') { nid = await pickExercise('Swap for today'); if (!nid) return; if (nid === '__new') return go('#/exercise-edit/new'); }
    if (!nid || nid === it.exId) return;
    it.origExId = v === 'unswap' ? null : (it.origExId || it.exId); it.exId = nid; it.fields = null;
    it.last = snapshotLast(nid, A.routineId, A.week);
    for (let r = 0; r < b.rounds; r++) prefillRow(b, it, r, true);
    persist(true); renderFn(); toast(v === 'swap' ? `Swapped to ${D.exercise(nid).name} for today` : 'Swap undone');
  } else if (v === 'remove') {
    const has = Object.keys(A.vals).some(k => k.startsWith(b.key + '|' + it.key + '|') && A.vals[k].done);
    if (has && !(await confirmSheet('Remove exercise?', 'Its ticked sets for today will be deleted.', 'Remove', true))) return;
    for (const k of Object.keys(A.vals)) if (k.startsWith(b.key + '|' + it.key + '|')) { const s = A.vals[k].setId && db.get('sets', A.vals[k].setId); if (s) D.deleteSet(s); delete A.vals[k]; }
    b.items = b.items.filter(x => x !== it); if (!b.items.length) A.blocks = A.blocks.filter(x => x !== b);
    persist(true); renderFn();
  }
});
on('addExercise', async () => {
  const id = await pickExercise('Add for today'); if (!id) return; if (id === '__new') return go('#/exercise-edit/new');
  const ex = D.exercise(id);
  const b = { key: 'x' + Date.now().toString(36), type: 'single', label: '+', rounds: 3, oneOff: true, items: [mkItem('i0', id, '+', null, { rest: ex.rest || 90 })] };
  A.blocks.push(b); prefillBlock(b); persist(true); renderFn();
  setTimeout(() => document.querySelector(`[data-blk="${b.key}"]`)?.scrollIntoView({ block: 'center' }), 50);
});
function addRoundTo(b) {
  b.rounds++; const r = b.rounds - 1;
  for (const it of b.items) {
    prefillRow(b, it, r);
    const prev = A.vals[K(b, it, r - 1)], v = A.vals[K(b, it, r)];   // keep auto-filling from what you set by hand
    if (prev && v) for (const f of NUMF) { const sp = prev.src && prev.src[f]; if (sp === 'user' || sp === 'copy') { v[f] = prev[f]; v.src[f] = 'copy'; } }
  }
}
on('addRound', (el) => { const b = blk(el.dataset.b); addRoundTo(b); if (b.type === 'circuit') A.ui.rounds = {}; persist(true); renderFn(); });
on('roundsPick', async (el) => {
  const b = blk(el.dataset.b); const res = await numSheet('rounds', b.rounds, { title: 'Rounds' }); if (!res || !res.values) return;
  const n = res.values[0];
  while (b.rounds < n) addRoundTo(b);
  while (b.rounds > n) { const r = b.rounds - 1; if (b.items.some(it => A.vals[K(b, it, r)]?.done)) { toast('Untick the last round first'); break; } b.items.forEach(it => delete A.vals[K(b, it, r)]); b.rounds--; }
  persist(true); renderFn();
});
on('removeRound', (el) => {
  const b = blk(el.dataset.b); if (b.rounds <= 0) return; const r = b.rounds - 1;
  if (b.items.some(it => A.vals[K(b, it, r)]?.done)) return toast('Untick the last round first');
  b.items.forEach(it => delete A.vals[K(b, it, r)]); b.rounds--; persist(true); renderFn();
});
on('toggleBlk', (el) => { const b = blk(el.dataset.b); const isDone = el.closest('.blk').classList.contains('done'); const cur = A.ui.open[b.key] ?? !isDone; A.ui.open[b.key] = !cur; persist(); renderFn(); });
on('toggleRound', (el) => {
  const r = +el.dataset.r; const b = A.blocks.find(x => x.type === 'circuit'); const cur = curRound(b);
  const open = A.ui.rounds[r] ?? (r === cur); A.ui.rounds[r] = !open; persist(); renderFn();
});
on('restAdd', () => { if (!A.rest) return; const base = Math.max(A.rest.endAt, now()); A.rest.endAt = base + 30000; A.rest.dur = (A.rest.endAt - A.rest.startAt) / 1000; A.rest.b10 = false; A.rest.b0 = false; persist(true); renderFn(); });
on('restSkip', () => { A.rest = null; persist(true); renderFn(); });
on('pauseToggle', () => {
  if (A.pausedAt) { const d = now() - A.pausedAt; A.pausedTotal += d; A.pausedAt = null; if (A.lad) A.lad.seqs.forEach(s => { if (s.running) s.startAt += d; }); if (A.fa && A.fa.running) A.fa.startAt += d; }
  else A.pausedAt = now();
  persist(true); renderFn();
});
on('endWorkout', async () => {
  const anyDone = Object.values(A.vals).some(v => v.done) || (A.lad && A.lad.seqs.some(s => s.startAt));
  const v = await actionSheet(anyDone ? 'End workout' : 'Nothing logged yet', [
    ...(anyDone ? [{ label: 'Finish & save', v: 'finish', icon: P.check }] : []), { label: 'Discard workout', v: 'discard', danger: true, icon: P.trash }]);
  if (v === 'finish') finishFlow();
  else if (v === 'discard') { if (!anyDone || await confirmSheet('Discard workout?', 'All sets ticked in this workout will be deleted.', 'Discard', true)) { discardActive(); go('#/today'); } }
});
on('weekPick', async () => {
  const v = await actionSheet('Programme week', [1, 2, 3, 4].map(w => ({ label: `Week ${w} (S${w})${w === A.week ? '  ✓' : ''}`, v: String(w) })));
  if (!v) return; const w = +v; if (w === A.week) return;
  D.setProgWeek(A.programme, w); A.week = w;
  const fresh = buildBlocks(D.routine(A.routineId), w);
  for (const nb of fresh) {
    const ob = A.blocks.find(b => b.key === nb.key); if (!ob) continue;
    let maxDone = -1; for (const k of Object.keys(A.vals)) if (k.startsWith(nb.key + '|') && A.vals[k].done) maxDone = Math.max(maxDone, +k.split('|')[2]);
    ob.rounds = Math.max(nb.rounds, maxDone + 1);
    ob.items.forEach((it, i) => { const ni = nb.items[i]; if (!ni) return; it.target = ni.target; it.rest = ni.rest; it.last = snapshotLast(it.exId, A.routineId, w);
      for (let rr = 0; rr < ob.rounds; rr++) prefillRow(ob, it, rr, true); });
  }
  persist(true); renderFn(); toast(`Showing week ${w} targets`);
});
on('wuOpen', () => { A.warm.open = !A.warm.open; persist(); renderFn(); });
on('wuTick', (el) => { const i = +el.dataset.i; A.warm.done[i] = !A.warm.done[i]; persist(); renderFn(); });
on('wuSwitch', () => { A.warm.id = A.warm.id === 'wu-lower' ? 'wu-upper' : 'wu-lower'; A.warm.done = []; persist(); renderFn(); });
// ladder actions
on('ladStart', () => { unlockAudio(); const s = A.lad.seqs[A.lad.idx]; s.startAt = now(); s.running = true; s.accum = 0; A.rest = null; persist(true); renderFn(); });
on('ladTick', () => {
  const s = A.lad.seqs[A.lad.idx]; const i = s.rungs.findIndex(x => !x); if (i < 0) return;
  s.rungs[i] = true; if (s.rungs.every(Boolean)) { finishSeq(s); beepEnd(); }
  persist(true); renderFn();
});
on('ladRung', (el) => {
  const s = A.lad.seqs[A.lad.idx]; if (!s.startAt || s.done) return toast(s.done ? 'Sequence finished' : 'Start the sequence first');
  const i = +el.dataset.i; s.rungs[i] = !s.rungs[i]; if (s.rungs.every(Boolean)) { finishSeq(s); beepEnd(); }
  persist(true); renderFn();
});
on('ladFinish', async () => {
  const s = A.lad.seqs[A.lad.idx];
  if (!s.rungs.every(Boolean) && !(await confirmSheet('Finish sequence?', `${s.rungs.filter(Boolean).length} of ${s.top} rungs ticked.`, 'Finish'))) return;
  finishSeq(s); persist(true); renderFn();
});
on('ladNext', () => { const prev = A.lad.seqs[A.lad.idx]; A.lad.idx++; const nx = A.lad.seqs[A.lad.idx]; if (nx && nx.weight == null) nx.weight = prev.weight; A.rest = null; persist(true); renderFn(); });
on('ladRest', () => { unlockAudio(); startRest(A.lad.restBetween, null); A.rest.next = A.lad.seqs[A.lad.idx + 1]?.name || ''; persist(true); renderFn(); });
on('ladWeight', async () => {
  const s = A.lad.seqs[A.lad.idx]; const res = await weightSheet(D.exercise(s.a), s.weight); if (!res) return;
  s.weight = res.w; if (s.done && s.setIds) s.setIds.forEach(id => { const st = db.get('sets', id); if (st) D.saveSet({ ...st, weight: res.w }); });
  persist(true); renderFn();
});
// follow-along actions
on('faRun', () => {
  unlockAudio(); const f = A.fa;
  if (f.running) { f.accum = faElapsed(); f.running = false; }
  else { if (f.manualSec != null) { f.accum = f.manualSec; f.manualSec = null; } f.startAt = now(); f.running = true; }
  persist(true); renderFn();
});
on('faDurEdit', async () => {
  const f = A.fa; const cur = f.manualSec != null ? f.manualSec : faElapsed();
  const v = await durationSheet(Math.round(cur));
  if (v == null) return; f.running = false; f.manualSec = v; f.accum = v; persist(true); renderFn();
});
const faUser = (k) => { A.fa.src = A.fa.src || {}; A.fa.src[k] = 'user'; };
on('faRounds', (el) => { A.fa.rounds = Math.max(0, A.fa.rounds + +el.dataset.d); faUser('rounds'); persist(); renderFn(); });
on('faRoundsPick', async () => { const r = await numSheet('roundsDone', A.fa.rounds); if (!r || !r.values) return; A.fa.rounds = r.values[0]; faUser('rounds'); persist(); renderFn(); });
on('faEffortPick', async () => { const r = await numSheet('effort', A.fa.effort, { title: 'Effort (1 = very easy, 10 = maximal)' }); if (!r || !r.values) return; A.fa.effort = r.values[0]; faUser('effort'); persist(); renderFn(); });
on('faCombo', (el) => {
  unlockAudio();
  const f = A.fa, i = +el.dataset.i, s = D.series(f.sid).sessions[f.num - 1];
  if (!f.running && !f.splits.some(Boolean) && !f.forTimeSec) { f.startAt = now(); f.running = true; f.accum = 0; f.manualSec = null; toast('Clock started'); persist(true); renderFn(); return; }
  f.splits[i] = f.splits[i] ? null : Math.max(1, Math.round(faElapsed()));
  if (s.combos.every((_, j) => f.splits[j])) { f.accum = faElapsed(); f.running = false; f.forTimeSec = Math.round(f.accum); beepEnd(); }
  persist(true); renderFn();
});
on('faPick', () => go('#/series/' + A.fa.sid + '?switch=1'));
// rounds done / effort: last time you did this session -> average for the series -> starter (3 rounds, effort 7)
function faDefaults(f) {
  const ss = D.sessions().filter(s => s.series === f.sid);
  const same = ss.find(s => s.seriesNum === f.num);
  for (const [k, sk, start] of [['rounds', 'roundsDone', 3], ['effort', 'effort', 7]]) {
    if (f.src && f.src[k] === 'user') continue;
    const vals = ss.map(s => s[sk]).filter(v => v != null);
    if (same && same[sk] != null) { f[k] = same[sk]; f.src[k] = 'last'; }
    else if (vals.length) { f[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); f.src[k] = 'avg'; }
    else { f[k] = start; f.src[k] = 'start'; }
  }
}
export function switchSeriesNum(n) {
  if (!A || !A.fa) return; const sr = D.series(A.fa.sid);
  A.fa.num = n; A.fa.splits = []; A.fa.forTimeSec = null; A.fa.src = A.fa.src || {}; faDefaults(A.fa); A.subtitle = sr.sessions[n - 1].title; A.title = `${sr.short} · Workout ${n}`; persist(true);
}
on('faCancel', async () => { if (await confirmSheet('Discard this session?', 'Nothing will be saved.', 'Discard', true)) { discardActive(); go('#/today'); } });
on('faSave', () => finishFlow());

// ---------------------------------------------------------------- live clocks, beeps, wake lock
onTick(() => {
  if (!A) { setWake(false); return; }
  const t = now();
  document.querySelectorAll('[data-clock]').forEach(el => {
    const c = el.dataset.clock;
    if (c === 'elapsed') el.textContent = fmtClock(elapsedSec());
    else if (c === 'sw' && A.sw) el.textContent = fmtClock((t - A.sw.startAt) / 1000);
    else if (c === 'ladder' && A.lad) { const s = A.lad.seqs[A.lad.idx]; el.textContent = fmtClock(s.done ? s.timeSec : seqElapsed(s)); }
    else if (c === 'fa' && A.fa && A.fa.manualSec == null) el.textContent = fmtClock(faElapsed());
  });
  if (A.rest) {
    const remain = (A.rest.endAt - t) / 1000;
    const tm = document.querySelector('[data-clock="rest"]'); if (tm) tm.textContent = fmtClock(Math.max(0, Math.ceil(remain)));
    const bar = document.querySelector('[data-clock="restbar"]'); if (bar) bar.style.width = Math.min(100, Math.max(0, 100 * (1 - remain / A.rest.dur))) + '%';
    if (!A.rest.b10 && remain <= 10 && A.rest.dur > 12) { A.rest.b10 = true; if (remain > 8.5) beepWarn(); persist(); }
    if (!A.rest.b0 && remain <= 0) {
      A.rest.b0 = true; if (remain > -2) beepEnd(); persist();
      const rb = document.getElementById('restbar'); if (rb) { rb.classList.add('over'); rb.querySelector('.lbl').textContent = 'Go'; }
    }
    if (remain <= -4) { A.rest = null; persist(); document.getElementById('restbar')?.remove(); document.getElementById('view')?.classList.remove('withRest'); }
  }
  const lad = A.lad && A.lad.seqs.some(s => s.running && !s.done);
  setWake(!!(A.rest || A.sw || lad || (A.fa && A.fa.running)));
});
export const hasActive = () => !!A;
export { fmtDur, relDay, fmtDate };
