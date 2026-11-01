// Additive OMP Multi-Account Usage & Session Provider Metrics panel.
// Read-only: no login, logout, account-switch, reorder, or saved-reset redemption controls.
// Isolated from Claude `state.limits` so Claude quota and account controls never mix with OMP.
import { state } from '../core/state.js';
import { $, el, hhmm, replay } from '../core/env.js';
import { agentOf, sessions } from '../people/workers.js';
import { fmtTok, fmtUsd } from './activity.js';
import { TOKEN } from '../net/live.js';
import { t as tr, num } from '../../i18n/index.js';

const limitLevel = (pct) => (pct >= 95 ? 'critical' : pct >= 80 ? 'warn' : 'normal');

function providerTitle(providerId) {
  if (providerId === 'openai-codex') return tr('mac.ompUsage.codex');
  if (providerId === 'google-antigravity') return tr('mac.ompUsage.antigravity');
  if (!providerId || providerId === 'unknown') return tr('mac.ompUsage.unknownProvider');
  return tr('mac.ompUsage.otherProvider', { provider: providerId });
}

function availabilityBadge(availability) {
  const map = {
    ready: ['fresh', tr('mac.ompUsage.fresh')],
    stale: ['stale', tr('mac.ompUsage.stale')],
    unavailable: ['unavailable', tr('mac.ompUsage.unavailable')],
    'auth-error': ['auth-error', tr('mac.ompUsage.authError')],
    unsupported: ['unsupported', tr('mac.ompUsage.unsupported')],
  };
  const [tone, label] = map[availability] || ['unavailable', tr('mac.ompUsage.unavailable')];
  const badge = el('em', `omp-badge omp-badge--${tone}`, label);
  badge.dataset.availability = availability || 'unavailable';
  return badge;
}

function formatResetWhen(resetsAt, resetTextFn) {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return tr('mac.ompUsage.resetUnknown');
  if (resetsAt <= Date.now()) return tr('mac.ompUsage.resetExpired');
  return typeof resetTextFn === 'function'
    ? tr('mac.plan.resets', { when: resetTextFn(resetsAt) })
    : tr('mac.plan.resets', { when: new Date(resetsAt).toLocaleString() });
}

const percent = (value) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(100, Math.max(0, value))
  : null;
const accountWindows = (acct) => Array.isArray(acct.windows)
  ? acct.windows.filter((w) => w && typeof w === 'object')
  : [];

function renderAccountWindow(container, w, resetTextFn) {
  const row = el('div', 'omp-win-row');
  row.dataset.windowId = w.id || '';
  row.dataset.sourceUnit = w.sourceUnit || 'unknown';
  const label = String(w.label || w.id || tr('mac.ompUsage.quotaWindow'));
  const labelSpan = el('span', 'omp-win-label', label);
  const used = percent(w.usedPercent);
  const remaining = percent(w.remainingPercent);
  const exhausted = w.status === 'exhausted' || used === 100;
  const level = exhausted ? 'critical' : used === null ? 'unknown' : limitLevel(used);
  row.dataset.level = level;
  const valEl = el('em', 'omp-win-val', used === null
    ? tr('mac.ompUsage.usedUnknown')
    : tr('mac.ompUsage.usedPct', { pct: num(used, 1) }));
  const bar = el('span', 'hl-bar');
  if (used !== null) {
    const fill = el('b', level);
    fill.style.width = `${used}%`;
    bar.append(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(used));
    bar.setAttribute('aria-valuetext', valEl.textContent);
  } else {
    bar.classList.add('omp-bar-unknown');
    bar.setAttribute('aria-hidden', 'true');
  }
  const leftText = remaining === null
    ? tr('mac.ompUsage.leftUnknown')
    : tr('mac.ompUsage.leftPct', { pct: num(remaining, 1) });
  row.append(
    labelSpan, valEl, bar,
    el('small', 'omp-win-sub', `${leftText} · ${formatResetWhen(w.resetsAt, resetTextFn)}`)
  );
  container.append(row);
}

