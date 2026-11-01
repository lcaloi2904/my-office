# OMP Observer cho My Office

`office-observer.js` giúp một tiến trình OMP đang chạy báo cáo những phiên nào đang mở và đang thực hiện công việc gì, để My Office hiển thị chúng thành các nhân vật **trực tiếp (live), chỉ-đọc** bên cạnh các phiên lịch sử đã lưu. Tiện ích này là tùy chọn, mặc định tắt và không bao giờ được repository này tự động cài vào OMP.

Extension chỉ gửi đi: định danh phiên (`sessionId`), nhóm công cụ (`read`, `edit`, `cmd`, `web`, `other`), số đếm, lý do chờ (`approval`, `input`) và bản chụp số liệu token/chi phí. Extension không bao giờ gửi prompt, câu trả lời, tham số hay kết quả công cụ, đường dẫn file, biến môi trường hay thông tin xác thực; đồng thời không nhận bất kỳ lệnh điều khiển nào từ My Office. Việc duyệt quyền, dừng tiến trình, gửi prompt và quản lý tài khoản hoàn toàn thuộc về OMP.

## Những điều cần chuẩn bị trước khi bật

Không có thành phần nào tự động kích hoạt. Việc chép file vào thư mục extension của OMP hoặc sửa cấu hình OMP là quyết định của bạn và bạn có thể gỡ bỏ bất cứ lúc nào.

1. Khởi động My Office với `OFFICE_OMP=hybrid` và `OFFICE_OMP_CONFIG=<đường dẫn tuyệt đối tới omp-config.json>`. File cấu hình này dùng chung định dạng với chế độ đọc file lịch sử (`version`, `sources[]` gồm `id`, `root`, `pathStyle`). Nếu không có cấu hình hợp lệ, chế độ `hybrid` sẽ không đọc bất cứ thứ gì.
2. My Office lưu token nhận dữ liệu theo từng nguồn tại `~/.omp/office-private/ingest.json`. Thư mục cha `~/.omp` phải tồn tại sẵn. Biến `OFFICE_OMP_INGEST_FILE` có thể trỏ sang một file **tuyệt đối, riêng tư** khác (ví dụ khi chạy server kiểm thử cô lập), nhưng vẫn phải qua đầy đủ các bước kiểm tra quyền truy cập. Hệ thống không còn đọc đường dẫn cũ `data/omp-ingest.json`.
3. Cung cấp cấu hình cho observer qua biến môi trường của tiến trình OMP (hoặc qua file cấu hình riêng tư ở bước 4):

   | Biến môi trường | Ý nghĩa |
   | --- | --- |
   | `OFFICE_OMP_TOKEN` | Token telemetry của nguồn tương ứng trong kho lưu trữ riêng tư của My Office |
   | `OFFICE_OMP_SOURCE` | Mã `id` của nguồn đó trong `omp-config.json` |
   | `OFFICE_OMP_URL` | Tùy chọn. Mặc định `http://127.0.0.1:4310/ingest/omp/v1`. Bắt buộc là `http` thường trên địa chỉ loopback |

   Nếu thiếu token hoặc `sourceId` hợp lệ, observer sẽ không đăng ký bất kỳ callback nào.
