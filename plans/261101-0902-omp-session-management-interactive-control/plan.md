---
title: "OMP Session Management & Interactive Control"
description: "Quản lý, ẩn/hiện, tạo mới, khôi phục và tương tác với phiên OMP ngay trong My Office qua native RPC và opt-in external TUI bridge."
status: in-progress
priority: P1
effort: "Ước tính 20-30 dev-days; xác nhận sau G1"
branch: main
tags: [feature, backend, frontend, api, auth, experimental]
blockedBy: []
blocks: []
created: 2026-11-01
---

# OMP Session Management & Interactive Control — Kế hoạch đầy đủ

## Outcome đã chốt

Cho phép người dùng **quản lý agent OMP ngay trong sidebar và drawer My Office**, gồm: kiểm tra kết nối; ẩn/hiện hoặc bỏ ghim; xem lịch sử; tạo phiên OMP mới; tiếp tục đúng phiên cũ; chat/prompt, steer, follow-up, abort, hàng đợi; approval, plan review, câu hỏi/ask. Phần này áp dụng cho Codex/Antigravity hoạt động **trong OMP**, không tạo agent adapter hay đăng nhập OAuth mới.

**Phân biệt:** `Mất kết nối` là thiếu heartbeat, **không phải** bằng chứng process đã dừng. `Ẩn` chỉ ảnh hưởng UI, **không** dừng tiến trình hoặc xóa JSONL. `Bỏ ghim` là ngừng theo dõi history cũ. `Tiếp tục` khởi tạo runtime khác nạp đúng persisted conversation (không phục hồi process đã chết). `Tạo mới` dùng context trống.

**Phạm vi đã duyệt:** Phase01–03 đã nghiệm thu ([G3 PASS](./reports/g3-launcher-acceptance.md) với bản native riêng `omp-office-g3.exe`). Ngoại lệ hẹp trong `AGENTS.md` cho phép launcher native opt-in, không prompt/steer/approval hay external TUI control. Không mở Phase04–07, model trả phí, credential thật hoặc rollout khi chưa có phê duyệt mới.

## Scope challenge: HOLD SCOPE

Chức năng cũ để tái dùng: `server/agents/omp/index.mjs` catalog/pin; `lifecycle.mjs` theo dõi stale/disconnected; `server/agents/registry.mjs` projection; `src/office/ui/{activity,session-drawer,omp-history}.js` và `src/office/net/live.js` cho giao diện/SSE/3D; `integrations/omp/office-observer.js` chỉ telemetry. Không refactor ngoài vùng ảnh hưởng hoặc thay Claude Code.

Bảy phase là cần thiết do ba ranh giới quyền khác nhau: presentation/historical; process OMP do My Office sở hữu (managed RPC); OMP TUI đang chạy bên ngoài (phải explicit opt-in). Approval là một threat boundary riêng, không thể mở chỉ vì trạng thái waiting.

## Thiết kế chính

```text
OMP files + existing read-only observer --> OMP adapter + registry --> local-only SSE --> UI
                                                    |                    |
                                         local visibility store      Sidebar/Drawer
                                                    ^
                                               OMP Control Manager
                                                  /          \
                         managed native Windows RPC        external TUI opt-in extension
                         controlled child + JSONL          scoped loopback poll/ACK
                                                   
Existing Claude endpoints /api/tasks, /api/perm, /api/open remain UNCHANGED.
Existing OMP /ingest/omp/v1 remains TELEMETRY ONLY.
```

**Managed RPC:** launch `omp --mode rpc` native Windows với allowlist binary/profile/cwd và `spawn` shell=false; hỗ trợ new/resume chính xác, prompt & feedback qua protocol JSONL. **External TUI:** không attach một process TUI đang chạy bằng PID; chỉ điều khiển khi extension control **riêng**, được user chủ động load, handshake thành công và chứng minh identity. **Persisted-only/observer-only:** ẩn/hiện, xem, unpin; cung cấp Resume nếu đủ bằng chứng; không gửi command ngầm.

Server độc lập cấp quyền theo `sourceNamespace + sourceSessionId + runtimeInstanceId + generation + controlOwner`. Tách `control.capabilities` của OMP khỏi `startTask/remoteControl/changeAccount` Claude. Runtime ack `accepted` khác `settled`; stale/unknown luôn hiển thị đúng sự thật.

## Phases / dependency gates

