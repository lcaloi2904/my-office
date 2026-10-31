# Phase 04 — implementation report (31/10/2026)

**Kết quả: code + kiểm thử synthetic xong, smoke OMP thật 18.14.1 (print + rpc) và observer đã cài vĩnh viễn; G4 CHƯA đóng** (R10 còn thiếu plan review/interactive/subagent/`ask`; S7 cross-host và ACL token trên Windows chưa chạy).

## Phạm vi đã làm

Theo `/ak:cook phase 4`: chỉ source trong repo + kiểm thử synthetic/unit + một smoke server riêng. Ban đầu chỉ synthetic; sau khi người dùng duyệt D6 đã chạy OMP thật và cài observer (xem các mục smoke). Không cross-host, không commit/push.

| Thành phần | File |
|---|---|
| Lifecycle runtime (instance/generation/sequence, pending tools, wait reasons, stale/disconnected theo giờ server) | `server/agents/omp/lifecycle.mjs` |
| Allowlist event live v1 + usage provisional | `normalize.mjs` (`normalizeOmpLiveEvent`), `usage.mjs` (`provisionalUsage`) |
| Ingress: bearer theo source, loopback, no Origin/tunnel, giới hạn byte/event/thời gian/tốc độ, ACK sau khi apply | `server/agents/omp/bridge.mjs` |
| Một actor cho file + live; usage ghi nhận của file thay snapshot provisional | `server/agents/omp/index.mjs` (`live`, `recordOf`), `projection.mjs` |
| Route `/ingest/omp/v1`, mode `hybrid`, snapshot không gửi OMP cho remote | `server/index.mjs` |
| Observer factory (queue giới hạn, backoff+jitter, cleanup, không await) | `integrations/omp/office-observer.js`, `README.md` |
| Doc kiến trúc | `docs/ARCHITECTURE.md` |

Sửa lỗi trong bản nháp lifecycle từ phiên trước (phát hiện bằng test mới): `turn_end` đếm cả tool đã xong nên session kẹt "active"; `tool_end` trùng ghi đè `error`; generation mới cùng instance bị coi là conflict; heartbeat idle không dọn tool mất `end`.

## Bằng chứng

- `omp-lifecycle` 14, `omp-bridge` 10, `omp-live-merge` 6, `omp-observer` 10 test mới, gắn nhãn R1–R12/S1–S8.
- Cập nhật 3 test source-guard cũ của `agent-compat` (hybrid không còn "not implemented") + 1 test mới cho route ingress.
- Cuối: `node --test` **205/205 pass**, `eslint .` exit 0, `tsc --noEmit` exit 0 (chạy qua `node node_modules/.../*.js` vì thiếu shim `.bin` trên Windows).
- Smoke server thật (hybrid, cổng 4398, data/config tạm, build `.next-win-p3` sẵn có): không token 401, token source khác → `source-mismatch`, có `Origin` 403, GET 405, batch hợp lệ 200 → dòng OMP `work/active`, rồi `wait/waiting [approval]`, `persistedOnly:false`, capabilities toàn false; token không xuất hiện trong log; server đã dừng, cổng giải phóng.

## Ma trận R/S (G4)

Chỉ test synthetic/unit (fake `pi`, fake clock) trừ khi ghi khác. "NOT RUN" = chưa có bằng chứng.

