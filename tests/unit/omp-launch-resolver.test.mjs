import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createOmpLaunchResolver, validateOmpLaunchConfig } from '../../server/agents/omp/launch-resolver.mjs';
import { createOmpControlManager } from '../../server/agents/omp/control-manager.mjs';
import { createOmpRpcHost } from '../../server/agents/omp/rpc-host.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';

const sid = '00000000-0000-4000-8000-000000000001';
const id = ompSessionIdentity('fixture', sid).id;
const mk = () => {
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  const base = fs.mkdtempSync(path.resolve('test-results', 'omp-g3-unit-'));
  const root = path.join(base, 'project'), sessions = path.join(base, 'sessions'),
    home = path.join(base, 'home'), owners = path.join(base, 'owners'), bin = path.join(base, 'omp.exe');
  for (const dir of [root, sessions, home, owners]) fs.mkdirSync(dir);
  fs.writeFileSync(bin, 'FAKE-BINARY-NO-EXECUTION');
  const file = path.join(sessions, 'synthetic.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: sid, cwd: root }) + '\n');
  const st = fs.statSync(file);
  const config = { version: 1, binary: bin, resumeProtocol: 1,
    projects: [{ alias: 'work', root, sourceId: 'fixture', sessionDir: sessions, ownerDir: owners }],
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
  return { base, root, sessions, home, owners, bin, file, config, adapter };
};
const rm = (f) => fs.rmSync(f.base, { recursive: true, force: true });
const fake = path.resolve('tests/fixtures/omp/fake-rpc-host.mjs');
const hostFactory = ({ onExit }) => createOmpRpcHost({
  binary: process.execPath, args: [fake], cwd: process.cwd(), timeoutMs: 1500, onExit,
});

const intent = (projectAlias = 'work') => ({ mode: 'new', projectAlias, profileAlias: 'isolated' });
const readyState = (sessionId = '00000000-0000-4000-8000-000000000005') => ({
  sessionId, sessionFile: null, messageCount: 0, isStreaming: false, isSettled: true,
});
const barrier = () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  return { wait, release };
};
// Only the child/stdio boundary is doubled. Resolver, owner admission and public status stay real.
const controlledHosts = (optionsFor = () => ({})) => {
  const hosts = [];
  const factory = ({ onExit }) => {
    const options = optionsFor(hosts.length);
    let ready = false, closed = false;
    const host = {
      commands: [], closeCalls: 0,
      started: barrier(), stateRequested: barrier(),
      async start() {
        host.started.release();
        await options.startGate?.wait;
        if (options.startError) throw options.startError;
        if (closed) throw Object.assign(new Error('RPC_CLOSED'), { code: 'RPC_CLOSED' });
        ready = true;
      },
      pid: () => Object.hasOwn(options, 'pid') ? options.pid : 4000 + hosts.length,
      isReady: () => ready && !closed,
      async request(command) {
        host.commands.push(command);
        if (command === 'get_state') {
          host.stateRequested.release();
          await options.stateGate?.wait;
        }
        if (closed) throw Object.assign(new Error('RPC_CLOSED'), { code: 'RPC_CLOSED' });
        if (command === 'new_session') return Object.hasOwn(options, 'ack') ? options.ack : { cancelled: false };
        if (command === 'get_state') return Object.hasOwn(options, 'state') ? options.state : readyState();
        if (command === 'get_session_lease') return { held: [], unknown: [] };
        throw new Error('Unexpected child command: ' + command);
      },
      async close() {
        host.closeCalls++;
        host.exit();
      },
      exit() { closed = true; ready = false; onExit(); },
    };
    hosts.push(host);
    return host;
  };
  return { factory, hosts };
};
const assertNoOwner = (manager, adapter) => {
  assert.deepEqual(manager.status().sessions, []);
  assert.equal(adapter.managed.size, 0);
};
const managerFixture = async (f, children, extra = {}) => {
  const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
  return createOmpControlManager({ resolver, adapter: f.adapter, platform: 'win32',
    hostFactory: children.factory, ...extra });
};

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

// Real file bytes/handles; only metadata is controlled to reproduce Windows ctime-only EA
// changes without depending on kernel cache timing or filesystem timestamp precision.
const binaryMetadataIO = (f) => {
  const metadata = {}, pathMetadata = {}, rootMetadata = {};
  const observed = { opens: 0, closes: 0, reads: 0, onRead: null };
  const io = {
    ...fs.promises,
    async lstat(file) {
      const st = await fs.promises.lstat(file);
      if (file === f.bin) return Object.assign(st, metadata, pathMetadata);
      return file === f.base ? Object.assign(st, rootMetadata) : st;
    },
    async open(file, flags) {
      const handle = await fs.promises.open(file, flags);
      if (file !== f.bin) return handle;
      observed.opens++;
      return {
        stat: async () => Object.assign(await handle.stat(), metadata),
        async read(...args) {
          const result = await handle.read(...args);
          observed.reads++;
          observed.onRead?.();
          return result;
        },
        async close() { observed.closes++; await handle.close(); },
      };
    },
  };
  return { io, metadata, pathMetadata, rootMetadata, observed };
};

test('binary ctime-only EA drift rehashes pinned bytes once and caches only the verified stamp', async () => {
  const f = mk(), { io, metadata, observed } = binaryMetadataIO(f);
  try {
    const original = fs.statSync(f.bin);
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter, io });
    assert.equal(observed.opens, 1);
    assert.ok(observed.reads > 0);
    const startupReads = observed.reads;
    await resolver.build(intent());
    assert.equal(observed.reads, startupReads);
    metadata.ctimeMs = original.ctimeMs + 1000;
    assert.equal((await resolver.build(intent())).binary, f.bin);
    assert.equal(observed.opens, 2);
    const verifiedReads = observed.reads;
    assert.ok(verifiedReads > startupReads);
    await resolver.build(intent());
    assert.equal(observed.reads, verifiedReads);
    metadata.ctimeMs++;
    await resolver.build(intent());
    assert.equal(observed.opens, 3);
    assert.equal(observed.closes, observed.opens);
  } finally { rm(f); }
});

