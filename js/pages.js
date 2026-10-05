// Tab pages and secondary screens
import * as db from './db.js';
import * as D from './data.js';
import * as W from './workout.js';
import * as sync from './sync.js';
import { esc, fmtNum, fmtClock, fmtDur, fmtDate, fmtLong, fmtMonth, fmtShort, fmtTime, relDay, ago, uid, num, parseClock } from './util.js';
import { ic, P, tabbar, on, openSheet, closeSheet, ask, confirmSheet, actionSheet, toast, go, A_COLOR, upArrow } from './ui.js';

let homePick = null; let homeRounds = {};
const badgeFor = (r) => {
  if (r.badge) return r.badge;
  const m = r.name.match(/(\d+)$/); if (m && r.kind !== 'program') return m[1];
  if (r.kind === 'program') return r.id.endsWith('-rec') ? 'R' : 'T' + r.name.match(/\d/)?.[0];
  return r.name.slice(0, 2);
};
const back = (label, href) => `<a class="txtbtn" href="${href}" style="margin-left:-8px">${ic(P.chevL, 22, '#fff', 2.6)}${esc(label)}</a>`;

// ---------------------------------------------------------------- TODAY
// ---------------------------------------------------------------- FIRST RUN
const importBtn = (label, cls = 'btn-primary') => `<label class="${cls} filebtn">${ic(P.plus, 18, 'none', 0, cls === 'btn-primary' ? '#000' : '#fff')}${esc(label)}<input type="file" class="vh" accept=".json,application/json,text/plain" data-act="importFile" aria-label="${esc(label)}"></label>`;
export const needsWelcome = () => !db.kvGet('onboarded') && !D.sessions().length && !D.installedPacks().length;
export function welcome() {
  const html = `<div class="welcome"><img src="./icons/icon-192.png" alt="" width="84" height="84" class="wlogo">
    <div class="eyebrow">Welcome</div><h1>Exercise Log</h1>
    <p>Log sets, circuits, programme weeks and follow-along sessions. Everything is saved on this phone and works offline.</p>
    <p>If you have a programmes file (<b>.json</b>), import it to load your routines, cue sheets, video links and past sessions. Otherwise start with a few basic exercises and build your own routines.</p>
    <div class="wbtns">${importBtn('Import your programmes')}<button class="btn-secondary mt8" data-act="startEmpty">Start empty</button></div>
    <p class="muted" style="font-size:13px">You can import a programmes file later from Settings → Your data. Importing never deletes what you've logged.</p></div>`;
  return { html, noTab: true };
}
on('startEmpty', () => { db.kvSet('onboarded', Date.now()); go('#/today'); });
async function handleImportFile(el, fromSettings) {
  const file = el.files && el.files[0]; if (!file) return;
  let d; try { d = D.parseImport(await file.text()); } catch (e) { el.value = ''; return toast('Import failed: ' + e.message); }
  el.value = '';
  try {
    if (D.isPack(d)) {
      const r = await D.importPack(d);
      window.__lastImport = r;
      const bits = [`${r.routines} routines`, `${r.exercises} exercises`]; if (r.sessionsAdded) bits.push(`${r.sessionsAdded} past sessions`);
      toast(r.replaced && !r.sessionsAdded && !r.setsAdded ? `${r.name} is up to date (nothing duplicated)` : `Imported ${bits.join(', ')}`);
    } else {
      const v = await actionSheet('Restore backup', [{ label: 'Merge with data on this phone', v: 'merge' }, { label: 'Replace everything on this phone', v: 'replace', danger: true }]);
      if (!v) return;
      if (v === 'replace' && !(await confirmSheet('Replace everything?', 'All data on this phone is replaced with the backup.', 'Replace', true))) return;
      const r = await D.restoreJSON(d, v); window.__lastImport = r;
      toast(v === 'replace' ? `Restored ${r.total} records` : `Merged: ${r.added} added, ${r.updated} updated`);
    }
    homePick = null; sync.soon();
    go(fromSettings ? '#/settings' : '#/today');
  } catch (e) { console.error(e); toast('Import failed: ' + e.message); }
}
on('importFile', (el) => handleImportFile(el, location.hash === '#/settings'));

export function today() {
  if (needsWelcome()) return welcome();
  const rot = D.getRotation();
  const sugg = D.nextInRotation();
  const pickId = homePick && D.routine(homePick) ? homePick : sugg || (D.allRoutines()[0] || {}).id;
  const r = D.routine(pickId);
  if (!r) {
    const html = `<div class="hdr"><div><div class="eyebrow">${esc(fmtLong(Date.now()))}</div><h1>Today</h1></div></div>
      <div class="card hero"><div class="eyebrow">No routines yet</div><div class="sub" style="margin:6px 0 16px">Import your programmes file, or make a routine from your exercises.</div>
      ${importBtn('Import your programmes')}<a class="btn-secondary mt8" href="#/routine-edit/new">${ic(P.plus, 18)} New routine</a></div>`;
    return { html, tab: 'Today' };
  }
  const last = D.sessions()[0];
  const lastOfR = D.lastSessionOf(r.id);
  let hero = `<div class="eyebrow">${pickId === sugg ? 'Next up' : 'Selected'}</div><div class="w">${esc(r.name)}</div><div class="sub">${esc(r.kind === 'program' ? r.subtitle : r.subtitle || '')}</div>`;
  const metaBits = [];
  if (last) metaBits.push(`<span>Last done: <b>${esc(last.routineName)}, ${relDay(last.startedAt)}</b></span>`);
  if (r.kind === 'followalong') { const n = D.nextSeriesNum(r.series); const s = D.series(r.series).sessions[n - 1]; metaBits.push(`<span>Next: <b>#${n} ${esc(s.title)}</b></span>`); }
  else if (r.kind === 'ladder') metaBits.push(`<span>${r.sequences.length} sequences · for time</span>`);
  else if (r.kind === 'intervals') metaBits.push(`<span>${r.intervals.count} × ${esc(D.fmtMin(r.intervals.workSec))} hard · ~${Math.round(D.ivTotal(r.intervals) / 60)} min</span>`);
  else metaBits.push(`<span>${D.routineCount(r)} exercises</span>`);
  hero += `<div class="meta">${metaBits.join('<span class="dot"></span>')}</div>`;
  if (r.kind === 'circuit') {
    const opts = r.roundsOptions || [2, 3, 4]; const sel = homeRounds[r.id] || r.rounds || 3;
    const perRound = lastOfR && lastOfR.durationSec && lastOfR.rounds ? Math.round(lastOfR.durationSec / lastOfR.rounds / 60) : null;
    hero += `<div class="rounds"><div class="lbl">Rounds${perRound ? `<small>~${perRound} min per round last time</small>` : `<small>${r.restNote ? 'rest 60-90 s' : ''}</small>`}</div>
      <div class="seg num">${opts.map(n => `<button class="${n === sel ? 'on' : ''}" data-act="homeRounds" data-r="${r.id}" data-n="${n}">${n}</button>`).join('')}</div></div>`;
  } else if (r.kind === 'program') {
    const w = D.progWeek(r.programme);
    hero += `<div class="rounds"><div class="lbl">Programme week<small>targets follow S1–S4</small></div><div class="seg sm num">${[1, 2, 3, 4].map(n => `<button class="${n === w ? 'on' : ''}" data-act="setWeek" data-p="${r.programme}" data-n="${n}">S${n}</button>`).join('')}</div></div>`;
  } else hero += `<div style="height:16px"></div>`;
  hero += `<button class="btn-primary" data-act="startPicked" data-r="${r.id}">${ic(P.play, 18, 'none', 0, '#000')}Start</button>`;
  if (r.kind === 'followalong') hero += `<a class="btn-secondary mt8" href="#/series/${r.series}">Choose another session</a>`;

  const st = sync.status(); const pend = sync.pending();
  let syncLine;
  if (!sync.getUrl()) syncLine = `${ic(P.cloud, 15, '#8e8e93', 2)}<a href="#/settings">Saved on this phone · Google Sheet sync is off</a>`;
  else if (st.lastError && pend) syncLine = `${ic(P.cloud, 15, '#ff9f0a', 2)}${pend} waiting to sync · ${esc(st.lastError)}`;
  else if (pend) syncLine = `${ic(P.cloud, 15, '#8e8e93', 2)}${pend} record${pend === 1 ? '' : 's'} waiting to sync`;
  else syncLine = `${ic(P.circleCheck, 15, '#8e8e93', 2)}Synced to Google Sheet${st.lastOk ? ' · ' + ago(st.lastOk) : ''}`;

  const sm = D.weeklySummary();
  const others = [...new Set([...rot, ...D.allRoutines().filter(x => x.kind === 'followalong' || x.kind === 'intervals').map(x => x.id)])].filter(id => id !== r.id).map(id => D.routine(id)).filter(Boolean);
  if (pickId !== sugg && sugg && !others.find(o => o.id === sugg)) others.unshift(D.routine(sugg));
  const rows = others.map(o => { const ls = D.lastSessionOf(o.id); return `<button class="row" data-act="homePick" data-r="${o.id}"><div class="badge num${badgeFor(o).length > 2 ? ' sm' : ''}">${esc(badgeFor(o))}</div><div class="t"><b>${esc(o.name)}</b><span>${esc(D.routineMeta(o))}</span></div>
    <div class="when">${ls ? fmtShort(ls.startedAt) : ''}</div>${ic(P.chevR, 16, '#5a5a5e', 2.4)}</button>`; }).join('');
  const active = W.A ? `<a class="card resume" href="#/workout">${ic(P.timer, 22, A_COLOR, 2)}<b>${esc(W.A.title)} in progress<span>Started ${fmtTime(W.A.startedAt)} · tap to resume</span></b>${ic(P.chevR, 16, '#8e8e93', 2.4)}</a>` : '';
  const html = `<div class="hdr"><div><div class="eyebrow">${esc(fmtLong(Date.now()))}</div><h1>Today</h1></div>
      <button class="circbtn" style="margin-bottom:3px" data-act="exportCSV" aria-label="Export CSV">${ic(P.share, 19, '#fff', 2)}</button></div>
    ${active}<div class="card hero">${hero}</div>
    <div class="sync">${syncLine}</div>
    <div class="section-label">This week<a href="#/history">History</a></div>
    <div class="card summary num"><div><b>${sm.sessions}</b><span>sessions</span></div><div><b>${Math.round(sm.totalSec / 60)}</b><span>minutes</span></div><div><b>${sm.bests}</b><span>new bests</span></div><div><b>${sm.streak}</b><span>wk streak</span></div></div>
    <div class="section-label">Switch routine<a href="#/routines">All</a></div>
    <div class="card list" style="border-radius:16px">${rows}</div>`;
  return { html, tab: 'Today' };
}
on('homePick', (el) => { homePick = el.dataset.r; window.scrollTo(0, 0); go('#/today'); });
on('homeRounds', (el) => { homeRounds[el.dataset.r] = +el.dataset.n; go(location.hash); });
on('setWeek', (el) => { D.setProgWeek(el.dataset.p, +el.dataset.n); go(location.hash); });
on('startPicked', (el) => { const r = D.routine(el.dataset.r); W.startRoutine(r.id, { rounds: homeRounds[r.id] }); });

