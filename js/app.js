// Carry On: the page. Screens are drawn from the store each time something changes (#/, #/trip/ID, #/new,
// #/edit/ID, #/again/ID, #/list, #/settings), and #list=… brings in a list from a link.
import * as M from './model.js';
import * as R from './rules.js';
import * as W from './weather.js';
import * as D from './days.js';
import { store } from './store.js';
import { drive } from './sync.js';
import { starterList } from './starter.js';
import { parsePaste, encodeList, decodeList, guess, bagIcon } from './share.js';
import { PLUGS, countryName } from './plugs.js';
import { h, ICONS, toast, sheet, closeSheet, setupSheet, confirmBtn, pressedKey, byKey } from './ui.js';

export const SITE = 'https://carry-on.junkdrawer.works/';
const main = document.getElementById('app');
const single = document.documentElement.hasAttribute('data-single');
const doc = () => store.doc;
const today = () => D.today();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const BAG_ICONS = ['🧳', '🧴', '🪥', '💊', '🔌', '🛂', '👜', '🎒', '👕', '👟', '💼', '🏋️', '🧸', '🍼', '📷', '🎮', '⛳', '🏕️', '🎿', '🏖️', '🐶', '📚', '🍫', '🏠', '🏨'];
const TAG_ICONS = ['🏷️', '💼', '🏋️', '🏊', '👔', '🥾', '💍', '🎉', '⛳', '🎿', '🏕️', '👶', '🐶', '🎭', '🏖️', '🎸', '🚴', '🎣'];

// ---------- drawing ----------

let current = '';
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
  const hash = location.hash || '#/';
  if (hash.startsWith('#list=')) { takeLink(hash.slice(6)); return; }
  // Back to a trip that Delete stepped back to: it goes, and Trips takes its place.
  if (thenGo?.at === hash) { const to = thenGo.to; thenGo = null; go(to, { replace: true }); return; }
  const [, page = '', id = ''] = hash.slice(1).split('/');
  const screen = page + '/' + id, moved = screen !== current;
  if (moved) {
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
  if (moved) { current = screen; window.scrollTo(0, scrolls.get(shownTrip) || 0); tripY = scrollY; (h1 || main).focus({ preventScroll: true }); }
  else if (onTitle) h1?.focus({ preventScroll: true });
  const back = key ? byKey(main, key) : fid ? main.querySelector('#' + CSS.escape(fid)) : null;
  if (back) {
    back.focus({ preventScroll: true });
    if (caret && back.setSelectionRange) try { back.setSelectionRange(...caret); } catch { /* not a text box */ }
  } else focusFirst(near);
  document.body.dataset.page = page || 'home';
}

// The keys to try, in order, when the control with the focus goes: the next ones in its bag (or in Left off), then
// the ones before it, then the bag's folded line and its ⋯, then the rest of the page from there.
function around(el) {
  if (!el) return [];
  const step = list => { const i = list.indexOf(el); return i < 0 ? [] : [...list.slice(i + 1), ...list.slice(0, i).reverse()].map(x => x.dataset.key); };
  const box = el.closest('.bag, .left');
  const own = !box ? [] : box.dataset.bag ? ['fold:' + box.dataset.bag, 'bagmore:' + box.dataset.bag] : ['left'];
  return [...(box ? step([...box.querySelectorAll('.rows [data-key]')]) : []), ...own, ...step([...main.querySelectorAll('[data-key]')])];
}
function focusFirst(keys) {
  for (const k of keys) { const x = byKey(main, k); if (x) { x.focus({ preventScroll: true }); return; } }
}

function view(page, id) {
  // With no list there's nothing to plan, but trips already made can still be opened.
  if (!M.hasList(doc()) && !['settings', 'trip', 'edit'].includes(page)) return welcome();
  if (page === 'trip') { const t = doc().trips[id]; return t && !M.gone(t) ? tripView(t) : missing(); }
  if (page === 'new') return tripForm(null);
  if (page === 'edit' || page === 'again') {
    const t = doc().trips[id];
    // Deleted, maybe on another device: saving the form would bring it back.
    if (!t || (page === 'edit' && M.gone(t))) { draft = null; return missing(); }
    return tripForm(t, page === 'again');
  }
  if (page === 'list') return listView();
  if (page === 'settings') return settingsView();
  return homeView();
}

const missing = () => h('section', { class: 'card empty' }, h('h1', {}, 'That trip isn’t here'), h('p', {}, 'It may have been deleted on another device.'), h('a', { class: 'btn primary', href: '#/' }, 'All trips'));
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
    h('p', { class: 'small muted' }, 'No account. Your list stays on this phone unless you turn on Google Drive.'),
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
    coming.length ? h('div', { class: 'tags' }, coming.map(tagCard))
      : h('section', { class: 'card empty' },
        h('p', {}, all.length ? 'Nothing coming up.' : 'No trips yet.'),
        h('p', { class: 'muted' }, 'Plan one and Carry On makes its list from yours: what the weather, the place and the plans call for, by bag.'),
        h('a', { class: 'btn primary', href: '#/new' }, 'Plan a trip')),
    past.length ? h('section', { class: 'past' },
      h('h2', {}, 'Past trips'),
      h('ul', {}, past.map(t => h('li', {},
        h('a', { href: `#/trip/${t.id}` }, h('b', {}, title(t)), h('span', { class: 'muted' }, D.span(t.start, t.end, t0.slice(0, 4)))),
        h('a', { class: 'again', href: `#/again/${t.id}` }, 'Go again'))))) : null,
  ];
}

const title = t => t.name || t.place?.name || 'Trip';
// A bag by name in a sentence: "the Day bag", but "Electronics".
const theBag = b => (/\b(bag|case|pack|backpack|suitcase|pouch|kit|box|tote|purse)\b/i.test(b.name) ? 'the ' + b.name : b.name);

