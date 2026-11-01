// Bounded, serialized read-only JSONL reader. Check every consumed block before treating growth as append.
// Prefix/tail heuristics alone cannot detect a middle rewrite. Verification reads old bytes but never reparses
// them unless they changed. All source handles close per poll; no durable cache/checkpoint is trusted.
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { containedPath, openContained, errorCode, DEFAULT_LIMITS, fault } from './paths.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const stampOf = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const identityOf = (s) => `${s.dev}:${s.ino}`;

export function createReader({ root, relative, factory, io, limits = {}, now = Date.now } = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  if (typeof factory !== 'function' || ['chunkBytes', 'bytesPerTick', 'maxLineBytes', 'maxFileBytes', 'reconcileMs'].some((k) => !Number.isSafeInteger(cfg[k]) || cfg[k] <= 0) || cfg.chunkBytes > cfg.bytesPerTick) throw fault('CONFIG_INVALID');
  let reducer, offset = 0, committedOffset = 0, pending = Buffer.alloc(0), draining = false;
  let blocks = [], epoch = 0, snapshot = null, identity = null, stamp = null, targetStamp = null;
  let verifying = false, verifyIndex = 0, lastVerified = 0, busy = null, disposed = false;
  let state = 'new', bytesRead = 0, diagnostics = new Set();
  const report = (code) => { if (diagnostics.size < 24) diagnostics.add(code); };
  const unknownMetrics = () => ({ cost: null, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null, provenance: 'unknown' }, context: null });
  const markIncomplete = () => {
    if (snapshot) snapshot = { ...snapshot, metrics: unknownMetrics(), incomplete: true, diagnostics: [...new Set([...(snapshot.diagnostics || []), ...diagnostics])].slice(0, 24) };
  };
  function reset() {
    reducer = factory(); offset = 0; committedOffset = 0; pending = Buffer.alloc(0); draining = false;
    blocks = []; verifying = false; verifyIndex = 0; diagnostics = new Set(); epoch++;
  }
  reset();
  function frame(buffer, start) {
    let at = 0;
    while (at < buffer.length) {
      const nl = buffer.indexOf(10, at), end = nl < 0 ? buffer.length : nl;
      const piece = buffer.subarray(at, end);
      if (!draining) {
        if (pending.length + piece.length > cfg.maxLineBytes) { pending = Buffer.alloc(0); draining = true; report('line-limit'); }
        else pending = Buffer.concat([pending, piece]);
      }
      if (nl < 0) break;
      const next = start + nl + 1;
      if (!draining && pending.length) {
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(pending);
          reducer.push(JSON.parse(text), { offset: committedOffset, bytes: next - committedOffset });
        } catch { report('malformed-line'); }
      }
      pending = Buffer.alloc(0); draining = false; committedOffset = next; at = nl + 1;
    }
  }
  async function run(signal) {
    if (disposed || signal?.aborted) return info();
    let handle;
    try {
      if (state === 'ready' && !verifying && now() - lastVerified < cfg.reconcileMs) {
        const file = await containedPath(root, relative, io), pre = await io.lstat(file);
        if (!pre.isFile() || pre.nlink > 1) throw fault('PATH_DENIED');
        if (stamp === stampOf(pre)) return info();
      }
      handle = await openContained(root, relative, io);
      if (disposed || signal?.aborted) return info();
      const stat = await handle.stat(), nextStamp = stampOf(stat), nextIdentity = identityOf(stat);
      if (stat.size > cfg.maxFileBytes || Math.ceil(stat.size / cfg.chunkBytes) > 4096) {
        const code = stat.size > cfg.maxFileBytes ? 'file-limit' : 'fingerprint-limit';
        reset(); state = 'unsupported'; report(code); markIncomplete(); return info();
      }
      if ((identity !== null && (identity !== nextIdentity || stat.size < offset)) || state === 'absent' || state === 'unsupported') reset();
      identity = nextIdentity;
      if (targetStamp !== nextStamp) {
        targetStamp = nextStamp;
        verifying = blocks.length > 0; verifyIndex = 0;
      } else if (state === 'ready' && now() - lastVerified >= cfg.reconcileMs) {
        verifying = blocks.length > 0; verifyIndex = 0;
      }
      if (!verifying && stamp === nextStamp && state === 'ready') return info();
      state = snapshot ? 'refreshing' : 'loading';
      let budget = cfg.bytesPerTick;
      while (verifying && verifyIndex < blocks.length && budget > 0 && !disposed && !signal?.aborted) {
        const block = blocks[verifyIndex];
        if (budget < block.size) break;
        const buf = Buffer.alloc(block.size), { bytesRead: n } = await handle.read(buf, 0, buf.length, block.at);
        bytesRead += n; budget -= buf.length;
        if (n !== block.size || hash(buf) !== block.hash) { reset(); state = snapshot ? 'refreshing' : 'loading'; break; }
        verifyIndex++;
      }
      if (verifying && verifyIndex === blocks.length) { verifying = false; lastVerified = now(); }
      while (!verifying && offset < stat.size && budget > 0 && !disposed && !signal?.aborted) {
        // Canonical fixed blocks bound the ledger even when a producer appends one byte at a time.
        const index = Math.floor(offset / cfg.chunkBytes), start = index * cfg.chunkBytes, prefix = offset - start;
        const size = Math.min(cfg.chunkBytes, budget, stat.size - start);
        if (size <= prefix) break;
        const buf = Buffer.alloc(size), { bytesRead: n } = await handle.read(buf, 0, size, start);
        bytesRead += n; budget -= size;
        if (n <= prefix) { report('short-read'); break; }
        if (prefix && hash(buf.subarray(0, prefix)) !== blocks[index]?.hash) {
          reset(); state = snapshot ? 'refreshing' : 'loading'; break;
        }
        const data = buf.subarray(0, n);
        blocks[index] = { at: start, size: n, hash: hash(data) };
        frame(data.subarray(prefix), offset); offset = start + n;
      }
      if (disposed || signal?.aborted) return info();
      const after = await handle.stat();
      if (stampOf(after) !== nextStamp) { targetStamp = null; return info(); }
      if (!verifying && offset === stat.size) {
        const framingIncomplete = diagnostics.size > 0 || pending.length > 0 || draining;
        const value = reducer.value({ incomplete: framingIncomplete });
        const allIssues = [...new Set([...(value.diagnostics || []), ...diagnostics])].slice(0, 24);
        snapshot = { ...value, epoch, revision: hash(Buffer.from(blocks.map((b) => b.hash).join(''))),
          incomplete: value.incomplete || framingIncomplete, diagnostics: allIssues, partialLine: pending.length > 0 || draining };
        state = 'ready'; stamp = nextStamp; lastVerified = now();
      }
    } catch (e) { state = e?.code === 'ENOENT' ? 'absent' : 'degraded'; report(errorCode(e)); markIncomplete(); }
    finally { if (handle) await handle.close(); }
    return info();
  }
  function info() { return { state: disposed ? 'disposed' : state, snapshot, epoch, offset: committedOffset, readOffset: offset, pendingBytes: pending.length, blocks: blocks.length, bytesRead, diagnostics: [...diagnostics] }; }
  function poll({ signal } = {}) {
    if (busy) return busy;
    busy = run(signal).finally(() => { busy = null; });
    return busy;
  }
  async function dispose() { disposed = true; await busy; pending = Buffer.alloc(0); blocks = []; snapshot = null; reducer = null; }
  return { poll, info, dispose };
}
