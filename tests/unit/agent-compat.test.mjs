import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRegistry } from '../../server/agents/registry.mjs';
import { createClaudeAdapter } from '../../server/agents/claude/compat.mjs';
import { projectClaudeSession, projectOmpSession } from '../../server/agents/projection.mjs';
import { isClaudeRequest, resolveOmpMode } from '../../server/agents/schema.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const makeClaude = () => {
  const sessions = new Map([['legacy-id', {
    id: 'legacy-id', sid: 'shared-sid', pid: 123, name: 'shop', status: 'rest',
    usage: { ctx: 1, ctxMax: 100, cost: 2 }, subs: [], acct: ''
  }]]);
  const logs = [];
  const adapter = createClaudeAdapter({
    listSessions: () => [...sessions.values()],
    resolveSession: (id) => sessions.get(id) || null,
    publicSession: (s) => ({ ...s }),
    readLog: async (s, n, child) => { logs.push([s.id, n, child]); return [{ role: 'claude', text: 'unchanged' }]; },
  });
  return { adapter, sessions, logs };
};

test('Claude-only registry preserves sessions and conversation shape', async () => {
  const { adapter, logs } = makeClaude();
  const registry = createAgentRegistry({ adapters: [adapter] });
  const rows = registry.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'legacy-id');
  assert.equal(rows[0].agentKind, 'claude');
  assert.equal(rows[0].usage.cost, 2);
  assert.equal(registry.resolve('legacy-id').kind, 'claude');
  assert.equal(registry.resolve('unknown'), null);
  assert.deepEqual(await registry.readConversation('legacy-id', 120), [{ role: 'claude', text: 'unchanged' }]);
  assert.deepEqual(logs, [['legacy-id', 120, null]]);
  assert.equal(registry.resolveForControl('legacy-id', 'changeAccount').kind, 'claude');
});

test('synthetic OMP and Claude with same sid/name never cross control/read paths', async () => {
  const { adapter, sessions, logs } = makeClaude();
  const entry = { sourceNamespace: 'fixture-wsl-a', sourceSessionId: 'shared-sid', name: 'shop', pid: 123, capabilities: { openWindow: true } };
  const omp = projectOmpSession(entry);
  let ompStarts = 0;
  const registry = createAgentRegistry({ adapters: [adapter, {
    kind: 'omp', list: () => [entry], resolve: (id) => id === omp.id ? entry : null,
    readConversation: () => { throw new Error('OMP conversation must not be read'); },
    start: () => { ompStarts++; },
  }] });
  const rows = registry.list();
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((s) => s.id)).size, 2);
  assert.equal(rows.find((s) => s.agentKind === 'omp').usage, null);
  assert.equal(registry.resolve(omp.id).kind, 'omp');
  assert.equal(registry.resolveForControl(omp.id, 'openWindow'), null);
  assert.equal(registry.resolveForControl(omp.id, 'changeAccount'), null);
  assert.deepEqual(await registry.readConversation(omp.id, 120), []);
  assert.equal(logs.length, 0);
  assert.equal(sessions.size, 1, 'OMP is never inserted into Claude store');
  assert.equal(ompStarts, 0, 'list/resolve must never start a driver');
  await registry.start();
  await registry.start();
  assert.equal(ompStarts, 1, 'only explicit, idempotent start can initialize a registered adapter');
});

test('registry rejects impersonation and duplicate adapter registrations', () => {
  const { adapter } = makeClaude();
  const registry = createAgentRegistry({ adapters: [adapter] });
  assert.throws(() => registry.register({ kind: 'claude', list: () => [] }), /already registered/);
  assert.equal(registry.register({ kind: 'unknown', list: () => [] }), false);
  const malicious = { sourceNamespace: 'fixture', sourceSessionId: 'true-id' };
  const real = projectOmpSession(malicious);
  registry.register({ kind: 'omp', list: () => [malicious], resolve: () => ({ ...malicious, sourceSessionId: 'different' }) });
  assert.equal(registry.resolve(real.id), null, 'adapter cannot resolve an id to different content');
});

test('dispose is bounded to registered adapters and leaves Claude storage unchanged', async () => {
  const { adapter, sessions } = makeClaude();
  let disposed = 0;
  const registry = createAgentRegistry({ adapters: [adapter, {
    kind: 'omp', list: () => [], resolve: () => null, dispose: () => { disposed++; }
  }] });
  await registry.dispose();
  assert.equal(disposed, 1);
  assert.equal(sessions.size, 1);
});

test('only explicit synthetic injection can produce an OMP record', () => {
  const { adapter } = makeClaude();
  const registry = createAgentRegistry({ adapters: [adapter] });
  assert.deepEqual(registry.list().map((s) => s.agentKind), ['claude']);
  const raw = { sourceNamespace: 'fixture', sourceSessionId: 'persisted' };
  assert.equal(registry.resolve(projectOmpSession(raw).id), null);
});

