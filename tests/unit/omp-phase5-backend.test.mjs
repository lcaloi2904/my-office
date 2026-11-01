import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readGitIdentity } from '../../server/git.mjs';
import { projectIdentity, validateConfig } from '../../server/agents/omp/paths.mjs';
import { projectClaudeSession, projectOmpSession } from '../../server/agents/projection.mjs';
import { conversationPage } from '../../server/agents/conversation.mjs';
import { createAgentRegistry } from '../../server/agents/registry.mjs';
import { createClaudeAdapter } from '../../server/agents/claude/compat.mjs';
import { createNormalizer } from '../../server/agents/omp/normalize.mjs';
import { fixture, header, entry, assistant, PRIVATE } from '../fixtures/omp/synthetic.mjs';

// Git is injected plumbing only: these tests never invoke gh, CI, a remote or a model.
test('verified local common-dir groups linked worktrees, not same-basename repositories', async (t) => {
  const f = await fixture(t), a = path.join(f.root, 'a', 'repo'), b = path.join(f.root, 'b', 'repo'), other = path.join(f.root, 'c', 'repo');
  const common = path.join(a, '.git'), otherCommon = path.join(other, '.git');
  for (const dir of [common, b, otherCommon]) await f.fs.mkdir(dir, { recursive: true });
  const calls = [];
  const runGit = async (command, args, cwd) => {
    calls.push([command, args]);
    assert.equal(command, 'git');
    if (args[1] === '--show-toplevel') return cwd;
    assert.deepEqual(args, ['rev-parse', '--git-common-dir']);
    return cwd === other ? otherCommon : common;
  };
  const ia = await readGitIdentity(a, { runGit }), ib = await readGitIdentity(b, { runGit }), ic = await readGitIdentity(other, { runGit });
  assert.equal(ia.projectKey, ib.projectKey); assert.notEqual(ia.worktreeKey, ib.worktreeKey);
  assert.notEqual(ia.projectKey, ic.projectKey);
  assert.equal((await readGitIdentity(a, { runGit: async () => null })), null);
  assert.equal(await readGitIdentity('../unapproved', { runGit }), null);
  const source = { id: 'host', pathStyle: process.platform === 'win32' ? 'win32' : 'posix', projectMappings: [{ from: a, projectId: 'repo', worktreeId: 'main' }] };
  const independent = projectIdentity(source, a), verified = projectIdentity(source, a, new Map([[a, ia]]));
  assert.notEqual(independent.projectKey, ia.projectKey, 'unverified mapping cannot merge with Claude');
  assert.deepEqual(verified, { projectKey: ia.projectKey, worktreeKey: ia.worktreeKey });
  assert.equal(projectIdentity(source, other, new Map([[a, ia]])).projectKey, null);
  assert.equal(projectClaudeSession({ id: 'claude-root', ...verified }).projectKey, verified.projectKey);
  const config = validateConfig({ version: 1, sources: [{ ...source, root: f.source, projectMappings: [{ ...source.projectMappings[0], localRoot: a }] }] });
  assert.equal(config.sources[0].projectMappings[0].localRoot, a);
  assert.throws(() => validateConfig({ version: 1, sources: [{ ...source, root: f.source, projectMappings: [{ ...source.projectMappings[0], localRoot: '../bad' }] }] }), { code: 'CONFIG_INVALID' });
  assert.ok(calls.length > 0);
});

test('opaque conversation pages are bounded, root/child scoped, snapshot checked and backwards ordered', () => {
  const items = Array.from({ length: 250 }, (_, i) => ({ role: 'assistant', text: 'message ' + i }));
  const first = conversationPage(items, { id: 'root', childId: 'Child', limit: 120 });
  assert.equal(first.items[0].text, 'message 130'); assert.equal(first.items.length, 120); assert.ok(first.nextCursor.length < 256);
  const second = conversationPage(items, { id: 'root', childId: 'Child', before: first.nextCursor });
  assert.equal(second.items[0].text, 'message 10');
  const last = conversationPage(items, { id: 'root', childId: 'Child', before: second.nextCursor });
  assert.equal(last.items.length, 10); assert.equal(last.nextCursor, null);
  for (const change of [{ id: 'other' }, { childId: 'Other' }, { before: '../path' }, { before: 'x'.repeat(257) }]) {
    assert.deepEqual(conversationPage(items, { id: 'root', childId: 'Child', before: first.nextCursor, ...change }), { items: [], nextCursor: null, incomplete: true });
  }
  assert.equal(conversationPage([...items, { role: 'assistant', text: 'new' }], { id: 'root', childId: 'Child', before: first.nextCursor }).incomplete, true);
  assert.equal(conversationPage(items, { id: 'root', limit: 9999 }).items.length, 120);
});

