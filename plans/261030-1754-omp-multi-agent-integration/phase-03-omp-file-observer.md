---
phase: 3
title: "OMP file-only observer và persisted observability PoC"
status: completed
priority: P1
effort: "Chưa ước lượng"
dependencies: [2]
---

# Phase 3 — File-only PoC có giới hạn và phục hồi

## Goal / Entry gate

Sau G2 và approval riêng, đọc session JSONL ở roots được duyệt bằng incremental reader, hiển thị persisted activity/conversation/usage mà không biến history thành live sessions giả. Chỉ fixtures trước, nguồn thật chỉ sau root/privacy approval.

**Cập nhật entry gate 31/10/2026:** G2 đã **CLOSED WITH ACCEPTED EXCEPTIONS** theo [quyết định của người dùng](./reports/phase-02-g2-acceptance.md); không còn chặn Phase 03 synthetic-first. Yêu cầu `cook` Phase 03 đã là approval cho phạm vi này, không cần xin lại chỉ vì các ngoại lệ G2 đã công bố. Đây không phải tuyên bố mọi regression PASS; các checks trên revision thực tế vẫn phải được ghi đúng kết quả. Phase 03 vẫn `pending` vì chưa triển khai trong phiên đóng gate. G1 live, roots/privacy dữ liệu thật và Phase 04/realtime không được mở bởi quyết định này.

## Implementation progress — 31/10/2026

**PARTIAL; G3 OPEN.** Đã tạo bốn core modules `paths`, `reader`, `normalize`, `usage` cùng fixtures synthetic và 37 unit tests. Focused 37/37, full `npm test` 132/132, lint/typecheck PASS. Lệnh ghi `server/agents/omp/index.mjs` bị công cụ chặn; file chưa tồn tại. Chưa nối adapter vào server/API/UI, chưa build/E2E hoặc demo file-only. Production tiếp tục giữ OMP effective off. Chi tiết phạm vi, test history, rủi ro và các phần còn thiếu: [implementation report](./reports/phase-03-implementation.md).

**Cập nhật tiếp 31/10/2026:** adapter `index.mjs`, catalogue/pin, server API, UI persisted-only, i18n và List Mode đã triển khai; `npm test` 156/156, ESLint và tsc sạch trên Windows native. Sau đó build PASS và file-only E2E trên fixture synthetic **3/3 PASS** (native Windows, chạy qua PowerShell tool với sự đồng ý của người dùng); `agents.spec` 6/6, unit 161/161. Layout thật (chỉ tên file, người dùng duyệt) khớp giả định F9; đã sửa trần scan và hạn mức đọc header lộ ra từ cây thật (588 session) và tối ưu scan (lần đầu ~5,0 → ~2,2 s, rescan ~2,5 → ~0,9 s trên bản sao tổng hợp). Giữ trần 8 MiB mỗi file. Suite Claude trên GPU: 54/58 (4 fail do script `.sh` giả không chạy được trên Windows, cũng fail ở baseline); trên SwiftShader 24 fail y hệt baseline HEAD sạch, nên không phải hồi quy Phase 03. Metadata pin nay chỉ ở máy này (không SSE/poll từ xa, không replay). Benchmark synthetic đã chạy và tìm ra, sửa lỗi pin file lớn (xem báo cáo). F9 đã được kiểm trên cây OMP thật ở mức cấu trúc với sự đồng ý của người dùng (588 session chính, 785 con, 22 tombstone; adapter files mode đọc đúng 588/588, không con nào thành actor). **G3 đã được đóng theo quyết định của người dùng (31/10/2026), kèm ngoại lệ công bố**: xem [G3 acceptance](./reports/phase-03-g3-acceptance.md). Đoạn "G3 vẫn OPEN" ở các dòng cập nhật trước là lịch sử. Dòng "chưa nối adapter / file chưa tồn tại" ở trên là lịch sử. Chi tiết: [adapter/UI report](./reports/phase-03-adapter-ui-integration.md).

Các Todo dưới đây vẫn chưa được đánh dấu hoàn tất toàn bộ; plan bookkeeping đã chuyển current phase sang 3. Dòng `pending` trong entry-gate update phía trên mô tả phiên đóng G2 trước đó, không phải tuyên bố chưa có code trong lượt cook hiện tại. Không có approval mới cho roots/privacy thật hoặc Phase 04.

