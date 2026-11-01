# Evidence — OMP Session Management & Interactive Control (2026-11-01)

## VERIFIED — current local source

| Ref | Grounded file/area | Finding |
|---|---|---|
| E01 | `server/agents/omp/lifecycle.mjs:6-8,188-194` | 30s stale, 90s disconnected, retained runtime ~15m; disconnected != process exit |
| E02 | `server/agents/omp/index.mjs:35-50,403-473` | File/live merge and pin/unpin, `unpinnedLive`; no independent user hide preference |
| E03 | `server/index.mjs:2358-2367,2707-2711` | OMP pin & catalog endpoints local-only; no native launcher/interactive control |
| E04 | `src/office/ui/omp-history.js:18-47` | Pin/unpin historical entries; history list, not resume |
| E05 | `src/office/ui/session-drawer.js:89-105` | OMP read-only note and unpin for persistedOnly, no compose/actions for disconnected live |
| E06 | `src/office/ui/activity.js` and `src/office/net/live.js:151-175` | Sidebar grouped unknown, actors on session snapshots, client remove alone returns via SSE |
| E07 | `server/agents/schema.mjs`, `server/agents/registry.mjs` | Claude controls isolated; OMP permissions false; opaque IDs; controls require separate authority |
| E08 | `integrations/omp/office-observer.js`, `server/agents/omp/bridge.mjs` | Bounded one-way telemetry extension/ingress, cannot be bidirectional command API |
| E09 | `server/index.mjs:1224-1231,1301` | Loopback checks exist; `sameOriginOf` accepts missing Origin; new writes require stricter policy |
| E10 | `server/index.mjs:2285-2314` and `src/office/ui/permissions.js` | Claude permission UI and possible phone approvals; cannot reuse for OMP without new policy |
| E11 | `docs/OMP-INTEGRATION.md`, `integrations/omp/README.md` | OMP off/files/hybrid observer and account usage distinct, native Windows behavior documented |
| E12 | `AGENTS.md` | Explicit OMP read-only restriction; plan does not override until explicit implementation approval and policy change |
| E13 | `tests/unit/omp-*.test.mjs`, `tests/e2e/agents.spec.ts`, `tests/e2e/omp-files.spec.ts`, `tests/e2e/omp-hybrid.spec.ts` | Tests for prior observer/files/usage; future control tests must be new |
| E14 | `src/components/office/SessionRail.tsx` | Static React rail shell; dynamic UI via `src/office` plain JS |
| E15 | `plans/261030-1754-omp-multi-agent-integration/plan.md`, `plans/261101-0106-omp-multi-account-usage/plan.md` | Existing workstreams; overlaps requiring re-scout before cook |

## VERIFIED — current activity bubble baseline and limitations

| Ref | Source | Finding |
|---|---|---|
| E16 | `src/office/people/workers.js:139-167,317-324,397-409` | OMP `observeActor()` currently always calls `w.say(...unknownLabel(s))`, `Worker.say()` already uses CSS2DObject and truncates root text to 80 chars |
| E17 | `src/office/interact/place-chips.js:59-107`; `src/styles/labels.css:16-35` | Existing bubble collision, layer priority and cached dimension measurements; reuse, not rebuild |
| E18 | `src/office/ui/activity.js:106-108`; `src/office/ui/event-text.js:91-107,119-124` | OMP sidebar remains generic, streamer mode can mask text-bearing labels |
| E19 | `integrations/omp/office-observer.js:5-6,235-245`; `server/agents/omp/lifecycle.mjs:20-27` | Observer emits only category and tool IDs, lifecycle exposes `toolCategories`: cannot know filename/test/command detail by default |

## DOCUMENTED upstream — NOT installed-version verified

- RPC JSONL protocol and commands/status (including `prompt`, `steer`, `follow_up`, `abort`, `get_state`): https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md
- CLI `--mode rpc`, `--resume` / `--continue` / `--restore`, `--profile` and session selection: https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md
- OMP extension factories, events, message APIs: https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md
- Session metadata/selection: https://github.com/can1357/oh-my-pi/blob/main/docs/session-operations-export-share-fork-resume.md

Do not assume `open_session` is exact historical selection or that `--restore` is safe from unfinished-work side effects. G1 verifies installed binary; uncertain APIs remain disabled. Source snapshot read-only integration reports native OMP 18.14.2 validation, but current installed build/profile may differ and has not been reprobed in this turn.

## UNVERIFIED / requires explicit approval

- Native Windows `omp` executable path, exact active version/dialect and profile-specific command semantics; no live command was run.
- Reliable resume without concurrent writers across two processes / external TUI.
- Whether external TUI supports injected steer/follow-up/abort in initialized extension without hijacking native prompts.
- Per-kind tool/plan/ask approval response semantics and non-allow timeout defaults.
- Multi-session performance and resource consumption of idle controller.
- Whether installed OMP RPC or TUI extension safely exposes a sanitized basename or test label for explicit local-only opt-in.
- Native Windows FPS and CSS2D DOM/layout impact under frequent bubble activity and 2/8/32/64 workers.
- Whether session `bhx` from screenshot has exited: screenshot only proves UI disconnected; no OS process observation.

## Git baseline at planning scout

Workspace `my-office`, root `/mnt/e/vide-code/my-office`, branch `main` HEAD `70d455a`, 2026-11-01. Pre-existing modifications **not touched**: `server/agents/omp/usage-accounts.mjs`; `src/office/ui/omp-usage-panel.js`; `src/styles/topbar-plan.css`; `src/styles/topbar.css`; `tests/unit/omp-usage-accounts.test.mjs`. Only plan documents created/updated. All tests for proposed code **NOT RUN**.

## Evidence standard for future gates
Each G1–G7 report must say VERIFIED / DOCUMENTED / UNKNOWN / NOT RUN for each claim, with exact git commit, OS, Node and OMP version, command, result and source fixture vs real process. No gate automatically closes from planning text.
