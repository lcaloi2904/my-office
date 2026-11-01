# G4 local validation — OMP 18.14.2 / Windows (01/11/2026)

> **Cập nhật sau approval:** [ACL/token remediation](./phase-04-token-remediation.md) đã chuyển credential files sang private storage, rotate token và kiểm chứng old401/new200; snapshot ACL FAIL/chưa sửa trong report này là lịch sử. G4 tổng vẫn OPEN vì các giới hạn runtime/cross-host khác.

## Verdict

**G4 vẫn OPEN.** Đã xác minh một phần runtime còn thiếu bằng OMP cài thật 18.14.2, TUI thật và model scripted loopback. Đã xác nhận **ACL token không đạt chính sách private**. Không sửa product code/settings/ACL, không rotate token, không bắt đầu Phase 06 hay rollout, không commit/push.

User duyệt bắt đầu bước kiểm chứng G4 local sau Phase 05. Phạm vi: interactive/TUI, plan-review, task child/`ask`, Windows token ACL. Không dùng inference trả phí; không đọc credential/provider auth/transcript OMP thật. Đây không phải chứng nhận mọi mode/build/provider, kiểm thử cross-host hoặc full security review.

## Boundary map

| Boundary | Asset/caller | Phương pháp |
|---|---|---|
| Installed configuration trên máy người dùng | `data/omp-ingest.json`, `data/`, `~/.omp/office-observer.json`, `~/.omp/` | Chỉ `Get-Acl` + SID translation; không đọc giá trị secret hoặc đổi quyền |
| Disposable OMP runtime | executable 18.14.2, isolated cwd/HOME/agent/session/profile data | Windows PTY/TUI; explicit unchanged observer và passive recorder |
| Scripted model → actual OMP tools | HTTP OpenAI-compatible SSE fixture trên `127.0.0.1:49764` | Model fixture chỉ trả tool requests; OMP thực thi built-in tools và phát callbacks thật |
| Observer → Office ingestion | Synthetic source/token riêng; real `createOmpBridge` + `createOmpLifecycle` qua local HTTP | Capture metadata allowlist, real normalization/auth/sequence/projection; không inject event trực tiếp |

Đây là local/disposable probe cho app của người dùng. Không active probe vào production Office hoặc tài khoản khác; không thử đọc token dưới user khác. Secret material thật không vào transcript/log/report.

## Environment và isolation

- Windows 10.0.26200 x64; `omp --version` trả **`omp/18.14.2`**; executable `C:/Users/Mr.LeCo/AppData/Local/omp/omp.exe`. Không upgrade/cài runtime trong lượt này. Evidence 18.14.1 trong report trước giữ nguyên lịch sử, không tự áp cho 18.14.2.
- Bản installed observer và repository observer **khớp byte** SHA-256 `ce1904f21f4051282a1912c5cffae829b79426c8aae43adab046ef3c9ca4b9e1`.
- Sandbox tạm riêng `my-office-g4-fead9774b5`: cwd, HOME/USERPROFILE, agent/config/models, AppData/cache, session/artifact và TEMP riêng. Environment xây từ allowlist system paths, không kế thừa provider credentials/auth-broker/OMP profile/settings.
- `--no-extensions --no-skills --no-rules --no-context-files --no-lsp --no-title --no-prewalk`; chỉ `-e` observer unchanged và recorder thụ động. `--tools read,write,ask,task`, `--thinking off`, `--session-dir` và `--cwd` trỏ sandbox. Không load MCP/project config. Telemetry exporter/advisor/speech/memory/async/completion probe và remote fallback tắt trong sandbox.
- Main/smol/slow/plan/task/tiny/widget/memory/commit/advisor roles được pin `g4-local/probe`; custom provider duy nhất có endpoint loopback và synthetic key. HTTP(S) proxy tới loopback không phục vụ, NO_PROXY chỉ local. Không cấu hình external inference route hoặc cấp usable provider credentials. **Không có packet capture/host firewall proof về mọi outbound packet**; không nhận model quality/accounting hoặc zero-network claim từ fixture.
- Service fixture dùng real bridge/lifecycle source, không chạy full Next dashboard ở lượt này. End-to-end browser UI evidence đã ở Phase 05; lượt này chỉ chứng minh actual-runtime callback → observer → HTTP ingress → lifecycle projection.

## Runtime results