function tagCard(t) {
  const t0 = today(), n = D.nights(t.start, t.end);
  const p = R.progress(doc(), t), c = R.conditions(doc(), t);
  const now = t.start <= t0;
  const when = now ? `Now · back ${t.end === t0 ? 'today' : D.weekday(t.end)}` : t.start === D.add(t0, 1) ? 'Tomorrow' : `In ${plural(D.num(t.start) - D.num(t0), 'day')}`;
  const w = c.weather, pl = t.place;
  // Under the name: the place and, abroad, its country. A trip named after its place has just the country, or at
  // home the state or region, as the pass has.
  const country = pl?.cc && pl.cc !== R.home(doc()) ? pl.country || countryName(pl.cc) : '';
  const where = (t.name ? [pl?.name, country] : [country || (pl?.admin !== pl?.name ? pl?.admin : '')]).filter(Boolean).join(', ');
  return h('a', { class: 'tag-card' + (now ? ' now' : ''), href: `#/trip/${t.id}` },
    h('span', { class: 'hole', 'aria-hidden': 'true' }),
    h('span', { class: 'when' }, when),
    h('h2', {}, title(t)),
    where ? h('span', { class: 'where' }, where) : null,
    h('span', { class: 'dates' }, `${D.span(t.start, t.end, t0.slice(0, 4))} · ${n ? plural(n, 'night') : 'day trip'} · ${R.CONDITIONS.find(x => x.k === t.travel).icon}`),
    w ? h('span', { class: 'glance' }, `${W.dayIcon(W.tripDays(t.wx, t.start, t.end, t.place)[0])} ${W.temp(w.minLo, c.units)}–${W.temp(w.maxHi, c.units)}${w.rain ? ' · rain' + (w.rainDays.length ? ' likely' : ' some days') : ''}${w.snow ? ' · snow' : ''}`) : null,
    h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: (p.total ? (100 * p.done / p.total) : 0) + '%' } })),
    h('span', { class: 'packed' }, p.done === p.total && p.total ? 'All packed' : `${p.done} of ${p.total} packed`));
}

// ---------- weather lookups ----------

const wxBusy = {}, wxErr = {}, wxTried = {};
function maybeWeather(t, force = false) {
  if (!t.place || t.place.lat === undefined || wxBusy[t.id]) return;
  if (!force && !W.stale(t.wx, t.start, t.end, today(), undefined, t.place)) return;
  if (!force && Date.now() - (wxTried[t.id] || 0) < 60000) return;
  wxTried[t.id] = Date.now();
  wxBusy[t.id] = W.tripWeather(t.place, t.start, t.end, today()).then(wx => {
    delete wxErr[t.id];
    const cur = doc().trips[t.id];
    // Only if the trip still goes there on those days.
    if (cur && cur.start === t.start && cur.end === t.end && cur.place?.lat === t.place.lat) store.apply(d => M.setWx(d, t.id, wx));
  }, e => { wxErr[t.id] = e.message; }).finally(() => { delete wxBusy[t.id]; redraw(); });
}

// A redraw that comes on its own (a forecast arriving, a sync landing, another tab saving). On a trip scrolled down
// to its list, the row in the middle of the screen stays where it is: the forecast's days, chips and rows appearing
// above would otherwise push the list down under a tap that's on its way.
function redraw() {
  if (document.body.dataset.page === 'trip' && scrollY > 0) holdStill(innerHeight / 2, render);
  else render();
}

const ago = t => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function weatherStrip(t, c) {
  const busy = !!wxBusy[t.id], err = wxErr[t.id];
  if (!t.place) {
    return h('section', { class: 'wx none' }, h('p', { class: 'muted small' }, 'No place for this trip, so no forecast. Add one in ', h('a', { href: `#/edit/${t.id}` }, 'Edit'), ', or set the weather by hand under ', h('b', {}, 'Change'), '.'));
  }
  if (t.place.lat === undefined) {
    return h('section', { class: 'wx none' }, h('p', { class: 'muted small' }, 'No weather for this trip: its place wasn’t looked up. Set the weather by hand under ', h('b', {}, 'Change'), ', or pick the place again in ', h('a', { href: `#/edit/${t.id}` }, 'Edit'), '.'));
  }
  const days = W.tripDays(t.wx, t.start, t.end, t.place);
  const fc = days.some(d => !d.typ), ty = days.some(d => d.typ);
  const label = !days.length ? 'Weather' : fc && ty ? 'Forecast, then typical' : fc ? 'Forecast' : 'Typical weather';
  const u = c.units;
  // Each day as a sentence for a screen reader, in place of the short words and numbers shown: "Friday: rain, high
  // 81°, low 63°, 70% chance of rain"; "Saturday, typical for these dates: often wet, high 64°, low 52°".
  // A forecast's chance is of rain or snow (Open-Meteo's chance of precipitation): on a snow day, it's snow.
  const chanceOf = d => (W.snowCode(d.code) ? 'snow' : 'rain');
  const said = d => {
    const words = W.dayWords(d), wet = d.typ ? (d.wet >= 0.3 ? `rain in ${Math.round(d.wet * 100)}% of recent years` : '') : d.pop >= 30 ? `${d.pop}% chance of ${chanceOf(d)}` : '';
    return `${D.weekdayLong(d.d)}${d.typ ? ', typical for these dates' : ''}: ${[words, `high ${W.temp(d.hi, u)}`, `low ${W.temp(d.lo, u)}`, wet].filter(Boolean).join(', ')}`;
  };
  // What the blue % means, which is different on typical days.
  const fcPct = days.filter(d => !d.typ && d.pop >= 30), pctTy = days.some(d => d.typ && d.wet >= 0.3);
  const of = [...new Set(fcPct.map(chanceOf))].sort().join(' or ');
  const pct = fcPct.length && pctTy ? `Blue % is the chance of ${of}, or on the dashed days, how many recent years had rain that day.` : fcPct.length ? `Blue % is the chance of ${of}.` : pctTy ? 'Blue % is how many recent years had rain that day.' : '';
  // Unless typical weather is standing in for a forecast that didn't come back, why there's typical weather at all.
  const typNote = ty && !days.some(d => d.typ && d.d <= W.forecastEdge(today())) ? (fc ? 'Past the forecast, the days show what the same dates were like in recent years.' : 'Too far off for a forecast, so these are the same dates in recent years. It switches to the forecast about two weeks out.') : '';
  return h('section', { class: 'wx' },
    h('div', { class: 'wx-head' },
      h('h2', { id: 'wxHead' }, label),
      h('div', { class: 'wx-at' },
        h('span', { class: 'muted small' }, busy ? 'Looking it up…' : days.length ? 'Updated ' + ago(t.wx.at) : ''),
        // Not disabled while it looks: a disabled button can't keep the focus.
        h('button', { type: 'button', class: 'icon-btn small' + (busy ? ' spin' : ''), 'data-key': 'wx', 'aria-label': 'Look up the weather again', title: 'Look up the weather again', html: ICONS.refresh, 'aria-disabled': busy ? 'true' : null, onclick: () => { if (wxBusy[t.id]) return; maybeWeather(t, true); render(); } }))),
    err ? h('p', { class: 'err small' }, err, ' ', days.length ? 'Showing the last lookup.' : 'You can set the weather by hand under Change.') : null,
    // While the first lookup is on its way, the days' room is kept, so they don't push everything down when they come.
    !days.length && busy ? h('ol', { class: 'wx-days wait', 'aria-hidden': 'true' }) : null,
    days.length ? h('ol', { class: 'wx-days', 'aria-labelledby': 'wxHead' }, days.map(d => h('li', { class: d.typ ? 'typ' : '' },
      h('span', { class: 'sr-only' }, said(d)),
      h('span', { class: 'wd', 'aria-hidden': 'true' }, D.weekday(d.d)),
      h('span', { class: 'wi', 'aria-hidden': 'true' }, W.dayIcon(d)),
      h('span', { class: 'hi', 'aria-hidden': 'true' }, W.temp(d.hi, u)),
      h('span', { class: 'lo', 'aria-hidden': 'true' }, W.temp(d.lo, u)),
      h('span', { class: 'rp', 'aria-hidden': 'true' }, d.typ ? (d.wet >= 0.3 ? `${Math.round(d.wet * 100)}%` : '') : (d.pop >= 30 ? `${d.pop}%` : ''))))) : null,
    days.length && t.wx.err ? h('p', { class: 'muted small' }, t.wx.err) : null,
    typNote || pct ? h('p', { class: 'muted small' }, [typNote, pct].filter(Boolean).join(' ')) : null);
}