// Evaluate the existing declaration/callback boundaries with injected dependencies only.
// Never import server/index.mjs (startup), Three.js, a browser or private agent data.
const source = (file) => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const serverSource = source('server/index.mjs');
function loadUi(file, names, dependencies = {}) {
  const text = source(file).replace(/^import .*;\r?$/gm, '')
    .replace(/^export \{[^}]+\};\r?$/gm, '')
    .replace(/^export (?=(?:const|let|function|async function)\b)/gm, '');
  return vm.runInNewContext(text + '\n;({' + names.join(',') + '})', {
    tr: (key) => key,
    fetch: () => assert.fail('unexpected network'),
    setTimeout: () => assert.fail('unexpected timer'),
    setInterval: () => assert.fail('unexpected timer'),
    ...dependencies,
  }, { timeout: 1000 });
}
const ui = () => loadUi('src/office/people/workers.js',
  ['AGENT_NAME', 'agentOf', 'canSession', 'claudeQuotaAccount', 'claudeCost', 'contextPercent', 'isPersisted', 'unknownLabel']);

function productionProjection(sessions, overrides = {}) {
  const start = serverSource.indexOf('const pubSub =');
  const end = serverSource.indexOf('\nfunction gitOf(', start);
  assert.ok(start > 0 && end > start, 'projection boundary exists');
  return vm.runInNewContext(serverSource.slice(start, end) + '\n;({pub,legacyPub,agents})', {
    createAgentRegistry, createClaudeAdapter, projectClaudeSession, sessions, ompAdapter: null,
    readLog: async () => [], tilde: (v) => v, oneLine: (s) => s.replace(/\n/g, ' '),
    unwrapPaste: (s) => s, acctOf: (s) => s.acct || '', acctShown: (s) => s,
    gitOf: () => null, liveCtx: (s) => ({ ctx: s.usage.ctx, ctxMax: 100 }),
    ...overrides,
  }, { timeout: 1000 });
}

const privateSession = (extra = {}) => ({
  id: 'private-claude', sid: 'shared-sid', pid: 123, name: 'shop', cwd: '/synthetic/repo',
  link: null, desk: 0, status: 'rest', taskStart: 100, counts: { read: 1, edit: 2, cmd: 3 },
  subs: {}, createdAt: 200, last: null,
  usage: { ctx: 10, model: 'claude', cost: 1.2345, out: 50 }, ...extra,
});

test('actual Claude pub retains legacy fields for status, subagents, account and usage', () => {
  for (const status of ['work', 'wait', 'rest']) {
    const s = privateSession({ status, title: 'Fixture', lastPrompt: 'one\ntwo', acct: 'work',
      parked: { to: 'other', at: 77 }, last: { type: 'read', agent: 'child-0' },
      subs: { child: { id: 'child-0', type: 'Explore', startedAt: 10 } } });
    const { pub, agents } = productionProjection(new Map([['internal-key', s]]));
    const p = plain(pub(s));
    assert.equal(p.id, 'private-claude');
    assert.equal(p.status, status);
    assert.equal(p.lastPrompt, 'one two');
    assert.equal(p.acct, 'work');
    assert.deepEqual(p.moved, { to: 'other', at: 77 });
    assert.deepEqual(p.usage, { cost: 1.23, ctx: 10, ctxMax: 100, model: 'claude', out: 50 });
    assert.deepEqual(p.counts, { read: 1, edit: 2, cmd: 3 });
    assert.deepEqual(p.subs, [{ id: 'child-0', type: 'Explore', desc: '', last: null, startedAt: 10, endedAt: null, steps: 0 }]);
    assert.equal(p.last.agent, 'child-0', 'legacy event.agent is still a child ID');
    assert.equal(p.agentKind, 'claude');
    assert.deepEqual(plain(agents.list()), [p], 'snapshot and event projections agree');
  }
});

// Phase 03 intentionally changes the Phase 02 seam: files mode with an explicit config may now start the file-only
// adapter. Every other mode keeps the original guarantee: only OFFICE_OMP is read and nothing is activated.
function ompWiring(env, status = 'ready') {
  const start = serverSource.indexOf('const OMP_MODE =');
  const end = serverSource.indexOf('/* end OMP wiring */', start);
  assert.ok(start > 0 && end > start, 'OMP wiring boundary exists');
  const reads = [], created = [];
  const proxy = new Proxy({}, { get: (_, key) => { reads.push(key); return env[key]; } });
  const out = vm.runInNewContext(serverSource.slice(start, end) + '\n;({ ompAvailability, ompAdapter })', {
    resolveOmpMode, process: { env: proxy },
    createOmpAdapter: (options) => { created.push(options); return { status: () => ({ state: status, sources: [], pins: 0 }) }; },
    fsp: {}, path: { join: (...p) => p.join('/') }, DATA_DIR: 'data', broadcast() {}, agents: {},
  }, { timeout: 1000 });
  return { ...out, reads, created };
}

