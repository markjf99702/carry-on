// The parts with no page: merging, the trip rules, the weather summary, plugs, and lists coming in.
//   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { plan, conditions, qtyOf } from '../js/rules.js';
import { summarize, stale, tripWeather, forecastEdge } from '../js/weather.js';
import { plugsFor, plugText } from '../js/plugs.js';
import { parsePaste, encodeList, decodeList, guess } from '../js/share.js';
import { starterList } from '../js/starter.js';
import { store } from '../js/store.js'; // in Node there's no localStorage, so it keeps the doc in memory only
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

test('snow isn’t rain: no umbrella on a snow day, both on a day of sleet', () => {
  // Open-Meteo's precipitation total and its chance of precipitation count snow too. Chicago in January.
  const snowDay = { pop: 85, mm: 6.2, snow: 4.3, code: 73 };
  for (const extra of [{}, { rain: 0 }]) { // saved before the rain was asked for, and since
    const w = summarize({ at: 1, days: [day('2027-01-14', -1, -6, { pop: 10 }), day('2027-01-15', -3, -9, { ...snowDay, ...extra })] });
    assert.equal(w.snow, true); assert.equal(w.rain, false, JSON.stringify(extra));
  }
  const sleet = summarize({ at: 1, days: [day('2027-01-15', 2, -1, { pop: 90, mm: 7, snow: 2, rain: 4.2, code: 73 })] });
  assert.equal(sleet.rain, true); assert.equal(sleet.snow, true);
  const rain = summarize({ at: 1, days: [day('2027-04-15', 12, 6, { pop: 60, mm: 1, code: 61 }), day('2027-04-16', 12, 6, { pop: 10, mm: 4 })] });
  assert.deepEqual(rain.rainDays, ['2027-04-15', '2027-04-16']); assert.equal(rain.snow, false);
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Chicago', cc: 'US' }, start: '2027-01-14', end: '2027-01-15', wx: { at: 1, days: [day('2027-01-14', -1, -6), day('2027-01-15', -3, -9, snowDay)] } });
  const p = plan(doc, doc.trips.t1), all = allNames(p);
  for (const n of ['Umbrella', 'Rain jacket']) assert.ok(!all.includes(n), n);
  for (const n of ['Warm coat', 'Snow boots']) assert.ok(all.includes(n), n);
  assert.equal(p.cond.why.snow, 'Snow likely Fri');
});

test('typical weather: rain days are counted without the snow', async () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  // Every past year: 5 mm of water on each day, all of it snow (3.5 cm) in two years and rain in the third.
  const stub = weatherStub(now, (kind, u) => {
    const year = +u.searchParams.get('start_date').slice(0, 4), snowy = year !== 2025;
    return { daily: { precipitation_sum: () => 5, snowfall_sum: () => (snowy ? 3.5 : 0), ...(year === 2024 ? {} : { rain_sum: () => (snowy ? 0 : 5) }) } };
  });
  try {
    const wx = await tripWeather(PLACE, '2027-01-14', '2027-01-15', '2026-11-02', { now });
    assert.ok(stub.calls.every(c => c.startsWith('archive')));
    assert.deepEqual(wx.days.map(d => [d.wet, d.sn]), [[1 / 3, 2 / 3], [1 / 3, 2 / 3]], 'one year in three had rain; 2024 had no rain_sum, so its snow comes off the total');
  } finally { stub.restore(); }
  // The forecast keeps its rain apart, and so does the saved copy.
  const stub2 = weatherStub(now, () => ({ daily: { precipitation_sum: () => 6.2, snowfall_sum: () => 4.3, rain_sum: () => 0, showers_sum: () => 0.4, weather_code: () => 73, precipitation_probability_max: () => 85 } }));
  try {
    const wx = await tripWeather(PLACE, '2026-11-04', '2026-11-04', '2026-11-02', { now });
    assert.equal(wx.days[0].rain, 0.4);
    assert.equal(M.cleanWx(wx).days[0].rain, 0.4);
    assert.equal(summarize(wx).rain, false);
  } finally { stub2.restore(); }
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

// A stand-in for Open-Meteo's forecast and archive in Node: answers each request from the dates it asks for, the
// way the real one does, including its edge: the forecast's end_date may be at most UTC today + 15 days.
// answer(kind, url) can return { daily overrides }, { status, reason } for an error, or an Error for no connection.
function weatherStub(now, answer = () => ({})) {
  const calls = [], was = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = new URL(url), s = u.searchParams, kind = u.hostname.startsWith('archive') ? 'archive' : 'forecast';
    calls.push(`${kind} ${s.get('start_date')} ${s.get('end_date')}`);
    const a = answer(kind, u);
    if (a instanceof Error) throw a;
    const bad = (status, reason) => ({ ok: false, status, json: async () => ({ error: true, reason }) });
    if (a.status) return bad(a.status, a.reason);
    if (kind === 'forecast' && s.get('end_date') > add(new Date(now).toISOString().slice(0, 10), 15)) {
      return bad(400, `Parameter 'end_date' is out of allowed range from 2026-07-25 to ${add(new Date(now).toISOString().slice(0, 10), 15)}`);
    }
    const time = a.time || range(s.get('start_date'), s.get('end_date'));
    const fill = v => time.map(() => v);
    const daily = kind === 'forecast'
      ? { time, temperature_2m_max: fill(20), temperature_2m_min: fill(10), precipitation_probability_max: fill(10), precipitation_sum: fill(0), snowfall_sum: fill(0), uv_index_max: fill(4), weather_code: fill(2) }
      : { time, temperature_2m_max: fill(15), temperature_2m_min: fill(5), precipitation_sum: fill(0), snowfall_sum: fill(0), shortwave_radiation_sum: fill(12) };
    for (const [k, f] of Object.entries(a.daily || {})) daily[k] = time.map((d, i) => f(d, i));
    return { ok: true, status: 200, json: async () => ({ daily }) };
  };
  return { calls, restore: () => { globalThis.fetch = was; } };
}
const PLACE = { name: 'Somewhere', lat: 35.7, lon: 139.7, cc: 'JP' };

