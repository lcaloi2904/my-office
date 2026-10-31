# Design contracts và decision register

## 1. Trạng thái và nguyên tắc

Đây là thiết kế mục tiêu; các phần chưa triển khai vẫn **PROPOSED**, không phải API đã tồn tại. Cập nhật 31/10/2026: người dùng đã phê duyệt Phase 02 synthetic-only và unit/lint/typecheck; bốn module schema/registry/projection/Claude facade, source guards và test files đã được tạo. Chi tiết source facts và giới hạn ở [Phase 02 implementation](./reports/phase-02-implementation.md). OMP decoder/store/bridge/extension chưa tồn tại; không có live activation.

[Lịch sử Phase 02 — đã lỗi thời từ Phase 03/04: `files` và `hybrid` hiện có adapter; hybrid thêm ingress loopback, xem Phase 04 report.] Production chỉ đăng ký Claude. `OFFICE_OMP` được parse, nhưng `files`/`hybrid` vẫn effective off với diagnostic `adapter-not-implemented`; config/roots không được đọc. Claude `sessionKey` hiện là compatibility key theo public ID cũ, chưa phải durable source key qua restart. OMP opaque identity đã có cho synthetic records. Không suy các điểm này thành full contract completion.

G1 live vẫn BLOCKED; G2 còn verification gap (lint/typecheck thiếu dependencies, build/E2E chưa chạy). Các permission/decision records của lượt Phase 01 ở mục 10 là lịch sử; approval mới chỉ mở source synthetic + nhóm U, không mở roots/privacy dữ liệu thật, install hoặc các phase sau.

Giữ nguyên Claude ingress/store/controls. OMP có private store, decoder, usage và lifecycle riêng; lớp tổng hợp chỉ nhận projection đã lọc. Không chuyển OMP thành `hook_event_name` của Claude. Không đưa OMP vào `sessions`/`sidToKey` cũ để tránh vòng scan/timeout/account hoạt động nhầm. Module mới dùng Node built-ins và plain ESM; không thêm framework, message broker hay database dependency nếu chưa chứng minh cần thiết.

## 2. Luồng dữ liệu mục tiêu

```text
Claude hooks + registry + usage (giữ nguyên)
    -> Claude compatibility facade ----------------------+
                                                          |
OMP approved roots -> incremental parser -> OMP store ----+-> common projection
OMP observer extension -> bounded authenticated ingress --+       |
                                                                 +-> snap/SSE/long-poll
                                                                 +-> redacted replay/timeline
                                                                 +-> API log + existing UI
```

Bridge events đi qua cùng OMP reducer, không broadcast trực tiếp raw payload. File là nguồn durable; runtime là nguồn activity tức thời. Backfill không gọi animation/chat/trophy hoặc tăng daily counters như một sự kiện mới. Basic provider labels và control gating phải xong ở Phase 2, trước lần phát OMP session đầu tiên.

## 3. Module boundaries

| Module đề xuất | Trách nhiệm | Không được làm |
|---|---|---|
| `server/agents/schema.mjs` | Runtime validation, safe identifiers, capabilities và public fields | Tin payload là trusted object |
| `server/agents/registry.mjs` | Facade đăng ký adapter, resolve session, union snapshots, dispose | Biết tool/storage schema của OMP |
| `server/agents/projection.mjs` | Giữ protocol cũ, bổ sung fields/counters và safe activity mapping | Gọi Claude account functions cho OMP |
| `server/agents/claude/compat.mjs` | Bọc callback/lookup hiện có, không di chuyển business logic | Refactor lớn hoặc đổi Claude hooks |
| `server/agents/omp/index.mjs` | Điều phối lifecycle, bounded store, cleanup, feature flag | Khởi tạo OMP SDK/process |
| `server/agents/omp/paths.mjs` | Approved roots, path-style mapping, containment | Auto-open path từ event hoặc header |
| `server/agents/omp/reader.mjs` | Incremental JSONL, epoch/rewrite recovery, file handles | Migrate/write source transcript |
| `server/agents/omp/normalize.mjs` | Versioned entry/tool normalization, conversation projection | Tự kết luận liveness từ mtime |
| `server/agents/omp/usage.mjs` | Scope/provenance, replace-on-reconcile usage ledger | Dùng Claude price table/ctxMax |
| `server/agents/omp/bridge.mjs` | Auth, limits, ordering, reconnect, per-source sequencing | Approval/control channel |
| `integrations/omp/office-observer.js` | Observer factory trong OMP runtime; enqueue nhanh, cleanup | Block agent để đợi network hoặc sửa agent state |

