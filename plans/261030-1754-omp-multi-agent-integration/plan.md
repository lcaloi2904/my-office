---
title: "OMP read-only integration cho My Office"
description: "Giữ nguyên Claude Code, thêm OMP file observer và realtime extension qua adapter độc lập, có kiểm chứng và rollback."
status: in-progress
priority: P2
effort: "Chưa ước lượng; phụ thuộc compatibility gate và baseline"
branch: main
tags: [feature, backend, frontend, api, experimental]
blockedBy: []
blocks: []
created: 2026-10-31
---

# Kế hoạch tích hợp OMP vào My Office

## Quyết định hiện hành — 31/10/2026

**G2: CLOSED WITH ACCEPTED EXCEPTIONS**, theo yêu cầu của người dùng: “đóng g2 luôn đi”. Đây là chấp nhận ngoại lệ để tiếp tục Phase 03 synthetic-first đã được yêu cầu, **không phải kết luận mọi kiểm thử PASS**. Quyết định, rủi ro tồn đọng và ranh giới quyền nằm tại [G2 acceptance](./reports/phase-02-g2-acceptance.md).

Quyết định này thay thế mọi chỉ dẫn G2 OPEN/dừng tại Phase 02 trong lịch sử bên dưới. Phase 02 vẫn có kiểm chứng chưa hoàn tất; các checklist đó không được tick thay cho bằng chứng. Phase 03 chưa triển khai nhưng không còn bị G2 chặn. G1 live, nguồn OMP thật và các phase realtime vẫn chưa được mở. Không commit/push.

**G3: CLOSED WITH ACCEPTED EXCEPTIONS** (31/10/2026), theo yêu cầu của người dùng: “Đóng G3 đi”. Phase 03 (OMP file-only observer) đã triển khai và kiểm chứng trên fixture synthetic và, ở mức cấu trúc, trên cây OMP thật; đây **không phải kết luận mọi kiểm thử PASS**. Ngoại lệ, bằng chứng và ranh giới quyền nằm tại [G3 acceptance](./reports/phase-03-g3-acceptance.md). OMP production vẫn mặc định tắt; Phase 04, G1 live, extension và hybrid chưa được mở. Chưa commit/push.

## Overview

Kết quả mục tiêu: quan sát đồng thời Claude Code và OMP trên UI hiện có, không cho dashboard điều khiển OMP. Triển khai tuần tự: khóa contracts → compatibility seam → file-only PoC → hybrid realtime → UI đầy đủ → hardening.

**Cập nhật 31/10/2026 — RAIL-01 đã sửa sau khi được phê duyệt mở scope.** `activity.js` đã hiển thị unknown/unsupported sessions trên rail, không suy trạng thái/thời gian/metrics giả. Lint/typecheck/build PASS, unit 48/48 PASS, sáu agent E2E PASS với budget mặc định 90s và retries=0. Selected Claude regression tại 1440×900: 3/4 PASS ở 180s/trace-on và 2/4 PASS ở mặc định 90s/trace-off; panels/drawer còn timeout, một lượt ghi nhận popup chat chặn nút đóng; không coi lượt này PASS và **G2 chưa đóng hoàn toàn**. Diagnostic riêng và kết quả cuối ở [RAIL-01 repair](./reports/phase-02-rail01-fix.md). OMP vẫn off, G1 live và Phase 03 không được mở.

Các checklist phase phản ánh phần đã thực hiện và phần còn thiếu evidence; không tick toàn bộ G2 chỉ vì lỗi rail đã được sửa.

