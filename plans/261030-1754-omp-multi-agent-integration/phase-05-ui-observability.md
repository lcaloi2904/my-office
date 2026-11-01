---
phase: 5
title: "UI multi-agent, timeline, subagents và usage"
status: pending
priority: P2
effort: "Chưa ước lượng"
dependencies: [4]
---

# Phase 5 — Hoàn thiện quan sát trên UI hiện có

## Goal / Entry gate

Sau G4, hoàn thiện mixed-agent UX không redesign scene: root/subagent actors, provenance, conversation, stable project grouping và timeline. Basic OMP label/control safety đã xong từ G2/G3.

## Context

[Contracts §§4–6/8](./design-contracts.md), [evidence M8–M14/M20](./evidence.md), [validation V1–V8](./validation-matrix.md). Session name chỉ là display label; không phải unique identity. Unknown activity không được tính là work/turn như dữ liệu chính xác.

## Files to Create / Modify

Không xóa file. Đây là danh sách scope dự kiến cần tái đối chiếu source tại entry gate.

| Action | Absolute path | Mục đích |
|---|---|---|
| Modify | `/mnt/e/vide-code/my-office/src/office/net/live.js` | projectKey/worktreeKey, stable actor IDs, subagent namespaces |
| Modify | `/mnt/e/vide-code/my-office/src/office/people/workers.js`, `/mnt/e/vide-code/my-office/src/office/people/team-lines.js` | OMP branding, bounded actors, parent lines, cleanup |
| Modify | `/mnt/e/vide-code/my-office/src/office/demo/demo.js` | Additive applyMsg handling, mixed fixtures, reconnect snapshots |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/activity.js`, `/mnt/e/vide-code/my-office/src/office/ui/lite.js`, `/mnt/e/vide-code/my-office/src/office/ui/session-drawer.js` | Status/source badges, conversation, metrics, subagent tree |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/event-text.js` | Labels cho canonical activity/wait/unknown |
| Modify | `/mnt/e/vide-code/my-office/src/shared/timeline.js`, `/mnt/e/vide-code/my-office/src/office/replay/timeline.js`, `/mnt/e/vide-code/my-office/src/office/replay/replay.js` | Stable keys, evidence-aware spans, legacy replay fallback |
| Modify | `/mnt/e/vide-code/my-office/server/git.mjs`, `/mnt/e/vide-code/my-office/server/agents/projection.mjs` | Approved root identity, worktree metadata; không tự bật CI/network |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/group-chat-view.js`, `/mnt/e/vide-code/my-office/src/office/ui/task-sheet.js` | Không để OMP lọt vào selectable Claude task targets |
| Modify | `/mnt/e/vide-code/my-office/src/styles/sessions.css`, `/mnt/e/vide-code/my-office/src/styles/lite.css` | Badge/status layout nhỏ, không redesign |
| Modify | `/mnt/e/vide-code/my-office/src/i18n/locales/en/activity.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/activity.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/en/drawer.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/drawer.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/en/timeline.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/timeline.js` | Text cả hai ngôn ngữ |
| Modify | `/mnt/e/vide-code/my-office/tests/unit/timeline.test.mjs`, `/mnt/e/vide-code/my-office/tests/e2e/agents.spec.ts` | Stable identity, legacy replay, mixed UI scenarios |

## Tasks & Steps

1. Fixture-first: cùng repo Claude+OMP, hai repo cùng basename, same session name, two roots same child ID, nested/parked/revived child, usage unknown và stale connection. Chốt expected UX trước thêm layout.
2. `projOf` ưu tiên opaque projectKey, display theo repo name; giữ worktree chip nếu đã xác minh. Cross-host grouping chỉ theo approved alias. Tách identity ra khỏi chỗ dùng tên để chọn màu/actor appearance.
3. Root actor tái dùng Worker/ACT. Có OMP text badge trước; không tải logo từ mạng hoặc giả logo Claude. Tool categories mapping dùng adapter, UI không biết raw OMP tool schemas.
4. Giữ true parent identity ở model/drawer; 3D có thể flatten về root/team với indicator khi depth vượt mức render. Không thay parent data để hợp thức hóa limitation UI. Actor budget overflow chuyển sang count/List Mode, không drop session data hoặc silently bỏ children.
5. Conversation viewer hỗ trợ generic assistant, tool invocation/result/error, compaction/reset/branch summaries và pagination. Metadata-only mode trả thông báo chưa bật conversation. Gán text bằng textContent hoặc renderer đã escape, không innerHTML từ transcript. User/system reasoning content không tự xuất hiện khi chỉ yêu cầu activity.
6. Badges phân biệt runtime-confirmed, persisted-only, stale, unknown. Waiting approval khác idle/ready-for-user. Counter/tooltip chỉ rõ per-session/subtree/inherited-history; context/cost không biết thì dấu '—'. Không suy provider subscription từ model name.
7. Timeline data mới dùng stable sessionKey; đọc replay cũ theo fallback name trước đây, không rewrite replay files. Parallel tools không bị tool đầu kết thúc đóng span của tool khác; failed/aborted có marker. Khoảng stale/unknown không cộng như work đúng tuyệt đối. Replay giữ snapshot identity và không chạy side effects live.
8. Kiểm tra task-sheet/group-chat recipient selection, drawer actions, acct/quota guard của G2 khi có OMP session thật trong union. Server guards vẫn authority; chỉ ẩn nút không đủ. Nếu readonly OMP chat activity được hiển thị thì không trở thành channel gửi prompt tới OMP.
9. Kiểm tra Low Quality/List Mode, mobile/responsive, keyboard labels. Không tuyên bố List Mode zero WebGL hoặc thay architecture render ngoài phạm vi; đo delta khi approved benchmark.
10. E2E hỗ trợ hot reconnect, root gone/child cleanup, rename và same-name collision. Không mark ảnh/chỉ số 'đạt' nếu chỉ có screenshot tĩnh hoặc unit tests.

## Success Criteria / G5

- V1–V8 đạt; cùng tên khác source/project không gộp nhầm, restart không duplicate actors.
- Root và task subagents có UI đúng identity/state; nested/advisor support matrix hiển thị limitation, không giả capabilities.
- File-only/history và live khác nhau rõ ràng; stale không dùng 'vừa hoàn thành'.
- Legacy replay/Claude tests vẫn pass; privacy mode không lộ content qua tooltip, replay, task list hoặc errors.
- No unknown-to-zero/NaN cost/context rendering; OMP không bị Claude quota điều khiển animation sai.

## Verification — chỉ chạy sau approval

```bash
node --test tests/unit/timeline.test.mjs tests/unit/agent-compat.test.mjs tests/unit/omp-normalize.test.mjs
npm run lint
npm run typecheck
npm test
```

E2E/build theo E1, gồm `agents.spec.ts` và existing smoke; full existing E2E suite là gate rollout G6. Test browsers/platforms phải được ghi cụ thể, không nhận 'cross-platform pass' từ một môi trường.

## Todo

- [x] Provider/project/actor identity và labels.
- [x] Subagent drawer/tree và bounded 3D mapping.
- [x] Conversation/privacy/nullable metrics.
- [x] Stable timeline/replay/parallel-tool semantics.
- [x] Mixed-agent controls + Low Quality/List/mobile E2E.
- [x] G5 evidence, không tự bắt đầu rollout.

## Risks / Stop conditions / Rollback

Chưa có reliable child identity hoặc timestamp thì hiển thị degraded; không fabricated relationships/durations. Nếu cần redesign React/Three startup để đạt perf, ghi proposal riêng thay vì refactor ngoài scope. Rollback provider UI bằng patch scoped; không làm replay cũ không đọc được, không xóa lưu trữ người dùng.

## Execution evidence — 01/11/2026

Implementation và checklist Phase 05 đã hoàn tất trong scope Windows/synthetic được cho phép, theo quyết định cuối Phase 04 cho phép tiếp tục khi G4 vẫn OPEN. Chi tiết implementation, V1–V8, review fixes, commands và giới hạn: [Phase 05 report](./reports/phase-05-implementation.md).

- Cuối cùng: 245/245 unit, 12/12 agents E2E, 3/3 files E2E, 1/1 hybrid E2E, 7/7 selected Claude smoke; lint/typecheck/isolated production build PASS.
- Browser surface đã thao tác trực tiếp ở desktop/mobile; nested tree, overflow, HUD, keyboard và responsive geometry được kiểm thêm bằng E2E. Không có FPS/zero-WebGL/cross-platform claim.
- Persisted children là historical evidence; live child/advisor chưa hỗ trợ và tombstone không chứng minh outcome. Metadata/conversation opt-in và OMP read-only guards giữ nguyên.
- **G4 vẫn OPEN**; báo cáo không tự đóng G5 trên mọi installed runtime/host. Không Phase 06/G6, benchmark, model-backed OMP hoặc rollout; không commit/push.