test('same-size binary rewrite with restored mtime is rejected by startup byte pin and never cached', async () => {
  const f = mk(), { io, metadata, observed } = binaryMetadataIO(f);
  try {
    const original = fs.statSync(f.bin), bytes = fs.readFileSync(f.bin);
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter, io });
    const changed = Buffer.from(bytes);
    changed[0] ^= 1;
    fs.writeFileSync(f.bin, changed);
    fs.utimesSync(f.bin, original.atime, original.mtime);
    // Expose the exact original mtime, avoiding Date/utimes precision differences across OSes.
    metadata.mtimeMs = original.mtimeMs;
    metadata.ctimeMs = original.ctimeMs + 1000;
    await assert.rejects(resolver.build(intent()), { code: 'LAUNCH_BINARY_CHANGED' });
    await assert.rejects(resolver.build(intent()), { code: 'LAUNCH_BINARY_CHANGED' });
    assert.equal(observed.opens, 3);
    fs.writeFileSync(f.bin, bytes);
    await resolver.build(intent());
    assert.equal(observed.opens, 4);
    assert.equal(observed.closes, observed.opens);
  } finally { rm(f); }
});

test('unchanged binary bytes do not excuse a replaced executable or changed strict identity fields', async (t) => {
  for (const field of ['replacement', 'dev', 'ino', 'size', 'mtimeMs', 'birthtimeMs', 'nlink']) {
    await t.test(field, async () => {
      const f = mk(), { io, metadata, observed } = binaryMetadataIO(f);
      try {
        const original = fs.statSync(f.bin), bytes = fs.readFileSync(f.bin);
        const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter, io });
        if (field === 'replacement') {
          fs.renameSync(f.bin, f.bin + '.old');
          fs.writeFileSync(f.bin, bytes);
        } else metadata[field] = original[field] + (field === 'ino' ? 4096 : 1);
        await assert.rejects(resolver.build(intent()), { code: 'LAUNCH_BINARY_CHANGED' });
        assert.equal(observed.opens, 1);
        assert.equal(observed.closes, observed.opens);
      } finally { rm(f); }
    });
  }
});

test('binary metadata changes during hash fail closed and cannot populate the accepted stamp cache', async (t) => {
  for (const field of ['ctimeMs', 'mtimeMs', 'ino', 'nlink']) {
    await t.test(field, async () => {
      const f = mk(), { io, metadata, observed } = binaryMetadataIO(f);
      try {
        const original = fs.statSync(f.bin);
        const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter, io });
        metadata.ctimeMs = original.ctimeMs + 1000;
        observed.onRead = () => {
          observed.onRead = null;
          metadata[field] = (metadata[field] ?? original[field]) + (field === 'ino' ? 4096 : 1);
        };
        await assert.rejects(resolver.build(intent()), { code: 'LAUNCH_BINARY_CHANGED' });
        assert.equal(observed.closes, observed.opens);
        delete metadata[field];
        metadata.ctimeMs = original.ctimeMs + 1000;
        await resolver.build(intent());
        assert.equal(observed.opens, 3);
        assert.equal(observed.closes, observed.opens);
      } finally { rm(f); }
    });
  }
});

