---
title: "OMP Multi-Account Usage trong My Office"
description: "Theo dõi token/chi phí theo provider và quota/reset theo từng OAuth account Codex, Antigravity được quản lý bởi OMP, không đăng nhập lại."
status: pending
priority: P2
effort: "Ước tính 4-6 dev days; chốt lại sau G1"
branch: main
tags: [feature, backend, frontend, auth, experimental]
blockedBy: []
blocks: []
created: 2026-11-01
---

# OMP Multi-Account Usage — Kế hoạch triển khai

## Outcome và phạm vi đã thống nhất

Trong My Office, bổ sung quan sát **hai loại dữ liệu khác nhau** cho `openai-codex` và `google-antigravity` chạy **bên trong OMP (Oh My Pi)**:

1. **Session usage**: input/output/cache tokens, cost (nếu OMP ghi nhận), theo provider/model/session; nếu có identity đáng tin cậy mới phân bổ theo OAuth account.
2. **Account quota**: tất cả OAuth account mà profile OMP được phép thấy, từng quota window, tỷ lệ sử dụng/còn lại, `resetsAt`, freshness, trạng thái lỗi/không được hỗ trợ. Nhiều account trong cùng provider hiển thị tách biệt.

**Không tạo Codex/Antigravity session adapters, không đăng nhập OAuth lần nữa**, không sao chép credentials. OMP vẫn sở hữu login, refresh, account rotation, saved resets và model selection. My Office chỉ là observer; session usage KHÔNG suy ra account allowance, quota KHÔNG suy ra cost.

Đối tượng thực tế: **Windows 11 native**, có thể chạy cùng WSL2 nhưng không dùng WSL như bằng chứng cho quyền truy cập auth store của Windows. Hệ thống Claude Code hiện hữu phải giữ nguyên.

## Architecture / data flow

```text
OMP JSONL + existing observer -> OMP normalization/usage ledger
                                     -> session metrics (provider/model, provenance)
OMP profile / auth broker -> supported OMP usage surface (opt-in; safety gate)
                                     -> bounded collector/cache
                                     -> account quotas (provider, profile, opaque account id)
                   BOTH -> additive server read-only snapshots/SSE
                        -> My Office existing plan UI + OMP usage section
Claude usage/account controls ---------------------> UNCHANGED
```

**Lựa chọn kiến trúc**: bộ thu thập quota **độc lập** trong `server/agents/omp/`, tái sử dụng transport UI và các thành phần quota hiện có nhưng không nhập OMP vào `planLimits`/`others`/`repick` của Claude. Session metrics tiếp tục đi qua OMP adapter. Không dùng undocumented upstream API trực tiếp và không đọc `agent.db`.

**Account identity**: khóa hiển thị trong backend theo tuple `(profileNamespace, providerId, identityKey)`, tạo opaque public key; nhãn email/organization nếu trả về phải mask. Nhiều account cùng email/khác workspace không được gộp; cùng tên giữa hai profile cũng không được gộp. `active account` chỉ hiện nếu OMP báo được bằng chứng, tuyệt đối không đoán từ thứ tự tài khoản.

**Provider identity**: `openai-codex` và `google-antigravity` là provider IDs; `openai`/`google` không được mặc nhiên coi là OAuth Codex/Agy. Model ID đơn lẻ có thể mơ hồ; chưa xác minh provider thì hiển thị `unknown`/`unattributed`.

## Phases và approval gates

| # | Phase | Gate | Dependency | Status |
|---|---|---|---|---|
| 01 | [Compatibility + safe source verification](./phase-01-start.md) | G1: native Windows account/usage contract + safety | Không | Pending |
| 02 | [Bounded account/quota collector](./phase-02-provider-account-usage-collector.md) | G2: account isolation, no auth manipulation, safe cache | G1 | Pending |
| 03 | [Session token/cost attribution](./phase-03-session-metrics-attribution.md) | G3: provider attribution with provenance; no double count | G1, G2 contract | Pending |
| 04 | [Multi-account UI](./phase-04-multi-account-ui.md) | G4: truthful mixed Claude/OMP UI | G2 + G3 | Pending |
| 05 | [Hardening, regression, rollout](./phase-05-hardening-rollout.md) | G5: tests, perf evidence, docs, opt-in rollout | G4 | Pending |

[Evidence & unknowns](./evidence.md) · [Validation matrix](./validation-matrix.md).

## Relationship with the existing OMP plan

[OMP multi-agent integration](../261030-1754-omp-multi-agent-integration/plan.md) is a **separate ongoing workstream** (G4/Phase 05 and Windows security/perf gates may still be open). This plan **does not** assume the earlier plan is fully accepted. Re-scout files and reconcile concurrent Phase 05 modifications before any cook; never overwrite unrelated dirty files. Phase 01 and isolated read-only tests can proceed as planning/research; implementation that touches shared `server/index.mjs`, `projection.mjs`, `mac-drawer.js` or UI state requires scoped approval and conflict check.

## Non-goals

No account login/logout, selection/rotation, auto-switch, credential export, subscription upgrade, saved-reset spending, OAuth authorization UI, direct provider API scraping, OMP source/auth store mutation, auto-discovery of arbitrary profiles, or new background service. No automatic classification of token usage by account without evidence. No blanket cost aggregation across Claude and OMP; estimates are not bills.