Không cần một class cho mỗi file. Facade tối thiểu là list/resolve/readConversation/start/dispose; các method nhận dependencies qua injection để test mà không import `server/index.mjs` và khởi động server.

## 4. Identity và public schema v1

`agentKind` là harness (`claude`, `omp`), độc lập `modelProvider` và `model`. OMP dùng Claude model vẫn mang nhãn OMP.

| Field | Quy tắc |
|---|---|
| `sessionKey` | Opaque stable ID từ tuple `(agentKind, sourceNamespace, sourceSessionId)`; sourceNamespace phân biệt host/profile/root và được cấu hình ổn định |
| `id` | Claude giữ ID cũ; OMP dùng deterministic public ID để restart không tạo actor trùng |
| `runtimeInstanceId`, `generation` | Tách một lần process/session activation khỏi identity hội thoại; không dùng PID làm global ID |
| `parentAgentKey`, `rootSessionKey` | Namespace theo root/source; không dùng entry.parentId làm parent agent |
| `relationKind` | `subagent`, `fork`, `continuation`, `advisor`, `unknown` theo bằng chứng; không nhập nhằng lineage |
| `projectKey`, `worktreeKey` | Canonical approved mapped root + source namespace; basename chỉ là display name |
| `lifecycle`, `activity`, `connection`, `lastTurnOutcome` | Bốn trục khác nhau, không ép toàn bộ vào work/wait/rest |
| `observedAt`, `occurredAt`, `source`, `confidence` | Thời điểm server nhận khác thời điểm producer; clock skew không tự đổi ordering |
| `capabilities` | Giá trị server tính; OMP controls mặc định false, producer không tự bật |
| `metrics` | Structured additive token/cost/context nullable, có scope và provenance; unknown không phải zero |
| `usage` | Legacy shape được giữ cho Claude; OMP để null nếu chưa đáp ứng đầy đủ numeric contract, không lấp unknown bằng 0 |

Các OMP UI consumers mới đọc `metrics`; renderer cũ không được nhận một `usage` object chỉ đầy một phần rồi tính ctx/ctxMax. Lifetime cost/inherited history không được chiếu thành day cost hoặc Claude account quota. Tên `metrics` là contract mới đề xuất, cần G1 khóa trước implementation.

Compatibility alias: canonical `agentKind` có thể chiếu sang `s.agent` cho existing `agentOf()`; `e.agent` trong legacy event vẫn là subagent ID, tuyệt đối không dùng trường đó làm harness label. Alias không thay stable identity hoặc capabilities.

Raw cwd/path/runtime credentials không cần lộ trong SSE. Backend giữ `cwdOriginal`/`cwdMapped` riêng; frontend chỉ nhận display-safe path và projectKey. Các URI/key encoding không được gây delimiter collision trong legacy timeline.

Nếu có hai live runtimes cùng sessionId, không silently last-writer-wins: phát diagnostic conflict và tách runtime occupancy; giữ một logical conversation với active instance rõ ràng. File copy vào root khác không tự gộp xuyên source namespace; chỉ merge theo cấu hình được duyệt.

## 5. Lifecycle và độ chắc chắn

