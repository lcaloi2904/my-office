// Server-owned managed OMP sessions. Phase 03: launch/resume only, no prompt/control methods.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ompSessionIdentity } from '../schema.mjs';
import { createOmpRpcHost, childEnvironment } from './rpc-host.mjs';

const fault = (code) => Object.assign(new Error(code), { code });
const MAX_MANAGED = 8;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sessionIdValid = (s) => typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\u0000-\u001f\u007f]/.test(s);
const omit = (s) => ({ id: s.id, projectAlias: s.projectAlias, profileAlias: s.profileAlias,
  runtimeInstanceId: s.runtimeInstanceId, generation: s.generation, state: s.state });
const accepted = (state) => state && typeof state === 'object' &&
  sessionIdValid(state.sessionId) && Number.isSafeInteger(state.messageCount) &&
  state.messageCount >= 0 && state.isStreaming === false && state.isSettled === true;

export function createOmpControlManager({ resolver, adapter, hostFactory = createOmpRpcHost,
  platform = process.platform, onChange = () => {} } = {}) {
  if (!resolver || !adapter || typeof adapter.setManaged !== 'function' || typeof adapter.removeManaged !== 'function') throw fault('LAUNCH_INVALID');
  let disposed = false, generation = 0;
  const owned = new Map(), busy = new Set(), inFlight = new Set(), reservations = new Set();
  const notify = (id) => { try { onChange(id); } catch { /* UI listeners cannot alter session ownership */ } };
  const forget = (id, instance) => {
    const current = owned.get(id);
    if (!current || current.runtimeInstanceId !== instance) return;
    owned.delete(id);
    adapter.removeManaged(id, instance);
    notify(id);
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
    let rpc = null, attached = false, id = null;
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
      rpc = hostFactory({ binary: target.binary, args: target.args, cwd: p, env,
        ...(intent.mode === 'resume' ? { requiredOwnershipProtocol: 1 } : {}),
        onExit: () => { if (attached && id) forget(id, runtimeInstanceId); } });
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
      const ownedSession = { id, sourceNamespace: target.project.sourceId, sourceSessionId: state.sessionId,
        projectAlias: target.project.alias, profileAlias: target.profile.alias, runtimeInstanceId, generation: nextGen,
        state: 'ready', rpc, startedAt: Date.now() };
      const identity = adapter.projectForManaged?.(target.project.sourceId, target.project.root);
      const registered = adapter.setManaged({
        id, sourceNamespace: target.project.sourceId, sourceSessionId: state.sessionId,
        runtimeInstanceId, generation: nextGen,
        project: target.project.alias, projectKey: identity?.projectKey ?? null, worktreeKey: identity?.worktreeKey ?? null,
        observedAt: Date.now(), connection: 'connected', lifecycle: 'open', activity: 'idle',
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
  const status = () => ({
    enabled: !disposed && platform === 'win32',
    reason: disposed ? 'disabled' : platform === 'win32' ? 'ready' : 'windows-only',
    ...resolver.safeInfo(),
    sessions: [...owned.values()].map(omit),
  });
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
  return { launch, status, dispose };
}
