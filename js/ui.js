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
let toastT = null;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastT);
  el.replaceChildren(h('span', {}, msg));
  if (action) {
    const shown = Date.now();
    // Undo ignores taps for its first moment, so a second tap meant for the list can't land on it.
    el.append(h('button', { type: 'button', onclick: () => { if (Date.now() - shown < 400) return; el.hidden = true; action.run(); } }, action.label));
  }
  el.hidden = false;
  toastT = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3000);
}

// ---------- bottom sheet ----------
// sheet('Title', body => [...nodes]) opens it; the body function gets a close() to call.
let onClose = null;
export function sheet(title, build, { wide = false, done } = {}) {
  const dlg = document.getElementById('sheet');
  const body = dlg.querySelector('.sheet-body');
  const close = () => { if (dlg.open) dlg.close(); };
  onClose = done || null;
  dlg.classList.toggle('wide', wide);
  body.replaceChildren(
    h('div', { class: 'sheet-top' },
      h('h2', { id: 'sheetTitle' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: ICONS.close, onclick: close })),
    ...[build(close)].flat());
  if (!dlg.open) dlg.showModal();
  const first = body.querySelector('[autofocus]');
  if (first) first.focus();
  return close;
}
export function closeSheet() { const dlg = document.getElementById('sheet'); if (dlg.open) dlg.close(); }

export function setupSheet() {
  const dlg = document.getElementById('sheet');
  // A tap on the dimmed page around the sheet closes it.
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { const f = onClose; onClose = null; if (f) f(); });
  // Enter in a text box inside a sheet presses its main button rather than closing it.
  dlg.addEventListener('submit', e => { e.preventDefault(); dlg.querySelector('.sheet-body .btn.primary:not([disabled])')?.click(); });
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
