# Acceptance and validation matrix

All synthetic unit, integration, E2E and benchmark scenarios below have been **EXECUTED AND VERIFIED** (2026-11-01). Per `AGENTS.md` §3, automated tests use isolated synthetic fixtures and never touch real `~/.omp` credentials.

| ID | Scenario | Expected behavior | Test level / gate |
|---|---|---|---|
| S1 | Feature OFF; no dashboard clients | No OMP usage subprocess, file scan, outbound request, timer or credential lookup | **PASS** (`omp-usage-collector.test.mjs`, `omp-usage.spec.ts`); G2 |
| S2 | Windows native profile vs WSL profile; CLI missing | Correct user/profile selection; fail closed + diagnostic, never fall back to another auth store | **PASS** (`omp-usage-accounts.test.mjs`, `omp-usage-collector.test.mjs`); G1/G5 |
| S3 | Existing OAuth accounts (2 Codex, 3 Agy); same names across profiles | Distinct stable opaque keys `(profile, provider, identity)`; no re-login; no identity mixing | **PASS** (`omp-usage-accounts.test.mjs`); G1/G2 |
| S4 | OAuth expired/revoked, account removed/added, broker pool changes | Explicit `auth-error/absent/unavailable`; stale last-good expires; removed identities disappear | **PASS** (`omp-usage-accounts.test.mjs`, `omp-usage-collector.test.mjs`); G2 |
| S5 | `usage --json` malformed, huge, partial, slow, fails, exits nonzero | Safe parse cap and schema validation, bounded process, no crash or leaking stderr | **PASS** (`omp-usage-collector.test.mjs`); G2 |
| S6 | Usage refresh + banked reset near expiry | No **unapproved** reset spending; `omp usage --json --no-extensions` proven non-spending in `v18.14.2` | **PASS** (G1 source proof + `omp-usage-collector.test.mjs`); G1/G2/G5 |
| S7 | Multiple quota windows, no pct, remaining-only, reset null/out-of-order/expired | Preserve units and source; derive used vs remaining only when certified; show unknown, never fake 0 | **PASS** (`omp-usage-accounts.test.mjs`, `omp-usage.spec.ts`); G2/G4 |
| S8 | 429/network unavailable, parallel refresh/reconnect, hidden browser | Single-flight, bounded cache/backoff, no storm; fresh/stale/error states | **PASS** (`omp-usage-collector.test.mjs`); G2/G5 |
| T1 | Same provider across many OMP sessions | Group by provider/model/session without double counting; mixed accounts stay unattributed unless evidence | **PASS** (`omp-usage-attribution.test.mjs`); G3 |
| T2 | Provider changes mid-session; model IDs collide across providers | Per-entry provider evidence or unknown, not inferred by arbitrary model prefix | **PASS** (`omp-usage-attribution.test.mjs`); G3 |
| T3 | Legacy null/recorded zero, provisional+file, rewrite/restart, inherited fork | No unknown-to-zero; no double cost, zero is valid; inherited/subtree labelled; source authority respected | **PASS** (`omp-usage-attribution.test.mjs`, `omp-live-merge.test.mjs`); G3 |
| T4 | No account identity, account rotates mid-session | Never attribute token spend to account based on current quota or most recently selected identity | **PASS** (`omp-usage-attribution.test.mjs`, `omp-usage.spec.ts`); G3 |
| U1 | Claude + Codex + Agy, two same-name accounts | Provider/account grouped view, masked identity, appropriate quotas; Claude still intact | **PASS** (`omp-usage.spec.ts`); G4/G5 |
| U2 | Unsupported quota, no sessions, quota expires, stale after disconnect | Explicit unavailable/unknown/stale and timestamps, no fabricated counters | **PASS** (`omp-usage.spec.ts`); G4 |
| U3 | Mobile/remote viewer, keyboard, i18n, List/Low Quality | Mask/hide sensitive account labels by policy, no controls, accessible UI | **PASS** (`omp-usage.spec.ts`); G4/G5 |
| R1 | Claude quota / account rotation & browser regression | No new recipient/controls leak; existing tests unchanged | **PASS** (`agent-compat.test.mjs`, `omp-usage.spec.ts`); G5 |
| R2 | Performance before/after, dashboard closed vs open, 1/5/20 accounts | Compare CPU/RAM/child-process count/refresh frequency; record actual regression budget before acceptance | **PASS** (`reports/validation.md`); G5 |
| R3 | Feature OFF rollback, restart, malformed config | No auth/config mutation; clean shutdown/no leaks; other OMP observer remains working | **PASS** (`omp-usage-collector.test.mjs`, `omp-usage.spec.ts`); G5 |

## Gate requirements

- **G1 (CLOSED — PASS SAFE):** Exact OMP Windows native version (`18.14.2`, commit `7efd77219374ca4e8767979809835e4aa90666ba`) + source/schema proof, safe usage read (`omp usage --json --no-extensions` never runs `AgentSession` or `resets.redeem`), profile and browser privacy decision verified.
- **G2 (CLOSED — PASS):** Collector isolated from Claude + OMP session registry, allowed executable/argv only, no shell/creds, synthetic tests S1–S8 pass.
- **G3 (CLOSED — PASS):** Per-entry identity/provenance semantics established, T1–T4 pass; `unattributed` account attribution enforced.
- **G4 (CLOSED — PASS):** U1–U3 pass with masked identity UI, server truth for local vs remote, no accidental account controls.
- **G5 (CLOSED — PASS):** `eslint .`, `tsc --noEmit`, 218/218 unit tests, `next build`, Playwright `omp-usage.spec.ts`, R2 benchmark, and docs/rollback completed (see [reports/validation.md](./reports/validation.md)).

## Benchmark protocol (not an invented target)

On same Windows machine/Node/build/active OMP profile: capture idle server 15 minutes dashboard closed; dashboard open with 1, 5 and 20 accounts (synthetic first), and representative OMP session traffic; record `process.memoryUsage`, OS working set, CPU time, spawned command counts, refresh intervals, Chrome FPS/long tasks where relevant. Measure baseline before code changes and new implementation under equivalent workload; assess any regression explicitly before rollout. Do not claim gains from fixture unit tests or cross-host equivalence from one OS.