| Evidence | State hợp lệ | Không được suy ra |
|---|---|---|
| File cũ có header/message | Historical/discovered, live unknown | Process đang chạy |
| File mới tăng | Persisted recent activity | Thinking/tool vẫn chạy hiện tại |
| Runtime start/snapshot + heartbeat | Open/connected; activity theo event/snapshot | Session chắc chắn complete khi agent_end |
| Tool execution start/end | Pending tool set theo toolCallId | Boolean inTool duy nhất đủ cho parallel tools |
| Approval requested/resolved | Waiting reason=approval theo request/tool ID | Cho phép remote approve |
| ask/question | Waiting chỉ khi event/input contract xác minh | Silence luôn là waiting-user |
| Turn end | Outcome của lượt; xét jobs/pending messages | Process terminated hoặc tất cả jobs settled |
| Heartbeat hết hạn | Stale/disconnected | Completed/terminated |
| session_exit/shutdown | Kết thúc runtime generation nếu còn phù hợp | Resume sau này bị đóng bởi exit record cũ |

Legacy projection: active -> work, waiting -> wait, idle -> rest. Unknown/stale có badge riêng, không dùng nhãn 'vừa xong'. Historical sessions không tự xuất hiện hàng loạt trong live scene; có recent/history view hoặc lựa chọn pin với nhãn persisted-only. Timeline không tính khoảng unknown thành work/turn duration chính xác.

## 6. Idempotence và authority

Bridge dùng delivery có thể lặp lại + reducer idempotent; không hứa exactly-once. Mỗi source có instance/generation/sequence, ACK high-watermark, bounded reorder buffer và gap signal. Client reconnect nhận snapshot mới; không giả sử SSE cũ hỗ trợ Last-Event-ID resume.

File record identity theo session + entryId. Tool logical record theo session/runtime + toolCallId + phase. File entry và bridge event về cùng tool được merge; error/end không quay lại running khi start cũ đến muộn. Event không có reliable cross-source key không dedupe bằng timestamp/text hash như một chân lý: để runtime-only volatile hoặc file-only durable, không cộng cả hai vào persistent totals.

Đối với message/usage, durable file là authority mặc định. Bridge usage là snapshot/provisional, không cộng dồn thêm vào file totals. Trong memory-only session bridge có thể giữ usage runtime với nhãn volatile. Khi file materialize, replace projection có reconciliation, không append duplicate. Rewrite epoch rebuild ledger của session rồi thay thế atomically; không chỉ cộng lại counts. Checkpoint restart và aggregate commit phải có cùng epoch/watermark hoặc discard cache và rebuild; cache là disposable, nguồn agent không bị sửa.

Replay của My Office dùng `observedAt` và có provenance. Historical backfill không ghi `ev` như live vừa xảy ra. Conversation vẫn giữ source timestamps riêng; timeline hồi dựng từ file chỉ được coi chính xác ở mức evidence đã persist.

## 7. File reader và limits

Mở `r`, đóng handle trong finally; chống overlap mỗi file/source. Giữ byte offset tới newline hoàn chỉnh, UTF-8 decoder/pending bytes, file identity và epoch. Bỏ qua malformed complete line kèm diagnostic; incomplete final line giữ lại. Line quá lớn phải drain tới newline có giới hạn, không loop vô tận hoặc parse fragment thành record.

Phân biệt append, size giảm, inode/file identity đổi, size bằng nhưng mtime đổi, title-slot update và known OMP rewrites. Prefix/tail fingerprint không chứng minh phần giữa file không đổi. Khi signal ambiguous, bounded full reparse của file đó; có reconciliation định kỳ cho known rewrite workflows. Không hứa phát hiện tức thời mọi sửa tay cố giữ nguyên size/mtime. Test cả rewrite+append, không chỉ truncate.

Discovery shallow trước, child artifacts theo demand/bounded traversal; debounce watcher, stat reconciliation là fallback. Roots lỗi quyền là degraded/error, không coi thành 'không có sessions'. Có LRU/TTL cho cursors, session summaries, dedupe và tree indexes; quotas theo bytes lẫn count. Full tree/conversation dựng on-demand có giới hạn; khi cap bị chạm phải báo truncated/unsupported, không silently sai branch. Không dereference blobs/artifacts/previousSessionFiles ngoài allowlist.

## 8. Config và privacy đề xuất

