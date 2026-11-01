---
phase: 4
title: "Managed RPC chat, steer, follow-up, abort và hàng đợi"
status: completed
priority: P1
effort: "3-5 dev-days"
dependencies: [3]
---

# Phase 04 — Interactive control of managed OMP sessions

## Goal
Cho phép gửi prompt và điều khiển runtime OMP **do My Office sở hữu qua RPC**, ngay trong panel bên phải, với đúng identity, idempotency, trạng thái, quyền hạn và lịch sử hội thoại.

## Entry gates
- G3 xác nhận RPC protocol/ownership/session IDs, OMP version installed và Native Windows launcher; explicit approval cho tính năng gửi lệnh/model-backed smoke.
- Flag `OFFICE_OMP_CONTROL` off by default, no accidental prompt when browsing/rendering/replay. Control only local browser, never phone or tunnel.
- Không sử dụng `/api/tasks` hay `/api/perm` vốn dành cho Claude.

## File ownership (proposed)
| Action | Repo-relative file | Change |
|---|---|---|
| Modify | `server/agents/omp/control-manager.mjs`, `server/agents/omp/rpc-host.mjs` | Pending commands, idempotency, state reconciliation |
| Create | `server/agents/omp/command-schema.mjs` | Validated kind+payload/limits/intent |
| Modify | `server/index.mjs` | `POST /api/omp/control/command`, local-only responses/status |
| Modify | `server/agents/projection.mjs`, `server/agents/schema.mjs` | Additive `control` projection, never grant Claude keys |
| Modify | `src/office/ui/session-drawer.js` | Input, mode selection, send, queue, abort and errors |
| Create | `src/office/ui/omp-controls.js` | Isolated DOM interaction, no OMP runtime imports |
| Modify | `src/office/net/live.js`, `src/office/ui/activity.js` | Incremental control states and reconnection |
| Modify | `src/styles/sessions.css`, `src/i18n/locales/{vi,en}/drawer.js` | Composer/queue responsive & accessibility |
| Create | `tests/unit/omp-control-manager.test.mjs`, `tests/unit/omp-command-schema.test.mjs`, `tests/e2e/omp-controls.spec.ts` | Synthetic RPC and UI tests |

## Steps
1. Define `command` intent and state: `prompt` only when idle; `steer` inject while running; `followUp` queue for next turn; `abort` cancels current managed turn; `queueRemove` only if supported by installed RPC. User selects behavior explicitly, no silent fallback.
2. RPC host implements max inbound/outbound frames, bounded memory, queue, stdout/stderr errors, per-request timeout, cancellation on close; forward sanitized terminal/text events with correct server session key. Do not expose OMP raw content in remote SSE or replay.
3. Strict server guard: valid opaque session ID, lease/generation and owner, current connected state, action enabled, command text bounded by bytes/Unicode, per-session rate/concurrency limits, requestId keyed dedup. Never trust UI `canPrompt`.
4. Handle timeout/ACK lost: accepted/queued/running/settled/failed/unknown with server reconciliation; **never** automatic duplicate prompt resend. Old generation must not receive command when session switches or resumes.
5. Session-drawer UI integrates with existing paginated `/api/log` conversation viewer; preserve conversation opt-in; composer disabled with reason for observer-only/historical/disconnected/remote. Keep chat content local-only.
6. Display queue and statuses; disable buttons while pending operations require confirmation; error toasts don't falsely mark command delivered. RPC stream active when server runs, independent of 3D dashboard; Low Quality/List Mode remain usable.
7. Implement clear user cancellation: `abort` != process kill; closing panel != abort; switch selection does not redirect pending prompt.
8. Add negative tests for crafted OMP ID, Claude ID, stale owner, two tab duplicate IDs, missing Origin, LAN/tunnel, invalid content-type, replay mode, malformed RPC frame and privacy redaction.

## Live Agent Activity Bubbles — nhiệm vụ bắt buộc trong Phase 04

### Source files đề xuất (bổ sung vào ownership)

| Action | Path | Phạm vi |
|---|---|---|
| Create | `server/agents/omp/activity-summary.mjs` | Normalizer cho semantic `activitySummary` bounded và server-sanitized |
| Modify | `server/agents/omp/rpc-host.mjs`, `server/agents/projection.mjs` | Publish activity summary từ live RPC hợp lệ, không raw input/output |
| Modify | `src/office/people/workers.js`, `src/office/ui/activity.js`, `src/office/ui/event-text.js` | Reuse `observeActor()`/`Worker.say()` và nhất quán sidebar/3D |
| Modify | `src/office/interact/place-chips.js`, `src/styles/labels.css`, `src/styles/responsive.css` | Reuse CSS2D overlap, sizing và responsive |
| Modify | `src/office/ui/settings.js` | Streamer Mode xóa nhãn chi tiết đã cache |
| Create | `tests/unit/omp-activity-summary.test.mjs`, `tests/e2e/omp-activity-bubbles.spec.ts` | 2 agents, privacy, lifecycle, event-burst, 3D |

