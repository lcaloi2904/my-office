# Validation matrix — planned scenarios và execution evidence

## Current execution delta — Phase 05, 01/11/2026

Phase 05 implementation/UI đã kiểm chứng trên Windows Chromium với nguồn synthetic cô lập: 245/245 unit, lint/typecheck/build PASS; agents 12/12, files 3/3, hybrid 1/1 và selected Claude smoke 7/7 PASS. V1–V8 evidence, privacy/replay/child support limits và manual desktop/mobile proof ở [Phase 05 report](./reports/phase-05-implementation.md). Không có cross-platform/FPS/zero-WebGL claim.

Quyết định cuối Phase 04 cho phép Phase 05 chạy trong khi **G4 vẫn OPEN**. Những phần installed runtime, cross-host/S7 và ACL Windows chưa có evidence vẫn chưa được đóng; Phase 06/G6/full rollout suite/benchmarks chưa chạy. Permission YAML và NOT RUN statements của snapshot cũ bên dưới là lịch sử, không phải quyền hoặc kết quả mới.

### G4 local execution delta — 01/11/2026

[Local validation](./reports/phase-04-local-validation.md): actual installed OMP18.14.2/TUI với scripted loopback model đã phát read/message/shutdown, manual plan-review request/resolution (waiting/input → idle), built-in ask và task child callbacks. R10 vẫn PARTIAL: cancellation/automatic plan proposal/complete execution continuation chưa verified; exact ask waiting và live child reporting là unsupported đã quan sát. **S7 Windows token ACL FAIL**, không phải NOT RUN nữa; chưa sửa/rotate. Cross-host vẫn NOT RUN, G4 OPEN. Không Phase06/rollout.

### Authorized ACL/token remediation — 01/11/2026

[Remediation report](./reports/phase-04-token-remediation.md): local finding G4-ACL-01 đã sửa trong filesystem/token boundary đã thử; private directories/files chỉ trusted SIDs, old401/new200, foreign-source422, unrelated ACLs unchanged. Source guards tạo private DACL tại birth và fail closed cho unsafe/malformed storage. Full unit268/268, focused70/70, lint/typecheck, hybrid browser1/1 PASS. Fresh explicit OMP package load có correlated acceptance; idle-exit45s timeout vẫn là failed check, EOF cleanup exit0. Existing loaded factories chưa hot-reload; không dừng user agents. **G4 tổng vẫn OPEN**, cross-host/runtime limits không được đóng.

## Historical execution delta — Phase 02 RAIL-01 repair, 31/10/2026

RAIL-01 đã sửa trong scope extension được người dùng phê duyệt. Lint/typecheck/rebuild PASS; 48/48 unit và 6/6 agent E2E PASS. Agent suite giữ viewport 1440×900, 90s/test, không retry. Selected Claude regression 1440×900 có 3 PASS / 1 timeout ở 180s/trace-on và 2 PASS / 2 timeout ở mặc định 90s/trace-off; **G2 chưa nghiệm thu toàn bộ**, không ghi mọi scenario dưới đây thành PASS.

Mapping C1–C7, diagnostic conditions và kết quả cuối ở [RAIL-01 repair](./reports/phase-02-rail01-fix.md). [Runtime validation](./reports/phase-02-runtime-validation.md) giữ pre-fix failures; [implementation report](./reports/phase-02-implementation.md) giữ baseline/dependency history. Không live OMP, benchmark, Phase 03 hoặc commit/push.

```yaml
currentScope: phase-02-synthetic-only
approvedSourceEdits: phase-02-files-table-plus-approved-activity-rail01-extension
approvedUnitLintTypecheck: true
approvedLiveSessionRoots: []
approvedConversationReadFromRealAgents: false
approvedPackageOrBrowserInstall: scoped-local-validation-prerequisites-only
approvedSystemPackageInstall: false
approvedBuildOrAppStart: isolated-test-roots-only
approvedE2EExecution: synthetic-phase-02-and-selected-claude-regression
approvedLiveOmpOrExtensionInstall: false
approvedBenchmarks: false
approvedCommitOrPush: false
```

