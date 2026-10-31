# Phase 02 — Claude drawer / chat preview regression

Ngày 31/10/2026, Asia/Ho_Chi_Minh. Repository `/mnt/e/vide-code/my-office`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`. Workflow: portable AgentKit `ak-fix` 2.6.0, `ak-debug` 4.2.0, `ak-test` qua Cloud Harness Local. Review tuần tự, không native hooks hoặc subagents.

**Kết luận: popup che drawer đã FIXED và được xác minh FAIL → PASS; final lint/typecheck PASS, unit 51/51 PASS, build PASS, agent E2E 6/6 PASS. G2 vẫn OPEN vì `panels open and close` còn timeout 90s trong original Pro fixture. `a session opens its drawer from the list` PASS khi trace-off, nhưng đã timeout trong lượt trace-on; không chứng nhận hết flaky hoặc mọi browser regressions đã được sửa.**

Tất cả managed tasks của lượt này đã terminal. Kiểm tra sau E2E không có listener ở 4399/4406 và không còn headless browser process. OMP off; không Phase 03, stage, commit hoặc push.

## 1. Approval và phạm vi

Người dùng đã phê duyệt debug/fix tối thiểu `group-chat-view.js`, CSS và tests liên quan, giữ nguyên assertions, chạy build/lint/typecheck/unit/E2E và đánh giá G2. Không có quyền mở live OMP, đọc dữ liệu agent cá nhân, cài package/extension, thay network/security hoặc refactor renderer/core.

Năm application/test files thay đổi thêm trong lượt này:

| File | Thay đổi cuối cùng |
|---|---|
| `src/office/ui/group-chat-view.js` | Không bật preview mới khi có drawer mở; không clear unread/badge |
| `src/styles/group-chat.css` | Preview đã tồn tại nhường drawer; fade không nhận pointer events |
| `tests/e2e/office.spec.ts` | Thêm một app regression case cho popup; **hai test gốc giữ nguyên toàn bộ body so với HEAD** |
| `tests/unit/chat-preview.test.mjs` | Tạo mới ba tests chạy actual preview function với DOM/timer doubles |
| `tests/e2e/chat-preview.spec.ts` | Tạo mới hai browser integration tests cho actual CSS cascade/hit-testing |

Không sửa i18n, schema/API, controls Claude, agent adapter, package manifests/lockfile hoặc Playwright config. Bộ 17 application/test files từ RAIL-01 giữ nguyên fingerprint `ffd3168fc903493c1a12210fc1fd6d7ef4b2fca4c9847760ef705f477fdc5af4`.

## 2. Root cause đã xác minh và bản sửa

Bằng chứng từ lượt trước: Playwright ghi `#zc-peek` / `My Office team` intercepts pointer events khi click `#dr-mac [data-close]`. Source `group-chat-view.js::peek()` không kiểm tra drawer mở; preview ở `z-index:41`, drawer ở `z-index:4`, cùng khu vực trên/phải. Preview trong fade có opacity=0 nhưng vẫn nhận pointer events trước khi hidden bật.

Tái hiện riêng bằng test `new chat messages do not overlay an open drawer or block its close button`: production build cũ `.next-e2e-rail01`, demo/desktop, mở machine drawer rồi phát synthetic message qua debug hook đã có. Unread badge hiện, nhưng preview cũng visible. **FAIL đúng assertion `expect(#zc-peek).toBeHidden({timeout:1200})`**. Sau bản sửa, cùng assertions PASS.

Bản sửa tại nguồn:

```js
// group-chat-view.js::peek
if (chat.open || m.kind === 'sys' || m.from === 'me' || photoOn() ||
    document.querySelector('.drawer:not([hidden])')) return;
```

```css
body:has(.drawer:not([hidden])) .zc-peek { display: none; }
.zc-peek.is-out { opacity: 0; pointer-events: none; /* giữ transform/transition cũ */ }
```

Guard JavaScript ngăn preview mới; CSS xử lý preview có trước lúc drawer mở. Unread vẫn được pipeline chat cập nhật. Không tăng z-index toàn hệ thống, không đổi API drawer, không thêm observer/timer mới. CSS test xác nhận popup lại hiển thị/click được khi drawer đóng.

## 3. Hai timeout còn lại: bằng chứng và đối chứng

Không quy mọi timeout cho popup. Lượt selected Claude E2E sau sửa vẫn dùng original test bodies, viewport 1440×900, 90s/test, một worker, không retry, có trace: startup cozy và hook health PASS, panels và session drawer timeout.

Trích retained trace của panels: navigation 0.21s, rail visible 11.9s, click settings 19.58s, click machine panel 19.38s; các bước actionability liên tiếp tốn khoảng 2s. Không thấy popup pointer-interception trong trace này. Tổng test budget hết trước khi hoàn tất thao tác đóng machine drawer. Đây là độ trễ quan sát được, chưa chứng minh root cause duy nhất của latency.

