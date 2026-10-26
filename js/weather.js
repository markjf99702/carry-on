// Place search, forecasts and past weather from Open-Meteo (free, no key, CC BY 4.0).
// Everything is kept in °C, millimetres and centimetres; the page converts for show.
import { add, range, yearsBack } from './days.js';

export const API = {
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
  forecast: 'https://api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
};
// The forecast reaches 16 days ahead, today included. Past that, a trip gets the weather the same days had
// in each of the last three years.
export const AHEAD = 15;
const YEARS = [1, 2, 3];

// The last day the forecast has. Open-Meteo counts its 16 days from today in UTC, so where today has already
// begun ahead of UTC (Tokyo, Sydney, India, Europe just after midnight), it ends a day sooner than the local date says.
export function forecastEdge(today, now = Date.now()) {
  const utc = new Date(now).toISOString().slice(0, 10);
  return add(utc < today ? utc : today, AHEAD);
}

// fetch, but when the connection itself fails, say which service couldn't be reached
// rather than passing on the browser's own words ("Failed to fetch", "Load failed").
async function reach(url, signal, what) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Couldn’t reach ${what}.`);
    throw e;
  }
  if (!res.ok) {
    let reason = '';
    try { reason = (await res.json()).reason || ''; } catch { /* not JSON */ }
    throw Object.assign(new Error(`${what[0].toUpperCase() + what.slice(1)} said no (${res.status}${reason ? `: ${reason}` : ''}).`), { status: res.status, reason });
  }
  return res.json();
}

export async function searchPlaces(query, { signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const go = extra => reach(`${API.geocode}?${new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json', ...extra })}`, signal, 'place search');
  let results = (await go({})).results || [];
  // A bare 5-digit number is most likely a US ZIP code.
  if (!results.length && /^\d{5}$/.test(q)) results = (await go({ countryCode: 'US' })).results || [];
  return results.map(r => ({
    name: r.name, admin: r.admin1 || '', country: r.country || '', cc: r.country_code || '',
    lat: r.latitude, lon: r.longitude,
  }));
}

export function placeLabel(p) {
  if (!p) return '';
  const parts = [p.name];
  if (p.admin && p.admin !== p.name && (p.cc === 'US' || p.cc === 'CA' || p.cc === 'AU')) parts.push(p.admin);
  if (p.country && p.country !== p.name && p.cc !== 'US') parts.push(p.country);
  return parts.join(', ');
}

const loc = p => ({ latitude: p.lat.toFixed(4), longitude: p.lon.toFixed(4), timezone: 'auto' });

export function forecastUrl(p, start, end) {
  return `${API.forecast}?${new URLSearchParams({
    ...loc(p), start_date: start, end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,uv_index_max,weather_code',
  })}`;
}
export function archiveUrl(p, start, end) {
  return `${API.archive}?${new URLSearchParams({
    ...loc(p), start_date: start, end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum,shortwave_radiation_sum',
  })}`;
}

// Typical weather for some days (in order): the same dates in each of the last three years, averaged. Each year
// is read by its own dates, so 29 February, which most years don't have, reads 1 March. A year that fails adds
// its error to errors, and the days are made from the others.
async function typical(place, keys, today, signal, errors) {
  // The archive runs about a week behind, so only years whose dates are already in it.
  const years = YEARS.filter(n => yearsBack(keys.at(-1), n) <= add(today, -7));
  const got = await Promise.allSettled(years.map(n => reach(archiveUrl(place, yearsBack(keys[0], n), yearsBack(keys.at(-1), n)), signal, 'the weather history service')));
  const sets = [];
  got.forEach((g, i) => {
    if (g.status === 'rejected') { errors.push(g.reason); return; }
    const s = g.value.daily || {};
    sets.push({ n: years[i], s, row: new Map((s.time || []).map((k, j) => [k, j])) });
  });
  const out = {};
  for (const k of keys) {
    const rows = sets.map(({ n, s, row }) => {
      const j = row.get(yearsBack(k, n));
      return j === undefined ? null : { hi: s.temperature_2m_max?.[j], lo: s.temperature_2m_min?.[j], mm: s.precipitation_sum?.[j], rain: s.rain_sum?.[j], sn: s.snowfall_sum?.[j], rad: s.shortwave_radiation_sum?.[j] };
    }).filter(r => r && r.hi != null && r.lo != null);
    if (!rows.length) continue;
    const mean = f => rows.reduce((a, r) => a + (r[f] ?? 0), 0) / rows.length;
    out[k] = {
      d: k, typ: 1, hi: mean('hi'), lo: mean('lo'), mm: mean('mm'), rad: mean('rad'),
      wet: rows.filter(r => rainOf({ mm: r.mm, snow: r.sn, rain: r.rain }) >= 1).length / rows.length,
      sn: rows.filter(r => (r.sn ?? 0) >= 0.5).length / rows.length,
    };
  }
  return out;
}

