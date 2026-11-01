# Báo cáo G1 — Compatibility, ownership và security gate

Ngày: 2026-11-01. HEAD lúc probe: `8da383771bf4329aa9b471f477d53fb593e1f9e1`.

**Kết luận: G1 REVIEW COMPLETE cho baseline native Windows và design gate.** Blocker RPC “No default model selected” đã được giải quyết bằng cấu hình model giả loopback, không cần credential hay lượt model. Đã chạy binary thật và xác minh startup, `get_state`, `new_session`, exact `switch_session`, exact CLI `--resume`, đọc synthetic history, `abort` khi idle và EOF shutdown. Các năng lực cần turn/approval/TUI bridge vẫn UNKNOWN hoặc DOCUMENTED, bị khóa mặc định. **Đóng review G1 không phải cấp quyền triển khai/bật G3–G6 và không phải chứng nhận toàn bộ RPC.**

Nhãn trong báo cáo:
- **VERIFIED runtime**: quan sát trực tiếp trên binary/version/mode/kịch bản được ghi dưới đây.
- **VERIFIED source**: đọc mã nguồn hiện tại của repository; không thay thế kiểm chứng HTTP/browser.
- **DOCUMENTED**: tài liệu/source upstream (ưu tiên tag `v18.14.2`); không đồng nghĩa binary đã được thử hành vi đó.
- **UNKNOWN**: chưa xác minh; không được quảng bá capability hoặc tự fallback.

## 1. Môi trường, quyền và cô lập

| Thuộc tính | Bằng chứng |
|---|---|
| Hệ điều hành | `process.platform=win32`, `process.arch=x64`, `os.release()=10.0.26200` |
| Node | `v24.22.1` |
| HEAD | `git rev-parse HEAD` → `8da383771bf4329aa9b471f477d53fb593e1f9e1` |
| Binary | `C:/Users/Mr.LeCo/AppData/Local/omp/omp.exe` |
| Version | `--profile g1-native --version` → stdout `omp/18.14.2`, exit 0, stderr rỗng |
| Thời gian | `2026-11-01T10:49:19.558Z`–`10:49:23.768Z` (UTC) |
| Phạm vi | Chỉ 2 tài liệu G1 và fixture tạm riêng; không sửa policy/product/runtime thật |

Probe được user giao tường minh là native cost-free compatibility investigation, không phải unit/build suite. Root duy nhất của task là `E:/vide-code/my-office/test-results/g1-native-protocol-20261101` (gọi tắt `$R`, ignored theo `.gitignore:14`). Script chạy bằng `node test-results/g1-native-protocol-20261101/probe.mjs`; spawn binary bằng `shell:false`, `windowsHide:true`, `stdio:"pipe"`, cwd `$R/workspace`.

Environment của child được dựng mới, **không spread `process.env`**. Chỉ kế thừa giá trị `SystemRoot`, dựng `WINDIR/ComSpec/PATH/PATHEXT` từ thư mục hệ thống; `PATH` chỉ chứa `System32`. `HOME/USERPROFILE/HOMEDRIVE/HOMEPATH`, `APPDATA/LOCALAPPDATA`, `TEMP/TMP`, `XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_CACHE_HOME/XDG_STATE_HOME`, `PI_NATIVES_DIR` đều trỏ trong `$R`; `PI_CONFIG_DIR=.omp`. Không kế thừa provider keys, auth broker, profile, settings overlay hay extension overrides. `OTEL_SDK_DISABLED=true`, `PI_NO_TITLE=1`, `PI_NO_PTY=1`, `PI_AUTO_QA=0`, `OMP_SKIP_SETUP=1`. HTTP/HTTPS/ALL proxy trỏ `127.0.0.1:9`, `NO_PROXY` chỉ loopback.

**Cô lập profile được kiểm tra trước RPC:** `omp --profile g1-native config path` trả đúng:

```text
E:\vide-code\my-office\test-results\g1-native-protocol-20261101\home\.omp\profiles\g1-native\agent
```

Lệnh exit 0, stderr rỗng. Không tạo profile trong HOME thật. Cả `config.yml` và `models.yml` do task tạo tại đường dẫn trên (JSON mapping hợp lệ trong YAML). Model provider duy nhất do task khai báo:

```yaml
providers:
  g1-local:
    baseUrl: http://127.0.0.1:59867/v1
    apiKey: g1-synthetic-not-a-credential
    api: openai-completions
    models:
      - id: probe
        name: G1 no-turn probe
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 32000
        maxTokens: 128
```

