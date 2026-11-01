---
phase: 5
title: "Opt-in control bridge cho OMP TUI được khởi chạy bên ngoài"
status: pending
priority: P1
effort: "4-6 dev-days"
dependencies: [1, 4]
---

# Phase 05 — External OMP TUI control bridge

## Goal
Tương tác trực tiếp với các session OMP TUI đang chạy ngoài My Office **chỉ khi runtime đã nạp extension riêng và tự nguyện cấp quyền**, không phá telemetry read-only hoặc cố attach PID trái phép.

## Critical constraints
- Existing `integrations/omp/office-observer.js` và `POST /ingest/omp/v1` vẫn **one-way telemetry**; không thêm command vào ingest ACK hoặc tái sử dụng source token.
- User phải approve cài/enable extension và isolated native Windows tests; plan và G4 không tự cho phép install.
- Phiên đã tắt / TUI không có extension -> **không điều khiển được**; UI cung cấp “Tiếp tục phiên”/“Tạo mới” qua managed RPC sau checks, không hiển thị giả “Reconnect”.

## Candidate files
| Action | Repo-relative file | Purpose |
|---|---|---|
| Create | `integrations/omp/office-controller.js` | Dedicated opt-in OMP extension factory; separate from observer |
| Create | `server/agents/omp/controller-bridge.mjs` | Scoped auth, handshake/lease, bounded command queue + ACK |
| Modify | `server/agents/omp/control-manager.mjs` | External owner arbitration, generation conflicts and revocation |
| Modify | `server/index.mjs` | Independent loopback-only `register/poll/ack`, precise Origin policy for trusted non-browser runtime requests |
| Modify | `server/agents/omp/lifecycle.mjs`, `server/agents/omp/index.mjs`, `server/agents/projection.mjs` | Reconcile external control state with observer evidence |
| Modify | `src/office/ui/omp-controls.js`, `src/office/ui/session-drawer.js` | State unsupported/connecting/ready, guidance and disable reasons |
| Modify | `integrations/omp/README.md` | Opt-in deployment and safe uninstall/disable |
| Create | `tests/unit/omp-controller.test.mjs`, `tests/unit/omp-controller-bridge.test.mjs` | Fake pi, fake clock, scopes, malicious inputs |
| Modify | `tests/e2e/omp-hybrid.spec.ts`, `tests/e2e/omp-controls.spec.ts` | Observer-only vs controllable external TUI |

## Steps
1. Verify installed OMP extension callbacks and `pi.sendUserMessage` semantics in TUI (idle/running); test mode support, `ctx.abort()` and whether callbacks can await network safely. **No assumption** a live TUI accepts remote injection without extension or initialized context.
2. Design independent private control token per configured source/runtime with protected Windows DACL and rotation. Control source cannot invoke other sources; disable/revoke immediately, credentials never logged or in browser.
3. Extension factory avoids module globals, binds sessionId/instanceId/generation/nonce, negotiates capabilities, registers ownership via loopback. Dual-controller conflict and stale observer evidence fail closed; don't choose last writer blindly.
4. Separate `register`/`poll`/`ack` transport (exact routes finalized at G5) with strict loopback, trust-token, bounded request/response, rate/backoff/jitter, long-poll cleanup, exit abort and no listener when feature OFF.
5. Dispatch into OMP process via runtime-supported prompt/steer/follow-up/abort API only; on active tasks, choose mode explicitly. Record command IDs in bounded dedup so ACK loss cannot double-inject; when status uncertain, show unknown and require user verification.
6. On `session_switch`, resume, fork or shutdown invalidate old lease and pending queue; no stale command reaches new generation. External runtime not owned by My Office: disable process close/kill, profile switch, arbitrary shell or path operation.
7. Merge external control projection with existing read-only OMP actor. One actor per logical conversation; no changed usage provenance, tool counters or permanent transcript modifications.
8. Native TUI smoke only with user-approved isolated model fixture/loopback scripted responses; no OAuth credential read, package install or real project mutation. Unit factory tests cover offline, permissions, token rotation and cleanup.

## Activity Bubbles cho external TUI — phạm vi bổ sung G5

- Observer hiện có chỉ gửi `tool_start/tool_end` dạng category, do đó agent chưa opt-in controller vẫn có thể hiện bubble **chung** như “Đang đọc file”, “Đang sửa code”, không hiện raw filename/test/command.
- Nếu runtime TUI được user bật controller và installed API cho metadata chính xác, Phase 05 gửi thêm **activitySummary đã lọc** (kind, optional safe basename/test label, runtimeInstanceId, generation, eventSequence, observedAt/TTL) qua control-only channel. Không sửa `office-observer.js` thành content collector hoặc tái sử dụng ingest token; không gửi prompt/thinking/args/results/full paths.
- On disconnect, fork, session switch, owner conflict, tool end: invalidate summary cũ. Two concurrent TUI workers không trộn thông tin. Activity summary không tạo khả năng gửi command mới.
- Bổ sung fake-pi unit fixtures và E2E `tests/e2e/omp-activity-bubbles.spec.ts` cho observer-only vs opt-in, stale/malformed, streamer/remote privacy. Nếu runtime không hỗ trợ safe detail, giữ generic label và ghi rõ unsupported.

### G5 acceptance bổ sung

- [ ] External TUI chưa nạp controller có bubble category đúng nhưng không lộ detail.
- [ ] Opt-in metadata không leak qua source/session/generation khác, tắt hoặc đổi phiên thì clear; không thay read-only observer.

## G5 acceptance
- [ ] External TUI w/o controller remains read-only, even if observer connected.
- [ ] User-installed controller session can exchange at most one command per request ID in correct generation; no lost/double prompt and bounded idle overhead.
- [ ] TUI closed/disconnected and conflict reject commands safely; no unauthorized process kill/attach.
- [ ] Old observer and OMP usage still work while controller OFF/failed.
- [ ] Windows native capability tests pass or G5 remains OPEN; failure doesn't block managed RPC from G4.

## Verification (after approval)
```bash
node --test tests/unit/omp-controller.test.mjs tests/unit/omp-controller-bridge.test.mjs tests/unit/omp-observer.test.mjs tests/unit/omp-bridge.test.mjs tests/unit/omp-lifecycle.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/omp-hybrid.spec.ts tests/e2e/omp-controls.spec.ts --config=playwright.hybrid.config.ts
```

## Stop / rollback
If extension breaks OMP TUI, callbacks hang, commands leak across sessions, runtime owner uncertain or token ACL unsafe → disable new control bridge only, unhook on next permitted reload, retain observer read-only and all JSONL. No automatic extension uninstall or process terminate.
