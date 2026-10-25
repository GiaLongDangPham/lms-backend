# D1/B1/B2/F2 · Kế hoạch hoàn thiện tuần 02

**Goal:** Hoàn thiện D1/B1/B2 và tích hợp F2 của Long theo kế hoạch tuần 02,
giữ baseline Q05–Q08 ngày 24/10/2026 và hợp đồng API dùng chung.

**Architecture:** Dùng lại EnrollmentService/AssessmentService cho bulk và backfill;
thêm module materials với HTTP routes, service tài liệu/file, Q08 policy và
S3 adapter. Dùng migration additive cho giới hạn material. Tiếp tục frontend F2
hiện có và sửa auth/API/file picker để chạy với backend thật.

**Tech Stack:** Node.js 22, Express 5, strict TypeScript ESM, PostgreSQL 17/pg,
Zod 4, AWS S3 SDK v3, Busboy, file-type, yauzl, Vitest/Supertest, React/Vite.

**Spec:** [Long Week 02 Completion Design](../specs/D1-B1-B2-F2-tuan-02.md).

**Status:** Ready for PR; verified locally, pending CI, team review and staging acceptance.

Plan được chuẩn hóa ngày 25/10 sau lượt triển khai local. `[x]` là công việc có
kết quả đã ghi nhận, không khẳng định đã viết test trước implementation hoặc đã
được reviewer/staging nghiệm thu. Các mục chưa có bằng chứng giữ `[ ]`.

Đường dẫn file mặc định tương đối với repo backend; `../lms-frontend/` là repo
frontend cạnh backend trong workspace. Repo frontend dùng nhánh riêng.

## Global Constraints

- Backend: `B2-noi-dung-upload-tuan-02`; frontend: `F2-tich-hop-api-that`.
- Giữ migration 0001–0005; thêm 0006, không đổi số 0002/0003 theo mô tả cũ trong PDF.
- Giữ OpenAPI/camelCase/cursor/error envelope; không đổi rule B3/B4 hoặc lộ Draft.
- Không reset DB dự án, sửa `.env` cá nhân hoặc đưa key/token vào Git.
- Không đánh dấu staging/review/Tracker đã đạt dựa trên kết quả local.
- Scope không gồm F1 quản trị đầy đủ, B5/B6, note L05 hay unpublish.
- Chỉ sửa task của Long. D2/OpenAPI và tài liệu B3/B4 của Nam giữ nguyên;
  các thay đổi contract cần thiết được ghi thành đề xuất bàn giao.

## Activity and Review Map

| Hoạt động | Kế hoạch | Trạng thái local | Điều kiện còn lại |
| --- | --- | --- | --- |
| D1 | 19/10, 3 giờ | CP1 schema đã có ở 0003; thêm/test 0006 cho Q08 | Migration staging, Nam review, Kha xác nhận ma trận CP1 |
| B1 | 19–20/10, 8 giờ | B1 đã có; bổ sung/test bulk enrollment | Nam review, Cát T1b trên staging |
| B2 | 21–22/10, 8 giờ | Materials/file/storage/cleanup đã kiểm tra local | Private bucket/IAM, scheduler, staging, Nam review |
| F2 | Bắt đầu 23/10, 4 giờ; xong dự kiến 26/10 | Tích hợp API thật; đã cập nhật develop a8b37de gồm F1/F2/F3 nền | Khang nghiệm thu UI, staging |

24 giờ trong kế hoạch = 23 giờ công việc trên + 1 giờ họp CD; không phải giờ
thực tế đã ghi nhận. Kết quả ngày 25/10 không chứng minh các hạn cũ từng đạt.
Long còn nhiệm vụ review B3 của Nam và F0 của Khang; đã đọc code/chạy regression
liên quan nhưng chưa gửi review chính thức trên GitHub.

## Review Focus

- Bulk không thay thế kết quả/history đã có, không bỏ sót Published zero khi reactivation.
- Race gắn file chỉ có một tài nguyên thắng; lỗi phải rollback link/lifecycle.
- SV không tải bài nộp của bạn cùng lớp; thu hồi membership mất quyền ngay.
- Đúng 25 MiB được nhận, vượt một byte bị chặn; giới hạn 10 file giữ cả ở DB.
- Cleanup không xóa linked file; lỗi storage vẫn có bản ghi để retry.
- Frontend refresh không quay cookie song song, login sai không refresh, token ở RAM.
- Kiểm tra UI theo kit và bucket private thật; không suy từ mock/HTTP fixture local.

---

### Task 1: Verify D1 Baseline and Add the Material File Constraint

**Files:**