Cổng `59867` được OS cấp cho HTTP listener loopback; listener luôn trả HTTP503 `g1-no-model-turns-allowed`, không có inference implementation. Mọi chat role `default/smol/slow/vision/plan/commit/tiny/memory/task/advisor/widget` pin `g1-local/probe`; `enabledModels=[g1-local/probe]`, `autoResume=false`, retry/modelFallback, advisor, compaction, memory backend, spelling autocomplete, cache warming, speech/STT, OTLP và startup plan được tắt bằng config riêng. Foreign discovery và local provider discovery phổ biến bị disable; đồng thời dùng các cờ `--no-*` bên dưới.

Không đọc `.env`, provider auth, extension/token/session thật; không cài extension, không login, không gọi prompt/steer/follow-up. Public docs đọc qua URL có sẵn; không chạy script docs-seeker vì skill mô tả script tự load `.env`, trái ranh giới của task. **Không claim sandbox OS/firewall hay zero network toàn máy:** không có packet capture; bằng chứng hẹp là không credential thật, không lệnh khởi phát turn, model selected là loopback, listener ghi **0 HTTP requests**, không `agent_start`/message events trong 2 RPC runs.

## 2. Nguyên nhân và loại trừ

Lỗi trước đó là exit1 `No default model selected…` khi dùng profile rỗng; không chạy lại chỉ để xác nhận lỗi user đã báo.

| Giả thuyết | Đối chiếu | Kết quả |
|---|---|---|
| Thiếu model selection chặn startup, không phải RPC hỏng | Cấu hình synthetic model + `--model g1-local/probe` cho startup `ready` và 13 correlated success responses | **CONFIRMED** prerequisite model; không cần turn |
| Windows `spawn shell:false`/binary/protocol không hoạt động | Cả 2 child thực chạy, ready v1, response đúng request ID, EOF exit0 | **ELIMINATED** trong kịch bản đã chạy |
| Phải dùng profile thật/auth trả phí mới đọc state/resume | `config path` nằm trong `$R`, synthetic provider, 0 model requests, exact history đọc được | **ELIMINATED** cho các API đã thử, không suy cho prompt |

Giới hạn quan trọng: thay cấu hình fake model chứng minh một model hợp lệ đủ cho kịch bản này, không chứng minh mọi startup RPC đều cần credential hoặc inference.

## 3. Lệnh và timeline thực chạy

Hai launch dùng cùng argv nền; không shell interpolation, không positional message:

```text
omp.exe --profile g1-native --mode rpc
  --no-extensions --no-skills --no-rules --no-context-files --no-tools
  --no-lsp --no-title --no-prewalk --thinking off --model g1-local/probe
  --cwd "$R/workspace" --session-dir "$R/sessions"
```

Run B chỉ thêm `--resume "$R/sessions/2000-01-01_g1-exact.jsonl"`, sau khi run A đã exit0. Không dùng `--no-ui`, `--continue`, `--restore`, ID-prefix resume hoặc model-backed request.

Synthetic transcript schema3 gồm header `id=00000000-0000-4000-8000-000000000001`, cwd `$R/workspace`, timestamp `2000-01-01T00:00:00.000Z` và một user history entry `G1 SYNTHETIC HISTORY ONLY - NEVER DISPATCH`. Đây là dữ liệu lịch sử ghi trực tiếp vào fixture, **không phải prompt gửi tới RPC/model**.

| UTC 2026-11-01 | Lệnh / sự kiện | Output quan sát |
|---|---|---|
| 10:49:19.558–21.135 | version/config path/help, chuẩn bị synthetic transcript | Version/path đúng như §1; cả 3 exit0, stderr rỗng |
| 10:49:21.135 | Spawn run A | `ready`: protocolVersion1, supported `[1,2]`, maxFrameBytes1048576, maxReassembledFrameBytes67108864 |
| 10:49:21.146–22.420 | `g1-1-1 get_state` | success; session `01a196ba-69fb-7737-ad0f-f0d246f52864`, messageCount0, isStreaming=false, isSettled=true |
| 10:49:22.420 | `g1-1-2 abort` | `success:true`; child vẫn phục vụ các lệnh tiếp |
| 10:49:22.422–22.451 | `g1-1-3 new_session`, `g1-1-4 get_state` | `cancelled:false`; ID đổi thành `01a196ba-6cf8-73c3-913a-8abc1ce5fdc5`, messageCount0 |
| 10:49:22.451–22.474 | `g1-1-5 switch_session` với `sessionPath` exact, `g1-1-6 get_state`, `g1-1-7 get_messages` | `cancelled:false`; exact synthetic ID + file; messageCount1; đúng 1 synthetic history entry |
| 10:49:22.474–22.477 | `g1-1-8 get_session_lease` với duy nhất synthetic ID | `success:true,data:{held:[],unknown:[]}`; không phải chứng minh độc quyền (xem §5) |
| 10:49:22.477–22.488 | `g1-1-9 open_session` với `sessionDir`, `g1-1-10 get_state` | `cancelled:false,resumed:true`, synthetic ID/file (file không rỗng duy nhất); không chứng minh multi-file ordering |
| Trước 10:49:22.550 | Đóng stdin run A, tiếp tục drain stdout | Exit0, signal=null, stderr rỗng |
| 10:49:22.550–23.723 | Spawn run B exact CLI resume; `g1-2-1 get_state`, `g1-2-2 get_messages`, `g1-2-3 abort` | Ready cùng limits; exact synthetic ID/file, messageCount1, isStreaming=false, isSettled=true; đúng history; abort success |
| 10:49:23.768 | Drain/EOF run B, đóng listener | Exit0, signal=null, stderr rỗng; `modelRequests=[]` |

