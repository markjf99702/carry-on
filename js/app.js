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
import { h, ICONS, toast, sheet, closeSheet, setupSheet, confirmBtn } from './ui.js';

export const SITE = 'https://carry-on.junkdrawer.works/';
const main = document.getElementById('app');
const single = document.documentElement.hasAttribute('data-single');
const doc = () => store.doc;
const today = () => D.today();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const BAG_ICONS = ['🧳', '🧴', '🪥', '💊', '🔌', '🛂', '👜', '🎒', '👕', '👟', '💼', '🧸', '🍼', '📷', '🎮', '⛳', '🏕️', '🎿', '🏖️', '🐶', '📚', '🍫', '🏠', '🏨'];
const TAG_ICONS = ['🏷️', '💼', '🏋️', '🏊', '👔', '🥾', '💍', '🎉', '⛳', '🎿', '🏕️', '👶', '🐶', '🎭', '🏖️', '🎸', '🚴', '🎣'];

// ---------- drawing ----------

let current = '';
// What's been changed on Plan a trip, Edit trip or Go again but not saved yet. The page redraws underneath it
// (back from another app, a forecast arriving, a sync landing, another tab saving), and the form is rebuilt from
// this. It holds only what was changed, so the rest still follows the trip, and it goes when the screen changes,
// on Save and on Delete.
let draft = null;
function render() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#list=')) { takeLink(hash.slice(6)); return; }
  const [, page = '', id = ''] = hash.slice(1).split('/');
  const screen = page + '/' + id, moved = screen !== current;
  if (moved) { draft = null; packedSeen = null; linger.clear(); clearTimeout(lingerT); lingerT = null; }
  // Focus, where the cursor was in a text box, and anything half-typed in an add box come through the redraw.
  const was = document.activeElement;
  const key = was?.dataset?.key, fid = !moved && !key && main.contains(was) ? was.id : '';
  const caret = was?.selectionStart != null ? [was.selectionStart, was.selectionEnd] : null;
  const typed = moved ? [] : [...main.querySelectorAll('input[data-key]')].filter(x => x.value).map(x => [x.dataset.key, x.value]);
  const nodes = view(page, decodeURIComponent(id));
  main.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  for (const [k, v] of typed) { const x = main.querySelector(`input[data-key="${CSS.escape(k)}"]`); if (x && !x.value) x.value = v; }
  if (moved) { current = screen; window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  const back = key ? main.querySelector(`[data-key="${CSS.escape(key)}"]`) : fid ? main.querySelector('#' + CSS.escape(fid)) : null;
  if (back) {
    back.focus({ preventScroll: true });
    if (caret && back.setSelectionRange) try { back.setSelectionRange(...caret); } catch { /* not a text box */ }
  }
  document.body.dataset.page = page || 'home';
}

function view(page, id) {
  if (!M.hasList(doc()) && page !== 'settings') return welcome();
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
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
const apply = fn => { store.apply(fn); render(); };

// ---------- the first screen ----------

function welcome() {
  return h('section', { class: 'welcome' },
    h('p', { class: 'kicker' }, 'Packing list'),
    h('h1', {}, 'Pack for the trip you’re actually taking.'),
    h('p', { class: 'lede' }, 'Keep everything you might pack in one list, sorted by bag. Each trip gets its own fresh copy, matched to the forecast, where you’re going and what you’ll be doing. There’s nothing to uncheck afterwards.'),
    h('ul', { class: 'how' },
      h('li', {}, h('b', {}, 'Sorted by bag. '), 'Pack the liquids bag, then the backpack, then the suitcase.'),
      h('li', {}, h('b', {}, 'Knows the weather. '), 'The umbrella comes along when rain is forecast. The coat comes when it’s cold.'),
      h('li', {}, h('b', {}, 'Knows where you’re going. '), 'Abroad, it adds your passport, plus a plug adapter if the sockets there are different.'),
      h('li', {}, h('b', {}, 'Coming home too. '), 'A second pass makes sure nothing stays behind at the hotel.')),
    h('div', { class: 'choices' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => { store.apply(d => M.startWith(d, starterList())); toast('Starter list in. Change anything in My list.'); go('#/'); } }, 'Start with a starter list'),
      h('button', { type: 'button', class: 'btn big', onclick: pasteSheet }, 'Paste my own list'),
      drive.ready ? h('a', { class: 'btn big', href: '#/settings' }, 'Bring my list from Google Drive') : null),
    h('p', { class: 'small muted' }, 'Pasting works with a list copied from Google Keep, Notes or a document. Put each bag’s things under its name.'));
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

function tagCard(t) {
  const t0 = today(), n = D.nights(t.start, t.end);
  const p = R.progress(doc(), t), c = R.conditions(doc(), t);
  const now = t.start <= t0;
  const when = now ? `Now · back ${D.weekday(t.end)}` : t.start === D.add(t0, 1) ? 'Tomorrow' : `In ${plural(D.num(t.start) - D.num(t0), 'day')}`;
  const w = c.weather;
  return h('a', { class: 'tag-card' + (now ? ' now' : ''), href: `#/trip/${t.id}` },
    h('span', { class: 'hole', 'aria-hidden': 'true' }),
    h('span', { class: 'when' }, when),
    h('h2', {}, title(t)),
    h('span', { class: 'where' }, [t.name && t.place ? t.place.name : '', t.place?.cc && t.place.cc !== R.home(doc()) ? (t.place.country || countryName(t.place.cc)) : ''].filter(Boolean).join(', ') || ' '),
    h('span', { class: 'dates' }, `${D.span(t.start, t.end, t0.slice(0, 4))} · ${n ? plural(n, 'night') : 'day trip'} · ${R.CONDITIONS.find(x => x.k === t.travel).icon}`),
    w ? h('span', { class: 'glance' }, `${W.dayIcon(t.wx.days[0])} ${W.temp(w.minLo, c.units)}–${W.temp(w.maxHi, c.units)}${w.rain ? ' · rain' + (w.rainDays.length ? ' likely' : ' some days') : ''}${w.snow ? ' · snow' : ''}`) : null,
    h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: (p.total ? (100 * p.done / p.total) : 0) + '%' } })),
    h('span', { class: 'packed' }, p.done === p.total && p.total ? 'All packed' : `${p.done} of ${p.total} packed`));
}

