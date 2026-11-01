# Validation matrix, gates and planned test execution

Các hàng G4–G7 bên dưới là kế hoạch, không phải kết quả đã chạy. Bằng chứng thực tế G1–G3 nằm ở các mục tương ứng; synthetic unit không thay installed Windows runtime evidence.

| Gate | Scenario | Pass condition |
|---|---|---|
| G1 | Version and protocol | Exact installed binary/version/profile proven; RPC and extension support matrix pin; no secret files |
| G1 | Ownership safety | Approved roots, stale != ended, no duplicate writer, fail-closed policy & permissions |
| G2 | Hide vs unpin | Hide running/disconnected/ended/history only removes UI, keeps transcript/telemetry/pin |
| G2 | Persistence & SSE | Hidden stays hidden through refresh/reconnect/restart, recovery and multi-tab revision |
| G2 | HTTP negative | Foreign OMP ID, empty/malicious Origin, LAN, tunnel, forged session rejected |
| G3 | New/resume | Native Windows `spawn` shell=false, exact selected session/resolved source ID, approved project/profile |
| G3 | Faults | Unavailable model/bin, wrong cwd, junction, bad transcript, concurrent TUI, exit/restart/timeout safe |
| G4 | Commands | Idle prompt, busy steer/follow-up, queued/canceled, proper abort; accepted != settled |
| G4 | Idempotence | Duplicate requestId and missed ACK never double-send; old generation cannot act |
| G4 | Data privacy | No prompt in logs/SSE remote/replay; disabled observer-only & remote actions |
| G4 | Live Activity Bubbles | Hai OMP workers độc lập hiển thị category read/edit/test/cmd đúng evidence; tên file/test optional local opt-in, tối đa 80 ký tự, không bịa khi thiếu dữ liệu |
| G4 | Lifecycle/Privacy | tool_end, idle, waiting, stale, disconnected, ended, generation, eventGap, hidden/replay/streamer làm clear/downgrade label cũ |
| G5 | TUI opt-in | Observer-only does NOT receive command; installed controller handshake and scoped command works |
| G5 | TUI failures | Token expired, wrong source/session/generation, two owners, offline, queue bounds, cleanup |
| G5 | External TUI bubbles | Observer-only chỉ category; detailed metadata chỉ qua controller opt-in, no cross-agent or stale leak |
| G6 | Tool approval | Real pending decision id, allow once or deny, expiry, no automatic allow/always |
| G6 | Ask/plan | Input validation, plan revision, skip-to-TUI, unsupported mode disabled |
| G6 | Remote security | Even with Claude `phoneApprove`, OMP approval from LAN/tunnel/browser origin rejected |
| G7 | Regression | Claude hooks/chat/permissions/tasks/account/replay and OMP files/hybrid/usage keep previous behavior |
| G7 | Perf | Measured CPU/RSS/handles, FPS/p95 frame-time, CSS2D DOM/layout churn before-after for 2/8/32/64 actors, event bursts, closed dashboard, Low Quality/List Mode |
| G7 | Rollback | OFF flags restore observer-only; no transcript deletion/auto restart |

## G1 — COMPLETE: baseline và design review (2026-11-01)

Xem [báo cáo compatibility/security](./reports/g1-compatibility-security.md). Review hoàn tất không cấp quyền bật G3–G6.

| Kiểm tra | Kết quả |
|---|---|
| Source map, ownership và strict Origin/control auth tách telemetry | VERIFIED source; design đã chốt |
| Binary/native environment | OMP18.14.2, Node24.22.1, Windows10.0.26200 x64; HEAD `8da383771bf4329aa9b471f477d53fb593e1f9e1` |
| RPC no-turn với model giả loopback | VERIFIED: 2 child, 13 correlated success responses, 0 model HTTP requests, EOF exit0 |
| `get_state`, `new_session`, exact `switch_session`, CLI exact `--resume`, `get_messages`, idle `abort`, lease response | VERIFIED trong synthetic fixture; free lease không chứng minh độc quyền |
| External TUI bridge, prompt/steer/follow-up, active abort, approval/completion, v2 negotiation | UNKNOWN/DOCUMENTED, disabled; gate sau phải kiểm chứng riêng |
| Ngoại lệ policy, real profile/runtime, extension install và paid model | Chưa duyệt; không prerequisite để đóng review G1, vẫn chặn G3–G6 |
| Dọn fixture G1 | Đã xóa `test-results/g1-native-protocol-20261101`; không sửa policy/token/session thật |
| **G1 tổng** | **COMPLETE cho review**; không phải rollout/control PASS |

## G2 — PASS (2026-11-01)

