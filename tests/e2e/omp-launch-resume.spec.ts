import { test, expect } from '@playwright/test';

// Synthetic OMP file fixture only; the launcher flag stays OFF in this server.
// UI contract tests mock only public status and a denied command. No OMP process, model or auth.
test('flag OFF is fail-closed, including forged Origin and launch payload', async ({ request, baseURL }) => {
  const status = await request.get('/api/omp/control/status');
  expect(status.status()).toBe(200);
  expect((await status.json()).enabled).toBe(false);
  const body = { mode: 'new', projectAlias: 'e2e', profileAlias: 'fixture' };
  const denied = await request.post('/api/omp/control/launch', { data: body, headers: { Origin: baseURL! } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe('LAUNCH_UNAVAILABLE');
  const missingOrigin = await request.post('/api/omp/control/launch', { data: body });
  expect(missingOrigin.status()).toBe(403);
  const forged = await request.post('/api/omp/control/launch', { data: body, headers: { Origin: 'http://evil.example' } });
  expect(forged.status()).toBe(403);
});

test('OMP history has no new/resume controls with OFF flag', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'on');
  });
  await page.goto('/?lang=en&layout=cozy');
  await page.locator('#lite .omp-open').click();
  const dialog = page.locator('dialog.omp-dlg[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.omp-launch-new')).toHaveCount(0);
  await expect(dialog.locator('.omp-resume')).toHaveCount(0);
});

test('local launch dialog uses only server-approved aliases; resume disabled without exclusive proof', async ({ page }) => {
  await page.route('**/api/omp/control/status**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, enabled: true, resumeAvailable: false,
      projects: [{ alias: 'projectFixture', sourceId: 'e2eon' }], profiles: [{ alias: 'profileFixture' }],
      sessions: [],
    }) });
  });
  let requestBody: unknown = null;
  await page.route('**/api/omp/control/launch**', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'LAUNCH_FAILED' }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'on');
  });
  await page.goto('/?lang=en&layout=cozy');
  await page.locator('#lite .omp-open').click();
  const history = page.locator('dialog.omp-dlg[open]');
  await expect(history.locator('.omp-launch-new')).toBeVisible();
  await expect(history.locator('.omp-resume').first()).toBeDisabled();
  await history.locator('.omp-launch-new').click();
  const launch = page.locator('dialog.omp-launch-dlg[open]');
  await expect(launch).toBeVisible();
  await expect(launch.locator('select[name="projectAlias"] option')).toHaveText(['projectFixture']);
  await expect(launch.locator('select[name="profileAlias"] option')).toHaveText(['profileFixture']);
  await launch.getByRole('button', { name: 'Create session' }).click();
  await expect(launch.getByRole('status')).toContainText('Could not start');
  expect(requestBody).toEqual({ mode: 'new', projectAlias: 'projectFixture', profileAlias: 'profileFixture' });
  await launch.getByRole('button', { name: 'Close' }).click();
});
