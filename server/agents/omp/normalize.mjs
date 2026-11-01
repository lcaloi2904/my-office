// Schema 3 at OMP 6a86df8539fccf3ad7818081266e554022fc21bc. Inert JSON only.
import { redact } from '../../redact.mjs';
import { ompSessionIdentity } from '../schema.mjs';
import { aggregateUsage, usageRecord, provisionalUsage } from './usage.mjs';

const idOf = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
const modelOf = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(v) ? v : null;
const providerOf = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v) ? v.toLowerCase() : null;
export function parseProviderModel(rawProvider, rawModel) {
  const explicit = providerOf(rawProvider);
  const m = modelOf(rawModel);
  if (explicit) {
    const prefix = explicit + '/';
    const bare = m && m.toLowerCase().startsWith(prefix) && m.length > prefix.length ? m.slice(prefix.length) : m;
    return { provider: explicit, model: m, modelId: bare };
  }
  if (m && m.includes('/')) {
    const slash = m.indexOf('/');
    const cand = providerOf(m.slice(0, slash));
    const rest = m.slice(slash + 1);
    if (cand && rest && !rest.includes('/')) {
      return { provider: cand, model: m, modelId: rest };
    }
  }
  return { provider: null, model: m, modelId: m };
}
const timestamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;
const contentText = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n') : '';
const safeText = (s) => redact(String(s)).slice(0, 4000).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
// Exact names only; custom/MCP and inherited Object prototype names remain neutral.
const TOOL_CATEGORIES = new Map(Object.entries({ read: 'read', edit: 'edit', write: 'edit', bash: 'cmd', grep: 'read', find: 'read', ls: 'read', task: 'task', ask: 'ask', web_search: 'web', fetch: 'web' }));
export const toolCategory = (name) => TOOL_CATEGORIES.get(name) || 'other';
const KNOWN = new Set(['message', 'model_usage', 'model_change', 'thinking_level_change', 'service_tier_change', 'compaction', 'branch_summary', 'reset_boundary', 'custom', 'label', 'title_change', 'ttsr_injection', 'credential_pin', 'session_init', 'mode_change', 'custom_message']);

