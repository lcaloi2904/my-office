// OMP history picker (files mode, this computer only): the catalogue of persisted sessions found in the approved
// folders. Pinning one adds it to the office as a persisted-only actor; history is never presumed to be running.
import { $, el, replay } from '../core/env.js';
import { state } from '../core/state.js';
import { TOKEN } from '../net/live.js';
import { toast } from './activity.js';
import { t as tr, locale } from '../../i18n/index.js';
import { sessions, unknownLabel } from '../people/workers.js';

const q = (sep) => (TOKEN ? `${sep}k=${encodeURIComponent(TOKEN)}` : '');
export const ompOffered = () => !!(state.omp?.on && state.omp.local);
let dlg = null, items = [], next = null, loading = false;

const SOURCE_STATE = () => ({ absent: tr('activity.omp.sourceAbsent'), denied: tr('activity.omp.sourceDenied'), changed: tr('activity.omp.sourceChanged'), degraded: tr('activity.omp.sourceDegraded'), pending: tr('activity.omp.sourceDegraded') });
const PIN_ERRORS = () => ({ 'pin-limit': tr('activity.omp.errLimit'), conflict: tr('activity.omp.errConflict'), 'unknown-session': tr('activity.omp.errUnknown') });
const when = (ms) => { if (!Number.isFinite(ms) || ms <= 0) return '–'; try { return new Date(ms).toLocaleString(locale()); } catch { return '–'; } };
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Pin or unpin by the catalogue's public id. -> true when the server accepted it */
export async function setOmpPin(id, on) {
  if (!canChange() || !publicId(id) || typeof on !== 'boolean') return false;
  try {
    const r = await fetch(`/api/omp/pin${q('?')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, on }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { toast(PIN_ERRORS()[d.code] || tr('activity.omp.errOther')); return false; }
    return true;
  } catch { toast(tr('activity.omp.errOther')); return false; }
}

let hiddenRevision = 0;
const HIDE_ERRORS = () => ({ conflict: tr('activity.omp.errHideConflict'), limit: tr('activity.omp.errHideLimit'), 'unknown-session': tr('activity.omp.errUnknown'), 'store-corrupt': tr('activity.omp.errHideCorrupt') });
const publicId = (id) => typeof id === 'string' && /^omp:[0-9a-f]{64}$/.test(id);
const canChange = () => !replay.on && ompOffered();
let undoId = null, undoBox = null, undoButton = null, actionsDialog = null;

function offerUndo(id) {
  undoId = id;
  if (!undoBox) {
    undoBox = el('section', 'omp-undo'); undoBox.setAttribute('aria-label', tr('activity.omp.undo'));
    const message = el('span', null, tr('activity.omp.hidden')); message.setAttribute('role', 'status');
    undoButton = el('button', 'btn btn--sm'); undoButton.type = 'button'; undoButton.dataset.ompAction = 'undo';
    undoButton.addEventListener('click', async () => {
      if (!canChange() || !undoId) return;
      undoButton.disabled = true;
      await setOmpHidden(undoId, false);
      undoButton.disabled = false;
    });
    undoBox.append(message, undoButton); document.body.append(undoBox);
  }
  undoButton.textContent = tr('activity.omp.undo'); undoBox.hidden = false;
  if (!document.querySelector('dialog[open]')) undoButton.focus({ preventScroll: true });
}

async function readVisibility(id) {
  const r = await fetch(`/api/omp/visibility${id ? `?id=${encodeURIComponent(id)}${q('&')}` : q('?')}`, { cache: 'no-store' });
  const d = await r.json();
  if (!r.ok || !d.ok || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.items) || d.items.some((x) => !publicId(x.id))) throw new Error('visibility');
  hiddenRevision = Math.max(hiddenRevision, d.revision);
  return d;
}

function evidenceText(s) {
  if (!s) return tr('activity.omp.noCurrent');
  return [unknownLabel({ ...s, agentKind: 'omp' }), tr('activity.omp.lastSeen', { time: when(s.lastAt) }),
    tr('activity.omp.identity', { id: s.id }), s.worktreeKey ? tr('activity.omp.worktree', { key: s.worktreeKey }) : ''].filter(Boolean).join(' · ');
}

/** Presentation actions only. Every handler rechecks replay before touching the server. */
export function appendOmpActions(box, s) {
  const note = el('p', 'dr-note omp-evidence', evidenceText(s)); note.setAttribute('role', 'status');
  box.append(note, el('p', 'dr-note', tr('activity.omp.ownerWarning')));
  const add = (action, text, handler) => {
    const b = el('button', 'btn btn--sm', tr(text)); b.type = 'button'; b.dataset.ompAction = action;
    b.disabled = !canChange(); if (b.disabled) b.title = tr('drawer.readOnly');
    b.addEventListener('click', async () => {
      if (!canChange()) return;
      b.disabled = true;
      try { await handler(); } catch { toast(tr('activity.omp.errVisibility')); }
      finally { b.disabled = !canChange(); }
    });
    box.append(b); return b;
  };
  const hide = add('hide', 'activity.omp.hide', async () => {
    if (actionsDialog?.open) actionsDialog.close();
    await setOmpHidden(s.id, true);
  });
  hide.title = tr('activity.omp.hideTitle');
  if (s.persistedOnly === true) add('unpin', 'activity.omp.unpin', async () => {
    if (await setOmpPin(s.id, false)) actionsDialog?.close();
  });
  add('history', 'activity.omp.open', () => { actionsDialog?.close(); openOmpHistory(); });
  const refresh = add('refresh', 'activity.omp.refresh', async () => {
    const d = await readVisibility(s.id);
    if (!canChange() || !note.isConnected) return;
    note.textContent = evidenceText(d.current);
  });
  refresh.title = tr('activity.omp.refreshNote');
}

/** The compact rail/list entry opens the same native dialog convention as the history picker. */
export function ompActionsButton(id) {
  const b = el('button', 'omp-actions-open', '⋯'); b.type = 'button'; b.dataset.ompActions = id;
  b.setAttribute('aria-label', tr('activity.omp.actions')); b.setAttribute('aria-haspopup', 'dialog'); b.hidden = !canChange();
  b.addEventListener('click', (event) => {
    event.stopPropagation();
    const s = sessions.get(id); if (!canChange() || !s || s.agentKind !== 'omp') return;
    if (!actionsDialog) {
      actionsDialog = el('dialog', 'omp-dlg omp-actions-dlg'); actionsDialog.setAttribute('aria-labelledby', 'omp-actions-title');
      document.body.append(actionsDialog);
    }
    const title = el('h2', null, s.name || tr('activity.omp.unnamed')); title.id = 'omp-actions-title';
    const content = el('div', 'omp-actions-content');
    appendOmpActions(content, s);
    const close = el('button', 'btn btn--sm', tr('activity.omp.close')); close.type = 'button'; close.addEventListener('click', () => actionsDialog.close());
    actionsDialog.replaceChildren(title, content, close); actionsDialog.showModal();
  });
  return b;
}

/** Hide or show an OMP session in the office (the process, telemetry and files are untouched). -> true when applied */
export async function setOmpHidden(id, hidden) {
  if (!canChange() || !publicId(id) || typeof hidden !== 'boolean') return false;
  const post = async () => {
    const r = await fetch(`/api/omp/visibility${q('?')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, hidden, expectedRevision: hiddenRevision }) });
    return { r, d: await r.json().catch(() => ({})) };
  };
  try {
    let { r, d } = await post();
    if (r.status === 409 && Number.isSafeInteger(d.revision) && canChange()) { hiddenRevision = Math.max(hiddenRevision, d.revision); ({ r, d } = await post()); } // retry this explicit intent once, never replay it
    if (!r.ok || !d.ok || !Number.isSafeInteger(d.revision)) { toast(HIDE_ERRORS()[d.code] || tr('activity.omp.errVisibility')); return false; }
    hiddenRevision = Math.max(hiddenRevision, d.revision);
    if (replay.on) return true;
    toast(tr(hidden ? 'activity.omp.hidden' : d.available === false ? 'activity.omp.restoredAbsent' : 'activity.omp.shown'));
    if (hidden) offerUndo(id);
    else if (undoId === id) { undoId = null; if (undoBox) undoBox.hidden = true; }
    if (dlg?.open) await loadHidden();
    return true;
  } catch { toast(tr('activity.omp.errVisibility')); return false; }
}

