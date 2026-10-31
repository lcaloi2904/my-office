# Phase 02 — RAIL-01 repair và kiểm chứng G2

Ngày: 31/10/2026, Asia/Ho_Chi_Minh. Repository `/mnt/e/vide-code/my-office`, branch `main`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`. Workflow: portable `ak-fix` 2.6.0 (quick/diagnosis gates) và `ak-test` 1.2.1 qua Cloud Harness Local; review tuần tự, không native hooks/subagents.

**RAIL-01 FIXED; LINT/TYPECHECK/BUILD PASS; UNIT 48/48 PASS; AGENTS E2E 6/6 PASS. G2 CHƯA ĐÓNG vì selected Claude regression còn timeout.** Lượt 1440×900/budget 180s có 3/4 PASS; lượt trace-off/90s có 2/4 PASS, còn panels và session drawer timeout; panels ghi nhận popup chat chặn click machine drawer. Diagnostic viewport nhỏ bị loại khỏi so sánh desktop vì thay đổi responsive layout. Không dùng những lượt khác điều kiện để xóa failure hoặc đánh dấu G2 PASS.

## 1. Approval và phạm vi

Người dùng phê duyệt rõ mở rộng Phase 02 để sửa `src/office/ui/activity.js`, cùng tests/i18n liên quan, rebuild và chạy lint/typecheck/unit/E2E. Giữ OMP tắt, không Phase 03, không commit/push. Đây không phải approval live roots, conversation cá nhân, extension, network config hoặc benchmark.

Chỉ ba application/test files thay đổi thêm trong lượt sửa này:

| File | Thay đổi |
|---|---|
| `src/office/ui/activity.js` | Thêm nhóm unknown và chuẩn hóa trạng thái chỉ ở lớp hiển thị; neutral label/time; giữ row identity, filter và cleanup; provider guards cho RAM/Remote Control/context/cost |
| `tests/unit/agent-compat.test.mjs` | Ba ca regression mới, gồm actual renderer với DOM double: grouping, transition, filter/search, rest collapse, cleanup và không trộn metrics/provider |
| `tests/e2e/agents.spec.ts` | Giữ original failing assertion, bổ sung kiểm tra row/nhãn/time/context và unsupported-provider glyph/RC guard; vẫn sáu cases |

Không thêm/sửa locale files: dùng lại `drawer.unknownState` hiện có trong English/Vietnamese. Không đổi schema/API, không đổi application source khác hoặc package/lockfile. Các application source changes từ những lượt Phase 02 trước vẫn được bảo toàn.

## 2. Cause, regression và bản sửa

Failure đã quan sát ở [runtime validation](./phase-02-runtime-validation.md): assertion `.av-logo[data-agent="omp"]` visible thất bại vì `GROUPS` chỉ có wait/work/rest, `renderRail` chỉ attach rows thuộc các nhóm đó. OMP projection cố ý trả unknown khi chưa có live evidence; row được tạo nhưng không attach. `doingOf` còn fallback working và `metaTime` tính age cho unknown.

Bản sửa dùng `railGroupOf` để map trạng thái ngoài wait/work/rest thành nhóm unknown, không sửa `s.status`. Unknown group xuất hiện sau ba nhóm cũ; rest fold không ảnh hưởng unknown. Cả chips, row text và timer dùng neutral presentation, không tự suy working/rest/completed hoặc elapsed time. Row vẫn được cập nhật tại chỗ, được tháo khi session bị xóa; search/filter giữ nguyên ý nghĩa cũ.

Do row mới bắt đầu được render, các consumer metrics phải fail closed: tái sử dụng `contextPercent`, `claudeCost`, `canSession` và `agentOf` từ workers. OMP/unsupported provider không nhận RAM của Claude chỉ vì cùng PID, không nhận Remote Control badge từ payload, không tạo context NaN/Infinity và không cộng fabricated usage vào Claude HUD total. Legacy numeric Claude context/cost, RC badge, filter và timer vẫn được kiểm tra.

## 3. Test evidence trước/sau

- Red test trước implementation: focused rail test exit 1, `ReferenceError: railGroupOf is not defined`; browser pre-fix failure giữ nguyên trong report/traces trước đó.
- Helper regression sau patch: pass. Hai failures trong DOM double mới (`hidden` thiếu boolean coercion và chưa có `prepend`) được sửa theo DOM semantics; không hạ assertions, không thay source để chiều test.
- Focused agent unit: 26/26 PASS, gồm ba ca mới; full suite 48/48 PASS. Các 22 unit baseline vẫn không sửa.
- Original E2E assertion visible OMP glyph được giữ nguyên; thêm checks chứ không đổi fixture unknown thành work/rest, không skip/retry để che lỗi.

## 4. Môi trường và commands

Node v24.22.1, npm 11.19.1, Next 16.4.3, Playwright 1.56.1, Linux/WSL2 trên Windows mount. Dùng dependencies/browser/private libraries đã có; không cài thêm package/browser/system libraries trong lượt này.

Build mới riêng `.next-e2e-rail01`; output roots `test-results-rail01-build`, `test-results-rail01-agents`, `test-results-rail01-regression`. Không ghi đè build/traces lỗi ở các lượt trước. `env -i` cấp lại PATH và các biến cần thiết, không kế thừa OMP overrides/credentials. HOME/USERPROFILE/CLAUDE_CONFIG_DIR/XDG cache/config và OFFICE_DATA_DIR của server nằm trong từng test root. Loopback 127.0.0.1:4399, `reuseExistingServer=false`, một worker, retries=0.

`OFFICE_OMP=off`, `OFFICE_USAGE=0`, `OFFICE_CI=0`, `OFFICE_TRANSLATE=0`, `OFFICE_STATIC=0`, `NEXT_TELEMETRY_DISABLED=1`. Đây không phải OS-level network sandbox. Browser dùng `PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright-g2` và `LD_LIBRARY_PATH` tới private host-libs đã kiểm chứng ở lượt trước; không profile cá nhân.

Commands chính (cùng isolated environment nêu trên):

```sh
npm run lint
npm run typecheck
npm test
OFFICE_DIST_DIR=.next-e2e-rail01 npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts --workers=1 --retries=0 --reporter=line --trace=retain-on-failure
node node_modules/@playwright/test/cli.js test tests/e2e/office.spec.ts --grep 'the cozy office starts in demo mode without errors|panels open and close|hooks are accepted only from this machine|a session opens its drawer from the list' --workers=1 --retries=0 --reporter=line --trace=retain-on-failure --timeout=180000
```

Agent suite giữ budget mặc định 90s/test. Bốn existing regression cases dùng tổng budget 180s theo bằng chứng rendering/navigation chậm đã ghi ở runtime report; assertion timeout 30s và test source không đổi. Không báo default-90s legacy suite PASS từ lệnh 180s. Không chạy full game/animation E2E suite hoặc performance benchmark.

Next tự thêm include paths cho build vào `tsconfig.json`. Đã lưu baseline, so sánh JSON chỉ có hai include paths được thêm rồi hoàn nguyên bytes baseline trước E2E; không reset Git hoặc ghi đè concurrent source change.

## 5. Kết quả hiện có

| Gate | Kết quả |
|---|---|
| lint | PASS, exit 0 |
| typecheck | PASS, exit 0 |
| unit | 48/48 PASS, exit 0, không skipped/todo |
| production rebuild | PASS, exit 0, compile/TypeScript/static pages 9/9 |
| agents E2E | 6/6 PASS, exit 0, 3.0m; default 90s/test, retries=0; original rail assertion và tất cả strengthened assertions PASS |
| selected Claude regression | 3/4 PASS, 1 timeout ở `panels open and close` tại `#btn-lite`, budget 180s, exit 1; không coi lượt này PASS |
| diagnostic viewport 1000×640, cùng panel test/assertions/budget | FAIL tại rail-visible prerequisite vì responsive CSS chủ động ẩn rail dưới 1100px; không phải đối chứng desktop hợp lệ |
| selected regression chuẩn 1440×900 / 90s / trace off | 2/4 PASS, 2 timeout (panels và session drawer), exit 1, 3.7m; không sửa source/tests/assertions hoặc tăng timeout |
| final source/baseline/docs checks | PASS: source fingerprint ổn định, final typecheck và syntax PASS, staged diff rỗng; package/lock/config không đổi; plan/link checks đạt |
| G2 | **VERIFICATION BLOCKED** bởi selected Claude UI regression còn timeout; RAIL-01 riêng đã FIXED và browser-verified |

