// Cost-free, isolated fake for the Phase 03/04 stdio subset. Not an OMP SDK or paid model.
const scenario = process.argv[2] || 'ok';
const id = '00000000-0000-4000-8000-000000000005';
let current = '00000000-0000-4000-8000-000000000002';
let isStreaming = false;
let isSettled = true;
let messageCount = 0;
const steering = [], followUp = [];
let buffer = '';
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
if (scenario === 'bad-ready') send({ type: 'ready', protocolVersion: 99 });
else if (scenario !== 'silent') send({ type: 'ready', protocolVersion: 1, maxFrameBytes: 1048576 });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    if (scenario === 'exit') { process.exit(1); }
    if (scenario === 'huge') { process.stdout.write('x'.repeat(1100000)); continue; }
    if (scenario === 'hang') continue;
    if (msg.type === 'new_session') {
      current = id;
      isStreaming = false;
      isSettled = true;
      messageCount = 0;
      steering.length = 0;
      followUp.length = 0;
      send({ id: msg.id, type: 'response', command: 'new_session', success: true, data: { cancelled: false } });
      continue;
    }
    if (msg.type === 'get_state') {
      send({
        id: msg.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          sessionId: scenario === 'wrong-id' ? 'other' : current,
          sessionFile: null,
          messageCount,
          isStreaming,
          isSettled,
          queuedMessages: { steering: [...steering], followUp: [...followUp], liveSteered: 0 },
          systemPrompt: 'NEVER_PUBLISH_RAW_STATE',
        },
      });
      continue;
    }
    if (msg.type === 'get_session_lease') {
      send({ id: msg.id, type: 'response', command: 'get_session_lease', success: true, data: { held: [], unknown: [] } });
      continue;
    }
    if (msg.type === 'prompt') {
      isStreaming = true;
      isSettled = false;
      messageCount += 1;
      send({ id: msg.id, type: 'response', command: 'prompt', success: true });
      send({ type: 'agent_start' });
      continue;
    }
    if (msg.type === 'steer') {
      steering.push(String(msg.message || ''));
      send({ id: msg.id, type: 'response', command: 'steer', success: true });
      continue;
    }
    if (msg.type === 'follow_up') {
      followUp.push(String(msg.message || ''));
      send({ id: msg.id, type: 'response', command: 'follow_up', success: true });
      continue;
    }
    if (msg.type === 'remove_queued_message') {
      const list = msg.queue === 'steering' ? steering : followUp;
      const idx = list.indexOf(String(msg.message || ''));
      const removed = idx >= 0;
      if (removed) list.splice(idx, 1);
      send({ id: msg.id, type: 'response', command: 'remove_queued_message', success: true, data: { removed } });
      continue;
    }
    if (msg.type === 'abort') {
      isStreaming = false;
      isSettled = true;
      send({ id: msg.id, type: 'response', command: 'abort', success: true });
      send({ type: 'prompt_result', status: 'aborted', agentInvoked: true, sessionSettled: true });
      send({ type: 'session_settled' });
      continue;
    }
    send({ id: msg.id, type: 'response', command: msg.type, success: false });
  }
});
process.stdin.on('end', () => process.exit(0));
