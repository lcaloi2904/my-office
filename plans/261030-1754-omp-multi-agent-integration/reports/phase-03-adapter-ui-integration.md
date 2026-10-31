# Phase 03 — adapter, server và UI persisted-only (G3: closed with accepted exceptions, 31/10/2026)

> Quyết định đóng G3 và các ngoại lệ: [phase-03-g3-acceptance.md](./phase-03-g3-acceptance.md). Nội dung bên dưới là bằng chứng và lịch sử; các dòng "G3 vẫn OPEN" nếu còn xuất hiện là trạng thái trước quyết định này.

Ngày 31/10/2026, Windows native (PowerShell/Git Bash, Node v24.22.1), branch `phase-02-omp-seam`, HEAD `4f5858a` (không commit/push). Tiếp nối [phase-03-implementation.md](./phase-03-implementation.md); G2 không mở lại.

## Kết quả

Adapter lifecycle, catalogue, pin, server API và UI persisted-only đã được viết và qua unit/lint/typecheck, production build và **file-only E2E 3/3 trên fixture synthetic**, tất cả **native Windows**. Claude browser regression: xem "Claude regression" bên dưới (có ngoại lệ môi trường). F9 đã được kiểm trên cây OMP thật ở mức cấu trúc (xem "F9 trên cây thật"). G3 đã được người dùng đóng kèm ngoại lệ; các điểm còn thiếu nằm ở "Giới hạn còn lại cho G3" và [G3 acceptance](./phase-03-g3-acceptance.md).

## Blocker cũ

`Write` native tạo được `server/agents/omp/index.mjs` ngay lần đầu; lỗi từ chối của `files_write` (CloudHarness) lần trước không tái hiện. Không đi đường vòng nào.

## Đã làm

| Phần | File | Ghi chú xác minh |
|---|---|---|
| Adapter | `server/agents/omp/index.mjs` | Scan BFS có trần (depth/dir/entry/catalogue), đọc header ≤8 KiB, một handle tại một thời điểm, poll tuần tự, backoff khi lỗi, `refresh()`/`dispose()`; timer chỉ tạo sau `start()` và `unref` |
| Catalogue + pin | cùng file | Chỉ public id `omp:<sha256>`; trùng session id giữa nhiều file = `conflict`, không pin; con trong cây artifact chỉ đếm, không thành actor; pin theo id nên theo file khi đổi tên/di chuyển; pin lưu id vào `data/omp-pins.json` |
| Conversation | cùng file | Parse một lần riêng (`includeContent`), cap 2 đồng thời, timeout 8 s; snapshot sống không giữ text; adapter kiểm lại cờ `conversation` của config |
| Projection/schema | `projection.mjs`, `schema.mjs` | Allowlist `persistedOnly`; `readConversation` chỉ mở khi record persisted và cờ `=== true`; mọi control khác vẫn false |
| Server | `server/index.mjs` | `OFFICE_OMP=files` + `OFFICE_OMP_CONFIG` (chỉ đọc khi files); `hybrid` vẫn off; `GET /api/omp/catalog`, `POST /api/omp/pin` (loopback, same-origin, JSON, chỉ id); `/api/log` cho OMP chỉ loopback; `agents.start()` được gọi; chỉ phát `sess`/`gone`, không phát `ev` |
| UI | `omp-history.js` (mới), `workers.js`, `activity.js`, `lite.js`, `session-drawer.js`, `demo.js`, `main.js`, `sessions.css` | Nhãn "History · not live", picker (rail + List Mode), pin/unpin, conversation chỉ khi server cho phép; không thêm nút điều khiển |
| i18n | `locales/{en,vi}/{activity,drawer}.js` | Khóa mới đủ en/vi; test i18n pass |
| Tests | `omp-adapter` (18), `omp-projection` (4), `agent-compat` (+2 route, 1 test cập nhật) | Xem dưới |

## Lỗi tự bắt được khi review (đã sửa, có test)