// What a lookup that didn't all come back says, under the weather (its err).
export const SHORT = {
  missing: 'Couldn’t get the weather for every day.',
  forecast: 'Couldn’t get the forecast, so these days show typical weather.',
  gaps: 'The forecast left out some days, so they show typical weather.',
  years: 'Couldn’t get every past year, so typical weather comes from fewer of them.',
};

// The weather for each day of a trip: the forecast for the days it reaches, and for the rest the average of
// the same days in the last three years. Days long gone get nothing (a past trip keeps what it had).
// Days the forecast should have had but didn't (it failed, or left a day out) get typical weather instead, and a
// lookup that didn't all come back says so in err.
export async function tripWeather(place, start, end, today, { signal, now = Date.now() } = {}) {
  if (!place || place.lat === undefined) throw new Error('This trip has no place to look up.');
  const days = range(start, end);
  const last = forecastEdge(today, now), first = add(today, -60);
  const fc = days.filter(d => d >= first && d <= last), ty = days.filter(d => d > last);
  const out = {}, errors = [];
  let fcErr = null;
  const forecast = !fc.length ? null : reach(forecastUrl(place, fc[0], fc.at(-1)), signal, 'the weather service').then(raw => {
    const d = raw.daily || {};
    (d.time || []).forEach((k, i) => {
      if (d.temperature_2m_max?.[i] == null || d.temperature_2m_min?.[i] == null) return;
      const rain = d.rain_sum?.[i], showers = d.showers_sum?.[i];
      out[k] = {
        d: k, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], mm: d.precipitation_sum?.[i] ?? 0,
        pop: d.precipitation_probability_max?.[i] ?? undefined, snow: d.snowfall_sum?.[i] ?? 0,
        rain: rain == null && showers == null ? undefined : (rain ?? 0) + (showers ?? 0),
        uv: d.uv_index_max?.[i] ?? undefined, code: d.weather_code?.[i] ?? undefined,
      };
    });
  }).catch(e => {
    // Open-Meteo's own words for a day past its edge, should one still be asked for.
    fcErr = e.status === 400 && /out of allowed range/.test(e.reason) ? new Error('The forecast doesn’t reach that far yet.') : e;
  });
  if (ty.length) Object.assign(out, await typical(place, ty, today, signal, errors));
  await forecast;
  const gaps = fc.filter(k => !out[k]);
  if (gaps.length && !signal?.aborted) Object.assign(out, await typical(place, gaps, today, signal, errors));
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  const list = days.map(k => out[k]).filter(Boolean);
  if (!list.length) throw fcErr || errors[0] || new Error('No weather came back for those days.');
  const wx = { at: now, for: placeKey(place), days: list };
  const err = days.some(k => k >= first && !out[k]) ? SHORT.missing : fcErr ? SHORT.forecast : gaps.length ? SHORT.gaps : errors.length ? SHORT.years : '';
  if (err) wx.err = err;
  return wx;
}

// The place a lookup was for, as "lat,lon" the way a trip keeps them (model.js cleanPlace, to 4 decimals), and ''
// for a place that wasn't looked up (typed by hand).
const r4 = x => Math.round(x * 1e4) / 1e4;
export const placeKey = p => (typeof p?.lat === 'number' && typeof p?.lon === 'number' ? `${r4(p.lat)},${r4(p.lon)}` : '');
// Whether saved weather is for the trip's place. A lookup saved before lookups said where they were for counts.
const forPlace = (wx, place) => !wx?.for || wx.for === placeKey(place);

// The saved days that belong to a trip. A lookup from before its place or dates changed can come back from
// another device's copy, with days that aren't the trip's: another place's days don't count at all.
export const tripDays = (wx, start, end, place) => (forPlace(wx, place) ? (wx?.days || []).filter(d => d.d >= start && d.d <= end) : []);

// Old enough to look up again: a forecast after three hours. Typical weather doesn't change, so only once the
// forecast reaches it (or after a week). A lookup that didn't all come back, after half an hour, and one that
// isn't for these days (the dates changed) or this place, at once.
export function stale(wx, start, end, today, now = Date.now(), place) {
  if (end < add(today, -1)) return false;
  if (!wx || !wx.days.length || !forPlace(wx, place)) return true;
  if (wx.err) return now - wx.at > 30 * 60e3;
  const have = new Set(wx.days.map(d => d.d)), first = add(today, -60);
  if (range(start > first ? start : first, end).some(k => !have.has(k))) return true;
  const forecast = wx.days.some(d => !d.typ);
  if (now - wx.at > (forecast ? 3 * 3600e3 : 7 * 86400e3)) return true;
  return wx.days.some(d => d.typ && d.d <= forecastEdge(today, now));
}