// ---------- one trip ----------

let packedSeen = null; // the trip and way of packing last drawn, and whether it was all packed

function tripView(t) {
  maybeWeather(t);
  const t0 = today();
  const mode = store.mode(t.id) || (t0 >= t.end ? 'back' : 'go');
  const p = R.plan(doc(), t, mode), c = p.cond;
  shownTrip = t.id + ':' + mode;
  const complete = p.total > 0 && p.done === p.total;
  // Said once, when a change finishes the packing; never on opening a trip that's packed already.
  if (packedSeen?.key === t.id + mode && !packedSeen.complete && complete) toast(mode === 'go' ? `Everything for ${title(t)} is packed.` : 'All back in the bags. Safe trip home.');
  packedSeen = { key: t.id + mode, complete };
  const n = D.nights(t.start, t.end);
  const onKeys = Object.keys(c.on).filter(k => c.on[k] && R.condInfo(doc(), k));
  const order = k => { const i = R.CONDITIONS.findIndex(x => x.k === k); return i < 0 ? 100 : i; };
  onKeys.sort((a, b) => order(a) - order(b));
  const hide = store.hide;
  return [
    h('a', { class: 'crumb', href: '#/' }, h('span', { html: ICONS.back }), 'Trips'),
    h('section', { class: 'pass' },
      h('div', { class: 'pass-top' },
        h('div', {},
          h('h1', {}, title(t)),
          h('p', { class: 'sub' }, t.place ? (t.name ? W.placeLabel(t.place) : W.placeLabel(t.place).split(', ').slice(1).join(', ')) || '\u00a0' : 'No place set')),
        h('a', { class: 'icon-btn', href: `#/edit/${t.id}`, 'aria-label': 'Edit this trip', title: 'Edit this trip', html: ICONS.edit })),
      h('dl', { class: 'pass-row' },
        h('div', {}, h('dt', {}, 'Leave'), h('dd', {}, D.long(t.start))),
        h('div', {}, h('dt', {}, 'Back'), h('dd', {}, D.long(t.end))),
        h('div', {}, h('dt', {}, 'Nights'), h('dd', {}, String(n))),
        h('div', {}, h('dt', {}, 'By'), h('dd', {}, R.CONDITIONS.find(x => x.k === t.travel).name)))),
    weatherStrip(t, c),
    h('section', { class: 'needs' },
      h('div', { class: 'needs-head' },
        h('h2', {}, 'This trip calls for'),
        h('button', { type: 'button', class: 'btn small', 'data-key': 'conds', onclick: () => condSheet(t.id) }, 'Change')),
      // Each chip opens the sheet at its own row, to see why or to change it.
      h('ul', { class: 'chips' }, onKeys.map(k => {
        const info = R.condInfo(doc(), k), why = c.why[k] && c.why[k] !== info.name ? c.why[k] : '', wid = 'why-' + k.replace(/[^\w-]/g, '_');
        return h('li', {}, h('button', { type: 'button', class: 'chip on', 'data-key': 'chip:' + k, 'aria-label': `${info.name}: change`, 'aria-describedby': why ? wid : null, onclick: () => condSheet(t.id, k) },
          h('span', { 'aria-hidden': 'true' }, info.icon), h('span', {}, h('b', {}, info.name), why ? h('small', { id: wid }, why) : null)));
      }))),
    h('div', { class: 'seg mode', role: 'group', 'aria-label': 'Packing to leave or to come home' },
      h('button', { type: 'button', 'data-key': 'mode:go', 'aria-pressed': String(mode === 'go'), onclick: () => { store.setMode(t.id, 'go'); render(); } }, 'Going'),
      h('button', { type: 'button', 'data-key': 'mode:back', 'aria-pressed': String(mode === 'back'), onclick: () => { store.setMode(t.id, 'back'); render(); } }, 'Coming home')),
    h('div', { class: 'progress' },
      h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: (p.total ? 100 * p.done / p.total : 0) + '%' } })),
      h('p', { class: complete ? 'all' : null }, complete ? h('span', { html: ICONS.check }) : null, h('b', {}, complete ? (mode === 'go' ? 'All packed' : 'All back in the bags') : `${p.done} of ${p.total}`), complete ? '' : mode === 'go' ? ' packed' : ' back in the bags'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', 'data-key': 'hide', checked: hide, onchange: e => { store.hide = e.target.checked; render(); } }), h('span', {}, 'Hide done'))),
    mode === 'back' && !Object.keys(t.marks || {}).some(k => k.startsWith('p:') && t.marks[k].v === 1)
      ? h('p', { class: 'muted small hint' }, 'Nothing was ticked going, so this is everything that was on the list.') : null,
    M.hasList(doc()) ? null : h('p', { class: 'muted small hint' }, 'Your list is empty, so nothing from it is on this trip. ', h('a', { href: '#/' }, 'Start a list'), ' and it fills in.'),
    p.groups.map(g => bagCard(t, g, mode, hide, c.why)),
    M.bags(doc()).some(b => b.kind === 'bag') ? h('button', { type: 'button', class: 'btn add-extra', 'data-key': 'add-extra', onclick: () => extraSheet(t, null, { home: mode === 'back' }) }, h('span', { html: ICONS.plus }), mode === 'go' ? 'Add something for this trip' : 'Add something to bring home') : null,
    p.tasks.map(g => bagCard(t, g, mode, hide, c.why, true)),
    p.left.length || p.leftBags.length ? leftOff(t, p.left, p.leftBags, mode) : null,
  ];
}

