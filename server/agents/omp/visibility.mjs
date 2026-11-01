// Which OMP sessions the person asked to keep out of view. Presentation only: the adapter, telemetry, usage
// and the JSONL files never see this list. Keyed by the opaque public id; a short safe label is kept so a
// session that has since left the live set can still be found and shown again.
import fs from 'node:fs';
import path from 'node:path';

export const HIDDEN_LIMIT = 500;
const ID_RE = /^omp:[0-9a-f]{64}$/;
const LABEL_MAX = 80;
const cleanLabel = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);

export function createOmpVisibilityStore({ file, now = Date.now, fsImpl = fs } = {}) {
  let items = new Map(), revision = 0, corrupt = false;

  function load() {
    let text;
    try { text = fsImpl.readFileSync(file, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return; corrupt = true; return; }
    try {
      const d = JSON.parse(text);
      if (!d || typeof d !== 'object' || Array.isArray(d) || !Number.isSafeInteger(d.revision) || !Array.isArray(d.items)) throw new Error('shape');
      const next = new Map();
      for (const x of d.items.slice(0, HIDDEN_LIMIT)) {
        if (!x || typeof x.id !== 'string' || !ID_RE.test(x.id)) throw new Error('item');
        next.set(x.id, { id: x.id, label: cleanLabel(x.label), hiddenAt: Number.isFinite(x.hiddenAt) ? x.hiddenAt : 0 });
      }
      items = next; revision = d.revision;
    } catch { corrupt = true; items = new Map(); revision = 0; }   // never overwritten: set() refuses while corrupt
  }
  load();

  function persist(nextItems, nextRevision) {
    const tmp = file + '.tmp';
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fsImpl.writeFileSync(tmp, JSON.stringify({ revision: nextRevision, items: [...nextItems.values()] }));
    // Windows can refuse a rename over a file that a scanner or indexer has open for a moment: retry briefly.
    for (let attempt = 0; ; attempt++) {
      try { fsImpl.renameSync(tmp, file); return; } catch (e) {
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
  }

  return {
    isHidden: (id) => items.has(id),
    snapshot: () => ({ revision, corrupt, items: [...items.values()].sort((a, b) => b.hiddenAt - a.hiddenAt) }),
    /** -> { ok, revision, changed } or { ok:false, code } */
    set(id, hidden, expectedRevision, label = '') {
      if (typeof id !== 'string' || !ID_RE.test(id) || typeof hidden !== 'boolean') return { ok: false, code: 'invalid' };
      if (corrupt) return { ok: false, code: 'store-corrupt' };
      if (items.has(id) === hidden) return { ok: true, revision, changed: false };   // idempotent: already as asked
      if (!Number.isSafeInteger(expectedRevision)) return { ok: false, code: 'invalid' };
      if (expectedRevision !== revision) return { ok: false, code: 'conflict', revision };
      const next = new Map(items);
      if (hidden) {
        if (next.size >= HIDDEN_LIMIT) return { ok: false, code: 'limit' };
        next.set(id, { id, label: cleanLabel(label), hiddenAt: now() });
      } else next.delete(id);
      try { persist(next, revision + 1); } catch { return { ok: false, code: 'write-failed' }; }
      items = next; revision += 1;
      return { ok: true, revision, changed: true };
    },
  };
}