test('production mode and registration do not read config or activate an OMP adapter unless files mode is configured', () => {
  for (const requested of [undefined, 'off', 'hybrid', 'bad-mode']) {
    const w = ompWiring({ OFFICE_OMP: requested, OFFICE_OMP_CONFIG: '/must/not/be/read' });
    const availability = w.ompAvailability();
    assert.equal(availability.effectiveMode, 'off');
    assert.equal(availability.requestedMode, resolveOmpMode(requested));
    assert.deepEqual(w.reads, ['OFFICE_OMP'], 'must not inspect config/profile/token/roots');
    assert.equal(w.ompAdapter, null); assert.deepEqual(w.created, []);
    const { agents } = productionProjection(new Map([['internal', privateSession()]]));
    assert.deepEqual(agents.list().map((s) => s.agentKind), ['claude']);
    assert.deepEqual(agents.diagnostics(), []);
  }
  assert.equal(ompWiring({ OFFICE_OMP: 'hybrid' }).ompAvailability().reason, 'hybrid-not-implemented');
  const missing = ompWiring({ OFFICE_OMP: 'files' });
  assert.deepEqual([missing.ompAvailability().effectiveMode, missing.ompAvailability().reason, missing.ompAdapter], ['off', 'config-missing', null]);
  const on = ompWiring({ OFFICE_OMP: 'files', OFFICE_OMP_CONFIG: '/synthetic/omp.json' });
  assert.equal(on.created.length, 1); assert.equal(on.created[0].configFile, '/synthetic/omp.json');
  assert.deepEqual([on.ompAvailability().effectiveMode, on.ompAvailability().reason], ['files', 'files']);
  const bad = ompWiring({ OFFICE_OMP: 'files', OFFICE_OMP_CONFIG: '/synthetic/omp.json' }, 'config-invalid');
  assert.deepEqual([bad.ompAvailability().effectiveMode, bad.ompAvailability().reason], ['off', 'config-invalid']);
});

function routeFixture() {
  const s = privateSession(), sessions = new Map([['internal', s]]);
  const { agents } = productionProjection(sessions, { readLog: async (_, n, child) => [{ role: 'claude', text: 'fixture', n, child }] });
  const raw = { sourceNamespace: 'fixture-only', sourceSessionId: s.sid };
  const omp = projectOmpSession(raw);
  agents.register({ kind: 'omp', list: () => [raw], resolve: (id) => id === omp.id ? raw : null });
  return { s, sessions, agents, omp };
}

async function requestCallback(fixture, url, body, method = 'POST', extra = {}) {
  const start = serverSource.indexOf('const server = http.createServer(');
  const end = serverSource.indexOf('\n});', start);
  assert.ok(start > 0 && end > start, 'HTTP callback boundary exists');
  const callback = serverSource.slice(start + 'const server = http.createServer('.length, end + 2);
  const calls = { open: 0, move: 0, start: 0, log: 0 }, responses = [];
  const context = {
    URL, PAGE_FILES: new Set(), DEV: false,
    isLoopback: () => true, hostAllowed: () => true, sameOriginOf: () => true, authorized: () => true,
    readJson: async () => body, json: (_, status, payload) => responses.push({ status, payload }),
    isClaudeRequest, agents: fixture.agents, sessions: fixture.sessions,
    tr: (key) => key, knownDirs: ['/synthetic/repo'], os: { homedir: () => '/synthetic/home' },
    openWindow: async (s) => { calls.open++; assert.equal(s, fixture.s); return { ok: true, app: 'fixture' }; },
    moveSession: async (s) => { calls.move++; assert.equal(s, fixture.s); return { ok: true }; },
    tasks: { start: () => { calls.start++; return { ok: false, code: 'synthetic' }; } },
    slugOf: (s) => s, ACTION_LOG: 'synthetic-log', fsp: { appendFile: async () => { calls.log++; } },
    prefs: { get: () => false }, ...extra,
  };
  const handler = vm.runInNewContext('(' + callback + ')', context, { timeout: 1000 });
  handler({ url, method, headers: { 'content-type': 'application/json' }, socket: {} }, {});
  for (let i = 0; i < 20 && !responses.length; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(responses.length, 1, 'one response from the real handler, without server startup');
  return { ...responses[0], calls };
}

test('actual open/account routes deny foreign and unknown targets before side effects', async () => {
  const f = routeFixture();
  for (const route of ['/api/open', '/api/accounts/move']) {
    for (const body of [{ id: f.omp.id }, { id: f.s.id, agentKind: 'omp' }, { id: 'not-a-session' }, { id: f.s.id, agentKind: 'other' }]) {
      const r = await requestCallback(f, route, body);
      assert.equal(r.status, 403);
      assert.equal(r.payload.code, 'agentReadOnly');
      assert.deepEqual(r.calls, { open: 0, move: 0, start: 0, log: 0 });
    }
  }
  const opened = await requestCallback(f, '/api/open', { id: f.s.id });
  assert.equal(opened.status, 200);
  assert.equal(opened.calls.open, 1);
  const moved = await requestCallback(f, '/api/accounts/move', { id: f.s.id, to: 'fixture-account' });
  assert.equal(moved.status, 200);
  assert.equal(moved.calls.move, 1);
});

test('actual task route denies OMP IDs, provider forgery and directory fallback', async () => {
  const f = routeFixture();
  const bodies = [
    { sid: f.omp.id }, { id: f.omp.id, sid: f.s.sid },
    { sid: f.s.sid, agentKind: 'omp' }, { id: f.s.id, sid: 'wrong-session' },
  ];
  for (const b of bodies) {
    const r = await requestCallback(f, '/api/tasks', { ...b, dir: '/synthetic/repo', text: 'fixture' });
    assert.equal(r.status, 403);
    assert.equal(r.calls.start, 0);
  }
  const missing = await requestCallback(f, '/api/tasks', { sid: 'missing', dir: '/synthetic/repo', text: 'fixture' });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.code, 'noDir');
  assert.equal(missing.calls.start, 0);
});