function renderAccountBlock(acct, resetTextFn) {
  const block = el('div', 'omp-acct');
  block.dataset.accountKey = acct.accountKey || '';
  block.dataset.provider = acct.providerId || '';
  block.dataset.availability = acct.availability || 'unavailable';

  const head = el('div', 'omp-acct-head');
  const title = el('b', 'omp-acct-name', String(acct.label || tr('mac.ompUsage.accountUnnamed')));
  const readTs = acct.observedAt || acct.lastSuccessAt;
  const meta = el('span', 'omp-acct-meta', typeof readTs === 'number' && Number.isFinite(readTs) && readTs > 0
    ? tr('mac.ompUsage.readTime', { time: hhmm(readTs) })
    : tr('mac.ompUsage.readUnknown'));
  head.append(title, availabilityBadge(acct.availability), meta);
  block.append(head);

  const windows = accountWindows(acct);
  const noteKey = {
    stale: 'accountStale',
    'auth-error': 'accountAuthError',
    unavailable: 'accountUnavailable',
    unsupported: 'accountUnsupported',
  }[acct.availability];
  if (noteKey) block.append(el('small', 'omp-acct-note', tr(`mac.ompUsage.${noteKey}`)));
  if (!windows.length) {
    if (!noteKey) block.append(el('small', 'omp-acct-note', tr('mac.ompUsage.noWindows')));
    return block;
  }

  for (const w of windows) renderAccountWindow(block, w, resetTextFn);
  return block;
}

/**
 * Aggregate session-level token/cost metrics by provider and model across current OMP sessions.
 * Preserves nullable semantics (never converts null cost/tokens to 0) and labels provenance/scope.
 */
export function aggregateSessionProviderRollups(sessionList = [...sessions.values()]) {
  const byProvider = new Map();
  for (const s of sessionList) {
    if (agentOf(s) !== 'omp') continue;
    const buckets = Array.isArray(s?.metrics?.byProvider) ? s.metrics.byProvider : [];
    for (const b of buckets) {
      if (!b || typeof b !== 'object') continue;
      const providerId = b.providerId || 'unknown';
      let group = byProvider.get(providerId);
      if (!group) {
        group = {
          providerId,
          sessionCount: 0,
          provenances: new Set(),
          scopes: new Set(),
          models: new Map(),
        };
        byProvider.set(providerId, group);
      }
      group.sessionCount++;
      if (b.tokens?.provenance && b.tokens.provenance !== 'unknown') group.provenances.add(b.tokens.provenance);
      if (b.cost?.scope) group.scopes.add(b.cost.scope);

      const models = Array.isArray(b.models) && b.models.length
        ? b.models
        : [{ model: s.model || 'unknown', entries: b.entries || 1, cost: b.cost, tokens: b.tokens }];

      for (const m of models) {
        const modelKey = m.model || 'unknown';
        let mAgg = group.models.get(modelKey);
        if (!mAgg) {
          mAgg = {
            model: modelKey,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            hasTokens: false,
            tokensComplete: true,
            cost: 0,
            hasCost: false,
            costComplete: true,
            provenance: m.tokens?.provenance || b.tokens?.provenance || 'unknown',
            scope: m.cost?.scope || b.cost?.scope || 'self',
          };
          group.models.set(modelKey, mAgg);
        }
        const t = m.tokens || {};
        if (typeof t.input === 'number' && typeof t.output === 'number') {
          mAgg.input += t.input;
          mAgg.output += t.output;
          mAgg.cacheRead += typeof t.cacheRead === 'number' ? t.cacheRead : 0;
          mAgg.cacheWrite += typeof t.cacheWrite === 'number' ? t.cacheWrite : 0;
          mAgg.hasTokens = true;
        } else {
          mAgg.tokensComplete = false;
        }
        if (m.cost && typeof m.cost.value === 'number') {
          mAgg.cost += m.cost.value;
          mAgg.hasCost = true;
        } else {
          mAgg.costComplete = false;
        }
      }
    }
  }
  return byProvider;
}

