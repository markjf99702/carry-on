// A trip as a calendar file, made in the browser, to open in a phone's calendar: an all-day event for the trip's days
// with its name, an alert at 7 pm the evening before ("Pack for Lisbon"), and the trip's link, so the alert leads to
// the list. Nothing leaves the browser. No page code, so the tests run it in Node.
// The format is iCalendar (RFC 5545). The event's UID is the trip's own, and its SEQUENCE goes up with every change to
// the trip, so saving the file again after the dates change updates the event rather than adding a second one.
import { add } from './days.js';

// Text values escape backslashes, semicolons, commas and line breaks (RFC 5545, 3.3.11).
const text = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const date = k => k.replace(/-/g, '');
const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
// A line longer than 75 octets goes on over the next, which starts with a space (RFC 5545, 3.1), never splitting a
// character's bytes.
const octets = ch => new TextEncoder().encode(ch).length;
function fold(line) {
  const out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    if (n + octets(ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch;
    n += octets(ch);
  }
  out.push(cur);
  return out.join('\r\n ');
}
// Seconds since 2026 began, from the trip's last change: it only goes up, and fits the whole number a calendar keeps.
const sequence = t => Math.max(0, Math.floor(((t || 0) - Date.UTC(2026, 0, 1)) / 1000));

// trip: { id, start, end, t }. name: what the trip is called; where: its place, if it has one; url: its link.
export function tripCalendar(trip, { name, where = '', url, now = Date.now() }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//junkdrawer.works//Carry On//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${trip.id}@carry-on.junkdrawer.works`,
    `DTSTAMP:${stamp(now)}`,
    `LAST-MODIFIED:${stamp(trip.t || now)}`,
    `SEQUENCE:${sequence(trip.t)}`,
    // All day, from the day you leave through the day you're back: the end is the day after (RFC 5545, 3.6.1).
    `DTSTART;VALUE=DATE:${date(trip.start)}`,
    `DTEND;VALUE=DATE:${date(add(trip.end, 1))}`,
    `SUMMARY:${text(name)}`,
    where ? `LOCATION:${text(where)}` : '',
    `DESCRIPTION:${text(`Your packing list: ${url}`)}`,
    `URL:${url}`,
    // Free, not busy: it's a reminder of the trip, not a meeting.
    'TRANSP:TRANSPARENT',
    // Five hours before the first day starts at midnight: 7 pm the evening before, in the phone's own time.
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(`Pack for ${name}`)}`, 'TRIGGER:-PT5H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).map(fold).join('\r\n') + '\r\n';
}
