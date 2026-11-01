// View-only semantic activity summary normalizer for OMP sessions (Phase 04 Live Agent Activity Bubbles).
// Never trusts thinking text, assistant replies, raw prompts, full paths, shell commands, URLs or credentials.

export const ACTIVITY_SUMMARY_KINDS = new Set([
  'read', 'edit', 'cmd', 'test', 'web', 'processing', 'waiting', 'idle', 'unknown',
]);
export const ACTIVITY_SUMMARY_SOURCES = new Set([
  'observerCategory', 'managedRpc', 'externalController',
]);
export const ACTIVITY_SUMMARY_TTL_MS = 45_000;
export const MAX_SAFE_SUBJECT_CHARS = 32;

const SAFE_SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const SECRET_LOOKING_RE = /(?:^|[._-])(?:env|secret|token|key|cred|passwd|password|auth|private|id_rsa|id_ed25519)(?:$|[._-])/i;
const PATH_SEP_RE = /[\\/]/;
const URL_SCHEME_RE = /^[a-z]+:/i;
const UUID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

const TOOL_NAME_KIND = new Map(Object.entries({
  read: 'read',
  grep: 'read',
  find: 'read',
  glob: 'read',
  ls: 'read',
  edit: 'edit',
  write: 'edit',
  ast_edit: 'edit',
  bash: 'cmd',
  web_search: 'web',
  fetch: 'web',
}));

const CATEGORY_KIND = new Map(Object.entries({
  read: 'read',
  edit: 'edit',
  cmd: 'cmd',
  test: 'test',
  web: 'web',
  other: 'processing',
}));

export function sanitizeSafeSubject(raw, { allowSubject = false } = {}) {
  if (!allowSubject || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_SUBJECT_CHARS) return null;
  if (PATH_SEP_RE.test(trimmed) || URL_SCHEME_RE.test(trimmed) || trimmed.includes('..')) return null;
  if (!SAFE_SUBJECT_RE.test(trimmed) || SECRET_LOOKING_RE.test(trimmed)) return null;
  return trimmed;
}

