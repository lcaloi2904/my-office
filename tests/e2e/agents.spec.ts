import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { HOME_DIR } from '../../playwright.config';

// Synthetic UI/API cases only. Execution requires the separately approved isolated build/E2E boundary.
// Reuse the existing demo/debug UI seam; never add a production ingestion/injection endpoint.
type Session = Record<string, unknown> & { id: string };
type Office = { pauseDemo: () => void; upsert: (s: Session) => void; select: (id: string) => void; speed: (n: number) => void;
  emit: (m: Record<string, unknown>, quiet?: boolean) => void; sessions: Map<string, Session>;
  workers: Map<string, { cfg: Record<string, unknown>; id: string; anim: string; phase: string; station: string; update: (dt: number, t: number) => void; parent?: { id: string }; tagEl: HTMLElement }>;
  subs: Map<string, { id: string; anim: string; parent: { id: string } }>; limitOut: (minutes: number) => void };
// In-process debug hook installed by this application's ?debug entry point.
declare global { interface Window { __office: Office } }

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

test('mixed snapshot keeps identities, child ownership and appearance through rename and reconnect', async ({ page }) => {
  await openDemo(page);
  const omp = { ...projectOmpSession({ sourceNamespace: 'ui-mixed', sourceSessionId: 'root' })!, name: 'Same name', project: 'repo', projectKey: 'a'.repeat(64) };
  const claude = { id: 'mixed-claude', sessionKey: 'claude:mixed-claude', name: 'Same name', dir: '/other/repo',
    projectKey: 'b'.repeat(64), status: 'work', counts: {}, subs: [{ id: 'same-child', type: 'Explore', parentAgentKey: 'claude:mixed-claude' }], doneSubs: [], lastAt: 1 };
  const other = { ...claude, id: 'mixed-other', sessionKey: 'claude:mixed-other', projectKey: 'c'.repeat(64) };
  const result = await page.evaluate(({ omp, claude, other }) => {
    const o = window.__office, list = [omp, claude, other];
    o.emit({ k: 'snap', sessions: list, feed: [], stats: {} });
    const first = o.workers.get(claude.id), cfg = JSON.stringify(first?.cfg), desk = o.sessions.get(claude.id)?.desk;
    o.emit({ k: 'snap', sessions: list.map((s) => s.id === claude.id ? { ...s, name: 'Renamed' } : s), feed: [], stats: {} });
    return { count: o.workers.size, childParents: [...o.subs.values()].map((w) => w.parent.id).sort(), sameWorker: o.workers.get(claude.id) === first,
      sameLook: JSON.stringify(o.workers.get(claude.id)?.cfg) === cfg, desk, otherDesk: o.sessions.get(other.id)?.desk, renamed: o.sessions.get(claude.id)?.name };
  }, { omp, claude, other });
  expect(result).toMatchObject({ count: 3, childParents: ['mixed-claude', 'mixed-other'], sameWorker: true, sameLook: true, renamed: 'Renamed' });
  expect(result.desk).not.toBe(result.otherDesk);
  await expect(page.locator('#rail-list .ri')).toHaveCount(3);
  await expect(page.locator('#rail-list .ri').filter({ hasText: 'Renamed' })).toHaveCount(1);
  await page.evaluate(({ omp, other }) => window.__office.emit({ k: 'snap', sessions: [omp, other], feed: [], stats: {} }), { omp, other });
  expect(await page.evaluate(() => [...window.__office.subs.values()].map((w) => w.parent.id))).toEqual(['mixed-other']);
});

