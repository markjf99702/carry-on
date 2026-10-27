// What a trip needs: which conditions apply to it, and so which bags and things go on its list.
// No page code, so the tests run it in Node.
import * as M from './model.js';
import { nights, weekday, num, add } from './days.js';
import { summarize, temp, tripDays, LIMITS } from './weather.js';
import { plugsFor, plugText, countryName, localCountry } from './plugs.js';

// The conditions a thing can depend on, besides the trip's occasions (tags in the list). The phrase finishes "Only
// when …" and "Not when …".
export const CONDITIONS = [
  { k: 'fly', icon: '✈️', name: 'Flying', phrase: 'you’re flying', group: 'Getting there' },
  { k: 'drive', icon: '🚗', name: 'Driving', phrase: 'you’re driving', group: 'Getting there' },
  { k: 'train', icon: '🚆', name: 'Train', phrase: 'you’re taking the train', group: 'Getting there' },
  { k: 'abroad', icon: '🌍', name: 'Abroad', phrase: 'abroad', group: 'Where' },
  { k: 'plug', icon: '🔌', name: 'Different plugs', phrase: 'the plugs are different', group: 'Where' },
  { k: 'hot', icon: '🌡️', name: 'Hot', phrase: 'it’s hot', group: 'Weather' },
  { k: 'cool', icon: '🧥', name: 'Cool', phrase: 'it’s cool', group: 'Weather' },
  { k: 'cold', icon: '❄️', name: 'Cold', phrase: 'it’s cold', group: 'Weather' },
  { k: 'rain', icon: '☔', name: 'Rain', phrase: 'rain’s likely', group: 'Weather' },
  { k: 'snow', icon: '🌨️', name: 'Snow', phrase: 'snow’s likely', group: 'Weather' },
  { k: 'sun', icon: '😎', name: 'Strong sun', phrase: 'the sun’s strong', group: 'Weather' },
];
const BY_KEY = Object.fromEntries(CONDITIONS.map(c => [c.k, c]));
export const AUTO_KEYS = ['abroad', 'plug', 'hot', 'cool', 'cold', 'rain', 'snow', 'sun'];

// A condition's name and icon, an occasion's too. Unknown keys (an occasion deleted since) read as gone.
export function condInfo(doc, k) {
  if (Object.hasOwn(BY_KEY, k)) return BY_KEY[k];
  const g = Object.hasOwn(doc.tags, k) ? doc.tags[k] : null;
  return g && !M.gone(g) ? { k, icon: g.icon, name: g.name, group: 'Occasions' } : null;
}

export const home = doc => M.pref(doc, 'home', '') || localCountry();
// Places that count as home for each other, though each has its own country code. US citizens need no passport
// between the US and Puerto Rico, Guam, the US Virgin Islands and the Northern Mariana Islands (USA.gov, "Do you
// need a passport to travel to or from U.S. territories", updated 31 March 2026), and the minor outlying islands go
// with them. American Samoa runs its own entry checks (a passport or a birth certificate), so it stays abroad.
// Their plugs still go by their own country.
const ONE_HOME = [['US', 'PR', 'GU', 'VI', 'MP', 'UM']];
export const sameHome = (a, b) => a === b || ONE_HOME.some(g => g.includes(a) && g.includes(b));
// °F at home where the weather is reported in it: the US and its territories, Palau, Micronesia, the Marshall
// Islands and the Cayman Islands (Wikipedia, "Fahrenheit"), and Liberia.
const FAHRENHEIT = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'PW', 'FM', 'MH', 'KY', 'LR'];
export const units = doc => M.pref(doc, 'units', '') || (FAHRENHEIT.includes(home(doc)) ? 'F' : 'C');
export const laundry = doc => M.pref(doc, 'laundry', 7);

