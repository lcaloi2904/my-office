import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage, usageRecord } from '../../server/agents/omp/usage.mjs';
import { createNormalizer } from '../../server/agents/omp/normalize.mjs';
import { header, assistant, entry, usage } from '../fixtures/omp/synthetic.mjs';

const summarize = (raws, options) => aggregateUsage(raws.map((u) => ({ usage: usageRecord(u) })), options);
test('U1: absent, invalid and partial measurements stay unknown; zero is measured', () => {
  assert.equal(summarize([undefined]).cost, null);
  assert.equal(summarize([{ input: 12 }]).tokens.input, 12);
  assert.equal(summarize([{ input: 12 }]).tokens.output, null);
  for (const value of [-1, Infinity, NaN, '9', null]) assert.equal(usageRecord({ input: value }).input, null);
  const zero = summarize([{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }]);
  assert.equal(zero.cost.value, 0); assert.equal(zero.tokens.output, 0);
  assert.equal(zero.cost.provenance, 'recorded');
});
test('U1/U3: assistant and model_usage contribute distinct durable records, not extra chat', () => {
  const n = createNormalizer({ sourceNamespace: 'fixture', includeContent: true });
  const a = assistant('a', null), m = entry('m', 'a', { type: 'model_usage', purpose: 'synthetic-summary', usage: usage(0.5), activeLeafId: 'a' });
  [header(), a, m, a, m].forEach((r) => n.push(r));
  const value = n.value();
  assert.equal(value.metrics.cost.value, 1.5); assert.equal(value.metrics.tokens.input, 20);
  assert.equal(value.items.length, 1); assert.equal(value.metrics.context, null);
});
test('U2: inherited history scope does not become self spend or a cross-session aggregate', () => {
  const fork = summarize([usage(5), usage(2)], { inherited: true });
  assert.equal(fork.cost.value, 7); assert.equal(fork.cost.scope, 'inherited');
  assert.equal(fork.subtree, undefined);
});
test('U3: rebuilding replaces totals instead of incrementing a process-global counter', () => {
  const run = (cost) => { const n = createNormalizer({ sourceNamespace: 'fixture' }); [header(), assistant('a', null, { usage: usage(cost) })].forEach((r) => n.push(r)); return n.value().metrics; };
  assert.deepEqual(run(2), run(2)); assert.equal(run(3).cost.value, 3);
});
test('U4: model switches and compaction never invent a context window or Claude pricing', () => {
  const n = createNormalizer({ sourceNamespace: 'fixture' });
  [header(), assistant('a', null), entry('change', 'a', { type: 'model_change', model: 'fixture/model-b' }), entry('compact', 'change', { type: 'compaction', firstKeptEntryId: 'a', tokensAfter: 500 })].forEach((r) => n.push(r));
  assert.equal(n.value().metrics.context, null); assert.equal(n.value().metrics.cost.value, 1);
});
test('incomplete inputs and overflow cannot masquerade as exact spend', () => {
  assert.equal(summarize([usage()], { incomplete: true }).cost, null);
  assert.equal(summarize([usage()], { incomplete: true }).tokens.provenance, 'unknown');
  assert.equal(summarize([usage(Number.MAX_VALUE), usage(Number.MAX_VALUE)]).cost, null);
  assert.equal(summarize([usage(), {}]).cost, null);
});
