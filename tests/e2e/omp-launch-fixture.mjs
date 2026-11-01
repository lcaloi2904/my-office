// Native-only, no-turn G3 runner and Playwright global setup.
// Parent builds first; this module never builds, installs, reads .env, or signals an arbitrary PID.
// Manual: node tests/e2e/omp-launch-fixture.mjs --serve <absolute task root> <port> <absolute dist> <approved omp.exe> <omp/version>
// Stop manual mode by typing "shutdown" + Enter, or POST /shutdown with the manifest token.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { isolatedEnvironment, prepareNativeFixture, observeNativeSpawns } from '../fixtures/omp/native-launch.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = 'g3-native-fixture-owner.json';
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
function validateRoot(root) {
  if (!path.isAbsolute(root) || path.basename(root) !== 'omp-native-fixture' ||
      !path.basename(path.dirname(root)).startsWith('test-results') || path.dirname(path.dirname(root)) !== path.resolve(REPO)) {
    throw new Error('Fixture root must be <repository>/test-results*/omp-native-fixture');
  }
  // Refuse a symlink/junction anywhere in the output ancestry before creating or deleting.
  for (const dir of [path.dirname(root), root]) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Fixture output cannot be a link');
  }
}
const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
});
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function serve(root, port, dist, binary, expectedVersion) {
  if (process.platform !== 'win32' || !binary || !path.isAbsolute(binary) || !/\.exe$/i.test(binary)) {
    throw new Error('Native Windows and explicit OFFICE_OMP_TEST_BIN (approved absolute omp.exe) are required');
  }
  if (!/^omp\/\d+\.\d+\.\d+$/.test(expectedVersion || '')) throw new Error('Explicit OFFICE_OMP_TEST_VERSION (omp/x.y.z) is required');
  validateRoot(root);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !path.isAbsolute(dist)) throw new Error('Invalid explicit fixture port/dist');
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.mkdir(root); // Never erase a pre-existing task or user directory.
  const token = randomUUID();
  writeJson(path.join(root, MARKER), { token });
  // Pin đúng bytes binary đã được duyệt; metadata của bản cài dùng chung có thể đổi khi fixture đang chạy.
  const pinnedBinary = path.join(root, 'omp.exe');
  await fsp.copyFile(binary, pinnedBinary, fs.constants.COPYFILE_EXCL);
  const [approvedHash, binarySha256] = await Promise.all([fileHash(binary), fileHash(pinnedBinary)]);
  if (approvedHash !== binarySha256) throw new Error('Approved binary changed while preparing the isolated copy');
  let ompVersion = null;
  const children = [], modelRequests = [];
  let stopping = false;
  const snapshot = () => ({ children, modelRequests: modelRequests.length, stopping, ompVersion, binarySha256 });
  const model = http.createServer((req, res) => {
    modelRequests.push({ method: req.method });
    req.resume(); res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('g3-no-model-turns-allowed');
  });
  const modelPort = await listen(model);
  const fixture = prepareNativeFixture(root, pinnedBinary, modelPort);
  // No inherited secrets, NODE_OPTIONS, external settings overlays, proxy, or real user directories.
  const env = isolatedEnvironment(root, process.env.SystemRoot);
  const version = spawnSync(pinnedBinary, ['--profile', 'g3-profile', '--version'], {
    shell: false, windowsHide: true, cwd: fixture.project, env, input: '', encoding: 'utf8', timeout: 15000, maxBuffer: 8192,
  });
  if (version.status !== 0 || version.error || version.stdout.trim() !== expectedVersion) throw new Error('Native fixture binary does not match the explicitly pinned OMP version');
  ompVersion = version.stdout.trim();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env, {
    NODE_ENV: 'production', OFFICE_PORT: String(port), OFFICE_DATA_DIR: path.join(root, 'office-data'),
    OFFICE_DIST_DIR: path.relative(REPO, dist), OFFICE_LANG: 'vi', OFFICE_TRANSLATE: '0', OFFICE_USAGE: '0', OFFICE_OMP_USAGE: '0', OFFICE_CI: '0',
    OFFICE_OMP: 'files', OFFICE_OMP_CONFIG: fixture.observerConfig,
    OFFICE_OMP_LAUNCH: '1', OFFICE_OMP_LAUNCH_CONFIG: fixture.launchConfig,
    CLAUDE_CONFIG_DIR: path.join(fixture.home, '.claude'),
    OFFICE_CLAUDE_BIN: path.join(root, 'not-installed-claude.exe'),
    OFFICE_TUNNEL_CMD: path.join(root, 'not-installed-tunnel.exe'),
  });
  observeNativeSpawns(pinnedBinary, root, children);
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    model.close(); control.close();
    // Executed inside the production server process: unlike child.kill(SIGTERM),
    // this reaches its real dispose/EOF shutdown handler on native Windows.
    process.emit('SIGINT');
  };
  const control = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) { res.writeHead(403); res.end(); return; }
    if (req.url === '/snapshot' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(snapshot()));
    } else if (req.url === '/shutdown' && req.method === 'POST') {
      res.writeHead(202); res.end(); setImmediate(shutdown);
    } else { res.writeHead(404); res.end(); }
  });
  const controlPort = await listen(control);
  writeJson(path.join(root, 'manifest.json'), { ...fixture, token, controlPort, port });
  // No mocked HTTP routes, host factories or synthetic RPC responses.
  await import('../../server/index.mjs');
  process.on('exit', (code) => {
    // Persist counts/ownership only, never raw state, session IDs, argv or profile paths.
    const final = { stopping, modelRequests: modelRequests.length, ompVersion, binarySha256, children: children.map((child) => ({
      pid: child.pid, commands: child.commands, turns: child.turns, eof: child.eof, stdoutEOF: child.stdoutEOF,
      exited: child.exited, exitCode: child.exitCode, signal: child.signal, error: child.error,
    })) };
    writeJson(path.join(root, 'final-evidence.json'), final);
    // Manual mode has no Playwright teardown. Remove only this marked root after verified EOF.
    if (!process.send && code === 0 && final.modelRequests === 0 && final.stopping &&
        final.children.every((child) => child.exited && child.eof && child.stdoutEOF && child.exitCode === 0 && !child.signal && !child.error)) {
      validateRoot(root);
      if (JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8')).token !== token) return;
      writeJson(path.join(path.dirname(root), 'omp-native-lifecycle.json'), final);
      fs.rmSync(root, { recursive: true });
    }
  });
  process.on('message', (message) => { if (message === 'shutdown') shutdown(); });
  if (process.send) process.send({ type: 'fixture-ready' });
  else {
    const input = createInterface({ input: process.stdin });
    input.on('line', (line) => { if (line.trim() === 'shutdown') shutdown(); });
    input.on('close', shutdown);
    console.log(`Native fixture control: ${path.join(root, 'manifest.json')}`);
  }
}

