# Phase 03 implementation — partial foundation (lịch sử; G3 sau đó đã đóng kèm ngoại lệ, xem [G3 acceptance](./phase-03-g3-acceptance.md))

> Cập nhật sau: adapter, server và UI đã được thêm, build và file-only E2E 3/3 đã chạy, xem [phase-03-adapter-ui-integration.md](./phase-03-adapter-ui-integration.md). Blocker ghi `index.mjs` và các dòng "NOT RUN" bên dưới là lịch sử, không còn đúng.

Date: 2026-10-31 (Asia/Ho_Chi_Minh).

## Outcome

**PARTIAL IMPLEMENTATION. G3 is NOT COMPLETE.** Four standalone OMP core modules, synthetic fixtures and 37 focused tests were implemented. Final lint/typecheck and full unit suite pass. The adapter lifecycle/discovery module, server/API wiring and UI PoC are not implemented, so this change does not yet make OMP sessions visible in the application.

G2 remains CLOSED WITH ACCEPTED EXCEPTIONS as recorded in `phase-02-g2-acceptance.md`; this report does not reopen G2 or reinterpret the earlier browser failures as passing. The user approved Phase 03 synthetic-first implementation. Real OMP roots, transcript privacy, installed-build verification and Phase 04 remain separately gated.

## Evidenced blocker

The `files_write` call attempting to create `server/agents/omp/index.mjs` was rejected by the tool's safety check. No successful write was returned, and a subsequent directory listing confirmed only `paths.mjs`, `reader.mjs`, `normalize.mjs`, and `usage.mjs` exist. The tool did not provide a specific root-cause diagnosis. The rejected operation was not retried through another execution path.

Work continued only on the independently allowed foundation modules, synthetic tests and documentation. No broken import or incomplete adapter registration was added. This is a tool-write blocker, not a request for renewed product-scope approval and not evidence that the implementation is complete.

## Repository and execution context

- Confirmed workspace: `my-office`, `/mnt/e/vide-code/my-office`.
- Branch: `phase-02-omp-seam`; HEAD: `4f5858a2c8d59e2efc8597673ceba4828f5aac68`.
- Runner: CloudHarness Local in WSL/Linux; Node `v24.22.1`, npm `11.19.1`.
- Followed exported portable `ak-cook` 2.5.1 and its implementation/review/files-first references. No native hooks or delegated subagents were executed; review was sequential/manual.
- `.gitattributes` and the existing plan/report files were already untracked. They are not newly created implementation files. Git branch/HEAD, index and remotes were not changed by the implementation workflow.

## Implemented files

| File | Responsibility and verified boundary |
|---|---|
| `server/agents/omp/paths.mjs` | Explicit source config validation; conversation defaults false; bounded limits; native absolute roots; no UNC/ADS/traversal; symlink/hardlink and identity checks; longest-prefix project/worktree mapping with hashed namespace keys |
| `server/agents/omp/reader.mjs` | Read-only, single-flight byte reader; newline cursor, UTF-8 and CRLF; bounded partial/oversized lines; fingerprint validation, rewrite epochs, stable snapshot publication, cancellation/disposal |
| `server/agents/omp/normalize.mjs` | Inert v3 decoding, optional title slot, branch/leaf/reset/compaction handling, bounded index, neutral unknown tools, requested vs completed/error distinction, metadata minimization and explicit text-only content option |
| `server/agents/omp/usage.mjs` | Validated nullable per-entry usage; no pricing defaults; idempotent recomputation; inherited scope; no invented context window |
| `tests/fixtures/omp/synthetic.mjs` | Generated synthetic records, byte-exact title slot, isolated fixture directories and read-only IO spy |
| `tests/fixtures/omp/README.md` | Schema reference pin, expected outputs, actual coverage and missing matrix items |
| `tests/unit/omp-{paths,reader,normalize,usage}.test.mjs` | 37 scoped tests; no real OMP source or application startup |

No existing production source, existing test assertions, dependency manifests, lockfiles, browser configuration or security settings were modified. In particular, `server/index.mjs`, registry/projection/schema and UI remain at the existing Phase 02 behavior. Requesting OMP files/hybrid still resolves to effective off with `adapter-not-implemented`; the new modules are not imported by production.

## Bugs identified and repaired during validation

The initial focused run failed 10/36 cases. Reproduced issues included duplicate entries moving the active leaf, model selection following an off-branch physical record, duplicate title slots, prototype tool names escaping the neutral fallback, silent per-message tool truncation, broad mapping winning over a more specific mapping, drive/ADS paths reaching filesystem lookup, malformed lines retaining exact-looking usage totals, and one fingerprint per tiny append.

Fixes preserve duplicate-entry idempotence before state mutation, derive the model from the selected branch, reject duplicate title slots, use a Map for exact tool names, surface truncation, use longest-prefix mappings, reject invalid paths before open, propagate framing incompleteness into metrics, and store canonical fixed-block fingerprints. The fingerprint ledger additionally has a hard 4096-block ceiling.