Baseline: `/mnt/e/vide-code/my-office`, branch `main`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`. Khi bắt đầu lập kế hoạch chỉ có `.gitattributes` untracked; không sửa file này. Timestamp thư mục do AgentKit CLI sinh theo thời gian của CLI; ngày tài liệu là 31/10/2026 tại Asia/Ho_Chi_Minh.

## Phases

| # | Phase | Depends on | Gate | Status |
|---|---|---|---|---|
| 1 | [Baseline, compatibility và quyết định](./phase-01-start.md) | Không | G1: contracts/roots/privacy được chốt | Pending |
| 2 | [Compatibility seam và cô lập Claude](./phase-02-compatibility-seam.md) | 1 | G2: CLOSED WITH ACCEPTED EXCEPTIONS — [quyết định](./reports/phase-02-g2-acceptance.md) | In progress — RAIL-01 fixed; regression verification pending |
| 3 | [OMP file-only observer](./phase-03-omp-file-observer.md) | 2 | G3: CLOSED WITH ACCEPTED EXCEPTIONS — [quyết định](./reports/phase-03-g3-acceptance.md) | Completed with exceptions |
| 4 | [Observer extension và hybrid realtime](./phase-04-realtime-observer.md) | 3 | G4: bounded bridge; idempotent reconciliation | Pending |
| 5 | [UI/UX và observability đầy đủ](./phase-05-ui-observability.md) | 4 | G5: mixed-agent E2E, subagents, replay | Pending |
| 6 | [Cross-OS, security, performance và rollout](./phase-06-hardening-rollout.md) | 5 | G6: regression + số đo + docs + rollback | Pending |

Các phase chia sẻ `server/index.mjs` và frontend consumers, nên không triển khai song song. Phase 3 đã có UI tối thiểu để nghiệm thu độc lập; Phase 5 mở rộng chất lượng hiển thị, không phải lần đầu mới bổ sung safety gates.

## Contracts và bằng chứng

- [Thiết kế, quyết định và ranh giới quyền](./design-contracts.md) là contract đề xuất, không phải API đang tồn tại.
- [Source map và nguồn chính thức](./evidence.md) phân biệt VERIFIED / INFERRED / UNKNOWN.
- [Ma trận kiểm thử và performance gates](./validation-matrix.md) phân biệt lệnh đã có và file kiểm thử sẽ tạo.
- [Review kế hoạch và execution log](./reports/plan-review.md) ghi giới hạn review, câu hỏi chưa được trả lời và kết quả kiểm tra tài liệu.

## Scope

Bao gồm session/tool/subagent observability, conversation/timeline/replay, project grouping, usage có provenance, read-only security, Windows–WSL path/transport compatibility, Low Quality/List Mode và benchmark trước/sau.

Không bao gồm OMP prompt/approval/kill/revive/account controls; không tích hợp Codex/Gemini trong đợt này. Không import toàn bộ OMP SDK vào Node server. Collab là lựa chọn bổ sung đã đánh giá, không phải dependency hay implementation phase mặc định. Không refactor toàn bộ Claude monolith hoặc dựng lại UI.

## Dependencies và approval gates

Không có cross-plan dependency đã xác định trong repository. Các blocker triển khai nằm trong G1: version OMP đang dùng, source roots, host topology, privacy và quyền chạy validation. Backend Node ESM và các dependencies hiện tại được giữ nguyên; mọi dependency mới phải được duyệt riêng.

Đề xuất mặc định: OMP tắt; roots explicit; metadata-first; conversation bật riêng; không external translation; same-host trước rồi xác minh Windows–WSL; không tự mở firewall/LAN. Đây là **PROPOSED**, không phải quyết định đã được người dùng xác nhận.

## Success Criteria

- [ ] G1–G6 có bằng chứng; không tự đánh dấu hoàn thành khi chỉ có plan hoặc test chưa chạy.
- [ ] Claude regression pass; OMP không đi vào scanner, usage, account hoặc controls của Claude.
- [ ] File history không tạo session live giả; stale không bị biến thành terminated/completed.
- [ ] Duplicate/restart/rewrite/fork/subagent fixtures và security negative cases đạt ma trận.
- [ ] Performance gates được hiệu chỉnh từ baseline; kết quả ghi rõ môi trường và số đo.
- [ ] README/architecture/troubleshooting đồng bộ; rollback không đụng dữ liệu agents.

## Validation Log

Đã tái kiểm tra Git baseline, các điểm nối source, scripts và test isolation. OMP schema được đối chiếu tại commit cố định của scout, chưa xác nhận phiên bản đang cài. Chỉ kiểm tra định dạng/tính nhất quán tài liệu trong phiên lập kế hoạch; không chạy ứng dụng, lint, typecheck, test, build hoặc benchmark. Chi tiết và trạng thái kiểm tra cuối ở [review](./reports/plan-review.md).

## Red Team Review

Review inline theo bốn góc nhìn: assumptions, failure modes, security, scope. Không phải bốn subagents độc lập. Các guard về controls, quota, history/live, stale, rewrite và quyền cài extension được đưa vào phase liên quan; còn environment decisions ở G1.

## Handoff hiện hành

G2 đã đóng theo ngoại lệ tại [G2 acceptance](./reports/phase-02-g2-acceptance.md). Bước triển khai kế tiếp là Phase 03 synthetic-first theo approval đã có; không còn yêu cầu đóng G2 lần nữa. Các giới hạn kiểm thử còn thiếu, nguồn thật và realtime giữ nguyên như quyết định. Không sửa source hoặc chạy kiểm thử runtime trong phiên đóng gate.

### Lịch sử handoff trước quyết định đóng G2

Đã sửa RAIL-01, chạy lại original failing E2E và giữ nguyên assertions. Source fix và agent E2E đã đạt; G2 còn kết quả timeout của một ca Claude panels trên viewport mặc định, được điều tra riêng trong [repair report](./reports/phase-02-rail01-fix.md), không che bằng retry hoặc hạ assertion. Giữ nguyên Phase 02; không chuyển Phase 03, không bật OMP thật, không commit/push. Không yêu cầu lại quyền sửa activity.js đã được phê duyệt.

**Cập nhật 31/10/2026 (Windows native) — G2 vẫn OPEN, chờ quyết định điều kiện nghiệm thu.** Hai timeout Claude là lỗi môi trường có sẵn từ HEAD sạch: Chromium mặc định dùng SwiftShader nên mỗi frame chặn main thread ~3 s; có GPU thì panels PASS 10/10, session drawer còn cold start 31–35 s so với budget 20 s (3/10 FAIL). Không đổi source. Chi tiết, số liệu và đề xuất: [Windows-native diagnosis](./reports/phase-02-g2-windows-native-diagnosis.md). Lịch sử các lượt trước giữ nguyên.

