// Validation and rate/dedup schemas for Phase 04 managed OMP RPC commands.
// Browser callers never supply file paths, PIDs, CLI argv or raw provider tool commands.

const PUBLIC_ID = /^omp:[0-9a-f]{64}$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQ_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;
const KINDS = new Set(['prompt', 'steer', 'followUp', 'abort', 'queueRemove']);
const TEXT_KINDS = new Set(['prompt', 'steer', 'followUp', 'queueRemove']);
const QUEUE_KINDS = new Set(['steering', 'followUp']);
const DISALLOWED_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SURROGATE_LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const MAX_COMMAND_BYTES = 16 * 1024;
export const MAX_COMMAND_CHARS = 8000;
export const DEDUP_TTL_MS = 10 * 60 * 1000;
export const MAX_DEDUP_PER_SESSION = 64;
export const RATE_WINDOW_MS = 10 * 1000;
export const MAX_COMMANDS_PER_WINDOW = 12;

const ownKeys = (v, allowed) => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k));

export function validateOmpCommandText(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'COMMAND_TEXT_INVALID' };
  if (SURROGATE_LONE.test(raw) || DISALLOWED_CHARS.test(raw)) return { ok: false, code: 'COMMAND_TEXT_INVALID' };
  const normalized = raw.replace(/\r\n?/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) return { ok: false, code: 'COMMAND_TEXT_EMPTY' };
  if (normalized.length > MAX_COMMAND_CHARS || Buffer.byteLength(normalized, 'utf8') > MAX_COMMAND_BYTES) {
    return { ok: false, code: 'COMMAND_TEXT_LIMIT' };
  }
  return { ok: true, text: normalized };
}

export function validateOmpCommandPayload(raw) {
  if (!ownKeys(raw, ['id', 'runtimeInstanceId', 'generation', 'requestId', 'kind', 'text', 'queue'])) {
    return { ok: false, code: 'COMMAND_INVALID' };
  }
  const { id, runtimeInstanceId, generation, requestId, kind, text, queue } = raw;
  if (typeof id !== 'string' || !PUBLIC_ID.test(id)) {
    return { ok: false, code: typeof id === 'string' && id && !id.startsWith('omp:') ? 'COMMAND_FOREIGN_SESSION' : 'COMMAND_INVALID_SESSION' };
  }
  if (typeof runtimeInstanceId !== 'string' || !UUID_ID.test(runtimeInstanceId)) {
    return { ok: false, code: 'COMMAND_INVALID_RUNTIME' };
  }
  if (!Number.isSafeInteger(generation) || generation <= 0 || generation >= 1_000_000) {
    return { ok: false, code: 'COMMAND_INVALID_GENERATION' };
  }
  if (typeof requestId !== 'string' || !REQ_ID.test(requestId)) {
    return { ok: false, code: 'COMMAND_INVALID_REQUEST_ID' };
  }
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    return { ok: false, code: 'COMMAND_INVALID_KIND' };
  }
  if (kind === 'abort') {
    if (text !== undefined || queue !== undefined) return { ok: false, code: 'COMMAND_INVALID' };
    return { ok: true, command: { id, runtimeInstanceId, generation, requestId, kind } };
  }
  if (!TEXT_KINDS.has(kind)) return { ok: false, code: 'COMMAND_INVALID_KIND' };
  const validText = validateOmpCommandText(text);
  if (!validText.ok) return validText;
  if (kind === 'queueRemove') {
    if (typeof queue !== 'string' || !QUEUE_KINDS.has(queue)) return { ok: false, code: 'COMMAND_INVALID_QUEUE' };
    return { ok: true, command: { id, runtimeInstanceId, generation, requestId, kind, text: validText.text, queue } };
  }
  if (queue !== undefined) return { ok: false, code: 'COMMAND_INVALID' };
  return { ok: true, command: { id, runtimeInstanceId, generation, requestId, kind, text: validText.text } };
}

export function canAcceptCommandInState(kind, runtimeState) {
  if (!runtimeState || typeof runtimeState !== 'object') return { ok: false, code: 'COMMAND_UNAVAILABLE' };
  if (runtimeState.officeReadOnly === true) return { ok: false, code: 'COMMAND_READ_ONLY' };
  if (runtimeState.connection !== 'connected' || runtimeState.lifecycle === 'ended') {
    return { ok: false, code: 'COMMAND_DISCONNECTED' };
  }
  const busy = runtimeState.activity === 'active' || runtimeState.activity === 'waiting' || runtimeState.isStreaming === true;
  if (kind === 'prompt') {
    if (busy) return { ok: false, code: 'COMMAND_SESSION_BUSY' };
    return { ok: true };
  }
  if (kind === 'steer' || kind === 'followUp') {
    if (!busy) return { ok: false, code: 'COMMAND_SESSION_IDLE' };
    return { ok: true };
  }
  if (kind === 'abort') {
    if (!busy && !(runtimeState.queuedCount > 0)) return { ok: false, code: 'COMMAND_NOTHING_TO_ABORT' };
    return { ok: true };
  }
  if (kind === 'queueRemove') {
    if (!(runtimeState.queuedCount > 0)) return { ok: false, code: 'COMMAND_QUEUE_EMPTY' };
    return { ok: true };
  }
  return { ok: false, code: 'COMMAND_INVALID_KIND' };
}
