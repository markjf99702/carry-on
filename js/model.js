// The packing list, the trips, and how two copies of them merge. No page code, so the tests run it in Node.
//
// The list:
//   bag   { id, name, icon, kind, order, when, unless, note, t, del? }
//           kind 'bag' holds things to pack; 'leave' holds jobs before leaving the house; 'back' jobs before
//           leaving the hotel. when/unless are condition keys (rules.js): the bag comes along only when one of
//           `when` applies (or always, when it's empty) and none of `unless` does.
//   item  { id, name, bag, order, when, unless, qty, per, note, t, del? }
//           per 'day': one for each day of the trip, up to the laundry limit; otherwise qty of it.
//   tag   { id, name, icon, order, t, del? }   an occasion a trip can have: work, the gym, a wedding
// A trip:
//   { id, name, place, start, end, travel, t, del?, set, marks, extras, wx, stops? }
//   set     condition key → { v: true | false | null, t }. Occasions picked, and anything the person turned on
//           or off by hand over what the weather and place say (null puts it back to automatic).
//   marks   'p:ID' packed (1), 'r:ID' back in the bag coming home (1) or not coming back (2), 'x:ID' 'skip' or
//           'add' for this trip only, 'b:ID' the bag it goes in this trip → { v, t }
//   extras  things added for this trip only: { id: { name, bag, t, del? } }
//   wx      the weather looked up for it (weather.js), the newest lookup wins. for: the place it was looked up
//           for, so a lookup of a trip's old place, landing from another device, doesn't count for the new one.
//           fcAt: when a lookup couldn't update the forecast and kept the last one's days, when that one was from
//   stops   the places a trip goes on to after its first one (place): { id: { place, from, t, del?, wx? } }, from
//           the night you get there. Each has its own wx, its place's weather for the trip's days. A trip with one
//           place has none. A copy of Carry On from before stops drops them when it reads a trip, so they merge
//           stop by stop, apart from the trip's details: that copy saving the trip doesn't take them away.
//
// t is when a record last changed, del when it was deleted. A deleted record keeps its details, so a deletion
// on one device reaches the others instead of the record coming back from their copy, and a change made after
// the deletion brings it back. A bag deleted on one device while a thing was added to it (or changed) on another,
// after the deletion, is still there while it holds that thing: see bags(). Starter records have t = 0
// ("untouched"): see mergeDocs for why that matters.

export const APP = 'carry-on';
export const KINDS = ['bag', 'leave', 'back'];
export const TRAVEL = ['fly', 'drive', 'train'];

// Spaces run together, and cut to max characters whole, so an emoji isn't split in half.
const str = (s, max) => Array.from(String(s ?? '').replace(/\s+/g, ' ').trimStart()).slice(0, max).join('').trimEnd();
// Not a name every JavaScript object already has ('__proto__', 'toString'): read back from an object, it would
// find that instead. Ids made here never look like one.
const idOk = id => typeof id === 'string' && /^[\w-]{1,48}$/.test(id) && !(id in Object.prototype);
// A record of a map by its key, only if the map itself has one.
const own = (m, k) => (m && Object.hasOwn(m, k) ? m[k] : undefined);
const tOk = t => (Number.isFinite(+t) && +t >= 0 ? Math.floor(+t) : 0);
const numOk = (x, lo, hi) => (Number.isFinite(+x) && x !== null && x !== '' ? Math.min(hi, Math.max(lo, +x)) : null);
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const keys = a => (Array.isArray(a) ? [...new Set(a.filter(idOk))].sort().slice(0, 40) : []);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

