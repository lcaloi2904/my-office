---
phase: 7
title: "Security hardening, regression, performance benchmark, documentation và rollout"
status: pending
priority: P1
effort: "3-5 dev-days"
dependencies: [2, 3, 4, 5, 6]
---

# Phase 07 — Hardening & staged rollout

## Goal
Chốt đầy đủ bằng chứng kiểm thử native Windows/isolated, Claude + OMP regressions, bảo mật, hiệu năng, docs và rollback trước khi mở opt-in production.

## Entry gate
- G2–G6 có kết quả thực tế PASS/FAIL/EXCEPTION, không che khuất unsupported external TUI/approval; mọi ngoại lệ cần user phê duyệt và khoanh vùng bằng flag.
- Separate approval cho native Windows smoke OMP thật, model-backed paid turn, extension install, release config flip và benchmark kéo dài.

## File and document scope
| Action | Repo-relative path | Purpose |
|---|---|---|
| Modify | `docs/OMP-INTEGRATION.md`, `docs/ARCHITECTURE.md` | Operator procedures, state diagram, ownership/security, support matrix |
| Modify | `integrations/omp/README.md` | Observer-only vs controller opt-in, install/disable/rollback |
| Modify | `README.md`, `README.vi.md` | Optional feature intro and flags |
| Modify after explicit policy approval | `AGENTS.md` | Precise opt-in exceptions to previous read-only prohibition; maintain safe default |
| Modify | `tests/unit/omp-*.test.mjs`, `tests/e2e/{agents,omp-files,omp-hybrid,omp-controls,omp-visibility,omp-launch-resume,omp-approval}.spec.ts` | Full regression, unsupported, crafted-ID tests |
| Create | `plans/261101-0902-omp-session-management-interactive-control/reports/g7-security-perf-rollout.md` | Evidence, commands, environment, rollback signoff |

## Tasks
1. Read current git diff before edits; preserve user dirty files, inspect shared files concurrently changed by usage plan and upstream. No auto rebase/reset/commit/push.
2. Execute full matrix across OMP OFF/files/hybrid and control OFF/managed/external/approval. Include malformed session path, source, profile, RPC responses, cross-OS mismatch, junction/symlink, replay command attempt, double click and delayed ACK.
3. Re-run Claude integration tests: hooks/list/status, close/open/task/steer, account quotas, permissions, group chat/selection, i18n, replay, SSE. Ensure OMP injected public IDs cannot traverse Claude handlers.
4. Native Windows Chromium desktop and mobile layout; 3D low quality, List Mode, accessible keyboard nav, hidden/offline history. Remote browser/tunnel/LAN cannot invoke or receive control details. WSL/Linux unit != native Windows E2E evidence.
5. Measure baseline vs control disabled vs N idle sessions vs active, record CPU, memory/RSS, timers/handles, event callback p95, UI FPS/list mode and startup. Tune queue/timeouts/polling only after measurements. 2–8h soak when specifically authorized; no invented improvement.
6. Test restart/shutdown: browser closes, server closes, OMP terminates unexpectedly, extension reloads, token rotated, session fork, owner collision. No orphaned managed agent (or explicitly documented unavoidable limitation), no duplicate prompt after retry/reconnect. Retain transcript integrity.
7. Security negative suite: missing/mismatched Origin, malicious host, tunnel/phone accepted cookie, crafted OMP ID/Claude SID, token leak, credential file/DACL, prompt in logs, approval default, replay side effect. Fail closed.
8. Update operator docs and runbook: feature flags, install extension optional, start/resume behavior, offline states, hiding vs unpinning, unavailable capabilities, rollback disable flags first; don't delete session folders.
9. Rollout: stage `visibility only` → `managed RPC` → `external TUI bridge` → `approvals`, each with separate signoff; keep default OFF. User must explicitly authorize turning on features in real daily environment.
10. Report changed files, benchmark actual numbers, commands/pass/fail/skipped, unresolved risk and decisions; no commit/push unless separately requested.

## Live Agent Activity Bubbles — security, regression, perf gate G7

