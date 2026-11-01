# G4-ACL-01 — private telemetry storage và token rotation (01/11/2026)

## Outcome

**Đã áp dụng remediation local được người dùng duyệt:** “ok. Duyệt sửa ACL và rotate token”. Token telemetry mới đã được tạo và cập nhật đồng bộ receiver/observer; token cũ bị từ chối. Không thay API key/provider account, không gọi model trả phí, không mở LAN/firewall, không commit/push hay rollout.

**Finding G4-ACL-01 được khắc phục trong boundary filesystem/token đã kiểm chứng. G4 tổng vẫn OPEN.** Cross-host/S7 và các mode/runtime limitations còn lại không được đóng thay bằng kết quả này.

## Applied cutover

| Thành phần | Trước | Hiện tại |
|---|---|---|
| Receiver credentials | Repository `data/omp-ingest.json`, inherited broad grants | `~/.omp/office-private/ingest.json` |
| Observer settings | `~/.omp/office-observer.json`, inherited additional principals | `~/.omp/office-private/observer.json` |
| Installed extension | `~/.omp/agent/extensions/office-observer.js` | Private package `~/.omp/agent/extensions/office-observer/{index.js,private-storage.js}` |
| Existing factories | Captured old token | Không bị dừng; giữ old binding tới lần nạp mới, telemetry có thể ngừng sau 401 |

Private root và extension package directory được tạo **với protected DACL ngay tại lúc tạo**, không có bước tạo permissive rồi mới siết. Owner là tài khoản chạy Office; chỉ owner, SYSTEM, Administrators có Allow FullControl, với inheritance cho files mới. Hai file JSON và hai installed code files kế thừa đúng trusted set từ private parent; không còn Users/Authenticated Users/CodexSandboxUsers Allow ở các object mới này.

Không reset ACL toàn repo, `data`, home hoặc `.omp`. So sánh metadata trước/sau xác nhận DACL/owner/protection/rules của repo-parent, repo, data, home và `.omp` **không đổi** (`final-boundary-check.json`). Không sửa ACL TEMP; nó vẫn bị policy coi là không an toàn.

Receiver đã dừng trước cutover, không có process Office nào cần restart. Operation preflight xác nhận một source `omp-local`, cặp legacy token nhất quán và URL loopback; xác nhận artifact/destination/temp paths trước khi ghi. Token mới được tạo bằng `crypto.randomBytes(32)`, giữ trong bộ nhớ và private files, không in log/chat. Sau khi kiểm tra cặp mới và auth boundary, cài helper trước/index sau, xác nhận installed bytes, rồi xóa đúng hai obsolete credential files và obsolete single-file extension. Không giữ old-path/dual-token fallback.

Không có credential backup plaintext. Failure handler của operation chỉ in fixed code + phase, không raw JSON exception/stack có thể chứa token. Nếu một operation tương lai lỗi sau khi bắt đầu ghi credentials, phải kiểm tra phase và recover có mục tiêu; không chạy lại để sinh token khác hoặc restore token đã potentially disclosed.

## Durable code changes

- `integrations/omp/private-storage.js`: standalone shared helper, built-in Node modules; synchronous `privateRoot`, `preparePrivateFile`, `readPrivateJson`, `writePrivateJson`.
  - Windows: inbox PowerShell 5.1/.NET ACL-at-creation, protected private directory; existing ACL/owner/canonical DACL và ancestor replacement rights được kiểm trước access.
  - Reject reparse/symlink/hardlink, unsafe ancestor DELETE/DELETE_CHILD/WRITE_DAC/WRITE_OWNER/GENERIC_ALL, unsafe precreated directories/files. TrustedInstaller chỉ được tin trên ancestors, không trong private leaf/file.
  - Unix branch kiểm owner/mode, leaf0700/file0600 và stable ancestry; root-owned sticky temp là ngoại lệ có chủ đích. **Chưa chạy trên Unix trong lượt này.**
  - Bounded JSON reads, fixed sanitized errors, unique exclusive same-directory temporary files, flush/close/atomic rename. Không overwrite/unlink fallback, không retry che failure. Windows locked-reader sharing refusal giữ original và dọn temp.
