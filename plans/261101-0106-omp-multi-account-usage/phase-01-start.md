---
title: "Phase 01: Safe compatibility & account-source preflight"
status: done
priority: P1
effort: "0.5-1 day"
dependencies: []
---

# Phase 01 — Xác thực nguồn dữ liệu quota an toàn

## Objective / scope

Khóa version, host/profile, schema/semantics và tác dụng phụ của OMP usage **trước khi** chạy collector hoặc polling. G1 không cho phép tự đăng nhập, sửa config, đọc SQLite auth store hoặc tiêu saved resets.

## Verified baseline

- My Office OMP observer/ledger đã có session token/cost; chưa có provider/account identity ổn định.
- Public OMP docs có `omp usage`, `omp usage accounts` và option JSON; profile có thể đổi qua `--profile`/`OMP_PROFILE`/`PI_CODING_AGENT_DIR`; broker có quyền xem bị giới hạn.
- Upstream docs mô tả **một số usage refresh có thể auto-redeem saved resets**, đặc biệt khi gần expiry. Đây là G1 STOP condition, không phải chi tiết được bỏ qua vì câu lệnh tên 'usage'.
- Bản OMP từng smoke trong kế hoạch cũ là 18.14.1; không suy ra binary đang chạy hoặc schema account hiện tại giống upstream main.

## Read-only steps — user approval gate

1. Khảo sát trên **Windows native** với đúng user/profile đang chạy OMP. Chỉ sau khi người dùng duyệt việc khảo sát, xác minh đường dẫn executable và version/help (không đọc in ra credentials); không dùng kết quả WSL làm bằng chứng Windows.
2. Đối chiếu chính xác phiên bản CLI với source/docs tag tương ứng; xác nhận `usage --json` và `usage accounts --json` có tồn tại, đầu ra JSON được định dạng ra sao. Tạo **synthetic sanitized fixtures** thay vì lưu raw OAuth account info.
3. Xác minh flags `--profile`, env precedence, auth broker/pool, local vs broker; default phải chọn cùng profile dùng trong OMP hiện tại. Không duyệt quét toàn bộ `~/.omp/profiles` hay arbitrary users.
4. **Safety investigation trước mọi usage refresh:** đọc upstream execution call path cho `omp usage --json` và các thiết lập `codexResets.autoRedeem`, `claudeResets.autoRedeem`; xác minh có thể gọi mà không consume credits, modify settings, select/pin accounts, hoặc trigger model requests. Nếu không thể bảo đảm, thiết kế nguồn chỉ dùng cache/snapshot thực sự read-only hoặc giữ account quota disabled cho tới khi có quyết định rõ. Không lén chỉnh OMP config sang `autoRedeem:no`.
5. Xác minh identity keys, account freshness, returned utilization type (`used`/`remaining`), quota windows, reset timestamps (seconds vs ms), reported scope model/credit, null vs zero, error fields. Đối chiếu cả Codex và Agy, account có cùng email nhưng khác workspace, identity-less credential.
6. Kiểm tra khả năng lấy provider ID trực tiếp ở raw message/OMP events/`ctx.model` và account identity per request. Chỉ lưu trong docs **trường đã chứng minh**; các trường chưa có phải để UNKNOWN.
7. Đánh giá privacy khi hiển thị local/remote/mobile và mức chấp thuận cần thiết. Chốt test baseline, runner commands và tiêu chí G1 trước cook.

## Deliverables (documentation only)

- Update [evidence](./evidence.md): bảng version/host/profile, source links pinned, supported/unsupported/unknown, sanitized schema contracts.
- Update [validation matrix](./validation-matrix.md) G1 risks, test fixtures requirements; optional sanitized proof report under plan directory after explicit consent.
- Record side-effect decision: `PASS SAFE` / `FAIL CLOSED` / `UNKNOWN -> BLOCK`. Nếu không PASS, không approve collector tự poll.

## File ownership

Không sửa source code trong Phase 01. Chỉ cập nhật `plans/261101-0106-omp-multi-account-usage/*` và tài liệu kiểm chứng được người dùng duyệt. Mọi test sử dụng OMP thật, auth broker, hoặc credentials là **approval riêng**.

## Acceptance / G1

- [x] Native version/profile/command line exact đã xác minh mà không trích xuất secrets.
- [x] Quota JSON contract của nhiều account/multiple windows được ghi thành fixture sanitized; coverage Codex+Agy hoặc rõ unsupported.
- [x] Usage read path đã được chứng minh **không có unapproved saved-reset consumption**; nếu không, polling tự động bị chặn.
- [x] Schema provider/model/account attribution phân thành exact/inferred/unsupported; không có assumption account identity ẩn.
- [x] Windows vs WSL and broker boundaries, privacy controls và rollback quyết định rõ.

## Risks, stop conditions & validation

G1 STOP nếu phải đọc `agent.db` hoặc bearer để chạy, CLI dùng user/profile khác, command refresh có thể tiêu reset ngoài sự đồng ý, schema version không nhận biết, hoặc CLI xuất secrets. Chỉ inspect doc/source/help thuộc phạm vi được duyệt; **không có lint/build/E2E** cho phase chỉ nghiên cứu.

## Todo

- [x] Pin Windows native environment và version
- [x] Audit quota read side effects và documented usage JSON
- [x] Chốt identity/semantics và fixtures sanitized
- [x] G1 evidence + explicit approval trước Phase 02