Trace session drawer: first-row click 35.96s và có một dòng session khác intercept trong khi demo đổi trạng thái/sắp xếp lại rail; tab-subs/tab-act khoảng 14s mỗi thao tác. Việc chọn `.first()` trên dữ liệu demo động có thể đóng góp vào độ bất ổn. Không kết luận đây là nguyên nhân của mọi timeout.

Đối chứng **trace-off**, vẫn original bodies và config mặc định: hai CSS browser tests PASS, original session drawer PASS, original panels vẫn timeout khi click `#tl-open`. Vì vậy tắt trace không giải quyết được toàn bộ vấn đề.

Đã thử một thay đổi test-only để dừng synthetic demo producer qua debug seam `pauseDemo`, giữ Pro scene/viewport/rendering và mọi assertions: session drawer PASS, panels vẫn timeout tại `#tl-open`. **Điều chỉnh này đã hoàn nguyên hoàn toàn vì không xử lý được blocker.** SHA cuối `tests/e2e/office.spec.ts` trở lại `d934d94d3a8b64bcd0865e2d46d3ddf14564ade7fbbbaaef85ab0195854e2c98`; hai original test bodies bằng HEAD byte-for-byte ở mức chuỗi trích xuất. Không để lại helper, thay layout/viewport, pause render, force click, tăng timeout hoặc skip test để làm kết quả xanh.

Chromium headless dùng SwiftShader/WSL2; một số process snapshots có GPU process CPU cao. Đây chỉ là diagnostic samples, không phải benchmark, không đủ để kết luận nguyên nhân cuối hoặc tuyên bố tăng hiệu năng. Renderer/core không được sửa. Phần latency Pro cần investigation riêng có profiling main-thread/rendering; G2 không được đóng bằng cách bỏ qua test này.

## 4. Test coverage cuối cùng

- Unit mới: actual `peek` boundary, không import toàn app/Three.js; drawer suppression không mất unread; normal preview và fade 4200ms + 300ms; giữ guards chat-open/self/system/photo.
- Browser CSS integration: dùng actual `base.css`, `drawers.css`, `group-chat.css`, DOM tối thiểu, không mock CSS fix; preview có trước nhường cả machine/session drawer, clickable lại sau đóng; fading preview không có trong hit-testing.
- App E2E mới: real production server/browser, synthetic chat input, unread badge vẫn hiện, preview không che drawer, real click close hoạt động.
- Agent E2E giữ RAIL-01, List Mode, unsupported provider/capabilities, legacy Claude, HTTP lifecycle/ownership. Sáu ca đều PASS trên application source cuối.
- Hai test gốc được bảo toàn cùng assertions, clicks, Pro URL và timeout. Không sửa test để hợp thức hóa failure.

## 5. Kết quả thực thi

| Gate / run | Kết quả thực tế |
|---|---|
| Pre-fix popup E2E | FAIL đúng assertion preview hidden, exit 1 |
| Production rebuild `.next-e2e-chatfix` | PASS, exit 0; TypeScript và 9/9 static pages |
| Post-fix cùng popup E2E | 1/1 PASS, exit 0, 1.1m; 90s/test, retries=0 |
| Toàn bộ `agents.spec.ts` | 6/6 PASS, exit 0, 2.9m |
| Four selected Claude tests, original bodies, 90s, trace-on | 2 PASS / 2 timeout, exit 1, 4.3m |
| Original two Claude tests + two CSS tests, trace-off | 3 PASS / 1 timeout, exit 1, 3.5m; CSS 2/2, session drawer PASS, panels FAIL |
| Diagnostic pauseDemo, Pro/90s/trace-off | 1 PASS / 1 timeout, exit 1, 3.5m; không dùng làm final-source evidence, fixture đã revert |
| Final `npm run lint` | PASS, exit 0 |
| Final `npm run typecheck` | PASS, exit 0 |
| Final `npm test` | **51/51 PASS**, fail/cancelled/skipped/todo đều 0 |
| `git diff --check`, staged diff, tested source/baseline hashes | PASS; không staged content, source build không đổi |
| G2 | **VERIFICATION INCOMPLETE / OPEN**; popup defect đóng, original Pro panels timeout còn mở |

Final quality run hoàn tất 31/10/2026 09:14:37 +07:00. Application source không thay đổi sau production build; các bổ sung test-only sau đó đã được lint/typecheck/unit ở lượt cuối. Không cần coi build cũ trước popup patch là build cuối; build cuối thật là `.next-e2e-chatfix`.

Không tổng hợp các lượt khác điều kiện để báo full E2E PASS. Không chạy toàn bộ game/animation suite, cross-OS, soak hoặc performance benchmark. Duration là runner output, không phải bằng chứng product performance improvement.

