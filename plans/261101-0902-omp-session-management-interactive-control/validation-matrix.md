# Validation matrix, gates and planned test execution

**PLAN ONLY — all proposed tests NOT RUN.** Record exact real commands/results during cook. Synthetic unit tests are not proof of compatibility with installed Windows OMP.

| Gate | Scenario | Pass condition |
|---|---|---|
| G1 | Version and protocol | Exact installed binary/version/profile proven; RPC and extension support matrix pin; no secret files |
| G1 | Ownership safety | Approved roots, stale != ended, no duplicate writer, fail-closed policy & permissions |
| G2 | Hide vs unpin | Hide running/disconnected/ended/history only removes UI, keeps transcript/telemetry/pin |
| G2 | Persistence & SSE | Hidden stays hidden through refresh/reconnect/restart, recovery and multi-tab revision |
| G2 | HTTP negative | Foreign OMP ID, empty/malicious Origin, LAN, tunnel, forged session rejected |
| G3 | New/resume | Native Windows `spawn` shell=false, exact selected session/resolved source ID, approved project/profile |
| G3 | Faults | Unavailable model/bin, wrong cwd, junction, bad transcript, concurrent TUI, exit/restart/timeout safe |
| G4 | Commands | Idle prompt, busy steer/follow-up, queued/canceled, proper abort; accepted != settled |
| G4 | Idempotence | Duplicate requestId and missed ACK never double-send; old generation cannot act |
| G4 | Data privacy | No prompt in logs/SSE remote/replay; disabled observer-only & remote actions |
| G4 | Live Activity Bubbles | Hai OMP workers độc lập hiển thị category read/edit/test/cmd đúng evidence; tên file/test optional local opt-in, tối đa 80 ký tự, không bịa khi thiếu dữ liệu |
| G4 | Lifecycle/Privacy | tool_end, idle, waiting, stale, disconnected, ended, generation, eventGap, hidden/replay/streamer làm clear/downgrade label cũ |
| G5 | TUI opt-in | Observer-only does NOT receive command; installed controller handshake and scoped command works |
| G5 | TUI failures | Token expired, wrong source/session/generation, two owners, offline, queue bounds, cleanup |
| G5 | External TUI bubbles | Observer-only chỉ category; detailed metadata chỉ qua controller opt-in, no cross-agent or stale leak |
| G6 | Tool approval | Real pending decision id, allow once or deny, expiry, no automatic allow/always |
| G6 | Ask/plan | Input validation, plan revision, skip-to-TUI, unsupported mode disabled |
| G6 | Remote security | Even with Claude `phoneApprove`, OMP approval from LAN/tunnel/browser origin rejected |
| G7 | Regression | Claude hooks/chat/permissions/tasks/account/replay and OMP files/hybrid/usage keep previous behavior |
| G7 | Perf | Measured CPU/RSS/handles, FPS/p95 frame-time, CSS2D DOM/layout churn before-after for 2/8/32/64 actors, event bursts, closed dashboard, Low Quality/List Mode |
| G7 | Rollback | OFF flags restore observer-only; no transcript deletion/auto restart |

## G1 status (2026-11-01, read-only) — xem `reports/g1-compatibility-security.md`
| Check | Kết quả |
|---|---|
| Source map & ranh giới ownership | PASS (VERIFIED bằng đọc source) |
| Guard Origin chặt cho route ghi mới (`sameOriginOf` cho phép Origin vắng) | PASS (phát hiện + yêu cầu ghi nhận) |
| `ak plan validate` | PASS |
| Installed `omp --version` / RPC no-model probe | NOT RUN — cần approval |
| Chính sách `AGENTS.md` ngoại lệ | NOT RUN — cần user duyệt |
| **G1 tổng** | **UNVERIFIED** — Phase 02 có thể đi tiếp; G3–G6 bị chặn |

