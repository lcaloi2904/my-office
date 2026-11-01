# Phase 06 — Danh mục Kiểm tra Triển khai & Khôi phục (Rollout & Rollback Checklist) (01/11/2026)

## 1. Tổng hợp Trạng thái các Cổng Nghiệm thu (G1–G6)

| Cổng | Trạng thái | Bằng chứng & Các ngoại lệ còn mở |
| --- | --- | --- |
| **G1** Hợp đồng thiết kế, thư mục gốc, quyền riêng tư | **ĐÃ ĐÓNG (PHẠM VI LOCAL)** | Đã khóa schema v3 (`6a86df8539fccf3ad7818081266e554022fc21bc`), xác nhận bản cài OMP `18.14.1`/`18.14.2` trên Windows 11, kho lưu trữ riêng tư `~/.omp/office-private/`, và mặc định chỉ đọc metadata (`conversation: false`). Mô hình khác máy (`D10`) tiếp tục khóa. |
| **G2** Lớp tương thích & cô lập Claude Code | **ĐÃ ĐÓNG KÈM NGOẠI LỆ** | [Quyết định G2](./phase-02-g2-acceptance.md); `agent-compat.test.mjs`, `agents.spec.ts` (13/13), `chat-preview.spec.ts` (2/2), và `@smoke` (5/5) đều PASS trên Windows Chromium D3D11. 4 bài test cũ trong `office.spec.ts` gọi script giả `.sh` (`fake-claude.sh`, `fake-cloudflared.sh`) là giới hạn môi trường Windows native đã biết. |
| **G3** Bộ quan sát file OMP (`files`) | **ĐÃ ĐÓNG KÈM NGOẠI LỆ** | [Quyết định G3](./phase-03-g3-acceptance.md); toàn bộ unit test `omp-paths`, `omp-reader`, `omp-normalize`, `omp-usage`, `omp-adapter` và E2E `omp-files.spec.ts` (3/3) đều PASS. |
| **G4** Bộ quan sát trực tiếp (`hybrid`) | **CÒN MỞ BIÊN (ĐÃ XÁC MINH PHẦN LÕI)** | [Xác minh local G4](./phase-04-local-validation.md) & [Khắc phục ACL/token](./phase-04-token-remediation.md): đã sửa DACL riêng tư trên Windows + xoay vòng token (`omp-private-storage.test.mjs` 22/22, `omp-hybrid.spec.ts` 1/1); đã xác minh callback thực tế trên 18.14.1 print/RPC và 18.14.2 TUI. **Còn mở**: nhánh bấm `Escape` hủy kế hoạch & tự động chạy tiếp sau plan, tiến trình RPC chờ đóng stdin EOF sau shutdown, và vận chuyển sự kiện chéo máy. Trạng thái chờ của hộp thoại `ask` và luồng live của subagent được ghi nhận rõ là không hỗ trợ. |
| **G5** Giao diện đa Agent & Replay | **ĐÃ XÁC MINH (WINDOWS CHROMIUM)** | [Báo cáo Phase 05](./phase-05-implementation.md): đã xác minh V1–V8; trần 64 nhân vật / 32 con trên cảnh 3D, cây cha–con thật trong Drawer, phân trang ngược hội thoại, công cụ song song trên Timeline, và phát lại (replay) không gây tác dụng phụ. |
| **G6** Gia cố, hiệu năng, tài liệu, khôi phục | **ĐÃ XÁC MINH (KÈM GIỚI HẠN SOAK/CROSS-OS)** | [Rà soát bảo mật](./security-review.md) (S1–S9 PASS cục bộ), [Kết quả hiệu năng](./performance-results.md) (P0–P4, P6–P8 PASS; P5 dọn dẹp/500 vòng churn PASS, soak 2–8h ghi `PARTIAL_INCOMPLETE_SOAK_WINDOW`), đã đồng bộ [OMP-INTEGRATION.md](../../../docs/OMP-INTEGRATION.md) và [AGENTS.md](../../../AGENTS.md). |

---