// "Thu, Fri and Sat"; more than three days becomes "on 5 days". Days more than a week apart have their dates, as
// a weekday alone could be either of two: "Mon 2 and Mon 9".
function dayList(list) {
  if (list.length > 3) return `on ${list.length} days`;
  const dated = num(list.at(-1)) - num(list[0]) > 6;
  const names = list.map(k => (dated ? `${weekday(k)} ${+k.slice(8)}` : weekday(k)));
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// When something comes along, as words that finish a sentence: a condition by its phrase ("when it's cool", "when
// abroad"), an occasion by its name ("for work"), and a mix "when it's hot or for swimming". wrap(info, words) can
// dress each one, with its icon say; parts come back as a list, words as a string.
export function whenParts(doc, keys, wrap = (info, words) => words) {
  const infos = keys.map(k => condInfo(doc, k)).filter(Boolean);
  const conds = infos.filter(i => i.phrase), occasions = infos.filter(i => !i.phrase);
  const list = (items, words) => items.flatMap((i, n) => [n ? ' or ' : '', wrap(i, words(i))]);
  const out = [];
  if (conds.length) out.push('when ', ...list(conds, i => i.phrase));
  if (occasions.length) out.push(conds.length > 1 ? ', or for ' : conds.length ? ' or for ' : 'for ', ...list(occasions, i => i.name.toLowerCase()));
  return out.filter(x => x !== '');
}
export const whenWords = (doc, keys) => whenParts(doc, keys).join('');

// What an occasion (or any condition) brings, and what it keeps home, in My list's order: comes, the bags and things
// that come along only when it's on, as one of their conditions; stays, those left home for it. A thing in a bag
// that's listed goes with its bag, so it isn't named again. Each is { bag } or { item }.
export function occasionThings(doc, k) {
  const out = { comes: [], stays: [] };
  for (const [list, field] of [[out.comes, 'when'], [out.stays, 'unless']]) {
    for (const b of M.bags(doc)) {
      if (b[field].includes(k)) list.push({ bag: b });
      else for (const it of M.items(doc, b.id)) if (it[field].includes(k)) list.push({ item: it });
    }
  }
  return out;
}

// "about 5 days in 10", from a share of days (0 to 1); '' when it rounds to none.
function inTen(share) {
  const n = Math.round(share * 10);
  return n ? `about ${n} ${n === 1 ? 'day' : 'days'} in 10` : '';
}

// "a, b and c"
const and = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '');

// Where a trip is, day by day: its place from the day you leave, then each stop from the night you get there to the
// day before the next, the last one to the day you're back. A stop on a night outside the trip, or on the same night
// as another (the newer one counts), isn't one of them. A trip with one place is one leg, its whole trip.
//   [{ id: '' (the trip's own place) or the stop's id, place, from, to, wx }]
export function legs(trip) {
  const out = [{ id: '', place: trip.place, from: trip.start, wx: trip.wx }];
  const list = M.stops(trip).filter(s => s.from > trip.start && s.from < trip.end)
    .sort((a, b) => a.from.localeCompare(b.from) || b.t - a.t || a.id.localeCompare(b.id));
  for (const s of list) if (s.from !== out.at(-1).from) out.push({ id: s.id, place: s.place, from: s.from, wx: s.wx });
  return out.map((l, i) => ({ ...l, to: i + 1 < out.length ? add(out[i + 1].from, -1) : trip.end }));
}
// The places of the latest trips, the latest first, each once: a trip's own place, then its stops. Plan a trip offers
// them to pick with one tap.
export function recentPlaces(doc, n = 4) {
  const out = [], seen = new Set();
  const list = M.trips(doc).sort((a, b) => b.start.localeCompare(a.start) || b.t - a.t || a.id.localeCompare(b.id));
  for (const t of list) {
    for (const { place: p } of legs(t)) {
      const k = !p ? '' : p.lat !== undefined ? `${p.lat},${p.lon}` : 'name:' + p.name.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length === n) return out;
    }
  }
  return out;
}

// What was added just for a trip (kayak paddles in the car, a birthday present), to offer when it's planned again:
// each name once, leaving out what's on My list now, each in the bag it went in on that trip if that's still there,
// else its own, else the first bag. [{ id, name, bag }]
export function lastAdded(doc, trip) {
  const packing = M.bags(doc).filter(b => b.kind === 'bag'), there = id => packing.some(b => b.id === id);
  const key = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const listed = new Set(M.items(doc).map(x => key(x.name))), seen = new Set(), out = [];
  for (const x of M.extras(trip)) {
    const k = key(x.name);
    if (listed.has(k) || seen.has(k)) continue;
    seen.add(k);
    const bag = [trip.marks?.['b:' + x.id]?.v, x.bag].find(there) || packing[0]?.id;
    if (bag) out.push({ id: x.id, name: x.name, bag });
  }
  return out;
}

// Each leg with its saved days. Together they're the trip's weather.
export const legDays = trip => legs(trip).map(l => ({ ...l, days: tripDays(l.wx, l.from, l.to, l.place) }));