- Route `POST /api/omp/pin` nằm sau cổng 405 nên không bao giờ chạy: bắt bởi test route, đã chuyển lên nhóm POST.
- Timer và `refresh()` có thể chạy hai pass chồng nhau (vi phạm "một handle một lúc", `dispose` có thể trả về khi còn handle): nay chỉ có một `run()` duy nhất, pass sau join pass đang chạy. Test mới dùng bộ đếm `lstat` đồng thời; đã làm mutation (bỏ `??=`) thì test đỏ, khôi phục thì xanh.
- Nhãn `recent` sai khi scan bị cắt (thứ tự dirent không phải thứ tự thời gian): khi nguồn `truncated`, mọi mục là `history`. Test: tên file ngược thứ tự mtime với `scanEntries: 3`.
- Client: pin/unpin không còn walk-in, không "left" trong group chat, không animation rời văn phòng (`persistedOnly` được gate trong `applyMsg`).
- E2E lần đầu fail 2/3: `POST /api/omp/pin` trả lời trước khi snapshot đầu tiên có mục vừa pin nên `/api/log` ngay sau đó là 404. Handler nay `await refresh({ rescan: false })` trước khi trả lời; E2E chạy lại 3/3, `npm test` vẫn 156/156 (lúc đó).

Các hàng còn lại của bảng "Đã làm":

| Phần | File | Ghi chú xác minh |
|---|---|---|
| E2E | `tests/e2e/omp-files.spec.ts`, `omp-fixture.mjs`, `playwright.omp.config.ts`; `playwright.config.ts` thêm `testIgnore` cho spec này | 3/3 PASS; config mặc định vẫn OMP off |
| Docs | `docs/ARCHITECTURE.md` | Bảng server, mục "Optional: OMP history", module map |

## Thay đổi hợp đồng có chủ đích

Test Phase 02 `production mode and registration do not read config…` khẳng định `files` luôn effective off và chỉ đọc `OFFICE_OMP`. Phase 03 được duyệt thay đổi điều đó nên test được viết lại: `off`/`hybrid`/mode lạ vẫn chỉ đọc `OFFICE_OMP`, không tạo adapter; thêm ca `files` thiếu config → off, `files` + config → files, config lỗi → off. Các test khác chỉ được bổ sung dependency injection (`ompAdapter: null`, `ompButton`, `unknownLabel`); không đổi/giảm assertion nào. Nhờ test route này mà phát hiện route `POST /api/omp/pin` đặt sau cổng 405 (không bao giờ chạy) và đã chuyển lên.

## Kiểm chứng đã chạy (native Windows)

| Check | Kết quả |
|---|---|
| 4 module core (`node --test` bốn file) | 37/37 PASS, 0 skip — lần đầu trên Windows (trước đây chỉ WSL) |
| `npm test` (`node --test`) | **161/161 PASS**, 0 skip/todo (156 + broadcast local-only + pin file lớn + cây cỡ thật + cache scan + link giữa đường dẫn) |
| ESLint (gọi API `ESLint` trực tiếp) | sạch, 287 file |
| `tsc --noEmit` (gọi `typescript/bin/tsc`) | không lỗi |
| Junction/symlink/hardlink thật trên NTFS | `lstat().isSymbolicLink()` đúng cho junction, symlink dir và file; F11 test không bị skip ngầm |
| Smoke adapter trên fixture sinh tự động, hai nguồn, fs thật | catalogue 3 mục, pin 3, conversation đọc đúng nguồn bật và `[]` nguồn tắt, dispose về 0 runtime/timer |
| `next build` (`OFFICE_DIST_DIR=.next-win-p3`, người dùng duyệt chạy qua PowerShell) | PASS, exit 0 |
| File-only E2E, `playwright.omp.config.ts`, fixture synthetic, `--workers=1` | **3/3 PASS** (sau khi sửa race ở handler pin, xem trên) |
| `agents.spec.ts` (Claude lifecycle + OMP off), `--workers=1` | **6/6 PASS**. Lượt gộp đầu có 1 fail do runner thiếu `HOME`/`CLAUDE_CONFIG_DIR` cô lập (guard fail-closed của spec); chạy lại với env cô lập thì PASS |
| `office.spec.ts` + `chat-preview.spec.ts`, `--workers=1`, SwiftShader | 33 pass / **24 fail** (xem "Claude regression") |

