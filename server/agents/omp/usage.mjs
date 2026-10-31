// A replaceable per-entry ledger, never a global spend counter. No pricing defaults.
const numeric = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
export function usageRecord(raw) {
  const u = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { input: numeric(u.input), output: numeric(u.output), cacheRead: numeric(u.cacheRead),
    cacheWrite: numeric(u.cacheWrite), cost: numeric(u.cost?.total) };
}

export function aggregateUsage(entries, { inherited = false, incomplete = false } = {}) {
  const rows = [...entries].filter((e) => e.usage !== undefined).map((e) => e.usage);
  const sum = (key) => {
    if (incomplete || !rows.length || rows.some((u) => u[key] === null)) return null;
    const n = rows.reduce((a, u) => a + u[key], 0);
    return Number.isFinite(n) ? n : null;
  };
  const cost = sum('cost');
  return {
    cost: cost === null ? null : { value: cost, currency: 'USD', scope: inherited ? 'inherited' : 'self', provenance: 'recorded' },
    tokens: { input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), provenance: rows.length && !incomplete ? 'recorded' : 'unknown' },
    // Lifetime usage is not current context. Schema v3 does not guarantee a context window.
    context: null,
  };
}