// Every condition for this trip: what the place and weather say (auto), what the person set (set), the
// result (on), a few words on why for each one that's on (why), and for one the place or weather says no to, why
// not (no), and where only some of your plugs fit, which (plugNote). A trip with stops is abroad when any of its
// places is, has every country's plugs, and is hot, rainy and so on when any place's own days are; its reasons name
// the place.
export function conditions(doc, trip) {
  const u = units(doc), from = home(doc), ls = legDays(trip), multi = ls.length > 1;
  const auto = { [trip.travel]: true }, why = {}, no = {};
  let plugNote = '';
  why[trip.travel] = BY_KEY[trip.travel].name;
  // At home only when every place is known to be. A place in another country that counts as home (Puerto Rico from
  // the US) isn't abroad, but its plugs are its own.
  const known = ls.filter(l => l.place?.cc), away = known.filter(l => !sameHome(from, l.place.cc));
  if (away.length || (known.length && known.length === ls.length)) {
    auto.abroad = away.length > 0;
    const byCountry = list => [...new Map(list.map(l => [l.place.cc, l.place.country || countryName(l.place.cc)]))];
    const countries = byCountry(known.filter(l => l.place.cc !== from));
    if (auto.abroad) why.abroad = and(byCountry(away).map(([, name]) => name));
    else if (countries.length) no.abroad = `${and(countries.map(([, name]) => name))} ${countries.length > 1 ? 'count' : 'counts'} as home`;
    else no.abroad = no.plug = 'In your home country';
    // An adapter for each country whose sockets your plugs don't fit, named when the trip goes to more than one.
    const plugs = countries.map(([cc, name]) => ({ name, p: plugsFor(from, cc) })).filter(x => x.p);
    const need = plugs.filter(x => x.p.need), named = new Set(known.map(l => l.place.cc)).size > 1;
    auto.plug = need.length > 0;
    const said = new Map();
    for (const x of need.length ? need : plugs) said.set(plugText(x.p), [...(said.get(plugText(x.p)) || []), x.name]);
    if (said.size) why.plug = [...said].map(([text, names]) => (named ? `${and(names)}: ` : '') + text).join('; ') + ((need.length ? need : plugs).some(x => x.p.voltsDiffer) ? ' · check anything that heats up' : '');
    // Where only some of your plugs fit, a note (plugNote) for the Abroad line and the plug's no: the adapter stays
    // for you to bring by hand.
    const some = plugs.filter(x => !x.p.need && x.p.some), full = plugs.filter(x => !x.p.need && !x.p.some);
    if (some.length) plugNote = some.map(x => (named ? `${x.name}: ${x.p.some[0].toLowerCase()}${x.p.some.slice(1)}` : x.p.some)).join(' · ');
    if (plugs.length && !need.length) no.plug = [full.length ? (plugs.length > 1 ? `Your plugs fit in ${and(full.map(x => x.name))}` : 'Your plugs fit there') : '', plugNote].filter(Boolean).join(' · ');
  }
  const w = summarize({ days: ls.flatMap(l => l.days) });
  // With stops, each place's days on their own: what the first place that calls for something says.
  const parts = multi ? ls.map(l => ({ name: l.place?.name, w: summarize({ days: l.days }) })).filter(x => x.w) : [];
  const where = test => { const x = parts.find(p => test(p.w)); return x ? ` in ${x.name}` : ''; };
  if (w && multi) {
    for (const k of ['hot', 'cold', 'rain', 'snow', 'sun']) w[k] = parts.some(x => x.w[k]);
    w.cool = !w.cold && parts.some(x => x.w.cool);
  }
  if (w) {
    for (const k of ['hot', 'cool', 'cold', 'rain', 'snow', 'sun']) auto[k] = w[k];
    // Each in the words of the rule that brought it (weather.js summarize).
    const often = (share, what) => `${what} ${share >= 0.85 ? 'most days' : `on ${inTen(share) || 'about 1 day in 10'}`} this time of year`;
    // Forecast days of rain or snow name their place when they're all in one.
    const daysAt = (k, list) => { const at = parts.filter(x => x.w[k].some(d => list.includes(d))); return at.length === 1 ? ` in ${at[0].name}` : ''; };
    const rainy = parts.find(x => x.w.rain), snowy = parts.find(x => x.w.snow), sunny = parts.find(x => x.w.sun);
    const chilly = w.minLo > LIMITS.cold ? parts.find(x => x.w.cold) : null;
    why.hot = `Highs up to ${temp(w.maxHi, u)}${where(x => x.maxHi === w.maxHi)}`;
    why.cool = `Lows down to ${temp(w.minLo, u)}${where(x => x.minLo === w.minLo)}`;
    why.cold = w.minLo <= LIMITS.cold ? why.cool : `Highs around ${temp((chilly?.w || w).meanHi, u)}${chilly ? ` in ${chilly.name}` : ''}`;
    why.rain = w.rainDays.length ? `Rain ${w.rainLikely ? 'likely' : 'forecast'} ${dayList(w.rainDays)}${daysAt('rainDays', w.rainDays)}`
      : rainy ? often(rainy.w.wet, `Rain in ${rainy.name}`) : often(w.wet, 'Rain');
    why.snow = w.snowDays.length ? `Snow likely ${dayList(w.snowDays)}${daysAt('snowDays', w.snowDays)}`
      : snowy ? often(snowy.w.sn, `Snow in ${snowy.name}`) : often(w.sn, 'Snow');
    // The forecast's UV, or typical weather's estimate of it ("about"), or for typical days saved before there was an
    // estimate, how sunny they were.
    why.sun = w.forecast && w.uv >= LIMITS.uv ? `UV up to ${Math.round(w.uv)}${where(x => x.forecast && x.uv === w.uv)}`
      : w.tuv >= LIMITS.uv ? `UV about ${Math.round(w.tuv)}${where(x => x.tuv === w.tuv)} then` : sunny ? `Strong sun in ${sunny.name} then` : 'Strong sun then';
    no.hot = `Highs up to ${temp(w.maxHi, u)}`;
    no.cool = w.cold ? 'Cold instead' : `Lows ${temp(w.minLo, u)} and up`;
    no.cold = `Lows ${temp(w.minLo, u)} and up`;
    no.rain = w.forecast ? 'No rain forecast' : inTen(w.wet) ? `Rain on ${inTen(w.wet)}` : 'Hardly any rain then';
    no.snow = w.forecast ? 'No snow forecast' : inTen(w.sn) ? `Snow on ${inTen(w.sn)}` : 'Hardly any snow then';
    const fcUv = w.forecast && w.uv ? `UV up to ${Math.round(w.uv)}` : '', tyUv = w.estimated ? `about ${Math.round(w.tuv)}` : '';
    no.sun = fcUv && tyUv ? `${fcUv}, then ${tyUv}` : fcUv || (tyUv ? `UV ${tyUv} then` : 'Not much sun then');
  }
  const on = { ...auto };
  for (const [k, m] of Object.entries(trip.set || {})) {
    if (m.v === null || m.v === undefined || M.TRAVEL.includes(k)) continue;
    on[k] = !!m.v;
    if (m.v && auto[k] !== true) why[k] = BY_KEY[k] ? 'You turned this on' : condInfo(doc, k)?.name || '';
  }
  for (const g of M.tags(doc)) if (on[g.id]) why[g.id] = g.name;
  return { auto, on, why, no, plugNote, weather: w, units: u };
}

