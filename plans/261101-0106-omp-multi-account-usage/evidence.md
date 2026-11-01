# Evidence, source map và unanswered questions

Date: 2026-11-01. Scope: `my-office` only. Public upstream docs may describe a newer OMP than the 18.14.1 tested during the prior OMP integration.

## Source code đã khảo sát (VERIFIED in workspace)

| File | Đã xác minh | Tác động |
|---|---|---|
| `server/agents/omp/usage.mjs` | `usageRecord` lấy input/output/cache/cost; `aggregateUsage` giữ nullable và self/inherited; `provisionalUsage` là snapshot. Context window unknown. | Reuse ledger, không giả cost/context |
| `server/agents/omp/normalize.mjs` | JSONL entry có usage/model; live event có model + provisional usage; không có stable OAuth account identity. | Cần provider mapping có bằng chứng |
| `integrations/omp/office-observer.js` | `ctx.sessionManager.getUsageStatistics` đọc tổng token/cost; `ctx.model` hiện chỉ đưa model id. | Extension sẽ chỉ bổ sung safe provider id nếu runtime cung cấp và được duyệt |
| `server/agents/projection.mjs` | Claude legacy `usage`; OMP `usage: null`, `metrics` typed; `agentKind` cô lập | Giữ nguyên legacy; additive projection |
| `server/agents/registry.mjs` | Adapter registry owner Claude/OMP; không phải registry tài khoản OAuth | Quota collector tách khỏi session registry |
| `server/index.mjs` | Claude `planLimits`/`limitsOut`/`fetchPlanUsage`/`othersOut` + SSE `k:'limits'` là Claude-specific | Không trộn OMP vào Claude quota/account switching |
| `src/office/ui/mac-drawer.js` | `liveWindows`/`renderLimits`/`renderOthers` hiện đọc `state.limits` Claude | Additive OMP section; không reuse controls |
| `src/office/ui/session-drawer.js` | Render OMP metrics nullable qua `sessionMetricView` | Reuse metrics view, add provider badges |
| `plans/261030-1754-omp-multi-agent-integration` | Existing G4/Phase05 workstream đang tiếp diễn | Prevent scope collision + maintain Claude regressions |

## Windows Native Environment & Pinned Upstream Source (VERIFIED 2026-11-01 — G1 PASS SAFE)

| Thuộc tính | Giá trị đã xác minh | Bằng chứng |
|---|---|---|
| OS / Host | Windows 11 Native (`win32 10.0.26200`, `x64`) | Native host check |
| Executable | `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe` | `where.exe omp` |
| CLI Version | `omp/18.14.2` (`omp v18.14.2`) | `omp --version` |
| Upstream Tag / Commit | `v18.14.2` (`7efd77219374ca4e8767979809835e4aa90666ba`) | `https://github.com/can1357/oh-my-pi/tree/7efd77219374ca4e8767979809835e4aa90666ba` |
| Usage CLI Handler | `packages/coding-agent/src/cli/usage-cli.ts` | `runUsageCommand`, `buildRedactionMap`, `computeProviderWindowStats` |
| Usage Service & Cache | `packages/ai/src/auth/usage.ts`, `packages/ai/src/auth/usage-cache.ts` | `UsageService.reports()`, 5-min TTL (`USAGE_REPORT_TTL_MS`) + ±25% jitter, 10s failure cooldown |
| Reset Expiry & Auto-Reset | `packages/coding-agent/src/session/reset-expiry.ts`, `codex-auto-reset.ts` | Salvage sweep chỉ chạy trong `AgentSession.fetchUsageReports()`; `omp usage` CLI không tạo `AgentSession` |
| Provider Implementations | `packages/ai/src/usage/openai-codex.ts`, `google-antigravity.ts` | `openaiCodexUsageProvider`, `antigravityUsageProvider` |
| Profile & Broker Resolution | `packages/utils/src/dirs.ts`, `packages/coding-agent/src/session/auth-broker-config.ts` | `--profile` > `OMP_PROFILE` > `PI_PROFILE`; `PI_CODING_AGENT_DIR` cho default profile |
| Session JSONL Entries | `packages/coding-agent/src/session/session-entries.ts`, `packages/ai/src/types.ts` | `AssistantMessage.provider`, `ModelUsageEntry.provider`, `ModelChangeEntry.model` (`provider/modelId`) |

## G1 Questions — Resolved with Evidence