| Scenario | Quan sát thực tế | Kết luận / giới hạn |
|---|---|---|
| TUI startup/read | Terminal composer của custom model; `ctx.mode=tui`, `hasUI=true`, kind main; `G4_READ` gọi built-in `read hello.txt`, tool start/end với `isError=false`, `G4_DONE` | PASS cho tested 18.14.2/TUI loading + read mapping |
| Message/turn/shutdown | `message_end`, `agent_start/end`, `session_start/shutdown` captured; clean baseline/ask/child launchers exit 0 | PASS callback emission theo các lượt được capture; không suy shutdown delivery guaranteed |
| Native plan review | `/plan`, real `write local://PLAN.md`, `/plan-review` mở overlay; matching requested/resolved review ID; resolution **`choice=execute`, `by=local`** | PASS cho manual-open request/resolution callback mapping, **không** phải cancellation hoặc complete plan execution PASS |
| Plan projection | `input_requested` → `waiting`, `waitReasons=[input]`; matching `input_resolved` → **idle**, empty reasons trong cùng generation1; sau đó session switch generation2 | PASS clear wait trước khi generation đổi, không chỉ nhìn HTTP200 |
| Plan continuation | Native selection execute khởi động session mới; automatic execution prompt không có fixture marker bị endpoint từ chối `unexpected-probe-model-request` | **Fixture continuation FAIL/NOT VERIFIED**; không mở rộng allowlist để lấy PASS. Không chứng minh automatic-proposal path, execution completion hoặc Escape cancellation |
| Built-in `ask` | Fresh session inactive plan; actual picker hiện 2 options; Enter chọn `Fixture yes`; tool end `isError=false`, `G4_DONE` | Runtime ask dialog/completion PASS; không phải custom extension dialog |
| Ask waiting projection | Dialog mở khoảng **14.736s**; captured lifecycle chỉ `active`, empty wait reasons; tool category other | **Exact ask waiting UNSUPPORTED, now observed**, không gắn waiting/input giả |
| Real task child | Fresh main gọi built-in task; terminal báo **1 succeeded**. Child callback kind sub, mode print, agent `G4Child`, parent `Main`, distinct session ID; start/agent/message/end/shutdown observed | PASS real child creation/identity/completion trong scenario local scripted model; không claim hidden yield đã được thực thi |
| Child observer exclusion | Child session ID có trong passive callbacks nhưng không có trong observer wire; root task vẫn có tool start/end | **Live child reporting UNSUPPORTED, deliberate exclusion verified**. Không chứng nhận nested/advisor runtime support |

Root baseline ID `01a194db-024d-754e-b018-53a56d0b8618`; plan root `01a194dc-1ba5-7667-b1d7-8fe8a7c103de`; ask root `01a194dc-d38c-70fb-861a-aa4c29efde65`; task root `01a194dd-5439-727e-bd00-ecc45cabddc7`; child `01a194dd-650e-7656-97e3-bc105f3c77a2`. Đây đều là IDs của fixture mới, không phải session người dùng thật.

### Plan failure chronology

Raw Escape rồi `/plan` không đem lại cancellation dự định: native callback ghi execute/local. Không kết luận lỗi OMP vì terminal input delivery chưa được chứng minh. Tổng **15** diagnostic rows `unexpected-probe-model-request`: **3 trước khi review mở, 12 sau execute selection**; không gộp tất cả thành automatic-continuation failures và không làm yếu guard. `/g4-stop` lúc busy không chứng minh đã dừng. Process cũ còn emit và gọi ask `g4-call-18` trong continuation session, overlap lúc fresh ask session bắt đầu. Chỉ fresh `g4-call-19` được dùng làm ask PASS; không claim sequential process isolation hoặc graceful plan-process shutdown. Sau stop service, query unique sandbox path xác nhận không còn process cũ; teardown cuối xác nhận không còn sandbox OMP nào.

Một lỗi setup ban đầu trước mọi OMP launch: fixture import `../../../server` thay vì `../../server` gây `ERR_MODULE_NOT_FOUND`. Counsel chấp thuận sửa đúng 2 imports; không sửa bridge/lifecycle hoặc coi lỗi đó là R10 failure.

## Windows ACL — confirmed policy failure

**Own finding G4-ACL-01: Medium (local credential confidentiality/integrity × local principal access), acceptance blocker.** Không chứng minh theft/exploitation hoặc remote compromise.

Read-only PowerShell dùng `Get-Acl`, `GetAccessRules(..., SecurityIdentifier)` và SID→NTAccount translation, không đọc secret. Không có Deny ACE trong các ACL được inspected.

| Target | ACL quan sát | Kết quả |
|---|---|---|
| `data/omp-ingest.json` | Inheritance enabled; Administrators/SYSTEM FullControl; **Authenticated Users Modify**, **Users ReadAndExecute** | **FAIL** private-to-runtime-account policy |
| `data/` | Cùng broad groups; grants áp trên parent và inheritable | Secret temp/replacement lifecycle cũng có risk, không đủ chỉ siết file hiện tại |
| `~/.omp/office-observer.json` | Inheritance enabled; owner/admin/SYSTEM FullControl; **CodexSandboxUsers ReadAndExecute**, một unresolved SID có Write + ReadAndExecute | **FAIL** intended owner/admin/SYSTEM allowlist; chưa xác minh principal unresolved thuộc ai |
| `~/.omp/` | Các grants trên có inheritance cho con | Không được recursive-reset toàn `.omp` vì có thể ảnh hưởng workflows khác |

