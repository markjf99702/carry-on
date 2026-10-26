// The parts with no page: merging, the trip rules, the weather summary, plugs, and lists coming in.
//   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { plan, conditions, qtyOf } from '../js/rules.js';
import { summarize, stale } from '../js/weather.js';
import { plugsFor, plugText } from '../js/plugs.js';
import { parsePaste, encodeList, decodeList, guess } from '../js/share.js';
import { starterList } from '../js/starter.js';
import { add, span, yearsBack, range, weekday, short, long } from '../js/days.js';

const T = '2026-11-02';
const starter = () => M.startWith(M.blankDoc(), starterList());
const names = (p, bagName) => p.groups.find(g => g.bag.name === bagName)?.rows.map(r => r.name) || [];
const allNames = p => p.groups.flatMap(g => g.rows.map(r => r.name));
const day = (d, hi, lo, extra = {}) => ({ d, hi, lo, mm: 0, ...extra });

function trip(doc, fields) {
  const id = 't1';
  return M.putTrip(doc, { id, start: T, end: add(T, 4), travel: 'fly', ...fields });
}

test('the starter list goes in untouched, in order', () => {
  const doc = starter();
  const bags = M.bags(doc);
  assert.equal(bags[0].name, 'Liquids bag');
  assert.equal(bags.at(-1).kind, 'back');
  assert.ok(M.items(doc).every(x => x.t === 0));
  assert.equal(M.items(doc, 's-clothes')[0].name, 'Underwear');
});

test('a trip with no weather: always-things, the travel mode, and per-day counts', () => {
  let doc = starter();
  doc = M.setPref(doc, 'home', 'US');
  doc = trip(doc, { place: { name: 'Chicago', cc: 'US', country: 'United States' } });
  const t = doc.trips.t1, p = plan(doc, t);
  const all = allNames(p);
  assert.ok(all.includes('Toothbrush'));
  assert.ok(all.includes('Eye mask and earplugs'), 'flying brings the eye mask');
  assert.ok(!all.includes('Passport'), 'no passport at home');
  assert.ok(!all.includes('Swimsuit'));
  assert.ok(!names(p, 'Work bag').length, 'no work bag without work');
  const socks = p.groups.flatMap(g => g.rows).find(r => r.name === 'Socks');
  assert.equal(socks.qty, 5, 'four nights is five days of socks');
  assert.deepEqual(p.tasks.map(g => g.bag.name), ['Leaving the house']);
  assert.ok(p.left.some(l => l.item.name === 'Passport' && /abroad/.test(l.why)));
});

test('abroad: passport, and an adapter only where the plugs differ', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Lisbon', cc: 'PT', country: 'Portugal' } });
  let p = plan(doc, doc.trips.t1);
  assert.ok(allNames(p).includes('Passport'));
  const adapter = p.groups.flatMap(g => g.rows).find(r => r.name === 'Plug adapter');
  assert.deepEqual(adapter.hits, ['plug']);
  assert.match(p.cond.why.plug, /Type C\/F, 230 V/);
  doc = trip(doc, { place: { name: 'Tokyo', cc: 'JP', country: 'Japan' } });
  p = plan(doc, doc.trips.t1);
  assert.ok(allNames(p).includes('Passport'));
  assert.ok(!allNames(p).includes('Plug adapter'), 'US plugs fit in Japan');
});

test('plugs', () => {
  assert.equal(plugsFor('US', 'GB').need, true);
  assert.equal(plugsFor('US', 'MX').need, false);
  assert.equal(plugsFor('DE', 'FR').need, false, 'a Europlug fits French sockets');
  assert.equal(plugsFor('GB', 'IE').need, false);
  assert.equal(plugsFor('US', 'GB').voltsDiffer, true);
  assert.equal(plugText(plugsFor('US', 'AU')), 'Type I, 230 V');
});

