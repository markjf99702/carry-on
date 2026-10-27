// Carry On: the page. Screens are drawn from the store each time something changes (#/, #/trip/ID, #/new,
// #/edit/ID, #/again/ID, #/list, #/settings), and #list=… brings in a list from a link.
import * as M from './model.js';
import * as R from './rules.js';
import * as W from './weather.js';
import * as D from './days.js';
import { store } from './store.js';
import { drive } from './sync.js';
import { starterList } from './starter.js';
import { tripCalendar } from './calendar.js';
import { parsePaste, encodeList, decodeList, guess, bagIcon, sortLoose, listText } from './share.js';
import { PLUGS, countryName } from './plugs.js';
import { h, ICONS, toast, toastKeep, toastNext, sheet, closeSheet, setupSheet, confirmBtn, pressedKey, byKey } from './ui.js';

export const SITE = 'https://carry-on.junkdrawer.works/';
const main = document.getElementById('app');
const single = document.documentElement.hasAttribute('data-single');
const doc = () => store.doc;
const today = () => D.today();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// How many a day, in words: "one", "two", "three", then numbers.
const perDay = n => ['one', 'two', 'three'][(n || 1) - 1] || String(n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const BAG_ICONS = ['🧳', '🧴', '🪥', '💊', '🔌', '🛂', '👜', '🎒', '👕', '👟', '💼', '🏋️', '🧸', '🍼', '📷', '🎮', '⛳', '🏕️', '🎿', '🏖️', '🐶', '📚', '🍫', '🏠', '🏨'];
const TAG_ICONS = ['🏷️', '💼', '🏋️', '🏊', '👔', '🥾', '💍', '🎉', '⛳', '🎿', '🏕️', '👶', '🐶', '🎭', '🏖️', '🎸', '🚴', '🎣'];

// ---------- drawing ----------

let current = '';
let drawn = 0; // how many times the page has been drawn, for redraw()
// What's been changed on Plan a trip, Edit trip or Go again but not saved yet. The page redraws underneath it
// (back from another app, a forecast arriving, a sync landing, another tab saving), and the form is rebuilt from
// this. It holds only what was changed, so the rest still follows the trip, and it goes when the screen changes,
// on Save and on Delete.
let draft = null;
// Each place in the history remembers the screen it was opened from (from) and the one before that (before), so
// Save and Delete can step back to the trip, or past it, rather than add a step that Back undoes onto the form.
// They live in history.state, so they last through a reload. lastHash and lastFrom are the screen drawn before.
let lastHash = '', lastFrom = '', thenGo = null;
// Where each trip was scrolled to when it was left ('TRIPID:go' or ':back'), so opening it again this visit goes
// back there rather than to the top. shownTrip is the trip on screen, and tripY how far down it is, kept as it
// scrolls because by the time a move away is drawn, Back may already have scrolled the page.
const scrolls = new Map();
let shownTrip = '', tripY = 0;
try { history.scrollRestoration = 'manual'; } catch { /* the browser keeps its own */ }
addEventListener('scroll', () => { if (shownTrip) tripY = scrollY; }, { passive: true });
function render() {
  drawn++;
  const hash = location.hash || '#/';
  if (hash.startsWith('#list=')) { takeLink(hash.slice(6)); return; }
  // Back to a trip that Delete stepped back to: it goes, and Trips takes its place.
  if (thenGo?.at === hash) { const to = thenGo.to; thenGo = null; go(to, { replace: true }); return; }
  const [, page = '', id = ''] = hash.slice(1).split('/');
  const screen = page + '/' + id, moved = screen !== current;
  if (moved) {
    if (awake.trip && !(page === 'trip' && decodeURIComponent(id) === awake.trip)) letSleep();
    if (shownTrip) scrolls.set(shownTrip, tripY);
    shownTrip = '';
    draft = null; packedSeen = null; linger.clear(); clearTimeout(lingerT); lingerT = null;
    if (!history.state || !('from' in history.state)) remember({ from: lastHash, before: lastFrom });
    lastHash = hash; lastFrom = history.state?.from ?? '';
  }
  // Focus, where the cursor was in a text box, and anything half-typed in an add box come through the redraw. The
  // focus goes back to the control with the same key (the one tapped, in Safari), and if that's gone (left off,
  // packed, deleted), to the nearest one still there.
  const was = document.activeElement, onTitle = !moved && was?.tagName === 'H1' && main.contains(was);
  const key = moved ? '' : pressedKey(main), fid = !moved && !key && main.contains(was) ? was.id : '';
  const near = key ? around(byKey(main, key)) : [];
  const caret = was?.selectionStart != null ? [was.selectionStart, was.selectionEnd] : null;
  const typed = moved ? [] : [...main.querySelectorAll('input[data-key]:not([type="checkbox"])')].filter(x => x.value).map(x => [x.dataset.key, x.value]);
  const nodes = view(page, decodeURIComponent(id));
  main.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  for (const [k, v] of typed) { const x = byKey(main, k); if (x && !x.value) x.value = v; }
  // The screen's heading names the page in the tab and the history ("Lisbon · Carry On"; Trips and the first screen
  // are plain "Carry On"), and on a new screen the focus goes to it, so a screen reader says where it is.
  const h1 = main.querySelector('h1');
  if (h1) h1.tabIndex = -1;
  document.title = page && h1 && !main.querySelector('.welcome') ? `${h1.textContent} · Carry On` : 'Carry On';
  if (moved) { current = screen; window.scrollTo(0, scrolls.has(shownTrip) ? scrolls.get(shownTrip) : page === 'trip' ? listTop(id) : 0); tripY = scrollY; (h1 || main).focus({ preventScroll: true }); }
  else if (onTitle) h1?.focus({ preventScroll: true });
  const back = key ? byKey(main, key) : fid ? main.querySelector('#' + CSS.escape(fid)) : null;
  if (back) {
    back.focus({ preventScroll: true });
    if (caret && back.setSelectionRange) try { back.setSelectionRange(...caret); } catch { /* not a text box */ }
  } else focusFirst(near);
  document.body.dataset.page = page || 'home';
  sayChange();
}

// Where a trip opens, the first time this visit: with anything ticked, going or coming home, at its list, with the
// Going / Coming home switch just under the top bar and the boarding pass and the weather one swipe up; with nothing
// ticked yet, at its top.
function listTop(id) {
  const marks = doc().trips[decodeURIComponent(id)]?.marks || {}, at = main.querySelector('.seg.mode');
  if (!at || !Object.entries(marks).some(([k, m]) => /^[pr]:/.test(k) && m.v)) return 0;
  return at.getBoundingClientRect().top + scrollY - (document.querySelector('.bar')?.offsetHeight || 0) - 8;
}

// The keys to try, in order, when the control with the focus goes: the next ones in its bag (or in Left off), then
// the ones before it, then the bag's folded line and its ⋯, then the rest of the page from there.
function around(el) {
  if (!el) return [];
  const step = list => { const i = list.indexOf(el); return i < 0 ? [] : [...list.slice(i + 1), ...list.slice(0, i).reverse()].map(x => x.dataset.key); };
  const box = el.closest('.bag, .left');
  const own = !box ? [] : box.dataset.bag ? ['fold:' + box.dataset.bag, 'bagmore:' + box.dataset.bag, 'all-bags'] : ['left'];
  return [...(box ? step([...box.querySelectorAll('.rows [data-key]')]) : []), ...own, ...step([...main.querySelectorAll('[data-key]')])];
}
function focusFirst(keys) {
  for (const k of keys) { const x = byKey(main, k); if (x) { x.focus({ preventScroll: true }); return; } }
}

function view(page, id) {
  // With no list there's nothing to plan, but trips already made can still be opened.
  if (!M.hasList(doc()) && !['settings', 'trip', 'edit'].includes(page)) return welcome();
  if (page === 'trip') { const t = doc().trips[id]; return t && !M.gone(t) ? tripView(t) : missing(id); }
  if (page === 'new') return tripForm(null);
  if (page === 'edit' || page === 'again') {
    const t = doc().trips[id];
    // Deleted, maybe on another device: saving the form would bring it back.
    if (!t || (page === 'edit' && M.gone(t))) { draft = null; return missing(id); }
    return tripForm(t, page === 'again');
  }
  if (page === 'list') return listView();
  if (page === 'settings') return settingsView();
  return homeView();
}

// A trip that isn't here: deleted, or never saved in this browser. A calendar alert's link (Add to my calendar) opens
// the browser, and on an iPhone, Carry On on the Home Screen keeps its own storage, apart from Safari's ("Home Screen
// web apps have ... separate cookies and storage from the browser": Apple, WWDC23, What's new in web apps).
const missing = id => {
  const known = !!id && Object.hasOwn(doc().trips, id), own = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return h('section', { class: 'card empty' }, h('h1', {}, 'That trip isn’t here'),
    h('p', {}, known || own ? 'It may have been deleted on another device.' : 'It isn’t saved in this browser. If you planned it in Carry On on your home screen, open it from there.'),
    h('a', { class: 'btn primary', href: '#/' }, 'All trips'));
};
// go(hash, { replace: true }) takes the place of this screen in the history, keeping where it was opened from.
function go(hash, { replace = false } = {}) {
  if (replace) {
    const from = history.state?.from ?? '', before = history.state?.before ?? '';
    if (remember({ from, before }, hash)) render(); else location.replace(hash);
  } else if (location.hash === hash) render();
  else location.hash = hash;
}
function remember(state, hash) {
  try { history.replaceState(state, '', hash); return true; } catch { return false; } // a copy in a frame that can't
}
const apply = fn => { store.apply(fn); render(); };

// A change that can raise how many of something a trip needs (a later Back, a higher laundry limit, a higher How
// many) unticks what was ticked for the old count, so the list can't say all packed two pairs of socks short. Only
// on trips not under way yet: on one under way, what was ticked going is what Coming home lists. A toast says what
// was unticked, and Undo puts the ticks back.
function applyCounting(fn) {
  const t0 = today(), unticked = [];
  const after = store.apply(d => {
    let next = fn(d);
    for (const t of M.trips(next)) {
      const keys = t.start >= t0 ? R.grown(d, next, t.id) : [];
      if (!keys.length) continue;
      unticked.push([t.id, keys.map(k => [k, t.marks[k].v])]);
      next = M.markAll(next, t.id, keys, 0);
    }
    return next;
  });
  if (!unticked.length) return;
  const names = [], counts = new Set();
  for (const [id, marks] of unticked) {
    for (const [k] of marks) {
      const x = after.items[k.slice(2)];
      if (!x) continue;
      if (!names.includes(x.name)) names.push(x.name);
      counts.add(R.qtyOf(after, after.trips[id], x));
    }
  }
  const one = names.length === 1;
  const said = names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : andList(names);
  toast(`${said} need${one ? 's' : ''} more now${counts.size === 1 ? ` (×${[...counts][0]})` : ''}${unticked.length > 1 ? ` on ${unticked.length} trips` : ''}, so ${one ? 'it’s' : 'they’re'} unticked.`, {
    label: 'Undo',
    run: () => apply(d => unticked.reduce((doc1, [id, marks]) => marks.reduce((doc2, [k, v]) => M.mark(doc2, id, k, v), doc1), d)),
  });
}

// ---------- the first screen ----------

// Set by the first screen's Bring my list from Google Drive: Settings opens at its Google Drive card, once.
let toDrive = false;

function welcome() {
  return h('section', { class: 'welcome' },
    h('p', { class: 'kicker' }, 'Packing list'),
    h('h1', {}, 'Pack for the trip you’re actually taking.'),
    h('p', { class: 'lede' }, 'Keep everything you might pack in one list, sorted by bag. Each trip gets its own fresh copy, matched to the forecast, where you’re going and what you’ll be doing. There’s nothing to uncheck afterwards.'),
    h('div', { class: 'choices' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => { store.apply(d => M.startWith(d, starterList())); toast('Starter list in. Change anything in My list.', { label: 'See it', run: () => go('#/list') }); go('#/'); } }, 'Start with a starter list'),
      h('button', { type: 'button', class: 'btn big', onclick: () => pasteSheet() }, 'Paste my own list'),
      drive.ready ? h('a', { class: 'btn big', href: '#/settings', onclick: () => { toDrive = true; } }, 'Bring my list from Google Drive') : null),
    h('p', { class: 'small muted' }, 'Pasting works with a list copied from Google Keep, Notes or a document. Put each bag’s things under its name.'),
    // Where there's no Google Drive (the one-file copy, say), it isn't mentioned.
    h('p', { class: 'small muted' }, `No account. Your list stays on this phone${drive.ready ? ' unless you turn on Google Drive' : ''}.`),
    h('h2', { class: 'kicker how-head' }, 'How it works'),
    h('ul', { class: 'how' },
      h('li', {}, h('b', {}, 'Sorted by bag. '), 'Pack the liquids bag, then the day bag, then the clothes.'),
      h('li', {}, h('b', {}, 'Knows the weather. '), 'The umbrella comes along when rain is forecast. The coat comes when it’s cold.'),
      h('li', {}, h('b', {}, 'Knows where you’re going. '), 'Abroad, it adds your passport, plus a plug adapter if the sockets there are different.'),
      h('li', {}, h('b', {}, 'Knows your plans. '), 'Pick what’s on, like work or swimming: the work bag comes on work trips.'),
      h('li', {}, h('b', {}, 'Coming home too. '), 'A second pass makes sure nothing stays behind at the hotel.')),
    yourTrips());
}

