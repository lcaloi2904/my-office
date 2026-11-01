import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Deliberately independent from the OFF/file-only configs: no global launch flag or real HOME.
// Build first, then: node node_modules/@playwright/test/cli.js test --config=playwright.launch.config.ts
// OFFICE_OMP_TEST_BIN and OFFICE_OMP_TEST_VERSION explicitly pin the native binary under verification.
// G3 stays OPEN: this suite proves fail-closed Resume, not exclusive writer ownership.
const out = path.resolve(process.env.E2E_OUT || 'test-results-omp-launch');
const root = path.join(out, 'omp-native-fixture');
const port = Number(process.env.E2E_PORT || 4518);
const dist = path.resolve(process.env.OFFICE_DIST_DIR || '.next-e2e');
const binary = process.env.OFFICE_OMP_TEST_BIN || '';
const expectedVersion = process.env.OFFICE_OMP_TEST_VERSION || '';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: '**/omp-launch-resume.spec.ts',
  grep: /native launcher ON/,
  outputDir: path.join(out, 'browser'), workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 30_000 },
  globalSetup: './tests/e2e/omp-launch-fixture.mjs',
  metadata: { nativeLaunch: { root, port, dist, binary, expectedVersion } },
  use: {
    baseURL: `http://127.0.0.1:${port}`, viewport: { width: 390, height: 844 },
    ...(process.platform === 'win32' && { launchOptions: { args: ['--use-angle=d3d11'] } }),
  },
});
