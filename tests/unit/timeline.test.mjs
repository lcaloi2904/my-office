import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../src/shared/timeline.js';

const T0 = Date.parse('2026-10-27T09:00:00Z');
const ev = (t, sess, type, extra = {}) => ({ t: T0 + t * 1000, m: { k: 'ev', e: { sess, type, ts: T0 + t * 1000, ...extra }, s: { id: sess, name: 'shop-api', status: 'work' } } });

test('one row per session, spans in time order', () => {
  const items = [ev(0, 'a', 'prompt', { label: 'add cart' }), ev(10, 'a', 'read', { label: 'cart.ts' }), ev(40, 'a', 'edit', { label: 'cart.ts' }), ev(100, 'a', 'stop')];
  const tl = buildTimeline(items, T0, T0 + 200e3);
  assert.equal(tl.rows.length, 1);
  const spans = tl.rows[0].spans;
  assert.ok(spans.length >= 3);
  // a span is [start, end, kind, label]
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][0], 'spans start in order');
  assert.deepEqual(spans.slice(0, 3).map((x) => x[2]), ['think', 'read', 'edit']);
});

test('an empty log gives no rows and zero totals', () => {
  const tl = buildTimeline([], T0, T0 + 60e3);
  assert.equal(tl.rows.length, 0);
  assert.equal(tl.totals.prompts, 0);
});

const at = (seconds, m) => ({ t: T0 + seconds * 1000, m });
const snap = (seconds, ...sessions) => at(seconds, { k: 'snap', sessions });
const changed = (seconds, s) => at(seconds, { k: 'sess', s });
const event = (seconds, s, type, extra = {}) => at(seconds, { k: 'ev', s, e: { sess: s.id, type, ts: T0 + seconds * 1000, ...extra } });
const timeline = (items, seconds = 60) => buildTimeline(items, T0, T0 + seconds * 1000);
const stable = (id, sessionKey, extra = {}) => ({ id, sessionKey, name: 'same-name', status: 'work', ...extra });
const runtime = (extra = {}) => stable('omp:a', 'opaque-a', { agentKind: 'omp', lifecycle: 'open', connection: 'connected', activity: 'active', ...extra });
const kinds = (row) => row.spans.map((x) => x[2]);
const contains = (row, seconds, kind) => row.spans.some(([s, e, k]) => s <= T0 + seconds * 1000 && e > T0 + seconds * 1000 && k === kind);

test('new replay separates same-name providers and projects by stable identity', () => {
  const claude = stable('c', 'claude:c', { projectKey: 'repo-1' });
  const omp = runtime({ projectKey: 'repo-2' });
  const result = timeline([snap(0, claude, omp)]);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map((r) => r.key)).size, 2);
  assert.deepEqual(new Set(result.rows.map((r) => r.sessionKey)), new Set(['claude:c', 'opaque-a']));
  assert.equal(result.totals.work, 120e3);
});

test('a rename and public ID replacement do not split a stable replay session', () => {
  const first = stable('run-1', 'conversation');
  const renamed = { ...first, name: 'renamed' };
  const restarted = { ...renamed, id: 'run-2' };
  const result = timeline([event(0, first, 'prompt'), changed(10, renamed), event(20, restarted, 'read'), event(30, restarted, 'stop')]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'renamed');
  assert.equal(result.rows[0].sess, 'run-2');
  assert.equal(result.totals.prompts, 1);
  assert.equal(result.totals.work, 30e3);
  assert.equal(result.totals.turn, 30e3);
});

test('old replay retains name restart grouping without mutating stored messages', () => {
  const items = [ev(0, 'old-run', 'prompt'), at(10, { k: 'gone', id: 'old-run' }), ev(20, 'new-run', 'prompt'), ev(30, 'new-run', 'stop')];
  const original = structuredClone(items);
  const result = timeline(items);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'shop-api');
  assert.equal(result.rows[0].sess, 'new-run');
  assert.equal(result.totals.work, 20e3);
  assert.deepEqual(items, original);
});

