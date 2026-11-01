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
   - `docs/OMP-INTEGRATION.md`, `scripts/benchmark-omp.mjs`, `start-office.ps1`, `AGENTS.md`
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

Sau khi test xanh, build lại bản production cho `start-office.ps1` và đẩy lên GitHub cá nhân:
```powershell
.\start-office.ps1 buildonly
git push origin main
```

---

## 3. Ranh giới An toàn & Bảo mật Bắt buộc

- **Không chạm vào dữ liệu/token OMP thật khi chạy test**: Tuyệt đối không đọc, sửa hoặc xóa `~/.omp/office-private/{ingest,observer}.json`, `~/.omp/agent/extensions/office-observer/`, hoặc `~/.omp/agent/sessions` trừ khi người dùng yêu cầu trực tiếp.
- **Giữ OMP ở chế độ chỉ-đọc và loopback-only**: Không mở quyền tắt tiến trình, gửi prompt, duyệt lệnh từ xa hoặc nhận HTTP ingest ngoài `127.0.0.1` cho OMP.
- **Tài liệu chi tiết**: Xem [docs/OMP-INTEGRATION.md](docs/OMP-INTEGRATION.md) và [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 4. Quy tắc riêng của Chủ dự án (Custom Rules)
### Security - Sensitive Files

- **TUYỆT ĐỐI KHÔNG** được đọc, mở, view, hoặc truy cập các file sau:
  - `env/*.env`
  - `.env*`
  - Bất kỳ file nào chứa credentials, API keys, passwords
- Nếu cần biết tên biến môi trường, hãy **hỏi user** thay vì tự đọc file.

### Git Ignore Compliance

- **BẮT BUỘC** tuân thủ `.gitignore` của repository.
- Không tự ý stage, force-add, commit, hoặc push bất kỳ file/folder nào đã được khai báo trong `.gitignore`.
- Nếu file/folder bị ignore, mặc định bỏ qua trong quy trình commit và không cần hỏi lại user.
- Chỉ được thêm file bị ignore vào git khi user yêu cầu trực tiếp và rõ ràng.

### Dọn dẹp file tạm

- **BẮT BUỘC** trước khi báo hoàn tất, xoá mọi file/thư mục tạm do agent tạo trong task, kể cả ngoài repo (như `%TEMP%`): ảnh debug/screenshot, log chẩn đoán, harness, script và dữ liệu thử dùng một lần. Theo dõi đúng đường dẫn đã tạo để dọn sạch, tránh tích tụ rác.
- Chỉ xoá artefact của chính task; giữ nguyên file có sẵn, dữ liệu người dùng, source/test/tài liệu bàn giao và môi trường PostgreSQL test/volume được yêu cầu giữ lại. Không quét xoá thư mục tạm dùng chung. Chỉ giữ artefact tạm khi user yêu cầu rõ ràng; nếu không xoá được, báo đường dẫn và lý do.
- **Backup và artefact cần giữ phải nằm trong project**, dưới `backups/<release-hoặc-mục-đích>-<timestamp>/`; giữ dump cùng manifest/checksum và bảo đảm cả thư mục bị Git ignore. Không lưu chúng ở `%LOCALAPPDATA%`, `%TEMP%` hoặc thư mục ngoài project trừ khi user chỉ định rõ vị trí khác. File thử dùng một lần vẫn phải dọn theo quy tắc trên.

### Chủ động phát hiện và gợi ý kiến thức đáng học

- Trong khi khảo sát, thiết kế, triển khai, debug, kiểm thử hoặc review, nếu phát hiện **khái niệm, cơ chế, công cụ, kỹ thuật, bài học hoặc đánh đổi (trade-off)** mới, hữu ích hay quan trọng mà chủ dự án nên hiểu để nâng cao năng lực hoặc ra quyết định tốt hơn, **hãy chủ động gợi ý học/tìm hiểu sâu**; không cần đợi người dùng hỏi trước.
- Chỉ đề xuất những chủ đề **thực sự liên quan đến công việc vừa làm và có giá trị học tập rõ ràng**. Nêu ngắn gọn (1) chủ đề là gì, (2) vì sao đáng học trong bối cảnh dự án, rồi (3) hỏi người dùng có muốn tìm hiểu sâu hay không.
- Mẫu gợi ý: **"Trong lúc làm [công việc], mình nhận thấy [chủ đề] khá quan trọng vì [lý do/tác động]. Bạn có muốn mình giải thích sâu hơn, kèm ví dụ thực tế trong `my-office`, không?"**
- Đặt lời gợi ý ở cuối một mốc làm việc hoặc phần tổng kết phù hợp; **không ngắt luồng triển khai**, không biến mỗi bước thành một bài giảng, không hỏi dồn dập và không lặp lại cùng chủ đề khi người dùng đã từ chối hoặc thể hiện đã hiểu.
- Chỉ khi người dùng đồng ý, mới đào sâu từ trực giác/kiến thức nền đến cách hoạt động, trường hợp nên/không nên áp dụng, đánh đổi và một ví dụ hoặc bài thực hành sát với dự án. Nêu rõ điều gì đã kiểm chứng và điều gì chỉ là đề xuất.
- Đây là **lời mời học tập tùy chọn**, không thay thế câu hỏi làm rõ yêu cầu, xác nhận quyền thao tác hay quy trình kiểm chứng. Không tự mở rộng phạm vi công việc, thay đổi kiến trúc hoặc chạy thao tác rủi ro chỉ để minh họa.

### Quy tắc lưu nội dung học (skill `teach` và `research`)

Mọi nội dung học tập phải lưu vào workspace `learning` của MCP cloud-harness-local, KHÔNG lưu trong repo của dự án này.

Đây là ngoại lệ duy nhất cho quy tắc "chỉ dùng workspace mặc định của dự án": chỉ để đọc/ghi nội dung học trong `learning`. Mọi tác vụ khác (code, tài liệu, test, kế hoạch của dự án) vẫn dùng workspace mặc định của dự án như các quy tắc ở trên.

Chỉ áp dụng khi tôi yêu cầu học, tìm hiểu một chủ đề hoặc ghi lại kiến thức (ví dụ "dạy tôi...", "tôi muốn học...", "lưu lại kiến thức này"). Câu hỏi research thông thường về dự án thì trả lời trong chat, không ghi vào `learning`.

Cấu trúc trong `learning`: mỗi chủ đề mới là MỘT thư mục `<chu-de-kebab-case>/` ở gốc, chứa mọi thứ về chủ đề đó:
- `MISSION.md`, `RESOURCES.md`, `NOTES.md`
- `lessons/` (bài học `0001-ten-bai.html`), `reference/`, `learning-records/` (`0001-ten.md`), `assets/` (đúng định dạng của skill `teach`)
- `research/` cho kết quả skill `research`, đặt tên `YYYY-MM-DD-ten-cau-hoi.md`
Ở gốc `learning` có `INDEX.md`: mục lục, mỗi chủ đề một dòng.

Cách làm:
0. Trước khi dùng skill `teach` hoặc `research`, đọc nội dung skill bằng skills_read (name: `teach` hoặc `research`) của cloud-harness-local và làm theo đúng skill đó, không làm theo trí nhớ. Hai skill này không thuộc AgentKit. Chỉ dùng chúng khi tôi yêu cầu rõ.
1. Gọi workspace_list, lấy workspaceId của workspace tên `learning`. Mọi lệnh đọc/ghi file học đều truyền workspaceId này, không dùng workspaceId của dự án hiện tại.
2. Đọc `INDEX.md` trước. Nếu chủ đề đã có, đọc MISSION.md và learning-records/ của nó rồi học tiếp, không tạo thư mục trùng. Nếu chưa có, tạo thư mục mới, rồi thêm một dòng vào INDEX.md: thư mục, nguồn gốc (tên dự án hoặc video/link), ngày bắt đầu (YYYY-MM-DD), trạng thái (đang học / tạm dừng / xong), ghi chú ngắn.
3. Dùng đường dẫn có tiền tố thư mục chủ đề cho mọi file, ví dụ `rag-retrieval/lessons/0001-chunking.html`. Không đặt file học ở gốc `learning`, trừ INDEX.md.
4. Nếu học xuất phát từ dự án hiện tại, ghi tên dự án và lý do trong MISSION.md của chủ đề. Không sao chép mã nguồn hay dữ liệu nhạy cảm của dự án vào `learning`.
5. Chỉ đọc repo dự án để lấy ví dụ thực tế khi cần. Không thêm, sửa hay commit file học vào repo dự án.
6. Dùng skill `teach` khi tôi muốn học dài hạn, skill `research` khi chỉ cần tra cứu có nguồn.
7. Khi hoàn tất, báo lại đường dẫn các file đã tạo hoặc sửa (workspace `learning`, đường dẫn tương đối) và dòng INDEX.md đã cập nhật. Không dùng git push cho `learning`; commit cục bộ chỉ khi tôi yêu cầu.

Nếu không thấy workspace `learning` trong workspace_list, dừng lại và báo tôi, không tự lưu vào repo dự án.



### Vietnamese Response Policy

**BẮT BUỘC:** Trừ khi người dùng yêu cầu rõ ràng một ngôn ngữ khác, mọi phản hồi của AI phải dùng **tiếng Việt**.

#### Phạm vi áp dụng

- Áp dụng cho mọi câu trả lời trong phiên làm việc: cập nhật tiến độ, giải thích, phân tích, kế hoạch, review, tóm tắt và kết quả cuối cùng.
- Áp dụng cả khi tài liệu nguồn, log, issue hoặc nội dung người dùng gửi vào là tiếng Anh hay ngôn ngữ khác.
- Không được tự ý dùng tiếng Anh chỉ vì nội dung mang tính kỹ thuật, chuyên nghiệp hoặc ngắn gọn.

#### Nội dung được giữ nguyên ngôn ngữ gốc

Chỉ giữ nguyên khi việc dịch có thể làm sai nghĩa, hỏng cú pháp hoặc giảm độ chính xác:

- Mã nguồn, block code, inline code, cú pháp lập trình
- Tên biến, tên hàm, tên class, tên interface, tên package, tên module
- Lệnh terminal, PowerShell, Bash, SQL, JSON, YAML, XML, regex
- Stack trace, log hệ thống, thông báo lỗi nguyên bản
- Tên API, HTTP methods, header names, env vars, schema, payload
- Đường dẫn file, URL, tên sản phẩm, tên dịch vụ, tên riêng
- Thuật ngữ kỹ thuật phổ biến khi bản dịch tiếng Việt gây tối nghĩa hoặc sai ngữ cảnh

#### Quy tắc trình bày

- Mọi phần diễn giải bên ngoài code block phải viết bằng tiếng Việt.
- Khi cần trích dẫn nguyên văn tiếng Anh, chỉ trích phần cần thiết và luôn giải thích lại bằng tiếng Việt.
- Nếu người dùng yêu cầu song ngữ, tiếng Việt phải là ngôn ngữ chính và xuất hiện trước, trừ khi người dùng nói khác đi.
- Với bảng, checklist, review findings, changelog hoặc tài liệu sinh ra từ AI, phần mô tả phải viết bằng tiếng Việt; chỉ các token kỹ thuật mới được giữ nguyên.

#### Ưu tiên tuân thủ

- Quy tắc này có hiệu lực mặc định cho toàn bộ repository và mọi phiên làm việc liên quan.
- Quy tắc này ưu tiên cao hơn các thói quen mặc định về phong cách viết hoặc ngôn ngữ của model.
- Chỉ được chuyển hoàn toàn sang ngôn ngữ khác khi người dùng yêu cầu trực tiếp và rõ ràng.

#### Completion Signal

- PowerShell note: In this Windows workspace, the nearest equivalent is `powershell -NoProfile -Command "Start-Process 'raycast://extensions/raycast/raycast/confetti'"` if Raycast URI handling is available.
