// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Someone starts from the starter list, plans a trip to Lisbon and packs for it: the forecast, the place and
// the occasions decide what's on the list, things get ticked, left off, added and moved, and the coming-home
// pass lists only what went. A trip too far off for a forecast gets typical weather; one with no connection is
// set by hand. The list is changed, sent as a link and opened on another phone, a list is pasted in, what's typed
// stays put while the page redraws, quick taps tick what was tapped, finishing the packing says so, and two phones
// share one list and its ticks through a stand-in Google Drive (test/fake-google.mjs).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openMeteo, calls } from './fixture.mjs';
import { fakeGoogle } from './fake-google.mjs';
import { encodeList } from '../js/share.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const origin = base.slice(0, -1);

const browser = await pw.chromium.launch();
const problems = [];
const ALLOWED = /^https:\/\/(geocoding-api|api|archive-api)\.open-meteo\.com\/|^https:\/\/(accounts\.google\.com|www\.googleapis\.com)\//;

async function phone({ weather = {}, google = null, sw = 'block' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: sw });
  await openMeteo(ctx, weather);
  if (google) await google.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://carry-on.junkdrawer.works']", `['https://carry-on.junkdrawer.works', '${origin}']`) } });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/status of 401|ERR_INTERNET_DISCONNECTED/.test(m.text())) problems.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:') && !ALLOWED.test(u)) problems.push('left the site: ' + u); });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await wait(80); }
  throw new Error('timed out waiting for ' + what);
}
const fits = async (page, where) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where} scrolls sideways on a phone`);
const day = (page, n) => page.evaluate(n => window.carryOn.D.add(window.carryOn.D.today(), n), n);
const rowsText = page => page.locator('main .bag .name').allInnerTexts();
const row = (page, name) => page.locator('main .bag li.row', { has: page.locator('.name', { hasText: new RegExp(`^${name}( ×\\d+)?$`) }) });
const sheetOpen = page => page.evaluate(() => document.getElementById('sheet').open);
const closeSheet = async page => { await page.keyboard.press('Escape'); await until(async () => !(await sheetOpen(page)), 'the sheet to close'); };
const more = async (page, name) => { await row(page, name).locator('.more').click(); await until(() => sheetOpen(page), 'the sheet'); };
const toastUndo = async page => { await page.locator('#toast button').waitFor(); await wait(500); await page.click('#toast button'); };

async function planTrip(page, { where, pick = 0, from, to, by = 'Flying', on = [], typed = false }) {
  await page.click('text=Plan a trip');
  await page.fill('#where', where);
  if (typed) {
    await page.locator('.results button', { hasText: 'without looking it up' }).click();
  } else {
    await page.locator('.results button').nth(pick).click();
  }
  await page.fill('#start', await day(page, from));
  await page.fill('#end', await day(page, to));
  await page.locator('.seg button', { hasText: by }).click();
  for (const o of on) await page.locator('.form .chip', { hasText: new RegExp(` ${o}$`) }).click();
  await page.click('text=Make my list');
  await page.waitForSelector('.pass h1');
}

// ================= One phone: the starter list and a trip to Lisbon =================
{
  const { ctx, page } = await phone();
  assert.match(await page.locator('main h1').innerText(), /trip you’re actually taking/i);
  await fits(page, 'the first screen');
  // Hover styles only where a pointer hovers: on a touch screen they stay stuck on whatever was tapped last.
  const hovers = await page.evaluate(() => [...document.styleSheets].flatMap(s => [...s.cssRules]).map(r => r.selectorText || '').filter(t => t.includes(':hover')));
  assert.deepEqual(hovers, ['.jd-foot a:hover, .jd-foot a:focus-visible'], 'hover styles outside @media (hover: hover)');
  await page.click('text=Start with a starter list');
  await page.waitForSelector('text=No trips yet.');

  await planTrip(page, { where: 'Lisb', from: 3, to: 7, on: ['Work'] });
  assert.equal(await page.locator('.pass h1').innerText(), 'LISBON');
  await page.waitForSelector('.wx-days li');
  assert.equal(await page.locator('.wx-days li').count(), 5, 'five days of forecast');
  assert.equal(await page.locator('.wx-head h2').innerText(), 'FORECAST');
  let names = await rowsText(page);
  for (const n of ['Passport', 'Plug adapter', 'Umbrella', 'Rain jacket', 'Swimsuit', 'Sunscreen', 'Badge', 'Toothbrush', 'Eye mask and earplugs']) assert.ok(names.includes(n), `${n} is on the list`);
  for (const n of ['Warm coat', 'Snow boots', 'Hiking boots', 'Workout clothes']) assert.ok(!names.includes(n), `${n} is not on the list`);
  assert.ok(names.includes('Socks ×5'), 'socks for five days');
  assert.match(await row(page, 'Umbrella').innerText(), /Rain likely Fri|Rain likely \w{3}/);
  assert.match(await row(page, 'Plug adapter').innerText(), /Type C\/F, 230 V/);
  const chips = await page.locator('.needs .chip').allInnerTexts();
  for (const c of ['Flying', 'Abroad', 'Other plugs', 'Rain', 'Work']) assert.ok(chips.some(x => x.includes(c)), `${c} chip`);
  await fits(page, 'the trip');

  // Ticking, and it keeps.
  const total = +(await page.locator('.progress p').innerText()).match(/of (\d+)/)[1];
  await row(page, 'Toothpaste').locator('.tick').click();
  await row(page, 'Phone charger').locator('.tick').click();
  assert.match(await page.locator('.progress p').innerText(), new RegExp(`^2 of ${total}`));
  assert.equal(await row(page, 'Toothpaste').locator('.tick').getAttribute('aria-checked'), 'true');
  await page.reload();
  await page.waitForSelector('.pass h1');
  assert.match(await page.locator('.progress p').innerText(), new RegExp(`^2 of ${total}`));
  assert.ok(!calls.some(c => c.startsWith('archive')), 'a trip in the forecast window needs no history');

  // Leave something off, then put it back.
  await more(page, 'Snacks');
  await page.click('text=Leave it off this trip');
  assert.ok(!(await rowsText(page)).includes('Snacks'));
  await page.click('.left-head');
  const left = page.locator('.left .row', { hasText: 'Snacks' });
  assert.match(await left.innerText(), /You left it off this trip/);
  assert.match(await page.locator('.left .row', { hasText: 'Warm coat' }).innerText(), /Only for cold/);
  await left.locator('button').click();
  assert.ok((await rowsText(page)).includes('Snacks'));
  // The Undo toast lets taps through to the list under it, and stays in reach over the next sheet.
  await more(page, 'Snacks');
  await page.click('text=Leave it off this trip');
  const words = await page.locator('#toast span').boundingBox();
  await row(page, 'Umbrella').evaluate((el, y) => window.scrollBy(0, el.getBoundingClientRect().top + el.offsetHeight / 2 - y), words.y + words.height / 2);
  const under = () => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#toast, li.row')?.textContent, [words.x + 8, words.y + words.height / 2]);
  assert.match(await under(), /^Umbrella/, 'the row under the toast’s words takes the tap');
  await more(page, 'Umbrella');
  const undo = await page.locator('#toast button').boundingBox();
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent, [undo.x + undo.width / 2, undo.y + undo.height / 2]), 'Undo', 'Undo shows over the sheet');
  assert.ok(undo.height >= 44, 'and is big enough to tap');
  await wait(500);
  await page.click('#toast button');
  await closeSheet(page);
  assert.ok((await rowsText(page)).includes('Snacks'), 'Undo brought it back');
  assert.ok(await page.evaluate(() => document.getElementById('toast').parentNode === document.body), 'the toast is back on the page');
  // Pack something the rules left off.
  await page.locator('.left .row', { hasText: 'Hiking boots' }).locator('button').click();
  assert.match(await row(page, 'Hiking boots').innerText(), /Added for this trip/);

  // Something just for this trip.
  await page.click('text=Add something for this trip');
  await page.fill('.sheet input[type="text"]', 'Wedding gift');
  await page.selectOption('.sheet select', { label: '🎒 Day bag' });
  await page.click('.sheet .btn.primary');
  assert.match(await page.locator('.bag', { hasText: 'Day bag' }).innerText(), /Wedding gift\s+Just for this trip/);
  // Move one into another bag, this trip only.
  await more(page, 'Sunglasses');
  await page.selectOption('.sheet select', { label: '👕 Clothes' });
  assert.match(await page.locator('.bag', { hasText: 'Clothes' }).innerText(), /Sunglasses\s+In this bag for this trip/);

  // Say it won't rain after all.
  await page.click('.needs .btn');
  await until(() => sheetOpen(page), 'the conditions sheet');
  await page.locator('.auto-list li', { hasText: 'Rain' }).locator('button', { hasText: 'No' }).click();
  await closeSheet(page);
  names = await rowsText(page);
  assert.ok(!names.includes('Umbrella') && !names.includes('Rain jacket'), 'no rain gear once rain is off');
  // An occasion added from the same sheet.
  await page.click('.needs .btn');
  await page.locator('.sheet .chip', { hasText: /Working out$/ }).click();
  await closeSheet(page);
  assert.ok((await rowsText(page)).includes('Workout clothes'));

  // Someone's home this time: no jobs before leaving. The sheet has no stray words in it.
  await page.locator('.bag', { hasText: 'Leaving the house' }).locator('.bag-head .icon-btn').click();
  await until(() => sheetOpen(page), 'the job list sheet');
  assert.doesNotMatch(await page.locator('.sheet').innerText(), /null|undefined/);
  await page.click('text=Skip these jobs this trip');
  assert.equal(await page.locator('.bag h2', { hasText: 'Leaving the house' }).count(), 0);
  assert.match(await page.locator('.left-head').innerText(), /Left off this trip/i);
  if ((await page.locator('.left-head').getAttribute('aria-expanded')) !== 'true') await page.click('.left-head');
  const leave = page.locator('.left .row', { hasText: 'Leaving the house' });
  assert.match(await leave.innerText(), /4 jobs · You left it off this trip/);
  await leave.locator('button', { hasText: 'Put back' }).click();
  assert.equal(await page.locator('.bag h2', { hasText: 'Leaving the house' }).count(), 1);
  // One job left off this trip waits there too, with its list's icon, and can be put back.
  await more(page, 'Water the plants');
  await page.click('text=Leave it off this trip');
  assert.equal(await row(page, 'Water the plants').count(), 0);
  const plants = page.locator('.left .row', { hasText: 'Water the plants' });
  assert.match(await plants.innerText(), /^🏠 Water the plants\s+You left it off this trip/);
  await plants.locator('button', { hasText: 'Put back' }).click();
  assert.equal(await row(page, 'Water the plants').count(), 1);
  assert.equal(await plants.count(), 0);

  // A bag that stays packed.
  await page.locator('.bag', { hasText: 'Liquids bag' }).locator('.bag-head .icon-btn').click();
  await page.click('text=It’s all packed already');
  assert.match(await page.locator('.bag', { hasText: 'Liquids bag' }).innerText(), /All \d+ packed/);

  // Hide what's done.
  await page.locator('.switch input').check();
  assert.ok(!(await rowsText(page)).includes('Phone charger'));
  await page.locator('.switch input').uncheck();

  // Coming home: only what went.
  await page.click('text=Coming home');
  const back = await rowsText(page);
  assert.ok(back.includes('Phone charger') && back.includes('Toothpaste'));
  assert.ok(!back.includes('Passport'), 'nothing that wasn’t packed');
  assert.ok(await page.locator('.bag h2', { hasText: 'Leaving the hotel' }).count());
  await more(page, 'Toothpaste');
  await page.click('text=Not bringing it back');
  assert.match(await row(page, 'Toothpaste').innerText(), /Not coming back/);
  await page.click('text=Going');

  // The trip on the trips screen.
  await page.click('.crumb');
  const card = page.locator('.tag-card').first();
  assert.match(await card.innerText(), /IN 3 DAYS[\s\S]*Lisbon[\s\S]*4 nights[\s\S]*packed/i);
  await fits(page, 'the trips screen');

  // ---------- a trip too far off for a forecast: typical weather ----------
  await planTrip(page, { where: 'Reyk', from: 40, to: 43, by: 'Flying' });
  await page.waitForSelector('.wx-days li.typ');
  assert.equal(await page.locator('.wx-head h2').innerText(), 'TYPICAL WEATHER FOR THESE DAYS');
  assert.equal(calls.filter(c => c.startsWith('archive')).length, 3, 'three past years');
  names = await rowsText(page);
  for (const n of ['Warm coat', 'Gloves and hat', 'Snow boots', 'Passport']) assert.ok(names.includes(n), `${n} for Iceland`);
  assert.ok(!names.includes('Swimsuit'));
  assert.ok(names.includes('Plug adapter'), 'US plugs don’t fit Iceland’s sockets');

  // ---------- my list ----------
  await page.goto(base + '#/list');
  const day1 = page.locator('.bag.edit', { hasText: 'Day bag' });
  await day1.locator('input').fill('Poncho');
  await day1.locator('input').press('Enter');
  assert.match(await day1.innerText(), /Poncho\s+Only for ☔ rain/);
  assert.match(await page.locator('#toast').innerText(), /only for rain/);
  // Change it to every trip.
  await page.locator('.edit-row', { hasText: 'Poncho' }).click();
  await page.selectOption('.sheet select >> nth=2', 'all');
  await page.click('.sheet .btn.primary');
  assert.doesNotMatch(await page.locator('.edit-row', { hasText: 'Poncho' }).innerText(), /Only for/);
  // Delete, and undo.
  await page.locator('.edit-row', { hasText: 'Poncho' }).click();
  await page.click('.sheet .btn.danger-quiet');
  assert.equal(await page.locator('.edit-row', { hasText: 'Poncho' }).count(), 0);
  await toastUndo(page);
  assert.equal(await page.locator('.edit-row', { hasText: 'Poncho' }).count(), 1);
  // A new occasion.
  await page.click('text=+ Add one');
  await page.fill('.sheet input', 'Wedding');
  await page.click('.sheet .btn.primary');
  assert.ok(await page.locator('.chip', { hasText: 'Wedding' }).count());
  // A long sheet keeps its title and its Save on screen while it scrolls.
  const inReach = sel => page.evaluate(sel => { const b = document.querySelector(sel), r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, sel);
  await page.locator('.edit-row', { hasText: 'Sunscreen' }).click();
  await page.click('.sheet summary');
  assert.ok(await page.evaluate(() => { const s = document.getElementById('sheet'); return s.scrollHeight > s.clientHeight; }), 'a sheet taller than the screen');
  assert.ok(await inReach('.sheet .btn.primary'), 'Save in reach');
  await page.evaluate(() => { document.getElementById('sheet').scrollTop = 400; });
  assert.ok(await inReach('.sheet .sheet-top .icon-btn'), 'and the close button, scrolled down');
  await closeSheet(page);
  await fits(page, 'my list');

  // ---------- the list as a link ----------
  await page.click('text=Send my list as a link');
  await until(async () => /Send my list/i.test(await page.locator('#sheetTitle').innerText()) && await sheetOpen(page), 'the link sheet');
  const link = await page.locator('.sheet input').inputValue();
  assert.match(link, /^https:\/\/carry-on\.junkdrawer\.works\/#list=[\w-]+$/);
  await closeSheet(page);

  await page.goto(base + '#/settings');
  await page.locator('.seg button', { hasText: '°C' }).click();
  await fits(page, 'settings');
  await page.goto(base + '#/trip/' + await page.evaluate(() => Object.values(window.carryOn.store.doc.trips).find(t => t.place?.cc === 'PT').id));
  assert.match(await page.locator('.wx-days').innerText(), /2[6-8]°/, 'Celsius now');

  // Works offline once it has been opened (with the service worker this time).
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  // Another project's offline copy at the same address is left alone; this one's old copy goes.
  await p2.goto(base + 'manifest.webmanifest');
  await p2.evaluate(() => Promise.all(['other-project-v1', 'carry-on-v1'].map(k => caches.open(k))));
  await p2.goto(base);
  await p2.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
  await p2.reload();
  await p2.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
  const kept = await p2.evaluate(() => caches.keys());
  assert.ok(kept.includes('other-project-v1') && !kept.includes('carry-on-v1'), `caches: ${kept}`);
  await ctx2.setOffline(true);
  await p2.reload();
  await p2.waitForSelector('.welcome h1');
  await ctx2.close();

  // Installable.
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(inst.installabilityErrors.filter(e => e.errorId !== 'not-from-secure-origin' && e.errorId !== 'no-matching-service-worker'), []);
  const man = await cdp.send('Page.getAppManifest');
  assert.deepEqual(man.errors, []);

  // ---------- another phone opens the link ----------
  const other = await phone();
  await other.page.goto(base + link.slice(link.indexOf('#')));
  await until(() => sheetOpen(other.page), 'the list offer');
  assert.match(await other.page.locator('.sheet').innerText(), /9 bags? and|7 bags and/);
  await other.page.click('text=Use this list');
  await other.page.waitForSelector('text=My list');
  assert.ok(await other.page.locator('.edit-row', { hasText: 'Poncho' }).count(), 'the change came along');
  assert.ok(await other.page.locator('.chip', { hasText: 'Wedding' }).count(), 'and the occasion');
  assert.equal(await other.page.evaluate(() => Object.keys(window.carryOn.store.doc.trips).length), 0, 'no trips in a list link');
  await other.ctx.close();

  // A backup brings back what was deleted since, starter things included, and says what came back.
  const backup = await page.evaluate(() => window.carryOn.store.backup());
  await page.evaluate(() => { const { store, M } = window.carryOn; store.apply(d => M.removeItem(M.removeBag(d, 's-leave'), 's-clothes-socks')); });
  await page.goto(base + '#/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await until(async () => (await page.locator('#toast').innerText()) === 'Restored 1 thing, 4 jobs and 1 list of jobs.', 'the restore toast');
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await until(async () => (await page.locator('#toast').innerText()) === 'Nothing in it that isn’t here already.', 'nothing new');

  // With every bag deleted, the first screen comes back, and the trips can still be opened from it.
  await page.evaluate(() => { const { store, M } = window.carryOn; for (const b of M.bags(store.doc)) store.apply(d => M.removeBag(d, b.id)); });
  await page.goto(base + '#/');
  await page.waitForSelector('.welcome');
  assert.deepEqual(await page.locator('.welcome .past b').allInnerTexts(), ['Lisbon', 'Reykjavík']);
  await page.locator('.welcome .past a', { hasText: 'Reykjavík' }).click();
  await page.waitForSelector('.pass h1');
  assert.match(await page.locator('main').innerText(), /Your list is empty, so nothing from it is on this trip/);
  await ctx.close();
}

// ================= No connection: a place typed in, the weather by hand =================
{
  const { ctx, page } = await phone({ weather: { fail: true } });
  await page.click('text=Start with a starter list');
  await page.click('text=Plan a trip');
  await page.fill('#where', 'Paris');
  await page.waitForSelector('.results .err');
  assert.match(await page.locator('.results').innerText(), /Couldn’t reach place search/);
  await page.locator('.results button', { hasText: 'without looking it up' }).click();
  await page.fill('#start', await day(page, 1));
  await page.fill('#end', await day(page, 2));
  await page.click('text=Make my list');
  await page.waitForSelector('.wx.none');
  assert.ok(!(await rowsText(page)).includes('Warm coat'));
  await page.click('.needs .btn');
  await page.locator('.auto-list li', { hasText: 'Cold' }).locator('button', { hasText: 'Yes' }).click();
  await page.locator('.auto-list li', { hasText: 'Abroad' }).locator('button', { hasText: 'Yes' }).click();
  await closeSheet(page);
  const names = await rowsText(page);
  assert.ok(names.includes('Warm coat') && names.includes('Passport'));
  assert.match(await row(page, 'Warm coat').innerText(), /You turned this on/);
  await ctx.close();
}

// ================= A pasted list =================
{
  const { ctx, page } = await phone();
  await page.click('text=Paste my own list');
  await page.fill('.sheet textarea', 'Travel list\n\n● Electronics\n  ○ Headphones\n  ○ Laptop charger\n● Attire\n  ○ Socks\n  ○ Swimsuit\n● Wegovy\n● Leaving the house\n  ○ Close windows');
  await page.click('.sheet .btn.primary');
  await until(async () => /Your pasted list/i.test(await page.locator('.sheet').innerText()), 'the preview');
  assert.match(await page.locator('.sheet').innerText(), /3 bags and 5 things/);
  await page.click('text=Use this list');
  await page.waitForSelector('.bag.edit');
  assert.deepEqual(await page.locator('.bag.edit h2').allInnerTexts(), ['ELECTRONICS', 'ATTIRE', 'NOT IN A BAG', 'LEAVING THE HOUSE']);
  assert.match(await page.locator('.edit-row', { hasText: 'Socks' }).innerText(), /one a day/);
  assert.match(await page.locator('.edit-row', { hasText: 'Swimsuit' }).innerText(), /Only for 🌡️ hot or 🏊 swimming/);
  await ctx.close();
}

// ================= A link on a phone that has a list: using it instead can be undone =================
{
  const { ctx, page } = await phone();
  await page.click('text=Start with a starter list');
  // Deleted before: Undo mustn't bring it back.
  await page.goto(base + '#/list');
  await page.click('[aria-label="Change Work bag"]');
  await page.click('.sheet .btn.danger-quiet');
  await page.click('.sheet .btn.danger-quiet');
  const mine = await page.locator('.bag.edit h2').allInnerTexts();
  assert.ok(!mine.includes('WORK BAG'));
  const code = await encodeList({ bags: [{ id: 'b-beach', name: 'Beach bag', icon: '🏖️', kind: 'bag' }], items: [{ id: 'i-towel', name: 'Towel', bag: 'b-beach' }], tags: [] });
  await page.goto(base + '#list=' + code);
  await until(() => sheetOpen(page), 'the list offer');
  assert.equal(await page.locator('.sheet .btn.primary').innerText(), 'Add it to my list', 'adding is the main button');
  await page.click('text=Use it instead of my list');
  await page.waitForSelector('.bag.edit');
  assert.deepEqual(await page.locator('.bag.edit h2').allInnerTexts(), ['BEACH BAG']);
  assert.match(await page.locator('#toast').innerText(), /^Your list is in\./);
  await toastUndo(page);
  assert.deepEqual(await page.locator('.bag.edit h2').allInnerTexts(), mine, 'the starter bags are back, and the Work bag stays deleted');
  await fits(page, 'my list after Undo');
  await ctx.close();
}

// ================= What's typed stays put while the page redraws =================
// Switching to another app and back, a forecast arriving, a sync landing or another tab saving all redraw the page.
{
  const { ctx, page } = await phone();
  await page.click('text=Start with a starter list');
  const other = await ctx.newPage(); // another tab: what it saves reaches this one through a storage event
  await other.goto(base);
  const saved = () => page.evaluate(() => JSON.stringify(window.carryOn.store.doc));
  const elsewhere = async (fn, arg) => {
    const was = await saved();
    await other.evaluate(fn, arg);
    await until(async () => (await saved()) !== was, 'the other tab’s change');
  };
  const redraws = async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await elsewhere(() => window.carryOn.store.apply(d => window.carryOn.M.setPref(d, 'laundry', 3 + Math.round(Math.random() * 9))));
  };
  const form = () => page.evaluate(() => ({
    picked: document.querySelector('.picked b')?.textContent || null,
    start: document.getElementById('start').value, end: document.getElementById('end').value,
    name: document.getElementById('name').value,
    on: [...document.querySelectorAll('.form [aria-pressed="true"]')].map(b => b.textContent),
  }));

  await page.click('text=Plan a trip');
  await page.fill('#where', 'Lisb');
  await page.waitForSelector('.results button');
  await redraws();
  assert.equal(await page.inputValue('#where'), 'Lisb', 'the place typed so far');
  assert.equal(await page.locator('.results button').count(), 2, 'and the places it found');
  await page.locator('.results button').first().click();
  await page.fill('#start', await day(page, 30));
  await page.fill('#end', await day(page, 33));
  await page.locator('.form .seg button', { hasText: 'Train' }).click();
  await page.locator('.form .chip', { hasText: / Work$/ }).click();
  await page.fill('#name', 'Conference');
  const planned = await form();
  assert.deepEqual(planned.on, ['🚆 Train', '💼 Work']);
  await page.evaluate(() => document.getElementById('name').setSelectionRange(4, 4));
  await redraws();
  assert.deepEqual(await form(), planned, 'Plan a trip keeps what was typed');
  const [leave, back] = [await page.locator('#start').boundingBox(), await page.locator('#end').boundingBox()];
  assert.equal(leave.y, back.y, 'Leave and Back line up');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart]), ['name', 4], 'and the cursor where it was');
  await page.click('text=Make my list');
  await page.waitForSelector('.pass h1');
  const id = await page.evaluate(() => location.hash.split('/')[2]);
  assert.equal(await page.locator('.pass h1').innerText(), 'CONFERENCE');

  // Edit: changes not saved yet stay through the same redraws, and Save keeps them.
  await page.goto(base + '#/edit/' + id);
  await page.fill('#name', 'Conference and a day off');
  await page.fill('#end', await day(page, 34));
  await page.locator('.form .chip', { hasText: / Work$/ }).click();
  const edited = await form();
  await redraws();
  assert.deepEqual(await form(), edited, 'Edit keeps unsaved changes');
  await page.click('text=Save');
  await page.waitForSelector('.pass h1');
  assert.equal(await page.locator('.pass h1').innerText(), 'CONFERENCE AND A DAY OFF');
  // Opened again, it shows what was saved, and a change made elsewhere shows up.
  await page.goto(base + '#/edit/' + id);
  assert.deepEqual(await form(), edited);
  await elsewhere(id => window.carryOn.store.apply(d => window.carryOn.M.putTrip(d, { id, end: window.carryOn.D.add(d.trips[id].end, 1) })), id);
  assert.equal(await page.inputValue('#end'), await day(page, 35), 'the other tab’s new date');
  assert.equal(await page.inputValue('#name'), 'Conference and a day off');
  // Deleted elsewhere while it's open here: it says so, and nothing here can bring it back.
  await page.fill('#name', 'Changed my mind');
  await elsewhere(id => window.carryOn.store.apply(d => window.carryOn.M.removeTrip(d, id)), id);
  assert.match(await page.locator('main h1').innerText(), /That trip isn’t here/i);
  assert.ok(await page.evaluate(id => window.carryOn.M.gone(window.carryOn.store.doc.trips[id]), id));

  // My list: half-typed into a bag's add box.
  await page.goto(base + '#/list');
  const box = page.getByPlaceholder('Add to Toiletries bag');
  await box.fill('Cotton sw');
  await redraws();
  assert.equal(await box.inputValue(), 'Cotton sw', 'the add box keeps its text');
  assert.equal(await page.evaluate(() => document.activeElement.placeholder), 'Add to Toiletries bag', 'and the cursor');

  // A save this tab missed (written here behind its back, as when a page comes back from the browser's memory)
  // isn't undone by its next change.
  const behind = bag => page.evaluate(bag => { const { M } = window.carryOn, d = M.cleanDoc(JSON.parse(localStorage.getItem('carry-on'))); localStorage.setItem('carry-on', M.canon(M.removeBag(d, bag))); }, bag);
  await behind('s-leave');
  await box.press('Enter');
  assert.deepEqual(await page.evaluate(() => { const { M } = window.carryOn, d = M.cleanDoc(JSON.parse(localStorage.getItem('carry-on'))); return [M.gone(d.bags['s-leave']), M.items(d).some(x => x.name === 'Cotton sw')]; }), [true, true]);
  assert.ok(!(await page.locator('.bag.edit h2').allInnerTexts()).includes('LEAVING THE HOUSE'));
  // Shown again from the browser's memory, it shows what was saved meanwhile.
  await behind('s-back');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  assert.ok(!(await page.locator('.bag.edit h2').allInnerTexts()).includes('LEAVING THE HOTEL'));
  await other.close();
  await ctx.close();
}

// ================= Quick taps while packing =================
// A tick lands where it was tapped, and the list moves only after a moment, keeping what's under the finger still.
{
  const { ctx, page } = await phone();
  await page.click('text=Start with a starter list');
  await planTrip(page, { where: 'Chic', from: 2, to: 4, by: 'Driving' });
  const bag = name => page.locator('.bag', { hasText: name });
  const top = async name => (await row(page, name).boundingBox())?.y;
  const tap = async name => { const b = await row(page, name).locator('.tick').boundingBox(); return page.touchscreen.tap(b.x + 40, b.y + b.height / 2); };
  const ticked = () => page.evaluate(() => { const { store } = window.carryOn; const t = Object.values(store.doc.trips)[0]; return Object.keys(t.marks || {}).filter(k => t.marks[k].v === 1).map(k => store.doc.items[k.slice(2)].name).sort(); });

  // With Hide done on, two quick taps down the list tick the two things tapped.
  await page.locator('.switch input').check();
  await row(page, 'Floss').evaluate(el => el.scrollIntoView({ block: 'center' }));
  const [floss, razor] = [await row(page, 'Floss').boundingBox(), await row(page, 'Razor').boundingBox()];
  await page.touchscreen.tap(floss.x + 40, floss.y + floss.height / 2);
  await wait(150);
  await page.touchscreen.tap(razor.x + 40, razor.y + razor.height / 2);
  assert.deepEqual(await ticked(), ['Floss', 'Razor'], 'the two things tapped');
  assert.equal(await row(page, 'Floss').count(), 1, 'still showing right after');
  await until(async () => !(await row(page, 'Razor').count()), 'Hide done to put them away');
  await page.locator('.switch input').uncheck();

  // The last thing in a bag: the tick shows where it was tapped, then the bag folds and the next one stays put.
  const docs = bag('Documents and money');
  for (const n of ['Wallet', 'ID', 'Credit cards']) await row(page, n).locator('.tick').click();
  await row(page, 'Health insurance card').evaluate(el => el.scrollIntoView({ block: 'center' }));
  const next = await top('Underwear');
  await tap('Health insurance card');
  assert.equal(await row(page, 'Health insurance card').locator('.tick').getAttribute('aria-checked'), 'true', 'ticked, and still there');
  assert.match(await docs.locator('.count').innerText(), /4\/4/);
  assert.equal(await top('Underwear'), next, 'nothing moved yet');
  await until(async () => /All 4 packed/.test(await docs.innerText()), 'the bag to fold', 3000);
  assert.ok(Math.abs((await top('Underwear')) - next) <= 2, `the next bag stayed put (${next} → ${await top('Underwear')})`);
  // Changing your mind in that moment: the bag waits for the last tap.
  for (const n of ['Toothbrush', 'Hairbrush or comb', 'Nail clippers', 'Lip balm', 'Prescriptions']) await row(page, n).locator('.tick').click();
  await row(page, 'Pain reliever').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await tap('Pain reliever');
  await wait(300);
  await tap('Pain reliever');
  await wait(800);
  await tap('Pain reliever');
  await wait(400);
  assert.equal(await row(page, 'Pain reliever').locator('.tick').getAttribute('aria-checked'), 'true');
  assert.doesNotMatch(await bag('Toiletries bag').innerText(), /All 8 packed/, 'still open after the first tap’s moment');
  await until(async () => /All 8 packed/.test(await bag('Toiletries bag').innerText()), 'the bag to fold');
  // From the keyboard, the bag's fold button takes the focus once it folds.
  for (const n of ['Phone charger', 'Headphones', 'Laptop and charger', 'Watch charger']) await row(page, n).locator('.tick').click();
  await row(page, 'Power bank').locator('.tick').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.activeElement.closest('li')?.textContent), 'Power bank');
  await until(async () => /All 5 packed/.test(await bag('Electronics').innerText()), 'the bag to fold');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /All 5 packed/, 'focus on the folded bag');
  // Everything packed: said once, when it happens.
  const toasts = () => page.evaluate(() => window.toasts);
  await page.evaluate(() => {
    window.toasts = [];
    const el = document.getElementById('toast');
    new MutationObserver(() => { if (!el.hidden) window.toasts.push(el.firstChild?.textContent); }).observe(el, { childList: true, attributes: true });
  });
  const allBut = (mode, name) => page.evaluate(([mode, name]) => {
    const { store, M, R, render } = window.carryOn, t = Object.values(store.doc.trips)[0];
    const keys = R.plan(store.doc, t, mode).groups.concat(R.plan(store.doc, t, mode).tasks).flatMap(g => g.rows).filter(r => r.name !== name).map(r => r.key);
    store.apply(d => M.markAll(d, t.id, keys, 1));
    render();
  }, [mode, name]);
  await allBut('go', 'Shoes');
  assert.deepEqual(await toasts(), []);
  await row(page, 'Shoes').locator('.tick').click();
  assert.deepEqual(await toasts(), ['Everything for Chicago is packed.']);
  assert.equal(await page.locator('.progress p.all').innerText(), 'All packed');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(1500);
  assert.deepEqual(await toasts(), ['Everything for Chicago is packed.'], 'just the once');
  await page.click('text=Coming home');
  await allBut('back', 'Shoes');
  await row(page, 'Shoes').locator('.tick').click();
  assert.deepEqual((await toasts()).slice(1), ['All back in the bags. Safe trip home.']);
  assert.match(await page.locator('.progress p.all').innerText(), /All back in the bags/);
  // Not when the trip opens already packed.
  await page.reload();
  await page.waitForSelector('.pass h1');
  await wait(300);
  assert.equal(await page.locator('#toast').isHidden(), true);
  await ctx.close();
}

// ================= Two phones, one Google Drive =================
{
  const g = fakeGoogle();
  const a = await phone({ google: g }), b = await phone({ google: g });
  await a.page.click('text=Start with a starter list');
  await planTrip(a.page, { where: 'Chic', from: 2, to: 4, by: 'Driving' });
  await row(a.page, 'Belt').locator('.tick').click();
  await a.page.goto(base + '#/settings');
  await a.page.click('text=Save to Google Drive');
  await until(async () => g.files().some(f => f.appProperties?.carryon === 'sync' && f.body), 'the file in Drive');
  assert.ok(g.files().some(f => f.name === 'Carry On' && f.appProperties?.carryon === 'folder'));

  // The second phone brings the list from Drive.
  await b.page.click('text=Bring my list from Google Drive');
  await b.page.click('text=Save to Google Drive');
  await until(() => b.page.evaluate(() => Object.keys(window.carryOn.store.doc.trips).length === 1), 'the trip on the second phone');
  await b.page.goto(base + '#/');
  await b.page.click('.tag-card');
  assert.equal(await row(b.page, 'Belt').locator('.tick').getAttribute('aria-checked'), 'true', 'the tick came along');
  assert.ok(!(await rowsText(b.page)).includes('Eye mask and earplugs'), 'driving, so no eye mask');
  await row(b.page, 'Shoes').locator('.tick').click();
  await until(() => b.page.evaluate(() => document.getElementById('cloud').dataset.s === 'ok'), 'the second phone to sync');
  await wait(1500);
  // Meanwhile the first phone ticked something else.
  await a.page.goto(base + '#/trip/' + await a.page.evaluate(() => Object.keys(window.carryOn.store.doc.trips)[0]));
  await row(a.page, 'Wallet').locator('.tick').click();
  await wait(1500);
  await a.page.click('#cloud');
  await until(async () => (await row(a.page, 'Shoes').locator('.tick').getAttribute('aria-checked')) === 'true', 'the second phone’s tick on the first');
  await b.page.click('#cloud');
  await until(async () => (await row(b.page, 'Wallet').locator('.tick').getAttribute('aria-checked')) === 'true', 'the first phone’s tick on the second');
  assert.equal(g.files().filter(f => f.appProperties?.carryon === 'sync').length, 1, 'one file');

  // One phone deletes Leaving the house. The other, before it has synced, moves Leaving the hotel up. It stays deleted.
  const inDrive = () => JSON.parse(g.files().find(f => f.appProperties?.carryon === 'sync').body);
  const synced = p => until(() => p.evaluate(() => document.getElementById('cloud').dataset.s === 'ok'), 'the sync');
  const headings = p => p.locator('.bag.edit h2').allInnerTexts();
  await a.page.goto(base + '#/list');
  await a.page.click('[aria-label="Change Leaving the house"]');
  await a.page.click('.sheet .btn.danger-quiet');
  assert.equal(await a.page.locator('.sheet .btn.danger-quiet').innerText(), 'Delete it and its 4 jobs?');
  await a.page.click('.sheet .btn.danger-quiet');
  await until(() => inDrive().bags['s-leave'].del, 'the deletion in Drive');
  await b.page.goto(base + '#/list');
  await b.page.click('[aria-label="Change Leaving the hotel"]');
  await b.page.click('.sheet [aria-label="Move up"]');
  await closeSheet(b.page);
  await wait(1500);
  await b.page.click('#cloud');
  await synced(b.page);
  await a.page.click('#cloud');
  await synced(a.page);
  for (const p of [a.page, b.page]) {
    await p.evaluate(() => window.carryOn.render());
    assert.ok(!(await headings(p)).includes('LEAVING THE HOUSE'), 'Leaving the house stays deleted');
    assert.ok((await headings(p)).includes('LEAVING THE HOTEL'));
  }

  // Every bag deleted and synced, then a fresh start from the starter list: the next sync keeps it.
  await a.page.evaluate(() => { const { store, M, render } = window.carryOn; for (const b of M.bags(store.doc)) store.apply(d => M.removeBag(d, b.id)); render(); });
  await until(() => !Object.values(inDrive().bags).some(x => !x.del), 'the deletions in Drive');
  await a.page.goto(base + '#/');
  await a.page.click('text=Start with a starter list');
  await wait(1500);
  await synced(a.page);
  await a.page.click('#cloud');
  await synced(a.page);
  const bagCount = p => p.evaluate(() => window.carryOn.M.bags(window.carryOn.store.doc).length);
  assert.equal(await bagCount(a.page), 9, 'the starter list stays after syncing');
  await b.page.click('#cloud');
  await until(async () => (await bagCount(b.page)) === 9, 'the starter list on the other phone');
  await a.ctx.close(); await b.ctx.close();
}

assert.deepEqual(problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
