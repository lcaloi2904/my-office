---
phase: 3
title: "Native Windows RPC launcher, tạo phiên mới và resume chính xác"
status: completed
priority: P1
effort: "4-6 dev-days"
dependencies: [1, 2]
---

# Phase 03 — Native RPC session launcher / resume

## Goal
Từ My Office, khởi tạo một OMP session mới trong **approved project + profile** hoặc tiếp tục **exact persisted session** trong runtime mới; không mở nhầm process/transcript hoặc tự chạy lại unfinished work.

**Nghiệm thu 2026-11-01: G3 PASS (Phase 04 vẫn đóng, chờ phê duyệt riêng).** Binary EA/ctime drift đã sửa; bản native riêng `omp-office-g3.exe` cùng giao thức `resumeProtocol: 1` + `ownerDir` đã hoàn tất acquire/adopt khóa writer độc quyền trước khi nạp history và kiểm chứng exact Resume không fallback. Xem [biên bản G3](./reports/g3-launcher-acceptance.md).

## Entry gate / permission
- G1 & G2 evidence. User approval riêng cho **source changes bật optional process creation**, policy exception `AGENTS.md` và OMP native Windows smoke. Flag OFF by default.
- Không dùng Cloud Harness/WSL làm runtime OMP production. Không tự cài binary, nạp extension, gọi paid model hoặc sử dụng real credentials trong tests.

## Files to create / modify
| Action | Repo-relative path | Role |
|---|---|---|
| Create | `server/agents/omp/rpc-host.mjs` | Native Windows managed child + bounded RPC transport |
| Create | `server/agents/omp/control-manager.mjs` | Session owner registry, leases, capability routing |
| Create | `server/agents/omp/launch-resolver.mjs` | Approved project/profile/session-id → safe launch argv/cwd |
| Modify | `server/index.mjs` | Local-only `POST /api/omp/control/launch` and status; feature flags/cleanup |
| Modify | `server/agents/omp/index.mjs`, `server/agents/projection.mjs` | Merge managed generation with file/live projection, no duplicates |
| Modify | `server/agents/schema.mjs`, `server/agents/registry.mjs` | Additive OMP-only control hint; existing Claude gate untouched |
| Modify | `src/office/ui/session-drawer.js`, `src/office/ui/omp-history.js`, `src/office/ui/activity.js` | Launcher dialog and Resume/New actions |
| Modify | `src/i18n/locales/{vi,en}/{activity,drawer}.js`, `src/styles/sessions.css` | Form/errors and layout |
| Create | `tests/unit/omp-rpc-host.test.mjs`, `tests/unit/omp-launch-resolver.test.mjs`, `tests/e2e/omp-launch-resume.spec.ts` | Protocol/identity/UI |
| Create | `tests/fixtures/omp/fake-rpc-host.mjs` | Strict isolated native-like RPC fixture |

## Tasks / implementation order
1. Confirm exact installed Windows OMP CLI RPC launch flags/profile behavior with isolated non-model fixture. Distinguish `--resume` / `--continue` / `--restore` / `open_session` semantics. Resume must select **exact** session, never “most recent” silently.
2. Server-side registry of allowlisted projectKey/worktreeKey and profileAlias, OMP executable resolved via already verified `OFFICE_OMP_BIN` or explicitly configured allowlist. Reject arbitrary CLI argv, shell, inherited malicious environment, cwd, session path or PID supplied by browser.
3. Resolver takes `candidateId` from approved OMP catalog; validates file path containment and root identity, symlink/junction defense, exact source session ID and file owner; re-check after opening. Block if current runtime owner still connected/ambiguous, or 2 active writers.
4. Implement `spawn(binary,args,{shell:false,cwd:approvedRoot,windowsHide:true,stdio:"pipe"})`, bounded stdout JSONL incremental parser, stdin backpressure, request ID correlation, stderr redaction, startup timeout, terminate on invalid protocol. No `cmd /c` / PowerShell injection.
5. Handshake `get_state` and verify session ID/source/profile/generation after launch; on failure cleanly close **owned** child, no public controllable session. If model/account unavailable display error and do not switch silently.
6. Add managed control lease keyed by `sourceNamespace/sourceSessionId/runtimeInstanceId/generation`, conflict arbitration with observer. Snapshot only sanitized public fields, merge into same 3D actor. Do not route managed data through Claude hooks.
7. UI “Phiên mới” with selected approved project/worktree/profile/model (optional when supported); “Tiếp tục” with exact candidate, conflicts disabled, explicit user confirmation if version quirks, clear differences Resume vs New.
8. Server restart/crash policy: never auto-replay queued commands or auto-relaunch OMP; browser tab close does not close process while server alive. On server shutdown close owned stdin/child gracefully with timeout, preserve transcript; no kill external process.
9. Add startup/error diagnostics and per-phase rollback flag. Keep OMP usage and observer functioning when launcher disabled.

## Gate G3 / acceptance
- [x] New session created only on click, in approved Windows project/profile; no unexpected OAuth login/account change — native fixture không dùng credentials thật.
- [x] Resume opens *selected* history ID, preserves context and avoids concurrent writer; no “latest” fallback — đã kiểm chứng trên `omp-office-g3.exe` với `resumeProtocol: 1`, `ownerDir` nguồn và transcript có sẵn user + assistant.
- [x] Invalid root/profile/executable, PID mismatch, wrong ID, junction/symlink and live conflict all fail safely — unit, HTTP và binary-drift smoke.
- [x] Managed child owner/restart/shutdown lifecycle correct; no double actor, no orphaned control ownership — generation/race unit, native EOF, fresh-server không relaunch và idle parent-crash child-exit đã đạt; busy crash/shutdown chưa kiểm.
- [x] Source behavior Claude/read-only OMP unaffected with flags OFF — unit + files/hybrid/agents/Claude smoke đã đạt.

## Verification after approval
```bash
node --test tests/unit/omp-rpc-host.test.mjs tests/unit/omp-launch-resolver.test.mjs tests/unit/omp-adapter.test.mjs tests/unit/agent-schema.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/omp-launch-resume.spec.ts --config=playwright.omp.config.ts
```
Isolated native Windows OMP no-model smoke requires separate approval and exact version report. No test uses `~/.omp` credential/session store or real project changes.

## Risks / stop / rollback
Wrong session resume, child ownership ambiguity, executable binary mismatch, JSONL parser hangs or unintended model turn → STOP, feature flag off, gracefully close *only owned* child, keep OMP read-only history and sessions. Never reset Git or delete transcript. Document process accounting and exit mode.