export function newId(prefix = '') {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return prefix + [...b].map(x => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
}

// A change time that sorts after the record's last one, even if this device's clock is behind.
export const stamp = old => Math.max(Date.now(), (old?.t || 0) + 1, (old?.del || 0) + 1);

export const DEFAULT_TAGS = [
  { id: 'work', name: 'Work', icon: '💼' },
  { id: 'gym', name: 'Working out', icon: '🏋️' },
  { id: 'swim', name: 'Swimming', icon: '🏊' },
  { id: 'dressy', name: 'Dressing up', icon: '👔' },
  { id: 'outdoors', name: 'Outdoors', icon: '🥾' },
];

export function blankDoc() {
  const tags = {};
  DEFAULT_TAGS.forEach((x, i) => { tags[x.id] = { ...x, order: i, t: 0 }; });
  return { app: APP, v: 1, bags: {}, items: {}, tags, trips: {}, prefs: {} };
}

// ---------- cleaning what comes out of storage, a backup or Drive ----------

function rec(x, id, fields) {
  if (!x || typeof x !== 'object' || !idOk(id)) return null;
  const out = { id, ...fields, t: tOk(x.t) };
  if (tOk(x.del)) out.del = tOk(x.del);
  return out;
}

export function cleanBag(x, id = x?.id) {
  const name = str(x?.name, 60);
  if (!name) return null;
  return rec(x, id, {
    name, icon: str(x.icon, 8) || '🧳', kind: KINDS.includes(x.kind) ? x.kind : 'bag',
    order: numOk(x.order, -1e9, 1e9) ?? 0, when: keys(x.when), unless: keys(x.unless), note: str(x.note, 140),
  });
}

export function cleanItem(x, id = x?.id) {
  const name = str(x?.name, 80);
  if (!name || !idOk(x.bag)) return null;
  return rec(x, id, {
    name, bag: x.bag, order: numOk(x.order, -1e9, 1e9) ?? 0, when: keys(x.when), unless: keys(x.unless),
    qty: Math.round(numOk(x.qty, 1, 20) ?? 1), per: x.per === 'day' ? 'day' : '', note: str(x.note, 140),
  });
}

export function cleanTag(x, id = x?.id) {
  const name = str(x?.name, 30);
  if (!name) return null;
  return rec(x, id, { name, icon: str(x.icon, 8) || '🏷️', order: numOk(x.order, -1e9, 1e9) ?? 0 });
}

export function cleanPlace(p) {
  const name = str(p?.name, 80);
  if (!name) return null;
  const out = { name, admin: str(p.admin, 80), country: str(p.country, 60), cc: /^[A-Z]{2}$/.test(p.cc) ? p.cc : '' };
  const lat = numOk(p.lat, -90, 90), lon = numOk(p.lon, -180, 180);
  if (lat !== null && lon !== null) { out.lat = Math.round(lat * 1e4) / 1e4; out.lon = Math.round(lon * 1e4) / 1e4; }
  return out;
}

const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
function cleanDay(d) {
  if (!d || !isDay(d.d)) return null;
  const hi = numOk(d.hi, -90, 70), lo = numOk(d.lo, -90, 70);
  if (hi === null || lo === null) return null;
  const out = { d: d.d, hi: r1(hi), lo: r1(lo), mm: r1(numOk(d.mm, 0, 2000) ?? 0) };
  if (d.typ) {
    out.typ = 1;
    out.wet = r2(numOk(d.wet, 0, 1) ?? 0);
    out.sn = r2(numOk(d.sn, 0, 1) ?? 0);
    out.rad = r1(numOk(d.rad, 0, 60) ?? 0);
    // An estimate of the UV (weather.js uvEstimate); days saved before it have none.
    const uv = numOk(d.uv, 0, 20);
    if (uv !== null) out.uv = r1(uv);
  } else {
    for (const [k, lo2, hi2] of [['pop', 0, 100], ['rain', 0, 2000], ['snow', 0, 500], ['uv', 0, 20], ['code', 0, 99]]) {
      const v = numOk(d[k], lo2, hi2);
      if (v !== null) out[k] = k === 'code' || k === 'pop' ? Math.round(v) : r1(v);
    }
  }
  return out;
}
// for: the place it was looked up for, "lat,lon" (weather.js placeKey). fcAt: when a kept forecast is from.
export function cleanWx(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.days)) return null;
  const days = w.days.map(cleanDay).filter(Boolean).slice(0, 120);
  const where = typeof w.for === 'string' && w.for.length <= 30 && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(w.for) ? w.for : '';
  return { at: tOk(w.at), ...(where ? { for: where } : {}), days, ...(w.err ? { err: str(w.err, 140) } : {}), ...(tOk(w.fcAt) ? { fcAt: tOk(w.fcAt) } : {}) };
}

const cleanMark = m => {
  if (!m || typeof m !== 'object') return null;
  const v = m.v === null ? null : typeof m.v === 'boolean' ? m.v : typeof m.v === 'number' ? numOk(m.v, 0, 9) : idOk(m.v) ? m.v : undefined;
  return v === undefined ? null : { v, t: tOk(m.t) };
};
function cleanMap(x, clean, keyOk = idOk) {
  const out = {};
  for (const [k, v] of Object.entries(obj(x))) { const c = keyOk(k) && clean(v, k); if (c) out[k] = c; }
  return out;
}
const markKey = k => /^[prxb]:/.test(k) && idOk(k.slice(2));
const cleanExtra = (x, id) => {
  const name = str(x?.name, 80);
  if (!name || !idOk(x.bag)) return null;
  return rec(x, id, { name, bag: x.bag });
};

const cleanStop = (x, id) => {
  const place = cleanPlace(x?.place);
  if (!place || !isDay(x.from)) return null;
  const out = rec(x, id, { place, from: x.from }), wx = cleanWx(x.wx);
  if (out && wx) out.wx = wx;
  return out;
};