| Kiểm tra | Kết quả |
|---|---|
| Toàn bộ `tests/unit/*.test.mjs` | 359 trường hợp: **356 PASS, 3 SKIP, 0 FAIL** |
| Store + route + UI visibility | PASS: restart persistence, idempotent/409, corrupt fail-closed, sanitize/limits, remote/Origin/ID negatives, Undo, refresh, replay callbacks |
| Lifecycle dùng clock synthetic | PASS: connected/stale/disconnected/ended/expired; timeout không thành ended; restore-expired không tạo actor |
| Production build cô lập | PASS, Next16.4.3; không thay `.next` của office thật |
| ESLint / `tsc --noEmit` | PASS, exit0; chạy lại sau dọn fixture và khôi phục cấu hình build tạm |
| `playwright.omp.config.ts` | **6/6 PASS**: files/history/privacy, hide/reload/restore, keyboard/Undo/rail/3D actor và unpin |
| `playwright.hybrid.config.ts` | **1/1 PASS**: hide connected, telemetry đổi khi hidden, reload/restore current state, ended, reconnect, Claude/replay isolation |
| `tests/e2e/agents.spec.ts --workers=1` | **13/13 PASS**: Claude lifecycle/control, quotas, mixed identity, bounded actors, mobile và replay |
| UI thật tiếng Việt desktop/mobile | PASS: dialog/menu/refresh/hide/Undo, mobile width390/scrollWidth390, dialog356px, action targets44px; không pageerror trong smoke sạch |
| Server thật restart | PASS: revision5 + hidden ID còn nguyên, catalog vẫn pinned, snapshot không actor; restore qua UI thành đúng 1 thẻ |
| Transcript synthetic trước/sau hide/Undo/restart/restore | SHA256 không đổi: `85bac6973f0a3b02bef0d67b77182b61e99fd1503fac56f990cf8df2184528a6` |
| **G2 tổng** | **PASS**; chỉ presentation, không quyền launch/control/kill/delete |

### Runner, nguyên nhân lỗi và lệnh thực chạy

- Source trước lượt tiếp tục đã có Hide nhưng test production dùng build có sẵn. Sau build mới, nút và luồng hoạt động; không sửa logic để che lỗi. Không chứng nhận byte-for-byte bản build cũ đã bị thay ở phiên trước.
- Hai spec files dùng chung pin/visibility store: chốt 1 worker, reset qua API trước/sau mỗi ca để không nhiễm trạng thái khi một ca lỗi. Default Claude config bỏ qua spec OMP visibility; assertion đếm số nút đã bỏ, thay bằng hành vi thực tế.
- Unit fixture lifecycle ban đầu bỏ lớp `record.live` của adapter nên projection trả unknown. Đã sửa fixture cho đúng hợp đồng production, giữ nguyên kỳ vọng connected/stale/disconnected.
- Restore có accessible name chứa đúng ID/phiên để phân biệt tên trùng; E2E chọn theo `data-omp-id`, không ghim lại wording.
- Backend đồ họa headless mặc định làm các bước tương tác 3D vượt tổng90s; trace ghi mọi bước vẫn hoàn tất (~98s). ANGLE/D3D11 native chạy nguyên 13 regression tests trong ~1,2 phút, không nới timeout/expectation. Cấu hình chính thức Windows đã pin D3D11; các hệ điều hành khác không đổi.
- Hybrid token fixture phải có parent ACL an toàn. Runner dùng HOME/Claude config cô lập, giữ USERPROFILE của runner để tạo credential **synthetic riêng, UUID** dưới home an toàn; webServer vẫn dùng USERPROFILE cô lập. Không sửa ACL checkout hoặc nới private-storage; `afterAll` xóa token riêng. Thử đặt token dưới checkout đã bị từ chối trước startup đúng fail-closed.

Lệnh đã chạy bằng Node24.22.1:

```text
node node_modules/next/dist/bin/next build
node --test tests/unit/*.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test -c playwright.omp.config.ts
node node_modules/@playwright/test/cli.js test -c playwright.hybrid.config.ts
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts --workers=1
```

Build/E2E dùng cùng `OFFICE_DIST_DIR=.next-e2e-g2-20261101-continuation`, `E2E_OUT=test-results-g2-20261101-continuation`, port4497. Smoke restart dùng fixture riêng `test-results-g2-20261101-runtime`, port4498 và hai lần `node .../serve.mjs` với HOME/data/config chỉ thuộc fixture.

Đã đóng các tab/server smoke; xóa toàn bộ ba thư mục tạm trên, wrapper GPU/launcher, trace/log/dữ liệu synthetic và hai screenshot `%TEMP%` của task. Các thay đổi tự sinh của Next trong `tsconfig.json`/`next-env.d.ts` đã trả về đường dẫn chuẩn. Không xóa artefact hay dữ liệu của phiên trước.

Giới hạn: 3 unit SKIP có sẵn không bị tính PASS; không paid model/active approval/TUI-controller smoke, không deploy lên office đang chạy. G3–G7 vẫn có gate riêng.

