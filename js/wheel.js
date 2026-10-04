// iOS-style scroll wheels in a bottom sheet. Native scrolling + scroll-snap, so touch, mouse wheel,
// trackpad and keyboard (arrow keys) all work; tapping a number selects it (handy for tests too).
import { openSheet, closeSheet, on } from './ui.js';
import { esc } from './util.js';

export const ROW = 52;          // px per row (thumb-friendly, >= 44)
const PAD = 2;                  // rows of padding above/below so the first/last value can sit in the middle band
export function range(a, b, step = 1) { const out = []; for (let i = 0, x = a; x <= b + 1e-9; i++, x = a + i * step) out.push(Math.round(x * 100) / 100); return out; }
const pad2 = (n) => String(n).padStart(2, '0');
export const FMT = { pad2, kg: (v) => String(Math.round(v * 100) / 100) };

function withValue(values, v) {
  if (v == null || values.some(x => Math.abs(x - v) < 1e-9)) return values;
  return [...values, v].sort((a, b) => a - b);
}
function nearestIdx(values, v) {
  if (v == null) return 0;
  let best = 0; for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
  return best;
}
// w: { id, values, value, unit, fmt, label }
export function wheelHTML(w) {
  const values = withValue(w.values, w.value);
  const idx = nearestIdx(values, w.value);
  const fmt = w.fmt || String;
  return `<div class="wcol"><div class="wheel" data-wheel="${esc(w.id)}" data-idx="${idx}" tabindex="0" role="listbox" aria-label="${esc(w.label || w.unit || w.id)}">
    ${'<div class="wpad"></div>'.repeat(PAD)}${values.map((v, i) => `<div class="wi${i === idx ? ' on' : ''}" data-i="${i}" data-v="${v}" role="option" aria-selected="${i === idx}">${esc(fmt(v))}</div>`).join('')}${'<div class="wpad"></div>'.repeat(PAD)}
    </div>${w.unit ? `<div class="wunit">${esc(w.unit)}</div>` : ''}</div>`;
}
const items = (el) => el.querySelectorAll('.wi');
const clampIdx = (el, i) => Math.max(0, Math.min(items(el).length - 1, i));
function idxOf(el) { return el._t != null ? el._t : clampIdx(el, Math.round(el.scrollTop / ROW)); }
function mark(el, i) {
  if (el._on === i) return; el._on = i;
  items(el).forEach((n, j) => { const on = j === i; n.classList.toggle('on', on); n.setAttribute('aria-selected', on); });
  el.dataset.idx = i;
}
export function wheelValue(el) { const n = items(el)[idxOf(el)]; return n ? Number(n.dataset.v) : null; }
export function wheelValues(root) { return [...root.querySelectorAll('.wheel')].map(wheelValue); }
export function wheelGo(el, i, smooth = true) {
  i = clampIdx(el, i); el._t = i; mark(el, i);
  clearTimeout(el._tt);
  if (!smooth || !el.scrollTo) { el.scrollTop = i * ROW; el._t = null; return; }
  el.scrollTo({ top: i * ROW, behavior: 'smooth' });
  el._tt = setTimeout(() => { if (el._t != null) { el.scrollTop = el._t * ROW; el._t = null; } }, 700);
}
export function wheelSetValue(el, v, smooth = true) {
  const vals = [...items(el)].map(n => Number(n.dataset.v)); wheelGo(el, nearestIdx(vals, v), smooth);
}
export function initWheels(root) {
  root.querySelectorAll('.wheel').forEach(el => {
    const i0 = +el.dataset.idx || 0; el.scrollTop = i0 * ROW; mark(el, i0);
    requestAnimationFrame(() => { el.scrollTop = i0 * ROW; });   // after the sheet's layout settles
    let raf = 0;
    el.addEventListener('scroll', () => {
      if (raf) return; raf = requestAnimationFrame(() => {
        raf = 0;
        const i = clampIdx(el, Math.round(el.scrollTop / ROW));
        if (el._t != null) { if (Math.abs(el.scrollTop - el._t * ROW) < 2) el._t = null; else return; }
        mark(el, i);
      });
    }, { passive: true });
    const userScroll = () => { el._t = null; clearTimeout(el._tt); };
    el.addEventListener('wheel', userScroll, { passive: true });
    el.addEventListener('touchstart', userScroll, { passive: true });
    el.addEventListener('click', (ev) => { const n = ev.target.closest('.wi'); if (n) wheelGo(el, +n.dataset.i); });
    el.addEventListener('keydown', (ev) => {
      const d = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[ev.key]; if (!d) return;
      ev.preventDefault(); wheelGo(el, idxOf(el) + d);
    });
  });
}
// Open a sheet with one or more wheels. Resolves {values:[...]}, {clear:true}, an action payload, or undefined (dismissed).
// opts: { eyebrow, title, wheels:[...], sep, help, top, bottom, clear, doneLabel, cls, step:{label,fn} }
export function pickWheels(opts) {
  const ws = opts.wheels.map(wheelHTML);
  const step = opts.step ? `<div class="wstep"><button data-act="wheelStep" data-d="-1" aria-label="Step down">−</button><span>${esc(opts.step.label)}</span><button data-act="wheelStep" data-d="1" aria-label="Step up">+</button></div>` : '';
  const html = `${opts.eyebrow ? `<div class="eyebrow">${esc(opts.eyebrow)}</div>` : ''}${opts.title ? `<div class="sh-title">${esc(opts.title)}</div>` : ''}
    ${opts.top || ''}
    <div class="wbox${ws.length > 1 ? ' multi' : ''}">${ws.join(opts.sep ? `<div class="wsep">${esc(opts.sep)}</div>` : '')}</div>
    ${step}${opts.help ? `<p class="fhelp insheet wh">${opts.help}</p>` : ''}
    ${opts.bottom != null ? opts.bottom : `<button class="btn-primary mt12" data-act="wheelDone">${esc(opts.doneLabel || 'Done')}</button>
    ${opts.clear ? `<button class="btn-secondary mt8" data-act="wheelClear">Clear</button>` : ''}`}`;
  return new Promise(res => {
    const sh = openSheet(html, { cls: 'wsheet ' + (opts.cls || ''), onClose: res });
    sh._step = opts.step ? opts.step.fn : null;
    initWheels(sh);
  });
}
on('wheelDone', (el) => closeSheet({ values: wheelValues(el.closest('.sheet')) }));
on('wheelClear', () => closeSheet({ clear: true }));
on('wheelStep', (el) => {
  const sh = el.closest('.sheet'); const w = sh.querySelector('.wheel'); if (!w || !sh._step) return;
  wheelSetValue(w, sh._step(wheelValue(w), +el.dataset.d));
});
