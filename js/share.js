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
// When a thing is probably needed, from its name. Only a first guess: every one can be changed. A third pattern is
// what the name mustn't have. (Not a lookbehind in the first: Safari before 16.4 can't read one, and the whole page
// would fail to load.)
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
  [/adapter|converter/i, { when: ['plug'] }, /(usb-?c?|hdmi|lightning|headphone|audio|display|sd|card) adapter/i],
  [/umbrella|rain ?(jacket|coat|shell|boots?)|poncho|waterproof (jacket|coat|shell)/i, { when: ['rain'] }],
  [/winter coat|warm coat|parka|puffer|gloves|mittens|beanie|scarf|thermal|long underwear|long johns|hand warmers/i, { when: ['cold'] }],
  [/light jacket|fleece|sweater|sweatshirt|hoodie|cardigan|\bjumpers?\b/i, { when: ['cool', 'cold'] }],
  [/\bsuit\b|\bties?\b|dress (shoes|shirts?)|blazer|heels|cufflinks|dressy|formal/i, { when: ['dressy'] }, /hair ties?\b/i],
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
  for (const [re, g, not] of forBag ? BAG_GUESSES : GUESSES) if (re.test(name) && !not?.test(name)) return { when: [], unless: [], per: '', ...g };
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
//   - under a heading whose things came in deeper (with bullets, boxes or an indent), a plain line at the
//     heading's own level isn't one of them: it's on its own;
//   - a heading with no name ("-:") starts no bag: what's under it stays with the bag before;
//   - "●" and "○" bullets (Google Docs) count as levels the same way indents do;
//   - a top-level line with nothing under it is a thing on its own, kept together in "Not in a bag";
//   - a title line goes: "# Title", or a line on its own above a blank line and a list of boxes or bullets,
//     unless lines further down look the same (then it's the first heading of several);
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
  const bags = [], items = [], used = new Set(), nextN = new Map();
  // The first of base, base-2, base-3… not used yet. Each base remembers how far it got, so a thousand of the same
  // line don't each count up from the start.
  const uid = base => {
    let n = nextN.get(base) || 1, id;
    do { id = n === 1 ? base : `${base}-${n}`; n++; } while (used.has(id));
    nextN.set(base, n);
    used.add(id);
    return id;
  };
  // firstLevel: the level of the current bag's first thing.
  let loose = null, cur = null, curLevel = -1, colon = false, firstLevel = null;
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
    // A count is read only in a bag: a job like "2 bins out" keeps its words.
    const { name, qty } = bag.kind === 'bag' ? counted(line) : { name: line, qty: 0 };
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
      const name = ln.body.replace(/:$/, '').trim();
      if (!name) return;
      cur = makeBag(name);
      curLevel = ln.level;
      colon = !!ln.head || /:$/.test(ln.body);
      lastMarked = null;
      firstLevel = null;
    } else if (cur && (ln.level > curLevel || (colon && ln.level === curLevel && !(firstLevel !== null && firstLevel > curLevel && !ln.marked)))) {
      addItem(cur, ln.body);
      lastMarked = ln.marked;
      if (firstLevel === null) firstLevel = ln.level;
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
    : first.head === 1 ? !lines.slice(1).some(x => x.head === 1)
      : !first.head && !first.marked && second?.gap && second.marked && !lines.some((x, i) => i > 0 && !x.head && !x.marked && !x.lead && lines[i + 1]?.marked))) lines = lines.slice(1);
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

