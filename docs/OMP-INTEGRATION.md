# Hướng dẫn Tích hợp và Vận hành OMP (Quan sát Chỉ-đọc)

My Office hỗ trợ quan sát đồng thời các phiên làm việc của [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) bên cạnh Claude Code ngay trên cùng mặt bằng văn phòng 3D, danh sách phiên bên trái, Chế độ danh sách (List Mode) và Dòng thời gian (Timeline).

Tính năng tích hợp này **mặc định tắt (`off`)**, **hoàn toàn chỉ-đọc (`read-only`)** và **chỉ hiển thị cục bộ (`local-only`)**:
- My Office không bao giờ ghi, sửa đổi, di chuyển hay xóa file lịch sử phiên (`.jsonl`), cấu hình hoặc profile của OMP.
- Mọi thao tác điều khiển từ bảng điều khiển (gửi prompt, duyệt/từ chối công cụ hoặc kế hoạch, mở cửa sổ IDE, dừng/tắt tiến trình, chuyển đổi tài khoản, `/rc` Remote Control, và "Giao việc") chỉ dành riêng cho Claude Code.
- Các phiên OMP, lịch sử được ghim và nội dung hội thoại chỉ được trả về cho trình duyệt mở trực tiếp trên chính máy tính này (`127.0.0.1`), không bao giờ phát qua mạng LAN, điện thoại, Cloudflare tunnel và không ghi vào nhật ký phát lại `data/replay/*.jsonl`.

---

