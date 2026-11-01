import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNormalizer, toolCategory } from '../../server/agents/omp/normalize.mjs';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { header, entry, assistant, usage, titleSlot, PRIVATE } from '../fixtures/omp/synthetic.mjs';

const normalizer = (options = {}) => createNormalizer({ sourceNamespace: 'fixture-wsl-a', ...options });
function decode(records, options) { const n = normalizer(options); records.forEach((r) => n.push(r)); return n.value(); }

test('F1/F2: v3 header-only is historical; unsupported schemas degrade', () => {
  const good = decode([header()]);
  assert.equal(good.supported, true); assert.equal(good.lifecycle, 'historical');
  assert.equal(good.metrics.cost, null); assert.deepEqual(good.items, []);
  for (const version of [undefined, 1, 2, 999]) {
    const value = decode([header({ version }), assistant('a', null)]);
    assert.equal(value.supported, false); assert.ok(value.diagnostics.includes('unsupported-header'));
  }
});

test('F1: title slot is 256 UTF-8 bytes and optional, not title text metadata', () => {
  const b = titleSlot('Ti\u1ebfng Vi\u1ec7t'), n = normalizer();
  assert.equal(b.length, 256);
  n.push(JSON.parse(b), { bytes: 256, offset: 0 }); n.push(header());
  assert.equal(n.value().supported, true); assert.equal('title' in n.value(), false);
  const bad = normalizer(); bad.push(JSON.parse(b), { bytes: 255 }); bad.push(header());
  assert.equal(bad.value().supported, false);
  const duplicate = normalizer(); duplicate.push(JSON.parse(b), { bytes: 256 }); duplicate.push(JSON.parse(b), { bytes: 256 }); duplicate.push(header());
  assert.equal(duplicate.value().supported, false, 'only one leading title slot is supported');
});

const tree = () => [header(), entry('root', null), assistant('a', 'root'), assistant('b', 'root', { model: 'fixture/model-b' })];
test('F7: captured leaf, null, missing and dangling have distinct branch semantics', () => {
  const late = { type: 'model_usage', usage: usage(0.1), model: 'fixture/tiny' };
  const selected = decode([...tree(), entry('late', 'b', { ...late, activeLeafId: 'a' })], { includeContent: true });
  assert.deepEqual(selected.items.map((i) => i.text), ['Synthetic message root', 'Synthetic assistant a']);
  assert.equal(selected.model, 'fixture/model-a');
  assert.deepEqual(decode([...tree(), entry('late', 'b', { ...late, activeLeafId: null })], { includeContent: true }).items, []);
  const missing = decode([...tree(), entry('late', 'b', late)], { includeContent: true });
  assert.equal(missing.items.at(-1).text, 'Synthetic assistant b');
  const dangling = decode([...tree(), entry('late', 'b', { ...late, activeLeafId: 'absent' })], { includeContent: true });
  assert.equal(dangling.items.at(-1).text, 'Synthetic assistant b');
  assert.ok(dangling.diagnostics.includes('leaf-fallback'));
});

test('F7: reset, compaction and branch summaries retain the declared active-context view', () => {
  const before = entry('before', null), keep = assistant('keep', 'before');
  const compact = entry('compact', 'keep', { type: 'compaction', firstKeptEntryId: 'keep', summary: 'Synthetic condensed history' });
  const summary = entry('summary', 'compact', { type: 'branch_summary', fromId: 'other-branch', summary: 'Synthetic branch summary' });
  const result = decode([header(), before, keep, compact, summary], { includeContent: true });
  assert.deepEqual(result.items.map((i) => i.text), ['Synthetic condensed history', 'Synthetic assistant keep', 'Synthetic branch summary']);
  const reset = decode([header(), before, keep, compact, entry('reset', 'compact', { type: 'reset_boundary' }), entry('after', 'reset')], { includeContent: true });
  assert.deepEqual(reset.items.map((i) => i.text), ['', 'Synthetic message after']);
  assert.equal(reset.items[0].kind, 'reset_boundary');
  const invalid = decode([header(), before, entry('c', 'before', { type: 'compaction', firstKeptEntryId: 'not-present' })]);
  assert.equal(invalid.incomplete, true);
});

