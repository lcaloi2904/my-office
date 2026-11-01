# OMP observer for My Office

`office-observer.js` lets a running OMP report which sessions are open and what they are doing, so My Office can show
them as **live, read-only** rows next to the saved-history ones. It is optional, off by default, and never installed by
this repository.

It reports only: session ids, tool categories (`read`, `edit`, `cmd`, `web`, `other`), counts, waiting reasons and a
usage snapshot. It never sends prompts, answers, tool arguments or results, file paths, environment or credentials, and
it cannot receive anything that makes OMP do something. Approvals, killing, prompting and accounts stay with OMP.

## What you have to decide first

Nothing here is switched on for you. Copying the file into an OMP extensions folder or editing OMP's settings changes
OMP's own configuration, so it is yours to approve and to undo.

1. Start My Office with `OFFICE_OMP=hybrid` and `OFFICE_OMP_CONFIG=<absolute path to omp-config.json>`. The config is the
   same one used for saved history (`version`, `sources[]` with an `id`, `root`, `pathStyle`). Without a config, hybrid
   reads nothing.
2. My Office stores source-bound telemetry tokens in `~/.omp/office-private/ingest.json`. Its parent `.omp` must already exist. `OFFICE_OMP_INGEST_FILE` may select another **absolute, private** file, for example for an isolated test server; it does not bypass storage checks. There is no fallback to the old repository `data/omp-ingest.json`.
3. Give the observer, as environment variables of the OMP process:

   | Variable | Meaning |
   | --- | --- |
   | `OFFICE_OMP_TOKEN` | The source's telemetry token from the private receiver store |
   | `OFFICE_OMP_SOURCE` | That source's `id` in the config |
   | `OFFICE_OMP_URL` | Optional. Default `http://127.0.0.1:4310/ingest/omp/v1`. Must be plain `http` on a loopback address |

   Without a valid token and source id the observer registers nothing.
4. Load `office-observer.js` as an OMP extension (a factory: `export default (pi) => …`). Keep `private-storage.js` alongside it. For one run: `omp -e /absolute/path/to/office-observer.js`.

   For a permanent install, create a private `~/.omp/agent/extensions/office-observer/` directory, copy `private-storage.js` there first, then copy `office-observer.js` as `index.js`. OMP's native directory discovery recognizes `index.js`; the helper is not a standalone extension. The installed package is a copy: update **both** files together.

   Store `{ "sourceId": "...", "token": "...", "url": "http://127.0.0.1:4310/ingest/omp/v1" }` privately in `~/.omp/office-private/observer.json` (or use an absolute `OFFICE_OMP_OBSERVER_CONFIG`). Precedence remains factory options, environment, then that file. Neither component reads `~/.omp/office-observer.json` anymore.

   Use `preparePrivateFile(file, { createDirectory: true })` from `private-storage.js` to create a private leaf directory at birth and `writePrivateJson(file, value)` for private atomic updates; do not first create a permissive folder or ordinary token-bearing temporary file. Unsafe existing paths/permissions fail closed and are not automatically repaired. Do not paste tokens into chat or logs.

   Rotation requires updating the receiver and observer together while the receiver is stopped or restarted with the new credential. Already-loaded factories retain their old token; replacing files does not hot-reload them. Keep working OMP agents running, and load the updated observer in a fresh process when convenient. An old binding may stop telemetry after a 401 without affecting agent work.

   To uninstall, remove the installed package and the observer settings file; leave receiver credentials alone if another approved observer still uses them.

To undo it: remove the extension and the two variables. Stopping My Office, or `OFFICE_OMP=files`/`off`, closes the
ingress; OMP carries on as before. The saved files are never written.

## How it behaves

- Handlers copy a few fields into a bounded queue (64 events / 48 KiB) and return at once. Sending happens on its own
  timer with a timeout, backoff with jitter, and one request at a time. If My Office is offline, slow or refusing, events
  are kept for a short while and then replaced by one snapshot. A refusal (401/403/404) stops the producer for good.
- Each session switch, resume or fork is a new *generation*; the old one is ended under its own identity and a late event
  from it cannot change the new one. Every event has a sequence number, so a retry is harmless and a gap is visible.
- Liveness comes from heartbeats (every 10 s) judged by **My Office's** clock: no heartbeat for 30 s shows as stale, 90 s
  as disconnected. Neither is ever shown as finished.
