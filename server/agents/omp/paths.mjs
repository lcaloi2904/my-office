// Explicit source allowlist. No home/profile discovery, SDK loading or source writes.
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const fault = (code) => Object.assign(new Error(code), { code });
export const errorCode = (e) => ['ENOENT', 'EACCES', 'EPERM', 'EMFILE', 'EIO', 'ABORT_ERR', 'PATH_DENIED', 'SOURCE_CHANGED', 'CONFIG_INVALID'].includes(e?.code) ? e.code : 'READ_FAILED';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(s);
const driveAbsolute = (s) => /^[a-z]:[\\/]/i.test(s) && !s.slice(2).includes(':');
const nativeAbsolute = (s) => typeof s === 'string' && s.length <= 4096 && path.isAbsolute(s) && !/[\x00-\x1f]/.test(s) && !/^[\\/]{2}/.test(s) && (process.platform === 'win32' ? driveAbsolute(s) : !s.includes('\\'));

export const DEFAULT_LIMITS = Object.freeze({
  // sized for a real tree: hundreds of sessions in one project folder, one artifact folder per session, children counted in maxSessions
  maxSessions: 2048, maxPins: 8, maxDepth: 5, scanEntries: 1024, maxDirectories: 1024,
  maxFileBytes: 8 * 1024 * 1024, maxLineBytes: 64 * 1024, chunkBytes: 32 * 1024,
  bytesPerTick: 128 * 1024, maxEntries: 4096, maxIndexBytes: 1024 * 1024,
  pollMs: 2000, reconcileMs: 60000, ttlMs: 15 * 60 * 1000,
});

export function validateConfig(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 8) throw fault('CONFIG_INVALID');
  const limits = { ...DEFAULT_LIMITS };
  if (raw.limits != null && (typeof raw.limits !== 'object' || Array.isArray(raw.limits))) throw fault('CONFIG_INVALID');
  for (const [key, n] of Object.entries(raw.limits || {})) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(n) || n <= 0 || n > DEFAULT_LIMITS[key]) throw fault('CONFIG_INVALID');
    limits[key] = n;
  }
  if (limits.pollMs < 100 || limits.reconcileMs < 100 || limits.chunkBytes > limits.bytesPerTick) throw fault('CONFIG_INVALID');
  const seen = new Set();
  const sources = raw.sources.map((s) => {
    if (!s || !validId(s.id) || seen.has(s.id) || !nativeAbsolute(s.root) || !['win32', 'posix'].includes(s.pathStyle) || (s.conversation !== undefined && typeof s.conversation !== 'boolean')) throw fault('CONFIG_INVALID');
    seen.add(s.id);
    const mappings = s.projectMappings ?? [];
    if (!Array.isArray(mappings) || mappings.length > 32) throw fault('CONFIG_INVALID');
    const style = s.pathStyle === 'win32' ? path.win32 : path.posix;
    const projectMappings = mappings.map((m) => {
      if (!m || !validId(m.projectId) || !validId(m.worktreeId) || typeof m.from !== 'string' || m.from.length > 4096 || !style.isAbsolute(m.from) || (s.pathStyle === 'win32' && !driveAbsolute(m.from)) || /^[\\/]{2}/.test(m.from) || /[\x00-\x1f]/.test(m.from)) throw fault('CONFIG_INVALID');
      if (m.localRoot !== undefined && !nativeAbsolute(m.localRoot)) throw fault('CONFIG_INVALID');
      return { from: style.normalize(m.from), projectId: m.projectId, worktreeId: m.worktreeId,
        ...(m.localRoot === undefined ? {} : { localRoot: path.resolve(m.localRoot) }) };
    });
    return { id: s.id, root: path.resolve(s.root), pathStyle: s.pathStyle, conversation: s.conversation === true, projectMappings };
  });
  return { version: 1, sources, limits };
}

