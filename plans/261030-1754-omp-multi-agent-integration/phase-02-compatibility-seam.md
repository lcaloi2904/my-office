---
phase: 2
title: "Compatibility seam và cô lập Claude Code"
status: in-progress
priority: P1
effort: "Chưa ước lượng"
dependencies: [1]
---

# Phase 2 — Điểm kết nối chung, không thay pipeline Claude

## Quyết định hiện hành — 31/10/2026

**G2: CLOSED WITH ACCEPTED EXCEPTIONS**, theo yêu cầu của người dùng “đóng g2 luôn đi”. Chi tiết tại [G2 acceptance](./reports/phase-02-g2-acceptance.md). Gate đã được chấp nhận để mở Phase 03 synthetic-first; không xác nhận các E2E còn lỗi đã PASS hoặc HEAD sau merge đã được revalidate.

Các ghi chú G2 OPEN/không chuyển Phase 03 bên dưới là lịch sử trước quyết định này. Phần kiểm chứng còn thiếu vẫn để unchecked và `status: in-progress` phản ánh tồn đọng đó, không còn là blocker G2. Không thay đổi kết quả lịch sử, source, tests hay điều kiện nghiệm thu kỹ thuật. Không truy cập OMP thật hoặc mở realtime.

## Lịch sử triển khai trước quyết định đóng G2 — 31/10/2026

Đã triển khai scope extension RAIL-01, chỉ sửa thêm `activity.js` và hai test files liên quan. Lint/typecheck/rebuild PASS; 48/48 unit PASS; 6/6 agent E2E PASS ở 90s/test, gồm original rail assertion và strengthened unknown/metrics/controls assertions. Selected Claude regression ở viewport 1440×900: 180s/trace-on có 3 PASS, 1 panels timeout; mặc định 90s/trace-off có 2 PASS, 2 timeout (panels và session drawer). Lượt mặc định ghi nhận popup chat chặn nút đóng machine drawer; không forced click hoặc ẩn popup để bỏ qua.

**RAIL-01 FIXED; G2 VERIFICATION INCOMPLETE**, không đánh dấu toàn bộ phase completed khi ca regression trên chưa đạt. Diagnostic riêng và mọi giới hạn nằm ở [repair report](./reports/phase-02-rail01-fix.md). Historical failures được giữ trong [runtime validation](./reports/phase-02-runtime-validation.md). OMP vẫn off; không mở Phase 03.

## Goal / Entry gate

Sau G1 hoặc scoped synthetic-only exception đã được phê duyệt, tạo adapter facade tối thiểu cùng safety gates trước khi bất kỳ OMP session thật nào được phát ra UI. Exception hiện tại chỉ cho implementation/test synthetic, không cho live activation. Không di chuyển toàn bộ monolith sang kiến trúc mới.

## Context

[Contracts](./design-contracts.md), [evidence M1–M14/M16–M19](./evidence.md), [validation C1–C7](./validation-matrix.md). Claude private store và sidToKey vẫn thuộc Claude; OMP store sẽ được tạo ở Phase 3. Backend plain ESM được giữ nguyên.

## Files to Create / Modify

Bảng ownership của implementation Phase 02 đã được phê duyệt; source và tests đã được triển khai theo execution evidence. Không xóa file.

