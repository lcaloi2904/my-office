import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { HOME_DIR } from '../../playwright.config';

// Synthetic UI/API cases only. Execution requires the separately approved isolated build/E2E boundary.
// Reuse the existing demo/debug UI seam; never add a production ingestion/injection endpoint.
type Session = Record<string, unknown> & { id: string };
type Office = { pauseDemo: () => void; upsert: (s: Session) => void; select: (id: string) => void };

async function openDemo(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'off');
  });
  await page.goto('/?demo&debug&layout=cozy&lang=en');
  await page.waitForFunction(() => !!(window as unknown as { __office?: Office }).__office?.pauseDemo);
  await page.evaluate(() => (window as unknown as { __office: Office }).__office.pauseDemo());
}

async function selectFixture(page: Page, session: Session) {
  await page.evaluate((s) => {
    const o = (window as unknown as { __office: Office }).__office;
    o.upsert(s); o.select(s.id);
  }, session);
  await expect(page.locator('#dr-session')).toBeVisible();
}

test('synthetic OMP stays read-only and unknown usage is not rendered as zero or NaN', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page);
  const session = projectOmpSession({ sourceNamespace: 'e2e-fixture', sourceSessionId: 'session-a', model: 'anthropic/claude' });
  expect(session).not.toBeNull();
  await selectFixture(page, session!);
  await expect(page.locator('#ds-actions')).toContainText('Read-only observation');
  await expect(page.locator('#ds-actions button, #ds-actions a')).toHaveCount(0);
  await expect(page.locator('#ds-actions')).not.toContainText('/rc');
  await expect(page.locator('#ds-ctx')).toHaveText('–');
  await expect(page.locator('#ds-cost')).toHaveText('–');
  await expect(page.locator('#ds-body')).toContainText('Conversation access is disabled');
  await expect(page.locator('.av-logo[data-agent="omp"]').first()).toBeVisible();
  const railRow = page.locator('#rail-list .ri[data-sess="' + session!.id + '"]');
  await expect(railRow).toBeVisible();
  await expect(railRow.locator('.ri-dtxt')).toHaveText('Activity unknown');
  await expect(railRow.locator('.ri-time')).toHaveText('');
  await expect(railRow.locator('.ri-ctx')).toBeHidden();
  await expect(page.locator('#rail-list .grp[data-g="unknown"]')).toContainText('Activity unknown');
  await page.click('#dr-session [data-close]');
  await page.click('#btn-lite');
  const row = page.locator('.lite-card').filter({ hasText: session!.name });
  await expect(row).toContainText('OMP');
  await expect(row).toContainText('Activity unknown');
  await expect(row).not.toContainText('NaN');
  expect(errors).toEqual([]);
});

// Keep List Mode coverage independent: a rail failure must not prevent checking the list.
// The original rail assertion above remains required and is not skipped or weakened.
test('unknown OMP remains visible in List Mode independently of the rail', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page);
  await page.click('#btn-lite');
  const session = projectOmpSession({ sourceNamespace: 'e2e-fixture', sourceSessionId: 'list-only' })!;
  await selectFixture(page, session);
  await expect(page.locator('#ds-status')).toHaveText('Activity unknown');
  await page.click('#dr-session [data-close]');
  const row = page.locator('#lite .lite-card').filter({ hasText: session.name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('OMP');
  await expect(row).toContainText('Activity unknown');
  await expect(row).not.toContainText('NaN');
  await row.click();
  await expect(page.locator('#ds-actions')).toContainText('Read-only observation');
  await expect(page.locator('#ds-actions button, #ds-actions a')).toHaveCount(0);
  await expect(page.locator('#ds-ctx')).toHaveText('–');
  await expect(page.locator('#ds-cost')).toHaveText('–');
  expect(errors).toEqual([]);
});

test('unsupported provider cannot gain Claude controls from forged capabilities', async ({ page }) => {
  await openDemo(page);
  const base = projectOmpSession({ sourceNamespace: 'e2e-fixture', sourceSessionId: 'session-b' })!;
  await selectFixture(page, { ...base, id: 'agent:unknown-fixture', name: 'Unknown fixture', origin: 'fixture',
    agentKind: 'future-agent', agent: 'claude', pid: 123, link: 'https://synthetic.invalid/rc',
    capabilities: { openWindow: true, closeSession: true, changeAccount: true, remoteControl: true, readConversation: true },
    usage: { cost: 9, ctx: 0, ctxMax: 0 } });
  await expect(page.locator('#ds-actions')).toContainText('Controls are unavailable');
  const railRow = page.locator('#rail-list .ri[data-sess="agent:unknown-fixture"]');
  await expect(railRow).toBeVisible();
  await expect(railRow.locator('.av-logo')).toHaveAttribute('data-agent', 'unknown');
  await expect(railRow.locator('.ri-dtxt')).toHaveText('Activity unknown');
  await expect(railRow.locator('.ri-time')).toHaveText('');
  await expect(railRow.locator('.ri-ctx')).toBeHidden();
  await expect(railRow.locator('.ri-rc')).toHaveCount(0);
  await expect(page.locator('#ds-actions button, #ds-actions a')).toHaveCount(0);
  await expect(page.locator('#ds-ctx')).toHaveText('–');
  await expect(page.locator('#ds-body')).toContainText('Conversation access is disabled');
});