| ID | Kết quả | Bằng chứng |
|---|---|---|
| R1 start/switch/resume | PASS (synthetic) | lifecycle `R1/R12`, `R1 conflict`; observer `R1/R12 switch` |
| R2 parallel tools, result-before-start, duplicate end | PASS | lifecycle `R2` |
| R3 approval/input | PASS; `ask` **unsupported** (không phải event) | lifecycle `R3`; observer mapping; README matrix |
| R4 turn end ≠ terminated, jobs | PASS | lifecycle `R4` (cả `session_end`) |
| R5 crash/heartbeat/clock skew | PASS | lifecycle `R5` ×2, live-merge `R5` |
| R6 offline/restart/slow | PASS (queue, backoff, snapshot, 429, refusal) | observer `R6/R7`, `R6 429`, `S1/S7`; lifecycle `R6` |
| R7 duplicate/out-of-order/gap/ACK loss | PASS | lifecycle `R7`, bridge `R7`, observer `R7 heartbeats` |
| R8 nhiều factory/child cùng process | PASS (synthetic) | observer `R8`, lifecycle `R8` |
| R9 bridge trước file, materialize, usage replace | PASS | live-merge `R9` ×2, lifecycle `R9` |
| R10 OMP thật đúng version/mode | **PARTIAL** — 18.14.1: print + rpc (new/resume/fork, approval) + merge file thật đã quan sát; plan review, interactive, subagent, `ask` chưa | smoke 31/10 (2 vòng) |
| R11 callback không await/không mutate | PASS (synthetic) | observer `R11` |
| R12 cùng build khác activation | PASS (generation tách khỏi build stamp) | lifecycle `R1/R12` |
| S1 token/Origin/tunnel/source forge | PASS | bridge `S1` ×3, route guard test, smoke server thật |
| S2 oversize/deep/rate/slow | PASS | bridge `S2` ×2, lifecycle `S2` |
| S3 path từ event; ghi source | PASS (không có field path nào được giữ; nguồn không bị ghi) | bridge `S3/S4`, live-merge `S3` |
| S4 secret/text | PASS (metadata only) | bridge `S3/S4`, observer mapping leak check |
| S5 render inert | **NOT RUN** — không test riêng; trường live chỉ là enum/số/id đã allowlist nên không mang markup (suy luận, không phải test) | — |
| S6 event đòi approve/kill/task | PASS | bridge `S6`, live-merge `S6` |
| S7 cross-host / ACL token | **NOT RUN** (observer từ chối URL không loopback; chưa kiểm ACL Windows) | observer `R10 disabled`, README |
| S8 cleanup | PASS (timer sweep, observer timers, bridge dispose) | live-merge `S8/R8`, observer `S8`, bridge `S8` |
| S9 key cache/hash/label vào metadata | PASS (allowlist; unknown field bị bỏ) | lifecycle `S2`, bridge `S3/S4` |

## Kiểm tra client (đọc code, không có test UI mới)

Dòng OMP live có `persistedOnly:false`, nên đi qua đường "walk-in" của `upsertSession` (khác history). Đã đọc `live.js`/`workers.js`/`your-turn.js`: dòng OMP nhận một bàn qua `proDesk` giống history Phase 3; phiên live **mới** xuất hiện khi trang đang mở sẽ đi vào bằng cửa/thang máy (chủ ý: đó là agent mới thật, không phải backfill), còn lúc tải trang/snapshot thì không walk-in. Server không phát `ev` cho OMP nên `onTurnDone`, chat, trophy, timeline không kích hoạt. Dòng `wait` được tính vào danh sách "your turn" (chỉ thông tin, drawer vẫn read-only). Chưa có E2E trình duyệt xác nhận; việc này thuộc Phase 5.

## Smoke OMP thật (D6 được người dùng duyệt: "1. ok")

Cách làm, không sửa cấu hình OMP nào: server hybrid trên cổng riêng 4398 với data/config tạm, rồi `omp -p --no-session -e integrations/omp/office-observer.js "<đọc hello.txt>"` trong thư mục tạm, token chỉ qua biến môi trường của tiến trình đó. Một lần gọi model nhỏ (provider mặc định của người dùng; không đọc credentials).

- Build: `omp 18.14.1` (source ghim là 18.14.0). Observer nạp được bằng `-e`; 5 request được nhận, 0 bị từ chối.
- Chuỗi trạng thái quan sát được: `rest/idle` (session_start) → `work/active` (agent_start) → `work/active` + tool `read` đang chạy → tool xong → `rest/idle` → `unknown` + `lifecycle ended` (session_shutdown) → `disconnected`. Model id và usage provisional (cost 0.0514 USD, 24240 input / 59 output) đi qua. `gap=false`, capabilities toàn false.
- Đã xác nhận trên build thật: `session_start`, `agent_start`/`agent_end`, `tool_execution_start`/`end`, `session_shutdown`, `ctx.isIdle()`, `getSessionId()`, và usage/model đọc được trong print mode.
- Chưa quan sát: approval, plan review, `session_switch` (new/resume/fork), chế độ interactive/rpc, subagent, `ask`, nhiều session cùng process, hợp nhất với file session thật (đã dùng `--no-session`).
- Dọn dẹp: server dừng, cổng 4398 trả, không còn tiến trình `omp`; replay log không có dòng OMP nào; token không có trong log; thư mục `~/.omp/agent/extensions` của người dùng không bị đụng (chỉ có file Orca sẵn có).

## Smoke vòng 2: rpc + file thật + cài vĩnh viễn (31/10/2026)

Server hybrid cổng 4398 (data/config tạm, `--session-dir` tạm), `omp --mode rpc --approval-mode always-ask` điều khiển bằng stdin; token chỉ qua biến môi trường của tiến trình đó.