test('stable identities cannot collide with legacy display names', () => {
  const modern = stable('new', 'same-name');
  const old = { id: 'old', name: 'same-name', status: 'work' };
  const result = timeline([snap(0, modern, old)]);
  assert.equal(result.rows.length, 2);
  assert.notEqual(result.rows[0].key, result.rows[1].key);
});

test('child tuple keys resist delimiter collisions and duplicate raw child IDs across roots', () => {
  const a = stable('one', 'root|nested', { subs: [{ id: 'child', type: 'worker' }] });
  const b = stable('two', 'root', { subs: [{ id: 'nested|child', type: 'worker' }, { id: 'child', type: 'worker' }] });
  const result = timeline([snap(0, a, b)]);
  const roots = result.rows.filter((r) => !r.agent), children = result.rows.filter((r) => r.agent);
  assert.equal(children.length, 3);
  assert.equal(new Set(result.rows.map((r) => r.key)).size, 5);
  assert.equal(children.filter((r) => r.agent === 'child').length, 2);
  assert.ok(children.every((r) => roots.some((p) => p.key === r.rootKey)));
  assert.equal(result.totals.work, 120e3, 'child activity is not added to root-session totals');
});

test('names containing legacy delimiters do not merge unrelated child lanes', () => {
  const a = { id: 'a', name: 'root|nested', status: 'work', subs: [{ id: 'child', type: 'worker' }] };
  const b = { id: 'b', name: 'root', status: 'work', subs: [{ id: 'nested|child', type: 'worker' }] };
  const result = timeline([snap(0, a, b)]);
  assert.equal(result.rows.filter((r) => r.agent).length, 2);
  assert.equal(new Set(result.rows.map((r) => r.key)).size, 4);
});

test('child agentKey survives raw ID changes and preserves true lineage without inventing it', () => {
  const x = { id: 'child-1', agentKey: 'opaque-child', parentAgentKey: 'nested-parent', rootSessionKey: 'conversation', relationKind: 'advisor', type: 'helper' };
  const a = stable('run-1', 'conversation', { subs: [x, { id: 'unlinked', type: 'helper' }] });
  const b = { ...a, id: 'run-2', name: 'renamed', subs: [{ ...x, id: 'child-2' }, a.subs[1]] };
  const result = timeline([snap(0, a), snap(10, b)]);
  const children = result.rows.filter((r) => r.agent), child = children.find((r) => r.agentKey === x.agentKey);
  assert.equal(children.length, 2);
  assert.equal(child.agent, 'child-2', 'API lookup retains the latest raw child ID');
  assert.equal(child.sess, 'run-2');
  assert.equal(child.parentAgentKey, 'nested-parent');
  assert.equal(child.rootSessionKey, 'conversation');
  assert.equal(child.relationKind, 'advisor');
  assert.equal(children.find((r) => r.agent === 'unlinked').parentAgentKey, undefined);
});

test('snapshot removal closes only the missing child, not another root with the same raw ID', () => {
  const a = stable('a', 'one', { subs: [{ id: 'child', type: 'worker' }] });
  const b = stable('b', 'two', { subs: [{ id: 'child', type: 'worker' }] });
  const result = timeline([snap(0, a, b), snap(10, { ...a, subs: [] }, b), at(20, { k: 'gone', id: a.id })]);
  assert.equal(result.rows.find((r) => r.agent && r.sess === a.id).totals.work, 10e3);
  assert.equal(result.rows.find((r) => r.agent && r.sess === b.id).totals.work, 60e3);
});

test('a correlated tool end leaves the other parallel tool active and marks terminal failures', () => {
  const s = stable('a', 'conversation');
  const result = timeline([
    event(0, s, 'prompt'),
    event(10, s, 'tool_start', { toolCallId: 'read', category: 'read' }),
    event(20, s, 'tool_start', { toolCallId: 'cmd', category: 'cmd' }),
    event(30, s, 'tool_end', { toolCallId: 'read', phase: 'error' }),
    event(40, s, 'tool_end', { toolCallId: 'cmd', phase: 'aborted' }),
    event(50, s, 'stop'),
  ]);
  const r = result.rows[0];
  assert.ok(contains(r, 35, 'shell'));
  assert.ok(contains(r, 45, 'think'));
  assert.deepEqual(r.marks.filter((m) => ['fail', 'aborted'].includes(m[1])).map((m) => [m[0] - T0, m[1]]), [[30e3, 'fail'], [40e3, 'aborted']]);
  assert.equal(result.totals.work, 50e3);
  assert.equal(result.totals.turn, 10e3);
});

