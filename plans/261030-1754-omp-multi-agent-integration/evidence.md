# Evidence ledger và source map

## Trạng thái hiện tại — RAIL-01 repair, 31/10/2026

RAIL-01 đã được sửa theo approval mở rộng `activity.js`. Lint/typecheck/rebuild PASS; unit 48/48 PASS; agents E2E 6/6 PASS, gồm original rail assertion. Selected Claude regression tại 1440×900: 3/4 PASS ở 180s/trace-on, 2/4 PASS ở mặc định 90s/trace-off (panels/drawer timeout, ghi nhận popup chặn click); **không đánh dấu G2 đạt toàn bộ**. Kết quả diagnostic và trạng thái cuối cùng xem [repair report](./reports/phase-02-rail01-fix.md). Giữ OMP off; không Phase 03, commit hoặc push.

## Hồ sơ lịch sử trước lượt sửa RAIL-01

Các kết luận blocked, NOT RUN hoặc số lượng tests bên dưới thuộc những lượt trước. Không ghi đè lịch sử failures bằng kết quả mới.

## Historical execution evidence — runtime validation, 31/10/2026

Production build PASS; isolated HTTP lifecycle/log ownership/foreign-provider denial 2/2 PASS. Agent browser 5-case run: 4 PASS / 1 FAIL tại RAIL-01; independent List Mode test 1/1 PASS. Existing regression đã thực thi, có timeout theo budget 90s; kết quả rerun giữ assertions và final quality checks được cập nhật ở [runtime validation](./reports/phase-02-runtime-validation.md).

Source evidence mới: `src/office/ui/activity.js:127` chỉ khai báo groups wait/work/rest; `renderRail()` ở line 215 chỉ append session theo các groups này. Điều này khớp browser failure không tìm thấy OMP rail element dù session tồn tại trong scene/drawer. Không sửa file ngoài allowlist; G2 chưa pass. Đây là runtime evidence synthetic, không chứng nhận OMP installed schema/build hoặc mở G1 live.

Các mục bên dưới giữ nguyên lịch sử theo từng lượt, không thay thế trạng thái mới nhất nói trên.

## Phase 02 execution evidence — 31/10/2026

Approval mới: Phase 02 synthetic-only source + unit/lint/typecheck. Đây là lượt sau Phase 01; các mục Phase 01 bên dưới là lịch sử. [Implementation report](./reports/phase-02-implementation.md) chứa exact files, commands, acceptance gaps và permission boundary.

| ID | Evidence trong worktree hiện tại | Kết quả / giới hạn |
|---|---|---|
| P2-1 | `workspace_list`, root, HEAD, protected hashes | Đúng my-office; HEAD và .gitattributes/Git index giữ nguyên; không đổi workspace/branch/remote |
| P2-2 | `server/agents/schema.mjs`, `projection.mjs`, `registry.mjs`, `claude/compat.mjs` | Bốn module đã tồn tại, runtime validation và synthetic facade tests; không có live OMP driver |
| P2-3 | `server/index.mjs`: legacyPub/pub/agents, replaySnap/snapNow, control routes, api/log | Additive Claude metadata và owner dispatch/guards; private Claude store không union |
| P2-4 | `workers.js`, drawer/account/lite, quota/accountant | Provider guards, unknown/null rendering, generic assistant, không dùng OMP cost/quota như Claude |
| P2-5 | Baseline `npm test` | 22/22 PASS trước application edits |
| P2-6 | Focused agent tests; full `npm test` | 23/23 mới; 45/45 full PASS, không skipped/todo; synthetic/unit, không app startup |
| P2-7 | `node --check` 16 files | PASS syntax cho 13 application JS/MJS, 2 unit MJS, 1 E2E TS; không phải tsc hoặc browser validation |
| P2-8 | `npm run lint`, `npm run typecheck` | Trước/sau đều exit 127: eslint/tsc not found; node_modules không tồn tại; không cài package |
| P2-9 | `tests/e2e/agents.spec.ts` | Bốn ca đã viết; E2E/build NOT RUN; cần approval và isolated environment |
| P2-10 | `ak plan resolve`, `ak plan update` | Plan ID my-office/261030-1754 xác minh tại cwd; status in-progress, current phase 2; không check/close toàn bộ phase |

