// IndexedDB persistence with an in-memory mirror (data is small; everything is loaded at start).
const DB_NAME = 'exlog', DB_VER = 1;
const STORES = { sets: 'id', sessions: 'id', exercises: 'id', routines: 'id', kv: 'k' };
let db = null;
export const mem = { sets: new Map(), sessions: new Map(), exercises: new Map(), routines: new Map(), kv: new Map() };

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const [s, k] of Object.entries(STORES)) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: k });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function all(store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function init() {
  db = await open();
  for (const s of Object.keys(STORES)) {
    const rows = await all(s);
    for (const row of rows) mem[s].set(row[STORES[s]], row);
  }
}
// write queue: batches puts/deletes into one transaction per tick
let pending = [], flushP = null;
function schedule() {
  if (flushP) return flushP;
  flushP = new Promise((res) => setTimeout(() => {
    const ops = pending; pending = []; flushP = null;
    if (!ops.length) return res();
    const stores = [...new Set(ops.map(o => o.s))];
    const tx = db.transaction(stores, 'readwrite');
    for (const o of ops) { const st = tx.objectStore(o.s); o.del ? st.delete(o.key) : st.put(o.val); }
    tx.oncomplete = () => res(); tx.onerror = () => { console.error(tx.error); res(); };
  }, 0));
  return flushP;
}
export function put(store, val) {
  mem[store].set(val[STORES[store]], val);
  pending.push({ s: store, val: structuredClone(val) });
  return schedule();
}
export function del(store, key) {
  mem[store].delete(key);
  pending.push({ s: store, key, del: true });
  return schedule();
}
export const get = (store, key) => mem[store].get(key);
export const list = (store) => [...mem[store].values()];
export const kvGet = (k, d = null) => { const r = mem.kv.get(k); return r ? r.v : d; };
export const kvSet = (k, v) => put('kv', { k, v });
export async function clearAll() {
  const tx = db.transaction(Object.keys(STORES), 'readwrite');
  for (const s of Object.keys(STORES)) { tx.objectStore(s).clear(); mem[s].clear(); }
  await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
}
export const flush = () => schedule();
