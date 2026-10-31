# G2 — CLOSED WITH ACCEPTED EXCEPTIONS

Ngày quyết định: 31/10/2026 (Asia/Ho_Chi_Minh).

## Quyết định và thẩm quyền

Sau khi được thông báo về blocker G2, các E2E chưa ổn định và thiếu revalidation trên HEAD sau merge, người dùng yêu cầu: **“đóng g2 luôn đi”**.

Ghi nhận quyết định này là **đóng gate G2 theo chấp nhận ngoại lệ đã công bố**, không phải xác nhận toàn bộ kiểm thử PASS. G2 không còn chặn phạm vi Phase 03 synthetic-first đã được người dùng yêu cầu bằng `cook plans/261030-1754-omp-multi-agent-integration/phase-03-omp-file-observer.md`.

Đây là quyết định hiện hành, thay thế trạng thái G2 OPEN và yêu cầu dừng Phase 03 trong các handoff/báo cáo trước. Không sửa lại kết quả kiểm thử lịch sử. Checklist về kiểm chứng còn thiếu vẫn để unchecked; trạng thái tiến độ kiểm chứng Phase 02 không đồng nghĩa với trạng thái gate đã được chấp nhận.

## Baseline xác minh khi ghi nhận

- Workspace: `my-office`, `/mnt/e/vide-code/my-office`.
- Branch: `phase-02-omp-seam`.
- HEAD: `4f5858a2c8d59e2efc8597673ceba4828f5aac68`.
- Trước cập nhật: không có tracked diff hoặc staged diff; `.gitattributes` và tài liệu kế hoạch/báo cáo đang untracked.

## Ngoại lệ và việc còn tồn đọng

| ID | Bằng chứng / giới hạn | Trạng thái và cách xử lý |
|---|---|---|
| G2-E1 | Báo cáo Windows-native ghi nhận hai Claude E2E timeout với SwiftShader mặc định, kể cả baseline HEAD sạch cũ. | Chấp nhận không chặn Phase 03 synthetic. Chưa sửa hiệu năng software rendering và chưa chọn GPU làm điều kiện nghiệm thu chung. |
| G2-E2 | Session drawer trên GPU: 7 PASS / 3 FAIL trong một lượt 10 lần; cold start khoảng 31–35 s so với budget 20 s; selector `.first()` còn rủi ro reorder. | Giữ nguyên test/assertions. Chưa phê duyệt riêng cách đổi timeout/selector hoặc renderer chỉ bằng quyết định đóng gate này. |
| G2-E3 | Báo cáo cũ dùng baseline `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`; HEAD hiện tại đã merge và khác baseline đó. | Không coi PASS cũ là revalidation HEAD hiện tại. Cần baseline/checks phù hợp trên revision thực tế khi tiếp tục implementation; thiếu revalidation không được ghi thành PASS. |

Nguồn lịch sử: [Windows-native diagnosis](./phase-02-g2-windows-native-diagnosis.md); [Phase 03 preflight](./phase-03-preflight.md). Số liệu trên được trích lại từ báo cáo, không phải test được chạy trong phiên đóng gate.

Các ngoại lệ chỉ áp dụng cho việc chuyển sang phát triển Phase 03 synthetic-first. Không miễn regression mới do implementation gây ra, không miễn G3 hoặc nghiệm thu hardening/rollout. Các vấn đề này phải được đánh giá lại trước rollout; không tự mở rộng scope sửa renderer/core.

## Ranh giới tiếp tục

Phase 03 đã được yêu cầu triển khai và nay không còn bị G2 chặn. Bắt đầu bằng fixtures tổng hợp, roots test cô lập và observer read-only theo phase đã duyệt. Tài liệu Phase 03 vẫn pending vì phiên đóng gate này chưa triển khai source.

G1 live vẫn chưa được đóng: không đọc transcript/roots OMP thật, không tự bật OMP thật, không cài extension hoặc dependency mới. Không mở Phase 04/hybrid/realtime. Feature flag chỉ được bật cho nguồn fixture cô lập trong phạm vi kiểm thử được duyệt; không thay đổi cấu hình vận hành hiện có.

Không stage, commit, push, merge, thay remote hay sửa `.gitattributes`. Không thay đổi quyền truy cập hoặc dữ liệu của agents.

## Phạm vi thay đổi và kiểm chứng của phiên đóng gate

Chỉ cập nhật tài liệu quyết định và liên kết trạng thái trong `plan.md`, Phase 02, Phase 03 và preflight. Không sửa source, tests, Playwright config, package hoặc lockfile.

Lint, typecheck, unit, build, E2E và benchmark: **NOT RUN** trong phiên đóng gate. Việc kiểm tra cấu trúc/tính nhất quán tài liệu không thay thế những kiểm thử này. Đã đọc lại quyết định trong `plan.md` và entry gate Phase 03: cùng ghi G2 CLOSED WITH ACCEPTED EXCEPTIONS, Phase 03 vẫn pending và nguồn thật/realtime vẫn bị giới hạn. Các patch trên tài liệu có sẵn đều dùng SHA-256 guard và thành công. Kiểm tra `git_status` sau cập nhật không có tracked/staged changes; tài liệu vẫn untracked như baseline, thêm báo cáo acceptance mới. Không chạy `ak plan validate` hoặc coi kiểm tra tài liệu này là nghiệm thu runtime.
