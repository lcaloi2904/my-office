import { test, expect, type Page } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { projectOmpUsageSnapshot } from '../../server/agents/omp/usage-accounts.mjs';

async function openDemo(page: Page, query = 'demo&debug&layout=cozy&lang=en') {
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen');
    localStorage.setItem('office-quality', 'low');
    localStorage.setItem('office-lite', 'off');
  });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => !!window.__office?.pauseDemo);
  await page.evaluate(() => window.__office.pauseDemo());
}

function makeSyntheticOmpUsage(now = Date.now()) {
  const h = 3_600_000;
  const d = 24 * h;
  return {
    version: 1,
    enabled: true,
    state: 'ready',
    profile: 'default',
    accounts: [
      {
        accountKey: 'omp-acct:codex-ws1',
        providerId: 'openai-codex',
        label: 'developer@example.test · Personal · pro',
        availability: 'ready',
        observedAt: now - 25_000,
        lastSuccessAt: now - 25_000,
        source: 'omp-cli',
        windows: [
          { id: 'openai-codex:primary', label: '5 hours · 5h', kind: '5h', usedPercent: 35, remainingPercent: 65, resetsAt: now + 2 * h, sourceUnit: 'used', status: 'ok' },
          { id: 'openai-codex:secondary', label: '7 days · 7d', kind: 'weekly', usedPercent: 82, remainingPercent: 18, resetsAt: now + 4 * d, sourceUnit: 'used', status: 'warning' },
        ],
      },
      {
        accountKey: 'omp-acct:codex-ws2',
        providerId: 'openai-codex',
        label: 'developer@example.test · Workspace Two · team',
        availability: 'stale',
        observedAt: now - 240_000,
        lastSuccessAt: now - 240_000,
        source: 'omp-cli',
        windows: [
          { id: 'openai-codex:primary', label: '5 hours · 5h', kind: '5h', usedPercent: 12, remainingPercent: 88, resetsAt: now - 60_000, sourceUnit: 'used', status: 'ok' },
        ],
      },
      {
        accountKey: 'omp-acct:agy-ready',
        providerId: 'google-antigravity',
        label: 'gemini.one@example.test',
        availability: 'ready',
        observedAt: now - 15_000,
        lastSuccessAt: now - 15_000,
        source: 'omp-cli',
        windows: [
          { id: 'google-antigravity:google:default:gemini-5h', label: 'Gemini · 5 Hour', kind: '5h', usedPercent: 60, remainingPercent: 40, resetsAt: now + h, sourceUnit: 'remaining', status: 'ok' },
          { id: 'google-antigravity:google:default:credits', label: 'Quota Bucket · Weekly', kind: 'weekly', usedPercent: null, remainingPercent: null, resetsAt: now + 2 * d, sourceUnit: 'unknown', status: 'unknown' },
        ],
      },
      {
        accountKey: 'omp-acct:agy-unsupported',
        providerId: 'google-antigravity',
        label: 'gemini.two@example.test',
        availability: 'unsupported',
        observedAt: now - 15_000,
        lastSuccessAt: now - 15_000,
        source: 'omp-cli',
        windows: [],
        noteCode: 'no-limits-reported',
      },
      {
        accountKey: 'omp-acct:agy-auth-err',
        providerId: 'google-antigravity',
        label: 'gemini.revoked@example.test',
        availability: 'auth-error',
        observedAt: now - 60_000,
        lastSuccessAt: null,
        source: 'omp-cli',
        windows: [],
        noteCode: 'oauth-disabled',
      },
    ],
    collector: { observedAt: now - 15_000, lastSuccessAt: now - 15_000, noteCode: null, inFlight: false },
    issues: [],
  };
}

test('OMP quota is visible by default and remembers collapse independently of Claude controls', async ({ page }) => {
  await openDemo(page);
  const dashboard = page.locator('#omp-usage-dashboard');
  await expect(dashboard).toBeVisible();
  await expect(page.locator('#pop-plan')).toBeHidden();
  await page.locator('#omp-usage-collapse').click();
  await expect(dashboard).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => !!window.__office?.pauseDemo);
  await page.evaluate(() => window.__office.pauseDemo());
  await expect(dashboard).toBeHidden();
  await expect(page.locator('#btn-omp-usage')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#btn-omp-usage').click();
  await expect(dashboard).toBeVisible();
});