// Whether a rule (when/unless) lets something come along, and the conditions that brought it.
export function passes(rule, on) {
  const hits = rule.when.filter(k => on[k]);
  if (rule.when.length && !hits.length) return { ok: false, hits };
  const blocks = rule.unless.filter(k => on[k]);
  return { ok: !blocks.length, hits, blocks };
}

export const days = trip => nights(trip.start, trip.end) + 1;
// One, two or three for each day, up to the laundry limit's days: two a day for a week is 14.
export const qtyOf = (doc, trip, item) => (item.per === 'day' ? Math.min(days(trip), laundry(doc)) * (item.qty || 1) : item.qty || 1);

// Whether a bag or list of jobs comes on a trip: its conditions say so, or it was brought along anyway, and it
// wasn't left off ('x:BAGID').
export function bagComing(trip, bag, on) {
  const pick = trip.marks?.['x:' + bag.id]?.v;
  return pick === 'add' || (pick !== 'skip' && passes(bag, on).ok);
}

// Why something isn't coming: "Only when it's cold or snow's likely", "Only for work", "Not when you're driving".
export function whyNot(doc, rule, res) {
  if (!res.ok && res.blocks?.length) return `Not ${whenWords(doc, res.blocks)}`;
  const w = whenWords(doc, rule.when);
  return w ? `Only ${w}` : '';
}