let hiddenRequest = 0;
async function loadHidden() {
  const box = $('omp-hidden-list'); if (!box || !canChange()) return;
  const request = ++hiddenRequest, scroll = dlg?.scrollTop || 0;
  const focused = box.contains(document.activeElement), focusedId = document.activeElement?.dataset?.ompId;
  try {
    const d = await readVisibility();
    if (request !== hiddenRequest || !canChange() || !dlg?.open) return;
    const rows = d.items.map((x) => {
      const li = el('li', 'omp-row'), b = el('button', 'btn btn--sm', tr('activity.omp.show')); b.type = 'button'; b.dataset.ompId = x.id;
      b.setAttribute('aria-label', tr('activity.omp.showNamed', { name: x.label || tr('activity.omp.unnamed'), id: x.id }));
      b.addEventListener('click', async () => { b.disabled = true; if (!(await setOmpHidden(x.id, false))) b.disabled = false; });
      li.dataset.ompId = x.id;
      const meta = [evidenceText(x.current), !x.current ? tr('activity.omp.identity', { id: x.id }) : '', tr('activity.omp.hiddenAt', { time: when(x.hiddenAt) })].filter(Boolean).join(' · ');
      li.append(el('b', null, x.label || tr('activity.omp.unnamed')), el('small', null, meta), b);
      return li;
    });
    box.replaceChildren(...(rows.length ? rows : [el('li', 'lite-empty', tr('activity.omp.hiddenEmpty'))]));
    if (d.corrupt) box.prepend(el('li', 'dr-note', tr('activity.omp.errHideCorrupt')));
    if (focused) {
      const buttons = [...box.querySelectorAll('button')];
      (buttons.find((b) => b.dataset.ompId === focusedId) || buttons[0] || $('omp-refresh')).focus({ preventScroll: true });
    }
    dlg.scrollTop = scroll;
  } catch { if (request === hiddenRequest && canChange()) box.replaceChildren(el('li', 'lite-empty', tr('activity.omp.loadFailed'))); }
}