Ví dụ response thật:

```json
{"id":"g1-1-3","type":"response","command":"new_session","success":true,"data":{"cancelled":false}}
{"id":"g1-1-5","type":"response","command":"switch_session","success":true,"data":{"cancelled":false}}
{"id":"g1-2-3","type":"response","command":"abort","success":true}
```

Đã thấy 6 `extension_ui_request` trên hai run, **tất cả `method:"setWidget",widgetKey:"autoresearch"`**, kể cả `--no-extensions`; không có dialog/decision. Không phản hồi các notification đó và EOF vẫn exit0. Không suy `--no-extensions` nghĩa là không có UI frames, cũng không dùng chúng làm bằng chứng tool/plan/ask approval.

## 4. Support matrix đóng băng — OMP18.14.2 / native Windows / RPC

| API / hành vi | Nhãn | Phạm vi chứng minh / quyết định |
|---|---|---|
| `--version`, `--help`, `--profile`, `config path` | VERIFIED runtime | Version/cờ công khai và profile task-owned; không đọc auth |
| `--mode rpc`, JSONL ready v1, response ID | VERIFIED runtime | 2 launches, 13 success responses; v2 chỉ advertised, negotiation/chunking **UNKNOWN** |
| `get_state` | VERIFIED runtime | Session ID/file, model giả, counts và idle flags; phải sanitize, không forward nguyên state |
| `new_session` | VERIFIED runtime | `cancelled:false`, ID mới, messageCount0; không claim đã ghi hội thoại bền vững |
| `switch_session {sessionPath}` | VERIFIED runtime | Exact schema3 synthetic file/ID + history, không turn |
| CLI `--resume <absolute path>` | VERIFIED runtime | Exact synthetic file/ID + history trong process thứ hai |
| `get_messages` | VERIFIED runtime | Đúng một user history entry synthetic; không chứng nhận large history/paging |
| `open_session {sessionDir}` | VERIFIED runtime, hẹp | Chọn file không rỗng duy nhất; newest/continuation selection **DOCUMENTED** ở source; không dùng làm exact resume |
| `abort` khi idle | VERIFIED runtime | ACK success, không kill child; abort đang stream/tool/approval **UNKNOWN** |
| `get_session_lease {sessionIds}` | VERIFIED runtime, hẹp | Schema và free result; held/conflict/unknown paths **UNKNOWN**; không phải reservation |
| EOF shutdown khi idle | VERIFIED runtime | Drain stdout rồi exit0 cả 2 child; shutdown khi busy **UNKNOWN** |
| `prompt` | DOCUMENTED, runtime UNKNOWN | Không gửi; ACK/completion/error-after-admission chưa kiểm chứng; disabled |
| `steer` | DOCUMENTED, runtime UNKNOWN | Không gửi; idle/busy/queue semantics chưa kiểm chứng; disabled |
| `follow_up` | DOCUMENTED, runtime UNKNOWN | Không gửi; queue/completion/dedup chưa kiểm chứng; disabled |
| `extension_ui_request` notification | VERIFIED runtime, hẹp | Chỉ `setWidget`; tool/plan/ask dialog và `extension_ui_response` **UNKNOWN**, disabled |
| `prompt_result` / `session_settled` sau turn | DOCUMENTED, runtime UNKNOWN | Idle `isSettled` có thật, nhưng không có turn để kiểm chứng completion events |
| CLI `--continue`, `--restore`, ID-prefix resume | DOCUMENTED / cờ trong help | Không chạy; không dùng cho exact resume; `--restore` disabled |
| External TUI `pi.sendUserMessage` / `ctx.abort` / approval bridge | DOCUMENTED API, transport UNKNOWN | Không extension controller/install/attach probe; toàn bộ control disabled |
| Observer/history và Phase02 hide/unhide | VERIFIED source / bằng chứng tích hợp riêng | Không phải transport điều khiển; UI visibility không cấp owner |
| WSL/cross-host RPC | UNKNOWN | Không chạy; không suy từ Windows |

