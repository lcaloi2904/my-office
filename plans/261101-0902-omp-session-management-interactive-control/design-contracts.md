# Design contracts — baseline G1 và đề xuất G3–G6

**Baseline ngày 2026-11-01:** G1 review đã hoàn tất bằng native OMP18.14.2/Node24.22.1/Windows10.0.26200 x64, HEAD `8da383771bf4329aa9b471f477d53fb593e1f9e1`; xem [báo cáo và output](./reports/g1-compatibility-security.md). Chỉ probe task-owned, không turn/credential/runtime thật. **G1 review complete không cấp quyền viết code/bật control G3–G6.** Các mục control dưới đây vẫn là thiết kế, cần ngoại lệ policy và gate riêng; Phase02 visibility không phải control.

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

**Owner gate sau G1:** `server/agents/omp/lifecycle.mjs:139-165` chỉ giải quyết telemetry conflict/freshness; stale observer không phải quyền takeover. Native `get_session_lease` là probe snapshot, không atomic reservation. Probe thật trả `held:[],unknown:[]` ngay khi transcript synthetic đang mở; source upstream tag `v18.14.2`, `session/session-manager.ts:1117-1148,2376-2380` giải thích chỉ first write mới claim và có thể chuyển sang sibling/new ID khi owner khác giữ. Controller phải có reservation riêng, canonical candidate/file identity kể cả khác source namespace, cùng exclusion strategy đã chứng minh với external TUI. Nếu chưa loại được race check/open/first-write hoặc owner unknown, resume/command disabled; không suy exclusivity từ free lease, PID, mtime hay heartbeat hết hạn.

## 2. Visibility: hide is not unpin

- Store Phase02 đã triển khai tại `data/omp-hidden.json` (ignored), atomic write, giới hạn số lượng/kích thước và revision; corrupt fail-closed, không ghi đè hay chứa credentials. Khóa theo opaque source/session ID, không theo tên hiển thị.
- `POST /api/omp/visibility` nhận `{id,hidden,expectedRevision}`, trả revision và `available`; restore từ adapter hiện tại, không snapshot cũ hoặc actor giả khi hết quan sát. `GET /api/omp/visibility[?id=<opaque-id>]` local-only trả hidden IDs/revision và allowlist `current` evidence (hoặc null). Hide chỉ ảnh hưởng rail/scene/HUD, không process/telemetry/usage/transcript.
- Existing `POST /api/omp/pin` kept unchanged. Bỏ ghim removes history tracking, not conversation JSONL. Disconnected live may still be tracked via lifecycle even if not pinned; hide must not rely on `pin(false)`.
- SSE reconnect, server restart and multi-browser tabs must not re-add hidden 3D actors. A hidden running agent is still running, counters/usage backend remain intact. No permanent transcript deletion.

## 3. HTTP visibility đã triển khai; control vẫn là đề xuất

Every new state-changing browser endpoint: `isLoopback(req) && !req.viaTunnel`, exact same-site Origin and host validation (Origin absent rejected), JSON Content-Type, request-size cap, action rate, feature flags and server-authoritative target checks. Existing `authorized`/phone cookie alone is not sufficient. Reject non-local 403 even when authenticated.

| Route | Input / output | Rule |
|---|---|---|
| `GET /api/omp/control/status?id=...` | sanitized control owner/caps/freshness | no raw transcript/credentials; local only |
| `GET /api/omp/visibility[?id=...]` | hidden opaque IDs/revision, allowlist current evidence hoặc null | local only, known/hidden OMP ID |
| `POST /api/omp/visibility` | `{id,hidden,expectedRevision}` | atomic local store; idempotent |
| `POST /api/omp/control/launch` | `{mode:"new"|"resume",projectKey?,candidateId?,profileAlias?,modelRef?,requestId}` | approved root, validated binary/profile/path, explicit user action |
| `POST /api/omp/control/command` | `{id,runtimeKey,requestId,kind,text?}` | kind allowlist: prompt/steer/followUp/abort/queueRemove |
| `POST /api/omp/control/decision` | `{id,runtimeKey,decisionId,choice,payload?}` | exact pending request and capability; allow-once/deny/skip/answer/plan |
| `POST /api/omp/control/close` | `{id,runtimeKey,confirmed}` | graceful close owned managed process only, never delete data |