test('duplicate ends, unknown completions and late starts cannot terminate or resurrect a tool', () => {
  const s = stable('a', 'conversation');
  const result = timeline([
    event(0, s, 'tool_start', { toolCallId: 'a', category: 'read' }),
    event(10, s, 'tool_start', { toolCallId: 'b', category: 'cmd' }),
    event(20, s, 'tool_end', { toolCallId: 'a', phase: 'error' }),
    event(21, s, 'tool_end', { toolCallId: 'a', phase: 'completed' }),
    event(22, s, 'tool_start', { toolCallId: 'a', category: 'read' }),
    event(23, s, 'tool_end', { toolCallId: 'unseen', phase: 'completed' }),
    at(24, { k: 'stats', s, post: 'main' }),
    at(40, { k: 'stats', s, post: 'main', toolCallId: 'b', phase: 'completed' }),
  ]);
  const r = result.rows[0];
  assert.ok(contains(r, 35, 'shell'));
  assert.ok(contains(r, 45, 'think'));
  assert.equal(r.marks.filter((m) => m[1] === 'fail').length, 1);
});

test('legacy parallel starts require all anonymous stats before thinking resumes', () => {
  const s = { id: 'a', name: 'old', status: 'work' };
  const result = timeline([
    event(0, s, 'read'), event(10, s, 'bash'),
    at(20, { k: 'stats', s, post: 'main' }), at(30, { k: 'stats', s, post: 'main' }),
    event(40, s, 'stop'),
  ]);
  assert.ok(contains(result.rows[0], 25, 'shell'));
  assert.ok(contains(result.rows[0], 35, 'think'));
  assert.ok(contains(result.rows[0], 45, 'turn'));
});

test('subagent completions are independent from their root tools', () => {
  const s = stable('a', 'conversation', { subs: [{ id: 'child', agentKey: 'child-key', type: 'helper' }] });
  const result = timeline([
    event(0, s, 'tool_start', { toolCallId: 'shared-id', category: 'cmd' }),
    event(5, s, 'tool_start', { agent: 'child', toolCallId: 'shared-id', category: 'read' }),
    at(10, { k: 'stats', s, post: 'child', toolCallId: 'shared-id', phase: 'completed' }),
    at(20, { k: 'stats', s, post: 'main', toolCallId: 'shared-id', phase: 'completed' }),
  ]);
  assert.ok(contains(result.rows.find((r) => !r.agent), 15, 'shell'));
  assert.ok(contains(result.rows.find((r) => r.agent), 15, 'think'));
});

test('unknown, persisted, stale, disconnected and ended spans never contribute exact work or turn', () => {
  const s = runtime();
  const result = timeline([
    snap(0, s),
    changed(10, { ...s, activity: 'unknown' }),
    changed(20, { ...s, connection: 'stale' }),
    changed(30, { ...s, connection: 'disconnected' }),
    changed(40, { ...s, lifecycle: 'ended', connection: 'disconnected', lastTurnOutcome: 'aborted' }),
    changed(50, { ...s, persistedOnly: true, lifecycle: 'historical' }),
  ]);
  assert.deepEqual(kinds(result.rows[0]), ['think', 'unknown', 'stale', 'ended', 'unknown']);
  assert.equal(result.totals.work, 10e3);
  assert.equal(result.totals.unknown, 40e3);
  assert.equal(result.totals.turn, 0);
  assert.equal(result.totals.wait, 0);
  assert.ok(result.rows[0].marks.some((m) => m[1] === 'aborted'));
});

test('a degraded child cannot inherit exact work from an active parent', () => {
  const s = runtime({ subs: [{ id: 'child', type: 'helper', persistedOnly: true }] });
  const result = timeline([snap(0, s)]);
  const child = result.rows.find((r) => r.agent);
  assert.equal(child.totals.work, 0);
  assert.equal(child.totals.unknown, 60e3);
  assert.equal(result.totals.unknown, 0, 'root totals exclude children');
});

