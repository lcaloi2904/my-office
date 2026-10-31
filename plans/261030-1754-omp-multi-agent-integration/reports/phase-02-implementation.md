# Phase 02 — Synthetic compatibility seam: implementation và verification

## Trạng thái hiện tại — RAIL-01 repair, 31/10/2026

RAIL-01 đã được sửa theo approval mở rộng `activity.js`. Lint/typecheck/rebuild PASS; unit 48/48 PASS; agents E2E 6/6 PASS, gồm original rail assertion. Selected Claude regression tại 1440×900: 3/4 PASS ở 180s/trace-on, 2/4 PASS ở mặc định 90s/trace-off (panels/drawer timeout, ghi nhận popup chặn click); **không đánh dấu G2 đạt toàn bộ**. Kết quả diagnostic và trạng thái cuối cùng xem [repair report](./phase-02-rail01-fix.md). Giữ OMP off; không Phase 03, commit hoặc push.

## Hồ sơ lịch sử trước lượt sửa RAIL-01

Các kết luận blocked, NOT RUN hoặc số lượng tests bên dưới thuộc những lượt trước. Không ghi đè lịch sử failures bằng kết quả mới.

Ngày: **31/10/2026**, Asia/Ho_Chi_Minh. Repository: `/mnt/e/vide-code/my-office`. Workflow: portable `ak-cook` 2.5.1 qua Cloud Harness Local; triển khai và review tuần tự.

**Trạng thái mới nhất ngày 31/10/2026: production build PASS, HTTP lifecycle/ownership PASS; browser đã chạy và phát hiện RAIL-01, nên G2 chưa pass.** Chi tiết kết quả cuối, selected regression, browser prerequisites và artifacts nằm trong [runtime validation](./phase-02-runtime-validation.md). Lint/typecheck/unit đã PASS sau dependency repair; lịch sử từng lượt được giữ bên dưới. Không có OMP live adapter, file observer, bridge hoặc extension được bật; Phase 03 chưa được mở.

## 1. Approval và baseline

Người dùng đã trả lời **“Ok. Triển đi”** cho đề xuất Phase 02 synthetic-only: adapter facade/schema/compatibility, feature off mặc định, guards và unit/lint/typecheck; không cài dependencies, không đọc session thật; build/E2E cần approval riêng. Đây là exception được duyệt cho phần synthetic của G1, không phải xác nhận installed OMP version, roots, privacy dữ liệu thật hoặc topology.

HEAD trước/sau source edits: `0ff1e84e2a96325edfc8fce751cc0ffe4248451f`, branch `main`. Trước edits tracked/cached diff rỗng; `.gitattributes` và 12 tài liệu plan đã untracked từ trước. Không coi toàn bộ untracked là file do lượt này tạo.

Baseline runtime: Node `v24.22.1`, npm `11.19.1`, Cloud Harness Linux/WSL trên repository Windows-hosted. Không có `node_modules`. Baseline `npm test`: **22/22 PASS**. Baseline lint/typecheck bị chặn bởi thiếu `eslint`/`tsc`, exit 127; không cài package để vượt giới hạn quyền.

## 2. Source đã triển khai

| File | Action / thay đổi |
|---|---|
| `server/agents/schema.mjs` | Create: classification, server-owned capabilities, opaque OMP namespace/session identity, mode parsing và Claude request ownership |
| `server/agents/projection.mjs` | Create: additive Claude projection; OMP metadata allowlist, usage null và nullable metrics có provenance; không forward PID/account/path/prompt/title/credential identity |
| `server/agents/registry.mjs` | Create: injectable list/resolve/readConversation/start/dispose, identity checks, optional-adapter isolation, bounded diagnostics; không import runtime OMP |
| `server/agents/claude/compat.mjs` | Create: callbacks tới Claude store/log reader cũ; không sở hữu scanner hoặc control lifecycle mới |
| `server/index.mjs` | Modify: giữ `legacyPub`, additive `pub`; snapshots/replay qua registry; `/api/log` dispatch theo owner; task/open/account-move guards; diagnostic mode; dispose khi server close |
| `src/office/people/workers.js` | Modify: OMP/unknown labels và generic glyphs, legacy fallback, pure capability/quota/cost/context helpers |
| `src/office/ui/session-drawer.js` | Modify: control/conversation guards, stale-click rechecks, không `/rc` cho non-Claude; nullable usage, unknown activity/duration, generic assistant labels |
| `src/office/ui/session-account.js` | Modify: guard trước account controls và trước request move |
| `src/office/ui/lite.js` | Modify: unknown group không mất row; provider label; không NaN hoặc invent duration từ unknown |
| `src/office/life/quota.js` | Modify: non-Claude không fallback main account; bỏ accidental foreign-worker quota break |
| `src/office/people/accountant.js` | Modify: chỉ tổng/so sánh verified numeric Claude usage; không trộn OMP hoặc inherited metrics |
| `src/i18n/locales/en/drawer.js`, `src/i18n/locales/vi/drawer.js` | Modify: chín nhãn privacy/read-only/unknown/generic tương ứng |
| `tests/unit/agent-schema.test.mjs` | Create: schema, namespace, capabilities, privacy và numeric contracts |
| `tests/unit/agent-compat.test.mjs` | Create: facade, actual projection/callback boundaries, UI guards, quota/accountant, List Mode/generic role và lifecycle diagnostics |
| `tests/e2e/agents.spec.ts` | Create: bốn ca synthetic UI/API; **chỉ syntax checked, chưa chạy E2E** |

