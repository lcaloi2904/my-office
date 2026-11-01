# OMP Integration Guide (Read-Only Observability)

My Office can optionally observe [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) sessions alongside Claude Code on the same office floor, session rail, List Mode, and timeline.

The integration is **off by default**, **strictly read-only**, and **local-only**:
- My Office never writes, migrates, or deletes OMP session transcripts, settings, or profiles.
- Dashboard controls (prompting, tool/plan approvals, process stop/kill, account switching, `/rc`, and "Give work" tasks) remain exclusively for Claude Code.
- OMP sessions, pinned history, and conversations are visible only to browsers on this computer (`127.0.0.1`), never streamed to phones/LAN/Cloudflare tunnels, and never recorded into `data/replay/*.jsonl`.

---

## 1. Rollout Modes & Environment Flags

| Variable | Default | Description |
| --- | --- | --- |
| `OFFICE_OMP` | `off` | `off`: zero OMP reads, timers, or routes. `files`: read-only saved session observer. `hybrid`: `files` + loopback live telemetry ingress (`POST /ingest/omp/v1`). |
| `OFFICE_OMP_CONFIG` | *(empty)* | Required for `files` and `hybrid`. Absolute native path to the versioned JSON configuration file. |
| `OFFICE_OMP_INGEST_FILE` | `~/.omp/office-private/ingest.json` | Optional override for `hybrid` receiver credentials. Must be an absolute path passing `private-storage.js` DACL/mode checks. |

Recommended rollout sequence:
1. Keep `OFFICE_OMP=off` until an explicit `omp-config.json` is prepared.
2. Enable `OFFICE_OMP=files` first and verify `GET /api/doctor` reports `effectiveMode: "files"` and `sources[].state: "ok"`.
3. Optionally enable `OFFICE_OMP=hybrid` after provisioning private observer credentials and loading the companion extension into OMP.

---

## 2. Configuration (`omp-config.json`)

My Office performs no automatic home, XDG, or profile discovery. Every observed directory must be listed explicitly in `omp-config.json` (maximum 64 KiB, up to 8 sources):

```json
{
  "version": 1,
  "sources": [
    {
      "id": "workstation-main",
      "root": "C:\\synthetic\\omp-sessions",
      "pathStyle": "win32",
      "conversation": false,
      "projectMappings": [
        {
          "from": "C:\\synthetic\\projects\\repo-a",
          "projectId": "repo-a",
          "worktreeId": "main",
          "localRoot": "C:\\synthetic\\projects\\repo-a"
        }
      ]
    }
  ],
  "limits": {
    "maxPins": 8,
    "pollMs": 2000,
    "reconcileMs": 60000
  }
}
```

### Configuration Rules
- `root`: Native absolute directory path with no symlinks or Windows junctions in its ancestor chain. Opened strictly read-only (`O_RDONLY | O_NOFOLLOW`).
- `pathStyle`: `"win32"` or `"posix"`, matching the path format written into `session.cwd` by the OMP process that produced the transcripts.
- `conversation`: Defaults to `false` (metadata-only). Set to `true` only for sources where on-demand local transcript viewing in the session drawer is desired.
- `projectMappings`: Maps `session.cwd` prefixes (longest-prefix match) to `projectId` and `worktreeId`. Cross-source or Claude+OMP desk grouping occurs **only** when `localRoot` is configured and verified via canonical Git common-directory/worktree identity (`server/git.mjs`); equal basenames never merge projects automatically.
- `limits`: Optional overrides that may only lower the built-in ceilings (`maxSessions: 2048`, `maxPins: 8`, `maxDepth: 5`, `scanEntries: 1024`, `maxDirectories: 1024`, `maxFileBytes: 8388608` [8 MiB], `maxLineBytes: 65536` [64 KiB], `chunkBytes: 32768`, `bytesPerTick: 131072`, `maxEntries: 4096`, `maxIndexBytes: 1048576`, `pollMs: 2000`, `reconcileMs: 60000`, `ttlMs: 900000`).

---

## 3. Support Matrix

### 3.1 Schema & Runtime Versions
The decoder targets OMP session schema **v3** (source reference `6a86df8539fccf3ad7818081266e554022fc21bc`, package `18.14.0`). Unknown schema versions (`v1`, `v2`, `v999`) are marked `unsupported` without crashing the server or affecting Claude Code.

