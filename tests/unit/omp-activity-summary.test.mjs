import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  sanitizeSafeSubject,
  extractSafeBasename,
  classifyRpcToolExecution,
  normalizeActivitySummary,
  deriveLiveActivitySummary,
} from '../../server/agents/omp/activity-summary.mjs';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { createT } from '../../src/i18n/index.js';

const RT_A = '00000000-0000-4000-8000-000000000011';
const RT_B = '00000000-0000-4000-8000-000000000022';

test('sanitizeSafeSubject and extractSafeBasename enforce local opt-in, strip paths, and reject secrets/URLs/traversal', () => {
  assert.equal(sanitizeSafeSubject('workers.js', { allowSubject: false }), null);
  assert.equal(sanitizeSafeSubject('workers.js', { allowSubject: true }), 'workers.js');
  assert.equal(sanitizeSafeSubject('src/office/people/workers.js', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('..', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('.env.local', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('api_secret_key.json', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('private-token.txt', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('https://example.com/a.js', { allowSubject: true }), null);
  assert.equal(sanitizeSafeSubject('a'.repeat(40), { allowSubject: true }), null);

  assert.equal(extractSafeBasename('E:\\vide-code\\my-office\\src\\office\\people\\workers.js:140-167', { allowSubject: true }), 'workers.js');
  assert.equal(extractSafeBasename('E:\\vide-code\\my-office\\src\\office\\people\\workers.js', { allowSubject: false }), null);
  assert.equal(extractSafeBasename('E:\\vide-code\\my-office\\.env', { allowSubject: true }), null);
  assert.equal(extractSafeBasename('https://internal.corp/secret.js', { allowSubject: true }), null);
});

test('classifyRpcToolExecution maps read/edit/test/cmd/web and never captures raw command or file path', () => {
  assert.deepEqual(
    classifyRpcToolExecution('read', { path: 'E:\\repo\\src\\index.mjs:10-50' }, { allowSubject: false }),
    { kind: 'read' },
  );
  assert.deepEqual(
    classifyRpcToolExecution('read', { path: 'E:\\repo\\src\\index.mjs:10-50' }, { allowSubject: true }),
    { kind: 'read', safeSubject: 'index.mjs' },
  );
  assert.deepEqual(
    classifyRpcToolExecution('edit', { path: 'E:\\repo\\env\\.env.production' }, { allowSubject: true }),
    { kind: 'edit' },
  );
  assert.deepEqual(
    classifyRpcToolExecution('bash', { command: 'node --test tests/unit/omp-activity-summary.test.mjs --secret=123' }, { allowSubject: true }),
    { kind: 'test' },
  );
  assert.deepEqual(
    classifyRpcToolExecution('bash', { command: 'git status -s' }, { allowSubject: true }),
    { kind: 'cmd' },
  );
  assert.deepEqual(
    classifyRpcToolExecution('web_search', { query: 'private query' }, { allowSubject: true }),
    { kind: 'web' },
  );
});

test('deriveLiveActivitySummary enforces priority: waiting > active tool > processing > idle > stale/disconnected/ended/gap', () => {
  const now = 100_000;
  const baseLive = {
    runtimeInstanceId: RT_A,
    generation: 2,
    sequence: 10,
    observedAt: now,
    connection: 'connected',
    lifecycle: 'open',
    activity: 'active',
    toolCategories: ['read'],
    waitReasons: [],
    gap: false,
  };

  // Observer-only category: never invents a filename
  const obsRead = deriveLiveActivitySummary(baseLive, { allowSubject: true, now });
  assert.deepEqual(obsRead, {
    kind: 'read',
    source: 'observerCategory',
    runtimeInstanceId: RT_A,
    generation: 2,
    eventSequence: 10,
    observedAt: now,
  });

  // Waiting overrides active tool
  const waiting = deriveLiveActivitySummary({
    ...baseLive,
    activity: 'waiting',
    waitReasons: ['approval'],
  }, { allowSubject: true, now });
  assert.equal(waiting.kind, 'waiting');
  assert.equal(waiting.safeSubject, undefined);

  // Generic processing when active with no specific tool category
  const proc = deriveLiveActivitySummary({
    ...baseLive,
    toolCategories: [],
  }, { allowSubject: false, now });
  assert.equal(proc.kind, 'processing');

  // Idle clears active work
  const idle = deriveLiveActivitySummary({
    ...baseLive,
    activity: 'idle',
    toolCategories: [],
  }, { allowSubject: false, now });
  assert.equal(idle.kind, 'idle');

  // Stale, disconnected, ended, eventGap or persistedOnly clear summary to null
  for (const ClearCase of [
    { connection: 'stale' },
    { connection: 'disconnected' },
    { lifecycle: 'ended' },
    { gap: true },
    { persistedOnly: true },
    { activity: 'unknown' },
  ]) {
    assert.equal(deriveLiveActivitySummary({ ...baseLive, ...ClearCase }, { allowSubject: true, now }), null);
  }
});

test('normalizeActivitySummary rejects mismatched runtimeInstanceId, old generation or expired TTL', () => {
  const now = 500_000;
  const raw = {
    kind: 'edit',
    safeSubject: 'schema.mjs',
    source: 'managedRpc',
    runtimeInstanceId: RT_A,
    generation: 3,
    eventSequence: 7,
    observedAt: now - 1000,
  };
  assert.equal(normalizeActivitySummary(raw, { expectedRuntimeInstanceId: RT_A, expectedGeneration: 3, allowSubject: true, now }).safeSubject, 'schema.mjs');
  assert.equal(normalizeActivitySummary(raw, { expectedRuntimeInstanceId: RT_B, expectedGeneration: 3, allowSubject: true, now }), null);
  assert.equal(normalizeActivitySummary(raw, { expectedRuntimeInstanceId: RT_A, expectedGeneration: 4, allowSubject: true, now }), null);
  assert.equal(normalizeActivitySummary({ ...raw, observedAt: now - 60_000 }, { expectedRuntimeInstanceId: RT_A, expectedGeneration: 3, allowSubject: true, now, ttlMs: 45_000 }), null);
});

test('two simultaneous OMP sessions (my-office and auto-pmh) keep isolated bubbles, respect 80-char cap and Streamer/remote privacy', () => {
  const s1 = projectOmpSession({
    sourceNamespace: 'src-1',
    sourceSessionId: 'sess-my-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_A,
      generation: 1,
      sequence: 5,
      observedAt: 200_000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['edit'],
      activitySummary: {
        kind: 'edit',
        safeSubject: 'workers.js',
        source: 'managedRpc',
        runtimeInstanceId: RT_A,
        generation: 1,
        eventSequence: 5,
        observedAt: 200_000,
      },
    },
  });
  const s2 = projectOmpSession({
    sourceNamespace: 'src-2',
    sourceSessionId: 'sess-auto-pmh',
    project: 'auto-pmh',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_B,
      generation: 1,
      sequence: 3,
      observedAt: 200_000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['read'],
    },
  });

  assert.notEqual(s1.id, s2.id);
  assert.equal(s1.activitySummary.kind, 'edit');
  assert.equal(s1.activitySummary.safeSubject, 'workers.js');
  assert.equal(s2.activitySummary.kind, 'read');
  assert.equal(s2.activitySummary.safeSubject, undefined);

  // Evaluate ompBubbleView in isolated VM with Vietnamese and English locales
  const eventTextSrc = fs.readFileSync(new URL('../../src/office/ui/event-text.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export (?=(?:const|let|function|async function)\b)/gm, '');
  const viTr = createT('vi');
  const state = { streamer: false, isLocal: true };
  const replay = { on: false };
  const { ompBubbleView } = vm.runInNewContext(eventTextSrc + '\n;({ ompBubbleView })', {
    state, replay, PRO: true, cap: (x) => x, tr: viTr,
  });

  const b1 = ompBubbleView(s1, { fallbackText: 'fallback' });
  const b2 = ompBubbleView(s2, { fallbackText: 'fallback' });
  assert.equal(b1.text, 'Đang sửa workers.js');
  assert.equal(b2.text, 'Đang đọc file');
  assert.ok(b1.text.length <= 80 && b2.text.length <= 80);

  // Streamer mode hides safeSubject immediately
  state.streamer = true;
  assert.equal(ompBubbleView(s1, { fallbackText: 'fallback' }).text, 'Đang sửa code');

  // Remote viewer or replay mode never displays subject detail
  state.streamer = false;
  state.isLocal = false;
  assert.equal(ompBubbleView(s1, { fallbackText: 'fallback' }).text, 'Đang sửa code');
  state.isLocal = true;
  replay.on = true;
  assert.equal(ompBubbleView(s1, { fallbackText: 'fallback' }).text, 'Đang sửa code');
});
