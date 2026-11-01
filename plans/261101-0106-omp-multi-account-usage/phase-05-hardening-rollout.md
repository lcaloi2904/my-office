---
title: "Phase 05: Security, regression, performance and rollout"
status: done
priority: P1
effort: "0.75-1 day"
dependencies: [4]
---

# Phase 05 — Hardening và rollout opt-in

## Objective

Đóng G5 dựa trên kiểm thử thực tế, chứng minh **không phá Claude và không tác động OMP account state**, đo hiệu năng, cập nhật docs rồi mới cân nhắc enable opt-in mặc định. Không gộp G5 của tính năng này với G5 của OMP Phase 05 kế hoạch cũ.

## Test & evidence work

1. **Security negative tests**: giả lập executable bị thay/symlink, stdout JSON độc hại/vượt cap, env secrets, stderr token leak, arbitrary CLI args, tool output HTML injection, remote unauthorized viewer, brute-force account identity guessing. Không cho đọc `agent.db` hoặc gọi endpoint provider bằng credential từ My Office.
2. **Account transitions**: add/remove account, same email different workspace, refresh expired, individual account 401/429, OMP auth broker limited pool, profile switching/restart, multiple concurrent viewers; verify cache and identity map don't cross-contaminate.
3. **Side effect verification**: prove no `login`/`logout`/`usage reset`/`invalidate`/auto redeem initiated by dashboard and no OMP config mutation. If CLI usage refresh can spend banked resets under user config, default OFF must remain; any workaround needs explicit user choice, **not silent policy mutation**.
4. **Session integrity**: file-only/hybrid, change provider/model mid-session, agent restart/rewrite/fork, inherited history, duplicate/live merge, no account identity, missing cost; verify no false attribution/NaN.
5. **Claude regression**: quota, account switching, server registry, activity rail, drawer, task/chat controls, SSE reconnect and existing browser suite. Preserve uncommitted Phase 05 changes, keep controls server-authorized.
6. **Windows-native validation** on exact host/profile; smoke with 0, 1 and several authenticated accounts if consented; WSL2 mismatch case is an explicit diagnostic, not generic success.
7. **Performance**: benchmark before/after with dashboard closed, 1/5/20 account fixtures, active OMP. Measure process RSS/CPU, subprocess invocations, refresh latency, memory cache, browser long tasks, 3D FPS; compare on same platform/build. No fixed improvement claim without data.
8. **Docs/rollback**: update `README.md`, `README.vi.md`, `integrations/omp/README.md`, architecture/ops notes and config descriptions if implementation touched them. Explain OMP login reuse, profile selection, masking, unsupported account fields, opt-in flags and known limitations; rollback by disabling OMP usage feature without deleting any OMP source/auth data.

## Candidate files (after approval)

| Action | File | Role |
|---|---|---|
| Create/modify | `tests/unit/omp-usage-*.test.mjs` | Synthetic security/provider/account regression |
| Create/modify | `tests/e2e/omp-usage.spec.ts`, existing `tests/e2e/agents.spec.ts` | Live UI, mixed agent and Claude regression |
| Modify | `README.md`, `README.vi.md`, `integrations/omp/README.md` | Setup/privacy/perf/rollback |
| Create | `plans/261101-0106-omp-multi-account-usage/reports/validation.md` | Measured evidence + known exceptions |
| Modify only if necessary | `start-office.cmd` | Opt-in environment on Windows native; not silently enabled |

## Rollout strategy

- G1 hard-stop if no safe quota-read mechanism. Feature OFF; existing OMP sessions/observer remain operational.
- Stage A: fake fixture unit/integration on same repo, no account read.
- Stage B: local opt-in with sanitized debug diagnostics and explicit user approval, 1 native Windows account/profile; no remote projection.
- Stage C: multi-account/profile smoke and browser tests, Claude regression; expand only to providers with validated data.
- Stage D: roll out under feature flag, document rollback. If no account ID signal is available for session usage, keep provider totals and the `unattributed` bucket indefinitely rather than inferring incorrectly.
- Never auto-enable feature across unknown OMP installations, silently install an OMP extension, or change account policies.

## Test commands — after user approval ONLY

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:smoke
npx playwright test tests/e2e/agents.spec.ts tests/e2e/omp-usage.spec.ts
```

Add focused tests using Node `node --test` when files exist. Browser test configuration may require Windows-native command wrappers; report commands actually run, environment/flags, results and defects. Do not redefine expected assertions as a workaround.

## G5 acceptance

- [x] G1–G4 passed with evidence; R1–R3 and U1–U3 passed or recorded as explicit blockers.
- [x] No OAuth login re-prompt for valid existing OMP credentials; no secret/credential duplication, account mutation, saved-reset spending, or provider usage API scraping from My Office.
- [x] Exactly per-account quota where available and exactly per-provider session tokens where recorded; unknown account attribution remains unknown.
- [x] Idle mode no polling/child processes; memory and CPU regression documented with before/after measurements.
- [x] Windows native tested; Claude regression verified; unsupported platforms marked NOT RUN.
- [x] Documentation and rollback confirmed; user approves next rollout level. No commit/push by default.

## Stop & rollback

Any unexpected reset redemption, auth store write, credential leak, duplicate account collision, false spend attribution, corrupt source history, or serious idle resource regression **halts rollout**. Disable OMP usage feature, terminate collector timers/processes, leave OMP/Claude sessions and credentials untouched. Revert only scoped source after explicit approval; never reset/rewrite other user's dirty work.

## Todo

- [x] Security/side-effect negative tests + account lifecycle cases
- [x] Claude/mixed UI and native Windows smoke with permission
- [x] Before/after CPU/RAM/child-process benchmark
- [x] Docs, rollback, validation report and G5 approval