`npm run lint/typecheck` không chạy được trên Windows: `node_modules` cài từ Linux, không có shim `.cmd` (đã ghi nhận ở báo cáo G2 native). Hai lệnh trên là cách gọi tương đương, không phải script npm. Next build tự sửa `tsconfig.json` (thêm include `.next-win-p3`); tôi đã `git checkout -- tsconfig.json` và kiểm lại sạch sau lần chạy cuối.

## Benchmark synthetic (adapter, Windows native, fs thật; không phải claim hiệu năng cho người dùng)

Script sinh 1000 file ở 100 thư mục (mỗi file 20 entry; 8 file mới nhất 6,7 MiB / 20 000 entry), `--expose-gc`, một máy, một lần chạy, mặc định limits. Chỉ là mốc đo, không có so sánh trước/sau.

| Phép đo | Kết quả |
|---|---|
| Scan 1000 file (cap mặc định) | ~3,0 s, 64 lần open (cap 32 header/scan), catalogue dừng ở 128 mục |
| 8 pin file lớn → sẵn sàng | 2 pass, ~3,0 s đo thực (~4 s với `pollMs` 2 s); heap 6 → 13 MiB; cả 8 `incomplete: true` vì vượt `maxEntries` 4096 (đúng thiết kế, số tổng không được coi là đầy đủ) |
| Poll rảnh ×10 (8 pin, file không đổi) | 259 ms tổng, 8 open mỗi poll |
| Poll sau khi append vào 8 file | 29–97 ms |
| Rescan | ~1,8 s, 40 open |
| 100 poll liên tiếp | heap 13,3 → 13,4 MiB; RSS dao động +5 MiB (GC/buffer, chưa chứng minh là rò rỉ) |
| `dispose()` | state `disposed`, 0 timer; thư mục tạm xóa sạch |

**Lỗi tìm ra nhờ benchmark và đã sửa:** mỗi pass chỉ đọc một lát `bytesPerTick` (128 KiB) cho mỗi pin, nên file 6,4 MiB cần ~50 pass (~100 s ở `pollMs` 2 s) mới có snapshot đầu tiên, và trong thời gian đó pin không hiện gì (`recordOf` trả null). Nay một pass đọc liên tục cùng một file tối đa 200 ms (`PIN_PASS_BUDGET_MS`), vẫn từng handle một, hủy được giữa các lát và có trần số lần poll. Test mới `a pinned file larger than one read slice…` (đã mutation: ngân sách 0 → đỏ). Giới hạn còn lại: file vượt 200 ms/pass vẫn cần vài pass, và trong lúc đó pin chưa hiện (chưa có trạng thái "đang đọc" trong UI).

## Layout thật (người dùng duyệt; chỉ liệt kê tên, kích thước, mtime, không mở file nào)

Root `~/.omp/agent/sessions` do người dùng cung cấp. Không chạy adapter trên root thật. Tên project và session không được chép vào báo cáo.

| Quan sát (chỉ từ tên và thống kê) | Số liệu |
|---|---|
| Quy mô | 17 thư mục project, 528 thư mục, 5092 file, 1528 MiB; 0 junction/symlink |
| Session chính | 588 file `<timestamp>_<uuid>.jsonl` ở độ sâu 2; thư mục project lớn nhất có 494 entry (272 session) |
| Thư mục artifact | `<timestamp>_<uuid>/` cạnh file chính (đúng giả định F9), chứa 785 `.jsonl` con (`__advisor.jsonl` 109, còn lại tên theo nhiệm vụ), 22 `<tên>.jsonl.tombstone` 0 byte (cả 22 đều có `<tên>.jsonl` cạnh), hàng nghìn `N.<tool>.log`, `.md`/`.json` và vài `.html` ở độ sâu 4 |
| Kích thước session chính | trung vị ~831 KiB, lớn nhất 8,5 MiB; **3 file vượt trần 8 MiB** nên sẽ hiện là không hỗ trợ/incomplete |
| Thời gian | mtime từ 23/08 đến hôm nay |