Public OMP source pin ở O1–O17 vẫn chỉ là static reference. P2 không chạy OMP, đọc transcript/config/auth/credential, mở listener hoặc benchmark. Không nâng source declaration thành live support. G1 live chưa giải quyết; G2 runtime verification chưa đạt.

## Phase 01 execution evidence — 31/10/2026

Phiên này dùng portable `ak-cook` 2.5.1 qua Cloud Harness, theo yêu cầu triển khai **chỉ** `phase-01-start.md`. Đã đọc workflow/review/files-first references, phase/index/contracts/validation/review và `CONTRIBUTING.md`, `package.json`, `playwright.config.ts`. Không chạy native hooks/subagents; không thay source. Trạng thái hiện tại và compatibility matrix nằm trong [compatibility decision](./reports/compatibility-decision.md).

### P01 baseline và permission evidence

| ID | Kiểm tra | Evidence thực tế |
|---|---|---|
| B1 | `workspace_list` + `workspace_context` | Workspace `my-office`, root `/mnt/e/vide-code/my-office`, executor platform Linux; không thao tác workspace khác |
| B2 | `pwd`, `git rev-parse --show-toplevel HEAD`, `git branch --show-current` | Root đúng; branch `main`; HEAD `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`, khớp scout |
| B3 | `git_status`, read-only tracked/cached diff | Đầu phiên tracked/cached diff rỗng; `.gitattributes` và 11 plan docs đã untracked từ trước. Untracked không có nghĩa là file do phiên này tạo |
| B4 | `sha256sum .gitattributes .git/index` | Lần lượt `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7` và `210a107b45eee6f77fb5aeaef937159171af262a064af0335486a3336dc8e9cd`, khớp plan baseline |
| B5 | CLI availability + `ak plan --help`, `ak plan validate --help` | `/home/harness/.local/bin/ak` tồn tại và executable; live help ghi validate read-only, exit 0 valid/3 invalid |
| B6 | Instructions lookup có giới hạn | Không có AGENTS.md/CLAUDE.md ở root, `plans/` hoặc plan directory được kiểm tra; không quét home/config người dùng |
| B7 | Test scripts và isolation static read | Các npm scripts vẫn tồn tại; Playwright đặt HOME/USERPROFILE/OFFICE_DATA_DIR, tắt OFFICE_TRANSLATE/USAGE/CI; không override CLAUDE_CONFIG_DIR hay clear mọi OMP override trong config hiện tại |
| B8 | D1–D4 inputs | Windows 11 + WSL2 là project context đã có; không có exact installed OMP version/build, OMP host, approved session roots hoặc privacy decision. Không chạy `omp`, đọc transcript/auth/config hoặc quét cài đặt để tự điền |

Không tái khảo sát toàn bộ application source vì HEAD và tracked diff chưa đổi. Không nâng mức source facts M1–M20 thành test evidence. Kết quả kiểm tra cuối được bổ sung tại [review execution log](./reports/plan-review.md).

### OMP static verification bổ sung tại cùng source pin

Tất cả nguồn bên dưới đọc qua GitHub connector tại **`6a86df8539fccf3ad7818081266e554022fc21bc`**, không phải default branch. Search default branch chỉ được dùng để tìm đường dẫn, không làm compatibility evidence. `exact` ở đây là static source evidence, không phải live support của bản cài người dùng. Những emission path chưa đọc vẫn ghi rõ gap.

