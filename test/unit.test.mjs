// The parts with no page: merging, the trip rules, the weather summary, plugs, and lists coming in.
//   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../js/model.js';
import { plan, conditions, qtyOf, units, grown, whyNot, passes, whenWords, bagComing, legs, legDays } from '../js/rules.js';
import { summarize, stale, tripWeather, tripDays, placeKey, forecastEdge, dayIcon, dayWords, searchPlaces, uvEstimate } from '../js/weather.js';
import { plugsFor, plugText, localCountry } from '../js/plugs.js';
import { parsePaste, encodeList, decodeList, guess, bagIcon, bagKind } from '../js/share.js';
import { starterList } from '../js/starter.js';
import { store } from '../js/store.js'; // in Node there's no localStorage, so it keeps the doc in memory only
import { add, span, yearsBack, range, weekday, short, long, dayLong } from '../js/days.js';

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

test('the starter list has the keys, the tickets, glasses, a neck pillow, a sun hat, a car charger and the hotel fridge', () => {
  const doc = starter(), find = name => M.items(doc).find(x => x.name === name);
  const at = name => [doc.bags[find(name).bag].name, find(name).when];
  assert.deepEqual(at('Keys'), ['Documents and money', []]);
  assert.deepEqual(at('Boarding pass or tickets'), ['Documents and money', ['fly', 'train']]);
  assert.deepEqual(at('Glasses or contacts'), ['Toiletries bag', []]);
  assert.deepEqual(at('Neck pillow'), ['Day bag', ['fly']]);
  assert.deepEqual(at('Sun hat'), ['Clothes', ['hot', 'sun']]);
  assert.deepEqual(at('Car charger'), ['Electronics', ['drive']]);
  assert.deepEqual(at('The fridge and the hooks on the doors'), ['Leaving the hotel', []]);
  assert.equal(find('Power bank').note, 'Carry-on only when flying, never a checked bag');
  assert.equal(find('Prescriptions').note, 'In your carry-on when flying, in case a bag goes missing');
  // A driving trip at home brings the car charger and leaves the tickets and the neck pillow.
  let d = M.setPref(doc, 'home', 'US');
  d = trip(d, { travel: 'drive', place: { name: 'Chicago', cc: 'US', country: 'United States' } });
  const p = plan(d, d.trips.t1), all = allNames(p);
  assert.ok(all.includes('Car charger') && all.includes('Keys'));
  assert.ok(!all.includes('Boarding pass or tickets') && !all.includes('Neck pillow'));
  assert.equal(p.groups.flatMap(g => g.rows).find(r => r.name === 'Power bank').note, 'Carry-on only when flying, never a checked bag');
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
  assert.match(p.cond.why.plug, /Type C\/F, 230\u00a0V/);
  doc = trip(doc, { place: { name: 'Tokyo', cc: 'JP', country: 'Japan' } });
  p = plan(doc, doc.trips.t1);
  assert.ok(allNames(p).includes('Passport'));
  assert.ok(!allNames(p).includes('Plug adapter'), 'US plugs fit in Japan');
});

test('Puerto Rico, Guam, the US Virgin Islands and the Northern Mariana Islands count as home from the US, and the other way round', () => {
  const go = (home, ...places) => {
    let doc = trip(M.setPref(starter(), 'home', home), { place: places[0] });
    if (places[1]) doc = M.putStop(doc, 't1', { place: places[1], from: add(T, 2) });
    return plan(doc, doc.trips.t1);
  };
  const sanJuan = { name: 'San Juan', cc: 'PR', country: 'Puerto Rico' }, guam = { name: 'Hagåtña', cc: 'GU', country: 'Guam' };
  const chicago = { name: 'Chicago', cc: 'US', country: 'United States' }, pagoPago = { name: 'Pago Pago', cc: 'AS', country: 'American Samoa' };
  let p = go('US', sanJuan);
  assert.equal(p.cond.auto.abroad, false);
  assert.ok(!allNames(p).includes('Passport'), 'no passport for Puerto Rico');
  assert.equal(p.cond.no.abroad, 'Puerto Rico counts as home');
  // Its plugs are still its own country's, and they're the same.
  assert.equal(p.cond.auto.plug, false);
  assert.equal(p.cond.no.plug, 'Your plugs fit there');
  for (const [home, place] of [['PR', chicago], ['GU', chicago], ['VI', sanJuan], ['MP', guam], ['US', { name: 'Charlotte Amalie', cc: 'VI', country: 'U.S. Virgin Islands' }]]) {
    assert.equal(go(home, place).cond.auto.abroad, false, `${home} to ${place.cc}`);
  }
  // American Samoa runs its own entry checks.
  p = go('US', pagoPago);
  assert.equal(p.cond.auto.abroad, true);
  assert.ok(allNames(p).includes('Passport'));
  assert.equal(go('AS', chicago).cond.auto.abroad, true);
  // Anywhere else is still abroad from them, and two places that both count as home say so.
  assert.equal(go('PR', { name: 'Lisbon', cc: 'PT', country: 'Portugal' }).cond.auto.abroad, true);
  assert.equal(go('DE', sanJuan).cond.auto.abroad, true);
  assert.equal(go('US', sanJuan, guam).cond.no.abroad, 'Puerto Rico and Guam count as home');
  assert.equal(go('US', chicago).cond.no.abroad, 'In your home country');
});

test('where only some of your plugs fit, it says which, and the adapter stays for you to bring', () => {
  assert.equal(plugsFor('DE', 'CH').some, 'Two-pin plugs fit; grounded ones may need an adapter', 'a Schuko plug isn’t a Swiss one');
  assert.equal(plugsFor('US', 'CN').some, 'Two-pin plugs fit; grounded ones may need an adapter');
  assert.equal(plugsFor('US', 'JP').some, 'Two-pin plugs with blades the same width fit; others may need an adapter', 'older Japanese sockets are unpolarised');
  assert.equal(plugsFor('BZ', 'GB').some, 'Type G plugs fit; type A/B may need an adapter', 'a grounded plug that fits, and two-pin ones that don’t');
  for (const [a, b] of [['DE', 'FR'], ['GB', 'IE'], ['JP', 'US'], ['US', 'MX'], ['US', 'GB']]) assert.equal(plugsFor(a, b).some, '', `${a} to ${b}`);
  const go = (home, ...places) => {
    let doc = trip(M.setPref(starter(), 'home', home), { place: places[0] });
    if (places[1]) doc = M.putStop(doc, 't1', { place: places[1], from: add(T, 2) });
    return plan(doc, doc.trips.t1);
  };
  const zurich = { name: 'Zürich', cc: 'CH', country: 'Switzerland' }, paris = { name: 'Paris', cc: 'FR', country: 'France' };
  let p = go('DE', zurich);
  assert.equal(p.cond.auto.plug, false);
  assert.ok(!allNames(p).includes('Plug adapter'), 'no adapter on its own');
  assert.equal(p.cond.plugNote, 'Two-pin plugs fit; grounded ones may need an adapter');
  assert.equal(p.cond.no.plug, 'Two-pin plugs fit; grounded ones may need an adapter');
  assert.equal(p.cond.why.abroad, 'Switzerland', 'the passport’s reason is still the country');
  // With stops, each country that only partly fits is named, after the ones that fit.
  p = go('DE', paris, zurich);
  assert.equal(p.cond.plugNote, 'Switzerland: two-pin plugs fit; grounded ones may need an adapter');
  assert.equal(p.cond.no.plug, 'Your plugs fit in France · Switzerland: two-pin plugs fit; grounded ones may need an adapter');
  // Where every plug fits, nothing more to say.
  p = go('DE', paris);
  assert.equal(p.cond.plugNote, '');
  assert.equal(p.cond.no.plug, 'Your plugs fit there');
});

test('the first guess at home, from the browser’s languages', () => {
  const cases = [
    [['de'], 'DE'], [['fr'], 'FR'], [['ja'], 'JP'], [['zh-Hant-TW'], 'TW'], [['sr-Latn-RS'], 'RS'],
    [['de', 'en-US', 'en'], 'DE'], // Firefox in German: the first language counts, not the English after it
    [['en', 'en-GB'], 'GB'], [['en-US', 'en'], 'US'], [['pt-PT', 'pt'], 'PT'], [['zh-Hant'], 'TW'],
    [['en'], 'US'], [[], 'US'], [['!!', 'nl'], 'NL'], [['es-419'], 'US'],
  ];
  for (const [langs, cc] of cases) assert.equal(localCountry(langs), cc, langs.join(','));
});

test('°F where the weather service reports in it', () => {
  // Wikipedia, "Fahrenheit" (revision of 16 Oct 2026): the US and its territories, Palau, Micronesia, the Marshall
  // Islands and the Cayman Islands. Liberia was already here.
  for (const cc of ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'PW', 'FM', 'MH', 'KY', 'LR']) assert.equal(units(M.setPref(M.blankDoc(), 'home', cc)), 'F', cc);
  for (const cc of ['CA', 'GB', 'MX', 'BS', 'DE']) assert.equal(units(M.setPref(M.blankDoc(), 'home', cc)), 'C', cc);
  assert.equal(units(M.setPref(M.setPref(M.blankDoc(), 'home', 'PR'), 'units', 'C')), 'C', 'unless you say');
});

