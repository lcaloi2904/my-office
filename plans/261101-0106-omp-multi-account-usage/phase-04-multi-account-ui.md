---
title: "Phase 04: My Office multi-account usage UI"
status: todo
priority: P2
effort: "0.75-1 day"
dependencies: [2, 3]
---

# Phase 04 — UI usage Codex/Agy trong My Office

## Objective

Bổ sung phần `OMP Usage` vào giao diện hiện có, không redesign scene 3D, không biến dashboard thành giao diện account control. Claude plan UI và các phím/nút chuyển tài khoản Claude phải giữ nguyên.

## User journey

- Người dùng đang sử dụng OMP với một hoặc nhiều account Codex/Antigravity; My Office tự hiển thị các account thuộc **OMP profile đã chọn**, không yêu cầu login lại.
- Mỗi provider có nhóm account riêng; trong mỗi account có nhiều quota windows độc lập (5h/weekly/per-model/credit window nếu source xác thực) với `usedPercent`, phần còn lại, reset time, trạng thái dữ liệu `fresh/stale/unsupported/auth-error`.
- Phần **session tokens/cost** cùng khu vực nhưng khác ý nghĩa và đơn vị: per-provider/per-model/session; chỉ có số tổng riêng account khi OMP thật sự báo account identity của usage request. Nếu không: hiển thị rõ `Chưa xác định tài khoản`.
- Có thời điểm cập nhật và nguồn `OMP`, tooltip phân biệt `measured`/`estimated`, `recorded`/`provisional`/`inherited`. Khi mất OMP, badge `stale`; không hiển thị 0 giả, không tự động đăng nhập lại.
- Người dùng có thể xem trên List Mode/Low Quality/mobile; remote viewer chỉ thấy thông tin được policy chấp thuận; không rò email raw trong SSE/tooltips.

## UI composition

```text
Existing Claude Plan Usage [UNCHANGED]
--------------------------------------
OMP Usage (separate section)
  Codex (openai-codex)
    Account alias A   windows: ...  read 10:30   [fresh]
    Account alias B   windows: ...  read 10:25   [stale]
    Tokens by provider/model   [account-unattributed if no evidence]
  Antigravity (google-antigravity)
    Account alias C   ...   [unsupported window?]
    Account alias D   ...
    Tokens by provider/model
  Source / last-updated / errors
--------------------------------------
No login / logout / account-switch / reset-spend buttons
```

The image above is a layout contract, not verified live quota data. Keep current style and i18n; do not add 3D actors for accounts or new GPU workloads.

## Candidate files (verify latest Phase05 changes before cook)

| Action | File | Role |
|---|---|---|
| Create | `src/office/ui/omp-usage-panel.js` | Provider/account quota grouping, metrics summary |
| Modify | `src/office/ui/mac-drawer.js` | Host additive panel; keep Claude controls isolated |
| Modify | `src/office/core/state.js` / `src/office/net/live.js` | Own separate `ompUsage` state and SSE hydration |
| Modify | `src/office/demo/demo.js` | Fake multi-account fixtures incl unknown/stale |
| Modify | `src/office/ui/session-drawer.js` / `src/office/ui/session-info.js` | Provider/model/metrics evidence in session detail |
| Modify | `src/styles/sessions.css` / existing matched CSS | Visual styles/responsive without redesign |
| Modify | `src/i18n/locales/en/*`, `src/i18n/locales/vi/*` (scoped keys) | Locale strings, labels for unknown/stale |
| Modify/create | `tests/e2e/agents.spec.ts` and focused `tests/e2e/omp-usage.spec.ts` | Mixed-agent/responsive/assertions |

Server projection and remote filtering remain authoritative; frontend hiding an account field alone is not security.

## Steps

1. Freeze a fixture-led UI contract: 0, 1, N accounts, same-name account collisions, Codex + Agy mixed quota, mixed model token usage, unavailable/stale/no window, timezone, sparse usage.
2. Reuse existing mac-drawer card patterns/`renderLimits` visual helpers only where safe; separate state from `state.limits` so Claude user/account switching cannot route through OMP view.
3. Render per-account window lists with short labels and exact unit semantics: primary bar `used` or `remaining` explicitly labeled; countdown only if a valid reset timestamp; stale data has freshness timestamp.
4. Token breakdown per provider/model with discrete session vs account attribution; no account-bound totals from simple provider counts. Cost scope and provenance remain visible.
5. Ensure UI is text-safe, mobile responsive, keyboard navigable and i18n EN/VI; screenshots and accessibility checks on Windows-native Chromium if available.
6. Test SSE reconnect, startup with OMP disabled, partial account failure, local vs remote projection, browser hidden/tab foreground, preserving Claude plan pill and controls.
7. Prohibit any new action button that calls OMP `login`/`logout`/`usage reset`/account switch; safe manual `Refresh` only when G1 approved side-effect-free read path.

## G4 acceptance

- [ ] U1–U3 pass; displays all supported OAuth accounts with stable distinct labels and their actual windows.
- [ ] No assumptions that a provider's 5h or weekly windows exist; absent is `N/A`, not 0.
- [ ] Display token usage and quota as two separate concepts; account association only with evidence.
- [ ] Claude `state.limits`, plan pill, browser controls and animation unaffected.
- [ ] Remote details masked according to security contract; server does not leak more fields than policy allows.

## Verification (after approved changes)

```bash
npm run lint
npm run typecheck
npm run build
npx playwright test tests/e2e/agents.spec.ts tests/e2e/omp-usage.spec.ts
```

Review exact test commands against repo config at cook time; do not modify existing assertions to make tests pass. Mark unsupported runner/browser scenarios NOT RUN.
