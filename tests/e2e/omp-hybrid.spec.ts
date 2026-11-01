import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { projectOmpSession } from '../../server/agents/projection.mjs';
import { DATA_DIR, HOME_DIR } from '../../playwright.config';
import { preparePrivateFile } from '../../integrations/omp/private-storage.js';

test.afterAll(() => {
  const out = path.resolve(process.env.E2E_OUT || 'test-results');
  const metadata = path.join(out, 'omp-fixture/private-store.json');
  if (!fs.existsSync(metadata)) return;
  const { tokenFile } = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const prefix = 'my-office-e2e-' + createHash('sha256').update(out).digest('hex').slice(0, 16) + '-';
  if (typeof tokenFile !== 'string' || !path.isAbsolute(tokenFile) || path.basename(tokenFile) !== 'ingest.json' ||
      !new RegExp('^' + prefix + '[0-9a-f-]{36}$').test(path.basename(path.dirname(tokenFile)))) {
    throw new Error('Refusing cleanup outside the owned private test store');
  }
  preparePrivateFile(tokenFile);
  fs.unlinkSync(tokenFile);
  fs.rmdirSync(path.dirname(tokenFile));
  fs.unlinkSync(metadata);
});

// Real isolated server + synthetic ingress/files. No OMP executable, model call or private source.
test('hybrid union survives hot reconnect, separates wait/stale/end and never becomes a Claude target or replay', async ({ page, context, request, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = projectOmpSession({ sourceNamespace: 'e2eon', sourceSessionId: 'e2e-conv-on' })!.id;
  let sequence = 0;
  const send = async (type: string, data: Record<string, unknown> = {}) => {
    const r = await request.post('/ingest/omp/v1', { headers: { Authorization: 'Bearer ' + '5'.repeat(64) }, data: {
      version: 1, sourceId: 'e2eon', sessionId: 'e2e-conv-on', runtimeInstanceId: 'e2e-runtime', generation: 1, sequence: ++sequence, type, data,
    } });
    expect(r.status()).toBe(200); expect((await r.json()).ok).toBe(true);
  };
  await request.post('/api/omp/pin', { data: { id, on: true } });
  const sid = 'phase5-claude-union', cwd = path.join(HOME_DIR, 'mixed-repo');
  fs.mkdirSync(cwd, { recursive: true });
  const hook = async (hook_event_name: string) => {
    const r = await request.post('/event', { data: { session_id: sid, cwd, hook_event_name } }); expect(r.status()).toBe(200);
  };
  await hook('SessionStart');
  await send('snapshot', { isIdle: false, pendingMessages: 0, pendingJobs: 0, model: 'anthropic/claude', tools: [{ id: 'read-one', category: 'read' }] });
  await page.addInitScript(() => {
    localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); localStorage.setItem('office-lite', 'on');
  });
  await page.goto('/?debug&layout=cozy&lang=en');
  const card = page.locator('.lite-card[data-sess="' + id + '"]');
  await expect(card).toContainText('Runtime confirmed');
  await card.click();
  await expect(page.locator('#ds-body')).toContainText('E2E synthetic assistant reply');
  await expect(page.locator('#ds-actions')).toContainText('Read-only observation');
  // Hiding a connected runtime preserves its pin and telemetry. Restoring uses its current state.
  const visibility = async (hidden: boolean) => {
    const snapshot = await (await request.get('/api/omp/visibility')).json();
    const response = await request.post('/api/omp/visibility', {
      headers: { Origin: baseURL! }, data: { id, hidden, expectedRevision: snapshot.revision },
    });
    expect(response.status()).toBe(200);
    const catalog = await (await request.get('/api/omp/catalog?limit=10')).json();
    expect(catalog.items.find((item: { id: string }) => item.id === id).pinned).toBe(true);
  };
  await page.locator('#ds-actions').getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(card).toHaveCount(0);
  await send('approval_requested', { requestId: 'approval-one' });
  await page.reload();
  await expect(page.locator('#lite')).toBeVisible();
  await expect(card).toHaveCount(0);
  await visibility(false);
  await expect(card).toContainText('Waiting for approval');
  await card.click();
  await expect(page.locator('#ds-status')).toHaveText('Waiting for approval');
  await send('approval_resolved', { requestId: 'approval-one' });
  await send('input_requested', { requestId: 'input-one' });
  await expect(page.locator('#ds-status')).toHaveText('Waiting for input');
  await send('input_resolved', { requestId: 'input-one' });
  await send('tool_end', { toolCallId: 'read-one', category: 'read', phase: 'completed' });
  await send('turn_end', { outcome: 'success' });
  await expect(page.locator('#ds-status')).toHaveText('Ready for user');
  await context.setOffline(true);
  await send('turn_start');
  await context.setOffline(false);
  await expect(page.locator('#ds-status')).toHaveText('Working · runtime confirmed');
  await expect(page.locator('.lite-card[data-sess="' + id + '"]')).toHaveCount(1);
  const targets = await (await request.get('/api/tasks')).json();
  expect(targets.sessions.some((s: { id: string }) => s.id === id)).toBe(false);
  expect(targets.sessions.some((s: { sid: string }) => s.sid === sid)).toBe(true);
  for (const route of ['/api/tasks', '/api/open', '/api/accounts/move']) {
    const r = await request.post(route, { data: { id, sid: id, text: 'Never run', agentKind: 'omp' } }); expect(r.status()).toBe(403);
  }
  await expect.poll(async () => {
    const r = await request.get('/api/live?since=-1');
    const data = await r.json();
    return data.msgs[0].sessions.find((s: { id: string }) => s.id === id)?.connection;
  }, { timeout: 45_000, intervals: [1000] }).toBe('stale');
  await expect(page.locator('#ds-status')).toHaveText('Stale · activity unknown');
  await expect(card).not.toContainText('Just finished');
  await send('snapshot', { isIdle: true, pendingMessages: 0, pendingJobs: 0, tools: [] });
  await expect(page.locator('#ds-status')).toHaveText('Ready for user');
  await send('session_end');
  await expect(page.locator('#ds-status')).toHaveText('Runtime ended');
  await expect(card).toHaveAttribute('data-lifecycle', 'ended');
  await visibility(true);
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#lite')).toBeVisible();
  await expect(card).toHaveCount(0);
  await visibility(false);
  await expect(card).toContainText('Runtime ended');
  await card.click();
  const replayDir = path.join(DATA_DIR, 'replay');
  const replay = fs.existsSync(replayDir) ? fs.readdirSync(replayDir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(replayDir, f), 'utf8')).join('') : '';
  expect(replay).not.toContain(id);
  expect(replay).not.toContain('NEVER_RENDER');
  await hook('SessionEnd');
  await request.post('/api/omp/pin', { data: { id, on: false } });
  expect(errors).toEqual([]);
});