test('actual log route resolves ownership, preserves Claude roles and denies OMP content', async () => {
  const f = routeFixture();
  const own = await requestCallback(f, '/api/log?id=' + f.s.id + '&agent=child-0', null, 'GET');
  assert.equal(own.status, 200);
  assert.deepEqual(plain(own.payload.items), [{ role: 'claude', text: 'fixture', n: 120, child: 'child-0' }]);
  const other = await requestCallback(f, '/api/log?id=' + f.omp.id, null, 'GET');
  assert.equal(other.status, 403);
  assert.deepEqual(plain(other.payload.items), []);
  const path = await requestCallback(f, '/api/log?id=/synthetic/outside.jsonl', null, 'GET');
  assert.equal(path.status, 404);
});

test('actual UI helpers keep legacy defaults and fail closed for explicit new records', () => {
  const h = ui();
  assert.equal(h.agentOf({}), 'claude');
  assert.equal(h.agentOf({ agentKind: 'omp', model: 'claude' }), 'omp');
  assert.equal(h.agentOf({ agentKind: 'not-supported' }), 'unknown');
  assert.equal(h.agentOf({ id: 'omp:foreign' }), 'unknown');
  assert.equal(h.canSession({ id: 'legacy' }, 'openWindow'), true);
  for (const s of [
    { agentKind: 'omp', capabilities: { openWindow: true } },
    { agentKind: 'unknown', capabilities: { openWindow: true } },
    { agentKind: 'claude' }, { capabilities: null },
    { id: 'omp:foreign', agentKind: 'claude', capabilities: { openWindow: true } },
  ]) assert.equal(h.canSession(s, 'openWindow'), false);
  assert.equal(h.claudeQuotaAccount({ agentKind: 'omp' }), null);
  assert.equal(h.claudeQuotaAccount({ id: 'omp:forged', agentKind: 'claude' }), null);
  assert.equal(h.claudeCost({ id: 'omp:forged', agentKind: 'claude', usage: { cost: 9 } }), null);
  assert.equal(h.claudeCost({ agentKind: 'omp', usage: { cost: 99 } }), null);
  assert.equal(h.claudeCost({ usage: { cost: 0 } }), 0);
  for (const usage of [null, { ctx: 0, ctxMax: 0 }, { ctx: NaN, ctxMax: 1 }, { ctx: -1, ctxMax: 10 }, { ctx: 1, ctxMax: Infinity }])
    assert.equal(h.contextPercent({ usage }), null);
  assert.equal(h.contextPercent({ usage: { ctx: 25, ctxMax: 100 } }), 25);
});

const node = (tag = 'div', className = '', text = '') => ({
  tag, className, textContent: text ?? '', children: [], dataset: {},
  style: { setProperty() {} }, setAttribute() {}, addEventListener() {},
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = [...children]; },
});

test('rail groups unknown and unsupported providers without inventing activity or time', () => {
  const h = ui();
  const rail = loadUi('src/office/ui/activity.js', ['railGroupOf', 'GROUPS', 'doingOf', 'metaTime'], {
    ...h,
    tr: (key) => key,
    sessions: new Map(), workers: new Map(),
    whereabouts: () => assert.fail('unknown status must not imply current whereabouts'),
    nowMs: () => assert.fail('unknown status must not imply an active duration'),
    fmtClock: () => assert.fail('unknown status must not format a work timer'),
  });
  const known = ['wait', 'work', 'rest'];
  for (const status of known) assert.equal(rail.railGroupOf({ status }), status);
  for (const status of ['unknown', 'disconnected', undefined, null]) {
    const s = { id: 'omp:test', name: 'OMP fixture', agentKind: 'omp', status, taskStart: 1, lastAt: 1 };
    assert.equal(rail.railGroupOf(s), 'unknown');
    assert.equal(rail.doingOf(s).text, 'drawer.unknownState');
    assert.equal(rail.metaTime(s), '', 'unknown state must not show fake session age');
  }
  assert.deepEqual(plain(rail.GROUPS.map(([status]) => status)), [...known, 'unknown']);
});