External control extension uses separate loopback-only runtime-authenticated register/poll/ack endpoints (actual route names frozen at G5), with per-runtime credential distinct from `OFFICE_OMP_TOKEN` observer credential. Separate `OFFICE_OMP_CONTROL` flag default off; separate `OFFICE_OMP_LAUNCH` and `OFFICE_OMP_APPROVAL` if useful after G1. No Internet listener.

G1 xác minh source boundary, chưa implement control auth: telemetry `server/agents/omp/bridge.mjs:90-102` từ chối mọi Origin và dùng token source-bound. Không reuse token này, PIN cookie, raw native RPC session ID hoặc observer `waitReasons` làm authority cho control/approval. Browser và runtime là hai caller khác nhau: browser bắt buộc Origin exact; runtime endpoint riêng phải reject Origin và kiểm per-runtime credential/lease. `server/index.mjs` helper `sameOriginOf` cho phép Origin thiếu nên không thể dùng một mình cho route ghi mới.

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
- **Startup đã VERIFIED hẹp:** native18.14.2 `--mode rpc` với profile/HOME/USERPROFILE/config/session-dir task-owned và `--model g1-local/probe` phát `ready` v1 + response IDs. Model config giả loopback đủ khởi động mà không credential/turn. Không dùng `--no-ui`; chỉ cờ help DOCUMENTED chưa chứng minh safe default của dialog. `get_state`, `new_session`, exact `switch_session {sessionPath}` đã VERIFIED; `prompt/steer/follow_up` chưa gửi, active abort UNKNOWN. `open_session {sessionDir}` chỉ thử thư mục có một file non-empty; source documented newest/continuation selection, **không dùng cho exact resume**. `--restore` disallowed.
- **Exact resume đã VERIFIED hẹp:** CLI `--resume <absolute synthetic .jsonl>` và RPC `switch_session` đều trả đúng ID/file, `get_messages` đúng history và không tự dispatch user entry cũ. G3 phải map opaque candidate → approved root → containment/no junction/symlink + exact header ID → exclusive owner/reservation → spawn/open → verify reported ID/file trước khi advertise managed; revalidate sau transition và identity-change events. Không silent sibling/fork/fallback; model unavailable báo lỗi. Proof chỉ synthetic schema3, không cho phép đọc/resume session thật hoặc restart interrupted task.
- Bound stdout JSONL frame size, queue depth, pending responses, timeouts, memory and max managed children. VERIFIED `ready` advertises v1/v2, physical1048576/logical67108864 bytes; chỉ frame nhỏ v1 đã chạy, negotiate/chunk/overflow UNKNOWN. Correlate by RPC response ID. ACK != done; `prompt_result`/`session_settled` sau turn mới DOCUMENTED, chưa VERIFIED. `get_state.isSettled=true` chỉ quan sát idle. Unknown completion remains unknown; never blindly retry prompts. Native state có `systemPrompt`, `dumpTools`, queue text và raw paths: dùng projection allowlist, không forward/log raw state.
- EOF shutdown idle đã VERIFIED: đóng stdin, tiếp tục đọc stdout tới EOF, 2 children exit0/signal=null. `abort` idle ACK success và process tiếp tục phục vụ, không kill; active stream/tool/approval abort và busy EOF UNKNOWN. Graceful close chỉ owned process với identity/user action, không kill external TUI. UI đóng không đóng server child; không auto-respawn/auto-send sau crash/restart.

## 6. External OMP TUI (opt-in controller)

