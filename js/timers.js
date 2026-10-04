// Audio beeps, screen wake lock, global tick loop. Timers elsewhere store absolute timestamps
// (startAt/endAt) so they survive backgrounding, reloads and iOS suspending the page.
let ctx = null;
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* no audio */ }
}
export function beep(freq = 880, dur = 0.14, delay = 0, vol = 0.35) {
  if (!ctx) return; if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
  window.__beeps = (window.__beeps || 0) + 1; // test hook
}
export const beepWarn = () => beep(880, 0.16);
export const beepEnd = () => { beep(1046, 0.18, 0); beep(1046, 0.18, 0.28); beep(1318, 0.36, 0.56); };

let lock = null, wanted = false;
export async function setWake(on) {
  wanted = on;
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !lock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) { const l = lock; lock = null; await l.release(); }
  } catch (e) { lock = null; }
}
export const wakeActive = () => !!lock;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wanted) setWake(true); });

const subs = new Set();
export function onTick(fn) { subs.add(fn); return () => subs.delete(fn); }
setInterval(() => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }), 250);
document.addEventListener('visibilitychange', () => subs.forEach(f => { try { f(); } catch (e) { } }));
