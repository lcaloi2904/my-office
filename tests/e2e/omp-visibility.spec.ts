import { test, expect, type Page } from '@playwright/test';
import { resetOmpView } from './omp-view-state';

test.beforeEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));
test.afterEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));

// Hide / show an OMP session on the synthetic file sources (tests/e2e/omp-fixture.mjs, started by playwright.omp.config.ts).
// No OMP process, model or credentials involved. Run: playwright test -c playwright.omp.config.ts
type Item = { id: string | null; source: string; supported: boolean; pinned: boolean };

async function openList(page: Page, debug = false) {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'on');
  });
  await page.goto(`/?lang=en&layout=cozy${debug ? '&debug' : ''}`);
  await expect(page.locator('#lite')).toBeVisible();
}

const card = (page: Page) => page.locator('#lite .lite-card').filter({ hasText: 'e2e-repo' });

test('the write route refuses a request without an Origin or from another one, and an unknown id', async ({ request, baseURL }) => {
  const catalog = await (await request.get('/api/omp/catalog?limit=10')).json();
  const first = (catalog.items as Item[]).find((i) => i.id && i.supported)!;
  const data = { id: first.id, hidden: true, expectedRevision: 0 };
  const noOrigin = await request.post('/api/omp/visibility', { data });
  expect(noOrigin.status()).toBe(403);
  expect((await noOrigin.json()).code).toBe('agentLocalOnly');
  const foreign = await request.post('/api/omp/visibility', { data, headers: { Origin: 'http://evil.example' } });
  expect(foreign.status()).toBe(403);
  const unknown = await request.post('/api/omp/visibility', { data: { ...data, id: 'omp:' + 'a'.repeat(64) }, headers: { Origin: baseURL! } });
  expect(unknown.status()).toBe(404);
  const list = await (await request.get('/api/omp/visibility')).json();
  expect(list.items).toEqual([]);
});

test('hide a pinned session: gone from the list and after a reload, still pinned, shown again from Hidden sessions', async ({ page, request, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openList(page);

  await page.locator('#lite .omp-open').click();
  const dialog = page.locator('dialog.omp-dlg[open]');
  await dialog.locator('li.omp-row').first().getByRole('button', { name: 'Pin' }).click();
  await expect(dialog.locator('li.omp-row').first().getByRole('button', { name: 'Unpin' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(1);

  await card(page).click();
  await page.locator('#ds-actions').getByRole('button', { name: 'Hide' }).click();
  await expect(card(page)).toHaveCount(0);

  // Hidden is a view preference, not an unpin: the catalogue still says pinned, and a reload does not bring it back.
  const catalog = await (await request.get('/api/omp/catalog?limit=10')).json();
  expect((catalog.items as Item[]).filter((i) => i.pinned)).toHaveLength(1);
  expect(JSON.stringify(await (await request.get('/api/live?since=-1')).json())).not.toContain('"persistedOnly":true');
  await page.reload();
  await expect(page.locator('#lite')).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await page.locator('#lite .omp-open').click();
  const hiddenDialog = page.locator('dialog.omp-dlg[open]');
  await expect(hiddenDialog.getByRole('heading', { name: 'Hidden sessions' })).toBeVisible();
  await expect(hiddenDialog.locator('#omp-hidden-list li.omp-row')).toHaveCount(1);
  const pinnedId = (catalog.items as Item[]).find((i) => i.pinned)!.id;
  await hiddenDialog.locator('#omp-hidden-list button[data-omp-id="' + pinnedId + '"]').click();
  await expect(card(page)).toHaveCount(1);
  await expect(hiddenDialog.locator('#omp-hidden-list li.lite-empty')).toBeVisible();
  await hiddenDialog.getByRole('button', { name: 'Close' }).click();

  // A stale revision is refused (another tab changed the list), and nothing changes.
  const stale = await request.post('/api/omp/visibility', { data: { id: (catalog.items as Item[]).find((i) => i.pinned)!.id, hidden: true, expectedRevision: 0 }, headers: { Origin: baseURL! } });
  expect(stale.status()).toBe(409);

  await card(page).click();
  await page.locator('#ds-actions').getByRole('button', { name: 'Unpin' }).click();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard actions hide the rail and 3D actor, Undo restores the same session, and unpin stays separate', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const catalog = await (await request.get('/api/omp/catalog?limit=10')).json();
  const item = (catalog.items as Item[]).find((i) => i.id && i.supported && i.source === 'e2eon')!;
  expect((await request.post('/api/omp/pin', { data: { id: item.id, on: true } })).ok()).toBe(true);
  await openList(page, true);
  await expect(card(page)).toHaveCount(1);
  await page.locator('#btn-lite').click();
  const row = page.locator('#rail-list .ri[data-sess="' + item.id + '"]');
  await expect(row).toBeVisible();
  await page.waitForFunction((id) => window.__office?.workers.has(id!), item.id);
  const menu = page.locator('#rail-list [data-omp-actions="' + item.id + '"]');
  await menu.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('.omp-actions-dlg[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-omp-action="refresh"]').click();
  await dialog.locator('[data-omp-action="hide"]').click();
  await expect(row).toHaveCount(0);
  await page.waitForFunction((id) => !window.__office?.workers.has(id!), item.id);
  await page.locator('.omp-undo [data-omp-action="undo"]').click();
  await expect(row).toBeVisible();
  await page.waitForFunction((id) => window.__office?.workers.has(id!), item.id);
  const afterUndo = await (await request.get('/api/omp/catalog?limit=10')).json();
  expect((afterUndo.items as Item[]).find((i) => i.id === item.id)?.pinned).toBe(true);
  await menu.click();
  await dialog.locator('[data-omp-action="unpin"]').click();
  await expect(row).toHaveCount(0);
  await page.waitForFunction((id) => !window.__office?.workers.has(id!), item.id);
  expect(errors).toEqual([]);
});