Tổng: **9 file application source hiện có được sửa, 4 module mới và 3 test files mới**. Package manifests, lockfile, .gitattributes, Git config và OMP config không đổi. Không refactor ngoài các source files được duyệt.

## 3. Contract hiện có và giới hạn

`OFFICE_OMP` unset/off/invalid có effective mode `off`. `files`/`hybrid` được nhận diện nhưng vẫn **effective off**, diagnostic `adapter-not-implemented` tại `/api/doctor`: Phase 02 không có driver để mở data/config, watch filesystem hoặc tạo ingress. Không tự biến yêu cầu mode thành quyền đọc roots. Production đăng ký **chỉ Claude**; fake OMP adapter chỉ xuất hiện trong unit dependency injection. E2E dùng demo/debug UI seam có sẵn, không thêm production injection endpoint.

Claude `sessions` và `sidToKey`, hook ingestion, scanner, usage/account loops và task destinations vẫn private Claude. Public `id`, legacy usage và nested `event.agent`/child IDs giữ ý nghĩa cũ; chỉ thêm `agentKind`, alias `agent`, `sessionKey`, `capabilities`. Các snapshot mới và `pub` dùng cùng projection.

OMP public IDs dùng SHA-256 của tuple có cấu trúc `(omp, sourceNamespace, sourceSessionId)`, không delimiter join, không lộ root/profile. Claude `sessionKey` hiện là compatibility key `claude:<existing public id>`: **giữ restart semantics cũ, chưa phải durable cross-restart source identity**. Không quảng cáo đã giải quyết stable identity cho mọi legacy Claude record; phải chốt contract trước khi dùng key này cho cross-restart aggregation.

OMP projection hiện chỉ có generic name, model metadata đã lọc và numeric metrics; status/lifecycle/activity/connection `unknown`, controls và conversation đều false, `usage=null`, không children. Đây là projection cho synthetic seam, **không phải decoder OMP JSONL**, không chứng nhận version/schema/event support. Context/cost không đủ provenance giữ null; không dùng Claude context default hoặc account quota.

Các request task có explicit unknown/mismatched target không được fallback sang tạo task mới trong `dir`. Đây là hardening có chủ ý: valid legacy Claude sid và directory-only request vẫn thuộc endpoint Claude; native source sid của OMP không phải public target. OMP IDs/explicit foreign providers bị từ chối trước executor. General `/api/sys/action` vẫn là chức năng quản lý hệ thống riêng với ownership/start-time checks cũ; không hứa rằng toàn bộ system management trở thành read-only.

## 4. Consumer/sink audit

| Sink | Kết quả source review |
|---|---|
| `doScan`, `onHook`, timeout/usage/account loops | Store cũ không union; không có OMP hook/event reducer |
| `tasksOut`, `noteDir`, `knownDirs` | Vẫn private Claude; fake OMP catalogue không đăng ký task destination |
| `acctOf`, `liveCtx`, `gitOf` | Chỉ gọi trong Claude facade; OMP đi qua projection riêng |
| Chat/trophies/stats | Không có OMP discovery/backfill gọi các pipeline này; legacy stats không cộng OMP metrics |
| Translation, image/artifact paths, CI | Không thêm OMP call path, không đọc/fetch path từ synthetic record |
| Quota/accountant | Đã thêm provider guards và behavioral unit tests với fabricated usage |
| Timeline/grouping/nested runtime | Không thay `src/shared/timeline.js` hoặc `src/office/net/live.js`; stable project/child mapping và live unknown presentation rộng hơn thuộc phase sau |

Audit này dựa trên diff và code boundaries; không thay bằng chứng app/Claude lifecycle regression thực tế. Trước live emission còn phải thực hiện review UI consumers đầy đủ theo các phase sau.

## 5. Verification evidence