test('weather: forecast thresholds and the reasons they give', () => {
  const wx = { at: 1, days: [day('2026-11-02', 30, 22, { uv: 9 }), day('2026-11-03', 29, 21, { pop: 70, mm: 8 }), day('2026-11-04', 31, 23, { pop: 10 })] };
  const w = summarize(wx);
  assert.equal(w.hot, true); assert.equal(w.rain, true); assert.equal(w.sun, true);
  assert.equal(w.cold, false); assert.equal(w.cool, false);
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Miami', cc: 'US', lat: 25.7, lon: -80.2 }, end: '2026-11-04', wx });
  const p = plan(doc, doc.trips.t1);
  const all = allNames(p);
  for (const n of ['Swimsuit', 'Sandals', 'Sunscreen', 'Umbrella', 'Rain jacket']) assert.ok(all.includes(n), n);
  for (const n of ['Warm coat', 'Light jacket', 'Snow boots']) assert.ok(!all.includes(n), n);
  assert.equal(p.cond.why.rain, 'Rain likely Tue');
  assert.equal(p.cond.why.hot, 'Highs up to 88°');
});

test('weather: cold, cool and typical weather', () => {
  const cold = summarize({ at: 1, days: [day('2026-12-01', 3, -4), day('2026-12-02', 5, -2, { snow: 2 })] });
  assert.equal(cold.cold, true); assert.equal(cold.cool, false); assert.deepEqual(cold.snowDays, ['2026-12-02']);
  const cool = summarize({ at: 1, days: [day('2026-10-01', 19, 11)] });
  assert.equal(cool.cool, true); assert.equal(cool.cold, false);
  const typ = summarize({ at: 1, days: [{ d: '2027-03-01', typ: 1, hi: 14, lo: 8, mm: 3, wet: 0.67, sn: 0, rad: 9 }, { d: '2027-03-02', typ: 1, hi: 13, lo: 7, mm: 0, wet: 0.33, sn: 0, rad: 12 }] });
  assert.equal(typ.typical, true); assert.equal(typ.rain, true); assert.equal(typ.sun, false); assert.equal(typ.cool, true);
});

test('stale weather', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(stale(null, '2026-11-10', '2026-11-12', '2026-11-02', now), true);
  assert.equal(stale({ at: now - 3600e3, days: [day('2026-11-10', 10, 5)] }, '2026-11-10', '2026-11-10', '2026-11-02', now), false);
  assert.equal(stale({ at: now - 5 * 3600e3, days: [day('2026-11-10', 10, 5)] }, '2026-11-10', '2026-11-10', '2026-11-02', now), true);
  assert.equal(stale({ at: now, days: [{ d: '2026-11-10', typ: 1, hi: 1, lo: 1, mm: 0, wet: 0, sn: 0, rad: 0 }] }, '2026-11-10', '2026-11-10', '2026-11-02', now), true, 'the forecast now reaches it');
  const typ = { at: now - 2 * 86400e3, days: [{ d: '2026-12-20', typ: 1, hi: 1, lo: 1, mm: 0, wet: 0, sn: 0, rad: 0 }] };
  assert.equal(stale(typ, '2026-12-20', '2026-12-20', '2026-11-02', now), false, 'typical weather two days old is still good');
  assert.equal(stale({ ...typ, at: now - 8 * 86400e3 }, '2026-12-20', '2026-12-20', '2026-11-02', now), true, 'but not after a week');
  assert.equal(stale(null, '2026-10-01', '2026-10-05', '2026-11-02', now), false, 'a past trip keeps what it had');
});

test('turning a condition on or off by hand, and occasions', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Denver', cc: 'US' } });
  doc = M.setCond(doc, 't1', 'rain', true);
  doc = M.setCond(doc, 't1', 'work', true);
  let p = plan(doc, doc.trips.t1);
  assert.ok(allNames(p).includes('Umbrella'));
  assert.deepEqual(names(p, 'Work bag'), ['Badge', 'Notebook and pen', 'Business cards']);
  assert.equal(p.cond.why.rain, 'You turned this on');
  doc = M.setCond(doc, 't1', 'rain', null);
  p = plan(doc, doc.trips.t1);
  assert.ok(!allNames(p).includes('Umbrella'));
});

