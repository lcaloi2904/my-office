import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmpVisibilityStore, HIDDEN_LIMIT } from '../../server/agents/omp/visibility.mjs';

const ID = (n) => 'omp:' + String(n).padStart(64, '0');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omp-vis-'));

test('hide, unhide and persistence across restart', () => {
  const dir = tmp(), file = path.join(dir, 'omp-hidden.json');
  try {
    const a = createOmpVisibilityStore({ file, now: () => 5 });
    assert.deepEqual(a.set(ID(1), true, 0, 'my-office'), { ok: true, revision: 1, changed: true });
    assert.equal(a.isHidden(ID(1)), true);
    const b = createOmpVisibilityStore({ file });
    assert.equal(b.isHidden(ID(1)), true);
    assert.equal(b.snapshot().items[0].label, 'my-office');
    assert.equal(b.set(ID(1), false, 1).changed, true);
    assert.equal(createOmpVisibilityStore({ file }).isHidden(ID(1)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('idempotent, revision conflict and invalid input', () => {
  const dir = tmp(), file = path.join(dir, 'h.json');
  try {
    const s = createOmpVisibilityStore({ file });
    assert.equal(s.set(ID(1), false, 99).changed, false);          // already visible: no-op even with stale revision
    assert.equal(s.set(ID(1), true, 3).code, 'conflict');           // stale tab
    assert.equal(s.set(ID(1), true, undefined).code, 'invalid');
    assert.equal(s.set('claude-abc', true, 0).code, 'invalid');     // not an OMP id
    assert.equal(s.set(ID(1), 'yes', 0).code, 'invalid');
    assert.equal(s.set(ID(1), true, 0).ok, true);
    assert.equal(s.set(ID(1), true, 0).changed, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt store fails closed and is not overwritten', () => {
  const dir = tmp(), file = path.join(dir, 'h.json');
  try {
    fs.writeFileSync(file, '{not json');
    const s = createOmpVisibilityStore({ file });
    assert.equal(s.snapshot().corrupt, true);
    assert.equal(s.set(ID(1), true, 0).code, 'store-corrupt');
    assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('label is sanitised and the list is bounded', () => {
  const dir = tmp(), file = path.join(dir, 'h.json');
  try {
    const s = createOmpVisibilityStore({ file });
    s.set(ID(1), true, 0, '<b>x</b>\n' + 'y'.repeat(200));
    const label = s.snapshot().items[0].label;
    assert.ok(label.length <= 80 && !/[<>\n]/.test(label));
    let rev = 1, last;
    for (let i = 2; i <= HIDDEN_LIMIT + 1; i++) { last = s.set(ID(i), true, rev); if (last.ok) rev = last.revision; }
    assert.equal(last.code, 'limit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