4. Nạp `office-observer.js` làm extension của OMP (dạng hàm khởi tạo `export default (pi) => …`). Giữ file `private-storage.js` nằm cùng thư mục với nó. Chạy thử một phiên: `omp -e /đường/dẫn/tuyệt/đối/tới/office-observer.js`.

   Để cài cố định, tạo thư mục riêng tư `~/.omp/agent/extensions/office-observer/`, chép `private-storage.js` vào trước, rồi chép `office-observer.js` vào dưới tên `index.js`. Cơ chế tự phát hiện thư mục của OMP sẽ nạp `index.js`; file helper `private-storage.js` không phải là một extension độc lập. Khi cập nhật, luôn chép đồng bộ **cả hai** file.

   Lưu `{ "sourceId": "...", "token": "...", "url": "http://127.0.0.1:4310/ingest/omp/v1" }` một cách riêng tư tại `~/.omp/office-private/observer.json` (hoặc đặt biến `OFFICE_OMP_OBSERVER_CONFIG` trỏ tới đường dẫn tuyệt đối). Thứ tự ưu tiên: tham số truyền trực tiếp vào factory → biến môi trường → file cấu hình riêng tư. Đường dẫn cũ `~/.omp/office-observer.json` không còn được sử dụng.

   Dùng `preparePrivateFile(file, { createDirectory: true })` từ `private-storage.js` để tạo thư mục lá với DACL riêng tư ngay từ lúc khởi tạo và dùng `writePrivateJson(file, value)` để ghi nguyên tử; không tạo thư mục có quyền rộng rồi mới siết quyền sau. Đường dẫn hoặc quyền truy cập không an toàn sẽ tự động từ chối (fail closed). Không dán token vào khung chat hoặc log.

   Khi xoay vòng (rotate) token, cần cập nhật đồng bộ cả phía receiver (`ingest.json`) và observer (`observer.json`) khi receiver đang dừng hoặc khởi động lại receiver với token mới. Các tiến trình OMP đã nạp extension từ trước vẫn giữ token cũ trong bộ nhớ; việc ghi đè file trên đĩa không tự nạp lại (hot-reload) chúng. Cứ để các tiến trình OMP đang làm việc chạy tiếp; những phiên đó có thể ngừng gửi telemetry sau khi nhận mã `401` nhưng không ảnh hưởng tới công việc của agent. Các tiến trình OMP mở mới sẽ dùng token mới.

   Để gỡ cài đặt: xóa thư mục `~/.omp/agent/extensions/office-observer/` và file `observer.json`. Khi dừng My Office hoặc đặt `OFFICE_OMP=files`/`off`, cổng nhận sự kiện sẽ đóng lại và OMP vẫn hoạt động bình thường. Các file lịch sử phiên không bao giờ bị ghi đè.

## Cách hoạt động

- Mỗi callback chỉ chép vài trường metadata vào hàng đợi giới hạn (tối đa 64 sự kiện / 48 KiB) rồi trả về ngay lập tức. Việc gửi HTTP diễn ra trên timer riêng có timeout, backoff kèm jitter và chỉ gửi từng request một. Nếu My Office đang tắt, chậm hoặc từ chối kết nối, sự kiện được giữ tạm trong thời gian ngắn rồi gộp thành một bản chụp trạng thái (`snapshot`). Nếu bị từ chối xác thực (`401`/`403`/`404`), observer sẽ tự dừng hẳn.
- Mỗi lần chuyển phiên (`session_switch`), tiếp tục (`resume`) hoặc rẽ nhánh (`fork`) sẽ tạo một *generation* mới; generation cũ được đóng lại dưới đúng định danh của nó và sự kiện đến muộn từ generation cũ không thể ghi đè lên generation mới. Mọi sự kiện đều có số thứ tự (`sequence`) tăng dần để gửi lại an toàn (idempotent) và phát hiện được khoảng trống dữ liệu (`gap`).
- Trạng thái sống (liveness) dựa trên nhịp tim (`heartbeat` mỗi 10 giây) được tính theo **đồng hồ của My Office**: quá 30 giây không có tín hiệu sẽ chuyển sang `stale`, quá 90 giây chuyển sang `disconnected`, tuyệt đối không bao giờ suy diễn sự im lặng thành "đã hoàn thành".
- Các tiến trình con (`ctx.agent.kind === "sub"`) chủ đích không gửi sự kiện live trong phiên bản này.
- Phản hồi xác nhận (ACK) từ server có nghĩa là "đã áp dụng vào bộ nhớ của My Office", không phải lưu trữ bền vững: nếu My Office khởi động lại, bản chụp (`snapshot`) tiếp theo sẽ khôi phục trạng thái tức thời, còn file `.jsonl` trên đĩa sẽ khôi phục lịch sử và số liệu chi phí/token đã ghi nhận (`recorded`). Số liệu usage từ runtime chỉ là bản tạm thời (`provisional`) và luôn bị thay thế bởi số liệu từ file, không bao giờ cộng trùng.

## Ma trận hỗ trợ sự kiện

"Khai báo" nghĩa là sự kiện đó tồn tại trong mã nguồn OMP mốc tham chiếu (`6a86df8539fccf3ad7818081266e554022fc21bc`, gói 18.14.0, schema 3). Việc phát sự kiện thực tế chỉ được xác nhận cho đúng bản dựng, chế độ và kịch bản ghi trong bảng dưới đây. Xem chi tiết tại [Báo cáo Phase 04](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-implementation.md) (18.14.1 print/RPC) và [Báo cáo xác minh local G4](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-local-validation.md) (18.14.2 TUI với model giả lập loopback).

