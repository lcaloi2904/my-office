import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentKindOf, capabilitiesFor, ompSessionIdentity, resolveOmpMode, hasClaudeCapability, isClaudeRequest } from '../../server/agents/schema.mjs';
import { projectClaudeSession, projectOmpSession } from '../../server/agents/projection.mjs';

test('legacy Claude and explicit provider identities do not collapse into Claude', () => {
  assert.equal(agentKindOf({ id: 'legacy' }), 'claude');
  assert.equal(agentKindOf({ agent: 'claude' }), 'claude');
  assert.equal(agentKindOf({ agentKind: 'omp', agent: 'claude' }), 'omp');
  assert.equal(agentKindOf({ agentKind: 'mystery' }), 'unknown');
  assert.equal(agentKindOf(null), 'unknown');
  assert.equal(agentKindOf({ agent: 'codex' }), 'unknown');
});

test('OMP public identity is stable, opaque and namespace-safe', () => {
  const a = ompSessionIdentity('host-a/profile-a', 'sid/one');
  const b = ompSessionIdentity('host-a/profile-a', 'sid/one');
  const c = ompSessionIdentity('host-b/profile-a', 'sid/one');
  const d = ompSessionIdentity('host-a/profile-a', 'sid/two');
  assert.deepEqual(a, b);
  assert.match(a.id, /^omp:[a-f0-9]{64}$/);
  assert.equal(a.id, a.sessionKey);
  assert.notEqual(a.id, c.id);
  assert.notEqual(a.id, d.id);
  assert.equal(a.id.includes('host-a'), false);
  assert.equal(ompSessionIdentity('', 'sid'), null);
  assert.equal(ompSessionIdentity('host', '\u0000'), null);
  assert.equal(ompSessionIdentity('host', 'x'.repeat(300)), null);
});

test('invalid OMP flags fail closed; default needs no config or runtime', () => {
  assert.equal(resolveOmpMode(undefined), 'off');
  assert.equal(resolveOmpMode('off'), 'off');
  assert.equal(resolveOmpMode('files'), 'files');
  assert.equal(resolveOmpMode('hybrid'), 'hybrid');
  assert.equal(resolveOmpMode('unverified-mode'), 'off');
  assert.equal(resolveOmpMode('HYBRID'), 'off');
});

test('capabilities cannot be granted by incoming OMP payload', () => {
  const claude = capabilitiesFor('claude');
  const omp = capabilitiesFor('omp');
  assert.equal(claude.openWindow, true);
  assert.equal(claude.changeAccount, true);
  for (const key of ['openWindow', 'closeSession', 'changeAccount', 'remoteControl', 'startTask', 'readConversation'])
    assert.equal(omp[key], false);
  assert.deepEqual(capabilitiesFor('something-else'), omp);
  assert.equal(hasClaudeCapability({ agentKind: 'omp', capabilities: claude }, 'openWindow'), false);
  assert.equal(hasClaudeCapability({ id: 'old-claude-session' }, 'openWindow'), true);
  assert.equal(hasClaudeCapability({ agentKind: 'claude', capabilities: { openWindow: false } }, 'openWindow'), false);
  assert.equal(hasClaudeCapability({ agentKind: 'unknown' }, 'openWindow'), false);
});

test('command targeting denies OMP/unknown IDs even with a valid Claude sid', () => {
  assert.equal(isClaudeRequest({ sid: 'legacy-session' }), true);
  assert.equal(isClaudeRequest({ agentKind: 'claude', sid: 'legacy-session' }), true);
  assert.equal(isClaudeRequest({ agentKind: 'omp', sid: 'legacy-session' }), false);
  assert.equal(isClaudeRequest({ agentKind: 'mystery', sid: 'legacy-session' }), false);
  assert.equal(isClaudeRequest({ sid: 'omp:1234', dir: '/approved' }), false);
  assert.equal(isClaudeRequest({ id: 'omp:1234', sid: 'legacy-session' }), false);
});

test('Claude projection retains old public data and overrides forged capabilities', () => {
  const s = { id: 'legacy-id', name: 'Shop', status: 'work', usage: { ctx: 10, ctxMax: 100, cost: 3 }, capabilities: { openWindow: false }, agentKind: 'omp' };
  const p = projectClaudeSession(s);
  assert.equal(p.id, s.id);
  assert.equal(p.usage, s.usage);
  assert.equal(p.status, 'work');
  assert.equal(p.sessionKey, 'claude:legacy-id');
  assert.equal(p.agentKind, 'claude');
  assert.equal(p.capabilities.openWindow, true);
  assert.equal(s.agentKind, 'omp', 'does not modify input');
});

test('OMP projection drops untrusted text, file paths, controls and usage', () => {
  const raw = {
    sourceNamespace: 'fixture-wsl-a', sourceSessionId: 'same-session',
    agentKind: 'claude', agent: 'claude', name: 'SYNTHETIC_PRIVATE', title: 'SYNTHETIC_PRIVATE',
    lastPrompt: 'SYNTHETIC_PRIVATE', cwd: '/SYNTHETIC_PRIVATE', link: 'javascript:SYNTHETIC_PRIVATE',
    pid: 1234, acct: '', capabilities: { openWindow: true, changeAccount: true },
    tool: { args: 'SYNTHETIC_PRIVATE' }, providerPromptCacheKey: 'SYNTHETIC_PRIVATE',
    credential_pin: { hash: 'SYNTHETIC_PRIVATE' }, previousSessionFiles: ['/SYNTHETIC_PRIVATE'],
    usage: { cost: 999, ctx: 0, ctxMax: 0 },
    metrics: { cost: { value: 0, scope: 'self', provenance: 'recorded' }, tokens: { input: 12, output: undefined } },
    model: 'anthropic/claude-sonnet',
  };
  const s = projectOmpSession(raw);
  assert.equal(s.agentKind, 'omp');
  assert.equal(s.agent, 'omp');
  assert.equal(s.pid, null);
  assert.equal(s.link, null);
  assert.equal(s.usage, null);
  assert.equal(s.status, 'unknown');
  assert.equal(s.metrics.cost.value, 0, 'measured zero is distinct from unknown');
  assert.equal(s.metrics.tokens.output, null);
  assert.equal(s.capabilities.openWindow, false);
  assert.equal(s.model, 'anthropic/claude-sonnet');
  assert.doesNotMatch(JSON.stringify(s), /SYNTHETIC_PRIVATE/);
  assert.doesNotMatch(JSON.stringify(s), /javascript:/);
  assert.equal(projectOmpSession({ sourceNamespace: '', sourceSessionId: 'id' }), null);
  const incomplete = projectOmpSession({ sourceNamespace: 'fixture', sourceSessionId: 'id', metrics: { cost: { value: 5 } } });
  assert.equal(incomplete.metrics.cost, null, 'provenance must be explicit');
});