// Trips made before the list went: still here, and they fill in again once there's a list.
function yourTrips() {
  const t0 = today(), all = M.trips(doc()).sort((a, b) => (a.end < t0) - (b.end < t0) || (a.end < t0 ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  if (!all.length) return null;
  return h('section', { class: 'past' },
    h('h2', {}, 'Your trips'),
    h('ul', {}, all.map(t => h('li', {},
      h('a', { href: `#/trip/${t.id}` }, h('b', {}, title(t)), h('span', { class: 'muted' }, D.span(t.start, t.end, t0.slice(0, 4))))))));
}

// ---------- trips ----------

function homeView() {
  const t0 = today();
  const all = M.trips(doc());
  const coming = all.filter(t => t.end >= t0).sort((a, b) => a.start.localeCompare(b.start));
  const past = all.filter(t => t.end < t0).sort((a, b) => b.start.localeCompare(a.start));
  for (const t of coming) maybeWeather(t);
  return [
    h('div', { class: 'page-head' },
      h('h1', {}, 'Trips'),
      h('a', { class: 'btn primary', href: '#/new' }, h('span', { html: ICONS.plus }), 'Plan a trip')),
    // Nothing coming up: a blank luggage tag for the next trip, which plans it.
    h('div', { class: 'tags' }, coming.length ? coming.map(tagCard) : h('a', { class: 'tag-card blank', href: '#/new' },
      h('span', { class: 'hole', 'aria-hidden': 'true' }),
      h('span', { class: 'when' }, 'Your next trip'),
      h('h2', {}, 'Where to?'),
      h('span', { class: 'where' }, all.length ? 'Nothing coming up.' : 'No trips yet.'),
      h('span', { class: 'blurb' }, 'Plan one and Carry On makes its list from yours: what the weather, the place and the plans call for, by bag.'))),
    past.length ? h('section', { class: 'past' },
      h('h2', {}, 'Past trips'),
      h('ul', {}, past.map(t => h('li', {},
        h('a', { href: `#/trip/${t.id}` }, h('b', {}, title(t)), h('span', { class: 'muted' }, D.span(t.start, t.end, t0.slice(0, 4)))),
        h('a', { class: 'again', href: `#/again/${t.id}` }, 'Go again'))))) : null,
  ];
}

const title = t => t.name || t.place?.name || 'Trip';
// A trip with stops, its places in order, each run of places in one country followed by that country unless it's
// home: "Lisbon → Porto, Portugal", "London, United Kingdom → Paris, France", "Boston → New York".
function route(t) {
  const runs = [], home = R.home(doc());
  for (const { place: p } of R.legs(t)) {
    if (!p) continue;
    if (runs.at(-1)?.cc === (p.cc || '')) runs.at(-1).names.push(p.name);
    else runs.push({ cc: p.cc || '', country: p.country || (p.cc ? countryName(p.cc) : ''), names: [p.name] });
  }
  return runs.map(r => r.names.join(' → ') + (r.country && r.cc !== home ? ',\u00a0' + r.country : '')).join(' → ');
}
// A trip's name as a heading, sized to fit (css .pass h1, .tag-card h2): --w is its longest word, which sets how big
// it can be and still fit on a phone without breaking mid-word, and a long name (.wordy) starts smaller.
const fitted = (tag, t) => {
  const name = title(t), w = Math.max(...name.split(/[\s-]+/).map(x => [...x].length));
  return h(tag, { class: name.length > 28 ? 'wordy' : null, style: `--w: ${w}` }, name);
};
// A bag by name in a sentence: "the Day bag", but "Electronics".
const theBag = b => (/\b(bag|case|pack|backpack|suitcase|pouch|kit|box|tote|purse)\b/i.test(b.name) ? 'the ' + b.name : b.name);

// Which way a trip opens: the way it was picked on this device today, or else Going, and from its last day on,
// Coming home. A pick lasts the day, so a trip switched back to Going while packing opens on Coming home the morning
// you leave the hotel. Its luggage tag counts the same way.
const tripMode = t => store.mode(t.id, today()) || (today() >= t.end ? 'back' : 'go');

// A plan's groups as a trip shows them going: the bags, the last things out the door, then the jobs.
const goingGroups = p => [...p.groups, ...(p.last ? [p.last] : []), ...p.tasks];
// How much is packed, in words, on a trip and its luggage tag: "7 of 55 packed"; with everything in the bags packed
// the night before, "All packed but 3 for the morning" (the last things out the door, and the jobs before leaving
// the house); "All packed". Coming home, "back in the bags". As [the part in bold, the rest].
const packedWords = (p, mode) => (p.total && p.done === p.total ? [mode === 'go' ? 'All packed' : 'All back in the bags', '']
  : p.morning ? ['All packed', ` but ${p.morning} for the morning`] : [`${p.done} of ${p.total}`, mode === 'go' ? ' packed' : ' back in the bags']);

// When a trip is, in a few words, on its luggage tag and its boarding pass: "In 3 days", "Tomorrow", "Now · back
// Wed", "Past trip". Back more than six days on, it's a date, as a weekday alone could be either of two.
function whenText(t) {
  const t0 = today();
  if (t.end < t0) return 'Past trip';
  if (t.start <= t0) return `Now · back ${t.end === t0 ? 'today' : D.num(t.end) - D.num(t0) > 6 ? D.short(t.end) : D.weekday(t.end)}`;
  return t.start === D.add(t0, 1) ? 'Tomorrow' : `In ${plural(D.num(t.start) - D.num(t0), 'day')}`;
}

// A rubber stamp across a trip that's all packed, on its boarding pass and its luggage tag: PACKED, or coming home,
// HOME. It's a picture of what the words beside it say, so a screen reader skips it.
const stamp = (mode, thump = false) => h('span', { class: 'stamp' + (thump ? ' thump' : ''), 'aria-hidden': 'true' }, mode === 'go' ? 'Packed' : 'Home');

function tagCard(t) {
  const t0 = today(), n = D.nights(t.start, t.end);
  const mode = tripMode(t), p = R.plan(doc(), t, mode), c = p.cond;
  const now = t.start <= t0;
  const w = c.weather, pl = t.place;
  // Under the name: the place and, abroad, its country. A trip named after its place has just the country, or at
  // home the state or region, as the pass has.
  // A trip with stops has its route.
  const country = pl?.cc && pl.cc !== R.home(doc()) ? pl.country || countryName(pl.cc) : '';
  const where = R.legs(t).length > 1 ? route(t) : (t.name ? [pl?.name, country] : [country || (pl?.admin !== pl?.name ? pl?.admin : '')]).filter(Boolean).join(', ');
  return h('a', { class: 'tag-card' + (now ? ' now' : ''), href: `#/trip/${t.id}` },
    h('span', { class: 'hole', 'aria-hidden': 'true' }),
    h('span', { class: 'when' }, whenText(t)),
    fitted('h2', t),
    where ? h('span', { class: 'where' }, where) : null,
    h('span', { class: 'dates' }, `${D.span(t.start, t.end, t0.slice(0, 4))} · ${n ? plural(n, 'night') : 'day trip'} · ${R.CONDITIONS.find(x => x.k === t.travel).icon}`),
    w ? h('span', { class: 'glance' }, `${W.dayIcon(R.legDays(t).flatMap(l => l.days)[0])} ${W.temp(w.minLo, c.units)}–${W.temp(w.maxHi, c.units)}${w.rain ? ' · rain' + (w.rainDays.length ? ' likely' : ' some days') : ''}${w.snow ? ' · snow' : ''}`) : null,
    h('span', { class: 'meter', 'aria-hidden': 'true' }, meter(t.id + ':tag', p.done, p.total)),
    p.done === p.total && p.total ? stamp(mode) : null,
    h('span', { class: 'packed' }, packedWords(p, mode).join('')));
}

// Printing (the browser's Print, or Share then Print on a phone): a trip is drawn for the paper first, every bag open
// whatever Hide done says and Left off open, and drawn as it was afterwards. css/app.css has the rest: no buttons, two
// columns, ticks that print. beforeprint and afterprint: Chrome 63, Safari 13, Firefox 6 (MDN browser compat data).
let printing = false;
addEventListener('beforeprint', () => { printing = true; render(); });
addEventListener('afterprint', () => { printing = false; render(); });

// ---------- weather lookups ----------

// A lookup that failed waits a minute before the next try, so a redraw doesn't ask again at once. One that worked
// doesn't hold the next back: weather cleared since (the trip's dates changed on another phone, say) is looked up
// again straight away. But only once a minute (wxQuick): another phone whose clock runs ahead stamps what it saves
// later than this phone's lookups, so its cleared weather, or its lookup of the trip's old place, wins every sync
// until this clock catches up, and the trip would be looked up again every few seconds.
// Each place on a trip is looked up for all the trip's days: its own place as the trip's weather, and each stop as
// the stop's. Each lookup goes by its key: the trip's id, or for a stop TRIPID:STOPID.
const wxBusy = {}, wxErr = {}, wxTried = {}, wxQuick = {};
const wxKey = (t, l) => (l.id ? `${t.id}:${l.id}` : t.id);
function maybeWeather(t, force = false) {
  for (const l of R.legs(t)) {
    const k = wxKey(t, l);
    if (!l.place || l.place.lat === undefined || wxBusy[k]) continue;
    if (!force && !W.stale(l.wx, t.start, t.end, today(), undefined, l.place)) continue;
    const soon = Date.now() - (wxTried[k] || 0) < 60000;
    if (!force && soon && (wxErr[k] || wxQuick[k])) continue;
    wxQuick[k] = !force && soon;
    wxTried[k] = Date.now();
    // The last lookup goes along: should the forecast fail, its forecast's days can stand in for a while.
    wxBusy[k] = W.tripWeather(l.place, t.start, t.end, today(), { prev: l.wx }).then(wx => {
      delete wxErr[k];
      const cur = doc().trips[t.id], at = l.id ? cur?.stops?.[l.id] : cur;
      // Only if the trip still goes there on those days.
      if (cur && cur.start === t.start && cur.end === t.end && at?.place?.lat === l.place.lat) store.apply(d => (l.id ? M.setStopWx(d, t.id, l.id, wx) : M.setWx(d, t.id, wx)));
    }, e => { wxErr[k] = e.message; }).finally(() => { delete wxBusy[k]; redraw(); });
  }
}

// What changing a trip did to its list: after Save on Edit trip, or on closing What this trip calls for, a word on
// what's on it now and what's off: "Reykjavík: Warm coat, Gloves and hat and Snow boots are on now; Sunscreen, Rain
// jacket and Umbrella are off." When the change needs a new forecast (a new place or new dates), it waits for it, so
// it says what the list settles on; leaving the trip meanwhile lets it go. Nothing changed, nothing's said.
// While What this trip calls for is open, the page redraws under it after every tap there, so what changed waits
// (held) until it closes, and says everything changed in it at once.
let change = null; // { id, before: [[thing's id, name], …] in the list's order, held }
const onList = t => { const p = R.plan(doc(), t, 'go'); return goingGroups(p).flatMap(g => g.rows.map(r => [r.id, r.name])); };
// Before a change: what's on the list. A change still waiting for its forecast keeps what was on it before that one.
function watchChange(id, { held = false } = {}) {
  const t = doc().trips[id];
  if (change?.id !== id) change = t ? { id, before: onList(t) } : null;
  if (change) change.held = held;
}
function sayChange({ now = false } = {}) {
  if (!change || (change.held && !now)) return;
  change.held = false;
  const t = doc().trips[change.id];
  if (!t || M.gone(t)) { change = null; return; }
  if (!now) {
    const [, page = '', id = ''] = (location.hash || '#/').slice(1).split('/');
    if (decodeURIComponent(id) !== change.id || page !== 'trip') { if (page !== 'edit') change = null; return; }
  }
  // Each place's forecast in, unless it isn't to be looked up (a place typed in, a trip that's over).
  const waiting = R.legDays(t).some(l => l.place?.lat !== undefined && (wxBusy[wxKey(t, l)] || (!l.days.length && W.stale(l.wx, t.start, t.end, today(), undefined, l.place))));
  if (waiting) return;
  const before = new Map(change.before), after = onList(t), still = new Set(after.map(([id]) => id));
  change = null;
  const on = after.filter(([id]) => !before.has(id)).map(([, name]) => name), off = [...before].filter(([id]) => !still.has(id)).map(([, name]) => name);
  const names = list => (list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : andList(list));
  const said = [on.length ? `${names(on)} ${on.length === 1 ? 'is' : 'are'} on now` : '', off.length ? `${names(off)} ${off.length === 1 ? 'is' : 'are'} off` : ''].filter(Boolean);
  if (said.length) toastNext(`${title(t)}: ${said.join('; ')}.`);
}

// A redraw that comes on its own (a forecast arriving, a sync landing, another tab saving). On a trip scrolled down
// to its list, the row in the middle of the screen stays where it is: the forecast's days, chips and rows appearing
// above would otherwise push the list down under a tap that's on its way. It waits for the next frame, so ten
// forecasts landing together draw the page once, and if a tap has drawn it since, with what's new, it isn't drawn
// again. A tap's own redraw comes at once.
let redrawSoon = false;
function redraw() {
  if (redrawSoon) return;
  redrawSoon = true;
  const at = drawn;
  requestAnimationFrame(() => {
    redrawSoon = false;
    if (drawn !== at) return;
    if (document.body.dataset.page === 'trip' && scrollY > 0) holdStill(innerHeight / 2, render);
    else render();
  });
}

const ago = t => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// How far each trip's weather was scrolled sideways this visit, so a redraw (a tick, say) leaves it where it was.
const stripX = new Map();
function weatherStrip(t, c) {
  const ls = R.legDays(t), multi = ls.length > 1, t0 = today();
  const keys = ls.map(l => wxKey(t, l)), busy = keys.some(k => wxBusy[k]);
  // The places that were looked up, and on a trip with stops, the ones typed in without a lookup.
  const found = ls.filter(l => l.place && l.place.lat !== undefined), typed = ls.filter(l => l.place && l.place.lat === undefined);
  if (!t.place && !multi) {
    return h('section', { class: 'wx none' }, h('p', { class: 'muted small' }, 'No place for this trip, so no forecast. Add one in ', h('a', { href: `#/edit/${t.id}` }, 'Edit'), ', or set the weather by hand under ', h('b', {}, 'Change'), '.'));
  }
  // A place typed in without a lookup has no forecast, and no country to say whether it's abroad or which plugs it
  // has. The one-file copy can't look a place up at all, so it points to the site instead of Edit.
  if (!found.length) {
    return h('section', { class: 'wx none' }, h('p', { class: 'muted small' }, multi ? 'None of these places was looked up' : 'This place wasn’t looked up', ', so there’s no forecast and no check for abroad or plugs. Set them under ', h('b', {}, 'Change'), ', or ',
      single ? ['open ', h('a', { class: 'nowrap', href: SITE, target: '_blank', rel: 'noopener' }, 'carry-on.junkdrawer.works')] : [`pick ${multi ? 'them' : 'the place'} again in `, h('a', { href: `#/edit/${t.id}` }, 'Edit')], '.'));
  }
  // The trip's days, each from its own place.
  const days = ls.flatMap(l => l.days), legOf = new Map(ls.flatMap(l => l.days.map(d => [d, l])));
  const firsts = new Set(ls.map(l => l.days[0]).filter(Boolean));
  // What a failed lookup said, or a lookup's own note. On a trip with stops each says its place, unless every place
  // says the same.
  const byPlace = (list, text) => {
    const said = [...new Set(list.map(text))];
    return !list.length ? '' : !multi || (said.length === 1 && list.length === found.length) ? said[0] : list.map(l => `${l.place.name}: ${text(l)}`).join(' ');
  };
  const err = byPlace(found.filter(l => wxErr[wxKey(t, l)]), l => wxErr[wxKey(t, l)]);
  const note = byPlace(found.filter(l => l.days.length && l.wx.err), l => l.wx.err);
  const fc = days.some(d => !d.typ), ty = days.some(d => d.typ);
  const label = !days.length ? 'Weather' : fc && ty ? 'Forecast, then typical' : fc ? 'Forecast' : 'Typical weather';
  const u = c.units;
  // Each day as a sentence for a screen reader, in place of the short words and numbers shown: "Friday, October 30:
  // rain, high 81°, low 63°, 70% chance of rain"; "Saturday, October 31, typical for these dates: often wet, high
  // 64°, low 52°". A forecast's chance is of rain or snow (Open-Meteo's chance of precipitation): on a snow day, it's
  // snow.
  const chanceOf = d => (W.snowCode(d.code) ? 'snow' : 'rain');
  const said = d => {
    const words = W.dayWords(d), wet = d.typ ? (d.wet >= 0.3 ? `rain in ${Math.round(d.wet * 100)}% of recent years` : '') : d.pop >= 30 ? `${d.pop}% chance of ${chanceOf(d)}` : '';
    return `${d.d === t0 ? 'Today, ' : ''}${D.dayLong(d.d)}${multi ? `, in ${legOf.get(d).place.name}` : ''}${d.typ ? ', typical for these dates' : ''}: ${[words, `high ${W.temp(d.hi, u)}`, `low ${W.temp(d.lo, u)}`, wet].filter(Boolean).join(', ')}`;
  };
  // Each day's weekday, and on a trip of more than a week, where a weekday comes round again, its date under it: "MON"
  // over "2", the first day and each 1st of the month with the month, "NOV 1".
  const dated = D.nights(t.start, t.end) > 6;
  const under = t.start <= t0 && t0 <= t.end;
  const dayClass = (k, typ) => [typ ? 'typ' : '', under && k < t0 ? 'before' : k === t0 ? 'today' : ''].filter(Boolean).join(' ') || null;
  // On a trip under way, today reads "Today" and stands out, and the days gone by are faint.
  const dayHead = (k, i) => [
    h('span', { class: 'wd', 'aria-hidden': 'true' }, k === t0 ? 'Today' : D.weekday(k)),
    dated ? h('span', { class: 'dm', 'aria-hidden': 'true' }, i === 0 || k.endsWith('-01') ? D.short(k) : String(+k.slice(8))) : null,
  ];
  // What the blue % means, which is different on typical days.
  const fcPct = days.filter(d => !d.typ && d.pop >= 30), pctTy = days.some(d => d.typ && d.wet >= 0.3);
  const of = [...new Set(fcPct.map(chanceOf))].sort().join(' or ');
  const pct = fcPct.length && pctTy ? `Blue % is the chance of ${of}, or on the dashed days, how many recent years had rain that day.` : fcPct.length ? `Blue % is the chance of ${of}.` : pctTy ? 'Blue % is how many recent years had rain that day.' : '';
  // Unless typical weather is standing in for a forecast that didn't come back, why there's typical weather at all.
  const typNote = ty && !days.some(d => d.typ && d.d <= W.forecastEdge(t0)) ? (fc ? 'Past the forecast, the days show what the same dates were like in recent years.' : 'Too far off for a forecast, so these are the same dates in recent years. It switches to the forecast about two weeks out.') : '';
  // No days, nothing on its way and nothing gone wrong: a trip that's over isn't looked up (its dates were changed
  // after it, say, which cleared its weather), and one still to come will be once there's a connection.
  const empty = !days.length && !busy && !err, over = t.end < t0;
  // On a trip with stops, each place's name over its first day.
  const strip = !days.length ? null : h('ol', { class: 'wx-days' + (multi ? ' legs' : ''), 'aria-labelledby': 'wxHead', onscroll: () => stripX.set(t.id + t.start, strip.scrollLeft) }, days.map((d, i) => h('li', { class: [dayClass(d.d, d.typ), multi && firsts.has(d) ? 'leg' : ''].filter(Boolean).join(' ') || null },
    multi && firsts.has(d) ? h('span', { class: 'at', 'aria-hidden': 'true', style: { maxWidth: `${legOf.get(d).days.length * 60 - 8}px` } }, legOf.get(d).place.name) : null,
    h('span', { class: 'sr-only' }, said(d)),
    dayHead(d.d, i),
    h('span', { class: 'wi', 'aria-hidden': 'true' }, W.dayIcon(d)),
    h('span', { class: 'hi', 'aria-hidden': 'true' }, W.temp(d.hi, u)),
    h('span', { class: 'lo', 'aria-hidden': 'true' }, W.temp(d.lo, u)),
    h('span', { class: 'rp', 'aria-hidden': 'true' }, d.typ ? (d.wet >= 0.3 ? `${Math.round(d.wet * 100)}%` : '') : (d.pop >= 30 ? `${d.pop}%` : '')))));
  // Once it's on the page: where it was, or the first time, on a trip under way, at today. Nothing to do when it all
  // fits.
  if (strip) {
    queueMicrotask(() => {
      if (!strip.isConnected || strip.scrollWidth <= strip.clientWidth) return;
      const now = strip.querySelector('li.today');
      strip.scrollLeft = stripX.has(t.id + t.start) ? stripX.get(t.id + t.start) : now ? now.offsetLeft - strip.firstElementChild.offsetLeft : 0;
    });
  }
  return h('section', { class: 'wx' },
    h('div', { class: 'wx-head' },
      h('h2', { id: 'wxHead' }, label),
      h('div', { class: 'wx-at' },
        // A forecast kept from an earlier lookup is as new as that one.
        h('span', { class: 'muted small' }, busy ? 'Looking it up…' : days.length ? 'Updated ' + ago(Math.min(...found.filter(l => l.days.length).map(l => l.wx.fcAt || l.wx.at))) : ''),
        // Not disabled while it looks: a disabled button can't keep the focus.
        empty && over ? null : h('button', { type: 'button', class: 'icon-btn small' + (busy ? ' spin' : ''), 'data-key': 'wx', 'aria-label': 'Look up the weather again', title: 'Look up the weather again', html: ICONS.refresh, 'aria-disabled': busy ? 'true' : null, onclick: () => { if (keys.some(k => wxBusy[k])) return; maybeWeather(t, true); render(); } }))),
    empty ? h('p', { class: 'muted small' }, over ? 'No weather was saved for these days.' : 'Looking it up when you’re online.') : null,
    // A lookup that failed. Offline, that's the reason whatever it said. With days to show it's a quiet line: the
    // days are still there, and it isn't something to fix.
    err ? h('p', { class: days.length ? 'muted small' : 'err small' }, navigator.onLine === false ? 'No connection right now. The forecast comes in when you’re back online.' : err, ' ', days.length ? 'Showing the last lookup.' : 'You can set the weather by hand under Change.') : null,
    // While the first lookup is on its way, the days' room is kept, so they don't push everything down when they come,
    // with a faint tile for each day (as far as the forecast reaches) waiting for its numbers.
    !days.length && busy ? h('ol', { class: 'wx-days wait', 'aria-hidden': 'true' }, D.range(t.start, t.end).slice(0, W.AHEAD + 1).map((k, i) => h('li', { class: dayClass(k, true) },
      dayHead(k, i), h('span', { class: 'wi' }, '\u00a0'), h('span', { class: 'hi' }, '…'), h('span', { class: 'lo' }, '…'), h('span', { class: 'rp' })))) : null,
    days.length ? strip : null,
    note ? h('p', { class: 'muted small' }, note) : null,
    multi && typed.length ? h('p', { class: 'muted small' }, `${andList(typed.map(l => l.place.name))} ${typed.length > 1 ? 'weren’t' : 'wasn’t'} looked up, so ${typed.length > 1 ? 'their days have' : 'its days have'} no forecast.`) : null,
    typNote || pct ? h('p', { class: 'muted small' }, [typNote, pct].filter(Boolean).join(' ')) : null);
}

// ---------- one trip ----------

let packedSeen = null; // the trip and way of packing last drawn, and whether it was all packed

function tripView(t) {
  maybeWeather(t);
  const mode = tripMode(t);
  const p = R.plan(doc(), t, mode), c = p.cond;
  shownTrip = t.id + ':' + mode;
  const complete = p.total > 0 && p.done === p.total;
  // Said once, when a change finishes the packing; never on opening a trip that's packed already. When the change
  // said what it did with an Undo, just now, the Undo stays. The check by "All packed" pops as it's said.
  const finished = packedSeen?.key === t.id + mode && !packedSeen.complete && complete;
  if (finished) toastKeep(mode === 'go' ? `Everything for ${title(t)} is packed.` : 'All back in the bags. Safe trip home.');
  packedSeen = { key: t.id + mode, complete };
  // Everything packed: once the moment after the last tick has passed, the bags fold into one line until it's
  // tapped. Unticking something opens them again, and Hide done goes while there's nothing left to hide.
  const allKey = `${t.id}:bags:${mode}`;
  if (!complete && store.isOpen(allKey)) store.setOpen(allKey, false);
  // Printed, every bag shows.
  const oneLine = !printing && complete && !linger.size && !store.isOpen(allKey);
  const n = D.nights(t.start, t.end);
  const onKeys = Object.keys(c.on).filter(k => c.on[k] && R.condInfo(doc(), k));
  const order = k => { const i = R.CONDITIONS.findIndex(x => x.k === k); return i < 0 ? 100 : i; };
  onKeys.sort((a, b) => order(a) - order(b));
  // Hide done hides nothing while everything is packed, once the moment after the last tick has passed: its switch
  // has gone, so the bags shown from the one line show what's in them, and anything can be unticked.
  const hide = !printing && store.hide && !(complete && !linger.size);
  const jobs = p.tasks.map(g => bagCard(t, g, mode, hide, c.why, true));
  return [
    h('a', { class: 'crumb', href: '#/' }, h('span', { html: ICONS.back }), 'Trips'),
    h('section', { class: 'pass' },
      h('div', { class: 'pass-top' },
        h('div', {},
          h('p', { class: 'when' + (t.start <= today() && today() <= t.end ? ' now' : '') }, whenText(t)),
          fitted('h1', t),
          h('p', { class: 'sub' }, R.legs(t).length > 1 ? route(t) : t.place ? (t.name ? W.placeLabel(t.place) : W.placeLabel(t.place).split(', ').slice(1).join(', ')) || '\u00a0' : 'No place set')),
        h('a', { class: 'icon-btn', href: `#/edit/${t.id}`, 'aria-label': 'Edit this trip', title: 'Edit this trip', html: ICONS.edit })),
      // All packed, it's stamped across the tear line, and the stamp thumps down as the last thing is ticked.
      h('div', { class: 'pass-foot' }, h('dl', { class: 'pass-row' },
        h('div', {}, h('dt', {}, 'Leave'), h('dd', {}, D.long(t.start))),
        h('div', {}, h('dt', {}, 'Back'), h('dd', {}, D.long(t.end))),
        h('div', {}, h('dt', {}, 'Nights'), h('dd', {}, String(n))),
        h('div', {}, h('dt', {}, 'By'), h('dd', {}, R.CONDITIONS.find(x => x.k === t.travel).name))),
      complete ? stamp(mode, finished) : null)),
    weatherStrip(t, c),
    h('section', { class: 'needs' },
      h('div', { class: 'needs-head' },
        h('h2', {}, 'This trip calls for'),
        h('button', { type: 'button', class: 'btn small', 'data-key': 'conds', onclick: () => condSheet(t.id) }, 'Change')),
      // Each chip opens the sheet at its own row, to see why or to change it.
      h('ul', { class: 'chips' }, onKeys.map(k => {
        const info = R.condInfo(doc(), k);
        // Abroad says too when only some of your plugs fit there.
        const said = c.why[k] && c.why[k] !== info.name ? c.why[k] : '', note = k === 'abroad' ? c.plugNote : '';
        const why = [said, note].filter(Boolean).join(' · '), wid = 'why-' + k.replace(/[^\w-]/g, '_');
        return h('li', {}, h('button', { type: 'button', class: 'chip on', 'data-key': 'chip:' + k, 'aria-label': `${info.name}: change`, 'aria-describedby': why ? wid : null, onclick: () => condSheet(t.id, k) },
          h('span', { 'aria-hidden': 'true' }, info.icon), h('span', {}, h('b', {}, info.name), why ? h('small', { id: wid }, why) : null)));
      }))),
    h('div', { class: 'seg mode', role: 'group', 'aria-label': 'Packing to leave or to come home' },
      h('button', { type: 'button', 'data-key': 'mode:go', 'aria-pressed': String(mode === 'go'), onclick: () => { store.setMode(t.id, 'go', today()); render(); } }, 'Going'),
      h('button', { type: 'button', 'data-key': 'mode:back', 'aria-pressed': String(mode === 'back'), onclick: () => { store.setMode(t.id, 'back', today()); render(); } }, 'Coming home')),
    h('div', { class: 'progress' },
      h('div', { class: 'meter', 'aria-hidden': 'true' }, meter(t.id + ':' + mode, p.done, p.total)),
      h('p', { class: complete ? 'all' + (finished ? ' just' : '') : null }, complete ? h('span', { html: ICONS.check }) : null, h('b', {}, packedWords(p, mode)[0]), packedWords(p, mode)[1]),
      complete ? null : h('label', { class: 'switch' }, h('input', { type: 'checkbox', 'data-key': 'hide', checked: hide, onchange: e => { store.hide = e.target.checked; render(); } }), h('span', {}, 'Hide done'))),
    // Each bag, in the order they come, with how much of it is done, to go straight to it on a long list.
    oneLine ? null : jumpRow((mode === 'back' ? [...p.tasks, ...p.groups] : goingGroups(p)).map(g => {
      const done = g.rows.filter(r => r.done).length, jobs = g.bag.kind !== 'bag';
      return { bag: g.bag, count: `${done}/${g.rows.length}`, all: done === g.rows.length, said: `${done} of ${g.rows.length} ${jobs ? 'done' : mode === 'go' ? 'packed' : 'back in'}` };
    })),
    mode === 'back' && !Object.keys(t.marks || {}).some(k => k.startsWith('p:') && t.marks[k].v === 1)
      ? h('p', { class: 'muted small hint' }, 'Nothing was ticked going, so this is everything that was on the list.') : null,
    M.hasList(doc()) ? null : h('p', { class: 'muted small hint' }, 'Your list is empty, so nothing from it is on this trip. ', h('a', { href: '#/' }, 'Start a list'), ' and it fills in.'),
    // Coming home, the hotel checklist (chargers in the wall, the safe) comes first, then the bags.
    oneLine ? h('button', { type: 'button', class: 'all-bags', 'data-key': 'all-bags', onclick: () => {
      store.setOpen(allKey, true);
      render();
      main.querySelector('.bag [data-key]')?.focus({ preventScroll: true });
    } }, h('span', { html: ICONS.check }), h('span', {}, mode === 'go' ? `All ${p.total} packed` : 'All back in the bags', h('span', { class: 'muted' }, mode === 'go' ? ' · show the bags' : ' · show'))) : null,
    // The list itself, which prints in two columns.
    h('div', { class: 'trip-list' },
      mode === 'back' && !oneLine ? jobs : null,
      oneLine ? null : p.groups.map(g => bagCard(t, g, mode, hide, c.why)),
      M.bags(doc()).some(b => b.kind === 'bag') ? h('button', { type: 'button', class: 'btn add-extra', 'data-key': 'add-extra', onclick: () => extraSheet(t, null, { home: mode === 'back' }) }, h('span', { html: ICONS.plus }), mode === 'go' ? 'Add something for this trip' : 'Add something to bring home') : null,
      // Going, what's still in use the night before, to pack on the way out, then the jobs before leaving the house.
      p.last && !oneLine ? bagCard(t, p.last, mode, hide, c.why) : null,
      mode === 'go' && !oneLine ? jobs : null,
      p.buy.length ? buyThere(t, p.buy) : null,
      usedUpList(t),
      p.left.length || p.leftBags.length ? leftOff(t, p.left, p.leftBags, mode) : null),
    // The whole trip, somewhere else.
    h('div', { class: 'trip-tools' },
      h('button', { type: 'button', class: 'btn small', 'data-key': 'copy-text', onclick: () => copyText(t, mode) }, 'Copy as text'),
      // A trip still to come, where a file can be saved (not the one-file copy).
      !single && t.start > today() ? h('button', { type: 'button', class: 'btn small', 'data-key': 'calendar', onclick: () => saveCalendar(t) }, 'Add to my calendar') : null),
  ];
}

// The trip as a calendar file (calendar.js), saved to open in the phone's calendar: the trip's days, with an alert at
// 7 pm the evening before that leads back to this list. Saved again after a change, it updates the same event.
function saveCalendar(t) {
  const name = title(t), file = `${name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Trip'}.ics`;
  const url = `${location.origin}${location.pathname}#/trip/${encodeURIComponent(t.id)}`;
  const ics = tripCalendar(t, { name, where: R.legs(t).length > 1 ? route(t).replace(/\u00a0/g, ' ') : t.place ? W.placeLabel(t.place) : '', url });
  const a = h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })), download: file });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Saved ${file}. Open it to add ${name} to your calendar, with a reminder at 7 pm the evening before.`);
}

// The list as it shows, Going or Coming home, as a plain checklist by bag (share.js listText), to paste into Messages,
// Keep or Notes. Where the browser won't copy (the one-file copy, inside another page), it shows in a box to copy.
function copyText(t, mode) {
  const text = listText(`${title(t)} · ${D.span(t.start, t.end, today().slice(0, 4))}${mode === 'back' ? ' · coming home' : ''}`, R.textGroups(doc(), t, mode));
  const show = () => sheet('Your list as text', () => [
    h('p', { class: 'muted small' }, 'Select it all and copy it, then paste it into Messages, Keep or Notes.'),
    h('textarea', { class: 'as-text', rows: 12, readonly: true, autofocus: true, value: text, 'aria-label': 'Your list as text', onfocus: e => e.target.select() }),
  ], { wide: true });
  if (!navigator.clipboard?.writeText) { show(); return; }
  navigator.clipboard.writeText(text).then(() => toast('Copied. Paste it into Messages, Keep or Notes.'), show);
}

// Where something put back on the list landed, said since it's usually off screen: "Sunscreen is on the list, in the
// Liquids bag.", or what still keeps it off. Undo puts back how it was.
function saidWhere(t, id, name, mode, undo) {
  const p = R.plan(doc(), doc().trips[t.id], mode);
  const g = goingGroups(p).find(x => x.bag.id === id || x.rows.some(r => r.id === id));
  const still = !g && (p.left.find(l => l.item.id === id) || p.leftBags.find(l => l.bag.id === id));
  // Packed last, it's with the last things out the door rather than in a bag.
  const where = g?.bag.id === R.LAST.id ? 'with the last things out the door' : g && `in ${theBag(g.bag)}`;
  toast(still ? `${name} is still off: ${still.why.charAt(0).toLowerCase() + still.why.slice(1)}.` : g && g.bag.id !== id ? `${name} is on the list, ${where}.` : `${name} is on the list.`,
    { label: 'Undo', run: undo });
}

// Going, what's to be bought there rather than packed, at the foot of the list, each with a way to pack it after all.
// It doesn't count as packing.
function buyThere(t, list) {
  return h('section', { class: 'aside' },
    h('h2', {}, 'To buy there'),
    h('ul', { class: 'rows' }, list.map(x => h('li', { class: 'row left-row' },
      h('div', { class: 'what' }, h('span', { class: 'name' }, x.name)),
      h('button', { type: 'button', class: 'btn small', 'data-key': 'buy:' + x.id, 'aria-label': `Pack it after all, ${x.name}`, onclick: () => {
        // Back on the list: as the trip has it, or brought anyway where it wouldn't bring it now (an umbrella brought
        // anyway before it was to be bought, sunscreen once the forecast has cooled).
        apply(d => {
          const n = M.mark(d, t.id, 'x:' + x.id, 0);
          return goingGroups(R.plan(n, n.trips[t.id], 'go')).some(g => g.rows.some(r => r.id === x.id)) ? n : M.mark(d, t.id, 'x:' + x.id, 'add');
        });
        saidWhere(t, x.id, x.name, 'go', () => apply(d => M.mark(d, t.id, 'x:' + x.id, 'buy')));
      } }, 'Pack it')))));
}

// A trip that's over: what it used up (Not bringing it back, coming home), to buy before the next one.
function usedUpList(t) {
  const list = t.end < today() ? R.usedUp(doc(), t) : [];
  if (!list.length) return null;
  return h('section', { class: 'aside' },
    h('h2', {}, 'Used up: buy more before next time'),
    h('ul', { class: 'rows' }, list.map(x => h('li', { class: 'row left-row' },
      h('div', { class: 'what' }, h('span', { class: 'name' }, x.name), h('small', {}, `${x.bag.icon} ${x.bag.name}`))))));
}

// Packing keeps both hands busy, and a phone that locks itself between ticks wants Face ID or a passcode for the
// next one. So each tick on a trip keeps the screen on (the Screen Wake Lock API, MDN: Baseline 2025) until three
// minutes after the last one, or until the trip is left. The browser lets go of it while the page is hidden, so
// coming back within those minutes asks again. Where a browser can't, nothing changes; nothing is saved or sent.
const AWAKE_MS = 3 * 60e3;
const awake = { until: 0, trip: '', lock: null, asking: false, timer: null };
function keepAwake(tripId) {
  if (!navigator.wakeLock) return;
  awake.until = Date.now() + AWAKE_MS;
  awake.trip = tripId;
  clearTimeout(awake.timer);
  awake.timer = setTimeout(letSleep, AWAKE_MS);
  askAwake();
}
function askAwake() {
  if (awake.lock || awake.asking || document.hidden || Date.now() >= awake.until) return;
  awake.asking = true;
  navigator.wakeLock.request('screen').then(lock => {
    awake.asking = false;
    if (Date.now() >= awake.until) { lock.release().catch(() => {}); return; }
    awake.lock = lock;
    lock.addEventListener('release', () => { if (awake.lock === lock) awake.lock = null; });
  }, () => { awake.asking = false; });
}
function letSleep() {
  clearTimeout(awake.timer);
  awake.until = 0;
  awake.trip = '';
  const lock = awake.lock;
  awake.lock = null;
  lock?.release().catch(() => {});
}

// Just after a tick the list holds still for a moment, so the tick shows where it was tapped and a quick next tap
// lands on what was there: a bag the tick finished stays open, and with Hide done on, the ticked row stays. Every
// tap starts the moment again. When it ends, the list closes up around the rows under the finger.
const linger = new Set(); // 'go:BAGID' or 'back:BAGID' for a bag, a row's mark key for a row
let lingerT = null, lingerAt = '';
const LINGER_MS = 1200;

// Things that move, once. render() draws every row and meter afresh, so a transition on them never runs, and an
// animation on a class that stays would play again on every redraw. So the row just ticked is marked for the one
// redraw the tick makes (popKey), and each meter starts at the width it was last drawn at, per trip and way of
// packing, or per luggage tag, and moves to the new one a frame later.
let popKey = '';
const meterAt = new Map();
function meter(key, done, total) {
  const now = total ? 100 * done / total : 0, was = meterAt.get(key);
  meterAt.set(key, now);
  const bar = h('i', { style: { width: (was ?? now) + '%' } });
  if (was !== undefined && was !== now) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = now + '%'; }));
  return bar;
}

// If the focus was on a tick that goes, render() moves it to the next one in that bag, or to the folded bag.
function settle() {
  lingerT = null;
  linger.clear();
  const tapped = byKey(main, lingerAt)?.getBoundingClientRect().top;
  holdStill(tapped > 0 && tapped < innerHeight ? tapped : innerHeight / 2, render);
}

// Redraws with the row nearest y kept at the same place on the screen, taking the nearest at or below it first:
// packing down the list, that's where the next tap goes. render() replaces every row, so the browser can't do this.
function holdStill(y, redraw) {
  const was = [...main.querySelectorAll('[data-key]')].map(x => [x.dataset.key, x.getBoundingClientRect().top]).filter(([, top]) => top > 0 && top < innerHeight);
  was.sort(([, a], [, b]) => (a < y) - (b < y) || Math.abs(a - y) - Math.abs(b - y));
  redraw();
  for (const [k, top] of was) {
    const x = byKey(main, k);
    if (x) { window.scrollBy(0, x.getBoundingClientRect().top - top); return; }
  }
}

// The starter Liquids bag's note is the airport's rule for a carry-on (TSA's "3-1-1"), so it shows only when flying;
// a note of your own always shows.
const AIRPORT_NOTE = starterList().bags.find(b => b.id === 's-liquids')?.note;

// A row of chips, one for each bag and list of jobs on the screen, that goes straight to it: on a trip, each with its
// icon and how much of it is done, ticked when it's all done; on My list, icons alone. With one bag, there's nowhere
// to go. Each is { bag, count ('3/8'), all (all done), said (in words: '3 of 8 packed') }.
function jumpRow(list) {
  if (list.length < 2) return null;
  return h('nav', { class: 'jump', 'aria-label': 'Go to a bag' }, h('ul', {}, list.map(({ bag: b, count, all, said }) => h('li', {},
    h('button', { type: 'button', class: 'chip' + (all ? ' all' : ''), 'data-key': 'jump:' + b.id, 'aria-label': said ? `${b.name}, ${said}` : b.name, title: said ? null : b.name, onclick: () => jumpTo(b.id) },
      h('span', { class: 'jump-icon', 'aria-hidden': 'true' }, b.icon),
      count ? h('span', { 'aria-hidden': 'true' }, all ? h('span', { html: ICONS.check }) : null, count) : null)))));
}
// The bag's top just under the top bar, gliding there unless less motion is asked for, and the focus on its name, so
// a screen reader carries on from there.
function jumpTo(id) {
  const bag = main.querySelector(`.bag[data-bag="${CSS.escape(id)}"]`);
  if (!bag) return;
  const top = bag.getBoundingClientRect().top + scrollY - (document.querySelector('.bar')?.offsetHeight || 0) - 8;
  window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  bag.querySelector('h2')?.focus({ preventScroll: true });
}

function bagCard(t, g, mode, hide, why, jobs = false) {
  const b = g.bag, done = g.rows.filter(r => r.done).length, all = done === g.rows.length;
  const held = linger.has(mode + ':' + b.id);
  const open = printing || !all || held || store.isOpen(t.id + ':' + b.id);
  const rows = g.rows.filter(r => !hide || !r.done || linger.has(r.key));
  const head = h('header', { class: 'bag-head' },
    h('span', { class: 'bag-icon', 'aria-hidden': 'true' }, b.icon),
    h('h2', { tabindex: '-1', 'data-key': 'head:' + b.id }, b.name),
    b.when?.length ? h('span', { class: 'bag-cond' }, b.when.map(k => R.condInfo(doc(), k)?.icon).join('')) : null,
    h('span', { class: 'count' + (all ? ' all' : '') }, all ? h('span', { html: ICONS.check }) : null,
      h('span', { 'aria-hidden': 'true' }, `${done}/${g.rows.length}`), h('span', { class: 'sr-only' }, `${done} of ${g.rows.length} ${jobs ? 'done' : mode === 'go' ? 'packed' : 'back in'}`)),
    b.id !== '_loose' && b.id !== R.LAST.id ? h('button', { type: 'button', class: 'icon-btn small', 'data-key': 'bagmore:' + b.id, 'aria-label': `More for ${b.name}`, html: ICONS.more, onclick: () => bagSheet(t, g, mode) }) : null);
  return h('section', { class: 'bag' + (all ? ' all' : '') + (jobs ? ' jobs' : ''), 'data-bag': b.id },
    head,
    b.note && !(b.id === 's-liquids' && t.travel !== 'fly' && b.note === AIRPORT_NOTE) ? h('p', { class: 'bag-note' }, b.note) : null,
    all && !open
      ? h('button', { type: 'button', class: 'bag-done', 'data-key': 'fold:' + b.id, onclick: () => { store.setOpen(t.id + ':' + b.id, true); render(); } }, jobs ? `All ${plural(g.rows.length, 'job')} done` : mode === 'go' ? `All ${g.rows.length} packed` : `All ${g.rows.length} back in`, h('span', { class: 'muted' }, ' · show'))
      : rows.length ? h('ul', { class: 'rows' }, rows.map(r => itemRow(t, g, r, mode, why, jobs, hide))) : h('p', { class: 'muted small pad' }, 'All done here.'),
    all && open && !held && !printing ? h('button', { type: 'button', class: 'bag-done', 'data-key': 'fold:' + b.id, onclick: () => { store.setOpen(t.id + ':' + b.id, false); render(); } }, 'Fold it up') : null);
}

function itemRow(t, g, r, mode, whyMap, jobs, hide) {
  const toggle = () => {
    const was = (t.marks?.[r.key]?.v || 0) > 0;
    keepAwake(t.id);
    store.apply(d => M.mark(d, t.id, r.key, was ? 0 : 1));
    const bag = mode + ':' + g.bag.id;
    if (was) {
      linger.delete(r.key); linger.delete(bag);
      // Unticked when everything was packed, with Hide done on but hiding nothing: the rows it hides again stay for
      // the moment, as a tick's does, and then the list closes up around this one.
      if (store.hide && !hide) for (const x of main.querySelectorAll('.row.done .tick')) linger.add(x.dataset.key);
    } else {
      if (hide) linger.add(r.key);
      if (g.rows.every(x => x === r || x.done)) linger.add(bag);
    }
    clearTimeout(lingerT);
    lingerT = linger.size ? setTimeout(settle, LINGER_MS) : null;
    lingerAt = r.key;
    popKey = r.key;
    render();
    popKey = '';
  };
  // A screen reader hears the tick by its name and how many ("Socks, 5"), then the lines under it, without the
  // conditions' pictures. Coming home, why each thing went ("Rain likely Fri", "Added for this trip") no longer
  // matters, so only its note, where it is, and whether it's coming back are said.
  const id = 'r_' + r.key.replace(/[^\w-]/g, '_'), lines = [], going = mode === 'go';
  const line = (cls, ...text) => { const n = `${id}_${lines.length}`; lines.push(n); return h('small', { id: n, class: cls }, ...text); };
  const why = !going ? [] : r.hits.map(k => { const info = R.condInfo(doc(), k); return info ? [h('span', { 'aria-hidden': 'true' }, info.icon), ' ', whyMap[k] || info.name] : null; }).filter(Boolean);
  const under = [
    r.gone ? line(null, 'Not coming back') : null,
    r.note ? line(null, r.note) : null,
    why.length ? line('why', why.flatMap((w, i) => (i ? [' · ', ...w] : w))) : null,
    going && r.capped ? line('why', `${cap(perDay(r.daily))} a day, up to ${R.laundry(doc()) * r.daily}: laundry after that`) : null,
    going && r.packedOnly ? line('why', 'Packed, though the trip no longer calls for it') : null,
    going && r.added ? line('why', 'Added for this trip') : null,
    r.moved && !r.last ? line('why', 'In this bag for this trip') : null,
    // Packed last: the bag it goes in, which isn't the group it's in.
    r.last ? line('why', `Goes in ${theBag(r.goes)}`) : null,
    going && r.extra ? line('why', 'Just for this trip') : null,
    r.deleted ? line('why', 'No longer on your list') : null,
  ];
  return h('li', { class: 'row' + (r.done ? ' done' : '') + (r.done && r.key === popKey ? ' just' : '') + (r.gone ? ' gone' : '') },
    h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(r.done), 'data-key': r.key, 'aria-label': r.qty > 1 ? `${r.name}, ${r.qty}` : r.name, 'aria-describedby': lines.join(' ') || null, onclick: toggle },
      h('span', { class: 'box', html: ICONS.check }),
      h('span', { class: 'what' },
        h('span', { class: 'name' }, r.name, r.qty > 1 ? h('span', { class: 'qty' }, ' ×' + r.qty) : null),
        under)),
    jobs && mode === 'back' ? null : h('button', { type: 'button', class: 'icon-btn more', 'data-key': 'more:' + r.key, 'aria-label': `More for ${r.name}`, html: ICONS.more, onclick: () => itemSheet(t, r, mode, jobs) }));
}

function leftOff(t, left, leftBags, mode) {
  const open = printing || store.isOpen(t.id + ':left');
  // Packed, brought or put back: it says where on the list it went, since that's usually off screen.
  const put = (id, skipped, name) => {
    const was = t.marks?.['x:' + id]?.v;
    apply(d => M.mark(d, t.id, 'x:' + id, skipped ? 0 : 'add'));
    saidWhere(t, id, name, mode, () => apply(d => M.mark(d, t.id, 'x:' + id, was || 0)));
  };
  return h('section', { class: 'left' },
    // The heading holds the button, so it's found among the headings.
    h('h2', { class: 'left-title' }, h('button', { type: 'button', class: 'left-head', 'data-key': 'left', 'aria-expanded': String(open), onclick: () => { store.setOpen(t.id + ':left', !open); render(); } },
      `Left off this trip (${left.length + leftBags.length})`,
      h('span', { class: 'muted small', 'aria-hidden': 'true' }, open ? 'Hide' : 'Show'))),
    open ? h('ul', { class: 'rows' },
      leftBags.map(l => h('li', { class: 'row left-row' },
        h('div', { class: 'what' },
          h('span', { class: 'name' }, `${l.bag.icon} ${l.bag.name}`),
          // Partly on the list already: "2 more things".
          h('small', {}, `${plural(l.count, l.more ? 'more thing' : l.bag.kind === 'bag' ? 'thing' : 'job', l.more ? 'more things' : undefined)} · ${l.why}`)),
        // Each button says what it's for: "Bring it, the Work bag".
        h('button', { type: 'button', class: 'btn small', 'data-key': 'x:' + l.bag.id, 'aria-label': `${l.skipped ? 'Put back' : 'Bring it'}, ${theBag(l.bag)}`, onclick: () => put(l.bag.id, l.skipped, l.bag.name) }, l.skipped ? 'Put back' : 'Bring it'))),
      left.map(l => {
        // A job shows its list's icon, and is brought rather than packed.
        const list = doc().bags[l.item.bag], job = list && list.kind !== 'bag', label = l.skipped ? 'Put back' : job ? 'Bring it' : 'Pack it';
        return h('li', { class: 'row left-row' },
          h('div', { class: 'what' }, h('span', { class: 'name' }, job ? `${list.icon} ${l.item.name}` : l.item.name), h('small', {}, l.why)),
          h('button', { type: 'button', class: 'btn small', 'data-key': 'x:' + l.item.id, 'aria-label': `${label}, ${l.item.name}`, onclick: () => put(l.item.id, l.skipped, l.item.name) }, label));
      })) : null);
}

// ---------- sheets for a trip ----------

function itemSheet(t, r, mode, jobs) {
  const id = r.id;
  const pick = t.marks?.['x:' + id]?.v;
  // The bag it was in when the sheet opened, and the one arrow keys have moved it to since.
  const was = t.marks?.['b:' + id]?.v;
  let movedTo = null;
  const goesIn = to => toast(`${r.name} goes in ${theBag(to)} this trip.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'b:' + id, was || 0)) });
  sheet(r.name, close => {
    // Each button here says what it did, so a move made with the keys first goes unsaid.
    const done = () => { movedTo = null; close(); };
    if (mode === 'back') {
      const gone = t.marks?.[r.key]?.v === 2;
      return [
        h('p', { class: 'muted' }, 'Used up, given away, or staying on purpose? Count it as done.'),
        h('div', { class: 'stack' },
          h('button', { type: 'button', class: 'btn', onclick: () => {
            done();
            const was = doc().trips[t.id]?.marks?.[r.key]?.v || 0;
            store.apply(d => M.mark(d, t.id, r.key, gone ? 0 : 2));
            // Before the redraw, so when it's the last thing, all back in the bags is said instead, with this Undo.
            toast(gone ? `${r.name} is coming back after all.` : `${r.name}: not coming back.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, r.key, was)) });
            render();
          } }, gone ? 'It’s coming back after all' : 'Not bringing it back'))];
    }
    const cur = t.marks?.['b:' + id]?.v || (r.extra ? t.extras[id].bag : doc().items[id]?.bag);
    // Packed in the morning this trip, or with the rest: picked for this trip, unless it's what My list says anyway.
    const lastNow = R.packedLast(doc(), t, id), byList = !r.extra && !!doc().items[id]?.last?.v;
    const packLast = () => {
      done();
      const was = t.marks?.['l:' + id]?.v ?? null, b = doc().bags[cur];
      apply(d => M.mark(d, t.id, 'l:' + id, !lastNow === byList ? null : !lastNow));
      toast(lastNow ? `${r.name} is back in ${b ? theBag(b) : 'its bag'}.` : `${r.name} waits for the morning, with the last things out the door.`,
        { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'l:' + id, was)) });
    };
    // The bags coming on this trip, and the one it's in.
    const on = R.conditions(doc(), t).on;
    const bagsList = M.bags(doc()).filter(b => b.kind === 'bag' && (b.id === cur || R.bagComing(t, b, on)));
    // Arrow keys and letters change a closed picker's bag without opening it (Chrome on Windows and Linux, screen
    // readers), a bag a key. A change that follows a key moves it and says so here, and the sheet stays open to look
    // further; Enter or Escape closes it, and the toast says where it went. A change from the picker itself closes it.
    let keyed = false;
    const moved = h('p', { class: 'small moved', role: 'status' });
    return [
      h('div', { class: 'stack' },
        r.extra
          ? h('button', { type: 'button', class: 'btn', onclick: () => { done(); apply(d => M.removeExtra(d, t.id, id)); toast(`${r.name} is off this trip.`, { label: 'Undo', run: () => apply(d => M.putExtra(d, t.id, { id: `${id}`, name: r.name, bag: cur })) }); } }, 'Take it off this trip')
          : h('button', { type: 'button', class: 'btn', onclick: () => { done(); apply(d => M.mark(d, t.id, 'x:' + id, 'skip')); toast(`${r.name} is off this trip.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'x:' + id, pick || 0)) }); } }, 'Leave it off this trip'),
        jobs ? null : h('button', { type: 'button', class: 'btn', onclick: packLast }, lastNow ? 'Pack it with the rest' : 'Pack it in the morning'),
        // Sunscreen, an adapter: bought on arrival rather than packed.
        jobs ? null : h('button', { type: 'button', class: 'btn', onclick: () => {
          done();
          apply(d => M.mark(d, t.id, 'x:' + id, 'buy'));
          toast(`${r.name} is under To buy there, at the foot of the list.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'x:' + id, pick || 0)) });
        } }, 'Buy it there'),
        jobs ? null : h('label', { class: 'field' }, h('span', {}, 'Which bag, this trip'),
          h('select', {
            onpointerdown: () => { keyed = false; },
            onkeydown: e => {
              if (e.key === 'Enter') { e.preventDefault(); close(); return; }
              if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || /^(Arrow|Home$|End$|Page)/.test(e.key))) keyed = true;
            },
            onchange: e => {
              const to = doc().bags[e.target.value];
              if (keyed) {
                movedTo = to;
                store.apply(d => M.mark(d, t.id, 'b:' + id, to.id));
                render();
                moved.textContent = `${r.name} goes in ${theBag(to)} this trip.`;
                return;
              }
              done();
              apply(d => M.mark(d, t.id, 'b:' + id, to.id));
              goesIn(to);
            } },
            bagsList.map(b => h('option', { value: b.id, selected: b.id === cur }, `${b.icon} ${b.name}`)))),
        jobs ? null : moved,
        r.extra ? h('button', { type: 'button', class: 'btn', onclick: () => { done(); toList(t, r, cur); } }, 'Add it to my list for every trip')
          : h('button', { type: 'button', class: 'btn', onclick: () => { done(); itemEditor(doc().items[id]); } }, 'Change it in my list')),
    ];
  }, { done: () => { if (movedTo && movedTo.id !== (was || (r.extra ? t.extras[id].bag : doc().items[id]?.bag))) goesIn(movedTo); } });
}

// Something added just for this trip goes on the list for every trip. It becomes a new thing, so its tick and its
// bag for this trip go with it, and it stays on this trip even when the first guess at its conditions says no
// (a travel umbrella on a dry trip). A tick on one goes only if it now comes one a day, and only before the trip,
// as applyCounting does: on a trip under way, it's what Coming home lists.
function toList(t, r, bag) {
  const nid = M.newId('i'), g = guess(r.name), under = t.start < today();
  apply(d => {
    let next = M.putItem(d, { id: nid, name: r.name, bag, ...g });
    const trip = next.trips[t.id];
    for (const k of ['p:', 'b:']) {
      const v = trip.marks?.[k + r.id]?.v;
      if (v && !(k === 'p:' && !under && R.qtyOf(next, trip, next.items[nid]) > 1)) next = M.mark(next, t.id, k + nid, v);
    }
    if (g.when.length) next = M.mark(next, t.id, 'x:' + nid, 'add');
    return M.removeExtra(next, t.id, r.id);
  });
  const when = R.whenWords(doc(), g.when);
  toast(when || g.per ? `${r.name} is on your list now, ${g.per ? 'one for each day' : `only ${when}`}. Tap it in My list to change that.` : `${r.name} is on your list for every trip now.`);
}

function bagSheet(t, g, mode) {
  const b = g.bag, keys = g.rows.map(r => r.key);
  const all = g.rows.every(r => r.done);
  sheet(`${b.icon} ${b.name}`, close => [
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn', onclick: () => {
        close();
        const marks = doc().trips[t.id]?.marks || {}, was = keys.map(k => [k, marks[k]?.v || 0]), n = keys.length, one = g.rows[0].name;
        store.apply(d => M.markAll(d, t.id, keys, all ? 0 : 1));
        // Before the redraw, so finishing the whole trip says that instead.
        toast(all ? `Everything in ${theBag(b)} is unticked.`
          : b.kind !== 'bag' ? (n === 1 ? `${one} is done.` : `All ${n} jobs in ${b.name} are done.`)
          : n === 1 ? `${one} is ${mode === 'go' ? 'packed' : 'back in'}.` : `All ${n} in ${theBag(b)} are ${mode === 'go' ? 'packed' : 'back in'}.`,
        { label: 'Undo', run: () => apply(d => was.reduce((next, [k, v]) => M.mark(next, t.id, k, v), d)) });
        render();
      } },
        all ? 'Untick everything in it' : b.kind === 'bag' ? (mode === 'go' ? 'It’s all packed already' : 'It’s all back in') : 'All done'),
      b.kind === 'bag' && mode === 'go' ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); extraSheet(t, b.id); } }, 'Add something to this bag') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => {
        close();
        const was = t.marks?.['x:' + b.id]?.v;
        apply(d => M.mark(d, t.id, 'x:' + b.id, 'skip'));
        toast(`${b.name} is off this trip.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'x:' + b.id, was || 0)) });
      } }, b.kind === 'bag' ? 'Leave this bag off this trip' : 'Skip these jobs this trip'),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); bagEditor(b); } }, 'Change it in my list')),
    h('p', { class: 'muted small' }, b.kind === 'bag'
      ? 'Left off, it waits under “Left off this trip” in case you change your mind. Its things stay on your list for other trips.'
      : 'Skipped, they wait under “Left off this trip” and stay on your list for other trips.'),
  ]);
}