// Just after a tick the list holds still for a moment, so the tick shows where it was tapped and a quick next tap
// lands on what was there: a bag the tick finished stays open, and with Hide done on, the ticked row stays. Every
// tap starts the moment again. When it ends, the list closes up around the rows under the finger.
const linger = new Set(); // 'go:BAGID' or 'back:BAGID' for a bag, a row's mark key for a row
let lingerT = null, lingerAt = '';
const LINGER_MS = 1200;

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

function bagCard(t, g, mode, hide, why, jobs = false) {
  const b = g.bag, done = g.rows.filter(r => r.done).length, all = done === g.rows.length;
  const held = linger.has(mode + ':' + b.id);
  const open = !all || held || store.isOpen(t.id + ':' + b.id);
  const rows = g.rows.filter(r => !hide || !r.done || linger.has(r.key));
  const head = h('header', { class: 'bag-head' },
    h('span', { class: 'bag-icon', 'aria-hidden': 'true' }, b.icon),
    h('h2', {}, b.name),
    b.when?.length ? h('span', { class: 'bag-cond' }, b.when.map(k => R.condInfo(doc(), k)?.icon).join('')) : null,
    h('span', { class: 'count' + (all ? ' all' : '') }, all ? h('span', { html: ICONS.check }) : null,
      h('span', { 'aria-hidden': 'true' }, `${done}/${g.rows.length}`), h('span', { class: 'sr-only' }, `${done} of ${g.rows.length} ${jobs ? 'done' : mode === 'go' ? 'packed' : 'back in'}`)),
    b.id !== '_loose' ? h('button', { type: 'button', class: 'icon-btn small', 'data-key': 'bagmore:' + b.id, 'aria-label': `More for ${b.name}`, html: ICONS.more, onclick: () => bagSheet(t, g, mode) }) : null);
  return h('section', { class: 'bag' + (all ? ' all' : '') + (jobs ? ' jobs' : ''), 'data-bag': b.id },
    head,
    b.note && !(b.id === 's-liquids' && t.travel !== 'fly' && b.note === AIRPORT_NOTE) ? h('p', { class: 'bag-note' }, b.note) : null,
    all && !open
      ? h('button', { type: 'button', class: 'bag-done', 'data-key': 'fold:' + b.id, onclick: () => { store.setOpen(t.id + ':' + b.id, true); render(); } }, jobs ? `All ${plural(g.rows.length, 'job')} done` : mode === 'go' ? `All ${g.rows.length} packed` : `All ${g.rows.length} back in`, h('span', { class: 'muted' }, ' · show'))
      : rows.length ? h('ul', { class: 'rows' }, rows.map(r => itemRow(t, g, r, mode, why, jobs, hide))) : h('p', { class: 'muted small pad' }, 'All done here.'),
    all && open && !held ? h('button', { type: 'button', class: 'bag-done', 'data-key': 'fold:' + b.id, onclick: () => { store.setOpen(t.id + ':' + b.id, false); render(); } }, 'Fold it up') : null);
}