export default async function setup(config) {
  const { root, binary, port, dist, expectedVersion } = config.metadata.nativeLaunch;
  validateRoot(root);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', root, String(port), dist, binary, expectedVersion], {
    cwd: REPO, shell: false, windowsHide: true,
    env: isolatedEnvironment(root, process.env.SystemRoot), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '', failure = null, exited = false, announced = false;
  child.on('message', (message) => { if (message?.type === 'fixture-ready') announced = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.once('error', (error) => { failure = error; });
  const done = new Promise((resolve) => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    if (!exited && child.connected) child.send('shutdown', (error) => { if (error && !exited) failure = error; });
    const deadline = Promise.withResolvers();
    const timer = setTimeout(() => deadline.reject(new Error(`Native fixture did not acknowledge graceful shutdown; retained ${root}. No force kill attempted.`)), 20000);
    let outcome;
    try { outcome = await Promise.race([done, deadline.promise]); }
    finally { clearTimeout(timer); }
    if (failure) throw failure;
    if (outcome.code !== 0 || outcome.signal) throw new Error(`Native fixture exited abnormally: ${JSON.stringify(outcome)}\n${output}`);
    const evidence = JSON.parse(await fsp.readFile(path.join(root, 'final-evidence.json'), 'utf8'));
    writeJson(path.join(path.dirname(root), 'omp-native-lifecycle.json'), evidence);
    if (evidence.modelRequests !== 0 || evidence.children.some((c) => !c.exited || !c.eof || !c.stdoutEOF || c.exitCode !== 0 || c.signal || c.turns !== 0 || c.error)) {
      throw new Error(`Native child no-turn/EOF shutdown invariant failed; retained ${root}`);
    }
    validateRoot(root);
    const marker = JSON.parse(await fsp.readFile(path.join(root, MARKER), 'utf8'));
    const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
    if (marker.token !== manifest.token) throw new Error('Fixture ownership marker changed; refusing cleanup');
    await fsp.rm(root, { recursive: true });
  };
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (exited) throw new Error(`Native fixture exited before readiness\n${output}`);
      if (!announced) { await pause(); continue; }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/omp/control/status`, { signal: AbortSignal.timeout(1000) });
        const status = await response.json();
        if (response.ok && status.enabled && status.reason === 'ready') { ready = true; break; }
        if (status.reason && !['starting', 'ready'].includes(status.reason)) throw new Error(`Native launcher unavailable: ${status.reason}`);
      } catch (error) {
        if (error.message?.startsWith('Native launcher unavailable:')) throw error;
        // Expected connection refusal while the owned server starts; deadline remains bounded.
      }
      await pause();
    }
    if (!ready) throw new Error(`Native fixture startup deadline exceeded\n${output}`);
    return cleanup;
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], `Native fixture startup/cleanup failed: ${error.message}; ${cleanupError.message}`); }
    throw error;
  }
}

if (process.argv[2] === '--serve') {
  serve(path.resolve(process.argv[3] || ''), Number(process.argv[4]), path.resolve(process.argv[5] || ''), process.argv[6] || '', process.argv[7] || '')
    .catch((error) => { console.error(error); process.exit(1); });
}