test('OMP runtime evidence and scoped metrics stay independent from Claude quota and task recipients', async ({ page }) => {
  await openDemo(page);
  const base = projectOmpSession({ sourceNamespace: 'ui-live', sourceSessionId: 'root', model: 'anthropic/claude',
    live: { lifecycle: 'open', connection: 'connected', activity: 'waiting', waitReasons: ['approval'] },
    metrics: { cost: { value: 2.5, scope: 'inherited', provenance: 'recorded' }, context: { used: 500, window: 1000, provenance: 'recorded' } } })!;
  await selectFixture(page, base);
  await expect(page.locator('#ds-status')).toHaveText('Waiting for approval');
  await expect(page.locator('#ds-dir')).toContainText('Runtime confirmed');
  await expect(page.locator('#ds-cost')).toHaveText('$2.50');
  await expect(page.locator('#ds-cost').locator('..')).toHaveAttribute('title', /inherited history.*recorded/);
  await expect(page.locator('#ds-ctx')).toHaveText('50%');
  await page.evaluate(() => window.__office.limitOut(10));
  await expect(page.locator('#ds-status')).toHaveText('Waiting for approval');
  await selectFixture(page, { ...base, connection: 'stale', activity: 'unknown', status: 'unknown' });
  await expect(page.locator('#ds-status')).toHaveText('Stale · activity unknown');
  await expect(page.locator('#rail-list .ri[data-sess="' + base.id + '"]')).not.toContainText('Just finished');
  const gap = projectOmpSession({ sourceNamespace: 'ui-live', sourceSessionId: 'root', live: { connection: 'connected', lifecycle: 'open', activity: 'active', gap: true, toolCategories: ['read'] } })!;
  await selectFixture(page, gap);
  await expect(page.locator('#ds-status')).toHaveText('Activity unknown');
  await expect(page.locator('#ds-dir')).not.toContainText('Runtime confirmed');
  expect(await page.evaluate((id) => window.__office.workers.get(id)?.anim, gap.id)).toBe('idle');
  await selectFixture(page, { ...base, lifecycle: 'ended', activity: 'unknown', status: 'unknown' });
  await expect(page.locator('#ds-status')).toHaveText('Runtime ended');
  await expect(page.locator('#dr-session')).toHaveAttribute('data-lifecycle', 'ended');
  await expect(page.locator('#ds-actions button, #ds-actions a')).toHaveCount(0);
  await page.locator('#dr-session [data-close]').click();
  await page.locator('#btn-chat').click();
  const input = page.locator('.zc-in');
  await input.fill('@OMP');
  await input.dispatchEvent('input');
  await expect(page.locator('.zc-men-o').filter({ hasText: base.name })).toHaveCount(0);
});

test('bounded actors retain every session in List Mode and show the unchanged nested parent tree', async ({ page }) => {
  await openDemo(page);
  const root = { id: 'tree-root', sessionKey: 'claude:tree-root', name: 'Tree root', status: 'work', counts: {}, subs: [
    { id: 'child', agentKey: 'child-key', parentAgentKey: 'claude:tree-root', type: 'Parent task' },
    { id: 'nested', agentKey: 'nested-key', parentAgentKey: 'child-key', type: 'Nested task', lifecycle: 'parked' },
  ], doneSubs: [], lastAt: 1 };
  await page.evaluate((root) => {
    const o = window.__office;
    o.emit({ k: 'snap', sessions: [root, ...Array.from({ length: 66 }, (_, i) => ({ id: 'overflow-' + i, sessionKey: 'claude:overflow-' + i, name: 'Overflow ' + i, status: 'unknown', dir: '', counts: {}, subs: [], doneSubs: [] }))], feed: [], stats: {} });
    o.select(root.id);
  }, root);
  await page.locator('#tab-subs').click();
  await expect(page.locator('.sub-card')).toHaveCount(2);
  await expect(page.locator('.sub-card[data-agent="nested"]')).toHaveAttribute('data-parent', 'child-key');
  await expect(page.locator('.sub-card[data-agent="nested"]')).toContainText('Parent: Parent task');
  expect(await page.locator('.sub-card[data-agent="nested"] b').evaluate((label) => label.clientWidth >= label.scrollWidth)).toBe(true);
  await expect(page.locator('#active-count')).toContainText('1 subagent running');
  await expect(page.locator('#ds-body')).toContainText('parent relationships below are unchanged');
  const sizes = await page.evaluate(() => { const o = window.__office; return { actors: o.workers.size + o.subs.size, sessions: o.sessions.size }; });
  expect(sizes.actors).toBeLessThanOrEqual(64);
  expect(sizes.sessions).toBe(67);
  await page.locator('#dr-session [data-close]').click();
  await page.locator('#btn-lite').click();
  await expect(page.locator('.lite-card')).toHaveCount(67);
  await expect(page.locator('#lite')).toContainText('3D limit');
  await page.locator('.lite-card[data-sess="overflow-65"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ds-name')).toHaveText('Overflow 65');
});

