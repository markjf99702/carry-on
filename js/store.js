// Keeps the list and trips in this browser's localStorage, which is the working copy. Google Drive, when
// it's on, is a copy that sync.js merges into from every device.
import * as M from './model.js';

export const KEY = 'carry-on';
const DEVICE = 'carry-on.device'; // this device only: hide packed, folded bags, which way each trip is showing today

function text(k) { try { return localStorage.getItem(k); } catch { return null; } }
function parse(s) { try { return JSON.parse(s); } catch { return null; } }
const get = k => parse(text(k));
function put(k, v) {
  try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch { return false; }
}

// This device's own settings, keeping only what's well formed, so junk left in storage can't stop the page. mode is
// which way each trip was shown, Going or Coming home ('go', 'back'), and modeOn the day each was picked: a pick
// lasts its own day. (modeOn is a map of its own, so a copy of the page from before still reads mode.)
function readDevice() {
  const d = get(DEVICE);
  const map = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return { hide: !!d?.hide, open: map(d?.open), mode: map(d?.mode), modeOn: map(d?.modeOn) };
}
let device = readDevice();
let last = text(KEY); // what this tab last read from storage or wrote there
let doc = M.cleanDoc(parse(last));
const listeners = [];

function reload() { device = readDevice(); last = text(KEY); doc = M.cleanDoc(parse(last)); }
// If something else saved since this tab last looked (a tab that missed the news, or a page brought back from the
// browser's memory), a change goes onto that, so it can't put back what was there before.
function fresh() { if (text(KEY) !== last) reload(); }

function write(next) {
  doc = next;
  const out = M.canon(doc), ok = put(KEY, out);
  if (ok) last = out;
  listeners.forEach(f => f(ok ? 'saved' : 'full'));
}

export const store = {
  get doc() { return doc; },
  onSave(f) { listeners.push(f); },
  // Picks up what another tab or a sync wrote.
  reload,
  // Every change goes through here: store.apply(d => M.putItem(d, {...}))
  apply(fn) {
    fresh();
    const next = fn(doc);
    if (next !== doc) write(next);
    return next;
  },

  get hide() { return device.hide; },
  set hide(v) { device.hide = !!v; put(DEVICE, device); },
  isOpen: id => !!device.open[id],
  setOpen(id, v) { if (v) device.open[id] = 1; else delete device.open[id]; put(DEVICE, device); },
  // Which way a trip was shown, if it was picked on day ('YYYY-MM-DD'). One picked on an earlier day, or saved before
  // picks had a day, doesn't count. Picking one lets go of those.
  mode: (id, day) => (device.modeOn[id] === day ? device.mode[id] : undefined),
  setMode(id, v, day) {
    for (const k of Object.keys(device.mode)) if (device.modeOn[k] !== day) delete device.mode[k];
    for (const k of Object.keys(device.modeOn)) if (device.modeOn[k] !== day) delete device.modeOn[k];
    device.mode[id] = v;
    device.modeOn[id] = day;
    put(DEVICE, device);
  },

  backup() { fresh(); return JSON.stringify({ ...M.cleanDoc(doc), saved: new Date().toISOString() }, null, 1); },
  // Merges a backup in, record by record, so nothing here is lost. Returns how many of each it brought back or
  // changed: { things, jobs, bags, lists (of jobs), occasions, trips }.
  restoreBackup(json) {
    const raw = parse(json);
    if (raw?.app !== M.APP || typeof raw.bags !== 'object') throw new Error('That file isn’t a Carry On backup.');
    const incoming = M.cleanDoc(raw);
    fresh();
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
    last = text(KEY);
    doc = M.blankDoc();
  },
};