// ---------- weather lookups ----------

const wxBusy = {}, wxErr = {}, wxTried = {};
function maybeWeather(t, force = false) {
  if (!t.place || t.place.lat === undefined || wxBusy[t.id]) return;
  if (!force && !W.stale(t.wx, t.start, t.end, today())) return;
  if (!force && Date.now() - (wxTried[t.id] || 0) < 60000) return;
  wxTried[t.id] = Date.now();
  wxBusy[t.id] = W.tripWeather(t.place, t.start, t.end, today()).then(wx => {
    delete wxErr[t.id];
    const cur = doc().trips[t.id];
    // Only if the trip still goes there on those days.
    if (cur && cur.start === t.start && cur.end === t.end && cur.place?.lat === t.place.lat) store.apply(d => M.setWx(d, t.id, wx));
  }, e => { wxErr[t.id] = e.message; }).finally(() => { delete wxBusy[t.id]; render(); });
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
  if (!t.place || t.place.lat === undefined) {
    return h('section', { class: 'wx none' }, h('p', { class: 'muted small' }, 'No weather for this trip: its place wasn’t looked up. Set the weather by hand under ', h('b', {}, 'Change'), ', or pick the place again in ', h('a', { href: `#/edit/${t.id}` }, 'Edit'), '.'));
  }
  const days = t.wx?.days || [];
  const fc = days.some(d => !d.typ), ty = days.some(d => d.typ);
  const label = !days.length ? 'Weather' : fc && ty ? 'Forecast, then typical weather' : fc ? 'Forecast' : 'Typical weather for these days';
  const u = c.units;
  return h('section', { class: 'wx' },
    h('div', { class: 'wx-head' },
      h('h2', {}, label),
      h('span', { class: 'muted small' }, busy ? 'Looking it up…' : t.wx ? 'Updated ' + ago(t.wx.at) : ''),
      h('button', { type: 'button', class: 'icon-btn small' + (busy ? ' spin' : ''), 'aria-label': 'Look up the weather again', title: 'Look up the weather again', html: ICONS.refresh, disabled: busy, onclick: () => { maybeWeather(t, true); render(); } })),
    err ? h('p', { class: 'err small' }, err, ' ', t.wx ? 'Showing the last lookup.' : 'You can set the weather by hand under Change.') : null,
    days.length ? h('ol', { class: 'wx-days' }, days.map(d => h('li', { class: d.typ ? 'typ' : '' },
      h('span', { class: 'wd' }, D.weekday(d.d)),
      h('span', { class: 'wi', 'aria-hidden': 'true' }, W.dayIcon(d)),
      h('span', { class: 'hi' }, W.temp(d.hi, u)),
      h('span', { class: 'lo' }, W.temp(d.lo, u)),
      h('span', { class: 'rp' }, d.typ ? (d.wet >= 0.3 ? `${Math.round(d.wet * 100)}%` : '') : (d.pop >= 30 ? `${d.pop}%` : ''))))) : null,
    ty && days.length ? h('p', { class: 'muted small' }, fc ? 'Past the forecast, the days show what the same dates were like in recent years.' : 'Too far off for a forecast, so these are the same dates in recent years. It switches to the forecast about two weeks out.') : null);
}

// ---------- one trip ----------

let packedSeen = null; // the trip and way of packing last drawn, and whether it was all packed