| ID | Nguồn pinned đã đọc | Kết luận / giới hạn |
|---|---|---|
| O9 | [package.json:1-38][o9-package]; [runtime-identity.ts:1-160][o9-runtime] | Package tham chiếu `18.14.0`; RuntimeIdentity gồm version và optional commit/branch/diff/label. Installed builds và source builds ghi khác nhau; đây là writer build stamp, không phải process/generation identity. Installed version người dùng vẫn UNKNOWN |
| O10 | [session-loader.ts:1-250][o10-loader] cùng O1 | `splitTitleSlot` → `parseSessionContent` → `applyTitleSlot` chứng minh optional title-slot handling. Loader còn có accounting normalization/blob/migration machinery; không import làm read-only adapter |
| O11 | [session-entries.ts:360-386][o11-leaf] | Đọc `sessionEntryLeafId`, `lastSelfSelectedLeafId`, `resolveSessionLeafId`: null khác missing; dangling captured leaf có fallback. Đã đọc helper implementation; chưa audit toàn bộ reconstruction/callers |
| O12 | [extensions/types.ts:1230-1510][o12-events] | Execution events có toolCallId/name, args/partialResult/result/isError; approval có sessionId; plan-review/input có type declarations. Execution/input/plan-review emission coverage chưa được kiểm chứng trong phiên này |
| O13 | [extensions/wrapper.ts:240-520][o13-wrapper] | `ExtensionToolWrapper.execute` phân biệt loop dispatch/direct dispatch; approval nhánh required có awaited `runner.emit`, resolved false khi không có UI/lỗi/denied. Đây là emission path thật tại pin; chưa chạy hoặc chứng minh mọi runtime mode |
| O14 | [shared-events.ts:1-220][o14-shared] | Khai báo session_start/switch/branch/tree/shutdown và agent_end; switch reason new/resume/fork; agent_end có willContinue/awaitingAsyncWork. Chưa đọc đầy đủ emission/call path của lifecycle; không đánh dấu exact live |
| O15 | [types.ts:532-568][o15-identity]; [extensions.md:36-67][o15-factories] | kind main/sub khác depth; depth 0 cũng là child; registry parentId khác entry.parentId. Docs mô tả fresh child factories với shared module state. Child/advisor lifecycle emission chưa được kiểm chứng; wrapper chỉ chứng minh một phần tool interception context |
| O16 | [session-loader.ts:45-98][o16-usage]; [session-entries.ts:399-414][o16-stats] | `normalizeAssistantUsage` điền optional usage thiếu thành 0; UsageStatistics khai báo subagentCost là phần direct-child cost trong cost. Chưa đọc aggregation implementation hoặc xác nhận provenance snapshot trên bản cài; không tự dùng totals làm raw observed usage |
| O17 | [session-entries.ts:41-76][o17-header]; [session-entries.ts:249-270][o17-credential] | Header có cache keys/previousSessionFiles/seanceSource; credential pin hash là định danh có thể liên kết, không phải dữ liệu an toàn để phát mặc định. Cần projection allowlist và synthetic leak assertions |

Blob SHA dùng để đối chiếu nguồn: package `8251aaaa9b95e5e0a31ec96d86c9828b951b3bea`; session-entries `8b4391bdf590f7596988b447776753de1fc39ce4`; runtime-identity `0909bafb8cb7ff3e75db09063a88aa9832a94359`; session-loader `d3d913df03ffd2eeb93963035eaaa692c0344d04`; extension types `a5515b9a5452d0c8dc94be7b58f1c7fbf10c9875`; wrapper `43a8445f78cc8f30a2c45f080796dc9515fde040`; shared-events `96325f04b6394aa96f028fb252329ae12ac4c1be`; extensions docs `463417dd743c5d18aa8ba5fcc7bc2549e9332838`.

Giới hạn retrieval: direct web fetch trả cache miss và thử đọc raw public URL từ container thất bại DNS; không có source/runtime nào được chạy hoặc cài. Bằng chứng O9–O17 chỉ dựa trên các lần GitHub connector đọc thành công. Một số output lớn bị truncate; các vùng cần dùng đã đọc lại ở khoảng dòng hẹp, không coi phần bị cắt là đã xác minh.

[o9-package]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/package.json#L1-L38
[o9-runtime]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/runtime-identity.ts#L1-L160
[o10-loader]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-loader.ts#L1-L250
[o11-leaf]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-entries.ts#L360-L386
[o12-events]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/extensibility/extensions/types.ts#L1230-L1510
[o13-wrapper]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/extensibility/extensions/wrapper.ts#L240-L520
[o14-shared]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/extensibility/shared-events.ts#L1-L220
[o15-identity]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/extensibility/extensions/types.ts#L532-L568
[o15-factories]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/extensions.md#L36-L67
[o16-usage]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-loader.ts#L45-L98
[o16-stats]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-entries.ts#L399-L414
[o17-header]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-entries.ts#L41-L76
[o17-credential]: https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-entries.ts#L249-L270

## Baseline đã xác minh trong phiên lập kế hoạch

