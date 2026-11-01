import { expect, type APIRequestContext } from '@playwright/test';

// Both file-only specs share one synthetic server. Reset through its public APIs so a failed UI journey cannot
// leave a pin/hidden preference behind for the next test. Never touches a real agent or its transcript.
export async function resetOmpView(request: APIRequestContext, baseURL: string) {
  const hidden = await request.get('/api/omp/visibility');
  expect(hidden.ok()).toBe(true);
  const snapshot = await hidden.json();
  let revision = snapshot.revision;
  for (const item of snapshot.items) {
    const response = await request.post('/api/omp/visibility', {
      headers: { Origin: baseURL }, data: { id: item.id, hidden: false, expectedRevision: revision },
    });
    expect(response.ok()).toBe(true);
    revision = (await response.json()).revision;
  }
  const catalog = await request.get('/api/omp/catalog?limit=100');
  expect(catalog.ok()).toBe(true);
  for (const item of (await catalog.json()).items) {
    if (!item.pinned) continue;
    const response = await request.post('/api/omp/pin', { data: { id: item.id, on: false } });
    expect(response.ok()).toBe(true);
  }
}
