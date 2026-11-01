# Phase 06 — Security & Isolation Review (S1–S9) (01/11/2026)

## 1. Executive Summary

**Verdict: PASS with documented cross-host block (no security blocker for local opt-in rollout).**

All local read-only, authentication, rate-limiting, path-containment, redaction, XSS, control-isolation, and private credential storage gates (S1–S9) are verified by automated unit and E2E negative tests plus Phase 06 scoped hardening. Cross-host plain HTTP transport remains intentionally **blocked by design** (loopback-only enforcement in both producer and receiver).

---

## 2. S1–S9 Matrix & Verification Evidence

| ID | Threat / Negative Scenario | Control Implemented | Verification Evidence | Status |
| --- | --- | --- | --- | --- |
| **S1** | Missing/wrong/rotated token, cross-source token reuse, browser `Origin`, Cloudflare tunnel (`viaTunnel`), non-loopback peer, phone PIN/cookie/query token | `bridge.mjs`: loopback-only (`req.loopback === true && !req.viaTunnel`), rejects any `Origin` header (`403`), requires `Authorization: Bearer <64-hex>` (`length === 71`), constant-time `timingSafeEqual` over all configured source SHA-256 digests, enforces `event.sourceId === sourceId` (`422 source-mismatch`). | `omp-bridge.test.mjs` (`S1`), `agent-compat.test.mjs` (`/ingest/omp/v1`), [token remediation report](./phase-04-token-remediation.md) (`old 401 / new 200 / foreign 422`). | **PASS** |
| **S2** | Oversized body (`> 64 KiB`), batch flood (`> 32` events), slowloris stream (`> 5 s`), malformed batch envelope (`null`, primitive, `{"events":"bad"}`), request flood | `bridge.mjs`: pre-parse `Content-Length` check (`413`), streaming byte cap + `5 s` chunk timeout with socket `abort()` (`413`/`408`), token-bucket rate limiter (`burst: 200`, `50/s` per source, `429 retryAfterMs`), strict batch envelope check (`400 invalid-batch`), `normalizeOmpLiveEvent` field allowlist. `reader.mjs`: `maxLineBytes: 64 KiB` drain-to-newline, `maxFileBytes: 8 MiB`. | `omp-bridge.test.mjs` (`S2`), `omp-reader.test.mjs` (`F4`, `F12`), `omp-normalize.test.mjs`. | **PASS** |
| **S3** | Arbitrary path read via header/event (`previousSessionFiles`, `seanceSource`, `cwd`), `..` traversal, symlink/junction/hardlink escape, TOCTOU file replacement, Windows device names (`CON`, `NUL`, `COM1`), trailing dots/spaces, ADS (`:stream`), DEL (`\x7f`) | `paths.mjs`: `approveRoot` + `containedPath` + `openContained` (`O_RDONLY | O_NOFOLLOW`, `nlink === 1`, `lstat` chain check, `realpath` comparison, pre/post-open `dev:ino` verification, segment validation rejecting `.`, `..`, empty segments, trailing space/dot, `:`, `\x00-\x1f\x7f`, and Windows device names `CON`/`PRN`/`AUX`/`NUL`/`COM*`/`LPT*`). `/api/omp/pin` accepts only catalogued `omp:<sha256>` IDs. | `omp-paths.test.mjs` (`F11/S3`, NTFS junctions/symlinks/hardlinks, TOCTOU replacement, Unicode/space vs device names), `omp-adapter.test.mjs` (`F11`), `omp-files.spec.ts`. | **PASS** |
| **S4** | Secret leakage in prompts, titles, tool args/outputs, errors, or diagnostic codes | Metadata mode drops prompts, titles, args, outputs, reasoning, and raw paths. Diagnostics emit fixed error codes (`errorCode()`), never raw exception messages or file paths. Opt-in conversation applies `redact()` (`server/redact.mjs`) and `4,000`-char per-item cap. Local-only `broadcast(msg, true)` excludes OMP from LAN/phone/tunnel and `data/replay/*.jsonl`. | `omp-normalize.test.mjs` (`S4/S9`), `omp-adapter.test.mjs` (`PRIVATE` sentinel checks), `omp-files.spec.ts`, `omp-hybrid.spec.ts`. | **PASS** |
| **S5** | HTML / `<script>` / `<svg onload>` / `<img onerror>` / markdown image auto-fetch in session names, titles, basenames, or transcript text | `baseName` and `projectFields` strip non-`[\p{L}\p{N} ._-]` characters. UI renders via `textContent` / inert DOM helpers (`session-drawer.js`, `activity.js`, `lite.js`, `omp-history.js`); markdown images in OMP conversations are stripped (`#ds-body .msg-body img` count `0`). | `omp-projection.test.mjs`, `omp-files.spec.ts` (`__injected` false), `agents.spec.ts` (`S1/S5/S8` `__ompXss` false). | **PASS** |
| **S6** | OMP event or forged client request attempts Claude control execution (`/api/open`, `/api/tasks`, `/api/accounts/*`, `/rc`, process kill, approval reply) | `capabilitiesFor('omp')` sets all control capabilities to `false` (only `readConversation` can be enabled by server config on a pinned file). `isClaudeRequest` and `resolveForControl` enforce provider ownership server-side (`403 agentReadOnly`). Bridge responses contain only `{ ok, results, resync }`. | `agent-schema.test.mjs`, `agent-compat.test.mjs`, `omp-live-merge.test.mjs` (`S6`), `agents.spec.ts`, `omp-hybrid.spec.ts`. | **PASS** |
| **S7** | Local credential file exposure (Windows DACL / POSIX mode) and cross-host plain HTTP transport | `integrations/omp/private-storage.js` enforces protected directory DACL at birth on Windows (owner, `SYSTEM`, `Administrators` only; ancestor `DELETE`/`DELETE_CHILD`/`WRITE_DAC`/`WRITE_OWNER` checks; reparse/hardlink rejection) and `0700`/`0600` on POSIX. Malformed or `null` stores fail closed. `office-observer.js` refuses non-loopback URLs. | `omp-private-storage.test.mjs` (22/22 PASS), [token remediation report](./phase-04-token-remediation.md). Cross-host realtime transport remains **BLOCKED** by design until an approved authenticated local tunnel is provided. | **PASS** (local) / **BLOCKED** (cross-host) |
| **S8** | Feature disabled (`OFFICE_OMP=off`), adapter `dispose()`, or file exceeding `maxFileBytes` leaves open handles, timers, or stale complete metrics | `OFFICE_OMP=off` creates no adapter/bridge and returns `404` on `/api/omp/*` and `/ingest/omp/v1`. `dispose()` aborts in-flight scans, clears timers, closes handles, and empties maps. Phase 06 hardening in `reader.mjs` resets fingerprint blocks and marks snapshots `incomplete: true` with `unknown` metrics when a file grows past `maxFileBytes` or faults. | `omp-reader.test.mjs` (`F5/F10/F12`), `omp-adapter.test.mjs`, `agents.spec.ts` (`S1/S5/S8`), `benchmark-omp.mjs` (`P0`, `P5`). | **PASS** |
| **S9** | Leakage of `providerPromptCacheKey`, `taskPromptCacheKey`, `credential_pin.hash`, `seanceSource`, `previousSessionFiles`, or unknown fields | `normalize.mjs` and `projection.mjs` construct new objects from explicit field allowlists; unknown record/event properties are dropped. | `omp-normalize.test.mjs` (`S4/S9`), `omp-projection.test.mjs`. | **PASS** |

