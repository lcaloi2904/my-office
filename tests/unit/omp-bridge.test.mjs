import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createOmpBridge, loadIngestTokens } from '../../server/agents/omp/bridge.mjs';
import { createOmpLifecycle } from '../../server/agents/omp/lifecycle.mjs';
import { ompSessionIdentity } from '../../server/agents/schema.mjs';

const TOKEN_A = 'a'.repeat(64), TOKEN_B = 'b'.repeat(64);
const ev = (type, sequence, data = {}, extra = {}) => ({ version: 1, sourceId: 'src-a', sessionId: 's1',
  runtimeInstanceId: 'rt', generation: 1, sequence, type, data, ...extra });
function make(limits = {}) {
  const clock = { t: 1_000_000 };
  const life = createOmpLifecycle({ now: () => clock.t });
  const bridge = createOmpBridge({ lifecycle: life, tokens: new Map([['src-a', TOKEN_A], ['src-b', TOKEN_B]]), now: () => clock.t, limits });
  const post = (body, { token = TOKEN_A, headers = {}, loopback = true, viaTunnel = false, method = 'POST', stream } = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return bridge.handle({ method, loopback, viaTunnel, body: stream || Readable.from([Buffer.from(text)]),
      headers: { authorization: token ? 'Bearer ' + token : undefined, 'content-type': 'application/json', ...headers } });
  };
  return { life, bridge, post, clock };
}