function tripView(t) {
  maybeWeather(t);
  const t0 = today();
  const mode = store.mode(t.id) || (t0 >= t.end ? 'back' : 'go');
  const p = R.plan(doc(), t, mode), c = p.cond;
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
        h('button', { type: 'button', class: 'btn small', onclick: () => condSheet(t.id) }, 'Change')),
      h('ul', { class: 'chips' }, onKeys.map(k => {
        const info = R.condInfo(doc(), k);
        return h('li', { class: 'chip on' }, h('span', { 'aria-hidden': 'true' }, info.icon), h('span', {}, h('b', {}, info.name), c.why[k] && c.why[k] !== info.name ? h('small', {}, c.why[k]) : null));
      }))),
    h('div', { class: 'seg mode', role: 'group', 'aria-label': 'Packing to leave or to come home' },
      h('button', { type: 'button', 'aria-pressed': String(mode === 'go'), onclick: () => { store.setMode(t.id, 'go'); render(); } }, 'Going'),
      h('button', { type: 'button', 'aria-pressed': String(mode === 'back'), onclick: () => { store.setMode(t.id, 'back'); render(); } }, 'Coming home')),
    h('div', { class: 'progress' },
      h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: (p.total ? 100 * p.done / p.total : 0) + '%' } })),
      h('p', { class: complete ? 'all' : null }, complete ? h('span', { html: ICONS.check }) : null, h('b', {}, complete ? (mode === 'go' ? 'All packed' : 'All back in the bags') : `${p.done} of ${p.total}`), complete ? '' : mode === 'go' ? ' packed' : ' back in the bags'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: hide, onchange: e => { store.hide = e.target.checked; render(); } }), h('span', {}, 'Hide done'))),
    mode === 'back' && !Object.keys(t.marks || {}).some(k => k.startsWith('p:') && t.marks[k].v === 1)
      ? h('p', { class: 'muted small hint' }, 'Nothing was ticked going, so this is everything that was on the list.') : null,
    p.groups.map(g => bagCard(t, g, mode, hide, c.why)),
    mode === 'go' ? h('button', { type: 'button', class: 'btn add-extra', onclick: () => extraSheet(t) }, h('span', { html: ICONS.plus }), 'Add something for this trip') : null,
    p.tasks.map(g => bagCard(t, g, mode, hide, c.why, true)),
    p.left.length || p.leftBags.length ? leftOff(t, p.left, p.leftBags) : null,
  ];
}

// Just after a tick the list holds still for a moment, so the tick shows where it was tapped and a quick next tap
// lands on what was there: a bag the tick finished stays open, and with Hide done on, the ticked row stays. Every
// tap starts the moment again. When it ends, the list closes up around the rows under the finger.
const linger = new Set(); // 'go:BAGID' or 'back:BAGID' for a bag, a row's mark key for a row
let lingerT = null, lingerAt = '';
const LINGER_MS = 1200;

function settle() {
  lingerT = null;
  linger.clear();
  const f = document.activeElement, fk = f?.dataset?.key, card = fk && f.closest('.bag');
  // If the focus was on a tick that goes, it moves to the next one in that bag, or to the folded bag.
  const next = card ? [...card.querySelectorAll('[data-key]')].map(x => x.dataset.key) : [];
  const i = next.indexOf(fk);
  const tapped = lingerAt && main.querySelector(`[data-key="${CSS.escape(lingerAt)}"]`)?.getBoundingClientRect().top;
  holdStill(tapped > 0 && tapped < innerHeight ? tapped : innerHeight / 2, render);
  if (card && !main.contains(document.activeElement)) {
    for (const k of [...next.slice(i + 1), ...next.slice(0, i).reverse(), 'fold:' + card.dataset.bag]) {
      const x = main.querySelector(`[data-key="${CSS.escape(k)}"]`);
      if (x) { x.focus({ preventScroll: true }); break; }
    }
  }
}

// Redraws with the row nearest y kept at the same place on the screen, taking the nearest at or below it first:
// packing down the list, that's where the next tap goes. render() replaces every row, so the browser can't do this.
function holdStill(y, redraw) {
  const was = [...main.querySelectorAll('[data-key]')].map(x => [x.dataset.key, x.getBoundingClientRect().top]).filter(([, top]) => top > 0 && top < innerHeight);
  was.sort(([, a], [, b]) => (a < y) - (b < y) || Math.abs(a - y) - Math.abs(b - y));
  redraw();
  for (const [k, top] of was) {
    const x = main.querySelector(`[data-key="${CSS.escape(k)}"]`);
    if (x) { window.scrollBy(0, x.getBoundingClientRect().top - top); return; }
  }
}

