// File-only OMP adapter: bounded discovery, a paged catalogue, explicit pins and sequential polling.
// Read-only handles through paths.mjs only. No OMP runtime, SDK, home discovery, timers before start(), or source writes.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { approveRoot, containedPath, openContained, projectIdentity, readConfigFile, validateConfig, errorCode, DEFAULT_LIMITS } from './paths.mjs';
import { createReader } from './reader.mjs';
import { createNormalizer } from './normalize.mjs';
import { createOmpLifecycle } from './lifecycle.mjs';
import { ompSessionIdentity } from '../schema.mjs';
import { readGitIdentity } from '../../git.mjs';
import { conversationPage, emptyConversationPage } from '../conversation.mjs';

const PREFIX_BYTES = 8192, PREFIX_READS_PER_SCAN = 64, RECENT_COUNT = 16, MAX_PAGE = 50;
const READ_TIMEOUT_MS = 8000, MAX_READ_POLLS = 256, MAX_CONVERSATIONS = 2;
const MAX_CHILDREN = 128, CHILD_READS = 8, CHILD_PREFIX_BYTES = 64 * 1024;
const childIdOf = (relative) => {
  const stem = path.posix.basename(relative, '.jsonl');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(stem) && !stem.includes('.bak') && !stem.startsWith('__advisor') ? stem : null;
};
// A pinned file is read in slices; one pass keeps reading the same file for up to this long, so a large file is ready in a
// few passes rather than one slice per pass. Still one handle at a time, abortable between slices.
const PIN_PASS_BUDGET_MS = 200, SETTLED = new Set(['ready', 'unsupported', 'absent', 'degraded']);
// Display basename only: no separators, control characters or markup-looking input from a header.
const baseName = (source, cwd) => {
  if (typeof cwd !== 'string' || cwd.length > 4096) return '';
  const style = source.pathStyle === 'win32' ? path.win32 : path.posix;
  return style.basename(cwd).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
};
const sourceStateOf = (e) => e?.code === 'ENOENT' ? 'absent' : ['EACCES', 'EPERM', 'PATH_DENIED'].includes(e?.code) ? 'denied' : e?.code === 'SOURCE_CHANGED' ? 'changed' : 'degraded';

const SWEEP_MS = 5000;