- New separate `integrations/omp/office-controller.js` extension. Do not modify observer to accept commands; observer continues bounded one-way telemetry and can work without control. Explicit user install/reload approval is necessary; old process not running controller remains observer-only.
- Controller registers a session-scoped lease (source, runtime instance/generation, nonce/TTL) via control-only auth. Poll bounded commands on loopback with slow/backoff timers and cleanup; execute through OMP extension `pi.sendUserMessage` / `ctx.abort` only after runtime initialized and supported in that mode.
- Exact commandId/generation dedup, stale/duplicate/foreign source rejection. If ACK lost, state becomes unknown, never resend unverified command. Session switch/fork/resume invalidates old pending work. Multi-owner conflict hard-stop.
- No direct agent kill, arbitrary shell/tool execution, profile login or OAuth migration. Only opted-in sessions show controls. Legacy TUI closed => cannot control; show Resume/New options. Control flags OFF leave telemetry active and stable.

**Trạng thái G1: UNKNOWN/disabled cho toàn bộ external TUI bridge.** Không cài/nạp extension controller, không attach runtime thật. `pi.sendUserMessage`/`ctx.abort` là DOCUMENTED API, không phải installed transport proof. Telemetry TUI đã quan sát trong các report trước không chứng minh command/ACK/approval response. G5 cần user duyệt install/reload, credential riêng và xác minh mode/version trước mọi capability.

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

`AGENTS.md:67-71` hiện yêu cầu OMP read-only và loopback. User assignment chỉ duyệt cost-free protocol probe trong fixture task-owned; không duyệt sửa policy, đọc real auth/session, bật control, cài extension hay gọi paid model. Ngoại lệ tương lai cho explicit server-owned control cần user duyệt phạm vi và revision policy/docs **trước G3**; G4 cần command/completion/active-abort proof, G5 cần riêng install/bridge proof, G6 cần decision/timeout-deny proof. G1 COMPLETE là kết thúc review, không waive các gate này. Không thay policy hoặc runtime thật trong Phase01/02.

## 10. Public docs are not installed-version contracts

Nguồn public docs `main` chỉ là DOCUMENTED: https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/session-operations-export-share-fork-resume.md . Source semantics đã đọc tại tag [v18.14.2/rpc-mode.ts](https://github.com/can1357/oh-my-pi/blob/v18.14.2/packages/coding-agent/src/modes/rpc/rpc-mode.ts), [session-manager.ts](https://github.com/can1357/oh-my-pi/blob/v18.14.2/packages/coding-agent/src/session/session-manager.ts) và [session-storage.ts](https://github.com/can1357/oh-my-pi/blob/v18.14.2/packages/coding-agent/src/session/session-storage.ts); không claim tag giống byte-for-byte binary cài. Chỉ các hành vi trong ma trận bên dưới có runtime proof; API/mode/version khác giữ disabled nếu chưa verify.

| Năng lực native18.14.2 Windows RPC | Evidence G1 | Capability hiện tại |
|---|---|---|
| Startup v1, `get_state`, `new_session` | VERIFIED runtime, no-turn | Không tự bật launch/control |
| Exact `switch_session`, CLI `--resume <absolute path>`, `get_messages` | VERIFIED runtime, synthetic schema3 | Resume thật vẫn disabled tới policy + exclusive-owner gate |
| `open_session {sessionDir}` | VERIFIED runtime với 1 non-empty file; newest/continuation DOCUMENTED | Không dùng cho exact resume |
| `get_session_lease` | VERIFIED response free; held/unknown/conflict UNKNOWN | Không thay reservation/exclusion gate |
| `abort`, stdin EOF | VERIFIED khi idle, busy UNKNOWN | Không cấp active abort/kill |
| `prompt`, `steer`, `follow_up`, post-turn completion | DOCUMENTED, runtime UNKNOWN | Disabled |
| `extension_ui_request` | VERIFIED `setWidget` notification; decision/response UNKNOWN | Tool/plan/ask approvals disabled |
| External TUI bridge, WSL/cross-host, protocol-v2 negotiation | UNKNOWN (v2 chỉ advertised) | Disabled |

Fixture listener không thực thi inference đã nhận 0 HTTP requests; cả 2 child exit0 và thư mục probe đã xóa toàn bộ. Đây là compatibility evidence, không là unit/browser/regression suite PASS hay production rollout approval.