test('actual drawer/account guards do not call controls or read a foreign conversation', async () => {
  const h = ui(), s = { id: 'omp:synthetic', agentKind: 'omp', pid: 123,
    capabilities: { openWindow: true, readConversation: true, changeAccount: true } };
  const sessions = new Map([[s.id, s]]), elements = new Map();
  const deps = { ...h, sessions, state: { selectedId: s.id, isLocal: true },
    $: (id) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, el: node,
    toast: () => {}, acctActions: () => assert.fail('foreign account actions'),
  };
  const drawer = loadUi('src/office/ui/session-drawer.js', ['renderActions', 'openWindowOf', 'loadLog'], deps);
  drawer.renderActions();
  assert.equal(elements.get('ds-actions').children.length, 1);
  assert.equal(elements.get('ds-actions').children[0].tag, 'p');
  await drawer.openWindowOf(s);
  await drawer.loadLog();
  assert.equal(elements.get('ds-body').children[0].textContent, 'drawer.conversationDisabled');
  const accounts = loadUi('src/office/ui/session-account.js', ['acctActions', 'move'], deps);
  assert.equal(accounts.acctActions(s, () => {}).length, 0);
  await accounts.move(s, 'main', () => assert.fail('must not redraw/start moving'));
});

test('actual quota loop and accountant exclude forged OMP and inherited cost', () => {
  const h = ui();
  const sessions = new Map([
    ['c', { id: 'c', status: 'rest', usage: { cost: 2 } }],
    ['o', { id: 'o', agentKind: 'omp', status: 'rest', usage: { cost: 999 }, metrics: { cost: { value: 999, scope: 'inherited' } } }],
    ['u', { id: 'u', agentKind: 'other', status: 'rest', usage: { cost: 999 } }],
  ]);
  const workers = new Map([...sessions.keys()].map((id) => [id, { id, onBreak: id === 'u', root: { visible: true }, lateRest: () => false }]));
  const scheduled = [];
  const quota = loadUi('src/office/life/quota.js', ['updateQuota'], {
    ...h, sessions, workers, state: { sim: 0 }, replay: { on: false }, napOn: false,
    liveWindows: () => [{ pct: 100, resetsAt: Date.now() + 10000 }],
    free: () => true, asleep: () => false, later: (...args) => scheduled.push(args), rand: () => 1,
  });
  quota.updateQuota(0);
  assert.equal(workers.get('c').onBreak, true);
  assert.equal(workers.get('o').onBreak, false);
  assert.equal(workers.get('u').onBreak, false, 'clears a foreign worker incorrectly already on break');
  assert.equal(scheduled.length, 1);
  const accounting = loadUi('src/office/people/accountant.js', ['costs', 'spender'], { ...h, sessions, workers });
  assert.equal(accounting.costs().total, 2);
  assert.equal(accounting.spender(), null, 'Claude remains excluded while on a quota break');
  workers.get('c').onBreak = false; // Separate accounting scenario: the Claude worker is available again.
  assert.equal(accounting.spender().id, 'c');
});

test('optional adapter failure is diagnostic, bounded and leaves Claude projection available', async () => {
  const { adapter } = makeClaude();
  const registry = createAgentRegistry({ adapters: [adapter, {
    kind: 'omp', list: () => { throw new Error('PRIVATE_TEXT'); }, resolve: () => null,
    start: async () => { throw new Error('PRIVATE_TEXT'); }, dispose: async () => { throw new Error('PRIVATE_TEXT'); },
  }] });
  for (let i = 0; i < 100; i++) assert.equal(registry.list().length, 1);
  await registry.start();
  await registry.dispose();
  await registry.dispose();
  assert.equal(registry.list().length, 0);
  assert.ok(registry.diagnostics().length <= 3);
  assert.doesNotMatch(JSON.stringify(registry.diagnostics()), /PRIVATE_TEXT/);
});


const nodeText = (n) => typeof n === 'string' ? n : n.textContent + (n.children || []).map(nodeText).join(' ');