function itemRow(t, g, r, mode, whyMap, jobs, hide) {
  const toggle = () => {
    const was = (t.marks?.[r.key]?.v || 0) > 0;
    store.apply(d => M.mark(d, t.id, r.key, was ? 0 : 1));
    const bag = mode + ':' + g.bag.id;
    if (was) { linger.delete(r.key); linger.delete(bag); } else {
      if (hide) linger.add(r.key);
      if (g.rows.every(x => x === r || x.done)) linger.add(bag);
    }
    clearTimeout(lingerT);
    lingerT = linger.size ? setTimeout(settle, LINGER_MS) : null;
    lingerAt = r.key;
    render();
  };
  // A screen reader hears the tick by its name and how many ("Socks, 5"), then the lines under it, without the
  // conditions' pictures.
  const id = 'r_' + r.key.replace(/[^\w-]/g, '_'), lines = [];
  const line = (cls, ...text) => { const n = `${id}_${lines.length}`; lines.push(n); return h('small', { id: n, class: cls }, ...text); };
  const why = r.hits.map(k => { const info = R.condInfo(doc(), k); return info ? [h('span', { 'aria-hidden': 'true' }, info.icon), ' ', whyMap[k] || info.name] : null; }).filter(Boolean);
  const under = [
    r.gone ? line(null, 'Not coming back') : null,
    r.note ? line(null, r.note) : null,
    why.length ? line('why', why.flatMap((w, i) => (i ? [' · ', ...w] : w))) : null,
    r.capped ? line('why', `One a day, up to ${R.laundry(doc())}: laundry after that`) : null,
    r.packedOnly ? line('why', 'Packed, though the trip no longer calls for it') : null,
    r.added ? line('why', 'Added for this trip') : null,
    r.moved ? line('why', 'In this bag for this trip') : null,
    r.extra ? line('why', 'Just for this trip') : null,
    r.deleted ? line('why', 'No longer on your list') : null,
  ];
  return h('li', { class: 'row' + (r.done ? ' done' : '') + (r.gone ? ' gone' : '') },
    h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(r.done), 'data-key': r.key, 'aria-label': r.qty > 1 ? `${r.name}, ${r.qty}` : r.name, 'aria-describedby': lines.join(' ') || null, onclick: toggle },
      h('span', { class: 'box', html: ICONS.check }),
      h('span', { class: 'what' },
        h('span', { class: 'name' }, r.name, r.qty > 1 ? h('span', { class: 'qty' }, ' ×' + r.qty) : null),
        under)),
    jobs && mode === 'back' ? null : h('button', { type: 'button', class: 'icon-btn more', 'data-key': 'more:' + r.key, 'aria-label': `More for ${r.name}`, html: ICONS.more, onclick: () => itemSheet(t, r, mode, jobs) }));
}

function leftOff(t, left, leftBags, mode) {
  const open = store.isOpen(t.id + ':left');
  // Packed, brought or put back: it says where on the list it went, since that's usually off screen.
  const put = (id, skipped, name) => {
    const was = t.marks?.['x:' + id]?.v;
    apply(d => M.mark(d, t.id, 'x:' + id, skipped ? 0 : 'add'));
    const p = R.plan(doc(), doc().trips[t.id], mode);
    const g = [...p.groups, ...p.tasks].find(x => x.bag.id === id || x.rows.some(r => r.id === id));
    const still = !g && (p.left.find(l => l.item.id === id) || p.leftBags.find(l => l.bag.id === id));
    toast(still ? `${name} is still off: ${still.why.charAt(0).toLowerCase() + still.why.slice(1)}.` : g && g.bag.id !== id ? `${name} is on the list, in ${theBag(g.bag)}.` : `${name} is on the list.`,
      { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'x:' + id, was || 0)) });
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
          h('small', {}, `${plural(l.count, l.bag.kind === 'bag' ? 'thing' : 'job')} · ${l.why}`)),
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
          h('button', { type: 'button', class: 'btn', onclick: () => { done(); apply(d => M.mark(d, t.id, r.key, gone ? 0 : 2)); } }, gone ? 'It’s coming back after all' : 'Not bringing it back'))];
    }
    const bagsList = M.bags(doc()).filter(b => b.kind === 'bag');
    const cur = t.marks?.['b:' + id]?.v || (r.extra ? t.extras[id].bag : doc().items[id]?.bag);
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
  const bagsList = M.bags(doc()).filter(b => b.kind === 'bag');
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
  const draw = () => {
    const t = doc().trips[id];
    const c = R.conditions(doc(), t);
    sheet('What this trip calls for', () => [
      h('h3', {}, 'What’s on'),
      h('div', { class: 'chips pick' }, M.tags(doc()).map(g => {
        const on = !!t.set?.[g.id]?.v;
        return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'data-key': 'tag:' + g.id, 'data-k': g.id, 'aria-pressed': String(on), onclick: () => { store.apply(d => M.setCond(d, id, g.id, on ? null : true)); draw(); render(); } }, `${g.icon} ${g.name}`);
      })),
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
        const autoText = c.auto[k] === undefined ? 'unknown' : c.auto[k] ? 'yes' : 'no';
        const pickState = s => { store.apply(d => M.setCond(d, id, k, s === 'auto' ? null : s === 'on')); draw(); render(); };
        return h('li', { 'data-k': k },
          h('span', { class: 'auto-name' }, h('span', { 'aria-hidden': 'true' }, info.icon), ' ', h('b', {}, info.name),
            h('small', { id: 'auto-' + k }, `Automatic: ${autoText}${c.auto[k] && c.why[k] ? ` · ${c.why[k]}` : c.auto[k] === false && c.no[k] ? ` · ${c.no[k]}` : ''}`)),
          h('div', { class: 'seg tiny', role: 'group', 'aria-label': info.name, 'aria-describedby': 'auto-' + k },
            ['auto', 'on', 'off'].map(s => h('button', { type: 'button', 'data-key': `cond:${k}:${s}`, 'aria-pressed': String(state === s), onclick: () => pickState(s) }, s === 'auto' ? 'Auto' : s === 'on' ? 'Yes' : 'No'))));
      })),
      h('p', { class: 'small' }, h('a', { href: '#/list', onclick: closeSheet }, 'Change the occasions in My list')),
    ], { wide: true });
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

