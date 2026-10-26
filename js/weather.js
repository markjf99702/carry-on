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
    throw new Error(`${what[0].toUpperCase() + what.slice(1)} said no (${res.status}${reason ? `: ${reason}` : ''}).`);
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
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,uv_index_max,weather_code',
  })}`;
}
export function archiveUrl(p, start, end) {
  return `${API.archive}?${new URLSearchParams({
    ...loc(p), start_date: start, end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,shortwave_radiation_sum',
  })}`;
}

// The weather for each day of a trip: the forecast for the days it reaches, and for the rest the average of
// the same days in the last three years. Days long gone get nothing (a past trip keeps what it had).
export async function tripWeather(place, start, end, today, { signal } = {}) {
  if (!place || place.lat === undefined) throw new Error('This trip has no place to look up.');
  const days = range(start, end);
  const last = add(today, AHEAD), first = add(today, -60);
  const fc = days.filter(d => d >= first && d <= last), ty = days.filter(d => d > last);
  const out = {}, errors = [];
  const jobs = [];
  if (fc.length) {
    jobs.push(reach(forecastUrl(place, fc[0], fc.at(-1)), signal, 'the weather service').then(raw => {
      const d = raw.daily || {};
      (d.time || []).forEach((k, i) => {
        if (d.temperature_2m_max[i] === null || d.temperature_2m_min[i] === null) return;
        out[k] = {
          d: k, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], mm: d.precipitation_sum?.[i] ?? 0,
          pop: d.precipitation_probability_max?.[i] ?? undefined, snow: d.snowfall_sum?.[i] ?? 0,
          uv: d.uv_index_max?.[i] ?? undefined, code: d.weather_code?.[i] ?? undefined,
        };
      });
    }).catch(e => { errors.push(e); }));
  }
  if (ty.length) {
    // The archive runs about a week behind, so only years whose dates are already in it.
    const years = YEARS.filter(n => yearsBack(ty.at(-1), n) <= add(today, -7));
    const got = await Promise.allSettled(years.map(n => reach(archiveUrl(place, yearsBack(ty[0], n), yearsBack(ty.at(-1), n)), signal, 'the weather history service')));
    const sets = got.filter(g => g.status === 'fulfilled').map(g => g.value.daily || {});
    got.forEach(g => { if (g.status === 'rejected') errors.push(g.reason); });
    ty.forEach((k, i) => {
      const rows = sets.map(s => ({ hi: s.temperature_2m_max?.[i], lo: s.temperature_2m_min?.[i], mm: s.precipitation_sum?.[i], sn: s.snowfall_sum?.[i], rad: s.shortwave_radiation_sum?.[i] }))
        .filter(r => r.hi != null && r.lo != null);
      if (!rows.length) return;
      const mean = f => rows.reduce((a, r) => a + (r[f] ?? 0), 0) / rows.length;
      out[k] = {
        d: k, typ: 1, hi: mean('hi'), lo: mean('lo'), mm: mean('mm'), rad: mean('rad'),
        wet: rows.filter(r => (r.mm ?? 0) >= 1).length / rows.length,
        sn: rows.filter(r => (r.sn ?? 0) >= 0.5).length / rows.length,
      };
    });
  }
  await Promise.all(jobs);
  const list = days.map(k => out[k]).filter(Boolean);
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (!list.length) throw errors[0] || new Error('No weather came back for those days.');
  return { at: Date.now(), days: list };
}

// Old enough to look up again: a forecast after three hours. Typical weather doesn't change, so only once the
// forecast reaches it (or after a week, in case a lookup came back short).
export function stale(wx, start, end, today, now = Date.now()) {
  if (end < add(today, -1)) return false;
  if (!wx || !wx.days.length) return true;
  const forecast = wx.days.some(d => !d.typ);
  if (now - wx.at > (forecast ? 3 * 3600e3 : 7 * 86400e3)) return true;
  return wx.days.some(d => d.typ && d.d <= add(today, AHEAD));
}

// What the weather means for packing. Thresholds in °C.
export const LIMITS = { hot: 28, cool: 13, cold: 4, coldDay: 10, rainPop: 50, rainMm: 3, rainShare: 0.3, snowCm: 0.5, snowShare: 0.15, uv: 6, rad: 20 };

export function summarize(wx) {
  const days = wx?.days || [];
  if (!days.length) return null;
  const fc = days.filter(d => !d.typ), ty = days.filter(d => d.typ);
  const mean = (list, f) => (list.length ? list.reduce((a, d) => a + (d[f] ?? 0), 0) / list.length : 0);
  const maxHi = Math.max(...days.map(d => d.hi)), minLo = Math.min(...days.map(d => d.lo));
  const meanHi = mean(days, 'hi');
  const rainDays = fc.filter(d => (d.pop ?? (d.mm >= LIMITS.rainMm ? 100 : 0)) >= LIMITS.rainPop || d.mm >= LIMITS.rainMm).map(d => d.d);
  const snowDays = fc.filter(d => (d.snow ?? 0) >= LIMITS.snowCm).map(d => d.d);
  const wet = mean(ty, 'wet'), sn = mean(ty, 'sn');
  const uv = fc.length ? Math.max(...fc.map(d => d.uv ?? 0)) : 0, rad = mean(ty, 'rad');
  const cold = minLo <= LIMITS.cold || meanHi <= LIMITS.coldDay;
  return {
    maxHi, minLo, rainDays, snowDays, wet, sn, uv, rad,
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

export const toF = c => c * 9 / 5 + 32;
export const temp = (c, units) => `${Math.round(units === 'C' ? c : toF(c))}°`;

