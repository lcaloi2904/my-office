# Nghiệm thu G3 — PASS (native launcher + exact Resume độc quyền; Phase 04 vẫn đóng)

Ngày kiểm chứng: 2026-11-01. Phạm vi: hoàn tất prerequisite native OMP sau khi chủ dự án duyệt mở phạm vi sửa native OMP cô lập, tích hợp exact Resume độc quyền vào My Office và chạy lại bộ kiểm chứng G3. Không bật Phase 04, không thay thế binary cài đặt `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe`, không đọc credentials/session thật và không rollout.

## Kết luận theo tiêu chí

| Tiêu chí Phase03 | Kết quả đã quan sát |
|---|---|
| New chỉ sau click, đúng project/profile | PASS trên fixture native Windows: alias do server cấp, không child trước click, đúng source opaque ID, context mới rỗng/idle, đúng model loopback. Không dùng OAuth/profile thật. |
| Resume đúng history và không concurrent writer | **PASS** với bản native riêng `omp-office-g3.exe` (`resumeProtocol: 1`, `ownerDir` nguồn đã duyệt). Child native lấy cả khóa miền gốc `tryAcquireFileLock(path.join(ownerDir, sessionId))` lẫn khóa đường dẫn canonical trước khi nạp history, giữ descriptor chỉ-đọc `O_RDONLY | O_NOFOLLOW`, đối chiếu `sessionId`/schema v3/SHA-256, phát `ready.officeOwnershipProtocol=1` và `get_state.officeOwnership` rồi mới được `control-manager.mjs` nhận làm managed owner. File candidate có sẵn user + assistant giữ nguyên từng byte, `size`/`mtime`/`ctime` và danh sách file sau khi đóng child. Stock binary hoặc cấu hình thiếu `resumeProtocol: 1` từ chối `LAUNCH_OWNER_UNVERIFIED` fail-closed. |
| Invalid path/profile/bin/PID/identity/conflict từ chối an toàn | PASS: unit junction/ancestor/hardlink/root replacement, malformed ACK/state, invalid PID, catalog/observed-owner collision, stock ready frame/thiếu hoặc lệch `officeOwnership`, post-proof source mutation; HTTP Origin/Host/content-type/payload/streamed oversize từ chối trước spawn. |
| Ownership/lifecycle/single actor | PASS trong phạm vi đã chạy: concurrent admission/dispose/generation unit; New và Resume cùng hiển thị đúng 2 thẻ/nhân vật tương ứng mà không nhân đôi actor cho cùng session; đóng drawer/browser không đóng child; production shutdown phát EOF, stdout EOF, child exit0/signal=null; server mới có 0 managed sessions và 0 native children trước click; idle parent-crash child-exit đã kiểm. Busy crash/shutdown thuộc phạm vi có turn ở Phase 04+. |
| Flags OFF không phá Claude/observer | PASS: files, visibility, hybrid, agents/replay/ownership, Claude smoke và toàn bộ unit. Không suy thành full Claude E2E hoặc cross-OS certification. |

## Bằng chứng phiên bản và môi trường

- Windows native, Node24.22.1, Chromium qua Playwright1.56.1 với ANGLE/D3D11; Next16.4.3.
- G1 cũ kiểm OMP18.14.2. Trong lượt này binary cài đặt đã trả `omp/18.15.0`; không tái sử dụng claim runtime của bản cũ cho bản mới.
- Native fixture sao chép executable được chỉ định tường minh, đối chiếu SHA256 giữa bản gốc/bản sao rồi pin `OFFICE_OMP_TEST_VERSION=omp/18.15.0`.
- SHA256 binary kiểm chứng: `978846a816cb77f44a55e32b16493375ca837fbf87e0aec35a9c1c934bff0cd0`.
- Native E2E chỉ gửi `new_session` và `get_state`; **0 turn events, 0 model HTTP requests**. Provider duy nhất là HTTP503 loopback không inference. HOME/project/profile/session-dir/models/data đều task-owned, không đọc `.env`, private token/session/extension hay credentials thật.
- Child trong native E2E nhận stdin EOF, stdout EOF, exit0, signal=null. Không taskkill/SIGTERM cưỡng bức, không đóng process ngoài fixture.

## Lệnh và kết quả cuối