| OMP Capability / Event | `files` Mode | `hybrid` Mode | Verification Status |
| --- | --- | --- | --- |
| Saved session catalogue & pins (`<= 8` pins) | Supported (`persistedOnly: true`, `liveness: unknown`) | Supported (merges with live runtime by `sessionKey`) | **VERIFIED** (synthetic + Windows NTFS real layout) |
| Optional 256-byte UTF-8 title slot & `activeLeafId` branch selection | Supported | Supported (via file authority) | **VERIFIED** |
| Persisted task children (`<stem>/<child>.jsonl` with `session_init.task`) | Supported (`historical`, capped at 128/root) | Supported via file discovery; live child callbacks excluded | **VERIFIED** (18.14.2 TUI + synthetic) |
| `session_start`, `session_shutdown`, `agent_start`, `agent_end` | N/A | Supported | **VERIFIED** (18.14.1 print/RPC, 18.14.2 TUI) |
| `session_switch` (`new` / `resume` / `fork`) | Lineage preserved (`fork` / `continuation`) | Old generation ended, new generation started | **VERIFIED** (18.14.1 RPC + unit) |
| `tool_execution_start` / `tool_execution_end` | Reconstructed from persisted `toolCall`/`toolResult` | Realtime pending set keyed by `toolCallId` | **VERIFIED** (`read`, `write`, `ask`, `task`) |
| `tool_approval_requested` / `tool_approval_resolved` | N/A | `waiting` (`waitReasons: ["approval"]`) | **VERIFIED** (18.14.1 RPC `--approval-mode always-ask`) |
| `plan_review_requested` / `plan_review_resolved` | N/A | `waiting` (`waitReasons: ["input"]`) → `idle` | **PARTIAL** (18.14.2 TUI manual `/plan-review` execute verified; Escape cancellation & automatic continuation **NOT VERIFIED**) |
| Built-in `ask` dialog waiting state | N/A | **UNSUPPORTED** (renders as `active`, empty `waitReasons`) | Observed limitation on 18.14.2 TUI |
| Live subagent (`ctx.agent.kind === "sub"`) & advisor streaming | Persisted task children only; advisor **UNSUPPORTED** | **UNSUPPORTED** (deliberately excluded by observer) | Observed exclusion on 18.14.2 |

### 3.2 Platform & Cross-OS Topology Matrix

| Topology | `files` Mode | `hybrid` Mode | Status & Constraints |
| --- | --- | --- | --- |
| **Same-Windows** (OMP on Windows, My Office on Windows) | Supported | Supported (`127.0.0.1`) | **VERIFIED** on Windows 11 (`10.0.26200` x64, Node `24.22.1`, NTFS symlinks/junctions/DACLs, Chromium D3D11). |
| **Same-WSL / Linux** (OMP on Linux/WSL, My Office on same Linux/WSL) | Supported | Supported (`127.0.0.1`) | **PARTIAL** (POSIX path containment and `0700`/`0600` storage rules unit-tested; full browser/runtime suite not re-executed inside Linux/WSL in Phase 06). |
| **Cross-OS Windows ↔ WSL (`files`)** | Degraded / File-only | Blocked (falls back to `files`) | **NOT VERIFIED LIVE**. Requires local mount passing `approveRoot`/`containedPath` without symlinks/junctions and matching `pathStyle`. Cross-OS PID namespaces are never probed. |
| **Cross-host / LAN / NAT (`hybrid`)** | N/A | **BLOCKED / UNSUPPORTED** | `office-observer.js` and `/ingest/omp/v1` enforce loopback (`127.0.0.1`, `localhost`, `::1`). Bearer tokens are never sent over plain HTTP across non-loopback interfaces. |

---

## 4. Privacy, Retention & Usage Provenance

1. **Metadata Allowlist**: Public session projections include only opaque `id`/`sessionKey`, sanitized project basename (`[\p{L}\p{N} ._-]`, max 40 chars), opaque `projectKey`/`worktreeKey`, `lifecycle`/`activity`/`connection`/`lastTurnOutcome`, tool category counts (`read`, `edit`, `cmd`, `web`), model ID, and validated `metrics`. Prompts, titles, tool arguments/outputs, reasoning, file paths, `credential_pin.hash`, and prompt cache keys are stripped.
2. **Opt-In Conversation (`GET /api/log`)**: Enabled only when a source sets `"conversation": true` and the session is pinned. Returns backwards-paginated slices (`<= 120` items/page from a bounded `4,096`-item window) with secret redaction (`server/redact.mjs`) and inert text rendering (no HTML/script/image execution). Revoking capability or unpinning immediately blocks `/api/log` access.
3. **Usage & Cost Provenance**:
   - Persisted transcript usage carries `provenance: "recorded"` and `scope: "self"` (or `"inherited"` when `parentSession` or `continuationOf` is present).
   - Live observer usage carries `provenance: "provisional"` and is **replaced** (never added) when the durable file is pinned and ready (`readerState === "ready"` and `!incomplete`).
   - If a file exceeds `maxFileBytes` (8 MiB), `maxEntries` (4,096), or triggers the bounded duplicate-ID Bloom filter (`possible-duplicate-entry-id`), `incomplete` is set to `true` and exact cost is withheld (`cost: null`, `provenance: "unknown"`).
   - OMP cost and token metrics never enter Claude Code plan allowance (`limits.json`), quota breaks, or the accountant's Claude totals.

---

## 5. Opt-In Companion Extension (`hybrid` Mode)

My Office never modifies your OMP installation automatically. To enable live telemetry:

1. Start My Office once with `OFFICE_OMP=hybrid` and `OFFICE_OMP_CONFIG=<absolute path>`. My Office provisions per-source 64-hex tokens in `~/.omp/office-private/ingest.json` (protected Windows DACL or POSIX `0700`/`0600`).
2. Create `~/.omp/office-private/observer.json` using `writePrivateJson` from `integrations/omp/private-storage.js` with:
   ```json
   {
     "sourceId": "workstation-main",
     "token": "<64-hex-token-for-workstation-main>",
     "url": "http://127.0.0.1:4310/ingest/omp/v1"
   }
   ```
3. Load the observer into OMP:
   - **Single run**: `omp -e /absolute/path/to/my-office/integrations/omp/office-observer.js`
   - **Permanent opt-in install**: create a private directory `~/.omp/agent/extensions/office-observer/`, copy `integrations/omp/private-storage.js` there first, and copy `integrations/omp/office-observer.js` as `index.js`.
4. **Token rotation**: Stop or restart the receiver after updating both `~/.omp/office-private/ingest.json` and `~/.omp/office-private/observer.json` via `writePrivateJson`. Existing running OMP processes retain their previous in-memory closure and will stop sending telemetry after receiving `401` without interrupting agent work; fresh OMP processes pick up the rotated token.

---

## 6. Explicitly Unsupported Features

- **No OMP Controls**: Cannot send prompts, approve/deny tool calls or plan reviews, open IDE windows, stop/kill OMP processes, switch accounts, use `/rc`, or dispatch tasks to OMP from My Office.
- **No `ask` Waiting State**: OMP's built-in `ask` tool does not emit a dedicated waiting callback; sessions remain `active` while an `ask` picker is open.
- **No Live Subagents or Advisors**: Subagent runtimes (`ctx.agent.kind === "sub"`) and `__advisor.jsonl` files are not streamed as live actors. Only persisted `<stem>/<child>.jsonl` files with `session_init.task` under a pinned root appear as `historical` child rows.
- **No Transcripts > 8 MiB**: Session files larger than `maxFileBytes` (8 MiB) are marked `unsupported` (`file-limit`) to bound memory and I/O.
- **No Non-Loopback Ingest**: `POST /ingest/omp/v1` rejects browser `Origin` headers, Cloudflare tunnel requests, and non-loopback peers.

---

## 7. Troubleshooting & Rollback

### Diagnostics (`GET /api/doctor`)
Query `http://127.0.0.1:4310/api/doctor` from the local machine and inspect `agents.omp`:
- `reason: "disabled"`: `OFFICE_OMP` is unset or `off`.
- `reason: "config-missing"` / `"config-invalid"`: `OFFICE_OMP_CONFIG` is missing, relative, oversized, or fails schema validation.
- `reason: "ingress-failed"` (`effectiveMode: "files"`): `OFFICE_OMP=hybrid` was requested, but `~/.omp/office-private/ingest.json` failed private storage ACL/ownership validation or contained malformed JSON. My Office safely degrades to `files` mode while keeping Claude Code active.
- `sources[].state`: `"ok"`, `"absent"` (`ENOENT`), `"denied"` (`EACCES`/`EPERM`/`PATH_DENIED`), `"changed"` (`SOURCE_CHANGED` root identity replaced), or `"degraded"`.

### Clean Rollback
1. Set `OFFICE_OMP=off` (or unset `OFFICE_OMP` and `OFFICE_OMP_CONFIG`) and restart My Office. All OMP timers, readers, and `/api/omp/*` + `/ingest/omp/v1` routes stop immediately (`404`).
2. If the companion extension was installed in OMP, remove `~/.omp/agent/extensions/office-observer/` (and any `OFFICE_OMP_*` environment variables). Running OMP agents continue unaffected.
3. Optional cleanup of My Office's own local state: delete `data/omp-pins.json` and `~/.omp/office-private/{ingest,observer}.json`. Never delete `~/.omp/agent/sessions`.

---

## 8. Updating from `upstream/main` Without Losing OMP Integration

This repository tracks the personal fork as `origin` (`lcaloi2904/my-office`) and the upstream project as `upstream` (`khanh020905/my-office`).

1. Fetch and merge upstream changes into `main` (never `reset --hard` or `rebase` published history):
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```
2. If a conflict occurs in a shared seam file (`server/index.mjs`, `workers.js`, `live.js`, `activity.js`, `lite.js`, `session-drawer.js`, `quota.js`, `accountant.js`, `timeline.js`, `replay.js`), keep both upstream's new feature and the OMP adapter/capability guards as documented in [AGENTS.md](../AGENTS.md).
3. Run verification and rebuild:
   ```bash
   node node_modules/eslint/bin/eslint.js .
   node node_modules/typescript/bin/tsc --noEmit
   node --test tests/unit/agent-*.test.mjs tests/unit/omp-*.test.mjs
   ```
   Then run `start-office.cmd rebuild` and `git push origin main`.
