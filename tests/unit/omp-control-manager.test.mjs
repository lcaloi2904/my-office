import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { createOmpControlManager } from '../../server/agents/omp/control-manager.mjs';

function makeHarness({ controlEnabled = true, allowActivitySubject = true } = {}) {
  let clock = 100_000;
  const managed = new Map();
  const changes = [];
  const adapter = {
    candidateForLaunch: () => null,
    hasObservedRuntime: () => false,
    projectForManaged: () => ({ projectKey: 'a'.repeat(64), worktreeKey: 'b'.repeat(64) }),
    setManaged(rec) {
      if (managed.has(rec.id)) return false;
      managed.set(rec.id, rec);
      changes.push(rec.id);
      return true;
    },
    updateManaged(id, instance, next) {
      const prev = managed.get(id);
      if (!prev || prev.runtimeInstanceId !== instance) return false;
      managed.set(id, { ...prev, ...next, id, runtimeInstanceId: instance });
      changes.push(id);
      return true;
    },
    removeManaged(id, instance) {
      if (managed.get(id)?.runtimeInstanceId !== instance) return false;
      managed.delete(id);
      changes.push(id);
      return true;
    },
  };

  let sessionCounter = 0;
  const hosts = [];
  const resolver = {
    safeInfo: () => ({ projects: [{ alias: 'work', sourceId: 'src-1' }], profiles: [{ alias: 'isolated' }], resumeAvailable: false }),
    async build(intent) {
      return {
        binary: 'C:\\fake\\omp.exe',
        args: ['--mode', 'rpc'],
        project: { alias: intent.projectAlias, sourceId: 'src-1', root: 'C:\\fake\\work' },
        profile: { alias: intent.profileAlias, homeRoot: 'C:\\fake\\home' },
      };
    },
  };

  const hostFactory = (opts) => {
    const sid = `00000000-0000-4000-8000-${String(++sessionCounter).padStart(12, '0')}`;
    const state = {
      sessionId: sid,
      sessionFile: null,
      messageCount: 0,
      isStreaming: false,
      isSettled: true,
      queuedMessages: { steering: [], followUp: [], liveSteered: 0 },
      systemPrompt: 'SECRET_SYSTEM_PROMPT',
      dumpTools: [{ name: 'secret_tool' }],
    };
    const calls = [];
    let ready = false, closed = false;
    let nextPromptTimeout = false;
    let nextCommandReject = null;

    const host = {
      opts,
      calls,
      state,
      setPromptTimeout(v) { nextPromptTimeout = v; },
      setNextReject(code, rpcCode = null) { nextCommandReject = { code, rpcCode }; },
      emitEvent(ev) { opts.onEvent?.(ev); },
      triggerExit() { closed = true; ready = false; opts.onExit?.(); },
      async start() { ready = true; return host; },
      isReady: () => ready && !closed,
      pid: () => 4000 + sessionCounter,
      async close() { closed = true; ready = false; },
      async request(method, data, reqOpts = {}) {
        calls.push({ method, data, reqOpts });
        if (method === 'new_session') return { cancelled: false };
        if (method === 'get_state') return { ...state, queuedMessages: { steering: [...state.queuedMessages.steering], followUp: [...state.queuedMessages.followUp], liveSteered: state.queuedMessages.liveSteered } };
        if (!opts.allowControl) {
          throw Object.assign(new Error('RPC_UNAVAILABLE'), { code: 'RPC_UNAVAILABLE' });
        }
        if (nextCommandReject) {
          const r = nextCommandReject;
          nextCommandReject = null;
          throw Object.assign(new Error(r.code), { code: r.code, rpcCode: r.rpcCode });
        }
        if (method === 'prompt') {
          if (nextPromptTimeout) {
            nextPromptTimeout = false;
            throw Object.assign(new Error('RPC_TIMEOUT'), { code: 'RPC_TIMEOUT' });
          }
          state.isStreaming = true;
          state.isSettled = false;
          state.messageCount += 1;
          return {};
        }
        if (method === 'steer') {
          state.queuedMessages.steering.push(data.message);
          return {};
        }
        if (method === 'follow_up') {
          state.queuedMessages.followUp.push(data.message);
          return {};
        }
        if (method === 'remove_queued_message') {
          const list = data.queue === 'steering' ? state.queuedMessages.steering : state.queuedMessages.followUp;
          const i = list.indexOf(data.message);
          if (i < 0) return { removed: false };
          list.splice(i, 1);
          return { removed: true };
        }
        if (method === 'abort') {
          state.isStreaming = false;
          state.isSettled = true;
          return {};
        }
        throw Object.assign(new Error('RPC_UNAVAILABLE'), { code: 'RPC_UNAVAILABLE' });
      },
    };
    hosts.push(host);
    return host;
  };

  const manager = createOmpControlManager({
    resolver,
    adapter,
    hostFactory,
    platform: 'win32',
    controlEnabled,
    allowActivitySubject,
    now: () => clock,
    onChange: (id) => changes.push(id),
  });

  return {
    manager,
    adapter,
    managed,
    hosts,
    changes,
    advance: (ms) => { clock += ms; },
  };
}