test('plugs', () => {
  assert.equal(plugsFor('US', 'GB').need, true);
  assert.equal(plugsFor('US', 'MX').need, false);
  assert.equal(plugsFor('DE', 'FR').need, false, 'a Europlug fits French sockets');
  assert.equal(plugsFor('GB', 'IE').need, false);
  assert.equal(plugsFor('US', 'GB').voltsDiffer, true);
  assert.equal(plugText(plugsFor('US', 'AU')), 'Type I, 230\u00a0V', 'with no break before the V');
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

test('typical weather’s UV: an estimate, held to the same UV 6 as the forecast', async () => {
  // Six real places and weeks, the estimate from the archive's sunshine for the same dates in the three years before
  // (each day's mean, MJ/m²), against the most the forecast's own UV index said (Open-Meteo's historical forecast,
  // read 27 October 2026). It makes the forecast's call on five of the six; Cancún, at 6.2, it puts at about 5.
  const cases = [
    ['Mexico City, January', 19.4326, 2230, '2026-01-12', [16.83, 17.41, 18.31, 20.13, 20.35, 19.43, 19.87], 7.15],
    ['Cancún, January', 21.1743, 9, '2026-01-12', [16.76, 14.54, 14.01, 16.32, 15.53, 14.46, 15.79], 6.2],
    ['Honolulu, December', 21.3069, 4, '2025-12-08', [15.13, 16.61, 15.69, 15.68, 14.57, 14.11, 14.65], 5.9],
    ['Stockholm, June', 59.3293, 24, '2026-06-15', [26.14, 20.63, 23.94, 19.54, 20.71, 23.61, 25.92], 6.2],
    ['Aspen, March', 39.1911, 2404, '2026-03-09', [21.26, 16.44, 18.43, 17.67, 17.43, 16.02, 14.44], 6.7],
    ['Lisbon, October', 38.7223, 66, '2026-10-13', [12.37, 15.04, 8.9, 10.85, 11.43, 13.49, 8.03], 5.25],
  ];
  const calls = cases.map(([name, lat, elev, from, rad, forecast]) => {
    const days = rad.map((r, i) => ({ d: add(from, i), typ: 1, hi: 20, lo: 10, mm: 0, wet: 0, sn: 0, rad: r, uv: uvEstimate(lat, add(from, i), elev, r) }));
    return [name, summarize({ days }).sun, forecast >= 6];
  });
  assert.deepEqual(calls.filter(([, est, fc]) => est !== fc).map(([name]) => name), ['Cancún, January']);
  assert.deepEqual(calls.map(([, est]) => est), [true, false, false, true, true, false]);
  // Higher up, and nearer the sun's path, is stronger; clouds take it off; a polar night has none.
  assert.ok(uvEstimate(19.4, '2027-01-15', 2230, 20) > uvEstimate(19.4, '2027-01-15', 0, 20));
  assert.ok(uvEstimate(-33.9, '2027-01-15', 0, 30) > 9, 'Sydney in January');
  assert.ok(uvEstimate(-33.9, '2027-07-15', 0, 12) < 3, 'Sydney in July');
  assert.ok(uvEstimate(19.4, '2027-01-15', 0, 10) < uvEstimate(19.4, '2027-01-15', 0, 20));
  assert.equal(uvEstimate(78.2, '2027-12-15', 0, 0), 0, 'Svalbard in December');
  // The lookup puts it on each typical day, from the archive's height for the place, and the saved copy keeps it.
  const now = Date.parse('2026-11-02T12:00:00Z');
  const stub = weatherStub(now, (kind, u) => ({ raw: { elevation: 2230, daily: (() => {
    const time = range(u.searchParams.get('start_date'), u.searchParams.get('end_date'));
    return { time, temperature_2m_max: time.map(() => 22), temperature_2m_min: time.map(() => 8), precipitation_sum: time.map(() => 0), snowfall_sum: time.map(() => 0), shortwave_radiation_sum: time.map(() => 18) };
  })() } }));
  try {
    const wx = await tripWeather({ name: 'Mexico City', lat: 19.4326, lon: -99.1332, cc: 'MX' }, '2027-01-14', '2027-01-15', '2026-11-02', { now });
    assert.equal(wx.days[0].uv, uvEstimate(19.4326, '2027-01-14', 2230, 18));
    assert.equal(M.cleanWx(wx).days[0].uv, Math.round(wx.days[0].uv * 10) / 10);
    assert.equal(summarize(wx).sun, true, 'Mexico City in January has strong sun, with less than the 20 MJ of sunshine that used to decide');
  } finally { stub.restore(); }
  // In words: about, for an estimate.
  const doc = M.setPref(starter(), 'home', 'US');
  const reasons = days => { const d = trip(doc, { place: { name: 'Cancún', cc: 'MX', country: 'Mexico' }, start: days[0].d, end: days.at(-1).d, wx: { at: 1, days } }); return conditions(d, d.trips.t1); };
  const typ = (d, uv, rad = 15) => ({ d, typ: 1, hi: 24, lo: 18, mm: 0, wet: 0, sn: 0, rad, uv });
  assert.equal(reasons([typ('2027-01-14', 7.6), typ('2027-01-15', 6.8)]).why.sun, 'UV about 8 then');
  assert.equal(reasons([typ('2027-01-14', 3.6, 25)]).no.sun, 'UV about 4 then', 'a long sunny day with a low sun isn’t strong sun');
  assert.equal(reasons([day('2027-01-12', 24, 18, { uv: 5 }), typ('2027-01-13', 4.2)]).no.sun, 'UV up to 5, then about 4');
  // Typical days saved before the estimate go by their sunshine, as they did, until they're looked up again.
  const old = { d: '2027-06-15', typ: 1, hi: 20, lo: 10, mm: 0, wet: 0, sn: 0, rad: 22 };
  assert.equal(summarize({ days: [old] }).sun, true);
  assert.equal(M.cleanWx({ at: 1, days: [old] }).days[0].uv, undefined);
});

test('weather: cold, cool and typical weather', () => {
  const cold = summarize({ at: 1, days: [day('2026-12-01', 3, -4), day('2026-12-02', 5, -2, { snow: 2 })] });
  assert.equal(cold.cold, true); assert.equal(cold.cool, false); assert.deepEqual(cold.snowDays, ['2026-12-02']);
  const cool = summarize({ at: 1, days: [day('2026-10-01', 19, 11)] });
  assert.equal(cool.cool, true); assert.equal(cool.cold, false);
  const typ = summarize({ at: 1, days: [{ d: '2027-03-01', typ: 1, hi: 14, lo: 8, mm: 3, wet: 0.67, sn: 0, rad: 9 }, { d: '2027-03-02', typ: 1, hi: 13, lo: 7, mm: 0, wet: 0.33, sn: 0, rad: 12 }] });
  assert.equal(typ.typical, true); assert.equal(typ.rain, true); assert.equal(typ.sun, false); assert.equal(typ.cool, true);
});

test('the reasons say what the rules saw', () => {
  const doc = M.setPref(starter(), 'home', 'US');
  const why = (days, place = { name: 'Seattle', cc: 'US' }) => {
    const d = trip(doc, { place, start: days[0].d, end: days.at(-1).d, wx: { at: 1, days } });
    return conditions(d, d.trips.t1).why;
  };
  const typ = (d, hi, lo, extra = {}) => ({ d, typ: 1, hi, lo, mm: 0, wet: 0, sn: 0, rad: 5, ...extra });
  // Seattle in late November: cold from the highs, not the lows.
  assert.equal(why([typ('2026-11-23', 9, 5), typ('2026-11-24', 9, 6)]).cold, 'Highs around 48°');
  assert.equal(why([day('2026-12-01', 3, -4), day('2026-12-02', 5, -2)]).cold, 'Lows down to 25°');
  // Rain from the millimetres on a day with a low chance is forecast, not likely.
  assert.equal(why([day('2026-11-02', 15, 8, { pop: 20, mm: 4 }), day('2026-11-03', 15, 8, { pop: 10 })]).rain, 'Rain forecast Mon');
  assert.equal(why([day('2026-11-02', 15, 8, { pop: 70, mm: 4 }), day('2026-11-03', 15, 8, { pop: 20, mm: 5 })]).rain, 'Rain forecast Mon and Tue');
  assert.equal(why([day('2026-11-02', 15, 8, { pop: 70, mm: 4 }), day('2026-11-03', 15, 8, { pop: 60 })]).rain, 'Rain likely Mon and Tue');
  // Over more than a week a weekday could be either of two, so it has its date: two weeks from Sun 1 Nov.
  const wet = d => (d === '2026-11-02' || d === '2026-11-09' ? { pop: 70, mm: 4 } : {});
  assert.equal(why(range('2026-11-01', '2026-11-15').map(d => day(d, 15, 8, wet(d)))).rain, 'Rain likely Mon 2 and Mon 9');
  assert.equal(why(range('2026-11-01', '2026-11-15').map(d => day(d, 15, 8, d === '2026-11-02' || d === '2026-11-08' ? { pop: 70 } : {}))).rain, 'Rain likely Mon and Sun', 'a week or less: weekdays alone');
  assert.equal(why(range('2026-11-01', '2026-11-15').map(d => day(d, 15, 8, d < '2026-11-05' ? { pop: 70 } : {}))).rain, 'Rain likely on 4 days');
  // Typical weather that's wet or snowy nearly every day.
  assert.equal(why([typ('2027-01-10', -2, -8, { wet: 0.9, sn: 0.95 })]).rain, 'Rain most days this time of year');
  assert.equal(why([typ('2027-01-10', -2, -8, { wet: 0.9, sn: 0.95 })]).snow, 'Snow most days this time of year');
  assert.equal(why([typ('2027-01-10', -2, -8, { wet: 0.4, sn: 0.2 })]).rain, 'Rain on about 4 days in 10 this time of year');
  assert.equal(why([typ('2027-01-10', -2, -8, { wet: 0.4, sn: 0.2 })]).snow, 'Snow on about 2 days in 10 this time of year');
  // The plug: one line, no brackets.
  assert.equal(why([day('2026-11-02', 15, 8)], { name: 'Lisbon', cc: 'PT', country: 'Portugal' }).plug, 'Type C/F, 230\u00a0V · check anything that heats up');
});

test('why something isn’t coming, in words: conditions by their phrase, occasions by name', () => {
  const doc = starter(), work = M.tags(doc).find(g => g.name === 'Work').id, swim = M.tags(doc).find(g => g.name === 'Swimming').id;
  const why = (when, unless = [], on = {}) => whyNot(doc, { when, unless }, passes({ when, unless }, on));
  assert.equal(why(['cool']), 'Only when it’s cool');
  assert.equal(why(['abroad']), 'Only when abroad');
  assert.equal(why(['cold', 'snow']), 'Only when it’s cold or snow’s likely');
  assert.equal(why([work]), 'Only for work');
  assert.equal(why(['hot', swim]), 'Only when it’s hot or for swimming');
  assert.equal(why(['hot', 'sun', swim]), 'Only when it’s hot or the sun’s strong, or for swimming');
  assert.equal(why([], ['drive'], { drive: true }), 'Not when you’re driving');
  assert.equal(why([], [work], { [work]: true }), 'Not for work');
  assert.equal(whenWords(doc, ['plug']), 'when the plugs are different');
});

test('each day’s picture has words for a screen reader', () => {
  const words = [0, 2, 3, 45, 53, 63, 73, 81, 85, 95].map(code => [dayIcon({ code }), dayWords({ code })]);
  assert.deepEqual(words, [['☀️', 'sunny'], ['🌤️', 'partly cloudy'], ['☁️', 'cloudy'], ['🌫️', 'fog'], ['🌦️', 'drizzle'], ['🌧️', 'rain'], ['🌨️', 'snow'], ['🌦️', 'showers'], ['🌨️', 'snow showers'], ['⛈️', 'thunderstorms']]);
  const typ = extra => ({ typ: 1, wet: 0, sn: 0, rad: 10, ...extra });
  assert.deepEqual([typ({ sn: 0.5 }), typ({ wet: 0.67 }), typ({ wet: 0.33 }), typ({ rad: 20 }), typ({})].map(dayWords), ['snowy', 'often wet', 'sometimes wet', 'usually sunny', 'usually dry']);
  assert.equal(dayWords({}), '');
});

test('the conditions sheet says why the place or weather says no', () => {
  const doc = M.setPref(M.setPref(starter(), 'home', 'US'), 'units', 'F');
  const no = (days, place = { name: 'Seattle', cc: 'US' }) => {
    const d = trip(doc, { place, start: days[0].d, end: days.at(-1).d, wx: days.length ? { at: 1, days } : undefined });
    return conditions(d, d.trips.t1).no;
  };
  const typ = (d, hi, lo, extra = {}) => ({ d, typ: 1, hi, lo, mm: 0, wet: 0, sn: 0, rad: 5, ...extra });
  const mild = no([day('2026-11-02', 22, 16, { pop: 10, uv: 4 }), day('2026-11-03', 24, 17, { pop: 20, uv: 5 })]);
  assert.deepEqual([mild.hot, mild.cool, mild.cold, mild.rain, mild.snow, mild.sun, mild.abroad, mild.plug],
    ['Highs up to 75°', 'Lows 61° and up', 'Lows 61° and up', 'No rain forecast', 'No snow forecast', 'UV up to 5', 'In your home country', 'In your home country']);
  assert.equal(no([day('2026-12-01', 3, -4)]).cool, 'Cold instead');
  const far = no([typ('2027-03-01', 14, 8, { wet: 0.2, sn: 0 }), typ('2027-03-02', 13, 7, { wet: 0.2, sn: 0.1 })]);
  assert.deepEqual([far.rain, far.snow, far.sun], ['Rain on about 2 days in 10', 'Snow on about 1 day in 10', 'Not much sun then']);
  assert.equal(no([typ('2027-03-01', 14, 8, { wet: 0.02 })]).rain, 'Hardly any rain then');
  // Abroad where the plugs fit, and where only some do.
  assert.equal(no([day('2026-11-02', 15, 8)], { name: 'Mexico City', cc: 'MX', country: 'Mexico' }).plug, 'Your plugs fit there');
  assert.equal(no([day('2026-11-02', 15, 8)], { name: 'Tokyo', cc: 'JP', country: 'Japan' }).plug, 'Two-pin plugs with blades the same width fit; others may need an adapter');
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
    if (a.raw) return { ok: true, status: 200, json: async () => a.raw };
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
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + 60e3, PLACE), false, 'not straight away');
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + soon, PLACE), true, 'but after half an hour');
  } finally { stub.restore(); }
  // One past year fails: the days come from the other two, and it says so.
  stub = weatherStub(now, (kind, u) => (u.searchParams.get('start_date').startsWith('2024') ? { status: 500, reason: 'Oops' } : { daily: { temperature_2m_max: () => (u.searchParams.get('start_date').startsWith('2025') ? 10 : 20) } }));
  try {
    const wx = await tripWeather(PLACE, '2026-12-20', '2026-12-22', today, { now });
    assert.deepEqual(wx.days.map(d => [d.d, d.hi]), [['2026-12-20', 15], ['2026-12-21', 15], ['2026-12-22', 15]]);
    assert.equal(wx.err, 'Couldn’t get every past year, so typical weather comes from fewer of them.');
    assert.equal(stale(wx, '2026-12-20', '2026-12-22', today, now + soon, PLACE), true);
  } finally { stub.restore(); }
  // A forecast day with no temperatures: typical weather stands in for it.
  stub = weatherStub(now, kind => (kind === 'forecast' ? { daily: { temperature_2m_max: d => (d === '2026-11-05' ? null : 20) } } : {}));
  try {
    const wx = await tripWeather(PLACE, '2026-11-04', '2026-11-06', today, { now });
    assert.deepEqual(wx.days.map(d => [d.d, !!d.typ]), [['2026-11-04', false], ['2026-11-05', true], ['2026-11-06', false]]);
    assert.ok(stub.calls.includes('archive 2025-11-05 2025-11-05'), stub.calls.join(', '));
    assert.equal(wx.err, 'The forecast left out some days, so they show typical weather.');
  } finally { stub.restore(); }
  // A forecast that comes back in a shape it can't read counts as one that failed.
  stub = weatherStub(now, kind => (kind === 'forecast' ? { raw: { daily: { time: 'soon' } } } : {}));
  try {
    const wx = await tripWeather(PLACE, '2026-11-04', '2026-11-06', today, { now });
    assert.deepEqual(wx.days.map(d => [d.d, !!d.typ]), [['2026-11-04', true], ['2026-11-05', true], ['2026-11-06', true]]);
    assert.equal(wx.err, 'Couldn’t get the forecast, so these days show typical weather.');
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
    assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + soon, PLACE), false);
  } finally { stub.restore(); }
});

