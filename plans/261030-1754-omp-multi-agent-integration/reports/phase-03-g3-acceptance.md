# G3 — CLOSED WITH ACCEPTED EXCEPTIONS

Ngày quyết định: 31/10/2026 (Asia/Ho_Chi_Minh).

## Quyết định và thẩm quyền

Sau khi được báo cáo kết quả kiểm chứng Phase 03 và các điểm còn thiếu, người dùng yêu cầu: **“Đóng G3 đi”**.

Đây là **đóng gate G3 theo chấp nhận ngoại lệ đã công bố**, không phải xác nhận mọi kiểm thử PASS. Quyết định thay thế mọi dòng "G3 vẫn OPEN" trong các báo cáo Phase 03 trước đó (phần lịch sử giữ nguyên, không sửa lại kết quả cũ).

## Baseline khi ghi nhận

- Branch `phase-02-omp-seam`, HEAD `4f5858a`; 31 mục thay đổi/untracked trong working tree, **chưa commit/push**.
- Windows native, Node v24.22.1.

## Tiêu chí G3 và bằng chứng

| Tiêu chí (phase-03-omp-file-observer.md) | Bằng chứng | Mức |
|---|---|---|
| F1–F12/U1–U4 đạt expected output; rebuild/restart không nhân đôi tool hoặc usage | `node --test` 164/164, ESLint 0 vấn đề, tsc exit 0; tests `omp-paths/reader/normalize/usage/projection/adapter` | Đạt, trên fixture synthetic |
| Nguồn không bị tạo/sửa/đổi quyền | Test dùng IO chỉ-đọc (mọi lệnh ghi bị từ chối); chạy adapter trên cây thật qua lớp bọc chặn ghi, chỉ `lstat`/`realpath`/`opendir`/`open` | Đạt bằng cô lập và chặn lệnh ghi; **không** có hash trước/sau trên cây thật |
| Phân biệt lịch sử/đang chạy trên UI | E2E OMP 3/3: nhãn persisted-only, drawer chỉ đọc, bỏ pin thì actor biến mất; liveness luôn `unknown`/`historical` | Đạt |
| Title overwrite, branch/continuation đúng; schema lạ chỉ làm OMP degraded, Claude vẫn chạy | Unit; `agents.spec` 6/6 | Đạt |
| File-only demo bằng fixture synthetic, không cần OMP/LLM | `playwright.omp.config.ts` + `tests/e2e/omp-fixture.mjs`, 3/3 | Đạt |
| F9 (nested artifacts, tombstone, advisor, không auto-spawn actor) | Cây thật, chỉ cấu trúc, người dùng duyệt: 588 chính, 785 con, 22 tombstone; adapter 588/588, con không là actor | Đạt trên một bản cài OMP |

Chi tiết và số đo: [adapter/UI report](./phase-03-adapter-ui-integration.md) (mục "F9 trên cây thật"), [diff review](./phase-03-diff-review.md), [implementation](./phase-03-implementation.md).

## Ngoại lệ được chấp nhận

| ID | Giới hạn | Xử lý |
|---|---|---|
| G3-E1 | Chỉ kiểm trên một bản cài OMP (schema v3); chưa xác định phiên bản OMP cụ thể. Optional feature giữa các build có thể khác. | Không suy rộng sang bản khác; unknown schema vẫn degrade an toàn. |
| G3-E2 | Bốn Claude E2E dùng script `.sh` giả (tunnel, giao việc từ chat, thêm account, chuyển account) không chạy được trên Windows native (`EFTYPE`); cũng fail ở baseline. Chưa chạy trên Linux/macOS/WSL. | Cần môi trường POSIX trước rollout. |
| G3-E3 | Bài Mixue (`office.spec`) fail 5/5 trên cây hiện tại và 3/3 trên baseline HEAD sạch `4f5858a`; nguyên nhân chưa tìm ra. Không phải hồi quy Phase 03. | Điều tra riêng nếu cần. |
| G3-E4 | Group chat và phone window fail trong một lượt suite đầy đủ trên GPU, pass khi chạy riêng; chưa đối chứng trên baseline ở lượt đầy đủ. Lượt GPU trước đó (54/58) pass hai bài này. | Theo dõi độ ổn định; không coi là PASS đã xác nhận ở lượt đầy đủ gần nhất. |
| G3-E5 | Suite Claude trên SwiftShader (24 fail) giống baseline HEAD sạch; kế thừa G2-E1. | Không miễn regression mới. |
| G3-E6 | Chưa chạy: đọc hội thoại thật (`conversation` giữ `false`), UI trên dữ liệu thật, phát metadata pin tới client từ xa thật (chỉ có test hợp đồng + review), benchmark CPU/RAM/soak. | Đánh giá lại trước rollout (G6). |
| G3-E7 | 3/588 session chính lớn hơn 8 MiB (lớn nhất 8,5 MiB) sẽ báo vượt giới hạn khi ghim. Trần 8 MiB là quyết định của người dùng. | Giữ nguyên. |
| G3-E8 | Working tree chưa commit; không có tag/revision bất biến cho bằng chứng. | Commit/push chỉ khi người dùng yêu cầu. |

## Ranh giới tiếp tục

G3 closed không mở thêm quyền nào:

- OMP production vẫn **mặc định tắt**. Chỉ bật khi đặt `OFFICE_OMP=files` và `OFFICE_OMP_CONFIG=<đường dẫn>`; config thật nằm ở `data/omp-config.json` (gitignored, `conversation: false`, 13 ánh xạ project). `hybrid` chưa triển khai và vẫn tắt.
- **Phase 04 chưa được mở.** G1 live, D6 (cài extension vào cấu hình OMP của người dùng), realtime/hybrid và mọi điều khiển OMP cần quyết định riêng.
- Không chạy OMP, không gọi model, không cài package; không commit/push.
- Quyền đọc nội dung thật chỉ ở mức cấu trúc đã duyệt cho F9. Bật `conversation` hoặc đọc hội thoại thật cần approval mới.

## Phạm vi của phiên ghi nhận

Chỉ cập nhật tài liệu (báo cáo này, `plan.md`, file Phase 03). Không sửa source/tests/config trong phiên này. Không chạy lại lint/test/build; các số liệu trên lấy từ lượt chạy gần nhất đã ghi trong các báo cáo liên kết.

## Câu hỏi còn mở

1. Khi nào chạy bốn test `.sh` trên môi trường POSIX (WSL/Linux)?
2. Có điều tra bài Mixue không (fail có sẵn ở baseline)?
3. Có commit nhánh `phase-02-omp-seam` để có revision bất biến cho bằng chứng không?