test('skipping, adding, moving, extras, and what shows coming home', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Denver', cc: 'US' } });
  doc = M.mark(doc, 't1', 'x:s-documents-passport', 'add');
  doc = M.mark(doc, 't1', 'x:s-daybag-snacks', 'skip');
  doc = M.mark(doc, 't1', 'b:s-daybag-sunglasses', 's-clothes');
  doc = M.putExtra(doc, 't1', { id: 'e1', name: 'Wedding gift', bag: 's-daybag' });
  let p = plan(doc, doc.trips.t1);
  assert.ok(allNames(p).includes('Passport'));
  assert.ok(!allNames(p).includes('Snacks'));
  assert.ok(p.left.find(l => l.item.name === 'Snacks').skipped);
  assert.ok(names(p, 'Clothes').includes('Sunglasses'));
  assert.ok(names(p, 'Day bag').includes('Wedding gift'));
  // Ticked going: only those come home.
  doc = M.mark(doc, 't1', 'p:s-clothes-shoes', 1);
  doc = M.mark(doc, 't1', 'p:e1', 1);
  const back = plan(doc, doc.trips.t1, 'back');
  assert.deepEqual(allNames(back).sort(), ['Shoes', 'Wedding gift']);
  assert.deepEqual(back.tasks.map(g => g.bag.name), ['Leaving the hotel']);
  // Packed, then the weather changed: it stays on the list.
  doc = M.setCond(doc, 't1', 'rain', true);
  doc = M.mark(doc, 't1', 'p:s-daybag-umbrella', 1);
  doc = M.setCond(doc, 't1', 'rain', false);
  p = plan(doc, doc.trips.t1);
  assert.ok(p.groups.flatMap(g => g.rows).find(r => r.name === 'Umbrella').packedOnly);
});

test('a bag can depend on a condition, and its things go with it', () => {
  let doc = starter();
  doc = trip(doc, {});
  let p = plan(doc, doc.trips.t1);
  assert.ok(!p.left.some(l => l.item.name === 'Badge'), 'the bag’s own line covers its things');
  assert.deepEqual(p.leftBags.map(l => [l.bag.name, l.why, l.count, l.skipped]), [['Work bag', 'Only for work', 3, false]]);
  // Brought along anyway.
  doc = M.mark(doc, 't1', 'x:s-work', 'add');
  p = plan(doc, doc.trips.t1);
  assert.deepEqual(names(p, 'Work bag'), ['Badge', 'Notebook and pen', 'Business cards']);
  assert.deepEqual(p.leftBags, []);
});

test('a whole bag or list of jobs left off one trip', () => {
  let doc = starter();
  doc = trip(doc, {});
  doc = M.mark(doc, 't1', 'x:s-leave', 'skip');
  doc = M.mark(doc, 't1', 'x:s-daybag', 'skip');
  let p = plan(doc, doc.trips.t1);
  assert.deepEqual(p.tasks, [], 'no jobs before leaving');
  assert.ok(!names(p, 'Day bag').length);
  assert.deepEqual(p.leftBags.filter(l => l.skipped).map(l => l.bag.name).sort(), ['Day bag', 'Leaving the house']);
  assert.ok(!p.left.some(l => l.item.bag === 's-daybag'));
  // Coming home, the hotel list is still there, and can be skipped on its own.
  assert.deepEqual(plan(doc, doc.trips.t1, 'back').tasks.map(g => g.bag.name), ['Leaving the hotel']);
  doc = M.mark(doc, 't1', 'x:s-back', 'skip');
  const back = plan(doc, doc.trips.t1, 'back');
  assert.deepEqual(back.tasks, []);
  assert.deepEqual(back.leftBags.map(l => l.bag.name), ['Leaving the hotel']);
  // Other trips still have them.
  doc = M.putTrip(doc, { id: 't2', start: T, end: add(T, 2), travel: 'drive' });
  assert.deepEqual(plan(doc, doc.trips.t2).tasks.map(g => g.bag.name), ['Leaving the house']);
  // Put back.
  doc = M.mark(doc, 't1', 'x:s-leave', 0);
  assert.deepEqual(plan(doc, doc.trips.t1).tasks.map(g => g.bag.name), ['Leaving the house']);
});