## 1. Các chế độ hoạt động & Biến môi trường

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OFFICE_OMP` | `off` | `off`: tắt hoàn toàn (0 đọc file, 0 timer, 0 route). `files`: chỉ đọc các file phiên đã lưu. `hybrid`: gồm `files` + cổng nhận sự kiện trực tiếp qua loopback (`POST /ingest/omp/v1`). |
| `OFFICE_OMP_CONFIG` | *(trống)* | Bắt buộc khi bật `files` hoặc `hybrid`. Đường dẫn tuyệt đối tới file cấu hình JSON. |
| `OFFICE_OMP_INGEST_FILE` | `~/.omp/office-private/ingest.json` | Tùy chọn đổi đường dẫn file lưu token nhận sự kiện của `hybrid`. Phải là đường dẫn tuyệt đối đạt chuẩn quyền truy cập riêng tư của `private-storage.js`. |
| `OFFICE_OMP_USAGE` | `1` (`on`) | Mặc định **bật** (`1`). Tự động đọc hạn mức (quota) chỉ-đọc theo từng tài khoản OAuth `openai-codex` và `google-antigravity` qua `omp usage --json --no-extensions` khi có trình duyệt cục bộ đang mở. Đặt `0` (hoặc `off`/`false`) để tắt. Không chạm vào hạn mức hay điều khiển tài khoản Claude. |
| `OFFICE_OMP_BIN` | `omp` | Đường dẫn hoặc tên binary `omp` trên cùng hệ điều hành dùng để đọc quota OMP. |
| `OFFICE_OMP_PROFILE` | *(theo `OMP_PROFILE` / `default`)* | Tên profile OMP hợp lệ (`--profile <name>`) dùng để đọc quota OMP. |

Trình tự kích hoạt khuyến nghị:
1. Giữ `OFFICE_OMP=off` cho tới khi chuẩn bị xong file cấu hình `omp-config.json`.
2. Bật `OFFICE_OMP=files` trước và kiểm tra `GET /api/doctor` báo `effectiveMode: "files"` cùng `sources[].state: "ok"`.
3. Bật `OFFICE_OMP=hybrid` (hoặc chạy qua `start-office.ps1`) sau khi đã tạo token riêng tư và nạp extension quan sát vào OMP.

---

## 2. Cấu hình (`omp-config.json`)

My Office không tự ý quét thư mục người dùng (`HOME`), XDG hay tự dò tìm profile. Mọi thư mục nguồn cần quan sát phải được khai báo tường minh trong `omp-config.json` (tối đa 64 KiB, tối đa 8 nguồn):

```json
{
  "version": 1,
  "sources": [
    {
      "id": "workstation-main",
      "root": "C:\\synthetic\\omp-sessions",
      "pathStyle": "win32",
      "conversation": false,
      "projectMappings": [
        {
          "from": "C:\\synthetic\\projects\\repo-a",
          "projectId": "repo-a",
          "worktreeId": "main",
          "localRoot": "C:\\synthetic\\projects\\repo-a"
        }
      ]
    }
  ],
  "limits": {
    "maxPins": 8,
    "pollMs": 2000,
    "reconcileMs": 60000
  }
}
```

### Quy tắc cấu hình
- `root`: Đường dẫn thư mục tuyệt đối trên hệ điều hành hiện tại, không chứa symlink hoặc Windows junction trên toàn bộ chuỗi thư mục cha. Mọi file chỉ được mở ở chế độ đọc (`O_RDONLY | O_NOFOLLOW`).
- `pathStyle`: `"win32"` hoặc `"posix"`, khớp với định dạng đường dẫn `session.cwd` do tiến trình OMP ghi trong header của file phiên.
- `conversation`: Mặc định `false` (chỉ đọc metadata). Chỉ đặt `true` cho những nguồn mà bạn cho phép xem nội dung hội thoại trong ngăn chi tiết phiên trên máy này.
- `projectMappings`: Ánh xạ tiền tố đường dẫn `session.cwd` (ưu tiên tiền tố dài nhất) sang `projectId` và `worktreeId`. Việc gộp chung bàn làm việc giữa OMP và Claude Code **chỉ diễn ra** khi khai báo thêm `localRoot` và xác minh được danh tính Git thực tế (`server/git.mjs`); hai thư mục trùng tên cuối (basename) không bao giờ tự gộp.
- `limits`: Tùy chọn hạ thấp các ngưỡng mặc định (`maxSessions: 2048`, `maxPins: 8`, `maxDepth: 5`, `scanEntries: 1024`, `maxDirectories: 1024`, `maxFileBytes: 8388608` [8 MiB], `maxLineBytes: 65536` [64 KiB], `chunkBytes: 32768`, `bytesPerTick: 131072`, `maxEntries: 4096`, `maxIndexBytes: 1048576`, `pollMs: 2000`, `reconcileMs: 60000`, `ttlMs: 900000`).

---

## 3. Ma trận Hỗ trợ (Support Matrix)

### 3.1 Schema & Phiên bản Runtime OMP
Bộ giải mã hỗ trợ OMP session schema **v3** (mốc mã nguồn tham chiếu `6a86df8539fccf3ad7818081266e554022fc21bc`, gói `18.14.0`). Các phiên bản schema lạ (`v1`, `v2`, `v999`) sẽ được đánh dấu `unsupported` an toàn mà không làm sập server hay ảnh hưởng tới Claude Code.

| Tính năng / Sự kiện OMP | Chế độ `files` | Chế độ `hybrid` | Trạng thái xác minh |
| --- | --- | --- | --- |
| Danh mục phiên đã lưu & ghim (`<= 8` phiên) | Hỗ trợ (`persistedOnly: true`, `liveness: unknown`) | Hỗ trợ (hợp nhất với phiên live theo `sessionKey`) | **ĐÃ XÁC MINH** (fixture + cây NTFS thật trên Windows) |
| Title slot 256-byte UTF-8 & chọn nhánh `activeLeafId` | Hỗ trợ | Hỗ trợ (theo file) | **ĐÃ XÁC MINH** |
| Subagent đã lưu (`<stem>/<child>.jsonl` có `session_init.task`) | Hỗ trợ (`historical`, tối đa 128 con/phiên chính) | Hỗ trợ qua đọc file; sự kiện live của con được loại trừ | **ĐÃ XÁC MINH** (OMP 18.14.2 TUI + synthetic) |
| `session_start`, `session_shutdown`, `agent_start`, `agent_end` | Không áp dụng | Hỗ trợ | **ĐÃ XÁC MINH** (18.14.1 print/RPC, 18.14.2 TUI) |
| `session_switch` (`new` / `resume` / `fork`) | Giữ nguyên liên kết `fork` / `continuation` | Đóng generation cũ, mở generation mới | **ĐÃ XÁC MINH** (18.14.1 RPC + unit) |
| `tool_execution_start` / `tool_execution_end` | Tái dựng từ `toolCall`/`toolResult` đã lưu | Theo dõi tập công cụ đang chạy theo `toolCallId` | **ĐÃ XÁC MINH** (`read`, `write`, `ask`, `task`) |
| `tool_approval_requested` / `tool_approval_resolved` | Không áp dụng | Trạng thái `waiting` (`waitReasons: ["approval"]`) | **ĐÃ XÁC MINH** (18.14.1 RPC `--approval-mode always-ask`) |
| `plan_review_requested` / `plan_review_resolved` | Không áp dụng | Trạng thái `waiting` (`waitReasons: ["input"]`) → `idle` | **MỘT PHẦN** (18.14.2 TUI `/plan-review` chọn `execute` đã xác minh; hủy bằng `Escape` & tự chạy tiếp **CHƯA XÁC MINH**) |
| Trạng thái chờ của hộp thoại `ask` tích hợp sẵn | Không áp dụng | **KHÔNG HỖ TRỢ** (hiển thị là `active`, `waitReasons` rỗng) | Giới hạn thực tế đã quan sát trên 18.14.2 TUI |
| Luồng sự kiện live của subagent (`kind === "sub"`) & advisor | Chỉ đọc task child đã lưu; advisor **KHÔNG HỖ TRỢ** | **KHÔNG HỖ TRỢ** (extension chủ đích bỏ qua) | Đã xác minh việc loại trừ trên 18.14.2 |

### 3.2 Ma trận Môi trường Hệ điều hành (Windows / WSL / Cross-Host)

| Mô hình triển khai | Chế độ `files` | Chế độ `hybrid` | Trạng thái & Điều kiện |
| --- | --- | --- | --- |
| **Cùng máy Windows** (OMP trên Windows, My Office trên Windows) | Hỗ trợ | Hỗ trợ (`127.0.0.1`) | **ĐÃ XÁC MINH** trên Windows 11 (`10.0.26200` x64, Node `24.22.1`, NTFS symlink/junction/DACL, Chromium D3D11). |
| **Cùng máy Linux / WSL** (OMP trên Linux/WSL, My Office trên cùng Linux/WSL) | Hỗ trợ | Hỗ trợ (`127.0.0.1`) | **MỘT PHẦN** (logic đường dẫn POSIX và quyền `0700`/`0600` đã có unit test; chưa chạy lại toàn bộ browser suite trong Linux ở Phase 06). |
| **Chéo Windows ↔ WSL (`files`)** | Hỗ trợ có điều kiện | Bị chặn (hạ về `files`) | **CHƯA XÁC MINH LIVE**. Yêu cầu mount cục bộ qua được kiểm tra `approveRoot`/`containedPath` (không symlink/junction) và khai báo đúng `pathStyle`. Không bao giờ dò PID chéo hệ điều hành. |
| **Khác máy / LAN / NAT (`hybrid`)** | Không áp dụng | **BỊ CHẶN / KHÔNG HỖ TRỢ** | `office-observer.js` và `/ingest/omp/v1` bắt buộc loopback (`127.0.0.1`, `localhost`, `::1`). Không gửi bearer token qua HTTP thường trên mạng LAN/NAT. |

---

## 4. Quyền riêng tư, Lưu trữ & Ngữ nghĩa Chi phí / Token

1. **Danh sách cho phép ở chế độ Metadata (Allowlist)**: Dữ liệu phiên công khai chỉ gồm `id`/`sessionKey` ẩn danh (`omp:<sha256>`), tên dự án đã làm sạch (`[\p{L}\p{N} ._-]`, tối đa 40 ký tự), khóa `projectKey`/`worktreeKey`, trạng thái `lifecycle`/`activity`/`connection`/`lastTurnOutcome`, bộ đếm nhóm công cụ (`read`, `edit`, `cmd`, `web`), tên model và `metrics` hợp lệ. Toàn bộ prompt, tiêu đề, tham số/kết quả công cụ, suy luận (thinking), đường dẫn file gốc, `credential_pin.hash` và khóa cache đều bị loại bỏ.
2. **Xem hội thoại theo yêu cầu (`GET /api/log`)**: Chỉ mở khi nguồn có `"conversation": true` và phiên đó đang được ghim. Trả về từng trang phân trang ngược (`<= 120` mục/trang trong cửa sổ tối đa `4.096` mục), đã che chuỗi nhạy cảm (`server/redact.mjs`) và hiển thị dạng văn bản thuần an toàn (không thực thi HTML/script/ảnh). Khi bỏ ghim hoặc tắt quyền, `/api/log` lập tức từ chối truy cập.
3. **Nguồn gốc số liệu Token & Chi phí (Provenance)**:
   - Số liệu đọc từ file lịch sử mang nhãn `provenance: "recorded"` và `scope: "self"` (hoặc `"inherited"` nếu phiên có `parentSession` / `continuationOf`).
   - Số liệu tạm thời từ luồng live mang nhãn `provenance: "provisional"` và sẽ **bị thay thế hoàn toàn** (không bao giờ cộng dồn) khi file của phiên đó được ghim và đọc xong (`readerState === "ready"` và `!incomplete`).
   - Nếu file vượt quá `maxFileBytes` (8 MiB), vượt `maxEntries` (4.096), hoặc chạm bộ lọc trùng lặp Bloom (`possible-duplicate-entry-id`), cờ `incomplete` sẽ bật thành `true` và chi phí chính xác được ẩn (`cost: null`, `provenance: "unknown"`).
   - Chi phí và token của OMP không bao giờ đi vào hạn mức gói Claude (`limits.json`), không kích hoạt nghỉ hết lượt của Claude và không cộng vào tổng chi phí ngày của cô kế toán Claude.

4. **Quan sát Multi-Account Quota (`openai-codex`, `google-antigravity`) & Phân bổ Token theo Provider**:
   - **Tách biệt hai khái niệm**:
     1. **Account Quota (Mặc định bật — `OFFICE_OMP_USAGE=1`)**: Đọc các tài khoản OAuth `openai-codex` và `google-antigravity` trong profile OMP đã chọn qua lệnh chỉ-đọc `omp [--profile <p>] usage --json --no-extensions` (đã xác minh ở mốc `omp v18.14.2` không khởi tạo `AgentSession` và không tiêu saved resets). Mỗi tài khoản có `accountKey` ẩn danh (HMAC theo tiến trình trên tuple `(profile, provider, identity)`), danh sách cửa sổ hạn mức thực tế (`usedPercent`, `remainingPercent`, `resetsAt`, `sourceUnit`) và trạng thái (`ready`/`stale`/`unavailable`/`auth-error`/`unsupported`). Trên máy cục bộ, nhãn hiện đầy đủ email, tổ chức/workspace và gói do CLI cung cấp để phân biệt tài khoản; chỉ lấy các trường định danh trong allowlist, không xuất token/API key hay metadata gốc. Thiết bị xem từ xa chỉ nhận alias `Codex #n` / `Antigravity #n` và profile `configured`.
     2. **Session Tokens & Cost (`metrics.byProvider`)**: Tổng hợp token (`input`, `output`, `cacheRead`, `cacheWrite`) và `cost` theo từng `(providerId, model)` trực tiếp từ các bản ghi JSONL (`message.provider`, `model_usage.provider`) hoặc sự kiện live. Vì JSONL không xuất định danh OAuth công khai khớp với báo cáo quota, mọi chi phí/token theo phiên được gắn nhãn rõ ràng là **`unattributed` (`Chưa xác định tài khoản`)**, tuyệt đối không suy đoán từ tài khoản đang active.
   - **Hướng dẫn sử dụng nhanh (How to use)**:
     - **Chạy bình thường (mặc định bật)**: Chỉ cần chạy `.\start-office.ps1` (hoặc `npm start` / `npm run dev`). Khi bạn đã đăng nhập sẵn tài khoản Codex (`openai-codex`) hoặc Antigravity (`google-antigravity`) trong OMP, My Office sẽ tự động đọc hạn mức từ profile OMP hiện tại mà **không cần đăng nhập lại**.
     - **Xem hạn mức đa tài khoản trên giao diện**:
       1. Bảng **OMP Usage** (`#omp-usage-dashboard`, nội dung `#omp-usage-sec`) mặc định mở ngay dưới thanh trên cùng, không cần bấm vào hạn mức Claude. Hai nhóm **Codex (`openai-codex`)** và **Antigravity (`google-antigravity`)** hiển thị toàn bộ thẻ tài khoản và cửa sổ hạn mức; màn hình nhỏ hoặc nhiều tài khoản cuộn bên trong bảng.
       2. Nút **OMP** (`#btn-omp-usage`) hiển thị số tài khoản và cảnh báo cạn/gần cạn, dữ liệu cũ hoặc lỗi đọc; đây không phải một tỷ lệ quota cộng gộp. Nút **Thu gọn** đóng bảng, bấm **OMP** để mở lại; trình duyệt nhớ lựa chọn bằng `office-omp-usage` trong localStorage. Nút **Claude Code** (`#btn-plan`) chỉ mở hạn mức và điều khiển tài khoản Claude, không chứa OMP.
          - Mỗi thẻ hiện tên tài khoản đầy đủ trên máy cục bộ, trạng thái đọc dữ liệu, thời điểm đọc và tất cả cửa sổ hạn mức. Thanh và số chính luôn là **% đã dùng**, kể cả Antigravity báo nguồn theo số còn lại; dòng bên dưới ghi rõ **còn lại** và mốc reset. Số liệu có tối đa một chữ số thập phân, số chưa biết là `–`/`N/A`, không giả thành `0%`.
          - **Token & chi phí theo phiên** nằm trong phần có thể mở rộng riêng dưới mỗi provider, mặc định thu gọn, luôn ghi rõ **không phải quota** và **`Chưa xác định tài khoản` (`Account unattributed`)**.
          - Bấm **Làm mới / Refresh** ở tiêu đề `OMP Usage` trên máy cục bộ để cập nhật tức thời (single-flight, có chống spam/backoff). Tính năng chỉ đọc, không có nút đổi tài khoản/đăng nhập/reset quota OMP.
       3. Khi bấm vào một nhân vật/phiên OMP để mở ngăn chi tiết phiên (`#dr-session`), phần đầu trang hiện huy hiệu provider (ví dụ `openai-codex`, `google-antigravity`) và phần thông tin bên dưới hiện bảng **Usage theo provider & model** (`#ds-actions .ds-omp-metrics`) của riêng phiên đó.
     - **Chọn profile OMP khác hoặc chỉ định đường dẫn `omp.exe`**:
       - Đổi profile OMP: đặt `OFFICE_OMP_PROFILE=<tên-profile>` (hoặc `OMP_PROFILE=<tên-profile>`) trước khi chạy My Office.
       - Chỉ định đường dẫn thực thi `omp`: đặt `OFFICE_OMP_BIN=C:\Users\<User>\AppData\Local\omp\omp.exe` nếu `omp` chưa nằm trong `PATH`.
     - **Xem thử dữ liệu mẫu (Demo mode)**: Mở `http://127.0.0.1:4310/?demo&ompUsage` để xem giao diện mẫu gồm nhiều tài khoản Codex và Antigravity mà không gọi CLI thật.
     - **Kiểm tra qua API cục bộ**: Mở `http://127.0.0.1:4310/api/omp/usage` (hoặc `?refresh=1`) và `http://127.0.0.1:4310/api/doctor` (trường `agents.ompUsage`).
   - **Bảo mật & Tắt tính năng (Rollback)**: Khi không có trình duyệt cục bộ nào đang mở, collector tự động dừng timer (0 tiến trình con). Để tắt hẳn việc đọc quota tài khoản OMP, đặt `OFFICE_OMP_USAGE=0` (hoặc `off`/`false`) rồi khởi động lại My Office; không cần xóa hay sửa bất kỳ dữ liệu/cấu hình nào của OMP.