## 6. Environment và commands

Dùng `env -i`, runner/server HOME, USERPROFILE, CLAUDE_CONFIG_DIR, XDG cache/config và OFFICE_DATA_DIR riêng trong mỗi `test-results-g2-*`. Loopback 127.0.0.1:4399, reuseExistingServer=false, workers=1, retries=0; `OFFICE_OMP=off`, `OFFICE_USAGE=0`, `OFFICE_CI=0`, `OFFICE_TRANSLATE=0`, telemetry off. Browser/private libs tái sử dụng cache đã có, không cài thêm. Không đọc OMP roots hay personal Claude data. Đây không phải OS-level network sandbox.

Commands chính, với isolated environment trên:

```sh
npm run lint
npm run typecheck
npm test
OFFICE_DIST_DIR=.next-e2e-chatfix npm run build
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts --workers=1 --retries=0 --reporter=line --trace=retain-on-failure
node node_modules/@playwright/test/cli.js test tests/e2e/office.spec.ts --grep 'new chat messages do not overlay' --workers=1 --retries=0 --reporter=line --trace=retain-on-failure
node node_modules/@playwright/test/cli.js test tests/e2e/office.spec.ts tests/e2e/chat-preview.spec.ts --grep 'panels open and close|a session opens its drawer from the list|an existing chat preview|fading chat preview' --workers=1 --retries=0 --reporter=line --trace=off
```

Next thêm đúng hai generated include paths vào tsconfig; đã so JSON và hoàn nguyên bytes baseline. Hash cuối `tsconfig.json`: `e05c45cd8f34061dd3d6b0bbc52ef53e3ffb1996f82d1f7edcb09cf149a53635`. Không reset Git. Clean npm ci trên Windows-mounted filesystem vẫn chưa có successful clean run; giữ limitation từ trước.

## 7. Artifacts và task handles

| Run | Task | Repo-relative artifacts |
|---|---|---|
| Red popup | `task_Xx1aL1onFhU4mPmh_Ytn7TyYyBA6MX68` | `test-results-g2-popup-red/` |
| Build/initial quality | `task_qE3ZNZtaSZPBfBPH-FhnkboR9Pg71g5A` | `.next-e2e-chatfix/`, `test-results-g2-chatfix-build/` |
| Green popup | `task_cTAt6vIWy7bV287PFCnNa27jDA7OY3kI` | `test-results-g2-popup-green/` |
| Six agent cases | `task_sbQ8SRotKUp6TMyFzGsiWoU7Hzx8tbxI` | `test-results-g2-chatfix-agents/` |
| Original Claude trace-on | `task_DmQz5laI8jImGnirJ1Veo-QQR6OHErwr` | `test-results-g2-chatfix-claude-original/` |
| Default trace-off + CSS | `task_3lh9PNI14LYL97c0Wk-obq_3esFD4GEF` | `test-results-g2-chatfix-default/` |
| Discarded fixture diagnostic | `task_zvPH7m11sEB0PzkwmRR1F_yCybAB1XJg` | `test-results-g2-chatfix-stable/` |
| Final quality | `task_XoUzofILjsWGtjev2fHGLuHz6Q16_SG8` | Managed output, terminal exit 0 |

Failure traces/error contexts được giữ riêng, không ghi đè hoặc xóa. HEAD, manifests/lockfile, `.gitattributes` và restored tsconfig không đổi. Git index raw hash có thể refresh stat cache; staged content diff rỗng, không tuyên bố index byte-for-byte unchanged.

## 8. Handoff

Đã xử lý một defect UI thực tế, bổ sung regression coverage và giữ nguyên acceptance tests gốc. Chưa hoàn tất yêu cầu sửa dứt điểm cả hai browser regressions: panels còn fail ở cấu hình gốc; session drawer chưa chứng minh ổn định giữa các chế độ tracing. Cần profiling nguyên nhân latency của original Pro workflow trước khi quyết định sửa renderer hoặc thiết kế lại test workload; không tự mở rộng source scope hay miễn gate.

G1 live/version/roots/privacy và quyền Phase 03 vẫn độc lập, chưa mở. OMP vẫn off bất kể các synthetic tests đã PASS.

---

**Cập nhật 31/10/2026 (Windows native) — G2 vẫn OPEN, chờ quyết định điều kiện nghiệm thu.** Hai timeout Claude là lỗi môi trường có sẵn từ HEAD sạch: Chromium mặc định dùng SwiftShader nên mỗi frame chặn main thread ~3 s; có GPU thì panels PASS 10/10, session drawer còn cold start 31–35 s so với budget 20 s (3/10 FAIL). Không đổi source. Chi tiết, số liệu và đề xuất: [Windows-native diagnosis](./reports/phase-02-g2-windows-native-diagnosis.md). Lịch sử các lượt trước giữ nguyên.