test('days: the same words as toLocaleDateString, a year of days', () => {
  const was = (k, opts) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  for (const k of range('2026-02-25', '2027-03-05')) {
    assert.equal(weekday(k), was(k, { weekday: 'short' }));
    assert.equal(short(k), was(k, { month: 'short', day: 'numeric' }));
    assert.equal(long(k), was(k, { weekday: 'short', month: 'short', day: 'numeric' }));
    assert.equal(span(k, add(k, 400), '2026'), `${was(k, { month: 'short', day: 'numeric', year: 'numeric' })} – ${was(add(k, 400), { month: 'short', day: 'numeric', year: 'numeric' })}`);
  }
});

test('days: spans and years back', () => {
  assert.equal(span('2026-11-03', '2026-11-08', '2026'), 'Nov 3 – 8');
  assert.equal(span('2026-10-30', '2026-11-02', '2026'), 'Oct 30 – Nov 2');
  assert.equal(span('2026-12-30', '2027-01-02', '2026'), 'Dec 30, 2026 – Jan 2, 2027');
  assert.equal(yearsBack('2028-02-29', 1), '2027-03-01');
});

// ---------- merging ----------

test('merging edits from two devices, thing by thing', () => {
  const base = M.replaceList(M.blankDoc(), starterList());
  let a = M.putItem(base, { id: 's-clothes-belt', name: 'Brown belt' });
  let b = M.removeItem(base, 's-daybag-snacks');
  b = M.putItem(b, { name: 'Travel pillow', bag: 's-daybag', id: 'i-pillow' });
  const ab = M.mergeDocs(a, b), ba = M.mergeDocs(b, a);
  assert.equal(M.canon(ab), M.canon(ba), 'order of merging does not matter');
  assert.equal(ab.items['s-clothes-belt'].name, 'Brown belt');
  assert.ok(M.gone(ab.items['s-daybag-snacks']));
  assert.ok(ab.items['i-pillow']);
  assert.equal(M.canon(M.mergeDocs(ab, ab)), M.canon(ab), 'merging again changes nothing');
});

test('merging ticks on one trip from two phones', () => {
  let base = trip(M.replaceList(M.blankDoc(), starterList()), {});
  const a = M.mark(base, 't1', 'p:s-clothes-belt', 1);
  let b = M.mark(base, 't1', 'p:s-clothes-shoes', 1);
  b = M.setCond(b, 't1', 'work', true);
  const m = M.mergeDocs(a, b);
  assert.equal(m.trips.t1.marks['p:s-clothes-belt'].v, 1);
  assert.equal(m.trips.t1.marks['p:s-clothes-shoes'].v, 1);
  assert.equal(m.trips.t1.set.work.v, true);
});

test('a first merge keeps everything, but untouched starter things give way to a real list', () => {
  // Phone A brought its own list in and deleted nothing; phone B started from the starter list.
  const pasted = parsePaste('Electronics:\n- Phone charger\n- Headphones\nToiletries:\n- Toothbrush');
  const a = M.replaceList(M.blankDoc(), pasted);
  const b = starter();
  const m = M.mergeDocs(b, a, { first: true });
  const live = M.items(m).map(x => x.name).sort();
  assert.deepEqual(live, ['Headphones', 'Phone charger', 'Toothbrush']);
  // A third phone on the starter list joining later gets the real list too, and nothing comes back.
  const c = M.mergeDocs(starter(), m, { first: true });
  assert.deepEqual(M.items(c).map(x => x.name).sort(), live);
  assert.deepEqual(M.items(M.mergeDocs(m, c)).map(x => x.name).sort(), live);
  // A starter list on both sides stays.
  const both = M.mergeDocs(starter(), starter(), { first: true });
  assert.equal(M.items(both).length, M.items(starter()).length);
});

