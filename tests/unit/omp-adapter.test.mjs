import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createOmpAdapter } from '../../server/agents/omp/index.mjs';
import { createAgentRegistry } from '../../server/agents/registry.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';
import { fixture, readonlyIO, header, entry, assistant, lines, titleSlot, PRIVATE } from '../fixtures/omp/synthetic.mjs';

const idOf = (sessionId, ns = 'fixture') => ompSessionIdentity(ns, sessionId).id;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const session = (id, extra = {}) => lines([header({ id, cwd: '/fixture/projects/repo-a', ...extra }), assistant('m-' + id, null)]);

// Timers never fire on their own: tests drive the adapter with refresh(), so nothing is time-dependent.
function harness(t, f, { conversation = false, limits = {}, pinStore = null, sources, wrap = (io) => io } = {}) {
  const { io: base, stats } = readonlyIO(), io = wrap(base), timers = new Set(), changes = [];
  const adapter = createOmpAdapter({
    io, pinStore, onChange: (ids) => changes.push(...ids),
    setTimer: (fn) => { const h = { fn, unref() {} }; timers.add(h); return h; }, clearTimer: (h) => timers.delete(h),
    config: { version: 1, limits, sources: sources || [{ id: 'fixture', root: f.source, pathStyle: 'posix', conversation,
      projectMappings: [{ from: '/fixture/projects/repo-a', projectId: 'repo', worktreeId: 'main' }] }] },
  });
  t.after(() => adapter.dispose());
  return { adapter, io, stats, timers, changes };
}
async function put(f, rel, body, mtime) {
  const file = path.join(f.source, ...rel.split('/'));
  await f.fs.mkdir(path.dirname(file), { recursive: true });
  await f.fs.writeFile(file, body);
  if (mtime) await f.fs.utimes(file, mtime, mtime);
  return file;
}
async function digestTree(dir) {
  const out = [];
  for (const d of await (await import('node:fs/promises')).readdir(dir, { recursive: true, withFileTypes: true })) {
    const parent = d.parentPath ?? d.path;   // (parentPath arrived in Node 20.12; engines allow 20.9)
    if (d.isFile()) out.push(parent + path.sep + d.name + ':' + sha(await (await import('node:fs/promises')).readFile(path.join(parent, d.name))));
  }
  return out.sort();
}

test('disabled lifecycle: an adapter that is never started touches no files and owns no timers', async (t) => {
  const f = await fixture(t);
  const h = harness(t, f);
  assert.deepEqual(h.adapter.list(), []); assert.equal(h.stats.opened, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.adapter.status().timers, 0);
  await h.adapter.dispose();
  await h.adapter.dispose();
  assert.equal(h.adapter.status().state, 'disposed');
});

test('F12: multi-file discovery is shallow, paged, labelled by heuristic and leaks no header content', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000;
  for (let i = 0; i < 20; i++) await put(f, `proj/2026_s${i}.jsonl`, session('s' + i, { title: PRIVATE }), base - i * 10);
  await put(f, 'notes.txt', 'ignore me', base);
  await put(f, 'proj/2026_s0/sub/child.jsonl', session('child-of-s0'), base);
  const before = await digestTree(f.source);
  const h = harness(t, f);
  await h.adapter.start(); await h.adapter.refresh();
  const first = h.adapter.catalog({ limit: 8 });
  assert.equal(first.items.length, 8); assert.equal(first.total, 20); assert.equal(first.next, '8');
  assert.equal(first.items[0].id, idOf('s0')); assert.equal(first.items[0].children, 1);
  assert.equal(first.items[0].label, 'recent'); assert.equal(first.items[0].liveness, 'unknown');
  assert.equal(first.items[0].project, 'repo-a'); assert.match(first.items[0].projectKey, /^[0-9a-f]{64}$/);
  const last = h.adapter.catalog({ cursor: '16', limit: 50 });
  assert.equal(last.items.length, 4); assert.equal(last.next, null); assert.ok(last.items.every((x) => x.label === 'history'));
  assert.equal(h.adapter.catalog({ kind: 'history', limit: 50 }).total, 4);
  assert.equal(h.adapter.catalog({ limit: 9999 }).items.length, 20);
  // Neither the catalogue nor the diagnostics may carry paths, titles, session ids or cwd values.
  const text = JSON.stringify([first, last, h.adapter.status()]);
  for (const secret of [PRIVATE, f.source, '/fixture/projects', 'proj/', 'child.jsonl', '"s0"', 'session.jsonl']) assert.ok(!text.includes(secret), secret);
  assert.ok(h.stats.maxActive <= 1, 'at most one handle at a time');
  assert.equal(h.stats.active, 0);
  assert.deepEqual(await digestTree(f.source), before);
});

