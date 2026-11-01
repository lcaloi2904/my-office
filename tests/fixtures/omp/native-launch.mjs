// Synthetic G3 fixture only. Never reads the caller's home, provider credentials or .env files.
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { header, entry, lines } from './synthetic.mjs';

export const PROJECT = 'g3-project', PROFILE = 'g3-profile', SOURCE = 'g3-native';
export const SESSION = '00000000-0000-4000-8000-000000000003';
export const MODEL = 'g3-local/probe';

export function isolatedEnvironment(root, systemRoot) {
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('Native Windows SystemRoot is required');
  const home = path.join(root, 'home');
  return {
    SystemRoot: systemRoot, WINDIR: systemRoot, ComSpec: path.join(systemRoot, 'System32', 'cmd.exe'),
    PATH: path.join(systemRoot, 'System32'), PATHEXT: '.EXE;.COM',
    HOME: home, USERPROFILE: home, HOMEDRIVE: path.parse(home).root.slice(0, 2), HOMEPATH: home.slice(2),
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'),
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'), XDG_DATA_HOME: path.join(home, 'xdg-data'),
    XDG_CACHE_HOME: path.join(home, 'xdg-cache'), XDG_STATE_HOME: path.join(home, 'xdg-state'),
    PI_NATIVES_DIR: path.join(root, 'natives'), PI_CONFIG_DIR: '.omp',
    OTEL_SDK_DISABLED: 'true', PI_NO_TITLE: '1', PI_NO_PTY: '1', PI_AUTO_QA: '0', OMP_SKIP_SETUP: '1',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost,::1',
  };
}