function bagCard(t, g, mode, hide, why, jobs = false) {
  const b = g.bag, done = g.rows.filter(r => r.done).length, all = done === g.rows.length;
  const held = linger.has(mode + ':' + b.id);
  const open = !all || held || store.isOpen(t.id + ':' + b.id);
  const rows = g.rows.filter(r => !hide || !r.done || linger.has(r.key));
  const head = h('header', { class: 'bag-head' },
    h('span', { class: 'bag-icon', 'aria-hidden': 'true' }, b.icon),
    h('h2', {}, b.name),
    b.when?.length ? h('span', { class: 'bag-cond' }, b.when.map(k => R.condInfo(doc(), k)?.icon).join('')) : null,
    h('span', { class: 'count' + (all ? ' all' : '') }, all ? h('span', { html: ICONS.check }) : null, `${done}/${g.rows.length}`),
    b.id !== '_loose' ? h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `More for ${b.name}`, html: ICONS.more, onclick: () => bagSheet(t, g, mode) }) : null);
  return h('section', { class: 'bag' + (all ? ' all' : '') + (jobs ? ' jobs' : ''), 'data-bag': b.id },
    head,
    b.note ? h('p', { class: 'bag-note' }, b.note) : null,
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
  const why = r.hits.map(k => { const info = R.condInfo(doc(), k); return info ? `${info.icon} ${whyMap[k] || info.name}` : ''; }).filter(Boolean);
  return h('li', { class: 'row' + (r.done ? ' done' : '') + (r.gone ? ' gone' : '') },
    h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(r.done), 'data-key': r.key, onclick: toggle },
      h('span', { class: 'box', html: ICONS.check }),
      h('span', { class: 'what' },
        h('span', { class: 'name' }, r.name, r.qty > 1 ? h('span', { class: 'qty' }, ' ×' + r.qty) : null),
        r.gone ? h('small', {}, 'Not coming back') : null,
        r.note ? h('small', {}, r.note) : null,
        why.length ? h('small', { class: 'why' }, why.join(' · ')) : null,
        r.packedOnly ? h('small', { class: 'why' }, 'Packed, though the trip no longer calls for it') : null,
        r.added ? h('small', { class: 'why' }, 'Added for this trip') : null,
        r.moved ? h('small', { class: 'why' }, 'In this bag for this trip') : null,
        r.extra ? h('small', { class: 'why' }, 'Just for this trip') : null)),
    jobs && mode === 'back' ? null : h('button', { type: 'button', class: 'icon-btn more', 'aria-label': `More for ${r.name}`, html: ICONS.more, onclick: () => itemSheet(t, r, mode, jobs) }));
}

function leftOff(t, left, leftBags) {
  const open = store.isOpen(t.id + ':left');
  const put = (id, skipped) => apply(d => M.mark(d, t.id, 'x:' + id, skipped ? 0 : 'add'));
  return h('section', { class: 'left' },
    h('button', { type: 'button', class: 'left-head', 'aria-expanded': String(open), onclick: () => { store.setOpen(t.id + ':left', !open); render(); } },
      h('h2', {}, `Left off this trip (${left.length + leftBags.length})`),
      h('span', { class: 'muted small' }, open ? 'Hide' : 'Show')),
    open ? h('ul', { class: 'rows' },
      leftBags.map(l => h('li', { class: 'row left-row' },
        h('div', { class: 'what' },
          h('span', { class: 'name' }, `${l.bag.icon} ${l.bag.name}`),
          h('small', {}, `${plural(l.count, l.bag.kind === 'bag' ? 'thing' : 'job')} · ${l.why}`)),
        h('button', { type: 'button', class: 'btn small', 'data-key': 'x:' + l.bag.id, onclick: () => put(l.bag.id, l.skipped) }, l.skipped ? 'Put back' : 'Bring it'))),
      left.map(l => h('li', { class: 'row left-row' },
        h('div', { class: 'what' }, h('span', { class: 'name' }, l.item.name), h('small', {}, l.why)),
        h('button', { type: 'button', class: 'btn small', 'data-key': 'x:' + l.item.id, onclick: () => put(l.item.id, l.skipped) }, l.skipped ? 'Put back' : 'Pack it')))) : null);
}

// ---------- sheets for a trip ----------

function itemSheet(t, r, mode, jobs) {
  const id = r.id;
  const pick = t.marks?.['x:' + id]?.v;
  sheet(r.name, close => {
    if (mode === 'back') {
      const gone = t.marks?.[r.key]?.v === 2;
      return [
        h('p', { class: 'muted' }, 'Used up, given away, or staying on purpose? Count it as done.'),
        h('div', { class: 'stack' },
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); apply(d => M.mark(d, t.id, r.key, gone ? 0 : 2)); } }, gone ? 'It’s coming back after all' : 'Not bringing it back'))];
    }
    const bagsList = M.bags(doc()).filter(b => b.kind === 'bag');
    const cur = t.marks?.['b:' + id]?.v || (r.extra ? t.extras[id].bag : doc().items[id]?.bag);
    return [
      h('div', { class: 'stack' },
        r.extra
          ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); apply(d => M.removeExtra(d, t.id, id)); toast(`${r.name} is off this trip.`, { label: 'Undo', run: () => apply(d => M.putExtra(d, t.id, { id: `${id}`, name: r.name, bag: cur })) }); } }, 'Take it off this trip')
          : h('button', { type: 'button', class: 'btn', onclick: () => { close(); apply(d => M.mark(d, t.id, 'x:' + id, 'skip')); toast(`${r.name} is off this trip.`, { label: 'Undo', run: () => apply(d => M.mark(d, t.id, 'x:' + id, pick || 0)) }); } }, 'Leave it off this trip'),
        jobs ? null : h('label', { class: 'field' }, h('span', {}, 'Pack it in, this trip'),
          h('select', { onchange: e => { close(); apply(d => M.mark(d, t.id, 'b:' + id, e.target.value)); } },
            bagsList.map(b => h('option', { value: b.id, selected: b.id === cur }, `${b.icon} ${b.name}`)))),
        r.extra ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); apply(d => M.removeExtra(M.putItem(d, { name: r.name, bag: cur, ...guess(r.name) }), t.id, id)); toast(`${r.name} is on your list for every trip now.`); } }, 'Add it to my list for every trip')
          : h('button', { type: 'button', class: 'btn', onclick: () => { close(); itemEditor(doc().items[id]); } }, 'Change it in my list')),
    ];
  });
}

