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
// Takes the text of a list from Google Keep, Apple Notes, Google Docs or a plain text file:
//   - a line ending with ":" starts a bag, and so does a line with more-indented lines under it;
//   - "●" and "○" bullets (Google Docs) count as levels the same way indents do;
//   - a top-level line with nothing under it is a thing on its own, kept together in "Not in a bag".
// Bullets, checkboxes and numbers are dropped. Ids come from the names, so the same text pasted on two
// devices makes the same list, which merges into one.

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x';
const LEVEL1 = /^[○◦▫□‣⁃–-]\s/;

const DOCS = /^\s*[●○■]/m;
const MARK = /^([●•▪■◆○◦▫□‣⁃*–-]|\[[ xX✓]?\]|[☐☑✓✔✅]|\d+[.)])\s*/u;

export function parsePaste(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/[​‌‍﻿]/g, '');
  // Google Docs marks its levels with ●, ○ and ■. Then the bullets say the level, and a line before the
  // first bullet is the document's title.
  const docs = DOCS.test(src);
  const lines = [];
  for (const raw of src.split('\n')) {
    if (!raw.trim()) continue;
    const lead = /^[ \t]*/.exec(raw)[0].replace(/\t/g, '    ').length;
    let body = raw.trim();
    let level = lead;
    if (docs) {
      const b = body[0];
      if (b === '●' || b === '•') level = 0;
      else if (b === '○' || b === '◦') level = 4;
      else if (b === '■' || b === '▪') level = 8;
      else if (!lines.length) continue;
    } else if (LEVEL1.test(body) && lead === 0) level = 2; // "- item" at the margin sits under the line above
    for (let i = 0; i < 3 && MARK.test(body); i++) body = body.replace(MARK, '').trim();
    if (!body) continue;
    lines.push({ level, body });
  }
  // Levels are relative: whatever is deeper than the line before is under it.
  const bags = [], items = [], used = new Set();
  const uid = base => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
  let loose = null, cur = null, curLevel = -1;
  const makeBag = (name, kind = bagKind(name)) => {
    const g = guess(name, true);
    const b = { id: uid('b-' + slug(name)), name, icon: bagIcon(name, kind), kind, when: kind === 'bag' ? g.when : [], unless: [], note: '' };
    bags.push(b);
    return b;
  };
  const addItem = (bag, name) => {
    const g = bag.kind === 'bag' ? guess(name) : { when: [], unless: [], per: '' };
    // The bag already says it (a badge in the work bag).
    if (g.when.length && g.when.every(k => bag.when.includes(k))) g.when = [];
    items.push({ id: uid('i-' + slug(bag.name).slice(0, 12) + '-' + slug(name).slice(0, 28)), name, bag: bag.id, when: g.when, unless: g.unless, qty: 1, per: g.per, note: '' });
  };
  let colon = false;
  lines.forEach((ln, i) => {
    const next = lines[i + 1];
    const header = /:$/.test(ln.body) || (next && next.level > ln.level && (cur === null || ln.level <= curLevel));
    if (header) {
      cur = makeBag(ln.body.replace(/:$/, '').trim());
      curLevel = ln.level;
      colon = /:$/.test(ln.body);
    } else if (cur && (ln.level > curLevel || (colon && ln.level === curLevel))) {
      addItem(cur, ln.body);
    } else {
      cur = null; curLevel = -1;
      if (!loose) loose = makeBag('Not in a bag');
      addItem(loose, ln.body);
    }
  });
  // A bag with nothing in it (a heading with no lines after it) goes.
  const full = bags.filter(b => items.some(x => x.bag === b.id));
  // "Not in a bag" goes last among the bags, before the jobs for leaving.
  const rank = b => (b.kind === 'leave' ? 2 : b.kind === 'back' ? 3 : b === loose ? 1 : 0);
  full.sort((a, b) => rank(a) - rank(b));
  return { bags: full, items, tags: [] };
}