test('a forecast that can’t be updated keeps the last one for up to a day, and says when it’s from', async () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), today = '2026-11-02', soon = 31 * 60e3;
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // The last lookup: the forecast to its edge (17 November), warm, and typical weather after it.
  const last = (at, to = '2026-11-17') => ({
    at, for: placeKey(PLACE),
    days: [...range('2026-11-12', to).map(d => day(d, 23, 14, { uv: 5, code: 1 })), ...range(add(to, 1), '2026-11-22').map(d => ({ d, typ: 1, hi: 15, lo: 5, mm: 0, wet: 0, sn: 0, rad: 12 }))],
  });
  const busy = kind => (kind === 'forecast' ? { status: 503, reason: 'Busy' } : {});
  const look = async (prev, at = now) => {
    const stub = weatherStub(at, busy);
    try { return { wx: await tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now: at, prev }), calls: stub.calls }; } finally { stub.restore(); }
  };
  // From two hours ago: its forecast days stay, and only the days past the forecast are looked up in the archive.
  const was = now - 2 * 3600e3;
  let { wx, calls } = await look(last(was));
  assert.deepEqual(wx.days.map(d => [d.d, d.hi, !!d.typ]), [...range('2026-11-12', '2026-11-17').map(d => [d, 23, false]), ...range('2026-11-18', '2026-11-22').map(d => [d, 15, true])]);
  assert.equal(wx.err, `Couldn’t update the forecast; this one is from ${time(was)}.`);
  assert.equal(wx.fcAt, was);
  assert.ok(!calls.some(c => c.startsWith('archive 2025-11-12')), calls.join(', '));
  assert.equal(summarize(wx).hot, false, 'the kept forecast counts as a forecast');
  assert.equal(M.cleanWx(wx).fcAt, was, 'the saved copy keeps when it’s from');
  assert.equal(stale(wx, '2026-11-12', '2026-11-22', today, now + soon, PLACE), true, 'and it tries again after half an hour');
  const kept = wx;
  // A day the last forecast didn't reach shows typical weather, and the note says so.
  ({ wx } = await look(last(was, '2026-11-15')));
  assert.deepEqual(wx.days.filter(d => !d.typ).map(d => d.d), range('2026-11-12', '2026-11-15'));
  assert.equal(wx.err, `Couldn’t update the forecast; this one is from ${time(was)}. Days it didn’t reach show typical weather.`);
  // From the day before, it says so.
  ({ wx } = await look(last(now - 13 * 3600e3)));
  assert.match(wx.err, /^Couldn’t update the forecast; this one is from yesterday, /);
  // A day old or more, or none at all, or another place's: typical weather, as before.
  for (const prev of [last(now - 25 * 3600e3), null, { ...last(was), for: '1,1' }]) {
    ({ wx } = await look(prev));
    assert.ok(wx.days.every(d => d.typ));
    assert.equal(wx.err, 'Couldn’t get the forecast, so these days show typical weather.');
    assert.equal(wx.fcAt, undefined);
  }
  // Failing again, it's kept only as long as a day from when the forecast came, not from the last try.
  ({ wx } = await look(kept, was + 20 * 3600e3));
  assert.equal(wx.fcAt, was);
  ({ wx } = await look(kept, was + 25 * 3600e3));
  assert.ok(wx.days.every(d => d.typ), 'a day after it came, it goes');
  // One that a copy of Carry On from before this saved without saying when it's from isn't kept again.
  const { fcAt, ...stripped } = kept;
  ({ wx } = await look(stripped, now + 3600e3));
  assert.ok(wx.days.every(d => d.typ));
  // A trip the forecast reaches all of, when the service has had too many lookups today: its days are all kept, and
  // nothing is asked of the archive.
  let stub = weatherStub(now, kind => (kind === 'forecast' ? { status: 429, reason: 'Daily API request limit exceeded. Please try again tomorrow.' } : {}));
  try {
    wx = await tripWeather(PLACE, '2026-11-12', '2026-11-15', today, { now, prev: last(was) });
    assert.deepEqual(wx.days.map(d => [d.d, d.hi, !!d.typ]), range('2026-11-12', '2026-11-15').map(d => [d, 23, false]));
    assert.equal(wx.err, `Couldn’t update the forecast; this one is from ${time(was)}.`);
    assert.deepEqual(stub.calls, ['forecast 2026-11-12 2026-11-15']);
  } finally { stub.restore(); }
  // Too many lookups for the archive as well, on a trip that goes past the forecast: what's kept doesn't cover the
  // trip, so the lookup fails as a whole and the last one stays, its typical days and all.
  stub = weatherStub(now, () => ({ status: 429, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now, prev: last(was) }), { message: 'The weather service has had too many lookups today. It tries again later.' });
  } finally { stub.restore(); }
  // No connection at all: nothing new came back, so the lookup fails as a whole and the last one stays as it was.
  stub = weatherStub(now, () => new TypeError('Failed to fetch'));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now, prev: last(was) }), { message: 'Couldn’t reach the weather service.' });
  } finally { stub.restore(); }
  // A forecast that comes back takes over, with no note.
  stub = weatherStub(now);
  try {
    wx = await tripWeather(PLACE, '2026-11-12', '2026-11-22', today, { now, prev: kept });
    assert.equal(wx.err, undefined);
    assert.equal(wx.fcAt, undefined);
  } finally { stub.restore(); }
});

test('Open-Meteo’s out-of-range answer reads as plain words', async () => {
  const now = Date.parse('2026-10-26T20:00:00Z');
  const stub = weatherStub(now, kind => (kind === 'forecast' ? { status: 400, reason: "Parameter 'end_date' is out of allowed range from 2026-07-25 to 2026-11-10" } : { status: 500, reason: 'Down' }));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-11-01', '2026-11-03', '2026-10-27', { now }), { message: 'The forecast doesn’t reach that far yet.' });
  } finally { stub.restore(); }
  // Only the forecast's: the archive saying it doesn't have a day isn't about the forecast.
  const stub2 = weatherStub(now, () => ({ status: 400, reason: "Parameter 'end_date' is out of allowed range from 1940-01-01 to 2026-10-20" }));
  try {
    await assert.rejects(tripWeather(PLACE, '2026-12-01', '2026-12-03', '2026-10-27', { now }), { message: "The weather service said no (400: Parameter 'end_date' is out of allowed range from 1940-01-01 to 2026-10-20)." });
  } finally { stub2.restore(); }
});

test('a busy or broken weather service says so in plain words, with no status codes', async () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), today = '2026-11-02';
  const said = async answer => {
    const stub = weatherStub(now, () => answer);
    try { return await tripWeather(PLACE, '2026-11-04', '2026-11-06', today, { now }).then(() => 'no error', e => e.message); } finally { stub.restore(); }
  };
  // What Open-Meteo answers when its daily limit is used up.
  assert.equal(await said({ status: 429, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }), 'The weather service has had too many lookups today. It tries again later.');
  // Its limits for an hour and a minute (600 a minute, 5,000 an hour, 10,000 a day on the free API) aren't "today".
  assert.equal(await said({ status: 429, reason: 'Minutely API request limit exceeded. Please try again in one minute.' }), 'The weather service has had too many lookups just now. It tries again later.');
  assert.equal(await said({ status: 429 }), 'The weather service has had too many lookups just now. It tries again later.');
  assert.equal(await said({ status: 503, reason: 'Service Unavailable' }), 'The weather service isn’t answering right now.');
  assert.equal(await said({ status: 500 }), 'The weather service isn’t answering right now.');
  // Anything else gives its own words, without a doubled full stop.
  assert.equal(await said({ status: 418, reason: 'Short and stout.' }), 'The weather service said no (418: Short and stout).');
  assert.equal(await said({ status: 404 }), 'The weather service said no (404).');
  // Place search, which tries again only when something's typed.
  const was = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }) });
  try { await assert.rejects(searchPlaces('Lisbon'), { message: 'Place search has had too many lookups today. Try again later.' }); } finally { globalThis.fetch = was; }
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