function tripForm(t, again = false) {
  const editing = t && !again;
  const key = (editing ? 'edit/' : again ? 'again/' : 'new/') + (t ? t.id : '');
  if (draft?.key !== key) draft = { key, results: [], searchErr: '', typed: '', err: '' };
  const dr = draft;
  const st = {
    place: t?.place || null, start: editing ? t.start : '', end: editing ? t.end : '', travel: t?.travel || 'fly', name: t?.name || '',
    tags: new Set(Object.entries(t?.set || {}).filter(([k, m]) => m.v === true && doc().tags[k]).map(([k]) => k)),
  };
  for (const k of Object.keys(st)) if (k in dr) st[k] = dr[k];
  const errBox = h('p', { class: 'err', role: 'alert' }, dr.err);
  const err = msg => { errBox.textContent = dr.err = msg; };
  // Any change to the form answers what the last tap on Make my list asked.
  const set = (k, v) => { st[k] = dr[k] = v; if (dr.err) err(''); };
  const where = h('div', { class: 'where-field' });
  const input = h('input', { type: 'search', id: 'where', value: dr.typed, placeholder: 'A city or town', autocomplete: 'off', enterkeyhint: 'search', 'aria-describedby': 'whereHelp' });
  // A plain list of buttons, and a line under the box that says what the search found, which a screen reader reads out.
  const list = h('ul', { class: 'results', 'aria-label': 'Places' });
  const status = h('p', { class: 'where-status small', role: 'status' });
  const drawWhere = () => {
    if (st.place) {
      where.replaceChildren(h('div', { class: 'picked' },
        h('span', {}, h('b', {}, st.place.name), ' ', h('span', { class: 'muted' }, [st.place.admin, st.place.country].filter(Boolean).join(', '))),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Pick another place', html: ICONS.close, onclick: () => { set('place', null); drawWhere(); input.focus(); } })));
      return;
    }
    list.replaceChildren(...dr.results.map(r => h('li', {}, h('button', { type: 'button', onclick: () => choose(r) },
      h('b', {}, r.name), ' ', h('span', { class: 'muted' }, [r.admin, r.country].filter(Boolean).join(', '))))));
    const typed = input.value.trim();
    const failed = dr.searchErr && typed && dr.searchErr !== NO_PLACES;
    status.className = 'where-status small ' + (failed ? 'err' : 'muted');
    status.textContent = !typed ? '' : failed && single ? 'This copy can’t reach the weather service. Use what you typed and set the weather by hand, or open carry-on.junkdrawer.works for the forecast.'
      : dr.searchErr || (dr.results.length ? plural(dr.results.length, 'place') : '');
    // Last, once the search has answered for what's typed, the way through without a lookup: offline, or for a place
    // the search doesn't know. (Not before, so it isn't where the first place lands when the places come.)
    if (typed && ((typed.length > 1 && dr.q === input.value) || dr.err)) list.append(h('li', {}, h('button', { type: 'button', onclick: () => choose({ name: input.value.trim(), admin: '', country: '', cc: '' }) }, `Use “${typed}” without looking it up`)));
    // Put back only when coming back from a picked place: taking the box out of the page, even to put it straight
    // back, takes the cursor out of it.
    if (input.parentNode !== where) where.replaceChildren(input, status, list);
  };
  const choose = r => { set('place', r); dr.results = []; drawWhere(); };
  // A search that answers after a redraw shows on the form that's there now.
  dr.drawWhere = drawWhere;
  dr.choose = choose;
  // dr.q is what the search last answered for. Enter while that's something else waits for the new places.
  const search = q => {
    clearTimeout(dr.timer);
    if (dr.ctl) dr.ctl.abort();
    const ctl = dr.ctl = new AbortController();
    W.searchPlaces(q, { signal: ctl.signal }).then(r => {
      dr.results = r; dr.q = q; dr.searchErr = q.trim().length > 1 && !r.length ? NO_PLACES : '';
      if (dr.enter && r.length) dr.choose(r[0]); else dr.drawWhere();
      dr.enter = false;
    }, e => { if (e.name !== 'AbortError') { dr.enter = false; dr.results = []; dr.q = q; dr.searchErr = e.message; dr.drawWhere(); } });
  };
  input.addEventListener('input', () => {
    dr.typed = input.value;
    dr.enter = false;
    clearTimeout(dr.timer);
    if (dr.ctl) dr.ctl.abort();
    const q = input.value;
    // Too short to look up: nothing to show.
    if (q.trim().length < 2) Object.assign(dr, { results: [], searchErr: '', q });
    else dr.timer = setTimeout(() => search(q), 300);
    drawWhere();
  });
  // Enter picks the first place.
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (dr.q === input.value) { if (dr.results.length) choose(dr.results[0]); } else if (input.value.trim().length > 1) { dr.enter = true; search(input.value); }
  });
  drawWhere();
  const startIn = h('input', { type: 'date', id: 'start', value: st.start, min: editing ? null : D.add(today(), -30), required: true, oninput: e => set('start', e.target.value), onchange: e => { set('start', e.target.value); if (!st.end || st.end < st.start) { set('end', st.start); endIn.value = st.end; } } });
  const endIn = h('input', { type: 'date', id: 'end', value: st.end, required: true, oninput: e => set('end', e.target.value), onchange: e => set('end', e.target.value) });
  const nameIn = h('input', { type: 'text', id: 'name', value: st.name, maxlength: 60, placeholder: 'Sam’s wedding', autocomplete: 'off', oninput: e => set('name', e.target.value) });
  const save = () => {
    st.start = startIn.value; st.end = endIn.value;
    if (!st.place && input.value.trim()) { err('Pick a place from the list, or use what you typed.'); drawWhere(); return; }
    // No place at all is allowed, once it's been said what that leaves out.
    if (!st.place && !dr.placeless && !(editing && !t.place)) { dr.placeless = true; err(`Where to? Without a place there’s no forecast and no passport check. Tap ${editing ? 'Save' : 'Make my list'} again to go without one.`); return; }
    if (!st.start || !st.end) { err('When do you leave, and when are you back?'); return; }
    if (st.end < st.start) { err('You’re back before you leave. Check the dates.'); return; }
    if (D.nights(st.start, st.end) > 90) { err('That’s more than 90 nights. Check the dates.'); return; }
    const id = editing ? t.id : M.newId('t');
    const moved = editing && (t.start !== st.start || t.end !== st.end || t.place?.lat !== st.place?.lat || t.place?.name !== st.place?.name);
    applyCounting(d => {
      let next = M.putTrip(d, { id, place: st.place, start: st.start, end: st.end, travel: st.travel, name: nameIn.value.trim() });
      for (const g of M.tags(d)) {
        const was = !!d.trips[id]?.set?.[g.id]?.v, now = st.tags.has(g.id);
        if (was !== now) next = M.setCond(next, id, g.id, now ? true : null);
      }
      if (moved) next = M.clearWx(next, id);
      return next;
    });
    draft = null;
    if (moved || !editing) delete wxTried[id];
    // Back to the trip, as if Back was pressed, when that's where Edit was opened from; otherwise the trip takes the
    // form's place, so Back from it doesn't open the form again.
    if (editing && history.state?.from === `#/trip/${id}`) history.back();
    else go(`#/trip/${id}`, { replace: true });
  };
  return [
    h('a', { class: 'crumb', href: editing ? `#/trip/${t.id}` : '#/', onclick: e => { if (editing && history.state?.from === `#/trip/${t.id}`) { e.preventDefault(); history.back(); } } }, h('span', { html: ICONS.back }), editing ? title(t) : 'Trips'),
    h('h1', {}, editing ? 'Edit trip' : again ? `${title(t)} again` : 'Plan a trip'),
    h('section', { class: 'card form' },
      h('div', { class: 'field' }, h('label', { for: 'where' }, 'Where to?'), where,
        h('small', { id: 'whereHelp', class: 'muted' }, 'For the forecast, and to know if it’s abroad.')),
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
          } }, `${g.icon} ${g.name}`);
          return b;
        }))),
      h('div', { class: 'field' }, h('label', { for: 'name' }, 'Name it ', h('span', { class: 'muted' }, '(if you like)')), nameIn),
      errBox,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary big', onclick: save }, editing ? 'Save' : 'Make my list'))),
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