## 2. Kết quả Chạy Cổng Kiểm chứng Cuối cùng trong Phase 06

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả |
| --- | --- | --- |
| ESLint | `node node_modules/eslint/bin/eslint.js .` | **PASS** (0 lỗi, 0 cảnh báo) |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | **PASS** (0 lỗi) |
| Unit tests (bộ chạy nhanh, 22 file) | `node --test tests/unit/agent-*.test.mjs ...` | **205/205 PASS** |
| Unit tests (kho lưu trữ riêng tư Windows DACL) | `node --test tests/unit/omp-private-storage.test.mjs` | **22/22 PASS** |
| Benchmark tổng hợp & kiểm tra ngưỡng tài nguyên | `node --expose-gc scripts/benchmark-omp.mjs --run` | **PASS** (`P0`–`P4`, `P7`, `P8` PASS; `P5` dọn dẹp PASS / cửa sổ soak giới hạn theo CLI) |
| E2E đa Agent, bảo mật & xem trước chat | `playwright test -c test-results-p3-gpu/playwright.gpu.config.ts tests/e2e/agents.spec.ts tests/e2e/chat-preview.spec.ts` | **15/15 PASS** |
| E2E chế độ OMP `files` | `playwright test -c playwright.omp.config.ts` | **3/3 PASS** |
| E2E chế độ OMP `hybrid` | `playwright test -c playwright.hybrid.config.ts` | **1/1 PASS** |
| E2E Claude `@smoke` | `playwright test -c test-results-p3-gpu/playwright.gpu.config.ts tests/e2e/office.spec.ts --grep @smoke` | **5/5 PASS** |
| Toàn vẹn `.gitattributes` | `sha256sum .gitattributes` | `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7` (giữ nguyên) |

---

## 3. Quy trình Bật tính năng theo Từng bước (Staged Opt-In Rollout)

1. **Mặc định Tắt (`OFFICE_OMP=off`)**:
   - Mặc định trong `server/index.mjs` luôn là `off`. Không có bất kỳ file hay thông tin xác thực OMP nào được đọc nếu người dùng không chủ động bật.
2. **Bước 1 — Chế độ Chỉ đọc File (`OFFICE_OMP=files`)**:
   - Chuẩn bị `data/omp-config.json` với 1 nguồn cục bộ đã duyệt (`conversation: false`).
   - Khởi động My Office với `OFFICE_OMP=files` và `OFFICE_OMP_CONFIG=<đường dẫn tuyệt đối>`.
   - Kiểm tra `http://127.0.0.1:4310/api/doctor` báo `effectiveMode: "files"` và `sources[0].state: "ok"`.
   - Mở hộp thoại Lịch sử (History picker) trên trình duyệt cục bộ, ghim tối đa 8 phiên và xác nhận các nhân vật mang nhãn `History · not live` hiển thị bình thường mà không ảnh hưởng tới Claude Code.
3. **Bước 2 — Chế độ Trực tiếp (`OFFICE_OMP=hybrid`, Từng Profile Một)**:
   - Xác nhận `~/.omp/office-private/ingest.json` và `~/.omp/office-private/observer.json` đã có DACL bảo vệ riêng tư (`preparePrivateFile` / `writePrivateJson`).
   - Khởi động My Office với `OFFICE_OMP=hybrid` và `OFFICE_OMP_CONFIG=<đường dẫn tuyệt đối>` (hoặc chạy qua `start-office.cmd` trên máy Windows này).
   - Kiểm tra `http://127.0.0.1:4310/api/doctor` báo `effectiveMode: "hybrid"` và `ingress.sources: 1`.
   - Bật extension đi kèm trên 1 profile OMP (`~/.omp/agent/extensions/office-observer/{index.js,private-storage.js}`) và quan sát trạng thái phiên/công cụ/chờ duyệt cập nhật trực tiếp. Không bật đồng loạt trên nhiều profile hoặc mô hình khác máy.

---

## 4. Kiểm chứng Khôi phục & Gỡ bỏ (Rollback & Recovery)

| Kịch bản | Hành vi đã xác minh |
| --- | --- |
| **`OFFICE_OMP=off`** | `0` timer, bộ đọc file hoặc phiên live của OMP; `/api/omp/catalog`, `/api/omp/pin` và `/ingest/omp/v1` đều trả `404`; mọi hook, ngăn chi tiết và nút điều khiển của Claude Code hoạt động bình thường. |
| **Tự động hạ `hybrid` → `files`** | Nếu `OFFICE_OMP_INGEST_FILE` / `~/.omp/office-private/ingest.json` thiếu thư mục cha `.omp`, sai quyền DACL hoặc chứa JSON lỗi, `startOmpIngress()` sẽ đóng an toàn (`ompBridge = null`, `reason: "ingress-failed"`), `effectiveMode` tự hạ về `"files"`, các phiên đã ghim giữ nguyên `persistedOnly: true` / `liveness: unknown`, và Claude không bị ảnh hưởng. |
| **Xoay vòng / Thu hồi Token** | Khi đổi token trong `~/.omp/office-private/ingest.json`, các tiến trình observer cũ lập tức nhận mã `401` và tự ngừng gửi vĩnh viễn (`factory.dispose()`), trong khi tiến trình OMP mới đọc `observer.json` mới nhận mã `200`, còn các nguồn khác và các phiên Claude tiếp tục chạy bình thường. |
| **Bảo toàn Dữ liệu Nguồn** | Khi tắt OMP, bỏ ghim phiên hoặc gỡ extension, hệ thống không bao giờ xóa hay sửa `~/.omp/agent/sessions`, `~/.omp/agent/config.yml` hoặc bất kỳ dữ liệu profile nào của OMP. |