// The list for one trip.
//   mode 'go': packing to leave. 'back': packing to come home, which lists what went (or, if nothing was
//   ticked going, everything that was on the list) and the jobs before leaving the hotel.
// A whole bag or list of jobs can be left off one trip ('x:BAGID' 'skip'), or brought along when its
// conditions say no ('add'), the same way a single thing can.
// A thing goes in the bag it's in this trip: its own, or the one it was moved to ('b:ID'). It comes along when
// either of those does, so moving it out of a bag that's left off brings it.
// Going, a thing packed last (My list's Pack it last, or 'l:ID' for this trip) waits in a group of its own, the last
// things out the door, rather than in its bag, which counts without it. One to buy there ('x:ID' 'buy') is on a list
// of its own, which doesn't count as packing; coming home it isn't listed, unless it was packed after all.
// Returns { groups: [{ bag, rows }], last: { bag: LAST, rows } or null, tasks: [{ bag, rows }], left: [{ item, why,
//   skipped }] (things, then jobs), leftBags: [{ bag, why, skipped, count, more }], buy: [{ id, name, bag (the bag it
//   would go in), extra? }] (going), done, total, morning, cond }
//   count: how many of the bag's things its line stands for. more: some things in it are on the list anyway (moved
//   or added to it, or packed already), so those are more.
//   morning: going, with everything in the bags packed, how many of the last things out the door and the jobs
//   before leaving the house are still to do; otherwise 0.
// A row: { id, name, note, qty, daily (how many a day, for one by the day), capped (stopped at the laundry limit),
//   hits: [condition keys], key: the mark key, done, extra?, gone?, deleted? (coming home: packed going, deleted
//   from My list since), last? and goes (the bag it goes in) for one packed last }
export const LAST = { id: '_last', name: 'Last thing out the door', icon: '🚪', kind: 'bag', when: [], unless: [], note: 'Still in use the night before: pack these on the way out.', order: 1e9 };
// Whether a thing is packed last on this trip: as picked for this trip, or else as My list says.
export const packedLast = (doc, trip, id) => {
  const v = trip.marks?.['l:' + id]?.v;
  return typeof v === 'boolean' ? v : !!(Object.hasOwn(doc.items, id) && doc.items[id].last?.v);
};
export function plan(doc, trip, mode = 'go') {
  const cond = conditions(doc, trip), on = cond.on;
  const marks = trip.marks || {};
  const mv = id => marks['b:' + id]?.v;
  const pick = id => marks['x:' + id]?.v;
  const isPacked = id => marks['p:' + id]?.v === 1;
  const anyPacked = Object.entries(marks).some(([k, m]) => k.startsWith('p:') && m.v === 1);
  const allBags = M.bags(doc);
  const coming = b => bagComing(trip, b, on);
  const groups = new Map(), tasks = [], left = [], leftBags = [], last = [], buy = [];
  const groupOf = bag => { if (!groups.has(bag.id)) groups.set(bag.id, { bag, rows: [] }); return groups.get(bag.id); };
  const going = mode === 'go';
  // Going, a row packed last goes in its own group, saying which bag it goes in.
  const put = (bag, row) => { if (going && packedLast(doc, trip, row.id)) last.push({ ...row, last: true, goes: bag }); else groupOf(bag).rows.push(row); };
  const fallback = { id: '_loose', name: 'Not in a bag', icon: '🧳', kind: 'bag', when: [], unless: [], order: 1e9 };
  const bagFor = id => allBags.find(b => b.id === id && b.kind === 'bag');
  const covered = {}; // bag id → how many of its things this trip wait under its line in Left off

  for (const b of allBags.filter(b => b.kind === 'bag')) groupOf(b);
  for (const it of M.items(doc)) {
    const home = allBags.find(b => b.id === it.bag);
    if (!home || home.kind !== 'bag') continue;
    const to = bagFor(mv(it.id)), bag = to || home;
    const res = passes(it, on), bagIn = coming(home) || (!!to && coming(to));
    const p = pick(it.id), packed = isPacked(it.id);
    if (p === 'buy' && (going || !packed)) { if (going) buy.push({ id: it.id, name: it.name, bag }); continue; }
    if (!(p === 'add' || packed || (p !== 'skip' && res.ok && bagIn))) {
      // Things in a bag that isn't coming are covered by the bag's own line.
      if (bagIn) left.push({ item: it, skipped: p === 'skip', why: p === 'skip' ? 'You left it off this trip' : whyNot(doc, it, res) });
      else covered[bag.id] = (covered[bag.id] || 0) + 1;
      continue;
    }
    if (mode === 'back' && anyPacked && !packed) continue;
    put(bag, {
      id: it.id, name: it.name, note: it.note, qty: qtyOf(doc, trip, it), daily: it.per === 'day' ? it.qty || 1 : 0, capped: it.per === 'day' && days(trip) > laundry(doc),
      hits: res.hits, key: (mode === 'go' ? 'p:' : 'r:') + it.id,
      added: p === 'add', moved: bag !== home, packedOnly: (!res.ok || !bagIn) && p !== 'add',
    });
  }
  for (const x of M.extras(trip)) {
    const packed = isPacked(x.id);
    const bag = bagFor(mv(x.id)) || bagFor(x.bag) || fallback;
    if (pick(x.id) === 'buy' && (going || !packed)) { if (going) buy.push({ id: x.id, name: x.name, bag, extra: true }); continue; }
    if (mode === 'back' && anyPacked && !packed) continue;
    put(bag, { id: x.id, name: x.name, note: '', qty: 1, hits: [], key: (mode === 'go' ? 'p:' : 'r:') + x.id, extra: true });
  }
  // Coming home, what went comes back, though it's been deleted from My list since, alone or with its bag: in the
  // bag it went in this trip, or its own if that's still there, or else with the things not in a bag.
  if (mode === 'back') {
    const listed = new Set(M.items(doc).map(x => x.id));
    const deleted = Object.values(doc.items).filter(it => !listed.has(it.id) && isPacked(it.id) && (doc.bags[it.bag]?.kind ?? 'bag') === 'bag');
    const rank = it => doc.bags[it.bag]?.order ?? 1e9;
    deleted.sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name));
    for (const it of deleted) {
      groupOf(bagFor(mv(it.id)) || bagFor(it.bag) || fallback).rows.push({
        id: it.id, name: it.name, note: it.note, qty: qtyOf(doc, trip, it), daily: it.per === 'day' ? it.qty || 1 : 0, capped: it.per === 'day' && days(trip) > laundry(doc),
        hits: [], key: 'r:' + it.id, deleted: true,
      });
    }
  }
  // Bags and lists of jobs not coming on this trip, the ones this way of packing shows, each with what it stands for.
  const kinds = mode === 'go' ? ['bag', 'leave'] : ['back'];
  for (const b of allBags) {
    if (!kinds.includes(b.kind) || coming(b)) continue;
    const count = b.kind === 'bag' ? covered[b.id] || 0 : M.items(doc, b.id).length;
    if (!count) continue;
    const skipped = pick(b.id) === 'skip';
    leftBags.push({ bag: b, skipped, why: skipped ? 'You left it off this trip' : whyNot(doc, b, passes(b, on)), count, more: !!groups.get(b.id)?.rows.length });
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
  // The last things out the door in the order of their bags, each bag's in its own order.
  const lastGroup = last.length ? { bag: LAST, rows: last.sort((a, b) => a.goes.order - b.goes.order) } : null;
  const all = [...list, ...(lastGroup ? [lastGroup] : []), ...tasks].flatMap(g => g.rows);
  for (const r of all) r.done = (marks[r.key]?.v || 0) > 0;
  if (mode === 'back') for (const r of all) r.gone = marks[r.key]?.v === 2;
  const inBags = list.flatMap(g => g.rows), later = [...last, ...tasks.flatMap(g => g.rows)].filter(r => !r.done).length;
  return {
    groups: list, last: lastGroup, tasks, left: mode === 'go' ? [...left, ...leftJobs] : leftJobs, leftBags, buy, cond,
    done: all.filter(r => r.done).length, total: all.length,
    morning: going && inBags.length && inBags.every(r => r.done) ? later : 0,
  };
}

// Ticks on too few: the mark keys of things ticked going whose count is higher in after than in before (a longer
// trip, a higher laundry limit, a higher How many), so the tick stands for fewer than the list now asks for.
export function grown(before, after, tripId) {
  const a = before.trips[tripId], b = after.trips[tripId];
  if (!a || !b || M.gone(a) || M.gone(b)) return [];
  const rows = (doc, trip) => { const p = plan(doc, trip, 'go'); return [...p.groups, ...(p.last ? [p.last] : [])].flatMap(g => g.rows); };
  const was = new Map(rows(before, a).map(r => [r.key, r.qty]));
  return rows(after, b).filter(r => r.done && r.qty > (was.get(r.key) ?? Infinity)).map(r => r.key);
}