| Action | Absolute path | Mục đích |
|---|---|---|
| Create | `/mnt/e/vide-code/my-office/server/agents/schema.mjs` | Schema, identities, capabilities và public field validation |
| Create | `/mnt/e/vide-code/my-office/server/agents/registry.mjs` | list/resolve/readConversation/start/dispose facade |
| Create | `/mnt/e/vide-code/my-office/server/agents/projection.mjs` | Legacy-compatible projection, privacy gate và counters |
| Create | `/mnt/e/vide-code/my-office/server/agents/claude/compat.mjs` | Inject callbacks Claude hiện có, không đổi business rules |
| Modify | `/mnt/e/vide-code/my-office/server/index.mjs` | Union snapshots/log lookup/replay, vẫn private Claude store và controls |
| Modify | `/mnt/e/vide-code/my-office/src/office/people/workers.js` | Nhãn OMP và unknown harness; giữ defaults của replay cũ |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/session-drawer.js` | Capability gating, neutral role, không gợi ý /rc cho OMP |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/session-account.js` | Chỉ account actions cho provider có capability |
| Modify | `/mnt/e/vide-code/my-office/src/office/ui/lite.js` | Null-safe usage và provider label tối thiểu |
| Modify — RAIL-01 extension | `/mnt/e/vide-code/my-office/src/office/ui/activity.js` | Unknown group/rail/chips; neutral label/time và provider-safe metrics, đã được phê duyệt ngày 31/10/2026 |
| Modify | `/mnt/e/vide-code/my-office/src/office/life/quota.js` | Không áp Claude main-account quota cho OMP thiếu acct |
| Modify | `/mnt/e/vide-code/my-office/src/office/people/accountant.js` | Không cộng unknown/inherited cost vào Claude quota/totals |
| Modify | `/mnt/e/vide-code/my-office/src/i18n/locales/en/drawer.js`, `/mnt/e/vide-code/my-office/src/i18n/locales/vi/drawer.js` | Nhãn read-only/không hỗ trợ/unknown |
| Create | `/mnt/e/vide-code/my-office/tests/unit/agent-schema.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/agent-compat.test.mjs` | Schema, injection, provider isolation và legacy contract fixtures |
| Create | `/mnt/e/vide-code/my-office/tests/e2e/agents.spec.ts` | Synthetic mixed-agent controls và legacy regression cases |

### Scope extension được phê duyệt ngày 31/10/2026 — RAIL-01

Người dùng đã phê duyệt rõ sửa thêm `/mnt/e/vide-code/my-office/src/office/ui/activity.js` cùng tests/i18n liên quan và chạy rebuild/lint/typecheck/unit/E2E để nghiệm thu G2. File này được thêm vào ownership table cho phần unknown-state rail, metrics/capability presentation và regression trực tiếp; không phải quyền refactor toàn frontend. Tái sử dụng nhãn i18n hiện có. Báo cáo: [RAIL-01 repair](./reports/phase-02-rail01-fix.md).

OMP vẫn off; không Phase 03, không live data, không commit/push. Nếu consumer audit phát hiện file cần sửa ngoài bảng và extension này, ghi exact file/symbol và xin mở scope trước, không tự mở rộng refactor.

### Scope extension được phê duyệt ngày 31/10/2026 — Claude UI regression

Người dùng đã phê duyệt debug/fix tối thiểu `src/office/ui/group-chat-view.js`, CSS và tests liên quan để xử lý hai browser timeout, giữ nguyên assertions, chạy build/lint/typecheck/unit/E2E. Phạm vi thêm gồm `src/styles/group-chat.css`, `tests/e2e/office.spec.ts`, `tests/e2e/chat-preview.spec.ts` và `tests/unit/chat-preview.test.mjs`; không cấp quyền sửa renderer/core ngoài scope. Báo cáo: [chat/drawer regression](./reports/phase-02-chat-drawer-regression.md). OMP off, không Phase 03/commit/push vẫn giữ nguyên.

## Tasks & Steps