test('F9 (path candidates only): artifact children stay historical, are never listed or pinnable as actors', async (t) => {
  const f = await fixture(t);
  await put(f, 'p/2026_main.jsonl', session('main'));
  await put(f, 'p/2026_main/agents/sub.jsonl', session('sub'));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh();
  const page = h.adapter.catalog();
  assert.equal(page.total, 1); assert.equal(page.items[0].children, 1);
  assert.deepEqual(await h.adapter.pin(idOf('sub')), { ok: false, code: 'unknown-session' });
  assert.deepEqual(h.adapter.list(), []);
});

test('pins: only catalogue ids are accepted, list() returns pins only, unpin removes the actor and notifies', async (t) => {
  const f = await fixture(t);
  await put(f, 'a.jsonl', session('a')); await put(f, 'b.jsonl', session('b'));
  const h = harness(t, f, { limits: { maxPins: 1 } }); await h.adapter.start(); await h.adapter.refresh();
  assert.deepEqual(h.adapter.list(), [], 'history never becomes an actor by itself');
  for (const bad of [path.join(f.source, 'a.jsonl'), '../a.jsonl', 'omp:xyz', null, 5]) assert.equal((await h.adapter.pin(bad)).ok, false);
  assert.deepEqual(await h.adapter.pin(idOf('missing')), { ok: false, code: 'unknown-session' });
  assert.deepEqual(await h.adapter.pin(idOf('a')), { ok: true, pinned: true });
  assert.deepEqual(await h.adapter.pin(idOf('b')), { ok: false, code: 'pin-limit' });
  await h.adapter.refresh({ rescan: false });
  const [record] = h.adapter.list();
  assert.equal(record.sourceSessionId, 'a'); assert.equal(record.persistedOnly, true);
  assert.ok(h.changes.includes(idOf('a')));
  assert.equal(h.adapter.catalog().items.find((x) => x.id === idOf('a')).pinned, true);
  assert.deepEqual(await h.adapter.pin(idOf('a'), false), { ok: true, pinned: false });
  assert.deepEqual(h.adapter.list(), []); assert.equal(h.adapter.status().runtimes, 0);
  assert.equal(h.stats.active, 0);
});

test('registry projection: pinned OMP is persisted-only, unknown liveness, read-only and metadata-only', async (t) => {
  const f = await fixture(t);
  await put(f, 'a.jsonl', Buffer.concat([titleSlot(PRIVATE), lines([header({ id: 'a' }), assistant('m1', null)])]));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh(); await h.adapter.pin(idOf('a')); await h.adapter.refresh({ rescan: false });
  const registry = createAgentRegistry({ adapters: [h.adapter] });
  const [pub] = registry.list();
  assert.equal(pub.id, idOf('a')); assert.equal(pub.persistedOnly, true); assert.equal(pub.lifecycle, 'historical');
  assert.equal(pub.status, 'unknown'); assert.equal(pub.name, 'repo-a'); assert.equal(pub.dir, ''); assert.equal(pub.lastPrompt, '');
  assert.equal(pub.metrics.cost.value, 1); assert.equal(pub.metrics.context, null);
  assert.ok(Object.values(pub.capabilities).every((v) => v === false));
  assert.equal(registry.resolveForControl(pub.id, 'startTask'), null);
  assert.ok(!JSON.stringify(pub).includes(PRIVATE));
  assert.deepEqual(await registry.readConversation(pub.id), []);
});