Bản sao tổng hợp cùng hình dạng (17 project, 588 chính, 515 thư mục artifact, 687 con, 4120 log; chỉ số lượng, không tên hay nội dung thật) lộ hai lỗi với trần cũ. Đã sửa và có test hồi quy (mutation: bỏ bảo vệ con → test đỏ):

| Lỗi | Trước | Sau |
|---|---|---|
| Trần 128 thư mục/session/entry | catalogue 128/588, scan bị cắt, **0 nhãn recent**; thư mục 494 entry chỉ đọc 128 tên đầu (NTFS trả theo tên, cũ trước) nên mất session mới nhất | 588/588, không cắt, 16 recent |
| Hạn mức đọc header (32/scan) bị tiêu vào file con (con là file mới nhất) | trang đầu **0/50** session pin được | **50/50** sau một scan (hạn mức nâng lên 64, bỏ qua con) |

**Tối ưu scan (người dùng yêu cầu).** Chi phí lúc đầu: scan ~5,0 s, rescan ~2,5 s mỗi 60 s. Ba thay đổi, đo trên cùng bản sao, hai lần chạy:

| Thay đổi | Cách làm | Kiểm soát an toàn giữ nguyên |
|---|---|---|
| `containedPath` chỉ `lstat` các thành phần **dưới** root | Chuỗi từ gốc ổ đĩa đến root đã kiểm lúc `approveRoot`; mỗi lần gọi vẫn kiểm lại danh tính root (dev/ino, không phải link) và so `realpath` toàn đường dẫn | Test mới: link ở giữa đường dẫn và link phía trên root vẫn bị từ chối (junction thật) |
| File con trong thư mục artifact chỉ đếm | Không `containedPath`+`lstat` từng file con (con không bao giờ là actor hay được mở; symlink đã bị loại bằng Dirent) | Mọi lần mở file vẫn qua `openContained` |
| Thư mục artifact không đổi mtime thì không list lại | Cache theo `dev:ino`+mtime; thư mục đổi (thêm/xóa con) được list lại, nên số con luôn cập nhật | Chỉ quyết định bỏ qua việc đọc; lần đọc luôn qua `containedPath` |

Kết quả: **scan lần đầu ~2,1–2,3 s (từ ~5,0 s), rescan ~0,9–0,95 s (từ ~2,5 s)**. Còn lại chủ yếu là `containedPath` + `lstat` cho 588 file chính và `lstat` 515 thư mục. Giảm thêm cần bỏ kiểm tra chuỗi cho từng file chính; tôi không làm vì đánh đổi an toàn. Test mới (mutation: tắt cache → đỏ): thư mục không đổi không bị list lại, thêm một con thì chỉ thư mục đó được list lại và số con tăng.

Chưa kiểm chứng: nội dung header (`cwd`, title), ý nghĩa tombstone, cách OMP đóng hoặc xóa con. **Quyết định của người dùng: giữ trần 8 MiB mỗi file** (3/588 session thật vượt trần, hiện là không hỗ trợ).

## F9 trên cây thật (người dùng duyệt đọc nội dung, 31/10/2026)

Phạm vi và cách làm: `%USERPROFILE%\.omp\agent\sessions`, chỉ đọc (mở `O_RDONLY`, bọc fs chặn mọi lệnh ghi), không chạy OMP, không gọi model. Script chỉ in số đếm, tên trường, kiểu giá trị và vài định danh liệt kê (tên loại bản ghi, `customType`, `role`); không in văn bản tin nhắn, `cwd`, tiêu đề hay id. Mẫu: 80 session chính (40 mới nhất + 40 rải đều), 25 con advisor, 40 con khác; riêng liên kết cha–con duyệt cả 785 con (chỉ header).