The second run passed 35/36. Its remaining test used a 6000-character opaque string to test the 4000-character text cap; the existing redactor correctly replaced that input with three mask characters. The fixture was changed to ordinary synthetic prose while retaining the exact length assertion, and a separate test now asserts the opaque-string redaction. No application redaction rule or existing assertion was weakened.

## Actual verification

| Check | Result | Evidence |
|---|---|---|
| Baseline `npm test`, before new modules | PASS 95/95 | Captured command output earlier in this cook session |
| Initial focused core run | FAIL: 26 pass / 10 fail | `test-results-omp-unit/core-red.log` |
| Intermediate focused core run | FAIL: 35 pass / 1 fail | `test-results-omp-unit/core-green.log` (historical filename; not a passing result) |
| Final focused command from Phase 03 | PASS 37/37; 0 skipped/todo; exit 0 | `test-results-omp-unit/core-final.log` |
| `npm run lint` | PASS, exit 0 | `test-results-omp-unit/lint.log` |
| `npm run typecheck` | PASS, exit 0 | `test-results-omp-unit/typecheck.log` |
| Final `npm test` | PASS 132/132; 0 skipped/todo; exit 0 | `test-results-omp-unit/full.log` |
| Production build / HTTP / browser E2E / file-only demo | NOT RUN | No complete runtime/UI integration exists |
| Windows-native filesystem or browser validation | NOT RUN | `path.win32` unit checks are not native junction/Windows runtime evidence |
| Live OMP / installed build / real transcripts | NOT RUN | No approved roots accessed and no OMP/provider process started |
| CPU/RAM/GPU benchmarks or soak | NOT RUN | No performance-improvement or long-run leak claim |

Final focused command:

```sh
node --test tests/unit/omp-paths.test.mjs tests/unit/omp-reader.test.mjs tests/unit/omp-normalize.test.mjs tests/unit/omp-usage.test.mjs
```

Test logs are ignored local artifacts under `test-results-omp-unit/`, not committed evidence files. Typecheck does not substitute for the JS/MJS runtime contracts because the project uses `checkJs: false`. Passing existing unit tests is not a fresh Claude browser-regression certification.

## Review, safety and remaining risks

All parser inputs used in executed tests were generated fixtures. The observer-facing IO wrapper exposes read-side methods only; tests check open flags, balanced handles and source hashes. Tests mutate or remove only their own synthetic data to simulate producer activity. No package/browser installation, app/listener startup, OMP process, credential/config discovery, source migration, source-root write, commit or push occurred.

The reader verifies previously consumed blocks when the file changes and periodically during reconciliation. Parsing is incremental, but verification IO is not strictly proportional to appended bytes. Large continuously changing files can remain refreshing until a stable pass; this is an explicit correctness/performance tradeoff, not a measured latency guarantee. Each file is capped at 8 MiB and each line at 64 KiB by default; oversized input is unsupported/incomplete rather than silently accepted. Transient read-fault diagnostics remain conservative until rebuild; scheduler-level retry/backoff is still absent.

Portable path checks reduce traversal and replacement risk, but the tests do not prove every native Windows reparse race or adversarial concurrent directory-swap scenario. Real-source enablement requires the remaining platform/security validation. Redaction is best effort, not a guarantee that all possible secrets are recognized; the primary control is least-data projection and a separate content opt-in.

The normalizer exposes historical evidence only. It does not establish current liveness, live child ownership, runtime generation, current context size or global spend. Full F1–F12/U1–U4 and the extended matrix are not certified merely because individual core tests carry those IDs.

## Remaining work before G3

1. Complete and review the blocked adapter lifecycle/discovery module through an authorized working tool path: bounded directory scan, source availability/backoff, recent/history catalogue, pagination, pins, aggregate budgets, TTL/eviction and cleanup.
2. Implement artifact child/advisor/tombstone ownership (F9), move/rename reconciliation, multi-file tests, unsupported-source isolation and runtime-off resource assertions.
3. Wire registry/projection/server read-only APIs with server-owned privacy/identity validation. Add conversation pagination/cancellation and prevent content from entering metadata/SSE/replay by default.
4. Implement persisted/history UI labels, explicit selection/pinning, on-demand conversation, i18n and List Mode behavior without making historical children live actors.
5. Update E2E isolation, build and execute the synthetic file-only PoC, feature-off/on cases and the applicable Claude regression checks. Finish G3 review with actual evidence; do not advance to Phase 04 automatically.

## Plan synchronization

The local plan `my-office/261030-1754` was resolved from the confirmed worktree. `ak plan update --current-phase 3` and phase bookkeeping notes/evidence record partial progress. No whole-phase checkbox completion or close command was used. This report and the phase progress note are the current implementation evidence; earlier preflight documents retain their historical meaning.

Final `ak plan validate` returned `valid: true`. Tracked/cached `git diff --check` was clean; those commands do not check untracked files. The runtime/server/UI/dependency paths had no tracked diff, HEAD/branch stayed unchanged, and the adapter index was confirmed absent. The automatic journal command was attempted but returned no creation receipt; `plans/journals` was not present afterward, so journal creation is NOT VERIFIED. No alternate storage path was probed and no successful journal artifact is claimed.
