import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNormalizer, normalizeOmpLiveEvent, parseProviderModel } from '../../server/agents/omp/normalize.mjs';
import { createOmpLifecycle } from '../../server/agents/omp/lifecycle.mjs';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { createOfficeObserver } from '../../integrations/omp/office-observer.js';
import { header, entry, PRIVATE } from '../fixtures/omp/synthetic.mjs';

function decode(records, options = {}) {
  const n = createNormalizer({ sourceNamespace: 'fixture-attr', ...options });
  records.forEach((r) => n.push(r));
  return n.value();
}

test('T1 & T2: per-entry provider attribution groups by provider/model without model-prefix guessing and handles model ID collisions across providers', () => {
  // Bare model names without explicit provider or qualified "provider/model" MUST stay unknown
  assert.deepEqual(parseProviderModel(undefined, 'gpt-5.2'), { provider: null, model: 'gpt-5.2', modelId: 'gpt-5.2' });
  assert.deepEqual(parseProviderModel(undefined, 'gemini-4-argon'), { provider: null, model: 'gemini-4-argon', modelId: 'gemini-4-argon' });
  assert.deepEqual(parseProviderModel(undefined, 'openai-codex/gpt-5.2'), { provider: 'openai-codex', model: 'openai-codex/gpt-5.2', modelId: 'gpt-5.2' });
  assert.deepEqual(parseProviderModel('google-antigravity', 'gemini-4-argon'), { provider: 'google-antigravity', model: 'gemini-4-argon', modelId: 'gemini-4-argon' });

  // Session switching between openai-codex, plain openai (with same model id gpt-5.2!), google-antigravity, and bare unknown model
  const records = [
    header(),
    entry('m1', null, {
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'openai-codex',
        model: 'gpt-5.2',
        usage: { input: 100, output: 50, cacheRead: 20, cacheWrite: 0, cost: { total: 0.25 } },
        content: [{ type: 'text', text: 'turn 1' }],
      },
    }),
    entry('m2', 'm1', {
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'openai',
        model: 'gpt-5.2',
        usage: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } },
        content: [{ type: 'text', text: 'turn 2 on plain openai API' }],
      },
    }),
    entry('m3', 'm2', {
      type: 'model_usage',
      provider: 'google-antigravity',
      model: 'gemini-4-argon',
      usage: { input: 300, output: 120, cacheRead: 50, cacheWrite: 10, cost: { total: 0.75 } },
    }),
    entry('m4', 'm3', {
      type: 'message',
      message: {
        role: 'assistant',
        model: 'gpt-5.2', // no provider field and not qualified -> must go to 'unknown', NOT 'openai-codex' or 'openai'!
        usage: { input: 40, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.1 } },
        content: [{ type: 'text', text: 'turn 4 bare model' }],
      },
    }),
  ];

  const snap = decode(records);
  assert.equal(snap.metrics.cost.value, 1.6);
  assert.equal(snap.metrics.tokens.input, 640);
  assert.equal(snap.metrics.tokens.output, 260);

  const byProv = snap.metrics.byProvider;
  assert.deepEqual(
    byProv.map((b) => [b.providerId, b.entries, b.tokens.input, b.cost?.value, b.accountKey, b.attribution]),
    [
      ['google-antigravity', 1, 300, 0.75, null, 'unattributed'],
      ['openai', 1, 200, 0.5, null, 'unattributed'],
      ['openai-codex', 1, 100, 0.25, null, 'unattributed'],
      ['unknown', 1, 40, 0.1, null, 'unattributed'],
    ]
  );

  // Sum of provider buckets equals session total (no double counting)
  const bucketCostSum = byProv.reduce((sum, b) => sum + (b.cost?.value || 0), 0);
  const bucketInputSum = byProv.reduce((sum, b) => sum + (b.tokens.input || 0), 0);
  assert.equal(bucketCostSum, snap.metrics.cost.value);
  assert.equal(bucketInputSum, snap.metrics.tokens.input);
});