test('actual List Mode keeps unknown providers visible without NaN or fake active duration', () => {
  const h = ui(), box = node(), button = node('button');
  const sessions = new Map([
    ['c', { id: 'c', name: 'Claude fixture', status: 'rest', usage: { ctx: 5, ctxMax: 10 } }],
    ['o', { id: 'o', name: 'OMP fixture', agentKind: 'omp', status: 'unknown', taskStart: 1, usage: { ctx: 0, ctxMax: 0 } }],
  ]);
  const list = loadUi('src/office/ui/lite.js', ['setLite'], {
    ...h, sessions, el: node, $: (id) => id === 'lite' ? box : button, ompButton: () => ({ hidden: true }),
    document: { body: { classList: { toggle() {} } }, createDocumentFragment: () => node('fragment') },
    fp: { on: false }, closePlace() {}, colorOf: () => '#000', dn: (s) => s.name,
    doingOf: (s) => { assert.equal(s.id, 'c'); return { text: 'rest' }; },
    fmtClock: () => assert.fail('must not invent active duration for unknown'),
    nowMs: () => 1, short: (s) => s,
  });
  list.setLite(true);
  const text = nodeText(box);
  assert.match(text, /Claude fixture/);
  assert.match(text, /OMP fixture/);
  assert.match(text, /drawer.unknownState/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test('generic assistant role uses agent-neutral conversation labels while legacy Claude is retained', () => {
  const chat = loadUi('src/office/ui/session-drawer.js', ['buildChat'], {
    ...ui(), el: node, document: { createDocumentFragment: () => node('fragment') },
  });
  const messages = [{ role: 'user', text: 'Synthetic input' }, { role: 'assistant', text: 'Synthetic output' }];
  const generic = nodeText(chat.buildChat(messages, 'OMP'));
  assert.match(generic, /drawer.you/);
  assert.match(generic, /OMP/);
  assert.doesNotMatch(generic, /drawer.fromMain|Claude/);
  const legacy = nodeText(chat.buildChat([{ role: 'claude', text: 'Legacy output' }]));
  assert.match(legacy, /Claude/);
});


// Small DOM double for the actual rail renderer: no browser, Three.js or application startup.
function railDom(tag = 'div', className = '', text = '') {
  const n = {
    tag, className, textContent: text ?? '', children: [], dataset: {}, attributes: {}, listeners: {},
    _hidden: false, get hidden() { return this._hidden; }, set hidden(value) { this._hidden = !!value; },
    parentNode: null, style: { setProperty() {} },
    classList: { toggle() {} },
    get firstChild() { return this.children[0]; },
    setAttribute(key, value) { this.attributes[key] = value; if (key === 'class') this.className = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    append(...children) {
      for (const child of children) {
        if (typeof child === 'object') { child.remove(); child.parentNode = this; }
        this.children.push(child);
      }
    },
    prepend(...children) {
      for (const child of children) if (typeof child === 'object') { child.remove(); child.parentNode = this; }
      this.children.unshift(...children);
    },
    replaceChildren(...children) {
      for (const child of this.children) if (typeof child === 'object') child.parentNode = null;
      this.children = []; this.append(...children);
    },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((v) => v !== this);
      this.parentNode = null;
    },
    after(child) {
      const parent = this.parentNode; if (!parent) return;
      child.remove(); child.parentNode = parent;
      parent.children.splice(parent.children.indexOf(this) + 1, 0, child);
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (typeof child !== 'object') continue;
        if (selector[0] === '.' && child.className.split(' ').includes(selector.slice(1))) return child;
        const nested = child.querySelector(selector); if (nested) return nested;
      }
      return null;
    },
  };
  return n;
}
function railFixture(records) {
  const elements = new Map(), sessions = new Map(records.map((s) => [s.id, s])), workers = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, railDom()); return elements.get(id); };
  const filters = ['wait', 'work', 'rest'].map((status) => { const n = railDom(); n.dataset.st = status; return n; });
  const timers = [], state = { connectedOnce: true }, h = ui();
  const rail = loadUi('src/office/ui/activity.js', ['setup', 'renderRail', 'renderHud', 'railRows', 'onListClick'], {
    ...h, sessions, workers, state, el: railDom, $: element,
    document: { createElementNS: (_, tag) => railDom(tag), querySelector: element, querySelectorAll: () => filters },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    STATUS_LABEL: { wait: 'waiting', work: 'working', rest: 'resting' },
    icon: () => railDom('svg'), agentMark: (kind) => { const n = railDom('svg'); n.dataset.agent = kind; return n; },
    colorOf: () => '#000', dn: (s) => s.name, whereabouts: () => null, nowMs: () => 1000000,
    fmtClock: (seconds) => 'clock:' + seconds, fmtBytes: (bytes) => String(bytes),
    macSnap: { claude: [{ pid: 123, mem: 1024 }] }, unseenDone: new Set(), num: String,
  });
  rail.setup();
  return { ...rail, sessions, state, elements, element, timers, filters };
}
const railSession = (id, status, extra = {}) => ({ id, name: id, status, desk: 0,
  dir: '', subs: [], usage: null, taskStart: 1, lastAt: 1, ...extra });

