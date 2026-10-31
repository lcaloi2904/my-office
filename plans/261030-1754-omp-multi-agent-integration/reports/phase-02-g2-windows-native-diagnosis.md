# Phase 02 — Chẩn đoán G2 trên Windows 11 native

Ngày 31/10/2026, Asia/Ho_Chi_Minh. Repo `E:\vide-code\my-office`, branch `main`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`, PowerShell, Node v24.22.1, npm 11.19.1, Playwright 1.56.1 (Chromium 1194 bản Windows), GPU AMD Radeon 780M. Workflow: scout → debug → test → review → docs; AgentKit chạy qua skills/agents sẵn có trong phiên, không dùng lệnh nào chưa xác minh.

**Kết luận: không có thay đổi source nào trong lượt này.** Hai timeout là lỗi môi trường **đã có sẵn từ HEAD sạch**, không phải regression của Phase 02: trình duyệt Playwright mặc định vẽ WebGL bằng SwiftShader (CPU), mỗi frame chặn main thread ~3 s. Khi cho trình duyệt dùng GPU thật, panels đạt 10/10 với test gốc nguyên văn. Ca session drawer còn hai nguyên nhân riêng (cold start, và race sắp xếp lại rail) nên **chưa ổn định** kể cả có GPU. **G2 giữ OPEN**: chờ người dùng quyết định điều kiện nghiệm thu (xem mục 6).

## 1. Điều kiện chạy

Mỗi lượt có HOME/USERPROFILE/CLAUDE_CONFIG_DIR/OFFICE_DATA_DIR riêng trong `test-results-win-<tên>/`, loopback `127.0.0.1:4399`, workers=1, retries=0, `OFFICE_OMP=off`, `OFFICE_USAGE=0`, `OFFICE_CI=0`, `OFFICE_TRANSLATE=0`, `NEXT_TELEMETRY_DISABLED=1`. Các biến chỉ đặt trong process PowerShell chạy test. Build riêng `.next-win-g2`. Viewport 1440×900, test 90 s, expect 30 s. Không sửa `playwright.config.ts`, tests, package, lockfile.

Giới hạn của `node_modules`: được cài từ Linux, không có shim `.cmd` và chỉ có binding linux. `npm run lint` và `npm run typecheck` trả **exit 1** ("not recognized"), nên đã gọi trực tiếp `node node_modules\eslint\bin\eslint.js .` và `node node_modules\typescript\bin\tsc --noEmit` (exit 0). Build chạy `node node_modules\next\dist\bin\next build`, không phải `npm run build`.

**Cần người dùng biết:** lần build đầu, Next tự tải `@next/swc-win32-x64-msvc` (36 MB) về `%LOCALAPPDATA%\next-swc` (ngoài repo, không đổi `node_modules` hay lockfile). Đó là hành vi tự động của Next, tôi không chủ động cài. Có thể xóa thư mục này nếu không muốn giữ (build sau đó sẽ tải lại). Lần build này mất 572 s phần lớn do tải; build HEAD sau đó chỉ 21 s.

## 2. Root cause cho `panels open and close`

Tái hiện trên Windows (cấu hình mặc định, `test-results-win-repro1`): timeout 90 s tại `page.click('#dr-mac [data-close]')`. Không có dòng "intercepts pointer events" hay "not stable" trong log `pw:api`, và không có `#zc-peek` ở bất kỳ log nào, nên bản sửa popup vẫn đúng.

Đo được (`test-results-win-diag3`):

- WebGL renderer: `ANGLE (Vulkan, SwiftShader Device (Subzero))`, tức render bằng CPU.
- rAF median ~3.100–3.300 ms, long task ~3,1 s liên tục; mỗi click Playwright trải ~11–12 frame rAF nên tốn 30–36 s (click `#dr-mac [data-close]` 34.789 ms).
- Process GPU của SwiftShader chiếm 700–1.240% CPU, renderer main thread chỉ ~7%: main thread chờ GPU process, không bị JS chiếm. RAM trống ~9–10 GB, không thiếu RAM.
- Bộ đo `?debug` của app (`frame-swiftshader`): 8 frame/22,5 s (0,36 fps), JS mỗi frame ~48 ms, `renderer.info` = 1.401 draw calls, 1.674.978 tam giác, `pixelRatio` 0,5, không shadow.
- Khi bấm `#btn-lite` (List Mode) rAF về 17 ms và long task = 0.

Đối chứng cùng build, cùng bước:

