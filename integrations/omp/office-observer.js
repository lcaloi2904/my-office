// My Office observer for OMP: reports which sessions are open and what they are doing. Read-only telemetry.
//
// Not installed anywhere by this repository. Loading it into OMP is a decision for the person who runs OMP.
// Rules this file keeps:
//  - handlers only copy a few fields into a bounded queue and return; they never await the network (R11);
//  - nothing leaves the process except ids, tool categories, counts and timings (no prompts, args, results, paths, env);
//  - every failure is swallowed: My Office being offline or slow must not change what OMP does;
//  - all state belongs to one factory binding; nothing is module-global.
//
// Event names follow the OMP source pinned in plans/.../evidence.md (6a86df85…). That the installed build emits each of
// them, in this order, is NOT verified here: see README.md for the support matrix.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DEFAULTS = Object.freeze({
  url: 'http://127.0.0.1:4310/ingest/omp/v1', heartbeatMs: 10_000, flushMs: 50, timeoutMs: 3000,
  maxQueue: 64, maxBytes: 48 * 1024, maxBatch: 16, maxPending: 96, baseBackoffMs: 1000, maxBackoffMs: 60_000, maxAttempts: 8,
});
const CATEGORY = new Map(Object.entries({ read: 'read', grep: 'read', find: 'read', ls: 'read', glob: 'read',
  edit: 'edit', write: 'edit', bash: 'cmd', web_search: 'web', fetch: 'web' }));
const idOf = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : null;
const num = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// Settings file for a permanent install, so the token does not have to live in every process's environment:
// {"sourceId": "...", "token": "...", "url": "http://127.0.0.1:4310/ingest/omp/v1"}. Environment variables win over it.
function readSettingsFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 4096) return {};
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

