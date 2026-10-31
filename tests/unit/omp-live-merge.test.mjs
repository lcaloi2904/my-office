import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createOmpAdapter } from '../../server/agents/omp/index.mjs';
import { createOmpBridge } from '../../server/agents/omp/bridge.mjs';
import { createAgentRegistry } from '../../server/agents/registry.mjs';
import { ompSessionIdentity, hasClaudeCapability } from '../../server/agents/schema.mjs';
import { fixture, readonlyIO, header, assistant, lines } from '../fixtures/omp/synthetic.mjs';

const TOKEN = 'c'.repeat(64);
const idOf = (sid) => ompSessionIdentity('fixture', sid).id;
const ev = (type, sequence, data = {}, extra = {}) => ({ version: 1, sourceId: 'fixture', sessionId: 'live-1',
  runtimeInstanceId: 'rt', generation: 1, sequence, type, data, ...extra });

async function harness(t, f, { live = true } = {}) {
  const { io } = readonlyIO(), timers = new Set(), changes = [], clock = { t: Date.now() };
  const adapter = createOmpAdapter({
    io, live, now: () => clock.t, onChange: (ids) => changes.push(...ids),
    setTimer: (fn) => { const h = { fn, unref() {} }; timers.add(h); return h; }, clearTimer: (h) => timers.delete(h),
    config: { version: 1, sources: [{ id: 'fixture', root: f.source, pathStyle: 'posix', conversation: true,
      projectMappings: [{ from: '/fixture/projects/repo-a', projectId: 'repo', worktreeId: 'main' }] }] },
  });
  t.after(() => adapter.dispose());
  const registry = createAgentRegistry({ adapters: [adapter] });
  await registry.start();
  const bridge = live ? createOmpBridge({ lifecycle: adapter.lifecycle, tokens: new Map([['fixture', TOKEN]]), now: () => clock.t }) : null;
  const post = (events) => bridge.handle({ method: 'POST', loopback: true, body: Readable.from([Buffer.from(JSON.stringify({ events }))]),
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' } });
  return { adapter, registry, bridge, post, timers, changes, clock };
}
async function put(f, rel, body) {
  const file = path.join(f.source, ...rel.split('/'));
  await f.fs.mkdir(path.dirname(file), { recursive: true }); await f.fs.writeFile(file, body);
}

test('R9: a live session with no file is one actor with live state and volatile, provisional usage', async (t) => {
  const f = await fixture(t), h = await harness(t, f);
  await h.post([ev('session_start', 1, { isIdle: false, model: 'fixture/model-a', usage: { input: 7, cost: 0.25 } }), ev('tool_start', 2, { toolCallId: 'a', category: 'read' })]);
  const rows = h.registry.list(), id = idOf('live-1');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, id);
  const s = rows[0];
  assert.equal(s.status, 'work'); assert.equal(s.activity, 'active'); assert.equal(s.connection, 'connected');
  assert.equal(s.persistedOnly, false); assert.equal(s.pendingTools, 1); assert.deepEqual(s.toolCategories, ['read']);
  assert.equal(s.metrics.tokens.provenance, 'provisional'); assert.equal(s.metrics.cost.provenance, 'provisional');
  assert.equal(s.usage, null, 'no legacy Claude usage shape for OMP');
  assert.equal(s.model, 'fixture/model-a');
  assert.ok(h.changes.includes(id));
  assert.equal(h.registry.resolve(id).publicSession.id, id);
});

test('R9: when the file materializes it joins the same actor and its recorded usage replaces the snapshot', async (t) => {
  const f = await fixture(t), h = await harness(t, f);
  await h.post([ev('session_start', 1, { isIdle: true, usage: { input: 9999, cost: 99 } })], {});
  await h.adapter.start();
  assert.equal(h.registry.list()[0].metrics.cost.value, 99);
  await put(f, 'proj/live-1.jsonl', lines([header({ id: 'live-1' }), assistant('m1', null)]));
  await h.adapter.refresh();
  assert.deepEqual(await h.adapter.pin(idOf('live-1')), { ok: true, pinned: true });
  await h.adapter.refresh({ rescan: false });
  const rows = h.registry.list();
  assert.equal(rows.length, 1, 'one conversation, one actor');
  const s = rows[0];
  assert.equal(s.metrics.cost.value, 1, 'the file\'s recorded cost replaces the provisional 99, it is not added');
  assert.equal(s.metrics.cost.provenance, 'recorded');
  assert.equal(s.activity, 'idle'); assert.equal(s.status, 'rest', 'liveness still comes from the runtime');
  assert.equal(s.persistedOnly, false); assert.equal(s.name, 'repo-a');
  assert.ok(s.projectKey && s.worktreeKey);
  assert.equal(s.counts.read + s.counts.edit + s.counts.cmd + s.counts.web >= 0, true);
  // unpinning keeps the live actor; only the file half goes away
  await h.adapter.pin(idOf('live-1'), false);
  assert.equal(h.registry.list().length, 1);
  assert.equal(h.registry.list()[0].metrics.cost.value, 99);
});

test('R5: a silent runtime turns stale, then disconnected, and is removed later; the status is never "rest"', async (t) => {
  const f = await fixture(t), h = await harness(t, f);
  await h.post([ev('session_start', 1, { isIdle: true, pendingMessages: 0, pendingJobs: 0 })]);
  assert.equal(h.registry.list()[0].status, 'rest');
  h.clock.t += 31_000; h.adapter.lifecycle.sweep();
  const stale = h.registry.list()[0];
  assert.equal(stale.connection, 'stale'); assert.equal(stale.status, 'unknown'); assert.equal(stale.activity, 'unknown');
  h.clock.t += 60_000; h.adapter.lifecycle.sweep();
  assert.equal(h.registry.list()[0].connection, 'disconnected');
  h.clock.t += 16 * 60_000; h.adapter.lifecycle.sweep();
  assert.equal(h.registry.list().length, 0);
});

test('S6: a live row stays read-only: no Claude controls, no Claude task target, conversation only from a pinned file', async (t) => {
  const f = await fixture(t), h = await harness(t, f);
  await h.post([ev('session_start', 1, { isIdle: false }), ev('approval_requested', 2, { requestId: 'r1' })]);
  const s = h.registry.list()[0];
  assert.equal(s.status, 'wait'); assert.deepEqual(s.waitReasons, ['approval']);
  for (const k of ['openWindow', 'closeSession', 'changeAccount', 'remoteControl', 'startTask', 'readConversation']) assert.equal(s.capabilities[k], false, k);
  assert.equal(hasClaudeCapability(s, 'closeSession'), false);
  assert.equal(h.registry.resolveForControl(s.id, 'closeSession'), null);
  assert.deepEqual(await h.registry.readConversation(s.id), []);
  assert.equal(h.registry.diagnostics().filter((x) => x.startsWith('omp:')).length, 0);
});

test('S8/R8: without live mode there is no lifecycle, no sweep timer and nothing to feed; with it, dispose leaves nothing', async (t) => {
  const f = await fixture(t);
  const off = await harness(t, f, { live: false });
  assert.equal(off.adapter.lifecycle, null); assert.equal(off.timers.size, 0);
  const on = await harness(t, f);
  assert.equal(on.adapter.status().timers >= 1, true, 'the sweep timer is the only runtime timer');
  await on.post([ev('session_start', 1, { isIdle: true })]);
  assert.equal(on.registry.list().length, 1);
  await on.registry.dispose();
  assert.equal(on.timers.size, 0, 'the sweep timer is cleared');
  assert.deepEqual(on.adapter.list(), []);
  assert.equal((await on.post([ev('heartbeat', 2, {})])).body.ok, false);
});

test('S3: the source files are never written by live mode', async (t) => {
  const f = await fixture(t), h = await harness(t, f);
  await put(f, 'proj/live-1.jsonl', lines([header({ id: 'live-1' })]));
  const before = (await f.fs.readFile(path.join(f.source, 'proj', 'live-1.jsonl'))).toString();
  await h.post([ev('session_start', 1, { isIdle: false }), ev('turn_start', 2), ev('turn_end', 3, { outcome: 'success' })]);
  await h.adapter.refresh();
  assert.equal((await f.fs.readFile(path.join(f.source, 'proj', 'live-1.jsonl'))).toString(), before);
});