test('a forecast east of UTC after local midnight asks only for the days Open-Meteo has', async () => {
  // 05:00 on Oct 27 in Tokyo is still Oct 26 in UTC, and Open-Meteo counts its 16 days from the UTC date.
  const now = Date.parse('2026-10-26T20:00:00Z'), today = '2026-10-27';
  assert.equal(forecastEdge(today, now), '2026-11-10');
  assert.equal(forecastEdge('2026-10-26', Date.parse('2026-10-27T03:00:00Z')), '2026-11-10', 'behind UTC, the local date counts');
  const stub = weatherStub(now);
  try {
    const wx = await tripWeather(PLACE, '2026-11-08', '2026-11-11', today, { now });
    assert.ok(stub.calls.includes('forecast 2026-11-08 2026-11-10'), stub.calls.join(', '));
    assert.deepEqual(wx.days.map(d => [d.d, !!d.typ]), [['2026-11-08', false], ['2026-11-09', false], ['2026-11-10', false], ['2026-11-11', true]]);
    assert.equal(wx.err, undefined);
  } finally { stub.restore(); }
  // The typical day past the edge isn't due for the forecast yet.
  const wx = { at: now, days: [day('2026-11-10', 20, 10), { d: '2026-11-11', typ: 1, hi: 15, lo: 5, mm: 0, wet: 0, sn: 0, rad: 12 }] };
  assert.equal(stale(wx, '2026-11-10', '2026-11-11', today, now + 3600e3), false);
});

test('typical weather lines each past year up by its own dates, 29 February too', async () => {
  // Each past day's high is its day of the month, and its low its month, so a day read from the wrong row shows.
  const byDate = () => ({ daily: { temperature_2m_max: d => +d.slice(8), temperature_2m_min: d => +d.slice(5, 7) } });
  // A trip over 29 February 2028: the years before have no such day, so it takes 1 March, and 2 March is still there.
  let now = Date.parse('2027-12-01T12:00:00Z'), stub = weatherStub(now, byDate);
  try {
    const wx = await tripWeather(PLACE, '2028-02-27', '2028-03-02', '2027-12-01', { now });
    assert.deepEqual(wx.days.map(d => [d.d, d.hi, d.lo]), [['2028-02-27', 27, 2], ['2028-02-28', 28, 2], ['2028-02-29', 1, 3], ['2028-03-01', 1, 3], ['2028-03-02', 2, 3]]);
  } finally { stub.restore(); }
  // A 2027 trip over the end of February: three years back is 2024, whose 29 February isn't 1 March.
  now = Date.parse('2026-12-01T12:00:00Z'); stub = weatherStub(now, byDate);
  try {
    const wx = await tripWeather(PLACE, '2027-02-26', '2027-03-03', '2026-12-01', { now });
    assert.ok(stub.calls.includes('archive 2024-02-26 2024-03-03'), stub.calls.join(', '));
    assert.deepEqual(wx.days.map(d => [d.d, d.hi, d.lo]), [['2027-02-26', 26, 2], ['2027-02-27', 27, 2], ['2027-02-28', 28, 2], ['2027-03-01', 1, 3], ['2027-03-02', 2, 3], ['2027-03-03', 3, 3]]);
  } finally { stub.restore(); }
});

