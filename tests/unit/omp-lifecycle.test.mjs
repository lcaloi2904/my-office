import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOmpLifecycle } from '../../server/agents/omp/lifecycle.mjs';
import { normalizeOmpLiveEvent } from '../../server/agents/omp/normalize.mjs';
import { provisionalUsage } from '../../server/agents/omp/usage.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';

const SRC = 'fixture-src', SID = 'session-1', ID = ompSessionIdentity(SRC, SID).id;
function make(opts = {}) {
  const clock = { t: 1_000_000 }, changes = [];
  const life = createOmpLifecycle({ now: () => clock.t, onChange: (ids) => changes.push(...ids), ...opts });
  let n = 0;
  const raw = (type, sequence, data = {}, extra = {}) => ({ version: 1, sourceId: SRC, sessionId: SID,
    runtimeInstanceId: 'rt-a', generation: 1, sequence, type, data, ...extra });
  const send = (type, sequence, data, extra) => life.ingest(normalizeOmpLiveEvent(raw(type, sequence, data, extra)));
  return { life, clock, changes, raw, send, next: () => ++n };
}

test('R1/R12: a session needs a snapshot first; an old generation never mutates a newer one', () => {
  const { life, send } = make();
  assert.equal(send('turn_start', 1).code, 'snapshot-required');
  assert.equal(send('session_start', 1, { isIdle: true, pendingMessages: 0, pendingJobs: 0 }).ok, true);
  assert.equal(life.resolve(ID).activity, 'idle');
  // the same process resumes: generation 2 replaces generation 1
  assert.equal(send('session_start', 1, { isIdle: false }, { generation: 2 }).ok, true);
  assert.equal(life.resolve(ID).generation, 2);
  assert.equal(life.resolve(ID).activity, 'active');
  // late events of the retired generation are rejected and change nothing
  assert.equal(send('session_end', 2, {}, { generation: 1 }).code, 'old-generation');
  assert.equal(life.resolve(ID).lifecycle, 'open');
  assert.equal(send('heartbeat', 5, {}, { generation: 3 }).code, 'unknown-generation');
});

test('R1: another live process claiming the conversation is a conflict, not a takeover', () => {
  const { life, send, clock } = make();
  send('session_start', 1, { isIdle: true });
  const other = { runtimeInstanceId: 'rt-b' };
  assert.equal(send('session_start', 1, { isIdle: true }, other).code, 'runtime-conflict');
  assert.equal(life.resolve(ID).runtimeInstanceId, 'rt-a');
  assert.ok(life.diagnostics().includes('runtime-conflict'));
  clock.t += 31_000;   // the first one went quiet: the other may take over
  assert.equal(send('session_start', 1, { isIdle: true }, other).ok, true);
  assert.equal(life.resolve(ID).runtimeInstanceId, 'rt-b');
});

test('R2: parallel tools keep a pending set; result-before-start and a duplicate end stay terminal', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('tool_start', 2, { toolCallId: 'a', category: 'read' });
  send('tool_start', 3, { toolCallId: 'b', category: 'cmd' });
  assert.equal(life.resolve(ID).pendingTools, 2);
  assert.deepEqual(life.resolve(ID).toolCategories, ['cmd', 'read']);
  send('tool_end', 4, { toolCallId: 'a', phase: 'error' });
  send('tool_end', 5, { toolCallId: 'a', phase: 'completed' });   // duplicate terminal: the error stays
  assert.equal(life.resolve(ID).pendingTools, 1);
  send('tool_end', 6, { toolCallId: 'c', category: 'edit' });   // result before its start
  send('tool_start', 7, { toolCallId: 'c', category: 'edit' });  // a late start never resurrects it
  assert.equal(life.resolve(ID).pendingTools, 1);
  send('tool_end', 8, { toolCallId: 'b' });
  assert.equal(life.resolve(ID).pendingTools, 0);
});