test('a starter bag with a thing of your own in it stays when the phone joins a Drive with another list', () => {
  const drive = M.replaceList(M.blankDoc(), parsePaste('Electronics:\n- Phone charger\n- Headphones\nClothes:\n- Socks\n- Hat'));
  const phone = M.putItem(starter(), { id: 'i-pill', name: 'Grandma’s pill box', bag: 's-toiletries' });
  for (const [local, remote] of [[phone, drive], [drive, phone]]) {
    const m = M.mergeDocs(local, remote, { first: true });
    assert.deepEqual(M.items(m, 's-toiletries').map(x => x.name), ['Grandma’s pill box'], 'the starter things in it still go');
    assert.deepEqual(M.bags(m).map(b => b.name).sort(), ['Clothes', 'Electronics', 'Toiletries bag']);
    assert.ok(M.items(m).every(x => m.bags[x.bag] && !M.gone(m.bags[x.bag])), 'every thing is in a bag that shows');
    assert.equal(M.canon(M.mergeDocs(m, remote)), M.canon(m), 'the next sync changes nothing');
  }
});

test('starting again from the starter list after deleting every bag sticks at the next sync', () => {
  let doc = trip(starter(), {});
  doc = M.putItem(doc, { id: 'i-mine', name: 'My own thing', bag: 's-daybag' });
  for (const b of M.bags(doc)) doc = M.removeBag(doc, b.id);
  const synced = doc; // what Drive and the other phones have
  later();
  const again = M.startWith(doc, starterList());
  assert.equal(M.bags(again).length, M.bags(starter()).length);
  for (const m of [M.mergeDocs(again, synced), M.mergeDocs(synced, again)]) {
    assert.equal(M.bags(m).length, M.bags(starter()).length, 'the bags stay');
    assert.equal(M.items(m).length, M.items(starter()).length, 'and the starter things, but not my own thing');
  }
  // A phone that never had a list still starts untouched, so it gives way to a list in Drive.
  assert.ok(M.items(starter()).every(x => x.t === 0));
});

test('a first merge: a deletion on one side does not take away what the other side still has', () => {
  const base = M.replaceList(M.blankDoc(), starterList());
  const a = M.removeItem(base, 's-daybag-snacks');
  const b = M.putItem(base, { id: 's-daybag-snacks', name: 'Snacks' });
  assert.ok(!M.gone(M.mergeDocs(a, b, { first: true }).items['s-daybag-snacks']));
});

test('the same thing made on two devices becomes one on a first merge', () => {
  let a = M.putBag(M.blankDoc(), { id: 'b1', name: 'Gym bag' });
  a = M.putItem(a, { id: 'i1', name: 'Towel', bag: 'b1' });
  let b = M.putBag(M.blankDoc(), { id: 'b2', name: 'gym bag' });
  b = M.putItem(b, { id: 'i2', name: 'towel', bag: 'b2' });
  b = M.putItem(b, { id: 'i3', name: 'Lock', bag: 'b2' });
  const m = M.mergeDocs(a, b, { first: true });
  assert.equal(M.bags(m).length, 1);
  assert.deepEqual(M.items(m).map(x => x.name.toLowerCase()).sort(), ['lock', 'towel']);
});

// Waits for the clock to move on, so a change made next is newer than the one before.
const later = () => { const t = Date.now(); while (Date.now() <= t); };
const changedIds = (was, now) => ['bags', 'items'].flatMap(c => Object.keys(now[c]).filter(id => M.canon(was[c][id]) !== M.canon(now[c][id])));

