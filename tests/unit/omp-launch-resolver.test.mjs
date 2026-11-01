import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOmpLaunchResolver, validateOmpLaunchConfig } from '../../server/agents/omp/launch-resolver.mjs';
import { createOmpControlManager } from '../../server/agents/omp/control-manager.mjs';
import { createOmpRpcHost } from '../../server/agents/omp/rpc-host.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';

const sid = '00000000-0000-4000-8000-000000000001';
const id = ompSessionIdentity('fixture', sid).id;
const mk = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-g3-'));
  const root = path.join(base, 'project'), sessions = path.join(base, 'sessions'),
    home = path.join(base, 'home'), bin = path.join(base, 'omp.exe');
  for (const dir of [root, sessions, home]) fs.mkdirSync(dir);
  fs.writeFileSync(bin, 'FAKE-BINARY-NO-EXECUTION');
  const file = path.join(sessions, 'synthetic.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: sid, cwd: root }) + '\n');
  const st = fs.statSync(file);
  const config = { version: 1, binary: bin,
    projects: [{ alias: 'work', root, sourceId: 'fixture', sessionDir: sessions }],
    profiles: [{ alias: 'isolated', name: 'g3-fixture', homeRoot: home, model: 'synthetic/none' }] };
  const adapter = {
    sourceForLaunch: (sourceId) => sourceId === 'fixture' ? { sourceId, sourceRoot: sessions } : null,
    candidateForLaunch: (target) => target === id ? { id, sourceId: 'fixture', sourceRoot: sessions,
      relative: 'synthetic.jsonl', sessionId: sid, cwd: root, fileKey: st.dev + ':' + st.ino,
      fileSize: st.size, fileMtime: st.mtimeMs, fileCtime: st.ctimeMs, runtimeObserved: false } : null,
    hasObservedRuntime: () => false,
    managed: new Map(),
    setManaged(record) { if (this.managed.has(record.id)) return false; this.managed.set(record.id, record); return true; },
    removeManaged(idToRemove, runtimeInstanceId) {
      if (this.managed.get(idToRemove)?.runtimeInstanceId !== runtimeInstanceId) return false;
      this.managed.delete(idToRemove); return true;
    },
  };
  return { base, root, sessions, home, bin, file, config, adapter };
};
const rm = (f) => fs.rmSync(f.base, { recursive: true, force: true });
const fake = path.resolve('tests/fixtures/omp/fake-rpc-host.mjs');
const hostFactory = ({ onExit }) => createOmpRpcHost({
  binary: process.execPath, args: [fake], cwd: process.cwd(), timeoutMs: 1500, onExit,
});

test('strict binary/project/profile config requires owner-defined aliases and paths', () => {
  const f = mk();
  try {
    assert.equal(validateOmpLaunchConfig(f.config).projects.get('work').sourceId, 'fixture');
    assert.throws(() => validateOmpLaunchConfig({ ...f.config, projects: [{ alias: 'a', root: '../x' }] }), { code: 'LAUNCH_CONFIG_INVALID' });
    assert.throws(() => validateOmpLaunchConfig({ ...f.config, binary: 'cmd.exe' }), { code: 'LAUNCH_CONFIG_INVALID' });
    assert.throws(() => validateOmpLaunchConfig({ ...f.config, unknown: 1 }), { code: 'LAUNCH_CONFIG_INVALID' });
  } finally { rm(f); }
});

test('resolver selects exact catalog ID, source and profile, not latest file', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    const n = await resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'new' });
    assert.equal(n.cwd, f.root);
    assert.equal(n.candidate, null);
    assert.equal(n.args.includes('--resume'), false);
    const resumed = await resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'resume', candidateId: id });
    assert.equal(resumed.candidate.exactFile, f.file);
    assert.deepEqual(resumed.args.slice(-2), ['--resume', f.file]);
    await assert.rejects(resolver.build({ projectAlias: 'work', profileAlias: 'missing' }), { code: 'LAUNCH_NOT_ALLOWED' });
    await assert.rejects(resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'resume', candidateId: 'omp:' + 'f'.repeat(64) }), { code: 'LAUNCH_INVALID_CANDIDATE' });
  } finally { rm(f); }
});

test('resolver blocks observed runtime, swapped header and binary/root mutation', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    const orig = f.adapter.candidateForLaunch;
    f.adapter.candidateForLaunch = (...args) => ({ ...orig(...args), runtimeObserved: true });
    await assert.rejects(resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'resume', candidateId: id }), { code: 'LAUNCH_OWNER_UNKNOWN' });
    f.adapter.candidateForLaunch = orig;
    fs.writeFileSync(f.file, JSON.stringify({ type: 'session', version: 3, id: 'wrong', cwd: f.root }) + '\n');
    await assert.rejects(resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'resume', candidateId: id }));
    fs.unlinkSync(f.bin); fs.writeFileSync(f.bin, 'DIFFERENT EXECUTABLE');
    await assert.rejects(resolver.build({ projectAlias: 'work', profileAlias: 'isolated', mode: 'new' }), { code: 'LAUNCH_BINARY_CHANGED' });
  } finally { rm(f); }
});

test('symlink in allowlisted root is refused before process creation', async (t) => {
  const f = mk();
  try {
    const symlink = path.join(f.base, 'link');
    try { fs.symlinkSync(f.root, symlink, 'dir'); }
    catch { t.skip('Windows symlink privilege unavailable'); return; }
    f.config.projects[0].root = symlink;
    await assert.rejects(createOmpLaunchResolver({ config: f.config, adapter: f.adapter }), { code: 'PATH_DENIED' });
  } finally { rm(f); }
});

test('manager synthetic new child, sanitized status, bounded ownership and EOF cleanup', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    // This fixture's synthetic new_session ID is separate from its catalog only when the catalog is empty.
    // A collision with an existing history ID must be blocked (tested by the manager's owner-conflict guard).
    f.adapter.candidateForLaunch = () => null;
    const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'win32', hostFactory });
    try {
      const bad = await manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated', argv: ['--prompt'] });
      assert.equal(bad.code, 'LAUNCH_INVALID');
      const result = await manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.session.id, ompSessionIdentity('fixture', '00000000-0000-4000-8000-000000000005').id);
      assert.equal(f.adapter.managed.size, 1);
      assert.equal(manager.status().sessions.length, 1);
      assert.equal(JSON.stringify(manager.status()).includes(f.root), false);
      assert.equal((await manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' })).code, 'LAUNCH_OWNER_CONFLICT');
    } finally { await manager.dispose(); }
    assert.equal(f.adapter.managed.size, 0);
    assert.equal(manager.status().enabled, false);
  } finally { rm(f); }
});

test('manager resume refuses unproved external owner without spawning a child', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    let spawned = 0;
    const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'win32',
      hostFactory: (x) => { spawned++; return hostFactory(x); } });
    try {
      const reply = await manager.launch({ mode: 'resume', projectAlias: 'work', profileAlias: 'isolated', candidateId: id });
      assert.equal(reply.code, 'LAUNCH_OWNER_UNVERIFIED');
      assert.equal(spawned, 0);
    } finally { await manager.dispose(); }
  } finally { rm(f); }
});

test('manager will never spawn on WSL/Linux production', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'linux', hostFactory });
    assert.equal((await manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' })).code, 'LAUNCH_WINDOWS_ONLY');
    await manager.dispose();
  } finally { rm(f); }
});