// ---------- sorting what's not in a bag ----------
// A Google Keep checklist is usually one flat list, so it comes in as "Not in a bag". A small list of words can sort
// it into the starter list's own bags, by their names and icons, so it lines up with the starter list, or with
// another phone's, when the two meet. Each bag with the words that put a thing in it; the first that fits wins, so
// contact lens solution goes in the Liquids bag before contacts go in the Toiletries bag, and hair ties in the
// Toiletries bag before ties go in Clothes. (No lookbehind: see GUESSES.)
const SORT = [
  ['Liquids bag', '🧴', /shampoo|conditioner|toothpaste|sunscreen|sun ?block|\bspf\b|after.?sun|aloe|deodorant|face ?wash|cleanser|moisturi[sz]er|lotion|lens solution|saline|mouthwash|body ?wash|shower gel|\bsoap\b|hand sanitizer|perfume|cologne|hair ?(gel|spray|oil)|\bserum\b|makeup remover/i],
  ['Toiletries bag', '🪥', /toothbrush|floss|razor|shaver|shaving|hair ?brush|\bcombs?\b|nail (clippers?|file)|tweezers|lip ?balm|chapstick|\bglasses\b|contacts\b|contact lenses|prescriptions?|medicines?|medications?|\bmeds\b|\bpills?\b|vitamins|pain reliever|ibuprofen|tylenol|advil|aspirin|retainer|band-?aids?|plasters|first aid|hair (ties?|clips?|bands?)|scrunchies?|bobby pins|makeup|tampons|\bpads\b|q-?tips|cotton (buds|swabs)/i],
  ['Electronics', '🔌', /charger|charging|cables?\b|\bcords?\b|headphones|earbuds|airpods|laptop|tablet|\bipads?\b|\bphone\b|power ?bank|batter(y|ies)|adapter|converter|camera|\bgopro\b|speaker|hotspot|\busb\b/i],
  ['Documents and money', '🛂', /passport|wallet|\bids?\b|driver.?s licen[cs]e|\bkeys?\b|credit cards?|debit cards?|bank cards?|\bcash\b|money|currency|tickets?|boarding pass|insurance card|\bvisa\b|itinerary|travel doc|reservations?/i],
  ['Clothes', '👕', /socks?\b|underwear|boxers|briefs|\bbras?\b|undershirts?|t-?shirts?|\bshirts?\b|\btops?\b|blouses?|\bpants\b|trousers|jeans|shorts|leggings|skirts?|\bdress(es)?\b|pajamas|pyjamas|\bpjs\b|nightgown|shoes|sneakers|trainers|boots|sandals|flip.?flops|slippers|\bbelts?\b|swimsuit|swim ?trunks|bathing suit|bikini|jacket|\bcoats?\b|sweaters?|jumpers?|hoodies?|sweatshirts?|fleece|cardigans?|\bhats?\b|\bcaps?\b|beanie|gloves|mittens|scarf|scarves|\bsuits?\b|blazer|\bties?\b|heels|\bvests?\b|workout clothes|outfits?|clothes/i],
  ['Day bag', '🎒', /sunglasses|snacks?\b|\bbooks?\b|e-?reader|kindle|water bottle|umbrella|eye ?mask|ear ?plugs|(neck|travel) pillow|\bgum\b|tissues|magazines?|crossword|puzzles?|journal|\bpens?\b|playing cards|bug spray|insect repellent|mints/i],
];

// Sorts a list's things not in a bag into those bags: one of the list's own with the same name ("Toiletries" is the
// Toiletries bag) or, failing that, its only one with the same icon ("Attire" has the clothes' icon), or else a new
// bag after the list's own. What none of the words fit stays in "Not in a bag", which goes once it's empty.
// Returns { list, placed: how many were sorted, left: how many stay }.
export function sortLoose(list) {
  const loose = list.bags.find(b => b.kind === 'bag' && b.name.toLowerCase() === 'not in a bag');
  const mine = loose ? list.items.filter(x => x.bag === loose.id) : [];
  if (!mine.length) return { list, placed: 0, left: 0 };
  const key = name => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/ (bag|kit|pouch|case)$/, '');
  const own = list.bags.filter(b => b.kind === 'bag' && b !== loose);
  const ids = new Set(list.bags.map(b => b.id));
  const made = [], to = new Map();
  const bagFor = (name, icon) => {
    const same = own.find(b => key(b.name) === key(name)), icons = own.filter(b => b.icon === icon);
    let bag = same || (icons.length === 1 ? icons[0] : made.find(b => b.name === name));
    if (!bag) {
      let id = 'b-' + slug(name), n = 2;
      while (ids.has(id)) id = `b-${slug(name)}-${n++}`;
      ids.add(id);
      made.push(bag = { id, name, icon, kind: 'bag', when: [], unless: [], note: '' });
    }
    return bag;
  };
  for (const x of mine) {
    const fit = SORT.find(([, , re]) => re.test(x.name));
    if (fit) to.set(x.id, bagFor(fit[0], fit[1]).id);
  }
  const left = mine.length - to.size;
  // The new bags in the starter list's order, where "Not in a bag" was.
  made.sort((a, b) => SORT.findIndex(s => s[0] === a.name) - SORT.findIndex(s => s[0] === b.name));
  const at = list.bags.indexOf(loose);
  const bags = [...list.bags.slice(0, at), ...made, ...(left ? [loose] : []), ...list.bags.slice(at + 1)];
  return { list: { ...list, bags, items: list.items.map(x => (to.has(x.id) ? { ...x, bag: to.get(x.id) } : x)) }, placed: to.size, left };
}
