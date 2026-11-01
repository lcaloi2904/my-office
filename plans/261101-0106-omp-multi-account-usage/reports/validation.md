# Validation Report — OMP Multi-Account Usage (`my-office`)

Date: 2026-11-01
Host: Windows 11 Native (`win32 10.0.26200`, `x64`, Node `v24.22.1`)
OMP Binary: `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe` (`omp/18.14.2`, commit `7efd77219374ca4e8767979809835e4aa90666ba`)

---

## 1. Gate Summary (G1–G5)

| Gate | Status | Evidence |
|---|---|---|
| **G1: Compatibility & Side-Effect Safety** | **PASS SAFE** | Verified `omp v18.14.2` native Windows binary and upstream tag `v18.14.2` (`packages/coding-agent/src/cli/usage-cli.ts`, `packages/ai/src/auth/usage.ts`, `packages/coding-agent/src/session/reset-expiry.ts`). `omp [--profile <p>] usage --json --no-extensions` loads read-only settings and never creates `AgentSession`, never triggers salvage sweeps, and never calls `authStorage.resets.redeem()`. |
| **G2: Isolated Account Quota Collector** | **PASS** | `server/agents/omp/usage-accounts.mjs` and `server/agents/omp/usage-collector.mjs` implemented and verified by `tests/unit/omp-usage-accounts.test.mjs` and `tests/unit/omp-usage-collector.test.mjs` (`S1`–`S8`, 8/8 passing). |
| **G3: Session Provider/Model Attribution** | **PASS** | `server/agents/omp/normalize.mjs`, `server/agents/omp/usage.mjs`, `server/agents/omp/lifecycle.mjs`, `server/agents/projection.mjs`, and `integrations/omp/office-observer.js` implemented and verified by `tests/unit/omp-usage-attribution.test.mjs` (`T1`–`T4`, 74/74 OMP unit tests passing). |
| **G4: Multi-Account Usage UI** | **PASS** | `src/office/ui/omp-usage-panel.js`, `mac-drawer.js`, `session-info.js`, `session-drawer.js`, `demo.js`, `topbar-plan.css`, and EN/VI locales verified by `tests/e2e/omp-usage.spec.ts` (`U1`–`U3`, 3/3 E2E specs passing on Chromium desktop + mobile 390x844). |
| **G5: Hardening, Regression, Perf & Docs** | **PASS** | 218/218 unit tests pass (`agent-*.test.mjs`, `omp-*.test.mjs`, `timeline.test.mjs`, `i18n.test.mjs`), `eslint .` 0 errors/0 warnings, `tsc --noEmit` 0 errors, Next.js production build passes, E2E specs pass, R2 benchmark recorded, and docs/rollback updated. |

---

## 2. Executed Verification Commands & Results

1. **Lint & Typecheck**:
   - `node node_modules/eslint/bin/eslint.js .` -> **PASS** (0 errors, 0 warnings)
   - `node node_modules/typescript/bin/tsc --noEmit` -> **PASS** (0 errors)
2. **Unit & Integration Test Suite**:
   - `node --test tests/unit/agent-*.test.mjs tests/unit/omp-*.test.mjs tests/unit/timeline.test.mjs tests/unit/i18n.test.mjs` -> **PASS** (218/218 tests passing, 0 failures)
3. **Production Build & Browser E2E Suite**:
   - `node node_modules/next/dist/bin/next build` -> **PASS**
   - `node node_modules/@playwright/test/cli.js test tests/e2e/omp-usage.spec.ts` -> **PASS** (3/3 tests passing: desktop mixed Claude+Codex+Antigravity, mobile 390x844 remote privacy & Vietnamese i18n, `/api/doctor` & `/api/omp/usage` default-OFF verification)

---

## 3. R2 Controlled Performance Benchmark (Windows Native)

Workload: 50 consecutive `refresh()` calls on `createOmpUsageCollector` + normalizing a 100-entry mixed `openai-codex` / `google-antigravity` OMP session transcript on the same Node `v24.22.1` Windows x64 process:

| Case | Enabled | Viewers | Accounts | Child Spawns | Provider Buckets | Wall Time (ms) | CPU Time (ms) | RSS (MiB) | Heap Delta (KiB) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `OFF_idle` | `false` | `false` | 0 | **0** | 2 | 16.61 | 15.00 | 59.87 | +591.9 |
| `ON_1_acct` | `true` | `true` | 1 | **1** (cached 49x) | 2 | 5.19 | 0.00 | 60.77 | +712.4 |
| `ON_5_accts` | `true` | `true` | 5 | **1** (cached 49x) | 2 | 4.02 | 0.00 | 61.01 | +490.5 |
| `ON_20_accts` | `true` | `true` | 20 | **1** (cached 49x) | 2 | 4.67 | 0.00 | 62.01 | +1016.8 |

Key observations:
- When `OFFICE_OMP_USAGE` is `off` (default) or no local viewer is connected, **0 child processes** and **0 timers** are created.
- When enabled with 1, 5, or 20 accounts, single-flight coalescing and the 60s cache TTL ensure 50 rapid refresh requests spawn only **1** child process, keeping RSS delta under ~2.2 MiB even at 20 accounts.

---

## 4. Known Limitations & Rollback

- **Session-to-account attribution**: OMP v18.14.2 records `provider` and `model` per JSONL entry (`message.provider`, `model_usage.provider`), not a public OAuth `identityKey` matching `omp usage --json`. Session token/cost rollups are therefore grouped accurately by `(providerId, model)` and explicitly labeled `Account unattributed` (`accountKey: null`).
- **Default state & Rollback**: Per user direction after G1–G5 verification, `OFFICE_OMP_USAGE` is **enabled by default** (`1`) in `server/index.mjs` and `start-office.cmd` (while remaining `0` in isolated Playwright E2E configs so automated tests never touch real `~/.omp` credentials). Set `OFFICE_OMP_USAGE=0` and restart My Office to disable at any time.