---

## 5. Cài đặt Extension Quan sát Tùy chọn (Chế độ `hybrid`)

My Office không bao giờ tự động sửa cài đặt OMP của bạn. Để bật luồng báo cáo trạng thái trực tiếp:

1. Khởi động My Office một lần với `OFFICE_OMP=hybrid` và `OFFICE_OMP_CONFIG=<đường dẫn tuyệt đối>`. My Office sẽ khởi tạo token 64 ký tự hex cho từng nguồn trong `~/.omp/office-private/ingest.json` (được bảo vệ bằng Windows DACL riêng hoặc quyền `0700`/`0600` trên POSIX).
2. Lưu cấu hình cho observer tại `~/.omp/office-private/observer.json` bằng hàm `writePrivateJson` trong `integrations/omp/private-storage.js`:
   ```json
   {
     "sourceId": "workstation-main",
     "token": "<64-hex-token-của-workstation-main>",
     "url": "http://127.0.0.1:4310/ingest/omp/v1"
   }
   ```
3. Nạp observer vào OMP:
   - **Chạy thử một lần**: `omp -e /đường/dẫn/tuyệt/đối/tới/my-office/integrations/omp/office-observer.js`
   - **Cài đặt cố định**: Tạo thư mục riêng tư `~/.omp/agent/extensions/office-observer/`, chép `integrations/omp/private-storage.js` vào trước, sau đó chép `integrations/omp/office-observer.js` vào dưới tên `index.js`.