test('actual rail attaches unknown rows, preserves nodes across transitions and cleans removed sessions', () => {
  const f = railFixture([
    railSession('c', 'rest'), railSession('omp:a', 'unknown', { agentKind: 'omp' }),
    railSession('agent:b', 'disconnected', { agentKind: 'future-agent' }),
  ]);
  f.renderRail();
  const a = f.railRows.get('omp:a'), b = f.railRows.get('agent:b'), rail = f.element('rail-list');
  assert.equal(a.li.parentNode, rail);
  assert.equal(b.li.parentNode, rail, 'unsupported states are attached, not silently discarded');
  assert.equal(a.b.dataset.status, 'unknown');
  assert.equal(b.b.dataset.status, 'unknown');
  assert.equal(a.time.textContent, '');
  assert.equal(a.cs.textContent, 'drawer.unknownState');
  assert.equal(b.dTxt.textContent, 'drawer.unknownState');
  const unknown = rail.children.find((n) => n.dataset?.g === 'unknown');
  assert.equal(unknown.hidden, false);
  assert.equal(unknown.children[0].children[1].textContent, 2);
  assert.equal(f.sessions.get('agent:b').status, 'disconnected', 'projection never mutates source status');
  f.onListClick({ target: { closest: (selector) => selector === '.grp-btn' ? { dataset: { g: 'rest' } } : null } });
  assert.equal(f.railRows.get('c').li.hidden, true, 'rest fold remains intact');
  assert.equal(a.li.hidden, false, 'unknown does not get folded into resting');
  f.element('.st-row').listeners.click({ target: { closest: () => f.filters[1] } });
  assert.equal(a.li.hidden, true, 'working filter excludes unknown');
  f.element('.st-row').listeners.click({ target: { closest: () => f.filters[1] } });
  assert.equal(a.li.hidden, false, 'clearing filter restores unknown');
  f.element('sess-search').listeners.input({ target: { value: 'agent:b' } });
  assert.equal(a.li.hidden, true); assert.equal(b.li.hidden, false);
  f.element('sess-search').listeners.input({ target: { value: '' } });
  f.sessions.set('omp:a', { ...f.sessions.get('omp:a'), status: 'work' });
  f.renderRail();
  assert.equal(f.railRows.get('omp:a'), a, 'same node retains focus/identity');
  assert.equal(a.b.dataset.status, 'work');
  f.sessions.set('omp:a', { ...f.sessions.get('omp:a'), status: 'unknown' });
  f.renderRail(); f.timers[0]();
  assert.equal(a.time.textContent, '', 'live timer also clears stale duration');
  f.sessions.delete('omp:a'); f.sessions.delete('agent:b'); f.renderRail();
  assert.equal(a.li.parentNode, null); assert.equal(a.c.parentNode, null);
  assert.equal(unknown.hidden, true); assert.equal(f.railRows.size, 1);
});

test('actual rail and HUD keep foreign metrics, PID and Remote Control isolated from Claude', () => {
  const f = railFixture([
    railSession('c', 'work', { pid: 123, link: 'https://synthetic.invalid/rc', usage: { ctx: 25, ctxMax: 100, cost: 2 } }),
    railSession('omp:a', 'unknown', { agentKind: 'omp', pid: 123, link: 'https://synthetic.invalid/rc',
      capabilities: { remoteControl: true }, usage: { ctx: 0, ctxMax: 0, cost: 999 } }),
    railSession('agent:b', 'unsupported', { agentKind: 'future-agent', usage: { ctx: NaN, ctxMax: 1, cost: Infinity } }),
  ]);
  f.renderRail(); f.renderHud();
  const c = f.railRows.get('c'), o = f.railRows.get('omp:a'), b = f.railRows.get('agent:b');
  assert.equal(c.ctx.hidden, false); assert.equal(c.ctxB.style.width, '25%');
  assert.equal(c.ram.textContent, '1024'); assert.ok(c.top.querySelector('.ri-rc'));
  assert.equal(o.ctx.hidden, true); assert.equal(b.ctx.hidden, true);
  assert.equal(o.ram.textContent, ''); assert.equal(o.top.querySelector('.ri-rc'), null);
  assert.equal(o.ctxB.style.width, '0%'); assert.equal(b.ctxB.style.width, '0%');
  const hud = nodeText(f.element('feed-stats'));
  assert.match(hud, /\$2\.00/);
  assert.doesNotMatch(hud, /999|NaN|Infinity/);
});

// Persisted OMP routes: this computer only, public ids only, and no path ever reaches the adapter.
function ompRouteFixture(conversation) {
  const claude = privateSession(), sessions = new Map([['internal', claude]]), calls = { catalog: [], pin: [], refresh: 0, read: 0 };
  const f = { s: claude, sessions, agents: productionProjection(sessions).agents };
  const raw = { sourceNamespace: 'persisted-fixture', sourceSessionId: 'p1', persistedOnly: true, conversation };
  const persisted = projectOmpSession(raw);
  f.agents.register({ kind: 'omp', list: () => [raw], resolve: (id) => id === persisted.id ? raw : null, readConversation: async () => { calls.read++; return [{ role: 'user', text: 'fixture', ts: 1 }]; } });
  const ompAdapter = { catalog: (o) => { calls.catalog.push(o); return { items: [], sources: [], next: null }; },
    pin: async (id, on) => { calls.pin.push([id, on]); return /^omp:[0-9a-f]{64}$/.test(id) ? { ok: true, pinned: on } : { ok: false, code: 'invalid-id' }; },
    refresh: async () => { calls.refresh++; } };
  return { ...f, persisted, calls, extra: (loopback, mode = 'files') => ({ ompAdapter, ompAvailability: () => ({ effectiveMode: mode }), isLoopback: () => loopback }) };
}