- Sub-agents (`ctx.agent.kind === "sub"`) are not reported in this version.
- Acknowledgements mean "applied in My Office's memory". They are not durable: if My Office restarts, the next snapshot
  restores what is true now, and the saved file restores history and recorded usage. Runtime usage is a provisional
  snapshot and is replaced by the file's recorded numbers, never added to them.

## Support matrix

"Declared" means the event exists in the OMP source this was written against (`6a86df8539fccf3ad7818081266e554022fc21bc`,
package 18.14.0, schema 3). Emission is verified only for the exact build, mode and scenario recorded below; unit tests use a fake `pi`.
The [18.14.1 report](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-implementation.md) covers prior print/RPC runs. The [18.14.2 local validation](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-local-validation.md) uses the actual installed TUI with a scripted loopback model, not external inference.

| OMP event | Reported as | Status |
| --- | --- | --- |
| `session_start` | `session_start` | observed (18.14.1 print; 18.14.2 TUI) |
| `session_switch` (new / resume / fork) | `session_end` for the old, `snapshot` for the new generation | observed (18.14.1, rpc mode) |
| `session_shutdown` | `session_end`, one short best-effort send | observed (18.14.1 print; 18.14.2 dedicated TUI runs); not guaranteed delivery |
| `agent_start` / `agent_end` | `turn_start` / `turn_end` with outcome `unknown` (the event has no outcome; `willContinue` is not a settle) | observed (18.14.1 print; 18.14.2 TUI) |
| `message_end` | usage/idle heartbeat only; the message is never read | observed (18.14.2 TUI, scripted model); not genuine provider accounting proof |
| `tool_execution_start` / `tool_execution_end` | `tool_start` / `tool_end` (category from the tool name, `error` from `isError`) | observed for read (18.14.1 print); read/write/ask/task (18.14.2 TUI) |
| `tool_execution_update` | not used (no partial results) | — |
| `tool_approval_requested` / `tool_approval_resolved` | waiting reason `approval`, keyed by `toolCallId` | observed (18.14.1, rpc, `--approval-mode always-ask`) |
| `plan_review_requested` / `plan_review_resolved` | waiting reason `input`, keyed by `reviewId` | observed (18.14.2 TUI, manual `/plan-review`, local execute selection): waiting/input clears to idle before session switch; continuation/cancellation not verified |
| the `ask` dialog | **unsupported** exact waiting state; shows as active | actual built-in dialog answered successfully in 18.14.2 TUI; observer active/empty waits while pending |
| `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.getAsyncJobSnapshot()`, `ctx.sessionManager.getSessionId()` | heartbeat/snapshot fields | read defensively; a missing one is simply omitted |
| usage statistics, model | optional, validated numbers/ids only | observed (18.14.1, print mode) |
| task child callbacks | deliberately not reported | actual child identity/parent/completion and exclusion observed (18.14.2); live child/advisor reporting remains unsupported |

If a session shows `unknown`, the observer or the heartbeat is missing for it, and My Office says so rather than guessing.

## Windows

`0600` alone does not enforce a private Windows DACL. `private-storage.js` creates the private leaf directory with a protected DACL at creation: only the runtime account, SYSTEM and Administrators. New temporary files inherit that boundary, are created exclusively in the same directory, flushed and atomically renamed. Existing directories/files and their ancestor ownership, deletion/ACL-takeover rights, reparse points and hardlinks are checked before access. TrustedInstaller is accepted only on ancestors, not inside the private boundary. The Unix path requires private modes/ownership and stable ancestry.

Only a missing file or an absent configured-source key provisions credentials. Malformed JSON, JSON `null`, invalid existing configured-source tokens, unsafe permissions or inaccessible storage fail closed; ingress stays unavailable while file-only observation can continue. Observer settings failures disable telemetry rather than affecting the agent.

The [01/11/2026 remediation](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-token-remediation.md) replaced the previously exposed local files with private storage and rotated the telemetry credential. The old token is rejected; no unrelated home/repository/`.omp` ACLs were reset. The [earlier ACL inspection](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-local-validation.md#windows-acl--confirmed-policy-failure) remains historical evidence, not the current disk state.

Keep loopback-only. This filesystem boundary does not defend against the runtime account, administrators, SYSTEM or executable code already running as that account. A locked Windows reader can make atomic replacement fail safely; close that reader before retrying manually, never overwrite/unlink as a fallback. G4 remains open for its separate outstanding runtime/cross-host requirements.