function defaultTransport({ url, token, fetchImpl }) {
  return {
    async send(body, { signal }) {
      const res = await fetchImpl(url, { method: 'POST', signal, body: JSON.stringify(body),
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
      let json = null;
      try { json = await res.json(); } catch { /* an unreadable body is only less information */ }
      return { status: res.status, json };
    },
  };
}

// createOfficeObserver(options) -> factory(pi). `options` is for tests and for hosts that want to configure it in code;
// by default it reads OFFICE_OMP_URL, OFFICE_OMP_TOKEN and OFFICE_OMP_SOURCE and does nothing if the token is missing.
export function createOfficeObserver(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const cfg = { ...DEFAULTS, ...options.limits };
  const needFile = !(options.token ?? env.OFFICE_OMP_TOKEN) || !(options.sourceId ?? env.OFFICE_OMP_SOURCE);
  const settings = needFile ? (options.settings ?? readSettingsFile(env.OFFICE_OMP_OBSERVER_CONFIG || path.join(attempt(() => os.homedir(), ''), '.omp', 'office-observer.json'))) : {};
  const str = (v) => typeof v === 'string' ? v : undefined;
  const url = options.url ?? env.OFFICE_OMP_URL ?? str(settings.url) ?? DEFAULTS.url;
  const token = options.token ?? env.OFFICE_OMP_TOKEN ?? str(settings.token) ?? '';
  const sourceId = options.sourceId ?? env.OFFICE_OMP_SOURCE ?? str(settings.sourceId) ?? '';
  const setTimer = options.setTimer ?? setTimeout, clearTimer = options.clearTimer ?? clearTimeout;
  const random = options.random ?? Math.random;
  const newId = options.newId ?? (() => attempt(() => globalThis.crypto.randomUUID(), String(Math.random()).slice(2) + Date.now().toString(36)));
  const enabled = /^[0-9a-f]{64}$/.test(token) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(sourceId)
    && attempt(() => LOOPBACK.has(new URL(url).hostname) && new URL(url).protocol === 'http:', false);   // (no cross-host transport)
  const transport = options.transport ?? (enabled && typeof fetch === 'function' ? defaultTransport({ url, token, fetchImpl: options.fetch ?? fetch }) : null);
  const bindings = new Set();

  function factory(pi) {
    if (!enabled || !transport || !pi || typeof pi.on !== 'function') return;
    const b = bind(pi);
    bindings.add(b);
  }

  function bind(pi) {
    const runtimeInstanceId = String(newId()).slice(0, 96);
    const s = { sessionId: null, generation: 0, seq: 0, queue: [], bytes: 0, ctx: null, pendingTools: new Map(), waiting: new Map(),
      timer: null, heartbeat: null, sending: false, inflight: new Set(), controller: null, attempts: 0, disabled: false, closed: false, superseded: false, needSnapshot: false };

    const clearTimers = () => {
      if (s.timer) { clearTimer(s.timer); s.timer = null; }
      if (s.heartbeat) { clearTimer(s.heartbeat); s.heartbeat = null; }
    };
    const stop = () => {
      s.closed = true; clearTimers();
      try { s.controller?.abort(); } catch { /* nothing in flight */ }
      s.queue.length = 0; s.bytes = 0; s.pendingTools.clear(); s.waiting.clear(); s.ctx = null;
    };

    // ---- state read from the host, defensively: any of these may be missing in a given OMP build ----
    const sessionIdOf = (ctx) => idOf(attempt(() => ctx?.sessionManager?.getSessionId?.(), null), 256);
    const isSub = (ctx) => attempt(() => ctx?.agent?.kind === 'sub', false);
    const runtimeState = (ctx) => {
      const out = {};
      const idle = attempt(() => ctx?.isIdle?.(), undefined);
      if (typeof idle === 'boolean') out.isIdle = idle;
      const pending = attempt(() => ctx?.hasPendingMessages?.(), undefined);
      if (typeof pending === 'boolean') out.pendingMessages = pending ? 1 : 0;   // (a flag, not a count)
      const jobs = attempt(() => ctx?.getAsyncJobSnapshot?.(), undefined);
      const jobCount = count(Array.isArray(jobs) ? jobs.length : jobs?.running ?? jobs?.count);
      if (jobCount !== null) out.pendingJobs = jobCount;
      const model = attempt(() => { const m = ctx?.model; return typeof m === 'string' ? m : m?.id; }, undefined);
      if (typeof model === 'string') out.model = model.slice(0, 96);
      const u = attempt(() => ctx?.sessionManager?.getUsageStatistics?.(), undefined);
      if (u && typeof u === 'object') {
        const usage = { input: num(u.input), output: num(u.output), cacheRead: num(u.cacheRead), cacheWrite: num(u.cacheWrite), cost: num(u.cost) };
        if (Object.values(usage).some((v) => v !== undefined)) out.usage = usage;
      }
      return out;
    };

    // ---- the queue ----
    const size = (item) => 160 + JSON.stringify(item.data).length;
    function enqueue(type, data = {}, { replaceTail = false } = {}) {
      if (s.closed || s.disabled || s.superseded || !s.sessionId) return;
      const tail = s.queue[s.queue.length - 1];
      let item;
      if (replaceTail && tail && tail.type === type && tail.generation === s.generation && !s.inflight.has(tail)) {
        // a not-yet-sent heartbeat is replaced by a newer one and keeps its sequence number: no gap, no growth
        s.bytes -= size(tail); item = { ...tail, data }; s.queue[s.queue.length - 1] = item;
      } else {
        item = { sessionId: s.sessionId, runtimeInstanceId, generation: s.generation, sequence: ++s.seq, type, data };
        s.queue.push(item);
      }
      s.bytes += size(item);
      if (s.queue.length > cfg.maxQueue || s.bytes > cfg.maxBytes) {
        // Overloaded or offline for long: forget the backlog and say where things stand instead of growing.
        s.queue.length = 0; s.bytes = 0; snapshotNow();
      }
      schedule(cfg.flushMs);
    }
    function snapshotNow() {
      if (!s.sessionId) return;
      const data = { ...runtimeState(s.ctx), waitReasons: [...s.waiting.values()],
        tools: [...s.pendingTools].map(([id, category]) => ({ id, category })) };
      const item = { sessionId: s.sessionId, runtimeInstanceId, generation: s.generation, sequence: ++s.seq, type: 'snapshot', data };
      s.queue.push(item); s.bytes += size(item);
    }

    // ---- sending: one request at a time, bounded time, backoff with jitter, drop rather than block ----
    function schedule(delay) {
      if (s.closed || s.disabled || s.timer || s.sending || !s.queue.length) return;
      s.timer = setTimer(() => { s.timer = null; void drain(); }, delay);
      s.timer?.unref?.();
    }
    const backoff = () => {
      const base = Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** Math.max(0, s.attempts - 1));
      return Math.round(base * (0.75 + random() * 0.5));
    };
    async function drain() {
      if (s.closed || s.disabled || s.sending || !s.queue.length) return;
      const batch = s.queue.slice(0, cfg.maxBatch);
      const wire = batch.map(({ sessionId, runtimeInstanceId: rt, generation, sequence, type, data }) =>
        ({ version: 1, sourceId, sessionId, runtimeInstanceId: rt, generation, sequence, type, data }));
      s.sending = true; s.inflight = new Set(batch);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      s.controller = controller;
      const guard = setTimer(() => attempt(() => controller?.abort(), undefined), cfg.timeoutMs);
      guard?.unref?.();
      let res = null;
      try { res = await transport.send({ events: wire }, { signal: controller?.signal, timeoutMs: cfg.timeoutMs }); }
      catch { res = null; }
      finally { clearTimer(guard); s.sending = false; s.controller = null; s.inflight = new Set(); }
      if (s.closed) return;
      const status = res?.status ?? 0;
      const sent = new Set(batch);
      const drop = () => { s.queue = s.queue.filter((x) => !sent.has(x)); s.bytes = s.queue.reduce((n, x) => n + size(x), 0); };
      if (status === 200) {
        s.attempts = 0; drop();
        const results = Array.isArray(res.json?.results) ? res.json.results : [];
        if (results.some((r) => r?.code === 'old-generation')) { s.superseded = true; s.queue.length = 0; s.bytes = 0; clearTimers(); return; }
        if (res.json?.resync === true) { s.queue.length = 0; s.bytes = 0; snapshotNow(); }
        schedule(0);
      } else if (status === 401 || status === 403 || status === 404) {
        s.disabled = true; s.queue.length = 0; s.bytes = 0; clearTimers();   // not allowed here or ingress off: stop trying
      } else if (status === 400 || status === 413 || status === 415 || status === 422) {
        drop(); s.attempts++; schedule(backoff());
      } else {   // offline, timeout, 429 or 5xx: keep the batch, back off
        s.attempts++;
        if (s.attempts > cfg.maxAttempts) { s.attempts = cfg.maxAttempts; s.queue.length = 0; s.bytes = 0; snapshotNow(); }
        const wait = status === 429 && Number.isFinite(res.json?.retryAfterMs) ? Math.min(cfg.maxBackoffMs, Math.max(cfg.flushMs, res.json.retryAfterMs)) : backoff();
        schedule(wait);
      }
    }

    // ---- binding a session; a switch/resume/fork is a new generation, never a mutation of the old one ----
    function arm() {
      if (s.heartbeat || s.closed || s.disabled) return;
      const tick = () => {
        s.heartbeat = null;
        if (s.closed || s.disabled || s.superseded || !s.sessionId) return;
        enqueue('heartbeat', runtimeState(s.ctx), { replaceTail: true });
        s.heartbeat = setTimer(tick, cfg.heartbeatMs); s.heartbeat?.unref?.();
      };
      s.heartbeat = setTimer(tick, cfg.heartbeatMs); s.heartbeat?.unref?.();
    }
    function bindSession(ctx, first) {
      const sid = sessionIdOf(ctx);
      if (!sid) return false;
      if (sid === s.sessionId) { s.ctx = ctx; return true; }
      if (s.sessionId) enqueue('session_end');   // the old generation ends under its own identity
      s.sessionId = sid; s.generation++; s.seq = 0; s.superseded = false; s.ctx = ctx;
      s.pendingTools.clear(); s.waiting.clear();
      enqueue(first ? 'session_start' : 'snapshot', { ...runtimeState(ctx), waitReasons: [], tools: [] });
      arm();
      return true;
    }
    // Every handler: observe, copy, return. Sub-agents (kind "sub") are not reported as sessions in this version.
    const watch = (name, fn) => {
      try {
        pi.on(name, (event, ctx) => {
          if (s.closed || s.disabled || s.superseded) return undefined;
          try {
            if (isSub(ctx)) return undefined;
            fn(event || {}, ctx);
          } catch { /* the observer never throws into OMP */ }
          return undefined;
        });
      } catch { /* an event this build does not have */ }
    };
    const ensure = (ctx) => s.sessionId && sessionIdOf(ctx) === s.sessionId ? (s.ctx = ctx, true) : bindSession(ctx, false);

    watch('session_start', (_e, ctx) => { bindSession(ctx, true); });
    watch('session_switch', (_e, ctx) => { bindSession(ctx, false); });
    watch('session_shutdown', () => { enqueue('session_end'); flushFinal(); });
    watch('agent_start', (_e, ctx) => { if (ensure(ctx)) enqueue('turn_start'); });
    watch('agent_end', (e, ctx) => {
      if (!ensure(ctx)) return;
      if (e.willContinue === true) { enqueue('heartbeat', { ...runtimeState(ctx), isIdle: false }, { replaceTail: true }); return; }   // not a settle
      enqueue('turn_end', { outcome: 'unknown' });   // (agent_end carries no outcome: never claim a success)
      enqueue('heartbeat', runtimeState(ctx), { replaceTail: true });
    });
    watch('message_end', (_e, ctx) => { if (ensure(ctx)) enqueue('heartbeat', runtimeState(ctx), { replaceTail: true }); });   // (usage snapshot only; the text is never read)
    watch('tool_execution_start', (e, ctx) => {
      const toolCallId = idOf(e.toolCallId); if (!toolCallId || !ensure(ctx)) return;
      const category = CATEGORY.get(e.toolName) || 'other';
      if (s.pendingTools.size < cfg.maxPending) s.pendingTools.set(toolCallId, category);
      enqueue('tool_start', { toolCallId, category });
    });
    watch('tool_execution_end', (e, ctx) => {
      const toolCallId = idOf(e.toolCallId); if (!toolCallId || !ensure(ctx)) return;
      const category = s.pendingTools.get(toolCallId) || CATEGORY.get(e.toolName) || 'other';
      s.pendingTools.delete(toolCallId);
      enqueue('tool_end', { toolCallId, category, phase: e.isError === true ? 'error' : 'completed' });
    });
    watch('tool_approval_requested', (e, ctx) => {
      const requestId = idOf(e.toolCallId); if (!requestId || !ensure(ctx)) return;
      if (s.waiting.size < cfg.maxPending) s.waiting.set(requestId, 'approval');
      enqueue('approval_requested', { requestId });
    });
    watch('tool_approval_resolved', (e, ctx) => {
      const requestId = idOf(e.toolCallId); if (!requestId || !ensure(ctx)) return;
      s.waiting.delete(requestId);
      enqueue('approval_resolved', { requestId });
    });
    watch('plan_review_requested', (e, ctx) => {
      const requestId = idOf(e.reviewId); if (!requestId || !ensure(ctx)) return;
      if (s.waiting.size < cfg.maxPending) s.waiting.set(requestId, 'input');
      enqueue('input_requested', { requestId });
    });
    watch('plan_review_resolved', (e, ctx) => {
      const requestId = idOf(e.reviewId); if (!requestId || !ensure(ctx)) return;
      s.waiting.delete(requestId);
      enqueue('input_resolved', { requestId });
    });

    // Best effort and short: shutdown must not wait for My Office. Whatever is not sent shows as stale there.
    function flushFinal() {
      clearTimers();
      if (s.queue.length && !s.sending) void drain().finally(() => { s.closed = true; clearTimers(); });
      else { s.closed = true; clearTimers(); }
    }
    return { stop, state: s, runtimeInstanceId };
  }

  factory.enabled = enabled;
  factory.bindings = bindings;
  factory.dispose = () => { for (const b of bindings) b.stop(); bindings.clear(); };
  return factory;
}

export default createOfficeObserver();