export function cleanTrip(x, id = x?.id) {
  if (!x || typeof x !== 'object' || !isDay(x.start) || !isDay(x.end)) return null;
  const out = rec(x, id, {
    name: str(x.name, 60), place: cleanPlace(x.place), start: x.start, end: x.end < x.start ? x.start : x.end,
    travel: TRAVEL.includes(x.travel) ? x.travel : 'fly',
    set: cleanMap(x.set, cleanMark), marks: cleanMap(x.marks, cleanMark, markKey), extras: cleanMap(x.extras, cleanExtra),
    wx: cleanWx(x.wx), stops: cleanMap(x.stops, cleanStop),
  });
  if (out && !out.place) delete out.place;
  if (out && !out.wx) delete out.wx;
  // A trip with one place is saved just as it was before there were stops.
  if (out && !Object.keys(out.stops).length) delete out.stops;
  return out;
}

const PREFS = {
  home: v => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : undefined),
  units: v => (v === 'C' || v === 'F' ? v : undefined),
  laundry: v => { const n = numOk(v, 1, 30); return n === null ? undefined : Math.round(n); },
};

export function cleanDoc(raw) {
  const doc = blankDoc();
  if (!raw || typeof raw !== 'object') return doc;
  const take = (name, clean) => { if (raw[name] && typeof raw[name] === 'object') doc[name] = { ...(name === 'tags' ? doc.tags : {}), ...cleanMap(raw[name], clean) }; };
  take('bags', cleanBag); take('items', cleanItem); take('tags', cleanTag); take('trips', cleanTrip);
  for (const [k, ok] of Object.entries(PREFS)) {
    const p = raw.prefs?.[k], v = p && typeof p === 'object' ? ok(p.v) : undefined;
    if (v !== undefined) doc.prefs[k] = { v, t: tOk(p.t) };
  }
  return doc;
}

// JSON with the keys sorted, so the same data always gives the same text. Anything JSON has no word for (a
// function) is null, so what's saved always reads back.
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x ?? null) ?? 'null';
}

// ---------- reading ----------

const NESTED = ['set', 'marks', 'extras', 'stops'];
// The last time anything about a record changed. For a trip that includes every tick and setting in it.
export function touched(x) {
  let t = x.t;
  for (const n of NESTED) for (const m of Object.values(x[n] || {})) t = Math.max(t, m.t);
  return t;
}
export const gone = x => !!x.del && x.del >= touched(x);
const byOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
// The deleted bags still there: each holds a thing added or changed after the bag's deletion (on another device,
// before the deletion reached it), so that thing has somewhere to show. The bag's other things stay deleted, and
// it goes again if that thing does. Read from the doc, so merging is the same whatever the order.
function held(doc) {
  const out = new Set();
  for (const x of Object.values(doc.items)) {
    const b = own(doc.bags, x.bag);
    if (b && gone(b) && !gone(x) && x.t > b.del) out.add(b.id);
  }
  return out;
}
// A bag that's there: not deleted, or held.
const bagThere = (doc, b, h = held(doc)) => !!b && (!gone(b) || h.has(b.id));
export const bags = doc => { const h = held(doc); return Object.values(doc.bags).filter(b => bagThere(doc, b, h)).sort(byOrder); };
// The things in bags that are there.
export const items = (doc, bagId) => {
  const h = held(doc);
  return Object.values(doc.items).filter(x => !gone(x) && (!bagId || x.bag === bagId) && bagThere(doc, own(doc.bags, x.bag), h)).sort(byOrder);
};
export const tags = doc => Object.values(doc.tags).filter(x => !gone(x)).sort(byOrder);
export const trips = doc => Object.values(doc.trips).filter(x => !gone(x));
export const extras = trip => Object.values(trip.extras || {}).filter(x => !gone(x));
// A trip's stops after its first place, whatever their nights (rules.js legs() says which count).
export const stops = trip => Object.values(trip.stops || {}).filter(x => !gone(x));
export const hasList = doc => bags(doc).length > 0;
export const pref = (doc, k, fallback) => doc.prefs[k]?.v ?? fallback;

// ---------- merging ----------

// Of two versions, the newer; on a tie, the one that sorts last, so every device picks the same.
const newer = (x, y) => x.t > y.t || (x.t === y.t && canon(x) > canon(y));
const details = x => { const o = { ...x }; delete o.del; for (const n of NESTED) delete o[n]; delete o.wx; return o; };

function mergeMap(a = {}, b = {}) {
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = own(a, k), y = own(b, k);
    out[k] = !x ? y : !y ? x : x.del || y.del || x.name !== undefined || x.wx || y.wx ? mergeRec(x, y) : newer(x, y) ? x : y;
  }
  return out;
}

