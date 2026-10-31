import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReader } from '../../server/agents/omp/reader.mjs';
import { approveRoot } from '../../server/agents/omp/paths.mjs';
import { createNormalizer } from '../../server/agents/omp/normalize.mjs';
import { fixture, readonlyIO, header, entry, assistant, usage, lines, titleSlot } from '../fixtures/omp/synthetic.mjs';

const digest = (b) => createHash('sha256').update(b).digest('hex');
async function setup(t, records = [header()], limits = {}) {
  const f = await fixture(t); await f.fs.writeFile(f.file, Buffer.isBuffer(records) ? records : lines(records));
  const { io, stats } = readonlyIO(), root = await approveRoot(f.source, io);
  const reader = createReader({ root, relative: 'session.jsonl', io, limits, factory: () => createNormalizer({ sourceNamespace: 'fixture', includeContent: true }) });
  t.after(() => reader.dispose());
  return { ...f, reader, root, io, stats };
}
async function settle(reader) {
  for (let n = 0; n < 1000; n++) {
    const info = await reader.poll();
    if (['ready', 'absent', 'degraded', 'unsupported'].includes(info.state)) return info;
  }
  assert.fail('Reader did not settle within bounded polls');
}

test('F1/F3: title slot, UTF-8 and CRLF framing survive every byte boundary', async (t) => {
  const body = Buffer.concat([titleSlot('Ti\u1ebfng Vi\u1ec7t'), lines([header(), entry('a', null, { message: { role: 'user', content: 'Ti\u1ebfng Vi\u1ec7t \ud83c\udf31' } })], '\r\n')]);
  // A one-byte transport read visits every boundary, including inside UTF-8 and between CR/LF.
  const f = await setup(t, body, { chunkBytes: 1, bytesPerTick: 128 });
  const info = await settle(f.reader);
  assert.equal(info.snapshot.supported, true); assert.equal(info.snapshot.items.length, 1);
  assert.equal(info.snapshot.items[0].text, 'Ti\u1ebfng Vi\u1ec7t \ud83c\udf31');
  assert.equal(info.offset, body.length); assert.equal(info.pendingBytes, 0);
  assert.equal(f.stats.active, 0);
});

test('F2/F3: incomplete last line waits for newline without duplicate usage', async (t) => {
  const h = lines([header()]), message = lines([assistant('a', null)]);
  const f = await setup(t, Buffer.concat([h, message.subarray(0, -1)]));
  const before = await settle(f.reader);
  assert.equal(before.offset, h.length); assert.equal(before.snapshot.partialLine, true);
  assert.equal(before.snapshot.items.length, 0);
  await f.fs.appendFile(f.file, '\n');
  const complete = await settle(f.reader);
  assert.equal(complete.snapshot.items.length, 1); assert.equal(complete.snapshot.metrics.cost.value, 1);
  assert.deepEqual((await settle(f.reader)).snapshot, complete.snapshot);
});

test('F4: malformed JSON and invalid UTF-8 are bounded diagnostics, never exact totals', async (t) => {
  const data = Buffer.concat([lines([header()]), Buffer.from('{bad}\n'), Buffer.from([0xff, 10]), lines([assistant('a', null)])]);
  const f = await setup(t, data), info = await settle(f.reader);
  assert.equal(info.snapshot.items.length, 1); assert.equal(info.snapshot.incomplete, true);
  assert.ok(info.diagnostics.includes('malformed-line')); assert.ok(info.diagnostics.length <= 24);
  assert.equal(info.snapshot.metrics.cost, null, 'skipped content must not yield an exact recorded total');
});

test('F4: oversized lines drain over bounded polls and recover at the next delimiter', async (t) => {
  const f = await setup(t, Buffer.concat([lines([header()]), Buffer.from('x'.repeat(6000))]), { maxLineBytes: 512, chunkBytes: 256, bytesPerTick: 512 });
  let info = await settle(f.reader);
  assert.equal(info.snapshot.partialLine, true); assert.ok(info.pendingBytes <= 512);
  await f.fs.appendFile(f.file, Buffer.concat([Buffer.from('\n'), lines([entry('after', null)])]));
  info = await settle(f.reader);
  assert.equal(info.snapshot.items.at(-1).text, 'Synthetic message after');
  assert.ok(info.diagnostics.includes('line-limit')); assert.ok(info.pendingBytes <= 512);
});

test('F5: truncate, atomic replacement, deletion and reappearance rebuild without adding totals', async (t) => {
  const f = await setup(t, [header(), assistant('a', null), assistant('b', 'a')]);
  const a = await settle(f.reader); assert.equal(a.snapshot.metrics.cost.value, 2);
  await f.fs.writeFile(f.file, lines([header(), assistant('a', null)]));
  const b = await settle(f.reader); assert.equal(b.snapshot.metrics.cost.value, 1); assert.ok(b.epoch > a.epoch);
  const replacement = path.join(f.source, 'replacement.jsonl');
  await f.fs.writeFile(replacement, lines([header(), assistant('a', null, { usage: usage(3) })]));
  await f.fs.rename(replacement, f.file);
  const c = await settle(f.reader); assert.equal(c.snapshot.metrics.cost.value, 3); assert.ok(c.epoch > b.epoch);
  await f.fs.unlink(f.file); assert.equal((await settle(f.reader)).state, 'absent');
  await f.fs.writeFile(f.file, lines([header(), assistant('a', null, { usage: usage(4) })]));
  assert.equal((await settle(f.reader)).snapshot.metrics.cost.value, 4);
  assert.equal(f.stats.opened, f.stats.closed);
});