// Something for this trip, in the bag it was asked for from (a bag's ⋯), or else the bag picked last time.
let lastBag = '';
// Coming home (home: true), it's something got on the trip: it goes in the bags now, so it counts as packed going,
// which puts it on the list coming home. (When nothing was ticked going, coming home lists everything anyway, and
// a tick going would hide all the rest.)
function extraSheet(t, bagId, { home = false } = {}) {
  // The bags coming on this trip, and the one it was asked for from; every bag, should all of them be left off.
  const all = M.bags(doc()).filter(b => b.kind === 'bag'), on = R.conditions(doc(), t).on;
  const coming = all.filter(b => b.id === bagId || R.bagComing(t, b, on));
  const bagsList = coming.length ? coming : all;
  const first = [bagId, lastBag].find(id => bagsList.some(b => b.id === id)) || bagsList[0]?.id;
  let name, bag, keep;
  sheet(home ? 'Bring something home' : 'Add something', close => {
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      close();
      lastBag = bag.value;
      if (keep?.checked) {
        const g = guess(n);
        const id = M.newId('i');
        store.apply(d => M.putItem(d, { id, name: n, bag: bag.value, ...g }));
        // On this trip whatever its conditions say, since it was asked for.
        if (g.when.length) store.apply(d => M.mark(d, t.id, 'x:' + id, 'add'));
        toast(`${n} is on your list now.`);
      } else {
        const id = M.newId('e'), b = doc().bags[bag.value];
        const ticked = home && Object.entries(doc().trips[t.id]?.marks || {}).some(([k, m]) => k.startsWith('p:') && m.v === 1);
        store.apply(d => { const next = M.putExtra(d, t.id, { id, name: n, bag: b.id }); return ticked ? M.mark(next, t.id, 'p:' + id, 1) : next; });
        toast(`${n} is in ${theBag(b)}, ${home ? 'to bring home' : 'just for this trip'}.`, { label: 'Undo', run: () => apply(d => { const next = M.removeExtra(d, t.id, id); return ticked ? M.mark(next, t.id, 'p:' + id, 0) : next; }) });
      }
      render();
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'What is it?'), name = h('input', { type: 'text', autofocus: true, maxlength: 80, placeholder: home ? 'Something you got there' : 'A gift for the hosts', autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', {}, 'Which bag?'), bag = h('select', {}, bagsList.map(b => h('option', { value: b.id, selected: b.id === first }, `${b.icon} ${b.name}`)))),
      home ? null : h('label', { class: 'check' }, keep = h('input', { type: 'checkbox' }), h('span', {}, 'Put it on my list for every trip')),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Add it')),
    ];
  });
}

