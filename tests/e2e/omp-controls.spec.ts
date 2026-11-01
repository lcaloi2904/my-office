import { test, expect, type Page } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { resetOmpView } from './omp-view-state';

const RT_1 = '00000000-0000-4000-8000-000000000101';
const RT_2 = '00000000-0000-4000-8000-000000000202';

test.beforeEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));
test.afterEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));

async function openDebugOffice(page: Page, lang = 'vi') {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'off');
  });
  await page.goto(`/?debug&layout=cozy&lang=${lang}`);
  await page.waitForFunction(() => Boolean(window.__office));
  await expect(page.locator('#conn[data-state="on"]')).toBeVisible();
}
test('HTTP negative guards on /api/omp/control/command reject missing Origin, foreign Origin, bad content-type and flag OFF', async ({ request, baseURL }) => {
  const status = await (await request.get('/api/omp/control/status')).json();
  expect(status.enabled).toBe(false);
  expect(status.controlEnabled).toBe(false);

  const payload = {
    id: 'omp:' + '1'.repeat(64),
    runtimeInstanceId: RT_1,
    generation: 1,
    requestId: 'req-e2e-neg-1',
    kind: 'prompt',
    text: 'Do not run when disabled',
  };

  // Missing Origin rejected
  const noOrigin = await request.post('/api/omp/control/command', { data: payload });
  expect(noOrigin.status()).toBe(403);
  expect((await noOrigin.json()).code).toBe('agentLocalOnly');

  // Foreign Origin rejected
  const foreignOrigin = await request.post('/api/omp/control/command', {
    headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
    data: payload,
  });
  expect(foreignOrigin.status()).toBe(403);

  // Bad Content-Type rejected
  const badContentType = await request.fetch('/api/omp/control/command', {
    method: 'POST',
    headers: { Origin: baseURL!, 'Content-Type': 'text/plain' },
    data: JSON.stringify(payload),
  });
  expect(badContentType.status()).toBe(403);

  // Same-origin with OFFICE_OMP_CONTROL OFF returns 403 COMMAND_DISABLED
  const flagOff = await request.post('/api/omp/control/command', {
    headers: { Origin: baseURL! },
    data: payload,
  });
  expect(flagOff.status()).toBe(403);
  expect((await flagOff.json()).code).toBe('COMMAND_DISABLED');
});

