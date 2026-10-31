# Phase 02 — Production build, HTTP và browser validation

## Trạng thái hiện tại — RAIL-01 repair, 31/10/2026

RAIL-01 đã được sửa theo approval mở rộng `activity.js`. Lint/typecheck/rebuild PASS; unit 48/48 PASS; agents E2E 6/6 PASS, gồm original rail assertion. Selected Claude regression tại 1440×900: 3/4 PASS ở 180s/trace-on, 2/4 PASS ở mặc định 90s/trace-off (panels/drawer timeout, ghi nhận popup chặn click); **không đánh dấu G2 đạt toàn bộ**. Kết quả diagnostic và trạng thái cuối cùng xem [repair report](./phase-02-rail01-fix.md). Giữ OMP off; không Phase 03, commit hoặc push.

## Hồ sơ lịch sử trước lượt sửa RAIL-01

Các kết luận blocked, NOT RUN hoặc số lượng tests bên dưới thuộc những lượt trước. Không ghi đè lịch sử failures bằng kết quả mới.

Ngày: 31/10/2026, Asia/Ho_Chi_Minh. Repository `/mnt/e/vide-code/my-office`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`. Workflow: portable `ak-test` 1.2.1, các principles/execution/UI references đã đọc; thực thi và review tuần tự qua Cloud Harness Local.

**Kết luận cuối: BUILD/LINT/TYPECHECK PASS, UNIT 45/45 PASS, HTTP 2/2 PASS; agent browser run 4/5 PASS và List Mode độc lập PASS, còn RAIL-01 nên G2 KHÔNG PASS.** Hai existing regression cases timeout ở budget 90s đã PASS khi diagnostic rerun giữ assertions với budget 180s; không xóa kết quả timeout cũ. Tất cả managed tasks của lượt này đã terminal, không còn server/browser kiểm thử chạy nền. OMP production vẫn effective off. Đây là kiểm chứng Phase 02, không phải triển khai file observer/realtime hoặc mở G1 live.

## 1. Phạm vi và môi trường

Người dùng yêu cầu “Bạn tự chạy đi tiếp đi” sau báo cáo còn thiếu build/E2E. Tiếp tục build và kiểm thử synthetic cô lập, bổ sung test cần thiết trong `tests/e2e/agents.spec.ts`. Không sửa application source thêm. Điều kiện riêng của Phase 02 về file ngoài ownership table vẫn được giữ: `src/office/ui/activity.js` cần mở scope trước khi sửa.

Node `v24.22.1`, npm `11.19.1`, Next.js `16.4.3`, Playwright `1.56.1`, Linux/WSL2, checkout trên Windows mount `/mnt/e`. Không nâng version package hoặc sửa lockfile.

- Build riêng: `.next-e2e-g2`; `.next` thông thường không được tạo/thay.
- Test runner/server: `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` trỏ vào từng `test-results-g2-*`; `OFFICE_DATA_DIR` do existing Playwright config cấp dưới cùng test root.
- Chỉ loopback `127.0.0.1:4399`; `reuseExistingServer=false`, một worker, không retry che lỗi. Server được Playwright tạo/dừng theo từng run. Sau các browser runs, `ss -ltnp` không còn listener ở 4399/4406 và không còn process `headless_shell`.
- `OFFICE_OMP=off`, `OFFICE_USAGE=0`, `OFFICE_CI=0`, `OFFICE_TRANSLATE=0`, `NEXT_TELEMETRY_DISABLED=1`. Đây là các application switches, không phải firewall/network sandbox cấp hệ điều hành.
- Không đọc OMP roots/transcripts thật, không gọi model, không chạy Claude/OMP agent thật. Native process management không được dùng làm positive test.

Đã khôi phục symlink `node_modules/.bin/next` theo `next/package.json` sau lần cài dở trước, không sửa package source. Build tự thêm paths của `.next-e2e-g2` vào `tsconfig.json`; đã đối chiếu diff rồi hoàn nguyên đúng phần generated này về nội dung baseline, không dùng Git reset.

## 2. Browser prerequisite, không thay host packages

Lượt E2E đầu: test crafted OMP IDs PASS, existing smoke test FAILED trước assertions vì Chromium executable chưa có. Existing smoke `beforeEach` dùng `page`, nên ngay cả test có `request` cũng cần browser. Không xem đây là lỗi ứng dụng.

Tải đúng Chromium Headless Shell revision `1194` và ffmpeg `1011` bằng CLI Playwright đã khóa trong dependencies, với `PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright-g2`, `install chromium --only-shell`. Không cài browser toàn máy.

Host thiếu NSPR/NSS/ALSA. Không chạy sudo, `apt install`, `install-deps`, thay quyền hoặc sửa hệ thống. Chỉ `apt-get download` bốn archives đã pin theo APT metadata có sẵn, đối chiếu SHA-256 rồi `dpkg-deb --extract` vào `node_modules/.cache/ms-playwright-g2/host-libs/root`; không chạy maintainer scripts. `LD_LIBRARY_PATH` chỉ được đặt cho subprocess kiểm thử.

| Archive | Version | SHA-256 |
|---|---|---|
| libnspr4 | 2:4.35-1.1build1 | e579e72d091f6c7a13f5a756c31065b15aae5b81840d61b069355aa2283c07b4 |
| libnss3 | 2:3.98-1ubuntu0.3 | e11fdf8c09a068d0f0c3fd90ed971253dfed7227cc20d3d487fd615d4771f1bb |
| libasound2t64 | 1.2.11-1ubuntu0.3 | 5d17bfb5683eb99f1be951fe48e1be5bf3c52391913b6b74a8aecf9b4f5e779f |
| libasound2-data | 1.2.11-1ubuntu0.3 | 0c26896193480d9dbb055e85e8ddfb9c9f34cf19afee340987cd6311e2886fc1 |

`ldd` sau private extraction không còn missing libraries; launch một headless browser với data URL nội bộ PASS. APT/dpkg host vẫn không cài các packages này. Browser dùng profile temporary riêng, không profile/cookies cá nhân.

## 3. Kết quả thực thi

| Check / phạm vi | Kết quả thực tế |
|---|---|
| Production `npm run build`, `OFFICE_DIST_DIR=.next-e2e-g2` | PASS, exit 0; Turbopack compiled, TypeScript và 9/9 static pages hoàn tất |
| HTTP run đầu gồm crafted-ID và existing hook smoke | 1 PASS, 1 FAILED vì browser thiếu; đã chẩn đoán prerequisite, không bỏ assertion |
| Hai agent HTTP tests, gồm lifecycle mới | 2/2 PASS, exit 0, 21.1s theo Playwright |
| `agents.spec.ts` với Chromium, phiên bản 5 cases | 4 PASS / 1 FAILED, exit 1, 2.6m theo Playwright; lỗi RAIL-01 bên dưới |
| Existing smoke/regression chọn theo risk: cozy startup, panels, hook health, session drawer | 2 PASS / 2 FAILED do tổng timeout 90s (panels, session drawer), 4.3m; retained trace, không bỏ lỗi |
| Rerun riêng panels + session drawer với `--timeout=180000` | 2/2 PASS, exit 0, 6.0m; giữ nguyên mọi assertions và 30s expect timeout, không sửa test source; default 90s vẫn từng fail |
| List Mode independent regression mới | 1/1 PASS, exit 0, 56.2s; unknown row visible, mở drawer, read-only và nullable context/cost đúng |
| Lint/typecheck/unit ở source test cuối cùng | PASS: `npm run lint`, `npm run typecheck`, `npm test` đều exit 0; 45/45 unit PASS, không skipped/todo; `git diff --check` PASS |

Các thời lượng là runner output, không phải benchmark CPU/RAM/GPU hoặc bằng chứng cải thiện hiệu năng.

Source-set fingerprint sau khi bổ sung hai E2E cases: `fe2e7bbe549868bb1c62cb291275181784d51b299b92432f22c55e2daf8ccf55` cho 16 application/test files. Cách tính giống implementation report: sort path, ghép `path + NUL + sha256(bytes) + LF`, hash toàn chuỗi. Không có application source change giữa build và các runtime checks. `ak plan validate` PASS; 14 Markdown documents UTF-8/LF và 54 relative file links đã kiểm tra hợp lệ.

Hai existing regression cases lần đầu hết tổng budget 90s. Trích timing từ retained trace cho thấy các thao tác navigation/click trước đó đã thành công nhưng chậm: panels có navigation khoảng 23s, các click khoảng 12.8/11.2/20.2s; session-drawer cũng cộng nhiều thao tác 10–19s trước khi test bị đóng. Đây là cơ sở cho **một diagnostic rerun** với tổng budget 180s qua CLI; không sửa source test, không thay timeout 30s của assertion, không skip và không xóa kết quả fail cũ. Không tự kết luận nguyên nhân chắc chắn là GPU hoặc mọi performance regression đều đã loại trừ. Diagnostic rerun cuối cùng **2/2 PASS** với budget 180s, tổng 6.0m; do đó các assertions chức năng đã được chứng minh, nhưng không được báo default 90s suite là pass hoặc suy ra performance đạt. Giữ nguyên traces của lượt timeout.

### HTTP coverage đã pass

Ca mới dùng một transcript tự sinh bên trong `HOME_DIR` test và server thật từ production build. Kiểm tra OFF diagnostics, snapshot owner/capabilities, giữ log roles `user`/`claude`, SessionStart, prompt -> work, PermissionRequest -> wait, tool completion -> work/counter, SubagentStart/SubagentStop, Stop -> rest/lastReply và SessionEnd -> removal. Mỗi chuyển trạng thái được poll, không chỉ kiểm tra HTTP ACK.

Cả OMP public ID và explicit provider `omp` đi kèm valid Claude ID đều bị `/api/open`, `/api/accounts/move`, `/api/tasks` từ chối `403 agentReadOnly`. Không thực hiện positive kill/account-move/task execution trên process thật.

### Browser coverage đã pass ở 5-case run

Explicit unsupported provider không nhận controls dù capabilities giả; legacy Claude snapshot thiếu fields mới vẫn giữ `/rc`; hai HTTP cases pass trong cùng E2E run. Trong ca OMP thất bại, drawer read-only, zero action buttons/links, conversation disabled và context/cost dấu gạch đã qua trước assertion rail thất bại. Các assertions phía sau assertion lỗi chưa chạy trong lượt đó; không được tính là pass.

## 4. RAIL-01 — lỗi còn mở, chặn G2

**Severity: P1 trước khi phát OMP live lên UI.** Session OMP metadata-only được projection thành `status: 'unknown'`, có trong frontend session Map và mở được drawer, nhưng không xuất hiện trong rail.

Bằng chứng runtime: `expect(page.locator('.av-logo[data-agent="omp"]').first()).toBeVisible()` hết 30 giây vì không có element trong DOM. Page snapshot hiển thị 7 sessions, scene/drawer có `OMP 95cb4a3e`, nhưng rail chỉ có sáu Claude rows.

Root cause đọc trực tiếp từ `src/office/ui/activity.js`:

- Line 127: `GROUPS = [['wait'], ['work'], ['rest']]`.
- `renderRail()` line 215 chỉ append row khi `s.status === k` cho những groups đó. Unknown row được tạo trong Map nhưng không attach vào DOM.
- `doingOf()` cũng có fallback "working" cho status ngoài tập cũ; cần xử lý neutral unknown khi mở rộng rail, không đổi status unknown thành rest/work chỉ để test pass.

File này **không nằm trong bảng source được phép sửa của Phase 02**; phase file line 47 yêu cầu mở scope trước. Lượt này chỉ ghi evidence và đề xuất sửa, không tự sửa `activity.js`, không skip test, không xóa assertion, không gán status giả cho fixture.

Bản sửa nhỏ cần mở scope: `activity.js::GROUPS/renderRail/setup/doingOf/metaTime`; bổ sung unknown group, giữ row khi unknown/unsupported, dùng nhãn `drawer.unknownState` đã có và không invent work duration. Giữ nguyên grouping/control behavior Claude. Sau sửa phải rebuild và chạy lại original failing case + toàn bộ agent E2E, selected Claude regression và unit/lint/typecheck.

Artifacts tại thời điểm lỗi (repo-relative, không public URL):

- `test-results-g2-browser/agents-synthetic-OMP-stays-6ad8c-not-rendered-as-zero-or-NaN/error-context.md`
- `test-results-g2-browser/agents-synthetic-OMP-stays-6ad8c-not-rendered-as-zero-or-NaN/trace.zip`

Không rerun ghi đè thư mục lỗi; các run tiếp theo dùng output root riêng.

## 5. Bảo toàn baseline và giới hạn còn lại

HEAD, package manifests/lockfile, `.gitattributes`, application source set và restored `tsconfig.json` giữ nguyên so với đầu lượt kiểm chứng. Chỉ `tests/e2e/agents.spec.ts` và documentation được sửa thêm; browser/libraries/build/fixtures ở ignored directories.

Git index binary SHA-256 đổi từ `210a107b45eee6f77fb5aeaef937159171af262a064af0335486a3336dc8e9cd` sang `a2cddc1a6603a40706dfb886845add80283c645c035a057300e764002d29433f`. Không báo index byte-for-byte unchanged: `git diff --cached --quiet` PASS và đối chiếu **350 entries gồm file mode + object ID + stage 0** bằng `git ls-files --stage` với `git ls-tree -r HEAD` đều giống. Điều này phù hợp stat-cache refresh khi build rồi restore `tsconfig.json`; không có staged content change. Các Git reads cuối dùng `GIT_OPTIONAL_LOCKS=0`.

Lỗi clean `npm ci` ở lượt trước vẫn là hạn chế tái lập môi trường, chưa có clean-install PASS; build và selected runtime tests không chứng minh mọi platform/native package đều đầy đủ. Không benchmark, không chứng nhận cross-OS hoặc full E2E suite. Không commit/push/merge/PR, không sửa remote/security/network config, không chuyển Phase 03.

Các task handles phục vụ truy vết trong Cloud Harness:

- Build: `task_UdlEE_E-Q9bYZmIqW4FiZwAdDpwglg20`.
- HTTP prerequisite run: `task_-30kDO43I1bRz46LABcuyWbknP1cF3RA`.
- HTTP lifecycle pass: `task_t-H_WMfskeUVmloudDRXfHNqusHCLCce`.
- Private browser download: `task_z8e9v1jDAHdyIgSX67FXyzEdOfzhwPh0`.
- Agent browser run (4/5): `task_-resC9sikThFzugwSADcipWlXZE9o2vY`.
- Selected regression: `task_aGIoQxiadkav_QKzBUrhatZqORS-FpRP`.
- Independent List Mode: `task_eq5ipF22Tf-N3XYvUWsou5DYR27KVWsy` (PASS); queued predecessor `task_5TcS0IFOmIcECf46SrpeqlS9zz_lTePS` đã cancel trước khi chạy do phụ thuộc regression timeout.
- Hai timeout cases rerun với budget 180s: `task_bA2H7qFRnjEWYUhBa_13uWNRagIcsPtB`.
- Final lint/typecheck/unit: `task_0rbWc0Uw3mkOgqTs3gHq7MtuT4lK1OB3`.