## Context

[Contracts §§3–8](./design-contracts.md), [evidence O1/O2/O4/O7](./evidence.md), [validation F1–F12/U1–U4](./validation-matrix.md). Version 3 chỉ là schema reference; file cùng version có thể khác optional features giữa builds. Không gọi SessionManager.open, SDK loader, migration hoặc CLI của OMP để đọc dữ liệu.

## Files to Create / Modify

Không xóa file. Các file Create là đề xuất mới.

| Action | Absolute path | Mục đích |
|---|---|---|
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/index.mjs` | Private store, driver lifecycle, scheduler, summary discovery |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/paths.mjs` | Approved roots và Windows/POSIX mapping |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/reader.mjs` | Byte cursor, partial UTF-8/line, epochs, cancellation, recovery |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/normalize.mjs` | Entry/tree/tool/conversation mapping có version checks |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/usage.mjs` | Durable per-session usage với scope/provenance |
| Modify | `/mnt/e/vide-code/my-office/server/agents/registry.mjs`, `/mnt/e/vide-code/my-office/server/agents/projection.mjs`, `/mnt/e/vide-code/my-office/server/index.mjs` | Driver registration và read-only API dispatch |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/activity.js`, `/mnt/e/vide-code/my-office/src/office/ui/session-drawer.js`, `/mnt/e/vide-code/my-office/src/office/ui/lite.js` | Persisted-only/history label, on-demand conversation, pin selection |
| Modify | `/mnt/e/vide-code/my-office/src/i18n/locales/en/activity.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/activity.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/en/drawer.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/drawer.js` | Nhãn inference/history/unavailable |
| Create | `/mnt/e/vide-code/my-office/tests/unit/omp-paths.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-reader.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-normalize.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-usage.test.mjs` | Parser/identity/recovery/usage tests |
| Create | `/mnt/e/vide-code/my-office/tests/fixtures/omp/` | Synthetic JSONL/manifest, không copy transcript người dùng |
| Modify | `/mnt/e/vide-code/my-office/tests/e2e/agents.spec.ts`, `/mnt/e/vide-code/my-office/playwright.config.ts` | Isolated fixture roots, feature-on/off smoke |

## Tasks & Steps

1. Viết fixtures F1–F12 và U1–U4, mô tả expected projection và coverage theo build. Dữ liệu secrets trong negative tests phải là fake strings rõ ràng, không credentials thật. Fake session files được tạo trong temp dir của test, không agent source roots.
2. Cấu hình source registry explicit. Validate roots tồn tại/được đọc, path style, project mappings và sourceNamespace ổn định. Dùng canonical containment + file identity checks; từ chối symlink/reparse point thoát root; không follow `parentSession`/previousSessionFiles/blob references tùy tiện.
3. Discovery chỉ đọc header/title prefix và directory metadata trong budget. Có recent/history catalogue phân trang, giới hạn scans/FD/concurrency và cancellation. Không parse mọi transcript toàn bộ tại startup; recent selection là heuristic có nhãn, không chứng minh live.
4. Implement reader theo contracts: byte offset đến newline, pending bytes, max line/chunk budget; UTF-8 split, CRLF/LF, parse errors có diagnostic. Tool/header JSON được parse inert; không eval nội dung. Long line drain có cap không giữ nguyên multi-MB output trong RAM.
5. Nhận biết truncate/replace/title overwrite/rewrite+append. Khi không phân biệt append với rewrite, bounded rebuild file đó; giữ UI snapshot cũ gắn refreshing đến khi epoch mới publish atomically. Checkpoint mismatch sau crash thì rebuild, không cộng ledger lần hai. Watcher là wake-up hint; polling/stat reconciliation vẫn có.
6. Parse session header/entry taxonomy, toolCall/toolResult và custom markers đã khóa. Giữ unknown records inert. Tool request không tự coi execution start. `session_exit` chỉ là evidence của runtime tương ứng, không đóng session vừa resume.
7. Reconstruct display branch bằng parentId và activeLeafId nếu có; giới hạn cycle/depth/index bytes. `reset_boundary`, compaction, branch summary giữ đúng view đã chọn. Khi cap không đủ, trả truncated/incomplete với diagnostics, không trình bày history sai như đầy đủ. Conversation pagination không bị pin toàn file trong RAM.
8. Tool classifier đọc tên và fields thật theo compatibility matrix; map read/edit/write/bash/search/task/ask nếu được xác minh. Custom/MCP tools có fallback neutral, không đoán tool name bằng lowercase của Claude rồi coi tương đương. Sanitize labels trước cache/broadcast.
9. Theo dõi child transcript từ artifact tree với root/parent namespaces; child bản cũ là historical/parked candidate, không spawn live 3D workers hàng loạt. Không coi header.parentSession là foreign key subagent. Advisor tách kind và read-only, support level rõ ràng.
10. Usage lấy persisted assistant + model_usage; context nullable/estimated theo provenance. Reparse thay ledger, không tăng counters tổng. Fork kế thừa history được gắn scope, không double-count cross-session aggregate; không copy Claude pricing/ctxMax.
11. Kết nối PoC UI: recent/history selection hoặc explicit pin thành actor persisted-only; default scene chỉ runtime-confirmed actors hoặc pins. On-demand conversation gated bằng config privacy; arbitrary path URL không được hỗ trợ. Không emit historical animation/chat/trophy/replay live.
12. Nếu cần cache, chỉ ghi disposable sanitized cursors/derived metadata dưới OFFICE_DATA_DIR của My Office, không source roots; version/cache identity mismatch invalidate an toàn. File-only adapter đang tắt phải thực sự dispose handles/watchers/timers.

