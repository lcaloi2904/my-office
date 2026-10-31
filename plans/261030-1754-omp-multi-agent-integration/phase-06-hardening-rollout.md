---
phase: 6
title: "Cross-OS, security, performance và rollout"
status: pending
priority: P1
effort: "Chưa ước lượng"
dependencies: [5]
---

# Phase 6 — Kiểm chứng, hardening và tài liệu vận hành

## Goal / Entry gate

Sau G5 và approval validation, xác minh các topology được cam kết, đo overhead thực, review security/cleanup rồi rollout opt-in. Không tự nâng version OMP, cài dependency, mở mạng hoặc push/merge.

## Context

[Validation matrix](./validation-matrix.md), [contracts §§7–10](./design-contracts.md), [evidence M15–M20/P1](./evidence.md). Baseline before-change phải được thu từ Phase 2 hoặc một snapshot/reference được người dùng duyệt; không dựng lại baseline bằng reset Git.

## Files to Create / Modify

| Action | Absolute path | Mục đích |
|---|---|---|
| Create | `/mnt/e/vide-code/my-office/scripts/benchmark-omp.mjs` | Synthetic workload, sampled metrics, bounded output, không dùng personal sessions |
| Create | `/mnt/e/vide-code/my-office/docs/OMP-INTEGRATION.md` | Configuration/support matrix/privacy/setup/troubleshooting/rollback |
| Modify | `/mnt/e/vide-code/my-office/docs/ARCHITECTURE.md`, `/mnt/e/vide-code/my-office/README.md`, `/mnt/e/vide-code/my-office/README.vi.md` | Agent adapters, feature flags và giới hạn thực |
| Modify | `/mnt/e/vide-code/my-office/tests/unit/omp-paths.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-reader.test.mjs`, `/mnt/e/vide-code/my-office/tests/unit/omp-bridge.test.mjs`, `/mnt/e/vide-code/my-office/tests/e2e/agents.spec.ts` | Cross-OS/security/recovery cases phát hiện qua review |
| Modify if approved | `/mnt/e/vide-code/my-office/server/agents/omp/reader.mjs`, `/mnt/e/vide-code/my-office/server/agents/omp/paths.mjs`, `/mnt/e/vide-code/my-office/server/agents/omp/bridge.mjs`, `/mnt/e/vide-code/my-office/server/agents/omp/index.mjs` | Scoped hardening dựa trên issue cụ thể, không refactor lan rộng |
| Create | `/mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration/reports/performance-results.md`, `/mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration/reports/security-review.md`, `/mnt/e/vide-code/my-office/plans/261030-1754-omp-multi-agent-integration/reports/rollout-checklist.md` | Bằng chứng; chỉ tạo khi phase được thực thi |

Không thêm npm script/package/CI job nếu không cần. Benchmark chạy trực tiếp bằng Node sau khi script có help và permission manifest; flags chỉ chốt lúc triển khai, không giả CLI đã tồn tại.

## Tasks & Steps

1. Chạy gate toàn repository: lint/typecheck/unit, approved production build, existing E2E + mixed-agent E2E + smoke. Baseline failures ghi riêng; không sửa unrelated tests hoặc thay expected chỉ để xanh.
2. Security review theo S1–S8: auth/Origin/tunnel, rate/body limits, arbitrary paths, symlink/TOCTOU, malformed JSONL, secrets/XSS, source impersonation/generation, controls. Thử chỉ fake credentials và isolated roots/processes; không kill coding agents thật.
3. Windows–WSL matrix: same-WSL, same-Windows, Windows source/server WSL và reverse nếu môi trường có sẵn được duyệt. Kiểm tra paths có space/non-ASCII, case/drive/UNC, replacement, permission denial, watcher fallback, networking NAT/mirrored theo cấu hình thật. Topology chưa thử ghi NOT VERIFIED, không tuyên bố supported ngang nhau.
4. Cross-host event transport: dùng configuration/tunnel đã duyệt, không tự mở firewall/LAN. Nếu không có kênh an toàn, chỉ files với nhãn degraded; ghi realtime cross-host blocked và decision còn thiếu, không bỏ qua gate toàn scope.
5. Benchmark A/B theo workload trong validation-matrix, tách server, observer và browser. Đo không viewer/List/Low Quality và nhiều sessions/subagents; CPU normalized một core, RSS/heap/FD/watchers/bytes read, p95 latency và frame cost. Offline/loss/reconnect/slow-client cần cùng workload ở cả hai phía.
6. Chạy churn và soak trong thời gian đã duyệt, lưu độ dài thực, sample interval, warm-up và raw summary. Nếu runtime/tool timeout không đủ soak, ghi incomplete; không hứa tự chạy nền. Không đánh giá memory leak chỉ từ một RSS peak.
7. So với PROPOSED gates. Nếu phải đổi ngưỡng, ghi lý do/baseline và xin chấp thuận, không hạ ngưỡng sau fail để báo pass. Mọi tuning được retest regression và có before/after numbers.
8. Kiểm tra feature OFF dừng OMP resources; fallback hybrid->files có privacy/liveness semantics đúng; token revoke/rotation không làm Claude ngừng. Không auto-delete OMP transcript/cache/profile.
9. Docs sync: cấu hình mẫu không chứa personal paths/secrets; support matrix version/platform/mode; hướng dẫn privacy/retention/cost semantics; install/disable extension là bước opt-in riêng. Nêu những gì không được hỗ trợ.
10. Review patch, pending Git changes và acceptance evidence; chỉ đề nghị rollout khi gates được thông qua. Không commit/push/PR trong scope này. Default OFF, chọn roots và bật files trước, sau đó hybrid nếu được duyệt; không bật đồng loạt mọi profile.

## Success Criteria / G6

- Không có security blocker; Claude regression đã chạy và pass hoặc được ghi blocked rõ.
- Performance có số đo thực và gate status; không có claim improvement chỉ từ thiết kế.
- Cross-OS support đúng phạm vi đã test, không dùng PID namespace lẫn nhau; chưa test ghi UNKNOWN/NOT VERIFIED.
- Offline/slow client/churn không gây queue/FD/timer tăng không giới hạn; recovery không duplicate usage/events.
- README/architecture/setup/rollback đồng bộ, dữ liệu OMP nguyên trạng, no secrets in logs/docs.

## Verification — chỉ chạy sau approval

```bash
npm run lint
npm run typecheck
npm test
```

Build/E2E dùng E1 và full suite theo validation-matrix. Benchmark script chưa tồn tại ở lúc lập kế hoạch; chỉ chạy sau source review + user approval cho workload/duration/output, không thực thi một lệnh giả định flags. Git verification dùng `GIT_OPTIONAL_LOCKS=0`, xem staged/unstaged/untracked riêng và bảo toàn .gitattributes.

## Todo

- [ ] Full regression + security negative cases.
- [ ] Windows–WSL support matrix có evidence.
- [ ] A/B/churn/soak measured results.
- [ ] Rollback và feature-off behavior verified.
- [ ] Docs sync + final code review + approval rollout.

## Risks / Stop conditions / Rollback

Fail security, unbounded resources, lost identity hoặc Claude regression chặn rollout. Không đủ thiết bị/quyền test chéo OS thì gate tương ứng blocked, không thay bằng suy luận. Rollback: disable OMP driver, drain/stop bounded sender, giữ Claude path; sửa hoặc revert scoped integration patch theo approval. Không reset hard/clean, không xóa history, không thay remote/branch.