// What the trip calls for: the occasions, how you're getting there, and the weather and place by hand. Opened from
// a chip, at that one's row (at: its key), with the focus on its choice.
function condSheet(id, at = '') {
  watchChange(id, { held: true });
  const draw = () => {
    const t = doc().trips[id];
    const c = R.conditions(doc(), t);
    sheet('What this trip calls for', () => [
      h('h3', {}, 'What’s on'),
      h('div', { class: 'chips pick' }, M.tags(doc()).map(g => {
        const on = !!t.set?.[g.id]?.v;
        return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'data-key': 'tag:' + g.id, 'data-k': g.id, 'aria-pressed': String(on), onclick: () => { store.apply(d => M.setCond(d, id, g.id, on ? null : true)); draw(); render(); } }, `${g.icon} ${g.name}`);
      })),
      h('p', { class: 'brings muted small' }, brings(new Set(M.tags(doc()).filter(g => t.set?.[g.id]?.v).map(g => g.id)))),
      h('h3', {}, 'Getting there'),
      h('div', { class: 'seg' }, M.TRAVEL.map(k => {
        const info = R.CONDITIONS.find(x => x.k === k);
        return h('button', { type: 'button', 'data-key': 'travel:' + k, 'data-k': k, 'aria-pressed': String(t.travel === k), onclick: () => { store.apply(d => M.putTrip(d, { id, travel: k })); draw(); render(); } }, `${info.icon} ${info.name}`);
      })),
      h('h3', {}, 'Place and weather'),
      h('p', { class: 'muted small' }, 'Auto follows the place and the forecast. Yes or No sets it for this trip only.'),
      h('ul', { class: 'auto-list' }, R.AUTO_KEYS.map(k => {
        const info = R.condInfo(doc(), k), set = t.set?.[k]?.v;
        const state = set === true ? 'on' : set === false ? 'off' : 'auto';
        // Abroad and plugs come from the place's country: a place typed in without a lookup has none.
        // On a trip with stops, which places weren't.
        const notLooked = R.legs(t).filter(l => l.place && !l.place.cc).map(l => l.place.name);
        const unknown = (k === 'abroad' || k === 'plug') && R.legs(t).length > 1 ? (notLooked.length ? `, ${andList(notLooked)} ${notLooked.length > 1 ? 'weren’t' : 'wasn’t'} looked up` : '')
          : (k === 'abroad' || k === 'plug') && !t.place?.cc ? (!t.place ? ', no place for this trip' : t.place.lat === undefined ? ', the place wasn’t looked up' : '') : '';
        const autoText = c.auto[k] === undefined ? 'unknown' + unknown : c.auto[k] ? 'yes' : 'no';
        const pickState = s => { store.apply(d => M.setCond(d, id, k, s === 'auto' ? null : s === 'on')); draw(); render(); };
        return h('li', { 'data-k': k },
          h('span', { class: 'auto-name' }, h('span', { 'aria-hidden': 'true' }, info.icon), ' ', h('b', {}, info.name),
            h('small', { id: 'auto-' + k }, `Automatic: ${autoText}${c.auto[k] && c.why[k] ? ` · ${c.why[k]}` : c.auto[k] === false && c.no[k] ? ` · ${c.no[k]}` : ''}`)),
          h('div', { class: 'seg tiny', role: 'group', 'aria-label': info.name, 'aria-describedby': 'auto-' + k },
            ['auto', 'on', 'off'].map(s => h('button', { type: 'button', 'data-key': `cond:${k}:${s}`, 'aria-pressed': String(state === s), onclick: () => pickState(s) }, s === 'auto' ? 'Auto' : s === 'on' ? 'Yes' : 'No'))));
      })),
      h('p', { class: 'small' }, h('a', { href: '#/list', onclick: closeSheet }, 'Change the occasions in My list')),
    ], { wide: true, done: () => sayChange({ now: true }) });
  };
  draw();
  const dlg = document.getElementById('sheet'), row = at && dlg.querySelector(`[data-k="${CSS.escape(at)}"]`);
  if (!row) return;
  (row.matches('button') ? row : row.querySelector('[aria-pressed="true"]'))?.focus({ preventScroll: true });
  const r = row.getBoundingClientRect(), box = dlg.getBoundingClientRect();
  dlg.scrollTop += r.top - box.top - (box.height - r.height) / 2;
}

