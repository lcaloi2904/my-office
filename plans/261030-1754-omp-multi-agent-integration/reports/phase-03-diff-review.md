# Phase 03 — review toàn bộ diff (31/10/2026)

Phạm vi: nhánh `phase-02-omp-seam`, file đã sửa và chưa track của OMP file observer. Review chỉ đọc; sau review, người dùng duyệt sửa M1/M2 (phần "Đã sửa" bên dưới). Không commit.

## Kết luận

Không có lỗ hổng bảo mật. Có hai lỗi chức năng (M1, M2), đã sửa. Lúc review G3 còn OPEN vì chưa có approval đọc nội dung thật (F9); sau đó F9 đã được kiểm và G3 đã đóng kèm ngoại lệ: [G3 acceptance](./phase-03-g3-acceptance.md).

## Phát hiện

| Mã | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| M1 | trung bình | Index vượt `maxEntries` (4096) hoặc `maxIndexBytes` (1 MiB) bỏ entry mới, nhưng `leaf` vẫn nhảy theo → nhánh rỗng, `items 0`, đếm 0. Probe: 4200 entry (không nội dung) và ~1000 tin × 1500 ký tự hoặc 300 tin × 4000 ký tự (có nội dung) đều ra rỗng; 600 × 1500 vẫn đủ. | Đã sửa |
| M2 | trung bình–thấp | Header chưa đọc (hạn mức 64 lần/scan, hoặc đọc lỗi) hiện như "File chưa được hỗ trợ". | Đã sửa |
| L1 | thấp | `reader.mjs` tạo `TextDecoder` mới cho mỗi dòng. | Chưa sửa, ngoài phạm vi |
| L2 | thấp | Sổ fingerprint của reader cap 4096 block (quá trần thì rebuild, an toàn); chưa có test ở biên. | Chưa sửa |
| L3 | thấp | Tương tác `incomplete` ↔ ghi chú UI mới kiểm bằng đọc code, chưa bằng E2E. | Chưa kiểm |

Chi tiết L4–L7 của bản phân tích trước không còn trong ngữ cảnh nên không liệt kê.

## Đã sửa

- M1: `server/agents/omp/normalize.mjs` — quá trần thì loại entry cũ nhất (giữ đuôi). Nhánh bắt đầu giữa lịch sử, vẫn `incomplete` + diagnostics `index-limit`/`missing-parent`; tổng chi phí/token vẫn `null` (sổ không đủ). Entry đơn lẻ lớn hơn `maxIndexBytes` vẫn bị bỏ. Test mới: `a long session keeps the newest part...`.
- M2: catalogue thêm `pending` (`server/agents/omp/index.mjs`); picker hiện "Chưa đọc xong"/"Not read yet" (`omp-history.js`, i18n en/vi). Header chưa đọc được đọc bù theo lô ở mỗi lần poll, không quét lại cây (xem "F9 trên cây thật" trong báo cáo adapter/UI). Test: `sessions whose header was not read yet are pending, then filled in batches...` và `a header that cannot be read yet is not retried on every pass`.

## Đã kiểm tra, không có vấn đề

- Đọc ngoài root/symlink/junction: `approveRoot`, `containedPath`, `openContained` (lstat chuỗi, `realpath`, dev/ino root, `nlink`, `O_RDONLY|O_NOFOLLOW`); test link giữa đường/trên root.
- API chỉ nhận id `omp:<sha256>`, không nhận path; pin tối đa 8.
- CSRF/loopback: `POST /api/omp/pin` loopback + same-origin + JSON; catalog loopback; `/api/log` OMP loopback-only.
- Rò metadata: `broadcast(..., localOnly)`, lọc `/api/live`, replay và snapshot cho client từ xa; có test.
- Nội dung hội thoại chỉ khi config bật `conversation`; projection allowlist + `redact`.
- Hồi quy Claude: 24 fail SwiftShader giống hệt baseline HEAD; GPU 54/58, 4 fail do `.sh` giả trên Windows (cũng fail ở baseline).
- Lifecycle: `readConversation` ≤2 đồng thời, timeout 8 s; `pollPins` ngân sách 200 ms; `dispose` dọn handle/timer/watcher; OMP mặc định off.
- Tài nguyên: `DEFAULT_LIMITS` là trần tối đa của config; giữ 8 MiB mỗi file.

## Bằng chứng sau sửa

`node --test` 163/163 (161 cũ + 2 mới), ESLint 0 vấn đề, tsc exit 0. Chưa chạy lại build/E2E vì thay đổi chỉ chạm normalizer, trường catalogue và một nhãn i18n.

## Chạy lại build và E2E sau khi sửa (31/10/2026, Windows native)

- `next build` exit 0; E2E OMP file-only 3/3 PASS.
- Suite Claude trên GPU (`--use-angle=d3d11`, `--workers=1`, 13,4 phút): 50 pass / 8 fail. Bốn fail là script `.sh` giả không chạy được trên Windows như đã ghi (`office.spec` tunnel, giao việc từ chat, thêm account, chuyển account). Bốn fail còn lại:
  - `agents.spec` "isolated production server": do tôi đặt sai `CLAUDE_CONFIG_DIR` (phải là `<home>\.claude`); chạy lại với giá trị đúng thì pass.
  - Group chat và phone window: fail trong lượt đầy đủ, pass khi chạy riêng (phụ thuộc trạng thái giữa các test).
  - Mixue ("walking into the Mixue", bước bấm `E` lần hai không hiện "1 item"): fail 5/5 lần ở cả lượt đầy đủ lẫn chạy riêng, **kể cả với bản dựng `.next-win-merged` trước Phase 03**. Lượt GPU trước đó cho test này pass. Đã dựng baseline HEAD sạch (`4f5858a`, xuất bằng `git archive`, build riêng, thư mục đã xóa sau khi chạy): bài này cũng fail 3/3 với cùng thông báo. Vậy đây là fail có sẵn ở baseline, không phải hồi quy của Phase 03. Nguyên nhân gốc chưa được tìm (bước bấm `E` lần hai không đổi nhãn sang "1 item"); lượt GPU trước đó pass nên có yếu tố môi trường hoặc thời điểm chạy, chưa chứng minh.

## Câu hỏi còn mở

1. Duyệt đọc nội dung thật (header `cwd`/title, nghĩa tombstone, liveness) để đóng F9 của G3?
2. Có muốn E2E bao `pending` trong picker, hay chỉ unit là đủ?
