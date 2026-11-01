// Public projection with a strict OMP allowlist. Claude's legacy payload is retained.
import { capabilitiesFor, ompCapabilities, ompSessionIdentity, reservedAgentId } from './schema.mjs';

const finiteNonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const safeModel = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(s) ? s : null;
const safeProvider = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(s) ? s.toLowerCase() : null;
const COST_SCOPES = new Set(['self', 'inherited', 'subtree']);
const PROVENANCE = new Set(['recorded', 'provisional']);
export function projectClaudeSession(session) {
  if (!session || typeof session.id !== 'string' || !session.id || reservedAgentId(session.id)) return null;
  return {
    ...session,
    agentKind: 'claude', agent: 'claude',
    // Compatibility key: Claude retains its existing public ID and restart semantics.
    sessionKey: 'claude:' + session.id,
    projectKey: HEX64.test(session.projectKey) ? session.projectKey : null,
    worktreeKey: HEX64.test(session.worktreeKey) ? session.worktreeKey : null,
    capabilities: capabilitiesFor('claude'),
  };
}

function sanitizeCost(c) {
  return c && typeof c === 'object' && finiteNonnegative(c.value) !== null &&
    COST_SCOPES.has(c.scope) && PROVENANCE.has(c.provenance) && (c.currency == null || c.currency === 'USD')
    ? { value: c.value, currency: 'USD', scope: c.scope, provenance: c.provenance } : null;
}
function sanitizeTokens(t) {
  const src = t && typeof t === 'object' ? t : {};
  return {
    input: finiteNonnegative(src.input), output: finiteNonnegative(src.output),
    cacheRead: finiteNonnegative(src.cacheRead), cacheWrite: finiteNonnegative(src.cacheWrite),
    provenance: PROVENANCE.has(src.provenance) ? src.provenance : 'unknown',
  };
}
function sanitizeByProvider(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const b of rawList.slice(0, 16)) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const providerId = safeProvider(b.providerId) || 'unknown';
    const models = Array.isArray(b.models) ? b.models.slice(0, 32).filter((m) => m && typeof m === 'object' && !Array.isArray(m)).map((m) => ({
      model: safeModel(m.model) || 'unknown',
      entries: count(m.entries),
      cost: sanitizeCost(m.cost),
      tokens: sanitizeTokens(m.tokens),
    })) : [];
    out.push({
      providerId,
      accountKey: null,
      attribution: 'unattributed',
      entries: count(b.entries),
      incomplete: b.incomplete === true,
      cost: sanitizeCost(b.cost),
      tokens: sanitizeTokens(b.tokens),
      models,
    });
  }
  return out;
}
function ompMetrics(raw) {
  const cost = sanitizeCost(raw?.cost);
  const tokens = sanitizeTokens(raw?.tokens);
  const cctx = raw && typeof raw === 'object' ? raw.context : null;
  const context = cctx && typeof cctx === 'object' &&
    finiteNonnegative(cctx.used) !== null && finiteNonnegative(cctx.window) > 0 &&
    PROVENANCE.has(cctx.provenance)
    ? { used: cctx.used, window: cctx.window, provenance: cctx.provenance } : null;
  const byProvider = sanitizeByProvider(raw?.byProvider);
  return { cost, tokens, context, byProvider };
}

const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
const READER_STATES = new Set(['loading', 'refreshing', 'ready', 'absent', 'degraded', 'unsupported']);
const HEX64 = /^[0-9a-f]{64}$/;
// A display basename and opaque keys. Never prompts, titles, paths or output.
function projectFields(record) {
  const name = typeof record.project === 'string' ? record.project.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) : '';
  return { name: name || null,
    projectKey: HEX64.test(record.projectKey) ? record.projectKey : null, worktreeKey: HEX64.test(record.worktreeKey) ? record.worktreeKey : null };
}
// Persisted facts: counts from history.
function persistedFields(record) {
  const c = record.counts && typeof record.counts === 'object' ? record.counts : {};
  return {
    ...projectFields(record), persistedOnly: true, lifecycle: 'historical',
    readerState: READER_STATES.has(record.readerState) ? record.readerState : 'loading', incomplete: record.incomplete === true,
    counts: { read: count(c.read), edit: count(c.edit), cmd: count(c.cmd), web: count(c.web) },
  };
}