test('prompt -> accepted -> running -> tool activity summary -> steer/followUp/queueRemove -> abort -> settled', async () => {
  const h = makeHarness();
  try {
    const launched = await h.manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' });
    assert.equal(launched.ok, true);
    const s = launched.session;
    const host = h.hosts[0];

    // Projected idle state
    let pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.equal(pub.control.canPrompt, true);
    assert.equal(pub.control.canSteer, false);
    assert.equal(pub.control.canFollowUp, false);
    assert.equal(pub.control.canAbort, false);
    assert.equal(pub.activitySummary.kind, 'idle');

    // Steer rejected while idle
    const earlySteer = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-early-steer', kind: 'steer', text: 'Too early',
    });
    assert.equal(earlySteer.ok, false);
    assert.equal(earlySteer.code, 'COMMAND_SESSION_IDLE');

    // Send prompt while idle
    const promptRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-prompt-1', kind: 'prompt', text: 'Inspect workers.js',
    });
    assert.equal(promptRes.ok, true);
    assert.equal(promptRes.status, 'accepted');
    assert.equal(promptRes.deduplicated, false);

    // Duplicate requestId returns deduplicated result without sending a second RPC prompt
    const promptCountBefore = host.calls.filter((c) => c.method === 'prompt').length;
    const dupRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-prompt-1', kind: 'prompt', text: 'Inspect workers.js',
    });
    assert.equal(dupRes.ok, true);
    assert.equal(dupRes.deduplicated, true);
    assert.equal(host.calls.filter((c) => c.method === 'prompt').length, promptCountBefore);

    // Same requestId with different text is rejected as conflict
    const conflictRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-prompt-1', kind: 'prompt', text: 'Different prompt',
    });
    assert.equal(conflictRes.ok, false);
    assert.equal(conflictRes.code, 'COMMAND_ID_CONFLICT');

    // Prompt rejected while busy
    const secondPrompt = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-prompt-2', kind: 'prompt', text: 'Should fail while busy',
    });
    assert.equal(secondPrompt.ok, false);
    assert.equal(secondPrompt.code, 'COMMAND_SESSION_BUSY');

    // Emit agent_start and tool_execution_start -> activitySummary reflects verified tool and safeSubject
    host.emitEvent({ type: 'agent_start' });
    host.emitEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'E:\\vide-code\\my-office\\src\\office\\people\\workers.js' },
    });
    pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.equal(pub.activity, 'active');
    assert.equal(pub.control.canPrompt, false);
    assert.equal(pub.control.canSteer, true);
    assert.equal(pub.control.canFollowUp, true);
    assert.equal(pub.control.canAbort, true);
    assert.equal(pub.activitySummary.kind, 'read');
    assert.equal(pub.activitySummary.safeSubject, 'workers.js');
    assert.equal(pub.control.lastCommand.status, 'running');

    // Tool end clears tool subject back to generic processing
    host.emitEvent({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read' });
    pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.equal(pub.activitySummary.kind, 'processing');
    assert.equal(pub.activitySummary.safeSubject, undefined);

    // Steer and FollowUp while busy
    const steerRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-steer-1', kind: 'steer', text: 'Focus on observeActor',
    });
    assert.equal(steerRes.ok, true);
    assert.equal(steerRes.status, 'queued');

    const followRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-follow-1', kind: 'followUp', text: 'Run unit tests next',
    });
    assert.equal(followRes.ok, true);
    assert.equal(followRes.status, 'queued');

    pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.deepEqual(pub.control.queued.steering, ['Focus on observeActor']);
    assert.deepEqual(pub.control.queued.followUp, ['Run unit tests next']);
    assert.equal(pub.control.canQueueRemove, true);

    // Remove queued followUp message
    const rmRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-rm-1', kind: 'queueRemove', text: 'Run unit tests next', queue: 'followUp',
    });
    assert.equal(rmRes.ok, true);
    pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.deepEqual(pub.control.queued.followUp, []);

    // Abort cancels current turn without killing process
    const abortRes = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-abort-1', kind: 'abort',
    });
    assert.equal(abortRes.ok, true);
    assert.equal(abortRes.status, 'settled');
    assert.equal(host.isReady(), true);

    host.emitEvent({ type: 'prompt_result', id: 'req-prompt-1', status: 'aborted', agentInvoked: true, sessionSettled: true });
    host.emitEvent({ type: 'session_settled' });
    pub = projectOmpSession({ ...h.managed.get(s.id), live: h.managed.get(s.id), managed: h.managed.get(s.id).control });
    assert.equal(pub.activity, 'idle');
    assert.equal(pub.control.canPrompt, true);
    assert.equal(pub.activitySummary.kind, 'idle');
  } finally {
    await h.manager.dispose();
  }
});

