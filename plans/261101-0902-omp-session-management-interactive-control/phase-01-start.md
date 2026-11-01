---
phase: 1
title: "Compatibility baseline, runtime contracts và security approval gate"
status: in-progress   # G1 UNVERIFIED: cần duyệt chạy omp --version/RPC smoke + ngoại lệ AGENTS.md
priority: P1
effort: "2-3 dev-days"
dependencies: []
---

# Phase 01 — Baseline, compatibility, design gate

## Goal
Xác định **chính xác** các năng lực native Windows OMP hiện có, ranh giới ownership, context/sessions và chính sách bảo mật trước khi cấp bất cứ quyền write/control nào.

## Entry / permissions
- Workspace `my-office` verified bằng `workspace_list`; kiểm tra `git status`, giữ dirty files; không cài packages, launch OMP hoặc model-backed call khi chưa duyệt riêng. Phase 01 mặc định chỉ đọc source/docs/test fixtures.
- Current `AGENTS.md` cấm control OMP. Gate này lập đề xuất exception opt-in, **không** tự sửa policy. Mọi live OMP runtime probe, extension install, real profile access hoặc agent call cần approval tường minh.
- Read `docs/OMP-INTEGRATION.md` + `integrations/omp/README.md` + OMP version-documented protocol; không đọc `~/.omp` private token/config/session files trực tiếp. Không đọc `env/*.env` hoặc ` .env`.

## Files — plan/report only
| Action | Path | Purpose |
|---|---|---|
| Create | `plans/261101-0902-omp-session-management-interactive-control/reports/g1-compatibility-security.md` | Versioned evidence, decision register |
| Modify | `plans/261101-0902-omp-session-management-interactive-control/design-contracts.md` | Freeze API/ownership/transport choice after approval |
| Modify | `plans/261101-0902-omp-session-management-interactive-control/validation-matrix.md` | Concrete verified runner/acceptance |
| Inspect only | `server/agents/schema.mjs`, `server/agents/registry.mjs`, `server/agents/omp/{index,lifecycle,bridge}.mjs`, `integrations/omp/office-observer.js`, `server/index.mjs` | Verify current boundaries |
| Inspect only | `src/office/ui/{activity,omp-history,session-drawer,permissions}.js`, `src/office/net/live.js`, `tests/unit/omp-*.test.mjs` | Reuse paths/regressions |

## Tasks
1. Refresh Git baseline/head/diff + repo instructions; identify overlapping workstream changes before any edit and capture exact file ownership.
2. Establish platform matrix native Windows OMP and WSL; use public docs `rpc.md`, `cli-reference.md`, `extensions.md`; identify commands `get_state`, `new_session`, `switch_session`, `open_session`, `prompt`, `steer`, `follow_up`, `abort`, `extension_ui_request`. Tag DOCUMENTED vs INSTALLED-VERIFIED.
3. Pin exact OMP binary/version/argv/output parser, profile and session-ID rules without reading OAuth credentials. A real isolated RPC smoke requires additional user approval; never infer installed semantics from upstream `main`.
4. Map approved project/worktree roots and sourceNamespace (Windows path style, no junction/symlink); reason about ownership conflicts, session resume semantics and wrong-session risks. Never expose raw cwd/path to client.
5. Threat-model HTTP strict loopback + Origin/Host, CSRF/DNS rebinding, control token boundary, prompt privacy, replay/duplicate commands, "abort" vs kill, approval timeout defaults.
6. Freeze capability matrix for managed/external/history by exact version, decide feature flags OFF, restart policy, projection merge and shutdown semantics. Review alternatives (native RPC vs extension TUI vs CLI spawn per prompt) and select the least-coupled path.
7. Identify which `AGENTS.md` read-only clauses must change **only after later user approval** and document explicit exception scope; keep Claude routes and observer ingest immutable.
8. Prepare cost-free isolated fixtures/synthetic tests, command contracts and staged rollout with stop/rollback procedures.

## Gate G1 / acceptance
- [ ] VERIFIED source map and exact installed-version support matrix; incompatible features marked disabled, never fabricated.
- [ ] Single-owner session resume rule and no duplicate writer strategy reviewed; no unsafe guess using PID/mtime.
- [ ] Strict Origin/local-only and independent control auth/security boundaries agreed; telemetry separate.
- [ ] Native Windows CLI process and external TUI bridge feasibility separately evidenced or labeled UNKNOWN.
- [ ] Decision register explicitly names scope needing user approval; no code or settings changed without approval.

## Verification (read-only first; no model calls)
- `git status --short` / `git diff --name-only` / scoped source inspection.
- `/home/harness/.local/bin/ak plan validate ./plans/261101-0902-omp-session-management-interactive-control` (plan format only).
- After additional explicit consent: isolated `omp --version` and no-model RPC protocol probe with temporary **task-owned** fixture, document OS/runtime and clean only fixture.
- **NOT** a PASS solely from upstream docs or fake fixture. No runtimes are started in the planning turn.

## Risks / stop / rollback
Installed OMP differs from docs, wrong identity mapping, missing safe approval API, foreign runtime owner, policy conflict → **STOP**, leave OMP read-only and re-plan affected phases. No rollout. Phase 01 report indicates PASS/FAIL/UNVERIFIED with evidence before Phase 02/03.