test('a lookup that half fails says so, fills its gaps with typical weather, and looks again soon', async () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), today = '2026-11-02', soon = 31 * 60e3;
  // The forecast fails for a trip that straddles its edge: its days come from the archive too.
  let stub = weatherStub(now, kind => (kind === 'forecast' ? { status: 503, reason: 'Busy' } : {}));
  try {
    const wx = await tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now });
    assert.deepEqual(wx.days.map(d => d.d), range('2026-11-12', '2026-11-22'), 'every day is there');
    assert.ok(wx.days.every(d => d.typ));
    assert.equal(wx.err, 'Couldn’t get the forecast, so these days show typical weather.');
    assert.ok(stub.calls.includes('archive 2025-11-12 2025-11-17') && stub.calls.includes('archive 2025-11-18 2025-11-22'), stub.calls.join(', '));
    assert.equal(M.cleanWx(wx).err, wx.err, 'the saved copy keeps the note');
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + 60e3), false, 'not straight away');
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + soon), true, 'but after half an hour');
  } finally { stub.restore(); }
  // One past year fails: the days come from the other two, and it says so.
  stub = weatherStub(now, (kind, u) => (u.searchParams.get('start_date').startsWith('2024') ? { status: 500, reason: 'Oops' } : { daily: { temperature_2m_max: () => (u.searchParams.get('start_date').startsWith('2025') ? 10 : 20) } }));
  try {
    const wx = await tripWeather(PLACE, '2026-12-20', '2026-12-22', today, { now });
    assert.deepEqual(wx.days.map(d => [d.d, d.hi]), [['2026-12-20', 15], ['2026-12-21', 15], ['2026-12-22', 15]]);
    assert.equal(wx.err, 'Couldn’t get every past year, so typical weather comes from fewer of them.');
    assert.equal(stale(wx, '2026-12-20', '2026-12-22', today, now + soon), true);
  } finally { stub.restore(); }
  // A forecast day with no temperatures: typical weather stands in for it.
  stub = weatherStub(now, kind => (kind === 'forecast' ? { daily: { temperature_2m_max: d => (d === '2026-11-05' ? null : 20) } } : {}));
  try {
    const wx = await tripWeather(PLACE, '2026-11-04', '2026-11-06', today, { now });
    assert.deepEqual(wx.days.map(d => [d.d, !!d.typ]), [['2026-11-04', false], ['2026-11-05', true], ['2026-11-06', false]]);
    assert.ok(stub.calls.includes('archive 2025-11-05 2025-11-05'), stub.calls.join(', '));
    assert.equal(wx.err, 'The forecast left out some days, so they show typical weather.');
  } finally { stub.restore(); }
  // Nothing at all: the first error, as before.
  stub = weatherStub(now, () => new TypeError('Failed to fetch'));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-11-04', '2026-11-06', today, { now }), { message: 'Couldn’t reach the weather service.' });
  } finally { stub.restore(); }
  // A lookup that came back whole needs nothing sooner than before.
  stub = weatherStub(now);
  try {
    const wx = await tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now });
    assert.equal(wx.err, undefined);
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + soon), false);
  } finally { stub.restore(); }
});

