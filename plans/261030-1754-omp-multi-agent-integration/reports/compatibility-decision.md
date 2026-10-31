# Phase 01 — Compatibility decision và gate report

Ngày: **31/10/2026**, Asia/Ho_Chi_Minh. Workflow: portable `ak-cook` 2.5.1 qua Cloud Harness Local, thực hiện tuần tự; không chạy native AgentKit hooks/subagents.

**Cập nhật sau approval Phase 02:** người dùng đã duyệt synthetic-only source implementation và unit/lint/typecheck. Phần đó đã triển khai, full unit 45/45 PASS; G2 còn verification gap. Xem [Phase 02 implementation](./phase-02-implementation.md). Approval này không mở G1 live hoặc quyền Phase 03.

**Các mục bên dưới là snapshot lịch sử của riêng Phase 01:** lúc kết thúc lượt đó, documentation increment đã thực hiện, G1 BLOCKED và Phase 02 chưa được duyệt. Chưa có integration source/test fixtures trong lượt Phase 01, và không có live support nào được chứng nhận từ static inspection. Những câu “chưa được duyệt/không chuyển phase” trong snapshot này không hủy approval synthetic mới nêu trên.

## 1. Authority và baseline

Người dùng yêu cầu triển khai `/mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration/phase-01-start.md`. File phase quy định documentation-only, giới hạn writes ở bốn tài liệu hiện có và báo cáo này. Yêu cầu đó không tự phê duyệt các environment defaults hoặc các phase sau.