| Điều kiện | WebGL | fps | click `[data-close]` | flow panels |
|---|---|---|---|---|
| Headless shell mặc định | SwiftShader | 0,36 | 34.789 ms | >300 s |
| Headless shell + `--use-angle=d3d11` | AMD Radeon 780M D3D11 | 26,6 | ~0,3 s | ~6 s |
| New headless (`channel: 'chromium'`), không cờ | AMD Radeon 780M D3D11 | — | 424 ms | PASS |

Suy luận (chưa profile sâu): chế độ `SOFTWARE_GL` (`renderer.js:46`, `loop.js:62` frame gap 200 ms) giảm pixel và shadow nhưng không giảm ~1,67 M tam giác, nên mỗi frame vẫn tốn ~3 s; `frameGap` chỉ giới hạn khoảng cách bắt đầu frame, không chừa thời gian rảnh cho input.

**Không phải regression Phase 02.** Bản HEAD sạch (`git archive HEAD`, build `.next-head`) cùng điều kiện: 1.394 draw calls, 1.669.778 tam giác, 0,16 fps, và cả hai test gốc đều timeout 90 s (`test-results-win-head-orig`).

## 3. Ca `a session opens its drawer from the list` — nguyên nhân riêng

Ba cơ chế khác nhau, không gộp với panels:

1. **Cùng độ trễ SwiftShader.** Mặc định, repro1 timeout ở bước click `[data-close]` cuối.
2. **Race sắp xếp lại rail (test synchronization).** Trên HEAD sạch, `.first()` resolve thành `demo-0` nhưng lúc click thì `demo-2` "intercepts pointer events" do rail demo đổi thứ tự trong khi frame chậm. Chưa thấy lại dòng "intercepts" nào trong 10 lần chạy GPU; đây là rủi ro tiềm ẩn, chưa chứng minh là nguyên nhân duy nhất ở SwiftShader.
3. **Cold start vs ngân sách cố định 20 s (`office.spec.ts:81`).** Dưới GPU, `gpu-session-x10`: **3/10 FAIL** (đúng 3 lần chạy đầu), lỗi `#rail-list .ri` không thấy sau 20 s; 7 lần sau PASS. Đo trực tiếp (`warm-gpu-a/b`): lần load đầu của trình duyệt mới mất **35,1 s và 30,9 s** đến hàng rail đầu tiên, các lần sau 6,6–13,8 s. Ca panels dùng 60 s cho bước tương đương nên không dính. Khi chạy sau panels (trình duyệt đã ấm) thì PASS: `gpu-orig-x5` 10/10.

Chưa áp dụng bản sửa nào vì mọi cách (nâng 20 s lên 60 s, đổi `.first()` thành selector theo `data-sess`) đều là đổi test, nằm ngoài những gì người dùng cho phép khi chưa được duyệt.

## 4. Kết quả kiểm thử thực tế

Mỗi dòng là một lượt riêng, không gộp điều kiện.

| Lượt | Thư mục | Kết quả |
|---|---|---|
| ESLint (`node …eslint.js .`) | `quality2` | exit 0 |
| `tsc --noEmit` | `quality2` | exit 0 |
| Unit `tests/unit/*.test.mjs` | `quality2` | **51/51 PASS**, fail/cancel/skip/todo = 0. (`node --test` trần báo 73 vì quét cả bản export HEAD trong `test-results-win-head`; đã giải thích, không phải test mới) |
| Production build `.next-win-g2` | `win-build` | exit 0, 9/9 trang tĩnh; Next tự sửa `tsconfig.json`, đã hoàn nguyên đúng baseline (hash `E05C45CD…`) |
| Hai test gốc, **mặc định**, trace off | `repro1` | **0/2**, cả hai timeout 90 s, exit 1 |
| Hai test gốc, **HEAD sạch**, mặc định | `head-orig` | **0/2** timeout, exit 1 |
| Hai test gốc, GPU (`--use-angle=d3d11`), lặp 5 lần | `gpu-orig-x5` | **10/10 PASS** |
| Session drawer, GPU, lặp 10 lần (có `DEBUG=pw:api`) | `gpu-session-x10` | **7 PASS / 3 FAIL** (cold start, mục 3) |
| `agents.spec.ts`, GPU, lần đầu | `final-gpu-agents` | 5 PASS / 1 FAIL do **lỗi harness của tôi** (HOME runner khác `HOME_DIR`, test kiểm `agents.spec.ts:114`); giữ lại |
| `agents.spec.ts`, GPU, sửa harness | `final-gpu-agents2` | 6/6 PASS |
| `chat-preview.spec.ts` + test popup, GPU | `final-gpu-chatpreview` | 3/3 PASS |
| `@smoke`, GPU | `final-gpu-smoke` | 5/5 PASS |
| `agents.spec.ts`, mặc định | `final-def-agents` | 6/6 PASS |
| `chat-preview.spec.ts` + test popup, mặc định | `final-def-chatpreview` | 3/3 PASS |
| `@smoke`, mặc định | `final-def-smoke` | 5/5 PASS |