test('coming home lists what went, though it was deleted from My list since, alone or with its bag', () => {
  let doc = trip(starter(), { travel: 'drive' });
  const rowsOf = p => p.groups.flatMap(g => g.rows.map(r => `${g.bag.name}: ${r.name}${r.deleted ? ' (deleted)' : ''}`));
  for (const k of ['p:s-electronics-power-bank', 'p:s-electronics-phone-charger', 'p:s-electronics-headphones', 'p:s-clothes-shoes', 'p:s-daybag-sunglasses', 'p:s-leave-water-the-plants']) doc = M.mark(doc, 't1', k, 1);
  doc = M.mark(doc, 't1', 'b:s-daybag-sunglasses', 's-clothes');
  const before = plan(doc, doc.trips.t1, 'back');
  // A thing deleted on its own: still in its bag, saying so.
  let d = M.removeItem(doc, 's-electronics-power-bank');
  let back = plan(d, d.trips.t1, 'back');
  assert.deepEqual(rowsOf(back), ['Electronics: Phone charger', 'Electronics: Headphones', 'Electronics: Power bank (deleted)', 'Clothes: Sunglasses', 'Clothes: Shoes']);
  assert.equal(back.total, before.total);
  const row = back.groups[0].rows[2];
  assert.equal(row.key, 'r:s-electronics-power-bank');
  d = M.mark(d, 't1', 'r:s-electronics-power-bank', 1);
  assert.equal(plan(d, d.trips.t1, 'back').groups[0].rows[2].done, true, 'and it ticks');
  // Going, it's gone.
  assert.ok(!allNames(plan(d, d.trips.t1)).includes('Power bank'));
  // A whole bag deleted: its packed things come home with the things not in a bag.
  d = M.removeBag(doc, 's-electronics');
  back = plan(d, d.trips.t1, 'back');
  assert.deepEqual(rowsOf(back), ['Clothes: Sunglasses', 'Clothes: Shoes', 'Not in a bag: Phone charger (deleted)', 'Not in a bag: Headphones (deleted)', 'Not in a bag: Power bank (deleted)']);
  assert.equal(back.total, before.total);
  // One moved to another bag this trip, deleted with its own bag, comes home in the bag it went in.
  d = M.removeBag(doc, 's-daybag');
  back = plan(d, d.trips.t1, 'back');
  assert.deepEqual(rowsOf(back).filter(r => /Sunglasses/.test(r)), ['Clothes: Sunglasses (deleted)']);
  // Only what was packed going; and a job done before leaving the house isn't one to bring home.
  d = M.removeItem(M.removeItem(doc, 's-electronics-laptop-and-charger'), 's-leave-water-the-plants');
  back = plan(d, d.trips.t1, 'back');
  assert.equal(back.total, before.total);
  assert.ok(!allNames(back).includes('Laptop and charger'));
  assert.ok(!back.tasks.flatMap(g => g.rows).some(r => r.name === 'Water the plants'));
  // Nothing ticked going: everything that's still on the list, as before.
  const none = M.removeItem(trip(starter(), {}), 's-electronics-power-bank');
  assert.ok(!allNames(plan(none, none.trips.t1, 'back')).includes('Power bank'));
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

test('a thing goes in the bag it’s in this trip, and a bag left off stands for only what isn’t on the list', () => {
  const left = p => p.leftBags.map(l => [l.bag.name, l.count, l.more, l.why]);
  // A drive with no work: the Work bag stays home, all three of its things with it.
  const base = trip(starter(), { travel: 'drive' });
  assert.deepEqual(left(plan(base, base.trips.t1)), [['Work bag', 3, false, 'Only for work']]);
  const on = conditions(base, base.trips.t1).on;
  assert.deepEqual(M.bags(base).filter(b => b.kind === 'bag' && bagComing(base.trips.t1, b, on)).map(b => b.id).includes('s-work'), false);
  // Something just for this trip put in it, or moved into it: the bag's card has that, and its line the 3 more.
  for (const doc of [M.putExtra(base, 't1', { id: 'e1', name: 'Gift for the hosts', bag: 's-work' }), M.mark(base, 't1', 'b:s-documents-id', 's-work')]) {
    const p = plan(doc, doc.trips.t1);
    assert.equal(names(p, 'Work bag').length, 1, names(p, 'Work bag').join());
    assert.deepEqual(left(p), [['Work bag', 3, true, 'Only for work']]);
  }
  // One of its things brought anyway, or packed before the plans changed: that one's on the list, 2 more aren't.
  const added = M.mark(base, 't1', 'x:s-work-badge', 'add');
  const work = M.mark(M.setCond(base, 't1', 'work', true), 't1', 'p:s-work-badge', 1);
  const packed = M.setCond(work, 't1', 'work', null);
  for (const doc of [added, packed]) {
    const p = plan(doc, doc.trips.t1);
    assert.deepEqual(names(p, 'Work bag'), ['Badge']);
    assert.deepEqual(left(p), [['Work bag', 2, true, 'Only for work']]);
  }
  // Every one of its things on the list: nothing of it is left off, so no line.
  let all = base;
  for (const x of M.items(base, 's-work')) all = M.mark(all, 't1', 'x:' + x.id, 'add');
  assert.deepEqual(left(plan(all, all.trips.t1)), []);
  // The other way: on a work trip, Badge moved into the Day bag, then the Work bag left off. Badge still comes.
  let doc = M.setCond(base, 't1', 'work', true);
  doc = M.mark(doc, 't1', 'b:s-work-badge', 's-daybag');
  doc = M.mark(doc, 't1', 'x:s-work', 'skip');
  let p = plan(doc, doc.trips.t1);
  assert.ok(names(p, 'Day bag').includes('Badge'));
  assert.ok(p.groups.flatMap(g => g.rows).find(r => r.name === 'Badge').moved);
  assert.deepEqual(left(p), [['Work bag', 2, false, 'You left it off this trip']]);
  // Moved into a bag that's left off, from one that's coming: still on the list, in the bag it's in.
  doc = M.mark(M.mark(base, 't1', 'b:s-daybag-sunglasses', 's-work'), 't1', 'x:s-work', 'skip');
  p = plan(doc, doc.trips.t1);
  assert.deepEqual(names(p, 'Work bag'), ['Sunglasses']);
  assert.ok(!names(p, 'Day bag').includes('Sunglasses'));
  assert.deepEqual(left(p), [['Work bag', 3, true, 'You left it off this trip']]);
  // Moved from one left-off bag into another: the line of the bag it's in stands for it.
  doc = M.mark(M.mark(base, 't1', 'b:s-work-badge', 's-daybag'), 't1', 'x:s-daybag', 'skip');
  p = plan(doc, doc.trips.t1);
  assert.ok(!allNames(p).includes('Badge'));
  assert.deepEqual(left(p).map(l => l.slice(0, 3)), [['Day bag', M.items(base, 's-daybag').length + 1, false], ['Work bag', 2, false]]);
  // Its own conditions still count: moved out of a bag left off, a thing they say no to waits under Left off.
  doc = M.mark(M.mark(base, 't1', 'b:s-daybag-umbrella', 's-clothes'), 't1', 'x:s-daybag', 'skip');
  p = plan(doc, doc.trips.t1);
  assert.ok(!allNames(p).includes('Umbrella'));
  assert.deepEqual(p.left.filter(l => l.item.name === 'Umbrella').map(l => l.why), ['Only when rain’s likely']);
  assert.equal(p.leftBags.find(l => l.bag.name === 'Day bag').count, M.items(base, 's-daybag').length - 1);
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

test('a single job left off one trip, or one its conditions leave off, waits under Left off', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = M.putItem(doc, { id: 'cushions', name: 'Bring in the patio cushions', bag: 's-leave', when: ['rain'] });
  doc = M.putItem(doc, { id: 'tip', name: 'Leave a tip', bag: 's-back', unless: ['drive'] });
  doc = trip(doc, { travel: 'drive' });
  doc = M.mark(doc, 't1', 'x:s-leave-take-out-the-trash', 'skip');
  const jobs = p => p.tasks.flatMap(g => g.rows.map(r => r.name));
  const leftJobs = p => p.left.filter(l => ['s-leave', 's-back'].includes(l.item.bag)).map(l => [l.item.name, l.skipped, l.why]);
  let p = plan(doc, doc.trips.t1);
  assert.ok(!jobs(p).includes('Take out the trash') && !jobs(p).includes('Bring in the patio cushions'));
  assert.deepEqual(leftJobs(p), [['Take out the trash', true, 'You left it off this trip'], ['Bring in the patio cushions', false, 'Only when rain’s likely']]);
  // Brought along anyway, and put back.
  doc = M.mark(doc, 't1', 'x:cushions', 'add');
  doc = M.mark(doc, 't1', 'x:s-leave-take-out-the-trash', 0);
  p = plan(doc, doc.trips.t1);
  assert.deepEqual(jobs(p), ['Take out the trash', 'Set the thermostat', 'Water the plants', 'Lock the windows and doors', 'Bring in the patio cushions']);
  assert.ok(p.tasks[0].rows.find(r => r.name === 'Bring in the patio cushions').added);
  assert.deepEqual(leftJobs(p), []);
  // Coming home, a hotel job the conditions leave off waits there too; the things in bags don't show there.
  const back = plan(doc, doc.trips.t1, 'back');
  assert.ok(!jobs(back).includes('Leave a tip'));
  assert.deepEqual(back.left.map(l => [l.item.name, l.skipped, l.why]), [['Leave a tip', false, 'Not when you’re driving']]);
  // A whole list left off covers its jobs with its own line.
  doc = M.mark(doc, 't1', 'x:s-leave', 'skip');
  doc = M.mark(doc, 't1', 'x:s-leave-water-the-plants', 'skip');
  p = plan(doc, doc.trips.t1);
  assert.deepEqual(leftJobs(p), []);
  assert.deepEqual(p.leftBags.filter(l => l.skipped).map(l => l.bag.name), ['Leaving the house']);
});

test('days: the same words as toLocaleDateString, a year of days', () => {
  const was = (k, opts) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  for (const k of range('2026-02-25', '2027-03-05')) {
    assert.equal(weekday(k), was(k, { weekday: 'short' }));
    assert.equal(short(k), was(k, { month: 'short', day: 'numeric' }));
    assert.equal(long(k), was(k, { weekday: 'short', month: 'short', day: 'numeric' }));
    assert.equal(dayLong(k), was(k, { weekday: 'long', month: 'long', day: 'numeric' }));
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

test('another phone’s lookup of a trip’s old place doesn’t count for its new one', async () => {
  const lisbon = { name: 'Lisbon', cc: 'PT', country: 'Portugal', lat: 38.7167, lon: -9.1333 };
  const porto = { name: 'Porto', cc: 'PT', country: 'Portugal', lat: 41.1496, lon: -8.611 };
  const today = '2026-11-02';
  const lookup = place => ({ at: Date.now(), for: placeKey(place), days: range('2026-11-10', '2026-11-13').map(d => ({ d, hi: 32, lo: 22, mm: 0, pop: 0, uv: 9, code: 0 })) });
  let a = M.setPref(starter(), 'home', 'US');
  a = M.putTrip(a, { id: 't1', place: lisbon, start: '2026-11-10', end: '2026-11-13', travel: 'fly' });
  a = M.setWx(a, 't1', lookup(lisbon));
  assert.equal(a.trips.t1.wx.for, '38.7167,-9.1333');
  assert.equal(conditions(a, a.trips.t1).on.hot, true);
  let b = a; // phone B, synced
  later();
  a = M.clearWx(M.putTrip(a, { id: 't1', place: porto }), 't1'); // phone A changes the place to Porto
  later();
  b = M.setWx(b, 't1', lookup(lisbon)); // phone B, still on Lisbon, looks it up again before its sync lands
  for (const m of [M.mergeDocs(a, b), M.mergeDocs(b, a)]) {
    const t = m.trips.t1;
    assert.equal(t.place.name, 'Porto');
    assert.equal(t.wx.for, '38.7167,-9.1333', 'the newest lookup was Lisbon’s');
    assert.deepEqual(tripDays(t.wx, t.start, t.end, t.place), [], 'none of Lisbon’s days');
    assert.equal(conditions(m, t).weather, null);
    assert.ok(!conditions(m, t).on.hot && !conditions(m, t).on.sun, 'no Lisbon reasons');
    assert.equal(stale(t.wx, t.start, t.end, today, Date.now(), t.place), true, 'so Porto is looked up at once');
    assert.equal(M.cleanTrip(t).wx.for, '38.7167,-9.1333', 'and where it was for is kept when saved');
  }
  // A place typed by hand in place of a looked-up one has no coordinates: no lookup is for it.
  const typed = M.putTrip(b, { id: 't1', place: { name: 'The cabin' } });
  assert.equal(typed.trips.t1.wx.days.length, 4);
  assert.deepEqual(tripDays(typed.trips.t1.wx, '2026-11-10', '2026-11-13', typed.trips.t1.place), []);
  assert.equal(conditions(typed, typed.trips.t1).weather, null);
  assert.equal(stale(typed.trips.t1.wx, '2026-11-10', '2026-11-13', today, Date.now(), typed.trips.t1.place), true);
  // Weather saved before lookups said where they were for still counts.
  const old = M.setWx(b, 't1', { ...lookup(lisbon), for: undefined });
  assert.equal(old.trips.t1.wx.for, undefined);
  assert.equal(conditions(old, old.trips.t1).on.hot, true);
  assert.equal(stale(old.trips.t1.wx, '2026-11-10', '2026-11-13', today, Date.now(), lisbon), false);
  // The place key reads the coordinates as a trip keeps them, and junk in a saved one goes.
  assert.equal(placeKey({ lat: 38.7, lon: -9.1 }), '38.7,-9.1');
  assert.equal(placeKey({ lat: 38.71674, lon: -9.13333 }), '38.7167,-9.1333');
  assert.equal(placeKey(M.cleanPlace({ name: 'X', lat: 38.716749, lon: -9.133349 })), placeKey({ lat: 38.716749, lon: -9.133349 }));
  assert.equal(placeKey({ name: 'The cabin' }), '');
  for (const junk of ['Lisbon', '1,2,3', '1e5,2', 7, '1'.repeat(40) + ',2']) assert.equal(M.cleanWx({ ...lookup(lisbon), for: junk }).for, undefined, String(junk));
  // A lookup says which place it was for.
  const now = Date.parse('2026-11-02T12:00:00Z'), stub = weatherStub(now);
  try {
    const wx = await tripWeather(lisbon, '2026-11-10', '2026-11-11', today, { now });
    assert.equal(wx.for, '38.7167,-9.1333');
    assert.equal(stale(wx, '2026-11-10', '2026-11-11', today, now, M.cleanPlace(lisbon)), false);
  } finally { stub.restore(); }
});

// ---------- trips with more than one stop ----------

const LISBON = { name: 'Lisbon', admin: 'Lisbon District', country: 'Portugal', cc: 'PT', lat: 38.7251, lon: -9.1498 };
const PORTO = { name: 'Porto', admin: 'Porto', country: 'Portugal', cc: 'PT', lat: 41.1496, lon: -8.611 };
const MADRID = { name: 'Madrid', admin: 'Madrid', country: 'Spain', cc: 'ES', lat: 40.4165, lon: -3.7026 };
const LONDON = { name: 'London', admin: 'England', country: 'United Kingdom', cc: 'GB', lat: 51.5085, lon: -0.1257 };
const PARIS = { name: 'Paris', admin: 'Île-de-France', country: 'France', cc: 'FR', lat: 48.8534, lon: 2.3488 };

test('a trip with one place saves as it always has; its stops are kept, cleaned, and taken off one by one', () => {
  // A trip saved before there were stops reads back, and saves, exactly as it was.
  const saved = { id: 't1', name: '', place: LISBON, start: '2026-11-10', end: '2026-11-16', travel: 'fly', t: 5, set: {}, marks: { 'p:x': { v: 1, t: 6 } }, extras: {} };
  assert.equal(M.canon(M.cleanTrip(saved)), M.canon(saved));
  const raw = { ...M.blankDoc(), trips: { t1: saved } };
  assert.equal(M.canon(M.cleanDoc(JSON.parse(JSON.stringify(raw)))), M.canon(raw));
  let doc = M.putTrip(M.blankDoc(), { id: 't1', place: LISBON, start: '2026-11-10', end: '2026-11-16' });
  assert.equal('stops' in doc.trips.t1, false);
  doc = M.putStop(doc, 't1', { id: 's1', place: PORTO, from: '2026-11-13' });
  doc = M.putStop(doc, 't1', { id: 's2', place: MADRID, from: '2026-11-15' });
  assert.deepEqual(M.stops(doc.trips.t1).map(s => s.place.name), ['Porto', 'Madrid']);
  // Through storage, a backup or Drive: kept, and junk dropped.
  const junk = { bad1: { place: { name: ' ' }, from: '2026-11-12', t: 1 }, bad2: { place: PORTO, from: 'soon', t: 1 }, toString: { place: PORTO, from: '2026-11-12', t: 1 } };
  const back = M.cleanDoc(JSON.parse(M.canon({ ...doc, trips: { t1: { ...doc.trips.t1, stops: { ...doc.trips.t1.stops, ...junk } } } })));
  assert.equal(M.canon(back.trips.t1), M.canon(doc.trips.t1));
  // Taken off, a stop is kept as a deletion, so it goes on every device.
  const off = M.removeStop(doc, 't1', 's1');
  assert.deepEqual(M.stops(off.trips.t1).map(s => s.id), ['s2']);
  for (const m of [M.mergeDocs(off, doc), M.mergeDocs(doc, off)]) assert.deepEqual(M.stops(m.trips.t1).map(s => s.id), ['s2'], 'it stays off after a merge');
  assert.throws(() => M.putStop(doc, 't1', { place: PORTO }), /night you get there/);
  // A deleted trip's stops can't be changed, which would bring the trip back.
  const gone = M.removeTrip(doc, 't1');
  assert.equal(M.removeStop(gone, 't1', 's2'), gone);
  assert.equal(M.putStop(gone, 't1', { place: PORTO, from: '2026-11-12' }), gone);
});

test('a copy of Carry On from before stops can’t take a trip’s stops away', () => {
  // An older copy reads a trip without its stops (its cleanDoc doesn't know them), and saves it that way.
  const older = d => JSON.parse(JSON.stringify(d), (k, v) => (k === 'stops' ? undefined : v));
  let a = M.setPref(starter(), 'home', 'US');
  a = M.putTrip(a, { id: 't1', place: LISBON, start: '2026-11-10', end: '2026-11-16', travel: 'fly' });
  later();
  a = M.putStop(a, 't1', { id: 's1', place: PORTO, from: '2026-11-13' });
  const b = older(a);
  assert.equal(b.trips.t1.stops, undefined);
  const changes = [
    ['saved as it was', d => d],
    ['a tick', d => M.mark(d, 't1', 'p:s-clothes-belt', 1)],
    ['a new name', d => M.putTrip(d, { id: 't1', name: 'Portugal' })],
    ['a later Back', d => M.putTrip(d, { id: 't1', end: '2026-11-17' })],
  ];
  for (const [what, change] of changes) {
    later();
    const b2 = change(b);
    for (const first of [false, true]) {
      for (const m of [M.mergeDocs(a, b2, { first }), M.mergeDocs(b2, a, { first })]) {
        assert.deepEqual(M.stops(m.trips.t1).map(s => s.place.name), ['Porto'], what);
        assert.equal(m.trips.t1.name, b2.trips.t1.name, what);
        assert.equal(m.trips.t1.end, b2.trips.t1.end, what);
        assert.equal(m.trips.t1.marks['p:s-clothes-belt']?.v, b2.trips.t1.marks['p:s-clothes-belt']?.v, what);
        // The older copy merges that in, drops the stops again, and saves: still there.
        assert.deepEqual(M.stops(M.mergeDocs(m, older(m)).trips.t1).map(s => s.place.name), ['Porto'], what);
      }
    }
  }
  // Deleted on the older copy, the trip goes, stops and all.
  later();
  const del = M.removeTrip(b, 't1');
  for (const m of [M.mergeDocs(a, del), M.mergeDocs(del, a)]) assert.ok(M.gone(m.trips.t1));
});

test('stops merge one by one, and each one’s newest weather lookup wins', () => {
  const base = M.putTrip(M.blankDoc(), { id: 't1', place: LISBON, start: '2026-11-10', end: '2026-11-20' });
  // Each phone adds a stop before they sync: both stay.
  const a = M.putStop(base, 't1', { id: 'sa', place: PORTO, from: '2026-11-13' });
  const b = M.putStop(base, 't1', { id: 'sb', place: MADRID, from: '2026-11-17' });
  const m = M.mergeDocs(a, b);
  assert.deepEqual(M.stops(m.trips.t1).map(s => s.id).sort(), ['sa', 'sb']);
  assert.equal(M.canon(m), M.canon(M.mergeDocs(b, a)), 'order of merging does not matter');
  assert.equal(M.canon(M.mergeDocs(m, m)), M.canon(m), 'merging again changes nothing');
  const lookup = (place, at, hi) => ({ at, for: placeKey(place), days: range('2026-11-10', '2026-11-20').map(d => day(d, hi, 10)) });
  let x = M.setStopWx(m, 't1', 'sa', lookup(PORTO, 100, 20));
  const y = M.setStopWx(m, 't1', 'sa', lookup(PORTO, 200, 25));
  later();
  x = M.putStop(x, 't1', { id: 'sa', place: PORTO, from: '2026-11-14' }); // its night changed after the other's lookup
  for (const mm of [M.mergeDocs(x, y), M.mergeDocs(y, x)]) {
    assert.equal(mm.trips.t1.stops.sa.from, '2026-11-14', 'the newer change');
    assert.equal(mm.trips.t1.stops.sa.wx.at, 200, 'and the newer lookup');
  }
  // Moved somewhere else, a stop loses its old place's weather on every device.
  later();
  const moved = M.putStop(y, 't1', { id: 'sa', place: PARIS, from: '2026-11-14' });
  for (const mm of [moved, M.mergeDocs(moved, y), M.mergeDocs(y, moved)]) assert.deepEqual(mm.trips.t1.stops.sa.wx.days, []);
  // As it does when the trip's dates change.
  const cleared = M.clearWx(y, 't1', 'sa');
  assert.deepEqual(cleared.trips.t1.stops.sa.wx.days, []);
  assert.ok(cleared.trips.t1.stops.sa.wx.at > 200);
  // A lookup that lands after its stop was taken off doesn't bring it back.
  const off = M.removeStop(y, 't1', 'sa');
  assert.equal(M.setStopWx(off, 't1', 'sa', lookup(PORTO, 300, 30)), off);
});

test('a trip’s days, place by place: from the night you get there to the day before the next stop', () => {
  let doc = M.putTrip(M.blankDoc(), { id: 't1', place: LISBON, start: '2026-11-10', end: '2026-11-20' });
  assert.deepEqual(legs(doc.trips.t1).map(l => [l.id, l.place.name, l.from, l.to]), [['', 'Lisbon', '2026-11-10', '2026-11-20']], 'one place: the whole trip');
  doc = M.putStop(doc, 't1', { id: 's2', place: MADRID, from: '2026-11-17' });
  doc = M.putStop(doc, 't1', { id: 's1', place: PORTO, from: '2026-11-13' });
  // Not counted: a night before you leave, the night you're back (you sleep at home), or after it.
  for (const [id, from] of [['x1', '2026-11-10'], ['x2', '2026-11-20'], ['x3', '2026-11-25']]) doc = M.putStop(doc, 't1', { id, place: PARIS, from });
  assert.deepEqual(legs(doc.trips.t1).map(l => [l.id, l.place.name, l.from, l.to]), [
    ['', 'Lisbon', '2026-11-10', '2026-11-12'], ['s1', 'Porto', '2026-11-13', '2026-11-16'], ['s2', 'Madrid', '2026-11-17', '2026-11-20']]);
  // Two stops on one night (one added on each phone): the newer counts.
  later();
  doc = M.putStop(doc, 't1', { id: 'x4', place: PARIS, from: '2026-11-13' });
  assert.deepEqual(legs(doc.trips.t1).map(l => l.place.name), ['Lisbon', 'Paris', 'Madrid']);
  // Each place's weather counts for its own days only.
  const wx = (place, hi) => ({ at: 1, for: placeKey(place), days: range('2026-11-10', '2026-11-20').map(d => day(d, hi, 10)) });
  doc = M.setWx(doc, 't1', wx(LISBON, 20));
  doc = M.setStopWx(doc, 't1', 'x4', wx(PARIS, 21));
  doc = M.setStopWx(doc, 't1', 's2', wx(MADRID, 22));
  assert.deepEqual(legDays(doc.trips.t1).flatMap(l => l.days.map(d => d.hi)), [20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22]);
});

test('a trip with stops calls for what any of its places does, and says where', () => {
  const us = M.setPref(starter(), 'home', 'US');
  const fc = (d, hi, lo, extra = {}) => day(d, hi, lo, { pop: 10, uv: 3, code: 2, ...extra });
  const typ = (d, hi, lo, extra = {}) => ({ d, typ: 1, hi, lo, mm: 0, wet: 0.1, sn: 0, rad: 10, ...extra });
  const lookup = (place, f) => ({ at: 1, for: placeKey(place), days: range('2026-11-02', '2026-11-08').map(f) });
  const twoStops = (doc, a, b, night, wa, wb) => {
    let d = M.putTrip(doc, { id: 't1', place: a, start: '2026-11-02', end: '2026-11-08', travel: 'fly', ...(wa ? { wx: lookup(a, wa) } : {}) });
    d = M.putStop(d, 't1', { id: 's1', place: b, from: night });
    return wb ? M.setStopWx(d, 't1', 's1', lookup(b, wb)) : d;
  };
  // London, cool with rain on Tuesday, then Paris, hot. In London on Paris's hot days it's mild, and in Paris on
  // London's rainy day it's dry: only each place's own days count.
  let doc = twoStops(us, LONDON, PARIS, '2026-11-05', d => fc(d, d >= '2026-11-05' ? 30 : 15, 9, d === '2026-11-03' ? { pop: 80, mm: 6 } : {}), d => fc(d, d >= '2026-11-05' ? 31 : 18, 16, d === '2026-11-07' ? { uv: 7 } : {}));
  let p = plan(doc, doc.trips.t1), c = p.cond;
  assert.equal(c.why.abroad, 'United Kingdom and France');
  assert.equal(c.on.plug, true);
  assert.equal(c.why.plug, 'United Kingdom: Type G, 230\u00a0V; France: Type C/E, 230\u00a0V · check anything that heats up', 'each country whose sockets differ, by name');
  assert.equal(c.why.hot, 'Highs up to 88° in Paris');
  assert.equal(c.why.cool, 'Lows down to 48° in London');
  assert.equal(c.why.rain, 'Rain likely Tue in London');
  assert.equal(c.why.sun, 'UV up to 7 in Paris');
  for (const n of ['Passport', 'Plug adapter', 'Swimsuit', 'Umbrella', 'Light jacket', 'Sunscreen']) assert.ok(allNames(p).includes(n), n);
  assert.ok(!allNames(p).includes('Warm coat'));
  // From the UK, only France needs an adapter, and it says France.
  doc = twoStops(M.setPref(starter(), 'home', 'GB'), LONDON, PARIS, '2026-11-05');
  c = conditions(doc, doc.trips.t1);
  assert.equal(c.why.abroad, 'France');
  assert.equal(c.why.plug, 'France: Type C/E, 230\u00a0V');
  // Two places in one country: no names, as a trip with one place has it.
  doc = twoStops(us, LISBON, PORTO, '2026-11-05');
  c = conditions(doc, doc.trips.t1);
  assert.equal(c.why.abroad, 'Portugal');
  assert.equal(c.why.plug, 'Type C/F, 230\u00a0V · check anything that heats up');
  // From Germany, the plugs fit in both.
  doc = twoStops(M.setPref(starter(), 'home', 'DE'), LISBON, PARIS, '2026-11-05');
  c = conditions(doc, doc.trips.t1);
  assert.equal(c.on.plug, false);
  assert.equal(c.no.plug, 'Your plugs fit in Portugal and France');
  // Cold from one place's highs, and typical rain in one place, though the trip's days together are neither.
  doc = twoStops(us, LISBON, PORTO, '2026-11-07', d => typ(d, 24, 14), d => typ(d, 8, 5, { wet: 0.5 }));
  c = conditions(doc, doc.trips.t1);
  assert.equal(c.weather.meanHi > 10, true);
  assert.equal(c.on.cold, true);
  assert.equal(c.why.cold, 'Highs around 46° in Porto');
  assert.equal(c.on.rain, true);
  assert.equal(c.why.rain, 'Rain in Porto on about 5 days in 10 this time of year');
  assert.equal(c.on.cool, false, 'cold instead');
  // A stop typed in without a lookup: abroad still shows from the other place, but at home it's unknown.
  doc = twoStops(us, LISBON, { name: 'The cabin' }, '2026-11-05');
  assert.equal(conditions(doc, doc.trips.t1).on.abroad, true);
  doc = twoStops(us, { name: 'Chicago', cc: 'US', country: 'United States', lat: 41.85, lon: -87.65 }, { name: 'The cabin' }, '2026-11-05');
  assert.equal(conditions(doc, doc.trips.t1).auto.abroad, undefined);
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

test('a thing added on one phone to a bag the other deleted brings the bag back, with only that thing', () => {
  const a0 = starter(), b0 = M.mergeDocs(M.blankDoc(), a0, { first: true });
  later();
  const a = M.removeBag(a0, 's-toiletries'); // phone A deletes the Toiletries bag, and everything in it
  later();
  const b = M.putItem(b0, { id: 'i-retainer', name: 'Retainer', bag: 's-toiletries' }); // phone B, not synced yet
  const ab = M.mergeDocs(a, b), ba = M.mergeDocs(b, a);
  assert.equal(M.canon(ab), M.canon(ba), 'order of merging does not matter');
  assert.equal(M.canon(M.mergeDocs(ab, ab)), M.canon(ab), 'merging again changes nothing');
  assert.equal(M.canon(M.mergeDocs(ab, a)), M.canon(ab));
  assert.ok(M.bags(ab).some(x => x.id === 's-toiletries'), 'the bag is back');
  assert.deepEqual(M.items(ab, 's-toiletries').map(x => x.name), ['Retainer'], 'its other things stay deleted');
  assert.ok(M.items(ab).every(x => M.bags(ab).some(bag => bag.id === x.bag)), 'every thing is in a bag that shows');
  const d = trip(ab, {});
  assert.ok(allNames(plan(d, d.trips.t1)).includes('Retainer'));
  assert.deepEqual(M.listOf(ab).bags.filter(x => x.id === 's-toiletries').length, 1, 'and in a link or a backup');
  // It goes again with that thing.
  later();
  assert.ok(!M.bags(M.removeItem(ab, 'i-retainer')).some(x => x.id === 's-toiletries'));
  // Changed, moved or deleted from My list like any bag; deleted, Undo brings it back with the thing.
  const renamed = M.putBag(ab, { id: 's-toiletries', name: 'Wash bag' });
  assert.equal(M.bags(renamed).find(x => x.id === 's-toiletries').name, 'Wash bag');
  assert.equal(M.bags(renamed).find(x => x.id === 's-toiletries').icon, '🪥', 'keeping what it had');
  assert.ok(M.bags(M.removeItem(renamed, 'i-retainer')).some(x => x.id === 's-toiletries'), 'changed, it stays');
  const up = M.nudge(ab, 'bags', 's-toiletries', -1);
  assert.equal(M.bags(up).findIndex(x => x.id === 's-toiletries'), M.bags(ab).findIndex(x => x.id === 's-toiletries') - 1);
  later();
  const removed = M.removeBag(ab, 's-toiletries');
  assert.ok(!M.bags(removed).some(x => x.id === 's-toiletries') && M.gone(removed.items['i-retainer']));
  later();
  const undone = M.restoreBag(removed, 's-toiletries', ['i-retainer']);
  assert.deepEqual(M.items(undone, 's-toiletries').map(x => x.name), ['Retainer']);
  // A thing left in a deleted bag from before the deletion, which the other phone never saw, stays out of sight:
  // the deletion is the later change. Replacing the list and Undo leave it so.
  const c = M.putItem(b0, { id: 'i-old', name: 'Old comb', bag: 's-toiletries' });
  later();
  const gone = M.mergeDocs(M.removeBag(a0, 's-toiletries'), c);
  assert.ok(!M.gone(gone.items['i-old']) && !M.bags(gone).some(x => x.id === 's-toiletries'));
  assert.ok(!M.items(gone).some(x => x.id === 'i-old'));
  // Packed for a trip, it still comes home, like anything deleted after it was packed.
  const packed = M.mark(trip(gone, {}), 't1', 'p:i-old', 1);
  const home = plan(packed, packed.trips.t1, 'back');
  assert.deepEqual(home.groups.flatMap(g => g.rows.map(r => [g.bag.name, r.name, r.deleted])), [['Not in a bag', 'Old comb', true]]);
  // (Also when the list coming in has it, in a bag of the same name that's here under another id.)
  const wash = M.putBag(gone, { id: 'b-wash', name: 'Toiletries bag' });
  for (const [doc, list] of [[gone, M.listOf(starter())], [wash, { bags: [{ id: 's-toiletries', name: 'Toiletries bag' }], items: [{ id: 'i-old', name: 'Old comb', bag: 's-toiletries' }] }]]) {
    later();
    const swapped = M.replaceList(doc, list);
    later();
    assert.deepEqual(M.listOf(M.undoReplace(swapped, doc, swapped)), M.listOf(doc));
  }
});

test('a first merge drops starter bags and their things together, so no thing is left in no bag', () => {
  // A phone with one bag of its own and nothing in it yet joins a Drive that has the untouched starter list.
  const phone = M.putBag(M.blankDoc(), { id: 'b-camera', name: 'Camera bag' });
  for (const [local, remote] of [[phone, starter()], [starter(), phone]]) {
    const m = M.mergeDocs(local, remote, { first: true });
    assert.deepEqual(M.bags(m).map(x => x.name), ['Camera bag']);
    assert.deepEqual(M.items(m), [], 'the starter things go with their bags');
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

const norm = s => s.trim().toLowerCase();
test('an occasion made on both phones is one after a first merge, and what comes for it follows', () => {
  let a = M.putTag(starter(), { id: 'oA', name: 'Wedding', icon: '💍' });
  a = M.putItem(a, { id: 'i-suit', name: 'Suit', bag: 's-clothes', when: ['oA', 'dressy'] });
  a = M.putItem(a, { id: 'i-jeans', name: 'Jeans', bag: 's-clothes', unless: ['oA'] });
  a = M.putBag(a, { id: 'b-gift', name: 'Gift bag', when: ['oA'] });
  a = M.putItem(a, { id: 'i-card', name: 'Card', bag: 'b-gift' });
  a = trip(a, {});
  a = M.setCond(a, 't1', 'oA', true);
  let b = M.putTag(starter(), { id: 'oB', name: 'wedding ', icon: '💒' });
  b = M.putItem(b, { id: 'i-dress', name: 'Dress', bag: 's-clothes', when: ['oB'] });
  for (const [local, remote, id] of [[a, b, 'oB'], [b, a, 'oA']]) {
    const m = M.mergeDocs(local, remote, { first: true });
    assert.deepEqual(M.tags(m).filter(g => norm(g.name) === 'wedding').map(g => g.id), [id], 'one Wedding, with the other side’s id');
    assert.deepEqual(m.items['i-suit'].when, [id, 'dressy'].sort());
    assert.deepEqual(m.items['i-jeans'].unless, [id]);
    assert.deepEqual(m.items['i-dress'].when, [id]);
    assert.deepEqual(m.bags['b-gift'].when, [id]);
    assert.equal(m.trips.t1.set[id].v, true, 'the trip still has it picked');
    const p = plan(m, m.trips.t1);
    for (const n of ['Suit', 'Dress', 'Card']) assert.ok(allNames(p).includes(n), n);
    assert.ok(!allNames(p).includes('Jeans'));
    assert.equal(M.canon(M.mergeDocs(m, remote)), M.canon(m), 'the next sync changes nothing');
  }
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

test('adding a list skips what’s already on it, in whichever bag, and adding it twice adds nothing', () => {
  const doc = starter();
  const live = d => M.items(d).map(x => `${d.bags[x.bag].name}: ${x.name}`);
  const fresh = (d, was) => live(d).filter(n => !live(was).includes(n)).sort();
  // A flat list: only the camera is new.
  const flat = M.addList(doc, parsePaste('Toothbrush\nToothpaste\nphone charger\nSocks\nSwimsuit\nPassport\nSunglasses\nCamera'));
  assert.deepEqual(fresh(flat, doc), ['Not in a bag: Camera']);
  // "Toiletries" is the Toiletries bag; Tech is a new bag, with only what's new in it.
  const mine = parsePaste('Toiletries:\n- Toothbrush\n- Floss\n- Retainer\nTech:\n- Phone charger\n- Camera\nLeaving the house:\n- Water the plants\n- Feed the cat');
  const added = M.addList(doc, mine);
  assert.deepEqual(fresh(added, doc), ['Leaving the house: Feed the cat', 'Tech: Camera', 'Toiletries bag: Retainer']);
  assert.equal(M.bags(added).length, M.bags(doc).length + 1);
  // A bag whose things are all here already doesn't come.
  assert.equal(M.bags(M.addList(doc, parsePaste('Gym bag:\n- Socks\n- Shoes'))).length, M.bags(doc).length);
  // A job isn't a thing to pack: Water the plants as a thing still comes.
  assert.deepEqual(fresh(M.addList(doc, parsePaste('Water the plants')), doc), ['Not in a bag: Water the plants']);
  // Twice: nothing more.
  assert.equal(M.canon(M.addList(added, mine)), M.canon(added));
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

test('a list with the same names used instead keeps a trip’s ticks, skips and moves, and Undo brings the old one back', () => {
  let before = M.setPref(starter(), 'home', 'US');
  before = trip(before, { place: { name: 'Lisbon', cc: 'PT', country: 'Portugal' } });
  for (const id of ['s-toiletries-toothbrush', 's-documents-passport', 's-clothes-socks']) before = M.mark(before, 't1', 'p:' + id, 1);
  before = M.mark(before, 't1', 'x:s-daybag-snacks', 'skip');
  before = M.mark(before, 't1', 'b:s-daybag-sunglasses', 's-clothes');
  const was = plan(before, before.trips.t1);
  // Pasted, so every id is different: b-… and i-… rather than the starter's s-….
  const text = 'Toiletries bag:\n- toothbrush\n- Floss\nDocuments and money:\n- Passport\nClothes:\n- Socks\n- Retainer\nDay bag:\n- Snacks\n- Sunglasses\n- Eye mask and earplugs';
  later();
  const after = M.replaceList(before, parsePaste(text));
  const p = plan(after, after.trips.t1);
  assert.equal(p.done, 3, 'the three ticks still count');
  assert.equal(p.done, was.done);
  assert.ok(p.left.find(l => l.item.name === 'Snacks').skipped, 'still left off');
  assert.ok(names(p, 'Clothes').includes('Sunglasses'), 'still moved to Clothes');
  assert.equal(after.items['s-toiletries-toothbrush'].name, 'toothbrush', 'the same thing, under its new name');
  assert.deepEqual(after.items['s-daybag-eye-mask-and-earplugs'].when, [], 'with the new list’s conditions');
  assert.ok(M.items(after).some(x => x.name === 'Retainer'), 'what’s new comes in');
  assert.ok(M.gone(after.items['s-toiletries-razor']), 'what isn’t on the new list goes');
  // Another phone with the old list syncs: it gets the new one, and the ticks there still count.
  for (const m of [M.mergeDocs(before, after), M.mergeDocs(after, before)]) {
    assert.deepEqual(M.items(m).map(x => x.id + x.name), M.items(after).map(x => x.id + x.name));
    assert.equal(plan(m, m.trips.t1).done, 3);
  }
  // The same list again: nothing changes.
  later();
  assert.equal(M.canon(M.replaceList(after, parsePaste(text))), M.canon(after));
  // Undo: the old names, conditions and progress.
  later();
  const undone = M.undoReplace(after, before, after);
  const shown = d => M.items(d).map(x => `${x.id} ${x.name} ${x.when} ${x.per}`);
  assert.deepEqual(shown(undone), shown(before));
  assert.deepEqual(M.bags(undone).map(b => `${b.id} ${b.name} ${b.icon}`), M.bags(before).map(b => `${b.id} ${b.name} ${b.icon}`));
  const q = plan(undone, undone.trips.t1);
  assert.equal(q.done, was.done);
  assert.equal(q.total, was.total);
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

test('ids that are names every JavaScript object has can’t stop a trip opening or a sync saving', async () => {
  const JS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  // A link thing that stays home "unless __proto__", and an occasion called "toString" that a suit comes for.
  const link1 = await encodeList({ bags: [{ id: 'b1', name: 'Clothes' }], items: [{ id: 'i1', name: 'Socks', bag: 'b1', unless: ['__proto__'] }, { id: 'i2', name: 'Shirt', bag: 'b1' }, { id: 'toString', name: 'Tie', bag: 'b1' }], tags: [] });
  const link2 = await encodeList({ bags: [{ id: 'b1', name: 'Clothes' }, { id: 'constructor', name: 'Shoes' }], items: [{ id: 'i1', name: 'Suit', bag: 'b1', when: ['toString'] }], tags: [{ id: 'toString', name: 'Wedding', icon: '💍' }] });
  for (const code of [link1, link2]) {
    const list = await decodeList(code);
    assert.ok([...list.bags, ...list.items, ...list.tags].every(x => !JS.includes(x.id)), 'none of those ids come in');
    assert.ok(list.items.every(x => ![...x.when, ...x.unless].some(k => JS.includes(k))));
    for (const doc of [M.replaceList(starter(), list), M.addList(starter(), list)]) {
      const d = trip(doc, {});
      for (const mode of ['go', 'back']) assert.doesNotThrow(() => plan(d, d.trips.t1, mode));
      assert.ok(allNames(plan(d, d.trips.t1)).includes(list.items[0].name), 'and the thing comes along');
    }
  }
  // A copy that holds one anyway (from before this), on one side of a merge only: what's saved is still JSON.
  const base = trip(starter(), {});
  const odd = { ...base, trips: { t1: { ...base.trips.t1, set: { toString: { v: true, t: 5 } }, marks: { 'p:constructor': { v: 1, t: 5 } } } } };
  for (const m of [M.mergeDocs(odd, base), M.mergeDocs(base, odd)]) {
    const text = M.canon(m);
    assert.doesNotThrow(() => JSON.parse(text), text.slice(0, 80));
    assert.deepEqual(M.cleanDoc(JSON.parse(text)).trips.t1.set, {}, 'and reads back without it');
  }
  assert.equal(M.canon({ a: () => 1, b: [undefined, 2] }), '{"a":null,"b":[null,2]}');
  // Straight from storage or Drive, as JSON reads it.
  const raw = JSON.parse('{"bags":{"__proto__":{"name":"Bag"},"b1":{"name":"Bag","when":["toString","rain"]}},"items":{"constructor":{"name":"X","bag":"b1"},"i1":{"name":"Y","bag":"toString"}},"tags":{"valueOf":{"name":"V"}},"trips":{"t1":{"start":"2026-11-02","end":"2026-11-03","set":{"__proto__":{"v":true,"t":1}},"marks":{"x:toString":{"v":"skip","t":1},"b:i2":{"v":"toString","t":1}},"extras":{"hasOwnProperty":{"name":"E","bag":"b1"}}}}}');
  const doc = M.cleanDoc(raw);
  assert.deepEqual(Object.keys(doc.bags), ['b1']);
  assert.deepEqual(doc.bags.b1.when, ['rain']);
  assert.deepEqual(doc.items, {});
  assert.equal(Object.getPrototypeOf(doc.bags), Object.prototype);
  assert.deepEqual(Object.keys(doc.tags).filter(k => JS.includes(k)), []);
  assert.deepEqual([doc.trips.t1.set, doc.trips.t1.marks, doc.trips.t1.extras], [{}, {}, {}]);
});

test('junk settings and names read back as nothing, or as the same', () => {
  for (const prefs of [{ home: null }, { laundry: 0 }, { laundry: '' }, { units: false }, { home: 'US' }, { laundry: { v: 0, t: 3 } }]) {
    const doc = M.cleanDoc({ prefs });
    assert.ok(laundryOk(doc), JSON.stringify(prefs));
  }
  assert.deepEqual(M.cleanDoc({ prefs: { home: null, laundry: 0, units: '' } }).prefs, {});
  assert.deepEqual(M.cleanDoc({ prefs: { laundry: { v: 0, t: 3 } } }).prefs, { laundry: { v: 1, t: 3 } }, 'a laundry limit of 0 is 1');
  // A long name is cut whole: no space left at its end, and no emoji cut in half.
  const long = M.cleanItem({ name: '  ' + 'a'.repeat(79) + ' b', bag: 'b1' }, 'i1').name;
  assert.equal(long, 'a'.repeat(79));
  const emoji = M.cleanItem({ name: 'a'.repeat(79) + '😀 and more', bag: 'b1' }, 'i1').name;
  assert.equal(emoji, 'a'.repeat(79) + '😀');
  assert.equal(M.cleanBag({ name: 'Bag', icon: '👨‍👩‍👧' }, 'b1').icon, '👨‍👩‍👧');
  const once = M.cleanDoc({ items: { i1: { name: 'x '.repeat(50) + '🧦'.repeat(40), bag: 'b1' } }, bags: { b1: { name: ' Bag  of   things ' } } });
  assert.equal(once.bags.b1.name, 'Bag of things');
  assert.equal(M.canon(M.cleanDoc(once)), M.canon(once), 'cleaning again changes nothing');
});
const laundryOk = doc => { const n = qtyOf(doc, { start: T, end: add(T, 9) }, { per: 'day' }); return Number.isInteger(n) && n >= 1; };

// ---------- lists coming in ----------

const KEEP = `Weekend list [updated]

  ●​   Day pack
          ○​    Rain shell
          ○​    Sunscreen
  ●​   Electronics
          ○​    Headphones
  ●​   Attire
          ○​    Socks
          ○​    Swimsuit
  ●​   Beach towel
  ●​   Office bag
          ○​    Badge
  ●​   Reading glasses
  ●​   Leaving the house
          ○​    Close windows`;

test('a pasted list from Google Docs: bags, loose things, jobs, and guesses', () => {
  const l = parsePaste(KEEP);
  assert.deepEqual(l.bags.map(b => b.name), ['Day pack', 'Electronics', 'Attire', 'Office bag', 'Not in a bag', 'Leaving the house']);
  const by = n => l.items.find(x => x.name === n);
  assert.deepEqual(l.items.filter(x => x.bag === l.bags[4].id).map(x => x.name), ['Beach towel', 'Reading glasses']);
  assert.deepEqual(by('Sunscreen').when, ['sun', 'hot', 'swim']);
  assert.deepEqual(by('Rain shell').when, ['rain']);
  assert.deepEqual(by('Badge').when, [], 'the office bag already says work');
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

// "Bag: thing, thing | Bag: thing" for comparing a pasted list at a glance.
const shape = text => { const l = parsePaste(text); return l.bags.map(b => `${b.name}: ${l.items.filter(x => x.bag === b.id).map(x => x.name).join(', ')}`).join(' | '); };

test('pasted lists: a plain line after a heading’s bullets is on its own, as the paste sheet’s example says', async () => {
  // The example in the paste sheet, as the page has it.
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const example = JSON.parse('"' + /placeholder: '(Electronics:[^']*)'/.exec(app)[1] + '"');
  assert.match(example, /\nPassport$/);
  assert.equal(shape(example), 'Electronics: Phone charger, Headphones | Toiletries: Toothbrush, Floss | Not in a bag: Passport');
  assert.equal(shape('Electronics:\n- Phone charger\n\nPassport'), 'Electronics: Phone charger | Not in a bag: Passport');
  assert.equal(shape('Toiletries:\n  Toothbrush\n  Floss\nPassport\nSunglasses'), 'Toiletries: Toothbrush, Floss | Not in a bag: Passport, Sunglasses');
  assert.equal(shape('## Toiletries\n- Toothbrush\nFloss'), 'Toiletries: Toothbrush | Not in a bag: Floss');
  // Things at the heading's own level, the way Google Keep has them, are still its things; so is a box after them.
  assert.equal(shape('Toiletries:\nToothbrush\nFloss'), 'Toiletries: Toothbrush, Floss');
  assert.equal(shape('Electronics:\nHeadphones\n☐ Charger'), 'Electronics: Headphones, Charger');
  // Under bullets, another bullet is still one of them.
  assert.equal(shape('Clothes:\n- Socks\n- Shirt\nShoes:\n- Boots'), 'Clothes: Socks, Shirt | Shoes: Boots');
});

test('pasted lists: a heading with no name keeps what’s under it, and a long list of the same thing is quick', () => {
  assert.equal(shape('Notes\n:\nSocks'), 'Not in a bag: Notes, Socks');
  assert.equal(shape('Toiletries:\n- Floss\n-:\n- Socks'), 'Toiletries: Floss, Socks');
  assert.equal(shape(':\n- Socks'), 'Not in a bag: Socks');
  // Ids: the same as ever, base, base-2, base-3, so the same text still makes the same list.
  const ids = parsePaste('Clothes:\nSocks\nSocks\nSocks').items.map(x => x.id);
  assert.deepEqual(ids, ['i-clothes-socks', 'i-clothes-socks-2', 'i-clothes-socks-3']);
  const t0 = performance.now();
  const many = parsePaste(Array(5000).fill('Socks').join('\n'));
  assert.ok(performance.now() - t0 < 200, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(new Set(many.items.map(x => x.id)).size, 5000);
});

test('pasted lists: a title line isn’t a thing', () => {
  // Google Keep shares a list as its title, a blank line, then boxes.
  assert.equal(shape('Packing list\n\n☐ Toothbrush\n☐ Socks\n☑ Passport'), 'Not in a bag: Toothbrush, Socks, Passport');
  assert.equal(shape('Packing\n\n□ Toiletries\n    □ Toothbrush\n✓ Passport'), 'Toiletries: Toothbrush | Not in a bag: Passport');
  assert.equal(shape('# Packing list\n\n## Toiletries\n- [ ] Toothbrush\n- [x] Floss\n\n## Electronics\n- [ ] Phone charger'), 'Toiletries: Toothbrush, Floss | Electronics: Phone charger');
  // Google Docs: the first line without a bullet is the title, unless the other lines without one are headings too.
  assert.equal(shape('Packing list\nToiletries\n●\tToothbrush\n●\tFloss\nElectronics\n●\tPhone charger'), 'Toiletries: Toothbrush, Floss | Electronics: Phone charger');
  assert.equal(shape('Toiletries\n●\tToothbrush\nElectronics\n●\tPhone charger'), 'Toiletries: Toothbrush | Electronics: Phone charger');
  assert.equal(shape('Toiletries:\n●\tToothbrush\nElectronics:\n●\tPhone charger'), 'Toiletries: Toothbrush | Electronics: Phone charger');
  assert.equal(shape('Summer trip\n●\tClothes\n○\tSocks\n●\tPassport'), 'Clothes: Socks | Not in a bag: Passport');
  // Not a title: a heading ending in a colon, or a line with no list of boxes after it.
  assert.equal(shape('Clothes:\n\n- Socks\n\n- Shirts'), 'Clothes: Socks, Shirts');
  assert.equal(shape('Passport\n\nWallet\n\nKeys'), 'Not in a bag: Passport, Wallet, Keys');
  // Nor the first of several headings that each have a blank line and boxes or bullets under them.
  assert.equal(shape('Toiletries\n\n- Toothbrush\n- Floss\n\nElectronics\n\n- Phone charger'), 'Toiletries: Toothbrush, Floss | Electronics: Phone charger');
  assert.equal(shape('Toiletries\n\n☐ Toothbrush\nElectronics\n☐ Phone charger'), 'Toiletries: Toothbrush | Electronics: Phone charger');
});

test('pasted lists: bullets, boxes and numbers under a heading without one', () => {
  for (const mark of ['•', '*', '+', '☐', '–', '-', '□', '1.', '1)', '- [ ]']) {
    assert.equal(shape(`Toiletries\n${mark} Toothbrush\n${mark} Floss\nElectronics\n${mark} Phone charger`), 'Toiletries: Toothbrush, Floss | Electronics: Phone charger', mark);
  }
  // Nested with two spaces.
  assert.equal(shape('* Toiletries\n  * Toothbrush\n* Passport'), 'Toiletries: Toothbrush | Not in a bag: Passport');
  assert.equal(shape('- Toiletries\n  - Toothbrush\n- Passport'), 'Toiletries: Toothbrush | Not in a bag: Passport');
  // A heading ending in a colon keeps the lines after it, with a box or without.
  assert.equal(shape('Electronics:\nHeadphones\n☐ Charger\nToiletries\n- Toothbrush'), 'Electronics: Headphones, Charger | Toiletries: Toothbrush');
  assert.equal(shape('Toiletries:\n- Toothbrush\nElectronics\n- Charger'), 'Toiletries: Toothbrush | Electronics: Charger');
  // All with bullets: a flat list.
  assert.equal(shape('• Passport\n• Wallet'), 'Not in a bag: Passport, Wallet');
});

test('pasted lists: Markdown headings, bold headings and + bullets', () => {
  assert.equal(shape('## Toiletries\n* Toothbrush\n* Floss\n## Electronics\n* Phone charger'), 'Toiletries: Toothbrush, Floss | Electronics: Phone charger');
  assert.equal(shape('### Toiletries\nToothbrush\nFloss\n### Electronics\nCharger'), 'Toiletries: Toothbrush, Floss | Electronics: Charger');
  assert.equal(shape('**Toiletries**\n- Toothbrush\n__Electronics:__\n- Charger'), 'Toiletries: Toothbrush | Electronics: Charger');
  assert.equal(shape('Toiletries:\n+ Toothbrush\n+ Floss'), 'Toiletries: Toothbrush, Floss');
  // Several "# " lines are headings, not a title.
  assert.equal(shape('# Toiletries\n- Toothbrush\n# Electronics\n- Charger'), 'Toiletries: Toothbrush | Electronics: Charger');
});

test('pasted lists: an emoji in front of a heading is its icon', () => {
  const l = parsePaste('🧴 Liquids:\n- Shampoo\n🔌 Tech\n- Charger\n## 🏖️ Beach\n- Towel');
  assert.deepEqual(l.bags.map(b => `${b.icon} ${b.name}`), ['🧴 Liquids', '🔌 Tech', '🏖️ Beach']);
  assert.deepEqual(l.bags.map(b => b.id), ['b-liquids', 'b-tech', 'b-beach']);
});

test('pasted lists: blank-line blocks and ALL-CAPS headings, when nothing else makes a bag', () => {
  assert.equal(shape('Toiletries\nToothbrush\nToothpaste\n\nElectronics\nPhone charger\nHeadphones\n\nPassport'), 'Toiletries: Toothbrush, Toothpaste | Electronics: Phone charger, Headphones | Not in a bag: Passport');
  assert.equal(shape('TOILETRIES\nToothbrush\nToothpaste\nELECTRONICS\nPhone charger'), 'Toiletries: Toothbrush, Toothpaste | Electronics: Phone charger');
  // Not when something else made a bag, nor for one all-caps line, nor for ID or USB.
  assert.equal(shape('Toiletries:\nToothbrush\n\nPassport\nWallet'), 'Toiletries: Toothbrush, Passport, Wallet');
  assert.equal(shape('PACKING LIST\nToothbrush\nUSB\nCharger\nID\nWallet'), 'Not in a bag: PACKING LIST, Toothbrush, USB, Charger, ID, Wallet');
  // The same text gives the same ids.
  const text = 'TOILETRIES\nToothbrush\n\nELECTRONICS\nCharger';
  assert.deepEqual(parsePaste(text), parsePaste(text));
});

test('guesses', () => {
  assert.deepEqual(guess('Work Visa card').when, []);
  assert.deepEqual(guess('Passport').when, ['abroad']);
  assert.deepEqual(guess('Rain jacket').when, ['rain']);
  assert.equal(guess('Underwear').per, 'day');
});

test('a count typed with a thing is its How many, not part of its name', () => {
  const l = parsePaste('Clothes:\n- Socks x5\n- 3 T-shirts\n- Shorts (2)\n- 2x jeans\n- 5 pairs of underwear\n- Hats ×2\n- Underwear\nToiletries:\n- 100 ml shampoo\n- 3-1-1 bag\n- 2-in-1 charger\n- 4G hotspot\n- Floss x40');
  const got = Object.fromEntries(l.items.map(x => [x.name, `${x.qty}${x.per ? ' a day' : ''}`]));
  assert.deepEqual(got, {
    'Socks': '5', 'T-shirts': '3', 'Shorts': '2', 'Jeans': '2', 'Underwear': '1 a day', 'Hats': '2',
    '100 ml shampoo': '1', '3-1-1 bag': '1', '2-in-1 charger': '1', '4G hotspot': '1', 'Floss': '20',
  });
  // "5 pairs of underwear" and "Underwear" are two lines of the same name: both stay, the first with its count.
  assert.deepEqual(l.items.filter(x => x.name === 'Underwear').map(x => `${x.qty}${x.per}`), ['5', '1day']);
  // A job keeps its words: jobs have no How many.
  assert.deepEqual(parsePaste('Leaving the house:\n- 2 bins out\n- Plants x3').items.map(x => `${x.name} ${x.qty}`), ['2 bins out 1', 'Plants x3 1']);
});

test('first guesses, name by name: nothing everyday left off a trip by a word inside another', () => {
  // name | when (or "day" for one a day; nothing for always)
  const table = `Toothbrush|
    Skincare|
    Skin care|
    Skirt|
    Hair tie|
    Hair ties|
    Tie|dressy
    Suit|dressy
    Dress shoes|dressy
    Dress shirt|dressy
    USB-C adapter|
    USB adapter|
    HDMI adapter|
    Headphone adapter|
    Lightning adapter|
    Plug adapter|plug
    Travel adapter|plug
    Voltage converter|plug
    Visa|abroad
    Visa paperwork|abroad
    Visa debit card|
    Work Visa card|
    Passport|abroad
    Ski goggles|snow
    Ski jacket|snow
    Ski socks|snow
    Skis|snow
    Snow boots|snow
    Swim goggles|swim hot
    Goggles|swim hot
    Swimsuit|swim hot
    Wetsuit|swim
    Snorkel|swim
    Beach towel|swim
    Slides|hot swim
    Pool slides|hot swim
    Presentation slides|
    Sandals|hot swim
    Sneakers|
    Running shoes|gym
    Gym clothes|gym
    Trail mix|
    Trail shoes|outdoors
    Hiking boots|outdoors
    Bug spray|outdoors
    Mosquito repellent|outdoors
    Rain boots|rain
    Waterproof jacket|rain
    Rain jacket|rain
    Umbrella|rain
    Sun hat|sun hot
    Sunscreen|sun hot swim
    Neck pillow|fly
    Travel pillow|fly
    Sweatshirt|cool cold
    Jumper|cool cold
    Sweater|cool cold
    Long johns|cold
    Gloves|cold
    Laptop|
    Socks|day
    Underwear|day
    T-shirts|day
    Shirts|day
    Tank tops|day
    Badge|work`.split('\n').map(l => l.trim().split('|'));
  for (const [name, want] of table) {
    const g = guess(name);
    assert.equal(g.per === 'day' ? 'day' : g.when.join(' '), want, name);
  }
});

test('no lookbehind in a pattern: Safari before 16.4 can’t read one, and the page wouldn’t load at all', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../js/', import.meta.url);
  for (const f of await readdir(dir)) assert.doesNotMatch(await readFile(new URL(f, dir), 'utf8'), /\(\?<[!=]/, f);
});

test('bags: which kind, and which icon', () => {
  for (const n of ['Leaving the house', 'Before we go', 'Before leaving', 'To do before leaving', 'Before departure', 'Lock up']) assert.equal(bagKind(n), 'leave', n);
  for (const n of ['Leaving the hotel', 'Check out of the hotel', 'Hotel checkout', 'Checkout', 'Check-out', 'Leaving the cabin', 'Leaving the vacation rental', 'Leaving the Airbnb', 'Before leaving the hotel']) assert.equal(bagKind(n), 'back', n);
  for (const n of ['Checked bag', 'Toiletries', 'Day of travel']) assert.equal(bagKind(n), 'bag', n);
  const icons = { 'Toiletries': '🪥', 'Toiletries bag': '🪥', 'Liquids': '🧴', 'Liquid toiletries': '🧴', 'Wash bag': '🧴', 'Workout bag': '🏋️', 'Gym bag': '🏋️', 'Work bag': '💼', 'Homework': '🧳', 'Footwear': '👟', 'Clothes': '👕', 'Meds': '💊', 'Camping gear': '🏕️', 'Golf': '⛳', 'Ski gear': '🎿', 'Skin care': '🧳', 'Certificates': '🧳', 'Communication': '🧳', 'Dog stuff': '🐶', 'Tech': '🔌', 'Docs': '🛂' };
  for (const [n, icon] of Object.entries(icons)) assert.equal(bagIcon(n), icon, n);
  assert.equal(bagIcon('Leaving the vacation rental', bagKind('Leaving the vacation rental')), '🏨');
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

test('ticks on too few: a longer trip, a higher laundry limit or a higher How many', () => {
  const ticked = ['p:s-clothes-socks', 'p:s-clothes-underwear', 'p:s-toiletries-toothbrush', 'p:s-clothes-belt'];
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Chicago', cc: 'US', country: 'United States' } }); // 5 days
  doc = M.markAll(doc, 't1', ticked, 1);
  // Two days later back: socks and underwear go from 5 to 7, ticked; shirts grow too but weren't ticked.
  const longer = M.putTrip(doc, { id: 't1', end: add(T, 6) });
  assert.deepEqual(grown(doc, longer, 't1').sort(), ['p:s-clothes-socks', 'p:s-clothes-underwear']);
  // A shorter trip needs fewer: nothing.
  assert.deepEqual(grown(doc, M.putTrip(doc, { id: 't1', end: add(T, 2) }), 't1'), []);
  assert.deepEqual(grown(doc, doc, 't1'), []);
  // A laundry limit of 3 on a 5-day trip, then 4: more of each.
  const three = M.setPref(doc, 'laundry', 3);
  assert.deepEqual(grown(three, M.setPref(three, 'laundry', 4), 't1').sort(), ['p:s-clothes-socks', 'p:s-clothes-underwear']);
  // A higher limit past the trip's length changes nothing.
  assert.deepEqual(grown(doc, M.setPref(doc, 'laundry', 9), 't1'), []);
  // How many goes up for one thing; down for another.
  const belts = M.putItem(doc, { id: 's-clothes-belt', qty: 2 });
  assert.deepEqual(grown(doc, belts, 't1'), ['p:s-clothes-belt']);
  assert.deepEqual(grown(belts, doc, 't1'), []);
  // One a day instead of just one.
  assert.deepEqual(grown(doc, M.putItem(doc, { id: 's-toiletries-toothbrush', per: 'day' }), 't1'), ['p:s-toiletries-toothbrush']);
  // Only ticks: an unticked thing that grows isn't named, and a trip that's gone has none.
  assert.ok(!grown(doc, longer, 't1').includes('p:s-clothes-shirts'));
  assert.deepEqual(grown(doc, M.removeTrip(longer, 't1'), 't1'), []);
});

test('one a day stops at the laundry limit, and the row says so', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = trip(doc, { place: { name: 'Chicago', cc: 'US', country: 'United States' } }); // 5 days
  const row = (d, name) => plan(d, d.trips.t1).groups.flatMap(g => g.rows).find(r => r.name === name);
  assert.deepEqual([row(doc, 'Socks').qty, row(doc, 'Socks').capped], [5, false], 'under the limit of 7');
  doc = M.setPref(doc, 'laundry', 5);
  assert.equal(row(doc, 'Socks').capped, false, 'a limit the same as the days');
  doc = M.setPref(doc, 'laundry', 4);
  assert.deepEqual([row(doc, 'Socks').qty, row(doc, 'Socks').capped], [4, true]);
  assert.equal(row(doc, 'Belt').capped, false, 'not one a day');
});

test('two or three for each day, still stopped at the laundry limit', () => {
  let doc = M.setPref(starter(), 'home', 'US');
  doc = M.putTrip(doc, { id: 't1', start: T, end: add(T, 2), travel: 'drive', place: { name: 'Chicago', cc: 'US', country: 'United States' } }); // 3 days
  const row = (d, name) => plan(d, d.trips.t1).groups.flatMap(g => g.rows).find(r => r.name === name);
  assert.deepEqual([row(doc, 'Socks').qty, row(doc, 'Socks').daily], [3, 1], 'one a day, as every one saved so far is');
  doc = M.putItem(doc, { id: 's-clothes-socks', qty: 2 });
  assert.deepEqual([row(doc, 'Socks').qty, row(doc, 'Socks').daily, row(doc, 'Socks').capped], [6, 2, false], 'two kids on a 3-day weekend');
  // A week with the laundry limit of 7, then ten days: 14 either way.
  const week = M.putTrip(doc, { id: 't1', end: add(T, 6) }), ten = M.putTrip(doc, { id: 't1', end: add(T, 9) });
  assert.equal(row(week, 'Socks').qty, 14);
  assert.deepEqual([row(ten, 'Socks').qty, row(ten, 'Socks').capped], [14, true]);
  assert.equal(row(M.putItem(ten, { id: 's-clothes-socks', qty: 3 }), 'Socks').qty, 21);
  // Two a day instead of one: a tick on one a day is too few now.
  let one = M.mark(M.putItem(doc, { id: 's-clothes-socks', qty: 1 }), 't1', 'p:s-clothes-socks', 1);
  assert.deepEqual(grown(one, M.putItem(one, { id: 's-clothes-socks', qty: 2 }), 't1'), ['p:s-clothes-socks']);
  // It keeps through cleaning and a link.
  assert.deepEqual([M.cleanItem(doc.items['s-clothes-socks']).per, M.cleanItem(doc.items['s-clothes-socks']).qty], ['day', 2]);
  assert.deepEqual(M.listOf(doc).items.find(x => x.id === 's-clothes-socks'), { id: 's-clothes-socks', name: 'Socks', bag: 's-clothes', qty: 2, per: 'day' });
});

test('qty', () => {
  let doc = M.setPref(starter(), 'laundry', 3);
  doc = trip(doc, {});
  assert.equal(qtyOf(doc, doc.trips.t1, { per: 'day' }), 3);
  assert.equal(qtyOf(doc, doc.trips.t1, { per: '', qty: 2 }), 2);
  assert.ok(conditions(doc, doc.trips.t1).on.fly);
});

// The service worker keeps what's needed to open offline: on a first visit the page's own files load before it takes
// over, so only what sw.js lists is kept. A file left off the list would be missing offline.
test('sw.js keeps every file the page needs offline, and nothing else', () => {
  const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const shell = [...read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const fonts = [...read('css/app.css').matchAll(/url\(\.\.\/(fonts\/[^)]+)\)/g)].map(m => m[1]);
  // Every module js/app.js reaches through its imports.
  const js = new Set(), todo = ['js/app.js'];
  while (todo.length) {
    const f = todo.pop();
    if (js.has(f)) continue;
    js.add(f);
    for (const [, rel] of read(f).matchAll(/\bimport\s*(?:[\w*{}\s,]+from\s*)?\(?\s*'(\.\/[\w-]+\.js)'/g)) todo.push('js/' + rel.slice(2));
  }
  const want = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'css/app.css', ...fonts, ...js];
  assert.deepEqual([...shell].sort(), [...new Set(want)].sort());
  assert.ok(js.size >= 10 && fonts.length === 2, `found ${js.size} modules and ${fonts.length} fonts`);
});
