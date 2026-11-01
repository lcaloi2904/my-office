// Presentation of additive agent evidence. No raw provider schema or account inference here.
import { el } from '../core/env.js';
import { agentOf, claudeCost, contextPercent } from '../people/workers.js';
import { t as tr } from '../../i18n/index.js';

export const projectLabel = (s) => s?.project || s?.git?.repo || String(s?.dir || '').split(/[\\/]/).filter(Boolean).pop() || '';
const numeric = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const provenance = (p) => p === 'recorded' || p === 'provisional';
export function sessionMetricView(s) {
  const kind = agentOf(s);
  if (kind === 'claude') {
    const pct = contextPercent(s), u = s.usage;
    return { cost: claudeCost(s), context: pct === null ? null : { used: u.ctx, window: u.ctxMax, pct }, costNote: tr('drawer.priceNote') };
  }
  if (kind !== 'omp') return { cost: null, context: null, costNote: tr('drawer.metricsUnavailable') };
  const costEvidence = s.metrics?.cost, contextEvidence = s.metrics?.context;
  const cost = costEvidence && numeric(costEvidence.value) && provenance(costEvidence.provenance)
    && ['self', 'inherited', 'subtree'].includes(costEvidence.scope) ? costEvidence.value : null;
  const pct = contextEvidence && numeric(contextEvidence.used) && numeric(contextEvidence.window) && contextEvidence.window > 0
    ? Math.round(contextEvidence.used / contextEvidence.window * 100) : null;
  const context = Number.isFinite(pct) && provenance(contextEvidence.provenance)
    ? { used: contextEvidence.used, window: contextEvidence.window, provenance: contextEvidence.provenance, pct } : null;
  return { cost, context,
    costNote: cost === null ? tr('drawer.metricsUnavailable') : tr('drawer.costEvidence', {
      scope: tr('drawer.scope.' + costEvidence.scope), provenance: tr('drawer.provenance.' + costEvidence.provenance),
    }) };
}
export function sessionEvidence(s) {
  if (s?.persistedOnly === true) return 'persisted';
  if (s?.lifecycle === 'ended') return 'ended';
  if (s?.connection === 'stale' || s?.connection === 'disconnected') return s.connection;
  if (s?.eventGap === true) return 'unknown';
  return s?.connection === 'connected' ? 'runtime' : 'unknown';
}
export function appendSessionBadges(node, s) {
  if (agentOf(s) !== 'claude') {
    const evidence = sessionEvidence(s), badge = el('span', 'session-evidence', tr('drawer.evidence.' + evidence));
    badge.dataset.evidence = evidence; node.append(badge);
    if (agentOf(s) === 'omp' && typeof s?.provider === 'string' && s.provider) {
      const pBadge = el('span', 'session-evidence session-provider', s.provider);
      pBadge.dataset.provider = s.provider;
      node.append(pBadge);
    }
  }
  if (s.worktreeKey) {
    const chip = el('span', 'session-worktree', tr('drawer.worktree', { key: s.worktreeKey.slice(0, 7) }));
    chip.title = tr('drawer.worktreeNote'); node.append(chip);
  }
  if (s.actorOverflow?.root || s.actorOverflow?.children > 0) node.append(el('span', 'session-evidence', tr('drawer.actorOverflow')));
}
export function counterNote(s) {
  return agentOf(s) === 'omp' ? tr('drawer.counterEvidence') : '';
}
export function childState(x) {
  if (x.tombstoned === true) return tr('drawer.tombstoneState');
  if (['parked', 'ended', 'aborted', 'unknown'].includes(x.lifecycle)) return tr('drawer.childState.' + x.lifecycle);
  if (x.persistedOnly === true || x.lifecycle === 'historical') return tr('drawer.persistedState');
  return x.endedAt ? tr('drawer.done') : tr('drawer.working');
}
export function renderSessionProviderBreakdown(s, { fmtTok, fmtUsd } = {}) {
  if (agentOf(s) !== 'omp') return null;
  const buckets = Array.isArray(s?.metrics?.byProvider) ? s.metrics.byProvider : [];
  if (!buckets.length) return null;
  const box = el('div', 'ds-omp-metrics');
  const head = el('div', 'ds-omp-metrics-head');
  head.append(
    el('span', 'ds-omp-metrics-title', tr('drawer.ompMetrics.title')),
    el('span', 'omp-unattr-badge', tr('drawer.ompMetrics.unattributed'))
  );
  box.append(head);
  for (const b of buckets) {
    if (!b || typeof b !== 'object') continue;
    const provId = b.providerId || 'unknown';
    const models = Array.isArray(b.models) && b.models.length
      ? b.models
      : [{ model: s.model || 'unknown', cost: b.cost, tokens: b.tokens }];
    for (const m of models) {
      const row = el('div', 'ds-omp-metric-row');
      row.dataset.provider = provId;
      row.dataset.model = m.model || 'unknown';
      const t = m.tokens || {};
      const tokStr = numeric(t.input) && numeric(t.output) && typeof fmtTok === 'function'
        ? tr('drawer.ompMetrics.tokensInOut', { input: fmtTok(t.input), output: fmtTok(t.output) })
        : tr('drawer.ompMetrics.costUnavailable');
      const cacheStr = numeric(t.cacheRead) && numeric(t.cacheWrite) && (t.cacheRead > 0 || t.cacheWrite > 0) && typeof fmtTok === 'function'
        ? ` · ${tr('drawer.ompMetrics.cacheReadWrite', { read: fmtTok(t.cacheRead), write: fmtTok(t.cacheWrite) })}`
        : '';
      const costVal = m.cost && numeric(m.cost.value) && provenance(m.cost.provenance) && typeof fmtUsd === 'function'
        ? fmtUsd(m.cost.value)
        : tr('drawer.ompMetrics.costUnavailable');
      const provStr = provenance(t.provenance) ? tr('drawer.provenance.' + t.provenance) : '';
      const scopeStr = m.cost && ['self', 'inherited', 'subtree'].includes(m.cost.scope) ? tr('drawer.scope.' + m.cost.scope) : '';
      row.append(
        el('code', 'ds-omp-metric-key', `${provId} / ${m.model || 'unknown'}`),
        el('span', 'ds-omp-metric-val', [tokStr + cacheStr, costVal, provStr, scopeStr].filter(Boolean).join(' · '))
      );
      box.append(row);
    }
  }
  return box;
}
