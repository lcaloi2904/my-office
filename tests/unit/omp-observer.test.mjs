import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createOfficeObserver } from '../../integrations/omp/office-observer.js';
import { createOmpBridge } from '../../server/agents/omp/bridge.mjs';
import { createOmpLifecycle } from '../../server/agents/omp/lifecycle.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';

const TOKEN = 'd'.repeat(64);

// Streams and promises need real ticks to finish; timers are the only thing the test controls.
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
// Virtual time: timers run only when the test advances the clock. Nothing here touches the network or a real timer.
function clockOf() {
  const timers = new Map(); let now = 0, next = 1;
  return {
    setTimer: (fn, ms) => { const h = { id: next++, unref() {} }; timers.set(h, { fn, at: now + ms }); return h; },
    clearTimer: (h) => timers.delete(h),
    async advance(ms) {
      await settle();
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = Math.max(now, due[1].at); due[1].fn();
        await settle();
      }
      now = until;
      await settle();
    },
    pending: () => timers.size,
  };
}
function fakePi() {
  const handlers = new Map();
  return { on: (name, fn) => { handlers.set(name, fn); }, emit: (name, event, ctx) => handlers.get(name)?.(event, ctx), handlers };
}
const ctxOf = (sessionId, extra = {}) => ({ sessionManager: { getSessionId: () => sessionId }, isIdle: () => false, hasPendingMessages: () => false,
  agent: { kind: 'main', id: 'a', depth: 0 }, model: { id: 'fixture/model-a' }, ...extra });

function setup(over = {}) {
  const clock = clockOf(), sent = [];
  const script = over.script || (() => ({ status: 200, json: { ok: true, results: [], resync: false } }));
  const transport = { send: async (body) => { const r = await script(body, sent.length); sent.push(body); if (r instanceof Error) throw r; return r; } };
  const factory = createOfficeObserver({ token: TOKEN, sourceId: 'src', transport, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    random: () => 0.5, newId: (() => { let n = 0; return () => 'rt-' + ++n; })(), ...over.options });
  return { clock, sent, factory };
}
const wire = (sent) => sent.flatMap((b) => b.events);

test('R10 (synthetic only): disabled without a token, a source id or a loopback address; then it registers nothing', () => {
  for (const options of [{ token: '' }, { sourceId: '' }, { token: 'short' }, { url: 'http://192.168.1.5:4310/ingest/omp/v1' },
    { url: 'https://127.0.0.1:4310/ingest/omp/v1' }, { url: 'http://example.com/ingest/omp/v1' }]) {
    const { factory } = setup({ options });
    const pi = fakePi(); factory(pi);
    assert.equal(pi.handlers.size, 0, JSON.stringify(options)); assert.equal(factory.enabled, false);
  }
  const ok = setup().factory; assert.equal(ok.enabled, true);
  assert.doesNotThrow(() => ok(null)); assert.doesNotThrow(() => ok({}));
});

test('install: a settings file supplies the token when the environment has none; the environment wins; bad files do nothing', () => {
  const base = { transport: { send: async () => ({ status: 200 }) }, env: {} };
  const good = { sourceId: 'omp-local', token: TOKEN, url: 'http://127.0.0.1:4310/ingest/omp/v1' };
  const pi = fakePi(); createOfficeObserver({ ...base, settings: good })(pi);
  assert.ok(pi.handlers.size > 0, 'registered from the settings file');
  assert.equal(createOfficeObserver({ ...base, settings: { ...good, url: 'http://10.0.0.5:4310/ingest/omp/v1' } }).enabled, false, 'a non-loopback url in the file is refused too');
  for (const settings of [{}, { token: 'x', sourceId: 'a' }, { token: 7, sourceId: 'a' }, { sourceId: 'a' }]) assert.equal(createOfficeObserver({ ...base, settings }).enabled, false);
  const env = createOfficeObserver({ ...base, env: { OFFICE_OMP_TOKEN: 'e'.repeat(64), OFFICE_OMP_SOURCE: 'env-src' }, settings: good });
  assert.equal(env.enabled, true);
  // a missing or oversized real file is just "not configured"
  assert.equal(createOfficeObserver({ ...base, env: { OFFICE_OMP_OBSERVER_CONFIG: 'Z:/does/not/exist.json' } }).enabled, false);
});

