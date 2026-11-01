# Phase 06 — Báo cáo Rà soát Bảo mật & Cô lập (S1–S9) (01/11/2026)

## 1. Kết luận Tổng quan

**Kết quả: ĐẠT (PASS) cho phạm vi vận hành cục bộ trên máy (không còn lỗi bảo mật chặn rollout opt-in; kết nối chéo máy qua HTTP thường tiếp tục bị khóa theo thiết kế).**

Toàn bộ các chốt kiểm soát chỉ-đọc, xác thực nguồn, giới hạn tốc độ/dung lượng, cô lập đường dẫn, che dấu bí mật, chống XSS, cô lập quyền điều khiển Claude và lưu trữ token riêng tư bằng Windows DACL (S1–S9) đã được kiểm chứng bằng bộ unit test, E2E test phủ định và các bản vá gia cố trong Phase 06.

---

## 2. Ma trận Kiểm chứng Bảo mật S1–S9

| Mã | Kịch bản tấn công / Trường hợp phủ định | Cơ chế bảo vệ đã triển khai | Bằng chứng kiểm chứng | Kết quả |
| --- | --- | --- | --- | --- |
| **S1** | Thiếu/sai/đã xoay vòng token, dùng token của nguồn A gửi cho nguồn B, có header `Origin` từ trình duyệt, đi qua Cloudflare tunnel (`viaTunnel`), IP ngoài loopback, dùng PIN/cookie/query của điện thoại | `bridge.mjs`: chỉ nhận loopback (`req.loopback === true && !req.viaTunnel`), từ chối mọi request có header `Origin` (`403`), bắt buộc `Authorization: Bearer <64-hex>` (đúng độ dài `71`), so khớp hằng thời gian `timingSafeEqual` trên băm SHA-256 của mọi nguồn, bắt buộc `event.sourceId === sourceId` (`422 source-mismatch`). | `omp-bridge.test.mjs` (`S1`), `agent-compat.test.mjs` (`/ingest/omp/v1`), [Báo cáo khắc phục token](./phase-04-token-remediation.md) (`token cũ 401 / mới 200 / khác nguồn 422`). | **PASS** |
| **S2** | Payload quá lớn (`> 64 KiB`), lô quá nhiều sự kiện (`> 32`), gửi nhỏ giọt câu giờ (`> 5 s`), vỏ JSON sai cấu trúc (`null`, số, `{"events":"bad"}`), gửi dồn dập (flood) | `bridge.mjs`: kiểm tra `Content-Length` trước khi đọc (`413`), giới hạn byte khi đọc luồng + timeout `5 s` kèm hủy socket `abort()` (`413`/`408`), giới hạn tốc độ theo từng nguồn (`burst: 200`, `50/s`, trả `429 retryAfterMs`), kiểm tra nghiêm ngặt vỏ lô (`400 invalid-batch`), lọc trường qua allowlist `normalizeOmpLiveEvent`. `reader.mjs`: xả bỏ dòng `> 64 KiB`, từ chối file `> 8 MiB`. | `omp-bridge.test.mjs` (`S2`), `omp-reader.test.mjs` (`F4`, `F12`), `omp-normalize.test.mjs`. | **PASS** |
| **S3** | Đọc đường dẫn tùy ý qua header/sự kiện (`previousSessionFiles`, `seanceSource`, `cwd`), leo thư mục `..`, thoát ra ngoài qua symlink/junction/hardlink, đánh tráo file giữa lúc kiểm tra và mở (TOCTOU), tên thiết bị Windows (`CON`, `NUL`, `COM1`), dấu chấm/khoảng trắng cuối tên, luồng dữ liệu phụ ADS (`:stream`), ký tự DEL (`\x7f`) | `paths.mjs`: `approveRoot` + `containedPath` + `openContained` (`O_RDONLY | O_NOFOLLOW`, `nlink === 1`, `lstat` từng cấp thư mục, đối chiếu `realpath`, xác minh lại `dev:ino` sau khi mở file, kiểm tra từng phân đoạn từ chối `.`, `..`, đoạn rỗng, dấu cách/chấm ở cuối, `:`, `\x00-\x1f\x7f`, và tên thiết bị Windows `CON`/`PRN`/`AUX`/`NUL`/`COM*`/`LPT*`). Route `/api/omp/pin` chỉ nhận mã công khai `omp:<sha256>`. | `omp-paths.test.mjs` (`F11/S3`, junction/symlink/hardlink thật trên NTFS, TOCTOU, Unicode/khoảng trắng vs tên thiết bị), `omp-adapter.test.mjs` (`F11`), `omp-files.spec.ts`. | **PASS** |
| **S4** | Lộ chuỗi bí mật trong prompt, tiêu đề, tham số/kết quả công cụ, thông báo lỗi hoặc mã chẩn đoán | Chế độ metadata loại bỏ hoàn toàn prompt, tiêu đề, tham số, kết quả công cụ, suy luận và đường dẫn gốc. Mã chẩn đoán chỉ phát mã cố định (`errorCode()`), không bao giờ chứa thông điệp lỗi gốc hay đường dẫn file. Hội thoại opt-in đi qua `redact()` (`server/redact.mjs`) và cắt ở mức `4.000` ký tự/mục. `broadcast(msg, true)` giữ dữ liệu OMP ở phạm vi cục bộ, không gửi ra LAN/điện thoại/tunnel và không ghi vào `data/replay/*.jsonl`. | `omp-normalize.test.mjs` (`S4/S9`), `omp-adapter.test.mjs` (kiểm tra sentinel `PRIVATE`), `omp-files.spec.ts`, `omp-hybrid.spec.ts`. | **PASS** |
| **S5** | Mã độc HTML / `<script>` / `<svg onload>` / `<img onerror>` / ảnh markdown tự tải trong tên phiên, tiêu đề, tên dự án hoặc nội dung hội thoại | `baseName` và `projectFields` lọc chỉ giữ `[\p{L}\p{N} ._-]`. Giao diện hiển thị qua `textContent` / các hàm tạo DOM trơ (`session-drawer.js`, `activity.js`, `lite.js`, `omp-history.js`); thẻ ảnh trong hội thoại OMP bị loại bỏ hoàn toàn (`#ds-body .msg-body img` bằng `0`). | `omp-projection.test.mjs`, `omp-files.spec.ts` (`__injected` bằng `false`), `agents.spec.ts` (`S1/S5/S8` `__ompXss` bằng `false`). | **PASS** |
| **S6** | Sự kiện OMP hoặc request giả mạo cố gọi các route điều khiển của Claude (`/api/open`, `/api/tasks`, `/api/accounts/*`, `/rc`, tắt tiến trình, trả lời duyệt quyền) | `capabilitiesFor('omp')` khóa mọi quyền điều khiển về `false` (chỉ `readConversation` được bật bởi cấu hình server trên phiên đã ghim). `isClaudeRequest` và `resolveForControl` kiểm tra chủ sở hữu phiên ngay trên server (`403 agentReadOnly`). Phản hồi của bridge chỉ chứa `{ ok, results, resync }`. | `agent-schema.test.mjs`, `agent-compat.test.mjs`, `omp-live-merge.test.mjs` (`S6`), `agents.spec.ts`, `omp-hybrid.spec.ts`. | **PASS** |
| **S7** | Lộ file lưu token cục bộ (Windows DACL / POSIX mode) và truyền token qua HTTP thường giữa hai máy | `integrations/omp/private-storage.js` tạo thư mục riêng tư kèm DACL bảo vệ ngay lúc khởi tạo trên Windows (chỉ owner, `SYSTEM`, `Administrators`; kiểm tra quyền `DELETE`/`DELETE_CHILD`/`WRITE_DAC`/`WRITE_OWNER` trên toàn chuỗi cha; chặn reparse/hardlink) và `0700`/`0600` trên POSIX. File lỗi hoặc `null` đều từ chối an toàn (fail closed). `office-observer.js` từ chối mọi URL không phải loopback. | `omp-private-storage.test.mjs` (22/22 PASS), [Báo cáo khắc phục token](./phase-04-token-remediation.md). Kết nối chéo máy tiếp tục **BỊ KHÓA** theo thiết kế cho tới khi có kênh tunnel xác thực được phê duyệt. | **PASS** (cục bộ) / **BLOCKED** (chéo máy) |
| **S8** | Khi tắt tính năng (`OFFICE_OMP=off`), gọi `dispose()`, hoặc khi file phình quá `maxFileBytes` để sót file handle, timer hay giữ nguyên số liệu chi phí cũ như thể đầy đủ | `OFFICE_OMP=off` không tạo adapter/bridge và trả `404` tại `/api/omp/*` cùng `/ingest/omp/v1`. `dispose()` hủy ngay lượt quét đang chạy, xóa hết timer, đóng handle và làm rỗng bộ nhớ. Gia cố Phase 06 trong `reader.mjs` giải phóng mảng băm khối và đánh dấu snapshot `incomplete: true` kèm `metrics` về `unknown` (`cost: null`) khi file vượt `maxFileBytes` hoặc lỗi đọc. | `omp-reader.test.mjs` (`F5/F10/F12`), `omp-adapter.test.mjs`, `agents.spec.ts` (`S1/S5/S8`), `benchmark-omp.mjs` (`P0`, `P5`). | **PASS** |
| **S9** | Lộ `providerPromptCacheKey`, `taskPromptCacheKey`, `credential_pin.hash`, `seanceSource`, `previousSessionFiles`, hoặc các trường lạ | `normalize.mjs` và `projection.mjs` dựng đối tượng mới từ danh sách trường cho phép tường minh; mọi thuộc tính lạ đều bị loại bỏ. | `omp-normalize.test.mjs` (`S4/S9`), `omp-projection.test.mjs`. | **PASS** |

