import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createOmpRpcHost, childEnvironment } from '../../server/agents/omp/rpc-host.mjs';

const fixture = path.resolve('tests/fixtures/omp/fake-rpc-host.mjs');
const host = (scenario = 'ok', options = {}) => createOmpRpcHost({
  binary: process.execPath, args: [fixture, scenario], cwd: process.cwd(), timeoutMs: 1000, ...options,
});

// Các deadline dùng clock điều khiển; thời gian Windows tạo process không phải RPC timeout.
function controlledChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.signalCode = 'SIGTERM';
    child.emit('exit', null, 'SIGTERM');
  };
  return child;
}

test('isolated native-like child: ready v1, correlated requests, new session, clean EOF', async () => {
  const rpc = host();
  try {
    await rpc.start();
    assert.equal(rpc.isReady(), true);
    assert.deepEqual(await rpc.request('new_session'), { cancelled: false });
    const state = await rpc.request('get_state');
    assert.equal(state.sessionId, '00000000-0000-4000-8000-000000000005');
    assert.equal(state.messageCount, 0);
    assert.deepEqual(await rpc.request('get_session_lease', { sessionIds: [state.sessionId] }), { held: [], unknown: [] });
    await assert.rejects(rpc.request('prompt'), /RPC_UNAVAILABLE/);
  } finally { await rpc.close(); }
  assert.equal(rpc.isReady(), false);
});

test('no credentials or inherited shell hooks passed to child', () => {
  const env = childEnvironment({ SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32',
    ANTHROPIC_API_KEY: 'SHOULD_NOT_PASS', OMP_TOKEN: 'SHOULD_NOT_PASS', NODE_OPTIONS: '--require malicious' });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OMP_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.OMP_SKIP_SETUP, '1');
});

test('RPC denies unapproved methods and bad get_session_lease args', async () => {
  const rpc = host();
  try {
    await rpc.start();
    await assert.rejects(rpc.request('steer'), { code: 'RPC_UNAVAILABLE' });
    await assert.rejects(rpc.request('get_session_lease', { sessionIds: ['a', 'b'] }), { code: 'RPC_INVALID' });
  } finally { await rpc.close(); }
});

for (const scenario of ['bad-ready', 'silent']) test('RPC fail-closed on ' + scenario, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = controlledChild();
  const rpc = host(scenario, { timeoutMs: 200, spawnImpl: () => child });
  try {
    const rejected = assert.rejects(rpc.start(), { code: scenario === 'silent' ? 'RPC_START_TIMEOUT' : 'RPC_VERSION' });
    if (scenario === 'bad-ready') child.stdout.write(Buffer.from('{"type":"ready","protocolVersion":99}\n'));
    else t.mock.timers.tick(200);
    await rejected;
    assert.equal(child.signalCode, 'SIGTERM');
    assert.equal(rpc.isReady(), false);
  } finally { await rpc.close(); }
});

test('RPC closes on oversized JSONL stdout and never dispatches another command', async () => {
  const rpc = host('huge');
  try {
    await rpc.start();
    await assert.rejects(rpc.request('get_state'), /RPC_FRAME_LIMIT/);
    assert.equal(rpc.isReady(), false);
  } finally { await rpc.close(); }
});

test('RPC request timeout closes owned process', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = controlledChild();
  const rpc = host('hang', { timeoutMs: 200, spawnImpl: () => child });
  try {
    const started = rpc.start();
    child.stdout.write(Buffer.from('{"type":"ready","protocolVersion":1}\n'));
    await started;
    const rejected = assert.rejects(rpc.request('get_state'), { code: 'RPC_TIMEOUT' });
    t.mock.timers.tick(199);
    assert.equal(rpc.isReady(), true);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(rpc.isReady(), false);
    assert.equal(child.signalCode, 'SIGTERM');
    await assert.rejects(rpc.request('get_state'), { code: 'RPC_UNAVAILABLE' });
  } finally { await rpc.close(); }
});

test('exclusive Resume rejects a stock ready frame even when base RPC protocol is valid', async () => {
  const child = controlledChild();
  const rpc = host('ok', { requiredOwnershipProtocol: 1, spawnImpl: () => child });
  try {
    const rejected = assert.rejects(rpc.start(), { code: 'RPC_OWNERSHIP_PROTOCOL' });
    child.stdout.write(Buffer.from('{"type":"ready","protocolVersion":1}\n'));
    await rejected;
    assert.equal(rpc.isReady(), false);
    assert.equal(child.signalCode, 'SIGTERM');
    await assert.rejects(rpc.request('get_state'), { code: 'RPC_UNAVAILABLE' });
  } finally { await rpc.close(); }
});
