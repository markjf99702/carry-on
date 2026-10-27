// A stand-in for Open-Meteo, so tests and screenshots don't depend on the real weather.
//   await openMeteo(ctx)   routes place search, forecasts and the archive for every page in the context.
// The weather is made up but steady: Lisbon and Porto are warm with rain on their second day, Reykjavik is cold
// with snow, Chicago is cool, London is cool and wet, Paris is hot, and the archive gives every place a typical spring.
const PLACES = [
  { name: 'Lisbon', admin1: 'Lisbon District', country: 'Portugal', country_code: 'PT', latitude: 38.7251, longitude: -9.1498 },
  { name: 'Lisbon', admin1: 'Ohio', country: 'United States', country_code: 'US', latitude: 40.772, longitude: -80.7681 },
  { name: 'Chicago', admin1: 'Illinois', country: 'United States', country_code: 'US', latitude: 41.85, longitude: -87.65 },
  { name: 'Reykjavík', admin1: 'Capital Region', country: 'Iceland', country_code: 'IS', latitude: 64.1355, longitude: -21.8954 },
  { name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', country_code: 'JP', latitude: 35.6895, longitude: 139.6917 },
  { name: 'Porto', admin1: 'Porto', country: 'Portugal', country_code: 'PT', latitude: 41.1496, longitude: -8.611 },
  { name: 'London', admin1: 'England', country: 'United Kingdom', country_code: 'GB', latitude: 51.5085, longitude: -0.1257 },
  { name: 'Paris', admin1: 'Île-de-France', country: 'France', country_code: 'FR', latitude: 48.8534, longitude: 2.3488 },
];
const CLIMATE = {
  PT: { hi: 26, lo: 16, pop: 10, uv: 7, code: 1, wetDay: 1 },
  US: { hi: 16, lo: 8, pop: 20, uv: 4, code: 2 },
  IS: { hi: 2, lo: -4, pop: 40, uv: 1, code: 71, snow: 2 },
  JP: { hi: 20, lo: 12, pop: 20, uv: 5, code: 2 },
  GB: { hi: 12, lo: 6, pop: 60, uv: 2, code: 61 },
  FR: { hi: 29, lo: 17, pop: 10, uv: 7, code: 0 },
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const days = (a, b) => { const out = []; for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const near = (lat, lon) => PLACES.reduce((best, p) => (Math.hypot(p.latitude - lat, p.longitude - lon) < Math.hypot(best.latitude - lat, best.longitude - lon) ? p : best));

export const calls = [];
export async function openMeteo(ctx, { fail = false } = {}) {
  await ctx.route('https://geocoding-api.open-meteo.com/**', route => {
    const u = new URL(route.request().url());
    calls.push('geocode ' + u.searchParams.get('name'));
    if (fail) return route.abort('internetdisconnected');
    const q = (u.searchParams.get('name') || '').toLowerCase();
    const results = PLACES.filter(p => p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(q.normalize('NFD').replace(/[̀-ͯ]/g, '')));
    route.fulfill({ headers: CORS, body: JSON.stringify(results.length ? { results } : {}) });
  });
  await ctx.route('https://api.open-meteo.com/**', route => {
    const u = new URL(route.request().url()), s = u.searchParams;
    calls.push(`forecast ${s.get('start_date')} ${s.get('end_date')}`);
    if (fail) return route.abort('internetdisconnected');
    const p = near(+s.get('latitude'), +s.get('longitude')), c = CLIMATE[p.country_code];
    const time = days(s.get('start_date'), s.get('end_date'));
    route.fulfill({ headers: CORS, body: JSON.stringify({ daily: {
      time,
      temperature_2m_max: time.map((_, i) => c.hi + (i % 3)),
      temperature_2m_min: time.map((_, i) => c.lo + (i % 2)),
      precipitation_probability_max: time.map((_, i) => (i === c.wetDay ? 70 : c.pop)),
      precipitation_sum: time.map((_, i) => (i === c.wetDay ? 6 : 0)),
      snowfall_sum: time.map(() => c.snow || 0),
      uv_index_max: time.map(() => c.uv),
      weather_code: time.map((_, i) => (i === c.wetDay ? 63 : c.code)),
    } }) });
  });
  await ctx.route('https://archive-api.open-meteo.com/**', route => {
    const u = new URL(route.request().url()), s = u.searchParams;
    calls.push(`archive ${s.get('start_date')} ${s.get('end_date')}`);
    if (fail) return route.abort('internetdisconnected');
    const p = near(+s.get('latitude'), +s.get('longitude')), c = CLIMATE[p.country_code];
    const time = days(s.get('start_date'), s.get('end_date'));
    const year = +s.get('start_date').slice(0, 4);
    route.fulfill({ headers: CORS, body: JSON.stringify({ daily: {
      time,
      temperature_2m_max: time.map(() => c.hi - 6),
      temperature_2m_min: time.map(() => c.lo - 5),
      precipitation_sum: time.map((_, i) => ((i + year) % 2 ? 4 : 0)),
      snowfall_sum: time.map(() => c.snow || 0),
      shortwave_radiation_sum: time.map(() => 12),
    } }) });
  });
}
