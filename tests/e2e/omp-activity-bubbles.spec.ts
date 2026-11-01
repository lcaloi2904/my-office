import { test, expect, type Page } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { resetOmpView } from './omp-view-state';

const RT_OFFICE = '00000000-0000-4000-8000-000000000301';
const RT_PMH = '00000000-0000-4000-8000-000000000302';

test.beforeEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));
test.afterEach(async ({ request, baseURL }) => resetOmpView(request, baseURL!));

async function openScene(page: Page, lang = 'vi') {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'off');
    localStorage.setItem('office-stream', 'off');
    localStorage.setItem('office-omp-detail', 'on');
  });
  await page.goto(`/?debug&layout=cozy&lang=${lang}`);
  await page.waitForFunction(() => Boolean(window.__office));
  await expect(page.locator('#conn[data-state="on"]')).toBeVisible();
}
async function bubbleOf(page: Page, sessionId: string) {
  return page.evaluate((id) => {
    const w = window.__office.workers.get(id);
    if (!w) return null;
    const txt = w.bubbleEl.querySelector('.b-txt')?.textContent || '';
    return {
      visible: w.bubbleObj.visible,
      text: txt,
      length: txt.length,
      sayKey: w.sayKey || '',
      className: w.bubbleEl.className,
    };
  }, sessionId);
}

test('two simultaneous OMP agents (my-office & auto-pmh): independent 3D bubbles, read->edit->test, lifecycle clear, Streamer Mode and event burst coalescing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'vi');

  const now = Date.now();
  const sOffice = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 1,
      observedAt: now,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['read'],
      activitySummary: {
        kind: 'read',
        safeSubject: 'workers.js',
        source: 'managedRpc',
        runtimeInstanceId: RT_OFFICE,
        generation: 1,
        eventSequence: 1,
        observedAt: now,
      },
    },
  })!;

  // Observer-only agent: category only, no filename invented
  const sPmh = projectOmpSession({
    sourceNamespace: 'src-pmh',
    sourceSessionId: 'sess-pmh',
    project: 'auto-pmh',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_PMH,
      generation: 1,
      sequence: 1,
      observedAt: now,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['cmd'],
    },
  })!;

  await page.evaluate(([a, b]) => {
    window.__office.upsert(a);
    window.__office.upsert(b);
  }, [sOffice, sPmh]);

  const bOffice1 = await bubbleOf(page, sOffice.id);
  const bPmh1 = await bubbleOf(page, sPmh.id);
  expect(bOffice1).not.toBeNull();
  expect(bPmh1).not.toBeNull();
  expect(bOffice1!.visible).toBe(true);
  expect(bPmh1!.visible).toBe(true);
  expect(bOffice1!.text).toBe('Đang đọc workers.js');
  expect(bPmh1!.text).toBe('Đang chạy lệnh');
  expect(bOffice1!.length).toBeLessThanOrEqual(80);
  expect(bPmh1!.length).toBeLessThanOrEqual(80);

  // Transition sOffice: read -> edit -> test -> waiting -> idle -> disconnected -> ended
  const sOfficeEdit = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 2,
      observedAt: now + 1000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['edit'],
      activitySummary: {
        kind: 'edit',
        safeSubject: 'session-drawer.js',
        source: 'managedRpc',
        runtimeInstanceId: RT_OFFICE,
        generation: 1,
        eventSequence: 2,
        observedAt: now + 1000,
      },
    },
  })!;
  await page.evaluate((a) => window.__office.upsert(a), sOfficeEdit);
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Đang sửa session-drawer.js');
  // Other agent bubble remains untouched
  expect((await bubbleOf(page, sPmh.id))!.text).toBe('Đang chạy lệnh');

  // Streamer Mode immediately scrubs safeSubject detail to generic category label
  await page.click('#btn-look');
  await page.click('[data-st-tab="display"]');
  await page.click('[data-tgl="stream"]');
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Đang sửa code');
  await page.click('[data-tgl="stream"]');
  await page.click('#st-close');
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Đang sửa session-drawer.js');

  // Transition to test
  const sOfficeTest = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 3,
      observedAt: now + 2000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['cmd'],
      activitySummary: {
        kind: 'test',
        source: 'managedRpc',
        runtimeInstanceId: RT_OFFICE,
        generation: 1,
        eventSequence: 3,
        observedAt: now + 2000,
      },
    },
  })!;
  await page.evaluate((a) => window.__office.upsert(a), sOfficeTest);
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Đang chạy test');

  // Waiting overrides active tool
  const sOfficeWait = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 4,
      observedAt: now + 3000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'waiting',
      waitReasons: ['approval'],
    },
  })!;
  await page.evaluate((a) => window.__office.upsert(a), sOfficeWait);
  const waitBubble = await bubbleOf(page, sOffice.id);
  expect(waitBubble!.text).toBe('Đang chờ phê duyệt');
  expect(waitBubble!.className).toContain('bubble--wait');

  // Idle clears active work label immediately (never sticks on "Đang sửa" or "Đang chạy test")
  const sOfficeIdle = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 5,
      observedAt: now + 4000,
      connection: 'connected',
      lifecycle: 'open',
      activity: 'idle',
    },
  })!;
  await page.evaluate((a) => window.__office.upsert(a), sOfficeIdle);
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Sẵn sàng nhận yêu cầu');

  // Disconnected or eventGap clears previous activity label to honest status
  const sOfficeDisconnected = projectOmpSession({
    sourceNamespace: 'src-office',
    sourceSessionId: 'sess-office',
    project: 'my-office',
    persistedOnly: false,
    live: {
      runtimeInstanceId: RT_OFFICE,
      generation: 1,
      sequence: 6,
      observedAt: now + 5000,
      connection: 'disconnected',
      lifecycle: 'open',
      activity: 'active',
      toolCategories: ['edit'],
    },
  })!;
  await page.evaluate((a) => window.__office.upsert(a), sOfficeDisconnected);
  expect((await bubbleOf(page, sOffice.id))!.text).toBe('Mất kết nối · chưa rõ hoạt động');

  // Event-burst coalescing: 25 rapid identical updates do not mutate DOM nodes repeatedly
  const mutations = await page.evaluate(([id, sessionObj]) => {
    const w = window.__office.workers.get(id)!;
    let count = 0;
    const obs = new MutationObserver(() => { count++; });
    obs.observe(w.bubbleEl, { childList: true, subtree: true, characterData: true });
    for (let i = 0; i < 25; i++) {
      window.__office.upsert({ ...sessionObj, lastAt: Date.now() + i });
    }
    obs.disconnect();
    return count;
  }, [sPmh.id, sPmh] as const);
  expect(mutations).toBe(0);
  expect(errors).toEqual([]);
});