export function createNormalizer({ sourceNamespace, includeContent = false, maxEntries = 4096, maxIndexBytes = 1024 * 1024 } = {}) {
  let header = null, rejected = false, titleSeen = false, leaf = null, lastSelf = null, bytes = 0, capped = false;
  const entries = new Map(), sizes = new Map(), diagnostics = new Set();
  // Non-aging membership prevents an evicted ID from rewinding the branch. Possible matches are explicitly uncertain.
  const membership = new Uint8Array(Math.min(64 * 1024, Math.floor(maxIndexBytes / 8)));
  const entryBudget = maxIndexBytes - membership.byteLength;
  let possibleDuplicate = false;
  function previouslySeen(id) {
    let first = 2166136261, second = 5381;
    for (let i = 0; i < id.length; i++) {
      const ch = id.charCodeAt(i); first = Math.imul(first ^ ch, 16777619); second = Math.imul(second, 33) ^ ch;
    }
    second |= 1;
    let seen = true;
    for (let i = 0; i < 4; i++) {
      const bit = ((first + Math.imul(i, second)) >>> 0) % (membership.length * 8), mask = 1 << (bit & 7), offset = bit >>> 3;
      if (!(membership[offset] & mask)) seen = false;
      membership[offset] |= mask;
    }
    return seen;
  }
  const issue = (code) => { if (diagnostics.size < 24) diagnostics.add(code); };
  function push(raw, location = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { issue('invalid-record'); return; }
    if (!header) {
      if (raw.type === 'title' && !rejected) {
        if (titleSeen || raw.v !== 1 || (location.offset !== undefined && location.offset !== 0) || (location.bytes !== undefined && location.bytes !== 256)) { rejected = true; issue('unsupported-title-slot'); }
        titleSeen = true;
        return;
      }
      if (rejected) return;
      if (raw.type !== 'session' || raw.version !== 3 || !ompSessionIdentity(sourceNamespace, raw.id)) { rejected = true; issue('unsupported-header'); return; }
      header = { id: raw.id, inherited: typeof raw.parentSession === 'string' || typeof raw.continuationOf === 'string',
        relationKind: typeof raw.continuationOf === 'string' ? 'continuation' : typeof raw.parentSession === 'string' ? 'fork' : 'unknown', timestamp: timestamp(raw.timestamp) };
      return;
    }
    if (raw.type === 'session' || raw.type === 'title') { issue('unexpected-header'); return; }
    const id = idOf(raw.id);
    if (!id) { issue('invalid-entry'); return; }
    const parentId = raw.parentId === null ? null : idOf(raw.parentId);
    if (raw.parentId !== null && !parentId) issue('invalid-parent');
    const selected = raw.activeLeafId === null ? null : raw.activeLeafId === undefined ? id : idOf(raw.activeLeafId);
    if (raw.activeLeafId !== undefined && raw.activeLeafId !== null && !selected) issue('invalid-leaf');
    const e = { id, parentId, selectedLeafId: selected, type: KNOWN.has(raw.type) ? raw.type : 'unknown', ts: timestamp(raw.timestamp) };
    if (e.type === 'unknown') issue('unknown-record');
    if (raw.type === 'custom' && raw.customType === 'session_exit') e.exitEvidence = true;
    if (raw.type === 'model_change' && (raw.role === undefined || raw.role === 'default')) {
      const pm = parseProviderModel(raw.provider, raw.model);
      e.model = pm.model; if (pm.provider) e.provider = pm.provider; if (pm.modelId) e.modelId = pm.modelId;
    }
    if (raw.type === 'model_usage') {
      const pm = parseProviderModel(raw.provider, raw.model);
      e.usage = usageRecord(raw.usage); e.model = pm.model; if (pm.provider) e.provider = pm.provider; if (pm.modelId) e.modelId = pm.modelId;
    }
    if (raw.type === 'compaction') { e.firstKeptEntryId = idOf(raw.firstKeptEntryId); if (includeContent) e.text = safeText(raw.summary || ''); }
    if (raw.type === 'branch_summary' && includeContent) e.text = safeText(raw.summary || '');
    if (raw.type === 'message') {
      const m = raw.message && typeof raw.message === 'object' ? raw.message : {};
      e.role = ['assistant', 'user', 'toolResult'].includes(m.role) ? m.role : 'unknown';
      if (m.role === 'assistant') {
        const pm = parseProviderModel(m.provider, m.model);
        e.usage = usageRecord(m.usage); e.model = pm.model; if (pm.provider) e.provider = pm.provider; if (pm.modelId) e.modelId = pm.modelId;
        const calls = (Array.isArray(m.content) ? m.content : []).filter((p) => p?.type === 'toolCall' && idOf(p.id));
        if (calls.length > 64) issue('tool-limit');
        e.calls = calls.slice(0, 64).map((p) => ({ id: p.id, category: toolCategory(p.name) }));
      }
      if (m.role === 'toolResult') { e.toolCallId = idOf(m.toolCallId); e.isError = m.isError === true; }
      // Conversation text only. No images, args, outputs, thinking, unknown roles, or custom payloads.
      if (includeContent && ['assistant', 'user'].includes(e.role)) e.text = safeText(contentText(m.content));
    }
    const previous = entries.get(id), serialized = JSON.stringify(e), size = Buffer.byteLength(serialized);
    if (previous) {
      if (JSON.stringify(previous) !== serialized) issue('conflicting-entry-id');
      return;
    }
    if (!membership.length) { capped = true; issue('index-limit'); return; }
    if (previouslySeen(id)) { possibleDuplicate = true; issue('possible-duplicate-entry-id'); return; }
    // Retransmitted IDs never move the leaf. A genuinely new capped leaf does: report incompleteness.
    leaf = selected;
    if (selected === id) lastSelf = id;
    // Past the cap the oldest entries are dropped, so the index keeps the tail that the active branch ends in. The
    // branch then starts mid-history and is reported incomplete, instead of losing the whole branch.
    if (size > entryBudget) { capped = true; issue('index-limit'); return; }
    while (entries.size && (entries.size >= maxEntries || bytes + size > entryBudget)) {
      const oldest = entries.keys().next().value;
      bytes -= sizes.get(oldest); sizes.delete(oldest); entries.delete(oldest);
      capped = true; issue('index-limit');
    }
    entries.set(id, e); sizes.set(id, size); bytes += size;
  }

  function value({ incomplete: inputIncomplete = false } = {}) {
    const issues = new Set(diagnostics);
    if (possibleDuplicate) issues.add('possible-duplicate-entry-id');
    let active = leaf;
    if (active !== null && !entries.has(active)) {
      if (capped) issues.add('missing-capped-leaf');
      else { active = lastSelf; issues.add('leaf-fallback'); }
    }
    const seen = new Set(), branch = [];
    while (active !== null) {
      if (seen.has(active)) { issues.add('branch-cycle'); break; }
      if (seen.size >= maxEntries) { issues.add('branch-depth-limit'); break; }
      const entry = entries.get(active);
      if (!entry) { issues.add('missing-parent'); break; }
      seen.add(active); branch.push(entry); active = entry.parentId;
    }
    branch.reverse();
    let selected = branch;
    const reset = selected.findLastIndex((e) => e.type === 'reset_boundary');
    if (reset >= 0) selected = selected.slice(reset);
    const compact = selected.findLastIndex((e) => e.type === 'compaction');
    if (compact >= 0) {
      const c = selected[compact], kept = selected.findIndex((e) => e.id === c.firstKeptEntryId);
      if (kept < 0 || kept > compact) { issues.add('compaction-incomplete'); selected = selected.slice(compact); }
      else selected = [c, ...selected.slice(kept, compact), ...selected.slice(compact + 1)];
    }
    const tools = new Map();
    for (const e of selected) {
      for (const call of e.calls || []) { const old = tools.get(call.id); tools.set(call.id, { ...call, phase: old?.phase || 'requested' }); }
      if (e.toolCallId) { const old = tools.get(e.toolCallId); tools.set(e.toolCallId, { id: e.toolCallId, category: old?.category || 'other', phase: e.isError ? 'error' : 'completed' }); }
    }
    const counts = { read: 0, edit: 0, cmd: 0, web: 0 };
    for (const tool of tools.values()) if (Object.hasOwn(counts, tool.category)) counts[tool.category]++;
    const incomplete = inputIncomplete || capped || [...issues].some((s) => !['unknown-record', 'leaf-fallback'].includes(s));
    const items = includeContent ? selected.flatMap((e) => {
      if (e.type === 'message' && ['user', 'assistant'].includes(e.role)) {
        const result = e.text ? [{ role: e.role, text: e.text, ts: e.ts }] : [];
        for (const call of e.calls || []) result.push({ role: 'tool', type: call.category, label: call.category,
          toolCallId: /^[A-Za-z0-9._-]{1,128}$/.test(call.id) ? call.id : null, phase: 'requested', ts: e.ts });
        return result;
      }
      if (e.type === 'message' && e.role === 'toolResult') return [{ role: 'toolResult', text: '',
        toolCallId: /^[A-Za-z0-9._-]{1,128}$/.test(e.toolCallId) ? e.toolCallId : null,
        phase: e.isError ? 'error' : 'completed', ts: e.ts }];
      if (['compaction', 'branch_summary', 'reset_boundary'].includes(e.type)) return [{ role: 'summary', kind: e.type, text: e.text || '', ts: e.ts }];
      return [];
    }) : [];
    return {
      sourceNamespace, sourceSessionId: header?.id || null, supported: !!header && !rejected,
      relationKind: header?.relationKind || 'unknown', persistedOnly: true, lifecycle: 'historical',
      model: branch.findLast((e) => e.model && ['message', 'model_change'].includes(e.type))?.model || null,
      provider: branch.findLast((e) => e.provider && ['message', 'model_change', 'model_usage'].includes(e.type))?.provider || null,
      observedAt: branch.at(-1)?.ts || header?.timestamp || 0, counts,
      metrics: aggregateUsage(entries.values(), { inherited: header?.inherited, incomplete }),
      items, tools: [...tools.values()], incomplete, diagnostics: [...issues],
      exitEvidence: [...entries.values()].some((e) => e.exitEvidence === true), indexEntries: entries.size, indexBytes: bytes + membership.byteLength,
    };
  }
  return { push, value };
}