test('R4: a finished turn is idle only when nothing is running, and a turn end is not termination', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: true, pendingMessages: 0, pendingJobs: 0 });
  send('turn_start', 2);
  send('tool_start', 3, { toolCallId: 't', category: 'cmd' });
  send('turn_end', 4, { outcome: 'success' });
  assert.equal(life.resolve(ID).activity, 'active', 'a tool is still running');
  send('tool_end', 5, { toolCallId: 't' });
  send('turn_end', 6, { outcome: 'success' });
  const r = life.resolve(ID);
  assert.equal(r.activity, 'idle', 'finished tools must not keep the session active');
  assert.equal(r.lifecycle, 'open'); assert.equal(r.lastTurnOutcome, 'success');
  // background jobs keep it active after the turn ends
  send('heartbeat', 7, { isIdle: true, pendingJobs: 1, pendingMessages: 0 });
  assert.equal(life.resolve(ID).activity, 'active');
});

test('R3: approvals and input make the session wait, per request, and resolve independently', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('approval_requested', 2, { requestId: 'r1' });
  send('input_requested', 3, { requestId: 'r2' });
  assert.equal(life.resolve(ID).activity, 'waiting');
  assert.deepEqual(life.resolve(ID).waitReasons, ['approval', 'input']);
  send('approval_resolved', 4, { requestId: 'r1' });
  assert.equal(life.resolve(ID).activity, 'waiting');
  send('input_resolved', 5, { requestId: 'r2' });
  assert.equal(life.resolve(ID).activity, 'active');
  assert.equal(normalizeOmpLiveEvent(raw0('approval_requested', {})), null, 'a request needs an id');
});
const raw0 = (type, data) => ({ version: 1, sourceId: SRC, sessionId: SID, runtimeInstanceId: 'rt', generation: 1, sequence: 1, type, data });

test('R5: silence becomes stale then disconnected from server time, never completed', () => {
  const { life, send, clock, changes } = make();
  send('session_start', 1, { isIdle: false });
  send('turn_start', 2);
  clock.t += 29_000; life.sweep();
  assert.equal(life.resolve(ID).connection, 'connected');
  clock.t += 2_000; life.sweep();
  assert.equal(life.resolve(ID).connection, 'stale');
  assert.equal(life.resolve(ID).activity, 'unknown');
  assert.equal(life.resolve(ID).lifecycle, 'open');
  clock.t += 60_000; life.sweep();
  assert.equal(life.resolve(ID).connection, 'disconnected');
  assert.equal(life.resolve(ID).lifecycle, 'open', 'a crashed producer is not "ended"');
  assert.ok(changes.length >= 3);
  // it comes back
  send('heartbeat', 3, { isIdle: false });
  assert.equal(life.resolve(ID).connection, 'connected');
  assert.equal(life.resolve(ID).activity, 'active');
  // a producer clock far in the past or future does not matter: only receipt time counts
  assert.equal(send('heartbeat', 4, { isIdle: true }, { sentAt: 1 }).ok, true);
});

test('R5: a heartbeat that says idle clears a running tool whose end event was lost', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('tool_start', 2, { toolCallId: 'lost', category: 'cmd' });
  send('heartbeat', 3, { isIdle: true, pendingMessages: 0, pendingJobs: 0 });
  const r = life.resolve(ID);
  assert.equal(r.pendingTools, 0); assert.equal(r.activity, 'idle'); assert.equal(r.gap, true);
});

test('R7: duplicates are idempotent; out-of-order is reordered; a gap is signalled', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('tool_start', 3, { toolCallId: 'x', category: 'read' });   // arrives early: buffered
  assert.equal(life.resolve(ID).pendingTools, 0);
  assert.equal(send('tool_start', 3, { toolCallId: 'x' }).duplicate, true);
  send('turn_start', 2);
  assert.equal(life.resolve(ID).pendingTools, 1);
  const again = send('turn_start', 2);
  assert.equal(again.duplicate, true); assert.equal(again.ack, 3);
  assert.equal(life.resolve(ID).pendingTools, 1, 'a replay never doubles a logical tool');
  // lost events beyond the reorder window: gap flagged, state still follows the newest event
  const r = send('tool_end', 400, { toolCallId: 'x' });
  assert.equal(r.ok, true); assert.equal(r.gap, true);
  assert.equal(life.resolve(ID).pendingTools, 0);
  assert.ok(life.diagnostics().includes('sequence-gap'));
});