test('actual OMP catalogue and pin routes are local-only, off-aware and id-only', async () => {
  const f = ompRouteFixture(false);
  const remote = await requestCallback(f, '/api/omp/catalog', null, 'GET', f.extra(false));
  assert.equal(remote.status, 403); assert.equal(remote.payload.code, 'agentLocalOnly'); assert.deepEqual(f.calls.catalog, []);
  const off = await requestCallback(f, '/api/omp/catalog', null, 'GET', f.extra(true, 'off'));
  assert.equal(off.status, 404); assert.deepEqual(f.calls.catalog, []);
  const local = await requestCallback(f, '/api/omp/catalog?limit=9&cursor=3', null, 'GET', f.extra(true));
  assert.equal(local.status, 200); assert.deepEqual(plain(f.calls.catalog), [{ cursor: '3', limit: '9', kind: 'all' }]);

  const foreignPin = await requestCallback(f, '/api/omp/pin', { id: f.persisted.id }, 'POST', f.extra(false));
  assert.equal(foreignPin.status, 403); assert.deepEqual(f.calls.pin, []);
  const noSameOrigin = await requestCallback(f, '/api/omp/pin', { id: f.persisted.id }, 'POST', { ...f.extra(true), sameOriginOf: () => false });
  assert.equal(noSameOrigin.status, 403); assert.deepEqual(f.calls.pin, []);
  const path = await requestCallback(f, '/api/omp/pin', { id: '/etc/passwd', on: true }, 'POST', f.extra(true));
  assert.equal(path.status, 400); assert.equal(path.payload.code, 'invalid-id'); assert.equal(path.calls.log, 0);
  const ok = await requestCallback(f, '/api/omp/pin', { id: f.persisted.id, on: false }, 'POST', f.extra(true));
  assert.equal(ok.status, 200); assert.deepEqual(plain(f.calls.pin.at(-1)), [f.persisted.id, false]); assert.equal(ok.calls.log, 1); assert.equal(f.calls.refresh, 1);
  assert.equal((await requestCallback(f, '/api/omp/pin', { id: f.persisted.id }, 'POST', f.extra(true, 'off'))).status, 404);
});

test('actual log route reads persisted OMP text only for this computer and only when the source allows it', async () => {
  const allowed = ompRouteFixture(true), denied = ompRouteFixture(false);
  assert.equal(allowed.persisted.capabilities.readConversation, true);
  const remote = await requestCallback(allowed, '/api/log?id=' + encodeURIComponent(allowed.persisted.id), null, 'GET', allowed.extra(false));
  assert.equal(remote.status, 403); assert.equal(remote.payload.code, 'agentLocalOnly'); assert.equal(allowed.calls.read, 0);
  const local = await requestCallback(allowed, '/api/log?id=' + encodeURIComponent(allowed.persisted.id), null, 'GET', allowed.extra(true));
  assert.equal(local.status, 200); assert.equal(local.payload.items.length, 1);
  const off = await requestCallback(denied, '/api/log?id=' + encodeURIComponent(denied.persisted.id), null, 'GET', denied.extra(true));
  assert.equal(off.status, 403); assert.equal(off.payload.code, 'agentReadOnly'); assert.equal(denied.calls.read, 0);
});

test('a pinned saved session is shown to this computer only: not streamed to remote pages, not polled, not recorded', () => {
  const start = serverSource.indexOf('const clients = new Set();');
  const end = serverSource.indexOf('/* ---------- replay log', start);
  assert.ok(start > 0 && end > start, 'SSE boundary exists');
  const recorded = [], writes = { local: [], remote: [] };
  const out = vm.runInNewContext(serverSource.slice(start, end) + '\n;({ clients, backlog, broadcast })', {
    RECORDED: new Set(['sess', 'gone']), record: (m) => recorded.push(m.k),
  }, { timeout: 1000 });
  out.clients.add({ local: true, res: { write: (d) => writes.local.push(d) } });
  out.clients.add({ local: false, res: { write: (d) => writes.remote.push(d) } });
  out.broadcast({ k: 'sess', s: { id: 'omp:pinned' } }, true);
  out.broadcast({ k: 'gone', id: 'omp:pinned' }, true);
  assert.equal(writes.local.length, 2); assert.deepEqual(writes.remote, []);
  assert.deepEqual(recorded, [], 'local-only messages never reach the replay log');
  assert.deepEqual(plain(out.backlog.map(([, , only]) => only)), [true, true], 'the poll route can tell them apart');
  out.broadcast({ k: 'sess', s: { id: 'claude' } });
  assert.equal(writes.local.length, 3); assert.equal(writes.remote.length, 1);
  assert.deepEqual(recorded, ['sess'], 'ordinary messages are still recorded and sent to everyone');
  // the polling and snapshot paths use the same flag
  assert.match(serverSource, /backlog\.filter\(\(\[n, , only\]\) => n > since && \(local \|\| !only\)\)/);
  assert.match(serverSource, /sessions: local \? agents\.list\(\) : agents\.list\(\)\.filter\(\(s\) => !s\.persistedOnly\)/);
  assert.match(serverSource, /sessions: agents\.list\(\)\.filter\(\(s\) => !s\.persistedOnly\), feed: feed\.slice\(-40\)/);
});