- `prompt` có tool `read` → dòng `work` + tool đang chạy → `rest`. `new_session` → session id khác, dòng mới. `switch_session` về session đầu (resume) và `fork` → generation mới, id mới; dòng cũ kết thúc dưới identity riêng. `session_switch` đã **quan sát** cho new/resume/fork ở chế độ rpc.
- `always-ask` + tool `bash` → `wait/waiting [approval]` khi `tool_approval_requested`, hết khi `tool_approval_resolved`. Approval **đã quan sát**.
- Hợp nhất với file session thật (không còn `--no-session`): một dòng cho mỗi conversation, history/đếm từ file, usage ghi nhận của file thay snapshot provisional (cost 0.0514 USD; read=1).
- `--plan-yolo --no-session` (print): OMP tạo `note.txt` đúng nội dung; chuỗi `work → rest → work → unknown ended`; **không thấy `plan_review_*`** (plan tự duyệt, không có sự kiện chờ). Plan review vẫn **chưa quan sát**.
- Settings-file: observer đọc `~/.omp/office-observer.json` (hoặc `OFFICE_OMP_OBSERVER_CONFIG`), ưu tiên options > env > file; có test.
- **Cài vĩnh viễn** (đã được người dùng duyệt): `~/.omp/office-observer.json` (source + token + URL), bản sao `~/.omp/agent/extensions/office-observer.js` (OMP nạp không cần `-e`; đã kiểm tra), token `omp-local` trong `data/omp-ingest.json` (git-ignored). `start-office.cmd` đặt `OFFICE_OMP=hybrid`. Gỡ: xóa hai file trong `~/.omp` (README).
- Dọn dẹp: server dừng, cổng 4398 trả, không còn `omp`, token không có trong log, replay không có dòng OMP, thư mục session thật của OMP không bị ghi bởi smoke.

## Quyết định của người dùng (31/10/2026)

1. D6 duyệt cho smoke có chi phí model, rồi duyệt **cài vĩnh viễn** observer vào OMP của máy này ("cài luôn đi") và chạy nốt các smoke còn lại ("chạy luôn"). Xem hai mục dưới.
2. Dòng OMP live giữ **chỉ trên máy này** (không tới điện thoại/tunnel) tạm thời.
3. **Không ghi replay** cho OMP live. Đúng với mọi session sau: server phát mọi dòng OMP với cờ local-only và lọc snapshot theo `agentKind`, nên không phụ thuộc từng session. Hệ quả: sau khi office khởi động lại, dòng live chỉ xuất hiện lại khi observer báo lại; history vẫn lấy từ file đã pin.

## NOT RUN / ngoại lệ — cần quyết định của người dùng

- **R10**: đã quan sát trên 18.14.1: print + rpc (new/resume/fork, approval) + merge file thật. Còn thiếu: `plan_review_*`, chế độ interactive (TUI), subagent, `ask`, `message_end`. Fake `pi` không chứng minh mọi build.
- **Bản cài là bản sao**: `~/.omp/agent/extensions/office-observer.js` không tự cập nhật khi sửa `integrations/omp/office-observer.js`.
- Dòng session đã kết thúc hiện `unknown` ~15 phút (retention); nhãn/ẩn trên UI để Phase 5.
- **S7**: cross-host/WSL không làm; observer từ chối URL không phải `http` loopback.
- **ACL token Windows**: file tạo với mode 0600 nhưng Windows bỏ qua; chưa xác minh.
- E2E trình duyệt (`agents.spec.ts`, SwiftShader) không chạy; không có thay đổi frontend.
- Subagent/advisor không được báo cáo (observer bỏ `ctx.agent.kind==="sub"`); `ask` dialog không phải event → hiện active.
- Dòng OMP live chưa có animation/nhãn UI riêng cho stale (Phase 5). Chúng đi vào rail theo status `work/wait/rest/unknown`; chưa kiểm chứng ảnh hưởng tới chat/trophy/timeline client ở mixed-agent E2E.

## Câu hỏi còn mở

1. (Đã trả lời) D6 duyệt, cài vĩnh viễn, live local-only tạm thời, không ghi replay.
Người dùng giao quyền quyết ("bạn tự quyết đi", 01/11/2026). Quyết định:

2. **G4 giữ OPEN.** Không đóng gate khi plan review, interactive, subagent, `ask`, S7 và ACL Windows chưa có bằng chứng. Các mục này không chặn bắt đầu Phase 5 (UI chỉ đọc dữ liệu đã có); chúng được kiểm khi có điều kiện chạy thật (TUI tương tác, host khác).
3. **Giữ bản cài là bản sao**, không thêm script/symlink (KISS; symlink Windows cần quyền). Quy tắc: sửa `integrations/omp/office-observer.js` thì copy lại (README đã ghi).
4. **Phase 5: session đã kết thúc hiện mờ trong thời gian retention (15 phút) rồi biến mất**, không ẩn ngay để người dùng còn thấy kết quả cuối.