test('registry pages Claude root and child without changing legacy conversation arrays, and reports truncation', async () => {
  const root = { id: 'claude-root' }, calls = [];
  const registry = createAgentRegistry({ adapters: [createClaudeAdapter({ listSessions: () => [root], resolveSession: (id) => id === root.id ? root : null,
    publicSession: (s) => s, readLog: async (_s, n, child) => { calls.push([n, child]); return [{ role: 'claude', text: child || 'root' }]; },
    readLogEntries: async (_s, _n, child) => ({ items: [{ role: 'claude', text: child || 'root' }], incomplete: true }) })] });
  assert.deepEqual(await registry.readConversation(root.id, 5), [{ role: 'claude', text: 'root' }]);
  assert.deepEqual(calls, [[5, null]]);
  assert.deepEqual(await registry.readConversationPage(root.id, 120, 'Child'), { items: [{ role: 'claude', text: 'Child' }], nextCursor: null, incomplete: true });
  assert.equal((await registry.readConversationPage('missing')).incomplete, true);
  assert.equal((await registry.readConversationPage(root.id, 120, 'x'.repeat(257))).incomplete, true);
});

test('public child metadata retains true namespaced parents and rejects paths, content, orphan and cyclic lineage', () => {
  const record = { sourceNamespace: 'fixture', sourceSessionId: 'root', persistedOnly: true }, key = projectOmpSession(record).sessionKey;
  const child = (id, parent = key) => ({ id, rootSessionKey: key, agentKey: JSON.stringify([key, id]), parentAgentKey: parent, relationKind: 'subagent', task: PRIVATE, desc: PRIVATE, cwd: '/secret', lifecycle: 'revived' });
  const pub = projectOmpSession({ ...record, children: [child('Child'), child('Nested', JSON.stringify([key, 'Child'])), { ...child('Killed'), lifecycle: 'aborted', tombstoned: true }, child('../escape'), child('Orphan', JSON.stringify([key, 'Absent'])), child('Loop', JSON.stringify([key, 'Loop']))] });
  assert.deepEqual(pub.subs.map((c) => c.id), ['Child', 'Nested', 'Killed']);
  assert.equal(pub.subs[1].parentAgentKey, JSON.stringify([key, 'Child'])); assert.equal(pub.subs[0].lifecycle, 'historical');
  assert.equal(pub.doneSubs.length, 0); assert.equal(pub.subs[2].lifecycle, 'historical'); assert.equal(pub.subs[2].tombstoned, true);
  assert.equal(pub.childrenIncomplete, true); assert.equal(pub.childSupport.liveChildren, 'unsupported');
  assert.doesNotMatch(JSON.stringify(pub), /SYNTHETIC_PRIVATE|\/secret|escape/);
  const many = projectOmpSession({ ...record, children: Array.from({ length: 140 }, (_, i) => child('Child' + i)) });
  assert.equal(many.subs.length, 128); assert.equal(many.childrenIncomplete, true);
});

test('persisted conversation emits canonical tool phases and summary kinds without raw tool payloads', () => {
  const records = [header(), assistant('a', null, { content: [{ type: 'toolCall', id: 'safe-call', name: 'bash', arguments: { command: PRIVATE } }, { type: 'toolCall', id: 'unknown-call', name: PRIVATE, arguments: {} }] }),
    entry('r', 'a', { message: { role: 'toolResult', toolCallId: 'safe-call', isError: true, content: [{ type: 'text', text: PRIVATE }] } })];
  const n = createNormalizer({ sourceNamespace: 'fixture', includeContent: true }); records.forEach((r) => n.push(r));
  assert.deepEqual(n.value().items.map((i) => [i.role, i.type || i.phase]), [['tool', 'cmd'], ['tool', 'other'], ['toolResult', 'error']]);
  assert.doesNotMatch(JSON.stringify(n.value().items), /SYNTHETIC_PRIVATE|arguments/);
  const metadata = createNormalizer({ sourceNamespace: 'fixture' }); records.forEach((r) => metadata.push(r)); assert.deepEqual(metadata.value().items, []);
});

test('registry page boundaries refuse malformed cursors before reads and bound failing or overproducing adapters', async () => {
  const raw = { sourceNamespace: 'fixture', sourceSessionId: 'root', persistedOnly: true, conversation: true };
  const id = projectOmpSession(raw).id;
  let reads = 0, fail = false;
  const registry = createAgentRegistry({ adapters: [{ kind: 'omp', list: () => [raw], resolve: (key) => key === id ? raw : null,
    readConversationPage: async () => {
      reads++;
      if (fail) throw new Error(PRIVATE);
      return { items: Array.from({ length: 500 }, () => ({ role: 'assistant', text: 'safe' })), nextCursor: '../path', cwd: PRIVATE };
    } }] });
  assert.deepEqual(await registry.readConversationPage(id, 120, null, 'bad/path'), { items: [], nextCursor: null, incomplete: true });
  assert.equal(reads, 0);
  const page = await registry.readConversationPage(id);
  assert.equal(page.items.length, 120); assert.equal(page.nextCursor, null); assert.equal(page.incomplete, true);
  assert.doesNotMatch(JSON.stringify(page), /SYNTHETIC_PRIVATE/);
  fail = true;
  assert.deepEqual(await registry.readConversationPage(id), { items: [], nextCursor: null, incomplete: true });
  assert.deepEqual(registry.diagnostics(), ['omp:conversation-failed']);
});
