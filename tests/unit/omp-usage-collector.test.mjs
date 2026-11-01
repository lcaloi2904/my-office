import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildSafeUsageArgv, createOmpUsageCollector } from '../../server/agents/omp/usage-collector.mjs';

const NOW = 1_762_000_000_000;

function makeFakeProcess({ stdout = '', stderr = '', exitCode = 0, delayMs = 0, error = null, chunkSize = 0 } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  const run = () => {
    if (proc.killed) return;
    if (error) {
      proc.emit('error', error);
      return;
    }
    if (stdout) {
      const buf = Buffer.from(stdout, 'utf8');
      if (chunkSize > 0) {
        for (let i = 0; i < buf.length && !proc.killed; i += chunkSize) {
          proc.stdout.emit('data', buf.subarray(i, i + chunkSize));
        }
      } else {
        proc.stdout.emit('data', buf);
      }
    }
    if (stderr && !proc.killed) {
      proc.stderr.emit('data', Buffer.from(stderr, 'utf8'));
    }
    if (!proc.killed) {
      proc.emit('close', exitCode);
    }
  };
  if (delayMs > 0) setTimeout(run, delayMs).unref?.();
  else queueMicrotask(run);
  return proc;
}

const samplePayload = (accountsCount = 1, fetchedAt = NOW) =>
  JSON.stringify({
    generatedAt: fetchedAt,
    reports: Array.from({ length: accountsCount }, (_, i) => ({
      provider: i % 2 === 0 ? 'openai-codex' : 'google-antigravity',
      fetchedAt,
      limits: [
        {
          id: i % 2 === 0 ? 'openai-codex:primary' : 'google-antigravity:google:default:gemini-5h',
          label: '5 hours',
          scope: { provider: i % 2 === 0 ? 'openai-codex' : 'google-antigravity', windowId: '5h' },
          window: { id: '5h', label: '5 hours', durationMs: 18_000_000, resetsAt: fetchedAt + 7_200_000 },
          amount: { unit: 'percent', usedFraction: 0.25, remainingFraction: 0.75, used: 25, remaining: 75, limit: 100 },
          status: 'ok',
        },
      ],
      metadata: {
        email: `user${i + 1}@example.test`,
        accountId: `acct-${i + 1}`,
      },
    })),
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
  });

test('S1 & S6: feature OFF by default spawns nothing, sets no timers, and buildSafeUsageArgv forbids reset/invalidate/login', async () => {
  let spawns = 0;
  let timers = 0;
  const collector = createOmpUsageCollector({
    enabled: false,
    spawnImpl: () => {
      spawns++;
      return makeFakeProcess();
    },
    setTimer: () => {
      timers++;
      return 1;
    },
  });

  collector.setWatching(true);
  const snap = await collector.refresh({ force: true });
  assert.equal(spawns, 0, 'must never spawn when OFF');
  assert.equal(timers, 0, 'must never arm timers when OFF');
  assert.equal(snap.enabled, false);
  assert.equal(snap.state, 'disabled');
  assert.deepEqual(snap.accounts, []);

  assert.deepEqual(buildSafeUsageArgv(null), ['usage', '--json', '--no-extensions']);
  assert.deepEqual(buildSafeUsageArgv('work'), ['--profile', 'work', 'usage', '--json', '--no-extensions']);
  for (const forbidden of ['reset', 'invalidate', 'login', 'logout', 'auth', 'config']) {
    assert.throws(() => buildSafeUsageArgv(forbidden), /Forbidden OMP argument/);
  }
});

test('S2: invalid profile or cross-OS executable mismatch fails closed without spawning', async () => {
  let spawns = 0;
  const badProfile = createOmpUsageCollector({
    enabled: true,
    profile: '../bad-profile',
    spawnImpl: () => {
      spawns++;
      return makeFakeProcess();
    },
  });
  const snap1 = await badProfile.refresh({ force: true });
  assert.equal(spawns, 0);
  assert.equal(snap1.state, 'config-invalid');
  assert.equal(snap1.collector.noteCode, 'invalid-profile');

  const wslMismatch = createOmpUsageCollector({
    enabled: true,
    platform: 'win32',
    executable: '/usr/local/bin/omp',
    spawnImpl: () => {
      spawns++;
      return makeFakeProcess();
    },
  });
  const snap2 = await wslMismatch.refresh({ force: true });
  assert.equal(spawns, 0);
  assert.equal(snap2.state, 'config-invalid');
  assert.equal(snap2.collector.noteCode, 'profile-mismatch');
});