`OFFICE_OMP=off|files|hybrid` (default `off`) và `OFFICE_OMP_CONFIG=<approved absolute path>` là tên mới đề xuất. Config versioned chứa source ID, source host/platform, session roots, project-root mappings, giới hạn và privacy mode; không tự discover credentials hoặc scan home. `off` thắng mọi config khác: zero OMP reads/watchers/ingress.

Metadata mode: ID, trạng thái, tool category, sanitized basename, model, timestamps, numeric usage. Không gửi prompt, full command, tool output hoặc arbitrary title. Conversation là opt-in riêng, đọc theo yêu cầu, redact và cap; không copy toàn transcript vào replay/cache. Không external translation, screenshots, outbound CI checks hoặc images cho OMP mặc định. Mixed replay lấy metadata-only OMP, giữ hành vi Claude đã có. Thay privacy không thể xóa dữ liệu đã phát trước đó; cần retention policy cho dữ liệu của My Office, không xóa nguồn agent.

Native profiles/XDG/custom session dirs là inputs được cấu hình, không bắt buộc tự tái hiện mọi lookup của OMP. Version allowlist được ghi ở G1; unknown version degrade có chẩn đoán, không crash Claude. Entry unknown nằm trong schema đã hỗ trợ có thể skip; schema major unknown không được tự parse rồi gán trạng thái chắc chắn.

## 9. Ingress và ranh giới Windows–WSL

Endpoint đề xuất `POST /ingest/omp/v1` chỉ có trong hybrid. Reject browser Origin, tunnel traffic, unauthenticated requests, oversize/rate overflow trước parse. Dedicated source-bound bearer token trong header, không dùng phone PIN/token hoặc URL query. Token tại private runtime storage ngoài source control; POSIX 0600, Windows ACL cần xác minh riêng. Không echo/log token hoặc raw producer body; dùng numeric/error-code diagnostics.

Default chỉ loopback. Cross-host NAT cần transport/config phê duyệt riêng; không sửa `.wslconfig`, firewall, listener của Claude hoặc bind public để tiện. Traffic đi qua LAN/untrusted interface cần TLS hoặc tunnel đã duyệt, bearer token trên plain HTTP không được coi an toàn ngoài loopback. Snapshot/auth là telemetry-only, không nhận command replies. Authenticated producer cũng không có quyền đọc path bất kỳ.

Path mapping giữ nguyên source spelling và normalize bằng path.win32/path.posix đúng nguồn; canonicalize ở host đọc, kiểm tra containment theo segment và thực tế file, kiểm tra symlink/reparse-point. Không tự dùng UNC path do event gửi. Không dùng Windows PID trong WSL process probes hoặc ngược lại. Repository grouping chỉ hợp nhất cross-host khi mapping explicit chứng minh cùng root; worktree identity không bị mất.

## 10. Decision register — cập nhật Phase 01 ngày 31/10/2026