export function projectIdentity(source, cwd, verifiedMappings = null) {
  if (typeof cwd !== 'string' || cwd.length > 4096 || /[\x00-\x1f]/.test(cwd) || /^[\\/]{2}/.test(cwd)) return { projectKey: null, worktreeKey: null };
  const style = source.pathStyle === 'win32' ? path.win32 : path.posix;
  if (!style.isAbsolute(cwd) || (source.pathStyle === 'win32' && !driveAbsolute(cwd))) return { projectKey: null, worktreeKey: null };
  for (const m of [...source.projectMappings].sort((a, b) => b.from.length - a.from.length)) {
    const rel = style.relative(m.from, cwd);
    if (rel === '' || (!style.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + style.sep))) {
      const verified = verifiedMappings?.get(m.from);
      if (verified) return { projectKey: verified.projectKey, worktreeKey: verified.worktreeKey };
      return { projectKey: digest([source.id, m.projectId]), worktreeKey: digest([source.id, m.projectId, m.worktreeId]) };
    }
  }
  return { projectKey: null, worktreeKey: null };
}

const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Reject symlinks/junctions in every existing path component, not only the leaf. With `inside` (an approved root) the
// components down to and including the root are skipped: approveRoot checked them, and every call re-verifies the root's
// identity; the realpath comparison below still covers the whole path.
async function checkChain(target, io, inside = null) {
  const absolute = path.resolve(target), base = path.parse(absolute).root;
  const skip = inside ? path.resolve(inside).slice(base.length).split(path.sep).filter(Boolean).length : 0;
  let current = base, index = 0;
  for (const part of absolute.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (index++ < skip) continue;
    const st = await io.lstat(current);
    if (st.isSymbolicLink()) throw fault('PATH_DENIED');
  }
  if (!samePath(await io.realpath(absolute), absolute)) throw fault('PATH_DENIED');
}

export async function approveRoot(root, io = fsp) {
  if (!nativeAbsolute(root)) throw fault('CONFIG_INVALID');
  const absolute = path.resolve(root);
  await checkChain(absolute, io);
  const st = await io.lstat(absolute);
  if (!st.isDirectory()) throw fault('PATH_DENIED');
  return Object.freeze({ path: absolute, dev: st.dev, ino: st.ino });
}

export async function containedPath(root, relative, io = fsp) {
  if (typeof relative !== 'string' || relative.length > 4096 || /[\x00-\x1f:]/.test(relative) || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) throw fault('PATH_DENIED');
  const currentRoot = await io.lstat(root.path);
  if (!sameFile(root, currentRoot) || !currentRoot.isDirectory() || currentRoot.isSymbolicLink()) throw fault('SOURCE_CHANGED');
  const candidate = path.resolve(root.path, relative || '.');
  const rel = path.relative(root.path, candidate);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) throw fault('PATH_DENIED');
  await checkChain(candidate, io, root.path);
  return candidate;
}

// Verify identity again after open and before the first read. Handles never escape unclosed on failure.
export async function openContained(root, relative, io = fsp) {
  const file = await containedPath(root, relative, io), before = await io.lstat(file);
  if (!before.isFile() || before.nlink > 1) throw fault('PATH_DENIED');
  const handle = await io.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.nlink > 1 || !sameFile(before, after)) throw fault('SOURCE_CHANGED');
    await containedPath(root, relative, io);
    if (!sameFile(after, await io.lstat(file))) throw fault('SOURCE_CHANGED');
    return handle;
  } catch (e) { await handle.close(); throw e; }
}

export async function readConfigFile(file, io = fsp) {
  if (!nativeAbsolute(file)) throw fault('CONFIG_INVALID');
  const root = await approveRoot(path.dirname(file), io);
  const h = await openContained(root, path.basename(file), io);
  try {
    const st = await h.stat();
    if (st.size > 64 * 1024) throw fault('CONFIG_INVALID');
    const buffer = Buffer.alloc(st.size + 1);
    const { bytesRead } = await h.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== st.size) throw fault('SOURCE_CHANGED');
    try { return validateConfig(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))); }
    catch { throw fault('CONFIG_INVALID'); }
  } finally { await h.close(); }
}
