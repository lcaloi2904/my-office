---
phase: 2
title: "Ẩn/hiện và quản lý lifecycle OMP trong sidebar/drawer"
status: in-progress   # code xong (commit 36e0d40); unit/lint/tsc PASS; e2e Playwright NOT RUN
priority: P1
effort: "3-4 dev-days"
dependencies: [1]
---

# Phase 02 — Session visibility & lifecycle UX

## Goal
Người dùng có thể Ẩn/Hiện OMP đã tắt/mất kết nối/đang chạy, Bỏ ghim history và tìm lại phiên, mà không hủy process, sửa JSONL, mất context hoặc bị SSE làm hiện lại phiên đã ẩn.

## Preflight / non-goals
- G1 ownership/state/rights matrix reviewed; scoped approval **chỉ cho source/UI visibility**.
- Không launch/resume/control/kill OMP; không thêm transcript deletion; không đưa OMP vào Claude task/permission selectors.

## Files to create / modify
| Action | Repo-relative path | Role |
|---|---|---|
| Create | `server/agents/omp/visibility.mjs` | Bounded atomic hide preference store, schema, revision |
| Modify | `server/index.mjs` | Local-only `GET/POST /api/omp/visibility`, safe status reads, SSE invalidation |
| Modify | `src/office/ui/activity.js` | OMP ⋯ menu, hidden filter, unknown group |
| Modify | `src/office/ui/omp-history.js` | “Phiên đã ẩn”, restore and separate pinned state |
| Modify | `src/office/ui/session-drawer.js` | Actions for live disconnected/ended/history, explanations |
| Modify | `src/office/net/live.js` | Local visibility application before actor reconcile; revision guard |
| Modify | `src/office/people/workers.js`, `src/office/ui/lite.js` | Hidden actors removed from 3D/list mode while preserving logical session state |
| Modify | `src/styles/sessions.css`, `src/i18n/locales/{vi,en}/{activity,drawer}.js` | Responsive accessible menu and translations |
| Create | `tests/unit/omp-visibility.test.mjs`, `tests/e2e/omp-visibility.spec.ts` | Hide/unhide tests |
| Modify | `tests/e2e/agents.spec.ts`, `tests/e2e/omp-files.spec.ts`, `tests/e2e/omp-hybrid.spec.ts` | Regression cases |

## Tasks / implementation order
1. Write test matrix for `connection` vs `lifecycle` vs `persistedOnly` vs `pinned`; double-check `lifecycle.mjs` 30s stale/90s disconnected and later cleanup. Never render “đã kết thúc” from timeout.
2. Implement server-owned preferences keyed by opaque public OMP ID; local `data/omp-hidden.json` (ignored by Git), capped entries/size, atomic replace, revision compare, reject corrupt store without silent overwrite. Keep session and telemetry adapter unchanged.
3. Separate `Ẩn` (presentation only), `Bỏ ghim` (existing pin API), `Ngừng theo dõi` (existing live unpin semantics if exposed) and `Đóng agent` (not offered). Avoid confusing labels.
4. Define `GET /api/omp/visibility` and `POST /api/omp/visibility {id,hidden,expectedRevision}`: strict Origin/Host/loopback, id & source resolution, no arbitrary path, idempotent updates. Reject unknown/foreign namespace and fake IDs. Maintain a bounded recent hidden index for restore after live TTL expires.
5. Apply visibility to rail, List Mode, 3D actor reconciler and counts while preserving canonical `sessions` and server metrics; make sure `removeSession` only affects scene/view, not underlying adapter. Filter events before UI re-creation; retain undo.
6. Present ⋯ actions for connected, stale/disconnected, ended, persistedOnly; add “Kiểm tra lại” read-only refresh of current evidence (not probe/kill arbitrary OS PID), last-seen timestamp, ambiguous owner warning and explicit button disabled explanations.
7. Restore from “Phiên đã ẩn” after reload, browser reconnect and server restart; handle 2 tabs race with revision and status 409. UI must not assume same name implies same session/worktree.
8. i18n VI/EN, keyboard/ARIA, responsive narrow rail, themes, Low Quality/List Mode, focus/scroll preservation and replay side-effect block.

## Gate G2 / acceptance
- [ ] Ẩn một OMP connected, disconnected, ended và pinned history removes only UI entry/3D actor; transcript, pin and telemetry unchanged.
- [ ] Hidden remains hidden after SSE reconnect and server restart; restore returns *current* state; undo works.
- [ ] Bỏ ghim still works separately; historical catalog available; no ghost actors or stale counts.
- [ ] Raw commands never sent to OMP, including during “Kiểm tra lại”. No unsupported API accessible remotely.
- [ ] Claude sessions, OMP usage, replay and quotas unchanged; UI accessible.

## Verification after approval
```bash
node --test tests/unit/omp-visibility.test.mjs tests/unit/omp-adapter.test.mjs tests/unit/omp-lifecycle.test.mjs tests/unit/agent-compat.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/omp-visibility.spec.ts tests/e2e/agents.spec.ts --config=playwright.omp.config.ts
```
Synthetic clock for stale/disconnected/ended; HTTP crafted IDs, LAN/tunnel, missing Origin, browser CSRF negative.

## Risks / stop / rollback
Wrong visibility filter removes underlying sessions, inconsistent revisions or telemetry loss => STOP and rollback visibility flag; keep catalog/observer unchanged. No write to OMP files. Make schema/version migration reversible. No automated cleanup of users' old transcript.