// ---------------------------------------------------------------- ROUTINES
export function routines() {
  const all = D.allRoutines(); const rot = D.getRotation();
  const row = (r, extra = '') => { const ls = D.lastSessionOf(r.id); return `<a class="row" href="#/routine/${encodeURIComponent(r.id)}"><div class="badge num${badgeFor(r).length > 2 ? ' sm' : ''}">${esc(badgeFor(r))}</div><div class="t"><b>${esc(r.name)}</b><span>${esc(D.routineMeta(r))}</span></div>${extra}<div class="when">${ls ? fmtShort(ls.startedAt) : ''}</div>${ic(P.chevR, 16, '#5a5a5e', 2.4)}</a>`; };
  const sec = (title, list, right = '') => list.length ? `<div class="section-label">${esc(title)}${right}</div><div class="card list" style="border-radius:16px">${list.map(r => row(r)).join('')}</div>` : '';
  const rotList = rot.map(id => D.routine(id)).filter(Boolean);
  const bySrc = new Map();
  for (const r of all) {
    if (!D.isSeedRoutine(r.id) || r.kind === 'program') continue;
    const src = r.kind === 'followalong' ? 'Follow-along' + (D.series(r.series)?.source ? ' · ' + D.series(r.series).source : '') : (r.source || 'Built-in');
    if (!bySrc.has(src)) bySrc.set(src, []); bySrc.get(src).push(r);
  }
  const builtIn = [...bySrc].map(([t, l]) => sec(t, l)).join('');
  const mine = all.filter(r => !D.isSeedRoutine(r.id));
  const progs = D.allProgrammes().map(p => sec(`${p.name} · week ${D.progWeek(p.id)}`, p.days.map(id => D.routine(id)).filter(Boolean), `<button data-act="progWeekSheet" data-p="${p.id}">Change week</button>`)).join('');
  const html = `<div class="hdr"><div><div class="eyebrow">Plans</div><h1>Routines</h1></div><a class="circbtn" href="#/routine-edit/new" aria-label="New routine" style="margin-bottom:3px">${ic(P.plus, 20, '#fff', 2.4)}</a></div>
    <div class="section-label">Rotation<button data-act="editRotation">Edit</button></div>
    <div class="card list" style="border-radius:16px">${rotList.map(r => row(r)).join('') || '<div class="empty" style="padding:20px">No routines in rotation</div>'}</div>
    ${builtIn}${progs}
    ${sec('My routines', mine)}
    <div class="pad mt16"><a class="btn-secondary" href="#/routine-edit/new">${ic(P.plus, 18)} New routine</a></div>`;
  return { html, tab: 'Routines' };
}
on('progWeekSheet', async (el) => {
  const p = D.programme(el.dataset.p); const cur = D.progWeek(p.id);
  const v = await actionSheet(`${p.name}: week`, [1, 2, 3, 4].map(w => ({ label: `Week ${w} (S${w})${w === cur ? '  ✓' : ''}`, v: String(w) })));
  if (v) { D.setProgWeek(p.id, +v); go(location.hash); }
});
on('editRotation', async () => {
  const all = D.allRoutines();
  const render = (rot) => `<div class="sh-title">Rotation</div><p class="sh-body">Home suggests the routine after the last one you did, in this order.</p>
    <div class="alist">${rot.map((id, i) => `<div class="arow rotrow"><span class="t">${esc(D.routine(id)?.name || id)} <span class="muted" style="font-size:13px">${esc(D.routine(id)?.subtitle || '')}</span></span>
      <button class="smallbtn" data-act="rotMove" data-i="${i}" data-d="-1" aria-label="Move up">${ic(P.chevU, 16)}</button><button class="smallbtn" data-act="rotMove" data-i="${i}" data-d="1" aria-label="Move down">${ic(P.chevD, 16)}</button><button class="smallbtn" data-act="rotDel" data-i="${i}" aria-label="Remove">${ic(P.x, 16)}</button></div>`).join('')}</div>
    <div class="lbl2">Add</div><div class="alist">${all.filter(r => !rot.includes(r.id)).map(r => `<button class="arow" data-act="rotAdd" data-id="${r.id}">${ic(P.plus, 18)}<span>${esc(r.name)} <span class="muted" style="font-size:13px">${esc(r.subtitle || '')}</span></span></button>`).join('')}</div>
    <button class="btn-primary mt12" data-act="closeSheet">Done</button>`;
  const sh = openSheet(render(D.getRotation()), { full: true, onClose: () => go(location.hash) });
  sh.dataset.rot = '1'; rotRender = () => { sh.innerHTML = '<div class="grab"></div>' + render(D.getRotation()); };
});
let rotRender = () => {};
on('rotMove', (el) => { const r = D.getRotation().slice(); const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; D.setRotation(r); rotRender(); });
on('rotDel', (el) => { const r = D.getRotation().slice(); r.splice(+el.dataset.i, 1); D.setRotation(r); rotRender(); });
on('rotAdd', (el) => { D.setRotation([...D.getRotation(), el.dataset.id]); rotRender(); });

