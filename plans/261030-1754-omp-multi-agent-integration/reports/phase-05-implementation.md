# Phase 05 — UI/observability implementation evidence (01/11/2026)

## Kết quả và ranh giới

Đã triển khai Phase 05 theo `--auto`: mixed-agent identity/actors, child tree, conversation pagination, evidence/metrics, timeline/replay và read-only controls; đã kiểm chứng các đường chạy bên dưới trên Windows. Đây là evidence cho implementation/UI trong môi trường synthetic cô lập, **không phải tuyên bố mọi cấu hình OMP thực tế hoặc rollout đã đạt**.

Quyết định cuối Phase 04 cho phép bắt đầu Phase 05 dù **G4 vẫn OPEN** ([quyết định](./phase-04-implementation.md#câu-hỏi-còn-mở)). Giữ nguyên local-only, không ghi OMP vào live replay và ended rows mờ trong retention 15 phút của lifecycle. Không đóng thay các thiếu sót R10/S7/ACL của G4; không bắt đầu Phase 06/G6, không benchmark, không commit/push. Lượt này không gọi model OMP, không đọc transcript OMP thật, không sửa settings/cài extension thật, không cài browser/package hay mở transport khác.

## Implementation

### Identity và scene

- `server/git.mjs` cung cấp opaque project/worktree identities từ canonical Git common-dir/worktree. Hai repo cùng basename không thành một project. OMP chỉ dùng chung identity với local Claude khi mapping có `localRoot` rõ ràng và Git identity được xác minh; mặc định vẫn source-scoped.
- Scene grouping ưu tiên `projectKey`; tên repo/session chỉ dùng hiển thị. Khi thiếu key, legacy Claude cùng full local `dir` vẫn nhóm chung; path và session fallback có namespace riêng. OMP/unknown provider thiếu key được tách theo session, không suy cùng source từ display path. Đây là thay đổi scene identity, không phải claim mọi label aggregate cũ trong repository đã được chuyển đổi.
- Appearance theo session identity; child actor key bao gồm root/agent namespace, raw child ID chỉ dùng đúng API owner. Rename, cùng tên, cùng raw child ID và reconnect không ghép nhầm roots.
- Render tối đa **64 actors tổng cộng**, kể cả actors đang rời scene, tối đa **32 children/root**, ưu tiên roots. Model/List giữ toàn bộ rows; overflow/flattening có indicator. True parent identity giữ nguyên trong drawer.
- OMP có text badge riêng; không tải logo ngoài, không vào Claude quota, attendance, fake chat/completion hay task recipients. Ended/stale/history không biến thành confirmed work.

### Child support, conversation và privacy

- Persisted task artifacts được khám phá có containment/caps (tối đa 128 children/root), root/parent allowlist, child owner validation. Nested task lineage giữ được trong tree; scene có thể flatten về root với note.
- Child files chỉ chứng minh **historical/persisted evidence**, không chứng minh live runtime. Live child/advisor chưa hỗ trợ được ghi rõ. Tombstone chỉ là marker hiện diện, **không** tự suy aborted/completed vì history có thể được revive. `doneSubs` không được fabricate từ marker.
- `/api/log` trả page `{items,nextCursor,incomplete}`: tối đa 120 items/page, bounded view 4096 items; cursor opaque gắn root/child/snapshot. Sai/stale cursor không trả nhầm content. Legacy registry array API giữ compatibility.
- Generic assistant/user, canonical tool invocation/result/error metadata và compaction/reset/branch summaries hiển thị an toàn. Không render raw tool args/output hoặc reasoning. Metadata mode không đọc transcript; opt-in chỉ đọc pinned artifacts qua local authorized API. Hybrid chỉ được đọc khi có persisted file/capability hợp lệ.
- Drawer kiểm tra request/session/tab/child/capability khi response về; revoked capability xóa content và chặn late response. Backwards pagination giữ view/scroll khi page thực sự được áp dụng.
- Structured cost/context nullable có scope/provenance; unknown là `—`, measured zero vẫn là zero. Không cộng inherited OMP history vào Claude bill/quota. HUD không đếm 80 historical/parked children thành 80 subagents đang chạy.

### Timeline, replay và bounded normalization

- Timeline dùng stable session/child keys khi có; legacy replay vẫn dùng name fallback, không rewrite replay files. Parallel tool IDs có pending/terminal state riêng; routine `rest` snapshot không kết thúc tool còn pending. Unknown/history/stale/gap không cộng như exact work/turn; failure/abort evidence có marker.
- OMP live events không được ghi vào replay. Playback chỉ chạy visual projection; chặn transcript read, task/chat/account/control side effects, không sửa homes/preferences và không phát fake live reactions. Approval-viewer presence được release trước khi vào replay.
- Seek/stop hủy path callbacks, settles pose/position/reservation/**station** đồng bộ; replay snapshot-only children vẫn có pose đúng. Stop reset khi guard replay còn bật rồi mới reconnect live.
- Normalizer ngăn evicted duplicate entry làm rewind selected branch hoặc cộng lại usage: exact retained-ID check + fixed bounded Bloom membership nằm trong `maxIndexBytes`. Membership có thể false-positive: entry nghi trùng bị bỏ qua, gắn `possible-duplicate-entry-id`/incomplete và không công bố exact metrics; rebuild epoch tạo ledger mới. Đây là trade-off bounded memory có công khai mất độ đầy đủ, không phải exact duplicate detection vô hạn.

## V1–V8 evidence

| ID | Evidence đã quan sát | Giới hạn |
|---|---|---|
| V1 | Mixed snapshot và actual isolated hybrid server: Claude + OMP, harness badges, reused actors/stations | Synthetic input; không chạy model-backed OMP mới |
| V2 | Git/worktree unit + real `projOf` boundary probe/test; same-name/root/child collision + rename/reconnect E2E | Cross-host chỉ theo approved mapping; không suy từ basename/path string |
| V3 | Bounded actor E2E + nested persisted tree + manual drawer: 8 roots, 56 rendered children; 80 historical children vẫn trong model, overflow hiển thị | Live child/advisor unsupported; tombstone outcome unknown |
| V4 | Files metadata-only/opt-in API + inert HTML/tool metadata/error/summary/pagination; revoked/late-response unit; replay privacy E2E | Không đọc nội dung người dùng thật; redaction không bảo đảm nhận diện mọi secret |
| V5 | Hybrid approval/input/idle/stale/end, hot reconnect; gap/history/unknown unit/UI; ended dim styling | Installed-mode callback matrix còn thuộc G4; silence không được gọi completed |
| V6 | Timeline unit (legacy/new, correlated parallel/late tools) + replay normal/forward-seek/child/station E2E | OMP không ghi live replay; replay fixture không thay production recording evidence |
| V7 | Nullable/zero/scoped metrics + quota/task/account guard unit/E2E; actual API rejects forged OMP control IDs | Không suy subscription từ model; không benchmark ledger accuracy trên real workload |
| V8 | Low Quality/List, root gone/child cleanup, reconnect, phone emulation, keyboard E2E; manual desktop/mobile drawer | Windows Chromium duy nhất; không real phone, cross-OS, FPS hay zero-WebGL claim |

V1–V8 được kiểm chứng trong scope nêu trên. Báo cáo này không tự đóng G4 hoặc chứng nhận G5 trên mọi installed runtime/host; full existing E2E, security/performance/cross-OS rollout vẫn là G6.

## Verification cuối cùng

Môi trường: Windows 10.0.26200 x64; Node **24.22.1**; Next.js **16.4.3**; Playwright **1.56.1**, Chromium revision **1194**, ANGLE/D3D11. E2E 1 worker, **retries=0**, test timeout 90s/expect 30s, desktop 1440×900; mobile Chromium touch emulation 390×844. HOME/USERPROFILE/CLAUDE_CONFIG_DIR/data/dist và OMP roots/token/config được cô lập; translate/usage/CI integrations tắt. Không dùng credentials thật.

| Check | Kết quả cuối | Log dưới `test-results-phase5/` |
|---|---:|---|
| `node --test` | **245/245 PASS**, 0 fail/skip | `unit-final.log` |
| `node node_modules/eslint/bin/eslint.js .` | PASS | `lint-final.log` |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | `typecheck-final.log` |
| `node node_modules/next/dist/bin/next build` với `.next-phase5` | PASS | `build-final.log` |
| `agents.spec.ts` | **12/12 PASS** | `agents-e2e-final.log` |
| `omp-files.spec.ts` | **3/3 PASS** | `omp-files-e2e-final.log` |
| `omp-hybrid.spec.ts` | **1/1 PASS** | `omp-hybrid-e2e-final.log` |
| Selected existing `office.spec.ts` | **7/7 PASS** | `claude-smoke-final.log` |
| Owned listeners 4415–4419 sau teardown | Tất cả `ECONNREFUSED` | `ports-released.log` |

Browser chạy bằng `node node_modules/@playwright/test/cli.js test`; default agent/Claude runs dùng existing ignored `test-results-p3-gpu/playwright.gpu.config.ts`. Files/hybrid runs dùng wrapper tạm của mode config để giữ ANGLE/D3D11, cwd, workers/retries; wrapper đã xóa sau smoke. Mode configs permanent: `playwright.omp.config.ts`, `playwright.hybrid.config.ts`. Không tăng timeout/retry hoặc bỏ assertion để lấy PASS. `checkJs=false`: TypeScript không thay runtime/unit evidence cho JS/MJS.

Selected Claude smoke gồm startup pro/cozy/hq, panel open/close, hook/auth, drawer và English/Vietnamese. Đây không phải full existing E2E suite. Next vẫn cảnh báo `metadataBase` chưa cấu hình; không suppress và không đưa ngoài scope này.

### Browser surface đã quan sát trực tiếp

Managed Chromium mở isolated hybrid preview và `?demo&agents`; thao tác List/drawer/Low Quality và mobile. Desktop thực đo 1707×891; mobile settled 390×844, body/document width 390, không horizontal overflow. Drawer giữ 40 subs/root và một done fixture riêng, parent/support notes và read-only controls. Corrected child label width khoảng 248px desktop/283px mobile; HUD là “8 sessions”, không “80 subagents running”.

Ảnh local: `test-results-phase5/visual-desktop.webp`, `visual-mobile.webp`. Ảnh chứng minh layout tại lượt manual; không dùng ảnh thay cho E2E/state assertions. Lượt E2E cuối sau sửa identity fallback vẫn PASS cả desktop/mobile geometry/HUD assertions. Không có FPS/performance claim; List Mode vẫn có WebGL. Browser và preview riêng đã đóng.

## Review, failures và repair evidence

Implementation đã qua scoped simplification và independent backend/security + actor/timeline review; các reviewer cuối không còn concrete blocker trong phần được review. Reviewer không chạy checks; bảng trên là kết quả orchestration thực chạy.

Các lỗi đã phát hiện và sửa, không xóa failure history:

- Unit DOM double thiếu richer rail node factory: sửa test dependency injection, giữ behavior assertions; cuối full suite 245/245.
- Temporary GPU wrapper TypeScript dùng spread `as object` làm build thiếu required webServer command: narrow đúng runtime shape, build PASS; wrapper đã bỏ. Preview launch ban đầu có Windows path quoting ENOENT: chỉ normalize fixture env paths, không sửa production logic.
- Evicted duplicate rewind và premature tool completion được probe trước/sau (`review-reproductions-before.log`, `review-reproductions-after.log`) rồi giữ regression tests.
- Replay guards, child snapshot pose, seek movement/station consistency và presence release được sửa theo review và kiểm bằng replay E2E.
- Manual smoke phát hiện historical children bị HUD đếm là running và nested label bị nhốt trong cột icon 28px: sửa count predicate/direct-child grid placement, thêm semantic/geometry assertions; final E2E PASS.
- Boundary probe cuối: hai Claude paths `/first/repo`/`/second/repo` từng group chung khi thiếu projectKey. Sau tagged fallback, `sameBasenameMerged:false`; regression test bao phủ path/session collision, unverified OMP same display path, verified shared key và readable labels (`project-fallback-before.log`, `project-fallback-after.log`). Counsel + independent final review chấp thuận.

Tool/browser helper failures không được tính thành application PASS. Không hạ verification requirements. Build-added `.next-phase5` tsconfig includes và temporary validation source đã được dọn; logs/build/screenshots giữ trong ignored output. Existing user changes/data không bị reset/xóa.

## Trạng thái bàn giao

Implementation và evidence checklist Phase 05 hoàn tất trong scope trên; plan tổng vẫn in-progress/current phase 5. G4 còn thiếu actual interactive/plan-review/subagent/`ask` mode evidence, cross-host/S7 và Windows token ACL. Không có quyết định đóng các gate đó trong lượt này. Phase 06/rollout không chạy.

Plan CLI đã tick đủ 6 checkbox Phase 05, reindex và ghi phase evidence/acceptance: phase status trong index là `done`; tổng plan **2/6 phases, 20/32 tasks**, vẫn `in-progress`, current phase 5. **Giới hạn CLI:** `ak plan check` không rewrite `status: pending` trong frontmatter của `plans/261030-1754-omp-multi-agent-integration/phase-05-ui-observability.md`, cũng không rewrite ô Pending của Phase 05 trong `plans/261030-1754-omp-multi-agent-integration/plan.md`. Không hand-edit các status cells theo workflow; execution update/checklist/report này ghi rõ trạng thái mới thay cho snapshot cũ.

`docs/ARCHITECTURE.md` và current delta của validation matrix đã cập nhật contracts/limits/evidence thực tế. Journal tự động bật theo preference, đã tạo qua CLI: [local journal](../../journals/2026-11-01-phase-05-mixed-agent-observability.md). **AgentWiki publish skipped**: không có authorization publish.
