---
phase: 2
title: "Ẩn/hiện và quản lý lifecycle OMP trong sidebar/drawer"
status: completed   # G2 PASS: unit/HTTP/files/hybrid/agents, UI VI mobile và server restart đã kiểm chứng
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
- [x] Ẩn connected/disconnected/ended/pinned history chỉ gỡ UI/3D actor; lifecycle, pin, telemetry và transcript được giữ nguyên.
- [x] Giữ ẩn sau reload/reconnect/server restart; restore dùng trạng thái hiện tại; Undo khôi phục đúng ID.
- [x] Bỏ ghim tách riêng, catalog giữ nguyên; kiểm tra rail/List/3D không còn actor thừa.
- [x] Kiểm tra lại chỉ GET evidence; HTTP negatives chặn remote/Origin/ID giả, không gửi lệnh tới OMP.
- [x] Regression Claude/quota/replay/usage PASS; keyboard/ARIA/VI-EN/Low Quality/List Mode và mobile đã kiểm chứng.

## Verification after approval
```bash
node --test tests/unit/omp-visibility.test.mjs tests/unit/omp-adapter.test.mjs tests/unit/omp-lifecycle.test.mjs tests/unit/agent-compat.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test -c playwright.omp.config.ts
node node_modules/@playwright/test/cli.js test -c playwright.hybrid.config.ts
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts --workers=1
```
Synthetic clock for stale/disconnected/ended; HTTP crafted IDs, LAN/tunnel, missing Origin, browser CSRF negative.

## Risks / stop / rollback
Wrong visibility filter removes underlying sessions, inconsistent revisions or telemetry loss => STOP and rollback visibility flag; keep catalog/observer unchanged. No write to OMP files. Make schema/version migration reversible. No automated cleanup of users' old transcript.

## Kết quả G2 — 2026-11-01

**PASS.** Xem [validation matrix và lệnh thực chạy](./validation-matrix.md). Unit: 356 PASS, 3 SKIP có sẵn; files E2E 6/6, hybrid 1/1, agents regression 13/13; build/lint/typecheck PASS.

- Visibility được lọc tập trung trước snapshot/SSE; không cần thêm bộ lọc trùng lặp trong `workers.js`/`live.js`. Client vẫn dùng reconcile hiện hữu để gỡ actor, backend giữ nguyên session.
- Menu ⋯/drawer/List Mode, Undo, refresh evidence, restore-expired và replay guards đã hoàn tất; không cấp control OMP.
- Smoke server thật: ẩn → restart process → vẫn ẩn và còn ghim → hiện lại đúng một thẻ. SHA256 transcript synthetic không đổi; UI tiếng Việt mobile 390px không tràn ngang.
- Test files chia sẻ pin/visibility store nên chạy 1 worker, reset qua public API trước/sau mỗi ca. Windows dùng ANGLE/D3D11 để tránh timeout backend headless; giữ timeout/assertions gốc.
- Build kiểm chứng dùng thư mục riêng, không thay `.next` production hoặc khởi động lại office thật. G3–G7 chưa triển khai/bật trong phase này.