| Check | Kết quả thực tế |
|---|---|
| Baseline `npm test` trước source changes | Exit 0, 22/22 PASS |
| Red phase hai tests mới trước modules | Exit 1, `ERR_MODULE_NOT_FOUND` đúng vì modules chưa được tạo |
| Focused `node --test tests/unit/agent-schema.test.mjs tests/unit/agent-compat.test.mjs` cuối | Exit 0, **23/23 PASS**, không skipped/todo |
| `OFFICE_OMP=off OFFICE_TRANSLATE=0 OFFICE_USAGE=0 OFFICE_CI=0 npm test` cuối | Exit 0, **45/45 PASS**, không skipped/todo |
| `node --check` trên 13 application JS/MJS + 2 unit MJS + 1 E2E TS | 16/16 syntax checks PASS; không import/start application |
| `npm run lint` trước và sau edits | Exit **127**, `eslint: not found`; BLOCKED, không phải lint pass |
| `npm run typecheck` trước và sau edits | Exit **127**, `tsc: not found`; BLOCKED, Node TS syntax check không thay TypeScript semantic check |
| Build/app/E2E/live OMP/benchmark | **NOT RUN**; không thuộc execution approval này |
| `git diff --check` | PASS |
| HEAD/.gitattributes/.git/index | Giữ nguyên; cached diff rỗng; đối chiếu cuối ở execution log |

Các unit mới chỉ dùng synthetic objects, source files trong repo, fake dependencies/DOM; không network/model/real agent data. Test trích **declaration và request callback thật** từ source vào Node VM với dependencies được inject, không import `server/index.mjs`, không nghe port và không gọi real executors. Đây là behavioral unit coverage, **không phải HTTP integration/E2E hoặc browser/render validation**. Failure boundaries rõ nếu code layout đổi.

Hai lỗi trong harness mới đã sửa mà không hạ assertions hoặc thay application behavior: strip thêm named `export { ... }` khi evaluate UI declarations; tách tình huống Claude đang quota break khỏi tình huống accountant chọn spender sau khi nghỉ xong. Cả expectation không chọn người đang onBreak và chọn đúng Claude sau đó đều được assert.

Một lệnh đọc source dài bị output truncation/SIGTERM; không có source mutation trong lệnh đó. Các phần cần review được đọc ở khoảng hẹp sau đó. Không coi output bị cắt là evidence đã xem.

### C1–C7 gate coverage

| Gate | Evidence và gap |
|---|---|
| C1 OFF | Unit/static production registration và env getter checks; no OMP driver/import/config. Full running-server isolation NOT RUN |
| C2 Claude compatibility | Golden assertions cho actual pub, shared snapshots, log roles và valid control dispatch; existing 22 tests giữ PASS. Full hook lifecycle/browser regression NOT RUN |
| C3 controls | Real handler callback + spies: foreign/unknown IDs, forged provider, same source sid, valid Claude path, rejected directory fallback. No real process control |
| C4 identities | Deterministic OMP namespace key, same sid giữa adapters không nhầm owner; Claude durable restart identity còn giới hạn nêu trên |
| C5 quota/cost | Actual quota loop/accountant functions với OMP/unknown forged usage; không cộng inherited cost |
| C6 legacy | Legacy no-field capability fallback, unchanged event child ID, old timeline unit tests PASS; browser replay NOT RUN |
| C7 nullable/privacy/UI | Sentinel exclusion, numeric guards, actual drawer/account/List Mode/generic assistant functions với mocks; real DOM/render E2E NOT RUN |

## 6. Review, docs và trạng thái plan

Review inline về compatibility, ownership/security, privacy, unknown state và failure cleanup. Đã sửa trong scope: explicit new Claude record thiếu capabilities fail-closed; reserved foreign public ID không được tự nhận Claude để hưởng quota/cost; không áp optional-adapter catalogue cap cho legacy Claude; generic assistant không dùng subagent avatar; unknown activity không hiện exact duration.

Không có independent subagent/code-simplifier/native AgentKit hook chạy. Không dùng điểm số review thay evidence. Không có số đo CPU/RAM/GPU để kết luận cải thiện hiệu năng.

Plan `my-office/261030-1754` được resolve theo repository rồi `ak plan update --status in-progress --current-phase 2`. CLI `phase update --status` bị live help đánh dấu không hỗ trợ; `ak plan check` chỉ tick toàn bộ. Vì G2 còn gap, **không gọi check/close hoặc đánh dấu phase completed**; checklist/frontmatter phase vẫn pending, current execution state nằm trong phần bổ sung và báo cáo này. Không publish issue, commit, push hoặc tạo external journal.

## 7. Remaining gates và next boundary

