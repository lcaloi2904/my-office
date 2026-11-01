import { test, expect, type Page } from '@playwright/test';
import { resetOmpView } from './omp-view-state';

test.beforeEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));
test.afterEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));

// File-only OMP smoke on synthetic source folders (see tests/e2e/omp-fixture.mjs, started by playwright.omp.config.ts).
// No OMP process, model, credentials or real transcript is involved. Run: playwright test -c playwright.omp.config.ts
type Item = { id: string | null; source: string; label: string; liveness: string; supported: boolean; pinned: boolean; project: string };

async function openList(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'on');
  });
  await page.goto('/?lang=en&layout=cozy');
  await expect(page.locator('#lite')).toBeVisible();
}

test('catalogue is local metadata only and an unknown or path id is refused', async ({ request }) => {
  const doctor = await (await request.get('/api/doctor')).json();
  expect(doctor.agents.omp).toMatchObject({ requestedMode: 'files', effectiveMode: 'files', reason: 'files' });
  const res = await request.get('/api/omp/catalog?limit=10');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.items).toHaveLength(3);
  expect((body.items as Item[]).every((i) => i.liveness === 'unknown' && i.supported && !i.pinned)).toBe(true);
  const text = JSON.stringify(body);
  for (const secret of ['SECRET', 'E2E synthetic', 'omp-on', 'omp-off', '.jsonl', 'fixture']) expect(text).not.toContain(secret);
  expect(body.conversation).toBe(true);
  for (const id of ['C:\\fixture\\x.jsonl', '../x', 'omp:abc']) {
    const bad = await request.post('/api/omp/pin', { data: { id, on: true } });
    expect(bad.status()).toBe(400);
  }
  // History never becomes an actor by itself.
  const snap = await (await request.get('/api/live?since=-1')).json();
  expect(JSON.stringify(snap)).not.toContain('omp:');
});

test('pin a saved session: persisted-only label, opt-in conversation, read-only drawer, unpin removes it', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openList(page);

  const open = page.locator('#lite .omp-open');
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.locator('dialog.omp-dlg[open]');
  await expect(dialog.locator('li.omp-row')).toHaveCount(3);
  await expect(dialog.locator('li.omp-row').first()).toContainText('Not live');
  await expect(dialog.locator('li.omp-row').first()).toContainText('e2e-repo');

  // Newest first: the conversation-enabled source.
  await dialog.locator('li.omp-row').first().getByRole('button', { name: 'Pin' }).click();
  await expect(dialog.locator('li.omp-row').first().getByRole('button', { name: 'Unpin' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  const card = page.locator('#lite .lite-card').filter({ hasText: 'e2e-repo' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('History · not live');
  await expect(card).toContainText('OMP');
  await expect(card).not.toContainText('NaN');

  await card.click();
  await expect(page.locator('#dr-session')).toBeVisible();
  await expect(page.locator('#ds-status')).toHaveText('History · not live');
  await expect(page.locator('#ds-actions')).toContainText('Read-only observation');
  await expect(page.locator('#ds-actions')).toContainText('saved session file');
  await expect(page.locator('#ds-actions a')).toHaveCount(0);
  await expect(page.locator('#ds-body')).toContainText('E2E synthetic assistant reply');
  await expect(page.locator('#ds-body .tool-result[data-phase="error"]')).toContainText('Tool error');
  await expect(page.locator('#ds-body')).toContainText('Branch summary');
  await expect(page.locator('#ds-body .msg-body img')).toHaveCount(0);
  expect(await page.evaluate(() => '__injected' in window)).toBe(false);
  await expect(page.locator('#ds-body')).not.toContainText('NEVER_RENDER_TOOL_ARGUMENTS');
  await expect(page.locator('#ds-body')).not.toContainText('NEVER_RENDER_TOOL_OUTPUT');
  await expect(page.locator('#ds-body')).not.toContainText('Synthetic page message 0');
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('#ds-body')).toContainText('E2E synthetic user message');
  await expect(page.locator('#ds-body')).toContainText('Synthetic page message 0');
  await page.locator('#tab-subs').click();
  await expect(page.locator('.sub-card')).toHaveCount(2);
  await expect(page.locator('#ds-body')).toContainText('Live child activity');
  const nested = page.locator('.sub-card[data-agent="Nested"]');
  await expect(nested).toContainText('History · not live');
  await expect(nested).toContainText('Parent:');
  await nested.click();
  await expect(page.locator('#ds-body')).toContainText('Synthetic child reply nested-session');
  await expect(page.locator('#ds-body')).not.toContainText('NEVER_RENDER_CHILD');

  // The snapshot (and so the replay log) carries metadata only, never the conversation.
  const snap = JSON.stringify(await (await request.get('/api/live?since=-1')).json());
  expect(snap).toContain('"persistedOnly":true');
  expect(snap).not.toContain('E2E synthetic');
  for (const hidden of ['NEVER_RENDER_TOOL', 'NEVER_RENDER_CHILD']) expect(snap).not.toContain(hidden);

  await page.locator('#ds-actions').getByRole('button', { name: 'Unpin' }).click();
  await expect(page.locator('#lite .lite-card').filter({ hasText: 'e2e-repo' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a source without conversation opt-in never exposes its text', async ({ page, request }) => {
  await openList(page);
  const catalog = await (await request.get('/api/omp/catalog?limit=10')).json();
  const off = (catalog.items as Item[]).find((i) => i.source === 'e2eoff')!;
  const pinned = await request.post('/api/omp/pin', { data: { id: off.id, on: true } });
  expect(pinned.status()).toBe(200);
  const log = await request.get('/api/log?id=' + encodeURIComponent(off.id!));
  expect(log.status()).toBe(403);
  expect((await log.json()).code).toBe('agentReadOnly');
  const card = page.locator('#lite .lite-card').filter({ hasText: 'e2e-repo' });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(page.locator('#ds-body')).toContainText('Conversation access is disabled');
  await expect(page.locator('body')).not.toContainText('E2E SECRET');
  const unpinned = await request.post('/api/omp/pin', { data: { id: off.id, on: false } });
  expect(unpinned.status()).toBe(200);
  await expect(page.locator('#lite .lite-card').filter({ hasText: 'e2e-repo' })).toHaveCount(0);
});
