// Public projection with a strict OMP allowlist. Claude's legacy payload is retained.
import { capabilitiesFor, ompSessionIdentity, reservedAgentId } from './schema.mjs';

const finiteNonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const safeModel = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(s) ? s : null;
const COST_SCOPES = new Set(['self', 'inherited', 'subtree']);
const PROVENANCE = new Set(['recorded', 'provisional']);

export function projectClaudeSession(session) {
  if (!session || typeof session.id !== 'string' || !session.id || reservedAgentId(session.id)) return null;
  return {
    ...session,
    agentKind: 'claude', agent: 'claude',
    // Compatibility key: Claude retains its existing public ID and restart semantics.
    sessionKey: 'claude:' + session.id,
    capabilities: capabilitiesFor('claude'),
  };
}

function ompMetrics(raw) {
  const c = raw && typeof raw === 'object' ? raw.cost : null;
  const cost = c && typeof c === 'object' && finiteNonnegative(c.value) !== null &&
    COST_SCOPES.has(c.scope) && PROVENANCE.has(c.provenance) && (c.currency == null || c.currency === 'USD')
    ? { value: c.value, currency: 'USD', scope: c.scope, provenance: c.provenance } : null;
  const t = raw && typeof raw === 'object' && raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {};
  const tokens = {
    input: finiteNonnegative(t.input), output: finiteNonnegative(t.output),
    cacheRead: finiteNonnegative(t.cacheRead), cacheWrite: finiteNonnegative(t.cacheWrite),
    provenance: PROVENANCE.has(t.provenance) ? t.provenance : 'unknown',
  };
  const cctx = raw && typeof raw === 'object' ? raw.context : null;
  const context = cctx && typeof cctx === 'object' &&
    finiteNonnegative(cctx.used) !== null && finiteNonnegative(cctx.window) > 0 &&
    PROVENANCE.has(cctx.provenance)
    ? { used: cctx.used, window: cctx.window, provenance: cctx.provenance } : null;
  return { cost, tokens, context };
}

export function projectOmpSession(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const identity = ompSessionIdentity(record.sourceNamespace, record.sourceSessionId);
  if (!identity) return null;
  // No certified runtime heartbeat or approved content access in Phase 02.
  // Drop arbitrary titles, prompts, paths, links, PIDs, accounts and capabilities.
  return {
    ...identity, agentKind: 'omp', agent: 'omp',
    name: 'OMP ' + identity.id.slice(4, 12), title: '', dir: '', origin: 'OMP',
    pid: null, link: null, acct: null, desk: -1, status: 'unknown',
    lifecycle: 'unknown', activity: 'unknown', connection: 'unknown',
    taskStart: 0, counts: { read: 0, edit: 0, cmd: 0, web: 0 },
    subs: [], doneSubs: [], last: null, lastPrompt: '',
    lastAt: finiteNonnegative(record.observedAt) ?? 0,
    usage: null, model: safeModel(record.model), metrics: ompMetrics(record.metrics),
    projectKey: null, worktreeKey: null, capabilities: capabilitiesFor('omp'),
  };
}

export function projectAgentSession(kind, record) {
  return kind === 'claude' ? projectClaudeSession(record) :
    kind === 'omp' ? projectOmpSession(record) : null;
}
