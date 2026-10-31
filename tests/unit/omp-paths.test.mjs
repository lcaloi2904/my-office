import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateConfig, approveRoot, containedPath, openContained, projectIdentity, readConfigFile, errorCode } from '../../server/agents/omp/paths.mjs';
import { fixture, readonlyIO, header, lines } from '../fixtures/omp/synthetic.mjs';

const configuration = (root, extra = {}) => ({ version: 1, sources: [{ id: 'fixture-host-profile', root, pathStyle: 'posix' }], ...extra });

test('OMP configuration is explicit, bounded and conversation defaults off', async (t) => {
  const f = await fixture(t), value = validateConfig(configuration(f.source));
  assert.equal(value.sources[0].conversation, false);
  assert.equal(value.sources[0].root, f.source);
  for (const raw of [null, {}, configuration('relative'), configuration(f.source, { version: 9 }), configuration(f.source, { limits: { maxPins: 9999 } }), configuration(f.source, { limits: { pollMs: 1 } })])
    assert.throws(() => validateConfig(raw), { code: 'CONFIG_INVALID' });
  assert.throws(() => validateConfig({ version: 1, sources: [value.sources[0], value.sources[0]] }), { code: 'CONFIG_INVALID' });
  assert.throws(() => validateConfig(configuration('//server/share')), { code: 'CONFIG_INVALID' });
  assert.throws(() => validateConfig(configuration(f.source, { limits: JSON.parse('{"constructor":1}') })), { code: 'CONFIG_INVALID' });
  assert.throws(() => validateConfig({ version: 1, sources: [{ id: 'fixture-win', root: f.source, pathStyle: 'win32', projectMappings: [{ from: '\\synthetic', projectId: 'repo', worktreeId: 'main' }] }] }), { code: 'CONFIG_INVALID' });
});

test('project mappings preserve namespace and worktree identity, use longest matching root', () => {
  const source = { id: 'fixture-win', pathStyle: 'win32', projectMappings: [
    { from: 'C:\\synthetic', projectId: 'broad', worktreeId: 'main' },
    { from: 'C:\\synthetic\\repo-a', projectId: 'repo', worktreeId: 'feature' },
  ] };
  const exact = projectIdentity({ ...source, projectMappings: source.projectMappings.slice(1) }, 'c:\\SYNTHETIC\\repo-a\\src');
  assert.deepEqual(projectIdentity(source, 'c:\\SYNTHETIC\\repo-a\\src'), exact);
  assert.equal(projectIdentity(source, 'C:\\synthetic-other\\repo-a').projectKey, null);
  assert.notDeepEqual(projectIdentity({ ...source, id: 'other-host' }, 'C:\\synthetic\\repo-a'), exact);
  assert.equal(projectIdentity(source, '\\\\server\\share').projectKey, null);
  assert.equal(projectIdentity(source, 'C:relative').projectKey, null);
  const sibling = projectIdentity({ ...source, projectMappings: [{ ...source.projectMappings[1], worktreeId: 'other' }] }, 'C:\\synthetic\\repo-a');
  assert.equal(sibling.projectKey, exact.projectKey);
  assert.notEqual(sibling.worktreeKey, exact.worktreeKey);
});

test('approved source opens read-only and rejects traversal, drive, UNC and alternate stream inputs before open', async (t) => {
  const f = await fixture(t); await f.fs.writeFile(f.file, lines([header()]));
  const { io, stats } = readonlyIO(), root = await approveRoot(f.source, io);
  const h = await openContained(root, 'session.jsonl', io); await h.close();
  assert.equal(stats.opened, 1);
  for (const relative of ['../outside.jsonl', '/outside.jsonl', '..\\outside.jsonl', 'C:/outside.jsonl', 'session.jsonl:stream', '//server/share', 'bad\u0000name'])
    await assert.rejects(openContained(root, relative, io), { code: 'PATH_DENIED' });
  assert.equal(stats.opened, 1);
  assert.equal(stats.active, 0);
});

test('symlinks, hard links and replaced roots fail closed without reading their target', async (t) => {
  const f = await fixture(t), outside = path.join(f.root, 'outside.jsonl');
  await f.fs.writeFile(outside, lines([header({ id: 'outside' })]));
  const { io, stats } = readonlyIO(), root = await approveRoot(f.source, io);
  await f.fs.symlink(outside, path.join(f.source, 'link.jsonl'));
  await assert.rejects(openContained(root, 'link.jsonl', io), { code: 'PATH_DENIED' });
  await f.fs.link(outside, path.join(f.source, 'hard.jsonl'));
  await assert.rejects(openContained(root, 'hard.jsonl', io), { code: 'PATH_DENIED' });
  await f.fs.rename(f.source, path.join(f.root, 'old-source')); await f.fs.mkdir(f.source);
  await assert.rejects(containedPath(root, '', io), { code: 'SOURCE_CHANGED' });
  assert.equal(stats.opened, 0);
});

test('identity replacement between check and open is rejected and handle closed', async (t) => {
  const f = await fixture(t); await f.fs.writeFile(f.file, lines([header()]));
  const { io, stats } = readonlyIO(), root = await approveRoot(f.source, io), realOpen = io.open;
  io.open = async (...args) => {
    const replacement = path.join(f.source, 'replacement.jsonl');
    await f.fs.writeFile(replacement, lines([header({ id: 'replacement' })]));
    await f.fs.rename(replacement, f.file);
    return realOpen(...args);
  };
  await assert.rejects(openContained(root, 'session.jsonl', io), { code: 'SOURCE_CHANGED' });
  assert.equal(stats.opened, stats.closed);
});

test('config is size-limited and errors expose codes, not source paths', async (t) => {
  const f = await fixture(t), file = path.join(f.root, 'approved-config.json');
  await f.fs.writeFile(file, JSON.stringify(configuration(f.source)));
  assert.equal((await readConfigFile(file)).sources[0].conversation, false);
  await f.fs.writeFile(file, 'x'.repeat(65537));
  await assert.rejects(readConfigFile(file), { code: 'CONFIG_INVALID' });
  assert.equal(errorCode(new Error('/private/SYNTHETIC_PRIVATE')), 'READ_FAILED');
  for (const code of ['ENOENT', 'EACCES', 'EMFILE', 'EIO']) assert.equal(errorCode({ code }), code);
});

test('a link in the middle of a path, or above the root, fails closed', async (t) => {
  const f = await fixture(t), outside = path.join(f.root, 'elsewhere');
  await f.fs.mkdir(outside); await f.fs.writeFile(path.join(outside, 'x.jsonl'), lines([header()]));
  const { io, stats } = readonlyIO(), root = await approveRoot(f.source, io);
  await f.fs.symlink(outside, path.join(f.source, 'sub'), 'junction');
  assert.ok((await f.fs.lstat(path.join(f.source, 'sub'))).isSymbolicLink(), 'the link really exists');
  await assert.rejects(containedPath(root, 'sub/x.jsonl', io), { code: 'PATH_DENIED' });
  await assert.rejects(openContained(root, 'sub/x.jsonl', io), { code: 'PATH_DENIED' });
  const via = path.join(f.root, 'via');
  await f.fs.symlink(f.root, via, 'junction');
  await assert.rejects(approveRoot(path.join(via, path.basename(f.source)), io), { code: 'PATH_DENIED' });
  assert.equal(stats.opened, 0);
});
