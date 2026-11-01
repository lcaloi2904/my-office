// Ephemeral runtime evidence. File transcripts remain the authority for history and durable usage.
// Every key is a logical OMP conversation; an instance/generation owns its own sequence and tools.
// Liveness uses the time this server received an event, never the producer's wall clock.
import { ompSessionIdentity } from '../schema.mjs';
import { provisionalUsage } from './usage.mjs';
import { deriveLiveActivitySummary } from './activity-summary.mjs';
const MAX_SESSIONS = 128, MAX_TOOLS = 96, MAX_REORDER = 16, MAX_RETIRED = 16;
const STALE_MS = 30_000, DISCONNECTED_MS = 90_000, RETAIN_MS = 15 * 60_000;
const DIAGNOSTIC_LIMIT = 32;
const terminal = new Set(['completed', 'error', 'aborted']);
const START = new Set(['session_start', 'snapshot']);

export function createOmpLifecycle({ now = Date.now, onChange = () => {}, staleMs = STALE_MS,
  disconnectedMs = DISCONNECTED_MS, retainMs = RETAIN_MS } = {}) {
  const sessions = new Map(), diagnostics = new Set();
  let disposed = false;
  const issue = (code) => { if (diagnostics.size < DIAGNOSTIC_LIMIT) diagnostics.add(code); };
  const runtimeKey = (e) => e.runtimeInstanceId + ':' + e.generation;
  const running = (s) => [...s.tools.values()].filter((t) => t.phase === 'running');
  const snapshot = (s) => {
    const base = {
      sourceNamespace: s.sourceId, sourceSessionId: s.sessionId, runtimeInstanceId: s.runtimeInstanceId,
      generation: s.generation, sequence: s.sequence, lifecycle: s.ended ? 'ended' : 'open',
      activity: s.activity, connection: s.connection, lastTurnOutcome: s.lastTurnOutcome,
      pendingTools: running(s).length, toolCategories: [...new Set(running(s).map((t) => t.category))].sort(),
      waitReasons: [...new Set(s.waiting.values())].sort(), pendingMessages: s.pendingMessages,
      pendingJobs: s.pendingJobs, observedAt: s.observedAt,
      model: s.model, provider: s.provider, metrics: s.metrics, counts: { ...s.counts }, taskStart: s.taskStart, persistedOnly: false, gap: s.gap,
      summarySource: 'observerCategory',
    };
    return { ...base, activitySummary: deriveLiveActivitySummary(base, { allowSubject: false, now: s.observedAt }) };
  };
  // A heartbeat that changes nothing visible must not wake every client.
  const signature = (s) => { const { observedAt, sequence, activitySummary, ...rest } = snapshot(s); void observedAt; void sequence; return JSON.stringify({ ...rest, summary: activitySummary ? [activitySummary.kind, activitySummary.safeSubject || ''] : null }); };
  const changed = (id, s) => {
    const sig = s ? signature(s) : null;
    if (s && s.sig === sig) return;
    if (s) s.sig = sig;
    try { onChange([id]); } catch { /* an observer must never affect the lifecycle */ }
  };
  const activityOf = (s) => {
    if (s.ended || s.connection !== 'connected') return 'unknown';
    if (s.waiting.size) return 'waiting';
    if (running(s).length || s.inTurn || s.pendingJobs > 0) return 'active';
    return s.isIdle === true && s.pendingMessages === 0 ? 'idle' : s.isIdle === false ? 'active' : 'unknown';
  };
  const setActivity = (s) => {
    s.activity = activityOf(s);
    if (s.activity === 'active' || s.activity === 'waiting') s.taskStart ||= s.observedAt;
    else s.taskStart = 0;
  };
  const countTool = (s, id, category) => {
    if (!id || s.countedTools.has(id)) return;
    if (s.countedTools.size >= 4096) s.countedTools.clear();
    s.countedTools.add(id);
    if (Object.hasOwn(s.counts, category)) s.counts[category]++;
  };
  const newSession = (e) => ({
    sourceId: e.sourceId, sessionId: e.sessionId, runtimeInstanceId: e.runtimeInstanceId,
    generation: e.generation, sequence: 0, observedAt: now(), connection: 'connected',
    ended: false, inTurn: false, isIdle: null, lastTurnOutcome: 'unknown',
    pendingMessages: 0, pendingJobs: 0, waiting: new Map(), tools: new Map(), reorder: new Map(),
    counts: { read: 0, edit: 0, cmd: 0, web: 0 }, countedTools: new Set(), taskStart: 0,
    retired: [], gap: false, activity: 'unknown', model: null, provider: null, providersSeen: new Set(), metrics: null, sig: null,
  });
  const applyOne = (s, e) => {
    const d = e.data, at = now();
    s.observedAt = at; s.connection = 'connected';
    if (e.type === 'snapshot' || e.type === 'session_start' || e.type === 'heartbeat') {
      if (typeof d.isIdle === 'boolean') s.isIdle = d.isIdle;
      if (d.pendingMessages !== null) s.pendingMessages = d.pendingMessages;
      if (d.pendingJobs !== null) s.pendingJobs = d.pendingJobs;
      if (d.model) s.model = d.model;
      if (d.provider) { s.provider = d.provider; if (s.providersSeen.size < 8) s.providersSeen.add(d.provider); }
      if (d.metrics) {
        // If multiple providers were observed during one runtime session, a cumulative runtime snapshot cannot be
        // attributed to a single provider without per-entry JSONL evidence: keep its provider bucket 'unknown'.
        if (s.providersSeen.size > 1 && Array.isArray(d.metrics.byProvider) && d.metrics.byProvider[0]) {
          s.metrics = provisionalUsage({
            input: d.metrics.tokens?.input,
            output: d.metrics.tokens?.output,
            cacheRead: d.metrics.tokens?.cacheRead,
            cacheWrite: d.metrics.tokens?.cacheWrite,
            cost: d.metrics.cost?.value,
          }, { provider: 'unknown', model: null });
        } else {
          s.metrics = d.metrics;
        }
      }
      if (e.type === 'heartbeat') {
        // An idle runtime cannot have a running tool or an open turn: a lost end event must not stay "active" forever.
        if (d.isIdle === true) {
          s.inTurn = false;
          for (const [id, t] of s.tools) if (t.phase === 'running') { s.tools.delete(id); issue('tool-reconciled'); s.gap = true; }
        }
      } else {
        s.ended = false;
        if (d.waitReasons) {
          s.waiting.clear();
          for (let i = 0; i < d.waitReasons.length; i++) s.waiting.set('snapshot:' + i, d.waitReasons[i]);
        }
        // A reconnect snapshot replaces uncertain pending tool state. No historical animation is emitted.
        if (e.type === 'snapshot') {
          s.tools.clear();
          for (const t of d.tools || []) { s.tools.set(t.id, { phase: 'running', category: t.category, at }); countTool(s, t.id, t.category); }
          if (d.isIdle === true) s.inTurn = false;
        }
      }
    } else if (e.type === 'turn_start') { s.inTurn = true; s.isIdle = false; s.ended = false; }
    else if (e.type === 'turn_end') {
      s.inTurn = false; s.lastTurnOutcome = d.outcome || 'unknown';
      if (running(s).length === 0 && s.pendingJobs === 0) s.isIdle = true;
    } else if (e.type === 'tool_start' || e.type === 'tool_end') {
      const prev = s.tools.get(d.toolCallId);
      const cat = prev?.category || d.category || 'other';
      countTool(s, d.toolCallId, cat);
      if (e.type === 'tool_end') {
        // The first terminal state wins: a duplicate end must not turn an error into a success.
        if (!prev || !terminal.has(prev.phase)) {
          s.tools.set(d.toolCallId, { category: cat, phase: d.phase || 'completed', at });
        }
      } else if (!prev) {
        s.tools.set(d.toolCallId, { category: cat, phase: 'running', at });
      }
      while (s.tools.size > MAX_TOOLS) {
        const firstTerminal = [...s.tools].find(([, t]) => terminal.has(t.phase));
        if (!firstTerminal) { s.tools.delete(s.tools.keys().next().value); issue('tool-limit'); s.gap = true; }
        else s.tools.delete(firstTerminal[0]);
      }
    } else if (e.type === 'approval_requested') {
      if (s.waiting.size < MAX_TOOLS) s.waiting.set(d.requestId, 'approval');
    } else if (e.type === 'approval_resolved') s.waiting.delete(d.requestId);
    else if (e.type === 'input_requested') {
      if (s.waiting.size < MAX_TOOLS) s.waiting.set(d.requestId, 'input');
    } else if (e.type === 'input_resolved') s.waiting.delete(d.requestId);
    else if (e.type === 'session_end') {
      s.ended = true; s.inTurn = false; s.isIdle = null;
      s.tools.clear(); s.waiting.clear(); s.metrics = null; s.taskStart = 0;
    }
    s.sequence = e.sequence;
    setActivity(s);
  };
  function ingest(e) {
    if (disposed) return { ok: false, code: 'disposed' };
    const identity = ompSessionIdentity(e.sourceId, e.sessionId);
    if (!identity) return { ok: false, code: 'invalid-identity' };
    const id = identity.id, key = runtimeKey(e);
    let s = sessions.get(id);
    if (s && runtimeKey(s) !== key) {
      const sameInstance = s.runtimeInstanceId === e.runtimeInstanceId;
      if (s.retired.includes(key) || (sameInstance && e.generation < s.generation)) return { ok: false, code: 'old-generation' };
      if (!START.has(e.type)) return { ok: false, code: 'unknown-generation' };
      // A different process claiming a conversation that is still talking to us is a conflict, not a takeover.
      if (!sameInstance && !s.ended && now() - s.observedAt < staleMs) {
        issue('runtime-conflict'); return { ok: false, code: 'runtime-conflict' };
      }
      const retired = [...s.retired, runtimeKey(s)].slice(-MAX_RETIRED);
      s = newSession(e); s.retired = retired; sessions.set(id, s);
    } else if (!s) {
      if (!START.has(e.type)) return { ok: false, code: 'snapshot-required' };
      if (sessions.size >= MAX_SESSIONS) {
        const old = [...sessions].find(([, x]) => x.ended || x.connection === 'disconnected');
        if (!old) { issue('session-limit'); return { ok: false, code: 'session-limit' }; }
        sessions.delete(old[0]); changed(old[0], null);
      }
      s = newSession(e); sessions.set(id, s);
    }
    // Any valid event from the current runtime, even a retry or a buffered one, proves the producer is alive.
    if (!s.ended) { s.observedAt = now(); if (s.connection !== 'connected') { s.connection = 'connected'; setActivity(s); } }
    if (e.sequence <= s.sequence || s.reorder.has(e.sequence)) { changed(id, s); return { ok: true, ack: s.sequence, duplicate: true }; }
    if (e.sequence !== s.sequence + 1) {
      // A reconnect snapshot is authoritative for *volatile* state, even when intermediate events were lost.
      if (e.type === 'snapshot' || e.sequence - s.sequence > MAX_REORDER || s.reorder.size >= MAX_REORDER) {
        issue('sequence-gap'); s.gap = true; s.reorder.clear(); s.sequence = e.sequence - 1;
      } else {
        s.reorder.set(e.sequence, e);
        return { ok: true, ack: s.sequence, buffered: true };
      }
    }
    applyOne(s, e);
    while (s.reorder.has(s.sequence + 1)) {
      const next = s.reorder.get(s.sequence + 1); s.reorder.delete(next.sequence);
      applyOne(s, next);
    }
    changed(id, s);
    return { ok: true, ack: s.sequence, gap: s.gap };
  }
  function sweep() {
    if (disposed) return;
    for (const [id, s] of sessions) {
      const age = Math.max(0, now() - s.observedAt);
      if (age > disconnectedMs + retainMs || (s.ended && age > retainMs)) {
        sessions.delete(id); changed(id, null); continue;
      }
      const connection = s.ended ? 'disconnected' : age >= disconnectedMs ? 'disconnected'
        : age >= staleMs ? 'stale' : 'connected';
      if (connection !== s.connection) { s.connection = connection; setActivity(s); changed(id, s); }
    }
  }
  return {
    ingest, sweep, has: (id) => !disposed && sessions.has(id),
    ids: () => disposed ? [] : [...sessions.keys()],
    list: () => disposed ? [] : [...sessions.values()].map(snapshot),
    resolve: (id) => disposed ? null : sessions.has(id) ? snapshot(sessions.get(id)) : null,
    diagnostics: () => [...diagnostics],
    status: () => ({ instances: sessions.size, buffered: [...sessions.values()].reduce((n, s) => n + s.reorder.size, 0) }),
    dispose() { disposed = true; sessions.clear(); diagnostics.clear(); },
  };
}