export function routineDetail(id) {
  const r = D.routine(id); if (!r) return { html: `<div class="nav">${back('Routines', '#/routines')}</div><div class="empty">Routine not found.</div>`, tab: 'Routines' };
  const rot = D.getRotation(); const inRot = rot.includes(r.id);
  let body = '';
  const exRow = (exId, label, sub) => { const ex = D.exercise(exId) || { name: exId }; return `<button class="row" data-act="cueEx" data-id="${esc(exId)}"><div class="badge sm">${esc(label)}</div><div class="t"><b>${esc(ex.name)}</b><span>${esc(sub)}</span></div>${ic(P.info, 18, '#5a5a5e', 2)}</button>`; };
  if (r.kind === 'circuit' || r.kind === 'straight') {
    body = `<div class="card list">${r.items.map((it, i) => exRow(it.ex, r.kind === 'circuit' ? String(i + 1) : (it.withPrev ? '↳' : String.fromCharCode(65 + i)), [it.sets ? `${it.sets} sets` : '', it.reps ? `${it.reps} reps` : '', it.eachSide ? 'each side' : '', it.rest ? `rest ${it.rest} s` : ''].filter(Boolean).join(' · '))).join('')}</div>`;
    if (r.restNote) body += `<p class="pad muted" style="font-size:13px;margin:10px 20px">${esc(r.restNote)}</p>`;
  } else if (r.kind === 'program') {
    const w = D.progWeek(r.programme);
    body = `<div class="pad" style="margin-bottom:10px"><div class="seg sm num" style="display:inline-flex">${[1, 2, 3, 4].map(n => `<button class="${n === w ? 'on' : ''}" data-act="setWeek" data-p="${r.programme}" data-n="${n}">S${n}</button>`).join('')}</div></div>
      <div class="card list">${r.blocks.flatMap(b => (b.items || [b]).map(it => exRow(it.ex, it.label, it.weeks ? W.targetText(it.weeks[w - 1]) : 'Added by you · no prescription'))).join('')}</div>`;
    if (r.warmup) body += `<p class="pad muted" style="font-size:13px;margin:10px 20px">Warm-up: ${esc(D.warmup(r.warmup).name)} (switchable during the session).</p>`;
    const p = D.programme(r.programme);
    body += `<div class="section-label">Progression (as printed)</div><div class="card" style="padding:12px 16px"><ul class="bul sm" style="margin:0">${p.progression.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  } else if (r.kind === 'ladder') {
    body = `<div class="card list">${r.sequences.map((s, i) => exRow(s.a, 'S' + (i + 1), `${D.exercise(s.a).name} ${r.top}→1 + ${D.exercise(s.b).name} 1→${r.top}`)).join('')}</div><p class="pad muted" style="font-size:13px;margin:10px 20px">${esc(r.restNote)}</p>`;
  } else if (r.kind === 'intervals') {
    const c = r.intervals, z = r.zones || {};
    const kv = (a, b2, sub) => `<div class="kv2"><span>${esc(a)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><b class="num">${esc(b2)}</b></div>`;
    body = `<div class="card list nobadge ivplan">${kv('Warm-up', D.fmtMin(c.warmupSec), z.easy)}${kv(`${c.count} hard intervals`, `${c.count} × ${D.fmtMin(c.workSec)}`, z.hard)}${kv('Recovery between', D.fmtMin(c.recoverySec), z.rec || z.easy)}${kv('Cool-down', D.fmtMin(c.cooldownSec), z.easy)}${kv('Total', `~${Math.round(D.ivTotal(c) / 60)} min`)}</div>
      <p class="pad muted" style="font-size:13px;margin:10px 20px">A guided timer runs the phases for you. You can change the durations before you start. Log RPE, optional average HR and (on stairs) flights for each interval.</p>
      <div class="card list">${exRow(r.ex, r.badge || '4×4', 'How it works: target zone, talk test, how often')}</div>`;
  } else if (r.kind === 'followalong') {
    body = `<div class="pad"><a class="btn-secondary" href="#/series/${r.series}">Browse all ${D.series(r.series).sessions.length} sessions</a></div>`;
  }
  const editable = r.kind === 'circuit' || r.kind === 'straight';
  const html = `<div class="nav">${back('Routines', '#/routines')}<div class="right">${editable ? `<a class="circbtn" href="#/routine-edit/${encodeURIComponent(r.id)}" aria-label="Edit routine">${ic(P.edit, 17, '#fff', 2)}</a>` : ''}</div></div>
    <div class="ttl"><div class="eyebrow">${esc(r.source || 'My routine')}</div><h1>${esc(r.name)}</h1><div class="tags"><span class="tag">${esc(r.subtitle || r.kind)}</span>${r.week ? '' : ''}</div></div>
    <div class="pad" style="margin:8px 0 14px"><button class="btn-primary" data-act="startPicked" data-r="${r.id}">${ic(P.play, 18, 'none', 0, '#000')}Start</button></div>
    ${body}
    <div class="card list nobadge" style="margin-top:14px"><label class="row chk" style="padding:0 16px"><span class="t"><b style="font-size:16px">In rotation</b></span><input type="checkbox" data-act="toggleRot" data-id="${r.id}" ${inRot ? 'checked' : ''}></label></div>
    ${!D.isSeedRoutine(r.id) ? `<div class="pad mt16"><button class="btn-secondary danger" data-act="delRoutine" data-id="${r.id}">${ic(P.trash, 18)} Delete routine</button></div>` : ''}`;
  return { html, tab: 'Routines' };
}
on('cueEx', (el) => W.cueSheet(el.dataset.id));
on('toggleRot', (el) => { const id = el.dataset.id; const rot = D.getRotation(); D.setRotation(el.checked ? [...rot, id] : rot.filter(x => x !== id)); toast(el.checked ? 'Added to rotation' : 'Removed from rotation'); });
on('delRoutine', async (el) => { if (!(await confirmSheet('Delete routine?', 'Past sessions stay in your history.', 'Delete', true))) return; const r = D.routine(el.dataset.id); db.del('routines', r.id); D.setRotation(D.getRotation().filter(x => x !== r.id)); go('#/routines'); });

// ---------------------------------------------------------------- ROUTINE EDITOR
let rEdit = null;
export function routineEdit(id) {
  if (!rEdit || rEdit._for !== id) {
    const src = id === 'new' ? { id: uid('rt-'), name: '', subtitle: '', kind: 'straight', rounds: 3, items: [], source: 'My routine' } : structuredClone(D.routine(id));
    if (src.kind === 'circuit' && !src.roundsOptions) src.roundsOptions = [2, 3, 4];
    rEdit = { ...src, _for: id };
  }
  const r = rEdit; const circ = r.kind === 'circuit';
  const items = r.items.map((it, i) => { const ex = D.exercise(it.ex) || { name: it.ex };
    return `<div class="card" style="padding:12px 14px;margin-bottom:8px"><div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:16px">${circ ? i + 1 : (it.withPrev ? '↳ ' : '')}${circ ? '. ' : ''}${esc(ex.name)}</b>
      <button class="smallbtn" data-act="reMove" data-i="${i}" data-d="-1" aria-label="Move up">${ic(P.chevU, 16)}</button><button class="smallbtn" data-act="reMove" data-i="${i}" data-d="1" aria-label="Move down">${ic(P.chevD, 16)}</button><button class="smallbtn" data-act="reDel" data-i="${i}" aria-label="Remove">${ic(P.x, 16)}</button></div>
      <div style="display:flex;gap:8px;margin-top:8px">${circ ? '' : `<label class="field" style="flex:1;margin:0"><span>Sets</span><input class="input num" inputmode="numeric" data-re="sets" data-i="${i}" value="${it.sets ?? 3}"></label>`}
      <label class="field" style="flex:1;margin:0"><span>Target reps</span><input class="input num" data-re="reps" data-i="${i}" value="${esc(it.reps ?? '')}" placeholder="e.g. 8-12"></label>
      <label class="field" style="flex:1;margin:0"><span>Rest (s)</span><input class="input num" inputmode="numeric" data-re="rest" data-i="${i}" value="${it.rest ?? ''}" placeholder="${ex.rest || 90}"></label></div>
      ${circ ? `<label class="chk"><input type="checkbox" data-re="eachSide" data-i="${i}" ${it.eachSide ? 'checked' : ''}> Each side</label>` : (i ? `<label class="chk"><input type="checkbox" data-re="withPrev" data-i="${i}" ${it.withPrev ? 'checked' : ''}> Superset with the exercise above</label>` : '')}</div>`; }).join('');
  const html = `<div class="nav"><a class="txtbtn dim" href="${id === 'new' ? '#/routines' : '#/routine/' + encodeURIComponent(id)}" data-act="reCancel">Cancel</a><div class="center">${id === 'new' ? 'New routine' : 'Edit routine'}</div><div class="right"><button class="txtbtn" style="color:var(--accent);font-weight:600" data-act="reSave">Save</button></div></div>
    <div class="form"><label class="field"><span>Name</span><input class="input" data-re="name" value="${esc(r.name)}" placeholder="e.g. Home core"></label>
    <label class="field"><span>Subtitle</span><input class="input" data-re="subtitle" value="${esc(r.subtitle || '')}" placeholder="e.g. Upper Body"></label>
    <label class="field"><span>Type</span><select class="input" data-re="kind"><option value="straight" ${!circ ? 'selected' : ''}>Sets (straight sets / supersets)</option><option value="circuit" ${circ ? 'selected' : ''}>Circuit (round by round)</option></select></label>
    ${circ ? `<label class="field"><span>Default rounds</span><input class="input num" inputmode="numeric" data-re="rounds" value="${r.rounds || 3}"></label>` : ''}
    <div class="lbl2">Exercises</div></div>${items || '<div class="empty" style="padding:16px">No exercises yet</div>'}
    <div class="pad"><button class="btn-secondary" data-act="reAdd">${ic(P.plus, 18)} Add exercise</button>
    ${D.isSeedRoutine(r.id) && db.get('routines', r.id) ? `<button class="btn-secondary danger mt8" data-act="reReset">Reset to original</button>` : ''}</div>`;
  return { html, noTab: true };
}
export function onRoutineEditInput(el) {
  if (!rEdit) return; const f = el.dataset.re; const i = el.dataset.i;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  if (i != null) { const it = rEdit.items[+i]; if (f === 'sets' || f === 'rest') it[f] = num(val); else it[f] = val; }
  else if (f === 'rounds') rEdit.rounds = num(val) || 3;
  else rEdit[f] = val;
  if (f === 'kind') { if (val === 'circuit') rEdit.roundsOptions = [2, 3, 4]; go(location.hash); }
}
on('reMove', (el) => { const a = rEdit.items; const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; go(location.hash); });
on('reDel', (el) => { rEdit.items.splice(+el.dataset.i, 1); go(location.hash); });
on('reAdd', async () => { const id = await W.pickExercise('Add to routine'); if (!id) return; if (id === '__new') return go('#/exercise-edit/new'); const ex = D.exercise(id); rEdit.items.push({ ex: id, sets: 3, reps: '', rest: ex.rest || null, eachSide: ex.eachSide }); go(location.hash); });
on('reCancel', () => { rEdit = null; });
on('reReset', async () => { if (await confirmSheet('Reset routine?', 'Your edits to this built-in routine will be removed.', 'Reset', true)) { db.del('routines', rEdit.id); const id = rEdit.id; rEdit = null; go('#/routine/' + id); } });
on('reSave', () => {
  const r = rEdit; if (!r.name.trim()) return toast('Give the routine a name'); if (!r.items.length) return toast('Add at least one exercise');
  const out = { ...r }; delete out._for; out.name = r.name.trim();
  D.saveRoutine(out); rEdit = null; toast('Routine saved'); go('#/routine/' + encodeURIComponent(out.id));
});

// ---------------------------------------------------------------- EXERCISES
let exFilter = '';
export function exercises() {
  const all = D.allExercises();
  const groups = {};
  for (const e of all) { const g = D.isSeedExercise(e.id) ? (e.group || e.source) : 'My exercises'; (groups[g] = groups[g] || []).push(e); }
  const order = ['My exercises', ...(D.SEED.groupOrder || [])];
  const lastMap = new Map(); for (const st of db.list('sets')) if (!st.deleted) lastMap.set(st.exerciseId, Math.max(lastMap.get(st.exerciseId) || 0, st.date || 0));
  const sec = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99).map(g => `<div class="section-label" data-group>${esc(g)}</div><div class="card list nobadge" style="border-radius:16px">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map(e =>
    `<a class="row" href="#/exercise/${encodeURIComponent(e.id)}" data-name="${esc(e.name.toLowerCase())}"><div class="t"><b>${esc(e.name)}</b><span>${esc([e.fields.map(f => f === 'rir' || f === 'rpe' || f === 'hr' ? f.toUpperCase() : f).join(' · '), e.eachSide ? 'each side' : '', e.rehab === 'rehab' ? 'rehab' : ''].filter(Boolean).join(' · '))}</span></div><div class="when">${lastMap.get(e.id) ? fmtShort(lastMap.get(e.id)) : ''}</div>${ic(P.chevR, 16, '#5a5a5e', 2.4)}</a>`).join('')}</div>`).join('');
  const html = `<div class="hdr"><div><div class="eyebrow">Library · ${all.length}</div><h1>Exercises</h1></div><a class="circbtn" href="#/exercise-edit/new" aria-label="New exercise" style="margin-bottom:3px">${ic(P.plus, 20, '#fff', 2.4)}</a></div>
    <div class="searchbox">${ic(P.search, 18, '#8e8e93')}<input type="search" placeholder="Search" data-filter="lib" value="${esc(exFilter)}" autocomplete="off"></div>${sec}
    ${(D.SEED.libraryNotes || []).map(n => `<p class="muted pad" style="font-size:12.5px;margin:14px 20px">${esc(n)}</p>`).join('')}
    ${D.installedPacks().length ? '' : `<div class="pad mt16">${importBtn('Import your programmes', 'btn-secondary')}</div>`}`;
  return { html, tab: 'Exercises', after: () => { if (exFilter) applyFilter('lib', exFilter); } };
}
export function applyFilter(kind, q) {
  q = q.trim().toLowerCase(); if (kind === 'lib') exFilter = q;
  const scope = kind === 'pick' ? document.querySelector('.sheet-wrap:last-child .sheet') : document.getElementById('view');
  if (!scope) return;
  scope.querySelectorAll('[data-name]').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.name.includes(q)));
  if (kind === 'lib') scope.querySelectorAll('.list').forEach(l => { const any = [...l.querySelectorAll('[data-name]')].some(x => !x.classList.contains('hidden')); l.classList.toggle('hidden', !any); const lab = l.previousElementSibling; if (lab && lab.hasAttribute('data-group')) lab.classList.toggle('hidden', !any); });
}

// ---------------------------------------------------------------- EXERCISE HISTORY
function setRowHTML(st, label, ex) {
  const v = [];
  if (st.weight != null) v.push(`<b>${fmtNum(st.weight)}</b>kg`);
  if (st.reps != null) v.push(`${st.weight != null ? '<span class="x">×</span>' : ''}<b>${fmtNum(st.reps)}</b>${st.weight == null ? ' reps' : ''}`);
  if (st.timeSec != null) v.push(`${v.length ? '<span class="x">·</span>' : ''}<b>${fmtClock(st.timeSec)}</b>`);
  if (st.flights != null) v.push(`${v.length ? '<span class="x">·</span>' : ''}<b>${fmtNum(st.flights)}</b> flights`);
  if (st.hr != null) v.push(`${v.length ? '<span class="x">·</span>' : ''}<b>${fmtNum(st.hr)}</b> bpm`);
  if (st.variant) v.push(`<span style="margin-left:6px">${esc(st.variant)}</span>`);
  const right = st.rir != null ? `RIR <b>${fmtNum(st.rir)}</b>` : st.rpe != null ? `RPE <b>${fmtNum(st.rpe)}</b>` : '';
  return `<button class="sr num" data-act="editSet" data-id="${esc(st.id)}"><div class="rn">${esc(label)}</div><div class="v">${v.join('') || '<span>–</span>'}</div><div class="rir">${right}</div></button>`;
}
export function exerciseHist(id) {
  const ex = D.exercise(id);
  if (!ex) return { html: `<div class="nav">${back('Exercises', '#/exercises')}</div><div class="empty">Exercise not found.</div>`, tab: 'Exercises' };
  const h = D.exerciseHistory(id);
  const tags = [ex.eachSide ? 'each side' : '', ex.rest ? `rest ${ex.rest}s` : '', D.equipLabel(ex.equip), ex.rehab === 'rehab' ? 'rehab (inferred)' : ex.rehab === 'load' ? 'knee loading (inferred)' : '', ex.rangeKg || ''].filter(Boolean);
  const cards = h.map((x, i) => {
    const prev = h[i + 1]; const mx = (s) => Math.max(...s.sets.map(y => y.weight ?? -1));
    let right = `<span>${x.sets.length} ${x.sets.some(s => s.round) ? 'round' : 'set'}${x.sets.length === 1 ? '' : 's'}</span>`;
    if (prev && mx(x) > mx(prev) && mx(prev) >= 0) right = `<div class="up">${ic(P.up, 14, A_COLOR, 2.8)}+${fmtNum(mx(x) - mx(prev))} kg</div>`;
    const rows = x.sets.map((st, j) => setRowHTML(st, st.round ? `Round ${st.round}` : st.block && /^(Sequence|Interval)/.test(st.block) ? st.block : `Set ${j + 1}`, ex)).join('');
    const notes = [...new Set(x.sets.map(s => s.note).filter(Boolean))];
    const sw = x.sets.find(s => s.swappedFrom);
    return `<div class="card sess"><div class="sh"><div><b>${fmtDate(x.session.startedAt)}</b> <span>· ${esc(x.session.routineName || '')}${x.session.week ? ' · S' + x.session.week : ''}</span></div>${right}</div>${rows}
      ${sw ? `<div class="snote">Swapped in for ${esc(D.exercise(sw.swappedFrom)?.name || '')}</div>` : ''}${notes.map(n => `<div class="snote">${esc(n)}</div>`).join('')}</div>`;
  }).join('');
  const html = `<div class="nav">${back('Exercises', '#/exercises')}<div class="right"><button class="circbtn" data-act="exHistMenu" data-id="${esc(id)}" aria-label="More options">${ic(P.dots, 18, 'none', 0, '#fff')}</button></div></div>
    <div class="ttl"><h1>${esc(ex.name)}</h1><div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
    <div class="pad" style="margin:10px 0 4px"><button class="btn-secondary" data-act="cueEx" data-id="${esc(id)}">${ic(P.info, 18)} Cues, notes & video</button></div>
    <div class="section-label">Sessions · newest first</div>${cards || '<div class="empty">No sets logged yet.</div>'}`;
  return { html, tab: 'Exercises' };
}
on('exHistMenu', async (el) => {
  const id = el.dataset.id;
  const v = await actionSheet(D.exercise(id).name, [{ label: 'Edit exercise', v: 'edit', icon: P.edit }, { label: 'Cues & video', v: 'cue', icon: P.info }, { label: 'Log a set by hand', v: 'add', icon: P.plus }]);
  if (v === 'edit') go('#/exercise-edit/' + encodeURIComponent(id));
  else if (v === 'cue') W.cueSheet(id);
  else if (v === 'add') manualSet(id);
});
async function manualSet(exId) {
  const ex = D.exercise(exId);
  const d = W.defaultSet(exId);
  const res = await setForm(ex, { date: Date.now(), ...d.vals }, true, d.src); if (!res) return;
  const ts = res.date || Date.now();
  const sess = { id: uid('ses'), routineId: null, routineName: 'Logged by hand', kind: 'manual', startedAt: ts, endedAt: ts, durationSec: null };
  D.saveSession(sess);
  D.saveSet({ id: uid('set'), sessionId: sess.id, exerciseId: exId, exerciseName: ex.name, date: ts, order: 0, setNo: 1, ...res.vals, routineName: sess.routineName });
  sync.soon(); go(location.hash);
}
const sfDisp = (f, v) => (v == null || v === '' ? '–' : f === 'time' ? fmtClock(v) : fmtNum(v) + (f === 'weight' ? ' kg' : ''));
function setForm(ex, st, withDate = false, src = {}) {
  const fields = [...new Set([...(ex ? ex.fields : []), ...['weight', 'reps', 'rir', 'rpe', 'time', 'flights', 'hr', 'variant'].filter(f => st[f === 'time' ? 'timeSec' : f] != null)])];
  const lab = { weight: 'Weight (kg)', reps: 'Reps', rir: 'RIR', rpe: 'RPE', time: 'Time (m:ss)', flights: 'Flights', hr: 'Avg HR (bpm)', variant: 'Variant' };
  const raw = (f) => (f === 'time' ? st.timeSec : st[f]);
  const d = new Date(st.date || Date.now()); const dv = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return ask(`<div class="sh-title" data-ex="${esc(ex ? ex.id : st.exerciseId)}">${esc(ex ? ex.name : st.exerciseName)}</div>
    ${withDate ? `<label class="field"><span>Date</span><input class="input" type="date" id="sf_date" value="${dv}"></label>` : `<p class="sh-body" style="margin:0 0 6px">${fmtDate(st.date)}${st.block ? ' · ' + esc(st.block) : ''}</p>`}
    ${Object.keys(src).length ? '<p class="tl pretl nolead" style="margin:0 0 4px"><i class="predot"></i>Pre-filled from your history · tap a value to change it</p>' : ''}
    <div class="chkgrid">${fields.map(f => f === 'variant' ? `<label class="field"><span>${lab[f]}</span><input class="input" id="sf_variant" value="${esc(st.variant ?? '')}"></label>`
      : `<label class="field"><span>${lab[f]}</span><button type="button" class="input num sfbtn${src[f === 'time' ? 'timeSec' : f] ? ' pre' : ''}" id="sf_${f}" data-act="sfPick" data-f="${f}" data-v="${raw(f) ?? ''}">${sfDisp(f, raw(f))}</button></label>`).join('')}</div>
    ${W.fieldHelpHTML(fields, 'insheet')}
    <label class="field"><span>Note</span><input class="input" id="sf_note" value="${esc(st.note || '')}"></label>
    <button class="btn-primary mt8" data-act="sfSave" data-fields="${fields.join(',')}">Save</button>
    ${!withDate ? `<button class="btn-secondary danger mt8" data-act="resolveSheet" data-v="__delete">${ic(P.trash, 18)} Delete set</button>` : ''}`);
}
on('sfSave', (el) => {
  const sh = el.closest('.sheet'); const vals = {};
  for (const f of el.dataset.fields.split(',').filter(Boolean)) {
    const el2 = sh.querySelector('#sf_' + f);
    if (f === 'variant') { vals.variant = el2.value.trim() || null; continue; }
    const x = el2.dataset.v === '' ? null : Number(el2.dataset.v);
    if (f === 'time') vals.timeSec = x; else if (f === 'rpe') vals.rpe = D.clampRpe(x); else vals[f] = x;
  }
  vals.note = sh.querySelector('#sf_note').value.trim() || null;
  const dt = sh.querySelector('#sf_date');
  closeSheet({ vals, date: dt && dt.value ? new Date(dt.value + 'T12:00:00').getTime() : null });
});
on('sfPick', async (el) => {
  const f = el.dataset.f; const sh = el.closest('.sheet'); const ex = D.exercise(sh.querySelector('[data-ex]').dataset.ex) || { equip: null, name: '' };
  const cur = el.dataset.v === '' ? null : Number(el.dataset.v); let nv;
  if (f === 'weight') { const r = await W.weightSheet(ex, cur); if (!r) return; nv = r.w; }
  else if (f === 'time') { nv = await W.durationSheet(cur ?? 30, 'Time', 99); if (nv == null) return; }
  else { const r = await W.numSheet(f, cur, { eyebrow: ex.name, clear: true }); if (!r) return; nv = r.clear ? null : r.values[0]; }
  el.dataset.v = nv ?? ''; el.textContent = sfDisp(f, nv); el.classList.remove('pre');
});
on('editSet', async (el) => {
  const st = db.get('sets', el.dataset.id); if (!st) return;
  const res = await setForm(D.exercise(st.exerciseId), st);
  if (!res) return;
  if (res === '__delete') { if (await confirmSheet('Delete this set?', '', 'Delete', true)) { D.deleteSet(st); toast('Set deleted'); sync.soon(); go(location.hash); } return; }
  D.saveSet({ ...st, ...res.vals }); toast('Set updated'); sync.soon(); go(location.hash);
});

// ---------------------------------------------------------------- EXERCISE EDITOR
let exEdit = null;
const FIELD_LABELS = { weight: 'Weight', reps: 'Reps', rir: 'RIR', rpe: 'RPE', time: 'Time', flights: 'Flights', hr: 'Avg HR', variant: 'Variant' };
export function exerciseEdit(id) {
  if (!exEdit || exEdit._for !== id) {
    const src = id === 'new' ? { id: uid('my-'), name: '', fields: ['weight', 'reps', 'rpe'], equip: null, eachSide: false, rest: 90, tempo: '', rehab: null, video: '', cues: [], srcNotes: [], variants: [], source: 'My exercise', group: 'My exercises', custom: true }
      : structuredClone(D.exercise(id));
    exEdit = { ...src, _for: id, _notes: D.myNotes(src.id) };
  }
  const e = exEdit;
  const html = `<div class="nav"><a class="txtbtn dim" href="${id === 'new' ? '#/exercises' : '#/exercise/' + encodeURIComponent(id)}" data-act="exCancel">Cancel</a><div class="center">${id === 'new' ? 'New exercise' : 'Edit exercise'}</div><div class="right"><button class="txtbtn" style="color:var(--accent);font-weight:600" data-act="exSave">Save</button></div></div>
    <div class="form"><label class="field"><span>Name</span><input class="input" data-ee="name" value="${esc(e.name)}" placeholder="e.g. Goblet squat"></label>
    <div class="lbl2">Fields to log</div><div class="chkgrid">${Object.entries(FIELD_LABELS).map(([f, l]) => `<label class="chk"><input type="checkbox" data-ee="field" data-f="${f}" ${e.fields.includes(f) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    ${W.fieldHelpHTML(['rir', 'rpe'], 'inpicker')}
    <label class="field"><span>Equipment (sets the weight picker)</span><select class="input" data-ee="equip">${[['', 'None / bodyweight'], ['kb', 'Kettlebell (12/16/20/24 kg)'], ['db', 'Dumbbell (2 kg steps)'], ['bb', 'Barbell (2.5 kg steps)'], ['machine', 'Machine / cable (2.5 kg steps)'], ['plate', 'Plates (2.5 kg steps)']].map(([v, l]) => `<option value="${v}" ${(e.equip || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="chk"><input type="checkbox" data-ee="eachSide" ${e.eachSide ? 'checked' : ''}> Each side</label>
    <div style="display:flex;gap:10px"><label class="field" style="flex:1"><span>Rest (seconds)</span><input class="input num" inputmode="numeric" data-ee="rest" value="${e.rest ?? ''}"></label>
    <label class="field" style="flex:1"><span>Tempo</span><input class="input num" data-ee="tempo" value="${esc(e.tempo || '')}" placeholder="e.g. 3010"></label></div>
    <label class="field"><span>Rehab tag</span><select class="input" data-ee="rehab"><option value="" ${!e.rehab ? 'selected' : ''}>None</option><option value="rehab" ${e.rehab === 'rehab' ? 'selected' : ''}>Knee rehab</option><option value="load" ${e.rehab === 'load' ? 'selected' : ''}>Knee loading</option></select></label>
    <label class="field"><span>Variants (comma separated)</span><input class="input" data-ee="variants" value="${esc((e.variants || []).join(', '))}" placeholder="e.g. kneeling, standing"></label>
    <label class="field"><span>Video link</span><input class="input" type="url" data-ee="video" value="${esc(e.video || '')}" placeholder="https://"></label>
    <label class="field"><span>Recap bullets (one per line)</span><textarea class="input" data-ee="cues" rows="4">${esc((e.cues || []).join('\n'))}</textarea></label>
    <label class="field"><span>My notes</span><textarea class="input" data-ee="_notes" rows="3">${esc(e._notes || '')}</textarea></label>
    ${D.isSeedExercise(e.id) && db.get('exercises', e.id) ? `<button class="btn-secondary danger mt8" data-act="exReset">Reset to original</button>` : ''}
    ${!D.isSeedExercise(e.id) && id !== 'new' ? `<button class="btn-secondary danger mt8" data-act="exDelete">${ic(P.trash, 18)} Delete exercise</button>` : ''}</div>`;
  return { html, noTab: true };
}
export function onExEditInput(el) {
  if (!exEdit) return; const f = el.dataset.ee;
  if (f === 'field') { const s = new Set(exEdit.fields); el.checked ? s.add(el.dataset.f) : s.delete(el.dataset.f); exEdit.fields = Object.keys(FIELD_LABELS).filter(x => s.has(x)); }
  else if (f === 'eachSide') exEdit.eachSide = el.checked;
  else if (f === 'rest') exEdit.rest = num(el.value);
  else if (f === 'variants') exEdit.variants = el.value.split(',').map(x => x.trim()).filter(Boolean);
  else if (f === 'cues') exEdit.cues = el.value.split('\n').map(x => x.trim()).filter(Boolean);
  else if (f === 'equip' || f === 'rehab') exEdit[f] = el.value || null;
  else exEdit[f] = el.value;
}
on('exCancel', () => { exEdit = null; });
on('exSave', () => {
  const e = exEdit; if (!e.name.trim()) return toast('Give the exercise a name'); if (!e.fields.length) return toast('Choose at least one field');
  if (e.variants.length && !e.fields.includes('variant')) e.fields.push('variant');
  const out = { ...e, name: e.name.trim() }; delete out._for; delete out._notes;
  D.saveExercise(out); D.setMyNotes(out.id, e._notes || ''); exEdit = null; toast('Exercise saved'); go('#/exercise/' + encodeURIComponent(out.id));
});
on('exReset', async () => { if (await confirmSheet('Reset exercise?', 'Your edits to this built-in exercise will be removed (your notes stay).', 'Reset', true)) { db.del('exercises', exEdit.id); const id = exEdit.id; exEdit = null; go('#/exercise/' + encodeURIComponent(id)); } });
on('exDelete', async () => { if (await confirmSheet('Delete exercise?', 'Logged sets stay in your history.', 'Delete', true)) { D.saveExercise({ ...D.exercise(exEdit.id), deleted: true }); exEdit = null; go('#/exercises'); } });

// ---------------------------------------------------------------- HISTORY
export function history() {
  const sm = D.weeklySummary(); const ss = D.sessions().filter(s => s.endedAt || s.imported);
  let lastMonth = '', list = '';
  for (const s of ss) {
    const m = fmtMonth(s.startedAt);
    if (m !== lastMonth) { if (lastMonth) list += '</div>'; list += `<div class="section-label">${esc(m)}</div><div class="card list nobadge" style="border-radius:16px">`; lastMonth = m; }
    const nsets = D.setsOf(s.id).length;
    const meta = [s.durationSec ? fmtDur(s.durationSec) : '', nsets ? `${nsets} set${nsets === 1 ? '' : 's'}` : '', s.effort ? `effort ${s.effort}` : '',
      s.kneeBefore != null || s.kneeAfter != null ? `knee ${s.kneeBefore ?? '–'}→${s.kneeAfter ?? '–'}` : '', s.imported ? 'imported' : ''].filter(Boolean).join(' · ');
    list += `<a class="row" href="#/session/${encodeURIComponent(s.id)}"><div class="t"><b>${esc(s.routineName)}${s.seriesNum ? '' : ''}</b><span>${esc(s.title ? s.title + ' · ' : '')}${esc(meta)}</span></div><div class="when">${fmtDate(s.startedAt)}</div>${ic(P.chevR, 16, '#5a5a5e', 2.4)}</a>`;
  }
  if (lastMonth) list += '</div>';
  const knees = ss.filter(s => s.kneeAfter != null || s.kneeBefore != null).slice(0, 8).reverse();
  const kneeRow = knees.length ? `<div class="section-label">Knee check-ins · latest ${knees.length}</div><div class="card" style="padding:12px 16px;display:flex;gap:6px;align-items:flex-end;height:96px">${knees.map(s => { const v = s.kneeAfter ?? s.kneeBefore; return `<div style="flex:1;text-align:center"><div class="num" style="font-size:13px;font-weight:700">${s.kneeBefore ?? '–'}→${s.kneeAfter ?? '–'}</div><div style="height:${6 + v * 4}px;background:#3a3a3c;border-radius:4px;margin-top:4px"></div><div class="muted" style="font-size:10px;margin-top:3px">${fmtShort(s.startedAt)}</div></div>`; }).join('')}</div>` : '';
  const html = `<div class="hdr"><div><div class="eyebrow">Weekly summary</div><h1>History</h1></div><button class="circbtn" style="margin-bottom:3px" data-act="exportCSV" aria-label="Export CSV">${ic(P.share, 19, '#fff', 2)}</button></div>
    <div class="card summary num"><div><b>${sm.sessions}</b><span>sessions</span></div><div><b>${fmtDur(sm.totalSec).replace(' min', '')}</b><span>${sm.totalSec >= 3600 ? 'time' : 'minutes'}</span></div><div><b>${sm.bests}</b><span>new bests</span></div><div><b>${sm.streak}</b><span>wk streak</span></div></div>
    ${kneeRow}${list || '<div class="empty">No sessions yet. Start one from Today.</div>'}`;
  return { html, tab: 'History' };
}
export function sessionDetail(id) {
  const s = db.get('sessions', id);
  if (!s || s.deleted) return { html: `<div class="nav">${back('History', '#/history')}</div><div class="empty">Session not found.</div>`, tab: 'History' };
  const sets = D.setsOf(id); const byEx = new Map();
  for (const st of sets) { if (!byEx.has(st.exerciseId)) byEx.set(st.exerciseId, []); byEx.get(st.exerciseId).push(st); }
  const cards = [...byEx].map(([exId, list]) => { const ex = D.exercise(exId);
    return `<div class="card setcard"><h3><a href="#/exercise/${encodeURIComponent(exId)}">${esc(ex ? ex.name : list[0].exerciseName)}</a><span>${list[0].swappedFrom ? 'swapped in' : ''}</span></h3>${list.map((st, j) => setRowHTML(st, st.round ? `Round ${st.round}` : st.block && st.block.length < 12 ? st.block : `Set ${j + 1}`, ex)).join('')}${[...new Set(list.map(x => x.note).filter(Boolean))].map(n => `<div class="snote">${esc(n)}</div>`).join('')}</div>`; }).join('');
  const pills = [s.durationSec ? fmtDur(s.durationSec) : '', s.week ? `Week S${s.week}` : '', s.roundsDone != null && s.kind === 'circuit' ? `${s.roundsDone}/${s.rounds} rounds` : '', s.roundsDone != null && s.series ? `${s.roundsDone} rounds` : '', s.intervals ? `${s.roundsDone ?? 0}/${s.rounds} intervals logged` : '', s.intervals && s.intervals.timerSec ? `timer ${fmtClock(s.intervals.timerSec)}${s.intervals.timerDone ? '' : ' (stopped early)'}` : '',
    s.effort ? `effort ${s.effort}/10` : '', s.forTimeSec ? `for time ${fmtClock(s.forTimeSec)}` : '', s.warmup || ''].filter(Boolean);
  const html = `<div class="nav">${back('History', '#/history')}</div>
    <div class="ttl"><div class="eyebrow">${esc(fmtDate(s.startedAt))}${s.imported ? '' : ' · ' + fmtTime(s.startedAt)}</div><h1>${esc(s.routineName)}</h1>${s.title ? `<div class="muted" style="font-size:18px;font-weight:600;margin-top:2px">${esc(s.title)}</div>` : ''}</div>
    <div class="pillstat" style="margin-top:10px">${pills.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</div>
    <div class="card list nobadge" style="border-radius:16px"><button class="kv2" data-act="sessKnee" data-id="${esc(id)}" data-w="kneeBefore"><span>Knee before</span><b class="num">${s.kneeBefore ?? '–'}</b></button><button class="kv2" data-act="sessKnee" data-id="${esc(id)}" data-w="kneeAfter"><span>Knee after</span><b class="num">${s.kneeAfter ?? '–'}</b></button>
    ${s.series ? `<button class="kv2" data-act="sessDur" data-id="${esc(id)}"><span>Duration</span><b class="num">${fmtClock(s.durationSec || 0)}</b></button>` : ''}</div>
    ${(s.ladder || []).length ? `<div class="section-label">Ladder</div><div class="card list nobadge">${s.ladder.map(l => `<div class="kv2"><span>${esc(l.name)}${l.weight ? ' · ' + fmtNum(l.weight) + ' kg' : ''}</span><b class="num">${fmtClock(l.timeSec || 0)} · ${l.rungs}/${l.top}</b></div>`).join('')}</div>` : ''}
    <div class="section-label">Notes</div><div class="pad"><textarea class="notes" rows="2" data-sessnotes="${esc(id)}" placeholder="Add notes...">${esc(s.notes || '')}</textarea></div>
    ${cards ? `<div class="section-label">Sets · tap to fix</div>${cards}` : ''}
    <div class="pad mt16"><button class="btn-secondary danger" data-act="delSession" data-id="${esc(id)}">${ic(P.trash, 18)} Delete session</button></div>`;
  return { html, tab: 'History' };
}
on('sessKnee', async (el) => {
  const s = db.get('sessions', el.dataset.id); const w = el.dataset.w;
  const res = await W.kneeSheet('edit', { initial: s[w], title: w === 'kneeBefore' ? 'Knee pain before' : 'Knee pain after' }); if (!res) return;
  D.saveSession({ ...s, [w]: res.knee }); sync.soon(); go(location.hash);
});
on('sessDur', async (el) => {
  const s = db.get('sessions', el.dataset.id);
  const v = await W.durationSheet(s.durationSec || 0);
  if (v == null) return; D.saveSession({ ...s, durationSec: v }); sync.soon(); go(location.hash);
});
on('delSession', async (el) => { if (!(await confirmSheet('Delete session?', 'This removes the session and all its sets.', 'Delete', true))) return; D.deleteSession(db.get('sessions', el.dataset.id)); sync.soon(); go('#/history'); });
export function onSessNotes(el) { const s = db.get('sessions', el.dataset.sessnotes); if (s) { D.saveSession({ ...s, notes: el.value }); sync.soon(5000); } }

// ---------------------------------------------------------------- SETTINGS
export function settings() {
  const st = sync.status(); const url = sync.getUrl(); const pend = sync.pending();
  const eq = D.equipment();
  const persisted = window.__persisted; const packs = D.installedPacks();
  const line = !url ? 'Sync is off. Everything is saved on this phone.' : st.syncing ? 'Syncing…' : st.lastError ? `Last attempt failed: ${esc(st.lastError)}` : st.lastOk ? `Last synced ${ago(st.lastOk)}.` : 'Not synced yet.';
  const html = `<div class="hdr"><div><div class="eyebrow">Exercise Log</div><h1>Settings</h1></div></div>
    <div class="section-label">Google Sheet sync (optional)</div>
    <div class="setgroup"><p>Paste the web app URL from your Google Apps Script (see SETUP.md in the app folder). Records are sent in the background, one row per set or session, and retried when you're back online.</p>
      <label class="field"><span>Apps Script web app URL</span><input class="input" type="url" id="syncUrl" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <div class="btn-row"><button class="btn-secondary" data-act="saveSync">Save</button><button class="btn-primary" style="min-height:52px;font-size:17px" data-act="syncNow" ${url ? '' : 'disabled'}>Sync now</button></div>
      <div class="status-line${st.lastError && url ? ' err' : ''}">${line}</div><div class="status-line">${pend} record${pend === 1 ? '' : 's'} waiting.</div></div>
    <div class="section-label">Your data</div>
    <div class="setgroup"><p>Export every set and session as a CSV file (one row each), or make a full backup you can restore later.</p>
      <button class="btn-primary" data-act="exportCSV">${ic(P.share, 19, '#000', 2)} Export CSV</button>
      <div class="btn-row mt8"><button class="btn-secondary" data-act="backupJSON">Backup (JSON)</button>${importBtn('Restore / import', 'btn-secondary')}</div>
      <p>Restore takes a backup or a programmes file. Programmes files are merged: your logged sessions stay, and importing the same file again adds nothing twice.</p>
      <div class="status-line">${D.sessions().length} sessions · ${db.list('sets').filter(s => !s.deleted).length} sets stored on this phone. Storage ${persisted === true ? 'is persistent' : persisted === false ? 'may be cleared by Safari if unused for a long time (add to Home Screen to keep it)' : 'status unknown'}.</div></div>
    <div class="section-label">Equipment</div>
    <div class="setgroup"><label class="field"><span>Kettlebells (kg, comma separated)</span><input class="input num" id="kbList" value="${eq.kb.join(', ')}"></label>
      <div style="display:flex;gap:10px"><label class="field" style="flex:1"><span>DB step</span><input class="input num" id="dbStep" value="${eq.dbStep}"></label><label class="field" style="flex:1"><span>BB step</span><input class="input num" id="bbStep" value="${eq.bbStep}"></label><label class="field" style="flex:1"><span>Machine step</span><input class="input num" id="machineStep" value="${eq.machineStep}"></label></div>
      <button class="btn-secondary" data-act="saveEquip">Save equipment</button><p>You can always type any other weight.</p></div>
    ${D.allProgrammes().length ? `<div class="section-label">Programme weeks</div>
    <div class="setgroup">${D.allProgrammes().map(p => `<div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0"><span>${esc(p.name)}</span><div class="seg sm num">${[1, 2, 3, 4].map(n => `<button class="${n === D.progWeek(p.id) ? 'on' : ''}" data-act="setWeek" data-p="${p.id}" data-n="${n}">S${n}</button>`).join('')}</div></div>`).join('')}
      <p>The week moves on by itself once all three training days are logged for the current week.</p></div>` : ''}
    <div class="section-label">Programmes files</div>
    <div class="setgroup">${packs.length ? packs.map(pk => `<p><b>${esc(pk.name || pk.id)}</b><br>${(pk.content?.routines || []).length} routines · ${(pk.content?.exercises || []).length} exercises${pk.history?.count ? ` · ${pk.history.count} history entries` : ''} · imported ${esc(fmtDate(pk.importedAt))}</p>
      ${(pk.history?.skipped || []).length ? `<details class="skipped"><summary>${pk.history.skipped.length} history entries were skipped (ambiguous)</summary><ul class="bul sm">${pk.history.skipped.map(x => `<li><b>${esc(x.exercise)}</b> · ${esc(x.when)}: “${esc(x.written)}”<small>${esc(x.why)}</small></li>`).join('')}</ul></details>` : ''}`).join('')
      : '<p>None imported. The app has a few basic exercises; import a programmes file to add routines, cue sheets and video links.</p>'}
      ${importBtn('Import programmes file', 'btn-secondary')}</div>
    <div class="section-label">About</div>
    <div class="setgroup"><p>Offline-first: data lives in this phone's storage (IndexedDB). Beeps play at 10 s left and at 0 while the app is open; iPhone can't beep while locked. The screen stays awake while a timer runs.</p>
      ${db.kvGet('historyImported') ? '<p>Built-in history imported (see SKIPPED_HISTORY.md for the ambiguous ones that were left out).</p>' : ''}
      <button class="btn-secondary danger" data-act="wipeAll">Erase all data on this phone</button></div>`;
  return { html, tab: 'Settings' };
}
on('saveSync', async () => { const u = document.getElementById('syncUrl').value.trim(); if (u && !/^https:\/\//.test(u)) return toast('The URL should start with https://'); await sync.setUrl(u); toast(u ? 'Sync URL saved' : 'Sync turned off'); if (u) sync.soon(300); go(location.hash); });
on('syncNow', async () => { toast('Syncing…'); const r = await sync.syncNow(); toast(r.ok ? `Synced ${r.total} record${r.total === 1 ? '' : 's'}` : r.offline ? 'Offline – will retry' : r.error ? 'Sync failed: ' + r.error : 'Nothing to sync'); go(location.hash); });
on('saveEquip', () => {
  const kb = document.getElementById('kbList').value.split(',').map(x => num(x)).filter(x => x > 0).sort((a, b) => a - b);
  db.kvSet('equipment', { kb: kb.length ? kb : [12, 16, 20, 24], dbStep: num(document.getElementById('dbStep').value) || 2, bbStep: num(document.getElementById('bbStep').value) || 2.5, machineStep: num(document.getElementById('machineStep').value) || 2.5, plateStep: 2.5 });
  toast('Equipment saved');
});
on('wipeAll', async () => {
  if (!(await confirmSheet('Erase everything?', 'All sessions, sets, custom exercises and settings on this phone will be deleted. Make a backup first.', 'Erase', true))) return;
  await db.clearAll(); location.reload();
});
async function shareOrDownload(name, mime, text) {
  const file = new File([text], name, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
  } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return 'downloaded';
}
const stamp = () => new Date().toISOString().slice(0, 10);
on('exportCSV', async () => { const csv = D.buildCSV(); window.__lastCSV = csv; const r = await shareOrDownload(`exercise-log-${stamp()}.csv`, 'text/csv', csv); if (r !== 'cancelled') toast(r === 'shared' ? 'CSV shared' : 'CSV downloaded'); });
on('backupJSON', async () => { const r = await shareOrDownload(`exercise-log-backup-${stamp()}.json`, 'application/json', D.backupJSON()); if (r !== 'cancelled') toast('Backup ready'); });

// ---------------------------------------------------------------- SERIES (follow-along picker)
export function seriesPage(id, query) {
  const sr = D.series(id); if (!sr) return { html: '<div class="empty">Not found</div>' };
  const done = D.seriesDone(id); const next = D.nextSeriesNum(id); const switching = query.includes('switch=1');
  let lastCat = '', body = '';
  for (const s of sr.sessions) {
    const cat = s.category || 'Lessons';
    if (cat !== lastCat) { if (lastCat) body += '</div>'; body += `<div class="section-label">${esc(cat)}</div><div class="card list" style="border-radius:16px">`; lastCat = cat; }
    body += `<button class="row${s.num === next ? ' sel' : ''}" data-act="pickSeries" data-s="${id}" data-n="${s.num}" data-switch="${switching ? 1 : 0}"><div class="badge num${s.num > 9 ? ' sm' : ''}">${s.num}</div><div class="t"><b>${esc(s.title)}</b><span>${s.combos.length ? `${s.combos.length} combos` : 'video only'}${s.forTime ? ' · for time' : ''}${s.num === next ? ' · next up' : ''}</span></div>${done.has(s.num) ? ic(P.check, 18, A_COLOR, 2.8) : ''}</button>`;
  }
  body += '</div>';
  const html = `<div class="nav">${switching ? back('Session', '#/workout') : back('Today', '#/today')}</div><div class="ttl"><div class="eyebrow">${esc(sr.source || 'Follow-along')}</div><h1>${esc(sr.fullName)}</h1><p class="muted" style="font-size:14px;line-height:19px">${esc(sr.note)}</p></div>${body}`;
  return { html, tab: switching ? null : 'Today', noTab: switching };
}
on('pickSeries', (el) => {
  const n = +el.dataset.n;
  if (el.dataset.switch === '1' && W.A && W.A.fa) { W.switchSeriesNum(n); go('#/workout'); return; }
  W.startRoutine(el.dataset.s, { seriesNum: n });
});

// ---------------------------------------------------------------- DONE
export function done(id) {
  const s = db.get('sessions', id); if (!s) return today();
  const sets = D.setsOf(id);
  // new bests in this session vs everything before it
  let bests = [];
  const byEx = new Map(); sets.forEach(st => { if (!byEx.has(st.exerciseId)) byEx.set(st.exerciseId, []); byEx.get(st.exerciseId).push(st); });
  for (const [exId, list] of byEx) {
    const prev = D.exerciseHistory(exId, id).filter(x => x.session.startedAt < s.startedAt).flatMap(x => x.sets);
    if (!prev.length) continue;
    const pw = Math.max(...prev.map(x => x.weight ?? -1)), cw = Math.max(...list.map(x => x.weight ?? -1));
    const pr = Math.max(...prev.map(x => x.reps ?? -1)), cr = Math.max(...list.map(x => x.reps ?? -1));
    if (cw > pw && pw >= 0) bests.push(`${D.exercise(exId)?.name}: ${fmtNum(cw)} kg (was ${fmtNum(pw)})`);
    else if (cw < 0 && cr > pr && pr >= 0) bests.push(`${D.exercise(exId)?.name}: ${cr} reps (was ${pr})`);
  }
  const html = `<div class="done-hero"><div class="done-ring">${ic(P.check, 40, '#000', 3.2)}</div><div class="eyebrow">Saved</div><div style="font-size:28px;font-weight:700;margin-top:4px">${esc(s.routineName)}</div>${s.title ? `<div class="muted" style="font-size:17px;margin-top:2px">${esc(s.title)}</div>` : ''}
    <div class="big num">${fmtClock(s.durationSec || 0)}</div><div class="muted">${sets.length} set${sets.length === 1 ? '' : 's'}${s.kneeBefore != null || s.kneeAfter != null ? ` · knee ${s.kneeBefore ?? '–'} → ${s.kneeAfter ?? '–'}` : ''}${s.effort ? ` · effort ${s.effort}/10` : ''}</div></div>
    ${bests.length ? `<div class="section-label">New bests</div><div class="card" style="padding:12px 16px">${bests.map(b => `<div style="display:flex;gap:8px;align-items:center;min-height:30px">${ic(P.up, 15, A_COLOR, 2.8)}<span>${esc(b)}</span></div>`).join('')}</div>` : ''}
    <div class="pad mt16"><a class="btn-primary" href="#/today">Done</a><a class="btn-secondary mt8" href="#/session/${encodeURIComponent(id)}">View session</a></div>`;
  return { html, noTab: true };
}