test('approval, input, idle and unknown waiting retain different evidence semantics', () => {
  const s = runtime();
  const result = timeline([
    snap(0, { ...s, activity: 'waiting', waitReasons: ['approval'] }),
    changed(10, { ...s, activity: 'waiting', waitReasons: [] }),
    changed(20, { ...s, activity: 'waiting', waitReasons: ['input'] }),
    changed(30, { ...s, activity: 'idle', lastTurnOutcome: 'unknown' }),
    changed(40, { ...s, activity: 'idle', lastTurnOutcome: 'success' }),
  ]);
  assert.deepEqual(kinds(result.rows[0]), ['wait', 'unknown', 'turn', 'idle', 'turn']);
  assert.equal(result.totals.wait, 10e3);
  assert.equal(result.totals.turn, 30e3);
  assert.equal(result.totals.work, 0);
});

test('unknown event types degrade instead of inventing thinking time', () => {
  const s = stable('a', 'conversation');
  const result = timeline([event(0, s, 'future_event')]);
  assert.equal(result.totals.work, 0);
  assert.equal(result.totals.unknown, 60e3);
});

test('terminal session events end child work and never become your-turn time', () => {
  const s = stable('a', 'conversation', { subs: [{ id: 'child', type: 'helper' }] });
  const result = timeline([snap(0, s), event(10, s, 'session_end', { outcome: 'error' })]);
  assert.equal(result.totals.work, 10e3);
  assert.equal(result.totals.turn, 0);
  assert.equal(result.rows.find((r) => r.agent).totals.work, 10e3);
  assert.ok(result.rows[0].marks.some((m) => m[1] === 'fail'));
});

test('legacy your-turn time remains capped and snapshots are reusable across repeated builds', () => {
  const items = [ev(0, 'a', 'prompt'), ev(10, 'a', 'stop')], original = structuredClone(items);
  const result = timeline(items, 7200);
  assert.equal(result.totals.turn, 30 * 60e3);
  assert.deepEqual(timeline(items, 7200), result);
  assert.deepEqual(items, original);
});

test('normal canonical tool events and correlated failure stats preserve another active tool', () => {
  const s = stable('a', 'conversation');
  const result = timeline([
    event(0, s, 'read', { toolCallId: 'a', phase: 'running' }),
    event(10, s, 'bash', { toolCallId: 'b', phase: 'running' }),
    event(20, s, 'fail', { label: 'Tool failed', toolCallId: 'a' }),
    at(20, { k: 'stats', s, post: 'main', toolCallId: 'a', phase: 'error' }),
    at(40, { k: 'stats', s, post: 'main', toolCallId: 'b', phase: 'completed' }),
  ]);
  assert.ok(contains(result.rows[0], 25, 'shell'));
  assert.ok(contains(result.rows[0], 45, 'think'));
  assert.ok(result.rows[0].marks.some((m) => m[1] === 'fail'));
});

test('a confirmed turn end waits for the remaining parallel tool before counting your-turn time', () => {
  const s = stable('a', 'conversation');
  const result = timeline([
    event(0, s, 'read', { toolCallId: 'a' }),
    event(10, s, 'bash', { toolCallId: 'b' }),
    event(20, s, 'turn_end', { outcome: 'aborted' }),
    event(30, s, 'tool_end', { toolCallId: 'a', phase: 'completed' }),
    event(40, s, 'tool_end', { toolCallId: 'b', phase: 'completed' }),
  ]);
  assert.ok(contains(result.rows[0], 35, 'shell'));
  assert.ok(contains(result.rows[0], 45, 'turn'));
  assert.equal(result.totals.work, 40e3);
  assert.equal(result.totals.turn, 20e3);
  assert.ok(result.rows[0].marks.some((m) => m[1] === 'aborted'));
});

