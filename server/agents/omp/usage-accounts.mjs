// Typed runtime normalization + local account labels for OMP multi-account usage.
// Read-only projection of `omp usage --json --no-extensions`. Never reads auth DB or exposes credentials.
import crypto from 'node:crypto';
import { redact } from '../../redact.mjs';

export const SUPPORTED_USAGE_PROVIDERS = Object.freeze(['openai-codex', 'google-antigravity']);
const PROVIDER_SET = new Set(SUPPORTED_USAGE_PROVIDERS);
export const MAX_ACCOUNTS = 64;
export const MAX_WINDOWS_PER_ACCOUNT = 16;
const MAX_PLAUSIBLE_RESET_HORIZON_MS = 366 * 86_400_000;
const MIN_EPOCH_MS = 1_000_000_000_000;
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WINDOWS_RESERVED_RE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

const cleanString = (v, max = 128) => {
  if (typeof v !== 'string') return '';
  const s = redact(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return s ? s.slice(0, max) : '';
};

const finiteNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampPercent = (v) => {
  const n = finiteNumber(v);
  if (n === null) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
};

/**
 * Validate and normalize an OMP profile name using OMP's exact rules (`packages/utils/src/dirs.ts`).
 * Returns `{ valid: true, profile: 'default' | <name>, cliProfile: null | <name> }` or `{ valid: false, profile: null, cliProfile: null }`.
 */
export function normalizeOmpProfile(raw) {
  if (raw === undefined || raw === null) return { valid: true, profile: 'default', cliProfile: null };
  if (typeof raw !== 'string') return { valid: false, profile: null, cliProfile: null };
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'default') return { valid: true, profile: 'default', cliProfile: null };
  if (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.endsWith('.') ||
    !PROFILE_NAME_RE.test(trimmed) ||
    WINDOWS_RESERVED_RE.test(trimmed)
  ) {
    return { valid: false, profile: null, cliProfile: null };
  }
  return { valid: true, profile: trimmed, cliProfile: trimmed };
}

/**
 * Create a keyed HMAC account-key generator so public accountKeys are opaque,
 * non-guessable by dictionary attack, and stable within a server lifetime.
 */
export function createAccountKeyer({ secret = crypto.randomBytes(32) } = {}) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'utf8');
  return function deriveAccountKey(profileNamespace, providerId, identityTuple) {
    const payload = JSON.stringify([
      'omp-acct-v1',
      String(profileNamespace || 'default'),
      String(providerId || ''),
      identityTuple.email || '',
      identityTuple.accountId || '',
      identityTuple.orgId || '',
      identityTuple.projectId || '',
      identityTuple.enterpriseUrl || '',
      identityTuple.anonymousSlot ?? '',
    ]);
    const digest = crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 32);
    return `omp-acct:${digest}`;
  };
}