### C1–C7: evidence trong phạm vi Phase 02 synthetic

| ID | Evidence thực tế và giới hạn |
|---|---|
| C1 OFF | Unit kiểm tra env getters/production registration cho unset/off/invalid; HTTP `/api/doctor` xác nhận requested/effective off và snapshots chỉ Claude. Không có OMP driver/config/ingress được khởi tạo. Không coi đây là test live OMP. |
| C2 Claude compatibility | Golden assertions actual `pub`/snapshot/log/control callbacks; HTTP synthetic lifecycle start → prompt → permission wait → tool/counter → subagent start/stop → stop/end; original 22 unit vẫn PASS. Selected browser regression kết quả ở bảng trên; không chứng nhận mọi mode/CLI agent thật. |
| C3 controls | Unit valid Claude dispatch và negative foreign ownership; HTTP crafted OMP IDs và forged `agentKind=omp` kèm valid Claude ID đều bị từ chối trước executor. Không positive kill/account-move/start task trên process thật. |
| C4 identity | Unit deterministic namespace/session IDs, cùng source sid/name/PID không đổi owner hoặc chèn OMP vào Claude store. Child-root mappings thực tế chưa có adapter, thuộc Phase 03 trở đi. |
| C5 quota/cost | Actual quota/accountant unit với OMP thiếu acct và fabricated/inherited cost; actual rail/HUD unit không cộng foreign usage, không lấy RAM theo Claude PID. Không có cost aggregation OMP live. |
| C6 legacy | Old no-fields records và event child ID giữ behavior; timeline unit PASS; browser legacy Claude vẫn có `/rc`, logs giữ user/claude roles. Không migration hay thay replay format cũ; không tuyên bố đã kiểm thử toàn bộ replay history. |
| C7 unknown/privacy/UI | Projection sentinel/nullable tests, actual UI function/rail DOM tests, Chromium original RAIL-01 case cùng strengthened assertions PASS; unknown/unsupported provider hiện đúng và không nhận controls/metrics giả. |

