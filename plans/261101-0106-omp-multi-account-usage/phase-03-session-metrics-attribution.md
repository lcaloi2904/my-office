---
title: "Phase 03: OMP session metrics by provider/model"
status: todo
priority: P1
effort: "1-1.5 days"
dependencies: [1, 2]
---

# Phase 03 — Token/cost phân loại theo provider, model, session

## Objective

Tận dụng OMP file observer và runtime extension đang có. Thêm provider provenance ở mức **từng usage record** và rollup có thể kiểm chứng; không đánh đồng usage của 1 session với quota của account hiện đang được chọn.

## Existing data and limits

- `server/agents/omp/usage.mjs` đang giữ usage record input/output/cache/cost và aggregate theo session; chưa track provider/account per entry.
- `server/agents/omp/normalize.mjs` đọc model từ JSONL nhưng `model` không mặc nhiên là khóa provider duy nhất.
- `integrations/omp/office-observer.js` hiện gửi model id từ `ctx.model` và snapshot usage tổng; không gửi provider hoặc credential identity.
- Durable file usage replaces provisional runtime snapshot; inherited/fork scope và incomplete flags cần giữ đúng. Lifetime token sum **không phải** context fill hay account quota.

## Design

1. **Evidence-first provider**: ưu tiên trường provider được OMP ghi rõ ở entry/raw event hoặc `ctx.model.provider` nếu phiên bản đó thật sự cung cấp. Nếu tên đã fully-qualified `provider/model` đúng contract, parse được. Trường thiếu/ambiguous thì `providerId:null` và `unknown`. Không gán `gpt-*` vào Codex hay `gemini-*` vào Antigravity theo prefix vì `openai`, `google-gemini-cli` và `google-antigravity` khác nhau.
2. **Per-entry metrics**: record id/epoch, model id, provider id, usage values, provenance `recorded/provisional`, scope `self/inherited/subtree`, incomplete flag. Aggregate per session+provider+model bằng idempotent ledger. File rewrite, compaction, retry, duplicate tool events không tạo double count. Null cost from provider is null, not estimated from Claude pricing.
3. **Partial/mixed sources**: session can switch provider mid-flight; rollups from evidence-bearing entries only, while unknown portion remains an explicit bucket. No multiplication by total session usage. Runtime snapshots cannot be added to file totals; if provider of a provisional total is uncertain, keep unallocated.
4. **Account binding is optional**: accept a credential `identityKey` only if OMP exposes a privacy-safe stable per-request signal in an approved API. Multi-account rotation during one session means timestamps/ownership may change. Without the signal, `accountKey:null`; display account quotas independently and token/cost as provider-level `unattributed to account`. Never read OMP auth store/inspect current selected account to guess historical usage.
5. Additive wire schema `metricsByProvider` or equivalent; legacy `s.metrics` remains contract-compatible and nullable. No OMP metrics transferred into Claude `usage` or `accountant` totals.

## Candidate files (re-scout after existing Phase 05 changes)

| Action | File | Purpose |
|---|---|---|
| Modify | `server/agents/omp/normalize.mjs` | Extract verified provider/model per record |
| Modify | `server/agents/omp/usage.mjs` | Provider-specific idempotent ledger + nullable rollups |
| Modify | `integrations/omp/office-observer.js` | Optional vetted safe provider field; no auth payload |
| Modify | `server/agents/projection.mjs` | Additive metrics fields; explicit provenance and unknown |
| Modify | `server/agents/omp/index.mjs` | Reconcile durable vs provisional aggregates only if required |
| Modify | `src/office/ui/session-info.js` / `src/office/ui/session-drawer.js` | Candidate consumers; actual UI changes phase 04 |
| Modify/create | `tests/unit/omp-normalize.test.mjs`, `tests/unit/omp-projection.test.mjs`, `tests/unit/omp-usage-attribution.test.mjs` | Tests/fake events |

Do not change Claude price table `server/usage.mjs`, `src/office/life/quota.js` or account controls unless separate approval explicitly adds scope.

## Implementation steps

1. Define sanitized provider evidence contract and fixtures: Codex, Antigravity, plain OpenAI API/Google API, unknown model, mid-session model changes, inherited fork.
2. Extend input normalizer only with supported OMP fields, validate type/size, no credential/body/response text.
3. Implement idempotent per-entry aggregation; preserve current session metrics and bounded memory; no full JSONL rescans on every poll.
4. Expose additive projection, null-safe consumer; constrain provider IDs and support unknown rather than fallbacks.
5. Reconcile live and saved history: same entry counted once; restart/rewrite gives same totals; provisional clearly labeled; context unknown != 0.
6. Test provider change, rotation without account attribution, concurrency, two same model IDs from different providers, incomplete recording, synthetic zero vs absent metrics.

## G3 acceptance

- [ ] T1–T4 pass; provider totals match known input fixtures, no model-prefix guessing.
- [ ] Session-to-account assignment impossible without evidence => remains `unattributed`, even if UI knows a preferred account.
- [ ] No duplicate file+live totals, inherited history clearly labeled, no invalid cost zero.
- [ ] Claude regression and per-session legacy shape preserved.

## Verification (after approved changes)

```bash
node --test tests/unit/omp-normalize.test.mjs tests/unit/omp-projection.test.mjs tests/unit/omp-usage-attribution.test.mjs
npm run lint
npm run typecheck
```

If upstream provider identity is unavailable in the pinned OMP version: show unknown provider for those records, report limitation, **do not invent an event** or read credentials.