| Kiểm tra | Kết quả |
|---|---|
| `node --test --test-concurrency=1 tests/unit/agent-compat.test.mjs tests/unit/omp-rpc-host.test.mjs tests/unit/omp-launch-resolver.test.mjs tests/unit/omp-adapter.test.mjs tests/unit/agent-schema.test.mjs` | **146/146 PASS**, 0 SKIP |
| `node --test --test-concurrency=1 tests/unit/*.test.mjs` | **439 tổng: 436 PASS, 3 SKIP, 0 FAIL**; 3 SKIP có sẵn thuộc rewrite-model/inbox socket, không tính PASS |
| `node node_modules/eslint/bin/eslint.js .` | PASS; lượt cuối sau sửa test/fixture và khôi phục compiler config |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS; lượt cuối cùng cấu hình chuẩn |
| `node node_modules/next/dist/bin/next build` | PASS với `OFFICE_DIST_DIR=.next-g3-accept-20261101`, không thay `.next` production |
| `node node_modules/@playwright/test/cli.js test --config=playwright.launch.config.ts` | **1/1 PASS**, retries0, timeout90s; native ON thật, VI/mobile390×844, EOF lifecycle/no-turn |
| `node node_modules/@playwright/test/cli.js test --config=playwright.omp.config.ts` | **8/8 PASS**, retries0, workers1; files/visibility/launcher OFF |
| `node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts --workers=1` | **13/13 PASS** |
| `node node_modules/@playwright/test/cli.js test --config=playwright.hybrid.config.ts` | **1/1 PASS** |
| `node node_modules/@playwright/test/cli.js test tests/e2e/office.spec.ts --grep @smoke --workers=1` | **5/5 PASS** |

Native ON dùng explicit `OFFICE_OMP_TEST_BIN`, `OFFICE_OMP_TEST_VERSION=omp/18.15.0`, port4518. Các regression còn lại dùng port4517, HOME/Claude config/data riêng cho từng suite. Không dùng source injection production hoặc mock public launch/status để chứng minh native path. Tiền tố output của lượt này là `test-results-g3-accept-20261101`; fixtures/logs/build tạm phải được dọn, không coi đường dẫn đã xóa là artefact còn giữ.

## Lỗi và thay đổi cause-aligned

1. `agent-compat.test.mjs`: VM harness bỏ imports nên `appendOmpLaunchActions` không tồn tại. Harness nay nạp module launcher thật với cùng dependencies. Kỳ vọng danh sách env reads tuyệt đối được thay bằng invariant không đọc config/profile/token/root khi OMP off; không đổi business contract.
2. `omp-rpc-host.test.mjs`: test request timeout dùng200ms cả startup nên lỗi `RPC_START_TIMEOUT` trước nhánh cần kiểm. Deadline tests nay dùng controlled child/clock, kiểm ngay trước/sau deadline và không còn dispatch sau timeout. Native child thật vẫn được kiểm riêng.
3. `control-manager.mjs`: thiếu bound số child. `MAX_MANAGED=8` tính owner cộng reservation ngay trước await, không cho nhiều alias vượt trần qua concurrent startup; slot giải phóng khi lỗi/exit. Không thêm API/config quyền mới.
4. `server/index.mjs::readJson`: streamed body có prefix JSON hợp lệ và suffix quá cỡ có thể bị parse prefix. End-of-stream nay từ chối toàn body khi tổng size vượt max; regression boundary đúng limit/limit+1 và HTTP native kiểm trước spawn.
5. E2E mới bỏ mock status/launch. OFF assert về số node được thay bằng khả năng nhìn/thao tác thực tế: launcher tạo node ẩn khi flag OFF, không phải control nhìn thấy. Không xóa kiểm tra HTTP denied.

## Các lần thất bại trung gian — không che thành PASS

- Static type check phát hiện union headers chứa optional undefined; sửa annotation `Record<string,string>[]`, kiểm lại PASS.
- Native setup truyền distDir tuyệt đối vào Next/Windows join nên báo thiếu build dù BUILD_ID có thật; runner chuyển sang đường dẫn tương đối đúng convention server.
- Native test ban đầu gặp `LAUNCH_BINARY_CHANGED`: ctime binary cài đặt thay đổi, sau đó version probe xác nhận bản18.15.0 thay cho baseline18.14.2. Không bỏ/chỉnh chốt identity; fixture pin bản sao/checksum và version explicit.
- Một lần runner nhận nhầm ready từ server diagnostic cũ; đã sửa chờ IPC `fixture-ready` của đúng child trước HTTP readiness. Exit hook fixture được đặt sau import server để tránh OTEL tạo lại directory sau cleanup.
- OFF E2E ban đầu **7 PASS/1 FAIL** do test đếm node ẩn; sau sửa assertion consumer-visible, cùng suite đạt **8/8**.
- Có cảnh báo `metadataBase` của Next trong regression, không phải failure.