test('legacy Claude snapshot without additive fields retains the remote-control hint', async ({ page }) => {
  await openDemo(page);
  await selectFixture(page, { id: 'legacy-fixture', name: 'Legacy fixture', status: 'rest', pid: null,
    dir: '/synthetic/repo', link: null, usage: null, counts: {}, subs: [], doneSubs: [], last: null, lastAt: 1 });
  await expect(page.locator('#ds-actions')).toContainText('/rc');
  await expect(page.locator('#ds-actions')).not.toContainText('Read-only observation');
});

test('isolated production server keeps Claude lifecycle, log ownership and OMP disabled', async ({ request }) => {
  // Fail closed if the runner was not given the same isolated roots as the web server.
  expect(path.resolve(process.env.HOME || '')).toBe(HOME_DIR);
  expect(path.resolve(process.env.CLAUDE_CONFIG_DIR || '')).toBe(path.join(HOME_DIR, '.claude'));
  const doctor = await request.get('/api/doctor');
  expect(doctor.status()).toBe(200);
  expect((await doctor.json()).agents.omp).toMatchObject({ requestedMode: 'off', effectiveMode: 'off', reason: 'disabled' });

  type PublicSession = { id: string; agentKind: string; sessionKey: string;
    capabilities: Record<string, boolean>; status: string; counts: { read: number };
    lastReply: string; subs: Array<{ id: string }>; doneSubs: Array<{ id: string }> };
  const snapshot = async () => {
    const response = await request.get('/api/live?since=-1');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.msgs[0].k).toBe('snap');
    return data.msgs[0].sessions as PublicSession[];
  };
  const before = await snapshot();
  expect(before.every((s) => s.agentKind === 'claude')).toBe(true);
  const previous = new Set(before.map((s) => s.id));
  const sid = 'g2-synthetic-' + Date.now();
  const cwd = path.join(HOME_DIR, sid), transcript = path.join(cwd, 'synthetic.jsonl');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(transcript, [
    { type: 'user', message: { content: 'Synthetic user request' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Synthetic assistant response' }] } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const hook = { session_id: sid, cwd, transcript_path: transcript };
  const emit = async (event: string, extra: Record<string, unknown> = {}) => {
    const response = await request.post('/event', { data: { ...hook, hook_event_name: event, ...extra } });
    expect(response.status()).toBe(200);
  };
  let created: PublicSession | undefined;
  const current = async () => (await snapshot()).find((s) => s.id === created?.id);
  try {
    await emit('SessionStart', { source: 'startup' });
    await expect.poll(async () => {
      created = (await snapshot()).find((s) => !previous.has(s.id));
      return created?.agentKind;
    }).toBe('claude');
    expect(created?.sessionKey).toBe('claude:' + created!.id);
    expect(created?.capabilities.readConversation).toBe(true);
    expect(created?.capabilities.changeAccount).toBe(true);
    expect(created?.status).toBe('rest');

    const log = await request.get('/api/log?id=' + encodeURIComponent(created!.id));
    expect(log.status()).toBe(200);
    expect((await log.json()).items.map((item: { role: string; text: string }) => [item.role, item.text])).toEqual([
      ['user', 'Synthetic user request'], ['claude', 'Synthetic assistant response'],
    ]);
    await emit('UserPromptSubmit', { prompt: 'Synthetic user request' });
    await expect.poll(async () => (await current())?.status).toBe('work');
    await emit('PermissionRequest', { tool_name: 'Read', tool_input: { file_path: transcript } });
    await expect.poll(async () => (await current())?.status).toBe('wait');
    await emit('PostToolUse', { tool_name: 'Read', tool_input: { file_path: transcript } });
    await expect.poll(async () => (await current())?.counts.read).toBe(1);
    await expect.poll(async () => (await current())?.status).toBe('work');
    await emit('SubagentStart', { agent_id: 'fixture-child', agent_type: 'Explore' });
    await expect.poll(async () => (await current())?.subs.map((s) => s.id)).toContain('fixture-child');
    await emit('SubagentStop', { agent_id: 'fixture-child', agent_type: 'Explore' });
    await expect.poll(async () => (await current())?.doneSubs.map((s) => s.id)).toContain('fixture-child');
    await emit('Stop', { last_assistant_message: 'Synthetic assistant response' });
    await expect.poll(async () => (await current())?.status).toBe('rest');
    expect((await current())?.lastReply).toBe('Synthetic assistant response');

    // A real Claude ID cannot grant a request that explicitly identifies another provider.
    for (const url of ['/api/open', '/api/accounts/move', '/api/tasks']) {
      const response = await request.post(url, { data: {
        agentKind: 'omp', id: created!.id, sid, dir: cwd, to: '', text: 'synthetic fixture',
      } });
      expect(response.status()).toBe(403);
      expect((await response.json()).code).toBe('agentReadOnly');
    }
  } finally {
    await emit('SessionEnd', { reason: 'test' });
  }
  await expect.poll(async () => (await snapshot()).some((s) => s.id === created!.id),
    { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(false);
});

test('crafted OMP public IDs are rejected by Claude control routes', async ({ request }) => {
  const id = projectOmpSession({ sourceNamespace: 'e2e-fixture', sourceSessionId: 'never-live' })!.id;
  for (const url of ['/api/open', '/api/accounts/move', '/api/tasks']) {
    const response = await request.post(url, { data: { id, sid: id, dir: '/synthetic/repo', to: '', text: 'fixture' } });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe('agentReadOnly');
  }
});
