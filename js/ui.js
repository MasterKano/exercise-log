// UI primitives: icons, sheets, toasts, action registry, router hooks
import { esc } from './util.js';
export const A_COLOR = '#22D3EE';
export function ic(path, size = 24, stroke = 'currentColor', sw = 2, fill = 'none') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
export const P = {
  check: '<path d="M5.5 12.5l4.2 4.2L18.5 7.8"/>', chevR: '<path d="M9 5.5l6.5 6.5L9 18.5"/>', chevL: '<path d="M15 4.5L7.5 12l7.5 7.5"/>',
  chevD: '<path d="M5.5 9l6.5 6.5L18.5 9"/>', chevU: '<path d="M5.5 15l6.5-6.5 6.5 6.5"/>', up: '<path d="M12 19V5.5M6 11.5L12 5.5l6 6"/>',
  play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/>',
  share: '<path d="M12 3.5v11M7.8 7.5L12 3.3l4.2 4.2"/><path d="M8 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H16"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>', minus: '<path d="M5.5 12h13"/>', x: '<path d="M7 7l10 10M17 7L7 17"/>',
  dots: '<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.7"/>', cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/>',
  swap: '<path d="M7 4L3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.8h5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
};
export const TAB_ICONS = {
  Today: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><rect x="7" y="13" width="3.2" height="3.2" rx=".8" fill="currentColor" stroke="none"/>',
  Routines: '<path d="M9.5 6.5h11M9.5 12h11M9.5 17.5h11"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  Exercises: '<rect x="5" y="6.5" width="3.4" height="11" rx="1.2"/><rect x="15.6" y="6.5" width="3.4" height="11" rx="1.2"/><path d="M2.6 9.5v5M21.4 9.5v5M8.4 12h7.2"/>',
  History: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.3V12l3.2 2"/>',
  Settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const TAB_ROUTES = { Today: '#/today', Routines: '#/routines', Exercises: '#/exercises', History: '#/history', Settings: '#/settings' };
export function tabbar(active) {
  return `<nav class="tabbar">${Object.entries(TAB_ICONS).map(([n, p]) =>
    `<a class="tab${n === active ? ' on' : ''}" href="${TAB_ROUTES[n]}" data-tab="${n}"><div class="ti">${ic(p, n === 'Settings' ? 23 : 25, 'currentColor', 1.9)}</div>${n}</a>`).join('')}</nav>`;
}
export const tick = (on, size = 30) => `<span class="tick${on ? ' on' : ''}" style="width:${size}px;height:${size}px">${on ? ic(P.check, Math.round(size * .53), '#000', 3) : ''}</span>`;
export const upArrow = (size = 15) => `<span class="uparr">${ic(P.up, size, A_COLOR, 2.8)}</span>`;

// ---------------- action registry (event delegation)
export const actions = {};
export function on(name, fn) { actions[name] = fn; }

// ---------------- sheets
let sheetStack = [];
export function openSheet(html, { cls = '', onClose = null, full = false } = {}) {
  const root = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="dim" data-act="closeSheet"></div><div class="sheet ${full ? 'full ' : ''}${cls}" role="dialog"><div class="grab"></div>${html}</div>`;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const entry = { wrap, onClose };
  sheetStack.push(entry);
  return wrap.querySelector('.sheet');
}
export function closeSheet(result) {
  const e = sheetStack.pop(); if (!e) return;
  e.wrap.classList.remove('in');
  setTimeout(() => e.wrap.remove(), 220);
  if (e.onClose) e.onClose(result);
}
export function closeAllSheets() { while (sheetStack.length) closeSheet(); }
export const sheetOpen = () => sheetStack.length > 0;
export function topSheet() { const e = sheetStack[sheetStack.length - 1]; return e ? e.wrap.querySelector('.sheet') : null; }

// promise-based sheet: resolve via closeSheet(value)
export function ask(html, opts = {}) { return new Promise(res => openSheet(html, { ...opts, onClose: res })); }

export function confirmSheet(title, body, okLabel = 'OK', danger = false, cancel = 'Cancel') {
  return ask(`<div class="sh-title">${esc(title)}</div>${body ? `<p class="sh-body">${body}</p>` : ''}
    <button class="btn-primary${danger ? ' danger' : ''}" data-act="resolveSheet" data-v="1">${esc(okLabel)}</button>
    <button class="btn-secondary mt8" data-act="resolveSheet" data-v="0">${esc(cancel)}</button>`).then(v => v === '1');
}
export function actionSheet(title, items) {
  // items: [{label, v, danger}]
  return ask(`${title ? `<div class="sh-title sm">${esc(title)}</div>` : ''}<div class="alist">${items.map(i =>
    `<button class="arow${i.danger ? ' danger' : ''}" data-act="resolveSheet" data-v="${esc(i.v)}">${i.icon ? ic(i.icon, 20) : ''}<span>${esc(i.label)}</span></button>`).join('')}</div>
    <button class="btn-secondary mt8" data-act="resolveSheet" data-v="">Cancel</button>`);
}
on('closeSheet', () => closeSheet());
on('resolveSheet', (el) => closeSheet(el.dataset.v));

// ---------------- toast
let toastT;
export function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('in');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('in'), 2600);
}
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