// What the weather means for packing. Thresholds in °C.
export const LIMITS = { hot: 28, cool: 13, cold: 4, coldDay: 10, rainPop: 50, rainMm: 3, rainShare: 0.3, snowCm: 0.5, snowShare: 0.15, uv: 6, rad: 20 };

// The rain on a day, in mm. Open-Meteo's precipitation total and its chance of precipitation take in snow as well,
// so a snow day would otherwise bring an umbrella. Days saved before the rain was asked for take the snow off the
// total, at Open-Meteo's own rate: 7 cm of snow is about 10 mm of water.
export const rainOf = d => d.rain ?? Math.max(0, (d.mm ?? 0) - (d.snow ?? 0) * 10 / 7);
// WMO weather codes for snow: snowfall, snow grains and snow showers.
export const snowCode = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
// A rain day in the forecast: 3 mm of rain, or a 50% chance, unless the day is snow with hardly any rain.
const rainy = d => rainOf(d) >= LIMITS.rainMm || ((d.pop ?? 0) >= LIMITS.rainPop && !(snowCode(d.code) && rainOf(d) < 1));

export function summarize(wx) {
  const days = wx?.days || [];
  if (!days.length) return null;
  const fc = days.filter(d => !d.typ), ty = days.filter(d => d.typ);
  const mean = (list, f) => (list.length ? list.reduce((a, d) => a + (d[f] ?? 0), 0) / list.length : 0);
  const maxHi = Math.max(...days.map(d => d.hi)), minLo = Math.min(...days.map(d => d.lo));
  const meanHi = mean(days, 'hi');
  const rainDays = fc.filter(rainy).map(d => d.d);
  // Likely when each of them had a 50% chance; otherwise some came from the millimetres alone.
  const rainLikely = fc.filter(rainy).every(d => (d.pop ?? 0) >= LIMITS.rainPop);
  const snowDays = fc.filter(d => (d.snow ?? 0) >= LIMITS.snowCm).map(d => d.d);
  const wet = mean(ty, 'wet'), sn = mean(ty, 'sn');
  const uv = fc.length ? Math.max(...fc.map(d => d.uv ?? 0)) : 0, rad = mean(ty, 'rad');
  const cold = minLo <= LIMITS.cold || meanHi <= LIMITS.coldDay;
  return {
    maxHi, minLo, meanHi, rainDays, rainLikely, snowDays, wet, sn, uv, rad,
    typical: ty.length > 0, forecast: fc.length > 0,
    hot: maxHi >= LIMITS.hot,
    cold,
    cool: !cold && minLo <= LIMITS.cool,
    rain: rainDays.length > 0 || (ty.length > 0 && wet >= LIMITS.rainShare),
    snow: snowDays.length > 0 || (ty.length > 0 && sn >= LIMITS.snowShare),
    sun: uv >= LIMITS.uv || (ty.length > 0 && rad >= LIMITS.rad),
  };
}

// A picture for a day: the forecast's own weather code, or a guess from the typical numbers.
export function dayIcon(d) {
  if (d.typ) return d.sn >= 0.3 ? '🌨️' : d.wet >= 0.5 ? '🌧️' : d.wet >= 0.3 ? '🌦️' : d.rad >= 18 ? '☀️' : '⛅';
  const c = d.code;
  if (c === undefined) return '·';
  if (c === 0) return '☀️';
  if (c <= 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c <= 48) return '🌫️';
  if (c <= 57) return '🌦️';
  if (c <= 67) return '🌧️';
  if (c <= 77) return '🌨️';
  if (c <= 82) return '🌦️';
  if (c <= 86) return '🌨️';
  return '⛈️';
}

// The same, in words, for a screen reader: the picture is hidden from it.
export function dayWords(d) {
  if (d.typ) return d.sn >= 0.3 ? 'snowy' : d.wet >= 0.5 ? 'often wet' : d.wet >= 0.3 ? 'sometimes wet' : d.rad >= 18 ? 'usually sunny' : 'usually dry';
  const c = d.code;
  if (c === undefined) return '';
  if (c === 0) return 'sunny';
  if (c <= 2) return 'partly cloudy';
  if (c === 3) return 'cloudy';
  if (c <= 48) return 'fog';
  if (c <= 57) return 'drizzle';
  if (c <= 67) return 'rain';
  if (c <= 77) return 'snow';
  if (c <= 82) return 'showers';
  if (c <= 86) return 'snow showers';
  return 'thunderstorms';
}

export const toF = c => c * 9 / 5 + 32;
export const temp = (c, units) => `${Math.round(units === 'C' ? c : toF(c))}°`;