Permission manifest mục 10 là **snapshot lịch sử của Phase 01**, không phủ nhận approval synthetic mới này. SF01–SF17 vẫn là specifications của các phase parser/runtime tương lai, không phải toàn bộ đã trở thành tests. Hai file unit Phase 02 và sáu ca trong agent E2E spec hiện có không đồng nghĩa đã triển khai parser/realtime fixtures; run kết quả và các case fail được ghi riêng trong runtime validation report.

## Quyền và trạng thái

Tất cả application tests/build/E2E/benchmarks dưới đây đều **NOT RUN** tại thời điểm lập kế hoạch. `ak plan validate` chỉ kiểm tra định dạng tài liệu. Chỉ chạy nhóm validation được người dùng phê duyệt; source implementation approval không tự cấp quyền cài browser/package, dùng OMP credentials, gọi model hoặc thay network.

Lệnh dùng scripts hiện có đã xác minh ở `package.json`. Những test files/benchmark helper đề xuất chưa tồn tại cho tới phase tương ứng. Test parser/reducer dùng Node built-ins, dependency injection và synthetic fixtures; không import server/index.mjs để tránh startup side effects.

## 1. Claude compatibility / G2

| ID | Scenario | Expected result | Level / owner |
|---|---|---|---|
| C1 | OFFICE_OMP=off hoặc unset; config/roots lỗi | Zero OMP reads/watchers/timers/ingress; Claude hoạt động như cũ | agent-schema/agent-compat unit + isolated server |
| C2 | Claude start/prompt/tool/approval/stop/interrupt/subagent/end | Trạng thái, counters và controls giữ contract | Unit facade fixtures + existing E2E |
| C3 | Crafted OMP IDs vào tasks/account/open; OMP PID trùng Claude | Không route vào Claude executor; ownership enforced server-side | Unit + agents E2E; không kill process thật |
| C4 | Hai providers cùng sid/name; hai roots cùng child ID | SessionKey/namespaces khác; lookup không nhầm | agent-schema/agent-compat |
| C5 | Claude quota hết; OMP acct thiếu và OMP inherited cost | OMP không bị quota-break; không trộn totals/plan allowance | Unit projection + mixed E2E |
| C6 | Legacy snapshots/replay thiếu fields mới | Reader giữ fallback cũ; no destructive migration | timeline unit + replay E2E |
| C7 | Nullable cost/context; unknown provider; metadata privacy | Không NaN/zero giả/Claude label-controls giả; không raw text leakage | Projection + UI E2E |

## 2. File reader / G3

| ID | Synthetic fixture | Expected result |
|---|---|---|
| F1 | v3 có/không title slot; legacy version; unknown major | Supported versions đúng matrix; unknown degraded không crash Claude |
| F2 | File chưa tồn tại, header-only, lazy file xuất hiện sau runtime | Không lỗi/ghost live; attach đúng identity khi materialize |
| F3 | Split JSON/UTF-8 nhiều bytes/CRLF ở mọi boundary | Parse complete lines đúng một lần; offset không mất bytes |
| F4 | Malformed line, oversized line, không newline nhiều chunks | Diagnostic bounded; drain an toàn; không busy loop/allocation vô hạn |
| F5 | Truncate, replace cùng path, rename/move, deletion | Epoch reset/reconcile; không re-add totals; close handles |
| F6 | Title update same size; middle rewrite; rewrite+append | Refresh đúng hoặc bounded rebuild; prefix hash không bị coi là proof toàn file |
| F7 | parentId tree, activeLeafId, compaction/reset/cycle/missing parent | Conversation đúng selected branch hoặc incomplete rõ ràng; không silent wrong view |
| F8 | Fork copy entries, continuationOf, resume after prior exit | Giữ lineage, không biến fork thành subagent hoặc closed runtime mới |
| F9 | Nested artifacts, parked/revived/tombstone/advisor | Root/parent identity đúng; historical files không auto-spawn live actors |
| F10 | ENOENT/EACCES/EMFILE/EIO, root inaccessible, malformed header | Phân biệt absent với error; retry/backoff; không xóa nguồn |
| F11 | Traversal, symlink escape, junction/UNC, drive/case/non-ASCII paths | Approved canonical containment; denied path không mở hoặc đọc |
| F12 | Nhiều files, overlapping scans, cancel/stop, caps/eviction | Bounded jobs/FD/bytes, dispose sạch; catalogue history có pagination |