Các flag thiết kế `OFFICE_OMP_CONTROL/LAUNCH/APPROVAL` tiếp tục OFF; đây không phải các capability đang được implement. Phiên bản hoặc mode khác phải có matrix riêng. `integrations/omp/README.md:44-60` và báo cáo local G4 cũ là bằng chứng observer/TUI riêng, không nâng cấp thành approval-control PASS của lượt này.

## 5. Owner/resume design gate và source map

| Ranh giới | Bằng chứng source | Quyết định |
|---|---|---|
| OMP read-only, conversation opt-in | `server/agents/schema.mjs:8-11,32-40` | Không bật các capability Claude-like |
| Opaque source/session identity | `schema.mjs:43-51` | Hash tuple sourceNamespace/sessionId; không profile/path/PID công khai |
| Claude-only control resolution | `server/agents/registry.mjs:40-58`, `schema.mjs:55-59` | OMP không đi qua Claude task/control route |
| Containment/no junction + file identity | `server/agents/omp/paths.mjs:73-117` | Reuse `approveRoot`/`containedPath`/`openContained`; exact candidate server-side, không browser path |
| Observer conflict/freshness | `server/agents/omp/lifecycle.mjs:139-165` | Chỉ memory telemetry: runtime khác bị reject khi còn fresh, có thể thay khi stale; **không phải write lock/resume authorization** |
| Telemetry auth | `server/agents/omp/bridge.mjs:73-102` | Token source-bound, reject Origin/tunnel/nonloopback; không reuse token cho control |

Source upstream tag `v18.14.2` (DOCUMENTED, không claim binary byte-for-byte bằng tag):
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts:886-902`: `new_session`/`switch_session` trả `{cancelled}`; host phải kiểm ID sau đó.
- Cùng file `:926-969`: `open_session` chọn newest non-empty và có thể follow continuation; không phải API chọn file exact.
- Cùng file `:2257-2300`: `get_state` gồm raw `systemPrompt`, `dumpTools`, `queuedMessages`, `sessionFile`; chỉ projection allowlist mới được ra UI/SSE/audit.
- Cùng file `:2657-2662`: `get_session_lease` chỉ gọi probe, không lấy ownership.
- `packages/coding-agent/src/session/session-manager.ts:1117-1148,2376-2380`: mở/resume file chưa claim lease; first write mới claim. Khi owner khác giữ, write có thể chuyển sang sibling/new ID thay vì từ chối launch.
- `packages/coding-agent/src/session/session-storage.ts:619-689,1343-1363`: lease OS gắn session ID; probe free/held/unknown chỉ là snapshot. Nhánh lỗi lấy lock có thể trả release no-op; không được dùng native storage làm security guarantee độc lập.

Điều này giải thích response `held:[]` dù synthetic transcript đã mở trong RPC: **opened ≠ writer-owned**, không phải lỗi do chọn nhầm session. Không cần tạo turn để ép write/lock. Không thử 2 writer thật, held/conflict path, takeover hay file mutation.

**Design gate chốt:** controller phải giữ reservation riêng theo opaque source/session, đúng runtime/generation/nonce; từ chối owner conflict/unknown. Native lease probe là tín hiệu bổ sung, không atomic acquire và không chứng minh TUI idle không mở cùng phiên. Không coi stale observer/PID/mtime/free probe là quyền resume. G3 phải chứng minh preflight + ownership qua race giữa check/open/first-write, không silent sibling/fork, kiểm ID/file sau transition và sau sự kiện đổi session; nếu không chứng minh độc quyền với legacy TUI thì resume disabled. Cùng session ở 2 namespace vẫn cần canonical candidate/file identity check để không tạo duplicate writer. Không kill/steal owner.

## 6. Strict Origin/auth gate

VERIFIED source tại thời điểm đọc (nhánh G2 đang xử lý visibility, line có thể dịch):
- `server/index.mjs:1228-1241,2261`: socket loopback loại tunnel; `hostAllowed` trả421 cho Host lạ. Host guard còn cho hostname/LAN interfaces, nên **không thay thế** socket loopback.
- `sameOriginOf` `:1232-1234` chấp nhận Origin thiếu. Route control tương lai phải yêu cầu Origin hiện diện và khớp chính xác `http://${host}`; không chỉ reuse helper/cookie PIN.
- Visibility mới `:2362-2385` đã có Origin bắt buộc, loopback, JSON, cap2000, target lookup và revision conflict; HTTP/browser verification do parent, không claim PASS từ đọc source.
- Pin `:2389-2396` giữ guard cũ; không sửa ngoài assignment.
- Browser control: strict Origin + Host + socket loopback + JSON/cap + target/owner/capability/flags; replay/remote không bao giờ dispatch.
- Runtime bridge: kênh riêng, Origin bị từ chối, per-runtime credential riêng biệt telemetry; validate source/runtime/generation/nonce/TTL và bounded dedup. ACK mất → unknown, không retry prompt.
- Approval mặc định deny/unsupported; không biến timeout/default dialog thành allow. Prompt/tool args/results/raw state không vào action logs, SSE hoặc replay.