function bagSheet(t, g, mode) {
  const b = g.bag, keys = g.rows.map(r => r.key);
  const all = g.rows.every(r => r.done);
  sheet(`${b.icon} ${b.name}`, close => [
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); apply(d => M.markAll(d, t.id, keys, all ? 0 : 1)); } },
        all ? 'Untick everything in it' : b.kind === 'bag' ? (mode === 'go' ? 'It’s all packed already' : 'It’s all back in') : 'All done'),
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

function extraSheet(t) {
  const bagsList = M.bags(doc()).filter(b => b.kind === 'bag');
  let name, bag, keep;
  sheet('Add something', close => {
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      close();
      if (keep.checked) {
        const g = guess(n);
        const id = M.newId('i');
        store.apply(d => M.putItem(d, { id, name: n, bag: bag.value, ...g }));
        // On this trip whatever its conditions say, since it was asked for.
        if (g.when.length) store.apply(d => M.mark(d, t.id, 'x:' + id, 'add'));
        toast(`${n} is on your list now.`);
      } else store.apply(d => M.putExtra(d, t.id, { name: n, bag: bag.value }));
      render();
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'What is it?'), name = h('input', { type: 'text', autofocus: true, maxlength: 80, placeholder: 'A gift for the hosts', autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', {}, 'Which bag?'), bag = h('select', {}, bagsList.map(b => h('option', { value: b.id }, `${b.icon} ${b.name}`)))),
      h('label', { class: 'check' }, keep = h('input', { type: 'checkbox' }), h('span', {}, 'Put it on my list for every trip')),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Add it')),
    ];
  });
}

// What the trip calls for: the occasions, how you're getting there, and the weather and place by hand.
function condSheet(id) {
  const draw = () => {
    const t = doc().trips[id];
    const c = R.conditions(doc(), t);
    sheet('What this trip calls for', () => [
      h('h3', {}, 'What’s on'),
      h('div', { class: 'chips pick' }, M.tags(doc()).map(g => {
        const on = !!t.set?.[g.id]?.v;
        return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => { store.apply(d => M.setCond(d, id, g.id, on ? null : true)); draw(); render(); } }, `${g.icon} ${g.name}`);
      })),
      h('h3', {}, 'Getting there'),
      h('div', { class: 'seg' }, M.TRAVEL.map(k => {
        const info = R.CONDITIONS.find(x => x.k === k);
        return h('button', { type: 'button', 'aria-pressed': String(t.travel === k), onclick: () => { store.apply(d => M.putTrip(d, { id, travel: k })); draw(); render(); } }, `${info.icon} ${info.name}`);
      })),
      h('h3', {}, 'Place and weather'),
      h('p', { class: 'muted small' }, 'These follow the place and the forecast. Set one yourself if you know better.'),
      h('ul', { class: 'auto-list' }, R.AUTO_KEYS.map(k => {
        const info = R.condInfo(doc(), k), set = t.set?.[k]?.v;
        const state = set === true ? 'on' : set === false ? 'off' : 'auto';
        const autoText = c.auto[k] === undefined ? 'unknown' : c.auto[k] ? 'yes' : 'no';
        const pickState = s => { store.apply(d => M.setCond(d, id, k, s === 'auto' ? null : s === 'on')); draw(); render(); };
        return h('li', {},
          h('span', { class: 'auto-name' }, h('span', { 'aria-hidden': 'true' }, info.icon), ' ', h('b', {}, info.name),
            h('small', {}, `Automatic: ${autoText}${c.auto[k] && c.why[k] ? ` (${c.why[k]})` : ''}`)),
          h('div', { class: 'seg tiny', role: 'group', 'aria-label': info.name },
            ['auto', 'on', 'off'].map(s => h('button', { type: 'button', 'aria-pressed': String(state === s), onclick: () => pickState(s) }, s === 'auto' ? 'Auto' : s === 'on' ? 'Yes' : 'No'))));
      })),
      h('p', { class: 'small' }, h('a', { href: '#/list', onclick: closeSheet }, 'Change the occasions in My list')),
    ], { wide: true });
  };
  draw();
}

// ---------- planning or changing a trip ----------