1. Trước khi sửa source, ghi static baseline và chạy baseline lint/typecheck/unit khi được duyệt. Với app/E2E/performance, xin quyền riêng và đo trên isolated HOME/DATA_DIR trước thay đổi liên quan. Không có quyền thì ghi NOT RUN và giữ runtime gate blocked; không dùng số đo sau thay đổi làm baseline cũ.
2. Viết tests trước cho legacy pub/snap/events bằng fixtures synthetic. Không import `server/index.mjs` trong unit vì module này khởi tạo server và runtime data; dùng injected callbacks cho facade. Giữ response cũ tương thích, fields mới additive.
3. Tạo schema/identity helpers và registry nhỏ. Public capabilities do server xác định, không do payload truyền vào. Chốt flags `OFFICE_OMP=off|files|hybrid`; OFF là nhánh không load/start OMP driver, không đọc config OMP/roots, không bật ingress.
4. Bọc read-only Claude projection bằng facade. `doScan`, timeout/usage/account loops, `tasks`, hooks và process management vẫn chỉ nhìn Claude store. Snapshot hiện tại và replay snapshot hợp nhất qua facade; không union OMP vào Map cũ.
5. Route `/api/log` resolve opaque public session ID trước, rồi dispatch reader theo owner. Claude vẫn trả format cũ; UI nhận cả legacy role `claude` và generic assistant. Không cho caller gửi arbitrary filesystem path.
6. Chặn OMP trong control lookups: `/api/tasks`, account-move, `/api/open` và các session selectors vẫn Claude-only; crafted OMP ID phải bị từ chối trước gọi process/tool. General `/api/sys/action` giữ kiểm tra ownership/start-time hiện có, không đăng ký PID OMP vào danh sách controllable. Không hứa thay global system-management thành read-only.
7. Audit sinks trước khi union: tasksOut, noteDir/knownDirs, pub/acctOf/liveCtx, chat/trophies, quota/accountant, Git/CI, images và translation. OMP discovery không tự thêm cwd vào Claude task destinations; không gọi Claude hooks/trophies/translation từ OMP reducer. Ban đầu OMP stats là scope riêng; không cộng lịch sử vào legacy stats.
8. Thêm minimal UI capability guards và nhãn OMP. Replay cũ thiếu agentKind/capabilities được nhận legacy Claude theo contract; dữ liệu mới phải explicit. Unknown new provider không được fallback thành Claude có controls.
9. Chỉ phát fake adapter từ test dependency injection; không tạo production route cho inject arbitrary events. Synthetic fixture source không bật khi production flag OFF.

## Success Criteria / G2

- C1–C7 có evidence; flag OFF không tạo OMP I/O, timers, watcher, listener hoặc sửa Claude hooks/settings.
- Với fixture Claude không đổi, projections/control semantics giữ nguyên ngoại trừ additive metadata đã duyệt.
- Same name/sid/PID giữa hai providers không thay được ownership; OMP không trở thành task/account/process target.
- Unknown/null usage không NaN; OMP không bị Claude quota làm nghỉ và không bị accountant tính như Claude plan usage.
- UI tối thiểu có label OMP và read-only capability behavior trước Phase 3.

## Verification — chỉ chạy sau approval

```bash
node --test tests/unit/agent-schema.test.mjs tests/unit/agent-compat.test.mjs
npm run lint
npm run typecheck
npm test
```

Các file mới trong lệnh chỉ chạy sau khi đã tạo. `checkJs: false` hiện tại nghĩa là typecheck không chứng minh các module .mjs/.js đúng; runtime/unit assertions là gate bắt buộc. Build và E2E dùng command group E1 trong validation-matrix, cần approval riêng; không chạy server trên HOME thật.

## Todo

- [x] Baseline + source consumer audit được ghi.
- [x] Schema, registry, projection và Claude facade có fixture tests.
- [x] Controls/task destinations/quota/cost được cô lập.
- [x] Basic label/capabilities/null-safe rendering hoàn thành.
- [ ] Hoàn tất kiểm chứng regression timeout/cold start và revalidation trên revision thực tế; tồn đọng kỹ thuật không chặn Phase 03 synthetic-first sau quyết định G2 CLOSED WITH ACCEPTED EXCEPTIONS. Xem G2-E1–E3 trong [G2 acceptance](./reports/phase-02-g2-acceptance.md).

## Risks / Stop conditions / Rollback

Regression Claude hoặc source ownership không rõ là stop condition; không sửa test expectation chỉ để pass. Nếu cần refactor sâu index.mjs để tiếp tục, tách proposal và xin duyệt. Rollback bằng feature flag OFF và revert đúng patch đã duyệt, không git reset/clean, không xóa dữ liệu agent hoặc chỉnh .gitattributes. Ngay cả khi OFF, shared-seam regression phải được sửa hoặc rollback, không coi flag là đủ.

**Cập nhật 31/10/2026 (Windows native) — G2 vẫn OPEN, chờ quyết định điều kiện nghiệm thu.** Hai timeout Claude là lỗi môi trường có sẵn từ HEAD sạch: Chromium mặc định dùng SwiftShader nên mỗi frame chặn main thread ~3 s; có GPU thì panels PASS 10/10, session drawer còn cold start 31–35 s so với budget 20 s (3/10 FAIL). Không đổi source. Chi tiết, số liệu và đề xuất: [Windows-native diagnosis](./reports/phase-02-g2-windows-native-diagnosis.md). Lịch sử các lượt trước giữ nguyên.