- Review: `database/migrations/0003_client_rules.sql`, `0004_b3_assignments_submissions.sql`, `0005_assignment_publication_actor.sql`
- Create: `database/migrations/0006_b2_material_file_limit.sql`
- Modify: `scripts/test-database.ts`, `database/migrations/README.md`
- Verify: `tests/materials.integration.test.ts`

**Interfaces:** Giữ L04/L14/L20; thêm deferred trigger giới hạn 10 file/material.
Migration dừng nếu dữ liệu cũ vi phạm, không tự xóa attachment. Không thêm field ERD.

- [x] **Step 1: Đối chiếu migration hiện có với CP1/Q08.** Xác nhận 0003 đã chứa
  sửa lớp/grade/history; không sửa lại 0001–0005.
- [x] **Step 2: Thêm migration 0006.** Preflight material cũ và constraint deferred.
- [x] **Step 3: Cập nhật migration list/count và rollback probe.** Probe dùng 0007
  trong thư mục test tạm để không trùng số migration thật.
- [x] **Step 4: Kiểm tra giới hạn HTTP và DB.** 10 file thành công, file thứ 11 bị
  chặn và file vẫn PENDING sau rollback (AC-D1-02).
- [x] **Step 5: Chạy `npm run db:test`.** 20 kiểm tra đạt trên PostgreSQL 17 riêng.
- [ ] **Step 6: Nghiệm thu migration staging và CP1.** Lưu evidence môi trường,
  Nam review và xác nhận Kha trước khi đóng D1.

### Task 2: Complete B1 Bulk Enrollment

**Files:**

- Modify: `src/modules/b1/enrollment.service.ts`, `src/modules/b1/router.ts`
- Reuse: `src/modules/b1/enrollment.repository.ts`, `src/modules/assessment/service.ts`
- Verify: `tests/materials.integration.test.ts`, `tests/enrollment-publication.integration.test.ts`

**Interfaces:** POST bulk nhận 1–500 dòng; statuses ENROLLED/ALREADY_ENROLLED/
NOT_FOUND/INVALID_ROLE; counts theo spec; class lock và Published backfill cùng transaction.

- [x] **Step 1: Validation và ADMIN-only route.** Chuẩn hóa schoolCode, kiểm tra
  row/array/class, giữ thứ tự kết quả.
- [x] **Step 2: Tái sử dụng enrollment/backfill hiện có.** Reactivation giữ ID,
  không tạo submission giả hoặc ghi đè grade/history.
- [x] **Step 3: Thêm integration cases.** Mixed rows, duplicate, inactive,
  invalid role, class không tồn tại, payload quá giới hạn và post-publication zero.
- [x] **Step 4: Chạy focused API suite và enrollment regression.** AC-B1-01/02 đạt local.
- [ ] **Step 5: Nam review; Cát chạy T1b trên staging.** Gắn kết quả vào PR/issue B1.

### Task 3: Implement B2 Materials and Private File Access

**Files:**

- Create: `src/modules/materials/material.routes.ts`, `material.service.ts`, `file.service.ts`
- Modify: `src/app.ts`
- Create: `tests/materials.integration.test.ts`

**Interfaces:** Materials GET/POST/PATCH theo OpenAPI; owned/unexpired/PENDING file
attachment; download theo tài nguyên cha/membership/submission ownership.

- [x] **Step 1: CRUD và cursor-scoped list.** GV cùng lớp quản lý ngang nhau,
  SV read-only, ADMIN bị chặn theo x-roles.
- [x] **Step 2: Atomic attachment/replacement.** Retain file cũ, khóa file mới,
  file bỏ chuyển DELETE_PENDING; trigger chống reuse.
- [x] **Step 3: Download có phân quyền.** ATTACHED-only; SV không đọc file của bạn
  cùng lớp; trả bytes attachment UTF-8, private/no-store.
- [x] **Step 4: Test quyền, cursor, rollback và concurrency.** AC-B2-01/02/04 đạt local.

### Task 4: Implement Q08 Validation, S3 Storage and Cleanup

**Files:**

- Create: `src/modules/materials/file-policy.ts`, `storage.ts`
- Create: `scripts/cleanup-files.ts`, `tests/file-policy.test.ts`, `tests/storage.test.ts`
- Modify: `src/server.ts`, `.env.example`, `package.json`, `package-lock.json`
- Verify: `tests/materials.integration.test.ts`

**Interfaces:** ObjectStorage bucket/put/get/remove; multipart one-file stream;
Q08 limits; cleanup 100 object/lượt, SKIP LOCKED, retry sau ít nhất 5 phút.