| Câu hỏi F9 | Kết quả trên cây thật |
|---|---|
| Layout | 588 session chính ở độ sâu 2 (`<project>/<stem>.jsonl`); 785 con đều ở độ sâu 1 dưới `<stem>/`; 22 `.tombstone` |
| Header | Bản ghi đầu là title slot đúng 256 byte (80/80), bản ghi thứ hai là `session` version 3 với `cwd`, `id`, `timestamp`; 16/80 có thêm `title`, `titleSource`. `cwd` luôn là đường dẫn tuyệt đối kiểu ổ đĩa Windows. Header không có `kind`/`depth` |
| Danh tính | `header.id` nằm trong tên file chính (80/80), con thì không. Không có chính nào có `parentSession`/`continuationOf` (0/588) |
| Cha–con | 379/676 con "task" có `parentSession` trỏ về file chính mà đường dẫn suy ra (379/379 khớp tên file và id); 297 con task và 109 advisor không có liên kết trong header, chỉ có đường dẫn. Đường dẫn là nguồn quyết định; `parentSession` chỉ là xác nhận |
| Tombstone | 22 file 0 byte, cả 22 cạnh một con task có `session_exit` (17 bản ghi cuối là `session_exit`, 5 đã được ghi tiếp sau đó), mtime con không cũ hơn tombstone. Chỉ là suy luận "dấu của con đã kết thúc/đã từng được nối lại", không có tài liệu OMP xác nhận; adapter vẫn bỏ qua |
| Advisor | 109 file, toàn tin nhắn, không `parentSession`, không `session_exit`, không tombstone |
| Liveness | `session_exit` chỉ có ở khoảng 10% session chính (8/80 mẫu) bất kể tuổi file; 35/80 file cũ hơn 7 ngày cũng không có. Vắng `session_exit` không chứng minh đang chạy. Có `session_exit` mà bản ghi cuối không phải nó ở 2 session chính (đã được nối lại). Giữ nguyên thiết kế: mọi actor là `historical`, trạng thái "không phải đang chạy" |
| Normalizer | 80/80 chính và 65/65 con `supported`, không diagnostics. 1 con advisor rất dài chạm `index-limit` và được gắn `incomplete`, đúng hành vi sau khi sửa |
| Adapter, files mode | Catalogue 588/588 `supported`, 0 xung đột, 785 con được đếm dưới 221 session chính, 16 `recent`, liveness `unknown`, id đều dạng `omp:<sha256>`, không lộ đường dẫn. Chỉ có lệnh fs `lstat`/`realpath`/`opendir`/`open` |

Kết luận F9: root/parent identity đúng và lịch sử không tự sinh actor sống, trên một bản cài OMP.

Phát hiện mới từ dữ liệu thật:
1. **Đã sửa.** Trước đây đọc header trên cây thật cần khoảng 10 lần quét (64 header mỗi lần, quét cách nhau `reconcileMs` = 60 giây), tức khoảng 10 phút để 588 session hết "Chưa đọc xong". Nay mỗi lần poll (2 giây) đọc tiếp lô header còn thiếu (mới nhất trước) từ catalogue sẵn có, không liệt kê lại cây (`fillHeaders` trong `server/agents/omp/index.mjs`). Một header chưa đọc được (ví dụ file chưa có dòng hoàn chỉnh) được thử lại sau một khoảng `reconcileMs`, không thử mỗi lần poll. Đo trên cây thật: 9 lượt poll, 2,4 giây (trước 10 lần quét đầy đủ, 10,8 giây), `opendir` không tăng sau lần quét đầu, `lstat` 9.176 (trước 49.370). Với `pollMs` mặc định 2 giây, tương đương khoảng 18 giây thay vì khoảng 10 phút. Kèm theo sửa một race có sẵn: nếu `dispose()` chạy xen vào lúc một lượt đang chờ, lượt đó có thể tạo lại reader cho pin trong lúc dispose đang dọn; nay lượt dừng khi đã dispose và `syncRuntimes` không chạy sau dispose.
2. 3/588 session chính lớn hơn 8 MiB (lớn nhất 8,5 MiB); ghim chúng sẽ báo file vượt giới hạn. Giữ trần 8 MiB theo quyết định của người dùng.
3. **Đã xử lý.** `projectKey` là null cho cả 588 vì chưa có `projectMappings`. Đã tạo config thật `data/omp-config.json` (thư mục `data/` đã gitignore, không vào repo): một nguồn `omp-local`, `conversation: false`, 13 ánh xạ thư mục dự án (mỗi dự án một `projectId` theo tên thư mục, `worktreeId: main`). Kiểm bằng chính `readConfigFile` của server và adapter chỉ-đọc: 583/588 session có `projectKey` thuộc 13 project (nhóm lớn nhất 272 session); 5 session còn lại ở thư mục tạm (`C:\tmp`, `AppData\Local\Temp`) cố ý chưa ánh xạ. Thư mục con (`chia-tien-tro\apps\api`) rơi vào project cha theo tiền tố dài nhất. Muốn dùng: `OFFICE_OMP=files` và `OFFICE_OMP_CONFIG=E:\vide-code\my-office\data\omp-config.json`; mặc định vẫn tắt.
4. Normalizer đánh nhãn `parentSession` là `fork`/`inherited`. Trên dữ liệu thật, `parentSession` chỉ xuất hiện ở con trỏ về session chính của nó. Hiện không ảnh hưởng vì con không bao giờ được đọc làm actor, nhưng cần sửa nếu sau này đọc con.