Workspace đã resolve: `my-office`, root `/mnt/e/vide-code/my-office`, branch `main`, HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`. Trước edits, tracked/cached diff rỗng; `.gitattributes` và 11 plan documents đã untracked từ trước. Không coi chúng là toàn bộ files do lượt cook này tạo.

Baseline hashes: `.gitattributes` = `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7`; Git index = `210a107b45eee6f77fb5aeaef937159171af262a064af0335486a3336dc8e9cd`. Kết quả đối chiếu cuối nằm trong [execution log](./plan-review.md).

Không đọc `.env`, auth, credentials, OMP configuration tổng quát hoặc personal transcripts; không quét home/ổ đĩa. Không chạy OMP để đoán version. Public source là read-only GET qua GitHub connector, không checkout/cài/chạy upstream source.

## 2. Version và topology matrix

| Target | Dữ liệu đã xác minh | Mức hỗ trợ hiện tại |
|---|---|---|
| My Office baseline | HEAD/root/branch như trên; scripts và Playwright config đã đọc lại | Source chưa thay đổi; không chạy regression trong Phase 01 |
| OMP public source candidate | Commit `6a86df8539fccf3ad7818081266e554022fc21bc`; `@oh-my-pi/pi-coding-agent` package `18.14.0`; session schema `3` | Static reference cho specification; không phải installed build hoặc runtime certification |
| OMP đang cài trên máy người dùng | Chưa có exact version/build, install metadata path được phép hoặc source-to-binary provenance | UNKNOWN; không thêm vào runtime version allowlist |
| v3 có/không optional title slot | Schema và parser helpers tại pin đã đọc | Candidate decoder contract; implementation/tests chưa tồn tại |
| Legacy v1/v2, unknown major | Không audit migration/decoder coverage ở phase này | UNSUPPORTED trong candidate implementation scope; fixture phải kiểm tra degraded/reject rõ, không sửa/migrate source |
| OMP Windows/WSL/cả hai | Windows 11 + WSL2 là project context; executor của My Office là Linux | OMP host, profiles, network mode và path mappings vẫn UNKNOWN |

Phiên bản package của public source không chứng minh binary cài trên máy có cùng behavior. Build stamp trong copied entries cũng không chứng minh runtime hiện tại. Nếu metadata sau này lệch pin, chỉ đối chiếu các contracts bị ảnh hưởng trước khi mở gate; không tự nâng cấp OMP.

## 3. Feature compatibility matrix

**Legend:** `exact` = đã thấy declaration và implementation/helper hoặc nhánh emission cụ thể tại source pin; không đồng nghĩa đã kiểm chứng mọi caller/mode. `inferred` = declaration/docs hoặc một phần đường gọi, còn gap rõ. `unsupported` = không có evidence để cung cấp khả năng đó trong contract đề nghị. Cột live giữ NOT VERIFIED cho đến khi chạy đúng build/mode đã được duyệt. IDs O1–O17 trỏ tới [evidence ledger](../evidence.md).

| Feature | Declaration/schema | Helper/emission/call path đã đọc | Classification / gap | Acceptance |
|---|---|---|---|---|
| Session v3 + optional title slot | O1: CURRENT_SESSION_VERSION=3, title slot 256 bytes | O10: splitTitleSlot → parseSessionContent → applyTitleSlot | exact static parsing helper; không import writable loader/migration/blob machinery; live NOT VERIFIED | F1/F2, SF01 |
| Current leaf / branch | O1: parentId, activeLeafId optional/null | O11: sessionEntryLeafId, lastSelfSelectedLeafId, resolveSessionLeafId | exact helper semantics; full manager/context reconstruction call chain còn inferred | F7, SF05 |
| Runtime writer stamp | O1/O9: version, optional commit/branch/diff/label | O9: currentRuntimeIdentity, runtimeIdentityHistory | exact build provenance; unsupported làm process ID/generation/liveness | F13/R12, SF13 |
| tool_execution_start/update/end | O12: toolCallId/toolName; args/partialResult/result/isError | Chưa kiểm chứng producer → session → extension runner đầy đủ | inferred, declaration-only cho emission coverage; live NOT VERIFIED; không implement event names như đã được certify | R2/R10, SF11 |
| tool_approval_requested/resolved | O12: sessionId/toolCallId/toolName và approved | O13: ExtensionToolWrapper.execute nhánh required, awaited runner.emit; no-UI/error/deny paths | exact nhánh emission tại pin; không bao phủ mọi mode/dispatcher; silence không chứng minh waiting | R3/R10/R11, SF12 |
| Session start/switch/branch/tree/shutdown | O14: shared event types và reasons | Chưa audit lifecycle emitters/runner dispatch/shutdown modes | inferred; callback generation/snapshot phải test riêng; live NOT VERIFIED | R1/R10/R12, SF13 |
| Agent/turn end | O14: agent_end có willContinue/awaitingAsyncWork | Chưa kiểm chứng settle/background-job call chain | inferred; unsupported kết luận terminated chỉ từ agent_end | R4/R5, SF13/SF15 |
| Child identity | O15: kind main/sub, registry id/parentId, depth | Docs child factories; wrapper có agent override cho tool interception | inferred tổng thể; kind=sub với depth=0 hợp lệ; không dùng entry.parentId làm parent agent | F9/R8, SF08 |
| Tools và args | O12: execution.args khác tool_call.input | O13: loop/direct-dispatch distinction, normalize/resolve tool input và effectiveParams | exact phần wrapper đã đọc; taxonomy/provider custom tools chưa đủ; unknown category an toàn, không phát args | R2/S4, SF10/SF11 |
| Usage từ raw file | O1: assistant/model_usage records; O16: UsageStatistics | O16: normalizeAssistantUsage có missing-to-zero behavior | exact normalization risk; inferred aggregation/provenance; không import helper để biến unknown thành observed zero | U1/U3/U4/U6, SF14 |
| Cost của subtree/fork | O16: subagentCost được khai báo nằm trong cost; O1: lineage | Chưa audit aggregation/copy attribution đầy đủ | inferred; unsupported grand total khi chưa phân biệt inherited/self/delegated | U2/U5, SF06 |
| Context snapshot | O3 mô tả usage/context APIs; snapshot có thể đã normalize | Chưa chứng minh context/token provenance cho đúng bản cài và event context | inferred; unknown contextWindow/cost giữ null, không fallback Claude | U4/U6, SF14 |
| Ask/plan-review/input waiting | O12 có input/plan-review declarations | Chưa audit tất cả UI/RPC emission/cancel paths | inferred; universal waiting detection unsupported; không gọi resolution/control APIs | R3/R10, SF12 |
| File-only current liveness | File/header/mtime/persisted markers | Không có runtime heartbeat từ file | unsupported; chỉ persisted/history evidence, live unknown | F2/F8/F13, SF01/SF13 |
| Credential/cache/path metadata | O17: cache keys, credential pin hash, previous paths/seanceSource | Schema/comments đã thấy; không mở referenced paths | exact presence/risk; public projection phải drop, không coi hashed identity là vô hại | S4/S9, SF09/SF10 |

Không có row nào ở trên được đánh dấu LIVE VERIFIED. Runtime coverage cần exact installed build và actual emission evidence R10; fake `pi` tests không thay thế việc đó. Helper semantics được dùng làm synthetic specification, không nâng thành proof rằng My Office đã xử lý được file.

### Subagent support boundary / D9

| Loại | Source evidence | Scope đề nghị / giới hạn |
|---|---|---|
| Task child | O4 persisted registry scout; O15 identity/factory docs | Ứng viên đầu tiên cho tree + lifecycle, sau khi lock version và verify emissions |
| Nested task, eval agent, `/tan` | O15 nêu fresh binding; depth không đủ phân loại | Synthetic cases cần có; không hứa full live coverage trước actual-mode proof |
| Advisor | Shared wrapper có override cho tool_call/tool_result | Quan sát đúng phần evidence có; không giả lập đầy đủ execution/lifecycle stream hoặc actor riêng nếu identity thiếu |
| Parked/revived/tombstoned artifacts | O4 scout evidence, chưa tái chạy registry | Historical/catalogue data; không tự chuyển thành live worker |
| Fork/continuation | O1 parentSession/continuationOf | Quan hệ hội thoại, không phải subagent chỉ vì có parent field |

## 4. Các quyết định chưa thể chốt thay người dùng

| ID | Trạng thái | Input/approval còn thiếu |
|---|---|---|
| D1 | BLOCKED | Exact OMP version/build; install mode và provenance, hoặc exact metadata file path được phép đọc. Không cần credentials/transcript |
| D2 | BLOCKED | OMP chạy Windows, WSL hay cả hai; placement của từng source/profile |
| D3 | BLOCKED | Approved absolute session roots; stable source/profile IDs; mapping source path → reader path và approved project roots. Allowlist hiện rỗng |
| D4 | PROPOSED, chưa duyệt | Metadata-only policy; conversation off hay opt-in với phạm vi cụ thể; no outbound translation |
| D5 | DOC CHECKS ONLY | U: unit/lint/typecheck; E1: isolated E2E; B: build/app; P: benchmark; L: live smoke phải được cấp quyền riêng |
| D6 | NOT AUTHORIZED | Extension install/config/activation ngoài repository, trước live Phase 4 |
| D7 | PROPOSED | Per-session recorded estimate, inherited flag; tách self/delegated khi chứng minh được; không tổng toàn máy khi thiếu attribution |
| D8 | PROPOSED | Group repo chỉ theo approved canonical mapping; giữ worktree identity; không merge basename |
| D9 | PROPOSED | Task children trước, support matrix minh bạch cho nested/eval/tan/advisor; unknown không giả complete |
| D10 | NOT VERIFIED | Transport/network topology và ACL; không mở LAN/firewall hoặc bearer qua untrusted plain HTTP |

Phạm vi được phê duyệt hiện tại là **synthetic fixture specification bằng Markdown**, không phải synthetic-only source implementation. Không sử dụng điều kiện thay thế của G1 để tự waive các quyết định môi trường. Nếu một phase sau được duyệt chỉ với synthetic inputs, approval phải nói rõ boundary và vẫn không cấp live activation.

## 5. Acceptance, fixtures và permission manifest

Đã bổ sung [permission manifest và SF01–SF17](../validation-matrix.md#10-phase-01-permission-manifest), gồm schema/title/framing, rewrite recovery, active leaf, fork/delegated cost, namespace/worktree, child types, containment/errors, privacy poison, parallel tools/approval, generation, nullable usage, reconciliation, quotas/dispose và Claude compatibility-off.

Mỗi fixture được đặc tả input/sequence, expected assertion và coverage. F13/U5/U6/R11/R12/S9 bổ sung các regression case phát hiện trong lượt này. Đây là **17 fixture specifications, không phải 17 tests đã tạo hoặc pass**. Tất cả application tests vẫn NOT RUN.

G3 nghiệm thu persisted-only observability: decoder/branch/rewrite/idempotence/privacy/read-only đúng và Claude regression không bị phá; file không chứng minh current thinking/tool/wait/process liveness. G4/G5 cần thêm actual-mode callback evidence, runtime generation, bounded observer, auth/reconnect/reconciliation và UI mixed-agent/control isolation. Không hứa exactly-once, không coi ACK là crash durability, không coi heartbeat timeout là completed.

Unit sau này không network/model/agent data, không import server startup. E2E phải override HOME/USERPROFILE/OFFICE_DATA_DIR và CLAUDE_CONFIG_DIR, clear inherited OMP env, dùng synthetic roots và tắt outbound. Build/app/benchmark có quyền riêng; thiếu package/browser không được auto-install. Permission manifest hiện không cho các nhóm đó chạy.

## 6. Phase 01 task disposition

| Task trong phase | Kết quả lượt cook này |
|---|---|
| 1. Baseline/root/hash | Đã thực hiện; bằng chứng B1–B7 và đối chiếu cuối trong review |
| 2. D1/D2 version/topology | Public source candidate đã pin; installed build/topology còn BLOCKED |
| 3. D3/D4 roots/privacy | Ranh giới đọc được ghi explicit, allowlist rỗng; chưa có user decision để chốt |
| 4. Compatibility matrix | Đã lập, tách declaration/helper/emission gaps và exact/inferred/unsupported; actual runtime chưa xác minh |
| 5. G3 vs G4/G5 acceptance | Đã đặc tả; chưa đạt gate hoặc thực thi tests |
| 6. D7–D9 cost/grouping/children | Đã làm rõ proposed contracts + concrete assertions; chưa có approval quyết định |
| 7. Test boundary | Đã ghi quyền thực tế, không tạo blanket approval; chỉ docs validation được chạy |
| 8. Fixture specification + manifest | Đã bổ sung; source/live/source-test execution vẫn blocked |

## 7. Handoff và rollback

**Không chuyển sang Phase 02.** Cần chốt D1–D4 và D7–D9, xác định nhóm validation được duyệt, rồi review G1/approval cho phase tiếp theo. Không yêu cầu người dùng gửi transcript, secrets hoặc toàn bộ configuration.

`plan.md` và `phase-01-start.md` được giữ nguyên vì không nằm trong write allowlist; frontmatter/checklists pending không bị tự sửa thành completed. Current execution state được ghi trong báo cáo này và [plan review](./plan-review.md). Không chạy plan state/index mutations hoặc tạo external journal ngoài scope; execution log lưu ngay trong report được phép.

Rollback chỉ liên quan nội dung documentation được thêm/sửa trong năm files của Phase 01; không xóa/restore source hay reset Git. Đây không phải rollout và không có thay đổi hiệu năng để công bố.