// "Only when ☔ rain's likely", "Only when 🌡️ it's hot or for 🏊 swimming", "Not when 🚗 you're driving".
function condChips(x) {
  const icon = (i, words) => [h('span', { 'aria-hidden': 'true' }, i.icon), ' ', words];
  const when = R.whenParts(doc(), x.when, icon), unless = R.whenParts(doc(), x.unless, icon);
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
    kinds.map(([kind, label]) => {
      const bs = all.filter(b => b.kind === kind);
      return [
        kind !== 'bag' ? h('h2', { class: 'kind-head' }, label) : null,
        bs.map(b => listBag(b)),
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
      h('h2', {}, b.name),
      h('button', { type: 'button', class: 'btn small', 'data-key': 'bagmore:' + b.id, onclick: () => bagEditor(b), 'aria-label': `Change ${b.name}` }, 'Change')),
    condChips(b) ? h('p', { class: 'bag-note' }, condChips(b)) : null,
    b.note ? h('p', { class: 'bag-note' }, b.note) : null,
    h('ul', { class: 'rows' }, its.map(x => h('li', { class: 'row' },
      h('button', { type: 'button', class: 'edit-row', 'data-key': 'item:' + x.id, onclick: () => itemEditor(x) },
        h('span', { class: 'name' }, x.name, x.per === 'day' ? h('span', { class: 'qty' }, ' · one a day') : x.qty > 1 ? h('span', { class: 'qty' }, ' ×' + x.qty) : null),
        x.note ? h('small', {}, x.note) : null,
        condChips(x) ? h('small', { class: 'why' }, condChips(x)) : null)))),
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

function itemEditor(x, bagId) {
  const isNew = !x;
  const bagsAll = M.bags(doc());
  const bag0 = x?.bag || bagId || bagsAll[0]?.id;
  const when = new Set(x?.when || []), unless = new Set(x?.unless || []);
  let name, bag, qty, note, mode;
  sheet(isNew ? 'Add a thing' : x.name, close => {
    const whenBox = h('div', { hidden: !when.size }, condPicker(when));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const q = qty.value;
      const fields = { id: x?.id, name: n, bag: bag.value, note: note.value.trim(), when: mode.value === 'some' ? [...when] : [], unless: [...unless], per: q === 'day' ? 'day' : '', qty: q === 'day' ? 1 : +q };
      close();
      applyCounting(d => M.putItem(d, fields));
      render();
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: x?.name || '', maxlength: 80, autofocus: isNew, autocomplete: 'off' })),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'Bag'), bag = h('select', {}, bagsAll.map(b => h('option', { value: b.id, selected: b.id === bag0 }, `${b.icon} ${b.name}`)))),
        h('label', { class: 'field' }, h('span', {}, 'How many'), qty = h('select', {},
          [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: x?.per !== 'day' && (x?.qty || 1) === n }, n === 1 ? 'Just one' : String(n))),
          h('option', { value: 'day', selected: x?.per === 'day' }, `One for each day (up to ${R.laundry(doc())})`)))),
      h('label', { class: 'field' }, h('span', {}, 'Bring it'), mode = h('select', { onchange: e => { whenBox.hidden = e.target.value !== 'some'; } },
        h('option', { value: 'all', selected: !when.size }, 'On every trip'),
        h('option', { value: 'some', selected: !!when.size }, 'Only when the trip calls for…'))),
      whenBox,
      h('details', { class: 'unless', open: unless.size > 0 },
        h('summary', {}, 'Leave it home when…'),
        condPicker(unless)),
      h('label', { class: 'field' }, h('span', {}, 'Note'), note = h('input', { type: 'text', value: x?.note || '', maxlength: 140, placeholder: 'Shows under it on the list', autocomplete: 'off' })),
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

