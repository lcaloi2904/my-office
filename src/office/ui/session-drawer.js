// The session drawer: chat, steps, subagents.
import { state } from '../core/state.js';
import { $, el, fmtBytes, fmtClock, hhmm, nowMs, pad2, reduceMotion, replay, short, small } from '../core/env.js';
import { STATUS_LABEL, verb } from './event-text.js';
import { TYPE_ICON, icon } from './icons.js';
import { BASE_ZOOM } from '../scene/renderer.js';
import { AGENT_NAME, agentOf, canSession, colorOf, dn, sessions, unknownLabel, workers } from '../people/workers.js';
import { appendOmpActions } from './omp-history.js';
import { appendOmpControlComposer } from './omp-controls.js';
import { cap, feedRow, fmtTok, fmtUsd, openFromRow, queueUi, toast } from './activity.js';
import { goView, setView } from './camera-bar.js';
import { closeMac, doAction, loadMac, macSnap } from './mac-drawer.js';
import { TOKEN } from '../net/live.js';
import { unseenDone } from '../life/your-turn.js';
import { DEMO, demoLog } from '../demo/demo.js';
import { acctActions } from './session-account.js';
import { drawDrawerCache } from './cache-words.js';
import { t as tr, locale } from '../../i18n/index.js';
import { appendSessionBadges, childState, counterNote, projectLabel, renderSessionProviderBreakdown, sessionMetricView } from './session-info.js';