// ---------- planning or changing a trip ----------

const NO_PLACES = 'No places by that name.';

// A box to find a place in: what's typed is looked up, and the places found come under it to pick from. Picked, the
// place shows instead, with a way to pick another. fd keeps what's typed and found through a redraw (typed, results,
// q: what the search last answered for, searchErr), and a search that answers after a redraw shows on the box
// that's on the page then (fd.draw).
//   o: { id, help: the id of the line under it, another: the name of its Pick another place button, get(): the
//        place picked, pick(place), asked(): whether a tap on Make my list has asked something, recent: places to
//        pick with one tap while nothing's typed (the latest trips') }
function placeBox(fd, o) {
  const where = h('div', { class: 'where-field' });
  const recent = h('div', { class: 'recent' }, h('span', { class: 'small muted', id: o.id + '-recent' }, 'Recent:'),
    h('ul', { class: 'chips', 'aria-labelledby': o.id + '-recent' }, (o.recent || []).map(p => h('li', {},
      h('button', { type: 'button', class: 'chip', 'data-key': `recent:${o.id}:${p.lat ?? ''},${p.lon ?? ''}:${p.name}`, onclick: () => choose(p) }, W.placeLabel(p))))));
  const input = h('input', { type: 'search', id: o.id, value: fd.typed || '', placeholder: 'A city or town', autocomplete: 'off', enterkeyhint: 'search', 'aria-describedby': o.help || null });
  // A plain list of buttons, and a line under the box that says what the search found, which a screen reader reads out.
  const list = h('ul', { class: 'results', 'aria-label': 'Places' });
  const status = h('p', { class: 'where-status small', role: 'status' });
  const draw = () => {
    const place = o.get();
    if (place) {
      where.replaceChildren(h('div', { class: 'picked' },
        h('span', {}, h('b', {}, place.name), ' ', h('span', { class: 'muted' }, [place.admin, place.country].filter(Boolean).join(', '))),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': o.another, html: ICONS.close, onclick: () => { o.pick(null); draw(); input.focus(); } })));
      return;
    }
    const results = fd.results || [];
    list.replaceChildren(...results.map(r => h('li', {}, h('button', { type: 'button', onclick: () => choose(r) },
      h('b', {}, r.name), ' ', h('span', { class: 'muted' }, [r.admin, r.country].filter(Boolean).join(', '))))));
    const typed = input.value.trim();
    recent.hidden = !!input.value || !o.recent?.length;
    const failed = fd.searchErr && typed && fd.searchErr !== NO_PLACES;
    status.className = 'where-status small ' + (failed ? 'err' : 'muted');
    status.textContent = !typed ? '' : failed && single ? 'This copy can’t reach the weather service. Use what you typed and set the weather and abroad by hand, or open carry-on.junkdrawer.works for the forecast.'
      : fd.searchErr || (results.length ? plural(results.length, 'place') : '');
    // Last, once the search has answered for what's typed, the way through without a lookup: offline, or for a place
    // the search doesn't know. (Not before, so it isn't where the first place lands when the places come.)
    if (typed && ((typed.length > 1 && fd.q === input.value) || o.asked())) list.append(h('li', {}, h('button', { type: 'button', onclick: () => choose({ name: input.value.trim(), admin: '', country: '', cc: '' }) }, `Use “${typed}” without looking it up`)));
    // Put back only when coming back from a picked place: taking the box out of the page, even to put it straight
    // back, takes the cursor out of it.
    if (input.parentNode !== where) where.replaceChildren(input, recent, status, list);
  };
  const choose = r => { o.pick(r); fd.results = []; draw(); };
  fd.draw = draw;
  fd.choose = choose;
  // Enter while the search last answered for something else waits for the new places.
  const search = q => {
    clearTimeout(fd.timer);
    if (fd.ctl) fd.ctl.abort();
    const ctl = fd.ctl = new AbortController();
    W.searchPlaces(q, { signal: ctl.signal }).then(r => {
      fd.results = r; fd.q = q; fd.searchErr = q.trim().length > 1 && !r.length ? NO_PLACES : '';
      if (fd.enter && r.length) fd.choose(r[0]); else fd.draw();
      fd.enter = false;
    }, e => { if (e.name !== 'AbortError') { fd.enter = false; fd.results = []; fd.q = q; fd.searchErr = e.message; fd.draw(); } });
  };
  input.addEventListener('input', () => {
    fd.typed = input.value;
    fd.enter = false;
    clearTimeout(fd.timer);
    if (fd.ctl) fd.ctl.abort();
    const q = input.value;
    // Too short to look up: nothing to show.
    if (q.trim().length < 2) Object.assign(fd, { results: [], searchErr: '', q });
    else fd.timer = setTimeout(() => search(q), 300);
    draw();
  });
  // Enter picks the first place.
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (fd.q === input.value) { if (fd.results?.length) choose(fd.results[0]); } else if (input.value.trim().length > 1) { fd.enter = true; search(input.value); }
  });
  draw();
  return where;
}

// Under the occasions picked for a trip, what each brings, in a line: "Work brings the Work bag. Swimming brings
// Sunscreen, Swimsuit and Sandals." One that brings nothing yet says so, and where to change that. '' with none picked.
function brings(picked) {
  const said = [], none = [];
  for (const g of M.tags(doc()).filter(g => picked.has(g.id))) {
    const names = R.occasionThings(doc(), g.id).comes.map(x => (x.bag ? theBag(x.bag) : x.item.name));
    if (names.length) said.push(`${g.name} brings ${names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : andList(names)}.`);
    else none.push(g.name);
  }
  const or = none.length > 1 ? `${none.slice(0, -1).join(', ')} or ${none.at(-1)}` : none[0];
  if (none.length) said.push(`Nothing comes only for ${or} yet. Mark things for ${none.length > 1 ? 'them' : 'it'} in My list.`);
  return said.join(' ');
}

// Until home is set, what's abroad goes by a guess at it from the browser's languages: the trip form says so under
// Where to?, and Change picks home there and then, as Settings does. Once it's set, the line goes.
function homeGuess(dr) {
  if (M.pref(doc(), 'home', '')) return null;
  const cc = R.home(doc());
  if (!dr.homeOpen) {
    return h('p', { class: 'home-guess small muted' }, `Home: ${countryName(cc)} (a guess) · `,
      h('button', { type: 'button', class: 'linkish', 'data-key': 'home-guess', onclick: () => { dr.homeOpen = true; render(); } }, 'Change'));
  }
  return h('div', { class: 'home-pick' }, h('label', { for: 'homePick', class: 'small' }, 'You live in'),
    homeSelect({ id: 'homePick', 'data-key': 'home-guess' }, cc, to => toast(`Home is ${countryName(to)} now. You can change it in Settings.`), true));
}