| Sự kiện OMP | Chuyển thành | Trạng thái xác minh |
| --- | --- | --- |
| `session_start` | `session_start` | Đã quan sát thực tế (18.14.1 print; 18.14.2 TUI) |
| `session_switch` (`new` / `resume` / `fork`) | `session_end` cho generation cũ, `snapshot` cho generation mới | Đã quan sát thực tế (18.14.1, chế độ rpc) |
| `session_shutdown` | `session_end`, gửi nhanh một lần trước khi thoát | Đã quan sát thực tế (18.14.1 print; 18.14.2 TUI); không bảo đảm 100% kịp tới nếu tiến trình bị đóng cưỡng bức |
| `agent_start` / `agent_end` | `turn_start` / `turn_end` với `outcome: "unknown"` | Đã quan sát thực tế (18.14.1 print; 18.14.2 TUI) |
| `message_end` | Nhịp tim cập nhật usage/idle; nội dung tin nhắn không bao giờ được đọc | Đã quan sát thực tế (18.14.2 TUI, model giả lập) |
| `tool_execution_start` / `tool_execution_end` | `tool_start` / `tool_end` (nhóm công cụ suy từ tên tool, lỗi từ `isError`) | Đã quan sát thực tế cho `read` (18.14.1 print); `read`/`write`/`ask`/`task` (18.14.2 TUI) |
| `tool_execution_update` | Không sử dụng (không gửi kết quả trung gian) | — |
| `tool_approval_requested` / `tool_approval_resolved` | Lý do chờ `approval`, khóa theo `toolCallId` | Đã quan sát thực tế (18.14.1, rpc, `--approval-mode always-ask`) |
| `plan_review_requested` / `plan_review_resolved` | Lý do chờ `input`, khóa theo `reviewId` | Đã quan sát thực tế (18.14.2 TUI, mở `/plan-review` thủ công, chọn `execute`): chuyển từ `waiting`/`input` về `idle` trước khi đổi phiên; nhánh hủy/tự động chạy tiếp chưa xác minh |
| Hộp thoại `ask` | **Không hỗ trợ** trạng thái chờ riêng; hiển thị là `active` | Hộp thoại tích hợp trả lời thành công trên 18.14.2 TUI; lúc đang mở vẫn báo `active` |
| `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.getAsyncJobSnapshot()`, `ctx.sessionManager.getSessionId()` | Các trường trong `heartbeat`/`snapshot` | Đọc phòng thủ; nếu thiếu sẽ tự động bỏ qua |
| Thống kê usage, model, provider | Tùy chọn, chỉ nhận số và định danh `model` / `provider` hợp lệ (không gửi thông tin xác thực OAuth) | Đã xác minh trên 18.14.1/18.14.2 |
| Callback của subagent (`task` child) | Chủ đích bỏ qua không gửi | Đã xác minh danh tính con/cha và việc loại trừ trên 18.14.2; báo cáo live cho subagent/advisor vẫn không hỗ trợ |

## Bảo mật lưu trữ trên Windows

Chế độ `0600` của Node không tự áp đặt Windows DACL riêng tư. Module `private-storage.js` tạo thư mục lá riêng tư với DACL được bảo vệ ngay từ lúc tạo: chỉ tài khoản đang chạy, `SYSTEM` và `Administrators` mới có quyền truy cập. Các file tạm được tạo độc quyền trong cùng thư mục, thừa hưởng DACL đó, flush xuống đĩa rồi mới đổi tên nguyên tử (atomic rename). Toàn bộ chuỗi thư mục cha được kiểm tra quyền sở hữu, quyền xóa/chiếm quyền (`DELETE`, `FILE_DELETE_CHILD`, `WRITE_DAC`, `WRITE_OWNER`), reparse point và hardlink trước khi truy cập.

Chỉ khi file chưa tồn tại hoặc nguồn mới chưa có khóa trong file thì hệ thống mới cấp phát token mới. Nếu file chứa JSON lỗi, `null`, token sai định dạng hoặc quyền truy cập không an toàn, hệ thống sẽ từ chối ngay (fail closed): cổng nhận sự kiện hybrid sẽ tắt trong khi chế độ đọc file (`files`) và Claude Code vẫn hoạt động bình thường. Xem thêm tại [Báo cáo khắc phục ACL và xoay vòng token](../../plans/261030-1754-omp-multi-agent-integration/reports/phase-04-token-remediation.md).