// `live` (hybrid mode) adds runtime evidence from the observer ingress. It lives next to the file state so one
// conversation is one actor; without it nothing below the file reader exists.
export function createOmpAdapter({ config, configFile, io = fsp, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, pinStore = null, live = false, onChange = () => {} } = {}) {
  let cfg = null, started = false, disposed = false, state = 'idle', timer = null, sweepTimer = null, running = null, controller = new AbortController();
  let lastScan = 0, scanEpoch = 0, failures = 0, activeConversations = 0, pinsLoaded = false;
  const sources = new Map(), catalog = new Map(), byId = new Map(), conflicts = new Set(), pins = new Set(), unpinnedLive = new Set(), runtimes = new Map(), managed = new Map();
  const issues = new Set();
  const report = (code) => { if (issues.size < 24) issues.add(code); };
  const safe = (fn) => { try { fn(); } catch { /* a change listener never breaks the observer */ } };
  const tracked = (id) => pins.has(id) || managed.has(id) || (!!lifecycle?.resolve(id) && !unpinnedLive.has(id));
  const lifecycle = live ? createOmpLifecycle({ now, onChange: (ids) => {
    if (disposed) return;
    if (started && cfg) {
      syncRuntimes();
      if (setTimer === setTimeout && ids.some((id) => !fileRecordOf(id))) void run();
    }
    safe(() => onChange(ids));
  } }) : null;

  async function loadConfig() {
    try { cfg = config ? validateConfig(config) : await readConfigFile(configFile, io); }
    catch (e) { state = 'config-invalid'; report(errorCode(e)); return false; }
    for (const s of cfg.sources) sources.set(s.id, { cfg: s, root: null, state: 'pending', truncated: false });
    return true;
  }

  async function approve(source) {
    try { source.root = await approveRoot(source.cfg.root, io); source.state = 'ok'; }
    catch (e) { source.root = null; source.state = sourceStateOf(e); }
    source.identities = new Map();
    for (const mapping of source.cfg.projectMappings) {
      if (!mapping.localRoot) continue;
      const identity = await readGitIdentity(mapping.localRoot, { io });
      if (identity) source.identities.set(mapping.from, identity);
      else report('project-mapping-unverified');
    }
  }

  // Shallow breadth-first walk under the approved root. Entry, directory, depth and catalogue caps are explicit.
  // A folder below a session's own `<stem>.jsonl` holds that session's artifacts. Discovery only counts these files;
  // explicit pins inspect bounded task metadata prefixes separately.
  async function scanSource(source, signal) {
    const { limits } = cfg, found = [], seenFiles = new Set(), before = source.listings || new Map(), after = new Map();
    let directories = 0, truncated = false;
    const queue = [{ rel: '', depth: 0 }];
    while (queue.length && !signal.aborted) {
      const { rel, depth } = queue.shift();
      if (++directories > limits.maxDirectories) { truncated = true; break; }
      const artifact = !!rel && parentOf(rel + '/x', seenFiles) !== null;
      let dirPath;
      try { dirPath = await containedPath(source.root, rel, io); }
      catch (e) { if (!rel) throw e; report(errorCode(e)); continue; }
      const take = (child) => { seenFiles.add(child); found.push({ relative: child, size: 0, mtimeMs: 0, ctimeMs: 0, ino: '' }); };
      let listing = null;
      if (artifact) {
        try {
          const st = await io.lstat(dirPath), key = `${st.dev}:${st.ino}`, old = before.get(rel);
          listing = { key, mtimeMs: st.mtimeMs, files: [], dirs: [] };
          if (st.isDirectory() && !st.isSymbolicLink() && old && old.key === key && old.mtimeMs === st.mtimeMs) {
            for (const f of old.files) take(f);
            for (const d of old.dirs) queue.push({ rel: d, depth: depth + 1 });
            after.set(rel, old);
            continue;
          }
        } catch (e) { report(errorCode(e)); continue; }
      }
      let dir;
      try { dir = await io.opendir(dirPath); } catch (e) { if (!rel) throw e; report(errorCode(e)); continue; }
      let seen = 0, complete = true;
      try {
        for await (const d of dir) {
          if (signal.aborted) { complete = false; break; }
          if (++seen > limits.scanEntries) { truncated = true; complete = false; break; }
          const child = rel ? rel + '/' + d.name : d.name;
          if (d.isDirectory() && !d.isSymbolicLink()) {
            if (depth < limits.maxDepth) { queue.push({ rel: child, depth: depth + 1 }); listing?.dirs.push(child); } else { truncated = true; complete = false; }
            continue;
          }
          if (!d.isFile() || !d.name.endsWith('.jsonl')) continue;
          if (artifact) { take(child); listing.files.push(child); continue; }
          try {
            const file = await containedPath(source.root, child, io), st = await io.lstat(file);
            if (!st.isFile() || st.nlink > 1) continue;
            seenFiles.add(child);
            found.push({ relative: child, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: `${st.dev}:${st.ino}` });
          } catch (e) { report(errorCode(e)); }
        }
      } finally { await dir.close().catch(() => {}); }
      if (listing && complete) after.set(rel, listing);
    }
    if (!signal.aborted) source.listings = after;
    found.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.relative < b.relative ? -1 : 1));
    if (found.length > limits.maxSessions) { truncated = true; found.length = limits.maxSessions; }
    source.truncated = truncated;
    return found;
  }

  // Header/title prefix only: the first complete JSON line after an optional title slot.
  async function readHeader(source, relative) {
    const handle = await openContained(source.root, relative, io);
    try {
      const buffer = Buffer.alloc(PREFIX_BYTES), { bytesRead } = await handle.read(buffer, 0, PREFIX_BYTES, 0);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      lines.pop();   // the last piece has no newline yet: never a complete record
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim()) continue;
        let json; try { json = JSON.parse(line); } catch { return { supported: false }; }
        if (json?.type === 'title') continue;
        const identity = json?.type === 'session' && json.version === 3 ? ompSessionIdentity(source.cfg.id, json.id) : null;
        if (!identity) return { supported: false };
        return { supported: true, sessionId: json.id, id: identity.id, cwd: json.cwd };
      }
      return { supported: false, pending: true };
    } finally { await handle.close(); }
  }

  function parentOf(rel, rels) {
    const parts = rel.split('/');
    for (let i = parts.length - 1; i >= 1; i--) { const candidate = parts.slice(0, i).join('/') + '.jsonl'; if (rels.has(candidate)) return candidate; }
    return null;
  }

  async function scan(signal) {
    let reads = 0;
    const next = new Map();
    for (const source of sources.values()) {
      if (!source.root) await approve(source);
      if (!source.root) continue;
      let found;
      try { found = await scanSource(source, signal); source.state = 'ok'; }
      catch (e) { source.state = sourceStateOf(e); if (source.state === 'changed') source.root = null; report(errorCode(e)); continue; }
      const rels = new Set(found.map((f) => f.relative));
      for (const f of found) {
        const key = source.cfg.id + '\0' + f.relative, old = catalog.get(key);
        let entry = old && old.ino === f.ino && f.size >= old.size ? { ...old, ...f } : { ...f, header: null, label: '' };
        entry.parent = parentOf(f.relative, rels);
        // an artifact child is never an actor: its header is not read (it would use up the budget, children are the newest files)
        const h = entry.header, stale = !entry.parent && (!h || h.pending || (!h.supported && (h.size !== f.size || h.mtimeMs !== f.mtimeMs)));
        if (stale && reads < PREFIX_READS_PER_SCAN && !signal.aborted) {
          reads++;
          try { entry.header = { ...await readHeader(source, f.relative), size: f.size, mtimeMs: f.mtimeMs }; }
          catch (e) { report(errorCode(e)); entry.header = { supported: false, pending: true }; }
        }
        entry.sourceId = source.cfg.id;
        next.set(key, entry);
      }
    }
    if (signal.aborted) return;
    catalog.clear();
    for (const [key, entry] of next) catalog.set(key, entry);
    indexIds();
    lastScan = now(); scanEpoch++;
  }

  function indexIds() {
    byId.clear(); conflicts.clear();
    for (const entry of catalog.values()) {
      const id = entry.header?.supported && !entry.parent ? entry.header.id : null;
      if (!id) continue;
      if (byId.has(id) || conflicts.has(id)) { conflicts.add(id); byId.delete(id); } else byId.set(id, entry);
    }
  }

  // A scan reads a bounded number of headers. Between scans, the next batch of unread ones (newest first, the catalogue is
  // in that order) is read from the existing catalogue without listing the tree again. A header that is still not
  // readable waits one reconcile interval before it is tried again.
  async function fillHeaders(signal) {
    let reads = 0;
    for (const entry of catalog.values()) {
      if (reads >= PREFIX_READS_PER_SCAN || signal.aborted) break;
      const h = entry.header, source = sources.get(entry.sourceId);
      if (entry.parent || !source?.root || (h && !h.pending) || h?.retryAt > now()) continue;
      reads++;
      let header;
      try { header = { ...await readHeader(source, entry.relative), size: entry.size, mtimeMs: entry.mtimeMs }; }
      catch (e) { report(errorCode(e)); header = { supported: false, pending: true }; }
      if (header.pending) header.retryAt = now() + cfg.limits.reconcileMs;
      entry.header = header;
    }
    if (reads && !signal.aborted) indexIds();
  }

  function dropRuntime(id) {
    const rt = runtimes.get(id); if (!rt) return;
    runtimes.delete(id);
    void rt.reader.dispose().catch(() => {});
  }

  function syncRuntimes() {
    if (disposed) return;
    for (const id of [...unpinnedLive]) if (!lifecycle?.resolve(id)) unpinnedLive.delete(id);
    for (const id of [...runtimes.keys()]) {
      const entry = byId.get(id), rt = runtimes.get(id);
      if (!tracked(id) || (entry && (entry.sourceId !== rt.sourceId || entry.relative !== rt.relative))) dropRuntime(id);   // unpinned/ended, or the file moved
      else if (!entry && rt.absentSince === 0) rt.absentSince = now();
    }
    for (const id of knownIds()) {
      if (!tracked(id)) continue;
      const entry = byId.get(id), source = entry && sources.get(entry.sourceId);
      if (!entry || !source?.root || runtimes.has(id)) continue;
      const reader = createReader({ root: source.root, relative: entry.relative, io, now, limits: cfg.limits,
        factory: () => createNormalizer({ sourceNamespace: source.cfg.id, includeContent: false, maxEntries: cfg.limits.maxEntries, maxIndexBytes: cfg.limits.maxIndexBytes }) });
      runtimes.set(id, { reader, sourceId: entry.sourceId, relative: entry.relative, sig: '', absentSince: 0, children: new Map(), childChecked: new Map(), childFaultAt: 0, childDoneEpoch: 0, childRootRel: '', childCursor: 0, childrenIncomplete: false });
    }
  }

  // OMP's pinned persisted-agents contract uses direct <parent stem>/<child>.jsonl files. Arbitrary folders, forks,
  // advisors and header-only stubs do not establish a task child. Prefixes never retain task/system prompt text.
  async function pollChildren(rt, rootEntry, signal) {
    const source = sources.get(rt.sourceId), candidates = [];
    if (!source?.root || !rootEntry) { rt.children.clear(); rt.childDoneEpoch = 0; return; }
    if (rt.childDoneEpoch === scanEpoch && rt.childRootRel === rootEntry.relative) return;
    for (const entry of catalog.values()) {
      if (entry.sourceId !== rt.sourceId || !entry.parent) continue;
      let cursor = entry, depth = 0;
      while (cursor?.parent && depth++ <= cfg.limits.maxDepth) {
        if (path.posix.dirname(cursor.relative) !== cursor.parent.slice(0, -6) || !childIdOf(cursor.relative)) break;
        if (cursor.parent === rootEntry.relative) { candidates.push(entry); break; }
        cursor = catalog.get(rt.sourceId + '\0' + cursor.parent);
      }
    }
    candidates.sort((a, b) => a.relative.localeCompare(b.relative));
    rt.childrenIncomplete = source.truncated || candidates.length > MAX_CHILDREN || rt.childFaultAt === scanEpoch;
    const selected = candidates.slice(0, MAX_CHILDREN), keep = new Set(selected.map((e) => e.relative));
    for (const relative of rt.children.keys()) if (!keep.has(relative)) rt.children.delete(relative);
    for (const relative of rt.childChecked.keys()) if (!keep.has(relative)) rt.childChecked.delete(relative);
    const unchecked = selected.filter((e) => rt.childChecked.get(e.relative) !== scanEpoch);
    let budget = cfg.limits.bytesPerTick;
    for (let i = 0; i < Math.min(CHILD_READS, unchecked.length) && budget > 0 && !signal.aborted; i++) {
      const entry = unchecked[rt.childCursor++ % unchecked.length];
      rt.childChecked.set(entry.relative, scanEpoch);
      try {
        const handle = await openContained(source.root, entry.relative, io);
        let metadata = null;
        try {
          const length = Math.min(CHILD_PREFIX_BYTES, cfg.limits.maxLineBytes, budget), buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, 0);
          budget -= length;
          const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n'); lines.pop();
          let header = null, task = false, startedAt = 0;
          for (const line of lines.slice(0, 64)) {
            if (!line.trim()) continue;
            let raw; try { raw = JSON.parse(line); } catch { break; }
            if (!header) {
              if (raw?.type === 'title') continue;
              if (raw?.type !== 'session' || raw.version !== 3 || !ompSessionIdentity(source.cfg.id, raw.id)) break;
              header = raw;
              startedAt = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) || 0 : 0;
            } else if (raw?.type === 'session_init') { task = typeof raw.task === 'string'; break; }
          }
          if (header && task) metadata = { id: childIdOf(entry.relative), relative: entry.relative, parent: entry.parent,
            sourceSessionId: header.id, startedAt, lifecycle: 'historical' };
        } finally { await handle.close(); }
        if (metadata) {
          try {
            const tombstone = await containedPath(source.root, entry.relative + '.tombstone', io);
            const marker = await io.lstat(tombstone);
            if (marker.isFile() && !marker.isSymbolicLink()) metadata.tombstoned = true;
          } catch (e) { if (e?.code !== 'ENOENT') { report(errorCode(e)); rt.childrenIncomplete = true; rt.childFaultAt = scanEpoch; } }
          rt.children.set(entry.relative, metadata);
        } else { rt.children.delete(entry.relative); rt.childrenIncomplete = true; }
      } catch (e) { report(errorCode(e)); rt.children.delete(entry.relative); rt.childrenIncomplete = true; rt.childFaultAt = scanEpoch; }
    }
    if (rt.children.size < selected.length) rt.childrenIncomplete = true;
    if (unchecked.every((e) => rt.childChecked.get(e.relative) === scanEpoch)) { rt.childDoneEpoch = scanEpoch; rt.childRootRel = rootEntry.relative; }
  }

  function taskChildren(rt, rootEntry) {
    if (!rt || !rootEntry) return [];
    const key = rootEntry.header.id, ids = new Set(), duplicates = new Set();
    for (const child of rt.children.values()) { if (ids.has(child.id)) duplicates.add(child.id); ids.add(child.id); }
    const result = [];
    for (const child of rt.children.values()) {
      if (duplicates.has(child.id)) { rt.childrenIncomplete = true; continue; }
      const parent = child.parent === rootEntry.relative ? null : rt.children.get(child.parent);
      if (child.parent !== rootEntry.relative && (!parent || duplicates.has(parent.id))) { rt.childrenIncomplete = true; continue; }
      let ancestor = parent, valid = true, depth = 0;
      while (ancestor && ancestor.parent !== rootEntry.relative) {
        if (++depth > cfg.limits.maxDepth || duplicates.has(ancestor.id)) { valid = false; break; }
        ancestor = rt.children.get(ancestor.parent);
        if (!ancestor) valid = false;
      }
      if (!valid) { rt.childrenIncomplete = true; continue; }
      result.push({ id: child.id, agentKey: JSON.stringify([key, child.id]), parentAgentKey: parent ? JSON.stringify([key, parent.id]) : key,
        rootSessionKey: key, relationKind: 'subagent', lifecycle: child.lifecycle, tombstoned: child.tombstoned === true, persistedOnly: true, startedAt: child.startedAt });
    }
    return result;
  }

  async function pollPins(signal) {
    const changed = [];
    for (const [id, rt] of [...runtimes]) {   // one file handle at a time
      if (signal.aborted || !runtimes.has(id)) break;
      let info = await rt.reader.poll({ signal });
      for (let i = 1, from = now(); i < MAX_READ_POLLS && !SETTLED.has(info.state) && !signal.aborted && now() - from < PIN_PASS_BUDGET_MS; i++) info = await rt.reader.poll({ signal });
      const entry = byId.get(id);
      if (!entry && info.state === 'absent' && rt.absentSince && now() - rt.absentSince >= cfg.limits.ttlMs) { dropRuntime(id); changed.push(id); continue; }
      if (entry) rt.absentSince = 0;
      await pollChildren(rt, entry, signal);
      const sig = `${info.state}:${info.epoch}:${info.snapshot?.revision || ''}:${entry?.mtimeMs || ''}:${JSON.stringify(taskChildren(rt, entry))}:${rt.childrenIncomplete}`;
      if (sig !== rt.sig) { rt.sig = sig; changed.push(id); }
    }
    return changed;
  }

  async function tick() {
    const signal = controller.signal, listBefore = new Set(runtimes.keys());
    try {
      if (!pinsLoaded) { pinsLoaded = true; for (const id of (await pinStore?.load?.()) || []) if (typeof id === 'string' && /^omp:[0-9a-f]{64}$/.test(id) && pins.size < cfg.limits.maxPins) pins.add(id); }
      const missingLive = lifecycle ? lifecycle.ids().some((id) => !byId.has(id) && !conflicts.has(id)) : false;
      if (!lastScan || now() - lastScan >= cfg.limits.reconcileMs || (missingLive && now() - lastScan >= cfg.limits.pollMs)) await scan(signal);
      else await fillHeaders(signal);
      if (signal.aborted) return;   // disposed while waiting: nothing may be opened again
      syncRuntimes();
      const changed = await pollPins(signal);
      for (const id of listBefore) if (!runtimes.has(id)) changed.push(id);
      if (changed.length && !signal.aborted) safe(() => onChange([...new Set(changed)]));
      failures = 0; state = [...sources.values()].some((s) => s.state === 'ok') ? 'ready' : 'degraded';
    } catch (e) { failures++; state = 'degraded'; report(errorCode(e)); }
  }

  // The only way a pass starts: a second caller joins the pass in flight instead of overlapping it.
  const run = () => running ??= tick().finally(() => { running = null; });

  function arm() {
    if (disposed || !started) return;
    const delay = Math.min(cfg.limits.pollMs * 2 ** Math.min(failures, 5), 60000);
    timer = setTimer(() => { timer = null; run().finally(arm); }, delay);
    timer?.unref?.();
  }

  function armSweep() {
    if (disposed || !started || !lifecycle) return;
    sweepTimer = setTimer(() => { sweepTimer = null; lifecycle.sweep(); armSweep(); }, SWEEP_MS);
    sweepTimer?.unref?.();
  }

  function fileRecordOf(id) {
    const entry = byId.get(id), rt = runtimes.get(id), source = entry && sources.get(entry.sourceId);
    if (!entry || !rt || !source) return null;
    const info = rt.reader.info(), snap = info.snapshot;
    if (!snap?.supported || snap.sourceSessionId !== entry.header.sessionId) return null;
    const { projectKey, worktreeKey } = projectIdentity(source.cfg, entry.header.cwd, source.identities);
    return { sourceNamespace: source.cfg.id, sourceSessionId: snap.sourceSessionId, observedAt: snap.observedAt || Math.round(entry.mtimeMs),
      model: snap.model, provider: snap.provider, metrics: snap.metrics, counts: snap.counts, persistedOnly: true, readerState: info.state, incomplete: snap.incomplete === true || info.state !== 'ready',
      children: taskChildren(rt, entry), childrenIncomplete: rt.childrenIncomplete,
      project: baseName(source.cfg, entry.header.cwd), projectKey, worktreeKey, conversation: source.cfg.conversation === true };
  }

  // One record per conversation. The runtime owns liveness; a persisted file owns history and durable usage.
  function recordOf(id) {
    const file = tracked(id) ? fileRecordOf(id) : null, runtime = managed.get(id) ?? lifecycle?.resolve(id) ?? null;
    if (!runtime) return file;
    const entry = byId.get(id), source = sources.get(runtime.sourceNamespace);
    if (!source) return file;
    const identity = file || (entry?.header?.supported ? { ...projectIdentity(source.cfg, entry.header.cwd, source.identities), project: baseName(source.cfg, entry.header.cwd) } : { project: runtime.project || null, projectKey: runtime.projectKey || null, worktreeKey: runtime.worktreeKey || null });
    const recorded = file?.readerState === 'ready' && !file.incomplete && file?.metrics && (file.metrics.cost || file.metrics.tokens?.provenance === 'recorded');
    const fc = file?.counts, rc = runtime.counts;
    const counts = fc && rc ? { read: Math.max(fc.read || 0, rc.read || 0), edit: Math.max(fc.edit || 0, rc.edit || 0), cmd: Math.max(fc.cmd || 0, rc.cmd || 0), web: Math.max(fc.web || 0, rc.web || 0) } : fc ?? rc;
    return { sourceNamespace: runtime.sourceNamespace, sourceSessionId: runtime.sourceSessionId,
      observedAt: runtime.observedAt, model: runtime.model ?? file?.model ?? null, provider: runtime.provider ?? file?.provider ?? null,
      // The durable file replaces a provisional runtime snapshot; the two are never added together.
      metrics: recorded ? file.metrics : runtime.metrics ?? file?.metrics ?? null,
      counts, readerState: file?.readerState, incomplete: file?.incomplete === true, filePersisted: !!file,
      children: file?.children, childrenIncomplete: file?.childrenIncomplete === true,
      project: identity.project, projectKey: identity.projectKey, worktreeKey: identity.worktreeKey,
      conversation: !!file && file.conversation === true, persistedOnly: false, live: runtime,
      ...(managed.has(id) && { managed: managed.get(id).control ?? { owner: 'managed', runtimeInstanceId: managed.get(id).runtimeInstanceId,
        generation: managed.get(id).generation, state: 'ready' } }) };
  }
  const knownIds = () => new Set([...pins, ...(lifecycle?.ids() ?? []), ...managed.keys()]);

  async function savePins() { try { await pinStore?.save?.([...pins]); } catch { report('pin-store-failed'); } }

  const api = {
    kind: 'omp',
    async start() {
      if (started || disposed) return;
      started = true; state = 'starting';
      if (!await loadConfig()) { started = false; return; }
      for (const source of sources.values()) await approve(source);
      if (disposed) return;
      state =[...sources.values()].some((s) => s.state === 'ok') ? 'ready' : 'degraded';
      run().finally(arm);
      armSweep();
    },
    list() { return disposed ? [] : [...knownIds()].map(recordOf).filter(Boolean); },
    resolve(id) { return disposed || !knownIds().has(id) ? null : recordOf(id); },
    // The runtime evidence store (hybrid only). The ingress bridge feeds it; nothing else writes to it.
    lifecycle,
    // A unique, server-indexed catalogue candidate, never an arbitrary browser file path.
    candidateForLaunch(id) {
      if (disposed || !started || conflicts.has(id)) return null;
      const e = byId.get(id), source = e && sources.get(e.sourceId);
      if (!e || e.parent || !e.header?.supported || !source?.root || !e.ino) return null;
      return { id, sourceId: source.cfg.id, sourceRoot: source.root.path, relative: e.relative,
        sessionId: e.header.sessionId, cwd: e.header.cwd, fileKey: e.ino, size: e.size, mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs,
        fileSize: e.size, fileMtime: e.mtimeMs, fileCtime: e.ctimeMs,
        runtimeObserved: !!lifecycle?.resolve(id) || managed.has(id) };
    },
    hasObservedRuntime(id) { return !!lifecycle?.resolve(id) || managed.has(id); },
    projectForManaged(sourceId, cwd) {
      const source = sources.get(sourceId);
      return source && typeof cwd === 'string' ? projectIdentity(source.cfg, cwd, source.identities) : null;
    },
    setManaged(record) {
      if (disposed || !record || ompSessionIdentity(record.sourceNamespace, record.sourceSessionId)?.id !== record.id ||
        typeof record.runtimeInstanceId !== 'string' || managed.has(record.id) || !!lifecycle?.resolve(record.id) || !sources.has(record.sourceNamespace)) return false;
      managed.set(record.id, { ...record, sourceNamespace: record.sourceNamespace, sourceSessionId: record.sourceSessionId });
      safe(() => onChange([record.id]));
      return true;
    },
    updateManaged(id, instance, nextRecord) {
      const prev = managed.get(id);
      if (disposed || !prev || prev.runtimeInstanceId !== instance || !nextRecord) return false;
      managed.set(id, { ...prev, ...nextRecord, id, sourceNamespace: prev.sourceNamespace, sourceSessionId: prev.sourceSessionId, runtimeInstanceId: instance });
      safe(() => onChange([id]));
      return true;
    },
    removeManaged(id, instance) {
      if (managed.get(id)?.runtimeInstanceId !== instance) return false;
      managed.delete(id); safe(() => onChange([id])); return true;
    },
    sourceIds: () => disposed ? [] : [...sources.keys()],
    sourceForLaunch(id) { const source = sources.get(id); return !disposed && started && source?.root && source.state === 'ok' ? { sourceId: id, sourceRoot: source.root.path } : null; },
    // Run one reconciliation now (forced scan). Tests and the pin endpoint use it; the timer keeps the normal cadence.
    async refresh({ rescan = true } = {}) {
      if (disposed || !started || !cfg) return;
      await running;   // never overlap the timer's tick: one scan/poll pass at a time
      if (rescan) lastScan = 0;
      await run();
      if (rescan && !lastScan && !disposed) await run();   // (a timer pass that joined first may have skipped the scan)
    },

    catalog({ cursor = 0, limit = 25, kind = 'all' } = {}) {
      const offset = Number.isSafeInteger(Number(cursor)) && Number(cursor) >= 0 ? Number(cursor) : 0;
      const size = Math.min(Math.max(Number.isSafeInteger(Number(limit)) ? Number(limit) : 25, 1), MAX_PAGE);
      const children = new Map();
      for (const e of catalog.values()) if (e.parent) children.set(e.sourceId + '\0' + e.parent, (children.get(e.sourceId + '\0' + e.parent) || 0) + 1);
      const rows = [...catalog.values()].filter((e) => !e.parent)   // artifact children are historical candidates, never actors
        .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.relative < b.relative ? -1 : 1));
      // A capped scan may have missed newer files (directory order is not time order): then nothing can be called recent.
      rows.forEach((e, i) => { e.label = i < RECENT_COUNT && !sources.get(e.sourceId)?.truncated ? 'recent' : 'history'; });
      const wanted = kind === 'recent' || kind === 'history' ? rows.filter((e) => e.label === kind) : rows;
      const items = wanted.slice(offset, offset + size).map((e) => {
        const source = sources.get(e.sourceId), id = e.header?.supported ? e.header.id : null;
        return { id: conflicts.has(id) ? null : id, source: e.sourceId, label: e.label, liveness: 'unknown',
          modifiedAt: Math.round(e.mtimeMs), sizeBytes: e.size, supported: e.header?.supported === true,
          // not read yet (read budget or a failed read): not the same as a file that is not a supported session
          pending: !e.header || e.header.pending === true,
          project: e.header?.supported ? baseName(source.cfg, e.header.cwd) : '',
          projectKey: e.header?.supported ? projectIdentity(source.cfg, e.header.cwd, source.identities).projectKey : null,
          children: children.get(e.sourceId + '\0' + e.relative) || 0,
          pinned: !!id && pins.has(id), conflict: conflicts.has(e.header?.id) };
      });
      return { state, sources: [...sources.values()].map((s) => ({ id: s.cfg.id, state: s.state, truncated: s.truncated })),
        items, next: offset + size < wanted.length ? String(offset + size) : null, total: wanted.length, maxPins: cfg?.limits.maxPins ?? DEFAULT_LIMITS.maxPins, conversation: [...sources.values()].some((s) => s.cfg.conversation) };
    },

    // Only a public id from the catalogue is accepted; arbitrary paths never reach the filesystem.
    async pin(id, on = true) {
      if (disposed || !started) return { ok: false, code: 'unavailable' };
      if (typeof id !== 'string' || !/^omp:[0-9a-f]{64}$/.test(id)) return { ok: false, code: 'invalid-id' };
      if (!on) {
        const hadPin = pins.delete(id), hadLive = !!lifecycle?.resolve(id);
        if (hadLive) unpinnedLive.add(id);
        if (!hadPin && !hadLive) return { ok: true, pinned: false };
        syncRuntimes(); await savePins(); safe(() => onChange([id])); return { ok: true, pinned: false };
      }
      if (conflicts.has(id)) return { ok: false, code: 'conflict' };
      if (!byId.has(id)) return { ok: false, code: 'unknown-session' };
      if (!pins.has(id) && pins.size >= cfg.limits.maxPins) return { ok: false, code: 'pin-limit' };
      unpinnedLive.delete(id); pins.add(id); syncRuntimes(); await savePins();
      return { ok: true, pinned: true };
    },

    // A separate one-shot parse with content enabled; nothing textual stays in the live snapshot.
    async readConversation(record, n, childId = null) {
      return (await api.readConversationPage(record, n, childId)).items;
    },
    async readConversationPage(record, n = 120, childId = null, before = null) {
      if (disposed || !record || record.conversation !== true || activeConversations >= MAX_CONVERSATIONS) return emptyConversationPage();
      const id = ompSessionIdentity(record.sourceNamespace, record.sourceSessionId)?.id, entry = byId.get(id), source = entry && sources.get(entry.sourceId);
      if (!entry || !source?.root || source.cfg.conversation !== true || !tracked(id)) return emptyConversationPage();
      let relative = entry.relative, expectedSessionId = record.sourceSessionId;
      if (childId !== null) {
        const rt = runtimes.get(id);
        if (typeof childId !== 'string' || !taskChildren(rt, entry).some((c) => c.id === childId)) return emptyConversationPage();
        const child = [...rt.children.values()].find((c) => c.id === childId);
        relative = child.relative; expectedSessionId = child.sourceSessionId;
      }
      activeConversations++;
      const stop = new AbortController(), kill = setTimer(() => stop.abort(), READ_TIMEOUT_MS);
      kill?.unref?.();
      const reader = createReader({ root: source.root, relative, io, now, limits: cfg.limits,
        factory: () => createNormalizer({ sourceNamespace: source.cfg.id, includeContent: true, maxEntries: cfg.limits.maxEntries, maxIndexBytes: cfg.limits.maxIndexBytes }) });
      try {
        let info;
        for (let i = 0; i < MAX_READ_POLLS && !stop.signal.aborted && !disposed; i++) {
          info = await reader.poll({ signal: stop.signal });
          if (['ready', 'unsupported', 'absent', 'degraded'].includes(info.state)) break;
        }
        const snap = info?.state === 'ready' ? info.snapshot : null;
        if (!snap?.supported || snap.sourceSessionId !== expectedSessionId) return emptyConversationPage();
        return conversationPage(snap.items, { id, childId, limit: n, before, incomplete: snap.incomplete === true });
      } catch (e) { report(errorCode(e)); return emptyConversationPage(); }
      finally { clearTimer(kill); activeConversations--; await reader.dispose().catch(() => {}); }
    },

    status() {
      return { state, sources: [...sources.values()].map((s) => ({ id: s.cfg.id, state: s.state })), catalog: catalog.size,
        pins: pins.size, runtimes: runtimes.size, timers: (timer ? 1 : 0) + (sweepTimer ? 1 : 0),
        live: lifecycle ? lifecycle.status().instances : 0, issues: [...issues, ...(lifecycle?.diagnostics() ?? [])] };
    },

    async dispose() {
      if (disposed) return;
      disposed = true; controller.abort();
      if (timer) { clearTimer(timer); timer = null; }
      if (sweepTimer) { clearTimer(sweepTimer); sweepTimer = null; }
      lifecycle?.dispose();
      await running;
      for (const id of [...runtimes.keys()]) { const rt = runtimes.get(id); runtimes.delete(id); await rt.reader.dispose().catch(() => {}); }
      catalog.clear(); byId.clear(); conflicts.clear(); sources.clear(); pins.clear(); unpinnedLive.clear(); managed.clear();
      state = 'disposed';
    },
  };
  return api;
}