function mergeRec(x, y) {
  const base = newer(details(x), details(y)) ? x : y;
  const out = { ...details(base) };
  for (const n of NESTED) if (x[n] || y[n]) out[n] = mergeMap(x[n], y[n]);
  if (x.wx || y.wx) out.wx = !x.wx ? y.wx : !y.wx ? x.wx : x.wx.at > y.wx.at || (x.wx.at === y.wx.at && canon(x.wx) > canon(y.wx)) ? x.wx : y.wx;
  const del = Math.max(x.del || 0, y.del || 0);
  if (del) out.del = del;
  return out;
}

// A trip on the side whose bags, things and occasions took the other side's ids in a first merge: its ticks, skips
// and moves, the bags of its one-trip things, and the occasions picked for it go to the new ids. Where two land on
// one key, the newer stays.
function followRenames(trip, bagMap, itemMap, tagMap) {
  const out = { ...trip };
  if (trip.set) {
    out.set = {};
    for (const [k, m] of Object.entries(trip.set)) {
      const key = tagMap[k] || k;
      if (!out.set[key] || newer(m, out.set[key])) out.set[key] = m;
    }
  }
  if (trip.marks) {
    out.marks = {};
    for (const [k, m] of Object.entries(trip.marks)) {
      const id = k.slice(2), key = k[0] + ':' + (itemMap[id] || bagMap[id] || id);
      const x = k[0] === 'b' && bagMap[m.v] ? { ...m, v: bagMap[m.v] } : m;
      if (!out.marks[key] || newer(x, out.marks[key])) out.marks[key] = x;
    }
  }
  if (trip.extras) out.extras = Object.fromEntries(Object.entries(trip.extras).map(([id, x]) => [id, bagMap[x.bag] ? { ...x, bag: bagMap[x.bag] } : x]));
  return out;
}

// For telling whether two names are the same: case, spaces and punctuation don't count.
const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\p{So}]+/gu, ' ').trim();
const untouched = x => x.t === 0;

// Merges two copies. Order doesn't matter and merging again changes nothing, so every device that syncs
// ends up with the same list and trips.
// first: this device's first merge with that copy (turning Drive on, restoring a backup, adding a shared list).
//   - Nothing counts as removed: something one side deleted but the other still has stays.
//   - A bag, thing or occasion made separately on both sides (same name, for a bag the same kind, and for a thing
//     the same bag) becomes one, with the remote side's id; this side's trips follow, so their ticks and occasions
//     stay, and so do its bags and things that come only for an occasion (or not for it).
//   - Untouched starter records (t = 0) are the exception. A second phone that started from the starter list
//     and then joins Drive shouldn't bring back starter things deleted elsewhere, or add them to a list that
//     never had them: when the other side has a list of its own (a bag or a thing that isn't untouched),
//     starter bags and their things are dropped together (kept as deletions, so the phone's next sync drops them
//     there too). A starter bag holding a thing of the person's own stays, though, so that thing still shows.
export function mergeDocs(local, remote, { first = false } = {}) {
  const out = { app: APP, v: 1 };
  const bagMap = Object.create(null), itemMap = Object.create(null), tagMap = Object.create(null);
  const tagKeys = ks => [...new Set(ks.map(k => tagMap[k] || k))].sort();
  // Whether a side has a list of its own, from its bags and things together, so starter bags and their things go
  // or stay together.
  const ownList = doc => ['bags', 'items'].some(n => Object.values(doc[n] || {}).some(x => !gone(x) && !untouched(x)));
  const aHas = ownList(local), bHas = ownList(remote);
  // Occasions first, so the bags and things that come for them can follow.
  for (const name of ['tags', 'bags', 'items', 'trips']) {
    let a = { ...local[name] };
    const b = remote[name];
    if (first && name !== 'trips') {
      if (name === 'items') for (const [id, x] of Object.entries(a)) if (bagMap[x.bag]) a[id] = { ...x, bag: bagMap[x.bag] };
      if (name !== 'tags') for (const [id, x] of Object.entries(a)) if ([...x.when, ...x.unless].some(k => tagMap[k])) a[id] = { ...x, when: tagKeys(x.when), unless: tagKeys(x.unless) };
      const same = name === 'tags' ? (x, y) => norm(x.name) === norm(y.name)
        : name === 'bags' ? (x, y) => norm(x.name) === norm(y.name) && x.kind === y.kind : (x, y) => norm(x.name) === norm(y.name) && x.bag === y.bag;
      const taken = new Set();
      for (const [id, x] of Object.entries(a)) {
        if (gone(x) || own(b, id)) continue;
        const match = Object.values(b).find(y => !gone(y) && !own(a, y.id) && !taken.has(y.id) && same(x, y));
        if (!match) continue;
        taken.add(match.id);
        delete a[id];
        a[match.id] = { ...x, id: match.id };
        const map = name === 'tags' ? tagMap : name === 'bags' ? bagMap : itemMap;
        map[id] = match.id;
      }
    }
    if (first && name === 'trips') for (const [id, t] of Object.entries(a)) a[id] = followRenames(t, bagMap, itemMap, tagMap);
    // A starter bag that someone put a thing of their own in is in use: it stays, with that thing.
    const inUse = new Set();
    if (first && name === 'bags') {
      for (const x of Object.values(local.items)) if (!gone(x) && !untouched(x)) inUse.add(bagMap[x.bag] || x.bag);
      for (const x of Object.values(remote.items)) if (!gone(x) && !untouched(x)) inUse.add(x.bag);
    }
    const merged = {};
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const x = own(a, id), y = own(b, id);
      let m = !x ? y : !y ? x : mergeRec(x, y);
      if (first && name !== 'tags') {
        const keep = [x, y].find(z => z && !gone(z));
        if (x && y && gone(m) && keep && !untouched(keep)) { m = { ...m }; delete m.del; }
        else if (!gone(m) && untouched(m) && (x ? !y && bHas : aHas) && !inUse.has(id)) m = { ...m, del: 1 };
      }
      merged[id] = m;
    }
    out[name] = merged;
  }
  const prefs = {};
  for (const k of new Set([...Object.keys(local.prefs || {}), ...Object.keys(remote.prefs || {})])) {
    const x = own(local.prefs, k), y = own(remote.prefs, k);
    prefs[k] = !x ? y : !y ? x : newer(x, y) ? x : y;
  }
  out.prefs = prefs;
  return out;
}