- `server/agents/omp/bridge.mjs`: private storage trước reads/writes; chỉ missing file hoặc absent configured-source key mới provision. Malformed JSON/JSONnull/invalid present token/access failure fail closed thay vì tự sinh token làm lệch observer.
- `server/index.mjs`: default private receiver path; absolute `OFFICE_OMP_INGEST_FILE` override vẫn phải qua cùng policy. Khi policy fail, ingress không khởi tạo; file-only/Claude path vẫn độc lập.
- `integrations/omp/office-observer.js`: private settings default, shared helper; lazy default factory để import module không tự đọc home token. File lỗi làm telemetry disabled, không ảnh hưởng agent work.
- Hybrid fixtures dùng explicit run-unique private test store ngoài repository, computed ở parent trước fake HOME. Windows test leaf dưới stable real-home anchor nhưng **không dùng real default credential store**; cleanup chỉ xóa owned test file/empty directory. Không có security exemption cho TEMP hoặc fallback về user settings.

Current defaults không đọc `data/omp-ingest.json` hoặc `~/.omp/office-observer.json`. `.omp` phải tồn tại trước khi helper tạo private leaf. Các installation khác cần migration có chủ đích; không tự nhận broad/insecure old paths.

## Verification observed

Windows 10.0.26200 x64, Node24.22.1, OMP18.14.2. Browser: installed Playwright1.56.1/Chromium1194, ANGLE/D3D11, 1440×900, retries0, một worker; existing test/expect budgets90s/30s.

| Check | Kết quả | Evidence dưới `test-results-phase5/token-repair/` |
|---|---:|---|
| Focused storage/bridge/observer/Claude compatibility | **70/70 PASS**, 0 skip | `unit-focused-passed.log` |
| Full `node --test` | **268/268 PASS**, 0 fail/skip | `unit-full.log` |
| ESLint | PASS | `lint.log` |
| TypeScript noEmit | PASS | `typecheck.log` |
| Real isolated hybrid browser scenario | **1/1 PASS** | `hybrid-e2e.log` |
| Applied private directories/files DACL inspection | Trusted SIDs only; protected directory inheritance boundary | `acl-after.json` |
| Auth after in-process real bridge reload | old401 / new200 / foreign-source422 | `rotation-result.json`, `rotation.log` |
| Actual server HTTP routes | old401 / new200 / missing401 / Origin403 / foreign-source422 | `http-route-results.json` |
| Correlated fresh OMP observer → real routes | Explicit installed-directory load, default private settings, accepted OMP row, controls all false | `fresh-runtime-result.json` |
| Teardown/unrelated ACL boundary | Own ports4310/4422 released; own probe gone; original OMP parent still running; unrelated ACLs unchanged | `final-boundary-check.json` |

Commands dùng direct Node binaries: `node --test`; focused four files `omp-private-storage`, `omp-bridge`, `omp-observer`, `agent-compat`; `node node_modules/eslint/bin/eslint.js .`; `node node_modules/typescript/bin/tsc --noEmit`; Playwright CLI với temporary GPU wrapper của `playwright.hybrid.config.ts`. Wrapper đã dọn sau smoke. Browser test thực hiện mixed union, controls/privacy, wait/stale/end và reconnect trên private isolated store, không dùng token thật.

Actual route proof dùng source/data/Claude config synthetic riêng, existing `.next-phase5` build và default **real repaired private credential store**, chỉ bind127.0.0.1. Không mở user transcripts. Không rebuild frontend vì không có frontend source change; đây không phải full rollout E2E/build gate.

Actual HTTP observation xác nhận local OMP projection có `openWindow`, `closeSession`, `changeAccount`, `remoteControl`, `startTask`, `readConversation` đều false trong no-content runtime fixture. Token mới không cấp bất kỳ Claude/OMP control nào. Unit/hybrid checks giữ Claude/control/privacy boundaries.

## Fresh runtime acceptance và clean-exit limitation

Một OMP18.14.2 mới được chạy riêng ở RPC/no-session/no-tools, không prompt/model turn; sandbox agent/model config chỉ có scripted local endpoint không được gọi. HOME dùng đúng private-store default, không có token/source/settings env override. `-e <installed directory>` chứng minh directory package load; **không phải runtime proof của native automatic discovery** trên mọi profile. Native index-directory discovery là documented loader behavior.

Recorder ghi `session_start` và `session_shutdown` cho synthetic session `01a194fd-1336-7279-bcf8-04825e450b28`. Receiver snapshot có đúng source-derived public ID `omp:921df060a498a7f798e9aa7b70a5da2ba6c774a4c41df616370782a263336eed`, kindOMP, lifecycleended, controls false. Đây là correlated acceptance, không chỉ global ingress counter. **Không có `agent_start`/model turn** được quan sát.