### Implementation tasks

1. Chốt `activitySummary` view-only: semantic kind `read/edit/cmd/test/web/processing/waiting/idle/unknown`, optional `safeSubject` (local opt-in), source `observerCategory/managedRpc/externalController`, runtime instance, generation, event sequence, observedAt, TTL và byte/length caps. Chỉ tin nguồn đang sở hữu session, không dùng nội dung thinking hay phản hồi assistant.
2. Observer-only hiện nhãn category chung từ `toolCategories`, **không có tên file/test** vì nguồn hiện không gửi dữ liệu đó. Managed RPC chỉ hiển thị safe basename/test label nếu API installed xác nhận có metadata và local user opt-in; không tự capture raw arguments/results.
3. Ưu tiên **waiting/approval > tool đang active có evidence > processing chung > idle > stale/disconnected/ended/unknown**. Kiểm tra eventGap, sequence và generation; xóa summary sau `tool_end`/`turn_end`/`session_switch`/`session_end`, reconnect, hidden/replay, timeout/owner change. Không để bubble “Đang sửa” khi đã xong.
4. Dùng `Worker.say()`/CSS2D hiện tại, giới hạn **80 ký tự** và text nodes an toàn. Hiện nhãn riêng cho hai agents cùng lúc; không giả công việc của agent khác hoặc subagent. Streamer/remote/replay chỉ generic/hide; không leak command, token, full path, prompt, nội dung thinking qua tooltip/log/SSE.
5. Event-driven, dedupe `sayKey`, coalesce redundant update (mục tiêu ban đầu ≤2 lần thay DOM/agent/giây, benchmark G7), không render từng token hoặc tạo thêm CSS2D object. Tôn trọng CSS2D declutter, zoom, Low Quality/List Mode, photo mode.
6. Unit/E2E: 2 OMP actors đồng thời, read→edit→test, waiting/idle/stale/disconnected/ended/gap, out-of-order/same-name session, 80-character cap, Streamer Mode, remote privacy, collision, event burst.

### Acceptance bổ sung tại G4

- [x] Hai bubble gắn đúng session, phản ánh công việc có bằng chứng và cập nhật khi đổi tool; observer-only nhãn category.
- [x] Khi ngừng hoặc mất kết nối không giữ lại công việc đã kết thúc; không bịa file/test khi nguồn thiếu.
- [x] Chi tiết chỉ khi opt-in đã làm sạch; 80 ký tự; streamer, replay và remote không lộ nội dung nhạy cảm.
- [x] Không tăng render loop/DOM layout không kiểm soát; coalescing event-burst đã kiểm qua MutationObserver; so sánh FPS/CPU đầy đủ thuộc G7 trước rollout.

### Planned verification — chỉ chạy sau phê duyệt

```bash
node --test tests/unit/omp-activity-summary.test.mjs tests/unit/omp-lifecycle.test.mjs tests/unit/omp-projection.test.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/omp-activity-bubbles.spec.ts --config=playwright.omp.config.ts
```

## Gate G4 / acceptance
- [x] Prompt to idle and steer/followUp to busy go only to selected live managed OMP session.
- [x] Exactly one dispatched command for duplicated requestId; status distinguishes RPC ACK from turn completion.
- [x] Abort cancels correct current turn without killing OMP process or corrupting transcript.
- [x] Session rename/branch/switch/restart does not redirect pending prompt; network gaps show unknown instead of success.
- [x] No data leaks into remote viewers, logs, quota panel or Claude controls; disable flag returns pure read-only behavior.

## Planned verification after user approval
```bash
node --test tests/unit/omp-control-manager.test.mjs tests/unit/omp-command-schema.test.mjs tests/unit/omp-rpc-host.test.mjs tests/unit/agent-compat.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/omp-controls.spec.ts --config=playwright.omp.config.ts
```

## Stop / rollback
Duplicate prompt, wrong target, side effects on Claude, uncontrolled queue or privacy violation → disable `OFFICE_OMP_CONTROL`, abort pending controlled operations only when safe, preserve all OMP JSONL and old observer. Keep external TUI scope **not yet enabled**.
