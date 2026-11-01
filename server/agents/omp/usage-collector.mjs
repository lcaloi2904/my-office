// Bounded, isolated OMP account quota collector.
// Uses only the G1-certified read-only CLI path (`omp [--profile <p>] usage --json --no-extensions`).
// Never reads `agent.db`, never mutates OMP config, never spends saved resets, never runs when OFF or idle without viewers.
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import {
  createAccountKeyer,
  normalizeOmpProfile,
  normalizeOmpUsagePayload,
  projectOmpUsageSnapshot,
} from './usage-accounts.mjs';

const FORBIDDEN_ARGS = new Set([
  'reset',
  'invalidate',
  'login',
  'logout',
  'auth',
  'auth-broker',
  'config',
  '--hook',
  '-e',
  '--extension',
]);

export const DEFAULT_COLLECTOR_LIMITS = Object.freeze({
  timeoutMs: 12_000,
  maxOutputBytes: 512 * 1024,
  cacheTtlMs: 60_000,
  staleTtlMs: 15 * 60_000,
  pollIntervalMs: 120_000,
  baseBackoffMs: 15_000,
  maxBackoffMs: 5 * 60_000,
  rateLimitBackoffMs: 2 * 60_000,
});

function classifyFailureCode(exitCode, stderrText, spawnError) {
  if (spawnError) {
    const code = spawnError.code || '';
    if (code === 'ETIMEDOUT' || spawnError.message === 'TIMEOUT') return 'timeout';
    if (code === 'OUTPUT_EXCEEDED' || spawnError.message === 'OUTPUT_EXCEEDED') return 'output-exceeded';
    return 'cli-unavailable';
  }
  const lower = String(stderrText || '').toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) return 'rate-limited';
  if (lower.includes('auth broker') || lower.includes('authbroker')) return 'broker-unreachable';
  if (lower.includes('401') || lower.includes('403') || lower.includes('oauth') || lower.includes('unauthorized')) return 'auth-error';
  if (lower.includes('invalid omp profile')) return 'invalid-profile';
  return exitCode === 0 ? 'invalid-json' : 'command-failed';
}

/**
 * Verify that the command and argv strictly match the G1-certified read-only usage invocation.
 */
export function buildSafeUsageArgv(cliProfile) {
  const argv = [];
  if (cliProfile !== null && cliProfile !== undefined) {
    argv.push('--profile', cliProfile);
  }
  argv.push('usage', '--json', '--no-extensions');
  for (const arg of argv) {
    if (FORBIDDEN_ARGS.has(arg)) {
      throw new Error(`Forbidden OMP argument: ${arg}`);
    }
  }
  return Object.freeze(argv);
}