test('F6: same-size title and middle rewrite plus append cannot pass a prefix/tail-only check', async (t) => {
  const first = Buffer.concat([titleSlot('Synthetic alpha'), lines([header(), assistant('a', null), assistant('b', 'a')])]);
  const f = await setup(t, first, { chunkBytes: 128, bytesPerTick: 256 });
  const old = await settle(f.reader);
  const replacement = Buffer.concat([titleSlot('Synthetic bravo'), lines([header(), assistant('a', null, { usage: usage(7) }), assistant('b', 'a'), assistant('c', 'b')])]);
  await f.fs.writeFile(f.file, replacement);
  const refreshing = await f.reader.poll();
  assert.equal(refreshing.state, 'refreshing'); assert.equal(refreshing.snapshot.metrics.cost.value, 2, 'previous complete snapshot retained during rebuild');
  const rebuilt = await settle(f.reader);
  assert.equal(rebuilt.snapshot.metrics.cost.value, 9); assert.ok(rebuilt.epoch > old.epoch);
  assert.notEqual(rebuilt.snapshot.revision, old.snapshot.revision);
});

test('F6: periodic reconciliation detects equal-size edits even with stable stat stamps', async (t) => {
  const f = await setup(t, [header(), assistant('a', null)]);
  const realOpen = f.io.open; let frozen = null, clock = 0;
  f.io.open = async (...args) => {
    const handle = await realOpen(...args), stat = handle.stat;
    handle.stat = async () => { const value = await stat(); frozen ||= { mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }; return Object.assign(value, frozen); };
    return handle;
  };
  const r = createReader({ root: f.root, relative: 'session.jsonl', io: f.io, now: () => clock, limits: { reconcileMs: 100 }, factory: () => createNormalizer({ sourceNamespace: 'fixture' }) });
  t.after(() => r.dispose());
  const before = await settle(r);
  await f.fs.writeFile(f.file, lines([header(), assistant('a', null, { usage: usage(8) })]));
  clock = 101;
  const after = await settle(r);
  assert.equal(after.snapshot.metrics.cost.value, 8); assert.ok(after.epoch > before.epoch);
});

test('F10: absent and filesystem faults stay distinct and expose no raw error paths', async (t) => {
  const f = await setup(t);
  for (const code of ['ENOENT', 'EACCES', 'EMFILE', 'EIO']) {
    const io = { ...f.io, open: async () => { throw Object.assign(new Error('/SYNTHETIC_PRIVATE'), { code }); } };
    const r = createReader({ root: f.root, relative: 'session.jsonl', io, factory: () => createNormalizer({ sourceNamespace: 'fixture' }) });
    const info = await r.poll();
    assert.equal(info.state, code === 'ENOENT' ? 'absent' : 'degraded'); assert.ok(info.diagnostics.includes(code));
    assert.doesNotMatch(JSON.stringify(info), /SYNTHETIC_PRIVATE/); await r.dispose();
  }
});

test('F12: append bursts retain a block-bounded fingerprint ledger', async (t) => {
  const f = await setup(t, [header()], { chunkBytes: 1024, bytesPerTick: 4096 });
  await settle(f.reader);
  for (let i = 0; i < 48; i++) { await f.fs.appendFile(f.file, ' '); await settle(f.reader); }
  const info = f.reader.info();
  assert.ok(info.blocks <= Math.ceil(info.readOffset / 1024), 'one fingerprint per fixed block, not per append');
  assert.ok(info.pendingBytes <= 64 * 1024);
});

test('F12: overlapping polls share a job and dispose releases all handles and state', async (t) => {
  const f = await setup(t, [header(), entry('a', null)]);
  const a = f.reader.poll(), b = f.reader.poll(); assert.equal(a, b);
  await a; await f.reader.dispose();
  assert.equal(f.reader.info().state, 'disposed'); assert.equal(f.reader.info().pendingBytes, 0);
  assert.equal(f.reader.info().blocks, 0); assert.equal(f.stats.active, 0); assert.equal(f.stats.maxActive, 1);
  const count = f.stats.opened; await f.reader.poll(); assert.equal(f.stats.opened, count);
});

test('F12/S8: cancellation and size limits stop work without modifying sources', async (t) => {
  const f = await setup(t, [header(), assistant('a', null)]), before = digest(await f.fs.readFile(f.file));
  const controller = new AbortController(); controller.abort();
  await f.reader.poll({ signal: controller.signal }); assert.equal(f.stats.opened, 0);
  const capped = createReader({ root: f.root, relative: 'session.jsonl', io: f.io, limits: { maxFileBytes: 1 }, factory: () => createNormalizer({ sourceNamespace: 'fixture' }) });
  const info = await capped.poll(); assert.equal(info.state, 'unsupported'); assert.ok(info.diagnostics.includes('file-limit')); await capped.dispose();
  await settle(f.reader);
  assert.equal(digest(await f.fs.readFile(f.file)), before);
  assert.equal(f.stats.opened, f.stats.closed);
});