---

## 3. Các bản vá Gia cố Bảo mật & Độ tin cậy đã áp dụng trong Phase 06

1. **`server/agents/omp/paths.mjs`**:
   - Bổ sung chặn ký tự ASCII DEL (`\x7f`) tại `nativeAbsolute`, `validateConfig`, `projectIdentity` và `containedPath`.
   - Bổ sung kiểm tra từng phân đoạn đường dẫn trong `containedPath`: từ chối đoạn `.`, đoạn rỗng (`//`), đoạn kết thúc bằng dấu cách hoặc dấu chấm (`/[ .]$/`), và tên thiết bị đặc biệt của Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, có hoặc không có phần mở rộng) trước khi gọi xuống hệ thống file.
   - Chuẩn hóa `projectMappings[].from` bằng cách cắt bỏ dấu gạch chéo dư ở cuối đường dẫn.
2. **`server/agents/omp/reader.mjs` & `server/agents/omp/index.mjs`**:
   - Khi một file từng ở trạng thái `ready` phình vượt quá `maxFileBytes` / `fingerprint-limit` hoặc gặp lỗi I/O, `reader.mjs` lập tức giải phóng bộ nhớ lưu băm khối (`blocks`/`pending`), đánh dấu `snapshot.incomplete = true` và đưa `metrics` về `unknown` (`cost: null`) để số tổng cũ không bị hiểu nhầm là đầy đủ hoặc ghi đè lên số liệu live trong chế độ hybrid.
   - Khi file phục hồi từ trạng thái `absent` hoặc `unsupported`, `reader.mjs` xóa các mã lỗi tạm thời của chu kỳ trước để đọc lại sạch.