test('Open-Meteo’s out-of-range answer reads as plain words', async () => {
  const now = Date.parse('2026-10-26T20:00:00Z');
  const stub = weatherStub(now, kind => (kind === 'forecast' ? { status: 400, reason: "Parameter 'end_date' is out of allowed range from 2026-07-25 to 2026-11-10" } : { status: 500, reason: 'Down' }));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-11-01', '2026-11-03', '2026-10-27', { now }), { message: 'The forecast doesn’t reach that far yet.' });
  } finally { stub.restore(); }
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

test('a trip whose place or dates change loses its old weather on every device', () => {
  const lisbon = { name: 'Lisbon', cc: 'PT', country: 'Portugal', lat: 38.7, lon: -9.1 };
  const reykjavik = { name: 'Reykjavík', cc: 'IS', country: 'Iceland', lat: 64.1, lon: -21.9 };
  const now = Date.parse('2026-11-02T12:00:00Z'), today = '2026-11-02';
  let doc = M.setPref(starter(), 'home', 'US');
  doc = M.putTrip(doc, { id: 't1', place: lisbon, start: '2026-12-20', end: '2026-12-24', travel: 'fly' });
  doc = M.setWx(doc, 't1', { at: Date.now() - 1000, days: range('2026-12-20', '2026-12-24').map(d => ({ d, typ: 1, hi: 20, lo: 11, mm: 2, wet: 0.4, sn: 0, rad: 10 })) });
  const other = doc; // the other phone hasn't heard of the change
  later();
  let edited = M.putTrip(doc, { id: 't1', place: reykjavik, start: '2027-01-10', end: '2027-01-14' });
  edited = M.clearWx(edited, 't1');
  for (const m of [M.mergeDocs(edited, other), M.mergeDocs(other, edited)]) {
    assert.deepEqual(m.trips.t1.wx.days, [], 'none of Lisbon’s days');
    assert.equal(conditions(m, m.trips.t1).weather, null);
    assert.equal(stale(m.trips.t1.wx, '2027-01-10', '2027-01-14', today, now), true, 'so it looks up Reykjavík');
  }
  assert.deepEqual(M.cleanTrip(edited.trips.t1).wx.days, [], 'and the cleared weather saves as it is');
  // Should the old days still come back (from a copy that only dropped them on its own device), they don't count.
  const stray = M.putTrip(other, { id: 't1', place: reykjavik, start: '2027-01-10', end: '2027-01-14' });
  assert.equal(stray.trips.t1.wx.days.length, 5);
  const c = conditions(stray, stray.trips.t1);
  assert.equal(c.weather, null); assert.ok(!c.on.cool && !c.on.rain, 'no Lisbon reasons');
  assert.equal(stale(stray.trips.t1.wx, '2027-01-10', '2027-01-14', today, now), true);
  // Days that cover the trip, and a few more, are fine: only the trip's own count.
  const wider = M.putTrip(other, { id: 't1', start: '2026-12-21', end: '2026-12-23' });
  assert.equal(stale(wider.trips.t1.wx, '2026-12-21', '2026-12-23', today, now), false);
  assert.equal(conditions(wider, wider.trips.t1).weather.minLo, 11);
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

test('a backup brings back starter things deleted since it was saved, and says what came back', () => {
  const none = { things: 0, jobs: 0, bags: 0, lists: 0, occasions: 0, trips: 0 };
  store.erase();
  store.apply(() => trip(M.putItem(starter(), { id: 'i-mine', name: 'My own thing', bag: 's-daybag' }), {}));
  const backup = store.backup();
  later();
  store.apply(d => M.removeTrip(M.removeItem(M.removeItem(M.removeBag(d, 's-leave'), 's-clothes-socks'), 'i-mine'), 't1'));
  const deleted = store.doc;
  assert.deepEqual(store.restoreBackup(backup), { ...none, things: 2, jobs: 4, lists: 1, trips: 1 });
  for (const d of [store.doc, M.mergeDocs(store.doc, deleted)]) {
    assert.ok(!M.gone(d.bags['s-leave']) && !M.gone(d.trips.t1));
    assert.equal(M.items(d, 's-leave').length, 4, 'with its jobs');
    assert.ok(!M.gone(d.items['s-clothes-socks']) && !M.gone(d.items['i-mine']));
  }
  assert.deepEqual(store.restoreBackup(backup), none, 'nothing new the second time');
  // A starter list this phone never had still gives way to its own list.
  store.erase();
  store.apply(() => M.replaceList(M.blankDoc(), parsePaste('Electronics:\n- Phone charger')));
  assert.deepEqual(store.restoreBackup(JSON.stringify(starter())), none);
  assert.deepEqual(M.bags(store.doc).map(b => b.name), ['Electronics']);
  // A backup from another browser with its own Kindle, ticked on a trip there: it becomes this device's Kindle,
  // so the next sync with Drive, which holds this device's ids, doesn't make two.
  store.erase();
  store.apply(() => M.putItem(starter(), { id: 'kindleA', name: 'Kindle', bag: 's-daybag' }));
  const drive = store.doc;
  const other = M.mark(trip(M.putItem(starter(), { id: 'kindleB', name: 'Kindle', bag: 's-daybag' }), {}), 't1', 'p:kindleB', 1);
  assert.deepEqual(store.restoreBackup(JSON.stringify(other)), { ...none, trips: 1 });
  const synced = M.mergeDocs(store.doc, drive);
  assert.deepEqual(M.items(synced).filter(x => x.name === 'Kindle').map(x => x.id), ['kindleA']);
  assert.equal(synced.trips.t1.marks['p:kindleA'].v, 1);
  store.erase();
});

test('a tab that missed another tab’s save reads it before saving over it', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const saved = () => M.cleanDoc(JSON.parse(mem.get('carry-on')));
  try {
    store.erase();
    store.apply(() => starter());
    // Another tab deletes Leaving the house, and this one doesn't hear of it.
    later();
    mem.set('carry-on', M.canon(M.removeBag(saved(), 's-leave')));
    store.apply(d => M.putItem(d, { id: 'i-mine', name: 'My own thing', bag: 's-daybag' }));
    assert.ok(M.gone(saved().bags['s-leave']), 'the other tab’s deletion stays');
    assert.ok(saved().items['i-mine'], 'and this tab’s change is saved too');
    assert.ok(M.gone(store.doc.bags['s-leave']));
    mem.set('carry-on', M.canon(M.removeItem(saved(), 'i-mine')));
    assert.ok(M.gone(M.cleanDoc(JSON.parse(store.backup())).items['i-mine']), 'a backup has it too');
  } finally {
    delete globalThis.localStorage;
    store.erase();
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

test('replacing a list can be undone, everywhere, without bringing back what was deleted before', () => {
  let before = M.putItem(starter(), { id: 'i-mine', name: 'My own thing', bag: 's-daybag' });
  before = M.putTag(M.removeBag(before, 's-work'), { id: 'o-wed', name: 'Wedding' });
  const shown = d => ({ bags: M.bags(d).map(b => `${b.id} ${b.name}`), items: M.items(d).map(x => `${x.id} ${x.name}`), tags: M.tags(d).map(g => `${g.id} ${g.name}`) });
  // A pasted list, and a link from someone whose list started from the starter list too: their Day bag is called
  // Backpack, their Work bag wasn't deleted, and their Wedding occasion is a party.
  let link = M.putBag(starter(), { id: 's-daybag', name: 'Backpack' });
  link = M.putTag(link, { id: 'o-wed', name: 'Party' });
  for (const list of [parsePaste('Beach bag:\n- Towel\n- Sunscreen'), M.listOf(link)]) {
    later();
    const after = M.replaceList(before, list);
    assert.notDeepEqual(shown(after), shown(before));
    later();
    const undone = M.undoReplace(after, before, after);
    assert.deepEqual(shown(undone), shown(before));
    assert.ok(M.gone(undone.bags['s-work']), 'the Work bag stays deleted');
    // Other devices got the replaced list meanwhile: the undo wins there too.
    for (const m of [M.mergeDocs(undone, after), M.mergeDocs(after, undone)]) assert.deepEqual(shown(m), shown(before));
  }
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

test('links with an odd shape, or from another app, say what’s wrong', async () => {
  const pack = async obj => {
    const packed = new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return btoa(String.fromCharCode(...packed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const bags = [{ id: 'b1', name: 'Day bag' }, null, 7, 'Bag'];
  for (const odd of [{ tags: { a: 1 } }, { items: 'Socks' }, { items: { i1: { name: 'Socks', bag: 'b1' } }, tags: 3 }]) {
    const l = await decodeList(await pack({ app: 'carry-on', list: 1, bags, ...odd }));
    assert.deepEqual([l.bags.map(b => b.name), l.items, l.tags], [['Day bag'], [], []]);
  }
  await assert.rejects(decodeList(await pack({ app: 'brickyard', list: 1, sets: [] })), { message: 'That link is for another app, not Carry On.' });
  const cut = { message: 'That link doesn’t hold a Carry On list. It may have been cut short.' };
  for (const code of ['nonsense', '', (await encodeList({ bags: [] })).slice(0, 12), await pack({ list: 1, bags: [] }), await pack({ app: 'carry-on', bags: {} })]) await assert.rejects(decodeList(code), cut);
});

test('qty', () => {
  let doc = M.setPref(starter(), 'laundry', 3);
  doc = trip(doc, {});
  assert.equal(qtyOf(doc, doc.trips.t1, { per: 'day' }), 3);
  assert.equal(qtyOf(doc, doc.trips.t1, { per: '', qty: 2 }), 2);
  assert.ok(conditions(doc, doc.trips.t1).on.fly);
});
