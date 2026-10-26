// Small page helpers: making elements, the toast, and the bottom sheet.

// h('button', { class: 'btn', onclick: f }, 'Text', child, [more], null)
export function h(tag, props, ...kids) {
  const el = tag === 'svg' || tag === 'path' || tag === 'circle' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === '') continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const icon = (paths, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;
export const ICONS = {
  list: icon('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>'),
  gear: icon('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  more: icon('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
  edit: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  back: icon('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.4"'),
  refresh: icon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  up: icon('<path d="M6 15l6-6 6 6"/>', 'stroke-width="2.4"'),
  down: icon('<path d="M6 9l6 6 6-6"/>', 'stroke-width="2.4"'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="2.4"'),
};

// ---------- toast ----------
// It goes after a few seconds, or about eight with an Undo, but waits while the pointer is on it or it has the
// focus. A screen reader hears it from a live region that's on the page from the start (MDN, "ARIA live regions"),
// and the sheet's own while a sheet is open, since the rest of the page is hidden then; the words go in a moment
// after it's emptied, so they're heard as new.
let toastT = null, sayT = null, toastLeft = 0, toastEnd = 0, paused = false;
const lives = () => ['said', 'sheetSaid'].map(id => document.getElementById(id));
function hideToast() {
  document.getElementById('toast').hidden = true;
  for (const live of lives()) live.textContent = '';
}
function hideIn(ms) {
  clearTimeout(toastT);
  toastEnd = Date.now() + ms;
  if (!paused) toastT = setTimeout(hideToast, ms);
}
function pause(on) {
  if (on === paused || document.getElementById('toast').hidden) return;
  paused = on;
  if (on) { clearTimeout(toastT); toastLeft = toastEnd - Date.now(); } else hideIn(Math.max(toastLeft, 1500));
}
export function toast(msg, action) {
  const el = document.getElementById('toast');
  placeToast();
  el.replaceChildren(h('span', {}, msg));
  if (action) {
    const shown = Date.now();
    // Undo ignores taps for its first moment, so a second tap meant for the list can't land on it.
    el.append(h('button', { type: 'button', onclick: () => {
      if (Date.now() - shown < 400) return;
      paused = false;
      hideToast();
      action.run();
      // From the keyboard, back to the place on the page the focus was at last.
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected || el.contains(a)) byKey(document, place)?.focus({ preventScroll: true });
    } }, action.label));
  }
  el.hidden = false;
  paused = false;
  hideIn(action ? 8000 : 3000);
  const [page, inSheet] = lives(), live = document.getElementById('sheet').open ? inSheet : page;
  page.textContent = inSheet.textContent = '';
  clearTimeout(sayT);
  sayT = setTimeout(() => { live.textContent = msg; }, 50);
}

// An open sheet covers the rest of the page, so the toast goes inside it while it's open, and Undo stays in reach.
function placeToast() {
  const el = document.getElementById('toast'), dlg = document.getElementById('sheet');
  if (dlg.open && el.parentNode !== dlg) dlg.append(el);
  else if (!dlg.open && el.parentNode === dlg) dlg.before(el);
}

// ---------- where the focus goes back to ----------
// The page and an open sheet are drawn afresh after most taps, so each control that lasts through that has a
// data-key, and the focus goes back to the new one with the same key. Safari doesn't focus a button that's clicked
// (MDN, <button>, "Clicking and focus"), so the control with a key clicked last is kept here too, until the focus or
// a key goes somewhere else. Not a text box: putting the focus in one would bring up a phone's keyboard.
export const tapped = { key: '', el: null };
// And the key of the last control on the page (not in a sheet) that had the focus or was tapped.
let place = '';
const forget = () => { tapped.key = ''; tapped.el = null; };
const onPage = el => el.dataset?.key && !el.closest('#sheet, #toast');
document.addEventListener('click', e => {
  const el = e.target.closest?.('[data-key]');
  if (el && !el.matches('input[type="text"], input[type="search"], textarea')) { tapped.key = el.dataset.key; tapped.el = el; } else forget();
  if (el && onPage(el)) place = el.dataset.key;
}, true);
document.addEventListener('keydown', forget, true);
document.addEventListener('focusin', e => {
  if (e.target !== tapped.el) forget();
  if (onPage(e.target)) place = e.target.dataset.key;
}, true);
// The key of the control that was pressed: the one clicked, or else the one with the focus, inside box.
export function pressedKey(box) {
  if (tapped.el && box.contains(tapped.el)) return tapped.key;
  const a = document.activeElement;
  return a && box.contains(a) ? a.dataset?.key || '' : '';
}
export const byKey = (box, key) => (key ? box.querySelector(`[data-key="${CSS.escape(key)}"]`) : null);

// ---------- bottom sheet ----------
// sheet('Title', body => [...nodes]) opens it; the body function gets a close() to call.
let onClose = null;
// The control the sheet was opened from, and on which screen. Closing the sheet puts the focus back on it, but the
// page is often drawn afresh while the sheet is open, and in Safari it never had the focus, so it's found by its key.
let opener = '', openedAt = '';
function backToOpener() {
  const dlg = document.getElementById('sheet');
  if (opener && !dlg.open && location.hash === openedAt && document.activeElement?.dataset?.key !== opener) byKey(document, opener)?.focus({ preventScroll: true });
}
export function sheet(title, build, { wide = false, done } = {}) {
  const dlg = document.getElementById('sheet');
  const body = dlg.querySelector('.sheet-body');
  const close = () => { if (dlg.open) { dlg.close(); backToOpener(); } };
  // Drawn again while open, after a tap inside it: the focus stays on what was tapped.
  const again = dlg.open ? pressedKey(dlg) : '';
  if (!dlg.open) { opener = pressedKey(document.body); openedAt = location.hash; }
  onClose = done || null;
  dlg.classList.toggle('wide', wide);
  body.replaceChildren(
    h('div', { class: 'sheet-top' },
      h('h2', { id: 'sheetTitle' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: ICONS.close, onclick: close })),
    ...[build(close)].flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
  // A sheet opens at its top. The sheet keeps where the last one was scrolled to, and with its title row staying
  // in view, putting the focus on the close button no longer scrolls back up.
  if (!dlg.open) { dlg.showModal(); dlg.scrollTop = 0; }
  placeToast();
  const same = byKey(body, again), first = body.querySelector('[autofocus]');
  if (same) same.focus({ preventScroll: true }); else if (first) first.focus();
  return close;
}
export function closeSheet() { const dlg = document.getElementById('sheet'); if (dlg.open) dlg.close(); }

export function setupSheet() {
  const dlg = document.getElementById('sheet'), t = document.getElementById('toast');
  t.addEventListener('pointerenter', () => pause(true));
  t.addEventListener('pointerleave', () => pause(false));
  t.addEventListener('focusin', () => pause(true));
  t.addEventListener('focusout', () => pause(false));
  // A tap on the dimmed page around the sheet closes it.
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { placeToast(); backToOpener(); const f = onClose; onClose = null; if (f) f(); });
  // Enter in a text box inside a sheet presses its main button rather than closing it.
  dlg.addEventListener('submit', e => { e.preventDefault(); dlg.querySelector('.sheet-body .btn.primary:not([disabled])')?.click(); });
  // A sheet with more than one text box and no submit button isn't submitted by Enter at all (HTML Living Standard,
  // 4.10.21.2 Implicit submission), so Enter in a one-line box presses the main button here instead.
  dlg.addEventListener('keydown', e => {
    const t = e.target;
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    if (!(t instanceof HTMLInputElement) || (t.type !== 'text' && t.type !== 'search')) return;
    e.preventDefault();
    dlg.querySelector('.sheet-body .btn.primary:not([disabled])')?.click();
  });
}

// A button that asks for a second tap before doing something it can't undo.
export function confirmBtn(label, again, run, cls = 'btn danger') {
  let armed = false, t = null;
  const b = h('button', { type: 'button', class: cls, onclick: () => {
    if (!armed) { armed = true; b.textContent = again; clearTimeout(t); t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    clearTimeout(t); run();
  } }, label);
  return b;
}
