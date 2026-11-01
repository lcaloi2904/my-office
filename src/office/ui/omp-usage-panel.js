// Additive OMP Multi-Account Usage & Session Provider Metrics panel.
// Read-only: no login, logout, account-switch, reorder, or saved-reset redemption controls.
// Isolated from Claude `state.limits` so Claude quota and account controls never mix with OMP.
import { state } from '../core/state.js';
import { $, el, hhmm, replay } from '../core/env.js';
import { agentOf, sessions } from '../people/workers.js';
import { fmtTok, fmtUsd } from './activity.js';
import { TOKEN } from '../net/live.js';
import { t as tr } from '../../i18n/index.js';

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
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return '';
  if (resetsAt <= Date.now()) return tr('mac.ompUsage.resetExpired');
  return typeof resetTextFn === 'function' ? tr('mac.plan.resets', { when: resetTextFn(resetsAt) }) : '';
}

function renderAccountWindow(container, w, resetTextFn) {
  const row = el('span', 'hl-m omp-win-row');
  row.dataset.windowId = w.id || '';
  row.dataset.sourceUnit = w.sourceUnit || 'unknown';
  const labelSpan = el('span', 'omp-win-label', String(w.label || w.id || 'Quota'));
  labelSpan.title = String(w.label || w.id || '');

  const hasPct = typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent);
  const bar = el('span', 'hl-bar');
  if (hasPct) {
    const pct = Math.min(100, Math.max(0, w.usedPercent));
    const fill = el('b', limitLevel(pct));
    fill.style.width = `${Math.min(100, Math.max(1, pct))}%`;
    bar.append(fill);
  } else {
    row.classList.add('plan-none');
  }

  // Primary value explicitly labels used vs remaining semantics, or N/A when unknown (never fake 0%)
  const valText = !hasPct
    ? tr('mac.ompUsage.windowUnknown')
    : w.sourceUnit === 'remaining' && typeof w.remainingPercent === 'number'
      ? `${Math.round(w.remainingPercent)}%`
      : `${Math.round(w.usedPercent)}%`;
  const valEl = el('em', 'omp-win-val', valText);
  if (hasPct) {
    const usedStr = tr('mac.ompUsage.usedPct', { pct: Math.round(w.usedPercent) });
    const leftStr = typeof w.remainingPercent === 'number' ? tr('mac.ompUsage.leftPct', { pct: Math.round(w.remainingPercent) }) : '';
    valEl.title = [usedStr, leftStr].filter(Boolean).join(' · ');
  }

  row.append(labelSpan, bar, valEl);
  const resetInfo = formatResetWhen(w.resetsAt, resetTextFn);
  const subParts = [];
  if (hasPct) {
    subParts.push(
      w.sourceUnit === 'remaining' && typeof w.remainingPercent === 'number'
        ? `${tr('mac.ompUsage.leftPct', { pct: Math.round(w.remainingPercent) })} (${tr('mac.ompUsage.usedPct', { pct: Math.round(w.usedPercent) })})`
        : `${tr('mac.ompUsage.usedPct', { pct: Math.round(w.usedPercent) })}${typeof w.remainingPercent === 'number' ? ` · ${tr('mac.ompUsage.leftPct', { pct: Math.round(w.remainingPercent) })}` : ''}`
    );
  }
  if (resetInfo) subParts.push(resetInfo);
  container.append(row, el('small', 'plan-reset omp-win-sub', subParts.join(' · ')));
}