function validateExecutablePath(executable, platform = process.platform) {
  if (typeof executable !== 'string') return { ok: false, noteCode: 'cli-unavailable' };
  const trimmed = executable.trim();
  if (!trimmed || trimmed.length > 512 || /[\u0000-\u001f\u007f;&|`$<>]/.test(trimmed)) {
    return { ok: false, noteCode: 'cli-unavailable' };
  }
  // Detect Windows vs WSL path mismatch explicitly (S2)
  if (platform === 'win32' && trimmed.startsWith('/')) {
    return { ok: false, noteCode: 'profile-mismatch' };
  }
  if (platform !== 'win32' && /^[A-Za-z]:\\/.test(trimmed)) {
    return { ok: false, noteCode: 'profile-mismatch' };
  }
  const base = (platform === 'win32' ? path.win32 : path.posix).basename(trimmed).toLowerCase();
  if (!['omp', 'omp.exe', 'omp.cmd'].includes(base)) {
    return { ok: false, noteCode: 'cli-unavailable' };
  }
  return { ok: true, executable: trimmed };
}

export function createOmpUsageCollector({
  enabled = true,
  executable = 'omp',
  profile = undefined,
  source = 'omp-cli',
  platform = process.platform,
  env = process.env,
  spawnImpl = nodeSpawn,
  now = Date.now,
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  keySecret = undefined,
  limits = {},
  onChange = () => {},
} = {}) {
  const cfg = { ...DEFAULT_COLLECTOR_LIMITS, ...limits };
  const keyer = createAccountKeyer(keySecret !== undefined ? { secret: keySecret } : {});
  const rawProfile = profile !== undefined ? profile : (env?.OFFICE_OMP_PROFILE ?? env?.OMP_PROFILE ?? env?.PI_PROFILE);
  const profileCheck = normalizeOmpProfile(rawProfile);
  const execCheck = validateExecutablePath(executable, platform);

  let disposed = false;
  let watching = false;
  let pollTimer = null;
  let inFlight = null;
  let activeKill = null;
  let failures = 0;
  let backoffUntil = 0;
  let lastObservedAt = null;
  let lastSuccessAt = null;
  let lastNoteCode = !enabled
    ? null
    : !profileCheck.valid
      ? 'invalid-profile'
      : !execCheck.ok
        ? execCheck.noteCode
        : null;
  let lastGoodAccounts = [];
  let spawnCount = 0;

  function canRun() {
    return Boolean(enabled && !disposed && profileCheck.valid && execCheck.ok);
  }

  function stopPollTimer() {
    if (pollTimer !== null) {
      clearTimer(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll() {
    stopPollTimer();
    if (!canRun() || !watching) return;
    pollTimer = setTimer(() => {
      pollTimer = null;
      if (!canRun() || !watching) return;
      void refresh().finally(() => {
        if (canRun() && watching) schedulePoll();
      });
    }, cfg.pollIntervalMs);
    pollTimer?.unref?.();
  }

  function computeAccountsView(currentNow) {
    if (!enabled || !profileCheck.valid || !execCheck.ok) return [];
    if (!lastGoodAccounts.length || lastSuccessAt === null) return [];
    const age = currentNow - lastSuccessAt;
    if (age > cfg.staleTtlMs) {
      return [];
    }
    const isStale = failures > 0 || age > cfg.cacheTtlMs * 2;
    if (!isStale) return lastGoodAccounts;
    return lastGoodAccounts.map((acct) => ({
      ...acct,
      availability: acct.availability === 'ready' ? 'stale' : acct.availability,
      ...(lastNoteCode && !acct.noteCode ? { noteCode: lastNoteCode } : {}),
    }));
  }

  function computeCollectorState(currentNow, accountsView) {
    if (!enabled) return 'disabled';
    if (disposed) return 'disposed';
    if (!profileCheck.valid || !execCheck.ok) return 'config-invalid';
    if (lastSuccessAt !== null && currentNow - lastSuccessAt <= cfg.staleTtlMs) {
      return failures > 0 || currentNow - lastSuccessAt > cfg.cacheTtlMs * 2 ? 'stale' : 'ready';
    }
    if (inFlight) return 'loading';
    if (failures > 0) return 'unavailable';
    return accountsView.length ? 'ready' : 'idle';
  }

  function snapshot({ local = true } = {}) {
    const currentNow = now();
    const accountsView = computeAccountsView(currentNow);
    const state = computeCollectorState(currentNow, accountsView);
    const expiredStale = lastSuccessAt !== null && currentNow - lastSuccessAt > cfg.staleTtlMs && failures > 0;
    const noteCode = expiredStale ? (lastNoteCode || 'stale-expired') : lastNoteCode;
    const rawSnap = {
      version: 1,
      enabled: Boolean(enabled),
      state,
      profile: profileCheck.valid ? profileCheck.profile : null,
      accounts: accountsView,
      collector: {
        observedAt: lastObservedAt,
        lastSuccessAt,
        noteCode: noteCode || null,
        inFlight: Boolean(inFlight),
      },
      issues: noteCode ? [noteCode] : [],
    };
    return projectOmpUsageSnapshot(rawSnap, { local });
  }

  function runCliOnce() {
    const argv = buildSafeUsageArgv(profileCheck.cliProfile);
    spawnCount++;
    return new Promise((resolve) => {
      let stdoutBuf = Buffer.alloc(0);
      let stderrBuf = Buffer.alloc(0);
      let settled = false;
      let exceeded = false;
      let timedOut = false;
      let child = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        activeKill = null;
        if (guard !== null) clearTimer(guard);
        resolve(result);
      };

      const killChild = () => {
        try {
          child?.kill();
        } catch {
          // Process already exited
        }
      };

      const guard = setTimer(() => {
        timedOut = true;
        killChild();
        finish({ ok: false, noteCode: 'timeout', stdout: '' });
      }, cfg.timeoutMs);
      guard?.unref?.();

      try {
        child = spawnImpl(execCheck.executable, [...argv], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        });
      } catch (err) {
        finish({ ok: false, noteCode: classifyFailureCode(1, '', err), stdout: '' });
        return;
      }

      activeKill = killChild;

      child.stdout?.on('data', (chunk) => {
        if (settled || exceeded) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (stdoutBuf.length + buf.length > cfg.maxOutputBytes) {
          exceeded = true;
          killChild();
          finish({ ok: false, noteCode: 'output-exceeded', stdout: '' });
          return;
        }
        stdoutBuf = Buffer.concat([stdoutBuf, buf]);
      });

      child.stderr?.on('data', (chunk) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (stderrBuf.length < 4096) {
          stderrBuf = Buffer.concat([stderrBuf, buf.subarray(0, 4096 - stderrBuf.length)]);
        }
      });

      child.on('error', (err) => {
        finish({ ok: false, noteCode: classifyFailureCode(1, stderrBuf.toString('utf8'), err), stdout: '' });
      });

      child.on('close', (code) => {
        if (timedOut) {
          finish({ ok: false, noteCode: 'timeout', stdout: '' });
          return;
        }
        if (exceeded) {
          finish({ ok: false, noteCode: 'output-exceeded', stdout: '' });
          return;
        }
        const exitCode = typeof code === 'number' ? code : 1;
        const stdoutText = stdoutBuf.toString('utf8');
        const stderrText = stderrBuf.toString('utf8');
        if (exitCode !== 0 && !stdoutText.trim()) {
          finish({ ok: false, noteCode: classifyFailureCode(exitCode, stderrText, null), stdout: '' });
          return;
        }
        finish({ ok: true, exitCode, stdout: stdoutText, stderr: stderrText });
      });
    });
  }

  function applyBackoff(noteCode, currentNow) {
    failures++;
    const base =
      noteCode === 'rate-limited'
        ? Math.max(cfg.rateLimitBackoffMs, cfg.baseBackoffMs * 2 ** Math.min(5, failures - 1))
        : cfg.baseBackoffMs * 2 ** Math.min(5, failures - 1);
    const clamped = Math.min(cfg.maxBackoffMs, base);
    const jitter = 0.75 + random() * 0.5;
    backoffUntil = currentNow + Math.round(clamped * jitter);
  }

  async function refresh({ force = false } = {}) {
    if (!canRun()) return snapshot();
    const currentNow = now();
    if (!force && lastSuccessAt !== null && failures === 0 && currentNow - lastSuccessAt < cfg.cacheTtlMs) {
      return snapshot();
    }
    if (currentNow < backoffUntil) {
      return snapshot();
    }
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const res = await runCliOnce();
      const finishedAt = now();
      inFlight = null;
      if (disposed) return snapshot();
      lastObservedAt = finishedAt;

      if (!res.ok) {
        lastNoteCode = res.noteCode || 'command-failed';
        applyBackoff(lastNoteCode, finishedAt);
        const out = snapshot();
        onChange(out);
        return out;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(res.stdout);
      } catch {
        lastNoteCode = classifyFailureCode(res.exitCode, res.stderr, null);
        applyBackoff(lastNoteCode, finishedAt);
        const out = snapshot();
        onChange(out);
        return out;
      }

      const normalized = normalizeOmpUsagePayload(parsed, {
        profileNamespace: profileCheck.profile,
        source: env?.OMP_AUTH_BROKER_URL ? 'omp-broker' : source,
        nowMs: finishedAt,
        keyer,
      });

      if (!normalized.ok) {
        lastNoteCode = normalized.errorCode || 'invalid-json';
        applyBackoff(lastNoteCode, finishedAt);
        const out = snapshot();
        onChange(out);
        return out;
      }

      failures = 0;
      backoffUntil = 0;
      lastSuccessAt = finishedAt;
      lastNoteCode = null;
      lastGoodAccounts = normalized.accounts;
      const out = snapshot();
      onChange(out);
      return out;
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function setWatching(nextWatching) {
    const bool = Boolean(nextWatching);
    if (watching === bool) return;
    watching = bool;
    if (!watching) {
      stopPollTimer();
      return;
    }
    if (canRun()) {
      void refresh();
      schedulePoll();
    }
  }

  function dispose() {
    disposed = true;
    watching = false;
    stopPollTimer();
    if (activeKill) {
      activeKill();
      activeKill = null;
    }
    lastGoodAccounts = [];
  }

  return {
    refresh,
    snapshot,
    setWatching,
    dispose,
    stats: () => ({ spawnCount, failures, backoffUntil, watching, enabled: Boolean(enabled), disposed }),
  };
}
