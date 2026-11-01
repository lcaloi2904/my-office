# Evidence, source map và unanswered questions

Date: 2026-11-01. Scope: `my-office` only. Public upstream docs may describe a newer OMP than the 18.14.1 tested during the prior OMP integration.

## Source code đã khảo sát (VERIFIED in workspace)

| File | Đã xác minh | Tác động |
|---|---|---|
| `server/agents/omp/usage.mjs` | `usageRecord` lấy input/output/cache/cost; `aggregateUsage` giữ nullable và self/inherited; `provisionalUsage` là snapshot. Context window unknown. | Reuse ledger, không giả cost/context |
| `server/agents/omp/normalize.mjs` | JSONL entry có usage/model; live event có model + provisional usage; không có stable OAuth account identity. | Cần provider mapping có bằng chứng |
| `integrations/omp/office-observer.js` | `ctx.sessionManager.getUsageStatistics` đọc tổng token/cost; `ctx.model` hiện chỉ đưa model id. | Extension sẽ chỉ bổ sung safe provider id nếu runtime cung cấp và được duyệt |
| `server/agents/projection.mjs` | Claude legacy `usage`; OMP `usage: null`, `metrics` typed; `agentKind` cô lập | Giữ nguyên legacy; additive projection |
| `server/agents/registry.mjs` | Adapter registry owner Claude/OMP; không phải registry tài khoản OAuth | Quota collector tách khỏi session registry |
| `server/index.mjs` | Claude `planLimits`/`limitsOut`/`fetchPlanUsage`/`othersOut` + SSE `k:'limits'` là Claude-specific | Không trộn OMP vào Claude quota/account switching |
| `src/office/ui/mac-drawer.js` | `liveWindows`/`renderLimits`/`renderOthers` hiện đọc `state.limits` Claude | Additive OMP section; không reuse controls |
| `src/office/ui/session-drawer.js` | Render OMP metrics nullable qua `sessionMetricView` | Reuse metrics view, add provider badges |
| `plans/261030-1754-omp-multi-agent-integration` | Existing G4/Phase05 workstream đang tiếp diễn | Prevent scope collision + maintain Claude regressions |

## Public upstream documentation (DOCUMENTED, not native verified)

- CLI reference: https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md — `usage` and `usage accounts`, JSON output options are documented; CLI's exact schema/availability must be pinned.
- Providers: https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md — OAuth credentials in active OMP profile/broker; multi-account ranking/rotation; provider IDs `openai-codex` and `google-antigravity` are distinct from ordinary APIs.
- Settings: https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md — named profile / env precedence, and `codexResets.autoRedeem` / `claudeResets.autoRedeem`. **Some usage refreshes can trigger consumption of saved resets**; cannot classify arbitrary CLI invocation as side-effect-free.
- Auth broker: https://github.com/can1357/oh-my-pi/blob/main/docs/auth-broker-gateway.md — credential-scoped usage snapshots/cache, account pools and token restrictions. Broker availability and authorization in this environment are UNKNOWN.

## G1 unanswered (stop if critical)

1. Exact Windows native `omp --version`, supported CLI subcommands/JSON schema for this version and whether the current process shares the same `OMP_PROFILE`/`PI_CODING_AGENT_DIR`/broker context as active OMP. Do not read secrets to answer.
2. Can a usage read be proven non-spending? What commands can read cached metadata without triggering saved reset redemption? What happens with default `autoRedeem` and no interactive UI?
3. Are Codex and Antigravity account reports complete (all authenticated accounts, identities, percent meaning, windows, resetsAt, errors)? Are identity-less accounts represented? Does Antigravity return model-bucket limits?
4. Does OMP provide a trustworthy provider ID per request/usage entry, and any trustworthy OAuth identity signal for **session-to-account** attribution during multi-account rotation? If not, account-level token cost remains `unattributed`.
5. Does a broker client see only a restricted pool? Can My Office safely use the broker's sanctioned usage API without bearer credential exposure? If not, use only explicitly approved CLI or unavailable state.
6. Are stored credentials on native Windows and WSL isolated? Which executable launches, and does the process impersonate the same OS user/profile? No assumption that WSL sees Windows OAuth state.
7. Is there any security boundary between local owner and remote/mobile viewers for account identity/quota details? Default to masked details or hide until policy is approved.

## Research status

Public docs/source and My Office code read-only research performed; **no live OMP usage command, auth-store read, Windows CLI probe, runtime test or privacy audit was executed** in this planning turn. Account/source contracts and full CLI JSON examples remain UNVERIFIED.
