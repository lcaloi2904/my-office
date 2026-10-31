// Server ownership rules. No OMP runtime, config or filesystem is imported here.
import { createHash } from 'node:crypto';

const CLAUDE_CAPABILITIES = Object.freeze({
  openWindow: true, closeSession: true, changeAccount: true,
  remoteControl: true, startTask: true, readConversation: true,
});
const READ_ONLY_CAPABILITIES = Object.freeze({
  openWindow: false, closeSession: false, changeAccount: false,
  remoteControl: false, startTask: false, readConversation: false,
});
const CONTROL_KEYS = new Set(Object.keys(CLAUDE_CAPABILITIES));
export const reservedAgentId = (id) => typeof id === 'string' && /^(?:omp|agent):/i.test(id);

export function resolveOmpMode(value) {
  return value === 'files' || value === 'hybrid' ? value : 'off';
}

// Old replay snapshots have neither field. Explicit unsupported providers fail closed.
export function agentKindOf(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return 'unknown';
  const raw = Object.hasOwn(session, 'agentKind') ? session.agentKind
    : Object.hasOwn(session, 'agent') ? session.agent : 'claude';
  if (raw === 'claude' && reservedAgentId(session.id)) return 'unknown';
  return raw === 'claude' || raw === 'omp' ? raw : 'unknown';
}

export function capabilitiesFor(kind) {
  return kind === 'claude' ? CLAUDE_CAPABILITIES : READ_ONLY_CAPABILITIES;
}

// OMP stays read-only; only the server's validated source config may open persisted conversation reads.
const OMP_CONVERSATION_CAPABILITIES = Object.freeze({ ...READ_ONLY_CAPABILITIES, readConversation: true });
export const ompCapabilities = (conversation) => conversation === true ? OMP_CONVERSATION_CAPABILITIES : READ_ONLY_CAPABILITIES;

export function hasClaudeCapability(session, capability) {
  if (!CONTROL_KEYS.has(capability) || agentKindOf(session) !== 'claude' || reservedAgentId(session.id)) return false;
  if (!Object.hasOwn(session, 'capabilities')) return !Object.hasOwn(session, 'agentKind');
  const supplied = session.capabilities;
  return !!supplied && typeof supplied === 'object' && Object.hasOwn(supplied, capability) && supplied[capability] === true;
}

const sourcePart = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 256 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

// Hash a structured tuple, not delimiter-concatenated IDs. Never expose profile/root strings.
export function ompSessionIdentity(sourceNamespace, sourceSessionId) {
  if (!sourcePart(sourceNamespace) || !sourcePart(sourceSessionId)) return null;
  const digest = createHash('sha256').update(JSON.stringify(['omp', sourceNamespace, sourceSessionId])).digest('hex');
  const id = 'omp:' + digest;
  return { id, sessionKey: id };
}

// Explicit new providers or public OMP IDs must never become Claude task targets.
export function isClaudeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (body.agentKind !== undefined && body.agentKind !== 'claude') return false;
  if (body.agent !== undefined && body.agent !== 'claude') return false;
  return ![body.id, body.sid, body.sessionKey].some(reservedAgentId);
}