test('managed OMP composer UI: idle prompt, busy steer/followUp/queueRemove, two-step abort, and session switch isolation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDebugOffice(page, 'vi');

  const commandsSent: Array<Record<string, unknown>> = [];
  await page.route('**/api/omp/control/command*', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    commandsSent.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        code: 'OK',
        status: body.kind === 'prompt' ? 'accepted' : body.kind === 'abort' || body.kind === 'queueRemove' ? 'settled' : 'queued',
        requestId: body.requestId,
        id: body.id,
        runtimeInstanceId: body.runtimeInstanceId,
        generation: body.generation,
        deduplicated: false,
      }),
    });
  });

  // 1. Observer-only session disables composer with clear reason
  const obsSession = projectOmpSession({
    sourceNamespace: 'e2e',
    sourceSessionId: 'obs-1',
    project: 'observer-proj',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_1,
      generation: 1,
      observedAt: Date.now(),
      connection: 'connected',
      lifecycle: 'open',
      activity: 'idle',
    },
  })!;
  await page.evaluate((s) => {
    window.__office.upsert(s);
    window.__office.select(s.id);
  }, obsSession);
  await expect(page.locator('#dr-session')).toBeVisible();
  await expect(page.locator('.omp-control-disabled-reason')).toContainText('Phiên chỉ quan sát');
  await expect(page.locator('.omp-composer-input')).toBeDisabled();
  await expect(page.locator('.omp-send-btn')).toBeDisabled();

  // 2. Managed idle session enables Prompt, disables Steer/Follow-up/Abort
  const managedIdle = projectOmpSession({
    sourceNamespace: 'e2e',
    sourceSessionId: 'managed-1',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_1,
      generation: 1,
      observedAt: Date.now(),
      connection: 'connected',
      lifecycle: 'open',
      activity: 'idle',
    },
    managed: {
      owner: 'managed',
      state: 'ready',
      runtimeInstanceId: RT_1,
      generation: 1,
      canPrompt: true,
      canSteer: false,
      canFollowUp: false,
      canAbort: false,
      canQueueRemove: false,
      queued: { steering: [], followUp: [], liveSteered: 0, count: 0 },
    },
  })!;
  await page.evaluate((s) => {
    window.__office.upsert(s);
    window.__office.select(s.id);
  }, managedIdle);

  const input = page.locator('.omp-composer-input');
  const sendBtn = page.locator('.omp-send-btn');
  await expect(input).toBeEnabled();
  await expect(sendBtn).toBeEnabled();
  await expect(sendBtn).toHaveText('Gửi prompt');
  await expect(page.locator('.omp-abort-btn')).toBeDisabled();

  // Selecting Steer while idle keeps Send disabled (no silent fallback to Prompt)
  await page.locator('button[data-omp-mode="steer"]').click();
  await expect(sendBtn).toBeDisabled();
  await page.locator('button[data-omp-mode="prompt"]').click();
  await expect(sendBtn).toBeEnabled();

  await input.fill('Kiểm tra cấu trúc dự án');
  await sendBtn.click();
  expect(commandsSent).toHaveLength(1);
  expect(commandsSent[0]).toMatchObject({
    id: managedIdle.id,
    runtimeInstanceId: RT_1,
    generation: 1,
    kind: 'prompt',
    text: 'Kiểm tra cấu trúc dự án',
  });
  await expect(page.locator('.omp-cmd-status')).toContainText('RPC đã nhận');

  // 3. Transition session to busy active turn -> Prompt disabled, Steer & Follow-up enabled, Queue chips rendered
  const managedBusy = projectOmpSession({
    sourceNamespace: 'e2e',
    sourceSessionId: 'managed-1',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_1,
      generation: 1,
      observedAt: Date.now(),
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['read'],
    },
    managed: {
      owner: 'managed',
      state: 'ready',
      runtimeInstanceId: RT_1,
      generation: 1,
      canPrompt: false,
      canSteer: true,
      canFollowUp: true,
      canAbort: true,
      canQueueRemove: true,
      queued: {
        steering: ['Ưu tiên kiểm tra lỗi bảo mật'],
        followUp: ['Chạy bộ unit test sau khi xong'],
        liveSteered: 0,
        count: 2,
      },
      lastCommand: {
        requestId: String(commandsSent[0].requestId),
        kind: 'prompt',
        status: 'running',
        updatedAt: Date.now(),
      },
    },
  })!;
  await page.evaluate((s) => window.__office.upsert(s), managedBusy);
  await expect(page.locator('.omp-cmd-status')).toContainText('Đang chạy lượt');
  await expect(page.locator('.omp-queue-chip')).toHaveCount(2);

  // Switch to Steer mode and send steer
  await page.locator('button[data-omp-mode="steer"]').click();
  await expect(sendBtn).toBeEnabled();
  await input.fill('Bỏ qua thư mục dist');
  await sendBtn.click();
  expect(commandsSent).toHaveLength(2);
  expect(commandsSent[1]).toMatchObject({
    id: managedBusy.id,
    kind: 'steer',
    text: 'Bỏ qua thư mục dist',
  });

  // Remove a queued item
  await page.locator('.omp-queue-chip[data-queue-kind="followUp"] .omp-queue-remove').click();
  expect(commandsSent).toHaveLength(3);
  expect(commandsSent[2]).toMatchObject({
    id: managedBusy.id,
    kind: 'queueRemove',
    queue: 'followUp',
    text: 'Chạy bộ unit test sau khi xong',
  });

  // Two-step abort confirmation
  const abortBtn = page.locator('.omp-abort-btn');
  await expect(abortBtn).toBeEnabled();
  await expect(abortBtn).toHaveText('Dừng lượt');
  await abortBtn.click();
  expect(commandsSent).toHaveLength(3); // First click only arms
  await expect(abortBtn).toHaveText('Chắc chắn dừng lượt?');
  await abortBtn.click();
  expect(commandsSent).toHaveLength(4);
  expect(commandsSent[3]).toMatchObject({
    id: managedBusy.id,
    kind: 'abort',
  });

  // 4. Switching to a second managed session keeps separate draft and targets only the selected session
  const secondManaged = projectOmpSession({
    sourceNamespace: 'e2e',
    sourceSessionId: 'managed-2',
    project: 'auto-pmh',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_2,
      generation: 1,
      observedAt: Date.now(),
      connection: 'connected',
      lifecycle: 'open',
      activity: 'idle',
    },
    managed: {
      owner: 'managed',
      state: 'ready',
      runtimeInstanceId: RT_2,
      generation: 1,
      canPrompt: true,
      canSteer: false,
      canFollowUp: false,
      canAbort: false,
      canQueueRemove: false,
    },
  })!;
  await page.evaluate((s) => {
    window.__office.upsert(s);
    window.__office.select(s.id);
  }, secondManaged);
  await expect(input).toHaveValue('');
  await input.fill('Lệnh riêng cho auto-pmh');
  await page.locator('button[data-omp-mode="prompt"]').click();
  await sendBtn.click();
  expect(commandsSent).toHaveLength(5);
  expect(commandsSent[4]).toMatchObject({
    id: secondManaged.id,
    runtimeInstanceId: RT_2,
    kind: 'prompt',
    text: 'Lệnh riêng cho auto-pmh',
  });
  expect(errors).toEqual([]);
});