test('conversation is a config-gated, one-shot read; children and non-pins are refused', async (t) => {
  const f = await fixture(t);
  await put(f, 'a.jsonl', lines([header({ id: 'a' }), entry('u1', null), assistant('m1', 'u1')]));
  await put(f, 'b.jsonl', session('b'));
  const h = harness(t, f, { conversation: true }); await h.adapter.start(); await h.adapter.refresh(); await h.adapter.pin(idOf('a')); await h.adapter.refresh({ rescan: false });
  const registry = createAgentRegistry({ adapters: [h.adapter] });
  const [pub] = registry.list();
  assert.equal(pub.capabilities.readConversation, true);
  assert.ok(Object.entries(pub.capabilities).every(([k, v]) => k === 'readConversation' || v === false));
  const items = await registry.readConversation(pub.id, 50);
  assert.deepEqual(items.map((x) => x.role), ['user', 'assistant']);
  assert.deepEqual(await registry.readConversation(pub.id, 50, 'child-1'), []);
  assert.equal(registry.resolve(idOf('b')), null, 'an unpinned history file cannot be read');
  assert.equal(h.stats.active, 0);
  assert.equal(h.adapter.status().runtimes, 1);
  // The live snapshot never keeps text: only the one-shot read does.
  assert.deepEqual(h.adapter.list()[0].items, undefined);
});

test('conversation stays disabled by default and the adapter re-checks the flag itself', async (t) => {
  const f = await fixture(t);
  await put(f, 'a.jsonl', lines([header({ id: 'a' }), entry('u1', null)]));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh(); await h.adapter.pin(idOf('a')); await h.adapter.refresh({ rescan: false });
  const [record] = h.adapter.list();
  assert.equal(record.conversation, false);
  assert.deepEqual(await h.adapter.readConversation({ ...record, conversation: true }, 50), []);
});

test('F12: duplicate session ids across files are a conflict, never merged or pinnable', async (t) => {
  const f = await fixture(t);
  await put(f, 'one/a.jsonl', session('dup')); await put(f, 'two/copy.jsonl', session('dup'));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh();
  assert.deepEqual(await h.adapter.pin(idOf('dup')), { ok: false, code: 'conflict' });
  assert.ok(h.adapter.catalog().items.every((x) => x.id === null && x.conflict === true));
});

test('move/rename: a pin follows the session id and the rebuilt ledger is not added twice', async (t) => {
  const f = await fixture(t);
  const original = await put(f, 'old/a.jsonl', session('a'));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh(); await h.adapter.pin(idOf('a')); await h.adapter.refresh({ rescan: false });
  assert.equal(h.adapter.list()[0].metrics.cost.value, 1);
  await f.fs.mkdir(path.join(f.source, 'new'));
  await f.fs.rename(original, path.join(f.source, 'new', 'a.jsonl'));
  await h.adapter.refresh(); await h.adapter.refresh({ rescan: false });
  const rows = h.adapter.list();
  assert.equal(rows.length, 1); assert.equal(rows[0].metrics.cost.value, 1); assert.equal(rows[0].metrics.tokens.input, 10);
  assert.equal(h.adapter.status().runtimes, 1); assert.equal(h.stats.active, 0);
});

test('rewrite and append reach the actor once: totals replace, they do not accumulate', async (t) => {
  const f = await fixture(t);
  const file = await put(f, 'a.jsonl', session('a'));
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh(); await h.adapter.pin(idOf('a')); await h.adapter.refresh({ rescan: false });
  h.changes.length = 0;
  await f.fs.appendFile(file, lines([assistant('m2', 'm-a')]));
  for (let i = 0; i < 3; i++) await h.adapter.refresh({ rescan: false });
  assert.equal(h.adapter.list()[0].metrics.cost.value, 2);
  assert.ok(h.changes.includes(idOf('a')));
  for (let i = 0; i < 3; i++) await h.adapter.refresh({ rescan: false });
  assert.equal(h.adapter.list()[0].metrics.cost.value, 2, 'repeated polls add nothing');
});