## Claude regression (đối chứng baseline)

Không có assertion nào bị đổi. Để biết 24 fail của `office.spec.ts` có do Phase 03 không, tôi xuất HEAD sạch (`git archive` → thư mục tạm gitignored trong repo, build riêng `.next-base`, cùng cổng/HOME cô lập, cùng `--workers=1`, nay đã xóa) và chạy cùng test:

| Bằng chứng | Kết quả |
|---|---|
| Hai test đơn giản nhất (`panels open and close`, `a session opens its drawer from the list`) | Fail **cùng dòng 39 và 86**, cùng "waiting for element to be visible, enabled and stable" suốt 90 s ở cả baseline lẫn build hiện tại |
| Toàn bộ `office.spec.ts` trên baseline (dừng ở test 46/58 vì phiên ngắt) | 21 fail / 25 pass; 6 test fail ở baseline nhưng không fail ở lượt hiện tại → kết quả dao động giữa các lượt |
| 5 test chỉ fail ở lượt hiện tại (tour, lift, test board, traffic police, stand-up) chạy riêng | Hiện tại: 4 fail / 1 pass. Baseline: **4 fail / 1 pass, cùng bộ test** (lift pass ở cả hai) |
| 4 test cuối (account, move account, image thumbnail, machine drawer) | Fail trên baseline sạch |

Kết luận SwiftShader: cả 24 test fail đều fail (hoặc dao động) trên baseline HEAD sạch, đúng ngoại lệ G2-E1/E2 (chờ trạng thái mô phỏng hoặc actionability quá giờ). Lượt toàn bộ baseline mới đến 46/58 test; các test đứng sau chưa được đối chứng.

**Lượt GPU (Chromium `--use-angle=d3d11`, AMD Radeon 780M, wrapper G2 `playwright.gpu.config.ts` đặt trong `test-results-p3-gpu/` đã gitignore, `--workers=1`, cả ba spec, build hiện tại sau thay đổi pin local-only):** **54 pass / 4 fail trong 13,2 phút** (SwiftShader: 1,2 giờ). Toàn bộ test hoạt cảnh/UI đã xanh. 4 fail còn lại đều dùng test double là script `.sh`:

| Test (`office.spec.ts`) | Lỗi |
|---|---|
| `:459` tunnel switch | "The tunnel isn't open yet: **spawn EFTYPE**" (`fake-cloudflared.sh`) |
| `:704` giving Claude work from the chat | sheet không ẩn (`fake-claude.sh`) |
| `:2525` adding a Claude account | `.pa-browser` không xuất hiện (`fake-claude.sh auth login`) |
| `:2593` an open conversation moves to another account | `.claude.json` không được tạo (`fake-claude.sh`) |

