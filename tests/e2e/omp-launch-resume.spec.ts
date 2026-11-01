import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

const PROJECT = 'g3-project', PROFILE = 'g3-profile', SOURCE = 'g3-native';
const candidateSession = '00000000-0000-4000-8000-000000000003';
const publicId = (session: string) => 'omp:' + createHash('sha256').update(JSON.stringify(['omp', SOURCE, session])).digest('hex');
type Session = { id: string; projectAlias: string; profileAlias: string; runtimeInstanceId: string; generation: number; state: string };
type Child = {
  pid: number; commands: string[]; sessions: { id: string; messageCount: number; isStreaming: boolean; isSettled: boolean }[];
  modelIds: { provider: string; id: string }[]; turns: number; eof: boolean; stdoutEOF: boolean;
  exited: boolean; exitCode: number | null; signal: string | null; error: boolean; shell: boolean;
  cwdMatches: boolean; homeMatches: boolean; foreignEnvironment: string[]; args: string[];
};
type Evidence = { children: Child[]; modelRequests: number; stopping: boolean };
type Manifest = { token: string; controlPort: number; candidateFile: string; project: string; home: string; sessions: string };
type NativeConfig = { root: string; binary: string; port: number; dist: string };

async function status(request: APIRequestContext) {
  const response = await request.get('/api/omp/control/status');
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ enabled: boolean; resumeAvailable: boolean; projects: { alias: string; sourceId: string }[];
    profiles: { alias: string }[]; sessions: Session[] }>;
}
function assertPublic(value: unknown, fixture: Manifest, child?: Child) {
  const text = JSON.stringify(value);
  for (const hidden of [fixture.project, fixture.home, fixture.sessions, '.jsonl', 'systemPrompt', 'dumpTools',
    'queuedMessages', '"sessionFile"', '"cwd"', 'G3 SYNTHETIC HISTORY', 'g3-synthetic-not-a-credential']) {
    expect(text).not.toContain(hidden);
    expect(text).not.toContain(JSON.stringify(hidden).slice(1, -1));
  }
  if (child) {
    for (const session of child.sessions) expect(text).not.toContain(session.id);
    expect(text).not.toContain(`"pid":${child.pid}`);
  }
}
async function chunkedOversize(baseURL: string, data: object) {
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>();
  const req = http.request(new URL('/api/omp/control/launch', baseURL), {
    method: 'POST', headers: { Origin: baseURL, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
  }, (res) => {
    let body = '';
    res.setEncoding('utf8'); res.on('data', (chunk: string) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode!, body })); res.on('error', reject);
  });
  req.on('error', reject);
  req.setTimeout(10000, () => req.destroy(new Error('Oversize launch request timed out')));
  // Valid prefix followed by an over-limit suffix must not be parsed as a smaller valid launch.
  req.flushHeaders();
  req.write(JSON.stringify(data), () => setImmediate(() => req.end(' '.repeat(4096))));
  return promise;
}

test.describe('launcher OFF — original file-only configuration', () => {
  test.beforeEach(({}, info) => { test.skip(!!info.config.metadata.nativeLaunch, 'OFF coverage runs only with playwright.omp.config.ts'); });

  test('flag OFF refuses launch and forged Origin without starting a runtime', async ({ request, baseURL }) => {
    const initial = await status(request);
    expect(initial.enabled).toBe(false);
    expect(initial.sessions).toEqual([]);
    const data = { mode: 'new', projectAlias: 'e2e', profileAlias: 'fixture' };
    for (const origin of [baseURL!, undefined, 'http://evil.example']) {
      const denied = await request.post('/api/omp/control/launch', { data, headers: origin ? { Origin: origin } : {} });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe(origin === baseURL ? 'LAUNCH_UNAVAILABLE' : 'agentLocalOnly');
    }
    expect((await status(request)).sessions).toEqual([]);
  });

  test('history offers no New or Resume with the flag OFF', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); localStorage.setItem('office-lite', 'on');
    });
    await page.goto('/?lang=en&layout=cozy');
    await page.locator('#lite .omp-open').click();
    const dialog = page.locator('dialog.omp-dlg[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.omp-launch-new')).not.toBeVisible();
    await expect(dialog.locator('.omp-resume:visible')).toHaveCount(0);
  });
});

