// What a trip needs: which conditions apply to it, and so which bags and things go on its list.
// No page code, so the tests run it in Node.
import * as M from './model.js';
import { nights, weekday } from './days.js';
import { summarize, temp, tripDays } from './weather.js';
import { plugsFor, plugText, countryName, localCountry } from './plugs.js';

// The conditions a thing can depend on, besides the trip's occasions (tags in the list).
export const CONDITIONS = [
  { k: 'fly', icon: '✈️', name: 'Flying', group: 'Getting there' },
  { k: 'drive', icon: '🚗', name: 'Driving', group: 'Getting there' },
  { k: 'train', icon: '🚆', name: 'Train', group: 'Getting there' },
  { k: 'abroad', icon: '🌍', name: 'Abroad', group: 'Where' },
  { k: 'plug', icon: '🔌', name: 'Other plugs', group: 'Where' },
  { k: 'hot', icon: '🌡️', name: 'Hot', group: 'Weather' },
  { k: 'cool', icon: '🧥', name: 'Cool', group: 'Weather' },
  { k: 'cold', icon: '❄️', name: 'Cold', group: 'Weather' },
  { k: 'rain', icon: '☔', name: 'Rain', group: 'Weather' },
  { k: 'snow', icon: '🌨️', name: 'Snow', group: 'Weather' },
  { k: 'sun', icon: '😎', name: 'Strong sun', group: 'Weather' },
];
const BY_KEY = Object.fromEntries(CONDITIONS.map(c => [c.k, c]));
export const AUTO_KEYS = ['abroad', 'plug', 'hot', 'cool', 'cold', 'rain', 'snow', 'sun'];

// A condition's name and icon, an occasion's too. Unknown keys (an occasion deleted since) read as gone.
export function condInfo(doc, k) {
  if (BY_KEY[k]) return BY_KEY[k];
  const g = doc.tags[k];
  return g && !M.gone(g) ? { k, icon: g.icon, name: g.name, group: 'Occasions' } : null;
}

export const home = doc => M.pref(doc, 'home', '') || localCountry();
// °F at home where the weather is reported in it: the US and its territories, Palau, Micronesia, the Marshall
// Islands and the Cayman Islands (Wikipedia, "Fahrenheit"), and Liberia.
const FAHRENHEIT = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'PW', 'FM', 'MH', 'KY', 'LR'];
export const units = doc => M.pref(doc, 'units', '') || (FAHRENHEIT.includes(home(doc)) ? 'F' : 'C');
export const laundry = doc => M.pref(doc, 'laundry', 7);