Đây là evidence cho compatibility seam **synthetic-only được phê duyệt**, không nâng synthetic results thành certification OMP runtime, cross-OS hoặc toàn bộ product E2E suite. Bất kỳ kết luận G2 cuối cùng nào cũng giới hạn ở boundary này.

### Điều tra timeout của ca panels — không gộp các điều kiện khác nhau

Lượt selected regression 1440×900, trace `retain-on-failure`, budget 180s có 3 PASS / 1 FAIL. Ca panels hoàn thành các bước settings, machine drawer và timeline rồi hết tổng budget khi click `#btn-lite`. Trace ghi nhiều click trước đó thành công nhưng mất khoảng 20–45s; không ghi nhận pageError trong phần trace đã đọc. Một process headless renderer dùng khoảng 963% CPU ở mẫu process snapshot, bộ nhớ hệ thống vẫn còn nhiều. Đây là dấu hiệu để điều tra môi trường/render/tracing, **không phải benchmark hoặc bằng chứng kết luận duy nhất về nguyên nhân**, và không được tự xóa failure.

Lượt diagnostic đầu không chọn được tests vì grep neo đầu/cuối không khớp full title của Playwright; không phải app test đã chạy. Sau sửa selection, viewport 1000×640 thất bại ở điều kiện rail visible: `src/styles/responsive.css:27–30` chủ động ẩn `.side-left` khi width ≤1100px. Đây là điều kiện responsive khác, nên không dùng lượt đó làm so sánh tải render hoặc nghiệm thu desktop. Không sửa CSS hoặc assertion để ép pass. Local diagnostic config nằm trong ignored `node_modules/.cache/rail01-validation/desktop-compact.config.mjs`, không đổi config repository.

Lượt đối chứng tiếp theo dùng **config repository nguyên bản, viewport 1440×900, timeout mặc định 90s/test, expect timeout 30s, workers=1, retries=0**, chỉ tắt thu trace (`--trace=off`, chế độ mặc định của repository). Source tests và application không đổi. Kết quả terminal: 2 PASS / 2 timeout; panels ở bước đóng machine drawer có popup intercept, session drawer hết tổng budget tại assertion hidden sau click close. Tắt trace không đủ để giải quyết timeout. Không nâng budget, không bỏ assertion hoặc bật retries.

Artifacts giữ riêng: `test-results-rail01-regression/`, `test-results-rail01-panels-compact-b/`, `test-results-rail01-regression-standard/`; không ghi đè pre-fix artifacts.

**G2-PANEL-01 — observed remaining blocker:** ở lượt desktop gốc/90s/trace-off, Playwright ghi rõ `#zc-peek` intercepts pointer events khi click `#dr-mac [data-close]`; timeout vẫn xảy ra khi không thu trace. Source read-only xác nhận `group-chat-view.js::peek()` (khoảng lines 323–331) tạo popup khi chat đóng; `group-chat.css:241` đặt top 64px/right 14px/z-index 41; `drawers.css:3` đặt drawer z-index 4. Đây là evidence về tương tác popup/timing, không đủ để quy mọi timeout cho một nguyên nhân duy nhất hoặc khẳng định patch RAIL-01 gây ra regression. Những source files này không thay đổi trong lượt sửa RAIL-01.