test.describe('native launcher ON — real server, resolver, manager, RPC host and omp.exe', () => {
  test.beforeEach(({}, info) => { test.skip(!info.config.metadata.nativeLaunch, 'Native coverage requires playwright.launch.config.ts'); });

  test('VI mobile New and exact Resume hold native ownership without turns, duplicate actors or browser coupling', async ({ page, browser, request, baseURL }, info) => {
    const native = info.config.metadata.nativeLaunch as NativeConfig;
    const fixture = JSON.parse(await fs.readFile(path.join(native.root, 'manifest.json'), 'utf8')) as Manifest;
    const controlURL = `http://127.0.0.1:${fixture.controlPort}`;
    const controlHeaders = { Authorization: `Bearer ${fixture.token}` };
    const evidence = async (): Promise<Evidence> => {
      const response = await request.get(controlURL + '/snapshot', { headers: controlHeaders });
      expect(response.status()).toBe(200);
      return response.json() as Promise<Evidence>;
    };
    const initial = await status(request);
    expect(initial).toMatchObject({ enabled: true, resumeAvailable: true,
      projects: [{ alias: PROJECT, sourceId: SOURCE }], profiles: [{ alias: PROFILE }], sessions: [] });
    assertPublic(initial, fixture);
    expect((await evidence()).children).toEqual([]);
    const data = { mode: 'new', projectAlias: PROJECT, profileAlias: PROFILE };

    // Real HTTP admission boundaries must refuse without spawning, not just reject a mocked UI action.
    const deniedHeaders: Record<string, string>[] = [
      { Origin: 'http://evil.example' },
      { Origin: baseURL!, Host: 'evil.example' },
      { Origin: baseURL!, 'Content-Type': 'text/plain' },
      {},
    ];
    for (const headers of deniedHeaders) {
      const response = await request.post('/api/omp/control/launch', { data: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', ...headers } });
      expect([403, 421]).toContain(response.status());
    }
    for (const payload of [
      { ...data, pid: 123 }, { ...data, cwd: fixture.project }, { ...data, args: ['--continue'] },
      { ...data, mode: 'prompt' }, { ...data, candidateId: publicId(candidateSession) }, null, [],
    ]) {
      const response = await request.post('/api/omp/control/launch', { data: JSON.stringify(payload),
        headers: { Origin: baseURL!, 'Content-Type': 'application/json' } });
      expect(response.status()).toBe(400);
      expect((await response.json()).code).toBe('LAUNCH_INVALID');
    }
    const oversized = await chunkedOversize(baseURL!, data);
    expect(oversized.status).toBe(400);
    expect(JSON.parse(oversized.body).code).toBe('LAUNCH_INVALID');

    const candidateId = publicId(candidateSession);
    await expect.poll(async () => {
      const catalog = await (await request.get('/api/omp/catalog?limit=25')).json() as { items: { id: string; source: string; supported: boolean }[] };
      return catalog.items.find((item) => item.id === candidateId);
    }).toEqual(expect.objectContaining({ id: candidateId, source: SOURCE, supported: true }));
    const original = await fs.readFile(fixture.candidateFile);
    const originalStat = await fs.stat(fixture.candidateFile);
    const originalFiles = await fs.readdir(fixture.sessions);
    expect(await fs.readFile(fixture.candidateFile)).toEqual(original);
    const afterStat = await fs.stat(fixture.candidateFile);
    expect([afterStat.size, afterStat.mtimeMs, afterStat.ctimeMs]).toEqual([originalStat.size, originalStat.mtimeMs, originalStat.ctimeMs]);
    expect(await fs.readdir(fixture.sessions)).toEqual(originalFiles);
    expect((await status(request)).sessions).toEqual([]);
    expect((await evidence()).children).toEqual([]);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); localStorage.setItem('office-lite', 'on');
    });
    await page.goto('/?lang=vi&layout=cozy&debug');
    await expect(page.locator('#lite')).toBeVisible();
    await page.locator('#lite .omp-open').click();
    const history = page.locator('dialog.omp-dlg[open]:not(.omp-launch-dlg)');
    await expect(history.getByRole('heading', { name: 'Lịch sử OMP', exact: true })).toBeVisible();
    const candidateRow = history.locator(`[data-omp-id="${candidateId}"]`);
    await expect(candidateRow.locator('.omp-resume')).toBeEnabled();
    await history.getByRole('button', { name: 'Phiên OMP mới', exact: true }).click();
    const launch = page.locator('dialog.omp-launch-dlg[open]');
    await expect(launch.getByLabel('Dự án được phép')).toHaveValue(PROJECT);
    await expect(launch.getByLabel('Hồ sơ OMP được phép')).toHaveValue(PROFILE);
    await expect(launch.locator('select[name="projectAlias"] option')).toHaveText([PROJECT]);
    await expect(launch.locator('select[name="profileAlias"] option')).toHaveText([PROFILE]);
    const box = await launch.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    expect(await launch.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect((await evidence()).children).toEqual([]); // Opening/selecting is never launch authority.
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/omp/control/launch' && response.request().method() === 'POST');
    await launch.getByRole('button', { name: 'Tạo phiên mới', exact: true }).click();
    const response = await responsePromise;
    expect(response.request().postDataJSON()).toEqual(data);
    expect(response.status()).toBe(200);
    const reply = await response.json() as { ok: boolean; session: Session };
    expect(reply.ok).toBe(true);
    expect(reply.session).toMatchObject({ state: 'ready', projectAlias: PROJECT, profileAlias: PROFILE });
    await expect(launch).not.toBeVisible();

    const running = await evidence();
    expect(running.modelRequests).toBe(0);
    expect(running.children).toHaveLength(1);
    const child = running.children[0];
    expect(child).toMatchObject({ shell: false, homeMatches: true, cwdMatches: true, foreignEnvironment: [], turns: 0,
      eof: false, exited: false, error: false });
    expect(child.commands.filter((command) => command === 'new_session')).toHaveLength(1);
    expect(child.commands.filter((command) => command === 'get_state').length).toBeGreaterThanOrEqual(1);
    expect(child.commands.every((command) => ['get_state', 'new_session'].includes(command))).toBe(true);
    expect(child.pid).toBeGreaterThan(0);
    const current = child.sessions.at(-1)!;
    expect(current).toMatchObject({ messageCount: 0, isStreaming: false, isSettled: true });
    expect(reply.session.id).toBe(publicId(current.id));
    expect(reply.session.id).not.toBe(candidateId);
    expect(child.modelIds.at(-1)).toEqual({ provider: 'g3-local', id: 'probe' });
    for (const unsafe of ['--resume', '--continue', '--restore', '--print', '--prompt']) expect(child.args).not.toContain(unsafe);
    assertPublic(reply, fixture, child);
    assertPublic(await status(request), fixture, child);

    await history.getByRole('button', { name: 'Đóng', exact: true }).click();
    const card = page.locator('#lite .lite-card');
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#dr-session')).toBeVisible();
    // Closing a drawer is a view operation. Use its normal close control, not a controller endpoint.
    await page.locator('#dr-session [data-close]').click();
    await expect(page.locator('#dr-session')).not.toBeVisible();
    const live = await (await request.get('/api/live?since=-1')).json() as { msgs: { k: string; sessions: { id: string; agentKind: string }[] }[] };
    const actors = live.msgs.find((message) => message.k === 'snap')!.sessions.filter((actor) => actor.agentKind === 'omp');
    expect(actors).toHaveLength(1);
    expect(actors[0].id).toBe(reply.session.id);
    assertPublic(actors, fixture, child);
    expect((await status(request)).sessions).toEqual([reply.session]);
    await page.locator('#btn-lite').click();
    await expect(page.locator(`#rail-list .ri[data-sess="${reply.session.id}"]`)).toHaveCount(1);
    await page.waitForFunction((id) => window.__office?.workers.has(id), reply.session.id);
    expect(await page.evaluate(() => [...window.__office!.workers.keys()].filter((id) => id.startsWith('omp:')))).toEqual([reply.session.id]);

    await page.locator('#btn-lite').click();
    await page.locator('#lite .omp-open').click();
    await expect(candidateRow.locator('.omp-resume')).toBeEnabled();
    await candidateRow.locator('.omp-resume').click();
    await expect(launch.getByRole('heading', { name: 'Tiếp tục phiên', exact: true })).toBeVisible();
    expect((await evidence()).children).toHaveLength(1);
    const resumeResponsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/omp/control/launch' && r.request().method() === 'POST');
    await launch.getByRole('button', { name: 'Tiếp tục phiên', exact: true }).click();
    const resumeResponse = await resumeResponsePromise;
    expect(resumeResponse.status()).toBe(200);
    const resumed = await resumeResponse.json() as { ok: boolean; session: Session };
    expect(resumed).toMatchObject({ ok: true, session: { id: candidateId, state: 'ready', projectAlias: PROJECT, profileAlias: PROFILE } });
    await expect(launch).not.toBeVisible();
    const resumedEvidence = await evidence();
    expect(resumedEvidence.modelRequests).toBe(0);
    expect(resumedEvidence.children).toHaveLength(2);
    const resumedChild = resumedEvidence.children[1];
    expect(resumedChild).toMatchObject({ shell: false, homeMatches: true, cwdMatches: true, foreignEnvironment: [], turns: 0,
      eof: false, exited: false, error: false, commands: ['get_state'] });
    expect(resumedChild.sessions.at(-1)).toEqual({ id: candidateSession, messageCount: 2, isStreaming: false, isSettled: true });
    expect(resumedChild.modelIds.at(-1)).toEqual({ provider: 'g3-local', id: 'probe' });
    expect(await fs.readFile(fixture.candidateFile)).toEqual(original);
    expect((await status(request)).sessions).toEqual([reply.session, resumed.session]);
    assertPublic(resumed, fixture, resumedChild);
    const duplicate = await request.post('/api/omp/control/launch', { headers: { Origin: baseURL! },
      data: { mode: 'resume', projectAlias: PROJECT, profileAlias: PROFILE, candidateId } });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).code).toBe('LAUNCH_OWNER_CONFLICT');
    expect((await evidence()).children).toHaveLength(2);
    await history.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.locator('#lite .lite-card')).toHaveCount(2);
    await page.locator('#btn-lite').click();
    await expect(page.locator(`#rail-list .ri[data-sess="${candidateId}"]`)).toHaveCount(1);
    await page.waitForFunction((id) => window.__office?.workers.has(id), candidateId);
    expect(await page.evaluate(() => [...window.__office!.workers.keys()].filter((id) => id.startsWith('omp:')).sort()))
      .toEqual([reply.session.id, candidateId].sort());
    await browser.close();
    expect((await status(request)).sessions).toEqual([reply.session, resumed.session]);
    const survived = await evidence();
    expect(survived.children[0]).toMatchObject({ pid: child.pid, exited: false, eof: false, turns: 0 });
    expect(survived.children[1]).toMatchObject({ pid: resumedChild.pid, exited: false, eof: false, turns: 0 });
    expect(survived.modelRequests).toBe(0);
    expect(errors).toEqual([]);

    // Test the actual production shutdown handler in-process. No Windows SIGTERM/taskkill.
    expect((await request.post(controlURL + '/shutdown', { headers: controlHeaders })).status()).toBe(202);
    const finalFile = path.join(native.root, 'final-evidence.json');
    await expect.poll(async () => {
      try { return JSON.parse(await fs.readFile(finalFile, 'utf8')) as Evidence; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }).toMatchObject({ stopping: true, modelRequests: 0, children: [expect.objectContaining({
      pid: child.pid, exited: true, eof: true, stdoutEOF: true, exitCode: 0, signal: null, turns: 0,
    }), expect.objectContaining({
      pid: resumedChild.pid, exited: true, eof: true, stdoutEOF: true, exitCode: 0, signal: null, turns: 0,
    })] });
    await info.attach('native-owned-lifecycle', { body: await fs.readFile(finalFile), contentType: 'application/json' });
    expect(await fs.readFile(fixture.candidateFile)).toEqual(original);
    const finalStat = await fs.stat(fixture.candidateFile);
    expect([finalStat.size, finalStat.mtimeMs, finalStat.ctimeMs]).toEqual([originalStat.size, originalStat.mtimeMs, originalStat.ctimeMs]);
  });
});