function tripForm(t, again = false) {
  const editing = t && !again;
  const key = (editing ? 'edit/' : again ? 'again/' : 'new/') + (t ? t.id : '');
  if (draft?.key !== key) draft = { key, results: [], searchErr: '', typed: '', err: '' };
  const dr = draft;
  const st = {
    place: t?.place || null, start: editing ? t.start : '', end: editing ? t.end : '', travel: t?.travel || 'fly', name: editing ? t.name : '',
    tags: new Set(Object.entries(t?.set || {}).filter(([k, m]) => m.v === true && doc().tags[k]).map(([k]) => k)),
  };
  for (const k of Object.keys(st)) if (k in dr) st[k] = dr[k];
  const set = (k, v) => { st[k] = dr[k] = v; };
  const where = h('div', { class: 'where-field' });
  const input = h('input', { type: 'search', id: 'where', value: dr.typed, placeholder: 'A city or town', autocomplete: 'off', enterkeyhint: 'search', 'aria-describedby': 'whereHelp' });
  const list = h('ul', { class: 'results', role: 'listbox', 'aria-label': 'Places' });
  const drawWhere = () => {
    if (st.place) {
      where.replaceChildren(h('div', { class: 'picked' },
        h('span', {}, h('b', {}, st.place.name), ' ', h('span', { class: 'muted' }, [st.place.admin, st.place.country].filter(Boolean).join(', '))),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Pick another place', html: ICONS.close, onclick: () => { set('place', null); drawWhere(); input.focus(); } })));
      return;
    }
    list.replaceChildren(...dr.results.map(r => h('li', {}, h('button', { type: 'button', role: 'option', onclick: () => { set('place', r); dr.results = []; drawWhere(); } },
      h('b', {}, r.name), ' ', h('span', { class: 'muted' }, [r.admin, r.country].filter(Boolean).join(', '))))));
    const typed = input.value.trim();
    if (dr.searchErr && typed) list.append(h('li', { class: 'err small' }, single ? 'This copy can’t reach the weather service. Use what you typed and set the weather by hand, or open carry-on.junkdrawer.works for the forecast.' : dr.searchErr), h('li', {}, h('button', { type: 'button', onclick: () => { set('place', { name: typed, admin: '', country: '', cc: '' }); drawWhere(); } }, `Use “${typed}” without looking it up`)));
    where.replaceChildren(input, list);
  };
  // A search that answers after a redraw shows on the form that's there now.
  dr.drawWhere = drawWhere;
  input.addEventListener('input', () => {
    dr.typed = input.value;
    clearTimeout(dr.timer);
    if (dr.ctl) dr.ctl.abort();
    const q = input.value;
    dr.timer = setTimeout(() => {
      const ctl = dr.ctl = new AbortController();
      W.searchPlaces(q, { signal: ctl.signal }).then(r => { dr.results = r; dr.searchErr = q.trim().length > 1 && !r.length ? 'No places by that name.' : ''; dr.drawWhere(); }, e => { if (e.name !== 'AbortError') { dr.results = []; dr.searchErr = e.message; dr.drawWhere(); } });
    }, 300);
  });
  drawWhere();
  const errBox = h('p', { class: 'err', role: 'alert' }, dr.err);
  const err = msg => { errBox.textContent = dr.err = msg; };
  const startIn = h('input', { type: 'date', id: 'start', value: st.start, min: editing ? null : D.add(today(), -30), required: true, oninput: e => set('start', e.target.value), onchange: e => { set('start', e.target.value); if (!st.end || st.end < st.start) { set('end', st.start); endIn.value = st.end; } } });
  const endIn = h('input', { type: 'date', id: 'end', value: st.end, required: true, oninput: e => set('end', e.target.value), onchange: e => set('end', e.target.value) });
  const nameIn = h('input', { type: 'text', id: 'name', value: st.name, maxlength: 60, placeholder: 'Sam’s wedding', autocomplete: 'off', oninput: e => set('name', e.target.value) });
  const save = () => {
    st.start = startIn.value; st.end = endIn.value;
    if (!st.place && input.value.trim()) { err('Pick a place from the list, or use what you typed.'); return; }
    if (!st.start || !st.end) { err('When do you leave, and when are you back?'); return; }
    if (st.end < st.start) { err('You’re back before you leave. Check the dates.'); return; }
    if (D.nights(st.start, st.end) > 90) { err('That’s more than 90 nights. Check the dates.'); return; }
    const id = editing ? t.id : M.newId('t');
    const moved = editing && (t.start !== st.start || t.end !== st.end || t.place?.lat !== st.place?.lat || t.place?.name !== st.place?.name);
    store.apply(d => {
      let next = M.putTrip(d, { id, place: st.place, start: st.start, end: st.end, travel: st.travel, name: nameIn.value.trim() });
      for (const g of M.tags(d)) {
        const was = !!d.trips[id]?.set?.[g.id]?.v, now = st.tags.has(g.id);
        if (was !== now) next = M.setCond(next, id, g.id, now ? true : null);
      }
      if (moved || !editing) next = { ...next, trips: { ...next.trips, [id]: { ...next.trips[id], wx: undefined } } };
      return next;
    });
    draft = null;
    if (moved || !editing) delete wxTried[id];
    go(`#/trip/${id}`);
  };
  return [
    h('a', { class: 'crumb', href: editing ? `#/trip/${t.id}` : '#/' }, h('span', { html: ICONS.back }), editing ? title(t) : 'Trips'),
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
      go('#/');
      toast(`${title(t)} deleted.`, { label: 'Undo', run: () => apply(d => M.restoreTrip(d, t.id)) });
    })) : null,
  ];
}