function renderProviderTokenRollup(group) {
  const box = el('details', 'omp-tokens');
  box.dataset.provider = group.providerId;
  const head = el('summary', 'omp-tokens-head');
  const badge = el('span', 'omp-unattr-badge', tr('mac.ompUsage.unattributed'));
  badge.title = tr('mac.ompUsage.unattributedNote');
  head.append(el('span', 'omp-tokens-title', tr('mac.ompUsage.tokensHeading')), badge);
  box.append(head);
  box.append(el('p', 'omp-tokens-note', tr('mac.ompUsage.unattributedNote')));

  for (const m of group.models.values()) {
    const row = el('div', 'omp-token-row');
    row.dataset.model = m.model;
    const tokStr = m.hasTokens && m.tokensComplete
      ? tr('mac.ompUsage.modelTokens', { input: fmtTok(m.input), output: fmtTok(m.output) })
      : '–';
    const cacheStr = m.hasTokens && m.tokensComplete && (m.cacheRead > 0 || m.cacheWrite > 0)
      ? ` · ${tr('mac.ompUsage.modelCache', { read: fmtTok(m.cacheRead), write: fmtTok(m.cacheWrite) })}`
      : '';
    const costStr = m.hasCost && m.costComplete ? fmtUsd(m.cost) : tr('mac.ompUsage.costUnknown');
    const provStr = ['recorded', 'provisional'].includes(m.provenance) ? tr(`drawer.provenance.${m.provenance}`) : '';
    const scopeStr = ['self', 'inherited', 'subtree'].includes(m.scope) ? tr(`drawer.scope.${m.scope}`) : '';
    const metaParts = [tokStr + cacheStr, costStr, provStr, scopeStr].filter(Boolean);
    row.append(
      el('code', 'omp-token-model', m.model),
      el('span', 'omp-token-vals', metaParts.join(' · '))
    );
    box.append(row);
  }
  return box;
}

let refreshing = false;
let refreshFailed = false;
let lastRenderKey = '';

function usageSummary(snap, accounts) {
  if (!snap) return { text: tr('mac.ompUsage.summaryLoading'), level: 'loading' };
  if (!snap.enabled) return { text: tr('mac.ompUsage.summaryOff'), level: 'off' };
  if (['unavailable', 'config-invalid'].includes(snap.state)) {
    return { text: tr('mac.ompUsage.summaryUnavailable'), level: 'unavailable' };
  }
  if (!accounts.length) return {
    text: tr(snap.state === 'loading' || snap.collector?.inFlight
      ? 'mac.ompUsage.summaryLoading' : 'mac.ompUsage.summaryEmpty'),
    level: snap.state === 'loading' || snap.collector?.inFlight ? 'loading' : 'unavailable',
  };
  let exhausted = 0;
  let near = 0;
  let stale = 0;
  let unavailable = 0;
  let critical = false;
  for (const acct of accounts) {
    const windows = accountWindows(acct);
    if (windows.some((w) => w.status === 'exhausted' || percent(w.usedPercent) >= 95)) critical = true;
    if (windows.some((w) => w.status === 'exhausted' || percent(w.usedPercent) === 100)) exhausted++;
    else if (windows.some((w) => percent(w.usedPercent) !== null && percent(w.usedPercent) >= 80)) near++;
    if (acct.availability === 'stale') stale++;
    else if (acct.availability !== 'ready' || !windows.some((w) => percent(w.usedPercent) !== null)) unavailable++;
  }
  const parts = [tr('mac.ompUsage.accountCount', { n: accounts.length })];
  if (exhausted) parts.push(tr('mac.ompUsage.summaryExhausted', { n: exhausted }));
  if (near) parts.push(tr('mac.ompUsage.summaryNear', { n: near }));
  if (stale) parts.push(tr('mac.ompUsage.summaryStale', { n: stale }));
  if (unavailable) parts.push(tr('mac.ompUsage.summaryUnreadable', { n: unavailable }));
  if (refreshFailed) parts.push(tr('mac.ompUsage.summaryRefreshFailed'));
  return {
    text: parts.join(' · '),
    level: critical ? 'critical' : near || stale || unavailable || refreshFailed ? 'warn' : 'normal',
  };
}

