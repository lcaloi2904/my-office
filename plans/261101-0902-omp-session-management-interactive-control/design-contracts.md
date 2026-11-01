# Design contracts — proposed, not implemented

## 1. Trust boundaries and ownership

```text
Browser (strict Windows-local) --[OMP-control API]--> Controller/ownership router
              |                                           |
              +--[Existing UI/SSE] <--- OMP adapter <------+-- Managed RPC stdio
                                         ^                 \-- External TUI control bridge
                                         |
                   OMP files + existing telemetry observer (UNCHANGED)
```

Session identity: `ompSessionIdentity(sourceNamespace,sourceSessionId)` yields opaque stable public ID. Runtime lease key is tuple `{id,runtimeInstanceId,generation,controlOwner,nonce,leaseUntil}`. Only the server can construct capabilities; no raw PID, session path, cwd or bearer in public projection. A valid API command must resolve (i) approved source and session; (ii) current runtime lease; (iii) exactly one owner; (iv) appropriate transport/capability; (v) strict local origin. Two active runtimes same session => `conflict`, command disabled.

Separate `lifecycle` open/ended/historical, `connection` connected/stale/disconnected, `control.state` disabled/unavailable/connecting/ready/conflict and `persistedOnly`. Unknown liveness is not ended. A closed TUI cannot be reattached, but its persisted conversation may be resumed in a new managed process after verification.

## 2. Visibility: hide is not unpin

- Proposed private store `data/omp-hidden.json` (existing ignored `data/`), atomic write, bound size and revision, no credentials. Corrupt store fail-closed without overwriting. Index by opaque ID/source to prevent name collision.
- `POST /api/omp/visibility` accepts only `{id,hidden,expectedRevision}`. Allow unhide from “Phiên đã ẩn”; restore last server snapshot, no fake status. `GET /api/omp/visibility` local only. Hide affects rail/scene/hud visibility, not OMP process, telemetry, usage or replay files.
- Existing `POST /api/omp/pin` kept unchanged. Bỏ ghim removes history tracking, not conversation JSONL. Disconnected live may still be tracked via lifecycle even if not pinned; hide must not rely on `pin(false)`.
- SSE reconnect, server restart and multi-browser tabs must not re-add hidden 3D actors. A hidden running agent is still running, counters/usage backend remain intact. No permanent transcript deletion.

## 3. Proposed HTTP/API contract (names provisional)

Every new state-changing browser endpoint: `isLoopback(req) && !req.viaTunnel`, exact same-site Origin and host validation (Origin absent rejected), JSON Content-Type, request-size cap, action rate, feature flags and server-authoritative target checks. Existing `authorized`/phone cookie alone is not sufficient. Reject non-local 403 even when authenticated.

| Route | Input / output | Rule |
|---|---|---|
| `GET /api/omp/control/status?id=...` | sanitized control owner/caps/freshness | no raw transcript/credentials; local only |
| `GET /api/omp/visibility` | hidden opaque IDs/revision | local only |
| `POST /api/omp/visibility` | `{id,hidden,expectedRevision}` | atomic local store; idempotent |
| `POST /api/omp/control/launch` | `{mode:"new"|"resume",projectKey?,candidateId?,profileAlias?,modelRef?,requestId}` | approved root, validated binary/profile/path, explicit user action |
| `POST /api/omp/control/command` | `{id,runtimeKey,requestId,kind,text?}` | kind allowlist: prompt/steer/followUp/abort/queueRemove |
| `POST /api/omp/control/decision` | `{id,runtimeKey,decisionId,choice,payload?}` | exact pending request and capability; allow-once/deny/skip/answer/plan |
| `POST /api/omp/control/close` | `{id,runtimeKey,confirmed}` | graceful close owned managed process only, never delete data |

External control extension uses separate loopback-only runtime-authenticated register/poll/ack endpoints (actual route names frozen at G5), with per-runtime credential distinct from `OFFICE_OMP_TOKEN` observer credential. Separate `OFFICE_OMP_CONTROL` flag default off; separate `OFFICE_OMP_LAUNCH` and `OFFICE_OMP_APPROVAL` if useful after G1. No Internet listener.

## 4. OMP capability projection