test('timeout / lost ACK reconciles state to unknown and never auto-resends duplicate prompt', async () => {
  const h = makeHarness();
  try {
    const { session: s } = await h.manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' });
    const host = h.hosts[0];
    host.setPromptTimeout(true);

    const res = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-timeout-1', kind: 'prompt', text: 'Do not duplicate me',
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'COMMAND_ACK_UNKNOWN');
    assert.equal(res.status, 'unknown');

    // Only one prompt call was attempted; no automatic retry
    assert.equal(host.calls.filter((c) => c.method === 'prompt').length, 1);

    // Repeating the same requestId returns the recorded unknown state without re-sending
    const repeat = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-timeout-1', kind: 'prompt', text: 'Do not duplicate me',
    });
    assert.equal(repeat.code, 'COMMAND_ACK_UNKNOWN');
    assert.equal(repeat.deduplicated, true);
    assert.equal(host.calls.filter((c) => c.method === 'prompt').length, 1);
  } finally {
    await h.manager.dispose();
  }
});

test('stale owner / generation mismatch, session switch, and disabled flag reject commands fail-closed', async () => {
  const h = makeHarness();
  try {
    const { session: s } = await h.manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' });
    const host = h.hosts[0];

    // Wrong generation or runtimeInstanceId rejected
    const badGen = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation + 1,
      requestId: 'req-stale-1', kind: 'prompt', text: 'Hello',
    });
    assert.equal(badGen.code, 'COMMAND_STALE_OWNER');

    // Session identity change inside RPC invalidates managed ownership
    host.emitEvent({ type: 'session_info_update', sessionId: 'different-session-id' });
    const afterSwitch = await h.manager.command({
      id: s.id, runtimeInstanceId: s.runtimeInstanceId, generation: s.generation,
      requestId: 'req-after-switch', kind: 'prompt', text: 'Hello',
    });
    assert.equal(afterSwitch.code, 'COMMAND_UNKNOWN_SESSION');
  } finally {
    await h.manager.dispose();
  }

  // Flag OFF manager denies all commands
  const offHarness = makeHarness({ controlEnabled: false });
  try {
    const { session: s2 } = await offHarness.manager.launch({ mode: 'new', projectAlias: 'work', profileAlias: 'isolated' });
    const denied = await offHarness.manager.command({
      id: s2.id, runtimeInstanceId: s2.runtimeInstanceId, generation: s2.generation,
      requestId: 'req-off-1', kind: 'prompt', text: 'Hello',
    });
    assert.equal(denied.code, 'COMMAND_DISABLED');
    const pub = projectOmpSession({
      ...offHarness.managed.get(s2.id),
      live: offHarness.managed.get(s2.id),
      managed: offHarness.managed.get(s2.id).control,
    });
    assert.equal(pub.control.canPrompt, false);
    assert.equal(pub.control.state, 'read-only');
    // Raw systemPrompt/dumpTools never leak into public projection
    assert.equal(JSON.stringify(pub).includes('SECRET_SYSTEM_PROMPT'), false);
    assert.equal(JSON.stringify(pub).includes('secret_tool'), false);
  } finally {
    await offHarness.manager.dispose();
  }
});