// ---------- my list ----------

function condChips(x) {
  const when = x.when.map(k => R.condInfo(doc(), k)).filter(Boolean), unless = x.unless.map(k => R.condInfo(doc(), k)).filter(Boolean);
  if (!when.length && !unless.length) return null;
  return h('span', { class: 'conds' },
    when.length ? h('span', {}, 'Only for ', when.map(i => `${i.icon} ${i.name.toLowerCase()}`).join(' or ')) : null,
    unless.length ? h('span', {}, `${when.length ? ', not' : 'Not'} for `, unless.map(i => `${i.icon} ${i.name.toLowerCase()}`).join(' or ')) : null);
}

function listView() {
  const all = M.bags(doc());
  const kinds = [['bag', 'Bags'], ['leave', 'Before you leave home'], ['back', 'Before you leave the hotel']];
  return [
    h('div', { class: 'page-head' }, h('h1', {}, 'My list')),
    h('p', { class: 'lede muted' }, 'Everything you might pack, by bag. Something with conditions only comes along when a trip calls for it. Tap anything to change it.'),
    kinds.map(([kind, label]) => {
      const bs = all.filter(b => b.kind === kind);
      return [
        kind !== 'bag' ? h('h2', { class: 'kind-head' }, label) : null,
        bs.map(b => listBag(b)),
      ];
    }),
    h('button', { type: 'button', class: 'btn add-extra', onclick: () => bagEditor(null) }, h('span', { html: ICONS.plus }), 'Add a bag or a list of jobs'),
    h('section', { class: 'card' },
      h('h2', {}, 'Occasions'),
      h('p', { class: 'muted small' }, 'Pick these when you plan a trip. Things can come along only for some of them.'),
      h('div', { class: 'chips pick' },
        M.tags(doc()).map(g => h('button', { type: 'button', class: 'chip', onclick: () => tagEditor(g) }, `${g.icon} ${g.name}`)),
        h('button', { type: 'button', class: 'chip add', onclick: () => tagEditor(null) }, '+ Add one'))),
    h('section', { class: 'card' },
      h('h2', {}, 'Share or bring in a list'),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn', onclick: shareSheet }, 'Send my list as a link'),
        h('button', { type: 'button', class: 'btn', onclick: pasteSheet }, 'Paste a list'))),
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
    if (g.when.length || g.per) toast(`${n}: ${g.per ? 'one for each day' : `only for ${g.when.map(k => R.condInfo(doc(), k).name.toLowerCase()).join(' or ')}`}. Tap it to change that.`);
  };
  return h('section', { class: 'bag edit' + (b.kind !== 'bag' ? ' jobs' : '') },
    h('header', { class: 'bag-head' },
      h('span', { class: 'bag-icon', 'aria-hidden': 'true' }, b.icon),
      h('h2', {}, b.name),
      h('button', { type: 'button', class: 'btn small', onclick: () => bagEditor(b), 'aria-label': `Change ${b.name}` }, 'Change')),
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
      apply(d => M.putItem(d, fields));
    };
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), name = h('input', { type: 'text', value: x?.name || '', maxlength: 80, autofocus: isNew, autocomplete: 'off' })),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'Bag'), bag = h('select', {}, bagsAll.map(b => h('option', { value: b.id, selected: b.id === bag0 }, `${b.icon} ${b.name}`)))),
        h('label', { class: 'field' }, h('span', {}, 'How many'), qty = h('select', {},
          [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: x?.per !== 'day' && (x?.qty || 1) === n }, n === 1 ? 'Just one' : String(n))),
          h('option', { value: 'day', selected: x?.per === 'day' }, 'One for each day')))),
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
        isNew ? null : confirmBtn('Delete', M.items(doc(), b.id).length ? `Delete it and ${plural(M.items(doc(), b.id).length, 'thing')} in it?` : 'Tap again to delete', () => {
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

function listSummary(list) {
  const bags = list.bags.filter(b => b.kind === 'bag');
  return `${plural(bags.length, 'bag')} and ${plural(list.items.filter(x => bags.some(b => b.id === x.bag)).length, 'thing')}: ${bags.slice(0, 4).map(b => b.name).join(', ')}${bags.length > 4 ? '…' : ''}`;
}

// Use a list that came in: replace this one with it, or add it.
function offerList(list, from, after) {
  const has = M.hasList(doc());
  sheet(from, close => [
    h('p', {}, listSummary(list)),
    list.bags.length ? h('ul', { class: 'preview' }, list.bags.map(b => h('li', {}, h('span', { 'aria-hidden': 'true' }, b.icon), ' ', h('b', {}, b.name), ' ',
      h('span', { class: 'muted' }, list.items.filter(x => x.bag === b.id).map(x => x.name).slice(0, 6).join(', ') + (list.items.filter(x => x.bag === b.id).length > 6 ? '…' : ''))))) : null,
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); store.apply(d => M.replaceList(d, list)); after?.(); toast('Your list is in.'); go('#/list'); } }, has ? 'Use it instead of my list' : 'Use this list'),
      has ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); store.apply(d => M.addList(d, list)); after?.(); toast('Added to your list.'); go('#/list'); } }, 'Add it to my list') : null,
      has ? h('p', { class: 'muted small' }, 'Using it instead keeps your trips. Their ticks still count for things on both lists.') : null),
  ], { wide: true });
}