test('U1 & U2: multi-account Codex and Antigravity quota, unknown/expired windows, and unattributed session tokens coexist with Claude limits', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);

  const now = Date.now();
  const ompUsage = makeSyntheticOmpUsage(now);
  const ompSession = projectOmpSession({
    sourceNamespace: 'e2e-usage',
    sourceSessionId: 'sess-1',
    persistedOnly: true,
    readerState: 'ready',
    project: 'my-office',
    provider: 'openai-codex',
    model: 'openai-codex/gpt-5.2',
    metrics: {
      cost: { value: 1.25, currency: 'USD', scope: 'self', provenance: 'recorded' },
      tokens: { input: 15_000, output: 3_000, cacheRead: 2_000, cacheWrite: 0, provenance: 'recorded' },
      context: null,
      byProvider: [
        {
          providerId: 'openai-codex',
          accountKey: null,
          attribution: 'unattributed',
          entries: 2,
          incomplete: false,
          cost: { value: 0.75, currency: 'USD', scope: 'self', provenance: 'recorded' },
          tokens: { input: 10_000, output: 2_000, cacheRead: 2_000, cacheWrite: 0, provenance: 'recorded' },
          models: [
            {
              model: 'gpt-5.2',
              entries: 2,
              cost: { value: 0.75, currency: 'USD', scope: 'self', provenance: 'recorded' },
              tokens: { input: 10_000, output: 2_000, cacheRead: 2_000, cacheWrite: 0, provenance: 'recorded' },
            },
          ],
        },
        {
          providerId: 'google-antigravity',
          accountKey: null,
          attribution: 'unattributed',
          entries: 1,
          incomplete: false,
          cost: { value: 0.5, currency: 'USD', scope: 'self', provenance: 'recorded' },
          tokens: { input: 5_000, output: 1_000, cacheRead: 0, cacheWrite: 0, provenance: 'recorded' },
          models: [
            {
              model: 'gemini-4-argon',
              entries: 1,
              cost: { value: 0.5, currency: 'USD', scope: 'self', provenance: 'recorded' },
              tokens: { input: 5_000, output: 1_000, cacheRead: 0, cacheWrite: 0, provenance: 'recorded' },
            },
          ],
        },
      ],
    },
  })!;

  await page.evaluate(
    ({ ompUsage, ompSession, now }) => {
      const o = window.__office;
      o.upsert(ompSession);
      o.emit({
        k: 'limits',
        limits: {
          at: now,
          label: 'Claude Main',
          account: { plan: 'Max', org: 'Personal' },
          windows: [{ key: 'session', label: '5 h', pct: 42, resetsAt: now + 3_600_000 }],
          others: [],
        },
        note: '',
      });
      o.emit({ k: 'ompUsage', ompUsage });
    },
    { ompUsage, ompSession, now }
  );

  // Claude controls remain in their own popover; opening it does not hide the OMP dashboard.
  await page.locator('#btn-plan').click();
  await expect(page.locator('#pop-plan')).toBeVisible();
  await expect(page.locator('#plan-rows')).toContainText('Claude Main');
  await expect(page.locator('#plan-rows')).toContainText('42%');

  const ompSec = page.locator('#omp-usage-sec');
  await expect(ompSec).toBeVisible();

  // Two same-email Codex accounts remain distinct with their respective availability badges
  const codexWs1 = ompSec.locator('.omp-acct[data-account-key="omp-acct:codex-ws1"]');
  const codexWs2 = ompSec.locator('.omp-acct[data-account-key="omp-acct:codex-ws2"]');
  await expect(codexWs1).toContainText('developer@example.test · Personal · pro');
  await expect(codexWs1).toHaveAttribute('data-availability', 'ready');
  await expect(codexWs1.locator('.omp-win-row[data-window-id="openai-codex:primary"] [role="progressbar"]')).toHaveAttribute('aria-valuenow', '35');
  await expect(codexWs1.locator('.omp-win-row[data-window-id="openai-codex:secondary"] [role="progressbar"]')).toHaveAttribute('aria-valuenow', '82');

  await expect(codexWs2).toContainText('developer@example.test · Workspace Two · team');
  await expect(codexWs2).toHaveAttribute('data-availability', 'stale');

  // Both providers use the same primary "used" percentage, even when the source reports "remaining".
  const agyReady = ompSec.locator('.omp-acct[data-account-key="omp-acct:agy-ready"]');
  await expect(agyReady.locator('.omp-win-row[data-window-id="google-antigravity:google:default:gemini-5h"] .omp-win-val')).toContainText('60%');
  await expect(agyReady.locator('.omp-win-row[data-window-id="google-antigravity:google:default:credits"] .omp-win-val')).toContainText('–');

  // Unsupported and auth-error accounts show explicit messages, no 0% or NaN
  const agyUnsupported = ompSec.locator('.omp-acct[data-account-key="omp-acct:agy-unsupported"]');
  await expect(agyUnsupported.locator('[role="progressbar"]')).toHaveCount(0);
  const agyAuthErr = ompSec.locator('.omp-acct[data-account-key="omp-acct:agy-auth-err"]');
  await expect(agyAuthErr).toHaveAttribute('data-availability', 'auth-error');
  await expect(agyAuthErr.locator('.omp-acct-note')).toBeVisible();

  // Session tokens & cost rollup is separate from account quota and explicitly marked Account unattributed
  const codexTokens = ompSec.locator('.omp-tokens[data-provider="openai-codex"]');
  await expect(codexTokens).toContainText('Account unattributed');
  await expect(codexTokens).toContainText('gpt-5.2');
  await expect(codexTokens).toContainText('$0.75');

  const agyTokens = ompSec.locator('.omp-tokens[data-provider="google-antigravity"]');
  await expect(agyTokens).toContainText('gemini-4-argon');
  await expect(agyTokens).toContainText('$0.50');

  // No account switching, login, logout, drag grip, or reset buttons inside OMP usage section
  await expect(ompSec.locator('.acct-use, .acct-grip, .acct-switch, .plan-add-btn')).toHaveCount(0);
  await expect(ompSec).not.toContainText('NaN');

  // Select the OMP session and verify session drawer provider badge and breakdown
  await page.evaluate((id) => window.__office.select(id), ompSession.id);
  await expect(page.locator('#dr-session')).toBeVisible();
  await expect(page.locator('#ds-dir .session-provider')).toHaveText('openai-codex');
  await expect(page.locator('#ds-actions .ds-omp-metrics')).toContainText('Account unattributed');
  await expect(page.locator('#ds-actions .ds-omp-metrics')).toContainText('openai-codex / gpt-5.2');
  await expect(page.locator('#ds-actions .ds-omp-metrics')).toContainText('google-antigravity / gemini-4-argon');
  expect(errors).toEqual([]);
});

