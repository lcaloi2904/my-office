// Generates synthetic OMP source folders and a config for the file-only E2E server. Synthetic text only:
// nothing is copied from a real agent, profile or home directory. Usage: node omp-fixture.mjs <output directory>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writePrivateJson } from '../../integrations/omp/private-storage.js';
import { header, entry, assistant, lines } from '../fixtures/omp/synthetic.mjs';

const out = process.argv[2];
if (!out || !path.isAbsolute(out)) { console.error('omp-fixture: an absolute output directory is required'); process.exit(2); }
fs.rmSync(out, { recursive: true, force: true });
const win = process.platform === 'win32', cwd = win ? String.raw`C:\fixture\projects\e2e-repo` : '/fixture/projects/e2e-repo';
const source = (name) => { const dir = path.join(out, name); fs.mkdirSync(path.join(dir, 'proj'), { recursive: true }); return fs.realpathSync(dir); };
const write = (root, file, id, ageSeconds, records) => {
  const target = path.join(root, 'proj', file);
  fs.writeFileSync(target, lines([header({ id, cwd }), ...records]));
  const t = new Date(Date.now() - ageSeconds * 1000); fs.utimesSync(target, t, t);
};
const on = source('omp-on'), off = source('omp-off');
const messages = [entry('u1', null, { message: { role: 'user', content: 'E2E synthetic user message' } })];
for (let i = 0; i < 130; i++) messages.push(assistant('page-' + i, i ? 'page-' + (i - 1) : 'u1', { content: [{ type: 'text', text: 'Synthetic page message ' + i }] }));
messages.push(
  assistant('calls', 'page-129', { content: [{ type: 'toolCall', id: 'safe-call', name: 'read', arguments: { secret: 'NEVER_RENDER_TOOL_ARGUMENTS' } }] }),
  entry('result', 'calls', { message: { role: 'toolResult', toolCallId: 'safe-call', isError: true, content: [{ type: 'text', text: 'NEVER_RENDER_TOOL_OUTPUT' }] } }),
  entry('branch', 'result', { type: 'branch_summary', summary: 'Synthetic branch note' }),
  assistant('a1', 'branch', { content: [{ type: 'text', text: 'E2E synthetic assistant reply\\nLiteral <img src=x onerror=\"window.__injected=true\">' }] }),
);
write(on, '2026_conv-newest.jsonl', 'e2e-conv-on', 10, messages);
const childDir = path.join(on, 'proj', '2026_conv-newest');
fs.mkdirSync(path.join(childDir, 'Child1'), { recursive: true });
const child = (file, id) => fs.writeFileSync(file, lines([header({ id, cwd }),
  entry('init', null, { type: 'session_init', task: 'NEVER_RENDER_CHILD_TASK', systemPrompt: 'NEVER_RENDER_CHILD_SYSTEM' }),
  assistant('reply', 'init', { content: [{ type: 'text', text: 'Synthetic child reply ' + id }] }),
]));
child(path.join(childDir, 'Child1.jsonl'), 'child-session');
child(path.join(childDir, 'Child1', 'Nested.jsonl'), 'nested-session');
write(on, '2026_conv-older.jsonl', 'e2e-older', 600, [assistant('a1', null)]);
write(off, '2026_nocontent.jsonl', 'e2e-conv-off', 300, [entry('u1', null, { message: { role: 'user', content: 'E2E SECRET must never be readable' } }), assistant('a1', 'u1')]);
const mapping = [{ from: cwd, projectId: 'e2e', worktreeId: 'main' }];
const style = win ? 'win32' : 'posix';
fs.writeFileSync(path.join(out, 'omp-config.json'), JSON.stringify({ version: 1, sources: [
  { id: 'e2eon', root: on, pathStyle: style, conversation: true, projectMappings: mapping },
  { id: 'e2eoff', root: off, pathStyle: style, conversation: false, projectMappings: mapping },
] }));
if (process.argv[3] === '--hybrid') {
  const data = process.argv[4], expected = path.resolve(out, '..', 'office-data');
  if (!data || path.resolve(data) !== expected) throw new Error('omp-fixture: isolated sibling office-data required');
  fs.mkdirSync(data, { recursive: true });
  // A public synthetic credential, exclusively for the isolated test server.
  const tokenFile = process.env.OFFICE_OMP_INGEST_FILE;
  const prefix = 'my-office-e2e-' + createHash('sha256').update(path.resolve(out, '..')).digest('hex').slice(0, 16) + '-';
  if (!tokenFile || !path.isAbsolute(tokenFile) || path.basename(tokenFile) !== 'ingest.json' ||
      !new RegExp('^' + prefix + '[0-9a-f-]{36}$').test(path.basename(path.dirname(tokenFile)))) {
    throw new Error('omp-fixture: explicit isolated private token path required');
  }
  writePrivateJson(tokenFile, { version: 1, tokens: { e2eon: '5'.repeat(64), e2eoff: '6'.repeat(64) } });
  fs.writeFileSync(path.join(out, 'private-store.json'), JSON.stringify({ tokenFile }));
}