test('R6: a reconnect snapshot replaces uncertain volatile state without animation history', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('tool_start', 2, { toolCallId: 'old', category: 'cmd' });
  send('approval_requested', 3, { requestId: 'r' });
  send('snapshot', 40, { isIdle: false, tools: [{ id: 'new', category: 'web' }], waitReasons: [] });
  const r = life.resolve(ID);
  assert.deepEqual(r.toolCategories, ['web']); assert.equal(r.waitReasons.length, 0);
  assert.equal(r.activity, 'active'); assert.equal(r.gap, true);
});

test('R9: runtime usage is provisional and replaced, never accumulated', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: true, usage: { input: 10, output: 5, cost: 0.5 } });
  send('heartbeat', 2, { usage: { input: 30, output: 8, cost: 0.75 } });
  const m = life.resolve(ID).metrics;
  assert.equal(m.tokens.input, 30); assert.equal(m.cost.value, 0.75);
  assert.equal(m.tokens.provenance, 'provisional'); assert.equal(m.cost.provenance, 'provisional');
  assert.equal(provisionalUsage({ input: -1, output: 'x' }), null, 'unknown stays unknown, not zero');
  assert.equal(provisionalUsage({ output: 0 }).tokens.output, 0);
});

test('R4/R5: session_end ends the generation; a resume under a new generation is open again', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: false });
  send('session_end', 2);
  assert.equal(life.resolve(ID).lifecycle, 'ended'); assert.equal(life.resolve(ID).activity, 'unknown');
  send('session_start', 1, { isIdle: true }, { generation: 2 });
  assert.equal(life.resolve(ID).lifecycle, 'open');
});

test('R6/S8: unchanged heartbeats do not wake clients; changes do; dispose leaves nothing', () => {
  const { life, send, changes } = make();
  send('session_start', 1, { isIdle: true, pendingMessages: 0, pendingJobs: 0 });
  const n = changes.length;
  send('heartbeat', 2, { isIdle: true });
  send('heartbeat', 3, { isIdle: true });
  assert.equal(changes.length, n);
  send('turn_start', 4);
  assert.equal(changes.length, n + 1);
  life.dispose();
  assert.deepEqual(life.list(), []); assert.equal(life.ingest({}).code, 'disposed');
});

test('R8: two parents and a child stay separate, and bounds hold under many sessions', () => {
  const { life, send } = make();
  send('session_start', 1, { isIdle: true });
  send('session_start', 1, { isIdle: false }, { sessionId: 'session-2', runtimeInstanceId: 'rt-b' });
  send('session_start', 1, { isIdle: false }, { sessionId: 'session-1-child', runtimeInstanceId: 'rt-a' });
  assert.equal(life.ids().length, 3);
  assert.equal(life.resolve(ID).activity, 'idle');
  for (let i = 0; i < 200; i++) send('session_start', 1, { isIdle: true }, { sessionId: 'many-' + i, runtimeInstanceId: 'rt-m' });
  assert.ok(life.ids().length <= 128);
  assert.ok(life.diagnostics().includes('session-limit'));
});

test('S2: the live allowlist keeps only known fields and bounded values', () => {
  const ok = normalizeOmpLiveEvent(raw0('heartbeat', { isIdle: true, secret: 'sk-live', prompt: 'hello', cwd: '/home/x', usage: { input: 1, apiKey: 'k' } }));
  assert.deepEqual(Object.keys(ok.data).sort(), ['isIdle', 'metrics', 'model', 'pendingJobs', 'pendingMessages']);
  assert.ok(!JSON.stringify(ok).includes('sk-live') && !JSON.stringify(ok).includes('hello'));
  assert.equal(normalizeOmpLiveEvent({ ...raw0('heartbeat', {}), version: 2 }), null);
  assert.equal(normalizeOmpLiveEvent({ ...raw0('heartbeat', {}), type: 'approve' }), null);
  assert.equal(normalizeOmpLiveEvent({ ...raw0('heartbeat', {}), sourceId: '../x' }), null);
  assert.equal(normalizeOmpLiveEvent({ ...raw0('heartbeat', {}), generation: 0 }), null);
  assert.equal(normalizeOmpLiveEvent({ ...raw0('tool_start', { toolCallId: 'a\u0000b' }) }), null);
  const tools = normalizeOmpLiveEvent(raw0('snapshot', { tools: Array.from({ length: 500 }, (_, i) => ({ id: 't' + i, category: 'rm -rf' })) }));
  assert.equal(tools.data.tools.length, 96); assert.equal(tools.data.tools[0].category, 'other');
});
