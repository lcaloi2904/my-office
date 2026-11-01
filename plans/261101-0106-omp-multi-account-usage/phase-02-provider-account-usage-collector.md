---
title: "Phase 02: Isolated OMP account usage collector"
status: done
priority: P1
effort: "1-1.5 days"
dependencies: [1]
---

# Phase 02 — Collector quota theo từng account, read-only

## Objective

Dựng backend account inventory/quota collector chạy **cùng OMP profile** và **độc lập khỏi Claude usage**, chỉ sau G1. Dùng API/CLI sanctioned đã chứng minh an toàn; không đọc OMP credential database hoặc gọi provider API riêng.

## Proposed contract (not implemented)

```ts
type UsageWindow = {
  id: string; label: string; kind: string;
  usedPercent: number | null; remainingPercent: number | null;
  resetsAt: number | null; // epoch ms, only when source semantics verified
  sourceUnit: "used" | "remaining" | "unknown";
};
type OmpAccountUsage = {
  accountKey: string;     // opaque derived from (profile,provider,identity), stable within scope
  providerId: "openai-codex" | "google-antigravity";
  label: string;          // privacy-safe alias, not bearer/email unless explicitly approved
  windows: UsageWindow[];
  availability: "ready" | "stale" | "unavailable" | "auth-error" | "unsupported";
  observedAt: number | null; lastSuccessAt: number | null;
  source: "omp-cli" | "omp-broker"; // only actual supported source
  noteCode?: string;      // allowlisted error enum, no raw stderr
};
```

Backend snapshot includes `version`, `accounts[]`, `collector` status and optional `issues[]`. Never carry bearer, raw identityKey, private env, access/refresh token, credential path, raw stdout or provider response blobs to the browser. Internal accountKey must be an opaque per-process random mapping or a keyed HMAC derived from (profile,provider,identity); **never** a plain SHA hash of an email/identityKey that can be guessed by dictionary attack. Default guarantees stability only within one server lifetime. Persisted keyed identity for cross-restart stability requires separate security approval and Windows ACL verification.

## Candidate files (verify before cook; paths are proposed)

| Action | File | Ownership / purpose |
|---|---|---|
| Create | `server/agents/omp/usage-accounts.mjs` | Typed runtime normalization + whitelist account/window records |
| Create | `server/agents/omp/usage-collector.mjs` | Controlled OMP CLI/broker source, bounded cache, diagnostics, dispose |
| Modify | `server/index.mjs` | Additive local API/SSE snapshot; viewer-gated polling and flag |
| Create | `tests/unit/omp-usage-accounts.test.mjs` | JSON shape, IDs, window semantics, privacy |
| Create | `tests/unit/omp-usage-collector.test.mjs` | Fake process/broker, single-flight, timeout, stop, failures |
| Possibly modify | `bin/cli.mjs` or `start-office.cmd` | Only for explicit safe config/Windows launching after approval |

Do **not** modify `server/agents/omp/index.mjs` for account polling unless source ownership review proves necessary. Preserve Claude `planLimits`, `limitsOut`, `othersOut`, `repick`.

## Steps

1. Feature flag default OFF and approved opt-in source selection (`OFFICE_OMP_USAGE` conceptual; final env/config naming at G1). Pin exact executable/profile or broker grant; Windows spawn `shell:false` with fixed argv. No arbitrary filesystem path in HTTP/SSE args.
2. Extract token-free OAuth account inventory from the sanctioned OMP usage source; accept only provider IDs `openai-codex`, `google-antigravity`; distinguish multiple organizations/profiles. Auth errors differ from account absent and incomplete list.
3. Normalize windows with explicit units and provenance. Bounds: max account count, windows/account, string lengths, integer timestamps, percent 0–100, source payload size. Unknown/unsupported are null, never fabricated 0.
4. Cache last-good bounded snapshot, `observedAt`, `lastSuccessAt`, TTL and expiry. Respect OMP-owned cache. Sequential refresh/single-flight, timeout/abort/process reap, 429 backoff with jitter; only refresh on local viewer demand or safe manual action. Do not force OMP refresh/invalidate.
5. Reflect source errors as sanitized codes without raw output. No startup subprocess while OFF/idle. No persistent secret-bearing data; optional account aliases stored only when approved and sanitized.
6. Expose additive versioned message (e.g. `k: 'ompUsage'`) and owner-only read endpoint through existing auth transport. No remote/mobile private account projection until policy G1/G4 permits.
7. Add fake CLI fixtures for 0, 1, N accounts, Codex+Agy, same identity across profiles, malformed/incomplete output, missing binary, stale cache, revoked OAuth, logout, 429, app shutdown, browser closed.
8. Safety: instrument all spawn/fetch/auth read/mock calls; assert no `omp login/logout`, `usage reset`, `usage invalidate`, config write, model prompt, account switching, direct `agent.db` access.

## G2 acceptance

- [x] S1–S8 synthetic tests pass; G1's safe source condition has not regressed.
- [x] All account identities remain distinct; masked; no auth/broker secrets or unapproved remote projections.
- [x] No unapproved use of saved resets, OAuth login, config alteration or provider requests outside approved OMP read path.
- [x] No Claude account/usage/control path changed; disable flag cleans all child processes/timers/retained objects.

## Verification (after scoped approval)

```bash
node --test tests/unit/omp-usage-accounts.test.mjs tests/unit/omp-usage-collector.test.mjs
npm run lint
npm run typecheck
```

No real account refresh during synthetic testing; run Windows integration smoke only with separate explicit approval and documented G1 safety.