| # | Phase | Mục tiêu | Gate | Depends |
|---|---|---|---|---|
| 01 | [Contracts, baseline, compatibility](./phase-01-start.md) | Exact OMP dialect/OS/session identity, threat model, approval boundary | **G1 COMPLETE (review; không cấp quyền control)** | — |
| 02 | [Session visibility & lifecycle UX](./phase-02-session-visibility.md) | Ẩn/hiện, Undo, refresh bằng chứng, bỏ ghim, lưu sở thích | **G2 PASS** | G1 |
| 03 | [Native Windows RPC launch/resume](./phase-03-native-rpc-launch-resume.md) | Tạo mới, resume exact session, ownership & cleanup | **G3 PASS (Phase 04 vẫn đóng)** | G1,G2 |
| 04 | [Managed interactive control & Live Agent Activity Bubbles](./phase-04-managed-interactive-control.md) | Chat và mô tả công việc realtime trên các ô nổi 3D | G4 | G3 |
| 05 | [External TUI opt-in controller](./phase-05-external-tui-control-bridge.md) | Bridge đã cấp quyền tới phiên bên ngoài, không phá observer | G5 | G1,G4 |
| 06 | [Approval & advanced actions](./phase-06-approvals-and-advanced-actions.md) | Allow-once/deny, ask, plan review với fail-closed gates | G6 | G4,G5 |
| 07 | [Security/perf/regression & rollout](./phase-07-hardening-regression-rollout.md) | Native Windows smoke, regressions, benchmark bubble/3D, docs/rollback | G7 | G2–G6 |

Từng phase có owner files, tasks, acceptance, tests, stop condition/rollback. Không đóng G1–G7 khi chưa có test evidence. G2 có thể triển khai bật riêng dù runtime control chưa được chấp thuận; G3–G6 tắt mặc định và cần approval bổ sung.

## Live Agent Activity Bubbles — yêu cầu bổ sung ngày 2026-11-01

Hiển thị **nội dung công việc agent OMP đang làm** trên **hai ô nổi có sẵn ở scene 3D**, theo từng nhân vật và thời gian thực dựa trên bằng chứng. Các nhãn mong muốn: “Đang đọc file”, “Đang sửa code”, “Đang chạy test/lệnh”, “Đang xử lý yêu cầu”, “Đang chờ phê duyệt”; optional tên file dạng basename hoặc test label **đã kiểm duyệt** nếu nguồn dữ liệu hỗ trợ và người dùng bật chi tiết cục bộ.

**Không tự đoán nội dung:** observer OMP hiện chỉ gửi `toolCategories`/liveness; observer-only không thể biết tên file, test hoặc prompt. Managed RPC (Phase 04) và external controller opt-in (Phase 05) có thể cung cấp nhãn chi tiết **chỉ khi** installed-version và privacy contract đã được xác minh. Activity không rõ, idle, stale, disconnected, ended, session switch hoặc gap phải xóa việc cũ và trở về trạng thái trung thực. Hai agent `my-office` và `auto-pmh` không được nhầm bubble.

Tận dụng `observeActor()`, `Worker.say()`, CSS2D declutter đã có; **80 ký tự/root bubble**; update theo sự kiện thay đổi, không theo token. Không công khai raw prompt, tool args/results, lệnh, full paths, credentials, nội dung thinking; Streamer Mode và remote viewer chỉ hiện nhãn tổng quát. **G4** implement/verify; **G5** bổ sung external TUI support; **G7** performance/security/browser E2E.

## UX behavior contract

| Session | Menu hành động | Quy tắc |
|---|---|---|
| Live/ready & controllable | Chat, Steer, Follow-up, Abort, Ẩn, Xem | Chỉ command khi server xác thực owner/capability |
| Live observer-only | Ẩn, Xem, hướng dẫn bật control opt-in | Không gửi lệnh |
| Stale/disconnected | Kiểm tra lại, Ẩn, Xem history, Resume sau safety gate | Không coi đã tắt; không auto-start |
| Ended + persisted file | Tiếp tục đúng session, Tạo mới, Ẩn/Bỏ ghim | Không xóa context |
| Historical pinned | Bỏ ghim, Ẩn, Hiện lại, Resume nếu supported | Không giả phiên live |
| Unsupported/foreign host | Chỉ xem/ẩn, giải thích giới hạn | Không auto fallback |

Ẩn live session không cắt telemetry/usage. Mục **Phiên đã ẩn** giúp hiện lại sau reload/reconnect. UI cũng phải xử lý 2 worktrees có cùng basename và trạng thái error/unknown. **Không** có nút xóa vĩnh viễn transcript ở scope này.

## Security defaults