- Workspace được resolve lại bằng `workspace_list`: `my-office`, `/mnt/e/vide-code/my-office`; không dùng workspace khác.
- HEAD: `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`; branch `main`; trước khi scaffold chỉ `.gitattributes` untracked.
- SHA-256 đầu phiên: `.gitattributes` = `66d1acccd4041448dd0ecc4bffb200d5b9c736a8680bd1c675cdb24cfbda92d7`; `.git/index` = `210a107b45eee6f77fb5aeaef937159171af262a064af0335486a3336dc8e9cd`.
- Portable `ak-plan` 2.2.2 đã đọc qua Cloud Harness; live CLI help xác nhận `create`, `add-phase`, `validate`. CLI tạo thư mục hiện tại và 6 phase stubs; tất cả stubs đã được đọc trước thay nội dung.
- Không có AGENTS.md/CLAUDE.md/plans hiện hữu được phát hiện trong lượt tìm scoped; đã đọc CONTRIBUTING.md và tái sử dụng source/report scout cùng HEAD.

## My Office: VERIFIED source facts

Đường dẫn dưới đây tính từ root đã xác minh, dòng tham chiếu theo HEAD nêu trên. Symbol là điểm neo nếu số dòng thay đổi.

| ID | Nguồn | Điều đã xác minh / tác động |
|---|---|---|
| M1 | `server/index.mjs:260` newSession; `:269` pub | Public projection gắn state/account/usage của Claude; phải có OMP projection riêng |
| M2 | `server/index.mjs:618-748` scanSessions/doScan/usage interval | Scan, stale cleanup và usage dùng Claude conventions; không đưa OMP vào Map cũ |
| M3 | `server/index.mjs:761` onHook; `:189` classify | Claude hook/tool normalization; không sửa protocol để giả lập OMP |
| M4 | `server/index.mjs:424-460,2131-2161` | SSE, long-poll, replay là điểm tái sử dụng; write buffers cần kiểm soát khi tăng event rate |
| M5 | `server/index.mjs:897` readLog; `:2163` /api/log | Parser/roles Claude cần adapter dispatch, legacy fallback |
| M6 | `server/index.mjs:604,1909-1943` tasksOut/tasks | Task dispatch hiện nhận session sid/cwd; OMP không được trở thành Claude task target |
| M7 | `server/index.mjs:1748,2022-2055` | openWindow/macOS và system/account controls; phải giữ source ownership |
| M8 | `src/shared/timeline.js:16-82` buildTimeline | Rows keyed theo name; phải thêm stable key cho data mới, legacy replay giữ fallback |
| M9 | `src/office/ui/session-drawer.js:65-95` renderActions/actionsSig | Controls dựa isLocal/pid, acctActions và /rc fallback; không đủ cho multi-agent |
| M10 | `src/office/people/workers.js:38-47` agentOf/agentMark | Có logo scaffold claude/codex/gemini, chưa omp |
| M11 | `src/office/net/live.js` projOf/upsertSession/removeSession | Project grouping dựa basename và subs Map dùng child id; cần keys namespaced |
| M12 | `src/office/life/quota.js:27,121` | Missing acct rơi về Claude main account; OMP có thể bị quota-break nhầm |
| M13 | `src/office/people/accountant.js:93,169` | Cost consumers quét mọi sessions; cần scope/provenance để không cộng inherited OMP cost |
| M14 | `src/office/ui/lite.js:34` | Có phép ctx/ctxMax khi usage tồn tại; nullable OMP usage phải render an toàn |
| M15 | `server/usage.mjs` readNew/scanUsage; `server/index.mjs:119-186` | Có incremental pattern tái sử dụng ý tưởng, không schema; translation có external fetch |
| M16 | `tsconfig.json:5-6`; `CONTRIBUTING.md` Scripts | allowJs=true, checkJs=false: typecheck không thay được JS runtime/unit validation |
| M17 | `package.json:16-25` | lint/typecheck/node --test/Playwright scripts tồn tại; chưa chạy trong plan |
| M18 | `playwright.config.ts:1-34` | E2E có HOME/USERPROFILE/DATA_DIR isolation, OFFICE_* tắt outbound và OFFICE_DIST_DIR |
| M19 | `tests/e2e/office.spec.ts:52,234,288,389,573,708,758` | Có security, chat/tasks, test-board, accountant và quota tests; không được làm mất regression |
| M20 | `src/office/core/loop.js`, `src/office/scene/quality.js` | Frame budget, Low Quality/List Mode có sẵn; List Mode chưa tương đương không tạo WebGL |

