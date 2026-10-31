import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// File-only OMP smoke: the same server as the default config, plus synthetic source folders generated just before it
// starts. The default config ignores this spec, so the Claude suite keeps running with OMP off.
const OUT = process.env.E2E_OUT || 'test-results', FIXTURE_DIR = path.resolve(OUT, 'omp-fixture');
const server = base.webServer as { env: Record<string, string> };
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: '**/omp-files.spec.ts',
  webServer: {
    ...base.webServer as object,
    command: `node tests/e2e/omp-fixture.mjs "${FIXTURE_DIR}" && node server/index.mjs`,
    env: { ...server.env, OFFICE_OMP: 'files', OFFICE_OMP_CONFIG: path.join(FIXTURE_DIR, 'omp-config.json') },
  },
});
