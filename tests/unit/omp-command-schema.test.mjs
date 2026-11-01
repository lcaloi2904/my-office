import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOmpCommandPayload,
  validateOmpCommandText,
  canAcceptCommandInState,
  MAX_COMMAND_BYTES,
  MAX_COMMAND_CHARS,
} from '../../server/agents/omp/command-schema.mjs';

const VALID_ID = 'omp:' + 'a'.repeat(64);
const VALID_RUNTIME = '00000000-0000-4000-8000-000000000099';

test('validateOmpCommandText accepts clean Unicode and rejects empty, control chars, lone surrogates and oversize', () => {
  const ok = validateOmpCommandText('  Xin chào OMP\r\nKiểm tra tiếng Việt 🚀  ');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '  Xin chào OMP\nKiểm tra tiếng Việt 🚀  ');

  assert.deepEqual(validateOmpCommandText(''), { ok: false, code: 'COMMAND_TEXT_EMPTY' });
  assert.deepEqual(validateOmpCommandText('   \n\t  '), { ok: false, code: 'COMMAND_TEXT_EMPTY' });
  assert.deepEqual(validateOmpCommandText(123), { ok: false, code: 'COMMAND_TEXT_INVALID' });
  assert.deepEqual(validateOmpCommandText('bad\u0000null'), { ok: false, code: 'COMMAND_TEXT_INVALID' });
  assert.deepEqual(validateOmpCommandText('bad\u0007bell'), { ok: false, code: 'COMMAND_TEXT_INVALID' });
  assert.deepEqual(validateOmpCommandText('lone\uD800surrogate'), { ok: false, code: 'COMMAND_TEXT_INVALID' });
  assert.deepEqual(validateOmpCommandText('x'.repeat(MAX_COMMAND_CHARS + 1)), { ok: false, code: 'COMMAND_TEXT_LIMIT' });
  // 3-byte UTF-8 characters exceeding MAX_COMMAND_BYTES while under MAX_COMMAND_CHARS
  assert.deepEqual(validateOmpCommandText('€'.repeat(Math.floor(MAX_COMMAND_BYTES / 3) + 2)), { ok: false, code: 'COMMAND_TEXT_LIMIT' });
});

test('validateOmpCommandPayload enforces opaque OMP session ID, runtime UUID, generation, requestId and kind rules', () => {
  const base = {
    id: VALID_ID,
    runtimeInstanceId: VALID_RUNTIME,
    generation: 1,
    requestId: 'req-0001',
    kind: 'prompt',
    text: 'Run unit tests',
  };
  const validPrompt = validateOmpCommandPayload(base);
  assert.equal(validPrompt.ok, true);
  assert.equal(validPrompt.command.kind, 'prompt');

  // Foreign Claude ID or crafted ID
  assert.equal(validateOmpCommandPayload({ ...base, id: 's-claude-123' }).code, 'COMMAND_FOREIGN_SESSION');
  assert.equal(validateOmpCommandPayload({ ...base, id: 'omp:not-hex' }).code, 'COMMAND_INVALID_SESSION');

  // Bad runtimeInstanceId / generation / requestId
  assert.equal(validateOmpCommandPayload({ ...base, runtimeInstanceId: 'not-a-uuid' }).code, 'COMMAND_INVALID_RUNTIME');
  assert.equal(validateOmpCommandPayload({ ...base, generation: 0 }).code, 'COMMAND_INVALID_GENERATION');
  assert.equal(validateOmpCommandPayload({ ...base, generation: -1 }).code, 'COMMAND_INVALID_GENERATION');
  assert.equal(validateOmpCommandPayload({ ...base, requestId: 'ab' }).code, 'COMMAND_INVALID_REQUEST_ID');
  assert.equal(validateOmpCommandPayload({ ...base, requestId: 'bad space id' }).code, 'COMMAND_INVALID_REQUEST_ID');

  // Unknown keys (e.g. UI trying to pass canPrompt or cwd)
  assert.equal(validateOmpCommandPayload({ ...base, canPrompt: true }).code, 'COMMAND_INVALID');
  assert.equal(validateOmpCommandPayload({ ...base, cwd: 'C:\\evil' }).code, 'COMMAND_INVALID');

  // Abort must not carry text or queue
  assert.equal(validateOmpCommandPayload({
    id: VALID_ID, runtimeInstanceId: VALID_RUNTIME, generation: 2, requestId: 'req-abort-1', kind: 'abort',
  }).ok, true);
  assert.equal(validateOmpCommandPayload({
    id: VALID_ID, runtimeInstanceId: VALID_RUNTIME, generation: 2, requestId: 'req-abort-2', kind: 'abort', text: 'no',
  }).code, 'COMMAND_INVALID');

  // queueRemove requires valid queue ("steering" or "followUp") and text
  assert.equal(validateOmpCommandPayload({
    id: VALID_ID, runtimeInstanceId: VALID_RUNTIME, generation: 2, requestId: 'req-rm-1',
    kind: 'queueRemove', text: 'queued msg', queue: 'steering',
  }).ok, true);
  assert.equal(validateOmpCommandPayload({
    id: VALID_ID, runtimeInstanceId: VALID_RUNTIME, generation: 2, requestId: 'req-rm-2',
    kind: 'queueRemove', text: 'queued msg', queue: 'invalid',
  }).code, 'COMMAND_INVALID_QUEUE');
});

test('canAcceptCommandInState separates idle prompt from busy steer/followUp and abort', () => {
  const idleState = { connection: 'connected', lifecycle: 'open', activity: 'idle', isStreaming: false, officeReadOnly: false, queuedCount: 0 };
  const busyState = { connection: 'connected', lifecycle: 'open', activity: 'active', isStreaming: true, officeReadOnly: false, queuedCount: 1 };

  assert.equal(canAcceptCommandInState('prompt', idleState).ok, true);
  assert.equal(canAcceptCommandInState('prompt', busyState).code, 'COMMAND_SESSION_BUSY');

  assert.equal(canAcceptCommandInState('steer', idleState).code, 'COMMAND_SESSION_IDLE');
  assert.equal(canAcceptCommandInState('followUp', idleState).code, 'COMMAND_SESSION_IDLE');
  assert.equal(canAcceptCommandInState('steer', busyState).ok, true);
  assert.equal(canAcceptCommandInState('followUp', busyState).ok, true);

  assert.equal(canAcceptCommandInState('abort', idleState).code, 'COMMAND_NOTHING_TO_ABORT');
  assert.equal(canAcceptCommandInState('abort', busyState).ok, true);
  assert.equal(canAcceptCommandInState('abort', { ...idleState, queuedCount: 1 }).ok, true);

  assert.equal(canAcceptCommandInState('queueRemove', idleState).code, 'COMMAND_QUEUE_EMPTY');
  assert.equal(canAcceptCommandInState('queueRemove', busyState).ok, true);

  // Disconnected, ended or read-only sessions reject all commands
  assert.equal(canAcceptCommandInState('prompt', { ...idleState, connection: 'stale' }).code, 'COMMAND_DISCONNECTED');
  assert.equal(canAcceptCommandInState('prompt', { ...idleState, lifecycle: 'ended' }).code, 'COMMAND_DISCONNECTED');
  assert.equal(canAcceptCommandInState('prompt', { ...idleState, officeReadOnly: true }).code, 'COMMAND_READ_ONLY');
});