4. **Xoay vòng (Rotate) Token**: Dừng hoặc khởi động lại My Office sau khi cập nhật đồng bộ cả `~/.omp/office-private/ingest.json` và `~/.omp/office-private/observer.json` thông qua `writePrivateJson`. Các tiến trình OMP đang chạy dở từ trước vẫn giữ token cũ trong bộ nhớ và sẽ tự ngừng gửi telemetry sau khi nhận mã `401` mà không làm gián đoạn công việc của agent; các tiến trình OMP mở mới sẽ tự động dùng token mới.

---

## 6. Các tính năng Không hỗ trợ (Unsupported)

- **Không điều khiển OMP từ Dashboard**: Không gửi prompt, không bấm duyệt/từ chối công cụ hay kế hoạch, không mở cửa sổ IDE, không dừng/tắt tiến trình OMP, không đổi tài khoản, không dùng `/rc` và không giao việc (`tasks`) cho OMP.
- **Không có trạng thái chờ riêng cho hộp thoại `ask`**: Công cụ `ask` tích hợp sẵn của OMP không phát sự kiện chờ riêng nên phiên vẫn hiển thị là `active`.
- **Không phát trực tiếp (live) Subagent hoặc Advisor**: Các tiến trình con (`ctx.agent.kind === "sub"`) và file `__advisor.jsonl` không phát sự kiện live. Chỉ các file `<stem>/<child>.jsonl` có `session_init.task` dưới một phiên chính đã ghim mới hiển thị dưới dạng lịch sử (`historical`).
- **Không đọc file phiên > 8 MiB**: File vượt quá `maxFileBytes` (8 MiB) được đánh dấu `unsupported` (`file-limit`) để bảo vệ bộ nhớ và I/O.
- **Không nhận sự kiện qua mạng ngoài Loopback**: `POST /ingest/omp/v1` từ chối mọi request có header `Origin` từ trình duyệt, đi qua Cloudflare tunnel, hoặc đến từ địa chỉ IP không phải loopback.