**File scope bổ sung:** `src/office/people/workers.js`, `src/office/interact/place-chips.js`, `src/styles/labels.css`, `src/styles/responsive.css`, `src/office/ui/event-text.js`, `tests/unit/omp-activity-summary.test.mjs`, `tests/e2e/omp-activity-bubbles.spec.ts`.

1. Browser E2E với hai phiên OMP `my-office` / `auto-pmh`: mỗi bubble phải hiển thị đúng tool của **chính** session đó; chuyển read→edit→test/cmd, waiting, idle, stale, disconnected, ended, gap, reconnect, resume/switch không giữ việc cũ. Cùng tên/worktree khác không bị trộn.
2. Privacy negative: default observer category-only; detailed safe basename/test label chỉ local opt-in; không render raw path, command, prompt, reasoning, args, secrets, result, URL. Thử malformed/HTML, Streamer Mode on/off, replay, photo mode, remote/mobile viewer và tooltip.
3. UI regression: 80-char cap, CSS2D collision/declutter khi nhân vật gần nhau, camera zoom, responsive, 2/8/32/64 workers, High/Low Quality và List Mode; không phá Claude bubbles.
4. Benchmark native Windows **trước/sau** (generic vs detail opt-in): CPU/RSS, browser FPS, p95 frame time, dropped frames, CSS2D DOM updates/offsetWidth/offsetHeight/layout reads, event-loop lag, observer hook latency và 20+ tool events/s burst. Đo khi dashboard đang mở và đóng; không tuyên bố cải thiện nếu thiếu số. Kiểm tra coalescing mục tiêu ban đầu ≤2 lần thay DOM/actor/giây.
5. Rà soát source-of-truth: `eventSequence`/generation/TTL, bounded memory, cleanup on unmount/ended, không có timer hoặc DOM listeners tồn dư. Nếu regression FPS hoặc privacy, disable **optional detail** trước, giữ category-only observer hoạt động.

### G7 acceptance bổ sung

- [ ] Thực tế hai bubble đúng agent, không còn nhãn cũ khi agent dừng và không lộ dữ liệu nhạy cảm.
- [ ] Test desktop/mobile/Low Quality/List Mode/streamer/collision, so sánh FPS-CPU-RAM-layout trước/sau có số đo.
- [ ] Rollback optional detailed summary không làm mất liveness observer hoặc thay đổi transcript/Claude.

### Planned test commands — sau phê duyệt

```bash
node --test tests/unit/omp-activity-summary.test.mjs tests/unit/omp-observer.test.mjs tests/unit/agent-compat.test.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/omp-activity-bubbles.spec.ts --config=playwright.omp.config.ts
```

## Gate G7 / acceptance
- [ ] Full focused and regression tests PASS or documented limitations explicitly accepted; no false claim all OMP modes supported.
- [ ] Native Windows real process tests evidenced for new/resume/chat, external bridge, approvals by kind when enabled; no hidden model costs without consent.
- [ ] Claude Code baseline, OMP read-only telemetry, quota/account attribution unaffected.
- [ ] Security review no unauthorized OMP command, no secret/log leak, no destructive transcript operation.
- [ ] Measured CPU/RAM/timer/3D delta, bounded when dashboard closed and optional features disabled.
- [ ] Docs and rollback rehearsed, flags default OFF until staged approval.

## Verification commands after approval (exact version/runner verified at G1)
```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node --test
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts tests/e2e/omp-files.spec.ts tests/e2e/omp-hybrid.spec.ts tests/e2e/omp-controls.spec.ts tests/e2e/omp-visibility.spec.ts tests/e2e/omp-launch-resume.spec.ts tests/e2e/omp-approval.spec.ts
```

If test config or CLI differs, record adjusted verified command before running. Test history must separate synthetic from real native Windows and model-backed smoke.

## Stop / rollback
If security unauthorized, wrong session control/resume, duplicate prompt, Claude regression, prompt leakage or major resource regression: stop rollout, disable control/approval/launcher flags, preserve observer/data, gracefully close only owned managed child when safe, no unsafe process kill/auto file removal. Update gate status and re-plan affected portion. Rollback should not reset user work or rewrite OMP settings.