function tripForm(t, again = false) {
  const editing = t && !again;
  const key = (editing ? 'edit/' : again ? 'again/' : 'new/') + (t ? t.id : '');
  if (draft?.key !== key) {
    // The stops as the form opens: the trip's, or going again, the old trip's places, each to have its night again.
    // Those come from Leave once it's picked, as many nights in as last time (after), till one is picked by hand.
    const was = t ? M.stops(t).sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id)) : [];
    const stops = was.map((s, i) => (editing ? { key: s.id, id: s.id, place: s.place, from: s.from }
      : { key: 'n' + i, id: '', place: s.place, from: '', after: D.nights(t.start, s.from), auto: true }));
    // stops0: what they were, so Save changes only what the form did, and a stop added on another device meanwhile stays.
    draft = { key, main: {}, err: '', stops, stops0: editing ? stops.map(s => ({ ...s })) : [], n: stops.length };
  }
  const dr = draft;
  const st = {
    place: t?.place || null, start: editing ? t.start : '', end: editing ? t.end : '', travel: t?.travel || 'fly', name: t?.name || '',
    tags: new Set(Object.entries(t?.set || {}).filter(([k, m]) => m.v === true && doc().tags[k]).map(([k]) => k)),
  };
  for (const k of Object.keys(st)) if (k in dr) st[k] = dr[k];
  const errBox = h('p', { class: 'err', role: 'alert' }, dr.err);
  const err = msg => { errBox.textContent = dr.err = msg; };
  // Any change to the form answers what the last tap on Make my list asked.
  const changed = () => { if (dr.err) err(''); };
  const set = (k, v) => { st[k] = dr[k] = v; changed(); };
  const asked = () => !!dr.err;
  const where = placeBox(dr.main, { id: 'where', help: 'whereHelp', another: 'Pick another place', get: () => st.place, pick: p => { set('place', p); addStop.hidden = !p; }, asked, recent: R.recentPlaces(doc()) });
  // The stops after the first place: each a place and the night you get there, which comes after leaving and
  // before coming back.
  const stopsBox = h('div', { class: 'stops' });
  const nightRange = x => { x.min = st.start ? D.add(st.start, 1) : ''; x.max = st.end ? D.add(st.end, -1) : ''; };
  const nights = () => {
    for (const s of dr.stops) if (s.auto && st.start) s.from = D.add(st.start, s.after);
    for (const s of dr.stops) {
      const x = stopsBox.querySelector('#' + CSS.escape('night-' + s.key));
      if (x) { x.value = s.from; nightRange(x); }
    }
  };
  const stopRow = s => {
    const pickNight = e => { s.from = e.target.value; s.auto = false; changed(); };
    const night = h('input', { type: 'date', id: 'night-' + s.key, value: s.from, oninput: pickNight, onchange: pickNight });
    nightRange(night);
    // Each says which stop it takes off: "Take Porto off".
    const offName = () => `Take ${s.place?.name || 'this stop'} off`;
    const off = h('button', { type: 'button', class: 'btn small quiet', 'aria-label': offName(), onclick: () => {
      clearTimeout(s.timer);
      s.ctl?.abort();
      dr.stops = dr.stops.filter(x => x !== s);
      changed();
      drawStops();
      addStop.focus();
    } }, 'Take this stop off');
    return h('div', { class: 'stop' },
      h('div', { class: 'field' }, h('label', { for: 'where-' + s.key }, 'Then'),
        placeBox(s, { id: 'where-' + s.key, another: 'Pick another place for this stop', get: () => s.place, pick: p => { s.place = p; off.setAttribute('aria-label', offName()); changed(); }, asked })),
      h('div', { class: 'stop-night' },
        h('div', { class: 'field' }, h('label', { for: 'night-' + s.key }, 'First night there'), night), off));
  };
  const addStop = h('button', { type: 'button', class: 'btn small add-stop', hidden: !st.place, onclick: () => {
    const s = { key: 'n' + dr.n++, id: '', place: null, from: '' };
    dr.stops.push(s);
    changed();
    drawStops();
    stopsBox.querySelector('#' + CSS.escape('where-' + s.key))?.focus();
  } }, h('span', { html: ICONS.plus }), 'Add a stop');
  const drawStops = () => stopsBox.replaceChildren(...dr.stops.map(stopRow), addStop);
  drawStops();
  const startIn = h('input', { type: 'date', id: 'start', value: st.start, min: editing ? null : D.add(today(), -30), required: true, oninput: e => { set('start', e.target.value); nights(); }, onchange: e => { set('start', e.target.value); if (!st.end || st.end < st.start) { set('end', st.start); endIn.value = st.end; } nights(); } });
  const endIn = h('input', { type: 'date', id: 'end', value: st.end, required: true, oninput: e => { set('end', e.target.value); nights(); }, onchange: e => { set('end', e.target.value); nights(); } });
  const nameIn = h('input', { type: 'text', id: 'name', value: st.name, maxlength: 60, placeholder: 'Sam’s wedding', autocomplete: 'off', oninput: e => set('name', e.target.value) });
  // Going again, what was added just for the old trip, to bring again: none picked till tapped.
  const extras = again ? R.lastAdded(doc(), t) : [];
  dr.picked ||= new Set();
  // What the occasions picked bring, said again as they're picked.
  const broughtLine = h('p', { class: 'brings muted small', role: 'status' }, brings(st.tags));
  const save = () => {
    st.start = startIn.value; st.end = endIn.value;
    if (!st.place && dr.main.typed?.trim()) { err('Pick a place from the list, or use what you typed.'); dr.main.draw(); return; }
    if (!st.place && dr.stops.length) { err('Where to first? Pick the first place, or take the stops off.'); return; }
    // No place at all is allowed, once it's been said what that leaves out.
    if (!st.place && !dr.placeless && !(editing && !t.place)) { dr.placeless = true; err(`Where to? Without a place there’s no forecast and no passport check. Tap ${editing ? 'Save' : 'Make my list'} again to go without one.`); return; }
    if (!st.start || !st.end) { err('When do you leave, and when are you back?'); return; }
    if (st.end < st.start) { err('You’re back before you leave. Check the dates.'); return; }
    if (D.nights(st.start, st.end) > 90) { err('That’s more than 90 nights. Check the dates.'); return; }
    for (const s of dr.stops) {
      if (!s.place) { err(s.typed?.trim() ? 'Pick a place for the stop from the list, or use what you typed.' : 'Which place is the stop? Pick one, or take the stop off.'); s.draw?.(); return; }
      if (!s.from) { err(`When do you get to ${s.place.name}? Pick the first night there.`); return; }
      if (s.from <= st.start || s.from >= st.end) { err(`${s.place.name}’s first night is outside the trip. Pick a night after you leave and before you’re back.`); return; }
    }
    const twice = dr.stops.find((s, i) => dr.stops.findIndex(x => x.from === s.from) !== i);
    if (twice) { err(`Two stops start the same night. Pick another night for ${twice.place.name}.`); return; }
    const id = editing ? t.id : M.newId('t');
    if (editing) watchChange(id);
    const bring = extras.filter(x => dr.picked.has(x.id));
    const datesMoved = editing && (t.start !== st.start || t.end !== st.end);
    const moved = datesMoved || (editing && (t.place?.lat !== st.place?.lat || t.place?.name !== st.place?.name));
    const before = new Map(dr.stops0.map(s => [s.id, s]));
    const put = dr.stops.filter(s => { const o = s.id && before.get(s.id); return !o || o.from !== s.from || M.canon(o.place) !== M.canon(s.place); });
    const off = [...before.keys()].filter(sid => !dr.stops.some(s => s.id === sid));
    applyCounting(d => {
      let next = M.putTrip(d, { id, place: st.place, start: st.start, end: st.end, travel: st.travel, name: nameIn.value.trim() });
      for (const g of M.tags(d)) {
        const was = !!d.trips[id]?.set?.[g.id]?.v, now = st.tags.has(g.id);
        if (was !== now) next = M.setCond(next, id, g.id, now ? true : null);
      }
      if (moved) next = M.clearWx(next, id);
      for (const s of put) next = M.putStop(next, id, { id: s.id || undefined, place: s.place, from: s.from });
      for (const sid of off) next = M.removeStop(next, id, sid);
      // Each stop was looked up for the trip's old days too.
      if (datesMoved) for (const s of M.stops(next.trips[id])) next = M.clearWx(next, id, s.id);
      for (const x of bring) next = M.putExtra(next, id, { name: x.name, bag: x.bag });
      return next;
    });
    draft = null;
    if (moved || !editing || put.length || off.length) for (const k of Object.keys(wxTried)) if (k === id || k.startsWith(id + ':')) delete wxTried[k];
    // Back to the trip, as if Back was pressed, when that's where Edit was opened from; otherwise the trip takes the
    // form's place, so Back from it doesn't open the form again.
    if (editing && history.state?.from === `#/trip/${id}`) history.back();
    else go(`#/trip/${id}`, { replace: true });
  };
  return [
    h('a', { class: 'crumb', href: editing ? `#/trip/${t.id}` : '#/', onclick: e => { if (editing && history.state?.from === `#/trip/${t.id}`) { e.preventDefault(); history.back(); } } }, h('span', { html: ICONS.back }), editing ? h('span', { class: 'crumb-name' }, title(t)) : 'Trips'),
    h('h1', {}, editing ? 'Edit trip' : again ? `${title(t)} again` : 'Plan a trip'),
    h('section', { class: 'card form' },
      h('div', { class: 'field' }, h('label', { for: 'where' }, 'Where to?'), where,
        h('small', { id: 'whereHelp', class: 'muted' }, 'For the forecast, and to know if it’s abroad.'), homeGuess(dr)),
      stopsBox,
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: 'start' }, 'Leave'), startIn),
        h('div', { class: 'field' }, h('label', { for: 'end' }, 'Back'), endIn)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Getting there'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Getting there' }, M.TRAVEL.map(k => {
          const info = R.CONDITIONS.find(x => x.k === k);
          const b = h('button', { type: 'button', 'aria-pressed': String(st.travel === k), onclick: () => { set('travel', k); b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } }, `${info.icon} ${info.name}`);
          return b;
        }))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'What’s on?'),
        h('div', { class: 'chips pick' }, M.tags(doc()).map(g => {
          const b = h('button', { type: 'button', class: 'chip' + (st.tags.has(g.id) ? ' on' : ''), 'aria-pressed': String(st.tags.has(g.id)), onclick: () => {
            if (st.tags.has(g.id)) st.tags.delete(g.id); else st.tags.add(g.id);
            set('tags', st.tags);
            b.classList.toggle('on', st.tags.has(g.id)); b.setAttribute('aria-pressed', String(st.tags.has(g.id)));
            broughtLine.textContent = brings(st.tags);
          } }, `${g.icon} ${g.name}`);
          return b;
        })),
        broughtLine),
      extras.length ? h('div', { class: 'field' }, h('span', { class: 'label', id: 'lastAdded' }, 'Last time you added'),
        h('div', { class: 'chips pick', role: 'group', 'aria-labelledby': 'lastAdded' }, extras.map(x => {
          const bag = doc().bags[x.bag];
          const b = h('button', { type: 'button', class: 'chip' + (dr.picked.has(x.id) ? ' on' : ''), 'aria-pressed': String(dr.picked.has(x.id)), title: `In ${theBag(bag)}`, onclick: () => {
            if (dr.picked.has(x.id)) dr.picked.delete(x.id); else dr.picked.add(x.id);
            changed();
            b.classList.toggle('on', dr.picked.has(x.id)); b.setAttribute('aria-pressed', String(dr.picked.has(x.id)));
          } }, `${bag.icon} ${x.name}`);
          return b;
        })),
        h('small', { class: 'muted' }, 'Just for that trip. Tap any to bring it again.')) : null,
      h('div', { class: 'field' }, h('label', { for: 'name' }, 'Name it ', h('span', { class: 'muted' }, '(if you like)')), nameIn),
      errBox,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary big', onclick: save }, editing ? 'Save' : 'Make my list'))),
    // A trip planned again from this one, now or later: Go again, as a past trip has on Trips.
    editing ? h('div', { class: 'again-zone' },
      h('a', { class: 'btn', href: `#/again/${t.id}` }, h('span', { html: ICONS.plus }), 'Plan another like this'),
      h('p', { class: 'muted small' }, 'A new trip with the same place, getting there and occasions, on new dates.')) : null,
    editing ? h('div', { class: 'danger-zone' }, confirmBtn('Delete this trip', 'Tap again to delete it', () => {
      draft = null;
      store.apply(d => M.removeTrip(d, t.id));
      // Back past the trip when Edit was opened from it, to wherever that was opened from; with nothing in this
      // visit before the trip, back to it and Trips takes its place. Otherwise Trips takes the form's place.
      const { from, before } = history.state || {}, trip = `#/trip/${t.id}`;
      if (from === trip && before && !before.endsWith('/' + t.id) && !/^#\/(new|edit|again)\b/.test(before)) history.go(-2);
      else if (from === trip) { thenGo = { at: trip, to: '#/' }; history.back(); }
      else go('#/', { replace: true });
      toast(`${title(t)} deleted.`, { label: 'Undo', run: () => apply(d => M.restoreTrip(d, t.id)) });
    })) : null,
  ];
}

// ---------- my list ----------

// "Only when ☔ rain's likely", "Only when 🌡️ it's hot or for 🏊 swimming", "Not when 🚗 you're driving". Only for an
// occasion deleted since: "Only for 💍 wedding (deleted)", as it stays home. One it stayed home for no longer counts.
function condChips(x) {
  const icon = (i, words) => [h('span', { 'aria-hidden': 'true' }, i.icon), ' ', words];
  const when = R.whenParts(doc(), x.when, icon), unless = R.whenParts(doc(), x.unless.filter(k => R.condInfo(doc(), k)), icon);
  if (!when.length && !unless.length) return null;
  return h('span', { class: 'conds' },
    when.length ? h('span', {}, 'Only ', when) : null,
    unless.length ? h('span', {}, when.length ? ', not ' : 'Not ', unless) : null);
}

function listView() {
  const all = M.bags(doc());
  const kinds = [['bag', 'Bags'], ['leave', 'Before you leave home'], ['back', 'Before you leave the hotel']];
  return [
    h('a', { class: 'crumb', href: '#/' }, h('span', { html: ICONS.back }), 'Trips'),
    h('div', { class: 'page-head' }, h('h1', {}, 'My list')),
    h('p', { class: 'lede muted' }, 'Everything you might pack, by bag. Something with conditions only comes along when a trip calls for it. Tap anything to change it.'),
    M.trips(doc()).length ? null : h('section', { class: 'card ready' },
      h('p', {}, 'Your list is ready. Plan a trip and it picks what this one calls for.'),
      h('a', { class: 'btn primary', href: '#/new' }, h('span', { html: ICONS.plus }), 'Plan a trip')),
    jumpRow(kinds.flatMap(([kind]) => all.filter(b => b.kind === kind)).map(b => ({ bag: b }))),
    kinds.map(([kind, label]) => {
      const bs = all.filter(b => b.kind === kind), none = kind !== 'bag' && !bs.length;
      // No list of jobs of this kind: the starter's to add, unless one was taken off on purpose.
      if (none && M.jobsTakenOff(doc(), kind)) return null;
      return [
        kind !== 'bag' ? h('h2', { class: 'kind-head' }, label) : null,
        none ? starterJobs(kind) : bs.map(b => listBag(b)),
      ];
    }),
    h('button', { type: 'button', class: 'btn add-extra', 'data-key': 'bag:new', onclick: () => bagEditor(null) }, h('span', { html: ICONS.plus }), 'Add a bag or a list of jobs'),
    h('section', { class: 'card' },
      h('h2', {}, 'Occasions'),
      h('p', { class: 'muted small' }, 'Pick these when you plan a trip. Things can come along only for some of them.'),
      h('div', { class: 'chips pick' },
        M.tags(doc()).map(g => h('button', { type: 'button', class: 'chip', 'data-key': 'occ:' + g.id, onclick: () => tagEditor(g) }, `${g.icon} ${g.name}`)),
        h('button', { type: 'button', class: 'chip add', 'data-key': 'occ:new', onclick: () => tagEditor(null) }, '+ Add one'))),
    h('section', { class: 'card' },
      h('h2', {}, 'Share or bring in a list'),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn', 'data-key': 'share', onclick: shareSheet }, 'Send my list as a link'),
        h('button', { type: 'button', class: 'btn', 'data-key': 'paste', onclick: () => pasteSheet() }, 'Paste a list'))),
  ];
}

// Under a heading for jobs with none, the starter list's checklist, to add as if typed: the hotel's is what Coming
// home starts with. Its jobs are named, as a sentence: "Take out the trash, set the thermostat, …".
function starterJobs(kind) {
  const list = starterList(), bag = list.bags.find(b => b.kind === kind), jobs = list.items.filter(x => x.bag === bag.id);
  const what = kind === 'back' ? 'hotel checklist' : 'house checklist';
  const lower = s => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  return h('div', { class: 'jobs-offer' },
    h('button', { type: 'button', class: 'btn small dashed', 'data-key': 'starter-jobs:' + kind, onclick: () => {
      const now = store.apply(d => M.addList(d, { bags: [bag], items: jobs, tags: [] }));
      render();
      const added = M.bags(now).find(b => b.kind === kind);
      if (added) main.querySelector(`[data-key="head:${CSS.escape(added.id)}"]`)?.focus();
      toast(`The starter’s ${what} is in: ${plural(jobs.length, 'job')}. Change them like anything on your list.`);
    } }, h('span', { html: ICONS.plus }), `Add the starter’s ${what}`),
    h('p', { class: 'muted small' }, jobs.map((x, i) => (i ? lower(x.name) : x.name)).join(', ') + '.'));
}