Fixtures đặt dưới tests/fixtures/omp; manifest ghi source schema pin và expected evidence. File mutation trong test chỉ là fixture producer, không adapter. Hash/control fs spies xác nhận adapter không write source; không đọc secrets để tạo test case.

## 3. Usage / G3–G4

| ID | Scenario | Expected result |
|---|---|---|
| U1 | assistant usage + model_usage, missing/invalid numeric data | Numeric validated; cost/model/context provenance và scope; unknown giữ unknown |
| U2 | Fork/continuation/subtree có shared history | Không double-count grand total; per-session inherited history explicit |
| U3 | Duplicate entries/events, rewrite/restart, file+bridge cùng usage | Durable ledger idempotent, provisional snapshot replace không cộng lần hai |
| U4 | Compaction/model switch/contextWindow thiếu | Context hiện tại khác lifetime tokens; không dùng Claude ctxMax mặc định |

UI compatibility rule: nếu legacy consumer cần full numeric usage shape thì để legacy usage=null cho OMP chưa đủ fields; đưa nullable metrics qua additive structured field. Không điền 0 để lách arithmetic guards. Consumer cần hiển thị OMP đọc structured fields được validate.

## 4. Realtime / G4

| ID | Scenario | Expected result |
|---|---|---|
| R1 | Start, switch, resume, fork, shutdown | Session identity/runtime generation tách biệt; callbacks cũ không mutate mới |
| R2 | Parallel tools, result-before-start, duplicate end | Pending set theo toolCallId; terminal state không quay lại running |
| R3 | Approval requested/resolved, ask, plan/input variation | Waiting reason dựa verified event, no control reply; unsupported input path explicit |
| R4 | Long tool, retry, aborted/error, pending jobs/follow-ups | Turn end không đồng nghĩa terminated hoặc mọi việc đã xong |
| R5 | Producer crash/heartbeat missing/clock skew | Stale/disconnected, không false-completed; dựa server observedAt |
| R6 | Server offline/restart, producer reconnect, slow client | Agent không block, fresh snapshot; memory/queues bounded |
| R7 | Duplicate/out-of-order/old generation/sequence gap/ACK-loss | Idempotent within contract, gap signal khi không khôi phục được |
| R8 | Nhiều extension factories/child sessions cùng process | State/timers scoped đúng; no module-global current-session leak |
| R9 | Bridge event trước persist, file materialize, history backfill | Một actor/tool, usage replace; no replay animation lịch sử |
| R10 | Actual approved OMP version/mode loading | Factory loads và callbacks thật đúng support matrix; fake pi không thay bằng chứng live |

ACK acceptance in memory không bảo đảm crash durability. Test explicitly server chết sau ACK trước checkpoint; expectation là snapshot/file recovery cộng gap marker, không giả vờ transient event không mất.

## 5. Security / G2–G6

| ID | Negative case | Gate |
|---|---|---|
| S1 | Missing/bad token, forged source, Origin, tunnel ingress | Reject trước mutation; không phone-token reuse |
| S2 | Oversized/deep malformed payload, high rate, slow sending | Bounded bytes/depth/queue/time; không tác động Claude responsiveness |
| S3 | Event/header yêu cầu đọc arbitrary path, symlink/reparse race | Server resolve theo allowlist; no path returned-as-authority |
| S4 | Fake secret trong prompt/title/command/output/error | Metadata mode không lộ; opt-in content redact trước cache/SSE/replay |
| S5 | HTML/script/URI payload trong transcript và filenames | Render inert; no script execution hoặc auto-fetch artifacts |
| S6 | OMP event yêu cầu approval/kill/task/account | No command execution; capabilities server-owned |
| S7 | Cross-host plain transport trên untrusted interface; token ACL | Block unsupported setup; không tự mở firewall/LAN; secrets không log |
| S8 | Extension/API/data-root disabled và cleanup | No residual watcher/FD/timers, source dữ liệu không sửa/xóa |

