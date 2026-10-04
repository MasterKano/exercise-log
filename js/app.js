// Bootstrap, router, global event delegation
import * as db from './db.js';
import * as D from './data.js';
import * as W from './workout.js';
import * as Pg from './pages.js';
import * as sync from './sync.js';
import { actions, tabbar, closeAllSheets, sheetOpen, toast } from './ui.js';
import { unlockAudio } from './timers.js';

const routes = [
  [/^#\/today$/, () => Pg.today()], [/^#\/routines$/, () => Pg.routines()], [/^#\/routine\/(.+)$/, (m) => Pg.routineDetail(decodeURIComponent(m[1]))],
  [/^#\/routine-edit\/(.+)$/, (m) => Pg.routineEdit(decodeURIComponent(m[1]))], [/^#\/exercises$/, () => Pg.exercises()],
  [/^#\/exercise\/(.+)$/, (m) => Pg.exerciseHist(decodeURIComponent(m[1]))], [/^#\/exercise-edit\/(.+)$/, (m) => Pg.exerciseEdit(decodeURIComponent(m[1]))],
  [/^#\/history$/, () => Pg.history()], [/^#\/session\/(.+)$/, (m) => Pg.sessionDetail(decodeURIComponent(m[1]))], [/^#\/settings$/, () => Pg.settings()],
  [/^#\/series\/([^?]+)(\?.*)?$/, (m) => Pg.seriesPage(m[1], m[2] || '')], [/^#\/done\/(.+)$/, (m) => Pg.done(decodeURIComponent(m[1]))], [/^#\/workout$/, () => W.view()],
];
const view = document.getElementById('view'), tabs = document.getElementById('tabs');
let lastRoute = null, lastTab = undefined;
function render() {
  const h = location.hash || '#/today';
  let out = null;
  for (const [re, fn] of routes) { const m = h.match(re); if (m) { out = fn(m); break; } }
  if (!out) { location.replace('#/today'); return; }
  const same = lastRoute === h; const y = window.scrollY;
  view.innerHTML = out.html;
  view.className = (out.noTab ? 'noTab' : '') + (out.withRest ? ' withRest' : '');
  const tab = out.noTab ? null : (out.tab || null);
  if (tab !== lastTab) { tabs.innerHTML = tab ? tabbar(tab) : ''; lastTab = tab; }
  if (same) window.scrollTo(0, y); else window.scrollTo(0, 0);
  lastRoute = h;
  if (out.after) out.after();
}
W.setRender(render);
window.addEventListener('hashchange', () => { if (sheetOpen()) closeAllSheets(); render(); });

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'INPUT') return; // handled on change
  const fn = actions[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'BUTTON') ev.preventDefault();
  try { fn(el, ev); } catch (e) { console.error(e); toast('Something went wrong: ' + e.message); }
});
let notesT = null;
document.addEventListener('input', (ev) => {
  const el = ev.target; const d = el.dataset;
  if (d.key && d.f) return W.onFieldInput(el);
  if (d.filter) return Pg.applyFilter(d.filter, el.value);
  if (d.re != null && el.type !== 'checkbox' && el.tagName !== 'SELECT') return Pg.onRoutineEditInput(el);
  if (d.ee != null && el.type !== 'checkbox' && el.tagName !== 'SELECT') return Pg.onExEditInput(el);
  if (d.mynotes) { clearTimeout(notesT); notesT = setTimeout(() => D.setMyNotes(d.mynotes, el.value), 300); return; }
  if (d.fa) return W.onFaNotes(el);
  if (d.sessnotes) { clearTimeout(notesT); notesT = setTimeout(() => Pg.onSessNotes(el), 400); }
});
document.addEventListener('change', (ev) => {
  const el = ev.target; const d = el.dataset;
  if (d.re != null && (el.type === 'checkbox' || el.tagName === 'SELECT')) return Pg.onRoutineEditInput(el);
  if (d.ee != null && (el.type === 'checkbox' || el.tagName === 'SELECT')) return Pg.onExEditInput(el);
  if (el.tagName === 'INPUT' && d.act && actions[d.act]) actions[d.act](el, ev);
});
// Enter/Done on number inputs closes the keyboard
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('.f input')) ev.target.blur(); });
['touchstart', 'pointerdown'].forEach(t => document.addEventListener(t, unlockAudio, { once: true, passive: true }));

async function boot() {
  try {
    await db.init();
    await D.loadSeed();
    D.importSeedHistory();
    W.loadActive();
    if (!location.hash || location.hash === '#') location.replace(W.A ? '#/workout' : '#/today');
    render();
    sync.start();
    sync.onStatus(() => { const h = location.hash; if ((h === '#/today' || h === '#/settings') && !sheetOpen() && !document.activeElement?.matches('input,textarea')) render(); });
    if (navigator.storage && navigator.storage.persist) {
      try { window.__persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { window.__persisted = null; }
    }
    window.__ready = true;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">Couldn't start: ${String(e.message || e)}</div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e));
  }
}
boot();
// test/debug hook
window.__app = { db, D, W, sync };