test('F7: cycle, missing parent and capped tree are explicitly incomplete', () => {
  for (const records of [[header(), entry('a', 'b'), entry('b', 'a')], [header(), entry('a', 'missing')]]) {
    const r = decode(records); assert.equal(r.incomplete, true); assert.ok(r.diagnostics.some((c) => ['branch-cycle', 'missing-parent'].includes(c)));
  }
  const capped = decode([header(), entry('a', null), assistant('b', 'a')], { maxEntries: 1 });
  assert.equal(capped.incomplete, true); assert.equal(capped.indexEntries, 1); assert.equal(capped.metrics.cost, null);
  assert.ok(capped.diagnostics.includes('index-limit'));
});

test('a long session keeps the newest part of the active branch instead of an empty one', () => {
  const records = [header()];
  for (let i = 0; i < 40; i++) records.push(assistant('m' + i, i ? 'm' + (i - 1) : null));
  const r = decode(records, { includeContent: true, maxEntries: 10 });
  assert.equal(r.incomplete, true); assert.equal(r.indexEntries, 10);
  assert.ok(r.diagnostics.includes('index-limit'));
  assert.equal(r.items.length, 10, 'the tail is shown, not an empty branch');
  assert.equal(r.items.at(-1).text, 'Synthetic assistant m39'); assert.equal(r.items[0].text, 'Synthetic assistant m30');
  assert.equal(r.metrics.cost, null, 'a partial ledger never reports a total');
  assert.equal(r.tools.length, 0);
  const byBytes = decode(records, { includeContent: true, maxIndexBytes: 2500 });
  assert.ok(byBytes.indexBytes <= 2500); assert.ok(byBytes.items.length > 0 && byBytes.items.at(-1).text === 'Synthetic assistant m39');
});

test('F8: fork and continuation provenance never imply subagent or live termination', () => {
  for (const [lineage, relation] of [[{ parentSession: '/not-readable/parent' }, 'fork'], [{ parentSession: 'parent', continuationOf: 'parent' }, 'continuation']]) {
    const r = decode([header(lineage), assistant('a', null), entry('exit', 'a', { type: 'custom', customType: 'session_exit', data: { runtime: 'old' } }), assistant('resumed', 'exit')]);
    assert.equal(r.relationKind, relation); assert.equal(r.metrics.cost.scope, 'inherited');
    assert.equal(r.metrics.cost.value, 2); assert.equal(r.lifecycle, 'historical'); assert.equal(r.exitEvidence, true);
  }
});

test('F13: writer build stamp cannot supply process or activation identity', () => {
  const r = decode([header(), entry('a', null, { runtime: { version: '18.14.0', label: PRIVATE, pid: 123 } })]);
  assert.equal(r.lifecycle, 'historical'); assert.equal(r.runtimeInstanceId, undefined);
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_PRIVATE/);
});

test('S4/S9: metadata drops prompt, title, arguments, output, cache keys and custom secrets', () => {
  const r = decode([header({ title: PRIVATE, previousSessionFiles: [PRIVATE], seanceSource: PRIVATE, providerPromptCacheKey: PRIVATE }),
    entry('u', null, { message: { role: 'user', content: PRIVATE } }),
    assistant('a', 'u', { content: [{ type: 'text', text: PRIVATE }, { type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: PRIVATE } }] }),
    entry('t', 'a', { message: { role: 'toolResult', toolCallId: 'tool-1', content: [{ type: 'text', text: PRIVATE }] } }),
    entry('custom', 't', { type: 'custom', customType: PRIVATE, data: { secret: PRIVATE } }),
    entry('credential', 'custom', { type: 'credential_pin', hash: PRIVATE, reason: PRIVATE }),
    entry('unknown', 'credential', { type: PRIVATE, payload: PRIVATE })]);
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_PRIVATE/);
  assert.doesNotMatch(JSON.stringify(projectOmpSession(r)), /SYNTHETIC_PRIVATE/);
  assert.deepEqual(r.items, []); assert.equal(r.counts.cmd, 1);
});

test('conversation is explicit text-only opt-in with size bounds, no image/blob dereference', () => {
  const poison = '<script>synthetic()</script>';
  const r = decode([header(), entry('a', null, { message: { role: 'user', content: [{ type: 'text', text: poison }, { type: 'image', data: PRIVATE }] } }), assistant('b', 'a', { content: [{ type: 'text', text: 'Synthetic text. '.repeat(400) }, { type: 'thinking', thinking: PRIVATE }] })], { includeContent: true });
  assert.equal(r.items[0].text, poison, 'text stays inert; UI owns DOM rendering');
  assert.equal(r.items[1].text.length, 4000); assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_PRIVATE/);
});

