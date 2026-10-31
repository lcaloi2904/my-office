// Synthetic data only. Never reads profiles, transcripts, credentials, or home directories.
import fs from 'node:fs/promises';
import path from 'node:path';

export const SCHEMA_PIN = '6a86df8539fccf3ad7818081266e554022fc21bc';
export const PRIVATE = 'SYNTHETIC_PRIVATE';
export const header = (extra = {}) => ({ type: 'session', version: 3, id: 'session-a', timestamp: '2026-10-30T10:00:00Z', cwd: '/fixture/projects/repo-a', ...extra });
export const entry = (id, parentId, extra = {}) => ({ type: 'message', id, parentId, timestamp: '2026-10-30T10:01:00Z', message: { role: 'user', content: 'Synthetic message ' + id }, ...extra });
export const usage = (cost = 1) => ({ input: 10, output: 5, cacheRead: 2, cacheWrite: 0, cost: { total: cost } });
export const assistant = (id, parentId, extra = {}) => entry(id, parentId, { message: { role: 'assistant', model: 'fixture/model-a', content: [{ type: 'text', text: 'Synthetic assistant ' + id }], usage: usage(), ...extra } });
export const lines = (records, ending = '\n') => Buffer.from(records.map((r) => JSON.stringify(r)).join(ending) + ending);
export function titleSlot(title = 'Synthetic title') {
  const slot = { type: 'title', v: 1, title, updatedAt: '2026-10-30T10:00:00Z', pad: '' };
  const remaining = 256 - Buffer.byteLength(JSON.stringify(slot)) - 1;
  if (remaining < 0) throw new Error('Synthetic title too long');
  slot.pad = ' '.repeat(remaining);
  return Buffer.from(JSON.stringify(slot) + '\n');
}

export async function fixture(t) {
  const base = path.resolve('test-results-omp-unit');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'case-'));
  const root = await fs.realpath(directory);
  // Cleanup is limited to the unique test-owned directory, never a configured agent root.
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  return { root, source, file: path.join(source, 'session.jsonl'), fs };
}

// Only read-side methods are supplied to the observer. Any write/process/network API is absent.
export function readonlyIO(real = fs) {
  const stats = { opened: 0, closed: 0, active: 0, maxActive: 0, bytesRead: 0, paths: [] };
  const io = Object.fromEntries(['lstat', 'realpath', 'opendir'].map((name) => [name, (...args) => real[name](...args)]));
  io.open = async (file, flags) => {
    // O_RDONLY is zero. O_NOFOLLOW may additionally be supplied; neither grants writes.
    if (typeof flags !== 'number' || (flags & 3) !== 0) throw new Error('Non-read-only open');
    const handle = await real.open(file, flags);
    stats.opened++; stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active); stats.paths.push(file);
    return {
      stat: (...args) => handle.stat(...args),
      read: async (...args) => { const result = await handle.read(...args); stats.bytesRead += result.bytesRead; return result; },
      close: async () => { await handle.close(); stats.closed++; stats.active--; },
    };
  };
  return { io, stats };
}