## 7. Gate/approval register và chống tái diễn

| Mục | Trạng thái |
|---|---|
| G1 cost-free probe + source/design review | **COMPLETE** trong phạm vi báo cáo; đã có user assignment cho probe |
| Phase02 hide/unhide (UI-only) | Được yêu cầu hoàn tất cùng phase; implementation/verification thuộc parent/G2, không cần ngoại lệ control |
| G3 managed launch/resume | **BLOCKED BY POLICY/SCOPE APPROVAL**, không phải blocker fake-model setup nữa. Cần ngoại lệ hẹp `AGENTS.md:67-71`, approved project/profile/binary mapping và proof exclusive resume/race/identity |
| G4 prompt/steer/follow-up/active abort | Chưa được phép bật; cần approval control + phiên/model fixture được duyệt, evidence admitted/settled/error/queue/duplicate semantics và regression gate |
| G5 external controller | UNKNOWN/disabled; cần duyệt install/reload extension riêng, credential riêng và installed TUI transport proof; không sửa observer thành command channel |
| G6 tool/plan/ask decisions | UNKNOWN/disabled; cần response API + timeout/deny/stale-decision tests, duyệt phạm vi tác dụng phụ; không suy từ `setWidget` hay observer waitReasons |
| Runtime/profile thật hoặc paid model smoke | Chưa được duyệt; không prerequisite để đóng review G1; cần consent riêng nếu phase sau cần |

Chọn managed native RPC child cho new/exact resume tương lai vì đã có stdio identity/state evidence; external TUI chỉ opt-in bridge riêng sau G5. Loại CLI-per-prompt vì không bảo toàn runtime state/owner. Tắt flag để rollback về observer-only, không xóa transcript, không auto-respawn/auto-send sau crash.

Chống tái diễn: pin version + mode + tested API matrix, bootstrap fixture có model selection ngay từ đầu, fail closed với unknown/incompatible handshake, và tách “review xong” khỏi “được phép rollout”. Cần quan sát sanitized reason codes `owner-conflict`, `owner-unknown`, `identity-mismatch`, `unsupported-version` và request outcome unknown trong G3–G6; không log payload. Đây là yêu cầu thiết kế, chưa thêm telemetry/control code trong task.

## 8. Cleanup và những gì không chạy

Cả 2 RPC children đã exit0 qua EOF, signal=null; listener đã `close()` trước khi script kết thúc. Đã xóa **toàn bộ** `test-results/g1-native-protocol-20261101` qua workspace `files_delete recursive:true` → `ok:true`, gồm script, raw evidence, synthetic config/models/profile/session/cache/natives/temp. Không xóa `test-results` dùng chung hoặc artifact của parent. Evidence chọn lọc đã chép ở báo cáo này; raw probe không còn được giữ.

Không unit/integration/E2E/build/lint/formatter, không cài package, không commit/push, không đổi `AGENTS.md`, token/config/runtime thật. Parent sở hữu phase/plan/validation matrix và chạy verification tích hợp một lần. Không ghi lại kết quả suite hay `ak plan validate` lịch sử như kết quả mới.

## Câu hỏi còn mở

1. Ngoại lệ policy và phạm vi control G3–G6 có được user phê duyệt tường minh không?
2. Cơ chế nào chứng minh exclusive resume trước first write với TUI không có controller? Nếu chưa chứng minh, giữ resume disabled; free lease/stale observer không đủ.
3. Prompt completion, abort khi busy, approval responses và external bridge có hành vi gì trên đúng installed mode? Không nằm trong probe no-turn, tiếp tục UNKNOWN cho đến gate riêng.
