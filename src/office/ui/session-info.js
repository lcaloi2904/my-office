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
