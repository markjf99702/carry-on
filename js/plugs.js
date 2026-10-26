// Which plugs fit the wall sockets where, and the voltage there (IEC plug types A–O; mostly from the
// IEC's own World Plugs list). Country codes are ISO 3166 alpha-2, as the place search returns them.
const TABLE = `
US AB 120|CA AB 120|MX AB 127|PR AB 120|GU AB 110|VI AB 110|AS AB 120|MP AB 120|BM AB 120|BS AB 120|KY AB 120|TC AB 120
BB AB 115|JM AB 110|HT AB 110|DO ABC 120|CU ABCL 110|TT AB 115|AW ABF 127|CW ABF 127|SX ABCF 110|BQ ABCF 127|AG AB 230
LC G 230|GD G 230|VC ACEGIK 230|DM DG 230|KN DG 230|MS AB 230|VG AB 110|AI AB 110|GP CE 230|MQ CE 230|BL CE 230|MF CE 230
BZ ABG 110|GT AB 120|SV AB 115|HN AB 120|NI AB 120|CR AB 120|PA AB 120|CO AB 110|VE AB 120|EC AB 120|PE ABC 220|BO AC 230
BR CN 127|AR CI 220|CL CL 220|UY CFIL 220|PY C 220|GY ABDG 240|SR CF 127|GF CDE 220|FK G 240
GB G 230|IE G 230|IM CG 230|JE G 230|GG G 230|MT G 230|CY G 230|GI CG 230
FR CE 230|BE CE 230|MC CDEF 230|PL CE 230|CZ CE 230|SK CE 230|DK CEFK 230|FO CEFK 230|GL CEFK 230
DE CF 230|NL CF 230|LU CF 230|AT CF 230|IT CFL 230|SM CFL 230|VA CFL 230|ES CF 230|AD CF 230|PT CF 230|GR CF 230
NO CF 230|SE CF 230|FI CF 230|AX CF 230|IS CF 230|HU CF 230|SI CF 230|HR CF 230|RS CF 230|BA CF 230|ME CF 230|XK CF 230
MK CF 230|AL CF 230|RO CF 230|BG CF 230|EE CF 230|LV CF 230|LT CF 230|UA CF 230|MD CF 230|BY CF 230|RU CF 220
CH CJ 230|LI CJ 230|TR CF 230|GE CF 220|AM CF 230|AZ CF 220
IL CHM 230|PS CHM 230|JO BCDFGJ 230|LB ABCDG 220|SY CEL 220|IQ CDG 230|IR CF 220|KW CG 240|SA G 230|BH G 230|QA DG 240
AE CDG 230|OM CG 240|YE ADG 230|EG CF 220
MA CE 220|DZ CF 230|TN CE 230|LY CDFL 230|SD CD 230|ET CEFL 220|ER CL 230|DJ CE 220|SO C 220|KE G 240|UG G 240
TZ DG 230|RW CJ 230|BI CE 220|CD CDE 220|CG CE 230|GA C 220|CM CE 220|NG DG 240|GH DG 230|CI CE 230|SN CDEK 230
ML CE 220|BF CE 220|NE ACEF 220|TG C 220|BJ CE 220|LR ABCEF 120|SL DG 230|GN CFK 220|GM G 230|CV CF 220|MR C 220
AO C 220|ZM CDG 230|ZW DG 220|MW G 230|MZ CFM 220|NA DM 220|BW DGM 230|ZA CDMN 230|LS M 220|SZ M 230|MG CDEJK 220
MU CG 230|SC G 240|RE CE 230|KM CE 220|ST CF 220
JP AB 100|KR CF 220|KP ACF 220|CN ACI 220|HK G 220|MO DG 220|TW AB 110|MN CE 230
IN CDM 230|PK CD 230|BD ACDGK 220|LK DG 230|NP CDM 230|BT DFG 230|MV CDGJKL 230|AF CF 220
TH ABCFO 230|VN ACF 220|KH ACG 230|LA ABCEF 230|MM ACDFG 230|MY G 240|SG G 230|BN G 240|ID CF 230|TL CEFI 220|PH ABC 220
KZ CF 220|UZ CF 220|KG CF 220|TJ CF 220|TM BCF 220
AU I 230|NZ I 230|FJ I 240|PG I 240|SB GI 230|VU CGI 220|NC CF 220|PF AE 220|WS I 230|TO I 240|CK I 240|KI I 240
FM AB 120|PW AB 120|MH AB 120|NR I 240|TV I 220
`;

export const PLUGS = {};
for (const row of TABLE.trim().split(/[|\n]/)) {
  const [cc, types, volts] = row.trim().split(' ');
  PLUGS[cc] = { types: [...types], volts: +volts };
}

// Which sockets a plug goes into without an adapter. A two-pin US plug (A) goes into B as well, and
// a two-pin Europlug (C) into most of the round-pin sockets of Europe, Asia and South America.
const FITS = {
  A: 'AB', B: 'B', C: 'CEFJKLN', D: 'D', E: 'EF', F: 'EF', G: 'G', H: 'H', I: 'I', J: 'J', K: 'K', L: 'L', M: 'M', N: 'N', O: 'O',
};

// What someone from `home` needs in `dest`: whether their plugs fit, and the sockets and voltage there.
export function plugsFor(home, dest) {
  const h = PLUGS[home], d = PLUGS[dest];
  if (!d) return null;
  const fits = !h || h.types.some(p => d.types.some(s => FITS[p].includes(s)));
  const volts = !h ? false : (h.volts <= 127) !== (d.volts <= 127);
  return { need: !fits, types: d.types, volts: d.volts, voltsDiffer: volts };
}

// "Type G, 230 V"
export const plugText = p => `Type ${p.types.join('/')}, ${p.volts} V`;

// The country this browser's languages point to, for a first guess at home. The first language says most: its
// own country (en-GB → GB, zh-Hant-TW → TW), or one a later tag in that language names (en, en-GB → GB), or else
// where that language is mostly spoken (de → DE, ja → JP), so German followed by English is still Germany. Then
// any country another tag names, and the US when nothing does.
export function localCountry(langs = globalThis.navigator?.languages || []) {
  const tags = [];
  for (const l of langs) try { tags.push(new Intl.Locale(l)); } catch { /* not a language tag */ }
  const known = r => (r && PLUGS[r] ? r : null);
  if (!tags.length) return 'US';
  for (const t of tags) if (t.language === tags[0].language && known(t.region)) return t.region;
  try { const r = known(tags[0].maximize().region); if (r) return r; } catch { /* no likely country */ }
  for (const t of tags) if (known(t.region)) return t.region;
  return 'US';
}

export function countryName(cc) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || cc; } catch { return cc; }
}