Không forced click, không CSS hide, không tắt notification hoặc xóa assertions để làm regression pass. Không sửa các module popup/styles ngoài scope RAIL-01. Functional fix của rail và trạng thái chưa đạt của regression được báo cáo riêng; G2 đầy đủ phải giữ mở.

## 6. Bảo toàn và giới hạn

Baseline protected hashes đầu lượt: package.json `4f7ebe03f6960b2d75216fe5638edde69d39ca5b8f6a3db727fb5d50659fe247`; package-lock.json `814d7b0a39dc8ba8015f5cc45433a751fc06f1b428c445c0968fef51664e293a`; .gitattributes `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7`; tsconfig.json `e05c45cd8f34061dd3d6b0bbc52ef53e3ffb1996f82d1f7edcb09cf149a53635`; .git/index `a2cddc1a6603a40706dfb886845add80283c645c035a057300e764002d29433f`.

G1 live/version/roots/privacy và Phase 03 vẫn đóng, bất kể kết quả G2 synthetic. Không có clean-install npm ci PASS mới, không chứng nhận cross-OS hoặc runtime OMP. Không claim cải thiện CPU/RAM/GPU; không sửa timeout mặc định của repository.

## 7. Task handles

- Quality + build: `task_-H-4LYx-Ptd4nad7SFQaxtjLqH4loZw3` (PASS).
- Full six-case agent E2E: `task_9rw0R4RP7rLjKBKG8lPYfoc9hXsub8hV` — PASS 6/6.
- Selected Claude regression: `task_qPrzxqpEevMNgwnhBDd-ubLmdUQnVM1A` — FAILED, 3/4 PASS tại 180s/trace-on.
- Diagnostic selection: `task_LZ7qItkQxCdXAwI8rJ5y4e3I6Qer_vBF` — FAILED trước test execution, không tìm thấy tests vì grep neo không phù hợp.
- Diagnostic 1000×640: `task_EJAz4ew-EVP9HDWAm-3g5vPxf1wY5YJu` — FAILED do responsive rail-hidden prerequisite; không dùng làm acceptance.
- Standard viewport/budget, trace off: `task_mDu8AgR1uJBKPg9zz1c4-Or3hFopzpKr` — FAILED, 2/4 PASS tại 90s.

## 8. Final review, preservation và handoff

Final typecheck chạy lại sau E2E và sau hoàn nguyên tsconfig: exit 0. Ba source/test files đã sửa qua `node --check`; full source set không thay đổi sau lint/unit/build/E2E, nên kết quả quality áp dụng đúng revision cuối. Review inline: nguyên nhân rail, non-mutating projection, provider/metrics isolation, unknown timer, stable DOM rows, search/fold/filter và cleanup. Không independent reviewer/subagent; không tuyên bố mọi UI workflow đều đã pass.

Source-set SHA-256 của 17 files: `ffd3168fc903493c1a12210fc1fd6d7ef4b2fca4c9847760ef705f477fdc5af4`. Công thức: sort repo-relative paths; nối `path + NUL + sha256(file bytes) + LF`; SHA-256 của chuỗi đó. So sánh baseline fingerprint trước lượt sửa (thay lại hai test hashes cũ, bỏ activity.js) khớp `fe2e7bbe549868bb1c62cb291275181784d51b299b92432f22c55e2daf8ccf55`: 14 application/test files khác được bảo toàn.

HEAD và package.json/package-lock.json/.gitattributes/tsconfig.json giữ nguyên. `.git/index` raw hash đổi thành `754419f39c20844bf5ac198c11b9523c3e0d1cd957107a388293981ffc3e5f38`; kiểm tra toàn bộ 350 entries cho thấy blob/mode/stage đúng HEAD và staged diff rỗng. Vì vậy không khẳng định index byte-identical, cũng không có staged source change.

`ak plan validate`: valid=true, errors=null. 15 Markdown docs, 61 relative links kiểm tra tồn tại; UTF-8/LF. `git diff --check` PASS. Toàn bộ managed tasks của lượt này đã terminal; không còn listener 4399/4406 hoặc owned server/browser/test processes. Build và failure artifacts được giữ để điều tra, không xóa lịch sử.

**Kết luận bàn giao:** RAIL-01 hoàn tất trong phạm vi được phê duyệt; G2 chưa đóng vì Claude panel/drawer regression còn timeout trong các điều kiện ghi rõ. Không gộp pass từ các môi trường khác nhau thành một suite xanh. Việc tiếp theo để nghiệm thu G2 là điều tra/fix G2-PANEL-01 và timing của drawer dưới điều kiện desktop hiện tại, không mở Phase 03 hoặc đổi source ngoài scope RAIL-01 trong lượt này. OMP tiếp tục off; không commit/push.