test.describe('mixed mobile List Mode', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('stale OMP stays readable and keyboard-accessible without overflow', async ({ page }) => {
    await openDemo(page);
    await page.locator('#btn-lite').click();
    const session: Session = projectOmpSession({ sourceNamespace: 'ui-phone', sourceSessionId: 'root', live: { connection: 'stale', lifecycle: 'open', activity: 'active' } })!;
    session.subs = [
      { id: 'saved-parent', agentKey: 'saved-parent-key', parentAgentKey: session.sessionKey, type: 'Long saved task label for responsive layout', persistedOnly: true, lifecycle: 'historical' },
      { id: 'saved-nested', agentKey: 'saved-nested-key', parentAgentKey: 'saved-parent-key', type: 'Nested task', persistedOnly: true, lifecycle: 'historical' },
    ];
    await page.evaluate((s) => window.__office.emit({ k: 'snap', sessions: [s], feed: [], stats: {} }), session);
    const card = page.locator('.lite-card[data-sess="' + session.id + '"]');
    await expect(card).toContainText('Stale · activity unknown');
    await card.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#ds-actions')).toContainText('Read-only observation');
    await expect(page.locator('#ds-cost')).toHaveText('–');
    await page.locator('#tab-subs').click();
    const child = page.locator('#ds-body .sub-card[data-agent="saved-nested"]');
    await expect(child).toContainText('History · not live');
    expect(await child.locator('b').evaluate((label) => label.clientWidth >= label.scrollWidth)).toBe(true);
    await child.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#ds-body')).toContainText('Conversation access is disabled');
    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
  });
});

test('replay preserves recorded approval poses and identities without changing live preferences or controls', async ({ page }) => {
  const now = Date.now(), s = { id: 'replay-root', sessionKey: 'claude:replay-root', name: 'Recorded root', dir: '/recorded/repo',
    projectKey: 'recorded-project', desk: 47, status: 'work', last: { type: 'read', label: 'recorded.ts' }, counts: {}, subs: [], doneSubs: [] };
  const waiting = { ...s, name: 'Recorded renamed', status: 'wait' };
  const items = [
    { t: now - 55000, m: { k: 'snap', sessions: [s], feed: [], stats: {} } },
    { t: now - 52000, m: { k: 'ev', s, e: { id: 1, sess: s.id, type: 'read', label: 'recorded.ts' } } },
    { t: now - 50000, m: { k: 'ev', s: waiting, e: { id: 2, sess: s.id, type: 'wait', label: 'Recorded approval' } } },
    { t: now - 49000, m: { k: 'perm', p: { id: 'must-not-approve', sess: s.id, kind: 'perm' } } },
  ];
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); localStorage.setItem('office-lite', 'off');
    localStorage.setItem('office-areas', JSON.stringify({ 'live-project': [0] }));
  });
  await page.route('**/api/replay?*', (route) => route.fulfill({ json: { items } }));
  await page.goto('/?debug&layout=cozy&lang=en');
  await page.waitForFunction(() => !!window.__office?.sessions);
  const before = await page.evaluate(() => localStorage.getItem('office-areas'));
  const liveCalls: string[] = [];
  page.on('request', (r) => { if (['/api/log', '/api/open', '/api/tasks', '/api/accounts/move'].includes(new URL(r.url()).pathname)) liveCalls.push(r.url()); });
  await page.locator('#btn-replay').click();
  await expect(page.locator('body')).toHaveClass(/is-replay/);
  await expect.poll(() => page.evaluate(() => window.__office.workers.get('replay-root')?.anim)).toBe('hand');
  expect(await page.evaluate(() => localStorage.getItem('office-areas'))).toBe(before);
  await expect(page.locator('#perm-stack .perm-card')).toHaveCount(0);
  await page.evaluate(() => window.__office.select('replay-root'));
  await expect(page.locator('#ds-name')).toHaveText('Recorded renamed');
  await expect(page.locator('#ds-actions button, #ds-actions a')).toHaveCount(0);
  await expect(page.locator('#ds-body')).toContainText('Conversation access is disabled');
  await page.locator('#dr-session [data-close]').click();
  await page.locator('#rp-seek').focus(); await page.keyboard.press('Home'); await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.__office.workers.get('replay-root')?.anim)).toBe('hand');
  expect(await page.evaluate(() => window.__office.sessions.get('replay-root')?.sessionKey)).toBe('claude:replay-root');
  await page.locator('#rp-close').click();
  await expect(page.locator('body')).not.toHaveClass(/is-replay/);
  expect(await page.evaluate(() => localStorage.getItem('office-areas'))).toBe(before);
  expect(liveCalls).toEqual([]);
});

