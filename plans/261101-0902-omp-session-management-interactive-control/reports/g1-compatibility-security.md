# Báo cáo G1 — Compatibility, ownership, security (đọc-chỉ)

Ngày: 2026-11-01 · Branch `main` · HEAD `cd9b999` · Win11 native · Chế độ: `--auto`, chỉ đọc source/docs.
Nhãn: VERIFIED (đọc trực tiếp source/docs repo) · DOCUMENTED (doc upstream) · UNKNOWN / NOT RUN (chưa có approval).

**Kết luận G1: UNVERIFIED (chưa PASS).** Phần source/ranh giới đã VERIFIED; phần installed-version/protocol/resume/approval cần approval riêng nên giữ UNKNOWN. Không sửa code/policy/settings. Phase 02 (hide/unhide, không cần control) có thể đi tiếp sau khi user duyệt; G3–G6 bị chặn.

## 1. Git baseline (VERIFIED)
- Working tree trước khi làm: chỉ `plans/261101-0902-…/` untracked. Các file dirty của usage-accounts trong plan.md đã được commit ở `cd9b999` → không còn overlap chưa commit.
- Ownership: phase 01 chỉ chạm thư mục plan. Vùng cấm đụng khi cook sau: `server/agents/omp/usage-*.mjs`, `omp-usage-panel.js`, `topbar*.css`.

## 2. Source map ranh giới hiện tại (VERIFIED)
| Điểm | Bằng chứng | Hệ quả |
|---|---|---|
| OMP capabilities toàn false (trừ `readConversation`) | `server/agents/schema.mjs:8-11,33-34` | Thêm field `control.*` additive, không bật `startTask/remoteControl` |
| Claude control gate | `schema.mjs:36-41,55-60`, `registry.mjs:56-58` (`resolveForControl` chỉ `kind==='claude'`) | ID `omp:`/`agent:` không thể thành đích Claude; giữ nguyên |
| Định danh OMP | `schema.mjs:47-52` sha256 của `['omp',namespace,sessionId]` | Dùng làm opaque ID; không lộ path/profile |
| Telemetry 1 chiều | `server/index.mjs:2179-2181` `/ingest/omp/v1` loopback + token/source; README observer | Không dùng làm kênh lệnh; control cần kênh riêng |
| Spawn OMP hiện có | `usage-collector.mjs:240-241` `shell:false`, executable allowlist `OFFICE_OMP_BIN` | Mẫu spawn an toàn có thể tái dùng cho managed RPC |
| Pin/catalog local-only | `server/index.mjs:2358-2360` | Mẫu guard cho route mới |

## 3. Security boundary (VERIFIED, có phát hiện)
- `isLoopback` (`server/index.mjs:1224`) loại tunnel + chỉ nhận 127.0.0.1/::1. `hostAllowed` (1233, áp ở 2257 → 421) chặn DNS rebinding.
- **Phát hiện chính:** `sameOriginOf` (1228-1231) **chấp nhận Origin vắng mặt** (`!o || …`). Route ghi mới (`visibility`, `control/*`) PHẢI dùng guard chặt hơn: Origin bắt buộc có và khớp `http://${host}` + `isLoopback` + JSON content-type + size cap. Không dùng `authorized()` (cookie/PIN không đủ). `/api/omp/pin` hiện chỉ dựa `sameOriginOf` → Phase 02 nên dùng guard chặt cho route mới, không đổi hành vi pin cũ.
- Mẫu route nhạy cảm khác (OTLP, `2201+`) đã dùng `!req.headers.origin` (từ chối mọi Origin) — phù hợp cho kênh runtime→server của controller (không phải browser), khác với kênh browser→server cần Origin bắt buộc.
- Threat model chốt: CSRF/DNS-rebinding → Origin bắt buộc + Host + loopback socket; replay → requestId + generation + nonce, bounded dedup; "abort" ≠ kill (chỉ RPC `abort`, không kill process); approval timeout → deny, không auto-allow; prompt không vào log/SSE/replay/audit.

