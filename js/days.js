// Calendar days as 'YYYY-MM-DD' keys, and as whole numbers of days for arithmetic.
// Days are counted in UTC so a trip's length never depends on daylight saving.

export const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const num = key => Math.round(Date.parse(key + 'T00:00:00Z') / 86400000);
export const key = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const add = (k, n) => key(num(k) + n);

// Today where the person is, not in UTC.
export function today(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// The same month and day some years earlier (29 February becomes 1 March).
export function yearsBack(k, n) {
  const [y, m, d] = k.split('-').map(Number);
  return key(Math.round(Date.UTC(y - n, m - 1, d) / 86400000));
}

export function range(start, end) {
  const out = [];
  for (let n = num(start); n <= num(end); n++) out.push(key(n));
  return out;
}

// Making a date formatter is slow (a trip screen shows dozens of dates), so each kind is made once.
const formats = new Map();
function fmt(k, opts) {
  const id = JSON.stringify(opts);
  if (!formats.has(id)) formats.set(id, new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }));
  return formats.get(id).format(new Date(k + 'T12:00:00Z'));
}
export const weekday = k => fmt(k, { weekday: 'short' });
export const weekdayLong = k => fmt(k, { weekday: 'long' });
export const short = k => fmt(k, { month: 'short', day: 'numeric' });
export const long = k => fmt(k, { weekday: 'short', month: 'short', day: 'numeric' });

// "Nov 3 – 8", "Oct 30 – Nov 2", "Dec 30, 2026 – Jan 2, 2027" when it crosses into another year
export function span(a, b, thisYear) {
  const [ya, ma] = a.split('-'), [yb, mb] = b.split('-');
  if (a === b) return ya === thisYear ? long(a) : fmt(a, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (ya !== yb) return `${fmt(a, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const tail = ya === thisYear ? '' : `, ${ya}`;
  return ma === mb ? `${short(a)} – ${+b.slice(8)}${tail}` : `${short(a)} – ${short(b)}${tail}`;
}

export const nights = (start, end) => Math.max(0, num(end) - num(start));