test('F10: a missing root is absent, then appears without restart; other sources keep working', async (t) => {
  const f = await fixture(t);
  await put(f, 'a.jsonl', session('a'));
  const missing = path.join(f.root, 'later');
  const h = harness(t, f, { sources: [
    { id: 'fixture', root: f.source, pathStyle: 'posix' }, { id: 'later', root: missing, pathStyle: 'posix' }] });
  await h.adapter.start(); await h.adapter.refresh();
  assert.deepEqual(h.adapter.catalog().sources.map((s) => [s.id, s.state]), [['fixture', 'ok'], ['later', 'absent']]);
  assert.equal(h.adapter.catalog().total, 1);
  await f.fs.mkdir(missing); await f.fs.writeFile(path.join(missing, 'b.jsonl'), session('b', { id: 'b' }));
  await h.adapter.refresh();
  assert.deepEqual(h.adapter.catalog().sources.map((s) => s.state), ['ok', 'ok']);
  assert.equal(h.adapter.catalog().total, 2);
});

test('F11: symlinks and junctions that escape the root are never listed, opened or followed', async (t) => {
  const f = await fixture(t), outside = path.join(f.root, 'outside');
  await f.fs.mkdir(outside); await f.fs.writeFile(path.join(outside, 'secret.jsonl'), session('secret'));
  await put(f, 'a.jsonl', session('a'));
  let linked = 0;
  for (const [target, link, type] of [[outside, path.join(f.source, 'junction'), 'junction'], [path.join(outside, 'secret.jsonl'), path.join(f.source, 'link.jsonl'), 'file']]) {
    try { await f.fs.symlink(target, link, type); linked++; } catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; }
  }
  assert.ok(linked > 0, 'this machine cannot create any link: the F11 negative would not run');
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh();
  assert.equal(h.adapter.catalog().total, 1);
  assert.ok(h.stats.paths.every((p) => !p.includes('outside')), 'no handle opened outside the root');
  assert.deepEqual(await h.adapter.pin(idOf('secret')), { ok: false, code: 'unknown-session' });
});

test('bounds: directory depth, entry and catalogue caps are visible as truncated', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) await put(f, `s${i}.jsonl`, session('s' + i));
  const h = harness(t, f, { limits: { maxSessions: 3 } }); await h.adapter.start(); await h.adapter.refresh();
  const page = h.adapter.catalog();
  assert.equal(page.total, 3); assert.equal(page.sources[0].truncated, true);
  const deep = await fixture(t); await put(deep, 'a/b/c/d.jsonl', session('deep'));
  const shallow = harness(t, deep, { limits: { maxDepth: 1 } }); await shallow.adapter.start(); await shallow.adapter.refresh();
  assert.equal(shallow.adapter.catalog().total, 0); assert.equal(shallow.adapter.catalog().sources[0].truncated, true);
});

test('unsupported schemas are catalogued as unsupported and never become actors', async (t) => {
  const f = await fixture(t);
  await put(f, 'v9.jsonl', lines([header({ id: 'v9', version: 9 })])); await put(f, 'junk.jsonl', 'not json\n');
  const h = harness(t, f); await h.adapter.start(); await h.adapter.refresh();
  assert.ok(h.adapter.catalog().items.every((x) => x.supported === false && x.id === null));
  assert.equal((await h.adapter.pin(idOf('v9'))).ok, false);
});

test('pins survive restart through the injected store and an absent file does not crash or list', async (t) => {
  const f = await fixture(t), saved = [];
  await put(f, 'a.jsonl', session('a'));
  const store = { load: async () => saved.slice(), save: async (ids) => { saved.length = 0; saved.push(...ids); } };
  const first = harness(t, f, { pinStore: store }); await first.adapter.start(); await first.adapter.refresh(); await first.adapter.pin(idOf('a'));
  assert.deepEqual(saved, [idOf('a')]); await first.adapter.dispose();
  saved.push(idOf('gone'));
  const second = harness(t, f, { pinStore: store }); await second.adapter.start(); await second.adapter.refresh(); await second.adapter.refresh({ rescan: false });
  assert.deepEqual(second.adapter.list().map((r) => r.sourceSessionId), ['a']);
});

test('dispose releases handles, readers and timers even mid-run', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) await put(f, `s${i}.jsonl`, session('s' + i));
  const h = harness(t, f, { limits: { maxPins: 6 } }); await h.adapter.start(); await h.adapter.refresh();
  for (let i = 0; i < 6; i++) await h.adapter.pin(idOf('s' + i));
  const run = h.adapter.refresh({ rescan: false });
  await h.adapter.dispose(); await run;
  assert.equal(h.stats.active, 0); assert.equal(h.timers.size, 0); assert.deepEqual(h.adapter.list(), []);
  assert.equal(h.adapter.status().runtimes, 0);
});