---

## 7. Chẩn đoán lỗi & Gỡ bỏ (Rollback)

### Kiểm tra trạng thái (`GET /api/doctor`)
Mở `http://127.0.0.1:4310/api/doctor` trên máy tính này và kiểm tra trường `agents.omp`:
- `reason: "disabled"`: `OFFICE_OMP` đang tắt (`off`) hoặc chưa đặt.
- `reason: "config-missing"` / `"config-invalid"`: Thiếu `OFFICE_OMP_CONFIG`, đường dẫn tương đối, file quá lớn hoặc sai cấu trúc JSON.
- `reason: "ingress-failed"` (`effectiveMode: "files"`): Đã bật `OFFICE_OMP=hybrid` nhưng file `~/.omp/office-private/ingest.json` không đạt kiểm tra quyền riêng tư DACL/mode hoặc JSON lỗi. My Office tự động hạ an toàn về chế độ `files` và giữ Claude Code chạy bình thường.
- `sources[].state`: `"ok"`, `"absent"` (`ENOENT`), `"denied"` (`EACCES`/`EPERM`/`PATH_DENIED`), `"changed"` (`SOURCE_CHANGED` khi thư mục gốc bị thay thế), hoặc `"degraded"`.

### Gỡ bỏ sạch (Rollback)
1. Đặt `OFFICE_OMP=off` (hoặc xóa biến `OFFICE_OMP`, `OFFICE_OMP_CONFIG`) rồi khởi động lại My Office. Toàn bộ timer, bộ đọc file và các route `/api/omp/*`, `/ingest/omp/v1` sẽ dừng ngay lập tức (`404`).
2. Nếu đã cài extension vào OMP, xóa thư mục `~/.omp/agent/extensions/office-observer/` (cùng các biến môi trường `OFFICE_OMP_*` nếu có). Các tiến trình OMP đang chạy vẫn tiếp tục làm việc bình thường.
3. Dọn dữ liệu cục bộ của riêng My Office (tùy chọn): xóa `data/omp-pins.json` và `~/.omp/office-private/{ingest,observer}.json`. Tuyệt đối không xóa `~/.omp/agent/sessions`.

