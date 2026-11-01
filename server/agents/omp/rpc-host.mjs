// OMP RPC stdio transport. Phase 03: internal get_state/new_session only; Phase 04 adds interactive commands when allowControl=true.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MAX_COMMAND_BYTES, MAX_COMMAND_CHARS } from './command-schema.mjs';

const BASE_RPC_METHODS = new Set(['get_state', 'new_session', 'get_session_lease']);
const CONTROL_RPC_METHODS = new Set(['prompt', 'steer', 'follow_up', 'abort', 'remove_queued_message']);
const MAX_FRAME = 1024 * 1024;
const MAX_OUTBOUND = 20 * 1024;
const fault = (code, extra) => Object.assign(new Error(code), { code, ...extra });

// Never spread process.env: provider credentials, injection hooks and arbitrary OMP flags stay outside a child.
export function childEnvironment(source = process.env) {
  const keys = ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'TEMP', 'TMP'];
  const env = {};
  for (const key of keys) if (typeof source[key] === 'string' && source[key] && source[key].length < 8192) env[key] = source[key];
  return { ...env, OMP_SKIP_SETUP: '1', PI_NO_TITLE: '1', PI_NO_PTY: '1', OTEL_SDK_DISABLED: 'true' };
}

export function createOmpRpcHost({ binary, args, cwd, env, spawnImpl = spawn, timeoutMs = 8000,
  maxFrameBytes = MAX_FRAME, requiredOwnershipProtocol, allowControl = false,
  onEvent = () => {}, onExit = () => {} } = {}) {
  if (typeof binary !== 'string' || !Array.isArray(args) || typeof cwd !== 'string' ||
      (requiredOwnershipProtocol !== undefined && requiredOwnershipProtocol !== 1) ||
      typeof allowControl !== 'boolean' || typeof onEvent !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw fault('RPC_INVALID');
  const maxFrame = Math.min(Math.max(maxFrameBytes, 1024), MAX_FRAME);
  let child = null, ready = false, closed = false, buffer = Buffer.alloc(0), readyResolve, readyReject;
  let settled = false, shutdown = null, exitNotified = false;
  const pending = new Map();
  const boot = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const fail = (code) => {
    if (closed) return;
    closed = true;
    if (!settled) { settled = true; readyReject(fault(code)); }
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(fault(code)); }
    pending.clear();
    try { child?.stdin?.end(); child?.kill(); } catch { /* only the child owned by this host */ }
  };
  const notifyExit = () => {
    if (exitNotified) return;
    exitNotified = true;
    if (!closed) fail('RPC_CLOSED');
    try { onExit(); } catch { /* observer callback cannot break cleanup */ }
  };
  const frame = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return fail('RPC_PROTOCOL');
    if (!ready) {
      if (message.type !== 'ready' || message.protocolVersion !== 1) return fail('RPC_VERSION');
      if (requiredOwnershipProtocol !== undefined &&
        message.officeOwnershipProtocol !== requiredOwnershipProtocol) return fail('RPC_OWNERSHIP_PROTOCOL');
      ready = true;
      if (!settled) { settled = true; readyResolve(); }
      return;
    }
    if (message.type !== 'response') {
      if (typeof message.type === 'string' && message.type.length <= 80) {
        try { onEvent(message); } catch { /* event listeners cannot crash RPC framing */ }
      }
      return;
    }
    const id = message.id;
    if (typeof id !== 'string' || !pending.has(id)) return;
    const task = pending.get(id);
    pending.delete(id); clearTimeout(task.timer);
    if (message.command !== task.method || typeof message.success !== 'boolean') {
      task.reject(fault('RPC_PROTOCOL')); fail('RPC_PROTOCOL'); return;
    }
    if (!message.success) {
      task.reject(fault('RPC_REJECTED', { rpcCode: typeof message.code === 'string' ? message.code : null }));
      return;
    }
    task.resolve(message.data ?? null);
  };
  const ingest = (chunk) => {
    if (closed) return;
    if (!Buffer.isBuffer(chunk)) return fail('RPC_PROTOCOL');
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxFrame * 2) return fail('RPC_FRAME_LIMIT');
    while (!closed) {
      const i = buffer.indexOf(10);
      if (i < 0) {
        if (buffer.length > maxFrame) fail('RPC_FRAME_LIMIT');
        return;
      }
      if (i > maxFrame) return fail('RPC_FRAME_LIMIT');
      const line = buffer.subarray(0, i).toString('utf8').trim();
      buffer = buffer.subarray(i + 1);
      if (!line) continue;
      try { frame(JSON.parse(line)); } catch { fail('RPC_PROTOCOL'); }
    }
  };
  const start = async () => {
    if (child || closed) throw fault('RPC_INVALID');
    try {
      child = spawnImpl(binary, args, { shell: false, windowsHide: true, cwd, env: env ?? childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
      if (!child?.stdin || !child?.stdout || !child?.stderr) throw fault('RPC_INVALID');
      child.stdout.on('data', ingest);
      child.stdout.on('error', () => fail('RPC_STREAM'));
      // Stderr may contain private paths/tool data: drain without logging or reflecting it.
      child.stderr.on('data', () => {});
      child.stderr.on('error', () => fail('RPC_STREAM'));
      child.on('error', () => { fail('RPC_SPAWN'); notifyExit(); });
      child.on('exit', notifyExit);
    } catch { fail('RPC_SPAWN'); }
    const timer = setTimeout(() => fail('RPC_START_TIMEOUT'), timeoutMs);
    timer.unref?.();
    try { await boot; return api; } finally { clearTimeout(timer); }
  };
  const validData = (method, data) => {
    if (method === 'get_state' || method === 'new_session' || method === 'abort') return data === undefined;
    if (method === 'get_session_lease') {
      return !!data && Array.isArray(data.sessionIds) && data.sessionIds.length === 1 &&
        typeof data.sessionIds[0] === 'string' && data.sessionIds[0].length > 0 && data.sessionIds[0].length <= 256;
    }
    if (method === 'prompt' || method === 'steer' || method === 'follow_up') {
      return !!data && typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 1 && typeof data.message === 'string' &&
        data.message.length > 0 && data.message.length <= MAX_COMMAND_CHARS &&
        Buffer.byteLength(data.message, 'utf8') <= MAX_COMMAND_BYTES;
    }
    if (method === 'remove_queued_message') {
      return !!data && typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 2 && typeof data.message === 'string' &&
        data.message.length > 0 && data.message.length <= MAX_COMMAND_CHARS &&
        Buffer.byteLength(data.message, 'utf8') <= MAX_COMMAND_BYTES &&
        (data.queue === 'steering' || data.queue === 'followUp');
    }
    return false;
  };
  const request = (method, data, opts = {}) => {
    const allowed = BASE_RPC_METHODS.has(method) || (allowControl && CONTROL_RPC_METHODS.has(method));
    if (!ready || closed || !allowed || pending.size >= 8) return Promise.reject(fault('RPC_UNAVAILABLE'));
    if (!validData(method, data)) return Promise.reject(fault('RPC_INVALID'));
    const id = typeof opts?.requestId === 'string' && /^[A-Za-z0-9._:-]{4,128}$/.test(opts.requestId)
      ? opts.requestId : randomUUID();
    if (pending.has(id)) return Promise.reject(fault('RPC_DUPLICATE_ID'));
    const maxBytes = CONTROL_RPC_METHODS.has(method) ? MAX_OUTBOUND : 4096;
    const command = JSON.stringify({ id, type: method, ...(data === undefined ? {} : data) }) + '\n';
    if (Buffer.byteLength(command) > maxBytes || child.stdin.destroyed || child.stdin.writableLength > 32 * 1024) {
      return Promise.reject(fault('RPC_BACKPRESSURE'));
    }
    const keepOpenOnTimeout = opts?.killOnTimeout === false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); reject(fault('RPC_TIMEOUT', { requestId: id }));
        if (!keepOpenOnTimeout) fail('RPC_TIMEOUT');
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { method, resolve, reject, timer });
      try { child.stdin.write(command, 'utf8', (err) => { if (err) fail('RPC_STREAM'); }); }
      catch { fail('RPC_STREAM'); }
    });
  };
  const close = async () => {
    if (shutdown) return shutdown;
    closed = true;
    if (!settled) { settled = true; readyReject(fault('RPC_CLOSED')); }
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(fault('RPC_CLOSED')); }
    pending.clear();
    shutdown = new Promise((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const done = () => { clearTimeout(timer); resolve(); };
      child.once('exit', done);
      try { child.stdin.end(); } catch { /* closed */ }
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* owned child has gone */ }
        resolve();
      }, 2500);
      timer.unref?.();
    });
    return shutdown;
  };
  const api = { start, request, close, isReady: () => ready && !closed, pid: () => child?.pid ?? null };
  return api;
}