- [x] **Step 1: Multipart/temp-file lifecycle.** Không buffer toàn bộ upload;
  cleanup temp trong finally, malformed body có lỗi API rõ ràng.
- [x] **Step 2: Đối chiếu loại/nội dung.** MIME/signature/UTF-8, OLE/OOXML và ZIP
  giới hạn entries/expanded size/ratio, nested archive, symlink và path traversal.
- [x] **Step 3: S3 adapter và cấu hình.** Backend có thể chạy không có bucket,
  nhưng upload/download trả STORAGE_UNAVAILABLE khi thiếu cấu hình.
- [x] **Step 4: Cleanup/retry.** Orphan >24 giờ và detached files được dọn;
  file còn liên kết được giữ, xóa thất bại giữ DELETE_PENDING.
- [x] **Step 5: Kiểm tra biên và storage.** Đúng 25 MiB/vượt 1 byte, storage outage,
  retries; S3 SDK signed PUT/GET/DELETE giữ nguyên bytes trên HTTP fixture.
- [ ] **Step 6: Xác minh private bucket/IAM thật và cấu hình scheduler staging.**
  HTTP fixture không chứng minh chính sách bucket hoặc quyền production.

### Task 5: Integrate the Existing F2 Frontend

**Files — repo frontend:**

- Modify: `src/lib/apiClient.ts`, `src/lib/apiClient.test.ts`, `src/contexts/AuthContext.tsx`
- Modify: `src/lib/assignments.ts`, `src/lib/assignments.test.ts`
- Modify: `src/lib/materials.ts`, `src/lib/materials.test.ts`
- Reuse unchanged from develop/F1: `src/pages/ChangePasswordPage.tsx`,
  `src/components/ProtectedRoute.tsx`, `src/pages/LoginPage.tsx`, `src/lib/types.ts`
- Modify: `src/pages/teacher/MaterialFormPage.tsx`, `.env.example`, `package-lock.json`, `README.md`

**Interfaces:** Base API 3000, credentials include, bearer RAM, single-flight refresh;
ProtectedRoute yêu cầu đổi mật khẩu; Q08 picker và giới hạn form.

- [x] **Step 1: Tiếp tục từ F2 `340e499`, cập nhật develop `a8b37de`.** Sao lưu
  các thay đổi local trước khi fast-forward; lấy nguyên F1 của Khang. Nhánh develop
  local ở a8b37de; nhánh F2 đặt các commit tích hợp của Long trên baseline này.
- [x] **Step 2: Nối auth/API/download với backend thật.** Concurrent 401 dùng chung
  refresh, retry một lần, login lỗi không refresh. Giữ `endSession` của F1 trong
  AuthContext; bỏ kiểm tra token localStorage trước khi khôi phục phiên.
  Chặn retry sau khi đổi phiên, đợi refresh cũ trước login và bỏ kết quả khôi
  phục user cũ nếu một thao tác login/logout mới đã bắt đầu.
- [x] **Step 3: Dùng lại đổi mật khẩu F1.** Bỏ bản local trùng; trang đổi mật khẩu,
  route bảo vệ, LoginPage và User type khớp nguyên bản develop. Kiểm tra đổi mật
  khẩu và đăng nhập lại qua API thật như một phần nghiệm thu tích hợp.
- [x] **Step 4: Đồng bộ Q08 trong F2.** File rỗng/>25 MiB bị chặn trước request,
  tài liệu tối đa 10 file, title/description giới hạn theo spec.
- [x] **Step 5: Chạy `npm run check` ở frontend sau cập nhật develop và rà PR.**
  61 test, lint và build đạt (trước rà PR: 55; trước cập nhật develop: 40).
- [x] **Step 6: Browser smoke API/PostgreSQL thật.** GV create/edit/reload, SV tải
  đúng bytes/tên tiếng Việt, forced password change và mobile 390 px đạt.
  Save lỗi rồi thử lại không upload lại file thành công; refresh đang chờ không
  ghi đè login mới, reload sau đó vẫn giữ đúng phiên.
- [ ] **Step 7: Khang review phần tích hợp UI/F2 và nghiệm thu staging.** F2/F3 nền
  đã nằm trong develop qua PR #8; review diff local của Long so với baseline mới.

### Task 6: Document Long's Work and Hand Off Contract Proposals

**Files:**

- Read only: `docs/openapi.json` (D2 của Nam)
- Modify: `README.md`, `src/modules/README.md`
- Create: spec và plan hiện tại, `docs/superpowers/README.md`
- Modify: `../lms-frontend/README.md`
- Remove: các tài liệu bàn giao/trạng thái mới tạo rời rạc; nội dung hợp nhất vào spec/plan

