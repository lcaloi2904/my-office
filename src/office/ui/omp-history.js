// OMP history picker (files mode, this computer only): the catalogue of persisted sessions found in the approved
// folders. Pinning one adds it to the office as a persisted-only actor; history is never presumed to be running.
import { $, el } from '../core/env.js';
import { state } from '../core/state.js';
import { TOKEN } from '../net/live.js';
import { toast } from './activity.js';
import { t as tr, locale } from '../../i18n/index.js';

const q = (sep) => (TOKEN ? `${sep}k=${encodeURIComponent(TOKEN)}` : '');
export const ompOffered = () => !!(state.omp?.on && state.omp.local);
let dlg = null, items = [], next = null, loading = false;

const SOURCE_STATE = () => ({ absent: tr('activity.omp.sourceAbsent'), denied: tr('activity.omp.sourceDenied'), changed: tr('activity.omp.sourceChanged'), degraded: tr('activity.omp.sourceDegraded'), pending: tr('activity.omp.sourceDegraded') });
const PIN_ERRORS = () => ({ 'pin-limit': tr('activity.omp.errLimit'), conflict: tr('activity.omp.errConflict'), 'unknown-session': tr('activity.omp.errUnknown') });
const when = (ms) => { try { return new Date(ms).toLocaleString(locale()); } catch { return ''; } };
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Pin or unpin by the catalogue's public id. -> true when the server accepted it */
export async function setOmpPin(id, on) {
  try {
    const r = await fetch(`/api/omp/pin${q('?')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, on }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { toast(PIN_ERRORS()[d.code] || tr('activity.omp.errOther')); return false; }
    return true;
  } catch { toast(tr('activity.omp.errOther')); return false; }
}

let hiddenRevision = 0;
const HIDE_ERRORS = () => ({ conflict: tr('activity.omp.errHideConflict'), limit: tr('activity.omp.errHideLimit'), 'unknown-session': tr('activity.omp.errUnknown'), 'store-corrupt': tr('activity.omp.errHideCorrupt') });

/** Hide or show an OMP session in the office (the process, telemetry and files are untouched). -> true when applied */
export async function setOmpHidden(id, hidden) {
  const post = async () => {
    const r = await fetch(`/api/omp/visibility${q('?')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, hidden, expectedRevision: hiddenRevision }) });
    return { r, d: await r.json().catch(() => ({})) };
  };
  try {
    let { r, d } = await post();
    if (r.status === 409 && Number.isSafeInteger(d.revision)) { hiddenRevision = d.revision; ({ r, d } = await post()); }   // another tab changed the list: retry once on the current revision
    if (!r.ok || !d.ok) { toast(HIDE_ERRORS()[d.code] || tr('activity.omp.errOther')); return false; }
    hiddenRevision = d.revision;
    toast(tr(hidden ? 'activity.omp.hidden' : 'activity.omp.shown'));
    if (dlg?.open) loadHidden();
    return true;
  } catch { toast(tr('activity.omp.errOther')); return false; }
}

async function loadHidden() {
  const box = $('omp-hidden-list'); if (!box) return;
  try {
    const r = await fetch(`/api/omp/visibility${q('?')}`);
    if (!r.ok) throw new Error('visibility');
    const d = await r.json();
    hiddenRevision = d.revision;
    const rows = d.items.map((x) => {
      const li = el('li', 'omp-row'), b = el('button', 'btn btn--sm', tr('activity.omp.show')); b.type = 'button';
      b.addEventListener('click', async () => { b.disabled = true; if (!(await setOmpHidden(x.id, false))) b.disabled = false; });
      li.append(el('b', null, x.label || tr('activity.omp.unnamed')), el('small', null, `${x.live ? tr('activity.omp.hiddenLive') : tr('activity.omp.notLive')} · ${when(x.hiddenAt)}`), b);
      return li;
    });
    box.replaceChildren(...(rows.length ? rows : [el('li', 'lite-empty', tr('activity.omp.hiddenEmpty'))]));
  } catch { box.replaceChildren(el('li', 'lite-empty', tr('activity.omp.loadFailed'))); }
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
  if (loading) return;
  loading = true;
  const list = $('omp-list'), moreBtn = $('omp-more'), status = $('omp-status');
  try {
    const r = await fetch(`/api/omp/catalog?limit=25${more && next ? `&cursor=${encodeURIComponent(next)}` : ''}${q('&')}`);
    if (!r.ok) throw new Error('catalog');
    const d = await r.json();
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
  if (!ompOffered()) return;
  if (!dlg) {
    dlg = el('dialog', 'omp-dlg'); dlg.setAttribute('aria-labelledby', 'omp-title');
    const h = el('h2', null, tr('activity.omp.title')); h.id = 'omp-title';
    const note = el('p', 'pm-note', tr('activity.omp.note')), status = el('p', 'pm-note'); status.id = 'omp-status';
    const list = el('ul', 'omp-list'); list.id = 'omp-list';
    const hh = el('h3', null, tr('activity.omp.hiddenTitle')), hl = el('ul', 'omp-list'); hl.id = 'omp-hidden-list';
    const more = el('button', 'btn btn--sm', tr('activity.omp.loadMore')); more.type = 'button'; more.id = 'omp-more'; more.hidden = true;
    more.addEventListener('click', () => load(true));
    const close = el('button', 'btn btn--sm', tr('activity.omp.close')); close.type = 'button';
    close.addEventListener('click', () => dlg.close());
    dlg.append(h, note, status, list, more, hh, hl, close);
    document.body.append(dlg);
  }
  if (!dlg.open) dlg.showModal();
  load(false); loadHidden();
}

/** A button that opens the picker; hidden unless the server offers it. */
export function ompButton() {
  const b = el('button', 'btn btn--sm omp-open', tr('activity.omp.open')); b.type = 'button'; b.hidden = !ompOffered();
  b.addEventListener('click', openOmpHistory);
  return b;
}

let railBtn = null;
export function syncOmpEntry() {
  if (!railBtn) { const head = document.querySelector('.lp-head'); if (!head) return; railBtn = ompButton(); head.append(railBtn); }
  railBtn.hidden = !ompOffered();
}
export function setup() { syncOmpEntry(); }