```json
{
  "agentKind": "omp",
  "id": "omp:<opaque>",
  "control": {
    "owner": "managedRpc",
    "state": "ready",
    "canPrompt": true, "canSteer": true, "canFollowUp": true,
    "canAbort": true, "canResume": false,
    "canApproveTool": false, "canReviewPlan": false, "canAnswerAsk": false
  }
}
```

Existing Claude-like OMP `startTask/remoteControl/changeAccount/openWindow/closeSession` remain false. The control fields above are proposed additive. Capability is computed using installed-version matrix + lease + local viewer + replay OFF + opt-in flags; client never grants authority. `waitReasons=["approval"]` alone is NOT sufficient to approve.

## 5. Managed native Windows RPC

- Server-side approved project/worktree mapping, profile aliases, allowlisted executable. Launch with Node `spawn(binary, argv, {shell:false,cwd:approvedRoot,windowsHide:true,stdio:"pipe"})`. No cmd.exe/PowerShell, shell interpolation, arbitrary cwd/env/argv from browser. Keep existing OMP login/session; no OAuth copy, login, account switch or saved reset calls.
- Startup `omp --mode rpc`, do NOT enable `--no-ui` unless proved safe. Validate protocol ready/versions; support `get_state`, `new_session`, `switch_session` and `prompt/steer/follow_up/abort` only after exact installed build evidence. `open_session` opens **newest in directory**, not necessarily selected historical file; never use it as exact-session resume without matching file + ID proof. `--restore` (unfinished work) disallowed by default.
- For resume: opaque catalog candidate → server-approved root → containment/no junction/symlink + exact source session ID → check for live conflicting owner → spawn/open persisted session via verified CLI/RPC behavior → verify reported ID before advertising managed. Error if model unavailable, no silent fallback. Separate “resume transcript” from “restart interrupted task”.
- Bound stdout JSONL frame size, queue depth, pending responses, timeouts, memory and max managed children. Correlate by RPC response ID. Terminal response ACK != agent done; use `prompt_result`/`session_settled` or tested version-specific completion and refresh `get_state` on reconnect. Unknown completion remains unknown; never blindly retry prompts.
- Graceful close only for owned process with start identity and user action; no kill external TUI. Server exit may close RPC stdin/process; UI closing alone should not close server-managed process. Never auto-respawn/auto-send prompts after process crash/restart.

## 6. External OMP TUI (opt-in controller)

- New separate `integrations/omp/office-controller.js` extension. Do not modify observer to accept commands; observer continues bounded one-way telemetry and can work without control. Explicit user install/reload approval is necessary; old process not running controller remains observer-only.
- Controller registers a session-scoped lease (source, runtime instance/generation, nonce/TTL) via control-only auth. Poll bounded commands on loopback with slow/backoff timers and cleanup; execute through OMP extension `pi.sendUserMessage` / `ctx.abort` only after runtime initialized and supported in that mode.
- Exact commandId/generation dedup, stale/duplicate/foreign source rejection. If ACK lost, state becomes unknown, never resend unverified command. Session switch/fork/resume invalidates old pending work. Multi-owner conflict hard-stop.
- No direct agent kill, arbitrary shell/tool execution, profile login or OAuth migration. Only opted-in sessions show controls. Legacy TUI closed => cannot control; show Resume/New options. Control flags OFF leave telemetry active and stable.

## 7. Interactive UI & decisions

- OMP rail ⋯ menu: Kiểm tra kết nối, Ẩn/Hiện, Bỏ ghim, Tiếp tục phiên, Tạo phiên mới, Xem lịch sử. Disabled buttons say why; keyboard/ARIA, responsive List Mode/Low Quality, i18n en/vi.
- Drawer composer reuses existing conversation viewer, adds explicit `Tiếp tục` vs `Steer` vs `Follow-up` selection. Show pending/queued/running/settled/unknown/errors, progress, source/model/profile and last heartbeat. Does not expose secret paths.
- Approval channel separated by kind (tool, plan, ask). Only a trusted runtime request with `decisionId, runtimeKey, kind, expiry` can be answered. Allow once/deny/skip, not always. Dangerous commands require two-step decision or original native TUI; default deny/unsupported. RPC `extension_ui_request` can timeout to default; **never automatically allow** on timeout. External TUI approval only when installed version exposes verified response API. Phone approval remains disabled even if Claude phoneApprove=true.
- UI activity, replay and remote view never emit command side effects. Audit action metadata only (opaque ID, kind, status, timestamp), NEVER user prompt, tool args/result or raw credentials.