## G2 status (2026-11-01)
| Check | Kết quả |
|---|---|
| `tests/unit/omp-visibility.test.mjs` (store: idempotent, 409, corrupt fail-closed, giới hạn, sanitize) | PASS 4/4 |
| Toàn bộ `tests/unit/*.test.mjs` | PASS 348/348 |
| HTTP negative qua handler thật (`agent-compat.test.mjs`): remote, thiếu Origin, Origin lạ, ompOff, id lạ/Claude, 409, hide/show + SSE | PASS |
| ESLint (`eslint .`) / `tsc --noEmit` | PASS — người dùng chạy tay qua `node node_modules/...` (không output lỗi) |
| Playwright e2e (`omp-visibility.spec.ts`), HTTP negative thật (LAN/tunnel/thiếu Origin) | NOT RUN |
| Menu ⋯ đầy đủ trong rail; bộ lọc List Mode/3D riêng | Chưa làm: ẩn lọc ở server (snapshot + SSE) nên rail/List/3D cùng ẩn |

## Proposed new tests (create during approved phase)
- `tests/unit/omp-visibility.test.mjs`
- `tests/unit/omp-launch-resolver.test.mjs`
- `tests/unit/omp-rpc-host.test.mjs`
- `tests/unit/omp-command-schema.test.mjs`
- `tests/unit/omp-control-manager.test.mjs`
- `tests/unit/omp-controller.test.mjs`
- `tests/unit/omp-controller-bridge.test.mjs`
- `tests/unit/omp-approvals.test.mjs`
- `tests/e2e/omp-visibility.spec.ts`
- `tests/e2e/omp-launch-resume.spec.ts`
- `tests/e2e/omp-controls.spec.ts`
- `tests/e2e/omp-approval.spec.ts`
- `tests/fixtures/omp/fake-rpc-host.mjs`

## Activity bubble tests to create during approved phase
- `tests/unit/omp-activity-summary.test.mjs`
- `tests/e2e/omp-activity-bubbles.spec.ts`
- Include 2 simultaneous OMP workers, read→edit→test, concurrent same-name sessions, malicious label, stale/gap/end, streamer/remote privacy, collision, 80-character and burst updates.

## Regression targets already present
`tests/unit/agent-compat.test.mjs`, `tests/unit/agent-schema.test.mjs`, `tests/unit/omp-adapter.test.mjs`, `tests/unit/omp-lifecycle.test.mjs`, `tests/unit/omp-bridge.test.mjs`, `tests/unit/omp-observer.test.mjs`, `tests/unit/omp-projection.test.mjs`, `tests/unit/timeline.test.mjs`, `tests/unit/i18n.test.mjs`; `tests/e2e/agents.spec.ts`, `tests/e2e/omp-files.spec.ts`, `tests/e2e/omp-hybrid.spec.ts`, `tests/e2e/chat-preview.spec.ts`.

## Candidate commands — AFTER implementation approval
```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node --test tests/unit/omp-*.test.mjs tests/unit/agent-*.test.mjs tests/unit/i18n.test.mjs tests/unit/timeline.test.mjs
node --test
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts tests/e2e/omp-files.spec.ts tests/e2e/omp-hybrid.spec.ts tests/e2e/omp-visibility.spec.ts tests/e2e/omp-launch-resume.spec.ts tests/e2e/omp-controls.spec.ts tests/e2e/omp-approval.spec.ts tests/e2e/omp-activity-bubbles.spec.ts
```

The command shapes above are **proposed**. Verify `package.json` and platform first; OMP/hybrid browser configs are separate and may require isolated runs. No `npm install`, `start-office.ps1`, `omp` CLI, paid model calls, fixture creation outside repo or system modifications in the current planning turn.

## Performance plan
Benchmark same native Windows machine/build for: feature OFF; read-only observer; 8 idle managed RPC children; synthetic active commands; external extension idle and active; closed dashboard with server running; Low Quality and List Mode. Measure RSS delta per child, event-loop lag, file handles, observer callback p95, CPU, browser FPS. Record warm-up, sample counts, platform and uncertainty. Fail if uncontrolled timer/process growth or material Claude latency regression; don't invent a fixed pass threshold without measured baseline.

## Stop and evidence protocol
Any wrong-session resume, unapproved process launch, prompt duplication, transcript/credential leak, unsafe auto-approval, remote command success or performance regression => halt affected phase and disable feature flag, preserve user source files, record incident and request scoped approval for fix. For each test write exact PASS/FAIL/NOT RUN, not inferred.
