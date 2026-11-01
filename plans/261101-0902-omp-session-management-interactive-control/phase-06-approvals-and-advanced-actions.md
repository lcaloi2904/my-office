---
phase: 6
title: "Tool approvals, ask, plan review và explicit safe actions"
status: pending
priority: P1
effort: "3-4 dev-days"
dependencies: [4, 5]
---

# Phase 06 — Approval / ask / plan review / advanced controls

## Goal
Từ My Office trả lời các yêu cầu quyền, câu hỏi và plan-review của OMP **chỉ khi runtime hỗ trợ phản hồi chính thức, định danh chính xác và lựa chọn được người dùng duyệt tại máy Windows**.

## Security first
- Phase 04/05 stable control; **separate user approval** to enable dangerous write/approval channel. `OFFICE_OMP_APPROVAL` default OFF.
- `waitReasons=["approval"|"input"]` chỉ là telemetry, không chứng minh khả năng/định danh quyết định. Không tự bật UI approval từ đó.
- RPC `extension_ui_request` có timeout/default semantics; phải xác minh rằng không có nhánh auto-allow. Nếu không chứng minh được fail closed: hide approval action for that kind, user returns to native TUI.
- Không "always allow"; chỉ Allow once/Deny/Skip; command nguy hiểm cần confirm 2 bước hoặc chỉ native TUI. No phone, LAN, tunnel dù Claude `phoneApprove` enabled.

## Candidate files
| Action | Repo-relative path | Purpose |
|---|---|---|
| Create | `server/agents/omp/approvals.mjs` | Pending decision registry, allowlist kinds, TTL, ownership |
| Modify | `server/agents/omp/rpc-host.mjs` | Version-verified RPC UI responses; timeouts and abort |
| Modify | `server/agents/omp/controller-bridge.mjs`, `integrations/omp/office-controller.js` | External TUI decision support **only if exact API verified** |
| Modify | `server/index.mjs` | `POST /api/omp/control/decision` local-only strict checks |
| Modify | `src/office/ui/permissions.js` or isolated `src/office/ui/omp-approvals.js` | Reuse visual styles, **not** Claude pending map/endpoint |
| Modify | `src/office/ui/session-drawer.js`, `src/styles/sessions.css` | Decision UI, confirmed action, pending expiry |
| Modify | `src/i18n/locales/{vi,en}/{drawer,activity}.js`, associated permission locales | Accessible labels, errors |
| Create | `tests/unit/omp-approvals.test.mjs`, `tests/e2e/omp-approval.spec.ts` | Anti-duplicate, invalid/expired, local-only |

## Tasks
1. Capture support matrix by runtime mode: tool-approval requested/resolved, plan review requested/resolved, embedded `ask` responses, extension UI RPC events. Different kinds may have different transport APIs.
2. Define `decisionId`, `runtimeKey`, `kind`, expiry, sanitized display fields and allowed choices. Server maps response exactly to pending runtime request, no inference from agent thinking or activity label. Request not found or expired => 404/409, not silent accept.
3. Implement `tool` Allow once / Deny; avoid global Always. Preserve original OMP policy and native fallback. Dangerous action policy server-side; deny or require confirmation on original TUI for shell/network/file destructive tasks.
4. Implement `ask` answers with option indices, free-text bounds, required fields and multi-select validation; malformed/partial answers rejected. Do not send private content to remote.
5. Implement `planReview` approve/revise/skip with correct comments/plan revision; don't interpret “skip” as “allow”. Only enable if current OMP mode has tested official response API.
6. UI shows pending request, exact agent/session and timeout, reason it cannot approve when unsupported. Controls blocked if session hidden/replay/changed owner; no cross-generation reuse.
7. Bound pending queue, duplicate clicks, default fallback, reload/reconnect, offline server, cancellation and audit metadata; on timeout fail closed, no retry without user.
8. Native Windows isolated scripted safety tests; approval of real destructive tool or paid model calls requires **additional explicit permission**, not automatically granted by this phase.

## Gate G6
- [ ] Tool approval Allow-once/Deny, plan review and ask only enabled when supported **per kind and per runtime**.
- [ ] Zero accidental auto-approval, "always" rule or remote approval; expire/revoke disables stale buttons.
- [ ] Duplicate/stale/malicious decisions cannot cross session or generation.
- [ ] Fallback original OMP prompt works for unsupported scenarios; no agent hang caused by dashboard.
- [ ] Claude approval still unchanged, isolated tests and privacy negative pass.

## Verification after approval
```bash
node --test tests/unit/omp-approvals.test.mjs tests/unit/omp-control-manager.test.mjs tests/unit/omp-controller-bridge.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/omp-approval.spec.ts tests/e2e/agents.spec.ts
```

## Stop / rollback
Approval automatically allowed on timeout, API cannot reject unsafe action, wrong requestID, unauthorized phone or native OMP policy mismatch => disable approval feature, keep Prompt/Read-only. G6 must remain OPEN for unsupported modes; never claim all modes support ask/plan review based on synthetic cases.