Redaction không phải lời bảo đảm mọi secret đều được nhận dạng. Least-data allowlist là lớp chính; regex là lớp phụ. Không log raw bodies khi parser/handler fail.

## 6. UI / G3–G5

| ID | Scenario | Expected result |
|---|---|---|
| V1 | Claude và OMP cùng scene, OMP dùng Claude model | Nhãn harness đúng, existing stations/animations tái sử dụng |
| V2 | Same basename/name khác repo/session | Stable project/session keys; worktree vẫn phân biệt |
| V3 | Nested/parked/advisor/actor-budget overflow | Drawer giữ true tree; 3D limitation explicit; List không mất rows |
| V4 | Metadata-only vs conversation opt-in | Privacy gate cho API/drawer/tooltips/replay; disabled có lời giải thích |
| V5 | Idle/wait/stale/unknown/interrupted/terminated | Không gọi silence là completion, reason tooltip chính xác |
| V6 | Timeline parallel tools/late events/replay old/new | No merged identities/double spans; unknown không thành exact work time |
| V7 | Null metrics, cost scope, quota actions | Không NaN hoặc giả chi phí 0; không OMP controls/Claude quota leak |
| V8 | Reconnect, Low Quality/List Mode, phone, keyboard | UI usable, no duplicate/leaked workers; no unverified FPS claim |

## 7. Command groups — chỉ dùng khi được duyệt

### U: unit/lint/typecheck

Sau khi test files của phase tồn tại, dùng lệnh cụ thể trong phase. Full regression:

```bash
npm run lint
npm run typecheck
npm test
```

checkJs=false ở baseline: không suy rằng typecheck đã kiểm tra server .mjs hoặc observer .js. Unit contracts và runtime validation là bắt buộc.

### E1: isolated production build + E2E

Trước khi chạy: kiểm tra dependencies/browser đã có; thiếu thì dừng xin quyền cài, không npx tự tải package. Cấu hình E2E phải override CLAUDE_CONFIG_DIR vào fake HOME, clear inherited OMP roots/profile/token/agent-dir env, truyền explicit synthetic roots và giữ OFFICE_TRANSLATE/OFFICE_USAGE/OFFICE_CI tắt. Chỉ HOME/USERPROFILE isolation là chưa đủ khi config-dir env bên ngoài đã override.

Ví dụ lệnh trên WSL, chỉ sau khi test isolation và permission đã xác nhận:

```bash
OFFICE_DIST_DIR=.next-omp-e2e npm run build
CLAUDE_CONFIG_DIR="$PWD/test-results-omp/home/.claude" OFFICE_DIST_DIR=.next-omp-e2e E2E_OUT=test-results-omp E2E_PORT=4401 npm run test:e2e -- tests/e2e/agents.spec.ts
CLAUDE_CONFIG_DIR="$PWD/test-results-omp/home/.claude" OFFICE_DIST_DIR=.next-omp-e2e E2E_OUT=test-results-omp E2E_PORT=4401 npm run test:e2e:smoke
CLAUDE_CONFIG_DIR="$PWD/test-results-omp/home/.claude" OFFICE_DIST_DIR=.next-omp-e2e E2E_OUT=test-results-omp E2E_PORT=4401 npm run test:e2e
```

Port 4401 chỉ là ví dụ; phải kiểm tra không xung đột, không kill process chiếm port. Test off/files/hybrid dùng isolated runs với config đúng từng case, không dùng môi trường người dùng hoặc route injection production. Windows PowerShell cần cú pháp env tương ứng; không tuyên bố các lệnh POSIX chạy nguyên văn trên Windows.

### L: live OMP smoke

Requires D1/D3/D4/D6. Không có lệnh live được auto-run trong plan. Ghi exact version, activation method, payload fixture metadata và permission; không thu credentials. Model-backed prompt hoặc tạo session thật cần approval chi phí/tác dụng phụ. Không tự upgrade OMP khi API không khớp.

## 8. Performance methodology / G6