test('T3 & T4: null cost stays null (never estimated), recorded 0 is 0, inherited scope is preserved, and account attribution stays unattributed', () => {
  // Provider without cost (e.g. null cost) alongside provider with 0 cost
  const records = [
    header({ parentSession: 'parent-1' }), // fork -> inherited scope
    entry('a1', null, {
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'google-antigravity',
        model: 'gemini-4-argon',
        usage: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 }, // no cost field -> null
        content: [],
      },
    }),
    entry('a2', 'a1', {
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'openai-codex',
        model: 'gpt-5.2',
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, // explicit 0 cost
        content: [],
      },
    }),
    // Even if credential_pin or credentialId is present in JSONL, it must not leak or fabricate account attribution
    entry('pin', 'a2', {
      type: 'credential_pin',
      provider: 'openai-codex',
      hash: PRIVATE,
    }),
  ];

  const snap = decode(records);
  assert.equal(snap.metrics.cost, null, 'overall session cost is null when one entry has unknown cost');
  assert.equal(snap.metrics.tokens.input, 600);

  const agyBucket = snap.metrics.byProvider.find((b) => b.providerId === 'google-antigravity');
  const codexBucket = snap.metrics.byProvider.find((b) => b.providerId === 'openai-codex');
  assert.equal(agyBucket.cost, null, 'Antigravity bucket cost remains null, not 0');
  assert.equal(agyBucket.tokens.input, 500);
  assert.equal(codexBucket.cost.value, 0, 'Codex bucket with recorded 0 cost has value 0');
  assert.equal(codexBucket.cost.scope, 'inherited');
  assert.equal(codexBucket.accountKey, null);
  assert.equal(codexBucket.attribution, 'unattributed');

  const projected = projectOmpSession({
    sourceNamespace: 'fixture-attr',
    sourceSessionId: 's1',
    persistedOnly: true,
    readerState: 'ready',
    provider: snap.provider,
    model: snap.model,
    metrics: snap.metrics,
  });
  assert.equal(projected.provider, 'openai-codex');
  assert.equal(projected.metrics.byProvider.length, 2);
  assert.equal(JSON.stringify(projected).includes(PRIVATE), false);
});

test('T3: live observer sends safe provider, and mid-session runtime provider changes keep provisional snapshot unallocated until durable file replaces it', () => {
  const sent = [];
  const observer = createOfficeObserver({
    token: 'a'.repeat(64),
    sourceId: 'src-1',
    url: 'http://127.0.0.1:4310/ingest/omp/v1',
    transport: {
      send: async (body) => {
        sent.push(...body.events);
        return { status: 200, json: { results: [] } };
      },
    },
    setTimer: (fn) => {
      fn();
      return 1;
    },
    clearTimer: () => {},
  });

  const handlers = new Map();
  observer({
    on: (name, fn) => handlers.set(name, fn),
  });

  const ctx = {
    sessionManager: {
      getSessionId: () => 'sess-live-1',
      getUsageStatistics: () => ({ input: 120, output: 30, cacheRead: 10, cacheWrite: 0, cost: 0.42 }),
    },
    model: { id: 'gemini-4-argon', provider: 'google-antigravity', apiKey: PRIVATE },
    isIdle: () => true,
  };

  handlers.get('session_start')({}, ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.model, 'gemini-4-argon');
  assert.equal(sent[0].data.provider, 'google-antigravity');
  assert.equal(JSON.stringify(sent[0]).includes(PRIVATE), false);

  // Lifecycle tracks provisional provider and unallocates if provider switches mid-session without per-entry breakdown
  const life = createOmpLifecycle();
  const ev1 = normalizeOmpLiveEvent(sent[0]);
  life.ingest(ev1);
  const s1 = life.resolve( 'omp:' + '0'.repeat(64) ) || life.list()[0];
  assert.equal(s1.provider, 'google-antigravity');
  assert.equal(s1.metrics.byProvider[0].providerId, 'google-antigravity');
  assert.equal(s1.metrics.byProvider[0].tokens.provenance, 'provisional');

  // Switch provider mid-session on heartbeat 2: cumulative runtime snapshot becomes 'unknown' provider bucket
  const ev2 = normalizeOmpLiveEvent({
    ...sent[0],
    sequence: 2,
    type: 'heartbeat',
    data: {
      isIdle: true,
      model: 'gpt-5.2',
      provider: 'openai-codex',
      usage: { input: 250, output: 60, cacheRead: 10, cacheWrite: 0, cost: 0.85 },
    },
  });
  life.ingest(ev2);
  const s2 = life.list()[0];
  assert.equal(s2.provider, 'openai-codex');
  assert.equal(s2.metrics.byProvider[0].providerId, 'unknown', 'cumulative runtime total across multiple providers stays unallocated');
});