test('a timer firing during refresh joins the pass in flight and never overlaps it', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) await put(f, `s${i}.jsonl`, session('s' + i));
  // Inside one pass every filesystem call is awaited in turn, so two calls in flight mean two overlapping passes.
  let inflight = 0, peak = 0;
  const wrap = (io) => ({ ...io, lstat: async (...a) => { inflight++; peak = Math.max(peak, inflight); try { return await io.lstat(...a); } finally { inflight--; } } });
  const h = harness(t, f, { wrap, limits: { maxPins: 4 } });
  await h.adapter.start(); await h.adapter.refresh();
  for (let i = 0; i < 4; i++) await h.adapter.pin(idOf('s' + i));
  assert.equal(h.timers.size, 1, 'the next pass is armed');
  const pass = h.adapter.refresh();
  for (const timer of [...h.timers]) timer.fn();
  await pass;
  assert.equal(peak, 1); assert.ok(h.stats.maxActive <= 1);
  await h.adapter.dispose();
  assert.equal(h.stats.active, 0); assert.equal(inflight, 0);
});

test('a capped scan cannot call anything recent: directory order is not time order', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000;
  // Names sort opposite to age, so a three-entry cap keeps the oldest files.
  for (let i = 0; i < 5; i++) await put(f, `a${i}.jsonl`, session('s' + i), base - (4 - i) * 100);
  const h = harness(t, f, { limits: { scanEntries: 3 } }); await h.adapter.start(); await h.adapter.refresh();
  const page = h.adapter.catalog();
  assert.equal(page.sources[0].truncated, true); assert.ok(page.items.length <= 3);
  assert.ok(page.items.every((x) => x.label === 'history'));
});

test('a pinned file larger than one read slice is ready after one pass, not one slice per pass', async (t) => {
  const f = await fixture(t), records = [header({ id: 'big', cwd: '/fixture/projects/repo-a' })];
  for (let i = 0; i < 300; i++) records.push(assistant('m' + i, i ? 'm' + (i - 1) : null));
  const file = await put(f, 'proj/2026_big.jsonl', lines(records));
  const { size } = await f.fs.stat(file);
  const h = harness(t, f, { limits: { bytesPerTick: 4096, chunkBytes: 4096 } });
  assert.ok(size > 20 * 4096, 'the file takes many slices');
  await h.adapter.start(); await h.adapter.refresh();
  assert.equal((await h.adapter.pin(idOf('big'), true)).ok, true);
  await h.adapter.refresh({ rescan: false });
  const [record] = h.adapter.list();
  assert.equal(record?.readerState, 'ready', 'one pass finishes the file instead of reading 4 KiB of it');
  assert.equal(record.metrics.tokens.output, 300 * 5);
});

test('a real-sized tree: one folder with hundreds of sessions is listed whole, newest first, and children do not use up the header budget', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000, n = 150;   // more than the old per-folder cap; names sort oldest first, like a timestamped folder
  for (let i = 0; i < n; i++) {
    const stem = `2026-10-${String(i).padStart(3, '0')}_s${i}`;
    await put(f, `proj/${stem}.jsonl`, session('s' + i), base - (n - i) * 100);
    await put(f, `proj/${stem}/__advisor.jsonl`, session('c' + i), base + i);   // children are the newest files
    await put(f, `proj/${stem}/0.bash.log`, 'log', base);
  }
  const h = harness(t, f);
  await h.adapter.start(); await h.adapter.refresh();
  const page = h.adapter.catalog({ limit: 50 });
  assert.equal(page.total, n); assert.equal(page.sources[0].truncated, false);
  assert.equal(page.items[0].id, idOf('s' + (n - 1)), 'the newest session is not lost to directory order');
  assert.ok(page.items.every((x) => x.supported && x.children === 1), 'every session on the first page is pinnable after one scan');
  assert.equal(page.items.filter((x) => x.label === 'recent').length, 16);
});