So sánh A (baseline trước thay đổi), B (code mới OMP off), C (files), D (hybrid) cùng máy/Node/build/display/quality và workload. Ghi CPU model/cores, RAM, OS/WSL/network mode, filesystem location, browser/GPU, session/event counts. Không đo demo scene rồi gọi đó là server adapter baseline.

Workloads đề xuất, tất cả cần approval riêng: 0/1/5/10 root sessions, tối đa 20 child sessions; transcript synthetic 1/10/100 MiB với cùng append rate; idle và burst 100 events/s; 500 session start/stop cycles; một client đọc chậm; reconnect và rewrite batches. Thời gian đo đề xuất: warm-up 2 phút + sample 10 phút, 3 lượt; soak 2–8 giờ tùy quyền và môi trường. Đây là thiết kế thí nghiệm, không thời gian hứa hoàn thành công việc.

Server: CPU normalized theo một core, RSS/heap, event-loop-delay percentiles, active handles/FD/watchers, read bytes và stat/open counts, pending jobs/cache bytes. Observer: callback CPU/time, queue depth/drop count, OMP latency with/without observer. Browser: p50/p95 frame duration, heap, draw calls, textures/geometries. So sánh resource slope sau cleanup thay vì chỉ một peak.

Local end-to-end latency đo từ producer emit tới UI apply bằng cùng clock domain hoặc harness marker; cross-host không lấy timestamp chênh trên hai clock chưa đồng bộ để công bố 250ms. Ghi riêng transport/reducer/UI latency khi không có clock correlation.

| Gate | PROPOSED threshold, chưa đo |
|---|---|
| P0 feature off | Zero OMP roots reads/watchers/ingress; no unexplained resource growth |
| P1 idle no viewer | Adapter mean CPU <=0,5% của một core |
| P2 memory | Delta RSS <=32 MiB idle, <=64 MiB với 10 roots +20 children theo workload cố định |
| P3 local bridge | p95 producer-to-UI <=250ms, queue không growing trong steady state |
| P4 active file | p95 nhận complete persisted entry <=2s cho file trong active watch set; không áp cho lazy/non-persisted data |
| P5 cleanup/soak | No monotonic FD/watcher growth; post-warm-up heap slope mục tiêu <=5 MiB/h, kiểm tra sau churn/GC phù hợp |
| P6 Low Quality | p95 frame cost tăng không quá 10% so cùng số actors/scene baseline |
| P7 correctness | Zero duplicate logical tool/durable usage trong replay cùng fixture/restart/reconnect matrix |
| P8 agent overhead | Đo callback/batch cost và task latency; threshold chốt sau baseline, không đặt claim 'negligible' trước |

Khi gate quá chặt/lỏng: giữ số đo, giải thích workload và đề nghị điều chỉnh; không tự đổi ngưỡng để pass. Không có baseline thì performance status UNKNOWN, không 'improved'.

## 9. Evidence record mẫu

Mỗi gate ghi: command/tool, source revision, mode/platform, fixture/workload, approval scope, start/end/actual duration, exit code, assertions/samples, pass/fail/blocked/not-run, limitations. Không ghi raw prompts/credentials. Baseline lỗi và regression mới phải phân biệt. Test code không tự sửa expectation nhằm biến fail thành pass.

## 10. Phase 01 permission manifest

Cập nhật 31/10/2026 từ yêu cầu `ak:cook .../phase-01-start.md`. Đây là **bản ghi quyền**, không phải file cấu hình được ứng dụng nạp. Chỉ documentation work đã được duyệt. Viết specification không có nghĩa là đã tạo/running fixtures. Chi tiết blockers ở [compatibility decision](./reports/compatibility-decision.md).

```yaml
scope: phase-01-documentation-only
repositoryRoot: /mnt/e/vide-code/my-office
sourceHead: 0ff1e84e2a96325edfc8fce751cc0ffe4248451f
planDirectory: plans/261030-1754-omp-multi-agent-integration
allowedWrites:
  - design-contracts.md
  - validation-matrix.md
  - evidence.md
  - reports/plan-review.md
  - reports/compatibility-decision.md
approvedLiveSessionRoots: []
approvedProfileIds: []
approvedProjectRootMappings: []
approvedInstalledOmpBuilds: []
approvedConversationRead: false
approvedRuntimeActivation: false
approvedExtensionInstall: false
approvedSourceEdits: false
approvedApplicationTests: false
approvedBuildOrAppStart: false
approvedBenchmarks: false
approvedPackageOrBrowserInstall: false
approvedNetworkConfigurationChanges: false
approvedCommitOrPush: false
```

