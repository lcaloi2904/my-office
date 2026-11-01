import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import base, { DATA_DIR } from './playwright.config';

const OUT = process.env.E2E_OUT || 'test-results';
const fixture = path.resolve(OUT, 'omp-fixture');
const tokenFile = path.join(process.platform === 'win32' ? os.homedir() : os.tmpdir(),
  'my-office-e2e-' + createHash('sha256').update(path.resolve(OUT)).digest('hex').slice(0, 16) + '-' + randomUUID(), 'ingest.json');
const server = base.webServer as { env: Record<string, string> };
export default defineConfig({
  ...base,
  workers: 1,
  testIgnore: undefined,
  testMatch: '**/omp-hybrid.spec.ts',
  webServer: {
    ...base.webServer as object,
    command: `node tests/e2e/omp-fixture.mjs "${fixture}" --hybrid "${DATA_DIR}" && node server/index.mjs`,
    env: { ...server.env, OFFICE_OMP: 'hybrid', OFFICE_OMP_CONFIG: path.join(fixture, 'omp-config.json'), OFFICE_OMP_INGEST_FILE: tokenFile },
  },
});