---

## 3. Phase 06 Scoped Security & Reliability Hardening Applied

1. **`server/agents/omp/paths.mjs`**:
   - Added ASCII DEL (`\x7f`) rejection across `nativeAbsolute`, `validateConfig`, `projectIdentity`, and `containedPath`.
   - Added segment-level validation in `containedPath` rejecting `.` segments, empty segments (`//`), segments ending in space or dot (`/[ .]$/`), and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without extensions) before any filesystem syscall.
   - Canonicalized `projectMappings[].from` by trimming redundant trailing separators.
2. **`server/agents/omp/reader.mjs` & `server/agents/omp/index.mjs`**:
   - When a previously `ready` file grows past `maxFileBytes` / `fingerprint-limit` or encounters a read fault, `reader.mjs` now releases retained block hashes/buffers, marks any existing snapshot `incomplete: true`, and resets `metrics` to `unknown` (`cost: null`) so stale prefix totals cannot masquerade as complete or override live hybrid metrics.
   - When a file recovers from `absent` or `unsupported`, `reader.mjs` resets transient fault diagnostics for the new epoch.
3. **`server/agents/omp/bridge.mjs`**:
   - Bounded `Authorization` header length check (`header.length === 71`) before regex matching.
   - Explicit rejection (`400 invalid-batch` / `400 invalid-json`) for non-object JSON payloads (`null`, primitives), malformed `{"events": ...}` envelopes, and non-iterable request streams.
4. **`tests/unit/omp-private-storage.test.mjs`**:
   - Replaced the remaining `Get-Acl` call in the test assertion helper with `.NET` `[System.IO.Directory]::GetAccessControl` / `[System.IO.File]::GetAccessControl` (matching `private-storage.js`), eliminating a PowerShell module-autoload failure when unit tests run under Git Bash with POSIX-formatted `PSModulePath`.

---

## 4. Residual Risks & Boundaries

- **Same-account code execution**: Filesystem DACLs protect `~/.omp/office-private/*` against other Windows principals (`Users`, `Authenticated Users`, `CodexSandboxUsers`), not against processes already running as the same user account, `SYSTEM`, or `Administrators`.
- **Regex redaction is secondary**: `server/redact.mjs` masks common token/key formats when `conversation: true` is opted in, but cannot guarantee detection of arbitrary custom secret formats; keeping `conversation: false` (the default) is the primary control.
- **Cross-host transport**: Plain HTTP bearer tokens over LAN/NAT are prohibited. Cross-host setups must use `files` mode over a trusted local mount or remain disabled until a dedicated tunnel is approved.