**Failed check giữ nguyên:** process không tự thoát trong45s dù callback session_shutdown đã chạy. Đóng riêng stdin của probe → exit0; không đổi thành clean-exit PASS. Điều này cho thấy callback shutdown có xảy ra; không đủ kết luận nguyên nhân còn-handle/RPC-input, và không sửa OMP runtime ngoài scope. Token/ACL/auth acceptance độc lập vẫn hợp lệ.

Không dừng các OMP parent/child đang làm việc; không cố hot-reload token vào closure cũ. Những phiên đó có thể mất telemetry tới một fresh module/process load. Receiver trước đầu việc không chạy; receiver verification riêng đã dừng để trả trạng thái ban đầu, không tự bật Office lâu dài.

## Failure history và review

Không hạ policy/assertions để lấy PASS:

1. Gate đầu67 tests:55pass/12fail. Synthetic diagnostic của exact Windows script xác định TEMP có `CodexSandboxUsers` DELETE + DELETE_CHILD. Helper từ chối đúng; fixture Windows được chuyển sang unique protected child dưới stable home, không sửa TEMP/global ACL.
2. Lượt sau dùng nhầm retained build runner environment, `os.homedir()` trỏ nonexistent build-home:47pass/20fail, trước helper validation. Chuyển invocation sang explicit fresh unit environment; không mkdir fake build-home hoặc bỏ security checks.
3. Corrected-environment69tests:66pass/3fail. Hai fixture mutations dùng Set-Acl đòi SeSecurityPrivilege; sửa fixture DACL-only Access read/SetAccessControl, kiểm tra ACE thực sự có và owner/protection không đổi. Không elevate/grant privilege/skip.
4. Positive replacement giữ handle reader mở: diagnostic native `rename` **EPERM**; original preserved, temp0; sau khi đóng reader replacement thành công. Tách coverage theo OS semantics: Windows safe refusal, POSIX atomic old-reader semantics. Không sửa product bằng unlink/retry/overwrite fallback.
5. Independent review tìm JSONnull và invalid existing token có thể bị nhầm provisioning; synthetic before probe xác nhận cả hai. Đã sửa fail closed, thêm regressions actual null-file unchanged và invalid token no-write; cuối focused70/full268pass.
6. Fresh RPC idle-exit timeout được giữ như nêu trên; không rerun model/increase deadline để chứng minh giả.

Scoped simplifier chạy trên helper/tests, bỏ incidental mapping/wording assertions nhưng giữ behavior/security assertions. Independent security reviewer xác nhận malformed-store findings đã sửa, không còn concrete finding trong targeted recheck; counsel review operation trước real mutation và các failure checkpoints. Reviewers không chạy checks thay bảng evidence này.

## Residual scope / next

- Filesystem policy không chống runtime account, SYSTEM/Administrators hoặc code đã chạy với quyền tài khoản đó. Writable executable code/ambient extension injection là boundary khác; không reset cả repository hay `.omp` để tuyên bố đã giải quyết nó.
- Không thử đọc token bằng một tài khoản khác, không chứng minh historical theft hoặc absence of exploitation. Targeted own-output non-disclosure check không thay full history/dependency audit; không có Phase06 security clearance.
- Cross-host/WSL, exact ask-wait/live child support và plan cancellation/complete continuation limits vẫn theo local-validation report. **G4 vẫn OPEN**.
- Không commit/push/PR, không rollout. API keys/provider accounts không thay. Tài liệu setup/architecture và plan evidence đã cập nhật. Journal local theo preference; AgentWiki publish skipped.

## Final evidence housekeeping

Targeted exact-value scan trên **28 owned repair logs/JSON summaries và impacted source/docs files**: **0 old/new telemetry value matches** (`non-disclosure-check.json`); không đọc private stores để đưa vào report và không coi đây là full history/dependency audit. Temporary operation/wrapper/recorder/source config đã xóa; hai diagnostic fixture trees và synthetic route-data đã dọn. Logs và metadata evidence giữ lại trong ignored output.

[Local journal](../../journals/2026-11-01-private-telemetry-storage-and-coordinated-token-rotation.md) đã tạo qua CLI; **AgentWiki publish skipped**. Plan Phase04 vẫn in-progress/G4 OPEN, có evidence link tới remediation này.