function listBag(b) {
  const its = M.items(doc(), b.id);
  let input;
  const addOne = () => {
    const n = input.value.trim();
    if (!n) return;
    const g = b.kind === 'bag' ? guess(n) : { when: [], unless: [], per: '' };
    store.apply(d => M.putItem(d, { name: n, bag: b.id, ...g }));
    input.value = '';
    render();
    const again = main.querySelector(`[data-key="add:${b.id}"]`);
    again?.focus();
    if (g.when.length || g.per) toast(`${n}: ${g.per ? 'one for each day' : `only ${R.whenWords(doc(), g.when)}`}. Tap it to change that.`);
  };
  return h('section', { class: 'bag edit' + (b.kind !== 'bag' ? ' jobs' : ''), 'data-bag': b.id },
    h('header', { class: 'bag-head' },
      h('span', { class: 'bag-icon', 'aria-hidden': 'true' }, b.icon),
      h('h2', { tabindex: '-1', 'data-key': 'head:' + b.id }, b.name),
      h('button', { type: 'button', class: 'btn small', 'data-key': 'bagmore:' + b.id, onclick: () => bagEditor(b), 'aria-label': `Change ${b.name}` }, 'Change')),
    condChips(b) ? h('p', { class: 'bag-note' }, condChips(b)) : null,
    b.note ? h('p', { class: 'bag-note' }, b.note) : null,
    its.length ? null : h('p', { class: 'muted small pad bag-empty' }, b.kind === 'bag' ? 'Nothing in it yet.' : 'No jobs in it yet.'),
    its.length ? h('ul', { class: 'rows' }, its.map(x => h('li', { class: 'row' },
      h('button', { type: 'button', class: 'edit-row', 'data-key': 'item:' + x.id, onclick: () => itemEditor(x) },
        h('span', { class: 'name' }, x.name, x.per === 'day' ? h('span', { class: 'qty' }, ` · ${perDay(x.qty)} a day`) : x.qty > 1 ? h('span', { class: 'qty' }, ' ×' + x.qty) : null),
        x.note ? h('small', {}, x.note) : null,
        condChips(x) ? h('small', { class: 'why' }, condChips(x)) : null,
        x.last?.v && b.kind === 'bag' ? h('small', { class: 'why' }, h('span', { 'aria-hidden': 'true' }, R.LAST.icon), ' Packed last') : null)))) : null,
    h('form', { class: 'add-row', onsubmit: e => { e.preventDefault(); addOne(); } },
      input = h('input', { type: 'text', 'data-key': 'add:' + b.id, placeholder: b.kind === 'bag' ? `Add to ${b.name}` : 'Add a job', 'aria-label': `Add to ${b.name}`, maxlength: 80, enterkeyhint: 'done', autocomplete: 'off' }),
      h('button', { type: 'submit', class: 'btn small' }, 'Add')));
}

// Condition chips to pick from, grouped. picked is a Set, changed when tapped.
function condPicker(picked, { travel = true } = {}) {
  const groups = {};
  for (const c of R.CONDITIONS) if (travel || !M.TRAVEL.includes(c.k)) (groups[c.group] ||= []).push(c);
  groups.Occasions = M.tags(doc()).map(g => ({ k: g.id, icon: g.icon, name: g.name }));
  return h('div', { class: 'cond-pick' }, Object.entries(groups).map(([name, list]) => [
    h('h4', {}, name),
    h('div', { class: 'chips pick' }, list.map(c => {
      const b = h('button', { type: 'button', class: 'chip' + (picked.has(c.k) ? ' on' : ''), 'aria-pressed': String(picked.has(c.k)), onclick: () => {
        if (picked.has(c.k)) picked.delete(c.k); else picked.add(c.k);
        b.classList.toggle('on', picked.has(c.k)); b.setAttribute('aria-pressed', String(picked.has(c.k)));
      } }, `${c.icon} ${c.name}`);
      return b;
    })),
  ]));
}

// A thing in My list, or a new one (x null). when: a new one's conditions to start with (from an occasion's sheet).
// then: what to open after Save, in place of closing (back to that occasion's sheet).
function itemEditor(x, { when: when0 = [], then = null } = {}) {
  const isNew = !x;
  const bagsAll = M.bags(doc());
  const bag0 = x?.bag || bagsAll[0]?.id;
  const when = new Set(x?.when || when0), unless = new Set(x?.unless || []);
  let name, bag, qty, note, mode, last;
  sheet(isNew ? 'Add a thing' : x.name, close => {
    const whenBox = h('div', { hidden: !when.size }, condPicker(when));
    // Packed last is for things in a bag, not jobs.
    const inBag = () => doc().bags[bag.value]?.kind === 'bag';
    const lastPick = h('label', { class: 'check last-pick', hidden: doc().bags[bag0]?.kind !== 'bag' }, last = h('input', { type: 'checkbox', checked: !!x?.last?.v }),
      h('span', {}, 'Pack it last', h('small', { class: 'muted' }, 'With the last things out the door, for what’s still in use the night before: a charger in the wall, medicine in the fridge.')));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const q = qty.value;
      const daily = q.startsWith('day');
      const fields = { id: x?.id || M.newId('i'), name: n, bag: bag.value, note: note.value.trim(), when: mode.value === 'some' ? [...when] : [], unless: [...unless], per: daily ? 'day' : '', qty: daily ? +q.slice(3) || 1 : +q };
      // Saved only when it changes, so a thing that never had it still has none.
      if (inBag() && last.checked !== !!x?.last?.v) fields.last = last.checked;
      if (!then) close();
      applyCounting(d => M.putItem(d, fields));
      render();
      then?.(fields.id);
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: x?.name || '', maxlength: 80, autofocus: isNew, autocomplete: 'off' })),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'Bag'), bag = h('select', { onchange: () => { lastPick.hidden = !inBag(); } }, bagsAll.map(b => h('option', { value: b.id, selected: b.id === bag0 }, `${b.icon} ${b.name}`)))),
        h('label', { class: 'field' }, h('span', {}, 'How many'), qty = h('select', {},
          // Just one to 6, and more where a pasted list ("Socks x10") or a link had it, so Save keeps it.
          [...new Set([1, 2, 3, 4, 5, 6, x?.per !== 'day' ? x?.qty || 1 : 1])].map(n => h('option', { value: n, selected: x?.per !== 'day' && (x?.qty || 1) === n }, n === 1 ? 'Just one' : String(n))),
          // One, two or three for each day, and more where a list from a link had it.
          [...new Set([1, 2, 3, x?.per === 'day' ? x.qty || 1 : 1])].map(n => h('option', { value: n === 1 ? 'day' : 'day' + n, selected: x?.per === 'day' && (x.qty || 1) === n },
            `${cap(perDay(n))} for each day (up to ${R.laundry(doc()) * n})`))))),
      h('label', { class: 'field' }, h('span', {}, 'Bring it'), mode = h('select', { onchange: e => { whenBox.hidden = e.target.value !== 'some'; } },
        h('option', { value: 'all', selected: !when.size }, 'On every trip'),
        h('option', { value: 'some', selected: !!when.size }, 'Only when the trip calls for…'))),
      whenBox,
      h('details', { class: 'unless', open: unless.size > 0 },
        h('summary', {}, 'Leave it home when…'),
        condPicker(unless)),
      h('label', { class: 'field' }, h('span', {}, 'Note'), note = h('input', { type: 'text', value: x?.note || '', maxlength: 140, placeholder: 'Shows under it on the list', autocomplete: 'off' })),
      lastPick,
      h('div', { class: 'sheet-actions' },
        isNew ? null : h('div', { class: 'nudge' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', html: ICONS.up, onclick: () => { store.apply(d => M.nudge(d, 'items', x.id, -1)); render(); } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', html: ICONS.down, onclick: () => { store.apply(d => M.nudge(d, 'items', x.id, 1)); render(); } })),
        isNew ? null : h('button', { type: 'button', class: 'btn danger-quiet', onclick: () => {
          close();
          apply(d => M.removeItem(d, x.id));
          toast(`${x.name} deleted.`, { label: 'Undo', run: () => apply(d => M.restoreItem(d, x.id)) });
        } }, 'Delete'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add it' : 'Save')),
    ];
  }, { wide: true });
}

// What the Delete button asks on its first tap: a bag goes with the things in it, a list of jobs with its jobs.
function deleteAsk(b) {
  const n = M.items(doc(), b.id).length;
  if (!n) return 'Tap again to delete';
  if (b.kind === 'bag') return `Delete it and ${plural(n, 'thing')} in it?`;
  return n === 1 ? 'Delete it and its job?' : `Delete it and its ${n} jobs?`;
}

// A bag or list of jobs in My list, or a new one. then: what to open after Save, in place of closing.
function bagEditor(b, { then = null } = {}) {
  const isNew = !b;
  const when = new Set(b?.when || []), unless = new Set(b?.unless || []);
  let name, kind, note, iconPick = b?.icon || '';
  sheet(isNew ? 'Add a bag' : `${b.icon} ${b.name}`, close => {
    const icons = h('div', { class: 'icon-pick', role: 'group', 'aria-label': 'Icon' }, BAG_ICONS.map(i => {
      const btn = h('button', { type: 'button', 'aria-pressed': String(i === iconPick), onclick: () => { iconPick = i; icons.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === btn))); } }, i);
      return btn;
    }));
    const whenBox = h('div', {}, condPicker(when));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const id = b?.id || M.newId('b');
      if (!then) close();
      apply(d => M.putBag(d, { id, name: n, kind: kind.value, icon: iconPick || bagIcon(n, kind.value), note: note.value.trim(), when: [...when], unless: [...unless] }));
      then?.(id);
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: b?.name || '', maxlength: 60, autofocus: isNew, autocomplete: 'off', placeholder: 'Toiletries bag' })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), icons),
      h('label', { class: 'field' }, h('span', {}, 'It holds'), kind = h('select', {},
        h('option', { value: 'bag', selected: !b || b.kind === 'bag' }, 'Things to pack'),
        h('option', { value: 'leave', selected: b?.kind === 'leave' }, 'Jobs before leaving home'),
        h('option', { value: 'back', selected: b?.kind === 'back' }, 'Jobs before leaving the hotel'))),
      h('label', { class: 'field' }, h('span', {}, 'Note'), note = h('input', { type: 'text', value: b?.note || '', maxlength: 140, placeholder: 'Shows under its name', autocomplete: 'off' })),
      h('details', { class: 'unless', open: when.size > 0 },
        h('summary', {}, 'Bring it only when the trip calls for…'), whenBox),
      h('details', { class: 'unless', open: unless.size > 0 },
        h('summary', {}, 'Leave it home when…'), condPicker(unless)),
      h('div', { class: 'sheet-actions' },
        isNew ? null : h('div', { class: 'nudge' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', html: ICONS.up, onclick: () => { store.apply(d => M.nudge(d, 'bags', b.id, -1)); render(); } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', html: ICONS.down, onclick: () => { store.apply(d => M.nudge(d, 'bags', b.id, 1)); render(); } })),
        isNew ? null : confirmBtn('Delete', deleteAsk(b), () => {
          const ids = M.items(doc(), b.id).map(x => x.id);
          close();
          apply(d => M.removeBag(d, b.id));
          toast(`${b.name} deleted.`, { label: 'Undo', run: () => apply(d => M.restoreBag(d, b.id, ids)) });
        }, 'btn danger-quiet'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add it' : 'Save')),
    ];
  }, { wide: true });
}

// What Delete asks on its first tap: what comes only for the occasion, which stays home once it's gone. "Delete it?
// 2 things and the Golf bag only come for it"
function occasionAsk(g) {
  const only = R.onlyFor(doc(), g.id);
  if (!only.length) return 'Tap again to delete';
  const things = only.filter(x => x.item).length, bs = only.filter(x => x.bag).map(x => x.bag), jobs = bs.filter(b => b.kind !== 'bag').length;
  const parts = [[things, 'thing'], ...(bs.length > 2 ? [[bs.length - jobs, 'bag'], [jobs, 'list of jobs', 'lists of jobs']] : [])]
    .filter(([n]) => n).map(([n, one, many]) => plural(n, one, many));
  if (bs.length <= 2) parts.push(...bs.map(theBag));
  return `Delete it? ${cap(andList(parts))} only ${only.length === 1 ? 'comes' : 'come'} for it`;
}

// An occasion: its name and icon, and what comes along for it and stays home for it, each to tap and change, with a
// way to add a thing that comes only for it. Just added (added), it opens again saying so, ready for those things.
// focus: the key of the thing to put the focus on, coming back from it.
function tagEditor(g, { added = false, focus = '' } = {}) {
  const isNew = !g;
  let name, iconPick = g?.icon || '🏷️';
  // Back here after changing or adding one of its things, at that one.
  const again = id => { const x = doc().tags[g.id]; if (x && !M.gone(x)) tagEditor(x, { focus: 'occ-thing:' + id }); else closeSheet(); };
  sheet(isNew ? 'Add an occasion' : `${g.icon} ${g.name}`, close => {
    const icons = h('div', { class: 'icon-pick', role: 'group', 'aria-label': 'Icon' }, TAG_ICONS.map(i => {
      const btn = h('button', { type: 'button', 'aria-pressed': String(i === iconPick), onclick: () => { iconPick = i; icons.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === btn))); } }, i);
      return btn;
    }));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const id = g?.id || M.newId('o');
      if (!isNew) close();
      apply(d => M.putTag(d, { id, name: n, icon: iconPick }));
      if (isNew) tagEditor(doc().tags[id], { added: true });
    };
    // Each thing or bag, to open: a thing says which bag it's in, a bag how much is in it.
    const things = list => h('ul', { class: 'rows occ-things' }, list.map(({ bag: b, item: x }) => h('li', { class: 'row' },
      h('button', { type: 'button', class: 'edit-row', 'data-key': 'occ-thing:' + (b || x).id, onclick: () => (b ? bagEditor(b, { then: again }) : itemEditor(x, { then: again })) },
        h('span', { class: 'name' }, b ? `${b.icon} ${b.name}` : x.name),
        h('small', {}, b ? `${b.kind === 'bag' ? 'A bag' : 'A list of jobs'} · ${plural(M.items(doc(), b.id).length, b.kind === 'bag' ? 'thing' : 'job')}` : `In ${theBag(doc().bags[x.bag])}`)))));
    const { comes, stays } = isNew ? { comes: [], stays: [] } : R.occasionThings(doc(), g.id);
    return [
      added ? h('p', { class: 'occ-added', role: 'status' }, `${g.name} is in. Add the things that come only for it.`) : null,
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: g?.name || '', maxlength: 30, autofocus: isNew, autocomplete: 'off', placeholder: 'Wedding' })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), icons),
      isNew ? null : [
        h('h3', {}, 'Comes along for it'),
        comes.length ? things(comes) : h('p', { class: 'muted small' }, 'Nothing yet.'),
        h('button', { type: 'button', class: 'btn small dashed occ-add', 'data-key': 'occ-add-thing', autofocus: added, onclick: () => itemEditor(null, { when: [g.id], then: again }) }, h('span', { html: ICONS.plus }), 'Add a thing for it'),
        stays.length ? [h('h3', {}, 'Stays home for it'), things(stays)] : null,
      ],
      h('div', { class: 'sheet-actions' },
        isNew ? null : confirmBtn('Delete', occasionAsk(g), () => {
          close();
          apply(d => M.removeTag(d, g.id));
          toast(`${g.name} deleted.`, { label: 'Undo', run: () => apply(d => M.restoreTag(d, g.id)) });
        }, 'btn danger-quiet'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add it' : 'Save')),
    ];
  }, { wide: !isNew });
  // A thing changed so it no longer comes for this occasion has left the list: the focus goes to Add a thing for it,
  // rather than out of the sheet.
  if (focus) { const box = document.getElementById('sheet'); (byKey(box, focus) || byKey(box, 'occ-add-thing'))?.focus(); }
}

// ---------- lists in and out ----------

// "4 bags and 11 things, and 1 list of jobs"; "13 things, not in bags yet".
const isLoose = b => b.name.toLowerCase() === 'not in a bag';
function listSummary(list) {
  const packing = list.bags.filter(b => b.kind === 'bag'), bags = packing.filter(b => !isLoose(b));
  const things = plural(list.items.filter(x => packing.some(b => b.id === x.bag)).length, 'thing');
  const jobs = list.bags.length - packing.length;
  return (bags.length ? `${plural(bags.length, 'bag')} and ${things}` : `${things}, not in bags yet`) + (jobs ? `, and ${plural(jobs, 'list of jobs', 'lists of jobs')}` : '');
}

