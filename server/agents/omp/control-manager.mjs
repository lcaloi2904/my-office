// Server-owned managed OMP sessions. Phase 03: launch/resume; Phase 04: interactive RPC commands, queue & activity summary.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ompSessionIdentity } from '../schema.mjs';
import { createOmpRpcHost, childEnvironment } from './rpc-host.mjs';
import {
  validateOmpCommandPayload,
  canAcceptCommandInState,
  DEDUP_TTL_MS,
  MAX_DEDUP_PER_SESSION,
  RATE_WINDOW_MS,
  MAX_COMMANDS_PER_WINDOW,
} from './command-schema.mjs';
import { classifyRpcToolExecution, deriveLiveActivitySummary } from './activity-summary.mjs';

const fault = (code) => Object.assign(new Error(code), { code });
const MAX_MANAGED = 8;
const MAX_PENDING_TOOLS = 64;
const MAX_QUEUE_CHIPS = 8;
const MAX_QUEUE_TEXT = 120;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sessionIdValid = (s) => typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\u0000-\u001f\u007f]/.test(s);
const safeId = (s, max = 128) => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
const cleanChip = (s) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUEUE_TEXT) : '';

const sanitizeQueued = (raw) => {
  if (!raw || typeof raw !== 'object') return { steering: [], followUp: [], liveSteered: 0, count: 0 };
  const steering = Array.isArray(raw.steering) ? raw.steering.map(cleanChip).filter(Boolean).slice(0, MAX_QUEUE_CHIPS) : [];
  const followUp = Array.isArray(raw.followUp) ? raw.followUp.map(cleanChip).filter(Boolean).slice(0, MAX_QUEUE_CHIPS) : [];
  const liveSteered = Number.isSafeInteger(raw.liveSteered) && raw.liveSteered >= 0 ? Math.min(raw.liveSteered, MAX_QUEUE_CHIPS) : 0;
  return { steering, followUp, liveSteered, count: steering.length + followUp.length };
};

const omit = (s) => ({
  id: s.id,
  projectAlias: s.projectAlias,
  profileAlias: s.profileAlias,
  runtimeInstanceId: s.runtimeInstanceId,
  generation: s.generation,
  state: s.state,
  officeReadOnly: s.officeReadOnly === true,
});

const accepted = (state) => state && typeof state === 'object' &&
  sessionIdValid(state.sessionId) && Number.isSafeInteger(state.messageCount) &&
  state.messageCount >= 0 && state.isStreaming === false && state.isSettled === true;

