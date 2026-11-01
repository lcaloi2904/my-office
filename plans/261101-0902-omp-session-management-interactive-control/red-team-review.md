# Red-team plan review (inline) — 2026-11-01

Review theo bốn lenses: Security Adversary, Assumption Destroyer, Failure Mode Analyst, Scope & Complexity Critic. **Inline bởi cùng assistant**, không tuyên bố đã spawn 4 agents. Evidence from local source and public API docs; this is plan review, not test evidence.

| ID | Lens | Severity | Evidence | Failure mode | Mitigation accepted |
|---|---|---|---|---|---|
| R01 | Security | Critical | `server/index.mjs:1224-1231,1301` | Loopback request + missing Origin currently accepted by `sameOriginOf`; browser CSRF | Strict Origin/Host/loopback policy on all control state-changing APIs, negative HTTP |
| R02 | Assumption | Critical | `server/agents/omp/lifecycle.mjs:188-194` | Disconnected != terminated; resume could create two writers | Separate owner/lease and no resume on ambiguous liveness |
| R03 | Security | High | `server/agents/omp/bridge.mjs` and `integrations/omp/office-observer.js` | Using telemetry token/ACK for commands expands read-only privilege | Independent opt-in controller and scoped auth, old ingress stays one-way |
| R04 | Failure | High | OMP public `docs/rpc.md` | Ack response is not settled; `open_session` might select newest | Exact session validation, runtime completion tracking, no blind retries |
| R05 | Failure | Critical | OMP public `docs/rpc.md` UI request timeout | Approval dialog default can authorize without user's click | Disable per-kind approval until tested fail-closed, never “always” |
| R06 | Security | High | `AGENTS.md` current safety policy | Repo explicitly prohibits OMP control | Separate user-approved policy exception before G3 code changes |
| R07 | Scope | Medium | `server/agents/omp/index.mjs:459-473` | Existing pin/unpin conflicts with new hide | Visibility store independent; never unpin on hide |
| R08 | Failure | High | `src/office/net/live.js:151-175` | Client-only hide reappears at SSE reconnection | Server-side revisioned hidden policy plus actor filtering |
| R09 | Security | High | `server/agents/schema.mjs` and `server/agents/registry.mjs:56-60` | Turning OMP Claude capabilities true opens Claude task/kill endpoints | Additive OMP control path, unchanged `isClaudeRequest` |
| R10 | Scope/Perf | Medium | `server/agents/omp/lifecycle.mjs` and OMP quota collector | Idle process+poll overhead persists when dashboard closed | Explicit child/queue caps, measured benchmarks and cleanup |
| R11 | Failure | High | OMP public `docs/cli-reference.md` | `--restore` could resume unfinished side effects | Default resume conversation only; no implicit restore |
| R12 | Security | High | `server/index.mjs:2285-2314` | Claude `phoneApprove` could leak OMP decision power | OMP approvals local-only regardless Claude preferences |
| R13 | Security | High | `integrations/omp/office-observer.js:5-6,235-245` | Bubble showing filename/command details from raw tool inputs would violate metadata-only observer policy | Default category-only; verified, explicit local opt-in safe basename; no raw path/args/prompt/thinking in UI/SSE/replay |
| R14 | Failure/perf | Medium | `src/office/people/workers.js:139-167,397-409`; `src/office/interact/place-chips.js:59-107` | Stale detail from old generation, cross-worker label or rapid DOM/layout changes | Identity+sequence+freshness guard, clear on inactive/gap, reuse CSS2D, event coalescing and measured FPS |

## Decision dispositions
All 14 findings **accepted into plan design**; no source code fix in this planning turn. If G1 compatibility reveals unsupported APIs, re-plan the affected capability instead of silently dropping requested features. The external TUI and approval features remain in requested scope, protected behind their own gates.

## Whole-plan consistency sweep
All documents define: hide != unpin != end/kill/delete; stale/disconnected != ended; managed RPC != external TUI; OMP control != Claude task/permission routes; accepted != settled; no remote approval; installed version must be validated; bubble summary never guesses contents, leaks raw data or runs unbounded DOM updates. References to not-yet-existing modules/routes are explicitly **proposed**. No user permission yet to change `AGENTS.md` or install an OMP extension. Tests and runtime smoke are **NOT RUN**.