// The first guesses on a pasted list, as one line: "Passport only when abroad · Swimsuit only when it's hot or for
// swimming".
function guessLine(list) {
  const parts = list.items.filter(x => x.per === 'day' || x.when.length).map(x => {
    if (x.per === 'day') return `${x.name} one a day`;
    const when = R.whenWords(doc(), [...x.when].sort()); // in My list's order
    return when ? `${x.name} only ${when}` : '';
  }).filter(Boolean);
  if (!parts.length) return null;
  const more = parts.length - 6;
  return h('p', { class: 'muted small' }, `First guesses: ${parts.slice(0, 6).join(' · ')}${more > 0 ? ` · ${more} more` : ''}. Change any of them in My list.`);
}

// What adding a list brought in: "Added 3 things: Retainer, Camera, Feed the cat.", "Added 1 bag and 4 things."
function added(was, now) {
  const fresh = (coll, list) => list.filter(x => !was[coll][x.id] || M.gone(was[coll][x.id]));
  const bs = fresh('bags', M.bags(now)), its = fresh('items', M.items(now)), gs = fresh('tags', M.tags(now));
  const jobs = bs.filter(b => b.kind !== 'bag').length;
  if (!bs.length && !gs.length) {
    if (!its.length) return 'Nothing new: it’s all on your list already.';
    const n = its.map(x => x.name);
    return `Added ${plural(n.length, 'thing')}: ${n.length > 3 ? `${n.slice(0, 2).join(', ')} and ${n.length - 2} more` : n.join(', ')}.`;
  }
  const parts = [[bs.length - jobs, 'bag'], [jobs, 'list of jobs', 'lists of jobs'], [its.length, 'thing'], [gs.length, 'occasion']]
    .filter(([k]) => k).map(([k, one, many]) => plural(k, one, many));
  return `Added ${andList(parts)}.`;
}

// Use a list that came in: add it to this one, or put it in this one's place (which Undo takes back).
// back: from a paste, a way back to the pasted text. link: closing without choosing says the list wasn't added.
// A pasted list with things not in a bag can have them sorted into bags first (share.js sortLoose): the sheet is drawn
// again with them sorted, so the preview shows where each one lands before anything comes in.
function offerList(pasted, title, { back = null, link = false } = {}) {
  const has = M.hasList(doc());
  const sort = back ? sortLoose(pasted) : { placed: 0 };
  const allLoose = !pasted.bags.some(b => b.kind === 'bag' && !isLoose(b));
  let chose = false, sorted = false;
  // With no trips yet, the toast leads on to planning one. Undo comes first, after using a list instead of one.
  const onward = () => (M.trips(doc()).length ? undefined : { label: 'Plan a trip', run: () => go('#/new') });
  const replace = (close, list) => {
    chose = true;
    close();
    let before = null;
    const done = store.apply(d => M.replaceList(before = d, list));
    toast('Your list is in.', has ? { label: 'Undo', run: () => apply(d => M.undoReplace(d, before, done)) } : onward());
    go('#/list');
  };
  const add = (close, list) => {
    chose = true;
    close();
    let was = null;
    const now = store.apply(d => M.addList(was = d, list));
    toast(added(was, now), onward());
    go('#/list');
  };
  const draw = () => sheet(title, close => {
    const list = sorted ? sort.list : pasted;
    const occasions = list.tags.map(g => g.name);
    return [
      link ? h('p', { class: 'muted small' }, 'It becomes your own copy on this phone. Change anything; theirs stays as it is. Their trips don’t come with it.') : null,
      h('p', {}, listSummary(list)),
      // Only when the words can place something.
      sort.placed ? [
        h('label', { class: 'check sort' }, h('input', { type: 'checkbox', 'data-key': 'sort-loose', checked: sorted, onchange: e => { sorted = e.target.checked; draw(); } }),
          h('span', {}, allLoose ? 'Sort them into bags for me' : 'Sort the things not in a bag into bags for me')),
        sorted ? h('p', { class: 'muted small sort-said', role: 'status' }, sort.left
          ? `${plural(sort.placed, 'thing')} sorted into bags. ${sort.left === 1 ? 'The other one stays' : `The other ${sort.left} stay`} in “Not in a bag”.`
          : `All ${plural(sort.placed, 'thing')} sorted into bags.`) : null,
      ] : null,
      list.bags.length ? h('ul', { class: 'preview' }, list.bags.map(b => h('li', {}, h('span', { 'aria-hidden': 'true' }, b.icon), ' ', h('b', {}, b.name), ' ',
        h('span', { class: 'muted' }, list.items.filter(x => x.bag === b.id).map(x => x.name).slice(0, 6).join(', ') + (list.items.filter(x => x.bag === b.id).length > 6 ? '…' : ''))))) : null,
      occasions.length ? h('p', { class: 'small' }, occasions.length === 1 ? `With the occasion ${occasions[0]}` : `With ${occasions.length} occasions: ${occasions.join(', ')}`) : null,
      back ? guessLine(list) : null,
      h('div', { class: 'stack' },
        has ? h('button', { type: 'button', class: 'btn primary', onclick: () => add(close, list) }, 'Add it to my list') : null,
        h('button', { type: 'button', class: has ? 'btn' : 'btn primary', onclick: () => replace(close, list) }, has ? 'Use it instead of my list' : 'Use this list'),
        has ? h('p', { class: 'muted small' }, 'Using it instead keeps your trips. Their ticks still count for things on both lists.') : null,
        back ? h('button', { type: 'button', class: 'btn quiet', onclick: () => { chose = true; close(); back(); } }, 'Back') : null),
    ];
  }, { wide: true, done: link ? () => { if (!chose) toast('That list wasn’t added. Open the link again to see it.'); } : undefined });
  draw();
}

async function takeLink(code) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  render();
  try {
    const list = await decodeList(code);
    offerList(list, 'Someone sent you a packing list', { link: true });
  } catch (e) { toast(e.message); }
}

function pasteSheet(text = '') {
  let area, err;
  sheet('Paste a list', close => {
    const next = () => {
      const typed = area.value, list = parsePaste(typed);
      if (!list.items.length) { err.textContent = 'Nothing to bring in yet: paste a list first.'; area.focus(); return; }
      close();
      offerList(list, 'Your pasted list', { back: () => pasteSheet(typed) });
    };
    return [
      h('p', { class: 'muted small' }, 'Copy your list from Google Keep, Notes or a document and paste it here. Put each bag’s things under its name: indented, with a dash, or after a line ending in a colon or a # Heading. Anything on its own goes in “Not in a bag”. A first guess at when each thing is needed goes in too.'),
      area = h('textarea', { rows: 10, autofocus: true, value: text, 'aria-label': 'Your list', oninput: () => { err.textContent = ''; }, placeholder: 'Electronics:\n- Phone charger\n- Headphones\nToiletries:\n- Toothbrush\n- Floss\nPassport' }),
      err = h('p', { class: 'err', role: 'alert' }),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: next }, 'Next')),
    ];
  }, { wide: true });
}

async function shareSheet() {
  const code = await encodeList(M.listOf(doc()));
  const link = `${SITE}#list=${code}`;
  sheet('Send my list', () => {
    const box = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Link to your list', onfocus: e => e.target.select() });
    const copy = async b => {
      try { await navigator.clipboard.writeText(link); b.textContent = 'Copied'; } catch { box.focus(); box.select(); b.textContent = 'Selected: copy it'; }
    };
    return [
      h('p', { class: 'muted small' }, 'Anyone who opens this gets a copy of your bags, things and occasions, not your trips. The list travels inside the link itself.'),
      box,
      h('div', { class: 'sheet-actions' },
        navigator.share && !single ? h('button', { type: 'button', class: 'btn', onclick: () => navigator.share({ title: 'My packing list', url: link }).catch(() => {}) }, 'Share…') : null,
        h('button', { type: 'button', class: 'btn primary', onclick: e => copy(e.currentTarget) }, 'Copy the link')),
    ];
  }, { wide: true });
}

// ---------- settings ----------

// "a, b and c"
const andList = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]);
// What a backup brought back, from store.restoreBackup's counts: "Restored 3 things and 1 bag."
function restored(n) {
  const parts = [[n.things, 'thing'], [n.bags, 'bag'], [n.jobs, 'job'], [n.lists, 'list of jobs', 'lists of jobs'], [n.occasions, 'occasion'], [n.trips, 'trip']]
    .filter(([k]) => k).map(([k, one, many]) => plural(k, one, many));
  return parts.length ? `Restored ${andList(parts)}.` : 'Nothing in it that isn’t here already.';
}

// The countries to pick home from, saved as it's picked. Typed into ("por" for Portugal), it waits for the typing to
// stop before the page is drawn again (and then(cc) is told): a new picker wouldn't get the letters after the first.
// With guess, it starts on the guess at home as an option of its own, so picking that same country saves it too: a
// picker only says when what's picked changes.
let homeKeyed = false, homeT = null;
function homeSelect(attrs, cc, then = () => {}, guess = false) {
  const countries = Object.keys(PLUGS).map(c => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  return h('select', {
    ...attrs,
    onpointerdown: () => { homeKeyed = false; },
    onkeydown: e => { if (e.key.length === 1 || /^(Arrow|Home$|End$|Page)/.test(e.key)) homeKeyed = true; },
    onchange: e => {
      const to = e.target.value;
      store.apply(x => M.setPref(x, 'home', to));
      const done = () => { render(); then(to); };
      clearTimeout(homeT);
      if (homeKeyed) homeT = setTimeout(done, 1000); else done();
    } }, guess ? h('option', { value: '', disabled: true, selected: true }, `${countryName(cc)} (a guess)`) : null,
    countries.map(([c, n]) => h('option', { value: c, selected: !guess && c === cc }, n)));
}

function settingsView() {
  clearTimeout(homeT);
  const d = doc(), home = R.home(d), u = R.units(d), l = R.laundry(d);
  const homeSet = !!M.pref(d, 'home', '');
  const driveHost = h('section', { class: 'card drive' });
  const atDrive = toDrive;
  toDrive = false;
  queueMicrotask(() => {
    drive.card(driveHost);
    // From the first screen: to the Drive card, under the top bar, with its button ready to tap. The card draws
    // again when Google's sign-in has loaded, button and all, so the focus goes to the new one, until it's
    // somewhere else or the screen has gone.
    if (!atDrive || driveHost.hidden) return;
    window.scrollTo(0, driveHost.getBoundingClientRect().top + scrollY - document.querySelector('.bar').offsetHeight - 12);
    drive.watch(() => {
      const at = document.activeElement, free = !at || at === document.body || at === main || (at.tagName === 'H1' && main.contains(at));
      if (!driveHost.isConnected || (!free && !driveHost.contains(at))) return false;
      driveHost.querySelector('button')?.focus({ preventScroll: true });
    });
  });
  // Erasing this device leaves the Google Drive copy alone, so with Drive on it says so, before and after. Drive can
  // be turned on or off while this is on screen.
  const zone = h('div', { class: 'danger-zone' });
  let zoneOn = null;
  const drawZone = () => {
    const on = drive.isOn();
    if (on === zoneOn) return;
    zoneOn = on;
    zone.replaceChildren(
      confirmBtn('Erase everything on this device', on ? 'Tap again: your Google Drive copy stays' : 'Tap again to erase it all', () => {
        const kept = drive.isOn();
        drive.stop();
        store.erase();
        go('#/');
        toast(kept ? 'Erased from this device. Your Google Drive copy is still there.' : 'Erased.');
      }),
      on ? h('p', { class: 'muted small' }, 'To remove it from Drive too, delete the Carry On folder there.') : '');
  };
  drawZone();
  queueMicrotask(() => drive.watch(() => { if (!zone.isConnected) return false; drawZone(); }));
  let file;
  return [
    h('a', { class: 'crumb', href: '#/' }, h('span', { html: ICONS.back }), 'Trips'),
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('section', { class: 'card' },
      h('h2', {}, 'Home'),
      h('label', { class: 'field' }, h('span', {}, 'You live in'),
        homeSelect({ 'data-key': 'home' }, home)),
      h('p', { class: 'muted small' }, homeSet ? '' : 'Guessed from this browser’s language settings. ',
        // The US and its territories count as home for each other, apart from American Samoa.
        R.sameHome(home, 'US') ? 'Trips outside the US and its territories count as abroad, and so does American Samoa.' : 'Trips anywhere else count as abroad.',
        homeSet ? ' Plug adapters are worked out from home’s plugs.' : '')),
    h('section', { class: 'card' },
      h('h2', {}, 'Temperatures'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Temperatures' },
        ['F', 'C'].map(k => h('button', { type: 'button', 'data-key': 'units:' + k, 'aria-pressed': String(u === k), onclick: () => apply(x => M.setPref(x, 'units', k)) }, k === 'F' ? '°F' : '°C')))),
    h('section', { class: 'card' },
      h('h2', {}, 'Laundry'),
      h('p', { class: 'muted small' }, 'Things you need one of each day (socks, say) stop at this many, for longer trips where you’ll do laundry.'),
      h('div', { class: 'stepper' },
        // At either end the button only looks disabled, so it keeps the focus.
        h('button', { type: 'button', class: 'icon-btn', 'data-key': 'laundry:-', 'aria-label': 'One fewer', 'aria-disabled': l <= 1 ? 'true' : null, onclick: () => { if (l > 1) apply(x => M.setPref(x, 'laundry', l - 1)); } }, '−'),
        h('output', {}, plural(l, 'day')),
        h('button', { type: 'button', class: 'icon-btn', 'data-key': 'laundry:+', 'aria-label': 'One more', 'aria-disabled': l >= 30 ? 'true' : null, onclick: () => { if (l < 30) { applyCounting(x => M.setPref(x, 'laundry', l + 1)); render(); } } }, '+'))),
    driveHost,
    h('section', { class: 'card' },
      h('h2', {}, 'Backup'),
      // The one-file copy can't download a file, only bring one in.
      h('p', { class: 'muted small' }, single ? ['Bring in a backup saved at ', h('span', { class: 'nowrap' }, 'carry-on.junkdrawer.works'), '. This copy can’t save one; send your list as a link from My list instead.']
        : 'A file with your list and trips, to keep or to bring to another browser. Restoring adds what’s in it; nothing here is lost.'),
      h('div', { class: 'stack' },
        single ? null : h('button', { type: 'button', class: 'btn', onclick: () => {
          const a = h('a', { href: URL.createObjectURL(new Blob([store.backup()], { type: 'application/json' })), download: `carry-on-${today()}.json` });
          document.body.append(a); a.click(); a.remove();
        } }, 'Save a backup'),
        h('label', { class: 'btn file' }, 'Restore from a backup', file = h('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
          const f = file.files[0];
          if (!f) return;
          try { const n = store.restoreBackup(await f.text()); render(); drive.changed(); toast(restored(n)); } catch (e) { toast(e.message); }
          file.value = '';
        } })))),
    h('section', { class: 'card' },
      h('h2', {}, 'About'),
      h('p', { class: 'small' }, 'Forecasts, past weather and place search come from ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'), `. Looking up a trip sends its places and dates there; nothing else leaves this browser${drive.ready ? ' unless you turn on Google Drive' : ''}. Plug types are from the IEC’s list of world plugs.`),
      // Every rule in weather.js summarize(), with no break between a number and its unit.
      h('p', { class: 'small muted' }, 'Hot means a high of 28\u00a0°C (82\u00a0°F) or more; cool, a low of 13\u00a0°C (55\u00a0°F) or less; cold, a low of 4\u00a0°C (39\u00a0°F) or less, or highs that average 10\u00a0°C (50\u00a0°F) or less. Rain means a 50% chance of rain or more, or 3\u00a0mm (0.1\u00a0in) or more, on any day; for typical weather, rain on 3 days in 10. Snow means 0.5\u00a0cm (0.2\u00a0in) or more on any day; for typical weather, snow on 3 days in 20. Strong sun means a UV index of 6 or more; for typical weather, it’s estimated from how high the sun gets there and how sunny those days were.')),
    zone,
  ];
}

// ---------- starting up ----------

setupSheet();
drive.chip(document.getElementById('cloud'));
store.onSave(r => { if (r === 'full') toast('This browser’s storage is full, so that wasn’t saved.'); else drive.changed(); });
// A list arriving from Drive on a phone that had none: say so, and go to the trips.
drive.onUpdate(() => {
  const had = M.hasList(doc());
  store.reload();
  if (!had && M.hasList(doc())) { toast('Your list is here from Google Drive.'); go('#/'); } else redraw();
});
window.addEventListener('storage', e => { if (e.key === 'carry-on' || e.key === 'carry-on.device') { store.reload(); redraw(); } });
// Back to a page the browser kept in memory (after the footer's links, say): it missed whatever was saved meanwhile.
window.addEventListener('pageshow', e => { if (e.persisted) { store.reload(); render(); } });
window.addEventListener('hashchange', render);
// A new day can change which trips are coming up, and old weather gets looked up again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); askAwake(); } });
// Back online: what couldn't be looked up is looked up now, not a minute after the last try, and what the failed
// lookups said goes.
window.addEventListener('online', () => {
  for (const k in wxTried) delete wxTried[k];
  for (const k in wxErr) delete wxErr[k];
  redraw();
});
render();

if ('serviceWorker' in navigator && !single && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

// For the tests and the screenshots.
window.carryOn = { store, M, R, D, render };
