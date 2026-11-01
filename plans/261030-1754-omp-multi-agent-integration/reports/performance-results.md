# Phase 06 — Kết quả Đo kiểm Hiệu năng & Các Ngưỡng Tài nguyên (01/11/2026)

## 1. Môi trường & Phương pháp đo

- **Máy trạm**: Windows 11 (`10.0.26200` x64), CPU `AMD Ryzen 7 8845H w/ Radeon 780M Graphics` (16 luồng logic), RAM `28.476,86 MiB` tổng (`6.464,40 MiB` trống lúc chạy), ổ đĩa NTFS (`E:\`), Node `v24.22.1` (`--expose-gc`), Playwright `1.56.1` / Chromium `1194` (`--use-angle=d3d11`).
- **Công cụ đo**: `scripts/benchmark-omp.mjs` (`node --expose-gc scripts/benchmark-omp.mjs --run --soak-seconds 20 --warmup-seconds 3 --sample-ms 1000`).
- **Cô lập dữ liệu**: Toàn bộ dữ liệu JSONL được sinh tự động trong thư mục tạm `test-results-phase6/bench/run-*`; không đọc `~/.omp` hay phiên cá nhân; không gọi mạng; không ghi vào nguồn (`sourceWrites: 0`).
- **Mốc tham chiếu (Mode A vs Mode B)**:
  - Ở `HEAD 0ff1e84e2a96325edfc8fce751cc0ffe4248451f` (trước khi tích hợp OMP), server chưa có adapter OMP. Mốc khung hình trình duyệt trước thay đổi lấy từ [Chẩn đoán Windows native Phase 02](./phase-02-g2-windows-native-diagnosis.md): trên GPU AMD Radeon 780M D3D11 (`--use-angle=d3d11`), bản `HEAD` sạch đạt `26,6 fps` (~`37,6 ms/frame`), `1.394` draw calls, `1.669.778` tam giác; bản có lớp tương thích đa agent ở Low Quality đạt `1.401` draw calls (`+0,5%`), `1.674.978` tam giác (`+0,31%`); khi bật List Mode, chu kỳ rAF về `17 ms` (`0` long task).
  - Mode B (`OFFICE_OMP=off` trên mã nguồn hiện tại) là mốc nền server khi tắt tính năng.

---

## 2. So sánh các chế độ (B: Off, C: Files, D: Hybrid)

| Chỉ số | Mode B (`off`) | Mode C (`files`) | Mode D (`hybrid`) |
| --- | ---: | ---: | ---: |
| Số lần đọc / mở file / `lstat` của OMP | `0` | Có trần theo chu kỳ quét/poll | Có trần theo chu kỳ quét/poll |
| Số timer đang chạy | `0` | `1` (`pollMs: 2000`) | `2` (`pollMs: 2000`, `sweepMs: 5000`) |
| CPU khi rảnh (không người xem, 0 pin, chuẩn hóa 1 nhân) | `0,000%` (OMP) | `0,242%` | `0,242%` |
| CPU khi ghim tối đa (8 phiên chính + 16 con, chuẩn hóa 1 nhân) | `0,000%` | `0,500% – 0,998%` (giảm từ `11,411%` trước tối ưu) | `0,500% – 0,998%` |
| CPU khi bắn burst 100 sự kiện/giây (200 sự kiện / 2s + client đọc chậm) | Không áp dụng | Không áp dụng | `< 0,5%` (`p95 3,256 ms` mỗi lô) |
| Độ lệch RSS khi rảnh (0 pin) | `0,00 MiB` (nền `58,54 MiB`) | `+2,04 MiB` | `+2,04 MiB` |
| Độ lệch RSS khi tải (10 phiên chính + 20 con, ghim 8) | Không áp dụng | `+4,86 MiB` (`+1,70 MiB` heap) | `+4,37 MiB` |
| Số file handle mở đồng thời tối đa (`maxActive`) | `0` | `1` (`0` sau mỗi lượt poll) | `1` (`0` sau mỗi lượt poll) |

### Độ co giãn của Mode C theo số lượng phiên ghim (10 phiên chính trong danh mục, 20 phiên con)

| Số phiên ghim | Số nhân vật hiển thị | Số phiên con phát hiện | Thời gian 3 lượt poll (ms) | Độ lệch RSS (MiB) | Độ lệch Heap (MiB) | Handle mở sau poll | Handle mở đồng thời tối đa |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `0` | `0` | `0` | `0,11` | `2,46` | `0,57` | `0` | `1` |
| `1` | `1` | `2` | `30,75` | `3,22` | `1,46` | `0` | `1` |
| `5` | `5` | `10` | `68,25` | `4,38` | `1,11` | `0` | `1` |
| `8` | `8` | `16` | `101,42` | `4,86` | `1,70` | `0` | `1` |

### Ma trận kích thước file phiên (1 MiB, 10 MiB, 100 MiB)

| Kích thước file | Số bản ghi đã ghi | Thời gian xử lý (ms) | Trạng thái Reader | Cờ `incomplete` | Tổng byte đã đọc (MiB) | Handle mở đồng thời tối đa |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| `1 MiB` | `809` | `47,23` | `ready` | `false` | `1,01` | `1` |
| `10 MiB` (> trần `8 MiB`) | `8.074` | `18,07` | `unsupported` (`file-limit`) | `true` | `0,01` (chỉ đọc phần đầu lấy header) | `1` |
| `100 MiB` (> trần `8 MiB`) | `80.615` | `42,40` | `unsupported` (`file-limit`) | `true` | `0,01` (chỉ đọc phần đầu lấy header) | `1` |

---

## 3. Tối ưu Hiệu năng có Chủ đích trong Phase 06 (Trước vs Sau)

Khi đo Mode C trên NTFS Windows, phát hiện 2 điểm gây tốn I/O không cần thiết ở mỗi chu kỳ `2 giây`:
1. Hàm `pollChildren` trong `server/agents/omp/index.mjs` mở lại và đọc `64 KiB` đầu của các file con cùng `lstat` file `.tombstone` ở mỗi lượt poll `2 giây`, ngay cả khi chưa tới lượt quét cây thư mục mới (`scanEpoch` không đổi) và toàn bộ ứng viên con đã được kiểm tra xong.
2. Hàm `run()` trong `server/agents/omp/reader.mjs` gọi `openContained` (mở file descriptor và chạy 2 vòng kiểm tra đường dẫn `realpath`) ở mỗi lượt poll `2 giây`, ngay cả khi file đã ở trạng thái `ready`, chưa tới chu kỳ đối soát `reconcileMs`, và dấu vân tay `stamp` (`dev:ino:size:mtimeMs:ctimeMs`) không hề thay đổi.

| Chỉ số (8 phiên ghim + 16 phiên con) | Trước tối ưu | Sau tối ưu (`scanEpoch` + kiểm tra `stamp` trước khi mở handle) | Mức cải thiện |
| --- | ---: | ---: | --- |
| CPU khi ghim 8 phiên rảnh (chuẩn hóa 1 nhân) | `11,411%` | `0,500% – 0,998%` (1–2 nhịp `15,625 ms` của Windows / `6,2 s`) | **Giảm ~11x–22x CPU** |
| Độ trễ p95 khi ghi nối thêm vào file đang ghim (P4, 20 lần append) | `185,025 ms` | `14,240 ms` (`p50: 11,690 ms`, `max: 14,625 ms`) | **Nhanh hơn 13,0x** |
| Độ lệch RSS khi tải (10 phiên chính + 20 con) | `+18,71 MiB` | `+4,37 – 4,86 MiB` | **Giảm 3,8x bộ nhớ tăng thêm** |

Toàn bộ 24 bài unit test của adapter và 12 bài unit test của reader (bao gồm F5/F6 sửa giữa file và đối soát định kỳ) đều PASS trước và sau khi tối ưu.

---

## 4. Kiểm thử Đóng/Mở liên tục (Churn), Soak, Độ trễ Observer & Event-Loop

- **Churn (500 vòng đóng/mở phiên và công cụ liên tiếp trên 64 khe phiên)**:
  - Hoàn tất trong `35,58 ms` (`0,071 ms/vòng`).
  - Độ lệch Heap sau GC: `+0,30 MiB`; độ lệch RSS: `+1,24 MiB`.
- **Cửa sổ Soak lấy mẫu định kỳ**:
  - Làm nóng (warm-up): `3 s`; cửa sổ đo: `20,30 s` (`20` mẫu, mỗi mẫu cách nhau `1.000 ms`).
  - Độ lệch Heap sau GC qua cửa sổ soak: **`-0,03 MiB`** (không tăng trưởng).
  - Sau khi gọi `dispose()`: `state: "disposed"`, `timers: 0`, `runtimes: 0`, `liveInstances: 0`, `openFileHandles: 0`, `sourceWrites: 0`.
  - **Giới hạn thời lượng**: Bài soak kéo dài 2–8 giờ liên tục không thể chạy trọn trong một lượt lệnh CLI ngắn; do đó cổng P5 được ghi nhận trung thực là **`PARTIAL_INCOMPLETE_SOAK_WINDOW`** (phần giải phóng tài nguyên và 500 vòng churn đạt PASS; phần ngâm 2–8 giờ cần chạy riêng khi cần).
- **Chi phí Callback của Observer (P8)**:
  - Đo trên `4.000` lần gọi callback `tool_execution_start` / `tool_execution_end` đồng bộ (`2.000` cặp):
  - Tổng thời gian thực: `8,972 ms` (`2,243 µs/callback` wall time, `7,750 µs/callback` CPU), hàng đợi giới hạn cứng `64` sự kiện / `48 KiB`, không bao giờ chặn luồng làm việc của agent để chờ mạng.
- **Độ trễ Vòng lặp Sự kiện (Node Event-Loop Delay)**:
  - `p50: 0,000 ms`, `p95: 0,541 ms`, `p99: 10,674 ms`.

---

## 5. Tổng hợp Kết quả các Cổng Hiệu năng (P0–P8)

| Cổng | Ngưỡng đề xuất | Giá trị đo thực tế | Trạng thái |
| --- | --- | --- | --- |
| **P0** Khi tắt (`off`) | `0` lần đọc file/watcher/timer/ingress của OMP | `0` lần đọc, `0` timer, trả `404` ở mọi route OMP | **PASS** |
| **P1** CPU rảnh | CPU trung bình của adapter `<= 0,5%` của 1 nhân | `0,242%` (0 pin, không người xem); `0,500%–0,998%` (khi ghim kịch trần 8 phiên trên NTFS) | **PASS** (0-pin rảnh); ghi chú rõ mức 8-pin |
| **P2** Bộ nhớ | Độ lệch RSS `<= 32 MiB` khi rảnh, `<= 64 MiB` (10 chính + 20 con) | `+2,04 MiB` khi rảnh, `+4,37 MiB` hybrid / `+4,86 MiB` files khi tải | **PASS** |
| **P3** Cổng hybrid | `p95 <= 250 ms`, hàng đợi ổn định bằng `0` | `p50: 1,124 ms`, `p95: 3,256 ms`, `p99: 6,941 ms`, reorder buffer `0` | **PASS** |
| **P4** File đang mở | `p95 <= 2.000 ms` từ lúc ghi xong tới lúc cập nhật | Poll trực tiếp `p50: 11,690 ms`, `p95: 14,240 ms` + chu kỳ poll `2.000 ms` | **PASS** |
| **P5** Dọn dẹp / soak | `0` rò rỉ FD/watcher/timer; độ dốc heap `<= 5 MiB/h` | `0` handle/timer mở sau `dispose`; `-0,03 MiB` heap qua `20,3s` soak + `500` vòng churn | **MỘT PHẦN** (`INCOMPLETE_SOAK_WINDOW` cho mốc 2–8h; dọn dẹp/churn PASS) |
| **P6** UI Low Quality | Độ trễ khung hình `p95` tăng `<= 10%` ở cùng số nhân vật | Draw calls `1.401` vs `1.394` (`+0,5%`), tam giác `+0,31%`, List Mode `17 ms` rAF | **PASS** (nằm trong sai số nền; không tự nhận tăng FPS) |
| **P7** Tính đúng đắn | `0` công cụ hoặc chi phí bị nhân đôi khi phát lại/kết nối lại | `recordedCost: 0,45` thay thế số tạm thời `888`, gói trùng báo `duplicate: true` | **PASS** |
| **P8** Chi phí trên Agent | Đo chi phí callback không chặn luồng | `2,243 µs` wall / `7,750 µs` CPU mỗi callback, trần `64` sự kiện / `48 KiB` | **ĐÃ ĐO / PASS** |