const ACTIVITIES = new Set(['active', 'waiting', 'idle', 'unknown']);
const CONNECTIONS = new Set(['connected', 'stale', 'disconnected']);
const OUTCOMES = new Set(['success', 'error', 'aborted', 'unknown']);
const TOOL_KINDS = new Set(['read', 'edit', 'cmd', 'web', 'other']);
// Only a fresh, connected runtime maps onto the legacy work/wait/rest axis. Stale or ended never claims to be resting.
const LEGACY_STATUS = { active: 'work', waiting: 'wait', idle: 'rest' };
function liveFields(live) {
  if (!live || typeof live !== 'object') return null;
  const connection = CONNECTIONS.has(live.connection) ? live.connection : 'disconnected';
  const ended = live.lifecycle === 'ended';
  const activity = !ended && connection === 'connected' && live.gap !== true && ACTIVITIES.has(live.activity) ? live.activity : 'unknown';
  return {
    persistedOnly: false, lifecycle: ended ? 'ended' : 'open', activity, connection,
    status: LEGACY_STATUS[activity] || 'unknown',
    taskStart: (activity === 'active' || activity === 'waiting') ? (finiteNonnegative(live.taskStart) ?? 0) : 0,
    lastTurnOutcome: OUTCOMES.has(live.lastTurnOutcome) ? live.lastTurnOutcome : 'unknown',
    pendingTools: count(live.pendingTools),
    toolCategories: Array.isArray(live.toolCategories) ? live.toolCategories.filter((k) => TOOL_KINDS.has(k)).slice(0, 5) : [],
    waitReasons: Array.isArray(live.waitReasons) ? live.waitReasons.filter((k) => k === 'approval' || k === 'input').slice(0, 2) : [],
    eventGap: live.gap === true,
  };
}

const CHILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
function childFields(record, rootKey) {
  const input = Array.isArray(record.children) ? record.children : [], children = [], seen = new Set();
  for (const child of input.slice(0, 128)) {
    if (!child || !CHILD_ID.test(child.id) || seen.has(child.id) || child.rootSessionKey !== rootKey ||
      child.relationKind !== 'subagent' || child.agentKey !== JSON.stringify([rootKey, child.id])) continue;
    const parent = child.parentAgentKey;
    // Accept only this root or a namespaced child tuple. Never use transcript entry.parentId for lineage.
    let validParent = parent === rootKey;
    if (!validParent && typeof parent === 'string') {
      try { const tuple = JSON.parse(parent); validParent = Array.isArray(tuple) && tuple.length === 2 && tuple[0] === rootKey && CHILD_ID.test(tuple[1]) && tuple[1] !== child.id; } catch { /* invalid parent */ }
    }
    if (!validParent) continue;
    seen.add(child.id);
    children.push({ id: child.id, agentKey: child.agentKey, rootSessionKey: rootKey, parentAgentKey: parent,
      relationKind: 'subagent', type: 'task', desc: '', last: null, steps: 0, status: 'unknown', persistedOnly: true,
      lifecycle: 'historical', tombstoned: child.tombstoned === true,
      startedAt: finiteNonnegative(child.startedAt) ?? 0, endedAt: null });
  }
  const byKey = new Map(children.map((c) => [c.agentKey, c]));
  const valid = children.filter((child) => {
    const visited = new Set([child.agentKey]);
    let parent = child.parentAgentKey;
    while (parent !== rootKey) {
      if (visited.has(parent) || !byKey.has(parent)) return false;
      visited.add(parent); parent = byKey.get(parent).parentAgentKey;
    }
    return true;
  });
  return { subs: valid, doneSubs: [],
    childrenIncomplete: record.childrenIncomplete === true || input.length > 128 || valid.length !== input.length,
    childSupport: { task: 'persisted', nested: 'bounded', advisor: 'unsupported', liveChildren: 'unsupported' } };
}

export function projectOmpSession(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const identity = ompSessionIdentity(record.sourceNamespace, record.sourceSessionId);
  if (!identity) return null;
  // No certified runtime heartbeat or approved content access in Phase 02.
  // Drop arbitrary titles, prompts, paths, links, PIDs, accounts and capabilities.
  const live = liveFields(record.live);
  // A live row that also has a file keeps the file's counts and project; its liveness comes only from the runtime.
  const persisted = record.persistedOnly === true || record.filePersisted === true ? persistedFields(record) : null;
  const c = record.counts && typeof record.counts === 'object' ? record.counts : {};
  const base = {
    ...identity, agentKind: 'omp', agent: 'omp',
    name: 'OMP ' + identity.id.slice(4, 12), title: '', dir: '', origin: 'OMP',
    pid: null, link: null, acct: null, desk: -1, status: 'unknown',
    lifecycle: 'unknown', activity: 'unknown', connection: 'unknown',
    taskStart: 0, counts: { read: count(c.read), edit: count(c.edit), cmd: count(c.cmd), web: count(c.web) },
    ...childFields(record, identity.sessionKey), last: null, lastPrompt: '',
    lastAt: finiteNonnegative(record.observedAt) ?? 0,
    usage: null, model: safeModel(record.model), provider: safeProvider(record.provider), metrics: ompMetrics(record.metrics),
    projectKey: null, worktreeKey: null, capabilities: capabilitiesFor('omp'),
  };
  if (!persisted && !live) return base;
  const named = persisted ?? projectFields(record);
  return { ...base, ...named, ...live, name: named.name ? named.name : base.name,
    capabilities: ompCapabilities(record.conversation && persisted ? record.conversation : false) };
}

export function projectAgentSession(kind, record) {
  return kind === 'claude' ? projectClaudeSession(record) :
    kind === 'omp' ? projectOmpSession(record) : null;
}