Các allowedWrites tính từ planDirectory, không bao gồm plan.md hoặc phase files. Không dùng `ak plan check/update/use/reindex` để sửa state/index ngoài scope này. Execution state ghi trong hai reports; không đánh dấu phase completed khi G1 chưa pass.

| Nhóm | Quyền phiên Phase 01 | Điều kiện trước khi được chạy ở phase sau |
|---|---|---|
| D: document/baseline validation | APPROVED: workspace/root, bounded repo/instruction reads, public pinned source GET, Git read-only/hash, `ak plan validate`, consistency/link checks không chạy app | Không đọc secrets/transcripts hoặc ghi ngoài allowlist |
| U: unit/lint/typecheck | NOT APPROVED / NOT RUN | Approval nhóm U; inspect test discovery/imports; deterministic synthetic fixtures, fake clock/fs, không network/model/agent-data, không import server startup |
| E1: E2E | NOT APPROVED / NOT RUN | Approval riêng; existing dependencies/browser; isolated HOME/USERPROFILE/OFFICE_DATA_DIR/CLAUDE_CONFIG_DIR; clear inherited OMP overrides; explicit synthetic roots; outbound disabled; port không xung đột |
| B: build/app/smoke | NOT APPROVED / NOT RUN | Approval riêng cho output dirs/startup/listener; build có thể có side effects khác unit; không dùng production user data |
| P: performance/soak | NOT APPROVED / NOT RUN | Approved workload/duration/resource budget; baseline trước thay đổi và cùng môi trường; không claim hiệu năng khi chưa đo |
| L: live OMP | NOT APPROVED / NOT RUN | D1–D4 và từng quyền đọc/activation cụ thể; D6 cho extension; model request/cost cần approval riêng |
| I: install/config/network/publish | NOT APPROVED / NOT RUN | Approval action-specific; không gộp vào test/build/source approval |

## 11. Synthetic fixture specification v1

**Status: SPECIFIED ONLY. Không có test/fixture source nào được tạo hoặc chạy trong Phase 01.**

Schema candidate: OMP source `6a86df8539fccf3ad7818081266e554022fc21bc`, package `18.14.0`, session schema `3`. Candidate không phải installed-version allowlist. Fixtures legacy v1/v2 và unknown major chỉ là rejection/degraded cases cho đến khi source/call-path tương ứng được chứng minh và support được duyệt.

Mỗi fixture manifest tương lai cần: `fixtureId`, `schemaPin`, `candidatePackageVersion`, `evidenceIds`, `sourceNamespace`, input record sequence, chunk/rewrite schedule, fake clock, quota parameters, expected normalized projection, expected diagnostics, forbidden side effects và assertion IDs. Chỉ dùng tên/IDs/text giả; không sanitize transcript cá nhân để thay cho synthetic generation.

Source namespaces giả `fixture-wsl-a`/`fixture-win-b`, session IDs `session-a`/`session-b`, child `child-0`, runtime `runtime-a`/`runtime-b`, generations 1/2. Windows path `C:\synthetic\repo-a` và POSIX `/fixture/projects/repo-a` chỉ là string inputs cho mapping tests; không mở các đường dẫn đó trên máy thật. Thư mục fixture thật sau này phải là temporary root do test tạo và được phê duyệt, không suy từ các string này.