// Strict ingress v1 allowlist. Unknown producer fields are never kept, logged or projected.
const LIVE_TYPES = new Set(['snapshot', 'session_start', 'session_end', 'heartbeat', 'turn_start', 'turn_end',
  'tool_start', 'tool_end', 'approval_requested', 'approval_resolved', 'input_requested', 'input_resolved']);
const LIVE_CATEGORIES = new Set(['read', 'edit', 'cmd', 'web', 'other']);
const boundedId = (s, max = 128) => typeof s === 'string' && s.length > 0 && s.length <= max
  && !/[\u0000-\u001f\u007f]/.test(s);
const boundedInteger = (n) => Number.isSafeInteger(n) && n >= 0 ? n : null;
const liveCategory = (s) => LIVE_CATEGORIES.has(s) ? s : 'other';
const safeLiveModel = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(s) ? s : null;

export function normalizeOmpLiveEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1 ||
    typeof raw.sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(raw.sourceId) ||
    !boundedId(raw.sessionId, 256) || !boundedId(raw.runtimeInstanceId, 96) ||
    !Number.isSafeInteger(raw.generation) || raw.generation < 1 ||
    !Number.isSafeInteger(raw.sequence) || raw.sequence < 1 || !LIVE_TYPES.has(raw.type)) return null;
  const d = raw.data;
  if (d != null && (typeof d !== 'object' || Array.isArray(d))) return null;
  const data = {};
  if (['snapshot', 'session_start', 'heartbeat'].includes(raw.type)) {
    data.isIdle = typeof d?.isIdle === 'boolean' ? d.isIdle : null;
    data.pendingMessages = boundedInteger(d?.pendingMessages);
    data.pendingJobs = boundedInteger(d?.pendingJobs);
    const pm = parseProviderModel(d?.provider, d?.model);
    data.model = safeLiveModel(d?.model);
    if (pm.provider) data.provider = pm.provider;
    data.metrics = provisionalUsage(d?.usage, { provider: pm.provider, model: pm.modelId || data.model });
    if (raw.type !== 'heartbeat') {
      data.waitReasons = Array.isArray(d?.waitReasons) ? d.waitReasons.filter((x) => x === 'approval' || x === 'input').slice(0, 24) : [];
      data.tools = Array.isArray(d?.tools) ? d.tools.slice(0, 96).filter((x) => boundedId(x?.id))
        .map((x) => ({ id: x.id, category: liveCategory(x.category) })) : [];
    }
  }
  if (raw.type === 'tool_start' || raw.type === 'tool_end') {
    if (!boundedId(d?.toolCallId)) return null;
    data.toolCallId = d.toolCallId;
    data.category = liveCategory(d?.category);
    if (raw.type === 'tool_end') data.phase = ['completed', 'error', 'aborted'].includes(d?.phase) ? d.phase : 'completed';
  }
  if (['approval_requested', 'approval_resolved', 'input_requested', 'input_resolved'].includes(raw.type)) {
    if (!boundedId(d?.requestId)) return null;
    data.requestId = d.requestId;
  }
  if (raw.type === 'turn_end') data.outcome = ['success', 'error', 'aborted'].includes(d?.outcome) ? d.outcome : 'unknown';
  return { version: 1, sourceId: raw.sourceId, sessionId: raw.sessionId,
    runtimeInstanceId: raw.runtimeInstanceId, generation: raw.generation,
    sequence: raw.sequence, type: raw.type, data };
}
