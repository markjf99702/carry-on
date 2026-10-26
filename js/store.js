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
  // Merges a backup in, record by record, so nothing here is lost. Returns how many of each it brought back or
  // changed: { things, jobs, bags, lists (of jobs), occasions, trips }.
  restoreBackup(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { raw = null; }
    if (raw?.app !== M.APP || typeof raw.bags !== 'object') throw new Error('That file isn’t a Carry On backup.');
    const incoming = M.cleanDoc(raw);
    // Where the backup and this device each made a thing of the same name, it becomes one with this device's id,
    // which Drive and the other devices hold too.
    const merged = M.mergeDocs(incoming, doc, { first: true });
    // Something deleted here since the backup was saved comes back, stamped newer than its deletion as Undo does,
    // so the next sync doesn't delete it again. That includes untouched starter things, which a first merge
    // otherwise leaves deleted.
    const n = { things: 0, jobs: 0, bags: 0, lists: 0, occasions: 0, trips: 0 };
    for (const coll of ['bags', 'items', 'tags', 'trips']) {
      for (const [id, x] of Object.entries(merged[coll])) {
        const was = doc[coll][id], had = incoming[coll][id];
        if (was && M.gone(was) && had && !M.gone(had)) {
          const back = { ...x, t: Math.max(M.stamp(x), was.del + 1) };
          delete back.del;
          merged[coll][id] = back;
        }
        const now = merged[coll][id], same = was && !M.gone(was) && M.canon({ ...now, t: 0 }) === M.canon({ ...was, t: 0 });
        if (M.gone(now) || same) continue;
        const jobs = ['leave', 'back'].includes((coll === 'bags' ? now : merged.bags[now.bag])?.kind);
        n[{ bags: jobs ? 'lists' : 'bags', items: jobs ? 'jobs' : 'things', tags: 'occasions', trips: 'trips' }[coll]]++;
      }
    }
    write(merged);
    return n;
  },
  erase() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(DEVICE); } catch { /* already gone */ }
    device = readDevice();
    doc = M.blankDoc();
  },
};