Windows không thực thi được `#!/bin/sh` qua `spawn`, nên bốn test này không thể xanh trên Windows native, độc lập với Phase 03; chúng cũng đã fail trên baseline SwiftShader ở trên. Cần Linux/macOS/WSL để có lượt xanh cho riêng bốn test này (chưa chạy: bản build `.next-win-p3` dùng SWC Windows). Kết luận: **không có hồi quy do Phase 03; suite Claude xanh 54/58 trên GPU Windows, 4 test còn lại là giới hạn harness Windows.**

## Chưa chạy (NOT RUN)

- 4 test Claude dùng script `.sh` giả (tunnel, giao việc từ chat, thêm account, chuyển account): chưa có lượt xanh vì Windows không `spawn` được `.sh`; cần Linux/macOS/WSL.
- Đối chứng baseline cho phần `office.spec.ts` đứng sau test 46 trên SwiftShader: chưa có (các test fail đã được đối chứng riêng; lượt GPU đã phủ cả suite).
- Phát metadata pin tới client từ xa thật (Playwright chỉ đi qua loopback): chỉ có test hợp đồng + review.
- Phase 04, bản cài OMP thật, chạy OMP hoặc gọi model: không đụng. Nguồn thật đã được đọc chỉ ở mức cấu trúc cho F9 (xem "F9 trên cây thật"); UI trên dữ liệu thật và đọc hội thoại thật chưa chạy.
- Benchmark CPU/RAM/soak: không chạy, không có claim hiệu năng.

## Giới hạn còn lại cho G3

1. **F9 đã khớp cây thật ở mức cấu trúc** (xem "F9 trên cây thật"): con artifact nhận diện theo đường dẫn, và header của con xác nhận cùng quan hệ ở 379/379 trường hợp có `parentSession`. Con không là actor, không pin được; `.tombstone` bị bỏ qua. Chưa xác minh trên một phiên bản OMP cụ thể, chỉ một bản cài trên máy này.
2. Move/rename: pin theo id đi theo file (có test); chưa có reconcile cho trường hợp hai file cùng id (bị đánh dấu conflict, không tự chọn).
3. Scan vẫn bị cắt theo thứ tự thư mục (không theo thời gian) khi vượt trần, và khi đó không mục nào được gắn `recent`. Trần mặc định đã nâng theo cây thật (`maxSessions` 2048 gồm cả con, `scanEntries` 1024 mỗi thư mục, `maxDirectories` 1024); cây lớn hơn nữa vẫn bị cắt. Chi phí scan trên bản sao cỡ cây thật sau tối ưu: ~2,2 s lần đầu, ~0,9 s mỗi 60 s (xem "Layout thật"). Không có LRU/TTL cho catalogue (xây lại mỗi lần scan 60 s); TTL chỉ áp cho pin có file mất tích.
4. Conversation phân trang theo `limit` ≤120 mục cuối; chưa có cursor ngược.
5. Reader xác minh lại các block cũ khi file đổi — I/O không tỉ lệ tuyệt đối với byte append (đã ghi ở báo cáo trước).
6. Native Windows: junction/symlink thấy được qua `lstat`; chưa kiểm chứng race thay thế thư mục đồng thời hay root nằm dưới junction hợp lệ (bị từ chối có chủ đích).
7. ~~Metadata pin phát tới LAN/tunnel và ghi replay~~ — **đã thu hẹp** theo đề xuất được duyệt: `sess`/`gone` của pin là local-only (`broadcast(msg, true)`): không gửi SSE tới client không phải loopback, bị lọc khỏi `/api/live` của client từ xa, snapshot từ xa và snapshot replay, và không ghi vào replay log. Test: `agent-compat` (broadcast + ba điểm lọc), unit 157/157, E2E OMP 3/3 chạy lại. Chưa có test HTTP end-to-end từ client từ xa thật (Playwright chỉ đi qua loopback), nên phần lọc ở `/api/live` và snapshot được kiểm bằng test hợp đồng trên mã nguồn cộng review.

## Review bảo mật