## 7a. Live Agent Activity Bubbles (view-only contract; proposed)

- **Renderer đang có:** `src/office/people/workers.js` dùng `observeActor(w,s)` và `Worker.say()`, CSS2DObject; `src/office/interact/place-chips.js` quản lý overlap và kích thước. Reuse, không thêm canvas sprites, no per-token DOM.
- **Schema chỉ hiển thị:** `activitySummary = { kind, safeSubject?, source, runtimeInstanceId, generation, eventSequence, observedAt }`, kind ∈ read/edit/cmd/test/web/processing/waiting/idle/unknown, source ∈ observerCategory/managedRpc/externalController. Server validate allowlist, size/TTL và đúng owner; không phải API điều khiển.
- **Evidence:** observer OMP hiện chỉ có `toolCategories` + activity. Không có file path/command/test name mặc định; bubble chỉ category chung. Safe basename/test label là optional local opt-in và chỉ khi provider runtime trả metadata được xác minh. Nếu không, giữ “Chưa xác định hoạt động” hoặc trạng thái chung đúng.
- **Freshness priority:** waiting/approval > current verified active tool > generic processing > idle > stale/disconnected/ended/unknown. Khi tool end, generation/owner thay đổi, event gap, disconnect, hide/replay, không được giữ việc cũ. Per-session keyed, không lẫn 2 workers.
- **Privacy:** Không dùng raw assistant text/thinking, prompt, tool arguments/results, lệnh, full/relative paths, URLs, tokens hoặc creds. Label chỉ metadata đã lọc; Streamer Mode và remote viewer luôn generic/hide detail. No detailed summary in remote SSE/replay/log/tooltip; render qua text nodes.
- **Performance:** root bubble tối đa 80 ký tự qua `Worker.say()`. Only update on material change, coalesce target ≤2 DOM changes/worker/s (subject G7 measurements), reuse existing cached label-size/declutter; kiểm tra 2/8/32/64 actors/zoom/mobile/Low Quality/List Mode/photo mode.
- **Separation:** Bubble là UI-only, không mở quyền OMP control. Khi `OFFICE_OMP_CONTROL` OFF, category-only vẫn hoạt động nếu observer hybrid đang bật; external TUI detail chỉ qua Phase 05 opt-in controller.

## 8. Security & resilience gates

| Threat | Required defense |
|---|---|
| Browser CSRF/DNS rebinding/Origin missing | strict Origin, Host, socket loopback, no tunnel, HTTP negative cases |
| Forged OMP session ID / Claude sid | opaque source resolution + independent owner checks, never reuse Claude route |
| Wrong resumed worktree/path | approved root, anchored containment, exact session ID verify before accepting |
| Simultaneous TUI + managed same session | conflict state blocks command/resume; no forced kill |
| Stale generation / replayed request | runtime lease + nonce + monotonic IDs + bounded dedup |
| Approval default/implicit allow | explicit one-shot decision; fail closed until proved safe |
| Leak via logs/SSE/tooltips | sanitization, no raw prompt/credentials, local-only projection |
| Closed dashboard/server | idle timers bounded; no auto-spawn/kill on disable |
| Old observer or Claude regressions | separate flags, old ingest API unchanged, full regression tests |

## 9. Repository policy conflict / gating

`AGENTS.md` currently states OMP must remain read-only and loopback. This plan proposes a **future opt-in exception for explicit server-owned controls only**, which needs user scope approval and policy/docs revision before code implementation. Plan creation alone does not authorize changing this rule. Never write outside `my-office` or access real OMP secrets. No new dependencies presumed.

## 10. Public docs are not installed-version contracts

References: https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/session-operations-export-share-fork-resume.md . G1 must verify OMP version/mode and specific API shapes on native Windows (initially without paid model turn). Unsupported features remain disabled; do not fake capability.