export function extractSafeBasename(rawPath, { allowSubject = false } = {}) {
  if (!allowSubject || typeof rawPath !== 'string' || !rawPath || rawPath.length > 512) return null;
  if (/[\u0000-\u001f\u007f]/.test(rawPath) || /^[a-z]{2,12}:\/\//i.test(rawPath)) return null;
  const clean = rawPath.split(/[?#]/)[0].replace(/:\d+(?:[-+,]\d+)*$/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  return sanitizeSafeSubject(last, { allowSubject: true });
}

export function classifyRpcToolExecution(toolName, args, { allowSubject = false } = {}) {
  const name = typeof toolName === 'string' ? toolName.trim() : '';
  let kind = TOOL_NAME_KIND.get(name) || 'processing';
  let safeSubject = null;
  if (name === 'bash' && args && typeof args === 'object' && typeof args.command === 'string') {
    const cmdLine = args.command.trim().slice(0, 240);
    if (/(?:^|\s)(?:npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|node\s+--test|playwright\s+test|vitest|jest|pytest|cargo\s+test|go\s+test)\b/i.test(cmdLine)) {
      kind = 'test';
    }
  } else if ((kind === 'read' || kind === 'edit') && allowSubject && args && typeof args === 'object') {
    const rawTarget = typeof args.path === 'string' ? args.path
      : typeof args.file_path === 'string' ? args.file_path : null;
    safeSubject = extractSafeBasename(rawTarget, { allowSubject: true });
  }
  return { kind, ...(safeSubject ? { safeSubject } : {}) };
}

export function normalizeActivitySummary(raw, {
  expectedRuntimeInstanceId = null,
  expectedGeneration = null,
  allowSubject = false,
  now = Date.now(),
  ttlMs = ACTIVITY_SUMMARY_TTL_MS,
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { kind, safeSubject, source, runtimeInstanceId, generation, eventSequence, observedAt } = raw;
  if (typeof kind !== 'string' || !ACTIVITY_SUMMARY_KINDS.has(kind)) return null;
  if (typeof source !== 'string' || !ACTIVITY_SUMMARY_SOURCES.has(source)) return null;
  if (typeof runtimeInstanceId !== 'string' || !UUID_ID.test(runtimeInstanceId)) return null;
  if (expectedRuntimeInstanceId !== null && runtimeInstanceId !== expectedRuntimeInstanceId) return null;
  if (!Number.isSafeInteger(generation) || generation < 0 || generation >= 1_000_000) return null;
  if (expectedGeneration !== null && generation !== expectedGeneration) return null;
  if (!Number.isSafeInteger(eventSequence) || eventSequence < 0) return null;
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt <= 0) return null;
  if (ttlMs > 0 && now - observedAt > ttlMs) return null;

  // Observer-only never carries file or test subjects.
  const canHaveSubject = allowSubject && (source === 'managedRpc' || source === 'externalController') &&
    (kind === 'read' || kind === 'edit' || kind === 'test');
  const subject = sanitizeSafeSubject(safeSubject, { allowSubject: canHaveSubject });

  return {
    kind,
    ...(subject ? { safeSubject: subject } : {}),
    source,
    runtimeInstanceId,
    generation,
    eventSequence,
    observedAt: Math.round(observedAt),
  };
}

// Compute the authoritative view-only activitySummary for a live OMP session record.
// Priority: waiting/approval > verified active tool > generic processing > idle > null (stale/disconnected/ended/gap/persisted).
export function deriveLiveActivitySummary(live, {
  allowSubject = false,
  now = Date.now(),
  ttlMs = ACTIVITY_SUMMARY_TTL_MS,
} = {}) {
  if (!live || typeof live !== 'object') return null;
  if (live.persistedOnly === true || live.lifecycle === 'ended' || live.connection !== 'connected' || live.gap === true || live.eventGap === true) {
    return null;
  }
  const runtimeInstanceId = typeof live.runtimeInstanceId === 'string' && UUID_ID.test(live.runtimeInstanceId)
    ? live.runtimeInstanceId : null;
  const generation = Number.isSafeInteger(live.generation) && live.generation >= 0 && live.generation < 1_000_000
    ? live.generation : null;
  if (!runtimeInstanceId || generation === null) return null;
  const observedAt = typeof live.observedAt === 'number' && Number.isFinite(live.observedAt) && live.observedAt > 0
    ? Math.round(live.observedAt) : now;
  const eventSequence = Number.isSafeInteger(live.sequence) && live.sequence >= 0
    ? live.sequence
    : Number.isSafeInteger(live.eventSequence) && live.eventSequence >= 0 ? live.eventSequence : 0;
  const source = ACTIVITY_SUMMARY_SOURCES.has(live.summarySource) ? live.summarySource : 'observerCategory';

  if (live.activity === 'waiting') {
    return {
      kind: 'waiting',
      source,
      runtimeInstanceId,
      generation,
      eventSequence,
      observedAt,
    };
  }

  if (live.activity === 'active') {
    if (live.activitySummary) {
      const explicit = normalizeActivitySummary(live.activitySummary, {
        expectedRuntimeInstanceId: runtimeInstanceId,
        expectedGeneration: generation,
        allowSubject,
        now,
        ttlMs,
      });
      if (explicit && explicit.kind !== 'idle' && explicit.kind !== 'unknown') return explicit;
    }
    const cat = Array.isArray(live.toolCategories) && live.toolCategories.length ? live.toolCategories[0] : null;
    const kind = cat && CATEGORY_KIND.has(cat) ? CATEGORY_KIND.get(cat) : 'processing';
    return {
      kind,
      source: 'observerCategory',
      runtimeInstanceId,
      generation,
      eventSequence,
      observedAt,
    };
  }

  if (live.activity === 'idle') {
    return {
      kind: 'idle',
      source,
      runtimeInstanceId,
      generation,
      eventSequence,
      observedAt,
    };
  }

  return null;
}