**Interfaces:** Không thêm field nghiệp vụ; bàn giao đề xuất validation, bulk
statuses/counts, lỗi 403/503 storage cho Nam; một cặp spec/plan của Long là đầu mối
thay đổi tuần 02. Không đổi tài liệu task của thành viên khác.

- [ ] **Step 1: Nam cập nhật D2/OpenAPI sau review đề xuất.** maxItems/uniqueItems,
  title/description lengths, storage errors và bulk diễn giải rõ. File OpenAPI
  đã được hoàn nguyên; đây là phụ thuộc bàn giao, chưa đánh dấu hoàn thành.
- [x] **Step 2: Chuẩn hóa tài liệu theo mẫu B3.** Spec chứa thiết kế/acceptance;
  plan chứa task/files/interfaces/checklist, runbook và evidence.
- [x] **Step 3: Cập nhật README và index, loại bản trùng.** Kiểm tra các liên kết
  nội bộ không còn trỏ tới file đã bỏ; chỉ sắp xếp lại tài liệu của Long, giữ
  nguyên file D2 và B3/B4 của người khác.
- [ ] **Step 4: Nhóm ghi MaTran_NhatKy.** L19/B1 bulk; Q08/B2 lifecycle/storage;
  Q08/D1 material constraint; Q08/D2 validation/errors. Chưa cập nhật Tracker.

### Task 7: Whole-Branch Verification and Delivery

**Files:** Review toàn bộ working tree của hai repo; chỉ sửa nếu có lỗi được chứng minh.

**Interfaces:** Code trên nhánh tính năng có evidence và checklist review/staging;
backend cập nhật qua PR #10, chưa xác nhận task Done hoặc staging acceptance.

- [x] **Step 1: Backend static/unit/build.** `npm run check`: 29 test thường đạt;
  gồm regression Office package, encoding JSON và cấu hình upload quota.
- [x] **Step 2: PostgreSQL/API.** `npm run api:test`: 65 test đạt; `npm run db:test`:
  20 kiểm tra đạt trên DB tạm.
- [x] **Step 3: Contract/mock.** `npm run api:validate` và
  `node scripts/mock-api.mjs --self-test`: đạt, 34 paths/48 operations.
- [x] **Step 4: Frontend/browser.** Frontend check 61 test/build trên baseline
  develop a8b37de; smoke browser đạt.
- [x] **Step 5: Diff/dependencies.** `git diff --check` đạt hai repo;
  npm audit báo 0 vulnerability tại lần kiểm tra 25/10/2026.
