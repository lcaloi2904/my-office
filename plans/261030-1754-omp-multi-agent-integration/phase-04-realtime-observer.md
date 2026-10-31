---
phase: 4
title: "Observer extension và hybrid realtime"
status: in-progress
priority: P1
effort: "Chưa ước lượng"
dependencies: [3]
---

# Phase 4 — Realtime có giới hạn, không điều khiển OMP

## Goal / Entry gate

Sau G3 và approval source, bổ sung runtime observations để phân biệt open/active/idle/waiting/stale. Viết extension trong repo không đồng nghĩa đã được phép cài vào OMP user/project config. D6 phải được duyệt riêng trước live activation; không triển khai control plane.

## Context

[Contracts §§4–9](./design-contracts.md), [evidence O3/O8](./evidence.md), [validation R1–R10/S1–S8](./validation-matrix.md). Khai báo event type không đủ chứng minh mọi execution path phát event đó; G1/G4 phải kiểm tra emission/order ở version thật.

## Files to Create / Modify

Không xóa file.

| Action | Absolute path | Mục đích |
|---|---|---|
| Create | `/mnt/e/vide-code/my-office/integrations/omp/office-observer.js` | Factory JS nhận pi/ctx, không thêm OMP runtime dependency vào My Office |
| Create | `/mnt/e/vide-code/my-office/integrations/omp/README.md` | Compatibility, opt-in setup, permission manifest, uninstall do người dùng duyệt |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/bridge.mjs` | Authenticated ingress, sequencing, bounds, diagnostics |
| Create | `/mnt/e/vide-code/my-office/server/agents/omp/lifecycle.mjs` | Runtime instance/generation, pending tools, wait reasons, stale/recovery |
| Modify | `/mnt/e/vide-code/my-office/server/agents/omp/index.mjs`, `/mnt/e/vide-code/my-office/server/agents/omp/normalize.mjs`, `/mnt/e/vide-code/my-office/server/agents/omp/usage.mjs` | Hai nguồn đi qua một reducer/authority policy |
| Modify | `/mnt/e/vide-code/my-office/server/agents/schema.mjs`, `/mnt/e/vide-code/my-office/server/agents/projection.mjs`, `/mnt/e/vide-code/my-office/server/index.mjs` | Versioned wire contract, dedicated ingress, telemetry-only projection |
| Create | `/mnt/e/vide-code/my-office/tests/unit/omp-bridge.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-lifecycle.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-observer.test.mjs` | Fake clock, injected transport/pi/ctx, out-of-order/retry/isolation |
| Modify | `/mnt/e/vide-code/my-office/tests/e2e/agents.spec.ts`, `/mnt/e/vide-code/my-office/tests/fixtures/omp/` | Event-file reconciliation và waiting/status fixtures |

Dùng factory JS để Node test harness import được mà không cần package OMP hoặc thay root tsconfig. Đây không thay cho live extension loading test trên phiên bản OMP đã chọn.

## Tasks & Steps

1. Đối chiếu runtime: session startup/switch/shutdown, agent/turn boundaries, message_end, tool_execution_start/update/end, approval requested/resolved và ctx.agent. Lưu event fixture + support matrix. Nếu thiếu start/end/child identity ở một path, đánh dấu degraded; không bịa event.
2. Viết test factory với injected pi/ctx/transport và fake timers. State nằm trong factory/session binding hoặc Map có ownership/cleanup rõ, không dùng module singleton chứa 'current session'. Test hai parents và child factories đồng thời.
3. Extension chỉ chọn metadata fields, sanitize tại nguồn; không send provider payload/systemPrompt/env/credential fields. Message text chỉ khi privacy cho phép; không mirror token updates mặc định. Dùng tool category/bounded input summary, không raw result streaming.
4. Callback enqueue rồi trả về; network drain độc lập có timeout/backoff/jitter, max messages/bytes và drop/coalescing policy. Managed timer dùng khi runtime hỗ trợ, shutdown/switch hủy timers, request và closures. Không chờ vô hạn để flush trước OMP exit. My Office offline không làm tool fail.
5. Implement dedicated `/ingest/omp/v1` chỉ ở hybrid. Source-bound token ngoài repo; reject Origin/tunnel/invalid source/version/size/rate. Source được auth vẫn chỉ khai báo session thuộc approved namespace; paths chỉ là hints để resolve allowlist. Không dùng `/event` hoặc phone token. Địa chỉ cross-host chỉ bật sau approval transport.
6. ACK sau khi event được validate/apply trong reducer; ACK memory không được mô tả là durable guarantee. Mất process sau ACK có thể mất transient event: reconnect snapshot + file reconciliation khôi phục phần có bằng chứng và đánh dấu gap cho phần còn thiếu. Không hứa exactly-once hoặc complete token history.
7. Sequence theo runtime instance/generation, idempotency theo contracts. Bound reorder window; old generation không mutate session mới. Tool pending set xử lý parallel tools, result-before-start, duplicate terminal, aborted/error, session resume và late events.
8. Heartbeat/snapshot giữ isIdle, pending messages/jobs và wait reasons riêng. Heartbeat stale dùng thời gian server nhận, không dùng producer wall clock làm liveness. Proposed heartbeat 10s/stale 30s/disconnected 90s chỉ là giá trị ban đầu để tune; stale không emit completed/end. Tool dài có heartbeat không bị timeout như Claude.
9. Reconcile file/live: execution start/end cập nhật một tool logical record; persisted usage thay provisional snapshot, không cộng hai lần. Session chưa có JSONL vẫn có live actor nhưng history/usage volatile. File materialize không tạo actor thứ hai. Branch switch không lấy entry.parentId làm parent agent.
10. Reconnect gửi current snapshot và watermark; client SSE reconnect nhận union snapshot mới. Không dựa vào EventSource Last-Event-ID vì protocol cũ chưa cung cấp contract đó. Không bơm events gap vào animation như mới.
11. Cài extension và test với OMP thật chỉ trong môi trường riêng được duyệt, credentials do người dùng quản lý, không đọc/chụp credentials. Prompt/model-backed smoke có thể phát sinh chi phí nên cần approval. Không tự thay OMP settings hoặc cài/up/version.

## Success Criteria / G4

- R1–R10/S1–S8 pass tại các test levels được duyệt; tests chưa chạy để NOT RUN.
- Offline/overload không chặn agent; queue và memory có cap; shutdown/switch không còn timer/listener ownership rò rỉ.
- Active/idle/waiting/stale phản ánh evidence; tool duration lớn không false-complete, crashed producer không ghost live vĩnh viễn.
- Event+file input, reconnect và restart không đếm trùng logical tool/durable usage.
- OMP remains telemetry-only; server không trả commands, approve/deny hoặc paths mở tùy ý.
- Live compatibility test ghi version/build/mode; không coi unit fake pi chứng minh mọi OMP build hoạt động.

## Verification — chỉ chạy sau approval

```bash
node --test tests/unit/omp-bridge.test.mjs tests/unit/omp-lifecycle.test.mjs tests/unit/omp-observer.test.mjs
npm run lint
npm run typecheck
npm test
```

JS factory không bị typecheck đầy đủ trong cấu hình hiện tại; schema/unit + approved OMP loading smoke là gates bổ sung. E2E dùng E1; live OMP/cross-host smoke dùng permission riêng, không đưa vào npm test mặc định.

## Todo

Kết quả và bằng chứng: [Phase 04 implementation](./reports/phase-04-implementation.md).

- [x] Versioned event emission/support matrix — viết trong `integrations/omp/README.md`; emission trên bản thật **chưa xác minh** (R10).
- [x] Factory isolation + bounded sender + cleanup — `omp-observer.test.mjs` (fake pi).
- [x] Ingress auth/limits và ownership negative tests — `omp-bridge.test.mjs` + smoke server thật.
- [x] Lifecycle + idempotent reconciliation + reconnect — `omp-lifecycle`, `omp-live-merge`.
- [~] Optional live smoke sau D6 — D6 duyệt; 18.14.1 print + rpc PASS (session/turn/tool/usage/shutdown, new/resume/fork, approval, merge file thật); observer đã cài vĩnh viễn. Chưa chạy: plan review (không thấy event dưới `--plan-yolo`), interactive, subagent, `ask`.
- [ ] G4 evidence và approval Phase 5 — chưa đóng: R10, S7, ACL Windows còn thiếu.

## Risks / Stop conditions / Rollback

Nếu extension hook latency ảnh hưởng agent, ưu tiên ngừng sender/giảm payload và báo gate fail, không sửa agent tools. Nếu cross-host cần mở public listener hoặc ACL chưa xác minh, dừng transport đó. Rollback My Office về files/off; extension disable/uninstall chỉ theo permission riêng, không tự xóa user config. File-only fallback vẫn ghi rõ live state unknown.
