// Explicit allowlists for native Windows OMP launch. No HTTP-supplied paths, argv or process IDs.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { approveRoot, containedPath, openContained } from './paths.mjs';

const fault = (code) => Object.assign(new Error(code), { code });
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/;
const PUBLIC = /^omp:[0-9a-f]{64}$/;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const fileKey = (st) => String(st.dev) + ':' + String(st.ino);
const binaryIdentity = (st) => [st.dev, st.ino, st.size, st.mtimeMs, st.birthtimeMs, st.nlink].join(':');
const fileSignature = (st) => binaryIdentity(st) + ':' + st.ctimeMs;
const nativePath = (s) => typeof s === 'string' && s.length > 0 && s.length <= 4096 &&
  path.isAbsolute(s) && !/[\u0000-\u001f\u007f]/.test(s) && !/^[\\/]{2}/.test(s) &&
  (process.platform !== 'win32' || /^[a-zA-Z]:[\\/]/.test(s));
const ownKeys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k));

export function validateOmpLaunchConfig(raw) {
  if (!ownKeys(raw, ['version', 'binary', 'projects', 'profiles', 'resumeProtocol']) || raw.version !== 1 ||
    (raw.resumeProtocol !== undefined && raw.resumeProtocol !== 1) ||
    !nativePath(raw.binary) || (process.platform === 'win32' && !/\.exe$/i.test(raw.binary)) ||
    !Array.isArray(raw.projects) || !raw.projects.length || raw.projects.length > 16 ||
    !Array.isArray(raw.profiles) || !raw.profiles.length || raw.profiles.length > 8) throw fault('LAUNCH_CONFIG_INVALID');
  const projects = new Map(), profiles = new Map();
  for (const p of raw.projects) {
    if (!ownKeys(p, ['alias', 'root', 'sourceId', 'sessionDir', 'ownerDir']) || !ALIAS.test(p.alias || '') ||
      !ALIAS.test(p.sourceId || '') || !nativePath(p.root) || !nativePath(p.sessionDir) ||
      (raw.resumeProtocol === 1 ? !nativePath(p.ownerDir) : p.ownerDir !== undefined) ||
      projects.has(p.alias)) throw fault('LAUNCH_CONFIG_INVALID');
    projects.set(p.alias, { alias: p.alias, root: path.resolve(p.root), sourceId: p.sourceId,
      sessionDir: path.resolve(p.sessionDir), ownerDir: p.ownerDir ? path.resolve(p.ownerDir) : null });
  }
  for (const p of raw.profiles) {
    if (!ownKeys(p, ['alias', 'name', 'homeRoot', 'model']) || !ALIAS.test(p.alias || '') ||
      !ALIAS.test(p.name || '') || !MODEL.test(p.model || '') || !nativePath(p.homeRoot) ||
      profiles.has(p.alias)) throw fault('LAUNCH_CONFIG_INVALID');
    profiles.set(p.alias, { alias: p.alias, name: p.name, model: p.model, homeRoot: path.resolve(p.homeRoot) });
  }
  return { binary: path.resolve(raw.binary), projects, profiles, resumeProtocol: raw.resumeProtocol ?? null };
}

export async function readOmpLaunchConfig(file, io = fsp) {
  if (!nativePath(file) || path.extname(file).toLowerCase() !== '.json') throw fault('LAUNCH_CONFIG_INVALID');
  const dir = await approveRoot(path.dirname(file), io);
  const fh = await openContained(dir, path.basename(file), io);
  try {
    const st = await fh.stat();
    if (st.size < 2 || st.size > 65536) throw fault('LAUNCH_CONFIG_INVALID');
    const data = Buffer.alloc(st.size), { bytesRead } = await fh.read(data, 0, st.size, 0);
    if (bytesRead !== st.size) throw fault('SOURCE_CHANGED');
    try { return validateOmpLaunchConfig(JSON.parse(data.toString('utf8'))); }
    catch { throw fault('LAUNCH_CONFIG_INVALID'); }
  } finally { await fh.close(); }
}

