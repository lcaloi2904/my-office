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
2. My Office creates one private token per configured source in `data/omp-ingest.json` (not in git). A token only lets
   its producer report sessions of **its own** source `id`.
3. Give the observer, as environment variables of the OMP process:

   | Variable | Meaning |
   | --- | --- |
   | `OFFICE_OMP_TOKEN` | The source's token from `data/omp-ingest.json` |
   | `OFFICE_OMP_SOURCE` | That source's `id` in the config |
   | `OFFICE_OMP_URL` | Optional. Default `http://127.0.0.1:4310/ingest/omp/v1`. Must be plain `http` on a loopback address |

   Without a valid token and source id the observer registers nothing.
4. Load `office-observer.js` as an OMP extension (a factory: `export default (pi) => …`). For one run, without touching any OMP setting: `omp -e /absolute/path/to/office-observer.js`. Permanent install: copy the file to `~/.omp/agent/extensions/office-observer.js` (OMP loads it without `-e`) and put `{ "sourceId": "...", "token": "...", "url": "http://127.0.0.1:4310/ingest/omp/v1" }` in `~/.omp/office-observer.json` (or point `OFFICE_OMP_OBSERVER_CONFIG` at another file). Precedence: factory options, then environment variables, then that file. The installed file is a copy: copy it again after changing the source. To uninstall, delete those two files.

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
package 18.14.0, schema 3). **Whether an installed OMP build emits it, in this order, in each mode is not verified.**
One run on a real OMP (18.14.1, `omp -p`, loaded with `-e`) observed the rows marked **observed**; everything else is untested there, and the unit tests use a fake `pi`.

| OMP event | Reported as | Status |
| --- | --- | --- |
| `session_start` | `session_start` | observed (18.14.1, print mode) |
| `session_switch` (new / resume / fork) | `session_end` for the old, `snapshot` for the new generation | observed (18.14.1, rpc mode) |
| `session_shutdown` | `session_end`, one short best-effort send | observed (18.14.1, print mode) |
| `agent_start` / `agent_end` | `turn_start` / `turn_end` with outcome `unknown` (the event has no outcome; `willContinue` is not a settle) | observed (18.14.1, print mode) |
| `message_end` | usage/idle heartbeat only; the message is never read | declared, emission unverified |
| `tool_execution_start` / `tool_execution_end` | `tool_start` / `tool_end` (category from the tool name, `error` from `isError`) | observed for `read` (18.14.1, print mode) |
| `tool_execution_update` | not used (no partial results) | — |
| `tool_approval_requested` / `tool_approval_resolved` | waiting reason `approval`, keyed by `toolCallId` | observed (18.14.1, rpc, `--approval-mode always-ask`) |
| `plan_review_requested` / `plan_review_resolved` | waiting reason `input`, keyed by `reviewId` | declared; not seen under `--plan-yolo` (18.14.1), emission unverified |
| the `ask` dialog | not an event in the source (a UI method): **unsupported**, shows as active | unsupported |
| `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.getAsyncJobSnapshot()`, `ctx.sessionManager.getSessionId()` | heartbeat/snapshot fields | read defensively; a missing one is simply omitted |
| usage statistics, model | optional, validated numbers/ids only | observed (18.14.1, print mode) |

If a session shows `unknown`, the observer or the heartbeat is missing for it, and My Office says so rather than guessing.

## Windows

The token file is created with mode `0600`, which Windows ignores. The folder's permissions are those of `data/`; whether
only your account can read them has **not been checked**. Only use the loopback address.
