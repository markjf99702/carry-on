// Lists going in and out: a link that carries a whole list, a list pasted from Google Keep or Notes,
// and a first guess at when each thing is needed.
import { APP, cleanBag, cleanItem, cleanTag } from './model.js';

// ---------- links ----------
// The list is packed with deflate and written in base64url after #list=. The part after # never reaches
// a server, so the list only travels inside the link itself.

const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function squeeze(bytes, how) {
  const stream = new Blob([bytes]).stream().pipeThrough(how === 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeList(list) {
  const json = JSON.stringify({ app: APP, list: 1, ...list });
  const packed = await squeeze(new TextEncoder().encode(json), 'in');
  let s = '';
  for (let i = 0; i < packed.length; i += 0x8000) s += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeList(code) {
  let raw;
  try { raw = JSON.parse(new TextDecoder().decode(await squeeze(unb64(code), 'out'))); } catch { raw = null; }
  if (typeof raw?.app === 'string' && raw.app !== APP) throw new Error('That link is for another app, not Carry On.');
  if (!raw || raw.app !== APP || !Array.isArray(raw.bags)) throw new Error('That link doesn’t hold a Carry On list. It may have been cut short.');
  return cleanList(raw);
}

// Keeps only what's well formed, in order.
const list = x => (Array.isArray(x) ? x : []);
export function cleanList(raw) {
  const bags = list(raw.bags).map(b => cleanBag({ ...b, t: 0 })).filter(Boolean).map(({ t, order, ...b }) => b);
  const ids = new Set(bags.map(b => b.id));
  const items = list(raw.items).map(x => cleanItem({ ...x, t: 0 })).filter(x => x && ids.has(x.bag)).map(({ t, order, ...x }) => x);
  const tags = list(raw.tags).map(g => cleanTag({ ...g, t: 0 })).filter(Boolean).map(({ t, order, ...g }) => g);
  return { bags, items, tags };
}

// ---------- guesses ----------
// When a thing is probably needed, from its name. Only a first guess: every one can be changed.
const GUESSES = [
  // Snow before swimming, so ski goggles are for the snow.
  [/\bski(s|ing)?\b|snow ?(boots?|pants|suit)/i, { when: ['snow'] }],
  [/\bswim|bathing suit|trunks|bikini|goggles/i, { when: ['swim', 'hot'] }],
  [/wetsuit|snorkel|beach towel|rash guard/i, { when: ['swim'] }],
  [/sunscreen|sun ?block|\bspf\b|after.?sun|aloe/i, { when: ['sun', 'hot', 'swim'] }],
  [/sun ?hat/i, { when: ['sun', 'hot'] }],
  [/sandal|flip.?flop|^slides$|(pool|shower|beach) slides/i, { when: ['hot', 'swim'] }],
  [/workout|\bgym\b|running (shoes|clothes)|sports bra|yoga/i, { when: ['gym'] }],
  // A visa, but not a Visa card; a plug adapter, but not a USB-C or HDMI one.
  [/passport|\bvisa\b(?! (debit |credit )?card)|currency|local cash|foreign cash/i, { when: ['abroad'] }],
  [/(?<!(usb-?c?|hdmi|lightning|headphone|audio|display|sd|card) )adapter|converter/i, { when: ['plug'] }],
  [/umbrella|rain ?(jacket|coat|shell|boots?)|poncho|waterproof (jacket|coat|shell)/i, { when: ['rain'] }],
  [/winter coat|warm coat|parka|puffer|gloves|mittens|beanie|scarf|thermal|long underwear|long johns|hand warmers/i, { when: ['cold'] }],
  [/light jacket|fleece|sweater|sweatshirt|hoodie|cardigan|\bjumpers?\b/i, { when: ['cool', 'cold'] }],
  [/\bsuit\b|(?<!hair )\bties?\b|dress (shoes|shirts?)|blazer|heels|cufflinks|dressy|formal/i, { when: ['dressy'] }],
  [/hiking|trail(?! mix)|bug spray|insect|mosquito|headlamp|trekking/i, { when: ['outdoors'] }],
  [/(neck|travel) pillow/i, { when: ['fly'] }],
  [/\bbadge\b|security key|business cards|work laptop/i, { when: ['work'] }],
  [/\bsocks?\b|underwear|boxers|briefs|undershirts?|panties|bras?\b|\bt[- ]?shirts?\b|\bshirts\b|\btops\b/i, { per: 'day' }],
];
const BAG_GUESSES = [
  [/\bwork\b|office/i, { when: ['work'] }],
  [/\bgym\b|workout/i, { when: ['gym'] }],
  [/beach|pool\b|swim/i, { when: ['swim'] }],
  [/\bski\b|snow/i, { when: ['snow'] }],
];
export function guess(name, forBag = false) {
  for (const [re, g] of forBag ? BAG_GUESSES : GUESSES) if (re.test(name)) return { when: [], unless: [], per: '', ...g };
  return { when: [], unless: [], per: '' };
}

const ICONS = [
  [/non-?liquid|dry toiletr/i, '🪥'],
  [/liquid|3-?1-?1/i, '🧴'],
  [/toiletr|tooth|dental/i, '🪥'],
  [/bathroom|wash|shower/i, '🧴'],
  [/electr|\btech\b|charger|cable|gadget/i, '🔌'],
  [/document|passport|papers|travel doc|\bdocs\b|money|wallet/i, '🛂'],
  [/cross ?body|purse|handbag|clutch/i, '👜'],
  [/backpack|day ?bag|personal item/i, '🎒'],
  [/shoe|boots|footwear|sneaker/i, '👟'],
  [/\bgym\b|workout/i, '🏋️'],
  [/attire|cloth|outfit|wardrobe|wear/i, '👕'],
  [/\bwork\b|office|laptop bag/i, '💼'],
  [/medic|\bmeds\b|pill|first aid|pharm|health/i, '💊'],
  [/baby|\bkids?\b|child/i, '🧸'],
  [/beach|pool|swim/i, '🏖️'],
  [/\bski(s|ing)?\b|snow/i, '🎿'],
  [/\bcamp(ing)?\b/i, '🏕️'],
  [/\bgolf/i, '⛳'],
  [/\b(dog|cat|pet)s?\b/i, '🐶'],
  [/snack|food/i, '🍫'],
  [/camera|photo/i, '📷'],
];
export function bagIcon(name, kind = 'bag') {
  if (kind === 'leave') return '🏠';
  if (kind === 'back') return '🏨';
  for (const [re, icon] of ICONS) if (re.test(name)) return icon;
  return '🧳';
}
export function bagKind(name) {
  if (/(leav(e|ing)|check(ing)?[ -]?out of) (the )?(hotel|room|airbnb|(vacation )?rental|cabin|cottage|condo|villa)|\bcheck[ -]?out\b|coming home|heading home|going home/i.test(name)) return 'back';
  if (/leav(e|ing) (the )?(house|home|apartment|flat)|before (you|we|i) (go|leave)|before (leaving|departure)|to do before|lock ?up|house ?(check|jobs)/i.test(name)) return 'leave';
  return 'bag';
}

// ---------- pasted lists ----------

// A count typed with a thing: "Socks x5", "Socks ×5", "Shorts (2)", "2x jeans", "5 pairs of socks", "3 T-shirts".
// Gives the name without it, and the count (1 to 20, as a thing's How many goes), or no count. A number with a
// unit or a hyphen after it is part of the name: "100 ml", "3-1-1 bag", "2-in-1 charger", "4G hotspot".
const UNIT = /^(ml|l|fl|oz|g|kg|mg|lbs?|mm|cm|m|in|inch(es)?|ft|gb|tb|mb|mah|v|w|am|pm|days?|nights?|weeks?|hours?|hrs?|mins?)\b/i;
export function counted(line) {
  let m, n = '', name = line, front = false;
  if ((m = /^(.*\S)\s+[x×]\s?(\d{1,2})$/i.exec(line)) || (m = /^(.*\S)\s*\(\s*[x×]?\s?(\d{1,2})\s*\)$/i.exec(line))) [, name, n] = m;
  else if ((m = /^(\d{1,2})\s?[x×]\s+(\S.*)$/i.exec(line)) || (m = /^(\d{1,2})\s+pairs?\s+of\s+(\S.*)$/i.exec(line))
    || ((m = /^(\d{1,2})\s+(\p{L}.*)$/u.exec(line)) && !UNIT.test(m[2]))) { [, n, name] = m; front = true; }
  if (!n) return { name: line, qty: 0 };
  // "2x jeans" is Jeans, but "2 iPads" stays iPads.
  if (front && !/^\p{Ll}\p{Lu}/u.test(name)) name = name[0].toUpperCase() + name.slice(1);
  return { name, qty: Math.min(20, Math.max(1, +n)) };
}
// Takes the text of a list from Google Keep, Apple Notes, Google Docs, Markdown or a plain text file:
//   - a line ending with ":" starts a bag, and so do "# Heading" and "**Heading**", and a line with
//     more-indented lines under it;
//   - a line with a bullet, a box or a number at the margin, right under a line without one, is under it;
//   - "●" and "○" bullets (Google Docs) count as levels the same way indents do;
//   - a top-level line with nothing under it is a thing on its own, kept together in "Not in a bag";
//   - a title line goes: "# Title", or a line on its own above a blank line and a list of boxes or bullets;
//   - an emoji in front of a bag's name is its icon;
//   - only when none of that made a bag: blocks of lines between blank lines, each under its first line, and
//     short ALL-CAPS lines, are bags.
// Bullets, checkboxes and numbers are dropped. Ids come from the names, so the same text pasted on two
// devices makes the same list, which merges into one.

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x';

const DOCS = /^\s*[●○■]/m;
const MARK = /^([●•▪■◆○◦▫□‣⁃*–-]|\+(?=\s)|\[[ xX✓]?\]|[☐☑✓✔✅]|\d+[.)])\s*/u;
const HEADING = /^(#{1,6})\s+(.*?)[\s#]*$/;
const BOLD = /^(\*\*|__)(.+)\1$/;
const EMOJI = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{EMod})*)\s*/u;
const CAPS = s => s.length <= 30 && !/\p{Ll}/u.test(s) && (s.match(/\p{Lu}/gu) || []).length >= 4;
const DOCS_LEVEL = { '●': 0, '•': 0, '○': 4, '◦': 4, '■': 8, '▪': 8 };

// Puts the lines in bags. Levels are relative: whatever is deeper than the line before is under it. With
// blocks, a blank line ends a bag.
function read(lines, blocks = false) {
  const bags = [], items = [], used = new Set();
  const uid = base => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
  let loose = null, cur = null, curLevel = -1, colon = false;
  const makeBag = (heading) => {
    let name = heading, icon = '';
    const e = EMOJI.exec(name);
    if (e && e[1].length <= 8 && name.length > e[0].length) { icon = e[1]; name = name.slice(e[0].length); }
    const kind = bagKind(name), g = guess(name, true);
    const b = { id: uid('b-' + slug(name)), name, icon: kind === 'bag' && icon ? icon : bagIcon(name, kind), kind, when: kind === 'bag' ? g.when : [], unless: [], note: '' };
    bags.push(b);
    return b;
  };
  const addItem = (bag, line) => {
    const { name, qty } = counted(line);
    const g = bag.kind === 'bag' ? guess(name) : { when: [], unless: [], per: '' };
    // The bag already says it (a badge in the work bag).
    if (g.when.length && g.when.every(k => bag.when.includes(k))) g.when = [];
    // "Socks x5" is five socks, not one a day.
    if (qty) g.per = '';
    items.push({ id: uid('i-' + slug(bag.name).slice(0, 12) + '-' + slug(name).slice(0, 28)), name, bag: bag.id, when: g.when, unless: g.unless, qty: qty || 1, per: g.per, note: '' });
  };
  // lastMarked: whether the last thing in the current bag had a bullet. Under "Electronics:", "Headphones" then
  // "☐ Charger" are both things in it; after "- Toothbrush" under "Toiletries:", "Tech" then "- Charger" is a bag.
  let lastMarked = null;
  lines.forEach((ln, i) => {
    const next = lines[i + 1];
    if (blocks && ln.gap && !ln.head) cur = null;
    const deeper = next ? next.level - ln.level : 0;
    const under = deeper >= 1 || (deeper > 0 && !(cur && colon && ln.level === curLevel && !lastMarked));
    const header = ln.head || /:$/.test(ln.body) || (under && (cur === null || ln.level <= curLevel));
    if (header) {
      cur = makeBag(ln.body.replace(/:$/, '').trim());
      curLevel = ln.level;
      colon = !!ln.head || /:$/.test(ln.body);
      lastMarked = null;
    } else if (cur && (ln.level > curLevel || (colon && ln.level === curLevel))) {
      addItem(cur, ln.body);
      lastMarked = ln.marked;
    } else {
      cur = null; curLevel = -1;
      if (!loose) loose = makeBag('Not in a bag');
      addItem(loose, ln.body);
    }
  });
  return { bags, items, loose };
}

export function parsePaste(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/[​‌‍﻿]/g, '');
  // Google Docs marks its levels with ●, ○ and ■. Then the bullets say the level.
  const docs = DOCS.test(src);
  // Each line: its indent, its text without bullets or boxes, whether it had one, whether it's a heading by how
  // it looks (1 for "# Title", 2 for "## Heading" or "**Heading**"), and whether a blank line came before it.
  let lines = [], gap = false;
  for (const raw of src.split('\n')) {
    if (!raw.trim()) { gap = true; continue; }
    const lead = /^[ \t]*/.exec(raw)[0].replace(/\t/g, '    ').length;
    let body = raw.trim(), head = 0, m;
    const bullet = docs && body[0] in DOCS_LEVEL ? body[0] : '';
    if ((m = HEADING.exec(body))) { body = m[2]; head = m[1].length === 1 ? 1 : 2; } else if ((m = BOLD.exec(body))) { body = m[2].trim(); head = 2; }
    const marked = !head && MARK.test(body);
    if (!head) for (let i = 0; i < 3 && MARK.test(body); i++) body = body.replace(MARK, '').trim();
    if (!body) continue;
    lines.push({ lead, body, marked, head, bullet, gap });
    gap = false;
  }
  // A title goes. In Google Docs, a first line without a bullet, unless it's a heading like the others there.
  const [first, second] = lines;
  const plain = x => docs && !x.bullet;
  if (first && !/:$/.test(first.body) && (docs
    ? plain(first) && (!second || second.gap || plain(second) || !lines.slice(1).some(plain))
    : first.head === 1 ? !lines.slice(1).some(x => x.head === 1) : !first.head && !first.marked && second?.gap && second.marked)) lines = lines.slice(1);
  // Levels. A bullet at the margin sits under a line at the margin without one, as if indented a little.
  const mixed = !docs && lines.some(x => !x.lead && x.marked) && lines.some(x => !x.lead && !x.marked && !x.head);
  for (const x of lines) x.level = docs ? (x.bullet ? DOCS_LEVEL[x.bullet] : -1) : x.lead + (mixed && !x.lead && x.marked ? 0.5 : 0);

  let made = read(lines);
  // Nothing made a bag: try blank-line blocks and ALL-CAPS headings.
  if (made.bags.every(b => b === made.loose)) {
    const starts = lines.filter((x, i) => (i === 0 || x.gap) && lines[i + 1] && !lines[i + 1].gap);
    const caps = lines.filter((x, i) => CAPS(x.body) && lines[i + 1] && !CAPS(lines[i + 1].body));
    const blocks = starts.length >= 2;
    if (blocks || caps.length >= 2) {
      for (const x of blocks ? starts : []) x.head = 2;
      for (const x of caps.length >= 2 ? caps : []) { x.head = 2; x.body = x.body[0] + x.body.slice(1).toLowerCase(); }
      made = read(lines, blocks);
    }
  }
  const { bags, items, loose } = made;
  // A bag with nothing in it (a heading with no lines after it) goes.
  const full = bags.filter(b => items.some(x => x.bag === b.id));
  // "Not in a bag" goes last among the bags, before the jobs for leaving.
  const rank = b => (b.kind === 'leave' ? 2 : b.kind === 'back' ? 3 : b === loose ? 1 : 0);
  full.sort((a, b) => rank(a) - rank(b));
  return { bags: full, items, tags: [] };
}