## G3 — PASS (2026-11-01, Phase 04 vẫn đóng)

[Biên bản G3](./reports/g3-launcher-acceptance.md) sở hữu kết quả các lượt kiểm chứng và commands. Bản cài gốc `18.15.0` được giữ nguyên; exact Resume độc quyền được chứng minh trên bản build cô lập `backups/omp-g3-native-20261101/omp-office-g3.exe` (`SHA-256: e753e08f423b9a27d6bed448376b615bd83c24ed9af342730076969907caf0f5`).

Khi allowlist bật `resumeProtocol: 1` và `ownerDir` nguồn đã duyệt, child native lấy đồng thời khóa miền gốc (`ownerDir + sessionId`) và khóa đường dẫn canonical trước khi đọc history, giữ nguyên từng byte transcript (kể cả khi có assistant message), phát `ready.officeOwnershipProtocol=1` và `get_state.officeOwnership` rồi mới được nhận làm managed owner. Stock binary hoặc cấu hình không khai báo `resumeProtocol: 1` vẫn từ chối `LAUNCH_OWNER_UNVERIFIED` fail-closed. Phase 04 vẫn đóng cho tới khi có phê duyệt riêng.

## Proposed new tests (create during approved phase)
- `tests/unit/omp-visibility.test.mjs`
- `tests/unit/omp-launch-resolver.test.mjs`
- `tests/unit/omp-rpc-host.test.mjs`
- `tests/unit/omp-command-schema.test.mjs`
- `tests/unit/omp-control-manager.test.mjs`
- `tests/unit/omp-controller.test.mjs`
- `tests/unit/omp-controller-bridge.test.mjs`
- `tests/unit/omp-approvals.test.mjs`
- `tests/e2e/omp-visibility.spec.ts`
- `tests/e2e/omp-launch-resume.spec.ts`
- `tests/e2e/omp-controls.spec.ts`
- `tests/e2e/omp-approval.spec.ts`
- `tests/fixtures/omp/fake-rpc-host.mjs`

## Activity bubble tests to create during approved phase
- `tests/unit/omp-activity-summary.test.mjs`
- `tests/e2e/omp-activity-bubbles.spec.ts`
- Include 2 simultaneous OMP workers, read→edit→test, concurrent same-name sessions, malicious label, stale/gap/end, streamer/remote privacy, collision, 80-character and burst updates.

## Regression targets already present
`tests/unit/agent-compat.test.mjs`, `tests/unit/agent-schema.test.mjs`, `tests/unit/omp-adapter.test.mjs`, `tests/unit/omp-lifecycle.test.mjs`, `tests/unit/omp-bridge.test.mjs`, `tests/unit/omp-observer.test.mjs`, `tests/unit/omp-projection.test.mjs`, `tests/unit/timeline.test.mjs`, `tests/unit/i18n.test.mjs`; `tests/e2e/agents.spec.ts`, `tests/e2e/omp-files.spec.ts`, `tests/e2e/omp-hybrid.spec.ts`, `tests/e2e/chat-preview.spec.ts`.

## Candidate commands — AFTER implementation approval
```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node --test tests/unit/omp-*.test.mjs tests/unit/agent-*.test.mjs tests/unit/i18n.test.mjs tests/unit/timeline.test.mjs
node --test
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test tests/e2e/agents.spec.ts tests/e2e/omp-files.spec.ts tests/e2e/omp-hybrid.spec.ts tests/e2e/omp-visibility.spec.ts tests/e2e/omp-launch-resume.spec.ts tests/e2e/omp-controls.spec.ts tests/e2e/omp-approval.spec.ts tests/e2e/omp-activity-bubbles.spec.ts
```

The command shapes above are **proposed**. Verify `package.json` and platform first; OMP/hybrid browser configs are separate and may require isolated runs. No `npm install`, `start-office.ps1`, `omp` CLI, paid model calls, fixture creation outside repo or system modifications in the current planning turn.

## Performance plan
Benchmark same native Windows machine/build for: feature OFF; read-only observer; 8 idle managed RPC children; synthetic active commands; external extension idle and active; closed dashboard with server running; Low Quality and List Mode. Measure RSS delta per child, event-loop lag, file handles, observer callback p95, CPU, browser FPS. Record warm-up, sample counts, platform and uncertainty. Fail if uncontrolled timer/process growth or material Claude latency regression; don't invent a fixed pass threshold without measured baseline.

## Stop and evidence protocol
Any wrong-session resume, unapproved process launch, prompt duplication, transcript/credential leak, unsafe auto-approval, remote command success or performance regression => halt affected phase and disable feature flag, preserve user source files, record incident and request scoped approval for fix. For each test write exact PASS/FAIL/NOT RUN, not inferred.