// ---------- changing things (each returns the new doc; the old one is left alone) ----------

const nextOrder = (list) => (list.length ? Math.max(...list.map(x => x.order)) + 1 : 0);

// Whether a record is there to change: for a bag, also one held (see bags()).
const there = (doc, coll, x) => (coll === 'bags' ? bagThere(doc, x) : !!x && !gone(x));
function put(doc, coll, clean, fields) {
  const old = doc[coll][fields.id];
  const base = there(doc, coll, old) ? old : {};
  const x = clean({ ...base, ...fields, t: stamp(old) }, fields.id);
  if (!x) throw new Error('That needs a name.');
  delete x.del;
  return { ...doc, [coll]: { ...doc[coll], [x.id]: x } };
}
function remove(doc, coll, id) {
  const old = doc[coll][id];
  if (!there(doc, coll, old)) return doc;
  return { ...doc, [coll]: { ...doc[coll], [id]: { ...old, del: Math.max(Date.now(), touched(old) + 1) } } };
}
// Brings back something deleted, as it was (for Undo).
function restore(doc, coll, id) {
  const cur = doc[coll][id];
  if (!cur || !gone(cur)) return doc;
  const x = { ...cur, t: Math.max(Date.now(), cur.del + 1) };
  delete x.del;
  return { ...doc, [coll]: { ...doc[coll], [id]: x } };
}

export function putBag(doc, fields) {
  const id = fields.id || newId('b');
  const order = there(doc, 'bags', doc.bags[id]) ? doc.bags[id].order : nextOrder(bags(doc));
  return put(doc, 'bags', cleanBag, { ...fields, order: fields.order ?? order, id });
}
// A bag goes with everything in it.
export function removeBag(doc, id) {
  let next = remove(doc, 'bags', id);
  for (const x of items(doc, id)) next = remove(next, 'items', x.id);
  return next;
}
export function restoreBag(doc, id, itemIds = []) {
  let next = restore(doc, 'bags', id);
  for (const i of itemIds) next = restore(next, 'items', i);
  return next;
}
export function putItem(doc, fields) {
  const id = fields.id || newId('i');
  const old = doc.items[id] && !gone(doc.items[id]) ? doc.items[id] : null;
  const bag = fields.bag || old?.bag;
  const order = old && old.bag === bag && fields.order === undefined ? old.order : fields.order ?? nextOrder(items(doc, bag));
  return put(doc, 'items', cleanItem, { ...fields, id, order });
}
export const removeItem = (doc, id) => remove(doc, 'items', id);
export const restoreItem = (doc, id) => restore(doc, 'items', id);