/* ---------- session drawer ---------- */
export let tab = 'chat';
let logItems = [], subItems = [];
let logTimer = null;
let nextCursor = null, subCursor = null, conversationIncomplete = false, logRequest = 0, headLogSig = '';
const logSig = (s) => s ? [s.id, canSession(s, 'readConversation'), s.counts?.read, s.counts?.edit, s.counts?.cmd, s.counts?.web, s.metrics?.tokens?.input, s.metrics?.tokens?.output, s.subs?.length].join('|') : '';
export let drS;
export let drM;
export function toggleSession(id) { if (state.selectedId === id && !drS.hidden) closeSession(); else openSession(id); }
export function openSession(id, opts = {}) {
  unseenDone.delete(id);
  if (!sessions.has(id)) return;
  closeMac();
  const same = state.selectedId === id && !drS.hidden;
  state.selectedId = id; drS.hidden = false; setView(null);
  const waver = workers.get(id); if (waver && !same) waver.waveUntil = state.sim + 1.8;
  if (small.matches) $('feed').classList.remove('feed--open');
  state.zoomGoal = (small.matches ? 2.1 : 1.6) * BASE_ZOOM;
  if (!same) { logItems = []; subItems = []; nextCursor = null; subCursor = null; conversationIncomplete = false; headLogSig = ''; }
  state.subView = opts.agent || null;
  setTab(opts.tab || 'chat');
  headLogSig = logSig(sessions.get(id));
  renderSessionHead(); renderActions();
  loadLog(true);
  queueUi();
}
export function closeSession() { state.selectedId = null; state.subView = null; headLogSig = ''; drS.hidden = true; goView('home'); queueUi(); }
export function renderSessionHead() {
  const s = sessions.get(state.selectedId); if (!s) return;
  const nextLogSig = logSig(s), prevLogSig = headLogSig;
  headLogSig = nextLogSig;
  if (!canSession(s, 'readConversation')) {
    logItems = []; subItems = []; nextCursor = null; subCursor = null; logRequest++;
    if (tab === 'chat' || (tab === 'subs' && state.subView)) $('ds-body').replaceChildren(el('p', 'chat-empty', tr('drawer.conversationDisabled')));
  } else if (prevLogSig && nextLogSig !== prevLogSig) {
    if (!prevLogSig.startsWith(s.id + '|true|')) loadLog(true);
    else if (agentOf(s) === 'omp') scheduleLog();
  }
  $('ds-dot').style.background = colorOf(s);
  $('ds-name').textContent = dn(s);
  const dir = $('ds-dir'); dir.replaceChildren(document.createTextNode([projectLabel(s), s.origin].filter(Boolean).join(' · '))); appendSessionBadges(dir, s);
  drawDrawerCache();   // (its prompt cache: warm for how long, or cold)
  const st = $('ds-status'); st.textContent = agentOf(s) === 'omp' ? unknownLabel(s) : STATUS_LABEL[s.status] || unknownLabel(s); st.dataset.status = s.status;
  $('dr-session').dataset.lifecycle = s.lifecycle || '';
  for (const k of ['read', 'edit', 'cmd']) { $('ds-' + k).textContent = s.counts?.[k] ?? '–'; $('ds-' + k).parentElement.title = counterNote(s); }
  $('ds-time').textContent = s.taskStart && ['work', 'wait'].includes(s.status) ? fmtClock((nowMs() - s.taskStart) / 1000) : '–';
  const metrics = sessionMetricView(s), ctx = metrics.context;
  const contextValue = $('ds-ctx'), costValue = $('ds-cost');
  contextValue.textContent = ctx ? `${ctx.pct}%` : '–';
  contextValue.parentElement.title = ctx ? tr(agentOf(s) === 'omp' ? 'drawer.contextEvidence' : 'drawer.tokens', {
    used: fmtTok(ctx.used), max: fmtTok(ctx.window), model: s.model || s.usage?.model || '–', provenance: tr('drawer.provenance.' + ctx.provenance),
  }) : tr('drawer.metricsUnavailable');
  costValue.textContent = metrics.cost !== null ? fmtUsd(metrics.cost) : '–'; costValue.parentElement.title = metrics.costNote;
  const n = s.subs?.length || 0;
  $('tab-subs').textContent = n ? tr('drawer.tabSubsN', { n }) : tr('drawer.tabSubs');
  if (actionsSig(s) !== drawnSig) renderActions();   // (it came to rest, went to work, or moved to another account)
}
export async function openWindowOf(s) {
  s = sessions.get(s?.id);
  if (!canSession(s, 'openWindow')) { toast(tr('drawer.readOnly')); return; }
  if (DEMO) { toast(tr('drawer.demoNoWindow')); return; }
  try {
    const r = await (await fetch(`/api/open${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })).json();
    toast(r.ok ? tr('drawer.opened', { app: r.app }) : r.message || tr('drawer.openFailed'));
  } catch { toast(tr('drawer.unreachable')); }
}
// what the buttons below depend on
let drawnSig = '', qrFor = null;   // (qrFor: the session whose Remote Control QR code is shown)
const actionsSig = (s) => [s.id, agentOf(s), s.persistedOnly, s.incomplete, s.connection, s.lifecycle, replay.on, state.isLocal, JSON.stringify(s.capabilities), JSON.stringify(s.control), s.link, s.status === 'rest', s.pid, s.moved?.to, s.acct, state.limits?.others?.length, JSON.stringify(s.metrics?.byProvider || null)].join('|');
function renderActions() {
  const s = sessions.get(state.selectedId); if (!s) return;
  const box = $('ds-actions'); box.replaceChildren(); drawnSig = actionsSig(s);
  if (replay.on) { box.append(el('p', 'dr-note', tr('drawer.readOnly'))); return; }
  if (agentOf(s) !== 'claude') {
    const noteKey = agentOf(s) === 'omp' && s.control?.owner === 'managed'
      ? (s.control?.state === 'ready' && (s.control?.canPrompt || s.control?.canSteer || s.control?.canFollowUp || s.control?.canAbort)
        ? 'drawer.managedActiveNote'
        : 'drawer.managedLauncherNote')
      : agentOf(s) === 'omp' ? 'drawer.readOnly' : 'drawer.unsupportedAgent';
    box.append(el('p', 'dr-note', tr(noteKey)));
    if (agentOf(s) === 'omp' && s.persistedOnly === true) {   // a pinned history file: say so, and offer the way back out
      box.append(el('p', 'dr-note', tr(s.incomplete ? 'drawer.persistedIncomplete' : 'drawer.persistedNote')));
    }
    if (agentOf(s) === 'omp') {
      if (typeof appendOmpControlComposer === 'function') appendOmpControlComposer(box, s, renderActions);
      if (state.isLocal) appendOmpActions(box, s);
    }
    const breakdown = typeof renderSessionProviderBreakdown === 'function' ? renderSessionProviderBreakdown(s, { fmtTok, fmtUsd }) : null;
    if (breakdown) box.append(breakdown);
    return;
  }
  if (state.isLocal && s.pid && canSession(s, 'openWindow')) {
    const b = el('button', 'btn btn--sm'); b.type = 'button'; b.append(icon('monitor'), tr(s.origin === 'Terminal' ? 'drawer.openWindowTerminal' : s.origin ? 'drawer.openWindowIde' : 'drawer.openWindow'));
    b.title = tr('drawer.openWindowTitle'); b.addEventListener('click', () => openWindowOf(s)); box.append(b);
  }
  if (state.isLocal && s.pid && s.status === 'rest' && canSession(s, 'closeSession')) box.append(closeSessionButton(s));
  box.append(...acctActions(s, renderActions));
  if (!canSession(s, 'remoteControl')) return;
  if (s.link) {
    const a = el('a', 'btn btn--primary btn--sm', tr('drawer.openOnClaude')); a.href = s.link; a.target = '_blank'; a.rel = 'noopener';
    box.append(a);
    // on the Mac: a QR code of the session's Remote Control link, to carry on from the phone (the Claude app opens it)
    if (state.isLocal && window.QRCode) {
      const q = el('button', 'btn btn--sm'); q.type = 'button'; q.title = tr('drawer.qrTitle'); q.textContent = tr('drawer.qr'); q.setAttribute('aria-pressed', String(qrFor === s.id));
      q.addEventListener('click', () => { qrFor = qrFor === s.id ? null : s.id; renderActions(); });
      box.append(q);
      if (qrFor === s.id) { const code = el('div', 'qr dr-qr'); try { new window.QRCode(code, { text: s.link, width: 180, height: 180 }); box.append(code, el('p', 'dr-note', tr('drawer.qrNote'))); } catch { /* no QR */ } }
    }
    if (qrFor !== s.id) box.append(el('p', 'dr-note', tr('drawer.openOnClaudeNote')));
  } else {
    const [before, after = ''] = tr('drawer.rcHint').split('{cmd}');
    const p = el('p', 'dr-note'); p.append(before, el('code', null, '/rc'), after);
    box.append(p);
  }
}
// "Close session" for a session that is resting: the same safe stop as the Mac panel (only the process you saw, matched by
// its start time; never one that is working). Two clicks, so a stray click closes nothing. The conversation stays on
// disk: `claude --resume` opens it again.
let closeArm = null, closeArmTimer = 0;
const closing = new Set();
function closeSessionButton(s) {
  const key = `close:${s.pid}`, armed = closeArm === key, mem = macSnap?.claude?.find((x) => x.pid === s.pid)?.mem;
  const b = el('button', 'btn btn--sm' + (armed ? ' btn--danger' : '')); b.type = 'button';
  b.append(icon('x'), closing.has(key) ? tr('drawer.close.closing') : armed ? tr('drawer.close.confirm') : mem ? tr('drawer.close.labelMem', { mem: fmtBytes(mem) }) : tr('drawer.close.label'));
  b.title = mem ? tr('drawer.close.titleMem', { mem: fmtBytes(mem) }) : tr('drawer.close.title');
  b.disabled = closing.has(key);
  b.addEventListener('click', async () => {
    const current = sessions.get(s.id);
    if (!canSession(current, 'closeSession') || current.pid !== s.pid || current.status !== 'rest') return;
    if (!armed) { closeArm = key; clearTimeout(closeArmTimer); closeArmTimer = setTimeout(() => { closeArm = null; renderActions(); }, 4500); renderActions(); return; }
    closeArm = null; closing.add(key); renderActions();
    let proc = macSnap?.claude?.find((x) => x.pid === s.pid);
    if (!proc) { await loadMac(); proc = macSnap?.claude?.find((x) => x.pid === s.pid); }
    if (!proc) toast(tr('drawer.close.gone'));
    else if (canSession(sessions.get(s.id), 'closeSession') && sessions.get(s.id)?.pid === s.pid && sessions.get(s.id)?.status === 'rest') await doAction(`kill:${s.pid}`, { action: 'kill', target: s.pid, start: proc.start });
    closing.delete(key); loadMac(); if (state.selectedId === s.id) renderActions();
  });
  return b;
}
function setTab(t) {
  tab = t;
  for (const [id, name] of [['tab-chat', 'chat'], ['tab-subs', 'subs'], ['tab-act', 'act']]) $(id).setAttribute('aria-selected', String(t === name));
  if (t === 'chat') { if (logItems.length) renderChat(true); else $('ds-body').replaceChildren(el('p', 'chat-empty', tr('drawer.loadingChat'))); }
  else if (t === 'subs') renderSubs(true);
  else renderActivity();
  queueMicrotask(syncJump);
}
async function loadLog(scrollEnd = false, earlier = false) {
  const id = state.selectedId; if (!id) return;
  const s = sessions.get(id), requestTab = tab, agent = requestTab === 'subs' ? state.subView : null;
  const ompAct = requestTab === 'act' && agentOf(s) === 'omp';
  if ((requestTab === 'subs' && !agent) || (requestTab === 'act' && !ompAct)) return;
  if (!canSession(s, 'readConversation')) {
    logItems = []; subItems = []; nextCursor = null; subCursor = null;
    $('ds-body').replaceChildren(el('p', 'chat-empty', tr('drawer.conversationDisabled')));
    return;
  }
  const request = ++logRequest, cursor = earlier ? (agent ? subCursor : nextCursor) : null;
  const isCurrentRequest = () => request === logRequest && id === state.selectedId && tab === requestTab
    && canSession(sessions.get(id), 'readConversation') && (agent || null) === (tab === 'subs' ? state.subView : null);
  try {
    let d;
    if (DEMO) {
      const all = demoLog.get(agent || id) || [], end = cursor === null ? all.length : Number(cursor), start = Math.max(0, end - 120);
      d = { items: all.slice(start, end), nextCursor: start ? String(start) : null };
    } else {
      const p = new URLSearchParams({ id }); if (agent) p.set('agent', agent); if (TOKEN) p.set('k', TOKEN); if (cursor !== null) p.set('before', cursor);
      const r = await fetch('/api/log?' + p);
      if (!r.ok) throw new Error('conversation-unavailable');
      d = await r.json();
    }
    if (!isCurrentRequest()) return;
    conversationIncomplete = d.incomplete === true;
    const items = Array.isArray(d.items) ? d.items : [];
    if (agent) { subCursor = d.nextCursor ?? null; subItems = earlier ? [...items, ...subItems] : items; renderSubs(scrollEnd); }
    else { nextCursor = d.nextCursor ?? null; logItems = earlier ? [...items, ...logItems] : items; if (tab === 'chat') renderChat(scrollEnd); else if (tab === 'act') renderActivity(); }
    return true;
  } catch { if (isCurrentRequest()) $('ds-body').replaceChildren(el('p', 'chat-empty', tr('drawer.chatUnreadable'))); }
}
export function scheduleLog() { clearTimeout(logTimer); logTimer = setTimeout(() => loadLog(false), 1200); }
/* conversation: a small markdown renderer that only builds DOM nodes (never innerHTML), so a transcript can't inject
   markup. Covers what Claude writes: headings, lists (nested, task boxes), code blocks, tables, quotes, rules, links. */
const MD_INLINE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|(?<![\w*])\*[^*\s][^*\n]*?\*(?!\w)|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/;
function mdInline(parent, text) {
  for (const bit of String(text).split(new RegExp(MD_INLINE.source))) {
    if (!bit) continue;
    let m;
    if (bit.length > 2 && bit[0] === '`' && bit.at(-1) === '`') parent.append(el('code', null, bit.slice(1, -1)));
    else if (/^(\*\*|__).+\1$/.test(bit) && bit.length > 4) { const b = el('strong'); mdInline(b, bit.slice(2, -2)); parent.append(b); }
    else if (/^\*[^*].*\*$/.test(bit)) { const i = el('em'); mdInline(i, bit.slice(1, -1)); parent.append(i); }
    else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(bit))) {
      if (/^https?:\/\//.test(m[2])) { const a = el('a', null, m[1]); a.href = m[2]; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
      else parent.append(el('span', 'md-file', m[1]));   // a path in the project: nothing to open from here
    } else if (/^https?:\/\//.test(bit)) { const a = el('a', null, short(bit.replace(/^https?:\/\//, ''), 60)); a.href = bit; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
    else parent.append(bit);
  }
}
const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
export function mdBlocks(text) {
  const frag = document.createDocumentFragment(), lines = String(text).replace(/\r/g, '').split('\n');
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const startsBlock = (l, next) => /^\s*```/.test(l) || /^#{1,6}\s/.test(l) || LIST_RE.test(l) || /^\s*>/.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || (/^\s*\|/.test(l) && isTableSep(next));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^\s*```\s*([\w+#.-]*)/.exec(line))) {
      const code = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      const box = el('div', 'md-code'), head = el('div', 'md-code-head'), copy = el('button', 'md-copy', tr('drawer.copy')); copy.type = 'button';
      const body = code.join('\n'); copy.addEventListener('click', () => copyText(body, copy));
      head.append(el('span', null, m[1] || 'code'), copy); box.append(head, el('pre', null, body)); frag.append(box);
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { const h = el(m[1].length <= 2 ? 'h4' : 'h5'); mdInline(h, m[2].replace(/\s#+\s*$/, '')); frag.append(h); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { frag.append(el('hr')); i++; continue; }
    if (/^\s*\|/.test(line) && isTableSep(lines[i + 1])) {
      const wrap = el('div', 'md-table'), t = el('table'), thead = el('thead'), tr = el('tr');
      for (const c of cells(line)) { const th = el('th'); mdInline(th, c); tr.append(th); }
      thead.append(tr); t.append(thead); i += 2;
      const tb = el('tbody');
      while (i < lines.length && /^\s*\|/.test(lines[i])) { const r = el('tr'); for (const c of cells(lines[i])) { const td = el('td'); mdInline(td, c); r.append(td); } tb.append(r); i++; }
      t.append(tb); wrap.append(t); frag.append(wrap); continue;
    }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = el('blockquote'); bq.append(mdBlocks(q.join('\n'))); frag.append(bq); continue;
    }
    if (LIST_RE.test(line)) {
      const stack = [];   // { indent, list, li }
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) { if (LIST_RE.test(lines[i + 1] || '')) { i++; continue; } break; }
        const lm = LIST_RE.exec(l);
        if (!lm) {
          if (/^\s+\S/.test(l) && stack.length) { const li = stack.at(-1).li; li.append(' '); mdInline(li, l.trim()); i++; continue; }
          break;
        }
        const indent = lm[1].replace(/\t/g, '  ').length, ordered = /\d/.test(lm[2]);
        while (stack.length && stack.at(-1).indent > indent) stack.pop();
        if (!stack.length || stack.at(-1).indent < indent) {
          const list = el(ordered ? 'ol' : 'ul');
          if (ordered && parseInt(lm[2], 10) > 1) list.start = parseInt(lm[2], 10);
          (stack.length ? stack.at(-1).li : frag).append(list);
          stack.push({ indent, list, li: null });
        }
        const top = stack.at(-1), li = el('li');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(lm[3]);
        if (task) { li.className = 'md-task'; li.dataset.done = String(task[1] !== ' '); const t = el('span'); mdInline(t, task[2]); li.append(el('span', 'md-box', task[1] !== ' ' ? '✓' : ''), t); }
        else mdInline(li, lm[3]);
        top.list.append(li); top.li = li; i++;
      }
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++]);
    const p = el('p');
    para.forEach((l, k) => { if (k) p.append(el('br')); mdInline(p, l); });
    frag.append(p);
  }
  return frag;
}
function copyText(text, btn) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = tr('drawer.copied'); setTimeout(() => { btn.textContent = t; }, 1400); } else toast(tr('drawer.copiedToast')); };
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, () => toast(tr('drawer.copyFailed'))); return; }
  const ta = el('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { toast(tr('drawer.copyFailed')); }
  ta.remove();
}
// Which long messages / step groups / summaries are open survives the re-render that follows every new event.
const chatOpen = new Set();
const chatKey = (it, k) => `${it.role}:${it.ts}:${k}`;
const LONG_CHARS = 1100, LONG_LINES = 18;
// the tally word for each step type: a key under drawer.step
const STEP_WORD = { read: 'read', grep: 'read', glob: 'read', skill: 'read', edit: 'edit', write: 'edit', bash: 'cmd', cmd: 'cmd', web: 'web', fetch: 'web', mcp: 'tool', task: 'agent', agent: 'agent', plan: 'plan' };
function chatDay(ts) {
  const d = new Date(ts), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const day = d >= t0 ? tr('drawer.today') : d >= t0.getTime() - 86400e3 ? tr('drawer.yesterday')
    : tr('drawer.date', { dd: pad2(d.getDate()), mm: pad2(d.getMonth() + 1), d: d.getDate(), mon: d.toLocaleDateString(locale(), { month: 'short' }) });
  return `${day} · ${hhmm(ts)}`;
}
function foldable(details, key) {
  if (chatOpen.has(key)) details.open = true;
  details.addEventListener('toggle', () => { if (details.open) chatOpen.add(key); else chatOpen.delete(key); });
  return details;
}
function buildChat(items, who = 'Claude', isSub = false) {
  const chat = el('div', 'chat');
  const cursor = isSub ? subCursor : nextCursor;
  if (cursor !== null) {
    const earlier = el('button', 'btn btn--sm chat-earlier', tr('drawer.loadEarlier')); earlier.type = 'button';
    earlier.addEventListener('click', async () => {
      const body = $('ds-body'), height = body.scrollHeight, top = body.scrollTop;
      earlier.disabled = true;
      if (await loadLog(false, true)) body.scrollTop = top + body.scrollHeight - height;
    });
    chat.append(earlier);
  }
  if (conversationIncomplete) chat.append(el('p', 'dr-note', tr('drawer.conversationIncomplete')));
  if (!items.length) chat.append(el('p', 'chat-empty', tr('drawer.chatEmpty')));
  let steps = null, lastTs = 0;
  const flush = () => {
    if (!steps) return;
    const first = steps[0], d = foldable(el('details', 'steps'), chatKey(first, 'steps'));
    const sum = el('summary'), counts = {};
    for (const x of steps) { const w = STEP_WORD[x.type] || 'other'; counts[w] = (counts[w] || 0) + 1; }
    sum.append(el('span', 'st-ico', null), el('b', null, tr('drawer.steps', { n: steps.length })));
    sum.firstChild.append(icon('terminal'));
    const tally = el('span', 'st-tally', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, n]) => tr(`drawer.step.${w}`, { n })).join(' · '));
    sum.append(tally, el('span', 'st-chev'));
    sum.lastChild.append(icon('chevron'));
    const ul = el('ul');
    for (const x of steps) {
      const li = el('li'), ic = el('span', 'st-step-ico'); ic.append(icon(TYPE_ICON[x.type] || 'sparkle'));
      const text = agentOf(sessions.get(state.selectedId)) === 'omp' ? `${tr('drawer.toolInvocation')} · ${tr('drawer.step.' + (STEP_WORD[x.type] || 'other'), { n: 1 })}` : cap(verb(x));
      const txt = el('span', x.type === 'bash' || x.type === 'cmd' ? 'st-cmd' : null, text);
      li.append(ic, txt); ul.append(li);
    }
    d.append(sum, ul); chat.append(d); steps = null;
  };
  items.forEach((it, k) => {
    if (it.ts && (!lastTs || it.ts - lastTs > 20 * 60e3 || new Date(it.ts).getDate() !== new Date(lastTs).getDate())) { flush(); chat.append(el('div', 'chat-day', chatDay(it.ts))); }
    if (it.ts) lastTs = it.ts;
    if (it.role === 'tool') { (steps ||= []).push(it); return; }
    if (it.role === 'toolResult') {
      flush();
      const d = el('details', 'msg-summary tool-result'), sm = el('summary', null, tr(it.phase === 'error' || it.isError ? 'drawer.toolError' : 'drawer.toolResult'));
      d.dataset.phase = it.phase || (it.isError ? 'error' : 'completed');
      if (it.toolCallId) sm.append(document.createTextNode(' · ' + it.toolCallId));
      d.append(sm); if (it.text) d.append(el('pre', null, it.text));
      chat.append(d); return;
    }
    flush();
    // the server writes the note; one about a subagent gets a clipboard ("trợ lý" is the Vietnamese wording)
    if (it.role === 'note') { chat.append(el('div', 'msg-note', `${/trợ lý|subagent/i.test(it.text) ? '📋' : '✋'} ${it.text}${it.ts ? ' · ' + hhmm(it.ts) : ''}`)); return; }
    if (it.role === 'summary') {
      const d = foldable(el('details', 'msg-summary'), chatKey(it, 'sum')), sm = el('summary');
      const ic = el('span', 'sum-ico'); ic.append(icon('list'));
      const title = it.kind === 'reset_boundary' ? 'drawer.resetSummary' : it.kind === 'branch_summary' ? 'drawer.branchSummary' : 'drawer.summaryTitle';
      const tx = el('span', 'sum-txt'); tx.append(el('b', null, tr(title)), el('small', null, tr(agentOf(sessions.get(state.selectedId)) === 'claude' ? 'drawer.summaryNote' : 'drawer.summaryNoteGeneric')));
      const chev = el('span', 'st-chev'); chev.append(icon('chevron'));
      sm.append(ic, tx, chev);
      const body = el('div', 'md'); body.append(mdBlocks(it.text.replace(/^This session is being continued[^\n]*\n+/, '').replace(/^Summary:\s*\n?/, '')));
      d.append(sm, body); chat.append(d); return;
    }
    const mine = it.role === 'user', m = el('div', 'msg msg--' + (mine ? 'user' : 'claude'));
    const head = el('div', 'msg-head');
    if (!mine) { const av = el('span', 'msg-av', who === 'Claude' ? 'C' : isSub ? tr('drawer.subAvatar') : who.slice(0, 1).toUpperCase()); if (who !== 'Claude') av.dataset.tone = 'blue'; head.append(av); }
    head.append(el('b', null, mine ? (isSub ? tr('drawer.fromMain') : tr('drawer.you')) : who));
    if (it.ts) head.append(el('time', null, hhmm(it.ts)));
    if (!mine) { const cp = el('button', 'msg-copy', tr('drawer.copy')); cp.type = 'button'; cp.title = tr('drawer.copyMessage'); cp.addEventListener('click', () => copyText(it.text, cp)); head.append(cp); }
    const body = el('div', 'msg-body md');
    body.append(mdBlocks(it.text));
    if (it.imgs) body.append(el('p', 'msg-imgs', tr('drawer.images', { n: it.imgs })));
    m.append(head, body);
    const long = it.text.length > LONG_CHARS || it.text.split('\n').length > LONG_LINES;
    if (long) {
      const key = chatKey(it, k), more = el('button', 'msg-more'); more.type = 'button';
      const set = (open) => { body.classList.toggle('is-clamped', !open); more.textContent = open ? tr('drawer.showLess') : tr('drawer.showMore', { n: Math.max(1, Math.round(it.text.length / 1000)) }); };
      set(chatOpen.has(key));
      more.addEventListener('click', () => { const open = !chatOpen.has(key); if (open) chatOpen.add(key); else chatOpen.delete(key); set(open); });
      m.append(more);
    }
    chat.append(m);
  });
  flush();
  return chat;
}
export function renderChat(scrollEnd) {
  if (tab !== 'chat') return;
  const body = $('ds-body');
  const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const top = body.scrollTop;
  const s = sessions.get(state.selectedId), kind = agentOf(s);
  if (!canSession(s, 'readConversation')) { body.replaceChildren(el('p', 'chat-empty', tr('drawer.conversationDisabled'))); return; }
  body.replaceChildren(buildChat(logItems, kind === 'claude' ? 'Claude' : AGENT_NAME[kind] || tr('drawer.assistant')));
  if (scrollEnd || nearEnd) body.scrollTop = body.scrollHeight; else body.scrollTop = top;
  syncJump();
}
let jumpBtn;
function syncJump() { const b = $('ds-body'); jumpBtn.hidden = !(tab === 'chat' || (tab === 'subs' && state.subView)) || b.scrollHeight - b.scrollTop - b.clientHeight < 240; }
const subInfo = (s, id) => [...(s?.subs || []), ...(s?.doneSubs || [])].find((y) => y.id === id);
export function renderSubs(scrollEnd = false) {
  if (tab !== 'subs') return;
  const s = sessions.get(state.selectedId), body = $('ds-body');
  if (state.subView) {
    if (!canSession(s, 'readConversation')) { body.replaceChildren(el('p', 'chat-empty', tr('drawer.conversationDisabled'))); return; }
    const x = subInfo(s, state.subView);
    const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    const head = el('div', 'sub-head');
    const back = el('button', 'btn btn--sm', tr('drawer.allSubs')); back.type = 'button';
    back.addEventListener('click', () => { state.subView = null; renderSubs(); });
    const pill = el('span', 'pill', x ? childState(x) : tr('drawer.unknownState')); pill.dataset.status = x?.persistedOnly || !x ? 'unknown' : x.endedAt ? 'rest' : 'work';
    head.append(back, el('b', null, x ? `${x.type}${x.desc ? ': ' + x.desc : ''}` : tr('drawer.subagent')), pill);
    const wrap = el('div'); wrap.append(head, buildChat(subItems, x?.type || tr('drawer.subagent'), true));
    body.replaceChildren(wrap);
    if (scrollEnd || nearEnd) body.scrollTop = body.scrollHeight;
    syncJump();
    return;
  }
  const frag = document.createDocumentFragment();
  const all = [...(s?.subs || []), ...(s?.doneSubs || [])];
  if (agentOf(s) === 'omp') frag.append(el('p', 'dr-note', tr('drawer.subSupport')));
  if (s?.childrenIncomplete) frag.append(el('p', 'dr-note', tr('drawer.subIncomplete')));
  if (s?.flattened) frag.append(el('p', 'dr-note', tr('drawer.flattenedTree')));
  if (!all.length) frag.append(el('p', 'chat-empty', tr(agentOf(s) === 'claude' ? 'drawer.noSubs' : 'drawer.noObservedSubs')));
  const rootKey = s?.sessionKey || s?.id, visited = new Set(), box = el('div', 'rows sub-tree');
  const card = (x, depth, orphan = false) => {
    visited.add(x);
    const b = el('button', 'sub-card'); b.type = 'button'; b.dataset.agent = x.id; b.dataset.parent = x.parentAgentKey || '';
    b.style.setProperty('--depth', Math.min(depth, 6));
    const ic = el('span', 'fi-ico'); ic.append(icon(x.persistedOnly ? 'file' : x.endedAt ? 'check' : 'sparkle'));
    b.append(ic, el('b', null, `${x.type || tr('drawer.subagent')}${x.desc ? ' · ' + x.desc : ''}`), el('small', null, childState(x)));
    const parent = all.find((p) => p.agentKey === x.parentAgentKey);
    b.append(el('span', 'sub-parent', orphan ? tr('drawer.relationUnknown') : tr('drawer.parentAgent', { name: parent?.type || dn(s) })));
    b.addEventListener('click', () => { state.subView = x.id; subItems = []; subCursor = null; conversationIncomplete = false; renderSubs(); loadLog(true); });
    box.append(b);
    if (!x.agentKey) return;
    for (const child of all) {
      if (!visited.has(child) && child.parentAgentKey === x.agentKey) card(child, depth + 1);
    }
  };
  for (const x of all) if (!visited.has(x) && (!x.parentAgentKey || x.parentAgentKey === rootKey)) card(x, 0);
  for (const x of all) if (!visited.has(x)) card(x, 0, true);
  frag.append(box);
  body.replaceChildren(frag);
}
export function renderActivity() {
  if (tab !== 'act') return;
  const body = $('ds-body'), s = sessions.get(state.selectedId);
  const mine = state.feed.filter((e) => e.sess === state.selectedId).slice(-60).reverse();
  const ul = el('ul', 'feed-list'); ul.style.padding = '0';
  if (!mine.length && agentOf(s) === 'omp') {
    if (!canSession(s, 'readConversation')) { body.replaceChildren(el('p', 'chat-empty', tr('drawer.conversationDisabled'))); return; }
    const tools = logItems.filter((it) => it.role === 'tool').slice(-60).reverse();
    if (!tools.length) ul.append(el('li', 'fi-empty', tr('drawer.noActivity')));
    for (const x of tools) {
      const li = el('li', 'fr'), ln = el('span', 'fg-line'), ic = el('span', 'fi-ico');
      ic.append(icon(TYPE_ICON[x.type] || 'sparkle'));
      const text = `${tr('drawer.toolInvocation')} · ${tr('drawer.step.' + (STEP_WORD[x.type] || 'other'), { n: 1 })}`;
      ln.append(ic, el('span', 'fg-text', text));
      li.append(ln, el('time', null, x.ts ? hhmm(x.ts) : ''));
      ul.append(li);
    }
    body.replaceChildren(ul);
    return;
  }
  if (!mine.length) ul.append(el('li', 'fi-empty', tr('drawer.noActivity')));
  for (const e of mine) ul.append(feedRow(e, false));
  ul.addEventListener('click', (ev) => { const b = ev.target.closest('[data-agent]'); if (b) openFromRow(b); });
  body.replaceChildren(ul);
}

export function setup() {
  state.subView = null;
  drS = $('dr-session'); drM = $('dr-mac');
  $('tab-chat').addEventListener('click', () => { setTab('chat'); loadLog(true); });
  $('tab-subs').addEventListener('click', () => { state.subView = null; setTab('subs'); });
  $('tab-act').addEventListener('click', () => { setTab('act'); if (agentOf(sessions.get(state.selectedId)) === 'omp' && !logItems.length) loadLog(false); });
  // "Latest" button: shows when you have scrolled up in a conversation.
  jumpBtn = el('button', 'chat-jump');
   jumpBtn.type = 'button';
   jumpBtn.hidden = true;
  jumpBtn.append(icon('chevron'), document.createTextNode(tr('drawer.latest')));
  jumpBtn.addEventListener('click', () => { const b = $('ds-body'); b.scrollTo({ top: b.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' }); });
  $('dr-session').append(jumpBtn);
  $('ds-body').addEventListener('scroll', syncJump, { passive: true });
}