export async function createOmpLaunchResolver({ config, configFile, adapter, io = fsp } = {}) {
  if (!adapter || typeof adapter.candidateForLaunch !== 'function') throw fault('LAUNCH_CONFIG_INVALID');
  const cfg = config ? validateOmpLaunchConfig(config) : await readOmpLaunchConfig(configFile, io);
  const binaryDir = await approveRoot(path.dirname(cfg.binary), io);
  const bin = await containedPath(binaryDir, path.basename(cfg.binary), io);
  const binStat = await io.lstat(bin);
  if (!binStat.isFile() || binStat.isSymbolicLink() || binStat.nlink !== 1 ||
    !same(bin, cfg.binary)) throw fault('LAUNCH_BINARY_INVALID');
  const hashBinary = async (expected) => {
    const handle = await openContained(binaryDir, path.basename(bin), io);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 ||
        fileSignature(before) !== fileSignature(expected)) throw fault('LAUNCH_BINARY_CHANGED');
      const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < before.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
        if (bytesRead <= 0) throw fault('LAUNCH_BINARY_CHANGED');
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      const after = await handle.stat();
      await containedPath(binaryDir, path.basename(bin), io);
      const current = await io.lstat(bin);
      if (!after.isFile() || !current.isFile() || current.isSymbolicLink() ||
        fileSignature(after) !== fileSignature(before) ||
        fileSignature(current) !== fileSignature(before)) throw fault('LAUNCH_BINARY_CHANGED');
      return hash.digest('hex');
    } finally { await handle.close(); }
  };
  const binaryHash = await hashBinary(binStat);
  let verifiedSignature = fileSignature(binStat);
  for (const p of cfg.projects.values()) {
    p.rootHandle = await approveRoot(p.root, io);
    p.sessionHandle = await approveRoot(p.sessionDir, io);
    if (p.ownerDir) p.ownerHandle = await approveRoot(p.ownerDir, io);
    const source = adapter.sourceForLaunch?.(p.sourceId);
    if (!source || !same(source.sourceRoot, p.sessionDir)) throw fault('LAUNCH_SOURCE_MISMATCH');
  }
  for (const p of cfg.profiles.values()) p.homeHandle = await approveRoot(p.homeRoot, io);
  const verify = async (projectAlias, profileAlias) => {
    const project = cfg.projects.get(projectAlias), profile = cfg.profiles.get(profileAlias);
    if (!project || !profile) throw fault('LAUNCH_NOT_ALLOWED');
    const source = adapter.sourceForLaunch?.(project.sourceId);
    if (!source || !same(source.sourceRoot, project.sessionDir)) throw fault('LAUNCH_SOURCE_MISMATCH');
    await containedPath(binaryDir, path.basename(bin), io);
    const currentBin = await io.lstat(bin);
    if (!currentBin.isFile() || currentBin.isSymbolicLink() ||
      binaryIdentity(currentBin) !== binaryIdentity(binStat) ||
      !same(await io.realpath(bin), bin)) throw fault('LAUNCH_BINARY_CHANGED');
    if (fileSignature(currentBin) !== verifiedSignature) {
      // Windows execution can add kernel EAs and change only ctime. Accept that metadata
      // only after checking every byte against the startup pin through a stable, contained handle.
      if (await hashBinary(currentBin) !== binaryHash) throw fault('LAUNCH_BINARY_CHANGED');
      verifiedSignature = fileSignature(currentBin);
    }
    for (const item of [project.rootHandle, project.sessionHandle, profile.homeHandle, project.ownerHandle].filter(Boolean)) {
      const current = await io.lstat(item.path);
      if (!current.isDirectory() || current.isSymbolicLink() || fileKey(current) !== fileKey(item) ||
        !same(await io.realpath(item.path), item.path)) throw fault('SOURCE_CHANGED');
    }
    return { project, profile };
  };
  const candidate = async (id, project) => {
    if (!PUBLIC.test(id || '')) throw fault('LAUNCH_INVALID_CANDIDATE');
    // Only the adapter's indexed, unique, supported catalogue entry. Do not accept user-supplied paths.
    const info = adapter.candidateForLaunch(id);
    if (!info || info.sourceId !== project.sourceId || !same(info.sourceRoot, project.sessionDir) ||
      !same(path.resolve(info.cwd || ''), project.root)) throw fault('LAUNCH_INVALID_CANDIDATE');
    if (info.ownerUnknown || info.runtimeObserved) throw fault('LAUNCH_OWNER_UNKNOWN');
    const handle = await openContained(project.sessionHandle, info.relative, io);
    try {
      const st = await handle.stat();
      if (st.size < 1 || st.size > 8 * 1024 * 1024 || fileKey(st) !== info.fileKey ||
        st.size !== info.fileSize || st.mtimeMs !== info.fileMtime || st.ctimeMs !== info.fileCtime) throw fault('SOURCE_CHANGED');
      const buf = Buffer.alloc(Math.min(st.size, 8192));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const parts = buf.subarray(0, bytesRead).toString('utf8').split('\n');
      parts.pop();
      let header = null;
      for (const line of parts) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { throw fault('LAUNCH_INVALID_CANDIDATE'); }
        if (parsed?.type === 'title') continue;
        header = parsed;
        break;
      }
      if (header?.type !== 'session' || header.version !== 3 || header.id !== info.sessionId ||
        !same(path.resolve(header.cwd || ''), project.root) || st.nlink !== 1) throw fault('LAUNCH_INVALID_CANDIDATE');
      const hash = createHash('sha256').update(buf.subarray(0, bytesRead));
      const chunk = Buffer.alloc(64 * 1024);
      let offset = bytesRead;
      while (offset < st.size) {
        const read = await handle.read(chunk, 0, Math.min(chunk.length, st.size - offset), offset);
        if (read.bytesRead <= 0) throw fault('SOURCE_CHANGED');
        hash.update(chunk.subarray(0, read.bytesRead));
        offset += read.bytesRead;
      }
      const exactFile = await containedPath(project.sessionHandle, info.relative, io);
      if (fileSignature(await handle.stat()) !== fileSignature(st) ||
        fileSignature(await io.lstat(exactFile)) !== fileSignature(st)) throw fault('SOURCE_CHANGED');
      return { ...info, exactFile, sha256: hash.digest('hex'),
        fingerprint: JSON.stringify([fileKey(st), st.size, st.mtimeMs, st.ctimeMs]) };
    } finally { await handle.close(); }
  };
  const build = async ({ projectAlias, profileAlias, mode = 'new', candidateId } = {}) => {
    if (mode !== 'new' && mode !== 'resume') throw fault('LAUNCH_INVALID');
    const { project, profile } = await verify(projectAlias, profileAlias);
    if (mode === 'resume' && cfg.resumeProtocol !== 1) throw fault('LAUNCH_OWNER_UNVERIFIED');
    const checked = mode === 'resume' ? await candidate(candidateId, project) : null;
    // All arguments come from an owner-approved server config, never from request body.
    const args = ['--profile', profile.name, '--mode', 'rpc', '--no-extensions', '--no-skills',
      '--no-rules', '--no-context-files', '--no-tools', '--no-lsp', '--no-title', '--no-prewalk',
      '--thinking', 'off', '--model', profile.model,
      '--cwd', project.root, '--session-dir', project.sessionDir,
      ...(checked ? ['--resume', checked.exactFile, '--office-resume-id', checked.sessionId,
        '--office-resume-sha256', checked.sha256, '--office-owner-dir', project.ownerDir] : [])];
    return { binary: bin, args, cwd: project.root, profile, project, candidate: checked };
  };
  const safeInfo = () => ({
    resumeAvailable: cfg.resumeProtocol === 1,
    projects: [...cfg.projects.values()].map((p) => ({ alias: p.alias, sourceId: p.sourceId })),
    profiles: [...cfg.profiles.values()].map((p) => ({ alias: p.alias })),
  });
  return { build, safeInfo };
}