test('forward replay seek supersedes a walking action and preserves snapshot-only child activity', async ({ page }) => {
  const now = Date.now(), s = { id: 'seek-root', sessionKey: 'claude:seek-root', name: 'Seek root', dir: '/recorded/seek',
    status: 'work', last: null, counts: {}, doneSubs: [], subs: [{ id: 'recorded-child', type: 'Explore', last: { type: 'read', label: 'child.ts' } }] };
  const reading = { ...s, last: { type: 'read', label: 'root.ts' } }, waiting = { ...reading, status: 'wait' };
  const items = [
    { t: now - 300000, m: { k: 'snap', sessions: [s], feed: [], stats: {} } },
    { t: now - 290000, m: { k: 'ev', s: reading, e: { id: 1, sess: s.id, type: 'read', label: 'root.ts' } } },
    { t: now - 120000, m: { k: 'ev', s: waiting, e: { id: 2, sess: s.id, type: 'wait', label: 'Forward seek approval' } } },
  ];
  await page.addInitScript(() => { localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); localStorage.setItem('office-lite', 'off'); });
  await page.route('**/api/replay?*', (route) => route.fulfill({ json: { items } }));
  await page.goto('/?debug&layout=cozy&lang=en');
  await page.waitForFunction(() => !!window.__office?.sessions);
  await page.evaluate(() => window.__office.speed(0.05));
  await page.locator('#btn-replay').click();
  await page.waitForFunction(() => window.__office.workers.get('seek-root')?.phase === 'walk');
  expect(await page.evaluate(() => [...window.__office.subs.values()].find((w) => w.id === 'recorded-child')?.anim)).toBe('read');
  await page.locator('#rp-play').click();
  await page.locator('#rp-seek').evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected replay slider');
    input.value = '1000'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => {
    const w = window.__office.workers.get('seek-root'); if (!w) throw new Error('Missing recorded actor');
    for (let i = 0; i < 120; i++) w.update(1 / 30, 0);
    return { root: w.anim, station: w.station, child: [...window.__office.subs.values()].find((c) => c.id === 'recorded-child')?.anim };
  });
  expect(after).toEqual({ root: 'hand', station: 'library', child: 'read' });
  const returned = await page.evaluate((reading) => {
    const s = { ...reading, status: 'work', last: { type: 'edit', label: 'root.ts' } };
    window.__office.emit({ k: 'ev', s, e: { sess: s.id, type: 'edit', label: 'root.ts' } });
    const w = window.__office.workers.get(s.id); if (!w) throw new Error('Missing recorded actor');
    for (let i = 0; i < 600; i++) w.update(1 / 30, 0);
    return w.station;
  }, reading);
  expect(returned).toBe('desk');
  await page.locator('#rp-close').click();
});