1. **Exact Windows native `omp --version` & CLI subcommands/JSON schema**:
   - Binary: `C:\Users\Mr.LeCo\AppData\Local\omp\omp.exe`, version `18.14.2`.
   - Subcommands của `omp usage`: `[invalidate|clients|accounts|reset]`, flags `-j/--json`, `-p/--provider=<id>`, `-r/--redact`, `--history`, `-d/--days=<int>`, `-e/--extension=<path>`, `--no-extensions`.
   - `omp usage --json --no-extensions` xuất JSON ra stdout:
     ```json
     {
       "generatedAt": 1762000000000,
       "reports": [
         {
           "provider": "openai-codex",
           "fetchedAt": 1762000000000,
           "limits": [
             {
               "id": "openai-codex:primary",
               "label": "5 hours",
               "scope": { "provider": "openai-codex", "windowId": "5h", "shared": true },
               "window": { "id": "5h", "label": "5 hours", "durationMs": 18000000, "resetsAt": 1762018000000 },
               "amount": { "used": 25, "limit": 100, "remaining": 75, "usedFraction": 0.25, "remainingFraction": 0.75, "unit": "percent" },
               "status": "ok"
             }
           ],
           "metadata": { "planType": "pro", "allowed": true, "limitReached": false, "email": "us*", "accountId": "ac*", "orgId": "or*" }
         }
       ],
       "accountsWithoutUsage": [],
       "disabledCredentials": [],
       "capacity": {}
     }
     ```
   - `raw` upstream payload luôn bị strip (`const { raw: _raw, ...rest } = report`). Không bao giờ có bearer/access/refresh token hay SQLite `credentialId` trong stdout.
2. **Side-effect decision (`PASS SAFE`) — Saved reset auto-redeem**:
   - Trong `packages/coding-agent/src/cli/usage-cli.ts` (`runUsageCommand`), khi gọi `omp usage --json --no-extensions` (`cmd.action === undefined && cmd.json === true`):
     - Gọi `Settings.loadReadOnly()` (không ghi config).
     - Gọi `authStorage.usage.reports()` để đọc cache 5 phút (`usage_cache:`) hoặc fetch usage report từ provider/broker.
     - **KHÔNG** khởi tạo `AgentSession`, **KHÔNG** chạy `CodexAutoRedeemCoordinator` hay `ClaudeAutoRedeemCoordinator` salvage sweep, và **KHÔNG** gọi `authStorage.resets.redeem()`.
     - `authStorage.resets.redeem()` chỉ được gọi khi truyền rõ `omp usage reset <provider>/<credentialId>`.
   - Kết luận: **`PASS SAFE`** cho lệnh đọc `omp [--profile <name>] usage --json --no-extensions` (tùy chọn `--redact`). My Office tuyệt đối cấm các đối số `reset`, `invalidate`, `login`, `logout`.
3. **Codex & Antigravity account reports, units, windows, `resetsAt`, identity collisions**:
   - **`resetsAt`**: luôn là **epoch milliseconds** (`number`).
   - **`openai-codex`**:
     - Windows chuẩn: `openai-codex:primary` (`5h`), `openai-codex:secondary` (`7d`), thêm `openai-codex:spark:primary` / `secondary` (Spark tier) và `openai-codex:spend-cap` (`unit: "credits"` cho ghế trả theo credit).
     - `amount`: `unit: "percent"`, `used` (`0..100`), `remaining` (`0..100`), `usedFraction` (`0..1`), `remainingFraction` (`0..1`). Nguồn gốc là `used_percent` (`sourceUnit: "used"`).
     - **Decision-2 trap**: khi `limit_reached: true` và `allowed: false`, cả `primary` và `secondary` đều mang `status: "exhausted"` dù chỉ một cửa sổ đạt 100%; cần dựa vào `usedFraction` để biết tỷ lệ thực tế của từng cửa sổ.
   - **`google-antigravity`**:
     - Lấy từ `/v1internal:retrieveUserQuotaSummary` (fallback `/v1internal:fetchAvailableModels`).
     - Windows chuẩn: theo counter (`google`, `anthropic`, `openai`, hoặc `gemini-argon-*`), `windowId` (`5h`, `weekly`, `daily`, hoặc bucketId).
     - Các bucket bên thứ ba dùng chung (`Claude & GPT (shared)`) được nhân bản vào cả counter `anthropic` và `openai` kèm cùng `scope.sharedGroup` (vd `3p-5h:5h`). Collector cần gộp theo `sharedGroup` trong cùng một account để không hiển thị trùng 2 thanh quota giống hệt nhau.
     - `amount`: khi có `remainingFraction`, `unit: "percent"` (`sourceUnit: "remaining"`), `remainingFraction` và `usedFraction = 1 - remainingFraction`. Khi chỉ có `remainingAmount`, `unit: "unknown"`, `remaining: number` (không có phần trăm -> hiển thị `unknown`, không giả `0%`).
   - **Identity & collisions**:
     - Khoá định danh OAuth trong OMP gồm `(provider, email, accountId, orgId, projectId, enterpriseUrl)`.
     - Hai tài khoản Codex có thể trùng `email` nhưng khác `orgId`/`accountId` (nhiều workspace), hoặc trùng `accountId` nhưng khác `email` (Team seats). Hai tài khoản Antigravity có thể trùng `projectId` nhưng khác `email`.
     - Tài khoản không cóUsage (`accountsWithoutUsage`) và tài khoản bị vô hiệu hóa (`disabledCredentials`) đều có mặt trong JSON của `omp usage --json`.
     - Tài khoản không có bất kỳ trường định danh nào (identity-less) được phân biệt theo vị trí ổn định trong phạm vi `(profileNamespace, providerId, "anonymous", index)`.