function row(item) {
  const li = el('li', 'omp-row'); li.dataset.ompId = item.id || '';
  const head = el('div', 'omp-head');
  head.append(el('b', null, item.project || tr('activity.omp.unnamed')), el('span', 'ri-proj', item.label === 'recent' ? tr('activity.omp.recent') : tr('activity.omp.history')), el('span', 'ri-proj', tr('activity.omp.notLive')));
  const meta = [when(item.modifiedAt), size(item.sizeBytes), item.children ? tr('activity.omp.children', { n: item.children }) : ''].filter(Boolean).join(' · ');
  const btn = el('button', 'btn btn--sm'); btn.type = 'button';
  if (!item.id || !item.supported || item.conflict) {
    btn.disabled = true; btn.textContent = tr('activity.omp.pin');
    li.append(head, el('small', null, `${meta} · ${item.conflict ? tr('activity.omp.errConflict') : item.pending ? tr('activity.omp.headerPending') : tr('activity.omp.unsupported')}`), btn);
    return li;
  }
  const paint = () => { btn.textContent = item.pinned ? tr('activity.omp.unpin') : tr('activity.omp.pin'); btn.setAttribute('aria-pressed', String(!!item.pinned)); };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (await setOmpPin(item.id, !item.pinned)) item.pinned = !item.pinned;
    btn.disabled = false; paint();
  });
  paint();
  li.append(head, el('small', null, meta), btn);
  return li;
}

async function load(more) {
  if (loading || !canChange()) return;
  loading = true;
  const list = $('omp-list'), moreBtn = $('omp-more'), status = $('omp-status');
  try {
    const r = await fetch(`/api/omp/catalog?limit=25${more && next ? `&cursor=${encodeURIComponent(next)}` : ''}${q('&')}`);
    if (!r.ok) throw new Error('catalog');
    const d = await r.json();
    if (!canChange() || !dlg?.open) return;
    if (!more) items = [];
    items.push(...d.items); next = d.next;
    const states = SOURCE_STATE(), notes = d.sources.filter((s) => states[s.state] || s.truncated).map((s) => `${s.id}: ${states[s.state] || tr('activity.omp.truncated')}`);
    status.textContent = notes.join(' · ');
    list.replaceChildren(...(items.length ? items.map(row) : [el('li', 'lite-empty', tr('activity.omp.empty'))]));
    moreBtn.hidden = !next;
  } catch {
    if (!more) list.replaceChildren(el('li', 'lite-empty', tr('activity.omp.loadFailed')));
  } finally { loading = false; }
}

export function openOmpHistory() {
  if (!canChange()) return;
  if (!dlg) {
    dlg = el('dialog', 'omp-dlg'); dlg.setAttribute('aria-labelledby', 'omp-title');
    const h = el('h2', null, tr('activity.omp.title')); h.id = 'omp-title';
    const note = el('p', 'pm-note', tr('activity.omp.note')), status = el('p', 'pm-note'); status.id = 'omp-status';
    const refresh = el('button', 'btn btn--sm', tr('activity.omp.refresh')); refresh.type = 'button'; refresh.id = 'omp-refresh'; refresh.title = tr('activity.omp.refreshNote');
    refresh.addEventListener('click', async () => { if (!canChange()) return; refresh.disabled = true; await Promise.all([load(false), loadHidden()]); refresh.disabled = false; });
    const list = el('ul', 'omp-list'); list.id = 'omp-list';
    const hh = el('h3', null, tr('activity.omp.hiddenTitle')), hl = el('ul', 'omp-list'); hl.id = 'omp-hidden-list';
    const more = el('button', 'btn btn--sm', tr('activity.omp.loadMore')); more.type = 'button'; more.id = 'omp-more'; more.hidden = true;
    more.addEventListener('click', () => load(true));
    const close = el('button', 'btn btn--sm', tr('activity.omp.close')); close.type = 'button';
    close.addEventListener('click', () => dlg.close());
    dlg.append(h, note, status, refresh, list, more, hh, hl, close);
    document.body.append(dlg);
  }
  if (!dlg.open) dlg.showModal();
  load(false); loadHidden();
}

/** A button that opens the picker; hidden unless the server offers it. */
export function ompButton() {
  const b = el('button', 'btn btn--sm omp-open', tr('activity.omp.open')); b.type = 'button'; b.hidden = !canChange();
  b.addEventListener('click', openOmpHistory);
  return b;
}

let railBtn = null;
export function syncOmpEntry() {
  if (!railBtn) { const head = document.querySelector('.lp-head'); if (!head) return; railBtn = ompButton(); head.append(railBtn); }
  railBtn.hidden = !canChange();
  if (replay.on) { dlg?.close(); actionsDialog?.close(); if (undoBox) undoBox.hidden = true; }
}
export function setup() { syncOmpEntry(); }