Các facts M1-M5/M7/M10-M11/M15/M20 tái sử dụng lượt scout cùng HEAD; một số điểm đã grep/đọc lại trong phiên plan. Các M6/M8/M9/M12-M14/M16-M19 được kiểm tra tập trung để hoàn thiện ownership và validation. Không tuyên bố đã đọc lại mọi file của repository.

## OMP: nguồn chính thức ở commit cố định

Mốc scout: `6a86df8539fccf3ad7818081266e554022fc21bc`. Đây không phải xác nhận bản đang cài. Public source đọc qua GitHub connector; không clone hoặc truy cập OMP checkout local.

| ID | Nguồn chính thức | Evidence / mức xác minh |
|---|---|---|
| O1 | [session-entries.ts](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/session/session-entries.ts#L16-L130) | VERIFIED lại trong plan: v3, 256-byte title slot, continuationOf, parentId, activeLeafId, runtime |
| O2 | [Session storage](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/session.md) | VERIFIED trong scout: paths, roles/toolCall/toolResult, lazy persistence, rewrite và custom exit markers |
| O3 | [Extension types](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/extensibility/extensions/types.ts) | VERIFIED trong scout: tool execution events, approval notifications, read-only sessionManager, ctx.agent, usage, managed timers; event emission/order/version thực tế phải G1/G4 kiểm chứng |
| O4 | [Persisted agents](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/coding-agent/src/registry/persisted-agents.ts) | VERIFIED trong scout: artifact-tree discovery, parent ownership, parked/advisor/tombstone distinctions |
| O5 | [SDK](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/sdk.md) và [RPC](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/rpc.md) | VERIFIED trong scout: embedding/stdio protocol; không có bằng chứng passive attach vào mọi TUI |
| O6 | [Collab](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/collab.md) | VERIFIED trong scout: local host snapshots hữu ích, chỉ khi Collab publish; list có prune nên không chạy |
| O7 | [Directory helpers](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/packages/utils/src/dirs.ts) | VERIFIED trong scout: profiles, agent-dir overrides, XDG; cần configured roots |
| O8 | [Extensions](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/extensions.md) và [Hooks](https://github.com/can1357/oh-my-pi/blob/6a86df8539fccf3ad7818081266e554022fc21bc/docs/hooks.md) | VERIFIED trong scout: runtime ưu tiên extension runner; factories/child binding; không áp Claude hook contract |

Cảnh báo source-vs-doc: source O1 có activeLeafId, vì vậy không dùng câu đơn giản hóa 'last physical entry luôn là active leaf'. Decoder bám schema/source của version đã khóa, không chỉ một đoạn tài liệu.

## Platform evidence và giới hạn

[P1: Microsoft WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking) đã đọc lại: NAT và mirrored khác hành vi localhost. Không suy phiên bản/network mode đang bật trên máy từ tài liệu này.

INFERRED: hybrid đáp ứng durability + realtime tốt hơn file-only trong mục tiêu này; chưa có số đo overhead. UNKNOWN: OMP version thực tế, roots, Windows/WSL placement, live event coverage, filesystem replacement semantics và performance baseline. Không đọc credentials, ~/.omp/agent data, .env, auth hoặc session transcripts cá nhân trong phiên plan.

**Cập nhật 31/10/2026 (Windows native) — G2 vẫn OPEN, chờ quyết định điều kiện nghiệm thu.** Hai timeout Claude là lỗi môi trường có sẵn từ HEAD sạch: Chromium mặc định dùng SwiftShader nên mỗi frame chặn main thread ~3 s; có GPU thì panels PASS 10/10, session drawer còn cold start 31–35 s so với budget 20 s (3/10 FAIL). Không đổi source. Chi tiết, số liệu và đề xuất: [Windows-native diagnosis](./reports/phase-02-g2-windows-native-diagnosis.md). Lịch sử các lượt trước giữ nguyên.