function renderAccountBlock(acct, resetTextFn) {
  const block = el('div', 'omp-acct');
  block.dataset.accountKey = acct.accountKey || '';
  block.dataset.provider = acct.providerId || '';
  block.dataset.availability = acct.availability || 'unavailable';

  const head = el('div', 'omp-acct-head');
  const title = el('b', 'omp-acct-name', String(acct.label || 'OMP Account'));
  const meta = el('span', 'omp-acct-meta');
  const readTs = acct.observedAt || acct.lastSuccessAt;
  if (readTs) {
    meta.textContent = tr('mac.ompUsage.readTime', { time: hhmm(readTs) });
  }
  head.append(title, meta, availabilityBadge(acct.availability));
  block.append(head);

  const windows = Array.isArray(acct.windows) ? acct.windows : [];
  if (!windows.length) {
    const noteText =
      acct.availability === 'auth-error'
        ? tr('mac.ompUsage.accountAuthError')
        : acct.availability === 'unavailable'
          ? tr('mac.ompUsage.accountUnavailable')
          : tr('mac.ompUsage.noWindows');
    block.append(el('small', 'plan-other-note omp-acct-note', noteText));
    return block;
  }

  for (const w of windows) {
    renderAccountWindow(block, w, resetTextFn);
  }
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
  const box = el('div', 'omp-tokens');
  box.dataset.provider = group.providerId;
  const head = el('div', 'omp-tokens-head');
  const badge = el('span', 'omp-unattr-badge', tr('mac.ompUsage.unattributed'));
  badge.title = tr('mac.ompUsage.unattributedNote');
  head.append(el('span', 'omp-tokens-title', tr('mac.ompUsage.tokensHeading')), badge);
  box.append(head);

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

export function renderOmpUsagePanel({ resetText } = {}) {
  const card = $('plan-card');
  if (!card) return;
  let sec = $('omp-usage-sec');
  const foot = card.querySelector('.plan-foot');
  if (!sec) {
    sec = el('section', 'omp-usage-sec');
    sec.id = 'omp-usage-sec';
    if (foot) card.insertBefore(sec, foot);
    else card.append(sec);
  }

  const snap = state.ompUsage;
  const accounts = Array.isArray(snap?.accounts) ? snap.accounts : [];
  const tokenRollups = aggregateSessionProviderRollups();
  const hasOmpSessions = [...sessions.values()].some((s) => agentOf(s) === 'omp');
  const shouldShow = Boolean(snap?.enabled || accounts.length > 0 || tokenRollups.size > 0 || hasOmpSessions);

  sec.hidden = !shouldShow;
  if (!shouldShow) {
    sec.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  const head = el('div', 'hl-head omp-usage-head');
  const titleWrap = el('div', 'omp-usage-title-wrap');
  titleWrap.append(el('b', null, tr('mac.ompUsage.title')));
  const obsAt = snap?.collector?.observedAt || snap?.collector?.lastSuccessAt;
  if (obsAt) {
    titleWrap.append(el('span', 'pl-at', tr('mac.ompUsage.updatedAt', { time: hhmm(obsAt) })));
  }
  head.append(titleWrap);

  if (state.isLocal && snap?.enabled && !replay.on) {
    const btn = el('button', 'omp-refresh-btn', refreshing ? tr('mac.ompUsage.refreshing') : tr('mac.ompUsage.refresh'));
    btn.type = 'button';
    btn.disabled = refreshing;
    btn.addEventListener('click', async () => {
      if (refreshing) return;
      refreshing = true;
      renderOmpUsagePanel({ resetText });
      try {
        const q = new URLSearchParams({ refresh: '1' });
        if (TOKEN) q.set('k', TOKEN);
        const r = await fetch(`/api/omp/usage?${q}`);
        if (r.ok) {
          state.ompUsage = await r.json();
        }
      } catch {
        // Ignore transient offline error; collector snapshot keeps state
      } finally {
        refreshing = false;
        renderOmpUsagePanel({ resetText });
      }
    });
    head.append(btn);
  }
  frag.append(head);

  const profileLabel = snap?.profile || 'default';
  const sourceLine = el('small', 'omp-source-line', tr('mac.ompUsage.source', { profile: profileLabel }));
  frag.append(sourceLine);

  if (!snap?.enabled) {
    frag.append(el('small', 'plan-other-note omp-status-note', tr('mac.ompUsage.collectorOff')));
  } else if (snap.state === 'unavailable' || snap.state === 'config-invalid') {
    frag.append(
      el('small', 'plan-other-note omp-status-note', tr('mac.ompUsage.collectorUnavailable', { reason: snap.collector?.noteCode || snap.state }))
    );
  }

  const providerOrder = ['openai-codex', 'google-antigravity'];
  for (const p of tokenRollups.keys()) {
    if (!providerOrder.includes(p)) providerOrder.push(p);
  }

  for (const providerId of providerOrder) {
    const pAccounts = accounts.filter((a) => a.providerId === providerId);
    const pTokens = tokenRollups.get(providerId);
    if (!pAccounts.length && !pTokens) continue;

    const pGroup = el('div', 'omp-provider-group');
    pGroup.dataset.provider = providerId;
    pGroup.append(el('div', 'omp-provider-title', providerTitle(providerId)));

    for (const acct of pAccounts) {
      pGroup.append(renderAccountBlock(acct, resetText));
    }
    if (pTokens) {
      pGroup.append(renderProviderTokenRollup(pTokens));
    }
    frag.append(pGroup);
  }

  sec.replaceChildren(frag);
}