- [ ] **Step 6: Review team và GitHub CI.** Backend tiếp tục trên
  [PR #10](https://github.com/GiaLongDangPham/lms-backend/pull/10) hướng develop;
  frontend bàn giao nhánh F2 để Long tạo PR. Chờ CI và reviewer cho bản sửa mới.
- [ ] **Step 7: Staging acceptance.** Chạy checklist dưới đây; chỉ đóng task khi
  có bằng chứng môi trường và reviewer, không dựa vào local verified.

## Local Verification Evidence — 25/10/2026

| Check | Kết quả |
| --- | --- |
| Backend check | Lint, typecheck, 29 test và build đạt; trước lượt sửa VanDe: 22 |
| API integration | B1 22, Client Rules 13, Assignments 7, Enrollment Publication 6, Materials/Bulk 17: tổng 65 đạt |
| DB integration | 20 kiểm tra migration/seed/constraint đạt |
| Contract/mock | Validation và self-test đạt |
| Frontend check | Sau đồng bộ develop a8b37de và rà PR: lint, 61 test, TypeScript/Vite build đạt |
| Browser | GV tạo/sửa/reload/retry lưu; SV tải đúng bytes/tên file; forced password change/login lại; refresh/login race; 390 px không tràn, không pageerror |
| Storage SDK | Signed requests qua HTTP fixture local; chưa phải bucket cloud |

Docker engine không sẵn sàng khi kiểm tra; dùng cluster PostgreSQL 17 riêng tại
127.0.0.1:25432, không chạm DB dự án. Các DB tạm đã được xóa, cluster test đã dừng.
Browser harness và screenshots ở workspace `tmp/verification/long-week02-browser.mts`
và `tmp/verification/week02-screenshots/`. Đây là bằng chứng local ngoài Git, không
phải artifact CI được cả nhóm mặc nhiên truy cập.

## Staging Runbook and Acceptance

### Bug-01 / Fail-01 / Fail-03 / Fail-04

- [x] Fail-01: đối chiếu bốn endpoint tài liệu của PR #10; kiểm tra HTTP/contract,
  membership và vòng đời file. Endpoints đã có trước lượt sửa này.
- [x] Chặn Office package chứa executable/OLE/DTD/external relationship, kể cả
  character reference và attribute che khuất; kiểm tra DOCX/XLSX/PPTX hợp lệ.
- [x] Thêm rate theo user và quota count/bytes bằng transaction PostgreSQL;
  kiểm tra upload đồng thời, nhiều session/app, user khác và cleanup/attach.
- [x] Chặn byte JSON UTF-8 lỗi trước decode; thêm regression B1 dữ liệu tiếng Việt.
- [x] Chạy lại check/API/DB/contract/mock trước commit và push PR #10; audit 0 vulnerability.

Rate test dùng timeout 30 giây cho nhiều lượt đăng nhập Argon2 trên máy local;
window rate vẫn 60 giây. Quota test count chạy đồng thời qua hai app dùng chung DB,
byte quota kiểm tra boundary và ba upload song song; rejected upload không tạo object.

Với PowerShell, gửi byte UTF-8 tường minh khi gọi API có tiếng Việt, đặc biệt
Windows PowerShell 5.1. Không dùng ASCII conversion hay chuyển Buffer thành JSON object:

```powershell
# $accessToken và $classId lấy từ phiên/record cần sửa, không đưa vào Git.
$classPayload = @{ name = 'Cơ sở dữ liệu' } | ConvertTo-Json -Compress
$classBytes = [System.Text.Encoding]::UTF8.GetBytes($classPayload)
Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/api/classes/$classId" `
  -Headers @{ Authorization = "Bearer $accessToken" } `
  -ContentType 'application/json; charset=utf-8' -Body $classBytes
```

Nếu dùng file JSON, lưu file bằng UTF-8; đối chiếu Network Payload và Response.
Ảnh Bug-01 có tên đã mất dấu thành `?`; backend không tự sửa dữ liệu cũ hoặc đoán tên.
Admin nhập lại sau khi xác nhận tên gốc. Không thay đổi DB dự án trong lượt kiểm tra này.

**Prerequisites:** Node 22, PostgreSQL 17, backend JWT/origins/cookie HTTPS đúng
README; bucket private đã được tạo, quyền GetObject/PutObject/DeleteObject giới
hạn trong bucket. Không đưa credential vào Git/VITE_*.

```dotenv
S3_BUCKET=lms-private
AWS_REGION=us-east-1
# Chỉ với MinIO/S3-compatible endpoint riêng; AWS S3 dùng region/provider chain:
# S3_ENDPOINT=http://127.0.0.1:9000
# S3_FORCE_PATH_STYLE=true
# AWS_ACCESS_KEY_ID=<access-key>
# AWS_SECRET_ACCESS_KEY=<secret-key>
```

```powershell
# Backend, cấu hình environment trước; giữ .env hiện có
npm ci
npm run db:migrate
npm run dev
# Job scheduler riêng, mỗi lượt tối đa 100 object
npm run files:cleanup
```

Frontend: đặt VITE_API_BASE_URL thành API môi trường thật, build lại vì Vite đóng
cấu hình vào bundle; local dùng `http://localhost:3000/api` và `npm run dev`.
Cấu hình CORS đúng origin FE. Dùng tài liệu vừa upload thật; seed chỉ có metadata,
không có object S3 cho các attachment mẫu.

- [ ] Áp dụng 0006 trên staging, xác minh no-op khi chạy lại và dữ liệu cũ được giữ.
- [ ] Admin chạy bulk mixed rows/reactivation sau công bố; đối chiếu counts và zero.
- [ ] GV đăng/sửa tài liệu; SV cùng lớp tải đúng file; ngoài lớp và membership
  inactive bị chặn; file bài nộp không lộ cho bạn cùng lớp.
- [ ] Reload/hết hạn bearer khôi phục cookie session; tài khoản mới đổi mật khẩu
  rồi đăng nhập lại; kiểm tra cả desktop/mobile theo UI kit.
- [ ] Bucket chặn public access; chỉ backend có quyền object phù hợp.
- [ ] Scheduler gọi files:cleanup định kỳ; xác minh TTL, detached files và retry.
- [ ] Cát chạy T1b; lưu kết quả, commit SHA, URL staging và môi trường kiểm tra vào PR/issue.
- [ ] Nam review backend, Khang review F2; Long hoàn tất review B3/F0 được giao.
- [ ] Kha xác nhận CP1/ma trận và nhóm cập nhật Tracker theo evidence thực tế.

Chạy focused regression khi sửa một boundary; chạy toàn bộ check trước khi đề
nghị merge. Không tự tick các ô còn mở bằng kết quả test local ở phần trên.