## 4. Installed OMP (một phần VERIFIED, phần còn lại UNKNOWN)
- VERIFIED (từ báo cáo tích hợp trước, repo `integrations/omp/README.md:44-60`): sự kiện thực quan sát trên **18.14.1** (print/rpc, `--approval-mode always-ask`) và **18.14.2** (TUI, model giả lập) — gồm `session_switch new/resume/fork`, `tool_approval_*`, `plan_review_*`; hộp thoại `ask` không có trạng thái chờ riêng.
- Binary tồn tại: `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe` (chỉ tra PATH bằng `where`, **không chạy**). Version hiện cài: **UNKNOWN / NOT RUN** (cần `omp --version` có approval).
- DOCUMENTED, chưa verify trên build cài: RPC `get_state/new_session/switch_session/open_session/prompt/steer/follow_up/abort/extension_ui_request`, CLI `--mode rpc/--resume/--continue/--restore/--profile`, extension `pi.sendUserMessage/ctx.abort`.
- Ghi chú: `open_session` = phiên mới nhất trong thư mục (không phải file chọn) → không dùng làm resume chính xác; `--restore` cấm mặc định.

## 5. Ma trận năng lực theo phiên bản (đề xuất đóng băng)
| Năng lực | Managed RPC | External TUI | Observer/History |
|---|---|---|---|
| Ẩn/hiện, unpin, xem lịch sử | n/a (UI-only) | n/a | **bật được ngay (Phase 02)** |
| Tạo mới / resume chính xác | UNKNOWN — cần RPC smoke | không (TUI không attach được) | catalog candidate chỉ đề xuất |
| prompt/steer/follow-up/abort | UNKNOWN | UNKNOWN (cần extension riêng) | disabled |
| Approval tool/plan/ask | UNKNOWN (cần response API verify) | UNKNOWN | disabled, fail-closed |
| Activity bubble chi tiết | UNKNOWN | UNKNOWN | chỉ category (VERIFIED: `toolCategories`) |

Mặc định: mọi cờ `OFFICE_OMP_CONTROL/LAUNCH/APPROVAL` OFF; tính năng UNKNOWN giữ disabled.

## 6. Lựa chọn transport (đề xuất)
Native RPC child (`spawn shell:false`, cwd là root đã duyệt) < extension TUI < CLI-per-prompt về độ ghép: chọn **managed native RPC** cho new/resume, **extension controller riêng** (opt-in) cho TUI ngoài; CLI-per-prompt loại vì mất state/duplicate-writer. Single-owner: hai runtime cùng session → `conflict`, khoá lệnh; không dùng PID/mtime làm bằng chứng.

## 7. Chính sách `AGENTS.md` cần user duyệt (chưa sửa)
- §3 "Giữ OMP chỉ-đọc và loopback-only: không … gửi prompt, duyệt lệnh từ xa" và quy tắc không đọc `~/.omp/...` — mâu thuẫn trực tiếp với G3–G6.
- Đề xuất ngoại lệ hẹp: control do server sở hữu, loopback-only, feature-flag OFF mặc định, không đụng token/session thật nếu không được yêu cầu; observer ingest + route Claude bất biến. Chỉ áp dụng sau khi user xác nhận bằng văn bản. Phase 02 không cần ngoại lệ này (UI-only).

## 8. Decision register — cần user duyệt
1. Cho phép Phase 02 (ẩn/hiện, store `data/omp-hidden.json`) tiến hành? (không cần đổi policy)
2. Cho phép chạy `omp --version` + RPC smoke no-model trong fixture cô lập để đóng băng ma trận? (đóng G1 thật)
3. Cho phép sửa `AGENTS.md` theo ngoại lệ ở §7 trước G3?
4. Cho phép cài extension controller (Phase 05) và smoke có chi phí?

## 9. Fixture/rollout (kế hoạch)
Fixture giả `tests/fixtures/omp/fake-rpc-host.mjs` (không chi phí). Rollout: Phase 02 độc lập → G3 flag OFF → bật từng cờ; dừng/rollback = tắt cờ, quay về observer-only, không xoá transcript.

## 10. Kiểm tra đã chạy
- `ak plan validate ./plans/261101-0902-…` → **OK** (định dạng plan).
- `git status/log`, đọc source — PASS (đọc-chỉ). Mọi test code đề xuất: NOT RUN. Có chạy `ls ~/.omp` (chỉ kiểm tra tồn tại, `>/dev/null`, không đọc nội dung) và `where omp`; không đọc `.env`, token, session.

## Câu hỏi chưa giải quyết
- Bản `omp` đang cài là gì, profile nào? (cần approval #2)
- Có chấp nhận ngoại lệ policy §7 không? (#3)