test('R11: a handler returns at once with no value, never awaits the network and never throws', async () => {
  const { factory, sent, clock } = setup({ script: () => new Promise(() => {}) });   // a transport that never answers
  const pi = fakePi(); factory(pi);
  const ctx = ctxOf('s1');
  for (const [name, event] of [['session_start', {}], ['agent_start', {}], ['tool_execution_start', { toolCallId: 't', toolName: 'bash' }],
    ['tool_execution_end', { toolCallId: 't' }], ['agent_end', {}], ['message_end', {}], ['tool_approval_requested', { toolCallId: 'a' }]]) {
    assert.equal(pi.emit(name, event, ctx), undefined, name);
  }
  assert.equal(sent.length, 0, 'nothing is sent from inside a handler');
  await clock.advance(100);
  // a throwing host is contained too
  const hostile = { sessionManager: { getSessionId() { throw new Error('boom'); } }, isIdle() { throw new Error('boom'); } };
  assert.doesNotThrow(() => pi.emit('agent_start', {}, hostile));
  assert.doesNotThrow(() => pi.emit('tool_execution_start', null, undefined));
  factory.dispose();
});

test('R1/R2/R3/R4: events map onto the wire contract in order, with parallel tools and approvals', async () => {
  const { factory, sent, clock } = setup();
  const pi = fakePi(); factory(pi);
  const ctx = ctxOf('s1');
  pi.emit('session_start', {}, ctx);
  pi.emit('agent_start', {}, ctx);
  pi.emit('tool_execution_start', { toolCallId: 'a', toolName: 'read', args: { path: '/home/u/secret.txt' } }, ctx);
  pi.emit('tool_execution_start', { toolCallId: 'b', toolName: 'bash', args: { command: 'echo password=hunter2' } }, ctx);
  pi.emit('tool_approval_requested', { toolCallId: 'b', sessionId: 's1', reason: 'run command' }, ctx);
  pi.emit('tool_approval_resolved', { toolCallId: 'b', approved: true }, ctx);
  pi.emit('tool_execution_end', { toolCallId: 'a', toolName: 'read', result: 'file text SECRET', isError: false }, ctx);
  pi.emit('tool_execution_end', { toolCallId: 'b', toolName: 'bash', result: 'out', isError: true }, ctx);
  pi.emit('agent_end', { messages: [{ role: 'assistant', content: 'PRIVATE ANSWER' }] }, ctx);
  await clock.advance(200);
  const events = wire(sent);
  assert.deepEqual(events.map((e) => e.type), ['session_start', 'turn_start', 'tool_start', 'tool_start', 'approval_requested', 'approval_resolved', 'tool_end', 'tool_end', 'turn_end', 'heartbeat']);
  assert.deepEqual(events.map((e) => e.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(events.filter((e) => e.type === 'tool_start').map((e) => e.data.category), ['read', 'cmd']);
  assert.equal(events.find((e) => e.type === 'tool_end' && e.data.toolCallId === 'b').data.phase, 'error');
  assert.equal(events.find((e) => e.type === 'turn_end').data.outcome, 'unknown', 'agent_end has no outcome: success is never invented');
  assert.ok(events.every((e) => e.version === 1 && e.sourceId === 'src' && e.sessionId === 's1' && e.generation === 1 && e.runtimeInstanceId === 'rt-1'));
  const text = JSON.stringify(sent);
  for (const leak of ['/home/u', 'hunter2', 'SECRET', 'PRIVATE', 'run command', TOKEN]) assert.ok(!text.includes(leak), 'leaked ' + leak);
  factory.dispose();
});

test('R6/R7: offline keeps events and retries with backoff; the same sequence numbers are resent; memory stays bounded', async () => {
  let up = false;
  const delivered = [];
  const { factory, sent, clock } = setup({ script: (body) => { if (up) { delivered.push(body); return { status: 200, json: { ok: true, results: [] } }; } return new Error('ECONNREFUSED'); } });
  const pi = fakePi(); factory(pi);
  const ctx = ctxOf('s1');
  pi.emit('session_start', {}, ctx); pi.emit('agent_start', {}, ctx);
  await clock.advance(60);
  assert.equal(sent.length, 1);
  await clock.advance(1500); assert.ok(sent.length >= 2, 'it retries');
  const tries = sent.length;
  await clock.advance(10); assert.equal(sent.length, tries, 'but not in a tight loop');
  up = true;
  await clock.advance(70_000);
  assert.deepEqual(delivered[0].events.map((e) => e.sequence), [1, 2], 'the retried batch carries the original sequence numbers');
  factory.dispose();

  // a flood while offline never grows the queue past its cap: a snapshot replaces the backlog
  up = false;
  const flooded = setup({ script: () => new Error('down') });
  const pi2 = fakePi(); flooded.factory(pi2);
  const ctx2 = ctxOf('s2');
  pi2.emit('session_start', {}, ctx2);
  for (let i = 0; i < 500; i++) { pi2.emit('tool_execution_start', { toolCallId: 't' + i, toolName: 'read' }, ctx2); }
  const binding = [...flooded.factory.bindings][0];
  assert.ok(binding.state.queue.length <= 64, 'queue ' + binding.state.queue.length);
  assert.ok(binding.state.bytes <= 48 * 1024 + 4096);
  assert.ok(binding.state.queue.some((e) => e.type === 'snapshot'));
  assert.ok(binding.state.pendingTools.size <= 96);
  flooded.factory.dispose();
});

test('R7: heartbeats are coalesced and add no gaps', async () => {
  const { factory, sent, clock } = setup({ script: () => new Promise(() => {}) });
  const pi = fakePi(); factory(pi);
  const ctx = ctxOf('s1');
  pi.emit('session_start', {}, ctx);
  for (let i = 0; i < 40; i++) pi.emit('message_end', {}, ctx);
  const q = [...factory.bindings][0].state.queue;
  assert.equal(q.length, 2); assert.deepEqual(q.map((e) => e.sequence), [1, 2]);
  assert.equal(sent.length, 0);
  factory.dispose();
  void clock;
});

test('R1/R12: a switch ends the old generation and starts a new one; a shutdown leaves no timer behind (S8)', async () => {
  const { factory, sent, clock } = setup();
  const pi = fakePi(); factory(pi);
  pi.emit('session_start', {}, ctxOf('s1'));
  pi.emit('tool_execution_start', { toolCallId: 'x', toolName: 'bash' }, ctxOf('s1'));
  pi.emit('session_switch', { reason: 'resume' }, ctxOf('s2'));
  await clock.advance(100);
  const events = wire(sent);
  assert.deepEqual(events.map((e) => [e.sessionId, e.generation, e.sequence, e.type]),
    [['s1', 1, 1, 'session_start'], ['s1', 1, 2, 'tool_start'], ['s1', 1, 3, 'session_end'], ['s2', 2, 1, 'snapshot']]);
  assert.deepEqual(events[3].data.tools, [], 'the new session starts with no pending tool of the old one');
  pi.emit('session_shutdown', {}, ctxOf('s2'));
  await clock.advance(1000);
  assert.equal(clock.pending(), 0, 'no timer survives shutdown');
  const n = sent.length;
  pi.emit('agent_start', {}, ctxOf('s2')); pi.emit('message_end', {}, ctxOf('s2'));
  await clock.advance(60_000);
  assert.equal(sent.length, n, 'late callbacks after shutdown are ignored');
  assert.equal(wire(sent).at(-1).type, 'session_end');
  assert.equal(factory.bindings.size, 1); factory.dispose(); assert.equal(factory.bindings.size, 0);
});

test('R8: two parents and a child run side by side without sharing state; the child reports nothing', async () => {
  const a = setup(), b = setup({ options: { newId: () => 'rt-other' } });
  const shared = createOfficeObserver({ token: TOKEN, sourceId: 'src', transport: { send: async () => ({ status: 200, json: { results: [] } }) },
    setTimer: a.clock.setTimer, clearTimer: a.clock.clearTimer });
  const pi1 = fakePi(), pi2 = fakePi(), child = fakePi();
  a.factory(pi1); b.factory(pi2); shared(child);
  pi1.emit('session_start', {}, ctxOf('p1')); pi2.emit('session_start', {}, ctxOf('p2'));
  child.emit('session_start', {}, ctxOf('c1', { agent: { kind: 'sub', id: 'c', depth: 0, parentId: 'a' } }));
  child.emit('tool_execution_start', { toolCallId: 'k', toolName: 'bash' }, ctxOf('c1', { agent: { kind: 'sub', id: 'c', depth: 0 } }));
  pi1.emit('tool_execution_start', { toolCallId: 'k', toolName: 'bash' }, ctxOf('p1'));
  await a.clock.advance(100); await b.clock.advance(100);
  assert.deepEqual(wire(a.sent).map((e) => e.sessionId), ['p1', 'p1']);
  assert.deepEqual(wire(b.sent).map((e) => e.sessionId), ['p2']);
  assert.equal([...shared.bindings][0].state.queue.length, 0);
  assert.notEqual([...a.factory.bindings][0].runtimeInstanceId, [...b.factory.bindings][0].runtimeInstanceId);
  for (const f of [a.factory, b.factory, shared]) f.dispose();
});

test('S1/S7: refusals stop the producer for good; a resync request becomes a snapshot; a newer generation silences the old', async () => {
  for (const status of [401, 403, 404]) {
    const { factory, sent, clock } = setup({ script: () => ({ status, json: { ok: false } }) });
    const pi = fakePi(); factory(pi);
    pi.emit('session_start', {}, ctxOf('s1'));
    await clock.advance(100); assert.equal(sent.length, 1);
    pi.emit('agent_start', {}, ctxOf('s1'));
    await clock.advance(120_000);
    assert.equal(sent.length, 1, `${status}: it must not keep knocking`); assert.equal(clock.pending(), 0);
  }
  const resync = setup({ script: (_b, n) => n === 0 ? { status: 200, json: { ok: true, resync: true, results: [{ ok: false, code: 'snapshot-required' }] } } : { status: 200, json: { ok: true, results: [] } } });
  const pi = fakePi(); resync.factory(pi);
  pi.emit('session_start', {}, ctxOf('s1')); pi.emit('tool_execution_start', { toolCallId: 'p', toolName: 'read' }, ctxOf('s1'));
  await resync.clock.advance(200);
  const second = resync.sent[1].events;
  assert.equal(second[0].type, 'snapshot'); assert.deepEqual(second[0].data.tools, [{ id: 'p', category: 'read' }]);
  resync.factory.dispose();

  const old = setup({ script: () => ({ status: 200, json: { ok: false, results: [{ ok: false, code: 'old-generation' }] } }) });
  const pi3 = fakePi(); old.factory(pi3);
  pi3.emit('session_start', {}, ctxOf('s1'));
  await old.clock.advance(100);
  pi3.emit('agent_start', {}, ctxOf('s1')); await old.clock.advance(60_000);
  assert.equal(old.sent.length, 1);
  old.factory.dispose();
});

test('R6: 429 honours retryAfterMs; 500s back off with jitter inside a ceiling', async () => {
  const rate = setup({ script: (_b, n) => n === 0 ? { status: 429, json: { ok: false, retryAfterMs: 5000 } } : { status: 200, json: { results: [] } } });
  const pi = fakePi(); rate.factory(pi);
  pi.emit('session_start', {}, ctxOf('s1'));
  await rate.clock.advance(100); assert.equal(rate.sent.length, 1);
  await rate.clock.advance(4000); assert.equal(rate.sent.length, 1, 'still waiting');
  await rate.clock.advance(1500); assert.equal(rate.sent.length, 2);
  rate.factory.dispose();
  const times = [];
  const broken = setup({ script: () => { times.push(Date.now()); return { status: 503, json: null }; }, options: { random: () => 1 } });
  const pi2 = fakePi(); broken.factory(pi2); pi2.emit('session_start', {}, ctxOf('s1'));
  await broken.clock.advance(10 * 60_000);
  assert.ok(broken.sent.length >= 3 && broken.sent.length <= 30, 'attempts: ' + broken.sent.length);
  broken.factory.dispose();
});

test('R9/R10 (synthetic): the observer, the bridge and the lifecycle agree end to end', async () => {
  const clock = clockOf(), life = createOmpLifecycle({ now: () => 5000 + 1 });
  const bridge = createOmpBridge({ lifecycle: life, tokens: new Map([['src', TOKEN]]) });
  const transport = { send: async (body) => {
    const r = await bridge.handle({ method: 'POST', loopback: true, body: Readable.from([Buffer.from(JSON.stringify(body))]),
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' } });
    return { status: r.status, json: r.body };
  } };
  const factory = createOfficeObserver({ token: TOKEN, sourceId: 'src', transport, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pi = fakePi(); factory(pi);
  let idle = true;
  const ctx = ctxOf('end-to-end', { isIdle: () => idle });
  const id = ompSessionIdentity('src', 'end-to-end').id;
  pi.emit('session_start', {}, ctx);
  await clock.advance(100);
  assert.equal(life.resolve(id).activity, 'idle');
  idle = false;
  pi.emit('agent_start', {}, ctx); pi.emit('tool_execution_start', { toolCallId: 'z', toolName: 'edit' }, ctx);
  await clock.advance(100);
  assert.equal(life.resolve(id).activity, 'active'); assert.deepEqual(life.resolve(id).toolCategories, ['edit']);
  pi.emit('tool_approval_requested', { toolCallId: 'z' }, ctx);
  await clock.advance(100);
  assert.equal(life.resolve(id).activity, 'waiting');
  pi.emit('tool_approval_resolved', { toolCallId: 'z' }, ctx); pi.emit('tool_execution_end', { toolCallId: 'z', toolName: 'edit' }, ctx);
  idle = true; pi.emit('agent_end', {}, ctx);
  await clock.advance(100);
  assert.equal(life.resolve(id).activity, 'idle');
  assert.equal(life.resolve(id).gap, false);
  factory.dispose();
});