1. Control/local launch chỉ cho trình duyệt **trên cùng Windows host** với server: strict Origin/Host, `isLoopback` và `!viaTunnel`; cookie/phone PIN không thay được quyền local. Cấm LAN/Cloudflare/Tailscale/mobile control giai đoạn đầu.
2. Feature flags OMP control/launcher/approval đều **OFF theo mặc định**, độc lập `OFFICE_OMP` và quota `OFFICE_OMP_USAGE`. Không tự cài extension/đăng nhập/chuyển account.
3. API nhận opaque ID + project/profile alias được xác minh; không nhận command-line, cwd, session path hoặc PID tùy ý từ HTTP. Không gọi shell, không kill process khác.
4. Không dùng telemetry bearer token để nhận lệnh. Separate runtime-scoped control channel, TTL, nonce, bounded queue, idempotent command IDs; không log raw prompts/answers/tool results/credentials.
5. Approvals fail-closed; không `always allow`; remote phoneApprove của Claude không áp dụng OMP; request phải khớp đúng generation, kind, expiry, user decision.
6. Không biến `AGENTS.md` quy tắc OMP read-only thành quyền control ngầm. **Khi thực thi G3+ phải có người dùng duyệt rõ thay đổi policy hiện hành** và cập nhật docs theo phạm vi.
7. Không phá `isClaudeRequest`, `resolveForControl`, Claude hooks/prompt/timeline/replay và multi-account usage.

## Cross-plan / version dependencies

- [OMP read-only integration](../261030-1754-omp-multi-agent-integration/plan.md) vẫn có các gates ngoại lệ, không tự tuyên bố hoàn tất. Phase 05/06/docs có file overlap, cần re-scout lúc cook.
- [OMP multi-account usage](../261101-0106-omp-multi-account-usage/plan.md) hiện status completed nhưng working tree có file sửa dở; không chỉnh quota collector/attribution.
- Scout 2026-11-01: workspace `my-office`, `main` HEAD `70d455a`; dirty files hiện có: `server/agents/omp/usage-accounts.mjs`, `src/office/ui/omp-usage-panel.js`, `src/styles/topbar-plan.css`, `src/styles/topbar.css`, `tests/unit/omp-usage-accounts.test.mjs`. Giữ nguyên.
- Upstream OMP docs đang chuyển động: `rpc.md`, `cli-reference.md`, `extensions.md`, `session-operations-export-share-fork-resume.md` của https://github.com/can1357/oh-my-pi . Đây là DOCUMENTED chứ chưa chứng minh API trên bản OMP installed; G1 pin chính xác runtime/version.

## Acceptance criteria tổng

- [x] Không mất lịch sử/context khi hide/unpin; hidden không tái xuất hiện sai sau SSE/server restart — G2, bằng chứng trong validation matrix.
- [ ] Native new/resume dùng đúng project/profile/session, không duplicate process hoặc attached nhầm phiên.
- [ ] Managed RPC gửi prompt/steer/followUp/abort tin cậy; accepted != settled, stale/unknown không giả thành done.
- [ ] External TUI chỉ điều khiển khi extension riêng được bật và handshake, không ảnh hưởng observer-only.
- [ ] Approval/plan review/ask chỉ mở khi API hỗ trợ xác minh; quyền local-only, fail-closed.
- [ ] Hai Live Agent Activity Bubbles hiển thị đúng tóm tắt công việc độc lập từng OMP agent, không dính việc cũ sau khi idle/disconnect, ≤80 ký tự, bảo toàn FPS và quyền riêng tư.
- [ ] Claude Code, OMP quota/replay, List Mode/Low Quality và privacy không regress.
- [ ] Unit, HTTP-negative, browser E2E, isolated native Windows smoke, performance trước/sau, docs và rollback có evidence.

## Supporting documents / decisions

[Source evidence](./evidence.md) · [Design contracts](./design-contracts.md) · [Validation matrix](./validation-matrix.md) · [Red-team review](./red-team-review.md).

Default decisions: Managed RPC cho new/resume; external TUI phải opt-in; ẩn != unpin != terminate != delete; unverified liveness locks command; không mở phone; không auto-restore unfinished work. G1 đã xác minh native startup/exact synthetic resume và idle EOF; free native lease không phải exclusive owner. Active completion/approval/external TUI còn UNKNOWN, disabled tới gate riêng.

## Handoff

**G3 OPEN; dừng trước Phase04.** Test failures đã sửa; unit/E2E/native no-turn và giới hạn kiểm chứng được ghi trong [biên bản G3](./reports/g3-launcher-acceptance.md) và [validation matrix](./validation-matrix.md). Không giảm tiêu chí Resume để đóng gate: cần cơ chế loại trừ writer được chứng minh qua race check/open/first-write, không chỉ probe lease hoặc reservation nội bộ. Không triển khai Phase04, không bật launcher production, không commit/push hoặc thay `.next` đang chạy trong lượt nghiệm thu này.

<!-- slug: omp-session-management-interactive-control -->