test.describe('U3: mobile & remote viewer privacy and Vietnamese i18n', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('remote snapshot masks account labels to generic aliases and Vietnamese UI renders without horizontal overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openDemo(page, 'demo&debug&layout=cozy&lang=vi');

    const remoteUsage = projectOmpUsageSnapshot(makeSyntheticOmpUsage(), { local: false });
    await page.evaluate((ompUsage) => {
      window.__office.emit({ k: 'ompUsage', ompUsage });
    }, remoteUsage);

    const ompSec = page.locator('#omp-usage-sec');
    await expect(ompSec).toBeVisible();
    await expect(ompSec).toContainText('Codex #1');
    await expect(ompSec).toContainText('Codex #2');
    await expect(ompSec).toContainText('Antigravity #1');
    // Remote projection never exposes the full local email or organization, nor account controls.
    await expect(ompSec).not.toContainText('@example.test');
    await expect(ompSec).not.toContainText('Workspace Two');
    await expect(ompSec.locator('.omp-refresh-btn')).toHaveCount(0);
    await expect(ompSec.locator('.omp-acct[data-availability="unsupported"] [role="progressbar"]')).toHaveCount(0);

    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.document).toBeLessThanOrEqual(width.viewport);
    expect(errors).toEqual([]);
  });
});

test('R1 & R3: server keeps OMP usage disabled by default on /api/doctor and /api/omp/usage', async ({ request }) => {
  const doctor = await request.get('/api/doctor');
  expect(doctor.status()).toBe(200);
  const docJson = await doctor.json();
  expect(docJson.agents.ompUsage).toEqual({ enabled: false, state: 'disabled' });

  const usageRes = await request.get('/api/omp/usage');
  expect(usageRes.status()).toBe(200);
  const usageJson = await usageRes.json();
  expect(usageJson).toMatchObject({
    version: 1,
    enabled: false,
    state: 'disabled',
    accounts: [],
  });
});
