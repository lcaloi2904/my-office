# Phase 06 — Rollout & Rollback Checklist (01/11/2026)

## 1. Gate Summary (G1–G6)

| Gate | Status | Evidence & Remaining Exceptions |
| --- | --- | --- |
| **G1** Contracts, roots, privacy | **CLOSED (LOCAL SCOPE)** | Schema v3 pin (`6a86df8539fccf3ad7818081266e554022fc21bc`), installed OMP `18.14.1`/`18.14.2` on Windows 11, private storage `~/.omp/office-private/`, and metadata-first privacy (`conversation: false` default) verified. Cross-host topology (`D10`) remains unapproved/blocked. |
| **G2** Claude compatibility seam | **CLOSED WITH ACCEPTED EXCEPTIONS** | [G2 acceptance](./phase-02-g2-acceptance.md); `agent-compat.test.mjs`, `agents.spec.ts` (13/13), `chat-preview.spec.ts` (2/2), and `@smoke` (5/5) PASS on Windows Chromium D3D11. Four existing `office.spec.ts` tests using POSIX `#!/bin/sh` fakes (`fake-claude.sh`, `fake-cloudflared.sh`) are known Windows-native harness limitations. |
| **G3** File-only OMP observer | **CLOSED WITH ACCEPTED EXCEPTIONS** | [G3 acceptance](./phase-03-g3-acceptance.md); `omp-paths`, `omp-reader`, `omp-normalize`, `omp-usage`, `omp-adapter` unit tests and `omp-files.spec.ts` (3/3) PASS. |
| **G4** Hybrid realtime observer | **OPEN (PARTIAL VERIFIED)** | [Local validation](./phase-04-local-validation.md) & [token remediation](./phase-04-token-remediation.md): Windows private DACL remediation + token rotation verified (`omp-private-storage.test.mjs` 22/22, `omp-hybrid.spec.ts` 1/1); 18.14.1 print/RPC and 18.14.2 TUI callbacks verified. **Still open**: plan review Escape cancellation & automatic continuation, RPC idle-exit after shutdown without stdin EOF, and cross-host transport. Built-in `ask` waiting and live subagents are documented as unsupported. |
| **G5** Mixed-agent UI & replay | **VERIFIED (LOCAL WINDOWS CHROMIUM)** | [Phase 05 report](./phase-05-implementation.md): V1–V8 verified; 64-actor / 32-child scene bounds, true drawer tree, backwards conversation pagination, timeline parallel tools, side-effect-free replay. |
| **G6** Hardening, performance, docs, rollback | **VERIFIED WITH SOAK/CROSS-OS LIMITS** | [Security review](./security-review.md) (S1–S9 PASS locally), [performance results](./performance-results.md) (P0–P4, P6–P8 PASS; P5 cleanup/500-churn PASS, 2–8h soak marked `PARTIAL_INCOMPLETE_SOAK_WINDOW`), [OMP-INTEGRATION.md](../../../docs/OMP-INTEGRATION.md) synced. |

---

## 2. Final Verification Gate Executed in Phase 06

| Check | Command | Result |
| --- | --- | --- |
| ESLint | `node node_modules/eslint/bin/eslint.js .` | **PASS** (0 errors, 0 warnings) |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | **PASS** (0 errors) |
| Unit tests (fast suite, 22 files) | `node --test tests/unit/agent-*.test.mjs ...` | **205/205 PASS** |
| Unit tests (Windows private DACL storage) | `node --test tests/unit/omp-private-storage.test.mjs` | **22/22 PASS** |
| Synthetic benchmark & resource gates | `node --expose-gc scripts/benchmark-omp.mjs --run` | **PASS** (`P0`–`P4`, `P7`, `P8` PASS; `P5` cleanup PASS / soak window bounded) |
| Mixed-agent & security E2E + chat preview | `playwright test -c test-results-p3-gpu/playwright.gpu.config.ts tests/e2e/agents.spec.ts tests/e2e/chat-preview.spec.ts` | **15/15 PASS** |
| OMP `files` mode E2E | `playwright test -c playwright.omp.config.ts` | **3/3 PASS** |
| OMP `hybrid` mode E2E | `playwright test -c playwright.hybrid.config.ts` | **1/1 PASS** |
| Claude `@smoke` E2E | `playwright test -c test-results-p3-gpu/playwright.gpu.config.ts tests/e2e/office.spec.ts --grep @smoke` | **5/5 PASS** |
| `.gitattributes` integrity | `sha256sum .gitattributes` | `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7` (unchanged) |

---

## 3. Staged Opt-In Rollout Procedure

1. **Default Off (`OFFICE_OMP=off`)**:
   - Production default in `server/index.mjs` remains `off`. No OMP files or credentials are touched unless explicitly enabled.
2. **Stage 1 — File-Only Mode (`OFFICE_OMP=files`)**:
   - Prepare `data/omp-config.json` with one approved local source (`conversation: false`).
   - Start My Office with `OFFICE_OMP=files` and `OFFICE_OMP_CONFIG=<absolute path>`.
   - Verify `http://127.0.0.1:4310/api/doctor` shows `effectiveMode: "files"` and `sources[0].state: "ok"`.
   - Open the History picker in the local browser, pin up to 8 sessions, and verify `History · not live` actors appear without affecting Claude Code.
3. **Stage 2 — Hybrid Mode (`OFFICE_OMP=hybrid`, Single Profile First)**:
   - Confirm `~/.omp/office-private/ingest.json` and `~/.omp/office-private/observer.json` have protected private DACLs (`preparePrivateFile` / `writePrivateJson`).
   - Start My Office with `OFFICE_OMP=hybrid` and `OFFICE_OMP_CONFIG=<absolute path>` (or via `start-office.cmd` on this Windows host).
   - Verify `http://127.0.0.1:4310/api/doctor` shows `effectiveMode: "hybrid"` and `ingress.sources: 1`.
   - Enable the companion extension in one OMP profile (`~/.omp/agent/extensions/office-observer/{index.js,private-storage.js}`) and observe live session/tool/waiting updates. Do not enable across multiple profiles or cross-host setups simultaneously.

---

## 4. Rollback & Recovery Verification

| Scenario | Verified Behavior |
| --- | --- |
| **`OFFICE_OMP=off`** | Zero OMP timers, readers, or lifecycle instances; `/api/omp/catalog`, `/api/omp/pin`, and `/ingest/omp/v1` return `404`; Claude Code hooks, drawers, and controls operate normally. |
| **Fallback `hybrid` → `files`** | If `OFFICE_OMP_INGEST_FILE` / `~/.omp/office-private/ingest.json` is missing parent `.omp`, has unsafe ACLs, or contains malformed JSON, `startOmpIngress()` fails closed (`ompBridge = null`, `reason: "ingress-failed"`), `effectiveMode` falls back to `"files"`, pinned sessions remain `persistedOnly: true` / `liveness: unknown`, and Claude is unaffected. |
| **Token rotation / revocation** | Rotating the token in `~/.omp/office-private/ingest.json` immediately causes old observer bindings to receive `401` and stop sending permanently (`factory.dispose()`), while new OMP processes with the updated `observer.json` receive `200` and other configured sources / Claude sessions continue uninterrupted. |
| **Data preservation** | Disabling OMP, unpinning sessions, or uninstalling the observer never deletes or modifies `~/.omp/agent/sessions`, `~/.omp/agent/config.yml`, or any OMP profile data. |