function bagEditor(b) {
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
      close();
      apply(d => M.putBag(d, { id: b?.id, name: n, kind: kind.value, icon: iconPick || bagIcon(n, kind.value), note: note.value.trim(), when: [...when], unless: [...unless] }));
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

function tagEditor(g) {
  const isNew = !g;
  let name, iconPick = g?.icon || '🏷️';
  sheet(isNew ? 'Add an occasion' : `${g.icon} ${g.name}`, close => {
    const icons = h('div', { class: 'icon-pick', role: 'group', 'aria-label': 'Icon' }, TAG_ICONS.map(i => {
      const btn = h('button', { type: 'button', 'aria-pressed': String(i === iconPick), onclick: () => { iconPick = i; icons.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === btn))); } }, i);
      return btn;
    }));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      close();
      apply(d => M.putTag(d, { id: g?.id, name: n, icon: iconPick }));
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: g?.name || '', maxlength: 30, autofocus: true, autocomplete: 'off', placeholder: 'Wedding' })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), icons),
      h('div', { class: 'sheet-actions' },
        isNew ? null : h('button', { type: 'button', class: 'btn danger-quiet', onclick: () => { close(); apply(d => M.removeTag(d, g.id)); toast(`${g.name} deleted.`); } }, 'Delete'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add it' : 'Save')),
    ];
  });
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
function offerList(list, title, { back = null, link = false } = {}) {
  const has = M.hasList(doc());
  let chose = false;
  // With no trips yet, the toast leads on to planning one. Undo comes first, after using a list instead of one.
  const onward = () => (M.trips(doc()).length ? undefined : { label: 'Plan a trip', run: () => go('#/new') });
  const replace = close => {
    chose = true;
    close();
    let before = null;
    const done = store.apply(d => M.replaceList(before = d, list));
    toast('Your list is in.', has ? { label: 'Undo', run: () => apply(d => M.undoReplace(d, before, done)) } : onward());
    go('#/list');
  };
  const add = close => {
    chose = true;
    close();
    let was = null;
    const now = store.apply(d => M.addList(was = d, list));
    toast(added(was, now), onward());
    go('#/list');
  };
  const occasions = list.tags.map(g => g.name);
  sheet(title, close => [
    link ? h('p', { class: 'muted small' }, 'It becomes your own copy on this phone. Change anything; theirs stays as it is. Their trips don’t come with it.') : null,
    h('p', {}, listSummary(list)),
    list.bags.length ? h('ul', { class: 'preview' }, list.bags.map(b => h('li', {}, h('span', { 'aria-hidden': 'true' }, b.icon), ' ', h('b', {}, b.name), ' ',
      h('span', { class: 'muted' }, list.items.filter(x => x.bag === b.id).map(x => x.name).slice(0, 6).join(', ') + (list.items.filter(x => x.bag === b.id).length > 6 ? '…' : ''))))) : null,
    occasions.length ? h('p', { class: 'small' }, occasions.length === 1 ? `With the occasion ${occasions[0]}` : `With ${occasions.length} occasions: ${occasions.join(', ')}`) : null,
    back ? guessLine(list) : null,
    h('div', { class: 'stack' },
      has ? h('button', { type: 'button', class: 'btn primary', onclick: () => add(close) }, 'Add it to my list') : null,
      h('button', { type: 'button', class: has ? 'btn' : 'btn primary', onclick: () => replace(close) }, has ? 'Use it instead of my list' : 'Use this list'),
      has ? h('p', { class: 'muted small' }, 'Using it instead keeps your trips. Their ticks still count for things on both lists.') : null,
      back ? h('button', { type: 'button', class: 'btn quiet', onclick: () => { chose = true; close(); back(); } }, 'Back') : null),
  ], { wide: true, done: link ? () => { if (!chose) toast('That list wasn’t added. Open the link again to see it.'); } : undefined });
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

let homeKeyed = false, homeT = null;
function settingsView() {
  clearTimeout(homeT);
  const d = doc(), home = R.home(d), u = R.units(d), l = R.laundry(d);
  const homeSet = !!M.pref(d, 'home', '');
  const countries = Object.keys(PLUGS).map(cc => [cc, countryName(cc)]).sort((a, b) => a[1].localeCompare(b[1]));
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
  let file;
  return [
    h('a', { class: 'crumb', href: '#/' }, h('span', { html: ICONS.back }), 'Trips'),
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('section', { class: 'card' },
      h('h2', {}, 'Home'),
      h('label', { class: 'field' }, h('span', {}, 'You live in'),
        h('select', {
          'data-key': 'home',
          onpointerdown: () => { homeKeyed = false; },
          onkeydown: e => { if (e.key.length === 1 || /^(Arrow|Home$|End$|Page)/.test(e.key)) homeKeyed = true; },
          onchange: e => {
            store.apply(x => M.setPref(x, 'home', e.target.value));
            // Typed into ("por" for Portugal), it waits for the typing to stop before the page is drawn again: a new
            // picker wouldn't get the letters after the first.
            clearTimeout(homeT);
            if (homeKeyed) homeT = setTimeout(render, 1000); else render();
          } }, countries.map(([cc, n]) => h('option', { value: cc, selected: cc === home }, n)))),
      h('p', { class: 'muted small' }, homeSet ? 'Trips anywhere else count as abroad, and plug adapters are worked out from home’s plugs.' : 'Guessed from this browser’s language settings. Trips anywhere else count as abroad.')),
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
      h('p', { class: 'muted small' }, 'A file with your list and trips, to keep or to bring to another browser. Restoring adds what’s in it; nothing here is lost.'),
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
      h('p', { class: 'small' }, 'Forecasts, past weather and place search come from ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'), '. Looking up a trip sends its place and dates there; nothing else leaves this browser unless you turn on Google Drive. Plug types are from the IEC’s list of world plugs.'),
      // Every rule in weather.js summarize(), with no break between a number and its unit.
      h('p', { class: 'small muted' }, 'Hot means a high of 28\u00a0°C (82\u00a0°F) or more; cool, a low of 13\u00a0°C (55\u00a0°F) or less; cold, a low of 4\u00a0°C (39\u00a0°F) or less, or highs that average 10\u00a0°C (50\u00a0°F) or less. Rain means a 50% chance of rain or more, or 3\u00a0mm (0.1\u00a0in) or more, on any day; for typical weather, rain on 3 days in 10. Snow means 0.5\u00a0cm (0.2\u00a0in) or more on any day; for typical weather, snow on 3 days in 20. Strong sun means a UV index of 6 or more; for typical weather, it’s estimated from how much sunshine those days had.')),
    h('div', { class: 'danger-zone' }, confirmBtn('Erase everything on this device', 'Tap again to erase it all', () => {
      drive.stop();
      store.erase();
      go('#/');
      toast('Erased.');
    })),
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();

if ('serviceWorker' in navigator && !single && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

// For the tests and the screenshots.
window.carryOn = { store, M, R, D, render };