test('moving a list or a thing up or down changes only what moved, so it can’t bring back a deletion', () => {
  const base = starter();
  // One phone deletes Leaving the house; another, not synced yet, taps Move up on Leaving the hotel.
  const a = M.removeBag(base, 's-leave');
  later();
  const b = M.nudge(base, 'bags', 's-back', -1);
  assert.equal(b, base, 'the only hotel list has nowhere to go');
  assert.ok(M.gone(M.mergeDocs(a, b).bags['s-leave']), 'Leaving the house stays deleted');
  // Moving a bag past one deleted elsewhere doesn't bring that one back either.
  const c = M.removeBag(base, 's-toiletries');
  later();
  const d = M.nudge(base, 'bags', 's-electronics', -1);
  assert.deepEqual(changedIds(base, d), ['s-electronics']);
  assert.deepEqual(M.bags(d).slice(0, 3).map(x => x.id), ['s-liquids', 's-electronics', 's-toiletries']);
  const m = M.mergeDocs(c, d);
  assert.ok(M.gone(m.bags['s-toiletries']));
  assert.deepEqual(M.bags(m).slice(0, 2).map(x => x.id), ['s-liquids', 's-electronics']);
  // Inside a bag: one thing changes, and it lands one place up.
  const e = M.nudge(base, 'items', 's-toiletries-razor', -1);
  assert.deepEqual(changedIds(base, e), ['s-toiletries-razor']);
  assert.deepEqual(M.items(e, 's-toiletries').slice(0, 4).map(x => x.name), ['Toothbrush', 'Razor', 'Floss', 'Hairbrush or comb']);
  // To the top and back down.
  let f = M.nudge(M.nudge(e, 'items', 's-toiletries-razor', -1), 'items', 's-toiletries-razor', 1);
  assert.deepEqual(M.items(f, 's-toiletries').slice(0, 3).map(x => x.name), ['Toothbrush', 'Razor', 'Floss']);
  assert.equal(M.nudge(f, 'items', 's-toiletries-pain-reliever', 1), f, 'the last one stays last');
});

test('moving things whose places tie', () => {
  // Two phones each added something to the end of a bag at once: both have the same place.
  let doc = M.putBag(M.blankDoc(), { id: 'b1', name: 'Day bag' });
  for (const [id, name, order] of [['i1', 'Water', 0], ['i2', 'Snacks', 1], ['i3', 'Kindle', 1], ['i4', 'Hat', 1], ['i5', 'Map', 2]]) doc = M.putItem(doc, { id, name, bag: 'b1', order });
  const ids = d => M.items(d, 'b1').map(x => x.id);
  assert.deepEqual(ids(doc), ['i1', 'i4', 'i3', 'i2', 'i5'], 'tied places sort by name');
  for (const [id, dir] of [['i3', -1], ['i3', 1], ['i4', -1], ['i2', 1], ['i4', 1], ['i5', -1]]) {
    const want = ids(doc), i = want.indexOf(id);
    [want[i], want[i + dir]] = [want[i + dir], want[i]];
    doc = M.nudge(doc, 'items', id, dir);
    assert.deepEqual(ids(doc), want, `${id} ${dir < 0 ? 'up' : 'down'}`);
  }
});