4. **Session-to-provider & session-to-account attribution (`exact` vs `unsupported`)**:
   - **Provider attribution (`EXACT` trên JSONL và live observer)**:
     - Trong JSONL v3 (`session-entries.ts`, `types.ts`): entry `type: "message"` (`role === "assistant"`) có trường `message.provider` (vd `"openai-codex"`, `"google-antigravity"`, `"anthropic"`) và `message.model`; entry `type: "model_usage"` có `provider` và `model`; entry `type: "model_change"` có `model` dạng `"provider/modelId"`.
     - Trong live extension (`integrations/omp/office-observer.js`): `ctx.model` là object `{ id, provider, ... }` (hoặc chuỗi). Có thể gửi thêm trường `provider` đã kiểm duyệt cùng `model`.
     - Lưu ý: `ctx.sessionManager.getUsageStatistics()` chỉ trả tổng token/cost toàn phiên (không tách theo provider). Do đó, khi phiên có dữ liệu JSONL bền vững (`recorded`), rollup theo `(providerId, modelId)` là **chính xác theo từng entry**; khi chỉ có snapshot `provisional` từ runtime, chỉ gắn với `provider` hiện tại nếu phiên chưa đổi provider, hoặc giữ ở trạng thái `provisional`.
   - **Session-to-account attribution (`UNSUPPORTED` -> `unattributed`)**:
     - JSONL chỉ lưu `credentialId?: number` (ID dòng nội bộ trong SQLite) hoặc `credential_pin.hash` (SHA-256 không muối phục vụ prompt-cache). `omp usage --json` không xuất `credentialId` hay `credentialPinHash`.
     - Do đó, không có tín hiệu định danh tài khoản OAuth khả dụng để nối từng message với một `accountKey` trong `omp usage --json`. Mọi chi phí/token của phiên OMP phải hiển thị theo `provider / model / session` với trạng thái tài khoản là `unattributed` (`accountKey: null`), tuyệt đối không đoán từ tài khoản đang active.
5. **Windows vs WSL2, Auth Broker, và Privacy Controls**:
   - Windows native `omp.exe` dùng `%USERPROFILE%\.omp`, tách biệt hoàn toàn với WSL2 `~/.omp`. Collector chỉ gọi binary Windows native với `shell: false`, cố định argv, cùng user/profile (`OMP_PROFILE` / `--profile`).
   - Nếu profile cấu hình Auth Broker (`OMP_AUTH_BROKER_URL` / `config.yml`), `omp usage --json` tự động đọc qua broker pool được cấp phép; nếu broker断 kết nối, CLI trả lỗi `AuthBrokerError` (exit 1) và collector chuyển sang trạng thái `unavailable` (hoặc giữ `stale` last-good có thời hạn), không tự đọc `agent.db`.
   - **Privacy**: Backend sinh `accountKey` opaque bằng HMAC có khóa ngẫu nhiên theo tiến trình (hoặc key cấu hình) trên tuple `(profileNamespace, providerId, email, accountId, orgId, projectId, enterpriseUrl)`, đồng thời mask mọi nhãn hiển thị (`al* · org: te*`) ngay tại server. Remote/mobile viewer không nhận thông tin định danh tài khoản nhạy cảm.

## Research status

G1 hoàn tất (**PASS SAFE**). Đã xác minh phiên bản `omp/18.14.2` trên Windows native, đối chiếu toàn bộ mã nguồn tag `v18.14.2` (`7efd77219374ca4e8767979809835e4aa90666ba`), chứng minh `omp usage --json --no-extensions` không tiêu saved resets, và khóa hợp đồng dữ liệu cho Phase 02–05.