---

## 8. Cập nhật tính năng mới từ `upstream/main` mà không mất tích hợp OMP

Repository này dùng remote `origin` cho bản fork cá nhân (`lcaloi2904/my-office`) và `upstream` cho repo gốc (`khanh020905/my-office`).

1. Tải và gộp thay đổi mới từ repo gốc vào nhánh `main` (không bao giờ dùng `reset --hard` hay `rebase` lịch sử đã đẩy):
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```
2. Nếu có xung đột (conflict) tại các file điểm nối dùng chung (`server/index.mjs`, `workers.js`, `live.js`, `activity.js`, `lite.js`, `session-drawer.js`, `quota.js`, `accountant.js`, `timeline.js`, `replay.js`), giữ cả tính năng mới của `upstream` lẫn các chốt chặn/adapter OMP theo đúng danh sách trong [AGENTS.md](../AGENTS.md).
3. Chạy kiểm thử và build lại:
   ```bash
   node node_modules/eslint/bin/eslint.js .
   node node_modules/typescript/bin/tsc --noEmit
   node --test tests/unit/agent-*.test.mjs tests/unit/omp-*.test.mjs
   ```
   Sau đó chạy `.\start-office.ps1 buildonly` (hoặc `.\start-office.ps1 rebuild`) và `git push origin main`.