Tác động trực tiếp được giới hạn bởi token source-bound telemetry của `server/agents/omp/bridge.mjs`: token không cấp Claude/OMP prompt/approval/kill/account control. **[INFERENCE]** Local principal có quyền phù hợp có thể đọc/reuse telemetry token, sửa config hoặc giả/mất reporting cho source đó. Không suy token provider, arbitrary execution hoặc truy cập từ Internet.

`loadIngestTokens()` (`server/agents/omp/bridge.mjs:17–35`) ghi secret vào `.tmp` rồi rename; Windows bỏ qua `mode:0600`. File-only DACL fix có thể không bảo vệ temp lần sau. Writable parent cần đánh giá delete-child/create/rename cụ thể; không coi mọi parent Modify là proof effective access cho mọi user.

### Remediation đề xuất — chưa được thực thi

1. Chốt trusted principals: runtime account + SYSTEM/Administrators và service account nào thật sự cần.
2. Bảo vệ hai existing secret files **và** storage/temp/replacement lifecycle; không recursive-reset repo/home/`.omp` hoặc phá sharing ngoài scope. Kiểm tra ancestor namespace/delete-child rights.
3. Sau khi storage boundary an toàn, rotate telemetry token phối hợp receiver/observer và kiểm tra reconnect. Xem như **potentially disclosed**, không khẳng định đã bị lấy.

Cần approval riêng vì thay quyền/config/token thật có thể ảnh hưởng Office/OMP và các sandbox workflows. Lượt này chỉ inspection, không mitigation/rotation. Không đóng S7 hay G4 từ việc đã phát hiện lỗi.

Reference cho semantics: [Microsoft File Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights), [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew). Đây là semantics reference; proof là ACL inspection trên máy, không phải suy từ tài liệu.

## Evidence, review và teardown

Raw metadata-only evidence dưới ignored `test-results-phase5/g4-local/`:

- `callbacks.jsonl`: allowlisted callback type/mode/kind/correlation/parent IDs; không prompt/args/output.
- `wire.jsonl`, `states.jsonl`: observer wire và real lifecycle state transitions.
- `model-requests.jsonl`, `fixture-errors.jsonl`: local model/tool names và bounded failure reasons, không request bodies/headers.
- `summary.json`, `final-state.json`, `acl-inspection.json`, `teardown.json`.

All captured observer HTTP statuses 200. Fixture service cuối báo accepted25/rejected0/limited0, một source; counter reset giữa baseline và scenario service, **không** coi đó là toàn bộ cumulative batch count. Model-request log chỉ ghi **accepted requests**, đều có model `probe`; rejected requests được đếm riêng, không claim log bao phủ mọi request. Counts là fixture dispatch, không usage thật.

Dedicated baseline, ask và child runtimes shutdown exit0. Plan continuation bị stop có thể để volatile row open trong isolated lifecycle; final state **không phải all-ended**, đúng với best-effort/missing shutdown semantics, không report sạch giả. Không thay retention/clock để làm xanh.

Sau teardown, query `Win32_Process` chỉ lọc `omp.exe` có unique sandbox path: **không còn process**; TCP49764 refused connection. Không kill coding agents/OMP của người dùng. Temporary probe source được dọn sau khi lưu evidence; synthetic sandbox/evidence không chứa real credentials. Không rerun unit/build vì product source không thay; các kết quả Phase05 không được ghi lại như verification mới của lượt này.

Independent counsel đọc evidence và giữ kết luận narrowly scoped; không có broad runtime/provider/security clearance. Full dependency/secret audits không chạy vì scope là local G4 runtime + named token ACL inspection, không phải Phase06 security audit.

## Gate disposition

- R10: bổ sung actual18.14.2/TUI read/message/shutdown, manual plan review mapping, ask/tool và child identity/exclusion evidence. Không tự nâng previous18.14.1 print/RPC evidence sang mọi mode18.14.2.
- Ask/live children: giới hạn unsupported đã quan sát, chưa được implement hoặc waived.
- S7 local token ACL: từ NOT RUN chuyển thành **FAIL**, chờ authorized remediation + verification. Cross-host/WSL transport vẫn **NOT RUN**.
- Plan cancellation/automatic proposal/complete execution continuation chưa được chứng minh ở lượt này.
- **G4 OPEN; không Phase06/rollout/commit/push.** Next priority: approve scoped private-storage/ACL remediation and coordinated telemetry-token rotation, rồi kiểm chứng lại đúng failure boundary.