test('routine rest snapshots do not settle pending correlated tools or start user-turn totals', () => {
  const s = stable('a', 'conversation'), resting = { ...s, status: 'rest', lastPrompt: 'Recorded task' };
  const result = timeline([
    event(0, s, 'read', { toolCallId: 'a' }), event(10, s, 'bash', { toolCallId: 'b' }),
    event(20, resting, 'stop'), changed(25, resting), snap(27, resting),
    at(30, { k: 'stats', s: resting, toolCallId: 'a', phase: 'completed' }),
    at(40, { k: 'stats', s: resting, toolCallId: 'b', phase: 'completed' }),
  ]);
  assert.ok(contains(result.rows[0], 35, 'shell'));
  assert.ok(contains(result.rows[0], 45, 'turn'));
  assert.equal(result.totals.work, 40e3); assert.equal(result.totals.turn, 20e3);
});

test('new runtime generations can reuse tool IDs without splitting the stable session', () => {
  const a = runtime({ runtimeInstanceId: 'runtime-1', generation: 1 });
  const b = { ...a, runtimeInstanceId: 'runtime-2', generation: 2 };
  const result = timeline([
    event(0, a, 'tool_start', { toolCallId: 'tool', category: 'read' }),
    event(10, a, 'tool_end', { toolCallId: 'tool', phase: 'completed' }),
    event(20, b, 'tool_start', { toolCallId: 'tool', category: 'cmd' }),
    event(30, b, 'tool_end', { toolCallId: 'tool', phase: 'completed' }),
  ]);
  assert.equal(result.rows.length, 1);
  assert.ok(contains(result.rows[0], 25, 'shell'));
  assert.ok(contains(result.rows[0], 35, 'think'));
});

test('an uncorrelated late legacy stats message does not reopen a completed turn', () => {
  const s = { id: 'old', name: 'legacy', status: 'rest' };
  const result = timeline([event(0, s, 'prompt'), event(10, s, 'stop'), at(20, { k: 'stats', s, post: 'main' })]);
  assert.equal(result.totals.work, 10e3);
  assert.equal(result.totals.turn, 50e3);
});

test('legacy test result events settle anonymous tools without treating test outcomes as unknown activity', () => {
  const s = { id: 'old', name: 'legacy', status: 'work' };
  const result = timeline([
    event(0, s, 'test'), event(10, s, 'testok'),
    event(20, s, 'test'), event(30, s, 'testfail'),
    event(40, s, 'stop'),
  ]);
  assert.ok(contains(result.rows[0], 5, 'shell'));
  assert.ok(contains(result.rows[0], 15, 'think'));
  assert.ok(contains(result.rows[0], 35, 'think'));
  assert.equal(result.totals.unknown, 0);
  assert.ok(result.rows[0].marks.some((m) => m[1] === 'fail'));
});

test('test outcome and git notifications do not interrupt correlated parallel work', () => {
  const s = stable('a', 'conversation');
  const result = timeline([
    event(0, s, 'test', { toolCallId: 'test', phase: 'running' }),
    event(5, s, 'read', { toolCallId: 'read', phase: 'running' }),
    event(10, s, 'testok'),
    at(10, { k: 'stats', s, post: 'main', toolCallId: 'test', phase: 'completed' }),
    event(20, s, 'commit'),
    event(30, s, 'cigreen'),
    at(40, { k: 'stats', s, post: 'main', toolCallId: 'read', phase: 'completed' }),
  ]);
  assert.ok(contains(result.rows[0], 15, 'read'));
  assert.ok(contains(result.rows[0], 35, 'read'));
  assert.ok(contains(result.rows[0], 45, 'think'));
  assert.equal(result.totals.unknown, 0);
});

test('a reported event gap is unconfirmed even when legacy status says work', () => {
  const result = timeline([snap(0, runtime({ eventGap: true }))]);
  assert.equal(result.totals.work, 0);
  assert.equal(result.totals.turn, 0);
  assert.equal(result.totals.unknown, 60e3);
});

test('an aborted persisted child gets a terminal marker rather than an exact work span', () => {
  const s = runtime({ doneSubs: [{ id: 'child', agentKey: 'child-key', lifecycle: 'aborted', persistedOnly: true }] });
  const result = timeline([snap(0, s)]);
  const child = result.rows.find((r) => r.agent);
  assert.equal(child.totals.work, 0);
  assert.equal(child.totals.turn, 0);
  assert.deepEqual(kinds(child), ['ended']);
  assert.equal(child.marks[0][1], 'aborted');
});