test('sessions whose header was not read yet are pending, then filled in batches without listing the tree again', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000, n = 200, listed = [];   // more than the per-pass header read budget
  for (let i = 0; i < n; i++) await put(f, `proj/s${String(i).padStart(3, '0')}.jsonl`, session('s' + i), base - (n - i) * 10);
  const h = harness(t, f, { wrap: (io) => ({ ...io, opendir: (p, ...a) => { listed.push(p); return io.opendir(p, ...a); } }) });
  const every = () => { const out = []; for (let cursor = 0; ;) { const page = h.adapter.catalog({ limit: 50, cursor: String(cursor) }); out.push(...page.items); if (!page.next) return out; cursor = Number(page.next); } };
  await h.adapter.start();
  for (let i = 0; i < 400 && !h.adapter.catalog().total; i++) await new Promise((r) => setTimeout(r, 5));   // the first pass is one scan
  const pending = () => every().filter((x) => x.pending);
  const first = pending();
  assert.ok(first.length > 0 && first.length < n, 'the first pass reads some headers and leaves the rest waiting');
  assert.ok(first.every((x) => x.supported === false && x.id === null), 'a waiting file is not pinnable');
  assert.ok(every().filter((x) => !x.pending).every((x) => x.supported === true), 'a header that was read is not pending');
  const listings = listed.length;
  await h.adapter.refresh({ rescan: false });
  assert.ok(pending().length < first.length, 'the next pass reads more headers');
  for (let i = 0; i < 6 && pending().length; i++) await h.adapter.refresh({ rescan: false });
  assert.equal(pending().length, 0, 'every header is read after a few passes');
  assert.ok(every().every((x) => x.supported && x.id), 'all of them are pinnable');
  assert.equal(listed.length, listings, 'filling headers never lists the tree again');
});

test('a header that cannot be read yet is not retried on every pass', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000, opened = [];
  await put(f, 'proj/ok.jsonl', session('ok'), base);
  await put(f, 'proj/empty.jsonl', '', base - 10);   // no complete line yet: the writer has not got that far
  const h = harness(t, f, { wrap: (io) => ({ ...io, open: (p, ...a) => { opened.push(path.basename(String(p))); return io.open(p, ...a); } }) });
  await h.adapter.start(); await h.adapter.refresh({ rescan: false });
  const after = opened.filter((n) => n === 'empty.jsonl').length;
  for (let i = 0; i < 4; i++) await h.adapter.refresh({ rescan: false });
  assert.equal(opened.filter((n) => n === 'empty.jsonl').length, after, 'it waits for the next reconcile interval');
  assert.equal(h.adapter.catalog().items.find((x) => x.pending)?.supported, false);
});

test('rescan lists an artifact folder again only when it changed, and a new child is counted', async (t) => {
  const f = await fixture(t), base = Date.now() / 1000, listed = [];
  for (let i = 0; i < 5; i++) {
    await put(f, `proj/2026_s${i}.jsonl`, session('s' + i), base - i * 100);
    await put(f, `proj/2026_s${i}/__advisor.jsonl`, session('c' + i), base);
    await put(f, `proj/2026_s${i}/0.bash.log`, 'log', base);
  }
  const h = harness(t, f, { wrap: (io) => ({ ...io, opendir: (p, ...a) => { listed.push(path.basename(p)); return io.opendir(p, ...a); } }) });
  await h.adapter.start(); await h.adapter.refresh();
  const artifactListings = () => listed.filter((n) => /^2026_s\d$/.test(n)).length;
  assert.equal(artifactListings(), 5, 'the first scan lists every artifact folder');
  assert.deepEqual(h.adapter.catalog({ limit: 50 }).items.map((x) => x.children), [1, 1, 1, 1, 1]);

  await h.adapter.refresh();
  assert.equal(artifactListings(), 5, 'an unchanged folder is not listed again');

  const dir = path.join(f.source, 'proj', '2026_s2');
  await put(f, 'proj/2026_s2/Task1.jsonl', session('c2b'), base);
  await f.fs.utimes(dir, base + 50, base + 50);   // (a new entry moves the folder time; set it so the test never depends on the clock grain)
  await h.adapter.refresh();
  assert.equal(artifactListings(), 6, 'only the changed folder is listed again');
  assert.equal(h.adapter.catalog({ limit: 50 }).items.find((x) => x.id === idOf('s2')).children, 2);
});