test('binary rehash rechecks the pathname and approved binary directory after reading the handle', async (t) => {
  for (const target of ['path', 'root']) {
    await t.test(target, async () => {
      const f = mk(), { io, metadata, pathMetadata, rootMetadata, observed } = binaryMetadataIO(f);
      try {
        const original = fs.statSync(f.bin), root = fs.statSync(f.base);
        const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter, io });
        metadata.ctimeMs = original.ctimeMs + 1000;
        observed.onRead = () => {
          observed.onRead = null;
          // Windows file IDs có thể vượt 2^53; +1 khi đó có thể không đổi Number.
          if (target === 'path') pathMetadata.ino = original.ino + 4096;
          else rootMetadata.ino = root.ino + 4096;
        };
        await assert.rejects(resolver.build(intent()),
          { code: target === 'path' ? 'LAUNCH_BINARY_CHANGED' : 'SOURCE_CHANGED' });
        assert.equal(observed.closes, observed.opens);
        delete pathMetadata.ino;
        delete rootMetadata.ino;
        await resolver.build(intent());
        assert.equal(observed.opens, 3);
        assert.equal(observed.closes, observed.opens);
      } finally { rm(f); }
    });
  }
});

test('junction in allowlisted root is refused before process creation', async () => {
  const f = mk();
  try {
    const symlink = path.join(f.base, 'link');
    fs.symlinkSync(f.root, symlink, process.platform === 'win32' ? 'junction' : 'dir');
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

test('manager will never spawn on WSL/Linux production', async () => {
  const f = mk();
  try {
    const resolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
    const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'linux', hostFactory });
    assert.equal((await manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' })).code, 'LAUNCH_WINDOWS_ONLY');
    await manager.dispose();
  } finally { rm(f); }
});

test('config rejects invalid project/profile identity and non-native binary paths', () => {
  const f = mk();
  try {
    const changes = [
      (config) => { config.projects[0].alias = '../work'; },
      (config) => { config.projects[0].sourceId = ''; },
      (config) => { config.projects[0].sessionDir = '../sessions'; },
      (config) => { config.profiles[0].homeRoot = '../home'; },
      (config) => { config.profiles[0].name = '--profile'; },
      (config) => { config.profiles[0].model = 'synthetic/none --prompt'; },
      (config) => { config.projects.push({ ...config.projects[0] }); },
      (config) => { config.profiles.push({ ...config.profiles[0] }); },
      (config) => { config.binary = '\\\\server\\share\\omp.exe'; },
      (config) => { config.binary = f.bin + '\0.exe'; },
    ];
    for (const change of changes) {
      const config = structuredClone(f.config);
      change(config);
      assert.throws(() => validateOmpLaunchConfig(config), { code: 'LAUNCH_CONFIG_INVALID' });
    }
  } finally { rm(f); }
});

test('invalid project/profile alias fails without creating a child or actor', async () => {
  const f = mk(), children = controlledHosts();
  const manager = await managerFixture(f, children);
  try {
    assertNoOwner(manager, f.adapter);
    for (const request of [{ ...intent(), projectAlias: 'missing' }, { ...intent(), profileAlias: 'missing' }]) {
      assert.deepEqual(await manager.launch(request), { ok: false, code: 'LAUNCH_NOT_ALLOWED' });
      assertNoOwner(manager, f.adapter);
      assert.equal(children.hosts.length, 0);
    }
    assert.equal((await manager.launch(intent())).ok, true);
  } finally { await manager.dispose(); rm(f); }
});

test('junctions in profile/session/binary ancestors never become approved launch paths', async (t) => {
  for (const location of ['profile', 'sessions', 'binary-parent', 'project-ancestor']) {
    await t.test(location, async () => {
      const f = mk();
      try {
        const link = path.join(f.base, 'junction');
        const target = location === 'profile' ? f.home : location === 'sessions' ? f.sessions : f.base;
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        if (location === 'profile') f.config.profiles[0].homeRoot = link;
        if (location === 'sessions') f.config.projects[0].sessionDir = link;
        if (location === 'binary-parent') f.config.binary = path.join(link, 'omp.exe');
        if (location === 'project-ancestor') f.config.projects[0].root = path.join(link, 'project');
        await assert.rejects(createOmpLaunchResolver({ config: f.config, adapter: f.adapter }), { code: 'PATH_DENIED' });
        assert.equal(f.adapter.managed.size, 0);
      } finally { rm(f); }
    });
  }
});

test('binary hardlinks and source-root disagreement are not accepted as allowlist entries', async (t) => {
  for (const scenario of ['hardlink', 'wrong-source']) {
    await t.test(scenario, async () => {
      const f = mk();
      try {
        if (scenario === 'hardlink') fs.linkSync(f.bin, path.join(f.base, 'other.exe'));
        else f.adapter.sourceForLaunch = () => ({ sourceId: 'fixture', sourceRoot: f.root });
        await assert.rejects(createOmpLaunchResolver({ config: f.config, adapter: f.adapter }),
          { code: scenario === 'hardlink' ? 'LAUNCH_BINARY_INVALID' : 'LAUNCH_SOURCE_MISMATCH' });
        assert.equal(f.adapter.managed.size, 0);
      } finally { rm(f); }
    });
  }
});

test('replacing an approved project/profile/session directory rejects launch before spawn', async (t) => {
  for (const location of ['root', 'home', 'sessions']) {
    await t.test(location, async () => {
      const f = mk(), children = controlledHosts();
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        const original = f[location];
        fs.renameSync(original, original + '-old');
        fs.mkdirSync(original);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'SOURCE_CHANGED' });
        assert.equal(children.hosts.length, 0);
        assertNoOwner(manager, f.adapter);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('catalog containment and source identity are checked before any resume child exists', async (t) => {
  const scenarios = [
    ['parent traversal', () => ({ relative: '../synthetic.jsonl' }), 'PATH_DENIED'],
    ['absolute file', (f) => ({ relative: f.file }), 'PATH_DENIED'],
    ['alternate source', () => ({ sourceId: 'foreign' }), 'LAUNCH_INVALID_CANDIDATE'],
    ['alternate cwd', (f) => ({ cwd: f.home }), 'LAUNCH_INVALID_CANDIDATE'],
    ['ambiguous owner', () => ({ ownerUnknown: true }), 'LAUNCH_OWNER_UNKNOWN'],
    ['observed runtime', () => ({ runtimeObserved: true }), 'LAUNCH_OWNER_UNKNOWN'],
    ['junction file ancestor', (f) => {
      fs.symlinkSync(f.root, path.join(f.sessions, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      fs.writeFileSync(path.join(f.root, 'synthetic.jsonl'), fs.readFileSync(f.file));
      return { relative: 'linked/synthetic.jsonl' };
    }, 'PATH_DENIED'],
  ];
  for (const [label, changes, code] of scenarios) {
    await t.test(label, async () => {
      const f = mk(), children = controlledHosts();
      const original = f.adapter.candidateForLaunch, changed = changes(f);
      f.adapter.candidateForLaunch = (target) => {
        const record = original(target);
        return record ? { ...record, ...changed } : null;
      };
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(await manager.launch({ ...intent(), mode: 'resume', candidateId: id }), { ok: false, code });
        assert.equal(children.hosts.length, 0);
        assertNoOwner(manager, f.adapter);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('resume validates the exact session header, not only its catalog fingerprint', async (t) => {
  for (const changed of [{ id: 'wrong-session' }, { version: 2 }, { cwd: 'wrong-project' }]) {
    await t.test(JSON.stringify(changed), async () => {
      const f = mk(), children = controlledHosts();
      const header = { type: 'session', version: 3, id: sid, cwd: f.root, ...changed };
      fs.writeFileSync(f.file, JSON.stringify(header) + '\n');
      const stat = fs.statSync(f.file), original = f.adapter.candidateForLaunch;
      f.adapter.candidateForLaunch = (target) => {
        const record = original(target);
        return record ? { ...record, fileSize: stat.size, fileMtime: stat.mtimeMs, fileCtime: stat.ctimeMs } : null;
      };
      const manager = await managerFixture(f, children);
      try {
        assert.deepEqual(await manager.launch({ ...intent(), mode: 'resume', candidateId: id }),
          { ok: false, code: 'LAUNCH_INVALID_CANDIDATE' });
        assert.equal(children.hosts.length, 0);
        assertNoOwner(manager, f.adapter);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('new_session rejection never publishes an actor and releases the launch lock', async (t) => {
  for (const ack of [null, {}, { cancelled: true }, { cancelled: 'false' }]) {
    await t.test(JSON.stringify(ack), async () => {
      const f = mk(), children = controlledHosts((index) => index === 0 ? { ack } : {});
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_NEW_REJECTED' });
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(children.hosts[0].commands, ['new_session']);
        assert.equal(children.hosts[0].isReady(), false);
        assert.ok(children.hosts[0].closeCalls > 0);
        assert.equal((await manager.launch(intent())).ok, true);
        assert.equal(manager.status().sessions.length, 1);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('invalid state identity or non-idle new state closes only the unpublished child', async (t) => {
  const states = [null, { ...readyState(), sessionId: '' }, { ...readyState(), sessionId: 'bad\nid' },
    { ...readyState(), messageCount: -1 }, { ...readyState(), messageCount: 0.5 },
    { ...readyState(), messageCount: 1 }, { ...readyState(), isStreaming: true },
    { ...readyState(), isSettled: false }];
  for (const state of states) {
    await t.test(JSON.stringify(state), async () => {
      const f = mk(), children = controlledHosts((index) => index === 0 ? { state } : {});
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_IDENTITY_MISMATCH' });
        assertNoOwner(manager, f.adapter);
        assert.equal(children.hosts[0].isReady(), false);
        assert.ok(children.hosts[0].closeCalls > 0);
        assert.equal((await manager.launch(intent())).ok, true);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('invalid child PIDs fail before any session command and do not leave ownership', async (t) => {
  for (const pid of [0, -1, 1.5, Number.NaN, '4001', undefined]) {
    await t.test(String(pid), async () => {
      const f = mk(), children = controlledHosts((index) => index === 0 ? { pid } : {});
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_PID_INVALID' });
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(children.hosts[0].commands, []);
        assert.equal(children.hosts[0].isReady(), false);
        assert.equal((await manager.launch(intent())).ok, true);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('catalog/runtime collisions never replace an existing actor', async (t) => {
  for (const conflict of ['catalog', 'observed-runtime']) {
    await t.test(conflict, async () => {
      const f = mk(), children = controlledHosts();
      const publicId = ompSessionIdentity('fixture', readyState().sessionId).id;
      if (conflict === 'catalog') f.adapter.candidateForLaunch = (target) => target === publicId ? { id: publicId } : null;
      else f.adapter.hasObservedRuntime = (target) => target === publicId;
      const manager = await managerFixture(f, children);
      try {
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_OWNER_CONFLICT' });
        assertNoOwner(manager, f.adapter);
        assert.equal(children.hosts[0].isReady(), false);
      } finally { await manager.dispose(); rm(f); }
    });
  }
});

test('same-ID child collision closes the newcomer, never the owned generation', async () => {
  const f = mk(), children = controlledHosts();
  const manager = await managerFixture(f, children);
  try {
    const first = await manager.launch(intent());
    assert.equal(first.ok, true);
    const owner = f.adapter.managed.get(first.session.id);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_OWNER_CONFLICT' });
    assert.deepEqual(manager.status().sessions, [first.session]);
    assert.equal(f.adapter.managed.get(first.session.id), owner);
    assert.equal(children.hosts[0].closeCalls, 0);
    assert.equal(children.hosts[0].isReady(), true);
    assert.equal(children.hosts[1].isReady(), false);
  } finally { await manager.dispose(); rm(f); }
});

test('adapter owner conflict and shutdown never close or remove a foreign runtime', async () => {
  const f = mk(), children = controlledHosts();
  let foreignSignals = 0;
  const publicId = ompSessionIdentity('fixture', readyState().sessionId).id;
  const foreign = { id: publicId, runtimeInstanceId: 'external-tui', generation: 99,
    rpc: { close: () => { foreignSignals++; } } };
  f.adapter.managed.set(publicId, foreign);
  const manager = await managerFixture(f, children);
  try {
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_OWNER_CONFLICT' });
    assert.deepEqual(manager.status().sessions, []);
    assert.equal(f.adapter.managed.get(publicId), foreign);
    assert.equal(children.hosts[0].isReady(), false);
    await manager.dispose();
    assert.equal(f.adapter.managed.get(publicId), foreign);
    assert.equal(foreignSignals, 0);
    assert.equal(children.hosts.length, 1);
  } finally { await manager.dispose(); rm(f); }
});

test('exit removes its exact generation and a delayed old exit cannot erase the replacement', async () => {
  const f = mk(), children = controlledHosts();
  const manager = await managerFixture(f, children);
  try {
    const first = await manager.launch(intent());
    assert.equal(first.ok, true);
    children.hosts[0].exit();
    assertNoOwner(manager, f.adapter);
    const second = await manager.launch(intent());
    assert.equal(second.ok, true);
    assert.equal(second.session.id, first.session.id);
    assert.notEqual(second.session.runtimeInstanceId, first.session.runtimeInstanceId);
    assert.ok(second.session.generation > first.session.generation);
    const replacement = f.adapter.managed.get(second.session.id);
    children.hosts[0].exit();
    assert.deepEqual(manager.status().sessions, [second.session]);
    assert.equal(f.adapter.managed.get(second.session.id), replacement);
    assert.equal(children.hosts[1].closeCalls, 0);
    assert.equal(children.hosts[1].isReady(), true);
  } finally { await manager.dispose(); rm(f); }
});

test('owned exit cannot remove an adapter record replaced by a foreign generation', async () => {
  const f = mk(), children = controlledHosts();
  const manager = await managerFixture(f, children);
  try {
    const first = await manager.launch(intent());
    assert.equal(first.ok, true);
    const foreign = { id: first.session.id, runtimeInstanceId: 'foreign-generation', generation: 100 };
    f.adapter.managed.set(foreign.id, foreign);
    children.hosts[0].exit();
    assert.deepEqual(manager.status().sessions, []);
    assert.equal(f.adapter.managed.get(foreign.id), foreign);
    await manager.dispose();
    assert.equal(f.adapter.managed.get(foreign.id), foreign);
  } finally { await manager.dispose(); rm(f); }
});

test('concurrent same-project launch is rejected while startup is held at an explicit barrier', async () => {
  const f = mk(), startGate = barrier(), created = barrier();
  const children = controlledHosts(() => { created.release(); return { startGate }; });
  const manager = await managerFixture(f, children);
  let launching;
  try {
    launching = manager.launch(intent());
    await created.wait;
    await children.hosts[0].started.wait;
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_BUSY' });
    assert.equal(children.hosts.length, 1);
    startGate.release();
    assert.equal((await launching).ok, true);
    assert.equal(manager.status().sessions.length, 1);
    assert.equal(f.adapter.managed.size, 1);
  } finally { startGate.release(); await launching; await manager.dispose(); rm(f); }
});

test('child exit during state handshake leaves no actor or stale ownership', async () => {
  const f = mk(), stateGate = barrier(), created = barrier();
  const children = controlledHosts(() => { created.release(); return { stateGate }; });
  const manager = await managerFixture(f, children);
  let launching;
  try {
    launching = manager.launch(intent());
    await created.wait;
    await children.hosts[0].stateRequested.wait;
    assertNoOwner(manager, f.adapter);
    children.hosts[0].exit();
    stateGate.release();
    assert.deepEqual(await launching, { ok: false, code: 'RPC_CLOSED' });
    assertNoOwner(manager, f.adapter);
    assert.equal(children.hosts[0].isReady(), false);
  } finally { stateGate.release(); await launching; await manager.dispose(); rm(f); }
});

test('dispose before resolver completion cannot spawn or attach a late child', async () => {
  const f = mk(), children = controlledHosts(), buildGate = barrier(), entered = barrier();
  const realResolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
  const resolver = { ...realResolver, async build(request) {
    entered.release();
    await buildGate.wait;
    return realResolver.build(request);
  } };
  const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'win32', hostFactory: children.factory });
  let launching;
  try {
    launching = manager.launch(intent());
    await entered.wait;
    assertNoOwner(manager, f.adapter);
    await manager.dispose();
    assert.equal(manager.status().enabled, false);
    assertNoOwner(manager, f.adapter);
    buildGate.release();
    assert.deepEqual(await launching, { ok: false, code: 'LAUNCH_UNAVAILABLE' });
    assert.equal(children.hosts.length, 0);
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_UNAVAILABLE' });
  } finally { buildGate.release(); await launching; await manager.dispose(); rm(f); }
});

test('dispose during startup or state handshake leaves no late actor or ownership', async (t) => {
  for (const stage of ['start', 'state']) {
    await t.test(stage, async () => {
      const f = mk(), gate = barrier(), created = barrier();
      const children = controlledHosts(() => {
        created.release();
        return stage === 'start' ? { startGate: gate } : { stateGate: gate };
      });
      const changes = [];
      const manager = await managerFixture(f, children, { onChange: (changedId) => changes.push(changedId) });
      let launching;
      try {
        launching = manager.launch(intent());
        await created.wait;
        await (stage === 'start' ? children.hosts[0].started.wait : children.hosts[0].stateRequested.wait);
        assertNoOwner(manager, f.adapter);
        await manager.dispose();
        assertNoOwner(manager, f.adapter);
        assert.equal(manager.status().enabled, false);
        assert.equal(children.hosts[0].isReady(), false);
        gate.release();
        assert.deepEqual(await launching, { ok: false, code: 'RPC_CLOSED' });
        assertNoOwner(manager, f.adapter);
        assert.deepEqual(changes, []);
        assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_UNAVAILABLE' });
        assert.equal(children.hosts.length, 1);
      } finally { gate.release(); await launching; await manager.dispose(); rm(f); }
    });
  }
});

test('shutdown closes every owned child without deleting history or restarting', async () => {
  const f = mk();
  const children = controlledHosts((index) => ({ state: readyState('shutdown-' + index) }));
  const manager = await managerFixture(f, children);
  const transcript = fs.readFileSync(f.file, 'utf8');
  try {
    assert.equal((await manager.launch(intent())).ok, true);
    assert.equal((await manager.launch(intent())).ok, true);
    assert.equal(manager.status().sessions.length, 2);
    assert.equal(f.adapter.managed.size, 2);
    await manager.dispose();
    assertNoOwner(manager, f.adapter);
    assert.equal(manager.status().enabled, false);
    assert.equal(children.hosts.every((child) => !child.isReady() && child.closeCalls > 0), true);
    assert.equal(fs.readFileSync(f.file, 'utf8'), transcript);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_UNAVAILABLE' });
    assert.equal(children.hosts.length, 2);
  } finally { await manager.dispose(); rm(f); }
});

test('stock/default config refuses resume before spawning even when a lease probe reports free', async () => {
  const f = mk(), children = controlledHosts();
  delete f.config.resumeProtocol;
  delete f.config.projects[0].ownerDir;
  const manager = await managerFixture(f, children);
  try {
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch({ ...intent(), mode: 'resume', candidateId: id }),
      { ok: false, code: 'LAUNCH_OWNER_UNVERIFIED' });
    assert.equal(children.hosts.length, 0);
    assertNoOwner(manager, f.adapter);
  } finally { await manager.dispose(); rm(f); }
});

const resumedState = (f) => ({
  ...readyState(sid), sessionFile: f.file,
  officeOwnership: { protocol: 1, exclusive: true, sessionId: sid, sessionFile: f.file,
    sha256: createHash('sha256').update(fs.readFileSync(f.file)).digest('hex') },
});

test('Resume attaches the selected ID only after native ownership proof and preserves one actor', async () => {
  const f = mk(), children = controlledHosts(() => ({ state: resumedState(f) }));
  const manager = await managerFixture(f, children);
  try {
    const request = { ...intent(), mode: 'resume', candidateId: id };
    const result = await manager.launch(request);
    assert.equal(result.ok, true);
    assert.equal(result.session.id, id);
    assert.equal(f.adapter.managed.get(id).sourceSessionId, sid);
    assert.deepEqual(children.hosts[0].commands, ['get_state']);
    assert.deepEqual(await manager.launch(request), { ok: false, code: 'LAUNCH_OWNER_CONFLICT' });
    assert.equal(manager.status().sessions.length, 1);
    assert.equal(children.hosts.length, 1);
    const publicState = JSON.stringify(manager.status());
    for (const privateValue of [f.file, f.owners, sid, 'officeOwnership', 'sha256']) assert.equal(publicState.includes(privateValue), false);
  } finally { await manager.dispose(); rm(f); }
});

test('Resume never registers a child with missing, stale, foreign or non-exclusive native proof', async (t) => {
  const changes = {
    absent: (s) => { delete s.officeOwnership; },
    protocol: (s) => { s.officeOwnership.protocol = 2; },
    nonexclusive: (s) => { s.officeOwnership.exclusive = false; },
    staleId: (s) => { s.officeOwnership.sessionId = 'other-session'; },
    otherFile: (s) => { s.officeOwnership.sessionFile += '.other'; },
    staleBytes: (s) => { s.officeOwnership.sha256 = '0'.repeat(64); },
    redirectedRuntime: (s) => { s.sessionFile += '.other'; },
    redirectedId: (s) => { s.sessionId = 'other-session'; },
    missingReadyProtocol: (_s, hostOptions) => { hostOptions.startError = Object.assign(new Error('RPC_OWNERSHIP_PROTOCOL'), { code: 'RPC_OWNERSHIP_PROTOCOL' }); },
    contendedExitBeforeReady: (_s, hostOptions) => { hostOptions.startError = Object.assign(new Error('RPC_CLOSED'), { code: 'RPC_CLOSED' }); },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = mk(), state = resumedState(f);
    const hostOptions = { state };
    change(state, hostOptions);
    const children = controlledHosts(() => hostOptions);
    const manager = await managerFixture(f, children);
    try {
      assert.deepEqual(await manager.launch({ ...intent(), mode: 'resume', candidateId: id }),
        { ok: false, code: 'LAUNCH_OWNER_UNVERIFIED' });
      assertNoOwner(manager, f.adapter);
      assert.equal(children.hosts[0].isReady(), false);
    } finally { await manager.dispose(); rm(f); }
  });
});

test('Resume revalidates the source after a valid native proof before publishing ownership', async () => {
  const f = mk(), gate = barrier(), created = barrier();
  const children = controlledHosts(() => { created.release(); return { state: resumedState(f), stateGate: gate }; });
  const manager = await managerFixture(f, children);
  let launched;
  try {
    launched = manager.launch({ ...intent(), mode: 'resume', candidateId: id });
    await created.wait;
    await children.hosts[0].stateRequested.wait;
    fs.appendFileSync(f.file, '{"type":"message","id":"changed"}\n');
    gate.release();
    assert.deepEqual(await launched, { ok: false, code: 'SOURCE_CHANGED' });
    assertNoOwner(manager, f.adapter);
    assert.equal(children.hosts[0].isReady(), false);
  } finally { gate.release(); await launched; await manager.dispose(); rm(f); }
});

test('managed child limit counts ready owners and releases slots on exit and failure', async () => {
  const f = mk();
  const children = controlledHosts((index) => ({
    state: readyState('capacity-' + index), ...(index === 8 ? { ack: { cancelled: true } } : {}),
  }));
  const manager = await managerFixture(f, children);
  try {
    for (let index = 0; index < 8; index++) assert.equal((await manager.launch(intent())).ok, true);
    assert.equal(manager.status().sessions.length, 8);
    assert.equal(f.adapter.managed.size, 8);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_LIMIT' });
    assert.equal(children.hosts.length, 8);
    children.hosts[0].exit();
    assert.equal(manager.status().sessions.length, 7);
    assert.deepEqual(await manager.launch({ ...intent(), profileAlias: 'missing' }),
      { ok: false, code: 'LAUNCH_NOT_ALLOWED' });
    assert.equal(children.hosts.length, 8);
    assert.equal(manager.status().sessions.length, 7);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_NEW_REJECTED' });
    assert.equal(manager.status().sessions.length, 7);
    assert.equal(f.adapter.managed.size, 7);
    assert.equal((await manager.launch(intent())).ok, true);
    assert.equal(manager.status().sessions.length, 8);
    assert.equal(f.adapter.managed.size, 8);
    assert.equal(children.hosts[0].closeCalls, 0);
    assert.equal(children.hosts.slice(1, 8).every((child) => child.closeCalls === 0), true);
    await manager.dispose();
    assertNoOwner(manager, f.adapter);
  } finally { await manager.dispose(); rm(f); }
});

test('managed child limit reserves capacity before async resolution and startup', async () => {
  const f = mk(), buildGate = barrier(), startGate = barrier(), allStarted = barrier();
  f.config.projects = Array.from({ length: 9 }, (_, index) => ({ ...f.config.projects[0], alias: 'work-' + index }));
  const realResolver = await createOmpLaunchResolver({ config: f.config, adapter: f.adapter });
  let resolved = 0;
  const resolver = { ...realResolver, async build(request) {
    resolved++;
    await buildGate.wait;
    return realResolver.build(request);
  } };
  const children = controlledHosts((index) => {
    if (index === 7) allStarted.release();
    return { startGate, state: readyState('pending-capacity-' + index) };
  });
  const manager = createOmpControlManager({ resolver, adapter: f.adapter, platform: 'win32', hostFactory: children.factory });
  const launches = [];
  try {
    for (let index = 0; index < 8; index++) launches.push(manager.launch(intent('work-' + index)));
    assert.equal(resolved, 8);
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch(intent('work-8')), { ok: false, code: 'LAUNCH_LIMIT' });
    assert.equal(children.hosts.length, 0);
    buildGate.release();
    await allStarted.wait;
    assert.equal(children.hosts.length, 8);
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch(intent('work-8')), { ok: false, code: 'LAUNCH_LIMIT' });
    await manager.dispose();
    assertNoOwner(manager, f.adapter);
    assert.equal(children.hosts.every((child) => !child.isReady()), true);
    startGate.release();
    const replies = await Promise.all(launches);
    assert.equal(replies.every((reply) => reply.ok === false), true);
    assertNoOwner(manager, f.adapter);
    assert.deepEqual(await manager.launch(intent('work-8')), { ok: false, code: 'LAUNCH_UNAVAILABLE' });
    assert.equal(children.hosts.length, 8);
  } finally {
    buildGate.release(); startGate.release();
    await Promise.all(launches); await manager.dispose(); rm(f);
  }
});

test('managed child limit counts ready owners and pending startups together', async () => {
  const f = mk(), startGate = barrier(), pendingCreated = barrier();
  f.config.projects.push({ ...f.config.projects[0], alias: 'other' });
  const children = controlledHosts((index) => {
    if (index === 7) pendingCreated.release();
    return { state: readyState('mixed-capacity-' + index), ...(index === 7 ? { startGate } : {}) };
  });
  const manager = await managerFixture(f, children);
  let pending;
  try {
    for (let index = 0; index < 7; index++) assert.equal((await manager.launch(intent())).ok, true);
    pending = manager.launch(intent('other'));
    await pendingCreated.wait;
    await children.hosts[7].started.wait;
    assert.equal(manager.status().sessions.length, 7);
    assert.equal(f.adapter.managed.size, 7);
    assert.deepEqual(await manager.launch(intent()), { ok: false, code: 'LAUNCH_LIMIT' });
    assert.equal(children.hosts.length, 8);
    children.hosts[0].exit();
    assert.equal((await manager.launch(intent())).ok, true);
    assert.equal(manager.status().sessions.length, 7);
    startGate.release();
    assert.equal((await pending).ok, true);
    assert.equal(manager.status().sessions.length, 8);
    assert.equal(f.adapter.managed.size, 8);
    await manager.dispose();
    assertNoOwner(manager, f.adapter);
  } finally { startGate.release(); await pending; await manager.dispose(); rm(f); }
});

test('concurrent aliases reporting the same session attach only one owned generation', async () => {
  const f = mk(), stateGate = barrier(), bothCreated = barrier();
  f.config.projects.push({ ...f.config.projects[0], alias: 'other' });
  const children = controlledHosts((index) => {
    if (index === 1) bothCreated.release();
    return { stateGate };
  });
  const manager = await managerFixture(f, children);
  const launches = [];
  try {
    launches.push(manager.launch(intent()), manager.launch(intent('other')));
    await bothCreated.wait;
    await Promise.all(children.hosts.map((child) => child.stateRequested.wait));
    assertNoOwner(manager, f.adapter);
    stateGate.release();
    const replies = await Promise.all(launches);
    const winnerIndex = replies.findIndex((reply) => reply.ok === true);
    const loserIndex = replies.findIndex((reply) => reply.code === 'LAUNCH_OWNER_CONFLICT');
    assert.notEqual(winnerIndex, -1);
    assert.notEqual(loserIndex, -1);
    assert.notEqual(winnerIndex, loserIndex);
    assert.deepEqual(manager.status().sessions, [replies[winnerIndex].session]);
    assert.equal(f.adapter.managed.size, 1);
    assert.equal(children.hosts.filter((child) => child.isReady()).length, 1);
    assert.equal(children.hosts.filter((child) => child.closeCalls > 0).length, 1);
  } finally {
    stateGate.release(); await Promise.all(launches); await manager.dispose(); rm(f);
  }
});
