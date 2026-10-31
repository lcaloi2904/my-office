// Generates synthetic OMP source folders and a config for the file-only E2E server. Synthetic text only:
// nothing is copied from a real agent, profile or home directory. Usage: node omp-fixture.mjs <output directory>
import fs from 'node:fs';
import path from 'node:path';
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
write(on, '2026_conv-newest.jsonl', 'e2e-conv-on', 10, [entry('u1', null, { message: { role: 'user', content: 'E2E synthetic user message' } }), assistant('a1', 'u1', { content: [{ type: 'text', text: 'E2E synthetic assistant reply' }] })]);
write(on, '2026_conv-older.jsonl', 'e2e-older', 600, [assistant('a1', null)]);
write(off, '2026_nocontent.jsonl', 'e2e-conv-off', 300, [entry('u1', null, { message: { role: 'user', content: 'E2E SECRET must never be readable' } }), assistant('a1', 'u1')]);
const mapping = [{ from: cwd, projectId: 'e2e', worktreeId: 'main' }];
const style = win ? 'win32' : 'posix';
fs.writeFileSync(path.join(out, 'omp-config.json'), JSON.stringify({ version: 1, sources: [
  { id: 'e2eon', root: on, pathStyle: style, conversation: true, projectMappings: mapping },
  { id: 'e2eoff', root: off, pathStyle: style, conversation: false, projectMappings: mapping },
] }));
