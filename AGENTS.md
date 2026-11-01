# AGENTS.md — Quy tắc và Hướng dẫn Vận hành cho Coding Agents (`my-office`)

Repository này là bản fork cá nhân của `my-office`, chạy trên Windows 11 (`win32` native), tích hợp quan sát đồng thời **Claude Code** và **OMP (Oh My Pi)** ở chế độ chỉ-đọc (`files` và `hybrid`).

---

## 1. Cấu trúc Git Remotes & Nhánh làm việc

- **`origin`** (`https://github.com/lcaloi2904/my-office.git`): Repo cá nhân của chủ dự án (nơi push code).
- **`upstream`** (`https://github.com/khanh020905/my-office.git`): Repo cộng đồng gốc (chỉ dùng để `fetch` và `merge`; **TUYỆT ĐỐI KHÔNG push lên `upstream`**).
- **`main`**: Nhánh chính đang chạy thực tế (chứa cả tính năng gốc từ `upstream` lẫn toàn bộ tích hợp OMP).

---

## 2. Quy trình kéo tính năng mới từ `upstream/main` (Không làm mất code OMP)

Khi người dùng yêu cầu cập nhật / kéo tính năng mới từ repo gốc (`upstream`), thực hiện đúng các bước sau:

### Bước 1: Kiểm tra trạng thái máy trạm và tải nhánh mới từ `upstream`
```bash
git status -s
git fetch upstream
```
*(Nếu đang có file sửa dở thì commit hoặc `git stash` trước khi merge. Không ghi đè `.gitattributes` hoặc thư mục `data/`).*

### Bước 2: Gộp `upstream/main` vào `main`
```bash
git checkout main
git merge upstream/main
```
- **TUYỆT ĐỐI KHÔNG** dùng `git reset --hard upstream/main` hoặc `git rebase upstream/main` trên lịch sử đã push. Luôn dùng `git merge upstream/main`.

### Bước 3: Quy tắc xử lý xung đột (Merge Conflict) nếu có

1. **Các file/thư mục riêng của OMP (Luôn giữ bản của nhánh hiện tại — `ours`)**:
   - `server/agents/**` (`schema.mjs`, `registry.mjs`, `projection.mjs`, `conversation.mjs`, `claude/compat.mjs`, `omp/*`)
   - `integrations/omp/**` (`office-observer.js`, `private-storage.js`, `README.md`)
   - `src/office/ui/omp-history.js`
   - `docs/OMP-INTEGRATION.md`, `scripts/benchmark-omp.mjs`, `start-office.cmd`, `AGENTS.md`
   - `playwright.omp.config.ts`, `playwright.hybrid.config.ts`, `tests/unit/omp-*.test.mjs`, `tests/unit/agent-*.test.mjs`, `tests/e2e/agents.spec.ts`, `tests/e2e/omp-*.spec.ts`, `tests/fixtures/omp/**`

2. **Các file điểm nối dùng chung (Giữ tính năng mới của `upstream` + Giữ nguyên cổng nối OMP)**:
   - `server/index.mjs`: Giữ khối khởi tạo `OMP_MODE`/`ompAdapter`/`ompBridge`, bộ hợp nhất `agents` registry, cờ `broadcast(msg, true)` (local-only cho OMP), các chốt chặn `isClaudeRequest`/`resolveForControl` ở `/api/open`, `/api/tasks`, `/api/accounts/*`, và các route OMP (`/api/omp/catalog`, `/api/omp/pin`, `/ingest/omp/v1`, `/api/log` phân trang).
   - `src/office/people/workers.js` & `src/office/net/live.js`: Giữ nhãn `agentKind` (`omp`), nhóm dự án theo `projectKey`, khóa nhân vật ổn định cho session/subagent, và trần 64 nhân vật / 32 subagent mỗi phiên chính.
   - `src/office/ui/activity.js`, `src/office/ui/lite.js`, `src/office/ui/session-drawer.js`: Giữ nhóm `unknown` trên danh sách bên trái, nút mở lịch sử OMP, thông báo chỉ-đọc (`capabilities`), phân trang ngược `/api/log`, và hiển thị `metrics` rỗng là `–` (không hiển thị `0` hay `NaN` giả).
   - `src/office/life/quota.js` & `src/office/people/accountant.js`: Giữ chốt loại trừ `agentKind === 'omp'` và `scope === 'inherited'` khỏi hạn mức gói Claude và tổng chi phí ngày của Claude.
   - `src/shared/timeline.js` & `src/office/replay/replay.js`: Giữ khóa dòng thời gian theo `sessionKey`, theo dõi công cụ chạy song song theo `toolCallId`, và khóa các tác dụng phụ khi xem lại (replay).

### Bước 4: Kiểm thử & Build lại sau khi Merge

Trên Windows native (`node_modules` có thể không có shim `.cmd`, hãy gọi trực tiếp qua `node`):

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node --test tests/unit/agent-*.test.mjs tests/unit/omp-*.test.mjs tests/unit/timeline.test.mjs tests/unit/i18n.test.mjs
```

Sau khi test xanh, build lại bản production cho `start-office.cmd` và đẩy lên GitHub cá nhân:
```cmd
start-office.cmd rebuild
git push origin main
```

---

## 3. Ranh giới An toàn & Bảo mật Bắt buộc

- **Không chạm vào dữ liệu/token OMP thật khi chạy test**: Tuyệt đối không đọc, sửa hoặc xóa `~/.omp/office-private/{ingest,observer}.json`, `~/.omp/agent/extensions/office-observer/`, hoặc `~/.omp/agent/sessions` trừ khi người dùng yêu cầu trực tiếp.
- **Giữ OMP ở chế độ chỉ-đọc và loopback-only**: Không mở quyền tắt tiến trình, gửi prompt, duyệt lệnh từ xa hoặc nhận HTTP ingest ngoài `127.0.0.1` cho OMP.
- **Tài liệu chi tiết**: Xem [docs/OMP-INTEGRATION.md](docs/OMP-INTEGRATION.md) và [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 4. Quy tắc riêng của Chủ dự án (Custom Rules)

*(Bạn có thể viết thêm bất kỳ quy tắc làm việc, ngôn ngữ giao tiếp, quy ước code hoặc yêu cầu riêng nào vào danh sách dưới đây. Mọi Agent sẽ đọc và tuân thủ):*

- Luôn giao tiếp, giải thích và viết tài liệu/báo cáo bằng **tiếng Việt**.
- Không tự ý `git reset --hard`, xóa nhánh, hoặc xóa dữ liệu trong `data/` và `~/.omp/` khi chưa hỏi ý kiến.