G2 chưa hoàn tất do thiếu lint/typecheck toolchain và chưa thực thi build/E2E trên môi trường isolated. Cần approval cài dependencies theo lockfile trước khi cài; không tự dùng npx tải package/browser. Build/E2E vẫn cần approval riêng và audit isolation (HOME/USERPROFILE/OFFICE_DATA_DIR/CLAUDE_CONFIG_DIR, inherited OMP overrides, outbound flags, port).

G1 live vẫn cần installed OMP version/build, host/profiles, explicit roots/mappings và privacy của dữ liệu thật. Không dùng successful synthetic tests để mở gate đó. Phase 03/file observer hoặc Phase 04 extension không được tự bắt đầu.

Rollback phải dùng scoped patch reversal của đúng source/docs được sửa, sau approval khi cần; không `git reset/clean`, không xóa data agent. Feature off không thay thế rollback nếu shared-seam regression được phát hiện. Các gate bị BLOCKED/NOT RUN không được coi là pass.


## 8. Follow-up được phê duyệt — dependencies, lint và typecheck (31/10/2026)

Approval mới: người dùng trả lời **“Ok, duyệt”** cho cài dependencies đúng `package-lock.json` và chạy lint/typecheck; **không phê duyệt build/E2E, OMP runtime, config change, commit hoặc push**.

### Installation evidence

- Trước cài: repository/HEAD vẫn đúng, `node_modules` absent; `package.json` SHA-256 `4f7ebe03f6960b2d75216fe5638edde69d39ca5b8f6a3db727fb5d50659fe247`, `package-lock.json` SHA-256 `814d7b0a39dc8ba8015f5cc45433a751fc06f1b428c445c0968fef51664e293a`.
- `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` **FAILED** exit 217, `ENOTEMPTY` khi cleanup `node_modules/next/dist/api`.
- `npm install --ignore-scripts --no-audit --no-fund --no-save --prefer-offline` thử tiếp **FAILED** exit 243, `EACCES` khi rename `node_modules/next`; mount repo là `9p` tại `/mnt/e` (Windows E: qua WSL2). Không dùng `sudo`, `chmod`, reset, move hoặc xóa user data.
- Các top-level packages đã hiện diện (`npm ls --depth=0` exit 0) nhưng `next` **chỉ giải nén một phần**, thiếu `package.json` và `dist/compiled/babel/eslint-parser.js`; lint ban đầu FAILED exit 2 vì không resolve được parser.
- Phục hồi **đúng một package Next.js 16.4.3** bằng `npm pack next@16.4.3 --ignore-scripts`; tính SHA-512 của tarball và đối chiếu **khớp chính xác** `packages["node_modules/next"].integrity` trong lockfile, kiểm tra 8705 archive paths đều trong prefix `package/` và không có `..`; extract vào `node_modules/next` với `--strip-components=1 --no-same-owner`, không xóa existing files, không chạy lifecycle hooks.
- Xác minh `next/package.json` version `16.4.3`, `require.resolve('next/dist/compiled/babel/eslint-parser')` thành công; xóa **duy nhất** tarball tạm 43,608,539 bytes được tạo và đối chiếu integrity trong lượt này. `npm ls --depth=0` sau cleanup exit 0, không extraneous top-level package.

### Verified gates sau phục hồi

| Command / check | Kết quả thực tế |
|---|---|
| `npm run lint` | **PASS**, exit 0, không warning |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm test` | **PASS**, 45/45, không skipped/todo |
| `npm ls --depth=0` | **PASS**, package versions đúng lockfile top-level |
| `npm ls --all --parseable` | **PASS**, transitive package tree metadata không báo missing packages |
| `git diff --check` | **PASS** |
| Git HEAD/index, `.gitattributes`, `package.json`, `package-lock.json` | **UNCHANGED**, no stage/commit/push |
| Build, E2E, app runtime, live OMP, benchmark | **NOT RUN**, outside approval |

**Interpretation:** lint và typecheck gate trước đây blocked đã được mở bằng kiểm tra thực tế. Tuy nhiên **hai lệnh cài npm chính đều fail**, nên **không được khẳng định `npm ci` clean install thành công, native postinstall hoàn tất, hoặc runtime dependencies hoạt động đầy đủ**. Cài bằng `--ignore-scripts` có chủ ý để không chạy code bên thứ ba. Việc `npm ls` thành công chỉ kiểm tra metadata/dependency tree, không chứng minh mọi package file hoặc native binary đầy đủ. Không tự bật build/E2E; G2 chính thức vẫn **PARTIAL / verification pending**. Các kết luận lỗi filesystem là môi trường được quan sát, không suy đoán chính xác process Windows nào khóa file.