async function takeLink(code) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  render();
  try {
    const list = await decodeList(code);
    offerList(list, 'A packing list');
  } catch (e) { toast(e.message); }
}

function pasteSheet() {
  let area;
  sheet('Paste a list', close => {
    const go2 = () => {
      const list = parsePaste(area.value);
      if (!list.items.length) { area.focus(); return; }
      close();
      offerList(list, 'Your pasted list');
    };
    return [
      h('p', { class: 'muted small' }, 'Copy your list from Google Keep, Notes or a document and paste it here. Put each bag’s things under its name, indented, with a dash, or after a line ending in a colon. Anything on its own goes in “Not in a bag”. A first guess at when each thing is needed goes in too.'),
      area = h('textarea', { rows: 10, autofocus: true, placeholder: 'Electronics:\n- Phone charger\n- Headphones\nToiletries:\n- Toothbrush\n- Floss\nPassport' }),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: go2 }, 'Next')),
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

function settingsView() {
  const d = doc(), home = R.home(d), u = R.units(d), l = R.laundry(d);
  const homeSet = !!M.pref(d, 'home', '');
  const countries = Object.keys(PLUGS).map(cc => [cc, countryName(cc)]).sort((a, b) => a[1].localeCompare(b[1]));
  const driveHost = h('section', { class: 'card drive' });
  queueMicrotask(() => drive.card(driveHost));
  let file;
  return [
    h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('section', { class: 'card' },
      h('h2', {}, 'Home'),
      h('label', { class: 'field' }, h('span', {}, 'You live in'),
        h('select', { onchange: e => apply(x => M.setPref(x, 'home', e.target.value)) }, countries.map(([cc, n]) => h('option', { value: cc, selected: cc === home }, n)))),
      h('p', { class: 'muted small' }, homeSet ? 'Trips anywhere else count as abroad, and plug adapters are worked out from home’s plugs.' : 'Guessed from this browser’s language settings. Trips anywhere else count as abroad.')),
    h('section', { class: 'card' },
      h('h2', {}, 'Temperatures'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Temperatures' },
        ['F', 'C'].map(k => h('button', { type: 'button', 'aria-pressed': String(u === k), onclick: () => apply(x => M.setPref(x, 'units', k)) }, k === 'F' ? '°F' : '°C')))),
    h('section', { class: 'card' },
      h('h2', {}, 'Laundry'),
      h('p', { class: 'muted small' }, 'Things you need one of each day (socks, say) stop at this many, for longer trips where you’ll do laundry.'),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'One fewer', disabled: l <= 1, onclick: () => apply(x => M.setPref(x, 'laundry', l - 1)) }, '−'),
        h('output', {}, plural(l, 'day')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'One more', disabled: l >= 30, onclick: () => apply(x => M.setPref(x, 'laundry', l + 1)) }, '+'))),
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
          try { const n = store.restoreBackup(await f.text()); render(); drive.changed(); toast(n ? `Restored: ${plural(n, 'change')}.` : 'Nothing in it that isn’t here already.'); } catch (e) { toast(e.message); }
          file.value = '';
        } })))),
    h('section', { class: 'card' },
      h('h2', {}, 'About'),
      h('p', { class: 'small' }, 'Forecasts, past weather and place search come from ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'), '. Looking up a trip sends its place and dates there; nothing else leaves this browser unless you turn on Google Drive. Plug types are from the IEC’s list of world plugs.'),
      h('p', { class: 'small muted' }, 'Hot means a high of 28 °C (82 °F) or more; cool, a low of 13 °C (55 °F) or less; cold, a low of 4 °C (39 °F) or less. Rain means a 50% chance or more on any day, or, for typical weather, rain on 3 days in 10. Strong sun means a UV index of 6 or more.')),
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
drive.onUpdate(() => { store.reload(); render(); });
window.addEventListener('storage', e => { if (e.key === 'carry-on' || e.key === 'carry-on.device') { store.reload(); render(); } });
window.addEventListener('hashchange', render);
// A new day can change which trips are coming up, and old weather gets looked up again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();

if ('serviceWorker' in navigator && !single && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

// For the tests and the screenshots.
window.carryOn = { store, M, R, D, render };