test('S4 & S8: single-flight coalescing, cache TTL, 429 rate-limit backoff, stale retention, and stale expiry', async () => {
  let currentNow = NOW;
  const calls = [];
  let nextResponse = () => ({ stdout: samplePayload(2, currentNow), exitCode: 0 });

  const collector = createOmpUsageCollector({
    enabled: true,
    executable: 'C:\\Users\\Test\\AppData\\Local\\omp\\omp.exe',
    platform: 'win32',
    profile: 'work',
    now: () => currentNow,
    random: () => 0.5, // jitter = 0.75 + 0.25 = 1.0
    keySecret: 'unit-test-secret',
    limits: {
      cacheTtlMs: 60_000,
      staleTtlMs: 300_000,
      baseBackoffMs: 10_000,
      rateLimitBackoffMs: 120_000,
      maxBackoffMs: 300_000,
    },
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, shell: opts.shell });
      return makeFakeProcess(nextResponse());
    },
  });

  // 1. Concurrent refreshes coalesce into 1 child process with shell:false and exact argv
  const [r1, r2, r3] = await Promise.all([collector.refresh(), collector.refresh(), collector.refresh()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shell, false);
  assert.deepEqual(calls[0].args, ['--profile', 'work', 'usage', '--json', '--no-extensions']);
  assert.equal(r1.state, 'ready');
  assert.equal(r1.accounts.length, 2);
  assert.equal(r2.accounts.length, 2);
  assert.equal(r3.accounts.length, 2);

  // 2. Within cacheTtlMs, unforced refresh uses cached snapshot without spawning
  currentNow += 30_000;
  await collector.refresh();
  assert.equal(calls.length, 1);

  // 3. After cacheTtlMs, 429 failure transitions accounts to 'stale', records 'rate-limited', and backs off for 120s
  currentNow += 35_000;
  nextResponse = () => ({ stdout: '', stderr: 'Error: 429 Too Many Requests from usage endpoint', exitCode: 1 });
  const staleSnap = await collector.refresh();
  assert.equal(calls.length, 2);
  assert.equal(staleSnap.state, 'stale');
  assert.equal(staleSnap.collector.noteCode, 'rate-limited');
  assert.equal(staleSnap.accounts.length, 2);
  assert.ok(staleSnap.accounts.every((a) => a.availability === 'stale'));
  assert.equal(JSON.stringify(staleSnap).includes('Too Many Requests'), false, 'raw stderr must never leak');

  // 4. During 120s rate-limit backoff, even force=true does not storm the CLI
  currentNow += 60_000;
  await collector.refresh({ force: true });
  assert.equal(calls.length, 2, 'must respect rate-limit backoff window');

  // 5. Past staleTtlMs (300s since lastSuccessAt), stale accounts expire and disappear rather than living forever
  currentNow = NOW + 350_000;
  const expiredSnap = collector.snapshot();
  assert.equal(expiredSnap.state, 'unavailable');
  assert.deepEqual(expiredSnap.accounts, []);

  // 6. Recovery with 1 account replaces the pool (removed account disappears)
  nextResponse = () => ({ stdout: samplePayload(1, currentNow), exitCode: 0 });
  const recoveredSnap = await collector.refresh({ force: true });
  assert.equal(calls.length, 3);
  assert.equal(recoveredSnap.state, 'ready');
  assert.equal(recoveredSnap.accounts.length, 1);
  assert.equal(recoveredSnap.accounts[0].availability, 'ready');

  collector.dispose();
  assert.equal(collector.snapshot().state, 'disposed');
});

test('S5: oversized stdout (> maxOutputBytes), malformed JSON, and hung process timeout are safely bounded', async () => {
  // 1. Oversized stdout is killed and reported as output-exceeded
  let killed = false;
  const hugeCollector = createOmpUsageCollector({
    enabled: true,
    platform: 'win32',
    executable: 'omp.exe',
    limits: { maxOutputBytes: 1024 },
    spawnImpl: () => {
      const p = makeFakeProcess({ stdout: 'x'.repeat(4096), chunkSize: 512 });
      const origKill = p.kill;
      p.kill = () => {
        killed = true;
        origKill();
      };
      return p;
    },
  });
  const hugeSnap = await hugeCollector.refresh({ force: true });
  assert.equal(killed, true);
  assert.equal(hugeSnap.state, 'unavailable');
  assert.equal(hugeSnap.collector.noteCode, 'output-exceeded');

  // 2. Malformed JSON is reported as invalid-json
  const badJsonCollector = createOmpUsageCollector({
    enabled: true,
    platform: 'win32',
    executable: 'omp.exe',
    spawnImpl: () => makeFakeProcess({ stdout: '{not-valid-json', exitCode: 0 }),
  });
  const badJsonSnap = await badJsonCollector.refresh({ force: true });
  assert.equal(badJsonSnap.state, 'unavailable');
  assert.equal(badJsonSnap.collector.noteCode, 'invalid-json');

  // 3. Hung process times out and is killed
  let timeoutKilled = false;
  const timeoutCollector = createOmpUsageCollector({
    enabled: true,
    platform: 'win32',
    executable: 'omp.exe',
    limits: { timeoutMs: 25 },
    spawnImpl: () => {
      const p = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.kill = () => {
        timeoutKilled = true;
      };
      return p;
    },
  });
  const timeoutSnap = await timeoutCollector.refresh({ force: true });
  assert.equal(timeoutKilled, true);
  assert.equal(timeoutSnap.state, 'unavailable');
  assert.equal(timeoutSnap.collector.noteCode, 'timeout');
});
