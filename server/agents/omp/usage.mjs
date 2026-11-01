// A replaceable per-entry ledger, never a global spend counter. No pricing defaults.
const numeric = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
export function usageRecord(raw) {
  const u = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { input: numeric(u.input), output: numeric(u.output), cacheRead: numeric(u.cacheRead),
    cacheWrite: numeric(u.cacheWrite), cost: numeric(u.cost?.total) };
}

function summarizeRows(rows, { inherited = false, incomplete = false, provenance = 'recorded' } = {}) {
  const sum = (key) => {
    if (incomplete || !rows.length || rows.some((u) => u[key] === null)) return null;
    const n = rows.reduce((a, u) => a + u[key], 0);
    return Number.isFinite(n) ? n : null;
  };
  const cost = sum('cost');
  return {
    cost: cost === null ? null : { value: cost, currency: 'USD', scope: inherited ? 'inherited' : 'self', provenance },
    tokens: {
      input: sum('input'),
      output: sum('output'),
      cacheRead: sum('cacheRead'),
      cacheWrite: sum('cacheWrite'),
      provenance: rows.length && !incomplete ? provenance : 'unknown',
    },
  };
}

const sortKeyLastUnknown = (a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b));

export function aggregateUsage(entries, { inherited = false, incomplete = false } = {}) {
  const usageEntries = [...entries].filter((e) => e && e.usage !== undefined);
  const rows = usageEntries.map((e) => e.usage);
  const totals = summarizeRows(rows, { inherited, incomplete, provenance: 'recorded' });

  const providerGroups = new Map();
  for (const entry of usageEntries) {
    const providerId = typeof entry.provider === 'string' && entry.provider ? entry.provider : 'unknown';
    const model = typeof entry.modelId === 'string' && entry.modelId
      ? entry.modelId
      : typeof entry.model === 'string' && entry.model ? entry.model : 'unknown';
    let pGroup = providerGroups.get(providerId);
    if (!pGroup) {
      pGroup = { rows: [], models: new Map() };
      providerGroups.set(providerId, pGroup);
    }
    pGroup.rows.push(entry.usage);
    const mRows = pGroup.models.get(model) || [];
    mRows.push(entry.usage);
    pGroup.models.set(model, mRows);
  }

  const byProvider = [...providerGroups.keys()]
    .sort(sortKeyLastUnknown)
    .map((providerId) => {
      const pGroup = providerGroups.get(providerId);
      const pTotals = summarizeRows(pGroup.rows, { inherited, incomplete, provenance: 'recorded' });
      const models = [...pGroup.models.keys()]
        .sort(sortKeyLastUnknown)
        .map((model) => {
          const mRows = pGroup.models.get(model);
          const mTotals = summarizeRows(mRows, { inherited, incomplete, provenance: 'recorded' });
          return {
            model,
            entries: mRows.length,
            cost: mTotals.cost,
            tokens: mTotals.tokens,
          };
        });
      return {
        providerId,
        accountKey: null,
        attribution: 'unattributed',
        entries: pGroup.rows.length,
        incomplete: Boolean(incomplete),
        cost: pTotals.cost,
        tokens: pTotals.tokens,
        models,
      };
    });

  return {
    ...totals,
    // Lifetime usage is not current context. Schema v3 does not guarantee a context window.
    context: null,
    byProvider,
  };
}

// Runtime token accounting is a snapshot, not an increment. File-normalized metrics always replace it.
export function provisionalUsage(raw, { provider = null, model = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tokens = {
    input: numeric(raw.input), output: numeric(raw.output),
    cacheRead: numeric(raw.cacheRead), cacheWrite: numeric(raw.cacheWrite),
  };
  const cost = numeric(raw.cost);
  if (cost === null && Object.values(tokens).every((n) => n === null)) return null;
  const costObj = cost === null ? null : { value: cost, currency: 'USD', scope: 'self', provenance: 'provisional' };
  const tokensObj = { ...tokens, provenance: 'provisional' };
  const providerId = typeof provider === 'string' && provider ? provider : 'unknown';
  const modelId = typeof model === 'string' && model ? model : null;
  const byProvider = [{
    providerId,
    accountKey: null,
    attribution: 'unattributed',
    entries: 1,
    incomplete: false,
    cost: costObj,
    tokens: tokensObj,
    models: modelId ? [{ model: modelId, entries: 1, cost: costObj, tokens: tokensObj }] : [],
  }];
  return {
    cost: costObj,
    tokens: tokensObj,
    context: null,
    byProvider,
  };
}