test('S1: missing, wrong or another source\'s token is refused before any mutation', async () => {
  const { life, post } = make();
  const noAuth = await post(ev('session_start', 1), { token: null });
  assert.equal(noAuth.status, 401);
  assert.equal((await post(ev('session_start', 1), { token: 'c'.repeat(64) })).status, 401);
  assert.equal((await post(ev('session_start', 1), { headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await post(ev('session_start', 1), { headers: { authorization: 'Bearer short' } })).status, 401);
  // a valid token of source B cannot declare a session of namespace A
  const forged = await post(ev('session_start', 1), { token: TOKEN_B });
  assert.equal(forged.body.results[0].code, 'source-mismatch');
  assert.equal(life.ids().length, 0);
  assert.ok(!JSON.stringify([noAuth.body, forged.body]).includes(TOKEN_A));
});

test('S1: a browser Origin, a tunnel, a non-loopback peer and a wrong method never reach the lifecycle', async () => {
  const { life, post } = make();
  assert.equal((await post(ev('session_start', 1), { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await post(ev('session_start', 1), { headers: { origin: 'null' } })).status, 403);
  assert.equal((await post(ev('session_start', 1), { viaTunnel: true })).status, 403);
  assert.equal((await post(ev('session_start', 1), { loopback: false })).status, 403);
  assert.equal((await post(ev('session_start', 1), { method: 'GET' })).status, 405);
  assert.equal((await post(ev('session_start', 1), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal(life.ids().length, 0);
});

test('S1: the phone token, a URL query and a cookie are not credentials here', async () => {
  const { post } = make();
  const r = await post(ev('session_start', 1), { token: null, headers: { cookie: 'office=1', authorization: undefined, 'x-office-token': TOKEN_A } });
  assert.equal(r.status, 401);
});

test('S2: oversize, malformed, deep, batch-bound and slow bodies are bounded', async () => {
  const { life, post, bridge } = make({ maxBodyBytes: 2048, maxEvents: 4 });
  assert.equal((await post(ev('session_start', 1), { headers: { 'content-length': '999999' } })).status, 413);
  assert.equal((await post('x'.repeat(5000))).status, 413);   // streamed past the cap with no honest Content-Length
  assert.equal((await post('{"nope"')).status, 400);
  assert.equal((await post('[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[')).status, 400);
  assert.equal((await post({ events: [] })).status, 400);
  assert.equal((await post({ events: Array.from({ length: 5 }, (_, i) => ev('session_start', i + 1)) })).status, 400);
  const stalled = new Readable({ read() { /* never delivers */ } });
  const fast = createOmpBridge({ lifecycle: life, tokens: new Map([['src-a', TOKEN_A]]), limits: { bodyTimeoutMs: 20 } });
  const slow = await fast.handle({ method: 'POST', loopback: true, body: stalled, headers: { authorization: 'Bearer ' + TOKEN_A, 'content-type': 'application/json' } });
  assert.equal(slow.status, 408); stalled.destroy();
  assert.equal(life.ids().length, 0);
  assert.ok(bridge.status().rejected >= 5);
});

test('S2: a request flood is rate limited per source and recovers with time', async () => {
  const { post, clock } = make({ burst: 3, perSecond: 1 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post(ev('session_start', i + 1))).status);
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
  assert.deepEqual(codes.slice(3), [429, 429]);
  const other = await post(ev('session_start', 1, {}, { sourceId: 'src-b' }), { token: TOKEN_B });
  assert.equal(other.status, 200, 'another source has its own bucket');
  clock.t += 2000;
  assert.equal((await post(ev('heartbeat', 6))).status, 200);
});

test('R7: a batch is applied in order, acked per event, and replays are idempotent', async () => {
  const { life, post } = make();
  const id = ompSessionIdentity('src-a', 's1').id;
  const batch = { events: [ev('session_start', 1, { isIdle: false }), ev('tool_start', 2, { toolCallId: 't', category: 'cmd' }), ev('tool_start', 2, { toolCallId: 't' })] };
  const r = await post(batch);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x) => x.ack), [1, 2, 2]);
  assert.equal(r.body.results[2].duplicate, true);
  assert.equal(life.resolve(id).pendingTools, 1);
  const again = await post(batch);
  assert.equal(again.body.results[1].duplicate, true);
  assert.equal(life.resolve(id).pendingTools, 1, 'a retried batch never doubles a tool');
});

test('R6: an unknown session asks for a snapshot instead of being guessed at', async () => {
  const { post } = make();
  const r = await post(ev('heartbeat', 9));
  assert.equal(r.status, 200); assert.equal(r.body.resync, true); assert.equal(r.body.results[0].code, 'snapshot-required');
  assert.equal((await post(ev('session_start', 9, { isIdle: true }))).body.ok, true);
});

test('S6: control-looking events and unknown fields cannot do anything; replies carry no command', async () => {
  const { life, post } = make();
  await post(ev('session_start', 1, { isIdle: false }));
  const r = await post({ events: [ev('approve', 2, { requestId: 'x' }), ev('kill', 3), ev('task', 4, { prompt: 'rm -rf /' })] });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.results.map((x) => x.code), ['invalid-event', 'invalid-event', 'invalid-event']);
  assert.deepEqual(Object.keys(r.body).sort(), ['ok', 'results', 'resync']);
  const resolved = await post(ev('approval_resolved', 2, { requestId: 'x', approve: true, command: 'x', path: '/etc/passwd' }));
  assert.equal(resolved.status, 200);
  assert.ok(!JSON.stringify(resolved.body).includes('passwd'));
  assert.equal(life.ids().length, 1);
});

test('S3/S4: no producer path or text reaches the lifecycle snapshot', async () => {
  const { life, post } = make();
  await post(ev('session_start', 1, { isIdle: false, cwd: '/home/u/secret', title: 'password=hunter2', model: 'bad model; rm -rf', usage: { input: 3 } }, {}));
  const text = JSON.stringify(life.list());
  for (const leak of ['/home/u', 'hunter2', 'rm -rf']) assert.ok(!text.includes(leak), leak);
  assert.equal(life.list()[0].model, null);
});

test('S8: disposed bridge refuses; tokens are created privately, stable and only for configured sources', async () => {
  const files = new Map(), calls = [];
  const io = { readFile: async (f) => { if (!files.has(f)) throw Object.assign(new Error('no'), { code: 'ENOENT' }); return files.get(f); },
    mkdir: async () => {}, writeFile: async (f, d, o) => { calls.push(o); files.set(f, d); }, rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); } };
  let n = 0;
  const random = () => String(++n).padStart(64, '0');
  const first = await loadIngestTokens({ file: '/data/t.json', sourceIds: ['a', 'b'], io, random });
  assert.equal(first.get('a'), '0'.repeat(63) + '1');
  assert.equal(calls[0].mode, 0o600);
  const again = await loadIngestTokens({ file: '/data/t.json', sourceIds: ['a', 'b'], io, random });
  assert.equal(again.get('b'), first.get('b')); assert.equal(calls.length, 1, 'nothing is rewritten when nothing is missing');
  const more = await loadIngestTokens({ file: '/data/t.json', sourceIds: ['a', 'c'], io, random });
  assert.equal(more.get('a'), first.get('a')); assert.ok(more.get('c'));
  files.set('/data/t.json', '{"version":1,"tokens":{"a":"not-a-token"}}');
  assert.notEqual((await loadIngestTokens({ file: '/data/t.json', sourceIds: ['a'], io, random })).get('a'), 'not-a-token');

  const { bridge, post } = make();
  bridge.dispose();
  assert.equal((await post(ev('session_start', 1))).status, 404);
});
