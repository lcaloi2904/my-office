---
phase: 1
title: "Baseline, compatibility và quyết định môi trường"
status: pending
priority: P1
effort: "Chưa ước lượng"
dependencies: []
---

# Phase 1 — Khóa baseline và compatibility contract

## Goal

Loại bỏ các giả định ảnh hưởng dữ liệu/bảo mật trước source implementation; lập fixture specification mà không đọc transcript cá nhân khi chưa được phép.

## Context và evidence

Đọc [plan](./plan.md), [design contracts](./design-contracts.md), [evidence M1-M20/O1-O8](./evidence.md), `CONTRIBUTING.md`, `package.json`, `playwright.config.ts`. Scout baseline vẫn cùng HEAD; không cần khảo sát lại toàn bộ nếu Git chưa đổi.

## Files / ownership

Trong phase này chỉ cập nhật tài liệu thuộc `/mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration/`: `design-contracts.md`, `validation-matrix.md`, `evidence.md`, `reports/plan-review.md`; có thể tạo `reports/compatibility-decision.md` trong cùng thư mục. Không sửa source, package manifests, .gitattributes, Git config hoặc cấu hình OMP bên ngoài repo. Không xóa file.

## Tasks & Steps

1. Gọi workspace_list lại, xác nhận root; ghi HEAD/status và hash `.gitattributes`/index. Nếu source thay đổi, chỉ kiểm tra lại module bị ảnh hưởng, không restore/reset thay đổi người dùng.
2. Xác nhận D1/D2 từ thông tin người dùng hoặc metadata version ở vị trí đã được phép. Không auto-run OMP để đoán phiên bản, không đọc auth/config tổng quát hoặc quét home. Ghi exact build/version và source pin; commit scout không thay thế binary version.
3. Chốt D3/D4: roots/profile IDs, path mapping và privacy. Trước khi duyệt roots chỉ dùng fixture specification; không tự cấp quyền đọc cả ổ đĩa.
4. Lập compatibility matrix cho file schema/optional title slot, current leaf, runtime identity, execution/approval events, session switch/shutdown, child identity, tools/args và usage provenance. Kiểm tra cả khai báo type lẫn emission/call path ở version đã chọn; mỗi feature có exact / inferred / unsupported.
5. Chốt acceptance cho hai milestones: file-only persisted observability (G3) và hybrid live observability (G4/G5). Nêu rõ unknown/stale thay vì hứa file-only biết liveness.
6. Chốt D7-D9: fork/session/subtree cost scope, worktree grouping, loại subagents. Snapshot context unknown không tự gán giá trị mặc định Claude.
7. Phê duyệt test boundary: unit không network/source agent data; E2E có isolated HOME/DATA_DIR; build/app/benchmark cần quyền riêng. Không ghi một blanket approval cho các bước chưa được duyệt.
8. Hoàn thiện synthetic fixture table trong validation-matrix và permission manifest. Nếu không có environment decisions, đánh dấu gate blocked thay vì triển khai dựa vào giả định.

## Success Criteria / G1

- D1-D4 có câu trả lời hoặc phạm vi synthetic-only được duyệt rõ; không còn root/privacy assumption âm thầm.
- Version matrix phân biệt support thực với feature được khai báo nhưng chưa thử; event names chưa kiểm chứng không đưa vào extension implementation.
- Bất biến identity, source ownership, privacy và cost scope có acceptance test cụ thể.
- Giữ HEAD/index/.gitattributes; chỉ plan docs thay đổi.

## Verification

Chỉ kiểm tra tài liệu/baseline, chưa chạy app/tests:

```bash
GIT_OPTIONAL_LOCKS=0 git status --short --branch
GIT_OPTIONAL_LOCKS=0 git diff --name-only
GIT_OPTIONAL_LOCKS=0 git diff --cached --name-only
sha256sum .gitattributes .git/index
/home/harness/.local/bin/ak plan validate /mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration --json
```

Mọi lệnh chạy ở root đã xác minh; validate chỉ kiểm tra định dạng plan, không phải proof integration hoạt động. Bản CLI tại phiên thực thi phải được kiểm tra còn tồn tại trước dùng.

## Todo

- [ ] Xác nhận baseline mới nhất và phạm vi quyền đọc.
- [ ] Chốt compatibility/version và topology.
- [ ] Chốt roots, privacy, cost/grouping và subagent matrix.
- [ ] Chốt fixture specification và validation permissions.
- [ ] Ghi approval cho Phase 2 hoặc để blocked; không tự chuyển phase.

## Risks / Stop conditions / Rollback

Nếu version không có events cần thiết: vẫn giữ file observer với nhãn giới hạn; dừng kế hoạch realtime để sửa contract, không patch OMP core hoặc cài bản khác. Nếu roots/host chưa rõ: không live scan. Rollback phase này chỉ là chỉnh lại tài liệu do phase tạo, không đụng source/Git baseline.
