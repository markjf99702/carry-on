# Carry On

**Use it: [carry-on.junkdrawer.works](https://carry-on.junkdrawer.works/)**

**A packing list that knows the trip.** Keep everything you might pack in one list, sorted by the bag it goes in. Each trip gets its own fresh copy, matched to the forecast, where you're going and what you'll be doing, so there's nothing to uncheck afterwards. When it's time to come home, a second pass makes sure nothing stays behind at the hotel.

<p align="center">
  <img src="docs/phone-trips.png" alt="The trips screen: luggage tags for Lisbon in 3 days, 7 of 50 packed, and Reykjavík in 46 days, with the temperatures and rain for each" width="250">
  &nbsp;
  <img src="docs/phone-trip.png" alt="A trip to Lisbon: the dates and nights on a boarding pass, five days of forecast with rain on Friday, and what the trip calls for: flying, abroad, other plugs, hot, rain, strong sun and work" width="250">
  &nbsp;
  <img src="docs/phone-bags.png" alt="Packing the Electronics bag: phone charger and headphones ticked, and a plug adapter on the list because Portugal's sockets are type C and F at 230 volts" width="250">
</p>

## How it works

- **One list, by bag.** Your list is grouped the way you pack: the liquids bag, the toiletries bag, electronics, the backpack, the suitcase. There are also two lists of jobs, one for leaving the house and one for leaving the hotel. Move, rename and reorder anything in **My list**.
- **Every trip starts fresh.** Planning a trip makes a new copy of the list for it, so ticks belong to that trip. Old trips stay as they were, and **Go again** starts a new one from an old one.
- **It reads the forecast.** Up to 16 days out it uses the forecast. Further off, it uses what the same dates were like in each of the last three years, and it switches over as the trip gets closer. Hot, cool, cold, rain, snow and strong sun each bring their own things: an umbrella when rain is likely on a given day, a coat when the lows are near freezing.
- **It knows where you're going.** Abroad brings your passport. A plug adapter comes only where your plugs don't fit the sockets, with the socket types and voltage on the list (US plugs fit in Japan and Mexico, not in Portugal).
- **And what you'll be doing.** Pick occasions for a trip (work, working out, swimming, dressing up, outdoors, or your own), and things or whole bags come along only for them: the work bag on work trips, the swimsuit when you're swimming or it's hot.
- **Says why.** Anything that came along for a reason says so under its name ("Rain likely Fri", "Type C/F, 230 V"). **Left off this trip** lists everything that didn't, and why, with a button to pack it anyway. You can also turn any weather or place condition on or off by hand.
- **Counts by the day.** Socks and underwear come one for each day of the trip, up to a laundry limit you set.
- **Coming home.** Switch to **Coming home** and the list shows only what you packed, with its own ticks and the hotel checklist.
- **Bring your own list.** Paste a list from Google Keep, Notes or a document. Bags are the lines with things under them, and it makes a first guess at when each thing is needed (passport when abroad, swimsuit for swimming). A list can also go to someone else as a link; the list travels inside the link itself.
- **On every device, if you like.** Turn on Google Drive in Settings and the list, the trips and their ticks are kept in a "Carry On" folder in your own Drive, merged thing by thing, so two phones can pack the same trip. Without it, everything stays in this browser.
- No account and no server. It works offline once opened and installs to a phone's home screen.

Weather and place search come from [Open-Meteo](https://open-meteo.com/). Looking up a trip sends its place and dates there and nothing else. Plug types are from the IEC's list of world plugs. To stop Drive saving everywhere, remove junkdrawer.works under **Third-party apps & services** in your Google Account.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx serve .                   # or any static file server, then open the printed address
npm test                      # unit tests, then the whole app in Chromium (needs Playwright)
node tools/screenshots.mjs    # redraws docs/*.png and og.png
node tools/make-icons.mjs     # redraws the PNG icons from icon.svg
npm install && npm run build  # dist/carry-on.html, the whole app in one file
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick `main` and `/ (root)`. The `CNAME` file serves it at carry-on.junkdrawer.works.

### Files

- `js/model.js`: the list and trips, and how two copies merge (bag by bag, thing by thing, tick by tick).
- `js/rules.js`: what a trip calls for, and so what goes on its list.
- `js/weather.js`: place search, the forecast, typical weather, and what counts as hot, cold or rainy.
- `js/plugs.js`: plug types and voltage by country, and which plugs fit which sockets.
- `js/share.js`: list links, pasted lists, and the first guesses at when things are needed.
- `js/starter.js`: the list someone starts with.
- `js/store.js`, `js/sync.js`: saving in the browser, and to Google Drive.
- `js/app.js`, `js/ui.js`, `css/app.css`: the page.
- `fonts/`: Barlow Condensed and Figtree (SIL Open Font License), served from here so nothing loads from elsewhere.
- `sw.js`: keeps a copy for using offline.
- `test/`: unit tests, the browser test, and stand-ins for Open-Meteo and Google Drive.