| Bề mặt | Kiểm soát | Bằng chứng |
|---|---|---|
| Đọc ngoài root, symlink/junction/hardlink, đổi file giữa check và open | `approveRoot`/`containedPath`/`openContained` (lstat từng thành phần, nlink, dev/ino sau open), mọi open `O_RDONLY` | `omp-paths` (37 core), F11 adapter với junction + symlink thật; không handle nào mở ngoài root |
| Pin nhận path | Chỉ id `omp:<sha256>` trong catalogue; mọi giá trị khác bị 400 | `omp-adapter` pins, route test (`/etc/passwd`), E2E (3 id path/lạ → 400) |
| CSRF / DNS rebinding / tunnel | Pin: loopback + same-origin + JSON; `isLoopback` loại `viaTunnel`; `hostAllowed` có sẵn | Route test: remote, same-origin sai → 403 trước khi gọi adapter |
| Rò nội dung | Metadata allowlist; không title/prompt/cwd/path trong catalogue, snapshot hay replay; text chỉ qua `/api/log` | `omp-adapter` (JSON catalogue không chứa secret/path), `omp-projection`, route `/api/log` |
| Conversation | Cờ `conversation` từ config đã validate; adapter kiểm lại; parse một lần, loopback-only, ≤2 đồng thời, timeout 8 s, redact + cap | `omp-adapter` (hai ca), route test |
| Điều khiển | `readConversation` là capability duy nhất mở; `resolveForControl`/`hasClaudeCapability` không đổi | `omp-projection`, test Phase 02 giữ nguyên |
| XSS | Picker/drawer dựng bằng `el`/`textContent`; tên project lọc `[\p{L}\p{N} ._-]` ở cả adapter và projection | `omp-projection` (tên độc hại) |
| Tài nguyên | Trần dir/entry/depth/catalogue/pin/dòng/file; một pass một lúc; dispose dọn handle/timer | `omp-adapter` (bounds, overlap, dispose) |
| Claude regression | Claude giữ đường cũ; thay đổi UI gate bằng `persistedOnly`; test Phase 02 chỉ được thêm dependency injection, và 1 test hợp đồng được viết lại có chủ đích | `npm test` 161/161; `agents.spec` 6/6; GPU suite 54/58, 4 fail do script `.sh` không chạy trên Windows (xem "Claude regression") |

Residual: redact là best-effort; một root nằm dưới junction hợp lệ bị từ chối. Metadata pin không còn rời máy này (giới hạn 7).

## Cách đã chạy và cách chạy lại (PowerShell, từ thư mục repo)

Hook `scout-block` chặn Bash khi lệnh chứa `node_modules`; người dùng đã duyệt chạy các lệnh này qua PowerShell tool, không sửa `.ckignore`. Giữ cùng `OFFICE_DIST_DIR` cho mọi lệnh và đặt `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` về thư mục cô lập `<E2E_OUT>\home` khi chạy `agents.spec.ts` (guard của spec):

```
$env:OFFICE_DIST_DIR='.next-win-p3'; $env:NEXT_TELEMETRY_DISABLED='1'; node node_modules\next\dist\bin\next build
$env:E2E_OUT='test-results-omp-e2e'; node node_modules\@playwright\test\cli.js test -c playwright.omp.config.ts --workers=1
$env:E2E_OUT='test-results-p3-claude'; node node_modules\@playwright\test\cli.js test agents.spec.ts office.spec.ts chat-preview.spec.ts --workers=1
```

Dùng `node …\cli.js` thay `npx` vì `node_modules` không có shim Windows. `OFFICE_OMP` trong config OMP do `playwright.omp.config.ts` tự đặt. Thư mục kết quả `test-results-*` và `.next-win-p3` đã gitignore. Lượt GPU dùng wrapper G2 (`reports/g2-diag-scripts/playwright.gpu.config.ts.txt`) chép vào `test-results-p3-gpu/` và chạy bằng `-c`.

## Câu hỏi còn mở

- Có muốn ánh xạ luôn hai thư mục tạm (`C:\tmp`, `AppData\Local\Temp`, 5 session) không, hay để rỗng?
- Có coi G3 đã đủ để đóng không? Các điểm còn thiếu: chỉ một bản cài OMP được kiểm, bốn test `.sh` chưa xanh trên Windows, bài Mixue fail có sẵn ở baseline.
