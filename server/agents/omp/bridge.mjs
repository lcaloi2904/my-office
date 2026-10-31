// Telemetry-only ingress for the OMP observer. It authenticates a source-bound token, bounds the request and hands
// normalized events to the lifecycle. It never answers with a command, a path or anything the producer could act on.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeOmpLiveEvent } from './normalize.mjs';

const TOKEN = /^[0-9a-f]{64}$/;
const BEARER = /^Bearer ([0-9a-f]{64})$/;
export const INGEST_LIMITS = Object.freeze({ maxBodyBytes: 64 * 1024, maxEvents: 32, bodyTimeoutMs: 5000, burst: 200, perSecond: 50 });
const digest = (s) => createHash('sha256').update(s).digest();
const reply = (status, body) => ({ status, body });
const refuse = (status, code, extra) => reply(status, { ok: false, code, ...extra });

// Source-bound tokens live in the office's private data folder (never in git). A missing one is created for a configured
// source; a stale one for a source that is no longer configured is ignored, not deleted.
export async function loadIngestTokens({ file, sourceIds, io = fsp, random = () => randomBytes(32).toString('hex') }) {
  let stored = {};
  try {
    const parsed = JSON.parse(await io.readFile(file, 'utf8'));
    if (parsed?.version === 1 && parsed.tokens && typeof parsed.tokens === 'object' && !Array.isArray(parsed.tokens)) stored = parsed.tokens;
  } catch { /* first start, or an unreadable file that is replaced below */ }
  const tokens = new Map();
  let dirty = false;
  for (const id of sourceIds) {
    if (typeof stored[id] === 'string' && TOKEN.test(stored[id])) tokens.set(id, stored[id]);
    else { tokens.set(id, random()); dirty = true; }
  }
  if (dirty) {
    const next = { ...stored };
    for (const [id, token] of tokens) next[id] = token;
    await io.mkdir(path.dirname(file), { recursive: true });
    await io.writeFile(file + '.tmp', JSON.stringify({ version: 1, tokens: next }), { mode: 0o600 });
    await io.rename(file + '.tmp', file);
  }
  return tokens;
}

async function readBody(body, { max, timeoutMs, setTimer, clearTimer, abort }) {
  const iterator = body[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0, timer = null;
  try {
    for (;;) {
      const wait = new Promise((_, reject) => { timer = setTimer(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs); timer?.unref?.(); });
      const step = await Promise.race([iterator.next(), wait]);
      clearTimer(timer); timer = null;
      if (step.done) break;
      const chunk = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
      size += chunk.length;
      if (size > max) throw Object.assign(new Error('too large'), { code: 'too-large' });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } catch (e) {
    // The caller decides how to stop the producer (an HTTP request must answer before its socket goes). A stalled
    // stream never settles a pending read, so this is neither awaited nor retried.
    try { abort(); } catch { /* already closed */ }
    throw e;
  } finally { if (timer) clearTimer(timer); }
}

export function createOmpBridge({ lifecycle, tokens, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, limits = {} } = {}) {
  const cap = { ...INGEST_LIMITS, ...limits };
  const sources = [...tokens].map(([id, token]) => ({ id, hash: digest(token) }));
  const buckets = new Map();
  let disposed = false;
  const counters = { accepted: 0, rejected: 0, limited: 0 };

  function sourceOf(header) {
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) return null;
    const given = digest(match[1]);
    let found = null;
    for (const s of sources) if (timingSafeEqual(given, s.hash) && !found) found = s.id;   // (every source is compared)
    return found;
  }
  function take(sourceId, n) {
    const t = now();
    const b = buckets.get(sourceId) || { tokens: cap.burst, at: t };
    b.tokens = Math.min(cap.burst, b.tokens + Math.max(0, t - b.at) / 1000 * cap.perSecond); b.at = t;
    buckets.set(sourceId, b);
    if (b.tokens < n) return Math.ceil((n - b.tokens) / cap.perSecond * 1000);
    b.tokens -= n; return 0;
  }

  // req: { method, headers, loopback, viaTunnel, body, abort? } — the HTTP layer only forwards facts, this decides.
  async function handle(req) {
    if (disposed) return refuse(404, 'off');
    // Order matters: nothing below runs for a request that should never have reached this route.
    if (req.loopback !== true || req.viaTunnel) { counters.rejected++; return refuse(403, 'forbidden'); }
    const h = req.headers || {};
    if (h.origin !== undefined) { counters.rejected++; return refuse(403, 'forbidden'); }
    if (req.method !== 'POST') return refuse(405, 'method');
    const sourceId = sourceOf(h.authorization);
    if (!sourceId) { counters.rejected++; return refuse(401, 'unauthorized'); }
    if (!String(h['content-type'] || '').toLowerCase().startsWith('application/json')) return refuse(415, 'content-type');
    const declared = Number(h['content-length']);
    if (h['content-length'] !== undefined && (!Number.isFinite(declared) || declared < 0 || declared > cap.maxBodyBytes)) { counters.rejected++; return refuse(413, 'too-large'); }
    const wait = take(sourceId, 1);
    if (wait) { counters.limited++; return refuse(429, 'rate-limited', { retryAfterMs: wait }); }
    let buffer;
    const abort = typeof req.abort === 'function' ? req.abort : () => req.body.destroy?.();
    try { buffer = await readBody(req.body, { max: cap.maxBodyBytes, timeoutMs: cap.bodyTimeoutMs, setTimer, clearTimer, abort }); }
    catch (e) { counters.rejected++; return e?.code === 'too-large' ? refuse(413, 'too-large') : refuse(408, 'timeout'); }
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8')); } catch { counters.rejected++; return refuse(400, 'invalid-json'); }
    const list = Array.isArray(parsed?.events) ? parsed.events : [parsed];
    if (!list.length || list.length > cap.maxEvents) { counters.rejected++; return refuse(400, 'invalid-batch'); }
    const extra = take(sourceId, list.length - 1);
    if (extra) { counters.limited++; return refuse(429, 'rate-limited', { retryAfterMs: extra }); }
    let resync = false, anyOk = false;
    const results = list.map((raw) => {
      const event = normalizeOmpLiveEvent(raw);
      if (!event) return { ok: false, code: 'invalid-event' };
      // A token speaks for one configured source only; it can never declare a session of another namespace.
      if (event.sourceId !== sourceId) return { ok: false, code: 'source-mismatch' };
      const r = lifecycle.ingest(event);
      if (!r.ok) {
        if (r.code === 'snapshot-required' || r.code === 'unknown-generation') resync = true;
        return { ok: false, code: r.code };
      }
      anyOk = true;
      return { ok: true, ack: r.ack, ...(r.duplicate && { duplicate: true }), ...(r.buffered && { buffered: true }), ...(r.gap && { gap: true }) };
    });
    if (anyOk) counters.accepted++; else counters.rejected++;
    return reply(anyOk || results.some((r) => r.code === 'snapshot-required' || r.code === 'unknown-generation') ? 200 : 422, { ok: anyOk, results, resync });
  }

  return {
    handle, status: () => ({ ...counters, sources: sources.length }),
    dispose() { disposed = true; buckets.clear(); sources.length = 0; },
  };
}