// Moves a bag or a thing one place up or down among its neighbours: a bag among the bags of its kind, as My list
// shows them under their headings, a thing among the things in its bag. Only the one that moves changes, taking
// an order between its new neighbours, because a change brings a record back from a deletion on another device:
// renumbering the neighbours too would bring back one deleted there meanwhile. Orders that tie can need the two
// to swap orders instead, and in a run of three or more ties, renumbering.
export function nudge(doc, coll, id, dir) {
  const x = doc[coll][id];
  if (!there(doc, coll, x)) return doc;
  const list = coll === 'bags' ? bags(doc).filter(b => b.kind === x.kind) : items(doc, x.bag);
  const i = list.findIndex(y => y.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return doc;
  const want = list.map(y => y.id);
  [want[i], want[j]] = [want[j], want[i]];
  const prev = doc[coll][want[j - 1]], next = doc[coll][want[j + 1]];
  const between = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next.order - 1;
  const fits = orders => list.map(y => (y.id in orders ? { ...y, order: orders[y.id] } : y)).sort(byOrder).every((y, k) => y.id === want[k]);
  const orders = [{ [id]: between }, { [id]: list[j].order, [list[j].id]: x.order }, Object.fromEntries(want.map((yid, k) => [yid, k]))].find(fits);
  let out = doc;
  for (const [yid, order] of Object.entries(orders)) if (out[coll][yid].order !== order) out = put(out, coll, coll === 'bags' ? cleanBag : cleanItem, { id: yid, order });
  return out;
}

export function putTag(doc, fields) {
  const id = fields.id || newId('o');
  const order = doc.tags[id] && !gone(doc.tags[id]) ? doc.tags[id].order : nextOrder(tags(doc));
  return put(doc, 'tags', cleanTag, { ...fields, order: fields.order ?? order, id });
}
export const removeTag = (doc, id) => remove(doc, 'tags', id);

export function putTrip(doc, fields) {
  const id = fields.id || newId('t');
  const old = doc.trips[id];
  const base = old && !gone(old) ? old : { set: {}, marks: {}, extras: {} };
  const x = cleanTrip({ ...base, ...fields, id, t: stamp(old) }, id);
  if (!x) throw new Error('A trip needs the days you leave and come back.');
  delete x.del;
  return { ...doc, trips: { ...doc.trips, [id]: x } };
}
export const removeTrip = (doc, id) => remove(doc, 'trips', id);
export const restoreTrip = (doc, id) => restore(doc, 'trips', id);

function tripPart(doc, id, part, k, value) {
  const trip = doc.trips[id];
  if (!trip || gone(trip)) return doc;
  const old = trip[part]?.[k];
  return { ...doc, trips: { ...doc.trips, [id]: { ...trip, [part]: { ...trip[part], [k]: { ...value, t: stamp(old) } } } } };
}
// A tick, a skip or a move on one trip: 'p:ID', 'r:ID', 'x:ID', 'b:ID'.
export const mark = (doc, id, k, v) => tripPart(doc, id, 'marks', k, { v });
// Several ticks at once (a whole bag).
export function markAll(doc, id, list, v) {
  let next = doc;
  for (const k of list) next = mark(next, id, k, v);
  return next;
}
// An occasion picked, or a condition turned on or off by hand (null: back to what the trip says).
export const setCond = (doc, id, k, v) => tripPart(doc, id, 'set', k, { v });
export function putExtra(doc, id, fields) {
  const trip = doc.trips[id];
  if (!trip) return doc;
  const eid = fields.id || newId('e');
  const x = cleanExtra({ ...fields, t: 0 }, eid);
  if (!x) throw new Error('That needs a name.');
  return tripPart(doc, id, 'extras', eid, { id: eid, name: x.name, bag: x.bag });
}
export function removeExtra(doc, id, eid) {
  const trip = doc.trips[id], old = trip?.extras?.[eid];
  if (!old || gone(old)) return doc;
  return { ...doc, trips: { ...doc.trips, [id]: { ...trip, extras: { ...trip.extras, [eid]: { ...old, del: stamp(old) } } } } };
}
export function setWx(doc, id, wx) {
  const trip = doc.trips[id];
  const w = cleanWx(wx);
  if (!trip || !w) return doc;
  return { ...doc, trips: { ...doc.trips, [id]: { ...trip, wx: w } } };
}
// When a trip's place or dates change, its weather goes: as a lookup with no days, newer than the one before, so
// a merge with a copy that still has the old place's weather keeps it gone on every device. With sid, a stop's.
const cleared = wx => ({ at: Math.max(Date.now(), (wx?.at || 0) + 1), days: [] });
export function clearWx(doc, id, sid) {
  const trip = doc.trips[id];
  if (!trip) return doc;
  if (!sid) return { ...doc, trips: { ...doc.trips, [id]: { ...trip, wx: cleared(trip.wx) } } };
  const s = own(trip.stops, sid);
  return s ? withStop(doc, id, { ...s, wx: cleared(s.wx) }) : doc;
}

// ---------- a trip's stops ----------

const withStop = (doc, id, x) => ({ ...doc, trips: { ...doc.trips, [id]: { ...doc.trips[id], stops: { ...doc.trips[id].stops, [x.id]: x } } } });
const samePlace = (a, b) => a.name === b.name && a.lat === b.lat && a.lon === b.lon;
// A stop added, or its place or night changed: { id?, place, from }. Somewhere else now, the weather looked up for
// the old place goes, as a trip's does.
export function putStop(doc, id, fields) {
  const trip = doc.trips[id];
  if (!trip || gone(trip)) return doc;
  const sid = fields.id || newId('s');
  const old = own(trip.stops, sid), base = old && !gone(old) ? old : {};
  const x = cleanStop({ ...base, ...fields, t: stamp(old) }, sid);
  if (!x) throw new Error('A stop needs a place and the night you get there.');
  delete x.del;
  if (old && !samePlace(old.place, x.place)) x.wx = cleared(old.wx);
  return withStop(doc, id, x);
}
export function removeStop(doc, id, sid) {
  const trip = doc.trips[id], old = own(trip?.stops, sid);
  if (!old || gone(old) || gone(trip)) return doc;
  return withStop(doc, id, { ...old, del: stamp(old) });
}
export function setStopWx(doc, id, sid, wx) {
  const s = own(doc.trips[id]?.stops, sid), w = cleanWx(wx);
  return s && !gone(s) && w ? withStop(doc, id, { ...s, wx: w }) : doc;
}

export function setPref(doc, k, v) {
  return { ...doc, prefs: { ...doc.prefs, [k]: { v, t: stamp(doc.prefs[k]) } } };
}

// ---------- a whole list at once (the starter list, a shared link, a pasted list) ----------
// list: { bags: [...], items: [...], tags: [...] } in order, as share.js makes them.

function listDoc(list, t) {
  const doc = { ...blankDoc(), bags: {}, items: {}, tags: {} };
  (list.bags || []).forEach((b, i) => { const x = cleanBag({ ...b, order: i, t }, b.id); if (x) doc.bags[x.id] = x; });
  const counts = {};
  (list.items || []).forEach(it => {
    if (!doc.bags[it.bag]) return;
    counts[it.bag] = (counts[it.bag] || 0) + 1;
    const x = cleanItem({ ...it, order: counts[it.bag], t }, it.id);
    if (x) doc.items[x.id] = x;
  });
  (list.tags || []).forEach((g, i) => { const x = cleanTag({ ...g, order: DEFAULT_TAGS.length + i, t }, g.id); if (x) doc.tags[x.id] = x; });
  return doc;
}

// The starter list goes in untouched (t = 0), except over something deleted here before (starting again after
// deleting every bag): that goes in newer than its deletion, which would otherwise win again at the next sync.
export function startWith(doc, list) {
  const fresh = listDoc(list, 0);
  const over = coll => Object.fromEntries(Object.entries(fresh[coll]).map(([id, x]) => [id, doc[coll][id] ? { ...x, t: stamp(doc[coll][id]) } : x]));
  return { ...doc, bags: { ...doc.bags, ...over('bags') }, items: { ...doc.items, ...over('items') }, tags: { ...fresh.tags, ...doc.tags } };
}

// What's on both lists keeps this one's ids: a bag coming in takes the id of a bag here with the same name and
// kind, and a thing the id of one with the same name in that bag. A pasted list, or someone else's, has ids of
// its own, and a trip's ticks, skips and moves are kept by id. An id already here counts first.
function sameIds(doc, list) {
  const live = (coll, id) => there(doc, coll, doc[coll][id]);
  const bagMap = {}, itemMap = {};
  const bagsIn = list.bags || [], itemsIn = list.items || [];
  const takenB = new Set(bagsIn.filter(b => live('bags', b.id)).map(b => b.id));
  for (const b of bagsIn) {
    if (live('bags', b.id)) continue;
    const kind = KINDS.includes(b.kind) ? b.kind : 'bag';
    const hit = bags(doc).find(x => !takenB.has(x.id) && x.kind === kind && norm(x.name) === norm(b.name));
    if (hit) { takenB.add(hit.id); bagMap[b.id] = hit.id; }
  }
  const takenI = new Set(itemsIn.filter(x => live('items', x.id)).map(x => x.id));
  for (const it of itemsIn) {
    if (live('items', it.id)) continue;
    const hit = items(doc, bagMap[it.bag] || it.bag).find(x => !takenI.has(x.id) && norm(x.name) === norm(it.name));
    if (hit) { takenI.add(hit.id); itemMap[it.id] = hit.id; }
  }
  return {
    ...list,
    bags: bagsIn.map(b => (bagMap[b.id] ? { ...b, id: bagMap[b.id] } : b)),
    items: itemsIn.map(x => ({ ...x, id: itemMap[x.id] || x.id, bag: bagMap[x.bag] || x.bag })),
  };
}

// Swaps the list for another one. Trips keep their ticks: the ones for things on both lists still count.
// Bags and things not in the new list are deleted (and so leave other devices' lists too). Something already
// here just as it comes in is left as it is, so using the same list twice changes nothing.
export function replaceList(doc, list) {
  const now = Date.now(), fresh = listDoc(sameIds(doc, list), now);
  let next = doc;
  for (const b of bags(doc)) if (!fresh.bags[b.id]) next = remove(next, 'bags', b.id);
  for (const x of items(doc)) if (!fresh.items[x.id]) next = remove(next, 'items', x.id);
  const same = (old, x) => old && !gone(old) && old.t > 0 && canon({ ...old, t: 0 }) === canon({ ...x, t: 0 });
  const take = (coll, from) => {
    const out = { ...next[coll] };
    for (const [id, x] of Object.entries(from)) if (!same(out[id], x)) out[id] = { ...x, t: Math.max(stamp(out[id]), now) };
    return out;
  };
  return { ...next, bags: take('bags', fresh.bags), items: take('items', fresh.items), tags: take('tags', fresh.tags) };
}

// Undoes replaceList: before and after are the doc either side of it. Every bag, thing and occasion it changed
// goes back to how it was, newer than the replace so the undo reaches other devices too: what it deleted or
// overwrote comes back, what it added is deleted, and what was deleted before stays deleted. So does a thing that
// was out of sight in a deleted bag: brought back newer than the bag's deletion, it would bring the bag back.
export function undoReplace(doc, before, after) {
  const out = { ...doc };
  const shown = (coll, x) => there(before, coll, x) && (coll !== 'items' || bagThere(before, own(before.bags, x.bag)));
  for (const coll of ['bags', 'items', 'tags']) {
    out[coll] = { ...doc[coll] };
    for (const id of new Set([...Object.keys(before[coll]), ...Object.keys(after[coll])])) {
      const was = before[coll][id], cur = doc[coll][id];
      if (canon(was) === canon(after[coll][id]) || !cur) continue;
      const t = stamp(cur);
      if (shown(coll, was)) { out[coll][id] = { ...was, t }; delete out[coll][id].del; } else out[coll][id] = { ...(was || cur), del: t };
    }
  }
  return out;
}

// Adds another list to this one. A bag with the same name as one already here is that bag ("Toiletries" is the
// Toiletries bag); a thing already on the list stays as it is and where it is, in whichever bag (a job, in a list
// of jobs of the same kind); everything else comes in after what's here. A new bag comes only with something new
// in it, so adding the same list twice changes nothing.
const bagKey = name => norm(name).replace(/ (bag|kit|pouch|case)$/, '');
export function addList(doc, list) {
  const fresh = listDoc(list, 0);
  let next = doc;
  const free = (coll, id, prefix) => (next[coll][id] ? newId(prefix) : id);
  const onList = (it, kind) => items(next).some(x => norm(x.name) === norm(it.name) && next.bags[x.bag].kind === kind);
  for (const b of Object.values(fresh.bags).sort(byOrder)) {
    let bag = bags(next).find(x => bagKey(x.name) === bagKey(b.name) && x.kind === b.kind)?.id;
    const its = Object.values(fresh.items).filter(x => x.bag === b.id).sort(byOrder);
    const make = () => { bag = free('bags', b.id, 'b'); next = putBag(next, { ...b, id: bag, order: undefined }); };
    for (const it of its) {
      if (onList(it, b.kind)) continue;
      if (!bag) make();
      next = putItem(next, { ...it, id: free('items', it.id, 'i'), bag, order: undefined });
    }
    if (!its.length && !bag) make();
  }
  for (const g of Object.values(fresh.tags)) {
    if (tags(next).some(x => x.id === g.id || norm(x.name) === norm(g.name))) continue;
    next = putTag(next, { ...g, id: free('tags', g.id, 'o'), order: undefined });
  }
  return next;
}

// What a shared link or a backup of the list holds: the bags, things and occasions, in order.
export function listOf(doc) {
  const bs = bags(doc), ids = new Set(bs.map(b => b.id));
  const pick = (x, f) => Object.fromEntries(f.map(k => [k, x[k]]).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length) && !(v === 1 && f.includes('qty'))));
  return {
    bags: bs.map(b => pick(b, ['id', 'name', 'icon', 'kind', 'when', 'unless', 'note'])),
    items: bs.flatMap(b => items(doc, b.id)).filter(x => ids.has(x.bag)).map(x => pick(x, ['id', 'name', 'bag', 'when', 'unless', 'qty', 'per', 'note'])),
    tags: tags(doc).filter(g => !DEFAULT_TAGS.some(d => d.id === g.id) || g.t > 0).map(g => pick(g, ['id', 'name', 'icon'])),
  };
}