// "Thu, Fri and Sat"; more than three days becomes "on 5 days".
function dayList(list) {
  if (list.length > 3) return `on ${list.length} days`;
  const names = list.map(weekday);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// Every condition for this trip: what the place and weather say (auto), what the person set (set), the
// result (on), and a few words on why for each one that's on.
export function conditions(doc, trip) {
  const u = units(doc), from = home(doc), place = trip.place;
  const auto = { [trip.travel]: true }, why = {};
  why[trip.travel] = BY_KEY[trip.travel].name;
  if (place?.cc) {
    auto.abroad = place.cc !== from;
    if (auto.abroad) why.abroad = place.country || countryName(place.cc);
    const p = auto.abroad ? plugsFor(from, place.cc) : null;
    auto.plug = !!p?.need;
    if (p) why.plug = plugText(p) + (p.voltsDiffer ? ' (check anything that heats up)' : '');
  }
  const w = summarize({ days: tripDays(trip.wx, trip.start, trip.end) });
  if (w) {
    for (const k of ['hot', 'cool', 'cold', 'rain', 'snow', 'sun']) auto[k] = w[k];
    why.hot = `Highs up to ${temp(w.maxHi, u)}`;
    why.cool = why.cold = `Lows down to ${temp(w.minLo, u)}`;
    why.rain = w.rainDays.length ? `Rain likely ${dayList(w.rainDays)}` : `Rains about ${Math.max(1, Math.round(w.wet * 10))} days in 10 then`;
    why.snow = w.snowDays.length ? `Snow likely ${dayList(w.snowDays)}` : `Snows about ${Math.max(1, Math.round(w.sn * 10))} days in 10 then`;
    why.sun = w.forecast && w.uv >= 6 ? `UV up to ${Math.round(w.uv)}` : 'Strong sun then';
  }
  const on = { ...auto };
  for (const [k, m] of Object.entries(trip.set || {})) {
    if (m.v === null || m.v === undefined || M.TRAVEL.includes(k)) continue;
    on[k] = !!m.v;
    if (m.v && auto[k] !== true) why[k] = BY_KEY[k] ? 'You turned this on' : condInfo(doc, k)?.name || '';
  }
  for (const g of M.tags(doc)) if (on[g.id]) why[g.id] = g.name;
  return { auto, on, why, weather: w, units: u };
}

// Whether a rule (when/unless) lets something come along, and the conditions that brought it.
export function passes(rule, on) {
  const hits = rule.when.filter(k => on[k]);
  if (rule.when.length && !hits.length) return { ok: false, hits };
  const blocks = rule.unless.filter(k => on[k]);
  return { ok: !blocks.length, hits, blocks };
}

export const days = trip => nights(trip.start, trip.end) + 1;
export const qtyOf = (doc, trip, item) => (item.per === 'day' ? Math.min(days(trip), laundry(doc)) : item.qty || 1);

// Why something isn't coming: "Only when it's cold or snowing", "Not when you're driving".
export function whyNot(doc, rule, res) {
  const names = ks => ks.map(k => condInfo(doc, k)?.name.toLowerCase()).filter(Boolean);
  if (!res.ok && res.blocks?.length) return `Not when ${names(res.blocks).join(' or ')}`;
  const n = names(rule.when);
  return n.length ? `Only for ${n.join(' or ')}` : '';
}

// The list for one trip.
//   mode 'go': packing to leave. 'back': packing to come home, which lists what went (or, if nothing was
//   ticked going, everything that was on the list) and the jobs before leaving the hotel.
// A whole bag or list of jobs can be left off one trip ('x:BAGID' 'skip'), or brought along when its
// conditions say no ('add'), the same way a single thing can.
// Returns { groups: [{ bag, rows }], tasks: [{ bag, rows }], left: [{ item, why, skipped }] (things, then jobs),
//   leftBags: [{ bag, why, skipped, count }], done, total, cond }
// A row: { id, name, note, qty, hits: [condition keys], key: the mark key, done, extra?, gone? }
export function plan(doc, trip, mode = 'go') {
  const cond = conditions(doc, trip), on = cond.on;
  const marks = trip.marks || {};
  const mv = id => marks['b:' + id]?.v;
  const pick = id => marks['x:' + id]?.v;
  const isPacked = id => marks['p:' + id]?.v === 1;
  const anyPacked = Object.entries(marks).some(([k, m]) => k.startsWith('p:') && m.v === 1);
  const allBags = M.bags(doc);
  const bagOk = Object.fromEntries(allBags.map(b => [b.id, passes(b, on)]));
  const coming = b => pick(b.id) === 'add' || (pick(b.id) !== 'skip' && bagOk[b.id].ok);
  const groups = new Map(), tasks = [], left = [], leftBags = [];
  const groupOf = bag => { if (!groups.has(bag.id)) groups.set(bag.id, { bag, rows: [] }); return groups.get(bag.id); };
  const fallback = { id: '_loose', name: 'Not in a bag', icon: '🧳', kind: 'bag', when: [], unless: [], order: 1e9 };
  const bagFor = id => allBags.find(b => b.id === id && b.kind === 'bag');

  // Bags and lists of jobs not coming on this trip, the ones this way of packing shows.
  const kinds = mode === 'go' ? ['bag', 'leave'] : ['back'];
  for (const b of allBags) {
    if (!kinds.includes(b.kind) || coming(b) || !M.items(doc, b.id).length) continue;
    const skipped = pick(b.id) === 'skip';
    leftBags.push({ bag: b, skipped, why: skipped ? 'You left it off this trip' : whyNot(doc, b, bagOk[b.id]), count: M.items(doc, b.id).length });
  }

  for (const b of allBags.filter(b => b.kind === 'bag')) groupOf(b);
  for (const it of M.items(doc)) {
    const home = allBags.find(b => b.id === it.bag);
    if (!home || home.kind !== 'bag') continue;
    const res = passes(it, on), bagIn = coming(home);
    const p = pick(it.id), packed = isPacked(it.id);
    if (!(p === 'add' || packed || (p !== 'skip' && res.ok && bagIn))) {
      // Things in a bag that isn't coming are covered by the bag's own line.
      if (bagIn) left.push({ item: it, skipped: p === 'skip', why: p === 'skip' ? 'You left it off this trip' : whyNot(doc, it, res) });
      continue;
    }
    if (mode === 'back' && anyPacked && !packed) continue;
    const bag = bagFor(mv(it.id)) || home;
    groupOf(bag).rows.push({
      id: it.id, name: it.name, note: it.note, qty: qtyOf(doc, trip, it),
      hits: res.hits, key: (mode === 'go' ? 'p:' : 'r:') + it.id,
      added: p === 'add', moved: bag !== home, packedOnly: (!res.ok || !bagIn) && p !== 'add',
    });
  }
  for (const x of M.extras(trip)) {
    const packed = isPacked(x.id);
    if (mode === 'back' && anyPacked && !packed) continue;
    const bag = bagFor(mv(x.id)) || bagFor(x.bag) || fallback;
    groupOf(bag).rows.push({ id: x.id, name: x.name, note: '', qty: 1, hits: [], key: (mode === 'go' ? 'p:' : 'r:') + x.id, extra: true });
  }
  // Jobs, for leaving the house or the hotel. One left off this trip, or that its conditions leave off, waits
  // under Left off while its list is coming (a list that isn't has its own line).
  const kind = mode === 'go' ? 'leave' : 'back', leftJobs = [];
  for (const b of allBags.filter(b => b.kind === kind)) {
    if (!coming(b)) continue;
    const rows = [];
    for (const it of M.items(doc, b.id)) {
      const res = passes(it, on), p = pick(it.id);
      if (p === 'add' || (p !== 'skip' && res.ok)) rows.push({ id: it.id, name: it.name, note: it.note, qty: 1, hits: res.hits, key: (mode === 'go' ? 'p:' : 'r:') + it.id, added: p === 'add' });
      else leftJobs.push({ item: it, skipped: p === 'skip', why: p === 'skip' ? 'You left it off this trip' : whyNot(doc, it, res) });
    }
    if (rows.length) tasks.push({ bag: b, rows });
  }
  const list = [...groups.values()].filter(g => g.rows.length).sort((a, b) => a.bag.order - b.bag.order);
  const all = [...list, ...tasks].flatMap(g => g.rows);
  for (const r of all) r.done = (marks[r.key]?.v || 0) > 0;
  if (mode === 'back') for (const r of all) r.gone = marks[r.key]?.v === 2;
  return {
    groups: list, tasks, left: mode === 'go' ? [...left, ...leftJobs] : leftJobs, leftBags, cond,
    done: all.filter(r => r.done).length, total: all.length,
  };
}

// For the trip cards: how far along packing is.
export function progress(doc, trip) {
  const p = plan(doc, trip, 'go');
  return { done: p.done, total: p.total };
}
