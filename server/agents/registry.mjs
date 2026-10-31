// Injectable read-only facade. Production registers Claude only in Phase 02.
import { capabilitiesFor } from './schema.mjs';
import { projectAgentSession } from './projection.mjs';

export function createAgentRegistry({ adapters = [] } = {}) {
  const providers = new Map(), issues = new Set();
  let startPromise = null, disposed = false;

  function register(adapter) {
    if (!adapter || !['claude', 'omp'].includes(adapter.kind)) return false;
    if (providers.has(adapter.kind)) throw new Error('Agent adapter already registered: ' + adapter.kind);
    if (typeof adapter.list !== 'function' || typeof adapter.resolve !== 'function') return false;
    if (startPromise || disposed) throw new Error('Cannot register adapter after start/dispose');
    providers.set(adapter.kind, Object.freeze({ ...adapter }));
    return true;
  }
  for (const adapter of adapters) if (!register(adapter)) throw new Error('Invalid agent adapter');

  function list() {
    if (disposed) return [];
    const result = [], seen = new Set();
    for (const [kind, adapter] of providers) {
      let rows;
      try { rows = adapter.list(); } catch { issues.add(kind + ':list-failed'); continue; }
      if (!Array.isArray(rows)) { issues.add(kind + ':invalid-list'); continue; }
      // Preserve the existing Claude catalogue; only optional providers get this facade cap.
      if (kind !== 'claude' && rows.length > 10000) issues.add(kind + ':truncated');
      for (const raw of kind === 'claude' ? rows : rows.slice(0, 10000)) {
        let session;
        try { session = projectAgentSession(kind, raw); } catch { /* malformed optional data */ }
        if (!session) { issues.add(kind + ':invalid-session'); continue; }
        if (seen.has(session.id)) { issues.add(kind + ':duplicate-id'); continue; }
        result.push(session); seen.add(session.id);
      }
    }
    return result;
  }

  function resolve(id) {
    if (disposed || typeof id !== 'string' || !id || id.length > 256) return null;
    let found = null;
    for (const [kind, adapter] of providers) {
      let raw, pub;
      try {
        raw = adapter.resolve(id);
        if (!raw) continue;
        pub = projectAgentSession(kind, kind === 'claude' && adapter.project ? adapter.project(raw) : raw);
      } catch { issues.add(kind + ':resolve-failed'); continue; }
      if (!pub || pub.id !== id || found) { issues.add(kind + ':identity-conflict'); return null; }
      found = { kind, session: raw, publicSession: pub };
    }
    return found;
  }

  function resolveForControl(id, capability) {
    const target = resolve(id);
    return target && target.kind === 'claude' && capabilitiesFor('claude')[capability] === true ? target : null;
  }

  async function readConversation(id, limit = 120, childId = null) {
    const owner = resolve(id);
    if (!owner || !owner.publicSession.capabilities.readConversation) return [];
    const adapter = providers.get(owner.kind);
    if (typeof adapter.readConversation !== 'function') return [];
    const bounded = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 0), 120) : 120;
    if (!bounded) return [];
    const items = await adapter.readConversation(owner.session, bounded, childId);
    return Array.isArray(items) ? items.slice(-bounded) : [];
  }

  function start() {
    if (disposed) return Promise.reject(new Error('Agent registry disposed'));
    return startPromise ??= (async () => {
      for (const [kind, adapter] of providers) {
        try { await adapter.start?.(); } catch { issues.add(kind + ':start-failed'); }
      }
    })();
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await startPromise;
    for (const [kind, adapter] of providers) {
      try { await adapter.dispose?.(); } catch { issues.add(kind + ':dispose-failed'); }
    }
    providers.clear();
  }

  return { register, list, resolve, resolveForControl, readConversation, start, dispose, diagnostics: () => [...issues] };
}
