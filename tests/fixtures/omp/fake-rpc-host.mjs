// Cost-free, isolated fake for the exact Phase 03 stdio subset. Not an OMP SDK or paid model.
const scenario = process.argv[2] || 'ok';
const id = '00000000-0000-4000-8000-000000000005';
let current = '00000000-0000-4000-8000-000000000002';
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
    if (msg.type === 'new_session') current = id;
    const data = msg.type === 'get_state'
      ? { sessionId: scenario === 'wrong-id' ? 'other' : current, sessionFile: null,
        messageCount: 0, isStreaming: false, isSettled: true, systemPrompt: 'NEVER_PUBLISH_RAW_STATE' }
      : msg.type === 'new_session' ? { cancelled: false }
        : msg.type === 'get_session_lease' ? { held: [], unknown: [] } : null;
    send({ id: msg.id, type: 'response', command: msg.type, success: data != null, data });
  }
});
process.stdin.on('end', () => process.exit(0));