test('a first merge that makes two of a thing into one keeps its ticks, skips, moves and one-trip things', () => {
  // This phone and the Drive copy each have their own Kindle, Hat and Gym bag, made separately.
  const own = (doc, s) => {
    doc = M.putBag(doc, { id: 'gym' + s, name: 'Gym bag' });
    doc = M.putItem(doc, { id: 'towel' + s, name: 'Towel', bag: 'gym' + s });
    doc = M.putItem(doc, { id: 'kindle' + s, name: 'Kindle', bag: 's-daybag' });
    return M.putItem(doc, { id: 'hat' + s, name: 'Hat', bag: 's-clothes' });
  };
  let phone = trip(own(starter(), 'A'), {});
  phone = M.mark(phone, 't1', 'p:kindleA', 1);
  phone = M.mark(phone, 't1', 'x:hatA', 'skip');
  phone = M.mark(phone, 't1', 'b:s-daybag-sunglasses', 'gymA');
  phone = M.putExtra(phone, 't1', { id: 'e1', name: 'Gift', bag: 'gymA' });
  phone = M.putTrip(phone, { id: 't2', start: T, end: add(T, 2), travel: 'drive' });
  phone = M.mark(phone, 't2', 'x:gymA', 'skip');
  const drive = own(starter(), 'B');
  for (const [local, remote, ids] of [[phone, drive, 'B'], [drive, phone, 'A']]) {
    const m = M.mergeDocs(local, remote, { first: true });
    assert.deepEqual(M.items(m).filter(x => ['Kindle', 'Hat', 'Towel'].includes(x.name)).map(x => x.id).sort(), ['hat', 'kindle', 'towel'].map(x => x + ids));
    const p = plan(m, m.trips.t1), rowOf = n => p.groups.flatMap(g => g.rows).find(r => r.name === n);
    assert.equal(rowOf('Kindle').done, true, 'still ticked');
    assert.ok(p.left.some(l => l.item.name === 'Hat' && l.skipped), 'still left off');
    assert.deepEqual(names(p, 'Gym bag').sort(), ['Gift', 'Sunglasses', 'Towel'], 'moved and added to the one Gym bag');
    assert.deepEqual(plan(m, m.trips.t2).leftBags.filter(l => l.skipped).map(l => l.bag.name), ['Gym bag']);
    assert.equal(M.canon(M.mergeDocs(m, remote)), M.canon(m), 'the next sync changes nothing');
  }
  // Two marks on one key: the newer stays.
  let both = M.mark(phone, 't1', 'p:kindleB', 0);
  later();
  both = M.mark(both, 't1', 'p:kindleA', 1);
  assert.equal(M.mergeDocs(both, drive, { first: true }).trips.t1.marks['p:kindleB'].v, 1);
});

test('two Drive files made at once fold into one, keeping the ids other devices hold', () => {
  // Each phone made its own file. The first file's phone has a Kindle; the second's has one too, ticked on a trip.
  const main = M.putItem(starter(), { id: 'kindleA', name: 'Kindle', bag: 's-daybag' });
  let extra = trip(M.putItem(starter(), { id: 'kindleB', name: 'Kindle', bag: 's-daybag' }), {});
  extra = M.mark(extra, 't1', 'p:kindleB', 1);
  const folded = M.mergeDocs(extra, main, { first: true }); // as sync.js folds the second file into the first
  for (const [who, m] of [['the first file’s phone', M.mergeDocs(main, folded)], ['the second’s', M.mergeDocs(extra, folded, { first: true })]]) {
    assert.deepEqual(M.items(m).filter(x => x.name === 'Kindle').map(x => x.id), ['kindleA'], `one Kindle on ${who}`);
    assert.equal(plan(m, m.trips.t1).groups.flatMap(g => g.rows).find(r => r.name === 'Kindle').done, true, `ticked on ${who}`);
  }
});

test('replacing and adding lists', () => {
  const doc = starter();
  const mine = parsePaste('Bags:\n- Camera\nToiletries bag:\n- Toothbrush\n- Retainer');
  const replaced = M.replaceList(doc, mine);
  assert.deepEqual(M.bags(replaced).map(b => b.name), ['Bags', 'Toiletries bag']);
  const added = M.addList(doc, mine);
  const toil = M.bags(added).find(b => b.name === 'Toiletries bag');
  assert.ok(M.items(added, toil.id).some(x => x.name === 'Retainer'));
  assert.equal(M.items(added, toil.id).filter(x => /toothbrush/i.test(x.name)).length, 1, 'no second toothbrush');
  assert.ok(M.bags(added).some(b => b.name === 'Bags'));
});