function extractReportIdentity(report) {
  const meta = report?.metadata && typeof report.metadata === 'object' && !Array.isArray(report.metadata) ? report.metadata : {};
  const limits = Array.isArray(report?.limits) ? report.limits : [];
  const firstScoped = (key) => {
    for (const l of limits) {
      const v = l?.scope?.[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const email = cleanString(meta.email, 128).toLowerCase();
  const accountId = cleanString(meta.accountId || firstScoped('accountId'), 128);
  const orgId = cleanString(meta.orgId || firstScoped('orgId'), 128);
  const orgName = cleanString(meta.orgName, 80);
  const projectId = cleanString(meta.projectId || firstScoped('projectId'), 128);
  const enterpriseUrl = cleanString(meta.enterpriseUrl, 128).toLowerCase();
  const planType = cleanString(meta.planType, 40).toLowerCase();
  const hasIdentity = Boolean(email || accountId || orgId || projectId || enterpriseUrl);
  return { email, accountId, orgId, orgName, projectId, enterpriseUrl, planType, hasIdentity };
}

function extractAccountRowIdentity(row) {
  const r = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const email = cleanString(r.email, 128).toLowerCase();
  const accountId = cleanString(r.accountId, 128);
  const orgId = cleanString(r.orgId, 128);
  const orgName = cleanString(r.orgName, 80);
  const projectId = cleanString(r.projectId, 128);
  const enterpriseUrl = cleanString(r.enterpriseUrl, 128).toLowerCase();
  const hasIdentity = Boolean(email || accountId || orgId || projectId || enterpriseUrl);
  return { email, accountId, orgId, orgName, projectId, enterpriseUrl, planType: '', hasIdentity };
}

function identityMatches(a, b) {
  if (!a.hasIdentity || !b.hasIdentity) return false;
  // A shared email does not identify the same account when CLI workspace/account IDs disagree.
  for (const field of ['accountId', 'projectId', 'enterpriseUrl']) {
    if (a[field] && b[field] && a[field].toLowerCase() !== b[field].toLowerCase()) return false;
  }
  if (a.orgId || b.orgId) {
    if (a.orgId.toLowerCase() !== b.orgId.toLowerCase()) return false;
    if (!a.email && !a.accountId && !a.projectId) return true;
  }
  if (a.email && b.email) return a.email === b.email;
  if (a.accountId && b.accountId && a.accountId.toLowerCase() === b.accountId.toLowerCase()) return true;
  if (a.projectId && b.projectId && a.projectId.toLowerCase() === b.projectId.toLowerCase()) return true;
  return false;
}

function classifyWindowKind(providerId, limit, windowObj, amountObj) {
  const windowId = cleanString(windowObj?.id || limit?.scope?.windowId || '', 32).toLowerCase();
  const durationMs = finiteNumber(windowObj?.durationMs);
  if (amountObj?.unit === 'credits' || limit?.scope?.tier === 'credits' || windowId === 'spend-cap') return 'credits';
  if (windowId === '5h' || (durationMs !== null && Math.abs(durationMs - 5 * 3_600_000) <= 60_000)) return '5h';
  if (windowId === '7d' || windowId === 'weekly' || (durationMs !== null && Math.abs(durationMs - 7 * 86_400_000) <= 60_000)) return 'weekly';
  if (windowId === 'daily' || windowId === '24h' || (durationMs !== null && Math.abs(durationMs - 86_400_000) <= 60_000)) return 'daily';
  if (limit?.scope?.tier || limit?.scope?.modelId || providerId === 'google-antigravity') return 'model';
  return 'other';
}

function formatWindowLabel(limit, windowObj) {
  const baseLabel = cleanString(limit?.label || windowObj?.label || limit?.id || 'Quota', 64);
  const tier = cleanString(limit?.scope?.tier || '', 32);
  let label = baseLabel;
  if (tier && tier !== 'default' && tier !== 'credits' && !label.toLowerCase().includes(tier.toLowerCase())) {
    label = `${label} (${tier})`;
  }
  const winLabel = cleanString(windowObj?.label || limit?.scope?.windowId || '', 32);
  if (winLabel && winLabel.toLowerCase() !== 'quota window' && winLabel.toLowerCase() !== 'default' && !label.toLowerCase().includes(winLabel.toLowerCase())) {
    label = `${label} · ${winLabel}`;
  }
  return label.slice(0, 80);
}

/**
 * Normalize a single OMP `UsageLimit` into a `UsageWindow`.
 * Preserves source units; derives `usedPercent` / `remainingPercent` ONLY when certified (0..100%).
 * Never fabricates 0 for unknown/unbounded counters.
 */
export function normalizeUsageWindow(providerId, rawLimit, { nowMs = Date.now() } = {}) {
  if (!rawLimit || typeof rawLimit !== 'object' || Array.isArray(rawLimit)) return null;
  const id = cleanString(rawLimit.id, 96);
  if (!id) return null;
  const windowObj = rawLimit.window && typeof rawLimit.window === 'object' && !Array.isArray(rawLimit.window) ? rawLimit.window : {};
  const amountObj = rawLimit.amount && typeof rawLimit.amount === 'object' && !Array.isArray(rawLimit.amount) ? rawLimit.amount : {};
  const unit = cleanString(amountObj.unit, 24) || 'unknown';

  const rawUsedFrac = finiteNumber(amountObj.usedFraction);
  const rawRemFrac = finiteNumber(amountObj.remainingFraction);
  const rawUsed = finiteNumber(amountObj.used);
  const rawLimitVal = finiteNumber(amountObj.limit);
  const rawRem = finiteNumber(amountObj.remaining);

  let usedPercent = null;
  let remainingPercent = null;
  let sourceUnit = 'unknown';

  const hasValidUsedFrac = rawUsedFrac !== null && rawUsedFrac >= 0 && rawUsedFrac <= 1.0001;
  const hasValidRemFrac = rawRemFrac !== null && rawRemFrac >= 0 && rawRemFrac <= 1.0001;
  const hasPercentUsed = unit === 'percent' && rawUsed !== null && rawUsed >= 0 && rawUsed <= 100.01;
  const hasPercentRem = unit === 'percent' && rawRem !== null && rawRem >= 0 && rawRem <= 100.01;
  const hasRatio = rawUsed !== null && rawLimitVal !== null && rawLimitVal > 0 && rawUsed >= 0;

  if (providerId === 'google-antigravity' && (hasValidRemFrac || hasPercentRem)) {
    sourceUnit = 'remaining';
    remainingPercent = clampPercent(hasValidRemFrac ? rawRemFrac * 100 : rawRem);
    usedPercent = hasValidUsedFrac
      ? clampPercent(rawUsedFrac * 100)
      : remainingPercent !== null ? clampPercent(100 - remainingPercent) : null;
  } else if (hasValidUsedFrac || hasPercentUsed || hasRatio) {
    sourceUnit = 'used';
    const pct = hasValidUsedFrac
      ? rawUsedFrac * 100
      : hasPercentUsed
        ? rawUsed
        : (rawUsed / rawLimitVal) * 100;
    usedPercent = clampPercent(pct);
    remainingPercent = hasValidRemFrac
      ? clampPercent(rawRemFrac * 100)
      : hasPercentRem
        ? clampPercent(rawRem)
        : usedPercent !== null ? clampPercent(100 - usedPercent) : null;
  } else if (hasValidRemFrac || hasPercentRem) {
    sourceUnit = 'remaining';
    remainingPercent = clampPercent(hasValidRemFrac ? rawRemFrac * 100 : rawRem);
    usedPercent = clampPercent(100 - remainingPercent);
  }

  const rawResetsAt = finiteNumber(windowObj.resetsAt);
  const resetsAt =
    rawResetsAt !== null &&
    Number.isSafeInteger(Math.trunc(rawResetsAt)) &&
    rawResetsAt >= MIN_EPOCH_MS &&
    rawResetsAt <= nowMs + MAX_PLAUSIBLE_RESET_HORIZON_MS
      ? Math.trunc(rawResetsAt)
      : null;

  const rawStatus = cleanString(rawLimit.status, 24);
  const status = ['ok', 'warning', 'exhausted', 'unknown'].includes(rawStatus)
    ? rawStatus
    : usedPercent !== null
      ? usedPercent >= 100 ? 'exhausted' : usedPercent >= 80 ? 'warning' : 'ok'
      : 'unknown';

  return {
    id,
    label: formatWindowLabel(rawLimit, windowObj),
    kind: classifyWindowKind(providerId, rawLimit, windowObj, amountObj),
    usedPercent,
    remainingPercent,
    resetsAt,
    sourceUnit,
    status,
  };
}

/**
 * Collapse duplicate shared-group limits within a single account report (e.g. Antigravity
 * `Claude & GPT (shared)` reported once under `anthropic` and once under `openai`).
 */
function deduplicateReportLimits(limits) {
  if (!Array.isArray(limits)) return [];
  const out = [];
  const sharedIndex = new Map();
  for (const limit of limits) {
    if (!limit || typeof limit !== 'object') continue;
    const sharedGroup = cleanString(limit.scope?.sharedGroup, 64);
    const windowKey = cleanString(limit.window?.id || limit.scope?.windowId || '', 32);
    if (!sharedGroup) {
      out.push(limit);
      continue;
    }
    const key = `${sharedGroup}|${windowKey}`;
    if (!sharedIndex.has(key)) {
      sharedIndex.set(key, out.length);
      out.push(limit);
      continue;
    }
    const idx = sharedIndex.get(key);
    const prev = out[idx];
    const prevUsed = finiteNumber(prev?.amount?.usedFraction) ?? (finiteNumber(prev?.amount?.remainingFraction) !== null ? 1 - prev.amount.remainingFraction : -1);
    const nextUsed = finiteNumber(limit?.amount?.usedFraction) ?? (finiteNumber(limit?.amount?.remainingFraction) !== null ? 1 - limit.amount.remainingFraction : -1);
    if (nextUsed > prevUsed) out[idx] = limit;
  }
  return out;
}

function buildAccountLabel(providerId, identity, peerIdentities, fallbackIndex) {
  const base = identity.email || identity.accountId || identity.projectId || identity.enterpriseUrl || identity.orgName || identity.orgId;
  const providerPrefix = providerId === 'openai-codex' ? 'Codex' : 'Antigravity';
  const parts = [base || `${providerPrefix} #${fallbackIndex + 1}`];
  const hasPart = (value) => {
    const norm = String(value || '').trim().toLowerCase();
    return !norm || parts.some((p) => String(p).trim().toLowerCase() === norm);
  };
  const organization = identity.orgName || identity.orgId;
  if (organization && !hasPart(organization)) parts.push(organization);

  if (base) {
    let peers = peerIdentities.filter(
      (p) => p !== identity &&
        (p.email || p.accountId || p.projectId || p.enterpriseUrl || p.orgName || p.orgId) === base &&
        (p.orgName || p.orgId) === organization
    );
    // Display the distinguishing workspace/account ID only when email + organization collide.
    for (const field of ['orgId', 'accountId', 'projectId', 'enterpriseUrl']) {
      const value = identity[field];
      if (!value || hasPart(value) || !peers.some((p) => p[field] !== value)) continue;
      parts.push(value);
      peers = peers.filter((p) => p[field] === value);
    }
    if (peers.length > 0) parts.push(`#${fallbackIndex + 1}`);
  }
  if (identity.planType && !hasPart(identity.planType)) parts.push(identity.planType);
  // Each allowlisted field is bounded at extraction; do not truncate the assembled email/org label.
  return parts.join(' · ');
}

/**
 * Normalize raw JSON output from `omp usage --json --no-extensions` into
 * allowlisted `OmpAccountUsage[]` records with full local labels for supported providers.
 */
export function normalizeOmpUsagePayload(rawPayload, {
  profileNamespace = 'default',
  source = 'omp-cli',
  nowMs = Date.now(),
  keyer = createAccountKeyer(),
} = {}) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { ok: false, errorCode: 'invalid-json', accounts: [], generatedAt: null };
  }
  const rawReports = Array.isArray(rawPayload.reports) ? rawPayload.reports : null;
  const rawUnreported = Array.isArray(rawPayload.accountsWithoutUsage) ? rawPayload.accountsWithoutUsage : [];
  const rawDisabled = Array.isArray(rawPayload.disabledCredentials) ? rawPayload.disabledCredentials : [];
  if (!rawReports) {
    return { ok: false, errorCode: 'invalid-json', accounts: [], generatedAt: null };
  }

  const generatedAt = finiteNumber(rawPayload.generatedAt) ?? nowMs;
  const entries = [];

  for (const report of rawReports) {
    if (!report || typeof report !== 'object' || !PROVIDER_SET.has(report.provider)) continue;
    const identity = extractReportIdentity(report);
    const fetchedAt = finiteNumber(report.fetchedAt);
    const observedAt = fetchedAt !== null && fetchedAt > 0 ? Math.trunc(fetchedAt) : generatedAt;
    const dedupedLimits = deduplicateReportLimits(report.limits).slice(0, MAX_WINDOWS_PER_ACCOUNT);
    const windows = dedupedLimits
      .map((l) => normalizeUsageWindow(report.provider, l, { nowMs }))
      .filter(Boolean);
    const availability = windows.length > 0 ? 'ready' : 'unsupported';
    const noteCode = windows.length > 0 ? (identity.hasIdentity ? undefined : 'identity-missing') : 'no-limits-reported';
    entries.push({
      kind: 'report',
      providerId: report.provider,
      identity,
      windows,
      availability,
      observedAt,
      lastSuccessAt: observedAt,
      noteCode,
    });
    if (entries.length >= MAX_ACCOUNTS) break;
  }

  for (const row of rawUnreported) {
    if (entries.length >= MAX_ACCOUNTS) break;
    if (!row || typeof row !== 'object' || !PROVIDER_SET.has(row.provider)) continue;
    if (row.type && row.type !== 'oauth') continue;
    const identity = extractAccountRowIdentity(row);
    const alreadyCovered = entries.some(
      (e) => e.providerId === row.provider && identityMatches(e.identity, identity)
    );
    if (alreadyCovered) continue;
    entries.push({
      kind: 'unreported',
      providerId: row.provider,
      identity,
      windows: [],
      availability: 'unavailable',
      observedAt: generatedAt,
      lastSuccessAt: null,
      noteCode: 'no-usage-data',
    });
  }

  for (const row of rawDisabled) {
    if (entries.length >= MAX_ACCOUNTS) break;
    if (!row || typeof row !== 'object' || !PROVIDER_SET.has(row.provider)) continue;
    if (row.type && row.type !== 'oauth') continue;
    if (typeof row.cause === 'string' && /^(?:replaced by|deleted by user)/i.test(row.cause)) continue;
    const identity = extractAccountRowIdentity(row);
    const alreadyCovered = entries.some(
      (e) => e.providerId === row.provider && identityMatches(e.identity, identity)
    );
    if (alreadyCovered) continue;
    entries.push({
      kind: 'disabled',
      providerId: row.provider,
      identity,
      windows: [],
      availability: 'auth-error',
      observedAt: finiteNumber(row.disabledAtMs) ?? generatedAt,
      lastSuccessAt: null,
      noteCode: 'oauth-disabled',
    });
  }

  const byProviderIndex = new Map();
  const byProviderPeers = new Map();
  for (const e of entries) {
    const list = byProviderPeers.get(e.providerId) || [];
    list.push(e.identity);
    byProviderPeers.set(e.providerId, list);
  }

  const accounts = entries.map((e) => {
    const idx = byProviderIndex.get(e.providerId) || 0;
    byProviderIndex.set(e.providerId, idx + 1);
    const peers = byProviderPeers.get(e.providerId) || [];
    const accountKey = keyer(profileNamespace, e.providerId, {
      ...e.identity,
      anonymousSlot: e.identity.hasIdentity ? '' : String(idx),
    });
    const label = buildAccountLabel(e.providerId, e.identity, peers, idx);
    return {
      accountKey,
      providerId: e.providerId,
      label,
      windows: e.windows,
      availability: e.availability,
      observedAt: e.observedAt,
      lastSuccessAt: e.lastSuccessAt,
      source: source === 'omp-broker' ? 'omp-broker' : 'omp-cli',
      ...(e.noteCode ? { noteCode: e.noteCode } : {}),
    };
  });

  return { ok: true, errorCode: null, accounts, generatedAt };
}

/**
 * Project an OMP account usage snapshot for local vs remote/mobile clients.
 * Remote clients receive generic provider/index aliases; full account identity stays local-only.
 */
export function projectOmpUsageSnapshot(snapshot, { local = true } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { version: 1, enabled: false, state: 'disabled', profile: null, accounts: [], collector: { observedAt: null, lastSuccessAt: null, noteCode: null }, issues: [] };
  }
  if (local) return snapshot;
  const counts = new Map();
  const accounts = (Array.isArray(snapshot.accounts) ? snapshot.accounts : []).map((acct) => {
    const idx = (counts.get(acct.providerId) || 0) + 1;
    counts.set(acct.providerId, idx);
    const prefix = acct.providerId === 'openai-codex' ? 'Codex' : 'Antigravity';
    return {
      ...acct,
      label: `${prefix} #${idx}`,
    };
  });
  return {
    ...snapshot,
    profile: snapshot.profile ? 'configured' : null,
    accounts,
  };
}