Người dùng đã yêu cầu `ak:cook` với `phase-01-start.md`: **chỉ Phase 01 documentation được phê duyệt**. Không suy rộng thành approval Phase 02, live roots, application tests hoặc extension install. Kết quả hiện tại: **G1 BLOCKED**, không phải integration đã triển khai. Xem [compatibility decision](./reports/compatibility-decision.md) và [permission/fixture specification](./validation-matrix.md#10-phase-01-permission-manifest).

| ID | Quyết định | Evidence / contract đề nghị | Gate / trạng thái hiện tại |
|---|---|---|---|
| D1 | Version/build OMP thực tế (31/10: `omp --version` = 18.14.1, đã cài ở máy này) | Public source pin `6a86df8539fccf3ad7818081266e554022fc21bc` có package version `18.14.0`, schema `3`; không phải version binary của người dùng. Chưa có metadata path được phép để xác minh bản cài | G1 BLOCKED: installed version/build UNKNOWN |
| D2 | OMP chạy Windows, WSL hay cả hai | My Office root và Cloud Harness Linux/WSL đã xác nhận; môi trường Windows 11 + WSL2 do người dùng cung cấp. Không suy ra host/profile của OMP | G1 BLOCKED: OMP topology UNKNOWN |
| D3 | Approved roots/profiles/path mappings | Allowlist thực tế vẫn rỗng; cần source ID, host/profile, root tuyệt đối và mapping cụ thể. Path trong fixture là chuỗi giả, không phải quyền đọc | G1 BLOCKED: NEEDS APPROVAL |
| D4 | Privacy | Metadata allowlist; conversation opt-in riêng; không arbitrary title, prompt, args/output, credential/cache identity hoặc outbound translation. Mới là thiết kế, chưa bật đọc dữ liệu | G1 PROPOSED / NEEDS APPROVAL |
| D5 | Validation permissions | Được kiểm tra docs, Git baseline/hash và `ak plan validate` read-only. Unit/lint/typecheck, E2E, build/app, benchmark và live OMP chưa được duyệt trong phiên này | DOC CHECKS APPROVED; từng nhóm execution khác BLOCKED |
| D6 | Companion extension deployment | Source tương lai trong repo; copy/install, sửa config và activation ngoài repo cần approval riêng | Trước live Phase 4 NEEDS APPROVAL |
| D7 | Cost scope/forks | Per-session recorded estimate có provenance; phân biệt inherited history, self cost và delegated child cost. Không cộng parent roll-up với child lần nữa; không grand total khi thiếu attribution | G1 PROPOSED; U2/U5/U6 là acceptance, chưa chạy |
| D8 | Worktree grouping | Namespace + canonical approved mapping; group repository chỉ khi có bằng chứng cùng repo, giữ worktree identity riêng. Không merge theo basename/cwd do producer tự khai | G1 PROPOSED; C4/V2/F11 là acceptance |
| D9 | Các loại agent | Task children là ứng viên milestone đầu; eval/nested và `/tan` cần matrix riêng. `kind`, không phải `depth`, phân loại subagent; advisor chỉ nhận phạm vi evidence thực có | G1/4 PROPOSED; support runtime vẫn UNVERIFIED |
| D10 | Cross-host transport | Chưa kiểm tra NAT/mirrored/network mode; không đổi bind/firewall/WSL config hoặc dùng bearer qua plain untrusted network | G6 BLOCKED / NEEDS EVIDENCE |

Không trả lời thay người dùng các quyết định quyền đọc, privacy hay network. Approval hiện có đủ để **viết synthetic fixture specification**, không đủ để tạo fixtures/test code, chạy synthetic tests hoặc bật file observer. Không coi nhánh synthetic-only trong G1 là waiver tự động cho Phase 02.

## 11. Compatibility refinements từ source pin

Các refinement dưới đây là contract đề nghị cho implementation sau này; không sửa source trong Phase 01. Bằng chứng và hạn chế được ghi theo O9–O17 trong [evidence](./evidence.md).

### Build identity khác activation identity

`SessionEntryBase.runtime` ghi build đã tạo entry: version và các trường commit/branch/diff/label tùy loại bản cài. Không có invariant rằng một build stamp là một process hoặc một activation. Giữ `runtimeInstanceId`/`generation` của bridge độc lập; không dùng `runtime.version`, file mtime, PID hoặc `runtime.label` để dedupe hai runtimes. Fork/copy giữ writer stamp cũ không chứng minh phiên fork đang chạy cùng build. Thiếu stamp hoặc stamp không hợp lệ phải là unknown (F13/R12).

### Leaf và optional title slot

Ở pin này, `sessionEntryLeafId` dùng `activeLeafId` khi field khác undefined, kể cả null; `resolveSessionLeafId` có fallback về entry mới nhất tự chọn chính nó khi captured leaf không còn tồn tại. Fixture phải tách missing/undefined, explicit null, existing leaf và dangling leaf. Không mặc định last physical entry luôn là current leaf. Full conversation vẫn cần xử lý cycle/missing-parent/compaction và đánh dấu incomplete nếu chưa tái dựng được (F7).

`parseSessionContent` strip/fold optional title slot trước header; title slot 256 byte là byte count, không phải character count. Không lấy parser/loader của OMP làm dependency runtime: source loader có migration/blob/accounting behavior không phải contract read-only metadata của My Office. Known valid source format ngoài decoder đã hỗ trợ phải degraded rõ, không silently sai.

### Event coverage và callback boundary

Source pin khai báo `tool_execution_start/update/end` với `args`/`partialResult`/`result`, trong khi `tool_call` dùng `input` đã qua normalization. Không nhập hai shapes thành một schema bằng cast hoặc suy `tool_call` luôn là execution start.

`ExtensionToolWrapper.execute` chỉ phát approval notifications khi nhánh approval thật sự required và có handler phù hợp; các emit trong nhánh này được await. Observer callback chỉ validate/project/enqueue bounded và trả về ngay; không await HTTP, không trả result sửa tool/input/block, không gọi controls. Mất `resolved` hoặc mất heartbeat dẫn tới stale/unknown, không tự approve/deny hay completed. Chưa có emission proof đầy đủ cho execution/switch/shutdown ở bản cài thực tế: các event đó không được ghi là supported live chỉ vì type tồn tại (R3/R10/R11).

### Privacy và usage provenance

Metadata projection dùng allowlist, không spread nguyên header/entry/event. Loại khỏi public projection/cache/replay/diagnostic: `providerPromptCacheKey`, `taskPromptCacheKey`, `credential_pin.hash`, `seanceSource`, `previousSessionFiles`, arbitrary runtime label/title, `reason`, args/output và các unknown fields. Path lineage chỉ là dữ liệu không tin cậy, không phải quyền mở file. Hash định danh credential vẫn có thể liên kết người dùng; không coi đã hash là metadata an toàn (S4/S9).

Source `normalizeAssistantUsage` có thể điền thiếu thành 0. Adapter phải phân biệt giá trị raw thực có với giá trị được runtime chuẩn hóa; không import helper đó rồi gọi zero là observed. Nếu chỉ có snapshot đã normalize mà thiếu provenance, giữ field không chứng minh được ở trạng thái unknown/provisional. `UsageStatistics.subagentCost` được khai báo là chi phí direct children nằm trong cost; chưa có bằng chứng aggregation ở bản cài, nên không cộng snapshot đó với child totals theo mặc định (U1/U5/U6).

### Grouping và child identity

`ExtensionAgentIdentity.kind` phân biệt main/sub; `depth=0` cũng có thể là subagent. Registry `parentId` không phải transcript `entry.parentId`. `sourceNamespace` phải bao gồm nguồn host/profile đã duyệt; ID advisor hoặc child giống nhau giữa hai roots vẫn khác identity. Advisor qua shared wrapper không chứng minh có lifecycle và execution stream đầy đủ độc lập. Unknown relations giữ `relationKind=unknown`, không tự dựng parent từ name, path hoặc indentation.

## 12. Milestone acceptance boundary

| Milestone | Acceptance cần chứng minh sau approval | Không được quảng cáo |
|---|---|---|
| G3: file-only persisted observability | Supported pinned schema; current branch/history đúng hoặc incomplete rõ; idempotent incremental/rewrite recovery; source không bị write; metadata privacy; raw usage provenance; Claude compatibility | Process liveness, exact current thinking/tool/wait state, realtime approvals hoặc memory-only sessions từ file |
| G4/G5: hybrid live observability | Bản OMP thực tế đã khóa; verified callback/mode matrix; fresh runtime snapshot + generation; bounded non-blocking observer; auth/order/reconnect/reconciliation; mixed-agent UI và controls isolation | Exactly-once delivery, zero event loss sau ACK, full child/mode coverage chỉ từ fake runtime, hoặc stale đồng nghĩa terminated |

G3 là milestone hữu ích độc lập, nhưng không bỏ qua G1/G2. G4/G5 không đạt chỉ vì unit mock pass; cần R10 trên đúng build/mode được người dùng duyệt. Toàn bộ acceptance ở đây là specification, **NOT RUN**.