export function renderOmpUsagePanel({ resetText } = {}) {
  const snap = state.ompUsage;
  const accounts = Array.isArray(snap?.accounts)
    ? snap.accounts.filter((acct) => acct && typeof acct === 'object')
    : [];
  const summary = usageSummary(snap, accounts);
  const mini = $('omp-usage-mini');
  if (mini) mini.textContent = summary.text;
  const toggle = $('btn-omp-usage');
  if (toggle) {
    toggle.dataset.level = summary.level;
    toggle.title = `${tr('mac.ompUsage.title')} · ${summary.text}`;
  }
  const host = $('omp-usage-host');
  if (!host) return;
  const renderKey = JSON.stringify([
    snap, state.isLocal, replay.on, refreshing, refreshFailed, Math.floor(Date.now() / 30_000),
    [...sessions.values()].filter((s) => agentOf(s) === 'omp').map((s) => [s.id, s.model, s.metrics?.byProvider]),
  ]);
  // Không thay DOM trên các nhịp hoạt động không liên quan: giữ click, focus và vùng chọn để copy account.
  if (lastRenderKey === renderKey && $('omp-usage-sec')?.parentElement === host) return;
  lastRenderKey = renderKey;
  let sec = $('omp-usage-sec');
  if (!sec) {
    sec = el('section', 'omp-usage-sec');
    sec.id = 'omp-usage-sec';
  }
  if (sec.parentElement !== host) host.append(sec);
  sec.hidden = false;
  const openProviders = new Set([...sec.querySelectorAll('details.omp-tokens[open]')].map((node) => node.dataset.provider));
  const active = document.activeElement;
  const refreshHadFocus = active?.classList.contains('omp-refresh-btn') && sec.contains(active);
  const focusedProvider = active?.matches('summary.omp-tokens-head') && sec.contains(active)
    ? active.parentElement.dataset.provider : null;
  const tokenRollups = aggregateSessionProviderRollups();
  const frag = document.createDocumentFragment();
  const head = el('div', 'omp-usage-head');
  const titleWrap = el('div', 'omp-usage-title-wrap');
  const title = el('h2', 'omp-usage-title', tr('mac.ompUsage.title'));
  title.id = 'omp-usage-title';
  sec.setAttribute('aria-labelledby', title.id);
  titleWrap.append(title, el('span', 'omp-usage-subtitle', tr('mac.ompUsage.quotaHeading')));
  const obsAt = snap?.collector?.observedAt || snap?.collector?.lastSuccessAt;
  titleWrap.append(el('span', 'omp-usage-updated', typeof obsAt === 'number' && Number.isFinite(obsAt) && obsAt > 0
    ? tr('mac.ompUsage.updatedAt', { time: hhmm(obsAt) })
    : tr('mac.ompUsage.notUpdated')));
  head.append(titleWrap);

  let refreshButton;
  if (state.isLocal && snap?.enabled && !replay.on) {
    refreshButton = el('button', 'omp-refresh-btn', refreshing ? tr('mac.ompUsage.refreshing') : tr('mac.ompUsage.refresh'));
    refreshButton.type = 'button';
    // Giữ focus bàn phím trên nút làm mới khi thay snapshot.
    refreshButton.setAttribute('aria-disabled', String(refreshing));
    refreshButton.setAttribute('aria-busy', String(refreshing));
    refreshButton.addEventListener('click', async () => {
      if (refreshing || !state.isLocal || !state.ompUsage?.enabled || replay.on) return;
      refreshing = true;
      refreshFailed = false;
      renderOmpUsagePanel({ resetText });
      try {
        const q = new URLSearchParams({ refresh: '1' });
        if (TOKEN) q.set('k', TOKEN);
        const r = await fetch(`/api/omp/usage?${q}`);
        if (!r.ok) throw new Error('OMP usage refresh failed');
        const next = await r.json();
        if (!next || typeof next !== 'object' || typeof next.enabled !== 'boolean' || !Array.isArray(next.accounts)) {
          throw new Error('Invalid OMP usage snapshot');
        }
        if (state.isLocal && !replay.on) state.ompUsage = next;
      } catch {
        refreshFailed = true;
      } finally {
        refreshing = false;
        renderOmpUsagePanel({ resetText });
      }
    });
    head.append(refreshButton);
  }
  frag.append(head);
  frag.append(el('p', 'omp-source-line', tr('mac.ompUsage.source', { profile: snap?.profile || tr('mac.ompUsage.profileUnknown') })));

  const status = (text) => {
    const note = el('p', 'omp-status-note', text);
    note.setAttribute('role', 'status');
    frag.append(note);
  };
  if (!snap) status(tr('mac.ompUsage.collectorLoading'));
  else if (!snap.enabled) status(tr('mac.ompUsage.collectorOff'));
  else if (['unavailable', 'config-invalid'].includes(snap.state)) {
    status(tr('mac.ompUsage.collectorUnavailable', { reason: snap.collector?.noteCode || snap.state }));
  } else if (snap.state === 'stale') status(tr('mac.ompUsage.collectorStale'));
  else if (snap.state === 'loading' || snap.collector?.inFlight) status(tr('mac.ompUsage.collectorLoading'));
  else if (!accounts.length) status(tr('mac.ompUsage.noAccounts'));
  if (refreshFailed) status(tr('mac.ompUsage.refreshFailed'));

  const providerOrder = ['openai-codex', 'google-antigravity'];
  for (const providerId of [...accounts.map((acct) => acct.providerId || 'unknown'), ...tokenRollups.keys()]) {
    if (!providerOrder.includes(providerId)) providerOrder.push(providerId);
  }
  const providers = el('div', 'omp-providers');
  for (const providerId of providerOrder) {
    const pAccounts = accounts.filter((acct) => (acct.providerId || 'unknown') === providerId);
    const pTokens = tokenRollups.get(providerId);
    if (!pAccounts.length && !pTokens) continue;
    const pGroup = el('div', 'omp-provider-group');
    pGroup.dataset.provider = providerId;
    const pHead = el('div', 'omp-provider-head');
    pHead.append(
      el('h3', 'omp-provider-title', providerTitle(providerId)),
      el('span', 'omp-provider-count', tr('mac.ompUsage.accountCount', { n: pAccounts.length }))
    );
    pGroup.append(pHead);
    const accountGrid = el('div', 'omp-provider-accounts');
    for (const acct of pAccounts) accountGrid.append(renderAccountBlock(acct, resetText));
    if (!pAccounts.length) accountGrid.append(el('p', 'omp-acct-note', tr('mac.ompUsage.noProviderAccounts')));
    pGroup.append(accountGrid);
    if (pTokens) {
      const details = renderProviderTokenRollup(pTokens);
      details.open = openProviders.has(providerId);
      pGroup.append(details);
    }
    providers.append(pGroup);
  }
  frag.append(providers);
  sec.replaceChildren(frag);
  if (refreshHadFocus && refreshButton) refreshButton.focus({ preventScroll: true });
  else if (focusedProvider) {
    const details = [...sec.querySelectorAll('details.omp-tokens')].find((node) => node.dataset.provider === focusedProvider);
    details?.querySelector('summary')?.focus({ preventScroll: true });
  }
}