| Fixture | Input/sequence cụ thể cần tạo | Expected assertions | Coverage |
|---|---|---|---|
| SF01 schema/title | v3 header; cùng header có title slot đủ 256 UTF-8 bytes; title chứa ký tự nhiều byte; v1/v2/999; header-only | v3 với/không slot cùng logical session; title không leak metadata; unsupported versions degraded rõ; không ghost live; byte count khác character count | F1/F2/S4, O1/O10 |
| SF02 framing | Một record chia ở từng byte, kể cả giữa ký tự tiếng Việt và giữa CR/LF; final line chưa newline rồi append newline | Emit đúng 1 complete record; offset chỉ commit qua newline; không mất/nhân byte hoặc parse fragment | F3 |
| SF03 bounded malformed | Valid → malformed → oversized > configured L → valid; oversized line kéo dài nhiều chunk chưa newline | Bounded pending bytes; drain tới delimiter; record sau vẫn đọc được; diagnostic bounded; không busy loop | F4/S2 |
| SF04 replacement/rewrite | Append; truncate; replace same path; title same-size update; sửa middle record rồi append; restart checkpoint cũ | Epoch/watermark rebuild hoặc reconcile đúng; ledger thay thế, không cộng lại; mọi handles được đóng; giới hạn size/mtime detection được ghi | F5/F6/U3 |
| SF05 active branch | e1 → e2; e3 là nhánh khác từ e1; e4 late usage có activeLeafId=e2. Các biến thể e4 field missing/null/e999; cycle/missing parent | e2 / e4 / null / newest self-selected e3 theo helper ở pin; branch traversal không nối nhầm; dữ liệu thiếu/cycle hiện incomplete | F7, O11 |
| SF06 fork/cost | Parent có recorded 5; fork copy 5 rồi phát sinh 2. Case khác parent self 2 và delegated child 3, child cũng báo 3 | Fork recorded 7 có inherited flag, không tổng 5+7 thành spend mới; nếu attribution không đủ thì owned/subtree unknown. Case đầy đủ subtree=5, không 8 | F8/U2/U5 |
| SF07 namespace/group | Hai sources cùng sid/name/child-0/basename; hai worktrees cùng repo; alias cross-host absent/present | Keys tách biệt nếu không approved mapping; cùng repo vẫn giữ worktree identity; không dùng display label làm join key | C4/V2/D8 |
| SF08 children | kind=main depth=0; kind=sub depth=1; kind=sub depth=0 parent=Main; advisor tool interception only; parked/tombstone artifacts | depth=0 không biến child thành main; entry.parentId không thành parent agent; advisor lifecycle unknown; parked files không tự live | F9/R8/V3/D9 |
| SF09 roots/errors | Header/event chứa ../escape, absolute outside path, previousSessionFiles, seanceSource; fake symlink/junction/UNC; root ENOENT/EACCES/EIO | Không mở ngoài canonical approved root; denied/open counts cụ thể; root missing khác permission error; không write nguồn | F10/F11/S3 |
| SF10 privacy poison | Sentinel `SYNTHETIC_PRIVATE` trong prompt/title/command/output/reason/runtime.label/cache keys/credential_pin.hash/unknown nested fields | Sentinel và raw field bị cấm không có ở projection/SSE/log/cache/replay/error; không external fetch/translation; chỉ metadata allowlist tồn tại | C7/S4/S5/S9/V4, O17 |
| SF11 tools/order | Hai toolCallId chạy song song; tool_call.input khác execution.args sau revision; end trước start, duplicate end và delayed start | Pending set độc lập; không coi tool_call là execution start; terminal không trở lại running; args không leak; total tool không double-count | R2/U3/V6, O12/O13 |
| SF12 approval | required+UI allow/deny; required+no UI; non-required không event; lost resolved rồi heartbeat expiry; observer network promise không settle | Chỉ event có evidence tạo approval wait; no-UI resolved false đúng synthetic branch; silence không tự tạo wait; expiry stale; callback không chờ network hoặc trả control mutation | R3/R5/R11/S6 |
| SF13 activation | Hai activations cùng writer build stamp; session switch g1→g2; late shutdown g1; resume sau persisted exit; same sid hai runtimes | Build stamp không là runtime identity; g1 không đóng g2; conflict hai live runtimes explicit; old file exit không terminate resume | F8/F13/R1/R12 |
| SF14 nullable usage | Raw usage absent; explicit measured 0; partial tokens/missing cost; invalid numeric fields; normalized snapshot mất provenance; contextWindow thiếu; model_usage cùng assistant | Unknown/null khác observed 0; không Claude ctxMax fallback; không tự cộng snapshot normalized vào durable ledger; model_usage là usage record, không chat turn | U1/U4/U6/C7/V7, O16 |
| SF15 reconciliation | Bridge trước file; same logical tool/message materialize; reconnect duplicate seq; gap; server crash sau ACK trước checkpoint | Một logical record; provisional được replace; source sequence/generation tách; fresh snapshot/file recovery + gap marker, không exactly-once claim | R6/R7/R9/U3 |
| SF16 quotas/dispose | N files/sessions vượt từng configured cap; overlap scan; slow client; stop/dispose giữa read; churn bằng fake clock | Job/FD/byte/cache caps có assertions; cleanup hết watcher/timer của adapter; truncated/degraded observable; đây không phải CPU/RAM benchmark | F12/R6/S2/S8 |
| SF17 compatibility off | OFFICE_OMP off/unset với config lỗi; crafted OMP IDs vào Claude tasks/account/open; null metrics; legacy replay không fields mới | Zero OMP I/O/timers/ingress; server deny controls; không fallback Claude quota; legacy behavior giữ nguyên; không NaN | C1–C7/S6/V1/V7 |

