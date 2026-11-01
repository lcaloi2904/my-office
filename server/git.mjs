// Git in the office. For each open session's folder: the repository's branch, how many files are changed and not yet
// committed (that desk gets messier), commits and pushes (the printer prints, the rocket launches), and the latest CI run
// on GitHub (a red beacon in the server room when it fails). Commits and pushes are noticed by watching HEAD and the
// upstream, so they count whether Claude or you made them. Read with `git` and `gh` on this Mac, only while an office
// page is open; nothing is written. OFFICE_CI=0 stops the GitHub check.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';

const run = (cmd, args, cwd, timeout = 5000) => new Promise((res) => {
  execFile(cmd, args, { cwd, timeout, maxBuffer: 4 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => res(err ? null : String(out)));
});
// gh: GH_PATH, the usual install places, then anywhere on PATH (gh.exe on Windows)
const EXE = process.platform === 'win32' ? 'gh.exe' : 'gh';
const GH = [process.env.GH_PATH, path.join(os.homedir(), '.local/bin/gh'), '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh',
  ...(process.platform === 'win32' ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', EXE)] : []),
  ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, EXE))].find((p) => p && fs.existsSync(p)) || null;
const CI_ON = process.env.OFFICE_CI !== '0';

const canonical = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
const identityHash = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

// Local plumbing only: no status, remote, gh or CI calls. Real git common-dir groups linked worktrees, not basenames.
export async function readGitIdentity(cwd, { io = fsp, runGit = run } = {}) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || /[\x00-\x1f]/.test(cwd) || /^[\\/]{2}/.test(cwd) ||
    (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(cwd))) return null;
  try {
    const rootText = await runGit('git', ['rev-parse', '--show-toplevel'], cwd);
    if (!rootText?.trim()) return null;
    const root = await io.realpath(rootText.trim());
    const realCwd = await io.realpath(cwd), relative = path.relative(root, realCwd);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return null;
    const commonText = await runGit('git', ['rev-parse', '--git-common-dir'], root);
    if (!commonText?.trim()) return null;
    const common = await io.realpath(path.resolve(root, commonText.trim()));
    if (!(await io.lstat(root)).isDirectory() || !(await io.lstat(common)).isDirectory()) return null;
    return { root, projectKey: identityHash(['local-git', canonical(common)]),
      worktreeKey: identityHash(['local-git-worktree', canonical(common), canonical(root)]) };
  } catch { return null; }
}
/**
 * @param {{ onRepo: (r: object) => void, onCommit: (r: object, subject: string) => void, onPush: (r: object) => void, onCi: (r: object, was: string|null) => void }} o
 */
export function createGit({ onRepo, onCommit, onPush, onCi }) {
  const roots = new Map();   // folder -> its repository root, '' when it is not in one
  const repos = new Map();   // root -> { root, name, branch, dirty, ahead, head, upstream, ci, ciName, ciUrl, born }
  const identities = new Map();   // cwd -> verified local opaque identity, never inferred from a display name
  let polling = null, ciPolling = null;

  async function rootOf(cwd) {
    if (!cwd) return '';
    if (!roots.has(cwd)) {
      const identity = await readGitIdentity(cwd);
      roots.set(cwd, identity?.root || '');
      if (identity) identities.set(cwd, { projectKey: identity.projectKey, worktreeKey: identity.worktreeKey });
    }
    return roots.get(cwd);
  }
  async function read(root) {
    // GIT_OPTIONAL_LOCKS=0: `git status` must not take the index lock while Claude is committing in the same repo
    const [status, head, upstream, ahead] = await Promise.all([
      run('git', ['status', '--porcelain=v1', '--branch', '--untracked-files=normal'], root, 8000),
      run('git', ['rev-parse', 'HEAD'], root),
      run('git', ['rev-parse', '@{u}'], root),
      run('git', ['rev-list', '--count', '@{u}..HEAD'], root),
    ]);
    if (status == null) return null;
    const lines = status.split('\n').filter(Boolean);
    const branch = (lines[0] || '').replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0].trim();
    return { branch, dirty: Math.max(0, lines.length - 1), head: (head || '').trim(), upstream: (upstream || '').trim(), ahead: Number(ahead) || 0 };
  }
  async function pollNow(cwds) {
    const live = new Set();
    for (const cwd of new Set(cwds)) { const r = await rootOf(cwd); if (r) live.add(r); }
    for (const root of live) {
      const now = await read(root); if (!now) continue;
      const was = repos.get(root), cur = { ...(was || { ci: null, ciName: '', ciUrl: '' }), ...now, root, name: path.basename(root) };
      // its birthday, once: the oldest root commit's date (the office's monthly party, people/hr.js)
      if (cur.born === undefined) cur.born = (((await run('git', ['log', '--max-parents=0', '--reverse', '--format=%as'], root)) || '').trim().split('\n')[0]) || null;
      repos.set(root, cur);
      if (was?.head && now.head && now.head !== was.head) {
        const subject = ((await run('git', ['log', '-1', '--pretty=%s'], root)) || '').trim();
        onCommit(cur, subject);
      }
      if (was && now.upstream && now.upstream !== was.upstream && now.upstream === now.head) onPush(cur);
      if (!was || was.dirty !== cur.dirty || was.branch !== cur.branch || was.ahead !== cur.ahead) onRepo(cur);
    }
    for (const root of [...repos.keys()]) if (!live.has(root)) repos.delete(root);
  }
  async function pollCiNow() {
    if (!CI_ON || !GH) return;
    for (const r of [...repos.values()]) {
      if (!r.branch) continue;
      const out = await run(GH, ['run', 'list', '--limit', '10', '--branch', r.branch, '--json', 'status,conclusion,workflowName,url,event'], r.root, 15000);
      if (out == null) continue;   // not a GitHub repository, offline, or gh not logged in
      // the checks of the code (runs started by a push or a pull request), not a scheduled job that happens to be newer
      let runs; try { runs = JSON.parse(out); } catch { continue; }
      const last = runs.find((x) => x.event === 'push' || x.event === 'pull_request') || runs[0];
      const state = !last ? null : last.status !== 'completed' ? 'running' : last.conclusion === 'success' ? 'green'
        : ['failure', 'timed_out', 'startup_failure'].includes(last.conclusion) ? 'red' : null;
      const was = r.ci;
      Object.assign(r, { ci: state, ciName: last?.workflowName || '', ciUrl: last?.url || '' });
      if (was !== state) { onRepo(r); if (state === 'red' || (was === 'red' && state === 'green')) onCi(r, was); }
    }
  }
  return {
    // one poll at a time; a second request while one runs is dropped
    poll: (cwds) => (polling ??= pollNow(cwds).finally(() => { polling = null; })),
    pollCi: () => (ciPolling ??= pollCiNow().finally(() => { ciPolling = null; })),
    repoOf: (cwd) => repos.get(roots.get(cwd)) || null,
    rootOf,
    identityOf: (cwd) => identities.get(cwd) || null,
    ghAvailable: !!GH && CI_ON,
  };
}
