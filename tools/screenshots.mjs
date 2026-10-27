// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The weather is the test stand-in (test/fixture.mjs) and the clock is fixed, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMeteo } from '../test/fixture.mjs';

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
const NOW = new Date('2026-10-26T09:00:00');
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// As a phone, whose scrollbar takes no room, with less motion asked for, so a sheet or a meter is never caught
// partway.
async function open(viewport, deviceScaleFactor, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme, reducedMotion: 'reduce' });
  await ctx.clock.setSystemTime(NOW);
  await openMeteo(ctx);
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
// The fixed clock holds timers still, so the toast is put away by hand.
const settle = page => page.evaluate(() => new Promise(r => { const t = document.getElementById('toast'); if (t) t.hidden = true; requestAnimationFrame(() => requestAnimationFrame(r)); }));

// A trip to Lisbon, partly packed, with another trip coming up.
async function setUp(page) {
  await page.click('text=Start with a starter list');
  const plan = async (where, from, to, chips = []) => {
    await page.goto(base + '#/new');
    await page.fill('#where', where);
    await page.locator('.results button').first().click();
    await page.fill('#start', from); await page.fill('#end', to);
    for (const c of chips) await page.locator('.form .chip', { hasText: new RegExp(` ${c}$`) }).click();
    await page.click('text=Make my list');
    await page.waitForSelector('.wx-days:not(.wait) li');
  };
  await plan('Reyk', '2026-12-11', '2026-12-14');
  await plan('Lisb', '2026-10-29', '2026-11-02', ['Work']);
  for (const n of ['Toothpaste', 'Shampoo and conditioner', 'Deodorant', 'Phone charger', 'Headphones', 'Wallet', 'ID']) {
    await page.locator('.row', { has: page.locator('.name', { hasText: new RegExp(`^${n}$`) }) }).locator('.tick').click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await setUp(page);
  await settle(page);
  await page.screenshot({ path: join(root, 'docs/phone-trip.png') });
  await page.locator('.bag', { hasText: 'Electronics' }).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 120));
  await settle(page);
  await page.screenshot({ path: join(root, 'docs/phone-bags.png') });
  await page.goto(base + '#/');
  await settle(page);
  await page.screenshot({ path: join(root, 'docs/phone-trips.png') });
  await page.goto(base + '#/list');
  await settle(page);
  await page.locator('.edit-row', { hasText: 'Sunscreen' }).click();
  await settle(page);
  await page.screenshot({ path: join(root, 'docs/phone-item.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: a card, with the name and one line on the left, and the real trip screen on the right.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await setUp(page);
  await settle(page);
  const shot = (await page.screenshot({ clip: { x: 0, y: 60, width: 390, height: 780 } })).toString('base64');
  await page.context().close();
  const font = async f => (await readFile(join(root, 'fonts', f))).toString('base64');
  const icon = (await readFile(join(root, 'icon.svg'))).toString('base64');
  const card = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await card.setContent(`<style>
    @font-face { font-family: B; src: url(data:font/woff2;base64,${await font('barlow-condensed-700.woff2')}); }
    @font-face { font-family: F; src: url(data:font/woff2;base64,${await font('figtree.woff2')}); font-weight: 400 700; }
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f2ede4; font-family: F; color: #1c2230; position: relative; }
    .tag { position: absolute; left: 70px; top: 120px; width: 600px; height: 390px; background: #f1deb7; border-radius: 10px 22px 22px 10px;
      clip-path: polygon(46px 0, 100% 0, 100% 100%, 46px 100%, 0 calc(100% - 46px), 0 46px); }
    .tag::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 74px; border-right: 3px dashed #d8bf8c; }
    .hole { position: absolute; left: 24px; top: 50%; width: 26px; height: 26px; margin-top: -13px; border-radius: 50%; background: #f2ede4; box-shadow: inset 0 0 0 5px #d8bf8c; }
    .text { position: absolute; left: 112px; top: 54px; right: 40px; }
    .icon { width: 64px; height: 64px; }
    h1 { font: 700 118px/0.9 B; text-transform: uppercase; margin: 18px 0 18px; letter-spacing: .01em; color: #3b2c12; }
    p { font-size: 30px; line-height: 1.3; margin: 0; color: #3b2c12; font-weight: 500; text-wrap: balance; }
    .phone { position: absolute; right: 70px; top: 46px; width: 390px; height: 780px; border-radius: 34px; overflow: hidden; transform: rotate(3deg); transform-origin: top left;
      box-shadow: 0 30px 60px rgba(28, 34, 48, .25), 0 0 0 10px #1c2230; }
    .phone img { width: 390px; display: block; }
  </style>
  <div class="tag"><span class="hole"></span><div class="text"><img class="icon" src="data:image/svg+xml;base64,${icon}"><h1>Carry On</h1><p>A packing list, by bag, that checks the forecast and the place.</p></div></div>
  <div class="phone"><img src="data:image/png;base64,${shot}"></div>`);
  await card.evaluate(() => document.fonts.ready);
  await settle(card);
  await card.screenshot({ path: join(root, 'og.png') });
  await card.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