## Security and performance defaults

- Feature OFF by default (candidate `OFFICE_OMP_USAGE=0`). Separate opt-in; `OFFICE_USAGE` remains Claude-only.
- No subprocess polling until G1 proves the **exact OMP version/profile/source** and verifies side effects. Docs describe usage refresh paths that can auto-redeem saved rate-limit resets; if safe observation cannot be demonstrated, **fail closed** (disable automatic quota polling, show unavailable/manual snapshot option subject to approval) rather than silently change OMP settings.
- Prefer approved OMP CLI/broker usage interfaces; never parse auth store or print credentials, identityKey raw, env or token-bearing stdout to logs.
- Allowlisted executable + argv, no shell interpolation, timeout/cancellation, output cap, concurrency=1, bounded cache, backoff and dashboard-aware polling. No timer when OFF or no viewers. No unverified CPU/RAM improvement claims.
- UI shows null/unsupported/stale rather than 0, handles permissions/401/429/network failures, and never displays private account details on remote/mobile clients without an approved privacy policy.

## Acceptance criteria (plan-level)

- [ ] Existing OMP-authenticated accounts are discoverable **without a new login**, on the selected native Windows profile; profile mismatch is a diagnosable state.
- [ ] Codex/Agy can each display N accounts with distinct provider/profile-scoped IDs, quota windows, reset countdown and last-success timestamp; unsupported window values remain unknown.
- [ ] OMP tokens/cost grouped by provider/model/session and optionally account only when an OMP-supported identity signal exists; historical vs provisional/inherited metadata preserved; no duplicated costs.
- [ ] No credentials materialized in My Office and no account switching/reset redemption initiated by My Office.
- [ ] Claude usage display, quota animations and account controls keep baseline behavior.
- [ ] Unit/E2E regression, native Windows smoke and measured performance budget pass or unresolved gates remain OPEN; docs and rollback instructions exist.

## Implementation and verification authority

**Current turn is PLAN ONLY.** No source edits, package install, OMP CLI usage probing, tests, runtime config changes, login flow, commit, merge or push. Each implementation phase requires user approval per project rules; G1 may require a separate explicit approval to invoke a real `omp usage` command because of possible side effects. Never mark a gate passed based on this document.

## Evidence / decisions pending

- **Verified in source (2026-11-01):** OMP normalization records tokens/cost but does not assign account identity; Claude uses a separate account/quota pipeline (see [evidence](./evidence.md)).
- **Documented upstream, not verified on this user's Windows binary:** `omp usage --json` and `omp usage accounts --json`; multiple OAuth identities/profiles; account usage output shape; the effect of usage refresh on saved reset credits.
- **Decision at G1:** Choose a provably safe usage read path, verify account identity/eligibility, broker vs local/profile behavior and automatic refresh controls. If any safety assumption fails, stop and re-plan that portion.

## Plan review (2026-11-01)

Review inline trên bốn góc nhìn (không phải subagents chạy độc lập):

- **Assumptions:** Upstream main có thể khác Windows OMP binary; G1 bắt pin exact version, schema and profile. Không coi OAuth credentials = một session đang mở.
- **Failure modes:** Missing CLI/JSON schema, revoked credentials, 429, malformed/partial windows, identity-less accounts, file/live duplicate; nullable, last-good bounded TTL, fail-closed and non-attribution guards được giao cho G2/G3.
- **Security:** Usage refresh có thể tiêu saved resets, CLI có thể phát raw identity, HMAC/public account IDs có thể bị brute-force nếu không keyed, remote viewer có thể nhìn thấy email. G1 hard stop, G2 opaque random/keyed IDs, bounded argv/stdout, backend masking and remote policy; không tự đổi OMP config.
- **Scope:** Không tạo hai CLI integrations, không thêm account selection/login/credentials, không gộp Claude quota pipeline. Source edits chỉ sau approval, giữ dirty Phase 05 work intact.

## Validation log

- `ak plan validate`: **PASS** — đúng format AgentKit; `ak plan parse` thấy đủ 5 phases, status `pending`, 0 tasks completed.
- Cross-check 15 existing candidate code/test/doc paths: **15 present**; các `create` paths là **proposed**, chưa có thực.
- Phases 01–05 dependencies, links, G1–G5, [evidence](./evidence.md) và [validation matrix](./validation-matrix.md) được đối chiếu nội bộ.
- Tests, app build, real OMP usage CLI, native Windows profile, quota JSON schema and performance benchmarks: **NOT RUN / UNVERIFIED**. G1 còn blocked until explicit approval/safe-source proof.
- CLI scaffold, tài liệu plan và read-only validation là các hành động duy nhất của lượt này; không commit, push hoặc sửa source code. Workspace hiện có các changes không liên quan từ OMP workstream; giữ nguyên.

## Next step

Request approval for **Phase 01 read-only compatibility work on Windows native**; do not start Phase 02–05 or invoke live account usage until G1 safety/permission gates are explicitly satisfied.

<!-- slug: omp-multi-account-usage -->