3. **`server/agents/omp/bridge.mjs`**:
   - Kiểm tra độ dài cố định của header `Authorization` (`header.length === 71`) trước khi chạy biểu thức chính quy.
   - Từ chối tường minh (`400 invalid-batch` / `400 invalid-json`) đối với JSON không phải object (`null`, kiểu nguyên thủy), vỏ lô `{"events": ...}` không phải mảng, và luồng body không hợp lệ.
4. **`tests/unit/omp-private-storage.test.mjs`**:
   - Thay thế lời gọi `Get-Acl` còn sót trong hàm kiểm tra của test bằng `.NET` `[System.IO.Directory]::GetAccessControl` / `[System.IO.File]::GetAccessControl` (đồng bộ với `private-storage.js`), khắc phục triệt để lỗi không tự nạp được module PowerShell khi chạy test dưới Git Bash.

---

## 4. Rủi ro Tồn đọng & Ranh giới Bảo vệ

- **Thực thi mã dưới cùng tài khoản người dùng**: Quyền DACL trên hệ thống file bảo vệ `~/.omp/office-private/*` trước các tài khoản Windows khác (`Users`, `Authenticated Users`, `CodexSandboxUsers`), nhưng không ngăn được tiến trình đã chạy sẵn dưới chính tài khoản người dùng đó, `SYSTEM` hoặc `Administrators`.
- **Che dấu bằng Regex là lớp phụ**: `server/redact.mjs` che các định dạng khóa/token phổ biến khi bật `conversation: true`, nhưng không thể cam kết nhận diện mọi định dạng bí mật tự định nghĩa; việc giữ mặc định `conversation: false` mới là lớp bảo vệ chính.
- **Vận chuyển sự kiện chéo máy**: Nghiêm cấm gửi bearer token qua HTTP thường trên mạng LAN/NAT. Mô hình khác máy chỉ được dùng chế độ `files` qua thư mục mount cục bộ an toàn hoặc giữ tắt cho tới khi có kênh tunnel xác thực được duyệt.