### Assertion IDs bổ sung

Các IDs sau mở rộng các bảng 2–5, không thay expectation cũ:

| ID | Invariant cần test |
|---|---|
| F13 | Writer build stamp missing/invalid/reused không là liveness, process ID hoặc runtime generation |
| U5 | Parent delegated cost + child records không cộng hai lần; inherited fork history không thành new spend |
| U6 | Missing raw usage khác measured 0; snapshot đã normalize cần provenance; unknown context/cost không nhận default Claude |
| R11 | Callback observer bounded, không await network; không trả block/input/result mutation hoặc gọi approval/control API |
| R12 | Same build khác activations; late callback/exit thuộc generation cũ không mutate generation mới |
| S9 | Cache keys, credential hashes, source path pointers và arbitrary labels không vào public metadata; unknown field default drop |

Read-only assertion phải quan sát filesystem API usage, không chỉ so hash: adapter không gọi write/append/rename/unlink/migrate lên source root; fixture producer là tác nhân duy nhất mutate fixtures. Đếm reads/open ngoài allowlist phải bằng 0. Test cũng chặn fetch/spawn/exec để detect outbound/process side effects. Không read credentials để dựng sentinel.

## 12. Acceptance evidence và G1 status

G1 hiện **BLOCKED**, dù specification đã có. D1/D2 chưa đủ dữ liệu, D3/D4/D7–D9 chưa được người dùng chốt; không có approval synthetic-only source implementation để waive live decisions. Static source candidate không thay live validation R10. Quyền U/E1/B/P/L/I vẫn chưa cấp.

G3 phải chứng minh persisted-only data đúng F1–F13/U1–U6/SF01–SF17 liên quan và Claude regression, đồng thời giữ live state unknown khi chỉ có file. G4/G5 cần thêm R1–R12, actual build/mode callback evidence, privacy/control negative cases và UI mixed-agent coverage. Không suy supported runtime từ fixture giả hoặc type declaration.

Trong Phase 01 chỉ kiểm tra tài liệu, hash/baseline và format plan. Kết quả thực thi của các checks nằm ở [execution log](./reports/plan-review.md); tất cả application tests, build, live smoke và performance vẫn **NOT RUN**.

**Cập nhật 31/10/2026 (Windows native) — G2 vẫn OPEN, chờ quyết định điều kiện nghiệm thu.** Hai timeout Claude là lỗi môi trường có sẵn từ HEAD sạch: Chromium mặc định dùng SwiftShader nên mỗi frame chặn main thread ~3 s; có GPU thì panels PASS 10/10, session drawer còn cold start 31–35 s so với budget 20 s (3/10 FAIL). Không đổi source. Chi tiết, số liệu và đề xuất: [Windows-native diagnosis](./reports/phase-02-g2-windows-native-diagnosis.md). Lịch sử các lượt trước giữ nguyên.

