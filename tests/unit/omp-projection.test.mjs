import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { projectOmpSession } from '../../server/agents/projection.mjs';

const base = { sourceNamespace: 'fixture', sourceSessionId: 's1' };
const persisted = (extra = {}) => ({ ...base, persistedOnly: true, project: 'repo-a', readerState: 'ready', counts: { read: 2, edit: 1, cmd: 0, web: 0 }, ...extra });
const hex = 'a'.repeat(64);

test('persisted OMP projection is an allowlist: history labels, safe name and counts, no content', () => {
  const s = projectOmpSession(persisted({ projectKey: hex, worktreeKey: 'not-hex', title: 'SECRET', cwd: '/secret', lastPrompt: 'SECRET', pid: 42, link: 'http://x' }));
  assert.equal(s.persistedOnly, true); assert.equal(s.lifecycle, 'historical'); assert.equal(s.status, 'unknown');
  assert.equal(s.name, 'repo-a'); assert.equal(s.projectKey, hex); assert.equal(s.worktreeKey, null);
  assert.deepEqual(s.counts, { read: 2, edit: 1, cmd: 0, web: 0 });
  assert.equal(s.pid, null); assert.equal(s.link, null); assert.equal(s.title, ''); assert.equal(s.dir, ''); assert.equal(s.lastPrompt, '');
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  assert.ok(Object.values(s.capabilities).every((v) => v === false));
});

test('names and counts from a bad record are cleaned, not trusted', () => {
  const s = projectOmpSession(persisted({ project: '<img src=x onerror=alert(1)>\u0000/../etc'.repeat(5), counts: { read: -1, edit: 1.5, cmd: '3', web: Infinity }, readerState: 'weird' }));
  assert.match(s.name, /^[\p{L}\p{N} ._-]{0,40}$/u);
  assert.deepEqual(s.counts, { read: 0, edit: 0, cmd: 0, web: 0 });
  assert.equal(s.readerState, 'loading');
});

test('only the server flag on a persisted record opens conversation reads; nothing else is ever enabled', () => {
  const open = projectOmpSession(persisted({ conversation: true })).capabilities;
  assert.equal(open.readConversation, true);
  assert.ok(Object.entries(open).every(([k, v]) => k === 'readConversation' || v === false));
  assert.equal(projectOmpSession(persisted({ conversation: 'yes' })).capabilities.readConversation, false);
  assert.equal(projectOmpSession(persisted()).capabilities.readConversation, false);
  // A record that is not marked persisted can never claim the capability, whatever else it carries.
  const forged = projectOmpSession({ ...base, conversation: true, capabilities: { readConversation: true, startTask: true } });
  assert.ok(!forged.persistedOnly); assert.ok(Object.values(forged.capabilities).every((v) => v === false));
});

// Browser helper, evaluated with injected dependencies only: no DOM, WebGL or network.
test('UI hint: only a pinned persisted OMP id with the flag may read its conversation; controls stay Claude-only', () => {
  const text = fs.readFileSync(new URL('../../src/office/people/workers.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '')
    .replace(/^export \{[^}]+\};\r?$/gm, '').replace(/^export (?=(?:const|let|function|async function)\b)/gm, '');
  const ui = vm.runInNewContext(text + '\n;({ canSession, isPersisted, unknownLabel })', { tr: (k) => k, replay: { on: false } }, { timeout: 1000 });
  const id = projectOmpSession(base).id, caps = { readConversation: true };
  const row = { id, agentKind: 'omp', persistedOnly: true, capabilities: caps };
  assert.equal(ui.canSession(row, 'readConversation'), true);
  for (const control of ['openWindow', 'closeSession', 'changeAccount', 'remoteControl', 'startTask']) assert.equal(ui.canSession({ ...row, capabilities: { ...caps, [control]: true } }, control), false);
  assert.equal(ui.canSession({ ...row, capabilities: { readConversation: false } }, 'readConversation'), false);
  assert.equal(ui.canSession({ ...row, persistedOnly: false }, 'readConversation'), true, 'hybrid file+live retains server-authorized reads');
  assert.equal(ui.canSession({ ...row, id: 'omp:short' }, 'readConversation'), false);
  assert.equal(ui.canSession({ ...row, agentKind: 'claude' }, 'readConversation'), false);
  assert.equal(ui.unknownLabel(row), 'drawer.persistedState');
  assert.equal(ui.unknownLabel({ id, agentKind: 'omp' }), 'drawer.unknownState');
});
