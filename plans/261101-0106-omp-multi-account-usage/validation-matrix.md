# Acceptance and validation matrix

All tests here are **PLANNED, NOT RUN**. Use fake/synthetic JSON payloads for first implementation; live OMP tests only after explicit permission. G1–G5 close only on actual evidence (version, command, result and logs redacted).

| ID | Scenario | Expected behavior | Test level / gate |
|---|---|---|---|
| S1 | Feature OFF; no dashboard clients | No OMP usage subprocess, file scan, outbound request, timer or credential lookup | Unit spies + idle smoke; G2 |
| S2 | Windows native profile vs WSL profile; CLI missing | Correct user/profile selection; fail closed + diagnostic, never fall back to another auth store | Preflight G1 + native smoke G5 |
| S3 | Existing OAuth accounts (2 Codex, 3 Agy); same names across profiles | Distinct stable opaque keys `(profile, provider, identity)`; no re-login; no identity mixing | Sanitized fixtures + native consented proof G1/G2 |
| S4 | OAuth expired/revoked, account removed/added, broker pool changes | Explicit `auth-error/absent/unavailable`; stale last-good expires; removed identities disappear | Unit + integration G2 |
| S5 | `usage --json` malformed, huge, partial, slow, fails, exits nonzero | Safe parse cap and schema validation, bounded process, no crash or leaking stderr | Unit/process fake G2 |
| S6 | Usage refresh + banked reset near expiry | No **unapproved** reset spending; if unverifiable, automatic polling DISABLED | Risk gate G1, mock G2, manual opt-in G5 |
| S7 | Multiple quota windows, no pct, remaining-only, reset null/out-of-order/expired | Preserve units and source; derive used vs remaining only when certified; show unknown, never fake 0 | Unit G2/UI G4 |
| S8 | 429/network unavailable, parallel refresh/reconnect, hidden browser | Single-flight, bounded cache/backoff, no storm; fresh/stale/error states | Unit + integration G2/G5 |
| T1 | Same provider across many OMP sessions | Group by provider/model/session without double counting; mixed accounts stay unattributed unless evidence | OMP fixture unit G3 |
| T2 | Provider changes mid-session; model IDs collide across providers | Per-entry provider evidence or unknown, not inferred by arbitrary model prefix | Unit G3 |
| T3 | Legacy null/recorded zero, provisional+file, rewrite/restart, inherited fork | No unknown-to-zero; no double cost, zero is valid; inherited/subtree labelled; source authority respected | Unit G3 |
| T4 | No account identity, account rotates mid-session | Never attribute token spend to account based on current quota or most recently selected identity | Unit G3 |
| U1 | Claude + Codex + Agy, two same-name accounts | Provider/account grouped view, masked identity, appropriate quotas; Claude still intact | E2E G4/G5 |
| U2 | Unsupported quota, no sessions, quota expires, stale after disconnect | Explicit unavailable/unknown/stale and timestamps, no fabricated counters | E2E G4 |
| U3 | Mobile/remote viewer, keyboard, i18n, List/Low Quality | Mask/hide sensitive account labels by policy, no controls, accessible UI | UI E2E G4/G5 |
| R1 | Claude quota / account rotation & browser regression | No new recipient/controls leak; existing tests unchanged | Unit + browser regression G5 |
| R2 | Performance before/after, dashboard closed vs open, 1/5/20 accounts | Compare CPU/RAM/child-process count/refresh frequency; record actual regression budget before acceptance | Controlled native bench G5 |
| R3 | Feature OFF rollback, restart, malformed config | No auth/config mutation; clean shutdown/no leaks; other OMP observer remains working | Integration/native smoke G5 |

## Gate requirements

- **G1:** Exact OMP Windows native version + source/schema proof, safe usage read/autoRedeem risk resolved (or hard-stop), profile and browser privacy decision. No unapproved live credential or reset action.
- **G2:** Collector isolated from Claude + OMP session registry, allowed executable/argv only, no shell/creds, synthetic tests S1–S8 pass.
- **G3:** Per-entry identity/provenance semantics established, T1–T4 pass; `unattributed` is an acceptable truthful result, account-specific tokens are NOT required without evidence.
- **G4:** U1–U3 with masked identity UI, server truth for local vs remote, no accidental account controls.
- **G5:** Full checks actually executed (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, focused Playwright + Claude smoke), approved Windows native smoke, benchmark before/after and docs/rollback. Explicitly mark NOT RUN for missing environments/approvals.

## Benchmark protocol (not an invented target)

On same Windows machine/Node/build/active OMP profile: capture idle server 15 minutes dashboard closed; dashboard open with 1, 5 and 20 accounts (synthetic first), and representative OMP session traffic; record `process.memoryUsage`, OS working set, CPU time, spawned command counts, refresh intervals, Chrome FPS/long tasks where relevant. Measure baseline before code changes and new implementation under equivalent workload; assess any regression explicitly before rollout. Do not claim gains from fixture unit tests or cross-host equivalence from one OS.