export function prepareNativeFixture(root, binary, modelPort) {
  const home = path.join(root, 'home'), project = path.join(home, 'project'), sessions = path.join(root, 'sessions');
  const profile = path.join(home, '.omp', 'profiles', PROFILE, 'agent');
  const ownerDir = path.join(home, '.omp', 'run', 'session-owners');
  for (const dir of [profile, ownerDir, project, sessions, path.join(root, 'temp'), path.join(root, 'natives')]) fs.mkdirSync(dir, { recursive: true });
  // HOME is also an ancestor discovery ceiling: native settings cannot walk into the repository.
  fs.mkdirSync(path.join(project, '.omp'), { recursive: true });
  const roles = ['default', 'smol', 'slow', 'vision', 'plan', 'commit', 'tiny', 'memory', 'task', 'advisor', 'widget'];
  const settings = {
    modelRoles: Object.fromEntries(roles.map((role) => [role, MODEL])), enabledModels: [MODEL], enabledProviders: ['g3-local'],
    autoResume: false, retry: { enabled: false, modelFallback: false, fallbackChains: {} },
    compaction: { enabled: false, midTurnEnabled: false }, advisor: { enabled: false }, memory: { backend: 'off' },
    providers: { cacheWarming: 'off', cacheRetention: 'none' }, telemetry: { otlpExportEnabled: false },
    speech: { enabled: false, enhanced: false }, stt: { enabled: false },
    plan: { enabled: false, defaultOnStartup: false }, git: { enabled: false },
    spelling: { autocomplete: 'off', autocorrect: false }, composer: { predictions: false }, recap: { enabled: false },
    startup: { setupWizard: false, checkUpdate: false }, marketplace: { autoUpdate: 'off' },
    skills: { enabled: false }, commands: { enableClaudeUser: false, enableClaudeProject: false,
      enableOpencodeUser: false, enableOpencodeProject: false },
  };
  fs.writeFileSync(path.join(profile, 'config.yml'), JSON.stringify(settings));
  fs.writeFileSync(path.join(profile, 'models.yml'), JSON.stringify({ providers: { 'g3-local': {
    baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'g3-synthetic-not-a-credential', api: 'openai-completions',
    models: [{ id: 'probe', name: 'G3 no-turn fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }],
  } } }));
  const candidateFile = path.join(sessions, '2000-01-01_g3-exact.jsonl');
  fs.writeFileSync(candidateFile, lines([
    header({ id: SESSION, cwd: project, timestamp: '2000-01-01T00:00:00.000Z' }),
    entry('g3-history', null, { timestamp: '2000-01-01T00:00:01.000Z', message: { role: 'user', content: 'G3 SYNTHETIC HISTORY ONLY - NEVER DISPATCH' } }),
    entry('g3-answer', 'g3-history', { timestamp: '2000-01-01T00:00:02.000Z', message: {
      role: 'assistant', content: [{ type: 'text', text: 'G3 SYNTHETIC HISTORY: completed answer; never replay.' }],
      api: 'openai-completions', provider: 'g3-local', model: 'probe', stopReason: 'stop', timestamp: 946684802000,
      usage: { input: 10, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 18,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }),
  ]));
  const observerConfig = path.join(root, 'omp-config.json'), launchConfig = path.join(root, 'launch-config.json');
  fs.writeFileSync(observerConfig, JSON.stringify({ version: 1, sources: [{ id: SOURCE, root: sessions,
    pathStyle: 'win32', conversation: true, projectMappings: [{ from: project, projectId: PROJECT, worktreeId: 'main' }] }] }));
  fs.writeFileSync(launchConfig, JSON.stringify({ version: 1, binary, resumeProtocol: 1,
    projects: [{ alias: PROJECT, root: project, sourceId: SOURCE, sessionDir: sessions, ownerDir }],
    profiles: [{ alias: PROFILE, name: PROFILE, homeRoot: home, model: MODEL }] }));
  return { project, home, sessions, ownerDir, candidateFile, observerConfig, launchConfig };
}

// Observation only: the real resolver/manager/host and native binary retain all transport behavior.
// Do not persist raw get_state (systemPrompt, tools, paths, queue text) or stderr.
export function observeNativeSpawns(binary, root, children) {
  const original = childProcess.spawn;
  childProcess.spawn = function (file, args, options) {
    const child = original.call(this, file, args, options);
    if (path.resolve(String(file)).toLowerCase() !== path.resolve(binary).toLowerCase()) return child;
    const env = options.env;
    const row = { pid: child.pid ?? null, commands: [], sessions: [], modelIds: [], turns: 0,
      eof: false, stdoutEOF: false, exitCode: null, signal: null, exited: false, error: false,
      shell: options.shell === true, cwdMatches: options.cwd === path.join(root, 'home', 'project'),
      homeMatches: env.HOME === path.join(root, 'home') && env.USERPROFILE === path.join(root, 'home'),
      foreignEnvironment: Object.keys(env).filter((key) => /API_KEY|TOKEN|SECRET|AUTH|BROKER|PI_CONFIG_FILES|NODE_OPTIONS/i.test(key)),
      args: [...args] };
    children.push(row);
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 2 * 1024 * 1024) { row.error = true; buffer = ''; return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { row.error = true; continue; }
        if (['agent_start', 'message_start', 'turn_start', 'tool_execution_start'].includes(frame.type)) row.turns++;
        if (frame.type === 'response' && frame.command === 'get_state' && frame.success && frame.data) {
          row.sessions.push({ id: frame.data.sessionId, messageCount: frame.data.messageCount,
            isStreaming: frame.data.isStreaming, isSettled: frame.data.isSettled });
          if (frame.data.model) row.modelIds.push({ provider: frame.data.model.provider, id: frame.data.model.id });
        }
      }
    });
    child.stdout.on('end', () => { row.stdoutEOF = true; });
    const write = child.stdin.write;
    child.stdin.write = function (chunk, ...rest) {
      try { row.commands.push(JSON.parse(String(chunk)).type); } catch { row.error = true; }
      return write.call(this, chunk, ...rest);
    };
    const end = child.stdin.end;
    child.stdin.end = function (...args) { row.eof = true; return end.apply(this, args); };
    child.once('error', () => { row.error = true; });
    child.once('exit', (code, signal) => { row.exited = true; row.exitCode = code; row.signal = signal; });
    return child;
  };
  syncBuiltinESMExports();
  return () => { childProcess.spawn = original; syncBuiltinESMExports(); };
}