test('cleaning keeps junk out', () => {
  const doc = M.cleanDoc({ bags: { b1: { name: 'Ok', kind: 'nope', when: ['rain', 'bad key!'] }, '<x>': { name: 'bad id' } }, items: { i1: { name: '', bag: 'b1' } }, trips: { t1: { start: 'soon' } }, prefs: { units: { v: 'K', t: 1 } } });
  assert.deepEqual(Object.keys(doc.bags), ['b1']);
  assert.equal(doc.bags.b1.kind, 'bag');
  assert.deepEqual(doc.bags.b1.when, ['rain']);
  assert.deepEqual(doc.items, {});
  assert.deepEqual(doc.trips, {});
  assert.deepEqual(doc.prefs, {});
});

// ---------- lists coming in ----------

const KEEP = `Travel list [updated]

  ●​   3ml liquids bag
          ○​    Moisturizer
          ○​    Sunscreen
  ●​   Electronics
          ○​    Headphones
  ●​   Attire
          ○​    Socks
          ○​    Swimsuit
  ●​   Plastic clothes bag
  ●​   Work stuff
          ○​    Badge
  ●​   Wegovy
  ●​   Leaving the house
          ○​    Close windows`;

test('a pasted list from Google Docs: bags, loose things, jobs, and guesses', () => {
  const l = parsePaste(KEEP);
  assert.deepEqual(l.bags.map(b => b.name), ['3ml liquids bag', 'Electronics', 'Attire', 'Work stuff', 'Not in a bag', 'Leaving the house']);
  const by = n => l.items.find(x => x.name === n);
  assert.deepEqual(l.items.filter(x => x.bag === l.bags[4].id).map(x => x.name), ['Plastic clothes bag', 'Wegovy']);
  assert.deepEqual(by('Sunscreen').when, ['sun', 'hot', 'swim']);
  assert.equal(by('Socks').per, 'day');
  assert.deepEqual(l.bags[3].when, ['work']);
  assert.equal(l.bags[5].kind, 'leave');
  assert.equal(l.bags[2].icon, '👕');
});

test('pasted lists: colons, dashes and checkboxes', () => {
  const l = parsePaste('Electronics:\nHeadphones\n☐ Charger\nToiletries\n- [ ] Toothbrush\n- Floss\n\nPassport');
  assert.deepEqual(l.bags.map(b => b.name), ['Electronics', 'Toiletries', 'Not in a bag']);
  assert.deepEqual(l.items.map(x => x.name), ['Headphones', 'Charger', 'Toothbrush', 'Floss', 'Passport']);
  assert.deepEqual(l.items.at(-1).when, ['abroad']);
  assert.equal(parsePaste('Electronics:\nHeadphones').items[0].id, parsePaste('Electronics:\nHeadphones').items[0].id, 'same text, same ids');
});

test('guesses', () => {
  assert.deepEqual(guess('Work Visa card').when, []);
  assert.deepEqual(guess('Passport').when, ['abroad']);
  assert.deepEqual(guess('Rain jacket').when, ['rain']);
  assert.equal(guess('Underwear').per, 'day');
});

test('a list survives a link', async () => {
  const doc = M.putItem(starter(), { id: 's-clothes-belt', name: 'Belt', when: ['dressy'], note: 'the brown one' });
  const list = M.listOf(doc);
  const code = await encodeList(list);
  assert.match(code, /^[\w-]+$/);
  const back = await decodeList(code);
  assert.deepEqual(back.bags.map(b => b.id), list.bags.map(b => b.id));
  assert.equal(back.items.find(x => x.id === 's-clothes-belt').note, 'the brown one');
  await assert.rejects(decodeList('nonsense'));
});

test('qty', () => {
  let doc = M.setPref(starter(), 'laundry', 3);
  doc = trip(doc, {});
  assert.equal(qtyOf(doc, doc.trips.t1, { per: 'day' }), 3);
  assert.equal(qtyOf(doc, doc.trips.t1, { per: '', qty: 2 }), 2);
  assert.ok(conditions(doc, doc.trips.t1).on.fly);
});