test('conversation redacts long opaque synthetic strings before applying the text cap', () => {
  const r = decode([header(), assistant('a', null, { content: 'x'.repeat(6000) })], { includeContent: true });
  assert.equal(r.items[0].text, '\u2022\u2022\u2022');
  assert.doesNotMatch(r.items[0].text, /x/);
});

test('tool requests stay requested, parallel calls remain independent, results are terminal', () => {
  const records = [header(), assistant('a', null, { content: [{ type: 'toolCall', id: '1', name: 'read' }, { type: 'toolCall', id: '2', name: 'bash' }] }),
    entry('result', 'a', { message: { role: 'toolResult', toolCallId: '2', isError: true } })];
  const r = decode(records); assert.deepEqual(r.tools.map((i) => [i.id, i.phase]), [['1', 'requested'], ['2', 'error']]);
  assert.equal(r.counts.read, 1); assert.equal(r.counts.cmd, 1);
  assert.equal(r.tools.some((i) => i.phase === 'running'), false);
});

test('unverified/custom/prototype tool names remain neutral', () => {
  for (const name of ['Read', 'mcp__read', 'unknown', '__proto__', 'constructor', null]) assert.equal(toolCategory(name), 'other');
  assert.equal(toolCategory('read'), 'read'); assert.equal(toolCategory('bash'), 'cmd');
});

test('U3: duplicate entries never rewind the selected branch or add usage twice', () => {
  const first = assistant('a', null), second = assistant('b', 'a');
  const n = normalizer({ includeContent: true }); [header(), first, second].forEach((r) => n.push(r));
  const before = n.value(); n.push(first);
  assert.deepEqual(n.value(), before);
  n.push(assistant('a', null, { content: 'Different synthetic content', usage: usage(999) }));
  assert.equal(n.value().metrics.cost, null, 'conflicting IDs invalidate certainty, not add spend');
  assert.ok(n.value().diagnostics.includes('conflicting-entry-id'));
  assert.equal(n.value().items.at(-1).text, 'Synthetic assistant b');
});

test('evicted entry retransmissions cannot rewind the retained branch or resurrect old usage', () => {
  const a = assistant('a', null), n = normalizer({ includeContent: true, maxEntries: 2 });
  [header(), a, assistant('b', 'a'), assistant('c', 'b')].forEach((r) => n.push(r));
  const before = n.value();
  n.push(a); n.push(assistant('a', null, { content: 'Changed retransmission', usage: usage(999) }));
  assert.deepEqual(n.value().items, before.items);
  assert.equal(n.value().observedAt, before.observedAt);
  assert.equal(n.value().incomplete, true); assert.equal(n.value().metrics.cost, null);
  assert.ok(n.value().diagnostics.includes('possible-duplicate-entry-id'));
  n.push(assistant('d', 'c'));
  assert.equal(n.value().items.at(-1).text, 'Synthetic assistant d');
  n.push(assistant('new-branch', 'a'));
  assert.equal(n.value().items.at(-1).text, 'Synthetic assistant new-branch');
  assert.ok(n.value().diagnostics.includes('missing-parent'));
});

test('possible-duplicate membership is bounded and saturation explicitly degrades rather than rewinding', () => {
  const n = normalizer({ includeContent: true, maxEntries: 2, maxIndexBytes: 1024 });
  n.push(header());
  for (let i = 0; i < 3000; i++) n.push(assistant('saturated-' + i, i ? 'saturated-' + (i - 1) : null));
  const before = n.value();
  assert.equal(before.incomplete, true); assert.ok(before.indexBytes <= 1024);
  assert.ok(before.diagnostics.includes('possible-duplicate-entry-id'));
  n.push(assistant('saturated-0', null));
  assert.deepEqual(n.value().items, before.items);
  const rebuilt = decode([header(), assistant('saturated-0', null)], { includeContent: true, maxIndexBytes: 1024 });
  assert.equal(rebuilt.items.at(-1).text, 'Synthetic assistant saturated-0');
  assert.equal(rebuilt.incomplete, false);
});

test('bounded tree and per-message tool caps are visible, not silent truncation', () => {
  const bytes = decode([header(), entry('a', null)], { maxIndexBytes: 1 });
  assert.equal(bytes.indexEntries, 0); assert.equal(bytes.incomplete, true);
  const tools = decode([header(), assistant('a', null, { content: Array.from({ length: 65 }, (_, i) => ({ type: 'toolCall', id: 't' + i, name: 'read' })) })]);
  assert.ok(tools.tools.length <= 64); assert.equal(tools.incomplete, true); assert.ok(tools.diagnostics.includes('tool-limit'));
});