## Success Criteria / G3

- F1–F12/U1–U4 đạt expected outputs; same input/rebuild/restart không nhân đôi tool hoặc usage.
- Source files/directories không bị tạo, sửa, đổi permissions hoặc migrate; test harness xác nhận hash và controlled fs calls.
- History/liveness distinction thể hiện rõ trên UI; không gọi historical tool là đang chạy chỉ vì thiếu result.
- Title overwrite và branch/continuation fixtures đúng; unknown schema làm OMP degraded nhưng Claude vẫn hoạt động.
- Có file-only demo bằng synthetic fixtures không cần OMP/LLM thật; basic actor/drawer/List Mode hoạt động.

## Verification — chỉ chạy sau approval

```bash
node --test tests/unit/omp-paths.test.mjs tests/unit/omp-reader.test.mjs tests/unit/omp-normalize.test.mjs tests/unit/omp-usage.test.mjs
npm run lint
npm run typecheck
npm test
```

E2E dùng E1; real source smoke chỉ ở approved roots với read-only handles, không mở OMP hoặc gọi provider. Hash/stat snapshots trước/sau phải phân biệt thay đổi do chính agent đồng thời ghi với thay đổi do observer; isolation fixture test là bằng chứng chắc chắn hơn live hash đơn lẻ.

## Todo

- [x] Fixtures + root/path protection (`omp-paths`, `omp-reader` tests; adapter chỉ mở `O_RDONLY` trong root đã duyệt).
- [x] Incremental reader + rewrite recovery + cache cleanup (không có cache trên đĩa; reader dispose handle/timer).
- [x] Branch-aware conversation/tool/child normalization (child chỉ đếm, không là actor; cây thật khớp).
- [x] Usage provenance và idempotent ledger.
- [x] File-only UI PoC và permission-negative tests (E2E OMP 3/3: id lạ/đường dẫn bị từ chối, không lộ hội thoại khi chưa opt-in).
- [x] G3 review; chưa cài extension hoặc bật hybrid. Ngoại lệ còn lại: [G3 acceptance](./reports/phase-03-g3-acceptance.md).

## Risks / Stop conditions / Rollback

Ambiguous schema/roots, unbounded scan hoặc branch output sai là blocker. Oversized/unsupported files được quarantine ở adapter diagnostics, không crash server và không 'fix' source. Nếu không đạt budget bằng built-ins, báo bottleneck trước đề nghị dependency mới. Rollback: OFFICE_OMP=off, đóng driver; giữ dữ liệu agent nguyên trạng, không tự xóa cache hoặc source history.