export function createOmpControlManager({
  resolver,
  adapter,
  hostFactory = createOmpRpcHost,
  platform = process.platform,
  controlEnabled = false,
  allowActivitySubject = false,
  now = Date.now,
  onChange = () => {},
} = {}) {
  if (!resolver || !adapter || typeof adapter.setManaged !== 'function' || typeof adapter.removeManaged !== 'function') {
    throw fault('LAUNCH_INVALID');
  }
  let disposed = false, generation = 0;
  const owned = new Map(), busy = new Set(), inFlight = new Set(), reservations = new Set();
  const notify = (id) => { try { onChange(id); } catch { /* UI listeners cannot alter session ownership */ } };

  const computeControlSnapshot = (s) => {
    const canAct = !disposed && platform === 'win32' && controlEnabled === true &&
      s.connection === 'connected' && s.lifecycle === 'open' && s.officeReadOnly !== true &&
      s.rpc?.isReady?.() === true;
    const isBusy = s.activity === 'active' || s.activity === 'waiting' || s.isStreaming === true;
    const queuedCount = s.queued.count;
    return {
      owner: 'managed',
      state: s.connection !== 'connected' ? 'unavailable' : s.officeReadOnly ? 'read-only' : controlEnabled ? 'ready' : 'read-only',
      runtimeInstanceId: s.runtimeInstanceId,
      generation: s.generation,
      canPrompt: canAct && !isBusy,
      canSteer: canAct && isBusy,
      canFollowUp: canAct && isBusy,
      canAbort: canAct && (isBusy || queuedCount > 0),
      canQueueRemove: canAct && queuedCount > 0,
      canResume: false,
      canApproveTool: false,
      canReviewPlan: false,
      canAnswerAsk: false,
      queued: {
        steering: s.queued.steering,
        followUp: s.queued.followUp,
        liveSteered: s.queued.liveSteered,
        count: queuedCount,
      },
      lastCommand: s.lastCommand ? { ...s.lastCommand } : null,
    };
  };

  const syncAdapterRecord = (s) => {
    if (disposed || !owned.has(s.id) || owned.get(s.id)?.runtimeInstanceId !== s.runtimeInstanceId) return;
    const runningTools = [...s.pendingTools.values()];
    const toolCategories = [...new Set(runningTools.map((t) => t.category))].slice(0, 5);
    const waitReasons = [...new Set(s.waiting.values())].slice(0, 2);
    const topTool = runningTools.length ? runningTools[runningTools.length - 1] : null;
    const explicitSummary = topTool ? {
      kind: topTool.summaryKind,
      ...(topTool.safeSubject ? { safeSubject: topTool.safeSubject } : {}),
      source: 'managedRpc',
      runtimeInstanceId: s.runtimeInstanceId,
      generation: s.generation,
      eventSequence: s.eventSequence,
      observedAt: s.observedAt,
    } : null;

    const liveInput = {
      sourceNamespace: s.sourceNamespace,
      sourceSessionId: s.sourceSessionId,
      runtimeInstanceId: s.runtimeInstanceId,
      generation: s.generation,
      project: s.projectAlias,
      projectKey: s.projectKey,
      worktreeKey: s.worktreeKey,
      observedAt: s.observedAt,
      connection: s.connection,
      lifecycle: s.lifecycle,
      activity: s.activity,
      taskStart: s.taskStart,
      lastTurnOutcome: s.lastTurnOutcome,
      pendingTools: runningTools.length,
      toolCategories,
      waitReasons,
      counts: { ...s.counts },
      sequence: s.eventSequence,
      summarySource: 'managedRpc',
      activitySummary: explicitSummary,
    };
    const activitySummary = deriveLiveActivitySummary(liveInput, {
      allowSubject: allowActivitySubject === true,
      now: now(),
    });
    const control = computeControlSnapshot(s);
    const payload = {
      ...liveInput,
      activitySummary,
      control,
    };
    if (typeof adapter.updateManaged === 'function') {
      adapter.updateManaged(s.id, s.runtimeInstanceId, payload);
    } else {
      adapter.removeManaged(s.id, s.runtimeInstanceId);
      adapter.setManaged({ id: s.id, ...payload });
    }
    notify(s.id);
  };

  const recomputeSessionActivity = (s) => {
    if (s.lifecycle === 'ended' || s.connection !== 'connected') {
      s.activity = 'unknown';
      s.taskStart = 0;
      return;
    }
    if (s.waiting.size > 0) {
      s.activity = 'waiting';
      if (!s.taskStart) s.taskStart = s.observedAt;
      return;
    }
    if (s.inTurn || s.isStreaming || s.pendingTools.size > 0) {
      s.activity = 'active';
      if (!s.taskStart) s.taskStart = s.observedAt;
      return;
    }
    s.activity = 'idle';
    s.taskStart = 0;
  };

  const forget = (id, instance) => {
    const current = owned.get(id);
    if (!current || current.runtimeInstanceId !== instance) return;
    current.connection = 'disconnected';
    current.lifecycle = 'ended';
    current.inTurn = false;
    current.isStreaming = false;
    current.pendingTools.clear();
    current.waiting.clear();
    for (const entry of current.dedup.values()) {
      if (entry.status === 'accepted' || entry.status === 'running' || entry.status === 'queued') {
        entry.status = 'unknown';
      }
    }
    owned.delete(id);
    adapter.removeManaged(id, instance);
    notify(id);
  };

  const handleSessionIdentityLoss = (s) => {
    if (!owned.has(s.id) || owned.get(s.id)?.runtimeInstanceId !== s.runtimeInstanceId) return;
    void s.rpc?.close().catch(() => {});
    forget(s.id, s.runtimeInstanceId);
  };

  const handleRpcEvent = (s, event) => {
    if (disposed || !owned.has(s.id) || owned.get(s.id)?.runtimeInstanceId !== s.runtimeInstanceId) return;
    if (!event || typeof event !== 'object') return;
    const at = now();
    s.observedAt = at;
    s.eventSequence++;
    const type = event.type;

    if (type === 'session_info_update' && typeof event.sessionId === 'string' && event.sessionId !== s.sourceSessionId) {
      handleSessionIdentityLoss(s);
      return;
    }
    if (type === 'agent_start' || type === 'turn_start') {
      s.inTurn = true;
      s.isStreaming = true;
      for (const entry of s.dedup.values()) {
        if (entry.kind === 'prompt' && entry.status === 'accepted') entry.status = 'running';
      }
      if (s.lastCommand?.kind === 'prompt' && s.lastCommand.status === 'accepted') {
        s.lastCommand = { ...s.lastCommand, status: 'running', updatedAt: at };
      }
    } else if (type === 'tool_execution_start') {
      const toolCallId = safeId(event.toolCallId);
      if (toolCallId && s.pendingTools.size < MAX_PENDING_TOOLS) {
        const classified = classifyRpcToolExecution(event.toolName, event.args, { allowSubject: allowActivitySubject === true });
        const cat = classified.kind === 'test' ? 'cmd' : ['read', 'edit', 'cmd', 'web'].includes(classified.kind) ? classified.kind : 'other';
        if (!s.countedTools.has(toolCallId) && ['read', 'edit', 'cmd', 'web'].includes(cat)) {
          s.countedTools.add(toolCallId);
          s.counts[cat] = (s.counts[cat] || 0) + 1;
        }
        s.pendingTools.set(toolCallId, {
          toolCallId,
          category: cat,
          summaryKind: classified.kind,
          safeSubject: classified.safeSubject || null,
          at,
        });
      }
    } else if (type === 'tool_execution_end') {
      const toolCallId = safeId(event.toolCallId);
      if (toolCallId) s.pendingTools.delete(toolCallId);
    } else if (type === 'extension_ui_request') {
      // Phase 04 does not approve/answer dialogs, but reflects waiting state when a blocking dialog arrives.
      const method = typeof event.method === 'string' ? event.method : '';
      const reqId = safeId(event.id);
      if (reqId && ['confirm', 'select', 'input', 'editor', 'ask'].includes(method) && s.waiting.size < MAX_PENDING_TOOLS) {
        s.waiting.set(reqId, method === 'confirm' ? 'approval' : 'input');
      }
    } else if (type === 'queue_update') {
      s.queued = sanitizeQueued(event);
    } else if (type === 'agent_end' || type === 'turn_end') {
      if (event.willContinue !== true) {
        s.inTurn = false;
        s.isStreaming = false;
        s.pendingTools.clear();
        s.waiting.clear();
      }
    } else if (type === 'prompt_result') {
      s.inTurn = false;
      s.isStreaming = false;
      s.pendingTools.clear();
      s.waiting.clear();
      const status = event.status === 'aborted' ? 'aborted' : event.status === 'error' ? 'failed' : 'settled';
      s.lastTurnOutcome = event.status === 'aborted' ? 'aborted' : event.status === 'error' ? 'error' : 'success';
      const reqId = typeof event.id === 'string' ? event.id : null;
      if (reqId && s.dedup.has(reqId)) {
        const entry = s.dedup.get(reqId);
        entry.status = status;
        entry.updatedAt = at;
        if (event.status === 'error') entry.errorCode = event.error?.code === 'cost_cap' ? 'COMMAND_COST_CAP' : 'COMMAND_TURN_ERROR';
      }
      if (s.lastCommand && (!reqId || s.lastCommand.requestId === reqId)) {
        s.lastCommand = {
          ...s.lastCommand,
          status,
          ...(event.status === 'error' ? { errorCode: event.error?.code === 'cost_cap' ? 'COMMAND_COST_CAP' : 'COMMAND_TURN_ERROR' } : {}),
          updatedAt: at,
        };
      }
    } else if (type === 'session_settled') {
      s.inTurn = false;
      s.isStreaming = false;
      s.pendingTools.clear();
      s.waiting.clear();
      s.queued = { steering: [], followUp: [], liveSteered: 0, count: 0 };
      if (s.lastCommand && (s.lastCommand.status === 'accepted' || s.lastCommand.status === 'running' || s.lastCommand.status === 'queued')) {
        s.lastCommand = { ...s.lastCommand, status: 'settled', updatedAt: at };
      }
      for (const entry of s.dedup.values()) {
        if (entry.status === 'accepted' || entry.status === 'running' || entry.status === 'queued') {
          entry.status = 'settled';
          entry.updatedAt = at;
        }
      }
    }

    recomputeSessionActivity(s);
    syncAdapterRecord(s);
  };

  const applyRpcStateSnapshot = (s, state) => {
    if (!state || typeof state !== 'object') return false;
    if (state.sessionId !== s.sourceSessionId) {
      handleSessionIdentityLoss(s);
      return false;
    }
    const at = now();
    s.observedAt = at;
    s.eventSequence++;
    s.isStreaming = state.isStreaming === true;
    if (state.isSettled === true && !s.isStreaming) {
      s.inTurn = false;
      s.pendingTools.clear();
      s.waiting.clear();
    } else if (s.isStreaming) {
      s.inTurn = true;
    }
    if (state.queuedMessages) {
      s.queued = sanitizeQueued(state.queuedMessages);
    }
    recomputeSessionActivity(s);
    syncAdapterRecord(s);
    return true;
  };

  const pruneDedupAndRates = (s, currentNow) => {
    for (const [reqId, item] of s.dedup) {
      if (currentNow - item.createdAt > DEDUP_TTL_MS && !item.inFlight) s.dedup.delete(reqId);
    }
    while (s.dedup.size >= MAX_DEDUP_PER_SESSION) {
      const oldest = [...s.dedup.entries()].find(([, v]) => !v.inFlight);
      if (!oldest) break;
      s.dedup.delete(oldest[0]);
    }
    s.rateTimestamps = s.rateTimestamps.filter((t) => currentNow - t < RATE_WINDOW_MS);
  };

  const launch = async (intent) => {
    if (disposed) return { ok: false, code: 'LAUNCH_UNAVAILABLE' };
    if (platform !== 'win32') return { ok: false, code: 'LAUNCH_WINDOWS_ONLY' };
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) ||
      Object.keys(intent).some((key) => !['mode', 'projectAlias', 'profileAlias', 'candidateId'].includes(key)) ||
      !['new', 'resume'].includes(intent.mode) || typeof intent.projectAlias !== 'string' ||
      typeof intent.profileAlias !== 'string' || (intent.mode === 'resume' && typeof intent.candidateId !== 'string') ||
      (intent.mode === 'new' && intent.candidateId != null)) return { ok: false, code: 'LAUNCH_INVALID' };
    const lock = JSON.stringify([intent.projectAlias, intent.profileAlias]);
    if (busy.has(lock)) return { ok: false, code: 'LAUNCH_BUSY' };
    if (owned.size + reservations.size >= MAX_MANAGED) return { ok: false, code: 'LAUNCH_LIMIT' };
    busy.add(lock);
    let rpc = null, attached = false, id = null, ownedSession = null;
    const runtimeInstanceId = randomUUID(), nextGen = ++generation;
    reservations.add(runtimeInstanceId);
    try {
      if (intent.mode === 'resume' && owned.has(intent.candidateId)) throw fault('LAUNCH_OWNER_CONFLICT');
      const target = await resolver.build(intent);
      if (disposed) throw fault('LAUNCH_UNAVAILABLE');
      if (intent.mode === 'resume') {
        const candidateId = target.candidate?.id;
        if (candidateId !== intent.candidateId || owned.has(candidateId)) throw fault('LAUNCH_OWNER_CONFLICT');
      }
      // Real home for production requires a separately approved dedicated profile. Tests use only synthetic roots.
      const h = target.profile.homeRoot, p = target.project.root;
      const env = childEnvironment({
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, ComSpec: process.env.ComSpec,
        PATH: process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : '',
        PATHEXT: '.EXE;.COM',
        HOME: h, USERPROFILE: h, HOMEDRIVE: path.parse(h).root.slice(0, 2), HOMEPATH: h.slice(2),
        APPDATA: path.join(h, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(h, 'AppData', 'Local'),
        TEMP: h, TMP: h,
      });
      rpc = hostFactory({
        binary: target.binary,
        args: target.args,
        cwd: p,
        env,
        allowControl: controlEnabled === true && intent.mode !== 'resume',
        ...(intent.mode === 'resume' ? { requiredOwnershipProtocol: 1 } : {}),
        onEvent: (ev) => { if (attached && ownedSession) handleRpcEvent(ownedSession, ev); },
        onExit: () => { if (attached && id) forget(id, runtimeInstanceId); },
      });
      inFlight.add(rpc);
      await rpc.start();
      if (!Number.isSafeInteger(rpc.pid()) || rpc.pid() <= 0) throw fault('LAUNCH_PID_INVALID');
      if (intent.mode === 'new') {
        const ack = await rpc.request('new_session');
        if (!ack || ack.cancelled !== false) throw fault('LAUNCH_NEW_REJECTED');
      }
      const state = await rpc.request('get_state');
      if (!accepted(state) || rpc.isReady?.() !== true) throw fault('LAUNCH_IDENTITY_MISMATCH');
      if (intent.mode === 'new' && state.messageCount !== 0) throw fault('LAUNCH_IDENTITY_MISMATCH');
      if (intent.mode === 'resume') {
        const proof = state.officeOwnership, candidate = target.candidate;
        if (state.sessionId !== candidate.sessionId || typeof state.sessionFile !== 'string' ||
          !same(path.resolve(state.sessionFile), candidate.exactFile) ||
          proof?.protocol !== 1 || proof.exclusive !== true || proof.sessionId !== candidate.sessionId ||
          typeof proof.sessionFile !== 'string' || !same(path.resolve(proof.sessionFile), candidate.exactFile) ||
          proof.sha256 !== candidate.sha256) throw fault('LAUNCH_OWNER_UNVERIFIED');
        const latest = await resolver.build(intent);
        if (latest.candidate?.fingerprint !== candidate.fingerprint ||
          latest.candidate?.sha256 !== candidate.sha256) throw fault('SOURCE_CHANGED');
      }
      if (disposed || !rpc.isReady()) throw fault('LAUNCH_UNAVAILABLE');
      id = ompSessionIdentity(target.project.sourceId, state.sessionId)?.id;
      if (!id || owned.has(id) || (intent.mode === 'new' && adapter.candidateForLaunch(id)) ||
        (intent.mode === 'new' && adapter.hasObservedRuntime?.(id))) throw fault('LAUNCH_OWNER_CONFLICT');
      const identity = adapter.projectForManaged?.(target.project.sourceId, target.project.root);
      const startedAt = now();
      ownedSession = {
        id,
        sourceNamespace: target.project.sourceId,
        sourceSessionId: state.sessionId,
        projectAlias: target.project.alias,
        profileAlias: target.profile.alias,
        projectKey: identity?.projectKey ?? null,
        worktreeKey: identity?.worktreeKey ?? null,
        runtimeInstanceId,
        generation: nextGen,
        state: 'ready',
        officeReadOnly: intent.mode === 'resume' && Boolean(state.officeOwnership),
        rpc,
        startedAt,
        observedAt: startedAt,
        connection: 'connected',
        lifecycle: 'open',
        activity: 'idle',
        inTurn: false,
        isStreaming: false,
        taskStart: 0,
        lastTurnOutcome: 'unknown',
        eventSequence: 1,
        pendingTools: new Map(),
        waiting: new Map(),
        counts: { read: 0, edit: 0, cmd: 0, web: 0 },
        countedTools: new Set(),
        queued: sanitizeQueued(state.queuedMessages),
        dedup: new Map(),
        rateTimestamps: [],
        commandInFlight: false,
        lastCommand: null,
      };
      const control = computeControlSnapshot(ownedSession);
      const activitySummary = deriveLiveActivitySummary({
        ...ownedSession,
        sequence: ownedSession.eventSequence,
        summarySource: 'managedRpc',
      }, { allowSubject: allowActivitySubject === true, now: startedAt });
      const registered = adapter.setManaged({
        id,
        sourceNamespace: target.project.sourceId,
        sourceSessionId: state.sessionId,
        runtimeInstanceId,
        generation: nextGen,
        project: target.project.alias,
        projectKey: ownedSession.projectKey,
        worktreeKey: ownedSession.worktreeKey,
        observedAt: startedAt,
        connection: 'connected',
        lifecycle: 'open',
        activity: 'idle',
        taskStart: 0,
        lastTurnOutcome: 'unknown',
        pendingTools: 0,
        toolCategories: [],
        waitReasons: [],
        counts: { read: 0, edit: 0, cmd: 0, web: 0 },
        activitySummary,
        control,
      });
      if (!registered) throw fault('LAUNCH_OWNER_CONFLICT');
      owned.set(id, ownedSession);
      reservations.delete(runtimeInstanceId);
      attached = true;
      if (rpc.isReady() !== true) throw fault('RPC_CLOSED');
      notify(id);
      return { ok: true, session: omit(ownedSession) };
    } catch (error) {
      if (attached && id) forget(id, runtimeInstanceId);
      if (rpc) await rpc.close().catch(() => {});
      // No stack/argv/paths/auth errors through HTTP.
      const code = typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'LAUNCH_FAILED';
      return { ok: false, code: intent.mode === 'resume' && !attached &&
        ['RPC_CLOSED', 'RPC_OWNERSHIP_PROTOCOL'].includes(code) ? 'LAUNCH_OWNER_UNVERIFIED' : code };
    } finally {
      reservations.delete(runtimeInstanceId);
      if (rpc) inFlight.delete(rpc);
      busy.delete(lock);
    }
  };

  const command = async (rawPayload) => {
    if (disposed || platform !== 'win32' || controlEnabled !== true) {
      return { ok: false, code: 'COMMAND_DISABLED' };
    }
    const parsed = validateOmpCommandPayload(rawPayload);
    if (!parsed.ok) return { ok: false, code: parsed.code };
    const cmd = parsed.command;
    const s = owned.get(cmd.id);
    if (!s) return { ok: false, code: 'COMMAND_UNKNOWN_SESSION' };
    if (s.runtimeInstanceId !== cmd.runtimeInstanceId || s.generation !== cmd.generation) {
      return { ok: false, code: 'COMMAND_STALE_OWNER' };
    }
    if (s.connection !== 'connected' || s.lifecycle === 'ended' || s.rpc?.isReady?.() !== true) {
      return { ok: false, code: 'COMMAND_DISCONNECTED' };
    }
    if (s.officeReadOnly === true) {
      return { ok: false, code: 'COMMAND_READ_ONLY' };
    }

    const currentNow = now();
    pruneDedupAndRates(s, currentNow);

    // RequestId idempotence: never double-dispatch the same requestId.
    if (s.dedup.has(cmd.requestId)) {
      const existing = s.dedup.get(cmd.requestId);
      if (existing.kind !== cmd.kind || (cmd.text !== undefined && existing.text !== cmd.text)) {
        return { ok: false, code: 'COMMAND_ID_CONFLICT' };
      }
      if (existing.inFlight && existing.promise) {
        const res = await existing.promise;
        return { ...res, deduplicated: true };
      }
      return {
        ok: existing.ok,
        code: existing.code,
        status: existing.status,
        requestId: cmd.requestId,
        id: s.id,
        runtimeInstanceId: s.runtimeInstanceId,
        generation: s.generation,
        deduplicated: true,
      };
    }

    // Concurrency guard: only one non-abort command in flight per session at a time.
    if (s.commandInFlight && cmd.kind !== 'abort') {
      return { ok: false, code: 'COMMAND_BUSY' };
    }
    if (s.rateTimestamps.length >= MAX_COMMANDS_PER_WINDOW) {
      return { ok: false, code: 'COMMAND_RATE_LIMIT' };
    }

    // Reconcile state with live RPC before trusting local cached state for command eligibility.
    if (cmd.kind !== 'abort') {
      try {
        const freshState = await s.rpc.request('get_state', undefined, { killOnTimeout: false });
        if (!applyRpcStateSnapshot(s, freshState)) {
          return { ok: false, code: 'COMMAND_STALE_OWNER' };
        }
      } catch {
        // If get_state fails or times out, we cannot verify session state: fail closed.
        return { ok: false, code: 'COMMAND_STATE_UNKNOWN' };
      }
    }

    const stateCheck = canAcceptCommandInState(cmd.kind, {
      connection: s.connection,
      lifecycle: s.lifecycle,
      activity: s.activity,
      isStreaming: s.isStreaming,
      officeReadOnly: s.officeReadOnly,
      queuedCount: s.queued.count,
    });
    if (!stateCheck.ok) {
      return { ok: false, code: stateCheck.code };
    }

    s.rateTimestamps.push(currentNow);
    const dedupEntry = {
      requestId: cmd.requestId,
      kind: cmd.kind,
      text: cmd.text,
      createdAt: currentNow,
      updatedAt: currentNow,
      inFlight: true,
      ok: false,
      code: null,
      status: 'pending',
      promise: null,
    };
    s.dedup.set(cmd.requestId, dedupEntry);
    if (cmd.kind !== 'abort') s.commandInFlight = true;

    const execute = (async () => {
      try {
        let rpcMethod = cmd.kind;
        let rpcData;
        if (cmd.kind === 'prompt') {
          rpcMethod = 'prompt';
          rpcData = { message: cmd.text };
        } else if (cmd.kind === 'steer') {
          rpcMethod = 'steer';
          rpcData = { message: cmd.text };
        } else if (cmd.kind === 'followUp') {
          rpcMethod = 'follow_up';
          rpcData = { message: cmd.text };
        } else if (cmd.kind === 'abort') {
          rpcMethod = 'abort';
          rpcData = undefined;
        } else if (cmd.kind === 'queueRemove') {
          rpcMethod = 'remove_queued_message';
          rpcData = { message: cmd.text, queue: cmd.queue };
        }

        const ack = await s.rpc.request(rpcMethod, rpcData, {
          requestId: cmd.requestId,
          killOnTimeout: false,
        });

        const settledAt = now();
        s.observedAt = settledAt;
        let status = 'accepted';
        if (cmd.kind === 'prompt') {
          if (ack && ack.agentInvoked === false) {
            status = 'settled';
          } else {
            // RPC ACK means prompt was admitted; actual turn completion arrives via prompt_result/session_settled.
            status = s.inTurn || s.isStreaming ? 'running' : 'accepted';
            s.inTurn = true;
            s.isStreaming = true;
          }
        } else if (cmd.kind === 'steer' || cmd.kind === 'followUp') {
          status = 'queued';
          if (cmd.kind === 'steer') {
            s.queued = sanitizeQueued({
              steering: [...s.queued.steering, cmd.text],
              followUp: s.queued.followUp,
              liveSteered: s.queued.liveSteered,
            });
          } else {
            s.queued = sanitizeQueued({
              steering: s.queued.steering,
              followUp: [...s.queued.followUp, cmd.text],
              liveSteered: s.queued.liveSteered,
            });
          }
        } else if (cmd.kind === 'abort') {
          status = 'settled';
          s.inTurn = false;
          s.isStreaming = false;
          s.pendingTools.clear();
          s.waiting.clear();
          s.lastTurnOutcome = 'aborted';
        } else if (cmd.kind === 'queueRemove') {
          if (!ack || ack.removed !== true) {
            dedupEntry.ok = false;
            dedupEntry.code = 'COMMAND_NOT_REMOVED';
            dedupEntry.status = 'failed';
            dedupEntry.updatedAt = settledAt;
            return { ok: false, code: 'COMMAND_NOT_REMOVED', status: 'failed', requestId: cmd.requestId };
          }
          status = 'settled';
          const list = cmd.queue === 'steering' ? [...s.queued.steering] : [...s.queued.followUp];
          const idx = list.indexOf(cleanChip(cmd.text));
          if (idx >= 0) list.splice(idx, 1);
          s.queued = sanitizeQueued({
            steering: cmd.queue === 'steering' ? list : s.queued.steering,
            followUp: cmd.queue === 'followUp' ? list : s.queued.followUp,
            liveSteered: s.queued.liveSteered,
          });
        }

        dedupEntry.ok = true;
        dedupEntry.code = 'OK';
        dedupEntry.status = status;
        dedupEntry.updatedAt = settledAt;
        s.lastCommand = {
          requestId: cmd.requestId,
          kind: cmd.kind,
          status,
          updatedAt: settledAt,
        };
        recomputeSessionActivity(s);
        syncAdapterRecord(s);

        // Best-effort post-command state refresh for queueRemove/steer/followUp/abort.
        if (cmd.kind !== 'prompt' && s.rpc?.isReady?.() === true) {
          void s.rpc.request('get_state', undefined, { killOnTimeout: false })
            .then((st) => applyRpcStateSnapshot(s, st))
            .catch(() => {});
        }

        return {
          ok: true,
          code: 'OK',
          status,
          requestId: cmd.requestId,
          id: s.id,
          runtimeInstanceId: s.runtimeInstanceId,
          generation: s.generation,
          deduplicated: false,
        };
      } catch (err) {
        const failAt = now();
        const errCode = err?.code;
        if (errCode === 'RPC_TIMEOUT') {
          // Timeout / lost ACK: reconcile with get_state, NEVER auto-resend prompt.
          let reconciled = 'unknown';
          if (s.rpc?.isReady?.() === true) {
            try {
              const st = await s.rpc.request('get_state', undefined, { killOnTimeout: false });
              if (applyRpcStateSnapshot(s, st)) {
                reconciled = 'unknown';
              }
            } catch { /* remains unknown */ }
          }
          dedupEntry.ok = false;
          dedupEntry.code = 'COMMAND_ACK_UNKNOWN';
          dedupEntry.status = reconciled;
          dedupEntry.updatedAt = failAt;
          s.lastCommand = {
            requestId: cmd.requestId,
            kind: cmd.kind,
            status: 'unknown',
            errorCode: 'COMMAND_ACK_UNKNOWN',
            updatedAt: failAt,
          };
          syncAdapterRecord(s);
          return {
            ok: false,
            code: 'COMMAND_ACK_UNKNOWN',
            status: 'unknown',
            requestId: cmd.requestId,
            id: s.id,
            runtimeInstanceId: s.runtimeInstanceId,
            generation: s.generation,
            deduplicated: false,
          };
        }

        const mappedCode = err?.rpcCode === 'office_read_only' ? 'COMMAND_READ_ONLY'
          : errCode === 'RPC_REJECTED' ? 'COMMAND_REJECTED'
            : errCode === 'RPC_BACKPRESSURE' ? 'COMMAND_BACKPRESSURE'
              : 'COMMAND_FAILED';
        dedupEntry.ok = false;
        dedupEntry.code = mappedCode;
        dedupEntry.status = 'failed';
        dedupEntry.updatedAt = failAt;
        s.lastCommand = {
          requestId: cmd.requestId,
          kind: cmd.kind,
          status: 'failed',
          errorCode: mappedCode,
          updatedAt: failAt,
        };
        syncAdapterRecord(s);
        return {
          ok: false,
          code: mappedCode,
          status: 'failed',
          requestId: cmd.requestId,
          id: s.id,
          runtimeInstanceId: s.runtimeInstanceId,
          generation: s.generation,
          deduplicated: false,
        };
      } finally {
        dedupEntry.inFlight = false;
        dedupEntry.promise = null;
        if (cmd.kind !== 'abort') s.commandInFlight = false;
      }
    })();

    dedupEntry.promise = execute;
    return execute;
  };

  const status = (targetId = null) => {
    const base = {
      enabled: !disposed && platform === 'win32',
      controlEnabled: !disposed && platform === 'win32' && controlEnabled === true,
      reason: disposed ? 'disabled' : platform !== 'win32' ? 'windows-only' : 'ready',
      ...resolver.safeInfo(),
      sessions: [...owned.values()].map(omit),
    };
    if (targetId && typeof targetId === 'string') {
      const s = owned.get(targetId);
      base.session = s ? { ...omit(s), control: computeControlSnapshot(s) } : null;
    }
    return base;
  };

  const dispose = async () => {
    disposed = true;
    const list = [...owned.values()];
    await Promise.all([...inFlight].map((rpc) => rpc.close().catch(() => {})));
    await Promise.all(list.map(async (s) => {
      // Do not signal any unowned PID; EOF/timeout is managed by this child host.
      await s.rpc.close().catch(() => {});
      forget(s.id, s.runtimeInstanceId);
    }));
  };

  return { launch, command, status, dispose };
}