Điều kiện GPU là wrapper cục bộ chỉ thêm `launchOptions.args=['--use-angle=d3d11']`, `testDir` vẫn `tests/e2e`, test chạy nguyên văn. Wrapper và script chẩn đoán lưu tại [g2-diag-scripts](./g2-diag-scripts/) (đuôi `.txt`).

## 5. Review

- `git diff --check` exit 0; staged diff rỗng (0 file); `git status` giữ 21 mục như đầu phiên; `package.json`, `package-lock.json`, `tsconfig.json` giữ nguyên hash baseline; `playwright.config.ts` và `next.config.mjs` không xuất hiện trong `git status` (không sửa). Mọi thay đổi Phase 02 chưa commit được bảo toàn; HEAD không đổi.
- OMP off ở mọi lượt (`OFFICE_OMP=off`); không đọc session/credential thật; không Phase 03, stage, commit, push.
- Sau khi chạy xong không có listener ở 4399/4406 (chỉ TIME_WAIT) và không còn process `ms-playwright`/server do tôi tạo. Các process Chrome/node đang chạy từ trước thuộc người dùng, tôi không đụng.
- Đã gỡ junction `node_modules` trong `test-results-win-head/src` (chỉ gỡ liên kết); `node_modules` của repo còn nguyên.
- Mọi artifact lỗi/thành công nằm trong các thư mục `test-results-win-*` (gitignored), không ghi đè lịch sử các lượt Linux trước.

## 6. Trạng thái G2 và đề xuất (chưa áp dụng)

**G2: OPEN — chờ quyết định điều kiện nghiệm thu.** Lint, typecheck, unit, build, agent E2E, chat-preview, popup và smoke đều PASS ở cả hai điều kiện render. Hai ca Claude: panels PASS khi có GPU, FAIL ở SwiftShader mặc định (cả HEAD sạch); session drawer PASS khi trình duyệt đã ấm nhưng FAIL 3/10 khi là trang đầu tiên. Không tự đánh dấu PASS.

Đề xuất để người dùng chọn:

1. **Điều kiện nghiệm thu = trình duyệt có GPU.** Thêm vào `playwright.config.ts` (`use.launchOptions.args: ['--use-angle=d3d11']` có điều kiện `process.platform === 'win32'`, hoặc `channel: 'chromium'`). Linux/CI vẫn dùng SwiftShader nên hai test tiếp tục đỏ ở đó.
2. **Ca session drawer:** đổi budget hàng rail đầu từ 20 s lên mức như panels (60 s) và/hoặc chọn hàng bằng `data-sess` thay cho `.first()`. Cần người dùng đồng ý vì là sửa test.
3. **Sửa gốc cho người dùng không có GPU (ngoài scope đã duyệt):** `src/office/core/loop.js::frameGap`/`loop` và `src/office/scene/renderer.js` (nhánh `SOFTWARE_GL`): đo thời gian vẽ thực của frame cuối và giãn `gap` theo (ví dụ ≥4× chi phí frame) để chừa thời gian cho input, và/hoặc giảm số tam giác khi `SOFTWARE_GL`. Chưa kiểm chứng patch này; cần mở scope và dựng build thử.

## Câu hỏi chưa giải quyết

- Có chấp nhận trình duyệt có GPU (và áp dụng đổi config ở mục 6.1) làm điều kiện nghiệm thu G2 không, hay yêu cầu hai test phải qua cả với SwiftShader (kéo theo mục 6.3)?
- Có cho sửa ca session drawer (budget hàng rail đầu và/hoặc selector ổn định) không?
- Giữ hay xóa `%LOCALAPPDATA%\next-swc` và các thư mục `test-results-win-*`/`.next-win-g2`/`.next-head`?
- Chưa có `npm ci` sạch trên Windows (cần shim `.cmd` và binding win32); có cho cài lại `node_modules` native không?