## Smoke UI trực tiếp và giới hạn chưa giải quyết

Dùng `browser.open` trên server synthetic mới, tiếng Việt, List Mode. Sau điều chỉnh viewport390×844: documentWidth390, dialog x17..373 (356px), scrollWidth/clientWidth354; screenshot đã xem, labels/select/buttons không tràn.

Khi để server mở trước khi bấm New, guard lại trả `LAUNCH_BINARY_CHANGED`, kể cả với bản sao task-owned. **Chưa xác định tác nhân đổi metadata**; không kết luận do antivirus/updater. UI hiển thị lỗi, status không có owner, không spawn child, 0 model requests; server được shutdown an toàn. Vì vậy chỉ E2E ON nhanh được ghi PASS; không ghi manual New thành công hoặc chứng nhận launcher ổn định dài hạn. Không nới so sánh ctime để che lỗi. Cần điều tra metadata/chính sách pin executable trước rollout.

Abrupt server crash, busy child EOF, actual two-writer/first-write, model-unavailable runtime, cross-OS và production profile chưa được kiểm. No-turn/idle evidence không chứng minh các nhánh đó.

## Dọn tài nguyên và trạng thái bàn giao

Đã kiểm cổng4517/4518 không còn listener; native child EOF/exit được xác nhận trước khi dọn. Đã đóng tab/browser do task tạo, xóa screenshot `%TEMP%` của task, hai roots `test-results-g3-*` và build `.next-g3-accept-20261101`. Không còn fixture `test-results/omp-g3-unit-*`; hybrid teardown đã xóa token synthetic riêng. `tsconfig.json` và `next-env.d.ts` trả về nội dung trước build; lint/typecheck chạy lại sau dọn đều exit0. Không xóa dữ liệu, build hoặc artefact có sẵn của người dùng. Báo cáo này là bằng chứng bàn giao giữ lại, không giữ log/trace hay dữ liệu thử dùng một lần.


## Handoff trước Phase04

- Giữ `OFFICE_OMP_LAUNCH` OFF production; Resume disabled và `canPrompt=false`.
- Cần quyết định/cơ chế exclusion/reservation thực sự tương thích external TUI, kiểm chứng exact selected history qua race/first-write mà không fork/fallback. Reservation My Office đơn thuần không đủ.
- Binary metadata drift đã được xử lý bằng byte pin + conditional rehash; giữ strict identity và kiểm thay bytes, không bỏ guard.
- Không prompt/steer/follow-up/active abort/approvals, không cài controller/observer, không account login/rotation, không paid model và không commit/push trong lượt này.

## Điều tra hoàn tất và prerequisite native

### Binary metadata drift — đã sửa

Probe cùng một executable synthetic trước/sau `--version` trên OMP18.15.0 cho thấy Windows bổ sung extended attribute `$KERNEL.PURGE.CSE.CFA`. `ctimeMs` đổi từ `1793545954375.879` sang `1793546090363.5857`; dev/ino/size/mtime/birthtime/nlink/realpath và SHA256 giữ nguyên. Hai control copies idle/read-only không đổi stat trong64 giây. Không quy tác nhân antivirus/updater cụ thể.

`launch-resolver.mjs` nay pin SHA256 tại startup qua contained file handle. Dev/ino/size/mtime/birthtime/single-link vẫn phải khớp; chỉ ctime-only drift mới được rehash. Bytes phải khớp startup pin và handle/path/root phải ổn định cả trước/sau đọc rồi mới cache stamp. Stamp không đổi không hash lại mỗi launch. Executable replacement hoặc rewrite cùng size/restored mtime vẫn bị từ chối.

Kiểm chứng mới đã chạy:

| Kiểm tra | Kết quả |
|---|---|
| `node --test --test-concurrency=1 tests/unit/omp-launch-resolver.test.mjs tests/unit/omp-rpc-host.test.mjs` | **97/97 PASS**,0SKIP; gồm ctime-only, rewritten bytes, strict identity và mid-hash/path/root replacement |
| Native delayed smoke, resolver pin trước `--version`, one-shot boundary8s | **PASS**: ctime thực đổi, identity ổn định, hai lần New thành công/ID khác nhau, hai owner/actor, hai child đóng sạch,0model requests |
| Native parent-crash smoke | **PASS**: process cha thoát đột ngột code79; watcher giữ handle của đúng child đã spawn xác nhận child thoát trong deadline15s;0model requests/messageCount0 |
| Isolated production build `.next-g3-complete-20261101` | **PASS** |
| Native ON E2E cùng build và binary/checksum/version đã pin | **1/1 PASS**,0turn,0model requests,EOF/stdoutEOF/exit0/signal=null |
| Regression `agent-*`, `omp-*`, timeline/i18n sau sửa binary | Lượt đầu335 trường hợp:332PASS/3FAIL; lỗi thuộc parent test và hai subcases fault-injection inode, không phải native byte guard |
| Fault-injection đã sửa và kiểm lại | Windows inode có thể vượt2^53 (`13229323905463072 + 1` vẫn cùng Number); thay mutation no-op `ino+1` bằng `ino+4096`. File resolver/RPC kiểm lại **97/97PASS**; các paths hồi quy khác ở lượt trên không lỗi, không tính lượt335 là full-green |
| ESLint / TypeScript sau khôi phục cấu hình build | **PASS**,exit0 |

Các scripts/binary copies diagnostic là throwaway task-owned, không phải dependency mới và phải được dọn sau khi ghi nhận bằng chứng.

Đã dọn bốn roots task-owned `test-results-g3-complete-{binary,crash,native,e2e}` và `.next-g3-complete-20261101`; cổng4517/4518 không còn listener trước cleanup. Diagnostic binary/control fixtures không còn giữ; compiler config trở về baseline. Không commit/push hoặc thay binary OMP đang dùng.

### Resume — thiếu primitive trong native OMP, không thể bù bằng My Office-only lock

Source tag18.15.0 xác nhận:

- [`rpc-mode.ts`](https://github.com/can1357/oh-my-pi/blob/v18.15.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2657-L2662): `get_session_lease` chỉ gọi `probeSessionLeases`; không atomic acquire/adopt.
- [`session-manager.ts`](https://github.com/can1357/oh-my-pi/blob/v18.15.0/packages/coding-agent/src/session/session-manager.ts#L1118-L1148): private claim chỉ ở write paths; khi owner khác giữ, write path có thể chuyển sang sibling/new ID.
- [`session-manager.ts`](https://github.com/can1357/oh-my-pi/blob/v18.15.0/packages/coding-agent/src/session/session-manager.ts#L2371-L2380): mở/switch giải phóng claim trước đó, không nhận quyền sở hữu lúc open. [`open`](https://github.com/can1357/oh-my-pi/blob/v18.15.0/packages/coding-agent/src/session/session-manager.ts#L4374-L4412) không có exclusive option.
- [`session-storage.ts`](https://github.com/can1357/oh-my-pi/blob/v18.15.0/packages/coding-agent/src/session/session-storage.ts#L1350-L1375): lỗi acquire có thể trả no-op release; không thể coi callback hiện hữu là strict ownership receipt.

Prerequisite tối thiểu là **native child eager-acquire/adopt** lease đúng domain trước load/recovery, bind exact canonical file/header ID, contention/error hard-fail, giữ claim xuyên idle/teardown và không sibling/latest/continuation fallback. Nếu cần loại cả legacy TUI chỉ mở/chưa ghi, chúng cũng phải tham gia open-time protocol; không suy writer exclusion thành single-runtime proof.

Đã loại hai shortcut: lock riêng My Office không ngăn legacy TUI; Windows read-share handle chặn write của cả external lẫn owned child, không phải transferable lease cho native OMP hoặc nền tảng tương tác Phase04. Không thêm PowerShell broker, không sửa OMP binary/repo hoặc nạp controller ngoài ngoại lệ hiện hành.

Do vậy cần quyết định mở phạm vi native OMP hoặc chờ primitive upstream trước khi hoàn tất tiêu chí Resume. Giữ Resume fail-closed, G3 OPEN và Phase04 chưa mở; không tự giảm gate thành New-only.

### Hoàn tất native strict ownership & nghiệm thu exact Resume (lượt sau phê duyệt sửa native OMP)

1. **Chuỗi công cụ và bản build native cô lập (`backups/omp-g3-native-20261101/`)**:
   - Giữ nguyên bản cài `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe` của máy.
   - Bản clone gốc `oh-my-pi` tag `v18.15.0` (`3fedf8d53267e32a6d7521ce725fdcc4a36fdc67`) tại `backups/omp-g3-native-20261101/source`.
   - Toolchain cô lập dưới `backups/omp-g3-native-20261101/tools/`: `@oven/bun-windows-x64@1.4.4` (`bun.exe` SHA-256 `cb1d8e6564e655e49d30cead359750a1cbbd12f42651caa4b62244d7bd93c244`) và `@oh-my-pi/pi-natives-win32-x64@18.15.0` (`pi_natives.win32-x64-baseline.node` SHA-256 `b49c7e8e4939bd76001b9036e5985f75302bcdbe9b52f74def8b3f8629dab90c`).
   - Biên dịch hoàn chỉnh bằng `compileCodingAgent` ra `backups/omp-g3-native-20261101/omp-office-g3.exe` (SHA-256 `e753e08f423b9a27d6bed448376b615bd83c24ed9af342730076969907caf0f5`), kèm patch `office-exclusive-resume.patch`, test `office-exclusive-resume.test.ts`, `build-manifest.json`, `dependency-manifests.json` và `SHA256SUMS`.
2. **Cơ chế native strict ownership**:
   - Cờ CLI riêng cho RPC: `--office-resume-id`, `--office-resume-sha256`, `--office-owner-dir` đi kèm `--mode rpc --resume <canonical-path>`.
   - `OfficeSessionOwnership` lấy đồng thời khóa miền gốc `tryAcquireFileLock(path.join(ownerDir, sessionId))` (khớp tuyệt đối cách đặt tên mutex của `FileSessionStorage.claimSession`) và khóa đường dẫn canonical (hạ chữ thường trên Windows), không nuốt lỗi như `claimSession` cũ.
   - `SessionManager.openOfficeExclusive` nhận quyền sở hữu trực tiếp vào `SessionManager` thật trước khi nạp lịch sử; chặn cứng mọi nhánh fallback sang sibling/new session/continuation/fork/branch/move và bỏ qua có chủ đích việc ghi `session_exit` khi đóng ở chế độ `officeReadOnly`.
   - `runRpcMode` ở chế độ `officeReadOnly` phát `ready.officeOwnershipProtocol: 1`, trả `get_state.officeOwnership` khi khóa và snapshot còn nguyên vẹn, và chỉ cho phép `negotiate_protocol`, `get_state`, `get_session_lease`.
   - **Giới hạn trung thực**: một TUI cũ chỉ mở xem file mà chưa từng ghi sẽ không giữ `FileLock` trong `ownerDir` theo thiết kế gốc của OMP; do đó cơ chế này chứng minh **độc quyền writer + khóa canonical file + không có runtime được quan sát**, không tuyên bố phát hiện mọi tiến trình thụ động chỉ đọc.
3. **Kết quả kiểm thử lượt hoàn tất**:
   - Native unit (`bun test packages/coding-agent/test/office-exclusive-resume.test.ts packages/coding-agent/test/main-session-resolution-error.test.ts packages/coding-agent/test/rpc-session-lease.test.ts`): **26 PASS, 1 SKIP, 0 FAIL**.
   - My Office unit (`node --test tests/unit/*.test.mjs`): **471 tổng: 468 PASS, 3 SKIP, 0 FAIL**.
   - `eslint .` và `tsc --noEmit`: **PASS (exit 0)**.
   - Playwright OFF (`playwright.omp.config.ts`, `tests/e2e/omp-launch-resume.spec.ts`): **2/2 PASS**.
   - Playwright Native ON (`playwright.launch.config.ts`, `OFFICE_OMP_TEST_BIN=backups/omp-g3-native-20261101/omp-office-g3.exe`, `OFFICE_OMP_TEST_VERSION=omp/18.15.0`): **1/1 PASS** — kiểm chứng cả New (`messageCount: 0`) lẫn exact Resume (`messageCount: 2` gồm user + assistant, `commands: ['get_state']`, 0 turn, 0 model requests, từ chối Resume trùng `409 LAUNCH_OWNER_CONFLICT`, giữ nguyên byte/size/mtime/ctime sau khi đóng browser và shutdown server).
