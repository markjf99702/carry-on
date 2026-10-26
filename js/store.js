// Keeps the list and trips in this browser's localStorage, which is the working copy. Google Drive, when
// it's on, is a copy that sync.js merges into from every device.
import * as M from './model.js';

export const KEY = 'carry-on';
const DEVICE = 'carry-on.device'; // this device only: hide packed, folded bags, which way each trip is showing

function get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function put(k, v) {
  try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch { return false; }
}

// This device's own settings, keeping only what's well formed, so junk left in storage can't stop the page.
function readDevice() {
  const d = get(DEVICE);
  const map = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return { hide: !!d?.hide, open: map(d?.open), mode: map(d?.mode) };
}
let device = readDevice();
let doc = M.cleanDoc(get(KEY));
const listeners = [];

function write(next) {
  doc = next;
  const ok = put(KEY, M.canon(doc));
  listeners.forEach(f => f(ok ? 'saved' : 'full'));
}

export const store = {
  get doc() { return doc; },
  onSave(f) { listeners.push(f); },
  // Picks up what another tab or a sync wrote.
  reload() { device = readDevice(); doc = M.cleanDoc(get(KEY)); },
  // Every change goes through here: store.apply(d => M.putItem(d, {...}))
  apply(fn) { const next = fn(doc); if (next !== doc) write(next); return next; },

  get hide() { return device.hide; },
  set hide(v) { device.hide = !!v; put(DEVICE, device); },
  isOpen: id => !!device.open[id],
  setOpen(id, v) { if (v) device.open[id] = 1; else delete device.open[id]; put(DEVICE, device); },
  mode: id => device.mode[id],
  setMode(id, v) { device.mode[id] = v; put(DEVICE, device); },

  backup: () => JSON.stringify({ ...M.cleanDoc(doc), saved: new Date().toISOString() }, null, 1),
  // Merges a backup in, record by record, so nothing here is lost. Returns how many things it brought back or changed.
  restoreBackup(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { raw = null; }
    if (raw?.app !== M.APP || typeof raw.bags !== 'object') throw new Error('That file isn’t a Carry On backup.');
    const incoming = M.cleanDoc(raw);
    const merged = M.mergeDocs(doc, incoming, { first: true });
    // Something deleted since the backup was saved comes back stamped newer than its deletion, as Undo does,
    // so the next sync doesn't delete it again.
    let changed = 0;
    for (const coll of ['bags', 'items', 'tags', 'trips']) {
      for (const [id, x] of Object.entries(merged[coll])) {
        const was = doc[coll][id];
        if (was && M.gone(was) && !M.gone(x)) merged[coll][id] = { ...x, t: Math.max(M.stamp(x), was.del + 1) };
        if (!M.gone(merged[coll][id]) && M.canon(merged[coll][id]) !== M.canon(was)) changed++;
      }
    }
    write(merged);
    return changed;
  },
  erase() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(DEVICE); } catch { /* already gone */ }
    device = readDevice();
    doc = M.blankDoc();
  },
};
